# 调研 D：`@99galaxy/dsh-plugin-market` v1.1.1 源码验真

- 调研日期：2026-10-28
- 目标：验证官方插件索引里那条"几乎正好是用户想要的功能"的描述是否属实，能否**直接替代**用户需求（已安装筛选 + 可更新提示）
- 方法：只读。npm tarball 解包 + GitHub(jsdelivr) 对照 + 本机 DSH `0.2.1-rc.3` asar 契约比对 + 本机真实 profile 数据回放
- 未安装任何插件、未改仓库源码

## 0. 取到的源码与版本一致性

| 项 | 值 |
| --- | --- |
| tarball | `https://registry.npmmirror.com/@99galaxy/dsh-plugin-market/-/dsh-plugin-market-1.1.1.tgz`（200，25402 B） |
| 解包文件 | `package.json` `cordis.patch.yml` `index.js`(29.0 KB) `market-core.mjs`(13.1 KB) `client/client.js`(25.2 KB) `README.md` `LICENSE` |
| GitHub `main` | `https://cdn.jsdelivr.net/gh/99galaxy/dsh-plugin-market@main/{package.json,README.md}` 可读（200） |
| 版本 | `version: "1.1.1"`，与索引描述一致 |

GitHub REST API 在本机被限流（`403 API rate limit exceeded`），故用 jsdelivr 与 npmmirror 取件，结论不受影响（README/package.json 的 main 分支内容与 tarball 相符）。

**代码是真的**：Host 746 行、helper 373 行、Client 434 行，带大量解释性注释，不是空壳或套壳。作者对 DSH 契约的理解相当到位（见 §8）。但它有**两处致命假设与用户环境不匹配**，且都不报错——这是本报告的核心结论。

---

## 1. 它往哪个 slot 注册？会不会和官方「发现」冲突？

**注册 `settings.section`，自有独立设置页；不碰 `plugins.tab`。**

`client/client.js:416-428`：

```js
const inject = ['slots']

function apply (ctx) {
  ctx.effect(() => insertCss(), '@99galaxy/dsh-plugin-market: styles')
  // ONE settings page. The all/installed split lives inside it as an in-page tab
  // bar, so the settings navigation gains a single entry, not two.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'dsh-plugin-market',
    order: 16,
    label: 'DSH 插件市场',
  }, MarketPage))
}
```

三个标签（全部 / 已安装 / 可更新）是**页面内**的 tab bar（`client.js:274-299`），不是三个 slot 贡献。

**与官方不冲突，但"重复"是另一种意义上的**：

| 官方 | 社区插件 |
| --- | --- |
| `dsh-client-ui-settings-plugins` 注册 `settings.section` id=`plugins`（order 15），作为「插件」导航页的壳 | 注册 `settings.section` id=`dsh-plugin-market`（order 16），自己的导航页 |
| 官方 `dsh-client-ui-plugin-market` 注册 `plugins.tab`（在「插件」页里开标签）——这就是用户说的「发现」页 | 完全不注册 `plugins.tab` |

我在 asar 里核对过官方占用的 section id：`account` / `general` / `models` / `plugins` / `agent-presets`（asar `50061262` 处的官方 slot 契约说明）。`dsh-plugin-market` 不撞 id。

**结论**：设置里会多出一个平级的「DSH 插件市场」导航项，和「插件」页并列。不会覆盖或破坏官方「发现」，但**功能上是官方发现页的平行副本**，用户在两个地方看到两套插件列表（官方页走 `pluginManager` Remote，社区页走自己的 HTTP + 目录 JSON），数据口径不同。

**契约验真**：`settings.section` 是公开声明的 slot（官方契约 `packages/client/ui-settings/src/client/contract/slots.ts:57`），且官方示例明确允许 `label` 为**字符串**：

```js
ctx.slots.register(
  { name: 'settings.section', id: 'my-entry', order: 100, label: 'My entry' },
  () => React.createElement('div', null, 'hello'),
)
```

官方自身写法是 `label: () => t('nav')`（函数），社区用字符串——经 `resolveSlotLabel(entry.options.label)` 归一化，**合法，不会挂**。

---

