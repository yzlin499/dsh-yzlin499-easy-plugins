// ═══════════════════════════════════════════════════════════════════════════
// dsh-oc-usage — Host 半侧（ESM 模块，由 cordis loader 挂载）
//
// 数据源移植自 YZL Dashboard `src-tauri/src/usage.rs`：
//   GET https://opencode.ai/_server  （server-fn grid 序列化文本，非 JSON）
//   返回 rollingUsage(5h) / weeklyUsage(7d) / monthlyUsage(30d) 的
//   usagePercent + resetInSec，用正则解析。
//
// 用 Node 全局 fetch 直连 opencode.ai（Node >= 18），不走 shell/curl，
// 因此不涉及会话沙箱策略。Cookie 只保存在本模块进程内存，不落盘、不回显。
//
// 注册 webServer 路由（与 DSH 页面同源，Client 用 fetch 调用）：
//   GET  /oc-usage/query      -> { isValid, workspaceId, rolling, weekly, monthly, updatedAt, message? }
//   GET  /oc-usage/config-get -> { cookieSet, workspaceId }
//   POST /oc-usage/config-set -> { cookie?, workspaceId? }  部分更新
// ═══════════════════════════════════════════════════════════════════════════
export const name = 'oc-usage'
export const inject = ['webServer', 'loader', 'settings']

const BASE = 'https://opencode.ai'
const REF_FALLBACK = 'c7389bd0e731f80f49593e5ee53835475f4e28594dd6bd83eb229bab753498cd'

/** opencode.ai 反爬头（Cookie 单独传） */
function opencodeHeaders(cookie, extra = {}) {
  return {
    Origin: BASE,
    Referer: BASE + '/go',
    'User-Agent': 'Mozilla/5.0',
    Accept: 'application/json, text/plain, */*',
    ...(cookie ? { Cookie: cookie } : {}),
    ...extra,
  }
}

/** 解析 server-fn 序列化文本（移植 usage.rs parse_usage_response） */
function parseUsage(text) {
  const win = { rolling: {}, weekly: {}, monthly: {} }
  const winRe = /(rollingUsage|weeklyUsage|monthlyUsage)\s*:\s*\$R\[\d+\]\s*=\s*\{(.*?)\}/g
  const fieldRe = /(status|resetInSec|usagePercent)\s*:\s*("[^"]*"|'[^']*'|-?\d+(?:\.\d+)?)/g
  let m
  while ((m = winRe.exec(text)) !== null) {
    const key = m[1] === 'rollingUsage' ? 'rolling' : m[1] === 'weeklyUsage' ? 'weekly' : 'monthly'
    const body = m[2]
    let f
    while ((f = fieldRe.exec(body)) !== null) {
      const n = Number(f[2])
      if (Number.isFinite(n)) {
        if (f[1] === 'usagePercent') win[key].usagePercent = n
        else if (f[1] === 'resetInSec') win[key].resetInSec = n
      }
    }
  }
  const has = ['rolling', 'weekly', 'monthly'].some(
    (k) => win[k].usagePercent != null || win[k].resetInSec != null,
  )
  return { rolling: win.rolling, weekly: win.weekly, monthly: win.monthly, has }
}

