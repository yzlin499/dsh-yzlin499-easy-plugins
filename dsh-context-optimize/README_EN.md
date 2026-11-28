# dsh-context-optimize — Context Optimize mode

Adds a new **agent mode** (preset) to DSH: `上下文优化` / Context Optimize. It inherits
every plugin of the shipped `standard` preset and replaces only the **compaction
backend**: instead of an eight-section prose summary, an earlier span of history is
folded into a **single card**.

> Status: **v0.1 preview**. This release ships the card-shaped backend plus a fold
> admission gate. The `ask` / `expand` retrieval tools land in v0.2, so cards do
> **not** advertise "ask me" yet — promising a tool that does not exist teaches the
> model to call it.

## Why

The official backend (`@deepseek-ai/dsh-compaction-basic`) replaces the oldest
balanced span with a model-written eight-section summary. It is solid, but:

1. the summary is prose — the model can read it, not navigate it;
2. the trigger is water-level only, so work is folded either too early or too late.

This mode instead:

- **renders a card** with a fixed skeleton (what happened / original request / files /
  commands / errors / still open / dead ends), so the model can skim it;
- **asks a low-effort "cruise" call** for the one-line claim, the conclusions and the
  open items, while files, commands and errors are **extracted deterministically by code**;
- **gates folding**: the first fold always passes, later folds require another N tool
  steps (default 6), so the agent cannot fold after every single step.

## Install

**Desktop client** (the app manages its own profile; the CLI refuses `--dump-config` there):
open the Plugins page and install through the plugin manager, using either the absolute path of
this directory (local development) or the GitHub subdirectory spec:

```
github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-context-optimize
```

**dsh web** (`--profile web` applies to the web profile only):

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-context-optimize"
```

Restart DSH; the mode picker then offers **上下文优化**.

## Usage

1. Start a session and switch to the **上下文优化** mode.
2. Work as usual. Under token pressure, older task spans are folded into a card.
3. `/compact` still works — it drives the same backend.

## UI: context outline axis

A slim row appears in the composer dock: **one cell per turn**, dark cells mark turns inside a folded
span, and the right side shows "N spans folded · X tok" plus the turn count. Hover for the legend.

- Data comes only from the sanctioned slot surface: `useProjection('sessionStats')` for turns and the
  `useChat` node stream for fold points.
- **No occupancy percentage**: the client cannot see `contextWindow` or live pressure (those live on
  the host `tokenMeter`), so we show nothing rather than invent a number.
- Unknown folded token counts render as `—` for the same reason.
- The client half does not hot-reload unless `pnpm run dev:web` is running — **refresh the page** after
  installing or changing it.

## How it works

```
agent/pre-step ──> official pressure check (default W×0.8)
                     │
                     ├─ admission gate: ≥6 tool steps since the last fold? (first fold always)
                     ├─ range selection (official: oldest balanced span; node 0 is never shadowed)
                     ├─ cruise call (low effort) → claim + open items
                     └─ deterministic extraction (files / commands / errors) + template → card
                          → `compaction/summary` + one replacing user/message
```

- **Inherit, do not rewrite**: transactions, `compaction/start|summary|end` locking,
  tool-pair balancing and the checkpoint source all come from the official
  `BasicCompactionEngine`; only `compactIfNeeded` (admission) and `summarize` (card) are overridden.
- **Same event vocabulary**: it still writes `compaction/*`, so `/compact`, the context
  panel and `toolResultPruner` keep working.
- **Fail soft**: if the cruise call fails, aborts or truncates, the card falls back to
  the deterministic body without a claim — a card always renders.

## Configuration

On the `context-optimize-compaction` row in `cordis.patch.yml`:

| Field | Default | Meaning |
|---|---|---|
| `minToolStepsBetweenFolds` | `6` | Tool steps required between folds; `0` disables the gate |
| `cruiseProvider` / `cruiseModel` | `''` | Route used to write the card; empty follows the routed request |
| `maxTokens` | `2000` | Card output cap (a card is far smaller) |
| `locale` | `zh` | Card language: `zh` / `en` |
| `retrievalTools` | `false` | Turn on once `ask` / `expand` exist (v0.2); adds the "Retrieve" section |

Thresholds and retention (`thresholdRatio`, `retainRatio`, …) keep the official
defaults and are not exposed by this package yet.

## Known limits

- No `fold` / `ask` / `expand` tools yet: folding is pressure-driven, and reading the
  original text is left to the official session log / `session_query` facilities.
- Range selection is still the official "oldest balanced span", not episode boundaries;
  episode selection needs precise surface-event iteration and is scheduled for v0.2.
- The "dead ends" section is derived from error lines by code and is not exhaustive.

## Roadmap

- **v0.2**: `ask` + `expand` tools; archive index (L1: shadowedSeqs + hash) and spill
  full-text補漏 (L2).
- **v0.3**: episode-based range selection and cruise suggestions (advice only).
- **v0.4**: fork-based A/B replay of "folded vs unfolded" on the same questions.

## Design notes

- [设计-分层折叠与巡航.md](../Docs/context-optimize/设计-分层折叠与巡航.md) (Chinese)
- [调研-官方上下文机制.md](../Docs/context-optimize/调研-官方上下文机制.md) (Chinese)

## License

MIT
