# 调研-A：发现页 UI 侧（已安装筛选 / 更新标记 可行性）

- 调研日期：2026-10-28
- 对象：DSH `0.2.1-rc.3`（官方 asar），只读源码副本 `/d/tmp/dshx/`
- 目标仓库：`dsh-yzlin499-easy-plugins`（新增我们自己的 client 插件包，**不改官方源码**）
- 结论一句话：**发现页内部没有可扩展的 slot 挂点，分类 chip 行来自索引文档而非常量；要满足「已安装置顶 / 筛选 / 更新标记」，最稳的做法是我们自己的 client 插件往 `plugins.tab`（list slot）再注册一个自有标签页**。官方已经算好了 `installation.status`（含 `update-available`），并把它作为 `install` / `openPackage` 两个 prop 直接交给 `plugins.tab` 的任何占位者复用。

---

## 0. 页面定位：用户说的「设置页」到底在哪

用户描述「设置页 → 安装、启用和配置插件 → 已安装 / 发现」，实际是侧栏 **Plugins 面板**，不是 Settings 分区：

| 事实 | 锚点 |
|---|---|
| 面板 `main` slot 的 key = `plugins` | `dsh-client-ui-plugin-manager/lib/client.js:4355`（`PANEL_ID = "plugins"`）、`:4411`（`ctx.slots.inject("main", ...)`）、`:4417-4461`（注册 + children 表） |
| 页面顶部说明文案「安装、启用和配置插件」 | `dsh-client-ui-plugin-manager/lib/client.js:80`（zh `intro`）、`:306`（en） |
| 侧栏入口图标 | `dsh-client-ui-plugin-manager/lib/client.js:4484-4490` |
| Settings 里的「内置插件」是**另一个** slot `settings.plugins.tab`，当前只有 1 个占位者（inventory），单占位时连标签栏都不渲染 | `dsh-client-ui-settings-plugins/lib/client.js:201-212`（声明 `settings.section` id=plugins + children `settings.plugins.tab`）、`:44`/`:66-68`（`rows.length===1` 直接当页面渲）、占位者 `dsh-client-ui-settings-plugin-inventory/lib/client.js:757-758` |

→ 与本需求相关的是 **`plugins.tab`**，`settings.plugins.tab` 不相干（但可作为"我们也可以另挂一个设置分区"的备选认知）。

---

## 1. 「已安装 / 发现」两个标签是怎么来的

**答案：一个是官方页面里硬编码的，另一个是市场插件注册进 list slot 的。二者不同源。**

```
PluginManagerPage（管理面板本体，manager:3830）
├─ SegmentedTabs  items = [ {value:"installed"(硬编码)}, ...tabs ]      manager:4055-4076
│   └─ tabs ← ctx.slots.entries("plugins.tab") 的 (id,label) 投影       manager:4300-4326
└─ 面板 body = renderSlot("plugins.tab", {install, openPackage}, {only: tab})   manager:4082-4091
                └─ 占位者：DiscoverSection（官方市场插件）              market:1019-1103
                         注册：ctx.slots.inject("plugins.tab", () => ctx.slots.register(
                            {name:"plugins.tab", id:"discover", label:()=>t("title"), locale:NS, inject:()=>face},
                            DiscoverSection))                          market:1622-1628
```

要点：

1. `plugins.tab` 是 **list 型 slot**，`scope:"root"`，由 `main`/`plugins` 条目在 children 表里声明：
   `dsh-client-ui-plugin-manager/lib/client.js:4428-4431`。
2. 「已安装」不是 slot，是常量：`INSTALLED_TAB = "installed"`（`:3040`），标签文案 `t("installedTab")`（zh `:107` = `"已安装"`），选中时渲染官方自己的包卡片列表（`onInstalled` 分支，`:3891-3902`、`:4112-4120`）。
3. 「发现」的 `id` 是 `discover`，label 取市场插件字典的 `title`（zh `"发现"`，market `:1109`）。
4. slot 对外暴露给占位者的 props 只有两个（manager `:4082-4091`）：
   - `install({spec, registry?, title, version})` → 官方安装/升级对话框（manager `:1045-1060`）
   - `openPackage(packageName)` → 切到「已安装」并打开该包详情（manager `:4084-4090`）
   其余（`t`、`useLocale`、`useXxx` hooks、`renderSlot`）由 slots 运行时按注册时的 `locale`/`inject` 注入（市场组件用法见 market `:1020-1023`）。

