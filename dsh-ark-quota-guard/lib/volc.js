// ═══════════════════════════════════════════════════════════════════════════
// dsh-ark-quota-guard / lib/volc.js — 火山方舟管控面 OpenAPI 取数 + V4 签名
//
// 移植自 YZLWork 的 src-tauri/src/volcengine.rs（同一套实测结论）：
//
//   接口 1：POST https://ark.cn-beijing.volcengineapi.com/?Action=GetCodingPlanUsage&Version=2024-01-01
//           CodingPlan 套餐：QuotaUsage[] = { Level: session/weekly/monthly, Percent, ResetTimestamp(秒) }
//   接口 2：POST https://ark.cn-beijing.volcengineapi.com/?Action=GetAFPUsage&Version=2024-01-01
//           AgentPlan（AFP = Agent Flow Points）：AFPFiveHour/AFPWeekly/AFPMonthly
//           = { Quota, Used, ResetTime(毫秒, -1 = 无活跃窗口) }；percent = used/quota
//
// 鉴权：Access Key V4 签名（HMAC-SHA256），与 AWS SigV4 同构但有火山变体：
//   1. SignedHeaders 固定顺序 host;x-date;x-content-sha256;content-type（不按字母序）
//   2. algorithm 串 HMAC-SHA256（无 AWS4 前缀），credential scope 结尾 request
//   3. 签名密钥 kDate=HMAC(SK, date)，SK 不加前缀；canonical query 按 key 字母序且含 Region
//
// 注意：这是**管控面**域名 ark.cn-beijing.volcengineapi.com，不是推理用的
// /api/v3 数据面；推理 Bearer Key 在这里无效，必须账号级 AK/SK。
// ═══════════════════════════════════════════════════════════════════════════
import { createHash, createHmac } from 'node:crypto'

export const OPENAPI_HOST = 'ark.cn-beijing.volcengineapi.com'
export const OPENAPI_BASE = `https://${OPENAPI_HOST}/`
export const API_VERSION = '2024-01-01'
export const SIGN_SERVICE = 'ark'
export const SIGN_REGION = 'cn-beijing'
export const CONTENT_TYPE = 'application/json; charset=utf-8'
/** 固定顺序的 SignedHeaders（火山特有，不按字母序） */
export const SIGNED_HEADERS = 'host;x-date;x-content-sha256;content-type'

export const ACTION_CODING_PLAN = 'GetCodingPlanUsage'
export const ACTION_AGENT_PLAN = 'GetAFPUsage'

/** 小写 hex SHA-256 */
export function hexSha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

/** HMAC-SHA256，返回 Buffer（key 任意长度） */
export function hmacSha256(key, data) {
  return createHmac('sha256', key).update(data).digest()
}

/** hex 化的 HMAC-SHA256 */
export function hmacHex(key, data) {
  return hmacSha256(key, data).toString('hex')
}

/** RFC 3986 percent-encode（用于 canonical query） */
export function uriEncode(input) {
  const str = String(input)
  let out = ''
  for (const byte of Buffer.from(str, 'utf8')) {
    const ch = String.fromCharCode(byte)
    if (/[A-Za-z0-9\-_.~]/.test(ch)) out += ch
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}

/**
 * canonical query：按 key 字母序（Action < Region < Version），值 URI 编码。
 * 同一份字符串既用于签名也用于实际请求 URL，保证两者完全一致。
 */
export function canonicalQuery(action) {
  return [
    ['Action', action],
    ['Region', SIGN_REGION],
    ['Version', API_VERSION],
  ]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, value]) => `${uriEncode(key)}=${uriEncode(value)}`)
    .join('&')
}

