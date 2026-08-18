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

## License

MIT
