# dsh-mcp-compat

DSH plugin: **standard MCP config compatibility**. Automatically reads the MCP
config files of mainstream agents and mounts every MCP server as an
`@deepseek-ai/dsh-mcp-client` instance; tools appear as `mcp__<name>__*`.

## Install

```powershell
dsh plugin --profile web add "github:yzlin499/dsh-yzlin499-easy-plugins#path:/dsh-mcp-compat"
```

Restart DSH Web to activate.

## Supported config sources (priority order, first match wins; project + user level)

- `.mcp.json` — Claude Code / Codex / Cursor convention (`mcpServers`; stdio / Streamable HTTP)
- `opencode.json` / `opencode.jsonc` — opencode convention (`mcp` key, command array / url / enabled)
- `.cursor/mcp.json` — Cursor convention (same `mcpServers`)
- `.codex/config.toml` — Codex convention (`[mcp_servers.<name>]`)
- User home: `~/.mcp.json`, `~/.codex/config.toml`, `~/.config/opencode/opencode.json`

## Usage

Drop any of the config files above into a workspace root (or the user home) and
it takes effect automatically — no DSH configuration needed. Project-level MCP
tools are visible only to agents whose `cwd` belongs to that workspace, while
user-level MCP tools remain shared globally. Project stdio servers start with the
workspace root as their working directory. Config file changes (`fs.watch`) or
new sessions (`session/created`) trigger a rescan. If a stdio server declares an
absolute command path that does not exist, the plugin logs one clear diagnostic
and skips it instead of handing it to the MCP client's reconnect loop.

### Setting: choose which config sources to scan

In Settings (Plugins → "MCP 兼容" card) you can tick which config-source
families to scan (all enabled by default): Claude (`.mcp.json`), Cursor
(`.cursor/mcp.json`), opencode, Codex (`.codex/config.toml`). Tick only the ones
you use (e.g. just Claude) to stop scanning everything. Saving re-mounts
immediately with the new selection.

When WSL is detected, the card also shows two WSL toggles (both on by default):

- **启用 WSL 兼容 (WSL compatibility)**: turn it off to disable the tunnel /
  URL-rewrite fallback entirely; servers are then connected as-configured.
