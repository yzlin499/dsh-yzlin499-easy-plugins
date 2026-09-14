import { spawn } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 30_000
const NETWORK_TIMEOUT_MS = 180_000
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

export class GitCommandError extends Error {
  constructor(message, code = 'git-error', command = '', status = 400) {
    super(message)
    this.code = code
    this.command = command
    this.status = status
  }
}

function redact(text) {
  return String(text).replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi, '$1***@')
}

function runGit(cwd, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const signal = options.signal
  const command = `git ${args.join(' ')}`
  if (signal?.aborted) return Promise.reject(new GitCommandError('Git command was cancelled', 'cancelled', command, 499))
  return new Promise((resolve, reject) => {
    let settled = false
    let timer
    let output = ''
    const finishError = (error) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    }
    const onAbort = () => {
      child.kill('SIGKILL')
      finishError(new GitCommandError('Git command was cancelled', 'cancelled', command, 499))
    }
    const child = spawn('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    })
    let stderr = ''
    const append = (target, chunk) => {
      if (output.length + stderr.length + chunk.length > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL')
        finishError(new GitCommandError('Git output exceeded the safety limit', 'output-too-large', command, 413))
        return
      }
      if (target === 'stdout') output += chunk.toString('utf8')
      else stderr += chunk.toString('utf8')
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      child.kill('SIGKILL')
      finishError(new GitCommandError(`Git command timed out after ${timeoutMs}ms`, 'timeout', command, 504))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => append('stdout', chunk))
    child.stderr.on('data', (chunk) => append('stderr', chunk))
    child.on('error', (error) => finishError(new GitCommandError(
      error?.code === 'ENOENT' ? 'Git executable was not found' : `Cannot run Git: ${error.message}`,
      error?.code === 'ENOENT' ? 'git-unavailable' : 'git-error', command, error?.code === 'ENOENT' ? 503 : 500,
    )))
    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (code === 0) resolve(output)
      else reject(new GitCommandError(redact(stderr.trim() || output.trim() || `Git exited with code ${String(code)}`), 'git-error', command, 400))
    })
  })
}

function relativePath(root, value) {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalized = String(value).replace(/\\/g, '/')
  return normalized.startsWith(`${normalizedRoot}/`) ? normalized.slice(normalizedRoot.length + 1) : normalized
}

function unquote(value) {
  if (!value.startsWith('"')) return value
  try { return JSON.parse(value) } catch { return value.slice(1, -1) }
}

function parseStatusLine(line) {
  if (line.length < 4) return undefined
  const code = line.slice(0, 2)
  let path = line.slice(3)
  if (code.includes('R') || code.includes('C')) {
    const separator = path.indexOf(' -> ')
    if (separator >= 0) path = path.slice(separator + 4)
  }
  path = unquote(path)
  const itemCode = code === '??' ? '?' : (code[0] !== ' ' && code[0] !== '?' ? code[0] : code[1])
  const item = {
    A: 'added', C: 'conflicted', D: 'deleted', M: 'modified', R: 'replaced', U: 'conflicted', T: 'modified', '?': 'unversioned', '!': 'missing',
  }[itemCode] ?? 'modified'
  return {
    path,
    item,
    props: 'normal',
    revision: '', copied: false, switched: false, locked: false,
    treeConflicted: code.includes('U'),
    commitRevision: '', author: '', date: '',
    staged: code[0] !== ' ' && code[0] !== '?', worktree: code[1] !== ' ' && code[1] !== '?',
  }
}

