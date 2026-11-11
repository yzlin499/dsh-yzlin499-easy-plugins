# dsh-recent-tps

Adds a **"Last 30s speed"** row to the session-statistics panel under the composer.

The official panel (the one that opens when you click the reading) only has four
whole-session rows:

```
Session statistics               2 turns 174 steps
──────────────────────────────────────────────────
LLM time                             15m 10s
Tool time                             2m 45s
Avg time to first token (TTFT)          2.2s
Tokens per second (TPS)              218 tok/s
Last 30s speed                       195 tok/s   ← the row this plugin adds
```

"Tokens per second (TPS)" is `Σ output tokens ÷ Σ decode time` over the **whole session**.
After a two-hour run, a stalled step barely moves that number. The new "Last 30s speed" row uses
the **same formula** with the range narrowed to the last 30 seconds — and **once it has a value it
holds it**: with no new step settling the reading stays exactly where it is, it never decays with
the wall clock, and it never turns into `—`. It also has a value right after a page refresh (each
session's last reading is kept in `localStorage`).

## Install

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-recent-tps"
```

Restart DSH Web (or reload the page). Uninstall:

```powershell
dsh plugin --profile web remove dsh-recent-tps
```

(`web` is your profile name; the desktop app uses its bundled CLI with `--profile desktop`, and
local development can use the `link:` form — see [Docs/Install.md](../Docs/Install.md).)

## Usage

No switches, no settings page — it just works. Click the gauge reading
`2 turns 174 steps · 218 tok/s` under the composer; the last row of the panel is
"Last 30s speed".

- **Detailed mode**: the four official rows plus the 30-second row.
- **Compact mode** (Settings → General → Performance & usage): the reading shows the whole-session
  speed only, exactly like the official behavior; hovering the tooltip also shows the last-30s
  speed.
- It neither jumps nor decays nor goes blank: **with no new step settling, the reading stays
  exactly the same**. `—` appears only in the extreme case of no samples at all *and* zero
  whole-session decode time.

## How it works

**Why "take over"**: the composer statistics are two entries in the
`conversation.composer.dock` slot (the `activity` reading and the `usage` totals). The panel has
**no slot inside it** and the official API offers no "add a row" extension point. The documented
way is a same-id override:

> Another plugin replaces one control by registering the **same id and the same `order`**;
> the dock orders rows by `order`, while a **lower `priority`** picks the replacement.

The slot implementation sorts entries by `priority` ascending, then by `order` ascending, and
finally dedupes by id keeping the first. This plugin therefore registers
`{ id: 'activity', order: 0, priority: -1 }` and shadows the official reading. Labels, structure
and styles are copied item by item from the official build (equivalents of `.hNGZaa_*` /
`.xXe6ja_*`), **plus one row**. `test/rolling.test.mjs` carries a "labels match the official
dictionary verbatim" sentinel, so a DSH change to those strings fails the test first.

**How the 30-second figure is computed**: by **sampling the official `sessionStats` projection**
and taking a difference of its cumulative counters:

```
last-30s speed = (decodeTokens at the newest sample - decodeTokens 30s earlier)
               ÷ ((decodeMs at the newest sample - decodeMs 30s earlier) / 1000)
```

- Identical definition to the official "Tokens per second (TPS)" row — only the range is narrowed —
  so the two numbers are directly comparable.
- The projection only changes when a step settles, so one sample is recorded per settled step;
  **unchanged projection means no sample and no recompute** (no timers, zero cost while idle).
- When no rate can be computed (Δdecode-ms is 0) the **previous valid reading is kept**; on a cold
  start with no samples at all it falls back to the whole-session rate (the same number as the
  official row) until the next step settles.
- Each session's samples and last reading are persisted in `localStorage`
  (`dsh-recent-tps:v1`, at most 24 sessions), so **a page refresh keeps the value**.

> Why not read per-step decode intervals from the Chat nodes: a node's
> `timing.firstTokenTime` only comes from **transient** `assistant/live-chunk` frames (plus the
> current attempt's baseline on reconnect). When a session is replayed from disk (page refresh,
> opening a historical session) those transient events do not exist, every node's
> `firstTokenTime` is `null`, and such a computation would only ever yield `—`.

**Data sources** are all standard injection faces of the slot — no private APIs, no other plugin's
DOM:

| Source | Used for |
|---|---|
| `useProjection('sessionStats')` | the four official rows plus the 30-second samples (with a `useChat` fold as fallback for missing fields) |
| `useChat(s => s.legacy.nodes)` | only folds the whole-session stats when the projection is unavailable |
| the standard `sessionId` prop | keeps sampling history per session |
| `configForms` → `ui-chat.performanceUsage` | read-only detail level, so "compact shows speed only" stays intact |

## Notes

- The 30-second speed is computed from **settled** steps: the step currently streaming has not
  settled yet, so the reading lags by at most one step (the official whole-session reading lags the
  same way); conversely, it cannot drift while nothing new settles.
- No timers at all: a sample is recorded and the value recomputed only when the projection changes,
  so idle costs nothing.
- Readings live in browser `localStorage` (`dsh-recent-tps:v1`, one entry per session, at most 24).
  On a different browser or after clearing storage, the first open shows the whole-session rate
  until the next settled step, then switches to the windowed value.
- The override point depends on the official `conversation.composer.dock` id / order contract. If
  that contract changes, the plugin degrades to a no-op (the official reading stays untouched)
  instead of breaking the composer.
- On a host without `configForms` (older DSH) the plugin does not mount at all, leaving the
  official reading as it was.

## Tests

```powershell
cd dsh-recent-tps
npm test
```

## License

[MIT](../LICENSE)
