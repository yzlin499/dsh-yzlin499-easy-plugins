# 调研 F：市场类插件全扫与「已安装 + 可更新 + 一键升级」能力排序

> 调研日期：2026-10-28 ｜ 调研方式：**只读**（node fetch 官方索引 + npm registry + npm tarball 解包读源码 + `gh api` 取 star），未安装任何插件、未改仓库源码、未改 `~/.dsh/profiles/desktop`。
> 数据快照：官方索引 `dsh-plugin-catalog/index.json`（format 1，**3730** 条，其中 `metadata.category === "market"` **58** 条）；npm 周下载 `api.npmjs.org/downloads/point/last-week`；star 经 `gh api repos/<owner>/<repo>`（已认证，绕开未认证 60 次/小时限制，58 个仓库全查）。
> 用户环境：desktop profile，**13** 个依赖，DSH `0.2.1-rc.3`。
> 同组文档：`调研-D-99galaxy市场插件验真.md`、`调研-E-更新类插件验真.md` 对其中 4 款做过逐行验真，本报告做**广度扫描 + 横向量化排序**，深度结论直接引用 D/E，不重复论证。

---

## 0. 结论速览（给决策用的 6 句话）

1. **58 个 market 分类插件里，只有 20 个描述里同时出现「已安装清单 + 更新检测 + 一键升级」三件事；把三件事在源码里真正落实的共 13 个**（market 内 11 个 + market 外 2 个），其中 4 个的更新源只覆盖 npm。其余 38 个是「只装不管」「只管启停」「技能/专家/皮肤市场」「评测导购」「归档卸载」等，与用户诉求无关（附录 A 逐条标注）。
2. **「更新源覆盖」是唯一能把 20 个候选拉开档次的指标。** 用户 13 个依赖里横跨 4 种来源（7 npm / 1 `github:` git / 4 `link:` 本地 / 1 官方包），能否正确处理 git 与 link 决定了插件是否会**误报**或**漏报**。
3. **只有 3 个候选在源码里同时做了 npm + git 判定且排除 `link:`**：`dshmarket`、`dsh-plugin-install`、`dsh-plugin-diraud`（另 `dsh-plugin-manager-pro` 仅描述声称多源，未逐行验真）。这是第一梯队的技术门槛。
4. **`link:` 误报是这一轮的「生死线」**。绝大多数实现要么显式正则跳过（`@sueleven/dsh-auto-update`、`dsh-plugin-mgr`、`dsh-plugin-upgrader`、`dsh-plugin-install`、`dsh-m`），要么靠「同名同源校验」间接排除（`@max-null/dsh-plugin-center`）。后者有残余风险：**本机 4 个 `link:` 包里 `dsh-win-notify` 在 npm 上确实有同名包**（作者不同源），同源校验正确地排掉了它——但若哪天同源，就会给出一个「把符号链接替换成 registry 副本」的假升级。
5. **UX 与工程成熟度在这一类里是反向的**：唯一把入口做进**官方「插件」页原生 tab** 的是 `dsh-plugin-upgrader`（当天刚发布 1.3.0，1 star）；工程最扎实的是 `dshmarket`（9,347 star / 23 万周下载），但它自带一个 3 MB 的市场页，更新只是其中一栏。
6. **推荐组合：`dsh-plugin-upgrader`（UX 与源码种类判定最贴需求）+ `dsh-plugin-install`（唯一覆盖 git 更新检测）二选一或并用**；若只接受高采用率的成熟件，退守 `dshmarket`。三者都不需要任何市场服务器或账号。

---

## 1. 数据口径

| 指标 | 来源 | 说明 |
| --- | --- | --- |
| 版本 | `registry.npmjs.org/<pkg>/latest` | **以 npm latest 为准**；官方索引里的 `versions[].version` 普遍滞后（例：`dsh-plugin-upgrader` 索引记 1.0.2，npm 已 1.3.0） |
| 周下载 | `api.npmjs.org/downloads/point/last-week/<pkg>` | scoped 包整体 `encodeURIComponent`。该接口偶发返回 null（限流），已对全部 71 个包做 3~4 轮重试补全，仅 `@oxmumu3/dsh-plugin-finder` 仍无数据（预览版） |
| stars | `gh api repos/<owner>/<repo>` | 58 个 market 仓库全查（认证态，非 60/h 匿名额度）。`zoahdev/dsh-subscribe`、`VibeDev-Si/dsh-ecosystem` 返回 404 → 仓库已不可访问（风险备注已记） |
| 三件事覆盖 | **描述 + tarball 源码双向核对** | 标注 `（描述）`= 仅描述声称未解包；`（实测）`= 解包读到了实现 |
| 更新源覆盖 | **读源码中的 source-kind 分类器与判据** | ✅=有真实判定；⚠=有判定但会退化/不全；⛔=不覆盖；括号内列出该判断的证据函数名 |

> 说明：`link:` 包在本机是 `ctx-menu` / `mcp-compat` / `win-notify` / `hooks-adapter` 四个符号链接目录；`github:` 只有 `dsh-svn-tools`（`github:zengweicheng666/dsh-svn-tools`，**spec 里没有 `#sha`**）。这个「无 pin 的 git spec」是区分真假 git 判定的试纸（见 `调研-E` §0.3 对 `dsh-m` 的分析）。

---

## 2. 排序表（20 个真正相关的候选，含 2 个非 market 分类）

> 排序 = 三件事完整度 × 更新源覆盖 × 与本机 13 依赖的匹配度，再参考采用率（周下载 / star）。market 之外的更新类插件用 `†` 标出。

