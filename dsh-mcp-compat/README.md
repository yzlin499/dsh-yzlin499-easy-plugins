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

检测到 WSL 时，卡片还会出现两项 WSL 开关（均默认开启）：

- **启用 WSL 兼容**：关闭后不再使用同端口隧道 / 地址改写，MCP 服务器全部按原样连接。
- **自动配置宿主机转发**：宿主机的 loopback 端口不可达时（如 JetBrains 只监
  `127.0.0.1`），自动以管理员运行
  `netsh interface portproxy`（端口转发，**只绑宿主机网卡 IP，不占 `0.0.0.0` /
  `127.0.0.1`**）+ 防火墙放行（源限 WSL 网段）——首次会弹出一次 Windows UAC 授权框，
  点“是”即可；同端口只尝试一次，避免反复弹窗。
  卡片上的「立即配置宿主机转发」按钮可随时手动对所有已启用兼容的端口执行一遍；
  「释放并清除转发」按钮（以及 **DSH 正常退出时自动执行**）用于删除插件自建的
  转发规则，把端口完整还给宿主服务（如 UE）。

> 插件只跟踪、释放「自己创建」的转发规则；手动用 `netsh` 添加的规则不会被删除。
> 若检测到早期 `listenaddress=0.0.0.0` 的旧转发（会堵塞宿主服务重启时绑定端口，
> 正是 UE 抢不到 8000 的元凶），日志会给出一次性提示，按提示删掉后插件会重建为
> 只绑网卡 IP 的规则并纳入自动释放。

> 官方 `@deepseek-ai/dsh-mcp-client` 目前支持 stdio 和 Streamable HTTP，不支持旧版 SSE。
> 显式声明 `type: "sse"` 的条目会被跳过，以便后续配置文件中的同名 Streamable HTTP 条目接管。

## WSL 宿主兼容

在 **WSL2**（默认 NAT 网络）里，`localhost` / `127.0.0.1` 指向 WSL 自身，连不到
Windows 宿主机上跑的 MCP 服务（例如 UE 的 MCP、JetBrains IDE 的 MCP）。插件自动
检测 WSL，当某个 Streamable HTTP 服务器的 loopback 地址**连接失败**（看门狗发现
工具消失、或手动重连）时，按以下方式兼容：

1. **URL 改写（首选，冲突最小）**：把 loopback host 改写为**宿主机 IP** 直连。
   不占 WSL 端口、不引 wslrelay 回环转发，宿主机服务重启仍能拿到自己的端口。
   日志：`WSL 兼容：连接 localhost 失败，启用宿主机 IP 改写: …`。
2. **同端口透明 TCP 隧道（仅当服务只认本机 Host 时才启用）**：探测到手写 MCP
   握手返回 **HTTP 403**（如 JetBrains IDE 的 MCP 只认 `127.0.0.1` Host）时，自动
   升级为隧道：在 WSL 里监听与原始 URL 相同的 loopback 端口，字节原样转发到
   宿主机 IP 的同端口，`Host` 头保持 `127.0.0.1`。日志：

   ```
   WSL 兼容：宿主机服务只认本机 Host（HTTP 403），升级为同端口透明隧道
   WSL 兼容：启动同端口透明隧道 127.0.0.1 64342 -> 192.168.160.1:64342（保持原始 Host 头）
   ```

只在失败后才兜底：WSL1 / 镜像网络下 localhost 本来就能用的连接完全不受影响；
一旦启用，后续自动重连与全量重建都会持续沿用，不会来回跳。

宿主机 IP 的解析优先级：`WSL_HOST_IP` 环境变量（最可靠，可手动指定）
→ `/etc/resolv.conf` 的 nameserver → `/proc/net/route` 默认网关。
设置页「MCP 兼容」卡片会显示当前 WSL 状态（是否检测到、宿主机 IP、
已启用兼容连接的服务器及其方式）。

### 仍连不上？

日志会给出一次带 **TCP 探测 + MCP 握手 HTTP 状态**的诊断
（如 `TCP 可达` / `TCP 超时`、`握手: HTTP 403`）。常见原因与解决：

