// 渲染层测试：直接调用 buildItems / MenuHost。
// 这一类测试本该早点存在——上一轮"菜单渲染时崩溃导致槽注册被退役"就是这样漏掉的。
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadClient } from './harness.mjs'

// 同一次实例：internals 与 fake window 必须来自同一个 load，否则 localStorage 桩打不到点上
const loaded = loadClient()
const { internals, window: fakeWindow } = loaded
const { MenuHost, buildItems, appIcon, makeTranslator, menuStore, fileContextStore, DICT } = internals
const { preferredAppId, pickPreferredApp } = internals

const t = makeTranslator('zh')

/** 官方控件里的选择存在 localStorage；测试里按官方格式（JSON.stringify 后的字符串）写入。 */
function setChoice(fakeWin, appId) {
  fakeWin.localStorage = {
    getItem: (key) => (key === 'dsh.open-in-app.choice' ? JSON.stringify(appId) : null),
  }
}

/** 清掉 DSH 控件的选择（测试之间共享同一个 fake window，必须显式复位）。 */
function clearChoice(fakeWin) {
  fakeWin.localStorage = { getItem: () => null }
}

/** 假 ctx：可选挂 betterSidebar / sidebarRight / remote.session 等。 */
function makeCtx(services = {}) {
  const table = {
    sidebarRight: { openResource() {}, openTab() {} },
    'remote.workspaceFiles': {
      read: async () => ({ ok: true, value: { offset: 1, lines: 1, text: 'x', eof: true } }),
      readBytes: async () => ({ ok: true, value: { data: new Uint8Array([1]) } }),
    },
    'remote.session': { openWorkspacePath: async () => ({ ok: true, value: {} }) },
    sessions: { list: { getSnapshot: () => ({ byId: { s1: { cwd: 'D:\\ws' } } }) } },
    ...services,
  }
  return { get: (name) => table[name] }
}

const file = { path: 'D:\\ws\\src\\a.cpp', display: 'src/a.cpp', absolute: true, source: 'mention' }
const ids = (items) => items.map((item) => (item.type === 'separator' ? '—' : item.id))

test('buildItems：打开类 → 分隔线 → 应用中打开（二级菜单）/定位 → 分隔线 → 复制/另存', () => {
  const { items, actions } = buildItems(
    {
      open: true,
      file,
      appsState: 'ready',
      apps: [
        { id: 'rider', name: 'Rider', default: true, icon: null },
        { id: 'code', name: 'VS Code', default: false, icon: 'data:image/png;base64,AA' },
      ],
    },
    { ctx: makeCtx(), sessionId: 's1', desktop: { canOpen: true }, t },
  )
  assert.deepEqual(ids(items), ['open-file', '—', 'default-app', 'apps', 'reveal', '—', 'copy-relative', 'copy-absolute', 'copy-contents', 'save-as'])
  const apps = items.find((item) => item.id === 'apps')
  assert.equal(apps.label, '在应用中打开')
  assert.equal(apps.submenu.length, 2, '应用全部收进二级菜单')
  assert.equal(apps.submenu[0].label, 'Rider（默认）', '默认应用排在最前')
  assert.equal(apps.submenu[0].id, 'app:rider')
  assert.notEqual(apps.submenu[1].icon, undefined, '应用图标放进二级条目')
  assert.equal(typeof actions['app:rider'], 'function')
  assert.equal(typeof actions['copy-relative'], 'function')
  assert.equal(typeof actions['copy-absolute'], 'function')
  assert.equal(typeof actions['reveal'], 'function')
})

test('buildItems：没有 DSH 选择时，外层行退回系统默认关联（用列表里它自己的 id 打开）', () => {
  let opened = null
  clearChoice(fakeWindow)
  const ctx = makeCtx()
  ctx.get = (name) => (name === 'remote.session'
    ? { openWorkspacePath: async (request) => { opened = request; return { ok: true, value: {} } } }
    : makeCtx().get(name))
  const { items, actions } = buildItems(
    {
      open: true,
      file,
      appsState: 'ready',
      apps: [
        { id: 'rider', name: 'Rider', default: true, icon: 'data:image/png;base64,AA' },
        { id: 'code', name: 'VS Code', default: false, icon: null },
      ],
    },
    { ctx, sessionId: 's1', desktop: { canOpen: true }, t },
  )
  const row = items.find((item) => item.id === 'default-app')
  assert.equal(row.label, '在 Rider 中打开')
  assert.notEqual(row.icon, undefined, '带默认应用图标')
  assert.deepEqual(ids(items).slice(0, 4), ['open-file', '—', 'default-app', 'apps'])
  return actions['default-app']().then(() => {
    assert.deepEqual(opened, { path: 'D:\\ws\\src\\a.cpp', application: 'rider' })
  })
})

