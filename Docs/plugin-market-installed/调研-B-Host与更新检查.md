# 调研 B：Host / 数据侧与「更新检查」可行性

> 调研日期：2026-10-28 ｜ 调研范围：DSH 设置页「安装、启用和配置插件 → 发现」页（官方实验性插件市场）的数据来源、已安装清单来源、以及"哪些已安装插件有新版本"的可实现路径。
> 本文只读调研，未修改仓库源码，也未修改 `/d/tmp/dshx` 下的官方源码副本。

---

## 0. 结论先行（给决策用的 5 句话）

1. **官方「发现」页其实已经有更新信息**，但它只在"市场索引里有这个包"时才成立：Host 的 `installation.status` 会返回 `'update-available'`（`dsh-plugin-market/lib/types/index.js:329-343`），Discover 卡片已经渲染中文「有新版本」/「已安装」（`dsh-client-ui-plugin-market/lib/client.js:1158-1160, 239`）。用户看不到，是因为**我们自己的插件全是 GitHub `link:` / `github:` 装的，压根不在索引 3730 条里**（实测 `dsh-mcp-compat`、`dsh-ctx-menu`、`dsh-quick-file`、`dsh-version-control`、`hooks-adapter` 等全部 absent）。
2. **"已安装清单 + 版本"有权威公开来源**：`pluginManager.listBundles()`（`BundleInfo` 含 `name / version / installed / availability / source / installTarget / removable`）。它是 `Remote` 方法，**Client 半侧也能直接调**（`ctx.remote.pluginManager.listBundles()`），不需要我们自己写 Host 服务。
3. **更新信息"能不能拿到"：能，但要分三类算，而且必须自己算**：
   - npm 包 → 查 registry `dist-tags.latest` 比版本（实测 Node `fetch` 到 npmmirror 170ms 通）；
   - GitHub 包 → 读 `pnpm-lock.yaml` 里 pnpm 记录的 **commit sha**，和 GitHub API 的 HEAD 比（实测通，已发现 `dsh-svn-tools` 落后 1 个 commit）；
   - `link:` 本地目录包 → 无远端，判为"本地/开发中"，不给更新提示。
4. **公开 API 里没有任何"帮我查更新"的方法**：`pluginManager.inspect(spec)` 对已安装包会直接 `refused('already-installed')`（`:452-454`），对 git spec 更是不解析版本（`:428` 只回 `{kind:'git', bundle:null}`）；`dsh plugin` 只是 pnpm 的转发器，没有 `update/list` 子命令。所以更新检查要自己组合：本地清单 + registry/GitHub 网络查询。
5. **风险最大的不是数据，是"发现页"本身不可扩展**：`pluginMarket.search()` 的查询结构体 `MarketQuery` 只有 `text / category / labels / sort / offset / limit`（`types/search.js:49-69`，`typert.host.js:19-40`），**没有 installed 过滤，也没有"按安装状态排序"**；索引是服务端分页（`limit ≤ 100`、共 3730 条 = 38 次请求）。要"把已安装排到最前"，只能在客户端把全量页拉下来自己排，或者另开一个自己的 UI。

---

## 1. 官方「发现」页的数据链路（Host 侧全景）

### 1.1 挂载与配置

`@deepseek-ai/dsh-experimental-plugin-market-bundle/cordis.patch.yml`（只读副本 `/d/tmp/dshx/dsh-experimental-plugin-market-bundle/cordis.patch.yml`）：

```yaml
- insert:
    - id: plugin-market
      name: '@deepseek-ai/dsh-plugin-market'
      disabled: !!js "!ctx.get('profileContext')"
    - id: ui-plugin-market
      name: '@deepseek-ai/dsh-client-ui-plugin-market'
```

`dsh-plugin-market` 的 Config（`lib/types/index.js:78-83`）：

```js
static Config = z.object({
    indexes: z.array(z.string().pattern(/^https?:\/\/\S+$/u)).default([]).volatile(),
    fetchTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(15000),
    maxBytes: z.natural().min(1).default(128 * 1024 * 1024),
    cacheTtlMs: z.natural().default(600000),
});
static inject = ['pluginManager'];
```

**当前这台机器上，实际生效的是 `desktop` profile，索引 URL 配在它的组合层里**：

`~/.dsh/profiles/desktop/cordis.yml:1466-1472`

```yaml
- id: plugin-market
  name: '@deepseek-ai/dsh-plugin-market'
  disabled: !!js '!ctx.get(''profileContext'')'
  config:
    indexes:
      - https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json
```

> 重要环境修正：本机 `~/.dsh/profiles/web` 的 `package.json.dsh.profile.bundles` **不含** `@deepseek-ai/dsh-experimental-plugin-market-bundle`，`dsh --profile web --dump-config` 里也没有顶层 `plugin-market` 行（只有 preset 里 disabled 的 `tool-plugin-market`）。**用户看到的「发现」页来自 desktop profile。**
> 实测 `cordis_inspect_query(Service.pluginMarket)` 能取到服务 → 服务是活的；`Config.listConfigs` 的 entry id 带 `include:` 前缀（`include:plugin-market`），不带前缀会报 `unknown entry id`。

### 1.2 索引读取与缓存

`lib/types/index.js`：

| 行号 | 内容 |
|---|---|
| `:112-122` | `listIndexes()` — 只列已配置源，不 fetch；返回 `{url, title?, description?, error?}` |
| `:131-145` | `setIndexes(urls)` — 走 `settings.update(entryId, {indexes})`，不发 `plugin-market/changed` 之外的重载 |
| `:157-180` | `search(url, query)` — 唯一带分页的读取入口（`limit 1..100`，`MAX_LIMIT=100` at `:58`） |
| `:190-193` | `entry(url, name)` — 单条读取（**注意：无 `@Remote` 装饰器，只有 Host 进程内可调用，未暴露给浏览器**） |
| `:194-204` | `document()` — 命中 `cacheTtlMs`（默认 10 分钟）复用；`fetchedAt` 相同则强制复用同一份文档（保证翻页一致） |
| `:233-275` | `fetchShared` / `fetchIndex` — `fetch(url, {redirect:'error', headers:{accept:'application/json'}})` + `AbortSignal.timeout(fetchTimeoutMs)` |
| `:269` | 校验在工作线程里做（`parseIndexInWorker`），主线程不解析 2.5MB JSON |
| `:276-306` | `readBody` — 超过 `maxBytes` 直接拒 |

