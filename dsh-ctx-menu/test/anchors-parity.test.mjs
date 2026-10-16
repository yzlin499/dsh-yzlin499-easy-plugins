// 锚点一致性：client.js 内联的选择器必须与 anchors.json 逐字一致，防止两边漂移。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadClient } from './harness.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const contract = JSON.parse(fs.readFileSync(path.resolve(here, '..', 'anchors.json'), 'utf8'))

test('client.js 的 SELECTORS 与 anchors.json.selectors 一致', () => {
  const { internals } = loadClient()
  assert.deepEqual(internals.SELECTORS, contract.selectors)
})

test('契约文件本身的结构完整', () => {
  assert.equal(typeof contract.target, 'string')
  assert.ok(Array.isArray(contract.asarExpect) && contract.asarExpect.length > 0)
  assert.ok(Array.isArray(contract.contextmenuBaseline) && contract.contextmenuBaseline.length > 0)
  for (const expectation of contract.asarExpect) {
    assert.ok(expectation.id, 'asarExpect 项必须有 id')
    assert.ok(Array.isArray(expectation.contains) && expectation.contains.length > 0, `${expectation.id} 需要 contains`)
    assert.ok(expectation.file || expectation.filePrefix, `${expectation.id} 需要 file 或 filePrefix`)
  }
})

test('插件导出契约齐全', () => {
  const { exports, registration } = loadClient()
  assert.equal(registration.id, 'dsh-ctx-menu')
  assert.equal(exports.name, 'dsh-ctx-menu')
  assert.deepEqual(exports.inject, ['slots', 'locale'])
  assert.equal(typeof exports.apply, 'function')
})