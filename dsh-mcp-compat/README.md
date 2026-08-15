# dsh-mcp-compat

DSH 插件：**标准 MCP 配置兼容**。自动读取各主流 Agent 的 MCP 配置文件，把每个
MCP 服务器挂载为一个 `@deepseek-ai/dsh-mcp-client` 实例，工具以 `mcp__<名>__*` 出现。

## 安装

```powershell
dsh plugin --profile web add ./dsh-mcp-compat
```

重启 DSH Web 后生效。

## 支持的配置来源（按优先级，先出现者胜；项目级 + 用户级）

- `.mcp.json` —— Claude Code / Codex / Cursor 约定（`mcpServers`）
- `opencode.json` / `opencode.jsonc` —— opencode 约定（`mcp` 键，command 数组 / url / enabled）
- `.cursor/mcp.json` —— Cursor 约定（同 `mcpServers`）
- `.codex/config.toml` —— Codex 约定（`[mcp_servers.<name>]`）
- 用户主目录：`~/.mcp.json`、`~/.codex/config.toml`、`~/.config/opencode/opencode.json`

## 使用

任何 workspace 根目录（或用户主目录）放入上述任一配置文件即自动生效，无需配置 DSH。
配置文件变更（fs.watch）或新会话（`session/created`）自动重扫。

## License

MIT
