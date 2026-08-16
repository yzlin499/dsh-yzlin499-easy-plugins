# DSH 插件配置持久化（settings）读写指南

> 结论先行：**前端不要用 `settingsScope` 直连官方 settings**（第三方命名空间会被官方
> api-proxy 白名单拦截，永远不可用）。正确姿势是 **Host 侧用官方 `ctx.settings` 注册并读写
> `~/.dsh/settings.yaml`，Client 侧走插件自己的 HTTP 路由，由 Host 转发读写**。

## 1. 官方 settings 是什么

DSH 的配置持久化走 `ctx.settings` 服务（官方 `dsh-settings-file`，`dsh-base` 组合里的
`id: settings` 那行）。它把用户配置存成一份按 namespace 分节的 YAML 文档：

```
位置：$DSH_HOME/settings.yaml        （默认 ~/.dsh/settings.yaml，与 ui-theme、locale 同文件）
格式：namespace: { 字段: 值 }         （官方 comment-preserving 增量写入，保留注释）
机制：schema 默认值 → 组合 base → 用户分节，三层解析
```

官方文档：<https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/subsystems/settings.zh.md>

## 2. 关键坑：前端 settingsScope 对第三方插件不可用

`ctx.settings.register()` 是 Host 侧进程内注册，**任何插件都能成功注册**。
但 Client 侧的 `ctx.settingsScope`（浏览器 → `/api/settings.*` RPC）受官方
`dsh-host-apiproxy` 的**硬编码白名单**控制：

```js
// node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js
const WEB_SETTINGS_NAMESPACES = [
    'agent-loop', 'shell', 'locale', 'permission', 'ui-conversation', 'ui-theme', 'web-search-deepseek',
];
```

- 不在白名单内的命名空间：`settings.describe` 查不到 → Client 的
  `snap.status === "unavailable"`（显示「设置不可用（内存模式）」）；
  `set()` 静默成功但不落盘。
- 官方注释明确：*"a namespace absent here answers `settings-not-exposed` even when
  its owner registered it… Moving that declaration to `settings.register()`…
  is deferred work."* —— **让插件自己暴露命名空间，官方还没实现**，也没有任何
  配置项能开白名单（api-proxy 的 Config 只有 `nativeOpen` 等三项）。

### 排查方法（复现 unavailable 时）

```js
// Host 侧动态诊断：命名空间是否注册成功
settings.describe().map(d => d.ns)          // 有 dsh-quick-file → Host 侧 OK

// Client 侧诊断：isLoopback 与 snapshot
const conn = ctx.get('connection')
conn.isLoopback                              // true = loopback，官方 settings 才可用
const scope = ctx.settingsScope.bind({ namespace: 'dsh-quick-file' })
scope.getSnapshot()                          // mode: 'host'，load 后 unavailable → 白名单拦截
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
- 卡片照旧注册进官方 `settings.plugin.item` 插槽（该插槽本身是开放的，只有数据
  通道被白名单限制），外壳对齐官方 PluginCard。

### 设置卡片 UI 规范（settings.plugin.item）

插件设置统一进官方「插件」设置页的 `settings.plugin.item` 插槽（list、additive），
**不要自建 settings.section 标签页**。

- **注册**：`ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
  name: "settings.plugin.item", id: "<唯一id>", order, label }, Component))`；
  卡片组件自包含、自行拉取/保存配置，**不依赖其它插件（包括管理器）**。
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

## 6. 未来展望

官方把「插件自暴露 settings 命名空间」从 deferred work 转正后，Client 可改回
`ctx.settingsScope.bind({ namespace })` 直连，Host 侧代码无需任何改动。
