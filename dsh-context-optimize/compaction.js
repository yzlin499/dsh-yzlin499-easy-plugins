/**
 * 上下文优化模式的压缩后端。
 *
 * 做法：继承官方 `BasicCompactionEngine`（事务、锁、事件、checkpoint 全复用），
 * 只覆盖两处：
 *   1. `compactIfNeeded` —— 加一道「折叠准入」闸门，防止走一步折一下；
 *   2. `summarize`      —— 不再产出官方八段摘要，而是让「巡航」写一句话结论，
 *                          其余字段由代码确定性抽取，渲染成一页卡片。
 *
 * 为什么继承而不是重写：官方把「归档先落盘 → 校验 → 改 surface → 写事件」的
 * 顺序、`compaction/*` 锁语义、tool-pair 平衡校验都放在 region/summarizer 里，
 * 重写等于把这些正确性重新赌一遍。
 */

import {
  CLAIM_INSTRUCTION,
  buildFacts,
  cardId,
  estimateTokens,
  parseClaim,
  renderCard,
} from './lib/card.js'

export const name = 'dsh-context-optimize-compaction'

const DEFAULTS = {
  /** 距上次折叠至少经过多少个工具步才允许再折；0 表示不设闸门。 */
  minToolStepsBetweenFolds: 6,
  /** 巡航（写卡）用的路由；留空则跟随当前请求路由。 */
  cruiseProvider: '',
  cruiseModel: '',
  /** 卡片输出上限。 */
  maxTokens: 2000,
  /** 卡片语言；'zh' | 'en'。 */
  locale: 'zh',
  /** v0.2 提供 ask/expand 工具后再打开；关闭时卡片不渲染「取回」段。 */
  retrievalTools: false,
}

