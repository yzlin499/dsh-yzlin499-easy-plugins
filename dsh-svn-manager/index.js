import * as svn from './svn.js'

export const name = 'dsh-svn-manager'
export const inject = ['webServer', 'sessions', 'webRuntime', 'settings', 'loader']

const API_PREFIX = '/svn-manager/api'
const CONFIG_PREFIX = '/svn-manager/config'
const MAX_BODY_BYTES = 1024 * 1024
const NS = 'dsh-svn-manager'

class ApiError extends Error {
  constructor(message, code = 'bad-request', status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

function header(headers, name) {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function parseAuthority(authority) {
  try { return new URL(`http://${authority}`) } catch { return undefined }
}

function isLoopback(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function trustedRequest(req, trustedHosts) {
  const host = header(req.headers, 'host')
  if (!host) return false
  const hostUrl = parseAuthority(host)
  if (!hostUrl) return false
  const trusted = isLoopback(hostUrl.hostname) || trustedHosts.some((entry) => {
    const parsed = parseAuthority(entry)
    if (!parsed) return false
    return parsed.port ? parsed.host === hostUrl.host : parsed.hostname === hostUrl.hostname
  })
  if (!trusted || header(req.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(req.headers, 'origin')
  if (!origin) return true
  try { return new URL(origin).host === hostUrl.host } catch { return false }
}

async function readJson(req) {
  let total = 0
  const chunks = []
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new ApiError('Request body is too large', 'bad-request', 413)
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try { return JSON.parse(text) } catch { throw new ApiError('Request body is not valid JSON') }
}

function writeJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function writeError(res, error) {
  if (error instanceof ApiError || error instanceof svn.SvnCommandError) {
    writeJson(res, error.status ?? 400, { ok: false, error: { code: error.code ?? 'bad-request', message: error.message } })
    return
  }
  console.error('[dsh-svn-manager] API error:', error)
  writeJson(res, 500, { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } })
}

function requireString(record, key) {
  const value = record?.[key]
  if (typeof value !== 'string' || value.trim() === '') throw new ApiError(`Invalid "${key}"`)
  return value
}

function optionalString(record, key) {
  const value = record?.[key]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new ApiError(`Invalid "${key}"`)
  return value
}

function sessionCwd(ctx, payload) {
  const sessionId = requireString(payload, 'sessionId')
  const session = ctx.sessions.get(sessionId)
  const cwd = session?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '') throw new ApiError('Session has no working directory', 'session-unavailable', 404)
  return cwd
}

function requireConfirm(payload, action) {
  if (payload?.confirm !== true) throw new ApiError(`${action} requires confirm: true`, 'confirm-required', 400)
}

function requirePaths(payload) {
  if (!Array.isArray(payload?.paths)) throw new ApiError('Invalid "paths"')
  return payload.paths
}

function buildApi(ctx, runtime, readConfig) {
  const serialMutation = async (cwd, work) => {
    const info = await svn.workingCopyInfo(cwd, { signal: runtime.signal, svnExecutable: readConfig().svnExecutable })
    if (!info.isWorkingCopy || !info.wcRoot) {
      throw new svn.SvnCommandError('The session workspace is not an SVN working copy', 'not-working-copy', '', 400)
    }
    const key = process.platform === 'win32' ? info.wcRoot.toLowerCase() : info.wcRoot
    const previous = runtime.locks.get(key) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(work)
    runtime.locks.set(key, current)
    try {
      return await current
    } finally {
      if (runtime.locks.get(key) === current) runtime.locks.delete(key)
    }
  }
  return {
    status: (payload) => svn.status(sessionCwd(ctx, payload), {
      showUpdates: payload?.showUpdates === true,
      signal: runtime.signal,
      svnExecutable: readConfig().svnExecutable,
    }),
    diff: (payload) => svn.diff(sessionCwd(ctx, payload), {
      path: optionalString(payload, 'path'),
      revision: optionalString(payload, 'revision'),
      signal: runtime.signal,
      svnExecutable: readConfig().svnExecutable,
    }),
    log: (payload) => {
      const rawLimit = payload?.limit
      if (rawLimit !== undefined && (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100)) {
        throw new ApiError('Invalid "limit"')
      }
      return svn.log(sessionCwd(ctx, payload), {
        limit: rawLimit,
        startRevision: optionalString(payload, 'startRevision'),
        signal: runtime.signal,
        svnExecutable: readConfig().svnExecutable,
      })
    },
    add: async (payload) => {
      requireConfirm(payload, 'SVN add')
      const cwd = sessionCwd(ctx, payload)
      return serialMutation(cwd, () => svn.add(cwd, requirePaths(payload), { signal: runtime.signal, svnExecutable: readConfig().svnExecutable }))
    },
    revert: async (payload) => {
      requireConfirm(payload, 'SVN revert')
      const cwd = sessionCwd(ctx, payload)
      return serialMutation(cwd, () => svn.revert(cwd, requirePaths(payload), { signal: runtime.signal, svnExecutable: readConfig().svnExecutable }))
    },
    commit: async (payload) => {
      requireConfirm(payload, 'SVN commit')
      const cwd = sessionCwd(ctx, payload)
      return serialMutation(cwd, () => svn.commit(cwd, requireString(payload, 'message'), { signal: runtime.signal, svnExecutable: readConfig().svnExecutable }))
    },
    update: async (payload) => {
      requireConfirm(payload, 'SVN update')
      const cwd = sessionCwd(ctx, payload)
      return serialMutation(cwd, () => svn.update(cwd, { signal: runtime.signal, svnExecutable: readConfig().svnExecutable }))
    },
  }
}

export async function apply(ctx) {
  const controller = new AbortController()
  const runtime = { signal: controller.signal, locks: new Map() }
  ctx.effect(() => () => controller.abort(), 'dsh-svn-manager: cancel active SVN commands')

  // ── 持久化设置：命名空间 dsh-svn-manager，svnExecutable 留空 = 自动检测 ──
  let scope = null
  const memConfig = { svnExecutable: '' }
  const readConfig = () => {
    if (scope) {
      try {
        const value = scope.get()
        if (value && typeof value.svnExecutable === 'string') return { svnExecutable: value.svnExecutable }
      } catch {}
    }
    return { ...memConfig }
  }
  const initSettings = async () => {
    try {
      const mod = await ctx.loader.import('@deepseek-ai/schemastery')
      const z = mod && mod.default ? mod.default : mod
      scope = ctx.settings.register(NS, z.object({ svnExecutable: z.string().default('') }))
    } catch (error) {
      console.log('[dsh-svn-manager] settings 注册失败，回退内存态:', String((error && error.message) || error))
    }
  }

  const methods = buildApi(ctx, runtime, readConfig)

  const configHandler = async (req, res) => {
    if (!trustedRequest(req, ctx.webRuntime.trustedHosts ?? [])) {
      writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'Forbidden' } })
      return
    }
    try {
      const cfg = readConfig()
      if (req.method === 'GET') {
        const detected = await svn.resolveSvnExecutable(cfg.svnExecutable)
        writeJson(res, 200, {
          ok: true,
          svnExecutable: cfg.svnExecutable,
          detected: detected || null,
          backend: detected ? (/\.exe$/i.test(detected) ? 'windows' : 'linux') : null,
          platform: process.platform,
        })
        return
      }
      if (req.method !== 'POST') throw new ApiError('Method not allowed', 'method-error', 405)
      const contentType = header(req.headers, 'content-type') ?? ''
      if (!contentType.toLowerCase().startsWith('application/json')) {
        throw new ApiError('Unsupported media type', 'method-error', 415)
      }
      const body = await readJson(req)
      const next = typeof body?.svnExecutable === 'string' ? body.svnExecutable.trim() : ''
      if (next.length > 260 || /[\u0000-\u001f\u007f]/.test(next)) {
        throw new ApiError('Invalid "svnExecutable"')
      }
      try {
        if (scope) await scope.update({ svnExecutable: next })
        else Object.assign(memConfig, { svnExecutable: next })
      } catch (error) {
        console.log('[dsh-svn-manager] config 保存失败:', String((error && error.message) || error))
        throw new ApiError('Failed to save configuration', 'config-error', 500)
      }
      svn.resetSvnExecutableResolution()
      const detected = await svn.resolveSvnExecutable(next)
      console.log('[dsh-svn-manager] svnExecutable ->', next || '(auto)', 'detected:', detected || '(none)')
      writeJson(res, 200, {
        ok: true,
        svnExecutable: next,
        detected: detected || null,
        backend: detected ? (/\.exe$/i.test(detected) ? 'windows' : 'linux') : null,
        platform: process.platform,
      })
    } catch (error) {
      writeError(res, error)
    }
  }

  ctx.effect(() => {
    const disposers = []
    const registerApi = {
      kind: 'prefix',
      path: API_PREFIX,
      handler: async (req, res) => {
        if (!trustedRequest(req, ctx.webRuntime.trustedHosts ?? [])) {
          writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'Forbidden' } })
          return
        }
        try {
          if (req.method !== 'POST') throw new ApiError('Method not allowed', 'method-error', 405)
          const contentType = header(req.headers, 'content-type') ?? ''
          if (!contentType.toLowerCase().startsWith('application/json')) {
            throw new ApiError('Unsupported media type', 'method-error', 415)
          }
          const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
          const method = pathname.startsWith(`${API_PREFIX}/`) ? pathname.slice(`${API_PREFIX}/`.length) : ''
          if (!method || method.includes('/') || typeof methods[method] !== 'function') {
            throw new ApiError('Unknown SVN API method', 'not-found', 404)
          }
          const payload = await readJson(req)
          const value = await methods[method](payload)
          writeJson(res, 200, { ok: true, value })
        } catch (error) {
          writeError(res, error)
        }
      },
    }
    disposers.push(ctx.webServer.register(registerApi))
    disposers.push(ctx.webServer.register({ kind: 'prefix', path: CONFIG_PREFIX, handler: configHandler }))
    return () => { for (const off of disposers) { try { off?.() } catch {} } }
  }, 'dsh-svn-manager: /svn-manager/api and /svn-manager/config routes')

  void initSettings()
}