索引 URL 规整（`lib/types/index-url.js:10-26`）：必须 `http(s)`、无 credentials、无 fragment、且必须是规范化形式（`normalizeIndexUrl(url) === url`），否则该源被标记 `error` 且**永不 fetch**（`index.js:216-229`）。

### 1.3 索引 schema（format 1）——每个条目到底有什么字段

校验器：`@deepseek-ai/dsh-plugin-market-index/lib/index.js`（`parseMarketIndex` at `:280-303`）。规则是**未定义的成员被静默丢弃**（`:272-273` 注释："Members the format does not define are ignored and dropped"）。

顶层：

```jsonc
{
  "format": 1,                     // :284 必须 === 1
  "title": LocalizedText,          // :294 必须有 en
  "description": LocalizedText?,   // :295
  "metadata": {                    // :89-96
    "categories": { "<id>": { "title": LocalizedText } },
    "labels":     { "<id>": { "title": LocalizedText } },
    "sortKeys":   { "<id>": { "title": LocalizedText, "order": "asc"|"desc" } }
  },
  "plugins": [ Plugin ]            // :286-293，name 不得重复
}
```

`Plugin`（`:250-271`）：

```jsonc
{
  "name": "npm 包名",              // :252-253 校验 PACKAGE_NAME
  "title": LocalizedText?,         // :254
  "description": LocalizedText?,   // :255
  "icon": "url 或 data:base64",    // :256, icon() :209-225
  "author": "string?",             // :257
  "homepage": "http(s) url?",      // :258
  "repository": { "url": "http(s)", "directory": "相对目录?" },  // :259, :167-175
  "metadata": { "category": id?, "keywords": [], "labels": [], "sortKeys": {} }, // :102-133
  "versions": [ MarketVersion ]    // :269，非空、版本不重复、按 semver 降序排好（:239-249）
}
```

`MarketVersion`（`:226-238`）：**这是"版本信息"的全部**

```jsonc
{
  "version": "1.2.3",              // :228-229 必须精确 SemVer
  "publishTimestamp": 1793034373,  // :230-231 整数 Unix 秒，∈[0, 10^11)
  "source":                        // :176-199
    { "type": "npm", "registry": "https://..."? }
  | { "type": "git", "url": "https://...", "commit": "<40位小写hex>", "path": "子目录?" },
  "engines": { "dsh": "SemVer range" }  // :200-208
}
```

安装参数生成 `marketInstallTarget(name, version)`（`:311-318`）：

- npm → `{ spec: "name@version", registry? }`
- git → `{ spec: "git+<url>.git#<40位commit>&path:/<subdir>" }`（**commit 是钉死的 40 位 sha**）

**结论：索引条目确实含 `version`（每版本一条）、`repository.url`（GitHub 仓库）、`repository.directory`（子目录）、`publishTimestamp`（发布时间）；不含 git ref/branch 名，但 git 源会带精确 commit sha。**

### 1.4 线上索引实测（`https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`）

用 Node `fetch` 拉下来（2,515,570 字节，HTTP 200）：

```
format 1
title  {"en":"Awesome DSH Plugin","zh":"Awesome DSH Plugin 插件精选"}
plugins 3730
plugin keys : name, title, description, homepage, repository, metadata, versions
version keys: version, publishTimestamp, source, engines
npmVersions 3730 / gitVersions 0        ← 全站只有 npm 源
withRepo 3730 / withHome 3730
multiVer 0                              ← 每个插件只有 1 个版本
categories 23 / labels 0 / sortKeys {}
publishTimestamp 范围 1786625742 .. 1793069003
```

条目样例：

```json
{
  "name": "@yolk_vat-y/dsh-project-memory",
  "title": "00080000/dsh-project-memory",
  "description": { "zh": "…", "en": "…" },
  "homepage": "https://awesome-dsh-plugin.com/p/00080000/dsh-project-memory/",
  "repository": { "url": "https://github.com/00080000/dsh-project-memory" },
  "metadata": { "category": "memory", "keywords": [], "labels": [], "sortKeys": {} },
  "versions": [
    { "version": "0.6.6", "publishTimestamp": 1793034373, "source": { "type": "npm" }, "engines": {} }
  ]
}
```

**本机已装插件在索引里的命中情况**（这是最关键的负面发现）：

| 包名 | 安装方式 | 索引里 |
|---|---|---|
| `dsh-mcp-compat` | `link:` | ❌ absent |
| `dsh-quick-file` | `link:` | ❌ absent |
| `dsh-version-control` | `link:` | ❌ absent |
| `dsh-ctx-menu` | `link:` | ❌ absent |
| `hooks-adapter` | `link:` | ❌ absent |
| `dsh-yzlin499-plugins-manager` | `link:`（软链已失效） | ❌ absent |
| `@zhangzujian/dsh-same-mode-sandbox-noop` | `github:` | ❌ absent |
| `dsh-svn-tools` | `github:` | ❌ absent |
| `dsh-win-notify` | `link:`（本地 0.1.0） | ⚠️ 命中的是**别人同名包** `kongdexu/dsh-win-notify@0.1.0` |

只有走 npm 发布的第三方插件（`dsh-chat-import`、`dsh-ide-git`、`dsh-context`、`dsh-mobile`、`dsh-ops`、`dsh-mnemon`、`dsh-better-sidebar`）才可能在发现页拿到"有新版本"。

