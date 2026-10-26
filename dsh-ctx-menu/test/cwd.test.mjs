// 跨会话/跨工作区的 cwd 解析：这次事故的核心（"只有当前工作区能右键"）。
// 覆盖两条路径：useSessions 快照（官方 0.2.1 的取法）与异步 pending 解析。
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadClient } from './harness.mjs'

const loaded = loadClient()
const { internals, window: fakeWindow } = loaded
const { SessionProbe, syncProbeCwd, openPendingMenu, sessionCwdAsync, menuStore, fileContextStore, makeTranslator } = internals

const originalFetch = globalThis.fetch

/** React 桩：useState 返回稳定值，useEffect 立即执行（拿到清理函数）。 */
function probeWith(props) {
  SessionProbe(props)
}

test('syncProbeCwd：useSessions 快照给的 cwd 落到 store（其它工作区的会话也覆盖）', () => {
  fileContextStore.set({ cwd: null })
  syncProbeCwd('D:\\other-workspace\\proj')
  assert.equal(fileContextStore.get().cwd, 'D:\\other-workspace\\proj')
  assert.equal(fakeWindow.__DSH_CTX_MENU__.sessionCwdSource, 'useSessions')
})

test('syncProbeCwd：hook 暂时为空时不覆盖已解析出的 cwd', () => {
  fileContextStore.set({ cwd: 'D:\\ws\\proj' })
  syncProbeCwd(undefined)
  assert.equal(fileContextStore.get().cwd, 'D:\\ws\\proj', '别把好的清掉')
  assert.equal(fakeWindow.__DSH_CTX_MENU__.sessionCwdSource, 'session-service')
  fileContextStore.set({ cwd: null })
  syncProbeCwd('')
  assert.equal(fakeWindow.__DSH_CTX_MENU__.sessionCwdSource, 'none')
})

test('SessionProbe 在 useSessions 缺失时不会破坏 hook 顺序（有兜底 hook）', () => {
  assert.doesNotThrow(() => probeWith({ sessionId: 's1' }))
  assert.doesNotThrow(() => probeWith({}))
})

test('sessionCwdAsync：已缓存的 cwd 直接返回，不发请求', async () => {
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    return { status: 404, ok: false, json: async () => null }
  }
  fileContextStore.set({ cwd: 'D:\\cached' })
  assert.equal(await sessionCwdAsync({ get: () => undefined }, 's1'), 'D:\\cached')
  assert.deepEqual(calls, [], '不浪费一次宿主往返')
  globalThis.fetch = originalFetch
})

test('openPendingMenu：拿到 cwd 后把相对路径解析成绝对路径并弹出菜单', async () => {
  fileContextStore.set({ cwd: 'D:\\ws\\proj' })
  menuStore.set({ open: false, x: 0, y: 0, file: null, apps: null, appsState: 'idle', notice: null, diag: null })
  await openPendingMenu({ get: () => undefined }, { path: 'src/a.ts', display: 'src/a.ts', source: 'mention' }, 40, 60)
  const state = menuStore.get()
  assert.equal(state.open, true)
  assert.equal(state.file.path, 'D:\\ws\\proj\\src\\a.ts')
  assert.equal(state.x, 40)
  assert.equal(state.y, 60)
})

test('openPendingMenu：解析不了 cwd 时给出明确提示，并留下取证信息', async () => {
  fileContextStore.set({ cwd: null })
  menuStore.set({ open: false, x: 0, y: 0, file: null, apps: null, appsState: 'idle', notice: null, diag: null })
  globalThis.fetch = async () => ({ status: 404, ok: false, json: async () => null })
  await openPendingMenu({ get: () => undefined }, { path: 'src/a.ts', display: 'src/a.ts', source: 'mention' }, 1, 2)
  const state = menuStore.get()
  assert.equal(state.open, false, '解析不了就不弹菜单')
  assert.match(String(state.notice ?? ''), /工作目录/, '要明确说"取不到工作目录"，而不是静默')
  assert.equal(fakeWindow.__DSH_CTX_MENU__.lastPendingFailure.raw, 'src/a.ts')
  globalThis.fetch = originalFetch
})

test('makeTranslator 的 noCwd 文案存在（提示来源）', () => {
  assert.match(makeTranslator('zh')('noCwd'), /工作目录/)
  assert.match(makeTranslator('en')('noCwd'), /directory/i)
})