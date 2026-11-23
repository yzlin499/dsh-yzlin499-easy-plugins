#!/usr/bin/env node
/**
 * Upgrade sentinel for `dsh-trajectory-edit`.
 *
 * The plugin leans on two DSH-internal surfaces that are not part of any public
 * contract:
 *
 *   1. the trajectory row DOM contract (`data-trajectory-row-key`,
 *      `data-conversation-session`), and
 *   2. the `assistant/message.data.stream` three-copy layout.
 *
 * An asar stores file contents uncompressed, so a byte search over the archive
 * proves the anchors are still shipped. Run this after a DSH upgrade: a failure
 * here means "verify before using the plugin", not "the plugin is broken".
 *
 * Usage:
 *   node scripts/check.mjs [--asar <path>]
 *
 * @module dsh-trajectory-edit/scripts/check
 */

import { createReadStream, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

/** Anchors that must exist in the installed DSH archive. */
const ANCHORS = [
  'data-trajectory-row-key',
  'data-conversation-session',
  'conversation.composer.dock',
  'contextMenus',
  'reasoning-chunks',
  'text-chunks',
  'block-end',
]

/** Default Windows install path for the desktop app. */
function defaultAsarPath() {
  const local = process.env.LOCALAPPDATA
  if (typeof local === 'string' && local !== '') {
    return join(local, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar')
  }
  return null
}

/**
 * Search a file for every anchor with a streaming, overlap-safe scan.
 * @param {string} path - file to scan.
 * @param {string[]} needles - ASCII anchors.
 * @returns {Promise<Record<string, boolean>>} found flags.
 */
async function scan(path, needles) {
  const found = Object.fromEntries(needles.map(needle => [needle, false]))
  const longest = Math.max(...needles.map(needle => Buffer.byteLength(needle)))
  let carry = Buffer.alloc(0)
  for await (const chunk of createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })) {
    const window = carry.length === 0 ? chunk : Buffer.concat([carry, chunk])
    for (const needle of needles) {
      if (!found[needle] && window.includes(needle)) found[needle] = true
    }
    carry = window.subarray(Math.max(0, window.length - longest))
    if (Object.values(found).every(Boolean)) break
  }
  return found
}

/**
 * Run the sentinel.
 * @returns {Promise<void>} resolves after printing the report.
 */
async function main() {
  const argv = process.argv.slice(2)
  const index = argv.indexOf('--asar')
  const asar = index === -1 ? defaultAsarPath() : resolve(argv[index + 1] ?? '')

  if (asar === null || !existsSync(asar)) {
    console.error(`check: DSH archive not found${asar === null ? '' : `: ${asar}`}`)
    console.error('check: pass --asar <path> when DSH is installed elsewhere')
    process.exitCode = 2
    return
  }

  const here = dirname(fileURLToPath(import.meta.url))
  const required = [
    join(here, '..', 'index.js'),
    join(here, '..', 'client.js'),
    join(here, '..', 'lib', 'surgery.mjs'),
    join(here, '..', 'lib', 'rules.mjs'),
    join(here, '..', 'lib', 'records.mjs'),
    join(here, '..', 'lib', 'log-file.mjs'),
    join(here, '..', 'lib', 'zstd-frames.mjs'),
  ]
  let failed = false
  for (const file of required) {
    if (!existsSync(file)) {
      console.error(`check: missing plugin file ${file}`)
      failed = true
    }
  }

  console.log(`check: scanning ${asar}`)
  const found = await scan(asar, ANCHORS)
  for (const [anchor, ok] of Object.entries(found)) {
    console.log(`  ${ok ? 'ok  ' : 'MISS'} ${anchor}`)
    if (!ok) failed = true
  }

  if (failed) {
    console.error('check: FAILED — a DSH upgrade changed an anchor this plugin depends on')
    process.exitCode = 1
    return
  }
  console.log('check: ok — all anchors present')
}

main().catch((error) => {
  console.error(`check: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
