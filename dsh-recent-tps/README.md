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
最近 30 秒——而且**锚定在最后一个已结算的 step 上**：它只在你真的又生成了一步时才变，
生成停下来之后**原样保持**（不会跟着墙上时钟衰减，也不会变成 `—`）。

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
- 它不跳、不衰减：**没有新的 step 结算就一直保持同一个读数**。只有整个会话压根没有可用的
  解码区间（provider 不报 timing / usage）时才显示 `—`（不编数字）。

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

**30 秒速度怎么算**：取每个已结算 step 的解码区间 `[firstTokenTime, completedTime]`，
与窗口 `[锚点-30s, 锚点]` 求交（**锚点 = 最后一个已结算 step 的 `completedTime`**），
token 按重叠比例分摊，再除以窗口内的解码毫秒：

```
窗口速度 = Σ(重叠 token) ÷ Σ(重叠毫秒) × 1000
```

与官方整段速度同口径（把窗口换成整段时两者相等）。锚定在最后一个 step 上而不是
「当前时刻」，是为了让它在生成停下后**保持不动**——实现上不挂任何定时器：
没有新节点就没有新渲染，天然静止。

**数据来源**全部是插槽的标准注入面，不读私有 API、不碰别人的 DOM：

| 来源 | 用途 |
|---|---|
| `useProjection('sessionStats')` | 官方整段统计（轮/步/耗时/token），缺失时用 `useChat` 折叠兜底 |
| `useChat(s => s.legacy.nodes)` | 已结算 step 的 timing / usage，算 30 秒窗口 |
| `configForms` → `ui-chat.performanceUsage` | 只读档位，保证「简洁模式只显示速度」不被破坏 |

## 注意

- 30 秒窗口按**已结算**的 step 算：正在流式生成的那一步还没结算，所以读数最多滞后一步
  （官方整段读数同样滞后）；反过来说，没有新 step 结算时它也不会自己变。
- 面板打开时不做任何轮询：读数随 `legacy.nodes` 变化重算，空闲时零开销。
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
