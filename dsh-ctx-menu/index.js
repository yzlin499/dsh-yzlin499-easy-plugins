// dsh-ctx-menu — Host half
//
// 0.2.1 起 DSH 不再向「动态插件的客户端半侧」开放 `remote.session` 这类跨包远程服务
// （客户端 Builtin 只剩 ctx / React / host / styles / console；官方 open-in-app 改为
// 「宿主半侧注册自己的 webServer 路由 + 客户端 fetch」）。因此本文件从 M1 的"空实现"
// 升级为**薄代理**：把宿主已有的能力包成几条自有路由给客户端用。
//
// 代理的宿主服务（DSH 自带、对宿主半侧可见）：
//   - sessionController.workspacePathApplications / openWorkspacePath / canOpenWorkspacePath / workspaceDesktop
//   - sessions.get(id) + workingDirectory.get(session)   → 会话工作目录
//   - node:fs                                            → 读文件（替代 0.2.0 的 remote.workspaceFiles）
//
// 路由（同源，受 connection.requestRejection 保护）：
//   GET  /ctx-menu/capabilities           → { ok, canOpen, desktop }
//   GET  /ctx-menu/apps?path=<abs>        → { ok, canOpen, apps: [{id,name,default,icon}] }
//   GET  /ctx-menu/cwd?sessionId=<id>     → { ok, cwd }
//   GET  /ctx-menu/read?path=&mode=text|bytes → text: { ok, text } / bytes: 原始字节
//   POST /ctx-menu/open   { path, application? } → { ok }
//   POST /ctx-menu/reveal { path }               → { ok }
//
// 安全边界：只接受绝对路径；读文件校验存在/是文件/大小上限（文本 2 MiB、字节 32 MiB）；
// 启动与定位优先交给 sessionController（它内部会再做一次 verifyDesktopPath）。
//
// **跨工作区兜底**（0.2.1 实测：`I:\Jx3YL\...` 这类不属于当前会话工作区的文件，
// `workspacePathApplications` 返回空/抛错，菜单里就只剩「没有可用的关联应用」）。
// 因此官方路径失败时由宿主自己顶上：
//   - 枚举：读 Windows 注册表（UserChoice / OpenWithProgids / OpenWithList / Applications\*.exe）
//   - 启动：只允许启动「枚举结果里出现过的 exe」，避免任意命令执行
//   - 定位：explorer.exe /select,

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'

export const name = 'dsh-ctx-menu'
export const inject = ['webServer']

const PREFIX = '/ctx-menu'
const TEXT_MAX_BYTES = 2 * 1024 * 1024
const BYTES_MAX_BYTES = 32 * 1024 * 1024
const MAX_BODY_BYTES = 64 * 1024
/** 关联应用枚举结果的缓存时长（注册表不会秒变；避免每次右键都起一次 PowerShell）。 */
const APP_CACHE_TTL_MS = 300_000
const REGISTRY_TIMEOUT_MS = 8_000

const log = (...args) => console.log('[dsh-ctx-menu]', ...args)

/** 可注入的内部实现：单测替换 spawn / 注册表读取 / 时钟，生产用默认值。 */
export const internals = {
  spawn: (...args) => spawn(...args),
  /** (ext) => Promise<{ default: string|null, items: Array<{progId?, command?, name?, exe?}> } | null> */
  readRegistry: (ext) => readRegistryViaPowerShell(ext),
  now: () => Date.now(),
  // 纯函数与缓存句柄：供单测直接验证（不改变生产行为）
  parseCommandExe,
  normalizeRegistryResult,
  displayNameFor,
  toNativePath,
  encodeAppId,
  decodeAppId,
  extOf,
  clearAppCache: () => appCache.clear(),
}

/** 可选服务读取：缺失/抛错都返回 undefined，让对应能力优雅降级。 */
function serviceOf(ctx, key) {
  try {
    return ctx.get(key)
  } catch (error) {
    log('service unavailable:', key, error?.message ?? error)
    return undefined
  }
}

