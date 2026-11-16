# dsh-ark-quota-guard

A Volcengine Ark (火山方舟) quota guard: when a request hits a 429, the session is **parked instead of
dying**, then **resumed automatically 10 seconds after the quota resets**.

Ark's Coding Plan / Agent Plan quotas are window-based (5 hours / 7 days / 30 days). Once a window is
exhausted the API keeps returning 429 until the window resets. During that gap an agent turn just ends
with an error — you have to sit there and type "continue" by hand, and if you are away the whole night
is lost.

This plugin takes over that wait:

```
request → 429 AccountQuotaExceeded
            │
            ├─ work out "when does it reset?"
            │    ① parse the reset instant carried in the 429 message
            │       ("It will reset at ..." / "您的限额将在 ... 重置")
            │    ② otherwise query the control plane: GetCodingPlanUsage / GetAFPUsage (AK/SK, V4 signing)
            │
            ├─ reset is far away (> minParkMs) → record the park (persisted), let the turn end cleanly
            │
            └─ timer fires at "reset instant + 10s"
                   ├─ re-check the quota: still exhausted → reschedule
                   └─ recovered → agent.followup() resumes from where it stopped
```

## Install

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-ark-quota-guard"
```

Restart DSH Web. Uninstall:

```powershell
dsh plugin --profile web remove dsh-ark-quota-guard
```

(`web` is your profile name; the desktop app uses its bundled CLI with `--profile desktop`. For local
development, a `link:` install also works — see [Docs/Install.md](../Docs/Install.md).)

## Usage

Works out of the box — **no AK/SK required**: Ark's 429 messages usually carry the reset instant, which
the plugin parses directly.

To enable the quota-query fallback as well (used when the message has no timestamp), provide a
Volcengine **access key pair**:

```text
<DSH_HOME>/ark-quota-guard.json    # on Windows usually C:\Users\<you>\.dsh\ark-quota-guard.json
```

The file is generated with defaults on first boot. Fill in `accessKey` / `secretKey`; the environment
variables `VOLC_ACCESS_KEY` / `VOLC_SECRET_KEY` (or `ARK_ACCESS_KEY` / `ARK_SECRET_KEY`) are also
honoured.

> **Why AK/SK is needed**: quota queries go to the **control plane**
> `ark.cn-beijing.volcengineapi.com`, which requires account-level Access Key V4 signing. The inference
> Bearer key used against `/api/v3` does not work there. Create one in the
> [Volcengine IAM key manager](https://console.volcengine.com/iam/keymanage); Billing read-only
> permission is enough.

Slash commands:

| Command | Effect |
|---|---|
| `/ark-quota` or `/ark-quota status` | show the switch, config, parked queue and countdowns |
| `/ark-quota on` / `off` | master switch (off = no interception, no scheduling, no resume) |
| `/ark-quota test` | query Ark quota now and print every window's used percentage and reset time |
| `/ark-quota now` | resume the current session immediately (without waiting for the reset instant) |

## Configuration

Config file: `<DSH_HOME>/ark-quota-guard.json` (restart DSH after editing).

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | master switch |
| `providerPattern` | `ark\|volc\|doubao\|pi-ai` | only take over when the provider name matches this regex (case-insensitive; empty string = every provider) |
| `plan` | `auto` | which plan to query: `auto` tries Coding Plan then Agent Plan; or pin `cp` / `ap` |
| `accessKey` / `secretKey` | `''` | Volcengine AK/SK; empty falls back to environment variables |
| `resumeBufferMs` | `10000` | how long to wait **after** the reset instant (10 s of slack by default, to clear server-side reset lag) |
| `minParkMs` | `60000` | do **not** park when the reset is closer than this (leave it to normal retries) |
| `exhaustedPercent` | `99.5` | used percentage at or above this counts as "this window is exhausted" |
| `defaultOffsetMinutes` | `480` | timezone assumed when the error text carries no offset (UTC+8 by default) |
| `resumeMessage` | `额度已重置，请继续之前中断的任务。` | prompt injected when resuming |
| `verifyBeforeResume` | `true` | re-check the quota before resuming |
| `recheckMs` | `60000` | how long to wait before retrying a failed verification |
| `resumeAfterRestart` | `true` | after a DSH restart, try to recover parked sessions whose reset instant has passed |
| `requestTimeoutMs` | `15000` | per-request timeout for control-plane calls |

The park list is persisted to `<DSH_HOME>/ark-quota-guard.state.json`, so it **survives restarts**.

## How it works

### 1. Deciding "is this quota exhaustion?"

The plugin listens on DSH's `agent/request-error` waterfall and routes on **`LlmFailure.code`**,
**never on message text**:

- `QUOTA` (provider-neutral exhaustion), `ACCOUNT_QUOTA` (first-party account balance),
  `RATE_LIMIT` (429), or `status === 429`.

`CONTEXT_WINDOW_EXCEEDED`, `SERVER` and `AUTH` are deliberately **not** taken over — they belong to
normal retries or context compaction, and parking them for hours would be wrong.

### 2. Working out "when does it reset?"

Two sources, cheapest first:

1. **The error message** (no credentials needed). Ark 429s carry the reset instant; three observed
   shapes are covered — `It will reset at 2026-11-09 00:00:00 +0800 CST`,
   `您的限额将在 2026-08-15 12:00:47 重置`, `resets at 2026-10-25T23:59:59+08:00` — plus bare
   timestamps such as `"reset_timestamp": 1782057600`.
2. **The control plane** (needs AK/SK): `GetCodingPlanUsage` (second-resolution `ResetTimestamp`) and
   `GetAFPUsage` (millisecond `ResetTime`, `-1` = no active window). The plugin takes the earliest
   future reset among exhausted windows.

If the API is reachable but reports no future reset window, the quota looks healthy — the plugin
**does not park**, and hands the failure back to normal retry. This keeps a transient blip from being
mistaken for a five-hour wait.

### 3. Why "end the turn" instead of returning `retry`

Returning `{ kind: 'retry' }` from `agent/request-error` makes the loop re-run the failed step, but it
**keeps the turn in `running`** the whole time. Quota windows last hours, so that would freeze the agent
and spin the UI forever.

Instead the plugin uses the conventional DSH pattern (the same "durable before wait" idea as
`dsh-llm-retry`, but with the wait crossing a turn boundary): **record the park → leave the failure
terminal → let the turn end → wake the session with `agent.followup()` at the reset instant.**
`followup` is DSH's official "wake the agent" entry point, so the resumed session continues from its
existing history with no context loss.

### 4. Ten seconds of slack, then verify

The reset instant is what the **server says**; the actual release usually lands a few hundred
milliseconds to a few seconds later. So the default is **reset instant + 10 seconds**
(`resumeBufferMs`). When the timer fires and `verifyBeforeResume` is on, the plugin queries the quota
first:

- recovered → resume;
- not yet recovered (server lag) → reschedule onto the new reset instant and keep waiting.

That avoids the "fire, get another 429, park again" churn.

## Notes

- **Only 429s with a resolvable reset instant are parked.** If no instant can be derived (no timestamp
  in the message and no AK/SK), the failure goes back to normal retry — the plugin never waits blindly.
- **A parked session is idle, not stuck**: other sessions keep running normally.
- **No cross-process resume beyond persistence**: `resumeAfterRestart` uses `ctx.agents.resume()`, which
  restores sessions already persisted to disk. If the session itself was deleted, the resume fails and
  is logged (nothing crashes).
- Depends on DSH's `agent/request-error` event name and the `Agent.followup()` contract. If the official
  contract changes, the plugin degrades to "does not take over" — i.e. ordinary 429 behaviour, never
  worse.
- The quota query is **one extra network request**, made only when a 429 occurs or when you run
  `/ark-quota test`. Otherwise there is no polling and no overhead.

## Tests

```powershell
cd dsh-ark-quota-guard
npm test
```

43 cases: V4 signing (same fixed vectors as the Rust implementation in YZLWork), CP/AP response
parsing, reset-instant parsing, the parking decision gates, and an end-to-end "park → timer → resume"
loop driven by real timers.

## License

[MIT](../LICENSE)
