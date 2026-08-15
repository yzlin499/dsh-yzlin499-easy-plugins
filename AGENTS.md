# AGENTS.md —— 给 AI 编码代理的项目说明

本文件给在仓库里工作的 AI 代理（以及人类开发者）提供项目约定。修改本仓库前请先读它。

## 项目是什么

`dsh-yzlin499-easy-plugins` 是一个 **DSH（DeepSeek Harness）插件包（bundle）合集**。
每个 `dsh-*/` 子目录是一个独立插件包，用 `dsh plugin` 一条命令安装，DSH 启动自动加载、
重启不丢。

## 仓库结构

```
├── README.md                   # 使用文档
├── Docs/                       # 知识库（参考、安装、插件开发）
│   ├── 参考.md                  # 官方文档与生态链接
│   └── Install.md              # 安装/卸载说明
├── AGENTS.md                   # 本文件
├── package.json                # 仓库元信息（private，勿发布）
└── dsh-*/                      # 每个插件包
    ├── package.json            # 含 dsh.bundle.patch 声明
    ├── cordis.patch.yml        # 挂载行声明（insert）
    ├── index.js                # Host 半侧（ESM）
    ├── client.js               # Client 半侧（可选）
    └── dsh.plugin.json         # DSH 插件清单（可选）
```

## 插件包（bundle）契约

新增插件必须满足：

1. **`package.json`**：
   - `"type": "module"`、`"main": "index.js"`、`"license": "MIT"`
   - `dsh.bundle.patch` 指向 `./cordis.patch.yml`
   - 有浏览器 UI 时：`dsh.client = { inject: ["slots"], platform: "web" }`，
     `exports` 里加 `"./client": "./client.js"`
2. **`cordis.patch.yml`**：声明挂载行，例如：

   ```yaml
   - insert:
       - id: oc-usage          # 组合树里的行 key
         name: dsh-oc-usage    # 包名，其 main 即 Host 半侧
   ```

3. **`index.js`（Host 半侧）**：`export const name` + `export const inject`（硬依赖服务）
   + `export function apply(ctx)`。可选服务用 `ctx.get('serviceName')` 读并处理 undefined。
4. **生命周期**：所有副作用（timer / watcher / 路由 / 监听）必须可逆——
   用 `ctx.effect(() => { ...; return disposer })` 或 `ctx.on()` 的返回 off 函数，
   `ctx.webServer.register` 卸载时自动清理。

## 已有插件要点

### dsh-mcp-compat（标准 MCP 配置兼容）

- 读取 `.mcp.json` / `opencode.json(.c)` / `.cursor/mcp.json` / `.codex/config.toml`
  （项目级 + `$HOME` 级），每个服务器挂载一个 `@deepseek-ai/dsh-mcp-client` 实例。
- **红线**：`dsh-mcp-client` 必须经 `ctx.loader.import('@deepseek-ai/dsh-mcp-client')`
  获取——顶层裸 import 会按 bundle 源目录解析，报 `ERR_MODULE_NOT_FOUND`（历史教训）。
- 变更自动重扫：配置文件 `fs.watch` + `session/created` 事件。
- 解析函数 `parseMcpJson / parseOpencodeJson / parseCodexToml / collectServers`
  已导出，可被 Node 脚本直接 import 做单测。

### dsh-oc-usage（OpenCode 用量悬浮窗）

- Host 用 Node 全局 `fetch` 直连 `opencode.ai/_server`（server-fn 序列化文本，正则解析），
  注册 `ctx.webServer.register({ kind: 'prefix', path: '/oc-usage', ... })` 同源路由。
- **红线**：Cookie 只存模块进程内存，**不落盘、不回显**（`config-get` 不返回 Cookie）。
- Client 半侧：`__ModuleLoader__` 格式，注册进 `shell.overlay` Slot，React 手写
  `createElement`，同源 fetch 调 `/oc-usage/*`。

## 常用命令

```powershell
dsh plugin --profile web add ./dsh-oc-usage    # 单个安装（可换包名）
dsh plugin --profile web remove dsh-oc-usage   # 单个卸载
```

验证流程：安装 → **重启 DSH Web** → 观察插件是否出现/生效。
`dsh plugin` 底层 = pnpm 装到 `~/.dsh/profiles/<profile>/` + 自动写入挂载清单。

## 代码约定

- 插件代码**纯 ESM**，不用 TypeScript / JSX / 打包器（Host/Client 均不经过转译）。
- Client 的 React 代码用 `React.createElement(...)`，不写 JSX。
- 不把 Services/Events/Slots 等运行时对象 JSON.stringify 或整体拷贝，
  只读任务需要的叶子字段。
- 日志用 `console.log('[<plugin>]', ...)` 前缀。

## 分发方式

- 只通过 **GitHub** 分发，**不发布 npm**：使用者克隆仓库后用本地路径安装
  （`dsh plugin --profile web add ./dsh-xxx`）。
- 根 `package.json` 是 `"private": true`，禁止 publish。

## Git 约定

- 分支 `main`；换行符由 `.gitattributes` 统一（仓库存 LF）。
- 本仓库 `.git/config` 里有 github.com 专用的 NAS 代理
  （`http.https://github.com/.proxy`），**只写仓库级，不要动全局 git 配置**。
- 不提交 `node_modules/`、`.dsh/`、日志等（见 `.gitignore`）。
