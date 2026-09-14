# dsh-version-control

A unified version-control plugin for DSH. It supports both Git and SVN in the official `ui-sidebar-right` sidebar.

## Purpose

- Detect a Git repository or SVN working copy for the current session workspace
- Switch between Git and SVN from one Version Control page
- View repository details, changes, conflicts, and untracked or unversioned files
- Browse history and unified diffs
- Git: stage, commit, update (`pull --ff-only`), and push
- SVN: add, commit, update, and revert
- Open changed files through the official file-resource page
- Detect Windows `svn.exe` from WSL and translate paths when needed

SVN has no Git staging index, so the SVN view does not invent staged/unstaged states. The providers share the page structure, while their operations retain their native semantics.

## Installation

Requires DSH `0.1.5-rc.1` or newer, the official `ui-sidebar-right` package, and the `git` and/or `svn` command-line client available on the system.

Install directly from GitHub without cloning the repository:

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-version-control"
```

Restart DSH Web after installation or an update, then refresh the browser.

## Usage

1. Open a session whose cwd is inside a Git repository or SVN working copy.
2. Choose Version Control from the add-page entry in the official right sidebar.
3. The page detects the backend on first open; you can also switch Git / SVN manually at the top.
4. Select a changed file to view its diff. The file action opens it through the official `dsh-resource://file` page.
5. For Git, click Stage on an untracked file. Commit adds the current workspace changes to the commit.
6. For SVN, click Add on an unversioned file. Revert, update, and commit require confirmation.
7. Git Update runs `git pull --ff-only`; Push runs `git push`.
8. The plugin settings page contains an SVN executable card. Leave it empty for automatic detection.

Authentication uses the existing local Git / SVN credentials, configuration, and credential helpers. The plugin does not store accounts, passwords, or certificate trust decisions.

## How it works

The Host half runs the Git / SVN CLI for the session cwd, normalizes repository details, changes, history, and diffs, and exposes same-origin JSON routes under `/version-control/api/*`. Mutations use per-repository serialization, explicit confirmation, timeouts, and output limits.

The Client half uses the public extension contract of official `ui-sidebar-right`:

- `ctx.sidebarRightTabs.register` registers `version-control` and `version-control-diff` page types
- `sidebar.right.pane.tab` keyed slots register the page bodies
- `tab.actions.openTab` opens diff pages
- `tab.actions.openResource` opens official file-resource pages
- `settings.plugin.item` registers the SVN executable settings card

The Git backend uses `git status --porcelain=v1 --branch`, `git diff HEAD`, `git log`, `git add`, `git restore`, `git commit`, `git pull --ff-only`, and `git push`. The SVN backend keeps XML output, working-copy boundary checks, and WSL path translation.

## Known limitations

- Git history currently loads the latest 20 entries without pagination
- Git has no dedicated branch switcher, remote manager, or merge-conflict UI yet
- Git commits run `git add -A` for the current session workspace; per-file commit selection is not available yet
- SVN commits target the current session cwd subtree; per-file commit selection is not available yet
- SVN switch, reverse merge, lock management, and automatic conflict resolution are not implemented
- Git / SVN authentication must be completed locally; the plugin does not show interactive credential prompts

## License

MIT
