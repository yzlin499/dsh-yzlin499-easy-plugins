// 启动健壮性：单步失败不得拖垮其余步骤（尤其是接管监听器）。
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadClient } from './harness.mjs'

function ctxWith(slotInject) {
  const effects = []
  return {
    effects,
    effect(run) {
      const dispose = run()
      effects.push(dispose)
      return () => { if (typeof dispose === 'function') dispose() }
    },
    get(name) {
      if (name === 'locale') return { getLocale: () => ({ active: 'zh' }), subscribe: () => () => {} }
      if (name === 'sessions') return { list: { getSnapshot: () => ({ byId: {} }) } }
      if (name === 'remote.session') return { canOpenWorkspacePath: async () => ({ ok: true, value: true }) }
      return undefined
    },
    slots: { inject: slotInject, register: () => () => {} },
  }
}

test('boot 标记：apply 走完后 phase=ready 且无错误', () => {
  const { exports, window: fakeWindow } = loadClient()
  const added = []
  // harness 的 fake document 没有记录 listener；这里替换成会记录的实现
  const realDocument = globalThis.document
  const originalAdd = exports
  void realDocument
  void originalAdd
  const ctx = ctxWith((key, callback) => { callback(); return () => {} })
  exports.apply(ctx)
  assert.equal(fakeWindow.__DSH_CTX_MENU__.version, '0.2.3')
  assert.equal(fakeWindow.__DSH_CTX_MENU__.phase, 'ready')
  assert.deepEqual(fakeWindow.__DSH_CTX_MENU__.errors, [])
  assert.equal(typeof fakeWindow.__DSH_CTX_MENU__.state, 'function')
  const state = fakeWindow.__DSH_CTX_MENU__.state()
  assert.equal(state.version, '0.2.3')
  assert.equal(state.phase, 'ready')
  assert.equal(Array.isArray(state.errors), true)
  void added
})

test('slots.inject 抛错时：接管仍然装上，错误被记录而不是炸掉整个 apply', () => {
  const { exports, window: fakeWindow } = loadClient()
  const ctx = ctxWith(() => { throw new Error('slot boom') })
  assert.doesNotThrow(() => exports.apply(ctx))
  const boot = fakeWindow.__DSH_CTX_MENU__
  assert.equal(boot.phase, 'ready', 'apply 必须走到底')
  const failed = boot.errors.map((entry) => entry.step)
  assert.ok(failed.includes('session-probe'), 'session-probe 的失败要被记录')
  assert.ok(boot.errors.every((entry) => entry.message.includes('slot boom')))
  assert.equal(boot.menuRoot, 'mounted', '菜单 root 不占槽，不受 slots.inject 失败影响')
  assert.equal(ctx.effects.length, 5, 'gate / locale-follow / desktop-probe / menu-root / styles 五个 effect 都应建立')
})

test('locale 服务缺失也不影响其它步骤', () => {
  const { exports, window: fakeWindow } = loadClient()
  const ctx = ctxWith((key, callback) => { callback(); return () => {} })
  ctx.get = () => undefined
  assert.doesNotThrow(() => exports.apply(ctx))
  assert.equal(fakeWindow.__DSH_CTX_MENU__.phase, 'ready')
})