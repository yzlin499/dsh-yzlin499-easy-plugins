#!/usr/bin/env node
/**
 * Offline cleaner for DSH session logs.
 *
 * Usage:
 *   node scripts/clean-session.mjs <sessionId|logPath> [--record <rowKey>] [--apply] [--json]
 *
 * Without `--record` the whole session is cleaned (every assistant reasoning /
 * text block). Without `--apply` nothing is written: the run reports how much
 * would be saved. A rewrite always leaves `session.v4.jsonl.zstd.bak-<ts>`
 * next to the log.
 *
 * @module dsh-trajectory-edit/scripts/clean-session
 */

import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { LOG_FILENAME } from '../lib/log-file.mjs'
import { parseRecordKey } from '../lib/records.mjs'
import {
  applyPlan,
  planClean,
  planCleanSession,
  readSessionLog,
} from '../lib/surgery.mjs'

/**
 * Resolve a session id to its current-generation log path.
 * @param {string} target - absolute log path or `session-…` id.
 * @returns {Promise<string>} absolute log path.
 */
async function resolveLogPath(target) {
  if (target.includes('/') || target.includes('\\') || target.endsWith('.zstd')) {
    const path = resolve(target)
    if (!existsSync(path)) throw new Error(`log not found: ${path}`)
    return path
  }
  const root = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
  const projects = await readdir(root, { withFileTypes: true })
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const candidate = join(root, project.name, target, LOG_FILENAME)
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`session ${target} not found under ${root}`)
}

/**
 * Format bytes for the report.
 * @param {number} value - byte count.
 * @returns {string} human-readable size.
 */
function bytes(value) {
  return `${(value / 1024 / 1024).toFixed(2)} MiB`
}

/**
 * Run the CLI.
 * @returns {Promise<void>} resolves after printing the report.
 */
async function main() {
  const argv = process.argv.slice(2)
  const target = argv.find(argument => !argument.startsWith('--'))
  if (target === undefined) {
    console.error('usage: node scripts/clean-session.mjs <sessionId|logPath> [--record <rowKey>] [--apply] [--json]')
    process.exitCode = 2
    return
  }
  const recordIndex = argv.indexOf('--record')
  const recordKey = recordIndex === -1 ? undefined : argv[recordIndex + 1]
  const apply = argv.includes('--apply')
  const asJson = argv.includes('--json')

  const logPath = await resolveLogPath(target)
  const { buffer, parsed } = await readSessionLog(logPath)

  const plan = recordKey === undefined
    ? planCleanSession({ parsed })
    : planClean({ parsed }, parseRecordKey(recordKey))

  const result = await applyPlan(logPath, buffer, parsed, plan, { dryRun: !apply })

  const report = {
    logPath,
    apply,
    frames: parsed.frames.length,
    events: parsed.events.length,
    bytesBefore: buffer.length,
    bytesAfter: result.bytesAfter,
    savedBytes: buffer.length - result.bytesAfter,
    savedPercent: Number((((buffer.length - result.bytesAfter) / buffer.length) * 100).toFixed(2)),
    records: plan.report.records?.length ?? plan.report.blocks?.length ?? 0,
    removedChars: plan.report.removed,
    droppedLines: plan.report.droppedLines,
    backup: result.backup,
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log(`log:      ${report.logPath}`)
  console.log(`frames:   ${report.frames}`)
  console.log(`events:   ${report.events}`)
  console.log(`size:     ${bytes(report.bytesBefore)} -> ${bytes(report.bytesAfter)} (-${report.savedPercent}%)`)
  console.log(`records:  ${report.records} (removed ${report.removedChars} chars, ${report.droppedLines} lines)`)
  console.log(apply ? `backup:   ${report.backup ?? '(none)'}` : 'dry run:  nothing written (pass --apply to rewrite)')
}

main().catch((error) => {
  console.error(`failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
