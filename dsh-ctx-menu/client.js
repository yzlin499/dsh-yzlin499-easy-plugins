// dsh-ctx-menu — Client half
//
// 只追加、不破坏：
//  1) 门外规则与 Electron 外壳「互补」——外壳会弹菜单的情形（可编辑域 / 有选中文本）一律放行，
//     所以我们永远不会抢掉外壳的「复制」。没有可追加项时连 preventDefault 都不调用。
//  2) 侧栏行（会话 / 工作区）不重画菜单：直接对官方 ⋯ 按钮 click()，复用官方同一份菜单与状态。
//  3) 正文文件行（本轮改动 / 交付卡片 / 对比页）没有官方插槽，才自绘菜单，渲染在官方 `shell.overlay` 槽里，
//     菜单本体复用官方 primitives 的 Menu / MenuItemButton。
//  4) 打开类动作：0.2.1 起走**本插件宿主半侧**注册的 /ctx-menu/* 路由（宿主再调
//     sessionController.workspacePathApplications / openWorkspacePath，Host 会在启动前重新校验）；
//     0.2.0 上则回退到 remote.session 远程服务。两条路都由「平台桥」统一封装。
//
// 唯一需要长期维护的脆弱面是下面 SELECTORS 里的非公开 data-* 锚点，用 scripts/check.mjs 静态钉住。

