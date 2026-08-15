# dsh-yzlin499-plugins-manager

DSH plugin manager: enable/disable plugins in this collection from **Settings → Plugin Manager**.

## Screenshot

![Screenshot](screenshot.png)

## Features

- Auto-scans the manager's parent folder (the collection root) for every
  directory containing `cordis.patch.yml`
- Shows each plugin's enabled state (source of truth: the `dsh.profile.bundles`
  mount list)
- One-click enable/disable via `dsh plugin add/remove`; batch toggles then
  restart once to apply
- Detail popup shows the plugin README (`README.md` for Chinese UI;
  `README_EN.md` preferred for English UI)
- Target profile defaults to `web`, editable in the panel (in-memory)

## Boundaries

- **Manages only plugins inside this collection** — never touches plugins
  installed elsewhere
- The manager itself cannot be disabled (prevents locking yourself out)
- Stale-link self-healing: leftover links from an old project are removed and
  re-installed from the current collection path

## Install

```powershell
dsh plugin --profile web add ./dsh-yzlin499-plugins-manager
```

Restart DSH Web, then open Settings → Plugin Manager.

## License

MIT