/** 请求 URL（服务器只解析 pathname，query 由我们自己取）。 */
function urlOf(req) {
  return new URL(String(req.url ?? '/'), 'http://localhost')
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

function sendMethodNotAllowed(res, allow) {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.end()
}

async function readBoundedBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

/** 统一的应用条目形状（与官方 parseNativeFileApplications 一致）。 */
function normalizeApp(entry) {
  const id = entry?.id
  const appName = entry?.name
  if (typeof id !== 'string' || id === '' || typeof appName !== 'string') return null
  return {
    id,
    name: appName,
    default: entry?.default === true,
    icon: typeof entry?.icon === 'string' && entry.icon.startsWith('data:image/') ? entry.icon : null,
  }
}

// ── 跨工作区兜底：自己枚举系统关联应用（Windows 注册表） ─────────────────────

/**
 * 归一成原生分隔符。客户端给的路径可能是**混用**分隔符的
 * （实测 `I:\...\YunLiu\Source/JXHan/Public/...`）：Windows 通用 API 能忍，
 * 但 DSH 的合成文件系统按原生分隔符解析，混用会让官方校验/枚举失败。
 */
function toNativePath(value) {
  const text = String(value ?? '').trim()
  if (text === '') return text
  const windowsish = /^[A-Za-z]:/.test(text) || text.startsWith('\\\\')
  return windowsish ? text.replace(/\//g, '\\').replace(/\\{2,}/g, '\\') : text.replace(/\\/g, '/')
}

/** 扩展名（小写、含点）；拿不到合法扩展名返回 null。 */
function extOf(path) {
  const base = basename(String(path ?? ''))
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = base.slice(dot).toLowerCase()
  return /^\.[a-z0-9]{1,16}$/.test(ext) ? ext : null
}

/** 从 `"C:\x\a.exe" "%1"` 这类 shell 命令串里取出 exe 路径（纯函数）。 */
function parseCommandExe(command) {
  const text = String(command ?? '').trim()
  if (text === '') return null
  const quoted = /^"([^"]+\.exe)"/i.exec(text)
  if (quoted !== null) return quoted[1]
  const bare = /^(.+?\.exe)(\s|$)/i.exec(text)
  if (bare !== null) return bare[1].trim()
  const anywhere = /([A-Za-z]:\\[^"<>|]*?\.exe)/i.exec(text)
  return anywhere === null ? null : anywhere[1]
}

function encodeAppId(exe) {
  return 'exe:' + exe
}

function decodeAppId(id) {
  const text = String(id ?? '')
  return text.startsWith('exe:') ? text.slice(4) : null
}

/** 注册表查询脚本：一次 PowerShell 进程拿全（扩展名已校验为 [a-z0-9.]，无注入风险）。
 *  两个实测坑：
 *   - PS 5.1 重定向输出默认是**本地代码页**（中文变 GBK 字节 → Node 按 UTF-8 解就乱码），
 *     必须显式把 `[Console]::OutputEncoding` 设成 UTF-8；
 *   - `ProgId` 的默认值是**文件类型描述**（如「C Header 源文件」），不是应用名，
 *     应用名要取 `Applications\\<exe>\\FriendlyAppName`。 */
const PS_TEMPLATE = `$ErrorActionPreference='SilentlyContinue'
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$ext='__EXT__'
function GP($p){ try { Get-ItemProperty -LiteralPath $p -ErrorAction Stop } catch { $null } }
function ExeOf($cmd){
  if (-not $cmd) { return $null }
  if ($cmd -match '^"([^"]+\\.exe)"') { return $matches[1] }
  if ($cmd -match '^(.+?\\.exe)(\\s|$)') { return $matches[1] }
  return $null
}
function Friendly($exe){
  if (-not $exe) { return $null }
  $leaf = Split-Path -Leaf $exe
  foreach ($root in @('HKLM:\\Software\\Classes','HKCU:\\Software\\Classes')) {
    $a = GP "$root\\Applications\\$leaf"
    if ($a -and $a.FriendlyAppName) { return $a.FriendlyAppName }
  }
  return $null
}
function VersionNames($exe){
  if (-not $exe) { return @{ fileDesc = $null; product = $null } }
  try {
    $vi = (Get-Item -LiteralPath $exe -ErrorAction Stop).VersionInfo
    return @{ fileDesc = $vi.FileDescription; product = $vi.ProductName }
  } catch {
    return @{ fileDesc = $null; product = $null }
  }
}
function Item($progId, $exe){
  $names = VersionNames $exe
  return [pscustomobject]@{ progId=$progId; exe=$exe; friendly=(Friendly $exe); fileDesc=$names.fileDesc; product=$names.product }
}
$uc = GP "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\$ext\\UserChoice"
$default = $null
if ($uc -and $uc.ProgId) { $default = $uc.ProgId }
$progIds = New-Object System.Collections.ArrayList
foreach ($root in @("HKCU:\\Software\\Classes","HKLM:\\Software\\Classes")) {
  $k = GP "$root\\$ext\\OpenWithProgids"
  if ($k) { foreach ($n in $k.PSObject.Properties.Name) { if ($n -notlike 'PS*') { [void]$progIds.Add($n) } } }
}
$exes = New-Object System.Collections.ArrayList
$owl = GP "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\$ext\\OpenWithList"
if ($owl) { foreach ($n in $owl.PSObject.Properties.Name) { if ($n -notlike 'PS*' -and $n -ne 'MRUList') { [void]$exes.Add($owl.$n) } } }
$items = New-Object System.Collections.ArrayList
$seen = @{}
foreach ($p in ($progIds | Select-Object -Unique)) {
  $cmd = $null
  foreach ($root in @('HKCU:\\Software\\Classes','HKLM:\\Software\\Classes')) {
    if (-not $cmd) { $c = GP "$root\\$p\\shell\\open\\command"; if ($c) { $cmd = $c.'(default)' } }
  }
  $exe = ExeOf $cmd
  if (-not $exe) { continue }
  $key = $exe.ToLower()
  if ($seen.ContainsKey($key)) { continue }
  $seen[$key] = 1
  [void]$items.Add((Item $p $exe))
}
foreach ($e in ($exes | Select-Object -Unique)) {
  $cmd = $null
  foreach ($root in @('HKLM:\\Software\\Classes','HKCU:\\Software\\Classes')) {
    if (-not $cmd) { $c = GP "$root\\Applications\\$e\\shell\\open\\command"; if ($c) { $cmd = $c.'(default)' } }
  }
  $exe = ExeOf $cmd
  if (-not $exe) { continue }
  $key = $exe.ToLower()
  if ($seen.ContainsKey($key)) { continue }
  $seen[$key] = 1
  [void]$items.Add((Item $null $exe))
}
@{ default=$default; items=$items } | ConvertTo-Json -Depth 4 -Compress`

function readRegistryViaPowerShell(ext) {
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise((resolve) => {
    let child
    try {
      child = internals.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_TEMPLATE.replace('__EXT__', ext)], { windowsHide: true })
    } catch (error) {
      log('registry enumeration spawn failed:', error?.message ?? error)
      resolve(null)
      return
    }
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try {
        child.kill?.()
      } catch {
        /* 忽略 */
      }
      resolve(null)
    }, REGISTRY_TIMEOUT_MS)
    timer.unref?.()
    child.stdout?.on('data', (chunk) => {
      out += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      err += String(chunk)
    })
    child.on?.('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on?.('close', () => {
      clearTimeout(timer)
      const text = out.trim()
      if (text === '') {
        if (err.trim() !== '') log('registry enumeration stderr:', err.trim().slice(0, 200))
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch {
        reportBadJson(text)
        resolve(null)
      }
    })
  })
}

