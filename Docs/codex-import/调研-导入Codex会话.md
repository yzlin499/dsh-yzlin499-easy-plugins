# 调研：把 Codex 会话导入 DSH（DeepSeek Harness）

> 调研日期：2026-10-14 ｜ 本机环境：DSH `0.2.0-rc.2`（`web` profile，桌面版）｜ Node `v24.21.0`
>
> 本文区分三类信息，阅读时请注意标记：
> **【实测】**＝本机亲自跑出来的数据/文件；
> **【源码】**＝从本机 DSH 安装包（`app.asar`）解出的源码/文档；
> **【外部】**＝第三方仓库与 npm 上的说法，已核实仓库/包真实存在，但内容未经本机运行验证。
>
> 配套文档（同系列三篇，职责不重叠）：
> - 本文 = **决策篇**：本机实测 + 方案对比 + 回写能力 + 建议。
> - **[调研-导入Codex会话-Codex本地存储格式.md](调研-导入Codex会话-Codex本地存储格式.md)** = **数据格式篇**：233 个 rollout（104,367 条记录 / 530 MB）的全量记录清单、36 行转换映射表、10 条注入正则、16 条陷阱。
> - **[调研-导入Codex会话-外部生态附录.md](调研-导入Codex会话-外部生态附录.md)** = **生态篇**：Codex 官方 `resume`/`fork`/app-server 通道、ACP 协议判定、同类迁移工具。

---

## 0. 结论先行（TL;DR）

1. **这个功能不用从零做**。社区已有 **3 个** 面向 DSH 的「导入 Codex 会话」插件，其中 2 个的 peer 依赖范围明确覆盖本机的 `0.2.0-rc.2`，1 个已发布到 npm 且带 Web 界面。**【外部，已核实】**
2. **技术上完全可行**，DSH 侧没有任何"禁止导入"的机制，且**不需要**修改 DSH 本体。
3. **而且官方给了入口**：`ctx.agents.create({ sessionId, seed: SessionEvent[], meta:{cwd} })` —— `seed` 是一等公民契约，把整段历史交给 DSH 自己的创建事务即可（失败「leaves no stored residue」）。**【源码】** 详见 2.3.1 / 第 5 节。
4. 真正难的只有格式**硬校验规则**（首帧只能装 header、tool 调用要双份表示、assistant 消息要 `stream` 等），已被公开文档逐条写明、并给出失败报错原文，且经 DSH 自带校验器体外验证一致。**【外部 + 本机交叉验证】**
5. **ACP 不是导入通道**：本机 DSH 的 ACP 实现**没有 `session/load`**，`session/new` 无 history 入参，也没有任何 create/import HTTP 端点。它只能用来**验收**（`list → resume → prompt`）。**【源码】**
6. 本机 Codex 侧数据量：**144 个会话、418 MB、90,419 行**，其中 **126 个**属于 `I:\Jx3YL\Product\Client\YunLiu` —— 而这个工作区在 DSH 里已经存在。**【实测】**
7. 主要风险不是技术，而是：**第三方插件是拥有完整文件权限的代码**，它能读 `~/.codex`（含 OAuth）和 `~/.dsh`（含 `.credentials.yaml`）；以及**导入体积**（一个 464 MB 的 rollout 全量回放约 824 万 token，远超模型窗口）。

**建议下一步**：先装 `dsh-chat-import`（npm 已发布、web 平台、peer 范围兼容本机）做一次 dry-run/小范围导入，验证「能列出 + 能续聊」；若只想要最深的转换质量再考虑 `dsh-codex-import`。详见第 6 节。

---

## 1. 本机现状（实测数据）

### 1.1 DSH 侧

| 项 | 值 |
|---|---|
| 版本 | `@deepseek-ai/dsh-desktop-runtime` **0.2.0-rc.2** |
| CLI | `C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`（`dsh --version` → 0.2.0-rc.2） |
| profile | `web`；`%USERPROFILE%\.dsh\profiles\web\package.json` 里已挂 8 个 bundle（含本仓库 5 个插件 + `hooks-adapter` 等） |
| 会话落盘 | `%USERPROFILE%\.dsh\sessions\<projectKey>\<sessionId>\session.v4.jsonl.zstd` |
| 工作区登记 | `%USERPROFILE%\.dsh\storages\workspace.json` → `tables.workspaces[<wsId>] = {path,title,sessionIds[],createdAt,updatedAt}` |
| 投影缓存 | `%USERPROFILE%\.dsh\storages\session_projcache\sessions\<sessionId>.json`（本机 138 个） |
| DSH 自带能力 | **有导出、无导入**：`dsh-session-log-export` 提供会话头部菜单「Download session log」与 `/export`，产出 `dsh-session-<id>.zip`（内含 `session.vN.jsonl` + attachments）**【源码】** |

本机已存在的 DSH 工作区：

```
I:\Jx3YL\Product\Client\YunLiu                                  → 58 个会话
D:\Users\Administrator\workspace\AIProject\YZLWork              → 27
D:\Users\Administrator\workspace\AIProject\股神AI                 →  7
D:\Users\Administrator\workspace\AIProject\dsh-yzlin499-easy-plugins →  8
D:\Users\Administrator\workspace\AIProject\BydButton            →  2
```

### 1.2 Codex 侧

对 `~/.codex/sessions` 下 **全部 144 个** rollout 文件做了元数据+行数统计：**【实测】**

