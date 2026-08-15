# dsh-yzlin499-easy-plugins

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.1.0--rc.6-blue)](https://github.com/deepseek-ai/DeepSeek-Harness)

个人 DSH 插件合集：一组即插即用的插件包（bundle），用 `dsh plugin` 一条命令安装，
DSH 启动自动加载、重启不丢。每个 `dsh-*/` 子目录都是一个标准插件包。

## 已包含插件

| 插件 | 用途 | 安装命令 |
|---|---|---|
| [`dsh-oc-usage`](#dsh-oc-usageopencode-用量悬浮窗) | OpenCode 用量悬浮窗：右上角可拖拽悬浮窗，显示 opencode.ai Go 订阅 5h/7d/30d 用量 + 重置倒计时，5 分钟自动刷新 | `dsh plugin --profile web add ./dsh-oc-usage` |
| [`dsh-mcp-compat`](#dsh-mcp-compat标准-mcp-配置兼容) | 标准 MCP 配置兼容：自动读取 `.mcp.json` / `opencode.json` / `.cursor/mcp.json` / `.codex/config.toml`（项目级 + 用户级），把每个 MCP 服务器挂载为 dsh-mcp-client 实例，工具以 `mcp__<名>__*` 出现 | `dsh plugin --profile web add ./dsh-mcp-compat` |
| [`dsh-quick-file`](#dsh-quick-file快速输入文件) | @ 快速输入文件：输入框打 `@` 弹出工作区文件列表，回车/点击即把文件路径插入输入框（复用内置输入触发管道） | `dsh plugin --profile web add ./dsh-quick-file` |

> profile 名按你的 DSH 实例调整（例如 `web`），详见 [Docs/Install.md](Docs/Install.md)。

## 快速开始

1. 克隆本仓库：

   ```powershell
   git clone https://github.com/yzlin499/dsh-yzlin499-easy-plugins.git
   cd dsh-yzlin499-easy-plugins
   ```

2. 安装插件：

   ```powershell
   dsh plugin --profile web add ./dsh-oc-usage
   dsh plugin --profile web add ./dsh-mcp-compat
   dsh plugin --profile web add ./dsh-quick-file
   ```

3. **重启 DSH Web**，插件自动加载。

卸载同理：`dsh plugin --profile web remove dsh-oc-usage`。

---

## dsh-oc-usage（OpenCode 用量悬浮窗）

- **Host**（`index.js`）：Node 全局 fetch 直连 `opencode.ai/_server`（协议移植自
  YZL `src-tauri/src/usage.rs`），正则解析 rolling/weekly/monthly 用量；注册
  `/oc-usage/*` webServer 路由；Cookie 只存进程内存、不落盘、不回显。
- **Client**（`client.js`）：`__ModuleLoader__` 格式，注册进 `shell.overlay`
  Slot；React + 主题 CSS 变量；同源 fetch 调 `/oc-usage/*` 路由。

### 包私有 HTTP 路由（Host）

| 路由 | 方法 | 返回 |
|---|---|---|
| `/oc-usage/query` | GET | `{ isValid, workspaceId, rolling, weekly, monthly, updatedAt, message? }` |
| `/oc-usage/config-get` | GET | `{ cookieSet, workspaceId }`（不回显 Cookie） |
| `/oc-usage/config-set` | POST | `{ cookie?, workspaceId? }` 部分更新 → `{ ok }` |

### 使用

1. 安装（见 [Docs/Install.md](Docs/Install.md)）→ 重启 DSH → 右上角出现悬浮窗。
2. 点 ⚙ 粘贴 opencode.ai 登录后的完整 Cookie（必须含 `auth=`）。
3. Workspace ID 可留空（自动发现）或手动填 `wrk_…`。

---

## dsh-mcp-compat（标准 MCP 配置兼容）

- **读取来源**（按优先级，先出现者胜；覆盖项目级 + 用户级）：
  - `.mcp.json` —— Claude Code / Codex / Cursor 约定（`mcpServers`）
  - `opencode.json` / `opencode.jsonc` —— opencode 约定（`mcp` 键，command 数组 / url / enabled）
  - `.cursor/mcp.json` —— Cursor 约定（同 `mcpServers`）
  - `.codex/config.toml` —— Codex 约定（`[mcp_servers.<name>]`）
  - 用户主目录：`~/.mcp.json`、`~/.codex/config.toml`、`~/.config/opencode/opencode.json`
- **挂载方式**：每个服务器挂载一个官方 `@deepseek-ai/dsh-mcp-client` 实例
  （复用 MCP SDK：会话管理、自动重连、工具注册、`mcp__<名>__<工具>` 命名）。
- **自动重扫**：配置文件变更（fs.watch）或新会话（`session/created`）触发。

### 使用

任何 workspace 根目录（或用户主目录）放入上述任一配置文件即自动生效，无需配置 DSH。
例如 YZLWork 的 `.mcp.json` 定义了 `yzl-dashboard`，DSH 启动后即出现
`mcp__yzl-dashboard__*` 工具。

---

## dsh-quick-file（@ 快速输入文件）

- **Client**（`client.js`）：注册一个 `@` 输入触发源（`ctx.inputTriggers`，
  复用 DSH 内置管道 `dsh-client-ui-input-trigger`）——菜单渲染、键盘导航、
  输入改写全部由管道负责，本插件只提供文件数据源。
- **Host**（`index.js`）：`/quick-file/files` 路由，按会话工作区根
  （`SessionHeader.cwd`）用 `fs` 服务递归列目录；深度 ≤ 3、跳过
  `node_modules/.git/dist` 等、最多 50 条、路径 `/` 分隔。

### 使用

输入框打 `@` 弹出文件列表（与其它 `@` 源分组并列）→ 继续打字过滤
（按文件名/路径模糊匹配）→ ↑↓/回车或点击选中 → `@查询词` 被替换为文件路径。

---

## 开发新插件

每个插件包是独立目录，结构如下：

```
dsh-xxx/
├── package.json        # name/type/main + dsh.bundle.patch 指向 cordis.patch.yml
├── cordis.patch.yml    # 声明挂载行（insert: id + name）
├── index.js            # Host 半侧（ESM，由 cordis loader 挂载）
├── client.js           # Client 半侧（可选，浏览器 UI，需在 package.json 声明 dsh.client）
└── dsh.plugin.json     # DSH 插件清单（可选，含 contributes 声明）
```

新增插件的步骤：

1. 复制任一现有 `dsh-*/` 结构，按需修改 `package.json`（`name`、`dsh.bundle.patch`）。
2. 在 `index.js` 实现 Host 逻辑；需要浏览器界面时加 `client.js` 并声明
   `dsh.client` 与 `exports["./client"]`。
3. 本地验证：`dsh plugin --profile web add ./dsh-xxx` → 重启 DSH Web。
4. 更新本 README 的插件表格与 Docs/Install.md，提交贡献。

## 目录结构

```
dsh-yzlin499-easy-plugins/
├── README.md
├── AGENTS.md            # 给 AI 编码代理的项目说明
├── Docs/                # 知识库（参考、安装、插件开发）
│   ├── 参考.md           # 官方文档与生态链接
│   └── Install.md       # 安装/卸载详细说明
├── LICENSE              # MIT
├── package.json         # 仓库元信息
└── dsh-*/               # 每个插件包（bundle）
    ├── package.json
    ├── cordis.patch.yml
    ├── index.js
    └── client.js (可选)
```

## 贡献

欢迎提交插件或改进：

- 新插件请遵循上面的「开发新插件」结构，保证 `dsh plugin add` 即装即用。
- 每个插件包自包含，互不依赖；根目录文档与插件一并维护。

## License

[MIT](LICENSE) © 殷泽凌 (yzlin499)
