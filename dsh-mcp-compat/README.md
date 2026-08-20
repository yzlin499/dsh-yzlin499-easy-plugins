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

### 设置：选择要扫描的配置源

设置页（「插件」→「MCP 兼容」卡片）可按需勾选要扫描的配置源体系（默认全开）：
Claude（`.mcp.json`）、Cursor（`.cursor/mcp.json`）、opencode、Codex（`.codex/config.toml`）。
只勾选你常用的（例如只开 Claude），就不会再“全部扫一遍”。保存后立即按新配置重建挂载。

> 官方 `@deepseek-ai/dsh-mcp-client` 目前支持 stdio 和 Streamable HTTP，不支持旧版 SSE。
> 显式声明 `type: "sse"` 的条目会被跳过，以便后续配置文件中的同名 Streamable HTTP 条目接管。

## 重连

官方客户端自带自动重连（0.5s 起、指数退避、封顶 30s、最多 10 次），但**连续失败超过上限会
「放弃」**：注销该服务器的工具并停止，日志输出
`giving up after N consecutive failed reconnect attempts …`。这之后只能重载插件或重启 Host。
`dsh-mcp-compat` 在此基础上补了两层：

1. **自动重连看门狗**：每 15s 检查一次已挂载服务器，若检测到某服务器的工具已从注册表消失
   （说明官方重连已放弃），会自动**只重连 down 的那一个**（不惊动其它健康挂载），并按
   指数退避（15s → 30s → 60s → … → 封顶 10 分钟）低频重试，UE 只要最终能起来就能自动接上，
   且不会在离线期间无限刷日志。
2. **手动重连**，两种方式任选：
   - **对话框 slash 命令 `/mcp-reconnect`**：直接在输入框输入即可，不经模型、立即执行、结果直显。
     `/mcp-reconnect` 重连全部（重读配置）；`/mcp-reconnect <服务器名>`（如 `/mcp-reconnect unreal`）
     只精准重连那一个。
   - **模型工具 `mcp_reconnect`**：在会话里对模型说「重连一下 UE 的 MCP」，模型即可调用
     `mcp_reconnect`（传 `serverName` 只重连指定服务器，省略则重连全部）。

例如会话里说「重连一下 UE 的 MCP」，模型会调用 `mcp_reconnect`；或直接在对话框输入
`/mcp-reconnect unreal`。

## License

MIT
