// 纯函数与远程服务适配：绝对路径解析、相对路径、分页读文本。
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadClient } from './harness.mjs'

const { internals } = loadClient()
const { normalizeToNative, relativeToCwd, sessionCwd, absolutePathOf, appsOf, readText } = internals

function ctxWith(services) {
  return { get: (name) => services[name] }
}

test('normalizeToNative：混用分隔符归一（官方绝对路径会混用）', () => {
  assert.equal(
    normalizeToNative('I:\\Jx3YL\\YunLiu\\Source/JXHan/Public/AVGASDialog.h'),
    'I:\\Jx3YL\\YunLiu\\Source\\JXHan\\Public\\AVGASDialog.h',
  )
  assert.equal(normalizeToNative('D:/ws//proj/src/a.ts'), 'D:\\ws\\proj\\src\\a.ts')
  assert.equal(normalizeToNative('/home/me/a\\b/c.ts'), '/home/me/a/b/c.ts', 'POSIX 反向归一')
  assert.equal(normalizeToNative(''), '')
})

test('relativeToCwd：相对会话工作目录；不在其中退回绝对路径；无 cwd 返回 null', () => {
  assert.equal(relativeToCwd('D:\\ws\\proj\\src\\a.ts', 'D:\\ws\\proj'), 'src/a.ts')
  assert.equal(relativeToCwd('D:\\ws\\proj', 'D:\\ws\\proj'), '.')
  assert.equal(relativeToCwd('D:\\other\\a.ts', 'D:\\ws\\proj'), 'D:/other/a.ts')
  assert.equal(relativeToCwd('D:\\ws\\proj2\\a.ts', 'D:\\ws\\proj'), 'D:/ws/proj2/a.ts', '前缀相似但不误剥')
  assert.equal(relativeToCwd('D:\\ws\\a.ts', null), null)
  assert.equal(relativeToCwd('', 'D:\\ws'), null)
})

test('sessionCwd：从 sessions 快照取 cwd，缺失返回 null', () => {
  const ctx = ctxWith({ sessions: { list: { getSnapshot: () => ({ byId: { s1: { cwd: 'D:\\ws\\proj' } } }) } } })
  assert.equal(sessionCwd(ctx, 's1'), 'D:\\ws\\proj')
  assert.equal(sessionCwd(ctx, 'nope'), null)
  assert.equal(sessionCwd(ctxWith({}), 's1'), null)
})

test('absolutePathOf：优先用官方 workspaceFiles.stat，失败时用 cwd 兜底', async () => {
  const withStat = ctxWith({
    'remote.workspaceFiles': { stat: async () => ({ ok: true, value: { absolutePath: 'I:\\Jx3YL\\a.h' } }) },
  })
  assert.equal(await absolutePathOf(withStat, 's1', 'Source/a.h'), 'I:\\Jx3YL\\a.h')

  const fallback = ctxWith({
    'remote.workspaceFiles': { stat: async () => ({ ok: false }) },
    sessions: { list: { getSnapshot: () => ({ byId: { s1: { cwd: 'D:\\ws\\proj' } } }) } },
  })
  assert.equal(await absolutePathOf(fallback, 's1', 'src/a.h'), 'D:\\ws\\proj\\src\\a.h')

  // 已经是绝对路径：即使没有 cwd 也能用
  assert.equal(await absolutePathOf(ctxWith({}), 's1', 'D:\\ws\\a.h'), 'D:\\ws\\a.h')
  // 相对路径 + 没有 cwd：返回 null
  assert.equal(await absolutePathOf(ctxWith({}), 's1', 'src/a.h'), null)
})

test('appsOf：规范化官方关联应用列表，非法条目丢弃', async () => {
  const ctx = ctxWith({
    'remote.session': {
      workspacePathApplications: async () => ({
        ok: true,
        value: [
          { id: 'rider64.exe', name: 'Rider', default: true, icon: 'data:image/png;base64,AA' },
          { id: 'bad' },
          null,
        ],
      }),
    },
  })
  const apps = await appsOf(ctx, 'D:\\a.h')
  assert.deepEqual(apps, [{ id: 'rider64.exe', name: 'Rider', default: true, icon: 'data:image/png;base64,AA' }])
  assert.deepEqual(await appsOf(ctxWith({}), 'D:\\a.h'), [], '服务缺失时给空数组')
})

test('readText：分页读到 eof，超过 2 MiB 报 too-large，服务缺失报 unsupported', async () => {
  const pages = [
    { ok: true, value: { offset: 1, lines: 2, text: 'a\nb', eof: false } },
    { ok: true, value: { offset: 3, lines: 1, text: 'c', eof: true } },
  ]
  let index = 0
  const ctx = ctxWith({
    'remote.workspaceFiles': { read: async () => pages[index++] },
  })
  assert.deepEqual(await readText(ctx, 's1', 'D:\\a.txt'), { ok: true, text: 'a\nb\nc' })
  assert.deepEqual(await readText(ctxWith({}), 's1', 'D:\\a.txt'), { ok: false, code: 'host/unsupported' })
})