---

## 2. 发现页的列表渲染结构（组件 / 状态 / 数据来源）

`DiscoverSection`（market `:1019-1103`）是外壳，真正列表是 `Browser`（market `:697-1017`）。

| UI 部件 | 锚点 | 状态 | 数据来源 |
|---|---|---|---|
| 市场下拉（`Awesome DSH Plugin 插件精选`） | 组件 `:814-854`；标签计算 `:111-114` | `menu === "market"`、`listing.url` | `state.indexes` ← `ctx.remote.pluginMarket.listIndexes()`（`DiscoverController.loadIndexes` `:1390-1412`） |
| 搜索框（250ms 防抖） | 输入 `:855-865`；防抖 `:183`、`:702-714` | 本地 `useState(text)`，提交走 `face.search(withText(query,text))` | `query.text` → Host `search` |
| 标签筛选（可选，索引声明了 labels 才出现） | `:866-897` | `query.labels[]` | `value.metadata.labels` |
| 排序下拉（默认顺序 / 发布时间 / …） | `:898-926`；选项构造 `:746-763`；选择逻辑 `:766-805`；升降序 `:908-911` | `query.sort = {kind:"index"\|"relevance"\|"published"\|"key", id?, direction?}` | 前三项**客户端常量**；`key:*` 项来自 `value.metadata.sortKeys` |
| 分类 chips（全部 / 安全与权限 / …） | `:944-969`；声明投影 `:715-723` | `query.category`（`null` = 全部） | **索引文档 `value.metadata.categories`**，不是硬编码常量 |
| 刷新（带 loading 圆点） | `:927-941` | `listing.status` | `face.refresh` → 重新拉取（`refresh:true`） |
| 结果列表 | `:986-1015`；卡片 `EntryCard` `:266-324`（`data-market-entry="<name>"` `:272`） | `value.entries` | Host `search` 分页 |
| 「显示更多」 | `:1008-1015` | `value.nextOffset` | `face.more` → `loadMore` |
| 条目详情页 | `EntryDetail` `:380-506`（`data-market-detail` `:390`）；版本行 `VersionRow` `:326-379` | `opened`（本地 useState，`:701`、`:724-743`） | 同一条 listing 数据 |
| 索引源管理弹窗 | `SourcesDialog` `:507-598` | `state.editing/draft/saving/sourceFailure` | `remote.pluginMarket.setIndexes`（`:1558-1578`） |
| 安装确认弹窗 | `ConfirmDialog` `:599-667` | `confirming`（`:1024`） | `presentedVersion`（`:72-74`）+ `sourceFacts`（`:81-104`） |

查询对象形状：`INITIAL_QUERY = {text:"", category:null, labels:[], sort:{kind:"index"}}`（market `:13-18`）；`withText` 会在"空↔非空文本"时自动在 `index`/`relevance` 间切换（`:26-34`）；`declaredQuery` 会剔除索引未声明的 category/label/sort（`:41-51`）。

请求/分页逻辑全在 `DiscoverController`（market `:1293-1579`）：

- `load(url, query, count, refresh)`（`:1418-1482`）：按 `MAX_PAGE = 100`（`:1270`）分批循环，直到取够 `count` 或 `nextOffset===null`；首页渲染 `count=50`（`:1333`、`:1411`、`:1337`）。
- `loadMore()`（`:1484-1525`）：+50 条；文档 `fetchedAt` 变化则整页重载（`:1508-1511`）。
- `page(...)`（`:1526-1537`）→ `ctx.remote.pluginMarket.search(url, {text?, category?, labels?, sort, offset, limit, fetchedAt?, refresh?})`。
- 失效重取：`plugin-market/changed` → `sourcesChanged()`；`plugin-manager/changed` → `bundlesChanged()`（`:1377-1380`，绑定 `:1604-1619`）；`connection/reset` 同样重取。**安装完成后安装态就是这样刷新的**，我们自己的面板可照抄。

---

## 3. 列表条目数据模型（Host 权威 schema）

Host 侧 `pluginMarket.search` 返回（`dsh-plugin-market/lib/typert.host.js:55-126`，实现 `dsh-plugin-market/lib/index.js:441-466`）：

