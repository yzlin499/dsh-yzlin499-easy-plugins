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

const MAX_DEPTH = 3
const MAX_FILES = 50
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
      if (depth > MAX_DEPTH || out.length >= MAX_FILES) return
      let entries
      try {
        const target = await ctx.fs.resolve(dir)
        entries = await ctx.fs.listDir(target)
      } catch {
        return
      }
      for (const entry of entries) {
        if (out.length >= MAX_FILES) return
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
          sendJson(res, { files: files.slice(0, MAX_FILES) })
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