- 总量：**144 个文件 / 418.2 MB / 90,419 行**
- 来源：`Codex Desktop` 131、`codex_exec` 9、`codex-tui` 4
- CLI 版本跨度：`0.128.0` → `0.162.0-alpha.17.2`（18 个版本）
- 按 cwd 分布：

| 会话数 | cwd |
|---:|---|
| **126** | `I:\Jx3YL\Product\Client\YunLiu` |
| 8 | `D:\Users\Administrator\workspace\AIProject\YZLWork` |
| 5 | `C:\Users\Administrator\AppData\Local\Temp` |
| 2 | `C:\Users\Administrator` |
| 1 | `...\Documents\Codex\2026-10-14\new-chat` |
| 1 | `...\Temp\codex-bridge-test` |
| 1 | `D:\Users\Administrator\workspace\AIProject\股神AI` |

**关键推论**：你要导的主体就是 `I:\Jx3YL\Product\Client\YunLiu` 那 126 个会话，而 DSH 里该工作区已存在（58 个 DSH 会话）——导入后会**并入同一个工作区**，形成「Codex 历史 + DSH 新会话」并列的视图。

新增（2026-10-14 当天）的文件说明 **Codex 现在仍在写 rollout JSONL**，不是只写 sqlite：

```
2026\10\14\rollout-2026-10-14T11-56-21-01a1388d-....jsonl   0.43 MB /  66 行
```

两个容易踩的坑（实测确认）：

1. **会话是"分页"的**：同一个 `session_id` 会横跨多个文件，文件名形如
   `rollout-<时间>-<rootId>_<pageId>.jsonl`。本机 `01a13348-1eba-...` 一个线程散在 4 个文件里。
   → 只导"最新那一页"会**从会话中间开始**。
2. **子代理线程混在同一目录**：`source.subagent.thread_spawn` 记录里带 `parent_thread_id` / `agent_path` / `agent_nickname`（如 `Explorer the 3rd`）。这类是否要导、要不要还原成 DSH 子会话，是需要产品决策的点。

---

## 2. 两边格式（本机实测 + 源码）

### 2.1 DSH 会话文件 v4：物理布局

**【实测】** 取 `session-f20ac183-...`（当前会话）逐帧解析：

```
文件大小 362,415 B，压缩后共 128 个独立 zstd 帧
frame 0 @0      210 B → 253 B, 1 条记录: session        ← 只有 header
frame 1 @210    154 B → 269 B, 3 条: permission/preset, sandbox/mode, approval/policy
frame 2 @364     98 B →  94 B, 1 条: agent-preset/selected
frame 3 @462    407 B → 601 B, 3 条: agent/inbox/spliced, turn/start
frame 4 @869  23,597 B → 66,526 B, 8 条: step/start, system/message, user/message, request/header, request/context
...
frame 72 @110978 43,950 B → 189,076 B, 3 条: step/start, request/header, developer/message
```

结论：

- **帧 = 一次写入批次**（不是"一个文件一帧"）。DSH 每 flush 一批事件就**追加**一个 zstd 帧。
- **第 1 帧恰好只装 header 一行**；事件从第 2 帧起。
- 每个帧**独立校验和**，是拼接关系，不是一个流。

真实 header（v4）：

```json
{"type":"session","version":4,"id":"session-f20ac183-4e45-4876-983b-0eb86fc58266",
 "createdAt":1791962661017,"cwd":"D:\\Users\\Administrator\\workspace\\AIProject\\dsh-yzlin499-easy-plugins",
 "isSeeded":false,"delegationDepth":0,"agentPreset":"standard"}
```

本机实测出现的事件类型（节选，按出现次数）：`step/start`、`assistant/message`、`tool/call`、`tool/result`、`step/end`、`turn/start`、`session/title`、`user/message`、`system/message`、`developer/message`、`request/header`、`request/context`、`subagent/catalog`、`permission/preset`、`sandbox/mode`、`approval/policy`、`agent-preset/selected`、`session/title-llm-request`。

### 2.2 会话目录名编码规则

**【实测】** `%USERPROFILE%\.dsh\sessions\` 下目录名：

```
I:\Jx3YL\Product\Client\YunLiu        →  --I-Jx3YL-Product-Client-YunLiu--
D:\...\AIProject\股神AI               →  --D-Users-...-~80A1~795EAI--
```

即：`/ \ :` 折叠为一个 `-`，`[A-Za-z0-9._-]` 保留，其它字符变成 `~` + 该 UTF-16 码元的 4 位大写十六进制（`股` = U+80A1 → `~80A1`），外面包 `--...--`。**【外部】** 的格式文档给出同一规则且补充了细节：空格 → `~0020`、去掉开头的分隔符、截断到 251 字符。

> 意义：导入器不需要猜——它可以**直接用目标 cwd 算出目录名**。

### 2.3 侧栏可见性：`workspace.json` 的 `sessionIds`

**【实测】** `storages\workspace.json` 结构：

```json
{"unit":{"name":"workspace","version":2},
 "global":{"initialized":true,"workspaceIds":[...],"archivedSessionIds":[...]},
 "tables":{"workspaces":{
   "1cfb2993-...":{"path":"D:\\...\\dsh-yzlin499-easy-plugins","title":"...",
     "sessionIds":["session-f20ac183-...","session-bf97e570-...", ... 8 个],
     "createdAt":"...","updatedAt":"..."}}}}