```
{ url, title, description?, metadata:{ categories, labels, sortKeys, … },
  fetchedAt,                       // 文档指纹，翻页续读用
  entries: [{
    name,                          // npm 包名，索引内唯一
    title?, description?,          // 字符串或多语言 {en:…, zh:…}
    icon?, author?, homepage?,
    repository?: { url, directory? },
    metadata: { category?, keywords[], labels[], sortKeys{} },
    defaultVersion?,               // 默认安装版本（最高兼容稳定版）
    versions: [{
      version, publishTimestamp,
      install: { spec, registry? },                 // 直接喂给 pnpm add / 官方 install()
      compatibility: {compatible:true} | {compatible:false, runtimeVersion, requirements, exempted},
      source: {type:"npm", registry?} | {type:"git", url, commit, path?},
      engines: { dsh? }
    }],
    installation: {                // ★ 每次 search 现场重算
      status: "not-installed" | "installed" | "update-available" | "different-version" | "provided",
      installedVersion?: string
    }
  }],
  total, nextOffset }
```

- 安装态计算：`listingOf` / `installationOf`（`dsh-plugin-market/lib/index.js:610-627`、`:628-645`）；数据源是 `ctx.pluginManager.listBundles()` + 版本豁免（`annotator` `:492-496`）。
- `update-available` 的判定：`semver.gt(索引默认版本, 已装版本)`（`:641-644`）。
- `provided` = 随 DSH 安装自带（`availability==="installation"`）。

**结论：客户端不需要自己判断"是否已安装 / 是否可更新"——只要该插件出现在某个已配置的市场索引里，Host 已经给出 `installation.status`。**

对应的已安装包模型（我们本地清单要用）在 `dsh-plugin-manager/lib/index.js:1681-1800`，客户端投影在 `dsh-client-ui-plugin-manager/lib/client.js:860-890`：

```
{ name, version?, official, availability:"profile"|"installation"|"missing",
  installed, enabled, optional, removable, readOnlyReason?,
  installTarget?: { spec, version },        // ★ 见 §4 的坑
  source?, description?, meta?, rows[], overrides[], error? }
```

---

## 4. 「有没有新版本」的两条判定线 —— 以及一个必须知道的官方坑

| 线 | 实现 | 覆盖范围 | 结论 |
|---|---|---|---|
| ① 市场相对（推荐用） | `entry.installation.status === "update-available"`（Host 算好） | 只覆盖**出现在某个索引里**的插件 | 可用；官方发现页已用该值渲染「有新版本」标签（`EntryAction` market `:232-240`，文案 `statusUpdate` zh `:1159` = `"有新版本"`） |
| ② 本地清单相对 | `updateAvailable(pkg)` = `pkg.version !== pkg.installTarget.version`（manager `:2614-2618`），标签「可更新」`statusUpdateAvailable`（zh `:187`），卡片 `:2648-2652`、详情 `:2914-2918` | **只对官方按需目录（OFFICIAL_ON_DEMAND_CATALOG）里的包有效**：`installTarget` 仅在 `offered !== undefined` 时生成（`dsh-plugin-manager/lib/index.js:1706-1710`；客户端透传 `:877`） | ⚠️ 第三方插件（含本仓库所有 `dsh-*`）`installTarget` 为 `undefined` → `updateAvailable()` 恒 `false` → **官方「已安装」页对第三方插件永远不显示"可更新"**。这也解释了用户的诉求为什么"看不出来"。 |
| ③（可选自建） | 我们 Host 半侧直接查 npm registry packument `dist-tags.latest` | 任意 npm 包 | 只有在需要覆盖"不在任何索引里的第三方包"时才需要；注意本机 profile 里我们的插件是 `link:` / `github:` spec，语义上要特殊处理（官方 `updateAvailable` 对 `link:` 有单独分支，别照搬） |

本机 profile 事实（`~/.dsh/profiles/web/package.json`）：`dsh.mcp-compat` → `link:…/dsh-mcp-compat`、`dsh-version-control` → `link:…`、`dsh-win-notify` → `link:…`、`dsh-quick-file` → `link:…`、`dsh-yzlin499-plugins-manager` → `link:…`、`hooks-adapter` → `link:E:/DSHPlugins/hooks-adapter`。其中 `dsh-quick-file`、`dsh-yzlin499-plugins-manager` 在当前仓库目录中**不存在**（仓库只有 `dsh-ctx-menu / dsh-mcp-compat / dsh-version-control / dsh-win-notify`），面板上大概率显示 "missing/问题" 卡，排查更新数字时别被这两个干扰。

---

## 5. 安装动作调用哪个 service

