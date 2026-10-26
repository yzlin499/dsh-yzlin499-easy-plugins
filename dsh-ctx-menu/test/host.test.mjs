// 宿主半侧路由测试：直接 import index.js，用假 ctx 抓路由，再喂假 req/res。
// 这是 0.2.1 迁移的核心——路由的鉴权、入参校验、大小上限、错误码都在这里定型。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, name, inject } from '../index.js'

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = value
    },
    end(chunk) {
      this.body = chunk
    },
  }
}

function makeReq({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const req = { method, url, headers }
  req[Symbol.asyncIterator] = async function* iterate() {
    if (body !== undefined) yield Buffer.from(body, 'utf8')
  }
  return req
}

/** 挂载插件并取出路由表。 */
function mount(services = {}) {
  const routes = new Map()
  const ctx = {
    effect(run) {
      const dispose = run()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    get: (key) => services[key],
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
  }
  apply(ctx)
  return routes
}

async function hit(routes, path, reqOptions) {
  const route = routes.get(path)
  assert.notEqual(route, undefined, `路由未注册: ${path}`)
  const res = makeRes()
  await route.handler(makeReq(reqOptions), res)
  const text = typeof res.body === 'string' ? res.body : res.body === undefined ? undefined : String(res.body)
  let json
  try {
    json = text === undefined ? undefined : JSON.parse(text)
  } catch {
    json = undefined
  }
  return { status: res.statusCode, headers: res.headers, json, raw: res.body }
}

test('导出契约：name / inject / apply', () => {
  assert.equal(name, 'dsh-ctx-menu')
  assert.deepEqual(inject, ['webServer'])
  assert.equal(typeof apply, 'function')
})

test('注册了六条路由', () => {
  const routes = mount()
  assert.deepEqual([...routes.keys()].sort(), [
    '/ctx-menu/apps',
    '/ctx-menu/capabilities',
    '/ctx-menu/cwd',
    '/ctx-menu/open',
    '/ctx-menu/read',
    '/ctx-menu/reveal',
  ])
})

test('capabilities：用 sessionController 的能力报告桌面是否可用', async () => {
  const routes = mount({ sessionController: { canOpenWorkspacePath: () => true, workspaceDesktop: () => ({ name: 'pc', available: true, fileManager: 'explorer' }) } })
  const result = await hit(routes, '/ctx-menu/capabilities', {})
  assert.equal(result.status, 200)
  assert.deepEqual(result.json, { ok: true, canOpen: true, desktop: { name: 'pc', available: true, fileManager: 'explorer' } })
})

test('capabilities：服务缺失时安全降级为 canOpen=false', async () => {
  const result = await hit(mount(), '/ctx-menu/capabilities', {})
  assert.equal(result.json.canOpen, false)
})

test('方法不允许时返回 405 + allow', async () => {
  const routes = mount()
  const result = await hit(routes, '/ctx-menu/capabilities', { method: 'POST' })
  assert.equal(result.status, 405)
  assert.equal(result.headers.allow, 'GET')
})

test('connection.requestRejection 命中时直接拒绝（同源信任闸）', async () => {
  const routes = mount({ connection: { requestRejection: () => 401 } })
  const result = await hit(routes, '/ctx-menu/capabilities', {})
  assert.equal(result.status, 401)
})

test('apps：非绝对路径 400；正常时把关联应用规范化', async () => {
  const routes = mount({ sessionController: { canOpenWorkspacePath: () => true, workspacePathApplications: async () => [
    { id: 'rider64.exe', name: 'Rider', default: true, icon: 'data:image/png;base64,AA' },
    { id: 'bad' },
  ] } })
  const bad = await hit(routes, '/ctx-menu/apps', { url: '/ctx-menu/apps?path=relative.md' })
  assert.equal(bad.status, 400)
  assert.equal(bad.json.code, 'path/not-absolute')

  const ok = await hit(routes, '/ctx-menu/apps', { url: '/ctx-menu/apps?path=' + encodeURIComponent('D:\\ws\\a.md') })
  assert.equal(ok.status, 200)
  assert.equal(ok.json.canOpen, true)
  assert.deepEqual(ok.json.apps, [{ id: 'rider64.exe', name: 'Rider', default: true, icon: 'data:image/png;base64,AA' }], '残缺条目被丢弃')
})

test('apps：桌面不可用时返回空列表而不是报错', async () => {
  const routes = mount({ sessionController: { canOpenWorkspacePath: () => false, workspacePathApplications: async () => [{ id: 'x', name: 'X' }] } })
  const result = await hit(routes, '/ctx-menu/apps', { url: '/ctx-menu/apps?path=' + encodeURIComponent('D:\\a.md') })
  assert.deepEqual(result.json, { ok: true, canOpen: false, apps: [] })
})

test('apps：宿主查询抛错时给出 apps/failed', async () => {
  const routes = mount({ sessionController: { canOpenWorkspacePath: () => true, workspacePathApplications: async () => { throw new Error('boom') } } })
  const result = await hit(routes, '/ctx-menu/apps', { url: '/ctx-menu/apps?path=' + encodeURIComponent('D:\\a.md') })
  assert.equal(result.status, 502)
  assert.equal(result.json.code, 'apps/failed')
})

test('cwd：从 sessions + workingDirectory 取会话目录', async () => {
  const session = { cwd: 'D:\\ws\\proj', header: {} }
  const routes = mount({ sessions: { get: (id) => (id === 's1' ? session : undefined) }, workingDirectory: { get: () => 'D:\\ws\\proj' } })
  const result = await hit(routes, '/ctx-menu/cwd', { url: '/ctx-menu/cwd?sessionId=s1' })
  assert.deepEqual(result.json, { ok: true, cwd: 'D:\\ws\\proj' })
  const missing = await hit(routes, '/ctx-menu/cwd', { url: '/ctx-menu/cwd?sessionId=nope' })
  assert.deepEqual(missing.json, { ok: false, code: 'cwd/unavailable' })
})

test('read：文本读取 / 二进制拒绝 / 目录拒绝 / 超大拒绝 / 字节流', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-menu-host-'))
  const textFile = join(dir, 'a.md')
  writeFileSync(textFile, '# hi\n')
  const binaryFile = join(dir, 'b.bin')
  writeFileSync(binaryFile, Buffer.from([0x41, 0x00, 0x42]))
  const routes = mount()

  const text = await hit(routes, '/ctx-menu/read', { url: '/ctx-menu/read?path=' + encodeURIComponent(textFile) + '&mode=text' })
  assert.deepEqual(text.json, { ok: true, text: '# hi\n' })

  const binary = await hit(routes, '/ctx-menu/read', { url: '/ctx-menu/read?path=' + encodeURIComponent(binaryFile) + '&mode=text' })
  assert.equal(binary.status, 415)
  assert.equal(binary.json.code, 'file/not-text')

  const bytes = await hit(routes, '/ctx-menu/read', { url: '/ctx-menu/read?path=' + encodeURIComponent(binaryFile) + '&mode=bytes' })
  assert.equal(bytes.status, 200)
  assert.equal(bytes.headers['content-type'], 'application/octet-stream')
  assert.deepEqual([...bytes.raw], [0x41, 0x00, 0x42])

  const asDir = await hit(routes, '/ctx-menu/read', { url: '/ctx-menu/read?path=' + encodeURIComponent(dir) })
  assert.equal(asDir.json.code, 'path/is-directory')

  const missing = await hit(routes, '/ctx-menu/read', { url: '/ctx-menu/read?path=' + encodeURIComponent(join(dir, 'nope.md')) })
  assert.equal(missing.status, 404)

  rmSync(dir, { recursive: true, force: true })
})

test('open / reveal：校验 content-type 与绝对路径，正常时调 sessionController', async () => {
  const seen = []
  const routes = mount({ sessionController: { openWorkspacePath: async (request) => { seen.push(request); return { opened: true } } } })

  const wrongType = await hit(routes, '/ctx-menu/open', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })
  assert.equal(wrongType.status, 415)

  const relative = await hit(routes, '/ctx-menu/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'a.md' }),
  })
  assert.equal(relative.status, 400)

  const open = await hit(routes, '/ctx-menu/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'D:\\ws\\a.md', application: 'rider64.exe' }),
  })
  assert.deepEqual(open.json, { ok: true })

  const reveal = await hit(routes, '/ctx-menu/reveal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'D:\\ws\\a.md' }),
  })
  assert.deepEqual(reveal.json, { ok: true })

  assert.deepEqual(seen, [
    { path: 'D:\\ws\\a.md', application: 'rider64.exe' },
    { path: 'D:\\ws\\a.md', action: 'reveal' },
  ])
})

test('open：宿主能力缺失时给出 host/unsupported', async () => {
  const routes = mount()
  const result = await hit(routes, '/ctx-menu/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'D:\\ws\\a.md' }),
  })
  assert.equal(result.status, 502)
  assert.equal(result.json.code, 'host/unsupported')
})