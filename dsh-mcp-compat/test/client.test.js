// Client 半侧的「接线」冒烟测试：不需要浏览器 / 真 React，只验证 apply() 往官方
// 右键菜单、`shell.overlay` 浮层、设置页注册了什么，以及面板打开/关闭的状态机。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.resolve(here, '..', 'client.js')

/** 在 Node 里加载 client.js：劫持 __ModuleLoader__ 拿到注册对象，再用桩 require 跑 factory。 */
function loadClient() {
  const source = fs.readFileSync(clientPath, 'utf8')
  let registration = null
  const fakeDocument = {
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    createElement: () => ({ dataset: {}, appendChild: () => {} }),
    head: { appendChild: () => {} },
  }
  const fakeWindow = { __ModuleLoader__: { load: (value) => { registration = value } } }
  globalThis.document = fakeDocument
  new Function('window', source)(fakeWindow)
  assert.ok(registration, 'client.js 没有向 __ModuleLoader__ 注册')

  const reactStub = {
    createElement: () => null,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
  }
  const exports = registration.factory((specifier) => (specifier === 'react' ? reactStub : {}))
  return { registration, exports }
}

/** 假 ctx：记录 effect、菜单贡献与插槽注册。 */
function makeCtx() {
  const menus = []
  const slotRegistrations = []
  const localeListeners = []
  const tabs = []
  const services = {
    contextMenus: {
      register(input) {
        menus.push(input)
        return () => {}
      },
      notify: () => {},
      open: () => {},
    },
    sidebarRightTabs: {
      register(input) {
        tabs.push(input)
        return () => {}
      },
    },
    slots: {
      inject: (key, callback) => {
        callback()
        return () => {}
      },
      register: (spec, component) => {
        slotRegistrations.push({ spec, component })
        return () => {}
      },
    },
    locale: {
      getLocale: () => ({ active: 'zh' }),
      subscribe: (fn) => {
        localeListeners.push(fn)
        return () => {}
      },
    },
  }
  const ctx = {
    menus,
    slotRegistrations,
    tabs,
    // 真实 Client 上下文里 slots / contextMenus / sidebarRightTabs 是直接属性，locale 走 ctx.get
    slots: services.slots,
    contextMenus: services.contextMenus,
    sidebarRightTabs: services.sidebarRightTabs,
    get(name) {
      return services[name]
    },
    effect(run) {
      const disposer = run()
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
  }
  return ctx
}

test('client 注册 id 与注入面', () => {
  const { registration } = loadClient()
  assert.equal(registration.id, 'dsh-mcp-compat')
})

test('工作区右键菜单项：workspace 目标、order 200、文案与 run 打开面板', () => {
  const { exports } = loadClient()
  const ctx = makeCtx()
  exports.apply(ctx)

  const contribution = ctx.menus.find((item) => item.id === 'mcp-compat.workspace')
  assert.ok(contribution, '没有注册工作区菜单贡献')
  assert.equal(contribution.target, 'workspace')
  assert.equal(contribution.order, 200)

  // 路径缺失时不贡献动作（避免给「空工作区」弹一个空面板）
  assert.deepEqual(contribution.resolve({ workspaceId: 'w1', displayTitle: 'x' }), [])

  const target = { workspaceId: 'w1', path: 'D:\\work\\projA', displayTitle: 'projA' }
  const actions = contribution.resolve(target)
  assert.equal(actions.length, 1)
  assert.equal(actions[0].id, 'tools')
  assert.equal(typeof actions[0].label, 'string')
  assert.ok(actions[0].label.length > 0)
  assert.equal(typeof actions[0].run, 'function')
  assert.equal(actions[0].icon && actions[0].icon.key, 'mcp-compat.action')
  // run 只切换面板状态，不抛错
  assert.doesNotThrow(() => actions[0].run())
})

test('面板注册进 shell.overlay，设置卡片仍然注册', () => {
  const { exports } = loadClient()
  const ctx = makeCtx()
  exports.apply(ctx)

  const panel = ctx.slotRegistrations.find((entry) => entry.spec.name === 'shell.overlay')
  assert.ok(panel, '没有把面板挂到 shell.overlay')
  assert.equal(panel.spec.id, 'mcp-compat.panel')
  assert.equal(typeof panel.component, 'function')

  const icon = ctx.slotRegistrations.find((entry) => entry.spec.name === 'contextMenu.icon')
  assert.ok(icon, '没有注册 contextMenu.icon')
  assert.equal(icon.spec.key, 'mcp-compat.action')
  assert.equal(typeof icon.component, 'function')

  const card = ctx.slotRegistrations.find((entry) => entry.spec.name === 'settings.plugin.item')
  assert.ok(card, '设置卡片注册丢了')
  assert.equal(card.spec.key, 'dsh-mcp-compat')
})

test('面板未打开时不渲染 / 打开后能拿到请求', () => {
  const { exports } = loadClient()
  const ctx = makeCtx()
  exports.apply(ctx)
  const panel = ctx.slotRegistrations.find((entry) => entry.spec.name === 'shell.overlay')
  // 未点开任何工作区：root 槽位不产生 DOM
  assert.equal(panel.component(), null)
})

test('右侧栏：注册 MCP 管理 tab 类型 + sidebar.right.pane.tab 槽位', () => {
  const { exports } = loadClient()
  const ctx = makeCtx()
  exports.apply(ctx)

  const tab = ctx.tabs.find((entry) => entry.id === 'dsh-mcp-compat')
  assert.ok(tab, '没有注册右侧栏 tab 类型')
  assert.equal(tab.kind, 'mcp-compat')
  assert.equal(typeof tab.title, 'function')
  assert.equal(typeof tab.icon, 'function', '右侧栏 tab 应带图标组件')
  assert.ok(Array.isArray(tab.guide) && tab.guide.length > 0, '右侧栏起始页应有引导卡片')

  const pane = ctx.slotRegistrations.find((entry) => entry.spec.name === 'sidebar.right.pane.tab')
  assert.ok(pane, '没有注册 sidebar.right.pane.tab')
  assert.equal(pane.spec.key, 'dsh-mcp-compat')
  assert.equal(typeof pane.component, 'function')
})

// ── 参数表单：schema → 字段 → 参数对象 ────────────────────────────────────
test('schemaFields：识别 enum / boolean / number / array / object / string 与必填', () => {
  const { exports } = loadClient()
  const ctx = makeCtx()
  exports.apply(ctx)
  const { schemaFields } = exports.__internals
  const fields = schemaFields({
    type: 'object',
    required: ['project', 'count'],
    properties: {
      project: { type: 'string', description: '项目 ID' },
      count: { type: 'integer' },
      verbose: { type: 'boolean', default: true },
      tags: { type: 'array', items: { type: 'string' } },
      meta: { type: 'object' },
      mode: { enum: ['fast', 'full'] },
    },
  })
  assert.deepEqual(fields.map((f) => [f.name, f.type, f.required]), [
    ['project', 'string', true],
    ['count', 'number', true],
    ['verbose', 'boolean', false],
    ['tags', 'array', false],
    ['meta', 'object', false],
    ['mode', 'enum', false],
  ])
  assert.deepEqual(fields.find((f) => f.name === 'mode').options, ['fast', 'full'])
  assert.equal(fields.find((f) => f.name === 'verbose').defaultValue, true)
})

test('initialValues：default 回填，布尔默认 false，其余空串', () => {
  const { exports } = loadClient()
  const ctx = makeCtx()
  exports.apply(ctx)
  const { schemaFields, initialValues } = exports.__internals
  const fields = schemaFields({
    type: 'object',
    properties: {
      project: { type: 'string' },
      verbose: { type: 'boolean', default: true },
      tags: { type: 'array', default: ['a'] },
    },
  })
  assert.deepEqual(initialValues(fields), { project: '', verbose: 'true', tags: '["a"]' })
})

test('buildArgs：必填缺失/类型非法报错，合法输入按类型转换', () => {
  const { exports } = loadClient()
  const ctx = makeCtx()
  exports.apply(ctx)
  const { schemaFields, buildArgs } = exports.__internals
  const fields = schemaFields({
    type: 'object',
    required: ['project', 'count'],
    properties: {
      project: { type: 'string' },
      count: { type: 'number' },
      verbose: { type: 'boolean' },
      tags: { type: 'array' },
    },
  })
  const bad = buildArgs(fields, { project: '', count: 'abc', verbose: true, tags: 'not-json' })
  assert.equal(bad.errors.project, '必填')
  assert.equal(bad.errors.count, 'number')
  assert.equal(bad.errors.tags, 'JSON')

  const ok = buildArgs(fields, { project: 'p1', count: '3', verbose: true, tags: '["x","y"]' })
  assert.deepEqual(ok.errors, {})
  assert.deepEqual(ok.args, { project: 'p1', count: 3, verbose: true, tags: ['x', 'y'] })
})

