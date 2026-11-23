/**
 * Synthetic session-log fixtures for the test suite.
 *
 * @module dsh-trajectory-edit/test/fixture
 */

import { compressFrame } from '../lib/zstd-frames.mjs'

/** Minimal v4 header record. */
export const HEADER = Object.freeze({
  type: 'session',
  version: 4,
  id: 'session-test-0000',
  createdAt: 1,
  cwd: 'C:\\workspace',
  isSeeded: false,
  delegationDepth: 0,
})

/**
 * Build one assistant message event with a self-consistent timed stream.
 * @param {object} options - fixture options.
 * @param {number} options.seq - event seq.
 * @param {number} [options.turn] - turn number.
 * @param {number} [options.step] - step number.
 * @param {string} [options.reasoning] - reasoning text.
 * @param {string} [options.text] - message text.
 * @param {boolean} [options.toolCall] - append a tool-call block.
 * @returns {object} the event.
 */
export function assistantEvent({
  seq,
  turn = 1,
  step = 1,
  reasoning = '让我做。\n执行。\n让我做。\n执行。\n让我做。\n执行。',
  text = '结论。',
  toolCall = true,
}) {
  const content = [
    { type: 'reasoning', text: reasoning },
    { type: 'text', text },
  ]
  const stream = [
    { type: 'chunk', time: 1, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } },
    {
      type: 'reasoning-chunks',
      time0: 1,
      index: 0,
      dt: [],
      texts: [reasoning],
    },
    { type: 'chunk', time: 2, chunk: { type: 'block-start', index: 1, blockType: 'text' } },
    { type: 'text-chunks', time0: 2, index: 1, dt: [], texts: [text] },
  ]
  if (toolCall) {
    content.push({ type: 'tool-call', id: 'call_1', name: 'pwsh', arguments: '{"command":"echo"}' })
    stream.push(
      { type: 'chunk', time: 3, chunk: { type: 'block-start', index: 2, blockType: 'tool-call' } },
      { type: 'tool-call-chunks', time0: 3, index: 2, dt: [], texts: [] },
    )
  }
  stream.push(
    {
      type: 'chunk',
      time: 4,
      chunk: { type: 'block-end', index: 0, block: { type: 'reasoning', text: reasoning } },
    },
    {
      type: 'chunk',
      time: 5,
      chunk: { type: 'block-end', index: 1, block: { type: 'text', text } },
    },
  )
  if (toolCall) {
    stream.push({
      type: 'chunk',
      time: 6,
      chunk: {
        type: 'block-end',
        index: 2,
        block: { type: 'tool-call', id: 'call_1', name: 'pwsh', arguments: '{"command":"echo"}' },
      },
    })
  }
  stream.push({ type: 'chunk', time: 7, chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } } })
  return {
    type: 'assistant/message',
    seq,
    time: 1_700_000_000_000 + seq,
    data: { turn, step, message: { role: 'assistant', content }, stream },
  }
}

/**
 * Build one user message event.
 * @param {object} options - fixture options.
 * @param {number} options.seq - event seq.
 * @param {string} [options.text] - message text.
 * @returns {object} the event.
 */
export function userEvent({ seq, text = '你好' }) {
  return {
    type: 'user/message',
    seq,
    time: 1_700_000_000_000 + seq,
    data: {
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
      role: 'user',
      id: `user-${seq}`,
    },
  }
}

/**
 * Encode events into a concatenated-Zstandard log (one frame per event).
 * @param {object[]} events - events with contiguous seqs from zero.
 * @param {object} [header] - header override.
 * @returns {Promise<Buffer>} the log bytes.
 */
export async function buildLog(events, header = HEADER) {
  const frames = [await compressFrame(`${JSON.stringify(header)}\n`)]
  for (const event of events) {
    frames.push(await compressFrame(`${JSON.stringify(event)}\n`))
  }
  return Buffer.concat(frames)
}

/**
 * Build a realistic three-event session: user, assistant, tool result.
 * @returns {Promise<{buffer: Buffer, events: object[]}>} log bytes and its events.
 */
export async function buildSession() {
  const events = [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    userEvent({ seq: 1 }),
    assistantEvent({ seq: 2 }),
    {
      type: 'tool/call',
      seq: 3,
      time: 2,
      data: { turn: 1, step: 1, callId: 'call_1', name: 'pwsh', arguments: '{"command":"echo"}' },
    },
    {
      type: 'tool/result',
      seq: 4,
      time: 4,
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          source: { kind: 'tool', callId: 'call_1' },
          toolCallId: 'call_1',
          content: [{ type: 'text', text: 'ok' }],
        },
      },
    },
    { type: 'turn/end', seq: 5, time: 5, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  return { buffer: await buildLog(events), events }
}
