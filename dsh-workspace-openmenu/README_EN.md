# dsh-workspace-openmenu

DSH plugin: **workspace quick-open menu**. Adds an "Open as" button to the
session header top-right (left of the session-log button) with a submenu to
open the workspace location in: **pwsh / cmd / Explorer / VS Code**.

## Screenshot

![Screenshot](screenshot.png)

## Install

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-workspace-openmenu"
```

Restart DSH Web to activate.

## Usage

Open any session in a workspace → an "Open as" button appears top-right (left
of the session-log button) → pick: **pwsh** (new PowerShell 7 window), **cmd**
(new Command Prompt window), **Explorer** (File Explorer window), **vscode**
(VS Code opens the directory).

The target directory is the current session's workspace root (`SessionHeader.cwd`);
an error is shown when the session has no workspace.

## Cross-platform: Windows / WSL / Linux

- **Windows (native)**: Explorer via direct spawn; pwsh/cmd open a new window
  through `cmd /c start`; VS Code resolves `Code.exe` first, falling back to the
  `code` command.
- **WSL (recommended)**: the Host auto-detects WSL, converts the workspace Linux
  path to a Windows path via `wslpath -w` (`D:\...` or `\\wsl.localhost\...`),
  then launches Windows-side apps through WSL interop — Explorer opens the mapped
  folder directly; cmd opens a new Command Prompt window (`pushd` handles UNC
  paths); pwsh prefers Windows PowerShell 7 (`pwsh.exe`) in a new window, falling
  back to Linux pwsh (terminal emulator); vscode prefers the Linux `code` CLI
  (connects to the Windows VS Code), falling back to Windows `Code.exe`. Clear
  errors are returned when path conversion or interop fails.
- **Native Linux (best effort)**: explorer → `xdg-open`; cmd/pwsh → a terminal
  emulator (gnome-terminal / konsole / kitty …, first one found); vscode → `code`.

## How it works

- **Client** (`client.js`): registers into the `conversation.session.header.utilities`
  slot (right-aligned session utilities, `order: -10`, left of the session-log
  button); button + dropdown menu, picking an item POSTs `/workspace-open/open`.
- **Host** (`index.js`): `/workspace-open/open` picks a launch strategy from the
  session cwd and the running platform — native launch on Windows; `wslpath -w`
  conversion plus WSL interop on WSL; xdg-open / terminal emulator / code on
  plain Linux. Early spawn failures (missing executables, interop disabled) are
  detected and reported quickly.

## License

MIT
