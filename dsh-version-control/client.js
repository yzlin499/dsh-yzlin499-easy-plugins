window.__ModuleLoader__.load({
  id: 'dsh-version-control',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    const zh = {
      title: '版本控制', diff: '差异', git: 'Git', svn: 'SVN', refresh: '刷新', updating: '处理中', update: '更新', push: '推送', loading: '加载中…',
      notWorkingCopy: '当前会话工作区不是有效的版本库。', unavailable: '无法连接版本控制服务。',
      conflicts: '冲突', changes: '变更', unversioned: '未跟踪文件', svnChanges: '待提交变更', svnUnversioned: '未纳管文件', history: '提交记录',
      empty: '没有变更', add: '暂存', svnAdd: '纳入版本控制', revert: '还原', openFile: '打开文件',
      commitPlaceholder: '提交说明', commit: '提交更改', loadMore: '加载更多', noHistory: '没有提交记录',
      searchHistory: '搜索已加载日志', noSearchResults: '没有匹配的日志',
      repository: '仓库', revision: '当前版本', confirm: '确认', cancel: '取消',
      revertTitle: '还原本地变更？', revertDesc: '这会丢弃“{path}”的本地修改，无法恢复。',
      updateTitle: '更新工作区？', updateDesc: '远程更新可能与本地修改产生冲突。', pushTitle: '推送 Git 提交？', pushDesc: '这会把本地 Git 提交推送到远程仓库。',
      commandDone: '操作完成', diffEmpty: '没有可显示的文本差异。', diffError: '差异加载失败', diffTruncated: '差异过大，仅显示前 10,000 行。',
      copied: '复制', switched: '切换', property: '属性', treeConflict: '树冲突', branch: '分支', remote: '远程',
      loadError: '加载失败', commitError: '提交失败', actionError: '操作失败',
      statusTruncated: '状态项过多，仅显示前 {shown} 项；冲突和已纳管变更优先。',
      unversionedSuppressed: '未纳管文件数量过多，已隐藏未纳管列表；请配置 svn:ignore 后刷新。',
    }
    const en = {
      title: 'Version control', diff: 'Diff', git: 'Git', svn: 'SVN', refresh: 'Refresh', updating: 'Working', update: 'Update', push: 'Push', loading: 'Loading…',
      notWorkingCopy: 'The current session workspace is not a recognized repository.', unavailable: 'Cannot reach the version control service.',
      conflicts: 'Conflicts', changes: 'Changes', unversioned: 'Untracked', svnChanges: 'Changes to commit', svnUnversioned: 'Unversioned', history: 'History',
      empty: 'No changes', add: 'Stage', svnAdd: 'Add to version control', revert: 'Restore', openFile: 'Open file',
      commitPlaceholder: 'Commit message', commit: 'Commit changes', loadMore: 'Load more', noHistory: 'No history',
      searchHistory: 'Search loaded history', noSearchResults: 'No matching history',
      repository: 'Repository', revision: 'Current revision', confirm: 'Confirm', cancel: 'Cancel',
      revertTitle: 'Restore local changes?', revertDesc: 'This discards local changes to “{path}” and cannot be recovered.',
      updateTitle: 'Update workspace?', updateDesc: 'Remote updates may conflict with local changes.', pushTitle: 'Push Git commits?', pushDesc: 'This pushes local Git commits to the remote repository.',
      commandDone: 'Operation completed', diffEmpty: 'No text differences to display.', diffError: 'Failed to load diff', diffTruncated: 'The diff is large; only the first 10,000 lines are shown.',
      copied: 'Copied', switched: 'Switched', property: 'Properties', treeConflict: 'Tree conflict', branch: 'Branch', remote: 'Remote',
      loadError: 'Load failed', commitError: 'Commit failed', actionError: 'Action failed',
      statusTruncated: 'Too many status entries; showing the first {shown}, prioritizing conflicts and versioned changes.',
      unversionedSuppressed: 'Too many unversioned paths; they are hidden. Configure svn:ignore and refresh.',
    }

    function labelsFor(ctx) {
      const labels = localeOf(ctx) === 'en' ? en : zh
      return { ...labels, guideDescription: localeOf(ctx) === 'en' ? 'Git and SVN changes, history, diffs, and repository actions.' : '统一查看 Git 与 SVN 的变更、历史、差异和仓库操作。' }
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
        response = await fetch(`/version-control/api/${method}`, {
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

    const sessionCache = new Map()
    const SESSION_CACHE_LIMIT = 50
    function cacheSession(sessionId, value) {
      sessionCache.delete(sessionId)
      sessionCache.set(sessionId, value)
      while (sessionCache.size > SESSION_CACHE_LIMIT) {
        sessionCache.delete(sessionCache.keys().next().value)
      }
    }

    function icon(kind, size = 16, className) {
      const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', className, 'aria-hidden': true }
      const paths = {
        refresh: [h('path', { key: 1, d: 'M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5' }), h('path', { key: 2, d: 'M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5' })],
        update: [h('path', { key: 1, d: 'M12 3v13' }), h('path', { key: 2, d: 'm7 11 5 5 5-5' }), h('path', { key: 3, d: 'M5 21h14' })],
        file: [h('path', { key: 1, d: 'M14 2H6a2 2 0 0 0-2 2v16h16V8z' }), h('path', { key: 2, d: 'M14 2v6h6' })],
        plus: [h('path', { key: 1, d: 'M12 5v14M5 12h14' })],
        undo: [h('path', { key: 1, d: 'm9 14-4-4 4-4' }), h('path', { key: 2, d: 'M5 10h8a6 6 0 0 1 6 6v2' })],
        chevron: [h('path', { key: 1, d: 'm9 18 6-6-6-6' })],
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

    function ChangeSection({ title, entries, kind, labels, busy, collapsed, onToggle, onDiff, onOpen, onAction }) {
      return h('section', { className: `svnm-section svnm-section-${kind}` },
        h('button', {
          type: 'button', className: 'svnm-section-toggle', 'aria-expanded': !collapsed,
          onClick: onToggle,
        },
          icon('chevron', 14, `svnm-chevron${collapsed ? '' : ' svnm-chevron-open'}`),
          h('span', null, `${title} (${entries.length})`),
        ),
        collapsed ? null : entries.length === 0 ? h('div', { className: 'svnm-empty' }, labels.empty) : null,
        collapsed ? null : entries.map((entry) => h('div', { className: `svnm-change svnm-${kind} svnm-status-${entry.item}`, key: `${kind}:${entry.path}` },
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

    function encodePathSegment(value) {
      return encodeURIComponent(String(value)).replace(/%3A/gi, ':')
    }

    function fileAddress(sessionId, cwd, target) {
      const normalizedTarget = String(target).replace(/\\/g, '/')
      const normalizedCwd = String(cwd || '').replace(/\\/g, '/').replace(/\/+$/, '')
      const sameWorkspace = normalizedCwd !== '' && (normalizedTarget === normalizedCwd || normalizedTarget.toLowerCase().startsWith(`${normalizedCwd.toLowerCase()}/`))
      if (sameWorkspace) {
        const relative = normalizedTarget.slice(normalizedCwd.length).replace(/^\/+/, '')
        return `dsh-resource://file/session/${encodePathSegment(sessionId)}/${relative.split('/').filter(Boolean).map(encodePathSegment).join('/')}`
      }
      return `dsh-resource://file/absolute/${normalizedTarget.replace(/^\/+/, '').split('/').filter(Boolean).map(encodePathSegment).join('/')}`
    }

    function VersionControlView(props) {
      const labels = useLocale(props.ctx)
      const tabInfo = props.useTabInfo()
      const tab = tabInfo.tab
      const sessionId = props.sessionId
      const cwd = props.useSessions?.((sessions) => sessions.byId[sessionId]?.cwd) || ''
      const scope = { sessionId }
      const initialCache = sessionCache.get(sessionId)
      const [snapshot, setSnapshot] = React.useState(initialCache?.snapshot ?? null)
      const [history, setHistory] = React.useState(initialCache?.history ?? [])
      const [historyEnded, setHistoryEnded] = React.useState(initialCache?.historyEnded ?? false)
      const [loading, setLoading] = React.useState(initialCache === undefined)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(initialCache?.error ?? null)
      const [notice, setNotice] = React.useState(null)
      const [message, setMessage] = React.useState('')
      const [confirmState, setConfirmState] = React.useState(null)
      const [collapsed, setCollapsed] = React.useState({ conflicts: false, changes: false, unversioned: false, history: false })
      const [historyQuery, setHistoryQuery] = React.useState('')
      const [provider, setProvider] = React.useState(initialCache?.provider ?? 'auto')

      const payload = React.useCallback((extra = {}) => ({ sessionId, provider, ...extra }), [sessionId, provider])
      const refresh = React.useCallback(async (signal, requestedProvider = provider) => {
        setLoading(true)
        setError(null)
        try {
          const next = await api('status', { sessionId, provider: requestedProvider }, signal)
          let rows = []
          let ended = true
          let loadError = null
          if (next.info?.isWorkingCopy) {
            try {
              rows = await api('log', { sessionId, provider: next.provider }, signal)
              ended = next.provider === 'git' || rows.length < 20
            } catch (caught) {
              if (caught?.name === 'AbortError') throw caught
              loadError = caught instanceof Error ? caught.message : String(caught)
            }
          }
          setProvider(next.provider || requestedProvider)
          setSnapshot(next)
          setHistory(rows)
          setHistoryEnded(ended)
          setError(loadError)
          cacheSession(sessionId, { provider: next.provider || requestedProvider, snapshot: next, history: rows, historyEnded: ended, error: loadError })
        } catch (caught) {
          if (caught?.name !== 'AbortError') {
            const errorMessage = caught instanceof Error ? caught.message : String(caught)
            const previous = sessionCache.get(sessionId) ?? { snapshot: null, history: [], historyEnded: true, provider: requestedProvider }
            setError(errorMessage)
            cacheSession(sessionId, { ...previous, error: errorMessage })
          }
        } finally {
          if (!signal?.aborted) setLoading(false)
        }
      }, [provider, sessionId])

      React.useEffect(() => {
        const cached = sessionCache.get(sessionId)
        setSnapshot(cached?.snapshot ?? null)
        setHistory(cached?.history ?? [])
        setHistoryEnded(cached?.historyEnded ?? false)
        setError(cached?.error ?? null)
        setProvider(cached?.provider ?? 'auto')
        setLoading(cached === undefined)
        setHistoryQuery('')
      }, [sessionId])

      React.useEffect(() => {
        if (!tab.visible) return undefined
        const controller = new AbortController()
        void refresh(controller.signal, provider)
        return () => controller.abort()
      }, [provider, refresh, sessionId, tab.visible])

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

      const activeProvider = snapshot?.provider || (provider === 'svn' ? 'svn' : 'git')
      const activeLabels = activeProvider === 'svn'
        ? { ...labels, changes: labels.svnChanges, unversioned: labels.svnUnversioned, add: labels.svnAdd, update: labels.update }
        : labels
      const absolutePath = (path) => {
        const root = String(snapshot?.info?.wcRoot || snapshot?.info?.root || cwd || '')
        if (!root || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\')) return path
        const separator = root.includes('\\') ? '\\' : '/'
        return `${root.replace(/[\\/]+$/, '')}${separator}${String(path).replace(/^[\\/]+/, '').replace(/[\\/]/g, separator)}`
      }
      const openFile = (path) => {
        const target = absolutePath(path)
        tab.actions.openResource(fileAddress(sessionId, cwd, target))
      }
      const openDiff = (path) => tab.actions.openTab('version-control-diff', { params: { provider: activeProvider, kind: 'working', path } })
      const openRevision = (entry) => tab.actions.openTab('version-control-diff', { params: { provider: activeProvider, kind: 'revision', revision: entry.revision } })
      const selectProvider = (next) => {
        if (next === provider) return
        setProvider(next)
        setSnapshot(null)
        setHistory([])
        setError(null)
      }
      const providerSwitcher = () => h('div', { className: 'svnm-provider' },
        h('button', { type: 'button', className: `svnm-provider-btn${activeProvider === 'git' ? ' svnm-provider-active' : ''}`, disabled: busy, onClick: () => selectProvider('git') }, activeLabels.git),
        h('button', { type: 'button', className: `svnm-provider-btn${activeProvider === 'svn' ? ' svnm-provider-active' : ''}`, disabled: busy, onClick: () => selectProvider('svn') }, activeLabels.svn),
      )
      const emptyState = (content) => h('div', { className: 'svnm-root' },
        h('header', { className: 'svnm-header' },
          providerSwitcher(),
          h('div', { className: 'svnm-repo' },
            h('div', { className: 'svnm-repo-url' }, activeLabels.title),
            h('div', { className: 'svnm-revision' }, activeProvider === 'git' ? activeLabels.git : activeLabels.svn),
          ),
        ),
        content,
      )
      const action = (entry, kind) => {
        if (kind === 'unversioned') { void run('add', { paths: [entry.path], confirm: true }, activeLabels.commandDone); return }
        setConfirmState({
          title: activeLabels.revertTitle,
          description: activeLabels.revertDesc.replace('{path}', entry.path),
          onConfirm: () => { setConfirmState(null); void run('revert', { paths: [entry.path], confirm: true }, activeLabels.commandDone) },
        })
      }
      const loadMore = async () => {
        if (activeProvider !== 'svn') return
        const last = history[history.length - 1]
        if (!last || busy) return
        setBusy(true)
        try {
          const rows = await api('log', payload({ limit: 20, startRevision: String(Math.max(Number(last.revision) - 1, 1)) }))
          const nextHistory = [...history, ...rows]
          const nextEnded = rows.length < 20
          setHistory(nextHistory)
          setHistoryEnded(nextEnded)
          cacheSession(sessionId, { provider: activeProvider, snapshot, history: nextHistory, historyEnded: nextEnded, error: null })
        } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
        finally { setBusy(false) }
      }

      if (loading && snapshot === null) return emptyState(h('div', { className: 'svnm-placeholder' }, activeLabels.loading))
      if (error && snapshot === null) return emptyState(h('div', { className: 'svnm-error svnm-pad' }, `${activeLabels.loadError}: ${error}`))
      if (snapshot && !snapshot.info?.isWorkingCopy) return emptyState(h('div', { className: 'svnm-placeholder' }, activeLabels.notWorkingCopy))
      const groups = classify(snapshot?.entries)
      const hasCommittable = groups.changes.length > 0 || groups.conflicts.length > 0
      const statusWarning = snapshot?.unversionedSuppressed
        ? activeLabels.unversionedSuppressed
        : snapshot?.truncated
          ? activeLabels.statusTruncated.replace('{shown}', String(snapshot.shownEntries ?? snapshot.entries?.length ?? 0))
          : null
      const toggleSection = (key) => setCollapsed((current) => ({ ...current, [key]: !current[key] }))
      const normalizedQuery = historyQuery.trim().toLocaleLowerCase()
      const filteredHistory = normalizedQuery === '' ? history : history.filter((entry) => (
        `${entry.revision} ${entry.author} ${entry.message} ${entry.date}`.toLocaleLowerCase().includes(normalizedQuery)
      ))

      return h('div', { className: 'svnm-root' },
        h('header', { className: 'svnm-header' },
          providerSwitcher(),
          h('div', { className: 'svnm-repo' },
            h('div', { className: 'svnm-repo-url', title: snapshot?.info?.remote || snapshot?.info?.url || '' }, snapshot?.info?.remote || snapshot?.info?.relativeUrl || snapshot?.info?.url || activeLabels.repository),
            h('div', { className: 'svnm-revision' }, `${activeLabels.revision}: ${activeProvider === 'git' ? `${snapshot?.info?.branch || activeLabels.branch} @ ${snapshot?.info?.revision || '?'}` : `r${snapshot?.info?.revision || '?'}`}`),
          ),
          h('button', { type: 'button', className: 'svnm-icon-btn', disabled: busy, title: activeLabels.refresh, 'aria-label': activeLabels.refresh, onClick: () => void refresh() }, icon('refresh', 15)),
          h('button', {
            type: 'button', className: 'svnm-action-btn', disabled: busy, title: activeLabels.update,
            onClick: () => setConfirmState({ title: activeLabels.updateTitle, description: activeLabels.updateDesc, onConfirm: () => { setConfirmState(null); void run('update', { confirm: true }, activeLabels.commandDone) } }),
          }, icon('update', 14), h('span', null, busy ? activeLabels.updating : activeLabels.update)),
          activeProvider === 'git' ? h('button', {
            type: 'button', className: 'svnm-action-btn', disabled: busy, title: activeLabels.push,
            onClick: () => setConfirmState({ title: activeLabels.pushTitle, description: activeLabels.pushDesc, onConfirm: () => { setConfirmState(null); void run('push', { confirm: true }, activeLabels.commandDone) } }),
          }, icon('update', 14), h('span', null, activeLabels.push)) : null,
        ),
        statusWarning ? h('div', { className: 'svnm-warning' }, statusWarning) : null,
        h(ChangeSection, { title: activeLabels.conflicts, entries: groups.conflicts, kind: 'conflict', labels: activeLabels, busy, collapsed: collapsed.conflicts, onToggle: () => toggleSection('conflicts'), onDiff: openDiff, onOpen: openFile, onAction: action }),
        h(ChangeSection, { title: activeLabels.changes, entries: groups.changes, kind: 'change', labels: activeLabels, busy, collapsed: collapsed.changes, onToggle: () => toggleSection('changes'), onDiff: openDiff, onOpen: openFile, onAction: action }),
        h(ChangeSection, { title: activeLabels.unversioned, entries: groups.unversioned, kind: 'unversioned', labels: activeLabels, busy, collapsed: collapsed.unversioned, onToggle: () => toggleSection('unversioned'), onDiff: openDiff, onOpen: openFile, onAction: action }),
        h('div', { className: 'svnm-commit' },
          h('textarea', { className: 'svnm-message', rows: 2, value: message, maxLength: 10000, placeholder: activeLabels.commitPlaceholder, disabled: busy, onChange: (event) => setMessage(event.target.value) }),
          h('button', { type: 'button', className: 'svnm-btn svnm-primary svnm-commit-button', disabled: busy || !hasCommittable || !message.trim(), onClick: () => void run('commit', { message: message.trim(), confirm: true }, activeLabels.commandDone, () => setMessage('')) }, activeLabels.commit),
        ),
        error ? h('div', { className: 'svnm-error' }, error) : null,
        notice ? h('pre', { className: 'svnm-notice' }, notice) : null,
        h('section', { className: 'svnm-section svnm-history' },
          h('button', { type: 'button', className: 'svnm-section-toggle', 'aria-expanded': !collapsed.history, onClick: () => toggleSection('history') },
            icon('chevron', 14, `svnm-chevron${collapsed.history ? '' : ' svnm-chevron-open'}`), h('span', null, `${activeLabels.history} (${history.length})`),
          ),
          collapsed.history ? null : h('div', { className: 'svnm-history-search' }, h('input', { type: 'search', value: historyQuery, placeholder: activeLabels.searchHistory, 'aria-label': activeLabels.searchHistory, onChange: (event) => setHistoryQuery(event.target.value) })),
          collapsed.history ? null : history.length === 0 ? h('div', { className: 'svnm-empty' }, activeLabels.noHistory) : null,
          collapsed.history || history.length === 0 || filteredHistory.length > 0 ? null : h('div', { className: 'svnm-empty' }, activeLabels.noSearchResults),
          collapsed.history ? null : filteredHistory.map((entry) => h('button', { type: 'button', className: 'svnm-log-row', key: entry.revision, onClick: () => openRevision(entry), title: entry.message || String(entry.revision) },
            h('span', { className: 'svnm-log-top' }, h('b', null, activeProvider === 'git' ? String(entry.revision).slice(0, 8) : `r${entry.revision}`), h('span', null, entry.message || '—')),
            h('span', { className: 'svnm-log-meta' }, `${entry.author || '—'} · ${entry.date ? new Date(entry.date).toLocaleString() : '—'}`),
          )),
          !collapsed.history && !historyEnded ? h('button', { type: 'button', className: 'svnm-more', disabled: busy, onClick: () => void loadMore() }, activeLabels.loadMore) : null,
        ),
        h(ConfirmDialog, { state: confirmState, labels: activeLabels, busy, onClose: () => setConfirmState(null) }),
      )
    }

    function DiffView(props) {
      const labels = useLocale(props.ctx)
      const tab = props.useTabInfo().tab
      const meta = tab.navigation.params && typeof tab.navigation.params === 'object' ? tab.navigation.params : {}
      const [content, setContent] = React.useState('')
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState(null)
      const [tick, setTick] = React.useState(0)
      React.useEffect(() => {
        const controller = new AbortController()
        setLoading(true); setError(null)
        api('diff', {
          sessionId: props.sessionId,
          provider: meta.provider,
          ...(meta.kind === 'revision' ? { revision: String(meta.revision || '') } : { path: String(meta.path || '') }),
        }, controller.signal).then((value) => setContent(value.diff || '')).catch((caught) => {
          if (caught?.name !== 'AbortError') setError(caught instanceof Error ? caught.message : String(caught))
        }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
        return () => controller.abort()
      }, [props.sessionId, meta.provider, meta.kind, meta.path, meta.revision, tick])
      const title = meta.kind === 'revision'
        ? `${meta.provider === 'git' ? String(meta.revision || '').slice(0, 8) : `r${meta.revision || '?'}`}`
        : String(meta.path || tab.title)
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
      '.svnm-provider{display:flex;flex:none;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-3)}.svnm-provider-btn{appearance:none!important;border:0!important;border-radius:4px;padding:4px 6px;background:transparent!important;color:var(--dsw-alias-label-tertiary)!important;font:inherit;cursor:pointer}.svnm-provider-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary)!important;background:var(--dsw-alias-interactive-bg-hover)!important}.svnm-provider-active{background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-primary)!important;box-shadow:inset 0 -2px var(--dsw-alias-brand-primary,#4d6bfe)}.svnm-provider-active:hover:not(:disabled){color:var(--dsw-alias-label-primary)!important;background:var(--dsw-alias-interactive-bg-hover)!important}',
      '.svnm-repo{flex:1;min-width:0}.svnm-repo-url{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.svnm-revision,.svnm-log-meta{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:11px}',
      '.svnm-icon-btn{width:28px;height:28px;flex:none;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.svnm-icon-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.svnm-action-btn,.svnm-btn{min-height:28px;display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 9px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}.svnm-action-btn:hover:not(:disabled),.svnm-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.svnm-root button:disabled,.svnm-dialog button:disabled{opacity:.45;cursor:default}',
      '.svnm-section{border-bottom:1px solid var(--dsw-alias-border-l2)}.svnm-section-toggle{appearance:none;width:100%;min-height:32px;display:flex;align-items:center;gap:5px;padding:5px 9px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-weight:600;text-align:left;cursor:pointer}.svnm-section-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.svnm-chevron{flex:none;transition:transform .15s ease}.svnm-chevron-open{transform:rotate(90deg)}.svnm-empty,.svnm-placeholder{padding:16px 10px;color:var(--dsw-alias-label-tertiary);text-align:center}',
      '.svnm-change{display:flex;align-items:center;min-height:30px;padding:0 5px 0 8px}.svnm-change:hover{background:var(--dsw-alias-interactive-bg-hover)}.svnm-change-main{flex:1;min-width:0;display:flex;align-items:center;gap:7px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;padding:6px 2px}',
      '.svnm-badge{width:17px;flex:none;font-weight:800;color:#b76e00}.svnm-status-added .svnm-badge{color:#16845b}.svnm-status-deleted .svnm-badge,.svnm-status-missing .svnm-badge,.svnm-conflict .svnm-badge{color:var(--dsw-alias-status-error,#d33c48)}.svnm-status-replaced .svnm-badge{color:#7a55c5}.svnm-unversioned .svnm-badge{color:var(--dsw-alias-label-tertiary,#737780)}.svnm-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.svnm-flag{flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px}',
      '.svnm-commit{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:stretch;gap:8px;padding:9px 8px;border-bottom:1px solid var(--dsw-alias-border-l2)}.svnm-message{min-width:0;resize:vertical;max-height:100px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;padding:7px;outline:none}.svnm-message:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}.svnm-commit-button{min-width:86px;min-height:42px;padding:7px 13px;font-weight:700;font-size:13px;box-shadow:0 2px 8px rgba(77,107,254,.2)}',
      '.svnm-primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:white}.svnm-primary:hover:not(:disabled){filter:brightness(1.06);background:var(--dsw-alias-brand-primary,#4d6bfe)}.svnm-danger{background:var(--dsw-alias-status-error,#d33c48)}',
      '.svnm-error{margin:7px 8px;padding:7px 9px;border:1px solid color-mix(in srgb,var(--dsw-alias-status-error,#d33c48) 45%,transparent);border-radius:6px;color:var(--dsw-alias-status-error,#d33c48);white-space:pre-wrap}.svnm-warning{padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:rgba(220,150,30,.12)}.svnm-pad{margin:12px}.svnm-notice{margin:7px 8px;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;white-space:pre-wrap;font:11px/1.5 var(--dsw-font-family);color:var(--dsw-alias-label-secondary);max-height:100px;overflow:auto}',
      '.svnm-history{padding-bottom:8px}.svnm-history-search{padding:5px 9px 7px}.svnm-history-search input{box-sizing:border-box;width:100%;height:29px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;outline:none}.svnm-history-search input:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}.svnm-log-row{width:100%;display:flex;flex-direction:column;gap:2px;border:0;background:transparent;color:inherit;text-align:left;padding:7px 10px;cursor:pointer}.svnm-log-row:hover{background:var(--dsw-alias-interactive-bg-hover)}.svnm-log-top{display:flex;gap:7px;min-width:0}.svnm-log-top b{flex:none;color:var(--dsw-alias-brand-primary,#4d6bfe)}.svnm-log-top span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.svnm-more{margin:7px 10px;border:0;background:transparent;color:var(--dsw-alias-brand-primary,#4d6bfe);font:inherit;cursor:pointer}',
      '.svnm-mask{position:fixed;inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.45)}.svnm-dialog{width:min(390px,100%);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:16px;background:var(--dsw-alias-bg-layer-3);box-shadow:0 18px 50px rgba(0,0,0,.3)}.svnm-dialog-title{font-size:15px;font-weight:600}.svnm-dialog-desc{margin-top:9px;color:var(--dsw-alias-label-secondary);line-height:1.55}.svnm-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}',
      '.svnm-diff-head span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.svnm-diff-code{flex:1;margin:0;padding:8px 0;overflow:auto;background:var(--dsw-alias-bg-layer-3);font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;tab-size:4}.svnm-diff-line{display:block;min-width:max-content;padding:0 10px;white-space:pre}.svnm-diff-add{background:rgba(24,160,88,.14);color:var(--dsw-alias-label-primary)}.svnm-diff-del{background:rgba(220,55,65,.14);color:var(--dsw-alias-label-primary)}.svnm-diff-hunk{background:rgba(61,119,255,.12);color:var(--dsw-alias-brand-primary,#4d6bfe)}.svnm-diff-head{color:var(--dsw-alias-label-secondary)}',
      'body[data-ds-dark-theme] .svnm-badge{color:#e6a23c}body[data-ds-dark-theme] .svnm-status-added .svnm-badge{color:#45c690}body[data-ds-dark-theme] .svnm-status-replaced .svnm-badge{color:#ad8ce6}body[data-ds-dark-theme] .svnm-diff-add{background:rgba(50,190,110,.16)}body[data-ds-dark-theme] .svnm-diff-del{background:rgba(245,85,95,.16)}',
      // 设置卡片（settings.plugin.item）
      '.svnm-set{display:flex;flex-direction:column;gap:9px}',
      '.svnm-set-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.svnm-set-label{width:112px;flex-shrink:0}',
      '.svnm-set-input{flex:1;min-width:0;background:rgba(0,0,0,.04);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;padding:5px 8px}',
      'body[data-ds-dark-theme] .svnm-set-input{background:rgba(255,255,255,.05)}',
      '.svnm-set-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}',
      '.svnm-set-hint{font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.8;line-height:1.6}',
      '.svnm-set-detected{font-size:11.5px;word-break:break-all;line-height:1.5}',
      '.svnm-set-ok{color:#158452}body[data-ds-dark-theme] .svnm-set-ok{color:#45c690}',
      '.svnm-set-bad{color:var(--dsw-alias-status-error,#d33c48)}',
      '.svnm-set-foot{display:flex;align-items:center;gap:10px;margin-top:2px}',
      '.svnm-set-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:6px;font-size:12px;line-height:1;padding:5px 12px;cursor:pointer}',
      '.svnm-set-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}',
      '.svnm-set-btn[disabled]{opacity:.45;cursor:default}',
      '.svnm-set-status{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      // 官方插件卡片外壳（对齐 PluginCard）
      '.pc-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;overflow:hidden}',
      '.pc-head{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;display:flex;align-items:center;gap:12px;padding:14px 16px}',
      '.pc-head-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
      '.pc-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}',
      '.pc-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}',
      '.pc-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}',
      '.pc-open{transform:rotate(180deg)}',
      '.pc-body{border-top:1px solid var(--dsw-alias-border-l2);padding:14px 16px}',
    ].join('')

    const settingsZh = {
      title: 'SVN 可执行文件配置（WSL / svn.exe）', cardTitle: '版本控制',
      exec: 'SVN 可执行文件',
      placeholder: '留空自动检测，如 svn.exe 或完整路径',
      hint: 'WSL 下找不到 svn 时自动回退：svn → svn.exe → TortoiseSVN / SlikSvn 常见安装路径。使用 Windows 版 svn 时，工作副本路径会自动在 WSL 与 Windows 之间转换（如 /mnt/d/x ↔ D:\\x）。',
      detected: '当前检测到',
      detectedNone: '未检测到 SVN（请安装 Linux 版 subversion，或在下方指定路径）',
      backendWin: 'Windows 后端', backendLinux: 'Linux 后端',
      save: '保存', saved: '已保存', saving: '保存中…', loadFailed: '读取失败', saveFailed: '保存失败',
    }
    const settingsEn = {
      title: 'SVN executable settings (WSL / svn.exe)', cardTitle: 'Version control',
      exec: 'SVN executable',
      placeholder: 'Leave empty to auto-detect; e.g. svn.exe or a full path',
      hint: 'When svn is missing under WSL, falls back to: svn → svn.exe → common TortoiseSVN / SlikSvn install paths. When the Windows svn.exe is used, working-copy paths are translated between WSL and Windows automatically (e.g. /mnt/d/x ↔ D:\\x).',
      detected: 'Detected',
      detectedNone: 'No SVN detected (install the Linux subversion, or set a path below)',
      backendWin: 'Windows backend', backendLinux: 'Linux backend',
      save: 'Save', saved: 'Saved', saving: 'Saving…', loadFailed: 'Failed to load', saveFailed: 'Failed to save',
    }

    const inject = ['sidebarRightTabs', 'locale', 'slots']
    function apply(ctx) {
      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.pluginCss = 'dsh-version-control'
        tag.textContent = styles
        document.head.appendChild(tag)
        return () => tag.remove()
      })
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: 'dsh-version-control', kind: 'version-control', title: () => labelsFor(ctx).title,
        guide: [{ order: 30, title: () => labelsFor(ctx).title, description: () => labelsFor(ctx).guideDescription }],
      }), 'dsh-version-control: version control tab type')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
        { name: 'sidebar.right.pane.tab', key: 'dsh-version-control' },
        (props) => h(VersionControlView, { ...props, ctx }),
      )), 'dsh-version-control: version control tab body')
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: 'dsh-version-control:diff', kind: 'version-control-diff', title: () => labelsFor(ctx).diff,
      }), 'dsh-version-control: diff tab type')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
        { name: 'sidebar.right.pane.tab', key: 'dsh-version-control:diff' },
        (props) => h(DiffView, { ...props, ctx }),
      )), 'dsh-version-control: diff tab body')

      // 设置卡片：注册进官方「插件」设置页（settings.plugin.item，keyed 插槽，
      // key = Host 侧注册的 settings 命名空间 dsh-version-control）。
      function SettingsCard() {
        const [open, setOpen] = React.useState(false)
        const [rev, setRev] = React.useState(0)
        const [cfg, setCfg] = React.useState({ svnExecutable: '', detected: null, backend: null, platform: '', loading: true, status: '' })
        const labels = localeOf(ctx) === 'en' ? settingsEn : settingsZh

        React.useEffect(() => {
          const off = ctx.locale?.subscribe?.(() => setRev((value) => value + 1))
          return typeof off === 'function' ? off : undefined
        }, [])

        React.useEffect(() => {
          let alive = true
          setCfg((s) => ({ ...s, loading: true }))
          fetch('/version-control/config')
            .then((r) => r.json())
            .then((d) => {
              if (!alive) return
              setCfg((s) => ({
                ...s, loading: false,
                svnExecutable: d && typeof d.svnExecutable === 'string' ? d.svnExecutable : s.svnExecutable,
                detected: d && d.detected ? d.detected : null,
                backend: d && d.backend ? d.backend : null,
                platform: d && typeof d.platform === 'string' ? d.platform : s.platform,
                status: '',
              }))
            })
            .catch(() => { if (alive) setCfg((s) => ({ ...s, loading: false, status: labels.loadFailed })) })
          return () => { alive = false }
        }, [rev])

        const save = () => {
          setCfg((s) => ({ ...s, status: labels.saving }))
          fetch('/version-control/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ svnExecutable: String(cfg.svnExecutable || '').trim() }),
          })
            .then((r) => r.json())
            .then((d) => {
              if (d && d.ok) {
                setCfg((s) => ({
                  ...s,
                  svnExecutable: d.svnExecutable != null ? d.svnExecutable : s.svnExecutable,
                  detected: d.detected, backend: d.backend,
                  status: labels.saved,
                }))
              } else {
                setCfg((s) => ({ ...s, status: (d && d.error) || labels.saveFailed }))
              }
            })
            .catch((error) => setCfg((s) => ({ ...s, status: String((error && error.message) || labels.saveFailed) })))
        }

        const detectedLine = cfg.detected
          ? h('div', { className: 'svnm-set-detected svnm-set-ok' }, `${labels.detected}: ${cfg.detected}${cfg.backend ? `（${cfg.backend === 'windows' ? labels.backendWin : labels.backendLinux}）` : ''}`)
          : h('div', { className: 'svnm-set-detected svnm-set-bad' }, `${labels.detected}: ${labels.detectedNone}`)

        return h('div', { className: 'pc-card' },
          h('button', { className: 'pc-head', onClick: () => setOpen((value) => !value) },
            h('span', { className: 'pc-head-text' },
              h('span', { className: 'pc-name' }, labels.cardTitle),
              h('span', { className: 'pc-desc' }, labels.title),
            ),
            h('span', { className: 'pc-chevron' + (open ? ' pc-open' : '') }, '▾'),
          ),
          open ? h('div', { className: 'pc-body' },
            h('div', { className: 'svnm-set' },
              detectedLine,
              h('label', { className: 'svnm-set-row' },
                h('span', { className: 'svnm-set-label' }, labels.exec),
                h('input', {
                  className: 'svnm-set-input', type: 'text', value: cfg.svnExecutable,
                  placeholder: labels.placeholder, spellCheck: false,
                  onChange: (event) => setCfg((s) => ({ ...s, svnExecutable: event.target.value })),
                }),
              ),
              h('div', { className: 'svnm-set-hint' }, labels.hint),
              h('div', { className: 'svnm-set-foot' },
                h('button', { className: 'svnm-set-btn', disabled: cfg.loading, onClick: save }, labels.save),
                cfg.status ? h('span', { className: 'svnm-set-status' }, cfg.status) : null,
              ),
            ),
          ) : null,
        )
      }

      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        key: 'dsh-version-control',
        id: 'version-control-settings',
        order: 40,
        label: 'SVN',
      }, SettingsCard))
    }
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