```

本机 `sessions\<projectKey>\` 下存在**目录但未登记**的会话，例如 `c4a5d038-be9a-4316-85cb-533d1bdd85c7`（有 `session.v4.jsonl.zstd`，但不在任何 `sessionIds` 里）。**【实测】**

**【源码】** `dsh-workspace/lib/index.js` 里有**自动收养/对账**逻辑：扫描各会话文件的 header，把 `accounted` 之外的 header id 归入对应 `path` 的工作区，必要时新建工作区记录（见 `lib/index.js` 约 762–811 行）。也就是说**理论上写对 header 就能自动入组**。

> ⚠️ 这两条证据**看起来冲突**：源码说会自动收养，但本机确实有未登记的会话目录。可能原因是那些目录属于子会话/特殊路径，或对账只在特定时机跑。**【外部】** 文档（v4 版）明确把「session id 必须写进 `workspace.json` 的 `sessionIds`」列为硬性要求 R2，违反则"会话不归属任何工作区"。
> **建议**：实现时**两条都做**——写正确的 header，同时（可选）补登 `sessionIds`，并在真机上验证侧栏可见性。

**但如果你走第 5.0 节的"官方持久化服务"路线，这一整节基本不用操心** —— 见下。

### 2.3.1 关键发现：DSH 提供了官方会话写入服务（本机源码确认）

**【源码】** `dsh-session-persistence/lib/index.js`（第 235–267 行）定义了持久化服务，服务键为 **`sessionPersistence`**：

```js
/** Durable session-persistence Service Definition (`ctx.sessionPersistence`). ... */
var SessionPersistence = class extends Service {
  identity = Symbol("sessionPersistence");
  constructor(ctx) { super(ctx, "sessionPersistence"); }
};
```

其后端 `dsh-session-persistence-jsonl` 实现的方法（同一文件内实测行号）：

| 方法 | 行号 | 说明 |
|---|---|---|
| `create(header, options)` | 2431 | 创建会话，返回 `SessionHandle` |
| `open(id, access, options)` | 2454 | 打开既有会话 |
| `stat(id, options)` / `list(options)` | 2536 / 2569 | 枚举与元数据 |
| `SessionHandle.append(events, options)` | 116 | 追加事件批次 |
| `flush()` | — | 持久化屏障（每个 handle 或服务级） |

同一模块还**导出了官方校验器 `validateStoredEvents`**（以及 `assertContiguous`、`assertVersion`、`sessionFormatVersionRefusal`），意味着自研实现可以**直接调用 DSH 自己的校验代码**，而不必靠猜。

最重要的一段契约（源码注释原文）：

> *Visibility: a created session is observable through `stat`/`list`/`open` in this process from the moment `create` resolves…*
> *Storage semantics shared by every backend: events are contiguous from seq 0 and never rewritten.*

**结论**：走 `ctx.sessionPersistence.create()` → `handle.append()` → `flush()`，**DSH 自己负责 zstd 分帧、`seq` 连续性、可见性登记**。这条路线上第 2.3 节的 `sessionIds` 手工登记、R7 投影缓存、R4 `seq` 连续性等问题**由框架兜底**——这也正是 `dsh-session-sync` 自述所走的路线。**自研时应优先选它，而不是手写字节。**

### 2.4 格式硬校验规则（两套独立来源，结论一致）

**【外部】** `dsh-codex-import/docs/formats.md`（面向 **v3**）给出 5 条被真实报错逼出来的规则：

| # | 违反时的报错（原文） | 规则 |
|---|---|---|
| 1 | `corrupt Zstandard session log: first frame is not exactly one header line` | 第 1 帧只能装 header 一行 |
| 2 | `session event "assistant/message" is surface-eligible and requires a surfaceOp marker` | surface 事件需要顶层 `surfaceOp`。**【源码更正】** 实际是 **5 种**（不是 4 种）：`system/message`、`developer/message`、`user/message`、`assistant/message`、`tool/result`（`dsh-session/lib/index.js:154-160`）；非 surface 类型带 `surfaceOp` 反而报错 |
| 3 | `session event at seq N lacks an identified message` | 每个 message 事件要有非空字符串 `id` |
| 4 | `seed assistant/message at index N has invalid settlement fields` | `assistant/message` 需要数字 `turn`、数字 `step`、以及 `stream` 数组 |
| 5 | `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'` | 每个 `tool/result` 必须有一条同名 `tool-call` **内容块**挂在 assistant 消息上（provider 读的是内容块，不是 `tool/call` 事件） |

**【外部】** `dsh-history-migration`（面向 **v4**）给出 9 条，多出 v4 特有的 4 条：

| # | 规则 | 违反后果 |
|---|---|---|
| R1 | `header.cwd` 与工作区规范路径**逐字符相等**（Windows 用反斜杠） | UI 显示"工作文件夹未分组" |
| R2 | session id 必须写进该工作区 `workspace.json` 的 `sessionIds` | 会话不归属任何工作区 |
| R3 | 首帧恰好只装 header 一行，其后每事件一帧 | `first frame is not exactly one header line` |
| R4 | `seq` 从 0 连续递增 | `has seq gap (expected n, got m)` |
| R5 | `assistant/message` 必须带完整模型流 `stream`（最小：`block-start → text-delta → block-end → finish`） | `invalid settlement fields` |
| R6 | 事件 source 形状合法（模型来源需 `kind/provider/model`） | `message must have model source` |
| R7 | 必须有投影缓存 `storages/session_projcache/sessions/<id>.json` | **侧栏看不到该会话** |
| R8 | `agentPreset` 要在目标 profile 组装范围内 | `runs under agent preset … not composed` |
| R9 | 每轮自成一对 `turn/start … turn/end`，`turn` 递增 | `turn/start does not open the expected turn` |

