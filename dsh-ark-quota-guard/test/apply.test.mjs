import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, name } from '../index.js'

/** 极简假 Context：只实现插件用到的那几个面。 */
function makeCtx() {
  const listeners = new Map()
  const disposers = []
  const agents = new Map()

  const ctx = {
    on(event, handler) {
      listeners.set(event, handler)
      return () => listeners.delete(event)
    },
    effect(factory, label) {
      const dispose = factory()
      if (typeof dispose === 'function') disposers.push({ dispose, label })
      return dispose
    },
    get() {
      return undefined
    },
    agents: {
      get: (id) => agents.get(id),
      resume: async () => {
        throw new Error('测试里不该走重启恢复分支')
      },
    },
  }

  return {
    ctx,
    agents,
    listeners,
    emit: (event, payload) => listeners.get(event)(payload, async () => 'delegated'),
    disposeAll: () => {
      for (const { dispose } of disposers) dispose()
    },
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 生成「未来 seconds 秒」的方舟风格重置时刻文案。 */
function futureResetMessage(seconds) {
  const target = new Date(Date.now() + seconds * 1000)
  const pad = (value) => String(value).padStart(2, '0')
  const stamp =
    `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())} ` +
    `${pad(target.getUTCHours())}:${pad(target.getUTCMinutes())}:${pad(target.getUTCSeconds())} +0000`
  return `You have exceeded the weekly usage quota. It will reset at ${stamp}.`
}

test('导出契约：name / apply 存在', () => {
  assert.equal(name, 'ark-quota-guard')
  assert.equal(typeof apply, 'function')
})

test('非额度失败直接交给下游', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ark-guard-'))
  process.env.DSH_HOME = home
  const { ctx, emit, disposeAll } = makeCtx()
  try {
    apply(ctx, { resumeBufferMs: 0, minParkMs: 0 })
    const action = await emit('agent/request-error', {
      agent: { session: { id: 's1' }, followup() {} },
      provider: 'ark',
      failure: { code: 'SERVER', status: 500, message: 'boom' },
    })
    assert.equal(action, 'delegated')
  } finally {
    disposeAll()
    rmSync(home, { recursive: true, force: true })
  }
})

test('provider 不匹配时不接管', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ark-guard-'))
  process.env.DSH_HOME = home
  const { ctx, emit, disposeAll } = makeCtx()
  try {
    apply(ctx, { providerPattern: 'ark|volc', resumeBufferMs: 0, minParkMs: 0 })
    const action = await emit('agent/request-error', {
      agent: { session: { id: 's1' }, followup() {} },
      provider: 'openai',
      failure: { code: 'QUOTA', message: futureResetMessage(3600) },
    })
    assert.equal(action, 'delegated')
  } finally {
    disposeAll()
    rmSync(home, { recursive: true, force: true })
  }
})

test('额度耗尽 + 能解析出重置时间 → 挂起，到点自动 followup 续跑', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ark-guard-'))
  process.env.DSH_HOME = home
  const { ctx, agents, emit, disposeAll } = makeCtx()

  const calls = []
  agents.set('s1', {
    session: { id: 's1' },
    followup: (message) => calls.push(message),
  })

  try {
    apply(ctx, { providerPattern: 'ark', resumeBufferMs: 0, minParkMs: 0 })

    const action = await emit('agent/request-error', {
      agent: agents.get('s1'),
      provider: 'ark',
      failure: { code: 'QUOTA', status: 429, message: futureResetMessage(2) },
    })
    // 保持失败终态：返回 undefined（不调 next）→ 本轮结束
    assert.equal(action, undefined)
    assert.equal(calls.length, 0, '挂起时不该立刻续跑')

    // 等到重置时刻（约 2 秒）之后
    await sleep(2600)
    assert.equal(calls.length, 1, '到点应自动续跑一次')
    const message = calls[0]
    assert.equal(message.source.kind, 'ark-quota-guard')
    assert.equal(message.content[0].type, 'text')
    assert.ok(message.content[0].text.length > 0)
  } finally {
    disposeAll()
    rmSync(home, { recursive: true, force: true })
  }
})

test('同一会话重复失败只挂起一次', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ark-guard-'))
  process.env.DSH_HOME = home
  const { ctx, agents, emit, disposeAll } = makeCtx()
  agents.set('s1', { session: { id: 's1' }, followup() {} })

  try {
    apply(ctx, { providerPattern: 'ark', resumeBufferMs: 0, minParkMs: 0 })
    const payload = {
      agent: agents.get('s1'),
      provider: 'ark',
      failure: { code: 'QUOTA', status: 429, message: futureResetMessage(3600) },
    }
    assert.equal(await emit('agent/request-error', payload), undefined)
    // 第二次：已在队列里，保持终态但不重复排期
    assert.equal(await emit('agent/request-error', payload), undefined)
  } finally {
    disposeAll()
    rmSync(home, { recursive: true, force: true })
  }
})

test('卸载时清掉定时器，不会在 dispose 后再续跑', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ark-guard-'))
  process.env.DSH_HOME = home
  const { ctx, agents, emit, disposeAll } = makeCtx()

  const calls = []
  agents.set('s1', { session: { id: 's1' }, followup: (message) => calls.push(message) })

  try {
    apply(ctx, { providerPattern: 'ark', resumeBufferMs: 0, minParkMs: 0 })
    await emit('agent/request-error', {
      agent: agents.get('s1'),
      provider: 'ark',
      failure: { code: 'QUOTA', status: 429, message: futureResetMessage(2) },
    })
    disposeAll()
    await sleep(2600)
    assert.equal(calls.length, 0, 'dispose 后不该再续跑')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