## 2. 「已安装」「更新」两个标签的数据从哪来？

**既不是 `pluginManager.listBundles()`，也不是 npm registry，也不是 GitHub API。** 是"目录 JSON + 直接读盘"。

### 数据源一：社区目录 JSON（`market-core.mjs:6-9, 74-123`）

```js
const CATALOG_URL = 'https://awesome-dsh-plugin.com/plugins.json'
const MIRROR = 'https://gh-proxy.com/'
const CDN = 'https://cdn.jsdelivr.net/npm/dsh-plugin-catalog@latest/plugins.json'
const NPM_META = 'https://registry.npmjs.org/dsh-plugin-catalog'
const CACHE_MS = 3600000
```

四级降级依次尝试，任一条成功即落盘到 `~/.dsh/.dsh-plugin-market/catalog.json`。

实测（本机）：

| 源 | 状态 | 体积 | 条目数 | updated |
| --- | --- | --- | --- | --- |
| `awesome-dsh-plugin.com/plugins.json` | 200 | 8.57 MB | 7406 | 2026-10-27 |
| `cdn.jsdelivr.net/npm/dsh-plugin-catalog@latest/plugins.json` | 200 | 8.30 MB | 7211 | 2026-10-26 |
| `registry.npmjs.org/dsh-plugin-catalog` | 200 | — | latest `2026.1027.11136` | — |

⚠️ 注意：这里用的是 `plugins.json`（7211～7406 条），**不是**官方索引 `dsh-plugin-catalog/index.json`（3730 条，format 1）。两者是同一 npm 包里的**不同文件**，字段也不同（`plugins.json` 的 `name/owner/npm/version/stars/downloads/install/category/description{zh,en}`）。所以"目录"这件事本方案和官方是两套数据。

### 数据源二：profile 就地面板（`market-core.mjs:172-233`）

`doInstalled()` 由 Host 用子进程跑，产出 `installed.json`：

```js
const deps = manifest.dependencies || {}
const specs = {}
for (const name of Object.keys(deps)) specs[name] = typeof deps[name] === 'string' ? deps[name] : name
...
const bundles = (manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles) || []
const versions = {}
for (const name of Object.keys(deps).concat(bundles)) {
  const m = JSON.parse(readFileSync(join(nm, name, 'package.json'), 'utf8'))
  if (m && typeof m.version === 'string' && m.version !== '') versions[name] = m.version
}
```

即：读 `~/.dsh/profiles/<PROFILE>/package.json` 的 `dependencies` 与 `dsh.profile.bundles`，再逐个读 `node_modules/<name>/package.json` 的 `version`。

**匹配逻辑**（`index.js:390-432`）：把目录条目的安装命令里的 spec 与 profile 依赖名/`github:` repo 做**字符串归一化匹配**（`bySpec` / `byRepo` 两套 map）。这解释了索引描述里"若目录名与你实际装的包名不同，会标出真实包名"（`installedAs`）。

### 小结

| 需要的信息 | 本插件来源 |
| --- | --- |
| 有哪些插件可装 | 社区 `plugins.json` |
| 本机装了什么 | 自己 spawn 子进程读 profile `package.json` + `node_modules` |
| 装了哪个版本 | 同上，读 `node_modules/<name>/package.json` |
| 版本有没有更新 | 目录条目的 `version` 字段 |

完全**绕开**了官方 `pluginManager`（它有 `listPlugins` / `listBundles` / `installBundle` / `removeBundle` / `waitForInstall` / `cancelInstall` / `registries` / `inspect` 等 Remote 方法，见 §8）。

---

## 3. 更新判定覆盖哪些来源？（最关键的一问）

**判定依据只有一句话：目录里那个条目的 `version` 字符串，和本地 `node_modules` 里的 `version` 做 semver 比较。**

`index.js:304-313`：

```js
function updateState (installed, candidate) {
  const a = versionParts(installed)
  const b = versionParts(candidate)
  if (a === null || b === null) return 'unknown'
  for (let i = 0; i < 3; i += 1) {
    if (a.parts[i] !== b.parts[i]) return b.parts[i] > a.parts[i] ? 'update' : 'latest'
  }
  const c = comparePre(a.pre, b.pre)
  return c < 0 ? 'update' : 'latest'
}
```

