# 调研 E：三个「更新检查 / 自动更新」类社区插件源码验真

> 调研日期：2026-10-28 ｜ 调研方式：**只读**（npm tarball 解包 + 官方 asar 字符串取证 + registry/GitHub API 实探），未安装任何插件、未改仓库源码、未改 `~/.dsh/profiles/desktop`。
> 被测对象：`@sueleven/dsh-auto-update@1.0.1`、`dsh-m@0.10.21`（npm 最新 0.10.23）、`@max-null/dsh-plugin-center@0.4.6`。
> 用户环境：desktop profile，13 个依赖，DSH `0.2.1-rc.3`，Node v24.21.0。

---

## 0. 结论先行（给决策用的 6 句话）

1. **npm 源：三家都能做，且都做对了。** 7 个有更新的 npm 依赖中，`dsh-auto-update` 覆盖 6 个（`dsh-mnemon` 因为它不在 `dsh.profile.bundles` 里被判「未启用」而跳过），`dsh-m` 与 `dsh-plugin-center` 覆盖 7 个。
2. **`link:` 本地源：三家都不会误报，但方式不同** —— 两家靠"识别为非 registry 依赖直接跳过"（`dsh-auto-update`、`dsh-m`），一家靠"npm 同名包 + repository 同源校验"排除（`dsh-plugin-center`）。本机 4 个 `link:` 包在三家下**全部静默**，符合"不可更新就不该出现"的要求。其中 `dsh-win-notify` 在 npm 上真有同名包（作者 kongdexu，与本仓库 yzlin499 不同源），`dsh-plugin-center` 的同源校验**正确地**把它排除了 —— 这是三家唯一做了"同名异源"防护的实现。
3. **`github:` git 源：只有 `dsh-m` 有真正的 commit/tag 比对，但当前会退化成"恒报可升级"。** 它的判据是 `!inst.spec.includes(latestSha)`（`market.js:512,728`）—— 用户的 spec 是 `github:zengweicheng666/dsh-svn-tools`（**没有 `#sha`**），所以 `spec.includes(任意sha)` 恒为 false。现在恰好"确实有更新"（0.13.4 → 0.16.1）所以看上去对，但它是靠"没锁 sha"蒙对的；一旦升到 `github:...#<sha>`（它自己会这么写）才会变成真 commit 比对。`dsh-auto-update` 与 `dsh-plugin-center` 对 git 源**完全不覆盖**（前者显式跳过，后者只查 npm 且该包 npm 404）。
4. **一键升级的落地方式差别很大：**`dsh-m`（desktop）**委派官方 `pluginManager.installBundle()`**，读 `ChangeResult.application` 区分 `applied`（客户端热更）/`restart-required`；`dsh-auto-update` **绕过 pluginManager**，直接 spawn `<DeepSeek Harness.exe> --expose-internals <app.asar>/.../dsh-desktop-host/lib/cli.js plugin add <pkg>@<ver> --config.minimum-release-age=0`；`dsh-plugin-center` **直接 `pnpm add -w` 改 profile**（无事务/无回滚，锁冲突时降级成"给你一条手动命令"）。
5. **兼容性都过关。** 官方兼容判定是 `semver.satisfies(runtime, range, {includePrerelease:true})`（asar 证据见 §5），所以 `0.2.1-rc.3` 能落进 `dsh-m` 的 `@deepseek-ai/dsh-tools: "^0.1.7-rc.2 || ^0.2.0-rc.1 || >=0.2.0"` 与 `dsh-plugin-center` 的 `">=0.1.1-rc.1 <0.3.0"`；`dsh-auto-update` 干脆没声明任何 dsh 需求，不参与判定。
6. **没有一款是"专为更新检查"的干净实现。** `dsh-auto-update` 交互最贴合需求（启动检查 + 右下角提示卡 + 「全部更新」），但覆盖面最窄且自带 desktop 打包布局硬依赖；`dsh-m` 能力最强、治理最严（目录匹配 + 兼容预检 + 发布龄预检 + build 审批 + 崩溃对账），但它是 1.5 万行的"市场全家桶"，更新只是其中一栏，且**必须打开它自己的面板才看得见**；`dsh-plugin-center` 是 SSID 家族的插件中心（自带 LLM 推荐、What's New 弹窗），覆盖 npm 全量但不碰 git，且会调用 LLM 服务。

---

## 1. `@sueleven/dsh-auto-update` v1.0.1

**取到的源码**：`https://registry.npmmirror.com/@sueleven/dsh-auto-update/-/dsh-auto-update-1.0.1.tgz`（17,933 B）→ `lib/index.js`(351) + `lib/client.js`(270) + `lib/update.mjs`(706)。npm 上只有 `0.0.0-stage / 1.0.0 / 1.0.1` 三版，1.0.1 发布于 2026-10-22（本报告写作前一天），很新。

### 1.1 挂载点

- Host 半：`export const inject = ['webServer']`，`webServer.register({ kind:'prefix', path:'/dsh-auto-update', handler })`，暴露 4 条路由 `GET /status`、`POST /check`、`POST /apply`、`POST /dismiss`（`lib/index.js:23,331-335`）。**不注册任何 Slot，不碰官方插件页。**
- Client 半：`ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name:'shell.overlay', id:'dsh-auto-update.prompt', order:40 }, UpdatePrompt))`（`lib/client.js:262-266`），即**右下角固定浮层提示卡**（手写内联样式，`position:fixed; right:18px; bottom:18px`，`zIndex:2147483000`，硬编码深色底 `rgba(26,27,32,0.97)`）。
- 与官方「已安装」「发现」**零冲突**（既不占用 `settings.section`，也不占 `settings.plugins.tab`），代价是它也**没有**任何页面入口——只有在"检查到更新"这一刻存在。

> 行为：`apply()` 里 `setTimeout(8_000)` 后自动检查（`STARTUP_DELAY_MS`，可用 `DSH_AUTO_UPDATE_DELAY_MS` 覆盖），无更新则完全静默；`POST /dismiss` 只隐藏本次启动的提示。

### 1.2 数据来源

三样，全部本地读盘 + 一个网络源：

| 数据 | 来源 | 位置 |
| --- | --- | --- |
| 依赖声明 | `~/.dsh/profiles/<profile>/package.json` 的 `dependencies` | `update.mjs:238-259` |
| "已启用"判定 | `package.json.dsh.profile.bundles` ∪ `cordis.patch.yml` 文本包含 | `update.mjs:275-276` |
| "被市场禁用"判定 | `.dsh-market/state.json` 的 `disabled[]`（本机不存在该文件 → 空集） | `update.mjs:249-254` |
| 当前版本 | `node_modules/<pkg>/package.json` 的 `version` | `update.mjs:261-264` |
| 最新版本 | `https://registry.npmjs.org/<pkg>` 的 `dist-tags.latest`（`accept: application/vnd.npm.install-v1+json`，超时 12s，重试 3 次，429 不早退） | `update.mjs:301-327` |

**不使用** `pluginManager.listBundles()`、不使用官方市场索引、不用 GitHub API。registry 地址可用 `DSH_AUTO_UPDATE_REGISTRY` 覆盖，默认**直连 registry.npmjs.org**（不是 npmmirror——中国大陆网络下这一点值得注意；本机实测 npmjs 通）。

