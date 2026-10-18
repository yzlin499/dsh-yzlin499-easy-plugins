# AGENTS.md —— 给 AI 编码代理的项目说明

本文件给在仓库里工作的 AI 代理（以及人类开发者）提供项目约定。修改本仓库前请先读它。

## 项目是什么

`dsh-yzlin499-easy-plugins` 是一个 **DSH（DeepSeek Harness）插件包（bundle）合集**。
每个 `dsh-*/` 子目录是一个独立插件包，用 `dsh plugin` 一条命令安装，DSH 启动自动加载、
重启不丢。

面向使用者的说明在 [README.md](README.md)；本文件面向改代码的人和 AI 代理，
深度资料在 [Docs/](Docs/README.md)。三者分工不重复：**README 讲怎么用，本文件讲怎么改，Docs 讲为什么这么设计。**

## 当前插件

| 目录 / 包名 | 版本 | 一句话 | 有 Client 半侧 | 有测试 |
|---|---|---|---|---|
| `dsh-mcp-compat` | 0.8.1 | 读取标准 MCP 配置（`.mcp.json` / `opencode.json` / `.cursor/mcp.json` / `.codex/config.toml`），挂载为 dsh-mcp-client 实例 | 是 | 是 |
| `dsh-version-control` | 0.4.0 | 接入官方 `ui-sidebar-right` 的 Git / SVN 版本控制面板 | 是 | 是 |
| `dsh-ctx-menu` | 0.1.12 | 右键增强：侧栏行复用官方菜单，正文文件行给自定义动作 | 是 | 是 + 静态自检 |
| `dsh-win-notify` | 0.1.0 | Windows 原生吐司通知（权限申请 / 提问 / 运行结束）+ 设置卡片 | 是 | 否 |

## 仓库结构

```
├── README.md                   # 使用文档（面向使用者）
├── AGENTS.md                   # 本文件（面向开发者 / AI 代理）
├── Docs/                       # 知识库（索引见 Docs/README.md）
│   ├── README.md               # 知识库索引
│   ├── Install.md              # 安装 / 卸载 / 本地联调
│   ├── Settings.md             # 插件配置持久化（settings）读写指南
│   ├── 参考.md                  # 官方文档与生态链接
│   ├── ctx-menu/               # 需求-右键优化 / 调研-右键插件 / 设计-右键优化
│   └── codex-import/           # Codex 会话导入系列调研（尚未实现）
├── package.json                # 仓库元信息（private，勿发布）
└── dsh-*/                      # 每个插件包，目录即包结构
    ├── package.json            # 含 dsh.bundle.patch 声明
    ├── cordis.patch.yml        # 挂载行声明（insert）
    ├── index.js                # Host 半侧（ESM）
    ├── client.js               # Client 半侧（可选）
    ├── dsh.plugin.json         # DSH 插件清单（可选）
    ├── scripts/                # 辅助脚本（可选，如 ctx-menu 的 check.mjs）
    ├── test/                   # node --test 测试（可选）
    └── README.md / README_EN.md # 插件文档（中 / 英，必须双份）
```

## 插件包（bundle）契约

新增插件必须满足：

1. **`package.json`**：
   - `"type": "module"`、`"main": "index.js"`、`"license": "MIT"`、`"version"`
   - `dsh.bundle.patch` 指向 `./cordis.patch.yml`
   - 有浏览器 UI 时：`dsh.client = { inject: ["slots"], platform: "web" }`，
     `exports` 里加 `"./client": "./client.js"`
   - 有测试时：`scripts.test = "node --test \"test/*.test.mjs\""`（或 `node --test`）
2. **`cordis.patch.yml`**：声明挂载行，例如：

   ```yaml
   - insert:
       - id: mcp-compat        # 组合树里的行 key（短名，勿与包名重复堆砌）
         name: dsh-mcp-compat   # 包名，其 main 即 Host 半侧
   ```

   **只 insert 自己一行**，绝不 patch / 修改别人的行。