发现页不直接调 service：`DiscoverSection` 拿到 `install` prop（来自 manager `installFrom`，manager `:1045-1060`），确认后调用
`install({...version.install, title, version})`（market `:1092-1099`）→ 官方安装对话框 → `remote.pluginManager.installBundle(spec, {registry})` + `waitForInstall(requestId)`（manager `:1595`、`:1616`）→ 完成后 Host 广播 `plugin-manager/changed` → 市场 `bundlesChanged()` 重取安装态。

其它相关 service（都在 `remote.pluginManager`，manager `:1388`）：`listBundles()`、`listPlugins()`、`setBundleEnabled(name, enabled)`（`:1157`）、`removeBundle(name)`（`:1174`）、`registries()`（`:1270`）、`inspect(spec)`（`:1537`）。
`remote.pluginRegistryProbe.fastest()`（`:1282`）**只是选最快的 npm registry**，与"最新版本号"无关，别误用。
`remote.pluginInventory.list()`（`:1374`）是内置清单。

---

## 6. locale / i18n 文案表位置与「覆盖官方文案」的可行性

- 市场插件的字典**内联在 client.js 里**，没有 `locale/*.json`：
  - `zh` 表：`dsh-client-ui-plugin-market/lib/client.js:1108-1187`（`title:"发现"`, `sortDefault:"默认顺序"`, `sortPublished:"发布时间"`, `allCategories:"全部"`, `statusInstalled/statusUpdate/statusProvided` …）
  - `en` 表：`:1189-1268`
  - 注册：`ctx.effect(() => ctx.locale.register(NS, {zh, en}), …)`（`:1596-1599`），`NS = "pluginMarket"`（`:1583`）
- 管理面板则**两种都有**：内联 zh/en（`dsh-client-ui-plugin-manager/lib/client.js` 约 `:60-330` / `:300-520`）**加** `dsh-client-ui-plugin-manager/locale/zh.json`、`en.json`（`NS = "pluginManager"`，`:4353`）。
- **覆盖官方文案不可行**：`locale.register` 对同一 `(ns, locale)` 重复注册会直接抛错 `locale namespace "…" already has locale "…"`（`dsh-client-locale/lib/client.js:1395`）。→ 我们的插件必须用**自己的 NS**（如 `pluginMarketInstalled`），自备 zh/en 字典；只能改自己的文案，改不了「发现」「已安装」这些官方字符串。
- 语言切换：`ctx.locale.subscribe(fn)` / 当前语言 `ctx.locale.getLocale().active`（‘zh’|‘en’），与仓库既有插件（`dsh-version-control`、`dsh-ctx-menu`）一致。

---

## 7. Live Slot 实测状态（cordis_inspect_query）

- 已尝试：`Slots.listSubTree`（无参 / `root:"plugins.tab"` / `root:"main"`）、`Service.listService(service:"slots")`、`Builtin.listBuiltins`。
- 结果：**全部 10s 超时**（`Client inspect query … timed out after 10000ms. Open or reconnect the Harness page, then retry.`）。说明当前 Web 页面没有响应 client inspect 通道（页面未聚焦/未连接），本机拿不到活动 slot 树快照。
- 因此本文所有 slot 结论**取自官方编译产物源码**（比运行时快照更权威），但建议在页面可响应时补一次实测以确认占位者列表：
  `cordis_inspect_query(platform:"client", provider:"Slots", method:"listSubTree", input:{root:"plugins.tab"})`
  期望看到 occupants：`[{id:"discover", label:"发现"}]`（+ 我们注册后多一条）。

---

## 8. 关键可行性判定：能否"往分类 chip 行追加一个『已安装』chip"？

**不能（在不改官方源码的前提下），依据链如下：**

