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
			// ── 工作区工具门控面板（工作区右键 → MCP 工具）──
			".mcp-gate-backdrop{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.45)}",
			"body[data-ds-dark-theme] .mcp-gate-backdrop{background:rgba(0,0,0,.62)}",
			".mcp-gate-panel{display:flex;flex-direction:column;width:min(780px,94vw);max-height:84vh;overflow:hidden;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 24px 64px rgba(0,0,0,.28);color:var(--dsw-alias-label-primary)}",
			".mcp-gate-head{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l2)}",
			".mcp-gate-titles{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}",
			".mcp-gate-title{font-size:15px;font-weight:600;line-height:1.4}",
			".mcp-gate-path{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".mcp-gate-close{flex:none;background:transparent;border:0;color:var(--dsw-alias-label-secondary);font-size:20px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:6px}",
			".mcp-gate-close:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
			".mcp-gate-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:12px 16px;display:flex;flex-direction:column;gap:12px}",
			// 关键：flex 列里的 section 默认 flex-shrink:1，会被压扁到容器高度内各自裁切，
			// 于是「内容不溢出 → 容器不滚 → 底部工具永远看不到」。禁止收缩，让 body 真正溢出。
			".mcp-gate-server{flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}",
			".mcp-gate-toolbar{display:flex;align-items:center;gap:8px;padding:0 16px 10px}",
			".mcp-gate-search{flex:1;min-width:0;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.6;padding:5px 10px;outline:none}",
			".mcp-gate-search:focus{border-color:var(--dsw-alias-brand-primary)}",
			".mcp-gate-server-toggle{flex:1;min-width:0;display:flex;align-items:center;gap:8px;background:transparent;border:0;padding:0;font:inherit;color:inherit;text-align:left;cursor:pointer}",
			".mcp-gate-count{flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}",
			".mcp-gate-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}",
			".mcp-gate-chevron.is-closed{transform:rotate(-90deg)}",
			".mcp-gate-server-head{display:flex;align-items:center;gap:8px;padding:9px 12px;background:var(--dsw-alias-bg-module-platform)}",
			".mcp-gate-server-name{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".mcp-gate-tag{flex:none;font-size:10px;line-height:1;padding:3px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}",
			".mcp-gate-tag.is-project{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}",
			".mcp-gate-tag.is-off{color:var(--dsw-alias-label-dimmed, var(--dsw-alias-label-tertiary));border-style:dashed}",
			".mcp-gate-server-actions{flex:none;margin-left:auto;display:flex;gap:6px}",
			".mcp-gate-mini{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:6px;font-size:11px;line-height:1;padding:4px 8px;cursor:pointer}",
			".mcp-gate-mini:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}",
			".mcp-gate-tools{list-style:none;margin:0;padding:4px 0}",
			".mcp-gate-tool{padding:6px 12px}",
			".mcp-gate-tool:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".mcp-gate-tool label{display:flex;align-items:flex-start;gap:8px;cursor:pointer}",
			".mcp-gate-tool input{width:14px;height:14px;margin-top:2px;accent-color:var(--dsw-alias-brand-primary);flex:none}",
			".mcp-gate-tool-text{display:flex;flex-direction:column;gap:1px;min-width:0}",
			".mcp-gate-tool-name{font-size:12px;color:var(--dsw-alias-label-primary);word-break:break-all}",
			".mcp-gate-tool-desc{font-size:10.5px;color:var(--dsw-alias-label-tertiary);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
			".mcp-gate-empty{padding:18px 12px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary)}",
			".mcp-gate-empty.mcp-gate-error{color:var(--dsw-alias-label-secondary)}",
			".mcp-gate-foot{display:flex;align-items:center;gap:10px;padding:11px 16px;border-top:1px solid var(--dsw-alias-border-l2)}",
			".mcp-gate-legend{font-size:10.5px;color:var(--dsw-alias-label-tertiary);margin-left:auto;text-align:right}",
			// ── 右侧栏「MCP 管理」面板 ──
			".mcp-panel{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary)}",
			".mcp-panel-head{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}",
			".mcp-panel-title{font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px}",
			".mcp-panel-title-icon{flex:none;color:var(--dsw-alias-label-primary)}",
			".mcp-tab-title{display:inline-flex;align-items:center;gap:5px}",
			".mcp-tab-title svg{flex:none;color:currentColor;opacity:.9}",
			// 快捷卡片
			".mcp-cards{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}",
			".mcp-card{display:flex;flex-direction:column;align-items:flex-start;gap:2px;max-width:100%;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:7px 10px;cursor:pointer;color:inherit;font:inherit;text-align:left}",
			".mcp-card:hover{border-color:var(--dsw-alias-border-l1)}",
			".mcp-card.is-active{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover)}",
			".mcp-card-name{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}",
			".mcp-card-tool{font-size:10px;color:var(--dsw-alias-label-tertiary);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".mcp-card-form{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform)}",
			".mcp-card-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
			".mcp-slider{flex:1;min-width:110px;accent-color:var(--dsw-alias-brand-primary)}",
			".mcp-slider-value{font-size:11px;color:var(--dsw-alias-label-secondary);min-width:44px;text-align:right;font-variant-numeric:tabular-nums}",
			".mcp-mode{margin-left:auto;display:flex;gap:4px}",
			".mcp-mode .mcp-gate-mini{padding:3px 7px;font-size:10px}",
			".mcp-mode .mcp-gate-mini.is-on{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}",
			".mcp-panel-sub{font-size:10.5px;color:var(--dsw-alias-label-tertiary);line-height:1.4}",
			".mcp-panel-toolbar{display:flex;gap:6px;padding:8px 12px 0}",
			".mcp-panel-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px 12px 12px;display:flex;flex-direction:column;gap:10px}",
			".mcp-panel-server{flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}",
			".mcp-panel-server-head{display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--dsw-alias-bg-module-platform);font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".mcp-server-toggle{margin-left:auto;font-weight:400}",
			".mcp-server-toggle.is-on{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}",
			".mcp-panel-tool{padding:7px 10px;border-top:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:4px}",
			".mcp-panel-tool-name{font-size:11.5px;word-break:break-all}",
			".mcp-panel-tool-desc{font-size:10.5px;color:var(--dsw-alias-label-tertiary);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
			".mcp-panel-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}",
			".mcp-panel-form{display:flex;flex-direction:column;gap:6px;margin-top:2px}",
			".mcp-panel-args{width:100%;box-sizing:border-box;min-height:110px;resize:vertical;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-primary);font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;padding:8px}",
			".mcp-panel-status{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto}",
			".mcp-panel-empty{padding:20px 4px;text-align:center;font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:1.6}",
			// 参数表单
			".mcp-field{display:flex;flex-direction:column;gap:2px}",
			".mcp-field-label{font-size:10.5px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:4px}",
			".mcp-field-req{color:var(--dsw-alias-brand-primary)}",
			".mcp-field-hint{font-size:10px;color:var(--dsw-alias-label-tertiary);line-height:1.35}",
			".mcp-input,.mcp-select{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:1.5;padding:4px 8px;outline:none}",
			".mcp-input:focus,.mcp-select:focus,.mcp-panel-args:focus{border-color:var(--dsw-alias-brand-primary)}",
			".mcp-field-bad .mcp-input,.mcp-field-bad .mcp-select,.mcp-field-bad .mcp-panel-args{border-color:#d9534f}",
			".mcp-field-error{font-size:10px;color:#d9534f}",
			".mcp-check{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}",
			".mcp-preview{white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px;font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;max-height:220px;overflow:auto}",
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

		const inject = ["slots", "contextMenus", "sidebarRightTabs"];

		function ChevronIcon({ className }) {
			return react.createElement("svg", {
				width: 14, height: 14, viewBox: "0 0 14 14", fill: "none",
				xmlns: "http://www.w3.org/2000/svg", className,
			}, react.createElement("path", {
				d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
				fill: "currentColor",
			}));
		}

		// 「MCP 管理」图标：官方 MCP 的 ribbon「M」标记（按参考图描的矢量，24 网格）。
		// fill: currentColor 跟随主题；size 由调用方（右侧栏 / 右键菜单）给。
		const MCP_GLYPH_PATH = "M12.29 2.00 L14.80 2.00 L15.69 2.45 L17.03 4.24 L17.03 5.76 L19.05 6.03 L21.06 8.26 L21.06 10.55 L20.61 11.44 L12.78 19.09 L14.35 20.79 L14.35 21.96 L13.19 21.96 L11.62 20.39 L11.40 18.33 L18.11 11.62 L18.51 11.62 L18.55 11.17 L19.00 11.13 L19.67 10.01 L19.23 7.91 L17.84 7.19 L16.63 7.41 L9.65 14.13 L8.94 13.90 L8.94 12.74 L15.65 6.21 L15.65 4.77 L14.71 3.61 L12.38 3.61 L3.83 12.11 L2.89 11.66 L2.89 10.95 L11.40 2.45 L12.29 2.04 Z";
		function McpGlyph({ size = 14, className } = {}) {
			const px = typeof size === "number" && size > 0 ? size : 14;
			return react.createElement("svg", {
				width: px, height: px, viewBox: "0 0 24 24",
				xmlns: "http://www.w3.org/2000/svg", className, "aria-hidden": "true",
			}, react.createElement("path", {
				d: MCP_GLYPH_PATH,
				fill: "currentColor",
				fillRule: "evenodd",
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

			// ── 工作区工具门控：右键菜单项 + 面板 ──────────────────────────────
			// 入口：工作区行的右键 / 省略号菜单（官方 `workspace` 右键操作对象，
			// 由 ui-workspace 声明：{ workspaceId, path, displayTitle }）。
			// 面板：渲染进官方 `shell.overlay`（frame 级浮层），管理「当前工作区可见的
			// dsh-mcp-compat 注入工具」——只控制本插件注入的 `mcp__<服务器>__*`，
			// 不碰其它插件/内置工具。
			const DICT = {
				zh: {
					menuLabel: "MCP 工具…",
					title: "MCP 工具",
					close: "关闭",
					loading: "正在读取…",
					empty: "当前工作区没有 dsh-mcp-compat 注入的工具",
					noTools: "该服务器暂未注册工具（可能未连接）",
					project: "项目级",
					user: "用户级",
					offline: "未连接",
					search: "搜索工具名 / 说明…",
					expandAll: "展开全部",
					collapseAll: "收起全部",
					noMatch: "没有匹配的工具",
					enableAll: "全部启用",
					disableAll: "全部禁用",
					save: "保存",
					saving: "保存中…",
					saved: "已保存，立即生效",
					saveFailed: "保存失败",
					readFailed: "读取失败",
					staleHost: "Host 侧还是旧版本（没有 /mcp-compat/tools 接口）——请完全退出并重开 DSH",
					legend: "取消勾选 = 该工具在此工作区对模型不可见，也不会被执行（跨会话持久化）",
					// 右侧栏「MCP 管理」面板
					panelTitle: "MCP 管理",
					panelGuide: "把平时不用的 MCP 工具临时注入当前会话，或直接手动调用并把结果写进对话",
					panelEmpty: "当前工作区没有隐藏的 MCP 工具。\n在左侧工作区右键 →「MCP 工具…」里取消勾选，即可把工具收进这里。",
					panelSearch: "搜索工具…",
					inject: "注入",
					injectOn: "已注入",
					call: "调用",
					send: "发送",
					cancel: "取消",
					clearAll: "全部还原",
					calling: "调用中…",
					callDone: "已写入当前会话",
					callError: "工具返回错误（结果已写入会话）",
					params: "参数",
					requiredMark: "必填",
					rawMode: "JSON 模式",
					formMode: "表单模式",
					noParams: "该工具没有参数",
					previewTitle: "调用结果预览（还没发送到会话）",
					confirmSend: "发送到会话",
					discard: "丢弃",
					invalidArgs: "参数有误：",
					previewFailed: "调用失败",
					// 快捷卡片
					shortcutsTitle: "快捷卡片",
					shortcutEmpty: "还没有快捷卡片：在工具上点「建卡」，把常用参数固定下来。",
					createCard: "建卡",
					cardName: "卡片名称",
					cardNamePlaceholder: "例如：待处理 issue",
					cardFixed: "固定",
					cardDynamic: "动态",
					cardCreate: "创建卡片",
					cardDelete: "删除",
					cardRun: "执行",
					cardSaved: "卡片已保存",
					cardNoDynamic: "这张卡片没有动态参数，直接执行即可",
					cardMin: "最小",
					cardMax: "最大",
					cardInteger: "整数",
					cardExists: "已有同名卡片，保存会覆盖",
					templateTitle: "输出模板",
					templateHint: "Mustache 语法：{{path}} / {{#each 列表}}…{{/each}} / {{#if 字段}}…{{else}}…{{/if}}；留空则用默认模板",
					generateTemplate: "AI 生成",
					saveTemplate: "保存模板",
					templateGenerated: "已生成，可直接编辑后再保存",
					injectServer: "全部注入",
					clearServer: "全部取消",
				},
				en: {
					menuLabel: "MCP tools…",
					title: "MCP tools",
					close: "Close",
					loading: "Loading…",
					empty: "This workspace has no tools injected by dsh-mcp-compat",
					noTools: "This server has no registered tools (not connected?)",
					project: "project",
					user: "user",
					offline: "offline",
					search: "Filter by tool name or description…",
					expandAll: "Expand all",
					collapseAll: "Collapse all",
					noMatch: "No matching tools",
					enableAll: "Enable all",
					disableAll: "Disable all",
					save: "Save",
					saving: "Saving…",
					saved: "Saved — effective immediately",
					saveFailed: "Save failed",
					readFailed: "Read failed",
					staleHost: "The Host plugin is still an older build (no /mcp-compat/tools route) — quit and reopen DSH",
					legend: "Unchecked = hidden from the model and refused in this workspace (persisted across sessions)",
					panelTitle: "MCP manager",
					panelGuide: "Temporarily inject rarely used MCP tools into this session, or call one directly and write the result into the chat",
					panelEmpty: "No hidden MCP tools in this workspace.\nRight-click a workspace in the sidebar → \"MCP tools…\" and uncheck tools to collect them here.",
					panelSearch: "Filter tools…",
					inject: "Inject",
					injectOn: "Injected",
					call: "Call",
					send: "Send",
					cancel: "Cancel",
					clearAll: "Reset all",
					calling: "Calling…",
					callDone: "Written into this session",
					callError: "The tool returned an error (result written into the session)",
					params: "Arguments",
					requiredMark: "required",
					rawMode: "JSON mode",
					formMode: "Form mode",
					noParams: "This tool takes no arguments",
					previewTitle: "Result preview (not sent to the session yet)",
					confirmSend: "Send to session",
					discard: "Discard",
					invalidArgs: "Invalid arguments: ",
					previewFailed: "Call failed",
					shortcutsTitle: "Shortcuts",
					shortcutEmpty: "No shortcuts yet — click \"New card\" on a tool to pin its common arguments.",
					createCard: "New card",
					cardName: "Card name",
					cardNamePlaceholder: "e.g. pending issues",
					cardFixed: "fixed",
					cardDynamic: "dynamic",
					cardCreate: "Create card",
					cardDelete: "Delete",
					cardRun: "Run",
					cardSaved: "Card saved",
					cardNoDynamic: "This card has no dynamic arguments — just run it",
					cardMin: "min",
					cardMax: "max",
					cardInteger: "integer",
					cardExists: "A card with this name exists; saving overwrites it",
					templateTitle: "Output template",
					templateHint: "Mustache: {{path}} / {{#each list}}…{{/each}} / {{#if field}}…{{else}}…{{/if}}; empty = default template",
					generateTemplate: "Generate with AI",
					saveTemplate: "Save template",
					templateGenerated: "Generated — edit then save",
					injectServer: "Inject all",
					clearServer: "Clear all",
				},
			};
			const localeOf = (() => {
				try { return ctx.get("locale"); } catch { return undefined; }
			})();
			let dict = DICT.zh;
			const readLocale = () => {
				dict = localeOf?.getLocale?.().active === "en" ? DICT.en : DICT.zh;
			};
			readLocale();
			if (typeof localeOf?.subscribe === "function") {
				ctx.effect(() => localeOf.subscribe(readLocale), "mcp-compat: locale follow");
			}
			const t = (key) => (typeof dict[key] === "string" ? dict[key] : key);
			// Host 侧可能还是旧构建（没有 /mcp-compat/tools 路由，请求落到插件自己的
			// not-found 兜底）——把它翻译成能指导用户恢复的提示，而不是干巴巴的 not-found。
			const errorText = (code) => (code === "not-found" ? t("staleHost") : (code || t("readFailed")));
			// 统一的 JSON 请求：失败时带上 HTTP 状态码 + 响应体片段，避免面板只显示一句
			// 无法定位的「保存失败」；非 2xx 也返回结构化 payload 而不是抛错。
			const requestJson = async (url, options) => {
				const response = await fetch(url, options);
				const text = await response.text();
				let payload;
				try {
					payload = text ? JSON.parse(text) : {};
				} catch {
					throw new Error(`HTTP ${response.status}：${text.slice(0, 300) || "(空响应)"}`);
				}
				if (!response.ok) {
					return {
						ok: false,
						error: (payload && payload.error) || `HTTP ${response.status}`,
						httpStatus: response.status,
					};
				}
				return payload;
			};

			// 面板请求（哪个工作区被点开）；用最朴素的订阅，避免依赖 React 版本差异。
			const panel = {
				request: null,
				listeners: new Set(),
				set(next) {
					panel.request = next;
					for (const fn of panel.listeners) {
						try { fn(); } catch {}
					}
				},
				subscribe(fn) {
					panel.listeners.add(fn);
					return () => panel.listeners.delete(fn);
				},
			};
			function usePanelRequest() {
				const [value, setValue] = react.useState(panel.request);
				react.useEffect(() => {
					const off = panel.subscribe(() => setValue(panel.request));
					setValue(panel.request);
					return off;
				}, []);
				return value;
			}

			/** 面板：按服务器分组列出当前工作区可见的工具，取消勾选 = 禁用。 */
			function McpToolsDialog({ request, onClose }) {
				const [data, setData] = react.useState({ loading: true, error: "", servers: [] });
				const [draft, setDraft] = react.useState(() => new Set());
				const [busy, setBusy] = react.useState(false);
				const [status, setStatus] = react.useState("");
				// 搜索：按工具名/说明过滤（服务器多、单服务器几十个工具时比滚动快）
				const [query, setQuery] = react.useState("");
				// 折叠：默认全部展开；点服务器标题收起（搜索时强制展开，否则看不到命中）
				const [collapsed, setCollapsed] = react.useState(() => new Set());
				const closeRef = react.useRef(onClose);
				closeRef.current = onClose;

				const applyData = (payload) => {
					const servers = Array.isArray(payload?.servers) ? payload.servers : [];
					const disabled = new Set();
					for (const server of servers) {
						for (const tool of (server.tools || [])) if (tool.disabled) disabled.add(tool.name);
					}
					setData({ loading: false, error: "", servers });
					setDraft(disabled);
				};

				react.useEffect(() => {
					let alive = true;
					setData({ loading: true, error: "", servers: [] });
					requestJson("/mcp-compat/tools?workspacePath=" + encodeURIComponent(request.path))
						.then((payload) => {
							if (!alive) return;
							if (payload && payload.ok) applyData(payload);
							else setData({ loading: false, error: errorText(payload && payload.error), servers: [] });
						})						.catch((e) => {
							if (alive) setData({ loading: false, error: String((e && e.message) || t("readFailed")), servers: [] });
						});
					return () => { alive = false; };
				}, [request.path]);

				react.useEffect(() => {
					const onKey = (event) => {
						if (event.key !== "Escape") return;
						event.stopPropagation();
						closeRef.current();
					};
					document.addEventListener("keydown", onKey, true);
					return () => document.removeEventListener("keydown", onKey, true);
				}, []);

				const toggleTool = (name) => {
					setDraft((prev) => {
						const next = new Set(prev);
						if (next.has(name)) next.delete(name);
						else next.add(name);
						return next;
					});
				};
				const setServer = (server, enabled) => {
					setDraft((prev) => {
						const next = new Set(prev);
						for (const tool of (server.tools || [])) {
							if (enabled) next.delete(tool.name);
							else next.add(tool.name);
						}
						return next;
					});
				};
				const toggleCollapsed = (name) => {
					setCollapsed((prev) => {
						const next = new Set(prev);
						if (next.has(name)) next.delete(name);
						else next.add(name);
						return next;
					});
				};
				const setAllCollapsed = (value) => {
					setCollapsed(value ? new Set(servers.map((server) => server.name)) : new Set());
				};
				const save = () => {
					setBusy(true);
					setStatus(t("saving"));
					requestJson("/mcp-compat/tools", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ workspacePath: request.path, disabled: [...draft] }),
					})
						.then((payload) => {
							setBusy(false);
							if (payload && payload.ok) {
								applyData(payload);
								setStatus(payload.store && payload.store.path
									? `${t("saved")} · ${payload.store.path}`
									: t("saved"));
							} else {
								setStatus(errorText(payload && payload.error));
							}
						})
						.catch((e) => {
							setBusy(false);
							setStatus(String((e && e.message) || t("saveFailed")));
						});
				};

				const servers = data.servers || [];
				const q = query.trim().toLowerCase();
				// 搜索时按名字/说明过滤工具；没有命中的服务器整块隐藏。
				const visible = servers
					.map((server) => ({
						...server,
						tools: q
							? (server.tools || []).filter((tool) => tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q))
							: (server.tools || []),
					}))
					.filter((server) => !q || server.tools.length > 0);
				const showToolbar = !data.loading && !data.error && servers.length > 0;
				return react.createElement("div", {
					className: "mcp-gate-backdrop",
					onMouseDown: (event) => { if (event.target === event.currentTarget) onClose(); },
				},
					react.createElement("div", { className: "mcp-gate-panel", role: "dialog", "aria-modal": "true", "aria-label": t("title") },
						react.createElement("header", { className: "mcp-gate-head" },
							react.createElement("div", { className: "mcp-gate-titles" },
								react.createElement("div", { className: "mcp-gate-title" }, t("title")),
								react.createElement("div", { className: "mcp-gate-path", title: request.path }, request.path),
							),
							react.createElement("button", { className: "mcp-gate-close", onClick: onClose, "aria-label": t("close") }, "×"),
						),
						showToolbar
							? react.createElement("div", { className: "mcp-gate-toolbar" },
								react.createElement("input", {
									className: "mcp-gate-search",
									type: "search",
									value: query,
									placeholder: t("search"),
									onChange: (event) => setQuery(event.target.value),
								}),
								react.createElement("button", { className: "mcp-gate-mini", onClick: () => setAllCollapsed(false) }, t("expandAll")),
								react.createElement("button", { className: "mcp-gate-mini", onClick: () => setAllCollapsed(true) }, t("collapseAll")),
							)
							: null,
						react.createElement("div", { className: "mcp-gate-body" },
							data.loading
								? react.createElement("div", { className: "mcp-gate-empty" }, t("loading"))
								: data.error
									? react.createElement("div", { className: "mcp-gate-empty mcp-gate-error" }, data.error)
									: servers.length === 0
										? react.createElement("div", { className: "mcp-gate-empty" }, t("empty"))
										: visible.length === 0
											? react.createElement("div", { className: "mcp-gate-empty" }, t("noMatch"))
											: visible.map((server) => {
												const disabledCount = (server.tools || []).filter((tool) => draft.has(tool.name)).length;
												const open = q !== "" || !collapsed.has(server.name);
												return react.createElement("section", { className: "mcp-gate-server", key: server.name },
													react.createElement("div", { className: "mcp-gate-server-head" },
														react.createElement("button", {
															className: "mcp-gate-server-toggle",
															onClick: () => toggleCollapsed(server.name),
															"aria-expanded": open,
															title: server.source || server.name,
														},
															react.createElement(ChevronIcon, { className: "mcp-gate-chevron" + (open ? "" : " is-closed") }),
															react.createElement("span", { className: "mcp-gate-server-name" }, server.name),
															react.createElement("span", { className: "mcp-gate-tag" + (server.level === "project" ? " is-project" : "") },
																server.level === "project" ? t("project") : t("user")),
															server.mounted ? null : react.createElement("span", { className: "mcp-gate-tag is-off" }, t("offline")),
															react.createElement("span", { className: "mcp-gate-count" },
																`${disabledCount}/${(server.tools || []).length}`),
														),
														react.createElement("span", { className: "mcp-gate-server-actions" },
															react.createElement("button", { className: "mcp-gate-mini", onClick: () => setServer(server, true) }, t("enableAll")),
															react.createElement("button", { className: "mcp-gate-mini", onClick: () => setServer(server, false) }, t("disableAll")),
														),
													),
													open
														? ((server.tools || []).length === 0
															? react.createElement("div", { className: "mcp-gate-empty" }, t("noTools"))
															: react.createElement("ul", { className: "mcp-gate-tools" },
																server.tools.map((tool) => react.createElement("li", { className: "mcp-gate-tool", key: tool.name },
																	react.createElement("label", null,
																		react.createElement("input", {
																			type: "checkbox",
																			checked: !draft.has(tool.name),
																			onChange: () => toggleTool(tool.name),
																		}),
																		react.createElement("span", { className: "mcp-gate-tool-text" },
																			react.createElement("span", { className: "mcp-gate-tool-name" }, tool.name),
																			tool.description
																				? react.createElement("span", { className: "mcp-gate-tool-desc" }, tool.description)
																				: null,
																		),
																	),
																)),
															))
														: null,
												);
											}),
						),
						react.createElement("footer", { className: "mcp-gate-foot" },
							react.createElement("button", { className: "mc-btn", onClick: save, disabled: busy || data.loading }, t("save")),
							status ? react.createElement("span", { className: "mc-status" }, status) : null,
							react.createElement("span", { className: "mcp-gate-legend" }, t("legend")),
						),
					),
				);
			}

			/** 只有被点开时才渲染（未点开时这个 root 槽位不产生任何 DOM）。 */
			function McpToolsPanel() {
				const request = usePanelRequest();
				if (!request) return null;
				return react.createElement(McpToolsDialog, { request, onClose: () => panel.set(null) });
			}

			// ① 工作区右键菜单项：官方 `workspace` 目标（ui-workspace 声明）。
			//    order 200 落在「重命名(100)」与「删除工作区(300)」之间。
			const menus = (() => {
				try { return ctx.get("contextMenus"); } catch { return undefined; }
			})();
			if (menus !== undefined && typeof menus.register === "function") {
				ctx.effect(
					() => menus.register({
						id: "mcp-compat.workspace",
						target: "workspace",
						order: 200,
						resolve: (target) => {
							if (!target || typeof target.path !== "string" || target.path === "") return [];
							return [{
								id: "tools",
								label: t("menuLabel"),
								icon: { key: "mcp-compat.action" },
								run: () => panel.set({ workspaceId: target.workspaceId, path: target.path, title: target.displayTitle }),
							}];
						},
					}),
					"mcp-compat: workspace menu",
				);
			}

			// ② 面板挂到官方 frame 级浮层（root 作用域，永远存在）。
			ctx.effect(
				() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: "mcp-compat.panel",
					order: 80,
				}, McpToolsPanel)),
				"mcp-compat: tools panel overlay",
			);

			// ③ 右键菜单项图标：keyed Slot contextMenu.icon（官方叠加层按 action.icon.key 渲染）。
			ctx.effect(
				() => ctx.slots.inject("contextMenu.icon", () => ctx.slots.register({
					name: "contextMenu.icon",
					key: "mcp-compat.action",
				}, McpGlyph)),
				"mcp-compat: menu icon",
			);

			// ── 右侧栏「MCP 管理」面板 ─────────────────────────────────────────
			// 只列「当前工作区被隐藏的」MCP 工具（全程可见的那些不进来），提供两种用法：
			//   ① 注入：临时把工具加进当前会话的可见集（Host 内存态，会话结束即失效）；
			//   ② 调用：填参数直接执行，结果按模板作为一条 user 消息写进当前会话，
			//      工具本身从不进入上下文。
			/** 从参数 schema 抽出表单字段（enum / boolean / number / array / object / string）。 */
			function schemaFields(schema) {
				const props = schema && typeof schema === "object" && schema.properties && typeof schema.properties === "object"
					? schema.properties
					: {};
				const required = new Set(Array.isArray(schema && schema.required) ? schema.required : []);
				return Object.entries(props).map(([name, def]) => {
					const node = def && typeof def === "object" ? def : {};
					const type = Array.isArray(node.enum) && node.enum.length > 0
						? "enum"
						: node.type === "integer" || node.type === "number" ? "number"
							: node.type === "boolean" ? "boolean"
								: node.type === "array" ? "array"
									: node.type === "object" ? "object"
										: "string";
					return {
						name,
						type,
						options: type === "enum" ? node.enum.map((value) => String(value)) : null,
						required: required.has(name),
						description: typeof node.description === "string" ? node.description : "",
						hasDefault: node.default !== undefined,
						defaultValue: node.default,
					};
				});
			}

			/** 表单初始值：有 default 用 default；布尔默认 false；其余空串。 */
			function initialValues(fields) {
				const out = {};
				for (const field of fields) {
					if (field.hasDefault) {
						out[field.name] = field.type === "array" || field.type === "object"
							? JSON.stringify(field.defaultValue)
							: String(field.defaultValue);
					} else if (field.type === "boolean") {
						out[field.name] = false;
					} else {
						out[field.name] = "";
					}
				}
				return out;
			}

			/** 校验并组装参数对象；errors 为空对象才可调用。 */
			function buildArgs(fields, values) {
				const args = {};
				const errors = {};
				for (const field of fields) {
					const raw = values[field.name];
					if (field.type === "boolean") {
						args[field.name] = raw === true;
						continue;
					}
					const text = String(raw === undefined || raw === null ? "" : raw).trim();
					if (text === "") {
						if (field.required) errors[field.name] = t("requiredMark");
						continue;
					}
					if (field.type === "number") {
						const n = Number(text);
						if (!Number.isFinite(n)) errors[field.name] = "number";
						else args[field.name] = n;
					} else if (field.type === "array" || field.type === "object") {
						try {
							const parsed = JSON.parse(text);
							const ok = field.type === "array"
								? Array.isArray(parsed)
								: parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
							if (!ok) errors[field.name] = field.type;
							else args[field.name] = parsed;
						} catch {
							errors[field.name] = "JSON";
						}
					} else {
						args[field.name] = text;
					}
				}
				return { args, errors };
			}

			function McpManagerView(props) {
				const sessionId = props && props.sessionId ? String(props.sessionId) : "";
				const [data, setData] = react.useState({ loading: true, error: "", servers: [], lastArgs: {} });
				const [busy, setBusy] = react.useState(false);
				const [status, setStatus] = react.useState("");
				const [query, setQuery] = react.useState("");
				// 正在填参数的工具 + 表单状态
				const [calling, setCalling] = react.useState(null);
				const [fields, setFields] = react.useState([]);
				const [values, setValues] = react.useState({});
				const [errors, setErrors] = react.useState({});
				const [rawMode, setRawMode] = react.useState(false);
				const [rawText, setRawText] = react.useState("{}");
				// 调用结果预览：确认后才写进会话
				const [preview, setPreview] = react.useState(null);
				// 快捷卡片：列表 / 当前展开的卡片 / 动态参数值 / 卡片结果预览 / 建卡草稿
				const [cards, setCards] = react.useState([]);
				const [activeCardId, setActiveCardId] = react.useState("");
				const [cardValues, setCardValues] = react.useState({});
				const [cardPreview, setCardPreview] = react.useState(null);
				const [draft, setDraft] = react.useState(null);
				// 输出模板编辑（卡片结果格式化；可由 AI 生成）
				const [cardTemplate, setCardTemplate] = react.useState("");
				const [templateBusy, setTemplateBusy] = react.useState(false);

				const load = () => {
					if (!sessionId) {
						setData({ loading: false, error: t("readFailed"), servers: [] });
						return;
					}
					setData((prev) => ({ ...prev, loading: true, error: "" }));
					requestJson("/mcp-compat/panel?sessionId=" + encodeURIComponent(sessionId))
						.then((payload) => {
							if (payload && payload.ok) {
								setData({ loading: false, error: "", servers: payload.servers || [], lastArgs: payload.lastArgs || {} });
								setCards(payload.shortcuts || []);
							} else setData({ loading: false, error: errorText(payload && payload.error), servers: [] });
						})
						.catch((e) => setData({ loading: false, error: String((e && e.message) || t("readFailed")), servers: [] }));
				};
				react.useEffect(() => { load(); }, [sessionId]);

				const currentInjected = () => {
					const names = [];
					for (const server of data.servers) {
						for (const tool of (server.tools || [])) if (tool.injected) names.push(tool.name);
					}
					return names;
				};
				const applyInject = (names) => {
					setBusy(true);
					requestJson("/mcp-compat/panel/inject", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId, tools: names }),
					})
						.then((payload) => {
							setBusy(false);
							if (payload && payload.ok) {
								setData({ loading: false, error: "", servers: payload.servers || [] });
								setStatus("");
							} else {
								setStatus(errorText(payload && payload.error));
							}
						})
						.catch((e) => {
							setBusy(false);
							setStatus(String((e && e.message) || t("saveFailed")));
						});
				};
				/** 整张服务器卡片一键注入 / 取消（例如把 yzl-dashboard 的 MCP 全部注入）。 */
				const toggleServer = (server) => {
					const names = (server.tools || []).map((tool) => tool.name);
					if (names.length === 0) return;
					const next = new Set(currentInjected());
					const allIn = names.every((name) => next.has(name));
					for (const name of names) {
						if (allIn) next.delete(name);
						else next.add(name);
					}
					applyInject([...next]);
				};
				const toggleInject = (tool) => {
					const next = new Set(currentInjected());
					if (next.has(tool.name)) next.delete(tool.name);
					else next.add(tool.name);
					applyInject([...next]);
				};
				const startCall = (tool) => {
					const nextFields = schemaFields(tool.parameters);
					const nextValues = initialValues(nextFields);
					setFields(nextFields);
					setValues(nextValues);
					setErrors({});
					setRawMode(false);
					setRawText(JSON.stringify(buildArgs(nextFields, nextValues).args, null, 2));
					setPreview(null);
					setCalling(tool);
					setStatus("");
				};
				const stopCall = () => {
					setCalling(null);
					setPreview(null);
					setErrors({});
				};
				const sendCall = () => {
					if (!calling) return;
					let args = {};
					if (rawMode) {
						try {
							args = JSON.parse(rawText);
							if (args === null || typeof args !== "object" || Array.isArray(args)) throw new Error("object");
						} catch {
							setErrors({ __raw: t("invalidArgs") + "JSON" });
							return;
						}
					} else {
						const built = buildArgs(fields, values);
						if (Object.keys(built.errors).length > 0) {
							setErrors(built.errors);
							return;
						}
						args = built.args;
					}
					setErrors({});
					setBusy(true);
					setStatus(t("calling"));
					requestJson("/mcp-compat/panel/call", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId, name: calling.name, args: JSON.stringify(args) }),
					})
						.then((payload) => {
							setBusy(false);
							if (payload && payload.ok) {
								setPreview({ text: String(payload.preview || ""), isError: payload.isError === true, toolName: calling.name });
								setStatus("");
							} else {
								setStatus(errorText(payload && payload.error));
							}
						})
						.catch((e) => {
							setBusy(false);
							setStatus(String((e && e.message) || t("saveFailed")));
						});
				};
				const commitPreview = () => {
					if (!preview) return;
					setBusy(true);
					requestJson("/mcp-compat/panel/commit", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId, text: preview.text }),
					})
						.then((payload) => {
							setBusy(false);
							if (payload && payload.ok) {
								setPreview(null);
								setCalling(null);
								setStatus(t("callDone"));
							} else {
								setStatus(errorText(payload && payload.error));
							}
						})
						.catch((e) => {
							setBusy(false);
							setStatus(String((e && e.message) || t("saveFailed")));
						});
				};

				const servers = data.servers || [];
				const q = query.trim().toLowerCase();
				const visible = servers
					.map((server) => ({
						...server,
						tools: q
							? (server.tools || []).filter((tool) => tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q))
							: (server.tools || []),
					}))
					.filter((server) => server.tools.length > 0);
				// ── 快捷卡片：固定参数 + 动态参数，点开即调，预览后发送 ──
				const toolLabel = (name) => String(name || "").replace(/^mcp__/, "").replace(/__/g, " / ");
				const openCard = (card) => {
					setActiveCardId(card.id);
					setCardPreview(null);
					setDraft(null);
					const next = {};
					for (const param of card.dynamic || []) {
						next[param.name] = param.default !== undefined && param.default !== null
							? param.default
							: param.type === "boolean" ? false : "";
					}
					setCardValues(next);
					setCardTemplate(card.template || "");
				};
				const cardArgs = (card) => {
					const args = { ...(card.fixed || {}) };
					for (const param of card.dynamic || []) {
						const raw = cardValues[param.name];
						if (param.type === "boolean") { args[param.name] = raw === true; continue; }
						const text = String(raw === undefined || raw === null ? "" : raw).trim();
						if (text === "") continue;
						if (param.type === "number") {
							const value = Number(text);
							if (Number.isFinite(value)) args[param.name] = param.integer === true ? Math.round(value) : value;
						} else if (param.type === "array" || param.type === "object") {
							try { args[param.name] = JSON.parse(text); } catch {}
						} else {
							args[param.name] = text;
						}
					}
					return args;
				};
				const runCard = (card) => {
					setBusy(true);
					setStatus(t("calling"));
					requestJson("/mcp-compat/panel/call", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId, name: card.tool, args: JSON.stringify(cardArgs(card)), template: card.template || "" }),
					})
						.then((payload) => {
							setBusy(false);
							if (payload && payload.ok) {
								setCardPreview({ text: String(payload.preview || ""), isError: payload.isError === true });
								setStatus("");
							} else setStatus(errorText(payload && payload.error));
						})
						.catch((e) => { setBusy(false); setStatus(String((e && e.message) || t("saveFailed"))); });
				};
				const commitCardPreview = () => {
					if (!cardPreview) return;
					setBusy(true);
					requestJson("/mcp-compat/panel/commit", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId, text: cardPreview.text }),
					})
						.then((payload) => {
							setBusy(false);
							if (payload && payload.ok) {
								setCardPreview(null);
								setStatus(t("callDone"));
							} else setStatus(errorText(payload && payload.error));
						})
						.catch((e) => { setBusy(false); setStatus(String((e && e.message) || t("saveFailed"))); });
				};
				const deleteCard = (card) => {
					setBusy(true);
					requestJson("/mcp-compat/shortcuts", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId, op: "delete", id: card.id }),
					})
						.then((payload) => {
							setBusy(false);
							if (payload && payload.ok) {
								setCards(payload.shortcuts || []);
								setActiveCardId("");
								setCardPreview(null);
							} else setStatus(errorText(payload && payload.error));
						})
						.catch((e) => { setBusy(false); setStatus(String((e && e.message) || t("saveFailed"))); });
				};
				/** 打开「建卡」面板：每个参数按上次调用值 / 默认值预填，默认全部动态。 */
				const startDraft = (tool) => {
					const last = ((data && data.lastArgs) || {})[tool.name] || {};
					const rows = schemaFields(tool.parameters).map((field) => {
						const remembered = last[field.name];
						const seed = remembered !== undefined
							? (typeof remembered === "object" ? JSON.stringify(remembered) : String(remembered))
							: field.hasDefault
								? (field.type === "array" || field.type === "object" ? JSON.stringify(field.defaultValue) : String(field.defaultValue))
								: field.type === "boolean" ? false : "";
						return {
							...field,
							mode: "dynamic",
							value: seed,
							integer: field.type === "number",
							min: "",
							max: "",
						};
					});
					setDraft({ tool, name: "", rows, error: "" });
					setCalling(null);
					setPreview(null);
					setCardPreview(null);
					setActiveCardId("");
					setStatus("");
				};
				const setDraftRow = (index, patch) => {
					setDraft((prev) => {
						if (!prev) return prev;
						const rows = prev.rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
						return { ...prev, rows };
					});
				};
				/** 让 AI 根据上次结果写模板（模板含循环 / 条件 / 深层字段，手写太痛）。 */
				const genTemplate = (card) => {
					setTemplateBusy(true);
					requestJson("/mcp-compat/panel/template", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId, tool: card.tool }),
					})
						.then((payload) => {
							setTemplateBusy(false);
							if (payload && payload.ok) {
								setCardTemplate(String(payload.template || ""));
								setStatus(t("templateGenerated"));
							} else setStatus(errorText(payload && payload.error));
						})
						.catch((e) => { setTemplateBusy(false); setStatus(String((e && e.message) || t("saveFailed"))); });
				};
				const saveTemplate = (card) => {
					setTemplateBusy(true);
					requestJson("/mcp-compat/shortcuts", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId, op: "save", shortcut: { ...card, template: cardTemplate } }),
					})
						.then((payload) => {
							setTemplateBusy(false);
							if (payload && payload.ok) {
								setCards(payload.shortcuts || []);
								setStatus(t("cardSaved"));
							} else setStatus(errorText(payload && payload.error));
						})
						.catch((e) => { setTemplateBusy(false); setStatus(String((e && e.message) || t("saveFailed"))); });
				};
				const saveDraft = () => {
					if (!draft) return;
					const fixed = {};
					const dynamic = [];
					for (const row of draft.rows) {
						const text = String(row.value === undefined || row.value === null ? "" : row.value).trim();
						if (row.mode === "fixed") {
							if (text === "") continue;
							if (row.type === "number") {
								const value = Number(text);
								if (Number.isFinite(value)) fixed[row.name] = row.integer === false ? value : Math.round(value);
							} else if (row.type === "boolean") {
								fixed[row.name] = row.value === true || text === "true";
							} else if (row.type === "array" || row.type === "object") {
								try { fixed[row.name] = JSON.parse(text); } catch {}
							} else {
								fixed[row.name] = text;
							}
							continue;
						}
						dynamic.push({
							name: row.name,
							type: row.type,
							integer: row.type === "number" ? row.integer !== false : undefined,
							min: row.type === "number" && String(row.min).trim() !== "" && Number.isFinite(Number(row.min)) ? Number(row.min) : undefined,
							max: row.type === "number" && String(row.max).trim() !== "" && Number.isFinite(Number(row.max)) ? Number(row.max) : undefined,
							step: row.type === "number" ? (row.integer === false ? 0.1 : 1) : undefined,
							options: row.type === "enum" ? row.options : undefined,
							default: text === "" ? undefined : text,
						});
					}
					if (Object.keys(fixed).length === 0 && dynamic.length === 0) {
						setDraft((prev) => (prev ? { ...prev, error: t("invalidArgs") + t("cardNoDynamic") } : prev));
						return;
					}
					setBusy(true);
					requestJson("/mcp-compat/shortcuts", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							sessionId,
							op: "save",
							shortcut: {
								name: draft.name.trim() || toolLabel(draft.tool.name),
								tool: draft.tool.name,
								fixed,
								dynamic,
							},
						}),
					})
						.then((payload) => {
							setBusy(false);
							if (payload && payload.ok) {
								const list = payload.shortcuts || [];
								setCards(list);
								const wantedName = draft.name.trim() || toolLabel(draft.tool.name);
								const created = list.find((item) => item.name === wantedName && item.tool === draft.tool.name) || null;
								setDraft(null);
								// 建卡后直接进入下一步：编辑 / 生成输出模板
								if (created) {
									setActiveCardId(created.id);
									setCardTemplate(created.template || "");
									const seeded = {};
									for (const param of created.dynamic || []) {
										seeded[param.name] = param.default !== undefined && param.default !== null
											? param.default
											: param.type === "boolean" ? false : "";
									}
									setCardValues(seeded);
								}
								setStatus(t("cardSaved"));
							} else setDraft((prev) => (prev ? { ...prev, error: errorText(payload && payload.error) } : prev));
						})
						.catch((e) => { setBusy(false); setDraft((prev) => (prev ? { ...prev, error: String((e && e.message) || t("saveFailed")) } : prev)); });
				};

				const hiddenCount = servers.reduce((n, server) => n + (server.tools || []).filter((tool) => !tool.injected).length, 0);
				const injectedCount = servers.reduce((n, server) => n + (server.tools || []).filter((tool) => tool.injected).length, 0);

				/** 单个参数：按类型渲染控件，出错时红框 + 行内错误。 */
				const renderField = (field) => {
					const bad = errors[field.name] !== undefined;
					const setValue = (value) => setValues((prev) => ({ ...prev, [field.name]: value }));
					const common = {
						className: "mcp-input",
						value: values[field.name] === undefined ? "" : String(values[field.name]),
						onChange: (event) => setValue(event.target.value),
					};
					const control = field.type === "boolean"
						? react.createElement("label", { className: "mcp-check" },
							react.createElement("input", {
								type: "checkbox",
								checked: values[field.name] === true,
								onChange: (event) => setValue(event.target.checked),
							}),
							react.createElement("span", null, values[field.name] === true ? "true" : "false"),
						)
						: field.type === "enum"
							? react.createElement("select", {
								className: "mcp-select",
								value: values[field.name] === undefined ? "" : String(values[field.name]),
								onChange: (event) => setValue(event.target.value),
							},
								react.createElement("option", { value: "" }, "—"),
								(field.options || []).map((option) => react.createElement("option", { value: option, key: option }, option)),
							)
							: field.type === "array" || field.type === "object"
								? react.createElement("textarea", { ...common, className: "mcp-panel-args", spellCheck: false, rows: 3 })
								: react.createElement("input", { ...common, type: field.type === "number" ? "number" : "text" });
					return react.createElement("div", { className: "mcp-field" + (bad ? " mcp-field-bad" : ""), key: field.name },
						react.createElement("div", { className: "mcp-field-label" },
							react.createElement("span", null, field.name),
							field.required ? react.createElement("span", { className: "mcp-field-req" }, "*") : null,
							react.createElement("span", { className: "mcp-gate-tag" }, field.type),
						),
						field.description ? react.createElement("div", { className: "mcp-field-hint" }, field.description) : null,
						control,
						bad ? react.createElement("div", { className: "mcp-field-error" }, String(errors[field.name])) : null,
					);
				};

				/** 卡片里的动态参数控件：数值区间给滑条，其余按类型给输入框。 */
				const renderCardParam = (param) => {
					const value = cardValues[param.name];
					const setValue = (next) => setCardValues((prev) => ({ ...prev, [param.name]: next }));
					const isSlider = param.type === "number" && Number.isFinite(param.min) && Number.isFinite(param.max);
					const label = react.createElement("div", { className: "mcp-field-label" },
						react.createElement("span", null, param.name),
						react.createElement("span", { className: "mcp-gate-tag" }, param.type === "number" ? (param.integer ? "int" : "float") : param.type),
					);
					if (isSlider) {
						const current = value === "" || value === undefined ? param.min : value;
						return react.createElement("div", { className: "mcp-field", key: param.name }, label,
							react.createElement("div", { className: "mcp-card-row" },
								react.createElement("input", {
									className: "mcp-slider",
									type: "range",
									min: param.min,
									max: param.max,
									step: param.step || (param.integer ? 1 : 0.1),
									value: current,
									onChange: (event) => setValue(event.target.value),
								}),
								react.createElement("span", { className: "mcp-slider-value" }, String(current)),
							),
						);
					}
					const control = param.type === "boolean"
						? react.createElement("label", { className: "mcp-check" },
							react.createElement("input", { type: "checkbox", checked: value === true, onChange: (event) => setValue(event.target.checked) }),
							react.createElement("span", null, value === true ? "true" : "false"),
						)
						: param.type === "enum"
							? react.createElement("select", { className: "mcp-select", value: value === undefined ? "" : String(value), onChange: (event) => setValue(event.target.value) },
								react.createElement("option", { value: "" }, "—"),
								(param.options || []).map((option) => react.createElement("option", { value: option, key: option }, option)),
							)
							: react.createElement("input", {
								className: "mcp-input",
								type: param.type === "number" ? "number" : "text",
								value: value === undefined || value === null ? "" : String(value),
								onChange: (event) => setValue(event.target.value),
							});
					return react.createElement("div", { className: "mcp-field", key: param.name }, label, control);
				};

				const renderCardForm = (card) => react.createElement("div", { className: "mcp-card-form", key: "card-" + card.id },
					react.createElement("div", { className: "mcp-panel-actions" },
						react.createElement("span", { className: "mcp-field-label" }, card.name),
						react.createElement("span", { className: "mcp-gate-tag" }, toolLabel(card.tool)),
						react.createElement("button", { className: "mcp-gate-mini", onClick: () => runCard(card), disabled: busy }, t("cardRun")),
						react.createElement("button", { className: "mcp-gate-mini", onClick: () => deleteCard(card), disabled: busy }, t("cardDelete")),
					),
					(card.dynamic || []).length === 0
						? react.createElement("div", { className: "mcp-field-hint" }, t("cardNoDynamic"))
						: (card.dynamic || []).map(renderCardParam),
					// 输出模板：结果按模板格式化；模板可由 AI 依据上次结果生成
					react.createElement("div", { className: "mcp-field" },
						react.createElement("div", { className: "mcp-field-label" }, t("templateTitle")),
						react.createElement("div", { className: "mcp-field-hint" }, t("templateHint")),
						react.createElement("textarea", {
							className: "mcp-panel-args",
							value: cardTemplate,
							spellCheck: false,
							rows: 5,
							onChange: (event) => setCardTemplate(event.target.value),
						}),
						react.createElement("div", { className: "mcp-panel-actions" },
							react.createElement("button", {
								className: "mcp-gate-mini",
								onClick: () => genTemplate(card),
								disabled: busy || templateBusy,
							}, templateBusy ? t("calling") : t("generateTemplate")),
							react.createElement("button", {
								className: "mcp-gate-mini",
								onClick: () => saveTemplate(card),
								disabled: busy || templateBusy,
							}, t("saveTemplate")),
						),
					),
					cardPreview
						? react.createElement("div", { className: "mcp-field" },
							react.createElement("div", { className: "mcp-field-label" }, t("previewTitle")),
							cardPreview.isError ? react.createElement("div", { className: "mcp-field-error" }, t("previewFailed")) : null,
							react.createElement("pre", { className: "mcp-preview" }, cardPreview.text),
							react.createElement("div", { className: "mcp-panel-actions" },
								react.createElement("button", { className: "mcp-gate-mini", onClick: commitCardPreview, disabled: busy }, t("confirmSend")),
								react.createElement("button", { className: "mcp-gate-mini", onClick: () => setCardPreview(null), disabled: busy }, t("discard")),
							),
						)
						: null,
				);

				const activeCard = cards.find((card) => card.id === activeCardId) || null;

				const renderDraft = () => react.createElement("div", { className: "mcp-card-form" },
					react.createElement("div", { className: "mcp-field" },
						react.createElement("div", { className: "mcp-field-label" }, t("cardName")),
						react.createElement("input", {
							className: "mcp-input",
							value: draft.name,
							placeholder: t("cardNamePlaceholder"),
							onChange: (event) => setDraft((prev) => (prev ? { ...prev, name: event.target.value } : prev)),
						}),
					),
					draft.rows.length === 0
						? react.createElement("div", { className: "mcp-field-hint" }, t("noParams"))
						: draft.rows.map((row, index) => react.createElement("div", { className: "mcp-field", key: row.name },
							react.createElement("div", { className: "mcp-field-label" },
								react.createElement("span", null, row.name),
								row.required ? react.createElement("span", { className: "mcp-field-req" }, "*") : null,
								react.createElement("span", { className: "mcp-gate-tag" }, row.type),
								react.createElement("span", { className: "mcp-mode" },
									react.createElement("button", {
										className: "mcp-gate-mini" + (row.mode === "fixed" ? " is-on" : ""),
										onClick: () => setDraftRow(index, { mode: "fixed" }),
									}, t("cardFixed")),
									react.createElement("button", {
										className: "mcp-gate-mini" + (row.mode === "dynamic" ? " is-on" : ""),
										onClick: () => setDraftRow(index, { mode: "dynamic" }),
									}, t("cardDynamic")),
								),
							),
							row.type === "boolean"
								? react.createElement("label", { className: "mcp-check" },
									react.createElement("input", {
										type: "checkbox",
										checked: row.value === true,
										onChange: (event) => setDraftRow(index, { value: event.target.checked }),
									}),
									react.createElement("span", null, row.value === true ? "true" : "false"),
								)
								: react.createElement("input", {
									className: "mcp-input",
									type: row.type === "number" ? "number" : "text",
									value: row.value === undefined || row.value === null ? "" : String(row.value),
									onChange: (event) => setDraftRow(index, { value: event.target.value }),
								}),
							row.type === "number"
								? react.createElement("div", { className: "mcp-card-row" },
									react.createElement("label", { className: "mcp-check" },
										react.createElement("input", {
											type: "checkbox",
											checked: row.integer !== false,
											onChange: (event) => setDraftRow(index, { integer: event.target.checked }),
										}),
										react.createElement("span", null, t("cardInteger")),
									),
									react.createElement("input", {
										className: "mcp-input",
										type: "number",
										placeholder: t("cardMin"),
										value: row.min,
										onChange: (event) => setDraftRow(index, { min: event.target.value }),
									}),
									react.createElement("input", {
										className: "mcp-input",
										type: "number",
										placeholder: t("cardMax"),
										value: row.max,
										onChange: (event) => setDraftRow(index, { max: event.target.value }),
									}),
								)
								: null,
						)),
					draft.error ? react.createElement("div", { className: "mcp-field-error" }, String(draft.error)) : null,
					react.createElement("div", { className: "mcp-panel-actions" },
						react.createElement("button", { className: "mcp-gate-mini", onClick: saveDraft, disabled: busy }, t("cardCreate")),
						react.createElement("button", { className: "mcp-gate-mini", onClick: () => setDraft(null), disabled: busy }, t("cancel")),
					),
				);

				return react.createElement("div", { className: "mcp-panel" },
					react.createElement("div", { className: "mcp-panel-head" },
						react.createElement("div", { className: "mcp-panel-title" },
							react.createElement(McpGlyph, { size: 14, className: "mcp-panel-title-icon" }),
							t("panelTitle"),
						),
						react.createElement("div", { className: "mcp-panel-sub" },
							`${t("panelGuide")} · 隐藏 ${hiddenCount} / 已注入 ${injectedCount}`),
					),
					react.createElement("div", { className: "mcp-panel-toolbar" },
						react.createElement("input", {
							className: "mcp-gate-search",
							type: "search",
							value: query,
							placeholder: t("panelSearch"),
							onChange: (event) => setQuery(event.target.value),
						}),
						react.createElement("button", {
							className: "mcp-gate-mini",
							onClick: () => applyInject([]),
							disabled: busy || injectedCount === 0,
						}, t("clearAll")),
					),
					// 快捷卡片：搜索框下面一排（点开即调，参数可固定 / 动态）
					react.createElement("div", { className: "mcp-cards" },
						cards.length === 0
							? react.createElement("div", { className: "mcp-card-tool" }, t("shortcutEmpty"))
							: cards.map((card) => react.createElement("button", {
								key: card.id,
								className: "mcp-card" + (activeCardId === card.id ? " is-active" : ""),
								onClick: () => (activeCardId === card.id
									? (setActiveCardId(""), setCardPreview(null))
									: openCard(card)),
							},
								react.createElement("span", { className: "mcp-card-name" }, card.name),
								react.createElement("span", { className: "mcp-card-tool" }, toolLabel(card.tool)),
							)),
					),
					draft ? renderDraft() : null,
					!draft && activeCardId ? (cards.find((card) => card.id === activeCardId) || null) ? renderCardForm(cards.find((card) => card.id === activeCardId)) : null : null,
					react.createElement("div", { className: "mcp-panel-body" },
						data.loading
							? react.createElement("div", { className: "mcp-panel-empty" }, t("loading"))
							: data.error
								? react.createElement("div", { className: "mcp-panel-empty" }, data.error)
								: servers.length === 0
									? react.createElement("div", { className: "mcp-panel-empty" }, t("panelEmpty"))
									: visible.length === 0
										? react.createElement("div", { className: "mcp-panel-empty" }, t("noMatch"))
										: visible.map((server) => react.createElement("section", { className: "mcp-panel-server", key: server.name },
											react.createElement("div", { className: "mcp-panel-server-head", title: server.source || server.name },
												react.createElement("span", { className: "mcp-gate-server-name" }, server.name),
												react.createElement("span", { className: "mcp-gate-tag" + (server.level === "project" ? " is-project" : "") },
													server.level === "project" ? t("project") : t("user")),
												react.createElement("button", {
													className: "mcp-gate-mini mcp-server-toggle" + (server.tools.every((tool) => tool.injected) ? " is-on" : ""),
													onClick: () => toggleServer(server),
													disabled: busy || server.tools.length === 0,
												}, server.tools.every((tool) => tool.injected) ? t("clearServer") : t("injectServer")),
											),
											server.tools.map((tool) => react.createElement("div", { className: "mcp-panel-tool", key: tool.name },
												react.createElement("div", { className: "mcp-panel-tool-name" }, tool.name),
												tool.description ? react.createElement("div", { className: "mcp-panel-tool-desc" }, tool.description) : null,
												react.createElement("div", { className: "mcp-panel-actions" },
													react.createElement("button", {
														className: "mcp-gate-mini",
														onClick: () => toggleInject(tool),
														disabled: busy,
													}, tool.injected ? "✓ " + t("injectOn") : t("inject")),
													react.createElement("button", {
														className: "mcp-gate-mini",
														onClick: () => (calling && calling.name === tool.name ? stopCall() : startCall(tool)),
														disabled: busy,
													}, t("call")),
													react.createElement("button", {
														className: "mcp-gate-mini",
														onClick: () => startDraft(tool),
														disabled: busy,
													}, t("createCard")),
												),
												// ① 参数表单（表单 / JSON 双模式）
												calling && calling.name === tool.name && !preview
													? react.createElement("div", { className: "mcp-panel-form" },
														react.createElement("div", { className: "mcp-panel-actions" },
															react.createElement("span", { className: "mcp-field-label" }, t("params")),
															react.createElement("button", {
																className: "mcp-gate-mini",
																onClick: () => {
																	if (rawMode) {
																		// JSON → 表单：能解析就回填，解析不了保持 JSON 模式
																		try {
																			const parsed = JSON.parse(rawText);
																			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
																				const next = { ...values };
																				for (const field of fields) {
																					if (parsed[field.name] === undefined) continue;
																					next[field.name] = typeof parsed[field.name] === "object"
																						? JSON.stringify(parsed[field.name])
																						: String(parsed[field.name]);
																				}
																				setValues(next);
																				setRawMode(false);
																			}
																		} catch {}
																	} else {
																		const built = buildArgs(fields, values);
																		setRawText(JSON.stringify(built.args, null, 2));
																		setRawMode(true);
																	}
																},
															}, rawMode ? t("formMode") : t("rawMode")),
														),
														rawMode
															? react.createElement("textarea", {
																className: "mcp-panel-args",
																value: rawText,
																spellCheck: false,
																onChange: (event) => setRawText(event.target.value),
															})
															: fields.length === 0
																? react.createElement("div", { className: "mcp-field-hint" }, t("noParams"))
																: fields.map(renderField),
														errors.__raw ? react.createElement("div", { className: "mcp-field-error" }, errors.__raw) : null,
														react.createElement("div", { className: "mcp-panel-actions" },
															react.createElement("button", { className: "mcp-gate-mini", onClick: sendCall, disabled: busy }, t("call")),
															react.createElement("button", { className: "mcp-gate-mini", onClick: stopCall, disabled: busy }, t("cancel")),
														),
													)
													: null,
												// ② 结果预览：先看清楚，确认后才写进会话
												preview && preview.toolName === tool.name
													? react.createElement("div", { className: "mcp-panel-form" },
														react.createElement("div", { className: "mcp-field-label" }, t("previewTitle")),
														preview.isError ? react.createElement("div", { className: "mcp-field-error" }, t("previewFailed")) : null,
														react.createElement("pre", { className: "mcp-preview" }, preview.text),
														react.createElement("div", { className: "mcp-panel-actions" },
															react.createElement("button", { className: "mcp-gate-mini", onClick: commitPreview, disabled: busy }, t("confirmSend")),
															react.createElement("button", { className: "mcp-gate-mini", onClick: () => setPreview(null), disabled: busy }, t("discard")),
														),
													)
													: null,
											)),
										)),
						status ? react.createElement("div", { className: "mcp-panel-status" }, status) : null,
					),
				);
			}

			// 注册右侧栏 tab 类型 + 引导页入口（右侧栏起始页的卡片）。
			ctx.effect(() => ctx.sidebarRightTabs.register({
				id: "dsh-mcp-compat",
				kind: "mcp-compat",
				title: () => t("panelTitle"),
				icon: McpGlyph,
				guide: [{ order: 40, title: () => t("panelTitle"), description: () => t("panelGuide"), icon: McpGlyph }],
			}), "mcp-compat: sidebar tab type");
			// tab 胶囊标题（图标的落点）：官方按 type.id 分发到 sidebar.right.pane.tab.title
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register(
				{ name: "sidebar.right.pane.tab.title", key: "dsh-mcp-compat" },
				() => react.createElement("span", { className: "mcp-tab-title" },
					react.createElement(McpGlyph, { size: 14 }),
					react.createElement("span", null, t("panelTitle")),
				),
			)), "mcp-compat: sidebar tab title");
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register(
				{ name: "sidebar.right.pane.tab", key: "dsh-mcp-compat" },
				(props) => react.createElement(McpManagerView, { ...props }),
			)), "mcp-compat: sidebar tab body");

			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: "dsh-mcp-compat",
				id: "mcp-compat-settings",
				order: 10,
				label: "MCP 兼容",
			}, SettingsCard));

			// 仅供 test/ 使用：参数表单的纯逻辑（不参与运行时契约）。
			exports.__internals = { schemaFields, initialValues, buildArgs };
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});











