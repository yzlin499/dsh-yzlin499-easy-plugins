# dsh-quick-file

为 DSH 官方原生 `@` 文件搜索提供 Everything 后端。

本插件不注册第二套 `@` 菜单，也不替换官方输入框 UI；它替换官方的本地文件引用 Provider，因此 DSH 原生文件/会话候选、目录下钻、文件图标、引用格式和键盘操作都会继续保留。

## 安装

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-quick-file"
```

需要 DSH `0.1.5-rc.1` 或更高版本，以及正在运行的 Everything HTTP Server。安装后重启 DSH Web。

## 使用

1. 在 Everything 中确认 HTTP Server 已开启，默认地址为 `http://127.0.0.1:8074`。
2. 在 DSH 输入框输入 `@`，使用官方原生文件候选菜单。
3. 输入关键词时，候选优先通过 Everything 在当前会话工作区内搜索。
4. 输入目录路径后继续输入，例如 `@src/`，仍使用官方目录下钻语义。
5. Everything 不可用或请求失败时，自动回退官方本地有界扫描。
6. 文件选中后继续使用官方文件引用格式；文件内容仍由模型调用 `read` 工具读取。

## 配置（设置 → 插件 → 快速文件搜索）

| 项 | 说明 |
|---|---|
| Everything HTTP | Everything HTTP Server 地址，默认 `http://127.0.0.1:8074`；留空回退官方本地扫描 |
| 忽略目录 | 逗号分隔的目录基名；默认忽略 `node_modules`、`.git`、`dist`、`build` 等目录 |
| 候选数量 | Everything 和官方回退搜索的最大返回数量，范围 1-200 |
| 本地索引上限 | Everything 不可用时官方本地索引的最大条目数，范围 1-200000 |

Everything 查询始终追加当前 Session 工作区的 `path:` 限定，并在返回后再次检查路径是否仍在工作区内。忽略目录同时在 Everything 查询和结果过滤阶段生效。

## 工作原理

官方原生 `@` 链路为：

```text
ui-reference
  → remote.fileReferences.list
  → dsh-api-session-controller
  → ctx.fileReferences.list
  → dsh-quick-file Provider
```

`cordis.patch.yml` 停用官方组合树中的 `file-reference-local` 行并插入本插件 Provider。Host Provider 实现官方 `ctx.fileReferences.list` 契约，保留官方的路径引用提示词，并把带关键词的查询优先交给 Everything，失败时使用本地有界扫描回退。

Provider 返回官方约定的 `{ path, kind: 'file' | 'directory' }` 候选，不参与浏览器菜单渲染。Client 半侧只注册设置卡片，不注册新的 `inputTriggers` source。

## 已知限制

- Everything HTTP Server 必须在 DSH Host 所在环境可访问；WSL 与 Windows 之间的地址可达性取决于本机网络配置。
- Everything 结果按当前工作区过滤；Everything 自身的索引权限不会绕过 DSH 文件系统权限。
- 空查询的根目录展示使用官方本地目录列举；带关键词的查询使用 Everything。
- Everything 搜索失败时会静默回退官方扫描，不影响原生 `@` 菜单显示。

## License

MIT