### 1.3 更新判定覆盖【最关键】

判定函数 `isUpgrade(installed, latest)` = 自实现的 semver 正向前进比较（含 prerelease 规则，`update.mjs:183-232`），**只看版本号，不看 commit**。

候选过滤只有一个正则（`update.mjs:236`）：

```js
const NON_REGISTRY_SPEC = /^(?:file:|link:|portal:|workspace:|git\+|git:|github:|https?:|ssh:|\/|\.{1,2}[\\/])/i;
```

| 依赖形态 | 结果 | 证据 |
| --- | --- | --- |
| npm（`1.2.3` / `^1.2.3` / `~1.2.3`） | ✅ 查 `dist-tags.latest`，只在 `latest > installed` 时列出，不会降级 | `update.mjs:285-294, 340` |
| `github:` / `git+` / `git:` | ❌ **显式跳过**，reason = `非 registry 依赖（github:...）` | `update.mjs:285-288` |
| `link:` | ❌ **显式跳过**，reason = `非 registry 依赖（link:...）` → **绝不误报** | 同上 |
| `file:` / `https:` tarball / 绝对路径 | ❌ 跳过 | 同上 |
| 未进 `bundles` 也没进 `cordis.patch.yml` | ❌ 跳过，reason = `未启用` | `update.mjs:275-279` |

**它没有任何 git/commit 能力，也不读 `pnpm-lock.yaml`。** 这是它的设计边界，README 也明写了（`README.md:58`）。

### 1.4 升级动作

**不走公开 `pluginManager.installBundle`**，而是把 DSH 桌面版**当成 Node 解释器**再跑官方 CLI：

```
<DeepSeek Harness.exe> --expose-internals <...>/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js \
  plugin --profile desktop add <pkg1>@<v1> <pkg2>@<v2> ... --config.minimum-release-age=0 [--save-exact]
```

（`update.mjs:462-468, 481-534`；子进程 `cwd` = profile 目录，`ELECTRON_RUN_AS_NODE=1`，超时 15min，超时 `taskkill /T /F`，输出留尾部 200KB 写日志。）

- **等价于 `dsh plugin add`**，所以仍是官方通道（不会漏写 `cordis.patch.yml` / 挂载清单），但**完全绕过运行的 pluginManager 进程**：没有 `ChangeResult`、没有 `restart-required` 判定、没有并发保护（只有自己的 `state/update.lock`，30min 视为过期）。
- **需重启**：代码注释和 UI 文案都写「重启 DSH 后生效」（`update.mjs:685`、`index.js:215`），不做热更判定。
- **失败回滚：没有。** 唯一的补偿是"装完复读 `node_modules/<pkg>/version` 与目标版本比对，不一致就报错"（`update.mjs:663-683`）。
- **需要能定位 `DeepSeek Harness.exe`**：候选顺序 `--dsh-exe` → `DSH_DESKTOP_EXE` → `DSH_DESKTOP_NODE_EXECUTABLE` → `process.execPath` → `%LOCALAPPDATA%\Programs\DeepSeek Harness\DeepSeek Harness.exe`，且必须同目录存在 `resources\app.asar`（`update.mjs:373-411`）。**`dsh web` / headless profile 上必然失败**（报「找不到 DeepSeek Harness.exe，无法调用 dsh plugin 更新」）。

### 1.5 兼容性

- `engines.node >= 20`，**没有 `engines.dsh`，也没有任何 `@deepseek-ai/*` peerDependencies** → 官方兼容判定对它不设门槛（`unmetRequirements` 只在 `engines.dsh` 或 dsh-* peer 存在时判），在 `0.2.1-rc.3` 上装得上。
- 依赖的非公开锚点：
  1. `webServer.register({ kind:'prefix', ... })` —— 公开契约（asar 内 `kind: "prefix"` 出现 5 次，官方自己也用）。
  2. `shell.overlay` slot —— 公开 slot（官方 `dsh-client-ui-plugin-manager` 同款注册）。
  3. **`resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js` 这个打包内路径 + `--expose-internals` 标志**——纯属实现细节，官方一改打包布局/入口文件名即失效。
  4. 附带假设：`dsh-desktop-host/lib/cli.js` 支持 `--config.minimum-release-age=0`（pnpm 11 的 `minimumReleaseAge` 策略）。
- README 记录了一处自家 bug：1.0.0 的前端模块注册名漏了 scope 会导致 `duplicate factory registration for "dsh-auto-update"` 而**启动失败**，1.0.1 已修（`README.md:40-46`）。这类"客户端模块名必须全局唯一"的坑值得记一笔。

### 1.6 网络与隐私

- 请求量：每个候选 1 次 `GET registry/<pkg>`（`dist-tags.latest` 用的精简 Accept 头，响应很小），并发 4；本机 6 个候选 ≈ **6 次请求/每次启动**，只打 registry.npmjs.org，无第三方、无遥测、无 token、不需要 GitHub 配额。
- 限流处理：只在 `429` 时重试（4xx 其余直接放弃），无 backoff 上限逻辑。
- 本地产出：`<插件包目录>/logs/{auto-update.log, plugin.log}`、`<插件包目录>/state/{plugin-state.json, plugin-boot.json, last-run.json}`、`state/update.lock`。**默认写在包目录里**（npm 安装即 profile 的 `node_modules/@sueleven/dsh-auto-update/`），可用 `DSH_AUTO_UPDATE_DATA_DIR` 改。写进 `node_modules` 不算干净（`pnpm add` 重装会清掉）。

### 1.7 权限面

- Host 半只用 `webServer` 一个服务 + `node:child_process` 任意 spawn + `node:fs` 读写（profile 只读，包目录读写）。
- **风险点：`POST /dsh-auto-update/apply` 没有任何来源/凭据校验。** handler 只看 `req.method` 和 path（`index.js:263-303`），同机任何能发 HTTP 的页面（含任意本地 Web 服务页面）都能触发一次性批量升级——CSRF 面。对照：`dsh-m` 显式做 Origin/Host 同源 trust 检查并 fail-closed，`dsh-plugin-center` 走 `connection.fetch.register`（宿主"supplies authentication"）。
- **`--config.minimum-release-age=0` 主动关掉了 pnpm 的供应链发布龄冷却**——官方插件市场默认保留这道闸。升级到刚发布几分钟的版本时，这层保护是失效的（猜测作者的动机是"刚发的版本要能装上"，对自用场景可接受，但要知道）。
- 直接改写 profile 文件：**没有**（只通过官方 CLI 间接改）。

---

## 2. `dsh-m` v0.10.21（npm 最新 **0.10.23**，用户看的是 0.10.21）

**取到的源码**：`https://registry.npmmirror.com/dsh-m/-/dsh-m-0.10.21.tgz`（322,979 B）→ `host.js` + `lib/host.js`(164) + `lib/tools.js`(582) + `lib/cli.js`(501) + `lib/core/*.js` **60 个文件、约 1.47 万行** + `registry.json` + `locale/{zh,en}.json`。规模是另两家的 10~30 倍。

> 版本提醒：`0.10.21` 已被 `0.10.23` 取代（0.10.23 发布于 2026-10-27），0.10.22/0.10.23 的修复内容本报告未逐一核对；下文以 0.10.21 源码为准。

### 2.1 挂载点

