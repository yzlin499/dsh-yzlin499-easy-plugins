# dsh-svn-manager

Adds an SVN working-copy manager to [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) for the current conversation workspace.

## Purpose

- View conflicts, committable changes, and unversioned files
- Run `svn add` for unversioned paths
- Run `svn revert` after explicit confirmation
- Commit the working copy with a log message
- Run `svn update` after explicit confirmation
- Browse paginated SVN history and search the loaded entries
- Collapse the Conflicts, Changes, Unversioned, and History sections independently
- Open working-copy and revision diffs in dedicated sidebar tabs
- Open changed files in the better-sidebar editor

SVN has no Git staging index. The UI therefore uses truthful SVN groups: Conflicts, Changes to commit, and Unversioned.

## Installation

Requirements:

1. `dsh-better-sidebar >= 0.12.1`
2. An SVN CLI available through `svn --version`
3. Node.js 20 or newer for DSH

No repository clone needed — run:

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-svn-manager"
```

Restart DSH Web after installing or updating the Host half, then refresh the browser.

## Usage

1. Open a session whose cwd is inside an SVN working copy.
2. Select `SVN` from the better-sidebar `+` menu.
3. Select a changed file to view its diff, or use the file button to open it in the editor.
4. Use the `+` action to schedule an unversioned path for addition.
5. Enter a log message and commit all scheduled and modified content under the current session cwd.
6. Revert and update operations show a confirmation dialog before changing files.
7. Each session refreshes automatically on first open only; later session switches reuse cached data until manual refresh or a mutation.

Authentication uses the existing SVN auth cache, certificate configuration, and OS credentials. The plugin never stores usernames, passwords, or certificate trust. Network commands use `--non-interactive`; complete initial authentication or certificate acceptance in a terminal first.

## How it works

The Host half spawns the system `svn` executable with an argument array and never invokes a shell:

- `svn info/status/log --xml` supplies structured data
- `svn diff --git --show-copies-as-adds` supplies unified patches
- JSON endpoints live under `/svn-manager/api/*`
- status, log, diff, commit, and update are scoped to the current session cwd; the working-copy root is used only as a path safety boundary
- every file target must remain inside the working-copy root returned by `svn info`
- routes use Host/Origin trust checks and mutations require JSON POST requests
- subprocess output and runtime are bounded

The Client half injects `betterSidebar` and registers:

- `dsh-svn-manager`: the single-instance SVN manager tab
- `dsh-svn-manager:diff`: a hidden diff tab opened from changes and history
- Client state and recent history are cached by sessionId, avoiding repeat automatic refreshes when switching sessions
- History search covers the currently loaded batches; Load more expands the search range

Cordis owns all tab registrations and injected styles, so plugin disable and HMR clean them up.

## Known limitations

- No `svn switch`, reverse merge, lock management, or automatic conflict resolution
- Externals are not recursively committed
- The plugin does not store credentials or show interactive password prompts
- SVN patches use the plugin's own unified diff surface; the built-in diff component is Git-specific
- Commit targets the current session cwd subtree rather than a checked path subset

## License

MIT
