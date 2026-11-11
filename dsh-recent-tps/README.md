# dsh-recent-tps

给输入框下方那个**会话统计面板**加一行「**最近 30 秒速度**」。

官方面板（点读数弹出的那张）只有整段会话口径的四行：

```
会话统计                        2 轮 174 步
────────────────────────────────────────
模型用时                          15分10秒
工具调用用时                       2分45秒
首 token 平均（TTFT）                2.2秒
输出速度（TPS）                     218 tok/s
最近 30 秒速度                       195 tok/s   ← 本插件加的这一行
```

「输出速度（TPS）」是 `Σ 输出 token ÷ Σ 解码耗时`，**整段会话**的平均。跑了两小时之后，
某一步突然卡住，这个数字几乎不动。新加的「最近 30 秒速度」用**同一个公式**，只把范围收到
最近 30 秒——而且**一旦算出来就保持住**：没有新的 step 结算，读数就原样停在那儿，
不会跟着墙上时钟衰减、也不会变成 `—`。刷新页面也立刻有值（每个会话的最近读数存在
`localStorage` 里）。

## 安装

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-recent-tps"
```

重启 DSH Web（或刷新页面）。卸载：

```powershell
dsh plugin --profile web remove dsh-recent-tps
```

（`web` 换成你的 profile 名；桌面 App 用自带 CLI 并指定 `--profile desktop`，
本地调试可用 `link:` 方式，见 [Docs/Install.md](../Docs/Install.md)。）

## 使用

装好即生效，没有开关、没有设置页。想看数：点输入框下方那枚仪表读数 `2 轮 174 步 · 218 tok/s`，
面板最后一行就是「最近 30 秒速度」。

- **详细模式**：面板里四行官方读数 + 一行 30 秒速度。
- **简洁模式**（设置 → 通用 → 性能与用量）：与官方一致只显示整段速度；鼠标悬停的提示里
  会同时给出「最近 30 秒速度」。
- 它不跳、不衰减、不空：**没有新的 step 结算就一直保持同一个读数**。只有「既没有任何采样、
  整段解码耗时又是 0」这种极端情况才显示 `—`。

## 工作原理

**为什么是「接管」**：输入框统计是 `conversation.composer.dock` 插槽里的两个条目
（`activity` 读数、`usage` 用量），面板内部**没有插槽**，官方也没给「加一行」的扩展点。
官方文档给的唯一正规方式是**同 id + 同 order 覆盖**：

> Another plugin replaces one control by registering the **same id and the same `order`**;
> the dock orders rows by `order`, while a **lower `priority`** picks the replacement.

插槽实现按 `priority` 升序、再按 `order` 升序排序，然后按 id 去重取第一条。所以本插件以
`{ id: 'activity', order: 0, priority: -1 }` 注册，顶掉官方那条读数；面板的文案、结构、
样式（`.hNGZaa_*` / `.xXe6ja_*` 的等价物）逐项对齐官方编译产物，**只多一行**。
`test/rolling.test.mjs` 里有一条「文案与官方逐字一致」的哨兵——官方改面板文案时它会先失败。

**30 秒速度怎么算**：**对官方 `sessionStats` 投影采样**，再用累计值的差算速率。投影里的
`decodeTokens` / `decodeMs` 是单调累计的，所以：

```
30 秒速度 = (最后一次采样的 decodeTokens - 30 秒前那次采样的 decodeTokens)
          ÷ ((最后一次采样的 decodeMs - 30 秒前那次采样的 decodeMs) / 1000)
```

- 口径与官方「输出速度（TPS）」**完全一致**，只是范围收到最近 30 秒，两个数可以直接对照。
- 每个 step 结算时投影才变，所以每个 step 记一笔采样；**投影不变就不记**，读数也就
  原样保持（不挂定时器、空闲零开销）。
- 真算不出来（Δ解码毫秒为 0）时**沿用上一次有效读数**；冷启动还没有任何采样时退回
  「整段速度」（和官方那行同值），下一次 step 结算就换成窗口值。
- 每个会话的采样与最近读数写进 `localStorage`（`dsh-recent-tps:v1`，最多 24 个会话），
  所以**刷新页面后立刻有值**。

> 为什么不能直接算 Chat 节点的每步解码区间：节点的 `timing.firstTokenTime` 只来自
> **瞬时**的 `assistant/live-chunk`（重连时还有当前 attempt 的 baseline）。会话从磁盘回放
> （刷新页面 / 打开历史会话）时这些瞬时事件不存在，每个节点的 `firstTokenTime` 都是 `null`
> —— 那样算出来永远只有「—」。

**数据来源**全部是插槽的标准注入面，不读私有 API、不碰别人的 DOM：

| 来源 | 用途 |
|---|---|
| 来源 | 用途 |
|---|---|
| `useProjection('sessionStats')` | 四行官方读数 + 30 秒采样（拿不到的字段用 `useChat` 折叠兜底） |
| `useChat(s => s.legacy.nodes)` | 仅当投影缺失时折叠出整段统计 |
| 插槽标准 prop `sessionId` | 采样历史按会话隔离 |
| `configForms` → `ui-chat.performanceUsage` | 只读档位，保证「简洁模式只显示速度」不被破坏 |

## 注意

- 30 秒速度按**已结算**的 step 算：正在流式生成的那一步还没结算，所以读数最多滞后一步
  （官方整段读数同样滞后）；反过来说，没有新 step 结算时它也不会自己变。
- 不挂任何定时器：投影变了才记采样、才重算，空闲时零开销。
- 读数存在浏览器 `localStorage`（`dsh-recent-tps:v1`，每个会话一条，最多 24 条）。
  换浏览器 / 清缓存后，第一次打开会先显示整段速度，等下一个 step 结算就换成窗口值。
- 覆盖点依赖官方 `conversation.composer.dock` 的 id / order 契约。官方若改契约，
  本插件退化为不生效（官方读数保持原样），不会白屏。
- 宿主没有 `configForms`（更早的 DSH）时插件整体不挂载，官方读数原样保留。

## 测试

```powershell
cd dsh-recent-tps
npm test
```

## License

[MIT](../LICENSE)
