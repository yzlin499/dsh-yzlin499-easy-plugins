import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path'

const DEFAULT_TIMEOUT_MS = 30_000
const NETWORK_TIMEOUT_MS = 180_000
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const STATUS_MAX_OUTPUT_BYTES = 64 * 1024 * 1024
const STATUS_ENTRY_LIMIT = 5_000

export class SvnCommandError extends Error {
  constructor(message, code = 'svn-error', command = '', status = 400) {
    super(message)
    this.code = code
    this.command = command
    this.status = status
  }
}

function redact(text) {
  return String(text).replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi, '$1***@')
}

export function runSvn(cwd, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES
  const signal = options.signal
  const command = `svn ${args.join(' ')}`
  if (signal?.aborted) {
    return Promise.reject(new SvnCommandError('SVN command was cancelled', 'cancelled', command, 499))
  }
  const fullArgs = ['--non-interactive', ...args]
  return new Promise((resolvePromise, reject) => {
    let settled = false
    let timer
    let stdout = ''
    let stderr = ''
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')
    let outputBytes = 0
    const child = spawn('svn', fullArgs, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    })
    const onAbort = () => {
      child.kill('SIGKILL')
      finishError(new SvnCommandError('SVN command was cancelled', 'cancelled', command, 499))
    }
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const finishError = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const append = (kind, chunk) => {
      outputBytes += chunk.length
      if (outputBytes > maxOutputBytes) {
        child.kill('SIGKILL')
        finishError(new SvnCommandError('SVN output exceeded the safety limit', 'output-too-large', command, 413))
        return
      }
      if (kind === 'stdout') stdout += stdoutDecoder.write(chunk)
      else stderr += stderrDecoder.write(chunk)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      child.kill('SIGKILL')
      finishError(new SvnCommandError(`SVN command timed out after ${timeoutMs}ms`, 'timeout', command, 504))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => append('stdout', chunk))
    child.stderr.on('data', (chunk) => append('stderr', chunk))
    child.on('error', (error) => {
      const unavailable = error && error.code === 'ENOENT'
      finishError(new SvnCommandError(
        unavailable ? 'SVN CLI was not found on PATH' : `Cannot run SVN: ${error.message}`,
        unavailable ? 'svn-unavailable' : 'svn-error',
        command,
        unavailable ? 503 : 500,
      ))
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      cleanup()
      stdout += stdoutDecoder.end()
      stderr += stderrDecoder.end()
      if (code === 0) {
        resolvePromise(stdout)
        return
      }
      const message = redact(stderr.trim() || stdout.trim() || `SVN exited with code ${String(code)}`)
      reject(new SvnCommandError(message, 'svn-error', command, 400))
    })
  })
}

function decodeXml(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
    if (entity === 'amp') return '&'
    if (entity === 'lt') return '<'
    if (entity === 'gt') return '>'
    if (entity === 'quot') return '"'
    if (entity === 'apos') return "'"
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
    return match
  })
}

export function parseXml(xml) {
  const document = { name: '#document', attrs: {}, children: [], text: '' }
  const stack = [document]
  const tokens = String(xml).match(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/g) ?? []
  for (const token of tokens) {
    if (token.startsWith('<?') || token.startsWith('<!--')) continue
    if (token.startsWith('<![CDATA[')) {
      stack[stack.length - 1].text += token.slice(9, -3)
      continue
    }
    if (token.startsWith('</')) {
      if (stack.length === 1) throw new SvnCommandError('Malformed SVN XML output', 'parse-error', '', 500)
      stack.pop()
      continue
    }
    if (token.startsWith('<')) {
      const selfClosing = token.endsWith('/>')
      const body = token.slice(1, selfClosing ? -2 : -1).trim()
      if (body.startsWith('!')) continue
      const nameMatch = /^([^\s/>]+)/.exec(body)
      if (!nameMatch) continue
      const node = { name: nameMatch[1], attrs: {}, children: [], text: '' }
      const attrText = body.slice(nameMatch[0].length)
      const attrPattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
      let match
      while ((match = attrPattern.exec(attrText)) !== null) {
        node.attrs[match[1]] = decodeXml(match[2] ?? match[3] ?? '')
      }
      stack[stack.length - 1].children.push(node)
      if (!selfClosing) stack.push(node)
      continue
    }
    stack[stack.length - 1].text += decodeXml(token)
  }
  if (stack.length !== 1) throw new SvnCommandError('Malformed SVN XML output', 'parse-error', '', 500)
  return document.children[0]
}

function child(node, name) {
  return node?.children.find((candidate) => candidate.name === name)
}

