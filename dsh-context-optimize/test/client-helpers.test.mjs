import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * client.js 是 __ModuleLoader__ 静态格式的模块：一执行就调用
 * `window.__ModuleLoader__.load({ factory })`。用假 window 接住 factory，
 * 再测它暴露的纯函数与两条挂载路径（侧边栏 / dock 回退）。
 */

let factory
globalThis.window = { __ModuleLoader__: { load(spec) { factory = spec.factory } } }

await import('../client.js')
const mod = factory(() => ({ createElement() {}, useEffect() {}, useState() {} }))
const { formatTokens, formatTime, translate, outlineRows, gateState, DICT, ENDPOINT } = mod.__internals

function makeCtx({ sidebar, slots } = {}) {
  const calls = { effects: 0, tabs: [], dockInject: [] }
  const ctx = {
    get(name) {
      if (name === 'betterSidebar') return sidebar
      return undefined
    },
    effect(fn) { calls.effects += 1; return fn() },
    slots: slots ?? {
      inject(key, cb) { calls.dockInject.push(key); return cb() },
      register(spec) { calls.dockInject.push(`register:${spec.id}`); return () => {} },
    },
  }
  return { ctx, calls }
}

test('插件 id / 注入面 / 接口路径', () => {
  assert.equal(mod.name, 'dsh-context-optimize')
  assert.deepEqual(mod.inject, ['slots', 'locale'])
  assert.equal(ENDPOINT, '/context-optimize/outline')
  assert.equal(typeof mod.apply, 'function')
})

test('有 betterSidebar 时注册成侧边栏 tab，不碰 dock', () => {
  const sidebar = { registerTab(descriptor) { this.captured = descriptor; return () => {} } }
  const { ctx, calls } = makeCtx({ sidebar })
  mod.apply(ctx)
  assert.equal(sidebar.captured.id, 'dsh-context-optimize:outline')
  assert.equal(typeof sidebar.captured.title(), 'string')
  assert.equal(typeof sidebar.captured.description(), 'string')
  assert.equal(sidebar.captured.order, 60)
  assert.equal(typeof sidebar.captured.component, 'function')
  assert.deepEqual(calls.dockInject, [], '有侧边栏时不该再往 dock 挂东西')
})

test('没有 betterSidebar 时回退到 dock 一行', () => {
  const { ctx, calls } = makeCtx({ sidebar: undefined })
  mod.apply(ctx)
  assert.ok(calls.dockInject.includes('conversation.composer.dock'))
  assert.ok(calls.dockInject.some((value) => String(value).startsWith('register:context-optimize-axis')))
})

test('outlineRows 把 Host 载荷整理成行，缺字段降级', () => {
  const rows = outlineRows({
    entries: [
      { tokens: 48213, nodes: 546, at: Date.UTC(2026, 10, 28, 12, 30), trigger: 'pressure' },
      { tokens: 8000, nodes: 120, at: 0, trigger: 'context-overflow' },
      {},
    ],
  })
  assert.equal(rows.length, 3)
  assert.equal(rows[0].tokens, '48.2K')
  assert.equal(rows[0].nodes, '546')
  assert.equal(rows[0].trigger, 'pressure')
  assert.equal(rows[1].trigger, 'overflow')
  assert.equal(rows[2].tokens, '—')
  assert.equal(rows[2].nodes, '—')
  assert.equal(rows[2].time, '—')
  assert.deepEqual(outlineRows(undefined), [])
})

test('gateState 与 Host 闸门口径一致', () => {
  assert.deepEqual(gateState({ minToolSteps: 6, stepsSinceFold: 6 }), { ready: true, remaining: 0, min: 6, steps: 6 })
  assert.deepEqual(gateState({ minToolSteps: 6, stepsSinceFold: 2 }), { ready: false, remaining: 4, min: 6, steps: 2 })
  // min = 0 表示不设闸门
  assert.equal(gateState({ minToolSteps: 0, stepsSinceFold: 0 }).ready, true)
  // 缺字段时按「可折」处理，不阻塞展示
  assert.equal(gateState({}).ready, true)
})

test('formatTokens / formatTime / translate 的边界', () => {
  assert.equal(formatTokens(999), '999')
  assert.equal(formatTokens(148200), '148.2K')
  assert.equal(formatTokens(undefined), '—')
  assert.equal(formatTime(Number.NaN), '—')
  assert.equal(formatTime('not-a-date'), '—')
  assert.match(formatTime(Date.now()), /^\d{2}:\d{2}$/)
  assert.equal(translate(DICT.zh, 'gateWait', { n: 3 }), '距下次可折还需 3 个工具步')
  assert.equal(translate(DICT.en, 'none', {}), 'Nothing folded in this session yet.')
  assert.equal(translate(DICT.zh, 'missing-key', {}), 'missing-key')
})
