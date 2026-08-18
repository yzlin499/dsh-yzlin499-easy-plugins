# dsh-workspace-auto-approval

DSH plugin: **Workspace Auto Approval**.

It adds a fourth **Workspace Auto Approval** entry to DSH's permission selector. The mode
runs under `danger-full-access + ask`: commands execute in a full, unconfined environment, so
credential-, named-pipe- and subprocess-helper-dependent commands (`git push`, ssh, package
managers) keep working. In exchange the plugin audits **every tool call before it executes**
(`tools/pre-execute`): workspace-contained operations, allowlisted commands, and clearly
read-only access run automatically; inconclusive commands and MCP calls are reviewed by the
current session model with the matching tool definition supplied for context but no callable
tools; mass-destructive, host-level, and network-upload operations always go to interactive
approval. Ordinary `Workspace Write` is unchanged.

## Screenshot

![Screenshot](screenshot.png)

## Install

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-workspace-auto-approval"
```

Restart DSH Web to activate it.

## Usage

After installation and restart, select **Workspace Auto Approval** in the session permission
selector. The plugin intervenes only while that mode is selected; switching back to
`Workspace Write` restores DSH's ordinary sandbox and approval behavior. Every tool call is
audited before it runs, in this order:

| Case | Result |
|---|---|
| A `write` / `edit` target is inside the current workspace | Auto-allow |
| A `pwsh` / `bash` command is clearly read-only | Auto-allow, including reads outside the workspace |
| `curl` uses the small positive option allowlist for a clear network GET/HEAD | Auto-allow |
| A command matches any regex in the custom allowlist (git push is included by default) | Auto-allow; mass-destructive operations are unaffected and still go to a human |
| Any other command or MCP call not proven by the read-only rules | Ask the current session model; only exact `ALLOW` is accepted |
| Recursive/wildcard bulk deletion, `git clean -fd`, database/table destruction, or destructive MCP calls | Skip AI and go straight to interactive approval |
| A host service, registry, user-management, shutdown, or network-upload rule matches | Interactive approval |
| AI fails, times out, is unavailable, or does not clearly allow | Interactive approval |
| The auto-grant switch is off | Every call goes to interactive approval (including read-only and allowlisted ones) |

Auto-allowed calls run immediately; anything else is blocked **before execution** and routed
to interactive approval. The plugin never changes the session's persistent permission mode.

## Settings

Open Settings → Plugins → Workspace Auto Approval to edit three things:

1. **Review system prompt**: the System Prompt used by the AI reviewer, with Save and
   Restore Default and an 8,000-character limit. Official `ctx.settings` persists it as
   `dsh-workspace-auto-approval.prompt` in `~/.dsh/settings.yaml`.
2. **Auto-grant switch (`grantFullAccess`)**: on by default. When on, read-only,
   in-workspace, allowlisted, and AI-allowed calls run automatically after the audit. When
   off, **every** tool call goes to interactive approval (AI review is not invoked either).
   Persisted as `dsh-workspace-auto-approval.grantFullAccess`.
3. **Allowlist rules (`allowPatterns`)**: one regular expression per line (case-insensitive);
   a command whose text matches any rule is auto-allowed. **`\bgit(?:\.exe)?\s+push\b`
   is included by default**, so `git push` skips AI review and runs immediately; add or
   remove any command here (e.g. `npm publish`). Persisted as
   `dsh-workspace-auto-approval.allowPatterns`; the route validates each regex on save
   (invalid expressions are rejected).

Prompt, switch, and rule changes apply to the next call without a restart. Deterministic
mass-destruction rules run before both the prompt and the custom rules and cannot be bypassed
by customizing either.

## How It Works

- The bundle patch restates the three built-in presets and appends `workspace-auto-approval`.
  It shares `sandbox: danger-full-access` and `approval: ask` with `danger-full-access`;
  DSH's durable `permission/preset` event preserves which mode the user selected. **This
  mode has no OS-level file sandbox**: executables run unconfined, so the restricted
  sandbox's named-pipe/credential limitations no longer break git and friends.
- The Host plugin prepends a **`tools/pre-execute`** listener — the decision point the DSH
  tool registry runs before every dispatch (see `dsh-tools`) — and intervenes only while
  `workspace-auto-approval` is current. Every other mode immediately calls `next()`.
- **Pre-execute audit**: the plugin classifies the call from its parsed arguments
  (`exec.arguments`) directly — no event replay needed:
  - read-only commands / in-workspace file targets / allowlist hits (including `git push`)
    → returns `allow`; the call runs in the full environment;
  - mass-destructive, host-level, or network-upload calls → returns `ask` (reason stamped
    with `[workspace-auto-approval]`), routed through DSH's approval service to the user;
  - everything else → one no-tool AI review with the tool definition; only an exact
    `ALLOW` returns `allow`, anything else returns `ask`.
- **Fail closed**: if the pre-execute audit throws, the plugin returns `deny` and the call
  is blocked — it never silently allows.
- An `ask` raises `approval/request` via the approval service; the Host's older listener
  passes any reason carrying the `[workspace-auto-approval]` marker straight to `next()`
  (the user), so a pre-execute verdict is never re-decided or auto-granted in a second pass.
  The older listener still handles the sandbox-escalation requests that (in this mode) can
  no longer occur, keeping compatibility.
- The Client half adds a 16×16 shield-and-A SVG glyph matching the official icon style. Since
  `PresetOption` exposes no icon field, the decorator matches only the complete Workspace Auto
  Approval label and applies a CSS SVG mask to its current-mode button and menu row. It does not
  modify the official package and cleans up on unload. The standalone source is `icon.svg`.
- The workspace root comes from `session.header.cwd`. Existing symlinks/junctions are
  canonicalized before containment checks, rather than relying on string prefixes.
- The Host registers the `dsh-workspace-auto-approval` namespace through official `ctx.settings`.
  The settings card reads/writes the prompt through `/workspace-auto-approval/config`, and every AI
  review reads the latest value.
- Local rules classify structured file targets, command working directories, absolute paths,
  traversal, dynamic paths, read-only commands, network reads/writes, and common host effects.
  Shell writes are not locally allowed from textual paths alone because variables, globs, and
  mutable symlinks cannot be constrained reliably by string inspection.
- The custom allowlist runs right after the mass-destruction check and before every other local
  rule: a hit allows the call (including network writes or host-level changes that would
  otherwise go to a human), but mass-destructive operations always win and can never be
  overridden. Patterns match the **whole command text** (including compound commands — write
  them carefully); non-shell tools match against "tool name + arguments JSON", and `write`/`edit`
  targets outside the workspace are never allowed by patterns.
- The AI fallback reuses the latest session provider/model and sends the workspace, audit
  reason, matching tool definition (name, description, parameter schema), and actual arguments,
  capped at 32 KiB of JSON. This lets opaque MCP tools be judged from their contracts. The request
  still uses `tools: []`: the reviewer can read schemas but cannot call tools, and receives no
  conversation history.
- Review calls enable reasoning when supported. An already-enabled session `reasoningEffort` wins;
  otherwise the plugin resolves model capabilities and selects the first non-off effort (normally
  `low` for DeepSeek). Unsupported models omit the field. `maxTokens: 256` leaves room for hidden
  reasoning, with the same 15-second timeout.
- Only an exact `ALLOW` grants access. Every other output or exception goes to interactive
  approval. Under an approval policy of `never`, DSH rejects that fallback according to its
  normal policy (this mode's preset uses `ask`, so that is not expected).

## Security Boundary

This mode's preset is `danger-full-access` — **there is no OS-level file sandbox**; the
plugin's rules and AI are the only gate. They can judge intent, but cannot prove every
runtime effect of arbitrary shell code as an operating-system sandbox can. Consequently:

- mass-destruction, host-level, and network-upload rules run before both AI and the custom
  allowlist: bulk file deletion, recursive forced deletion, and database/table destruction
  cannot be auto-authorized by a custom prompt, allowlist pattern, or model output;
- the default allowlist ships `git push`, so pushes to **any** remote run automatically —
  assess the risk yourself; patterns match the whole command text (compound commands are
  allowed whole);
- the auto-grant switch only decides whether an audited call runs automatically: on =
  auto-allow, off = interactive approval for everything. It never affects mass-destructive
  operations (always human);
- this mode trades the OS sandbox for command usability: credential/subprocess-helper
  commands (git, ssh, package managers) work, but the audit carries the entire interception
  duty. When in doubt, switch back to the official `Workspace Write` or `read-only` presets
  to keep system-level isolation;
- MCP schemas, approval reasons, and actual arguments are sent to the current session's model
  provider; sensitive arguments should be treated as disclosure to that provider;
- AI is not a security boundary. Keep DSH's official sandbox presets and evaluate this
  plugin's risk before using it in production or unattended environments.

## Test

```powershell
cd dsh-workspace-auto-approval
npm test
```

## License

MIT