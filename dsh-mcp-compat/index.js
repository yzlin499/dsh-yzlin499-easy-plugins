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
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'mcp-compat'
// loader：经 loader 自己的解析拿 dsh-mcp-client（bundle 源目录在项目里，
// 顶层裸 import '@deepseek-ai/dsh-mcp-client' 会按源目录解析失败）
export const inject = ['workspaceRegistry', 'loader']

const log = (...a) => console.log('[mcp-compat]', ...a)

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
    const type = String(cfg.type || '')
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
  const flush = () => {
    if (!current || !kv) return
    if (kv.url) out.push({ name: current, transport: 'streamable-http', url: kv.url, source })
    else if (kv.command) out.push({ name: current, transport: 'stdio', command: kv.command, args: kv.args || [], env: kv.env, source })
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header) {
      flush()
      const name = header[1].trim()
      current = name.startsWith('mcp_servers.') ? unquote(name.slice('mcp_servers.'.length)) : null
      kv = {}
      continue
    }
    if (current === null || !kv) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const k = line.slice(0, eq).trim()
    const v = line.slice(eq + 1).trim()
    if (!v) continue
    if (k === 'command') kv.command = unquote(v)
    else if (k === 'args') kv.args = parseTomlArray(v)
    else if (k === 'env') kv.env = parseTomlInlineTable(v)
    else if (k === 'url') kv.url = unquote(v)
  }
  flush()
  return out
}

// ── 配置来源清单 ──
const PROJECT_FILES = [
  { file: '.mcp.json', parse: parseMcpJson },
  { file: 'opencode.json', parse: parseOpencodeJson },
  { file: 'opencode.jsonc', parse: parseOpencodeJson },
  { file: '.cursor/mcp.json', parse: parseMcpJson },
  { file: '.codex/config.toml', parse: parseCodexToml },
]
const GLOBAL_FILES = [
  { file: '.mcp.json', parse: parseMcpJson },
  { file: '.codex/config.toml', parse: parseCodexToml },
  { file: join('.config', 'opencode', 'opencode.json'), parse: parseOpencodeJson },
]

// 测试钩子：node 脚本可直接 import 本模块做解析验证
export { parseMcpJson, parseOpencodeJson, parseCodexToml, collectServers, PROJECT_FILES, GLOBAL_FILES }

function collectServers(workspacePaths) {
  const byName = new Map()
  const found = []
  const add = (server) => {
    if (byName.has(server.name)) {
      log('忽略重复服务器名（保留先出现的）:', server.name, '—', byName.get(server.name).source, '已占用', server.source, '被跳过')
      return
    }
    byName.set(server.name, server)
    found.push(server)
  }
  const readAll = (root, list) => {
    for (const { file, parse } of list) {
      const p = join(root, file)
      if (!existsSync(p)) continue
      try {
        for (const s of parse(readFileSync(p, 'utf8'), p)) add(s)
      } catch (e) {
        log('解析失败:', p, String((e && e.message) || e))
      }
    }
  }
  for (const root of workspacePaths) readAll(root, PROJECT_FILES)
  readAll(homedir(), GLOBAL_FILES)
  return found
}

export function apply(ctx) {
  let mcpClientPlugin = null
  const ensureClient = async () => {
    if (mcpClientPlugin) return mcpClientPlugin
    const mod = await ctx.loader.import('@deepseek-ai/dsh-mcp-client')
    const p = mod && mod.default ? mod.default : mod
    mcpClientPlugin = { name: p.name, inject: p.inject, apply: p.apply }
    return mcpClientPlugin
  }
  let fibers = []
  let watchers = []
  let generation = 0
  let timer = null

  const disposeAll = async () => {
    const list = fibers
    fibers = []
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

  const sync = async () => {
    const gen = ++generation
    await disposeAll()
    closeWatchers()

    let roots = []
    try {
      roots = ctx.workspaceRegistry.list().map((w) => String(w.path))
    } catch (e) {
      log('workspaceRegistry 不可用:', String((e && e.message) || e))
    }
    const servers = collectServers(roots)
    log('发现', servers.length, '个 MCP 服务器:', servers.map((s) => s.name).join(', ') || '(无)')

    let client
    try {
      client = await ensureClient()
    } catch (e) {
      log('无法加载 dsh-mcp-client:', String((e && e.message) || e))
      return
    }

    for (const s of servers) {
      if (gen !== generation) return
      const cfg = s.transport === 'streamable-http'
        ? { serverName: s.name, transport: s.transport, url: s.url, headers: s.headers }
        : { serverName: s.name, transport: s.transport, command: s.command, args: s.args, env: s.env }
      try {
        const f = ctx.plugin(client, cfg)
        fibers.push(f)
        log('挂载', s.name, s.transport, s.url || s.command, '<-', s.source)
      } catch (e) {
        log('挂载失败:', s.name, String((e && e.message) || e))
      }
    }

    // 监听已存在的候选配置文件（编辑后自动重扫）
    const candidateFiles = [
      ...PROJECT_FILES.map((f) => f.file),
      '.mcp.json',
      '.codex/config.toml',
      join('.config', 'opencode', 'opencode.json'),
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
  }

  const scheduleSync = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void sync()
    }, 500)
  }

  ctx.effect(() => {
    void sync()
    const off = ctx.on('session/created', () => scheduleSync())
    return () => {
      off()
      closeWatchers()
      if (timer) clearTimeout(timer)
      void disposeAll()
    }
  })
}