| # | 插件名 | 版本 | 三件事覆盖 | 更新源覆盖 | 周下载 | stars | 一句话差异点 | 风险备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `dsh-plugin-upgrader` | 1.3.0 | 明确三件事 | npm ✅ git ⛔不误报 link ✅不误报 tarball ⛔ | 899 | 1 | 插件页新增原生「版本」标签：一键升级全部 / 勾选子集 + 任意版本回滚 | 当日发布、1 star；尚无社区审计 |
| 2 | `dshmarket` | 1.73.1 | 明确三件事 | npm ✅ github ✅自托管 git ✅ link ✅显式排除 | 231,348 | 9347 | 生态事实标准：更新源覆盖最全，git 走仓库 version + commit 双判 | 市场本体 3 MB，更新只是其中一栏；不在「插件」原生 tab 内 |
| 3 | `dsh-plugin-install` | 0.4.12 | 明确三件事 | npm ✅ github ✅（lockfile commit vs GitHub HEAD） link ✅排除 | 654 | 4 | 唯一把 `github:` git 依赖纳入更新检测的「安装/更新/卸载」页 | 入口是「安装」tab，非已装清单视角；无版本回滚 |
| 4 | `dsh-plugin-update-checker` † | 0.1.6 | 明确三件事 | npm ✅ git ⛔不覆盖 link ✅排除并链回源码 | 214 | 0 | 「检查更新」tab 最贴需求：一行一插件 + 更新按钮 + 运行时兼容性 | 只认 npm；0 star / 214 周下载，采用率极低 |
| 5 | `dsh-plugin-diraud` | 0.9.2 | 明确三件事 | npm ✅ git ✅（`ls-remote` sha / tag） link ✅排除（含 desktop asar 排除） | 170 | 3 | 按来源（官方/自装）分组已装清单 + 一键更新 | 9 月后未再 push；无回滚；无「更新全部」 |
| 6 | `dsh-plugin-mgr` | 0.2.12 | 明确三件事 | npm ✅ git ⛔只给仓库链接 link ✅排除 | 735 | 3 | 卡片式插件管理：profile 补丁层启停 + npm 更新 + 一键更新 | 仅 npm 源参与更新判定 |
| 7 | `dsh-m` | 0.10.23 | 明确三件事 | npm ✅ git ⚠有 sha 判定但无 `#sha` 的 spec 恒报可升级 link ✅排除 | 9,144 | 25 | 4000+ 目录 + 8 个 agent 工具 + 独立 `dshm` CLI，能力最强 | 1.5 万行全家桶，必须打开自己面板才看得见；见 `调研-E` |
| 8 | `dsh-plugin-autoupdate` | 0.3.2 | 明确三件事 | npm ✅（委派 `dsh plugin update`） git ⚠交给 pnpm link ⚠无显式排除 | 199 | 0 | 把版本决策交还 dsh CLI，受 pnpm 发布年龄策略约束；快照可回滚 | 依赖 pnpm `wanted` 语义，跨主版本需人工勾 `--latest` |
| 9 | `@99galaxy/dsh-plugin-market` | 1.2.0 | 明确三件事 | npm ⚠用 awesome 目录 version 比对，非 registry 实时 git ⛔无 commit 比对 link ⚠无显式排除 | 471 | 0 | 目录/已安装/有更新 三 tab，并把「无法判断」单独计数 | 见 `调研-D`：desktop profile 环境假设不匹配；无 git 覆盖 |
| 10 | `dsh-mall` | 1.8.6 | 明确三件事 | npm ✅ git ⚠仅认 `#semver` 形式 link ✅排除 | 200 | 10 | 每日 03:30 自动批量更新 + 评分雷达图 + AI 装前审查 | 解包 26 MB；git 无 semver 时**静默漏报** |
| 11 | `@max-null/dsh-plugin-center` | 0.4.6 | 明确三件事 | npm ✅ git ⛔只查 npm latest link ⚠靠「同名同源」间接排除 | 254 | 1 | 带启动更新日志弹窗 + LLM 辅助更新流程 | 会调 LLM 服务；`UPDATABLE` 集合含 `local`，靠同源校验兜底 |
| 12 | `@sueleven/dsh-auto-update` | 1.0.1 | 明确三件事 | npm ✅ git ⛔显式跳过 link ✅显式跳过 | 502 | 0 | 启动后自动检查 + 右下角提示卡 + 全部更新，交互最轻 | 绕过 `pluginManager` 直接 spawn CLI；见 `调研-E` |
| 13 | `dsh-update-checker` † | 1.7.3 | 明确三件事 | npm ✅ GitHub Release ✅（主程序为主） link ✅标记为本地链 | 1,574 | 20 | 把 DSH 主程序 + 插件一起管：备份/校验/失败回滚/看门狗重启 | 面向 0.1/0.2 早期版本，插件更新非其主战场 |
| 14 | `dsh-plugin-manager-pro` | 0.9.1 | 明确三件事 | npm ✅ 插件超市 ✅ GitHub ✅（描述明说多源） | 230 | 12 | 「救砖中心」：坏包隔离 + 启动前自检 + P2P 兜底 | 功能面过大；**仅描述声称，未逐行验真** |
| 15 | `dshmarket-update-helper` | 1.1.0 | 只提更新 | 仅 `dshmarket` 自身（npm） | 834 | 3 | 单一职责：核对 dshmarket 版本并在安装失败时恢复旧版 | **不是通用更新器**，只服务 dshmarket |
| 16 | `dsh-plugin-ops-bundle` | 0.20.6 | 只提更新 | npm ⚠升到指定目标版本时「预演」会跳过谁 | 1,065 | 0 | 不装更新，做升级前的静态体检与故障归因 | 是预演/体检，**不是更新执行器** |
| 17 | `dsh-unified-market` | 0.4.1 | 明确三件事（描述） | npm ✅ github ✅（三源聚合 + 白名单） | 376 | 2 | 面向 Desktop(EAC) 的统一市场，手动/批量/自动三档更新 | 未解包验真 |
| 18 | `@springbrand/dsh-plugin-marketplace` | 1.0.8 | 明确三件事（描述） | 未解包 | 258 | 9 | 可操作**任意** profile（web/headless）而不只是当前运行的那个 | 未解包验真；改动当前 profile 会自动重启 DSH |
| 19 | `dsh-research` | 0.4.4 | 明确三件事（描述） | 未解包（自有目录，只发一个请求） | 749 | 10 | 科研垂直市场：钉住审读过的版本 + 面板内重启 | 垂直场景，非通用 |
| 20 | `dsh-plugin-console` | 0.3.2 | 明确三件事（描述） | 未解包 | 224 | 1 | 验证后安装/更新 + 删除 + 暂停恢复 + 安全 README 预览 | 9 月后未再 push |

