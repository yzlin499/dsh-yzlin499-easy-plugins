# dsh-quick-file

DSH 插件：**@ 快速输入文件**。

输入框打 `@` 弹出工作区文件列表，回车/点击即把文件路径插入输入框
（复用 DSH 内置输入触发管道，不修改输入框本身）。

## 截图

![截图](screenshot.png)

## 安装

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-quick-file"
```

重启 DSH Web 后生效。

## 使用

输入框打 `@` → 弹出文件列表（与其它 `@` 源分组并列）→ 继续打字过滤
（按文件名/路径模糊匹配）→ ↑↓/回车或点击选中 → 选中项以**块（chip）**形式插入
输入框：只显示文件名，一次 Backspace 即整块删除；发送时自动展开为完整相对路径
交给模型。

候选菜单撑满输入框宽度；每行显示 **类型图标 + 文件名 + 所在目录**：
图标按扩展名染色（如 ts 蓝、js 黄、py 黄蓝、go 浅蓝、rs 橙、图片紫、压缩包橙），
目录路径过长时省略左边、只保留靠近文件名的尾部，聚焦文件名本身。

## 配置（设置 → 插件 → 快速输入文件）

| 项 | 说明 |
|---|---|
| Everything HTTP | **留空 = 递归扫描**工作区；填入 `http://127.0.0.1:8074` 这类地址后改用 **Everything HTTP Server** 搜索（Everything 已索引全盘，比逐目录遍历更快） |
| 忽略目录 | 逗号分隔的目录名，两种搜索模式都跳过。默认 `node_modules,.git,dist,build,coverage,.next,.cache,__pycache__,.venv,venv,target,.dsh`；**清空 = 不忽略任何目录**（Everything 全索引结果都能搜到，包括 node_modules） |
| 列表深度上限 | 递归扫描模式的最大目录深度（1-10，默认 3） |
| 文件数量上限 | 最多返回的条目数（10-200，默认 50） |

Everything 搜索复用 Everything 的索引：在**当前会话工作区**内（`path:` 限定）按文件名匹配，
速度快且覆盖全盘已索引内容。忽略哪些目录由「忽略目录」设置控制（默认排除
node_modules/.git 等，避免搜索结果过杂）；需要搜索 node_modules 里的文件时，
把对应目录从忽略列表去掉或清空即可。输入关键词时走 Everything 搜索；关键词留空时
仍走递归扫描（干净列出工作区结构）。

## 工作原理

- **Client**（`client.js`）：注册一个 `@` InputTriggerSource 到内置管道
  `dsh-client-ui-input-trigger`（`ctx.inputTriggers`）——菜单渲染、键盘导航、
  输入改写全部由管道负责，本插件只提供文件数据源。
- **Host**（`index.js`）：`/quick-file/files` 路由，按会话工作区根
  （`SessionHeader.cwd`）取文件列表：
  - 未配置 Everything 或关键词为空：用 `fs` 服务递归列目录（深度/忽略/数量受限）
  - 配置了 Everything HTTP 且有关键词：走 `?search=...&j=1&path_column=1` JSON 接口，
    失败自动回退递归扫描
- 配置经官方 `ctx.settings` 持久化到 `~/.dsh/settings.yaml`（命名空间
  `dsh-quick-file`），设置卡片走插件自身 `/quick-file/config` 路由读写。

## License

MIT
