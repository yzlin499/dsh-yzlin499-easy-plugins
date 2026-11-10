// 挂载契约：插槽注册形状（顶替官方 activity 读数）、性能档位跟随、降级路径。
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadClient, createFakeForms, makeCtx, registrationFor } from './harness.mjs'

const { exports, internals } = loadClient()
const { NS } = internals

function mount(initial = {}) {
  const forms = createFakeForms({ 'ui-chat': { performanceUsage: 'detailed' }, ...initial })
  const ctx = makeCtx({ configForms: forms })
  exports.apply(ctx)
  return { ctx, forms }
}

test('替换官方读数：同 id activity + 同 order 0 + 更低 priority', () => {
  const { ctx } = mount()
  const dock = registrationFor(ctx, 'activity')
  assert.notEqual(dock, undefined, '必须注册 activity 读数')
  assert.equal(dock.spec.name, 'conversation.composer.dock')
  assert.equal(dock.spec.order, 0, '必须与官方同 order 才能落在同一位置')
  assert.equal(dock.spec.priority, -1, 'priority 更低才顶掉官方那条')
  assert.equal(typeof dock.component, 'function')
})

test('注入面：只有文案与性能档位两个 hook', () => {
  const { ctx } = mount()
  const dock = registrationFor(ctx, 'activity')
  const injected = dock.spec.inject()
  assert.deepEqual(Object.keys(injected.hooks).sort(), ['labels', 'performanceUsage'])
  assert.equal(injected.hooks.performanceUsage.getSnapshot(), 'detailed')
  assert.equal(injected.hooks.labels.getSnapshot().recentSpeed, '最近 30 秒速度')
})

test('性能档位跟随：官方切成简洁模式后读数也切', () => {
  const { ctx, forms } = mount()
  const dock = registrationFor(ctx, 'activity')
  const injected = dock.spec.inject()
  assert.equal(injected.hooks.performanceUsage.getSnapshot(), 'detailed')
  forms.get('ui-chat').push({ performanceUsage: 'compact' })
  assert.equal(injected.hooks.performanceUsage.getSnapshot(), 'compact')
  forms.get('ui-chat').push({ performanceUsage: 'detailed' })
  assert.equal(injected.hooks.performanceUsage.getSnapshot(), 'detailed')
})

test('ui-chat 命名空间不可用时回退 detailed，不抛异常', () => {
  const forms = createFakeForms({})
  const ctx = makeCtx({ configForms: forms })
  assert.doesNotThrow(() => exports.apply(ctx))
  const dock = registrationFor(ctx, 'activity')
  assert.notEqual(dock, undefined)
  assert.equal(dock.spec.inject().hooks.performanceUsage.getSnapshot(), 'detailed')
})

test('configForms 缺失（更早的 DSH）时不注册任何东西，官方读数保持原样', () => {
  const ctx = makeCtx({})
  assert.doesNotThrow(() => exports.apply(ctx))
  assert.equal(ctx.slotRegistrations.length, 0, '不能在不支持的宿主上顶替官方读数')
})

test('语言跟随：locale 切换后文案重取', () => {
  const listeners = new Set()
  const ctx = makeCtx({ configForms: createFakeForms({ 'ui-chat': { performanceUsage: 'detailed' } }) })
  ctx.activeLang = 'zh'
  ctx.locale = {
    getLocale: () => ({ active: ctx.activeLang }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  exports.apply(ctx)
  const dock = registrationFor(ctx, 'activity')
  const injected = dock.spec.inject()
  assert.equal(injected.hooks.labels.getSnapshot().recentSpeed, '最近 30 秒速度')
  ctx.activeLang = 'en'
  for (const listener of listeners) listener()
  assert.equal(injected.hooks.labels.getSnapshot().recentSpeed, 'Last 30s speed')
})

test('重复 apply：每次都注册一条读数，且注入样式标签', () => {
  const forms = createFakeForms({ 'ui-chat': { performanceUsage: 'detailed' } })
  const ctx = makeCtx({ configForms: forms })
  assert.doesNotThrow(() => {
    exports.apply(ctx)
    exports.apply(ctx)
  })
  assert.equal(ctx.slotRegistrations.filter((entry) => entry.spec.id === 'activity').length, 2)
  assert.ok(ctx.effects.length >= 2, 'locale 订阅必须挂在 ctx.effect 上（可逆）')
})
