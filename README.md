# dsh-yzlin499-easy-plugins

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.1.0--rc.6-blue)](https://github.com/deepseek-ai/DeepSeek-Harness)

个人 DSH 插件合集：一组即插即用的插件包（bundle），用 `dsh plugin` 一条命令安装，
DSH 启动自动加载、重启不丢。每个 `dsh-*/` 子目录都是一个标准插件包。

## 已包含插件

| 插件 | 用途 | 安装命令 |
|---|---|---|
| [dsh-oc-usage](dsh-oc-usage/README.md) | OpenCode 用量悬浮窗：右上角可拖拽悬浮窗，显示 opencode.ai Go 订阅 5h/7d/30d 用量 + 重置倒计时，5 分钟自动刷新 | `dsh plugin --profile web add ./dsh-oc-usage` |
| [dsh-mcp-compat](dsh-mcp-compat/README.md) | 标准 MCP 配置兼容：自动读取 `.mcp.json` / `opencode.json` / `.cursor/mcp.json` / `.codex/config.toml`（项目级 + 用户级），把每个 MCP 服务器挂载为 dsh-mcp-client 实例，工具以 `mcp__<名>__*` 出现 | `dsh plugin --profile web add ./dsh-mcp-compat` |
| [dsh-quick-file](dsh-quick-file/README.md) | @ 快速输入文件：输入框打 `@` 弹出工作区文件列表，回车/点击即把文件路径插入输入框（复用内置输入触发管道） | `dsh plugin --profile web add ./dsh-quick-file` |
| [dsh-yzlin499-plugins-manager](dsh-yzlin499-plugins-manager/README.md) | 插件管理：设置页列出本集合全部插件，一键启用/停用（走 dsh CLI，批量开关后重启生效）；只管理本项目插件 | `dsh plugin --profile web add ./dsh-yzlin499-plugins-manager` |
| [dsh-workspace-openmenu](dsh-workspace-openmenu/README.md) | 工作区快捷打开：会话头部右上角（session log 左侧）「打开为」按钮，二级菜单在工作区位置打开 pwsh / cmd / 资源管理器 / vscode | `dsh plugin --profile web add ./dsh-workspace-openmenu` |

> 点插件名可查看该插件的详细文档（README）。profile 名按你的 DSH 实例调整（例如 `web`），
> 安装/卸载详见 [Docs/Install.md](Docs/Install.md)。

## 快速开始

1. 克隆本仓库：

   ```powershell
   git clone https://github.com/yzlin499/dsh-yzlin499-easy-plugins.git
   cd dsh-yzlin499-easy-plugins
   ```

2. 安装插件。**建议先安装插件管理器**，之后在「设置 → 插件管理」面板里一键
   启用/停用本集合的全部插件；也可以按上方表格的安装命令逐个安装：

   ```powershell
   dsh plugin --profile web add ./dsh-yzlin499-plugins-manager
   ```

3. **重启 DSH Web**，插件自动加载。

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
