/**
 * 主 agent 的三个工具：fold_context / ask_folded / expand_folded。
 *
 * 设计口径（见 Docs/context-optimize/设计-分层折叠与巡航.md）：
 *   · ask 优先：便宜、不占窗口；expand 是最后手段；fold 由 agent 自己决定。
 *   · fold 在工具里**不能立刻改 surface**（工具执行中没有合法窗口），所以它只排队，
 *     下一步的 agent/pre-step 由压缩后端兑现。
 *   · expand 本版返回归档原文到工具结果；「就地还原（replace 卡片节点）」要单独
 *     验证 Session 的追加/替换 API，排在 v0.3。
 */

import {
  MAX_ARCHIVE_CHARS,
  excerpts,
} from './lib/archive.js'
import { getSpan, listSpans, recentSessionId, recordSpan, requestFold } from './lib/store.js'

export const name = 'dsh-context-optimize-tools'
export const inject = ['tools', 'llm']

const ASK_INSTRUCTION = [
  'You answer questions about an EARLIER span of this conversation that has been folded into a card.',
  'You get the card and one or more archived excerpts. Answer only from them.',
  '',
  'Output exactly three lines:',
  'ANSWER: <one or two sentences>',
  'CONFIDENCE: high | low',
  'NEED: <a short keyword to fetch more material, or (none)>',
  '',
  'Rules: quote exact strings (paths, commands, error codes) when they matter.',
  'If the material does not contain the answer, say so plainly and set CONFIDENCE: low.',
].join('\n')

function parseAnswer(text) {
  const source = String(text ?? '')
  const grab = (label) => {
    const match = source.match(new RegExp(`${label}\\s*:\\s*([^\\n]*)`, 'i'))
    return match ? match[1].trim() : ''
  }
  const need = grab('NEED')
  return {
    answer: grab('ANSWER') || source.trim().slice(0, 800),
    confidence: /low/i.test(grab('CONFIDENCE')) ? 'low' : 'high',
    need: need.length === 0 || /^\(?none\)?$/i.test(need) ? null : need,
  }
}

function currentAgent(ctx) {
  try {
    return ctx.agents?.currentInitiator?.() ?? undefined
  } catch {
    return undefined
  }
}

function sessionIdOf(ctx) {
  const agent = currentAgent(ctx)
  return agent?.session?.id ?? recentSessionId() ?? ''
}

