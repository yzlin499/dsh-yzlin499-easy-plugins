import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, appendFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { apply as applyPlugin } from '../index.js'
import * as git from '../git.js'
import {
  add,
  commit,
  compactStatusEntries,
  diff,
  log,
  parseInfoXml,
  parseLogXml,
  parseStatusXml,
  resolveTarget,
  revert,
  runSvn,
  status,
  toLinuxPath,
  toWindowsPath,
} from '../svn.js'

const hasSvn = spawnSync('svn', ['--version', '--quiet'], { encoding: 'utf8' }).status === 0
const hasSvnAdmin = spawnSync('svnadmin', ['--version', '--quiet'], { encoding: 'utf8' }).status === 0
const hasGit = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stderr}`)
  return result.stdout
}

test('parses SVN status, info, and log XML', () => {
  const root = resolve('C:/work/wc')
  const statusXml = `<?xml version="1.0"?><status><target path="${root}"><entry path="${root}/a &amp; b.txt"><wc-status item="modified" props="modified" revision="7" tree-conflicted="true"><commit revision="6"><author>A &amp; B</author><date>2026-01-01T00:00:00Z</date></commit></wc-status></entry></target></status>`
  assert.deepEqual(parseStatusXml(statusXml, root), [{
    path: 'a & b.txt', item: 'modified', props: 'modified', revision: '7', copied: false,
    switched: false, locked: false, treeConflicted: true, commitRevision: '6', author: 'A & B', date: '2026-01-01T00:00:00Z',
  }])

  const info = parseInfoXml('<?xml version="1.0"?><info><entry path="." revision="8"><url>https://user:secret@example.test/svn/trunk</url><relative-url>^/trunk</relative-url><repository><root>https://user:secret@example.test/svn</root><uuid>abc</uuid></repository><wc-info><wcroot-abspath>C:/work/wc</wcroot-abspath><depth>infinity</depth></wc-info></entry></info>')
  assert.equal(info.url, 'https://***@example.test/svn/trunk')
  assert.equal(info.repositoryRoot, 'https://***@example.test/svn')
  assert.equal(info.wcRoot, 'C:/work/wc')

  assert.deepEqual(parseLogXml('<?xml version="1.0"?><log><logentry revision="9"><author>Me</author><date>2026-01-02T00:00:00Z</date><msg>Fix &lt;x&gt;</msg></logentry></log>'), [
    { revision: '9', author: 'Me', date: '2026-01-02T00:00:00Z', message: 'Fix <x>' },
  ])
})

test('prioritizes versioned changes when a large status is compacted', () => {
  const entries = [
    ...Array.from({ length: 8 }, (_, index) => ({ path: `unversioned-${index}`, item: 'unversioned' })),
    { path: 'modified.txt', item: 'modified' },
    { path: 'conflicted.txt', item: 'conflicted' },
  ]
  const compacted = compactStatusEntries(entries, 5)
  assert.deepEqual(compacted.entries.map((entry) => entry.path), [
    'modified.txt', 'conflicted.txt', 'unversioned-0', 'unversioned-1', 'unversioned-2',
  ])
  assert.equal(compacted.truncated, true)
  assert.equal(compacted.totalEntries, 10)
  assert.equal(compacted.shownEntries, 5)
  assert.equal(compacted.omittedImportant, 0)
  assert.equal(compacted.omittedUnversioned, 5)
})

test('rejects paths outside the working-copy root', () => {
  const root = resolve('C:/work/wc')
  assert.equal(resolveTarget(root, 'src/file.txt'), resolve(root, 'src/file.txt'))
  assert.throws(() => resolveTarget(root, '../outside.txt'), /outside the SVN working copy/)
})

test('converts paths between WSL and Windows', () => {
  // /mnt/<drive> mounts
  assert.equal(toWindowsPath('/mnt/d/Users/a b.txt'), 'D:\\Users\\a b.txt')
  assert.equal(toWindowsPath('/mnt/c/Program Files/TortoiseSVN/bin/svn.exe'), 'C:\\Program Files\\TortoiseSVN\\bin\\svn.exe')
  assert.equal(toWindowsPath('/mnt/d'), 'D:\\')
  // distro-internal paths（发行版名取 WSL_DISTRO_NAME）
  const distro = process.env.WSL_DISTRO_NAME || 'WSL'
  assert.equal(toWindowsPath('/home/user/wc'), `\\\\wsl$\\${distro}\\home\\user\\wc`)
  // already Windows
  assert.equal(toWindowsPath('C:\\dev'), 'C:\\dev')
  // back
  assert.equal(toLinuxPath('D:\\Users\\a b.txt'), '/mnt/d/Users/a b.txt')
  assert.equal(toLinuxPath('C:/work/wc/nested'), '/mnt/c/work/wc/nested')
  assert.equal(toLinuxPath(`\\\\wsl$\\${distro}\\home\\user\\wc`), '/home/user/wc')
  // round-trip
  assert.equal(toLinuxPath(toWindowsPath('/mnt/d/a/b')), '/mnt/d/a/b')
})

test('honors an already-cancelled SVN command signal', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(runSvn(process.cwd(), ['--version'], { signal: controller.signal }), (error) => error?.code === 'cancelled')
})

test('runs an SVN working-copy lifecycle', { skip: !(hasSvn && hasSvnAdmin), timeout: 30_000 }, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'dsh-version-control-test-'))
  const repo = join(fixture, 'repo')
  const wc = join(fixture, 'wc')
  try {
    run('svnadmin', ['create', repo], fixture)
    run('svn', ['checkout', pathToFileURL(repo).href, wc], fixture)
    await writeFile(join(wc, 'tracked.txt'), 'one\n', 'utf8')
    await add(wc, ['tracked.txt'])
    await commit(wc, 'initial')
    run('svn', ['update', wc], fixture)

    const nested = join(wc, 'nested')
    const sibling = join(wc, 'sibling')
    await mkdir(nested)
    await mkdir(sibling)
    await writeFile(join(nested, 'scoped.txt'), 'nested\n', 'utf8')
    await writeFile(join(sibling, 'outside.txt'), 'outside\n', 'utf8')
    await add(wc, ['nested/scoped.txt', 'sibling/outside.txt'])
    await commit(wc, 'scope fixtures')
    run('svn', ['update', wc], fixture)
    await appendFile(join(nested, 'scoped.txt'), 'changed\n', 'utf8')
    await appendFile(join(sibling, 'outside.txt'), 'changed\n', 'utf8')
    const scopedSnapshot = await status(nested)
    assert.equal(scopedSnapshot.entries.some((entry) => entry.path === 'nested/scoped.txt'), true)
    assert.equal(scopedSnapshot.entries.some((entry) => entry.path === 'sibling/outside.txt'), false)
    await commit(nested, 'nested only')
    const rootAfterScopedCommit = await status(wc)
    assert.equal(rootAfterScopedCommit.entries.some((entry) => entry.path === 'nested/scoped.txt'), false)
    assert.equal(rootAfterScopedCommit.entries.some((entry) => entry.path === 'sibling/outside.txt'), true)
    await revert(wc, ['sibling/outside.txt'])

    await appendFile(join(wc, 'tracked.txt'), 'two\n', 'utf8')
    await writeFile(join(wc, 'new @ file.txt'), 'new\n', 'utf8')
    let snapshot = await status(wc)
    assert.equal(snapshot.info.isWorkingCopy, true)
    assert.equal(snapshot.entries.find((entry) => entry.path === 'tracked.txt')?.item, 'modified')
    assert.equal(snapshot.entries.find((entry) => entry.path === 'new @ file.txt')?.item, 'unversioned')

    await add(wc, ['new @ file.txt'])
    snapshot = await status(wc)
    assert.equal(snapshot.entries.find((entry) => entry.path === 'new @ file.txt')?.item, 'added')

    const patch = await diff(wc, {})
    assert.match(patch.diff, /diff --git/)
    assert.match(patch.diff, /new @ file\.txt/)
    assert.match(patch.diff, /\+two/)

    const rows = await log(wc, { limit: 10 })
    assert.equal(rows.some((entry) => entry.message === 'initial'), true)

    let routes = []
    applyPlugin({
      sessions: { get: (id) => id === 'session-1' ? { header: { cwd: wc } } : undefined },
      webRuntime: { trustedHosts: [] },
      webServer: { register: (value) => { routes.push(value); return () => {} } },
      effect: (install) => install(),
    })
    assert.ok(routes.length >= 2)
    const invoke = async (path, host, method, body) => {
      const route = routes.find((entry) => path.startsWith(entry.path))
      assert.ok(route, `no route for ${path}`)
      const req = Readable.from([JSON.stringify(body ?? {})])
      req.method = method
      req.url = path
      req.headers = { host, origin: `http://${host}`, 'content-type': 'application/json' }
      const response = { status: 0, body: '', writeHead(code) { this.status = code }, end(value) { this.body = String(value ?? '') } }
      await route.handler(req, response)
      return { status: response.status, body: response.body ? JSON.parse(response.body) : null }
    }
    const routedStatus = await invoke('/version-control/api/status', '127.0.0.1:3080', 'POST', { sessionId: 'session-1' })
    assert.equal(routedStatus.status, 200)
    assert.equal(routedStatus.body.value.info.isWorkingCopy, true)
    const rejected = await invoke('/version-control/api/status', 'evil.example:3080', 'POST', { sessionId: 'session-1' })
    assert.equal(rejected.status, 403)
    const confirmation = await invoke('/version-control/api/revert', '127.0.0.1:3080', 'POST', { sessionId: 'session-1', paths: ['tracked.txt'] })
    assert.equal(confirmation.status, 400)
    assert.equal(confirmation.body.error.code, 'confirm-required')

    // 配置路由：GET 返回当前值与检测结果；POST 保存 svnExecutable
    const configRead = await invoke('/version-control/config', '127.0.0.1:3080', 'GET')
    assert.equal(configRead.status, 200)
    assert.equal(configRead.body.ok, true)
    assert.equal(typeof configRead.body.svnExecutable, 'string')
    assert.equal(typeof configRead.body.platform, 'string')
    const configWrite = await invoke('/version-control/config', '127.0.0.1:3080', 'POST', { svnExecutable: 'svn.exe' })
    assert.equal(configWrite.status, 200)
    assert.equal(configWrite.body.ok, true)
    assert.equal(configWrite.body.svnExecutable, 'svn.exe')
    const configReadBack = await invoke('/version-control/config', '127.0.0.1:3080', 'GET')
    assert.equal(configReadBack.body.svnExecutable, 'svn.exe')
    // 恢复默认，避免影响后续环境无关断言
    await invoke('/version-control/config', '127.0.0.1:3080', 'POST', { svnExecutable: '' })

    await revert(wc, ['tracked.txt', 'new @ file.txt'])
    snapshot = await status(wc)
    assert.equal(snapshot.entries.find((entry) => entry.path === 'tracked.txt'), undefined)
    assert.equal(snapshot.entries.find((entry) => entry.path === 'new @ file.txt')?.item, 'unversioned')
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('runs a Git working-tree lifecycle', { skip: !hasGit, timeout: 30_000 }, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'dsh-version-control-git-test-'))
  try {
    run('git', ['init'], fixture)
    run('git', ['config', 'user.email', 'test@example.com'], fixture)
    run('git', ['config', 'user.name', 'Version Control Test'], fixture)
    await writeFile(join(fixture, 'tracked.txt'), 'one\n', 'utf8')
    await git.add(fixture, ['tracked.txt'])
    await git.commit(fixture, 'initial')
    await appendFile(join(fixture, 'tracked.txt'), 'two\n', 'utf8')
    await writeFile(join(fixture, 'new.txt'), 'new\n', 'utf8')

    const snapshot = await git.status(fixture)
    assert.equal(snapshot.info.isWorkingCopy, true)
    assert.equal(typeof snapshot.info.branch, 'string')
    assert.equal(snapshot.entries.find((entry) => entry.path === 'tracked.txt')?.item, 'modified')
    assert.equal(snapshot.entries.find((entry) => entry.path === 'new.txt')?.item, 'unversioned')

    const patch = await git.diff(fixture, {})
    assert.match(patch.diff, /tracked\.txt/)
    assert.match(patch.diff, /\+two/)
    const rows = await git.log(fixture, { limit: 10 })
    assert.equal(rows.some((entry) => entry.message === 'initial'), true)

    await git.commit(fixture, 'second')
    assert.deepEqual((await git.status(fixture)).entries, [])
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})
