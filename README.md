# dsh-yzlin499-easy-plugins

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.2-blue)](https://github.com/deepseek-ai/DeepSeek-Harness)

这里有你那个毛坯房 DSH 急需加进去的小功能。大功能你再找找，小功能我就先帮你做了一批了。

这里没有你要的功能？没事我想想，你也可以想想。

> 以下是 DS大肥鱼 自己写的推销词。
>
> 这些插件都是日常高频的小工具，而且每个包完全解耦：喜欢哪个装哪个，绝不捆绑全家桶。
> 无需克隆仓库，`dsh plugin` 一条 GitHub 直装命令，重启即生效。全部 MIT 开源，
> 代码随便看、随便改。用着顺手给个 Star，缺什么功能提个 Issue——我帮你想想。
>
> 做这批插件的过程，也是我一点点把 DSH 从毛坯房摸成顺手工具的过程，挺有成就感的。
> 希望它们也能让你用得更顺手。

## 插件一览

| 插件 | 用途 | 状态 |
|---|---|---|
| [dsh-mcp-compat](dsh-mcp-compat/README.md) | 标准 MCP 配置兼容：自动读取 `.mcp.json` / `opencode.json` / `.cursor/mcp.json` / `.codex/config.toml`（项目级 + 用户级），把每个 MCP 服务器挂载为 dsh-mcp-client 实例，工具以 `mcp__<名>__*` 出现 | 可用，偶有兼容问题 |
| [dsh-version-control](dsh-version-control/README.md) | 统一版本控制：接入官方 `ui-sidebar-right` 侧边栏，支持 Git 与 SVN 的变更、历史、差异、提交和更新 | 稳定 |
| [dsh-ctx-menu](dsh-ctx-menu/README.md) | 右键增强：侧栏行右键直接开官方菜单；正文文件行右键给出打开、打开方式、定位、复制、另存等动作 | 稳定 |
| [dsh-win-notify](dsh-win-notify/README.md) | Windows 原生吐司通知：权限申请 / 发起提问 / 运行停止时弹右下角通知，网页挂后台也能第一时间知道；支持仅后台通知模式 | 稳定 |

> 点插件名可查看该插件的详细文档（中文 `README.md` / 英文 `README_EN.md`）。

## 安装

无需克隆仓库，一行装一个（pnpm 的 `#path:/` 子目录语法直接定位插件包）：

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-mcp-compat"
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-version-control"
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-ctx-menu"
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-win-notify"
```

1. 按需执行上面对应的一行（`dsh-xxx` 换成表格里的插件目录名，`web` 换成你的 profile 名）。
2. **重启 DSH Web**，插件自动加载，重启不丢。
3. 卸载同理：`dsh plugin --profile web remove dsh-xxx`。

代理、`Ignored build scripts` 等安装问题，以及「本地开发时怎么联调」见
[Docs/Install.md](Docs/Install.md)。

## 已下线

官方陆续内置了同类能力，下面这些插件已不再维护、并从仓库移除：

| 插件 | 原用途 |
|---|---|
| `dsh-workspace-auto-approval` | 工作区自动审批的第四种权限模式 |
| `dsh-quick-file` | 官方 @ 文件搜索的 Everything 后端 |
| `dsh-yzlin499-plugins-manager` | 设置页里的插件管理卡片 |

> 之前装过的话，记得 `dsh plugin --profile web remove <插件名>` 再重启 DSH，
> 否则挂载清单会指向已失效的目录。（更早删除的 `dsh-oc-usage`、`dsh-workspace-openmenu` 同理。）

## 插件开发

- 动手前先读 [AGENTS.md](AGENTS.md)：插件包契约、生命周期、locale / theme / settings 规范都在里面。
- 知识库索引见 [Docs/README.md](Docs/README.md)：安装卸载、设置持久化、各插件的需求 / 调研 / 设计文档。
- 每个插件包自包含、互不依赖；根目录文档与插件一并维护。

## 目录结构

```
dsh-yzlin499-easy-plugins/
├── README.md                   # 本文件（面向使用者）
├── AGENTS.md                   # 面向 AI 代理 / 开发者的项目约定
├── LICENSE                     # MIT
├── package.json                # 仓库元信息（private，禁止发布）
├── Docs/                       # 知识库
│   ├── README.md               # 知识库索引
│   ├── Install.md              # 安装 / 卸载
│   ├── Settings.md             # 插件设置持久化（settings）读写指南
│   ├── 参考.md                  # 官方文档与生态链接
│   ├── ctx-menu/               # dsh-ctx-menu 的需求 / 调研 / 设计
│   └── codex-import/           # Codex 会话导入调研
└── dsh-*/                      # 每个插件包（bundle），目录即包
    ├── package.json            # 含 dsh.bundle.patch 声明
    ├── cordis.patch.yml        # 挂载行声明（insert）
    ├── index.js                # Host 半侧（ESM）
    ├── client.js               # Client 半侧（可选）
    ├── README.md / README_EN.md # 插件文档（中 / 英）
    └── test/                   # node --test 测试（可选）
```

## License

[MIT](LICENSE) © 殷泽凌 (yzlin499)
