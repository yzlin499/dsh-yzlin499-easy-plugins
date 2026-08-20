# dsh-mcp-compat

DSH plugin: **standard MCP config compatibility**. Automatically reads the MCP
config files of mainstream agents and mounts every MCP server as an
`@deepseek-ai/dsh-mcp-client` instance; tools appear as `mcp__<name>__*`.

## Install

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-mcp-compat"
```

Restart DSH Web to activate.

## Supported config sources (priority order, first match wins; project + user level)

- `.mcp.json` — Claude Code / Codex / Cursor convention (`mcpServers`; stdio / Streamable HTTP)
- `opencode.json` / `opencode.jsonc` — opencode convention (`mcp` key, command array / url / enabled)
- `.cursor/mcp.json` — Cursor convention (same `mcpServers`)
- `.codex/config.toml` — Codex convention (`[mcp_servers.<name>]`)
- User home: `~/.mcp.json`, `~/.codex/config.toml`, `~/.config/opencode/opencode.json`

## Usage

Drop any of the config files above into a workspace root (or the user home) and
it takes effect automatically — no DSH configuration needed. Project-level MCP
tools are visible only to agents whose `cwd` belongs to that workspace, while
user-level MCP tools remain shared globally. Project stdio servers start with the
workspace root as their working directory. Config file changes (`fs.watch`) or
new sessions (`session/created`) trigger a rescan. If a stdio server declares an
absolute command path that does not exist, the plugin logs one clear diagnostic
and skips it instead of handing it to the MCP client's reconnect loop.

> The official `@deepseek-ai/dsh-mcp-client` currently supports stdio and
> Streamable HTTP, not legacy SSE. Explicit `type: "sse"` entries are skipped so
> a later supported configuration with the same name can take over.

## Reconnection

The official client ships its own auto-reconnect (starts at 0.5s, exponential
backoff capped at 30s, max 10 attempts), but **after too many consecutive
failures it gives up**: it unregisters that server's tools and stops, logging
`giving up after N consecutive failed reconnect attempts …`. After that the only
recovery was reloading the plugin or restarting the Host. `dsh-mcp-compat` adds
two layers on top:

1. **Auto-reconnect watchdog**: every 15s it checks the mounted servers; if a
   server's tools vanish from the registry (meaning the official reconnect gave
   up), it **reconnects only that down server** (leaving healthy mounts alone),
   retrying with exponential backoff (15s → 30s → 60s → … → capped at 10 min).
   Great for repeatedly toggling UE or any slow-starting server — as long as the
   server eventually comes back, it reconnects on its own, without spamming logs
   while it is offline.
2. **Manual reconnect**, either way:
   - **Slash command `/mcp-reconnect`** in the chat input box: executes directly
     without going through the model, with the result shown inline.
     `/mcp-reconnect` reconnects all (re-reads config); `/mcp-reconnect <name>`
     (e.g. `/mcp-reconnect unreal`) reconnects only that one server.
   - **Model tool `mcp_reconnect`**: ask the model in any session to force a
     reconnect — it re-reads the config and rebuilds (all or a named) server
     connections immediately. Also clears the "gave up" terminal state.

For example, say "reconnect the UE MCP" to make the model call `mcp_reconnect`,
or type `/mcp-reconnect unreal` directly in the input box.

## License

MIT