export async function apply(ctx) {
  const llmMod = await ctx.loader.import('@deepseek-ai/dsh-llm')
  const BlockAssembler = llmMod?.BlockAssembler

  const render = (_args, value) => [{ type: 'text', text: value.message ?? JSON.stringify(value) }]

  ctx.tools.register({
    name: 'fold_context',
    description: '请求把本会话最早的一段历史折成一页卡片（下一步生效，会把省下的 token 让出来）。'
      + '只在连续做了很多工具调用、且上下文明显变长时用；刚折过一次就别再折。',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'queued', 'message'],
        properties: {
          ok: { type: 'boolean' },
          queued: { type: 'boolean' },
          message: { type: 'string' },
        },
      },
      render,
    },
    execute() {
      const sessionId = sessionIdOf(ctx)
      if (sessionId === '') return { ok: false, queued: false, message: '找不到当前会话，无法排队折叠。' }
      requestFold(sessionId)
      return { ok: true, queued: true, message: '已排队：下一步会把最早的一段历史折成卡片。' }
    },
  })

  ctx.tools.register({
    name: 'ask_folded',
    description: '向一段已折叠的历史提问，不用把它展开。返回结论、置信度与「还需要什么」。'
      + '先看卡片里的取回提示，拿到 span id 再问。',
    parameters: {
      type: 'object',
      properties: {
        spanId: { type: 'string', description: '卡片的身份行里的 span id（如 sp_1a2b3c4d）；省略则问最近一段。' },
        question: { type: 'string', description: '具体要问什么，越具体命中率越高。' },
      },
      required: ['question'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'spanId', 'answer', 'confidence', 'need', 'message'],
        properties: {
          ok: { type: 'boolean' },
          spanId: { type: 'string' },
          answer: { type: 'string' },
          confidence: { type: 'string' },
          need: { type: ['string', 'null'] },
          message: { type: 'string' },
        },
      },
      render,
    },
    async execute(args) {
      const sessionId = sessionIdOf(ctx)
      const question = String(args?.question ?? '').trim()
      if (sessionId === '' || question.length === 0) {
        return { ok: false, spanId: '', answer: '', confidence: 'low', need: null, message: '缺少会话或问题。' }
      }
      const span = getSpan(sessionId, args?.spanId)
      if (span === undefined) {
        const known = listSpans(sessionId).map((entry) => entry.id)
        return {
          ok: false,
          spanId: String(args?.spanId ?? ''),
          answer: '',
          confidence: 'low',
          need: null,
          message: known.length === 0
            ? '本会话还没有折叠过任何段落，没有可问的内容。'
            : `没有这段折叠。可用的 span id: ${known.join(', ')}`,
        }
      }

      const picked = excerpts(span.text, question, { window: 1500, max: 3 }).join('\n---\n')
      const prompt = [
        '## Card of the folded span',
        span.card,
        '',
        '## Archived excerpts',
        picked,
        '',
        ASK_INSTRUCTION,
      ].join('\n')

      const header = currentAgent(ctx)?.session?.requestHeader?.()?.config
      const provider = header?.provider ?? ''
      const model = header?.model ?? ''
      if ((provider === '' || model === '') || typeof BlockAssembler !== 'function') {
        return {
          ok: false,
          spanId: span.id,
          answer: '',
          confidence: 'low',
          need: null,
          message: '没有可用的模型路由，无法回答；可以改用 expand_folded 直接看原文。',
        }
      }

      const assembler = new BlockAssembler()
      try {
        for await (const chunk of ctx.llm.stream({
          provider,
          model,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          maxTokens: 800,
          sessionId,
          purpose: 'compaction',
        })) assembler.push(chunk)
      } catch (error) {
        return {
          ok: false,
          spanId: span.id,
          answer: '',
          confidence: 'low',
          need: null,
          message: `询问失败：${String(error?.message ?? error)}；可以改用 expand_folded 直接看原文。`,
        }
      }
      const text = assembler.blocks().filter((block) => block.type === 'text').map((block) => block.text).join('\n')
      const parsed = parseAnswer(text)
      return {
        ok: true,
        spanId: span.id,
        answer: parsed.answer,
        confidence: parsed.confidence,
        need: parsed.need,
        message: `关于 ${span.id}：${parsed.answer}`
          + (parsed.confidence === 'low' ? '（置信度低）' : '')
          + (parsed.need === null ? '' : `\n还需要：${parsed.need}`),
      }
    },
  })

  ctx.tools.register({
    name: 'expand_folded',
    description: '把一段已折叠历史的原文取回来（按字取，可分段）。代价是原文会占窗口，'
      + '所以先用 ask_folded 问；问不出来再展。',
    parameters: {
      type: 'object',
      properties: {
        spanId: { type: 'string', description: '卡片里的 span id；省略则取最近一段。' },
        offset: { type: 'integer', description: '从第几个字符开始取，默认 0。' },
        limit: { type: 'integer', description: '最多取多少字符，默认 6000，上限 20000。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'spanId', 'text', 'total', 'truncated', 'message'],
        properties: {
          ok: { type: 'boolean' },
          spanId: { type: 'string' },
          text: { type: 'string' },
          total: { type: 'integer' },
          truncated: { type: 'boolean' },
          message: { type: 'string' },
        },
      },
      render,
    },
    execute(args) {
      const sessionId = sessionIdOf(ctx)
      const span = getSpan(sessionId, args?.spanId)
      if (span === undefined) {
        return { ok: false, spanId: String(args?.spanId ?? ''), text: '', total: 0, truncated: false, message: '没有这段折叠（或本会话还没折过）。' }
      }
      const offset = Math.max(0, Math.min(Number(args?.offset) || 0, MAX_ARCHIVE_CHARS))
      const limit = Math.max(1, Math.min(Number(args?.limit) || 6000, 20000))
      const text = span.text.slice(offset, offset + limit)
      const truncated = offset + limit < span.text.length
      return {
        ok: true,
        spanId: span.id,
        text,
        total: span.text.length,
        truncated,
        message: `以下是 ${span.id} 的归档原文（${offset}–${offset + text.length} / ${span.text.length} 字）。`
          + (truncated ? `还有后续，继续用 offset=${offset + limit} 取。` : ''),
      }
    },
  })

  // 供压缩后端在自己 realm 里共享同一份账本（同一模块实例，无需传对象）。
  ctx.logger?.info?.('[context-optimize] 工具已注册：fold_context / ask_folded / expand_folded')
}

export const __internals = { parseAnswer, recordSpan }
