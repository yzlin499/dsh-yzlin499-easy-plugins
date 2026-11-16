import test from 'node:test'
import assert from 'node:assert/strict'

import { formatCountdown, formatLocalTime, parseResetTimeMs } from '../lib/reset.js'

const CST_OFFSET_MINUTES = 480

test('解析带 +0800 偏移的英文文案（magpie 里的真实 429）', () => {
  const message =
    '429: {"code":"AccountQuotaExceeded","message":"You have exceeded the weekly usage quota. It will reset at 2026-11-09 00:00:00 +0800 CST. We recommend upgrading your plan."}'
  const expected = Date.UTC(2026, 10, 9, 0, 0, 0) - CST_OFFSET_MINUTES * 60_000
  assert.equal(parseResetTimeMs(message), expected)
})

test('解析不带时区的中文文案，默认按东八区', () => {
  const message = '已达到 5 小时的使用上限。您的限额将在 2026-08-15 12:00:47 重置。'
  const expected = Date.UTC(2026, 7, 15, 12, 0, 47) - CST_OFFSET_MINUTES * 60_000
  assert.equal(parseResetTimeMs(message), expected)
})

test('解析 ISO 形式（+08:00 / Z）', () => {
  const offset = parseResetTimeMs('weekly quota exhausted, resets at 2026-10-25T23:59:59+08:00')
  assert.equal(offset, Date.UTC(2026, 9, 25, 23, 59, 59) - CST_OFFSET_MINUTES * 60_000)

  const utc = parseResetTimeMs('resets at 2026-10-25T23:59:59Z')
  assert.equal(utc, Date.UTC(2026, 9, 25, 23, 59, 59))
})

test('解析带毫秒的时间', () => {
  const message = 'reset at 2026-11-09 00:00:00.250 +0800'
  const expected = Date.UTC(2026, 10, 9, 0, 0, 0, 250) - CST_OFFSET_MINUTES * 60_000
  assert.equal(parseResetTimeMs(message), expected)
})

test('可配置默认时区', () => {
  const message = '您的限额将在 2026-08-15 12:00:47 重置'
  assert.equal(
    parseResetTimeMs(message, 0),
    Date.UTC(2026, 7, 15, 12, 0, 47),
  )
})

test('解析裸时间戳（秒 / 毫秒）', () => {
  assert.equal(parseResetTimeMs('{"reset_timestamp": 1782057600}'), 1_782_057_600_000)
  assert.equal(parseResetTimeMs('"resetTime": 1785686400000'), 1_785_686_400_000)
})

test('无匹配 / 空值 / 非法年份返回 null', () => {
  assert.equal(parseResetTimeMs(''), null)
  assert.equal(parseResetTimeMs(null), null)
  assert.equal(parseResetTimeMs(undefined), null)
  assert.equal(parseResetTimeMs('quota exceeded, try again later'), null)
  // 年份不在合理区间
  assert.equal(parseResetTimeMs('reset at 1899-01-01 00:00:00 +0800'), null)
})

test('formatCountdown 多级文案', () => {
  const now = Date.UTC(2026, 10, 9, 0, 0, 0)
  assert.equal(formatCountdown(now, now), '已重置')
  assert.equal(formatCountdown(now - 1000, now), '已重置')
  assert.equal(formatCountdown(now + 30_000, now), '30秒')
  assert.equal(formatCountdown(now + (2 * 60 + 5) * 1000, now), '2分5秒')
  assert.equal(formatCountdown(now + 3 * 3600 * 1000, now), '3小时0分0秒')
  assert.equal(formatCountdown(now + (86400 + 3600) * 1000, now), '1天1小时0分0秒')
  assert.equal(formatCountdown(Number.NaN, now), '—')
})

test('formatLocalTime 输出可读本地时间', () => {
  const stamp = new Date(2026, 10, 9, 8, 5, 3).getTime()
  assert.equal(formatLocalTime(stamp), '2026-11-09 08:05:03')
  assert.equal(formatLocalTime(Number.NaN), '—')
})