/** Date → 'YYYYMMDDTHHMMSSZ' */
export function amzDate(now) {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/**
 * 构造 V4 签名三件套：`(Authorization, X-Date, X-Content-Sha256)`。
 * `now` 作参数传入便于写确定性单测。
 */
export function buildSignature(accessKey, secretKey, body, action, now) {
  const xDate = amzDate(now)
  const shortDate = xDate.slice(0, 8)
  const xContentSha256 = hexSha256(body)

  // 固定顺序 canonical headers（火山特有，不排序），末尾带换行
  const canonicalHeaders =
    `host:${OPENAPI_HOST}\n` +
    `x-date:${xDate}\n` +
    `x-content-sha256:${xContentSha256}\n` +
    `content-type:${CONTENT_TYPE}\n`

  const query = canonicalQuery(action)
  const canonicalRequest =
    `POST\n/\n${query}\n${canonicalHeaders}\n${SIGNED_HEADERS}\n${xContentSha256}`

  const credentialScope = `${shortDate}/${SIGN_REGION}/${SIGN_SERVICE}/request`
  const stringToSign = `HMAC-SHA256\n${xDate}\n${credentialScope}\n${hexSha256(canonicalRequest)}`

  // 签名密钥派生：kDate=HMAC(SK, date)（SK 不加 AWS4 前缀），终止串 request
  const kDate = hmacSha256(secretKey, shortDate)
  const kRegion = hmacSha256(kDate, SIGN_REGION)
  const kService = hmacSha256(kRegion, SIGN_SERVICE)
  const kSigning = hmacSha256(kService, 'request')
  const signature = hmacHex(kSigning, stringToSign)

  const authorization =
    `HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`

  return { authorization, xDate, xContentSha256 }
}

/** 数值兜底：非有限数返回 fallback。 */
function num(value, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 百分比收敛到 0-100。 */
function clampPercent(value) {
  return Math.min(100, Math.max(0, num(value)))
}

/** 从火山统一 envelope 里取业务错误 (code, message)；无错误返回 null。 */
export function extractError(envelope) {
  const error = envelope && envelope.ResponseMetadata && envelope.ResponseMetadata.Error
  if (!error || typeof error !== 'object') return null
  const code = typeof error.Code === 'string' ? error.Code : ''
  const message = typeof error.Message === 'string' ? error.Message : ''
  if (!code && !message) return null
  return { code, message }
}

/**
 * 解析 GetCodingPlanUsage 的 Result。
 * ResetTimestamp 是**秒**；-1 表示该窗口没有活跃的重置时间。
 */
export function parseCodingPlanResult(result) {
  const windows = []
  const list = result && Array.isArray(result.QuotaUsage) ? result.QuotaUsage : []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const level = typeof item.Level === 'string' ? item.Level : ''
    if (!level) continue
    const resetSec = num(item.ResetTimestamp, -1)
    windows.push({
      level,
      percent: clampPercent(item.Percent),
      resetAtMs: resetSec > 0 ? resetSec * 1000 : null,
      quota: null,
      used: null,
    })
  }
  return {
    plan: 'cp',
    status: typeof result?.Status === 'string' ? result.Status : null,
    planType: null,
    updatedAt: typeof result?.UpdateTimestamp === 'number' ? result.UpdateTimestamp : null,
    windows,
  }
}

/**
 * 解析 GetAFPUsage 的 Result（Agent Plan）。
 * ResetTime 是**毫秒**；<=0（含 -1）表示该窗口没有活跃的重置时间。
 * AFPDaily（1 天窗口）与 YZLWork 保持一致，不参与判定。
 */
export function parseAgentPlanResult(result) {
  const windows = []
  for (const [key, level] of [
    ['AFPFiveHour', 'five_hour'],
    ['AFPWeekly', 'weekly'],
    ['AFPMonthly', 'monthly'],
  ]) {
    const window = result && result[key]
    if (!window || typeof window !== 'object') continue
    const quota = num(window.Quota, 0)
    const used = num(window.Used, 0)
    // 无配额（未开通 / 已回收）的窗口跳过
    if (!(quota > 0)) continue
    const resetMs = num(window.ResetTime, -1)
    windows.push({
      level,
      percent: clampPercent((used / quota) * 100),
      resetAtMs: resetMs > 0 ? resetMs : null,
      quota,
      used,
    })
  }
  return {
    plan: 'ap',
    status: null,
    planType: typeof result?.PlanType === 'string' ? result.PlanType : null,
    updatedAt: null,
    windows,
  }
}

/** 单次管控面请求；返回 envelope 或抛错。 */
async function callOpenApi({ accessKey, secretKey, action, now, fetchImpl, timeoutMs }) {
  const query = canonicalQuery(action)
  const url = `${OPENAPI_BASE}?${query}`
  const body = ''
  const { authorization, xDate, xContentSha256 } = buildSignature(
    accessKey,
    secretKey,
    body,
    action,
    now,
  )

  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Host: OPENAPI_HOST,
        'X-Date': xDate,
        'X-Content-Sha256': xContentSha256,
        'Content-Type': CONTENT_TYPE,
        Authorization: authorization,
      },
      body,
      signal: controller ? controller.signal : undefined,
    })
    const text = await response.text()
    try {
      return { envelope: JSON.parse(text), status: response.status }
    } catch {
      const preview = String(text).slice(0, 200)
      throw new Error(`火山方舟返回无法解析（HTTP ${response.status}）: ${preview}`)
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 查询火山方舟套餐额度。
 *
 * @param {object} options
 * @param {string} options.accessKey
 * @param {string} options.secretKey
 * @param {'auto'|'cp'|'ap'} [options.plan] auto = 先 CP 再 AP
 * @param {() => Date} [options.now] 便于单测
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ok: true, plan: string, status: string|null, planType: string|null, windows: object[]} | {ok: false, message: string}>}
 */
export async function fetchArkQuota({
  accessKey,
  secretKey,
  plan = 'auto',
  now = () => new Date(),
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
}) {
  const ak = String(accessKey || '').trim()
  const sk = String(secretKey || '').trim()
  if (!ak || !sk) {
    return { ok: false, message: '未配置火山方舟 Access Key / Secret Key' }
  }
  if (typeof fetchImpl !== 'function') {
    return { ok: false, message: '当前运行时没有可用的 fetch' }
  }

  const actions =
    plan === 'cp'
      ? [[ACTION_CODING_PLAN, parseCodingPlanResult]]
      : plan === 'ap'
        ? [[ACTION_AGENT_PLAN, parseAgentPlanResult]]
        : [
            [ACTION_CODING_PLAN, parseCodingPlanResult],
            [ACTION_AGENT_PLAN, parseAgentPlanResult],
          ]

  const failures = []
  for (const [action, parse] of actions) {
    try {
      const { envelope } = await callOpenApi({
        accessKey: ak,
        secretKey: sk,
        action,
        now: now(),
        fetchImpl,
        timeoutMs,
      })
      const error = extractError(envelope)
      if (error) {
        failures.push(`${action}: ${error.message || error.code}`)
        continue
      }
      if (!envelope || !envelope.Result) {
        failures.push(`${action}: 返回缺少 Result 数据`)
        continue
      }
      return { ok: true, ...parse(envelope.Result) }
    } catch (error) {
      failures.push(`${action}: ${String((error && error.message) || error)}`)
    }
  }
  return { ok: false, message: failures.join('；') || '火山方舟额度查询失败' }
}
