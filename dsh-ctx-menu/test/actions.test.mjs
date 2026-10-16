// 文件内容分页读取：循环终止、错误码透传、体积上限。
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadClient } from './harness.mjs'

const { internals } = loadClient()
const { readTextPaged } = internals

function paged(pages) {
  let index = 0
  return {
    calls: [],
    async read(sessionId, path, range) {
      this.calls.push({ sessionId, path, range })
      const page = pages[index]
      index += 1
      if (page === undefined) throw new Error('unexpected extra page request')
      return { ok: true, value: page }
    },
  }
}

test('多页拼接，遇到 eof 停止', async () => {
  const reader = paged([
    { offset: 1, lines: 2, text: 'a\nb', eof: false },
    { offset: 3, lines: 1, text: 'c', eof: true },
  ])
  const result = await readTextPaged(reader, 'session-1', 'src/a.ts')
  assert.equal(result.ok, true)
  assert.equal(result.text, 'a\nb\nc')
  assert.equal(reader.calls.length, 2)
  assert.deepEqual(reader.calls[1].range, { offset: 3, limit: 5000 })
})

test('空页（lines=0）必须终止，避免死循环', async () => {
  const reader = paged([{ offset: 1, lines: 0, text: '', eof: false }])
  const result = await readTextPaged(reader, 's', 'p')
  assert.equal(result.ok, true)
  assert.equal(result.text, '')
  assert.equal(reader.calls.length, 1)
})

test('二进制文件：透传 not-text', async () => {
  const reader = { read: async () => ({ ok: false, error: { code: 'workspace-file/not-text' } }) }
  const result = await readTextPaged(reader, 's', 'p')
  assert.deepEqual(result, { ok: false, code: 'workspace-file/not-text' })
})

test('超过 2 MiB 上限即放弃', async () => {
  const big = 'x'.repeat(2 * 1024 * 1024 + 10)
  const reader = paged([{ offset: 1, lines: 5000, text: big, eof: false }])
  const result = await readTextPaged(reader, 's', 'p')
  assert.deepEqual(result, { ok: false, code: 'workspace-file/too-large' })
})

test('未知失败也给得出 code', async () => {
  const reader = { read: async () => ({ ok: false }) }
  const result = await readTextPaged(reader, 's', 'p')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'unknown')
})