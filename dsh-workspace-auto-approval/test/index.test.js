import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../index.js'

class FakeAssembler {
  constructor() {
    this.finish = { kind: 'stop' }
    this.text = ''
  }
  push(chunk) {
    this.text += chunk.text || ''
  }
  blocks() {
    return [{ type: 'text', text: this.text }]
  }
}

function harness(answer = 'ALLOW', emitFinish = true, preset = 'workspace-auto-approval') {
  let listener
  let streamOptions
  const ctx = {
    permissionPresets: {
      current() {
        return preset
      },
    },
    loader: {
      async import() {
        return { BlockAssembler: FakeAssembler, createUserMessage: (message) => message }
      },
    },
    llm: {
      async resolveModelInfo() {
        return {
          reasoning: {
            defaultEffort: 'off',
            efforts: [
              { id: 'off', name: 'Off' },
              { id: 'low', name: 'Low' },
              { id: 'high', name: 'High' },
            ],
          },
        }
      },
      async *stream(options) {
        streamOptions = options
        yield { type: 'text-delta', text: answer }
        if (emitFinish) yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    effect(callback) {
      callback()
    },
    on(name, callback, options) {
      assert.equal(name, 'approval/request')
      assert.equal(options.prepend, true)
      listener = callback
      return () => true
    },
  }
  return { ctx, listener: () => listener, streamOptions: () => streamOptions }
}

function request(toolName, args, workspace = process.cwd(), config = { provider: 'test-provider', model: 'test-model' }) {
  const callId = 'call-1'
  const session = {
    header: { cwd: workspace },
    events: [{ type: 'tool/call', data: { callId, name: toolName, arguments: JSON.stringify(args) } }],
    id: 'session-1',
    requestHeader() {
      return {
        config,
        tools: [{
          name: toolName,
          description: `Definition for ${toolName}`,
          parameters: { type: 'object', properties: { value: { type: 'string' } } },
        }],
      }
    },
  }
  return { agent: { session, options: {} }, toolName, callId, reason: 'test escalation' }
}

test('does nothing while the ordinary workspace-write preset is selected', async () => {
  const mock = harness('ALLOW', true, 'workspace-write')
  await apply(mock.ctx)
  const req = request('write', { file_path: `${process.cwd()}/result.txt` })
  assert.equal(await mock.listener()(req, () => 'downstream'), 'downstream')
  assert.equal(mock.streamOptions(), undefined)
})

test('registers first and locally allows an in-workspace file request', async () => {
  const mock = harness()
  await apply(mock.ctx)
  const req = request('write', { file_path: `${process.cwd()}/result.txt` })
  assert.equal(await mock.listener()(req, () => 'next'), 'allowed-once')
  assert.equal(mock.streamOptions(), undefined)
})

test('leaves an explicit external write for the original answerer', async () => {
  const mock = harness()
  await apply(mock.ctx)
  const req = request('write', { file_path: process.platform === 'win32' ? 'C:\\outside.txt' : '/outside.txt' })
  let continued = false
  const result = await mock.listener()(req, () => {
    continued = true
    return 'human-result'
  })
  assert.equal(continued, true)
  assert.equal(result, 'human-result')
})

test('AI fallback sends reason, schema, arguments, and enables reasoning', async () => {
  const mock = harness('ALLOW')
  await apply(mock.ctx)
  const args = { command: 'pnpm test', workdir: process.cwd() }
  const req = request('pwsh', args)
  assert.equal(await mock.listener()(req, () => 'next'), 'allowed-once')
  const options = mock.streamOptions()
  assert.deepEqual(options.tools, [])
  assert.equal(options.maxTokens, 256)
  assert.equal(options.temperature, 0)
  assert.equal(options.reasoningEffort, 'low')
  assert.equal(options.messages.length, 1)
  assert.equal(options.provider, 'test-provider')
  assert.equal(options.model, 'test-model')
  const payload = JSON.parse(options.messages[0].content[0].text)
  assert.equal(payload.approvalReason, 'test escalation')
  assert.equal(payload.toolDefinition.name, 'pwsh')
  assert.equal(payload.toolDefinition.description, 'Definition for pwsh')
  assert.deepEqual(payload.toolDefinition.parameters, { type: 'object', properties: { value: { type: 'string' } } })
  assert.deepEqual(payload.arguments, args)
})

test('AI fallback preserves an enabled session reasoning effort', async () => {
  const mock = harness('ALLOW')
  await apply(mock.ctx)
  const req = request('pwsh', { command: 'pnpm test' }, process.cwd(), {
    provider: 'test-provider',
    model: 'test-model',
    reasoningEffort: 'high',
  })
  assert.equal(await mock.listener()(req, () => 'next'), 'allowed-once')
  assert.equal(mock.streamOptions().reasoningEffort, 'high')
})

test('unknown MCP tools use the AI path with their schema and arguments', async () => {
  const mock = harness('ALLOW')
  await apply(mock.ctx)
  const args = { value: 'README.md' }
  const req = request('mcp__docs__read', args)
  assert.equal(await mock.listener()(req, () => 'next'), 'allowed-once')
  const payload = JSON.parse(mock.streamOptions().messages[0].content[0].text)
  assert.equal(payload.toolDefinition.name, 'mcp__docs__read')
  assert.deepEqual(payload.arguments, args)
})

test('AI output without an explicit finish marker fails closed', async () => {
  const mock = harness('ALLOW', false)
  await apply(mock.ctx)
  const req = request('pwsh', { command: 'pnpm test', workdir: process.cwd() })
  assert.equal(await mock.listener()(req, () => 'human-result'), 'human-result')
})

test('AI fallback fails closed to the original answerer', async () => {
  const mock = harness('DENY')
  await apply(mock.ctx)
  const req = request('pwsh', { command: 'pnpm test', workdir: process.cwd() })
  assert.equal(await mock.listener()(req, () => 'human-result'), 'human-result')
})
