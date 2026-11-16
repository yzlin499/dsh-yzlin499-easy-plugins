// ═══════════════════════════════════════════════════════════════════════════
// dsh-ark-quota-guard / lib/reset.js — 从 429 / 额度报错文案里解析「什么时候重置」
//
// 方舟的 429 自带重置时刻，实测出现过这几种写法：
//   You have exceeded the weekly usage quota. It will reset at 2026-11-09 00:00:00 +0800 CST.
//   已达到 5 小时的使用上限。您的限额将在 2026-08-15 12:00:47 重置。
//   weekly quota exhausted, resets at 2026-10-25T23:59:59+08:00
// 前两种没有 / 带 `+0800` 偏移，第三种是 ISO。全部按同一套正则收口。
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 日期时间：`2026-11-09 00:00:00 +0800` / `2026-10-25T23:59:59+08:00` / `...Z`
 * 分组：年 月 日 时 分 秒 毫秒 Z 符号 时 分
 */
const DATETIME_RE =
  /(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?\s*(Z|[+-]\d{2}:?\d{2})?/i

/** 形如 `"reset_timestamp": 1782057600` 的裸时间戳（秒 10 位 / 毫秒 13 位） */
const EPOCH_RE = /"?(?:reset_?timestamp|resetAt|reset_at|resetTime)"?\s*[:=]\s*(\d{10,13})/i

/** 合理的年份区间，用来挡掉误匹配出来的垃圾数字。 */
const MIN_YEAR = 2000
const MAX_YEAR = 2100

/** 偏移串 → 分钟数；`Z` → 0。 */
function offsetMinutesOf(offset) {
  if (!offset) return null
  if (/^z$/i.test(offset)) return 0
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(offset)
  if (!match) return null
  const sign = match[1] === '-' ? -1 : 1
  return sign * (Number(match[2]) * 60 + Number(match[3]))
}

/**
 * 从一段错误文案里解析重置时刻。
 *
 * @param {string} message 错误文案
 * @param {number} [defaultOffsetMinutes=480] 文案没写时区时按哪一区解释（默认东八区）
 * @returns {number|null} 重置时刻的 epoch 毫秒；解析不出来返回 null
 */
export function parseResetTimeMs(message, defaultOffsetMinutes = 480) {
  const text = typeof message === 'string' ? message : String(message ?? '')
  if (!text) return null

  const match = DATETIME_RE.exec(text)
  if (match) {
    const [, y, mo, d, h, mi, s, ms, offset] = match
    const year = Number(y)
    if (year >= MIN_YEAR && year <= MAX_YEAR) {
      const offsetMinutes =
        offsetMinutesOf(offset) ?? (Number.isFinite(defaultOffsetMinutes) ? defaultOffsetMinutes : 0)
      const utcMs =
        Date.UTC(year, Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(ms || 0))
      const result = utcMs - offsetMinutes * 60_000
      if (Number.isFinite(result)) return result
    }
  }

  const epoch = EPOCH_RE.exec(text)
  if (epoch) {
    const raw = Number(epoch[1])
    if (Number.isFinite(raw) && raw > 0) {
      // 10 位是秒，13 位是毫秒
      return String(epoch[1]).length <= 10 ? raw * 1000 : raw
    }
  }

  return null
}

/**
 * 重置时刻 → 可读倒计时文案（用于日志 / /ark-quota 输出）。
 * 已过去返回「已重置」。
 */
export function formatCountdown(targetMs, nowMs = Date.now()) {
  if (!Number.isFinite(targetMs)) return '—'
  const delta = targetMs - nowMs
  if (delta <= 0) return '已重置'
  const totalSeconds = Math.round(delta / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts = []
  if (days) parts.push(`${days}天`)
  if (days || hours) parts.push(`${hours}小时`)
  if (days || hours || minutes) parts.push(`${minutes}分`)
  parts.push(`${seconds}秒`)
  return parts.join('')
}

/** 重置时刻 → 本地时间字符串（日志用）。 */
export function formatLocalTime(targetMs) {
  if (!Number.isFinite(targetMs)) return '—'
  const date = new Date(targetMs)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}
