// dsh-ctx-menu — Host half
//
// M1 阶段本插件的宿主半侧**不做任何事**：所有动作都走 DSH 已有的公开能力
// （remote.session.openWorkspacePath / workspacePathApplications / remote.workspaceFiles
//  / sidebarRight.openResource），因此不需要自建宿主路由，也就没有新的攻击面。
//
// 这个文件存在的意义是让 bundle 行可挂载：cordis.patch.yml 的 insert 指向包名，
// 其 main 即本文件。M2（若要做「用指定编辑器打开文件本身」）才在这里加 webServer 路由。

export const name = 'dsh-ctx-menu'

export function apply(ctx) {
  ctx.effect(() => {
    console.log('[dsh-ctx-menu] host half loaded (M1: no host routes)')
    return () => {
      // 无副作用需要回收；保留 disposer 形状以便后续阶段扩展。
    }
  }, 'dsh-ctx-menu: host half')
}