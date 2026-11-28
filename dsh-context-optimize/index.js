/**
 * Host 半侧：折叠账本 + 侧边栏「上下文大纲」的只读接口。
 *
 * 为什么放在这里而不是压缩后端里：压缩后端挂在 `context-optimize` 模式的
 * 隔离 realm 里，只在那个模式的会话中存在；而侧边栏那一页对所有会话可见。
 * 把「记账 + 接口」放 Host，其它模式（甚至标准模式）折过的东西也读得到。
 *
 * 数据来源只有一处：会话日志里的 `compaction/summary` 事件（官方事件词汇，
 * 由任何压缩后端写出）。这里不读正文、不估算 token，只搬事件里已有的数字。
 */

export const name = 'dsh-context-optimize-host'

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const ENDPOINT = '/context-optimize/outline'
const MAX_ENTRIES = 50

/** 这个会话跑在哪个模式（agent preset）上。
 *
 *  先问服务（内存里最准），拿不到再退到会话头文件——头文件第一帧就写着
 *  `agentPreset`，新会话只有几百字节，读一次就能判定，不依赖任何服务可见性。
 */
const presetCache = new Map()
const PRESET_TTL_MS = 30_000

function presetFromServices(ctx, sessionId) {
  try {
    const agent = ctx.agents?.get?.(sessionId)
    if (agent === undefined || agent === null) return null
    const preset = ctx.agentPresets?.presetForSession?.(agent.session)
    return typeof preset === 'string' && preset.length > 0 ? preset : null
  } catch {
    return null
  }
}

function presetFromDisk(sessionId) {
  const hit = presetCache.get(sessionId)
  if (hit !== undefined && Date.now() - hit.at < PRESET_TTL_MS) return hit.preset
  try {
    const home = process.env.DSH_HOME && process.env.DSH_HOME.length > 0
      ? process.env.DSH_HOME
      : join(homedir(), '.dsh')
    const sessionsRoot = join(home, 'sessions')
    let preset = null
    for (const project of readdirSync(sessionsRoot)) {
      const file = join(sessionsRoot, project, sessionId, 'session.v4.jsonl.zstd')
      if (!existsSync(file)) continue
      const header = zstdDecompressSync(readFileSync(file)).toString('utf8').split('\n')[0]
      const parsed = JSON.parse(header)
      preset = typeof parsed.agentPreset === 'string' ? parsed.agentPreset : null
      break
    }
    presetCache.set(sessionId, { preset, at: Date.now() })
    return preset
  } catch {
    return null
  }
}

function presetOf(ctx, sessionId) {
  return presetFromServices(ctx, sessionId) ?? presetFromDisk(sessionId)
}

export function apply(ctx) {
  /** sessionId → [{ tokens, nodes, start, end, at }] */
  const history = new Map()

  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'compaction/summary') return
    const sessionId = session?.id
    if (sessionId === undefined || sessionId === null) return
    const entries = history.get(sessionId) ?? []
    entries.push({
      tokens: Number(event.data?.shadowedTokenCount) || 0,
      nodes: Array.isArray(event.data?.shadowedSeqs) ? event.data.shadowedSeqs.length : 0,
      start: event.data?.shadowedRange?.start ?? null,
      end: event.data?.shadowedRange?.end ?? null,
      at: Number(event.time) || Date.now(),
    })
    history.set(sessionId, entries.slice(-MAX_ENTRIES))
  })

  const webServer = ctx.get?.('webServer')
  if (!webServer || typeof webServer.register !== 'function') {
    ctx.logger?.warn?.('[context-optimize] webServer 不可用，上下文大纲页只能显示空状态')
    return
  }

  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: '/context-optimize',
    handler: (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (url.pathname !== ENDPOINT) {
          res.statusCode = 404
          res.end()
          return
        }
        const sessionId = url.searchParams.get('session') ?? ''
        const entries = history.get(sessionId) ?? []
        const body = {
          sessionId,
          folded: entries.length,
          tokens: entries.reduce((sum, entry) => sum + entry.tokens, 0),
          nodes: entries.reduce((sum, entry) => sum + entry.nodes, 0),
          entries,
          // 客户端拿它判断「这一页该不该显示大纲」：只有上下文优化模式才有意义。
          preset: presetOf(ctx, sessionId),
        }
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(JSON.stringify(body))
      } catch (error) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: String(error?.message ?? error) }))
      }
    },
  }))
}
