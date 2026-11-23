# dsh-trajectory-edit

[English](README_EN.md) | 简体中文

> 在**轨迹面板**里右键任意一条记录：**编辑**它的文本，或按规则**自动清理**退化的重复内容。

## 用途

模型偶尔会陷入重复循环——一段思考里同一句话反复出现几百上千次，把上下文窗口和日志一起烧掉。这些内容一旦落盘，DSH 的压缩只会「遮住」它们，不会删除，而带工具调用的消息又不能整条遮掉（会让工具结果变成孤儿）。

本插件直接做**日志手术**：只改那条记录里的文本，事件结构、`seq`、`turn`/`step`、`tool-call` 配对全部原样保留。写盘前备份、写盘后复读校验、失败自动回滚。

## 安装

```bash
dsh plugin --profile desktop add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-trajectory-edit"
```

或者把本目录放进 profile 的 bundle 列表 / 在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 里 insert 一行 `name: 'dsh-trajectory-edit'`。装完重启 DSH。

## 使用

1. 打开任意会话，切到 **Trajectory（轨迹）** 标签页。
2. 在任意一条记录上**点右键**。
3. 菜单里两项：
   - **编辑** —— 打开弹窗，改这条记录的文本（助手消息的「思考」「正文」；用户消息的正文），保存即写盘。
   - **自动清理** —— 子菜单可选 **仅此条记录**（默认）或 **整个会话**；先给预览（减少多少字符），确认后写盘。
4. 写盘成功后弹窗会给出备份路径，并提示：**重启 DSH（或重新打开该会话）后生效**。

工具记录（`tool/call` / `tool/result`）不提供编辑，折叠摘要行与只有请求边界的行会被跳过。

## 自动清理规则

| 规则 | 判据 | 动作 |
|---|---|---|
| 周期块 | 1–12 行的周期重复 ≥ 4 次 | 保留 1 个周期 + `[… 已折叠 N 行重复 …]` |
| 短行重复 | trim 后 ≤ 30 字符且出现 ≥ 3 次 | 保留前 2 次，其余删除 |
| 乱码 | NUL / U+FFFD / 零宽字符 / 孤立代理 | 删除 |
| 超长块 | 单块 > 32K 字符 | 保留头 40% + 尾 20% + 标记 |

规则是**保守**的：只折叠完全相同的短行或整段周期，不会重写、重排、总结唯一文本。对同一条记录重复清理是**幂等**的（第二次跑零改动）。

实测（一个 1583 事件、1.70 MiB 的会话）：**-15.3%（-260 KiB）**，160 条记录被清理，思考文本减半。

## 工作原理

```
浏览器（client.js）                      Host（index.js）
  document capture 'contextmenu'
    → tr[data-trajectory-row-key]
    → 解析 assistant\0turn\0step
           / kind\0call\0callId
           / kind\0seq\0seq
    → contextMenus.open(target)  ──POST /api/trajectory-edit/apply──▶
                                          逐帧解压 zstd
                                          → 定位事件
                                          → 只改 content[i].text
                                            （并同步 stream 里的两份副本）
                                          → 只重压受影响的帧
                                          → 备份 → 原子替换 → 复读校验
```

- **帧级重写**：日志是 823 个拼接的 Zstandard 帧（首帧只放 header）。插件只重压包含被改事件的帧，其余帧字节不动。
- **三副本同步**：助手消息的文本在日志里有三份（`message.content`、`stream[].*-chunks.texts`、`stream[].chunk.block-end.block.text`）。只改一份会让 DSH 最严的校验器与 token 计量对不上，所以三份一起改。
- **安全不变量**：事件条数、`seq`、`turn`/`step`、`surfaceOp`、`usage`、工具调用配对、header 全部不变；写后复读断言「只有文本路径发生变化」。
- **回滚**：写盘前 `session.v4.jsonl.zstd.bak-<时间戳>`；写盘后复读失败自动用备份恢复。
- **拒绝条件**：会话有未结束的轮次（409）；会话 id 非法；日志不存在。

## 已知限制

- **改完必须重启/重开会话**：DSH 读会话是 live 优先，Host 内存里的旧上下文不会自动变新。
- 工具记录不可编辑（会破坏工具调用配对）。
- 清理只作用于文本，不删除事件；要「删掉一整段对话」请用 `dsh-turn-sieve` 之类的插件。
- 依赖两个 DSH 内部实现面：`data-trajectory-row-key` 的编码格式、`assistant/message.data.stream` 的三副本结构。`npm run check` 是升级哨兵，DSH 升级后先失败而不是静默写坏。
- 备份文件按规范名正则不会被 DSH 当成日志代际，但请定期清理。

## 开发

```bash
node --test "test/*.test.mjs"   # 27 项
npm run check                   # 静态哨兵（读 app.asar 断言锚点仍在）
node scripts/clean-session.mjs <sessionId|logPath> [--record <rowKey>] [--apply]
```

## License

MIT
