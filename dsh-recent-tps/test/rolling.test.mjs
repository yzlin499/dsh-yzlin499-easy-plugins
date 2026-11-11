// 纯逻辑：30 秒窗口速度、整段折叠、格式化、文案与官方逐字一致。
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadClient } from './harness.mjs'

const { exports, internals } = loadClient()
const {
  NS,
  VERSION,
  WINDOW_MS,
  DICT,
  normalizeMode,
  translate,
  formatTokensPerSecond,
  formatDuration,
  stepReading,
  lastDecodeEnd,
  rollingSpeed,
  foldStats,
} = internals

/** 一步已结算的 assistant 节点 */
function assistant({ firstTokenTime, completedTime, outputTokens, turn = 1 }) {
  return {
    kind: 'assistant',
    turn,
    timing: { stepStartTime: firstTokenTime - 500, firstTokenTime, completedTime },
    usage: { outputTokens },
  }
}

test('导出契约：name / inject / version', () => {
  assert.equal(exports.name, NS)
  assert.equal(NS, 'dsh-recent-tps')
  assert.deepEqual(exports.inject, ['slots', 'locale'])
  assert.equal(VERSION, '0.1.1')
  assert.equal(typeof exports.apply, 'function')
})

test('窗口固定 30 秒', () => {
  assert.equal(WINDOW_MS, 30000)
})

test('文案与官方 ui-chat 逐字一致（官方改面板时这条先失败）', () => {
  // 期望值抄自 dsh-client-ui-chat 的 zh / en 字典（0.2.2-rc.1）
  const official = {
    zh: {
      counts: '{turns} 轮 {steps} 步',
      dialogTitle: '会话统计',
      llmTime: '模型用时',
      toolTime: '工具调用用时',
      ttft: '首 token 平均（TTFT）',
      speed: '输出速度（TPS）',
      tokensPerSecond: '{tps} tok/s',
      compactSeconds: '{seconds}秒',
      compactMinutes: '{minutes}分{seconds}秒',
    },
    en: {
      counts: '{turns} turns {steps} steps',
      dialogTitle: 'Session statistics',
      llmTime: 'LLM time',
      toolTime: 'Tool time',
      ttft: 'Avg time to first token (TTFT)',
      speed: 'Tokens per second (TPS)',
      tokensPerSecond: '{tps} tok/s',
      compactSeconds: '{seconds}s',
      compactMinutes: '{minutes}m{seconds}s',
    },
  }
  for (const lang of ['zh', 'en']) {
    for (const [key, value] of Object.entries(official[lang])) {
      assert.equal(DICT[lang][key], value, `${lang}.${key} 必须与官方逐字一致`)
    }
  }
})

test('字典：中英键集一致、无空文案', () => {
  assert.deepEqual(Object.keys(DICT.zh).sort(), Object.keys(DICT.en).sort(), '中英文案必须同键')
  for (const lang of ['zh', 'en']) {
    for (const [key, value] of Object.entries(DICT[lang])) {
      assert.equal(typeof value, 'string', `${lang}.${key} 必须是字符串`)
      assert.notEqual(value.trim(), '', `${lang}.${key} 不能为空`)
    }
  }
  assert.equal(DICT.zh.recentSpeed, '最近 30 秒速度')
  assert.equal(DICT.en.recentSpeed, 'Last 30s speed')
  assert.equal(DICT.zh.none, '—')
})

test('normalizeMode：只有 compact 才走简洁模式', () => {
  assert.equal(normalizeMode('compact'), 'compact')
  assert.equal(normalizeMode('detailed'), 'detailed')
  assert.equal(normalizeMode(undefined), 'detailed')
  assert.equal(normalizeMode('normal'), 'detailed')
})

test('translate：占位符替换，未知键原样返回', () => {
  assert.equal(translate(DICT.zh, 'tokensPerSecond', { tps: '5.2' }), '5.2 tok/s')
  assert.equal(translate(DICT.zh, 'counts', { turns: 2, steps: 174 }), '2 轮 174 步')
  assert.equal(translate(DICT.en, 'counts', { turns: 2, steps: 174 }), '2 turns 174 steps')
  assert.equal(translate(DICT.zh, 'notAKey'), 'notAKey')
})

test('formatTokensPerSecond：≥10 取整，<10 一位小数，非法值归零', () => {
  assert.equal(formatTokensPerSecond(218.4), '218')
  assert.equal(formatTokensPerSecond(9.94), '9.9')
  assert.equal(formatTokensPerSecond(-3), '0')
  assert.equal(formatTokensPerSecond(Number.NaN), '0')
})

test('formatDuration：与官方同口径', () => {
  assert.equal(formatDuration(910000, DICT.zh), '15分10秒')
  assert.equal(formatDuration(165000, DICT.zh), '2分45秒')
  assert.equal(formatDuration(2200, DICT.zh), '2.2秒')
  assert.equal(formatDuration(165000, DICT.en), '2m45s')
})

test('stepReading：只认带 timing + usage 的 assistant 节点', () => {
  assert.deepEqual(stepReading(assistant({ firstTokenTime: 1000, completedTime: 3000, outputTokens: 100 })), {
    start: 1000,
    end: 3000,
    span: 2000,
    tokens: 100,
  })
  assert.equal(stepReading(null), null)
  assert.equal(stepReading({ kind: 'tool-result' }), null)
  assert.equal(stepReading({ kind: 'assistant' }), null)
  assert.equal(
    stepReading({ kind: 'assistant', timing: { firstTokenTime: 1, completedTime: 2 }, usage: { outputTokens: -1 } }),
    null,
    '负 token 丢弃',
  )
})

