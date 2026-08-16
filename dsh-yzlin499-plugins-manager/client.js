// ═══════════════════════════════════════════════════════════════════════════
// dsh-yzlin499-plugins-manager — Client 半侧（__ModuleLoader__ 静态格式）
//
// 注册为官方「插件」设置页的一张卡片（settings.plugin.item，list、additive）：
//   · 列出本集合（管理器父文件夹扫描）的所有插件 + 启用状态（dsh.profile.bundles）
//   · 每行：名称 + 状态徽标 + [详情] [启用/停用]
//   · 详情：弹窗显示插件 README——中文界面读 README.md，英文界面优先 README_EN.md
//     （缺失回退 README.md，都没有才回退 package.json description）；跟随 DSH 语言实时切换
//   · 批量开关后显示"需要重启 DSH Web 生效"横幅（不自动重启）
//   · 顶部可改目标 profile（默认 web，内存态）
// ═══════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
	id: "dsh-yzlin499-plugins-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		//#region styles
		const css = [
			".pm-root{font-family:system-ui,'Segoe UI',sans-serif;display:flex;flex-direction:column;gap:12px;padding:4px 2px}",
			".pm-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}",
			".pm-profile{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".pm-profile input{width:110px;background:rgba(0,0,0,.22);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;padding:4px 7px}",
			".pm-profile input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}",
			".pm-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:6px;font-size:12px;line-height:1;padding:5px 10px;cursor:pointer}",
			".pm-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}",
			".pm-btn[disabled]{opacity:.45;cursor:default}",
			".pm-rootpath{font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all}",
			".pm-banner{font-size:12px;color:var(--dsw-alias-state-warn-primary);background:rgba(255,180,0,.08);border:1px solid var(--dsw-alias-state-warn-primary);border-radius:8px;padding:8px 10px}",
			".pm-err{font-size:12px;color:var(--dsw-alias-state-error-primary);padding:8px 10px}",
			".pm-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}",
			".pm-info{flex:1;min-width:0}",
			".pm-name{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:6px}",
			".pm-btns{display:flex;gap:8px;flex-shrink:0}",
			".pm-badge{font-size:10px;padding:2px 7px;border-radius:999px;flex-shrink:0}",
			".pm-badge-on{background:rgba(0,200,120,.14);color:var(--dsw-alias-state-success-primary)}",
			".pm-badge-off{background:rgba(128,128,128,.15);color:var(--dsw-alias-label-secondary)}",
			".pm-badge-self{background:rgba(0,120,255,.14);color:var(--dsw-alias-brand-primary)}",
			".pm-empty{font-size:12px;color:var(--dsw-alias-label-secondary);padding:16px 4px}",
			".pm-mask{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px}",
			".pm-modal{width:min(720px,92vw);max-height:80vh;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 12px 48px rgba(0,0,0,.4);display:flex;flex-direction:column;overflow:hidden}",
			"body[data-ds-dark-theme] .pm-modal{background:var(--dsw-alias-bg-base)}",
			".pm-modal-head{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}",
			".pm-modal-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}",
			".pm-modal-src{font-size:11px;color:var(--dsw-alias-label-secondary);flex:1}",
			".pm-modal-body{padding:14px;overflow:auto}",
			".pm-readme{font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-primary);word-break:break-word}",
			".pm-readme h1,.pm-readme h2,.pm-readme h3,.pm-readme h4{margin:14px 0 8px;line-height:1.35;color:var(--dsw-alias-label-primary)}",
			".pm-readme h1{font-size:17px;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:6px}",
			".pm-readme h2{font-size:15px;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:4px}",
			".pm-readme h3{font-size:13.5px}",
			".pm-readme h4{font-size:12.5px}",
			".pm-readme p{margin:8px 0}",
			".pm-readme ul,.pm-readme ol{margin:8px 0;padding-left:22px}",
			".pm-readme li{margin:3px 0}",
			".pm-readme code{font-family:Consolas,'Courier New',monospace;font-size:11.5px;background:rgba(128,128,128,.14);border-radius:4px;padding:1px 5px}",
			".pm-readme pre{background:rgba(0,0,0,.25);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px 12px;overflow:auto;margin:10px 0}",
			".pm-readme pre code{background:none;padding:0}",
			".pm-readme blockquote{margin:8px 0;padding:2px 12px;border-left:3px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}",
			".pm-readme table{border-collapse:collapse;margin:10px 0}",
			".pm-readme th,.pm-readme td{border:1px solid var(--dsw-alias-border-l2);padding:5px 10px;font-size:12px}",
			".pm-readme a{color:var(--dsw-alias-brand-primary)}",
			".pm-readme img{max-width:100%;border-radius:6px}",
			".pm-readme hr{border:none;border-top:1px solid var(--dsw-alias-border-l1);margin:14px 0}",
			// 官方插件卡片外壳（对齐 PluginCard：border + bg-layer-3 + 12px 圆角 + 可折叠头部）
			".pc-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;overflow:hidden}",
			".pc-head{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;display:flex;align-items:center;gap:12px;padding:14px 16px}",
			".pc-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
			".pc-head-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}",
			".pc-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
			".pc-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}",
			".pc-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}",
			".pc-open{transform:rotate(180deg)}",
			".pc-body{border-top:1px solid var(--dsw-alias-border-l2);padding:14px 16px}",
		].join("");
		const tagId = "dsh-yzlin499-plugins-manager/style";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-yzlin499-plugins-manager";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		const inject = ["slots", "locale", "settingsScope"];

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
			const locale = ctx.get("locale");
			// 持久化 profile（官方 settings 命名空间 dsh-yzlin499-plugins-manager）
			const profileScope = ctx.settingsScope.bind({ namespace: "dsh-yzlin499-plugins-manager" });
			// DSH 当前语言：'en' 才用英文，其余默认中文
			const activeLang = () => (locale && locale.getLocale().active === "en") ? "en" : "zh";

			function Section() {
				const [state, setState] = react.useState({
					loading: true, error: "", root: "", profile: "web",
					profileInput: "", plugins: [], pending: 0, busy: null,
					rev: 0, detail: null, detailLoading: false,
				});
				const [open, setOpen] = react.useState(false);

				// 语言切换 → 重取已打开弹窗的 README
				react.useEffect(() => {
					if (!locale) return;
					return locale.subscribe(() => setState((s) => ({ ...s, rev: s.rev + 1 })));
				}, []);

				react.useEffect(() => {
					if (!state.detail) return;
					setState((s) => ({ ...s, detailLoading: true }));
					fetch("/plugins-manager/readme?dir=" + encodeURIComponent(state.detail.dir) + "&lang=" + activeLang())
						.then((r) => r.json())
						.then((d) => {
							setState((s) => ({
								...s, detailLoading: false,
								detail: d.ok
									? { ...s.detail, text: d.text, html: d.html, source: d.source }
									: { ...s.detail, text: d.error || "读取失败", html: "", source: "" },
							}));
						})
						.catch(() => setState((s) => ({ ...s, detailLoading: false })));
				}, [state.detail && state.detail.dir, state.rev]);

				const refresh = () => {
					fetch("/plugins-manager/list")
						.then((r) => r.json())
						.then((d) => {
							setState((s) => ({
								...s, loading: false,
								root: d.root || "", profile: d.profile || "web",
								profileInput: d.profile || "web", plugins: d.plugins || [],
							}));
						})
						.catch(() => setState((s) => ({ ...s, loading: false, error: "无法连接 Host（/plugins-manager/list）" })));
				};
				react.useEffect(() => { refresh(); }, []);

				// profile 持久化同步（settings 命名空间）
				react.useEffect(() => {
					const sync = () => {
						const snap = profileScope.getSnapshot();
						const p = snap.value && snap.value.profile ? snap.value.profile : "web";
						setState((s) => ({ ...s, profile: p, profileInput: p }));
					};
					sync();
					return profileScope.subscribe(sync);
				}, []);

				const saveProfile = () => {
					const next = state.profileInput.trim();
					profileScope.set("profile", next)
						.then(() => setState((s) => ({ ...s, profile: next })))
						.catch((e) => setState((s) => ({ ...s, error: String((e && e.message) || "profile 保存失败") })));
				};

				const toggle = (pl) => {
					if (state.busy) return;
					setState((s) => ({ ...s, busy: pl.dir, error: "" }));
					fetch("/plugins-manager/toggle", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ dir: pl.dir, enable: !pl.enabled }),
					})
						.then((r) => r.json())
						.then((d) => {
							setState((s) => ({
								...s, busy: null,
								pending: d.ok ? s.pending + 1 : s.pending,
								error: d.ok ? "" : (d.error || "切换失败"),
							}));
							refresh();
						})
						.catch(() => setState((s) => ({ ...s, busy: null, error: "切换失败" })));
				};

				const openDetail = (pl) => {
					setState((s) => ({
						...s, detail: { dir: pl.dir, name: pl.name, text: "", html: "", source: "" }, detailLoading: true,
					}));
				};
				const closeDetail = () => setState((s) => ({ ...s, detail: null }));

				// 头部：profile 编辑
				const head = react.createElement("div", { className: "pm-head" },
					react.createElement("div", { className: "pm-profile" },
						react.createElement("span", null, "目标 profile"),
						react.createElement("input", {
							value: state.profileInput,
							onChange: (e) => setState((s) => ({ ...s, profileInput: e.target.value })),
							placeholder: "web",
						}),
						react.createElement("button", { className: "pm-btn", onClick: saveProfile, disabled: state.busy != null }, "保存"),
					),
				);

				// 需重启横幅
				const banner = state.pending > 0
					? react.createElement("div", { className: "pm-banner" },
						"有 " + state.pending + " 项变更，重启 DSH Web 后生效（可继续批量开关）")
					: null;

				// 插件行：名称 + 徽标 + [详情] [启用/停用]
				const rows = (state.plugins || []).map((pl) => {
					const badgeCls = pl.isSelf ? "pm-badge pm-badge-self" : (pl.enabled ? "pm-badge pm-badge-on" : "pm-badge pm-badge-off");
					const badgeText = pl.isSelf ? "管理器" : (pl.enabled ? "已启用" : "未启用");
					let btns = null;
					if (!pl.isSelf) {
						btns = react.createElement("div", { className: "pm-btns" },
							react.createElement("button", { className: "pm-btn", onClick: () => openDetail(pl) }, "详情"),
							react.createElement("button", {
								className: "pm-btn",
								disabled: state.busy != null,
								onClick: () => toggle(pl),
							}, state.busy === pl.dir ? "处理中…" : (pl.enabled ? "停用" : "启用")),
						);
					}
					return react.createElement("div", { className: "pm-row", key: pl.dir },
						react.createElement("div", { className: "pm-info" },
							react.createElement("div", { className: "pm-name" },
								react.createElement("span", null, pl.name),
								react.createElement("span", { className: badgeCls }, badgeText),
							),
						),
						btns,
					);
				});

				const body = state.loading
					? react.createElement("div", { className: "pm-empty" }, "加载中…")
					: (rows.length
						? react.createElement("div", null, rows)
						: react.createElement("div", { className: "pm-empty" }, "未在集合文件夹中发现插件（含 cordis.patch.yml 的子文件夹）"));

				// 详情弹窗（README）
				const modal = state.detail
					? react.createElement("div", { className: "pm-mask", onClick: closeDetail },
						react.createElement("div", { className: "pm-modal", onClick: (e) => { e.stopPropagation(); } },
							react.createElement("div", { className: "pm-modal-head" },
								react.createElement("span", { className: "pm-modal-title" }, state.detail.name),
								react.createElement("span", { className: "pm-modal-src" }, state.detail.source || ""),
								react.createElement("button", { className: "pm-btn", onClick: closeDetail }, "关闭"),
							),
							react.createElement("div", { className: "pm-modal-body" },
								state.detailLoading
									? react.createElement("div", { className: "pm-empty" }, "加载中…")
									: react.createElement("div", { className: "pm-readme", dangerouslySetInnerHTML: { __html: state.detail.html || "" } }),
							),
						),
					)
					: null;

				return react.createElement("div", { className: "pc-card" },
					react.createElement("button", { className: "pc-head", onClick: () => setOpen((v) => !v) },
						react.createElement("span", { className: "pc-head-text" },
							react.createElement("span", { className: "pc-name" }, "插件管理"),
							react.createElement("span", { className: "pc-desc" }, "管理本集合插件（启用 / 停用 / 详情）"),
						),
						react.createElement(ChevronIcon, { className: "pc-chevron" + (open ? " pc-open" : "") }),
					),
					open
						? react.createElement("div", { className: "pc-body" },
							react.createElement("div", { className: "pm-root" },
								head,
								banner,
								state.error ? react.createElement("div", { className: "pm-err" }, state.error) : null,
								body,
								state.root ? react.createElement("div", { className: "pm-rootpath" }, "集合目录：" + state.root) : null,
							),
						)
						: null,
					modal,
				);
			}

			// 注册为官方「插件」设置页的一张卡片（settings.plugin.item，替代独立标签页）
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				id: "yzlin499-plugins-manager",
				order: 30,
				label: "插件管理",
			}, Section));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