**没有任何网络请求参与判定**（README 也明说："更新判断只比对目录里的 `version`，不额外发任何网络请求"）。因此：

| 依赖形态 | 能判吗 | 原因 |
| --- | --- | --- |
| npm 包（目录收录且有 `version`） | ✅ 能 | 目录 `version` vs 本地 `version` |
| npm 包（目录收录但 `version` 为 null） | ❌ `unknown` | `versionParts(null)` → null |
| **`github:` / `git+` 包** | ❌ **永远判不了** | 目录里这类条目 `version` 基本都是 `null`；即便有，也是**版本号不是 commit SHA**，无法发现新提交。判定语义上就不可能 |
| **`link:` 本地包** | ❌ 判不了 | 本地 version 能读到（符号链接可跟随），但目录通常不收录自研包；收录了也只会拿本地版本和目录版本比，没有意义 |
| 目录没收录的包 | ❌ `unknown` | 只进 `unknownTotal` 聚合计数 |

统计口径：目录 7406 条里只有 **3716 条**（50.2%）带 `version`。

### 对用户 13 个依赖的实测回放

我按插件算法、把 `PROFILE` 换成 `desktop`、用真实 `node_modules` 版本跑了一遍：

| 包 | 已装 | 目录 version | 判定 |
| --- | --- | --- | --- |
| dsh-better-sidebar | 0.28.0 | 0.28.1 | **update** |
| dsh-context | 0.75.1 | 0.77.0 | **update** |
| dsh-chat-import | 0.25.2 | 0.26.2 | **update** |
| dsh-mnemon | 0.5.33 | 0.5.36 | **update** |
| dsh-ops | 0.3.0 | 0.4.1 | **update** |
| dsh-ide-git | 0.18.2 | 0.21.0 | **update** |
| dsh-mobile | 0.6.12 | 0.6.18 | **update** |
| dsh-win-notify（link:） | 0.1.0 | 0.1.0 | latest（被目录"认领"了同名的 npm 包，属误匹配） |
| **dsh-svn-tools（github:）** | 0.13.4 | **null** | **unknown** |
| dsh-ctx-menu（link:） | 0.2.3 | — | 未收录 → **unknown** |
| dsh-mcp-compat（link:） | 0.8.1 | — | 未收录 → **unknown** |
| hooks-adapter（link:） | 0.1.0 | — | 未收录 → **unknown** |
| @deepseek-ai/dsh-subagent-codex | 0.2.1-rc.3 | — | 未收录，且不在 `dsh.profile.bundles` → 不计入 |

即：**7 个 npm 判为可更新，1 个 npm 判为最新，1 个 git 包和 3～4 个 link 包一律"判断不了"**。与用户感知的"8 npm / 1 git / 4 link"口径接近，但**git 与 link 那 5 个明确不会出现在「可更新」列表里**，只在标签内显示一句聚合提示：

`client.js:344-346`
> 另有 N 个已安装插件无法判断（目录里没有可用的版本信息）

这一点作者是诚实的（没有把"判不了"伪装成"已最新"），但**不满足**用户"看到哪些插件可更新"的完整诉求——用户环境里恰好有 5 个依赖属于盲区。

---

## 4. 「一键更新」怎么落地？

**不是调 `pluginManager.installBundle`，而是自己 `npm exec pnpm` 跑一条 `add`。** 而且**没有单独的 update 动作**——"更新"就是把目录里的安装命令再执行一遍。

### 链路

1. Client 点「更新」→ `postInstall(item.install)`（`client.js:241-260`），`item.install` 就是目录里的原始命令串，例如 `dsh plugin --profile web add dsh-context`
2. Host `POST /dsh-plugin-market/install` 用正则把它剥成 spec（`index.js:353-364`）：

```js
function safeSpec (install) {
  const m = /^dsh\s+plugin(?:\s+--profile\s+[A-Za-z0-9._-]+)?\s+add\s+([^\s].{0,299})$/.exec(textOf(install).trim())
  if (m === null) return null
  const spec = m[1].trim()
  if (spec === '' || spec.length > 300 || spec.indexOf('..') >= 0) return null
  if (spec.slice(0, 1) === '-') return null   // 防 pnpm 当成 --option
  return spec
}
```

