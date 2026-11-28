import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * client.js 是 __ModuleLoader__ 静态格式的模块：它一被执行就调用
 * `window.__ModuleLoader__.load({ factory })`。这里用一个假 window 把 factory
 * 接住，再直接测 factory 暴露的纯函数（避免为了测试在浏览器里跑一遍）。
 */

let factory
globalThis.window = {
  __ModuleLoader__: {
    load(spec) { factory = spec.factory },
  },
}

await import('../client.js')
const mod = factory(() => ({ createElement() {}, useMemo: (fn) => fn() }))
const { summarizeNodes, axisCells, formatTokens, translate, DICT, NS } = mod.__internals

test('插件自报 id 与服务注入面', () => {
  assert.equal(NS, 'dsh-context-optimize')
  assert.deepEqual(mod.inject, ['slots', 'locale'])
  assert.equal(typeof mod.apply, 'function')
})

test('summarizeNodes 只数 compaction 节点，并尽量读出折叠 token', () => {
  const nodes = [
    { kind: 'user' },
    { kind: 'step' },
    { kind: 'compaction', turn: 3, data: { shadowedTokenCount: 1200 } },
    { kind: 'tool-call' },
    { kind: 'manual-compaction', turn: 5, data: { shadowedTokenCount: 800 } },
    { kind: 'assistant-step', tokens: 999 },
  ]
  const summary = summarizeNodes(nodes)
  assert.equal(summary.folded, 2)
  assert.equal(summary.foldedTokens, 2000)
  assert.deepEqual([...summary.foldedTurns].sort((a, b) => a - b), [3, 5])
})

test('summarizeNodes 读不到 token 时给 null，不猜数字', () => {
  const summary = summarizeNodes([{ kind: 'compaction', turn: 2 }])
  assert.equal(summary.folded, 1)
  assert.equal(summary.foldedTokens, null)
})

test('summarizeNodes 对空值/非数组不抛错', () => {
  for (const input of [undefined, null, [], 'x', 42]) {
    const summary = summarizeNodes(input)
    assert.equal(summary.folded, 0)
    assert.equal(summary.foldedTokens, null)
  }
})

test('axisCells 每轮一格，折叠区间标暗，最后一格标 now', () => {
  const cells = axisCells(4, new Set([2]))
  assert.equal(cells.length, 4)
  assert.deepEqual(cells.map((cell) => cell.folded), [false, true, false, false])
  assert.deepEqual(cells.map((cell) => cell.now), [false, false, false, true])
})

test('axisCells 对异常轮数收敛（负数/NaN/超大）', () => {
  assert.equal(axisCells(-3, new Set()).length, 0)
  assert.equal(axisCells(Number.NaN, new Set()).length, 0)
  assert.equal(axisCells(10000, new Set()).length, 80)
})

test('formatTokens 与 translate 的边界', () => {
  assert.equal(formatTokens(999), '999')
  assert.equal(formatTokens(148200), '148.2K')
  assert.equal(formatTokens(undefined), '—')
  assert.equal(translate(DICT.zh, 'folded', { n: 3 }), '已折叠 3 段')
  assert.equal(translate(DICT.en, 'noFold', {}), 'nothing folded yet')
  // 未知模板原样返回，避免渲染出 undefined
  assert.equal(translate(DICT.zh, 'missing-key', {}), 'missing-key')
})