**【源码 + 实测 交叉验证】**：R3（首帧仅 header）与"逐事件一帧"我**在本机亲自量到了**（128 帧、frame 0 恰 1 条 `session` 记录）。R8 的前半也有本机证据：header 里有 `agentPreset: "standard"` 字段。R7 的投影缓存目录真实存在（138 个文件）——是否"缺了就看不见"未在本机复现，但可信度高。

> 这 5+9 条就是"导入功能"的全部技术难点。**好消息**：它们都已被公开、且带报错原文，任何一个实现者都能按图索骥。

### 2.5 v3 与 v4 的兼容性（本机已核实，重要）

**【源码】** 本机 DSH 的格式目录 `dsh-session-format-catalog/lib/index.js`：

```js
currentVersion: 4,
codecs: [releasedV0…, releasedV1…, releasedV2…, releasedV3…, releasedV4…],
migrations: [v0ToV1, v1ToV2, v2ToV3, v3ToV4],
```

**结论：装了 v3 的会话文件在本机仍然可读**——会被 v3 codec 解码、经 v3→v4 迁移后使用。所以「某插件输出 v3 格式」**不构成**在本机不可用的理由（前提是它满足 released-v3 的校验）。

### 2.6 v4 精确契约（经 DSH **自带校验器**体外验证）

这一节是把合成产物喂给 DSH 自己的 `sessionFormatCatalog` + `Session.fromRestore` 跑出来的结论，**不是推测**。

**header 行：字段是白名单，多一个就拒**

| 键 | 必填 | 约束 |
|---|---|---|
| `type` | ✅ | 字面量 `"session"` |
| `version` | ✅ | 当前 `4`（>4 拒"新版"，<4 走迁移链） |
| `id` | ✅ | 字符串；顶层约定 `session-<uuid>`，**子代理是裸 uuid**（这解释了磁盘上两种目录名） |
| `createdAt` | ✅ | 非负安全整数（ms） |
| `isSeeded` | ✅ | boolean |
| `delegationDepth` | ✅ | 非负安全整数（顶层 0） |
| `cwd` | ❌ | **必须绝对路径**；缺失则落 `_no-cwd` |
| `parentSession` / `origin` / `agentPreset` | ❌ | `origin` 只能是 `"subagent"` |

出现退役字段 `sandboxMode` / `approvalPolicy` 直接报错。**恰好这些键**，多一个报 `unexpected field`。

**事件行**：必填 `type`、`seq`、`time`、`data`；可选**仅** `surfaceOp`、`sourceEventSeqs`、`ignorable`（且 `ignorable` 只能为 `true`）。5 种 surface 类型必须带 `surfaceOp`（`"append"` 或 `{op:"replace",startSeq,endSeq}`），**非 surface 类型带它就是错**。

**物理层三条（本机实测 + 源码）**

- 文件名规范正则 `/^session(?:\.v([1-9][0-9]*))?\.jsonl$/` → 当前代 `session.v4.jsonl.zstd`；大写/前导零/`.v0` 都不被识别。
- 每帧独立 zstd + **XXH64 校验和**；**无 skippable frame、无自定义帧头元数据**，帧边界靠结构扫描得出。
- **header 必须独占第一帧**。实测对照：整文件压成单帧 → **格式目录通过**，但持久化读取路径报 `first frame is not exactly one header line` 被拒；header 独占首帧 → 两条路径都通过。

**完整性机制**：只有「zstd 帧校验和 + `seq` 从 0 稠密 + 生命周期关系校验」。**没有哈希链、没有清单文件、没有首尾记录强制要求**，也没有时间戳单调性要求。

**最小记录集（实测结论）**

- 只想被**列出/打开**：**1 个 header 帧 + 0 事件**即可（`list()` 只读第一帧第一行；实测 `Session.fromRestore` ACCEPTED）。
- 想**能续聊**：11 行即可通过 DSH 自带校验（header + `permission/preset` + `sandbox/mode` + `approval/policy` + `turn/start` + `step/start` + `system/message` + `user/message` + `assistant/message` + `step/end` + `turn/end`）。关键必填：`assistant/message` 的 `source.kind` 必须是 `"model"` 且 provider/model 非空、`data.stream` 必须是数组（`[]` 合法）。
- `turn/start.turn` 从 **1** 起递增；`step/start.step` **每个 turn 内**从 1 重新开始；`assistant/message`/`system/message` 必须落在**已打开的 turn+step** 内。
- 事件类型枚举共 **59 个**（`known-event-types.js`），本机 14 个真实样本里出现 **27 个**，另 **32 个**定义但未出现（compaction / team / tool-workflow / hooks / goal / schedule 等）。

**被接受的边界（反直觉，实测）**：`user/message` 不在任何 turn 内 → 合法；`ignorable:true` 的未知类型 → 合法；空字符串 `id` → 格式层合法（但落盘时目录名编码会抛错）。

---

## 3. 已有方案盘点（均经我亲自核实链接可用）

### 3.1 `Nwflower/dsh-chat-import` —— 覆盖 25+ 来源，已上 npm，带 Web 界面

