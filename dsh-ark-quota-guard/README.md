# dsh-ark-quota-guard

火山方舟（Volcengine Ark）额度守护：**撞到 429 不再「任务死掉」，而是挂起 → 到重置时刻 + 10 秒冗余 → 自动续跑。**

方舟的 Coding Plan / Agent Plan 是**窗口制**额度（5 小时 / 7 天 / 30 天）。窗口撞满之后，接口会
一直回 429，直到窗口重置。这段时间里 agent 的回合会直接以错误结束——你人在电脑前还得盯着时间
手动发一句「继续」，人不在就整晚停在那儿。

这个插件把这段等待接了过去：

```
请求 → 429 AccountQuotaExceeded
         │
         ├─ 算「什么时候重置」
         │    ① 先解析 429 文案里自带的重置时刻（"It will reset at ..." / "您的限额将在 ... 重置"）
         │    ② 文案里没有就查管控面 GetCodingPlanUsage / GetAFPUsage（AK/SK 签名 V4）
         │
         ├─ 离重置还很久（> minParkMs）→ 记进挂起表（落盘），让本轮正常结束
         │
         └─ 定时器在「重置时刻 + 10 秒」触发
                ├─ 再查一次额度：还没恢复 → 重新排期
                └─ 恢复了 → agent.followup() 续跑，从断点接着干
```

