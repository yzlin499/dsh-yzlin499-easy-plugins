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
│   ├── Install.md              # 安装/卸载说明
│   └── Settings.md             # 插件配置持久化（settings）读写指南
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
5. **README 双份（必须）**：每个插件包必须带 `README.md`（中文）和 `README_EN.md`（英文）。
   - 语言规则：中文界面显示 `README.md`；英文界面优先 `README_EN.md`（缺失回退 `README.md`）。
   - 内容至少覆盖：用途 / 安装 / 使用 / 工作原理 / License。
   - 安装段需注明：已装 **dsh-yzlin499-plugins-manager** 时，可直接在
     「设置 → 插件 → 插件管理」卡片一键启用。
   - 这是插件管理器（`dsh-yzlin499-plugins-manager`）详情弹窗的展示来源，
     其 `/plugins-manager/readme` 路由按此规范读取；新增插件缺 README 会被视为不完整。

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
- **引入三方库（vendored 相对路径）**：bundle 顶层裸 import 会按源目录解析失败
  （历史教训）；Client 的 `require()` 只能解析已注册模块表。因此把库的 ESM 构建
  放进插件包 `vendor/` 目录（保留原许可证头），Host 侧 `import ... from './vendor/xxx.js'`
  相对引入（示例：plugins-manager 的 `marked`）。渲染外来内容（如 README）前必须做
  XSS 消毒（剥 script/iframe/on* 等）。
- **语言（locale）规范**：Client 的多语言显示跟随 DSH 当前语言。
  - 服务：`ctx.locale`（`inject: ["locale"]`）；`locale.getLocale().active` 取值
    `'zh' | 'en'`（服务缺失时默认中文）。
  - 语言切换：用 `locale.subscribe(fn)` 订阅（返回退订函数），切换后重取数据/重渲染。
  - 示例：plugins-manager 详情弹窗按语言请求 README（`?lang=zh|en`）；
    README 文件语言规则见上文契约第 5 条。
- **主题（theme）规范**：配色用 `--dsw-alias-*` 变量。注意 **`Theme.listTokens`
  只列出核心可覆盖子集**，完整别名层在主题包的 `styles/design-platform.css`
  （`label-tertiary` / `label-dimmed` / `bg-layer-3` / `bg-module-platform` /
  `interactive-bg-hover` 等都在，浅/深两套都有）；不确定时以**官方编译 CSS 已用
  的变量**为准（例如官方插件卡片的 `bg-layer-3` + `border-l2` + 12px 圆角）。
  - 深色模式切换机制：`body[data-ds-dark-theme]` 属性（官方，由主题呈现器按
    colorScheme 切换，绝不用主题 id）。用 `body[data-ds-dark-theme] .my-cls { ... }`
    覆盖，纯 CSS 自适应，无需 JS 检测。
  - 硬编码中性色用半透明配对：浅色 `rgba(0,0,0,x)`、深色 `rgba(255,255,255,x)`。
  - 需要 JS 判断主题时：`ctx.theme.getTheme().active.colorScheme`（`'light'|'dark'`），
    或订阅 `theme/change` 事件。
- **插件设置（settings.plugin.item）规范**：见 `Docs/Settings.md`。

## 分发方式

- 只通过 **GitHub** 分发，**不发布 npm**：使用者克隆仓库后用本地路径安装
  （`dsh plugin --profile web add ./dsh-xxx`）。
- 根 `package.json` 是 `"private": true`，禁止 publish。

## Git 约定

- **提交节奏**：普通一两行的小修改**不要频繁 commit and push**，留在工作区等用户
  自己说明要提交时再提交；只有大量修改（一次涉及多个文件/较大改动）才需要
  完成后立即 commit and push。
- **提交日志一律使用中文**：标题与正文都用中文描述（技术名词/命令可保留英文）。
- 分支 `main`；换行符由 `.gitattributes` 统一（仓库存 LF）。
- 本仓库 `.git/config` 里有 github.com 专用的 NAS 代理
  （`http.https://github.com/.proxy`），**只写仓库级，不要动全局 git 配置**。
- 不提交 `node_modules/`、`.dsh/`、日志等（见 `.gitignore`）。