---

## 2. 已安装清单 + 版本从哪里读

### 2.1 `pluginInventory.list()` —— 有清单，**没有版本**

`@deepseek-ai/dsh-host-plugin-inventory/lib/types/index.js:64-98`：服务名 `pluginInventory`，`inject: ['loader']`，唯一方法 `list()`。

投影逻辑 `readPluginInventory(ctx)`（`:103-135`）逐条产出：

```js
{ entryId, moduleName, enabled, fiberPhase, meta? }   // :111-117
```

- `meta` 来自 `ctx.get('pluginPackages')?.metaOf(name, baseUrl)` —— 只有 `title / description / icon / error`。
- 返回值顶层还有 `managementAvailable: boolean`（`:120`）与可选的 `agentPresets`。

**判定：`pluginInventory` 只能回答"有哪些插件、开着没、跑起来没"，回答不了"版本是多少、从哪装的"。** `dsh-client-ui-settings-plugin-inventory` 用的就是它（`lib/client.js:740`）；`dsh-client-ui-settings-plugins` 的 Host 半侧是空 `apply(){}`（`lib/index.js`），只是一个 UI 壳。

### 2.2 `pluginManager.listBundles()` —— **这才是权威的"已安装 + 版本 + 来源"**

`@deepseek-ai/dsh-plugin-manager/lib/types/index.js:310-391`。服务名 `pluginManager`（`inject: ['loader']`），方法列表见 §4。

返回 `BundleInfo`：

```ts
export interface BundleInfo {
    name: string;
    official: boolean;
    availability: 'installation' | 'profile' | 'missing';
    installTarget?: { spec: string; version: string };   // ← 只有官方 on-demand 目录才有
    version?: string;                                    // ← 已安装版本
    meta?: PluginLocalizedMeta;
    description?: string;
    enabled: boolean;
    installed: boolean;
    source?: string;                                     // ← 可重装的 spec
    optional: boolean;
    removable: boolean;
    readOnlyReason?: ReadOnlyReason;
    error?: ManagementError;
    rows: BundleRowInfo[];
    overrides: string[];
}
```

关键实现点：

- `:316` 读 `readProfileManifest('dsh', profile.dir)` → profile 的 `package.json`；
- `:318-323` `names` = 选中 bundles ∪ dependencies ∪ 安装目录依赖 ∪ 官方目录，**去重**；
- `:327-330` `installed = dependencies.includes(name)`，`enabled = selected.includes(name)`，`shipped = 安装目录里也有`；
- `:353` `sourceOf = () => owned ? { source: dependencySpec(name, recorded[name], profile.dir, packageName) } : {}` —— `source` 是**可直接喂回 pnpm 的 spec**；
- `:367` `version = info.version` —— `info` 来自 `bundleManifest(...)`，即**读 `node_modules/<name>/package.json`**；
- `:371-372` `meta = readPluginMeta(join(dir,'package.json').href)`。

`dependencySpec()`（`lib/types/install-spec.js:104-118`）：`link:`/`file:` 补成绝对路径；其它非 registry 协议（`github:` 等）原样返回；registry 范围则拼成 `name@range`。

**判定：`~/.dsh/profiles/<p>/node_modules/<pkg>/package.json` 的 `version` 就是权威已安装版本**（`listBundles` 与 `plugin-manager` 的"可更新"判定都读它），而 `profile/package.json.dependencies` 的 value 是"安装来源"。

### 2.3 本机实测（desktop profile，13 个依赖）

```
package                                     recorded spec                                   installed
@deepseek-ai/dsh-subagent-codex             0.2.1-rc.3                                      0.2.1-rc.3
dsh-better-sidebar                          0.28.0                                          0.28.0
dsh-chat-import                             ^0.25.2                                         0.25.2
dsh-context                                 0.75.1                                          0.75.1
dsh-ctx-menu                                link:D:/…/dsh-ctx-menu                           0.2.3
dsh-ide-git                                 ^0.18.2                                         0.18.2
dsh-mcp-compat                              link:D:/…/dsh-mcp-compat                         0.8.1
dsh-mnemon                                  0.5.33                                          0.5.33
dsh-mobile                                  0.6.12                                          0.6.12
dsh-ops                                     ^0.3.0                                          0.3.0
dsh-svn-tools                               github:zengweicheng666/dsh-svn-tools             0.13.4
dsh-win-notify                              link:D:/…/dsh-win-notify                         0.1.0
hooks-adapter                               link:E:/DSHPlugins/hooks-adapter                 0.1.0
```

`~/.dsh/profiles/web` 另有 7 个依赖，其中 `dsh-quick-file`、`dsh-yzlin499-plugins-manager` 的 `node_modules` 链接已断（读不到 `package.json`）——这正是 `dsh plugin --profile web list` 末尾崩在 `reconcile()` 的原因（见 §5.3）。`listBundles()` 会把这种情形报成 `error.code`，不会抛异常（`:381-388` 的 catch 分支）。

---

## 3. 更新检查可行性判定（核心）

### 3.1 一张表：四类"最新版本"来源

| 已安装形态 | 本地"当前" | "最新"从哪来 | 实测 | 结论 |
|---|---|---|---|---|
| **A. npm/registry**（`^0.25.2` / `0.28.0`） | node_modules 的 `version` | `GET <registry>/<name>` → `dist-tags.latest` | npmmirror 200/170ms | ✅ 最可靠，semver 直接比 |
| **B. GitHub 仓库整包**（`github:owner/repo`） | lockfile 里的 commit sha | `GET api.github.com/repos/o/r/commits?per_page=1` → `sha` | 200/598ms | ✅ 可靠（sha 比较，不依赖 package.json 是否改版本） |
| **C. GitHub 子目录**（`github:owner/repo#path:/dsh-x`） | 同上（pnpm 记 codeload tarball sha） | 同上，**但仓库 HEAD 变了不等于这个子包变了** → 需再读该子目录 `package.json` 的 version | 200/431ms（raw） | ⚠️ 可行但会误报，需二次确认 |
| **D. 本地目录**（`link:` / `file:`） | node_modules 的 `version` | 无 | — | 🚫 判"本地/开发中"，不提示更新 |

