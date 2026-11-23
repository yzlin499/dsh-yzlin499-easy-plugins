// dsh-trajectory-edit — Client half
// 轨迹面板右键：编辑 / 自动清理某条记录。
//
// 一、触发（三条入口，任一条可用即可）：
//    ① 表格行右键 —— document/window 捕获阶段，命中 `tr[data-trajectory-row-key]`
//       后调用官方 `contextMenus.open()`
//    ② 行聚焦时的 Shift+F10 / 菜单键 —— 官方 getTriggerProps 的键盘等价物
//    ③ 选中行后出现在输入框上方的「轨迹编辑」按钮 —— 右键被别的层吃掉时的兜底
//
// 二、行 key 解码（与 lib/records.mjs 同款实现）：
//    assistant\0<turn>\0<step> | <kind>\0call\0<callId> | <kind>\0seq\0<seq>
//    折叠摘要行（\0summary\0）与只有请求边界的行没有 data-record-index，跳过。
//
// 三、诊断：所有跳过的原因都写进 `window.__TRAJECTORY_EDIT__`，
//    排查时在控制台执行 `__TRAJECTORY_EDIT__` 即可看到。
//
// 四、真正的写盘在 Host 半侧：本文件只负责弹窗、预览与二次确认。
//
// 依赖：contextMenus（硬）、slots（会话 id 探针 + 弹窗挂载）、locale（可选）。

