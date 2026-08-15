// ═══════════════════════════════════════════════════════════════════════════
// dsh-workspace-openmenu — Host 半侧（ESM 模块，由 cordis loader 挂载）
//
// 为 Client 的「打开为」菜单提供工作区应用启动：
//   POST /workspace-open/open -> { sessionId, app } -> { ok, error? }
//
// app ∈ pwsh | cmd | explorer | vscode；目标目录 = 会话工作区根（SessionHeader.cwd）。
// 启动方式（Windows）：
//   · explorer：直接 spawn（自带新窗口）
//   · pwsh / cmd：经 `cmd /c start` 打开独立新窗口（start 强制新建控制台）
//   · vscode：优先定位 Code.exe 直接 spawn（GUI 应用即开即返）；
//     找不到再回退 `code` 命令
// ═══════════════════════════════════════════════════════════════════════════
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'workspace-open'
export const inject = ['sessions', 'subprocess', 'webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)

const log = (...a) => console.log('[workspace-open]', ...a)

// VS Code 常见安装位置（Code.exe 是 GUI exe，可直接 spawn）
const CODE_CANDIDATES = [
  join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
  'C:\\Program Files\\Microsoft VS Code\\Code.exe',
]

export function apply(ctx) {
  /** 会话工作区根：SessionHeader.cwd */
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

  /** 解析 PATH 上的可执行文件（用于存在性校验 / 取完整路径） */
  async function resolveExe(name) {
    try {
      return await ctx.subprocess.resolveExecutable(name)
    } catch {
      return null
    }
  }

  /** 开新窗口类启动：cmd /c start（start 强制新建控制台窗口） */
  function startNewWindow(tokens) {
    ctx.subprocess.spawn({
      argv: ['cmd.exe', '/d', '/s', '/c', 'start', '""', ...tokens],
      cwd: ROOT,
      stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
      graceMs: 10000,
    })
  }

  /** 直接启动可执行文件（GUI / 自带窗口的应用） */
  function spawnDirect(argv) {
    ctx.subprocess.spawn({
      argv,
      cwd: ROOT,
      stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
      graceMs: 10000,
    })
  }

  /** 在工作区路径打开指定应用；返回 { ok, error? } */
  async function launch(app, path) {
    switch (app) {
      case 'explorer': {
        spawnDirect(['explorer.exe', path])
        return { ok: true }
      }
      case 'cmd': {
        startNewWindow(['cmd', '/k', 'cd', '/d', path])
        return { ok: true }
      }
      case 'pwsh': {
        const pwsh = await resolveExe('pwsh')
        if (!pwsh) return { ok: false, error: '未找到 pwsh（PowerShell 7）' }
        startNewWindow([pwsh, '-NoExit', '-WorkingDirectory', path])
        return { ok: true }
      }
      case 'vscode': {
        const code = CODE_CANDIDATES.find((p) => existsSync(p))
        if (code) {
          spawnDirect([code, path])
          return { ok: true }
        }
        const codeCmd = await resolveExe('code')
        if (codeCmd) {
          startNewWindow(['code', path])
          return { ok: true }
        }
        return { ok: false, error: '未找到 VS Code（Code.exe 或 code 命令）' }
      }
      default:
        return { ok: false, error: '未知应用: ' + app }
    }
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

  // ── 注册 /workspace-open/* 路由（随插件卸载自动清理）──
  ctx.webServer.register({
    kind: 'prefix',
    path: '/workspace-open',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost')
        if (url.pathname === '/workspace-open/open' && req.method === 'POST') {
          const a = await readBody(req)
          const sessionId = String(a.sessionId || '')
          const app = String(a.app || '')
          if (!sessionId || !app) {
            sendJson(res, { ok: false, error: '缺少 sessionId 或 app' }, 400)
            return
          }
          const cwd = sessionCwd(sessionId)
          if (!cwd) {
            sendJson(res, { ok: false, error: '会话没有关联的工作区路径（请在某个工作区会话中操作）' }, 400)
            return
          }
          log('打开', app, '->', cwd)
          const r = await launch(app, cwd)
          sendJson(res, r.ok ? { ok: true } : { ok: false, error: r.error }, r.ok ? 200 : 400)
          return
        }
        sendJson(res, { ok: false, error: 'not-found' }, 404)
      } catch (e) {
        console.error('[workspace-open] route threw:', e)
        sendJson(res, { ok: false, error: String((e && e.message) || e) }, 500)
      }
    },
  })
}
