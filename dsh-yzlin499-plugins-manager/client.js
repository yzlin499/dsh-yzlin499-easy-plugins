// ═══════════════════════════════════════════════════════════════════════════
// dsh-yzlin499-plugins-manager — Client 半侧（__ModuleLoader__ 静态格式）
//
// 注册一个 settings.section 页"插件管理"：
//   · 列出本集合（管理器父文件夹扫描）的所有插件 + 已安装状态
//   · 每个插件一个"启用/停用"开关 → POST /plugins-manager/toggle（Host 跑 dsh CLI）
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
			".pm-desc{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px;line-height:1.4;word-break:break-word}",
			".pm-badge{font-size:10px;padding:2px 7px;border-radius:999px;flex-shrink:0}",
			".pm-badge-on{background:rgba(0,200,120,.14);color:var(--dsw-alias-state-success-primary)}",
			".pm-badge-off{background:rgba(128,128,128,.15);color:var(--dsw-alias-label-secondary)}",
			".pm-badge-self{background:rgba(0,120,255,.14);color:var(--dsw-alias-brand-primary)}",
			".pm-empty{font-size:12px;color:var(--dsw-alias-label-secondary);padding:16px 4px}",
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

		const inject = ["slots"];

		function Section() {
			const [state, setState] = react.useState({
				loading: true, error: "", root: "", profile: "web",
				profileInput: "", plugins: [], pending: 0, busy: null,
			});

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

			const saveProfile = () => {
				fetch("/plugins-manager/profile", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ profile: state.profileInput.trim() }),
				})
					.then((r) => r.json())
					.then((d) => {
						if (d.ok) { setState((s) => ({ ...s, profile: d.profile })); refresh(); }
						else setState((s) => ({ ...s, error: d.error || "profile 保存失败" }));
					})
					.catch(() => setState((s) => ({ ...s, error: "profile 保存失败" })));
			};

			const toggle = (pl) => {
				if (state.busy) return;
				setState((s) => ({ ...s, busy: pl.dir, error: "" }));
				fetch("/plugins-manager/toggle", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ dir: pl.dir, enable: !pl.installed }),
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

			// 插件行
			const rows = (state.plugins || []).map((pl) => {
				const badgeCls = pl.isSelf ? "pm-badge pm-badge-self" : (pl.installed ? "pm-badge pm-badge-on" : "pm-badge pm-badge-off");
				const badgeText = pl.isSelf ? "管理器" : (pl.installed ? "已安装" : "未安装");
				let btn = null;
				if (!pl.isSelf) {
					const onClick = () => toggle(pl);
					const label = pl.installed ? "停用" : "启用";
					btn = react.createElement("button", {
						className: "pm-btn",
						disabled: state.busy != null,
						onClick,
					}, state.busy === pl.dir ? "处理中…" : label);
				}
				return react.createElement("div", { className: "pm-row", key: pl.dir },
					react.createElement("div", { className: "pm-info" },
						react.createElement("div", { className: "pm-name" },
							react.createElement("span", null, pl.name),
							react.createElement("span", { className: badgeCls }, badgeText),
						),
						pl.description
							? react.createElement("div", { className: "pm-desc" }, pl.description)
							: null,
					),
					btn,
				);
			});

			const body = state.loading
				? react.createElement("div", { className: "pm-empty" }, "加载中…")
				: (rows.length
					? react.createElement("div", null, rows)
					: react.createElement("div", { className: "pm-empty" }, "未在集合文件夹中发现插件（含 cordis.patch.yml 的子文件夹）"));

			return react.createElement("div", { className: "pm-root" },
				head,
				banner,
				state.error ? react.createElement("div", { className: "pm-err" }, state.error) : null,
				body,
				state.root ? react.createElement("div", { className: "pm-rootpath" }, "集合目录：" + state.root) : null,
			);
		}

		function apply(ctx) {
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "yzlin499-plugins",
				order: 16,
				label: "插件管理",
			}, Section));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