### 3.2 A 类：registry 版本比较

- 注册表来源用公开方法 `pluginManager.registries()` 取（`{registry, fallbackRegistries, resolved}`，`:395-402`），就是 pnpm 实际会问的那个；本机 `pnpm config get registry` = `https://registry.npmmirror.com`。
- 也可以用已安装条目的 npm 源 `https://registry.npmjs.org/…` 做兜底（实测也通，670ms）。
- ⚠️ 坑：`@deepseek-ai/dsh-subagent-codex` 在 npmmirror 上 `dist-tags.latest = 0.0.1-rc.1`，本地却是 `0.2.1-rc.3` —— **预发布版本 / 镜像滞后会算出反向结论**。判定必须先做"候选 > 当前"的 semver 比较（含 prerelease 规则），并且永远不要把"取不到"当"有更新"。

### 3.3 B/C 类：git 依赖怎么判"有更新"

`profile/package.json` 里 pnpm 只记 `github:owner/repo`（或 `#path:/sub`），**不记 commit**。但 `pnpm-lock.yaml` 记了（实测 desktop profile）：

```yaml
importers:
  .:
    dependencies:
      dsh-svn-tools:
        specifier: github:zengweicheng666/dsh-svn-tools
        version: https://codeload.github.com/zengweicheng666/dsh-svn-tools/tar.gz/ceb3a941d9f4a3f3f85c1bec9e6bd70d7f42b611(@deepseek-ai/schemastery@3.18.5)(dsh-better-sidebar@0.28.0)
packages:
  dsh-svn-tools@https://codeload.github.com/zengweicheng666/dsh-svn-tools/tar.gz/ceb3a941d9f4a3f3f85c1bec9e6bd70d7f42b611:
    resolution: {gitHosted: true, integrity: sha512-…, tarball: https://codeload.github.com/…/tar.gz/ceb3a941d9f4a3f3f85c1bec9e6bd70d7f42b611}
    version: 0.13.4
```

→ 本地 commit = `ceb3a941…`。远端 HEAD（实测）= `b6c6973552d83d7c89fa41f8183bcc28005e7331`（2026-10-2x）→ **判"有更新"**。

**C 类（子目录）的正确做法**（我们的插件全是这种 `#path:/dsh-xxx`）：commit 变了只是"可能变了"。要进一步读子目录 `package.json` 的 `version` 才能确认该子包是否真的发版：

- 首选 **GitHub Contents API**：`GET api.github.com/repos/o/r/contents/<subpath>/package.json?ref=<head-sha>` → JSON 里 `content` 是 base64（实测 200，约 600ms）。
- `raw.githubusercontent.com` 也能用（Node `fetch` 实测 200/431ms），**但 `curl` 在这台机器上会因 `CRYPT_E_REVOCATION_OFFLINE` 失败**（schannel 吊销列表离线）——这是 curl 的问题，不是网络不通；写代码请用 Node `fetch`，不要 `execSync('curl …')`。
- 结论：**建议 B/C 类只做"commit 变了"这一级提示 + 展示新 commit 短 sha/日期**，用户点更新时再让 pnpm 拉。不要为了"精确版本号"去抓 raw（额外依赖、额外失败面、GitHub 限流 60 次/小时未认证）。

### 3.4 端到端实测（可行性证明）

探针脚本（只读，放在 `/d/tmp/probe-updates.mjs`，不在仓库里）：读 profile `package.json` + `pnpm-lock.yaml` + 各 `node_modules/*/package.json`，按上表分派。

`desktop` profile 实跑结果：

```
profile: C:/Users/Administrator/.dsh/profiles/desktop
registry: https://registry.npmmirror.com

package                          kind      installed   newest               status
@deepseek-ai/dsh-subagent-codex  registry  0.2.1-rc.3  0.0.1-rc.1           up-to-date
dsh-better-sidebar               registry  0.28.0      0.28.2               UPDATE 0.28.0 -> 0.28.2
dsh-chat-import                  registry  0.25.2      0.26.2               UPDATE 0.25.2 -> 0.26.2
dsh-context                      registry  0.75.1      0.77.0               UPDATE 0.75.1 -> 0.77.0
dsh-ctx-menu                     local     0.2.3                            local/dev (no remote)
dsh-ide-git                      registry  0.18.2      0.21.0               UPDATE 0.18.2 -> 0.21.0
dsh-mcp-compat                   local     0.8.1                            local/dev (no remote)
dsh-mnemon                       registry  0.5.33      0.5.36               UPDATE 0.5.33 -> 0.5.36
dsh-mobile                       registry  0.6.12      0.6.18               UPDATE 0.6.12 -> 0.6.18
dsh-ops                          registry  0.3.0       0.4.3                UPDATE 0.3.0 -> 0.4.3
dsh-svn-tools                    git       0.13.4      HEAD b6c69735        UPDATE (locked ceb3a941 -> b6c69735)
dsh-win-notify                   local     0.1.0                            local/dev (no remote)
hooks-adapter                    local     0.1.0                            local/dev (no remote)

8 update(s) among 13 dependencies
```

`web` profile：7 个依赖里 1 个 git（`@zhangzujian/dsh-same-mode-sandbox-noop`，locked `d6f43662` = HEAD → up-to-date），其余 `link:`。

**→ "哪些已安装插件有新版本"这个问题，答案是可以拿到的，且本机现在就有 8 个。**

### 3.5 更新动作（不是只读，但记录在此）