test('buildItems：列表里没有 default 标记时退回通用标题', () => {
  clearChoice(fakeWindow)
  const { items } = buildItems(
    { open: true, file, appsState: 'ready', apps: [{ id: 'code', name: 'VS Code', default: false, icon: null }] },
    { ctx: makeCtx(), sessionId: 's1', desktop: { canOpen: true }, t },
  )
  assert.equal(items.find((item) => item.id === 'default-app').label, '用默认应用打开')
})

test('buildItems：列表为空也给一次默认打开机会，并说明没有关联应用', () => {
  const { items } = buildItems(
    { open: true, file, appsState: 'ready', apps: [] },
    { ctx: makeCtx(), sessionId: 's1', desktop: { canOpen: true }, t },
  )
  assert.ok(ids(items).includes('default-app'))
  assert.ok(ids(items).includes('apps-empty'))
  assert.equal(ids(items).includes('apps'), false)
})

test('外层默认行跟随 DSH 控件里的选择（Rider），而不是系统默认（VS Code）', () => {
  let opened = null
  const ctx = makeCtx()
  ctx.get = (name) => (name === 'remote.session'
    ? { openWorkspacePath: async (request) => { opened = request; return { ok: true, value: {} } } }
    : makeCtx().get(name))
  setChoice(fakeWindow, 'rider') // 用户在 DSH 右上角下拉里点过 Rider
  const { items, actions } = buildItems(
    {
      open: true,
      file,
      appsState: 'ready',
      apps: [
        { id: 'code.exe', name: 'Visual Studio Code', default: true, icon: null },      // 系统默认
        { id: 'rider64.exe', name: 'JetBrains Rider 2026.2.1', default: false, icon: null }, // DSH 选择
      ],
    },
    { ctx, sessionId: 's1', desktop: { canOpen: true }, t },
  )
  const row = items.find((item) => item.id === 'default-app')
  assert.equal(row.label, '在 JetBrains Rider 2026.2.1 中打开', 'DSH 的选择压过系统默认')
  return actions['default-app']().then(() => {
    assert.deepEqual(opened, { path: 'D:\\ws\\src\\a.cpp', application: 'rider64.exe' }, '用列表里 Rider 自己的 id 打开')
  })
})

test('DSH 选择的应用不在本文件关联列表里 → 退回系统默认', () => {
  let opened = null
  const ctx = makeCtx()
  ctx.get = (name) => (name === 'remote.session'
    ? { openWorkspacePath: async (request) => { opened = request; return { ok: true, value: {} } } }
    : makeCtx().get(name))
  setChoice(fakeWindow, 'androidstudio') // DSH 里选的是 Android Studio，但 .md 没有这个关联
  const { items, actions } = buildItems(
    {
      open: true,
      file,
      appsState: 'ready',
      apps: [{ id: 'code.exe', name: 'Visual Studio Code', default: true, icon: null }],
    },
    { ctx, sessionId: 's1', desktop: { canOpen: true }, t },
  )
  assert.equal(items.find((item) => item.id === 'default-app').label, '在 Visual Studio Code 中打开')
  return actions['default-app']().then(() => {
    assert.deepEqual(opened, { path: 'D:\\ws\\src\\a.cpp', application: 'code.exe' })
  })
})

test('preferredAppId：按官方格式读 localStorage，缺失/坏值都返回 null', () => {
  setChoice(fakeWindow, 'rider')
  assert.equal(preferredAppId(), 'rider')

  fakeWindow.localStorage = { getItem: () => null }
  assert.equal(preferredAppId(), null)

  fakeWindow.localStorage = { getItem: () => '{坏 JSON' }
  assert.equal(preferredAppId(), null)

  fakeWindow.localStorage = { getItem: () => '""' }
  assert.equal(preferredAppId(), null)
})

test('pickPreferredApp：别名里的扩展名碎片 "exe" 不能当判据（真实踩到的坑：hl2.exe）', () => {
  const apps = [
    { name: 'Visual Studio Code', id: 'D:\\Program Files\\Microsoft VS Code\\Code.exe', default: true },
    { name: 'hl2.exe', id: 'f:\\steamlibrary\\steamapps\\common\\fistful of frags\\sdk\\hl2.exe' },
    { name: 'Internet Explorer', id: 'C:\\Program Files\\Internet Explorer\\iexplore.exe' },
    { name: 'JetBrains Rider 2026.2.1', id: 'C:\\Program Files\\JetBrains\\JetBrains Rider 2026.2.1\\bin\\rider64.exe' },
  ]
  // 用户 DSH 控件选的是 explorer，而这份列表里根本没有"文件资源管理器" → 必须认不出来（退回系统默认）
  assert.equal(pickPreferredApp(apps, 'explorer'), null)
  // 但同列表下 rider / vscode 仍然要能正确落位
  assert.equal(pickPreferredApp(apps, 'rider').name, 'JetBrains Rider 2026.2.1')
  assert.equal(pickPreferredApp(apps, 'vscode').name, 'Visual Studio Code')
})

