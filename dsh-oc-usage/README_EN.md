# dsh-oc-usage

DSH plugin: **OpenCode (opencode.ai Go subscription) usage floating window**.

A draggable floating window in the top-right corner showing 5h / 7d / 30d usage
percentages plus reset countdown, auto-refreshing every 5 minutes.

## Install

```powershell
dsh plugin --profile web add ./dsh-oc-usage
```

Restart DSH Web to activate.

## Usage

1. Click ⚙ on the floating window and paste the full Cookie from opencode.ai
   (must contain `auth=`).
2. Workspace ID can be left empty (auto-discovered) or filled in manually as `wrk_…`.

> The Cookie lives only in the DSH process memory — never written to disk, never echoed back.

## How it works

- **Host** (`index.js`): Node global `fetch` talks to `opencode.ai/_server`
  (server-fn serialized text; rolling/weekly/monthly usage parsed by regex),
  registering `/oc-usage/*` webServer routes.
- **Client** (`client.js`): registers into the `shell.overlay` Slot and calls the
  same-origin `/oc-usage/*` routes.

## License

MIT
