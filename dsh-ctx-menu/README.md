# dsh-ctx-menu —— DSH 右键增强

给 DeepSeek Harness 的侧栏行与正文文件行补上「直接右键」：侧栏行右键等于点官方 `⋯`，
正文文件行右键给出打开、打开方式、定位、复制、另存等动作。

> **当前状态：M1（纯客户端，无宿主路由）。** 已通过静态锚点自检与 26 项单测；
> **尚未在真实 Harness 页面里做过 UI 实测**（锚点命中率需实装验证，见「已知限制」）。

## 用途

| 右键位置 | 行为 |
| --- | --- |
| 侧栏 **会话行** | 直接弹出官方 `⋯` 菜单（置顶 / 重命名 / 分叉 / 归档，以及其它插件追加的行）——不重画菜单 |
| 侧栏 **工作区行** | 同上，弹出官方的重命名 / 删除工作区菜单 |
| 正文 **行内文件提及 chip**（markdown 里的 `README.md` 这类链接） | 同上（锚点是 primitives `MarkdownFileLink` 的类名 + `title`；`title` 常为工作区相对路径，用会话 `cwd` 解析成绝对路径） |
| 正文 **本轮改动文件行**（`Edited N files` 卡片） | 打开预览、打开方式、显示文件位置、复制相对路径、复制绝对路径、复制文件内容、另存为… |
| 正文 **交付文件卡片** | 同上 |
| 右侧栏 **对比（review）页文件行** | 同上 |

## 安装

```bash
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-ctx-menu"
```

> **profile 名要对着用**：桌面封装端（`DeepSeek Harness.exe`）用的是 **`desktop`** profile，
> 纯 `dsh web` 才是 `web`。用错了会出现"装好了但没生效"。
> 本地开发也可以直接 `link:`：`dsh plugin --profile desktop add link:D:/path/to/dsh-ctx-menu`。

装完**重启 DSH**（宿主半侧要重启，仅 client 半侧改动刷新页面即可）。卸载：

```bash
dsh plugin --profile web remove dsh-ctx-menu
```

### 自检：插件到底加载到哪一步？

客户端半侧会把启动进度写到 `window.__DSH_CTX_MENU__`。在 Harness 窗口里按 `Ctrl+Shift+I` 打开 DevTools，
Console 里敲一行即可定位：

```js
__DSH_CTX_MENU__          // undefined = bundle 根本没执行（加载/缓存问题）
__DSH_CTX_MENU__.state()  // { version, phase, errors, sessionId, sessionCwd, canOpen, locale, menuOpen }
```

`phase` 会依次经过 `factory → apply-start → gate:ok → locale:ok → desktop-probe:ok →
session-probe:ok → overlay:ok → styles:ok → ready`；任何一步失败会写进 `errors` 并把 `phase` 停在 `<step>:failed`。

## 使用

直接右键即可，没有需要记忆的开关。

- **侧栏行**：右键 = 官方 `⋯` 菜单。若该行的 `⋯` 按钮当前不可见（未 hover / 键盘 Menu 键触发的场景），
  插件会**放行原生行为**，不会把菜单定位错。
- **诊断模式**：按住 **Alt + 右键**会弹出诊断面板（并同步 `console.log('[dsh-ctx-menu]', …)`），内容包括：
  事件状态、选区、是否落在排除区、从鼠标目标向上的 DOM 链（含 `data-*`）、每个锚点的命中情况、
  `resolveRow` / `resolveFile` 的结果，以及**最终为什么没接管**。
  某个位置右键没反应时先 Alt+右键看一眼，比猜快得多。