1. **分类 chips 不是 slot**：它是 `Browser` 内联渲染的（market `:944-969`），数据来自 `value.metadata.categories`（`:715-723`，即索引文档自带），官方没有为此暴露任何 slot/prop 注入点。
2. **不能用同 id 覆盖官方 `discover` 占位**：SlotCore 的 list slot 注册校验按 `(id, priority)` 查重，重复直接抛错：
   `list slot "plugins.tab" already has an entry with id "discover" … — register at a different priority to shadow it (lowest renders)`
   位置：`dsh-web-frontend/dist/assets/index-BXV-oxvX.js`（asar 内 `dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/`），字符偏移约 `488232`（报错串）/ `487548`（`shadow it (lowest renders)`），函数 `SlotCore.register`。
   → 换成"同 id + 不同 priority"技术上被允许（低 priority 胜出），但：
   - 标签栏读的是**原始 entries**（`ctx.slots.entries("plugins.tab")`，manager `:4311`），不是去重后的集合 → 标签栏会同时出现两个同 id 的条目；
   - 官方 `DiscoverSection` **没有导出**（market 只 `exports.apply` / `exports.inject`，`:1631-1632`）→ 无法"包装官方组件 + 在旁边加 chip"，只能整个重写（≈1600 行行为：市场下拉/搜索/排序/分类/详情/版本列表/索引源管理/安装确认/分页）；
   - 面板渲染是否按 id 去重（`renderSlot(..., {only: tab})` 的内部实现）**未能在产物中定位**（Slot 的 React 渲染器不在 `index-*.js` / `vendor-*.js` 的可检索符号里），属"需实测"项。
3. **唯一能"真的出现在发现页里"的非官方手段是 DOM 注入**：`DiscoverSection` 根节点带 `data-plugin-tab="discover"`（market `:1077`），卡片是 `li[data-market-entry="<name>"]`（`:272`），分类行 CSS 类 `m2i3Fa_categories`（`:117`/`:132`）。可以 MutationObserver 往 chip 行插 `<button class="…Pill">`、或把已安装卡片 `append` 到列表最前。但：React 下一次重渲染会覆盖 DOM 顺序；点击我们的 chip 无法改变官方 `query` 状态（无 setter）；属于高脆性 hack。

---

## 9. 两种可选实现方案 + 评估

### 方案 A：劫持/包装官方发现页，追加「已安装」筛选与更新标记

| 子变体 | 做法 | 可行性 | 风险 |
|---|---|---|---|
| A1 同 id 低 priority 覆盖 | 注册 `plugins.tab` id=`discover`, `priority:-1`，自己实现整套发现页 + 已安装 chip | 技术上可行（SlotCore 允许跨 priority 重复 id） | 需重写官方 ~1600 行行为；标签栏读原始 entries 会重复列出；官方升级后我们的复制品立刻落后；`only` 去重行为未实测 |
| A2 DOM 注入 | MutationObserver 给 `[data-plugin-tab="discover"]` 插 chip / 重排 `li[data-market-entry]` | 只能"看起来像"，行为不成立 | React 重渲染回滚；无法驱动官方筛选状态；CSS 类名是构建哈希（`m2i3Fa_*`）升级即变 |

**评估：不推荐。** 收益（"就在发现页里"）远小于成本与维护风险，且 A2 根本改不了实际筛选逻辑。

### 方案 B（推荐）：自建 client 插件，往 `plugins.tab` 注册一个自有标签页

- 位置：与「已安装」「发现」并列的**第三个标签**（如「已安装 · 市场」/「市场速览」）。标签栏由官方渲染（manager `:4069-4074`），我们只提供 `id/label/组件`。
- 页面内容（完全可控）：一个列表 + 三枚 chip（`全部` / `已安装` / `可更新`），默认排序 = **可更新 → 已安装 → 未安装**，并显示「已装 vX → 市场 vY」；行内按钮直接复用官方 prop：
  - 升级：`install({...version.install, title, version})`
  - 查看/跳转：`openPackage(name)`（切到官方「已安装」并打开包详情，manager `:4084-4090`）
- 数据：`remote.pluginManager.listBundles()`（本地已装清单）+ 逐个索引 `remote.pluginMarket.search(url,{offset:0,limit:100})` 翻页聚合（拿 `installation.status/installedVersion`），按 `name` 做并集；`ctx.remote.$on('plugin-manager/changed' | 'plugin-market/changed')` 失效重取。
- 降级：市场插件未启用 / 无索引 / 调用失败时，只显示本地已安装清单 + 一行提示（不要整页报错）。
- 成本：新包 ≈ 300-500 行 client + 选项 host 半侧；**零耦合官方内部组件**，官方升级只可能影响 slot/prop 契约（已由 manager 公开稳定）。

**方案 B 变体 B'（更保守）**：不新开 tab，而是 host 半侧自注册 HTTP 路由（仓库既有 `dsh-version-control` 的 `fetch('/version-control/api/…')` 模式），client 侧只读我们的路由；好处是不依赖 `remote.*` 命名空间，坏处是拿不到 `install/openPackage` 两个官方 prop（无法复用安装流程与详情跳转），需要自己做安装与跳转入口。**推荐仍用 B（走 `remote` + slot props）**，B' 作为兜底。

