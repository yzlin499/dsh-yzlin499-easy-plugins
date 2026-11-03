# 调研：DSH 本体是否自带"远程访问 / 多设备连接"能力

> 日期：2026-10-28
> 环境：Windows 10，DSH 桌面版（`dsh 0.2.1-rc.3`），asar 路径
> `C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\app.asar`
> 当前 Web GUI：`http://127.0.0.1:65145`
>
> 本文是**带日期的快照**，只读实测 + 官方文档对照，不随代码演进回改。

## 一句话结论

**DSH 本体自带"能被远程浏览器访问"的能力，但不自带"打通网络"的能力。**

- 有：`--host` / `--port` / `--tls-cert` / `--tls-key` / `--public-url` / `--trusted-host`，
  以及完整的启动 token → 签名会话 cookie 鉴权 + Host/Origin 栅栏。
- 没有：内置隧道 / relay / 配对码 / 扫码 / 多设备同步 / SSH 远程宿主接入（GUI 方向）。
- 因此：**这件事不需要写插件，也不需要装插件**；需要的是把公司机器上的 DSH 用
  `--host` 暴露到某个可达地址，再配反向代理 / 隧道 / VPN / SSH 端口转发之一。

## 实测证据（读 asar + 跑 CLI）

asar 是 Electron 归档（未压缩，明文可搜）。用 Node 解析头信息后按 offset 提取文件。

### 1. `dsh web` 的 CLI 参数（实测 `--help`）

```text
$ dsh --profile web --help
Usage: dsh --profile web [options]

Serve the DeepSeek Harness browser UI.

Options:
  --host <host>                  bind address: one concrete IPv4 or IPv6 literal
                                 of a local interface; wildcard addresses are
                                 rejected
  --no-open                      do not open the Web UI in the default browser
  --port <port>                  listen port; pass 0 to let the OS pick a free one
  --public-url <url>             advertise this HTTP(S) root ...; grants no trust
  --trusted-host <authority...>  extra authority the /api browser-trust fence
                                 accepts (host or host:port; repeatable)
  --tls-cert <file>              PEM server certificate chain; requires --tls-key
  --tls-key <file>               unencrypted PEM private key; requires --tls-cert
```

`--help` 自带的例子直接给了局域网绑定：

```text
  dsh --profile web --host 10.0.0.7          bind one local interface address
  dsh --profile web --public-url https://app.example/ui/ --trusted-host app.example
```

源码位置（asar 内）：`dsh/node_modules/@deepseek-ai/dsh-web-app/lib/startup.js`
（同一段 option 定义，`--host` 描述含 `wildcard addresses are rejected`）。

### 2. 通配地址被**显式拒绝**（关键限制）

`@deepseek-ai/dsh-client-connection/README.zh.md`（asar 内原文）：

> 这些检查防御 DNS rebinding 与跨站浏览器请求，绝不建立身份。Host/Origin 校验失败返回 403；
> Host 可信但未认证的请求返回 401。**`dsh web --host 0.0.0.0` 不受支持。**

`reference/subsystems/web-server`（在线文档）对 `host` 字段：

> 未指定地址（IPv4 any、IPv6 any 及其 IPv4 映射形式）在加载时即被拒绝：
> 它会把这个端口一次性暴露在所有接口上。

**推论（重要）**：想给局域网用，必须写**具体网卡地址**（如 `--host 192.168.1.20`），
不能用 `0.0.0.0`。等价于"按网卡逐个开"，而不是"一把全开"。

### 3. 鉴权机制（存在，且是强制门禁）

`@deepseek-ai/dsh-client-connection/README.zh.md`：

- 每进程生成一个**随机启动 token**；`dsh-web-app` 打印并打开 `?token=...` 的 URL。
- `GET /` 接受该 token，写入**绑定 authority 的签名 cookie**，再重定向到干净的 `./`（移除 token）。
- cookie：**host-only、`Path=/`、`HttpOnly`、`SameSite=Strict`**，`cookieMaxAgeDays` 默认 **30 天**，
  签名同时绑定规范化 hostname + port；监听器是 HTTPS 时才带 `Secure`。
