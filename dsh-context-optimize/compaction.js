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
import { archiveRoot, persistSpan, renderTranscript, spanIdOf } from './lib/archive.js'
import { consumeFoldRequest, getSpan, hasFoldRequest, recordSpan } from './lib/store.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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
  /** v0.2 起提供 fold/ask/expand 工具，卡片默认渲染「取回」段。 */
  retrievalTools: true,
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

      innerCtx.on('session/event', (session, event) => {
        if (event?.type !== 'tool/call') return
        const key = session?.id ?? 'unknown'
        this.toolStepsSinceFold.set(key, (this.toolStepsSinceFold.get(key) ?? 0) + 1)
      })
    }

    /** 折叠准入：首折放行；之后要求「连续做过若干工具步」，溢出恢复永远放行。
     *  主 agent 主动调 fold_context 也放行（那是它自己的判断）。 */
    admitted(agent) {
      const key = agent.session.id
      if (hasFoldRequest(key)) return true
      if (options.minToolStepsBetweenFolds <= 0) return true
      if (!this.hasFolded.has(key)) return true
      return (this.toolStepsSinceFold.get(key) ?? 0) >= options.minToolStepsBetweenFolds
    }

    async compactIfNeeded(agent, trigger, signal) {
      if (trigger === 'pressure' && !this.admitted(agent)) return null
      const sessionId = agent.session.id
      consumeFoldRequest(sessionId)
      const result = await super.compactIfNeeded(agent, trigger, signal)
      if (result !== null && result !== undefined) {
        this.hasFolded.add(sessionId)
        this.toolStepsSinceFold.set(sessionId, 0)
        // summarize() 先把归档按时间记下；拿到真实位置后回填，工具才能按 span 定位。
        const latest = [...(getSpan(sessionId) ? [getSpan(sessionId)] : [])][0]
        if (latest !== undefined) recordSpan(sessionId, {
          ...latest,
          start: result.shadowedRange?.start ?? latest.start,
          end: result.shadowedRange?.end ?? latest.end,
          tokens: Number(result.shadowedTokenCount) || latest.tokens,
          nodes: Array.isArray(result.shadowedSeqs) ? result.shadowedSeqs.length : latest.nodes,
        })
      }
      return result
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
      // 归档：折叠时把区域原文自己留一份（含磁盘），给 ask/expand 用。
      const transcript = renderTranscript(input.messages)
      const spanId = spanIdOf(input.messages, { at: Date.now() })
      const text = renderCard(facts, {
        id: spanId,
        claim,
        open,
        locale: options.locale,
        tokens: estimateTokens(JSON.stringify(input.messages)),
        retrieval: options.retrievalTools,
      })
      const entry = recordSpan(agent.session.id, {
        id: spanId,
        card: text,
        text: transcript,
        tokens: estimateTokens(JSON.stringify(input.messages)),
        at: Date.now(),
      })
      void this.persistArchive(agent.session.id, spanId, transcript, entry)
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

    /** 落盘一份归档原文；失败只记日志，不影响折叠本身。 */
    async persistArchive(sessionId, spanId, text, entry) {
      try {
        const root = archiveRoot(process.env, process.env.USERPROFILE ?? process.env.HOME ?? '')
        const file = await persistSpan({ mkdir, writeFile }, { join }, root, sessionId, spanId, text)
        if (file !== null && entry !== undefined) entry.path = file
      } catch (error) {
        this.ctx.logger?.warn?.(`[context-optimize] 归档落盘失败（不影响折叠）：${String(error?.message ?? error)}`)
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