### 方案对比小结

| 维度 | A1 覆盖发现页 | A2 DOM 注入 | **B 自有 tab（推荐）** | B' 自建路由 |
|---|---|---|---|---|
| 是否真能满足"已安装置顶/筛选" | 是（但重写） | 视觉满足、行为不满足 | **是** | 是（但另起 UI） |
| 能否显示"有新版本" | 是 | 只在官方已有数据上打补丁 | **是（用 installation.status）** | 是（Host 侧算） |
| 复用官方安装/详情流程 | 需自己实现 | 不适用 | **是（install/openPackage prop）** | 否 |
| 官方升级脆弱度 | 高（复制品） | 高（哈希类名/React 覆盖） | **低（只依赖公开 slot 契约）** | 低 |
| 工作量 | 大（≈1600 行等价） | 小但无效 | **中** | 中 |

---

## 10. 推荐实现骨架（方案 B，供后续写代码的人直接落地）

新包 `dsh-plugin-market-installed/`（目录即包结构，遵守 AGENTS.md 契约）：

```
package.json
  "type":"module","main":"index.js","version":"0.1.0","license":"MIT",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" },
           "client": { "inject": ["@deepseek-ai/dsh-api-remotes",
                                  "@deepseek-ai/dsh-client-locale"], "platform": "web" } },
  "exports": { ".": "./index.js", "./client": "./client.js" }
cordis.patch.yml   # 只 insert 自己一行
index.js           # Host 半侧：可空（export name + inject + apply）；仅当走 B' 或自建 npm 版本查询时才需要
client.js          # Client 半侧（ESM，React.createElement，不用 JSX）
README.md / README_EN.md
test/*.test.mjs    # 纯函数单测：合并、排序、更新判定
```

`client.js` 关键点：

```js
export const inject = ['slots', 'locale', 'remote'];   // remote 服务在 web 客户端恒有（由 shell 提供）
const NS = 'pluginMarketInstalled';
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), '…: dictionaries');   // 自己的 NS，勿用 pluginMarket
  const t = ctx.locale.bind(NS);
  ctx.slots.inject('plugins.tab', () => ctx.slots.register({
    name: 'plugins.tab',
    id: 'market-installed',            // 不要用 'discover'（同 id 冲突/需 shadow）
    order: 1,                          // list slot 排序：priority → order
    label: () => t('title'),
    locale: NS,
    inject: () => ({ /* hooks / face，参考 market:1317-1371 */ }),
  }, InstalledMarketSection));
}
```

组件内数据聚合（建议纯函数化以便单测）：

```
state = {
  bundles:  await ctx.remote.pluginManager.listBundles(),          // 本地已装（含 availability/version/enabled）
  indexes:  await ctx.remote.pluginMarket.listIndexes(),           // 可能为空
  entries:  flatten(每个 index: 循环 search({offset,limit<=100}) 直到 nextOffset===null)
}
rows = merge(bundles, entries)  // key = package name
  每行: { name, title, installedVersion, marketVersion(defaultVersion), status(installation.status),
          enabled, availability, installTarget, spec }
排序: statusRank(update-available=0, installed=1, not-installed=2) → 名称 localeCompare
chip: 全部 / 已安装(installed|provided|update-available|different-version) / 可更新(update-available 或 (②线)updateAvailable)
行操作: 可更新 → install({...entry.versions[pick].install, title, version})
        已安装 → openPackage(name)
失效: ctx.remote.$on('plugin-manager/changed', reload); ctx.remote.$on('plugin-market/changed', reload)
降级: listIndexes 失败 / 无索引 → 仅本地清单 + 提示「未启用自定义插件市场」
```

再次提醒两个已知坑（写代码时必看）：
- 第三方包 `installTarget` 恒 `undefined` → 别指望走 ② 线判更新；
- `remote.pluginMarket.*` 在 Host 未挂市场服务时调用会失败（api-remotes 客户端会**无条件挂载所有命名空间**，所以"命名空间存在"不等于"服务可用"，必须 try/catch 降级）。

---

## 11. 关键代码锚点总表（文件 : 行号）

### 11.1 市场 client（`dsh-client-ui-plugin-market/lib/client.js`，共 1637 行）

