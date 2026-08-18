# dsh-workspace-auto-approval

DSH plugin: **Workspace Auto Approval**.

It adds an automatic answerer on top of DSH's default `Workspace Write + ask` policy.
Operations contained in the workspace, read-only access outside it, and network reads can
be approved automatically. Commands that cannot be classified reliably by simple rules
are sent to the current session model for one minimal, tool-free review.

## Install

```powershell
dsh plugin --profile web add ./dsh-workspace-auto-approval
```

Restart DSH Web to activate it.

> If **dsh-yzlin499-plugins-manager** is installed, you can also enable this plugin from
> Settings → Plugins → Plugin Manager.

## Usage

No configuration is required. The plugin handles only escalation requests already raised
by DSH and applies these decisions in order:

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

- The Host plugin prepends an `approval/request` waterfall listener before the Web answerer.
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
