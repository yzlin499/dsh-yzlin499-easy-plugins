// 工作区级工具门控（右键菜单 → 面板）的纯函数单测。
// 关注三件事：cwd 归到哪个 workspace 根、条目怎么取、两层 deny 怎么合并。
import assert from 'node:assert/strict'
import test from 'node:test'
import { disabledToolsFor, mergeDeny, workspaceKeyOf } from '../index.js'

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
