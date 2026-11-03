# 调研 C —— 外部生态与方案设计

> 主题：给 DSH 设置页「安装、启用和配置插件 → 发现」页加「已安装」优先排序 + 「哪些插件有更新」。
> 本文只做**外部生态调研 + 方案设计**，不涉及官方源码细节（由并行的 A/B 子 agent 负责 UI 侧与 Host 侧可行性）。
> 调研日期：2026-10-28（快照，数据与版本号均为当日实测）。
> 仓库：`dsh-yzlin499-easy-plugins`，安装形态：`dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-xxx"`（= pnpm git 子目录依赖）。

---

## 0. 结论先行（TL;DR）

1. **官方「发现」页的订阅索引确实存在，且是公开的 format-1 JSON，带 `version` / `commit` / `publishTimestamp` / `engines.dsh`** —— 也就是说"哪个插件有更新"所需的**远端版本信息在索引里现成就有**，不需要调 GitHub API。实测样本见 §2.1。
2. **GitHub 上已经有至少 2 个把这件事做出来的插件**：`dsh-plugin-gating-hub`（检测更新 + 一键更新 + 版本门控）和 `DSH-Plugins-Marketplace`（**已安装置顶** + 「已装 vX → vY」+ 索引五级降级分发）。用户想要的交互，社区版已经跑通，可直接抄交互、不必抄实现。
3. **但它们的版本检测只对「npm 发布的包」有效**。我们这个仓库**不发 npm**，走 GitHub git 子目录，`npm dist-tags.latest` 这条路在我们身上**不通**。我们只能用 **commit 对比**，这一点两家都明确写了"git 源不支持/排除"（见 §2.2）。
4. **CLI 侧结论（实测）**：`dsh plugin` 只是把参数**原样转发给 pnpm**，**没有 `update` / `upgrade` / `outdated` 子命令**；`pnpm outdated` 对 git 依赖给不出 Latest；`pnpm update` **不会**移动 git 依赖的提交。**唯一可行的升级动作 = 用同一个 spec 重新 `add`**（已实测：会把锁定 commit 从旧 sha 顶到最新 sha）。
5. **数据源结论（实测）**：`pnpm-lock.yaml` 里记着安装时的**完整 commit sha**（`...tar.gz/<sha>#path:/dsh-x`），这是"本地版本"最可靠的锚点；本机 profile 的 `link:` 依赖则退化为读源目录 `package.json` + 本地 `git log`。
6. **推荐形态**：**先 c（host 侧只读清单，1 天可交付）→ 再做 b（我们自己的并列面板/tab，不劫持官方 UI）→ a 只在官方明确给出可扩展 slot 时才考虑**。a 的风险在于「发现」页 chip 行没有公开契约，且会违反本仓库"只 insert 自己一行、绝不 patch 别人"的约定。
7. **强建议（低成本高收益）**：我们自己发布一份 format-1 索引（GitHub raw 静态托管即可，条目带 `&path:/dsh-xxx` + 完整 commit）。这样 (i) 用户可直接订阅到官方发现页，(ii) 更新检查降级为**一次 HTTP 请求**，(iii) 彻底绕开 GitHub API 限流（未认证实测只剩 35/60 次）。

---

## 1. 用户诉求拆解

| 诉求 | 本质问题 | 数据需求 |
|---|---|---|
| 「已安装」按钮，已安装排到最前 | 过滤 + 排序 | 本地已安装清单（包名 + 来源 spec） |
| 「哪些插件有更新」 | 本地版本 vs 远端版本比对 | 本地 commit/version + 远端最新 commit/version |
| 用户补一句"去 GitHub 找插件升级的相关插件" | 是否已有现成轮子 | 生态调研（§2） |

---

## 2. 外部生态调研

### 2.1 官方「发现」页索引是否存在、字段结构

**存在，而且不止一份。** 官方「发现」页支持「添加索引源」（setting 入口：实验性插件 → 自定义插件市场 → 发现 → 管理索引源）。社区侧已有多个可直接订阅的 format-1 索引。

实测抓取（2026-10-28）：

```bash
curl -sSL "https://bruc3van.com/dsh-plugins/index.json" -o idx.json
# -> 1,837,952 bytes, HTTP 200
```

顶层结构：

```json
{ "format": 1, "title": {...中英...}, "description": {...中英...}, "metadata": { "categories": {...} }, "plugins": [ ...1000 条... ] }
```

单条插件条目（**真实样本**，来自 `yjh051108/dsh-routing-suite`）：

```json
{
  "name": "@dsh-external/dsh-super-injector",
  "title": { "en": "DSH Super Injector", "zh": "DSH 超级模块注入器" },
  "description": { "en": "...", "zh": "..." },
  "homepage": "https://github.com/yjh051108/dsh-routing-suite",
  "repository": { "url": "https://github.com/yjh051108/dsh-routing-suite" },
  "metadata": {
    "category": "developer-tools",
    "keywords": ["dsh", "dsh-plugin", "..."],
    "labels": ["git", "stars-5000", "presets"],
    "sortKeys": { "stars": 7003, "repositoryUpdated": 1789773058 }
  },
  "versions": [
    {
      "version": "0.3.3",
      "publishTimestamp": 1789773057,
      "source": {
        "type": "git",
        "url": "https://github.com/yjh051108/dsh-routing-suite",
        "commit": "195273352f23bff7f9023ebe2ec0cdbdf9c98f10"
      },
      "engines": { "dsh": ">=0.0.1-rc <2" }
    }
  ]
}
```