3. Host spawn helper → `doInstall()`（`market-core.mjs:243-362`）真正执行：

```js
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
if (!existsSync(npmCli)) { console.error('market: npm-cli.js not found: ' + npmCli); process.exit(3) }
...
const baseArgs = ['add', spec, '-w', '--dir', profileDir]
r = spawnSync(process.execPath,
  [npmCli, 'exec', '--yes', '--package=' + pnpmSpec, '--', 'pnpm'].concat(baseArgs),
  { cwd: profileDir, stdio: ['ignore', ofd, efd], env })
```

4. 成功后**手工补 `dsh.profile.bundles`**（`market-core.mjs:335-357`）：

```js
const bundles = (after.dsh && after.dsh.profile && after.dsh.profile.bundles) || []
for (const name of Object.keys(after.dependencies || {})) {
  const m = JSON.parse(readFileSync(join(profileDir, 'node_modules', name, 'package.json'), 'utf8'))
  if (m.dsh && m.dsh.bundle && bundles.indexOf(name) < 0) { bundles.push(name); changed = true }
}
if (changed) { ... writeFileSync(manifestPath, JSON.stringify(after, null, 2) + '\n'); }
```

### 必须知道的几点

- **走的是 profile 目录里的 pnpm（`npm exec --package=pnpm@<major>`）**，不是 `dsh plugin add`。官方 `dsh plugin` 的挂载簿记被这套手写逻辑替代了 → 与官方 CLI 行为可能分叉。
- **需要重启 DSH**：Client 装完明确提示「请重启 DSH（或重载 profile）后该插件才会加载」（`client.js:354`）。**不能热更**。
- **失败无回滚**：pnpm 非 0 退出 → 只把 stderr/stdout 尾巴 4000 字返回给 UI 显示；`package.json` 若已被写坏不会恢复。
- 有**单并发锁**（`installInProgress`，409），有超时（install 900 s / catalog 300 s）。
- 遇到 `ERR_PNPM_IGNORED_BUILDS` 会**自动降级重试 `--ignore-scripts`**（`market-core.mjs:318-326`）——即构建脚本静默跳过。
- **更新语义是"按目录的来源重装"**：README 自己警告——"一个用 `github:` 装的插件，如果目录对应的条目是 npm 包名，更新后会变成 npm 包"（README:75-77）。想钉死 commit 的用户会被悄悄换源。

---

## 5. 依赖的 DSH 版本 / 非公开锚点

`package.json` **没有 `engines`，没有 `peerDependencies`，没有 `dependencies`**（零依赖，只用 node 内建）：

```json
{ "name": "@99galaxy/dsh-plugin-market", "version": "1.1.1", "type": "module",
  "main": "index.js",
  "exports": { ".": "./index.js", "./client": "./client/client.js",
               "./cordis.patch.yml": "./cordis.patch.yml", "./package.json": "./package.json" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" }, "client": { "platform": "web" } } }
```

→ **没有任何版本门槛**。装到任何 DSH 版本上都不会被拦住，好坏都靠运气。当前 DSH `0.2.1-rc.3`（desktop）。

### 锚点清点