export async function apply(ctx) {
  // ── Cookie 只存进程内存（红线，不落盘、不回显）；workspaceId 走官方 settings 持久化 ──
  let state = { cookie: '' }
  let wsScope = null
  let memWorkspaceId = ''
  try {
    const mod = await ctx.loader.import('@deepseek-ai/schemastery')
    const z = mod && mod.default ? mod.default : mod
    wsScope = ctx.settings.register('dsh-oc-usage', z.object({
      workspaceId: z.string(),
    }))
  } catch (e) {
    log('settings 注册失败，workspaceId 回退内存态:', String((e && e.message) || e))
  }
  const readWorkspaceId = () => {
    if (wsScope) {
      try {
        const v = wsScope.get()
        if (v && v.workspaceId != null) return String(v.workspaceId)
      } catch {}
    }
    return memWorkspaceId
  }

  const log = (...args) => console.log('[oc-usage]', ...args)

  async function queryServer(cookie, workspaceId, refId) {
    const args = JSON.stringify({
      t: { t: 9, i: 0, l: 1, a: [{ t: 1, s: workspaceId }], o: 0 },
      f: 31,
      m: [],
    })
    const qs = new URLSearchParams({ id: refId, args })
    const resp = await fetch(BASE + '/_server?' + qs.toString(), {
      redirect: 'follow',
      headers: opencodeHeaders(cookie, {
        'X-Server-Id': refId,
        'X-Server-Instance': 'server-fn:3',
      }),
    })
    return resp.text()
  }

  /** 从 /auth 重定向头/响应体自动发现 wrk_ workspace id */
  async function discoverWorkspace(cookie) {
    const resp = await fetch(BASE + '/auth', {
      redirect: 'manual',
      headers: opencodeHeaders(cookie),
    })
    const loc = resp.headers.get('location') || ''
    const body = await resp.text()
    const m = /wrk_[A-Za-z0-9]+/.exec(loc + '\n' + body)
    return m ? m[0] : null
  }

  /** 登录探针：跟随重定向后落在 auth 域名说明 Cookie 失效 */
  async function loginProbe(cookie) {
    const resp = await fetch(BASE, { redirect: 'follow', headers: opencodeHeaders(cookie) })
    const url = resp.url || ''
    return url.includes('auth.opencode.ai') || url.includes('/auth')
  }

  /** 从 /go 页面 JS bundle 解析最新 server reference id */
  async function resolveRefId(cookie) {
    const page = await (await fetch(BASE + '/go', { headers: opencodeHeaders(cookie) })).text()
    const m = /\/_build\/assets\/index-[^"?]+\.js/.exec(page)
    if (!m) return null
    const js = await (await fetch(BASE + m[0], { headers: opencodeHeaders(cookie) })).text()
    const rm = /queryLiteSubscription_query\s*=\s*createServerReference\(\s*["']([0-9a-f]{64})["']/i.exec(js)
    return rm ? rm[1] : null
  }

  /** 完整查询流程（等价 usage.rs query_opencode_go） */
  async function queryUsage() {
    log('query start (cookieSet=' + !!state.cookie + ', workspaceId=' + (readWorkspaceId() || '(auto)') + ')')
    const cookie = state.cookie.trim().replace(/^Cookie:\s*/i, '')
    if (!cookie || !/auth=/i.test(cookie)) {
      log('rejected: cookie missing auth=')
      return { isValid: false, message: 'Cookie 缺少 auth 字段（请粘贴 opencode.ai 登录后的完整 Cookie 头）' }
    }

    let workspaceId = readWorkspaceId().trim()
    if (!workspaceId) {
      const w = await discoverWorkspace(cookie)
      log('workspace discover ->', w || '(none)')
      if (!w) return { isValid: false, message: '无法自动获取 Workspace ID，请在配置中手动填写（wrk_ 开头）' }
      workspaceId = w
    }

    if (await loginProbe(cookie)) {
      log('login probe failed (cookie expired)')
      return { isValid: false, workspaceId, message: 'OpenCode 登录态已失效，请重新粘贴 Cookie' }
    }

    // a. 硬编码回退 id
    let parsed = parseUsage(await queryServer(cookie, workspaceId, REF_FALLBACK))
    log('fallback ref parse hasData=' + parsed.has)
    // b. 无数据 → 从 /go JS bundle 解析最新 id 重试
    if (!parsed.has) {
      const ref = await resolveRefId(cookie)
      log('resolved latest ref ->', ref || '(none)')
      if (!ref) return { isValid: false, workspaceId, message: '无法解析用量接口 server id（OpenCode 前端可能已更新）' }
      parsed = parseUsage(await queryServer(cookie, workspaceId, ref))
    }
    if (!parsed.has) {
      return { isValid: false, workspaceId, message: 'OpenCode 用量接口未返回预期数据（Cookie / Workspace 可能不对）' }
    }

    const result = {
      isValid: true,
      workspaceId,
      rolling: parsed.rolling,
      weekly: parsed.weekly,
      monthly: parsed.monthly,
      updatedAt: Date.now(),
    }
    log('query ok:', JSON.stringify(result))
    return result
  }

  // ── HTTP 路由助手 ──
  const sendJson = (res, obj, status = 200) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(obj))
  }
  const readBody = (req) => new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => { data += c })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) } catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })

  // ── 注册 /oc-usage/* 路由（随插件卸载自动清理）──
  ctx.webServer.register({
    kind: 'prefix',
    path: '/oc-usage',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost')
        const p = url.pathname
        if (p === '/oc-usage/query' && req.method === 'GET') {
          sendJson(res, await queryUsage())
          return
        }
        if (p === '/oc-usage/config-get' && req.method === 'GET') {
          sendJson(res, { cookieSet: !!state.cookie, workspaceId: readWorkspaceId() })
          return
        }
        if (p === '/oc-usage/config-set' && req.method === 'POST') {
          const a = await readBody(req)
          // 部分更新：cookie 留空 = 不修改（不回显 Cookie，只存内存）
          if (typeof a.cookie === 'string' && a.cookie.trim()) state.cookie = a.cookie.trim()
          if (typeof a.workspaceId === 'string') {
            try {
              if (wsScope) await wsScope.update({ workspaceId: a.workspaceId.trim() })
              else memWorkspaceId = a.workspaceId.trim()
            } catch (e) {
              log('workspaceId 保存失败:', String((e && e.message) || e))
              sendJson(res, { ok: false, error: 'workspaceId 保存失败' }, 500)
              return
            }
          }
          sendJson(res, { ok: true })
          return
        }
        sendJson(res, { ok: false, error: 'not-found' }, 404)
      } catch (e) {
        console.error('[oc-usage] route threw:', e)
        sendJson(res, { ok: false, error: String((e && e.message) || e) }, 500)
      }
    },
  })
}
