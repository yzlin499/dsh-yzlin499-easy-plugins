# DSH 插件安装 / 卸载

本仓库下的每个插件包（`dsh-*/`）都用同一套命令安装/卸载，安装一次永久生效，重启不丢。

## 已包含的插件

| 插件 | 用途 |
|---|---|
| `dsh-oc-usage` | OpenCode 用量悬浮窗（右上角，5h/7d/30d 用量） |
| `dsh-mcp-compat` | 自动读取 `.mcp.json` / `opencode.json` 等标准 MCP 配置并连接 |
| `dsh-quick-file` | @ 快速输入文件（输入框 `@` 弹出文件列表，回车即插入路径） |
| `dsh-yzlin499-plugins-manager` | 插件管理（设置页开关本集合插件，走 dsh CLI） |
| `dsh-workspace-openmenu` | 工作区快捷打开（右上角「打开为」菜单：pwsh/cmd/资源管理器/vscode） |

## 安装

在仓库根目录打开 PowerShell，运行：

```powershell
dsh plugin --profile web add ./dsh-oc-usage
dsh plugin --profile web add ./dsh-mcp-compat
dsh plugin --profile web add ./dsh-quick-file
dsh plugin --profile web add ./dsh-yzlin499-plugins-manager
dsh plugin --profile web add ./dsh-workspace-openmenu
```

> `--profile web` 中的 `web` 是你的 DSH 实例名，按实际情况调整。

安装完成后**重启 DSH Web**，完成。

## 卸载

```powershell
dsh plugin --profile web remove dsh-oc-usage
dsh plugin --profile web remove dsh-mcp-compat
dsh plugin --profile web remove dsh-quick-file
dsh plugin --profile web remove dsh-yzlin499-plugins-manager
dsh plugin --profile web remove dsh-workspace-openmenu
```

## 原理（可选看）

`dsh plugin` = pnpm 安装到 `~/.dsh/profiles/<profile>/` + 检测到 `dsh.bundle` 声明后
**自动写入挂载清单**（`dsh.profile.bundles`），DSH 启动即自动加载，无需改任何配置。

> 插件的具体用法与插件本身一起维护，不写在本安装文档里（见根目录 README）。