test('rollingSpeed：30 秒窗口内的解码速度', () => {
  const node = assistant({ firstTokenTime: 1000, completedTime: 3000, outputTokens: 100 })
  assert.equal(rollingSpeed([node], 3000, WINDOW_MS).tps, 50, '100 token / 2 秒')
  assert.equal(rollingSpeed([node], 100000, WINDOW_MS), null, '锚点离得太远：窗口里没有解码时间')
  assert.equal(rollingSpeed([], 3000, WINDOW_MS), null)
  assert.equal(rollingSpeed(undefined, 3000, WINDOW_MS), null)
})

test('lastDecodeEnd：取最后一个已结算 step 的完成时刻', () => {
  const nodes = [
    assistant({ firstTokenTime: 1000, completedTime: 3000, outputTokens: 100 }),
    assistant({ firstTokenTime: 5000, completedTime: 7000, outputTokens: 60, turn: 2 }),
    { kind: 'user', turn: 3, time: 9999 },
  ]
  assert.equal(lastDecodeEnd(nodes), 7000)
  assert.equal(lastDecodeEnd([]), null)
  assert.equal(lastDecodeEnd(undefined), null)
  assert.equal(lastDecodeEnd([{ kind: 'user' }]), null, '没有 assistant 节点就没有锚点')
  assert.equal(lastDecodeEnd([{ kind: 'assistant', turn: 1 }]), null, '没有 timing 就没有锚点')
})

test('锚定语义：没有新 step 结算时读数恒定，不会衰减成 null', () => {
  // 两步：100 token / 2 秒 + 50 token / 1 秒 = 150 token / 3 秒 = 50 tok/s
  const nodes = [
    assistant({ firstTokenTime: 0, completedTime: 2000, outputTokens: 100 }),
    assistant({ firstTokenTime: 2000, completedTime: 3000, outputTokens: 50, turn: 2 }),
  ]
  const anchor = lastDecodeEnd(nodes)
  assert.equal(anchor, 3000, '锚点 = 最后一步完成时刻')
  const first = rollingSpeed(nodes, anchor, WINDOW_MS)
  assert.equal(first.tps, 50)
  // 反复取（等价于墙上时钟过了多久、重渲染多少次）都必须一模一样 —— 这是「不消失」的根据
  assert.deepEqual(rollingSpeed(nodes, lastDecodeEnd(nodes), WINDOW_MS), first)
  assert.deepEqual(rollingSpeed(nodes, lastDecodeEnd(nodes), WINDOW_MS), first)
  // 即便真实时间已经过去很久，锚点仍停在最后一个 step 上，读数不 decay
  const longAfter = Date.now() + 24 * 60 * 60 * 1000
  assert.ok(longAfter > anchor + WINDOW_MS, '墙上时钟确实早已滑出窗口')
  assert.deepEqual(rollingSpeed(nodes, lastDecodeEnd(nodes), WINDOW_MS), first)
})

test('rollingSpeed：跨窗口边界按重叠比例裁剪', () => {
  // 60 秒产出 600 token；now 只走到窗口末尾 → 30 秒的份额 = 300 token / 30 秒 = 10 tok/s
  const long = assistant({ firstTokenTime: 0, completedTime: 60000, outputTokens: 600 })
  const half = rollingSpeed([long], 30000, WINDOW_MS)
  assert.equal(half.tokens, 300)
  assert.equal(half.decodeMs, 30000)
  assert.equal(half.tps, 10)
})

test('rollingSpeed：多步累加，零宽步骤跳过', () => {
  const a = assistant({ firstTokenTime: 0, completedTime: 1000, outputTokens: 20 })
  const b = assistant({ firstTokenTime: 5000, completedTime: 7000, outputTokens: 60, turn: 2 })
  const result = rollingSpeed([a, b], 7000, WINDOW_MS)
  assert.equal(result.tokens, 80)
  assert.equal(result.decodeMs, 3000)
  assert.equal(result.tps, 80 / 3)
  const zero = { kind: 'assistant', turn: 1, timing: { firstTokenTime: 1000, completedTime: 1000 }, usage: { outputTokens: 42 } }
  assert.equal(rollingSpeed([zero], 1000, WINDOW_MS), null)
})

test('foldStats：与官方 deriveStats 同口径（投影缺失时的兜底）', () => {
  const steps = [
    { kind: 'assistant', turn: 1, timing: { stepStartTime: 0, firstTokenTime: 500, completedTime: 2500 }, usage: { outputTokens: 100 } },
    { kind: 'tool-result', callTime: 2500, time: 3000 },
    { kind: 'assistant', turn: 1, timing: { stepStartTime: 3000, firstTokenTime: 3500, completedTime: 4500 }, usage: { outputTokens: 50 } },
    { kind: 'user', turn: 2 },
  ]
  const stats = foldStats(steps)
  assert.equal(stats.turns, 1, '同一轮的多个 step 只算一轮')
  assert.equal(stats.steps, 2)
  assert.equal(stats.llmMs, 2500 + 1500)
  assert.equal(stats.toolMs, 500)
  assert.equal(stats.ttftMs, 500 + 500)
  assert.equal(stats.ttftSteps, 2)
  assert.equal(stats.decodeMs, 2000 + 1000)
  assert.equal(stats.decodeTokens, 150)
  assert.equal(formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1000)), '50')
})

test('foldStats：空输入安全', () => {
  const stats = foldStats(undefined)
  assert.equal(stats.steps, 0)
  assert.equal(stats.decodeMs, 0)
  assert.equal(rollingSpeed([], 0, WINDOW_MS), null)
})
