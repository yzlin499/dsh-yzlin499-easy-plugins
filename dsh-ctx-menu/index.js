// dsh-ctx-menu — Host half
//
// v0.3.0 起本插件的 Host 半侧**不做任何事**：功能全部改为「向官方统一右键贡献动作」
// （客户端 `ctx.contextMenus.register`），所需能力都由 DSH 自带的客户端远程服务提供：
//   - `remote.workspaceFiles.stat/read`  → 绝对路径、文件正文
//   - `remote.session.workspacePathApplications/openWorkspacePath` → 关联应用与启动
//   - `sessions`                          → 会话工作目录
// 因此不再需要 webServer 路由、不再有 app.asar 之外的攻击面。
//
// 这个文件存在的意义是让 bundle 行可挂载：cordis.patch.yml 的 insert 指向包名，其 main 即本文件。

export const name = 'dsh-ctx-menu'

export function apply(ctx) {
  ctx.effect(() => {
    console.log('[dsh-ctx-menu] host half loaded (v0.3.0: contribution-only, no host routes)')
    return () => {
      // 无副作用需要回收；保留 disposer 形状以便后续阶段扩展。
    }
  }, 'dsh-ctx-menu: host half')
}