function descendants(node, name, output = []) {
  if (!node) return output
  if (node.name === name) output.push(node)
  for (const candidate of node.children) descendants(candidate, name, output)
  return output
}

function text(node, name) {
  return child(node, name)?.text.trim() ?? ''
}

function displayPath(root, raw) {
  const absolute = isAbsolute(raw) ? normalize(raw) : resolve(root, raw)
  const rel = relative(root, absolute)
  return rel === '' ? '.' : rel.split(sep).join('/')
}

export function parseStatusXml(xml, root) {
  const tree = parseXml(xml)
  return descendants(tree, 'entry').map((entry) => {
    const wc = child(entry, 'wc-status')
    const commit = child(wc, 'commit')
    return {
      path: displayPath(root, entry.attrs.path ?? ''),
      item: wc?.attrs.item ?? 'none',
      props: wc?.attrs.props ?? 'none',
      revision: wc?.attrs.revision ?? '',
      copied: wc?.attrs.copied === 'true',
      switched: wc?.attrs.switched === 'true',
      locked: wc?.attrs['wc-locked'] === 'true',
      treeConflicted: wc?.attrs['tree-conflicted'] === 'true',
      commitRevision: commit?.attrs.revision ?? '',
      author: text(commit, 'author'),
      date: text(commit, 'date'),
    }
  })
}

export function parseInfoXml(xml) {
  const tree = parseXml(xml)
  const entry = descendants(tree, 'entry')[0]
  if (!entry) throw new SvnCommandError('SVN info returned no working-copy entry', 'parse-error', '', 500)
  const repository = child(entry, 'repository')
  const wcInfo = child(entry, 'wc-info')
  return {
    isWorkingCopy: true,
    path: entry.attrs.path ?? '',
    revision: entry.attrs.revision ?? '',
    url: redact(text(entry, 'url')),
    relativeUrl: text(entry, 'relative-url'),
    repositoryRoot: redact(text(repository, 'root')),
    repositoryUuid: text(repository, 'uuid'),
    wcRoot: text(wcInfo, 'wcroot-abspath'),
    depth: text(wcInfo, 'depth'),
  }
}

export function parseLogXml(xml) {
  const tree = parseXml(xml)
  return descendants(tree, 'logentry').map((entry) => ({
    revision: entry.attrs.revision ?? '',
    author: text(entry, 'author'),
    date: text(entry, 'date'),
    message: text(entry, 'msg'),
  }))
}

function pegSafe(path) {
  return path.includes('@') ? `${path}@` : path
}

export function resolveTarget(root, requested) {
  const target = resolve(root, requested || '.')
  const rel = relative(root, target)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new SvnCommandError('Target path is outside the SVN working copy', 'path-outside-root', '', 403)
  }
  return target
}

export async function workingCopyInfo(cwd, options = {}) {
  try {
    return parseInfoXml(await runSvn(cwd, ['info', '--xml', '.'], { signal: options.signal }))
  } catch (error) {
    const notWorkingCopy = error instanceof SvnCommandError
      && error.code === 'svn-error'
      && (error.message.includes('E155007') || error.message.includes('E155010'))
    if (notWorkingCopy) {
      return { isWorkingCopy: false, path: cwd, revision: '', url: '', relativeUrl: '', repositoryRoot: '', repositoryUuid: '', wcRoot: '', depth: '' }
    }
    throw error
  }
}

async function requireWorkingCopy(cwd, options = {}) {
  const info = await workingCopyInfo(cwd, options)
  if (!info.isWorkingCopy || !info.wcRoot) {
    throw new SvnCommandError('The session workspace is not an SVN working copy', 'not-working-copy', '', 400)
  }
  return info
}

export function compactStatusEntries(entries, limit = STATUS_ENTRY_LIMIT) {
  const important = []
  const unversioned = []
  for (const entry of entries) {
    if (entry.item === 'unversioned') unversioned.push(entry)
    else important.push(entry)
  }
  const selected = important.slice(0, limit)
  if (selected.length < limit) selected.push(...unversioned.slice(0, limit - selected.length))
  return {
    entries: selected,
    totalEntries: entries.length,
    shownEntries: selected.length,
    truncated: selected.length < entries.length,
    omittedImportant: Math.max(important.length - Math.min(important.length, limit), 0),
    omittedUnversioned: Math.max(entries.length - selected.length - Math.max(important.length - limit, 0), 0),
  }
}

