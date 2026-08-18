# dsh-yzlin499-easy-plugins

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.1.0--rc.6-blue)](https://github.com/deepseek-ai/DeepSeek-Harness)

这里有你那个毛坯房 DSH 急需加进去的小功能。大功能你再找找，小功能我就先帮你做了一批了。

这里没有你要的功能？没事我想想，你也可以想想。

> 以下是 DS大肥鱼 自己写的推销词。
> 
> 这些插件都是日常高频的小工具，而且每个包完全解耦：喜欢哪个装哪个，绝不捆绑全家桶。
无需克隆仓库，`dsh plugin` 一条 GitHub 直装命令，重启即生效。全部 MIT 开源，
代码随便看、随便改。用着顺手给个 Star，缺什么功能提个
Issue——我帮你想想。
> 
> 做这批插件的过程，也是我一点点把 DSH 从毛坯房摸成顺手工具的过程，挺有成就感的。
希望它们也能让你用得更顺手。

## 已包含插件

| 插件 | 截图 | 用途 | 安装命令 | 开发状态 |
|---|---|---|---|---|
| [dsh-oc-usage](dsh-oc-usage/README.md) | <img src="dsh-oc-usage/screenshot.png" width="150" alt="dsh-oc-usage 截图"> | OpenCode 用量悬浮窗：右上角可拖拽悬浮窗，显示 opencode.ai Go 订阅 5h/7d/30d 用量 + 重置倒计时，5 分钟自动刷新 | `dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-oc-usage"` | 序列化还没做完 |
| [dsh-mcp-compat](dsh-mcp-compat/README.md) | — | 标准 MCP 配置兼容：自动读取 `.mcp.json` / `opencode.json` / `.cursor/mcp.json` / `.codex/config.toml`（项目级 + 用户级），把每个 MCP 服务器挂载为 dsh-mcp-client 实例，工具以 `mcp__<名>__*` 出现 | `dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-mcp-compat"` | 没那么稳定 |
| [dsh-quick-file](dsh-quick-file/README.md) | <img src="dsh-quick-file/screenshot.png" width="150" alt="dsh-quick-file 截图"> | @ 快速输入文件：输入框打 `@` 弹出工作区文件列表，回车/点击即把文件路径插入输入框（复用内置输入触发管道）；支持配置 Everything HTTP Server 搜索（比递归扫描更快），忽略目录可自定义 | `dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-quick-file"` | |
| [dsh-svn-manager](dsh-svn-manager/README.md) | — | SVN 侧边栏管理：通过 DSH-better-sidebar 查看工作副本状态、纳管/还原、提交、更新、历史和独立差异 Tab；遵循 SVN 原生语义，不伪造 Git staging | `dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-svn-manager"` | 新增 |
| [dsh-yzlin499-plugins-manager](dsh-yzlin499-plugins-manager/README.md) | <img src="dsh-yzlin499-plugins-manager/screenshot.png" width="150" alt="插件管理器截图"> | 插件管理：设置页列出本集合全部插件，一键启用/停用（走 dsh CLI，批量开关后重启生效）；只管理本项目插件 | `dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-yzlin499-plugins-manager"` | |
| [dsh-workspace-openmenu](dsh-workspace-openmenu/README.md) | <img src="dsh-workspace-openmenu/screenshot.png" width="150" alt="工作区快捷打开截图"> | 工作区快捷打开：会话头部右上角（session log 左侧）「打开为」按钮，二级菜单在工作区位置打开 pwsh / cmd / 资源管理器 / vscode | `dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-workspace-openmenu"` | |
| [dsh-workspace-auto-approval](dsh-workspace-auto-approval/README.md) | <img src="dsh-workspace-auto-approval/screenshot.png" width="150" alt="工作区自动审核截图"> | 工作区自动审核：新增第四种权限模式，自动放行工作区内操作、工作区外只读访问和网络读取；复杂命令使用当前会话模型进行极简无工具审核，其余回落下游审批链 | `dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-workspace-auto-approval"` | 新增 |
| [dsh-win-notify](dsh-win-notify/README.md) | — | Windows 原生吐司通知：权限申请 / 发起提问 / 运行停止时弹右下角通知，网页挂后台也能第一时间知道；支持仅后台通知模式 | `dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-win-notify"` | |

> 点插件名可查看该插件的详细文档（README）。profile 名按你的 DSH 实例调整（例如 `web`），
> 安装/卸载详见 [Docs/Install.md](Docs/Install.md)。

## 快速开始

无需克隆仓库，直接从 GitHub 一行安装（pnpm 的 `#path:/` 子目录语法定位插件包）：

1. 选择要装的插件，按上方表格的安装命令执行，例如：

   ```powershell
   dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-oc-usage"
   ```

2. **重启 DSH Web**，插件自动加载。

卸载同理：`dsh plugin --profile web remove dsh-xxx`。

## 目录结构

```
dsh-yzlin499-easy-plugins/
├── README.md
├── AGENTS.md            # 给 AI 编码代理的项目说明
├── Docs/                # 知识库（参考、安装）
│   ├── 参考.md           # 官方文档与生态链接
│   └── Install.md       # 安装/卸载详细说明
├── LICENSE              # MIT
├── package.json         # 仓库元信息
└── dsh-*/               # 每个插件包（bundle）
    ├── package.json
    ├── cordis.patch.yml
    ├── index.js
    ├── client.js (可选)
    └── README.md / README_EN.md
```

## 贡献

欢迎提交插件或改进：每个插件包自包含、互不依赖；根目录文档与插件一并维护。

## License

[MIT](LICENSE) © 殷泽凌 (yzlin499)
