// ═══════════════════════════════════════════════════════════════════════════
// dsh-win-notify — Client 半侧（__ModuleLoader__ 静态格式，由 dsh-client-modules 提供）
//
// 1) 设置卡片：注册进官方「插件」设置页（settings.plugin.item）：
//    · 总开关 + 三类时机开关（权限申请 / 提问 / 运行停止）
//    · 通知时机：总是通知 / 仅页面在后台时
//    · 实时显示当前页面状态（前台/后台）——仅后台模式依赖它
//    配置经本插件自己的 /win-notify/config 路由读写（官方 api-proxy 的
//    WEB_SETTINGS_NAMESPACES 白名单不含第三方命名空间，settingsScope 不可用）。
// 2) 页面可见性上报：浏览器 document.visibilityState 自动给出「标签页隐藏 /
//    窗口最小化 / 被遮挡」状态（无需鼠标检测），变化时 POST 给 Host。
// ═══════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
	id: "dsh-win-notify",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		//#region styles
		const css = [
			".wn-card{display:flex;flex-direction:column;gap:10px}",
			".wn-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".wn-row input[type=checkbox]{accent-color:var(--dsw-alias-brand-primary)}",
			".wn-label{width:96px;flex-shrink:0;color:var(--dsw-alias-label-primary)}",
			".wn-hint{font-size:10.5px;color:var(--dsw-alias-label-secondary);opacity:.75}",
			".wn-select{background:rgba(0,0,0,.22);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;padding:4px 7px}",
			".wn-select:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}",
			".wn-foot{display:flex;align-items:center;gap:10px;margin-top:2px}",
			".wn-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:6px;font-size:12px;line-height:1;padding:5px 12px;cursor:pointer}",
			".wn-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}",
			".wn-btn[disabled]{opacity:.45;cursor:default}",
			".wn-status{font-size:11px;color:var(--dsw-alias-label-secondary)}",
			".wn-badge{font-size:10px;padding:2px 8px;border-radius:999px}",
			".wn-badge-fg{background:rgba(0,200,120,.14);color:var(--dsw-alias-state-success-primary)}",
			".wn-badge-bg{background:rgba(255,180,0,.14);color:var(--dsw-alias-state-warn-primary)}",
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
		const tagId = "dsh-win-notify/style";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-win-notify";
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
				d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 9.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12705 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
				fill: "currentColor",
			}));
		}

		function apply(ctx) {
			const locale = ctx.get("locale");
			const activeLang = () => (locale && locale.getLocale().active === "en") ? "en" : "zh";

			// ── 页面可见性上报（浏览器自动给出，无需鼠标检测）──
			function reportVisible() {
				let visible = true;
				try { visible = document.visibilityState !== "hidden"; } catch (e) { /* 忽略 */ }
				try {
					fetch("/win-notify/visibility", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ visible }),
					}).catch(() => {});
				} catch (e) { /* 忽略 */ }
			}
			ctx.effect(() => {
				if (typeof document === "undefined") return;
				reportVisible();
				document.addEventListener("visibilitychange", reportVisible);
				return () => document.removeEventListener("visibilitychange", reportVisible);
			});

			function SettingsCard() {
				const [cfg, setCfg] = react.useState({
					enabled: true, notifyApproval: true, notifyQuestion: true, notifyDone: true,
					mode: "always", pageVisible: true, loading: true, status: "", rev: 0,
				});
				const [open, setOpen] = react.useState(false);
				const lang = activeLang();
				const T = lang === "en" ? {
					name: "Windows Notify",
					desc: "Native toasts on approval, question, run done",
					enabled: "Enable", approval: "Approval", question: "Question", done: "Run done",
					mode: "When", always: "Always", background: "Background only",
					page: "Page", foreground: "Foreground", backgroundNow: "Background",
					save: "Save", saved: "Saved", saving: "Saving…", loadFail: "Load failed", saveFail: "Save failed",
				} : {
					name: "Windows 通知",
					desc: "权限申请 / 提问 / 运行停止时弹原生吐司",
					enabled: "启用通知", approval: "权限申请", question: "发起提问", done: "运行停止",
					mode: "通知时机", always: "总是通知", background: "仅页面在后台时",
					page: "当前页面", foreground: "前台", backgroundNow: "后台",
					save: "保存", saved: "已保存", saving: "保存中…", loadFail: "读取失败", saveFail: "保存失败",
				};

				react.useEffect(() => {
					let alive = true;
					const load = () => {
						fetch("/win-notify/config")
							.then((r) => r.json())
							.then((d) => {
								if (!alive) return;
								setCfg((s) => ({
									...s, loading: false, status: "",
									enabled: d && typeof d.enabled === "boolean" ? d.enabled : s.enabled,
									notifyApproval: d && typeof d.notifyApproval === "boolean" ? d.notifyApproval : s.notifyApproval,
									notifyQuestion: d && typeof d.notifyQuestion === "boolean" ? d.notifyQuestion : s.notifyQuestion,
									notifyDone: d && typeof d.notifyDone === "boolean" ? d.notifyDone : s.notifyDone,
									mode: d && (d.mode === "always" || d.mode === "background") ? d.mode : s.mode,
									pageVisible: d && typeof d.pageVisible === "boolean" ? d.pageVisible : s.pageVisible,
								}));
							})
							.catch(() => { if (alive) setCfg((s) => ({ ...s, loading: false, status: T.loadFail })); });
					};
					load();
					// 语言切换后重取标签（标签由 render 按 lang 生成，这里只需重渲染）
					let off = null;
					if (locale) off = locale.subscribe(() => setCfg((s) => ({ ...s, rev: s.rev + 1 })));
					const iv = setInterval(load, 5000); // 顺带刷新页面前台/后台状态
					return () => { alive = false; if (off) off(); clearInterval(iv); };
				}, []);

				const save = () => {
					setCfg((s) => ({ ...s, status: T.saving }));
					fetch("/win-notify/config", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							enabled: cfg.enabled,
							notifyApproval: cfg.notifyApproval,
							notifyQuestion: cfg.notifyQuestion,
							notifyDone: cfg.notifyDone,
							mode: cfg.mode,
						}),
					})
						.then((r) => r.json())
						.then((d) => setCfg((s) => ({
							...s,
							status: d && d.ok ? T.saved : ((d && d.error) || T.saveFail),
							enabled: d && typeof d.enabled === "boolean" ? d.enabled : s.enabled,
							notifyApproval: d && typeof d.notifyApproval === "boolean" ? d.notifyApproval : s.notifyApproval,
							notifyQuestion: d && typeof d.notifyQuestion === "boolean" ? d.notifyQuestion : s.notifyQuestion,
							notifyDone: d && typeof d.notifyDone === "boolean" ? d.notifyDone : s.notifyDone,
							mode: d && (d.mode === "always" || d.mode === "background") ? d.mode : s.mode,
						})))
						.catch(() => setCfg((s) => ({ ...s, status: T.saveFail })));
				};

				const toggleRow = (label, checked, onChange, hint) =>
					react.createElement("label", { className: "wn-row" },
						react.createElement("input", { type: "checkbox", checked: !!checked, onChange: (e) => onChange(e.target.checked) }),
						react.createElement("span", { className: "wn-label" }, label),
						hint ? react.createElement("span", { className: "wn-hint" }, hint) : null,
					);

				const pageBadge = cfg.pageVisible
					? react.createElement("span", { className: "wn-badge wn-badge-fg" }, T.foreground)
					: react.createElement("span", { className: "wn-badge wn-badge-bg" }, T.backgroundNow);

				return react.createElement("div", { className: "pc-card" },
					react.createElement("button", { className: "pc-head", onClick: () => setOpen((v) => !v) },
						react.createElement("span", { className: "pc-head-text" },
							react.createElement("span", { className: "pc-name" }, T.name),
							react.createElement("span", { className: "pc-desc" }, T.desc),
						),
						react.createElement(ChevronIcon, { className: "pc-chevron" + (open ? " pc-open" : "") }),
					),
					open
						? react.createElement("div", { className: "pc-body" },
							react.createElement("div", { className: "wn-card" },
								toggleRow(T.enabled, cfg.enabled, (v) => setCfg((s) => ({ ...s, enabled: v }))),
								toggleRow(T.approval, cfg.notifyApproval, (v) => setCfg((s) => ({ ...s, notifyApproval: v }))),
								toggleRow(T.question, cfg.notifyQuestion, (v) => setCfg((s) => ({ ...s, notifyQuestion: v }))),
								toggleRow(T.done, cfg.notifyDone, (v) => setCfg((s) => ({ ...s, notifyDone: v }))),
								react.createElement("label", { className: "wn-row" },
									react.createElement("span", { className: "wn-label" }, T.mode),
									react.createElement("select", {
										className: "wn-select",
										value: cfg.mode,
										onChange: (e) => setCfg((s) => ({ ...s, mode: e.target.value })),
									},
										react.createElement("option", { value: "always" }, T.always),
										react.createElement("option", { value: "background" }, T.background),
									),
									react.createElement("span", { className: "wn-hint" }, cfg.mode === "background" ? T.page + ": " : null, cfg.mode === "background" ? pageBadge : null),
								),
								react.createElement("div", { className: "wn-foot" },
									react.createElement("button", { className: "wn-btn", onClick: save, disabled: cfg.loading }, T.save),
									cfg.status ? react.createElement("span", { className: "wn-status" }, cfg.status) : null,
								),
							),
						)
						: null,
				);
			}

			// 注册为官方「插件」设置页的一张卡片
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				id: "win-notify-settings",
				order: 40,
				label: "Windows 通知",
			}, SettingsCard));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