window.__ModuleLoader__.load({
  id: 'dsh-ctx-menu',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const P = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    const NS = 'dsh-ctx-menu'
    const log = (...args) => console.log('[dsh-ctx-menu]', ...args)

    // @anchors-begin —— 必须与 anchors.json 的 selectors 逐字一致
    const SELECTORS = {
      sessionRow: '[role="treeitem"][data-row-key^="session:"]',
      workspaceRow: '[role="treeitem"][data-row-key^="workspace:"]',
      changedFiles: '[data-changed-files]',
      changedFileRow: '[data-changed-files] button[aria-describedby]',
      presentedFile: '[data-presented-file]',
      reviewFile: '[data-review-file]',
      fileMention: 'button[class*="fileMention"]',
      editable: 'input, textarea, [contenteditable=""], [contenteditable="true"]',
      skip: '.xterm, [data-document-preview], [role="menu"], [data-shell-overlay]'
    }
    // @anchors-end

    const DICT = {
      zh: {
        openFile: '在 DSH 中打开',
        openWith: '在应用中打开',
        openWithNamed: '在 {name} 中打开',
        openDefault: '用默认应用打开',
        loadingApps: '正在读取打开方式…',
        noApps: '没有可用的关联应用',
        defaultSuffix: '（默认）',
        reveal: '显示文件位置',
        copyRelative: '复制相对路径',
        copyAbsolute: '复制绝对路径',
        noCwd: '取不到当前工作目录，无法生成相对路径',
        copyContents: '复制文件内容',
        saveAs: '另存为…',
        done: '已复制',
        failed: '操作失败',
        binary: '不是文本文件，无法复制内容',
        tooLarge: '文件太大',
      },
      en: {
        openFile: 'Open in DSH',
        openWith: 'Open with',
        openWithNamed: 'Open with {name}',
        openDefault: 'Open with default app',
        loadingApps: 'Reading open-with list…',
        noApps: 'No associated apps',
        defaultSuffix: ' (default)',
        reveal: 'Reveal location',
        copyRelative: 'Copy relative path',
        copyAbsolute: 'Copy absolute path',
        noCwd: 'Working directory unavailable',
        copyContents: 'Copy file contents',
        saveAs: 'Save as…',
        done: 'Copied',
        failed: 'Action failed',
        binary: 'Not a text file',
        tooLarge: 'File too large',
      },
    }

    // ── 极简 store + hook ────────────────────────────────────────────────
    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set: (next) => {
          state = typeof next === 'function' ? next(state) : next
          for (const listener of [...listeners]) listener()
        },
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    }

    function useStore(store) {
      const [, bump] = React.useState(0)
      React.useEffect(() => store.subscribe(() => bump((n) => n + 1)), [store])
      return store.get()
    }

    const menuStore = createStore({ open: false, x: 0, y: 0, file: null, apps: null, appsState: 'idle', notice: null, diag: null })
    const sessionStore = createStore(null)
    const desktopStore = createStore({ canOpen: null, locale: 'zh', dict: DICT.zh, t: makeTranslator('zh') })
    /** 取词函数：之前这里存成字典对象、却按函数调用，导致一开菜单就 TypeError（菜单渲染崩溃 → 槽注册被退役）。 */
    function makeTranslator(localeId) {
      const dict = DICT[localeId] ?? DICT.zh
      return (key, vars) => {
        const raw = typeof dict[key] === 'string' ? dict[key] : key
        if (vars === undefined) return raw
        return raw.replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])))
      }
    }
    /** 最近一次右键时的上下文（当前会话的工作目录），供地址构造使用。 */
    const fileContextStore = createStore({ cwd: null })

    // ── 纯函数（可测） ───────────────────────────────────────────────────
    function isAbsolutePath(value) {
      if (typeof value !== 'string' || value.length === 0) return false
      if (value.startsWith('/')) return true
      if (/^[a-zA-Z]:[\\/]/.test(value)) return true
      if (value.startsWith('\\\\')) return true
      return false
    }

    function lastSegment(value) {
      const text = String(value ?? '')
      const cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
      return cut === -1 ? text : text.slice(cut + 1)
    }

    /** 看起来像个文件路径吗？用来避免把普通按钮的 title 当成路径（「不猜」原则的守卫）。 */
    function looksLikeFilePath(value) {
      if (typeof value !== 'string') return false
      const text = value.trim()
      if (text === '' || text.length > 400) return false
      if (/\s/.test(text)) return false
      if (text.includes('/') === false && text.includes('\\') === false) return false
      return /\.[A-Za-z0-9]{1,8}$/.test(lastSegment(text))
    }

    /** 从 aria-label 之类文案里挑出第一个像路径的片段（chip 没有可用 title 时的兜底）。 */
    function firstPathIn(value) {
      const text = String(value ?? '').trim()
      if (text === '') return null
      if (looksLikeFilePath(text)) return text
      // 抓「盘符路径」或「POSIX 绝对路径」，再剥掉尾随标点/括号（标签文案会带前后缀，例如「在侧边栏打开 <path>」）
      const candidates = text.match(/[A-Za-z]:[\\/][^\s"'<>|]*|\/[^\s"'<>|]*/g)
      if (candidates === null) return null
      for (const raw of candidates) {
        const candidate = raw.replace(/[）)】》"'”’，。；、,;]+$/u, '').trim()
        if (looksLikeFilePath(candidate)) return candidate
      }
      return null
    }

    /** 相对路径 + 会话 cwd → 绝对路径（官方 resolveWorkspacePath 的等价实现；cwd 缺失返回 null，不猜）。 */
    function resolveWithCwd(path, cwd) {
      if (isAbsolutePath(path)) return path
      if (typeof cwd !== 'string' || cwd.trim() === '') return null
      const base = cwd.trim().replace(/[\\/]+$/, '')
      const rest = String(path ?? '').trim().replace(/^[\\/]+/, '')
      if (base === '' || rest === '') return null
      const separator = base.includes('\\') ? '\\' : '/'
      // Windows 盘符路径下把 path 里的 '/' 也归一成 '\'：混用分隔符可能过不了 Host 的路径往返校验。
      const normalized = separator === '\\' ? rest.replace(/\//g, '\\') : rest
      return base + separator + normalized
    }

    function isWindowsStylePath(value) {
      return /^[A-Za-z]:[/\\]/.test(value) || String(value).startsWith('\\\\')
    }

    /**
     * 归一成原生分隔符。官方有些地方给出的绝对路径是**混用**分隔符的
     * （实测 `I:\...\YunLiu\Source/JXHan/Public/...`），Windows 通用 API 能忍，
     * 但 DSH 自己的合成文件系统按原生分隔符解析 —— 混用会让官方的路径校验/关联应用枚举失败，
     * 于是菜单里只剩「没有可用的关联应用」。Windows 风格统一成 `\`，POSIX 统一成 `/`。
     */
    function normalizeToNative(value) {
      const text = String(value ?? '').trim()
      if (text === '') return text
      if (isWindowsStylePath(text)) return text.replace(/\//g, '\\').replace(/\\{2,}/g, '\\')
      return text.replace(/\\/g, '/')
    }

    /** 绝对路径判定（POSIX `/a/b`、Windows 盘符、UNC）——等价官方 isAbsoluteWorkspacePath。 */
    function isAbsoluteWorkspacePath(value) {
      return String(value).startsWith('/') || isWindowsStylePath(value)
    }

    function encodeSegment(segment) {
      return encodeURIComponent(segment).replace(/%3A/gi, ':') // 盘符的冒号保持字面量
    }

    function encodePath(path) {
      return path.split('/').map(encodeSegment).join('/')
    }

    /**
     * `dsh-resource://file/session/<sid>/<path>` 地址——官方 fileAddressFor/sessionFileAddress 的等价实现：
     * 反斜杠归一为 `/`、工作区内的绝对路径剥掉工作区根、逐段编码（盘符冒号保留字面量）。
     */
    function sessionFileAddress(sessionId, cwd, path) {
      const normalized = String(path ?? '').replace(/\\/g, '/')
      const root = typeof cwd === 'string' && cwd !== '' ? cwd.replace(/\\/g, '/').replace(/\/+$/, '') : ''
      let relative = normalized
      if (isAbsoluteWorkspacePath(normalized) && root !== '') {
        if (normalized === root) relative = ''
        else if (normalized.startsWith(root + '/')) relative = normalized.slice(root.length + 1)
      }
      return 'dsh-resource://file/session/' + encodeSegment(String(sessionId)) + '/' + encodePath(relative.replace(/^(?:\.\/)+/, ''))
    }

    function isEditableTarget(element, selector) {
      const editable = element.closest(selector)
      if (editable === null) return false
      if (editable.disabled === true || editable.readOnly === true) return false
      return true
    }

    function selectionText(win) {
      try {
        return String(win?.getSelection?.()?.toString?.() ?? '').trim()
      } catch {
        return ''
      }
    }

    /**
     * 门外规则：返回 null 表示「完全不管」，调用方不得调用 preventDefault。
     * @returns {{kind:'row', row:Element, trigger:Element, id:string, type:string}|{kind:'file', file:object}|null}
     */
    function gate(event, win, doc, cwd = null) {
      if (event.button !== 2) return null
      if (event.defaultPrevented === true) return null // 别的插件已接管 → 退让（先到先得）
      const raw = event.target
      if (raw === null || typeof raw.closest !== 'function') return null
      if (raw.closest(SELECTORS.skip) !== null) return null // 别人的地盘：终端 / 文档预览 / 已开菜单

      // ★ C1：外壳会弹菜单的两种情形一律放行，绝不抢它的「复制」
      if (isEditableTarget(raw, SELECTORS.editable)) return null
      if (selectionText(win) !== '') return null

      const row = resolveRow(raw, SELECTORS, win)
      if (row !== null) return row
      const file = resolveFile(raw, doc, SELECTORS, cwd)
      if (file !== null) return { kind: 'file', file }
      return null
    }

    /** 侧栏行：解析出官方 ⋯ 按钮，准备程序化点击。 */
    function resolveRow(target, selectors, win) {
      const row = target.closest(selectors.sessionRow) ?? target.closest(selectors.workspaceRow)
      if (row === null) return null
      const key = row.getAttribute('data-row-key') ?? ''
      const isSession = key.startsWith('session:')
      const id = isSession ? key.slice('session:'.length) : key.slice('workspace:'.length)
      if (id === '') return null // `workspace:` 空 id = 未分组，官方本就不渲染 ⋯
      if (target.closest('button') !== null) return null // 右键点的是行内按钮 → 交给原生/官方
      if (/\b\w*_?menuOpen\b/.test(row.className) === true) return null // 菜单已开：再点会 toggle 关掉

      const container = rowActionsOf(row)
      if (container === null) return null
      const buttons = container.querySelectorAll('button[type="button"]')
      if (buttons.length === 0) return null
      if (isSession === false && buttons.length < 2) return null // 未分组只剩「新建会话」
      const trigger = buttons[0] // ⋯ 始终是 rowActions 内第一个按钮
      const rect = trigger.getBoundingClientRect()
      const style = win?.getComputedStyle?.(trigger)
      if (rect.width === 0 || rect.height === 0) return null // 非 hover 触发时 rowActions 是 display:none
      if (style !== undefined && style !== null && (style.display === 'none' || style.visibility === 'hidden')) return null
      return { kind: 'row', row, trigger, id, type: isSession ? 'session' : 'workspace' }
    }

    function rowActionsOf(row) {
      for (const child of row.children) {
        if (typeof child.className === 'string' && child.className.includes('rowActions')) return child
      }
      return row.lastElementChild
    }

    /**
     * 文件行：三种表面共用。绝对路径一律读官方已经渲染好的值，不自己拼（避免 422）。
     * @returns {{path:string, display:string, absolute:boolean, source:string}|null}
     */
    function resolveFile(target, doc, selectors, cwd = null) {
      // 1) 本轮改动文件卡片：官方有两条渲染分支，必须都覆盖
      const card = target.closest(selectors.changedFiles)
      if (card !== null) {
        // 1a) 多文件：行按钮的 aria-describedby 指向一个隐藏 span，内容就是官方解析好的绝对路径
        const row = target.closest(selectors.changedFileRow)
        if (row !== null) {
          const describedBy = row.getAttribute('aria-describedby')
          const holder = describedBy === null ? null : doc?.getElementById?.(describedBy)
          const path = normalizeToNative(String(holder?.textContent ?? '').trim())
          if (path === '') return null
          const display = String(row.firstElementChild?.textContent ?? '').trim() || lastSegment(path)
          return { path, display, absolute: isAbsolutePath(path), source: 'changed' }
        }
        // 1b) 单文件：整卡只有标题头，路径在卡片内唯一的隐藏 span 里
        if (card.getAttribute('data-single') !== null) {
          const holder = card.querySelector('span[hidden]')
          const path = normalizeToNative(String(holder?.textContent ?? '').trim())
          if (path === '') return null
          return { path, display: lastSegment(path), absolute: isAbsolutePath(path), source: 'changed-single' }
        }
        return null
      }

      // 2) 交付文件卡片：找离得最近的、值看起来是绝对路径的 title（官方把 resolveWorkspacePath 的结果放在这里）
      const presented = target.closest(selectors.presentedFile)
      if (presented !== null) {
        const candidates = [presented, ...presented.querySelectorAll('[title]')]
        for (const node of candidates) {
          const value = normalizeToNative(String(node?.getAttribute?.('title') ?? '').trim())
          if (value !== '' && isAbsolutePath(value) === true) {
            return { path: value, display: lastSegment(value), absolute: true, source: 'presented' }
          }
        }
        return null // 拿不到绝对路径就不猜
      }

      // 3) 对比（review）页的文件行：data-review-file 是相对路径，title 是绝对路径
      const review = target.closest(selectors.reviewFile)
      if (review !== null) {
        const path = normalizeToNative(String(review.getAttribute('title') ?? '').trim())
        if (path === '' || isAbsolutePath(path) === false) return null // 拿不到绝对路径就不猜
        return { path, display: String(review.getAttribute('data-review-file') ?? '').trim() || lastSegment(path), absolute: true, source: 'review' }
      }

      // 4) 正文 markdown 里的文件提及 chip —— 两个变体都覆盖（都带 `fileMention` 类）：
      //    a. markdown 链接 [a.md](…) → primitives 的 MarkdownFileLink：class="…fileMention …fileLink"，title = 工作区相对路径
      //    b. 行内代码 `a.md` 被 chat 解析成 chip → primitives 的 inlineCode 分支：class="…fileMention"（没有 fileLink），
      //       title = 绝对路径，并有 aria-label="在侧边栏打开 <path>"
      const mention = target.closest(selectors.fileMention)
      if (mention !== null) {
        const title = String(mention.getAttribute('title') ?? '').trim()
        const raw = looksLikeFilePath(title) ? title : firstPathIn(String(mention.getAttribute('aria-label') ?? ''))
        if (raw === null) return null // title/aria-label 都不是路径（例如图片 chip）→ 不猜
        const absolutePath = resolveWithCwd(raw, cwd)
        if (absolutePath === null) {
          // 相对路径 + 当下没有 cwd：**仍然接管**，标记为 pending 由调用方异步解析后再弹菜单。
          // 曾经这里直接放行，结果"别的会话/工作区的文件 chip 右键毫无反应"——静默失败最难查。
          return { path: raw, display: raw, absolute: false, pending: true, source: 'mention' }
        }
        return { path: absolutePath, display: raw, absolute: true, source: 'mention' }
      }

      return null
    }

/** 当前会话的工作目录：官方就是这么取（sessions 服务的 list store → byId[sessionId].cwd），拿不到返回 null。 */
    function currentSessionCwd(ctx) {
      try {
        const sessions = ctx?.get?.('sessions')
        const sessionId = sessionStore.get()
        if (sessions === undefined || sessionId === null) return null
        const snapshot = sessions.list?.getSnapshot?.()
        const entry = snapshot?.byId?.[sessionId]
        const cwd = entry?.cwd
        return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : null
      } catch (error) {
        log('session cwd lookup failed', error)
        return null
      }
    }

    // ── 平台桥：0.2.1 自有宿主路由优先，0.2.0 旧远程服务兜底 ────────────────
    // 0.2.1 起插件客户端半侧拿不到 remote.session / remote.workspaceFiles（客户端 Builtin 只剩
    // ctx / React / host / styles / console），改由本插件宿主半侧（index.js）注册的 /ctx-menu/*
    // 路由代劳；旧版本仍然回退到远程服务，因此同一份客户端代码在 0.2.0 与 0.2.1 上都能工作。
    const ROUTES = {
      capabilities: 'ctx-menu/capabilities',
      apps: 'ctx-menu/apps',
      cwd: 'ctx-menu/cwd',
      read: 'ctx-menu/read',
      open: 'ctx-menu/open',
      reveal: 'ctx-menu/reveal',
    }
    /** 宿主路由没挂上（旧版本 / 宿主半侧未加载）——调用方据此回退旧服务。 */
    const ROUTE_MISSING = 'route/missing'

    async function callRoute(name, options = {}) {
      let url = ROUTES[name]
      if (url === undefined) return { ok: false, code: ROUTE_MISSING }
      if (options.query !== undefined) {
        const params = new URLSearchParams()
        for (const [key, value] of Object.entries(options.query)) {
          if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
        }
        const suffix = params.toString()
        if (suffix !== '') url += '?' + suffix
      }
      const init = { method: options.method ?? 'GET' }
      if (options.body !== undefined) {
        init.headers = { 'content-type': 'application/json' }
        init.body = JSON.stringify(options.body)
      }
      try {
        const response = await fetch(url, init)
        if (response.status === 404) return { ok: false, code: ROUTE_MISSING }
        let payload = null
        try {
          payload = await response.json()
        } catch {
          payload = null
        }
        if (response.ok !== true) {
          return { ok: false, code: payload?.code ?? 'route/failed', message: payload?.message, status: response.status }
        }
        return { ok: true, data: payload }
      } catch (error) {
        log('route call failed:', name, error)
        return { ok: false, code: 'route/network' }
      }
    }

    function legacySessionService(ctx) {
      try {
        return ctx?.get?.('remote.session')
      } catch (error) {
        return undefined
      }
    }

    function legacyFilesService(ctx) {
      try {
        return ctx?.get?.('remote.workspaceFiles')
      } catch (error) {
        return undefined
      }
    }

    /** 桌面能力探测：自有路由优先，0.2.0 的远程服务兜底。 */
    async function probeDesktop(ctx) {
      const routed = await callRoute('capabilities')
      if (routed.ok === true) return { canOpen: routed.data?.canOpen === true }
      const legacy = legacySessionService(ctx)
      if (legacy === undefined || typeof legacy.canOpenWorkspacePath !== 'function') return { canOpen: false }
      try {
        const result = await legacy.canOpenWorkspacePath()
        return { canOpen: result?.ok === true && result.value === true }
      } catch (error) {
        log('legacy canOpenWorkspacePath failed', error)
        return { canOpen: false }
      }
    }

    /** 该文件的系统关联应用列表。 */
    async function fetchApps(ctx, path) {
      const routed = await callRoute('apps', { query: { path } })
      if (routed.ok === true) {
        return {
          ok: true,
          canOpen: routed.data?.canOpen !== false,
          apps: Array.isArray(routed.data?.apps) ? routed.data.apps : [],
        }
      }
      const legacy = legacySessionService(ctx)
      if (legacy === undefined || typeof legacy.workspacePathApplications !== 'function') {
        return { ok: false, code: routed.code }
      }
      try {
        const result = await legacy.workspacePathApplications({ path })
        if (result?.ok !== true) return { ok: false, code: 'apps/failed' }
        return { ok: true, canOpen: true, apps: Array.isArray(result.value) ? result.value : [] }
      } catch (error) {
        log('legacy workspacePathApplications failed', error)
        return { ok: false, code: 'apps/failed' }
      }
    }

    /** 启动 / 定位。request 形如 {path, application?} 或 {path, action:'reveal'}。 */
    async function launchPath(ctx, request) {
      const reveal = request.action === 'reveal'
      const routed = await callRoute(reveal ? 'reveal' : 'open', {
        method: 'POST',
        body: reveal ? { path: request.path } : request,
      })
      if (routed.ok === true) return { ok: true }
      const legacy = legacySessionService(ctx)
      if (legacy === undefined || typeof legacy.openWorkspacePath !== 'function') return routed
      try {
        const result = await legacy.openWorkspacePath(request)
        return { ok: result?.ok === true }
      } catch (error) {
        log('legacy openWorkspacePath failed', error)
        return { ok: false, code: 'open/failed' }
      }
    }

    /** 会话工作目录（异步版）：先用手上已有的（useSessions 快照 / handler 解析），再向宿主要，最后回退服务快照。 */
    async function sessionCwdAsync(ctx, sessionId) {
      const cached = fileContextStore.get().cwd
      if (typeof cached === 'string' && cached.trim() !== '') return cached
      if (sessionId === null || sessionId === undefined) return null
      const routed = await callRoute('cwd', { query: { sessionId } })
      if (routed.ok === true && typeof routed.data?.cwd === 'string' && routed.data.cwd !== '') return routed.data.cwd
      return currentSessionCwd(ctx)
    }

    /** 读文件文本（复制内容）：自有路由 → 旧 workspaceFiles 分页读取。 */
    async function readTextForCopy(ctx, sessionId, path) {
      const routed = await callRoute('read', { query: { path, mode: 'text' } })
      if (routed.ok === true && typeof routed.data?.text === 'string') return { ok: true, text: routed.data.text }
      const files = legacyFilesService(ctx)
      if (files === undefined || sessionId === null) return { ok: false, code: routed.code }
      return readTextPaged(files, sessionId, path)
    }

    /** 读文件字节（另存为）：自有路由 → 旧 readBytes。 */
    async function readBytesForSave(ctx, sessionId, path) {
      const query = new URLSearchParams({ path, mode: 'bytes' }).toString()
      try {
        const response = await fetch(`${ROUTES.read}?${query}`)
        if (response.status !== 404) {
          if (response.ok !== true) {
            let payload = null
            try {
              payload = await response.json()
            } catch {
              payload = null
            }
            return { ok: false, code: payload?.code ?? 'read/failed' }
          }
          const buffer = await response.arrayBuffer()
          return { ok: true, data: new Uint8Array(buffer) }
        }
      } catch (error) {
        log('route read(bytes) failed:', error)
      }
      const files = legacyFilesService(ctx)
      if (files === undefined || sessionId === null) return { ok: false, code: 'host/unsupported' }
      const result = await files.readBytes(sessionId, path, {})
      if (result?.ok !== true) return { ok: false, code: 'read/failed' }
      return { ok: true, data: result.value?.data }
    }

    // ── 业务动作（全部复用 DSH 公开能力） ────────────────────────────────
    async function readTextPaged(workspaceFiles, sessionId, path) {
      const MAX_LINES = 5000
      const MAX_BYTES = 2 * 1024 * 1024
      const chunks = []
      let offset = 1
      let bytes = 0
      for (;;) {
        const result = await workspaceFiles.read(sessionId, path, { offset, limit: MAX_LINES })
        if (result?.ok !== true) return { ok: false, code: result?.error?.code ?? 'unknown' }
        const page = result.value
        chunks.push(String(page.text ?? ''))
        bytes += chunks[chunks.length - 1].length
        if (page.eof === true || page.lines === 0) break
        if (bytes >= MAX_BYTES) return { ok: false, code: 'workspace-file/too-large' }
        offset = page.offset + page.lines
      }
      return { ok: true, text: chunks.join('\n') }
    }

    async function copyText(text) {
      try {
        if (typeof P.writeClipboard === 'function') {
          await P.writeClipboard(text)
          return true
        }
      } catch (error) {
        log('writeClipboard failed, falling back', error)
      }
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        area.remove()
        return ok
      } catch (error) {
        log('clipboard fallback failed', error)
        return false
      }
    }

    function notify(text) {
      menuStore.set((st) => ({ ...st, notice: text }))
      const timer = setTimeout(() => menuStore.set((st) => ({ ...st, notice: null })), 3200)
      if (typeof timer?.unref === 'function') timer.unref()
    }

    // ── 诊断（Alt + 右键）：把「为什么没接管」摊开，避免靠猜 ────────────────
    function describeElement(element, limit = 8) {
      const lines = []
      let cursor = element
      let depth = 0
      while (cursor !== null && cursor !== undefined && depth < limit) {
        const tag = String(cursor.tagName ?? 'el').toLowerCase()
        const className = typeof cursor.className === 'string' ? cursor.className : ''
        const classes = className === '' ? '' : '.' + className.trim().split(/\s+/).slice(0, 3).join('.')
        const attrs = []
        for (const [key, value] of Object.entries(cursor.dataset ?? {})) attrs.push(`data-${key}=${String(value).slice(0, 28)}`)
        for (const name of ['role', 'title', 'aria-describedby', 'hidden', 'aria-label']) {
          const value = cursor.getAttribute?.(name)
          if (value !== null && value !== undefined) attrs.push(`${name}=${String(value).slice(0, 40)}`)
        }
        lines.push(`  ${depth}: <${tag}${classes}${attrs.length === 0 ? '' : ' ' + attrs.join(' ')}>`)
        cursor = cursor.parentElement
        depth += 1
      }
      return lines
    }

    function diagnose(event, win, doc, cwd = null) {
      const target = event.target
      const canClosest = typeof target?.closest === 'function'
      const skipHit = canClosest ? target.closest(SELECTORS.skip) : null
      const editableHit = canClosest ? target.closest(SELECTORS.editable) : null
      const selection = selectionText(win)
      const lines = []
      lines.push(`event: button=${String(event.button)} altKey=${String(event.altKey)} defaultPrevented=${String(event.defaultPrevented)}`)
      lines.push(`selection: ${JSON.stringify(selection.slice(0, 40))}`)
      lines.push(`editable: ${editableHit === null ? 'no' : describeElement(editableHit, 1)[0].trim()}`)
      lines.push(`skip-zone: ${skipHit === null ? 'no' : describeElement(skipHit, 1)[0].trim()}`)
      lines.push(`session-cwd: ${cwd === null || cwd === undefined ? '(未取到，相对路径无法解析)' : cwd}`)
      const choice = preferredAppId()
      lines.push(`open-in-app.choice: ${choice === null ? '(未设置 → 外层行将退回系统默认关联)' : choice}`)
      lines.push('')
      lines.push('DOM 链（自 target 向上，最多 8 层）:')
      lines.push(...describeElement(target, 8))
      lines.push('')
      lines.push('锚点判定:')
      for (const [name, selector] of Object.entries(SELECTORS)) {
        if (name === 'skip' || name === 'editable' || name === 'overlay') continue
        const hit = canClosest ? target.closest(selector) : null
        lines.push(`  ${name}: ${hit === null ? '未命中' : describeElement(hit, 1)[0].trim()}`)
      }
      const row = resolveRow(target, SELECTORS, win)
      const file = resolveFile(target, doc, SELECTORS, cwd)
      lines.push('')
      lines.push(`resolveRow: ${row === null ? 'null' : `${row.type} / ${row.id}`}`)
      lines.push(`resolveFile: ${file === null ? 'null' : JSON.stringify(file)}`)
      const verdict = gate(event, win, doc, cwd)
      lines.push(`gate: ${verdict === null ? '放行（不接管）' : verdict.kind}`)
      if (verdict === null) {
        if (event.defaultPrevented === true) lines.push('原因: 别人已经 preventDefault')
        else if (skipHit !== null) lines.push('原因: 命中排除区（终端 / 文档预览 / 已开菜单 / 我的浮层）')
        else if (editableHit !== null) lines.push('原因: 可编辑域 —— 外壳会弹编辑菜单，按 C1 必须放行')
        else if (selection !== '') lines.push('原因: 有选中文本 —— 外壳会弹「复制」，按 C1 必须放行')
        else if (row !== null) lines.push('原因: 行命中但 ⋯ 按钮不可用（不可见 / 已开 / 取不到）')
        else lines.push('原因: 没有命中任何锚点')
      }
      return lines.join('\n')
    }

    // ── 菜单渲染 ────────────────────────────────────────────────────────
    function MenuHost({ ctx }) {
      const state = useStore(menuStore)
      const sessionId = useStore(sessionStore)
      const desktop = useStore(desktopStore)
      const t = desktop.t
      boot.menuHostRenders = (boot.menuHostRenders ?? 0) + 1 // 诊断用：证明菜单渲染路径是通的
      if (state.open !== true || state.file === null) return renderNotice(state)
      const { items, actions } = buildItems(state, { ctx, sessionId, desktop, t })
      return renderNotice(state, h(P.Menu, {
        open: true,
        portal: true,
        compact: true,
        // 用官方数据接口 `items`（而不是 children）：只有这条路径带二级菜单，
        // 关联应用因此能像官方文件菜单一样收进「在应用中打开 ▸」。
        items,
        // 官方 onSelect 只回传 id（子菜单条目走同一个回调）→ 用 actions 表分发。
        onSelect: (id) => {
          closeMenu() // 菜单是 owner-controlled：官方不会自己关，必须我们关
          const action = actions[id]
          if (typeof action !== 'function') return
          Promise.resolve()
            .then(action)
            .catch((error) => {
              log('action failed', id, error)
              notify(t('failed'))
            })
        },
        onClose: () => closeMenu(),
        // 只给自家菜单卡加类名：CSS 里据此钳制子菜单、补命中桥、按需翻转，绝不影响别的插件的菜单。
        // 右侧放不下子菜单就往左展开（官方对子菜单没有任何视口钳制）。
        listClassName: 'ctxm-menu' + (state.x + SUBMENU_ROOM > viewportWidth() ? ' ctxm-menu-flip' : ''),
        anchor: h('span', { style: { display: 'none' } }),
        getAnchorRect: () => ({ left: state.x, top: state.y, right: state.x, bottom: state.y, width: 0, height: 0 }),
      }))
    }

    function renderNotice(state, node) {
      const children = []
      if (node !== undefined && node !== null) children.push(node)
      if (state.notice !== null) children.push(h('div', { key: 'notice', className: 'ctxm-notice' }, state.notice))
      if (children.length === 0) return null
      return h(React.Fragment, null, ...children)
    }

    /**
     * DSH 自己那个「在应用中打开」控件记下的默认应用。
     *
     * 官方实现：`createSnapshotStore("", { persist: { name: "dsh.open-in-app.choice" } })`，
     * 而 `@deepseek-ai/dsh-client-store` 的持久化是"整值 JSON 写 localStorage"，
     * 所以真实取值要 `JSON.parse(localStorage['dsh.open-in-app.choice'])`。
     * 值是那个控件固定目录里的 id（如 'rider' / 'vscode' / 'explorer'），**不是**系统默认关联。
     */
    function preferredAppId() {
      try {
        const raw = window.localStorage?.getItem('dsh.open-in-app.choice')
        if (typeof raw !== 'string' || raw === '') return null
        const value = JSON.parse(raw)
        return typeof value === 'string' && value !== '' ? value : null
      } catch (error) {
        log('read dsh.open-in-app.choice failed', error)
        return null
      }
    }

    /** 官方目录 id → 本文件关联列表里可能出现的名字片段（同一应用在不同来源里叫法不同）。 */
    const APP_ALIASES = {
      vscode: ['visual studio code', 'code.exe', 'code - insiders'],
      vscodeinsiders: ['visual studio code insiders', 'code - insiders'],
      cursor: ['cursor'],
      windsurf: ['windsurf'],
      zed: ['zed'],
      sublimetext: ['sublime_text', 'sublime text'],
      androidstudio: ['android studio', 'studio64'],
      intellij: ['intellij', 'idea64', 'idea'],
      pycharm: ['pycharm'],
      webstorm: ['webstorm'],
      goland: ['goland'],
      clion: ['clion'],
      phpstorm: ['phpstorm'],
      rubymine: ['rubymine'],
      datagrip: ['datagrip'],
      rider: ['rider', 'rider64'],
      explorer: ['explorer.exe', '文件资源管理器', 'windows 资源管理器', '资源管理器', 'file explorer', 'windows explorer'],
      filemanager: ['file manager', '文件管理器'],
      finder: ['finder'],
    }

    function normalizeForMatch(value) {
      return String(value ?? '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
    }

    /** id 的"主干"：去路径、去扩展名、去噪（'explorer.exe' → 'explorer'、'C:\\x\\rider64.exe' → 'rider64'）。 */
    function idStem(value) {
      const text = String(value ?? '').replace(/\\/g, '/')
      const base = text.slice(text.lastIndexOf('/') + 1)
      const dot = base.lastIndexOf('.')
      return normalizeForMatch(dot > 0 ? base.slice(0, dot) : base)
    }

    /** 切词：只保留字母/数字/汉字，丢弃长度 < 2 的碎片。 */
    function tokensOf(value) {
      return String(value ?? '')
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fff]+/)
        .filter((token) => token.length >= 2)
    }

    /**
     * 这些词太通用，**不允许**参与"整词包含"那一级匹配。
     * 教训：`explorer` 曾把 `internet**explorer**`（Internet Explorer）匹配成默认应用——
     * 子串/整词包含对通用词就是错配机器，只能靠 id 主干或名字全等来认定。
     */
    const GENERIC_TOKENS = new Set([
      'explorer', 'file', 'manager', 'windows', 'studio', 'viewer', 'editor', 'text', 'code',
      // 扩展名碎片绝不能当判据：'explorer.exe' 会被切成 ['explorer','exe']，
      // 而 'exe' 几乎能从任何"名字里带 .exe 的条目"上命中（曾把 hl2.exe 匹配成资源管理器）。
      'exe', 'com', 'bat', 'cmd', 'lnk', 'app', 'dll', 'run',
    ])

    /**
     * 在该文件**自己的关联列表**里找出 DSH 记下的那个应用。
     * 只有列表里的 id 才会被 Host 的 openWorkspacePath 接受，所以必须落到列表条目上。
     *
     * 分级（严格 → 宽松，前一级全表扫完才进下一级，避免"列表顺序先到先得"）：
     *   ① id 全等 ② id 主干相等（'explorer' ↔ 'explorer.exe'；'vscode' 靠别名 'code.exe' ↔ 'code'）
     *   ③ 名字全等 ④ 整词命中（'rider' ⊂ 'JetBrains Rider 2026.2.1'），多候选取"多余词最少"的
     * 都不中返回 null，由调用方退回系统默认。
     */
    function pickPreferredApp(apps, choiceId) {
      if (choiceId === null || choiceId === undefined || choiceId === '') return null
      if (!Array.isArray(apps) || apps.length === 0) return null
      const wanted = String(choiceId).toLowerCase()
      const aliases = APP_ALIASES[wanted] ?? []

      for (const app of apps) {
        if (String(app.id).toLowerCase() === wanted) return app
      }

      const wantedStems = new Set([idStem(wanted), ...aliases.map(idStem)].filter((stem) => stem !== ''))
      for (const app of apps) {
        const stem = idStem(app.id)
        if (stem !== '' && wantedStems.has(stem)) return app
      }

      const wantedNames = new Set([normalizeForMatch(wanted), ...aliases.map(normalizeForMatch)].filter((name) => name !== ''))
      for (const app of apps) {
        if (wantedNames.has(normalizeForMatch(app.name))) return app
      }

      // 整词这一级只取"主干分词"：别名先去掉扩展名再切词，避免 'exe' 之类的碎片成为判据。
      const wantedTokens = new Set(
        [wanted, ...aliases.map(idStem)]
          .flatMap(tokensOf)
          .filter((token) => token.length >= 4 && GENERIC_TOKENS.has(token) === false),
      )
      if (wantedTokens.size === 0) return null
      let best = null
      for (const app of apps) {
        const appTokens = new Set([...tokensOf(idStem(app.id)), ...tokensOf(app.name)])
        if ([...wantedTokens].some((needle) => appTokens.has(needle)) === false) continue
        const extra = appTokens.size
        if (best === null || extra < best.extra) best = { app, extra }
      }
      return best === null ? null : best.app
    }

    /** 菜单卡 + 子菜单卡的大致宽度：判断右侧还放不放得下子菜单。 */
    const SUBMENU_ROOM = 380

    function viewportWidth() {
      const width = window.innerWidth
      return typeof width === 'number' && width > 0 ? width : 0
    }

    /**
     * 「复制相对路径」用的相对化：相对**当前会话的工作目录**。
     * - 路径在工作目录内 → 剥掉根，分隔符统一变 `/`（贴进代码/文档/对话都合适）；
     * - 正好是工作目录自身 → `.`；
     * - 不在工作目录内 → 退回正斜杠形式的绝对路径（宁可给绝对路径，也不给算错的相对路径）；
     * - 拿不到工作目录 → null，调用方提示而不是猜。
     * 前缀比较大小写不敏感（Windows 盘符/路径不区分大小写）。
     */
    function relativeToCwd(path, cwd) {
      const target = String(path ?? '').trim()
      if (target === '') return null
      if (typeof cwd !== 'string' || cwd.trim() === '') return null
      const toSlashes = (value) => value.replace(/\\/g, '/')
      const root = toSlashes(cwd.trim()).replace(/\/+$/, '')
      const full = toSlashes(target)
      if (root === '') return null
      if (full.toLowerCase() === root.toLowerCase()) return '.'
      if (full.toLowerCase().startsWith(root.toLowerCase() + '/')) return full.slice(root.length + 1)
      return full
    }

    /** 关联应用菜单里的图标（官方返回值带 base64 icon）。 */
    function appIcon(app) {
      if (app === null || app === undefined || !app.icon) return undefined
      return h('img', { src: String(app.icon), width: 14, height: 14, alt: '' })
    }

    /**
     * 构造官方 Menu 的 `items` + 动作表。
     * 结构对齐官方文件菜单：打开类 → 分隔线 → 默认应用/应用中打开/定位 → 分隔线 → 复制/另存。
     */
    function buildItems(state, env) {
      const { ctx, sessionId, t } = env
      const file = state.file
      const cwd = fileContextStore.get().cwd
      const head = []
      const mid = []
      const tail = []
      const actions = {}
      // 「在 DSH 中打开」需要 0.2.0 的 sidebarRight 服务；0.2.1 起没有公开的等价入口
      // （deliverables 的 openResource 是它自己 tab 的 actions，插件拿不到）→ 服务缺失时该行不出现。
      const sidebarRight = ctx.get('sidebarRight')
      const desktopReady = env.desktop.canOpen === true

      if (sidebarRight !== undefined && typeof sidebarRight.openResource === 'function' && sessionId !== null) {
        head.push({ id: 'open-file', label: t('openFile') })
        actions['open-file'] = async () => {
          const liveCwd = cwd ?? (await sessionCwdAsync(ctx, sessionId))
          sidebarRight.openResource(sessionFileAddress(sessionId, liveCwd, file.path))
        }
      }

      if (desktopReady && file.absolute) {
        const ordered = state.appsState === 'ready' && Array.isArray(state.apps)
          ? [...state.apps].sort((a, b) => Number(b.default === true) - Number(a.default === true))
          : null

        if (state.appsState === 'loading') {
          mid.push({ id: 'apps-loading', label: t('loadingApps'), disabled: true })
        }
        if (ordered !== null) {
          // 外层直开默认应用：优先用**DSH 自己那个「在应用中打开」控件记住的应用**
          // （localStorage['dsh.open-in-app.choice']），它才是用户心里的"默认"；
          // 拿不到或在本文件的关联列表里找不到，才退回系统默认关联（apps 里 default: true 的那项）。
          const chosen = pickPreferredApp(ordered, preferredAppId())
          const osDefault = ordered.find((app) => app.default === true) ?? null
          const preferred = chosen ?? osDefault
          // 诊断：把"选择 → 命中哪条 → 列表长什么样"整体留证。
          // 踩过的坑：id 与 name 会不一致（曾出现 { id: 'explorer', name: 'hl2.exe' } 之类），
          // 只看菜单标题无法判断是匹配错还是列表本身脏，必须看原始条目。
          boot.lastMenu = {
            choice: preferredAppId(),
            picked: preferred === null ? null : `${String(preferred.name)} [${String(preferred.id)}]`,
            osDefaultId: osDefault === null ? null : String(osDefault.id),
            apps: ordered.map((app) => `${String(app.name)} [${String(app.id)}]${app.default === true ? ' (default)' : ''}`),
          }
          log('open-with list:', JSON.stringify(boot.lastMenu))
          mid.push({
            id: 'default-app',
            label: preferred !== null ? t('openWithNamed', { name: String(preferred.name) }) : t('openDefault'),
            icon: appIcon(preferred),
          })
          actions['default-app'] = preferred !== null
            ? () => openWith(ctx, file.path, String(preferred.id))
            : () => openDefault(ctx, file.path)
        }
        if (ordered !== null && ordered.length > 0) {
          const submenu = ordered.map((app) => {
            const id = 'app:' + String(app.id)
            actions[id] = () => openWith(ctx, file.path, String(app.id))
            return {
              id,
              label: String(app.name) + (app.default === true ? t('defaultSuffix') : ''),
              icon: appIcon(app),
            }
          })
          mid.push({ id: 'apps', label: t('openWith'), submenu })
        } else if (state.appsState === 'ready') {
          mid.push({ id: 'apps-empty', label: t('noApps'), disabled: true })
        }
        mid.push({ id: 'reveal', label: t('reveal') })
        actions['reveal'] = () => revealPath(ctx, file.path)
      }

      tail.push({ id: 'copy-relative', label: t('copyRelative') })
      actions['copy-relative'] = async () => {
        // 相对**当前会话的工作目录**：右键那一刻写入的 cwd；为空时再向宿主要一次（0.2.1 路由）
        const liveCwd = cwd ?? (await sessionCwdAsync(ctx, sessionId))
        const relative = relativeToCwd(file.path, liveCwd)
        if (relative === null) {
          notify(t('noCwd'))
          return
        }
        const ok = await copyText(relative)
        if (ok === true) notify(t('done'))
      }

      tail.push({ id: 'copy-absolute', label: t('copyAbsolute') })
      actions['copy-absolute'] = async () => {
        const ok = await copyText(file.path)
        if (ok === true) notify(t('done'))
      }

      // 读内容 / 另存：0.2.1 走自有宿主路由（宿主 node:fs），0.2.0 回退 remote.workspaceFiles
      if (file.absolute === true) {
        tail.push({ id: 'copy-contents', label: t('copyContents') })
        actions['copy-contents'] = async () => {
          const read = await readTextForCopy(ctx, sessionId, file.path)
          if (read.ok !== true) {
            const code = String(read.code ?? '')
            notify(code.includes('not-text') ? t('binary') : t('tooLarge'))
            return
          }
          const ok = await copyText(read.text)
          if (ok === true) notify(t('done'))
        }
        tail.push({ id: 'save-as', label: t('saveAs') })
        actions['save-as'] = async () => {
          const result = await readBytesForSave(ctx, sessionId, file.path)
          if (result.ok !== true) {
            notify(String(result.code ?? '').includes('too-large') ? t('tooLarge') : t('failed'))
            return
          }
          await saveBytes(result.data, lastSegment(file.path))
        }
      }

      // 分组之间才插分隔线：某组为空时不留孤立/重复的分隔线
      const items = []
      const join = (group, sepId) => {
        if (group.length === 0) return
        if (items.length > 0) items.push({ type: 'separator', id: sepId })
        items.push(...group)
      }
      join(head, 'sep-open')
      join(mid, 'sep-mid')
      join(tail, 'sep-tail')

      return { items, actions }
    }

    async function openWith(ctx, path, application) {
      const result = await launchPath(ctx, { path, application })
      if (result.ok !== true) {
        log('open with application failed:', result.code, result.message)
        notify(desktopStore.get().t('failed'))
      }
    }

    async function openDefault(ctx, path) {
      // 不带 `application` = "用系统默认关联打开"（官方语义）
      const result = await launchPath(ctx, { path })
      if (result.ok !== true) {
        log('open with default app failed:', result.code, result.message)
        notify(desktopStore.get().t('failed'))
      }
    }

    async function revealPath(ctx, path) {
      const result = await launchPath(ctx, { path, action: 'reveal' })
      if (result.ok !== true) {
        log('reveal failed:', result.code, result.message)
        notify(desktopStore.get().t('failed'))
      }
    }

    async function saveBytes(data, suggestedName) {
      const t = desktopStore.get().t
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data ?? [])
      try {
        if (typeof window.showSaveFilePicker === 'function') {
          const handle = await window.showSaveFilePicker({ suggestedName })
          const writable = await handle.createWritable()
          await writable.write(bytes)
          await writable.close()
          return
        }
      } catch (error) {
        if (error?.name === 'AbortError') return
        log('showSaveFilePicker failed, falling back', error)
      }
      try {
        const url = URL.createObjectURL(new Blob([bytes]))
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = suggestedName
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      } catch (error) {
        log('save-as fallback failed', error)
        notify(t('failed'))
      }
    }

    function closeMenu() {
      menuStore.set((st) => ({ ...st, open: false, file: null, apps: null, appsState: 'idle' }))
    }

    function openMenu(x, y, file) {
      menuStore.set({ open: true, x, y, file, apps: null, appsState: 'idle', notice: null, diag: null })
      void loadApps(file)
    }

    function showDiagnostics(report) {
      log(report)
      // 诊断面板**直挂 document.body**，不走 shell.overlay / React：
      // 槽注册一旦被释放，React 路径就整条断掉——而诊断恰恰要在那种时候还能用。
      try {
        renderDiagnosticsDom(report)
      } catch (error) {
        log('diagnostics panel failed', error)
      }
      menuStore.set({ open: false, x: 0, y: 0, file: null, apps: null, appsState: 'idle', notice: null, diag: report })
    }

    /** 纯 DOM 的诊断面板（不依赖任何槽、任何 React 渲染路径）。 */
    function renderDiagnosticsDom(report) {
      const previous = document.querySelector('[data-ctx-menu-diag]')
      if (previous !== null) previous.remove()
      const border = 'var(--dsw-alias-border-l2, #3a3d42)'
      const root = document.createElement('div')
      root.dataset.ctxMenuDiag = 'true'
      root.setAttribute('role', 'dialog')
      root.style.cssText = `position:fixed;left:16px;top:16px;z-index:2147483000;max-width:min(760px,86vw);max-height:70vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-3, #1e1f22);border:1px solid ${border};border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35);overflow:hidden`
      const head = document.createElement('div')
      head.style.cssText = `display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid ${border};font:12px/1.4 system-ui,sans-serif;color:var(--dsw-alias-label-secondary, #aaa)`
      const title = document.createElement('span')
      title.textContent = `dsh-ctx-menu 诊断（Alt + 右键）· v${VERSION}`
      const close = document.createElement('button')
      close.type = 'button'
      close.textContent = '关闭'
      close.style.cssText = `margin-left:auto;background:transparent;border:1px solid ${border};color:inherit;border-radius:6px;font-size:12px;line-height:1;padding:4px 10px;cursor:pointer`
      close.addEventListener('click', () => root.remove())
      head.appendChild(title)
      head.appendChild(close)
      const body = document.createElement('pre')
      body.style.cssText = 'margin:0;padding:10px 12px;overflow:auto;font:11.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-primary, #eee);white-space:pre-wrap;word-break:break-all'
      body.textContent = report
      root.appendChild(head)
      root.appendChild(body)
      document.body.appendChild(root)
    }

    async function loadApps(file) {
      if (file.absolute !== true || desktopStore.get().canOpen !== true) return
      const ctx = ctxRef.current
      if (ctx === null) return
      const token = file.path
      menuStore.set((st) => ({ ...st, appsState: 'loading' }))
      try {
        const result = await fetchApps(ctx, file.path)
        if (menuStore.get().file?.path !== token) return // 菜单已换目标：丢弃过期结果
        if (result.ok !== true) {
          log('open-with list unavailable:', result.code)
          menuStore.set((st) => ({ ...st, apps: [], appsState: 'ready' }))
          return
        }
        menuStore.set((st) => ({ ...st, apps: result.apps, appsState: 'ready' }))
      } catch (error) {
        log('open-with list failed:', error)
        if (menuStore.get().file?.path === token) menuStore.set((st) => ({ ...st, apps: [], appsState: 'ready' }))
      }
    }

    // ── 会话 id / cwd 探针：会话级插槽把 sessionId 与 useSessions 作为标准 prop 传下来 ─────
    // cwd 用**官方 0.2.1 同款来源**（`useSessions((s) => s.byId[sessionId]?.cwd)`，deliverables/chat 都这么取）。
    // 早期只读 ctx.sessions.list 快照，别的会话还没进快照时就拿不到 cwd，导致那些会话里的
    // 相对路径 chip 右键没反应。这里以快照 hook 为首选、服务快照为兜底。
    function useNoSessions() {
      React.useState(0) // 保持 hook 调用次数稳定：useSessions 缺失时也不能少调一次
      return undefined
    }

    /** 把 useSessions 快照给的 cwd 落到 store（纯函数，便于单测；hook 为空时不覆盖已有值）。 */
    function syncProbeCwd(hookCwd) {
      const resolved = typeof hookCwd === 'string' && hookCwd.trim() !== '' ? hookCwd : null
      const current = fileContextStore.get().cwd
      if (resolved !== null) {
        if (resolved !== current) fileContextStore.set({ cwd: resolved })
        boot.sessionCwdSource = 'useSessions'
        return
      }
      boot.sessionCwdSource = current === null ? 'none' : 'session-service'
    }

    function SessionProbe(props) {
      const sessionId = props?.sessionId ?? null
      const useSessions = typeof props?.useSessions === 'function' ? props.useSessions : useNoSessions
      const hookCwd = useSessions((state) => (sessionId === null ? undefined : state?.byId?.[sessionId]?.cwd))
      React.useEffect(() => {
        sessionStore.set(sessionId)
      }, [sessionId])
      React.useEffect(() => {
        syncProbeCwd(hookCwd)
      }, [hookCwd])
      return null
    }

    const ctxRef = { current: null }

    // ── 启动可观测性：任何一步失败都留下痕迹，且不拖垮其余步骤 ────────────────
    // 为什么要这个：apply() 中途抛异常会让「接管监听器」根本没装，而外部只能看到
    // 「右键没反应」——无法区分「bundle 没加载 / apply 没跑 / 某一步炸了」。
    // 因此把进度写到 window.__DSH_CTX_MENU__，在 DevTools 里敲一行即可定位。
    const VERSION = '0.2.3'
    const boot = { version: VERSION, phase: 'factory', errors: [] }
    function mark(phase) {
      boot.phase = phase
      try { window.__DSH_CTX_MENU__ = boot } catch { /* 非浏览器环境忽略 */ }
    }
    function fail(step, error) {
      boot.errors.push({ step, message: String(error?.message ?? error) })
      log('step failed:', step, error)
      mark(step + ':failed')
    }
    mark('factory')

    function step(label, run) {
      try {
        const value = run()
        mark(label + ':ok')
        return value
      } catch (error) {
        fail(label, error)
        return undefined
      }
    }

    /** contextmenu 的实际处理（单独抽出来，便于从控制台直接调用测试）。 */
    function handleContextMenu(event, ctx) {
      const cwd = currentSessionCwd(ctx)
      fileContextStore.set({ cwd })
      // 诊断优先：Alt + 右键 永远弹诊断面板。
      // 顺序很重要：先诊断再 preventDefault，否则报告会把自己的 preventDefault 误读成「别人已接管」。
      if (event.button === 2 && event.altKey === true) {
        const report = diagnose(event, window, document, cwd)
        event.preventDefault()
        showDiagnostics(report)
        return
      }
      const hit = gate(event, window, document, cwd)
      if (hit === null) return // ★ 完全不干预：外壳的「复制」等一切照旧
      if (hit.kind === 'row') {
        event.preventDefault()
        hit.trigger.click()
        return
      }
      event.preventDefault() // 注意：不 stopPropagation，避免连坐 xterm / pdf.js 的冒泡处理
      if (hit.file.pending === true) {
        // 相对路径 + 当下没 cwd：先接管，异步拿到 cwd 再弹菜单（拿不到就明确提示）
        void openPendingMenu(ctx, hit.file, event.clientX, event.clientY)
        return
      }
      openMenu(event.clientX, event.clientY, hit.file)
    }

    /** 解析待定文件（相对路径）后再弹菜单；失败给出明确提示，而不是静默无反应。 */
    async function openPendingMenu(ctx, file, x, y) {
      const cwd = fileContextStore.get().cwd ?? (await sessionCwdAsync(ctx, sessionStore.get()))
      const absolutePath = resolveWithCwd(file.path, cwd)
      if (absolutePath === null) {
        log('cannot resolve relative path — no session cwd:', file.path)
        boot.lastPendingFailure = { raw: file.path, cwd: cwd ?? null }
        notify(desktopStore.get().t('noCwd'))
        return
      }
      fileContextStore.set({ cwd })
      openMenu(x, y, { path: absolutePath, display: file.display, absolute: true, source: file.source })
    }

    // ── 菜单挂载：自建 React root，不占用 shell.overlay ────────────────────────
    // 为什么不用官方 shell.overlay 槽：槽里的注册一旦在渲染时抛异常，slots 层会把它
    // "abdicate"（`slots.js: entriesOfSlot 跳过 abdicated`，`reportEntryError(..., {abdicate:true})`），
    // 于是一个渲染 bug 会静默地让菜单永远消失。自建 root + 错误边界可以把崩溃暴露出来，
    // 也不占用任何别人可能想要的槽。
    class MenuBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      componentDidCatch(error) {
        boot.errors.push({ step: 'menu-render', message: String(error?.message ?? error) })
        log('menu render failed', error)
      }
      render() {
        if (this.state.error !== null) {
          return h('div', { className: 'ctxm-notice' }, 'dsh-ctx-menu 菜单渲染失败：' + String(this.state.error?.message ?? this.state.error))
        }
        return h(MenuHost, this.props)
      }
    }

    function mountMenuHost(ctx) {
      const container = document.createElement('div')
      container.dataset.ctxMenuRoot = 'true'
      // 层本身点击穿透，只有真正的内容（菜单 portal 到 body）接事件
      container.style.cssText = 'position:fixed;inset:0;z-index:30;pointer-events:none'
      document.body.appendChild(container)
      let root = null
      try {
        const client = require('react-dom/client')
        root = client.createRoot(container)
        root.render(h(MenuBoundary, { ctx }))
        boot.menuRoot = 'mounted'
      } catch (error) {
        boot.menuRoot = 'failed: ' + String(error?.message ?? error)
        fail('menu-root', error)
      }
      return () => {
        try {
          if (root !== null) root.unmount()
        } catch (error) {
          log('menu root unmount failed', error)
        }
        container.remove()
      }
    }

    // ── 插件体 ──────────────────────────────────────────────────────────
    const inject = ['slots', 'locale']

    function apply(ctx) {
      ctxRef.current = ctx
      mark('apply-start')

      // ① 接管最先装：这是插件的核心能力，绝不能被后续步骤的异常拖累
      step('gate', () => {
        ctx.effect(() => {
          const onContextMenu = (event) => {
            try {
              handleContextMenu(event, ctx)
            } catch (error) {
              // 处理器自身出错也必须吞掉：否则监听器会「看起来失效」，且原生菜单被我们误挡
              boot.errors.push({ step: 'handler', message: String(error?.message ?? error) })
              log('handler failed', error)
            }
          }
          document.addEventListener('contextmenu', onContextMenu, true)
          return () => document.removeEventListener('contextmenu', onContextMenu, true)
        }, NS + ': contextmenu gate')
      })

      // ② 语言：跟随 DSH 当前语言，切换时重渲染
      step('locale', () => {
        const readLocale = () => {
          const locale = ctx.get('locale')
          const active = locale?.getLocale?.().active === 'en' ? 'en' : 'zh'
          desktopStore.set((st) => ({ ...st, locale: active, dict: DICT[active], t: makeTranslator(active) }))
        }
        readLocale()
        const localeService = ctx.get('locale')
        if (typeof localeService?.subscribe === 'function') {
          ctx.effect(() => localeService.subscribe(readLocale), NS + ': locale follow')
        }
      })

      // ③ 桌面能力探测（每页一次；失败即视为无桌面 → 隐藏打开类动作）
      step('desktop-probe', () => {
        ctx.effect(() => {
          let alive = true
          probeDesktop(ctx)
            .then((result) => {
              if (alive) desktopStore.set((st) => ({ ...st, canOpen: result.canOpen === true }))
            })
            .catch((error) => {
              log('desktop probe failed', error)
              if (alive) desktopStore.set((st) => ({ ...st, canOpen: false }))
            })
          return () => { alive = false }
        }, NS + ': desktop probe')
      })

      // ④ 会话 id 探针（conversation.composer.dock 是会话级 list 槽，任意会话下都会挂载）
      step('session-probe', () => {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: NS + '.session',
          order: 999,
        }, SessionProbe))
      })

      // ⑤ 菜单挂载：自建 React root（不占槽，渲染崩溃可诊断、可恢复）
      step('menu-root', () => {
        ctx.effect(() => mountMenuHost(ctx), NS + ': menu root')
      })

      // ⑥ 样式
      step('styles', () => {
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = NS
          tag.dataset.pluginCss = NS + '/style'
          tag.textContent = [
            '.ctxm-notice{position:fixed;right:16px;bottom:16px;z-index:40;padding:6px 12px;border-radius:8px;',
            'font-size:12px;line-height:1.4;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);',
            'border:1px solid var(--dsw-alias-border-l2);box-shadow:0 6px 20px rgba(0,0,0,.16);pointer-events:none}',
            '.ctxm-diag{position:fixed;left:16px;top:16px;z-index:41;width:min(760px,80vw);max-height:70vh;display:flex;flex-direction:column;',
            'background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.28);overflow:hidden}',
            '.ctxm-diag-head{display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);',
            'font-size:12px;color:var(--dsw-alias-label-secondary)}',
            '.ctxm-diag-close{margin-left:auto;background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);',
            'border-radius:6px;font-size:12px;line-height:1;padding:4px 10px;cursor:pointer}',
            '.ctxm-diag-close:hover{color:var(--dsw-alias-label-primary)}',
            '.ctxm-diag-body{margin:0;padding:10px 12px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
            'font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-all}',
            // ── 子菜单：钳制高度 + 保住"命中桥" + 靠边翻转 ────────────────────────
            // 官方 .submenu 用 `left: calc(100% + 10px)` 留了 10px 空隙，并靠 `.submenu::before`
            // 这座桥跨过去（鼠标走桥 = 仍算在父行内，不会触发 mouseleave 收起子菜单）。
            // 但**给子菜单加 overflow 会把伸出元素外的 ::before 一起裁掉** → 桥没了 → 手一抖子菜单就消失。
            // 所以桥改挂在**未被裁剪的父行按钮**上（父行 position:relative 由官方提供），
            // 选择器一律用 role 属性，不依赖 CSS-module 的哈希类名。
            '.ctxm-menu [role="menu"]{max-height:62vh;overflow-y:auto;left:calc(100% - 2px)}',
            '.ctxm-menu [role="menuitem"][aria-haspopup="menu"]::after{content:"";position:absolute;top:0;bottom:0;left:100%;width:14px}',
            // 菜单靠近右边缘时子菜单向左展开，否则它会跑到视口外、根本够不到
            '.ctxm-menu-flip [role="menu"]{left:auto;right:calc(100% - 2px)}',
            '.ctxm-menu-flip [role="menuitem"][aria-haspopup="menu"]::after{left:auto;right:100%}',
          ].join('')
          document.head.appendChild(tag)
          return () => tag.remove()
        }, NS + ': styles')
      })

      // 控制台自检入口：window.__DSH_CTX_MENU__.state()
      boot.state = () => ({
        version: VERSION,
        phase: boot.phase,
        errors: boot.errors,
        sessionId: sessionStore.get(),
        sessionCwd: fileContextStore.get().cwd ?? currentSessionCwd(ctx),
        sessionCwdSource: boot.sessionCwdSource ?? 'unknown',
        lastPendingFailure: boot.lastPendingFailure ?? null,
        canOpen: desktopStore.get().canOpen,
        locale: desktopStore.get().locale,
        menuOpen: menuStore.get().open,
        lastMenu: boot.lastMenu ?? null,
      })
      mark('ready')
    }

    // 仅供 test/ 使用：不参与运行时契约。
    const __internals = { SELECTORS, gate, resolveRow, resolveFile, rowActionsOf, isAbsolutePath, lastSegment, looksLikeFilePath, firstPathIn, resolveWithCwd, sessionFileAddress, encodePath, isAbsoluteWorkspacePath, currentSessionCwd, isEditableTarget, selectionText, readTextPaged, diagnose, describeElement, renderDiagnosticsDom, MenuHost, MenuBoundary, buildItems, appIcon, preferredAppId, pickPreferredApp, idStem, tokensOf, normalizeForMatch, normalizeToNative, relativeToCwd, menuStore, fileContextStore, makeTranslator,
      // 平台桥（0.2.1 路由 / 0.2.0 远程服务）
      ROUTES, callRoute, probeDesktop, fetchApps, launchPath, sessionCwdAsync, readTextForCopy, readBytesForSave, openPendingMenu, SessionProbe, syncProbeCwd, handleContextMenu,
      DICT }

    return { name: NS, inject, apply, __internals }
  },
})