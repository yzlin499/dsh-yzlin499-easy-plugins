// 正文「文件提及 chip」两个变体（primitives: MarkdownFileLink / inlineCode）与相对路径解析。
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadClient } from './harness.mjs'
import { makeEl, makeEvent, makeWindow } from './fake-dom.mjs'

const { internals } = loadClient()
const { gate, SELECTORS, looksLikeFilePath, firstPathIn, resolveWithCwd } = internals

/** 变体 a：markdown 链接 → fileMention + fileLink，title = 相对路径 */
function linkChip(title) {
  const attrs = title === undefined ? {} : { title }
  return makeEl(['button', 'button[class*="fileMention"]'], { attrs })
}

/** 变体 b：行内代码路径 → 只有 fileMention，title = 绝对路径，另有 aria-label */
function inlineCodeChip({ title, label } = {}) {
  const attrs = {}
  if (title !== undefined) attrs.title = title
  if (label !== undefined) attrs['aria-label'] = label
  return makeEl(['button', 'button[class*="fileMention"]'], { attrs })
}

test('chip 的 selector 与契约一致（取更宽的 fileMention，覆盖两个变体）', () => {
  assert.equal(SELECTORS.fileMention, 'button[class*="fileMention"]')
})

test('变体 b：行内代码 chip 的绝对路径 title → 直接接管', () => {
  const chip = inlineCodeChip({
    title: 'D:\\Users\\Administrator\\workspace\\AIProject\\dsh-yzlin499-easy-plugins\\dsh-ctx-menu\\README.md',
    label: '在侧边栏打开 D:\\Users\\Administrator\\workspace\\AIProject\\dsh-yzlin499-easy-plugins\\dsh-ctx-menu\\README.md',
  })
  const hit = gate(makeEvent(chip), makeWindow(), {}, null)
  assert.equal(hit.kind, 'file')
  assert.equal(hit.file.source, 'mention')
  assert.equal(hit.file.absolute, true)
  assert.equal(hit.file.path.endsWith('dsh-ctx-menu\\README.md'), true)
})

test('变体 b：title 缺失时从 aria-label 里取出路径', () => {
  const chip = inlineCodeChip({ label: '在侧边栏打开 D:\\ws\\proj\\src\\a.cpp' })
  const hit = gate(makeEvent(chip), makeWindow(), {}, null)
  assert.equal(hit.kind, 'file')
  assert.equal(hit.file.path, 'D:\\ws\\proj\\src\\a.cpp')
})

test('绝对路径 title：直接接管，路径原样使用（变体 a）', () => {
  const hit = gate(makeEvent(linkChip('D:\\repo\\dsh-ctx-menu\\README.md')), makeWindow(), {}, null)
  assert.equal(hit.kind, 'file')
  assert.equal(hit.file.source, 'mention')
  assert.equal(hit.file.path, 'D:\\repo\\dsh-ctx-menu\\README.md')
  assert.equal(hit.file.absolute, true)
})

test('相对路径 title + 会话 cwd：解析成绝对路径（Windows 反斜杠）', () => {
  const hit = gate(makeEvent(linkChip('dsh-ctx-menu/README_EN.md')), makeWindow(), {}, 'D:\\ws\\proj')
  assert.equal(hit.kind, 'file')
  assert.equal(hit.file.path, 'D:\\ws\\proj\\dsh-ctx-menu\\README_EN.md')
  assert.equal(hit.file.display, 'dsh-ctx-menu/README_EN.md')
})

test('相对路径 title + POSIX cwd：用正斜杠拼接，等价于官方 resolveWorkspacePath', () => {
  const hit = gate(makeEvent(linkChip('src/a.ts')), makeWindow(), {}, '/home/me/proj')
  assert.equal(hit.file.path, '/home/me/proj/src/a.ts')
})

test('相对路径但没有 cwd：仍然接管，但标成 pending 交给异步解析（不静默放行、也不猜）', () => {
  const withoutCwd = gate(makeEvent(linkChip('dsh-ctx-menu/README.md')), makeWindow(), {}, null)
  assert.equal(withoutCwd.kind, 'file')
  assert.equal(withoutCwd.file.pending, true)
  assert.equal(withoutCwd.file.path, 'dsh-ctx-menu/README.md', '原样保留相对路径，等 cwd 到位再拼')
  assert.equal(withoutCwd.file.absolute, false)

  const noArg = gate(makeEvent(linkChip('dsh-ctx-menu/README.md')), makeWindow(), {})
  assert.equal(noArg.file.pending, true)

  // 绝对路径永远不需要 cwd：不受影响
  const absolute = gate(makeEvent(linkChip('D:\\ws\\a.md')), makeWindow(), {}, null)
  assert.equal(absolute.file.pending, undefined)
  assert.equal(absolute.file.path, 'D:\\ws\\a.md')
})