> 若开启「自动配置宿主机转发」，插件会先自动检测宿主机监听并尝试建立转发（首次
> 弹 UAC，批准后自动完成）；仍失败时日志会给出 `转发: failed`，此时按下面手动执行。

1. **服务只监听 Windows 本机回环（127.0.0.1）**：例如 JetBrains IDE 官方 MCP
   Server、不少 UE MCP 插件默认只绑 127.0.0.1。需要让宿主机端口从 WSL 可达。
   **重要：转发规则的监听地址一定要用宿主机网卡 IP（如 192.168.160.1），不要用
   `0.0.0.0`** —— 否则宿主机上同端口的服务（如 UE 的 MCP）重启时会因端口被转发
   规则占用而绑定失败，永远连不上。手动执行（管理员 PowerShell，`<宿主IP>` 即
   `192.168.160.1` 这类 vEthernet 地址）：
   - 端口转发（只绑宿主网卡 IP）：
     `netsh interface portproxy add v4tov4 listenaddress=<宿主IP> listenport=<端口> connectaddress=127.0.0.1 connectport=<端口>`
   - 防火墙放行（源限 WSL 网段）：
     `netsh advfirewall firewall add rule name="wsl-mcp-<端口>" dir=in action=allow protocol=TCP localport=<端口> remoteip=192.168.160.0/20`
   - 用 `netsh interface portproxy show all` 确认规则；服务重启换端口后按新端口更新。
     若之前误加了 `listenaddress=0.0.0.0` 的规则并导致宿主服务抢不到端口，删除之：
     `netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=<端口>`
   - 或 WSL 镜像网络：`%UserProfile%\.wslconfig` 加 `[wsl2]` + `networkingMode=mirrored`，
     `wsl --shutdown` 重启（localhost 直通 Windows 回环服务；个别环境镜像网络有已知兼容问题）。
   - 或服务端绑定所有网卡 / `0.0.0.0`（服务配置里若有绑定地址选项）。
2. **端口过期**：部分服务（如 JetBrains MCP）每次启动可能换端口，确认服务当前
   端口与配置文件一致；不一致时重启服务 / 手动重连（`/mcp-reconnect`）重读配置。
3. **握手 HTTP 403**：服务只认本机 Host（典型 JetBrains）——插件会自动升级为
   `同端口透明隧道`；隧道已启用仍 403，多半是转发规则缺失或服务未运行。

## 重连

官方客户端自带自动重连（0.5s 起、指数退避、封顶 30s、最多 10 次），但**连续失败超过上限会
「放弃」**：注销该服务器的工具并停止，日志输出
`giving up after N consecutive failed reconnect attempts …`。这之后只能重载插件或重启 Host。
`dsh-mcp-compat` 在此基础上补了两层：

1. **自动重连看门狗**：每 15s 检查一次已挂载服务器，若检测到某服务器的工具已从注册表消失
   （说明官方重连已放弃），会自动**只重连 down 的那一个**（不惊动其它健康挂载），并按
   指数退避（15s → 30s → 60s → … → 封顶 10 分钟）低频重试。**连续失败超过 10 次后自动
   停止重试**（日志输出 `已停止自动重连…`，不再刷屏），等你把服务（如 UE、Rider）启动
   好后手动拉起即可；服务恢复后计数自动复位。
2. **手动重连**，两种方式任选（手动重连会复位看门狗失败计数，重新获得至多 10 次自动重试）：
   - **对话框 slash 命令 `/mcp-reconnect`**：直接在输入框输入即可，不经模型、立即执行、结果直显。
     `/mcp-reconnect` 重连全部（重读配置）；`/mcp-reconnect <服务器名>`（如 `/mcp-reconnect unreal`）
     只精准重连那一个。
   - **模型工具 `mcp_reconnect`**：在会话里对模型说「重连一下 UE 的 MCP」，模型即可调用
     `mcp_reconnect`（传 `serverName` 只重连指定服务器，省略则重连全部）。

例如会话里说「重连一下 UE 的 MCP」，模型会调用 `mcp_reconnect`；或直接在对话框输入
`/mcp-reconnect unreal`。

## License

MIT
