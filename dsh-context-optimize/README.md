# dsh-context-optimize —— 上下文优化模式

给 DSH 增加一个新的**会话模式**（agent preset）：`上下文优化`。它继承官方
`standard` 模式的全部插件，只把**压缩后端**换掉——历史不再被压成一段
官方八段摘要，而是折成**一页卡片**。

> 状态：**v0.1 预览**。本版交付「卡片式压缩 + 折叠准入」，`ask` / `expand`
> 两个取回工具在 v0.2（见「路线图」）。所以卡片里暂时**不写**「可以问我」的提示——
> 没有工具的承诺等于教模型去调用不存在的工具。

## 为什么要它

官方压缩（`@deepseek-ai/dsh-compaction-basic`）做的是：token 压力上来 → 把最旧的
一段平衡区间交给模型 → 产出一份八段式 Markdown 摘要 → 用一条 `user/message`
就地替换那段历史。它很稳，但有两个问题：

1. **摘要不可导航**：折完之后是一整块散文，模型只能读，不能"翻页"。
2. **触发只看水位**：压得太早，刚聊完的任务被折；压得太晚，窗口已经吃紧。

本模式的做法：

- **卡片替代摘要**：固定骨架（做了什么 / 原始请求 / 涉及文件 / 命令 / 错误 /
  未闭合 / 死路），模型扫一眼就知道"这段干过什么、卡在哪"。
- **巡航写卡**：折叠时用一次**低思考档**的模型调用产出「做了什么 + 结论 + 未闭合」，
  文件 / 命令 / 错误全部由**代码确定性抽取**，不交给模型编。
- **折叠准入**：首次折叠放行；之后必须"又连续做了若干个工具步"才允许再折
  （默认 6），避免走一步折一下。

## 安装

**Desktop 客户端（本机是这种）**：打开「插件」页 → 用插件管理器安装，目标填本目录的绝对路径
（本地联调）或 GitHub 子目录规格：

```
github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-context-optimize
```

**dsh web**（`--profile web` 只对 web 配置有效，Desktop 由应用自身管理，CLI 的 `--dump-config`
会被拒绝）：

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-context-optimize"
```

安装后**重启 DSH**，在会话的模式选择器里会出现「上下文优化」。

## 使用

1. 新建会话 → 切到「上下文优化」模式。
2. 正常干活。token 压力上来时，历史里的早期任务段会被折成一页卡片。
3. `/compact` 仍然可用（官方命令，走同一个后端）。

## 界面：侧边栏「上下文大纲」

装好后**侧边栏多一页「上下文大纲」**（通过 `dsh-better-sidebar` 的 `ctx.betterSidebar.registerTab`
注册，和你现在侧栏里的其它页同一套 API）：

- 顶部一行汇总：`已折叠 N 段 · X tok · Y 节点`；
- 下面是一条竖轴，每次折叠一个节点：`48.2K tok · 546 节点 · 20:31`，并标注触发来源
  （压力触发 / 溢出恢复）；
- 底部是闸门倒计时：`距下次可折还需 N 个工具步`，或者 `现在可折（已过 N 个工具步）`。

数据来自本插件 Host 半侧的 `GET /context-optimize/outline?session=<id>` —— 也就是
压缩后端自己记下的折叠历史（`CompactionResult.shadowedTokenCount` / `shadowedSeqs`），
**不是**客户端估算。拿不到的数字显示 `—`。

- 没装 `dsh-better-sidebar` 时自动回退成输入框 dock 里的一行窄轴（官方插槽注入面，
  `useProjection('sessionStats')` + `useChat` 节点流）；
- 客户端半侧不走 HMR（除非同时跑 `pnpm run dev:web`），装完 / 改完**刷新一次页面**。

## 工作原理

```
agent/pre-step ──> 压力检查（官方阈值，默认 W×0.8）
                     │
                     ├─ 折叠准入闸门：距上次折叠 ≥6 个工具步？（首折放行）
                     │
                     ├─ 选区（官方：最旧的一段「平衡」区间，节点 0 系统提示词永不遮蔽）
                     │
                     ├─ 巡航调用（低思考档）→ 一句话结论 + 未闭合项
                     │
                     └─ 代码抽取（文件 / 命令 / 错误）+ 模板渲染 → 卡片
                          → `compaction/summary` + 一条 replace 的 user/message
```

- **继承而不是重写**：事务、`compaction/start|summary|end` 锁语义、tool-pair 平衡
  校验、checkpoint source 全部复用官方 `BasicCompactionEngine`，只覆盖
  `compactIfNeeded`（准入）与 `summarize`（卡片）。
- **复用官方事件词汇**：仍然写 `compaction/*`，所以官方 `/compact`、上下文面板、
  工具结果修剪器（`toolResultPruner`）照常工作。
- **失败降级**：巡航调用失败/被取消/截断时，退化为「没有一句话结论」的确定性卡片，
  绝不因为写卡失败而卡住整轮。

## 配置

在 `cordis.patch.yml` 的 `context-optimize-compaction` 行上：

| 字段 | 默认 | 含义 |
|---|---|---|
| `minToolStepsBetweenFolds` | `6` | 距上次折叠至少多少个工具步才允许再折；`0` 关闭闸门 |
| `cruiseProvider` / `cruiseModel` | `''` | 写卡用的路由；留空跟随当前请求路由 |
| `maxTokens` | `2000` | 卡片输出上限（卡片本身应远小于它） |
| `locale` | `zh` | 卡片语言：`zh` / `en` |
| `retrievalTools` | `false` | v0.2 有 `ask` / `expand` 工具后打开，卡片才会渲染「取回」段 |

阈值与保留策略（`thresholdRatio` / `retainRatio` 等）本版**沿用官方默认**，暂不在本包开放。

## 已知限制

- 本版**没有** `fold` / `ask` / `expand` 工具：折叠由压力触发，取回原文请用官方的
  会话日志 / `session_query` 一类能力。
- 选区仍是官方的「最旧平衡区间」，不是按任务段（episode）边界。按 episode 选段
  需要精确遍历 surface 事件，排在 v0.2。
- 折叠后的卡片里有「死路（别重试）」段，但本版该段由代码从错误行推导，**不保证**
  覆盖所有失败尝试。

## 路线图

- **v0.2**：`ask`（向折叠段提问）+ `expand`（就地还原，下一步可见）两个工具；
  归档索引（L1：shadowedSeqs + hash）与 spill 全文补漏（L2）。
- **v0.3**：按 episode 选段 + 巡航的建议清单（只建议、不执行）。
- **v0.4**：用 fork 做「折过 / 没折过」的同题重放 A/B。

## 设计文档

- [设计-分层折叠与巡航.md](../Docs/context-optimize/设计-分层折叠与巡航.md)
- [调研-官方上下文机制.md](../Docs/context-optimize/调研-官方上下文机制.md)

## License

MIT