export async function status(cwd, options = {}) {
  const info = await workingCopyInfo(cwd, options)
  if (!info.isWorkingCopy || !info.wcRoot) {
    return { info, entries: [], totalEntries: 0, shownEntries: 0, truncated: false, omittedImportant: 0, omittedUnversioned: 0, unversionedSuppressed: false }
  }
  const scopeTarget = resolve(cwd)
  const buildArgs = (quiet) => {
    const args = ['status', '--xml']
    if (quiet) args.push('--quiet')
    if (options.showUpdates === true) args.push('--show-updates')
    args.push(pegSafe(scopeTarget))
    return args
  }
  const runStatus = (quiet) => runSvn(info.wcRoot, buildArgs(quiet), {
    timeoutMs: options.showUpdates ? NETWORK_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
    maxOutputBytes: STATUS_MAX_OUTPUT_BYTES,
    signal: options.signal,
  })
  let output
  let unversionedSuppressed = false
  try {
    output = await runStatus(false)
  } catch (error) {
    if (!(error instanceof SvnCommandError) || error.code !== 'output-too-large') throw error
    output = await runStatus(true)
    unversionedSuppressed = true
  }
  const compacted = compactStatusEntries(parseStatusXml(output, info.wcRoot))
  return {
    info,
    ...compacted,
    truncated: compacted.truncated || unversionedSuppressed,
    unversionedSuppressed,
  }
}

export async function diff(cwd, options = {}) {
  const info = await requireWorkingCopy(cwd, options)
  const scopeTarget = resolve(cwd)
  const args = ['diff', '--git', '--show-copies-as-adds']
  if (options.revision !== undefined) {
    if (!/^\d+$/.test(String(options.revision))) throw new SvnCommandError('Invalid SVN revision', 'bad-request')
    args.push('-c', String(options.revision), pegSafe(scopeTarget))
  } else if (options.path !== undefined && options.path !== '') {
    args.push(pegSafe(resolveTarget(info.wcRoot, options.path)))
  } else {
    args.push(pegSafe(scopeTarget))
  }
  return { diff: await runSvn(info.wcRoot, args, { timeoutMs: NETWORK_TIMEOUT_MS, signal: options.signal }) }
}

export async function log(cwd, options = {}) {
  const info = await requireWorkingCopy(cwd, options)
  const limit = Number.isInteger(options.limit) ? Math.min(Math.max(options.limit, 1), 100) : 20
  const start = options.startRevision === undefined || options.startRevision === '' ? 'HEAD' : String(options.startRevision)
  if (start !== 'HEAD' && !/^\d+$/.test(start)) throw new SvnCommandError('Invalid SVN start revision', 'bad-request')
  const output = await runSvn(info.wcRoot, ['log', '--xml', '-r', `${start}:1`, '-l', String(limit), pegSafe(resolve(cwd))], { timeoutMs: NETWORK_TIMEOUT_MS, signal: options.signal })
  return parseLogXml(output)
}

function targetArgs(root, paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 200) {
    throw new SvnCommandError('At least one target path is required', 'bad-request')
  }
  return paths.map((path) => {
    if (typeof path !== 'string' || path.trim() === '') throw new SvnCommandError('Invalid target path', 'bad-request')
    return pegSafe(resolveTarget(root, path))
  })
}

export async function add(cwd, paths, options = {}) {
  const info = await requireWorkingCopy(cwd, options)
  await runSvn(info.wcRoot, ['add', '--parents', ...targetArgs(info.wcRoot, paths)], { signal: options.signal })
  return { done: true }
}

export async function revert(cwd, paths, options = {}) {
  const info = await requireWorkingCopy(cwd, options)
  await runSvn(info.wcRoot, ['revert', '--depth', 'infinity', ...targetArgs(info.wcRoot, paths)], { signal: options.signal })
  return { done: true }
}

export async function commit(cwd, message, options = {}) {
  const info = await requireWorkingCopy(cwd, options)
  const clean = String(message ?? '').trim()
  if (clean === '' || clean.length > 10_000) throw new SvnCommandError('Commit message is required', 'bad-request')
  const output = await runSvn(info.wcRoot, ['commit', '-m', clean, pegSafe(resolve(cwd))], { timeoutMs: NETWORK_TIMEOUT_MS, signal: options.signal })
  return { done: true, output: redact(output.trim()) }
}

export async function update(cwd, options = {}) {
  const info = await requireWorkingCopy(cwd, options)
  const output = await runSvn(info.wcRoot, ['update', pegSafe(resolve(cwd))], { timeoutMs: NETWORK_TIMEOUT_MS, signal: options.signal })
  return { done: true, output: redact(output.trim()) }
}