- Host 半：`export const inject = ['tools']`，`apply()` 里 `bindLoaderHost` + `createRegistryController` + `createApiDispatcher`，通过 `webServer` 暴露一条私有 JSON API（方法名如 `ping / installed / installedUpdates / market / upgrade / install / uninstall / set-enabled / restart / doctor / self-check / self-upgrade / external-operations`，`host-api.js:261-713`），并注册 **8 个 agent 工具**：`dshm_search / dshm_list / dshm_install / dshm_toggle / dshm_uninstall / dshm_outdated / dshm_upgrade / dshm_restart`（`tools.js:70-414`），外加 `dshm` CLI（`bin` 字段，`search/list/outdated/registry/doctor/install/upgrade/uninstall/toggle/restart`）。
- Client 半：`ctx.slots.inject('sidebar.footer.action', … { id:'dshm-market', order:9 })` —— **侧栏页脚一个入口按钮**（`lib/client.js:6798-6810`），点开是**它自己的全屏浮层面板**（`.dshm-overlay/.dshm-panel`，内含「市场 / 已安装 / 设置」分段），另注册 3 个 `tool.call.toolview`（`dshm_search/dshm_list/dshm_outdated` 的工具卡片渲染，`client.js:6812-6820`）。
- 与官方「已安装」「发现」**不冲突**（不占 `settings.section`、不占 `settings.plugins.tab`），但**功能高度重叠**：它自带一份"已安装"列表 + 社区市场 + 开关/卸载。作者对 slot 冲突有防御：`safeRegister()` 捕获 `already has a registration` 并让位（`client.js:6655-6673`）。

### 2.2 数据来源

| 数据 | 来源 |
| --- | --- |
| 已安装清单 | **直接读 profile**：`package.json.dependencies` + 每个 `node_modules/<pkg>/package.json`（`link:` 解析真实目录）+ 包内 `cordis.patch.yml` 行（`installed.js:208-233`）；开关态由 loader entries ⋈ bundles ⋈ profile 覆盖行合成（`composeEnablement`） |
| 主清单（精选） | 包内快照 `registry.json`（23 条）+ 远程 `https://raw.githubusercontent.com/iasiv5/dsh-m/main/registry.json` → jsDelivr 兜底（`registry.js:581-585`） |
| 社区目录（4000+） | `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog@{version}/plugins.json` → npmmirror → unpkg 三级兜底（`community.js:74-76`）。**实测当前目录 7,211 条**（`dsh-plugin-catalog@2026.1027.11136`） |
| 最新版本 | npm → `registry/<pkg>/latest`；GitHub → `api.github.com/repos/<repo>/releases/latest`，404 回退 `/tags` 首项，再 `commits/<ref>` 解引用成 commit sha（`versions.js:28-155`） |
| 当前 commit | **不读 lockfile 做判定**（只在安装后校验时读 `pnpm-lock.yaml` 的 `resolution.commit`，`market-mutation.js:594-597`） |

**它不用 `pluginManager.listBundles()` 取清单**（自己直读 profile + loader），但**用 `pluginManager.installBundle()` 做 desktop 的写操作**。

### 2.3 更新判定覆盖【最关键】

两条判定路径：

**(a) 已装页（`listInstalledWithMeta` → `probeLatest`，`market.js:589-730`）**

- 每个已装项都尝试探最新：命中目录条目 → 用条目的 npm/github；**没命中目录的 npm 包也照探**（`latestCacheKey(ns,'npm-only',{source:'npm',id:pkg,npm:pkg})`，`market.js:679-696`）——所以"不在目录里的 npm 包"也能显示可升级。
- 判定：
  - 有 `latestVersion` → `outdated = isNewerVersion(latestVersion, installed)`（标准 semver `gt`，非法输入一律 false，`versions.js:203-213`）；
  - 否则有 `latestSha` → **`outdated = !item.spec.includes(latestSha)`（`market.js:727-728`）**。
- `link:` / `file:` 源：`cacheKey === null` → **不探测，`outdated` 恒 false**（`market.js:679-683` 的 `else null` 分支）→ **绝不误报** ✅

**(b) 市场页（`listMarket` → `probe`，`market.js:497-514`）**：同上，且**社区 github 条目在浏览页不做 REST 探测**（配额不可控，`market.js:458-461`），只有已装页才探。

| 依赖形态 | 判定 | 结论 |
| --- | --- | --- |
| npm | ✅ semver 比 `dist-tags.latest` | 7/7 都能检出 |
| `github:` **锁了 `#sha`** | ✅ commit 比对：最新 release/tag 的 sha 是否出现在 spec 里 | 真 commit 级判定 |
| `github:` **没锁 `#sha`**（本用户就是这种） | ⚠️ `spec.includes(sha)` 恒 false → **恒报"可升级"** | 当前恰好正确，但语义上是"没锁所以永远算旧" |
| `github:` 仓库**没有任何 tag/release** | ⚠️ 抛 `仓库没有任何 tag: <repo>` → 记为 `latestError`（UI 显示"检查未完成"），不误报可升级 | 降级合理 |
| `link:` / `file:` | ✅ 不探测、不误报（连 `latestError` 都不产生） | 干净 |
| 官方 `@deepseek-ai/*` | ⚠️ **不排除**：也照探 npm latest。本机实测 `@deepseek-ai/dsh-subagent-codex` npm 上最新是 `0.0.1-rc.1` < 已装 `0.2.1-rc.3` → 不会误报可升级，但会白花一次请求、且 UI 里"最新 0.0.1-rc.1"看着怪 | 小瑕疵 |

**GitHub 配额**：有显式的**预算机制**——每次检查最多 25 个 wire 请求（`GITHUB_PASSIVE_PER_REQUEST_MAX`）、宿主级滚动 1 小时最多 50 次（`GITHUB_PASSIVE_HOURLY_MAX`），同仓库 in-flight 单飞复用，限额用尽时给出中文提示含"约 N 分钟后重置"（`versions.js:15-93`）。用户主动 install/upgrade 走 active 通道，不占这个预算。**这是三家唯一实现了 GitHub 限流治理的。**

> 实测提醒：调研当时本机 `api.github.com` 返回 `403 rate limit exceeded`、`x-ratelimit-remaining: 0`（共享出口 IP 已被打满）。这意味着**任何走 GitHub API 的 git 源更新检查现在都拿不到结果**——本机 git 源在这一项上会显示"检查未完成"。

### 2.4 升级动作

**desktop profile → 委派官方 `pluginManager.installBundle()`**（这是最正确的一条路）：

```js
// profile-ops.js:784-800
const service = await resolveManager(deps);           // 双上下文探测 ctx.get('pluginManager') + ctx.inject 惰性拉起
if (!service || typeof service.installBundle !== 'function')
    throw new DesktopOpsError('no-manager', '官方 pluginManager 服务不可用…拒绝升级（fail-closed）');
```

