// ═══════════════════════════════════════════════════════════════════════════
// dsh-quick-file — Host 半侧（ESM 模块，由 cordis loader 挂载）
//
// 为 Client 的 `@` 文件输入源提供文件列表：
//   GET /quick-file/files?session=<sessionId>&q=<query>
//   GET/POST /quick-file/config（深度/数量上限 / Everything HTTP 地址）
//
// 两种搜索后端：
//   1) 默认：递归扫描会话工作区（深度/忽略/数量受限）
//   2) 配置 everythingUrl 后：走 Everything HTTP Server 搜索
//      （Everything 已索引全盘，比逐目录遍历更快）
//
// 配置经官方 settings 服务持久化（命名空间 dsh-quick-file，schemastery schema
// 由 ctx.loader.import 从应用侧解析）；settings 不可用时回退内存态。
// ═══════════════════════════════════════════════════════════════════════════
import { join, relative, sep } from 'node:path'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

export const name = 'quick-file'
export const inject = ['fs', 'sessions', 'webServer', 'loader', 'settings']

const log = (...a) => console.log('[quick-file]', ...a)

const NS = 'dsh-quick-file'
// 忽略目录可配置：逗号分隔字符串，默认值如下；留空 = 不忽略任何目录
const DEFAULT_IGNORE = 'node_modules,.git,dist,build,coverage,.next,.cache,__pycache__,.venv,venv,target,.dsh'
const DEFAULTS = { depth: 3, max: 50, everythingUrl: '', ignoreDirs: DEFAULT_IGNORE }

/** 解析 ignoreDirs 配置（逗号分隔，去空白，去空项）为 Set */
function parseIgnoreDirs(raw) {
  const set = new Set()
  if (typeof raw === 'string') {
    for (const part of raw.split(',')) {
      const name = part.trim()
      if (name) set.add(name)
    }
  }
  return set
}

/** 简易 HTTP GET + JSON 解析（Everything HTTP Server 返回 {totalResults, results}） */
function httpGetJson(href, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(href) } catch (e) { reject(e); return }
    const request = u.protocol === 'https:' ? httpsRequest : httpRequest
    const req = request(u, { method: 'GET' }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(new Error('响应不是合法 JSON: ' + String(e.message || e))) }
      })
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('HTTP 请求超时')) })
    req.end()
  })
}

