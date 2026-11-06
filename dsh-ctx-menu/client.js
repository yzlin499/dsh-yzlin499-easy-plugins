// dsh-ctx-menu — Client half（v0.3.1：复用官方统一右键 + 补官方漏绑的位置）
//
// 一、菜单内容：向官方统一右键贡献动作（不自绘菜单）
//   官方服务 `ctx.contextMenus`（`@deepseek-ai/dsh-client-ui-context-menu`）：
//     ctx.contextMenus.register({ id, target, order, resolve(value, signal) → action[] })
//     action = { id, label, icon?, disabled?, danger?, separatorBefore?, failureLabel?,
//                children?, commandId?, run() }
//   官方已提供（file 目标）：在侧边栏/浮窗打开、显示文件位置、在 <默认应用> 中打开、复制路径（绝对）、
//   另存为/下载/复制图片。本插件只补官方缺的：打开方式 ▸ / 复制相对路径 / 复制文件内容（order 300）。
//
// 二、触发位置：只补官方**漏绑**的 DOM 面
//   官方在 deliverables 里只给「交付文件卡（presented）」绑了 getTriggerProps，
//   「已编辑 N 个文件」卡的每行、以及 review 页的文件行**没有绑 target**（右键无菜单）。
//   因此本插件在这些位置装一个极薄的桥：解析出 { sessionId, path } 后**直接调用官方**
//   `contextMenus.open(target, { x, y })` —— 菜单渲染、键盘导航、关闭、失败提示依旧全由官方负责。
//   官方已绑的位置（presented 卡、正文 chip、文件树、工具卡…）一律**不插手**。
//
// 依赖：客户端服务 contextMenus（硬）、slots（会话 id 探针）；
// 其余能力走 DSH 自带客户端远程服务（remote.session / remote.workspaceFiles / sessions / locale）。

