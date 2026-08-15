// ═══════════════════════════════════════════════════════════════════════════
// dsh-quick-file — Client 半侧（__ModuleLoader__ 静态格式，由 dsh-client-modules 提供）
//
// 1) 注册一个 `@` InputTriggerSource 到内置输入触发管道
//    （dsh-client-ui-input-trigger，`ctx.inputTriggers`）：
//      · 输入框打 `@` → 管道自动弹出候选菜单（文件源与其它 @ 源分组并列）
//      · 继续打字 → 管道带 query 调 candidates() → Host /quick-file/files 过滤
//      · 回车/点击选中 → 管道把 `@查询词` 替换为文件路径文本（onPick 返回 { text }）
// 2) 设置卡片：注册进官方「插件」设置页（settings.plugin.item），
//    配置文件列表的深度/数量上限（Host 内存态）。
// ═══════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
	id: "dsh-quick-file",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		//#region styles（设置卡片）
		const css = [
			".qf-card{display:flex;flex-direction:column;gap:8px}",
			".qf-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".qf-label{width:100px;flex-shrink:0}",
			".qf-input{width:70px;background:rgba(0,0,0,.22);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;padding:4px 7px}",
			".qf-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}",
			".qf-hint{font-size:10.5px;color:var(--dsw-alias-label-secondary);opacity:.75}",
			".qf-foot{display:flex;align-items:center;gap:10px;margin-top:2px}",
			".qf-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:6px;font-size:12px;line-height:1;padding:5px 12px;cursor:pointer}",
			".qf-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}",
			".qf-btn[disabled]{opacity:.45;cursor:default}",
			".qf-status{font-size:11px;color:var(--dsw-alias-label-secondary)}",
			// 官方插件卡片外壳（对齐 PluginCard）
			".pc-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;overflow:hidden}",
			".pc-head{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;display:flex;align-items:center;gap:12px;padding:14px 16px}",
			".pc-head-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}",
			".pc-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
			".pc-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}",
			".pc-chevron{color:var(--dsw-alias-label-tertiary);font-size:12px;transition:transform .16s}",
			".pc-open{transform:rotate(180deg)}",
			".pc-body{border-top:1px solid var(--dsw-alias-border-l2);padding:14px 16px}",
		].join("");
		const tagId = "dsh-quick-file/style";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-quick-file";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		const inject = ["inputTriggers", "slots"];

		function SettingsCard() {
			const [cfg, setCfg] = react.useState({ depth: 3, max: 50, loading: true, status: "" });
			const [open, setOpen] = react.useState(true);

			react.useEffect(() => {
				fetch("/quick-file/config")
					.then((r) => r.json())
					.then((d) => setCfg((s) => ({ ...s, depth: d.depth, max: d.max, loading: false })))
					.catch(() => setCfg((s) => ({ ...s, loading: false, status: "加载配置失败" })));
			}, []);

			const save = () => {
				setCfg((s) => ({ ...s, status: "保存中…" }));
				fetch("/quick-file/config", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ depth: Number(cfg.depth), max: Number(cfg.max) }),
				})
					.then((r) => r.json())
					.then((d) => setCfg((s) => ({ ...s, status: d.ok ? "已保存（内存态，重启恢复默认）" : (d.error || "保存失败") })))
					.catch(() => setCfg((s) => ({ ...s, status: "保存失败" })));
			};

			const row = (label, value, onChange, hint) =>
				react.createElement("label", { className: "qf-row" },
					react.createElement("span", { className: "qf-label" }, label),
					react.createElement("input", {
						className: "qf-input",
						type: "number",
						value: value,
						onChange: (e) => onChange(e.target.value),
					}),
					hint ? react.createElement("span", { className: "qf-hint" }, hint) : null,
				);

			return react.createElement("div", { className: "pc-card" },
				react.createElement("button", { className: "pc-head", onClick: () => setOpen((v) => !v) },
					react.createElement("span", { className: "pc-head-text" },
						react.createElement("span", { className: "pc-name" }, "快速输入文件"),
						react.createElement("span", { className: "pc-desc" }, "@ 文件列表参数"),
					),
					react.createElement("span", { className: "pc-chevron" + (open ? " pc-open" : "") }, "▾"),
				),
				open
					? react.createElement("div", { className: "pc-body" },
						react.createElement("div", { className: "qf-card" },
							row("列表深度上限", cfg.depth, (v) => setCfg((s) => ({ ...s, depth: v })), "1-10"),
							row("文件数量上限", cfg.max, (v) => setCfg((s) => ({ ...s, max: v })), "10-200"),
							react.createElement("div", { className: "qf-foot" },
								react.createElement("button", { className: "qf-btn", onClick: save, disabled: cfg.loading }, "保存"),
								cfg.status ? react.createElement("span", { className: "qf-status" }, cfg.status) : null,
							),
						),
					)
					: null,
			);
		}

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

			// 设置卡片：官方「插件」设置页（settings.plugin.item）
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				id: "quick-file-settings",
				order: 10,
				label: "快速输入文件",
			}, SettingsCard));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
