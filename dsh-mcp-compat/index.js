// ═══════════════════════════════════════════════════════════════════════════
// dsh-mcp-compat — Host 半侧（ESM 模块，由 cordis loader 挂载）
//
// 自动读取各主流 Agent 的 MCP 配置，把每个 MCP 服务器挂载为一个
// dsh-mcp-client 实例（复用官方 MCP SDK：会话、重连、工具注册、命名）。
//
// 支持的配置来源（按优先级，先出现者胜）：
//   项目级（每个 workspace 根目录）：
//     .mcp.json             —— Claude Code / Codex / Cursor 约定（mcpServers）
//     opencode.json/.jsonc  —— opencode 约定（mcp 键，command 数组 / url）
//     .cursor/mcp.json      —— Cursor 约定（同 mcpServers）
//     .codex/config.toml    —— Codex 约定（[mcp_servers.<name>]）
//   用户级（$HOME）：
//     ~/.mcp.json  ~/.codex/config.toml  ~/.config/opencode/opencode.json
//
// 变更时自动重扫：配置文件 fs.watch + 新会话事件（session/created）触发。
// ═══════════════════════════════════════════════════════════════════════════
import { existsSync, readFileSync, watch } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { connect as tcpConnect, createServer as createTcpServer } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'

const execFileP = promisify(execFile)

export const name = 'mcp-compat'
// loader：经 loader 自己的解析拿 dsh-mcp-client（bundle 源目录在项目里，
// 顶层裸 import '@deepseek-ai/dsh-mcp-client' 会按源目录解析失败）
export const inject = ['workspaceRegistry', 'loader', 'tools', 'agents', 'commands', 'settings', 'webServer']

const log = (...a) => console.log('[mcp-compat]', ...a)
const reportedInvalidCommands = new Set()

// ── WSL 宿主机兼容 ──────────────────────────────────────────────────────────
// WSL2 默认是 NAT 网络：WSL 里的 localhost / 127.0.0.1 指向 WSL 自身，连不到
// Windows 宿主机上跑的 MCP 服务（例如 UE 的 MCP、JetBrains IDE 的 MCP）。
// 检测到 WSL 且某 Streamable HTTP 服务器的 loopback 地址连接失败时（看门狗
// 发现工具消失、或手动重连）：
//   1. 首选「同端口透明 TCP 隧道」：在 WSL 里监听与原始 URL 相同的 loopback
//      端口，把字节原样转发到宿主机 IP:端口。客户端仍用原始 URL，Host 头自然
//      是 127.0.0.1 —— 兼容 JetBrains 等「只认本机 Host」的服务；
//   2. 隧道不可用（WSL 端口被占）时退回「URL 改写」：把 host 改写为宿主机 IP。
// WSL1 / 镜像网络下 loopback 本来就能用，因此只在失败后兜底，不影响正常连接。
let _wslChecked = false
let _wslHostIp = null
// WSL 检测：环境变量或 microsoft/WSL 内核标记（仅 Linux 上判真），与
// dsh-workspace-openmenu 保持一致
function isWsl() {
  if (process.platform !== 'linux') return false
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true
  try {
    const v = readFileSync('/proc/version', 'utf8').toLowerCase()
    if (v.includes('microsoft') || v.includes('wsl')) return true
    if (existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')) return true
  } catch {}
  return false
}
// 解析 Windows 宿主机 IP（结果缓存）。优先级：
//   1. WSL_HOST_IP 环境变量（用户显式指定，最可靠）
//   2. /etc/resolv.conf 第一个 nameserver（WSL2 默认即宿主机）
//   3. /proc/net/route 默认网关（WSL2 NAT 下的宿主机虚拟网卡地址）
function getWslHostIp() {
  if (_wslChecked) return _wslHostIp
  _wslChecked = true
  if (!isWsl()) return (_wslHostIp = null)
  if (process.env.WSL_HOST_IP) return (_wslHostIp = process.env.WSL_HOST_IP.trim() || null)
  try {
    const resolv = readFileSync('/etc/resolv.conf', 'utf8')
    const m = /^\s*nameserver\s+([0-9a-fA-F:.]+)/m.exec(resolv)
    if (m) return (_wslHostIp = m[1])
  } catch {}
  try {
    const route = readFileSync('/proc/net/route', 'utf8')
    for (const line of route.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 3 && parts[1] === '00000000' && /^[0-9a-fA-F]{8}$/.test(parts[2])) {
        const gw = parts[2]
        // /proc/net/route 是 4 字节小端十六进制，逐字节反转成点分十进制
        return (_wslHostIp = [3, 2, 1, 0].map((i) => parseInt(gw.slice(i * 2, i * 2 + 2), 16)).join('.'))
      }
    }
  } catch {}
  return (_wslHostIp = null)
}
// 若 url 指向 loopback（localhost / 127.0.0.1 / ::1 / 0.0.0.0）且处于 WSL，
// 返回改写为宿主机 IP 的 URL（原样保留端口、路径、查询、哈希）；否则返回 null。
function wslFallbackUrl(input) {
  const hostIp = getWslHostIp()
  if (!hostIp || typeof input !== 'string' || !input) return null
  let u
  try {
    u = new URL(input)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '0.0.0.0') return null
  const prefix = `${u.protocol}//`
  if (!input.startsWith(prefix)) return null
  const rest = input.slice(prefix.length)
  const end = rest.search(/[/?#]|$/)
  const suffix = end < 0 ? '' : rest.slice(end)
  const hostPart = host.includes(':') ? `[${hostIp}]` : hostIp
  const authority = hostPart + (u.port ? `:${u.port}` : '')
  return prefix + authority + suffix
}
// 隧道目标：仅当处于 WSL 且 url host 是 loopback 时，返回
// { host: 宿主机IP, port, bindHost: WSL 侧监听地址 }；否则返回 null。
function wslTunnelTarget(input) {
  const hostIp = getWslHostIp()
  if (!hostIp || typeof input !== 'string' || !input) return null
  let u
  try {
    u = new URL(input)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '0.0.0.0') return null
  return {
    host: hostIp,
    port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80),
    // [::1] 原始地址只绑 WSL 的 IPv6 回环；localhost 绑双栈回环（IPv4+IPv6 都能接）
    bindHost: host === '::1' ? '::1' : host === 'localhost' ? undefined : '127.0.0.1',
  }
}
// 对目标 URL 做一次短超时 TCP 探测（1.5s），用于区分「服务没开 / 防火墙拦截」
// 与「服务只监听 Windows 本机回环、宿主机网卡上无监听」，给 WSL 兼容失败提示补诊断。
const probeTcp = (url) => new Promise((resolve) => {
  let u
  try {
    u = new URL(url)
  } catch {
    resolve('URL 解析失败')
    return
  }
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80)
  const socket = tcpConnect({ host, port, timeout: 1500 })
  let settled = false
  const done = (msg) => {
    if (settled) return
    settled = true
    socket.destroy()
    resolve(msg)
  }
  socket.once('connect', () => done('TCP 可达'))
  socket.once('timeout', () => done('TCP 超时（可能被防火墙拦截）'))
  socket.once('error', (e) => done(`TCP 连接失败（${e.code || e.message}）`))
})
// 对目标 URL 做一次最小 MCP initialize POST（3s 超时），返回 HTTP 状态 + 响应头片段。
// 用于识别「TCP 通了但 HTTP 层拒绝（如 JetBrains 只认 127.0.0.1 Host → 403）」。
const probeHttp = (url) => new Promise((resolve) => {
  let u
  try {
    u = new URL(url)
  } catch {
    resolve('URL 解析失败')
    return
  }
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80)
  const body = JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'dsh-mcp-compat-probe', version: '1' } },
  })
  const lib = u.protocol === 'https:' ? httpsRequest : httpRequest
  const req = lib({
    hostname: host,
    port,
    path: u.pathname + u.search,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'content-length': Buffer.byteLength(body),
      connection: 'close',
    },
    timeout: 3000,
  }, (res) => {
    let data = ''
    res.on('data', (c) => { if (data.length < 120) data += c })
    res.on('end', () => resolve(`HTTP ${res.statusCode}${data ? ' ' + JSON.stringify(data.slice(0, 80)) : ''}`))
  })
  req.on('timeout', () => { req.destroy(); resolve('HTTP 超时') })
  req.on('error', (e) => resolve(`HTTP 失败（${e.code || e.message}）`))
  req.write(body)
  req.end()
})

