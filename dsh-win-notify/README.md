# dsh-win-notify

DSH 插件：**Windows 原生吐司通知**。

DSH 运行在网页里，人不在前台时什么动静都看不到，很痛苦。本插件在 **权限申请**、
**发起提问**、**运行停止** 三个时机弹出 Windows 原生吐司（右下角通知），
网页挂在后台也能第一时间知道「该你了」或「完事了」。

## 安装

```powershell
dsh plugin --profile web add ./dsh-win-notify
```

重启 DSH Web 后生效。

> 或者：直接通过 **dsh-yzlin499-plugins-manager** 的「插件管理」卡片（设置 → 插件）快速启用。

## 使用

装好后默认**总是通知**三种时机：

| 时机 | 吐司示例 |
|---|---|
| 权限申请 | 「DSH · 需要你批准 pwsh —— 请求执行：…」 |
| 发起提问 | 「DSH · 需要你回答 —— <问题文本>」 |
| 运行停止 | 「DSH · 运行完成 —— <工作区> 会话已结束」；出错/中止/受阻会显示对应文案 |

- **运行停止**以 `agent/status` 变 idle（驱动完全退出）为准，多轮 goal 循环
  只在全部结束时弹一次，不会每回合刷屏；出错（error）、中止（aborted）、
  受阻（blocked）、输出达上限（max-tokens）都有独立文案。
- 子代理会话不提示，避免子任务刷屏。
- 首次弹吐司时插件会自动在开始菜单注册一个 `DSH.Notify` 快捷方式
  （Windows 只给已注册应用显示吐司），之后即弹即用。

## 配置（设置 → 插件 → Windows 通知）

| 项 | 说明 |
|---|---|
| 启用通知 | 总开关（默认开） |
| 权限申请 / 发起提问 / 运行停止 | 三类时机独立开关（默认全开） |
| 通知时机 | **总是通知**（默认）/ **仅页面在后台时** |

「仅页面在后台时」模式下，吐司只在网页处于后台（标签页隐藏 / 窗口最小化 / 被遮挡）
时弹出；页面是否后台由浏览器 `document.visibilityState` 自动判定，
**无需任何鼠标/焦点检测**。卡片里会实时显示当前页面状态（前台/后台）。

## 工作原理

- **Host**（`index.js`）：监听宿主事件，命中即弹：
  - `session/event` 里 `approval/asked`（权限申请，含工具名/理由）、
    `tool/call` 且名为 `ask_user_question`（提问，解析参数里的问题文本）、
    `turn/end`（记录回合结束原因）
  - `agent/status` 变 `idle`（运行停止，结合记录的回合原因生成文案）
  - 弹窗执行：`ctx.subprocess.spawn` 调 `powershell.exe -File toast.ps1`，
    标题/正文 Base64 传入（免转义），fire-and-forget 不阻塞主流程；
    同类吐司 800ms 防抖
- **toast.ps1**：Windows PowerShell 5.1 + WinRT（`ToastNotificationManager`，
  ToastText02 模板）弹原生吐司；首次运行自动创建 `%APPDATA%\Microsoft\Windows\Start
  Menu\Programs\DSH.Notify.lnk`（AUMID 注册），这是 Windows 接受吐司的前提。
  **必须用 powershell.exe（5.1）执行**——pwsh（PowerShell 7）不支持 WinRT 加载。
- **Client**（`client.js`）：`settings.plugin.item` 设置卡片 + 页面可见性上报
  （`visibilitychange` → POST `/win-notify/visibility`）。
- 配置经官方 `ctx.settings` 持久化到 `~/.dsh/settings.yaml`（命名空间
  `dsh-win-notify`），卡片走插件自身 `/win-notify/config` 路由读写。

## License

MIT