**被排除的 3 个常见误解**：

- `dsh-extension-hub`（301/周）：描述里的「一起更新附属功能」指的是 **skills / MCP** 的附带功能更新，不是插件版本；解包里 `lib/plugins.mjs` 虽有 `updateNpmPackage` / `checkPluginUpdates`，但入口在它自己的扩展中心页面，且只服务它自己 clone 下来的 git 目录。**归为「只提安装」**。
- `@1e0zj/dsh-plugin-mall`（317/周）：描述有「更新检测」，但只作为安装流程的辅助，无「已装清单」视图。**归为「只提更新检测」**。
- `dsh-disable-unofficial-plugins`（233/周）：标题像管理，实质只做启用/停用，**从不卸载、不更新**（作者在描述里主动声明）。

---

## 3. 判定依据：三件事怎么算「真的有」

### 3.1 「已安装清单」的可信来源只有两条

| 方式 | 权威度 | 谁在用 |
| --- | --- | --- |
| `pluginManager` / `pluginInventory` 服务（官方运行时态） | 高——包含 `enabled`、`source`、`readOnlyReason` | `dsh-plugin-upgrader`（`BundleInfo.source`）、`@99galaxy`（快照 helper）、`dsh-m` |
| 直接读 `~/.dsh/profiles/<p>/package.json.dependencies` + `node_modules/<pkg>/package.json` | 中——不知道运行时启用态，但足够算版本 | `@sueleven`、`dsh-plugin-mgr`、`dsh-plugin-install`、`dsh-plugin-autoupdate`、`dsh-plugin-diraud` |

只要走第二条，就**必然**要自己处理 `link:` / `github:` / `file:` 三种非 registry spec——这就是为什么「已装清单」与「更新源覆盖」在这类插件里是同一个技术问题。

### 3.2 源代码种类分类器（各家实现对照，这是本报告的核心证据）

| 插件 | 分类函数 | 种类 | 关键行为 |
| --- | --- | --- | --- |
| `dsh-plugin-upgrader` | `sourceKind()`（`lib/host/bundle.js:17-32`） | `path` / `git` / `tarball` / `registry` / `unknown` | `path`：仍去 registry 取同名包展示版本历史，但 **`upgradable = false`**，注释明确「把 `link:` 换成 registry tarball 不是升级，是改变安装方式」；`git`：`versionError = "<kind> source: no registry history"`，不升 |
| `dsh-plugin-install` | `runUpdateCheck()`（`lib/index.js:8377-8415`） | `linked` / `github` / `npm` | `link:`/`file:` → `{kind:'linked', updateAvailable:false}`；`github:` → 比 **lockfile 记录的 commit vs GitHub HEAD**；其余比 npm latest |
| `dshmarket` | `updates.js` 三分支（`lib/updates.js:722-900`） | `linked` / `generation` / `github` / `npm` | `link:` 且是桌面版生产安装（`isGenerationLink`）→ 报但不提供升级（启动时宿主会按 `desired.json` 还原）；普通 `link:` → 不提供；git 支持 GitHub 与自托管（Gitea/GitLab），三种 lock 记录形态都读 |
| `dsh-plugin-diraud` | `classifyInstallSource()`（`lib/index.js:15196-15204`） | `registry` / `local` / `desktop` / `git` | 专门识别 `DeepSeek Harness Desktop\resources\app.asar.unpacked` 为 `desktop` 并排除；git 走 `git ls-remote` 比 sha / tag |
| `dsh-m` | `core/installed.js:27-34` | `link` / `github` / `npm` | 判定 `outdated = !inst.spec.includes(latestSha)`——**无 `#sha` 的 spec 恒为真**，本机 `dsh-svn-tools` 正好命中这个伪阳性 |
| `dsh-plugin-mgr` | `sourceTypeOf()`（`dist/http-*.js`） | `local` / `github` / `npm` | `collectUpdates()` 只筛 `sourceType === "npm"`，其余静默不查 |
| `@sueleven/dsh-auto-update` | `NON_REGISTRY_SPEC` 正则（`lib/update.mjs:236`） | 非 registry / registry | 一个正则否决 `file:|link:|portal:|workspace:|git+|git:|github:|https?:|ssh:` |
| `@max-null/dsh-plugin-center` | `sourceOf()`（`dist/update.js:713-728`） | `official`/`tarball`/`vendor`/`local-file` | `UPDATABLE = new Set(['installed','local'])` **包含 local**，靠 `isSameUpstream()` 判别是否排除 |

### 3.3 「一键升级」的落地方式（决定风险等级）

| 落地方式 | 谁 | 风险 |
| --- | --- | --- |
| 调官方 `pluginManager.installBundle()`（有事务、能读 `application` 区分热更/需重启） | `dsh-plugin-upgrader`、`dsh-m` | 低 |
| 跑官方 `dsh plugin add <pkg>@<ver>` CLI | `dsh-plugin-install`、`@sueleven`、`dsh-plugin-autoupdate`、`@99galaxy` | 中（进程外操作 profile） |
| 直接 `pnpm add -w` 改 profile | `@max-null/dsh-plugin-center` | 高（无事务/无回滚） |
| 自建下载 + 替换 `node_modules`（不走 pnpm） | `dsh-extension-hub` | 高 |

---

## 4. 前三推荐与理由

### 🥇 第一名：`dsh-plugin-upgrader@1.3.0`

**为什么是它**：用户的原始诉求是「在 **DSH 插件页** 快速看到哪些已安装插件有更新，并 **一键更新**」。它是唯一一个把这三件事做成官方「插件」页里**并列标签**（与「已安装」「发现」同级）的实现——不新增一个市场页面，不抢 Slot，用户不用换地方看。

