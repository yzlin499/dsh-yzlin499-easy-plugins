# dsh-quick-file

DSH 插件：**@ 快速输入文件**。

输入框打 `@` 弹出工作区文件列表，回车/点击即把文件路径插入输入框
（复用 DSH 内置输入触发管道，不修改输入框本身）。

## 截图

![截图](screenshot.png)

## 安装

```powershell
dsh plugin --profile web add ./dsh-quick-file
```

重启 DSH Web 后生效。

> 或者：直接通过 **dsh-yzlin499-plugins-manager** 的「插件管理」卡片（设置 → 插件）快速启用。

## 使用

输入框打 `@` → 弹出文件列表（与其它 `@` 源分组并列）→ 继续打字过滤
（按文件名/路径模糊匹配）→ ↑↓/回车或点击选中 → `@查询词` 被替换为文件路径。

## 配置（设置 → 插件 → 快速输入文件）

| 项 | 说明 |
|---|---|
| Everything HTTP | **留空 = 递归扫描**工作区；填入 `http://127.0.0.1:8074` 这类地址后改用 **Everything HTTP Server** 搜索（Everything 已索引全盘，比逐目录遍历更快） |
| 列表深度上限 | 递归扫描模式的最大目录深度（1-10，默认 3） |
| 文件数量上限 | 最多返回的条目数（10-200，默认 50） |

Everything 搜索复用 Everything 的索引：在**当前会话工作区**内（`path:` 限定）按文件名匹配，自动排除 `node_modules/.git/dist` 等目录，速度快且覆盖全盘已索引内容。

## 工作原理

- **Client**（`client.js`）：注册一个 `@` InputTriggerSource 到内置管道
  `dsh-client-ui-input-trigger`（`ctx.inputTriggers`）——菜单渲染、键盘导航、
  输入改写全部由管道负责，本插件只提供文件数据源。
- **Host**（`index.js`）：`/quick-file/files` 路由，按会话工作区根
  （`SessionHeader.cwd`）取文件列表：
  - 未配置 Everything：用 `fs` 服务递归列目录（深度/忽略/数量受限）
  - 配置了 Everything HTTP：走 `?search=...&j=1&path_column=1` JSON 接口，
    失败自动回退递归扫描
- 配置经官方 `ctx.settings` 持久化到 `~/.dsh/settings.yaml`（命名空间
  `dsh-quick-file`），设置卡片走插件自身 `/quick-file/config` 路由读写。

## License

MIT
