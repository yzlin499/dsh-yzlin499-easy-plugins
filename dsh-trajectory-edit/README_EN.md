# dsh-trajectory-edit

English | [简体中文](README.md)

> Right-click any record in the **trajectory panel** to **edit** its text or **automatically clean up** degenerate repetition.

## Why

A model can collapse into a loop — the same sentence repeated hundreds or thousands of times inside one reasoning block, burning context and log space. Once that lands on disk, DSH's compaction only *hides* it, and a message that owns tool calls cannot be shadowed at all (it would orphan the tool results).

This plugin operates on the log itself: it rewrites only the text inside one record, leaving the event structure, `seq`, `turn`/`step` and tool-call pairing untouched. Every write is backed up, re-read and verified, and rolls back on failure.

## Install

```bash
dsh plugin --profile desktop add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-trajectory-edit"
```

Or add the package to the profile's bundle list / insert a `name: 'dsh-trajectory-edit'` row in `~/.dsh/profiles/<profile>/cordis.patch.yml`. Restart DSH afterwards.

## Usage

1. Open a session and switch to the **Trajectory** tab.
2. Any of three entry points:
   - **Right-click** any record;
   - or focus a record and press **Shift+F10** (or the Menu key);
   - or **click** a record — an "Edit record" button appears at the bottom right.
3. Two entries:
   - **Edit** — opens a dialog with the record's text (assistant reasoning/message, user message); saving writes the log.
   - **Clean up** — submenu with **This record** (default) or **Entire session**; shows a preview first, then writes on confirm.
4. After a successful write the dialog shows the backup path and the reminder: **restart DSH (or reopen the session) for it to take effect**.

Tool records (`tool/call` / `tool/result`) are not editable; collapsed-summary rows and request-only rows are skipped.

### Troubleshooting

If right-click does nothing, run `window.__TRAJECTORY_EDIT__` in the console:

- empty / `undefined` → the client half did not load (plugin disabled or DSH not restarted);
- `phase: 'no-contextMenus'` → the official context-menu service is missing;
- `skips` lists why each gesture was skipped (`no-row` / `timeline` / `no-session-id` / `summary-or-boundary` …).

## Cleaning rules

| Rule | Condition | Action |
|---|---|---|
| Period | a 1–12 line period repeated ≥ 4 times | keep one period + `[… 已折叠 N 行重复 …]` |
| Short repeats | trimmed ≤ 30 chars and appears ≥ 3 times | keep the first 2, drop the rest |
| Garbage | NUL / U+FFFD / zero-width / lone surrogates | drop |
| Oversized | one block > 32K chars | keep 40% head + 20% tail + marker |

The rules are conservative: they only fold exact short-line repeats and whole periods, and never rewrite, reorder or summarize unique text. Cleaning the same record twice is **idempotent** (the second pass changes nothing).

Measured on a 1583-event, 1.70 MiB session: **-15.3% (-260 KiB)**, 160 records cleaned, reasoning text roughly halved.

## How it works

```
browser (client.js)                      host (index.js)
  document capture 'contextmenu'
    → tr[data-trajectory-row-key]
    → decode assistant\0turn\0step
             / kind\0call\0callId
             / kind\0seq\0seq
    → contextMenus.open(target)  ──POST /api/trajectory-edit/apply──▶
                                          decode zstd frame by frame
                                          → locate the event
                                          → rewrite only content[i].text
                                            (and both stream copies)
                                          → recompress only changed frames
                                          → backup → atomic replace → verify
```

- **Frame-scoped rewrite**: the log is 823 concatenated Zstandard frames (the first holds only the header). Only frames containing the edited event are recompressed; every other frame keeps its original bytes.
- **Three copies in sync**: an assistant message stores its text three times (`message.content`, `stream[].*-chunks.texts`, `stream[].chunk.block-end.block.text`). Editing one copy makes DSH's strictest verifier and its token accounting disagree, so all three are rewritten together.
- **Safety invariants**: event count, `seq`, `turn`/`step`, `surfaceOp`, `usage`, tool-call pairing and the header never change; the post-write re-read asserts that only text paths differ.
- **Rollback**: `session.v4.jsonl.zstd.bak-<timestamp>` is written first; a failed post-write verification restores it automatically.
- **Refusals**: an unfinished turn (409), an invalid session id, or a missing log.

## Limitations

- **Restart/reopen is required**: DSH reads sessions live-first, so the in-memory context stays stale until the session is reloaded.
- Tool records are not editable (it would break tool-call pairing).
- Cleaning only touches text; it never deletes events. To prune whole turns, use a plugin such as `dsh-turn-sieve`.
- Two DSH internal surfaces are relied on: the `data-trajectory-row-key` encoding and the `assistant/message.data.stream` three-copy structure. `npm run check` is the upgrade sentinel — it fails before anything can silently corrupt a log.
- Backup files never match the canonical log name, but clean them up periodically.

## Development

```bash
node --test "test/*.test.mjs"   # 27 tests
npm run check                   # static sentinel against app.asar
node scripts/clean-session.mjs <sessionId|logPath> [--record <rowKey>] [--apply]
```

## License

MIT