| # | 锚点 | 性质 | 风险 |
| --- | --- | --- | --- |
| 1 | `settings.section` slot（含 `label` 字符串、组件作第二参） | **公开**（官方 slots.ts:57，官方示例同形） | 低 |
| 2 | `webServer.register({ kind:'exact', path, handler })` | **公开服务**（official `dsh-client-connection` 同形用法） | 低 |
| 3 | `window.__ModuleLoader__.load({ id, factory })` | 官方 client bundle 载入形式 | 低-中（非文档化 API） |
| 4 | `dsh.client` 只写 `platform:'web'`、无 `inject` | 官方包都写了 `inject`；此处靠 Cordis 层 `exports.inject=['slots']` 延迟 apply | 中 |
| 5 | 直接读写 `~/.dsh/profiles/<p>/package.json` 的 `dsh.profile.bundles` | **内部数据形状** | 中（与 `dsh plugin` 双写风险） |
| 6 | 解析 `node_modules/.modules.yaml` 取 pnpm 主版本（`market-core.mjs:235-241,276`） | pnpm 内部文件 | 中 |
| 7 | **`dirname(process.execPath)/node_modules/npm/bin/npm-cli.js`** | **环境假设** | **致命（见 §6）** |
| 8 | 裸 `child_process.spawn(process.execPath, [script])` 跑 node | 依赖继承 `ELECTRON_RUN_AS_NODE` | **高（见 §6）** |
| 9 | 自建 `/dsh-plugin-market/*` 路由（不在 `/api` 之下） | 官方明确 `/api` 才受 browser-trust fence 保护 → 作者自己手写同源校验 | 可接受（作者已处理） |

**没有用到** `pluginManager` / `settings` / `loader` / `remote` 任何一个官方业务服务，也没有非公开的内部函数调用。锚点 7、8 不属于"随 DSH 升级失效"，而属于"**在不同部署形态下直接不成立**"。

---

## 6. 【核心问题】两处与 desktop profile 环境不匹配的致命假设

### 6.1 profile 硬编码为 `web`

`index.js:25`：

```js
const PROFILE = 'web'
```

`market-core.mjs:11`：

```js
const PROFILE_DEFAULT = 'web'
```

全文件**没有任何途径**改这个值（无配置项、无 query 参数、无环境变量读取）。它被用于：

- 读已安装清单：`join(home(), 'profiles', PROFILE, 'package.json')`（`index.js:491`）
- 读已安装版本：`refreshInstalled` → `runHelper(['installed', '--profile', PROFILE])`（`index.js:509`）
- **执行安装/更新：`runHelper(['install', spec, '--profile', PROFILE])`（`index.js:713`）→ 写的是 `~/.dsh/profiles/web`**

本机实况：用户 **desktop 有 13 个依赖，web 有另外 7 个**（`dsh-quick-file`、`dsh-version-control`、`dsh-yzlin499-plugins-manager`、`@zhangzujian/dsh-same-mode-sandbox-noop` …）。两个 profile 都存在，所以：

- **不会报错**（`doInstalled` 找不到 profile 才报 `没有找到 profile`）
- 「已安装」标签显示的是 **web profile 的插件**，不是 desktop 的
- 「可更新」标签对应的是 **web profile 的可更新项**
- 点「安装/更新」→ **把包装进 web profile**，用户重启 desktop 后什么都没变

这不是"降级体验"，是**静默作用在错误的 profile 上**。作者显然是按 `dsh web`（CLI，profile 名就叫 web）设计并测试的，README 的安装段也写 `cd ~/.dsh/profiles/web`。

### 6.2 `process.execPath` 在 desktop 上是 Electron 可执行文件

安装动作要求 `dirname(process.execPath)/node_modules/npm/bin/npm-cli.js` 存在。desktop 部署里：

- 插件宿主进程 = **`DeepSeek Harness.exe`**（本机 PID 79748，命令行 `"…\DeepSeek Harness.exe" --expose-internals "…\app.asar\dsh\node_modules\@deepseek-ai\ds…"`），由 Electron 主进程以 `ELECTRON_RUN_AS_NODE=1` 拉起
- 于是 `dirname(process.execPath)` = `C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness`
- 实测该目录下 **没有任何 `node_modules`**：

```
$ ls "/c/Users/.../Programs/DeepSeek Harness/node_modules/npm/bin/npm-cli.js"
No such file or directory
```

→ `doInstall()` 走 `process.exit(3)`，`console.error('market: npm-cli.js not found: …')`，Host 把退出码 3 变成 `500 {ok:false, message:'安装失败：pnpm 退出码 3'}`。

**即：desktop 上「一键安装」「一键更新」这两件事都会失败，与 profile 与否无关。**（对照：CLI 部署 `C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js` 实测存在，所以作者的假设在 `dsh web` CLI 下成立。）

### 6.3 连带的第二层风险：helper 能否被拉起

