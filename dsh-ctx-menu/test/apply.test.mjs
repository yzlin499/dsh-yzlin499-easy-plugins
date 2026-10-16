// apply() 冒烟测试：用桩 ctx 真正跑一次插件体。
// 纯逻辑测试不会发现「apply 里抛异常」这类问题——而 apply 抛异常会让整个 client 半侧静默失效。
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadClient } from './harness.mjs'

function makeCtx(overrides = {}) {
  const effects = []
  const registrations = []
  const listeners = []
  const ctx = {
    effects,
    registrations,
    listeners,
    effect(run, label) {
      const dispose = run()
      effects.push({ dispose, label })
      return () => { if (typeof dispose === 'function') dispose() }
    },
    get(name) {
      if (name === 'locale') return { getLocale: () => ({ active: 'zh' }), subscribe: () => () => {} }
      if (name === 'sessions') return { list: { getSnapshot: () => ({ byId: {} }) } }
      if (name === 'remote.session') {
        return {
          canOpenWorkspacePath: async () => ({ ok: true, value: true }),
          workspacePathApplications: async () => ({ ok: true, value: [] }),
          openWorkspacePath: async () => ({ ok: true, value: { opened: true } }),
        }
      }
      if (name === 'remote.workspaceFiles') return { read: async () => ({ ok: true, value: { lines: 0, eof: true, text: '' } }), readBytes: async () => ({ ok: true, value: { data: new Uint8Array() } }) }
      if (name === 'sidebarRight') return { openResource() {}, openTab() {} }
      return undefined
    },
    slots: {
      inject(key, callback) {
        callback()
        return () => {}
      },
      register(spec, component) {
        registrations.push({ spec, component })
        return () => {}
      },
    },
    ...overrides,
  }
  return ctx
}

test('apply() 不抛异常，并注册 overlay 与会话探针', () => {
  const { exports, document } = loadClient()
  const originalAdd = document.addEventListener
  const added = []
  document.addEventListener = (type, handler, capture) => added.push({ type, capture })
  const ctx = makeCtx()
  assert.doesNotThrow(() => exports.apply(ctx))
  // 自 0.1.3 起菜单不再占用 shell.overlay 槽（槽注册渲染崩溃会被 slots 层退役），只保留会话 id 探针
  assert.deepEqual(ctx.registrations.map((entry) => entry.spec.name), ['conversation.composer.dock'])
  assert.deepEqual(ctx.registrations.map((entry) => entry.spec.id), ['dsh-ctx-menu.session'])
  assert.equal(ctx.registrations.every((entry) => entry.spec.priority === undefined), true, '不得传 priority（会 shadow 别人的项）')
  assert.equal(added.length, 1)
  assert.equal(added[0].type, 'contextmenu')
  assert.equal(added[0].capture, true, '必须是捕获阶段')
  document.addEventListener = originalAdd
})

test('apply() 在缺服务时依然能装好（graceful degradation）', () => {
  const { exports } = loadClient()
  const ctx = makeCtx({
    get: (name) => {
      if (name === 'locale') return undefined
      return undefined
    },
  })
  assert.doesNotThrow(() => exports.apply(ctx))
})

test('effect 的 disposer 可逆（卸载干净）', () => {
  const { exports, document } = loadClient()
  const removed = []
  document.removeEventListener = (type) => removed.push(type)
  const ctx = makeCtx()
  exports.apply(ctx)
  for (const entry of ctx.effects) {
    if (typeof entry.dispose === 'function') entry.dispose()
  }
  assert.ok(removed.includes('contextmenu'), '卸载时必须移除 contextmenu 监听')
})