3. **`index.js`（Host 半侧）**：`export const name` + `export const inject`（硬依赖服务）
   + `export function apply(ctx)`。可选服务用 `ctx.get('serviceName')` 读并处理 undefined。
   `apply` 可以是 async（需要在 `ctx.settings.register` 前 `await ctx.loader.import(...)` 时）。
4. **生命周期**：所有副作用（timer / watcher / 路由 / 监听）必须可逆——
   用 `ctx.effect(() => { ...; return disposer })` 或 `ctx.on()` 的返回 off 函数，
   `ctx.webServer.register` 卸载时自动清理。
5. **README 双份（必须）**：每个插件包必须带 `README.md`（中文）和 `README_EN.md`（英文）。
   - 语言规则：中文界面显示 `README.md`；英文界面优先 `README_EN.md`（缺失回退 `README.md`）。
   - 内容至少覆盖：用途 / 安装 / 使用 / 工作原理 / License。
   - 安装段统一给出 GitHub 直装命令
     （`dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-xxx"`）。
   - README 是用户（以及插件市场 / 管理器类界面）了解该插件的唯一入口，
     新增插件缺 README 视为不完整。

## 常用命令

```powershell
# 安装 / 卸载（可换包名：dsh-mcp-compat、dsh-version-control、dsh-ctx-menu、dsh-win-notify）
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-ctx-menu"
dsh plugin --profile web remove dsh-ctx-menu

# 测试（在插件目录内；无 scripts.test 的插件直接用 node --test）
cd dsh-ctx-menu
npm test                    # = node --test "test/*.test.mjs"
npm run check               # = node scripts/check.mjs 静态自检，见下

# 仓库级批量跑测试
Get-ChildItem -Directory -Filter 'dsh-*' | ForEach-Object { Push-Location $_; npm test --if-present; Pop-Location }
```

> `github:...#path:/dsh-xxx` 是 pnpm 的 git 依赖子目录语法：无需克隆仓库，直接以
> GitHub 上的 `dsh-xxx/` 子目录为包安装。

验证流程：安装 → **重启 DSH Web** → 观察插件是否出现 / 生效。
`dsh plugin` 底层 = pnpm 装到 `~/.dsh/profiles/<profile>/` + 自动写入挂载清单。

`dsh-ctx-menu/scripts/check.mjs` 是**面向 DSH 版本升级的哨兵**：它按字节读官方 `app.asar`，
断言插件依赖的非公开锚点仍然存在，DSH 升级后先失败、而不是让插件静默失效。
默认 asar 路径写死在脚本里，换机器 / 换安装位置时用 `--asar <路径>` 指定。

## 代码约定

- 插件代码**纯 ESM**，不用 TypeScript / JSX / 打包器（Host / Client 均不经过转译）。
- Client 的 React 代码用 `React.createElement(...)`，不写 JSX。
- 不把 Services / Events / Slots 等运行时对象 `JSON.stringify` 或整体拷贝，
  只读任务需要的叶子字段。
- 日志用 `console.log('[<plugin>]', ...)` 前缀。
- **引入三方库（vendored 相对路径）**：bundle 顶层裸 import 会按源目录解析失败
  （历史教训）；Client 的 `require()` 只能解析已注册模块表。因此把库的 ESM 构建
  放进插件包 `vendor/` 目录（保留原许可证头），Host 侧 `import ... from './vendor/xxx.js'`
  相对引入。当前仓库暂无 `vendor/` 实例，需要时按此做。渲染外来内容（如 README、
  Markdown）前必须做 XSS 消毒（剥 script / iframe / `on*` 等）。
