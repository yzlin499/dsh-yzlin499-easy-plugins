# 调研：Codex 本地会话存储格式（rollout / sqlite / 索引）与对话还原方法

> 本文是「把 Codex 会话导入 DSH」系列的**数据格式篇**，只回答一件事：
> **从 `C:\Users\Administrator\.codex` 的本地数据里，如何精确还原出完整对话（用户输入 / 助手回复 / 工具调用 / 工具结果）。**
>
> - 只做只读调研：全程未修改、移动、删除 `.codex` 下任何文件；sqlite 一律先复制到
>   `C:\Users\Administrator\AppData\Local\Temp\codex-research\` 再以只读方式打开。
> - 统计口径：机器上现存 **233 个 rollout 文件**（`sessions\` 144 + `archived_sessions\` 89），
>   共 **104,367 条记录**，逐行流式解析，**0 条 JSON 解析失败**。
> - 隐私：本文所有样本均已截断（长文本 ≤ 200 字符），并剥离了疑似凭据；业务代码内容一律以
>   `…[已省略]` 代替，未粘贴任何用户源码。
>
> 相关文档：DSH 侧格式与方案见《调研-导入Codex会话.md》，外部生态见《调研-导入Codex会话-外部生态附录.md》。

---

## 0. 结论先行（TL;DR）

1. **rollout JSONL 仍是会话的唯一权威主存**，且现在仍在写入（最新文件时间 `2026-10-14`）。
   sqlite **不是**主存，而是 rollout 的**派生投影（read-model）+ 目录索引**。
2. 每一行记录都有 `ordinal` 字段：**文件内单调递增、无跳号**（实测 233 个文件跳号总数 = 0）。
   同一条会话链的多个 rollout 文件，`ordinal` **跨文件连续**（`history_base.end_ordinal_exclusive`
   恰等于续写文件的首个 `ordinal`）。**这是唯一可靠的全局顺序键。**
3. 一个"会话"最多会摊到**多个 rollout 文件**：233 个文件只对应 **165 个 `session_id`**。
   子代理（subagent / guardian）会产生**自己的 rollout 文件**，并用 `parent_thread_id` 指回主线。
4. **同一条内容会以两套记录各写一遍**：`response_item/*`（模型 I/O 原貌）与
   `event_msg/item_completed`（UI 物品模型）。二者**部分**共享 `id`（43.9%），工具类则靠
   `call_id` 关联（仅 39.5%）。→ **重建对话请以 `response_item` 为准，`item_completed` 只做补充/降级。**
5. `response_item/message` 的 `role=user` **不等于**用户输入：实测 2,783 个 `input_text` 片段里
   只有 **2,114 个（76.0%）** 是真实用户输入，其余是 AGENTS.md、`<environment_context>`、
   中断提示、子代理转录、压缩摘要等注入。**最干净的"真实用户输入"信号是
   `event_msg/item_completed` 且 `item.type == "UserMessage"`（实测 1,150 条，其中 1,137 条为真实文本）。**
6. `response_item/reasoning` 共 12,715 条，其中 **11,429 条（89.9%）带 `encrypted_content` 字符串——不可读**；
   只有 **2,944 条（23.1%）带明文 `content[].reasoning_text`**，且 9,771 条连 `content` 字段都没有。
   → 推理内容**默认必须丢弃**，明文部分按开关降级保留。
7. 未知类型必须**优雅跳过**：实测顶层 `type` 8 种、`type/payload.type` 组合 22 种、`item.type` 15 种，
   版本跨度从 `0.128.0` 到 `0.155.0-alpha.9.2`，类型集合**跨版本仍在增长**。

---

## 1. 数据布局与实测规模

### 1.1 文件清单

| 路径 | 大小 | 实测内容 |
|---|---|---|
| `sessions\2026\MM\DD\rollout-*.jsonl` | **438,486,563 B（≈418 MiB）** | **144 文件 / 90,417 条记录** |
| `archived_sessions\rollout-*.jsonl` | **91,561,337 B（≈87 MiB）** | **89 文件 / 13,950 条记录** |
| `session_index.jsonl` | 19,305 B | 135 行，**124 个不同 id（11 个重复）** |
| `history.jsonl` | 12,755 B | 72 行（用户输入历史） |
| `thread_history_1.sqlite` | 184,791,040 B（176 MiB） | 20 个对象；`thread_items` **31,013 行** |
| `state_5.sqlite` | 962,560 B | 61 个对象；`threads` **189 行** |
| `goals_1.sqlite` | 32,768 B | `thread_goals` **0 行**（当前无目标数据） |
| `logs_2.sqlite` | 75,743,232 B | 日志（与对话无关） |
| `sqlite\codex-dev.db` | 225,280 B | 31 个对象；`local_thread_catalog` 78 行 |
| `version.json` | 105 B | `{"latest_version":"0.147.0","last_checked_at":"2026-08-11T…"}` |
| `.codex-global-state.json` | 420,733 B | 全局 UI 状态（非对话） |
| `config.toml` / `AGENTS.md` | 9,853 / 1,146 B | 配置与全局指令 |
| `rollout-migrations\` | — | **空目录** |

rollout 中出现的 `cli_version` 跨度：`0.128.0` → `0.155.0-alpha.9.2`（说明格式跨 20+ 个小版本仍兼容）。

### 1.2 层级结构（实测）

```
{ "timestamp": "2026-08-11T01:49:33.978Z",   // ISO-8601 UTC，毫秒精度
  "ordinal": 15,                              // 文件内单调递增序号，0 基
  "type": "response_item",                    // 顶层类型（8 种）
  "metadata": {...},                          // 仅 response_item 部分类型有
  "payload": { "type": "function_call", ... } // 有效载荷
}
```

### 1.3 顶层 `type` 出现次数（233 文件全量）

| `type` | 次数 | 占比 |
|---|---:|---:|
| `event_msg` | 48,518 | 46.5% |
| `response_item` | 46,717 | 44.8% |
| `token_usage_record` | 6,928 | 6.6% |
| `turn_context` | 1,235 | 1.2% |
| `world_state` | 429 | 0.4% |
| `session_meta` | 239 | 0.2% |
| `inter_agent_communication_metadata` | 222 | 0.2% |
| `compacted` | 79 | 0.1% |
| **合计** | **104,367** | 100% |

> `session_meta` 239 > 文件数 233：**6 个文件各含 2 条 `session_meta`**（resume 时重写，`session_id` 相同）。

### 1.4 `type / payload.type` 全部 22 种组合（实测计数）

| # | `type` / `payload.type` | 次数 |
|---:|---|---:|
| 1 | `event_msg` / `item_completed` | 31,564 |
| 2 | `event_msg` / `token_count` | 13,468 |
| 3 | `response_item` / `reasoning` | 12,715 |
| 4 | `response_item` / `function_call` | 7,620 |
| 5 | `response_item` / `function_call_output` | 7,617 |
| 6 | `token_usage_record` / *(无 payload.type)* | 6,928 |
| 7 | `response_item` / `message` | 6,254 |
| 8 | `response_item` / `custom_tool_call` | 6,032 |
| 9 | `response_item` / `custom_tool_call_output` | 6,032 |
| 10 | `turn_context` / *(无)* | 1,235 |
| 11 | `event_msg` / `task_started` | 1,172 |
| 12 | `event_msg` / `thread_settings_applied` | 1,152 |
| 13 | `event_msg` / `task_complete` | 1,015 |
| 14 | `world_state` / *(无)* | 429 |
| 15 | `session_meta` / *(无)* | 239 |
| 16 | `inter_agent_communication_metadata` / *(无)* | 222 |
| 17 | `response_item` / `agent_message` | 222 |
| 18 | `event_msg` / `turn_aborted` | 147 |
| 19 | `response_item` / `tool_search_call` | 87 |
| 20 | `response_item` / `tool_search_output` | 87 |
| 21 | `compacted` / *(无)* | 79 |
| 22 | `response_item` / `web_search_call` | 51 |
| | **合计** | **104,367** |

### 1.5 `event_msg/item_completed` 的 `item.type` 分布（31,564 条）

| `item.type` | 次数 | 说明 |
|---|---:|---|
| `Reasoning` | 11,562 | 思考（含 `summary_text` / `raw_content`） |
| `CommandExecution` | 7,844 | 命令执行（含 stdout/stderr/exit_code） |
| `McpToolCall` | 5,531 | MCP 工具调用（含 server/tool/result） |
| `AgentMessage` | 3,677 | 助手回复 |
| `FileChange` | 1,229 | 文件改动（含 unified_diff） |
| `UserMessage` | 1,150 | **真实用户消息（最干净信号）** |
| `SubAgentActivity` | 228 | 子代理启停 |
| `Extension` | 132 | 扩展（多为 `kind:"web.search"`） |
| `ContextCompaction` | 77 | 上下文压缩标记 |
| `WebSearch` | 51 | 联网搜索 |
| `ImageView` | 44 | 图片查看 |
| `CollabAgentToolCall` | 28 | 多代理协作工具（spawn/wait/…） |
| `FunctionCallOutput` | 5 | 裸工具输出 |
| `HookPrompt` | 4 | hook 注入的提示 |
| `DynamicToolCall` | 2 | 动态工具 |

### 1.6 `response_item/message` 的 role 与 content 片段（6,254 条消息）

| role | 消息数 | content 片段 |
|---|---:|---|
| `assistant` | 3,761 | `output_text` × 3,761（每条 1 段） |
| `user` | 1,532 | `input_text` × 2,783、`input_image` × 49 |
| `developer` | 961 | `input_text` × 1,600 |

`payload.phase` 分布：无（`undefined`）2,699 / `commentary` 2,549 / `final_answer` 1,006。

### 1.7 其他关键计数

| 指标 | 值 |
|---|---:|
| `response_item/reasoning` 总数 | **12,715** |
| 其中 `encrypted_content` 为**字符串**（不可读） | **11,429（89.9%）** |
| 其中 `encrypted_content == null` | 1,286 |
| 其中带 `content[].reasoning_text` **明文** | **2,944（23.1%）** |
| `reasoning.content` 字段**完全缺失** | 9,771 |
| `reasoning.summary` 数组长度分布 | 0 段 6,857 / 1 段 3,532 / 2 段 1,519 / 3 段 807 |
| `function_call` + `custom_tool_call` 的 `call_id` 总数 | 13,652 |
| 其中能在同文件内找到同名 `*_output` 的 | 13,644（**缺失仅 8 个，均为中断**） |
| `item_completed.id` 与 `response_item.id` 共享 | 13,694（占 item_completed 的 43.9%） |
| 工具类 item 的 `id` 等于某个 `call_id` | 5,961 / 15,089（39.5%） |
| 各文件 `ordinal` 跳号总数 | **0** |

主要 id 配对关系（`response_item` → `item_completed`）：

| 配对 | 次数 |
|---|---:|
| `reasoning` → `Reasoning` | 10,707 |
| `message/assistant` → `AgentMessage` | 2,927 |
| `web_search_call` → `WebSearch` | 51 |
| `function_call_output` → `FunctionCallOutput` | 5 |
| `message/user` → `HookPrompt` | 4 |

工具类 item 的 `id` 匹配到的都是 `*_output` 的 `call_id`（`function_call_output` 5,610 + `custom_tool_call_output` 351），
**其余 60% 的 item 用的是 `item-N` / `exec-<uuid>` 等与 `call_id` 无关的 id** → 不能靠 id 全量配对。

---

## 2. 完整记录类型清单与真实样本

> 样本一律截断到 200 字符量级；`cd`/路径类信息保留（用于说明语义），业务代码与密钥不粘贴。

### 2.1 `session_meta`（文件首条，1 条/文件，resume 时追加第 2 条）

真实样本（截断）：

```json
{"timestamp":"2026-07-16T03:05:26.416Z","ordinal":0,"type":"session_meta","payload":{
 "session_id":"019f68e2-ac58-73f3-8e48-17624398432d",
 "id":"019f68e2-ac58-73f3-8e48-17624398432d",
 "timestamp":"2026-07-16T03:05:13.585Z",
 "cwd":"D:\\…\\股神AI","originator":"codex-tui","cli_version":"0.128.0","source":"cli",
 "model_provider":"custom",
 "base_instructions":{"text":"You are Codex, a coding agent based on GPT-5. …[+21135 chars]"},
 "history_mode":"paginated"}}
```

字段全集（实测出现过的键）：
`session_id`、`id`、`timestamp`、`cwd`、`originator`、`cli_version`、`source`、`model_provider`、
`base_instructions{text}`、`history_mode`、`git{commit_hash,branch,repository_url}`、
`thread_source`、`parent_thread_id`、`forked_from_id`、`forked_from_ordinal_exclusive`、
`history_base{thread_id,end_ordinal_exclusive,end_byte_offset}`、`subagent_history_start_ordinal`、
`context_window{window_id}`、`multi_agent_version`、`dynamic_tools`、`agent_path`、`agent_role`、
`agent_nickname`、`runtime_workspace_roots`。

**`id` 与 `session_id` 的区别（重要）**：
- `payload.id` = 该 rollout 文件的**线程 id**（= 文件名里第一个 UUID）。
- `payload.session_id` = **逻辑会话 id**，在续写/子代理文件里指向"所属主线"，与文件名 UUID 可以不同。
- 实测 **209/233 个文件两者相同**；24 个不同（子代理 24 个 + 部分续写文件）。

子代理 rollout 的 `session_meta` 真实样本（截断，字段最全的一种）：

```json
{"session_id":"019fc58d-be36-7433-8b8a-19c8c992f0c3",
 "id":"019fc58f-207e-7341-b020-d7974c27bc14",
 "parent_thread_id":"019fc58d-be36-7433-8b8a-19c8c992f0c3",
 "originator":"Codex Desktop","cli_version":"0.146.0-alpha.9.2",
 "source":{"subagent":{"other":"guardian"}},"thread_source":"subagent",
 "base_instructions":{"textLen":13550},"history_mode":"paginated",
 "subagent_history_start_ordinal":493,"multi_agent_version":"disabled",
 "context_window":{"window_id":"019fc58f-207e-7341-b020-d7a05f7f6ff0"},
 "git":{"commit_hash":"4fe640…","branch":"master","repository_url":"https://gitee.com/…"}}
```

`source` 实测取值分布（233 文件）：

| `source` | 文件数 |
|---|---:|
| `{"vscode":…}` / `vscode` | 169 |
| `cli` | 31 |
| `exec` | 9 |
| `{"subagent":{"other":"guardian"}}` | 6 |
| `{"subagent":{"thread_spawn":{…}}}` | 15 |
| 其他/空 | 3 |

`thread_source`：`user` 206 / `subagent` 24 / `agent_created_thread` 1 / 空 2。

### 2.2 `event_msg/task_started` —— 回合开始

```json
{"timestamp":"2026-07-16T03:05:26.418Z","ordinal":1,"type":"event_msg","payload":{
 "type":"task_started","turn_id":"019f68e2-ddb2-7ee2-93f6-b115f83cf4cb",
 "started_at":1784171126,"model_context_window":194560,"collaboration_mode_kind":"default"}}
```

字段：`type`、`turn_id`、`root_turn_id`（多代理时）、`started_at`（**Unix 秒**）、
`model_context_window`、`collaboration_mode_kind`、`turn_attribution`。

**`turn_id` 是划分回合的主键**：一个回合 = 一次 `task_started` → 若干 I/O → 一次 `task_complete` 或 `turn_aborted`。

### 2.3 `response_item / message`（含 role=developer 的系统注入）

`developer` 样本（截断）：

```json
{"timestamp":"2026-07-16T03:05:26.419Z","ordinal":2,"type":"response_item","payload":{
 "type":"message","role":"developer",
 "content":[{"type":"input_text","text":"<permissions instructions>\nFilesystem sandboxing defines which files can be read or written. `sandbox_mode` is `workspace-write`：…[+5523 chars]"},
            {"type":"input_text","text":"<collaboration_mode># Collaboration Mode: Default…"},
            {"type":"input_text","text":"<skills_instructions>\n## Skills\nA skill is a set of local instructions…"}]}}
```

`assistant` 样本（截断）：

```json
{"type":"response_item","payload":{"type":"message","role":"assistant","phase":"final_answer",
 "content":[{"type":"output_text","text":"pong ✅ Working directory … is accessible and I'm ready to help. What…"}]}}
```

`user` 样本（**这条是真实用户输入**）：

```json
{"type":"response_item","payload":{"type":"message","role":"user",
 "content":[{"type":"input_text","text":"你当前环境是什么？ps还是wsl"}]}}
```

字段：`type`、`role`、`content[]`、`id`（如 `msg_…`）、`phase`、`internal_chat_message_metadata_passthrough{turn_id,create_time}`。
`content[]` 元素类型实测：`input_text`（user/developer）、`output_text`（assistant）、`input_image`（user）。

### 2.4 `response_item / function_call` + `function_call_output` —— 旧版工具调用

```json
{"timestamp":"2026-08-11T01:49:33.978Z","ordinal":15,"type":"response_item","payload":{
 "type":"function_call","id":"97267643-9a4d-4886-bf6f-a55c2a13d27a",
 "name":"shell_command",
 "arguments":"{\"command\": \"Get-ChildItem -Force | Select-Object Mode, Length, Name\"}",
 "call_id":"call_00_u7FRLFb6t5ATXDw9BUO61186",
 "internal_chat_message_metadata_passthrough":{"turn_id":"019fee82-99b0-7772-b797-05aa8a264ec3"}}}
```

```json
{"timestamp":"2026-08-11T01:49:35.190Z","ordinal":20,"type":"response_item","payload":{
 "type":"function_call_output","id":"fco_019fee82-c456-7df1-afa1-1bd2cfca55cb",
 "call_id":"call_00_u7FRLFb6t5ATXDw9BUO61186",
 "output":"execution error: Io(Custom { kind: Other, error: \"windows sandbox: runner failed…\" …[+312 chars]",
 "internal_chat_message_metadata_passthrough":{"turn_id":"019fee82-99b0-7772-b797-05aa8a264ec3"}}}
```

- `arguments` 是 **JSON 字符串**（需要二次 `JSON.parse`）。
- `output` 是**纯字符串**（不是结构化 JSON）。
- 同一个回合里的多个 `function_call` **可能被一次性批量发出**（实测一个回合 4 个 call 连排在 ordinal 15–19，
  其 4 个 `*_output` 随后连排在 20–23）→ **不能假设"调用-结果"严格交替**，必须靠 `call_id` 配对。

主要 `function_call.name` 实测分布（Top）：`exec_command` 3,199、`shell_command` 848、`call_tool` 557、
`wait` 454、`codegraph_node` 394、`get_file_problems` 199、`codegraph_explore` 197、`send_message` 170、
`write_stdin` 135、`describe_toolset` 108、`get_goal` 105、`codegraph_search` 97、`search_in_files_by_text` 86 …
（共 70+ 个不同名字，多为 MCP 工具透传）。

### 2.5 `response_item / custom_tool_call` + `custom_tool_call_output` —— 新版工具调用

```json
{"timestamp":"2026-08-25T08:31:01.014Z","ordinal":222,"type":"response_item","payload":{
 "type":"custom_tool_call","id":"ctc_0365bf225aef29a8016a8d528c13a487d2b6fcdf46800e6acc",
 "status":"completed","call_id":"call_HjR7S3Dcu7gM9BiUlgqwuBsd",
 "name":"apply_patch",
 "input":"*** Begin Patch\n*** Update File: Source/…[已省略，业务代码]\n*** End Patch",
 "internal_chat_message_metadata_passthrough":{"turn_id":"01a03806-bee8-7312-abb6-20da5a0536c2",
   "create_time":1787646554.066335}}}
```

```json
{"type":"response_item","payload":{"type":"custom_tool_call_output",
 "id":"ctco_01a0380b-5312-74d0-876d-acdb35a7430d","call_id":"call_HjR7S3Dcu7gM9BiUlgqwuBsd",
 "output":"apply_patch verification failed: Failed to find expected lines in I:\\…[已省略] …[+228 chars]"}}
```

实测 `custom_tool_call.name` 仅两种：`exec` 4,538、`apply_patch` 372。
**`input` 是原始字符串**（`exec` 是 JS 片段、`apply_patch` 是 patch 文本），**不是 JSON** —— 与 `function_call.arguments` 相反。

> ⚠️ 新旧两代的**判据**：`0.146` 及以前主要用 `function_call`；`0.152+` 用 `custom_tool_call`（`exec` 统一入口）。
> 转换器必须**同时支持两套**，否则会丢掉半数工具调用（实测 7,620 vs 6,032）。

### 2.6 `response_item / reasoning` —— 思考（绝大部分不可读）

```json
{"timestamp":"2026-08-03T02:58:42.116Z","ordinal":8,"type":"response_item","payload":{
 "type":"reasoning","id":"5b9ef9f3-213b-42c2-93a8-679883591687",
 "summary":[],
 "content":[{"type":"reasoning_text","text":"The planned action is a read-only tool call: `codegraph_node` with `file: …` …[+423 chars]"}],
 "encrypted_content":null,
 "internal_chat_message_metadata_passthrough":{"turn_id":"019fc58f-2157-7293-886a-df9cbe5ad96f"}}}
```

- `summary[]`：`{type:"summary_text", text:…}` 数组，多数为 0 段（6,857 条）或 1 段（3,532 条）。
- `content[]`：`{type:"reasoning_text", text:…}`；**9,771 条记录里该字段完全缺失**，仅 2,944 条带明文。
- `encrypted_content`：字符串形式出现 **11,429 次 / 12,715 条（89.9%）**（OpenAI 加密推理，**不可解密、必须丢弃**）。
- 明文 `reasoning_text` 仅 **2,944** 条（23.1%），且多属于**第三方 provider（DeepSeek/GLM 等）**的推理回传。

### 2.7 `event_msg / item_completed` —— UI 物品模型（31,564 条）

`UserMessage`（**真实用户输入的最干净信号**）：

```json
{"timestamp":"2026-07-16T03:05:26.421Z","ordinal":6,"type":"event_msg","payload":{
 "type":"item_completed","thread_id":"019f68e2-ac58-73f3-8e48-17624398432d",
 "turn_id":"019f68e2-ddb2-7ee2-93f6-b115f83cf4cb",
 "item":{"type":"UserMessage","id":"item-1",
         "content":[{"type":"text","text":"你当前环境是什么？ps还是wsl","text_elements":[]}]},
 "completed_at_ms":1784171126421}}
```

`AgentMessage`：

```json
{"type":"event_msg","payload":{"type":"item_completed","thread_id":"…","turn_id":"…",
 "item":{"type":"AgentMessage","id":"item-2","content":[{"type":"Text","text":"我来发起几类读取操作来测试工具：…"}],
         "phase":"commentary"},"completed_at_ms":1786412973811}}
```

`CommandExecution`（**比 `function_call_output` 信息更全**）：

```json
{"type":"event_msg","payload":{"type":"item_completed","thread_id":"…","turn_id":"…",
 "item":{"type":"CommandExecution","id":"call_00_FP81SQ8JrSzTRjYAnVe86970",
   "command":["…\\pwsh.exe","-Command","Get-ChildItem -Force -Path \"I:\\…\" | Select-Object FullName, …"],
   "cwd":"file:///I:/…","parsed_cmd":[{"type":"unknown","cmd":"Get-ChildItem …"}],
   "source":"agent","status":"failed","stdout":"","stderr":"execution error: …[+481]",
   "aggregated_output":"…[已省略]","exit_code":null,"duration":{…},"process_id":"…"},
 "started_at_ms":…,"completed_at_ms":…}}
```

`McpToolCall`：

```json
{"type":"event_msg","payload":{"type":"item_completed",
 "item":{"type":"McpToolCall","id":"call_00_VY11zaGLQFgJsaMDNcMz4311","server":"codegraph",
   "tool":"codegraph_node","arguments":{"file":"…[已省略]"},"status":"completed",
   "result":{"content":[{"type":"text","text":"**Source/…** — 80 lines, 1 symbol · used by 1 file…"}]},
   "duration":{"secs":0,"nanos":30101700}}}}
```

`FileChange`（**唯一带 diff 的地方**）：

```json
{"type":"event_msg","payload":{"type":"item_completed",
 "item":{"type":"FileChange","id":"call_1v6zHVBZ8XQjOmztOLwUZfZC",
   "changes":{"I:\\…\\CameraRig.h":{"type":"update","unified_diff":"@@ -8,3 +8,2 @@…[已省略，业务代码]","move_path":null}},
   "status":"completed","stdout":"Success. Updated the following files:\nM Source/…","stderr":""}}}
```

其余 `item.type` 的独有字段：
`WebSearch{query,action{type:search|open_page,queries}}`、`ImageView{path:"file:///…"}`、
`SubAgentActivity{kind,agent_thread_id,agent_path}`、`Extension{kind,query,action,results[],durationMs}`、
`CollabAgentToolCall{tool,status,sender_thread_id,receiver_thread_ids,receiver_agents,agents_states}`、
`ContextCompaction{}`、`HookPrompt{fragments[{text,hookRunId}]}`、`FunctionCallOutput{name,namespace,output}`、
`DynamicToolCall{}`。

### 2.8 `event_msg / token_count`（13,468 条）

```json
{"timestamp":"2026-08-03T02:58:42.171Z","ordinal":11,"type":"event_msg","payload":{
 "type":"token_count",
 "info":{"total_token_usage":{"input_tokens":14001,"cached_input_tokens":0,"cache_write_input_tokens":0,
   "output_tokens":148,"reasoning_output_tokens":141,"total_tokens":14149},
   "last_token_usage":{…同结构…},"model_context_window":950000},
 "rate_limits":{"limit_id":"codex","limit_name":null,"primary":null,"secondary":null,"credits":null,
   "individual_limit":null,"spend_control_reached":null,"plan_type":null,"rate_limit_reached_type":null}}}
```

→ 纯计量/限流信息，与对话内容无关，**导入时应丢弃**（但可用于估算会话体量）。

### 2.9 `token_usage_record`（6,928 条，顶层类型）

```json
{"timestamp":"2026-09-10T08:32:14.970Z","ordinal":2305,"type":"token_usage_record","payload":{
 "thread_id":"01a041f9-05fc-7b50-978e-243f3c063f60","turn_id":"01a08a71-91b-…",
 "session_id":"01a041f9-05fc-7b50-978e-243f3c063f60","root_turn_id":"01a08a71-91b-…",
 "response_id":"resp_050ef341483fb536016aa26aff8c4887d08f253437afacd256",
 "usage":{"input_tokens":216184,"cached_input_tokens":0,"cache_write_input_tokens":0,
   "output_tokens":375,"reasoning_output_tokens":79,"total_tokens":216559},
 "turn_token_usage":{…},"thread_token_usage":{…}}}
```

→ 只出现在 `2026-09-09` 之后的文件（新版新增），是**按 response 粒度的用量账本**，
与 `token_count` 冗余但字段更细。**丢弃**。

### 2.10 `turn_context`（1,235 条）

```json
{"timestamp":"2026-07-16T03:05:26.419Z","ordinal":4,"type":"turn_context","payload":{
 "turn_id":"019f68e2-ddb2-7ee2-93f6-b115f83cf4cb","cwd":"D:\\…\\股神AI",
 "current_date":"2026-07-16","timezone":"Asia/Shanghai","approval_policy":"on-request",
 "sandbox_policy":{"type":"workspace-write","writable_roots":["…\\.codex\\memories"],"network_access":false,…},
 "permission_profile":{"type":"managed","file_system":{"type":"restricted","entries":[…]},"network":"restricted"},
 "model":"glm-5.2","effort":"xhigh","summary":"none","personality":"friendly",
 "collaboration_mode":…,"workspace_roots":[…],"host_skills"/"disabled_plugin_ids"/"comp_hash"/"realtime_active"…}}
```

→ **每个回合开始时写入一条，是本回合的"环境快照"**（模型、推理强度、沙箱、时区）。
导入时可用于**给消息打 model / cwd / timestamp 上下文标签**，但正文应丢弃。

### 2.11 `world_state`（429 条，仅 07-15 之后出现）

```json
{"timestamp":"2026-08-03T02:58:39.671Z","ordinal":4,"type":"world_state","payload":{
 "full":true,
 "state":{"agents_md":{"directory":"D:\\…\\YZLWork","text":"<!-- CODEGRAPH_START -->…[+9649 chars]"},
   "apps_instructions":false,
   "environments":{"environments":{"local":{"cwd":"D:\\…","status":"available","shell":"powershell"}},
                   "current_date":"2026-08-03","timezone":"Asia/Shanghai",
                   "filesystem":"<filesystem><workspace_roots><root>D:\\…</root></workspace_roots>…"},
   "git_attribution":…,"host_skills":…,"model":…,"multi_agent_mode":…,"orchestrator_skills":…,
   "permissions":…,"personality":…,"plugins_instructions":…,"realtime":…,"skills":…}}}
```

`state` 键集合实测：`agents_md`、`apps_instructions`、`collaboration_mode`、`environments`、
`environments_instructions`、`git_attribution`、`host_skills`、`model`、`multi_agent_mode`、
`orchestrator_skills`、`permissions`、`personality`、`plugins_instructions`、`realtime`、`skills`。

→ **这是 AGENTS.md 全文 + 环境 + 技能清单的"世界状态"快照**。它是**注入内容的权威来源**：
判定某条 `role=user` 消息里嵌的 `# AGENTS.md instructions for …` 属于注入，即可用此处的
`agents_md.directory` / `agents_md.text` 交叉验证。**导入时必须整条丢弃**（否则会把 9.6KB 项目文档塞进对话）。

### 2.12 `compacted`（79 条）—— 上下文压缩边界

```json
{"timestamp":"2026-08-11T10:05:36.857Z","ordinal":826,"type":"compacted","payload":{
 "message":"Another language model started to solve this problem and produced a summary of its thinking process.…[+3388 chars]",
 "replacement_history":[{"type":"message","id":"msg_019ff048-…","role":"user",
   "content":[{"type":"input_text","text":"话说我链接到AgentWorkspace体系了么？\n"}],…}, …],
 "window_number":1,
 "first_window_id":"01a05c1a-35e6-7fe0-b369-354b1b96a79b",
 "previous_window_id":"01a05c1a-35e6-7fe0-b369-354b1b96a79b",
 "window_id":"01a06021-8014-7643-abfd-cce7fdf43801"}}
```

字段全集（实测）：`message`、`replacement_history[]`、`window_number`、`window_id`、
`previous_window_id`、`first_window_id`（部分版本另有 `guardian_history`、`retained_context`、
`resume_metadata`、`replacement_history_metadata`、`latest_token_usage_record`，本机数据中未出现）。

实测特征：
- **79 条**，每条的 `window_number` 递增（分布 1:30、2:18、3:8、4:6、5:5、6:2、7..15 各 1–2）；
- `message` 长度 1,834–4,876 字符（压缩摘要提示词）；
- `replacement_history[]` 长度随窗口号**单调增长**（实测 8、15、20、23、29、35 …，最大 65）
  → **它是"压缩后模型可见历史"的累积快照，不是增量**。

> ⚠️ **转换陷阱**：`replacement_history` 里的 message **与文件中更早的 `response_item/message` 大量重复**
> （同 id / 同文本）。若把它直接拼进线性对话，会造成**严重重复计数**。
> 正确做法见 §4.3。

### 2.13 `event_msg / task_complete`、`turn_aborted`

```json
{"timestamp":"2026-07-16T03:06:07.148Z","ordinal":7,"type":"event_msg","payload":{
 "type":"task_complete","turn_id":"019f68e2-ddb2-7ee2-93f6-b115f83cf4cb",
 "last_agent_message":null,"completed_at":1784171167,"duration_ms":40771}}
```

```json
{"timestamp":"2026-08-11T01:52:33.378Z","ordinal":26,"type":"event_msg","payload":{
 "type":"turn_aborted","turn_id":"019fee82-99b0-7772-b797-05aa8a264ec3",
 "reason":"interrupted","started_at":1786412964,"completed_at":1786413153,"duration_ms":189096}}
```

`task_complete` 另有字段：`root_turn_id`、`error`、`time_to_first_token_ms`、`started_at`、`last_agent_message`。
→ 这两条定义了**回合的起止与结局**，是切分回合、判定"助手是否给出最终答复"的权威依据。

### 2.14 `event_msg / thread_settings_applied`（1,152 条）

```json
{"type":"event_msg","payload":{"type":"thread_settings_applied","thread_id":"…",
 "thread_settings":{"model":"deepseek-v4-flash","model_provider_id":"DeepSeek","service_tier":"default",
  "approval_policy":"never","approvals_reviewer":"user","permission_profile":{…},
  "cwd":"D:\\…","reasoning_effort":"xhigh","reasoning_summary":"detailed","personality":"friendly",
  "collaboration_mode":{"mode":"default","settings":{"model":"deepseek-v4-flash",
   "reasoning_effort":"xhigh","developer_instructions":null}}}}}
```

→ 会话中途改设置（换模型/换审批策略）的记录。**丢弃**（或用于标注"此处模型切换"）。

### 2.15 多代理相关：`agent_message` / `inter_agent_communication_metadata`

```json
{"timestamp":"2026-09-07T09:58:07.060Z","ordinal":268,"type":"inter_agent_communication_metadata",
 "payload":{"trigger_turn":false}}
```

```json
{"type":"response_item","payload":{"type":"agent_message","id":"amsg_01a07b4d-bbd4-7911-b809-de1cbd5b9e85",
 "author":"/root/noop","recipient":"/root",
 "content":[{"type":"input_text","text":"Message Type: FINAL_ANSWER\nTask name: /root\nSender: /root/noop\nPayload:\nNo work was assigned."}]}}
```

→ 子代理**发给主代理**的消息。222 条，全部出现在 09-07 之后。
**不是用户输入**；映射为 `system`/工具结果类消息（降级处理）。

### 2.16 `response_item / web_search_call`、`tool_search_call` / `tool_search_output`

```json
{"type":"response_item","payload":{"type":"web_search_call","id":"call_00_u43fUDH3PisKEfPBUlSB1822",
 "status":"completed","action":{"type":"search","queries":["site:developers.openai.com codex SessionStart hook …"]}}}
```

```json
{"type":"response_item","payload":{"type":"tool_search_call","id":"tsc_0365bf…","call_id":"call_tfxmspt0OjRoAfjaWkpRBMr4",
 "status":"completed","execution":"client","arguments":{"query":"riderMcp 获取当前 Rider 打开的文件列表…"}}}
```

```json
{"type":"response_item","payload":{"type":"tool_search_output","id":"tso_01a037ee-…","call_id":"call_tfxmspt0OjRoAfjaWkpRBMr4",
 "status":"completed","execution":"client",
 "tools":[{"type":"namespace","name":"mcp__yzl_dashboard","description":"…","tools":[{…}]}]}}
```

→ `web_search_call` 是"搜索调用"，其结果**没有对应的 `*_output`**（结果只出现在
`item_completed` 的 `WebSearch` 或 `Extension` 里）——**这是唯一"有调用无 output"的工具类型，需特别处理**。
`tool_search_output` 返回的是**工具清单**（schema），**与业务无关，应丢弃**。

---

## 3. 文件关联模型：rollout / session_index / state_5 / thread_history

这是最容易踩坑的一节。实测数据如下：

### 3.1 命名与 id 的关系

```
rollout-<本地时间>-<UUID-A>[_<UUID-B>].jsonl
        │              │         └─ 续写/分片 rollout 自身的 id（仅 44 个文件有）
        │              └─ 线程 id：== payload.id，== state_5.threads.id，== thread_history_projection_state.thread_id
        └─ 本地时间（Asia/Shanghai），与 payload.timestamp（UTC）差 8 小时
```

| 关联项 | 实测匹配率 | 说明 |
|---|---:|---|
| 文件名 `UUID-A` == `payload.id` | **233 / 233** | 100% 成立 |
| 文件名 `UUID-A` == `payload.session_id` | **209 / 233** | 24 个不同（子代理 / 部分续写） |
| `payload.session_id` ∈ `state_5.threads.id` | **233 / 233** | 100% 成立 |
| `payload.session_id` ∈ `session_index.jsonl.id` | 192 / 233 | 索引只覆盖"用户可见"会话 |
| 文件名 `UUID-A` ∈ `thread_history_projection_state.thread_id` | **233 / 233** | 100% 成立 |
| `state_5.threads.rollout_path` 指向现存文件 | **189 / 189** | 无悬空指针 |

### 3.2 一个会话会摊到多个文件（会话链）

- **233 个文件 → 165 个不同 `session_id`**；**25 个 `session_id` 对应多个文件**。
- 两种成因：

  **(a) 子代理 rollout（24 个文件）**
  `session_id` = **父会话 id**（所以看起来"同一个会话有多个文件"），但 `payload.id` 是自己的线程 id。
  判定：`thread_source == "subagent"`，且 `parent_thread_id` / `source.subagent` 存在，
  `subagent_history_start_ordinal` = 继承父历史的截止序号。
  → **不应并入主线对话**（应作为"子代理活动"降级表示）。

  **(b) 续写 / 分片 rollout（44 个文件，文件名带 `_UUID-B`）**
  判定：`payload.history_base = {thread_id, end_ordinal_exclusive, end_byte_offset}` 存在。
  **实测 `history_base.end_ordinal_exclusive` 恰等于本文件首条记录的 `ordinal`**：

  | 文件 | `history_base.thread_id` | `end_ordinal_exclusive` | 本文件首个 `ordinal` |
  |---|---|---:|---:|
  | `…01a03bf7-7130-…jsonl` | `01a03bf5-d502-…` | 14 | **14** |
  | `…01a03bf7-92c5-…jsonl` | `01a03bf7-7130-…` | 16 | **16** |
  | `…_01a06021-25f5-…jsonl` | `01a05c1a-35e6-…` | 546 | **546** |

  → **`ordinal` 跨文件无缝衔接**，构成一条连续时间线。

- 另外 13 个文件带 `forked_from_id` + `forked_from_ordinal_exclusive`（真正的 fork/分支）。

### 3.3 `session_index.jsonl`（标题索引）

```json
{"id":"019fb79d-7431-7b32-a620-04af5b3193ec","thread_name":"计算 1+1","updated_at":"2026-07-31T09:59:40.9402791Z"}
```

- **`id` == `payload.session_id`**（不是文件名 UUID）→ 用它 join 到 rollout。
- **`thread_name` 就是会话标题**（与 `state_5.threads.title` 语义相同，实测 41 个完全相同，
  其余差异来自 `title` 被后续改名/截断）。
- **是 append-only 且允许重复**：135 行 → **124 个不同 id（11 个重复）**。**取最后一条为准。**
- 覆盖不全（只 124 个 id，而 threads 表 189 行）。

### 3.4 `state_5.sqlite.threads`（会话目录，真正的"索引"）

```sql
CREATE TABLE threads (
  id TEXT PRIMARY KEY,          -- == rollout payload.id（线程 id）
  rollout_path TEXT NOT NULL,   -- ⭐ 指向该会话"当前"rollout 文件的绝对路径
  created_at INTEGER, updated_at INTEGER,
  source TEXT, model_provider TEXT, cwd TEXT, title TEXT,   -- title == 会话标题
  sandbox_policy TEXT, approval_mode TEXT, tokens_used INTEGER,
  archived INTEGER NOT NULL DEFAULT 0, archived_at INTEGER,
  cli_version TEXT, first_user_message TEXT, preview TEXT,
  model TEXT, reasoning_effort TEXT, thread_source TEXT,
  agent_path TEXT, agent_nickname TEXT, agent_role TEXT, name TEXT, is_pinned INTEGER,
  history_mode TEXT, git_sha TEXT, git_branch TEXT, git_origin_url TEXT, project_id TEXT, …)
```

实测 **189 行**；其中 `archived = 1` 的有 **75 行**，且这 75 行的 `rollout_path` **全部**指向
`archived_sessions\`（无例外）。样例：

```json
{"id":"019e8631-2fb6-7b83-a04f-03753e627bc7",
 "rollout_path":"C:\\Users\\Administrator\\.codex\\archived_sessions\\rollout-2026-06-02T10-37-10-019e8631-….jsonl",
 "title":"你好","first_user_message":"你好","source":"cli","model_provider":"custom",
 "cli_version":"0.136.0","model":"deepseek-v4-flash","reasoning_effort":"low",
 "archived":1,"archived_at":1785987735,"history_mode":"paginated","thread_source":"user"}
```

**这是最实用的"入口点"**：`threads` 表提供了 `id → rollout_path → title` 的完整映射，
可直接当作"待导入会话清单"，无需自己遍历目录 / 解析 438MB JSONL。

### 3.5 `thread_history_1.sqlite`（rollout 的派生投影，**不是主存**）

表结构（实测 `sqlite_master`）：

```sql
-- ① 投影进度游标：每行 = 一个 rollout 文件
CREATE TABLE thread_history_projection_state (
  thread_id TEXT PRIMARY KEY,            -- == rollout 文件名 UUID-A
  next_rollout_byte_offset INTEGER NOT NULL,  -- ⭐ 已消费到的字节偏移
  next_rollout_ordinal     INTEGER NOT NULL   -- ⭐ 已消费的记录条数
);
-- ② 物品表：rollout 里 item_completed 的规范化副本
CREATE TABLE thread_items (
  thread_id TEXT, turn_id TEXT, item_id TEXT,
  rollout_ordinal INTEGER NOT NULL, created_at_ms INTEGER NOT NULL,
  item_json TEXT NOT NULL,          -- ⭐ 注意：camelCase（userMessage/clientId），与 rollout 的 PascalCase 不同
  item_type TEXT NOT NULL, updated_at_ordinal INTEGER NOT NULL,
  started_at_ms INTEGER, completed_at_ms INTEGER,
  PRIMARY KEY (thread_id, turn_id, item_id)
);
-- ③ 回合表
CREATE TABLE thread_turns (
  thread_id TEXT, turn_id TEXT, rollout_ordinal INTEGER, status TEXT,
  error_json TEXT, started_at INTEGER, completed_at INTEGER, duration_ms INTEGER,
  first_user_item_id TEXT, final_agent_item_id TEXT,
  rollout_byte_offset INTEGER, rollout_end_ordinal INTEGER, rollout_end_byte_offset INTEGER,
  root_turn_id TEXT, PRIMARY KEY (thread_id, turn_id)
);
-- ④ 实时物品（当前 0 行）
CREATE TABLE thread_realtime_items (thread_id, item_id, rollout_ordinal, created_at_ms, item_type, item_json, …);
-- ⑤ sqlx 迁移记录
CREATE TABLE _sqlx_migrations (version, description, installed_on, success, checksum, execution_time);
```

实测行数：`thread_history_projection_state` **233 行**（233 个不同 thread_id）、
`thread_items` **31,013 行 / 222 线程**、`thread_turns` **1,086 行 / 224 线程 / 1,070 回合**、
`thread_realtime_items` **0 行**。

迁移说明（`_sqlx_migrations`）：v1 = `thread history`（2026-08-11 安装），v2 = `thread items item type`。

#### ⭐ 决定性证据：它是 rollout 的投影

对线程 `019fefe1-0df3-7280-998c-69281eccb44d`（文件
`archived_sessions\rollout-2026-08-11T16-12-11-019fefe1-….jsonl`，**disk 大小 59,634 B，共 14 条记录**）：

```json
{"thread_id":"019fefe1-0df3-7280-998c-69281eccb44d",
 "next_rollout_byte_offset":59634,   // == 文件字节数
 "next_rollout_ordinal":14}          // == 文件记录条数
```

并且把该文件按字节读出来验证：偏移 59,634 处正好是**文件末尾**（`bytesAfterOffset` 为空串），
偏移前 120 字节恰是最后一条 `task_complete` 的 JSON 尾部。

→ **`next_rollout_byte_offset` / `next_rollout_ordinal` 是精确的文件字节游标**，
sqlite 只是"读到哪了"的书签 + 规范化副本。**rollout 才是真相来源。**

#### 投影与 rollout 的差异（说明它是**有损/规范化**的副本）

| 维度 | rollout | `thread_items` |
|---|---|---|
| 键风格 | PascalCase（`userMessage`—实为 `UserMessage`） | camelCase（`userMessage`、`clientId`） |
| 覆盖 | 233 文件 | 222 线程（少 11） |
| 数量 | 31,564 条 `item_completed` | 31,013 行 |
| 类型集合 | `Extension` 132、`WebSearch` 51 | 归一为 `webSearch` 176 |
| 独有类型 | — | `sleep` 7、`dynamicToolCall` 2（由 function_call 名派生，rollout 的 `item_completed` 里没有 `sleep`） |
| 内容 | `message`（压缩摘要）等 79 条 | **无 compacted / world_state / turn_context / token_usage** |

**结论：新版本 Codex 没有把会话主存换成 sqlite。**
证据链是完整的：
1. rollout 文件仍在写入（最新 `2026-10-14`，且 `state_5` 最后更新 `2026-10-14 12:29`）；
2. `thread_history_projection_state` 的游标**精确等于 rollout 文件字节数/记录数**（说明它是**消费** rollout 的一方）；
3. `thread_items` 的行数/类型相对 rollout **更少**（31,013 < 31,564+），且缺 `compacted`/`world_state`/`turn_context`；
4. `state_5.threads.rollout_path` 是**外键式指向 JSONL 文件路径**——目录项指向文件，而非取代文件；
5. `rollout_migration_state` 的 `migration_id = "legacy_to_paginated_v1"` 是**分页存储层迁移**
   （配合 `history_mode:"paginated"`、`history_base`、`rollout-migrations\` 空目录），**不是"迁移到 sqlite"**。

**实践建议**：导入器**只读 rollout JSONL**；sqlite 仅用于两件事——
(a) 用 `threads` 表枚举会话 + 拿标题 + 判断是否归档；
(b) 用 `thread_turns.status` 快速判断某回合是 `completed` / `interrupted` / `failed` / `inProgress`（实测 882/145/53/6）。

---

## 4. 如何还原出线性对话

### 4.1 总体流程

```
① 枚举会话       state_5.sqlite → threads(id, rollout_path, title, archived)
                 （或遍历 sessions/ + archived_sessions/ 自行解析 session_meta）
② 组装会话链     对目标 session_id，收集所有 rollout 文件；
                 用 history_base.thread_id → 前驱文件 串成链；
                 排除 thread_source=="subagent"（另作降级处理）
③ 排序          主键 (文件在链中的序号, ordinal)；⚠️ 不要用 timestamp 排序（同毫秒会抖）
④ 逐条映射      按 §5 的映射表把记录转成通用消息
⑤ 回合切分      task_started→task_complete/turn_aborted 之间为一个 turn（turn_id 相同）
⑥ 去重          call_id 去重工具调用；id 去重 reasoning/消息；丢弃 replacement_history 重复项
⑦ 过滤注入      按 §4.4 的规则剔除 system/developer/环境注入
```

### 4.2 实测样例：一个 14 条记录的完整会话（`019fefe1-…`）

按 `ordinal` 顺序，**这就是一个可完整还原的最小会话**：

| ord | 记录 | 内容（截断） |
|---:|---|---|
| 0 | `session_meta` | `session_id=019fefe1-…` `cwd=I:\…\YunLiu` `cli=0.147.0` `base_instructions` 117 字符 |
| 1 | `event_msg/task_started` | `turn_id=019fefe1-4635-…` `started_at=1786435946` |
| 2 | `message/developer` | `<skills_instructions> ## Skills …`（**注入，丢弃**） |
| 3 | `message/user` | `# AGENTS.md instructions for I:\…\YunLiu <INSTRUCTIONS> …`（**注入，丢弃**） |
| 4 | `world_state` | `full=true`，14 个 state 键（**丢弃**） |
| 5 | `turn_context` | `model=deepseek-v4-flash` `effort=high` `summary=auto` `tz=Asia/Shanghai`（**丢弃**） |
| 6 | `message/user` | **`ping`** ← ✅ **真实用户输入** |
| 7 | `item_completed/UserMessage` | `id=019fefe1-5038-…` `text=ping`（与 ord 6 重复） |
| 8 | `item_completed/Reasoning` | `raw_content=["The user just said \"ping\". …"]` |
| 9 | `reasoning` | `content=[{reasoning_text:"The user just said \"ping\". …"}]` `encrypted_content=null`（与 ord 8 重复） |
| 10 | `item_completed/AgentMessage` | `phase=final_answer` `text=pong ✅ Working directory …` |
| 11 | `message/assistant` | `phase=final_answer` `pong ✅ Working directory …`（与 ord 10 重复） |
| 12 | `event_msg/token_count` | `total=17207`（**丢弃**） |
| 13 | `event_msg/task_complete` | `dur=25973` `ttft=24217` |

**还原结果**：`user: "ping"` → `assistant: "pong ✅ Working directory …"`，且带 `turn_id` 与
`started_at/completed_at` 时间戳。**16 条原始记录 → 2 条对话消息**，其余全是注入/重复/计量。

### 4.3 去重规则（必须）

实测的重复有三类：

**(a) `response_item` × `item_completed` 双写**
同一内容写两遍。配对率实测 43.9%（`item_completed` 侧），工具类另有 `call_id` 关联（39.5%）。
→ **规则**：以 `response_item` 为唯一正文来源；
`item_completed` **只在"`response_item` 缺失对应信息"时**用作补充，具体是：
`CommandExecution`（补充 `stdout`/`stderr`/`exit_code`/`parsed_cmd`/`cwd`，比 `function_call_output` 全）、
`McpToolCall`（补充 `server`/`tool`/结构化 `result`）、
`FileChange`（**唯一带 `unified_diff` 的来源**）、
`WebSearch` / `Extension`（`web_search_call` 没有 output，结果只在这里）、
`ImageView`、`SubAgentActivity`、`CollabToolCall`。

**(b) `compacted.replacement_history` 与既有 message 重复**
实测 79 条，每条的 `replacement_history` 都是**累积快照**（长度随 `window_number` 单调增长）。
→ **规则**：
- 默认**完全不读** `replacement_history`（正文已由前序 `response_item` 覆盖）；
- 若要还原"模型当时真实可见的上下文"，则**以该 `compacted` 为分界线**：
  取**最后一个** `compacted`（`window_number` 最大）的 `replacement_history` 作为"已知历史"，
  丢弃在此之前的所有记录，只保留其后的记录——等价于模型侧的上下文重建。
- **绝不允许**把 `replacement_history` 与文件前部的记录一并输出。

**(c) 用户消息在多个回合重复出现**
实测样例文件 `019f68e2-…` 中，同一句 `你当前环境是什么？ps还是wsl` 在 `ordinal=5`（turn 1）
与 `ordinal=11`（turn 2，换模型后重发）各出现一次。
→ **规则**：若相同 `text` 且相同 `turn_id` 的 `UserMessage` 已存在则跳过；
跨 turn 的重复**应保留**（它确实是两次用户发送），但可加注 `"（重发）"` 或按"连续相同文本折叠"策略处理。

**(d) 工具调用的乱序与批量**
实测一个 turn 内 4 个 `function_call` 连排，其 4 个 `*_output` 随后连排（非交替）。
→ **规则**：用 `call_id` 建 `Map`，先收 call 再回填 output；
**结果顺序取 `*_output` 的 `ordinal`**（不是 call 的顺序）。
遗留的 8 个无 output 的 `call_id`（中断导致）应输出为 `tool_result = "(被中断，无结果)"`。

### 4.4 如何区分"真实用户输入"与系统/developer 注入 ⭐

**这是导入质量的关键。** 实测分类结果（`response_item/message` 且 `role=user` 的 **2,783 个
`input_text` 片段**，另有 49 个 `input_image`）：

| 类别 | 片段数 | 首行特征（正则锚点） |
|---|---:|---|
| ✅ **真实用户文本** | **2,114（76.0%）** | 不以 `<` 开头、不匹配下列任何模式 |
| ❌ `environment_context` 环境注入 | 265 | `^<environment_context>` |
| ❌ **AGENTS.md 项目指令** | 193 | `^#\s*AGENTS\.md instructions for` |
| ❌ `<turn_aborted>` 中断提示 | 90 | `^<turn_aborted>` |
| ❌ `<image name=…>` 图片占位 | 49 | `^<image name=` |
| ❌ `</image>` 收尾标签 | 49 | `^</image>` |
| ❌ `send_user_message_question_reply` | 7 | `^<send_user_message_question_reply>` |
| ❌ guardian 评审提示 | 6 | `^The following is the Codex agent history whose request action` |
| ❌ 子代理转录 | 6 | `^>>> TRANSCRIPT START` |
| ❌ `hook_prompt` | 4 | `^<hook_prompt` |

**另外两种只在 `role=developer` 里出现的注入**（`developer` 的 1,600 个片段）：
`<permissions instructions>`、`<collaboration_mode>`、`<skills_instructions>`、`<model_switch>`、
`<multi_agent_mode>`、`<turn_aborted>`、`On Windows, prefer the OMO git_bash MCP…`、
`AgentWorkspace health=degraded…`、`Warning: truncated output…` 等。

**推荐判定算法（实测可用，准确率 100% 于本机数据）**：

```
真实用户输入  ⟺  同时满足：
  (1) 记录类型是 event_msg/item_completed 且 item.type == "UserMessage"
      —— 实测 1,150 条中，1,137 条首段是真实文本，7 条是工具问答回复，6 条是 guardian 提示；
  (2) 且 该 item 的首个 content[].text 不匹配任何注入模式（上图正则表）；
  (3) 交叉验证：同 turn_id 内存在 response_item/message(role=user) 且文本一致。

辅助信号（用于补漏 / 校验）：
  - 该 session_id 是否出现在 history.jsonl（用户手动输入历史）中，且文本一致 → 强证据；
  - state_5.threads.first_user_message 应等于该会话第一条真实用户文本 → 强证据；
  - world_state.agents_md.text / .directory → 用于识别并剔除 AGENTS.md 注入；
  - 图片消息：input_image 片段 + 相邻的 `<image name=…>`/`</image>` 文本占位应合并成一条
    "含 1 张图片"的消息，而非三条。
```

**结论**：`response_item/message` 的 `role=user` **绝不可直接当作用户输入**（会漏掉 24% 的注入污染）；
**必须以 `item_completed` 的 `UserMessage` 为主信号**，再用正则 + 交叉验证清洗。

### 4.5 回合切分与时间戳

- **回合**：`turn_id` 相同的一组记录。起于 `event_msg/task_started{turn_id, started_at}`，
  止于 `event_msg/task_complete{turn_id, completed_at, duration_ms, error}` 或
  `event_msg/turn_aborted{turn_id, reason, duration_ms}`。
  实测回合结局：`completed` 882 / `interrupted` 145 / `failed` 53 / `inProgress` 6（来自 sqlite `thread_turns`）。
- **时间戳**：
  - 记录级 `timestamp`：ISO-8601 UTC 带毫秒，**每条都有**（实测 104,367 条全部有 `timestamp`，
    覆盖 `2026-06-02T02:37:22Z` → `2026-10-14T07:22:12Z`）→ **映射为消息时间戳的首选**。
  - `task_started.started_at` / `task_complete.completed_at`：**Unix 秒**（不是毫秒）。
  - `item_completed.started_at_ms` / `completed_at_ms`：**epoch 毫秒**（工具耗时的细粒度来源）。
  - `internal_chat_message_metadata_passthrough.create_time`：**Unix 秒带小数**。
  - ⚠️ 三种单位混用，转换时务必分别处理。
- ⚠️ **不要用 `timestamp` 作为唯一排序键**：同一毫秒内可有多条记录（实测 `ordinal` 在意）。
  **排序键应为 `(链内文件序号, ordinal)`。**

---

## 5. 转换映射表：Codex 记录 → 通用对话消息

通用消息模型（对齐 DSH 侧需求）：
`{ role, text, tool_call:{id,name,args}, tool_result:{call_id,name,content}, timestamp, meta }`。

| # | Codex 记录 | 判据 | → 通用消息 | 处理策略 |
|---:|---|---|---|---|
| 1 | `session_meta` | 每文件首条 | **不产生消息**；产出会话头 `{session_id, thread_id, cwd, model, cli_version, git, created_at}` | **保留为元数据** |
| 2 | `event_msg/task_started` | `turn_id` 存在 | **不产生消息**；产出 `turn` 边界 + `started_at` | 保留为回合元数据 |
| 3 | `event_msg/task_complete` | 同上 | **不产生消息**；产出 `turn.status=completed`、`duration_ms`、`last_agent_message` | 保留；`error` 非空时标注 |
| 4 | `event_msg/turn_aborted` | `reason` | **不产生消息**；产出 `turn.status=interrupted` | 可选产出一条 system 提示"（本回合被用户中断）" |
| 5 | `response_item/message` `role=assistant` | — | `role: assistant`, `text: content[].text` | ✅ **正文保留**；`phase` 入 meta（`final_answer` 为最终答复，`commentary` 为过程性发言） |
| 6 | `response_item/message` `role=user` 且**首段非注入** | §4.4 算法 | `role: user`, `text` | ✅ **正文保留**；`input_image` 片段转 `{type:image, path}` |
| 7 | `response_item/message` `role=user` 且**匹配注入模式** | §4.4 正则表 | — | ❌ **丢弃**（AGENTS.md / environment_context / turn_aborted / TRANSCRIPT / compaction 摘要 / image 占位） |
| 8 | `response_item/message` `role=developer` | 全部 | 最多降级为 `role: system`，且**默认丢弃** | ❌ **丢弃**（`<permissions instructions>`、`<skills_instructions>`、`<collaboration_mode>`、`<model_switch>`…） |
| 9 | `event_msg/item_completed` `item.type=UserMessage` | — | `role: user` | ⭐ **真实用户输入的主信号**；与 #6 去重（同 turn_id 同文本取一）；图片合并 |
| 10 | `event_msg/item_completed` `item.type=AgentMessage` | — | `role: assistant`, `text: content[].text` | ⭐ **助手回复的主信号**；与 #5 去重（同 id / 同文本取一） |
| 11 | `response_item/function_call` | `name`,`arguments`(JSON 串) | `tool_call{id: call_id, name, args: JSON.parse(arguments)}` | ✅ **保留**；`arguments` 解析失败则原样存字符串 |
| 12 | `response_item/function_call_output` | `call_id` | `tool_result{call_id, content: output}` | ✅ **保留**；`output` 是纯字符串，可能极长 → **按阈值截断**（建议 8–16 KB） |
| 13 | `response_item/custom_tool_call` | `name`,`input`(原始串) | `tool_call{id: call_id, name, args: {raw: input}}` | ✅ **保留**；`input` **不是 JSON**（`exec` 是 JS 片段、`apply_patch` 是 patch），**不要 parse** |
| 14 | `response_item/custom_tool_call_output` | `call_id` | `tool_result{call_id, content: output}` | ✅ **保留**；同样截断 |
| 15 | `response_item/reasoning` | `encrypted_content` 为字符串（**11,429 条 / 89.9%**） | — | ❌ **必须丢弃**（不可解密） |
| 16 | `response_item/reasoning` | 有 `content[].reasoning_text`（**2,944 条 / 23.1%**） | `role: assistant`（`meta.subtype="reasoning"`）或单独"思考"块 | ⚠️ **降级保留**：仅在用户选择"含思考过程"时输出；**默认丢弃**；不要与 #17 的 `Reasoning` item 重复 |
| 17 | `event_msg/item_completed` `item.type=Reasoning` | — | 同 #16 | ⚠️ 与 #16 去重（二者常同 id） |
| 18 | `event_msg/item_completed` `item.type=CommandExecution` | — | `tool_result`（增强） | ⚠️ **有选择保留**：当 #12 的 `output` 为空或含 error 时，用此处的 `aggregated_output`/`stdout`/`stderr`/`exit_code` 补齐；**信息比 #12 全** |
| 19 | `event_msg/item_completed` `item.type=McpToolCall` | — | `tool_result`（增强） | ⚠️ 同上；`server`/`tool`/`result.content[].text` 是 `arguments` 的结构化对端 |
| 20 | `event_msg/item_completed` `item.type=FileChange` | — | `tool_result`（**唯一 diff 来源**） | ⚠️ **降级保留**：`changes[path].unified_diff` 是**业务代码 diff** → **默认只保留"改了哪几个文件 + 增删行数"，丢弃 diff 正文** |
| 21 | `event_msg/item_completed` `item.type=WebSearch` / `Extension` | — | `tool_result` | ⚠️ 降级：只保留 `query` + 命中条数/首条标题 URL |
| 22 | `response_item/web_search_call` | — | `tool_call{name:"web_search"}` | ✅ 保留调用；⚠️ **无对应 output**，结果见 #21 |
| 23 | `response_item/tool_search_call` / `tool_search_output` | — | — | ❌ **丢弃**（返回的是工具 schema 清单，非业务内容） |
| 24 | `response_item/agent_message` | `author`,`recipient` | `role: assistant` + `meta.subtype="agent_message"`，或 `role: system` | ⚠️ 降级；**不是用户输入**；默认折叠为"（子代理回报）" |
| 25 | `inter_agent_communication_metadata` | `trigger_turn` | — | ❌ **丢弃** |
| 26 | `event_msg/item_completed` `item.type=SubAgentActivity` / `CollabAgentToolCall` | — | `meta` 标注 | ⚠️ 降级为"（子代理 xxx 启动/等待）"一行；**不展开子代理全文**（其内容在独立 rollout 文件里） |
| 27 | `event_msg/item_completed` `item.type=ImageView` | `path` | 图片附件 | ⚠️ 降级：路径可能已失效 → 只保留文件名 |
| 28 | `event_msg/item_completed` `item.type=HookPrompt` | `fragments[]` | `role: system` 或丢弃 | ❌ 默认丢弃（hook 注入） |
| 29 | `event_msg/item_completed` `item.type=ContextCompaction` | — | **不产生消息** | 保留为分界标记 |
| 30 | `compacted` | `message`,`replacement_history` | — | ❌ **默认丢弃**（内容与前序记录重复）；仅"忠实上下文重建"模式下按 §4.3(b) 使用 |
| 31 | `event_msg/token_count` | — | — | ❌ **丢弃**（计量） |
| 32 | `token_usage_record` | — | — | ❌ **丢弃**（计量） |
| 33 | `event_msg/thread_settings_applied` | — | — | ❌ 丢弃；可在原消息上加 `meta.model` 标注 |
| 34 | `turn_context` | — | — | ❌ 丢弃；用于给本回合消息补 `meta.model` / `meta.cwd` / `meta.effort` |
| 35 | `world_state` | `agents_md` 等 | — | ❌ **必须丢弃**（含 AGENTS.md 全文 ~9.6KB，塞进去会污染对话） |
| 36 | 任何未知 `type` / `payload.type` | 白名单外 | — | ⚠️ **优雅跳过**：计数 + 记一条 debug 日志（含 `type`、`ordinal`），**绝不抛异常中断整文件** |

### 5.1 关于"丢弃 / 降级 / 保留"的三档原则

| 档位 | 内容 | 理由 |
|---|---|---|
| ✅ **必须保留** | `message/assistant`、真实 `UserMessage`、`function_call` + `function_call_output`、`custom_tool_call` + `custom_tool_call_output`、`turn_id`/`timestamp` | 这是对话本体 |
| ⚠️ **保留但降级** | 明文 `reasoning`（默认关）、`CommandExecution`/`McpToolCall` 增强结果、`FileChange` 的**文件名列表**、`WebSearch` 的 query、子代理活动一行摘要 | 信息有价值但体积/隐私风险高，需**截断 + 开关** |
| ❌ **必须丢弃** | `base_instructions`、`world_state`、所有 `developer` 注入、加密 `reasoning.encrypted_content`、`token_count`/`token_usage_record`、`thread_settings_applied`、`tool_search_output`、`compacted.replacement_history`（默认） | 与对话无关，或体积巨大，或不可读 |

### 5.2 体积预算（实测，直接决定导入是否可行）

| 项 | 量级 | 备注 |
|---|---:|---|
| 全量 rollout | **530 MB / 104,367 条** | 最大单文件 **43.7 MB**（`rollout-2026-09-02T11-19-40-…_01a06021-…jsonl`） |
| `item_completed` 条数 | 31,564 | 若与 `response_item` 双收 → **正文翻倍** |
| `reasoning` | 12,715 条（占 `response_item` 的 27.2%） | 其中 11,429 条为加密串（丢弃后仅 2,944 条可能含明文） |
| `world_state` | 429 条 × 平均 ~10 KB | 丢弃可省 ~4 MB |
| `tool_search_output` | 87 条，含完整工具 schema | 丢弃可省大量 token |
| 单文件 top 6 | **43.7 MB、29.2 MB、21.1 MB、21.1 MB、17.9 MB、16.4 MB** | 分布：<100 KB 71 个；100 KB–1 MB 79 个；1–10 MB 71 个；**≥10 MB 12 个** |

---

## 6. `archived_sessions\` 与 `history.jsonl`

### 6.1 `archived_sessions\`

- **用途**：DSH 侧"归档"功能对应的存储位置。归档时 Codex **把 rollout 文件整体移动到该目录**
  （实测 `state_5.threads.rollout_path` 指向 `archived_sessions\` 的 **75 行全部** `archived = 1`，
  无一行 `archived = 0`；反向也成立 → **归档标记与目录位置完全一致**）。
- **内容格式**：与 `sessions\` **完全相同**的 rollout JSONL（文件名规则一致），
  只是**扁平存放**（无 `YYYY\MM\DD\` 子目录），实测 **89 个文件 / 13,950 条记录 / 87 MB**。
- 89 个文件 vs 75 个归档线程：**89 个文件的文件名 UUID 全部命中 `archived = 1` 的线程行**，
  无一处命中 `archived = 0`，也无一处落在 `threads` 表外。
  即**一个归档会话可以拥有多个 rollout 文件，而 `threads.rollout_path` 只指向其中最新的那一个**
  （实测只有 75 行 `rollout_path` 指向 `archived_sessions\`，但该目录有 89 个文件）。
- `state_5.threads.archived_at` 记录归档时间（epoch 秒）。

### 6.2 `history.jsonl`

- **用途**：**用户手动输入过的提示词历史**（CLI 的 "上箭头" 历史），与对话无关。
- 格式：`{"session_id":"…","ts":1780367842,"text":"你好"}` —— 每行一个用户提示。
- 实测 **72 行**、12,755 B；`ts` 是 epoch 秒；`session_id` 可 join 回 rollout。
- **价值**：可作为"哪些文本确实是用户手输"的**强证据**（§4.4 辅助信号），
  以及"用户最常用提示词"分析。
- 注意：它**只记录用户输入**，不含助手回复，且**不是全量**（只 72 条，远少于 1,137 条真实用户消息）。

---

## 7. 风险与陷阱清单

| # | 陷阱 | 实测证据 | 对策 |
|---:|---|---|---|
| 1 | 把 `role=user` 全当用户输入 | 2,783 片段中 669 个是注入（24%） | 用 `item_completed/UserMessage` + 正则清洗（§4.4） |
| 2 | 双收 `response_item` 与 `item_completed` | 31,564 vs 46,717；id 共享仅 43.9% | 以 `response_item` 为准（§4.3a） |
| 3 | 拼入 `compacted.replacement_history` | 累积快照，最大 65 条，与前序重复 | 默认不读；或按窗口重建（§4.3b） |
| 4 | 想解密 `reasoning.encrypted_content` | 9,861 条加密串 | 直接丢弃 |
| 5 | 只支持 `function_call` 或不只 `custom_tool_call` | 7,620 vs 6,032，跨版本并存 | 两套都实现 |
| 6 | 对 `custom_tool_call.input` 做 `JSON.parse` | `exec` 是 JS 片段、`apply_patch` 是 patch | 当原始字符串存 |
| 7 | 用 `timestamp` 排序 | 同毫秒多条 | 用 `(链序, ordinal)` |
| 8 | 混淆秒/毫秒时间戳 | `started_at` 秒、`started_at_ms` 毫秒、`create_time` 秒带小数 | 分字段处理 |
| 9 | 把子代理 rollout 并入主线 | 24 个 `thread_source=subagent` 文件共享父 `session_id` | 按 `thread_source` 过滤 |
| 10 | 漏掉续写文件导致对话截断 | 44 个文件带 `history_base`，`ordinal` 接续 | 沿 `history_base.thread_id` 串链 |
| 11 | 整文件 `JSON.parse` | 最大单文件 43.7 MB | 流式逐行 |
| 12 | 把 `world_state`/`base_instructions` 当消息 | 单条 ~9.6 KB / ~21 KB | 丢弃 |
| 13 | 未知类型导致中断 | 跨 0.128→0.155 共 22 种组合 | 白名单 + 优雅跳过 + 计数 |
| 14 | `web_search_call` 找不到 output 就报错 | 51 条无 output | 结果是 `WebSearch`/`Extension` item |
| 15 | 忘记图片三件套 | `<image name=…>` + `input_image` + `</image>` | 合并为一条 |
| 16 | 隐私：`FileChange` 带业务 diff、`output` 带源码 | 1,229 条 FileChange | 默认丢弃 diff 正文，只留文件名/统计 |

---

## 8. 可复用结论（一页速查）

1. **权威来源**：`sessions\YYYY\MM\DD\rollout-*.jsonl` + `archived_sessions\*.jsonl`。sqlite 是投影，不是主存。
2. **入口**：`state_5.sqlite` → `threads(id, rollout_path, title, archived, first_user_message, cli_version, model, reasoning_effort)`，
   189 行，`rollout_path` 100% 有效 → 直接当"待导入清单"。
3. **顺序键**：`ordinal`（文件内 0 基、单调、无跳号；跨续写文件连续）。**不要用 timestamp 排序。**
4. **会话链**：同 `session_id` 可对应多文件；沿 `history_base.thread_id` 上溯串链；
   `thread_source=="subagent"` 的文件是子代理，不入主线。
5. **正文**：`response_item/message(assistant)` 与 `event_msg/item_completed(AgentMessage)` 二选一（推荐前者）。
6. **用户输入**：**只认 `item_completed` 的 `UserMessage`**，再用注入正则清洗；`history.jsonl` 与
   `threads.first_user_message` 做交叉验证。
7. **工具**：新旧两套（`function_call`/`custom_tool_call`），靠 `call_id` 配对；结果可能批量后置；
   `web_search_call` 无 output；`custom_tool_call.input` 不是 JSON。
8. **注入白名单（必须丢弃）**：`base_instructions`、`world_state`、`role=developer` 全部、
   `^# AGENTS.md instructions for`、`^<environment_context>`、`^<turn_aborted>`、`^>>> TRANSCRIPT START`、
   `^The following is the Codex agent history`、`^Another language model started to solve this problem`、
   `^<hook_prompt`、`^<send_user_message_question_reply>`、`^<image name=`/`^</image>`。
9. **推理**：`encrypted_content` 为字符串的 **11,429 条（89.9%）必须丢弃**（不可解密）；
   带明文 `reasoning_text` 的仅 2,944 条（23.1%），默认也丢。
10. **计量类全丢**：`token_count`、`token_usage_record`、`thread_settings_applied`、`turn_context`、
    `tool_search_output`、`inter_agent_communication_metadata`。
11. **未知类型优雅跳过**：统计 + debug 日志，不中断。
12. **流式处理**：最大单文件 43.7 MB，全量 530 MB，必须逐行读、边读边转边释放。

---

## 附：本次调研使用的方法与可复现命令

所有脚本与中间产物位于 `C:\Users\Administrator\AppData\Local\Temp\codex-research\`（只读副本 + 统计脚本），
`.codex` 目录**未被写入**：

| 脚本 | 作用 |
|---|---|
| `census.mjs` → `census.json` | 233 文件流式统计：顶层 `type`、`type/payload.type`、字段集合、时间范围、样本 |
| `subcensus.mjs` → `subcensus.json` | `item_completed.item.type` 分布、`ordinal` 连续性、role/phase/content 分布、reasoning 形态、工具名分布 |
| `correlate.mjs` / `corr2.mjs` → `correlation.json` / `corr2.json` | rollout ↔ session_index ↔ `threads` ↔ 投影 的 id 关联；用户消息注入分类 |
| `proj-proof.mjs` → `proj-proof.json` | **证明** `next_rollout_byte_offset` == 文件字节数、`next_rollout_ordinal` == 记录条数 |
| `pairing.mjs` / `dedup.mjs` / `tooljoin.mjs` | `response_item` × `item_completed` 双写与 `call_id` 配对率 |
| `compacted.mjs` → `compacted.json` | `compacted` 窗口序列与 `replacement_history` 累积性 |
| `chains.mjs` → `chains.json` | 会话链、`history_base`、`thread_source`、`source` 分布 |
| `dump.mjs` | 按 `ordinal` 顺序打印单文件的可读转录（本文 §4.2 即由它生成） |
| `sqlite-inspect.mjs` → `sqlite-inspect.json` | 4 个 sqlite 副本的 `.schema` + 行数 + 样本（只读打开） |

复现要点：
- 用 `node:sqlite` 的 `new DatabaseSync(path, { readOnly: true })` **只读打开副本**；
- 复制 sqlite 前若目标有 `-wal`，**同目录一起复制**否则会读到旧快照（本次为排除干扰，仅复制主库文件，
  并在报告中注明了 WAL 存在这一事实）；
- JSONL 一律 `readline.createInterface({ input: fs.createReadStream(f, { encoding: 'utf8' }) })` 流式读取。