Host 用裸 `spawn(process.execPath, [script], {stdio:['ignore',ofd,efd]})`（`index.js:148-151`）跑 helper，**没有显式设 `ELECTRON_RUN_AS_NODE`**，完全依赖宿主进程环境里继承了该变量。

- 我在 asar 里核对：DSH 自己 spawn Node 模式子进程时**都会显式补 `ELECTRON_RUN_AS_NODE: '1'`**（`desktopNodeEnvironment()`，asar `181564596`），说明这不是可以无条件依赖的既有环境
- 宿主 PID 79748 是以 `--expose-internals <script>` 形式启动的，这只能是 node 模式（主进程必然给它设了 `ELECTRON_RUN_AS_NODE=1`），且 asar 中**未见任何 `delete process.env.ELECTRON_RUN_AS_NODE`**（只有沙箱工具执行子进程那一段有"bootstrap 移除 selector"的说明，见 asar `90169469`）

→ 推断 helper 大概率能被以 node 模式拉起，但这是**靠继承环境的巧合，不是契约**。一旦失败，症状是"辅助脚本没有输出结果行"（`index.js:199-205`），目录和已安装清单一起空白。**这一条建议由 lead 在真实 desktop 环境里用一行探针确认**（见 §9）。

### 6.4 顺带发现的其他不精确处

- 目录里带引号的 spec（如 `dsh plugin --profile web add "https://…/dsh-win-notify.tgz"`）会被 `safeSpec` 原样提取成含引号的 spec，pnpm 收到带引号的 argv → 大概率失败。
- 目录里同名不同源条目多处（`dsh-win-notify` 有 3 条：tgz / npm / github；`dsh-mobile-ui` 有 npm / github 两条）。匹配只按名字/spec 归一化，`dsh-win-notify`（用户是 `link:`）被目录的 npm 同名条目"认领"，于是显示 `latest` 而非"判断不了"，属于**误报为已最新**。
- `node_modules` 扫描用 `withFileTypes` 且只收 `isDirectory()`（`market-core.mjs:191-203`）→ `link:` 依赖是符号链接，**不会进 `dirNames`**；`versions` 因为按名字直接读所以还能拿到。两套口径不一致，但当前不影响判定结果。

---

## 7. 网络行为 / 遥测 / 权限面

### 网络

| 时机 | 请求 |
| --- | --- |
| **启动时** | **零请求**。Host 只注册两条路由；无定时器、无后台轮询 |
| 首次打开页面 / 缓存过期（1 h） | 顺序尝试最多 4 个 URL 抓目录（官方 → `gh-proxy.com` 镜像 → jsdelivr CDN → npm registry 取 dist-tags 再取 CDN 固定版本）。**最坏 8.5 MB 下载**，实际常走第一条 |
| 之后 1 h 内 | 0 网络请求（读本地 `catalog.json`） |
| 「强制重新获取」 | `bypass=1`，立即重抓一次 |
| 每次 list 请求 | 本地 spawn 一次 `installed` 子进程（5 s TTL，`INSTALLED_TTL_MS`），**纯本地 IO** |
| 版本判定 | **0 网络请求** |

- UA：`@99galaxy/dsh-plugin-market`（`market-core.mjs:64`）
- **无遥测、无上报、无 token、无鉴权**。除了上述目录地址，不连任何第三方。
- ⚠️ 但目录里每条记录的 `install` 命令是**远端可控数据**，会被直接喂给 pnpm。作者做了防护（单 argv 传递、不用 shell、拒绝以 `-` 开头、拒绝 `..`、长度上限 300、正则白名单前缀），这是这段代码里安全意识最好的部分；但**远端目录仍是信任边界**——目录被投毒 = 本机执行 pnpm install 任意包。

### 权限面

Host 半侧（`index.js`）实际用到的：

| 能力 | 用途 |
| --- | --- |
| `ctx.inject(['webServer'])` + `webServer.register` ×2 | 暴露 `/dsh-plugin-market/list`、`/dsh-plugin-market/install` |
| `node:child_process.spawn` | 跑 helper（catalog / installed / install） |
| `node:fs` 写 | `~/.dsh/.dsh-plugin-market/`：`catalog.json`、`installed.json`、**`market-core.mjs` 自身副本**、`.runs/*.out|err` 临时文件 |
| 子进程内 `spawnSync` | `npm exec pnpm add <spec> -w --dir <profileDir>` → **写 profile 的 `package.json`（dependencies + dsh.profile.bundles）** |

