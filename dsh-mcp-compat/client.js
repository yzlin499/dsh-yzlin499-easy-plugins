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
			".mcp-panel-title{font-size:13px;font-weight:600}",
			".mcp-panel-sub{font-size:10.5px;color:var(--dsw-alias-label-tertiary);line-height:1.4}",
			".mcp-panel-toolbar{display:flex;gap:6px;padding:8px 12px 0}",
			".mcp-panel-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px 12px 12px;display:flex;flex-direction:column;gap:10px}",
			".mcp-panel-server{flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}",
			".mcp-panel-server-head{display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--dsw-alias-bg-module-platform);font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".mcp-panel-tool{padding:7px 10px;border-top:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:4px}",
			".mcp-panel-tool-name{font-size:11.5px;word-break:break-all}",
			".mcp-panel-tool-desc{font-size:10.5px;color:var(--dsw-alias-label-tertiary);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
			".mcp-panel-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}",
			".mcp-panel-form{display:flex;flex-direction:column;gap:6px;margin-top:2px}",
			".mcp-panel-args{width:100%;box-sizing:border-box;min-height:110px;resize:vertical;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-primary);font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;padding:8px}",
			".mcp-panel-status{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto}",
			".mcp-panel-empty{padding:20px 4px;text-align:center;font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:1.6}",
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
					fetch("/mcp-compat/tools?workspacePath=" + encodeURIComponent(request.path))
						.then((r) => r.json())
						.then((payload) => {
							if (!alive) return;
							if (payload && payload.ok) applyData(payload);
							else setData({ loading: false, error: errorText(payload && payload.error), servers: [] });
						})
						.catch((e) => {
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
					fetch("/mcp-compat/tools", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ workspacePath: request.path, disabled: [...draft] }),
					})
						.then((r) => r.json())
						.then((payload) => {
							setBusy(false);
							if (payload && payload.ok) {
								applyData(payload);
								setStatus(t("saved"));
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

			// ── 右侧栏「MCP 管理」面板 ─────────────────────────────────────────
			// 只列「当前工作区被隐藏的」MCP 工具（全程可见的那些不进来），提供两种用法：
			//   ① 注入：临时把工具加进当前会话的可见集（Host 内存态，会话结束即失效）；
			//   ② 调用：填参数直接执行，结果按模板作为一条 user 消息写进当前会话，
			//      工具本身从不进入上下文。
			/** 从工具的参数 schema 生成一份可编辑的 JSON 骨架。 */
			function argsSkeleton(schema) {
				const props = schema && typeof schema === "object" ? schema.properties : null;
				if (!props || typeof props !== "object") return "{}";
				const out = {};
				for (const [key, def] of Object.entries(props)) {
					const type = def && def.type;
					out[key] = type === "number" || type === "integer" ? 0
						: type === "boolean" ? false
							: type === "array" ? []
								: type === "object" ? {}
									: "";
				}
				return JSON.stringify(out, null, 2);
			}

			function McpManagerView(props) {
				const sessionId = props && props.sessionId ? String(props.sessionId) : "";
				const [data, setData] = react.useState({ loading: true, error: "", servers: [] });
				const [busy, setBusy] = react.useState(false);
				const [status, setStatus] = react.useState("");
				const [query, setQuery] = react.useState("");
				const [calling, setCalling] = react.useState(null);
				const [argsText, setArgsText] = react.useState("{}");

				const load = () => {
					if (!sessionId) {
						setData({ loading: false, error: t("readFailed"), servers: [] });
						return;
					}
					setData((prev) => ({ ...prev, loading: true, error: "" }));
					fetch("/mcp-compat/panel?sessionId=" + encodeURIComponent(sessionId))
						.then((r) => r.json())
						.then((payload) => {
							if (payload && payload.ok) setData({ loading: false, error: "", servers: payload.servers || [] });
							else setData({ loading: false, error: errorText(payload && payload.error), servers: [] });
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
					fetch("/mcp-compat/panel/inject", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId, tools: names }),
					})
						.then((r) => r.json())
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
				const toggleInject = (tool) => {
					const next = new Set(currentInjected());
					if (next.has(tool.name)) next.delete(tool.name);
					else next.add(tool.name);
					applyInject([...next]);
				};
				const startCall = (tool) => {
					setCalling(tool.name);
					setArgsText(argsSkeleton(tool.parameters));
					setStatus("");
				};
				const sendCall = () => {
					if (!calling) return;
					setBusy(true);
					setStatus(t("calling"));
					fetch("/mcp-compat/panel/call", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId, name: calling, args: argsText }),
					})
						.then((r) => r.json())
						.then((payload) => {
							setBusy(false);
							if (payload && payload.ok) {
								setCalling(null);
								setStatus((payload.isError ? t("callError") : t("callDone")) + "\n" + String(payload.text || ""));
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
				const hiddenCount = servers.reduce((n, server) => n + (server.tools || []).filter((tool) => !tool.injected).length, 0);
				const injectedCount = servers.reduce((n, server) => n + (server.tools || []).filter((tool) => tool.injected).length, 0);

				return react.createElement("div", { className: "mcp-panel" },
					react.createElement("div", { className: "mcp-panel-head" },
						react.createElement("div", { className: "mcp-panel-title" }, t("panelTitle")),
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
														onClick: () => (calling === tool.name ? setCalling(null) : startCall(tool)),
														disabled: busy,
													}, t("call")),
												),
												calling === tool.name
													? react.createElement("div", { className: "mcp-panel-form" },
														react.createElement("textarea", {
															className: "mcp-panel-args",
															value: argsText,
															spellCheck: false,
															onChange: (event) => setArgsText(event.target.value),
														}),
														react.createElement("div", { className: "mcp-panel-actions" },
															react.createElement("button", { className: "mcp-gate-mini", onClick: sendCall, disabled: busy }, t("send")),
															react.createElement("button", { className: "mcp-gate-mini", onClick: () => setCalling(null), disabled: busy }, t("cancel")),
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
				guide: [{ order: 40, title: () => t("panelTitle"), description: () => t("panelGuide") }],
			}), "mcp-compat: sidebar tab type");
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
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