**对我们最重要的一行：`versions[0].source.commit` 是完整 40 位 commit，`versions[0].version` 是包版本，`publishTimestamp` 是时间戳。** 这三个字段合起来 = 「远端最新版本」的权威来源。

另据索引生成方文档（[scripts/host-market/README.md](https://github.com/bruc3van/awesome-dsh-plugin/blob/main/scripts/host-market/README.md)）：

- Git 来源**支持 `&path:/目录`**（正是我们的安装形态）与完整 40 位 commit；索引只收录所选提交中的版本。
- 输出用固定的官方包 `@deepseek-ai/dsh-plugin-market-index@0.2.1-alpha.5` 做 schema 校验；兼容范围复用官方 `dshRange`（优先 `engines.dsh`，否则求 DSH peerDependencies 交集）。
- 分类/标签/排序键走官方 format-1 的 `metadata.categories / labels / sortKeys` 声明。

> **含义**：如果我们自己发一份索引，格式是公开可校验的，**且能表达"git 子目录 + 具体 commit"**。这是本项目最划算的基础设施投入。

相关入口：
- [bruc3van/awesome-dsh-plugin](https://github.com/bruc3van/awesome-dsh-plugin)（索引仓库，20667 条仓库，每日 CI）
- 索引本体：`https://bruc3van.com/dsh-plugins/index.json`
- 机器可读数据：`data/market.json`（≤1000 条 / ≤1MB，供下游市场消费）、`data/repositories.json`

### 2.2 GitHub 上已有的「DSH 插件市场 / 插件管理器 / 更新检查」类项目

按相关度排序，前两个**直接做完了用户想要的功能**。

#### ① [Noob-stupid/dsh-plugin-gating-hub](https://github.com/Noob-stupid/dsh-plugin-gating-hub)（原名 `dsh-plugin-hub`，npm 包 `@noob-stupid/dsh-plugin-console`）

定位：框架升级安全 + 插件版本门控 + 市场。**能力远超"更新检查"，是本次调研最强的参照物。**

可借鉴点：
- **UI 挂载方式**：入口挂在**官方插件管理页自己的插槽**（`plugins.bundle.config`，key = 包名）——"用的是官方容器与官方风格，不是 DOM 注入，官方更新也不怕"。这是「方案 a」可行性的**直接证据**。
- **版本检测数据源**：读 npm `dist-tags.latest`（走 curl 通道，"node 网络被拦时也能用"）。→ 对我们无效（我们不发 npm）。
- **静态索引零 GitHub API**：`marketplace/index.json` 经 jsDelivr CDN 分发 + 10 分钟宿主缓存，"终端用户**零 GitHub API 调用**"。
- **明确把非 registry 来源特殊处理**："bare version 只有在 registry 真的解析成功后才写回，否则物化为 `link:`"；"漂移（manifest vs lock）后台对账，但**排除 `link:` / `file:` / git 源**"。
- **`Known limitations` 原话**："Version detection works for npm-published packages; skill-type repos have no version concept." → **我们属于它明确不覆盖的情形**。
- 其他值得抄的工程细节：安装/更新任务留 `pending-restart.json`、`install-jobs.json`（最近 50 次，含请求版本 vs 落盘版本），"已安装未生效"跨宿主重启仍可见；市场富化限流"4 并发 / 同 URL 同一时刻 1 个 / 失败记忆 10 分钟 / 成功缓存 5 分钟"。

#### ② [bradeGithub/DSH-Plugins-Marketplace](https://github.com/bradeGithub/DSH-Plugins-Marketplace)

定位：自动索引 GitHub `dsh-plugin` topic 全部仓库，在设置页以卡片展示，支持一键安装、版本检测、自动更新。

**它的交互就是用户描述的那个交互**（README 原文）：

> 列表自动加载（**已安装置顶**，其余按 Star 排序）；卡片按钮：安装 / **更新（检测到新版本时出现）** / 已安装（灰色锁定）。
> 版本感知：已装版本与索引版本自动比对，不一致时按钮提示「**已装 vX → vY**」。

可借鉴点（**降级策略是本项目最该抄的部分**）：

> 静态索引（CI 生成）**多级降级分发**：Contents API → jsDelivr → raw → 内置索引 → 磁盘缓存；**10 分钟 TTL 内零请求，全失败才回退搜索 API**（未认证 10 次/分）。

其它：
- 已安装判定是"六段管线"（安装清单 → 托管目录启发式 → 本体识别 → profile 映射命中 → 脚本缓存 → 缓存包名映射回查），说明"判断某个市场条目是否已安装"在真实环境里**很脏**，不是简单的名字匹配。这对我们是重要警示。
- 版本检测只对含 `package.json` 的 cordis 插件生效；**skill / 预设 / 脚本类无版本概念**。
- 更新动作就是**重装**（README 明写 `dsh plugin --profile web install <repo>` 重装即更新）——与我们在 §3 实测的"同 spec 重新 add"完全一致。

#### ③ 其它相关项目

| 项目 | 相关能力 | 对我们的价值 |
|---|---|---|
| [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market) | 把市场做进 DSH：浏览、搜索、一键安装 | 交互参考 |
| [bruc3van/dsh-desktop-safe-market](https://github.com/bruc3van/dsh-desktop-safe-market) | 先审查再安装；消费 `market.json`；默认关闭、开启才联网 | "联网开关"设计参考 |
| [Nagi-ovo/dsh-find-plugins](https://github.com/Nagi-ovo/dsh-find-plugins) | 一个 Skill：让 DSH 自己搜索/安装/验证插件 | 说明"AI 代装"是另一条路线 |
| [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 开放侧边栏底座，支持三方注册新页面 | 「自建并列面板」的现成容器思路 |

> **结论**：**没有**一个现成插件能直接满足"我们的 git 子目录插件列表 + 已安装优先 + 可更新徽标"。现成方案全部建立在 npm registry 的版本语义上；但**交互形态、降级策略、官方 slot 挂载方式**都有成熟先例可抄。因此本项目仍需自研，规模不大。

### 2.3 参照物：同类"已安装 + 可更新"UI 的通用做法

| 参照物 | 数据来源 | 交互 | 对我们的启示 |
|---|---|---|---|
| **Claude Code plugin marketplace**（[plugin CLI 参考](https://code.claude.com/docs/en/plugins/cli-reference)） | 本地已装清单 + marketplace manifest 里的版本；`claude plugin marketplace update` 先从源"拉取新插件和新版本"，再由 `claude plugin` 子命令安装/更新 | 先刷新市场索引 → 再列出可更新项 → 显式升级 | **索引刷新与安装解耦**：检查更新是"读索引"，升级才是"跑 pnpm"。我们把两者分开，UI 才能秒开 |
| **VS Code 扩展** | 扩展市场服务端返回每个扩展的 latest version；客户端比对已装版本 | 扩展页「更新」按钮 + 徽标数字；可"全部更新" | 已有成熟"全部更新"心智，但**它是一次原子替换扩展目录**，我们是 pnpm 重装 + 需重启，风险不对等（见 §6） |
| **Homebrew `brew outdated`**（[man](https://linuxcommandlibrary.com/man/brew-outdated)、[FAQ](https://docs.brew.sh/FAQ)） | 本地 Cellar 里装的版本 vs formula/cask 上游 latest | 只读清单，`brew upgrade` 才动手；支持 `--json` 供脚本消费 | **最贴近我们的形态**：先做一个"只读 outdated 清单"（= 我们的方案 c），UI 后置；且 `--json` 输出对 Agent/工具友好 |

**共性结论**：所有成熟实现都是「**只读检查**」与「**写操作升级**」分离，检查结果带**三态**（可更新 / 已最新 / 未知），且检查结果来自**一次批量拉取的清单**而非逐包请求。这三点应直接落到我们的设计里。

---

## 3. 本机 CLI 实测（真实执行，原样贴输出）

> 环境：Windows，`dsh` 不在 bash PATH，实际入口是
> `C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`
> （一个 `ELECTRON_RUN_AS_NODE=1` 的 exe 包装脚本）。

### 3.1 `dsh --help`

```text
Usage: dsh [--profile] <name> [options] [app-args...]
       dsh plugin --profile <name> <pnpm-args...>

dsh: boot a DeepSeek Harness profile — an ordered stack of plugin-bundle patch
layers under your own overrides.

Options:
  -V, --version                  output the version number
  --profile <name>               the profile under $DSH_HOME/profiles to boot
  --from-default-profile <name>  replace a custom profile with a fresh copy of a
                                 shipped profile template
  --patch <path>                 extra patch-list overlay applied after the
                                 profile layer (repeatable)
  --dump-config / --dump-config-schema / --dump-default-config

Examples:
  dsh web                                   boot the web profile
  dsh plugin --profile tui add <package>    install a plugin into the tui profile
```

**没有任何 update/upgrade/outdated 相关顶层选项。**

### 3.2 `dsh plugin --help`

```text
Usage: dsh plugin [options] [args...]

manage a profile's plugins by forwarding the remaining arguments to pnpm in the
profile directory

Arguments:
  args              pnpm arguments, forwarded verbatim (add <pkg>, remove <pkg>,
                    why <pkg>, ...)

Options:
  --profile <name>  the profile whose plugins to manage (initialized on first
                    use)
  -h, --help        show this help
```

**结论：`dsh plugin` 是 pnpm 的透传壳。没有 `update` 子命令，能力上限 = pnpm 的能力。**
（注意 `-h/--help` 被 dsh 自己消费，拿不到 pnpm 的 help。）

### 3.3 `dsh plugin --profile web list`

```text
Legend: production dependency, optional only, dev only

dsh-profile-web C:\Users\Administrator\.dsh\profiles\web (PRIVATE)
│
│   dependencies:
├── @zhangzujian/dsh-same-mode-sandbox-noop@0.1.4
├── dsh-mcp-compat@link:D:/.../dsh-mcp-compat
├── dsh-quick-file@link:D:/.../dsh-quick-file
├── dsh-version-control@link:D:/.../dsh-version-control
├── dsh-win-notify@link:D:/.../dsh-win-notify
├── dsh-yzlin499-plugins-manager@link:D:/.../dsh-yzlin499-plugins-manager
└── hooks-adapter@link:E:/DSHPlugins/hooks-adapter

7 packages
Error: dsh: cannot resolve profile bundle "dsh-yzlin499-plugins-manager" from the dsh installation or C:\Users\Administrator\.dsh\profiles\web; run 'dsh plugin --profile web install' if its dependency is not installed
    at resolveBundleDir (.../dsh-app-boot/lib/index.js:1000:8)
    at bundleManifest (.../dsh-plugin-manager/lib/types/operations.js:84:24)
    at reconcile (.../dsh-plugin-manager/lib/types/operations.js:101:30)
    at runProfilePnpm (.../dsh-plugin-manager/lib/types/operations.js:559:27)
[exit code: 1]
```

**两个重要事实：**

1. `dsh plugin <anything>` 在跑完 pnpm 之后**还会执行 `reconcile`**（把 `package.json` 的 `dsh.profile.bundles` 与 node_modules 对齐）。所以它**不是纯读**命令。
2. **本机 profile 当前是"脏"的**：`dsh-yzlin499-plugins-manager` 和 `dsh-quick-file` 的 `link:` 目标目录已不存在（仓库里只剩 `dsh-ctx-menu / dsh-mcp-compat / dsh-version-control / dsh-win-notify`），导致 reconcile 直接抛错、**退出码 1**。

> **设计警示**：任何"更新检查"实现都**不能** shell 调 `dsh plugin list` 取数据——在这个 profile 上它会失败。必须直接读文件（§4）。

### 3.4 `pnpm outdated` —— 对 git 依赖无效（关键否定结论）

真实 profile（全是 `link:` + 一个 github tarball 依赖）：

```bash
cd ~/.dsh/profiles/web && pnpm outdated
# （无输出）exit 0
cd ~/.dsh/profiles/web && pnpm outdated --json
# {}
```

对照实验（`/tmp/locktest2`，pin 了一个旧 commit 的 git 子目录依赖）：

```text
┌────────────────┬──────────────────────────────────────────────────────────────────┬────────┐
│ Package        │ Current                                                          │ Latest │
├────────────────┼──────────────────────────────────────────────────────────────────┼────────┤
│ dsh-mcp-compat │ missing (wanted https://codeload.github.com/.../tar.gz/ee9899... )│        │
└────────────────┴──────────────────────────────────────────────────────────────────┴────────┘
```

**`Latest` 列是空的。** `pnpm outdated` 只会去 registry 问"有没有更新的语义版本"；对 git 依赖它**根本不知道"最新"是什么**。

> **结论：`brew outdated` 的等价物在 pnpm 里不存在。更新检查必须自己实现。**

### 3.5 「升级单个 git 子目录包」到底该用什么命令（两组对照实验）

**实验 1：`pnpm update` 不生效。**

```bash
cd /tmp/locktest2
pnpm add --lockfile-only "github:yzlin499/dsh-yzlin499-easy-plugins#ee9899...&path:/dsh-mcp-compat"
# -> version: .../tar.gz/ee9899584b...  （旧）
pnpm update dsh-mcp-compat --lockfile-only
# -> Done in 1.4s
# -> version: .../tar.gz/ee9899584b...  （仍然是旧 sha，未移动）
```

**实验 2：同一个 spec 重新 `add` 会顶到最新 commit。** ✅

```bash
cd /tmp/locktest2
# 起点：已 pin 在旧 commit ee9899...
pnpm add --lockfile-only "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-mcp-compat"
# -> version: .../tar.gz/b7ade84c24cc...  （顶到了当前 main HEAD）
# specifier 回到: github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-mcp-compat
```

**实验 3：锁文件记录了完整 commit（这就是"本地版本"的锚点）。**

```bash
cd /tmp/locktest && pnpm add --lockfile-only "github:yzlin499/...#path:/dsh-mcp-compat"
```

```yaml
importers:
  .:
    dependencies:
      dsh-mcp-compat:
        specifier: github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-mcp-compat
        version: https://codeload.github.com/yzlin499/dsh-yzlin499-easy-plugins/tar.gz/b7ade84c24cc3699600dff988b031dde4b8c0984#path:/dsh-mcp-compat
packages:
  dsh-mcp-compat@https://codeload.github.com/...#path:/dsh-mcp-compat:
    resolution: {path: /dsh-mcp-compat, tarball: https://codeload.github.com/.../tar.gz/b7ade84c...}
    version: 0.8.1
```

**最终升级命令（单包）：**

```bash
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-mcp-compat"
```

即**幂等重装**。这跟 DSH-Plugins-Marketplace 的"重装即更新"是同一件事。
⚠️ 但它同样会触发 §3.3 的 reconcile；在脏 profile 上会先失败。UI 必须先做健康检查。
⚠️ 升级后**必须重启 DSH Web**，否则宿主里跑的还是旧代码。

### 3.6 GitHub API 通道实测

```bash
gh api repos/yzlin499/dsh-yzlin499-easy-plugins/commits/main \
  --jq '{sha:.sha, date:.commit.committer.date}'
# {"sha":"b7ade84c24cc3699600dff988b031dde4b8c0984","date":"2026-10-26T09:09:34Z"}

gh api "repos/yzlin499/dsh-yzlin499-easy-plugins/commits?path=dsh-mcp-compat&per_page=1" \
  --jq '.[0] | {sha:.sha, date:.commit.committer.date}'
# {"sha":"ee9899584b4c3c6e25c054362ab3243dc4296c81","date":"2026-10-18T08:30:57Z"}
```

判定"是否有更新"的正确姿势 —— `compare` 语义已实测：

```bash
# base=已装 sha, head=子目录最后改动 sha
gh api ".../compare/b7ade84c...ee98995" --jq '{status,ahead_by,behind_by}'
# {"ahead_by":0,"behind_by":5,"total_commits":0}   status=behind
# 反转方向
gh api ".../compare/ee98995...b7ade84c" --jq '{status,ahead_by,behind_by}'
# {"ahead_by":5,"behind_by":0}                     status=ahead
```

→ **判据：`compare(已装sha, 远端目标sha).behind_by > 0` ⇒ 有更新；`== 0` ⇒ 已最新。**
（注意：`commits?path=` 返回的是"最后改动该子目录的 commit"，它往往**早于**当前已装 commit，所以**不能用 `子目录commit != 已装commit` 直接判可更新**，会误报。必须用 compare 的 behind_by。）

**限流（真实数字）：**

```text
gh api rate_limit            -> authenticated: {limit:5000, used:12, remaining:4988}
curl api.github.com/rate_limit -> unauthenticated: {limit:60, used:25, remaining:35}
```

未认证只剩 35 次 → **逐包请求 GitHub API 的方案在真实用户机器上必然打爆**。必须索引优先 + 缓存。

### 3.7 TLS 坑（Windows）

```bash
curl -sS "https://raw.githubusercontent.com/.../dsh-mcp-compat/package.json"
# curl: (35) schannel: ... CRYPT_E_REVOCATION_OFFLINE
curl -sS --ssl-no-revoke "https://raw.githubusercontent.com/..."
# HTTP 200 {"name":"dsh-mcp-compat","version":"0.8.1",...}
```

→ 本机 curl 的吊销检查离线会直接掐 TLS。**凡是走 curl 的降级通道都必须带 `--ssl-no-revoke`**（gating-hub 用 curl 做 npm 通道，应该也踩过这个坑）。Node 的 `fetch` 不受 schannel 影响，是更稳的选择。

---

## 4. 数据获取方案

### 4.1 本地已安装数据（无需网络）

profile 目录：`C:\Users\Administrator\.dsh\profiles\web\`

| 字段 | 来源 | 备注 |
|---|---|---|
| 已安装包名清单 | `package.json` → `dependencies` 的 key | 也含 `dsh.profile.bundles`（挂载顺序），两者可能不一致（本机就有 2 个悬空） |
| 安装形态 | `dependencies[<pkg>]` 的 spec 前缀：`link:` / `github:` / `file:` / 裸版本号 | **决定后续能不能判远端版本** |
| 包版本号 | `node_modules/<pkg>/package.json` 的 `version` | git 安装是解包实体；`link:` 直接指向源目录（真实为本地工作副本） |
| **安装 commit**（git 源） | `pnpm-lock.yaml` → `importers..dependencies.<pkg>.version` 里的 `tar.gz/<sha>`，兜底看 `packages` 段 `resolution.tarball` | 实测 40 位完整 sha，**最可靠的版本锚点** |
| 安装 commit（`link:` 源） | 在链接目标目录跑 `git log -1 --format=%H` + 读 `package.json` | 纯本地，无网络；**这类应标"本地开发目录"，不参与"可更新"** |
| profile 健康度 | 每个 `link:` 目标目录是否存在 | 本机 2 个悬空 → 应先提示用户修复，再谈更新 |

**不要**用 `dsh plugin list` 作为数据源（§3.3 实测 exit 1）。直接读 `package.json` + `pnpm-lock.yaml` + `node_modules/*/package.json` 即可，全部只读、毫秒级。

### 4.2 远端最新版本

按**成本从低到高**排优先级（每一级失败才降级）：

| 级 | 数据源 | 覆盖范围 | 成本 | 备注 |
|---|---|---|---|---|
| **①** | **我们自己的 format-1 索引**（静态 JSON，GitHub raw / jsDelivr 托管） | 我们仓库的 4 个插件 | 1 次 HTTP / 全量 | 条目里直接给 `version` + `source.commit` + `publishTimestamp`；**零 API 配额**。强烈建议做（§5.4） |
| ② | 用户已订阅的官方/社区索引（如 `bruc3van.com/dsh-plugins/index.json`，1.8 MB） | 已收录的第三方插件 | 1 次 HTTP，10 分钟 TTL | 用来覆盖"用户装的别人的插件"，不用逐包请求 |
| ③ | `raw.githubusercontent.com/<o>/<r>/main/<sub>/package.json` | 任意 git 子目录 | 1 次 HTTP / 包 | 只拿 `version`，拿不到 commit 进度；必须 `--ssl-no-revoke` 或用 Node fetch |
| ④ | GitHub API `compare(已装sha, main)` → `behind_by` | 任意 git 源 | 1 次 / 包，**计入配额** | 最精确；仅在 ①②③ 都判不出来时用 |
| ⑤ | 本地磁盘缓存（TTL 10 分钟 ~ 6 小时）+ 显示"未知" | 全部 | 0 | 离线兜底 |

**精确度排序**：④（commit 前后关系）> ①（索引里的 commit）> ③（只比 version 字符串）> ②（索引版本）。
**为什么 ③ 只做辅助**：我们 4 个插件里 `version` 不一定每次提交都 bump（`ee98995` → `b7ade84` 之间 5 个 commit，`dsh-mcp-compat` 的 version 仍是 `0.8.1`）。**只看 version 会漏报，必须看 commit。**

### 4.3 降级 / 离线策略（直接照抄 DSH-Plugins-Marketplace 的五级）

```
索引 JSON → jsDelivr 镜像 → raw.githubusercontent.com → GitHub API → 磁盘缓存 → "未知"
```

配套硬性约束（照抄 gating-hub 的运营参数）：

- 全局限流：**4 并发**、同 URL 同一时刻只允许 1 个在飞。
- 缓存：**成功 5 分钟 / 失败记忆 10 分钟**；连续失败则整体降级为"未知"，不再重试。
- **10 分钟 TTL 内零网络请求**（打开面板秒开）。
- 全部通道失败时，UI 显示「未知」而**不是**「已最新」——这条是两家都强调的诚实性边界。
- 提供「手动刷新」按钮强制绕过 TTL（对应官方发现页已有的"刷新"）。

---

## 5. 方案设计（3 选 1 + 推荐排序）

### 5.1 对比表

| 维度 | **a) 官方发现页内追加「已安装」chip + 更新徽标** | **b) 自建并列面板「已安装 & 更新」** | **c) 纯 host 侧只读清单（Tool/命令 `plugin://outdated`）** |
|---|---|---|---|
| 实现难度 | 高：需要官方「发现」页 chip 行/卡片有可扩展 slot | 中：独立 settings 页/tab + 自己的数据路由 | **低：一个 host 服务 + 一个 Tool**，1 天可交付 |
| 依赖的官方接口 | 「发现」页的 slot（**未验证**；`plugins.bundle.config` 这类 slot 在"插件管理页"上已被 gating-hub 验证可用，但"发现"页是另一个页面） | 官方 settings 页注册（本仓库 `dsh-win-notify` / `dsh-mcp-compat` 已有 settings 卡片先例） | 仅 host 侧 `ctx`（Tool 注册 / 路由），零 UI 依赖 |
| 用户操作路径 | 最顺：就在他已经看的地方，点一下「已安装」筛掉未安装的 | 设置里多一个并列标签页；需先教会用户去哪找 | 无 UI；只能"问 AI：我的插件有没有更新" |
| 是否劫持官方 UI | **是**（有版本漂移即碎的风险） | 否 | 否 |
| 与仓库约定的一致性 | **冲突**（AGENTS.md：「只 insert 自己一行，绝不 patch 别人的行」） | 一致 | 一致 |
| 风险 | **高**：官方发现页结构无公开契约；DSH 升级即可能失效；本仓库 `dsh-ctx-menu/scripts/check.mjs` 那种哨兵得为它再加一套 | 低：自己的 UI 自己控；数据源与 a 完全复用 | 极低 |
| 可否作为其它方案底座 | 否 | 是（可直接消费 c 的清单） | — |
| 工期粗估 | 3–5 天 + 持续的版本维护成本 | 2–3 天 | 0.5–1 天 |

### 5.2 推荐排序与理由

**推荐：c → b →（a 仅在官方明确给出「发现」页 slot 后再评估）**

1. **第一步做 c（必做，且是 b 的基座）。**
   host 侧注册一个只读能力：读 §4.1 的本地数据 + §4.2 的远端比对，输出结构化 JSON（`{name, installed:{version,commit,sourceType}, remote:{version,commit}, status: 'outdated'|'latest'|'unknown'|'local-dev', deltaCommits}`）。
   同时暴露成 Tool（模型可调）+ HTTP 路由（UI 可调）。**立刻可交付、可测试、零 UI 风险**，也对应 `brew outdated` 那种"先有只读清单"的最小正确形态。
   ⚠️ 必须容错本机这种脏 profile（悬空 `link:`），不能因为一个坏条目整体失败。

2. **第二步做 b（用户真正想要的界面）。**
   我们自己的 client 插件，在设置页加一个并列 tab「已安装 & 更新」，完全消费 c 的数据。**不碰官方「发现」页的 DOM/结构**，官方怎么升级都不会碎。可复用本仓库既有模式：`dsh-version-control`（官方 `ui-sidebar-right` slot + `ctx.locale` + `--dsw-alias-*` 主题变量）、`dsh-win-notify`（设置卡片）。

3. **a 暂不推荐。**
   唯一的正面证据是 gating-hub 挂了官方"插件管理页"的 `plugins.bundle.config` slot 成功。但用户要的是**「发现」页**——另一个页面，其 chip 行/卡片是否有 slot，本文没有证据，需要 B 的结论。**若 B 证实「发现」页存在稳定 slot，则 a 可以退化为"给 b 加一个入口"，而不是重写官方页。** 绝不要用 DOM 注入去改造官方发现页：那是本仓库 `dsh-ctx-menu/scripts/check.mjs` 哨兵存在的理由（官方升级即静默失效）。

> 如果 main agent 只想要"最小可用"：**只做 c + 在官方发现页不动**，用户问 AI 即可得到答案。如果要做 UI，**b 是唯一安全形态**。

### 5.3 三个方案的数据流（同一个后端，不同呈现）

```
[本地] profile/package.json + pnpm-lock.yaml + node_modules/*/package.json
                                    │
                                    ├─ link: → 读源目录 package.json + git log -1  → status = local-dev
                                    └─ git:  → 锁文件里的 sha                    → 进入远端比对
[远端] ①自有索引 → ②订阅索引 → ③raw package.json → ④GitHub compare → ⑤缓存
                                    │
                            status ∈ {outdated, latest, unknown, local-dev}
                                    │
                    ┌───────────────┼────────────────┐
                  c: Tool/JSON   b: 自有面板        a: 官方页徽标（若 slot 存在）
```

### 5.4 附带建议：给我们仓库发一份 format-1 索引（性价比最高的一步）

我们只有 4 个插件，但索引能同时解决三件事：官方发现页可直接订阅我们、更新检查变成一次 HTTP、彻底绕开 GitHub API 配额。

最小可用形态（按 §2.1 实测字段编写，托管在 GitHub raw 或 jsDelivr 即可）：

```json
{
  "format": 1,
  "title": { "zh": "Easy Plugins", "en": "Easy Plugins" },
  "description": { "zh": "...", "en": "..." },
  "metadata": { "categories": { "tools": { "title": { "zh": "工具", "en": "Tools" } } } },
  "plugins": [
    {
      "name": "dsh-mcp-compat",
      "title": { "zh": "MCP 兼容", "en": "MCP Compat" },
      "homepage": "https://github.com/yzlin499/dsh-yzlin499-easy-plugins",
      "repository": { "url": "https://github.com/yzlin499/dsh-yzlin499-easy-plugins" },
      "metadata": { "category": "tools", "labels": ["git"] },
      "versions": [
        {
          "version": "0.8.1",
          "publishTimestamp": 1766420000,
          "source": {
            "type": "git",
            "url": "https://github.com/yzlin499/dsh-yzlin499-easy-plugins",
            "commit": "b7ade84c24cc3699600dff988b031dde4b8c0984",
            "path": "/dsh-mcp-compat"
          },
          "engines": { "dsh": ">=0.2.1-rc <2" }
        }
      ]
    }
  ]
}
```

> 注：`source.path` 的二级字段名请以官方 `@deepseek-ai/dsh-plugin-market-index@0.2.1-alpha.5` 的 schema 为准（本文档据索引生成方文档写的是支持 `&path:/目录` 的 git 目标，字段级写法需 B/官方 schema 核对）。可用索引生成方的校验器验证后再发布。
> 生成方式建议做成 CI（每次 push main 自动刷新 commit 与 version），避免手写漂移。

---

## 6. 交互细节建议

### 6.1 排序

- **主键：已安装优先**。用户原话就是"把已安装的网络插件排到最前"。
- 建议用**稳定分区**而不是重排：`partition(已安装)` 后再保持官方原排序（Star / 索引顺序），这样"已安装组内部"的顺序仍然是用户熟悉的，且来回切 chip 不会跳。
- chip 建议三档而非两档：「全部 / 已安装 / **可更新**」。第三档是用户真正想点的那一下（"哪些插件有更新"）。**「可更新」chip 上带数字徽标**（如 `可更新 2`），这是零成本的信息增益。
- 已安装条目即使被 chip 过滤掉，卡片的「已安装」灰按钮保留（和 DSH-Plugins-Marketplace 一致）。

### 6.2 更新徽标（三态 + 一特殊态）

| 状态 | 文案 | 判定 |
|---|---|---|
| 可更新 | `已装 v0.8.1 → v0.8.2` 或 `落后 N 个提交` / `已装 b7ade84 → 新 ee98995` | compare 的 `behind_by > 0`，或索引 commit ≠ 已装 commit |
| 已最新 | `已最新`（灰、无按钮） | `behind_by == 0` |
| **未知** | `未知（检查失败）` + 重试入口 | 所有远端通道失败 / 该插件不在任何索引 / 无 repository 信息 |
| 本地开发 | `本地目录` 徽标，**不给更新按钮** | `link:` 来源 |
| 不兼容 | `需 DSH ≥ x` 警示（只提示，不拦） | 索引里的 `engines.dsh` 与当前宿主不符（参考 gating-hub 的版本门控） |

**红线**：**绝不把"检查失败"显示成"已最新"**。两家成熟实现都把这当成诚信边界。

### 6.3 「全部更新」批量操作值不值得做？

**建议：v1 不做，v2 做受限版。** 理由都来自实测：

1. **升级 = 重装 = 重新拉 git + reconcile**，一次一个包就是一整轮 pnpm 动作；本机 `dsh plugin list` 因为 2 个悬空 `link:` 直接 exit 1，**批量会让"半坏状态"一次性放大到全部插件**，这是最坏的用户体验。
2. 每个包都需要**重启 DSH**才生效；批量更新后一次性重启听起来更好，但若其中一个包把宿主搞挂，用户**无法定位是哪个**。
3. 用户机器上 `link:`（本地开发目录）不应出现在批量更新里。

**受限版的设计**（若要做）：逐条**串行**、每条显示独立结果、任何一条失败即**中止后续**；执行前跳过所有 `link:` 条目与"未知"条目；执行前写一份 `pending-restart.json`（照抄 gating-hub：装好但未加载的插件在宿主重启后仍显示"已安装 · 重启后生效"）；更新前后各留一条 `install-jobs.json`（请求版本 vs 落盘版本），失败可解释。
**更稳妥的折中**：只提供「一键更新**我们的**插件」（4 个，同仓同 spec，风险可控），第三方插件仍逐条手动。

### 6.4 其它细节

- **检查更新与执行更新分离**：面板打开时只读缓存（10 分钟 TTL 内零请求），「检查更新」是显式动作；「更新」按钮才跑 pnpm。照 Claude Code / brew 的心智。
- **健康检查前置**：面板顶部若检测到悬空 `link:` 或 reconcile 会失败的条目，先提示"先修复 profile"，否则任何更新动作都会失败（本机现成的反例）。
- **中英双语 + 主题**：按仓库约定走 `ctx.locale` 与 `--dsw-alias-*`，深色模式用 `body[data-ds-dark-theme]` 覆盖。
- **`dshbase` / 索引同名冲突**：DSH-Plugins-Marketplace 的"六段已安装判定"说明"同名不同源"是真实存在的坑；我们至少要用 `包名 + repository.url` 双向校验，不能只比包名。

---

## 7. 风险与未决问题

| # | 风险 / 未决 | 影响 | 缓解 |
|---|---|---|---|
| 1 | 「发现」页是否有可扩展 slot（决定方案 a 是否成立） | a 的可行性 | **待 B 结论**；a 不作为主线 |
| 2 | 本机 profile 已脏（2 个悬空 `link:`，`dsh plugin` exit 1） | 任何更新动作会失败 | UI 前置健康检查；检查功能本身不得依赖 `dsh plugin` |
| 3 | GitHub 未认证配额仅 60/h（实测剩 35） | 逐包 API 方案在真实机器上必炸 | 索引优先 + 5 分钟缓存 + 4 并发 + 失败记忆 |
| 4 | Windows curl 的 schannel 吊销检查离线会掐 TLS | 降级通道失效 | 统一用 Node `fetch`；必须用 curl 时加 `--ssl-no-revoke` |
| 5 | 我们不发 npm → `dist-tags.latest` 路线不可用 | 无法照抄现有插件的检测实现 | 用 **commit compare**；长期发自有 format-1 索引 |
| 6 | 只比 `version` 会漏报（5 个 commit 后仍是 `0.8.1`） | 用户看不到更新 | 必须比 commit；UI 文案给"落后 N 个提交" |
| 7 | 升级后不重启 = 旧代码继续跑 | 用户以为更新失败 | 明确提示重启；记录"待重启"状态 |
| 8 | 批量更新可能把宿主一次搞挂 | 不可恢复 | v1 不做全量批量（§6.3） |

---

## 8. 外部链接清单

**索引 / 生态**
- [bruc3van/awesome-dsh-plugin](https://github.com/bruc3van/awesome-dsh-plugin) —— 社区最大索引（20667 仓库）
- 索引本体：`https://bruc3van.com/dsh-plugins/index.json`
- [索引生成/校验说明（format-1）](https://github.com/bruc3van/awesome-dsh-plugin/blob/main/scripts/host-market/README.md)
- [官方仓库 deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)

**已有实现（最强参照物）**
- [Noob-stupid/dsh-plugin-gating-hub](https://github.com/Noob-stupid/dsh-plugin-gating-hub)（npm `@noob-stupid/dsh-plugin-console`）
- [bradeGithub/DSH-Plugins-Marketplace](https://github.com/bradeGithub/DSH-Plugins-Marketplace)
- [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market)
- [bruc3van/dsh-desktop-safe-market](https://github.com/bruc3van/dsh-desktop-safe-market)
- [Nagi-ovo/dsh-find-plugins](https://github.com/Nagi-ovo/dsh-find-plugins)

**同类交互参照**
- [Claude Code plugin CLI 参考](https://code.claude.com/docs/en/plugins/cli-reference)（`claude plugin marketplace update` 先从源拉取新插件与版本）
- [Claude Code 插件安装与管理](https://code.claude.com/docs/en/plugins/install)
- [brew outdated man](https://linuxcommandlibrary.com/man/brew-outdated) · [Homebrew FAQ](https://docs.brew.sh/FAQ)

---

## 附：本次实测命令与产物路径

| 实验 | 路径 | 结论 |
|---|---|---|
| 索引结构与字段 | `/tmp/idx.json`（1.8 MB） | format-1，`versions[].{version,publishTimestamp,source.commit,engines.dsh}` |
| git 子目录 spec 的锁文件记录 | `/tmp/locktest/pnpm-lock.yaml` | 记录完整 commit + `path` + 包自身 version |
| 「同 spec 重装 = 升级」 | `/tmp/locktest2/pnpm-lock.yaml` | `ee9899…` → `b7ade84…` ✅ |
| 「`pnpm update` 不生效」 | 同上 | sha 未移动 ❌ |
| 「`pnpm outdated` 无 Latest」 | 同上 + 真实 profile | `{}` / Latest 空 |
| compare 判据 | `gh api .../compare/...` | `behind_by>0` ⇒ 有更新 |
| 限流 | `gh api rate_limit` | 认证 5000/h，未认证 60/h（实测剩 35） |