export async function apply(ctx) {
  // ── 持久化设置：注册命名空间（schemastery schema 经 loader 拉取）──
  let scope = null
  let memConfig = { ...DEFAULTS }
  try {
    const mod = await ctx.loader.import('@deepseek-ai/schemastery')
    const z = mod && mod.default ? mod.default : mod
    scope = ctx.settings.register(NS, z.object({
      depth: z.natural().min(1).max(10),
      max: z.natural().min(10).max(200),
      everythingUrl: z.string().default(''),
      ignoreDirs: z.string().default(DEFAULT_IGNORE),
    }))
  } catch (e) {
    log('settings 注册失败，回退内存态:', String((e && e.message) || e))
  }

  const readConfig = () => {
    if (scope) {
      try {
        const v = scope.get()
        if (v) {
          return {
            depth: Number.isInteger(v.depth) ? v.depth : DEFAULTS.depth,
            max: Number.isInteger(v.max) ? v.max : DEFAULTS.max,
            everythingUrl: typeof v.everythingUrl === 'string' ? v.everythingUrl : DEFAULTS.everythingUrl,
            ignoreDirs: typeof v.ignoreDirs === 'string' ? v.ignoreDirs : DEFAULTS.ignoreDirs,
          }
        }
      } catch {}
    }
    return { ...memConfig }
  }

  /** 会话工作区根：SessionHeader.cwd（取不到返回 null） */
  function sessionCwd(sessionId) {
    try {
      const s = ctx.sessions.get(String(sessionId))
      const cwd = s && s.header && s.header.cwd
      if (cwd) return String(cwd)
    } catch (e) {
      log('session cwd 解析失败:', String((e && e.message) || e))
    }
    return null
  }

  /** 从根目录递归收集文件（深度/忽略/数量受限），返回相对路径（`/` 分隔） */
  async function collectFiles(root) {
    const cfg = readConfig()
    const ignore = parseIgnoreDirs(cfg.ignoreDirs)
    const out = []
    const walk = async (dir, depth) => {
      if (depth > cfg.depth || out.length >= cfg.max) return
      let entries
      try {
        const target = await ctx.fs.resolve(dir)
        entries = await ctx.fs.listDir(target)
      } catch {
        return
      }
      for (const entry of entries) {
        if (out.length >= cfg.max) return
        const isDir = entry.type === 'directory'
        if (isDir && ignore.has(entry.name)) continue
        const abs = join(dir, entry.name)
        const rel = relative(root, abs).split(sep).join('/')
        out.push({ path: rel, name: entry.name, isDir })
        if (isDir) await walk(abs, depth + 1)
      }
    }
    await walk(root, 1)
    return out
  }

  /**
   * 走 Everything HTTP Server 搜索（配置了 everythingUrl 且 q 非空时使用）。
   * 返回与 collectFiles 相同形状的列表（相对路径，`/` 分隔），失败回退 null。
   * API（voidtools HTTP Server）：?search=<Everything 语法>&count=N&j=1&path_column=1
   *   → { totalResults, results: [{ type: 'file'|'folder', name, path }] }
   *
   * 忽略目录遵循 ignoreDirs 配置（默认含 node_modules/.git 等；用户可改/清空，
   * 清空 = 不忽略任何目录，Everything 全索引结果都可搜到）。
   */
  async function collectViaEverything(root, q) {
    const cfg = readConfig()
    const base = String(cfg.everythingUrl || '').trim().replace(/\/+$/, '')
    if (!base || !q) return null
    const ignore = parseIgnoreDirs(cfg.ignoreDirs)
    // 构造 Everything 搜索词：`path:<cwd>` 限定工作区 + `!<dir>\` 排除忽略目录
    const terms = [q, 'path:' + root]
    for (const d of ignore) terms.push('!' + d + '\\')
    const search = terms.join(' ')
    // count 取 max 的 3 倍余量，过滤后仍够用
    const count = Math.min(Math.max(cfg.max * 3, 50), 200)
    const href = base + '/?search=' + encodeURIComponent(search) + '&count=' + count + '&j=1&path_column=1&sort=path&ascending=1'
    let data
    try {
      data = await httpGetJson(href)
    } catch (e) {
      log('Everything 请求失败，回退递归扫描:', String((e && e.message) || e))
      return null
    }
    const results = Array.isArray(data && data.results) ? data.results : []
    const out = []
    for (const r of results) {
      if (!r || typeof r.path !== 'string' || typeof r.name !== 'string') continue
      // path 是绝对目录，拼接文件名后转相对路径
      const abs = join(r.path, r.name)
      const rel = relative(root, abs).split(sep).join('/')
      // 过滤掉工作区外的结果（path: 是子串匹配，可能带出邻近路径）
      if (rel.startsWith('..')) continue
      // 双保险：忽略目录（Everything 语法已排除，这里再兜底）
      const first = rel.split('/')[0]
      if (first && ignore.has(first)) continue
      out.push({ path: rel, name: r.name, isDir: r.type === 'folder' })
      if (out.length >= cfg.max) break
    }
    return out
  }

  const sendJson = (res, obj, status = 200) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(obj))
  }
  const readBody = (req) => new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => { data += c })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) } catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })

  // ── 注册 /quick-file/* 路由（随插件卸载自动清理）──
  ctx.webServer.register({
    kind: 'prefix',
    path: '/quick-file',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost')
        if (url.pathname === '/quick-file/files' && req.method === 'GET') {
          const sessionId = url.searchParams.get('session') || ''
          const q = (url.searchParams.get('q') || '').trim().toLowerCase()
          const cwd = sessionCwd(sessionId)
          if (!cwd) {
            sendJson(res, { files: [] })
            return
          }
          // 配置了 Everything 时优先用它搜索；失败或未配置回退递归扫描
          let files = await collectViaEverything(cwd, q)
          if (!files) {
            files = await collectFiles(cwd)
            if (q) {
              files = files.filter(
                (f) => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q),
              )
            }
          }
          sendJson(res, { files: files.slice(0, readConfig().max) })
          return
        }
        if (url.pathname === '/quick-file/config' && req.method === 'GET') {
          sendJson(res, readConfig())
          return
        }
        if (url.pathname === '/quick-file/config' && req.method === 'POST') {
          const a = await readBody(req)
          const patch = {}
          if (a.depth != null) {
            const d = Number(a.depth)
            if (!Number.isInteger(d) || d < 1 || d > 10) {
              sendJson(res, { ok: false, error: 'depth 需为 1-10 的整数' }, 400)
              return
            }
            patch.depth = d
          }
          if (a.max != null) {
            const m = Number(a.max)
            if (!Number.isInteger(m) || m < 10 || m > 200) {
              sendJson(res, { ok: false, error: 'max 需为 10-200 的整数' }, 400)
              return
            }
            patch.max = m
          }
          if (a.everythingUrl !== undefined) {
            const u = String(a.everythingUrl).trim()
            if (u) {
              try {
                const parsed = new URL(u)
                if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('bad protocol')
              } catch {
                sendJson(res, { ok: false, error: 'everythingUrl 需为 http(s)://host[:port] 形式，留空则用递归扫描' }, 400)
                return
              }
            }
            patch.everythingUrl = u
          }
          if (a.ignoreDirs !== undefined) {
            // 逗号分隔目录名；允许留空（不忽略任何目录）
            const list = String(a.ignoreDirs).split(',').map((s) => s.trim()).filter(Boolean)
            if (list.some((name) => !/^[A-Za-z0-9._-]+$/.test(name))) {
              sendJson(res, { ok: false, error: 'ignoreDirs 需为逗号分隔的目录名（字母/数字/._-），留空 = 不忽略' }, 400)
              return
            }
            patch.ignoreDirs = list.join(',')
          }
          try {
            if (scope) await scope.update(patch)
            else Object.assign(memConfig, patch)
            log('config ->', JSON.stringify(readConfig()))
            sendJson(res, { ok: true, ...readConfig() })
          } catch (e) {
            log('config 保存失败:', String((e && e.message) || e))
            sendJson(res, { ok: false, error: '保存失败: ' + String((e && e.message) || e) }, 500)
          }
          return
        }
        sendJson(res, { ok: false, error: 'not-found' }, 404)
      } catch (e) {
        console.error('[quick-file] route threw:', e)
        sendJson(res, { ok: false, error: String((e && e.message) || e) }, 500)
      }
    },
  })
}
