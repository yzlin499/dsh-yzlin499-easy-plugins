/**
 * Degenerate-text cleaning rules.
 *
 * These rules target the failure mode this plugin exists for: a model that
 * collapses into a short rotating phrase (`好。` / `**执行。**` / `**让我做。**`)
 * and burns the context window. They are deliberately conservative — they only
 * drop exact repeats of short lines or whole repeated periods, never rewrite or
 * reorder unique text.
 *
 * @module dsh-trajectory-edit/rules
 */

/** Marker line inserted where repetitions were folded. */
const MARKER = /^\[… 已折叠 \d+ 行重复 …\]$/

/** Default thresholds, measured against the captured collapse transcripts. */
export const DEFAULT_RULES = Object.freeze({
  /** A line at or below this many trimmed characters may be folded. */
  maxShortLine: 30,
  /** A short line must appear at least this many times to be folded. */
  minRepeat: 3,
  /** Occurrences kept before the fold marker. */
  keepRepeats: 2,
  /** Longest repeating period considered by the block rule. */
  maxPeriod: 12,
  /** A period must repeat at least this many times to be folded. */
  minPeriodRepeats: 4,
  /** A single reasoning block above this size is head/tail cropped. */
  maxBlockChars: 32_768,
  /** Fraction of the block kept at the head when cropping. */
  headRatio: 0.4,
  /** Fraction of the block kept at the tail when cropping. */
  tailRatio: 0.2,
})

/** Zero-width and replacement code points that never belong in a reply. */
const GARBAGE = /[\u0000\uFFFD\u200B-\u200D\u2060\uFEFF]/gu

/** Lone UTF-16 surrogates produced by broken decoding. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu

/**
 * Remove code points that indicate a decoding failure rather than content.
 * @param {string} text - raw text.
 * @returns {{text: string, removed: number}} sanitized text and the count removed.
 */
export function sanitize(text) {
  let removed = 0
  const withoutGarbage = text.replace(GARBAGE, () => {
    removed += 1
    return ''
  })
  const withoutSurrogates = withoutGarbage.replace(LONE_SURROGATE, () => {
    removed += 1
    return ''
  })
  return { text: withoutSurrogates, removed }
}

/**
 * Fold short lines that repeat more than {@link DEFAULT_RULES.keepRepeats} times.
 * @param {string[]} lines - text split by newline.
 * @param {object} rules - resolved thresholds.
 * @returns {{lines: string[], dropped: number}} folded lines and the drop count.
 */
function foldShortRepeats(lines, rules) {
  const counts = new Map()
  for (const line of lines) {
    const key = line.trim()
    if (key === '' || key.length > rules.maxShortLine || MARKER.test(key)) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const remaining = new Map()
  for (const [key, count] of counts) {
    if (count >= rules.minRepeat) remaining.set(key, rules.keepRepeats)
  }
  const out = []
  let dropped = 0
  for (const line of lines) {
    const key = line.trim()
    if (key !== '' && key.length <= rules.maxShortLine && remaining.has(key)) {
      const left = remaining.get(key)
      if (left > 0) {
        remaining.set(key, left - 1)
        out.push(line)
      } else {
        dropped += 1
      }
      continue
    }
    out.push(line)
  }
  return { lines: out, dropped }
}

/**
 * Fold a repeating period of lines (period <= maxPeriod, repeated >= minPeriodRepeats).
 * @param {string[]} lines - text split by newline.
 * @param {object} rules - resolved thresholds.
 * @returns {{lines: string[], dropped: number}} folded lines and the drop count.
 */
function foldPeriods(lines, rules) {
  const out = []
  let dropped = 0
  let index = 0
  while (index < lines.length) {
    // A fold marker is opaque: folding it again would make the rule non-idempotent.
    if (MARKER.test(lines[index].trim())) {
      out.push(lines[index])
      index += 1
      continue
    }
    let bestRun = 0
    let bestPeriod = 0
    for (let period = 1; period <= rules.maxPeriod && index + period < lines.length; period++) {
      let run = 0
      while (
        index + period + run < lines.length
        && lines[index + run] === lines[index + period + run]
        && !MARKER.test(lines[index + run].trim())
      ) {
        run += 1
      }
      if (run >= (rules.minPeriodRepeats - 1) * period && run > bestRun) {
        bestRun = run
        bestPeriod = period
      }
    }
    if (bestPeriod > 0) {
      for (let offset = 0; offset < bestPeriod; offset++) out.push(lines[index + offset])
      index += bestPeriod + bestRun
      dropped += bestRun
      out.push(`[… 已折叠 ${bestRun} 行重复 …]`)
      continue
    }
    out.push(lines[index])
    index += 1
  }
  return { lines: out, dropped }
}

/**
 * Crop an oversized block, keeping its head and tail.
 * @param {string} text - text after folding.
 * @param {object} rules - resolved thresholds.
 * @returns {{text: string, cropped: number}} cropped text and the removed count.
 */
function cropOversized(text, rules) {
  if (text.length <= rules.maxBlockChars) return { text, cropped: 0 }
  const head = Math.floor(rules.maxBlockChars * rules.headRatio)
  const tail = Math.floor(rules.maxBlockChars * rules.tailRatio)
  const removed = text.length - head - tail
  return {
    text: `${text.slice(0, head)}\n\n[… 已折叠 ${removed} 字符 …]\n\n${text.slice(text.length - tail)}`,
    cropped: removed,
  }
}

/**
 * Clean one text block.
 * @param {string} text - block text.
 * @param {object} [options] - rule overrides.
 * @returns {{text: string, changed: boolean, removed: number, droppedLines: number, cropped: number}}
 *   the cleaned text and its statistics.
 */
export function cleanText(text, options = {}) {
  const rules = { ...DEFAULT_RULES, ...options }
  const sanitized = sanitize(text)
  // Periods first: a rotating block should fold to one period, not to N copies
  // of each line. Scattered short repeats are then handled line by line.
  const periodic = foldPeriods(sanitized.text.split('\n'), rules)
  const short = foldShortRepeats(periodic.lines, rules)
  const cropped = cropOversized(short.lines.join('\n'), rules)
  const removed = text.length - cropped.text.length
  const changed = cropped.text !== text
  return {
    text: changed ? cropped.text : text,
    changed,
    removed: Math.max(removed, 0),
    droppedLines: short.dropped + periodic.dropped,
    cropped: cropped.cropped,
  }
}
