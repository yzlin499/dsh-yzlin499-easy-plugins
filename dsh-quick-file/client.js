// ═══════════════════════════════════════════════════════════════════════════
// dsh-quick-file — Client 半侧（__ModuleLoader__ 静态格式，由 dsh-client-modules 提供）
//
// 1) 注册一个 `@` InputTriggerSource 到内置输入触发管道
//    （dsh-client-ui-input-trigger，`ctx.inputTriggers`）：
//      · 输入框打 `@` → 管道自动弹出候选菜单（文件源与其它 @ 源分组并列）
//      · 继续打字 → 管道带 query 调 candidates() → Host /quick-file/files 过滤
//      · 回车/点击选中 → 管道把 `@查询词` 替换为文件路径文本（onPick 返回 { text }）
// 2) 设置卡片：注册进官方「插件」设置页（settings.plugin.item）。该插槽现为
//    keyed 插槽，以卡片所编辑的 settings 命名空间为键（register 必须带
//    key: <命名空间>，Host 侧已注册同名命名空间才会被「插件配置」标签页配对渲染）。
//    配置读写改走本插件自己的 /quick-file/config 路由，Host 侧经 ctx.settings
//    持久化到 ~/.dsh/settings.yaml。
// ═══════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
	id: "dsh-quick-file",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		//#region styles（设置卡片 + @ 候选菜单宽度覆盖）
		const css = [
			".qf-card{display:flex;flex-direction:column;gap:8px}",
			".qf-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".qf-label{width:108px;flex-shrink:0}",
			".qf-input{width:70px;background:rgba(0,0,0,.22);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;padding:4px 7px}",
			".qf-input-url{flex:1;min-width:0;background:rgba(0,0,0,.22);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;padding:4px 7px}",
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
			// 覆盖官方 @ 候选菜单：撑满输入框宽度（官方 max-width 537px 偏窄）
			"div[role=\"listbox\"]{max-width:none!important;width:100%!important}",
			"div[role=\"listbox\"] [role=\"option\"]>span:nth-child(2){flex:none;max-width:45%!important}",
			// 覆盖官方引用块（chip）：
			// 官方 chip 宽度 = draft 中 U+FFFC 占位符的字符宽度（DshChipCell 字体，约 1 字符），
			// 光标按 textarea 字符布局定位；label 的 width:calc(138.889% - 10px)+scale(.72)
			// 使 label 视觉宽度自动跟随 chip 宽度。因此直接把视觉 chip 改宽会导致光标偏移。
			// 正确做法：@font-face + unicode-range 只覆盖 U+FFFC，size-adjust 放大其字形，
			// textarea 与 mirror 同一字体栈 → 占位符、chip、label、光标同步变宽。
			"@font-face{font-family:\"QF-ChipWide\";src:local(\"Arial\"),local(\"Segoe UI\"),local(\"Tahoma\");unicode-range:U+FFFC;size-adjust:800%}",
			".uV2eYG_input,.uV2eYG_mirror,.uV2eYG_backdrop{font-family:\"QF-ChipWide\",\"DshChipCell\",var(--dsw-font-family)!important}",
			// label 超长时省略（官方无 text-overflow）
			"[data-decoration=\"chip\"]>span:first-child{text-overflow:ellipsis!important}",
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

		// ── 文件图标：按扩展名染色的 SVG（语言/类型刻板印象配色）──
		const EXT_COLORS = {
			ts: "#3178c6", tsx: "#3178c6", mts: "#3178c6", cts: "#3178c6",
			js: "#f7df1e", jsx: "#f7df1e", mjs: "#f7df1e", cjs: "#f7df1e",
			c: "#659ad2", h: "#659ad2",
			cpp: "#659ad2", cc: "#659ad2", cxx: "#659ad2", hpp: "#659ad2",
			cs: "#512bd4",
			java: "#e76f00",
			py: "#3776ab", pyw: "#3776ab",
			go: "#00add8",
			rs: "#dea584",
			rb: "#cc342d",
			php: "#777bb4",
			html: "#e34f26", htm: "#e34f26",
			css: "#1572b6",
			scss: "#c6538c", sass: "#c6538c", less: "#1d365d",
			json: "#4caf50", jsonc: "#4caf50",
			yaml: "#cb171e", yml: "#cb171e",
			md: "#6b7280", markdown: "#6b7280",
			sh: "#4eaa25", bash: "#4eaa25", zsh: "#4eaa25",
			ps1: "#2674ec", bat: "#607d8b", cmd: "#607d8b",
			png: "#a855f7", jpg: "#a855f7", jpeg: "#a855f7", gif: "#a855f7",
			webp: "#a855f7", svg: "#a855f7", ico: "#a855f7",
			zip: "#f59e0b", rar: "#f59e0b", "7z": "#f59e0b", tar: "#f59e0b",
			gz: "#f59e0b", bz2: "#f59e0b", xz: "#f59e0b",
			exe: "#64748b", dll: "#64748b", msi: "#64748b",
			pdf: "#dc2626",
			doc: "#2b579a", docx: "#2b579a",
			xls: "#217346", xlsx: "#217346", csv: "#217346",
			ppt: "#d04526", pptx: "#d04526",
		};
		const FOLDER_COLOR = "#fbbf24";
		const DEFAULT_FILE_COLOR = "#94a3b8";

		/** 按文件名后缀取配色；目录固定文件夹黄 */
		function iconColor(name, isDir) {
			if (isDir) return FOLDER_COLOR;
			const dot = name.lastIndexOf(".");
			const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
			return EXT_COLORS[ext] || DEFAULT_FILE_COLOR;
		}

		/** 文件/文件夹 SVG 图标（16×16，填充色按类型染色） */
		function fileGlyph(color, isDir) {
			return react.createElement("svg", {
				width: 16, height: 16, viewBox: "0 0 16 16", fill: "none",
				"aria-hidden": true,
			}, isDir
				? react.createElement("path", {
					d: "M2 3.5a1 1 0 0 1 1-1h3l1.5 2H13a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z",
					fill: color,
				})
				: react.createElement(react.Fragment, null,
					react.createElement("path", {
						d: "M3 1.5h6.5L13 5v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z",
						fill: color,
					}),
					react.createElement("path", {
						d: "M9.5 1.5V5H13",
						fill: color,
						opacity: 0.45,
					}),
				));
		}

		/** 路径紧凑显示：保留尾部若干段，省略左边（聚焦文件名/附近目录） */
		function compactPath(p) {
			const parts = String(p).split("/");
			if (parts.length <= 4) return p;
			return "…/" + parts.slice(-3).join("/");
		}

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
						return files.map((f) => {
							// 拆出文件名（主显示）与所在目录（路径，紧凑省略左边）
							const rel = String(f.path || f.name || "");
							const slash = rel.lastIndexOf("/");
							const base = slash >= 0 ? rel.slice(slash + 1) : rel;
							const dir = slash >= 0 ? rel.slice(0, slash) : "";
							return {
								name: base,
								description: dir ? compactPath(dir) : "",
								icon: fileGlyph(iconColor(base, f.isDir), f.isDir),
								// 完整相对路径供 onPick 插入
								fullPath: rel,
								isDir: !!f.isDir,
							};
						});
					} catch (e) {
						if (e && e.name === "AbortError") return [];
						console.error("[quick-file] candidates 失败:", e);
						return [];
					}
				},
				onPick({ candidate }) {
					// 插入「块」（ReferenceInsert）：输入框里显示为 chip（文件名），
					// 一次删除即整块移除；提交时经 codec.serialize 展开为完整相对路径
					const rel = candidate.fullPath || candidate.name;
					return {
						insert: {
							source: "文件",
							ref: rel,
							label: candidate.name,
							clipboardText: rel,
						},
					};
				},
				codec: {
					// 剪贴板/持久化投影：完整相对路径
					clipboardText: (ref) => String(ref),
					// 提交给模型：完整相对路径
					serialize: (ref) => Promise.resolve(String(ref)),
				},
			};

			ctx.effect(() => ctx.inputTriggers.registerSource(source));

			// 设置卡片：官方「插件」设置页（settings.plugin.item，keyed 插槽）。
			// key 用本插件在 Host 侧注册的 settings 命名空间（dsh-quick-file），
			// 配对后由「插件配置」标签页渲染；配置读写走自身 /quick-file/config 路由，
			// Host 侧经 ctx.settings 持久化到 ~/.dsh/settings.yaml。

			function SettingsCard() {
				const [cfg, setCfg] = react.useState({ depth: 3, max: 50, everythingUrl: "", ignoreDirs: "", loading: true, status: "" });
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
									everythingUrl: d && typeof d.everythingUrl === "string" ? d.everythingUrl : s.everythingUrl,
									ignoreDirs: d && typeof d.ignoreDirs === "string" ? d.ignoreDirs : s.ignoreDirs,
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
						body: JSON.stringify({ depth: Number(cfg.depth), max: Number(cfg.max), everythingUrl: cfg.everythingUrl, ignoreDirs: cfg.ignoreDirs }),
					})
						.then((r) => r.json())
						.then((d) => {
							if (d && d.ok) {
								setCfg((s) => ({
									...s,
									depth: d.depth != null ? d.depth : s.depth,
									max: d.max != null ? d.max : s.max,
									everythingUrl: typeof d.everythingUrl === "string" ? d.everythingUrl : s.everythingUrl,
									ignoreDirs: typeof d.ignoreDirs === "string" ? d.ignoreDirs : s.ignoreDirs,
									status: "已保存",
								}));
							} else {
								setCfg((s) => ({ ...s, status: (d && d.error) || "保存失败" }));
							}
						})
						.catch((e) => setCfg((s) => ({ ...s, status: String((e && e.message) || "保存失败") })));
				};

				const row = (label, value, onChange, hint, type, inputCls) =>
					react.createElement("label", { className: "qf-row" },
						react.createElement("span", { className: "qf-label" }, label),
						react.createElement("input", {
							className: inputCls || "qf-input",
							type: type || "number",
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
								row("Everything HTTP", cfg.everythingUrl, (v) => setCfg((s) => ({ ...s, everythingUrl: v })),
									"留空 = 递归扫描；填 http://127.0.0.1:8074 则用 Everything 搜索", "text", "qf-input-url"),
								row("忽略目录", cfg.ignoreDirs, (v) => setCfg((s) => ({ ...s, ignoreDirs: v })),
									"逗号分隔；默认 node_modules,.git 等；清空 = 不忽略任何目录", "text", "qf-input-url"),
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
				key: "dsh-quick-file",
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
