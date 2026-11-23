/**
 * Trajectory record identity and editable-text mapping.
 *
 * The trajectory panel renders one `<tr data-trajectory-row-key="…">` per
 * record. That attribute is `encodeURIComponent(recordId)` where `recordId`
 * comes from `trajectoryRecordId()` in
 * `@deepseek-ai/dsh-client-ui-trajectory`: `recordId` for assistant messages,
 * `kind\0call\0callId` for tool rows, `kind\0seq\0seq` for everything else.
 * This module is the only place that decodes that convention.
 *
 * @module dsh-trajectory-edit/records
 */

/** Block types the editor exposes, per record kind. */
const EDITABLE = Object.freeze({
  'assistant/message': new Set(['reasoning', 'text']),
  'user/message': new Set(['text']),
})

/** Stream item type that carries a block's text deltas. */
const CHUNK_ITEM = Object.freeze({
  reasoning: 'reasoning-chunks',
  text: 'text-chunks',
})

/**
 * Decode one trajectory DOM row key.
 * @param {string} rawKey - the raw `data-trajectory-row-key` attribute.
 * @returns {{
 *   type: 'assistant' | 'call' | 'seq' | 'summary' | 'unknown',
 *   kind: string,
 *   turn?: number,
 *   step?: number,
 *   callId?: string,
 *   seq?: number,
 * }} the record identity.
 */
export function parseRecordKey(rawKey) {
  let decoded
  try {
    decoded = decodeURIComponent(String(rawKey ?? ''))
  } catch {
    return { type: 'unknown', kind: 'unknown' }
  }
  if (decoded.includes('\u0000summary\u0000')) {
    return { type: 'summary', kind: decoded.split('\u0000')[0] ?? 'unknown' }
  }
  const parts = decoded.split('\u0000')
  if (parts.length === 3 && parts[0] === 'assistant') {
    const turn = Number(parts[1])
    const step = Number(parts[2])
    if (Number.isInteger(turn) && Number.isInteger(step)) {
      return { type: 'assistant', kind: 'assistant', turn, step }
    }
  }
  if (parts.length === 3 && parts[1] === 'call') {
    return { type: 'call', kind: parts[0] ?? 'tool', callId: parts[2] }
  }
  if (parts.length === 3 && parts[1] === 'seq') {
    const seq = Number(parts[2])
    if (Number.isInteger(seq)) return { type: 'seq', kind: parts[0] ?? 'event', seq }
  }
  return { type: 'unknown', kind: parts[0] ?? 'unknown' }
}

/**
 * Locate the session events behind one record.
 * @param {Record<string, unknown>[]} events - parsed events in log order.
 * @param {ReturnType<typeof parseRecordKey>} identity - decoded record identity.
 * @returns {{event: Record<string, unknown>, index: number, related: number[]} | null}
 *   the primary event, its log index, and any paired events.
 */
export function findRecordEvents(events, identity) {
  if (identity.type === 'assistant') {
    const index = events.findIndex(event => event.type === 'assistant/message'
      && event.data?.turn === identity.turn
      && event.data?.step === identity.step)
    return index === -1 ? null : { event: events[index], index, related: [] }
  }
  if (identity.type === 'call') {
    const index = events.findIndex(event => event.type === 'tool/call'
      && event.data?.callId === identity.callId)
    if (index === -1) return null
    const related = []
    events.forEach((event, at) => {
      if (event.type === 'tool/result' && event.data?.message?.toolCallId === identity.callId) {
        related.push(at)
      }
    })
    return { event: events[index], index, related }
  }
  if (identity.type === 'seq') {
    const event = events[identity.seq]
    if (event === undefined) return null
    return { event, index: identity.seq, related: [] }
  }
  return null
}

/**
 * Read the blocks the editor may rewrite.
 * @param {Record<string, unknown>} event - the primary event.
 * @returns {{blockIndex: number, type: string, text: string}[]} editable blocks.
 */
export function editableBlocks(event) {
  const allowed = EDITABLE[String(event?.type)]
  if (allowed === undefined) return []
  const content = event.type === 'user/message'
    ? event.data?.content
    : event.data?.message?.content
  if (!Array.isArray(content)) return []
  const blocks = []
  for (const [blockIndex, block] of content.entries()) {
    if (allowed.has(block?.type) && typeof block.text === 'string') {
      blocks.push({ blockIndex, type: block.type, text: block.text })
    }
  }
  return blocks
}

/**
 * Whether this record supports automatic cleaning.
 * @param {Record<string, unknown>} event - the primary event.
 * @returns {boolean} true when at least one editable block exists.
 */
export function canClean(event) {
  return editableBlocks(event).length > 0
}

/**
 * Rewrite one block's text and every copy of it inside the timed stream.
 * Only `assistant/message` carries a stream; the two copies are
 * `stream[].reasoning-chunks|text-chunks.texts` and `stream[].chunk.block-end.block.text`.
 * @param {Record<string, unknown>} event - the event to copy and modify.
 * @param {number} blockIndex - content block index.
 * @param {string} text - replacement text.
 * @returns {Record<string, unknown>} a new event object.
 */
export function applyBlockEdit(event, blockIndex, text) {
  const next = structuredClone(event)
  const content = next.type === 'user/message'
    ? next.data?.content
    : next.data?.message?.content
  if (!Array.isArray(content) || content[blockIndex] === undefined) {
    throw new Error(`record has no content block ${blockIndex}`)
  }
  const block = content[blockIndex]
  block.text = text

  if (next.type !== 'assistant/message') return next
  const stream = next.data?.stream
  if (!Array.isArray(stream)) return next

  const itemType = CHUNK_ITEM[block.type]
  for (const item of stream) {
    if (item?.type === 'chunk' && item.chunk?.type === 'block-end'
      && item.chunk.index === blockIndex && typeof item.chunk.block?.text === 'string') {
      item.chunk.block.text = text
    }
    if (itemType !== undefined && item?.type === itemType && item.index === blockIndex) {
      item.texts = [text]
      item.dt = []
    }
  }
  return next
}

/**
 * Summarize a record for the edit dialog.
 * @param {Record<string, unknown>} event - the primary event.
 * @returns {{type: string, blocks: {blockIndex: number, type: string, text: string}[], editable: boolean}}
 *   the record shape.
 */
export function describeRecord(event) {
  const blocks = editableBlocks(event)
  return {
    type: String(event?.type ?? 'unknown'),
    blocks,
    editable: blocks.length > 0,
  }
}
