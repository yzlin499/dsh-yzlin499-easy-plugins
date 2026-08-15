# dsh-quick-file

DSH plugin: **quick file input with `@`**.

Type `@` in the input box to get a file list of the workspace; press Enter or
click to insert the file path into the input (powered by the built-in input
trigger pipeline — the input box itself is untouched).

## Screenshot

![Screenshot](screenshot.png)

## Install

```powershell
dsh plugin --profile web add ./dsh-quick-file
```

Restart DSH Web to activate.

> Or enable it quickly from the **dsh-yzlin499-plugins-manager** settings panel (Settings → Plugin Manager).

## Usage

Type `@` in the input box → a menu appears (grouped with other `@` sources) →
keep typing to filter (fuzzy match on file name / path) → pick with ↑↓/Enter or
click → the `@query` token is replaced by the file path.

## How it works

- **Client** (`client.js`): registers an `@` InputTriggerSource into the built-in
  pipeline `dsh-client-ui-input-trigger` (`ctx.inputTriggers`) — menu rendering,
  keyboard navigation and input rewriting are handled by the pipeline; this
  plugin only provides the file data source.
- **Host** (`index.js`): `/quick-file/files` route — recursively lists the
  workspace root (`SessionHeader.cwd`) via the `fs` service; depth ≤ 3, skips
  `node_modules/.git/dist` etc., max 50 entries, `/`-separated paths.

## License

MIT
