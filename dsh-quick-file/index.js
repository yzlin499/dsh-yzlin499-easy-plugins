import { lstat, readdir } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { join, relative, resolve, sep } from 'node:path'

const NS = 'dsh-quick-file'
const FILE_REFERENCE_PROMPT = 'Tokens prefixed with @ are workspace paths the user explicitly referenced, relative to the workspace root. A trailing slash marks a directory: list it when its contents matter. Anything else is a file: use the read tool when its contents are needed, and do not claim to have inspected it before reading. @"..." quotes a path containing spaces.'
const DEFAULT_EXCLUDED = ['node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'target', '.next', '.nuxt', '.turbo', '.venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.gradle']
const DEFAULT_EVERYTHING_URL = 'http://127.0.0.1:8074'
const MAX_BODY_BYTES = 64 * 1024
const MAX_EVERYTHING_BYTES = 16 * 1024 * 1024

function parseIgnoreDirs(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',')
  return [...new Set(raw.map((part) => String(part).trim()).filter(Boolean))]
}

function validEverythingUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const parsed = new URL(raw)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('everythingUrl must use http or https')
  return raw.replace(/\/+$/, '')
}

function httpGetJson(href, signal, timeoutMs = 6000) {
  return new Promise((resolvePromise, rejectPromise) => {
    let url
    try { url = new URL(href) } catch (error) { rejectPromise(error); return }
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      error ? rejectPromise(error) : resolvePromise(value)
    }
    const req = request(url, { method: 'GET', signal }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        data += chunk
        if (data.length > MAX_EVERYTHING_BYTES) req.destroy(new Error('Everything response is too large'))
      })
      res.on('end', () => {
        if (res.statusCode !== 200) { finish(new Error(`Everything HTTP ${res.statusCode}`)); return }
        try { finish(null, JSON.parse(data)) } catch (error) { finish(new Error(`Everything response is not JSON: ${error.message}`)) }
      })
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Everything request timed out')))
    req.on('error', (error) => finish(error))
  })
}

function pathInside(root, target) {
  const rootResolved = resolve(root)
  const targetResolved = resolve(target)
  const rootKey = process.platform === 'win32' ? rootResolved.toLowerCase() : rootResolved
  const targetKey = process.platform === 'win32' ? targetResolved.toLowerCase() : targetResolved
  return targetKey === rootKey || targetKey.startsWith(`${rootKey}${sep}`)
}

function relativePath(root, target) {
  if (!pathInside(root, target)) return null
  const value = relative(resolve(root), resolve(target))
  return value === '' ? '.' : value.split(sep).join('/')
}

function candidateFromResult(root, result) {
  if (!result || typeof result.path !== 'string' || typeof result.name !== 'string') return null
  const path = relativePath(root, join(result.path, result.name))
  if (!path || path === '.') return null
  return { path, kind: result.type === 'folder' || result.type === 'directory' ? 'directory' : 'file' }
}

function directChildOf(path, directory) {
  const normalized = String(path).replace(/\\/g, '/')
  const parent = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : ''
  return parent === directory.replace(/\/+$/, '')
}

function visible(candidate, query) {
  return query.startsWith('.') || query.includes('/.') || !candidate.path.split('/').some((part) => part.startsWith('.'))
}

function rankCandidates(candidates, query, limit) {
  const needle = query.toLowerCase()
  const score = (candidate) => {
    const name = candidate.path.slice(candidate.path.lastIndexOf('/') + 1).toLowerCase()
    if (needle === '') return 0
    if (name === needle) return 1000
    if (name.startsWith(needle)) return 900
    if (name.includes(needle)) return 700
    if (candidate.path.toLowerCase().includes(needle)) return 500
    return 0
  }
  return candidates.filter((candidate) => visible(candidate, query) && (needle === '' || score(candidate) > 0)).sort((left, right) => {
    return score(right) - score(left) || Number(right.kind === 'directory') - Number(left.kind === 'directory') || left.path.localeCompare(right.path)
  }).slice(0, limit)
}

async function readDirectory(root, displayDirectory, fragment, excluded, signal) {
  const directory = displayDirectory.replace(/\/+$/, '')
  const absolute = resolve(root, directory || '.')
  if (!pathInside(root, absolute)) return []
  const entries = await readdir(absolute, { withFileTypes: true })
  const candidates = []
  for (const entry of entries) {
    signal.throwIfAborted()
    if (entry.name.startsWith('.') && !fragment.startsWith('.')) continue
    if (entry.isDirectory() && excluded.has(entry.name)) continue
    if (!entry.isDirectory() && !entry.isFile()) continue
    const path = `${directory ? `${directory}/` : ''}${entry.name}`
    candidates.push({ path, kind: entry.isDirectory() ? 'directory' : 'file' })
  }
  return rankCandidates(candidates, fragment, Number.MAX_SAFE_INTEGER)
}