function reportBadJson(text) {
  log('registry enumeration returned non-JSON:', text.slice(0, 120))
}

/** 注册表结果 → { apps:[{id,name,default,icon}], byId:Map<id,{exe}> }（纯函数，可单测）。 */
/**
 * 应用显示名：版本信息（FileDescription → ProductName）→ FriendlyAppName → exe 主干。
 * 取名顺序是实测出来的：Windows 上 `Applications\*.exe\FriendlyAppName` 常常是空的，
 * 而文件版本信息稳定可靠（Code.exe → "Visual Studio Code"、NOTEPAD.EXE → "记事本"）。
 * 顺手去掉尾部括注（"JetBrains Rider (GUI launcher)" → "JetBrains Rider"）。
 */
function displayNameFor(item, exe) {
  const candidates = [item?.fileDesc, item?.product, item?.friendly, item?.name]
  for (const value of candidates) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim().replace(/\s*\([^)]*\)\s*$/, '').trim()
    if (trimmed !== '') return trimmed
  }
  return basename(exe).replace(/\.exe$/i, '')
}

function normalizeRegistryResult(raw) {
  if (raw === null || typeof raw !== 'object') return { apps: [], byId: new Map() }
  const items = Array.isArray(raw.items) ? raw.items : []
  const byExe = new Map()
  for (const item of items) {
    const direct = typeof item?.exe === 'string' && isAbsolute(item.exe) ? item.exe : null
    const exe = direct ?? parseCommandExe(item?.command)
    if (exe === null || isAbsolute(exe) === false) continue
    const key = exe.toLowerCase()
    if (byExe.has(key)) continue
    byExe.set(key, { id: encodeAppId(exe), name: displayNameFor(item, exe), exe })
  }
  const defaultProgId = typeof raw.default === 'string' && raw.default !== '' ? raw.default.toLowerCase() : null
  let defaultId = null
  if (defaultProgId !== null) {
    const hit = items.find((item) => String(item?.progId ?? '').toLowerCase() === defaultProgId)
    const hitExe = hit === undefined ? null : (typeof hit?.exe === 'string' && isAbsolute(hit.exe) ? hit.exe : parseCommandExe(hit?.command))
    if (hitExe !== null && byExe.has(hitExe.toLowerCase())) defaultId = encodeAppId(hitExe)
  }
  const entries = [...byExe.values()]
  const apps = entries
    .map((entry) => ({ id: entry.id, name: entry.name, default: entry.id === defaultId, icon: null }))
    .sort((a, b) => Number(b.default) - Number(a.default) || a.name.localeCompare(b.name))
  return { apps, byId: new Map(entries.map((entry) => [entry.id, entry])) }
}

