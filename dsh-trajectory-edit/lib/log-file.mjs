/**
 * Whole-log read/write for the DSH JSONL session format (v4).
 *
 * A log is `header line + one event per line`, physically split into
 * checksummed Zstandard frames. Reading exposes the raw lines together with the
 * frame that owns each line so a write can re-encode only the frames whose
 * lines actually changed and copy every other frame byte for byte.
 *
 * @module dsh-trajectory-edit/log-file
 */

import { compressFrame, decompressFrame, scanFrames } from './zstd-frames.mjs'

/** Current DSH session format version understood by this module. */
export const SESSION_FORMAT_VERSION = 4

/** Canonical current-generation log filename. */
export const LOG_FILENAME = 'session.v4.jsonl.zstd'

/**
 * Split one frame's plaintext into complete lines.
 * @param {Buffer} plaintext - frame plaintext.
 * @param {string} where - diagnostic label.
 * @returns {string[]} complete records without their trailing newline.
 */
function splitFrame(plaintext, where) {
  if (plaintext.length === 0 || plaintext[plaintext.length - 1] !== 0x0a) {
    throw new Error(`corrupt session log: ${where} does not end with a newline`)
  }
  const text = plaintext.subarray(0, -1).toString('utf8')
  return text.split('\n')
}

/**
 * Parse a complete session log.
 * @param {Buffer} buffer - raw `.jsonl.zstd` bytes.
 * @returns {{
 *   frames: {start: number, end: number}[],
 *   lines: string[],
 *   header: Record<string, unknown>,
 *   events: Record<string, unknown>[],
 *   lineFrame: number[],
 * }} the parsed log; `lines[0]` is the header record.
 */
export function parseLog(buffer) {
  const { frames, tornStart } = scanFrames(buffer)
  if (tornStart !== undefined) {
    throw new Error(`corrupt session log: torn Zstandard tail at byte ${tornStart}`)
  }
  if (frames.length === 0) throw new Error('corrupt session log: no frames')

  const lines = []
  const lineFrame = []
  for (const [frameIndex, frame] of frames.entries()) {
    const frameLines = splitFrame(decompressFrame(buffer, frame), `frame ${frameIndex}`)
    if (frameIndex === 0 && frameLines.length !== 1) {
      throw new Error('corrupt session log: first frame is not exactly one header line')
    }
    for (const line of frameLines) {
      lines.push(line)
      lineFrame.push(frameIndex)
    }
  }

  const header = parseLine(lines[0], 0)
  if (header.type !== 'session' || header.version !== SESSION_FORMAT_VERSION) {
    throw new Error(
      `unsupported session log: header version ${String(header.version)} (expected ${SESSION_FORMAT_VERSION})`,
    )
  }

  const events = []
  for (let index = 1; index < lines.length; index++) {
    const event = parseLine(lines[index], index)
    if (event.seq !== index - 1) {
      throw new Error(`corrupt session log: event at line ${index} has seq ${String(event.seq)}`)
    }
    events.push(event)
  }

  return { frames, lines, header, events, lineFrame }
}

/**
 * Parse one JSONL record.
 * @param {string} line - raw record text.
 * @param {number} index - line index for diagnostics.
 * @returns {Record<string, unknown>} the parsed object.
 */
function parseLine(line, index) {
  let value
  try {
    value = JSON.parse(line)
  } catch {
    throw new Error(`corrupt session log: line ${index} is not valid JSON`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`corrupt session log: line ${index} is not a JSON object`)
  }
  return value
}

/**
 * Re-encode the log, recompressing only frames that own a changed line.
 * @param {Buffer} original - the buffer {@link parseLog} read.
 * @param {{frames: {start: number, end: number}[], lines: string[], lineFrame: number[]}} parsed - parsed log.
 * @param {ReadonlySet<number>} changedLines - line indexes whose text changed.
 * @returns {Promise<Buffer>} the new log bytes.
 */
export async function serializeLog(original, parsed, changedLines) {
  const changedFrames = new Set()
  for (const index of changedLines) {
    const frame = parsed.lineFrame[index]
    if (frame === undefined) throw new Error(`internal: line ${index} has no frame`)
    changedFrames.add(frame)
  }

  const parts = []
  for (const [frameIndex, frame] of parsed.frames.entries()) {
    if (!changedFrames.has(frameIndex)) {
      parts.push(original.subarray(frame.start, frame.end))
      continue
    }
    const from = parsed.lineFrame.indexOf(frameIndex)
    let to = from
    while (to + 1 < parsed.lineFrame.length && parsed.lineFrame[to + 1] === frameIndex) to += 1
    const body = `${parsed.lines.slice(from, to + 1).join('\n')}\n`
    parts.push(await compressFrame(body))
  }
  return Buffer.concat(parts)
}

/**
 * Assert the invariants that make an in-place rewrite safe.
 * @param {{lines: string[], header: Record<string, unknown>, events: Record<string, unknown>[]}} before - log before the edit.
 * @param {{lines: string[], header: Record<string, unknown>, events: Record<string, unknown>[]}} after - log after the edit.
 * @param {ReadonlySet<number>} changedLines - line indexes expected to differ (0 = header).
 */
export function assertRewriteInvariants(before, after, changedLines) {
  if (before.lines.length !== after.lines.length) {
    throw new Error(
      `refusing to rewrite: event count changed (${before.lines.length} -> ${after.lines.length})`,
    )
  }
  if (changedLines.has(0)) throw new Error('refusing to rewrite: the session header must not change')
  for (let index = 0; index < before.lines.length; index++) {
    const same = before.lines[index] === after.lines[index]
    if (changedLines.has(index) === same) {
      throw new Error(
        `refusing to rewrite: line ${index} ${same ? 'was not' : 'was unexpectedly'} modified`,
      )
    }
  }
}

/**
 * Compare two parsed events and return the top-level data paths that differ.
 * @param {Record<string, unknown>} before - original event.
 * @param {Record<string, unknown>} after - rewritten event.
 * @returns {string[]} differing paths such as `data.message.content.0.text`.
 */
export function diffPaths(before, after) {
  const paths = []
  const walk = (left, right, path) => {
    if (left === right) return
    const leftObject = typeof left === 'object' && left !== null
    const rightObject = typeof right === 'object' && right !== null
    if (!leftObject || !rightObject) {
      paths.push(path)
      return
    }
    if (Array.isArray(left) !== Array.isArray(right)) {
      paths.push(path)
      return
    }
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of keys) {
      walk(left[key], right[key], path === '' ? key : `${path}.${key}`)
    }
  }
  walk(before, after, '')
  return paths
}
