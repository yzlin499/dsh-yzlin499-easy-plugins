import test from 'node:test'
import assert from 'node:assert/strict'

import {
  QUOTA_CODES,
  computeResumeAt,
  isQuotaFailure,
  isQuotaRecovered,
  pickResetWindow,
  providerMatches,
  shouldPark,
} from '../lib/guard.js'

const NOW = Date.UTC(2026, 10, 9, 0, 0, 0)

test('QUOTA_CODES 覆盖三种耗尽码', () => {
  assert.deepEqual([...QUOTA_CODES].sort(), ['ACCOUNT_QUOTA', 'QUOTA', 'RATE_LIMIT'])
})

test('isQuotaFailure 按 code / status 判定，不看文案', () => {
  assert.equal(isQuotaFailure({ code: 'QUOTA', message: 'x' }), true)
  assert.equal(isQuotaFailure({ code: 'rate_limit' }), true) // 大小写不敏感
  assert.equal(isQuotaFailure({ code: 'ACCOUNT_QUOTA' }), true)
  assert.equal(isQuotaFailure({ code: 'SERVER', status: 500 }), false)
  // 没有已知 code 但 HTTP 429 也算
  assert.equal(isQuotaFailure({ code: 'HTTP_429', status: 429 }), true)
  assert.equal(isQuotaFailure({ code: 'CONTEXT_WINDOW_EXCEEDED' }), false)
  assert.equal(isQuotaFailure(null), false)
  assert.equal(isQuotaFailure(undefined), false)
  assert.equal(isQuotaFailure('QUOTA'), false)
})

test('providerMatches 空 pattern 接管全部，非法正则退回接管', () => {
  assert.equal(providerMatches('pi-ai', ''), true)
  assert.equal(providerMatches('ark', 'ark|volc|doubao|pi-ai'), true)
  assert.equal(providerMatches('PI-AI', 'ark|pi-ai'), true)
  assert.equal(providerMatches('openai', 'ark|volc'), false)
  assert.equal(providerMatches('ark', '['), true) // 非法正则
  assert.equal(providerMatches(undefined, 'ark'), false)
})

test('pickResetWindow 只挑未来窗口里最早的一个', () => {
  const windows = [
    { level: 'session', percent: 100, resetAtMs: NOW + 3_600_000 },
    { level: 'weekly', percent: 100, resetAtMs: NOW + 600_000 },
    { level: 'monthly', percent: 5, resetAtMs: NOW - 1000 }, // 已过去 → 忽略
  ]
  assert.equal(pickResetWindow(windows, { now: NOW }).level, 'weekly')
})

test('pickResetWindow 优先已耗尽窗口，其次退未来窗口', () => {
  const mixed = [
    { level: 'weekly', percent: 40, resetAtMs: NOW + 1000 },
    { level: 'monthly', percent: 99.9, resetAtMs: NOW + 5000 },
  ]
  assert.equal(pickResetWindow(mixed, { now: NOW, exhaustedPercent: 99.5 }).level, 'monthly')

  const noneExhausted = [
    { level: 'weekly', percent: 40, resetAtMs: NOW + 5000 },
    { level: 'monthly', percent: 10, resetAtMs: NOW + 1000 },
  ]
  assert.equal(pickResetWindow(noneExhausted, { now: NOW }).level, 'monthly')
})

test('pickResetWindow 无未来窗口返回 null', () => {
  assert.equal(pickResetWindow([], { now: NOW }), null)
  assert.equal(pickResetWindow(null, { now: NOW }), null)
  assert.equal(
    pickResetWindow([{ level: 'weekly', percent: 100, resetAtMs: NOW - 1 }], { now: NOW }),
    null,
  )
  assert.equal(
    pickResetWindow([{ level: 'weekly', percent: 100, resetAtMs: null }], { now: NOW }),
    null,
  )
})

test('isQuotaRecovered：未耗尽即恢复；耗尽且未到重置时刻才算没恢复', () => {
  assert.equal(isQuotaRecovered([], { now: NOW }), true)
  assert.equal(
    isQuotaRecovered([{ level: 'weekly', percent: 3, resetAtMs: NOW + 1000 }], { now: NOW }),
    true,
  )
  assert.equal(
    isQuotaRecovered([{ level: 'weekly', percent: 100, resetAtMs: NOW + 1000 }], { now: NOW }),
    false,
  )
  // 已过重置时刻（服务端延迟）也算恢复
  assert.equal(
    isQuotaRecovered([{ level: 'weekly', percent: 100, resetAtMs: NOW - 1 }], { now: NOW }),
    true,
  )
})

test('computeResumeAt = 重置时刻 + 冗余，且不早于现在', () => {
  assert.equal(computeResumeAt({ resetAtMs: NOW + 100_000, now: NOW, bufferMs: 10_000 }), NOW + 110_000)
  // 冗余为负数 / 非法时按 0
  assert.equal(computeResumeAt({ resetAtMs: NOW + 100_000, now: NOW, bufferMs: -5 }), NOW + 100_000)
  // 重置时刻已过 → 至少是现在
  assert.equal(computeResumeAt({ resetAtMs: NOW - 100_000, now: NOW, bufferMs: 0 }), NOW)
})

test('shouldPark 逐条闸门', () => {
  const base = {
    failure: { code: 'QUOTA', message: 'x' },
    provider: 'ark',
    providerPattern: 'ark|volc',
    now: NOW,
    minParkMs: 60_000,
    resetAtMs: NOW + 3_600_000,
  }
  assert.deepEqual(shouldPark(base), { park: true, reason: 'quota-exhausted' })

  // 已经在队列里
  assert.equal(shouldPark({ ...base, alreadyParked: true }).reason, 'already-parked')
  // 不是额度错误
  assert.equal(shouldPark({ ...base, failure: { code: 'SERVER' } }).reason, 'not-quota')
  // provider 不匹配
  assert.equal(shouldPark({ ...base, provider: 'openai' }).reason, 'provider-mismatch')
  // 拿不到重置时间
  assert.equal(shouldPark({ ...base, resetAtMs: null }).reason, 'no-reset-time')
  // 离重置太近，交给普通重试
  assert.equal(
    shouldPark({ ...base, resetAtMs: NOW + 5_000, minParkMs: 60_000 }).reason,
    'reset-too-soon',
  )
})
