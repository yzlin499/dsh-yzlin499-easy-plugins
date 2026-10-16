// gate 规则测试：重点证明「与外壳互补」——外壳会弹菜单的情形一律放行。
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadClient } from './harness.mjs'
import { makeEl, makeEvent, makeWindow } from './fake-dom.mjs'

const { internals } = loadClient()
const { gate, SELECTORS } = internals

function sessionRow({ id = 's1', buttons = 2, rect, className = '', menuOpen = false } = {}) {
  const rowActions = makeEl([], { className: 'Rows_module_css_default rowActions hIlkoa_rowActions' })
  const row = makeEl([SELECTORS.sessionRow], {
    className: `Rows_module_css_default row ${menuOpen ? 'hIlkoa_menuOpen' : ''} ${className}`.trim(),
    attrs: { 'data-row-key': `session:${id}` },
    children: [rowActions],
  })
  for (let index = 0; index < buttons; index += 1) {
    rowActions.children.push(makeEl(['button', 'button[type="button"]'], { parent: rowActions, rect }))
  }
  rowActions.parentElement = row
  return { row, rowActions, trigger: rowActions.children[0] }
}

test('非右键不接管', () => {
  const { row } = sessionRow()
  assert.equal(gate(makeEvent(row, { button: 0 }), makeWindow(), {}), null)
})

test('别人已经 preventDefault → 退让', () => {
  const { row } = sessionRow()
  assert.equal(gate(makeEvent(row, { defaultPrevented: true }), makeWindow(), {}), null)
})

test('C1：可编辑域一律放行（外壳要弹编辑菜单）', () => {
  const input = makeEl(['input']) // closest(SELECTORS.editable) 会逐段匹配 'input'
  const { row } = sessionRow()
  input.parentElement = row
  assert.equal(gate(makeEvent(input), makeWindow(), {}), null)
})

test('C1：有选中文本一律放行（外壳要弹「复制」）', () => {
  const { row } = sessionRow()
  assert.equal(gate(makeEvent(row), makeWindow({ selection: 'hello' }), {}), null)
  // 纯空白不算选中
  assert.notEqual(gate(makeEvent(row), makeWindow({ selection: '   ' }), {}), null)
})

test('排除区：终端 / 文档预览 / 已开菜单 / 自己的浮层', () => {
  for (const tag of SELECTORS.skip.split(',').map((part) => part.trim())) {
    const inside = makeEl([tag])
    assert.equal(gate(makeEvent(inside), makeWindow(), {}), null, `应放行 ${tag}`)
  }
})

test('没有命中任何锚点 → 完全不干预', () => {
  const plain = makeEl(['div'])
  assert.equal(gate(makeEvent(plain), makeWindow(), {}), null)
})

test('会话行：命中并给出官方 ⋯ 按钮（rowActions 内第一个按钮）', () => {
  const { row, trigger } = sessionRow()
  const hit = gate(makeEvent(row), makeWindow(), {})
  assert.equal(hit.kind, 'row')
  assert.equal(hit.type, 'session')
  assert.equal(hit.id, 's1')
  assert.equal(hit.trigger, trigger)
})

test('未分组（workspace: 空 id）不接管', () => {
  const rowActions = makeEl([], { className: 'rowActions' })
  const row = makeEl([SELECTORS.workspaceRow], { attrs: { 'data-row-key': 'workspace:' }, children: [rowActions] })
  rowActions.parentElement = row
  rowActions.children.push(makeEl(['button', 'button[type="button"]'], { parent: rowActions }))
  assert.equal(gate(makeEvent(row), makeWindow(), {}), null)
})

test('工作区行只有一个按钮（未分组只剩「新建会话」）不接管', () => {
  const rowActions = makeEl([], { className: 'rowActions' })
  const row = makeEl([SELECTORS.workspaceRow], { attrs: { 'data-row-key': 'workspace:w1' }, children: [rowActions] })
  rowActions.parentElement = row
  rowActions.children.push(makeEl(['button', 'button[type="button"]'], { parent: rowActions }))
  assert.equal(gate(makeEvent(row), makeWindow(), {}), null)
})

test('工作区行有两个按钮 → 接管，且取第一个（⋯ 在前）', () => {
  const rowActions = makeEl([], { className: 'rowActions' })
  const row = makeEl([SELECTORS.workspaceRow], { attrs: { 'data-row-key': 'workspace:w1' }, children: [rowActions] })
  rowActions.parentElement = row
  const trigger = makeEl(['button', 'button[type="button"]'], { parent: rowActions })
  rowActions.children.push(trigger, makeEl(['button', 'button[type="button"]'], { parent: rowActions }))
  const hit = gate(makeEvent(row), makeWindow(), {})
  assert.equal(hit.kind, 'row')
  assert.equal(hit.type, 'workspace')
  assert.equal(hit.trigger, trigger)
})

test('行内按钮上右键 → 交给原生', () => {
  const { row, rowActions } = sessionRow()
  const inner = makeEl(['button', 'button[type="button"]'], { parent: rowActions })
  rowActions.children.push(inner)
  assert.equal(gate(makeEvent(inner), makeWindow(), {}), null)
})

test('菜单已开（_menuOpen）不接管，避免 toggle 关掉', () => {
  const { row } = sessionRow({ menuOpen: true })
  assert.equal(gate(makeEvent(row), makeWindow(), {}), null)
})

