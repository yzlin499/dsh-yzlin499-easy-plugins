# dsh-workspace-openmenu

DSH 插件：**工作区快捷打开菜单**。在会话头部右上角（session log 按钮左侧）
加一个「打开为」按钮，二级菜单在工作区位置打开：**pwsh / cmd / 资源管理器 / vscode**。

## 截图

![截图](screenshot.png)

## 安装

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-workspace-openmenu"
```

重启 DSH Web 后生效。

## 使用

打开任意工作区会话 → 右上角（session log 左侧）出现「打开为」按钮 →
下拉选择：**pwsh**（新 PowerShell 7 窗口）、**cmd**（新命令提示符窗口）、
**资源管理器**（Explorer 窗口）、**vscode**（VS Code 打开该目录）。

目标目录 = 当前会话的工作区根目录（`SessionHeader.cwd`）；会话无工作区时提示错误。

## 跨平台：Windows / WSL / Linux

- **Windows（原生）**：explorer 直接 spawn；pwsh / cmd 经 `cmd /c start` 开
  独立新窗口；vscode 优先 `Code.exe`，回退 `code` 命令。
- **WSL（推荐用法）**：Host 自动识别 WSL 环境，把工作区 Linux 路径经
  `wslpath -w` 转成 Windows 路径（`D:\...` 或 `\\wsl.localhost\...`），再经
  WSL 互操作启动 Windows 侧应用——资源管理器直接开对应文件夹；
  cmd 开命令提示符新窗口（`pushd` 兼容 UNC 路径）；pwsh 优先 Windows 侧
  PowerShell 7（pwsh.exe）开新窗口，没装则回退 Linux pwsh（终端模拟器）；
  vscode 优先 Linux `code` CLI（连接 Windows 版 VS Code），回退 Windows
  `Code.exe`。路径转换失败或互操作关闭时返回明确错误。
- **原生 Linux（尽力而为）**：explorer → `xdg-open`；cmd/pwsh → 终端模拟器
  （gnome-terminal / konsole / kitty 等，取第一个存在的）；vscode → `code`。

## 工作原理

- **Client**（`client.js`）：注册进 `conversation.session.header.utilities` 插槽
  （右对齐会话工具区，`order: -10` 排在 session-log 按钮左侧）；按钮 + 下拉菜单，
  点击项 POST `/workspace-open/open`。
- **Host**（`index.js`）：`/workspace-open/open` 按会话 cwd 和运行平台选择
  启动策略——Windows 原生启动；WSL 先 `wslpath -w` 转换路径再经互操作启动
  Windows 侧应用；纯 Linux 走 xdg-open / 终端模拟器 / code。启动做早期失败
  检测（找不到可执行文件、互操作关闭时快速返回错误）。

## License

MIT