const appCache = new Map()

async function enumerateApps(path) {
  const ext = extOf(path)
  if (ext === null) return null
  const cached = appCache.get(ext)
  if (cached !== undefined && internals.now() - cached.at < APP_CACHE_TTL_MS) return cached.value
  const raw = await internals.readRegistry(ext)
  const value = normalizeRegistryResult(raw)
  appCache.set(ext, { at: internals.now(), value })
  return value
}

function spawnDetached(command, args) {
  try {
    const child = internals.spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref?.()
    return true
  } catch (error) {
    log('spawn failed:', command, error?.message ?? error)
    return false
  }
}

/** 官方通道失败后的启动兜底：只允许启动本次枚举里出现过的 exe。 */
async function launchViaRegistry(path, application) {
  if (process.platform !== 'win32') return false
  if (application === undefined) return spawnDetached('explorer.exe', [path])
  const exe = decodeAppId(application)
  if (exe === null || isAbsolute(exe) === false) return false
  const listed = await enumerateApps(path)
  const allowed = listed !== null && [...listed.byId.values()].some((entry) => entry.exe.toLowerCase() === exe.toLowerCase())
  if (allowed !== true) {
    log('rejected unlisted application:', exe)
    return false
  }
  if (existsSync(exe) === false) return false
  return spawnDetached(exe, [path])
}

function revealViaExplorer(path) {
  if (process.platform !== 'win32') return false
  return spawnDetached('explorer.exe', ['/select,', path])
}