// ── 宿主机转发自动配置（WSL interop -> Windows netsh/powershell）────────────
// 仅 WSL 下可用：经互操作调用 Windows 侧 netstat/netsh/powershell，为「只监听
// 127.0.0.1」的宿主机服务自动建立端口转发 + 防火墙放行（需一次 UAC 授权）。
const WIN_EXE_CANDIDATES = {
  'powershell.exe': ['powershell.exe', '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'],
  'netsh.exe': ['netsh.exe', '/mnt/c/Windows/System32/netsh.exe'],
  'netstat.exe': ['netstat.exe', '/mnt/c/Windows/System32/netstat.exe'],
}
// 依次尝试候选路径执行 Windows 命令，捕获 stdout/stderr；全部失败返回 ok:false。
const runWin = (file, args, timeoutMs = 15000) => new Promise((resolve) => {
  const candidates = WIN_EXE_CANDIDATES[file] || [file]
  const attempt = (i) => {
    if (i >= candidates.length) {
      resolve({ ok: false, error: `找不到 ${file}（请确认 WSL 互操作已启用）` })
      return
    }
    execFileP(candidates[i], args, { timeout: timeoutMs, windowsHide: true })
      .then(({ stdout, stderr }) => resolve({ ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') }))
      .catch((e) => {
        if (e && e.code === 'ENOENT') attempt(i + 1)
        else resolve({ ok: false, error: String((e && (e.stderr || e.message)) || e).slice(0, 400), code: e && e.code })
      })
  }
  attempt(0)
})
// 查询某端口在 Windows 侧处于 LISTENING 的监听地址列表（如 ['127.0.0.1:64342','0.0.0.0:8080']）。
const winPortListeners = async (port) => {
  const r = await runWin('netstat.exe', ['-ano', '-p', 'tcp'])
  if (!r.ok) return null
  return r.stdout.split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 4 && /LISTENING/i.test(p[3]) && new RegExp(`:${port}$`).test(p[1]))
    .map((p) => p[1])
}
// 是否已有「同端口 -> 127.0.0.1」的 portproxy 规则（监听地址不限：0.0.0.0 或宿主机网卡 IP）。
const winPortProxyHas = async (port) => {
  const r = await runWin('netsh.exe', ['interface', 'portproxy', 'show', 'all'])
  if (!r.ok) return false
  return r.stdout.split('\n').some((l) => {
    const p = l.trim().split(/\s+/)
    return p.length >= 4 && p[2] === '127.0.0.1' && p[1] === String(port) && p[3] === String(port)
  })
}
// 是否仍存在早期的 0.0.0.0/[::] 监听版本（会占宿主全端口、阻碍同端口服务重启绑定）。
const winPortProxyLegacyHas = async (port) => {
  const r = await runWin('netsh.exe', ['interface', 'portproxy', 'show', 'all'])
  if (!r.ok) return false
  return r.stdout.split('\n').some((l) => {
    const p = l.trim().split(/\s+/)
    return p.length >= 4 && (p[0] === '0.0.0.0' || p[0] === '[::]') && p[1] === String(port) && p[2] === '127.0.0.1' && p[3] === String(port)
  })
}
// 是否已存在对应防火墙放行规则。
const winFirewallHas = async (port) => {
  const name = `wsl-mcp-${port}`
  const r = await runWin('netsh.exe', ['advfirewall', 'firewall', 'show', 'rule', `name=${name}`])
  return r.ok && /wsl-mcp-\d+/.test(r.stdout) && r.stdout.includes(name)
}
// 提权执行：外层 powershell 用 Start-Process -Verb RunAs 拉起内层（netsh 命令），
// 会弹出一次 UAC 授权框；用户批准后完成。返回 { ok, error }。
const winElevated = (innerScript) => {
  const innerB64 = Buffer.from(innerScript, 'utf16le').toString('base64')
  const outer = `$p = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','${innerB64}') -Verb RunAs -Wait -PassThru; exit $p.ExitCode`
  const outerB64 = Buffer.from(outer, 'utf16le').toString('base64')
  return runWin('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', outerB64], 90000)
}
// 端口转发 + 防火墙放行（listenaddress 用宿主机网卡 IP，绝不占 0.0.0.0 /
// 127.0.0.1 —— 否则会让宿主机上同端口的服务（如 UE MCP）重启时抢不到端口）。
const winForwardSetup = (port, subnet, listenIp) => winElevated([
  `netsh interface portproxy add v4tov4 listenaddress=${listenIp} listenport=${port} connectaddress=127.0.0.1 connectport=${port}`,
  `netsh advfirewall firewall add rule name="wsl-mcp-${port}" dir=in action=allow protocol=TCP localport=${port} remoteip=${subnet}`,
].join('\n'))
// 仅补防火墙放行（服务已监听所有网卡时不需要转发，但 WSL 入站可能仍被拦）。
const winFirewallSetup = (port, subnet) => winElevated(
  `netsh advfirewall firewall add rule name="wsl-mcp-${port}" dir=in action=allow protocol=TCP localport=${port} remoteip=${subnet}`,
)
// 由宿主机 IP（如 192.168.160.1）推导 WSL 网段（/24），用于防火墙放行的源地址。
const wslSubnetOf = (hostIp) => (typeof hostIp === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(hostIp) ? hostIp.replace(/\.\d+$/, '.0/24') : '0.0.0.0/0')
// 宿主机某端口的监听状态（netstat 结果缓存 30s）：
//   all  = 0.0.0.0 / [::]（所有网卡）  loop = 127.0.0.1 / [::1]（仅回环）  none = 无监听  null = 查询失败
const hostListenerCache = new Map()
const hostListenerState = async (port) => {
  const cached = hostListenerCache.get(port)
  if (cached && Date.now() - cached.at < 30000) return cached.state
  const listeners = await winPortListeners(port)
  let state = 'none'
  if (Array.isArray(listeners) && listeners.some((l) => l.startsWith('0.0.0.0:') || l.startsWith('[::]:'))) state = 'all'
  else if (Array.isArray(listeners) && listeners.some((l) => l.startsWith('127.0.0.1:') || l.startsWith('[::1]:'))) state = 'loop'
  hostListenerCache.set(port, { state, at: Date.now() })
  return state
}

// ── JSON/JSONC 解析 ──
function stripJsonc(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

// Claude / Codex / Cursor: { "mcpServers": { name: {command,args,env}|{url,headers}|{type,...} } }
function parseMcpJson(text, source) {
  const out = []
  let obj
  try {
    obj = JSON.parse(stripJsonc(text))
  } catch (e) {
    log('JSON 解析失败:', source, e.message)
    return out
  }
  const servers = (obj && obj.mcpServers) || {}
  for (const [name, cfg] of Object.entries(servers)) {
    if (!cfg || typeof cfg !== 'object') continue
    const type = String(cfg.type || '').toLowerCase()
    // The official dsh-mcp-client supports stdio and Streamable HTTP only.
    // Do not let an older SSE entry shadow a later supported config with the same name.
    if (type === 'sse') {
      log('跳过不支持的 SSE 服务器（可改用 Streamable HTTP 配置）:', name, '—', source)
      continue
    }
    if (cfg.url || type === 'http' || type === 'streamable-http' || type === 'remote') {
      out.push({
        name,
        transport: 'streamable-http',
        url: String(cfg.url),
        headers: cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : undefined,
        source,
      })
    } else if (cfg.command) {
      out.push({
        name,
        transport: 'stdio',
        command: String(cfg.command),
        args: Array.isArray(cfg.args) ? cfg.args.map(String) : [],
        env: cfg.env && typeof cfg.env === 'object' ? cfg.env : undefined,
        source,
      })
    }
  }
  return out
}

// opencode: { "mcp": { name: {type:'local'|'remote', command:[...], environment:{}, url, enabled} } }
function parseOpencodeJson(text, source) {
  const out = []
  let obj
  try {
    obj = JSON.parse(stripJsonc(text))
  } catch (e) {
    log('opencode JSON 解析失败:', source, e.message)
    return out
  }
  const mcp = (obj && obj.mcp) || {}
  for (const [name, cfg] of Object.entries(mcp)) {
    if (!cfg || typeof cfg !== 'object' || cfg.enabled === false) continue
    if (cfg.url || String(cfg.type || '') === 'remote') {
      out.push({ name, transport: 'streamable-http', url: String(cfg.url), source })
    } else if (Array.isArray(cfg.command) && cfg.command.length) {
      const cmd = cfg.command.map(String)
      out.push({
        name,
        transport: 'stdio',
        command: cmd[0],
        args: cmd.slice(1),
        env: cfg.environment && typeof cfg.environment === 'object' ? cfg.environment : undefined,
        source,
      })
    }
  }
  return out
}

// ── 极简 TOML 解析（Codex .codex/config.toml 的 mcp_servers 段）──
function unquote(v) {
  v = v.trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1)
  return v
}
function parseTomlArray(v) {
  const m = /^\[([\s\S]*)\]$/.exec(v.trim())
  if (!m) return []
  return m[1].split(',').map((s) => s.trim()).filter(Boolean).map(unquote)
}
function parseTomlInlineTable(v) {
  const env = {}
  const m = /^\{([\s\S]*)\}$/.exec(v.trim())
  if (!m) return env
  for (const part of m[1].split(',')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = unquote(part.slice(0, eq))
    const val = unquote(part.slice(eq + 1))
    if (k) env[k] = val
  }
  return env
}
function parseCodexToml(text, source) {
  const out = []
  let current = null
  let kv = null
  let section = null
  const flush = () => {
    if (!current || !kv) return
    if (kv.url) out.push({ name: current, transport: 'streamable-http', url: kv.url, source })
    else if (kv.command) out.push({ name: current, transport: 'stdio', command: kv.command, args: kv.args || [], env: kv.env, source })
    current = null
    kv = null
    section = null
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header) {
      const name = header[1].trim()
      if (!name.startsWith('mcp_servers.')) {
        flush()
        continue
      }
      const rest = name.slice('mcp_servers.'.length)
      if (rest.endsWith('.env')) {
        const serverName = unquote(rest.slice(0, -'.env'.length))
        if (current !== serverName) {
          flush()
          current = serverName
          kv = {}
        }
        kv.env ||= {}
        section = 'env'
      } else if (rest.includes('.tools.')) {
        flush()
      } else {
        flush()
        current = unquote(rest)
        kv = {}
        section = 'server'
      }
      continue
    }
    if (current === null || !kv || section === null) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const k = unquote(line.slice(0, eq))
    const v = line.slice(eq + 1).trim()
    if (!v) continue
    if (section === 'env') {
      if (k) kv.env[k] = unquote(v)
    } else if (k === 'command') kv.command = unquote(v)
    else if (k === 'args') kv.args = parseTomlArray(v)
    else if (k === 'env') kv.env = parseTomlInlineTable(v)
    else if (k === 'url') kv.url = unquote(v)
  }
  flush()
  return out
}

