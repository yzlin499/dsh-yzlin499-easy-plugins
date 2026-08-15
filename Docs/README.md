# Docs —— 项目知识库

本目录是 `dsh-yzlin499-easy-plugins` 的知识库，沉淀插件开发相关的领域知识，
与根目录 README（面向使用者）互补：

- **README.md** —— 插件是什么、怎么装、怎么用（使用者视角）
- **Docs/** —— 插件包格式、Host/Client 架构、踩坑记录（开发者视角）

## 规划内容（待补充）

- [ ] DSH 插件包（bundle）格式：`package.json` 的 `dsh.bundle.patch`、`cordis.patch.yml`、`dsh.plugin.json`
- [ ] Host / Client 半侧架构：webServer 路由、Slot 注册、`__ModuleLoader__`
- [ ] 踩坑记录：`ERR_MODULE_NOT_FOUND`、Cookie 内存策略、生命周期清理等

> 每个插件包内部也自带设计注释（`index.js` 头部），与此处文档互相印证。
