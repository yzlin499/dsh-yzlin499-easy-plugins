/**
 * Session-log surgery: plan an edit, then apply it with a backup, a
 * post-write re-read, and automatic rollback.
 *
 * The safety model is narrow on purpose. A rewrite may change **only text
 * inside an existing event**; the event count, every `seq`, `turn`/`step`,
 * `surfaceOp`, `usage`, tool-call pairing and the header stay byte-identical.
 * Those are exactly the invariants DSH's v4 loader enforces, so the rewritten
 * log loads on the next `resume` without a migration.
 *
 * @module dsh-trajectory-edit/surgery
 */

import { copyFile, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { assertRewriteInvariants, diffPaths, parseLog, serializeLog } from './log-file.mjs'
import { applyBlockEdit, editableBlocks, findRecordEvents } from './records.mjs'
import { cleanText } from './rules.mjs'

/** Suffix marking a pre-rewrite backup; never matches the canonical log name. */
const BACKUP_SUFFIX = '.bak-'

/**
 * Read and parse one session log.
 * @param {string} logPath - absolute `.jsonl.zstd` path.
 * @returns {Promise<{buffer: Buffer, parsed: ReturnType<typeof parseLog>}>} the raw and parsed log.
 */
export async function readSessionLog(logPath) {
  const buffer = await readFile(logPath)
  return { buffer, parsed: parseLog(buffer) }
}

/**
 * Plan a manual text edit for one record.
 * @param {{parsed: ReturnType<typeof parseLog>}} log - the read log.
 * @param {ReturnType<import('./records.mjs').parseRecordKey>} identity - decoded record identity.
 * @param {{blockIndex: number, text: string}[]} edits - replacement text per block.
 * @returns {{lineIndex: number, before: Record<string, unknown>, after: Record<string, unknown>,
 *   changedLines: Set<number>, report: object}} the plan.
 */
export function planEdit(log, identity, edits) {
  const located = findRecordEvents(log.parsed.events, identity)
  if (located === null) throw new Error('record not found in this session log')
  if (editableBlocks(located.event).length === 0) {
    throw new Error('this record has no editable text')
  }

  let after = structuredClone(located.event)
  const report = { kind: String(located.event.type), blocks: [], removed: 0 }
  for (const edit of edits) {
    const before = editableBlocks(after).find(block => block.blockIndex === edit.blockIndex)
    if (before === undefined) throw new Error(`block ${edit.blockIndex} is not editable`)
    const text = String(edit.text ?? '')
    if (text === before.text) continue
    after = applyBlockEdit(after, edit.blockIndex, text)
    report.blocks.push({
      blockIndex: edit.blockIndex,
      type: before.type,
      beforeChars: before.text.length,
      afterChars: text.length,
    })
    report.removed += before.text.length - text.length
  }

  const lineIndex = located.index + 1 // line 0 is the header record
  return {
    lineIndex,
    before: located.event,
    after,
    changedLines: report.blocks.length === 0 ? new Set() : new Set([lineIndex]),
    report,
  }
}

/**
 * Plan automatic cleaning for one record.
 * @param {{parsed: ReturnType<typeof parseLog>}} log - the read log.
 * @param {ReturnType<import('./records.mjs').parseRecordKey>} identity - decoded record identity.
 * @param {object} [options] - rule overrides.
 * @returns {{lineIndex: number, before: Record<string, unknown>, after: Record<string, unknown>,
 *   changedLines: Set<number>, report: object}} the plan.
 */
export function planClean(log, identity, options = {}) {
  const located = findRecordEvents(log.parsed.events, identity)
  if (located === null) throw new Error('record not found in this session log')
  const blocks = editableBlocks(located.event)
  if (blocks.length === 0) throw new Error('this record has no cleanable text')

  let after = structuredClone(located.event)
  const report = { kind: String(located.event.type), blocks: [], removed: 0, droppedLines: 0 }
  for (const block of blocks) {
    const cleaned = cleanText(block.text, options)
    if (!cleaned.changed) continue
    after = applyBlockEdit(after, block.blockIndex, cleaned.text)
    report.blocks.push({
      blockIndex: block.blockIndex,
      type: block.type,
      beforeChars: block.text.length,
      afterChars: cleaned.text.length,
      droppedLines: cleaned.droppedLines,
    })
    report.removed += cleaned.removed
    report.droppedLines += cleaned.droppedLines
  }

  const lineIndex = located.index + 1
  return {
    lineIndex,
    before: located.event,
    after,
    changedLines: report.blocks.length === 0 ? new Set() : new Set([lineIndex]),
    report,
  }
}

/**
 * Plan automatic cleaning for every cleanable record in a session.
 * @param {{parsed: ReturnType<typeof parseLog>}} log - the read log.
 * @param {object} [options] - rule overrides.
 * @returns {{lineIndex: number, before: Record<string, unknown>, after: Record<string, unknown>,
 *   changedLines: Set<number>, report: object}} the plan.
 */
export function planCleanSession(log, options = {}) {
  const changedLines = new Set()
  const report = { kind: 'session', records: [], removed: 0, droppedLines: 0, totalRecords: 0 }
  log.parsed.events.forEach((event, index) => {
    if (event.type !== 'assistant/message') return
    report.totalRecords += 1
    const blocks = editableBlocks(event)
    if (blocks.length === 0) return
    let changed = false
    let removed = 0
    let droppedLines = 0
    for (const block of blocks) {
      const cleaned = cleanText(block.text, options)
      if (!cleaned.changed) continue
      changed = true
      removed += cleaned.removed
      droppedLines += cleaned.droppedLines
    }
    if (!changed) return
    changedLines.add(index + 1)
    report.records.push({ seq: index, removed, droppedLines })
    report.removed += removed
    report.droppedLines += droppedLines
  })
  return {
    lineIndex: -1,
    before: null,
    after: null,
    changedLines,
    report,
    session: true,
  }
}

/**
 * Apply a plan: serialize, verify in memory, back up, replace atomically, verify on disk.
 * @param {string} logPath - absolute log path.
 * @param {Buffer} original - the buffer the plan was computed from.
 * @param {ReturnType<typeof parseLog>} parsed - the parsed original.
 * @param {{lineIndex: number, before: Record<string, unknown> | null,
 *   after: Record<string, unknown> | null, changedLines: Set<number>, report: object, session?: boolean}} plan - the plan.
 * @param {object} [options] - apply options.
 * @param {boolean} [options.dryRun] - compute and verify without touching the file.
 * @returns {Promise<{ok: boolean, backup: string | null, bytesBefore: number, bytesAfter: number, report: object}>}
 *   the apply result.
 */
export async function applyPlan(logPath, original, parsed, plan, options = {}) {
  if (plan.changedLines.size === 0) {
    return {
      ok: true,
      backup: null,
      bytesBefore: original.length,
      bytesAfter: original.length,
      report: { ...plan.report, changed: false },
    }
  }

  const nextLines = [...parsed.lines]
  if (plan.session === true) {
    for (const lineIndex of plan.changedLines) {
      const event = parsed.events[lineIndex - 1]
      const blocks = editableBlocks(event)
      let rewritten = structuredClone(event)
      for (const block of blocks) {
        const cleaned = cleanText(block.text)
        if (cleaned.changed) rewritten = applyBlockEdit(rewritten, block.blockIndex, cleaned.text)
      }
      nextLines[lineIndex] = JSON.stringify(rewritten)
    }
  } else {
    nextLines[plan.lineIndex] = JSON.stringify(plan.after)
  }

  const next = await serializeLog(original, { ...parsed, lines: nextLines }, plan.changedLines)
  const reparsed = parseLog(next)
  assertRewriteInvariants(parsed, reparsed, plan.changedLines)
  assertOnlyTextChanged(parsed, reparsed, plan.changedLines)

  if (options.dryRun === true) {
    return {
      ok: true,
      backup: null,
      bytesBefore: original.length,
      bytesAfter: next.length,
      report: { ...plan.report, changed: true, dryRun: true },
    }
  }

  const backup = join(
    dirname(logPath),
    `${basename(logPath)}${BACKUP_SUFFIX}${Date.now()}`,
  )
  await copyFile(logPath, backup)

  const tempPath = join(dirname(logPath), `session.migration.${randomToken()}.tmp`)
  const handle = await open(tempPath, 'wx', 0o600)
  try {
    await handle.writeFile(next)
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    await rename(tempPath, logPath)
    const written = await readFile(logPath)
    const check = parseLog(written)
    assertRewriteInvariants(parsed, check, plan.changedLines)
    assertOnlyTextChanged(parsed, check, plan.changedLines)
    return {
      ok: true,
      backup,
      bytesBefore: original.length,
      bytesAfter: written.length,
      report: { ...plan.report, changed: true },
    }
  } catch (error) {
    await restoreBackup(logPath, backup)
    throw error
  } finally {
    await unlink(tempPath).catch(() => {})
  }
}

/** Paths a rewrite may touch: the content block plus its two stream copies. */
const ALLOWED_PATHS = [
  /^data\.message\.content\.(\d+)\.text$/,
  /^data\.content\.(\d+)\.text$/,
  /^data\.stream\.(\d+)\.chunk\.block\.text$/,
  /^data\.stream\.(\d+)\.texts(?:\.\d+)?$/,
  /^data\.stream\.(\d+)\.dt(?:\.\d+)?$/,
]

/**
 * Assert that only the planned block text (and its stream copies) differs.
 *
 * Every changed stream item must belong to an edited block index; anything else
 * — a shifted `turn`, a rewritten tool-call, a reordered stream — refuses the
 * write instead of silently corrupting the log.
 *
 * @param {ReturnType<typeof parseLog>} before - original log.
 * @param {ReturnType<typeof parseLog>} after - rewritten log.
 * @param {ReadonlySet<number>} changedLines - planned line indexes.
 */
function assertOnlyTextChanged(before, after, changedLines) {
  for (const lineIndex of changedLines) {
    const left = before.events[lineIndex - 1]
    const right = after.events[lineIndex - 1]
    const paths = diffPaths(left, right)
    const editedBlocks = new Set()
    for (const path of paths) {
      const match = ALLOWED_PATHS.map(pattern => pattern.exec(path)).find(Boolean)
      if (match === undefined) {
        throw new Error(`refusing to rewrite: unexpected change at ${path}`)
      }
      if (path.includes('.content.')) editedBlocks.add(Number(match[1]))
    }
    if (editedBlocks.size === 0) {
      throw new Error(`refusing to rewrite: line ${lineIndex} changed nothing editable`)
    }
    for (const path of paths) {
      const stream = /^data\.stream\.(\d+)\./.exec(path)
      if (stream === null) continue
      const item = after.events[lineIndex - 1].data.stream[Number(stream[1])]
      const blockIndex = item.chunk?.index ?? item.index
      if (!editedBlocks.has(blockIndex)) {
        throw new Error(
          `refusing to rewrite: stream item ${stream[1]} belongs to block ${String(blockIndex)}, `
          + `not an edited block`,
        )
      }
    }
    assertStreamMatchesContent(after.events[lineIndex - 1])
  }
}

/**
 * Assert that every block-end copy equals its content block.
 *
 * DSH's strict verifier replays `data.stream` and deep-compares the result with
 * `data.message.content`; a rewrite that touched only one copy would pass the
 * loader but fail verification and silently skew token accounting.
 *
 * @param {Record<string, unknown>} event - the rewritten event.
 */
function assertStreamMatchesContent(event) {
  if (event?.type !== 'assistant/message') return
  const content = event.data?.message?.content
  const stream = event.data?.stream
  if (!Array.isArray(content) || !Array.isArray(stream)) return
  for (const item of stream) {
    if (item?.type !== 'chunk' || item.chunk?.type !== 'block-end') continue
    const index = item.chunk.index
    const block = item.chunk.block
    if (index === undefined || block === undefined) continue
    const expected = content[index]
    if (expected === undefined) continue
    for (const key of new Set([...Object.keys(block), ...Object.keys(expected)])) {
      if (block[key] !== expected[key]) {
        throw new Error(
          `refusing to rewrite: stream block ${index} disagrees with content at "${key}"`,
        )
      }
    }
  }
}

/**
 * Restore a log from its backup.
 * @param {string} logPath - absolute log path.
 * @param {string} backup - absolute backup path.
 * @returns {Promise<void>} resolves after the backup replaces the log.
 */
export async function restoreBackup(logPath, backup) {
  await stat(backup)
  await copyFile(backup, logPath)
}

/** Random hex token for the migration temp file name. */
function randomToken() {
  return Math.random().toString(16).slice(2, 10)
}

/**
 * Whether the log ends inside a turn that never closed.
 *
 * A running turn appends events while we read; rewriting the file underneath it
 * would lose those appends. A crashed turn also stays open, so callers report
 * the condition instead of guessing.
 *
 * @param {Record<string, unknown>[]} events - parsed events in log order.
 * @returns {boolean} true when a `turn/start` has no matching `turn/end`.
 */
export function hasOpenTurn(events) {
  let open = 0
  for (const event of events) {
    if (event.type === 'turn/start') open += 1
    else if (event.type === 'turn/end') open = Math.max(0, open - 1)
  }
  return open > 0
}
