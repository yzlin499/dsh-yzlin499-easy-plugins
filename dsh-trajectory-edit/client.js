// dsh-trajectory-edit — Client half
// 轨迹面板右键：编辑 / 自动清理某条记录。
//
// 一、触发：官方 Trajectory 表格行 `<tr data-trajectory-row-key>`，官方没有绑定
//    contextmenu（时间线的右键是平移手势，且与表格是兄弟节点，不冲突），所以本插件
//    用 document 捕获阶段做一层薄桥，解析行 key 后调用官方 `contextMenus.open()`。
//    菜单渲染、键盘导航、关闭、失败提示全部由官方负责。
//
// 二、行 key 解码（见 lib/records.mjs 同款实现）：
//    assistant\0<turn>\0<step> | <kind>\0call\0<callId> | <kind>\0seq\0<seq>
//    折叠摘要行（\0summary\0）与只有请求边界的行没有 data-record-index，跳过。
//
// 三、真正的写盘在 Host 半侧：本文件只负责弹窗、预览与二次确认。
//
// 依赖：contextMenus（硬）、slots（会话 id 探针 + 弹窗挂载）、locale（可选）。

window.__ModuleLoader__.load({
  id: 'dsh-trajectory-edit',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-trajectory-edit'
    const VERSION = '0.1.0'
    /** 文档相对路径：带前导斜杠会在目录前缀代理 / Electron 下跨源。 */
    const ROUTE = 'api/trajectory-edit'

    const DICT = {
      zh: {
        menuEdit: '编辑',
        menuClean: '自动清理',
        menuCleanRecord: '仅此条记录',
        menuCleanSession: '整个会话',
        titleEdit: '编辑记录',
        titleClean: '自动清理预览',
        busy: '该会话有未结束的轮次，先结束后再操作。',
        noEditable: '这条记录没有可编辑的文本。',
        toolRecord: '工具记录不提供编辑（防止破坏工具调用配对）。',
        blockReasoning: '思考',
        blockText: '正文',
        blockUser: '用户消息',
        cancel: '取消',
        save: '保存修改',
        clean: '清理这条',
        cleanSession: '清理整个会话',
        working: '正在写入…',
        preview: '预计减少 {removed} 字符（{percent}%）',
        doneEdit: '已写入。备份：{backup}',
        doneClean: '已清理。备份：{backup}',
        reloadHint: '重启 DSH（或重新打开该会话）后生效——Host 是 live 优先，内存里的旧上下文不会自动变新。',
        failed: '操作失败：{message}',
        empty: '内容不能为空。',
        close: '关闭',
      },
      en: {
        menuEdit: 'Edit',
        menuClean: 'Clean up',
        menuCleanRecord: 'This record',
        menuCleanSession: 'Entire session',
        titleEdit: 'Edit record',
        titleClean: 'Cleanup preview',
        busy: 'This session has an unfinished turn. Finish or stop it first.',
        noEditable: 'This record has no editable text.',
        toolRecord: 'Tool records are not editable (it would break tool-call pairing).',
        blockReasoning: 'Reasoning',
        blockText: 'Message',
        blockUser: 'User message',
        cancel: 'Cancel',
        save: 'Save',
        clean: 'Clean this record',
        cleanSession: 'Clean the session',
        working: 'Writing…',
        preview: 'About {removed} characters removed ({percent}%)',
        doneEdit: 'Written. Backup: {backup}',
        doneClean: 'Cleaned. Backup: {backup}',
        reloadHint: 'Restart DSH (or reopen this session) to see it — the Host is live-first, so the in-memory context stays stale.',
        failed: 'Failed: {message}',
        empty: 'Text must not be empty.',
        close: 'Close',
      },
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
     * 读取当前会话 id。优先用官方渲染的 `data-conversation-session`（
     * ConversationContent 在会话子树根上写入），拿不到再回退到 mainView 推导。
     * @returns {string | null} 会话 id。
     */
    function currentSessionId() {
      const node = document.querySelector('[data-conversation-session]')
      const fromDom = node?.getAttribute('data-conversation-session')
      if (typeof fromDom === 'string' && fromDom !== '') return fromDom
      return null
    }

    /**
     * 发一个同源请求。
     * @param {string} path - 文档相对路径。
     * @param {object} [init] - fetch 选项。
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
      if (menus === undefined || typeof menus.register !== 'function') {
        console.log(`[${NS}] contextMenus service unavailable — nothing to do`)
        return
      }
      const slots = ctx.get('slots')
      const locale = ctx.get('locale')
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
          if (options.scope === 'session') {
            const preview = await post(`${ROUTE}/apply`, {
              sessionId: options.sessionId,
              scope: 'session',
              dryRun: true,
            })
            store.set({ ...store.get(), loading: false, preview: preview.report, busy: false })
            return
          }
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

        const overlay = h('div', {
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
          t('preview', {
            removed: state.preview.removed ?? 0,
            percent: state.scope === 'session'
              ? Number((((state.preview.removed ?? 0) / Math.max(1, state.preview.removed ?? 1)) * 100).toFixed(1))
              : Number((((state.preview.removed ?? 0) / Math.max(1, (state.blocks[0]?.text ?? '').length)) * 100).toFixed(1)),
          })),
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
          && h('div', { style: { fontSize: '12px', opacity: 0.6 } },
            t(String(state.preview === null && state.busy ? 'busy' : 'noEditable'))),
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
          h('button', {
            type: 'button',
            onClick: close,
            style: buttonStyle(false),
          }, state.result === null ? t('cancel') : t('close')),
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
        return overlay
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

      // 弹窗挂进会话作用域：既拿到 sessionId，也保证跟随会话卸载。
      if (slots !== undefined && typeof slots.inject === 'function') {
        ctx.effect(() => slots.inject('conversation.composer.dock', () => slots.register({
          name: 'conversation.composer.dock',
          id: NS,
          order: 1200,
        }, Dialog)), `${NS}: dialog`)
      }

      // ── 右键桥 ────────────────────────────────────────────────────────
      const EDITABLE = 'input, textarea, [contenteditable=""], [contenteditable="true"]'

      /**
       * document 捕获阶段的 contextmenu 处理。
       * @param {MouseEvent} event - 原生事件。
       */
      function onContextMenu(event) {
        if (event?.button !== 2 || event.defaultPrevented === true) return
        const target = event.target
        if (target === null || typeof target.closest !== 'function') return
        // 时间线的右键是平移手势，交回官方。
        if (target.closest('[data-timeline-record-index], [data-timeline-domain]') !== null) return
        if (target.closest(EDITABLE) !== null) return
        if ((window.getSelection?.()?.toString?.() ?? '') !== '') return
        const row = target.closest('tr[data-trajectory-row-key]')
        if (row === null) return
        if (row.hasAttribute('data-collapsed-summary') || row.hasAttribute('data-request-only')) return
        const sessionId = currentSessionId()
        if (sessionId === null) {
          console.log(`[${NS}] session id unknown — skip`)
          return
        }
        const key = row.getAttribute('data-trajectory-row-key')
        const identity = parseRecordKey(key)
        if (identity.type === 'summary' || identity.type === 'unknown') return
        event.preventDefault()
        try {
          menus.open({ kind: 'trajectory-record', value: { sessionId, key } }, {
            x: event.clientX ?? 0,
            y: event.clientY ?? 0,
          })
        } catch (error) {
          console.log(`[${NS}] open menu failed:`, error?.message ?? error)
        }
      }

      ctx.effect(() => {
        document.addEventListener('contextmenu', onContextMenu, true)
        return () => document.removeEventListener('contextmenu', onContextMenu, true)
      }, `${NS}: row bridge`)

      console.log(`[${NS}] ready (v${VERSION})`)
    }

    // 仅供 test/ 使用：不参与运行时契约。
    return {
      name: NS,
      inject: ['contextMenus', 'slots', 'locale'],
      apply,
      __internals: { NS, VERSION, DICT, ROUTE, parseRecordKey, currentSessionId },
    }
  },
})
