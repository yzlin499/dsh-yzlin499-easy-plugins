// ═══════════════════════════════════════════════════════════════════════════
// dsh-recent-tps — Client 半侧（__ModuleLoader__ 静态格式，由 dsh-client-modules 提供）
//
// 一、为什么是「接管」而不是「旁挂」
//   输入框下方的会话统计面板（`conversation.composer.dock` 的 `activity` 条目）里
//   只有整段会话口径的四行：模型用时 / 工具调用用时 / 首 token 平均 / 输出速度。
//   面板内部没有任何插槽，官方也没有「加一行」的扩展点；官方文档给的唯一正规方式是
//   **同 id + 同 order 覆盖**：
//     “Another plugin replaces one control by registering the same id and the
//      same `order`; the dock orders rows by `order`, while a lower `priority`
//      picks the replacement.”
//   插槽实现按 `priority` 升序、再按 `order` 升序排序，然后按 id 去重取第一条 ——
//   于是 `{ id: 'activity', order: 0, priority: -1 }` 正好顶掉官方那条。
//
//   所以本插件把官方面板**原样重画一遍**（文案、结构、样式逐项对齐官方编译产物：
//   `.hNGZaa_*` / `.xXe6ja_*` 的等价物），只**多一行「最近 30 秒速度」**。
//   官方改面板时这里会滞后 —— 这是「面板里加东西」的固有代价，README 里写清楚了。
//
// 二、「最近 30 秒速度」怎么算
//   官方「输出速度（TPS）」= Σ 输出 token ÷ Σ 解码耗时（**整段会话**，来自 `sessionStats`
//   投影，host 侧折叠）。本行**完全用同一个口径**，只把范围收到最近 30 秒。
//
//   为什么不能直接算 Chat 节点的每步解码区间：
//   节点的 `timing.firstTokenTime` 只来自**瞬时**的 `assistant/live-chunk`（或者重连时
//   当前 attempt 的 baseline）。会话从磁盘回放（刷新页面 / 打开历史会话）时，这些瞬时事件
//   不存在，于是每个节点的 `firstTokenTime` 都是 `null` —— 那样算出来永远是「—」。
//
//   所以改成**对官方投影采样**：
//   `sessionStats` 的 `decodeTokens` / `decodeMs` 是单调累计值，一定拿得到、口径也一定对。
//   每个 step 结算时记一笔 `{t, tokens, ms}`（投影不变就不记），然后
//     30 秒速度 = (最后一次采样 - 30 秒前那次采样) 的 Δtoken ÷ Δ解码毫秒
//   窗口右端锚定在**最后一个采样点**上，而不是「现在」：
//   · 没有新 step 结算 → 采样不变 → 读数**原样保持**（不衰减、不跳、不会变「—」）；
//   · 真算不出来（Δms 为 0）时**沿用上一次有效读数**；
//   · 冷启动还没有任何采样时，退回「整段速度」（和官方那行同值），下一次 step 结算就换成窗口值。
//   每个会话的采样与最近读数会写进 localStorage，所以**刷新页面后立刻就有值**。
//
// 三、数据来源（插槽标准注入面，不碰私有 API / 别人 DOM）
//   · `useProjection('sessionStats')` —— 官方整段统计，四行官方读数与 30 秒采样都用它；
//     缺失时用 `useChat(s => s.legacy.nodes)` 折叠兜底（与官方 deriveStats 逐项同口径）。
//   · 插槽标准 prop `sessionId` —— 采样历史按会话隔离。
//   · `configForms` 只读一个字段：`ui-chat.performanceUsage`（简洁 / 详细），
//     保证官方「简洁模式只显示速度」的行为不被破坏。
// ═══════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
  id: 'dsh-recent-tps',
  factory: (require) => {
    const React = require('react')
    const ReactDOM = require('react-dom')

    const NS = 'dsh-recent-tps'
    const VERSION = '0.1.2'
    const log = (...args) => console.log('[recent-tps]', ...args)

    /** 统计窗口：最近 30 秒（想换窗口改这一处） */
    const WINDOW_MS = 30 * 1000
    /** 采样历史只留最近 2 分钟（够算 30 秒窗口，又不涨内存） */
    const SAMPLE_KEEP_MS = 120 * 1000
    /** localStorage 里最多保留多少个会话的最近读数 */
    const MAX_SESSIONS = 24
    const STORAGE_KEY = 'dsh-recent-tps:v1'
    /** 官方 ui-chat 的性能与用量档位（compact 只显示速度，没有对话框） */
    const DEFAULT_MODE = 'detailed'

    // ── 文案（与官方 ui-chat 字典逐字一致，只多 recentSpeed 一行）──────────
    const DICT = {
      zh: {
        counts: '{turns} 轮 {steps} 步',
        dialogTitle: '会话统计',
        llmTime: '模型用时',
        toolTime: '工具调用用时',
        ttft: '首 token 平均（TTFT）',
        speed: '输出速度（TPS）',
        recentSpeed: '最近 30 秒速度',
        tokensPerSecond: '{tps} tok/s',
        compactSeconds: '{seconds}秒',
        compactMinutes: '{minutes}分{seconds}秒',
        none: '—',
      },
      en: {
        counts: '{turns} turns {steps} steps',
        dialogTitle: 'Session statistics',
        llmTime: 'LLM time',
        toolTime: 'Tool time',
        ttft: 'Avg time to first token (TTFT)',
        speed: 'Tokens per second (TPS)',
        recentSpeed: 'Last 30s speed',
        tokensPerSecond: '{tps} tok/s',
        compactSeconds: '{seconds}s',
        compactMinutes: '{minutes}m{seconds}s',
        none: '—',
      },
    }

    // ── 样式（官方 StatsPills / stat-dialog 编译产物的等价物）─────────────
    const CSS = {
      anchor: 'rt-anchor',
      pill: 'rt-pill',
      label: 'rt-label',
      sep: 'rt-sep',
      panel: 'rt-panel',
      title: 'rt-title',
      titleLabel: 'rt-title-label',
      titleValue: 'rt-title-value',
      titleRule: 'rt-title-rule',
      details: 'rt-details',
    }

    const CSS_TEXT = [
      // 读数（官方 hNGZaa_* 等价）
      '.rt-anchor{min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:inline-flex}',
      '.rt-pill{box-sizing:border-box;border-radius:var(--dsw-radius-sm);max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}',
      '.rt-pill svg{flex:none;width:14px;height:14px}',
      'button.rt-pill{cursor:pointer}',
      'button.rt-pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '@media (hover:hover){button.rt-pill:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}',
      '.rt-label{text-overflow:ellipsis;min-width:0;overflow:hidden}',
      '.rt-sep{color:var(--dsw-alias-separator-primary);margin:0 6px}',
      // 对话框（官方 xXe6ja_* 等价；composer 是 fixed 包含块，必须 portal 到 body）
      '.rt-panel{z-index:1100;box-sizing:border-box;width:max-content;min-width:min(300px, calc(100vw - 24px), var(--dsh-anchored-max-width,100vw));max-width:min(440px, calc(100vw - 24px), var(--dsh-anchored-max-width,100vw));border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;max-height:var(--dsh-anchored-max-height,none);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border:0;padding:16px;font-size:12px;line-height:18px;position:fixed;overflow:hidden auto}',
      '.rt-title{color:var(--dsw-alias-label-primary);justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:500;display:flex}',
      '.rt-title-rule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}',
      '.rt-title-value{font-variant-numeric:tabular-nums}',
      '.rt-title-label{align-items:center;gap:6px;min-width:0;display:inline-flex}',
      '.rt-title-label svg{flex:none;width:14px;height:14px}',
      '.rt-details{color:var(--dsw-alias-label-tertiary);grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;display:grid}',
      '.rt-details dt,.rt-details dd{min-width:0;margin:0}',
      '.rt-details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}',
    ].join('')

    function injectStyleOnce() {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') return
      const tagId = `${NS}/style`
      if (typeof document.querySelector === 'function' && document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = NS
      tag.dataset.pluginCss = tagId
      tag.textContent = CSS_TEXT
      if (document.head && typeof document.head.appendChild === 'function') document.head.appendChild(tag)
    }

    // ── 纯逻辑（test/ 直接测）────────────────────────────────────────────
    const EMPTY_NODES = []
    const selectSelf = (value) => value
    const selectNodes = (snapshot) => (snapshot && snapshot.legacy && snapshot.legacy.nodes) || EMPTY_NODES

    function isRecord(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    }

    /** 官方 ui-chat 的档位值（未知值按 detailed） */
    function normalizeMode(value) {
      return value === 'compact' ? 'compact' : DEFAULT_MODE
    }

    /** `{name}` 占位符替换；缺失的键原样保留，方便发现漏翻 */
    function translate(dict, key, params) {
      const template = dict && typeof dict[key] === 'string' ? dict[key] : key
      return template.replace(/\{(\w+)\}/g, (match, name) => (params && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match))
    }

    /** 官方口径：≥10 取整，<10 保留一位小数 */
    function formatTokensPerSecond(tps) {
      const clamped = Math.max(0, Number.isFinite(tps) ? tps : 0)
      return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
    }

    /** 官方口径：60 秒以内用小数秒，以上用 分+秒 */
    function formatDuration(ms, dict) {
      const seconds = Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000
      if (seconds < 60) return translate(dict, 'compactSeconds', { seconds: Math.round(seconds * 10) / 10 })
      const whole = Math.round(seconds)
      return translate(dict, 'compactMinutes', { minutes: Math.floor(whole / 60), seconds: whole % 60 })
    }

    /** 单个已结算 assistant 节点的解码区间与输出 token 数；缺数据返回 null */
    function stepReading(node) {
      if (!isRecord(node) || node.kind !== 'assistant') return null
      const timing = node.timing
      if (!isRecord(timing)) return null
      const start = timing.firstTokenTime
      const end = timing.completedTime
      const usage = node.usage
      const tokens = isRecord(usage) ? usage.outputTokens : undefined
      if (typeof start !== 'number' || typeof end !== 'number' || typeof tokens !== 'number') return null
      if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(tokens) || tokens < 0) return null
      return { start, end, span: Math.max(0, end - start), tokens }
    }

    /**
     * 窗口内的解码速度：把每步的解码区间裁到 [now - windowMs, now]，
     * token 数按重叠比例分摊，再除以窗口内的解码毫秒。
     * 口径与官方 `decodeTokens / (decodeMs / 1000)` 一致；windowMs = 0 时整段。
     * @returns {{tps:number, tokens:number, decodeMs:number}|null} 窗口内没有解码时间时 null
     */
    function rollingSpeed(nodes, now, windowMs) {
      const list = Array.isArray(nodes) ? nodes : EMPTY_NODES
      const bounded = Number.isFinite(windowMs) && windowMs > 0
      const from = bounded ? now - windowMs : Number.NEGATIVE_INFINITY
      const until = bounded ? now : Number.POSITIVE_INFINITY
      let tokens = 0
      let decodeMs = 0
      for (const node of list) {
        const reading = stepReading(node)
        if (reading === null || reading.span <= 0) continue // 零宽步骤无法分摊
        const overlap = Math.min(reading.end, until) - Math.max(reading.start, from)
        if (!(overlap > 0)) continue
        tokens += reading.tokens * (overlap / reading.span)
        decodeMs += overlap
      }
      if (!(decodeMs > 0)) return null
      return { tps: tokens / (decodeMs / 1000), tokens, decodeMs }
    }

    /**
     * 整段统计的兜底折叠（`sessionStats` 投影不可用时）。
     * 字段与官方 `deriveStats` 逐项对齐。
     */
    function foldStats(nodes) {
      const list = Array.isArray(nodes) ? nodes : EMPTY_NODES
      const turns = new Set()
      let steps = 0
      let llmMs = 0
      let toolMs = 0
      let ttftMs = 0
      let ttftSteps = 0
      let decodeMs = 0
      let decodeTokens = 0
      for (const node of list) {
        if (!isRecord(node)) continue
        if (node.kind === 'tool-result') {
          if (typeof node.callTime === 'number' && typeof node.time === 'number') toolMs += Math.max(0, node.time - node.callTime)
          continue
        }
        if (node.kind !== 'assistant') continue
        turns.add(node.turn)
        steps += 1
        const timing = node.timing
        if (isRecord(timing) && typeof timing.stepStartTime === 'number' && typeof timing.completedTime === 'number') {
          llmMs += Math.max(0, timing.completedTime - timing.stepStartTime)
          if (typeof timing.firstTokenTime === 'number') {
            ttftMs += Math.max(0, timing.firstTokenTime - timing.stepStartTime)
            ttftSteps += 1
            const reading = stepReading(node)
            if (reading !== null) {
              decodeMs += reading.span
              decodeTokens += reading.tokens
            }
          }
        }
      }
      return { turns: turns.size, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }
    }

    /** 极简可观察源（标准注入面要 getSnapshot / subscribe） */
    function createStore(initial) {
      let snapshot = initial
      const listeners = new Set()
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        set(next) {
          if (Object.is(next, snapshot)) return
          snapshot = next
          for (const listener of [...listeners]) {
            try {
              listener()
            } catch (error) {
              log('subscriber failed:', String((error && error.message) || error))
            }
          }
        },
      }
    }

    // ── 图标（官方 IconGaugeOutlineRegular 的同类替代）─────────────────────
    function GaugeIcon() {
      return React.createElement('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': true,
      },
      React.createElement('path', {
        d: 'M2.6 12.4a6.6 6.6 0 1 1 10.8 0',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
      }),
      React.createElement('path', {
        d: 'M8 12.2 11 7.4',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
      }),
      React.createElement('circle', { cx: 8, cy: 12.2, r: 1.05, fill: 'currentColor' }))
    }

    // ── 30 秒窗口：对官方投影采样 ───────────────────────────────────────
    /**
     * 每个会话的采样历史 + 最近一次有效读数。
     * 采样点来自官方 `sessionStats` 投影的累计计数器（`decodeTokens` / `decodeMs`），
     * 所以 30 秒速度 = Δtoken ÷ Δ解码毫秒，口径与官方「输出速度（TPS）」完全一致。
     * @type {Map<string, {samples: {t: number, tokens: number, ms: number}[], tps: number|null}>}
     */
    const histories = new Map()
    let storageLoaded = false
    let persistTimer = null

    function isSample(value) {
      return isRecord(value)
        && typeof value.t === 'number' && Number.isFinite(value.t)
        && typeof value.tokens === 'number' && Number.isFinite(value.tokens)
        && typeof value.ms === 'number' && Number.isFinite(value.ms)
    }

    /** 整段口径的读数（还没有任何采样历史时的兜底，与官方那行同值） */
    function sessionAverage(stats) {
      if (!isRecord(stats)) return null
      const tokens = stats.decodeTokens
      const ms = stats.decodeMs
      if (typeof tokens !== 'number' || typeof ms !== 'number' || !(ms > 0)) return null
      return tokens / (ms / 1000)
    }

    /**
     * 窗口内的速度：窗口 = [最后一个采样点 - 30s, 最后一个采样点]。
     * 锚在最后一个采样点上（而不是「现在」），所以没有新 step 结算时读数恒定。
     * @param samples - 按时间升序的采样
     * @returns tok/s，或 null（样本不足 / Δms 为 0）
     */
    function windowTps(samples) {
      if (!Array.isArray(samples) || samples.length < 2) return null
      const anchor = samples[samples.length - 1]
      const from = anchor.t - WINDOW_MS
      let base = samples[0]
      for (const sample of samples) {
        if (sample.t > from) break
        base = sample
      }
      const tokens = anchor.tokens - base.tokens
      const ms = anchor.ms - base.ms
      if (!(ms > 0) || !(tokens > 0)) return null
      return tokens / (ms / 1000)
    }

    /**
     * 记一笔采样。投影没变化就不记、也不动读数；算不出窗口速度时**沿用上一次有效读数**，
     * 冷启动没有任何历史时退回整段速度 —— 保证这一行永远有值。
     * @param history - 该会话当前的历史
     * @param stats - `sessionStats` 投影（或折叠兜底）
     * @param now - 采样时刻
     * @returns 新的历史对象（不可变）
     */
    function recordSample(history, stats, now) {
      const current = isRecord(history) && Array.isArray(history.samples) ? history : { samples: [], tps: null }
      if (!isRecord(stats)) return current
      const tokens = stats.decodeTokens
      const ms = stats.decodeMs
      if (typeof tokens !== 'number' || typeof ms !== 'number') return current
      if (!Number.isFinite(tokens) || !Number.isFinite(ms)) return current
      const last = current.samples[current.samples.length - 1]
      if (last !== undefined && last.tokens === tokens && last.ms === ms) return current
      const samples = [...current.samples, { t: now, tokens, ms }]
      while (samples.length > 2 && now - samples[0].t > SAMPLE_KEEP_MS) samples.shift()
      const tps = windowTps(samples) ?? (typeof current.tps === 'number' ? current.tps : sessionAverage(stats))
      return { samples, tps }
    }

    function lastSampleTime(history) {
      const samples = isRecord(history) && Array.isArray(history.samples) ? history.samples : EMPTY_NODES
      return samples.length === 0 ? 0 : samples[samples.length - 1].t
    }

    function loadHistories() {
      if (storageLoaded) return
      storageLoaded = true
      if (typeof localStorage === 'undefined') return
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw === null) return
        const parsed = JSON.parse(raw)
        if (!isRecord(parsed)) return
        for (const [sessionId, entry] of Object.entries(parsed)) {
          if (!isRecord(entry) || !Array.isArray(entry.samples)) continue
          const samples = entry.samples.filter(isSample).sort((a, b) => a.t - b.t).slice(-200)
          if (samples.length === 0) continue
          histories.set(sessionId, {
            samples,
            tps: typeof entry.tps === 'number' && Number.isFinite(entry.tps) ? entry.tps : null,
          })
        }
      } catch (error) {
        log('读取本地缓存失败:', String((error && error.message) || error))
      }
    }

    function schedulePersist() {
      if (typeof localStorage === 'undefined' || persistTimer !== null) return
      persistTimer = setTimeout(() => {
        persistTimer = null
        try {
          const entries = [...histories.entries()]
            .sort((a, b) => lastSampleTime(b[1]) - lastSampleTime(a[1]))
            .slice(0, MAX_SESSIONS)
          localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
        } catch (error) {
          log('写入本地缓存失败:', String((error && error.message) || error))
        }
      }, 2000)
    }

    /** 取（并初始化）某个会话的历史 */
    function historyFor(sessionId) {
      loadHistories()
      const key = typeof sessionId === 'string' ? sessionId : ''
      const existing = histories.get(key)
      if (existing !== undefined) return existing
      const created = { samples: [], tps: null }
      histories.set(key, created)
      return created
    }

    /** 仅供 test/ 使用：清空模块级缓存 */
    function resetHistories() {
      histories.clear()
      storageLoaded = false
      if (persistTimer !== null) {
        clearTimeout(persistTimer)
        persistTimer = null
      }
    }

    const MEASURE_STYLE = { visibility: 'hidden', left: 0, top: 0 }
    const PANEL_MARGIN = 12
    const PANEL_GAP = 8
    const useIsomorphicLayoutEffect = React.useLayoutEffect || React.useEffect

    /** 锚定在读数上方的浮动面板：定位、Escape / 外部指针关闭 */
    function useDialogSeat() {
      const [open, setOpen] = React.useState(false)
      const [pos, setPos] = React.useState(null)
      const rootRef = React.useRef(null)
      const panelRef = React.useRef(null)

      useIsomorphicLayoutEffect(() => {
        if (!open) return undefined
        const place = () => {
          const anchor = rootRef.current
          const panel = panelRef.current
          if (anchor === null || panel === null) return
          if (typeof anchor.getBoundingClientRect !== 'function') return
          const rect = anchor.getBoundingClientRect()
          const width = panel.offsetWidth || 0
          const height = panel.offsetHeight || 0
          const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0
          const left = Math.min(Math.max(PANEL_MARGIN, rect.left), Math.max(PANEL_MARGIN, viewportWidth - PANEL_MARGIN - width))
          setPos({ left, top: Math.max(PANEL_MARGIN, rect.top - PANEL_GAP - height) })
        }
        place()
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
        window.addEventListener('resize', place)
        return () => window.removeEventListener('resize', place)
      }, [open])

      React.useEffect(() => {
        if (!open) return undefined
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        const onPointerDown = (event) => {
          const target = event.target
          if (typeof Node === 'undefined' || !(target instanceof Node)) return
          if (rootRef.current !== null && rootRef.current.contains(target)) return
          if (panelRef.current !== null && panelRef.current.contains(target)) return
          setOpen(false)
        }
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown)
          document.removeEventListener('pointerdown', onPointerDown, true)
        }
      }, [open])

      return { open, setOpen, rootRef, panelRef, pos }
    }

    // ── 读数（替换官方 activity 条目）──────────────────────────────────────
    function ActivityPill(props) {
      const { useChat, useProjection, useLabels, usePerformanceUsage, sessionId } = props
      const nodes = useChat(selectNodes)
      const projected = useProjection('sessionStats')
      const labels = useLabels(selectSelf)
      const mode = usePerformanceUsage(selectSelf)
      const seat = useDialogSeat()

      const stats = React.useMemo(
        () => (isRecord(projected) ? projected : foldStats(nodes)),
        [projected, nodes],
      )

      // 30 秒速度：每次投影变化记一笔采样（不挂定时器），读数锚在最后一个采样点上。
      // 初值直接取该会话上次的读数（localStorage），刷新页面后不会先闪一下「—」。
      const [recentTps, setRecentTps] = React.useState(() => {
        const saved = historyFor(sessionId).tps
        return typeof saved === 'number' && Number.isFinite(saved) ? saved : null
      })
      React.useEffect(() => {
        const key = typeof sessionId === 'string' ? sessionId : ''
        const next = recordSample(historyFor(sessionId), stats, Date.now())
        histories.set(key, next)
        schedulePersist()
        setRecentTps((previous) => (Object.is(previous, next.tps) ? previous : next.tps))
      }, [sessionId, stats])

      const steps = typeof stats.steps === 'number' ? stats.steps : 0
      if (steps === 0) return null

      const counts = translate(labels, 'counts', { turns: stats.turns ?? 0, steps })
      const sessionTps = typeof stats.decodeMs === 'number' && stats.decodeMs > 0
        ? translate(labels, 'tokensPerSecond', { tps: formatTokensPerSecond((stats.decodeTokens ?? 0) / (stats.decodeMs / 1000)) })
        : null
      const recentText = recentTps === null
        ? labels.none
        : translate(labels, 'tokensPerSecond', { tps: formatTokensPerSecond(recentTps) })
      const fullReading = sessionTps === null ? counts : `${counts} · ${sessionTps}`

      // 简洁模式：与官方一致，只显示整段速度（悬停给出最近 30 秒）
      if (normalizeMode(mode) === 'compact') {
        if (sessionTps === null) return null
        return React.createElement('span', { className: CSS.anchor, 'data-composer-stat': 'activity' },
          React.createElement('span', {
            className: CSS.pill,
            title: `${sessionTps} · ${labels.recentSpeed} ${recentText}`,
          },
          React.createElement(GaugeIcon, null),
          React.createElement('span', { className: CSS.label }, sessionTps)))
      }

      const rows = []
      if (typeof stats.llmMs === 'number' && stats.llmMs > 0) rows.push(['llm', labels.llmTime, formatDuration(stats.llmMs, labels)])
      if (typeof stats.toolMs === 'number' && stats.toolMs > 0) rows.push(['tool', labels.toolTime, formatDuration(stats.toolMs, labels)])
      if (typeof stats.ttftSteps === 'number' && stats.ttftSteps > 0) rows.push(['ttft', labels.ttft, formatDuration((stats.ttftMs ?? 0) / stats.ttftSteps, labels)])
      if (sessionTps !== null) rows.push(['speed', labels.speed, sessionTps])
      rows.push(['recent', labels.recentSpeed, recentText])

      const panel = React.createElement('div', {
        ref: seat.panelRef,
        className: CSS.panel,
        role: 'dialog',
        'aria-label': labels.dialogTitle,
        style: seat.pos ?? MEASURE_STYLE,
        'data-session-stats-details': true,
      },
      React.createElement('div', { className: CSS.title },
        React.createElement('span', { className: CSS.titleLabel },
          React.createElement(GaugeIcon, null),
          labels.dialogTitle),
        React.createElement('span', { className: CSS.titleValue }, counts)),
      React.createElement('div', { className: CSS.titleRule, 'aria-hidden': true }),
      React.createElement('dl', { className: CSS.details },
        rows.map(([key, label, value]) => React.createElement(React.Fragment, { key },
          React.createElement('dt', null, label),
          React.createElement('dd', null, value)))))

      return React.createElement('span', {
        className: CSS.anchor,
        'data-composer-stat': 'activity',
        ref: seat.rootRef,
      },
      React.createElement('button', {
        type: 'button',
        className: CSS.pill,
        'aria-haspopup': 'dialog',
        'aria-expanded': seat.open,
        'aria-label': fullReading,
        title: fullReading,
        onClick: () => seat.setOpen(!seat.open),
      },
      React.createElement(GaugeIcon, null),
      React.createElement('span', { className: CSS.label },
        counts,
        sessionTps === null ? null : React.createElement('span', { className: CSS.sep, 'aria-hidden': true }, '·'),
        sessionTps)),
      seat.open && typeof document !== 'undefined' && document.body
        ? ReactDOM.createPortal(panel, document.body)
        : null)
    }

    // ── 挂载 ───────────────────────────────────────────────────────────────
    const inject = ['slots', 'locale']

    function apply(ctx) {
      injectStyleOnce()
      const locale = ctx.get('locale')
      const localeOf = () => (locale && typeof locale.getLocale === 'function' && locale.getLocale().active === 'en' ? 'en' : 'zh')
      const labelsStore = createStore(DICT[localeOf()])
      ctx.effect(() => {
        if (locale === undefined || typeof locale.subscribe !== 'function') return undefined
        return locale.subscribe(() => labelsStore.set(DICT[localeOf()]))
      }, `${NS}: locale`)

      // configForms 缺失（更早的 DSH）时整体不挂：官方读数原样保留，插件静默不生效。
      ctx.inject(['configForms'], (scope) => {
        const forms = scope.configForms
        if (forms === undefined || typeof forms.get !== 'function') {
          log('configForms 不可用，跳过')
          return
        }
        const modeStore = createStore(DEFAULT_MODE)
        const chatForm = forms.get('ui-chat')
        const readMode = () => {
          try {
            const snapshot = chatForm.getSnapshot()
            modeStore.set(normalizeMode(isRecord(snapshot) && isRecord(snapshot.value) ? snapshot.value.performanceUsage : undefined))
          } catch (error) {
            log('读取性能档位失败:', String((error && error.message) || error))
          }
        }
        readMode()
        scope.effect(() => chatForm.subscribe(readMode), `${NS}: performance mode`)

        // 顶掉官方 activity 读数（同 id + 同 order，priority 更低者胜）
        scope.slots.inject('conversation.composer.dock', () => scope.slots.register({
          name: 'conversation.composer.dock',
          id: 'activity',
          order: 0,
          priority: -1,
          inject: () => ({
            hooks: {
              labels: labelsStore,
              performanceUsage: modeStore,
            },
          }),
        }, ActivityPill))

        log(`ready (v${VERSION})：接管 conversation.composer.dock#activity，面板加「最近 ${WINDOW_MS / 1000} 秒速度」`)
      })
    }

    // 仅供 test/ 使用：不参与运行时契约。
    const __internals = {
      NS,
      VERSION,
      WINDOW_MS,
      DICT,
      normalizeMode,
      translate,
      formatTokensPerSecond,
      formatDuration,
      stepReading,
      foldStats,
      sessionAverage,
      windowTps,
      recordSample,
      historyFor,
      resetHistories,
      createStore,
    }

    return { name: NS, inject, apply, __internals }
  },
})
