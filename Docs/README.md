# Docs —— 项目知识库

本目录与根目录 [README.md](../README.md)（面向使用者）、[AGENTS.md](../AGENTS.md)（面向开发者 / AI 代理）
分工互补：**README 讲怎么用，AGENTS 讲怎么改，Docs 讲怎么装、怎么配、为什么这么设计。**

## 快速入口

| 文件 | 内容 |
|---|---|
| [Install.md](Install.md) | 安装 / 卸载、本地联调（`link:` 方式）、常见安装问题 |
| [Settings.md](Settings.md) | 插件配置持久化：官方 `ctx.settings` 机制、历史白名单坑、Host + Client 正确姿势、设置卡片 UI 规范 |
| [参考.md](参考.md) | 官方文档与插件生态链接 |

## 深度文档（按主题归档）

### ctx-menu —— 右键增强插件

已落地为插件 [`dsh-ctx-menu`](../dsh-ctx-menu/README.md)。三篇文档是同一条链路：
**需求 → 调研 → 设计**。

| 文件 | 内容 |
|---|---|
| [需求-右键优化.md](ctx-menu/需求-右键优化.md) | 使用场景、硬约束（不破坏官方菜单、不抢「选中文本 → 复制」）、待定项 |
| [调研-右键插件.md](ctx-menu/调研-右键插件.md) | 全量扫描官方 `app.asar`：右键相关代码分布、可复用锚点、官方插槽 |
| [设计-右键优化.md](ctx-menu/设计-右键优化.md) | 捕获阶段接管、锚点表、动作表、自绘与官方菜单双入口方案 |

### codex-import —— 把 Codex 会话导入 DSH（尚未实现）

| 文件 | 内容 |
|---|---|
| [调研-导入Codex会话.md](codex-import/调研-导入Codex会话.md) | **决策篇**：本机实测、方案对比、回写能力，结论是「优先复用现成插件」 |
| [调研-导入Codex会话-Codex本地存储格式.md](codex-import/调研-导入Codex会话-Codex本地存储格式.md) | **数据格式篇**：rollout / sqlite / 索引结构、转换映射表、注入正则、陷阱清单 |
| [调研-导入Codex会话-外部生态附录.md](codex-import/调研-导入Codex会话-外部生态附录.md) | **生态篇**：官方 `resume` / `fork` / app-server 通道、ACP 判定、同类迁移工具 |

### remote-access —— 远程访问公司 / 另一台机器的 DSH（调研，未落地插件）

问题：「人在家里，用家里的 DSH 连公司那台 DSH」。结论是**不需要为此写插件**——本体 CLI 已能
被远程浏览器访问，缺的只是网络打通；生态里另有一整类第三方远程访问插件可选。

| 文件 | 内容 |
|---|---|
| [调研-DSH本体远程访问能力.md](remote-access/调研-DSH本体远程访问能力.md) | **本体篇**：实测 `--help` / asar、`0.0.0.0` 被拒绝、强制 token + cookie 鉴权与 Host/Origin 栅栏、三条路线（VPN / 隧道 / SSH 转发）、为什么不建议为此写插件 |
| [调研-远程访问插件-生态.md](remote-access/调研-远程访问插件-生态.md) | **生态篇**：`ctx.remote.*` 与「远程机器」的两义辨析、awesome 目录 3730 条里筛出的候选、逐个验真（通道 / 两端要装什么 / 鉴权 / 是否过第三方中转）与安全风险清单 |
| [调研-桌面客户端作为被远程访问端.md](remote-access/调研-桌面客户端作为被远程访问端.md) | **桌面客户端篇**：桌面 App 起服务的链路、token 只进内存（`WeakMap`）不可外取、`--profile desktop` 被 CLI 硬拒、cookie 绑 authority、ssh -L 实测 401 与两条绕法、`webserver` / `connection` 行 schema |

### plugin-market-installed —— 官方「发现」页加「已安装置顶 / 更新标记」（调研，未落地插件）

问题：官方发现页（实验性插件市场）里分不清哪些已安装、哪些有更新。A/B 分别验证 UI 侧与 Host 侧可行性，
C 做外部生态与方案设计，D/E/F 对社区「市场 / 更新」类插件做源码验真与排序。结论均记录在各自文末。

| 文件 | 内容 |
|---|---|
| [调研-A-发现页UI.md](plugin-market-installed/调研-A-发现页UI.md) | **UI 侧**：发现页没有可扩展的 slot 挂点；分类 chip 行来自索引文档而非常量——决定了"只能旁路实现" |
| [调研-B-Host与更新检查.md](plugin-market-installed/调研-B-Host与更新检查.md) | **Host / 数据侧**：`installation.status` 的更新信息只在"市场索引里有该包"时才成立 |
| [调研-C-外部生态与方案设计.md](plugin-market-installed/调研-C-外部生态与方案.md) | **生态 + 方案**：外部同类能力盘点与落地形态设计 |
| [调研-D-99galaxy市场插件验真.md](plugin-market-installed/调研-D-99galaxy市场插件验真.md) | 对 `@99galaxy/dsh-plugin-market` v1.1.1 逐行验真，判断能否直接替代需求 |
| [调研-E-更新类插件验真.md](plugin-market-installed/调研-E-更新类插件验真.md) | 三个「更新检查 / 自动更新」类社区插件源码验真 |
| [调研-F-市场类插件全扫与排序.md](plugin-market-installed/调研-F-市场类插件全扫与排序.md) | 官方索引 3730 条里 58 个 market 类，按「已安装 + 可更新 + 一键升级」能力排序 |

## 写作约定

- 深度文档是**带日期的快照**：记录当时的 DSH 版本、实测数据与结论，不随代码演进回改。
  结论变化时新增一篇文档，并在本索引里标注取代关系，别直接改写历史。
- 文档里提到已下线的插件（如 `dsh-quick-file`、`dsh-yzlin499-plugins-manager`）属于历史事实，
  保留原样即可；面向使用者的「已下线」清单在根 [README.md](../README.md)。
- 新增主题目录后同步更新本索引（约定见 [AGENTS.md](../AGENTS.md)「文档维护」）。
