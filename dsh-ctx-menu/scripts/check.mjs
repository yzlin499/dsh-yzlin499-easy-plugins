#!/usr/bin/env node
// dsh-ctx-menu 静态自检
//
// v0.3.0 起本插件**只向官方统一右键贡献动作**（`ctx.contextMenus.register`），
// 不再自绘菜单、不再劫持 DOM 右键。因此自检对象从「DOM 锚点」改为两类：
//   1. asarExpect —— 官方统一右键的契约仍在（服务名 / 注册形状 / file 目标 / DOM 绑定）
//   2. selfCheck  —— 本插件自己的设计前提（不装捕获期右键监听、确实贡献到 file 目标）
//
// 做法：直接按字节读 app.asar（无需解包）。
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
const SCAN_LIMIT = 8 * 1024 * 1024

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
  const cache = new Map()
  const read = (target) => {
    if (cache.has(target)) return cache.get(target)
    const entry = files.find((candidate) => candidate.path === target)
    let text = null
    if (entry !== undefined && entry.size <= SCAN_LIMIT) {
      const buffer = Buffer.alloc(entry.size)
      fs.readSync(fd, buffer, 0, entry.size, base + entry.offset)
      text = buffer.toString('utf8')
    }
    cache.set(target, text)
    return text
  }
  return {
    list: () => files.map((entry) => entry.path),
    read,
    close: () => fs.closeSync(fd),
  }
}

const results = []
const record = (id, ok, detail) => results.push({ id, ok, detail })

const readLocal = (relativePath) => fs.readFileSync(path.join(pkgRoot, relativePath), 'utf8')

// 1) 官方统一右键契约
if (fs.existsSync(asarPath) === false) {
  console.error(`[dsh-ctx-menu] check: 找不到 app.asar: ${asarPath}`)
  process.exit(1)
}
const asar = openAsar(asarPath)
for (const expectation of contract.asarExpect ?? []) {
  const text = asar.read(expectation.file)
  if (text === null) {
    record(expectation.id, false, `读不到官方文件：${expectation.file}`)
    continue
  }
  const missing = expectation.contains.filter((literal) => text.includes(literal) === false)
  record(
    expectation.id,
    missing.length === 0,
    missing.length === 0
      ? `${expectation.file.split('@deepseek-ai/')[1] ?? expectation.file}（${expectation.contains.length} 条契约字面量都在）`
      : `缺失契约字面量 ${JSON.stringify(missing)} @ ${expectation.file}`,
  )
}

// 1b) 窗口检查：官方某个标记附近**不得**出现某些字面量（用于判断官方是否补绑）
for (const windowCheck of contract.asarWindow ?? []) {
  const text = asar.read(windowCheck.file)
  if (text === null) {
    record(windowCheck.id, false, `读不到官方文件：${windowCheck.file}`)
    continue
  }
  const markerIndex = text.indexOf(windowCheck.marker)
  if (markerIndex === -1) {
    record(windowCheck.id, false, `找不到标记 ${windowCheck.marker} @ ${windowCheck.file}`)
    continue
  }
  const from = Math.max(0, markerIndex - (windowCheck.extendsBefore ?? 0))
  const to = markerIndex + (windowCheck.extendsAfter ?? 0)
  const slice = text.slice(from, to)
  const offenders = (windowCheck.mustNotContain ?? []).filter((literal) => slice.includes(literal))
  record(
    windowCheck.id,
    offenders.length === 0,
    offenders.length === 0
      ? `${windowCheck.marker} 附近仍未出现 ${JSON.stringify(windowCheck.mustNotContain)}（桥接仍然必要）`
      : `${windowCheck.marker} 附近出现了 ${JSON.stringify(offenders)} —— 官方可能已补绑，桥接可以删除`,
  )
}
asar.close()

// 2) 本插件自己的设计前提
for (const check of contract.selfCheck ?? []) {
  const text = readLocal(check.file)
  const missing = (check.mustContain ?? []).filter((literal) => text.includes(literal) === false)
  const present = (check.mustNotContain ?? []).filter((literal) => text.includes(literal))
  const ok = missing.length === 0 && present.length === 0
  record(
    check.id,
    ok,
    ok
      ? `${check.file} 符合设计前提`
      : `缺失 ${JSON.stringify(missing)}；不该出现 ${JSON.stringify(present)}`,
  )
}

let failed = 0
for (const item of results) {
  if (item.ok === false) failed += 1
  console.log(`${item.ok === true ? 'PASS' : 'FAIL'}  ${item.id}  ${item.detail}`)
}
console.log(`\n[dsh-ctx-menu] check: ${results.length - failed}/${results.length} 通过（目标 ${contract.target}）`)
process.exit(failed === 0 ? 0 : 1)
