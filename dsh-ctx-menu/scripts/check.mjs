#!/usr/bin/env node
// dsh-ctx-menu 静态自检
//
// 目的：把「非公开锚点」与「外壳菜单契约」钉成断言，DSH 升级后**先失败**，而不是让插件静默失效。
// 做法：直接按字节读 app.asar（无需解包），对官方 bundle 做文本断言。
//
// asar 头格式：u32@4 = headerSize，u32@12 = jsonSize，
// header JSON 从字节 16 开始（长度 jsonSize），文件数据起始 = 8 + headerSize + offset。
//
// 用法：node scripts/check.mjs [--asar <路径>]
// 退出码：0 = 全部通过；1 = 有失败项。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')
const contract = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'anchors.json'), 'utf8'))

const defaultAsar = 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar'
const argv = process.argv.slice(2)
const asarIndex = argv.indexOf('--asar')
const asarPath = asarIndex === -1 ? defaultAsar : argv[asarIndex + 1]

function openAsar(file) {
  const fd = fs.openSync(file, 'r')
  const head = Buffer.alloc(16)
  fs.readSync(fd, head, 0, 16, 0)
  const headerSize = head.readUInt32LE(4)
  const jsonSize = head.readUInt32LE(12)
  const raw = Buffer.alloc(jsonSize)
  fs.readSync(fd, raw, 0, jsonSize, 16)
  const tree = JSON.parse(raw.toString('utf8'))
  const base = 8 + headerSize
  const files = []
  ;(function walk(node, prefix) {
    for (const [name, value] of Object.entries(node.files ?? {})) {
      const full = prefix === '' ? name : `${prefix}/${name}`
      if (value.files) walk(value, full)
      else if (value.size) files.push({ path: full, size: value.size, offset: Number(value.offset ?? 0) })
    }
  })(tree, '')
  return {
    list: () => files.map((entry) => entry.path),
    sizeOf: (target) => files.find((entry) => entry.path === target)?.size ?? null,
    read: (target) => {
      const entry = files.find((candidate) => candidate.path === target)
      if (entry === undefined) return null
      const buffer = Buffer.alloc(entry.size)
      fs.readSync(fd, buffer, 0, entry.size, base + entry.offset)
      return buffer.toString('utf8')
    },
    close: () => fs.closeSync(fd),
  }
}

const results = []
function record(id, ok, detail) {
  results.push({ id, ok, detail })
}

if (fs.existsSync(asarPath) === false) {
  console.error(`[dsh-ctx-menu] check: 找不到 app.asar: ${asarPath}`)
  process.exit(1)
}

const asar = openAsar(asarPath)
const allPaths = asar.list()

// 1) 锚点与契约字面量
for (const expectation of contract.asarExpect) {
  const candidates = expectation.filePrefix === undefined
    ? [expectation.file]
    : allPaths.filter((entry) => entry.startsWith(expectation.filePrefix))
  if (candidates.length === 0) {
    record(expectation.id, false, `找不到文件：${expectation.file ?? expectation.filePrefix + '*'}`)
    continue
  }
  const text = asar.read(candidates[0])
  if (text === null) {
    record(expectation.id, false, `读不到文件：${candidates[0]}`)
    continue
  }
  const missing = expectation.contains.filter((literal) => text.includes(literal) === false)
  record(
    expectation.id,
    missing.length === 0,
    missing.length === 0
      ? `${candidates[0]}（${expectation.contains.length} 条字面量都在）`
      : `缺失字面量 ${JSON.stringify(missing)} @ ${candidates[0]}`,
  )
}

// 2) 期望不存在：官方不得新增「自己写的」contextmenu 接管（我现在只认识基线里这些文件）
{
  const baseline = new Set(contract.contextmenuBaseline)
  const offenders = []
  const SCAN_LIMIT = 4 * 1024 * 1024
  for (const entry of allPaths) {
    if (/\.(js|cjs|mjs)$/.test(entry) === false) continue
    if (entry.startsWith('dsh/node_modules/@deepseek-ai/') === false && entry.startsWith('lib/') === false) continue
    const size = asar.sizeOf(entry)
    if (size === null || size > SCAN_LIMIT) continue
    const text = asar.read(entry)
    if (text === null) continue
    if (text.includes('contextmenu') === false && text.includes('contextMenu') === false) continue
    if (baseline.has(entry)) continue
    offenders.push(entry)
  }
  record(
    'no-new-official-contextmenu',
    offenders.length === 0,
    offenders.length === 0
      ? '没有新增的官方右键接管文件'
      : `出现了新的 contextmenu 命中文件：${JSON.stringify(offenders.slice(0, 6))}（若官方新增了通用右键，本插件的接管规则需重新评估）`,
  )
}

asar.close()

// 输出
let failed = 0
for (const item of results) {
  if (item.ok === false) failed += 1
  console.log(`${item.ok === true ? 'PASS' : 'FAIL'}  ${item.id}  ${item.detail}`)
}
console.log(`\n[dsh-ctx-menu] check: ${results.length - failed}/${results.length} 通过（目标版本 ${contract.target}）`)
process.exit(failed === 0 ? 0 : 1)

export {}