**没有**用 `pluginManager` / `settings` / `loader`；**没有**调用 `dsh plugin` CLI；**没有**动仓库源码。

安全自评：
- 两条路由**不在 `/api` 下**，拿不到 DSH 的 browser-trust fence，作者自己实现了 `Sec-Fetch-Site: cross-site` + `Origin`/`Host` 比对 + `Content-Type: application/json` 校验（`index.js:330-351`）。这是知情后的正确补救。
- 会**把 helper 源码复制到 `~/.dsh/.dsh-plugin-market/` 再执行**（`ensureHelper`）：跑的是包里的文件，但落点在自己 state 目录——若该目录被第三方写入，存在被替换执行的风险（作者用 size+mtime 做一致性校验，能发现漂移，但发现的方式是"覆盖回去"而非拒绝执行）。

---

## 8. 作者对契约的理解（加分项，供我们自己实现时参考）

这段代码里有几处判断值得直接借走：

1. **`ctx.remote` 不能自建命名空间**（生成式 Typert），所以走 `webServer.register` 造两条自用路由——与我的核对一致（`remote.$mount` 只接受生成的贡献）。
2. **子进程输出走文件描述符而非管道**：注释明确写道"pipes are denied outright in DSH's confined sandbox modes, and a plain pipe can also deadlock once the buffer fills"（`index.js:117-121`）。这与 DSH 沙箱在管道上的实际限制吻合（本机 harness 说明亦确认 pipe 捕获在受限模式下 EPERM）。
3. **把远端数据当不可信输入**：spec 单 argv、不用 shell、拒绝前导 `-`、`..`、长度限制。
4. **"判不了"要单独计数，不能静默当成"已最新"**——产品判断正确，正是用户诉求里最容易做错的地方。
5. **`only=updatable` 在 Host 侧过滤、分页、排序**，而不是全量吐给前端——性能口径正确。

顺带核对官方能力边界（供替代方案评估）：`pluginManager` 是 Typert Remote 服务，方法含 `listPlugins` / `listBundles` / `setBundleEnabled` / `setPluginEnabled` / `installBundle` / `waitForInstall` / `cancelInstall` / `removeBundle` / `registries` / `inspect` / `listVersionExemptions` / `setVersionExemption`。`listBundles()` 返回每行的 `spec`（可安装 spec）、`installed` / `enabled` / `availability` / `shipped` / `activation` 等，但**不返回"远端最新版本"**——也就是说**官方现有 API 里没有更新检查能力**，这一点与 lead 已确认的结论一致；但 `installBundle` + `waitForInstall` 是**现成的、有生命周期保证的安装通道**，比社区插件手搓 pnpm 更可靠。

---

## 9. 结论：能否直接替代用户需求？

### 结论：**不能直接用。** 建议"借设计，不借包"。

**明确不能替代的三条硬理由：**

1. **profile 硬编码 `web`**（`index.js:25`）。用户跑 desktop。装了之后「已安装/可更新」显示的是 web profile 的内容，且**不报错**；点安装/更新会写进 web profile。这是静默错误，比报错更危险。
2. **desktop 上安装/更新必然失败**。`dirname(process.execPath)/node_modules/npm/bin/npm-cli.js` 在 Electron 部署下不存在（已实测目录为空），`doInstall` 直接 `exit 3`。所以「一键安装」「一键更新」在用户的真实环境里是坏功能。
3. **更新判定覆盖不到用户的 5 个依赖**。`github:` 包（dsh-svn-tools）因目录 `version` 为 null 永远 `unknown`；4 个 `link:` 本地包里 3 个目录未收录 → `unknown`。用户环境 13 个依赖里，只有 7～8 个 npm 能被判。用户要的"看到哪些插件可更新"，在这台机器上只能覆盖一半多一点。

**次要保留意见：**

