// ═══════════════════════════════════════════════════════════════════════════
// dsh-quick-file — Client 半侧（__ModuleLoader__ 静态格式，由 dsh-client-modules 提供）
//
// 1) 注册一个 `@` InputTriggerSource 到内置输入触发管道
//    （dsh-client-ui-input-trigger，`ctx.inputTriggers`）：
//      · 输入框打 `@` → 管道自动弹出候选菜单（文件源与其它 @ 源分组并列）
//      · 继续打字 → 管道带 query 调 candidates() → Host /quick-file/files 过滤
//      · 回车/点击选中 → 管道把 `@查询词` 替换为文件路径文本（onPick 返回 { text }）
// 2) 设置卡片：注册进官方「插件」设置页（settings.plugin.item），
//    配置文件列表的深度/数量上限。注意：官方 api-proxy 目前只对白名单内的
//    settings 命名空间开放 Web 读写（WEB_SETTINGS_NAMESPACES），第三方插件的
//    settingsScope 永远 unavailable；因此这里改走本插件自己的
//    /quick-file/config 路由，Host 侧经 ctx.settings 持久化到 ~/.dsh/settings.yaml。
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
			".pc-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}",
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

		// 官方 IconChevronDownOutline14 同款 SVG 箭头
		function ChevronIcon({ className }) {
			return react.createElement("svg", {
				width: 14, height: 14, viewBox: "0 0 14 14", fill: "none",
				xmlns: "http://www.w3.org/2000/svg", className,
			}, react.createElement("path", {
				d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
				fill: "currentColor",
			}));
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

			// 设置卡片：官方「插件」设置页（settings.plugin.item）。
			// 官方 api-proxy 的 WEB_SETTINGS_NAMESPACES 白名单不包含第三方命名空间，
			// settingsScope 会永远 unavailable，因此改走自身 /quick-file/config 路由；
			// Host 侧经 ctx.settings 持久化到 ~/.dsh/settings.yaml。

			function SettingsCard() {
				const [cfg, setCfg] = react.useState({ depth: 3, max: 50, loading: true, status: "" });
				const [open, setOpen] = react.useState(false);

				react.useEffect(() => {
					let alive = true;
					const load = () => {
						fetch("/quick-file/config")
							.then((r) => r.json())
							.then((d) => {
								if (!alive) return;
								setCfg((s) => ({
									...s,
									loading: false,
									depth: d && d.depth != null ? d.depth : s.depth,
									max: d && d.max != null ? d.max : s.max,
									status: "",
								}));
							})
							.catch(() => {
								if (!alive) return;
								setCfg((s) => ({ ...s, loading: false, status: "读取失败" }));
							});
					};
					load();
					return () => { alive = false; };
				}, []);

				const save = () => {
					setCfg((s) => ({ ...s, status: "保存中…" }));
					fetch("/quick-file/config", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ depth: Number(cfg.depth), max: Number(cfg.max) }),
					})
						.then((r) => r.json())
						.then((d) => {
							if (d && d.ok) {
								setCfg((s) => ({
									...s,
									depth: d.depth != null ? d.depth : s.depth,
									max: d.max != null ? d.max : s.max,
									status: "已保存",
								}));
							} else {
								setCfg((s) => ({ ...s, status: (d && d.error) || "保存失败" }));
							}
						})
						.catch((e) => setCfg((s) => ({ ...s, status: String((e && e.message) || "保存失败") })));
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
						react.createElement(ChevronIcon, { className: "pc-chevron" + (open ? " pc-open" : "") }),
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