- 签名密钥存在 `$DSH_HOME/.credentials.yaml` 的 `client-connection/browser-session` grant 记录里。
- 缺失/过期/畸形/authority 不匹配的 cookie → **401**（在 RPC 分发之前）。
- 所有 Host RPC 方法与 WebSocket 流都要过这一关，**不存在"loopback 免检"的按方法豁免**。
- `Host/Origin` 栅栏：`Host` 必须是 loopback、或等于监听器绑定 IP 字面量（端口不限）、
  或匹配 `trustedHosts`；`Origin` 必须同 authority；`sec-fetch-site: cross-site` 一律拒绝。
  **栅栏失败 403，Host 可信但未认证 401。**
- 另有仅供 API 用的 `GET /connect?token=...&interactions=answer|none`，直接发 API cookie（302）。

**结论**：鉴权存在且有 token 保护 —— 不是裸奔。但它是**单人/单进程凭据模型**，
没有多用户账号体系、没有角色管理（`dsh-api-remote-access` 的 owner/非 owner Peer 是
进程内 RPC 访问控制，不是"多个真人用户"）。

### 4. 没有的东西（搜过，确认为无）

对 `@deepseek-ai/*` 第一方包源码（含 README、`lib/*.js`、`locale/*.json`）按词边界搜索，
并核对 150+ 个已安装包名：

| 关键词 | 结果 |
|---|---|
| `cloudflared` / `ngrok` / `tailscale` | asar 内 0 命中 |
| `QRCode` / 扫码配对 | 仅出现在条形码格式枚举（无关库），第一方包 0 命中 |
| `pair` / `pairing` | 仅"参数配对""执行配对 id"等无关语义，无设备配对功能 |
| `tunnel` | 仅 `dsh-http-proxy` 的出站代理 tunnel、WebWorker 请求通道，无入站隧道 |
| `mobile` / `devices` | 仅账号资料字段 `mobile`、输入设备/快捷键、DevTools 文案 |
| `ssh`（第一方） | 仅"SSH 启动场景的降级处理"（见下） |

`ssh` 的真实含义（**不是**远程访问能力）：

- `dsh-host-open-in-app`：检测到 `SSH_CONNECTION`/`SSH_TTY` 时隐藏 "Open In" 菜单。
- `dsh-host-directory-picker-auto`：SSH 启动 → 退回 `browse` 目录选择器（因为摸不到 OS 弹窗）。
- `dsh-deepseek-account-platform`：浏览器登录只接受 loopback / SSH 本地转发的 HTTP origin。
- `dsh-agent-preset` 的 composition 参考里列了 `dsh-ssh` / `dsh-fs-ssh` /
  `dsh-sandbox-ssh` / `dsh-subprocess-ssh` 一族包，`files.txt` 里**命中 0** ——
  本安装未随附；且即便有，它们是"把**执行世界**（文件系统/Bash/PTY）指到远端机器"，
  是 **GUI → 远端执行**，方向与"人在家里连公司 GUI"相反，解决不了本需求。

### 5. `ctx.remote.*` / `api-remotes` / `api-remote-access` 的误报澄清

- `@deepseek-ai/dsh-api-remotes`：为**本应用**选定 Host Remote 能力提供双侧 BFF，
  把 Host 的 `@Remote` 方法经 Typert 挂到 Client。README：*"为本应用选定的 Host Remote
  能力提供双侧 BFF"*。
- `@deepseek-ai/dsh-api-remote-access`：**"非 owner Peer 的 Remote 方法级访问控制"**，
  即同一 Host 内多个 Peer（owner / 非 owner principal）能调哪些方法。
- 二者都是**浏览器 → 本地宿主进程**的 RPC 命名空间，**完全不跨机器**。不要当成远程连接能力。

### 6. 桌面版与 Web 的关系

