/**
 * Host 半侧（占位）。
 *
 * 本包的实质内容都在 preset 里：`cordis.patch.yml` 声明 `preset-context-optimize`，
 * 其 `plugins` 清单把标准模式的压缩后端换成 `./compaction`。
 * 这里保留一个空插件只为满足 bundle 契约（`package.json` 的 `main`），
 * 不会被自动挂载，也没有任何副作用。
 */
export const name = 'dsh-context-optimize'

export function apply(ctx) {
  ctx.logger?.info?.('[context-optimize] host 半侧无副作用；请使用「上下文优化」模式')
}
