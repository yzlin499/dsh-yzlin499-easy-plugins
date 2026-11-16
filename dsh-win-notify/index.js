// ═══════════════════════════════════════════════════════════════════════════
// dsh-win-notify — Host 半侧（ESM 模块，由 cordis loader 挂载）
//
// 在 DSH 宿主进程里监听三类时机，弹 Windows 原生吐司（toast.ps1 + WinRT）：
//   1. 权限申请   —— session/event 里 event.type === 'approval/asked'
//                    （dsh-user-approval 在询问决策时立即追加，含 toolName/reason）
//   2. 发起提问   —— session/event 里 event.type === 'tool/call' 且
//                    data.name === 'ask_user_question'（dsh-agent-loop 在派发
//                    开始时追加，arguments 是 JSON，含问题文本）
//   3. 运行停止   —— agent/status 变为 'idle'（驱动完全退出 = 运行停止）。
//                    回合结束原因（completed/error/aborted/...）由 session/event
//                    的 turn/end 记录并随吐司显示；多轮 goal 循环只在最终 idle
//                    弹一次，不会每回合刷屏。
//
// 过滤：子代理会话（header.origin === 'subagent' 或存在 parentSession）不提示，
// 避免子任务刷屏。
//
// 通知策略（设置持久化到 <DSH_HOME>/win-notify.json，默认 ~/.dsh/win-notify.json）：
//   enabled 总开关；notifyApproval/notifyQuestion/notifyDone 三类分别开关；
//   mode 'always' 总是通知 / 'background' 仅当页面在后台时通知
//   （页面可见性由 Client 半侧经 /win-notify/visibility 上报，浏览器
//    document.visibilityState 自动给出，无需鼠标检测）。
//
// 吐司执行：ctx.subprocess.spawn powershell.exe -File toast.ps1，
// 标题/正文 Base64 传入（避免引号/中文转义），fire-and-forget 不阻塞主流程。
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'win-notify'
export const inject = ['subprocess', 'webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
const TOAST_PS1 = join(HERE, 'toast.ps1')
const APP_ID = 'DSH.Notify'

const DEFAULTS = {
  enabled: true,
  notifyApproval: true,
  notifyQuestion: true,
  notifyDone: true,
  mode: 'always', // 'always' | 'background'
}

// ═══════════════════════════════════════════════════════════════════════════
// 持久化存储：<DSH_HOME>/win-notify.json（默认 ~/.dsh/win-notify.json）
//
// 不用 `ctx.settings`：DSH 0.2.x 的 settings 服务只有 describe/update/replace/mutate，
// **没有 register**，`ctx.settings.register(...)` 会抛 TypeError 被 catch 吞掉，
// 结果就是「改了开关、重启又回默认」。这里直接落 JSON 文件（原子写），
// 与 dsh-mcp-compat 用同一套做法。
// ═══════════════════════════════════════════════════════════════════════════
const storeFile = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'win-notify.json')
/** 把磁盘内容归一成合法配置（纯函数，便于单测；坏字段逐项回退默认值）。 */
const normalizeConfig = (raw) => {
  const base = { ...DEFAULTS }
  if (!raw || typeof raw !== 'object') return base
  for (const key of ['enabled', 'notifyApproval', 'notifyQuestion', 'notifyDone']) {
    if (typeof raw[key] === 'boolean') base[key] = raw[key]
  }
  if (raw.mode === 'always' || raw.mode === 'background') base.mode = raw.mode
  return base
}
/** 同类吐司最小间隔，防连发（例如同一瞬间多次审批） */
const DEBOUNCE_MS = 800
/** 吐司正文最大长度（超出截断） */
const MAX_BODY = 110

const log = (...a) => console.log('[win-notify]', ...a)

// 测试钩子：node 脚本可直接 import 本模块校验配置归一化
export { normalizeConfig }

/** 取路径最后一段（Windows 反斜杠 / 正斜杠都处理）作为会话名 */
function wsName(cwd) {
  if (!cwd) return '会话'
  const norm = String(cwd).replace(/\\/g, '/').replace(/\/+$/, '')
  return norm ? basename(norm) : '会话'
}

/** 截断到 MAX_BODY，中文按字符计 */
function clip(s, max = MAX_BODY) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