- **文件行**：菜单结构对齐官方文件菜单（分组 + 二级菜单）：

  ```
  在 DSH 中打开         ← 官方 sidebarRight.openResource，与官方文件 chip 完全同一条路径
  ──────────────
  在 Rider 中打开       ← 直接用「默认应用」打开（标题点名你系统里的默认应用）
  在应用中打开        ▸  ← 二级菜单：系统为该扩展名注册的关联应用，默认应用置顶并标注（默认）
  显示文件位置
  ──────────────
  复制相对路径           ← 相对**当前会话的工作目录**，分隔符统一为正斜杠
  复制绝对路径
  复制文件内容
  另存为…
  ```

  - 「在 DSH 中打开」需要会话 id 与右侧栏可用，走官方
    `ctx.sidebarRight.openResource('dsh-resource://file/session/<sid>/<相对路径>')`；
  - 「在 <应用> 中打开」的"默认应用"**优先取 DSH 右上角那个「在应用中打开」控件里你点过的应用**
    （持久化在 `localStorage['dsh.open-in-app.choice']`，值形如 `"rider"` / `"vscode"`，是 DSH 自己的目录 id）。
    插件会把这个 id 匹配到**本文件自己的关联列表**里（id 精确 → 名字/别名包含），用列表里的 id 打开；
    匹配不到才退回系统默认关联（列表里 `default: true` 的那一项），再匹配不到则显示「用默认应用打开」并走
    `openWorkspacePath({ path })`（不带 `application`）。Alt + 右键的诊断面板会打印当前 `open-in-app.choice` 值；
  - 「在应用中打开」二级菜单来自 `session.workspacePathApplications`（系统注册的关联应用），
    点某一行走 `session.openWorkspacePath({ path, application })`，Host 会在启动前重新校验；
  - 「显示文件位置」走 `openWorkspacePath({ path, action: 'reveal' })`；
  - 「复制相对路径」= 相对**当前会话的工作目录**（`sessions.list` 里该会话的 `cwd`，右键那一刻取）：
    路径在工作目录内则剥掉根并把分隔符统一成 `/`（`D:\ws\proj\src\a.ts` → `src/a.ts`），
    正好是工作目录自身给 `.`；**不在工作目录内则退回正斜杠形式的绝对路径**（宁可给绝对路径，也不给算错的相对路径）；
    取不到工作目录时只提示、不复制。
  - 「复制绝对路径」= 原始绝对路径（Windows 下保留 `\`，便于粘进资源管理器/终端）。
  - 「复制文件内容」「另存为…」分别走 `remote.workspaceFiles.read`（分页，上限 2 MiB）、
    `remote.workspaceFiles.readBytes`（上限 32 MiB，走浏览器保存对话框）。

## 依赖

**无任何第三方插件依赖**：只依赖 DSH 自带能力，且每个动作各自检查前置条件——缺谁就少哪一项。

| 依赖面 | 具体 | 缺失时 |
| --- | --- | --- |
| 宿主服务（宿主半侧） | `webServer`（**硬依赖**，注册路由）+ `sessionController` / `sessions` / `workingDirectory`（软读） | 缺 `webServer` 则宿主半侧不挂载；其余缺失时对应动作返回 `host/unsupported` |
| 宿主内置模块 | `node:fs`（读文件）、`node:path` | — |
| 客户端种子模块 | `react`、`react-dom/client`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-store` | 由 DSH Web 前端提供；`check.mjs` 断言官方客户端仍在使用这些模块 id |
| 客户端服务 | `locale`、`sessions`（会话 id 探针槽）、`sidebarRight`（**仅 0.2.0**，「在 DSH 中打开」用） | 缺 `sidebarRight` 时该行不出现（0.2.1 即如此） |

菜单本身用**官方 `@deepseek-ai/dsh-client-ui-primitives` 的 `Menu`**（`items` + `submenu`）搭建，
不占用任何插槽、不修改任何他人的配置行。

> 曾短暂依赖过 `dsh-better-sidebar` 的 `openFile`（「在侧边栏打开」那一行），后按要求移除。

## 工作原理

0. **两段式架构（0.2.1 起）**：客户端半侧**不能**再直接调用 `remote.session.*`（0.2.1 的客户端 Builtin
   只剩 `ctx / React / host / styles / console`），所以本插件改由**宿主半侧注册自有路由**代劳：

   ```
   客户端（client.js）                      宿主（index.js）
   fetch('ctx-menu/apps?path=…')  ────────▶  GET  /ctx-menu/apps      → sessionController.workspacePathApplications
   fetch('ctx-menu/open', POST)   ────────▶  POST /ctx-menu/open      → sessionController.openWorkspacePath
   fetch('ctx-menu/reveal', POST) ────────▶  POST /ctx-menu/reveal    → 同上（action: 'reveal'）
   fetch('ctx-menu/read?path=…')  ────────▶  GET  /ctx-menu/read      → node:fs（文本 2 MiB / 字节 32 MiB 上限）
   fetch('ctx-menu/cwd?sessionId=…') ─────▶  GET  /ctx-menu/cwd       → sessions.get + workingDirectory.get
   fetch('ctx-menu/capabilities') ────────▶  GET  /ctx-menu/capabilities → canOpenWorkspacePath / workspaceDesktop
   ```

   客户端这层叫「平台桥」：**自有路由优先，0.2.0 的远程服务兜底**，因此同一份代码在 0.2.0 与 0.2.1 上都能工作。
   路由全部同源、受 `connection.requestRejection` 保护，只接受绝对路径。

1. **接管规则与外壳互补（这是本插件最重要的设计）**：DSH 桌面外壳只在「可编辑域」或「有选中文本」时弹原生菜单，
   而渲染进程 `preventDefault()` 会**抑制**该菜单。因此本插件反过来做——**这两种情形一律放行**，
   只在「外壳本来就不弹」且「确实有可追加动作」时才接管。这样绝不会破坏外壳的「选中文本 → 复制」。
