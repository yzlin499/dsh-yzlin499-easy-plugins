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
//   官方「输出速度（TPS）」= Σ 输出 token ÷ Σ 解码耗时（整段）。
//   新行同口径，只把范围收到 30 秒，并且**锚定在最后一个已结算的 step 上**：
//     窗口 = [最后一个已结算 step 的 completedTime - 30s, 该 completedTime]
//     取每个已结算 step 的解码区间 [firstTokenTime, completedTime] 与窗口求交，
//     token 按重叠比例分摊，窗口速度 = Σ(重叠 token) ÷ Σ(重叠毫秒) × 1000。
//   这样它只随「新的 step 结算」而变：生成停下来之后读数**原样保持**，
//   不会跟着墙上时钟衰减、更不会变成「—」（那是实时量才有的行为）。
//   完全没有可用解码区间时（provider 不报 usage 等）才显示「—」。
//
//   实现上不挂任何定时器：锚点来自 `legacy.nodes` 里最大的 completedTime，
//   没有新节点就没有新渲染，天然静止。
//
// 三、数据来源（插槽标准注入面，不碰私有 API / 别人 DOM）
//   · `useProjection('sessionStats')` —— 官方整段统计（轮/步/耗时/token），缺失时用
//     `useChat(s => s.legacy.nodes)` 折叠兜底（与官方 deriveStats 逐项同口径）。
//   · `useChat(s => s.legacy.nodes)` —— 已结算 step 的 timing / usage，用来算 30 秒窗口。
//   · `configForms` 只读一个字段：`ui-chat.performanceUsage`（简洁 / 详细），
//     保证官方「简洁模式只显示速度」的行为不被破坏。
// ═══════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
  id: 'dsh-recent-tps',
  factory: (require) => {
    const React = require('react')
    const ReactDOM = require('react-dom')

    const NS = 'dsh-recent-tps'
    const VERSION = '0.1.1'
    const log = (...args) => console.log('[recent-tps]', ...args)

    /** 统计窗口：最近 30 秒（想换窗口改这一处） */
    const WINDOW_MS = 30 * 1000
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

    // ── 面板锚定 ─────────────────────────────────────────────────────────
    /**
     * 最后一个已结算 step 的完成时刻（窗口右端）。
     * 返回 null 表示这个会话还没有任何带完成时间的 assistant 节点。
     * @param nodes - `legacy.nodes`
     * @returns 锚点毫秒，或 null
     */
    function lastDecodeEnd(nodes) {
      const list = Array.isArray(nodes) ? nodes : EMPTY_NODES
      let end = Number.NEGATIVE_INFINITY
      for (const node of list) {
        if (!isRecord(node) || node.kind !== 'assistant') continue
        const timing = node.timing
        if (!isRecord(timing)) continue
        const completedTime = timing.completedTime
        if (typeof completedTime !== 'number' || !Number.isFinite(completedTime)) continue
        if (completedTime > end) end = completedTime
      }
      return Number.isFinite(end) ? end : null
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
      const { useChat, useProjection, useLabels, usePerformanceUsage } = props
      const nodes = useChat(selectNodes)
      const projected = useProjection('sessionStats')
      const labels = useLabels(selectSelf)
      const mode = usePerformanceUsage(selectSelf)
      const seat = useDialogSeat()

      const stats = React.useMemo(
        () => (isRecord(projected) ? projected : foldStats(nodes)),
        [projected, nodes],
      )
      // 锚定在最后一个已结算 step 上：没有新 step 结算就永远保持同一个读数。
      const recent = React.useMemo(() => {
        const anchor = lastDecodeEnd(nodes)
        return anchor === null ? null : rollingSpeed(nodes, anchor, WINDOW_MS)
      }, [nodes])

      const steps = typeof stats.steps === 'number' ? stats.steps : 0
      if (steps === 0) return null

      const counts = translate(labels, 'counts', { turns: stats.turns ?? 0, steps })
      const sessionTps = typeof stats.decodeMs === 'number' && stats.decodeMs > 0
        ? translate(labels, 'tokensPerSecond', { tps: formatTokensPerSecond((stats.decodeTokens ?? 0) / (stats.decodeMs / 1000)) })
        : null
      const recentTps = recent === null ? null : translate(labels, 'tokensPerSecond', { tps: formatTokensPerSecond(recent.tps) })
      const recentText = recentTps ?? labels.none
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
      lastDecodeEnd,
      rollingSpeed,
      foldStats,
      createStore,
    }

    return { name: NS, inject, apply, __internals }
  },
})