// 可扫描的配置源体系：每个 family 对应一类 Agent 的约定，可在设置里按需开启
const ALL_FAMILIES = ['claude', 'cursor', 'opencode', 'codex']
const FAMILY_LABELS = {
  claude: 'Claude（.mcp.json）',
  cursor: 'Cursor（.cursor/mcp.json）',
  opencode: 'opencode（opencode.json / ~/.config/opencode/opencode.json）',
  codex: 'Codex（.codex/config.toml）',
}
// ── 配置来源清单 ──
const PROJECT_FILES = [
  { file: '.mcp.json', parse: parseMcpJson, family: 'claude' },
  { file: 'opencode.json', parse: parseOpencodeJson, family: 'opencode' },
  { file: 'opencode.jsonc', parse: parseOpencodeJson, family: 'opencode' },
  { file: '.cursor/mcp.json', parse: parseMcpJson, family: 'cursor' },
  { file: '.codex/config.toml', parse: parseCodexToml, family: 'codex' },
]
const GLOBAL_FILES = [
  { file: '.mcp.json', parse: parseMcpJson, family: 'claude' },
  { file: '.codex/config.toml', parse: parseCodexToml, family: 'codex' },
  { file: join('.config', 'opencode', 'opencode.json'), parse: parseOpencodeJson, family: 'opencode' },
]

// 测试钩子：node 脚本可直接 import 本模块做解析验证
export { parseMcpJson, parseOpencodeJson, parseCodexToml, collectServers, PROJECT_FILES, GLOBAL_FILES, isWsl, getWslHostIp, wslFallbackUrl, wslTunnelTarget, wslSubnetOf, winPortListeners, winPortProxyHas, winPortProxyLegacyHas, winFirewallHas, hostListenerState }

// 支持按启用的 family（配置源体系）过滤。enabled 为空/未传时 = 全部开启（保持原行为）。
function collectServers(workspacePaths, enabled) {
  const enabledSet = !enabled ? null : new Set(enabled)
  const byName = new Map()
  const found = []
  const add = (server) => {
    if (server.transport === 'stdio' && isAbsolute(server.command) && !existsSync(server.command)) {
      const key = `${server.name}\0${server.command}\0${server.source}`
      if (!reportedInvalidCommands.has(key)) {
        reportedInvalidCommands.add(key)
        log('跳过命令路径不存在的服务器:', server.name, '—', server.command, '<-', server.source)
      }
      return
    }
    if (byName.has(server.name)) {
      log('忽略重复服务器名（保留先出现的）:', server.name, '—', byName.get(server.name).source, '已占用', server.source, '被跳过')
      return
    }
    byName.set(server.name, server)
    found.push(server)
  }
  const readAll = (root, list, workspaceRoot) => {
    for (const { file, parse, family } of list) {
      if (enabledSet && !enabledSet.has(family)) continue
      const p = join(root, file)
      if (!existsSync(p)) continue
      try {
        for (const s of parse(readFileSync(p, 'utf8'), p)) {
          add({
            ...s,
            ...(s.transport === 'stdio' ? { cwd: root } : {}),
            ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
          })
        }
      } catch (e) {
        log('解析失败:', p, String((e && e.message) || e))
      }
    }
  }
  for (const root of workspacePaths) readAll(root, PROJECT_FILES, root)
  readAll(homedir(), GLOBAL_FILES, undefined)
  return found
}

