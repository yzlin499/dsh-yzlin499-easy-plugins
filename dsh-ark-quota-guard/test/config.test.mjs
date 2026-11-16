import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULTS,
  credentialsFromEnv,
  normalizeConfig,
  resolveCredentials,
} from '../lib/config.js'

test('normalizeConfig 空输入回退默认值', () => {
  assert.deepEqual(normalizeConfig(undefined), DEFAULTS)
  assert.deepEqual(normalizeConfig(null), DEFAULTS)
  assert.deepEqual(normalizeConfig('nope'), DEFAULTS)
  assert.deepEqual(normalizeConfig([]), DEFAULTS)
})

test('normalizeConfig 只接受类型正确的字段', () => {
  const config = normalizeConfig({
    enabled: 'yes', // 非布尔 → 丢弃
    verifyBeforeResume: false,
    resumeBufferMs: 5000,
    minParkMs: -1, // 负数 → 丢弃
    plan: 'cp',
    providerPattern: '  ark  ',
    unknownField: 42,
  })
  assert.equal(config.enabled, DEFAULTS.enabled)
  assert.equal(config.verifyBeforeResume, false)
  assert.equal(config.resumeBufferMs, 5000)
  assert.equal(config.minParkMs, DEFAULTS.minParkMs)
  assert.equal(config.plan, 'cp')
  assert.equal(config.providerPattern, 'ark')
  assert.equal('unknownField' in config, false)
})

test('normalizeConfig 收敛百分比与 recheck 下限', () => {
  assert.equal(normalizeConfig({ exhaustedPercent: 0 }).exhaustedPercent, DEFAULTS.exhaustedPercent)
  assert.equal(normalizeConfig({ exhaustedPercent: 150 }).exhaustedPercent, DEFAULTS.exhaustedPercent)
  assert.equal(normalizeConfig({ exhaustedPercent: 80 }).exhaustedPercent, 80)
  assert.equal(normalizeConfig({ recheckMs: 10 }).recheckMs, 1000)
})

test('normalizeConfig 只接受已知 plan', () => {
  assert.equal(normalizeConfig({ plan: 'ap' }).plan, 'ap')
  assert.equal(normalizeConfig({ plan: 'auto' }).plan, 'auto')
  assert.equal(normalizeConfig({ plan: 'weird' }).plan, DEFAULTS.plan)
})

test('credentialsFromEnv 按优先级取第一个非空值', () => {
  assert.deepEqual(credentialsFromEnv({}), { accessKey: '', secretKey: '' })
  assert.deepEqual(
    credentialsFromEnv({ VOLC_ACCESS_KEY: ' ak ', VOLC_SECRET_KEY: 'sk' }),
    { accessKey: 'ak', secretKey: 'sk' },
  )
  assert.deepEqual(
    credentialsFromEnv({ ARK_ACCESS_KEY: 'ark-ak', ARK_SECRET_KEY: 'ark-sk' }),
    { accessKey: 'ark-ak', secretKey: 'ark-sk' },
  )
  // 空串视为未设置，继续找下一个
  assert.equal(
    credentialsFromEnv({ VOLC_ACCESS_KEY: '   ', ARK_ACCESS_KEY: 'fallback' }).accessKey,
    'fallback',
  )
})

test('resolveCredentials 配置优先于环境变量', () => {
  const env = { VOLC_ACCESS_KEY: 'env-ak', VOLC_SECRET_KEY: 'env-sk' }
  assert.deepEqual(resolveCredentials({ accessKey: 'cfg-ak', secretKey: '' }, env), {
    accessKey: 'cfg-ak',
    secretKey: 'env-sk',
  })
  assert.deepEqual(resolveCredentials({}, env), { accessKey: 'env-ak', secretKey: 'env-sk' })
})
