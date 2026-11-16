// ═══════════════════════════════════════════════════════════════════════════
// dsh-ark-quota-guard — Host 半侧（ESM 模块，由 cordis loader 挂载）
//
// 解决一件事：火山方舟（Coding Plan / Agent Plan）额度撞满后，任务不要「死」在
// 429 上，而是**挂起 → 到重置时刻 + 10 秒冗余 → 自动续跑**。
//
// 时序：
//   1. `agent/request-error` 瀑布里看到 QUOTA / ACCOUNT_QUOTA / RATE_LIMIT（或 429）
//   2. 算「什么时候重置」：
//        a. 优先解析 429 文案里自带的重置时刻（"It will reset at ..." / "您的限额将在 ... 重置"）
//        b. 文案里没有就查管控面 GetCodingPlanUsage / GetAFPUsage（AK/SK 签名 V4）
//   3. 离重置还很久（> minParkMs）→ 把会话记进挂起表（落盘），**让本轮正常结束**
//   4. 定时器在 `重置时刻 + resumeBufferMs`（默认 10 秒）触发
//   5. 触发时再查一次额度：还没恢复就重新排期，恢复了就 `agent.followup()` 续跑
//
// 为什么「让本轮结束」而不是返回 `{ kind: 'retry' }`：额度窗口动辄几小时，
// 一直吊着一个 turn 会把 agent 卡在 running；挂起 + followup 才是 DSH 的常规姿势
// （参考 dsh-llm-retry「先持久、后等待」的思路，但等待跨越 turn 边界）。
//
// 配置落在 <DSH_HOME>/ark-quota-guard.json，挂起表落在
// <DSH_HOME>/ark-quota-guard.state.json —— 不用 `ctx.settings.register`，
// 因为 DSH 0.2.x 的 settings 服务没有 register（本仓库 dsh-win-notify 踩过同一个坑）。
// ═══════════════════════════════════════════════════════════════════════════
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { DEFAULTS, normalizeConfig, resolveCredentials } from './lib/config.js'
import {
  computeResumeAt,
  isQuotaRecovered,
  pickResetWindow,
  providerMatches,
  isQuotaFailure,
  shouldPark,
} from './lib/guard.js'
import { formatCountdown, formatLocalTime, parseResetTimeMs } from './lib/reset.js'
import { fetchArkQuota } from './lib/volc.js'

export const name = 'ark-quota-guard'
/** agents 是核心服务；commands 可选，用 ctx.get 兜。 */
export const inject = ['agents']

const log = (...args) => console.log('[ark-quota-guard]', ...args)

const homeDir = () => process.env.DSH_HOME || join(homedir(), '.dsh')
const configFile = () => join(homeDir(), 'ark-quota-guard.json')
const stateFile = () => join(homeDir(), 'ark-quota-guard.state.json')

/** 原子写 JSON；失败只记日志，绝不打断主流程。 */
function writeJsonAtomic(file, value) {
  try {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    renameSync(tmp, file)
    return true
  } catch (error) {
    log('写文件失败:', file, String((error && error.message) || error))
    return false
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      log('读文件失败:', file, String((error && error.message) || error))
    }
    return null
  }
}

/** 挂起记录 → 可读一行（日志 / 命令输出共用）。 */
function describeRecord(record, now = Date.now()) {
  const resetText = formatLocalTime(record.resetAtMs)
  const resumeText = formatLocalTime(record.resumeAt)
  return (
    `会话 ${record.sessionId}｜重置 ${resetText}｜续跑 ${resumeText}（${formatCountdown(record.resumeAt, now)}）` +
    `｜来源 ${record.source}`
  )
}

/** 窗口数组 → 可读多行（/ark-quota test 用）。 */
function describeWindows(windows) {
  if (!Array.isArray(windows) || windows.length === 0) return '（没有活跃的用量窗口）'
  return windows
    .map((window) => {
      const percent = Number.isFinite(window.percent) ? `${window.percent.toFixed(2)}%` : '—'
      const reset = window.resetAtMs
        ? `${formatLocalTime(window.resetAtMs)}（${formatCountdown(window.resetAtMs)}）`
        : '无重置时间'
      return `· ${window.level}：已用 ${percent}｜重置 ${reset}`
    })
    .join('\n')
}

