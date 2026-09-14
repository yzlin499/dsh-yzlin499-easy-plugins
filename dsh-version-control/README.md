# dsh-version-control

统一版本控制插件，接入 DSH 官方 `ui-sidebar-right` 侧边栏，同时支持 Git 和 SVN。

## 用途

- 自动识别当前会话工作区中的 Git 仓库或 SVN working copy
- 在同一个“版本控制”页面切换 Git / SVN
- 查看仓库信息、变更、冲突、未跟踪或未纳管文件
- 查看历史记录和统一 diff
- Git：暂存、提交、更新（`pull --ff-only`）、推送
- SVN：纳入版本控制、提交、更新、还原
- 从变更列表通过官方文件资源页面打开文件
- SVN 支持 WSL 下自动发现 Windows `svn.exe`，并转换路径

SVN 没有 Git 的 staging index，因此 SVN 页面不会伪造“已暂存/未暂存”；两个后端只共享相似的页面结构，具体操作仍遵循各自的版本控制语义。

## 安装

需要 DSH `0.1.5-rc.1` 或更高版本，以及系统中的 `git` 或 `svn` 命令行客户端。插件使用官方 `ui-sidebar-right`，不依赖 `dsh-better-sidebar`。

无需克隆本仓库，直接执行：

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-version-control"
```

安装或更新后重启 DSH Web，再刷新浏览器。

## 使用

1. 打开一个 cwd 位于 Git 仓库或 SVN working copy 内的会话。
2. 在官方右侧侧边栏的新增页面入口中选择“版本控制”。
3. 页面首次打开会自动检测后端，也可以在顶部手动切换 Git / SVN。
4. 点击变更文件查看 diff，文件按钮通过官方 `dsh-resource://file` 页面打开文件。
5. Git 未跟踪文件可以点击“暂存”；提交时会把当前工作区变更加入提交。
6. SVN 未纳管文件可以点击“纳入版本控制”；还原、更新和提交前会要求确认。
7. Git 的“更新”执行 `git pull --ff-only`，“推送”执行 `git push`。
8. 插件设置页的 SVN 配置卡片可以查看或指定 SVN 可执行文件，留空表示自动检测。

认证使用本机 Git / SVN 已有的凭据、配置和凭据助手。插件不会保存账号、密码或证书信任信息。

## 工作原理

Host 半侧通过会话 cwd 调用 Git / SVN CLI，统一输出仓库信息、变更、历史和 diff 数据，并通过 `/version-control/api/*` 提供同源 JSON 路由。写操作使用按仓库串行锁、确认参数、超时和输出大小限制。

Client 半侧使用官方 `ui-sidebar-right` 的公开扩展契约：

- `ctx.sidebarRightTabs.register` 注册 `version-control` 和 `version-control-diff` 页面类型
- `sidebar.right.pane.tab` keyed slot 注册页面主体
- `tab.actions.openTab` 打开差异页面
- `tab.actions.openResource` 打开官方文件资源页面
- `settings.plugin.item` 注册 SVN 可执行文件设置卡片

Git 后端使用 `git status --porcelain=v1 --branch`、`git diff HEAD`、`git log`、`git add`、`git restore`、`git commit`、`git pull --ff-only` 和 `git push`。SVN 后端继续使用 XML 输出、工作副本边界校验和 WSL 路径转换。

## 已知限制

- Git 历史当前一次加载最近 20 条，不提供分页加载
- Git 暂无分支切换、远程管理和 merge 冲突专用界面
- Git 提交按当前会话工作区执行 `git add -A`，暂不提供逐文件提交选择
- SVN 提交按当前会话 cwd 子树执行，不提供逐文件提交选择
- SVN 暂不提供 switch、reverse merge、锁管理和自动冲突解决
- Git / SVN 命令行认证必须事先在本机完成，插件不弹交互式凭据输入

## License

MIT