- 目标 spec：目录 npm 条目 → `npm@<latest>`（或用户指定版本）；目录 github 条目 → **`github:<repo>#<sha>`（用 sha 锁，不用 tag）**（`profile-ops.js:848-862`）。
- 升级前：`precheckNpmCompat` 预检目标版本与当前 DSH 的兼容性（不兼容则 `IncompatibleError`，除非 `forceIncompatible`）；`releaseAgePrecheck` 发布龄预检；`governExcludeBlock` 排除条目治理；`build-approval` 处理 pnpm 待批构建脚本。
- 升级后：读官方 `ChangeResult.application` → `applied / overridden` = 无需重启、`restart-required` = 需重启（`profile-ops.js:766`、`activation.js` 还细分 `client-only`）。
- **有崩溃对账**：`writeUpgradeIntent` 预写 intent ledger，下次进程启动 `self-check` 时收口"装到没装到"（`host-api.js:273-300`、`upgrade-intent.js`），避免"自升级悬垂导致假死"。
- **web profile**（非 desktop）才走它自己的 pnpm 事务链（`profile-transaction.js` 1150 行 + `market-mutation.js` 791 行：变更前快照 deps/lock/integrity、失败 `throwCompensated` 回滚、`guardManualRequired` 明确"这条退不回去，请手动处理"）。本用户是 desktop，用不到。
- **目录门槛（重要）**：desktop 升级要求目标包**在它的收录清单或社区目录里**，否则 fail：

  ```js
  if (!entry) throw new DesktopOpsError('install-refused',
      `「${pkg}」不是经 dsh-m 收录的插件；desktop 升级请在官方 Desktop 插件页操作`);
  ```

  匹配规则 `matchInstalledByEntry`：`entry.npm === it.pkg` 或 `entry.name === it.npm` 或 github spec 前缀相等（`merged-market.js:56-68`）——**按 npm 包名精确匹配，不按显示名**，所以 `dsh-mobile` 这种"目录里 5 个同名不同 owner"的情况不会串到别人家（实测目录里 `dsh-mobile` 有 5 条：`dsh-mobile`(saya-ch)/`@tecfancy/…`/`@orderg-x/…`/`@zyfgood/…`，npm 名唯一，匹配到 saya-ch 那条，正确）。

### 2.5 兼容性

- `engines.node >= 22.19.0`（本机 v24.21.0 ✅）。
- peerDeps：`@deepseek-ai/cordis *`、`@deepseek-ai/dsh-tools ^0.1.7-rc.2 || ^0.2.0-rc.1 || >=0.2.0`、`@deepseek-ai/schemastery *`、`react ^18`。没有 `engines.dsh`，所以走 peer 判定；`satisfies(..., {includePrerelease:true})` → `0.2.1-rc.3` 命中 `>=0.2.0` ✅ **无需 version exemption**。
- 非公开锚点清点：
  1. `ctx.get('pluginManager')` + `ctx.inject(['pluginManager'])` 双上下文探测（注释里明确"pluginManager 是惰性服务，外层 apply 一次 get 探不到"，`host.js:60-79`）——服务本身公开，探测手法是经验性 workaround。
  2. `@deepseek-ai/schemastery` 的 `.volatile()` **特性探测**（有则用、无则退普通字段，`host.js:15-22`）。
  3. `appExit`（`dsh-cmdline`）用于自重启，注释称跨 0.1.2/0.1.5/0.1.7/0.2.x 都暴露。
  4. `ctx.webServer`、`ctx.loader` entries、`ctx.baseUrl`、`ctx.logger`。
  5. `bindLoaderHost`（`live-plugin.js`）读 loader 内部状态做"卸载前 live-disable"。
  整体风格是 **duck-typing + 运行时探测 + fail-closed**，没有硬编码 DSH 版本号——这是它敢跨这么多 rc 版本的原因。

### 2.6 网络与隐私

- 请求量（打开面板一次）：1× registry.json（raw → jsDelivr）、1× 社区 catalog（jsDelivr/npmmirror/unpkg）、每个已装项 1× npm `/latest`（本机 13 项 ≈ 13 次）、每个 github 已装项 2~3× GitHub API（受 25/50 预算约束）、市场页每张卡 1× npm latest（分页 limit 默认小）。缓存：进程内 `latestCache`（TTL `cacheTtlMin` 默认 60min）+ 磁盘 `~/.dsh/dshm/cache/<ns>/…`（`env.js:30-40`）。
- **无遥测、无 token、无登录**；GitHub 是匿名 60/h，且它主动降到 50/h 上限自我约束。
- 写盘位置：`~/.dsh/dshm/cache/**`、`registry.json` 快照、`upgrade-intent` ledger、`external-journal`（外部操作记录）。**在 desktop 上不直接改 profile 文件**（写操作全交 pluginManager）。

### 2.7 权限面

- Host 半服务：`tools`（注册 8 个工具）、`webServer`（私有 API，**带宿主信任检查**：不可信 Host/Origin 直接 401/403，`host-api.js:77-87`）、`pluginManager`（仅 desktop 写操作用）、`loader`、`schemastery`、`cmdline/appExit`。
- **有任意命令执行面**：web profile 下 `spawn('dsh' | 'pnpm', [...])`（`dsh-cli.js:420`）；`restart` 端点要求同源（`trustedRestartRequest`）；自升级走 tarball 直装。desktop 下这些路径基本不走，但代码都在包里。
- **agent 工具是真实写入面**：`dshm_install / dshm_upgrade / dshm_uninstall / dshm_toggle / dshm_restart` 都能改 profile（CLI 侧强制 `--yes`；工具侧走 `assertWriteAllowed(profile, …)`）。如果给 agent 授权，等于把"装/卸/改插件"交给模型——这是权限设计上必须明确的一点。
- 这是三家里**唯一**做到"desktop 写操作 = 100% 官方 pluginManager"的实现。

---

## 3. `@max-null/dsh-plugin-center` v0.4.6

**取到的源码**：`https://registry.npmmirror.com/@max-null/dsh-plugin-center/-/dsh-plugin-center-0.4.6.tgz`（1,774,716 B，含 4 张 docs 截图）→ `dist/{engine,market,meta,update,semver,rpc,toggle,reconcile,llm-log,skill-provider}.js` + `client.js`(2198) + `skills/dsh-plugin-upgrade/SKILL.md`。TS 编译产物（有 `.d.ts`），源码逻辑基本透明。

> 背景：它属于 `@max-null/*` 家族（SSID「思灵」桌面体验，19 个插件），README 自称也在 plain DSH 里能跑。这个出身解释了下文多处 `SSID_*` 环境变量分支。

### 3.1 挂载点

- **`settings.section`（id `plugin-center`, order 50）** —— 即在**设置页里多出一节「插件中心」**（`client.js:2157-2161`）。官方插件页是 `settings.section` id `plugins` order 15（`dsh-client-ui-settings-plugins/lib/client.js:201-211`），**两者是并列的兄弟节，不冲突，但也不共用官方 tab**。
- `conversation.session.header.utilities`（id `plugin-center`, order 50）—— 会话头部一个图标按钮，点开同样的面板浮层（`client.js:2163-2167`）。
- `shell.overlay` × 5：`plugin-center-panel`(50) / `plugin-center-whats-new`(51) / `plugin-center-toast`(52) / `plugin-center-llm-confirm`(53) / `plugin-center-llm-fallback`(54)（`client.js:2168-2187`）。
- 另有 `skills/dsh-plugin-upgrade` 通过 `registerSkillProvider` 注入技能表（`dist/index.js:3-15`），让 agent 按它的规则做更新决策。
- 三个 slot 键（`settings.section` / `conversation.session.header.utilities` / `shell.overlay`）在 `0.2.1-rc.3` 的 asar 里都存在（分别出现 37 / 13 / 52 次），挂载不会因 slot 缺失而失败。
- **启动即检**：`apply()` 末尾 `void checkWhatNew()`（`client.js:2193`）→ `rpc('checkUpdates')` → 有"未读新版本"且当天没弹过 → **弹一次 What's New 对话框**（`client.js:582-596`，用 `~/.dsh/plugin-center-read-versions.json` + `whatsNewDaily` 做每日去重）。

