window.__ModuleLoader__.load({
  id: 'dsh-svn-manager',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    const zh = {
      title: 'SVN', refresh: '刷新', updating: '更新中', update: '更新', loading: '加载中…',
      notWorkingCopy: '当前会话工作区不是 SVN 工作副本。', unavailable: '无法连接 SVN 管理服务。',
      conflicts: '冲突', changes: '待提交变更', unversioned: '未纳管文件', history: '提交记录',
      empty: '没有变更', add: '纳入版本控制', revert: '还原', openFile: '打开文件',
      commitPlaceholder: '提交说明', commit: '提交', loadMore: '加载更多', noHistory: '没有提交记录',
      repository: '仓库', revision: '工作副本版本', confirm: '确认', cancel: '取消',
      revertTitle: '还原本地变更？', revertDesc: '这会丢弃“{path}”的本地修改，无法从 SVN 工作副本恢复。',
      updateTitle: '更新工作副本？', updateDesc: 'SVN 将从仓库合并最新内容，本地修改可能产生冲突。',
      commandDone: '操作完成', diffEmpty: '没有可显示的文本差异。', diffError: '差异加载失败', diffTruncated: '差异过大，仅显示前 10,000 行。',
      copied: '复制', switched: '切换', property: '属性', treeConflict: '树冲突',
      loadError: '加载失败', commitError: '提交失败', actionError: '操作失败',
      statusTruncated: '状态项过多，仅显示前 {shown} 项；冲突和已纳管变更优先。',
      unversionedSuppressed: '未纳管文件数量过多，已隐藏未纳管列表；请配置 svn:ignore 后刷新。',
    }
    const en = {
      title: 'SVN', refresh: 'Refresh', updating: 'Updating', update: 'Update', loading: 'Loading…',
      notWorkingCopy: 'The current session workspace is not an SVN working copy.', unavailable: 'Cannot reach the SVN manager service.',
      conflicts: 'Conflicts', changes: 'Changes to commit', unversioned: 'Unversioned', history: 'History',
      empty: 'No changes', add: 'Add', revert: 'Revert', openFile: 'Open file',
      commitPlaceholder: 'Commit message', commit: 'Commit', loadMore: 'Load more', noHistory: 'No history',
      repository: 'Repository', revision: 'Working revision', confirm: 'Confirm', cancel: 'Cancel',
      revertTitle: 'Revert local changes?', revertDesc: 'This discards local changes to “{path}” and cannot be recovered from the working copy.',
      updateTitle: 'Update working copy?', updateDesc: 'SVN will merge repository changes and local modifications may conflict.',
      commandDone: 'Operation completed', diffEmpty: 'No text differences to display.', diffError: 'Failed to load diff', diffTruncated: 'The diff is large; only the first 10,000 lines are shown.',
      copied: 'Copied', switched: 'Switched', property: 'Properties', treeConflict: 'Tree conflict',
      loadError: 'Load failed', commitError: 'Commit failed', actionError: 'Action failed',
      statusTruncated: 'Too many status entries; showing the first {shown}, prioritizing conflicts and versioned changes.',
      unversionedSuppressed: 'Too many unversioned paths; they are hidden. Configure svn:ignore and refresh.',
    }

    function localeOf(ctx) {
      const active = ctx.locale?.getLocale?.().active ?? ctx.locale?.getSnapshot?.().active ?? 'zh'
      return String(active).toLowerCase().startsWith('en') ? 'en' : 'zh'
    }

    function useLocale(ctx) {
      const [locale, setLocale] = React.useState(() => localeOf(ctx))
      React.useEffect(() => {
        const update = () => setLocale(localeOf(ctx))
        const off = ctx.locale?.subscribe?.(update)
        return typeof off === 'function' ? off : undefined
      }, [ctx])
      return locale === 'en' ? en : zh
    }

    class ApiError extends Error {
      constructor(code, message) { super(message); this.code = code }
    }

    async function api(method, payload, signal) {
      let response
      try {
        response = await fetch(`/svn-manager/api/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal,
        })
      } catch (error) {
        if (error?.name === 'AbortError') throw error
        throw new ApiError('network', error instanceof Error ? error.message : String(error))
      }
      const parsed = await response.json().catch(() => null)
      if (!response.ok || parsed?.ok !== true) {
        throw new ApiError(parsed?.error?.code ?? 'http', parsed?.error?.message ?? `HTTP ${response.status}`)
      }
      return parsed.value
    }

    function icon(kind, size = 16) {
      const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
      const paths = {
        refresh: [h('path', { key: 1, d: 'M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5' }), h('path', { key: 2, d: 'M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5' })],
        update: [h('path', { key: 1, d: 'M12 3v13' }), h('path', { key: 2, d: 'm7 11 5 5 5-5' }), h('path', { key: 3, d: 'M5 21h14' })],
        file: [h('path', { key: 1, d: 'M14 2H6a2 2 0 0 0-2 2v16h16V8z' }), h('path', { key: 2, d: 'M14 2v6h6' })],
        plus: [h('path', { key: 1, d: 'M12 5v14M5 12h14' })],
        undo: [h('path', { key: 1, d: 'm9 14-4-4 4-4' }), h('path', { key: 2, d: 'M5 10h8a6 6 0 0 1 6 6v2' })],
        branch: [h('circle', { key: 1, cx: 6, cy: 5, r: 2 }), h('circle', { key: 2, cx: 18, cy: 6, r: 2 }), h('circle', { key: 3, cx: 6, cy: 19, r: 2 }), h('path', { key: 4, d: 'M6 7v10M8 10c5 0 8-1 8-4' })],
      }
      return h('svg', common, ...(paths[kind] ?? paths.branch))
    }

    function baseName(path) {
      const index = Math.max(String(path).lastIndexOf('/'), String(path).lastIndexOf('\\'))
      return index < 0 ? String(path) : String(path).slice(index + 1)
    }

    function statusBadge(entry) {
      const map = { modified: 'M', added: 'A', deleted: 'D', replaced: 'R', conflicted: 'C', missing: '!', obstructed: '~', incomplete: '!' }
      return map[entry.item] ?? (entry.props === 'modified' ? 'P' : '?')
    }

    function classify(entries) {
      const conflicts = []
      const changes = []
      const unversioned = []
      for (const entry of entries ?? []) {
        if (entry.item === 'unversioned') unversioned.push(entry)
        else if (entry.treeConflicted || ['conflicted', 'obstructed', 'incomplete'].includes(entry.item) || entry.props === 'conflicted') conflicts.push(entry)
        else if (!['normal', 'none', 'ignored', 'external'].includes(entry.item) || !['normal', 'none'].includes(entry.props)) changes.push(entry)
      }
      return { conflicts, changes, unversioned }
    }

    function ConfirmDialog({ state, labels, busy, onClose }) {
      if (!state) return null
      return h('div', { className: 'svnm-mask', role: 'presentation', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() } },
        h('div', { className: 'svnm-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'svnm-dialog-title' },
          h('div', { id: 'svnm-dialog-title', className: 'svnm-dialog-title' }, state.title),
          h('div', { className: 'svnm-dialog-desc' }, state.description),
          h('div', { className: 'svnm-dialog-actions' },
            h('button', { type: 'button', className: 'svnm-btn', disabled: busy, onClick: onClose }, labels.cancel),
            h('button', { type: 'button', className: 'svnm-btn svnm-primary svnm-danger', disabled: busy, onClick: state.onConfirm }, labels.confirm),
          ),
        ),
      )
    }

    function ChangeSection({ title, entries, kind, labels, busy, onDiff, onOpen, onAction }) {
      return h('section', { className: 'svnm-section' },
        h('div', { className: 'svnm-section-head' }, h('span', null, `${title} (${entries.length})`)),
        entries.length === 0 ? h('div', { className: 'svnm-empty' }, labels.empty) : null,
        entries.map((entry) => h('div', { className: `svnm-change svnm-${kind}`, key: `${kind}:${entry.path}` },
          h('button', {
            type: 'button', className: 'svnm-change-main', title: entry.path,
            onClick: () => kind === 'unversioned' ? onOpen(entry.path) : onDiff(entry.path),
          },
            h('span', { className: 'svnm-badge' }, statusBadge(entry)),
            h('span', { className: 'svnm-path' }, entry.path),
            entry.props === 'modified' ? h('span', { className: 'svnm-flag', title: labels.property }, 'P') : null,
            entry.copied ? h('span', { className: 'svnm-flag', title: labels.copied }, '+') : null,
            entry.switched ? h('span', { className: 'svnm-flag', title: labels.switched }, 'S') : null,
          ),
          h('button', { type: 'button', className: 'svnm-icon-btn', title: labels.openFile, 'aria-label': labels.openFile, onClick: () => onOpen(entry.path) }, icon('file', 14)),
          h('button', {
            type: 'button', className: 'svnm-icon-btn', disabled: busy,
            title: kind === 'unversioned' ? labels.add : labels.revert,
            'aria-label': kind === 'unversioned' ? labels.add : labels.revert,
            onClick: () => onAction(entry, kind),
          }, icon(kind === 'unversioned' ? 'plus' : 'undo', 14)),
        )),
      )
    }

    function SvnView(props) {
      const labels = useLocale(props.ctx)
      const scope = props.scope
      const service = props.ctx.betterSidebar
      const [snapshot, setSnapshot] = React.useState(null)
      const [history, setHistory] = React.useState([])
      const [historyEnded, setHistoryEnded] = React.useState(false)
      const [loading, setLoading] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [message, setMessage] = React.useState('')
      const [confirmState, setConfirmState] = React.useState(null)

      const payload = React.useCallback((extra = {}) => ({ sessionId: scope.sessionId, ...extra }), [scope.sessionId])
      const refresh = React.useCallback(async (signal) => {
        setLoading(true)
        setError(null)
        try {
          const next = await api('status', payload(), signal)
          setSnapshot(next)
          if (next.info?.isWorkingCopy) {
            try {
              const rows = await api('log', payload({ limit: 20 }), signal)
              setHistory(rows)
              setHistoryEnded(rows.length < 20)
            } catch (caught) {
              if (caught?.name === 'AbortError') throw caught
              setHistory([])
              setHistoryEnded(true)
              setError(caught instanceof Error ? caught.message : String(caught))
            }
          } else {
            setHistory([])
            setHistoryEnded(true)
          }
        } catch (caught) {
          if (caught?.name !== 'AbortError') setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          if (!signal?.aborted) setLoading(false)
        }
      }, [payload])

      React.useEffect(() => {
        if (!props.visible) return undefined
        const controller = new AbortController()
        void refresh(controller.signal)
        return () => controller.abort()
      }, [props.visible, refresh])

      const run = async (method, extra, success, after) => {
        setBusy(true); setError(null); setNotice(null)
        try {
          const result = await api(method, payload(extra))
          setNotice(result?.output || success)
          if (after) after()
          await refresh()
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        } finally { setBusy(false) }
      }

      const absolutePath = (path) => {
        const root = String(snapshot?.info?.wcRoot || scope.cwd || '')
        if (!root || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\')) return path
        const separator = root.includes('\\') ? '\\' : '/'
        return `${root.replace(/[\\/]+$/, '')}${separator}${String(path).replace(/^[\\/]+/, '').replace(/[\\/]/g, separator)}`
      }
      const openFile = (path) => {
        const target = absolutePath(path)
        if (service.features?.includes('openFile')) service.openFile(scope, target, baseName(path))
        else service.openTab({ type: 'editor', id: `editor:${target}`, path: target, title: baseName(path) }, scope)
      }
      const openDiff = (path) => service.openTab({
        type: 'dsh-svn-manager:diff', id: `dsh-svn-manager:diff:working:${path}`, title: baseName(path),
        meta: { kind: 'working', path },
      }, scope)
      const openRevision = (entry) => service.openTab({
        type: 'dsh-svn-manager:diff', id: `dsh-svn-manager:diff:revision:${entry.revision}`,
        title: `r${entry.revision} ${entry.message || ''}`.trim(), meta: { kind: 'revision', revision: entry.revision },
      }, scope)
      const action = (entry, kind) => {
        if (kind === 'unversioned') { void run('add', { paths: [entry.path], confirm: true }, labels.commandDone); return }
        setConfirmState({
          title: labels.revertTitle,
          description: labels.revertDesc.replace('{path}', entry.path),
          onConfirm: () => { setConfirmState(null); void run('revert', { paths: [entry.path], confirm: true }, labels.commandDone) },
        })
      }
      const loadMore = async () => {
        const last = history[history.length - 1]
        if (!last || busy) return
        const start = String(Math.max(Number(last.revision) - 1, 1))
        setBusy(true)
        try {
          const rows = await api('log', payload({ limit: 20, startRevision: start }))
          setHistory((current) => [...current, ...rows])
          if (rows.length < 20) setHistoryEnded(true)
        } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
        finally { setBusy(false) }
      }

      if (loading && snapshot === null) return h('div', { className: 'svnm-placeholder' }, labels.loading)
      if (error && snapshot === null) return h('div', { className: 'svnm-error svnm-pad' }, `${labels.loadError}: ${error}`)
      if (snapshot && !snapshot.info?.isWorkingCopy) return h('div', { className: 'svnm-placeholder' }, labels.notWorkingCopy)
      const groups = classify(snapshot?.entries)
      const hasCommittable = groups.changes.length > 0 || groups.conflicts.length > 0
      const statusWarning = snapshot?.unversionedSuppressed
        ? labels.unversionedSuppressed
        : snapshot?.truncated
          ? labels.statusTruncated.replace('{shown}', String(snapshot.shownEntries ?? snapshot.entries?.length ?? 0))
          : null

      return h('div', { className: 'svnm-root' },
        h('header', { className: 'svnm-header' },
          h('div', { className: 'svnm-repo' },
            h('div', { className: 'svnm-repo-url', title: snapshot?.info?.url || '' }, snapshot?.info?.relativeUrl || snapshot?.info?.url || labels.repository),
            h('div', { className: 'svnm-revision' }, `${labels.revision}: r${snapshot?.info?.revision || '?'}`),
          ),
          h('button', { type: 'button', className: 'svnm-icon-btn', disabled: busy, title: labels.refresh, 'aria-label': labels.refresh, onClick: () => void refresh() }, icon('refresh', 15)),
          h('button', {
            type: 'button', className: 'svnm-action-btn', disabled: busy, title: labels.update,
            onClick: () => setConfirmState({ title: labels.updateTitle, description: labels.updateDesc, onConfirm: () => { setConfirmState(null); void run('update', { confirm: true }, labels.commandDone) } }),
          }, icon('update', 14), h('span', null, busy ? labels.updating : labels.update)),
        ),
        statusWarning ? h('div', { className: 'svnm-warning' }, statusWarning) : null,
        h(ChangeSection, { title: labels.conflicts, entries: groups.conflicts, kind: 'conflict', labels, busy, onDiff: openDiff, onOpen: openFile, onAction: action }),
        h(ChangeSection, { title: labels.changes, entries: groups.changes, kind: 'change', labels, busy, onDiff: openDiff, onOpen: openFile, onAction: action }),
        h(ChangeSection, { title: labels.unversioned, entries: groups.unversioned, kind: 'unversioned', labels, busy, onDiff: openDiff, onOpen: openFile, onAction: action }),
        h('div', { className: 'svnm-commit' },
          h('textarea', { className: 'svnm-message', rows: 2, value: message, maxLength: 10000, placeholder: labels.commitPlaceholder, disabled: busy, onChange: (event) => setMessage(event.target.value) }),
          h('button', { type: 'button', className: 'svnm-btn svnm-primary', disabled: busy || !hasCommittable || !message.trim(), onClick: () => void run('commit', { message: message.trim(), confirm: true }, labels.commandDone, () => setMessage('')) }, labels.commit),
        ),
        error ? h('div', { className: 'svnm-error' }, error) : null,
        notice ? h('pre', { className: 'svnm-notice' }, notice) : null,
        h('section', { className: 'svnm-section svnm-history' },
          h('div', { className: 'svnm-section-head' }, h('span', null, labels.history)),
          history.length === 0 ? h('div', { className: 'svnm-empty' }, labels.noHistory) : null,
          history.map((entry) => h('button', { type: 'button', className: 'svnm-log-row', key: entry.revision, onClick: () => openRevision(entry), title: entry.message || `r${entry.revision}` },
            h('span', { className: 'svnm-log-top' }, h('b', null, `r${entry.revision}`), h('span', null, entry.message || '—')),
            h('span', { className: 'svnm-log-meta' }, `${entry.author || '—'} · ${entry.date ? new Date(entry.date).toLocaleString() : '—'}`),
          )),
          !historyEnded ? h('button', { type: 'button', className: 'svnm-more', disabled: busy, onClick: () => void loadMore() }, labels.loadMore) : null,
        ),
        h(ConfirmDialog, { state: confirmState, labels, busy, onClose: () => setConfirmState(null) }),
      )
    }

    function DiffView(props) {
      const labels = useLocale(props.ctx)
      const meta = props.tab.meta && typeof props.tab.meta === 'object' ? props.tab.meta : {}
      const [content, setContent] = React.useState('')
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState(null)
      const [tick, setTick] = React.useState(0)
      React.useEffect(() => {
        const controller = new AbortController()
        setLoading(true); setError(null)
        api('diff', {
          sessionId: props.scope.sessionId,
          ...(meta.kind === 'revision' ? { revision: String(meta.revision || '') } : { path: String(meta.path || '') }),
        }, controller.signal).then((value) => setContent(value.diff || '')).catch((caught) => {
          if (caught?.name !== 'AbortError') setError(caught instanceof Error ? caught.message : String(caught))
        }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
        return () => controller.abort()
      }, [props.scope.sessionId, meta.kind, meta.path, meta.revision, tick])
      const title = meta.kind === 'revision' ? `r${meta.revision || '?'}` : String(meta.path || props.tab.title)
      const diffText = content.slice(0, 2 * 1024 * 1024)
      const diffLines = diffText.split('\n').slice(0, 10_000)
      const diffTruncated = diffText.length < content.length || diffText.split('\n').length > diffLines.length
      return h('div', { className: 'svnm-diff' },
        h('header', { className: 'svnm-diff-head' }, h('span', { title }, title), h('button', { type: 'button', className: 'svnm-icon-btn', title: labels.refresh, 'aria-label': labels.refresh, onClick: () => setTick((value) => value + 1) }, icon('refresh', 15))),
        loading ? h('div', { className: 'svnm-placeholder' }, labels.loading) : null,
        error ? h('div', { className: 'svnm-error svnm-pad' }, `${labels.diffError}: ${error}`) : null,
        !loading && !error && !content ? h('div', { className: 'svnm-placeholder' }, labels.diffEmpty) : null,
        !loading && !error && diffTruncated ? h('div', { className: 'svnm-warning' }, labels.diffTruncated) : null,
        !loading && !error && content ? h('pre', { className: 'svnm-diff-code' }, diffLines.map((line, index) => {
          let kind = 'ctx'
          if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('Index:') || line.startsWith('===')) kind = 'head'
          else if (line.startsWith('@@')) kind = 'hunk'
          else if (line.startsWith('+')) kind = 'add'
          else if (line.startsWith('-')) kind = 'del'
          return h('span', { className: `svnm-diff-line svnm-diff-${kind}`, key: index }, line || ' ', '\n')
        })) : null,
      )
    }

    const styles = [
      '.svnm-root,.svnm-diff{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform);font-size:12px;overflow:auto}',
      '.svnm-header,.svnm-diff-head{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:6px;min-height:42px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform)}',
      '.svnm-repo{flex:1;min-width:0}.svnm-repo-url{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.svnm-revision,.svnm-log-meta{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:11px}',
      '.svnm-icon-btn{width:28px;height:28px;flex:none;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.svnm-icon-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.svnm-action-btn,.svnm-btn{min-height:28px;display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 9px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}.svnm-action-btn:hover:not(:disabled),.svnm-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.svnm-root button:disabled,.svnm-dialog button:disabled{opacity:.45;cursor:default}',
      '.svnm-section{border-bottom:1px solid var(--dsw-alias-border-l2)}.svnm-section-head{display:flex;align-items:center;min-height:30px;padding:5px 9px;font-weight:600;color:var(--dsw-alias-label-secondary)}.svnm-empty,.svnm-placeholder{padding:16px 10px;color:var(--dsw-alias-label-tertiary);text-align:center}',
      '.svnm-change{display:flex;align-items:center;min-height:30px;padding:0 5px 0 8px}.svnm-change:hover{background:var(--dsw-alias-interactive-bg-hover)}.svnm-change-main{flex:1;min-width:0;display:flex;align-items:center;gap:7px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;padding:6px 2px}',
      '.svnm-badge{width:17px;flex:none;font-weight:700;color:var(--dsw-alias-brand-primary)}.svnm-conflict .svnm-badge{color:var(--dsw-alias-status-error,#d33c48)}.svnm-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.svnm-flag{flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px}',
      '.svnm-commit{display:flex;align-items:stretch;gap:6px;padding:8px;border-bottom:1px solid var(--dsw-alias-border-l2)}.svnm-message{flex:1;min-width:0;resize:vertical;max-height:100px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;padding:7px;outline:none}.svnm-message:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.svnm-primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:white}.svnm-primary:hover:not(:disabled){filter:brightness(1.06);background:var(--dsw-alias-brand-primary)}.svnm-danger{background:var(--dsw-alias-status-error,#d33c48)}',
      '.svnm-error{margin:7px 8px;padding:7px 9px;border:1px solid color-mix(in srgb,var(--dsw-alias-status-error,#d33c48) 45%,transparent);border-radius:6px;color:var(--dsw-alias-status-error,#d33c48);white-space:pre-wrap}.svnm-warning{padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:rgba(220,150,30,.12)}.svnm-pad{margin:12px}.svnm-notice{margin:7px 8px;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;white-space:pre-wrap;font:11px/1.5 var(--dsw-font-family);color:var(--dsw-alias-label-secondary);max-height:100px;overflow:auto}',
      '.svnm-history{padding-bottom:8px}.svnm-log-row{width:100%;display:flex;flex-direction:column;gap:2px;border:0;background:transparent;color:inherit;text-align:left;padding:7px 10px;cursor:pointer}.svnm-log-row:hover{background:var(--dsw-alias-interactive-bg-hover)}.svnm-log-top{display:flex;gap:7px;min-width:0}.svnm-log-top b{flex:none;color:var(--dsw-alias-brand-primary)}.svnm-log-top span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.svnm-more{margin:7px 10px;border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;cursor:pointer}',
      '.svnm-mask{position:fixed;inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.45)}.svnm-dialog{width:min(390px,100%);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:16px;background:var(--dsw-alias-bg-layer-3);box-shadow:0 18px 50px rgba(0,0,0,.3)}.svnm-dialog-title{font-size:15px;font-weight:600}.svnm-dialog-desc{margin-top:9px;color:var(--dsw-alias-label-secondary);line-height:1.55}.svnm-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}',
      '.svnm-diff-head span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.svnm-diff-code{flex:1;margin:0;padding:8px 0;overflow:auto;background:var(--dsw-alias-bg-layer-3);font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;tab-size:4}.svnm-diff-line{display:block;min-width:max-content;padding:0 10px;white-space:pre}.svnm-diff-add{background:rgba(24,160,88,.14);color:var(--dsw-alias-label-primary)}.svnm-diff-del{background:rgba(220,55,65,.14);color:var(--dsw-alias-label-primary)}.svnm-diff-hunk{background:rgba(61,119,255,.12);color:var(--dsw-alias-brand-primary)}.svnm-diff-head{color:var(--dsw-alias-label-secondary)}',
      'body[data-ds-dark-theme] .svnm-diff-add{background:rgba(50,190,110,.16)}body[data-ds-dark-theme] .svnm-diff-del{background:rgba(245,85,95,.16)}',
    ].join('')

    const inject = ['betterSidebar', 'locale']
    function apply(ctx) {
      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.pluginCss = 'dsh-svn-manager'
        tag.textContent = styles
        document.head.appendChild(tag)
        return () => tag.remove()
      })
      ctx.effect(() => ctx.betterSidebar.registerTab({
        id: 'dsh-svn-manager', title: () => localeOf(ctx) === 'en' ? 'SVN' : 'SVN', icon: (size) => icon('branch', size), order: 21, single: true,
        component: (props) => h(SvnView, props),
      }))
      ctx.effect(() => ctx.betterSidebar.registerTab({
        id: 'dsh-svn-manager:diff', title: 'SVN Diff', icon: (size) => icon('file', size), order: -1, hidden: true,
        dedupeKey: (tab) => tab.id, component: (props) => h(DiffView, props),
      }))
    }
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
