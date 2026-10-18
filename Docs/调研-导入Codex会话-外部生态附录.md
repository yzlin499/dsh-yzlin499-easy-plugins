# 外部资料调研：把 Codex 会话导入 DSH（DeepSeek Harness）

> 调研方式：公开 web 搜索 + 官方文档/仓库 README 抓取。
> 所有外部内容按**不可信数据**处理，只提取事实并保留可引用 URL。
> 标注约定：**【官方】**＝厂商文档/源码；**【社区】**＝第三方工具或文章；**【未找到公开证据】**＝本次检索无结果，不推测。

**TL;DR**：这个需求**已经被多个 DSH 社区插件实现过**，其中 `tzwkb/dsh-codex-import` 与目标几乎 1:1 重合，并且把 Codex rollout 与 DSH 会话格式的契约都反推清楚了。外部生态给出的最佳实践是**直接转换落盘文件**（写成 DSH 原生 session v3 zstd 日志），**不走 ACP 协议导入**；ACP 的正确用途是**验收**（证明导入后的会话能被 list/resume/prompt）。

---

## 0. 最重要的发现：DSH 侧已有先例（会直接影响方案选择）

| 项目 | 定位 | 关键做法 |
|---|---|---|
| [tzwkb/dsh-codex-import](https://github.com/tzwkb/dsh-codex-import) | **Codex CLI/Desktop → DSH** 专用插件（MIT） | `/import-codex` 斜杠命令；把 rollout 转成 DSH session v3 log；默认只导入**最后一个 `compacted` 之后的窗口**；图片走 attachment store；孤儿 tool call 双向修复；digest + 帧数判定增量 refresh；强制 rollback manifest；`--dry-run/--force/--audit` |
| [Nwflower/dsh-chat-import](https://github.com/Nwflower/dsh-chat-import) | 通用导入插件，**25+ agent**（Codex / Claude Code / ChatGPT / Cursor / Cline / Zed / Qwen / Kimi…） | 已发 npm `dsh-chat-import`；GUI 侧栏导入面板 + `import_chat()` 工具调用；"Import from file" 三级格式探测；反向导出；对外暴露 `chatImport` host service 供第三方插件复用 |
| [NB4747/dsh-session-sync](https://github.com/NB4747/dsh-session-sync) | Codex / Claude Code → DSH，**含实时 watch 与双向 push** | `/sync codex`、`/sync watch`、`/sync push <sessionId>`（把 DSH 新增轮次回写 Codex rollout）；写入走 DSH 官方 `SessionPersistence` 接口 |
| [ayst-z/dsh-history-migration](https://github.com/ayst-z/dsh-history-migration) | VS Code Copilot Chat / MiMo / opencode → DSH（**不含 Codex**） | 抽出 DSH 会话格式**「9 条硬性要求」**（首帧只放 header、seq 连续、`assistant/message` 必须带 `stream`、必须有投影缓存、`agentPreset` 需在 profile 组装范围内…），并强调"格式通过 ≠ 能续聊" |

**结论**：这不是空白领域，重复实现的价值有限。若要自己写，差异化点应在（a）GUI 体验/多源统一、（b）增量与实时同步、（c）反向导出，而不是"能不能导 Codex"本身。

---

## 1. Codex 会话文件格式的公开资料

### 1.1 官方说法

- **存储位置与形态（官方）**：Codex 把数据存在 Codex home（通常 `~/.codex/`），sessions 存为 **JSONL rollout 文件**，官方明确"Thread data is stored as JSONL (JSON Lines) for human readability"。官方文档列出的目录为 `sessions/`（活跃）与 `sessions_archived/`（归档）——注意这与社区观察到的 `archived_sessions/` **不一致**，落地时要以实际磁盘为准。
  链接：[Core concepts（官方文档镜像）](https://mintlify.wiki/openai/codex/concepts/overview.md)
- **概念模型（官方）**：Thread（一次完整会话）→ Turn（一轮）→ Item（原子单元）。Item 分输入项（`userMessage`/`skill`/`mention`）与输出项（`agentMessage`/`reasoning`/`plan`/`commandExecution`/`fileChange`/`mcpToolCall`/`webSearch`/`imageView`）。
  同上链接。
- **官方并没有发布 rollout JSONL 的字段级 schema**。本次检索未找到 OpenAI 官方的 rollout 行格式规范文档。

### 1.2 社区文档与解析库（字段级，最有价值）

**① `dsh-codex-import/docs/formats.md`（目前见过最详尽的 Codex rollout 记录清单）**【社区】
- 记录全量分类：`session_meta` / `turn_context` / `response_item`（`message`、`function_call`、`function_call_output`、`custom_tool_call`、`local_shell_call`/`shell_call`、`reasoning`、`agent_message`、`tool_search_call`、`web_search_call`、`imageGeneration`、App Server 的 `userMessage`/`agentMessage`/`plan`/`commandExecution`/`fileChange`/`mcpToolCall`/`dynamicToolCall`）/ `event_msg`（`task_started`、`task_complete`、`turn_aborted`、`user_message`、`item_completed`、`exec_command_end`、`token_count`、`thread_settings_applied`）/ `compacted` / `world_state` / `token_usage_record` / `inter_agent_communication_metadata`。
- 关键语义：**`compacted` 记录的 `replacement_history` 是"当时的历史快照"**，模型只看得到最新窗口；rollout 是 append-only 日志而**不是**当前上下文。
- 关键坑：**分页 rollout migration** 会把长会话切成 `rollout-…-<root>_<page>.jsonl`，冷文件被压缩成 `.jsonl.zst`，且**改写旧文件会刷新 mtime**；**文件名后缀不是 session id**（300 文件样本里只有 8% 与 `session_meta.session_id` 相符）。
- 关键坑：**`reasoning.encrypted_content` 是 Fernet token（AES-128-CBC + HMAC-SHA256），密钥在服务端，客户端从不解密**；只有约 1/3 记录带明文 `summary`，`reasoning.content` 恒为 null。
- 链接：https://github.com/tzwkb/dsh-codex-import/blob/main/docs/formats.md

**② `skiplevel/docs/schema-notes-codex.md`（面向解析者的 schema 笔记）**【社区】
- 行信封：`{"timestamp": ISO8601, "type": T, "payload": {...}}`，`T ∈ {session_meta, turn_context, response_item, event_msg, compacted}`。
- 目录布局：`sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl`、`archived_sessions/`、`history.jsonl`（仅 prompt 历史）；同一文件可能同时存在于两处，需按相对路径去重（活跃副本优先）。
- `token_count` 语义：`last_token_usage` 优先；`cached_input_tokens` 是 `input_tokens` 的**子集**；`reasoning_output_tokens` **已包含在** `output_tokens` 内；累计计数器可能回退（compaction / fork 重置）。
- 版本坑：2025-09-06 之前无 token 遥测；早期 9 月文件有 `token_count` 但无 `turn_context`（无模型名）；最老格式（~2025-08）首行是裸 meta 对象、其余是无信封的裸 response item。
- Fork 会话会在文件顶部**重放父会话的 token_count 行**（时间戳早于 fork 的 `session_meta`，据此跳过）。
- 链接：https://github.com/repowise-dev/skiplevel/blob/main/docs/schema-notes-codex.md

**③ `rajbos/ai-engineering-fluency` 的 Codex CLI 格式适配文档**【社区】
- 补充了**索引数据库**：`~/.codex/state_<N>.sqlite`（`state_5.sqlite`，含 `threads` 表，字段含 `id / rollout_path / model_provider / cwd / title / tokens_used / model / git_branch / cli_version / first_user_message / archived / …`），以及 `logs_<N>.sqlite`（仅诊断，**无用量数据**）、`models_cache.json`。
- `rollout_path` 缺失时可用虚拟路径 `<state_db>#<thread_id>` 兜底取 `tokens_used` 等元数据。
- 链接：https://github.com/rajbos/ai-engineering-fluency/blob/main/docs/logFilesSchema/codex-cli-session-format.md

**④ CC Switch 的"统一 Codex 会话历史"指南（会话分类机制的权威解释）**【社区】
- `session_meta.payload.model_provider` 是会话的"抽屉标签"（官方订阅=`openai`，第三方=`custom`），而**真正驱动 resume 列表的是 `state_5.sqlite` 的 `threads.model_provider` 列**。
- 迁移做法：**只改这一个字段** + 改写前先备份（`~/.cc-switch/backups/codex-official-history-unify-v1/<ts>/`）+ 临时文件原子替换 + 同事务更新 DB；恢复用"在账本里 且 当前仍是 custom"双条件保证幂等。
- **重要限制**：跨后端 resume 可能失败，因为 `encrypted_content` 只能由生成它的后端解密（上游设计限制，与文件完整性无关）。
- 链接：https://github.com/farion1231/cc-switch/blob/main/docs/guides/codex-unified-session-history-guide-en.md

### 1.3 用量统计 / 浏览类工具（解析同格式的现成实现）

- **ccusage**（官方文档页，Codex 支持标注为 experimental/beta）【社区】：读 `CODEX_HOME` 下 `sessions/` 与 `archived_sessions/` 的 JSONL；处理 `event_msg.payload.type === "token_count"` 的**累计值 + 每次增量**；把 `compacted` 记录与 `token_usage_record` 按 response id 关联避免重复计费；按 `turn_context` 归模型；`--speed auto|standard|flex|fast` 依据 `thread_settings_applied` 分档。链接：[ccusage Codex 数据源](https://ccusage.com/guide/codex/)、[ryoppippi/ccusage](https://github.com/ryoppippi/ccusage)
- **ai-session-viewer**（weilung）：面向 Claude Code 与 Codex 日志的会话查看器。链接：https://github.com/weilung/ai-session-viewer
- **sessions-viewer**（skorotkiewicz）：本地可扩展的 Pi / Codex 会话查看器（有专门 commit "Add extension system for Pi and Codex session formats"）。链接：https://github.com/skorotkiewicz/sessions-viewer
- **codex-session-viewer**（npm）：存在于 npm，但本次只取得 Socket 的包安全分析页，**未取得其 README 与实现细节**。链接：https://socket.dev/npm/package/codex-session-viewer
- **Codex History Viewer**（VS Code 扩展，Open VSX，发布者 HizTam）：页面本次未渲染出 README，**只有存在性证据**。链接：https://open-vsx.org/extension/HizTam/codex-history-viewer
- **VS Code Codex 扩展的会话保存**话题（官方仓库 Discussion #2956）：本次 GitHub 页面被导航栏截断，**未取得讨论正文**。链接：https://github.com/openai/codex/discussions/2956
- **agent-sessions-list**（HuggingFace dataset）：把 Codex 会话转成数据集，其中有 commit 提到"add codex shell-mode (!) bash command trace, system prompt and skills stripped"。链接：https://huggingface.co/datasets/cfahlgren1/agent-sessions-list

---

## 2. Codex CLI / 桌面版的官方能力

### 2.1 官方文档明确记载的【官方】

| 能力 | 说明 | 链接 |
|---|---|---|
| `codex resume` | 交互式选择器恢复历史会话；`codex resume --last` 直接恢复最近一次；从 `~/.codex/sessions/` 加载 rollout，恢复完整历史（用户消息、回复、执行过的命令、文件变更、推理与计划） | [codex resume](https://mintlify.wiki/openai/codex/cli/resume.md) |
| `codex fork` | 从既有会话**复制历史**并分配**新 thread id**，原会话不变；`--last` 同理 | [codex fork](https://mintlify.wiki/openai/codex/cli/fork.md) |
| `codex exec` | 非交互执行；`--json` 输出 JSONL 事件流；`--ephemeral` 不写入历史；`-C/--cwd`、`--add-dir`、`-i/--images`、`--output-schema`、`-o/--output-last-message` | [codex exec](https://mintlify.wiki/openai/codex/cli/exec.md) |
| App Server JSON-RPC（最"正规"的程序化读取通道） | `thread/start`、`thread/resume`、**`thread/read`（`includeTurns: true` 可返回 turns 与 items）**、`thread/list`（支持 `modelProviders` / `sourceKinds` / `archived` / `cwd` / `searchTerm` / 游标分页）、`thread/fork`（新 id + 复制历史）、`thread/archive` / `thread/unarchive`、`thread/rollback`（丢弃最后 N 轮）、`thread/compact/start`、`thread/name/set`；Thread 对象含 `id`（如 `thr_123`）、`preview`、`path`（rollout 文件路径，ephemeral 为 null）、`cwd`、`modelProvider`、`createdAt/updatedAt`、`status` | [Threads API](https://mintlify.wiki/openai/codex/api/threads.md) |

### 2.2 官方文档**没有**记载的能力

- **`codex exec resume`**：官方 `codex exec` 文档**没有 resume 子命令的章节**。但**源码里有**：`openai/codex` 的 `codex-rs/cli/src/main.rs` 存在 `let Some(codex_exec::Command::Resume(args)) = exec` 分支；另有第三方 PR 讨论"使用 `codex exec resume` 实际接受的 flags"。→ 结论：**该命令存在于实现中，但未见于本次抓取的官方文档**。链接：[main.rs 片段](https://github.com/openai/codex/blob/00c972ed5d6ff6499317fd41b7f23605b8e6850d/codex-rs/cli/src/main.rs)、[相关 PR](https://github.com/garrytan/gstack/pull/2491)
- **`--experimental-resume`**：**【未找到公开证据】**（本次多轮检索无任何官方或社区来源提到该 flag）。
- **官方的 import / export 会话命令**：**不存在**。反证是官方仓库里仍处于"功能请求"状态的 issue：
  - [openai/codex#47196 — "Feature request: lossless, portable Codex project/session export-import for cross-device and Git workflows"](https://github.com/openai/codex/issues/47196)
  - [openai/codex#13267 — "Feature request: option to export the entire session"](https://github.com/openai/codex/issues/13267)
  （两页本次均被 GitHub 导航栏截断，只取到**标题**这一事实；GitHub REST API 因速率限制返回 403，**未取到正文**。）

### 2.3 `rollout-migrations`：是**存储层内部迁移**，不是导入/导出功能【官方源码/commit】

官方仓库相关提交表明"rollout migration"指的是 **Codex 自己把旧格式/旧存储的 rollout 迁移到新的分页历史存储**，属于内部兼容逻辑：

- [commit 6bb6e90 — "Add legacy rollout migration to paginated history (#37175)"](https://github.com/openai/codex/commit/6bb6e9045f728f172ee1c68e6dc56ce6a53cbdb8)
- [commit 881474f — "Harden startup rollout migration against concurrent updates"](https://github.com/openai/codex/commit/881474f2086fe41dcabb8863adb4293c09aaba46)
- [commit 42d842a — "Report thread storage changes after rollout migration (#38579)"](https://github.com/openai/codex/commit/42d842a91a9d77efbf7a164fc0dcd42637958031)
- [PR #31175 — "add MongoDB thread store and session migration"](https://github.com/openai/codex/pull/31175)

**对导入插件的影响**：因为 Codex 会**改写冷 rollout**（迁移/分页），所以**不能用 mtime 判断会话新鲜度**，必须读记录里的 `timestamp`。这一坑在 `dsh-codex-import/docs/formats.md` 中有同源结论。

---

## 3. 同类需求的先例（会话迁移工具）

### 3.1 Claude Code ↔ Codex 及跨 harness 的通用工具

**① `session-migrate`（PyPI，xhluca，MIT）— 目前覆盖面最广的先例**
- 定位："Migrate your sessions to any harness"，支持 18 种 harness（Claude Code、Codex、Pi、Oh My Pi、OpenCode、GitHub Copilot CLI、Antigravity CLI、Cursor Agent、Mistral Vibe、Muse Code、Qwen Code、Kimi Code、Grok、Kilo Code、OpenHands、Hermes Agent、MastraCode、Devin），**324 条有序路线**（任意格式可作源或目标，含同格式可移植重写）。
- 用法示例：`smigrate transfer SESSION_UUID --from claude --to codex --cwd "$PWD"`，然后 `codex resume NEW_SESSION_UUID`。
- 架构：`native session → validated event timeline → native target → resume`；每个 reader 把版本化的原生 transcript 投影成小的有序模型，writer 只输出经目标 CLI 验证过的结构。**"这是会话迁移，不是文本导出"** —— 目标是"可发现、可 resume 的原生会话"。
- "What survives"（诚实清单，直接回答了"最大难点"）：
  - 用户/助手消息：✓ 全路线保序；
  - 工具调用与结果：✓ / 部分（两端适配器都支持该原生形状时才保留）；
  - 图片：✓ / 部分；
  - 压缩摘要：✓ / 部分（目标有可移植等价物时重建）；
  - 可读 reasoning：仅"可移植重写"到 Vibe 时保留其显式字段；**其他/私有/签名推理链永不迁移**；
  - 会话名/ID/选择器条目：✓ / 部分（目标是**新身份**）；
  - 分支/fork/子 agent：**不扁平化**，单独编目，只迁移父会话；
  - **私有或签名 thinking：不迁移**（模型/provider 绑定的推理链被有意省略）；
  - **认证、hooks、策略、MCP、运行时配置：不迁移**，留在源客户端。
- 每次省略/改写都计入"无内容的迁移 manifest"；**源会话永不修改**。
- 链接：[PyPI](https://pypi.org/project/session-migrate/)、[GitHub](https://github.com/xhluca/session-migrate)、[项目站](https://session-migrate.github.io/)

**② `session-porter`（npm，MIT）— Claude Code ↔ Codex CLI 双向**
- 命令：`list / show / summary / export / transfer / continue / fork / handoff / search / stats / doctor / adapters`。
- **工具调用归一化**是核心设计：定义 universal op 表（`file.read` / `file.write` / `file.edit` / `file.glob` / `search.content` / `shell.exec` / `web.search` / `agent.spawn`），Claude 的 `Read/Write/Edit/Glob/Grep/Bash/WebSearch/Agent` 与 Codex 的 `cat 经 exec_command` / `apply_patch` / `rg` 等互映；新增 agent 只需实现 `AgentAdapter` 接口（`loadSession` / `writeSession` / `mapToolToNative` / `mapToolFromNative`）。
- transfer 模式：`raw`（精确聊天，默认）/ `full`（+handoff 上下文）/ `compact`（handoff + 仅 user/assistant）/ `resume-only`（只给一份上下文摘要）。
- **写入后会在 Codex 的 SQLite 里注册**，这样 `codex resume` 才能看到。
- "不迁移"清单：**thinking blocks（Claude 专有，含签名）**、token 用量/计费、系统提示与注入上下文、文件历史快照。
- 链接：[npm](https://www.npmjs.com/package/session-porter)、[GitHub](https://github.com/walidboulanouar/session-porter)

**③ `Codex_Relay`（Tauri 桌面应用）— 跨设备导出/导入 Codex 会话**
- 目标就是"在另一台机器上用 `codex resume <session_id>` 继续同一会话"。
- 导出为 `bundle.zip`（`manifest.json` + `rollout.jsonl`）；导入**先解析校验（manifest + size/sha256）并预览**再写入 `CODEX_HOME`。
- 冲突策略：同 `session_id` 且指纹不同 → **改 ID 导入**（改写 `session_meta.payload.id`，默认不动 `forked_from_id`），两条分叉都能 resume。
- 带 vault / 历史版本 / 恢复 / SQLite 落库。
- 链接：https://github.com/Red-noblue/Codex_Relay

**④ `codex-claude-transfer`（`cct`）**：把 Codex 与 Claude Code 会话在机器间迁移，导出 `.codexbundle` 再导入，可选 LAN 同步，无云、无账号。**本次只取到仓库描述，README 抓取返回 404**，细节未验证。链接：https://github.com/ahmojo/codex-claude-transfer

**⑤ CC Switch**：只做"标签迁移"的极简先例，但工程做法值得抄（见 1.2 ④）。链接：https://github.com/farion1231/cc-switch

### 3.2 迁移工具共同面对的最大难点（横向归纳）

1. **系统提示 / 注入上下文混入用户消息**：Codex 把机器上下文写成 `role: "user"` 的 item。天真的导入会让会话以脚手架开场——而 harness 往往**用第一条消息派生会话标题**。`dsh-codex-import` 给出了需丢弃的 tag 前缀清单（`<recommended_plugins>`、`<environment_context>`、`<permissions instructions>`、`<skill>`、`<turn_aborted>`、`<app-context>`、`<user_instructions>`、`<pending_input>`、`<codex_internal_context>`、`<user_shell_context>`、`<request_id>`、`<model>`、`<turn_id>`、`# AGENTS.md instructions`），并把 `<` 包裹的**信封**（如 `# Files mentioned by the user:` + `## My request for Codex:`）**解包**而非丢弃。
2. **工具调用 schema 不兼容**：两套工具名毫无交集（Codex `exec`/`shell`/`apply_patch` vs Claude `Read`/`Bash`；DSH 里 Codex 工具名不存在）。两条路线：(a) 归一化成通用 op 再映射（session-porter）；(b) **原样保留为"模型可读的历史"，但不作为可调用工具**（dsh-codex-import）。
3. **工具调用需要"双表示"**：DSH 的 provider 适配器是从 **assistant message 上的 `tool-call` content block** 构造 wire 层的 `tool_calls`，而 `tool/call` **事件**只是记账。只有事件没有 content block → 结果孤儿化，下一轮请求失败。
4. **thinking 块不可迁移**：Claude 的 thinking 带签名（session-porter 明确不迁移）；Codex 的 `reasoning.encrypted_content` 是服务端密钥的 Fernet token（见 1.2 ①）。
5. **compaction 语义**：rollout 是日志不是上下文（见 1.2 ①）。全量重放会导入"模型当时看不到的历史"，并且产生**既发不出去也压不掉的 DSH 会话**（压缩本身要把被压缩区间重放给 summarizer）——这是最隐蔽的死锁。
6. **附件/图片**：DSH 的图片必须经 `attachments.saveImages()` 落库（store 会**归一化**图片后再哈希，JPEG 可能变成不同尺寸的 WebP），所以 `attachmentId` **不能从 Codex 的 base64 自己算**。
7. **同一会话跨多文件**：分页 + 冷压缩 `.zst` + 文件名不可信（见 1.2 ①）。

### 3.3 Claude Code `~/.claude/projects/**.jsonl` ↔ Codex rollout 的**直接转换**项目

明确找到的有：
- **`session-migrate`**：`smigrate transfer <UUID> --from claude --to codex --cwd "$PWD"`，README 里有 Claude Code → Codex 的**原生 TUI 截图对比**与 demo 视频（`.gif` / `.mp4`）。链接：https://github.com/xhluca/session-migrate
- **`session-porter`**：`session-porter transfer <id> --from claude --to codex --mode compact`，存储路径对照表写明 `~/.claude/projects/<slug>/<session-id>.jsonl`（信封 `{type, message, uuid, timestamp}`）↔ `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`。链接：https://www.npmjs.com/package/session-porter
- **`agent-convert`**（npm）：本次检索命中包名，**未取到内容**。链接：https://www.npmjs.com/package/agent-convert
- **`agent-session-bridge`**（PyPI）：本次检索命中包名；PyPI 网页抓取被反爬拦截（Client Challenge），**未取到内容**。链接：https://pypi.org/project/agent-session-bridge/

---

## 4. ACP（Agent Client Protocol）能否作为"会话导入"的标准通道？

### 4.1 ACP v1 的会话方法语义【官方】

来源：[Session Setup (v1)](https://agentclientprotocol.com/protocol/v1/session-setup.md)、[Prompt Turn (v1)](https://agentclientprotocol.com/protocol/v1/prompt-turn.md)

- **`session/new`**：Client 传 `cwd` + `mcpServers`，Agent 返回唯一 `sessionId`。
- **`session/load`**（需 Agent 声明 `agentCapabilities.loadSession: true`，否则 Client **MUST NOT** 调用）：传 `sessionId` + `cwd` + `mcpServers`。Agent **MUST 把整段会话历史通过 `session/update` 通知重放**给 Client，全部内容流完后才响应原请求。`session.compaction` 能力在**重放**时也必需；live-only 的 `notice` **不应**被重放。
- **`session/resume`**（需 `sessionCapabilities.resume`）：恢复会话上下文并重连 MCP，**明确 MUST NOT 重放历史**，可直接继续 `session/prompt`。
- **`session/close`**（需 `sessionCapabilities.close`）：取消该会话进行中的工作并释放资源。
- **`session/update` 变体全集**（`params.update.sessionUpdate`）：`user_message_chunk`、`agent_message_chunk`、`agent_thought_chunk`、`tool_call`、`tool_call_update`、`plan`、`available_commands_update`、`current_mode_update`、`config_option_update`、`session_info_update`、`usage_update`、`notice`、`compaction_update`、`compaction_summary_chunk`。
- 另有 `sessionCapabilities.additionalDirectories`（`session/new` / `load` / `resume` 上的额外工作区根）。

### 4.2 ACP v2 的方向（RFD，草案）【官方】

- [v2 Required Session Methods](https://agentclientprotocol.com/rfds/v2/required-session-methods.md)（2026-07-02 初稿）：只要 Agent 声明 `capabilities.session`，就 **MUST** 支持 `session/new`、`session/list`、`session/resume`、`session/close`、`session/prompt`、`session/cancel`、`session/update`；移除 `session.load` / `session.list` / `session.resume` / `session.close` 的独立能力标记。
- [v2 Session Resume Replay](https://agentclientprotocol.com/rfds/v2/session-resume-replay.md)：**`session/load` 被移除**，历史重放折叠进 `session/resume` 的可选 `replayFrom` 游标（`{"type":"start"}` 表示从头重放；省略/`null` 表示不重放）。

### 4.3 判定：ACP **不能**作为"导入外部会话"的通道

理由（基于协议本身）：ACP 全部会话方法都以 **`sessionId` 寻址 Agent 自己持久化的会话**；没有任何方法接受"一段外来历史"作为输入，也没有 import/execute 语义。`session/load` 的重放方向是 **Agent → Client**（Agent 把**自己**的历史播给 Client），不是 Client → Agent。因此：

> **结论**：ACP 无法承载"把 Codex rollout 灌进 DSH"。它是 Client↔Agent 的会话生命周期与流式呈现协议。

**但 ACP 有另一个高价值用途：验收/回归测试**。`dsh-codex-import` 正是这样做的——用 `dsh --profile acp`（stdio JSON-RPC）跑 `initialize → session/list → session/resume → session/prompt → session/close`，只有**续聊成功**（返回 `stopReason: end_turn`）才算导入真正可用；并且明确指出：**斜杠命令无法用 ACP 测试**（`dsh-acp` 不解析斜杠命令，`acp` profile 也不加载其他 profile 的 bundle）。链接：https://github.com/tzwkb/dsh-codex-import/blob/main/docs/formats.md

### 4.4 DSH 在外部是否有公开文档/仓库？

**有，且是官方的**【官方】：
- 官方仓库：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/DeepSeek-Harness)（"DeepSeek Harness: Everything is a Plugin."）
- 官方文档站：[deepseek-harness.github.io](https://deepseek-harness.github.io/deepseek-harness/)；其中**会话子系统参考**（对应本仓库 `Docs/参考.md` 语境）系统描述了 `Session`＝由类型化 `SessionEvent` 组成的**仅追加日志**、`SessionEventMap` 事件词汇（`turn/start`、`turn/end`、`step/start`、`step/end`、`user/message`、`developer/message`、`system/message`、`assistant/message`、`assistant/attempt`、`tool/call`、`tool/result`、`request/header`、`request/context`、`session/end-seed`）、**Surface 事件子集与 `surfaceOp`**、`ctx.sessions`（`SessionStore`）与 `ctx.sessionController` 的 Remote API（`list` / `search` / `create` / `fork` / `prompt` / `page` / `follow` / `attachment`…）、以及持久化约定（**当前 JSONL 每事件写一行**）。
  链接：[会话（deepseek-harness.github.io）](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/session)、[Python SDK 入门](https://deepseek-harness.github.io/deepseek-harness/en/guide/python-sdk)
- 社区侧把 DSH 当 ACP **agent** 暴露的插件：[@dsh-enhanced/acp](https://www.npmjs.com/package/@dsh-enhanced/acp)（"Use DeepSeek Harness as an Agent Client Protocol (ACP) stdio agent"，依赖 `@agentclientprotocol/sdk`）、[@8kugames/dsh-zed-acp](https://www.npmjs.com/package/@8kugames/dsh-zed-acp)。
- 其他 DSH 插件生态参考：[casualjim/dsh-plugins](https://github.com/casualjim/dsh-plugins)、[freespace8/dsh-plugins](https://github.com/freespace8/dsh-plugins)、[Planckbaka/dsh-plugin-github-workflows](https://github.com/Planckbaka/dsh-plugin-github-workflows)、[Liang-HZ/dsh-plugin-mcp-session-meta](https://github.com/Liang-HZ/dsh-plugin-mcp-session-meta)。

---

## 5. 结论与可执行建议

### 5.1 外部生态给出的"最佳实践"

生态里**两条并存的路线**：

| 路线 | 代表 | 何时选 |
|---|---|---|
| **A. 直接转换落盘文件（主流、推荐）** | dsh-codex-import、session-migrate、session-porter、dsh-session-sync、dsh-chat-import | 目标是"导入后能继续对话"。所有实际能续聊的先例都走这条 |
| **B. 只做只读浏览/引用** | ccusage、ai-session-viewer、sessions-viewer | 目标只是统计、审计、检索历史，不需要续聊 |
| **C. 走协议** | — | **不适用**：ACP 没有导入语义（见 4.3）。Codex 的 app-server `thread/read`/`thread/list` 也只读 Codex 自己的线程，不能把外来历史写进去 |

所以：**"直接转换落盘文件"是唯一被验证可行的路线**；协议的正确位置是**验收**，不是导入。

### 5.2 五条可执行建议

**建议 1：先评估复用与差异化，再决定是否自研。**
`dsh-codex-import` 已把 Codex→DSH 的格式契约跑通（含 5 条校验、图片、孤儿工具调用、增量 refresh、rollback），`dsh-chat-import` 已覆盖 25+ 源并暴露 `chatImport` host service，`dsh-session-sync` 已有实时 watch 与双向 push。自研的合理理由应是：需要与 `dsh-yzlin499-easy-plugins` 现有插件（如 plugins-manager 的 GUI/设置页）深度整合、或需要它们没做的能力，而不是"Codex 导入"本身。
- https://github.com/tzwkb/dsh-codex-import
- https://github.com/Nwflower/dsh-chat-import
- https://github.com/NB4747/dsh-session-sync

**建议 2：落盘目标 = DSH 原生 session log；优先复用 DSH 提供的持久化接口，而不是手写字节。**
手写字节必须同时满足：首帧**只**放 header 一行、`seq` 从 0 连续、四个 surface 事件类型（`system/message`、`user/message`、`assistant/message`、`tool/result`）带 `surfaceOp`、每个 message 事件有非空字符串 `id`、`assistant/message` 带数值 `turn`/`step` **且 `stream` 为 Array**、事件信封字段封闭；最强的一条约束不在任何 validator 里：**每个 tool result 必须由同 step 的 assistant message 上一个匹配的 `tool-call` content block 前置**（provider 读的是 content block）。
- `dsh-session-sync` 选择走 DSH 官方 `SessionPersistence` 接口（更稳）；`dsh-codex-import` 选择自己按 `dsh-session-persistence-jsonl` 的编码规则写并三重校验（更可控）。
- https://github.com/tzwkb/dsh-codex-import/blob/main/docs/formats.md
- https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/session

**建议 3：默认只导入"最后一个 `compacted` 之后的窗口"，并提供 `--full-history`；对单条文本设上限。**
理由：rollout 是日志不是上下文；全量重放会造出**既发不出去也压不掉**的会话（压缩需要把被压缩区间重放给 summarizer）。另外单条超大文本是"平衡压缩拒绝切分、tool-result 修剪器也碰不到"的唯一形状，必须在导入期就 clamp（截断处留显式标记，别静默丢）。会话级元数据（cwd/model/createdAt/title）要**从完整记录列表**读，不能从窗口读。
- https://github.com/tzwkb/dsh-codex-import（README「Why the default is not a full replay」）
- https://github.com/repowise-dev/skiplevel/blob/main/docs/schema-notes-codex.md

**建议 4：把"Codex 注入的上下文"当作一等公民处理，否则会话标题和首条消息都是脚手架。**
按 tag 前缀丢弃注入项、对外层信封**解包**取人的真实提问、清掉 compaction/token 这类"上下文管道"记录。同时：**不要承诺 reasoning 可解密**（Fernet 服务端密钥，只能拿约 1/3 的明文 `summary`）；**图片必须走 attachment store 的 `saveImages()`**（store 会归一化再哈希，ID 不可自算）；**Codex 工具名原样保留为历史文本，不作为可调用工具**。
- https://github.com/tzwkb/dsh-codex-import/blob/main/docs/formats.md

**建议 5：安全与幂等设计照抄成熟做法，并把 ACP 当验收通道。**
- 只读源：源 rollout 永不修改；导入写临时文件再 rename 原子落位；目标已存在 / 符号链接要拒。
- 幂等：用**内容 digest + zstd 帧数**区分"未导入 / 字节相同（什么都不写）/ 内容变化（原地 refresh，保持 session id）/ 不是本插件写的（不动）"——帧数是"是否被 DSH 续写过"的信号（本插件 2 帧；DSH 每事件批追加一帧，续写过就会 >2 帧）。
- 可回滚：每轮写不可变 manifest（+ latest 指针），提供 `--dry-run`、`rollback`、只读 `audit`（按 4 字符/token 估价，找出超窗、再也压不掉的会话）。
- 验收：`verify`（结构校验）**不等于**能续聊；必须再用 ACP 跑一遍 `session/list → session/resume → session/prompt`，成功返回 `stopReason: end_turn` 才算通过（注意：斜杠命令无法用 ACP 测）。
- https://github.com/tzwkb/dsh-codex-import/blob/main/docs/formats.md
- https://github.com/farion1231/cc-switch/blob/main/docs/guides/codex-unified-session-history-guide-en.md
- https://agentclientprotocol.com/protocol/v1/session-setup.md

### 5.3 明确未找到公开证据的点

- `--experimental-resume`：**未找到公开证据**。
- OpenAI 官方的 rollout JSONL 字段级 schema：**未找到公开证据**（只有官方概念模型与"JSONL 存储"的说明）。
- 官方的会话 import/export 命令：**未找到**；相反找到两个仍开放的 feature request（#47196、#13267，仅取到标题）。
- `codex-session-viewer` 的 README/实现、`Codex History Viewer` VS Code 扩展的说明、openai/codex Discussion #2956 的正文、`agent-convert` / `agent-session-bridge` 的文档：**本次抓取受阻或未取到**，仅确认其存在。
- OpenAI 官方文档中 `sessions_archived/` 与社区观察到的 `archived_sessions/` **不一致**，未找到官方澄清。

---

## 附：本次调研引用到的全部链接

**官方（OpenAI Codex）**
- https://mintlify.wiki/openai/codex/concepts/overview.md
- https://mintlify.wiki/openai/codex/cli/resume.md
- https://mintlify.wiki/openai/codex/cli/fork.md
- https://mintlify.wiki/openai/codex/cli/exec.md
- https://mintlify.wiki/openai/codex/api/threads.md
- https://github.com/openai/codex/blob/00c972ed5d6ff6499317fd41b7f23605b8e6850d/codex-rs/cli/src/main.rs
- https://github.com/openai/codex/commit/6bb6e9045f728f172ee1c68e6dc56ce6a53cbdb8
- https://github.com/openai/codex/commit/881474f2086fe41dcabb8863adb4293c09aaba46
- https://github.com/openai/codex/commit/42d842a91a9d77efbf7a164fc0dcd42637958031
- https://github.com/openai/codex/pull/31175
- https://github.com/openai/codex/issues/47196
- https://github.com/openai/codex/issues/13267
- https://github.com/openai/codex/discussions/2956

**官方（ACP / DSH）**
- https://agentclientprotocol.com/protocol/v1/session-setup.md
- https://agentclientprotocol.com/protocol/v1/prompt-turn.md
- https://agentclientprotocol.com/rfds/v2/required-session-methods.md
- https://agentclientprotocol.com/rfds/v2/session-resume-replay.md
- https://github.com/deepseek-ai/DeepSeek-Harness
- https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/session

**社区：Codex 格式与工具**
- https://github.com/tzwkb/dsh-codex-import/blob/main/docs/formats.md
- https://github.com/repowise-dev/skiplevel/blob/main/docs/schema-notes-codex.md
- https://github.com/rajbos/ai-engineering-fluency/blob/main/docs/logFilesSchema/codex-cli-session-format.md
- https://github.com/farion1231/cc-switch/blob/main/docs/guides/codex-unified-session-history-guide-en.md
- https://ccusage.com/guide/codex/
- https://github.com/ryoppippi/ccusage
- https://github.com/weilung/ai-session-viewer
- https://github.com/skorotkiewicz/sessions-viewer
- https://socket.dev/npm/package/codex-session-viewer
- https://open-vsx.org/extension/HizTam/codex-history-viewer
- https://huggingface.co/datasets/cfahlgren1/agent-sessions-list

**社区：会话迁移工具**
- https://pypi.org/project/session-migrate/
- https://github.com/xhluca/session-migrate
- https://session-migrate.github.io/
- https://www.npmjs.com/package/session-porter
- https://github.com/walidboulanouar/session-porter
- https://github.com/Red-noblue/Codex_Relay
- https://github.com/ahmojo/codex-claude-transfer
- https://www.npmjs.com/package/agent-convert
- https://pypi.org/project/agent-session-bridge/

**社区：DSH 导入插件与生态**
- https://github.com/tzwkb/dsh-codex-import
- https://github.com/Nwflower/dsh-chat-import
- https://www.npmjs.com/package/dsh-chat-import
- https://github.com/NB4747/dsh-session-sync
- https://github.com/ayst-z/dsh-history-migration
- https://www.npmjs.com/package/@dsh-enhanced/acp
- https://www.npmjs.com/package/@8kugames/dsh-zed-acp
- https://github.com/casualjim/dsh-plugins
- https://github.com/freespace8/dsh-plugins