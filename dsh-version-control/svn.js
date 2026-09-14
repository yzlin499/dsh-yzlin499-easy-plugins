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

// ── SVN 可执行文件解析与 WSL 路径转换 ──────────────────────────────────────
// 原生 Windows 上直接 `svn`；WSL（Linux）下 `svn` 不存在时自动回退到 Windows 的
// `svn.exe`（WSL interop 会把 Windows PATH 自动追加到 WSL PATH）。Windows 版
// svn 只认 Windows 路径：interop 只翻译子进程的 cwd，argv 里的绝对 Linux 路径
// 原样透传。因此在 WSL 下使用 svn.exe 时，cwd 与绝对路径参数需转换成
// `C:\...`（/mnt/c/... → C:\...），返回的 XML 里的路径再转回 Linux 路径。
const RESOLUTION = { key: undefined, pending: null }
const currentBackend = { windows: false }

function resolveKey(configured) {
  return typeof configured === 'string' ? configured.trim() : ''
}

export function svnExecutableCandidates(configured) {
  if (resolveKey(configured) !== '') return [resolveKey(configured)]
  const list = ['svn', 'svn.exe']
  if (process.platform === 'win32') {
    list.push(
      'C:\\Program Files\\TortoiseSVN\\bin\\svn.exe',
      'C:\\Program Files (x86)\\TortoiseSVN\\bin\\svn.exe',
      'C:\\Program Files\\SlikSvn\\bin\\svn.exe',
      'C:\\Program Files (x86)\\SlikSvn\\bin\\svn.exe',
    )
  } else {
    // WSL：TortoiseSVN / SlikSvn 常见安装路径（Windows PATH 未包含时兜底）
    list.push(
      '/mnt/c/Program Files/TortoiseSVN/bin/svn.exe',
      '/mnt/c/Program Files (x86)/TortoiseSVN/bin/svn.exe',
      '/mnt/c/Program Files/SlikSvn/bin/svn.exe',
      '/mnt/c/Program Files (x86)/SlikSvn/bin/svn.exe',
    )
  }
  return [...new Set(list)]
}

function windowsLikeExecutable(executable) {
  return /\.exe$/i.test(executable) || /\\/.test(executable) || /^[a-zA-Z]:[\\/]/.test(executable)
}

function probeExecutable(candidate) {
  return new Promise((resolvePromise) => {
    let settled = false
    const finish = (value) => { if (!settled) { settled = true; resolvePromise(value) } }
    const child = spawn(candidate, ['--version', '--quiet'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(false) }, 8_000)
    child.on('error', () => { clearTimeout(timer); finish(false) })
    child.on('close', (code) => { clearTimeout(timer); finish(code === 0) })
  })
}

export async function resolveSvnExecutable(configured) {
  const key = resolveKey(configured)
  if (!RESOLUTION.pending || RESOLUTION.key !== key) {
    const candidates = svnExecutableCandidates(configured)
    const probe = (index) => {
      if (index >= candidates.length) return Promise.resolve('')
      return probeExecutable(candidates[index]).then((ok) => {
        if (ok) {
          currentBackend.windows = process.platform === 'linux' && windowsLikeExecutable(candidates[index])
          return candidates[index]
        }
        return probe(index + 1)
      })
    }
    RESOLUTION.key = key
    RESOLUTION.pending = probe(0)
  }
  return RESOLUTION.pending
}

export function resetSvnExecutableResolution() {
  RESOLUTION.key = undefined
  RESOLUTION.pending = null
  currentBackend.windows = false
}

