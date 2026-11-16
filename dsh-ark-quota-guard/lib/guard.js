// ═══════════════════════════════════════════════════════════════════════════
// dsh-ark-quota-guard / lib/guard.js — 判定与调度计算（纯函数，全部可单测）
//
// 判定管线：
//   1. 这次失败是不是「额度耗尽」？——按 LlmFailure.code / status 判，绝不看文案
//   2. 是不是该接管的 provider？——providerPattern 正则
//   3. 重置时间从哪来？——先解析错误文案，再查管控面接口
//   4. 离重置还很久吗？——太近就交给普通重试，不挂起（minParkMs）
//   5. 什么时候续跑？——重置时刻 + 冗余（默认 10 秒）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 视为「额度耗尽」的稳定错误码。
 * QUOTA = provider 中立耗尽；ACCOUNT_QUOTA = 一方账户余额；RATE_LIMIT = 429。
 * 参考 @deepseek-ai/dsh-llm 的 LLM_FAILURE_CODES。
 */
export const QUOTA_CODES = new Set(['QUOTA', 'ACCOUNT_QUOTA', 'RATE_LIMIT'])

/**
 * 这次请求失败是否属于额度耗尽。
 * @param {{code?: string, status?: number}|undefined|null} failure
 */
export function isQuotaFailure(failure) {
  if (!failure || typeof failure !== 'object') return false
  const code = typeof failure.code === 'string' ? failure.code.toUpperCase() : ''
  if (QUOTA_CODES.has(code)) return true
  return Number(failure.status) === 429
}

/**
 * provider 名是否匹配配置的正则（大小写不敏感）。
 * 空 pattern 表示接管所有 provider；正则非法时退回「接管」。
 */
export function providerMatches(provider, pattern) {
  const source = typeof pattern === 'string' ? pattern.trim() : ''
  if (!source) return true
  try {
    return new RegExp(source, 'i').test(String(provider ?? ''))
  } catch {
    return true
  }
}

/**
 * 从额度窗口里挑出「该等它」的那一个。
 *
 * 优先挑已耗尽（percent >= exhaustedPercent）且重置时刻在未来的窗口里最早的那个；
 * 一个都没耗尽时退回所有未来窗口里最早的；没有未来窗口返回 null。
 *
 * @param {Array<{level: string, percent: number, resetAtMs: number|null}>} windows
 * @param {{exhaustedPercent?: number, now?: number}} [options]
 */
export function pickResetWindow(windows, { exhaustedPercent = 99.5, now = Date.now() } = {}) {
  const usable = (Array.isArray(windows) ? windows : []).filter(
    (window) =>
      window &&
      Number.isFinite(window.resetAtMs) &&
      window.resetAtMs > now &&
      (window.percent === null || Number.isFinite(window.percent)),
  )
  if (!usable.length) return null
  const exhausted = usable.filter((window) => Number(window.percent) >= exhaustedPercent)
  const pool = exhausted.length ? exhausted : usable
  return pool.reduce((earliest, window) => (window.resetAtMs < earliest.resetAtMs ? window : earliest))
}

/**
 * 额度是否已经恢复：没有任何窗口处于「已耗尽且尚未到重置时刻」。
 *
 * 重置后新窗口从 0% 起算，所以 percent 掉到阈值以下即视为恢复；
 * 若窗口仍 >= 阈值但重置时刻已过（服务端延迟），也算恢复（真实额度查询会再确认）。
 */
export function isQuotaRecovered(windows, { exhaustedPercent = 99.5, now = Date.now() } = {}) {
  const list = Array.isArray(windows) ? windows : []
  return !list.some(
    (window) =>
      window &&
      Number(window.percent) >= exhaustedPercent &&
      (!Number.isFinite(window.resetAtMs) || window.resetAtMs > now),
  )
}

/**
 * 续跑时刻 = 重置时刻 + 冗余（默认 10 秒，避开服务端重置延迟）。
 * @param {{resetAtMs: number, now?: number, bufferMs?: number}} options
 */
export function computeResumeAt({ resetAtMs, now = Date.now(), bufferMs = 10_000 }) {
  const base = Number.isFinite(resetAtMs) ? resetAtMs : now
  const buffer = Number.isFinite(bufferMs) && bufferMs > 0 ? bufferMs : 0
  return Math.max(now, base + buffer)
}

/**
 * 判断这次失败要不要挂起等待。
 *
 * @param {object} options
 * @param {object} options.failure LlmFailure
 * @param {string} options.provider 失败的 provider 名
 * @param {string} options.providerPattern 配置的正则
 * @param {number} [options.now]
 * @param {number} [options.minParkMs] 离重置不足这么久就不挂起（交给普通重试）
 * @param {boolean} [options.alreadyParked] 该会话已经在挂起队列里
 * @returns {{park: boolean, reason: string}}
 */
export function shouldPark({
  failure,
  provider,
  providerPattern,
  now = Date.now(),
  minParkMs = 60_000,
  alreadyParked = false,
  resetAtMs = null,
}) {
  if (alreadyParked) return { park: false, reason: 'already-parked' }
  if (!isQuotaFailure(failure)) return { park: false, reason: 'not-quota' }
  if (!providerMatches(provider, providerPattern)) return { park: false, reason: 'provider-mismatch' }
  if (!Number.isFinite(resetAtMs)) return { park: false, reason: 'no-reset-time' }
  if (resetAtMs - now < minParkMs) return { park: false, reason: 'reset-too-soon' }
  return { park: true, reason: 'quota-exhausted' }
}
