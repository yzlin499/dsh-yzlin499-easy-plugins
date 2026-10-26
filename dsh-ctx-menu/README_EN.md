# dsh-ctx-menu — Right-click enhancements for DSH

Right-click directly on DSH sidebar rows and on file rows in the conversation body:
a sidebar-row right-click acts as the official `⋯` menu, and a file-row right-click
offers open, open-with, reveal, copy and save-as actions.

> **Status: M1 (client-only, no host routes).** Static anchor self-check and 26 unit tests pass;
> **not yet UI-tested in a live Harness page** (anchor hit rate needs field verification — see Limitations).

## What it does

| Right-click target | Behaviour |
| --- | --- |
| Sidebar **session row** | Opens the official `⋯` menu (pin / rename / fork / archive, plus rows other plugins added) — the menu is not re-drawn |
| Sidebar **workspace row** | Same, opening the official rename / delete-workspace menu |
| **Inline file-mention chip** in the message body (markdown links such as `README.md`) | Same (anchor: the primitives `MarkdownFileLink` class name + `title`, which is usually a workspace-relative path resolved through the session `cwd`) |
| **Changed-file row** in the changed-files card | Open preview, open with, reveal location, copy relative path, copy absolute path, copy file contents, save as… |
| **Presented-file card** | Same |
| **Review page file row** in the right sidebar | Same |

## Install

```bash
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-ctx-menu"
```

> **Use the right profile**: the desktop wrapper (`DeepSeek Harness.exe`) runs the **`desktop`** profile; only a
> plain `dsh web` uses `web`. Picking the wrong one looks like "installed but nothing happens".
> For local development, `dsh plugin --profile desktop add link:D:/path/to/dsh-ctx-menu` also works.

Restart DSH afterwards (the host half needs a restart; client-half-only changes need a page refresh). Remove with:

```bash
dsh plugin --profile web remove dsh-ctx-menu
```

## Usage

Just right-click; there is nothing to configure.

- **Sidebar rows**: the right-click opens the official `⋯` menu. If that trigger is currently invisible
  (not hovered, or the keyboard Menu key path), the plugin **backs off** instead of mispositioning a menu.
- **Diagnostics**: **Alt + right-click** opens a diagnostics panel (also `console.log('[dsh-ctx-menu]', …)`) showing the
  event state, the selection, whether the target sits in an excluded zone, the DOM chain upward from the clicked node
  (with `data-*`), each anchor's hit result, the `resolveRow` / `resolveFile` outcome, and **why the plugin did not
  take over**. Reach for it first whenever a right-click does nothing.
