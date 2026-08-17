# DSH 插件配置持久化（settings）读写指南

> 结论先行：**Host 侧用官方 `ctx.settings` 注册命名空间并读写 `~/.dsh/settings.yaml`，
> Client 侧设置卡片注册进官方 `settings.plugin.item`（keyed 插槽，以该命名空间为键）**。
> 卡片的数据读写可走插件自己的 HTTP 路由（由 Host 转发读写），也可直接使用
> `settingsScope`——从 0.1.0-rc.7 起官方已移除 WEB_SETTINGS_NAMESPACES 白名单，
> 第三方命名空间对 Web 侧同样可用（见第 2 节）。

## 1. 官方 settings 是什么

DSH 的配置持久化走 `ctx.settings` 服务（官方 `dsh-settings-file`，`dsh-base` 组合里的
`id: settings` 那行）。它把用户配置存成一份按 namespace 分节的 YAML 文档：

```
位置：$DSH_HOME/settings.yaml        （默认 ~/.dsh/settings.yaml，与 ui-theme、locale 同文件）
格式：namespace: { 字段: 值 }         （官方 comment-preserving 增量写入，保留注释）
机制：schema 默认值 → 组合 base → 用户分节，三层解析
```

官方文档：<https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/subsystems/settings.zh.md>

## 2. 关键坑（历史）：前端 settingsScope 曾对第三方插件不可用

`ctx.settings.register()` 是 Host 侧进程内注册，**任何插件都能成功注册**。
旧版（< 0.1.0-rc.7）的 Client 侧 `ctx.settingsScope`（浏览器 → `/api/settings.*` RPC）
曾受官方 `dsh-host-apiproxy` 的**硬编码白名单**控制：

```js
// 旧版 node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js
const WEB_SETTINGS_NAMESPACES = [
    'agent-loop', 'shell', 'locale', 'permission', 'ui-conversation', 'ui-theme', 'web-search-deepseek',
];
```

- 不在白名单内的命名空间：`settings.describe` 查不到 → Client 的
  `snap.status === "unavailable"`（显示「设置不可用（内存模式）」）；
  `set()` 静默成功但不落盘。
- **该白名单从 0.1.0-rc.7 起已被删除**：`settings.describe` 现在返回**所有**已注册命名空间，
  第三方命名空间对 Web 侧照常可用，`settingsScope.bind({ namespace })` 可直接读写。

### 排查方法（复现 unavailable 时）

```js
// Host 侧动态诊断：命名空间是否注册成功
settings.describe().map(d => d.ns)          // 有 dsh-quick-file → Host 侧 OK

// Client 侧诊断：isLoopback 与 snapshot
const conn = ctx.get('connection')
conn.isLoopback                              // true = loopback，官方 settings 才可用
const scope = ctx.settingsScope.bind({ namespace: 'dsh-quick-file' })
scope.getSnapshot()                          // load 后正常拿到 value/user/revision
```

## 3. 推荐架构：Client 走插件路由，Host 用官方 settings

把「传输通道」换成插件自己的 webServer 路由，**落盘仍由官方 `ctx.settings` 完成**：

```
浏览器设置卡片
   │  fetch POST /<插件>/config          ← 插件自己的 webServer 路由（唯一改动点）
   ▼
Host 路由 handler
   │  await scope.update({ ... })        ← 官方 ctx.settings 的 SettingsScope
   ▼
官方 dsh-settings-file 服务
   │  comment-preserving leaf-level diff + 写锁
   ▼
~/.dsh/settings.yaml（<ns>: { 字段: 值 }）
```

### Host 半侧（index.js）

```js
import z from './vendor/schemastery.js'   // 或 ctx.loader.import('@deepseek-ai/schemastery')

export const inject = ['settings', 'webServer', /* 其它依赖 */]

export function apply(ctx) {
  const NS = 'dsh-quick-file'
  let scope = null
  let mem = { depth: 3, max: 50 }         // settings 不可用时的内存回退
  try {
    scope = ctx.settings.register(NS, z.object({
      depth: z.natural().min(1).max(10),  // 注意：schemastery 用 z.natural()，没有 z.number().integer()
      max: z.natural().min(10).max(200),
    }))
  } catch (e) {
    console.log(`[插件] settings 注册失败，回退内存态:`, e?.message)
  }

  const read = () => {
    if (scope) {
      try {
        const v = scope.get()
        if (v && v.depth != null) return { depth: v.depth, max: v.max }
      } catch {}
    }
    return { ...mem }
  }

  ctx.webServer.register({
    kind: 'prefix',
    path: '/quick-file/config',
    handler: async (req, res) => {
      // GET 读：read()
      // POST 写：scope ? await scope.update(patch) : Object.assign(mem, patch)
    },
  })
}
```

