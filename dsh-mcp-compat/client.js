// ═══════════════════════════════════════════════════════════════════════════
// dsh-mcp-compat — Client 半侧（__ModuleLoader__ 静态格式，由 dsh-client-modules 提供）
//
// 设置卡片：注册进官方「插件」设置页（settings.plugin.item，keyed 插槽，以
// Host 侧注册的 settings 命名空间 dsh-mcp-compat 为键）。
// 配置读写走插件自己的 /mcp-compat/config 路由，Host 侧经 ctx.settings
// 持久化到 ~/.dsh/settings.yaml。
//
// 卡片内容：选择要扫描的 MCP 配置源（family：claude / cursor / opencode / codex）。
// ═══════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
	id: "dsh-mcp-compat",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		//#region styles
		const css = [
			".mc-card{display:flex;flex-direction:column;gap:10px}",
			".mc-item{display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".mc-item label{display:flex;gap:8px;align-items:flex-start;cursor:pointer;line-height:1.4}",
			".mc-item input{width:14px;height:14px;margin-top:1px;accent-color:var(--dsw-alias-brand-primary)}",
			".mc-label{display:flex;flex-direction:column;gap:2px}",
			".mc-name{color:var(--dsw-alias-label-primary)}",
			".mc-hint{font-size:10.5px;color:var(--dsw-alias-label-tertiary)}",
			".mc-foot{display:flex;align-items:center;gap:10px;margin-top:2px}",
			".mc-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:6px;font-size:12px;line-height:1;padding:5px 12px;cursor:pointer}",
			".mc-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}",
			".mc-btn[disabled]{opacity:.45;cursor:default}",
			".mc-status{font-size:11px;color:var(--dsw-alias-label-secondary)}",
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
		const tagId = "dsh-mcp-compat/style";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-mcp-compat";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		const inject = ["slots"];

		function ChevronIcon({ className }) {
			return react.createElement("svg", {
				width: 14, height: 14, viewBox: "0 0 14 14", fill: "none",
				xmlns: "http://www.w3.org/2000/svg", className,
			}, react.createElement("path", {
				d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
				fill: "currentColor",
			}));
		}

		function apply(ctx) {
			function configWslText(wsl) {
				if (!wsl || !wsl.detected) return "未检测到 WSL，无需改写（直连 localhost）";
				const ip = wsl.hostIp ? "宿主机 IP " + wsl.hostIp : "未解析到宿主机 IP（可设置环境变量 WSL_HOST_IP）";
				const mode = wsl.mode && wsl.mode.length ? "；已启用兼容: " + wsl.mode.join("、") : "；localhost 连接失败时自动启用兼容（同端口隧道 / 地址改写）";
				return "已检测到 WSL，" + ip + mode;
			}

			function SettingsCard() {
				const [cfg, setCfg] = react.useState({ scanners: [], all: [], labels: {}, wsl: null, compat: true, autoForward: true, fwdStatus: "", loading: true, status: "" });
				const [open, setOpen] = react.useState(false);

				react.useEffect(() => {
					let alive = true;
					fetch("/mcp-compat/config")
						.then((r) => r.json())
						.then((d) => {
							if (!alive) return;
							const list = Array.isArray(d && d.scanners) ? d.scanners : [];
							setCfg((s) => ({
								...s,
								loading: false,
								scanners: list,
								all: Array.isArray(d && d.all) ? d.all : [],
								labels: d && d.labels || {},
								wsl: (d && d.wsl) || null,
								compat: !!(d && d.wsl && d.wsl.compat),
								autoForward: !!(d && d.wsl && d.wsl.autoForward),
								status: "",
							}));
						})
						.catch(() => {
							if (!alive) return;
							setCfg((s) => ({ ...s, loading: false, status: "读取失败" }));
						});
					return () => { alive = false; };
				}, []);

				const toggle = (name) => {
					setCfg((s) => ({
						...s,
						scanners: s.scanners.includes(name)
							? s.scanners.filter((x) => x !== name)
							: [...s.scanners, name],
					}));
				};

				const save = () => {
					setCfg((s) => ({ ...s, status: "保存中…" }));
					fetch("/mcp-compat/config", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ scanners: cfg.scanners, wslCompat: cfg.compat, wslAutoForward: cfg.autoForward }),
					})
						.then((r) => r.json())
						.then((d) => {
							if (d && d.ok) {
								setCfg((s) => ({
									...s,
									scanners: Array.isArray(d.scanners) ? d.scanners : s.scanners,
									status: "已保存，已按新配置重建挂载",
								}));
							} else {
								setCfg((s) => ({ ...s, status: (d && d.error) || "保存失败" }));
							}
						})
						.catch((e) => setCfg((s) => ({ ...s, status: String((e && e.message) || "保存失败") })));
				};

				const runWslForward = () => {
					setCfg((s) => ({ ...s, fwdStatus: "正在配置宿主机转发（可能弹出 Windows UAC 授权框）…" }));
					fetch("/mcp-compat/wsl-forward", { method: "POST" })
						.then((r) => r.json())
						.then((d) => {
							if (!d || !d.ok || !Array.isArray(d.results)) {
								setCfg((s) => ({ ...s, fwdStatus: "转发配置失败" }));
								return;
							}
							const text = d.results.map((x) => (x.status === "done" ? `端口 ${x.port} 已配置` : x.status === "already" ? `端口 ${x.port} 已有规则` : x.status === "all-interfaces" ? `端口 ${x.port} 已监听所有网卡` : `端口 ${x.port}: ${x.status}`)).join("；");
							setCfg((s) => ({ ...s, fwdStatus: text || "无待配置端口" }));
						})
						.catch((e) => setCfg((s) => ({ ...s, fwdStatus: String((e && e.message) || "转发配置失败") })));
				};

				const runWslRelease = () => {
					setCfg((s) => ({ ...s, fwdStatus: "正在释放宿主机转发（可能需要批准 UAC）…" }));
					fetch("/mcp-compat/wsl-release", { method: "POST" })
						.then((r) => r.json())
						.then((d) => {
							if (!d || !d.ok) {
								const rem = d && Array.isArray(d.remaining) && d.remaining.length ? "；未释放: " + d.remaining.join("、") : "";
								setCfg((s) => ({ ...s, fwdStatus: "释放未完成（可能未批准 UAC）" + rem }));
								return;
							}
							const rel = Array.isArray(d.released) && d.released.length ? "已释放: " + d.released.join("、") : "无待释放规则";
							setCfg((s) => ({ ...s, fwdStatus: rel }));
						})
						.catch((e) => setCfg((s) => ({ ...s, fwdStatus: String((e && e.message) || "释放失败") })));
				};

				const rows = (cfg.all || []).map((name) =>
					react.createElement("div", { className: "mc-item", key: name },
						react.createElement("label", null,
							react.createElement("input", {
								type: "checkbox",
								checked: cfg.scanners.includes(name),
								onChange: () => toggle(name),
							}),
							react.createElement("span", { className: "mc-label" },
								react.createElement("span", { className: "mc-name" }, (cfg.labels && cfg.labels[name]) || name),
								react.createElement("span", { className: "mc-hint" },
									name === "claude" ? "项目/用户级 .mcp.json（Claude Code 约定）" :
									name === "cursor" ? "项目根 .cursor/mcp.json" :
									name === "opencode" ? "项目根 opencode.json(.c) 与用户级 opencode.json" :
									name === "codex" ? "项目/用户级 .codex/config.toml" : ""),
							),
						),
					),
				);

				return react.createElement("div", { className: "pc-card" },
					react.createElement("button", { className: "pc-head", onClick: () => setOpen((v) => !v) },
						react.createElement("span", { className: "pc-head-text" },
							react.createElement("span", { className: "pc-name" }, "MCP 兼容"),
							react.createElement("span", { className: "pc-desc" }, "选择要扫描的 MCP 配置文件来源"),
						),
						react.createElement(ChevronIcon, { className: "pc-chevron" + (open ? " pc-open" : "") }),
					),
					open
						? react.createElement("div", { className: "pc-body" },
							react.createElement("div", { className: "mc-card" },
								react.createElement("div", { className: "mc-item" },
									react.createElement("label", null,
										react.createElement("span", { className: "mc-label" },
											react.createElement("span", { className: "mc-name" }, "WSL 宿主兼容"),
											react.createElement("span", { className: "mc-hint" },
												configWslText(cfg.wsl)),
										),
									),
								),
								cfg.wsl && cfg.wsl.detected
									? react.createElement("div", { className: "mc-card" },
										react.createElement("div", { className: "mc-item" },
											react.createElement("label", null,
												react.createElement("input", { type: "checkbox", checked: cfg.compat, onChange: () => setCfg((s) => ({ ...s, compat: !s.compat })) }),
												react.createElement("span", { className: "mc-label" },
													react.createElement("span", { className: "mc-name" }, "启用 WSL 兼容"),
													react.createElement("span", { className: "mc-hint" }, "连接失败时自动启动同端口隧道 / 地址改写"),
												),
											),
										),
										react.createElement("div", { className: "mc-item" },
											react.createElement("label", null,
												react.createElement("input", { type: "checkbox", checked: cfg.autoForward, onChange: () => setCfg((s) => ({ ...s, autoForward: !s.autoForward })) }),
												react.createElement("span", { className: "mc-label" },
													react.createElement("span", { className: "mc-name" }, "自动配置宿主机转发"),
													react.createElement("span", { className: "mc-hint" }, "宿主机端口不可达时，自动运行 netsh 端口转发 + 防火墙放行（需批准一次 UAC）"),
												),
											),
										),
										react.createElement("div", { className: "mc-foot" },
											react.createElement("button", { className: "mc-btn", onClick: runWslForward }, "立即配置宿主机转发"),
											react.createElement("button", { className: "mc-btn", onClick: runWslRelease }, "释放并清除转发"),
											cfg.fwdStatus ? react.createElement("span", { className: "mc-status" }, cfg.fwdStatus) : null,
										),
									)
									: null,
								rows,
								react.createElement("div", { className: "mc-foot" },
									react.createElement("button", { className: "mc-btn", onClick: save, disabled: cfg.loading }, "保存"),
									cfg.status ? react.createElement("span", { className: "mc-status" }, cfg.status) : null,
								),
							),
						)
						: null,
				);
			}

			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: "dsh-mcp-compat",
				id: "mcp-compat-settings",
				order: 10,
				label: "MCP 兼容",
			}, SettingsCard));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
