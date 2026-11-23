/**
 * Host route tests.
 *
 * Mounts the plugin against a fake Cordis context whose only services are
 * `connection` (route registration) and `effect` (cleanup), then drives the
 * exact Fetch routes the browser half calls.
 *
 * @module dsh-trajectory-edit/test/host
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildSession } from './fixture.mjs'

/** Session id used by every fixture. */
const SESSION_ID = 'session-test-0000'

/**
 * Mount the plugin and return its routes.
 * @param {string} dshHome - temp DSH home.
 * @returns {Promise<Record<string, any>>} route table keyed by path.
 */
async function mount(dshHome) {
  process.env.DSH_HOME = dshHome
  const routes = {}
  const ctx = {
    get: (name) => (name === 'connection'
      ? { fetch: { register: (route) => { routes[route.path] = route; return () => {} } } }
      : undefined),
    effect: (fn) => { fn() },
  }
  const host = await import('../index.js?test=' + Date.now())
  host.apply(ctx)
  return routes
}

/**
 * Create a temp DSH home holding one session log.
 * @returns {Promise<string>} the temp home.
 */
async function seededHome() {
  const home = await mkdtemp(join(tmpdir(), 'traj-edit-host-'))
  const dir = join(home, 'sessions', '--proj--', SESSION_ID)
  await mkdir(dir, { recursive: true })
  const { buffer } = await buildSession()
  await writeFile(join(dir, 'session.v4.jsonl.zstd'), buffer)
  return home
}

/**
 * POST JSON to one route.
 * @param {any} route - route definition.
 * @param {object} body - JSON body.
 * @returns {Promise<{status: number, payload: any}>} the response.
 */
async function post(route, body) {
  const response = await route.fetch(new Request('http://127.0.0.1/api/trajectory-edit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
  return { status: response.status, payload: await response.json() }
}

test('record route returns editable blocks', async () => {
  const home = await seededHome()
  try {
    const routes = await mount(home)
    const result = await post(routes['/api/trajectory-edit/record'], {
      sessionId: SESSION_ID,
      key: 'assistant%001%001',
    })
    assert.equal(result.status, 200)
    assert.equal(result.payload.ok, true)
    assert.deepEqual(result.payload.record.blocks.map((block) => block.type), ['reasoning', 'text'])
    assert.equal(result.payload.meta.busy, false)
    assert.equal(result.payload.meta.seq, 2)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('apply route is dry by default and writes with dryRun false', async () => {
  const home = await seededHome()
  try {
    const routes = await mount(home)
    const dry = await post(routes['/api/trajectory-edit/apply'], {
      sessionId: SESSION_ID,
      key: 'assistant%001%001',
      scope: 'record',
      dryRun: true,
    })
    assert.equal(dry.status, 200)
    assert.equal(dry.payload.dryRun, true)
    assert.equal(dry.payload.backup, null)
    assert.ok(dry.payload.bytesAfter <= dry.payload.bytesBefore)

    const applied = await post(routes['/api/trajectory-edit/apply'], {
      sessionId: SESSION_ID,
      key: 'assistant%001%001',
      scope: 'record',
    })
    assert.equal(applied.status, 200)
    assert.ok(typeof applied.payload.backup === 'string')
    assert.ok(applied.payload.report.removed > 0)

    const session = await post(routes['/api/trajectory-edit/record'], {
      sessionId: SESSION_ID,
      key: 'assistant%001%001',
    })
    assert.ok(session.payload.record.blocks[0].text.length < 100)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('restore route rolls the log back', async () => {
  const home = await seededHome()
  try {
    const routes = await mount(home)
    const applied = await post(routes['/api/trajectory-edit/apply'], {
      sessionId: SESSION_ID,
      key: 'assistant%001%001',
      scope: 'record',
    })
    const before = await post(routes['/api/trajectory-edit/record'], {
      sessionId: SESSION_ID,
      key: 'assistant%001%001',
    })
    const restored = await post(routes['/api/trajectory-edit/restore'], {
      sessionId: SESSION_ID,
      backup: applied.payload.backup,
    })
    assert.equal(restored.status, 200)
    const after = await post(routes['/api/trajectory-edit/record'], {
      sessionId: SESSION_ID,
      key: 'assistant%001%001',
    })
    assert.ok(after.payload.record.blocks[0].text.length > before.payload.record.blocks[0].text.length)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('rejects an invalid session id', async () => {
  const home = await seededHome()
  try {
    const routes = await mount(home)
    const result = await post(routes['/api/trajectory-edit/record'], {
      sessionId: '../../etc/passwd',
      key: 'assistant%001%001',
    })
    assert.equal(result.status, 400)
    assert.equal(result.payload.ok, false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('reports an unknown session', async () => {
  const home = await seededHome()
  try {
    const routes = await mount(home)
    const result = await post(routes['/api/trajectory-edit/record'], {
      sessionId: 'session-missing',
      key: 'assistant%001%001',
    })
    assert.equal(result.status, 404)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
