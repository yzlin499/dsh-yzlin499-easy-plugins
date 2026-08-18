# dsh-win-notify

DSH plugin: **native Windows toast notifications**.

DSH lives in the browser, so when you are not looking at the page you miss everything.
This plugin pops native Windows toasts (bottom-right notifications) at three moments:
**approval requested**, **question asked**, and **run finished/stopped** — so you know
"your turn" or "it's done" even while the page sits in the background.

## Install

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-win-notify"
```

Restart DSH Web to activate.

> Or enable it from the **dsh-yzlin499-plugins-manager** "Plugin Manager" card (Settings → Plugins).

## Usage

Out of the box it notifies **always** on the three moments:

| Moment | Example toast |
|---|---|
| Approval requested | "DSH · Needs your approval: pwsh — requesting: …" |
| Question asked | "DSH · Needs your answer — <question text>" |
| Run finished/stopped | "DSH · Run finished — <workspace> session ended"; distinct text for error / aborted / blocked / max-tokens |

- "Run finished" fires on `agent/status` becoming `idle` (driver fully exited), so
  multi-turn goal loops toast only once at the very end — no per-turn spam. Errors,
  aborts, blocks and max-tokens have their own wording.
- Subagent sessions are filtered out to avoid child-task noise.
- On first toast the plugin auto-registers a `DSH.Notify` Start Menu shortcut
  (Windows only shows toasts for registered apps); afterwards toasts appear instantly.

## Settings (Settings → Plugins → Windows Notify)

| Item | Description |
|---|---|
| Enable notifications | Master switch (default on) |
| Approval / Question / Run done | Per-moment toggles (all on by default) |
| When to notify | **Always** (default) / **Background only** |

In "Background only" mode toasts appear only while the page is in the background
(tab hidden / window minimized / covered). Background state comes from the browser's
`document.visibilityState` automatically — **no mouse or focus detection needed**.
The card shows the live page state (foreground/background).

## How it works

- **Host** (`index.js`): listens to host events and fires toasts:
  - `session/event` — `approval/asked` (approval, with tool name/reason),
    `tool/call` named `ask_user_question` (question text parsed from args),
    `turn/end` (records the turn-end reason)
  - `agent/status` → `idle` (run stopped; wording from the recorded reason)
  - Toast execution: `ctx.subprocess.spawn` runs `powershell.exe -File toast.ps1`
    with Base64 title/message (no escaping issues), fire-and-forget; 800 ms debounce
    per toast kind
- **toast.ps1**: Windows PowerShell 5.1 + WinRT (`ToastNotificationManager`,
  ToastText02 template) shows the native toast; on first run it creates
  `%APPDATA%\Microsoft\Windows\Start Menu\Programs\DSH.Notify.lnk` (AUMID
  registration) — the prerequisite for Windows to accept toasts.
  **Must run under powershell.exe (5.1)** — pwsh (PowerShell 7) cannot load WinRT.
- **Client** (`client.js`): `settings.plugin.item` settings card + page-visibility
  reporting (`visibilitychange` → POST `/win-notify/visibility`).
- Config persists through the official `ctx.settings` service into
  `~/.dsh/settings.yaml` (namespace `dsh-win-notify`); the card reads/writes via the
  plugin's own `/win-notify/config` route.

## License

MIT