async function fallbackList(root, query, config, signal) {
  const slash = query.lastIndexOf('/')
  if (query === '' || slash >= 0) {
    const directory = slash >= 0 ? query.slice(0, slash) : ''
    const fragment = slash >= 0 ? query.slice(slash + 1) : ''
    return (await readDirectory(root, directory, fragment, new Set(config.excludedDirectories), signal)).slice(0, config.maxResults)
  }
  const excluded = new Set(config.excludedDirectories)
  const queue = [{ absolute: resolve(root), display: '' }]
  const candidates = []
  while (queue.length > 0 && candidates.length < config.maxEntries) {
    signal.throwIfAborted()
    const current = queue.shift()
    let entries
    try { entries = await readdir(current.absolute, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      signal.throwIfAborted()
      if (entry.isDirectory() && excluded.has(entry.name)) continue
      if (!entry.isDirectory() && !entry.isFile()) continue
      const path = current.display ? `${current.display}/${entry.name}` : entry.name
      const candidate = { path, kind: entry.isDirectory() ? 'directory' : 'file' }
      candidates.push(candidate)
      if (entry.isDirectory()) queue.push({ absolute: join(current.absolute, entry.name), display: path })
      if (candidates.length >= config.maxEntries) break
    }
  }
  return rankCandidates(candidates, query, config.maxResults)
}

export default class EverythingFileReferenceProvider {
  static inject = ['agents', 'settings', 'webServer', 'loader']

  constructor(ctx, config = {}) {
    this.ctx = ctx
    this.baseConfig = {
      maxResults: Number.isSafeInteger(config.maxResults) ? config.maxResults : 20,
      maxEntries: Number.isSafeInteger(config.maxEntries) ? config.maxEntries : 50_000,
      excludedDirectories: parseIgnoreDirs(config.excludedDirectories ?? DEFAULT_EXCLUDED),
      everythingUrl: String(config.everythingUrl ?? DEFAULT_EVERYTHING_URL).trim(),
    }
    this.settingsScope = null
    ctx.provide('fileReferences', this)
    this.settingsReady = this.initSettings()
    this.installPromptHandlers()
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/quick-file', handler: (req, res) => this.handleConfig(req, res) }), 'quick-file: configuration route')
  }

  async initSettings() {
    try {
      const mod = await this.ctx.loader.import('@deepseek-ai/schemastery')
      const z = mod?.default || mod
      this.settingsScope = this.ctx.settings.register(NS, z.object({
        maxResults: z.number().step(1).min(1).max(200).default(this.baseConfig.maxResults),
        maxEntries: z.number().step(1).min(1).max(200_000).default(this.baseConfig.maxEntries),
        everythingUrl: z.string().default(this.baseConfig.everythingUrl),
        excludedDirectories: z.string().default(this.baseConfig.excludedDirectories.join(',')),
      }))
    } catch (error) {
      this.ctx.logger?.warn?.(`[quick-file] settings registration failed: ${String(error?.message || error)}`)
    }
  }

  installPromptHandlers() {
    const fibers = new Map()
    const install = (agent) => {
      if (fibers.has(agent)) return
      const fiber = agent.ctx.inject(['systemPrompt', 'tools'], (scope) => {
        scope.systemPrompt.section({
          name: 'context:file-reference',
          order: scope.systemPrompt.getSectionOrder('FILE_REFERENCE'),
          text: () => agent.ctx.tools.get('read', agent) === undefined ? '' : FILE_REFERENCE_PROMPT,
        })
      })
      fibers.set(agent, fiber)
    }
    for (const agent of this.ctx.agents.list()) install(agent)
    this.ctx.on('agent/created', ({ agent }) => install(agent))
    this.ctx.on('agent/disposed', ({ agent }) => {
      const fiber = fibers.get(agent)
      fibers.delete(agent)
      void fiber?.dispose()
    })
    this.ctx.effect(() => async () => {
      await Promise.all([...fibers.values()].map((fiber) => fiber.dispose()))
      fibers.clear()
    }, 'quick-file: file-reference prompt')
  }

  currentConfig() {
    const config = { ...this.baseConfig }
    try {
      const value = this.settingsScope?.get()
      if (value) {
        if (Number.isSafeInteger(value.maxResults)) config.maxResults = value.maxResults
        if (Number.isSafeInteger(value.maxEntries)) config.maxEntries = value.maxEntries
        if (typeof value.everythingUrl === 'string') config.everythingUrl = value.everythingUrl.trim()
        if (typeof value.excludedDirectories === 'string') config.excludedDirectories = parseIgnoreDirs(value.excludedDirectories)
      }
    } catch {}
    config.excludedDirectories = parseIgnoreDirs(config.excludedDirectories)
    return config
  }

  async list(agent, query, signal) {
    const config = this.currentConfig()
    const root = agent.session.header.cwd || process.cwd()
    const rawQuery = String(query || '').replace(/\\/g, '/')
    if (config.everythingUrl && rawQuery !== '') {
      const result = await this.listViaEverything(root, rawQuery, config, signal)
      if (result !== null) return result
    }
    return fallbackList(root, rawQuery, config, signal)
  }

  async listViaEverything(root, query, config, signal) {
    const slash = query.lastIndexOf('/')
    const directory = slash >= 0 ? query.slice(0, slash).replace(/\/+$/, '') : ''
    const fragment = slash >= 0 ? query.slice(slash + 1) : query
    const searchRoot = directory ? resolve(root, ...directory.split('/').filter(Boolean)) : resolve(root)
    if (!pathInside(root, searchRoot)) return []
    const terms = [fragment || '*', `path:${searchRoot}`]
    for (const excluded of config.excludedDirectories) terms.push(`!${excluded}\\`)
    const count = Math.min(Math.max(config.maxResults * 4, 50), 500)
    const href = `${config.everythingUrl}/?search=${encodeURIComponent(terms.join(' '))}&count=${count}&j=1&path_column=1&sort=path&ascending=1`
    let data
    try { data = await httpGetJson(href, signal) } catch (error) {
      this.ctx.logger?.debug?.(`[quick-file] Everything unavailable, falling back to local search: ${String(error?.message || error)}`)
      return null
    }
    const out = []
    const seen = new Set()
    for (const result of Array.isArray(data?.results) ? data.results : []) {
      const candidate = candidateFromResult(root, result)
      if (!candidate || seen.has(candidate.path) || !visible(candidate, query)) continue
      if (config.excludedDirectories.some((name) => candidate.path.split('/').includes(name))) continue
      if (slash >= 0 && !directChildOf(candidate.path, directory)) continue
      if (slash >= 0 && fragment && !candidate.path.slice(candidate.path.lastIndexOf('/') + 1).toLowerCase().includes(fragment.toLowerCase())) continue
      seen.add(candidate.path)
      out.push(candidate)
      if (out.length >= config.maxResults) break
    }
    return out
  }

  async handleConfig(req, res) {
    const write = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    const pathname = new URL(req.url || '/', 'http://dsh.internal').pathname
    if (pathname !== '/quick-file/config') { write(404, { ok: false, error: 'Not found' }); return }
    if (req.method === 'GET') {
      const config = this.currentConfig()
      write(200, { ...config, excludedDirectories: config.excludedDirectories.join(',') })
      return
    }
    if (req.method !== 'POST') { write(405, { ok: false, error: 'Method not allowed' }); return }
    await this.settingsReady
    let data = ''
    for await (const chunk of req) {
      data += String(chunk)
      if (data.length > MAX_BODY_BYTES) { write(413, { ok: false, error: 'Request body too large' }); return }
    }
    let body
    try { body = data.trim() ? JSON.parse(data) : {} } catch { write(400, { ok: false, error: 'Invalid JSON' }); return }
    const current = this.currentConfig()
    const next = { ...current }
    if (body.maxResults !== undefined) {
      next.maxResults = Number(body.maxResults)
      if (!Number.isSafeInteger(next.maxResults) || next.maxResults < 1 || next.maxResults > 200) { write(400, { ok: false, error: 'maxResults must be 1-200' }); return }
    }
    if (body.maxEntries !== undefined) {
      next.maxEntries = Number(body.maxEntries)
      if (!Number.isSafeInteger(next.maxEntries) || next.maxEntries < 1 || next.maxEntries > 200_000) { write(400, { ok: false, error: 'maxEntries must be 1-200000' }); return }
    }
    if (body.everythingUrl !== undefined) {
      try { next.everythingUrl = validEverythingUrl(body.everythingUrl) } catch { write(400, { ok: false, error: 'everythingUrl must be an http(s) URL' }); return }
    }
    if (body.excludedDirectories !== undefined) {
      next.excludedDirectories = parseIgnoreDirs(body.excludedDirectories)
      if (next.excludedDirectories.some((name) => name.includes('/') || name.includes('\\'))) { write(400, { ok: false, error: 'excludedDirectories must contain directory basenames' }); return }
    }
    try {
      if (this.settingsScope) await this.settingsScope.update({
        maxResults: next.maxResults,
        maxEntries: next.maxEntries,
        everythingUrl: next.everythingUrl,
        excludedDirectories: next.excludedDirectories.join(','),
      })
      else this.baseConfig = next
      const result = this.currentConfig()
      write(200, { ok: true, ...result, excludedDirectories: result.excludedDirectories.join(',') })
    } catch (error) {
      write(500, { ok: false, error: String(error?.message || error) })
    }
  }
}

export { candidateFromResult, fallbackList, parseIgnoreDirs }