test('非 hover 触发时 rowActions 不可见（rect 为 0）不接管', () => {
  const { row } = sessionRow({ rect: { width: 0, height: 0 } })
  assert.equal(gate(makeEvent(row), makeWindow(), {}), null)
  const { row: hiddenRow } = sessionRow()
  const hiddenHit = gate(makeEvent(hiddenRow), makeWindow({ style: { display: 'none', visibility: 'visible' } }), {})
  assert.equal(hiddenHit, null)
})

test('改动文件行：绝对路径取自官方渲染的隐藏 span', () => {
  const span = makeEl(['span'], { text: 'D:\\repo\\Source\\a.cpp' })
  const describedBy = 'ctx-1'
  const rowButton = makeEl([SELECTORS.changedFileRow], {
    attrs: { 'aria-describedby': describedBy },
    children: [makeEl(['span'], { text: 'Source/a.cpp' })],
  })
  const container = makeEl([SELECTORS.changedFiles], { children: [rowButton] })
  rowButton.parentElement = container
  const doc = { getElementById: (id) => (id === describedBy ? span : null) }
  const hit = gate(makeEvent(rowButton), makeWindow(), doc)
  assert.equal(hit.kind, 'file')
  assert.equal(hit.file.path, 'D:\\repo\\Source\\a.cpp')
  assert.equal(hit.file.display, 'Source/a.cpp')
  assert.equal(hit.file.absolute, true)
  assert.equal(hit.file.source, 'changed')
})

test('改动文件行：隐藏 span 缺失或为空 → 不接管', () => {
  const rowButton = makeEl([SELECTORS.changedFileRow], { attrs: { 'aria-describedby': 'missing' } })
  const container = makeEl([SELECTORS.changedFiles], { children: [rowButton] })
  rowButton.parentElement = container
  assert.equal(gate(makeEvent(rowButton), makeWindow(), { getElementById: () => null }), null)
})

test('对比页文件行：拿不到绝对路径就不猜', () => {
  const review = makeEl([SELECTORS.reviewFile], { attrs: { 'data-review-file': 'src/a.cpp', title: 'src/a.cpp' } })
  const hit = gate(makeEvent(review), makeWindow(), {})
  assert.equal(hit, null)
  const absolute = makeEl([SELECTORS.reviewFile], { attrs: { 'data-review-file': 'src/a.cpp', title: '/repo/src/a.cpp' } })
  const ok = gate(makeEvent(absolute), makeWindow(), {})
  assert.equal(ok.kind, 'file')
  assert.equal(ok.file.absolute, true)
})

test('交付卡片：title 就是绝对路径', () => {
  const card = makeEl([SELECTORS.presentedFile], { attrs: { title: 'D:\\repo\\out\\a.bin' } })
  const hit = gate(makeEvent(card), makeWindow(), {})
  assert.equal(hit.kind, 'file')
  assert.equal(hit.file.path, 'D:\\repo\\out\\a.bin')
  assert.equal(hit.file.source, 'presented')
})

test('路径工具', () => {
  assert.equal(internals.isAbsolutePath('/usr/a'), true)
  assert.equal(internals.isAbsolutePath('D:\\a'), true)
  assert.equal(internals.isAbsolutePath('\\\\srv\\share'), true)
  assert.equal(internals.isAbsolutePath('src/a.cpp'), false)
  assert.equal(internals.lastSegment('D:\\repo\\a.cpp'), 'a.cpp')
  assert.equal(internals.lastSegment('/repo/a'), 'a')
})

test('改动文件卡片：单文件分支（data-single）也接管', () => {
  const holder = makeEl(['span[hidden]'], { text: 'D:\\repo\\only.cpp' })
  const card = makeEl([SELECTORS.changedFiles], { attrs: { 'data-single': 'true' }, children: [holder] })
  holder.parentElement = card
  const hit = gate(makeEvent(card), makeWindow(), {})
  assert.equal(hit.kind, 'file')
  assert.equal(hit.file.source, 'changed-single')
  assert.equal(hit.file.path, 'D:\\repo\\only.cpp')
  assert.equal(hit.file.absolute, true)
})

test('改动文件卡片：既不是多文件行、也不是单文件 → 不接管', () => {
  const inner = makeEl(['div'])
  const card = makeEl([SELECTORS.changedFiles], { children: [inner] })
  inner.parentElement = card
  assert.equal(gate(makeEvent(inner), makeWindow(), {}), null)
})

test('交付卡片：只认绝对路径的 title', () => {
  const relativeOnly = makeEl([SELECTORS.presentedFile], { attrs: { title: 'out/a.bin' } })
  assert.equal(gate(makeEvent(relativeOnly), makeWindow(), {}), null)
  const child = makeEl(['[title]'], { attrs: { title: 'D:\\repo\\out\\a.bin' } })
  const withChild = makeEl([SELECTORS.presentedFile], { children: [child] })
  child.parentElement = withChild
  const hit = gate(makeEvent(withChild), makeWindow(), {})
  assert.equal(hit.kind, 'file')
  assert.equal(hit.file.path, 'D:\\repo\\out\\a.bin')
})

test('诊断报告能说清「为什么没接管」', () => {
  const report = internals.diagnose(makeEvent(makeEl(['div']), { altKey: true }), makeWindow(), {})
  assert.match(report, /gate: 放行/)
  assert.match(report, /原因: 没有命中任何锚点/)

  const { row } = sessionRow()
  const selected = internals.diagnose(makeEvent(row, { altKey: true }), makeWindow({ selection: 'abc' }), {})
  assert.match(selected, /原因: 有选中文本/)

  const hitReport = internals.diagnose(makeEvent(row, { altKey: true }), makeWindow(), {})
  assert.match(hitReport, /gate: row/)
})