export async function apply(ctx, config = {}) {
  const options = { ...DEFAULTS, ...config }

  const basicMod = await ctx.loader.import('@deepseek-ai/dsh-compaction-basic')
  const llmMod = await ctx.loader.import('@deepseek-ai/dsh-llm')
  const BasicCompactionEngine = basicMod?.BasicCompactionEngine ?? basicMod?.default
  const BlockAssembler = llmMod?.BlockAssembler
  if (typeof BasicCompactionEngine !== 'function') {
    throw new Error('[context-optimize] 找不到 BasicCompactionEngine：@deepseek-ai/dsh-compaction-basic 版本不匹配')
  }
  if (typeof BlockAssembler !== 'function') {
    throw new Error('[context-optimize] 找不到 BlockAssembler：@deepseek-ai/dsh-llm 版本不匹配')
  }

  class ContextOptimizeCompaction extends BasicCompactionEngine {
    constructor(innerCtx) {
      // 阈值/保留策略沿用官方默认；本包只接管「什么时候折」与「折成什么」。
      super(innerCtx, { auto: true })

      /** sessionId → 自上次折叠以来的工具步数 */
      this.toolStepsSinceFold = new Map()
      /** sessionId → 本会话是否已经折过（首折不受闸门限制） */
      this.hasFolded = new Set()
      /** 最近一次卡片，便于 /compact 之外的诊断读取 */
      this.lastCard = new Map()
      /** sessionId → 折叠历史（供侧边栏「上下文大纲」读取） */
      this.history = new Map()

      innerCtx.on('session/event', (session, event) => {
        if (event?.type !== 'tool/call') return
        const key = session?.id ?? 'unknown'
        this.toolStepsSinceFold.set(key, (this.toolStepsSinceFold.get(key) ?? 0) + 1)
      })

      this.installRoute()
    }

    /** 折叠准入：首折放行；之后要求「连续做过若干工具步」，溢出恢复永远放行。 */
    admitted(agent) {
      const key = agent.session.id
      if (options.minToolStepsBetweenFolds <= 0) return true
      if (!this.hasFolded.has(key)) return true
      return (this.toolStepsSinceFold.get(key) ?? 0) >= options.minToolStepsBetweenFolds
    }

    async compactIfNeeded(agent, trigger, signal) {
      if (trigger === 'pressure' && !this.admitted(agent)) return null
      const result = await super.compactIfNeeded(agent, trigger, signal)
      if (result !== null && result !== undefined) {
        const key = agent.session.id
        this.hasFolded.add(key)
        this.toolStepsSinceFold.set(key, 0)
        const entries = this.history.get(key) ?? []
        entries.push({
          tokens: Number(result.shadowedTokenCount) || 0,
          nodes: Array.isArray(result.shadowedSeqs) ? result.shadowedSeqs.length : 0,
          start: result.shadowedRange?.start ?? null,
          end: result.shadowedRange?.end ?? null,
          trigger,
          at: Date.now(),
        })
        this.history.set(key, entries.slice(-50))
      }
      return result
    }

    /**
     * 给侧边栏「上下文大纲」用的只读接口：只回本引擎自己记下的折叠历史，
     * 不猜客户端拿不到的数字。挂 /context-optimize/outline?session=<id>。
     */
    installRoute() {
      const webServer = this.ctx.get?.('webServer')
      if (!webServer || typeof webServer.register !== 'function') return
      this.ctx.effect(() => webServer.register({
        kind: 'prefix',
        path: '/context-optimize',
        handler: (req, res) => {
          try {
            const url = new URL(req.url ?? '/', 'http://localhost')
            if (url.pathname !== '/context-optimize/outline') {
              res.statusCode = 404
              res.end()
              return
            }
            const sessionId = url.searchParams.get('session') ?? ''
            const entries = this.history.get(sessionId) ?? []
            const body = {
              sessionId,
              folded: entries.length,
              tokens: entries.reduce((sum, entry) => sum + entry.tokens, 0),
              nodes: entries.reduce((sum, entry) => sum + entry.nodes, 0),
              stepsSinceFold: this.toolStepsSinceFold.get(sessionId) ?? 0,
              minToolSteps: options.minToolStepsBetweenFolds,
              entries,
              card: this.lastCard.get(sessionId) ?? null,
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

    /**
     * 覆盖唯一的内容钩子：巡航写 claim，其余字段确定性抽取。
     * 巡航失败一律降级为「无 claim 的确定性卡片」——卡片必须能渲染出来，
     * 否则一次模型抖动就会卡住整轮。
     */
    async summarize(input, agent, signal) {
      const facts = buildFacts(input.messages)
      const header = agent.session.requestHeader()?.config
      const provider = options.cruiseProvider || header?.provider || ''
      const model = options.cruiseModel || header?.model || ''
      if (provider === '' || model === '') {
        throw new Error('[context-optimize] 没有可用的巡航路由：先路由一次请求，或在 preset 里配置 cruiseProvider/cruiseModel')
      }

      const { claim, open } = await this.writeClaim(input, agent, signal, provider, model)
      const text = renderCard(facts, {
        id: cardId(facts, { turns: undefined }),
        claim,
        open,
        locale: options.locale,
        tokens: estimateTokens(JSON.stringify(input.messages)),
        retrieval: options.retrievalTools,
      })
      this.lastCard.set(agent.session.id, text)
      return {
        summary: [{ type: 'text', text }],
        rawOutput: [{ type: 'text', text }],
        llmStreamCall: true,
        provider,
        model,
        maxTokens: options.maxTokens,
      }
    }

    /** 一次低思考档的巡航调用；任何失败都吞掉并返回空 claim。 */
    async writeClaim(input, agent, signal, provider, model) {
      const messages = [
        ...input.messages,
        { role: 'user', content: [{ type: 'text', text: CLAIM_INSTRUCTION }] },
      ]
      const assembler = new BlockAssembler()
      try {
        for await (const chunk of this.ctx.llm.stream({
          provider,
          model,
          messages,
          toolHistory: agent.session.toolHistory(),
          ...(input.tools === undefined ? {} : { tools: [...input.tools] }),
          maxTokens: options.maxTokens,
          sessionId: agent.session.id,
          purpose: 'compaction',
          ...(signal === undefined ? {} : { signal }),
        })) assembler.push(chunk)
      } catch (error) {
        this.ctx.logger?.warn?.(`[context-optimize] 巡航写卡失败，降级为确定性卡片：${String(error?.message ?? error)}`)
        return { claim: '', open: [] }
      }
      const finish = assembler.finish
      if (finish?.kind === 'error' || finish?.kind === 'aborted' || finish?.kind === 'max-tokens') {
        return { claim: '', open: [] }
      }
      const text = assembler.blocks()
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
      const parsed = parseClaim(text)
      return { claim: parsed.claim, open: parsed.open }
    }
  }

  ctx.plugin(ContextOptimizeCompaction)
}