- 仓库：<https://github.com/Nwflower/dsh-chat-import> ｜ npm：<https://www.npmjs.com/package/dsh-chat-import>
- **【外部】** 最新版 `0.25.2`，`fileCount 185`，`unpackedSize 2.79 MB`，MIT，作者 Nwflower。npm 上有 100+ 个版本，持续在更新。
- 声明：`dsh.bundle.patch` + `dsh.client = { platform: "web", inject: ["@deepseek-ai/dsh-client-locale"] }` → **有 Web 客户端界面，且明确是 web 平台**。
- peer 依赖（最新版实测字段）：
  ```json
  {"react":">=18.0.0","@deepseek-ai/dsh":">=0.1.5-rc.1","@deepseek-ai/cordis":"^4.0.1",
   "@deepseek-ai/dsh-tools":">=0.1.0-rc.6 <0.3.0","@deepseek-ai/schemastery":">=3.0.0",
   "@deepseek-ai/dsh-client-locale":">=0.1.0-rc.6"}
  ```
  → **`<0.3.0` 覆盖本机的 `0.2.0-rc.2`**，`dsh-tools` 的旧版 `^0.1.0-rc.6` 约束已在后续版本放宽。
- 能力（README 自述）：25+ 来源（Claude Code / Codex / ChatGPT / Cursor / Cline / opencode / Gemini / Kimi CLI / Qoder / Trae…），保留工具调用、推理、结果，支持反向导出与同步，带 GUI 导入面板，并对外暴露 `chatImport` host service 供其它插件复用。
- 依赖 `fzstd`（纯 JS zstd 解压），`bin/dsh-chat-import.mjs` 提供命令行。

**适配度：本机最高。** 平台对（web）、peer 范围对、装法最标准（npm）。

### 3.2 `NB4747/dsh-session-sync` —— 走 DSH 官方持久化接口

- 仓库：<https://github.com/NB4747/dsh-session-sync>（包名 `@z47_rose_1/dsh-session-sync`，v0.2.0，MIT）
- **【外部】** 特点：`/sync codex` / `/sync claude` / `/sync watch` / `/sync push`；启动即**自动监听** `~/.codex/sessions`，3 秒防抖增量导入；按源项目 `cwd` 自动归入 DSH 工作区；**双向**：`/sync push` 把 DSH 新回合写回 Codex rollout；依赖 `chokidar`。
- 技术路线（自述）：**不伪造磁盘文件**，而是 `SessionPersistence.create / append` —— 用 DSH 官方会话持久化服务写入（zstd 帧、连续 seq、配平 turn）。这是**最"正统"**的路线。
- peer 依赖实测：`@deepseek-ai/dsh-commands`、`dsh-session`、`dsh-session-persistence` 全部 `>=0.0.1-rc.1` → **同样覆盖 0.2.0-rc.2**。
- 安装方式自述：`pnpm add github:NB4747/dsh-session-sync` + 手写 `cordis.patch.yml`。

**适配度：高。** 写入方式最干净（用官方接口，将来升级破坏风险最小）；但没有 Web 客户端 UI（纯斜杠命令），且未发 npm（要 git 装）。

### 3.3 `tzwkb/dsh-codex-import` —— 转换质量与工程严谨度最高，但最"重"

- 仓库：<https://github.com/tzwkb/dsh-codex-import> ｜ 文档：<https://github.com/tzwkb/dsh-codex-import/blob/main/docs/formats.md>
- **【外部】** 包 v0.3.0，MIT，无 peerDependencies（不挑 runtime 版本），`engines.node >=22.19`（本机 Node 24 满足）。
- 只做 Codex 一件事，但做得极深，README/`docs/formats.md` 是本主题**最好的公开技术文档**：
  - 分组：一个会话横跨多个 rollout 分页文件；**不按文件名取 id**（自述 300 文件样本里文件名后缀只有 8% 与 `session_meta.session_id` 相符）；
  - **只导当前压缩窗口**（最后一条 `compacted` + 其后的记录），而不是全量回放 —— 理由写得非常硬：全量回放会得到**模型根本看不到的历史**，且长会话回放会超过上下文窗口，导致"能列出、能续聊、但发不出下一轮、也压缩不了"。举了实例：**一个 464 MB 的 rollout 回放约 824 万 token**，而 Codex 当前窗口约 13 万 token；
  - 丢弃 Codex 自己的上下文注入（`<environment_context>`、`<permissions instructions>`、`# AGENTS.md instructions`…），并在 `# Files mentioned by the user:` 这类信封里**抽出人类真正写的那段**；
  - 修复断裂的工具轮：无 call 的 result → 补 `codex_orphaned_tool`；无 result 的 call → 补确定性错误结果；
  - reasoning：**加密部分不可恢复**（Fernet / 服务端密钥），只有约 1/3 记录带明文 `summary`；
  - 图片：必须走 DSH attachment store 的 `saveImages()`（存储会**归一化重编码**，因此 `attachmentId` 不能自己算），两阶段转换；
  - 安全工程：两帧会话才视为"自己写的"可原地刷新（**因为运行中的 DSH 每批事件追加一帧**，被我实测印证）、digest 比对、不可变 rollback manifest、symlink 拒绝、原子发布、`--dry-run`。
- 命令面：`/import-codex --list / --since-hours / --session / --project / --dry-run / --force / --audit` 等，另带 `bin/import-codex.mjs` 纯命令行版。
- 注意：自述面向 `dsh-tui` profile，且**无 Web 客户端**（无 `dsh.client`）；输出 **v3** 会话（本机可经迁移链读取，见 2.5）。

**适配度：中高。** 转换逻辑最值得抄，但需要确认在 web profile 下的命令注册与体验。

### 3.4 `ayst-z/dsh-history-migration` —— 技能+工具链（v4 视角，可当参考资料）

