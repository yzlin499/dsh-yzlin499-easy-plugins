// dsh-ctx-menu — Client half（v0.3.0：复用官方统一右键，只贡献官方缺的动作）
//
// 背景：新版 DSH 内置了**统一右键**（`@deepseek-ai/dsh-client-ui-context-menu`），
// 并通过客户端服务 `ctx.contextMenus` 对第三方开放「菜单贡献」：
//
//   menus.register({ id, target, order, resolve(value, signal) → action[] })
//   action = { id, label, icon?, disabled?, danger?, separatorBefore?, failureLabel?,
//              children?, commandId?, run() }
//
// 官方已经为这些 DOM 面绑好 target：文件行/交付卡（file）、会话行（session）、
// 工作区行（workspace）、右侧栏 tab（tab）、文件树（file/directory）、图片（image）…
// 官方 `open-in-app.file`（order 100）已提供：在侧边栏打开、浮窗打开、显示文件位置、
// 在 <默认应用> 中打开、复制路径（绝对）；`file-actions.file`（order 200）提供另存为/下载/复制图片。
//
// 因此本插件**不再自绘菜单、不再安装捕获期 contextmenu 门控、不再劫持侧栏 ⋯**，
// 只补官方缺的三项（order 300，排在官方之后）：
//   1. 打开方式 ▸      系统关联应用列表（官方只给默认应用）
//   2. 复制相对路径     相对当前会话工作目录
//   3. 复制文件内容     文本文件正文（分页读取，2 MiB 上限）
//
// 依赖全部走 DSH 自带远程服务（`remote.session` / `remote.workspaceFiles` / `sessions`），
// 因此 Host 半侧无需任何路由。

window.__ModuleLoader__.load({
  id: 'dsh-ctx-menu',
  factory: (require) => {
    const React = require('react')

    const NS = 'dsh-ctx-menu'
    const log = (...args) => console.log('[dsh-ctx-menu]', ...args)
    const VERSION = '0.3.0'

    const DICT = {
      zh: {
        openWith: '打开方式',
        copyRelativePath: '复制相对路径',
        copyContents: '复制文件内容',
        copied: '已复制',
        defaultSuffix: '（默认）',
        noCwd: '取不到当前会话的工作目录',
        noApps: '没有可用的关联应用',
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
        noApps: 'No associated apps',
        copyFailed: 'Copy failed',
        binary: 'Not a text file',
        tooLarge: 'File too large',
      },
    }

    const TEXT_MAX_BYTES = 2 * 1024 * 1024
    const MAX_LINES = 5000

    // ── 小工具 ───────────────────────────────────────────────────────────

    /** 可选服务读取：缺失或抛错都返回 undefined。 */
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

    /** 相对当前工作目录；不在其中则退回正斜杠绝对路径；没有 cwd 返回 null。 */
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

    /** 会话工作目录（官方 0.2.x/新版在客户端就是这么取的）。 */
    function sessionCwd(ctx, sessionId) {
      const sessions = serviceOf(ctx, 'sessions')
      const entry = sessions?.list?.getSnapshot?.()?.byId?.[sessionId]
      const cwd = entry?.cwd
      return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : null
    }

    /**
     * 文件绝对路径：官方 `workspaceFiles.stat` 给出 absolutePath（权威），
     * 拿不到时用 会话 cwd + 相对路径 兜底。
     */
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
      if (/^[A-Za-z]:/.test(relative) === true || relative.startsWith('/') || relative.startsWith('\\\\')) return relative
      const cwd = sessionCwd(ctx, sessionId)
      if (cwd === null) return null
      const separator = cwd.includes('\\') ? '\\' : '/'
      return normalizeToNative(cwd.replace(/[\\/]+$/, '') + separator + relative.replace(/^[\\/]+/, ''))
    }

    /** 系统关联应用（官方只展示默认应用，我们补完整列表）。 */
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

    async function copyText(ctx, text) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch (error) {
        log('clipboard write failed:', error?.message ?? error)
        return false
      }
    }

    /** 分页读取文本（上限 2 MiB / 每页 5000 行）。 */
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

    // ── 插件体 ───────────────────────────────────────────────────────────

    // contextMenus 是硬依赖（没有官方统一右键时本插件没有意义）；其余服务在 resolve 时软读。
    const inject = ['contextMenus']

    function apply(ctx) {
      const menus = serviceOf(ctx, 'contextMenus')
      if (menus === undefined || typeof menus.register !== 'function') {
        log('contextMenus service unavailable — 官方统一右键未就位，本插件无事可做')
        return
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

      ctx.effect(
        () =>
          menus.register({
            id: `${NS}.file`,
            target: 'file',
            order: 300, // 官方 open-in-app.file = 100、file-actions.file = 200，我们排最后
            resolve: async (target, signal) => {
              const sessionId = target?.sessionId
              const rawPath = target?.path
              if (typeof rawPath !== 'string' || rawPath === '') return []
              const absolutePath = await absolutePathOf(ctx, sessionId, rawPath, signal)
              signal?.throwIfAborted?.()
              const actions = []

              // 1) 打开方式 ▸（官方只给默认应用）
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

              // 2) 复制相对路径（官方 copyPath 只给绝对路径）
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
                  if (relative === null || (await copyText(ctx, relative)) === false) throw new Error('copy failed')
                  menus.notify(t('copied'), true)
                },
              })

              // 3) 复制文件内容（官方另有「另存为/下载」，但没有复制正文）
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
                    if ((await copyText(ctx, read.text)) === false) throw new Error('copy failed')
                    menus.notify(t('copied'), true)
                  },
                })
              }

              return actions
            },
          }),
        `${NS}: file menu contributions`,
      )

      log(`contribution registered (v${VERSION}): file target, order 300`)
    }

    // 仅供 test/ 使用：不参与运行时契约。
    const __internals = {
      NS,
      VERSION,
      DICT,
      normalizeToNative,
      relativeToCwd,
      sessionCwd,
      absolutePathOf,
      appsOf,
      readText,
      copyText,
      serviceOf,
    }

    return { name: NS, inject, apply, __internals }
  },
})