export function apply(ctx) {
  /** 同源信任闸：与官方 host-open-in-app 一致，非受信来源直接拒绝。 */
  const rejected = (req, res) => {
    const connection = serviceOf(ctx, 'connection')
    if (connection === undefined || typeof connection.requestRejection !== 'function') return false
    let rejection
    try {
      rejection = connection.requestRejection(req)
    } catch (error) {
      log('requestRejection threw:', error?.message ?? error)
      return false
    }
    if (rejection === undefined || rejection === null) return false
    res.statusCode = typeof rejection === 'number' ? rejection : 403
    res.end()
    return true
  }

  const controller = () => serviceOf(ctx, 'sessionController')

  const canOpen = () => {
    const sc = controller()
    if (sc === undefined || typeof sc.canOpenWorkspacePath !== 'function') return false
    try {
      return sc.canOpenWorkspacePath() === true
    } catch (error) {
      log('canOpenWorkspacePath threw:', error?.message ?? error)
      return false
    }
  }

  /** 会话工作目录：sessions.get(id) → workingDirectory.get(session)，兜底读 session 上的字段。 */
  const cwdOf = (sessionId) => {
    const sessions = serviceOf(ctx, 'sessions')
    const working = serviceOf(ctx, 'workingDirectory')
    const session = sessions?.get?.(sessionId)
    if (session === undefined || session === null) return null
    try {
      const viaWorking = working?.get?.(session)
      if (typeof viaWorking === 'string' && viaWorking.trim() !== '') return viaWorking
    } catch (error) {
      log('workingDirectory.get threw:', error?.message ?? error)
    }
    for (const candidate of [session.cwd, session.header?.cwd, session.meta?.cwd, session.options?.cwd]) {
      if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
    }
    return null
  }

  /** 启动 / 定位：一律交给 sessionController（内部会再校验一次路径）。 */
  const invokeOpen = async (request) => {
    const sc = controller()
    if (sc === undefined || typeof sc.openWorkspacePath !== 'function') {
      return { ok: false, code: 'host/unsupported', message: 'sessionController.openWorkspacePath unavailable' }
    }
    try {
      await sc.openWorkspacePath(request, new AbortController().signal)
      return { ok: true }
    } catch (error) {
      return { ok: false, code: 'open/failed', message: String(error?.message ?? error) }
    }
  }

  const register = (path, label, handler) => {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }), `${name}: ${label}`)
  }

  // ── GET /ctx-menu/capabilities ────────────────────────────────────────
  register(`${PREFIX}/capabilities`, 'GET capabilities', (req, res) => {
    if (rejected(req, res)) return
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET')
    const sc = controller()
    let desktop = null
    if (sc !== undefined && typeof sc.workspaceDesktop === 'function') {
      try {
        desktop = sc.workspaceDesktop()
      } catch (error) {
        log('workspaceDesktop threw:', error?.message ?? error)
      }
    }
    sendJson(res, 200, { ok: true, canOpen: canOpen(), desktop })
  })

  // ── GET /ctx-menu/apps?path=<abs> ─────────────────────────────────────
  register(`${PREFIX}/apps`, 'GET apps', async (req, res) => {
    if (rejected(req, res)) return
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET')
    const path = toNativePath(urlOf(req).searchParams.get('path') ?? '')
    if (!isAbsolute(path)) return sendJson(res, 400, { ok: false, code: 'path/not-absolute' })
    const sc = controller()
    if (sc === undefined || typeof sc.workspacePathApplications !== 'function') {
      return sendJson(res, 200, { ok: true, canOpen: false, apps: [], code: 'host/unsupported' })
    }
    if (!canOpen()) return sendJson(res, 200, { ok: true, canOpen: false, apps: [] })
    let officialApps = []
    let hostError
    if (sc !== undefined && typeof sc.workspacePathApplications === 'function') {
      try {
        const raw = await sc.workspacePathApplications({ path }, new AbortController().signal)
        officialApps = Array.isArray(raw) ? raw.map(normalizeApp).filter((entry) => entry !== null) : []
      } catch (error) {
        hostError = String(error?.message ?? error)
        log('workspacePathApplications failed:', hostError)
      }
    }
    if (officialApps.length > 0) {
      return sendJson(res, 200, { ok: true, canOpen: true, apps: officialApps, source: 'host' })
    }
    // 官方拿不到（跨工作区的文件、或服务缺失）→ 自己读注册表枚举
    const fallback = await enumerateApps(path)
    if (fallback !== null && fallback.apps.length > 0) {
      log(`apps: registry fallback for ${path} → ${fallback.apps.length} 项${hostError === undefined ? '' : `（官方错误：${hostError}）`}`)
      return sendJson(res, 200, { ok: true, canOpen: true, apps: fallback.apps, source: 'registry', hostError })
    }
    if (hostError !== undefined) return sendJson(res, 502, { ok: false, code: 'apps/failed', message: hostError })
    sendJson(res, 200, { ok: true, canOpen: true, apps: [], source: 'host' })
  })

  // ── GET /ctx-menu/cwd?sessionId=<id> ──────────────────────────────────
  register(`${PREFIX}/cwd`, 'GET cwd', (req, res) => {
    if (rejected(req, res)) return
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET')
    const sessionId = urlOf(req).searchParams.get('sessionId') ?? ''
    if (sessionId === '') return sendJson(res, 400, { ok: false, code: 'sessionId/missing' })
    const cwd = cwdOf(sessionId)
    if (cwd === null) return sendJson(res, 200, { ok: false, code: 'cwd/unavailable' })
    sendJson(res, 200, { ok: true, cwd })
  })

  // ── GET /ctx-menu/read?path=<abs>&mode=text|bytes ────────────────────
  register(`${PREFIX}/read`, 'GET read', async (req, res) => {
    if (rejected(req, res)) return
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET')
    const params = urlOf(req).searchParams
    const path = toNativePath(params.get('path') ?? '')
    const mode = params.get('mode') === 'bytes' ? 'bytes' : 'text'
    if (!isAbsolute(path)) return sendJson(res, 400, { ok: false, code: 'path/not-absolute' })
    let info
    try {
      info = await stat(path)
    } catch {
      return sendJson(res, 404, { ok: false, code: 'path/missing' })
    }
    if (info.isDirectory()) return sendJson(res, 400, { ok: false, code: 'path/is-directory' })
    if (info.isFile() === false) return sendJson(res, 400, { ok: false, code: 'path/not-file' })
    const cap = mode === 'bytes' ? BYTES_MAX_BYTES : TEXT_MAX_BYTES
    if (info.size > cap) return sendJson(res, 413, { ok: false, code: 'file/too-large' })
    let bytes
    try {
      bytes = await readFile(path)
    } catch (error) {
      return sendJson(res, 500, { ok: false, code: 'file/read-failed', message: String(error?.message ?? error) })
    }
    if (mode === 'bytes') {
      res.statusCode = 200
      res.setHeader('content-type', 'application/octet-stream')
      res.setHeader('content-length', String(bytes.length))
      res.setHeader('cache-control', 'no-store')
      res.end(bytes)
      return
    }
    // NUL 字节基本可断定二进制；与 0.2.0 的 workspace-file/not-text 语义保持一致
    if (bytes.includes(0)) return sendJson(res, 415, { ok: false, code: 'file/not-text' })
    sendJson(res, 200, { ok: true, text: bytes.toString('utf8') })
  })

  // ── POST /ctx-menu/open | /ctx-menu/reveal ───────────────────────────
  const postJson = async (req) => {
    const type = String(req.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase()
    if (type !== 'application/json') return { error: { status: 415, code: 'body/unsupported-media-type' } }
    const text = await readBoundedBody(req)
    if (text === null) return { error: { status: 413, code: 'body/too-large' } }
    try {
      return { body: JSON.parse(text) }
    } catch {
      return { error: { status: 400, code: 'body/invalid-json' } }
    }
  }

  register(`${PREFIX}/open`, 'POST open', async (req, res) => {
    if (rejected(req, res)) return
    if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST')
    const parsed = await postJson(req)
    if (parsed.error !== undefined) {
      return sendJson(res, parsed.error.status, { ok: false, code: parsed.error.code })
    }
    const path = toNativePath(typeof parsed.body?.path === 'string' ? parsed.body.path : '')
    if (!isAbsolute(path)) return sendJson(res, 400, { ok: false, code: 'path/not-absolute' })
    const application = typeof parsed.body?.application === 'string' && parsed.body.application !== '' ? parsed.body.application : undefined
    const result = await invokeOpen(application === undefined ? { path } : { path, application })
    if (result.ok === true) return sendJson(res, 200, { ok: true, source: 'host' })
    // 官方通道失败（跨工作区的文件、沙箱策略拒绝、服务缺失）→ 自己启动
    if (await launchViaRegistry(path, application)) {
      return sendJson(res, 200, { ok: true, source: 'registry' })
    }
    sendJson(res, 502, result)
  })

  register(`${PREFIX}/reveal`, 'POST reveal', async (req, res) => {
    if (rejected(req, res)) return
    if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST')
    const parsed = await postJson(req)
    if (parsed.error !== undefined) {
      return sendJson(res, parsed.error.status, { ok: false, code: parsed.error.code })
    }
    const path = toNativePath(typeof parsed.body?.path === 'string' ? parsed.body.path : '')
    if (!isAbsolute(path)) return sendJson(res, 400, { ok: false, code: 'path/not-absolute' })
    const result = await invokeOpen({ path, action: 'reveal' })
    if (result.ok === true) return sendJson(res, 200, { ok: true, source: 'host' })
    if (revealViaExplorer(path)) return sendJson(res, 200, { ok: true, source: 'explorer' })
    sendJson(res, 502, result)
  })

  log('host routes mounted:', `${PREFIX}/{capabilities,apps,cwd,read,open,reveal}`)
}