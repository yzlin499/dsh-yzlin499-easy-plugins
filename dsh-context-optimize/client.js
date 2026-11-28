// ═══════════════════════════════════════════════════════════════════════════
// dsh-context-optimize — Client 半侧：侧边栏「上下文大纲」
//
// 主路径：装到用户当前的侧边栏（dsh-better-sidebar 的 `ctx.betterSidebar`
//   registerTab），作为独立一页。
// 回退路径：没有 betterSidebar 时，退化成输入框 dock 里的一行窄轴
//   （只用官方插槽注入面，不碰私有 API）。
//
// 数据来源：本插件 Host 半侧（压缩后端）自己记的折叠历史，
//   GET /context-optimize/outline?session=<id>。
//   为什么不用 `useProjection` / `useChat`：侧边栏 tab 的 props 里没有这两个
//   插槽钩子，只有 ctx / store / scope / tab / visible；与其猜客户端内部
//   结构，不如让 Host 报它自己确知的事实。
//   拿不到的数字一律显示「—」，不估算、不编。
// ═══════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
  id: 'dsh-context-optimize',
  factory: (require) => {
    const React = require('react')

    const NS = 'dsh-context-optimize'
    const VERSION = '0.1.0'
    const ENDPOINT = '/context-optimize/outline'
    const POLL_MS = 5000
    const log = (...args) => console.log('[context-optimize]', ...args)

    const DICT = {
      zh: {
        tab: '上下文大纲',
        tabDesc: '本会话的折叠状态：折了几段、多少 token、还要几步才允许再折',
        title: '上下文大纲',
        summary: '已折叠 {n} 段 · {t} tok · {nodes} 节点',
        none: '这个会话还没有折叠。',
        noneHint: '上下文压力上来、且距上次折叠已过 {n} 个工具步后，早期任务段会被折成一页卡片。',
        gateReady: '现在可折（已过 {n} 个工具步）',
        gateWait: '距下次可折还需 {n} 个工具步',
        entry: '{t} tok · {nodes} 节点 · {time}',
        triggerPressure: '压力触发',
        triggerOverflow: '溢出恢复',
        loadFailed: '读取折叠状态失败',
        unknown: '—',
      },
      en: {
        tab: 'Context outline',
        tabDesc: 'Folding state for this session: spans, tokens, and the gate countdown',
        title: 'Context outline',
        summary: '{n} spans folded · {t} tok · {nodes} nodes',
        none: 'Nothing folded in this session yet.',
        noneHint: 'Once context pressure rises and {n} tool steps have passed since the last fold, older task spans become cards.',
        gateReady: 'foldable now ({n} tool steps)',
        gateWait: '{n} more tool steps before the next fold',
        entry: '{t} tok · {nodes} nodes · {time}',
        triggerPressure: 'pressure',
        triggerOverflow: 'overflow recovery',
        loadFailed: 'failed to read folding state',
        unknown: '—',
      },
    }

    const CSS = `
.dco-panel { display: flex; flex-direction: column; gap: 10px; padding: 12px; font-size: 12px;
  color: var(--dsw-alias-label-secondary, rgba(0,0,0,.62)); height: 100%; overflow: auto; box-sizing: border-box; }
.dco-panel__head { display: flex; align-items: baseline; gap: 8px; }
.dco-panel__title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, rgba(0,0,0,.88)); }
.dco-panel__sum { font-variant-numeric: tabular-nums; }
.dco-panel__axis { position: relative; border-left: 2px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12));
  padding-left: 12px; display: flex; flex-direction: column; gap: 8px; margin: 2px 0 2px 4px; }
.dco-panel__node { position: relative; }
.dco-panel__dot { position: absolute; left: -19px; top: 4px; width: 8px; height: 8px; border-radius: 50%;
  background: var(--dsw-alias-label-primary, rgba(0,0,0,.8)); }
.dco-panel__entry { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary, rgba(0,0,0,.8)); }
.dco-panel__meta { opacity: .7; }
.dco-panel__gate { margin-top: auto; padding-top: 8px; opacity: .8; }
.dco-panel__err { color: var(--dsw-alias-label-warning, #b45309); }
.dco-axis { display: flex; align-items: center; gap: 8px; width: 100%; padding: 2px 4px;
  font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary, rgba(0,0,0,.6));
  font-variant-numeric: tabular-nums; user-select: none; }
.dco-axis__title { font-weight: 600; color: var(--dsw-alias-label-primary, rgba(0,0,0,.85)); }
.dco-axis__cells { display: flex; flex: 1; gap: 2px; min-width: 80px; max-width: 420px; }
.dco-axis__cell { flex: 1; height: 6px; border-radius: 2px; background: var(--dsw-alias-bg-layer-3, rgba(0,0,0,.08)); }
.dco-axis__cell--folded { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.35)); }
.dco-axis__meta { white-space: nowrap; opacity: .85; }
`

    function injectStyleOnce() {
      if (typeof document === 'undefined') return
      if (document.getElementById(`${NS}:style`)) return
      const style = document.createElement('style')
      style.id = `${NS}:style`
      style.textContent = CSS
      document.head.appendChild(style)
    }

    // ── 纯函数（可测）──────────────────────────────────────────────────────

    function formatTokens(value) {
      if (!Number.isFinite(value)) return '—'
      if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
      return String(value)
    }

    function formatTime(at) {
      const date = new Date(Number(at))
      if (Number.isNaN(date.getTime())) return '—'
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    function translate(dict, template, params) {
      const text = dict[template] ?? template
      return text.replace(/\{(\w+)\}/g, (_, key) => String(params?.[key] ?? `{${key}}`))
    }

    /** 把 Host 的 outline 载荷整理成渲染用的行；缺字段一律降级为「—」。 */
    function outlineRows(payload) {
      const entries = Array.isArray(payload?.entries) ? payload.entries : []
      return entries.map((entry) => ({
        tokens: formatTokens(Number(entry?.tokens)),
        nodes: Number.isFinite(Number(entry?.nodes)) ? String(Number(entry.nodes)) : '—',
        time: formatTime(entry?.at),
        trigger: entry?.trigger === 'context-overflow' ? 'overflow' : 'pressure',
      }))
    }

    /** 是否已经可以再折（与 Host 闸门口径一致，仅用于展示）。 */
    function gateState(payload) {
      const min = Number(payload?.minToolSteps ?? 0)
      const steps = Number(payload?.stepsSinceFold ?? 0)
      if (!Number.isFinite(min) || min <= 0) return { ready: true, remaining: 0, min, steps }
      return { ready: steps >= min, remaining: Math.max(0, min - steps), min, steps }
    }

    // ── 侧边栏页 ───────────────────────────────────────────────────────────

    function OutlinePanel(props) {
      const { scope, visible, labels } = props
      const dict = resolveDict(labels)
      const sessionId = scope?.sessionId
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState(null)

      React.useEffect(() => {
        if (sessionId === undefined || sessionId === null) return undefined
        let alive = true
        const load = async () => {
          try {
            const response = await fetch(`${ENDPOINT}?session=${encodeURIComponent(String(sessionId))}`)
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const payload = await response.json()
            if (alive) { setState(payload); setError(null) }
          } catch (failure) {
            if (alive) setError(String(failure?.message ?? failure))
          }
        }
        void load()
        const timer = setInterval(load, POLL_MS)
        return () => { alive = false; clearInterval(timer) }
      }, [sessionId])

      const folded = Number(state?.folded ?? 0)
      const rows = outlineRows(state)
      const gate = gateState(state)

      return React.createElement('div', { className: 'dco-panel', hidden: visible === false && false },
        React.createElement('div', { className: 'dco-panel__head' },
          React.createElement('span', { className: 'dco-panel__title' }, dict.title),
          React.createElement('span', { className: 'dco-panel__sum' },
            folded > 0
              ? translate(dict, 'summary', { n: folded, t: formatTokens(Number(state?.tokens)), nodes: Number(state?.nodes ?? 0) })
              : '')),

        error !== null ? React.createElement('div', { className: 'dco-panel__err' }, `${dict.loadFailed}: ${error}`) : null,

        folded === 0
          ? React.createElement('div', null,
            React.createElement('div', null, dict.none),
            React.createElement('div', { className: 'dco-panel__meta' },
              translate(dict, 'noneHint', { n: gate.min || 6 })))
          : React.createElement('div', { className: 'dco-panel__axis' },
            rows.map((row, index) => React.createElement('div', { className: 'dco-panel__node', key: index },
              React.createElement('span', { className: 'dco-panel__dot' }),
              React.createElement('div', { className: 'dco-panel__entry' },
                translate(dict, 'entry', { t: row.tokens, nodes: row.nodes, time: row.time })),
              React.createElement('div', { className: 'dco-panel__meta' },
                row.trigger === 'overflow' ? dict.triggerOverflow : dict.triggerPressure)))),

        React.createElement('div', { className: 'dco-panel__gate' },
          gate.ready
            ? translate(dict, 'gateReady', { n: gate.steps })
            : translate(dict, 'gateWait', { n: gate.remaining })))
    }

    // ── dock 回退（没有 betterSidebar 时）──────────────────────────────────

    const selectNodes = (state) => (state && state.legacy && state.legacy.nodes) || []

    function AxisRow(props) {
      const { useChat, useProjection, labels } = props
      const dict = resolveDict(labels)
      const nodes = typeof useChat === 'function' ? useChat(selectNodes) : []
      const stats = typeof useProjection === 'function' ? useProjection('sessionStats') : undefined
      const turns = Number(stats?.lastTurn ?? stats?.turns ?? 0)

      let folded = 0
      let tokens = 0
      let tokensKnown = false
      for (const node of Array.isArray(nodes) ? nodes : []) {
        if (!String(node?.kind ?? '').includes('compaction')) continue
        folded += 1
        for (const value of [node?.data?.shadowedTokenCount, node?.data?.tokens, node?.tokens]) {
          if (Number.isFinite(value)) { tokens += Number(value); tokensKnown = true; break }
        }
      }

      return React.createElement('div', { className: 'dco-axis', title: dict.tabDesc },
        React.createElement('span', { className: 'dco-axis__title' }, dict.title),
        React.createElement('span', { className: 'dco-axis__cells' },
          Array.from({ length: Math.min(turns, 60) }, (_, index) => React.createElement('span', {
            key: index,
            className: 'dco-axis__cell',
          }))),
        React.createElement('span', { className: 'dco-axis__meta' },
          folded === 0
            ? dict.none
            : translate(dict, 'summary', { n: folded, t: tokensKnown ? formatTokens(tokens) : dict.unknown, nodes: '—' })))
    }

    // ── 公共 ───────────────────────────────────────────────────────────────

    function resolveDict(labels) {
      const injected = labels && typeof labels.get === 'function' ? labels.get() : labels
      return injected && typeof injected.title === 'string' ? injected : DICT.zh
    }

    const inject = ['slots', 'locale']

    function apply(ctx) {
      injectStyleOnce()
      const locale = ctx.get('locale')
      const localeOf = () => (locale && typeof locale.getLocale === 'function' && locale.getLocale().active === 'en' ? 'en' : 'zh')

      const createStore = (initial) => {
        let value = initial
        const listeners = new Set()
        return {
          get: () => value,
          set: (next) => { value = next; for (const listener of listeners) listener() },
          subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
        }
      }
      const labels = createStore(DICT[localeOf()])

      ctx.effect(() => {
        if (locale === undefined || typeof locale.subscribe !== 'function') return undefined
        return locale.subscribe(() => labels.set(DICT[localeOf()]))
      }, `${NS}: locale`)

      const sidebar = ctx.get('betterSidebar')
      if (sidebar && typeof sidebar.registerTab === 'function') {
        ctx.effect(() => sidebar.registerTab({
          id: 'dsh-context-optimize:outline',
          title: () => labels.get().tab,
          description: () => labels.get().tabDesc,
          order: 60,
          component: (props) => React.createElement(OutlinePanel, { ...props, labels }),
        }))
        log(`ready (v${VERSION})：侧边栏 tab dsh-context-optimize:outline`)
        return
      }

      // 回退：没有 betterSidebar 时挂到输入框 dock
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'context-optimize-axis',
        order: 6,
        inject: () => ({ hooks: { labels } }),
      }, AxisRow))
      log(`ready (v${VERSION})：没有 betterSidebar，回退 conversation.composer.dock#context-optimize-axis`)
    }

    // 仅供 test/ 使用：不参与运行时契约。
    const __internals = {
      NS, VERSION, DICT, ENDPOINT,
      formatTokens, formatTime, translate, outlineRows, gateState,
    }

    return { name: NS, inject, apply, __internals }
  },
})
