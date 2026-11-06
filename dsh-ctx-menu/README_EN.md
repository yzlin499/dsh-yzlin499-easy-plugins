# dsh-ctx-menu — right-click extras built on the official unified menu

Recent DSH ships a **unified context menu** (`@deepseek-ai/dsh-client-ui-context-menu`). The shell already binds it to
session rows, file rows, changed-file cards, the file tree, images and more, and exposes a **contribution** API:

```js
ctx.contextMenus.register({ id, target: 'file', order, resolve: async (value, signal) => actions })
```

This plugin draws no menu and hijacks no contextmenu event. It only adds the three actions the official `file` menu lacks
(`order: 300`, after the official providers).

## What it does

The official `file` menu already offers: open in sidebar, open in floating pane, reveal location, open with the default app,
copy path, save as / download / copy image. This plugin adds:

| Action | Notes |
| --- | --- |
| **Open with ▸** | The full list of OS-associated apps (the official menu only offers the default one); the default app is listed first and marked “(default)” |
| **Copy relative path** | Relative to the **current session working directory**, forward slashes; a path outside the workspace falls back to a forward-slash absolute path; disabled when the directory is unknown |
| **Copy file contents** | Text body via paged reads (2 MiB cap); binary files are reported instead of copied blindly |

Sidebar session/workspace rows no longer need this plugin — the official unified menu already handles them (v0.3.0 removed
the earlier row takeover).

## Install

```bash
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-ctx-menu"
```

Restart DSH afterwards. Remove with:

```bash
dsh plugin --profile web remove dsh-ctx-menu
```

## Dependencies

- **Official unified menu** (hard): the client service `contextMenus`. When it is missing the plugin logs one line and does
  nothing — no errors, no effect on other plugins.
- Everything else uses DSH's own client remote services — **no host routes and no third-party plugins**:
  `remote.workspaceFiles.stat/read` (absolute path, text), `remote.session.workspacePathApplications/openWorkspacePath`
  (associations, launching), `sessions` (working directory) and optionally `locale`.

## How it works

1. The client half declares `inject = ['contextMenus']` and registers one `file` target contribution
   (`id: dsh-ctx-menu.file`, `order: 300`). On each right-click the shell calls `resolve(target, signal)`; we return action
   descriptors and the shell owns rendering, keyboard navigation, dismissal and failure toasts.
2. `resolve` first resolves the absolute path (`workspaceFiles.stat` → `absolutePath`, else `session cwd + relative path`),
   then the associated apps and the working directory. Anything unavailable is hidden or disabled — never guessed.
3. Actions follow the official contract: `run()` returns a promise, a throw shows `failureLabel`, and success feedback goes
   through `contextMenus.notify()`.
4. The DOM surfaces that carry these actions are bound by the shell (deliverables / chat / sidebar-files / tool / reference …),
   so the actions appear on message file chips, changed-file rows, delivered-file cards and the file tree.

## Development

```bash
node scripts/check.mjs          # sentinel: official unified-menu contract (service name, register shape, file target, DOM bindings)
node --test "test/*.test.mjs"   # 16 tests: registration shape, action list/order, execution effects, path and paged reading
```

`scripts/check.mjs` is an **upgrade sentinel**: if DSH renames the service, changes the registration shape, or stops binding
the `file` target to DOM rows, it fails first instead of letting the plugin die silently. The asar path is hardcoded; pass
`--asar <path>` on another machine.

## Limitations

- **Requires a DSH version that ships the unified menu** (`dsh-client-ui-context-menu`). Without the `contextMenus` service the
  plugin does nothing — use the 0.2.x line (own menu + host routes) on older builds.
- “Copy file contents” is text-only: binary files are reported, and anything above 2 MiB is rejected (use the official
  “Save as…” for the whole file).
- The “Open with” list comes from OS associations (`workspacePathApplications`); in a plain browser / headless environment
  the action does not appear.

## License

MIT