- 桌面版 Electron 用自己的 Node 模式起一个**私有 Desktop Host**，该 Host 调共享 CLI profile runner
  与**完整 Web 应用**（官方 reference 原文：*"Electron 使用 Electron Node 模式启动私有 Desktop Host。
  Host 调用共享 CLI profile runner 与完整 Web 应用"*）。
- *"Desktop 默认监听系统分配的端口，profile 配置可覆盖。"*
- 实测本机：`Get-NetTCPConnection -LocalPort 65145` → `127.0.0.1`，
  OwningProcess 86340 = `DeepSeek Harness.exe`。**即桌面版此刻也只绑 loopback，局域网不可达。**
- 差异点：桌面版走 IPC + `file://` 加载；而 `dsh --profile web` 才是那条"给别人浏览器用"的路径。
  要做远程访问，**应该跑 `dsh --profile web`，而不是指望桌面版**（桌面版改绑定的口子在
  profile 配置，且仍受同一套 loopback 默认与通配拒绝约束）。

## 官方文档证据（在线）

| 文档 | 关键内容 | 链接 |
|---|---|---|
| HTTP 服务器子系统 | `host` 字段语义、通配地址加载即拒、TLS 配置、`isWildcardHost`/`isLoopbackHost` | [reference/subsystems/web-server](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/web-server) |
| 在反向代理之后发布 Web UI | 官方**正面支持**代理部署：代理必须做什么、`--trusted-host`、TLS 终止、cookie `Path`/`Secure` 改写 | [guide/public-deployments](https://deepseek-harness.github.io/deepseek-harness/guide/public-deployments) |
| 架构 | Desktop 与 Web 的关系、profile/bundle | [reference/](https://deepseek-harness.github.io/deepseek-harness/reference/) |
| 第一个插件 | 插件模型（`ctx` 注册能力），用于判断"要不要写插件" | [develop/basic/](https://deepseek-harness.github.io/deepseek-harness/develop/basic/) |
| web-app 包参考（源码 README） | `--host/--port/--tls-*/--public-url/--trusted-host` 全量说明 + SSH 启动行为 | [packages/bundle/web-app](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/README.zh.md#public-deployments) |
| connection 包参考 | token / cookie / Host-Origin 栅栏 / `--host 0.0.0.0` 不受支持 | [packages/client/connection](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/connection/README.zh.md) |

官方 `public-deployments` 明确承认这个场景，并**要求外部链路（TLS / 公开主机名 / 剥前缀）
由反向代理拥有**：

> `dsh --profile web` 在 loopback 端口上提供 GUI，因此其他机器上的浏览器无法访问它……
> 它前面的反向代理拥有这条外部链路。

以及一句很重要的风险提示（官方原文）：

> 无论是公告 URL 还是栅栏都不保护**监听端口本身**，因此请把端口限制在可信代理或网络内。

意思是：token/cookie 保护的是"页面与 API"，**端口本身仍是敞开的**——任何能连到该端口的人
都能发起未认证请求（会 401，但仍可被爆破/探测/占用）。

## 能力核对表

| 能力 | 是否存在 | 证据 |
|---|---|---|
| 绑定到局域网网卡（非 loopback） | ✅ 有 | `--help` 示例 `--host 10.0.0.7`；`startup.js` |
| 绑定 `0.0.0.0` / `::`（一把全开） | ❌ **明确拒绝** | connection README「`dsh web --host 0.0.0.0` 不受支持」；web-server 文档「未指定地址在加载时即被拒绝」 |
| 自定义端口 | ✅ 有 | `--port`，`0` = OS 分配 |
| 内置 TLS（自带证书） | ✅ 有 | `--tls-cert` + `--tls-key`；无 ACME / 自签名兜底 |
| 反向代理部署支持 | ✅ 有（官方文档化） | `--public-url`、`--trusted-host`、guide/public-deployments |
| 启动 token 鉴权 | ✅ 有（强制） | connection README「每个进程生成一个随机启动令牌」 |
| 签名会话 cookie（30 天） | ✅ 有（强制） | 同上，`cookieMaxAgeDays` 默认 30，host-only/HttpOnly/SameSite=Strict |
| Host/Origin 栅栏（防 DNS rebinding / CSRF） | ✅ 有（强制） | `src/api-request-trust.ts`；403 / 401 |
| 多用户账号 / 角色 | ❌ 无 | 只有 owner / 非 owner Peer（进程内 RPC 级） |
| 内置隧道（cloudflared/ngrok/frp/tailscale 类） | ❌ 无 | asar 全文 0 命中 |
| relay / 云端中转 / 配对码 / 扫码 / 移动端 | ❌ 无 | 词边界搜索第一方包 0 命中 |
| 多设备同步 / 设备列表 | ❌ 无 | 同上 |
| SSH 远程宿主（GUI 方向） | ❌ 无 | `dsh-ssh` 一族在 composition 参考里，但 `files.txt` 命中 0，本安装未随附；且方向相反 |
| `--allow-remote` / 密码登录 | ❌ 无此开关 | `--help` 全量 option 列表里没有 |

## 三条可行路线

### 路线 A：公司机器 `dsh --profile web` 绑内网网卡 + 家里走 VPN / 内网直连

```powershell
# 公司机器（拿到内网地址，例如 192.168.1.20）
dsh --profile web --no-open --host 192.168.1.20 --port 3080
```

家里机器：加入公司 VPN 后浏览器访问 `http://192.168.1.20:3080/`，
用**启动时打印的带 token 的 URL** 首登（token 只出现一次在终端，需要公司那边把 URL 转给你）。

- 前提：公司机器防火墙放行 3080/TCP 给 VPN 网段；家里能路由到该内网。
- 鉴权：✅ token + cookie。Host/Origin 栅栏对"绑定 IP 本身"是放行的，**不需要** `--trusted-host`。
- 风险：明文 HTTP（官方会警告）。token 经明文传输可被同网段嗅探；
  端口对 VPN 内所有人敞开（"栅栏不保护端口本身"）。**强烈建议叠加 TLS 或只走 VPN。**

### 路线 B：隧道（cloudflared / frp / tailscale）+ 反向代理语义

推荐给"公司机器在内网、家里没有 VPN"的场景。以 cloudflared / tailscale funnel 为例：

```powershell
dsh --profile web --no-open --host 127.0.0.1 --port 3080 `
  --public-url https://dsh.example.com/ --trusted-host dsh.example.com
# 另一个窗口
cloudflared tunnel --url http://127.0.0.1:3080
```

- 关键点：**必须同时给 `--public-url` 和 `--trusted-host`**。官方明说：
  "`--public-url` 公告不授予任何信任：浏览器可见的 authority 还必须用 `--trusted-host` 点名"，
  否则每个 API 调用都 403。
- 前提：隧道客户端能出网（不必开入站端口）；DNS / 域名（用自己的域名时）。
- 鉴权：✅ token + cookie，且外部链路是 HTTPS（token 不明文）。
- 风险：把 **DSH 整个 Host**（含 Bash 工具、文件系统、审批流）暴露到公网域名。
  cookie 有效期 30 天，泄露即长期有效。**建议隧道侧再加一层访问控制（Cloudflare Access /
  基础认证），或只在用的时候开隧道。** 官方还提醒：不带端口的 `--trusted-host` 条目匹配任意端口，
  对隧道友好但更宽松。

### 路线 C：SSH 端口转发（最省事、最安全，官方文档点名的用法）

官方 web-app README 有一节专门讲这个：

> 通过 SSH 启动 `dsh --profile web` 时，URL 行仍会打印，但不会为你打开浏览器：
> 本地转发地址由 SSH 客户端或编辑器持有。

```powershell
# 公司机器：保持默认 loopback 绑定，什么都不用改
dsh --profile web --no-open --port 3080

# 家里机器：把本地 3080 转发到公司机器的 3080
ssh -N -L 3080:127.0.0.1:3080 user@company-host
```

然后本地浏览器打开 **终端里打印的那个带 token 的 URL**（把 `127.0.0.1:3080` 换成
`127.0.0.1:3080` 即可——本来就一致；若本地端口不同，改端口后 token 仍有效，因为
cookie 绑定 hostname+port，用转发端口的 URL 首登即可）。

- 前提：公司机器有 SSH 服务（本机实测 `0.0.0.0:22` 已在监听）+ 你有账号。
- 鉴权：✅ token + cookie，**且整条链路在 SSH 里加密**，端口不暴露给任何第三方网络。
- 风险：最低。唯一注意点是**本地端口别和别的服务撞**，以及 SSH 断开会断会话（重连即可，
  cookie 还在）。

> 如果公司机器是 Windows 且没有 SSH，可开 OpenSSH Server
> （`Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0`），
> 本机 22 端口已经在监听，说明多半已就绪。

### 三条路线速查

| | 需要开放入站端口 | 链路加密 | DSH 鉴权 | 额外风险 | 推荐度 |
|---|---|---|---|---|---|
| A 内网/VPN 直连 | 是（3080，限 VPN 网段） | 取决于 VPN | ✅ token+cookie | 明文 HTTP，token 可能被嗅探 | ⭐⭐ |
| B 隧道 + 代理 | 否（出站即可） | ✅ 隧道 TLS | ✅ token+cookie | 公网可达，需隧道侧再加一层 | ⭐⭐⭐ |
| C SSH 端口转发 | 否（出站即可） | ✅ SSH | ✅ token+cookie | 最低 | ⭐⭐⭐⭐⭐ |

## 需不需要写插件 / 装插件？

**不需要。零插件。**

理由：

1. 需要的三件事——**监听非 loopback 地址**、**TLS**、**鉴权**——DSH 本体全部自带，
   都是 `dsh --profile web` 的 CLI flag（实测 `--help` 与源码 option 定义双向确认）。
2. 剩下的"打通网络"是**网络层问题**（VPN / 隧道 / SSH 转发），任何 DSH 插件都无法替你做：
   插件只能注册 `ctx.webServer` 路由、`ctx.tools` 工具、`ctx.events` 监听，
   **改不了 `listen` 的绑定语义**（通配地址在配置加载阶段就被拒），
   也造不出一条出站隧道去对端做 NAT 穿透。
3. 唯一"能写"的东西是锦上添花，且都有现成替代：
   - 反代/隧道方案里做"自动给 `--trusted-host` 配好"的启动包装脚本 → 一条命令行就够，不必是插件；
   - 页面侧的"设备/会话管理面板" → `dsh-api-remote-access` 的 Peer 是进程内概念，
     没有跨机器会话可管；
   - 想加第二套密码登录 → 只能挂 `connection/request` waterfall 做额外校验，
     属于**安全加固**，不是"能不能远程访问"的前提。

**结论：先按路线 C（或 B）跑通，验证完再谈要不要加固。切勿为这件事写插件。**

## 附：复现方法（只读，不改安装）

```powershell
# 1) 实测 CLI 参数（不会启动服务）
& "C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  --profile web --help

# 2) 实测当前绑定（确认只有 loopback）
Get-NetTCPConnection -LocalPort 65145 -State Listen |
  Select-Object LocalAddress,LocalPort,OwningProcess

# 3) 读 asar（Node，按 asar 头 offset 提取指定包）
node -e "..."   # 见本次调研脚本；或用 npx @electron/asar extract-file
```

关键 asar 内路径：

- `dsh/node_modules/@deepseek-ai/dsh-web-app/lib/startup.js`（CLI flag 定义）
- `dsh/node_modules/@deepseek-ai/dsh-web-app/README.zh.md`（`<a id="public-deployments">` 一节）
- `dsh/node_modules/@deepseek-ai/dsh-client-connection/README.zh.md`（`<a id="browser-authentication-and-request-trust">` 一节）
- `dsh/node_modules/@deepseek-ai/dsh-host-webserver/README.zh.md`
- `dsh/node_modules/@deepseek-ai/dsh-api-remote-access/README.zh.md`（用于排除误报）