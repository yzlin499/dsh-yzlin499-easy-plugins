// ═══════════════════════════════════════════════════════════════════════════
// dsh-quick-file — Client 半侧（__ModuleLoader__ 静态格式，由 dsh-client-modules 提供）
//
// 注册一个 `@` InputTriggerSource 到内置输入触发管道
// （dsh-client-ui-input-trigger，`ctx.inputTriggers`）：
//   · 输入框打 `@` → 管道自动弹出候选菜单（文件源与其它 @ 源分组并列）
//   · 继续打字 → 管道带 query 调 candidates() → Host /quick-file/files 过滤
//   · 回车/点击选中 → 管道把 `@查询词` 替换为文件路径文本（onPick 返回 { text }）
// 菜单渲染、键盘导航、输入改写全部由管道负责，本插件只提供数据源。
// ═══════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
	id: "dsh-quick-file",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const inject = ["inputTriggers"];

		function apply(ctx) {
			const source = {
				trigger: "@",
				name: "文件",
				order: 20,
				async candidates(session, { query, signal }) {
					const url =
						"/quick-file/files?session=" +
						encodeURIComponent(session.sessionId) +
						"&q=" +
						encodeURIComponent(query || "");
					try {
						const resp = await fetch(url, { signal });
						if (!resp.ok) return [];
						const data = await resp.json();
						const files = Array.isArray(data && data.files) ? data.files : [];
						return files.map((f) => ({
							name: f.path,
							description: f.isDir ? "目录" : "文件",
							icon: f.isDir ? "📁" : "📄",
						}));
					} catch (e) {
						if (e && e.name === "AbortError") return [];
						console.error("[quick-file] candidates 失败:", e);
						return [];
					}
				},
				onPick({ candidate }) {
					// 管道把 @token 区间替换为这段文本（尾随空格方便继续输入）
					return { text: candidate.name + " " };
				},
			};

			ctx.effect(() => ctx.inputTriggers.registerSource(source));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
