// 宿主半侧路由测试：直接 import index.js，用假 ctx 抓路由，再喂假 req/res。
// 这是 0.2.1 迁移的核心——路由的鉴权、入参校验、大小上限、错误码都在这里定型。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, name, inject, internals } from '../index.js'

// 单测里绝不真的起进程 / 读注册表：默认全注入为假实现，需要时按用例替换
const spawnCalls = []
internals.spawn = (command, args, options) => {
  spawnCalls.push({ command, args, options })
  return { on() {}, stdout: { on() {} }, stderr: { on() {} }, kill() {}, unref() {} }
}
internals.readRegistry = async () => null
internals.clearAppCache()

function resetHostInternals({ registry } = {}) {
  spawnCalls.length = 0
  internals.readRegistry = registry === undefined ? async () => null : registry
  internals.clearAppCache()
}

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
  assert.deepEqual(open.json, { ok: true, source: 'host' })

  const reveal = await hit(routes, '/ctx-menu/reveal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'D:\\ws\\a.md' }),
  })
  assert.deepEqual(reveal.json, { ok: true, source: 'host' })

  assert.deepEqual(seen, [
    { path: 'D:\\ws\\a.md', application: 'rider64.exe' },
    { path: 'D:\\ws\\a.md', action: 'reveal' },
  ])
})

// ── 跨工作区兜底（注册表枚举 / 自己启动） ──────────────────────────────────

test('parseCommandExe：从 shell 命令串里取出 exe（带引号 / 不带引号 / 无 exe）', () => {
  assert.equal(internals.parseCommandExe('"C:\\Program Files\\Microsoft VS Code\\Code.exe" "%1"'), 'C:\\Program Files\\Microsoft VS Code\\Code.exe')
  assert.equal(internals.parseCommandExe('C:\\tools\\app.exe %1'), 'C:\\tools\\app.exe')
  assert.equal(internals.parseCommandExe('rundll32.exe shell32.dll'), 'rundll32.exe')
  assert.equal(internals.parseCommandExe(''), null)
  assert.equal(internals.parseCommandExe(null), null)
})

test('extOf / appId 编解码', () => {
  assert.equal(internals.extOf('D:\\ws\\a.H'), '.h')
  assert.equal(internals.extOf('D:\\ws\\noext'), null)
  assert.equal(internals.extOf('D:\\ws\\a.'), null)
  assert.equal(internals.encodeAppId('C:\\a\\b.exe'), 'exe:C:\\a\\b.exe')
  assert.equal(internals.decodeAppId('exe:C:\\a\\b.exe'), 'C:\\a\\b.exe')
  assert.equal(internals.decodeAppId('rider'), null, '非 exe: 前缀的 id 不认')
})

test('toNativePath：混用分隔符归一成原生（实测 I:\\...\\YunLiu\\Source/JXHan/...）', () => {
  assert.equal(
    internals.toNativePath('I:\\Jx3YL\\Product\\Client\\YunLiu\\Source/JXHan/Public/AVGASDialog.h'),
    'I:\\Jx3YL\\Product\\Client\\YunLiu\\Source\\JXHan\\Public\\AVGASDialog.h',
  )
  assert.equal(internals.toNativePath('/home/me/a\\b/c.ts'), '/home/me/a/b/c.ts', 'POSIX 反过来归一成 /')
  assert.equal(internals.toNativePath(''), '')
})

test('apps / open：混用分隔符的路径先归一化，再交给官方服务', async () => {
  resetHostInternals()
  const seen = []
  const routes = mount({
    sessionController: {
      canOpenWorkspacePath: () => true,
      workspacePathApplications: async (request) => {
        seen.push(['apps', request.path])
        return [{ id: 'x', name: 'X', default: true, icon: null }]
      },
      openWorkspacePath: async (request) => {
        seen.push(['open', request.path])
        return { opened: true }
      },
    },
  })
  const mixed = 'I:\\Jx3YL\\YunLiu\\Source/JXHan/Public/AVGASDialog.h'
  const native = 'I:\\Jx3YL\\YunLiu\\Source\\JXHan\\Public\\AVGASDialog.h'
  await hit(routes, '/ctx-menu/apps', { url: '/ctx-menu/apps?path=' + encodeURIComponent(mixed) })
  await hit(routes, '/ctx-menu/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: mixed }),
  })
  assert.deepEqual(seen, [['apps', native], ['open', native]])
  resetHostInternals()
})

test('displayNameFor：版本信息优先、去掉尾部括注、最后回退 exe 主干', () => {
  const exe = 'C:\\Program Files\\JetBrains\\rider64.exe'
  assert.equal(internals.displayNameFor({ fileDesc: 'JetBrains Rider (GUI launcher)' }, exe), 'JetBrains Rider')
  assert.equal(internals.displayNameFor({ fileDesc: 'Visual Studio Code', product: 'other' }, exe), 'Visual Studio Code')
  assert.equal(internals.displayNameFor({ product: 'JetBrains Rider' }, exe), 'JetBrains Rider')
  assert.equal(internals.displayNameFor({ friendly: 'Rider' }, exe), 'Rider')
  assert.equal(internals.displayNameFor({}, exe), 'rider64', '什么都没有就用 exe 主干')
  assert.equal(internals.displayNameFor({ fileDesc: '   ' }, exe), 'rider64', '空白串不算名字')
})

