// 纯逻辑：30 秒窗口（对官方投影采样）、整段折叠、格式化、文案与官方逐字一致。
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadClient, installLocalStorage } from './harness.mjs'

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
  foldStats,
  sessionAverage,
  windowTps,
  recordSample,
  historyFor,
  resetHistories,
} = internals

/** 一步已结算的 assistant 节点（仅 foldStats / stepReading 用） */
function assistant({ firstTokenTime, completedTime, outputTokens, turn = 1 }) {
  return {
    kind: 'assistant',
    turn,
    timing: { stepStartTime: firstTokenTime - 500, firstTokenTime, completedTime },
    usage: { outputTokens },
  }
}

/** 一次采样点 */
const sample = (t, tokens, ms) => ({ t, tokens, ms })

test('导出契约：name / inject / version', () => {
  assert.equal(exports.name, NS)
  assert.equal(NS, 'dsh-recent-tps')
  assert.deepEqual(exports.inject, ['slots', 'locale'])
  assert.equal(VERSION, '0.1.2')
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

test('sessionAverage：整段口径（冷启动兜底），Δms 为 0 时 null', () => {
  assert.equal(sessionAverage({ decodeTokens: 600, decodeMs: 3000 }), 200)
  assert.equal(sessionAverage({ decodeTokens: 0, decodeMs: 0 }), null)
  assert.equal(sessionAverage({ decodeTokens: 5, decodeMs: 0 }), null)
  assert.equal(sessionAverage(undefined), null)
})

test('windowTps：锚在最后一个采样点，窗口 = [锚点-30s, 锚点]', () => {
  // 样本不足
  assert.equal(windowTps([]), null)
  assert.equal(windowTps([sample(0, 0, 0)]), null)
  // 两个样本：100 token / 1 秒
  assert.equal(windowTps([sample(0, 0, 0), sample(1000, 100, 1000)]), 100)
  // 30 秒窗口：锚点 50s，取「不晚于 20s」的最后一个样本作基线
  const samples = [
    sample(0, 0, 0),
    sample(10000, 100, 1000),
    sample(20000, 200, 2000),
    sample(40000, 500, 4000),
    sample(50000, 800, 5000),
  ]
  // 基线 = t=20s（200 token / 2000ms）→ 600 token / 3000ms = 200
  assert.equal(windowTps(samples), 200)
  // Δms 为 0 / Δtoken 为 0 都不出数
  assert.equal(windowTps([sample(0, 0, 100), sample(1000, 50, 100)]), null)
  assert.equal(windowTps([sample(0, 50, 100), sample(1000, 50, 200)]), null)
})

test('recordSample：冷启动退回整段速度，之后换成窗口值', () => {
  resetHistories()
  const first = recordSample({ samples: [], tps: null }, { decodeTokens: 150, decodeMs: 3000, steps: 2 }, 1000)
  assert.equal(first.samples.length, 1)
  assert.equal(first.tps, 50, '只有一个样本时退回整段速度（150/3s）')

  const second = recordSample(first, { decodeTokens: 250, decodeMs: 4000, steps: 2 }, 2000)
  assert.equal(second.samples.length, 2)
  assert.equal(second.tps, 100, '窗口值 = 100 token / 1 秒')
})

test('recordSample：投影没变化就不记、读数保持（永不变「—」）', () => {
  resetHistories()
  let history = recordSample({ samples: [], tps: null }, { decodeTokens: 150, decodeMs: 3000 }, 1000)
  history = recordSample(history, { decodeTokens: 250, decodeMs: 4000 }, 2000)
  const frozen = history.tps
  // 模拟「生成停下来」：墙上时钟过了很久，但投影不再变化
  const later = recordSample(history, { decodeTokens: 250, decodeMs: 4000 }, 900000)
  assert.equal(later, history, '同一个引用：不记新样本、不产生新渲染')
  assert.equal(later.tps, frozen)
})

test('recordSample：新 step 没有解码时间（Δms=0）时沿用上一次有效读数', () => {
  resetHistories()
  let history = recordSample({ samples: [], tps: null }, { decodeTokens: 150, decodeMs: 3000 }, 1000)
  history = recordSample(history, { decodeTokens: 250, decodeMs: 4000 }, 2000)
  const before = history.tps
  // 一步结算但 usage 没报（decodeMs 不动）
  history = recordSample(history, { decodeTokens: 250, decodeMs: 4000 }, 3000)
  assert.equal(history.samples.length, 2, '没变化就不记样本')
  // 再下一次有了解码时间
  history = recordSample(history, { decodeTokens: 400, decodeMs: 5000 }, 5000)
  assert.equal(history.samples.length, 3)
  assert.notEqual(history.tps, null)
  assert.ok(history.tps > 0)
  assert.equal(before, 100)
})

test('recordSample：采样历史只保留最近 2 分钟', () => {
  resetHistories()
  let history = { samples: [], tps: null }
  for (let i = 0; i <= 20; i += 1) {
    history = recordSample(history, { decodeTokens: i * 100, decodeMs: i * 1000 }, i * 10000) // 每 10 秒一笔，共 200 秒
  }
  assert.ok(history.samples.length <= 13, `只保留 2 分钟：实际 ${history.samples.length}`)
  assert.equal(history.samples[history.samples.length - 1].t, 200000)
})

test('historyFor：按会话隔离；resetHistories 清空', () => {
  resetHistories()
  const a = historyFor('session-a')
  a.samples.push(sample(1, 1, 1))
  a.tps = 42
  assert.equal(historyFor('session-a').tps, 42)
  assert.equal(historyFor('session-b').tps, null)
  resetHistories()
  assert.equal(historyFor('session-a').tps, null, '清空后重新开始')
})

test('localStorage：刷新页面后立刻恢复上次读数', () => {
  const storage = installLocalStorage()
  storage.setItem('dsh-recent-tps:v1', JSON.stringify({
    'session-x': { samples: [{ t: 1000, tokens: 100, ms: 1000 }, { t: 2000, tokens: 200, ms: 2000 }], tps: 100 },
    bad: { samples: 'nope' },
  }))
  resetHistories() // 重置 loaded 标记，让下一次 historyFor 重新读盘
  const restored = historyFor('session-x')
  assert.equal(restored.tps, 100, '恢复上次有效读数（因此刷新后不会先闪「—」）')
  assert.equal(restored.samples.length, 2)
  assert.equal(historyFor('bad').tps, null, '非法条目丢弃')
})

test('stepReading / foldStats：官方口径的兜底折叠（投影缺失时）', () => {
  assert.deepEqual(stepReading(assistant({ firstTokenTime: 1000, completedTime: 3000, outputTokens: 100 })), {
    start: 1000,
    end: 3000,
    span: 2000,
    tokens: 100,
  })
  assert.equal(stepReading(null), null)
  assert.equal(stepReading({ kind: 'assistant' }), null)

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
  assert.equal(stats.decodeMs, 2000 + 1000)
  assert.equal(stats.decodeTokens, 150)
  assert.equal(formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1000)), '50')
  assert.equal(foldStats(undefined).steps, 0)
})