export function apply(ctx, rowConfig = {}) {
  // ── 配置：文件 > patch 行 > 默认值 ────────────────────────────────────
  let config = normalizeConfig({ ...normalizeConfig(rowConfig), ...(readJson(configFile()) || {}) })
  if (!readJson(configFile())) writeJsonAtomic(configFile(), { version: 1, ...config })

  const saveConfig = () => writeJsonAtomic(configFile(), { version: 1, ...config })
  const reloadConfig = () => {
    config = normalizeConfig({ ...config, ...(readJson(configFile()) || {}) })
    return config
  }

  /** sessionId → 挂起记录 */
  const parked = new Map()
  /** sessionId → setTimeout 句柄 */
  const timers = new Map()
  /** 重启后 resume 出来的 AgentHandle，卸载时统一 dispose */
  const handles = new Map()

  const persistState = () =>
    writeJsonAtomic(stateFile(), {
      version: 1,
      parked: [...parked.values()],
    })

  function clearTimer(sessionId) {
    const timer = timers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      timers.delete(sessionId)
    }
  }

  function drop(sessionId) {
    clearTimer(sessionId)
    parked.delete(sessionId)
    persistState()
  }

  // ── 定时器 ────────────────────────────────────────────────────────────
  function schedule(sessionId) {
    clearTimer(sessionId)
    const record = parked.get(sessionId)
    if (!record) return
    const delay = Math.max(0, record.resumeAt - Date.now())
    const timer = setTimeout(() => {
      timers.delete(sessionId)
      void tick(sessionId)
    }, delay)
    if (typeof timer.unref === 'function') timer.unref()
    timers.set(sessionId, timer)
  }

  // ── 重置时刻解析 ──────────────────────────────────────────────────────
  /**
   * 算「什么时候重置」：先文案、后接口。
   * 接口能连上但没有任何未来重置窗口时返回 null（说明额度看着是好的，
   * 这次 429 交给普通重试，不挂起）。
   */
  async function resolveResetAt({ failure, now }) {
    const { accessKey, secretKey } = resolveCredentials(config)
    if (accessKey && secretKey && config.plan !== 'off') {
      const result = await fetchArkQuota({
        accessKey,
        secretKey,
        plan: config.plan,
        timeoutMs: config.requestTimeoutMs,
      })
      if (result.ok) {
        const window = pickResetWindow(result.windows, {
          exhaustedPercent: config.exhaustedPercent,
          now,
        })
        if (window) {
          return { atMs: window.resetAtMs, source: `api:${result.plan}:${window.level}`, plan: result.plan }
        }
        log('管控面显示没有未来重置窗口，本次交给普通重试')
        return null
      }
      log('额度查询失败，回退错误文案解析:', result.message)
    }

    const fromMessage = parseResetTimeMs(failure?.message, config.defaultOffsetMinutes)
    if (Number.isFinite(fromMessage) && fromMessage > now) {
      return { atMs: fromMessage, source: 'message' }
    }
    return null
  }

  // ── 续跑 ──────────────────────────────────────────────────────────────
  async function resumeSession(record) {
    const sessionId = record.sessionId
    let agent = ctx.agents.get(sessionId)
    if (!agent) {
      if (!config.resumeAfterRestart) throw new Error('会话已不在线（resumeAfterRestart 关闭）')
      const handle = await ctx.agents.resume({ resumeSessionId: sessionId })
      handles.set(sessionId, handle)
      agent = handle.agent
    }
    agent.followup({
      content: [{ type: 'text', text: config.resumeMessage }],
      source: { kind: 'ark-quota-guard' },
    })
    drop(sessionId)
    log(
      `会话 ${sessionId} 已自动续跑（重置 ${formatLocalTime(record.resetAtMs)} + ${config.resumeBufferMs}ms 冗余）`,
    )
  }

  /** 定时器触发：先复核额度，恢复就续跑，没恢复就重新排期。 */
  async function tick(sessionId) {
    const record = parked.get(sessionId)
    if (!record) return
    record.attempts = Number(record.attempts || 0) + 1
    const now = Date.now()

    try {
      let recovered = true
      if (config.verifyBeforeResume) {
        const { accessKey, secretKey } = resolveCredentials(config)
        if (accessKey && secretKey) {
          const result = await fetchArkQuota({
            accessKey,
            secretKey,
            plan: config.plan,
            timeoutMs: config.requestTimeoutMs,
          })
          if (result.ok) {
            recovered = isQuotaRecovered(result.windows, {
              exhaustedPercent: config.exhaustedPercent,
              now,
            })
          } else {
            log('续跑前额度复核失败，按已恢复处理:', result.message)
          }
        }
      }

      if (!recovered) {
        const next = await resolveResetAt({ failure: { message: '' }, now })
        record.resumeAt = next
          ? computeResumeAt({ resetAtMs: next.atMs, now, bufferMs: config.resumeBufferMs })
          : now + config.recheckMs
        record.source = next ? next.source : 'recheck'
        persistState()
        schedule(sessionId)
        log(`额度尚未恢复（第 ${record.attempts} 次），改到 ${formatLocalTime(record.resumeAt)} 再试`)
        return
      }

      await resumeSession(record)
    } catch (error) {
      log('续跑失败，稍后重试:', String((error && error.message) || error))
      record.resumeAt = Date.now() + config.recheckMs
      persistState()
      schedule(sessionId)
    }
  }

  // ── 核心：429 拦截 ────────────────────────────────────────────────────
  ctx.on('agent/request-error', async (payload, next) => {
    try {
      const { agent, provider, failure } = payload || {}
      if (!config.enabled) return next()
      if (!isQuotaFailure(failure)) return next()

      const sessionId = String((agent && agent.session && agent.session.id) || '')
      if (!sessionId) return next()
      if (!providerMatches(provider, config.providerPattern)) return next()
      if (parked.has(sessionId)) {
        // 已经挂起了：让这次失败保持终态，不再往下游重试
        log(`会话 ${sessionId} 已在挂起队列（${describeRecord(parked.get(sessionId))}），忽略重复失败`)
        return undefined
      }

      const now = Date.now()
      const reset = await resolveResetAt({ failure, now })
      const decision = shouldPark({
        failure,
        provider,
        providerPattern: config.providerPattern,
        now,
        minParkMs: config.minParkMs,
        alreadyParked: false,
        resetAtMs: reset ? reset.atMs : null,
      })
      if (!decision.park) {
        log(`不挂起（${decision.reason}），交给普通重试`)
        return next()
      }

      const resumeAt = computeResumeAt({
        resetAtMs: reset.atMs,
        now,
        bufferMs: config.resumeBufferMs,
      })
      const record = {
        sessionId,
        provider: String(provider ?? ''),
        resetAtMs: reset.atMs,
        resumeAt,
        source: reset.source,
        attempts: 0,
        parkedAt: now,
      }
      parked.set(sessionId, record)
      persistState()
      schedule(sessionId)
      log(`挂起：${describeRecord(record, now)}`)

      // 保持失败终态（不调 next），让本轮结束；到点由 followup 重新拉起
      return undefined
    } catch (error) {
      log('request-error 处理异常，交回下游:', String((error && error.message) || error))
      return next()
    }
  })

  // ── /ark-quota 斜杠命令 ────────────────────────────────────────────────
  const commands = (() => {
    try {
      return ctx.get('commands')
    } catch {
      return undefined
    }
  })()

  if (commands && typeof commands.register === 'function') {
    ctx.effect(() =>
      commands.register({
        name: 'ark-quota',
        description:
          '火山方舟额度守护：查看/开关挂起与自动续跑（status | on | off | test | now）',
        input: { hint: '[status|on|off|test|now]' },
        handler: async ({ agent, rawInput }) => {
          const action = String(rawInput || '').trim().toLowerCase() || 'status'
          const now = Date.now()

          if (action === 'on' || action === 'off') {
            config = { ...config, enabled: action === 'on' }
            saveConfig()
            return { kind: 'success', text: `额度守护已${config.enabled ? '开启' : '关闭'}` }
          }

          if (action === 'test') {
            const creds = resolveCredentials(config)
            if (!creds.accessKey || !creds.secretKey) {
              return {
                kind: 'error',
                text: `未配置 AK/SK。请在 ${configFile()} 里填 accessKey / secretKey，或设置环境变量 VOLC_ACCESS_KEY / VOLC_SECRET_KEY。`,
              }
            }
            const result = await fetchArkQuota({
              ...creds,
              plan: config.plan,
              timeoutMs: config.requestTimeoutMs,
            })
            if (!result.ok) return { kind: 'error', text: `额度查询失败：${result.message}` }
            return {
              kind: 'success',
              text: `套餐 ${result.plan.toUpperCase()}${result.planType ? `（${result.planType}）` : ''}\n${describeWindows(result.windows)}`,
            }
          }

          if (action === 'now') {
            const sessionId = String((agent && agent.session && agent.session.id) || '')
            const record = parked.get(sessionId)
            if (!record) return { kind: 'success', text: '当前会话没有挂起记录' }
            clearTimer(sessionId)
            try {
              await resumeSession(record)
              return { kind: 'success', text: '已立即续跑当前会话' }
            } catch (error) {
              parked.set(sessionId, record)
              schedule(sessionId)
              return { kind: 'error', text: `续跑失败：${String((error && error.message) || error)}` }
            }
          }

          if (action !== 'status') {
            return { kind: 'error', text: `未知子命令 ${action}；可用：status | on | off | test | now` }
          }

          const lines = [
            `额度守护：${config.enabled ? '开启' : '关闭'}`,
            `provider 匹配：${config.providerPattern || '（全部）'}`,
            `套餐：${config.plan}｜冗余：${config.resumeBufferMs}ms｜最短挂起：${config.minParkMs}ms`,
            `配置文件：${configFile()}`,
            `挂起中：${parked.size} 个`,
          ]
          for (const record of parked.values()) lines.push(`· ${describeRecord(record, now)}`)
          return { kind: 'success', text: lines.join('\n') }
        },
      }),
    )
  } else {
    log('commands 服务不在场，/ark-quota 未注册（挂起与自动续跑不受影响）')
  }

  // ── 启动恢复：把落盘的挂起表接回来 ────────────────────────────────────
  const saved = readJson(stateFile())
  const savedParked = Array.isArray(saved && saved.parked) ? saved.parked : []
  for (const record of savedParked) {
    if (!record || typeof record.sessionId !== 'string' || !record.sessionId) continue
    if (!Number.isFinite(record.resumeAt) || !Number.isFinite(record.resetAtMs)) continue
    parked.set(record.sessionId, { ...record, attempts: Number(record.attempts || 0) })
  }
  if (parked.size) {
    log(`已恢复 ${parked.size} 条挂起记录`)
    // 等宿主把 sessionPersistence / agent 注册好再动手
    const settle = setTimeout(() => {
      for (const record of [...parked.values()]) {
        if (record.resumeAt <= Date.now()) void tick(record.sessionId)
        else schedule(record.sessionId)
      }
    }, 3000)
    if (typeof settle.unref === 'function') settle.unref()
    ctx.effect(() => () => clearTimeout(settle), 'ark-quota-guard: startup restore')
  }

  // ── 卸载清理 ──────────────────────────────────────────────────────────
  ctx.effect(
    () => () => {
      for (const sessionId of [...timers.keys()]) clearTimer(sessionId)
      for (const [sessionId, handle] of handles) {
        handles.delete(sessionId)
        Promise.resolve()
          .then(() => handle.dispose())
          .catch((error) => log('dispose 会话失败:', sessionId, String((error && error.message) || error)))
      }
    },
    'ark-quota-guard: timers and handles',
  )

  log(
    `已加载。配置：${configFile()}｜provider=${config.providerPattern || '（全部）'}｜冗余=${config.resumeBufferMs}ms｜默认值键=${Object.keys(DEFAULTS).length}`,
  )
}