window.__ModuleLoader__.load({
  id: 'dsh-trajectory-edit',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-trajectory-edit'
    const VERSION = '0.1.1'
    /** 文档相对路径：带前导斜杠会在目录前缀代理 / Electron 下跨源。 */
    const ROUTE = 'api/trajectory-edit'
    /** 表格行的稳定锚点（官方 Trajectory 渲染）。 */
    const ROW = 'tr[data-trajectory-row-key]'
    const SESSION_ATTR = 'data-conversation-session'
    const EDITABLE = 'input, textarea, [contenteditable=""], [contenteditable="true"]'

    const DICT = {
      zh: {
        menuEdit: '编辑',
        menuClean: '自动清理',
        menuCleanRecord: '仅此条记录',
        menuCleanSession: '整个会话',
        dockButton: '轨迹编辑',
        titleEdit: '编辑记录',
        titleClean: '自动清理预览',
        busy: '该会话有未结束的轮次，先结束后再操作。',
        noEditable: '这条记录没有可编辑的文本。',
        blockReasoning: '思考',
        blockText: '正文',
        blockUser: '用户消息',
        cancel: '取消',
        save: '保存修改',
        clean: '清理这条',
        cleanSession: '清理整个会话',
        working: '正在写入…',
        preview: '预计减少 {removed} 字符',
        doneEdit: '已写入。备份：{backup}',
        doneClean: '已清理。备份：{backup}',
        reloadHint: '重启 DSH（或重新打开该会话）后生效——Host 是 live 优先，内存里的旧上下文不会自动变新。',
        failed: '操作失败：{message}',
        close: '关闭',
      },
      en: {
        menuEdit: 'Edit',
        menuClean: 'Clean up',
        menuCleanRecord: 'This record',
        menuCleanSession: 'Entire session',
        dockButton: 'Edit record',
        titleEdit: 'Edit record',
        titleClean: 'Cleanup preview',
        busy: 'This session has an unfinished turn. Finish or stop it first.',
        noEditable: 'This record has no editable text.',
        blockReasoning: 'Reasoning',
        blockText: 'Message',
        blockUser: 'User message',
        cancel: 'Cancel',
        save: 'Save',
        clean: 'Clean this record',
        cleanSession: 'Clean the session',
        working: 'Writing…',
        preview: 'About {removed} characters removed',
        doneEdit: 'Written. Backup: {backup}',
        doneClean: 'Cleaned. Backup: {backup}',
        reloadHint: 'Restart DSH (or reopen this session) to see it — the Host is live-first, so the in-memory context stays stale.',
        failed: 'Failed: {message}',
        close: 'Close',
      },
    }

    /** 诊断对象：排查时在控制台读它。 */
    const debug = {
      version: VERSION,
      phase: 'factory',
      menus: false,
      slots: false,
      bridge: false,
      dock: false,
      sessionId: null,
      last: null,
      skips: [],
    }
    try {
      window.__TRAJECTORY_EDIT__ = debug
    } catch {
      /* 非浏览器环境忽略 */
    }

    /**
     * 极简快照 store：组件通过 useSyncExternalStore 订阅。
     * @returns {{get: () => object, set: (patch: object) => void, subscribe: (fn: () => void) => () => void}}
     */
    function createStore() {
      let state = {
        open: false,
        mode: 'edit',
        scope: 'record',
        sessionId: null,
        key: null,
        busy: false,
        loading: false,
        saving: false,
        blocks: [],
        drafts: [],
        preview: null,
        result: null,
        error: null,
      }
      const listeners = new Set()
      return {
        get: () => state,
        set: (patch) => {
          state = { ...state, ...patch }
          for (const listener of listeners) listener()
        },
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    }

    /**
     * 解析轨迹行 key（与 Host 侧 records.mjs 保持一致）。
     * @param {string} rawKey - `data-trajectory-row-key` 原值。
     * @returns {{type: string, kind: string, turn?: number, step?: number, callId?: string, seq?: number}}
     */
    function parseRecordKey(rawKey) {
      let decoded
      try {
        decoded = decodeURIComponent(String(rawKey ?? ''))
      } catch {
        return { type: 'unknown', kind: 'unknown' }
      }
      if (decoded.includes('\u0000summary\u0000')) {
        return { type: 'summary', kind: decoded.split('\u0000')[0] ?? 'unknown' }
      }
      const parts = decoded.split('\u0000')
      if (parts.length === 3 && parts[0] === 'assistant') {
        return { type: 'assistant', kind: 'assistant', turn: Number(parts[1]), step: Number(parts[2]) }
      }
      if (parts.length === 3 && parts[1] === 'call') {
        return { type: 'call', kind: parts[0] ?? 'tool', callId: parts[2] }
      }
      if (parts.length === 3 && parts[1] === 'seq') {
        return { type: 'seq', kind: parts[0] ?? 'event', seq: Number(parts[2]) }
      }
      return { type: 'unknown', kind: parts[0] ?? 'unknown' }
    }

    /**
     * 读取某个元素所属会话的 id：先沿祖先找 `data-conversation-session`，
     * 再退回全文档查询（桌面端页面挂在 dsh-app:// 下，两者行为一致）。
     * @param {Element | null} [from] - 起始元素。
     * @returns {string | null} 会话 id。
     */
    function sessionIdOf(from) {
      try {
        const holder = from?.closest?.(`[${SESSION_ATTR}]`)
        const fromAncestor = holder?.getAttribute?.(SESSION_ATTR)
        if (typeof fromAncestor === 'string' && fromAncestor !== '') return fromAncestor
      } catch {
        /* 忽略 */
      }
      const node = document.querySelector(`[${SESSION_ATTR}]`)
      const value = node?.getAttribute?.(SESSION_ATTR)
      return typeof value === 'string' && value !== '' ? value : null
    }

    /**
     * 记录一次跳过原因（保留最近 20 条）。
     * @param {string} reason - 机器可读原因。
     * @param {object} [detail] - 附加信息。
     */
    function skip(reason, detail) {
      debug.skips.push({ reason, at: Date.now(), ...detail })
      if (debug.skips.length > 20) debug.skips.shift()
      debug.last = reason
    }

    /**
     * 发一个同源请求。
     * @param {string} path - 文档相对路径。
     * @param {object} body - JSON 请求体。
     * @returns {Promise<any>} 解析后的 JSON。
     */
    async function post(path, body) {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok || payload?.ok !== true) {
        const message = payload?.error?.message ?? `HTTP ${response.status}`
        throw new Error(message)
      }
      return payload
    }

    function apply(ctx) {
      const menus = ctx.get('contextMenus')
      const slots = ctx.get('slots')
      const locale = ctx.get('locale')
      if (menus === undefined || typeof menus.register !== 'function') {
        debug.phase = 'no-contextMenus'
        console.log(`[${NS}] contextMenus service unavailable — nothing to do`)
        return
      }
      debug.menus = true
      debug.slots = slots !== undefined && typeof slots.inject === 'function'
      const store = createStore()

      let dict = DICT.zh
      const readLocale = () => {
        dict = locale?.getLocale?.().active === 'en' ? DICT.en : DICT.zh
      }
      readLocale()
      if (typeof locale?.subscribe === 'function') {
        ctx.effect(() => locale.subscribe(readLocale), `${NS}: locale follow`)
      }
      /** 取词条并做 `{name}` 插值。 */
      const t = (key, params) => {
        const template = typeof dict[key] === 'string' ? dict[key] : key
        return params === undefined
          ? template
          : template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
      }

      // ── 弹窗数据流 ────────────────────────────────────────────────────
      /**
       * 打开弹窗：拉记录信息，清理模式再拉一份 dry-run 预览。
       * @param {{sessionId: string, key: string, mode: 'edit' | 'clean', scope: 'record' | 'session'}} options - 打开参数。
       */
      async function open(options) {
        debug.last = `open:${options.mode}:${options.scope}`
        store.set({
          ...store.get(),
          open: true,
          mode: options.mode,
          scope: options.scope,
          sessionId: options.sessionId,
          key: options.key,
          loading: true,
          saving: false,
          blocks: [],
          drafts: [],
          preview: null,
          result: null,
          error: null,
        })
        try {
          const record = await post(`${ROUTE}/record`, {
            sessionId: options.sessionId,
            key: options.key,
          })
          const blocks = record.record.blocks ?? []
          const drafts = blocks.map(block => block.text)
          let preview = null
          if (options.mode === 'clean' && record.meta.busy !== true) {
            const dry = await post(`${ROUTE}/apply`, {
              sessionId: options.sessionId,
              key: options.key,
              scope: 'record',
              dryRun: true,
            })
            preview = dry.report
          }
          store.set({
            ...store.get(),
            loading: false,
            busy: record.meta.busy === true,
            blocks,
            drafts,
            preview,
          })
        } catch (error) {
          store.set({
            ...store.get(),
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      /** 提交编辑或清理。 */
      async function submit() {
        const state = store.get()
        store.set({ ...state, saving: true, error: null })
        try {
          const body = state.scope === 'session'
            ? { sessionId: state.sessionId, scope: 'session' }
            : state.mode === 'edit'
              ? {
                sessionId: state.sessionId,
                key: state.key,
                scope: 'record',
                edits: state.blocks.map((block, index) => ({
                  blockIndex: block.blockIndex,
                  text: state.drafts[index] ?? '',
                })),
              }
              : { sessionId: state.sessionId, key: state.key, scope: 'record' }
          const result = await post(`${ROUTE}/apply`, body)
          store.set({ ...store.get(), saving: false, result })
        } catch (error) {
          store.set({
            ...store.get(),
            saving: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      /** 关闭弹窗。 */
      function close() {
        store.set({ ...store.get(), open: false, result: null, error: null })
      }

      // ── 弹窗组件 ──────────────────────────────────────────────────────
      function useStore() {
        return React.useSyncExternalStore(store.subscribe, store.get, store.get)
      }

      /**
       * 对话框按钮样式。
       * @param {boolean} primary - 主按钮。
       * @param {boolean} [disabled] - 禁用态。
       * @returns {object} style 对象。
       */
      function buttonStyle(primary, disabled = false) {
        return {
          font: 'inherit',
          fontSize: '12px',
          lineHeight: '20px',
          padding: '4px 12px',
          borderRadius: '8px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          color: primary
            ? 'var(--dsw-alias-button-primary-fill-label, #fff)'
            : 'var(--dsw-alias-label-primary, inherit)',
          background: primary
            ? 'var(--dsw-alias-button-primary-fill, #247bbf)'
            : 'transparent',
          border: primary
            ? 'none'
            : '0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.4))',
        }
      }

      function Dialog() {
        const state = useStore()
        React.useEffect(() => {
          if (!state.open) return undefined
          const onKey = (event) => {
            if (event.key === 'Escape') close()
          }
          document.addEventListener('keydown', onKey, true)
          return () => document.removeEventListener('keydown', onKey, true)
        }, [state.open])
        if (!state.open) return null

        const title = state.mode === 'edit' ? t('titleEdit') : t('titleClean')
        const canSubmit = !state.loading && !state.saving && !state.busy
          && (state.scope === 'session' || state.blocks.length > 0)
          && state.result === null

        return h('div', {
          role: 'presentation',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) close()
          },
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            display: 'grid',
            placeItems: 'center',
            background: 'var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.35))',
            padding: '24px',
          },
        }, h('div', {
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': title,
          style: {
            width: 'min(880px, 100%)',
            maxHeight: 'min(80vh, 900px)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            padding: '16px',
            borderRadius: '14px',
            border: '0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))',
            background: 'var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-overlay, #1c1c1e))',
            color: 'var(--dsw-alias-label-primary, inherit)',
            boxShadow: 'var(--dsw-elevation-panel, 0 12px 40px rgba(0,0,0,0.4))',
          },
        },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h('strong', { style: { fontSize: '14px' } }, title),
          h('span', { style: { fontSize: '12px', opacity: 0.6 } },
            `${state.key ?? ''}${state.scope === 'session' ? ' · session' : ''}`)),
        state.busy && h('div', { style: { color: 'var(--dsw-alias-state-warn, #d08b00)', fontSize: '12px' } }, t('busy')),
        state.error !== null && h('div', { style: { color: 'var(--dsw-alias-state-danger, #d9534f)', fontSize: '12px' } }, t('failed', { message: state.error })),
        state.result !== null && h('div', { style: { fontSize: '12px', lineHeight: 1.6 } },
          h('div', { style: { color: 'var(--dsw-alias-state-success, #3fa45b)' } },
            t(state.mode === 'edit' ? 'doneEdit' : 'doneClean', { backup: state.result.backup ?? '(none)' })),
          h('div', { style: { opacity: 0.7, marginTop: '4px' } }, t('reloadHint'))),
        state.preview !== null && state.result === null && h('div', { style: { fontSize: '12px', opacity: 0.8 } },
          t('preview', { removed: state.preview.removed ?? 0 })),
        h('div', {
          style: {
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            minHeight: '80px',
          },
        },
        state.loading && h('div', { style: { fontSize: '12px', opacity: 0.6 } }, t('working')),
        state.scope === 'record' && !state.loading && state.blocks.length === 0
          && h('div', { style: { fontSize: '12px', opacity: 0.6 } }, t('noEditable')),
        state.scope === 'record' && state.blocks.map((block, index) => h('label', {
          key: String(block.blockIndex),
          style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' },
        },
        h('span', { style: { opacity: 0.7 } },
          `${block.type === 'reasoning' ? t('blockReasoning') : block.type === 'text' ? t('blockText') : block.type} · #${block.blockIndex} · ${block.text.length} chars`),
        h('textarea', {
          value: state.drafts[index] ?? '',
          readOnly: state.mode === 'clean' || state.saving || state.result !== null,
          onChange: (event) => {
            const drafts = [...store.get().drafts]
            drafts[index] = event.target.value
            store.set({ ...store.get(), drafts })
          },
          spellCheck: false,
          style: {
            width: '100%',
            minHeight: '120px',
            resize: 'vertical',
            font: 'inherit',
            fontSize: '12px',
            lineHeight: 1.5,
            padding: '8px',
            borderRadius: '8px',
            border: '0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))',
            background: 'var(--dsw-alias-bg-base, rgba(0,0,0,0.2))',
            color: 'inherit',
          },
        })))),
        h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } },
          h('button', { type: 'button', onClick: close, style: buttonStyle(false) },
            state.result === null ? t('cancel') : t('close')),
          state.result === null && h('button', {
            type: 'button',
            disabled: !canSubmit,
            onClick: () => { void submit() },
            style: buttonStyle(true, !canSubmit),
          }, state.saving
            ? t('working')
            : state.scope === 'session'
              ? t('cleanSession')
              : state.mode === 'edit' ? t('save') : t('clean')),
        )))
      }

      // ── 兜底入口：选中行时出现在输入框上方 ──────────────────────────────
      /**
       * 会话作用域的挂载点：既拿 sessionId 探针，也渲染兜底按钮 + 弹窗。
       * @param {{sessionId?: string}} props - 框架注入的标准 props。
       * @returns {import('react').ReactElement | null} 渲染结果。
       */
      function Surface(props) {
        const sessionId = typeof props?.sessionId === 'string' ? props.sessionId : null
        const [rowKey, setRowKey] = React.useState(null)
        React.useEffect(() => {
          if (sessionId !== null) {
            debug.sessionId = sessionId
            debug.dock = true
          }
          const read = () => {
            const row = document.querySelector(`tr[data-selected][data-trajectory-row-key]`)
            setRowKey(row === null ? null : row.getAttribute('data-trajectory-row-key'))
          }
          read()
          if (typeof MutationObserver === 'undefined') return undefined
          const observer = new MutationObserver(read)
          observer.observe(document.body, {
            subtree: true,
            attributes: true,
            attributeFilter: ['data-selected'],
          })
          return () => observer.disconnect()
        }, [sessionId])

        return h(React.Fragment, null,
          rowKey !== null && sessionId !== null && h('button', {
            type: 'button',
            title: t('menuEdit'),
            onClick: () => { void open({ sessionId, key: rowKey, mode: 'edit', scope: 'record' }) },
            style: {
              position: 'fixed',
              right: '16px',
              bottom: '120px',
              zIndex: 40,
              font: 'inherit',
              fontSize: '12px',
              lineHeight: '20px',
              padding: '4px 12px',
              borderRadius: '999px',
              cursor: 'pointer',
              color: 'var(--dsw-alias-label-primary, inherit)',
              background: 'var(--dsw-alias-button-floating-fill, rgba(127,127,127,0.18))',
              border: '0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.4))',
            },
          }, t('dockButton')),
          h(Dialog))
      }

      // ── 菜单贡献 ──────────────────────────────────────────────────────
      ctx.effect(() => menus.register({
        id: `${NS}.record`,
        target: 'trajectory-record',
        order: 100,
        resolve: async (target) => {
          const sessionId = target?.value?.sessionId
          const key = target?.value?.key
          if (typeof sessionId !== 'string' || typeof key !== 'string') return []
          return [
            {
              id: 'edit',
              label: t('menuEdit'),
              run: () => open({ sessionId, key, mode: 'edit', scope: 'record' }),
            },
            {
              id: 'clean',
              label: t('menuClean'),
              separatorBefore: true,
              children: [
                {
                  id: 'clean-record',
                  label: t('menuCleanRecord'),
                  run: () => open({ sessionId, key, mode: 'clean', scope: 'record' }),
                },
                {
                  id: 'clean-session',
                  label: t('menuCleanSession'),
                  run: () => open({ sessionId, key, mode: 'clean', scope: 'session' }),
                },
              ],
            },
          ]
        },
      }), `${NS}: record menu`)

      if (slots !== undefined && typeof slots.inject === 'function') {
        ctx.effect(() => slots.inject('conversation.composer.dock', () => slots.register({
          name: 'conversation.composer.dock',
          id: NS,
          order: 1200,
        }, Surface)), `${NS}: dock surface`)
      }

      // ── 右键桥 + 键盘等价物 ───────────────────────────────────────────
      /**
       * 从事件目标解析出可打开的轨迹行。
       * @param {Event} event - 原生事件。
       * @returns {{row: HTMLElement, key: string} | null} 命中结果。
       */
      function resolveRow(event) {
        const target = event?.target
        if (target === null || typeof target?.closest !== 'function') {
          skip('no-target')
          return null
        }
        if (target.closest('[data-timeline-record-index], [data-timeline-domain]') !== null) {
          skip('timeline')
          return null
        }
        if (target.closest(EDITABLE) !== null) {
          skip('editable')
          return null
        }
        const row = target.closest(ROW)
        if (row === null) {
          skip('no-row')
          return null
        }
        if (row.hasAttribute('data-collapsed-summary') || row.hasAttribute('data-request-only')) {
          skip('summary-or-boundary')
          return null
        }
        const key = row.getAttribute('data-trajectory-row-key')
        if (typeof key !== 'string' || key === '') {
          skip('no-key')
          return null
        }
        return { row, key }
      }

      /**
       * 打开官方菜单。
       * @param {HTMLElement} row - 命中的行。
       * @param {string} key - 行 key。
       * @param {number} x - 视口横坐标。
       * @param {number} y - 视口纵坐标。
       */
      function openMenu(row, key, x, y) {
        const sessionId = sessionIdOf(row)
        if (sessionId === null) {
          skip('no-session-id')
          return
        }
        debug.sessionId = sessionId
        debug.last = `menu:${key}`
        try {
          menus.open({ kind: 'trajectory-record', value: { sessionId, key } }, { x, y })
        } catch (error) {
          debug.last = `open-failed:${error?.message ?? error}`
          console.log(`[${NS}] open menu failed:`, error?.message ?? error)
        }
      }

      /**
       * 鼠标右键。
       * @param {MouseEvent} event - 原生事件。
       */
      function onContextMenu(event) {
        if (event?.button !== 2 || event.defaultPrevented === true) return
        if ((window.getSelection?.()?.toString?.() ?? '') !== '') {
          skip('selection')
          return
        }
        const hit = resolveRow(event)
        if (hit === null) return
        event.preventDefault()
        event.stopPropagation()
        openMenu(hit.row, hit.key, event.clientX ?? 0, event.clientY ?? 0)
      }

      /**
       * 键盘等价物：行聚焦时的 Shift+F10 / 菜单键。
       * @param {KeyboardEvent} event - 原生事件。
       */
      function onKeyDown(event) {
        const isMenuKey = event?.key === 'ContextMenu' || (event?.key === 'F10' && event.shiftKey === true)
        if (!isMenuKey || event.defaultPrevented === true) return
        const hit = resolveRow(event)
        if (hit === null) return
        event.preventDefault()
        const rect = hit.row.getBoundingClientRect()
        openMenu(hit.row, hit.key, rect.left + 24, rect.bottom)
      }

      // window 捕获阶段先于任何元素级处理器，避免被上层 stopPropagation 吃掉。
      ctx.effect(() => {
        window.addEventListener('contextmenu', onContextMenu, true)
        window.addEventListener('keydown', onKeyDown, true)
        debug.bridge = true
        return () => {
          window.removeEventListener('contextmenu', onContextMenu, true)
          window.removeEventListener('keydown', onKeyDown, true)
          debug.bridge = false
        }
      }, `${NS}: row bridge`)

      debug.phase = 'ready'
      console.log(`[${NS}] ready (v${VERSION}) — 右键 / Shift+F10 / 选中行后的「${t('dockButton')}」按钮`)
    }

    // 仅供 test/ 使用：不参与运行时契约。
    return {
      name: NS,
      inject: ['contextMenus', 'slots', 'locale'],
      apply,
      __internals: { NS, VERSION, DICT, ROUTE, ROW, parseRecordKey, sessionIdOf, debug },
    }
  },
})