window.__ModuleLoader__.load({
  id: 'dsh-ctx-menu',
  factory: (require) => {
    const React = require('react')

    const NS = 'dsh-ctx-menu'
    const log = (...args) => console.log('[dsh-ctx-menu]', ...args)
    const VERSION = '0.3.1'

    const DICT = {
      zh: {
        openWith: '打开方式',
        copyRelativePath: '复制相对路径',
        copyContents: '复制文件内容',
        copied: '已复制',
        defaultSuffix: '（默认）',
        noCwd: '取不到当前会话的工作目录',
        copyFailed: '复制失败',
        binary: '不是文本文件',
        tooLarge: '文件太大',
      },
      en: {
        openWith: 'Open with',
        copyRelativePath: 'Copy relative path',
        copyContents: 'Copy file contents',
        copied: 'Copied',
        defaultSuffix: ' (default)',
        noCwd: 'Session working directory unavailable',
        copyFailed: 'Copy failed',
        binary: 'Not a text file',
        tooLarge: 'File too large',
      },
    }

    /** 官方**没有**绑定 target 的 DOM 面（我们只在这些位置触发官方菜单）。 */
    const UNBOUND = {
      changedRow: '[data-changed-files] button[aria-describedby]',
      changedCard: '[data-changed-files][data-single]',
      reviewRow: '[data-review-file]',
      editable: 'input, textarea, [contenteditable=""], [contenteditable="true"]',
    }

    const TEXT_MAX_BYTES = 2 * 1024 * 1024
    const MAX_LINES = 5000

    // ── 小工具 ───────────────────────────────────────────────────────────

    function serviceOf(ctx, key) {
      try {
        return ctx.get(key)
      } catch (error) {
        log('service unavailable:', key, error?.message ?? error)
        return undefined
      }
    }

    /** 归一成原生分隔符（官方路径可能是混用的 `I:\a\b/Source/x.h`）。 */
    function normalizeToNative(value) {
      const text = String(value ?? '').trim()
      if (text === '') return text
      const windowsish = /^[A-Za-z]:/.test(text) || text.startsWith('\\\\')
      return windowsish ? text.replace(/\//g, '\\').replace(/\\{2,}/g, '\\') : text.replace(/\\/g, '/')
    }

    const isAbsolutePath = (value) => /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\')

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

    function sessionCwd(ctx, sessionId) {
      const sessions = serviceOf(ctx, 'sessions')
      const entry = sessions?.list?.getSnapshot?.()?.byId?.[sessionId]
      const cwd = entry?.cwd
      return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : null
    }

    async function absolutePathOf(ctx, sessionId, path, signal) {
      const files = serviceOf(ctx, 'remote.workspaceFiles')
      if (files !== undefined && typeof files.stat === 'function') {
        try {
          const result = await files.stat(sessionId, path, signal)
          if (result?.ok === true && typeof result.value?.absolutePath === 'string') {
            return normalizeToNative(result.value.absolutePath)
          }
        } catch (error) {
          log('workspaceFiles.stat failed:', error?.message ?? error)
        }
      }
      const relative = normalizeToNative(path)
      if (isAbsolutePath(relative)) return relative
      const cwd = sessionCwd(ctx, sessionId)
      if (cwd === null) return null
      const separator = cwd.includes('\\') ? '\\' : '/'
      return normalizeToNative(cwd.replace(/[\\/]+$/, '') + separator + relative.replace(/^[\\/]+/, ''))
    }

    async function appsOf(ctx, absolutePath, signal) {
      const remoteSession = serviceOf(ctx, 'remote.session')
      if (remoteSession === undefined || typeof remoteSession.workspacePathApplications !== 'function') return []
      try {
        const result = await remoteSession.workspacePathApplications({ path: absolutePath }, signal)
        if (result?.ok !== true || Array.isArray(result.value) === false) return []
        return result.value
          .filter((app) => app !== null && typeof app?.id === 'string' && typeof app?.name === 'string')
          .map((app) => ({ id: app.id, name: app.name, default: app.default === true, icon: typeof app.icon === 'string' ? app.icon : null }))
      } catch (error) {
        log('workspacePathApplications failed:', error?.message ?? error)
        return []
      }
    }

    async function openWithApp(ctx, absolutePath, application) {
      const remoteSession = serviceOf(ctx, 'remote.session')
      if (remoteSession === undefined || typeof remoteSession.openWorkspacePath !== 'function') return
      const result = await remoteSession.openWorkspacePath({ path: absolutePath, application })
      if (result?.ok !== true) throw new Error('open with application failed')
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch (error) {
        log('clipboard write failed:', error?.message ?? error)
        return false
      }
    }

    async function readText(ctx, sessionId, path, signal) {
      const files = serviceOf(ctx, 'remote.workspaceFiles')
      if (files === undefined || typeof files.read !== 'function') return { ok: false, code: 'host/unsupported' }
      const chunks = []
      let offset = 1
      let bytes = 0
      for (;;) {
        const result = await files.read(sessionId, path, { offset, limit: MAX_LINES }, signal)
        if (result?.ok !== true) return { ok: false, code: String(result?.error?.code ?? 'read/failed') }
        const page = result.value ?? {}
        const text = String(page.text ?? '')
        chunks.push(text)
        bytes += text.length
        if (page.eof === true || (page.lines ?? 0) === 0) break
        if (bytes >= TEXT_MAX_BYTES) return { ok: false, code: 'workspace-file/too-large' }
        offset = (page.offset ?? offset) + (page.lines ?? 0)
      }
      return { ok: true, text: chunks.join('\n') }
    }

    /**
     * 从「官方漏绑」的行里取出路径（绝对或工作区相对，官方都接受）：
     *   1. 改动文件行：按钮的 aria-describedby 指向隐藏 span，内容是官方解析好的绝对路径
     *   2. 单文件卡：卡内唯一的隐藏 span
     *   3. review 行：title 是绝对路径，data-review-file 是相对路径
     * 其余元素一律返回 null（= 交给官方已绑定的处理）。
     */
    function pathOfUnboundTarget(target, doc) {
      if (target === null || typeof target.closest !== 'function') return null
      const row = target.closest(UNBOUND.changedRow)
      if (row !== null) {
        const describedBy = row.getAttribute('aria-describedby')
        const holder = describedBy === null || doc === undefined ? null : doc.getElementById?.(describedBy)
        const text = normalizeToNative(String(holder?.textContent ?? '').trim())
        return text === '' ? null : text
      }
      const card = target.closest(UNBOUND.changedCard)
      if (card !== null) {
        const holder = card.querySelector?.('span[hidden]')
        const text = normalizeToNative(String(holder?.textContent ?? '').trim())
        return text === '' ? null : text
      }
      const review = target.closest(UNBOUND.reviewRow)
      if (review !== null) {
        const title = normalizeToNative(String(review.getAttribute('title') ?? '').trim())
        if (title !== '' && isAbsolutePath(title)) return title
        const relative = normalizeToNative(String(review.getAttribute('data-review-file') ?? '').trim())
        return relative === '' ? null : relative
      }
      return null
    }

    // ── 插件体 ───────────────────────────────────────────────────────────

    // contextMenus：没有官方统一右键时本插件没有意义；slots：用来拿会话 id。
    const inject = ['contextMenus', 'slots']

    function apply(ctx) {
      const menus = serviceOf(ctx, 'contextMenus')
      if (menus === undefined || typeof menus.register !== 'function') {
        log('contextMenus service unavailable — 官方统一右键未就位，本插件无事可做')
        return
      }

      const boot = { version: VERSION, phase: 'apply', lastOpen: null, sessionId: null }
      try {
        window.__DSH_CTX_MENU__ = boot
      } catch {
        /* 非浏览器环境忽略 */
      }

      const localeOf = serviceOf(ctx, 'locale')
      let dict = DICT.zh
      const readLocale = () => {
        const active = localeOf?.getLocale?.().active === 'en' ? 'en' : 'zh'
        dict = DICT[active]
      }
      readLocale()
      if (typeof localeOf?.subscribe === 'function') {
        ctx.effect(() => localeOf.subscribe(readLocale), `${NS}: locale follow`)
      }
      const t = (key) => (typeof dict[key] === 'string' ? dict[key] : key)

      // ① 菜单内容：file 目标、order 300（官方 open-in-app=100、file-actions=200）
      ctx.effect(
        () =>
          menus.register({
            id: `${NS}.file`,
            target: 'file',
            order: 300,
            resolve: async (target, signal) => {
              const sessionId = target?.sessionId
              const rawPath = target?.path
              if (typeof rawPath !== 'string' || rawPath === '') return []
              const absolutePath = await absolutePathOf(ctx, sessionId, rawPath, signal)
              signal?.throwIfAborted?.()
              const actions = []

              if (absolutePath !== null) {
                const apps = await appsOf(ctx, absolutePath, signal)
                signal?.throwIfAborted?.()
                if (apps.length > 1) {
                  const ordered = [...apps].sort((a, b) => Number(b.default === true) - Number(a.default === true))
                  actions.push({
                    id: 'openWith',
                    label: t('openWith'),
                    icon: { key: `${NS}.openWith` },
                    children: ordered.map((app) => ({
                      id: `app:${app.id}`,
                      label: String(app.name) + (app.default === true ? t('defaultSuffix') : ''),
                      ...(app.icon === null ? {} : { icon: { key: `${NS}.app`, src: app.icon } }),
                      run: () => openWithApp(ctx, absolutePath, String(app.id)),
                    })),
                  })
                }
              }

              const cwd = sessionCwd(ctx, sessionId)
              const relative = relativeToCwd(absolutePath ?? normalizeToNative(rawPath), cwd)
              actions.push({
                id: 'copyRelativePath',
                label: t('copyRelativePath'),
                icon: { key: `${NS}.copy` },
                disabled: relative === null,
                separatorBefore: true,
                failureLabel: t('copyFailed'),
                run: async () => {
                  if (relative === null || (await copyText(relative)) === false) throw new Error('copy failed')
                  menus.notify(t('copied'), true)
                },
              })

              if (absolutePath !== null) {
                actions.push({
                  id: 'copyContents',
                  label: t('copyContents'),
                  icon: { key: `${NS}.content` },
                  failureLabel: t('copyFailed'),
                  run: async () => {
                    const read = await readText(ctx, sessionId, rawPath)
                    if (read.ok !== true) {
                      menus.notify(String(read.code ?? '').includes('not-text') ? t('binary') : t('tooLarge'), false)
                      return
                    }
                    if ((await copyText(read.text)) === false) throw new Error('copy failed')
                    menus.notify(t('copied'), true)
                  },
                })
              }

              return actions
            },
          }),
        `${NS}: file menu contributions`,
      )

      // ② 会话 id 探针：会话级插槽把 sessionId 作为标准 prop 传下来
      const session = { id: null }
      const slots = serviceOf(ctx, "slots")
      function SessionProbe(props) {
        const sessionId = props?.sessionId ?? null
        React.useEffect(() => {
          session.id = sessionId
          boot.sessionId = sessionId
        }, [sessionId])
        return null
      }
      if (slots !== undefined && typeof slots.inject === "function") {
        ctx.effect(
          () =>
            slots.inject("conversation.composer.dock", () =>
              slots.register({ name: "conversation.composer.dock", id: NS + ".session", order: 999 }, SessionProbe),
            ),
          `${NS}: session probe`,
        )
      }

      // ③ 桥：只在官方漏绑的位置触发官方菜单（不自绘、不 stopPropagation）
      const handleContextMenu = (event) => {
        if (event?.button !== 2 || event.defaultPrevented === true) return
        if (event.altKey === true) return // Alt+右键留给用户/排查工（本插件不占用）
        const doc = window.document
        const target = event.target
        if (target === null || typeof target.closest !== 'function') return
        if (target.closest(UNBOUND.editable) !== null) return // 可编辑域交给外壳
        const selection = window.getSelection?.()?.toString?.() ?? ''
        if (selection !== '') return // 有选中文本时保留外壳的「复制」
        const path = pathOfUnboundTarget(target, doc)
        if (path === null) return // 官方已绑定的位置：一律不插手
        const sessionId = session.id
        if (sessionId === null) {
          log('session id unknown — skip bridging this row')
          return
        }
        event.preventDefault()
        boot.lastOpen = { sessionId, path, at: Date.now() }
        try {
          menus.open({ kind: 'file', value: { sessionId, path } }, { x: event.clientX ?? 0, y: event.clientY ?? 0 })
        } catch (error) {
          log('open official menu failed:', error?.message ?? error)
        }
      }

      ctx.effect(() => {
        document.addEventListener('contextmenu', handleContextMenu, true)
        return () => document.removeEventListener('contextmenu', handleContextMenu, true)
      }, `${NS}: unbound-row bridge`)

      // 仅测试用：暴露内部实现
      boot.handleContextMenu = handleContextMenu
      boot.pathOfUnboundTarget = pathOfUnboundTarget

      log(`ready (v${VERSION})：贡献 file 目标 order 300；桥接改动文件行 / review 行`)
    }

    // 仅供 test/ 使用：不参与运行时契约。
    const __internals = {
      NS,
      VERSION,
      DICT,
      UNBOUND,
      normalizeToNative,
      isAbsolutePath,
      relativeToCwd,
      sessionCwd,
      absolutePathOf,
      appsOf,
      readText,
      pathOfUnboundTarget,
      serviceOf,
    }

    return { name: NS, inject, apply, __internals }
  },
})