export async function apply(ctx) {
  // ── 持久化设置：注册命名空间（schemastery schema 经 loader 拉取）──
  const NS = 'dsh-mcp-compat'
  let scope = null
  let memScanners = [...ALL_FAMILIES]
  let memWslCompat = true
  let memWslAutoForward = true
  let memForwardedPorts = []
  try {
    const mod = await ctx.loader.import('@deepseek-ai/schemastery')
    const z = mod && mod.default ? mod.default : mod
    scope = ctx.settings.register(NS, z.object({
      scanners: z.array(z.string()).default(ALL_FAMILIES),
      wslCompat: z.boolean().default(true),
      wslAutoForward: z.boolean().default(true),
      // 插件创建的宿主机转发规则（portproxy + 防火墙），用于 DSH 退出时自动释放
      forwardedPorts: z.array(z.object({
        port: z.number(),
        listen: z.string(),
        proxy: z.boolean().default(true),
        firewall: z.boolean().default(true),
      })).default([]),
    }))
  } catch (e) {
    log('settings 注册失败，回退内存态:', String((e && e.message) || e))
  }

  // 当前启用的扫描 family（设置里勾选；settings 不可用时回退全部）
  const readScanners = () => {
    if (scope) {
      try {
        const v = scope.get()
        if (v && Array.isArray(v.scanners) && v.scanners.length) {
          const valid = v.scanners.filter((s) => ALL_FAMILIES.includes(s))
          return valid.length ? valid : [...memScanners]
        }
      } catch {}
    }
    return [...memScanners]
  }
  // WSL 兼容开关：wslCompat 是否启用隧道/改写兜底；wslAutoForward 是否在宿主机
  // 端口不可达时自动配置 portproxy + 防火墙（触发一次 Windows UAC 授权）。
  const readWslCfg = () => {
    if (scope) {
      try {
        const v = scope.get()
        if (v) {
          return {
            compat: typeof v.wslCompat === 'boolean' ? v.wslCompat : memWslCompat,
            autoForward: typeof v.wslAutoForward === 'boolean' ? v.wslAutoForward : memWslAutoForward,
          }
        }
      } catch {}
    }
    return { compat: memWslCompat, autoForward: memWslAutoForward }
  }
  // 插件自建的宿主机转发规则跟踪（仅释放自己创建的，不碰用户手动加的）。
  const readTrackedPorts = () => {
    if (scope) {
      try {
        const v = scope.get()
        if (v && Array.isArray(v.forwardedPorts)) return v.forwardedPorts.filter((t) => t && typeof t.port === 'number')
      } catch {}
    }
    return memForwardedPorts
  }
  const setTrackedPorts = (list) => {
    memForwardedPorts = list
    if (scope) {
      try { void scope.update({ forwardedPorts: list }).catch(() => {}) } catch {}
    }
  }
  const trackForward = (port, listen, proxy, firewall) => {
    const list = readTrackedPorts().filter((t) => t.port !== port)
    list.push({ port, listen: listen || '0.0.0.0', proxy: !!proxy, firewall: !!firewall })
    setTrackedPorts(list)
    log('WSL 兼容：转发规则已纳入自动释放跟踪:', port, '(' + (listen || '0.0.0.0') + '，转发:' + (proxy ? '是' : '否') + '，防火墙:' + (firewall ? '是' : '否') + ')')
  }
  // 释放插件自建的全部转发：提权批量删除 portproxy + 防火墙规则（一次 UAC）。
  // 按“规则是否还在”复查结果，只保留仍存在的条目。
  const releaseForwarding = async () => {
    const list = readTrackedPorts()
    if (!list.length) return { ok: true, released: [], remaining: [] }
    const lines = []
    for (const t of list) {
      if (t.proxy && t.listen) lines.push(`netsh interface portproxy delete v4tov4 listenaddress=${t.listen} listenport=${t.port}`)
      if (t.firewall) lines.push(`netsh advfirewall firewall delete rule name="wsl-mcp-${t.port}"`)
    }
    if (!lines.length) return { ok: true, released: [], remaining: list }
    log('WSL 兼容：释放宿主机转发（请在弹出的 UAC 窗口点“是”）:', list.map((t) => t.port).join(', '))
    const r = await winElevated(lines.join('\n'))
    const remaining = []
    for (const t of list) {
      const proxyAlive = t.proxy ? await winPortProxyHas(t.port) : false
      const fwAlive = t.firewall ? await winFirewallHas(t.port) : false
      if (proxyAlive || fwAlive) remaining.push(t)
    }
    setTrackedPorts(remaining)
    const released = list.filter((t) => !remaining.includes(t)).map((t) => t.port)
    if (released.length) log('WSL 兼容：已释放宿主机转发:', released.join(', '))
    if (remaining.length) log('WSL 兼容：以下转发仍存在（可能未批准 UAC）:', remaining.map((t) => t.port).join(', '), String(r.error || ''))
    return { ok: !remaining.length, released, remaining: remaining.map((t) => t.port), error: r.ok ? undefined : r.error }
  }
  // 启动时对账：跟踪条目里已被手动删除的规则从跟踪中移除。
  const reconcileTrackedPorts = async () => {
    const list = readTrackedPorts()
    if (!list.length) return
    const kept = []
    for (const t of list) {
      const proxyAlive = t.proxy ? await winPortProxyHas(t.port) : false
      const fwAlive = t.firewall ? await winFirewallHas(t.port) : false
      if (proxyAlive || fwAlive) kept.push(t)
    }
    if (kept.length !== list.length) setTrackedPorts(kept)
  }

  let mcpClientPlugin = null
  const ensureClient = async () => {
    if (mcpClientPlugin) return mcpClientPlugin
    const mod = await ctx.loader.import('@deepseek-ai/dsh-mcp-client')
    const p = mod && mod.default ? mod.default : mod
    mcpClientPlugin = { name: p.name, inject: p.inject, Config: p.Config, apply: p.apply }
    return mcpClientPlugin
  }
  let fibers = []
  // fiberByName：按服务器名索引 fiber，用于「只重连 down 的那部分」时精准定位并单独 dispose
  const fiberByName = new Map()
  let watchers = []
  let restrictions = []
  let projectTools = []
  let generation = 0
  let timer = null
  // ── 重连支持 ──
  // currentServers：最近一次 sync 挂载的服务器清单（供看门狗/手动重连引用）
  let currentServers = []
  // syncing：sync 正在执行时置位，看门狗据此跳过，避免与在途重扫互相踩踏
  let syncing = false
  // healthTimer：自动重连看门狗定时器
  let healthTimer = null
  const HEALTH_CHECK_INTERVAL_MS = 15000
  // 连续自动重连失败达到该次数后停止自动重试（不再刷日志、不再发起），
  // 等用户启动服务后手动 /mcp-reconnect 或调用 mcp_reconnect 工具拉起。
  const MAX_AUTO_RECONNECT_ATTEMPTS = 10
  // hostState：按服务器名记录看门狗状态（downSince 首次离线时间、presentCount 连续在线轮数、
  // attempts 已退避重连次数、lastAttempt 上次真正发起重连的时间戳）。
  // 用于对离线服务器做指数退避 + 只在状态跃迁/真正重连时打印日志，避免 UE 未开启时无限刷屏。
  const hostState = new Map()
  // ── WSL 兼容状态 ──
  // wslTunnels：WSL 侧同端口透明 TCP 隧道（key: bindHost|port -> net.Server），
  // 把客户端对原始 loopback URL 的连接转发到宿主机 IP:端口，Host 头保持 127.0.0.1，
  // 兼容 JetBrains 等只认本机 Host 的服务。
  const wslTunnels = new Map()
  const wslTunnelErrors = new Set()
  // wslActive/wslMode：正在使用 WSL 兼容连接的服务器名及其模式（tunnel | rewrite）。
  // 只有发生过失败（看门狗/手动重连）才会加入；加入后持续沿用，避免每次全量
  // sync 重建后又退回失败的 loopback、再等下一轮看门狗翻一次。
  const wslActive = new Set()
  const wslMode = new Map()
  // 在 WSL 里起一条 原始loopback端口 -> 宿主机同端口 的字节透传隧道（按端口复用）。
  const ensureTunnel = (url) => new Promise((resolve) => {
    const t = wslTunnelTarget(url)
    if (!t) { resolve(false); return }
    const key = `${t.bindHost || '0.0.0.0'}|${t.port}`
    if (wslTunnels.has(key)) { resolve(true); return }
    const server = createTcpServer((cli) => {
      const up = tcpConnect(t.port, t.host, () => { cli.pipe(up); up.pipe(cli) })
      up.on('error', () => { try { cli.destroy() } catch {} })
      cli.on('error', () => { try { up.destroy() } catch {} })
    })
    const onError = (e) => {
      const code = e && e.code
      if (code === 'EADDRINUSE' && !wslTunnelErrors.has(key)) {
        wslTunnelErrors.add(key)
        log('WSL 兼容：WSL 本机端口被占用，无法启用隧道，退回地址改写:', String(t.bindHost || '回环'), t.port)
      } else if (code !== 'EADDRINUSE') {
        log('WSL 兼容：隧道启动失败:', String(t.bindHost || '回环'), t.port, String((e && e.message) || e))
      }
      resolve(false)
    }
    server.once('error', onError)
    server.listen(t.port, t.bindHost, () => {
      server.removeListener('error', onError)
      server.on('error', () => {})
      wslTunnels.set(key, server)
      log('WSL 兼容：启动同端口透明隧道', String(t.bindHost || '回环'), t.port, '->', t.host + ':' + t.port, '（保持原始 Host 头）')
      resolve(true)
    })
  })
  // 关闭不再被任何已配置服务器使用的隧道（全量 sync 时调用），并清理失效状态。
  // 只有处于 tunnel 模式的服务器才保留隧道（rewrite 模式直连宿主机 IP，
  // 不应占用 WSL 端口、更不该引 wslrelay 去堵宿主机回环端口）。
  const pruneTunnels = (servers) => {
    const needed = new Set()
    for (const s of servers) {
      if (s.transport !== 'streamable-http') continue
      if (wslMode.get(s.name) !== 'tunnel') continue
      const t = wslTunnelTarget(s.url)
      if (t) needed.add(`${t.bindHost || '0.0.0.0'}|${t.port}`)
    }
    for (const [key, srv] of wslTunnels) {
      if (!needed.has(key)) {
        try { srv.close() } catch {}
        wslTunnels.delete(key)
      }
    }
    const names = new Set(servers.map((s) => s.name))
    for (const name of [...wslActive]) if (!names.has(name)) wslActive.delete(name)
    for (const name of [...wslMode.keys()]) if (!names.has(name)) wslMode.delete(name)
  }
  const closeTunnels = () => {
    for (const srv of wslTunnels.values()) { try { srv.close() } catch {} }
    wslTunnels.clear()
    wslActive.clear()
    wslMode.clear()
  }

  // ── 宿主机转发自动配置（每个端口只尝试一次，避免反复弹 UAC）──
  const forwardAttempted = new Set()
  const forwardWarned = new Set()
  // 为某端口确保宿主机侧可达：
  //   all-interfaces 服务已监听 0.0.0.0 —— 无需转发；
  //   already          已有 portproxy + 防火墙规则；
  //   done             本次自动配置成功（UAC 授权后）；
  //   failed           配置失败（未批准 UAC / 无管理员 / 命令失败）；
  //   skipped          本进程已尝试过该端口 / 非 WSL。
  const ensureHostForward = async (port) => {
    if (!isWsl()) return { status: 'not-wsl' }
    if (forwardAttempted.has(port)) return { status: 'skipped' }
    forwardAttempted.add(port)
    const hostIp = getWslHostIp()
    const subnet = wslSubnetOf(hostIp)
    // 1) 规则已齐（portproxy + 防火墙）——无需处理；注意 netstat 里的 0.0.0.0
    //    监听可能正是 portproxy 自身，所以先查规则再分析监听。
    const proxyHas = await winPortProxyHas(port)
    const fwHas = await winFirewallHas(port)
    if (proxyHas && fwHas) {
      // 提示：若是早期用 0.0.0.0 监听的旧转发（正是“堵住宿主服务重启抢端口”的元凶，
      // 如 UE MCP），建议删除后让插件重建为只绑网卡 IP 的规则并纳入自动释放。
      if (!forwardWarned.has(port)) {
        forwardWarned.add(port)
        const legacy = await winPortProxyLegacyHas(port)
        if (legacy) {
          log('WSL 兼容：发现 0.0.0.0 监听的旧转发（listenport', port, '），可能阻碍宿主服务重启时绑定端口。建议删除后交插件重建：netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=' + port, '（管理员）')
        }
      }
      return { status: 'already' }
    }
    // 2) 无转发规则时判断是否真的需要
    const listeners = await winPortListeners(port)
    if (Array.isArray(listeners) && listeners.some((l) => l.startsWith('0.0.0.0:') || l.startsWith('[::]:'))) {
      // 服务已监听所有网卡：不需要转发；但 WSL 入站仍可能被防火墙拦，缺规则就补一条
      if (!fwHas) {
        log('WSL 兼容：服务监听所有网卡，补充防火墙放行（请批准 UAC）:', port)
        const r = await winFirewallSetup(port, subnet)
        if (await winFirewallHas(port)) trackForward(port, hostIp, false, true)
        else log('WSL 兼容：防火墙放行失败:', port, String((r && r.error) || '未知'))
      }
      return { status: 'all-interfaces' }
    }
    if (Array.isArray(listeners) && listeners.length === 0) {
      log('WSL 兼容：宿主机', port, '无监听（服务未运行或未绑回环）:', '不会自动转发')
      return { status: 'no-listener' }
    }
    // 3) 只剩回环监听：自动建立转发——listenaddress 只绑宿主机网卡 IP
    //    （192.168.160.1），不占 0.0.0.0 / 127.0.0.1，宿主机服务重启仍能拿到端口
    log('WSL 兼容：自动配置宿主机端口转发（仅', hostIp || '(未知)', '监听） + 防火墙放行（请批准 UAC）:', port)
    const r = await winForwardSetup(port, subnet, hostIp)
    if (r.ok) {
      log('WSL 兼容：宿主机转发配置完成:', hostIp + ':' + port, '→ 127.0.0.1:' + port, '（源限', subnet + '）')
      trackForward(port, hostIp, true, true)
      return { status: 'done' }
    }
    // 4) 可能规则已存在导致报错，重查确认
    const proxyAfter = await winPortProxyHas(port)
    const fwAfter = await winFirewallHas(port)
    if (proxyAfter && fwAfter) return { status: 'already' }
    const err = String(r.error || '')
    log('WSL 兼容：自动配置宿主机转发失败:', port, err || r.code || '未知错误')
    return { status: 'failed', error: err }
  }
  // 对一批 streamable-http 服务器名做转发配置（手动按钮 / 看门狗复用）。
  const ensureForwardForServers = async (names) => {
    const ports = new Set()
    for (const name of names || []) {
      const s = currentServers.find((x) => x.name === name)
      if (!s || s.transport !== 'streamable-http' || !s.url) continue
      try {
        const u = new URL(s.url)
        ports.add(Number(u.port) || (u.protocol === 'https:' ? 443 : 80))
      } catch {}
    }
    const results = []
    for (const p of ports) results.push({ port: p, ...(await ensureHostForward(p)) })
    return results
  }

  const pathKey = (value) => {
    const normalized = resolve(String(value || ''))
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }
  const clearRestrictions = () => {
    const list = restrictions
    restrictions = []
    for (const dispose of list) {
      try { dispose() } catch {}
    }
  }
  const restrictAgent = (agent) => {
    if (!projectTools.length) return
    const cwd = agent && agent.session && agent.session.header && agent.session.header.cwd
    const current = cwd ? pathKey(cwd) : ''
    const deny = projectTools
      .filter((tool) => pathKey(tool.workspaceRoot) !== current)
      .map((tool) => tool.name)
    if (!deny.length) return
    try {
      restrictions.push(agent.ctx.tools.restrict({ deny }))
    } catch (e) {
      log('项目 MCP 工具作用域限制失败:', String((e && e.message) || e))
    }
  }
  const refreshRestrictions = (servers) => {
    clearRestrictions()
    const schemas = ctx.tools.schemas()
    projectTools = []
    for (const server of servers) {
      if (!server.workspaceRoot) continue
      const prefix = `mcp__${server.name}__`
      for (const schema of schemas) {
        if (schema.name.startsWith(prefix)) {
          projectTools.push({ name: schema.name, workspaceRoot: server.workspaceRoot })
        }
      }
    }
    for (const agent of ctx.agents.list()) restrictAgent(agent)
  }

  const disposeAll = async () => {
    const list = fibers
    fibers = []
    fiberByName.clear()
    for (const f of list) {
      try {
        if (f && typeof f.dispose === 'function') await f.dispose()
      } catch {}
    }
  }
  const closeWatchers = () => {
    for (const w of watchers) {
      try { w.close() } catch {}
    }
    watchers = []
  }

  // 只 dispose 指定名字的服务器，其它健康服务器不受影响。
  const disposeServers = async (names) => {
    const removed = []
    for (const name of names) {
      const f = fiberByName.get(name)
      if (f) {
        removed.push(f)
        fiberByName.delete(name)
      }
    }
    if (removed.length) fibers = fibers.filter((f) => !removed.includes(f))
    for (const f of removed) {
      try {
        if (f && typeof f.dispose === 'function') await f.dispose()
      } catch {}
    }
  }

  // ── 精准重连 ──
  // 只重建传入名字的服务器（针对看门狗发现 down 的那部分），不惊动其它健康挂载。
  // 配置本身的变更仍走全量 sync()（fs.watch / session/created / mcp_reconnect）。
  // mode = 'tunnel'  启动同端口透明隧道，挂载原始 loopback URL（Host 头保持本机）；
  // mode = 'rewrite' 把 streamable-http 的 loopback URL 改写为宿主机 IP。
  const rebuildCfg = (s, mode) => {
    if (s.transport === 'streamable-http') {
      let url = s.url
      if (mode === 'rewrite') {
        const fb = wslFallbackUrl(url)
        if (fb) url = fb
      }
      return { serverName: s.name, transport: s.transport, url, headers: s.headers }
    }
    return { serverName: s.name, transport: s.transport, command: s.command, args: s.args, env: s.env, cwd: s.cwd }
  }
  // 为一次重连决定 WSL 兼容模式（仅在确认当前连不上时启用，避免惊动健康连接）：
  // 一律先「地址改写」直连宿主机 IP（不占 WSL 端口、不引 wslrelay，宿主机服务
  // 重启仍能拿到自己的端口）；若探测到服务只认本机 Host（HTTP 403，如 JetBrains），
  // 看门狗会自动升级为同端口透明隧道。
  const pickWslMode = async (s) => {
    if (s.transport !== 'streamable-http') return null
    if (!wslFallbackUrl(s.url)) return null
    void hostListenerState(Number(new URL(s.url).port) || 80) // 预热缓存（供诊断/转发决策）
    return 'rewrite'
  }
  const reconnectServers = async (names) => {
    if (syncing) {
      scheduleSync()
      return
    }
    const targetSet = new Set(names)
    const targets = currentServers.filter((s) => targetSet.has(s.name))
    if (!targets.length) return
    syncing = true
    const gen = ++generation
    try {
      await disposeServers(targetSet)
      let client
      try {
        client = await ensureClient()
      } catch (e) {
        log('无法加载 dsh-mcp-client:', String((e && e.message) || e))
        return
      }
      const mounted = []
      for (const s of targets) {
        if (gen !== generation) return
        try {
          // 已启用兼容模式的沿用（URL 不再适用 loopback 兼容则视为未启用）；
          // 尚未启用的只有确认当前确实连不上（工具消失 / 手动重连目标）才启用——即「连接失败才兜底」。
          // wslCompat 关闭时整体不使用隧道/改写。
          let mode = null
          if (readWslCfg().compat) {
            mode = wslMode.get(s.name)
            if (mode === 'tunnel' && !wslTunnelTarget(s.url)) mode = null
            else if (mode === 'rewrite' && !wslFallbackUrl(s.url)) mode = null
            if (!mode) {
              const present = serversPresent(s)
              if (!present || wslActive.has(s.name)) mode = await pickWslMode(s)
            }
          }
          if (mode && !wslActive.has(s.name)) {
            wslActive.add(s.name)
            log('WSL 兼容：连接 localhost 失败，启用', mode === 'tunnel' ? '同端口隧道（保留原始 Host 头）' : '宿主机 IP 改写', ':', s.name, s.url)
          }
          if (mode) wslMode.set(s.name, mode)
          const cfg = rebuildCfg(s, mode)
          const f = ctx.plugin(client, cfg)
          fibers.push(f)
          fiberByName.set(s.name, f)
          mounted.push(f)
          log('重连', s.name, s.transport, cfg.url || cfg.command, '<-', s.source)
        } catch (e) {
          log('挂载失败:', s.name, String((e && e.message) || e))
        }
      }
      await Promise.allSettled(mounted.map((f) => Promise.resolve(f)))
      if (gen !== generation) return
      refreshRestrictions(currentServers)
    } finally {
      syncing = false
    }
  }

  const sync = async () => {
    if (syncing) {
      scheduleSync()
      return
    }
    syncing = true
    const gen = ++generation
    try {
      clearRestrictions()
      projectTools = []
      await disposeAll()
      closeWatchers()

      let roots = []
      try {
        roots = ctx.workspaceRegistry.list().map((w) => String(w.path))
      } catch (e) {
        log('workspaceRegistry 不可用:', String((e && e.message) || e))
      }
      const scanners = readScanners()
      const servers = collectServers(roots, scanners)
      log('发现', servers.length, '个 MCP 服务器:', servers.map((s) => s.name).join(', ') || '(无)', '（扫描源:', scanners.join('+') || '(未启用)', '）')
      // 清理不再被使用的隧道、失效的兼容状态（保留仍配置的服务器所用隧道）；
      // wslCompat 关闭时全部关闭并复位。
      if (readWslCfg().compat) pruneTunnels(servers)
      else closeTunnels()

      let client
      try {
        client = await ensureClient()
      } catch (e) {
        log('无法加载 dsh-mcp-client:', String((e && e.message) || e))
        return
      }

      for (const s of servers) {
        if (gen !== generation) return
        // 已启用 WSL 兼容的服务器，全量重建时保持同样模式（隧道优先，避免退回
        // 失败的 loopback 再等下一轮看门狗翻一次）；URL 不再适用则取消兼容模式。
        let mode = wslMode.get(s.name)
        if (mode === 'tunnel' && !wslTunnelTarget(s.url)) mode = null
        else if (mode === 'rewrite' && !wslFallbackUrl(s.url)) mode = null
        if (mode === 'tunnel') {
          const ok = await ensureTunnel(s.url)
          if (!ok) mode = 'rewrite'
        }
        if (!mode && wslActive.has(s.name)) wslActive.delete(s.name)
        else if (mode) wslMode.set(s.name, mode)
        const cfg = rebuildCfg(s, mode)
        try {
          const f = ctx.plugin(client, cfg)
          fibers.push(f)
          fiberByName.set(s.name, f)
          log('挂载', s.name, s.transport, cfg.url || cfg.command, '<-', s.source)
        } catch (e) {
          log('挂载失败:', s.name, String((e && e.message) || e))
        }
      }

      // Wait for initial tool synchronization before deriving per-agent visibility.
      await Promise.allSettled(fibers.map((fiber) => Promise.resolve(fiber)))
      if (gen !== generation) return
      refreshRestrictions(servers)
      currentServers = servers
      // 全量重建 = 全新连接机会：复位看门狗失败计数（之后最多再自动试 10 次）
      resetWatchdog(servers.map((s) => s.name))

      // 监听已存在的候选配置文件（编译后自动重扫）；只监听当前启用的 family
      const enabledSet = new Set(scanners)
      const candidateFiles = [
        ...PROJECT_FILES.filter((f) => enabledSet.has(f.family)).map((f) => f.file),
        ...GLOBAL_FILES.filter((f) => enabledSet.has(f.family)).map((f) => f.file),
      ]
      for (const root of [...roots, homedir()]) {
        for (const rel of candidateFiles) {
          const p = join(root, rel)
          if (!existsSync(p)) continue
          try {
            const w = watch(p, { persistent: false }, () => scheduleSync())
            watchers.push(w)
          } catch {}
        }
      }
    } finally {
      syncing = false
    }
  }

  const scheduleSync = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void sync()
    }, 500)
  }

  // ── 自动重连看门狗 ──
  // 官方 dsh-mcp-client 有自带重连，但在连续失败超过 maxAttempts 后会「放弃」：
  // 注销该服务器的工具并停止（日志 giving up after N consecutive failed …）。
  // 这种「放弃」终态正是 UE 反复开关后连不上的根因。看门狗定期检查每个已挂载
  // 服务器的工具是否仍在注册表里；若消失（说明官方已放弃），就用一次完整 sync()
  // （dispose 全部 + 重新挂载）强制重建连接，实现「UE 回来就能自动接上」。
  const serversPresent = (server) => {
    const prefix = `mcp__${server.name}__`
    return ctx.tools.schemas().some((s) => s.name.startsWith(prefix))
  }
  // 对曾经在线、后来工具消失的服务器做指数退避重连，而不是每 15s 无脑全量重扫。
  // 这样 UE 临时关闭时日志不会一直刷，UE 一旦恢复就通知并复位计时。
  const backoffFor = (attempts) => Math.min(15000 << Math.min(attempts, 8), 10 * 60 * 1000)

  const checkHealth = () => {
    if (syncing) return
    if (!currentServers.length) return
    const names = new Set(currentServers.map((s) => s.name))
    // 清理已不在挂载清单里的残留状态
    for (const k of [...hostState.keys()]) if (!names.has(k)) hostState.delete(k)
    const now = Date.now()
    const toReconnect = []
    for (const server of currentServers) {
      const st = hostState.get(server.name) || { downSince: null, presentCount: 0, attempts: 0, lastAttempt: 0 }
      const present = serversPresent(server)
      if (present) {
        // 连续两轮都观察到工具存在，才判定「恢复」，避免重连窗口内的抖动误报
        st.presentCount++
        if (st.downSince !== null && st.presentCount >= 2) {
          log('MCP 服务器已恢复:', server.name)
          st.downSince = null
          st.presentCount = 0
          st.attempts = 0
          st.gaveUpLogged = false
          st.hintShown = false
          st.lastAttempt = now
        }
      } else {
        st.presentCount = 0
        // 已启用 WSL 兼容仍连不上：一次性给出 TCP + HTTP 探测结果与原因方向，
        // 避免「第 N 次退避重连」无限刷屏后用户仍不知道为什么。
        if (wslActive.has(server.name) && !st.hintShown) {
          st.hintShown = true
          const target = server.transport === 'streamable-http' ? wslFallbackUrl(server.url) || server.url : ''
          void (async () => {
            if (!target) {
              log('仍连不上（非 HTTP 服务器）:', server.name)
              return
            }
            // 自动配置宿主机转发（若开启）：先确保宿主机端口可达，再探测诊断
            let fwd = null
            if (readWslCfg().compat && readWslCfg().autoForward) {
              const port = Number(new URL(target).port) || (String(target).startsWith('https:') ? 443 : 80)
              const r = await ensureHostForward(port)
              if (r && r.status === 'done') {
                log('WSL 兼容：宿主机转发已就绪，触发重连:', server.name)
                void reconnectServers([server.name])
              }
              fwd = r && r.status
            }
            const [probe, http] = await Promise.all([probeTcp(target), probeHttp(target)])
            // 服务只认本机 Host（403）：改写直连无效，升级为同端口透明隧道
            const is403 = typeof http === 'string' && http.startsWith('HTTP 403')
            if (is403 && readWslCfg().compat && wslMode.get(server.name) !== 'tunnel') {
              log('WSL 兼容：宿主机服务只认本机 Host（HTTP 403），升级为同端口透明隧道:', server.name, server.url)
              wslMode.set(server.name, 'tunnel')
              if (!wslActive.has(server.name)) wslActive.add(server.name)
              if (await ensureTunnel(server.url)) void reconnectServers([server.name])
            }
            log('WSL 兼容：仍连不上', server.name, server.url, '（TCP:', probe, '；握手:', http, fwd ? `；转发: ${fwd}` : '', '）。若 TCP 不可达：确认宿主机端口转发已生效（可点设置卡片“立即配置宿主机转发”）且服务在运行；若 HTTP 403：服务只认本机 Host（如 JetBrains），已自动升级隧道；若握手超时：服务未响应 MCP 握手，多半是服务未启动或还在启动中。详见 README「WSL 宿主兼容」。')
          })()
        }
        if (st.downSince === null) {
          // 首次发现离线：立即重连一次并记录时间，之后进入退避节奏
          st.downSince = now
          st.attempts = 0
          st.lastAttempt = now
          log('检测到 MCP 服务器工具已消失，进入自动重连:', server.name)
          toReconnect.push(server.name)
        } else if (now - st.lastAttempt >= backoffFor(st.attempts) && now - st.downSince > 5000) {
          const attempts = st.attempts + 1
          st.lastAttempt = now
          if (attempts > MAX_AUTO_RECONNECT_ATTEMPTS) {
            // 超过上限：停止自动重连、不再刷日志，等待用户手动拉起
            if (!st.gaveUpLogged) {
              st.gaveUpLogged = true
              log(`已停止自动重连（连续超过 ${MAX_AUTO_RECONNECT_ATTEMPTS} 次失败）:`, server.name, '— 请启动服务后手动运行 /mcp-reconnect 或调用 mcp_reconnect 工具拉起')
            }
          } else {
            st.attempts = attempts
            log(`MCP 服务器仍离线，第 ${attempts} 次退避重连:`, server.name)
            toReconnect.push(server.name)
          }
        }
      }
      hostState.set(server.name, st)
    }
    // 只重连 down 的那部分（按名字精准重建），健康服务器不受影响
    if (toReconnect.length) void reconnectServers(toReconnect)
  }
  const startHealthCheck = () => {
    if (healthTimer) return
    healthTimer = setInterval(checkHealth, HEALTH_CHECK_INTERVAL_MS)
    healthTimer.unref()
  }
  const stopHealthCheck = () => {
    if (healthTimer) {
      clearInterval(healthTimer)
      healthTimer = null
    }
  }
  // 手动重连（工具/命令）或全量 sync 后，复位看门狗的失败计数与“已放弃”标记，
  // 让下一次自动重连从新的一轮开始（最多再试 MAX_AUTO_RECONNECT_ATTEMPTS 次）。
  const resetWatchdog = (names) => {
    for (const name of names) {
      const st = hostState.get(name)
      if (st) {
        st.attempts = 0
        st.gaveUpLogged = false
        st.hintShown = false
        st.downSince = null
        st.presentCount = 0
      }
    }
  }

  ctx.effect(() => {
    void sync()
    void reconcileTrackedPorts()
    startHealthCheck()
    // 手动重连工具：强制重新读取配置并重建所有（或指定）MCP 服务器连接。
    // 官方客户端放弃重连后，这是从「giving up」终态恢复的标准入口。
    try {
      ctx.tools.register({
        name: 'mcp_reconnect',
        description: '手动重连 MCP 服务器。当 MCP 服务器（例如 UE 的 MCP）被关闭后再打开，官方客户端的自动重连可能已放弃（工具被注销），调用本工具会强制重新读取配置并重建连接。参数 serverName 省略时重连全部已配置服务器。',
        parameters: {
          serverName: {
            type: 'string',
            description: '要重连的 MCP 服务器名；省略则重连全部已配置服务器。'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true },
              message: { type: 'string', required: true },
              reconnected: { type: 'array', items: { type: 'string' }, required: false }
            }
          },
          render: (_args, value) => [{ type: 'text', text: value.message }]
        },
        timeoutMs: 90000,
        async execute(args) {
          const target = typeof args?.serverName === 'string' ? args.serverName.trim() : ''
          if (target) {
            // 指定了 serverName：只精准重连该服务器
            const exists = currentServers.some((s) => s.name === target)
            if (!exists) return { ok: false, message: `未找到已配置的 MCP 服务器「${target}」。当前已配置: ${currentServers.map((s) => s.name).join(', ') || '(无)'}`, reconnected: [] }
            await reconnectServers([target])
            resetWatchdog([target])
            const restored = currentServers.filter((s) => s.name === target && serversPresent(s)).map((s) => s.name)
            return { ok: true, message: `已重连 MCP 服务器「${target}」。`, reconnected: restored }
          }
          // 未指定：全量重建（重读配置，处理配置变更）
          await sync()
          const reconnected = currentServers.map((s) => s.name)
          return { ok: true, message: `已重连全部 MCP 服务器。当前已挂载: ${reconnected.join(', ') || '(无)'}`, reconnected }
        }
      })
    } catch (e) {
      log('注册 mcp_reconnect 工具失败:', String((e && e.message) || e))
    }
    // ── 对话框 slash 命令：/mcp-reconnect [服务器名] ──
    // 直接执行、结果直接显示，不经过模型。用法：
    //   /mcp-reconnect            重连全部（重读配置）
    //   /mcp-reconnect unreal     只精准重连指定服务器
    let offReconnectCommand = () => {}
    try {
      offReconnectCommand = ctx.commands.register({
        name: 'mcp-reconnect',
        description: '手动重连 MCP 服务器（如 UE 的 MCP 被关闭后重新打开）。传服务器名则只重连该服务器，省略则重连全部。',
        input: { hint: 'MCP 服务器名（可省略）' },
        async handler(invocation) {
          const target = String(invocation.rawInput || '').trim()
          try {
            if (target) {
              const exists = currentServers.some((s) => s.name === target)
              if (!exists) {
                return { kind: 'error', text: `未找到已配置的 MCP 服务器「${target}」。已配置: ${currentServers.map((s) => s.name).join(', ') || '(无)'}` }
              }
              await reconnectServers([target])
              resetWatchdog([target])
              return { kind: 'success', text: `已重连 MCP 服务器「${target}」。` }
            }
            await sync()
            const mounted = currentServers.map((s) => s.name).join(', ') || '(无)'
            return { kind: 'success', text: `已重连全部 MCP 服务器。当前已挂载: ${mounted}` }
          } catch (e) {
            return { kind: 'error', text: `重连失败: ${String((e && e.message) || e)}` }
          }
        },
      })
    } catch (e) {
      log('注册 /mcp-reconnect 命令失败:', String((e && e.message) || e))
    }
    const offSession = ctx.on('session/created', () => scheduleSync(), { global: true })
    const offAgent = ctx.on('agent/created', ({ agent }) => restrictAgent(agent), { global: true })
    return () => {
      offSession()
      offAgent()
      try { offReconnectCommand() } catch {}
      clearRestrictions()
      projectTools = []
      closeWatchers()
      stopHealthCheck()
      closeTunnels()
      // 释放插件自建的宿主机转发（尽力而为；进程被强杀时无法执行，可手动删）
      void releaseForwarding()
      if (timer) clearTimeout(timer)
      void disposeAll()
    }
  })

  // ── 设置卡片数据路由（Client 设置卡片读写扫描源配置）──
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
  ctx.webServer.register({
    kind: 'prefix',
    path: '/mcp-compat',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost')
        if (url.pathname === '/mcp-compat/config' && req.method === 'GET') {
          const wslCfg = readWslCfg()
          sendJson(res, {
            scanners: readScanners(),
            all: ALL_FAMILIES,
            labels: FAMILY_LABELS,
            wsl: {
              detected: isWsl(),
              hostIp: getWslHostIp() || undefined,
              mode: Array.from(wslMode.entries()).map(([name, m]) => `${name}:${m}`),
              active: Array.from(wslActive),
              compat: wslCfg.compat,
              autoForward: wslCfg.autoForward,
            },
          })
          return
        }
        if (url.pathname === '/mcp-compat/config' && req.method === 'POST') {
          const a = await readBody(req)
          const patch = {}
          if (Array.isArray(a.scanners)) {
            const next = a.scanners.filter((s) => ALL_FAMILIES.includes(String(s)))
            patch.scanners = next.length || a.scanners.length === 0 ? next : a.scanners
          }
          if (typeof a.wslCompat === 'boolean') patch.wslCompat = a.wslCompat
          if (typeof a.wslAutoForward === 'boolean') patch.wslAutoForward = a.wslAutoForward
          if (!Object.keys(patch).length) {
            sendJson(res, { ok: false, error: '缺少有效字段（scanners / wslCompat / wslAutoForward）' }, 400)
            return
          }
          try {
            if (scope) await scope.update(patch)
            else {
              if (patch.scanners) memScanners = [...patch.scanners]
              if (typeof patch.wslCompat === 'boolean') memWslCompat = patch.wslCompat
              if (typeof patch.wslAutoForward === 'boolean') memWslAutoForward = patch.wslAutoForward
            }
            log('配置 ->', JSON.stringify({ ...patch, scanners: patch.scanners || readScanners() }))
            // 立即按新配置重建挂载（WSL 兼容开关变化会启用/关闭隧道与改写）
            void sync()
            sendJson(res, { ok: true, scanners: readScanners(), wsl: { compat: readWslCfg().compat, autoForward: readWslCfg().autoForward } })
          } catch (e) {
            log('配置保存失败:', String((e && e.message) || e))
            sendJson(res, { ok: false, error: '保存失败: ' + String((e && e.message) || e) }, 500)
          }
          return
        }
        if (url.pathname === '/mcp-compat/wsl-forward' && req.method === 'POST') {
          // 手动按钮：对当前全部已配置的 loopback 服务器端口立即配置宿主机转发
          const results = await ensureForwardForServers(currentServers.map((s) => s.name))
          sendJson(res, { ok: true, results })
          return
        }
        if (url.pathname === '/mcp-compat/wsl-release' && req.method === 'POST') {
          // 手动按钮：释放插件自建的宿主机转发（portproxy + 防火墙，一次 UAC）
          const rel = await releaseForwarding()
          sendJson(res, { ok: rel.ok, released: rel.released, remaining: rel.remaining, error: rel.error })
          return
        }
        sendJson(res, { ok: false, error: 'not-found' }, 404)
      } catch (e) {
        log('config 路由异常:', String((e && e.message) || e))
        sendJson(res, { ok: false, error: String((e && e.message) || e) }, 500)
      }
    },
  })
}