- 仓库：<https://github.com/ayst-z/dsh-history-migration>
- **【外部】** 迁移 VS Code Copilot / MiMo / opencode 到 DSH 的一套脚本 + 技能文档，**面向 v4**，含 `references/dsh-session-format.md`、`scripts/lib/dsh-session.mjs`（zstd 帧分割/编码）、`verify-dsh-session.mjs`、`privacy-scan.mjs`，以及上面第 2.4 节的 9 条硬性要求。**不含 Codex 来源**，但它的格式库和校验器对自研实现直接可用。

### 3.5 对比小结

| 方案 | 平台/UI | 写入方式 | 覆盖来源 | 发布形态 | 对本机 peer 兼容 | 适合谁 |
|---|---|---|---|---|---|---|
| `dsh-chat-import` | web + GUI 面板 | 生成会话（含 fzstd） | 25+，含 Codex | **npm** | ✅ `<0.3.0` | **想马上用** |
| `dsh-session-sync` | web，斜杠命令 | **官方 `SessionPersistence`** | Codex + Claude Code | GitHub | ✅ `>=0.0.1-rc.1` | 要最稳、要自动实时同步 |
| `dsh-codex-import` | tui 向，CLI 亦可 | 直接写 v3 文件（自带 verify/rollback） | 只 Codex，质量最高 | GitHub | ✅ 无 peer 约束 | 要最强转换/要读实现 |
| `dsh-history-migration` | 脚本 + 技能 | 手写 v4 文件 + 缓存 | 无 Codex | GitHub | — | 自研时抄格式库 |

### 3.6 回写（DSH → Codex）能力对比

**结论：只有 `dsh-session-sync` 做真正的"原地回写"；`dsh-chat-import` 是"导出成文件、你自己搬"。**

| 方案 | 回写形态 | 落点 | 是否追加到已有会话 |
|---|---|---|---|
| **`dsh-session-sync`** | `/sync push <sessionId>` —— 把 DSH 新增回合**写回源 Codex rollout** | 源 rollout 原文件 | ✅ **追加**（同一会话，chronological order preserved） |
| `dsh-chat-import` | `export_chat({ format: "codex" })` 生成 **Codex rollout JSONL**；面板另有"transfer" | 默认 `~/.dsh/exports/`，**需你手动拷进 Codex 的 sessions 目录** | ❌ 写**新文件**（`createIfAbsent`，绝不覆盖） |
| `dsh-codex-import` | 无 | — | ❌ 明确 "the Codex rollout is never modified" |
| `dsh-history-migration` | 无 | — | ❌ 不含 Codex |

`dsh-session-sync` 的回写附带了两个必要的防护（其 README 自述）：**push→watch 循环防护**（push 后把新的 mtime 记进 manifest，watcher 跳过刚写的行，避免自己导入自己）、**外部变更检测**（若 Codex 侧在导入后又涨了新回合，会警告并把你的 DSH 回合按时间顺序接在其后）。代价是它**常驻监听且会反向写你的 Codex 数据**。

`dsh-chat-import` 的导出方向还有两个配套能力：`format: "claude"` 直接写进 `~/.claude/projects/<slug>/<uuid>.jsonl`（Claude Code 可直接 `--resume`）；`export_bundle` 产出 `.dshbundle.json`（DSH↔DSH **事件级无损**备份，双层 SHA-256 指纹，跨机器还原）。所有导出都会在 `degradations` 字段里列出有损项，不静默丢弃。

**⚠️ Codex 侧的两个"登记"问题（本机实测 + 后续深度研究修正）**

**（1）列表登记：resume 列表以 `state_5.sqlite` 的 `threads` 表为准**

- `threads` 表 **189 行**（114 未归档 + 75 已归档），字段含 `id, rollout_path, cwd, title, updated_at, model_provider, archived, first_user_message, model, cli_version, …`；**每个线程登记一个 `rollout_path`**（实测 189/189 有效）。
- 75 个已归档线程的 rollout 被**移动**到 `archived_sessions/`，路径随之更新。
- `threads.cwd` 用 Windows 扩展长度前缀存储（188/189 行为 `\\?\...`）。

**（2）内容权威：rollout 才是主存，sqlite 是派生投影**（这一条来自后续深度研究，**修正了我最初的判断**）

- `thread_history_1.sqlite` 的 `thread_history_projection_state` 里，`next_rollout_byte_offset` **精确等于 rollout 文件字节数**、`next_rollout_ordinal` **等于记录条数**（例：线程 `019fefe1-…` = 59634 B / 14 条 ↔ 偏移 59634 / 序号 14，偏移正好落在文件末尾）。
- `thread_items` 只有 31,013 行，**少于** rollout 里的 31,564 条 `item_completed`，且缺 `compacted` / `world_state` / `turn_context`，还把 `Extension`+`WebSearch` 归一成 `webSearch`、派生出了 rollout 里没有的 `sleep` —— **投影更少且有损**。
- `state_5.sqlite` 里还带着 `backfill_state`、`rollout_migration_state`（含 `last_checked_thread_id` 水位）、`rollout_migration_skipped_rollouts` 这些**对账/回填机制**的表。

> **我上一条回复的更正**：我曾根据"144 个 rollout 文件里有 30 个没有 `threads` 行"推断"全是顶层会话、是分页文件"。用了 `session_meta.source.subagent` 这个判据 —— **判据选错了**，子代理的权威标记是 **`thread_source:"subagent"`**。深度研究给出的正确解释是：`233 个 rollout 文件 → 只有 165 个 session_id`，多出的 68 个 = **子代理 rollout 24 个 + 续写分片 44 个**（续写分片靠 `history_base.end_ordinal_exclusive` 串链）。所以"无 `threads` 行"主要反映**一个会话摊在多个文件上，而 `rollout_path` 只指向其中一个**，而不是"Codex 不认未登记文件"。

