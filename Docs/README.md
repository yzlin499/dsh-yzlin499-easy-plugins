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

## 写作约定

- 深度文档是**带日期的快照**：记录当时的 DSH 版本、实测数据与结论，不随代码演进回改。
  结论变化时新增一篇文档，并在本索引里标注取代关系，别直接改写历史。
- 文档里提到已下线的插件（如 `dsh-quick-file`、`dsh-yzlin499-plugins-manager`）属于历史事实，
  保留原样即可；面向使用者的「已下线」清单在根 [README.md](../README.md)。
- 新增主题目录后同步更新本索引（约定见 [AGENTS.md](../AGENTS.md)「文档维护」）。
