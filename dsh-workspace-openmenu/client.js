// ═══════════════════════════════════════════════════════════════════════════
// dsh-workspace-openmenu — Client 半侧（__ModuleLoader__ 静态格式）
//
// 注册进 conversation.session.header.utilities（会话头部右上角工具区，
// session-log 按钮左侧，order: -10）：
//   · 「打开为」按钮 → 下拉二级菜单：pwsh / cmd / 资源管理器 / vscode
//   · 点击项 → POST /workspace-open/open { sessionId, app }
//     Host 按会话工作区根（SessionHeader.cwd）启动对应应用
// ═══════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
	id: "dsh-workspace-openmenu",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		//#region styles
		// 主题适配：仅使用令牌表里真实存在的 --dsw-alias-* 变量；深色模式经
		// body[data-ds-dark-theme]（官方切换机制）做覆盖，无需 JS 检测。
		const css = [
			".wo-root{position:relative;display:inline-flex}",
			".wo-btn{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 10px;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;white-space:nowrap}",
			".wo-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1);background:rgba(0,0,0,.06)}",
			"body[data-ds-dark-theme] .wo-btn:hover{background:rgba(255,255,255,.08)}",
			".wo-btn .wo-caret{margin-left:2px;font-size:9px;opacity:.7}",
			".wo-menu{position:absolute;top:calc(100% + 4px);right:0;z-index:2147483000;min-width:160px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.18);padding:4px;display:flex;flex-direction:column}",
			"body[data-ds-dark-theme] .wo-menu{background:var(--dsw-alias-bg-base);box-shadow:0 8px 28px rgba(0,0,0,.6)}",
			".wo-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 10px;border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;cursor:pointer;background:transparent;border:none;text-align:left}",
			".wo-item:hover{background:rgba(0,0,0,.06)}",
			"body[data-ds-dark-theme] .wo-item:hover{background:rgba(255,255,255,.08)}",
			".wo-item .wo-hint{font-size:10.5px;color:var(--dsw-alias-label-secondary);opacity:.75}",
			".wo-status{font-size:11px;padding:6px 10px;border-radius:6px;margin-top:2px;color:var(--dsw-alias-state-error-primary)}",
		].join("");
		const tagId = "dsh-workspace-openmenu/style";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-workspace-openmenu";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		const inject = ["slots"];

		const MENU = [
			{ app: "pwsh", label: "pwsh", hint: "PowerShell 7" },
			{ app: "cmd", label: "cmd", hint: "命令提示符" },
			{ app: "explorer", label: "资源管理器", hint: "Explorer" },
			{ app: "vscode", label: "vscode", hint: "VS Code" },
		];

		function OpenMenu({ sessionId }) {
			const [open, setOpen] = react.useState(false);
			const [busy, setBusy] = react.useState(null);
			const [status, setStatus] = react.useState(null);

			// 点击菜单外部关闭
			react.useEffect(() => {
				if (!open) return;
				const onDown = (e) => {
					if (e.target && e.target.closest && !e.target.closest(".wo-root")) setOpen(false);
				};
				document.addEventListener("mousedown", onDown);
				return () => document.removeEventListener("mousedown", onDown);
			}, [open]);

			const pick = (item) => {
				if (busy) return;
				setBusy(item.app);
				setStatus(null);
				fetch("/workspace-open/open", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ sessionId, app: item.app }),
				})
					.then((r) => r.json())
					.then((d) => {
						setBusy(null);
						if (d.ok) { setStatus(null); setOpen(false); }
						else setStatus({ ok: false, text: d.error || "失败" });
					})
					.catch(() => {
						setBusy(null);
						setStatus({ ok: false, text: "请求失败" });
					});
			};

			const items = MENU.map((m) =>
				react.createElement("button", {
					className: "wo-item",
					key: m.app,
					disabled: busy != null,
					onClick: () => pick(m),
				},
					react.createElement("span", null, busy === m.app ? "打开中…" : m.label),
					m.hint ? react.createElement("span", { className: "wo-hint" }, m.hint) : null,
				),
			);

			const menu = open
				? react.createElement("div", { className: "wo-menu" },
					items,
					status
						? react.createElement("div", { className: "wo-status wo-status-err" }, status.text)
						: null,
				)
				: null;

			return react.createElement("div", { className: "wo-root" },
				react.createElement("button", {
					className: "wo-btn",
					title: "在工作区位置打开…",
					onClick: () => setOpen((v) => !v),
				},
					react.createElement("span", null, "打开为"),
					react.createElement("span", { className: "wo-caret" }, "▼"),
				),
				menu,
			);
		}

		function apply(ctx) {
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "workspace-open",
				order: -10,
				label: "打开为",
			}, OpenMenu));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
