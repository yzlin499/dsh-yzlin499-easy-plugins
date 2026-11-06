// 菜单贡献本身：注册形状、动作清单、子菜单排序、以及动作真正执行的效果。
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadClient, makeCtx, stubClipboard } from './harness.mjs'

const { exports, internals } = loadClient()
const { NS, VERSION, DICT } = internals

/** 装好插件并取出 file 目标贡献。 */
function mountFileProvider(services) {
  const ctx = makeCtx(services)
  exports.apply(ctx)
  const provider = ctx.providers.find((entry) => entry.target === 'file')
  assert.notEqual(provider, undefined, '必须注册 file 目标的菜单贡献')
  return { ctx, provider }
}

function servicesWith({ cwd = 'D:\\ws\\proj', absolutePath = 'D:\\ws\\proj\\src\\a.cpp', apps = [], text = 'hello' } = {}) {
  return {
    sessions: { list: { getSnapshot: () => ({ byId: { s1: { cwd } } }) } },
    'remote.workspaceFiles': {
      stat: async () => (absolutePath === null ? { ok: false } : { ok: true, value: { absolutePath } }),
      read: async () => ({ ok: true, value: { offset: 1, lines: 1, text, eof: true } }),
    },
    'remote.session': {
      workspacePathApplications: async () => ({ ok: true, value: apps }),
      openWorkspacePath: async () => ({ ok: true, value: { opened: true } }),
    },
  }
}

test('导出契约：name / inject / version', () => {
  assert.equal(exports.name, NS)
  assert.deepEqual(exports.inject, ['contextMenus', 'slots'], '只硬依赖官方统一右键服务')
  assert.equal(VERSION, '0.3.1')
})

test('注册形状：id 唯一、file 目标、order 300（排在官方 100/200 之后）', () => {
  const { provider } = mountFileProvider(servicesWith())
  assert.equal(provider.id, 'dsh-ctx-menu.file')
  assert.equal(provider.target, 'file')
  assert.equal(provider.order, 300)
  assert.equal(typeof provider.resolve, 'function')
})

test('resolve：给出「打开方式 ▸ / 复制相对路径 / 复制文件内容」三个动作', async () => {
  const { provider } = mountFileProvider(
    servicesWith({
      apps: [
        { id: 'code.exe', name: 'VS Code', default: false, icon: null },
        { id: 'rider64.exe', name: 'Rider', default: true, icon: null },
      ],
    }),
  )
  const actions = await provider.resolve({ sessionId: 's1', path: 'src/a.cpp' })
  assert.deepEqual(actions.map((a) => a.id), ['openWith', 'copyRelativePath', 'copyContents'])
  const openWith = actions[0]
  assert.equal(openWith.label, DICT.zh.openWith)
  assert.deepEqual(openWith.children.map((c) => c.label), ['Rider（默认）', 'VS Code'], '默认应用置顶并标注')
  assert.equal(openWith.children[0].id, 'app:rider64.exe')
  assert.equal(actions[1].separatorBefore, true, '与官方动作之间画分隔线')
})

test('resolve：只有一个关联应用时不弹「打开方式」（官方已给默认应用）', async () => {
  const { provider } = mountFileProvider(servicesWith({ apps: [{ id: 'code.exe', name: 'VS Code', default: true, icon: null }] }))
  const actions = await provider.resolve({ sessionId: 's1', path: 'src/a.cpp' })
  assert.equal(actions.some((a) => a.id === 'openWith'), false)
})

test('resolve：path 为空时不贡献任何动作（不猜）', async () => {
  const { provider } = mountFileProvider(servicesWith())
  assert.deepEqual(await provider.resolve({ sessionId: 's1', path: '' }), [])
  assert.deepEqual(await provider.resolve({ sessionId: 's1' }), [])
})

test('动作执行：复制相对路径 → 剪贴板是相对路径 + 提示已复制', async () => {
  const written = stubClipboard()
  const { ctx, provider } = mountFileProvider(servicesWith())
  const actions = await provider.resolve({ sessionId: 's1', path: 'src/a.cpp' })
  const relative = actions.find((a) => a.id === 'copyRelativePath')
  assert.equal(relative.disabled, false)
  await relative.run()
  assert.deepEqual(written, ['src/a.cpp'])
  assert.deepEqual(ctx.notices, [{ text: DICT.zh.copied, ok: true }])
})

test('动作执行：复制文件内容 → 剪贴板是正文', async () => {
  const written = stubClipboard()
  const { provider } = mountFileProvider(servicesWith({ text: '# hi\n' }))
  const actions = await provider.resolve({ sessionId: 's1', path: 'src/a.cpp' })
  await actions.find((a) => a.id === 'copyContents').run()
  assert.deepEqual(written, ['# hi\n'])
})

test('动作执行：选「打开方式」子项 → 用该应用的 id 启动绝对路径', async () => {
  let opened = null
  const services = servicesWith({
    apps: [
      { id: 'rider64.exe', name: 'Rider', default: true, icon: null },
      { id: 'code.exe', name: 'VS Code', default: false, icon: null },
    ],
  })
  services['remote.session'].openWorkspacePath = async (request) => {
    opened = request
    return { ok: true }
  }
  const { provider } = mountFileProvider(services)
  const actions = await provider.resolve({ sessionId: 's1', path: 'src/a.cpp' })
  await actions[0].children[1].run()
  assert.deepEqual(opened, { path: 'D:\\ws\\proj\\src\\a.cpp', application: 'code.exe' })
})

test('没有工作目录时「复制相对路径」置灰（而不是给个错的相对路径）', async () => {
  const { provider } = mountFileProvider(servicesWith({ cwd: null, absolutePath: 'D:\\ws\\proj\\src\\a.cpp' }))
  const actions = await provider.resolve({ sessionId: 's1', path: 'src/a.cpp' })
  assert.equal(actions.find((a) => a.id === 'copyRelativePath').disabled, true)
})

test('语言：英文界面用英文字案', async () => {
  const services = servicesWith()
  services.locale = { getLocale: () => ({ active: 'en' }), subscribe: () => () => {} }
  const { provider } = mountFileProvider(services)
  const actions = await provider.resolve({ sessionId: 's1', path: 'src/a.cpp' })
  assert.equal(actions.find((a) => a.id === 'copyRelativePath').label, DICT.en.copyRelativePath)
})