### 3.2 数据来源

| 数据 | 来源 |
| --- | --- |
| 已安装清单 | **`ctx.loader.entries()`**（Loader 是权威）→ 逐条 `require.resolve` / 逐级 `node_modules` / `dsh-runtimes` / asar 内核锚点 解析到 `package.json`（`meta.js:147-250`） |
| 来源分类 | 纯看 specifier 形状：`@deepseek-ai/*`→official、`file://`/`link:`→local、`cordis:*`→builtin、其余→installed（`meta.js:32-43`） |
| 市场 | 三个社区源直连：`awesome-dsh-plugin.com/plugins.json`、`raw.githubusercontent.com/like-study1/Oh-My-DSH/.../curated.json`、`raw.githubusercontent.com/2BingLing/dsh-market/.../plugins.json`（`market.js:29-180`） |
| 最新版本 | **只有 npm**：`registry/<pkg>/latest`（npmjs → npmmirror 兜底，8s 超时）（`update.js:65-77`） |
| 当前 DSH 版本 | 解析 `@deepseek-ai/dsh` 的 `package.json`（4 级锚点，`meta.js:190-250`），失败返回空串（不判兼容，0.4.4 修） |
| 变更日志 | GitHub `commits?since=…` → 24h 同版本磁盘缓存 → npm readme 预览 → npm 发布时间（`update.js:144-292`） |

**不用 `pluginManager.listBundles()`**（它自己解析 Loader 条目），**也不用官方市场索引**（自己拉三个社区源）。

### 3.3 更新判定覆盖【最关键】

`checkUpdates(sinceIso)`（`engine.js:392-436`）：

```js
const candidates = installed.filter(p => UPDATABLE.has(p.source)      // {installed, local}
    && p.version !== null && managed.has(p.name));                    // 只查 profile 直接声明的
const src = sourceOf(spec, baseUrl);                                  // npm/vendor/tarball/local-file
if (src === 'vendor' || src === 'tarball' || src === 'local-file') {
    const same = await isSameUpstream(p.repoUrl, p.name);             // 比 npm 同名包的 repository
    if (same !== true) return null;                                   // 无法判定/不同源 → 排除
}
return detectUpdate(...);                                             // 内部只有 npmLatest + semver 比较
```

- `detectUpdate`：`latest = npmLatest(name)`；`latest === null || compareVersions(latest, local) <= 0` → 无更新（`update.js:253-256`）。**仅版本号，不看 commit。**

| 依赖形态 | 判定 | 结论 |
| --- | --- | --- |
| npm | ✅ semver 比 npm `/latest` | 7/7 |
| `github:` / `git+` | ❌ **完全不覆盖**：`sourceOf` 归为 `tarball`（即"本地定制"）→ 走 `isSameUpstream` 校验；本用户 `dsh-svn-tools` 在 npm **404** → `isSameUpstream` 返回 null → 排除。**无检出不误报** | 漏报 |
| `link:` 本地包 | ⚠️ 判据是"npm 上有没有同名包且 repository 同源"：全 4 个 `link:` 包里 3 个 npm 404 → 排除；`dsh-win-notify` npm 上有同名包（kongdexu）但与本地仓库（yzlin499）不同源 → `same===false` → 排除 ✅ | **三家唯一做了"同名异源"防护，正确** |
| 官方 `@deepseek-ai/*` | ✅ 排除（`classifySource`→official，不在 `UPDATABLE`） | 干净 |
| 禁用中的插件 | 包含（只看声明不看启用） | 与 `dsh-auto-update` 口径不同 |

**关键设计取向**：注释写得很明白——"宁少报不漏报"（`engine.js:409-412`）。所以它在 git 源上是**主动放弃**而不是误报。

### 3.4 升级动作

**不走 `pluginManager`，直接 `pnpm add -w` 改 profile**：

```js
// update.js:684-712
const before = snapshotHostFiles(pkgDir);
const result = await runPnpm(['add', '-w', `${packageName}@${version}`], profileDir);
// 装后核对实体版本（防 pnpm exit 0 假执行）+ 比对 host 文件哈希判断能否热更
```

- pnpm 候选链：`SSID_PNPM`（SSiD 捆绑）→ `pnpm`/`pnpm.cmd` → `%APPDATA%\npm\pnpm.cmd` → `npx --yes pnpm@<major>`（从 `.modules.yaml` 探测 store major 兜底），`shell:true`、`windowsHide:true`、15min 硬超时（`update.js:347-551`）。**用 `shell: true` 拼整行命令。**
- **无事务、无回滚**：不像 `dsh-m` 有 lock/integrity 快照。唯一自保是"装后复读版本，不一致就报错并给出可复制的手动命令"（`update.js:688-704`）。
- **需重启否**：靠 `snapshotHostFiles` 前后 sha256 比对——只有 client bundle/文档/图片变了 → `hot: true`（提示已热更）；否则要给"待重启"或让用户重启（`update.js:577-675`）。这台机器上 `EPERM`/`EBUSY`/`rename` 锁失败时：**SSiD 里**走两段式 `~/.ssid/pending-plugin-updates/`（`npm pack` 预下载，重启时由 SSiD 内核安装）；**plain DSH 里**只回一条命令 `dsh plugin --profile <name> add <pkg>@<ver>` 让你自己贴（`engine.js:466-480`）。
- **git 源升级不了**：`update(name, version)` 只会拼 `name@version`（npm 语义）。对 `github:` 依赖执行就会变成"去 npm 找同名包"，404 直接失败。

### 3.5 兼容性

- `engines` 未声明（不卡 node）；peerDeps：`@deepseek-ai/cordis ^4.0.1`、`@deepseek-ai/cordis-plugin-loader ^1.0.2`、`@deepseek-ai/dsh-client-connection >=0.1.1-rc.1 <0.3.0`、`@deepseek-ai/dsh-host-apiproxy >=0.1.1-rc.1 <0.3.0`。其中只有 `dsh-*` 开头的两个参与判定，`>=0.1.1-rc.1 <0.3.0` 含 `0.2.1-rc.3` ✅（`cordis-plugin-loader` 不是 `dsh-` 前缀，被忽略）。
  - 0.4.5 的 release note 正好写了这件事："peer 范围由 caret 换成显式区间 `>=0.1.1-rc.1 <0.3.0`，使内核 0.2.0-rc.1 判定为兼容。caret 在 0.x 上把上界钉在次版本，跨 minor 时插件会被内核**静默跳过**"——作者踩过、并修了。