/** Linux 绝对路径 → Windows 路径（/mnt/c/x → C:\x；发行版内部路径 → \\wsl$\<distro>\x） */
export function toWindowsPath(path) {
  const value = String(path)
  const mount = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(value)
  if (mount) return `${mount[1].toUpperCase()}:\\${(mount[2] ?? '').replace(/\//g, '\\')}`
  if (/^[a-zA-Z]:[\\/]/.test(value)) return value.replace(/\//g, '\\')
  if (value.startsWith('\\\\')) return value
  const distro = process.env.WSL_DISTRO_NAME || 'WSL'
  return `\\\\wsl$\\${distro}\\${value.replace(/^\/+/, '').replace(/\//g, '\\')}`
}

/** Windows 路径 → Linux 路径（C:\x → /mnt/c/x；\\wsl$\distro\x → /x） */
export function toLinuxPath(path) {
  const value = String(path)
  // UNC：\\wsl$\<distro>\...（Windows 访问发行版内部路径）→ /<rest>
  const wslShare = /^\\\\wsl\$\\([^\\/]+)\\(.*)$/.exec(value)
  if (wslShare) return `/${wslShare[2].replace(/\\/g, '/')}`
  const normalized = value.replace(/[\\/]+/g, '/')
  const drive = /^([a-zA-Z]):\/(.*)$/.exec(normalized)
  if (drive) return `/mnt/${drive[1].toLowerCase()}/${drive[2]}`.replace(/\/+$/, '') || `/mnt/${drive[1].toLowerCase()}`
  return normalized
}

const NON_PATH_FLAGS = new Set(['-m', '-r', '-l', '-c'])
function translateArgs(args) {
  if (process.platform !== 'linux' || !currentBackend.windows) return args
  let previous = ''
  return args.map((arg) => {
    const isPath = arg.startsWith('/') && !NON_PATH_FLAGS.has(previous)
    previous = arg
    return isPath ? toWindowsPath(arg) : arg
  })
}

export async function runSvn(cwd, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES
  const signal = options.signal
  const executable = await resolveSvnExecutable(options.svnExecutable)
  const translatedArgs = translateArgs(args)
  const command = `${executable} ${translatedArgs.join(' ')}`
  if (signal?.aborted) {
    return Promise.reject(new SvnCommandError('SVN command was cancelled', 'cancelled', command, 499))
  }
  if (!executable) {
    const configured = resolveKey(options.svnExecutable)
    const detail = configured
      ? `configured SVN executable is not runnable: "${configured}"`
      : `no SVN CLI found (tried: ${svnExecutableCandidates(options.svnExecutable).join(', ')})`
    const hint = process.platform === 'linux'
      ? ' In WSL, install the Linux SVN CLI (e.g. sudo apt install subversion) or point the plugin setting at the Windows svn.exe.'
      : ''
    return Promise.reject(new SvnCommandError(`SVN CLI was not found: ${detail}.${hint}`, 'svn-unavailable', command, 503))
  }
  // 注意：cwd 保持 Linux 路径原样传给 spawn——WSL interop 只会把 Windows 子进程的
  // cwd 自动翻译成 Windows 路径；若这里改传 D:\... 之类 Windows 路径，Node 会在
  // Linux 命名空间里 chdir 失败直接 ENOENT。
  const fullArgs = ['--non-interactive', ...translatedArgs]
  return new Promise((resolvePromise, reject) => {
    let settled = false
    let timer
    let stdout = ''
    let stderr = ''
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')
    let outputBytes = 0
    const child = spawn(executable, fullArgs, {
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
        unavailable ? `SVN executable was not found: ${executable}` : `Cannot run SVN: ${error.message}`,
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
      path: displayPath(root, currentBackend.windows ? toLinuxPath(entry.attrs.path ?? '') : (entry.attrs.path ?? '')),
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
    wcRoot: currentBackend.windows ? toLinuxPath(text(wcInfo, 'wcroot-abspath')) : text(wcInfo, 'wcroot-abspath'),
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
    return parseInfoXml(await runSvn(cwd, ['info', '--xml', '.'], { signal: options.signal, svnExecutable: options.svnExecutable }))
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
    svnExecutable: options.svnExecutable,
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
  return { diff: await runSvn(info.wcRoot, args, { timeoutMs: NETWORK_TIMEOUT_MS, signal: options.signal, svnExecutable: options.svnExecutable }) }
}

export async function log(cwd, options = {}) {
  const info = await requireWorkingCopy(cwd, options)
  const limit = Number.isInteger(options.limit) ? Math.min(Math.max(options.limit, 1), 100) : 20
  const start = options.startRevision === undefined || options.startRevision === '' ? 'HEAD' : String(options.startRevision)
  if (start !== 'HEAD' && !/^\d+$/.test(start)) throw new SvnCommandError('Invalid SVN start revision', 'bad-request')
  const output = await runSvn(info.wcRoot, ['log', '--xml', '-r', `${start}:1`, '-l', String(limit), pegSafe(resolve(cwd))], { timeoutMs: NETWORK_TIMEOUT_MS, signal: options.signal, svnExecutable: options.svnExecutable })
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
  await runSvn(info.wcRoot, ['add', '--parents', ...targetArgs(info.wcRoot, paths)], { signal: options.signal, svnExecutable: options.svnExecutable })
  return { done: true }
}

export async function revert(cwd, paths, options = {}) {
  const info = await requireWorkingCopy(cwd, options)
  await runSvn(info.wcRoot, ['revert', '--depth', 'infinity', ...targetArgs(info.wcRoot, paths)], { signal: options.signal, svnExecutable: options.svnExecutable })
  return { done: true }
}

export async function commit(cwd, message, options = {}) {
  const info = await requireWorkingCopy(cwd, options)
  const clean = String(message ?? '').trim()
  if (clean === '' || clean.length > 10_000) throw new SvnCommandError('Commit message is required', 'bad-request')
  const output = await runSvn(info.wcRoot, ['commit', '-m', clean, pegSafe(resolve(cwd))], { timeoutMs: NETWORK_TIMEOUT_MS, signal: options.signal, svnExecutable: options.svnExecutable })
  return { done: true, output: redact(output.trim()) }
}

export async function update(cwd, options = {}) {
  const info = await requireWorkingCopy(cwd, options)
  const output = await runSvn(info.wcRoot, ['update', pegSafe(resolve(cwd))], { timeoutMs: NETWORK_TIMEOUT_MS, signal: options.signal, svnExecutable: options.svnExecutable })
  return { done: true, output: redact(output.trim()) }
}
