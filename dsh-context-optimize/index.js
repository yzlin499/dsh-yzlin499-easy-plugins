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

const ENDPOINT = '/context-optimize/outline'
const MAX_ENTRIES = 50

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
