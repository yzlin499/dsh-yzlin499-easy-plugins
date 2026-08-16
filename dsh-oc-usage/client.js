// ═══════════════════════════════════════════════════════════════════════════
// dsh-oc-usage — Client 半侧（__ModuleLoader__ 静态格式，由 dsh-client-modules 提供）
//
// 注册进 `shell.overlay`（帧级浮动层，click-through，条目自行开启 pointer-events）。
// 悬浮窗功能：
//   · 显示 5小时 / 7天 / 30天 用量条 + 百分比 + 重置倒计时
//   · 5 分钟自动刷新 + 手动刷新
//   · 拖拽移动、最小化为小胶囊、配置 Cookie / Workspace
//   · Cookie 只在 Host 内存，前端只存输入框草稿，不回显已保存值
// RPC：同源 fetch 打 Host 注册的 /oc-usage/* 路由（见 index.js）。
// ═══════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
	id: "dsh-oc-usage",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		//#region styles
		const css = [
			".ocu-root{position:fixed;z-index:2147483000;pointer-events:auto;font-family:system-ui,'Segoe UI',sans-serif}",
			".ocu-window{width:264px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.35);overflow:hidden;user-select:none}",
			".ocu-head{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;cursor:move;background:rgba(255,255,255,.05);border-bottom:1px solid var(--dsw-alias-border-l1)}",
			".ocu-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:6px}",
			".ocu-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-brand-primary)}",
			".ocu-btns{display:flex;gap:4px}",
			".ocu-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:6px;font-size:11px;line-height:1;padding:4px 6px;cursor:pointer}",
			".ocu-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}",
			".ocu-btn[disabled]{opacity:.45;cursor:default}",
			".ocu-body{padding:10px 12px}",
			".ocu-row{display:flex;align-items:center;gap:8px;margin:7px 0}",
			".ocu-label{width:36px;font-size:11px;color:var(--dsw-alias-label-secondary);flex-shrink:0}",
			".ocu-track{flex:1;height:6px;background:rgba(255,255,255,.10);border-radius:999px;overflow:hidden}",
			".ocu-fill{height:100%;border-radius:999px;transition:width .3s ease;min-width:0}",
			".ocu-pct{width:40px;font-size:11px;font-weight:600;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums}",
			".ocu-reset{width:62px;font-size:10px;color:var(--dsw-alias-label-secondary);text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums}",
			".ocu-msg{font-size:11px;color:var(--dsw-alias-state-error-primary);margin:6px 0;line-height:1.4;word-break:break-all}",
			".ocu-hint{font-size:10px;color:var(--dsw-alias-label-secondary);margin:6px 0;line-height:1.45}",
			".ocu-foot{padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:6px}",
			".ocu-input{width:100%;box-sizing:border-box;background:rgba(0,0,0,.22);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:11px;padding:5px 7px}",
			".ocu-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}",
			".ocu-save-row{display:flex;align-items:center;gap:8px}",
			".ocu-save{margin-left:auto}",
			".ocu-meta{font-size:10px;color:var(--dsw-alias-label-secondary);padding:0 12px 8px}",
			".ocu-pill{display:inline-flex;align-items:center;gap:7px;padding:7px 12px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.3);cursor:pointer;font-size:11px;color:var(--dsw-alias-label-primary)}",
			".ocu-pill:hover{border-color:var(--dsw-alias-brand-primary)}",
			".ocu-s-card{display:flex;flex-direction:column;gap:8px}",
			".ocu-s-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".ocu-s-label{width:100px;flex-shrink:0}",
			".ocu-s-input{flex:1;min-width:0;background:rgba(0,0,0,.22);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;padding:5px 7px}",
			".ocu-s-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}",
			".ocu-s-hint{font-size:11px;color:var(--dsw-alias-label-secondary)}",
			".ocu-s-foot{display:flex;align-items:center;gap:10px;margin-top:2px}",
			".ocu-s-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:6px;font-size:12px;line-height:1;padding:5px 12px;cursor:pointer}",
			".ocu-s-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}",
			".ocu-s-btn[disabled]{opacity:.45;cursor:default}",
			".ocu-s-status{font-size:11px;color:var(--dsw-alias-label-secondary)}",
			// 官方插件卡片外壳（对齐 PluginCard）
			".pc-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;overflow:hidden}",
			".pc-head{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;display:flex;align-items:center;gap:12px;padding:14px 16px}",
			".pc-head-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}",
			".pc-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
			".pc-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}",
			".pc-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}",
			".pc-open{transform:rotate(180deg)}",
			".pc-body{border-top:1px solid var(--dsw-alias-border-l2);padding:14px 16px}"
		].join("");
		const tagId = "dsh-oc-usage/style";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-oc-usage";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region helpers
		function fmtDuration(sec) {
			if (sec == null || !Number.isFinite(sec)) return "—";
			sec = Math.max(0, Math.floor(sec));
			const d = Math.floor(sec / 86400);
			const h = Math.floor((sec % 86400) / 3600);
			const m = Math.floor((sec % 3600) / 60);
			const s = sec % 60;
			if (d > 0) return d + "天 " + h + "时";
			if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
			return m + ":" + String(s).padStart(2, "0");
		}
		function usageColor(pct) {
			if (pct == null || !Number.isFinite(pct)) return "var(--dsw-alias-label-secondary)";
			if (pct >= 80) return "var(--dsw-alias-state-error-primary)";
			if (pct >= 50) return "var(--dsw-alias-state-warn-primary)";
			return "var(--dsw-alias-state-success-primary)";
		}
		function pctText(pct) {
			return pct != null && Number.isFinite(pct) ? pct + "%" : "—";
		}
		function fmtTime(ts) {
			if (!ts) return "";
			const d = new Date(ts);
			return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
		}
		/** 同源 RPC：GET 无 body；POST 传 JSON */
		async function api(path, body) {
			const opt = body === undefined
				? { method: "GET", headers: { accept: "application/json" } }
				: { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) };
			const resp = await fetch(path, opt);
			return resp.json();
		}
		//#endregion

		//#region Overlay component
		function Overlay() {
			const [open, setOpen] = react.useState(true);
			const [data, setData] = react.useState(null);
			const [loading, setLoading] = react.useState(false);
			const [cookie, setCookie] = react.useState("");
			const [workspaceId, setWorkspaceId] = react.useState("");
			const [cookieSet, setCookieSet] = react.useState(false);
			const [showConfig, setShowConfig] = react.useState(false);
			const [saving, setSaving] = react.useState(false);
			const [pos, setPos] = react.useState(null);
			const dragRef = react.useRef(null);
			const cookieSetRef = react.useRef(false);

			const refresh = react.useCallback(async () => {
				if (!cookieSetRef.current) return;
				setLoading(true);
				try {
					const r = await api("/oc-usage/query");
					console.log("[oc-usage] query result:", r);
					setData(r);
				} catch (e) {
					console.error("[oc-usage] query failed:", e);
					setData({ isValid: false, message: String((e && e.message) || e) });
				}
				setLoading(false);
			}, []);

			// 挂载：读配置状态 → 有 Cookie 则自动查询；5 分钟自动刷新
			react.useEffect(() => {
				api("/oc-usage/config-get").then((r) => {
					setCookieSet(!!r.cookieSet);
					cookieSetRef.current = !!r.cookieSet;
					setWorkspaceId(r.workspaceId || "");
					if (r.cookieSet) refresh();
				}).catch(() => {});
				const t = setInterval(() => { if (cookieSetRef.current) refresh(); }, 5 * 60 * 1000);
				return () => clearInterval(t);
			}, [refresh]);

			// 拖拽（元素内事件）
			const onHeaderDown = (e) => {
				if (e.button !== 0) return;
				const rect = e.currentTarget.getBoundingClientRect();
				dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
			};
			const onRootMove = (e) => {
				if (!dragRef.current) return;
				setPos({ x: e.clientX - dragRef.current.dx, y: e.clientY - dragRef.current.dy });
			};
			const onRootUp = () => { dragRef.current = null; };

			const save = async () => {
				setSaving(true);
				try {
					await api("/oc-usage/config-set", { cookie, workspaceId });
					cookieSetRef.current = !!cookie.trim();
					setCookieSet(cookieSetRef.current);
					setShowConfig(false);
					refresh();
				} catch (e) {
					setData({ isValid: false, message: String((e && e.message) || e) });
				}
				setSaving(false);
			};

			// ── 最小化胶囊 ──
			if (!open) {
				const p5 = data && data.isValid && data.rolling ? data.rolling.usagePercent : null;
				return react.createElement(
					"div",
					{ className: "ocu-root", style: pos ? { left: pos.x, top: pos.y } : { right: 16, top: 72 } },
					react.createElement(
						"div",
						{ className: "ocu-pill", title: "OpenCode 用量（点击展开）", onClick: () => setOpen(true) },
						react.createElement("span", { className: "ocu-dot" }),
						react.createElement("span", null, "OpenCode " + pctText(p5))
					)
				);
			}

			// ── 展开窗口 ──
			const rows = [
				{ key: "rolling", label: "5小时" },
				{ key: "weekly", label: "7天" },
				{ key: "monthly", label: "30天" }
			];
			return react.createElement(
				"div",
				{ className: "ocu-root", style: pos ? { left: pos.x, top: pos.y } : { right: 16, top: 72 }, onMouseMove: onRootMove, onMouseUp: onRootUp },
				react.createElement(
					"div",
					{ className: "ocu-window" },
					// 头部（拖拽柄）
					react.createElement(
						"div",
						{ className: "ocu-head", onMouseDown: onHeaderDown },
						react.createElement(
							"div",
							{ className: "ocu-title" },
							react.createElement("span", { className: "ocu-dot" }),
							react.createElement("span", null, "OpenCode 用量")
						),
						react.createElement(
							"div",
							{ className: "ocu-btns" },
							react.createElement("button", { className: "ocu-btn", title: "刷新", disabled: loading, onClick: refresh }, "⟳"),
							react.createElement("button", { className: "ocu-btn", title: "配置", onClick: () => setShowConfig(!showConfig) }, "⚙"),
							react.createElement("button", { className: "ocu-btn", title: "最小化", onClick: () => setOpen(false) }, "—")
						)
					),
					// 主体
					react.createElement(
						"div",
						{ className: "ocu-body" },
						data && !data.isValid
							? react.createElement("div", { className: "ocu-msg" }, data.message || "查询失败")
							: rows.map((r) => {
								const w = (data && data[r.key]) || {};
								const pct = w.usagePercent;
								const color = usageColor(pct);
								const width = pct != null && Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
								return react.createElement(
									"div",
									{ className: "ocu-row", key: r.key },
									react.createElement("span", { className: "ocu-label" }, r.label),
									react.createElement(
										"div",
										{ className: "ocu-track" },
										react.createElement("div", { className: "ocu-fill", style: { width: width + "%", background: color } })
									),
									react.createElement("span", { className: "ocu-pct", style: { color } }, pctText(pct)),
									react.createElement("span", { className: "ocu-reset" }, fmtDuration(w.resetInSec))
								);
							}),
						!cookieSet
							? react.createElement("div", { className: "ocu-hint" }, "未配置 Cookie：点 ⚙ 粘贴 opencode.ai 登录后的 Cookie（含 auth=）")
							: null,
						showConfig
							? react.createElement(
								"div",
								{ className: "ocu-foot" },
								react.createElement("input", {
									className: "ocu-input",
									type: "password",
									placeholder: "opencode.ai Cookie（含 auth=，留空不修改）",
									value: cookie,
									onChange: (e) => setCookie(e.target.value)
								}),
								react.createElement("input", {
									className: "ocu-input",
									type: "text",
									placeholder: "Workspace ID（wrk_…，留空自动发现）",
									value: workspaceId,
									onChange: (e) => setWorkspaceId(e.target.value)
								}),
								react.createElement(
									"div",
									{ className: "ocu-save-row" },
									react.createElement("span", { className: "ocu-hint", style: { margin: 0 } }, "Cookie 只存 Host 内存，不落盘"),
									react.createElement("button", { className: "ocu-btn ocu-save", disabled: saving, onClick: save }, saving ? "保存中…" : "保存")
								)
							)
							: null
					),
					// 底部元信息（不显示 wrk_ workspace id）
					react.createElement("div", { className: "ocu-meta" }, "更新于 " + fmtTime(data && data.updatedAt))
				)
			);
		}
		//#endregion

		/** 注册进 shell.overlay（帧级浮动层）+ settings.plugin.item（官方插件设置卡片） */
		const inject = ["slots", "settingsScope"];

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
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "oc-usage-window",
				order: 100,
				label: "OpenCode 用量"
			}, Overlay));

			// 设置卡片：workspaceId 经官方 settings 持久化；Cookie 仍走内存路由（红线）
			const wsScope = ctx.settingsScope.bind({ namespace: "dsh-oc-usage" });

			function SettingsCard() {
				const [state, setState] = react.useState({ cookie: "", workspaceId: "", cookieSet: false, saving: false, status: "" });
				const [open, setOpen] = react.useState(false);

				react.useEffect(() => {
					api("/oc-usage/config-get").then((r) => {
						setState((s) => ({ ...s, cookieSet: !!r.cookieSet }));
					}).catch(() => {});
					const sync = () => {
						const snap = wsScope.getSnapshot();
						const v = snap.value;
						setState((s) => ({
							...s,
							workspaceId: v && v.workspaceId != null ? v.workspaceId : s.workspaceId,
							status: snap.status === "unavailable" ? "设置不可用（内存模式）" : s.status,
						}));
					};
					sync();
					return wsScope.subscribe(sync);
				}, []);

				const save = async () => {
					setState((s) => ({ ...s, saving: true, status: "" }));
					try {
						await api("/oc-usage/config-set", { cookie: state.cookie });
						if (state.workspaceId.trim()) await wsScope.set("workspaceId", state.workspaceId.trim());
						setState((s) => ({
							...s, saving: false,
							cookieSet: !!state.cookie.trim(),
							status: "已保存（Cookie 只存 Host 内存）",
						}));
					} catch (e) {
						setState((s) => ({ ...s, saving: false, status: String((e && e.message) || e) }));
					}
				};

				const input = (label, value, onChange, placeholder, type) =>
					react.createElement("label", { className: "ocu-s-row" },
						react.createElement("span", { className: "ocu-s-label" }, label),
						react.createElement("input", {
							className: "ocu-s-input",
							type: type || "text",
							value: value,
							placeholder: placeholder || "",
							onChange: (e) => onChange(e.target.value),
						}),
					);

				return react.createElement("div", { className: "pc-card" },
					react.createElement("button", { className: "pc-head", onClick: () => setOpen((v) => !v) },
						react.createElement("span", { className: "pc-head-text" },
							react.createElement("span", { className: "pc-name" }, "OpenCode 用量"),
							react.createElement("span", { className: "pc-desc" }, "悬浮窗配置（Cookie / 工作区）"),
						),
						react.createElement(ChevronIcon, { className: "pc-chevron" + (open ? " pc-open" : "") }),
					),
					open
						? react.createElement("div", { className: "pc-body" },
							react.createElement("div", { className: "ocu-s-card" },
								react.createElement("div", { className: "ocu-s-hint" },
									state.cookieSet
										? "已配置 Cookie（出于安全不回显，如需更换请重新粘贴）"
										: "尚未配置 Cookie",
								),
								input("Cookie", state.cookie, (v) => setState((s) => ({ ...s, cookie: v })),
									"粘贴 opencode.ai 登录后的完整 Cookie（含 auth=）", "password"),
								input("Workspace ID", state.workspaceId, (v) => setState((s) => ({ ...s, workspaceId: v })),
									"留空自动发现，或填 wrk_…"),
								react.createElement("div", { className: "ocu-s-foot" },
									react.createElement("button", { className: "ocu-s-btn", disabled: state.saving, onClick: save },
										state.saving ? "保存中…" : "保存"),
									state.status ? react.createElement("span", { className: "ocu-s-status" }, state.status) : null,
								),
							),
						)
						: null,
				);
			}

			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				id: "oc-usage-settings",
				order: 20,
				label: "OpenCode 用量"
			}, SettingsCard));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