- **File rows**: the menu mirrors the official file menu (grouped, with a submenu):

  ```
  Open in DSH            ← official sidebarRight.openResource — the exact path the official file chip uses
  ──────────────
  Open with Rider        ← opens via the system default app (the label names your default app)
  Open with           ▸  ← submenu: OS-registered handlers, default app first and marked (default)
  Reveal location
  ──────────────
  Copy relative path     ← relative to the **current session working directory**, forward slashes
  Copy absolute path
  Copy file contents
  Save as…
  ```

  - “Open in DSH” needs a session id and the right sidebar; it calls the official
    `ctx.sidebarRight.openResource('dsh-resource://file/session/<sid>/<relative-path>')`;
  - “Open with <app>” resolves its “default app” **from the app you picked in DSH's own “open in app” control** in the
    title bar (persisted at `localStorage['dsh.open-in-app.choice']`, e.g. `"rider"` / `"vscode"` — DSH's own catalog id).
    That id is matched against **this file's own association list** (exact id → name/alias substring) and opened with the
    list's id; with no match it falls back to the OS default association (the `default: true` entry), and failing that to a
    generic “Open with default app” row using `openWorkspacePath({ path })` (no `application`). The Alt+right-click
    diagnostics panel prints the current `open-in-app.choice` value;
  - the open-with submenu comes from `session.workspacePathApplications` (OS-registered handlers for that extension);
    picking a row calls `session.openWorkspacePath({ path, application })`, re-validated by the host before launch;
  - “Reveal location” uses `openWorkspacePath({ path, action: 'reveal' })`;
  - “Copy relative path” is relative to the **current session working directory** (the session's `cwd`, read at
    right-click time): a path inside it is stripped of its root and normalized to `/` (`D:\ws\proj\src\a.ts` →
    `src/a.ts`), the working directory itself yields `.`, and a path **outside** it falls back to the forward-slash
    absolute path (never a wrong relative path). Without a working directory it only notifies.
  - “Copy absolute path” copies the original absolute path (backslashes kept on Windows).
  - “Copy file contents” and “Save as…” use `remote.workspaceFiles.read` (paged, 2 MiB cap) and
    `remote.workspaceFiles.readBytes` (32 MiB cap, browser save dialog).

## Dependencies

**No third-party plugin dependency**: only DSH's own capabilities, and every action checks its own prerequisite — a missing
one simply removes that row.

| Surface | What | When missing |
| --- | --- | --- |
| Host services | `webServer` (**hard**, registers routes) + `sessionController` / `sessions` / `workingDirectory` (read softly) | no `webServer` → the host half does not mount; other misses return `host/unsupported` |
| Host built-ins | `node:fs` (file reads), `node:path` | — |
| Client seed modules | `react`, `react-dom/client`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-store` | provided by the DSH web frontend; `check.mjs` asserts official clients still use these module ids |
| Client services | `locale`, `sessions` (session-id probe slot), `sidebarRight` (**0.2.0 only**, for “Open in DSH”) | without `sidebarRight` that row disappears — the 0.2.1 case |

The menu itself is built on the **official `@deepseek-ai/dsh-client-ui-primitives` `Menu`** (`items` + `submenu`), occupies
no slot, and patches no other plugin's config row.

> It briefly depended on `dsh-better-sidebar`'s `openFile` (the “Open in sidebar” row), removed on request.

## How it works

0. **Two-half architecture (since 0.2.1)**: a plugin client half can no longer call `remote.session.*` (0.2.1's client
   Builtins are just `ctx / React / host / styles / console`), so this plugin's **host half registers its own routes**:
   `GET /ctx-menu/{capabilities,apps,cwd,read}` and `POST /ctx-menu/{open,reveal}`, each proxying a host service
   (`sessionController.workspacePathApplications` / `openWorkspacePath` / `canOpenWorkspacePath`, `sessions.get` +
   `workingDirectory.get`) or `node:fs` for file reads. The client side is a **platform bridge: own routes first, the 0.2.0
   remote services as fallback**, so one code base works on both versions. Routes are same-origin, gated by
   `connection.requestRejection`, and accept absolute paths only.

1. **The takeover rule complements the shell** (the single most important design decision): the DSH desktop shell
   only pops a native menu for editable fields or a non-empty text selection, and a renderer `preventDefault()`
   *suppresses* that menu. This plugin therefore does the opposite — it always lets those two cases through and only
   takes over when the shell would show nothing anyway and it actually has actions to add. The shell's
   “selection → Copy” can never be stolen.
2. **Act only on a matched anchor**: anchors are official `data-*` attributes (sidebar rows via `data-row-key`,
   `[data-changed-files]`, `[data-presented-file]`, `[data-review-file]`) plus the CSS-module local class name
   `fileMention` for in-body file-mention chips (**both variants carry it**: a markdown link is
   `fileMention+fileLink`, a path inside inline code is `fileMention` only). When the absolute path cannot be read,
   nothing is guessed: the native menu is left alone.
3. **Append only, never replace**: the menu occupies **no slot at all** — it mounts its own React root
   (platform seed module `react-dom/client`) on `document.body` behind an error boundary, and reuses the official
   `@deepseek-ai/dsh-client-ui-primitives` `Menu` / `MenuItemButton`. No other plugin's config row is patched and no
   occupied `single` / `keyed` slot is used.
   > **Why not the official `shell.overlay` slot**: when a slot registration *throws while rendering*, the slots layer
   > retires it (`entriesOfSlot` skips `abdicated`, set by `reportEntryError(..., { abdicate: true })`, see the
   > `dsh-client-ui-slots` source). A single render bug therefore makes the menu vanish **silently** — and while the
   > diagnostics panel shared that render path, it vanished with it. A self-managed root plus an error boundary
   > surfaces the crash (`__DSH_CTX_MENU__.errors`) and keeps everything else working.
4. **No `stopPropagation()`**: the terminal (xterm) and the document preview (pdf.js) handle right-click during
   bubbling; stopping propagation would break them. Those two, plus any open menu, are excluded zones.
5. **The fragile surface is pinned down**: all anchors live in `anchors.json` and are inlined in `client.js`;
   `node scripts/check.mjs` reads `app.asar` directly and asserts the anchor literals still exist (so a DSH upgrade
   fails loudly instead of silently), asserts the shell menu contract (`isEditable` / `selectionText.length > 0` /
   `items.length > 0`) is unchanged, and that no new official right-click takeover appeared.

## Development

```bash
node scripts/check.mjs          # static anchor / contract self-check (reads the local app.asar)
node --test "test/*.test.mjs"   # 26 unit tests: gate rules, anchor resolution, paged reads, contract parity
```

## Limitations

- **“Open in DSH” only works on 0.2.0**: it needs the client service `sidebarRight.openResource`, which 0.2.1 no longer
  exposes to plugin client halves (deliverables' `openResource` is its own tab action). The row hides when it is missing.
- **The file-mention chip anchor is a CSS-module class name (`fileMention`)** — no `data-*` exists there, making it the
  weakest anchor of the set; an upstream rename would fail silently, so `check.mjs` asserts the packaged frontend still
  contains `fileMention` / `MenuItemButton` / `MenuSurface`.
- **Relative paths need the session cwd**, resolved through the host route `/ctx-menu/cwd` (`sessions.get` +
  `workingDirectory.get`); without it the plugin reports “working directory unavailable” instead of guessing.
- **The open-with list needs a desktop host**: when `session.canOpenWorkspacePath()` is false (plain browser),
  open-with and reveal are hidden, leaving the client-only actions.
- **The session id comes from a session-scoped slot's standard prop** (the probe registers on
  `conversation.composer.dock`); if it is unavailable, the actions needing a session id hide, the rest still work.
- **Review rows require an absolute path** in `title`; otherwise the native menu is left untouched.
- **Not in M1**: an external terminal (`windowsterminal`) and fixed “open this file with editor X” rows
  (the official directory-only route cannot open a file; the open-with association list covers the same need here).

## Version compatibility

| Plugin | Works with | Notes |
| --- | --- | --- |
| 0.2.0 | **0.2.1-rc.3** (new contract) and 0.2.0-rc.2 (fallback path) | host half registers `/ctx-menu/*`; the client “platform bridge” prefers routes and falls back to the old remote services |
| 0.1.x | 0.2.0-rc.2 | client-only implementation calling `remote.session` / `remote.workspaceFiles` directly |

## License

MIT