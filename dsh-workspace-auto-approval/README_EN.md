# dsh-workspace-auto-approval

DSH plugin: **Workspace Auto Approval**.

It adds a fourth **Workspace Auto Approval** entry to DSH's permission selector. The new
mode uses the same `Workspace Write + ask` knobs, with an automatic answerer in front of
the normal approval chain. Workspace-contained operations, read-only external access, and
network reads can be approved automatically; inconclusive commands receive one minimal,
tool-free review from the current session model. Ordinary `Workspace Write` is unchanged.

## Install

```powershell
dsh plugin --profile web add ./dsh-workspace-auto-approval
```

Restart DSH Web to activate it.

> If **dsh-yzlin499-plugins-manager** is installed, you can also enable this plugin from
> Settings → Plugins → Plugin Manager.

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
| A host service, registry, user-management, shutdown, or network-upload rule matches | Continue to DSH's downstream approval chain |
| Local rules are inconclusive | Ask the current session model; only exact `ALLOW` is accepted |
| AI fails, times out, is unavailable, or does not clearly allow | Continue to DSH's downstream approval chain |

Every automatic grant is `allowed-once`; the plugin never changes the session's persistent
permission mode.

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
- Local rules classify structured file targets, command working directories, absolute paths,
  traversal, dynamic paths, read-only commands, network reads/writes, and common host effects.
  Shell writes are not locally allowed from textual paths alone because variables, globs, and
  mutable symlinks cannot be constrained reliably by string inspection.
- The AI fallback reuses the provider/model from the latest session request. It sends only the
  workspace, tool name, command, and working directory in one JSON user message capped at 16 KiB.
  The short system prompt uses `tools: []`, `maxTokens: 8`, and a 15-second timeout, with no
  conversation history, tool definitions, approval reason, or other tool arguments.
- Only an exact `ALLOW` grants access. Every other output or exception calls `next()` and falls
  back to DSH's existing approval chain. Under an approval policy of `never`, DSH rejects that
  fallback according to its normal policy.

## Security Boundary

After a `danger-full-access` command is approved, the executor no longer enforces a file-effect
sandbox. Rules and AI can judge intent, but cannot prove every runtime effect of arbitrary shell
code as an operating-system sandbox can. Consequently:

- explicit host-configuration changes and network uploads are never auto-approved;
- dynamic paths, external writes, and complex unresolved commands require AI or human review;
- AI is not a security boundary. Keep DSH's sandbox enabled and evaluate this plugin's risk
  before using it in production or unattended environments.

## Test

```powershell
cd dsh-workspace-auto-approval
npm test
```

## License

MIT