2. **命中锚点才动作**：锚点是官方 `data-*` 属性（会话行/工作区行的 `data-row-key`、改动文件的
   `[data-changed-files]`、交付卡片的 `[data-presented-file]`、对比页的 `[data-review-file]`），
   外加正文文件提及 chip 的 CSS-module 本地类名 `fileMention`（**两个变体都带它**：markdown 链接是
   `fileMention+fileLink`，行内代码路径只有 `fileMention`）。**拿不到绝对路径时不做任何猜测**，直接放行。
3. **只追加、不覆盖**：菜单**不占用任何槽**——用平台种子模块 `react-dom/client` 自建 React root 挂在
   `document.body` 上，并套一层错误边界；菜单本体复用官方 `@deepseek-ai/dsh-client-ui-primitives` 的
   `Menu` / `MenuItemButton`。不 patch 任何他人配置行，不注册到任何已占用的 `single` / `keyed` 槽。
   > **为什么不用官方 `shell.overlay` 槽**：槽里的注册**一旦在渲染时抛异常**，slots 层会把它退役
   > （`entriesOfSlot` 跳过 `abdicated`，`reportEntryError(..., { abdicate: true })`，见 `dsh-client-ui-slots` 源码）。
   > 于是一个渲染 bug 会让菜单**静默消失**，而且当时连诊断面板也走同一条渲染链路、会跟着一起失效。
   > 自建 root + 错误边界能把崩溃暴露出来（`__DSH_CTX_MENU__.errors`）并保持其余功能可用。
4. **不 `stopPropagation()`**：终端（xterm）与文档预览（pdf.js）都有自己的冒泡期右键处理，打断会连坐。
   此外这三处（`.xterm` / `[data-document-preview]` / 已开菜单）被列为**排除区**，一律不接管。
5. **脆弱面被钉住**：所有锚点写在 `anchors.json` 并在 `client.js` 内联同一份，
   `node scripts/check.mjs` 会直接读 `app.asar` 断言这些锚点字面量**仍然存在**（DSH 升级后先失败而不是静默失效），
   同时断言外壳菜单契约（`isEditable` / `selectionText.length > 0` / `items.length > 0`）没变，
   以及没有出现官方新增的通用右键接管。

## 开发

```bash
node scripts/check.mjs          # 静态自检（读本机 app.asar）：锚点 / 外壳契约 / 宿主服务 / 种子模块 id / 右键基线
node --test "test/*.test.mjs"   # 91 项单测：门控、锚点、chip 解析、渲染层、平台桥（路由↔远程服务回退）、宿主路由
```

## 已知限制

- **「在 DSH 中打开」只在 0.2.0 可用**：它依赖客户端服务 `sidebarRight.openResource`，0.2.1 起该服务不再向
  插件客户端开放（deliverables 的 `openResource` 是它自己 tab 的 actions，外部拿不到）。服务缺失时该行自动隐藏。
- **文件提及 chip 的锚点是 CSS-module 类名 `fileMention`**（没有 `data-*` 可用），是全部锚点里最弱的一处；
  上游改名会静默失效——`check.mjs` 会断言打包产物里仍有 `fileMention` / `MenuItemButton` / `MenuSurface`。
- **相对路径需要会话 cwd**：首选**插槽标准 prop `useSessions` 的快照**（`useSessions(s => s.byId[sessionId]?.cwd)`，
  与官方 deliverables/chat 的取法一致，覆盖其他工作区的会话），其次宿主 `/ctx-menu/cwd`，最后客户端 `sessions` 服务快照。
  三者都拿不到时，插件**先接管、再异步解析**：解析成功才弹菜单，失败则明确提示「取不到当前工作目录」
  （而不是让右键静默无反应——0.2.0 曾因此出现"只有当前工作区能右键"的假象）。
- **打开方式列表依赖桌面端**：宿主 `canOpenWorkspacePath()` 为 false（纯浏览器场景）时，
  打开方式与显示文件位置会隐藏，只留「复制相对路径 / 复制绝对路径 / 复制文件内容 / 另存为…」等纯客户端动作。
- **会话 id 来自会话级插槽的标准 prop**：探针挂在 `conversation.composer.dock` 上；
  若拿不到，需要会话 id 的动作（预览 / 复制相对路径）会隐藏，其余照常。
- **对比页文件行要求绝对路径**：官方在 `title` 上给了绝对路径才接管，否则放行原生菜单。
- **未含**：外部终端（`windowsterminal`）、以及「用指定编辑器打开**文件本身**」的固定项
  （后者在官方路线里只能打开目录；本插件用「打开方式」的关联列表覆盖同一需求）。

## 版本兼容

| 插件版本 | 适配的 DSH | 说明 |
| --- | --- | --- |
| 0.2.0 | **0.2.1-rc.3**（新契约）+ 0.2.0-rc.2（回退路径） | 宿主半侧注册 `/ctx-menu/*` 路由；客户端「平台桥」优先走路由、失败回退旧远程服务 |
| 0.1.x | 0.2.0-rc.2 | 纯客户端实现，直接调 `remote.session` / `remote.workspaceFiles` |

## License

MIT