# dsh-quick-file

Adds an Everything-backed provider to DSH's official native `@` file search.

This plugin does not register a second `@` menu or replace the official input UI. It replaces the official local file-reference provider, so native file/session candidates, directory drilling, icons, mention formatting, and keyboard behavior remain unchanged.

## Installation

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-quick-file"
```

Requires DSH `0.1.5-rc.1` or newer and an accessible Everything HTTP Server. Restart DSH Web after installation.

## Usage

1. Enable the Everything HTTP Server. The default address is `http://127.0.0.1:8074`.
2. Type `@` in the DSH input box and use the official native file candidate menu.
3. When a keyword is present, candidates are searched by Everything inside the current session workspace.
4. Directory queries such as `@src/` keep the official directory-drilling behavior.
5. If Everything is unavailable or the request fails, the official bounded local scan is used automatically.
6. Selected files keep the official mention format; the model still reads file contents through the `read` tool.

## Configuration (Settings → Plugins → Quick File Search)

| Item | Description |
|---|---|
| Everything HTTP | Everything HTTP Server address, default `http://127.0.0.1:8074`; leave empty to use the official local scan |
| Ignore dirs | Comma-separated directory basenames; defaults omit `node_modules`, `.git`, `dist`, `build`, and similar directories |
| Max candidates | Maximum candidates returned by Everything and the fallback search, 1-200 |
| Local index limit | Maximum entries in the official fallback index, 1-200000 |

Every Everything query includes a `path:` restriction for the current Session workspace, and results are checked again before returning to ensure they remain inside that workspace. Ignore directories apply both to the Everything query and to result filtering.

## How it works

The official native `@` chain is:

```text
ui-reference
  → remote.fileReferences.list
  → dsh-api-session-controller
  → ctx.fileReferences.list
  → dsh-quick-file Provider
```

`cordis.patch.yml` disables the official `file-reference-local` row and inserts this Provider. The Host Provider implements the official `ctx.fileReferences.list` contract, keeps the official file-reference guidance, sends keyword queries to Everything first, and falls back to a bounded local scan on failure.

The Provider returns the official `{ path, kind: 'file' | 'directory' }` candidate shape and does not render the browser menu. The Client half only registers the settings card; it does not register another `inputTriggers` source.

## Known limitations

- Everything HTTP Server must be reachable from the DSH Host environment; WSL and Windows reachability depends on the local network setup.
- Everything's index permissions do not bypass DSH filesystem permissions; returned paths remain workspace-filtered.
- Empty-query root listing uses the official local directory listing; keyword queries use Everything.
- Everything failures silently fall back to the official scan and do not disable the native `@` menu.

## License

MIT
