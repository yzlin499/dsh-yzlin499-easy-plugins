# DSH 插件安装 / 卸载

本仓库下的每个插件包（`dsh-*/`）都可用同一套命令安装/卸载，安装一次永久生效，重启不丢。

**无需克隆仓库**：pnpm 支持从 GitHub 仓库的子目录直接安装（语法 `#path:/子目录`），
一条命令即从 GitHub 拉取并安装指定插件。

## 已包含的插件

| 插件 | 用途 | 安装命令 |
|---|---|---|
| `dsh-oc-usage` | OpenCode 用量悬浮窗（右上角，5h/7d/30d 用量） | `dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-oc-usage"` |
| `dsh-mcp-compat` | 自动读取 `.mcp.json` / `opencode.json` 等标准 MCP 配置并连接 | `dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-mcp-compat"` |
| `dsh-quick-file` | @ 快速输入文件（输入框 `@` 弹出文件列表，回车即插入路径） | `dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-quick-file"` |
| `dsh-svn-manager` | SVN 侧边栏管理（需 `dsh-better-sidebar`） | `dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-svn-manager"` |
| `dsh-win-notify` | Windows 原生吐司通知（权限申请 / 提问 / 运行结束） | `dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-win-notify"` |
| `dsh-workspace-auto-approval` | 工作区自动审批模式 | `dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-workspace-auto-approval"` |
| `dsh-workspace-openmenu` | 工作区快捷打开（「打开为」菜单） | `dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-workspace-openmenu"` |
| `dsh-yzlin499-plugins-manager` | 插件管理（设置页开关本集合插件，走 dsh CLI） | `dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-yzlin499-plugins-manager"` |

## 安装

> 命令中的 `web` 是你的 DSH 实例名，按实际情况调整；若 `dsh` 不在 PATH 中，
> 在命令前加 `npx @deepseek-ai/dsh` 前缀。

选择要装的插件，按上表的安装命令执行（一次一个，命令即上表；例如）：

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-oc-usage"
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-mcp-compat"
```

安装完成后**重启 DSH Web**，完成。

## 卸载

```powershell
dsh plugin --profile web remove dsh-oc-usage
dsh plugin --profile web remove dsh-mcp-compat
dsh plugin --profile web remove dsh-quick-file
dsh plugin --profile web remove dsh-svn-manager
dsh plugin --profile web remove dsh-win-notify
dsh plugin --profile web remove dsh-workspace-auto-approval
dsh plugin --profile web remove dsh-workspace-openmenu
dsh plugin --profile web remove dsh-yzlin499-plugins-manager
```

## 常见问题

- **GitHub 连不上 / 安装超时**：git 与 pnpm 都需要走代理时，先在当前 PowerShell 设置
  环境变量 `$env:HTTPS_PROXY` / `$env:HTTP_PROXY`，或在本 profile 的 `.npmrc` 里写
  `https-proxy=` 与 `proxy=`，再重试。
- **`Ignored build scripts` 提示**：极少数带构建脚本的依赖会被 pnpm 拦截；按 dsh 提示
  把打印的 key 加入 `~/.dsh/profiles/<profile>/pnpm-workspace.yaml` 的 `allowBuilds`
  段后重跑。（本仓库插件均为纯 JS、无构建脚本，一般不会触发。）

## 原理（可选看）

`dsh plugin` = pnpm 安装到 `~/.dsh/profiles/<profile>/` + 检测到 `dsh.bundle` 声明后
**自动写入挂载清单**（`dsh.profile.bundles`），DSH 启动即自动加载，无需改任何配置。
`github:...#path:/<目录>` 是 pnpm 的 git 依赖子目录语法：不克隆整仓到本地工作区，
只取其中指定子目录作为包安装。

> 插件的具体用法与插件本身一起维护，不写在本安装文档里（见根目录 README）。