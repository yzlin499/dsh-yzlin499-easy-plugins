// 配置归一化单测：磁盘上的 win-notify.json 可能是手改过的、旧的、坏掉的，
// 读的时候必须逐字段回退默认值，不能因为一个坏字段让整份配置失效。
import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeConfig } from '../index.js'

test('normalizeConfig：空/非对象输入回退默认值', () => {
  for (const input of [undefined, null, 'nope', 42, []]) {
    assert.deepEqual(normalizeConfig(input), {
      enabled: true,
      notifyApproval: true,
      notifyQuestion: true,
      notifyDone: true,
      mode: 'always',
    })
  }
})

test('normalizeConfig：布尔字段与 mode 白名单', () => {
  const cfg = normalizeConfig({
    enabled: false,
    notifyApproval: false,
    notifyQuestion: 'yes',
    notifyDone: 0,
    mode: 'background',
  })
  assert.equal(cfg.enabled, false)
  assert.equal(cfg.notifyApproval, false)
  assert.equal(cfg.notifyQuestion, true) // 非布尔 → 回退默认
  assert.equal(cfg.notifyDone, true)
  assert.equal(cfg.mode, 'background')
})

test('normalizeConfig：未知 mode 回退 always，未知字段被丢弃', () => {
  const cfg = normalizeConfig({ mode: 'sometimes', extra: 1 })
  assert.equal(cfg.mode, 'always')
  assert.equal(Object.hasOwn(cfg, 'extra'), false)
})
