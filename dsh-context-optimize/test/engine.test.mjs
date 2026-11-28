import { test } from 'node:test'
import assert from 'node:assert/strict'

import { apply } from '../compaction.js'

/**
 * 用假 ctx 把 compaction.js 的接线跑通：确认
 *   1. 它真的去 loader.import 了两个官方包；
 *   2. 它挂载的是一个继承自 basic 的子类；
 *   3. 折叠准入（首折放行 / 之后要够工具步）真的生效；
 *   4. 巡航成功时卡片带 claim，巡航失败时降级为确定性卡片。
 * 这不能替代"真机挂载"，但能把接线错误挡在安装之前。
 */

function makeFakeCtx(llmStream) {
  const listeners = new Map()
  const mounted = []
  const ctx = {
    loader: {
      async import(name) {
        if (name === '@deepseek-ai/dsh-compaction-basic') {
          class FakeBase {
            constructor(innerCtx, config) {
              FakeBase.lastConfig = config
              this.ctx = innerCtx
            }
            async compactIfNeeded() { return { shadowedSeqs: [1], shadowedRange: { start: 1, end: 1 } } }
            async summarize() { return { summary: [{ type: 'text', text: 'base' }] } }
          }
          return { BasicCompactionEngine: FakeBase, default: FakeBase }
        }
        if (name === '@deepseek-ai/dsh-llm') {
          class FakeAssembler {
            constructor() { this.texts = []; this.finish = { kind: 'stop' }; this.usage = { totalTokens: 1 } }
            push(chunk) { if (chunk && typeof chunk.text === 'string') this.texts.push(chunk.text) }
            blocks() { return this.texts.map((text) => ({ type: 'text', text })) }
          }
          return { BlockAssembler: FakeAssembler }
        }
        throw new Error(`unexpected import ${name}`)
      },
    },
    llm: { stream: llmStream },
    logger: { info() {}, warn() {} },
    plugin(pluginClass) { mounted.push(pluginClass) },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(handler)
      return () => {}
    },
    _listeners: listeners,
    _mounted: mounted,
  }
  return ctx
}

function fire(ctx, event, ...args) {
  for (const handler of ctx._listeners.get(event) ?? []) handler(...args)
}

const agent = {
  session: {
    id: 'sess-1',
    requestHeader: () => ({ config: { provider: 'deepseek', model: 'v4' } }),
    toolHistory: () => [],
  },
}

const regionInput = {
  messages: [
    { role: 'user', content: [{ type: 'text', text: '修好 dsh-mcp-compat 的输出模板' }] },
    { role: 'tool', content: [{ type: 'text', text: 'Error: ERR_MODULE_NOT_FOUND x' }] },
  ],
}

test('apply 挂载一个继承自 basic 的子类，并注入官方 Config 之外的默认值', async () => {
  const ctx = makeFakeCtx(async function* () { yield { text: 'CLAIM: 一句话\nOPEN: (none)' } })
  await apply(ctx, { minToolStepsBetweenFolds: 2 })
  assert.equal(ctx._mounted.length, 1)
  const Engine = ctx._mounted[0]
  assert.equal(typeof Engine, 'function')

  const instance = new Engine(ctx)
  // 阈值沿用官方默认（auto 打开）
  assert.deepEqual(Engine.lastConfig, { auto: true })
  assert.equal(instance.toolStepsSinceFold.size, 0)
})

test('折叠准入：首折放行；之后不足工具步则拒绝；够了再放行', async () => {
  const ctx = makeFakeCtx(async function* () { yield { text: 'CLAIM: x' } })
  await apply(ctx, { minToolStepsBetweenFolds: 3 })
  const Engine = ctx._mounted[0]
  const engine = new Engine(ctx)

  // 首折：无历史折叠 → 放行
  const first = await engine.compactIfNeeded(agent, 'pressure', { aborted: false })
  assert.notEqual(first, null)

  // 紧接着再来：只有 0 个工具步 → 拒绝
  assert.equal(await engine.compactIfNeeded(agent, 'pressure', { aborted: false }), null)

  // 一个工具步
  fire(ctx, 'session/event', { id: 'sess-1' }, { type: 'tool/call' })
  assert.equal(await engine.compactIfNeeded(agent, 'pressure', { aborted: false }), null)

  // 凑够 3 步
  fire(ctx, 'session/event', { id: 'sess-1' }, { type: 'tool/call' })
  fire(ctx, 'session/event', { id: 'sess-1' }, { type: 'tool/call' })
  assert.notEqual(await engine.compactIfNeeded(agent, 'pressure', { aborted: false }), null)

  // 溢出恢复不受闸门限制
  fire(ctx, 'session/event', { id: 'sess-1' }, { type: 'tool/call' })
  assert.notEqual(await engine.compactIfNeeded(agent, 'context-overflow', { aborted: false }), null)
})

test('summarize 产出卡片：claim 来自巡航，文件/错误由代码抽取', async () => {
  const ctx = makeFakeCtx(async function* () {
    yield { text: 'CLAIM: 把输出模板修好了\nCONCLUDE:\n- 模板只能 AI 生成\nOPEN:\n- Windows 路径没验' }
  })
  await apply(ctx, {})
  const engine = new (ctx._mounted[0])(ctx)

  const result = await engine.summarize(regionInput, agent, undefined)
  assert.equal(result.llmStreamCall, true)
  assert.equal(result.provider, 'deepseek')
  assert.equal(result.model, 'v4')
  const text = result.summary[0].text
  assert.ok(text.includes('把输出模板修好了'), '缺少巡航 claim')
  assert.ok(text.includes('## 原始请求'), '缺少原始请求段')
  assert.ok(text.includes('ERR_MODULE_NOT_FOUND'), '缺少错误抽取')
  assert.ok(text.includes('## 未闭合\n- Windows 路径没验'), '缺少未闭合项')
  // 没有 ask/expand 工具时不许渲染取回段
  assert.ok(!text.includes('## 取回'))
})

test('summarize 在巡航失败时降级为确定性卡片，不抛错', async () => {
  const ctx = makeFakeCtx(async function* () { throw new Error('模型 429') })
  await apply(ctx, {})
  const engine = new (ctx._mounted[0])(ctx)

  const result = await engine.summarize(regionInput, agent, undefined)
  const text = result.summary[0].text
  assert.ok(text.includes('（未标注）'), '降级卡片应标注未取得 claim')
  assert.ok(text.includes('dsh-mcp-compat') || text.includes('ERR_MODULE_NOT_FOUND'))
})

test('summarize 在没有路由时给出清晰错误', async () => {
  const ctx = makeFakeCtx(async function* () { yield { text: '' } })
  await apply(ctx, {})
  const engine = new (ctx._mounted[0])(ctx)
  const bareAgent = { session: { id: 'x', requestHeader: () => undefined, toolHistory: () => [] } }
  await assert.rejects(() => engine.summarize(regionInput, bareAgent, undefined), /没有可用的巡航路由/)
})
