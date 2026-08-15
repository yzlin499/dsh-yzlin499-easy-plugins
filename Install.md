# DSH 插件安装 / 卸载

本仓库下的每个插件包（`dsh-*/`）都用同一套命令安装/卸载，安装一次永久生效，重启不丢。

## 已包含的插件

| 插件 | 用途 |
|---|---|
| `dsh-oc-usage` | OpenCode 用量悬浮窗（右上角，5h/7d/30d 用量） |
| `dsh-mcp-compat` | 自动读取 `.mcp.json` / `opencode.json` 等标准 MCP 配置并连接 |

## 安装

### 方式一：一键安装全部（推荐）

在仓库根目录打开 PowerShell，运行：

```powershell
./install-all.ps1
```

### 方式二：逐个安装

在仓库根目录打开 PowerShell，运行：

```powershell
dsh plugin --profile web add ./dsh-oc-usage
dsh plugin --profile web add ./dsh-mcp-compat
```

> `--profile web` 中的 `web` 是你的 DSH 实例名，按实际情况调整。

安装完成后**重启 DSH Web**，完成。

## 卸载

### 一键卸载全部

```powershell
./uninstall-all.ps1
```

### 逐个卸载

```powershell
dsh plugin --profile web remove dsh-oc-usage
dsh plugin --profile web remove dsh-mcp-compat
```

## 原理（可选看）

`dsh plugin` = pnpm 安装到 `~/.dsh/profiles/<profile>/` + 检测到 `dsh.bundle` 声明后
**自动写入挂载清单**（`dsh.profile.bundles`），DSH 启动即自动加载，无需改任何配置。

> 插件的具体用法与插件本身一起维护，不写在本安装文档里（见根目录 README）。
