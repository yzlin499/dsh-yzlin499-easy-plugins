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

> Or enable it quickly from the **dsh-yzlin499-plugins-manager** Plugin Manager card (Settings → Plugins).

## Usage

Open any session in a workspace → an "Open as" button appears top-right (left
of the session-log button) → pick: **pwsh** (new PowerShell 7 window), **cmd**
(new Command Prompt window), **Explorer** (File Explorer window), **vscode**
(VS Code opens the directory).

The target directory is the current session's workspace root (`SessionHeader.cwd`);
an error is shown when the session has no workspace.

## How it works

- **Client** (`client.js`): registers into the `conversation.session.header.utilities`
  slot (right-aligned session utilities, `order: -10`, left of the session-log
  button); button + dropdown menu, picking an item POSTs `/workspace-open/open`.
- **Host** (`index.js`): `/workspace-open/open` launches the app at the session
  cwd — Explorer via direct spawn; pwsh/cmd via `cmd /c start` for a new window;
  VS Code resolves `Code.exe` first (`%LOCALAPPDATA%\Programs\Microsoft VS Code`
  etc.), falling back to the `code` command.

## License

MIT
