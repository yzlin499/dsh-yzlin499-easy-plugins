// 工作区级工具门控（右键菜单 → 面板）的纯函数单测。
// 关注三件事：cwd 归到哪个 workspace 根、条目怎么取、两层 deny 怎么合并。
import assert from 'node:assert/strict'
import test from 'node:test'
import { describeSessionTools, describeWorkspaceTools, disabledToolsFor, mergeDeny, workspaceKeyOf } from '../index.js'

const ROOTS = ['D:\\work\\projA', 'D:\\work\\projA-sub', 'D:\\work\\projB']

test('workspaceKeyOf：会话在 workspace 子目录里也归到该根', () => {
  assert.equal(workspaceKeyOf('D:\\work\\projA\\src\\deep', ROOTS), 'd:\\work\\proja')
  assert.equal(workspaceKeyOf('d:\\WORK\\PROJA', ROOTS), 'd:\\work\\proja')
})

test('workspaceKeyOf：前缀相同的兄弟目录不算同一工作区', () => {
  assert.equal(workspaceKeyOf('D:\\work\\projA-other', ROOTS), 'd:\\work\\proja-other')
  // 嵌套根取最长匹配
  assert.equal(workspaceKeyOf('D:\\work\\projA-sub\\x', ROOTS), 'd:\\work\\proja-sub')
})

test('workspaceKeyOf：没有根匹配 / 空 cwd', () => {
  assert.equal(workspaceKeyOf('E:\\elsewhere', ROOTS), 'e:\\elsewhere')
  assert.equal(workspaceKeyOf('', ROOTS), '')
  assert.equal(workspaceKeyOf(undefined, ROOTS), '')
})

test('disabledToolsFor：命中本工作区条目，子目录继承', () => {
  const entries = [
    { path: 'd:\\work\\proja', disabled: ['mcp__ue__play', 'mcp__rider__build'] },
    { path: 'd:\\work\\projb', disabled: ['mcp__other__x'] },
  ]
  assert.deepEqual(
    disabledToolsFor(entries, 'D:\\work\\projA', ROOTS).sort(),
    ['mcp__rider__build', 'mcp__ue__play'],
  )
  assert.deepEqual(disabledToolsFor(entries, 'D:\\work\\projA\\src', ROOTS).sort(), ['mcp__rider__build', 'mcp__ue__play'])
  assert.deepEqual(disabledToolsFor(entries, 'D:\\work\\projB', ROOTS), ['mcp__other__x'])
})

test('disabledToolsFor：无条目 / 无 cwd / 脏数据都退化成空', () => {
  assert.deepEqual(disabledToolsFor([], 'D:\\work\\projA', ROOTS), [])
  assert.deepEqual(disabledToolsFor(undefined, 'D:\\work\\projA', ROOTS), [])
  assert.deepEqual(disabledToolsFor([{ path: 'd:\\work\\proja', disabled: 'oops' }], 'D:\\work\\projA', ROOTS), [])
  assert.deepEqual(disabledToolsFor([{ path: 'd:\\work\\proja', disabled: ['', null, 3] }], 'D:\\work\\projA', ROOTS), [])
})

test('mergeDeny：项目级在前、去重、丢弃注册表里不存在的工具名', () => {
  const known = new Set(['mcp__a__t1', 'mcp__b__t2', 'mcp__stale__gone'])
  const merged = mergeDeny(['mcp__a__t1'], ['mcp__b__t2', 'mcp__a__t1', 'mcp__removed__x'], known)
  assert.deepEqual(merged, ['mcp__a__t1', 'mcp__b__t2'])
})

test('mergeDeny：注册表不可用（known=null）时不做失效过滤', () => {
  assert.deepEqual(mergeDeny(['a'], ['b', 'a'], null), ['a', 'b'])
  assert.deepEqual(mergeDeny(undefined, undefined, new Set()), [])
})

// ── 面板数据源 ────────────────────────────────────────────────────────────
const SERVERS = [
  { name: 'ue', transport: 'streamable-http', workspaceRoot: 'D:\\work\\projA', source: 'D:\\work\\projA\\.mcp.json' },
  { name: 'rider', transport: 'stdio', workspaceRoot: 'D:\\work\\projB', source: 'D:\\work\\projB\\.mcp.json' },
  { name: 'codegraph', transport: 'stdio', workspaceRoot: undefined, source: '~/.mcp.json' },
]
const SCHEMAS = [
  { name: 'mcp__ue__play', description: '播放关卡' },
  { name: 'mcp__ue__compile', description: '编译' },
  { name: 'mcp__rider__build', description: '构建' },
  { name: 'mcp__codegraph__query', description: '查符号' },
  { name: 'read', description: '不是 MCP 工具' },
]

