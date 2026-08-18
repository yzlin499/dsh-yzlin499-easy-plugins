import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { apply as applyPlugin } from '../index.js'
import {
  add,
  commit,
  diff,
  log,
  parseInfoXml,
  parseLogXml,
  parseStatusXml,
  resolveTarget,
  revert,
  runSvn,
  status,
} from '../svn.js'

const hasSvn = spawnSync('svn', ['--version', '--quiet'], { encoding: 'utf8' }).status === 0
const hasSvnAdmin = spawnSync('svnadmin', ['--version', '--quiet'], { encoding: 'utf8' }).status === 0

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

test('rejects paths outside the working-copy root', () => {
  const root = resolve('C:/work/wc')
  assert.equal(resolveTarget(root, 'src/file.txt'), resolve(root, 'src/file.txt'))
  assert.throws(() => resolveTarget(root, '../outside.txt'), /outside the SVN working copy/)
})

test('honors an already-cancelled SVN command signal', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(runSvn(process.cwd(), ['--version'], { signal: controller.signal }), (error) => error?.code === 'cancelled')
})

test('runs an SVN working-copy lifecycle', { skip: !(hasSvn && hasSvnAdmin), timeout: 30_000 }, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'dsh-svn-manager-test-'))
  const repo = join(fixture, 'repo')
  const wc = join(fixture, 'wc')
  try {
    run('svnadmin', ['create', repo], fixture)
    run('svn', ['checkout', pathToFileURL(repo).href, wc], fixture)
    await writeFile(join(wc, 'tracked.txt'), 'one\n', 'utf8')
    await add(wc, ['tracked.txt'])
    await commit(wc, 'initial')
    run('svn', ['update', wc], fixture)

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
    assert.equal(rows[0]?.message, 'initial')

    let route
    applyPlugin({
      sessions: { get: (id) => id === 'session-1' ? { header: { cwd: wc } } : undefined },
      webRuntime: { trustedHosts: [] },
      webServer: { register: (value) => { route = value; return () => {} } },
      effect: (install) => install(),
    })
    assert.ok(route)
    const invoke = async (host, method, body) => {
      const req = Readable.from([JSON.stringify(body)])
      req.method = 'POST'
      req.url = `/svn-manager/api/${method}`
      req.headers = { host, origin: `http://${host}`, 'content-type': 'application/json' }
      const response = { status: 0, body: '', writeHead(code) { this.status = code }, end(value) { this.body = String(value ?? '') } }
      await route.handler(req, response)
      return { status: response.status, body: JSON.parse(response.body) }
    }
    const routedStatus = await invoke('127.0.0.1:3080', 'status', { sessionId: 'session-1' })
    assert.equal(routedStatus.status, 200)
    assert.equal(routedStatus.body.value.info.isWorkingCopy, true)
    const rejected = await invoke('evil.example:3080', 'status', { sessionId: 'session-1' })
    assert.equal(rejected.status, 403)
    const confirmation = await invoke('127.0.0.1:3080', 'revert', { sessionId: 'session-1', paths: ['tracked.txt'] })
    assert.equal(confirmation.status, 400)
    assert.equal(confirmation.body.error.code, 'confirm-required')

    await revert(wc, ['tracked.txt', 'new @ file.txt'])
    snapshot = await status(wc)
    assert.equal(snapshot.entries.find((entry) => entry.path === 'tracked.txt'), undefined)
    assert.equal(snapshot.entries.find((entry) => entry.path === 'new @ file.txt')?.item, 'unversioned')
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})