- 非公开锚点清点（最脆的一家）：
  1. `ctx.loader.entries()` + `entry.fiberPhase`（cordis 内部枚举，代码里手抄了一份 `FIBER_PHASE` 映射，`engine.js:19-26`）。
  2. `ctx.baseUrl`（profile 锚点）+ `readDependencyKeys` 直接读 profile `package.json`。
  3. **DSH 版本探测靠"从 `process.argv[1]` / `process.resourcesPath` 上溯找 `@deepseek-ai/dsh` 的 package.json"**（`meta.js:69-250` 四级锚点）——曾经因为探不到而回退 `0.0.0`，把所有插件误判"不兼容当前 DSH"（0.4.4 修，这是实打实踩过的坑）。
  4. `connection.fetch.register({ path, methods, requestBody:'buffered', fetch })` 作为私有 RPC 通道。**关键**：注释说 Typert Remote 对第三方是封闭的（`api-remotes` 只 import 官方白名单），所以换私有通道。**asar 实测 `connection.fetch.register` 在 0.2.1-rc.3 存在（官方 `SessionMediaReferences` 同款用法），但它写的兜底路径 `connection.rpc.handle` 在 0.2.1-rc.3 的 asar 里搜不到（0 次）**——主路径可用，兜底是死代码。
  5. Client 侧 `ctx.get('sessions')` + `session.prompt([...], 'queue')`（LLM 更新路径），并为此自带"拿不到就复制 prompt"的降级面板。

### 3.6 网络与隐私（**这块最需要注意**）

- **会调用 LLM**：`suggest()`（AI 推荐）直接 `ctx.get('llm').stream({ provider:'deepseek-official', model:'deepseek-v4-flash', … })`，把用户输入的搜索需求 + 候选插件清单发给模型（`engine.js:600-640`）。"LLM 更新"路径同样把插件清单/prompt 投进一个新会话。
- 请求量（客户端一挂载）：`checkUpdates` × 1（每候选 1× npm `/latest` + 1× GitHub commits）＋ 3 个市场源 JSON ＋ 按需的 README 首图探测（`raw.githubusercontent.com` × 最多 3 个分支）。GitHub commits 有 24h 磁盘缓存 + 429 回退到 readme/发布时间。
- **有 token/账号态依赖**：`provider:'deepseek-official'` 意味着"AI 推荐"要用你的 DeepSeek 账号额度。
- 写盘位置：`<profile>/plugin-center-pnpm.log`（**写进 profile 目录**）、`~/.dsh/plugin-center-changelog-cache.json`、`~/.dsh/plugin-center-read-versions.json`、`~/.dsh/tmp-remoteprobe-*`（临时）、LLM 动作 JSONL。
- 无遥测、无自建上报。

### 3.7 权限面

- Host 半服务：`loader`（读 entries）、`connection`（注册私有路由，**宿主负责鉴权**）、`llm`（可选，用 `ctx.get` 探测）、`node:child_process`（`execFileSync('tar', …)`、`spawn(shell:true)` 跑 npm pack/pnpm）、`node:fs` 广泛读写。
- **任一"任意命令执行"面**：`runOne` 用 `shell:true` 拼 `[command, ...args].join(' ')`。参数虽由内部分支生成（包名/版本来自 npm 元数据与 UI），但 `shell:true` + 拼串的组合比 `dsh-m`（数组 argv、无 shell）风险更高。
- **直接改写 profile 文件**：是——`pnpm add -w` 本身就改 `package.json` / `pnpm-lock.yaml` / `node_modules`，且**不经过 pluginManager 的并发/事务保护**（它自己在进程内用 `pnpmChain` 串行化，但管不住别的插件/CLI 同时动 profile）。

---

## 4. 横向对比表

| 维度 | `@sueleven/dsh-auto-update` 1.0.1 | `dsh-m` 0.10.21（最新 0.10.23） | `@max-null/dsh-plugin-center` 0.4.6 |
| --- | --- | --- | --- |
| **1 挂载点** | `shell.overlay` 右下角提示卡；无页面 | `sidebar.footer.action` 入口 + 自有全屏面板（市场/已安装/设置）+ 3 个工具卡片 | `settings.section`（设置页多一节「插件中心」）+ 会话头部按钮 + 5× `shell.overlay` |
| 与官方「已安装/发现」冲突 | 无（也不共存） | 无 slot 冲突，**功能重复** | 无 slot 冲突，**位置最近官方**（同 `settings.section` 兄弟节） |
| **2 数据来源** | 直接读 profile `package.json` + `node_modules` + `cordis.patch.yml` + `.dsh-market/state.json` + npm `dist-tags.latest` | 直读 profile + 包内 `cordis.patch.yml` + loader⋈bundles 开关态；目录=自带 registry.json + jsDelivr `dsh-plugin-catalog`（实测 7211 条）；版本=npm `/latest` 与 GitHub release/tag→sha | `ctx.loader.entries()` 自解析 package.json；市场=3 个社区源直连；版本=**仅 npm `/latest`** |
| 用 `pluginManager.listBundles()` | ❌ | ❌（自己读盘） | ❌（自己解析 loader） |
| 用官方市场索引 | ❌ | ❌（用 awesome 系目录，非官方索引） | ❌（用 awesome/Oh-My-DSH/dsh-market） |
| **3 更新判定** npm | ✅ semver | ✅ semver | ✅ semver |
| **3** `github:` / `git+` | ❌ 跳过 | ⚠️ **有**：`!spec.includes(latestSha)`（tag/release→sha）；**未锁 sha 时恒报可升级**；需 GitHub API | ❌ 不覆盖（走"同名 npm 同源"校验，本包 npm 404 → 排除） |
| **3** `link:` 本地包 | ✅ 跳过（不误报） | ✅ 不探测（不误报） | ✅ 同源校验排除（**唯一做了同名异源防护**） |
| **3** 判定依据 version / commit | version | **两者都有**：npm→version；github→commit sha | 仅 version |
| **3** 已禁用插件 | 跳过（判"未启用"）→ 漏 `dsh-mnemon` | 照查 | 照查 |
| **3** 官方 `@deepseek-ai/*` | 跳过（未启用） | 不排除（白探一次） | 排除 |
| **4 升级动作** | spawn `<Harness.exe> --expose-internals <asar>/dsh-desktop-host/lib/cli.js plugin add <pkg>@<ver> --config.minimum-release-age=0`（=官方 CLI，但绕过运行中的 pluginManager） | **desktop：`pluginManager.installBundle(spec,{enabled,approvedBuilds})`**（先 compat 预检 + 发布龄预检 + 排除治理 + build 审批）；web：自有 pnpm 事务 | `pnpm add -w <pkg>@<ver>`（直接改 profile，shell:true），失败降级为"给你一条 `dsh plugin add` 手动命令" |
| 需重启 | 需（文案明说，无热更判定） | 读官方 `ChangeResult.application`：`applied`=热更 / `restart-required`=重启；另有 client-only 细分 | 前后 sha256 比对 host 文件，纯 client bundle 变 → 标 `hot` |
| 失败回滚 | ❌（只装后核版本） | ✅ 快照 + 补偿 + intent ledger 崩溃对账 + "退不回去就明确拒绝" | ❌（只装后核版本 + 手动命令） |
| **5 兼容性**（`0.2.1-rc.3`） | 无 dsh 声明 → 不判 ✅ | `dsh-tools ^0.1.7-rc.2 \|\| ^0.2.0-rc.1 \|\| >=0.2.0` → ✅（includePrerelease） | `dsh-client-connection/dsh-host-apiproxy >=0.1.1-rc.1 <0.3.0` → ✅ |
| 非公开锚点 | `app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js` + `--expose-internals`（**最脆，且只在 desktop 存在**） | `pluginManager` 双上下文惰性探测、schemastery `.volatile()` 特性探测、loader 内部、`appExit`（duck-typing，跨 rc 兼容） | loader entries + `fiberPhase` 手抄枚举、`process.resourcesPath/argv[1]` 上溯找内核、`connection.fetch.register` 私有通道、`sessions.prompt` |
| **6 网络量** | **6 次/启动**，只 npmjs，无 token、无 GitHub | 面板打开时 ~15 次（13 npm + 目录 2）+ GitHub（**25/次、50/h 预算 + 中文限流提示**） | 挂载即检：7 npm + 7 GitHub commits + 3 市场源；GitHub 有 24h 缓存 |
| 上报/遥测 | 无 | 无 | 无遥测，但**调 LLM**（`deepseek-official`/`deepseek-v4-flash`） |
| 需 token | 否 | 否（匿名 60/h，自限 50/h） | 否（GitHub 匿名；LLM 走你账号） |
| **7 权限面** | `webServer` + 任意 spawn + fs；**路由无来源校验（CSRF 面）**；关掉 pnpm 发布龄冷却；写日志进包目录 | `tools`(8 工具) + `webServer`(**带 Origin/Host trust，fail-closed**) + `pluginManager` + `loader`；web 下 spawn dsh/pnpm | `loader` + `connection`(宿主鉴权) + `llm` + `shell:true` spawn + 广泛 fs；**直接改 profile**（无事务） |
| 直接改 profile | 否（走官方 CLI） | desktop 否（走 pluginManager）；web 是（事务保护） | **是**（pnpm add） |