- **三件事全齐**：已安装数量/可升级数量统计 → 一键升级全部 → 勾选子集升级 → 每个插件可展开全部历史版本并回滚到任意版。
- **源码种类判定最干净**：五分类 + 两条明确注释（`path` 永不可升、`git` 无 registry history）。对本机 13 依赖的预期输出是：7 个 npm 行显示「有更新」，`dsh-svn-tools` 显示「git source: no registry history」，4 个 `link:` 显示「local path install」，**零误报、零范围外动作**。
- **升级走官方服务**：`manager.installBundle()`，不是裸 pnpm，事务性最好。

**风险（必须告知）**：`1.3.0` 发布于**当天（2026-10-28）**，1 star、899 周下载，无社区审计，无降级保护声明，也没有 `minimum-release-age` 控制。建议先在非主力 profile 试一次再上 desktop。

### 🥈 第二名：`dshmarket@1.73.1`

**为什么是它**：如果优先级是「不能出错」而不是「界面不能换地方」，这是唯一无争议的选择。更新检测的工程完成度远超同类：npm / GitHub / 自托管 git（Gitea、GitLab）/ `link:` / 桌面版 generation-link 五路分流，git 侧同时比对「仓库自己的 version」与 commit（它自己写着：浮动安装光比 commit 会永远报有新版本，`#824`）；还带最小发布年龄策略、30 分钟 TTL 缓存、`isUpdatablePlugin()` 过滤「只是库不是插件」的直接依赖（`#793`）。

对你的环境最关键的一点：它**显式识别桌面版 `link:` 生产安装**（generation link），会说「有更新但这里不能升」，而不是让你点一个会在下次启动被还原的按钮。

**代价**：3 MB 市场页、四位数文件，是「市场」不是「升级器」；更新只是其中一个标签；9,347 star 也让它是被攻击/抢注关注度最高的目标。

### 🥉 第三名：`dsh-plugin-install@0.4.12`

**为什么是它**：它是这批里**唯一真正处理 `github:` 更新的实现**——不是跳过、不是比 package name 的 npm，而是读 lockfile 里记录的 commit 去和 `fetchGithubHead(repo)` 对比。你的 `dsh-svn-tools` 就是这种形态，因此**只有它能给你那一行真实的「有新版本」**。同时 `link:`/`file:` 明确归 `linked` 且 `updateAvailable:false`，带降级保护与装后版本核对。

**代价**：它的入口是「安装」tab（按 spec 装东西的视角），不是「已装清单一眼看更新」的视角；没有版本回滚；无「更新全部」的批量按钮。

> **保守替代**：如果你要「插件页内一行一插件 + 更新按钮 + 兼容性」这个最贴需求的信息布局，但可以接受「只覆盖 npm」，用第 4 名 `dsh-plugin-update-checker`——它甚至把 `link:` 的处理理由写进了源码注释，还做了 registry 逐级解析（env → profile → user → 镜像探测）。

---

## 5. 「描述了更新，但实际只支持 npm」——判断依据与清单

**统一判据（三条任一命中即归类）**：

1. 源码里有一条正则 / 集合把非 npm spec 提前否决（`NON_REGISTRY_SPEC`、`sourceType === 'npm'`）。
2. 更新判定只调 npm registry（`dist-tags.latest` / `/latest`），没有任何 `git ls-remote` / lockfile commit / GitHub HEAD 比对。
3. 版本来源是**第三方目录里的 version 字段**（awesome-dsh-plugin / 自家 registry.json），既不是 registry 实时，也不是仓库 commit。

| 插件 | 命中的判据 | 具体后果 |
| --- | --- | --- |
| `@sueleven/dsh-auto-update` | ①`lib/update.mjs:236` | `dsh-svn-tools` 直接 reason=`非 registry 依赖`，**不出现**（漏报，非误报） |
| `dsh-plugin-mgr` | ①`collectUpdates()` 只留 `sourceType==='npm'` | git 插件只显示仓库链接，不参与更新 |
| `@max-null/dsh-plugin-center` | ②`detectUpdate()` 只 `npmLatest()` | git 与 local 全靠「同名同源」兜底 |
| `dsh-mall` | ②+③`extractVersion()` 只认 `#semver:` | 无 semver 的 git spec → `from===null` → **静默跳过**（连「无法判断」都不说） |
| `@99galaxy/dsh-plugin-market` | ③`updateState()` 比 awesome 目录 version | 目录滞后于 npm；无 git 覆盖；无法判断时才计 `unknown` |
| `dsh-plugin-autoupdate` | ②委派 `dsh plugin update`（pnpm wanted） | git 与 link 的实际行为交给 pnpm，本插件不自己判断 |
| `dsh-plugin-manager-pro` | 未验真，但描述声称「npm / 插件超市 / GitHub」多源 | 多源是否真实现**未验证**，按描述采信 |
| `dshmarket-update-helper` | ②只针对 `dshmarket` 一个包 | 名字像通用更新器，实际是单体补丁器 |

对比：**明确做了 git 判定的只有 4 个**——`dshmarket`（GitHub + 自托管 + 三种 lock 形态）、`dsh-plugin-install`（GitHub HEAD）、`dsh-plugin-diraud`（`git ls-remote` sha/tag）、`dsh-m`（有判定但会退化）。

---

## 6. 对本机 13 个依赖的逐条推演