要点：
- **`z.natural()`** 才是 schemastery 的整数类型（非负整数）；`z.number().integer()` 是
  zod 的 API，在 schemastery 里会抛 `z.number(...).integer is not a function`。
- `register` 是 fiber 级副作用，插件卸载自动注销，无需手动清理。
- `register` 本身**不落盘**，只有 `scope.update()` / `replace()` / `mutate()` 才写文件。

### Client 半侧（client.js）

```js
const inject = ['slots']                  // 不需要 settingsScope！

function SettingsCard() {
  const [cfg, setCfg] = React.useState({ depth: 3, max: 50, status: '' })

  React.useEffect(() => {
    fetch('/quick-file/config')           // GET 读
      .then(r => r.json())
      .then(d => setCfg(s => ({ ...s, depth: d.depth, max: d.max })))
      .catch(() => setCfg(s => ({ ...s, status: '读取失败' })))
  }, [])

  const save = () => {
    fetch('/quick-file/config', {         // POST 写（走插件路由 → Host scope.update）
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ depth: Number(cfg.depth), max: Number(cfg.max) }),
    })
      .then(r => r.json())
      .then(d => setCfg(s => ({ ...s, status: d.ok ? '已保存' : (d.error || '保存失败') })))
      .catch(() => setCfg(s => ({ ...s, status: '保存失败' })))
  }
  // …注册进 ctx.slots.inject('settings.plugin.item', …)
}
```

- `package.json` 的 `dsh.client.inject` 里**不要**再写 `settingsScope`。
- 卡片照旧注册进官方 `settings.plugin.item` 插槽（keyed，见下节「设置卡片 UI 规范」）。

### 设置卡片 UI 规范（settings.plugin.item）

插件设置统一进官方「插件」设置页（「插件配置」标签页）的 `settings.plugin.item` 插槽
（**keyed**：以卡片所编辑的 settings 命名空间为键），**不要自建 settings.section 标签页**。

- **配对机制**：Host 侧注册命名空间（`ctx.settings.register(ns, schema)`，或官方
  `installSettingsSection`）→ `settings.describe` 返回该命名空间 → 标签页把它与
  注册时 `key` 相同的卡片配对渲染。Host 未注册该命名空间的卡片不会被渲染。
- **注册**：`ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
  name: "settings.plugin.item", key: "<Host 已注册的命名空间>", id, label }, Component))`；
  卡片组件自包含、自行拉取/保存配置，**不依赖其它插件（包括管理器）**。
  keyed entry 不按 `order` 排序（按注册顺序渲染），`id`/`label` 仅作标识。
- **卡片外壳对齐官方 PluginCard**：
  - `.pc-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;overflow:hidden}`
  - 可折叠头部（名称 + 描述 + CSS 边框下箭头 `rotate(45deg)`，展开翻转 225deg），
    **默认闭合**
  - 展开区 `.pc-body{border-top:1px solid var(--dsw-alias-border-l2);padding:14px 16px}`
- **无设置项的插件不加卡片**（避免空卡）。

## 4. 现状落盘验证

```powershell
# 读写后检查
Get-Content ~/.dsh/settings.yaml
# → dsh-quick-file:
#     depth: 7
# 且其它官方段（ui-theme、locale…）及注释原样保留（官方 diff 写入的表现）
```

## 5. 特殊红线（Cookie 等敏感配置）
oc-usage 的 Cookie 遵循「只存进程内存、不落盘、不回显」红线，与 settings 无关：
- `config-get` 只回 `cookieSet: true/false`，不回显值
- `config-set` 收到新 Cookie 更新 `state.cookie`（进程内），重启即失

## 6. 现状与展望

- **0.1.0-rc.7 起**：官方已移除 WEB_SETTINGS_NAMESPACES 白名单，`settings.describe`
  返回所有已注册命名空间，`settingsScope` 对第三方命名空间可用。
- 本仓库插件保持「Client 走自身路由、Host 用 ctx.settings」的架构（历史惯性，
  功能上完全等价）；新插件的设置卡片可直接用 `settingsScope` 直连，更省事。
- 无论哪种方式，**卡片注册都必须带 `key: <命名空间>`**（keyed 插槽契约）。