- **自动配置宿主机转发 (Auto-configure host forwarding)**: when a host loopback
  port is unreachable (e.g. JetBrains listening only on `127.0.0.1`), it
  automatically runs `netsh interface portproxy` (port forwarding — **bound only
  to the host's vEthernet IP, never to `0.0.0.0` / `127.0.0.1`**) plus a firewall
  allow rule (source limited to the WSL subnet) as administrator — the first
  time shows one Windows UAC prompt; approve it. Each port is only tried once
  per session to avoid repeated prompts. The "立即配置宿主机转发" button in the
  card runs it immediately for every currently-active port. The "释放并清除转发"
  button (and **automatic on normal DSH shutdown**) deletes the rules the plugin
  created, handing the ports back to host services (e.g. UE).

The plugin only tracks and releases rules **it created**; manually added
`netsh` rules are never deleted. If an old `listenaddress=0.0.0.0` forwarding is
detected (the very thing that blocks a host service from re-binding its port —
the UE port-8000 incident), the log shows a one-time hint: delete it and the
plugin will rebuild it bound to the host vEthernet IP and track it for release.

> The official `@deepseek-ai/dsh-mcp-client` currently supports stdio and
> Streamable HTTP, not legacy SSE. Explicit `type: "sse"` entries are skipped so
> a later supported configuration with the same name can take over.

## WSL host compatibility

Under **WSL2** (default NAT networking), `localhost` / `127.0.0.1` inside WSL
point at the WSL instance itself, so MCP services running on the Windows host
(e.g. UE's MCP, JetBrains IDE MCP) are unreachable. The plugin detects WSL
automatically; when a Streamable HTTP server **fails to connect** (the watchdog
sees its tools vanish, or a manual reconnect is triggered), it applies one of
two compatibility modes:

1. **URL rewrite (preferred — least invasive)**: rewrites the loopback host to
   the **Windows host IP** and connects directly. It does not occupy any WSL
   port and does not spawn `wslrelay`, so a host service can still grab its own
   port when it restarts. Log:
   `WSL 兼容：连接 localhost 失败，启用宿主机 IP 改写: …`.
2. **Same-port transparent TCP tunnel (only when the service insists on a local
   Host header)**: when the MCP handshake probe returns **HTTP 403** (e.g.
   JetBrains IDE MCP only accepts `Host: 127.0.0.1`), the plugin automatically
   escalates to a tunnel: it listens on the same loopback port inside WSL as the
   original URL and pipes bytes verbatim to the host IP on that port, keeping
   the `Host` header `127.0.0.1`. Log:

   ```
   WSL 兼容：宿主机服务只认本机 Host（HTTP 403），升级为同端口透明隧道
   WSL 兼容：启动同端口透明隧道 127.0.0.1 64342 -> 192.168.160.1:64342（保持原始 Host 头）
   ```

The fallback only kicks in after a failure: connections that already work via
localhost (WSL1 / mirrored networking) are untouched. Once enabled, later
auto-reconnects and full rebuilds keep the mode — no flipping back and forth.

Host IP resolution priority: the `WSL_HOST_IP` environment variable (most
reliable — set it manually if needed) → the `nameserver` in `/etc/resolv.conf`
→ the default gateway in `/proc/net/route`. The settings page ("MCP 兼容" card)
shows the current WSL state: whether WSL was detected, the host IP, and which
servers are using which compatibility mode.

### Still failing?

The plugin logs a one-time diagnostic with **TCP probe + MCP handshake HTTP
status** (e.g. `TCP 可达` / `TCP 超时`, `握手: HTTP 403`). Common causes and fixes:

> With "Auto-configure host forwarding" on, the plugin first inspects the host
> listeners and tries to set up the forwarding itself (one UAC prompt); if it
> still fails the log shows `转发: failed` — then do it manually below.

1. **The service only listens on the Windows loopback (127.0.0.1)**: e.g. the
   official JetBrains IDE MCP Server, and many UE MCP plugins, bind only
   127.0.0.1. The host port must be reachable from WSL. **Important: the
   portproxy listen address must be the host's vEthernet IP (e.g.
   192.168.160.1), NOT `0.0.0.0`** — otherwise the same-port host service (e.g.
   UE's MCP) fails to bind when it restarts and can never be reached again.
   Manual steps (admin PowerShell, `<hostIp>` = the vEthernet address such as
   `192.168.160.1`):
   - Port forwarding (bind only the host vEthernet IP):
     `netsh interface portproxy add v4tov4 listenaddress=<hostIp> listenport=<port> connectaddress=127.0.0.1 connectport=<port>`
   - Firewall allow rule (source limited to the WSL subnet):
     `netsh advfirewall firewall add rule name="wsl-mcp-<port>" dir=in action=allow protocol=TCP localport=<port> remoteip=192.168.160.0/20`
   - Verify with `netsh interface portproxy show all`; update after the service
     restarts with a new port. If a rule was previously added with
     `listenaddress=0.0.0.0` and is blocking the host service, delete it:
     `netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=<port>`
   - Or WSL mirrored networking: add `[wsl2]` + `networkingMode=mirrored` to
     `%UserProfile%\.wslconfig`, then `wsl --shutdown`. localhost then reaches
     Windows loopback services directly (some environments have known mirrored
     networking issues).
   - Or bind the service to all interfaces / `0.0.0.0` (if available).
2. **Stale port**: some services (e.g. JetBrains MCP) may pick a new port on
   each start. Verify the service's current port matches the config file; if
   not, restart the service or run `/mcp-reconnect` to re-read the config.
3. **Handshake HTTP 403**: the service only accepts local Host headers (typical
   JetBrains) — the plugin auto-escalates to `同端口透明隧道`; if 403 persists
   after the tunnel is up, the forwarding rule is missing or the service is not
   running.

## Reconnection

The official client ships its own auto-reconnect (starts at 0.5s, exponential
backoff capped at 30s, max 10 attempts), but **after too many consecutive
failures it gives up**: it unregisters that server's tools and stops, logging
`giving up after N consecutive failed reconnect attempts …`. After that the only
recovery was reloading the plugin or restarting the Host. `dsh-mcp-compat` adds
two layers on top:

1. **Auto-reconnect watchdog**: every 15s it checks the mounted servers; if a
   server's tools vanish from the registry (meaning the official reconnect gave
   up), it **reconnects only that down server** (leaving healthy mounts alone),
   retrying with exponential backoff (15s → 30s → 60s → … → capped at 10 min).
   **After more than 10 consecutive failed attempts it stops automatically**
   (logs `已停止自动重连…`, no more log spam) and waits for you to start the
   service (UE, Rider, …) and pull it up manually; the counter resets once the
   server recovers.
2. **Manual reconnect**, either way (a manual reconnect resets the watchdog
   failure counter, granting up to 10 fresh auto-retries):
   - **Slash command `/mcp-reconnect`** in the chat input box: executes directly
     without going through the model, with the result shown inline.
     `/mcp-reconnect` reconnects all (re-reads config); `/mcp-reconnect <name>`
     (e.g. `/mcp-reconnect unreal`) reconnects only that one server.
   - **Model tool `mcp_reconnect`**: ask the model in any session to force a
     reconnect — it re-reads the config and rebuilds (all or a named) server
     connections immediately. Also clears the "gave up" terminal state.

For example, say "reconnect the UE MCP" to make the model call `mcp_reconnect`,
or type `/mcp-reconnect unreal` directly in the input box.

## License

MIT
