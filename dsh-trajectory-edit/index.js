/**
 * Host half of `dsh-trajectory-edit`.
 *
 * Exposes four authenticated Fetch routes under `/api/trajectory-edit`. The
 * routes read and rewrite one session's `.jsonl.zstd` log; the browser half
 * only shows dialogs and posts the user's decision.
 *
 * @module dsh-trajectory-edit
 */

import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { LOG_FILENAME } from './lib/log-file.mjs'
import { describeRecord, findRecordEvents, parseRecordKey } from './lib/records.mjs'
import {
  applyPlan,
  hasOpenTurn,
  planClean,
  planCleanSession,
  planEdit,
  readSessionLog,
  restoreBackup,
} from './lib/surgery.mjs'

/** Host plugin name. */
export const name = 'trajectory-edit'

/** The authenticated route registry. */
export const inject = ['connection']

/** Route prefix below `/api`. */
const ROUTE = '/api/trajectory-edit'

/** Session ids are opaque but must stay a single safe path segment. */
const SESSION_ID = /^[A-Za-z0-9._~-]+$/

/**
 * Build a JSON response.
 * @param {number} status - HTTP status.
 * @param {unknown} body - JSON-serializable payload.
 * @returns {Response} the response.
 */
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * Build a stable failure response.
 * @param {number} status - HTTP status.
 * @param {string} code - machine-readable code.
 * @param {string} message - human-readable message.
 * @returns {Response} the response.
 */
function fail(status, code, message) {
  return json(status, { ok: false, error: { code, message } })
}

/**
 * Resolve one session id to its current-generation log path.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {string} sessionId - session id.
 * @returns {Promise<string | null>} absolute log path, or null when absent.
 */
async function resolveLogPath(ctx, sessionId) {
  const persistence = ctx.get('sessionPersistence')
  if (persistence !== undefined && typeof persistence.stat === 'function') {
    try {
      const stat = await persistence.stat(sessionId)
      const path = stat?.location?.path
      if (typeof path === 'string' && existsSync(path)) return path
    } catch {
      /* fall through to the directory scan */
    }
  }
  const root = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
  if (!existsSync(root)) return null
  for (const project of await readdir(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    const candidate = join(root, project.name, sessionId, LOG_FILENAME)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Read and validate a request body.
 * @param {Request} request - the incoming request.
 * @returns {Promise<Record<string, unknown> | null>} the parsed body, or null.
 */
async function readBody(request) {
  try {
    const body = await request.json()
    return typeof body === 'object' && body !== null ? body : null
  } catch {
    return null
  }
}

/**
 * Mount the plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @returns {void}
 */
export function apply(ctx) {
  const log = (...args) => console.log('[trajectory-edit]', ...args)
  const connection = ctx.get('connection')
  if (connection === undefined || typeof connection?.fetch?.register !== 'function') {
    log('connection service unavailable — nothing to do')
    return
  }

  /**
   * Resolve a request's session to a log path or a failure response.
   * @param {Record<string, unknown> | null} body - parsed request body.
   * @returns {Promise<{sessionId: string, path: string} | {response: Response}>} resolution.
   */
  async function locate(body) {
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
    if (!SESSION_ID.test(sessionId)) {
      return { response: fail(400, 'invalid-session', 'missing or invalid sessionId') }
    }
    const path = await resolveLogPath(ctx, sessionId)
    if (path === null) {
      return { response: fail(404, 'not-found', `session ${sessionId} has no log on disk`) }
    }
    return { sessionId, path }
  }

  ctx.effect(() => connection.fetch.register({
    path: `${ROUTE}/record`,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const body = await readBody(request)
      const located = await locate(body)
      if ('response' in located) return located.response
      try {
        const { parsed } = await readSessionLog(located.path)
        const identity = parseRecordKey(String(body?.key ?? ''))
        const found = findRecordEvents(parsed.events, identity)
        if (found === null) return fail(404, 'record-not-found', 'record not found in this session')
        return json(200, {
          ok: true,
          record: describeRecord(found.event),
          meta: {
            sessionId: located.sessionId,
            seq: found.index,
            eventType: found.event.type,
            turn: found.event.data?.turn ?? null,
            step: found.event.data?.step ?? null,
            busy: hasOpenTurn(parsed.events),
          },
        })
      } catch (error) {
        return fail(500, 'read-failed', error instanceof Error ? error.message : String(error))
      }
    },
  }), `${name}: record route`)

  ctx.effect(() => connection.fetch.register({
    path: `${ROUTE}/apply`,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const body = await readBody(request)
      const located = await locate(body)
      if ('response' in located) return located.response
      const dryRun = body?.dryRun === true
      const scope = body?.scope === 'session' ? 'session' : 'record'
      try {
        const { buffer, parsed } = await readSessionLog(located.path)
        if (!dryRun && hasOpenTurn(parsed.events)) {
          return fail(409, 'turn-in-progress', 'this session has an unfinished turn; finish or stop it first')
        }
        let plan
        if (scope === 'session') {
          plan = planCleanSession({ parsed })
        } else {
          const identity = parseRecordKey(String(body?.key ?? ''))
          const edits = Array.isArray(body?.edits) ? body.edits : null
          plan = edits === null
            ? planClean({ parsed }, identity)
            : planEdit({ parsed }, identity, edits)
        }
        const result = await applyPlan(located.path, buffer, parsed, plan, { dryRun })
        return json(200, {
          ok: true,
          dryRun,
          scope,
          report: result.report,
          backup: result.backup,
          bytesBefore: result.bytesBefore,
          bytesAfter: result.bytesAfter,
        })
      } catch (error) {
        return fail(400, 'apply-failed', error instanceof Error ? error.message : String(error))
      }
    },
  }), `${name}: apply route`)

  ctx.effect(() => connection.fetch.register({
    path: `${ROUTE}/restore`,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const body = await readBody(request)
      const located = await locate(body)
      if ('response' in located) return located.response
      const backup = typeof body?.backup === 'string' ? body.backup : ''
      try {
        if (!existsSync(backup)) return fail(404, 'backup-not-found', 'backup file no longer exists')
        await restoreBackup(located.path, backup)
        log(`restored ${located.sessionId} from ${backup}`)
        return json(200, { ok: true })
      } catch (error) {
        return fail(400, 'restore-failed', error instanceof Error ? error.message : String(error))
      }
    },
  }), `${name}: restore route`)

  log('ready: /api/trajectory-edit/{record,apply,restore}')
}