---

## 5. 对用户真实环境的覆盖率实测（13 个依赖逐条）

判定依据：profile `package.json` + `pnpm-lock.yaml` 实读；npm `/latest` 实探（2026-10-28）；社区目录实拉（`dsh-plugin-catalog@2026.1027.11136`，7211 条）；GitHub API 实探（当时 403 限流）。

| # | 依赖 | 声明 | 现装 → 最新 | auto-update | dsh-m | plugin-center |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `dsh-better-sidebar` | `0.28.0` | 0.28.0 → **0.28.2** | ✅ 检出+可升 | ✅ 检出+可升（目录命中 `DSH-better-sidebar`，npm=`dsh-better-sidebar`） | ✅ 检出+可升 |
| 2 | `dsh-chat-import` | `^0.25.2` | 0.25.2 → **0.26.2** | ✅ | ✅（目录 npm 命中） | ✅ |
| 3 | `dsh-context` | `0.75.1` | 0.75.1 → **0.77.0** | ✅ | ✅ | ✅ |
| 4 | `dsh-ide-git` | `^0.18.2` | 0.18.2 → **0.21.0** | ✅ | ✅ | ✅ |
| 5 | `dsh-mnemon` | `0.5.33` | 0.5.33 → **0.5.36** | ⚠️ **漏**（不在 `dsh.profile.bundles`、也不在 `cordis.patch.yml` → 判"未启用"） | ✅ | ✅ |
| 6 | `dsh-mobile` | `0.6.12` | 0.6.12 → **0.6.18** | ✅ | ✅（同名 5 条按 npm 名精确命中 saya-ch，正确） | ✅ |
| 7 | `dsh-ops` | `^0.3.0` | 0.3.0 → **0.4.4** | ✅ | ✅ | ✅ |
| 8 | `dsh-svn-tools` | `github:zengweicheng666/dsh-svn-tools` | 0.13.4 → **0.16.1**（lock 锁 `ceb3a941`，HEAD `b6c69735`） | ❌ **跳过**（非 registry） | ⚠️ **能判**（tag 0.16.1 → sha，与 spec 里"有没有这个 sha"比）→ 因 spec 未锁 sha，**恒报可升级**（此刻结论正确）；能一键升并写成 `github:…#<sha>`；**但依赖 GitHub API，本机当前 403 限额 0** | ❌ 不覆盖（npm 404 → 排除，不误报） |
| 9 | `dsh-ctx-menu` | `link:D:\…\dsh-ctx-menu` | 本地 | ✅ 跳过 | ✅ 不探测 | ✅ 排除（npm 404） |
| 10 | `dsh-mcp-compat` | `link:D:\…\dsh-mcp-compat` | 本地 | ✅ 跳过 | ✅ 不探测 | ✅ 排除（npm 404） |
| 11 | `dsh-win-notify` | `link:D:\…\dsh-win-notify` | 本地 0.1.0 | ✅ 跳过 | ✅ 不探测 | ✅ **排除（npm 有 kongdexu 的同名 0.1.0，同源校验判 false）** |
| 12 | `hooks-adapter` | `link:E:\DSHPlugins\hooks-adapter` | 本地 | ✅ 跳过 | ✅ 不探测 | ✅ 排除（npm 404） |
| 13 | `@deepseek-ai/dsh-subagent-codex` | `0.2.1-rc.3` | 官方随包 | ✅ 跳过（未启用）→ 即便查也不报（npm latest 仅 `0.0.1-rc.1` < 已装） | ⚠️ 照探 npm（白一次请求，不误报可升级） | ✅ 排除（official） |

**覆盖率小结**

| | npm（7 个有更新） | git（1） | link（4，必须不误报） | 误报 |
| --- | --- | --- | --- | --- |
| auto-update | **6/7** | 0/1 | 4/4 静默 | 0 |
| dsh-m | **7/7** | ⚠️ 1/1（判定可用但语义退化；受 GitHub 配额） | 4/4 静默 | 0（可升级结论正确，但"未锁 sha 恒报"是潜在误报源） |
| plugin-center | **7/7** | 0/1 | 4/4 静默（含同名异源正确排除） | 0 |

---

## 6. 推荐结论

### 6.1 三家各自最适合什么

- **只想要"启动就知道、顺手点一下升"→ `@sueleven/dsh-auto-update` 最贴合需求形状**：唯一的"启动检查 + 主动弹卡询问 + 全部更新"，6/7 npm 覆盖，零误报，无多余功能、无 LLM、无 GitHub 依赖。代价：覆盖面最窄，`dsh-mnemon` 漏，git 源不认，且**升级通道不走 pluginManager**（直接跑 CLI，等于 `dsh plugin add`，仍是官方通道但绕过了运行中管理器的并发/回滚能力）、`--config.minimum-release-age=0` 关了 pnpm 发布龄闸、`POST /apply` 无来源校验。
- **想要"最全 + 最稳 + 有治理"→ `dsh-m`**：唯一做 commit/tag 级 git 判定、唯一走 `pluginManager.installBundle` 并尊重 `ChangeResult.application`、唯一有目录/兼容/发布龄/build 审批/回滚/崩溃对账这一整套、唯一有 GitHub 配额治理。代价：**1.5 万行**、必须打开它自己的面板才看得到更新（没有启动提示）、desktop 升级被"必须在其目录内"约束（本用户 8 个可升级项全在目录里 ✅）、未锁 sha 的 git spec 会恒报可升级、8 个 agent 工具等于把装/卸权限给了模型。
- **想要"就在设置页里、离官方插件页最近"→ `@max-null/dsh-plugin-center`**：`settings.section` 兄弟节，npm 7/7，同名异源防护做得最好，有 What's New 每日弹窗。代价：**完全不碰 git**、更新直接 `pnpm add` 改 profile（无事务无回滚）、锁冲突在 plain DSH 下只能给你手动命令、会调 LLM（含你的账号与搜索内容）、SSID 出身带来 `~/.ssid/` 等不属于本机部署的假设。

