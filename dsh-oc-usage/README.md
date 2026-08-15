# dsh-oc-usage

DSH 插件：**OpenCode（opencode.ai Go 订阅）用量悬浮窗**。

右上角可拖拽悬浮窗，显示 5h / 7d / 30d 用量百分比 + 重置倒计时，每 5 分钟自动刷新。

## 安装

```powershell
dsh plugin --profile web add ./dsh-oc-usage
```

重启 DSH Web 后生效。

## 使用

1. 点悬浮窗 ⚙ 粘贴 opencode.ai 登录后的完整 Cookie（必须含 `auth=`）。
2. Workspace ID 可留空（自动发现）或手动填 `wrk_…`。

> Cookie 只存 DSH 进程内存，不落盘、不回显。

## 工作原理

- **Host**（`index.js`）：Node 全局 `fetch` 直连 `opencode.ai/_server`（server-fn 序列化
  文本，正则解析 rolling/weekly/monthly 用量），注册 `/oc-usage/*` webServer 路由。
- **Client**（`client.js`）：注册进 `shell.overlay` Slot，同源 fetch 调 `/oc-usage/*`。

## License

MIT
