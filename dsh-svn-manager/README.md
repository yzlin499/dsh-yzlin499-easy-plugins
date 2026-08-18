# dsh-svn-manager

在 [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 中增加一个 SVN 管理页面，用于处理当前会话工作区所属的 SVN working copy。

## 用途

- 查看冲突、待提交变更和未纳管文件
- 将未纳管文件执行 `svn add`
- 二次确认后执行 `svn revert`
- 输入日志并执行 `svn commit`
- 二次确认后执行 `svn update`
- 分页查看 SVN 提交历史
- 在独立的侧边栏 Tab 中查看工作区 diff 和 revision diff
- 从变更列表直接用 better-sidebar 编辑器打开文件

SVN 没有 Git 的 staging index，因此本插件不会伪造“已暂存/未暂存”概念。页面按“冲突 / 待提交变更 / 未纳管文件”分类。

## 安装

前置条件：

1. 已安装 `dsh-better-sidebar >= 0.12.1`
2. 系统已安装 SVN CLI，终端运行 `svn --version` 可用
3. DSH 使用 Node.js 20 或更高版本

在本仓库根目录执行：

```powershell
dsh plugin --profile web add ./dsh-svn-manager
```

已经安装 **dsh-yzlin499-plugins-manager** 时，也可以进入「设置 → 插件 → 插件管理」，直接启用 `dsh-svn-manager`。

安装或更新 Host 代码后需要重启 DSH Web，再刷新浏览器。

## 使用

1. 打开一个 cwd 位于 SVN working copy 内的会话。
2. 在 better-sidebar 的 `+` 菜单中选择 `SVN`。
3. 点击变更文件查看 diff，点击文件按钮在编辑器中打开。
4. 未纳管文件可点击 `+` 纳入版本控制。
5. 输入提交说明后点击“提交”，提交当前会话 cwd 子树中所有已调度和已修改内容。
6. “还原”和“更新”会修改磁盘内容，执行前会显示确认对话框。

认证完全使用本机 SVN 已有的 auth cache、证书配置和系统凭据。本插件不保存用户名、密码或证书信任信息。网络操作使用 `--non-interactive`，需要先在终端完成首次认证或证书确认。

## 工作原理

Host 半侧通过参数数组调用系统 `svn`，不经过 shell：

- `svn info/status/log --xml` 提供结构化数据
- `svn diff --git --show-copies-as-adds` 生成 unified diff
- JSON API 固定挂载在 `/svn-manager/api/*`
- status / log / diff / commit / update 均限定在当前会话 cwd，working-copy root 只用于路径安全校验
- 所有文件目标必须位于 `svn info` 返回的 working-copy root 内
- 路由使用 Host/Origin 信任围栏，写操作只接受 JSON POST
- 子进程具备超时和输出大小上限

Client 半侧注入 `betterSidebar`，注册：

- `dsh-svn-manager`：主 SVN 页面，单实例
- `dsh-svn-manager:diff`：隐藏的 SVN Diff 页面，由变更和历史记录定向打开

Tab 注册和 CSS 都由 Cordis fiber 持有，插件停用或 HMR 时会自动清理。

## 已知限制

- 暂不提供 `svn switch`、reverse merge、锁管理和冲突自动解决
- 不递归提交 externals
- 不保存 SVN 凭据，也不会弹出交互式密码输入
- SVN Diff 使用统一补丁视图，不复用 better-sidebar 内置的 Git 专用 Diff 组件
- 提交操作默认覆盖当前会话 cwd 子树，不提供逐文件勾选提交

## License

MIT