| 行 | 说明 |
|---|---|
| 13-18 | `INITIAL_QUERY`（text/category/labels/sort 形状） |
| 26-34 / 41-51 | `withText`（文本↔relevance 自动切换）/ `declaredQuery`（剔除索引未声明的过滤与排序） |
| 72-74 | `presentedVersion(entry)`：默认展示/安装版本 |
| 81-104 | `sourceFacts(name, version)`：详情页来源事实 |
| 111-114 | `indexLabel(index, resolveText)`：市场下拉显示名 |
| 183 | `TEXT_DELAY_MS = 250` 搜索防抖 |
| 232-240 | `EntryAction`：`status → 已安装/有新版本/随 DSH 提供`，点击 `onOpenInstalled` |
| 266-324 | `EntryCard`（`data-market-entry` 在 272；标题/描述/meta 293-309；动作 312-321） |
| 326-379 | `VersionRow`：版本行 tag（当前已装 350-353、预发布、不兼容、默认版本） |
| 380-506 | `EntryDetail`：详情页（来源 452-485、版本列表 486-503） |
| 507-598 | `SourcesDialog`：索引源增删 |
| 599-667 | `ConfirmDialog`：安装确认 |
| 697-1017 | `Browser`：工具栏（811-943）、**分类 chips（944-969）**、失败条（970-982）、列表（986-1015） |
| 746-763 / 766-805 | 排序选项构造 / 选择与升降序 |
| 814-854 / 855-865 / 866-897 / 898-926 / 927-941 | 市场下拉 / 搜索 / 标签筛选 / 排序 / 刷新 |
| 1019-1103 | `DiscoverSection`（`data-plugin-tab="discover"` 在 1077；`install(...)` 在 1092-1099） |
| 1108-1187 / 1189-1268 | zh / en 字典（`title:"发现"`、`sortDefault`、`allCategories`、`statusUpdate` …） |
| 1270 | `MAX_PAGE = 100` |
| 1293-1579 | `DiscoverController`（`face` 1317-1371、`bundlesChanged` 1377-1380、`load` 1418-1482、`loadMore` 1484-1525、`page`→`remote.pluginMarket.search` 1526-1537、`settle` 1539-1557、`saveSources` 1558-1578） |
| 1583 / 1585-1590 / 1595-1628 | `NS="pluginMarket"` / `inject` / `apply`（字典 1596-1599、事件 1604-1619、**`plugins.tab` 注册 1622-1628**） |
| 1631-1632 | `exports.apply` / `exports.inject`（**未导出 DiscoverSection**） |

### 11.2 管理 client（`dsh-client-ui-plugin-manager/lib/client.js`，共 4501 行）

| 行 | 说明 |
|---|---|
| 80 / 306 | 页面说明「安装、启用和配置插件」zh / en |
| 107 / 331 | `installedTab` =「已安装」/ "Installed" |
| 187 / 411 | `statusUpdateAvailable` =「可更新」/ "Update available" |
| 860-890 | `packageView(bundle, plugins)`：Host bundle → 页面 pkg（`installTarget` 透传在 877） |
| 1045-1060 | `installFrom({spec, registry, title, version})` ← **`plugins.tab` 拿到的 `install` prop 本体** |
| 1157 / 1174 / 1208 | `setBundleEnabled` / `removeBundle` / `setPluginEnabled` |
| 1162-1182 | `update(packageName)`：卸载后重装到 `installTarget` 的官方升级路径 |
| 2101-2166 | `AddPluginMenu`（`renderSlot("plugins.add.actions")` 在 2163） |
| 2614-2618 | `updateAvailable(pkg)`（本地清单相对，**第三方包恒 false**） |
| 2620-2667 | `PackageCard`（「可更新」tag 在 2648-2652；**此卡片不渲染任何 slot**） |
| 2681 / 2739 / 2747 | `plugins.item` 仅用于**官方 plugin item** 的摘要 |
| 2919 / 2736 / 2795 | `plugins.detail.badge`（详情页徽标挂点） |
| 2980 / 2751 / 2821 | `plugins.detail.section`（详情页区块挂点） |
| 3040 | `INSTALLED_TAB = "installed"` |
| 3830 / 3844-3846 / 3891-3902 | `PluginManagerPage` / 标签状态与回退 / `onInstalled` 分支 |
| 4055-4076 | `SegmentedTabs`：`[已安装, ...tabs]` |
| 4082-4091 | **`renderSlot("plugins.tab", {install, openPackage}, {only: tab})`** |
| 4300-4326 | `tabLedgerSource`：`ctx.slots.getVersion/entries/subscribe("plugins.tab")` 投影成标签 |
| 4334-4349 | 导航 store（默认 `tab:"installed"`） |
| 4353-4366 | `NS="pluginManager"` / `PANEL_ID="plugins"` / `inject` 列表 |
| 4402-4410 | `shell.overlay` 注册（刷新 toast） |
| 4411-4483 | `main` 注册 + **children 表（`plugins.tab` 在 4428-4431）** + `pluginNavigation` 服务（4465-4479） |
| 4484-4490 | `sidebar.panellist` 注册 |