test('pickPreferredApp：explorer 不能误配 Internet Explorer（真实踩到的坑）', () => {
  const apps = [
    { id: 'IEXPLORE.EXE', name: 'Internet Explorer' }, // 故意排在前面，旧实现会先命中它
    { id: 'explorer.exe', name: '文件资源管理器' },
  ]
  assert.equal(pickPreferredApp(apps, 'explorer').id, 'explorer.exe')
  // 列表里只有 IE 时：宁可认不出来（退回系统默认），也绝不能开错应用
  assert.equal(pickPreferredApp([{ id: 'IEXPLORE.EXE', name: 'Internet Explorer' }], 'explorer'), null)
})

test('pickPreferredApp：通用词不参与整词包含', () => {
  const apps = [{ id: 'whatever.exe', name: 'Code Studio Viewer' }]
  assert.equal(pickPreferredApp(apps, 'vscode'), null, 'vscode 的别名 code/studio 都是通用词，不许模糊包含')
})

test('pickPreferredApp：id 精确 → 别名包含 → 找不到返回 null', () => {
  const apps = [
    { id: 'rider64.exe', name: 'JetBrains Rider 2026.2.1' },
    { id: 'code.exe', name: 'Visual Studio Code' },
  ]
  assert.equal(pickPreferredApp(apps, 'rider64.exe').id, 'rider64.exe', 'id 精确')
  assert.equal(pickPreferredApp(apps, 'rider').id, 'rider64.exe', '官方 id → 名字别名')
  assert.equal(pickPreferredApp(apps, 'vscode').id, 'code.exe', 'vscode → code.exe')
  assert.equal(pickPreferredApp(apps, 'androidstudio'), null, '找不到就交回调用方')
  assert.equal(pickPreferredApp(apps, null), null)
  assert.equal(pickPreferredApp([], 'rider'), null)
})

test('makeTranslator：支持 {name} 插值，缺变量时保留占位符', () => {
  assert.equal(makeTranslator('zh')('openWithNamed', { name: 'Rider' }), '在 Rider 中打开')
  assert.equal(makeTranslator('en')('openWithNamed', { name: 'Rider' }), 'Open with Rider')
  assert.equal(makeTranslator('zh')('openWithNamed'), '在 {name} 中打开')
  assert.equal(makeTranslator('zh')('nope'), 'nope')
})

test('appIcon：没有 icon 时返回 undefined（不留空图标位）', () => {
  assert.equal(appIcon(null), undefined)
  assert.equal(appIcon({ icon: null }), undefined)
  assert.notEqual(appIcon({ icon: 'data:image/png;base64,AA' }), undefined)
})

test('buildItems：应用列表加载中 → 禁用占位行，且不出现默认应用行/二级菜单（还不知道默认应用是谁）', () => {
  const { items } = buildItems(
    { open: true, file, appsState: 'loading', apps: null },
    { ctx: makeCtx(), sessionId: 's1', desktop: { canOpen: true }, t },
  )
  const list = ids(items)
  assert.ok(list.includes('apps-loading'))
  assert.equal(list.includes('apps'), false)
  assert.equal(list.includes('default-app'), false)
  assert.equal(items.find((item) => item.id === 'apps-loading').disabled, true)
})

test('buildItems：无桌面（浏览器）→ 只剩客户端动作', () => {
  const { items } = buildItems(
    { open: true, file, appsState: 'idle', apps: null },
    { ctx: makeCtx(), sessionId: 's1', desktop: { canOpen: false }, t },
  )
  assert.deepEqual(ids(items), ['open-file', '—', 'copy-relative', 'copy-absolute', 'copy-contents', 'save-as'])
})

test('buildItems：没有会话 id → 需要会话的动作全部消失，且不产生空分隔线', () => {
  const { items } = buildItems(
    { open: true, file, appsState: 'idle', apps: null },
    { ctx: makeCtx(), sessionId: null, desktop: { canOpen: false }, t },
  )
  assert.deepEqual(ids(items), ['copy-relative', 'copy-absolute'])
})

