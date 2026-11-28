import { test } from 'node:test'
import assert from 'node:assert/strict'

import { apply } from '../tools.js'
import { excerpts, renderTranscript, spanIdOf } from '../lib/archive.js'
import {
  consumeFoldRequest,
  getSpan,
  listSpans,
  recordSpan,
  requestFold,
  resetStore,
} from '../lib/store.js'

/** 造一个足够用的假 ctx：工具注册表 + loader + llm + agents。 */
function makeCtx({ stream } = {}) {
  const tools = new Map()
  const ctx = {
    logger: { info() {}, warn() {} },
    loader: {
      async import(name) {
        if (name !== '@deepseek-ai/dsh-llm') throw new Error(`unexpected ${name}`)
        return {
          BlockAssembler: class {
            constructor() { this.texts = []; this.finish = { kind: 'stop' } }
            push(chunk) { if (typeof chunk?.text === 'string') this.texts.push(chunk.text) }
            blocks() { return this.texts.map((text) => ({ type: 'text', text })) }
          },
        }
      },
    },
    llm: { stream: stream ?? (async function* () { yield { text: 'ANSWER: 默认\nCONFIDENCE: high\nNEED: (none)' } }) },
    agents: { currentInitiator: () => ({ session: { id: 'sess-1', requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } }) },
    tools: { register(definition) { tools.set(definition.name, definition); return () => {} } },
    _tools: tools,
  }
  return ctx
}

const sampleMessages = [
  { role: 'user', content: [{ type: 'text', text: '把输出方式做成三档' }] },
  { role: 'tool', content: [{ type: 'text', text: 'Error: ERR_MODULE_NOT_FOUND x' }] },
]

test('工具注册表：恰好三个工具，schema 是 object 根', async () => {
  resetStore()
  const ctx = makeCtx()
  await apply(ctx)
  assert.deepEqual([...ctx._tools.keys()].sort(), ['ask_folded', 'expand_folded', 'fold_context'])
  for (const definition of ctx._tools.values()) {
    assert.equal(definition.parameters.type, 'object')
    assert.equal(typeof definition.execute, 'function')
    assert.equal(typeof definition.output.render, 'function')
  }
})

test('fold_context 只排队，不立刻改 surface', async () => {
  resetStore()
  const ctx = makeCtx()
  await apply(ctx)
  const result = await ctx._tools.get('fold_context').execute({})
  assert.equal(result.ok, true)
  assert.equal(result.queued, true)
  assert.equal(consumeFoldRequest('sess-1'), true)
  assert.equal(consumeFoldRequest('sess-1'), false, '同一请求只兑现一次')
})

test('ask_folded 没折叠过时说清楚，不编答案', async () => {
  resetStore()
  const ctx = makeCtx()
  await apply(ctx)
  const result = await ctx._tools.get('ask_folded').execute({ question: '当时报了什么错？' })
  assert.equal(result.ok, false)
  assert.match(result.message, /还没有折叠/)
})

test('ask_folded 用归档 + 巡航模型回答，并回传 need', async () => {
  resetStore()
  recordSpan('sess-1', {
    id: 'sp_aaaa1111',
    card: '[sp_aaaa1111] 改三档输出',
    text: 'Error: ERR_MODULE_NOT_FOUND dsh-mcp-compat/client.js',
    tokens: 1000,
    at: 1,
  })
  const ctx = makeCtx({
    stream: async function* () {
      yield { text: 'ANSWER: 报的是 ERR_MODULE_NOT_FOUND\nCONFIDENCE: high\nNEED: 修复方式' }
    },
  })
  await apply(ctx)
  const result = await ctx._tools.get('ask_folded').execute({ spanId: 'sp_aaaa1111', question: '报了错么' })
  assert.equal(result.ok, true)
  assert.equal(result.spanId, 'sp_aaaa1111')
  assert.match(result.answer, /ERR_MODULE_NOT_FOUND/)
  assert.equal(result.confidence, 'high')
  assert.equal(result.need, '修复方式')
  assert.match(result.message, /还需要：修复方式/)
})

test('ask_folded 在模型调用失败时降级为可继续的提示', async () => {
  resetStore()
  recordSpan('sess-1', { id: 'sp_bbbb2222', card: 'c', text: 'some text', at: 2 })
  const ctx = makeCtx({ stream: async function* () { throw new Error('429') } })
  await apply(ctx)
  const result = await ctx._tools.get('ask_folded').execute({ question: 'x' })
  assert.equal(result.ok, false)
  assert.match(result.message, /询问失败.*429/)
  assert.match(result.message, /expand_folded/)  // 失败后指向更重的兜底手段
})

test('expand_folded 分页取原文，超界时告知继续 offset', async () => {
  resetStore()
  recordSpan('sess-1', { id: 'sp_cccc3333', card: 'c', text: 'a'.repeat(100), at: 3 })
  const ctx = makeCtx()
  await apply(ctx)
  const first = await ctx._tools.get('expand_folded').execute({ spanId: 'sp_cccc3333', limit: 40 })
  assert.equal(first.ok, true)
  assert.equal(first.text.length, 40)
  assert.equal(first.total, 100)
  assert.equal(first.truncated, true)
  assert.match(first.message, /offset=40/)

  const second = await ctx._tools.get('expand_folded').execute({ spanId: 'sp_cccc3333', offset: 40, limit: 40 })
  assert.equal(second.text.length, 40)
  const last = await ctx._tools.get('expand_folded').execute({ spanId: 'sp_cccc3333', offset: 80, limit: 40 })
  assert.equal(last.truncated, false)
})

test('store：按会话隔离，超出上限丢最旧', () => {
  resetStore()
  recordSpan('s1', { id: 'a', text: 'x', at: 1 })
  recordSpan('s2', { id: 'b', text: 'y', at: 2 })
  assert.equal(getSpan('s1', 'b'), undefined)
  assert.equal(getSpan('s1', 'a').text, 'x')
  for (let index = 0; index < 40; index += 1) recordSpan('s3', { id: `sp_${index}`, text: 'z', at: index })
  const spans = listSpans('s3')
  assert.equal(spans.length, 32)
  assert.equal(spans[0].id, 'sp_8')
})

test('store：归档文本超长时截断并标记', () => {
  resetStore()
  recordSpan('s1', { id: 'big', text: 'a'.repeat(400_050), at: 1 })
  const span = getSpan('s1', 'big')
  assert.equal(span.truncated, true)
  assert.ok(span.text.length < 400_100)
  assert.match(span.text, /归档截断/)
})

test('archive：转录带角色标签，excerpts 按关键词取窗口', () => {
  const text = renderTranscript(sampleMessages)
  assert.match(text, /<user>[\s\S]*<\/user>/)
  assert.match(text, /<tool>[\s\S]*ERR_MODULE_NOT_FOUND/)
  const hits = excerpts(text, 'ERR_MODULE_NOT_FOUND', { window: 40, max: 2 })
  assert.equal(hits.length, 1)
  assert.match(hits[0], /ERR_MODULE_NOT_FOUND/)
  // 关键词不存在时退回开头，不返回空
  assert.equal(excerpts(text, 'zzz-not-there', { window: 30 }).length, 1)
  assert.deepEqual(excerpts('', 'x'), [])
})

test('archive：spanId 稳定且带 sp_ 前缀', () => {
  const a = spanIdOf(sampleMessages, { at: 1 })
  const b = spanIdOf(sampleMessages, { at: 1 })
  const c = spanIdOf(sampleMessages, { at: 2 })
  assert.match(a, /^sp_[0-9a-f]{8}$/)
  assert.equal(a, b)
  assert.notEqual(a, c)
})