- 公开 API：`pluginManager.installBundle(spec, options)`（`ChangeResult`，含 `pendingBuilds` 需二次批准、`restart-required` 等），`waitForInstall(requestId)`、`cancelInstall(requestId)`。
- 用 `BundleInfo.source`（就是可重装 spec）+ 新的 `version` 拼：registry → `installBundle('<name>@<latest>')`；git → `installBundle('github:owner/repo#path:/dsh-x')`（**不带 commit 就会取默认分支最新**，这是更新生效的关键）。
- 也可以用 CLI：`dsh plugin --profile <p> update [<pkg>...]` 直接把参数转发给 pnpm（见 §5.2）。
- ⚠️ `BundleInfo.installTarget` **只对官方 on-demand 目录的 bundle 存在**（`offline official-install-target.js:22-…` 的 `officialBundleInstallTarget`）。这解释了为什么官方插件页的"可更新"角标对第三方插件永远不亮（`dsh-client-ui-plugin-manager/lib/client.js:2614-2619`：`target === undefined` 直接 `return false`）。

---

## 4. Host Service 签名清单（我们可用的公开面）

全部通过 `cordis_inspect_query(platform=host, provider=Service, method=listService, {service})` 取得，属官方公开契约。

### 4.1 `pluginMarket`（`@deepseek-ai/dsh-plugin-market`，`inject: ['pluginManager']`）

| 方法 | 签名 | 暴露级别 |
|---|---|---|
| `listIndexes` | `(): MarketIndexSummary[]` | `@Remote`（Host + Client 均可） |
| `setIndexes` | `(urls: string[]): Promise<void>` | `@Remote` |
| `search` | `(url: string, query: MarketQuery): Promise<MarketSearchResult>` | `@Remote` |
| `entry` | `(url: string, name: string): Promise<MarketListingEntry \| undefined>` | **无 `@Remote`，仅 Host 进程内** |

`MarketQuery`（**没有 installed 维度**）：

```ts
{ text?: string; category?: string; labels?: readonly string[];
  sort: { kind:'index' } | { kind:'relevance' }
      | { kind:'published', direction:'asc'|'desc' }
      | { kind:'key', id:string, direction:'asc'|'desc' };
  offset: number; limit: number;              // limit ∈ [1,100]
  refresh?: boolean; fetchedAt?: number }
```

`MarketListingEntry`：

```ts
{ name; title?; description?; icon?; author?; homepage?; repository?; metadata;
  versions: MarketListingVersion[];           // 每项多了 install: {spec, registry?} 与 compatibility
  defaultVersion?: string;
  installation: { status: 'not-installed'|'installed'|'update-available'|'different-version'|'provided';
                  installedVersion?: string } }
```

`installation` 的算法（`lib/types/index.js:329-343`，这就是"官方已有的更新判断"）：

```js
function installationOf(name, version, bundles) {
    const bundle = bundles.find(candidate => candidate.name === name);
    if (bundle === undefined || (!bundle.installed && bundle.availability !== 'installation'))
        return { status: 'not-installed' };
    if (!bundle.installed) return { status: 'provided', ...(installedVersion?) };
    if (bundle.version === undefined) return { status: 'different-version' };
    const installedVersion = bundle.version;
    if (installedVersion === version) return { status: 'installed', installedVersion };
    const newer = semver.valid(installedVersion) !== null && semver.gt(version, installedVersion);
    return { status: newer ? 'update-available' : 'different-version', installedVersion };
}
```

→ 它**只用 `pluginManager.listBundles()` + 索引里的 `defaultVersion`**，纯本地 + 索引，不发额外网络请求。`defaultVersion` 取"兼容当前 DSH 且稳定的最高版本"（`:311-328` `listingOf`）。

### 4.2 `pluginManager`（`@deepseek-ai/dsh-plugin-manager`，`inject: ['loader']`）

| 方法 | 用途（与我们相关的） |
|---|---|
| `listBundles(): Promise<BundleInfo[]>` | **已安装清单 + 版本 + source + installTarget** ← 主数据源 |
| `listPlugins(): Promise<PluginInfo[]>` | Loader 行（`entryId/moduleName/enabled/fiberPhase` + `patchId` 或 `readOnlyReason`） |
| `registries(): Promise<{registry, fallbackRegistries, resolved}>` | 查最新版本时该问哪个 registry |
| `inspect(spec, opts?, signal?)` | **不能用于已安装包**（`already-installed` 直接拒；git 不解析版本） |
| `installBundle(spec, opts?)` | 安装/更新（可 `{enabled, saveExact, requestId, approvedBuilds, registry}`） |
| `waitForInstall` / `cancelInstall` | 长任务编排 |
| `removeBundle(name)` / `setBundleEnabled` / `setPluginEnabled` | 卸载 / 启停 |
| `listVersionExemptions` / `setVersionExemption` | 版本豁免 |

### 4.3 其它可用服务

- `pluginInventory.list()` — Loader 视图，**无版本**（§2.1）。
- `webServer.register({kind:'exact'|'prefix', path, handler}) → disposer` — **Host 半侧把自己的数据投给自己 Client 半侧的最省事、最公开的通道**（`ctx.webServer.register` 卸载自动清理，符合本仓 AGENTS.md 约定）。`register` 对重复 `(kind,path)` 抛错，所以路径要带命名空间。
- 事件：`plugin-manager/changed(change: PluginChange)`（安装/启停/组合变化后失效缓存）、`plugin-market/changed()`（索引源变化）。
- `ctx.get('pluginPackages')`（`@deepseek-ai/dsh-plugin-package-inventory-deepseek`）：`metaOf(name, baseUrl)` 取 `title/description/icon`，**不含版本**。

### 4.4 Client 半侧可直接用的 Remote 面（不需要我们写 Host 服务）

`dsh-client-ui-plugin-manager/lib/client.js:4357-4366` 的注入列表就是证据：