### 11.3 Host 服务

| 文件 : 行 | 说明 |
|---|---|
| `dsh-plugin-market/lib/index.js:441-466` | `search(url, query)`：分页 + 每页现场计算安装态 |
| `dsh-plugin-market/lib/index.js:476-479` | `entry(url, name)`：单条读取 |
| `dsh-plugin-market/lib/index.js:492-496` | `annotator()`：注入 `pluginManager.listBundles()` 结果 |
| `dsh-plugin-market/lib/index.js:610-627` | `listingOf`：补 `install` / `compatibility` / `defaultVersion` / `installation` |
| `dsh-plugin-market/lib/index.js:628-645` | **`installationOf`：5 态 + `installedVersion` 的唯一来源** |
| `dsh-plugin-market/lib/index.js:646-659` | `compatibilityOf`（engines.dsh + 豁免） |
| `dsh-plugin-market/lib/typert.host.js:55-126` | 搜索返回的权威 Zod schema（条目/版本/installation） |
| `dsh-plugin-market/lib/typert.host.js:135-154` | `search` 入参 schema（text/category/labels/sort/offset/limit/refresh/fetchedAt） |
| `dsh-plugin-manager/lib/index.js:1681-1800` | `listBundles()`：已装/随装/官方目录 + `installTarget`（1706-1710 是坑点） |
| `dsh-plugin-manager/lib/index.js:1801-1804` | `registries()` |
| `dsh-client-locale/lib/client.js:1387-1413` | `locale.register`（1395：同 ns+locale 重复注册抛错） |

### 11.4 slot 运行时与其它

| 位置 | 说明 |
|---|---|
| asar `dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-BXV-oxvX.js` 字符偏移 ≈ `487548` / `488232` | SlotCore `register` 的 list-slot 查重与「different priority to shadow it (lowest renders)」提示 |
| 同上 ≈ `490202` | `entriesOfSlot`（按 id 去重后的集合） |
| 同上（模块 `jI`） | `@deepseek-ai/dsh-client-ui-slots` 的真实实现（导出 `SlotCore` / `resolveSlotLabel` 等） |
| `dsh-client-ui-settings-plugins/lib/client.js:201-212` | Settings「内置插件」分区 = `settings.plugins.tab`（与本需求无关，勿混） |
| `dsh-experimental-plugin-market-bundle/cordis.patch.yml` | 市场服务与发现页的挂载方式（`plugin-market` + `ui-plugin-market` 两行），说明**该 bundle 是可关的**，我们的插件必须能降级 |

---

## 12. 风险与待实测项

1. **`renderSlot(..., {only})` 是否按 id 去重**：决定方案 A1（同 id 低 priority 影子替换）会不会出现"两个面板同时渲染"。产物中未能定位该实现，需实测。
2. **索引条目规模**：聚合"已安装/可更新"要拉全量（`limit ≤ 100`/页），索引条目多时是多次 RPC；建议缓存 + 手动/事件触发刷新，不要每次渲染都拉。
3. **第三方包 `installTarget` 缺失**（§4 坑 ②）：不要在 UI 上承诺"官方「已安装」页会显示可更新"。
4. **`link:` / `github:` 来源包**（本机 profile 全部如此）：版本号语义不可靠，展示要带"来源"而非只显示版本。
5. **市场 bundle 可被用户关闭**：`remote.pluginMarket` 调用可能失败（客户端命名空间无条件存在，但 Host 服务可能没挂）→ 必须 try/catch 降级，不能整页白屏。
6. **本机会话的 client inspect 不可用**（§7）：所有 slot 结论来自源码；建议后续在页面可响应时复核一次 `Slots.listSubTree(root:"plugins.tab")`。
7. 环境附带发现：profile 的 `bundles` 里 `dsh-quick-file`、`dsh-yzlin499-plugins-manager` 指向的仓库目录不存在（`link:` 断链），面板会显示缺失卡，排查更新统计时需过滤。