/**
 * Log-file codec tests.
 *
 * @module dsh-trajectory-edit/test/log-file
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { parseLog, serializeLog } from '../lib/log-file.mjs'
import { buildLog, buildSession, HEADER } from './fixture.mjs'

test('round-trips a session log', async () => {
  const { buffer } = await buildSession()
  const parsed = parseLog(buffer)
  assert.equal(parsed.lines.length, 7) // header + 6 events
  assert.equal(parsed.events.length, 6)
  assert.deepEqual(parsed.lineFrame, [0, 1, 2, 3, 4, 5, 6])
  assert.equal(parsed.header.id, HEADER.id)
})

test('rejects a torn tail', async () => {
  const { buffer } = await buildSession()
  const torn = Buffer.concat([buffer, Buffer.from([0x28, 0xb5, 0x2f])])
  assert.throws(() => parseLog(torn), /torn/i)
})

test('rejects a non-header first frame', async () => {
  const buffer = await buildLog([], { ...HEADER })
  const parsed = parseLog(buffer)
  assert.equal(parsed.events.length, 0)
})

test('rejects a seq gap', async () => {
  const { events } = await buildSession()
  const broken = events.map(event => ({ ...event }))
  broken[3] = { ...broken[3], seq: 9 }
  const buffer = await buildLog(broken)
  assert.throws(() => parseLog(buffer), /seq/i)
})

test('re-encodes only changed frames', async () => {
  const { buffer } = await buildSession()
  const parsed = parseLog(buffer)
  const lines = [...parsed.lines]
  lines[2] = lines[2].replace('结论。', '新结论。')
  const next = await serializeLog(buffer, { ...parsed, lines }, new Set([2]))
  const reparsed = parseLog(next)
  assert.equal(reparsed.lines.length, parsed.lines.length)
  assert.equal(reparsed.lines[2], lines[2])
  for (const index of [0, 1, 3, 4, 5, 6]) {
    assert.equal(reparsed.lines[index], parsed.lines[index])
  }
  // Untouched frames keep their original bytes.
  assert.deepEqual(
    next.subarray(parsed.frames[0].start, parsed.frames[0].end),
    buffer.subarray(parsed.frames[0].start, parsed.frames[0].end),
  )
})

test('keeps the first frame a single header line', async () => {
  const { buffer } = await buildSession()
  const parsed = parseLog(buffer)
  const header = Buffer.from(`${JSON.stringify(HEADER)}\n`)
  assert.equal(header.indexOf(0x0a), header.length - 1)
  assert.equal(parsed.frames.length, parsed.events.length + 1)
})
