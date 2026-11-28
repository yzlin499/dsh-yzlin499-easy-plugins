# dsh-context-optimize — Context Optimize mode

Adds a new **agent mode** (preset) to DSH: `上下文优化` / Context Optimize. It inherits
every plugin of the shipped `standard` preset and replaces only the **compaction
backend**: instead of an eight-section prose summary, an earlier span of history is
folded into a **single card**.

> Status: **v0.2**. Ships the card-shaped compaction backend, a fold admission gate,
> three agent tools (`fold_context`, `ask_folded`, `expand_folded`) backed by a local
> archive, and a sidebar page. In-place restore of a folded span is v0.3.

## Why

The official backend (`@deepseek-ai/dsh-compaction-basic`) replaces the oldest
balanced span with a model-written eight-section summary. It is solid, but:

1. the summary is prose — the model can read it, not navigate it;
2. the trigger is water-level only, so work is folded either too early or too late.

This mode instead:

- **renders a card** with a fixed skeleton (what happened / original request / files /
  commands / errors / still open / dead ends), so the model can skim it;
- **archives the original span** (memory + `~/.dsh/storages/context-optimize/spans/…`)
  so the agent can ask about it or read it back;
- **asks a low-effort "cruise" call** for the one-line claim, the conclusions and the
  open items, while files, commands and errors are **extracted deterministically by code**;
- **gates folding**: the first fold always passes, later folds require another N tool
  steps (default 6).

## Agent tools

| Tool | What it does | When |
|---|---|---|
| `fold_context` | Queue a fold of the oldest span (applies **next step**) | after many consecutive tool calls, when context has grown |
| `ask_folded` | Ask a folded span a question → answer / confidence / what it still needs | **first choice**: cheap, keeps the raw text out of the context |
| `expand_folded` | Read back the archived text (`offset`/`limit` paging) | fallback when asking fails |

`ask_folded` feeds only the card plus keyword-picked archive excerpts to one low-effort
call. `expand_folded` returns the text **into the tool result** — in-place restore needs a
verified Session append/replace path and is scheduled for v0.3.

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

## UI: sidebar "Context outline" page

The plugin adds **a page of its own to the sidebar** (registered through
`dsh-better-sidebar`'s `ctx.betterSidebar.registerTab`, the same API its built-in pages use):

- a summary line: `N spans folded · X tok · Y nodes`;
- a vertical axis, one node per fold: `48.2K tok · 546 nodes · 20:31`, tagged with the trigger
  (pressure / overflow recovery);
- a gate countdown: `N more tool steps before the next fold`, or `foldable now (N tool steps)`.

Data comes from this plugin's host half: `GET /context-optimize/outline?session=<id>` — the fold
history the backend itself recorded (`CompactionResult.shadowedTokenCount` / `shadowedSeqs`), not a
client-side guess. Unknown values render as `—`.

- The page **checks the session's mode first**: only the Context Optimize mode shows an outline; other
  modes show a single `Mode: standard` line plus one sentence (the host reads `agentPreset` from the
  session header and treats a missing value as non-optimize).
- Without `dsh-better-sidebar` the page is not mounted at all (the composer-dock fallback is gone).
- the client half does not hot-reload unless `pnpm run dev:web` is running — **refresh the page**.

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
