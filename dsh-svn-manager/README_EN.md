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
2. An SVN CLI:
   - Windows / native Linux: `svn --version` must work in a terminal
   - **WSL (Windows Subsystem for Linux)**: no Linux `svn` install needed — the plugin
     automatically falls back to the Windows `svn.exe` (TortoiseSVN, SlikSvn, etc.,
     executed through WSL interop); a manual executable can also be set in the plugin settings
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
8. The plugin settings page (Plugins → SVN card) shows the detected SVN executable and lets you
   override it manually (leave empty for auto-detection).

Authentication uses the existing SVN auth cache, certificate configuration, and OS credentials. The plugin never stores usernames, passwords, or certificate trust. Network commands use `--non-interactive`; complete initial authentication or certificate acceptance in a terminal first.

## How it works (WSL support)

The Host half no longer hardcodes `svn`. It resolves the executable in order and caches the result:

1. The `svnExecutable` setting (empty = auto-detect)
2. `svn` → `svn.exe` → common TortoiseSVN / SlikSvn install paths (`/mnt/c/Program Files/…`)
3. Probed with `<executable> --version --quiet`; the first runnable one wins

Key point: **the Windows SVN CLI only understands Windows paths**. WSL interop translates
only the spawned child's cwd; absolute Linux paths in argv are passed through verbatim. When
`svn.exe` is in use, the plugin converts every absolute path argument to `C:\...` form
(`/mnt/c/...` → `C:\...`, distro-internal paths → `\\wsl$\<distro>\...`) and converts the
Windows paths in the returned XML back to Linux paths, keeping the UI, path-safety checks,
and the session cwd consistent. No conversion happens on native Windows or Linux.

The rest is unchanged:

- `svn info/status/log --xml` supplies structured data
- `svn diff --git --show-copies-as-adds` supplies unified patches
- JSON endpoints live under `/svn-manager/api/*`; settings are read/written via `/svn-manager/config`
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
- Under WSL with the Windows SVN CLI, paths in the free-text output of commit / update / diff
  remain Windows-style; structured lists (status / info / log) are fully converted back to Linux paths

## License

MIT
