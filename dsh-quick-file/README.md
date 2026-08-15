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

> 或者：直接通过 **dsh-yzlin499-plugins-manager** 的设置面板 →「插件管理」快速启用。

## 使用

输入框打 `@` → 弹出文件列表（与其它 `@` 源分组并列）→ 继续打字过滤
（按文件名/路径模糊匹配）→ ↑↓/回车或点击选中 → `@查询词` 被替换为文件路径。

## 工作原理

- **Client**（`client.js`）：注册一个 `@` InputTriggerSource 到内置管道
  `dsh-client-ui-input-trigger`（`ctx.inputTriggers`）——菜单渲染、键盘导航、
  输入改写全部由管道负责，本插件只提供文件数据源。
- **Host**（`index.js`）：`/quick-file/files` 路由，按会话工作区根
  （`SessionHeader.cwd`）用 `fs` 服务递归列目录；深度 ≤ 3、跳过
  `node_modules/.git/dist` 等、最多 50 条、路径 `/` 分隔。

## License

MIT
