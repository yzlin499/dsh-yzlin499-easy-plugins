# dsh-yzlin499-plugins-manager

DSH plugin manager: manage plugins from the default collection and custom directories in the **Plugin Manager** card under **Settings → Plugins**.

## Screenshot

![Screenshot](screenshot.png)

## Features

- Auto-scans the manager's parent folder (the default collection root) for every
  directory containing `cordis.patch.yml`
- Adds and removes custom collection roots from the settings card, so plugins in
  other locations can be managed together
- Persists custom roots and the target profile through official settings in
  `~/.dsh/settings.yaml`
- Shows each plugin's enabled state (source of truth: the `dsh.profile.bundles`
  mount list)
- One-click enable/disable via `dsh plugin add/remove`; batch toggles then
  restart once to apply
- Detail popup shows the plugin README (`README.md` for Chinese UI;
  English UI prefers `README_EN.md`, falls back to `README.md`, then uses
  `package.json.description` when neither file exists)
- Target profile defaults to `web`, editable and persisted from the panel

## Boundaries

- **Manages only the default collection and collection roots explicitly added by
  the user**; it does not scan anywhere else
- Custom paths must be existing absolute directories; each root scans only its
  direct child folders containing `cordis.patch.yml`
- Duplicate `package.json.name` values across collections are marked as name
  conflicts and cannot be toggled, preventing removal of the wrong source
- Removing a custom root from the manager does not uninstall plugins already
  enabled from that root
- The manager itself cannot be disabled (prevents locking yourself out)
- Stale-link self-healing: leftover links from an old project are removed and
  re-installed from the current collection path

## Install

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-yzlin499-plugins-manager"
```

Restart DSH Web, then open Settings → Plugin Manager.

## License

MIT
