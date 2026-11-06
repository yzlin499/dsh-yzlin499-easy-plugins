# dsh-ctx-menu —— 右键菜单补充（复用官方统一右键）

DSH 新版内置了**统一右键菜单**（`@deepseek-ai/dsh-client-ui-context-menu`），官方已经把会话行、文件行、
改动文件卡、文件树、图片等所有位置的右键都绑好了，并对外提供**菜单贡献**接口：

```js
ctx.contextMenus.register({ id, target: 'file', order, resolve: async (value, signal) => actions })
```

本插件**不自绘菜单、不劫持右键事件**，只向官方菜单补充它缺的三项动作（`order: 300`，排在官方之后）。

## 用途

官方 `file` 目标右键已经提供：在侧边栏打开、在浮窗打开、显示文件位置、在 <默认应用> 中打开、复制路径、
另存为 / 下载 / 复制图片。本插件再补：

| 动作 | 说明 |
| --- | --- |
| **打开方式 ▸** | 系统关联应用完整列表（官方只给默认应用）；默认应用置顶并标注「（默认）」 |
| **复制相对路径** | 相对**当前会话工作目录**，分隔符统一为正斜杠；不在工作区内则退回正斜杠绝对路径；取不到 cwd 时置灰 |
| **复制文件内容** | 文本文件正文（分页读取，上限 2 MiB）；二进制文件会提示而不是乱复制 |

会话行/工作区行的右键**不需要本插件**了——官方统一右键已原生支持（本插件 v0.3.0 删除了此前的行劫持逻辑）。

## 为什么还需要一点点自有代码

官方把**菜单本身**和绝大多数位置的**右键绑定**都做好了，但 `deliverables` 里只给「交付文件卡（presented）」
绑了 `getTriggerProps`；**「已编辑 N 个文件」卡的每一行、以及 review 页的文件行没有绑定 target**——
在这些位置右键原本毫无反应。

所以本插件在**这几个位置**装一个极薄的桥：解析出 `{ sessionId, path }` 后**直接调用官方**
`contextMenus.open(target, { x, y })`。菜单内容、渲染、键盘导航、关闭、失败提示依旧全由官方负责。
官方已绑定的位置（presented 卡、正文 chip、文件树、工具卡…）一律不插手。

栈是**自愈**的：`scripts/check.mjs` 会检查 `data-changed-files` 附近**仍然没有** `contextMenuProps: getTriggerProps(`；
一旦官方补绑，自检会失败并提示可以删掉这座桥。

## 安装

```bash
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-ctx-menu"
```

装完**重启 DSH**。卸载：

```bash
dsh plugin --profile web remove dsh-ctx-menu
```

## 依赖

- **官方统一右键**（硬依赖）：客户端服务 `contextMenus`。服务缺失时本插件直接不做事并打一行日志
  （不会报错、不会影响其它插件）。
- 其余能力全部走 DSH 自带客户端远程服务，**没有宿主路由、没有第三方插件依赖**：
  `remote.workspaceFiles.stat/read`（绝对路径、正文）、
  `remote.session.workspacePathApplications/openWorkspacePath`（关联应用、启动）、
  `sessions`（会话工作目录）、`locale`（中英文案，可选）。

## 工作原理

1. 客户端半侧 `inject = ['contextMenus']`，在 `apply` 里注册一个 `file` 目标的贡献
   （`id: dsh-ctx-menu.file`、`order: 300`）。官方在每次右键时调用 `resolve(target, signal)`，
   我们按需返回动作描述符，官方负责渲染、键盘导航、关闭与错误提示。
2. `resolve` 里先取绝对路径（`workspaceFiles.stat` → `absolutePath`，失败则 `会话 cwd + 相对路径`），
   再取关联应用与工作目录。任何一步拿不到就**隐藏或置灰对应动作**，绝不猜。
3. 动作执行用官方约定：`run()` 返回 Promise，抛错时官方显示 `failureLabel`；成功提示走 `contextMenus.notify()`。
4. 承载这些动作的 DOM 面由官方绑定（deliverables / chat / sidebar-files / tool / reference …），
   所以正文 chip、改动文件行、交付卡片、文件树里的右键都能看到本插件的动作。

## 开发

```bash
node scripts/check.mjs          # 静态自检：断言官方统一右键契约仍在（服务名/注册形状/file 目标/DOM 绑定）
node --test "test/*.test.mjs"   # 16 项单测：贡献注册形状、动作清单与排序、执行效果、路径与分页读取
```

`scripts/check.mjs` 是**面向 DSH 升级的哨兵**：官方一旦改动统一右键契约（服务改名、注册形状变化、
不再给 file 目标绑定 DOM），它会先失败，而不是让插件静默失效。默认 asar 路径写死在脚本里，
换机器/换安装位置时用 `--asar <路径>` 指定。

## 已知限制

- **需要含官方统一右键的 DSH 版本**（`dsh-client-ui-context-menu` 存在）。更老版本没有 `contextMenus`
  服务时插件不做事——此时请用本插件的 0.2.x（自绘菜单 + 宿主路由）版本。
- 「复制文件内容」按文本处理：二进制文件会提示；超过 2 MiB 会提示太大（整份文件请用官方的「另存为…」）。
- 「打开方式」列表来自系统关联（`workspacePathApplications`），纯浏览器/无桌面环境下该动作不出现。

## License

MIT
