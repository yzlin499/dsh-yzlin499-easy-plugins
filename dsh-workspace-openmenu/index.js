// ═══════════════════════════════════════════════════════════════════════════
// dsh-workspace-openmenu — Host 半侧（ESM 模块，由 cordis loader 挂载）
//
// 为 Client 的「打开为」菜单提供工作区应用启动：
//   POST /workspace-open/open -> { sessionId, app } -> { ok, error? }
//
// app ∈ pwsh | cmd | explorer | vscode；目标目录 = 会话工作区根（SessionHeader.cwd）。
//
// 平台策略：
//   · Windows（win32）——与旧版一致：explorer 直接 spawn；
//     pwsh / cmd 经 `cmd /c start` 开独立新窗口；
//     vscode 优先定位 Code.exe，找不到回退 `code` 命令。
//   · WSL（linux + microsoft 内核）——把工作区 Linux 路径经 `wslpath -w`
//     转成 Windows 路径，再走 WSL 互操作启动 Windows 侧应用：
//       explorer.exe 直接开资源管理器；cmd.exe / start 开命令提示符新窗口；
//       pwsh 优先 pwsh.exe（Windows 侧 PowerShell 7）开新窗口，
//       找不到回退 Linux pwsh（终端模拟器）；vscode 优先 Linux `code` CLI
//       （连接 Windows 版 VS Code），找不到回退 Windows Code.exe。
//   · 原生 Linux——explorer → xdg-open；cmd/pwsh → 终端模拟器；vscode → code。
// ═══════════════════════════════════════════════════════════════════════════
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'workspace-open'
export const inject = ['sessions', 'subprocess', 'webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)

const log = (...a) => console.log('[workspace-open]', ...a)
const msg = (e) => String((e && e.message) || e)

const IS_WIN = process.platform === 'win32'

/** WSL 检测：环境变量或 microsoft/WSL 内核标记（仅 Linux 上判真） */
function isWsl() {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true
  try {
    const v = readFileSync('/proc/version', 'utf8').toLowerCase()
    return v.includes('microsoft') || v.includes('wsl')
  } catch {
    return false
  }
}
const IS_WSL = process.platform === 'linux' && isWsl()

// Windows 侧 VS Code 常见安装位置（win32 用；WSL 场景见 CODE_CANDIDATES_WSL）
const CODE_CANDIDATES_WIN = [
  join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
  'C:\\Program Files\\Microsoft VS Code\\Code.exe',
]
// WSL 里经 /mnt/c 访问 Windows 侧 Code.exe 的路径
const CODE_CANDIDATES_WSL = [
  '/mnt/c/Program Files/Microsoft VS Code/Code.exe',
  '/mnt/c/Program Files (x86)/Microsoft VS Code/Code.exe',
]

// 原生 Linux 的终端模拟器候选（按常见程度排序，第一个存在的被采用）
const TERMINALS = [
  { exe: 'gnome-terminal', argv: (s) => ['--', 'bash', '-lc', s] },
  { exe: 'konsole', argv: (s) => ['-e', 'bash', '-lc', s] },
  { exe: 'xfce4-terminal', argv: (s) => ['--', 'bash', '-lc', s] },
  { exe: 'mate-terminal', argv: (s) => ['-e', 'bash', '-lc', s] },
  { exe: 'kitty', argv: (s) => ['-e', 'bash', '-lc', s] },
  { exe: 'wezterm', argv: (s) => ['start', '--', 'bash', '-lc', s] },
  { exe: 'alacritty', argv: (s) => ['-e', 'bash', '-lc', s] },
  { exe: 'tilix', argv: (s) => ['-e', 'bash', '-lc', s] },
  { exe: 'x-terminal-emulator', argv: (s) => ['-e', 'bash', '-lc', s] },
]

export function apply(ctx) {
  /** 会话工作区根：SessionHeader.cwd */
  function sessionCwd(sessionId) {
    try {
      const s = ctx.sessions.get(String(sessionId))
      const cwd = s && s.header && s.header.cwd
      if (cwd) return String(cwd)
    } catch (e) {
      log('session cwd 解析失败:', msg(e))
    }
    return null
  }

  /** 解析 PATH 上的可执行文件（存在性校验 / 取完整路径），失败返回 null */
  async function resolveExe(name) {
    try {
      return await ctx.subprocess.resolveExecutable(name)
    } catch {
      return null
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  /**
   * 启动子进程并做「早期失败」检测：spawn 级失败（找不到可执行文件、互操作
   * 关闭等）会在 `done` 上快速 reject，这里捕获并返回错误；GUI 应用启动后
   * 常驻不退（如终端模拟器），2 秒超时后视为启动成功，不阻塞接口。
   */
  async function spawnFork(argv) {
    let h
    try {
      h = ctx.subprocess.spawn({
        argv,
        cwd: ROOT,
        stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
        graceMs: 10000,
      })
    } catch (e) {
      return { ok: false, error: msg(e) }
    }
    try {
      await Promise.race([h.done, sleep(2000)])
    } catch (e) {
      return { ok: false, error: msg(e) }
    }
    return { ok: true }
  }

  /**
   * Linux 路径 → Windows 路径。优先 `wslpath -w`（覆盖 /home、/mnt 等所有
   * 挂载点，输出 \\wsl.localhost\\... 或 D:\\...），失败回退 /mnt/<盘符> 规则。
   */
  async function toWindowsPath(linuxPath) {
    try {
      const h = ctx.subprocess.spawn({
        argv: ['wslpath', '-w', linuxPath],
        cwd: ROOT,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: 'ignore' },
        graceMs: 5000,
      })
      const out = await h.done
      const t = (h.collected.stdout ? h.collected.stdout.readFrom(0).text : '').trim()
      if (out.exitCode === 0 && t) return t
    } catch (e) {
      log('wslpath 失败:', msg(e))
    }
    const m = /^\/mnt\/([a-zA-Z])(\/.+)?$/.exec(linuxPath)
    if (m) return m[1].toUpperCase() + ':' + ((m[2] || '\\').replace(/\//g, '\\'))
    return null
  }

  /** 原生 Linux：在终端模拟器里打开 shell（bash / pwsh），cwd 定为工作区 */
  async function openLinuxTerminal(shell, workdir) {
    const script = 'cd ' + JSON.stringify(workdir) + ' && exec ' + shell
    for (const t of TERMINALS) {
      const exe = await resolveExe(t.exe)
      if (!exe) continue
      const r = await spawnFork([exe, ...t.argv(script)])
      if (r.ok) return r
    }
    return { ok: false, error: '未找到可用的终端模拟器（gnome-terminal / konsole / kitty 等）' }
  }

  // ── Windows 原生（保持旧行为） ──────────────────────────────────────
  async function launchWin(app, workdir) {
    switch (app) {
      case 'explorer':
        return spawnFork(['explorer.exe', workdir])
      case 'cmd':
        return spawnFork(['cmd.exe', '/d', '/s', '/c', 'start', '""', 'cmd', '/k', 'cd', '/d', workdir])
      case 'pwsh': {
        const pwsh = await resolveExe('pwsh')
        if (!pwsh) return { ok: false, error: '未找到 pwsh（PowerShell 7）' }
        return spawnFork(['cmd.exe', '/d', '/s', '/c', 'start', '""', pwsh, '-NoExit', '-WorkingDirectory', workdir])
      }
      case 'vscode': {
        const code = CODE_CANDIDATES_WIN.find((p) => existsSync(p))
        if (code) return spawnFork([code, workdir])
        const codeCmd = await resolveExe('code')
        if (codeCmd) return spawnFork(['cmd.exe', '/d', '/s', '/c', 'start', '""', codeCmd, workdir])
        return { ok: false, error: '未找到 VS Code（Code.exe 或 code 命令）' }
      }
      default:
        return { ok: false, error: '未知应用: ' + app }
    }
  }

  // ── WSL：转 Windows 路径 + 互操作启动 Windows 侧应用 ────────────────
  async function launchWsl(app, workdir) {
    switch (app) {
      case 'explorer': {
        const win = await toWindowsPath(workdir)
        if (!win) return { ok: false, error: '无法把工作区 Linux 路径转换为 Windows 路径' }
        const exe = await resolveExe('explorer.exe')
        if (!exe) return { ok: false, error: '未找到 explorer.exe——请确认 WSL 互操作已启用' }
        return spawnFork([exe, win])
      }
      case 'cmd': {
        const win = await toWindowsPath(workdir)
        if (!win) return { ok: false, error: '无法把工作区 Linux 路径转换为 Windows 路径' }
        const exe = await resolveExe('cmd.exe')
        if (!exe) return { ok: false, error: '未找到 cmd.exe——请确认 WSL 互操作已启用' }
        // pushd 同时兼容盘符路径与 \\wsl.localhost\\... UNC 路径
        return spawnFork([exe, '/d', '/s', '/c', 'start', '""', 'cmd', '/k', 'pushd', win])
      }
      case 'pwsh': {
        const win = await toWindowsPath(workdir)
        if (!win) return { ok: false, error: '无法把工作区 Linux 路径转换为 Windows 路径' }
        const winPwsh = await resolveExe('pwsh.exe')
        if (winPwsh) {
          const winExe = await toWindowsPath(winPwsh)
          return spawnFork(['cmd.exe', '/d', '/s', '/c', 'start', '""', winExe || 'pwsh.exe', '-NoExit', '-WorkingDirectory', win])
        }
        if (await resolveExe('pwsh')) return openLinuxTerminal('pwsh', workdir)
        return { ok: false, error: '未找到 PowerShell——Windows 侧请安装 PowerShell 7（winget install Microsoft.PowerShell）' }
      }
      case 'vscode': {
        // Linux `code` CLI：连 Windows 版 VS Code，直接吃 Linux 路径，最顺
        const code = await resolveExe('code')
        if (code) return spawnFork([code, workdir])
        const win = await toWindowsPath(workdir)
        if (win) {
          const exe = CODE_CANDIDATES_WSL.find((p) => existsSync(p))
          if (exe) return spawnFork([exe, win])
        }
        return { ok: false, error: '未找到 VS Code——请先在 WSL 里执行一次 `code .`（或安装 Windows 版 VS Code）' }
      }
      default:
        return { ok: false, error: '未知应用: ' + app }
    }
  }

  // ── 原生 Linux（尽力而为） ───────────────────────────────────────────
  async function launchLinux(app, workdir) {
    switch (app) {
      case 'explorer': {
        if (!(await resolveExe('xdg-open'))) return { ok: false, error: '未找到 xdg-open' }
        return spawnFork(['xdg-open', workdir])
      }
      case 'cmd':
        return openLinuxTerminal('bash', workdir)
      case 'pwsh': {
        if (!(await resolveExe('pwsh'))) return { ok: false, error: '未找到 pwsh（请在 Linux 侧安装 PowerShell 7）' }
        return openLinuxTerminal('pwsh', workdir)
      }
      case 'vscode': {
        if (!(await resolveExe('code'))) return { ok: false, error: '未找到 code 命令' }
        return spawnFork(['code', workdir])
      }
      default:
        return { ok: false, error: '未知应用: ' + app }
    }
  }

  async function launch(app, workdir) {
    if (IS_WIN) return launchWin(app, workdir)
    if (IS_WSL) return launchWsl(app, workdir)
    return launchLinux(app, workdir)
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
          log('打开', app, '->', cwd, IS_WSL ? '(WSL)' : IS_WIN ? '(Windows)' : '(Linux)')
          const r = await launch(app, cwd)
          sendJson(res, r.ok ? { ok: true } : { ok: false, error: r.error }, r.ok ? 200 : 400)
          return
        }
        sendJson(res, { ok: false, error: 'not-found' }, 404)
      } catch (e) {
        console.error('[workspace-open] route threw:', e)
        sendJson(res, { ok: false, error: msg(e) }, 500)
      }
    },
  })
}