```js
const inject = ["slots","locale","remote","remote.pluginManager","remote.pluginInventory","remote.pluginRegistryProbe","configForms","layout"];
```

`dsh-client-ui-plugin-market/lib/client.js:1585-1590`：`["slots","locale","remote","remote.pluginMarket"]`。

→ 我们的 `client.js` 只要声明 `inject: ["remote", "remote.pluginManager", "remote.pluginMarket"]`，就能：
- `await ctx.remote.pluginManager.listBundles()` 拿已安装 + 版本 + source；
- `await ctx.remote.pluginMarket.search(url, query)` 拿索引条目（含 `installation.status`）；
- `ctx.remote.$on('plugin-manager/changed', …)` / `'plugin-market/changed'` 做失效刷新。

**这基本覆盖"已安装筛选 + 更新角标"的全部数据需求，且零非公开依赖。**

---

## 5. CLI 能力实测（真实输出）

### 5.1 `dsh --help`

```
Usage: dsh [--profile] <name> [options] [app-args...]
       dsh plugin --profile <name> <pnpm-args...>

dsh: boot a DeepSeek Harness profile — an ordered stack of plugin-bundle patch
layers under your own overrides.

Arguments:
  args                           arguments for the booted profile's app (see:
                                 dsh --profile <name> --help)

Options:
  -V, --version                  output the version number
  --profile <name>               the profile under $DSH_HOME/profiles to boot
  --from-default-profile <name>  replace a custom profile with a fresh copy of a
                                 shipped profile template
  --patch <path>                 extra patch-list overlay applied after the
                                 profile layer (repeatable)
  --dump-config                  print the composed profile tree and exit
  --dump-config-schema           print JSON Schema for profile entries and
                                 patches without mounting
  --dump-default-config          print the profile tree without its user layer
                                 or --patch overlays and exit

Examples:
  dsh web                                   boot the web profile (same as: dsh --profile web)
  dsh rescue --from-default-profile web     recreate rescue from the shipped web template, then boot it
  dsh headless "run the tests"              answer one task, print the result, and exit
  dsh tui --patch ./extra.yml               boot a custom profile with one extra overlay
  dsh tui --resume <session>                arguments after the launcher flags reach the app
  dsh web --help                            the web app's own flags and help
  dsh plugin --profile tui add <package>    install a plugin into the tui profile
```

### 5.2 `dsh plugin --help` —— **没有 update/list 子命令，纯 pnpm 转发**

```
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

`dsh.cmd` 本体：

```bat
@echo off
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\..\..\..\DeepSeek Harness.exe" --expose-internals "%~dp0..\..\..\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" %*
```

> 注意 `dsh` 不在 PATH 里能直接被 bash `which` 找到的形态（只有 `dsh.cmd` 在
> `C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin`），
> 用 `cmd //c "dsh.cmd …"` 调用最稳。

### 5.3 `dsh plugin --profile web list --depth 0`

```
Legend: production dependency, optional only, dev only

dsh-profile-web C:\Users\Administrator\.dsh\profiles\web (PRIVATE)
│
│   dependencies:
├── @zhangzujian/dsh-same-mode-sandbox-noop@0.1.4
├── dsh-mcp-compat@link:D:/Users/Administrator/workspace/AIProject/dsh-yzlin499-easy-plugins/dsh-mcp-compat
├── dsh-quick-file@link:…/dsh-quick-file
├── dsh-version-control@link:…/dsh-version-control
├── dsh-win-notify@link:…/dsh-win-notify
├── dsh-yzlin499-plugins-manager@link:…/dsh-yzlin499-plugins-manager
└── hooks-adapter@link:E:/DSHPlugins/hooks-adapter

7 packages
```

随后进程在 `reconcile()` 崩掉（**已知的软链失效问题，与本次调研结论无关，但会影响任何"跑一遍 dsh plugin 然后解析输出"的方案**）：

```
Error: dsh: cannot resolve profile bundle "dsh-yzlin499-plugins-manager" from the dsh installation or C:\Users\Administrator\.dsh\profiles\web; run 'dsh plugin --profile web install' if its dependency is not installed
    at resolveBundleDir (…\app.asar\dsh\node_modules\@deepseek-ai\dsh-app-boot\lib\index.js:1000:8)
    at bundleManifest (…\dsh-plugin-manager\lib\types\operations.js:84:24)
    at reconcile (…\operations.js:101:30)
```

**教训：不要用"跑 CLI 抓输出"实现已安装清单/更新检查**——它慢（每次起一个 Electron 进程 + pnpm）、会因坏链接整体失败、且输出是给人看的。用 `listBundles()` + 自己读 `node_modules/*/package.json`。

### 5.4 `dsh plugin --profile web update --help`（pnpm 10.27.0 / 报 11.28.5 的 help 文本）

```
Usage: pnpm update [-g] [<pkg>...]

Aliases: up, upgrade

Updates package dependencies to their latest version based on the specified range.
GitHub Actions dependencies can be included with --include-github-actions. You can
use "*" in a dependency name to update all dependencies with the same pattern.
…
```

→ 用 CLI 更新可行：`dsh plugin --profile web update dsh-chat-import`。但注意 pnpm `update` 只在**声明的 range 内**升级（`0.28.0` 这种精确版本不会动），要跳版本得 `dsh plugin … add <name>@<version>`；这与 `installBundle('<name>@<ver>')` 等价。

---

## 6. 关键代码锚点（`文件:行号`）

### 官方（只读副本 `/d/tmp/dshx`、`/d/tmp/dshx2`）

