# dsh-mcp-compat

DSH 插件：**标准 MCP 配置兼容**。自动读取各主流 Agent 的 MCP 配置文件，把每个
MCP 服务器挂载为一个 `@deepseek-ai/dsh-mcp-client` 实例，工具以 `mcp__<名>__*` 出现。

## 安装

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-mcp-compat"
```

重启 DSH Web 后生效。

## 支持的配置来源（按优先级，先出现者胜；项目级 + 用户级）

- `.mcp.json` —— Claude Code / Codex / Cursor 约定（`mcpServers`；支持 stdio / Streamable HTTP）
- `opencode.json` / `opencode.jsonc` —— opencode 约定（`mcp` 键，command 数组 / url / enabled）
- `.cursor/mcp.json` —— Cursor 约定（同 `mcpServers`）
- `.codex/config.toml` —— Codex 约定（`[mcp_servers.<name>]`）
- 用户主目录：`~/.mcp.json`、`~/.codex/config.toml`、`~/.config/opencode/opencode.json`

## 使用

任何 workspace 根目录（或用户主目录）放入上述任一配置文件即自动生效，无需配置 DSH。
项目级 MCP 工具只对 `cwd` 属于该 workspace 的 Agent 可见，用户级 MCP 工具全局共享，
不会在不同项目会话之间串用。项目级 stdio 服务器以 workspace 根目录作为工作目录启动。
配置文件变更（fs.watch）或新会话（`session/created`）自动重扫。stdio 服务器若配置了不存在的
绝对命令路径，插件只输出一次明确诊断并跳过，不会交给 MCP client 持续重连。

> 官方 `@deepseek-ai/dsh-mcp-client` 目前支持 stdio 和 Streamable HTTP，不支持旧版 SSE。
> 显式声明 `type: "sse"` 的条目会被跳过，以便后续配置文件中的同名 Streamable HTTP 条目接管。

## License

MIT