**由此对回写的判断（区分确定与未定）**：

- **确定**：对**已在 Codex 登记表里**的会话（即从 Codex 导入的那些），把新回合**追加**回原 rollout 是安全的 —— `next_rollout_byte_offset` 水位正是 Codex 发现自己文件增长的方式。这就是 `dsh-session-sync` 的路径。
- **仍未验证**：把一个**全新** rollout 文件放进 `~/.codex/sessions/`，Codex 会不会为它**补建 `threads` 行**从而出现在 resume 列表里。既然 sqlite 是**派生**投影、且存在 `backfill_state`/`rollout_migration_state` 这类对账表，**"会被补登"是可能的**；但我没有实测，不能下结论。需要实测的正是 `dsh-chat-import` 导出后"自行拷入 sessions 目录"那一步。

---

## 4. 风险清单

### 4.1 安全（最需要你决策的一条）

**这三个插件都是第三方代码，安装后以 DSH 进程的完整权限运行。** 具体能碰到：

- `~/.codex/`：`auth.json`/`.credentials.yaml`（OAuth 令牌）、全部会话内容、`config.toml`；
- `~/.dsh/`：`.credentials.yaml`、**所有工作区所有会话的正文**、`storages/`；
- 你机器的整个文件系统（DSH 当前策略是 `danger-full-access`）。

**建议**：装之前至少做三件事——(1) 读一遍它的 `index.mjs`/`lib/`（尤其网络调用与写盘路径）；(2) 先备份 `~/.dsh/sessions` 与 `~/.dsh/storages`；(3) 优先选**已发 npm、有 CI/测试、有 `--dry-run`** 的那个（本主题三者都满足）。此外 `dsh-session-sync` 会**常驻监听并改写 Codex rollout**（`/sync push`），属于会**反向写你的 Codex 数据**的行为，需单独接受。

### 4.2 上下文/体积（比想象中严重）

**来源已核实**：rollout 是"日志"不是"模型看到的上下文"。Codex 用 `compacted` 记录替换之前的历史；**全量导入会把模型根本看不到的历史塞进 DSH**，结果是会话大到发不出请求、也压缩不动（压缩本身要把被压缩的片段回放给摘要模型，同样超窗）。

**本机风险量级**：我有 418 MB / 144 个 rollout，最大单个 3.44 MB（当天新会话），历史上有 2.31 MB、1.02 MB 的。按外部实测的换算比例（464 MB → 824 万 token），**个别超大会话确实可能落到不可续聊区**。→ **默认走"当前压缩窗口"策略，并提供 `--audit` 类的体积预检**。

### 4.3 忠实度（要接受的信息损失）

| 内容 | 结果 |
|---|---|
| 消息 / 工具调用 / 工具结果 | 可完整保留 |
| reasoning（思考） | **多数不可恢复**：服务端 Fernet 密钥加密，约 1/3 记录有明文 `summary` |
| 图片附件 | 需经 DSH attachment store 归一化重存；且**只有当模型声明接受图片时**才真正可见（本机默认模型 `deepseek-v4.1-flash` 未声明 image 模态时，会被替换成 `[image omitted…]`） |
| Codex 工具名（`exec`/`shell`…） | 只作为**历史文本**保留，在 DSH 里**不可调用** |
| Codex 注入的上下文 | 丢弃（否则会话开头是脚手架而非你的提问，且 DSH 会用首条消息生成标题） |
| 子代理线程 | 需决策：丢弃 / 拍平成普通会话 / 还原成 DSH 子会话 |
| 沙箱/权限记录 | Codex 原始值仅作参考，续聊时由 DSH 自己的策略决定 |

### 4.4 不可逆操作

`--force` 类开关会**覆盖已存在的会话文件**；若导入后又在该会话里续聊过，DSH 会追加帧，覆盖=**删掉你的新回合**。第三方实现用"帧数 + digest"来区分"是否被续聊过"，这个设计值得沿用以保安全。

---

## 5. 若决定自研：最小可行路径

**先选发布路线，这一选择决定 80% 的工作量与风险：**

| 路线 | 做法 | 代价 | 风险 |
|---|---|---|---|
| **B1（最推荐）`ctx.agents.create({ seed })`** | 把整段历史作为 `seed: SessionEvent[]` 交给官方创建事务 | 需要精确复刻事件 payload | **最低**。走 DSH 自己的创建事务，自述失败「leaves no stored residue」；自动进 UI 列表 |
| **B2 `ctx.sessionPersistence`** | `create(header)` → `handle.append(events)` → `flush()` | 同上 | 低。但不 emit `api-session/added`，UI 刷新需自行补 |
| **A 手写字节** | 自己拼 JSONL、自己 zstd 分帧、自己维护 `seq`、自己登记 `sessionIds`/投影缓存 | 必须自己实现第 2.4 节 5+9 条校验，并自建 verify | 高。格式演进（v4→v5）即失效 |
| **C ACP / 导出导入协议** | — | — | **不成立**：`session/load` 在本机 DSH 中不存在，`session/new` 无 history 入参，无导入 HTTP 端点 |

`dsh-session-sync` 走 B2，`dsh-codex-import` 走 A（并为此自建三重校验与 rollback）。**本报告推荐 B1。**

三条硬提醒（经源码确认）：