test('describeWorkspaceTools：只列本工作区可见的服务器（用户级 + 本工作区项目级）', () => {
  const out = describeWorkspaceTools(SERVERS, SCHEMAS, [], 'D:\\work\\projA', ROOTS, (name) => name === 'ue')
  assert.equal(out.ok, true)
  assert.equal(out.workspace.key, 'd:\\work\\proja')
  assert.deepEqual(out.servers.map((s) => s.name), ['codegraph', 'ue'])
  const ue = out.servers.find((s) => s.name === 'ue')
  assert.equal(ue.level, 'project')
  assert.equal(ue.mounted, true)
  assert.equal(ue.source, 'D:\\work\\projA\\.mcp.json')
  const codegraph = out.servers.find((s) => s.name === 'codegraph')
  assert.equal(codegraph.level, 'user')
  assert.equal(codegraph.workspaceRoot, null)
  assert.equal(codegraph.mounted, false)
})

test('describeWorkspaceTools：工具按服务器前缀归属，禁用状态来自条目，按名字排序', () => {
  const entries = [{ path: 'd:\\work\\proja', disabled: ['mcp__ue__play'] }]
  const out = describeWorkspaceTools(SERVERS, SCHEMAS, entries, 'D:\\work\\projA', ROOTS)
  const ue = out.servers.find((s) => s.name === 'ue')
  assert.deepEqual(ue.tools.map((t) => t.name), ['mcp__ue__compile', 'mcp__ue__play'])
  assert.deepEqual(ue.tools.map((t) => t.disabled), [false, true])
  assert.equal(ue.tools[1].description, '播放关卡')
  // 内置工具不属于任何服务器
  assert.equal(out.servers.some((s) => s.tools.some((t) => t.name === 'read')), false)
  assert.equal(out.total, 2 + 1)
})

test('describeWorkspaceTools：子目录会话命中同一工作区，别的项目级服务器不出现', () => {
  const out = describeWorkspaceTools(SERVERS, SCHEMAS, [], 'D:\\work\\projA\\src\\deep', ROOTS)
  assert.deepEqual(out.servers.map((s) => s.name), ['codegraph', 'ue'])
  assert.equal(out.workspace.key, 'd:\\work\\proja')
})

test('describeWorkspaceTools：没有服务器 / 没有工具时是空列表而不是报错', () => {
  assert.deepEqual(describeWorkspaceTools([], SCHEMAS, [], 'D:\\work\\projA', ROOTS).servers, [])
  const noTools = describeWorkspaceTools([{ name: 'down', transport: 'stdio' }], SCHEMAS, [], 'D:\\work\\projA', ROOTS)
  assert.deepEqual(noTools.servers[0].tools, [])
  assert.equal(noTools.total, 0)
})


// ── 右侧栏「MCP 管理」面板数据源 ──────────────────────────────────────────
const PANEL_SCHEMAS = [
  { name: 'mcp__ue__play', description: '播放', parameters: { type: 'object', properties: { level: { type: 'string' } } } },
  { name: 'mcp__ue__stop', description: '停止', parameters: { type: 'object', properties: {} } },
  { name: 'mcp__rider__build', description: '构建', parameters: { type: 'object', properties: {} } },
  { name: 'read', description: '内置工具' },
]

test('describeSessionTools：只列被挡住的工具（含参数 schema），可见工具不出现', () => {
  const deny = new Set(['mcp__ue__play', 'mcp__rider__build'])
  const out = describeSessionTools(SERVERS, PANEL_SCHEMAS, deny, new Set(), (name) => name === 'ue')
  assert.deepEqual(out.map((server) => server.name), ['rider', 'ue'])
  const ue = out.find((server) => server.name === 'ue')
  assert.equal(ue.level, 'project')
  assert.equal(ue.mounted, true)
  assert.equal(ue.total, 2) // 该服务器一共 2 个工具（play/stop）
  assert.deepEqual(ue.tools.map((tool) => tool.name), ['mcp__ue__play'])
  assert.deepEqual(ue.tools[0].parameters, { type: 'object', properties: { level: { type: 'string' } } })
  assert.equal(ue.tools[0].injected, false)
  // 内置工具永远不进 MCP 面板
  assert.equal(out.some((server) => server.tools.some((tool) => tool.name === 'read')), false)
})

test('describeSessionTools：临时注入的工具仍然列出来（标记 injected）', () => {
  const deny = new Set(['mcp__ue__play'])
  const out = describeSessionTools(SERVERS, PANEL_SCHEMAS, deny, new Set(['mcp__ue__play']))
  const ue = out.find((server) => server.name === 'ue')
  assert.deepEqual(ue.tools.map((tool) => tool.name), ['mcp__ue__play'])
  assert.equal(ue.tools[0].injected, true)
})

test('describeSessionTools：没有隐藏工具的服务器整块不出现', () => {
  const out = describeSessionTools(SERVERS, PANEL_SCHEMAS, new Set(['mcp__ue__play']), new Set())
  assert.deepEqual(out.map((server) => server.name), ['ue'])
  assert.deepEqual(describeSessionTools(SERVERS, PANEL_SCHEMAS, new Set(), new Set()), [])
})