| 依赖 | spec 形态 | 期望行为 | 谁做对了 | 谁做错了 |
| --- | --- | --- | --- | --- |
| `dsh-better-sidebar` 0.28.0 / `dsh-chat-import` ^0.25.2 / `dsh-context` 0.75.1 / `dsh-ide-git` ^0.18.2 / `dsh-mnemon` 0.5.33 / `dsh-mobile` 0.6.12 / `dsh-ops` ^0.3.0 | npm | 7 行全部显示「有更新」 | 全部候选 | `@sueleven` 会少 1 个（`dsh-mnemon` 不在 `dsh.profile.bundles`，被判「未启用」；见 `调研-E` §0.1） |
| `dsh-svn-tools` | `github:zengweicheng666/dsh-svn-tools`（无 `#sha`） | 要么真比 commit/仓库版本，要么明说「不支持/无法判断」 | `dsh-plugin-install`、`dshmarket`、`dsh-plugin-diraud`、`dsh-plugin-upgrader`（明说 no registry history） | `dsh-m`（恒报可升级）、`dsh-mall`（静默消失） |
| `dsh-ctx-menu` / `dsh-mcp-compat` / `dsh-win-notify` / `hooks-adapter` | `link:` 本地目录 | **绝不能出现在可更新列表里** | 全体显式跳过者 + `dshmarket`（含 generation 分支） | 无观察到误报；`@max-null` 的同源校验是唯一的隐式路径 |
| `@deepseek-ai/dsh-subagent-codex` | 官方包 | 不参与更新（随运行时） | `dsh-plugin-update-checker`（`update: {status:'part-of-runtime'}`） | 部分插件会把它列为 npm 行 |

---

## 7. 遗留与未验证

1. **17~20 名的 4 个（`dsh-unified-market`、`@springbrand`、`dsh-research`、`dsh-plugin-console`）未解包验真**，仅按描述归类，采信度低于前 16 名。
2. **`dsh-plugin-manager-pro` 的「多更新源」未验证**，描述声称 npm / 插件超市 / GitHub 三源。
3. **GitHub star 是弱信号**：58 个 market 仓库里 39 个 ≤ 5 star，本轮排序刻意压低了 star 权重，主要看源码种类判定与三件事完整度。
4. **两个仓库已 404**：`zoahdev/dsh-subscribe`（41 周下载，`dsh-subscribe`）、`VibeDev-Si/dsh-ecosystem`（417 周下载）——引用它们的前提是仓库恢复可访问。
5. **未做的事**：没有安装任何候选插件做端到端实测（本轮只读约束）。若要把第一名落到「可依赖」，需要在 `web` 或 `headless` profile 上做一次装 → 重启 → 看版本 tab 输出的验证。

---

## 附录 A：`category === "market"` 全 58 条（按 npm 周下载降序）

列含义：`三件事` = 已安装清单 / 更新检测 / 一键升级 的覆盖分级；`更新源` = 描述或源码里明说的来源。

