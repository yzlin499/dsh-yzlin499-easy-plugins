/**
 * Concatenated-Zstandard frame primitives for DSH session logs.
 *
 * DSH writes one checksummed Zstandard frame per append batch: the first frame
 * holds exactly the header line, every later frame holds one or more complete
 * JSONL records and always ends with `\n`. Node's one-shot
 * `zstdDecompressSync` decodes only the first frame, so every read path here
 * scans frame boundaries itself and decompresses frame by frame.
 *
 * @module dsh-trajectory-edit/zstd-frames
 */

import { promisify } from 'node:util'
import zlib from 'node:zlib'

/** Zstandard frame magic number (little endian: 0xFD2FB528). */
const MAGIC = 0xfd2fb528

/** Options DSH itself writes with (Content_Checksum enabled). */
export const CHECKSUM_OPTIONS = Object.freeze({
  params: Object.freeze({ [zlib.constants.ZSTD_c_checksumFlag]: 1 }),
})

const compressAsync = promisify(zlib.zstdCompress)

/** Raised when a frame header is truncated or structurally invalid. */
class TornFrame extends Error {}

/**
 * Read one frame's encoded end offset.
 * @param {Buffer} buffer - the whole log.
 * @param {number} start - frame start offset.
 * @returns {number} offset immediately after the frame.
 */
function frameEnd(buffer, start) {
  let offset = start
  if (buffer.length - offset < 4) throw new TornFrame()
  if (buffer.readUInt32LE(offset) !== MAGIC) {
    throw new Error(`invalid Zstandard frame magic at byte ${offset}`)
  }
  offset += 4
  if (offset >= buffer.length) throw new TornFrame()
  const descriptor = buffer.readUInt8(offset)
  offset += 1
  if ((descriptor & 0x18) !== 0) {
    throw new Error(`reserved Zstandard frame-header bit at byte ${offset - 1}`)
  }
  const contentSizeFlag = descriptor >>> 6
  const singleSegment = (descriptor & 0x20) !== 0
  const checksum = (descriptor & 0x04) !== 0
  const dictionaryFlag = descriptor & 0x03
  const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
  const contentSizeBytes = contentSizeFlag === 0
    ? (singleSegment ? 1 : 0)
    : 1 << contentSizeFlag
  const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
  if (buffer.length - offset < remainingHeaderBytes) throw new TornFrame()
  offset += remainingHeaderBytes

  let last = false
  while (!last) {
    if (buffer.length - offset < 3) throw new TornFrame()
    const header = buffer.readUIntLE(offset, 3)
    last = (header & 1) === 1
    const blockType = (header >>> 1) & 3
    const blockSize = header >>> 3
    offset += 3
    if (blockType === 1) {
      // RLE block carries exactly one byte.
      if (offset >= buffer.length) throw new TornFrame()
      offset += 1
    } else if (blockType === 0 || blockType === 2) {
      if (buffer.length - offset < blockSize) throw new TornFrame()
      offset += blockSize
    } else {
      throw new Error(`reserved Zstandard block type at byte ${offset - 3}`)
    }
  }

  if (checksum) {
    if (buffer.length - offset < 4) throw new TornFrame()
    offset += 4
  }
  return offset
}

/**
 * Split a concatenated-Zstandard log into its physical frames.
 * @param {Buffer} buffer - raw log bytes.
 * @param {object} [options] - scan options.
 * @param {number} [options.maxFrames] - stop after this many frames (header probes).
 * @returns {{frames: {start: number, end: number}[], tornStart: number | undefined}}
 *   frame byte ranges plus the offset of a truncated tail, when present.
 */
export function scanFrames(buffer, options = {}) {
  const maxFrames = options.maxFrames ?? Number.POSITIVE_INFINITY
  const frames = []
  let offset = 0
  let tornStart
  while (offset < buffer.length) {
    const start = offset
    let end
    try {
      end = frameEnd(buffer, start)
    } catch (error) {
      if (error instanceof TornFrame) {
        tornStart = start
        break
      }
      throw error
    }
    frames.push({ start, end })
    offset = end
    if (frames.length >= maxFrames) break
  }
  return { frames, tornStart }
}

/**
 * Decompress one scanned frame, validating its checksum.
 * @param {Buffer} buffer - the whole log.
 * @param {{start: number, end: number}} frame - frame range from {@link scanFrames}.
 * @returns {Buffer} the frame's plaintext.
 */
export function decompressFrame(buffer, frame) {
  return zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end))
}

/**
 * Compress one plaintext chunk into a checksummed frame with DSH's parameters.
 * @param {Buffer | string} plaintext - one or more complete JSONL records.
 * @returns {Promise<Buffer>} the encoded frame.
 */
export function compressFrame(plaintext) {
  return compressAsync(plaintext, CHECKSUM_OPTIONS)
}

/**
 * Decode every frame of a log into a single plaintext buffer.
 * @param {Buffer} buffer - raw log bytes.
 * @returns {{frames: {start: number, end: number}[], plaintext: Buffer}}
 * @throws when the log has a torn tail.
 */
export function decodeLog(buffer) {
  const { frames, tornStart } = scanFrames(buffer)
  if (tornStart !== undefined) {
    throw new Error(`corrupt Zstandard session log: torn tail at byte ${tornStart}`)
  }
  if (frames.length === 0) throw new Error('corrupt Zstandard session log: no frames')
  const parts = frames.map(frame => decompressFrame(buffer, frame))
  return { frames, plaintext: Buffer.concat(parts) }
}
