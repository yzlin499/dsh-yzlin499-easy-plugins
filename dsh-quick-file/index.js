// ═══════════════════════════════════════════════════════════════════════════
// dsh-quick-file — Host 半侧（ESM 模块，由 cordis loader 挂载）
//
// 为 Client 的 `@` 文件输入源提供文件列表：
//   GET /quick-file/files?session=<sessionId>&q=<query>
//   -> { files: [{ path, name, isDir }] }
//
// 根目录 = 会话工作区根（SessionHeader.cwd）；用 fs 服务抽象列目录。
// 深度上限 + 忽略目录 + 数量上限，避免大仓库卡顿；路径统一用 `/` 分隔。
// ═══════════════════════════════════════════════════════════════════════════
import { join, relative, sep } from 'node:path'

export const name = 'quick-file'
export const inject = ['fs', 'sessions', 'webServer']

const log = (...a) => console.log('[quick-file]', ...a)

// 内存态配置（设置卡片可改，重启恢复默认）
let config = { depth: 3, max: 50 }
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next',
  '.cache', '__pycache__', '.venv', 'venv', 'target', '.dsh',
])

export function apply(ctx) {
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
    const out = []
    const walk = async (dir, depth) => {
      if (depth > config.depth || out.length >= config.max) return
      let entries
      try {
        const target = await ctx.fs.resolve(dir)
        entries = await ctx.fs.listDir(target)
      } catch {
        return
      }
      for (const entry of entries) {
        if (out.length >= config.max) return
        const isDir = entry.type === 'directory'
        if (isDir && IGNORE_DIRS.has(entry.name)) continue
        const abs = join(dir, entry.name)
        const rel = relative(root, abs).split(sep).join('/')
        out.push({ path: rel, name: entry.name, isDir })
        if (isDir) await walk(abs, depth + 1)
      }
    }
    await walk(root, 1)
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
          let files = await collectFiles(cwd)
          if (q) {
            files = files.filter(
              (f) => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q),
            )
          }
          sendJson(res, { files: files.slice(0, config.max) })
          return
        }
        if (url.pathname === '/quick-file/config' && req.method === 'GET') {
          sendJson(res, { depth: config.depth, max: config.max })
          return
        }
        if (url.pathname === '/quick-file/config' && req.method === 'POST') {
          const a = await readBody(req)
          if (a.depth != null) {
            const d = Number(a.depth)
            if (!Number.isInteger(d) || d < 1 || d > 10) {
              sendJson(res, { ok: false, error: 'depth 需为 1-10 的整数' }, 400)
              return
            }
            config.depth = d
          }
          if (a.max != null) {
            const m = Number(a.max)
            if (!Number.isInteger(m) || m < 10 || m > 200) {
              sendJson(res, { ok: false, error: 'max 需为 10-200 的整数' }, 400)
              return
            }
            config.max = m
          }
          log('config ->', JSON.stringify(config))
          sendJson(res, { ok: true, depth: config.depth, max: config.max })
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
