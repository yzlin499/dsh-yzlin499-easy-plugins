#!/usr/bin/env node
// dsh-ctx-menu 静态自检
//
// 目的：把「非公开锚点」「客户端种子模块」「宿主服务契约」钉成断言，DSH 升级后**先失败**，
// 而不是让插件静默失效。0.2.0 → 0.2.1 的教训：当时只断言了磁盘文件路径，结果官方把实现搬进
// 打包产物后一路误报，而真正断掉的「remote.session 远程服务消失」却没被抓住。因此现在分两类断言：
//   - asarExpect：单文件字面量（锚点、外壳契约、宿主服务方法名）
//   - asarScan  ：跨文件出现次数（客户端 require 的**种子模块 id**，它们不在磁盘上以文件存在）
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
    sizeOf: (target) => files.find((entry) => entry.path === target)?.size ?? null,
    read,
    close: () => fs.closeSync(fd),
  }
}

const results = []
const record = (id, ok, detail) => results.push({ id, ok, detail })

if (fs.existsSync(asarPath) === false) {
  console.error(`[dsh-ctx-menu] check: 找不到 app.asar: ${asarPath}`)
  process.exit(1)
}

const asar = openAsar(asarPath)
const allPaths = asar.list()

// 1) 单文件字面量断言
for (const expectation of contract.asarExpect ?? []) {
  const candidates = expectation.filePrefix === undefined
    ? [expectation.file]
    : allPaths.filter((entry) => entry.startsWith(expectation.filePrefix)).sort()
  if (candidates.length === 0) {
    record(expectation.id, false, `找不到文件：${expectation.file ?? expectation.filePrefix + '*'}`)
    continue
  }
  let checked = null
  let missing = null
  for (const candidate of candidates) {
    const text = asar.read(candidate)
    if (text === null) continue
    const absent = expectation.contains.filter((literal) => text.includes(literal) === false)
    checked = candidate
    missing = absent
    if (absent.length === 0) break
  }
  if (checked === null) {
    record(expectation.id, false, `读不到文件：${candidates[0]}`)
    continue
  }
  record(
    expectation.id,
    missing.length === 0,
    missing.length === 0
      ? `${checked}（${expectation.contains.length} 条字面量都在）`
      : `缺失字面量 ${JSON.stringify(missing)} @ ${checked}`,
  )
}

// 2) 跨文件扫描断言（种子模块 id 这类「运行时契约」）
for (const scan of contract.asarScan ?? []) {
  const candidates = allPaths.filter(
    (entry) => entry.startsWith(scan.filePrefix) && entry.includes(scan.filePattern) && /\.(js|cjs|mjs)$/.test(entry),
  )
  let hits = 0
  for (const candidate of candidates) {
    const text = asar.read(candidate)
    if (text !== null && text.includes(scan.needle)) hits += 1
  }
  record(
    scan.id,
    hits >= scan.minFiles,
    `${hits} 个官方客户端文件仍在使用 ${scan.needle}（阈值 ${scan.minFiles}）`,
  )
}

// 3) 期望不存在：官方不得新增「自己写的」contextmenu 接管
{
  const baseline = new Set(contract.contextmenuBaseline ?? [])
  const ignore = contract.contextmenuIgnorePrefix ?? []
  const offenders = []
  for (const entry of allPaths) {
    if (/\.(js|cjs|mjs)$/.test(entry) === false) continue
    if (entry.startsWith('dsh/node_modules/@deepseek-ai/') === false && entry.startsWith('lib/') === false) continue
    if (ignore.some((prefix) => entry.startsWith(prefix))) continue
    if (baseline.has(entry)) continue
    const text = asar.read(entry)
    if (text === null) continue
    if (text.includes('contextmenu') === false && text.includes('contextMenu') === false) continue
    offenders.push(entry)
  }
  record(
    'no-new-official-contextmenu',
    offenders.length === 0,
    offenders.length === 0
      ? '没有新增的官方右键接管文件（已忽略内嵌 DevTools 与整站打包产物）'
      : `出现了新的 contextmenu 命中文件：${JSON.stringify(offenders.slice(0, 6))}（若官方新增了通用右键，本插件的接管规则需重新评估）`,
  )
}

asar.close()

let failed = 0
for (const item of results) {
  if (item.ok === false) failed += 1
  console.log(`${item.ok === true ? 'PASS' : 'FAIL'}  ${item.id}  ${item.detail}`)
}
console.log(`\n[dsh-ctx-menu] check: ${results.length - failed}/${results.length} 通过（目标 ${contract.target}）`)
process.exit(failed === 0 ? 0 : 1)