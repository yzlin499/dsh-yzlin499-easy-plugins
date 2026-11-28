// ═══════════════════════════════════════════════════════════════════════════
// dsh-context-optimize — Client 半侧：会话「上下文大纲轴」
//
// 目标：在输入框下方的 dock 里加一条窄轴，用一眼能看懂的方式呈现
// 「这一轮上下文里，有多少历史已经被折成卡片了」。
//
// 数据来源（只用插槽标准注入面，不碰私有 API / 别人 DOM）：
//   · useProjection('sessionStats') —— 官方投影，给 turns / steps；
//   · useChat(selectNodes)          —— 官方 chat 节点流，从中数折叠点
//                                      （kind 含 'compaction' 的节点）。
// 折叠 token 数按节点里出现的第一处 shadowedTokenCount / tokens 读取；
// 读不到就显示「—」而不猜——轴是给人看的事实，不是估算器。
//
// 之所以不显示「占用百分比」：客户端投影里没有 contextWindow 与实时压力
// （那两个在 host 侧 tokenMeter 上，跨 realm 拿不到）。宁可少显示，不编数字。
// ═══════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
  id: 'dsh-context-optimize',
  factory: (require) => {
    const React = require('react')

    const NS = 'dsh-context-optimize'
    const VERSION = '0.1.0'
    const log = (...args) => console.log('[context-optimize]', ...args)

    const DICT = {
      zh: {
        title: '上下文大纲',
        folded: '已折叠 {n} 段',
        foldedTokens: '{t} tok 已折',
        noFold: '暂无折叠',
        turns: '{n} 轮',
        hint: '每格代表一轮；深色格 = 该轮所在区间已被折叠成卡片',
      },
      en: {
        title: 'Context outline',
        folded: '{n} spans folded',
        foldedTokens: '{t} tok folded',
        noFold: 'nothing folded yet',
        turns: '{n} turns',
        hint: 'One cell per turn; a dark cell is a turn inside a folded span',
      },
    }

    const CSS = `
.dco-axis { display: flex; align-items: center; gap: 8px; width: 100%; padding: 2px 4px;
  font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary, rgba(0,0,0,.6));
  font-variant-numeric: tabular-nums; user-select: none; }
.dco-axis__title { font-weight: 600; color: var(--dsw-alias-label-primary, rgba(0,0,0,.85)); }
.dco-axis__cells { display: flex; flex: 1; gap: 2px; min-width: 80px; max-width: 420px; }
.dco-axis__cell { flex: 1; height: 6px; border-radius: 2px; background: var(--dsw-alias-bg-layer-3, rgba(0,0,0,.08)); }
.dco-axis__cell--folded { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.35)); }
.dco-axis__cell--now { background: var(--dsw-alias-label-primary, rgba(0,0,0,.85)); }
.dco-axis__meta { white-space: nowrap; opacity: .85; }
.dco-axis__sep { opacity: .35; }
body[data-ds-dark-theme] .dco-axis { color: var(--dsw-alias-label-secondary, rgba(255,255,255,.6)); }
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

    /** 从 chat 节点里数出折叠点与已折叠 token。字段名按优先级探测，读不到返回 null。 */
    function summarizeNodes(nodes) {
      const list = Array.isArray(nodes) ? nodes : []
      let folded = 0
      let foldedTokens = 0
      let tokensKnown = false
      const foldedTurns = new Set()
      for (const node of list) {
        const kind = String(node?.kind ?? '')
        if (!kind.includes('compaction')) continue
        folded += 1
        const turn = Number(node?.turn ?? node?.data?.turn)
        if (Number.isFinite(turn)) foldedTurns.add(turn)
        const candidates = [
          node?.data?.shadowedTokenCount,
          node?.data?.tokens,
          node?.tokens,
          node?.data?.data?.shadowedTokenCount,
        ]
        for (const value of candidates) {
          if (Number.isFinite(value)) { foldedTokens += Number(value); tokensKnown = true; break }
        }
      }
      return { folded, foldedTokens: tokensKnown ? foldedTokens : null, foldedTurns }
    }

    /** 生成轴格：每轮一格；落在已折叠区间内的轮次标暗。 */
    function axisCells(turns, foldedTurns) {
      const total = Math.max(0, Math.min(Number(turns) || 0, 80))
      const cells = []
      for (let turn = 1; turn <= total; turn += 1) {
        cells.push({ turn, folded: foldedTurns.has(turn), now: turn === total })
      }
      return cells
    }

    function formatTokens(value) {
      if (!Number.isFinite(value)) return '—'
      if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
      return String(value)
    }

    function translate(dict, template, params) {
      const text = dict[template] ?? template
      return text.replace(/\{(\w+)\}/g, (_, key) => String(params?.[key] ?? `{${key}}`))
    }

    // ── 组件 ───────────────────────────────────────────────────────────────

    const selectNodes = (state) => (state && state.legacy && state.legacy.nodes) || []

    function AxisRow(props) {
      const { useChat, useProjection, labels } = props
      const dict = (labels && typeof labels.get === 'function' ? labels.get() : undefined) ?? DICT.zh

      const nodes = typeof useChat === 'function' ? useChat(selectNodes) : []
      const stats = typeof useProjection === 'function' ? useProjection('sessionStats') : undefined
      const turns = Number(stats?.lastTurn ?? stats?.turns ?? 0)

      const summary = React.useMemo(() => summarizeNodes(nodes), [nodes])
      const cells = React.useMemo(() => axisCells(turns, summary.foldedTurns), [turns, summary.foldedTurns])

      const meta = summary.folded === 0
        ? translate(dict, 'noFold', {})
        : [
          translate(dict, 'folded', { n: summary.folded }),
          summary.foldedTokens === null ? null : translate(dict, 'foldedTokens', { t: formatTokens(summary.foldedTokens) }),
        ].filter(Boolean).join(' · ')

      return React.createElement('div', {
        className: 'dco-axis',
        title: translate(dict, 'hint', {}),
      },
      React.createElement('span', { className: 'dco-axis__title' }, translate(dict, 'title', {})),
      React.createElement('span', { className: 'dco-axis__cells' },
        cells.map((cell) => React.createElement('span', {
          key: cell.turn,
          className: `dco-axis__cell${cell.folded ? ' dco-axis__cell--folded' : ''}${cell.now ? ' dco-axis__cell--now' : ''}`,
        }))),
      React.createElement('span', { className: 'dco-axis__meta' }, meta),
      turns > 0
        ? React.createElement('span', { className: 'dco-axis__meta dco-axis__sep' }, translate(dict, 'turns', { n: turns }))
        : null)
    }

    // ── 挂载 ───────────────────────────────────────────────────────────────
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

      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'context-optimize-axis',
        order: 6,
        inject: () => ({ hooks: { labels } }),
      }, AxisRow))

      log(`ready (v${VERSION})：conversation.composer.dock#context-optimize-axis`)
    }

    // 仅供 test/ 使用：不参与运行时契约。
    const __internals = { NS, VERSION, DICT, summarizeNodes, axisCells, formatTokens, translate }

    return { name: NS, inject, apply, __internals }
  },
})
