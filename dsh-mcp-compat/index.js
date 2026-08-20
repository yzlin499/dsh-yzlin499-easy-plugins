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
import { homedir } from 'node:os'

export const name = 'mcp-compat'
// loader：经 loader 自己的解析拿 dsh-mcp-client（bundle 源目录在项目里，
// 顶层裸 import '@deepseek-ai/dsh-mcp-client' 会按源目录解析失败）
export const inject = ['workspaceRegistry', 'loader', 'tools', 'agents', 'commands']

const log = (...a) => console.log('[mcp-compat]', ...a)
const reportedInvalidCommands = new Set()

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
    for (const { file, parse } of list) {
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

export function apply(ctx) {
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
  // hostState：按服务器名记录看门狗状态（downSince 首次离线时间、presentCount 连续在线轮数、
  // attempts 已退避重连次数、lastAttempt 上次真正发起重连的时间戳）。
  // 用于对离线服务器做指数退避 + 只在状态跃迁/真正重连时打印日志，避免 UE 未开启时无限刷屏。
  const hostState = new Map()

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
  const rebuildCfg = (s) => s.transport === 'streamable-http'
    ? { serverName: s.name, transport: s.transport, url: s.url, headers: s.headers }
    : { serverName: s.name, transport: s.transport, command: s.command, args: s.args, env: s.env, cwd: s.cwd }
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
          const f = ctx.plugin(client, rebuildCfg(s))
          fibers.push(f)
          fiberByName.set(s.name, f)
          mounted.push(f)
          log('重连', s.name, s.transport, s.url || s.command, '<-', s.source)
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
        const cfg = rebuildCfg(s)
        try {
          const f = ctx.plugin(client, cfg)
          fibers.push(f)
          fiberByName.set(s.name, f)
          log('挂载', s.name, s.transport, s.url || s.command, '<-', s.source)
        } catch (e) {
          log('挂载失败:', s.name, String((e && e.message) || e))
        }
      }

      // Wait for initial tool synchronization before deriving per-agent visibility.
      await Promise.allSettled(fibers.map((fiber) => Promise.resolve(fiber)))
      if (gen !== generation) return
      refreshRestrictions(servers)
      currentServers = servers

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
          st.lastAttempt = now
        }
      } else {
        st.presentCount = 0
        if (st.downSince === null) {
          // 首次发现离线：立即重连一次并记录时间，之后进入退避节奏
          st.downSince = now
          st.attempts = 0
          st.lastAttempt = now
          log('检测到 MCP 服务器工具已消失，进入自动重连:', server.name)
          toReconnect.push(server.name)
        } else if (now - st.lastAttempt >= backoffFor(st.attempts) && now - st.downSince > 5000) {
          const attempts = st.attempts + 1
          st.attempts = attempts
          st.lastAttempt = now
          log(`MCP 服务器仍离线，第 ${attempts} 次退避重连:`, server.name)
          toReconnect.push(server.name)
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

  ctx.effect(() => {
    void sync()
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
      if (timer) clearTimeout(timer)
      void disposeAll()
    }
  })
}