### 6.2 能不能覆盖 git 源和 link 源（直答）

- **git 源（`github:`）：只有 `dsh-m` 一家有真能力，而且只能算"半个答案"。**
  - 它的 commit 比对是 `latestSha ∈ spec`，**不是**"lock 里的 commit vs 远端 HEAD"。用户 spec 没锁 sha，于是退化成"永远算旧"；正确做法应是调研 B 已给出的那套：**读 `pnpm-lock.yaml` 里 pnpm 记录的 `resolution.commit`（本机 `ceb3a941…`）与 GitHub HEAD/tag sha（`b6c69735`）比**。三家**都没有**这么做（`dsh-m` 读 lockfile 只用于装后校验，`market-mutation.js:594-597`）。
  - 且它 100% 依赖 GitHub API，匿名 60/h——调研当时本机出口已被打成 `403 / remaining:0`。一个"每次启动都查"的插件在这个配额下随时不可用；`dsh-m` 因此自我限到 50/h 并做了中文降级提示，另两家干脆不碰 GitHub（也就没有这个问题）。
- **link 源（4 个）：没有任何一款会误报，也就是说三家都"正确地不覆盖"。**这符合物理事实——`link:` 指向本地开发目录，没有上游版本可谈。真正需要的是"把它明确标成本地/开发中、不给更新按钮"，三家都做到了（`dsh-auto-update` 打 `非 registry 依赖（link:…）` 进 skipped 列表，`dsh-m` 不探测，`dsh-plugin-center` 走同源校验排除）。
- **实现我们自己的插件时，可直接抄的现成判据**（三家已验过的坑）：
  1. `link:`/`file:` → 一律"本地/开发中"，无更新入口（三家一致，安全）。
  2. npm → `registry/<pkg>` 的 `dist-tags.latest`，semver 正向前进比较（注意 prerelease 规则；现在的 DSH 生态大量 rc 版本，`isNewerVersion` 用标准 `semver.gt` 而不是自研折叠就够了——`dsh-m` 0.5.0 就是修这个坑，`dsh-auto-update` 自己实现了一份正确的）。
  3. `github:` → **必须读 lockfile 的 commit 与远端比**，而不是比 spec 字符串（`dsh-m` 的 `includes(sha)` 只对"已锁 sha"的 spec 成立）。
  4. 同名异源 → 用 `repository` 归一化后比对（`dsh-plugin-center` 的 `normalizeRepoUrl` + `isSameUpstream` 可直接借鉴，`update.js:108-133`）——这是 `dsh-win-notify` 这类"npm 上有别人同名包"场景的唯一防线。
  5. 升级动作优先 `pluginManager.installBundle()`（拿 `RestartReason`/`application`，天然兼容/回滚语义），而不是自己跑 pnpm/CLI。

---

## 7. 验真方法与证据索引

**取源码**

| 包 | 地址 | 大小 |
| --- | --- | --- |
| `@sueleven/dsh-auto-update@1.0.1` | `https://registry.npmmirror.com/@sueleven/dsh-auto-update/-/dsh-auto-update-1.0.1.tgz` | 17,933 B |
| `dsh-m@0.10.21` | `https://registry.npmmirror.com/dsh-m/-/dsh-m-0.10.21.tgz` | 322,979 B |
| `@max-null/dsh-plugin-center@0.4.6` | `https://registry.npmmirror.com/@max-null/dsh-plugin-center/-/dsh-plugin-center-0.4.6.tgz` | 1,774,716 B |

解包在 `D:\tmp\ep\{auto-update,dsh-m,plugin-center}\`（只读副本，可复查）。

**官方契约取证**（只读 `app.asar` 字符串，脚本 `D:\tmp\ep\asar*.mjs`）

- 兼容判定用 `satisfies(runtime, range, { includePrerelease: true })`，`unmetRequirements` 优先 `engines.dsh`、否则只看 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peer（asar @ 21,864,880）→ **rc 版本参与区间匹配，本机 `0.2.1-rc.3` 不会被误判不兼容**。
- `pluginManager` 服务名 `"pluginManager"`（`/d/tmp/dshx/dsh-plugin-manager/lib/index.js:1605`）；`listBundles()` / `installBundle()` 都是 `@Remote` 方法（`:1409-1528`），`installBundle` 结果含 `application: applied|restart-required|cancelled|failed|overridden` 与 `error.code: incompatible-version`。
- slot 键存在性（asar 出现次数）：`shell.overlay` 52、`settings.section` 37、`settings.plugins.tab` 22、`sidebar.footer.action` 10、`conversation.session.header.utilities` 13、`tool.call.toolview` 93 → 三家用的 slot 在 `0.2.1-rc.3` 全部有效。
- `connection.fetch.register` 存在（官方 `SessionMediaReferences` 同款用法）；`rpc.handle` 在 asar 内 **0 次** → `dsh-plugin-center` 的 rpc 兜底分支是死代码，主路径可用。
- 官方插件页：`settings.section` id `plugins` order 15，子 slot `settings.plugins.tab`（`dsh-client-ui-settings-plugins/lib/client.js:201-211`）→ 与 `dsh-plugin-center` 的 id `plugin-center` order 50 是兄弟节，不冲突。

**网络实探**（2026-10-28）

- npm `/latest`：7 个插件最新版本与用户的"期望升级"完全一致（0.28.2 / 0.26.2 / 0.77.0 / 0.21.0 / 0.5.36 / 0.6.18 / 0.4.4）；`dsh-svn-tools`、`dsh-ctx-menu`、`dsh-mcp-compat`、`hooks-adapter` 均 **404**；`dsh-win-notify` 存在但属 kongdexu（同名异源）。
- 社区目录 `dsh-plugin-catalog@2026.1027.11136`：7211 条；7 个 npm 依赖 + `dsh-svn-tools`（github，npm=null）全部命中。
- GitHub API：`3/3` 请求返回 `403 API rate limit exceeded`、`x-ratelimit-remaining: 0`（本机出口 IP 已被打满）→ **任何现阶段依赖 GitHub API 的 git 源检测都拿不到结果**。
- `dsh-svn-tools` 仓库 tags：经 jsDelivr data API 确认存在 `0.16.1 / 0.16.0 / 0.15.0 / 0.14.0 / 0.13.9 …`，`tags` 别名表为空（无 `latest`）→ `releases/latest` 会 404、回退 `/tags` 首项的路径会生效。

**未做的验证**（受"只读 + 不装插件"约束，需 lead 决定是否补）

1. 未实际安装三家并观察运行时行为（尤其 `dsh-m` 在 desktop 上的 `pluginManager` 探测是否真能探到、`dsh-plugin-center` 的 `connection.fetch` 路由是否真通）。
2. 未实测"升级一个包"的端到端结果（含是否真的需要重启）。
3. 未核对 `dsh-m` 0.10.22/0.10.23 相对 0.10.21 的差异。