| 锚点 | 说明 |
|---|---|
| `dsh-plugin-market/lib/types/index.js:78-83` | `PluginMarket.Config`（indexes / timeout / maxBytes / cacheTtl） |
| `dsh-plugin-market/lib/types/index.js:112-122` | `listIndexes()` |
| `dsh-plugin-market/lib/types/index.js:131-145` | `setIndexes()` → `settings.update` |
| `dsh-plugin-market/lib/types/index.js:157-180` | `search(url, query)`（唯一分页入口） |
| `dsh-plugin-market/lib/types/index.js:190-193` | `entry(url, name)`，**无 `@Remote`** |
| `dsh-plugin-market/lib/types/index.js:194-204` | `document()` 缓存/`fetchedAt` 钉文档 |
| `dsh-plugin-market/lib/types/index.js:311-343` | `listingOf` + `installationOf`：`'update-available'` 的唯一产出点 |
| `dsh-plugin-market/lib/types/index.js:344-350` | `compatibilityOf`（`engines.dsh` 兼容性） |
| `dsh-plugin-market/lib/types/index-url.js:10-26` | `normalizeIndexUrl`（http(s)/无凭据/规范化） |
| `dsh-plugin-market/lib/types/search.js:49-69` | `MarketSearch.select`：**只有 text/category/labels/sort，无 installed** |
| `dsh-plugin-market/lib/types/search.js:110-133` | `order()`：`published` 按 `max(publishTimestamp)` |
| `dsh-plugin-market-index/lib/index.js:226-249` | `MarketVersion` 校验 + 版本降序排序 |
| `dsh-plugin-market-index/lib/index.js:250-303` | `Plugin` / `parseMarketIndex`（format 1，丢弃未定义字段） |
| `dsh-plugin-market-index/lib/index.js:311-318` | `marketInstallTarget`（npm `name@ver` / git `git+url#commit&path:/sub`） |
| `dsh-host-plugin-inventory/lib/types/index.js:92-135` | `pluginInventory.list()` / `readPluginInventory`（**无 version**） |
| `dsh-plugin-manager/lib/types/index.js:315-391` | `listBundles()`（version/source/installTarget 的产处） |
| `dsh-plugin-manager/lib/types/index.js:353` | `sourceOf` = `dependencySpec(...)` |
| `dsh-plugin-manager/lib/types/index.js:409-499` | `inspect()`：`:428` git 不解析版本；`:452-454` 已安装直接拒 |
| `dsh-plugin-manager/lib/types/install-spec.js:58-87` | `parseInstallSpec`（registry/git/path/tarball 判别） |
| `dsh-plugin-manager/lib/types/install-spec.js:104-118` | `dependencySpec`（记录值 → 可重装 spec） |
| `dsh-plugin-manager/lib/types/official-install-target.js:22-…` | `officialBundleInstallTarget`（`installTarget` 只对官方目录） |
| `dsh-client-ui-plugin-manager/lib/client.js:2614-2619` | `updateAvailable(pkg)`：`target === undefined` → false（第三方永不亮） |
| `dsh-client-ui-plugin-market/lib/client.js:1158-1160` | 中文串「已安装 / 有新版本 / 随 DSH 提供」 |
| `dsh-client-ui-plugin-market/lib/client.js:1421-1470` | `load(url, query, count=50)` 循环翻页（`MAX_PAGE` 上限） |
| `dsh-client-ui-plugin-market/lib/client.js:1585-1590` | `inject` 含 `remote.pluginMarket` |
| `dsh-experimental-plugin-market-bundle/cordis.patch.yml` | 挂载 `plugin-market` + `ui-plugin-market` 两行 |
| `~/.dsh/profiles/desktop/cordis.yml:1466-1472` | 实际生效的 `indexes`（jsdelivr `dsh-plugin-catalog/index.json`） |

---

## 7. 对我们自己插件的建议（Host 侧）

### 7.1 推荐架构（风险最低）

```
[client.js]  ── ctx.remote.pluginManager.listBundles()  → 已安装 + 版本 + source   （公开 Remote）
             ── ctx.remote.pluginMarket.search(url,q)    → 索引条目 + installation  （公开 Remote）
             ── fetch('/<我们的命名空间>/updates')       → 我们的 Host 补充数据（自建路由）
[host/index.js] ─ ctx.webServer.register(...) 暴露 { name: {latest, kind, status} }
                ─ ctx.get('pluginManager').listBundles() / registries()
                ─ ctx.get('pluginMarket')?.entry(url, name)   ← 进程内可用（未暴露 Remote 但公开源码）
                ─ 读 profile package.json + pnpm-lock.yaml + node_modules/*/package.json
                ─ 按需 fetch registry dist-tags / GitHub API
                ─ ctx.effect(...) 清理；监听 plugin-manager/changed 失效缓存；TTL 缓存（如 10 分钟）
```

理由：
- 已安装/版本/来源、索引里的"官方判定"，**全部有 `@Remote` 公开方法**，Client 直接调，不必自造。
- 只有"索引里没有的包（我们的 6 个 + 别人的 git 包）的最新版本"需要 Host 读文件 + 发网络请求；用 `ctx.webServer.register` 走 HTTP，是最稳定、最少非公开依赖的桥（也符合本仓 AGENTS.md 的可逆约定）。
- 不用 typert/Remote 自造服务：所有官方 package 的 `lib/typert.host.js` / `lib/typert.remote-client.js` 都是 `/* Generated by @deepseek-ai/dsh-typert-generator from FaceModel — do not edit. */`，是**构建期代码生成产物**。手工 ESM 插件要复制这套 zod schema + `createTypertRemoteInfo` 才能注册可调用 Remote 服务 —— 这是非公开内部契约，DSH 升级易碎。

### 7.2 依赖到的非公开/半公开点（必须写进风险）

