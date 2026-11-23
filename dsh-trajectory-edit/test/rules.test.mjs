/**
 * Cleaning-rule tests.
 *
 * @module dsh-trajectory-edit/test/rules
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_RULES, cleanText, sanitize } from '../lib/rules.mjs'

test('folds a short line that repeats beyond the keep threshold', () => {
  const input = ['好。', 'A', '好。', 'B', '好。', 'C', '好。'].join('\n')
  const result = cleanText(input)
  assert.equal(result.changed, true)
  assert.equal(result.droppedLines, 2)
  assert.equal(result.text.split('\n').filter(line => line === '好。').length, 2)
  assert.equal(result.text, ['好。', 'A', '好。', 'B', 'C'].join('\n'))
})

test('keeps a short line that only appears twice', () => {
  const input = ['好。', 'A', '好。'].join('\n')
  assert.equal(cleanText(input).changed, false)
})

test('folds a repeating multi-line period', () => {
  const block = ['**让我做。**', '**执行。**']
  const input = [...block, ...block, ...block, ...block, ...block].join('\n')
  const result = cleanText(input)
  assert.equal(result.changed, true)
  assert.equal(result.text.split('\n').filter(line => line === '**让我做。**').length, 1)
})

test('never rewrites unique text', () => {
  const input = '第一段。\n\n第二段不同。\n\n第三段。'
  const result = cleanText(input)
  assert.equal(result.changed, false)
  assert.equal(result.text, input)
})

test('is idempotent', () => {
  const input = ['好。', 'A', '好。', 'B', '好。', 'C', '好。', ...'xyz'.split('')].join('\n')
  const once = cleanText(input)
  const twice = cleanText(once.text)
  assert.equal(twice.text, once.text)
  assert.equal(twice.changed, false)
})

test('does not re-fold its own marker line', () => {
  const marker = '[… 已折叠 9 行重复 …]'
  const input = [marker, marker, marker, marker].join('\n')
  assert.equal(cleanText(input).changed, false)
})

test('strips decoding garbage', () => {
  const result = sanitize('a\u0000b\uFFFDc\u200Bd')
  assert.equal(result.text, 'abcd')
  assert.equal(result.removed, 3)
})

test('strips lone surrogates', () => {
  assert.equal(sanitize('a\uD800b').text, 'ab')
})

test('crops an oversized block to its head and tail', () => {
  const input = `${'头'.repeat(30_000)}\n${'尾'.repeat(10_000)}`
  const result = cleanText(input)
  assert.equal(result.changed, true)
  assert.ok(result.text.length < input.length)
  assert.ok(result.text.startsWith('头'))
  assert.ok(result.text.endsWith('尾'))
  assert.ok(result.text.includes('已折叠'))
})

test('respects a custom threshold', () => {
  const input = ['x', 'x', 'x'].join('\n')
  assert.equal(cleanText(input, { minRepeat: 4 }).changed, false)
  assert.equal(cleanText(input, { minRepeat: 3, keepRepeats: 1 }).changed, true)
})

test('default rule set stays conservative', () => {
  assert.equal(DEFAULT_RULES.keepRepeats < DEFAULT_RULES.minRepeat, true)
  assert.equal(DEFAULT_RULES.maxShortLine, 30)
})
