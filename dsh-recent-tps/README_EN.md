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
the **same formula** with the range narrowed to the last 30 seconds — it follows generation while
the model is writing, and decays to `—` once nothing has been decoding for 30 seconds.

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
- When the window holds no settled decode time yet, it shows `—` instead of inventing a number.

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

**How the 30-second figure is computed**: take every settled step's decode interval
`[firstTokenTime, completedTime]`, intersect it with `[now-30s, now]`, apportion tokens by the
overlap, then divide by the decode milliseconds inside the window:

```
window speed = Σ(overlapping tokens) ÷ Σ(overlapping milliseconds) × 1000
```

Identical definition to the official whole-session speed (with the window set to the whole session
the two are equal).

**Data sources** are all standard injection faces of the slot — no private APIs, no other plugin's
DOM:

| Source | Used for |
|---|---|
| `useProjection('sessionStats')` | official whole-session stats (turns/steps/times/tokens), with a `useChat` fold as fallback |
| `useChat(s => s.legacy.nodes)` | settled steps' timing / usage, for the 30-second window |
| `configForms` → `ui-chat.performanceUsage` | read-only detail level, so "compact shows speed only" stays intact |

## Notes

- The 30-second window is computed from **settled** steps: the step currently streaming has not
  settled yet, so the reading lags by at most one step (the official whole-session reading lags the
  same way).
- Recomputed once per second while the panel is open; no timer runs while it is closed.
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
