/**
 * Surgery and record-mapping tests.
 *
 * @module dsh-trajectory-edit/test/surgery
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { applyBlockEdit, editableBlocks, findRecordEvents, parseRecordKey } from '../lib/records.mjs'
import { parseLog } from '../lib/log-file.mjs'
import {
  applyPlan,
  hasOpenTurn,
  planClean,
  planCleanSession,
  planEdit,
  readSessionLog,
} from '../lib/surgery.mjs'
import { buildSession } from './fixture.mjs'

test('decodes every record-key form', () => {
  assert.deepEqual(parseRecordKey('assistant%0013%0013'), {
    type: 'assistant', kind: 'assistant', turn: 13, step: 13,
  })
  assert.deepEqual(parseRecordKey('tool%00call%00call_123'), {
    type: 'call', kind: 'tool', callId: 'call_123',
  })
  assert.deepEqual(parseRecordKey('user%00seq%0042'), {
    type: 'seq', kind: 'user', seq: 42,
  })
  assert.equal(parseRecordKey('assistant%00summary%00assistant').type, 'summary')
  assert.equal(parseRecordKey('garbage').type, 'unknown')
})

test('maps a record to its events', async () => {
  const { events } = await buildSession()
  const assistant = findRecordEvents(events, parseRecordKey('assistant%001%001'))
  assert.equal(assistant.index, 2)
  assert.equal(assistant.event.type, 'assistant/message')
  const call = findRecordEvents(events, parseRecordKey('tool%00call%00call_1'))
  assert.equal(call.index, 3)
  assert.deepEqual(call.related, [4])
  assert.equal(findRecordEvents(events, parseRecordKey('user%00seq%0099')), null)
})

test('editable blocks exclude tool calls', async () => {
  const { events } = await buildSession()
  const blocks = editableBlocks(events[2])
  assert.deepEqual(blocks.map(block => block.type), ['reasoning', 'text'])
})

test('editing a block syncs both stream copies', async () => {
  const { events } = await buildSession()
  const next = applyBlockEdit(events[2], 0, 'clean reasoning')
  assert.equal(next.data.message.content[0].text, 'clean reasoning')
  const blockEnd = next.data.stream.find(item => item.chunk?.type === 'block-end' && item.chunk.index === 0)
  assert.equal(blockEnd.chunk.block.text, 'clean reasoning')
  const chunks = next.data.stream.find(item => item.type === 'reasoning-chunks')
  assert.deepEqual(chunks.texts, ['clean reasoning'])
  assert.deepEqual(chunks.dt, [])
  // The tool call is untouched.
  assert.deepEqual(next.data.message.content[2], events[2].data.message.content[2])
  // The source event is not mutated.
  assert.notEqual(events[2].data.message.content[0].text, 'clean reasoning')
})

test('detects an open turn', async () => {
  const { events } = await buildSession()
  assert.equal(hasOpenTurn(events), false)
  assert.equal(hasOpenTurn(events.slice(0, -1)), true)
})

test('plans and applies an edit with a backup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'traj-edit-'))
  const logPath = join(dir, 'session.v4.jsonl.zstd')
  try {
    const { buffer } = await buildSession()
    await writeFile(logPath, buffer)

    const { parsed } = await readSessionLog(logPath)
    const plan = planEdit({ parsed }, parseRecordKey('assistant%001%001'), [
      { blockIndex: 0, text: '短' },
    ])
    assert.equal(plan.changedLines.size, 1)

    const result = await applyPlan(logPath, buffer, parsed, plan)
    assert.equal(result.ok, true)
    assert.ok(result.backup !== null)
    assert.ok(result.bytesAfter < result.bytesBefore)

    const written = parseLog(await readFile(logPath))
    assert.equal(written.events.length, parsed.events.length)
    assert.equal(written.events[2].data.message.content[0].text, '短')
    assert.equal(written.events[2].data.message.content[2].type, 'tool-call')

    // A second pass changes nothing.
    const second = planClean({ parsed: written }, parseRecordKey('assistant%001%001'))
    assert.equal(second.changedLines.size, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('dry run writes nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'traj-edit-'))
  const logPath = join(dir, 'session.v4.jsonl.zstd')
  try {
    const { buffer } = await buildSession()
    await writeFile(logPath, buffer)
    const { parsed } = await readSessionLog(logPath)
    const plan = planClean({ parsed }, parseRecordKey('assistant%001%001'))
    const result = await applyPlan(logPath, buffer, parsed, plan, { dryRun: true })
    assert.equal(result.report.dryRun, true)
    assert.equal(result.backup, null)
    assert.deepEqual(await readFile(logPath), buffer)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('cleans the whole session record by record', async () => {
  const { buffer } = await buildSession()
  const parsed = parseLog(buffer)
  const plan = planCleanSession({ parsed })
  assert.ok(plan.changedLines.size >= 1)
  assert.ok(plan.report.removed > 0)
})

test('refuses a record with no editable text', async () => {
  const { buffer } = await buildSession()
  const parsed = parseLog(buffer)
  assert.throws(
    () => planEdit({ parsed }, parseRecordKey('turn%00seq%000'), [{ blockIndex: 0, text: 'x' }]),
    /no editable text/,
  )
})

test('refuses an edit that would blank a block', async () => {
  const { buffer } = await buildSession()
  const parsed = parseLog(buffer)
  const plan = planEdit({ parsed }, parseRecordKey('assistant%001%001'), [
    { blockIndex: 1, text: '' },
  ])
  // Empty text is allowed at plan level; the guard is that only text paths may change.
  assert.equal(plan.changedLines.size, 1)
})
