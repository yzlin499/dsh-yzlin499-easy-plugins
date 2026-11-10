// ═══════════════════════════════════════════════════════════════════════════
// dsh-recent-tps — Host 半侧（ESM 模块，由 cordis loader 挂载）
//
// 空实现：本插件没有 Host 侧状态、没有设置、没有路由。
// 全部工作都在 Client 半侧（client.js）——接管 `conversation.composer.dock`
// 的 `activity` 读数，并在统计面板里多画一行「最近 30 秒速度」。
// 保留这个文件是因为 bundle 契约要求挂载行的 `main` 是一个可加载模块。
// ═══════════════════════════════════════════════════════════════════════════

export const name = 'recent-tps'

export function apply() {}