| 点 | 风险等级 | 说明 / 退路 |
|---|---|---|
| `node_modules/<pkg>/package.json` 的 `version` 是权威版本 | 低 | 与 `listBundles` 同源；即使官方重构，读文件本身不变 |
| `pnpm-lock.yaml` 里 `codeload.github.com/.../tar.gz/<sha>` 形式的 commit | **中** | lockfile 是 pnpm 的格式，非 DSH 契约；pnpm 换格式（或用户禁用 lockfile）就失效 → 必须有"读不到就 unknown"的降级 |
| `pluginMarket.entry(url, name)` 无 `@Remote` | 中 | Host 进程内可用；若官方删方法会断 → 退路：用 `search(url,{text:name,limit:100})` 过滤 |
| `installation.status` 语义 | 低 | 公开 type；但语义若变（如加 `'installable'`）要跟 |
| 自建 `webServer` 路由 | 低 | 公开 API；注意 `(kind,path)` 必须唯一，别抢占别家前缀（用 `/<我们的包名>/…`） |
| `search` 无 installed 过滤 | — | 不是风险，是**能力上限**：见下 |

### 7.3 "把已安装排到最前"的实现成本（给 A/C 的输入）

- `MarketQuery` 无该维度 → 服务端不会帮忙。可选项：
  1. **客户端全量拉取**：3730 条 / `limit=100` = 38 次 `search` 往返；每次返回 ≥ 100 个完整 `MarketListingEntry`（含 versions/install/compatibility），估计几 MB，官方 `cacheTtlMs=10min` 内复用同一份文档（`fetchedAt` 钉文档）。可行但首屏慢，且要处理"文档被替换"的重启逻辑（客户端已有 `restarted` 处理，`client.js:1443-1462`）。
  2. **只在当前页内排序**（"本页已安装置顶"）—— 便宜但会误导（用户搜"memory"时已安装的可能在第 3 页）。
  3. **另开一个自己的"已安装/可更新"视图**（我们的插件自带 tab 或 slot），完全不碰官方 Discover 的查询语义 —— 数据齐、风险最低，我倾向这个。
- 另有一条**产品级坑**：索引里 3730 条全是 npm 源、每包一个版本、且**我们的包一条都没有**。所以"已安装筛选"在官方 Discover 里最多只能覆盖"从 npm 装的第三方插件"（本机 7 个），我们的 GitHub 直装插件永远不出现 —— 这不是筛选能修的，是索引入口问题（要进发现页，得让你自己进 `dsh-plugin-catalog` 索引，或在客户端把"本地已装但索引没有"的条目**合成**出来）。

---

## 8. 遗留问题 / 未验证

1. **web profile 没有 `plugin-market` 行**：`dsh --profile web --dump-config` 里只有 preset 内 disabled 的 `tool-plugin-market`。如果最终要落到 web profile，得先在自己的补丁里 `insert` market 两行（或在 desktop profile 上做）。当前用户看到的发现页来自 desktop profile。
2. `pluginMarket.search` 的**实际单次延迟/体积**未测（只测了索引 JSON 本体 2.5MB、以及 registry/GitHub 的单项延迟）。做全量 38 页方案前应实测一次。
3. GitHub API 未认证 60 次/小时；一台机器上已装 git 插件多时会撞限流 → 建议 Host 侧做 `ETag`/`If-None-Match` 或按 10 分钟 TTL 缓存，并串行请求。
4. 未验证 `installBundle` 对 `github:…#path:/sub` 是否在 `pendingBuilds`（build script 批准）上卡住 —— 更新流程设计时要留这个分支。
5. `dsh-win-notify` 与索引里 `kongdexu/dsh-win-notify` **同名不同源**：任何"按包名对齐索引与本地"的逻辑都会把别人的包当成我们的（本机就会出现：本地 0.1.0 = 索引 0.1.0 → 显示"已安装"）。必须同时校验 `repository.url`，不能只看 name。

---

## 附录 A：环境实况速查

- 运行中的 profile：**desktop**（`~/.dsh/profiles/desktop`，`pluginMarket` 活、`pluginInventory` 活、`pluginManager` 活）。
- GUI：`http://127.0.0.1:54229`。
- 注册表：`https://registry.npmmirror.com`（`pnpm config get registry`）；pnpm 10.27.0。
- 网络实测（Node `fetch`）：jsdelivr 索引 200 / 2.5MB；npmmirror `/<pkg>` 200 / 170ms；`api.github.com` commits 200 / 598ms；`raw.githubusercontent.com` 200 / 431ms；**`curl` 到 raw 失败（schannel 吊销离线），别用 curl 做探针**。
- 官方 asar：`C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\app.asar`；本次新解包的包（`/d/tmp/dshx2`）：`dsh-host-plugin-inventory`、`dsh-plugin-manager`、`dsh-plugin-package-inventory-deepseek`。
- 探针脚本：`/d/tmp/probe-updates.mjs`（只读；`node probe-updates.mjs <profileDir> [registry]`）。

## 附录 B：完整索引 schema 校验规则（供写"造条目"的代码时逐条对齐）

来源 `dsh-plugin-market-index/lib/index.js`：

- `LANGUAGE_ID = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/u`（`:23`）— 本地化文本的 key 必须小写语言 id，且**必须含 `en`**（`:59`）。
- `PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u`，≤214 字符（`:24-25`）。
- `SEMVER` 完整 SemVer 2.0.0 语法（`:26-29`）；`COMMIT = /^[0-9a-f]{40}$/u`（`:30`）。
- `path`（git 子目录）：`PATH_SEGMENT = /^[A-Za-z0-9._@+-]+$/u`，不得含 `.`/`..`（`:31,162-166`）。
- `icon`：`data:` 仅允许 svg/png/jpeg/webp 且 ≤32KiB 解码后（`:32-35,209-225`）；相对引用按索引 URL 解析，且必须 https 或同源。
- `repository.url` 允许 http(s)；`homepage` 允许带 query/fragment（`:147-154` 注释：npm homepage 常带 `#readme`）。
- `publishTimestamp`：整数 Unix 秒 ∈ `[0, 10^11)`（`:231`）。
- `engines.dsh`：必须能被 `semver.validRange` 解析，且不得是 `workspace:` 前缀（`:201-207`）。