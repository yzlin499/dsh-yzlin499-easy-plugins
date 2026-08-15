# dsh-mcp-compat

DSH plugin: **standard MCP config compatibility**. Automatically reads the MCP
config files of mainstream agents and mounts every MCP server as an
`@deepseek-ai/dsh-mcp-client` instance; tools appear as `mcp__<name>__*`.

## Install

```powershell
dsh plugin --profile web add ./dsh-mcp-compat
```

Restart DSH Web to activate.

> Or enable it quickly from the **dsh-yzlin499-plugins-manager** settings panel (Settings → Plugin Manager).

## Supported config sources (priority order, first match wins; project + user level)

- `.mcp.json` — Claude Code / Codex / Cursor convention (`mcpServers`)
- `opencode.json` / `opencode.jsonc` — opencode convention (`mcp` key, command array / url / enabled)
- `.cursor/mcp.json` — Cursor convention (same `mcpServers`)
- `.codex/config.toml` — Codex convention (`[mcp_servers.<name>]`)
- User home: `~/.mcp.json`, `~/.codex/config.toml`, `~/.config/opencode/opencode.json`

## Usage

Drop any of the config files above into a workspace root (or the user home) and
it takes effect automatically — no DSH configuration needed. Config file changes
(`fs.watch`) or new sessions (`session/created`) trigger a rescan.

## License

MIT
