# dsh-yzlin499-plugins-manager

DSH 插件管理器：在**设置 → 插件管理**面板里开关本插件集合中的插件。

## 截图

![截图](screenshot.png)

## 功能

- 自动扫描管理器所在文件夹（集合根）下所有含 `cordis.patch.yml` 的插件
- 显示每个插件的启用状态（以 `dsh.profile.bundles` 挂载清单为准）
- 一键启用/停用：通过 `dsh plugin add/remove` 命令执行，可批量开关后一次性重启生效
- 详情弹窗显示插件 README（中文界面读 `README.md`；英文界面优先 `README_EN.md`）
- 目标 profile 默认 `web`，面板可改（内存态）

## 边界

- **只管理本集合内的插件**，绝不触碰其它位置安装的插件
- 管理器自身不可被停用（防止把自己锁死）
- 失效链接自愈：旧工程残留的链接会自动 remove 后用当前集合路径重装

## 安装

```powershell
dsh plugin --profile web add ./dsh-yzlin499-plugins-manager
```

重启 DSH Web 后，设置 → 插件管理 即可使用。

## License

MIT