test('normalizeRegistryResult：去重、跳过非绝对 exe、默认应用按 UserChoice 标记', () => {
  const result = internals.normalizeRegistryResult({
    default: 'VSCode.h',
    items: [
      { progId: 'VSCode.h', command: '"C:\\Program Files\\Microsoft VS Code\\Code.exe" "%1"', name: null },
      { progId: 'Rider.h', command: '"C:\\Program Files\\JetBrains\\rider64.exe" "%1"', name: 'JetBrains Rider' },
      { progId: 'Dup.h', command: '"C:\\Program Files\\Microsoft VS Code\\Code.exe" "%1"', name: 'duplicate' },
      { progId: 'Bare.h', exe: 'code.exe' },
    ],
  })
  assert.deepEqual(result.apps.map((app) => app.name), ['Code', 'JetBrains Rider'], '同 exe 去重、裸 exe 名被跳过、无名时回退 exe 主干')
  assert.equal(result.apps[0].default, true, 'UserChoice 指向的那条标默认')
  assert.equal(result.apps[1].default, false)
})

test('apps：官方返回空时回退注册表枚举，并标 source=registry', async () => {
  resetHostInternals({
    registry: async () => ({
      default: 'VSCode.h',
      items: [
        { progId: 'VSCode.h', command: '"C:\\Program Files\\Microsoft VS Code\\Code.exe" "%1"' },
        { progId: 'Rider.h', command: '"C:\\Program Files\\JetBrains\\Rider\\rider64.exe" "%1"', name: 'JetBrains Rider' },
      ],
    }),
  })
  const routes = mount({ sessionController: { canOpenWorkspacePath: () => true, workspacePathApplications: async () => [] } })
  const result = await hit(routes, '/ctx-menu/apps', { url: '/ctx-menu/apps?path=' + encodeURIComponent('I:\\Jx3YL\\a.h') })
  assert.equal(result.status, 200)
  assert.equal(result.json.source, 'registry')
  assert.equal(result.json.apps.length, 2)
  assert.equal(result.json.apps[0].default, true)
  resetHostInternals()
})

test('apps：枚举结果有 60s 缓存，不重复起进程', async () => {
  let reads = 0
  resetHostInternals({
    registry: async () => {
      reads += 1
      return { default: null, items: [{ progId: 'A.h', command: '"C:\\a\\a.exe" "%1"' }] }
    },
  })
  const routes = mount({ sessionController: { canOpenWorkspacePath: () => true, workspacePathApplications: async () => [] } })
  const url = '/ctx-menu/apps?path=' + encodeURIComponent('I:\\x\\a.h')
  await hit(routes, '/ctx-menu/apps', { url })
  await hit(routes, '/ctx-menu/apps', { url })
  assert.equal(reads, 1)
  resetHostInternals()
})

test('open：官方失败时自己启动，但只允许枚举里出现过的 exe', async () => {
  const realExe = process.execPath // 真实存在的可执行文件（否则 existsSync 会拒）
  resetHostInternals({
    registry: async () => ({ default: null, items: [{ progId: 'Rider.h', command: `"${realExe}" "%1"` }] }),
  })
  const routes = mount({ sessionController: { openWorkspacePath: async () => { throw new Error('gateway/denied') } } })

  // 枚举里没有它 → 拒绝，返回官方错误
  const rejected = await hit(routes, '/ctx-menu/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'I:\\Jx3YL\\a.h', application: 'exe:C:\\evil\\evil.exe' }),
  })
  assert.equal(rejected.status, 502)
  assert.equal(spawnCalls.length, 0, '未列入枚举的可执行文件绝不启动')

  // 枚举里有 → 启动它
  const ok = await hit(routes, '/ctx-menu/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'I:\\Jx3YL\\a.h', application: internals.encodeAppId(realExe) }),
  })
  assert.equal(ok.status, 200)
  assert.equal(ok.json.source, 'registry')
  assert.equal(spawnCalls.at(-1).command, realExe)
  assert.deepEqual(spawnCalls.at(-1).args, ['I:\\Jx3YL\\a.h'])
  resetHostInternals()
})

test('open：没有指定应用且官方失败 → 用资源管理器走系统默认', async () => {
  resetHostInternals()
  const routes = mount({ sessionController: { openWorkspacePath: async () => { throw new Error('gateway/denied') } } })
  const result = await hit(routes, '/ctx-menu/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'I:\\Jx3YL\\a.h' }),
  })
  assert.equal(result.status, 200)
  assert.equal(spawnCalls.at(-1).command, 'explorer.exe')
  resetHostInternals()
})

test('reveal：官方失败时用 explorer /select, 兜底', async () => {
  resetHostInternals()
  const routes = mount({ sessionController: { openWorkspacePath: async () => { throw new Error('gateway/denied') } } })
  const result = await hit(routes, '/ctx-menu/reveal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'I:\\Jx3YL\\a.h' }),
  })
  assert.equal(result.status, 200)
  assert.equal(spawnCalls.at(-1).command, 'explorer.exe')
  assert.deepEqual(spawnCalls.at(-1).args, ['/select,', 'I:\\Jx3YL\\a.h'])
  resetHostInternals()
})