// ═══════════════════════════════════════════════════════════════════════════
// dsh-ark-quota-guard / lib/config.js — 配置默认值与归一化（纯函数，便于单测）
//
// 为什么不用 `ctx.settings.register`：DSH 0.2.x 的 settings 服务只有
// describe/update/replace/mutate，**没有 register**（与本仓库 dsh-win-notify /
// dsh-mcp-compat 同一个坑）。这里直接落 <DSH_HOME>/ark-quota-guard.json，
// 由 Host 侧读写，保证「改完重启还在」。
// ═══════════════════════════════════════════════════════════════════════════

/** 全部配置项及其默认值。 */
export const DEFAULTS = {
  /** 总开关：关掉后不再拦截、不再定时、不再续跑。 */
  enabled: true,
  /**
   * 只在 provider 名匹配该正则时才接管（大小写不敏感）。
   * 空字符串 = 接管所有 provider。
   */
  providerPattern: 'ark|volc|doubao|pi-ai',
  /** 查询哪套套餐：'auto' 先 Coding Plan 再 Agent Plan；也可固定 'cp' / 'ap'。 */
  plan: 'auto',
  /** 火山引擎访问密钥（AK/SK）。留空则回退环境变量。 */
  accessKey: '',
  secretKey: '',
  /** 额度重置后再等多久才续跑（默认 10 秒冗余，避开服务端重置延迟）。 */
  resumeBufferMs: 10000,
  /** 重置时间离现在不足这么久（毫秒）就交给普通重试，不挂起。 */
  minParkMs: 60000,
  /** 已用百分比达到该值即视为「该窗口已耗尽」。 */
  exhaustedPercent: 99.5,
  /** 错误消息里没带时区时，默认按东八区（方舟 cn-beijing）解释。 */
  defaultOffsetMinutes: 480,
  /** 续跑时注入给会话的提示词。 */
  resumeMessage: '额度已重置，请继续之前中断的任务。',
  /** 续跑前再查一次额度，确认真的恢复了。 */
  verifyBeforeResume: true,
  /** 两轮检查之间至少间隔多久（毫秒），避免死循环打接口。 */
  recheckMs: 60000,
  /** DSH 重启后，对已过重置时间的挂起会话尝试自动恢复。 */
  resumeAfterRestart: true,
  /** 单次管控面请求超时（毫秒）。 */
  requestTimeoutMs: 15000,
}

const BOOL_KEYS = ['enabled', 'verifyBeforeResume', 'resumeAfterRestart']
const NUM_KEYS = [
  'resumeBufferMs',
  'minParkMs',
  'defaultOffsetMinutes',
  'exhaustedPercent',
  'recheckMs',
  'requestTimeoutMs',
]
const STR_KEYS = ['providerPattern', 'accessKey', 'secretKey', 'resumeMessage']

/** 把任意输入归一成合法配置：坏字段逐项回退默认值，未知字段丢弃。 */
export function normalizeConfig(raw) {
  const base = { ...DEFAULTS }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base

  for (const key of BOOL_KEYS) {
    if (typeof raw[key] === 'boolean') base[key] = raw[key]
  }
  for (const key of STR_KEYS) {
    if (typeof raw[key] === 'string') base[key] = raw[key].trim()
  }
  for (const key of NUM_KEYS) {
    const value = raw[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) base[key] = value
  }
  if (raw.plan === 'cp' || raw.plan === 'ap' || raw.plan === 'auto') base.plan = raw.plan

  // 百分比收敛到 (0, 100]
  if (!(base.exhaustedPercent > 0 && base.exhaustedPercent <= 100)) {
    base.exhaustedPercent = DEFAULTS.exhaustedPercent
  }
  // 冗余不能是 0 以外的负值；recheck 至少 1 秒
  if (base.recheckMs < 1000) base.recheckMs = 1000
  return base
}

/** 从环境变量取 AK/SK（配置里留空时使用）。 */
export function credentialsFromEnv(env = process.env) {
  const pick = (...names) => {
    for (const name of names) {
      const value = env && env[name]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return ''
  }
  return {
    accessKey: pick('VOLC_ACCESS_KEY', 'ARK_ACCESS_KEY', 'VOLCENGINE_ACCESS_KEY'),
    secretKey: pick('VOLC_SECRET_KEY', 'ARK_SECRET_KEY', 'VOLCENGINE_SECRET_KEY'),
  }
}

/** 合并配置文件 > 环境变量，得到最终生效的凭据。 */
export function resolveCredentials(config, env = process.env) {
  const fromEnv = credentialsFromEnv(env)
  return {
    accessKey: config?.accessKey || fromEnv.accessKey,
    secretKey: config?.secretKey || fromEnv.secretKey,
  }
}