test('relativeToCwd：相对当前工作目录，分隔符统一成正斜杠', () => {
  const { relativeToCwd } = internals
  assert.equal(relativeToCwd('D:\\ws\\proj\\src\\a.ts', 'D:\\ws\\proj'), 'src/a.ts')
  assert.equal(relativeToCwd('D:\\ws\\proj\\src\\sub\\a.ts', 'D:\\ws\\proj\\'), 'src/sub/a.ts', 'cwd 尾部斜杠不影响')
  assert.equal(relativeToCwd('d:\\WS\\proj\\src\\a.ts', 'D:\\ws\\PROJ'), 'src/a.ts', '大小写不敏感')
  assert.equal(relativeToCwd('D:\\ws\\proj', 'D:\\ws\\proj'), '.', '就是工作目录自身')
  assert.equal(relativeToCwd('D:\\other\\a.ts', 'D:\\ws\\proj'), 'D:/other/a.ts', '不在工作目录内 → 退回绝对路径（正斜杠）')
  assert.equal(relativeToCwd('D:\\ws\\proj2\\a.ts', 'D:\\ws\\proj'), 'D:/ws/proj2/a.ts', '前缀相似但不是子路径，不能误剥')
  assert.equal(relativeToCwd('/home/me/proj/src/a.ts', '/home/me/proj'), 'src/a.ts', 'POSIX')
  assert.equal(relativeToCwd('D:\\ws\\proj\\a.ts', ''), null, '没有 cwd → null（调用方提示，不猜）')
  assert.equal(relativeToCwd('D:\\ws\\proj\\a.ts', null), null)
  assert.equal(relativeToCwd('', 'D:\\ws'), null)
})

test('「复制相对路径」按当前工作目录算，「复制绝对路径」给原始绝对路径', async () => {
  const copied = []
  loaded.primitives.writeClipboard = async (text) => { copied.push(text) } // 走官方 writeClipboard 路径
  const ctx = makeCtx()
  fileContextStore.set({ cwd: 'D:\\ws' })
  const built = buildItems(
    { open: true, file, appsState: 'idle', apps: null },
    { ctx, sessionId: 's1', desktop: { canOpen: false }, t },
  )
  await built.actions['copy-relative']()
  await built.actions['copy-absolute']()
  assert.deepEqual(copied, ['src/a.cpp', 'D:\\ws\\src\\a.cpp'])

  // 工作目录没了（例如取不到 cwd）→ 不复制，只提示
  copied.length = 0
  fileContextStore.set({ cwd: null })
  await buildItems(
    { open: true, file, appsState: 'idle', apps: null },
    { ctx, sessionId: 's1', desktop: { canOpen: false }, t },
  ).actions['copy-relative']()
  assert.deepEqual(copied, [], '拿不到工作目录就不能乱复制')
  delete loaded.primitives.writeClipboard
})

test('MenuHost：右侧放不下子菜单时翻转（否则子菜单跑到视口外，根本够不到）', () => {
  const ctx = makeCtx()
  fakeWindow.innerWidth = 1200
  const open = (x) => {
    menuStore.set({ open: true, x, y: 20, file, apps: [], appsState: 'ready', notice: null, diag: null })
    const rendered = MenuHost({ ctx })
    return rendered.__element.slice(2).find((child) => child?.__element !== undefined).__element[1]
  }
  assert.equal(open(100).listClassName, 'ctxm-menu', '左半边：正常向右展开')
  assert.equal(open(1100).listClassName, 'ctxm-menu ctxm-menu-flip', '贴右边缘：翻转向左')
  menuStore.set({ open: false, x: 0, y: 0, file: null, apps: null, appsState: 'idle', notice: null, diag: null })
})

test('MenuHost：关闭态渲染 null；打开态渲染官方 Menu 且不抛异常', () => {
  const ctx = makeCtx()
  menuStore.set({ open: false, x: 0, y: 0, file: null, apps: null, appsState: 'idle', notice: null, diag: null })
  assert.equal(MenuHost({ ctx }), null)

  menuStore.set({ open: true, x: 10, y: 20, file, apps: [], appsState: 'ready', notice: null, diag: null })
  let rendered
  assert.doesNotThrow(() => { rendered = MenuHost({ ctx }) })
  assert.notEqual(rendered, null)
  // MenuHost 经 renderNotice 包了一层 Fragment：Fragment 的 children 从第 3 个参数开始
  const menu = rendered.__element.slice(2).find((child) => child?.__element !== undefined)
  const props = menu.__element[1]
  assert.equal(Array.isArray(props.items), true, '必须走 items 数据接口（二级菜单只在它上面）')
  assert.equal(typeof props.onSelect, 'function')
  assert.equal(props.listClassName, 'ctxm-menu', '给自家菜单卡加类名，CSS 才能只钳制自己的子菜单')
  menuStore.set({ open: false, x: 0, y: 0, file: null, apps: null, appsState: 'idle', notice: null, diag: null })
})