1. **`ctx.sessions.create()` 单独调用不落盘** —— 事件只路由给已注册 writer 的会话（`dsh-session-persistence-jsonl/lib/index.js:407-420`）。
2. **`append` 无法写 `ignorable` 字段**，而读回时对未知事件类型 fail-closed ⇒ **绝不能发明事件类型**（只能用 `known-event-types.js` 里的已知类型）；运行时不会报错，**重启读回才炸**。
3. `meta.cwd` 必须是绝对路径，否则会话落进 `_no-cwd` 目录、UI 显示"未分组"。

`dsh-session-sync` 走 B，`dsh-codex-import` 走 A（并为此自建了三重校验与 rollback）。**本报告推荐 B。**

三块工作：

1. **读取层**（无风险、可增量）：流式扫 `~/.codex/sessions/**/rollout-*.jsonl`，按 `session_meta.session_id`（含 lineage/parent）分组分页文件，**新鲜度读记录里的 `timestamp` 而不是 mtime**（分页迁移会改写冷文件、刷新 mtime），文件名后缀不可当 session id。默认从最后一条 `compacted` 起算窗口。
2. **转换层**（这是全部难点）：Codex 记录 → DSH 事件；必须满足第 2.4 节的校验。建议**直接参考** `dsh-codex-import/lib/convert.js` 的映射表与 `dsh-history-migration/scripts/lib/dsh-session.mjs` 的编码库，并调用本机可用的官方 `validateStoredEvents` 自检。
3. **发布层**：走第 5 节路线 B（`ctx.sessionPersistence`），不要手写 `session.v4.jsonl.zstd`。

**更省力的选择**：不要重造转换器。把 `dsh-codex-import` 的 `lib/convert.js` + `lib/verify.js` 当**参考实现**，自己只补 Web 侧 UI（导入面板/进度/封面决策），或者干脆**不写代码，直接用现成的**。

**验证配方**（第三方文档给出、本机 CLI 支持）：

```powershell
# 1) 导入（先 dry-run）
node bin/import-codex.mjs convert --since-hours 24 --out $env:TEMP\import-check --dry-run
# 2) 校验格式
node bin/import-codex.mjs verify $env:TEMP\import-check
# 3) 体积预检（不需要跑 harness）
node bin/import-codex.mjs audit  $env:TEMP\import-check
# 4) 真机验证「能列出 + 能续聊」：装好后重启 DSH Web，在新会话里 /import-codex --list
```

> DSH 侧"能否续聊"是**最后一个也是最弱的门**：有 5 条校验只在 list/restore 时生效，第 5 条（tool-call 配对）**只在真正续聊时才暴露**，没有任何内置校验器覆盖它。所以验收必须真的发一句话。

### 5.1 仍未确认、动手前必须先实测的点

| # | 未知项 | 为什么重要 |
|---|---|---|
| 1 | **`assistant/message.stream` 与 `message.content` 的一致性** | 格式层只要求 `stream` 是数组，但**读回路径**会校验二者一致（`content disagrees with its embedded stream`）。导入 Codex 助手消息时这是第一个会炸的地方，必须先小规模验证 |
| 2 | 侧栏可见性（R2/R7）在**走官方服务**时是否自动满足 | 源码注释称 `create` 后本进程立即可见；但**本机确实存在未登记 `sessionIds` 的会话目录**，两者需实测对齐 |
| 3 | `agentPreset` 的完整有效取值表 | 目前只在本机样本中确认 `standard` / `cordis` |
| 4 | Codex 侧 sqlite（`thread_history_1.sqlite` 184 MB / `state_5.sqlite`）是否为**主存**、与 rollout 的关系 | 决定"是否只读 rollout 就够"；本机实测 rollout 当天仍在写，但 sqlite 的 `threads` 表被外部资料指为 resume 列表的真实数据源 |

> 说明：我派出的 4 个深挖子代理中，**DSH v4 格式**与 **DSH 会话接口面**两个已交付并被本文采纳（第 2.3.1 / 2.4 / 2.5 / 2.6 / 第 5 节的多处结论来自它们，且做过体外校验）；**Codex 本地存储盘点**那一个未回传，故第 4 项仍待补。

---

## 6. 建议

**推荐的推进顺序：**

1. **先做一次最小验证（半天内可完成）**：装 `dsh-chat-import`（npm + web 平台 + peer 兼容本机），只用它的导入面板/命令导 **1 个最小的 Codex 会话**（例如 `01a13463-...` 那类 0.34 MB 的），然后**在 DSH 里真的发一句话**。这一步同时验证：侧栏可见性（R2/R7 是否真需手工补）、格式校验、模型能否续聊。
2. **成功后再批量**：按 `--project I:\Jx3YL\Product\Client\YunLiu` 或 `--since-hours` 分批导入，每次都先看体积预检，避免一次塞进 418 MB。
3. **如果要更稳或要实时同步**，再评估 `dsh-session-sync`（官方持久化接口路线）。
4. **只在以下情况才自研**：想把它做成你仓库的一个插件对外分发、或想要 Web 原生体验/中文文案/与本仓库其它插件协同（如 `dsh-quick-file` 选目录、`dsh-win-notify` 报进度）。那时**以 `dsh-codex-import` 为参考实现**，不要从零逆向格式。

**需要你决策的点**（见文末提问）：

- 要不要我现在就装 `dsh-chat-import` 试跑最小验证？
- 子代理线程（`source.subagent`，本机占相当比例）要导还是丢？
- 默认策略：**只导当前上下文窗口**（推荐，体积小、可续聊）还是**全量回放**（完整但可能变成"打不开的会话"）？