- **语言（locale）规范**：Client 的多语言显示跟随 DSH 当前语言。
  - 服务：`ctx.locale`（`inject: ["locale"]`）；`locale.getLocale().active` 取值
    `'zh' | 'en'`（服务缺失时默认中文）。
  - 语言切换：用 `locale.subscribe(fn)` 订阅（返回退订函数），切换后重取数据 / 重渲染。
  - 实例：`dsh-ctx-menu`、`dsh-version-control` 的 Client 都注入 `locale` 并提供中英文案。
- **主题（theme）规范**：配色用 `--dsw-alias-*` 变量。注意 **`Theme.listTokens`
  只列出核心可覆盖子集**，完整别名层在主题包的 `styles/design-platform.css`
  （`label-tertiary` / `label-dimmed` / `bg-layer-3` / `bg-module-platform` /
  `interactive-bg-hover` 等都在，浅 / 深两套都有）；不确定时以**官方编译 CSS 已用
  的变量**为准（例如官方插件卡片的 `bg-layer-3` + `border-l2` + 12px 圆角）。
  - 深色模式切换机制：`body[data-ds-dark-theme]` 属性（官方，由主题呈现器按
    colorScheme 切换，绝不用主题 id）。用 `body[data-ds-dark-theme] .my-cls { ... }`
    覆盖，纯 CSS 自适应，无需 JS 检测。
  - 硬编码中性色用半透明配对：浅色 `rgba(0,0,0,x)`、深色 `rgba(255,255,255,x)`。
  - 需要 JS 判断主题时：`ctx.theme.getTheme().active.colorScheme`（`'light'|'dark'`），
    或订阅 `theme/change` 事件。
- **插件设置（settings.plugin.item）规范**：见 [Docs/Settings.md](Docs/Settings.md)；
  现成实现参考 `dsh-win-notify`（开关型）与 `dsh-mcp-compat`（多字段型）。
- **测试**：新增或修改插件逻辑时尽量补 `test/*.test.mjs`（`node --test`，
  用 `test/fake-dom.mjs` 这类假 DOM 隔离 Client 逻辑），提交前跑一遍。

## 分发方式

- 只通过 **GitHub** 分发，**不发布 npm**：使用者无需克隆仓库，用 pnpm 的 git 子目录
  语法 `github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-xxx` 一行直装
  （`dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-xxx"`）。
- 新增插件必须保证目录结构即包结构（`package.json` 位于 `dsh-xxx/` 根，且已提交到
  GitHub `main` 分支），GitHub 直装命令才能开箱即用。
- 根 `package.json` 是 `"private": true`，禁止 publish。

## 文档维护

- **新增插件**时同步更新：根 [README.md](README.md) 插件一览、[Docs/Install.md](Docs/Install.md)
  安装 / 卸载表、本文件「当前插件」表、[Docs/README.md](Docs/README.md) 索引。
- **删除插件**时同样四处同步，并在根 README 的「已下线」表里留一行，说明原因与卸载命令。
- 调研 / 设计类长文档放 `Docs/<主题>/`（如 `ctx-menu/`、`codex-import/`），
  按「需求 → 调研 → 设计」命名，同组文档之间的相对链接保持可用。
- 这类文档是**带日期的快照**（含当时的实测数据与版本号），不随代码演进回改；
  需要更新结论时新增文档，别改历史记录。

## Git 约定

- **提交节奏**：普通一两行的小修改**不要频繁 commit and push**，留在工作区等用户
  自己说明要提交时再提交；只有大量修改（一次涉及多个文件 / 较大改动）才需要
  完成后立即 commit and push。
- **提交日志一律使用中文**：标题与正文都用中文描述（技术名词 / 命令可保留英文）。
- 分支 `main`；换行符由 `.gitattributes` 统一（仓库存 LF）。
- 本仓库 `.git/config` 里有 github.com 专用的 NAS 代理
  （`http.https://github.com/.proxy`），**只写仓库级，不要动全局 git 配置**。
- 不提交 `node_modules/`、`.dsh/`、日志等（见 `.gitignore`）。