| # | 包名 | npm latest | 分类 | 三件事 | 更新源 | 周下载 | stars | 仓库最近 push | 描述（截断） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `dshmarket` | 1.73.1（目录记 1.71.1） | 市场 | 明确三件事 | npm/github/git/link | 231,348 | 9347 | 2026-10-27 | 在 DeepSeek Harness 设置页内浏览、搜索并安装社区插件，支持分类筛选、一键更新与停用，以及主题切换与 |
| 2 | `dsh-m` | 0.10.23（目录记 0.10.21） | 市场 | 明确三件事 | npm/git(退化) | 9,144 | 25 | 2026-10-27 | DSH 的应用内插件市场：插件发现、安装、升级、开关与卸载一站完成，跟随 Web / Desktop 宿主 prof |
| 3 | `dsh-find-plugin` | 0.4.0 | 市场 | 只提安装 | — | 4,472 | 210 | 2026-09-25 | 会话内直接找插件：按关键词/分类搜索本精选 registry，返回描述与可直接执行的安装命令。 |
| 4 | `dsh-skin-market` | 0.1.68（目录记 0.1.67） | 市场 | 只提安装 | — | 3,146 | 273 | 2026-10-28 | 原生皮肤市场与生命周期管理器，发现社区皮肤、展示预览与兼容状态，并提供已验证的一键安装或手动安装入口。 |
| 5 | `dsh-find-plugins` | 0.3.0 | 市场 | 只提安装 | — | 2,930 | 17 | 2026-10-21 | 跨多个社区目录并叠加 GitHub 与 npm 实时搜索来找 DSH 插件，按相关度、可信度、新鲜度与有界热度排序， |
| 6 | `dsh-plugin-marketplace` | 0.5.6 | 市场 | 只提安装 | — | 2,194 | 2 | 2026-10-27 | 在 Web UI 设置页浏览和搜索 GitHub dsh-plugin 仓库，按 Star 排序，并通过 DSH C |
| 7 | `dsh-preview-market` | 0.1.10 | 市场 | 只提安装 | — | 2,175 | 0 | 2026-10-24 | DSH 垂直预览市场：发现预览插件、查看已安装清单，并通过 dsh-market 或 dsh CLI 安装、启用/停 |
| 8 | `dsh-agent-plugins-market` | 0.13.0 | 市场 | 只提安装 | — | 1,391 | 17 | 2026-10-27 | 把任意 Claude Code / Codex / Cursor / Kimi / agent-plugins.or |
| 9 | `dsh-task-plugin-scout` | 1.0.5 | 市场 | 只提安装/启用 | — | 1,264 | 1 | 2026-10-25 | 按任务排序本 profile 的插件（已启用 / 已安装但未启用 / 市场可安装），并给出每个候选的确切下一步——启 |
| 10 | `dsh-plugin-ops-bundle` | 0.20.6（目录记 0.20.5） | 市场 | 只提更新(预演) | npm | 1,065 | 0 | 2026-10-27 | dsh 插件树的启动前体检与修复——十条跟随启动器运行时解析的静态规则、启动失败后的故障归因、先在隔离实例复验再落地 |
| 11 | `dsh-plugin-upgrader` | 1.3.0（目录记 1.0.2） | 市场 | 明确三件事 | npm/git/link | 899 | 1 | 2026-10-28 | 在「插件」页新增版本页：一键升级全部可升级插件或勾选的子集，查看历史版本并回滚到任意已发布版本，并为每个插件和每个版 |
| 12 | `dshmarket-update-helper` | 1.1.0 | 市场 | 只提更新(仅自身) | npm | 834 | 3 | 2026-10-26 | 提供独立设置页，通过 DSH 插件管理器更新 npm 稳定版 dshmarket，支持版本核对及安装失败时尝试恢复旧 |
| 13 | `universal-plugin-hub` | 1.0.12 | 市场 | 只提安装 | — | 763 | 2 | 2026-10-27 | DSH 的可视化插件市场：多源浏览、一键安装，技能、子代理、MCP 连接器、LSP 服务器与 hooks 自动接入。 |
| 14 | `dsh-research` | 0.4.4 | 市场 | 明确三件事(描述) | 未解包 | 749 | 10 | 2026-10-21 | 精选科研插件市场：在设置里加一页「科研插件」，收录逐个读过代码的文献检索、文献管理、写作与科研工作台插件——一键安装 |
| 15 | `dsh-plugin-mgr` | 0.2.12 | 市场 | 明确三件事 | npm | 735 | 3 | 2026-10-01 | 设置页卡片式插件管理：经 profile 补丁层启停插件（跨重启保留）、安装来源详情、npm 更新检查与一键更新、卸 |
| 16 | `dsh-plugin-install` | 0.4.12 | 市场 | 明确三件事 | npm/github/link | 654 | 4 | 2026-10-16 | 设置 → 插件里的「安装」标签页：按 npm spec、`github:user/repo` 或本地路径安装、更新、 |
| 17 | `dshhub-market` | 0.8.60 | 市场 | 只提安装(+备份更新) | — | 640 | 4 | 2026-09-23 | DeepSeek Harness 口令插件市场：输入 6 位口令解锁并安装创作者分享的插件，附带主题、备份、更新与诊 |
| 18 | `dsh-skill-market` | 1.0.0 | 市场 | 技能市场 | — | 561 | 8 | 2026-10-08 | 技能市场插件，聚合 SkillHub 与 ClawHub 双源搜索，支持站内 README 预览、一键安装与卸载、已 |
| 19 | `dsh-plugin-share` | 0.2.5 | 市场 | 其他(分享码) | — | 536 | 4 | 2026-10-22 | 把一套 DSH 插件变成一段可粘贴的分享码，别人贴进去就能逐条安装，也能生成二维码带到手机上。 |
| 20 | `@sueleven/dsh-auto-update` | 1.0.1 | 市场 | 明确三件事 | npm | 502 | 0 | 2026-10-21 | 每次启动 DeepSeek Harness 时检查已安装并启用的插件有没有新版本，在界面上列出并询问，确认后更新到最 |
| 21 | `dsh-pick` | 0.4.4 | 市场 | 只提安装 | — | 486 | 0 | 2026-10-27 | DSH 插件选购顾问：说需求，从带 dsh-plugin 关键字的 npm 包里按去噪指标（日常基线、周环比、版本节 |
| 22 | `@99galaxy/dsh-plugin-market` | 1.2.0（目录记 1.1.1） | 市场 | 明确三件事 | 目录version | 471 | 0 | 2026-10-27 | 在 DSH 设置页浏览 awesome-dsh-plugin 目录：按分类或已安装状态筛选，按名称或简介搜索，按 S |
| 23 | `@vibedev-si/dsh-ecosystem` | 0.2.0（目录记 0.1.18） | 市场 | 只提安装 | — | 417 | {"message":"Not Found","documentation_url":"https://docs.github.com/rest/repos/repos#get-a-repository","status":"404"} | NA | VibeDev 插件中心：介绍 VibeDev 官方插件，并通过官方插件管理器一键安装（先检查、先不启用地安装、再启 |
| 24 | `dshmarketplace-plugin` | 0.2.0 | 市场 | 只提安装 | — | 415 | 8 | 2026-10-05 | 不离开 harness 就能找插件、装插件：/store 命令、设置页的插件标签页、两个可供 agent 调用的工具 |
| 25 | `dsh-install-check` | 0.1.9（目录记 0.1.1） | 市场 | 其他(装前预检) | — | 396 | 0 | 2026-10-27 | 装插件前先替你撞一遍：工具名重了、依赖缺了才说话，一句结论配一条建议，装还是照装。 |
| 26 | `dsh-unified-market` | 0.4.1 | 市场 | 明确三件事(描述) | npm/github | 376 | 2 | 2026-10-01 | 面向 DSH Desktop（EAC）桌面壳的统一插件市场：聚合精选目录、GitHub dsh-plugin 生态与 |
| 27 | `@txc2768651338/dsh-plugin-manager` | 0.7.0 | 市场 | 只提启停 | — | 347 | 9 | 2026-10-20 | 设置 → 插件里的插件管理页：已装插件中文名与白话描述、一键启停、界面内改备注，支持搜索与筛选。 |
| 28 | `@1e0zj/dsh-plugin-mall` | 0.4.17 | 市场 | 只提更新检测 | npm优先 | 317 | 4 | 2026-08-27 | 开放式插件市场：GitHub dsh-plugin 话题实时搜索，逐仓库 package.json 验证（dsh.b |
| 29 | `dsh-extension-hub` | 0.2.19 | 市场 | 只提安装 | — | 301 | 8 | 2026-08-21 | 设置页一体化扩展中心：管理技能/MCP/插件，内置插件市场（精选目录+GitHub 搜索、npm 一键安装），并提供 |
| 30 | `dsh-mcp-market` | 0.1.2 | 市场 | 只提安装(MCP) | — | 299 | 1 | 2026-08-16 | DSH 的 MCP 服务器商场：浏览经过 npm 校验的精选目录，一键安装 MCP 服务器到当前 profile，免 |
| 31 | `dsh-skills-marketplace` | 1.1.2 | 市场 | 技能市场 | — | 290 | 4 | 2026-09-25 | 类 Codex 插件市场的 DSH 技能管理器。 |
| 32 | `@dsh-suite/plugin-manager` | 0.8.7 | 市场 | 只提安装 | — | 287 | 64 | 2026-10-28 | DSH Web UI 内置插件商店：浏览、搜索、一键安装、兼容性徽章。 |
| 33 | `dsh-plugin-index` | 0.1.4 | 市场 | 只提安装 | — | 277 | 3 | 2026-10-16 | DSH 内的插件索引，收录 1 万余个按 package.json 里的 dsh.bundle 声明校验过的第三方插 |
| 34 | `@springbrand/dsh-plugin-marketplace` | 1.0.8 | 市场 | 明确三件事(描述) | 未解包 | 258 | 9 | 2026-08-18 | 设置页里的插件市场，可操作本机任意 profile 而不只是当前运行的那个：在 web、headless 及其他 p |
| 35 | `@max-null/dsh-plugin-center` | 0.4.6 | 市场 | 明确三件事 | npm | 254 | 1 | 2026-10-20 | DeepSeek Harness 插件中心：已安装插件信息、带星标与版本号的社区市场、一键安装与更新，以及启动时的更 |
| 36 | `dsh-batch-uninstall` | 1.3.0 | 市场 | 其他(批量卸载) | — | 251 | 3 | 2026-10-20 | 在 DSH 设置中新增「批量卸载」页面：勾选多个已安装插件批量移除，支持全选、二次确认与逐条进度，官方 bundle |
| 37 | `dsh-store` | 0.5.2 | 市场 | 只提安装 | — | 250 | 4 | 2026-09-15 | dsh 插件商店：npm 权威目录 + awesome 精选（550+ 插件、11 分类）、dsh 字段质量验证、官 |
| 38 | `@sanqi-normal/dsh-webui-market-plugin` | 0.5.5 | 市场 | 只提安装 | — | 239 | 104 | 2026-08-22 | dsh Web GUI 内的社区插件市场：浏览 awesome-dsh-plugin.com 目录，从 设置 → 插 |
| 39 | `dsh-disable-unofficial-plugins` | 1.3.1 | 市场 | 其他(启停) | — | 233 | 0 | 2026-10-20 | 在 DSH 插件页的「已安装」分组标题右端加一个勾选式开关：点开是当前方向下非官方插件的清单，默认全选，只切换你保留 |
| 40 | `dsh-plugin-manager-pro` | 0.9.1 | 市场 | 明确三件事 | npm/超市/GitHub | 230 | 12 | 2026-10-07 | 插件管理器与救砖中心：按必要程度分组启停、多更新源（npm / 插件超市 / GitHub）、浏览器下载优先与目录自 |
| 41 | `dsh-bootstrap` | 0.1.0 | 市场 | 只提安装 | — | 225 | 1 | 2026-10-17 | DSH 新人引导插件：按八个领域推荐插件（GitHub Star 与 npm 近月下载加权排序），先出计划再一键安装 |
| 42 | `dsh-plugin-console` | 0.3.2 | 市场 | 明确三件事(描述) | 未解包 | 224 | 1 | 2026-09-07 | 在 DeepSeek Harness 设置一级页面中浏览和管理社区插件目录，支持验证后安装与更新、删除、暂停与恢复、 |
| 43 | `@weibaohui/experts-management` | 0.5.10 | 市场 | 其他(专家市场) | — | 213 | 3 | 2026-10-07 | 专家管理：管理 ntd 格式的专家与专家团队（plugin.json + Agent MD + 技能集），内置 50 |
| 44 | `dsh-stock-mentions` | 0.1.3 | 市场 | 其他(行情) | — | 202 | 2 | 2026-09-26 | 将 DSH 输出文本中的股票名称和代码转换为可点击按钮，并在侧边栏展示行情与资讯。 |
| 45 | `dsh-mall` | 1.8.6 | 市场 | 明确三件事 | npm(+#semver git) | 200 | 10 | 2026-09-22 | DeepSeek Harness 内完整的插件商场：每 2 小时刷新 GitHub #dsh-plugin 全量目录 |
| 46 | `dsh-plugin-autoupdate` | 0.3.2 | 市场 | 明确三件事 | npm(委派CLI) | 199 | 0 | 2026-10-14 | DSH 插件更新器：把版本决策交给 dsh CLI，继续受 pnpm 发布年龄策略约束；应用前先快照、可回滚、带锁定 |
| 47 | `dsh-autocompose` | 0.5.0 | 市场 | 只提安装 | — | 180 | 1 | 2026-10-02 | 根据任务查找并组合 DSH 插件，打开可继续对话的独立环境，或将方案中的插件安装到当前配置。 |
| 48 | `dsh-archive-manager-plus` | 0.1.3 | 市场 | 其他(归档) | — | 176 | 1 | 2026-09-28 | 归档管理：在设置页列出已归档会话，并可真正删除，连同会话日志、归档标记与投影缓存一并清理。 |
| 49 | `dsh-plugin-diraud` | 0.9.2 | 市场 | 明确三件事 | npm/git | 170 | 3 | 2026-09-17 | 装在 DSH 里的插件目录：按来源（官方/自装）分组展示已安装插件，可搜索，支持启用/停用、卸载和一键更新。已发布  |
| 50 | `dsh-insight` | 0.1.0 | 市场 | 其他(评测) | — | 157 | 1 | 2026-09-11 | 插件评测中心：一个答案回答"哪些值得装"——plugin_guide 按需求推荐插件、recipe 安装整套环境、p |
| 51 | `dsh-need-finder` | 0.3.1 | 市场 | 只提安装(配方) | — | 150 | 2 | 2026-09-11 | 需求型插件导购与环境配方：plugin_guide 按自然语言需求语义匹配精选插件并给出理由与安装命令；recipe |
| 52 | `dsh-audit` | 0.5.2 | 市场 | 其他(评分) | — | 148 | 1 | 2026-09-11 | 插件生态体检：将 dsh-plugin 话题同步为本地评分目录（维护/文档/npm+周下载/生态四维，0-100 分 |
| 53 | `dsh-plugin-recommend` | 1.1.1 | 市场 | 只提安装 | — | 148 | 0 | 2026-09-11 | DSH 插件推荐器：按需求描述、分类与标签在 1100+ 条内嵌市场目录中搜索并排序插件，返回匹配理由，支持从 aw |
| 54 | `dsh-local-installer` | 0.1.3 | 市场 | 只提安装(本地) | — | 148 | 0 | 2026-09-16 | 本地插件安装器：DSH 网页设置页里的本地插件安装入口——文件选择器多选 .tgz 或输入本机完整路径，自动检测所在 |
| 55 | `@creait/dsh-to-english` | 0.1.0 | 市场 | 其他(翻译) | — | 132 | 6 | 2026-08-26 | 用你已经配置好的模型，把从市场安装的插件里的中文文案改写成英文——安装时自动运行，随后热重载。每个文件整体翻译一遍， |
| 56 | `dsh-subscribe` | 0.3.1 | 市场 | 明确三件事(描述) | 未解包 | 41 | 未查 | NA | Steam 风格的插件商店：在 DSH 里浏览插件注册表，一键安装、卸载与更新，另有零依赖 CLI 与可供 agen |
| 57 | `@vlln/plugin-console` | 0.1.0 | 市场 | 其他(管理) | — | 40 | 59 | 2026-10-25 | 插件生态基建：浏览器面板管理官方 repository 插件（0 patch）+ make-dsh-plugin 插 |
| 58 | `@oxmumu3/dsh-plugin-finder` | 0.10.0-preview.5（目录记 0.10.0-preview.4） | 市场 | 只提检索 | — | 无数据 | 0 | 2026-10-27 | 确认需求、检索动态社区插件目录并阅读作者资料，给出最小插件方案，保存方案版本，再经用户确认把待发送草稿交给 DSH  |

---

## 附录 B：market 之外按关键词扩圈命中的相关项（133 条中的 17 条有效）

搜索词：`update|upgrade|outdated|更新|升级`（对 name + title + description.zh/en）。133 条命中里绝大多数是「业务数据更新」「模型升级」「热更新」等噪音，真正的「插件/本体更新器」如下：

| 包名 | 分类 | 版本 | 周下载 | 与需求的关系 |
| --- | --- | --- | --- | --- |
| `dsh-plugin-update-checker` | tools | 0.1.6 | 214 | **正交命中**：插件页内新增「检查更新」tab，一行一插件 + 更新按钮 + 兼容性；`link:` 排除注释最清楚 |
| `dsh-update-checker` | dev | 1.7.3 | 1,574 | 主程序 + 插件双源 semver、备份/校验/回滚、看门狗重启 |
| `dsh-update-copilot` | dev | 0.13.0 | 261 | 一次扫描覆盖 DSH 本体 + 每个 profile 的插件，只更新确认过的 |
| `dsh-local-plugins` | dev | 0.3.0 | 405 | 把你改过的插件存为本地 git 仓库，并把 npm/`git` 源更新合并进你的修改 |
| `dsh-insight-tree` | dev | 0.1.2 | 143 | 插件树可观测：Loader fiber 状态 + 一键关闭/启用/更新/卸载 |
| `dsh-my-guardian` | dev | 0.4.8 | 3,029 | 新装/更新插件先进候选区，启动完成后热挂载，失败自动禁用 |
| `dsh-plugin-precheck` | security | 0.2.0 | 254 | 装前门控，可**拦截 dsh-market 的安装/更新点击** |
| `dsh-compat-vet` | dev | 0.3.2 | 292 | 已装插件 peerDependencies 比对 + 顶部横幅隔离/卸载/升级 |
| `dsh-hot-reload` | dev | 0.2.4 | 177 | 插件升级后在运行中的 dsh 内直接重载，失败回滚（是「一键升级」的加速器，不是检测器） |
| `dsh-update-notifier` | notify | 0.2.1 | 159 | 每小时检查 npm 上已装插件的新版本并询问（极轻量，仅 npm） |
| `dsh-check-update` | dev | 0.3.0 | 153 | 设置页对比 + 导航红点，只给命令不执行 |
| `dsh-plugin-runcat-inventory` | dev | 1.3.2 | 285 | 已装插件表格 + npm 更新提醒（提醒非执行） |
| `dsh-view-manager` | ui | 0.2.2 | — | 视图标签管理，附 npm 更新提醒 |
| `@vlln/plugin-console` | 市场 | 0.1.0 | 40 | 0 patch 的插件生态基建，非更新器 |
| `dsh-plugin-upgrade*`（PerryLink 两个） | skill | 2.1.1 / 0.1.1 | — | DSH **0.1.x → 0.1.5** 的升级技能，与 0.2.1-rc.3 无关 |
| `dsh-updater-npm` / `dsh-version-update` / `@zhucy123/dsh-update` | dev/git | — | — | 只更新 **DSH 本体**，不管插件 |
| `dsh-desktoop-plugin` / `dsh-desktop-tools` | ui/tools | — | — | 更新桌面壳 exe，与插件无关 |

---

## 附录 C：数据与复现

全部脚本在 `/d/tmp/f/`（只读调研产物，可随时删除）：

| 文件 | 作用 |
| --- | --- |
| `dump.mjs` | 拉官方索引，按分类计数，导出 `market.json`（58 条） |
| `kw.mjs` | 关键词扩圈，导出 `kw.json`（market 外 133 条） |
| `dl.mjs` / `dl2.mjs` / `dl3.mjs` / `fill.mjs` | 周下载（多轮重试补全限流 null） |
| `allstars.sh` | `gh api` 批量取 58 个仓库的 star / pushed_at / archived |
| `build2.mjs` | 合并 npm latest + 周下载 + star → `table.json` |
| `tgz.mjs` + `scan.mjs` | 下载 20 个候选 tarball 解包并做能力信号计数（installedList/npmRegistry/semver/applyUpdate/linkSrc/gitSrc/rollback） |
| `report.mjs` | 生成本文两张表（排序表、附录 A），避免手工转写误差 |

**关键一次性结论**：官方索引的 `versions[].version` 不可作为「当前版本」引用——58 条里至少 12 条落后于 npm latest（最大差 3 个 minor，如 `dsh-plugin-upgrader` 1.0.2 → 1.3.0）。凡引用版本，请以 `registry.npmjs.org/<pkg>/latest` 为准。