test('title 不像路径：不接管（图片 chip 没有 title / 普通按钮的说明文字）', () => {
  assert.equal(gate(makeEvent(linkChip()), makeWindow(), {}, 'D:\\ws'), null)
  assert.equal(gate(makeEvent(linkChip('点我')), makeWindow(), {}, 'D:\\ws'), null)
  assert.equal(gate(makeEvent(linkChip('copy/paste this')), makeWindow(), {}, 'D:\\ws'), null)
  assert.equal(gate(makeEvent(linkChip('dsh-ctx-menu')), makeWindow(), {}, 'D:\\ws'), null)
  // aria-label 里也没有路径 → 依然不接管
  assert.equal(gate(makeEvent(inlineCodeChip({ label: '在侧边栏打开' })), makeWindow(), {}, 'D:\\ws'), null)
})

test('firstPathIn：从文案里挑路径', () => {
  assert.equal(firstPathIn('在侧边栏打开 D:\\ws\\a.cpp'), 'D:\\ws\\a.cpp')
  assert.equal(firstPathIn('Open in sidebar /usr/local/a.ts'), '/usr/local/a.ts')
  assert.equal(firstPathIn('D:\\ws\\a.cpp'), 'D:\\ws\\a.cpp')
  assert.equal(firstPathIn('打开（D:\\ws\\a.cpp）'), 'D:\\ws\\a.cpp')
  assert.equal(firstPathIn('没有路径'), null)
  assert.equal(firstPathIn(''), null)
})

test('looksLikeFilePath 守卫', () => {
  assert.equal(looksLikeFilePath('a/b.ts'), true)
  assert.equal(looksLikeFilePath('a\\b.md'), true)
  assert.equal(looksLikeFilePath('/abs/x.py'), true)
  assert.equal(looksLikeFilePath('no-extension'), false)
  assert.equal(looksLikeFilePath('has space/a.ts'), false)
  assert.equal(looksLikeFilePath(''), false)
  assert.equal(looksLikeFilePath(undefined), false)
  assert.equal(looksLikeFilePath('x'.repeat(500) + '/a.ts'), false)
})

test('resolveWithCwd 拼接规则', () => {
  assert.equal(resolveWithCwd('D:\\a\\b', 'C:\\ws'), 'D:\\a\\b') // 已绝对 → 原样
  assert.equal(resolveWithCwd('src/a.ts', 'D:\\ws\\'), 'D:\\ws\\src\\a.ts') // 去掉 cwd 尾部斜杠
  assert.equal(resolveWithCwd('src/sub/a.ts', 'D:\\ws'), 'D:\\ws\\src\\sub\\a.ts') // 反斜杠归一
  assert.equal(resolveWithCwd('/abs/x.py', '/home/me'), '/abs/x.py') // POSIX 下已经是绝对路径 → 原样
  assert.equal(resolveWithCwd('src/a.ts', ''), null)
  assert.equal(resolveWithCwd('', 'D:\\ws'), null)
  assert.equal(resolveWithCwd('src/a.ts', undefined), null)
})

test('sessionFileAddress：等价官方 fileAddressFor（剥工作区根 / 反斜杠归一 / 段编码）', () => {
  const { sessionFileAddress } = internals
  // 工作区内的绝对路径 → 剥掉根，地址里只留相对路径
  assert.equal(
    sessionFileAddress('s1', 'D:\\ws\\proj', 'D:\\ws\\proj\\dsh-ctx-menu\\README.md'),
    'dsh-resource://file/session/s1/dsh-ctx-menu/README.md',
  )
  // 工作区外的绝对路径 → 保留绝对路径，盘符冒号保持字面量，反斜杠归一
  assert.equal(
    sessionFileAddress('s1', 'D:\\ws\\proj', 'C:\\other\\a.md'),
    'dsh-resource://file/session/s1/C:/other/a.md',
  )
  // 相对路径 → 直接编码
  assert.equal(sessionFileAddress('s1', 'D:\\ws\\proj', 'src/a b.ts'), 'dsh-resource://file/session/s1/src/a%20b.ts')
  // 没有 cwd 时按相对处理
  assert.equal(sessionFileAddress('s1', null, 'src/a.ts'), 'dsh-resource://file/session/s1/src/a.ts')
  // session id 需要编码
  assert.equal(sessionFileAddress('a b', null, 'x.md'), 'dsh-resource://file/session/a%20b/x.md')
})