import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ACTION_AGENT_PLAN,
  ACTION_CODING_PLAN,
  buildSignature,
  canonicalQuery,
  extractError,
  fetchArkQuota,
  hexSha256,
  parseAgentPlanResult,
  parseCodingPlanResult,
  uriEncode,
} from '../lib/volc.js'

const EMPTY_BODY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

test('uriEncode 保留 unreserved，其余 percent-encode', () => {
  assert.equal(uriEncode('abc-_.~'), 'abc-_.~')
  assert.equal(uriEncode('a b'), 'a%20b')
  assert.equal(uriEncode('中文'), '%E4%B8%AD%E6%96%87')
  assert.equal(uriEncode('Action=GetCodingPlanUsage'), 'Action%3DGetCodingPlanUsage')
})

test('hexSha256 固定向量（与 Rust 侧一致）', () => {
  assert.equal(
    hexSha256('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
  assert.equal(hexSha256(''), EMPTY_BODY_SHA256)
})

test('canonicalQuery 按 key 字母序且含 Region', () => {
  assert.equal(
    canonicalQuery(ACTION_CODING_PLAN),
    'Action=GetCodingPlanUsage&Region=cn-beijing&Version=2024-01-01',
  )
  assert.equal(
    canonicalQuery(ACTION_AGENT_PLAN),
    'Action=GetAFPUsage&Region=cn-beijing&Version=2024-01-01',
  )
})

test('buildSignature 结构正确且确定', () => {
  const now = new Date('2026-06-21T00:00:00Z')
  const { authorization, xDate, xContentSha256 } = buildSignature(
    'AKLTtest',
    'secretkey',
    '',
    ACTION_CODING_PLAN,
    now,
  )

  assert.equal(xDate, '20260621T000000Z')
  assert.equal(xContentSha256, EMPTY_BODY_SHA256)
  assert.ok(
    authorization.startsWith('HMAC-SHA256 Credential=AKLTtest/20260621/cn-beijing/ark/request,'),
    `unexpected credential/scope: ${authorization}`,
  )
  assert.ok(
    authorization.includes('SignedHeaders=host;x-date;x-content-sha256;content-type,'),
    `unexpected signed headers: ${authorization}`,
  )
  const signature = authorization.split('Signature=').pop()
  assert.equal(signature.length, 64)
  assert.match(signature, /^[0-9a-f]{64}$/)

  const again = buildSignature('AKLTtest', 'secretkey', '', ACTION_CODING_PLAN, now)
  assert.equal(again.authorization, authorization)
})

test('buildSignature 不同 action 得到不同签名', () => {
  const now = new Date('2026-06-21T00:00:00Z')
  const cp = buildSignature('AK', 'SK', '', ACTION_CODING_PLAN, now).authorization
  const ap = buildSignature('AK', 'SK', '', ACTION_AGENT_PLAN, now).authorization
  assert.notEqual(cp, ap)
})

test('extractError 读 ResponseMetadata.Error', () => {
  const envelope = {
    ResponseMetadata: {
      RequestId: 'x',
      Error: { Code: 'InvalidAccessKey', Message: 'The security token is invalid.' },
    },
  }
  assert.deepEqual(extractError(envelope), {
    code: 'InvalidAccessKey',
    message: 'The security token is invalid.',
  })
  assert.equal(extractError({ ResponseMetadata: {} }), null)
  assert.equal(extractError({}), null)
  assert.equal(extractError(null), null)
})

test('parseCodingPlanResult 解析真实响应（秒级时间戳、session 无窗口）', () => {
  const result = {
    Status: 'Running',
    UpdateTimestamp: 1782053286,
    QuotaUsage: [
      { Level: 'session', Percent: 0.0, ResetTimestamp: -1 },
      { Level: 'weekly', Percent: 1.672568, ResetTimestamp: 1782057600 },
      { Level: 'monthly', Percent: 0.836284, ResetTimestamp: 1784303999 },
    ],
  }
  const parsed = parseCodingPlanResult(result)
  assert.equal(parsed.plan, 'cp')
  assert.equal(parsed.status, 'Running')
  assert.equal(parsed.windows.length, 3)
  assert.equal(parsed.windows[0].level, 'session')
  assert.equal(parsed.windows[0].resetAtMs, null) // -1 → 无重置
  assert.equal(parsed.windows[1].resetAtMs, 1782057600 * 1000)
  assert.ok(Math.abs(parsed.windows[1].percent - 1.672568) < 1e-9)
})

test('parseCodingPlanResult 套餐被回收时返回空窗口', () => {
  const parsed = parseCodingPlanResult({ Status: 'Reclaimed', UpdateTimestamp: 1785322689 })
  assert.equal(parsed.status, 'Reclaimed')
  assert.deepEqual(parsed.windows, [])
})

test('parseAgentPlanResult 解析真实响应（毫秒时间戳、忽略 AFPDaily）', () => {
  const result = {
    PlanType: 'medium',
    AFPFiveHour: { Quota: 10000, Used: 0, ResetTime: -1 },
    AFPWeekly: { Quota: 35000, Used: 8750, ResetTime: 1785686400000 },
    AFPMonthly: { Quota: 100000, Used: 25000, ResetTime: 1787846399000 },
    AFPDaily: { Quota: 50000, Used: 0, ResetTime: 1785340800000 },
  }
  const parsed = parseAgentPlanResult(result)
  assert.equal(parsed.plan, 'ap')
  assert.equal(parsed.planType, 'medium')
  assert.equal(parsed.windows.length, 3)
  assert.ok(parsed.windows.every((window) => window.level !== 'daily'))

  const weekly = parsed.windows.find((window) => window.level === 'weekly')
  assert.equal(weekly.percent, 25)
  assert.equal(weekly.resetAtMs, 1785686400000) // 毫秒直接用
  assert.equal(weekly.quota, 35000)
  assert.equal(weekly.used, 8750)
})

test('parseAgentPlanResult 跳过 quota<=0 的窗口，percent 封顶 100', () => {
  const parsed = parseAgentPlanResult({
    PlanType: 'large',
    AFPFiveHour: { Quota: 0, Used: 0, ResetTime: -1 },
    AFPWeekly: { Quota: 10000, Used: 12000, ResetTime: 1785686400000 },
    AFPMonthly: { Quota: 100000, Used: 0, ResetTime: -1 },
  })
  assert.equal(parsed.windows.length, 2)
  assert.equal(parsed.windows.find((w) => w.level === 'weekly').percent, 100)
  assert.equal(parsed.windows.find((w) => w.level === 'monthly').resetAtMs, null)
})

test('fetchArkQuota 缺凭据直接失败', async () => {
  const result = await fetchArkQuota({ accessKey: '', secretKey: '' })
  assert.equal(result.ok, false)
  assert.match(result.message, /Access Key/)
})

test('fetchArkQuota auto 模式先 CP 后 AP，CP 报错时回退 AP', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url.includes('GetCodingPlanUsage')) {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            ResponseMetadata: {
              Error: { Code: 'InvalidParameter', Message: 'no coding plan' },
            },
          }),
      }
    }
    return {
      status: 200,
      text: async () =>
        JSON.stringify({
          ResponseMetadata: { RequestId: 'x' },
          Result: {
            PlanType: 'medium',
            AFPWeekly: { Quota: 35000, Used: 35000, ResetTime: 1785686400000 },
          },
        }),
    }
  }

  const result = await fetchArkQuota({
    accessKey: 'ak',
    secretKey: 'sk',
    plan: 'auto',
    fetchImpl,
    now: () => new Date('2026-06-21T00:00:00Z'),
  })

  assert.equal(calls.length, 2)
  assert.equal(result.ok, true)
  assert.equal(result.plan, 'ap')
  assert.equal(result.planType, 'medium')
  assert.equal(result.windows[0].percent, 100)
})

test('fetchArkQuota 两次都失败时返回合并原因', async () => {
  const fetchImpl = async () => {
    throw new Error('network down')
  }
  const result = await fetchArkQuota({ accessKey: 'ak', secretKey: 'sk', fetchImpl })
  assert.equal(result.ok, false)
  assert.match(result.message, /GetCodingPlanUsage/)
  assert.match(result.message, /GetAFPUsage/)
  assert.match(result.message, /network down/)
})