4. 目录口径与官方不同（`plugins.json` 7406 条 vs 官方 `index.json` 3730 条），两套数据会长期漂移。
5. 安装走 `npm exec pnpm add` 而非 `dsh plugin add`，然后**手写 `dsh.profile.bundles`**，与官方 CLI 双写同一份文件，存在分叉风险；且失败无回滚。
6. 需要重启 DSH 才生效，不能热更。
7. `link:` 依赖被同名 npm 条目误判为 `latest`（dsh-win-notify 实例），"判断不了"的语义有误报。
8. 无 `engines.dsh`，任何 DSH 版本都会静默装上。

**它对用户需求的正面价值（为什么还值得读）：**

- 「已安装」筛选、「可更新」筛选与计数、`only=updatable`、`installedAs`、`unknownTotal` 单独计数的**产品形态与用户诉求几乎完全一致**——这验证了我们方案的功能定义是对的，不必再纠结"要不要做聚合提示"。
- `settings.section` 单页 + 页内三标签的**信息架构**可以直接照搬（比注册多个 `plugins.tab` 更省导航位）。
- 「判不了就明说，别伪装成最新」这条，应当原样继承。

### 建议的下一步（给 lead）

1. **不要装这个包**。它的两个致命假设都是对着 `dsh web` CLI 写的，改造成 desktop 可用需要改 profile 来源 + 换安装通道，改动量不比自研小，而且要背一个第三方目录口径。
2. **更新检查按我们自己的方案做**：npm 包查 registry（能覆盖 7～8 个），`github:` 包查 commit（或明确标注"需手动更新"），`link:` 包标注"本地开发包，不参与更新"。这样才覆盖用户 13 个依赖的全部，而不是覆盖一半。
3. **安装/更新通道优先用官方 `pluginManager.installBundle` + `waitForInstall`**，而不是手搓 pnpm + 手写 `bundles`——前者有生命周期与失败语义，后者要自己维护。
4. 若坚持要"一条命令装"，可以走官方 `dsh plugin add`（CLI）而不是 `npm exec pnpm`，且在 desktop 下要显式设 `ELECTRON_RUN_AS_NODE=1` 并自行定位 node。
5. **一行探针**（若有人坚持要验 6.3）：在 desktop profile 装任意一个只打印 `process.execPath` + `process.env.ELECTRON_RUN_AS_NODE` 的一次性插件并重启，即可确认 helper 是否真能被拉起。但 §6.1/§6.2 已经是硬阻断，此探针不改变结论。

---

## 附：验真证据索引

| 结论 | 证据 |
| --- | --- |
| 注册 `settings.section` | `client/client.js:416-428` |
| 页内三标签 | `client/client.js:274-299` |
| profile 硬编码 web | `index.js:25`、`market-core.mjs:11`，无任何覆写点 |
| 目录四级降级 | `market-core.mjs:6-9, 74-123`；实测 4 个 URL 均 200 |
| 已安装清单来自读盘 | `market-core.mjs:172-233` |
| 更新判定纯本地 semver | `index.js:295-313`；README:133 |
| 目录 version 覆盖率 3716/7406 | 本机实测 catalog 统计 |
| desktop 13 依赖回放结果 | 本机 `~/.dsh/profiles/desktop` 实测 |
| 安装走 npm exec pnpm | `market-core.mjs:243-314` |
| 手写 `dsh.profile.bundles` | `market-core.mjs:335-357` |
| npm-cli.js 缺失（desktop） | 实测 `ls` 无 `Programs/DeepSeek Harness/node_modules` |
| 宿主进程 = Electron exe | 本机 PID 79748 `DeepSeek Harness.exe --expose-internals …app.asar\dsh\…` |
| DSH 自己补 `ELECTRON_RUN_AS_NODE` | asar `181564596` `desktopNodeEnvironment()` |
| `settings.section` / 字符串 label 合法 | asar `50061262` 官方 slot 契约示例 |
| `webServer.register kind:'exact'` 合法 | asar `22621486` 官方 `dsh-client-connection` 同形用法 |
| `pluginManager` 无更新检查能力 | `dsh-plugin-manager/lib/index.js` `listBundles()` |