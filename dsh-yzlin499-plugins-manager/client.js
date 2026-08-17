// ═══════════════════════════════════════════════════════════════════════════
// dsh-yzlin499-plugins-manager — Client 半侧（__ModuleLoader__ 静态格式）
//
// 注册为官方「插件」设置页的一张卡片（settings.plugin.item，list、additive）：
//   · 列出默认集合及用户添加目录中的所有插件 + 启用状态（dsh.profile.bundles）
//   · 设置区可添加/移除自定义集合根目录，配置持久化到 ~/.dsh/settings.yaml
//   · 每行：名称 + 状态徽标 + [详情] [启用/停用]
//   · 详情：弹窗显示插件 README——中文界面读 README.md，英文界面优先 README_EN.md
//     （缺失回退 README.md，都没有才回退 package.json description）；跟随 DSH 语言实时切换
//   · 批量开关后显示"需要重启 DSH Web 生效"横幅（不自动重启）
//   · 顶部可改目标 profile（默认 web；经 /plugins-manager/profile 路由持久化到
//     ~/.dsh/settings.yaml。注：官方 api-proxy 的 WEB_SETTINGS_NAMESPACES 白名单
//     不含第三方命名空间，settingsScope 永远 unavailable，故不走 settingsScope）
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
			".pm-head{display:flex;flex-direction:column;gap:10px}",
			".pm-profile,.pm-path-form{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".pm-input{min-width:0;background:rgba(0,0,0,.04);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;padding:6px 8px}",
			"body[data-ds-dark-theme] .pm-input{background:rgba(255,255,255,.05)}",
			".pm-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}",
			".pm-profile .pm-input{width:110px}",
			".pm-path-form .pm-input{flex:1}",
			".pm-section-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}",
			".pm-roots{display:flex;flex-direction:column;gap:6px}",
			".pm-root-row{display:flex;align-items:center;gap:8px;min-width:0;padding:7px 9px;background:rgba(0,0,0,.025);border:1px solid var(--dsw-alias-border-l1);border-radius:6px}",
			"body[data-ds-dark-theme] .pm-root-row{background:rgba(255,255,255,.025)}",
			".pm-rootpath{flex:1;min-width:0;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all}",
			".pm-source{margin-top:3px;font-size:10.5px;color:var(--dsw-alias-label-tertiary);word-break:break-all}",
			".pm-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:6px;font-size:12px;line-height:1;padding:6px 10px;cursor:pointer}",
			".pm-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}",
			".pm-btn[disabled]{opacity:.45;cursor:default}",
			".pm-banner{font-size:12px;color:var(--dsw-alias-state-warn-primary);background:rgba(255,180,0,.08);border:1px solid var(--dsw-alias-state-warn-primary);border-radius:8px;padding:8px 10px}",
			".pm-err{font-size:12px;color:var(--dsw-alias-state-error-primary);padding:8px 10px}",
			".pm-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}",
			".pm-info{flex:1;min-width:0}",
			".pm-name{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
			".pm-btns{display:flex;gap:8px;flex-shrink:0}",
			".pm-badge{font-size:10px;padding:2px 7px;border-radius:999px;flex-shrink:0}",
			".pm-badge-on{background:rgba(0,200,120,.14);color:var(--dsw-alias-state-success-primary)}",
			".pm-badge-off{background:rgba(128,128,128,.15);color:var(--dsw-alias-label-secondary)}",
			".pm-badge-self{background:rgba(0,120,255,.14);color:var(--dsw-alias-brand-primary)}",
			".pm-badge-warn{background:rgba(255,180,0,.12);color:var(--dsw-alias-state-warn-primary)}",
			".pm-list{display:flex;flex-direction:column;gap:7px}",
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

		const inject = ["slots", "locale"];

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
			// 目标 profile 持久化：走自身 /plugins-manager/profile 路由（Host 侧
			// 经 ctx.settings 写入 ~/.dsh/settings.yaml），不走 settingsScope
			// （官方 api-proxy 白名单不含第三方命名空间，settingsScope 永远不可用）
			// DSH 当前语言：'en' 才用英文，其余默认中文
			const activeLang = () => (locale && locale.getLocale().active === "en") ? "en" : "zh";
			const messages = {
				zh: {
					title: "插件管理", desc: "管理默认目录和自定义目录中的插件", targetProfile: "目标 profile",
					save: "保存", roots: "插件集合目录", pathPlaceholder: "输入集合根目录的绝对路径",
					add: "添加", remove: "移除", defaultRoot: "默认", unavailable: "目录不可用",
					manager: "管理器", enabled: "已启用", disabled: "未启用", conflict: "同名冲突", details: "详情",
					disable: "停用", enable: "启用", processing: "处理中...", loading: "加载中...",
					close: "关闭", readFailed: "读取失败", profileFailed: "profile 保存失败",
					toggleFailed: "切换失败", rootFailed: "目录保存失败", pathRequired: "请输入集合目录",
					connectFailed: "无法连接 Host（/plugins-manager/list）",
					empty: "未在集合目录中发现插件（含 cordis.patch.yml 的直接子文件夹）",
					restart: (count) => "有 " + count + " 项变更，重启 DSH Web 后生效（可继续批量开关）",
				},
				en: {
					title: "Plugin Manager", desc: "Manage plugins from default and custom directories", targetProfile: "Target profile",
					save: "Save", roots: "Plugin collection directories", pathPlaceholder: "Enter an absolute collection root path",
					add: "Add", remove: "Remove", defaultRoot: "Default", unavailable: "Unavailable",
					manager: "Manager", enabled: "Enabled", disabled: "Disabled", conflict: "Name conflict", details: "Details",
					disable: "Disable", enable: "Enable", processing: "Processing...", loading: "Loading...",
					close: "Close", readFailed: "Failed to read", profileFailed: "Failed to save profile",
					toggleFailed: "Toggle failed", rootFailed: "Failed to save directory", pathRequired: "Enter a collection directory",
					connectFailed: "Cannot connect to Host (/plugins-manager/list)",
					empty: "No plugins found in the collection directories (direct children containing cordis.patch.yml)",
					restart: (count) => count + " change(s) pending. Restart DSH Web to apply them.",
				},
			};
			const t = (key) => messages[activeLang()][key];

			function Section() {
				const [state, setState] = react.useState({
					loading: true, error: "", profile: "web", profileInput: "", roots: [], rootInput: "",
					plugins: [], pending: 0, busy: null, rootBusy: false,
					rev: 0, detail: null, detailLoading: false,
				});
				const [open, setOpen] = react.useState(false);

				react.useEffect(() => {
					if (!locale) return;
					return locale.subscribe(() => setState((s) => ({ ...s, rev: s.rev + 1 })));
				}, []);

				react.useEffect(() => {
					if (!state.detail) return;
					const requestedId = state.detail.id;
					const requestedLang = activeLang();
					const controller = new AbortController();
					setState((s) => ({ ...s, detailLoading: true }));
					fetch("/plugins-manager/readme?id=" + encodeURIComponent(requestedId) + "&lang=" + requestedLang, { signal: controller.signal })
						.then((r) => r.json())
						.then((d) => {
							setState((s) => {
								if (!s.detail || s.detail.id !== requestedId) return s;
								return {
									...s, detailLoading: false,
									detail: d.ok
										? { ...s.detail, text: d.text, html: d.html, source: d.source }
										: { ...s.detail, text: d.error || t("readFailed"), html: "", source: "" },
								};
							});
						})
						.catch((e) => {
							if (e && e.name === "AbortError") return;
							setState((s) => s.detail && s.detail.id === requestedId ? { ...s, detailLoading: false } : s);
						});
					return () => controller.abort();
				}, [state.detail && state.detail.id, state.rev]);

				const refresh = () => {
					fetch("/plugins-manager/list")
						.then((r) => r.json())
						.then((d) => {
							const nextProfile = d.profile || "web";
							setState((s) => ({
								...s, loading: false,
								profile: nextProfile,
								profileInput: s.profileInput && s.profileInput !== s.profile ? s.profileInput : nextProfile,
								roots: d.roots || [], plugins: d.plugins || [],
							}));
						})
						.catch(() => setState((s) => ({ ...s, loading: false, error: t("connectFailed") })));
				};
				react.useEffect(() => { refresh(); }, []);

				const saveProfile = () => {
					const next = state.profileInput.trim();
					setState((s) => ({ ...s, error: "" }));
					fetch("/plugins-manager/profile", {
						method: "POST", headers: { "content-type": "application/json" },
						body: JSON.stringify({ profile: next }),
					})
						.then((r) => r.json())
						.then((d) => {
							if (d && d.ok) refresh();
							else setState((s) => ({ ...s, error: (d && d.error) || t("profileFailed") }));
						})
						.catch((e) => setState((s) => ({ ...s, error: String((e && e.message) || t("profileFailed")) })));
				};

				const mutateRoot = (action, path) => {
					if (state.rootBusy || state.busy) return;
					const target = String(path || "").trim();
					if (!target) {
						setState((s) => ({ ...s, error: t("pathRequired") }));
						return;
					}
					setState((s) => ({ ...s, rootBusy: true, error: "" }));
					fetch("/plugins-manager/roots", {
						method: "POST", headers: { "content-type": "application/json" },
						body: JSON.stringify({ action, path: target }),
					})
						.then((r) => r.json())
						.then((d) => {
							if (d && d.ok) {
								setState((s) => ({ ...s, rootBusy: false, rootInput: action === "add" ? "" : s.rootInput }));
								refresh();
							} else setState((s) => ({ ...s, rootBusy: false, error: (d && d.error) || t("rootFailed") }));
						})
						.catch(() => setState((s) => ({ ...s, rootBusy: false, error: t("rootFailed") })));
				};

				const toggle = (pl) => {
					if (state.busy) return;
					setState((s) => ({ ...s, busy: pl.id, error: "" }));
					fetch("/plugins-manager/toggle", {
						method: "POST", headers: { "content-type": "application/json" },
						body: JSON.stringify({ id: pl.id, enable: !pl.enabled }),
					})
						.then((r) => r.json())
						.then((d) => {
							setState((s) => ({
								...s, busy: null, pending: d.ok ? s.pending + 1 : s.pending,
								error: d.ok ? "" : (d.error || t("toggleFailed")),
							}));
							if (d.ok) refresh();
						})
						.catch(() => setState((s) => ({ ...s, busy: null, error: t("toggleFailed") })));
				};

				const openDetail = (pl) => setState((s) => ({
					...s, detail: { id: pl.id, name: pl.name, text: "", html: "", source: "" }, detailLoading: true,
				}));
				const closeDetail = () => setState((s) => ({ ...s, detail: null }));

				const rootRows = (state.roots || []).map((root) => react.createElement("div", { className: "pm-root-row", key: root.path },
					react.createElement("span", { className: "pm-rootpath" }, root.path),
					root.isDefault ? react.createElement("span", { className: "pm-badge pm-badge-self" }, t("defaultRoot")) : null,
					!root.available ? react.createElement("span", { className: "pm-badge pm-badge-warn" }, t("unavailable")) : null,
					!root.isDefault ? react.createElement("button", {
						className: "pm-btn", disabled: state.rootBusy || state.busy != null,
						onClick: () => mutateRoot("remove", root.path),
					}, t("remove")) : null,
				));

				const head = react.createElement("div", { className: "pm-head" },
					react.createElement("div", { className: "pm-profile" },
						react.createElement("span", null, t("targetProfile")),
						react.createElement("input", {
							className: "pm-input", value: state.profileInput,
							onChange: (e) => setState((s) => ({ ...s, profileInput: e.target.value })), placeholder: "web",
						}),
						react.createElement("button", { className: "pm-btn", onClick: saveProfile, disabled: state.busy != null || state.rootBusy }, t("save")),
					),
					react.createElement("div", { className: "pm-section-label" }, t("roots")),
					react.createElement("div", { className: "pm-roots" }, rootRows),
					react.createElement("div", { className: "pm-path-form" },
						react.createElement("input", {
							className: "pm-input", value: state.rootInput, placeholder: t("pathPlaceholder"),
							onChange: (e) => setState((s) => ({ ...s, rootInput: e.target.value })),
							onKeyDown: (e) => { if (e.key === "Enter") mutateRoot("add", state.rootInput); },
						}),
						react.createElement("button", {
							className: "pm-btn", disabled: state.rootBusy || state.busy != null,
							onClick: () => mutateRoot("add", state.rootInput),
						}, t("add")),
					),
				);

				const banner = state.pending > 0
					? react.createElement("div", { className: "pm-banner" }, t("restart")(state.pending)) : null;

				const rows = (state.plugins || []).map((pl) => {
					const badgeCls = pl.nameConflict ? "pm-badge pm-badge-warn" : (pl.isSelf ? "pm-badge pm-badge-self" : (pl.enabled ? "pm-badge pm-badge-on" : "pm-badge pm-badge-off"));
					const badgeText = pl.nameConflict ? t("conflict") : (pl.isSelf ? t("manager") : (pl.enabled ? t("enabled") : t("disabled")));
					let btns = null;
					if (!pl.isSelf) {
						btns = react.createElement("div", { className: "pm-btns" },
							react.createElement("button", { className: "pm-btn", onClick: () => openDetail(pl) }, t("details")),
							!pl.nameConflict ? react.createElement("button", {
								className: "pm-btn", disabled: state.busy != null || state.rootBusy, onClick: () => toggle(pl),
							}, state.busy === pl.id ? t("processing") : (pl.enabled ? t("disable") : t("enable"))) : null,
						);
					}
					return react.createElement("div", { className: "pm-row", key: pl.id },
						react.createElement("div", { className: "pm-info" },
							react.createElement("div", { className: "pm-name" },
								react.createElement("span", null, pl.name),
								react.createElement("span", { className: badgeCls }, badgeText),
							),
							react.createElement("div", { className: "pm-source" }, pl.root),
						),
						btns,
					);
				});

				const body = state.loading
					? react.createElement("div", { className: "pm-empty" }, t("loading"))
					: (rows.length ? react.createElement("div", { className: "pm-list" }, rows)
						: react.createElement("div", { className: "pm-empty" }, t("empty")));

				const modal = state.detail
					? react.createElement("div", { className: "pm-mask", onClick: closeDetail },
						react.createElement("div", { className: "pm-modal", onClick: (e) => { e.stopPropagation(); } },
							react.createElement("div", { className: "pm-modal-head" },
								react.createElement("span", { className: "pm-modal-title" }, state.detail.name),
								react.createElement("span", { className: "pm-modal-src" }, state.detail.source || ""),
								react.createElement("button", { className: "pm-btn", onClick: closeDetail }, t("close")),
							),
							react.createElement("div", { className: "pm-modal-body" },
								state.detailLoading ? react.createElement("div", { className: "pm-empty" }, t("loading"))
									: react.createElement("div", { className: "pm-readme", dangerouslySetInnerHTML: { __html: state.detail.html || "" } }),
							),
						),
					) : null;

				return react.createElement("div", { className: "pc-card" },
					react.createElement("button", { className: "pc-head", onClick: () => setOpen((v) => !v) },
						react.createElement("span", { className: "pc-head-text" },
							react.createElement("span", { className: "pc-name" }, t("title")),
							react.createElement("span", { className: "pc-desc" }, t("desc")),
						),
						react.createElement(ChevronIcon, { className: "pc-chevron" + (open ? " pc-open" : "") }),
					),
					open ? react.createElement("div", { className: "pc-body" },
						react.createElement("div", { className: "pm-root" },
							head, banner,
							state.error ? react.createElement("div", { className: "pm-err" }, state.error) : null,
							body,
						),
					) : null,
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