## 安装

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-ark-quota-guard"
```

重启 DSH Web。卸载：

```powershell
dsh plugin --profile web remove dsh-ark-quota-guard
```

（`web` 换成你的 profile 名；桌面 App 用自带 CLI 并指定 `--profile desktop`，
本地调试可用 `link:` 方式，见 [Docs/Install.md](../Docs/Install.md)。）

## 使用

装好即生效，**不配 AK/SK 也能用**：方舟的 429 文案里通常自带重置时刻，插件直接解析就够了。

想让「额度查询」这一层也生效（文案没带时间时兜底），去填一对火山引擎 **访问密钥**：

```powershell
# 默认路径：<DSH_HOME>/ark-quota-guard.json（Windows 一般是 C:\Users\<你>\.dsh\ark-quota-guard.json）
```

首次启动会自动生成这份配置（带默认值）。把 `accessKey` / `secretKey` 填进去即可；也支持环境变量
`VOLC_ACCESS_KEY` / `VOLC_SECRET_KEY`（或 `ARK_ACCESS_KEY` / `ARK_SECRET_KEY`）。

> **为什么必须是 AK/SK**：额度查询走的是**管控面** `ark.cn-beijing.volcengineapi.com`，
> 要账号级 Access Key 的 V4 签名。推理用的 `/api/v3` Bearer Key 在这里无效。
> 去 [火山引擎 IAM 密钥管理](https://console.volcengine.com/iam/keymanage) 建一对，
> 只给 Billing 只读权限就够。

随时用斜杠命令看状态 / 试查询：

| 命令 | 作用 |
|---|---|
| `/ark-quota` 或 `/ark-quota status` | 看开关、配置、当前挂起队列与倒计时 |
| `/ark-quota on` / `off` | 总开关（关掉后不拦截、不排期、不续跑） |
| `/ark-quota test` | 立刻查一次方舟额度，打印各窗口已用百分比与重置时间 |
| `/ark-quota now` | 当前会话如果挂着，立刻续跑（不等重置时刻） |

## 配置

配置文件：`<DSH_HOME>/ark-quota-guard.json`（改完**重启 DSH** 生效）。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `providerPattern` | `ark\|volc\|doubao\|pi-ai` | 只在 provider 名匹配该正则时接管（大小写不敏感；空串 = 全部接管） |
| `plan` | `auto` | 查哪套套餐：`auto` 先 Coding Plan 再 Agent Plan；也可固定 `cp` / `ap` |
| `accessKey` / `secretKey` | `''` | 火山引擎 AK/SK；留空回退环境变量 |
| `resumeBufferMs` | `10000` | 重置后**再等多久**才续跑（默认 10 秒冗余，避开服务端重置延迟） |
| `minParkMs` | `60000` | 离重置不足这么久就**不挂起**（交给普通重试，避免小题大做） |
| `exhaustedPercent` | `99.5` | 已用百分比 ≥ 该值即视为「该窗口已耗尽」 |
| `defaultOffsetMinutes` | `480` | 错误文案没写时区时按哪一区解释（默认东八区） |
| `resumeMessage` | `额度已重置，请继续之前中断的任务。` | 续跑时注入给会话的提示词 |
| `verifyBeforeResume` | `true` | 续跑前再查一次额度，确认真的恢复了 |
| `recheckMs` | `60000` | 复核失败后隔多久再试 |
| `resumeAfterRestart` | `true` | DSH 重启后，对已过重置时间的挂起会话尝试自动恢复 |
| `requestTimeoutMs` | `15000` | 单次管控面请求超时 |

挂起表落在 `<DSH_HOME>/ark-quota-guard.state.json`，**DSH 重启不丢**。

## 工作原理

### 1. 判定「是不是额度耗尽」

挂在 DSH 的 `agent/request-error` 瀑布上，按 **`LlmFailure.code`** 判，**绝不看文案**：

- `QUOTA`（provider 中立耗尽）、`ACCOUNT_QUOTA`（一方账户余额）、`RATE_LIMIT`（429），
- 或 `status === 429`。

顺带一提，`CONTEXT_WINDOW_EXCEEDED`、`SERVER`、`AUTH` 这些**不接管**——它们归普通重试或
上下文压缩管，不该被挂起几小时。

### 2. 算「什么时候重置」

两条来源，按代价从低到高：

1. **错误文案**（不需要凭据）：方舟 429 自带重置时刻，实测三种写法都覆盖——
   `It will reset at 2026-11-09 00:00:00 +0800 CST`、`您的限额将在 2026-08-15 12:00:47 重置`、
   `resets at 2026-10-25T23:59:59+08:00`；另外也认 `"reset_timestamp": 1782057600` 这种裸时间戳。
2. **管控面接口**（需要 AK/SK）：`GetCodingPlanUsage`（秒级 `ResetTimestamp`）/
   `GetAFPUsage`（毫秒级 `ResetTime`，`-1` = 无活跃窗口）。取「已耗尽且重置在未来的窗口」里
   最早的那个。

接口能连上、但没有任何未来重置窗口时，说明额度看着是好的——**这次不挂起**，交回普通重试，
避免把一次瞬时抖动误判成「等 5 小时」。

### 3. 为什么「让本轮结束」而不是 `retry`

`agent/request-error` 瀑布里返回 `{ kind: 'retry' }` 能让 loop 重跑失败的那一步，但它会把
**这个 turn 一直吊在 running 状态**。额度窗口动辄几小时，吊着等于 agent 卡死、UI 一直转圈。

本插件用的是 DSH 里更常规的姿势（与 `dsh-llm-retry` 的「先持久、后等待」同源，但等待跨越
turn 边界）：**记进挂起表 → 让失败保持终态 → 本轮正常结束 → 到点 `agent.followup()` 重新拉起**。
`followup` 是 DSH 官方「唤醒 agent」的入口，续跑后的会话从原历史继续，不丢上下文。

### 4. 冗余 10 秒 + 复核

重置时刻是**服务端说的时间**，实际放行通常晚几百毫秒到几秒，所以默认在重置时刻**再加 10 秒**
（`resumeBufferMs`）。到点后如果 `verifyBeforeResume` 开着，会先查一次额度：

- 已恢复 → 续跑；
- 还没恢复（服务端延迟）→ 用新的重置时刻重新排期，一轮轮等到真的恢复。

这样不会出现「到点了、发出去、还是 429、又挂一轮」的抖动。

## 注意

- **只对能算出重置时间的 429 生效**。算不出来（文案没带、又没配 AK/SK）就交回普通重试——
  不会瞎等。
- **挂起期间这个会话是空闲的**，不是「卡住」：其它会话照常跑。
- **不做跨进程续跑**：`resumeAfterRestart` 走的是 `ctx.agents.resume()`，能恢复已持久化到磁盘的
  会话；如果会话本身被删了，恢复会失败并记日志（不会崩）。
- 依赖 DSH 的 `agent/request-error` 事件名与 `Agent.followup()` 契约。官方改契约时，
  本插件退化为「不接管」（普通 429 行为，不会更糟）。
- 额度查询是**额外一次网络请求**，只在「撞到 429」或你手动 `/ark-quota test` 时发生，
  平时零轮询、零开销。

## 测试

```powershell
cd dsh-ark-quota-guard
npm test
```

43 个用例：V4 签名（与 YZLWork 的 Rust 实现同一套固定向量）、CP/AP 响应解析、重置时刻解析、
挂起判定闸门，以及用真实定时器跑的「挂起 → 到点 → 续跑」端到端闭环。

## License

[MIT](../LICENSE)
