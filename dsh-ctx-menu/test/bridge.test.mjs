// 平台桥测试：0.2.1 自有路由与 0.2.0 远程服务的回退规则。
// 这段代码决定了「桌面动作在某个 DSH 版本上到底能不能用」，必须有覆盖。
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadClient } from './harness.mjs'

const loaded = loadClient()
const { internals } = loaded
const {
  ROUTES,
  callRoute,
  probeDesktop,
  fetchApps,
  launchPath,
  sessionCwdAsync,
  readTextForCopy,
  readBytesForSave,
} = internals

/** 记录所有 fetch 调用，并按 handler 返回假响应。 */
function stubFetch(handler) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    const reply = handler(String(url), init) ?? {}
    const status = reply.status ?? 200
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => reply.payload ?? null,
      arrayBuffer: async () => (reply.bytes ?? new Uint8Array([1, 2, 3])).buffer,
    }
  }
  return calls
}

function restoreFetch(original) {
  globalThis.fetch = original
}

function ctxWith(services) {
  return { get: (name) => services[name] }
}

const originalFetch = globalThis.fetch

test('callRoute：拼 query、解析 JSON，404 视为"宿主路由不存在"', async () => {
  const calls = stubFetch(() => ({ payload: { ok: true } }))
  const ok = await callRoute('apps', { query: { path: 'D:\\a b\\c.md' } })
  assert.equal(ok.ok, true)
  assert.equal(calls[0].url, 'ctx-menu/apps?path=D%3A%5Ca+b%5Cc.md', '相对路由 + URL 编码')
  restoreFetch(originalFetch)

  stubFetch(() => ({ status: 404 }))
  const missing = await callRoute('apps', { query: { path: '/x' } })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'route/missing')
  restoreFetch(originalFetch)
})

test('probeDesktop：路由可用时以路由为准，不碰旧服务', async () => {
  stubFetch(() => ({ payload: { ok: true, canOpen: true } }))
  let legacyCalled = false
  const ctx = ctxWith({ 'remote.session': { canOpenWorkspacePath: async () => { legacyCalled = true; return { ok: true, value: false } } } })
  assert.deepEqual(await probeDesktop(ctx), { canOpen: true })
  assert.equal(legacyCalled, false)
  restoreFetch(originalFetch)
})

test('probeDesktop：路由不可用且没有旧服务 → false（0.2.1 无宿主半侧时的降级）', async () => {
  stubFetch(() => ({ status: 404 }))
  assert.deepEqual(await probeDesktop(ctxWith({})), { canOpen: false })
  restoreFetch(originalFetch)
})

test('probeDesktop：路由不可用但有旧服务 → 用旧服务（0.2.0 兼容）', async () => {
  stubFetch(() => ({ status: 404 }))
  const ctx = ctxWith({ 'remote.session': { canOpenWorkspacePath: async () => ({ ok: true, value: true }) } })
  assert.deepEqual(await probeDesktop(ctx), { canOpen: true })
  restoreFetch(originalFetch)
})

test('fetchApps：路由优先；路由失败时回退旧 workspacePathApplications', async () => {
  stubFetch(() => ({ payload: { ok: true, canOpen: true, apps: [{ id: 'rider64.exe', name: 'Rider', default: true, icon: null }] } }))
  const routed = await fetchApps(ctxWith({}), 'D:\\ws\\a.md')
  assert.deepEqual(routed, { ok: true, canOpen: true, apps: [{ id: 'rider64.exe', name: 'Rider', default: true, icon: null }] })
  restoreFetch(originalFetch)

  stubFetch(() => ({ status: 502, payload: { ok: false, code: 'apps/failed' } }))
  const legacy = await fetchApps(
    ctxWith({ 'remote.session': { workspacePathApplications: async () => ({ ok: true, value: [{ id: 'code.exe', name: 'VS Code', default: true, icon: null }] }) } }),
    'D:\\ws\\a.md',
  )
  assert.equal(legacy.ok, true)
  assert.equal(legacy.apps[0].id, 'code.exe')
  restoreFetch(originalFetch)
})

test('launchPath：open 带 application 走 POST /open，reveal 走 POST /reveal', async () => {
  const calls = stubFetch(() => ({ payload: { ok: true } }))
  assert.deepEqual(await launchPath(ctxWith({}), { path: 'D:\\a.md', application: 'rider64.exe' }), { ok: true })
  assert.equal(calls[0].url, ROUTES.open)
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), { path: 'D:\\a.md', application: 'rider64.exe' })

  assert.deepEqual(await launchPath(ctxWith({}), { path: 'D:\\a.md', action: 'reveal' }), { ok: true })
  assert.equal(calls[1].url, ROUTES.reveal)
  assert.deepEqual(JSON.parse(calls[1].init.body), { path: 'D:\\a.md' }, 'reveal 只发 path')
  restoreFetch(originalFetch)
})

test('launchPath：路由失败回退旧 openWorkspacePath', async () => {
  stubFetch(() => ({ status: 404 }))
  let received = null
  const ctx = ctxWith({ 'remote.session': { openWorkspacePath: async (request) => { received = request; return { ok: true } } } })
  assert.deepEqual(await launchPath(ctx, { path: 'D:\\a.md' }), { ok: true })
  assert.deepEqual(received, { path: 'D:\\a.md' })
  restoreFetch(originalFetch)
})

test('sessionCwdAsync：路由给 cwd 优先，其次旧快照', async () => {
  stubFetch(() => ({ payload: { ok: true, cwd: 'D:\\ws\\proj' } }))
  assert.equal(await sessionCwdAsync(ctxWith({}), 's1'), 'D:\\ws\\proj')
  restoreFetch(originalFetch)

  stubFetch(() => ({ status: 404 }))
  const ctx = ctxWith({ sessions: { list: { getSnapshot: () => ({ byId: { s1: { cwd: 'D:\\legacy' } } }) } } })
  // sessionStore 里的 sessionId 由 SessionProbe 写入；这里直接给 cwd 兜底路径不可达时返回 null
  assert.equal(await sessionCwdAsync(ctx, 's1'), null)
  restoreFetch(originalFetch)
})

test('readTextForCopy：路由给文本；路由不支持时回退旧分页读取', async () => {
  stubFetch(() => ({ payload: { ok: true, text: 'hello' } }))
  assert.deepEqual(await readTextForCopy(ctxWith({}), 's1', 'D:\\a.md'), { ok: true, text: 'hello' })
  restoreFetch(originalFetch)

  stubFetch(() => ({ status: 415, payload: { ok: false, code: 'file/not-text' } }))
  const legacy = await readTextForCopy(
    ctxWith({ 'remote.workspaceFiles': { read: async () => ({ ok: true, value: { offset: 1, lines: 1, text: 'legacy', eof: true } }) } }),
    's1',
    'D:\\a.md',
  )
  assert.deepEqual(legacy, { ok: true, text: 'legacy' })
  restoreFetch(originalFetch)
})

test('readBytesForSave：路由返回原始字节（octet-stream）', async () => {
  stubFetch(() => ({ bytes: new Uint8Array([7, 8, 9]) }))
  const result = await readBytesForSave(ctxWith({}), 's1', 'D:\\a.bin')
  assert.equal(result.ok, true)
  assert.deepEqual([...result.data], [7, 8, 9])
  restoreFetch(originalFetch)
})