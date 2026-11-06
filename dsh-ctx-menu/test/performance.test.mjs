// 性能层：缓存与硬预算。这几条决定了右键会不会把官方 1000ms 的 resolve 预算撞爆。
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadClient, makeCtx } from './harness.mjs'

const { exports, internals } = loadClient()
const { clearCaches } = internals

function mount(services) {
  clearCaches()
  const ctx = makeCtx(services)
  exports.apply(ctx)
  return { ctx, provider: ctx.providers.find((entry) => entry.target === 'file') }
}

function services({ cwd = 'D:\\ws\\proj', stat, apps, read } = {}) {
  return {
    sessions: { list: { getSnapshot: () => ({ byId: { s1: { cwd } } }) } },
    'remote.workspaceFiles': {
      stat: stat ?? (async () => ({ ok: true, value: { absolutePath: 'D:\\ws\\proj\\src\\a.cpp' } })),
      read: read ?? (async () => ({ ok: true, value: { offset: 1, lines: 1, text: 'x', eof: true } })),
    },
    'remote.session': {
      workspacePathApplications: apps ?? (async () => ({
        ok: true,
        value: [
          { id: 'rider64.exe', name: 'Rider', default: true, icon: null },
          { id: 'code.exe', name: 'VS Code', default: false, icon: null },
        ],
      })),
      openWorkspacePath: async () => ({ ok: true }),
    },
  }
}

test('绝对路径直接使用：不发 stat RPC（改动文件行给的就是绝对路径）', async () => {
  let statCalls = 0
  const { provider } = mount(
    services({
      stat: async () => {
        statCalls += 1
        return { ok: true, value: { absolutePath: 'D:\\ws\\proj\\src\\a.cpp' } }
      },
    }),
  )
  const actions = await provider.resolve({ sessionId: 's1', path: 'D:\\ws\\proj\\src\\a.cpp' })
  assert.equal(statCalls, 0, '已是绝对路径时不该再问宿主要 absolutePath')
  assert.equal(actions.some((a) => a.id === 'copyContents'), true)
})

test('关联应用按扩展名缓存：同一扩展名第二次右键不再枚举', async () => {
  let appsCalls = 0
  const { provider } = mount(
    services({
      apps: async () => {
        appsCalls += 1
        return { ok: true, value: [{ id: 'code.exe', name: 'VS Code', default: true, icon: null }, { id: 'rider64.exe', name: 'Rider', default: false, icon: null }] }
      },
    }),
  )
  const first = await provider.resolve({ sessionId: 's1', path: 'D:\\ws\\proj\\src\\a.cpp' })
  const second = await provider.resolve({ sessionId: 's1', path: 'D:\\ws\\proj\\src\\b.cpp' })
  assert.equal(appsCalls, 1, '同扩展名只枚举一次（这正是官方每次右键都重查、导致慢的地方）')
  assert.equal(first.some((a) => a.id === 'openWith'), true)
  assert.equal(second.some((a) => a.id === 'openWith'), true)
})

test('相对路径的绝对路径解析缓存 30 秒：重复右键不再 stat', async () => {
  let statCalls = 0
  const { provider } = mount(
    services({
      stat: async () => {
        statCalls += 1
        return { ok: true, value: { absolutePath: 'D:\\ws\\proj\\src\\a.cpp' } }
      },
    }),
  )
  await provider.resolve({ sessionId: 's1', path: 'src/a.cpp' })
  await provider.resolve({ sessionId: 's1', path: 'src/a.cpp' })
  assert.equal(statCalls, 1)
})

test('硬预算：枚举太慢时不拖累菜单（先只给复制类动作，后台预热缓存）', async () => {
  clearCaches()
  internals.budgetMs = 30 // 把预算压到 30ms 便于测试
  let release
  const slow = new Promise((resolve) => {
    release = resolve
  })
  const { provider } = mount(
    services({
      apps: () => slow.then(() => ({ ok: true, value: [{ id: 'code.exe', name: 'VS Code', default: true, icon: null }, { id: 'rider64.exe', name: 'Rider', default: false, icon: null }] })),
    }),
  )
  const started = Date.now()
  const first = await provider.resolve({ sessionId: 's1', path: 'D:\\ws\\proj\\src\\a.cpp' })
  const elapsed = Date.now() - started
  assert.ok(elapsed < 400, `必须在预算内返回（实际 ${elapsed}ms）`)
  assert.equal(first.some((a) => a.id === 'openWith'), false, '预算内没等到列表就先不给子菜单')
  assert.equal(first.some((a) => a.id === 'copyRelativePath'), true, '复制类动作不受影响')

  // 后台那次枚举仍在跑：放行后缓存变暖，下一次右键就能直接给子菜单
  release()
  await new Promise((resolve) => setTimeout(resolve, 20))
  const second = await provider.resolve({ sessionId: 's1', path: 'D:\\ws\\proj\\src\\a.cpp' })
  assert.equal(second.some((a) => a.id === 'openWith'), true, '缓存预热后子菜单出现')
  internals.budgetMs = 350
})

test('预算常量：默认 350ms，小于官方的 1000ms resolve 预算', () => {
  clearCaches()
  assert.equal(internals.budgetMs, 350)
})