export async function apply(ctx) {
  // ── 持久化设置（自己的 JSON 文件；读写都在 Host 侧）──
  let config = { ...DEFAULTS }
  const persist = () => {
    try {
      const file = storeFile()
      const tmp = file + '.tmp'
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(tmp, JSON.stringify({ version: 1, ...config }, null, 2), 'utf8')
      renameSync(tmp, file)
    } catch (e) {
      log('保存设置失败:', String((e && e.message) || e))
    }
  }
  try {
    config = normalizeConfig(JSON.parse(readFileSync(storeFile(), 'utf8')))
    log('设置存储:', storeFile())
  } catch (e) {
    if (e && e.code !== 'ENOENT') log('读取设置失败，使用默认值:', String((e && e.message) || e))
  }

  const readConfig = () => ({ ...config })
  const writeConfig = (patch) => {
    Object.assign(config, patch)
    persist()
  }
  // 在系统文件管理器/默认编辑器里打开配置文件（Windows：cmd /c start）
  const openConfigFile = () => {
    const file = storeFile()
    persist() // 确保文件存在，否则「打开」会指向不存在的路径
    if (process.platform !== 'win32') return { ok: true, path: file }
    try {
      const child = spawn('cmd.exe', ['/c', 'start', '', file], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.unref()
      return { ok: true, path: file }
    } catch (e) {
      log('打开配置文件失败:', String((e && e.message) || e))
      return { ok: false, path: file, error: String((e && e.message) || e) }
    }
  }

  // ── 页面可见性（Client 上报；初始假设前台，避免误判后台）──
  let pageVisible = true

  // ── 最近一次各类型吐司时间（防抖）──
  const lastToastAt = { approval: 0, question: 0, done: 0 }
  // 各会话最近一次 turn/end 原因（供 idle 时随吐司显示）
  const lastReason = new Map()

  // ── 解析 powershell.exe 绝对路径（懒解析一次）──
  let powershellPath = 'powershell.exe'
  try {
    powershellPath = (await ctx.subprocess.resolveExecutable('powershell.exe')) || 'powershell.exe'
  } catch (e) {
    log('resolveExecutable(powershell.exe) 失败，用裸名:', String((e && e.message) || e))
  }

  /** 是否根会话（非子代理） */
  function isRootSession(session) {
    try {
      const h = session && session.header
      if (!h) return true
      if (h.origin === 'subagent' || h.parentSession) return false
    } catch (e) {
      log('isRootSession 异常:', String((e && e.message) || e))
    }
    return true
  }

  /** 按配置决定是否该弹某种吐司 */
  function shouldNotify(kind) {
    const cfg = readConfig()
    if (!cfg.enabled) return false
    if (kind === 'approval' && !cfg.notifyApproval) return false
    if (kind === 'question' && !cfg.notifyQuestion) return false
    if (kind === 'done' && !cfg.notifyDone) return false
    if (cfg.mode === 'background' && pageVisible) return false // 仅后台模式：前台不弹
    return true
  }

  /** 弹吐司（防抖 + fire-and-forget） */
  function showToast(kind, title, body) {
    if (!shouldNotify(kind)) return
    const now = Date.now()
    if (now - lastToastAt[kind] < DEBOUNCE_MS) return
    lastToastAt[kind] = now
    const t = clip(title, 60)
    const m = clip(body)
    try {
      const t64 = Buffer.from(t, 'utf8').toString('base64')
      const m64 = Buffer.from(m, 'utf8').toString('base64')
      const handle = ctx.subprocess.spawn({
        argv: [
          powershellPath,
          '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
          '-File', TOAST_PS1,
          '-Title64', t64,
          '-Message64', m64,
          '-AppId', APP_ID,
        ],
        cwd: HERE,
        stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
        graceMs: 15000,
      })
      if (handle && handle.done) handle.done.catch((e) => log('吐司进程失败:', String((e && e.message) || e)))
    } catch (e) {
      log('吐司 spawn 失败:', String((e && e.message) || e))
    }
  }

  // ── 时机 1 & 2 & turn/end 记录：统一从会话事件流取 ──
  ctx.on('session/event', (session, event) => {
    try {
      if (!session || !event || !event.data) return
      if (!isRootSession(session)) return
      const d = event.data
      if (event.type === 'approval/asked') {
        const toolName = typeof d.toolName === 'string' ? d.toolName : '工具'
        const reason = typeof d.reason === 'string' && d.reason ? d.reason : ''
        showToast('approval', `DSH · 需要你批准 ${toolName}`, reason ? `请求执行：${reason}` : '有一个权限申请等待处理')
      } else if (event.type === 'tool/call' && d.name === 'ask_user_question') {
        let question = '请回答'
        try {
          const args = typeof d.arguments === 'string' ? JSON.parse(d.arguments) : null
          const q = args && Array.isArray(args.questions) && args.questions[0]
          if (q && typeof q.question === 'string' && q.question) question = q.question
          else if (q && typeof q.question !== 'string' && q.question != null) question = String(q.question)
        } catch (e) { /* 解析失败用默认文案 */ }
        showToast('question', 'DSH · 需要你回答', question)
      } else if (event.type === 'turn/end') {
        const reason = d.reason && d.reason.kind ? d.reason.kind : 'completed'
        const error = d.reason && d.reason.error && d.reason.error.message ? String(d.reason.error.message) : ''
        lastReason.set(String(session.id), { kind: reason, error })
      }
    } catch (e) {
      log('session/event 处理异常:', String((e && e.message) || e))
    }
  })

  // ── 时机 3：运行停止（agent/status -> idle）──
  ctx.on('agent/status', ({ agent, status }) => {
    try {
      const session = agent && agent.session
      if (!session || !isRootSession(session)) return
      const sid = String(session.id)
      if (status === 'running') {
        lastReason.delete(sid) // 新一轮运行，清掉上一轮原因
      } else if (status === 'idle') {
        const rec = lastReason.get(sid)
        lastReason.delete(sid)
        const kind = rec && rec.kind ? rec.kind : 'completed'
        const ws = wsName(session.header && session.header.cwd)
        const err = rec && rec.error ? rec.error : ''
        let title = 'DSH · 运行完成'
        let body = `${ws} 会话已结束`
        if (kind === 'error') { title = 'DSH · 运行出错'; body = err ? `${ws}：${err}` : `${ws} 会话运行出错` }
        else if (kind === 'aborted' || kind === 'interrupted') { title = 'DSH · 运行已中止'; body = `${ws} 会话已中止` }
        else if (kind === 'blocked') { title = 'DSH · 运行受阻'; body = `${ws} 会话被阻塞，需要处理` }
        else if (kind === 'max-tokens') { title = 'DSH · 输出达上限'; body = `${ws} 会话输出达到长度上限` }
        showToast('done', title, body)
      }
    } catch (e) {
      log('agent/status 处理异常:', String((e && e.message) || e))
    }
  })

  // ── HTTP 路由（Client 配置卡片 + 页面可见性上报）──
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

  ctx.webServer.register({
    kind: 'prefix',
    path: '/win-notify',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost')
        const p = url.pathname
        if (p === '/win-notify/config' && req.method === 'GET') {
          sendJson(res, { ...readConfig(), pageVisible })
          return
        }
        if (p === '/win-notify/config' && req.method === 'POST') {
          const a = await readBody(req)
          const next = {}
          if (typeof a.enabled === 'boolean') next.enabled = a.enabled
          if (typeof a.notifyApproval === 'boolean') next.notifyApproval = a.notifyApproval
          if (typeof a.notifyQuestion === 'boolean') next.notifyQuestion = a.notifyQuestion
          if (typeof a.notifyDone === 'boolean') next.notifyDone = a.notifyDone
          if (a.mode === 'always' || a.mode === 'background') next.mode = a.mode
          try {
            writeConfig(next)
            sendJson(res, { ok: true, ...readConfig() })
          } catch (e) {
            log('配置保存失败:', String((e && e.message) || e))
            sendJson(res, { ok: false, error: '配置保存失败' }, 500)
          }
          return
        }
        if (p === '/win-notify/open-config' && req.method === 'POST') {
          // 设置卡片「打开配置文件」：在系统默认编辑器里打开存储文件，并回显路径
          const result = openConfigFile()
          sendJson(res, result, result.ok ? 200 : 500)
          return
        }
        if (p === '/win-notify/visibility' && req.method === 'POST') {
          const a = await readBody(req)
          if (typeof a.visible === 'boolean') pageVisible = a.visible
          sendJson(res, { ok: true, pageVisible })
          return
        }
        sendJson(res, { ok: false, error: 'not-found' }, 404)
      } catch (e) {
        console.error('[win-notify] route threw:', e)
        sendJson(res, { ok: false, error: String((e && e.message) || e) }, 500)
      }
    },
  })

  log('已加载。吐司脚本:', TOAST_PS1, '| powershell:', powershellPath)
}

