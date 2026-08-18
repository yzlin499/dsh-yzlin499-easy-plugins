# dsh-workspace-auto-approval

DSH plugin: **Workspace Auto Approval**.

It adds a fourth **Workspace Auto Approval** entry to DSH's permission selector. The new
mode uses the same `Workspace Write + ask` knobs, with an automatic answerer in front of
the normal approval chain. Workspace-contained operations, read-only external access, and
network reads can be approved automatically. Inconclusive commands and MCP calls are reviewed
by the current session model with the matching tool definition supplied for context, but with no
callable tools. Ordinary `Workspace Write` is unchanged.

## Screenshot

![Screenshot](screenshot.png)

## Install

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-workspace-auto-approval"
```

Restart DSH Web to activate it.

## Usage

After installation and restart, select **Workspace Auto Approval** in the session permission
selector. The plugin handles escalations only while that mode is selected; switching back to
`Workspace Write` restores DSH's ordinary approval behavior. The automatic mode applies these
decisions in order:

| Case | Result |
|---|---|
| A `write` / `edit` target is inside the current workspace | Allow once automatically |
| A `pwsh` / `bash` command is clearly read-only | Allow once, including reads outside the workspace |
| `curl` uses the small positive option allowlist for a clear network GET/HEAD | Allow once automatically |
| A workspace shell write or any command not proven by the read-only rules | Ask the current session model; only exact `ALLOW` is accepted |
| A command matches any regex in the custom allowlist (git push is included by default) | Allow once automatically; mass-destructive operations are unaffected and still go to a human |
| Recursive/wildcard bulk deletion, `git clean -fd`, database/table destruction, or destructive MCP calls | Skip AI and continue downstream; the user must decide |
| A host service, registry, user-management, shutdown, or network-upload rule matches | Continue to DSH's downstream approval chain |
| Local rules are inconclusive | Ask the current session model; only exact `ALLOW` is accepted |
| AI fails, times out, is unavailable, or does not clearly allow | Continue to DSH's downstream approval chain |

Every automatic grant is `allowed-once`; the plugin never changes the session's persistent
permission mode.

## Settings

Open Settings → Plugins → Workspace Auto Approval to edit two things:

1. **Review system prompt**: the System Prompt used by the AI reviewer, with Save and
   Restore Default and an 8,000-character limit. Official `ctx.settings` persists it as
   `dsh-workspace-auto-approval.prompt` in `~/.dsh/settings.yaml`.
2. **Allowlist rules (`allowPatterns`)**: one regular expression per line (case-insensitive);
   a command whose text matches any rule is auto-approved. **`\bgit(?:\.exe)?\s+push\b`
   is included by default**, so `git push` no longer goes through AI review and is allowed
   immediately; add or remove any command here (e.g. `npm publish`). Persisted as
   `dsh-workspace-auto-approval.allowPatterns`; the route validates each regex on save
   (invalid expressions are rejected).

Prompt and rule changes apply to the next request without a restart. Deterministic
mass-destruction rules run before both the prompt and the custom rules and cannot be bypassed
by customizing either.

## How It Works

- The bundle patch restates the three built-in presets and appends `workspace-auto-approval`.
  It shares `sandbox: workspace-write` and `approval: ask` with `workspace-write`; DSH's durable
  `permission/preset` event preserves which shared-knob mode the user selected.
- The Host plugin prepends an `approval/request` waterfall listener, but intervenes only while
  `workspace-auto-approval` is current. Every other mode immediately calls `next()`.
- The Client half adds a 16×16 shield-and-A SVG glyph matching the official icon style. Since
  `PresetOption` exposes no icon field, the decorator matches only the complete Workspace Auto
  Approval label and applies a CSS SVG mask to its current-mode button and menu row. It does not
  modify the official package and cleans up on unload. The standalone source is `icon.svg`.
- Approval requests carry a `callId`; the plugin finds the matching `tool/call` event in the
  current Session to recover the original arguments.
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
  rule: a hit allows the request (including network writes or host-level changes that would
  otherwise go to a human), but mass-destructive operations always win and can never be
  overridden. Patterns match the **whole command text** (including compound commands — write
  them carefully); non-shell tools match against "tool name + arguments JSON", and `write`/`edit`
  targets outside the workspace are never allowed by patterns.
- The AI fallback reuses the latest session provider/model and sends the workspace, approval
  reason, matching tool definition (name, description, parameter schema), and actual arguments,
  capped at 32 KiB of JSON. This lets opaque MCP tools be judged from their contracts. The request
  still uses `tools: []`: the reviewer can read schemas but cannot call tools, and receives no
  conversation history.
- Review calls enable reasoning when supported. An already-enabled session `reasoningEffort` wins;
  otherwise the plugin resolves model capabilities and selects the first non-off effort (normally
  `low` for DeepSeek). Unsupported models omit the field. `maxTokens: 256` leaves room for hidden
  reasoning, with the same 15-second timeout.
- Only an exact `ALLOW` grants access. Every other output or exception calls `next()` and falls
  back to DSH's existing approval chain. Under an approval policy of `never`, DSH rejects that
  fallback according to its normal policy.

## Security Boundary

After a `danger-full-access` command is approved, the executor no longer enforces a file-effect
sandbox. Rules and AI can judge intent, but cannot prove every runtime effect of arbitrary shell
code as an operating-system sandbox can. Consequently:

- Mass-destruction rules run before both AI and the custom allowlist: bulk file deletion,
  recursive forced deletion, and database/table destruction cannot be auto-authorized by a
  custom prompt, allowlist pattern, or model output;
- host-configuration changes and network uploads are by default never auto-approved; only an
  explicit entry in the custom allowlist (git push ships as the default entry, so pushes to
  **any** remote are auto-approved) can let them through — the whole command is then allowed,
  so assess the risk yourself and mind compound commands;
- MCP schemas, approval reasons, and actual arguments are sent to the current session's model
  provider; sensitive arguments should be treated as disclosure to that provider;
- AI is not a security boundary. Keep DSH's sandbox enabled and evaluate this plugin's risk
  before using it in production or unattended environments.

## Test

```powershell
cd dsh-workspace-auto-approval
npm test
```

## License

MIT
