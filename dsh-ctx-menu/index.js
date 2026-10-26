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
// 启动与定位一律交给 sessionController（它内部会再做一次 verifyDesktopPath）。

import { readFile, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

export const name = 'dsh-ctx-menu'
export const inject = ['webServer']

const PREFIX = '/ctx-menu'
const TEXT_MAX_BYTES = 2 * 1024 * 1024
const BYTES_MAX_BYTES = 32 * 1024 * 1024
const MAX_BODY_BYTES = 64 * 1024

const log = (...args) => console.log('[dsh-ctx-menu]', ...args)

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
    const path = urlOf(req).searchParams.get('path') ?? ''
    if (!isAbsolute(path)) return sendJson(res, 400, { ok: false, code: 'path/not-absolute' })
    const sc = controller()
    if (sc === undefined || typeof sc.workspacePathApplications !== 'function') {
      return sendJson(res, 200, { ok: true, canOpen: false, apps: [], code: 'host/unsupported' })
    }
    if (!canOpen()) return sendJson(res, 200, { ok: true, canOpen: false, apps: [] })
    try {
      const raw = await sc.workspacePathApplications({ path }, new AbortController().signal)
      const apps = Array.isArray(raw) ? raw.map(normalizeApp).filter((entry) => entry !== null) : []
      sendJson(res, 200, { ok: true, canOpen: true, apps })
    } catch (error) {
      log('workspacePathApplications failed:', error?.message ?? error)
      sendJson(res, 502, { ok: false, code: 'apps/failed', message: String(error?.message ?? error) })
    }
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
    const path = params.get('path') ?? ''
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
    const path = typeof parsed.body?.path === 'string' ? parsed.body.path : ''
    if (!isAbsolute(path)) return sendJson(res, 400, { ok: false, code: 'path/not-absolute' })
    const application = typeof parsed.body?.application === 'string' && parsed.body.application !== '' ? parsed.body.application : undefined
    const result = await invokeOpen(application === undefined ? { path } : { path, application })
    sendJson(res, result.ok ? 200 : 502, result)
  })

  register(`${PREFIX}/reveal`, 'POST reveal', async (req, res) => {
    if (rejected(req, res)) return
    if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST')
    const parsed = await postJson(req)
    if (parsed.error !== undefined) {
      return sendJson(res, parsed.error.status, { ok: false, code: parsed.error.code })
    }
    const path = typeof parsed.body?.path === 'string' ? parsed.body.path : ''
    if (!isAbsolute(path)) return sendJson(res, 400, { ok: false, code: 'path/not-absolute' })
    const result = await invokeOpen({ path, action: 'reveal' })
    sendJson(res, result.ok ? 200 : 502, result)
  })

  log('host routes mounted:', `${PREFIX}/{capabilities,apps,cwd,read,open,reveal}`)
}