async function info(cwd, options = {}) {
  let root
  try {
    root = (await runGit(cwd, ['rev-parse', '--show-toplevel'], options)).trim()
  } catch (error) {
    if (error instanceof GitCommandError && error.code === 'git-error') {
      return { isWorkingCopy: false, path: cwd, root: '', branch: '', revision: '', remote: '' }
    }
    throw error
  }
  const [branch, revision, remote] = await Promise.all([
    runGit(cwd, ['branch', '--show-current'], options).then((value) => value.trim()).catch(() => ''),
    runGit(cwd, ['rev-parse', '--short', 'HEAD'], options).then((value) => value.trim()).catch(() => ''),
    runGit(cwd, ['remote', 'get-url', 'origin'], options).then((value) => redact(value.trim())).catch(() => ''),
  ])
  return { isWorkingCopy: true, path: cwd, root, branch, revision, remote }
}

export async function status(cwd, options = {}) {
  const repository = await info(cwd, options)
  if (!repository.isWorkingCopy) return { info: repository, entries: [], totalEntries: 0, shownEntries: 0, truncated: false }
  const output = await runGit(cwd, ['status', '--porcelain=v1', '--branch'], options)
  const lines = output.split(/\r?\n/).filter(Boolean)
  const entries = lines.slice(1).map(parseStatusLine).filter(Boolean).map((entry) => ({ ...entry, path: relativePath(repository.root, entry.path) }))
  return { info: repository, entries, totalEntries: entries.length, shownEntries: entries.length, truncated: false, unversionedSuppressed: false }
}

export async function diff(cwd, options = {}) {
  const repository = await info(cwd, options)
  if (!repository.isWorkingCopy) throw new GitCommandError('The session workspace is not a Git working copy', 'not-working-copy', '', 400)
  const args = options.revision ? ['show', '--format=', '--stat', '--patch', String(options.revision)] : ['diff', '--no-ext-diff', '--binary', 'HEAD']
  if (!options.revision && options.path) args.push('--', options.path)
  return { diff: await runGit(cwd, args, { ...options, timeoutMs: NETWORK_TIMEOUT_MS }) }
}

export async function log(cwd, options = {}) {
  const repository = await info(cwd, options)
  if (!repository.isWorkingCopy) throw new GitCommandError('The session workspace is not a Git repository', 'not-working-copy', '', 400)
  const limit = Number.isInteger(options.limit) ? Math.min(Math.max(options.limit, 1), 100) : 20
  const output = await runGit(cwd, ['log', `-${limit}`, '--date=iso-strict', '--pretty=format:%H%x1f%an%x1f%ad%x1f%s%x1e'], { ...options, timeoutMs: NETWORK_TIMEOUT_MS })
  return output.split('\x1e').map((row) => row.trim()).filter(Boolean).map((row) => {
    const [revision = '', author = '', date = '', message = ''] = row.split('\x1f')
    return { revision, author, date, message }
  })
}

function requirePaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 200 || paths.some((path) => typeof path !== 'string' || path.trim() === '')) {
    throw new GitCommandError('At least one target path is required', 'bad-request')
  }
  return paths
}

export async function add(cwd, paths, options = {}) {
  await runGit(cwd, ['add', '--', ...requirePaths(paths)], options)
  return { done: true }
}

export async function revert(cwd, paths, options = {}) {
  await runGit(cwd, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...requirePaths(paths)], options)
  return { done: true }
}

export async function commit(cwd, message, options = {}) {
  const clean = String(message ?? '').trim()
  if (clean === '' || clean.length > 10_000) throw new GitCommandError('Commit message is required', 'bad-request')
  await runGit(cwd, ['add', '-A'], options)
  const output = await runGit(cwd, ['commit', '-m', clean], { ...options, timeoutMs: NETWORK_TIMEOUT_MS })
  return { done: true, output: redact(output.trim()) }
}

export async function update(cwd, options = {}) {
  const output = await runGit(cwd, ['pull', '--ff-only'], { ...options, timeoutMs: NETWORK_TIMEOUT_MS })
  return { done: true, output: redact(output.trim()) }
}

export async function push(cwd, options = {}) {
  const output = await runGit(cwd, ['push'], { ...options, timeoutMs: NETWORK_TIMEOUT_MS })
  return { done: true, output: redact(output.trim()) }
}

export { info, runGit }
