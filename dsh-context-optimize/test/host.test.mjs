import { test } from 'node:test'
import assert from 'node:assert/strict'

import { apply } from '../index.js'

/**
 * Host 半侧：把 compaction/summary 事件记成折叠账本，并通过
 * GET /context-optimize/outline 暴露给侧边栏。
 */

function makeCtx() {
  const listeners = new Map()
  let route
  const ctx = {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(handler)
      return () => {}
    },
    effect(fn) { return fn() },
    logger: { warn() {}, info() {} },
    get(name) {
      if (name !== 'webServer') return undefined
      return { register(spec) { route = spec; return () => {} } }
    },
    _fire(event, ...args) {
      for (const handler of listeners.get(event) ?? []) handler(...args)
    },
    get _route() { return route },
  }
  return ctx
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(key, value) { this.headers[key] = value },
    end(chunk) { this.body = chunk ?? '' },
  }
  return res
}

test('apply 注册 /context-optimize/outline 路由', () => {
  const ctx = makeCtx()
  apply(ctx)
  assert.equal(ctx._route.path, '/context-optimize')
  assert.equal(ctx._route.kind, 'prefix')
})

test('compaction/summary 事件进账本，接口按会话汇总', () => {
  const ctx = makeCtx()
  apply(ctx)
  ctx._fire('session/event', { id: 's1' }, {
    type: 'compaction/summary',
    time: 1795858988000,
    data: { shadowedTokenCount: 48213, shadowedSeqs: [1, 2, 3], shadowedRange: { start: 1, end: 3 } },
  })
  ctx._fire('session/event', { id: 's1' }, {
    type: 'compaction/summary',
    time: 1795859988000,
    data: { shadowedTokenCount: 8000, shadowedSeqs: [4, 5] },
  })
  // 其它会话互不影响
  ctx._fire('session/event', { id: 's2' }, {
    type: 'compaction/summary',
    data: { shadowedTokenCount: 100, shadowedSeqs: [9] },
  })
  // 非压缩事件被忽略
  ctx._fire('session/event', { id: 's1' }, { type: 'tool/result' })

  const res = makeRes()
  ctx._route.handler({ url: '/context-optimize/outline?session=s1', method: 'GET' }, res)
  const body = JSON.parse(res.body)
  assert.equal(body.folded, 2)
  assert.equal(body.tokens, 56213)
  assert.equal(body.nodes, 5)
  assert.deepEqual(body.entries[0], { tokens: 48213, nodes: 3, start: 1, end: 3, at: 1795858988000 })

  const other = makeRes()
  ctx._route.handler({ url: '/context-optimize/outline?session=s2', method: 'GET' }, other)
  assert.equal(JSON.parse(other.body).folded, 1)

  const empty = makeRes()
  ctx._route.handler({ url: '/context-optimize/outline?session=unknown', method: 'GET' }, empty)
  const emptyBody = JSON.parse(empty.body)
  assert.equal(emptyBody.folded, 0)
  assert.equal(emptyBody.tokens, 0)
})

test('未知路径 404；webServer 缺失时安静降级', () => {
  const ctx = makeCtx()
  apply(ctx)
  const res = makeRes()
  ctx._route.handler({ url: '/context-optimize/nope', method: 'GET' }, res)
  assert.equal(res.statusCode, 404)

  const bare = { on() { return () => {} }, effect(fn) { return fn() }, logger: { warn() {} }, get: () => undefined }
  assert.doesNotThrow(() => apply(bare))
})
