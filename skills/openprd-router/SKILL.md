---
name: openprd-router
description: OpenPrd 入口路由 skill。先判断当前任务该读哪个 repo-local skill、哪个命令面和哪个门禁，再进入具体执行。
---

# OpenPrd Router

## 作用

这份 skill 是 OpenPrd 的入口路由，不是长文规则仓库。

- 先决定该读哪个 skill
- 再决定该看哪个命令入口
- 最后才进入具体实现、评审或验证

## 入口顺序

1. 如果用户当前明确在说“帮我梳理下”“先想清楚”“进入脑暴模式”，先读取 `skills/openprd-requirement-intake/SKILL.md`，并优先运行 `openprd run . --context --message <用户原话>`；需要时直接进入 `openprd brainstorm . --open`，不要只跑不带 message 的 `openprd run . --context`
2. 其他情况再从 `.openprd/` 重建当前状态，并运行 `openprd run . --context`
3. 如果当前是空白工作区的前端/页面冷启动，而且用户已经给了明确的页面主题、模块范围或“直接实现”的意图，优先改用 `openprd run . --context --message <用户原话>`；不要先跑不带 message 的 `openprd run . --context`，再被空白工作区自己的 `clarify-user` 带偏
4. 需要具体命令时，优先读取 `.openprd/harness/command-catalog.md`
5. 需要共用约束时，读取 `skills/openprd-shared/SKILL.md`
6. 需要主工作流时，读取 `skills/openprd-harness/SKILL.md`
7. 任务涉及界面、页面、视觉、样式、信息架构、内容型页面或前端体验时，额外读取 `skills/openprd-frontend-design/SKILL.md`
8. 如果当前是轻量前端原型任务，而且工作区几乎没有现成页面文件，读完前端设计 skill 后先填写 `.openprd/design/active/*`，不要在 `docs/basic/` 占位文档里来回打转
9. 如果用户已经给了效果图、设计稿、参考截图或其他明确参考图，仍然走前端设计 skill，但要把参考图当主约束；只有现有 starter / theme / layout 足够接近时才复用，不要让样式库把页面带到另一种风格
10. 如果这类空白前端任务在带 message 的前提下仍短暂返回 `clarify-user`，但用户原话已经明确要求直接实现单页/首页/原型，就把它当成摘要级提醒；先用 3 到 5 行 mini-plan 收口，再按 frontend design 的 `design-starter -> Patch Mode` 路径继续，不要回到长澄清或模板源码漫游

## 路由表

- 需求入口分流、用户可见需求类型与内部 L0/L1/L2 路由码对照、PRD 场景视角选择：`skills/openprd-requirement-intake/SKILL.md`
- 主工作流、review/change/tasks、`run/loop`：`skills/openprd-harness/SKILL.md`
- 前端设计框架、审美资产库、主题/骨架/组件/配方、事实与素材前置门：`skills/openprd-frontend-design/SKILL.md`
- 最佳实践、benchmark、公开 GitHub 仓库、第三方技术事实、prompt/context engineering：`skills/openprd-benchmark-router/SKILL.md`
- `docs/basic/`、文件说明书、文件夹 README、文档标准：`skills/openprd-standards/SKILL.md`
- 就绪验证、EVO 门禁、HTML 质量评估报告、项目经验沉淀：`skills/openprd-quality/SKILL.md`
- 架构图、产品流程图、解释型 SVG、可视评审、大界面改动效果图方案评审：`skills/openprd-diagram-review/SKILL.md` 与 `skills/openprd-harness/SKILL.md`
- 长时间只读挖掘、参考项目持续调研、requirements/specs/tasks 补全：`skills/openprd-discovery-loop/SKILL.md`
- 学习包、归档阅读器、知识整理：`skills/openprd-learning-review/SKILL.md`

## 路由原则

- `AGENTS.md` 只保留轻量入口合同；不要再把整套 skill 路由和命令清单塞回 `AGENTS.md`
- hooks 已经强制处理 requirement / research / secrets / skill-visualization / weapp / browser / copy 这些门禁
- 公开 GitHub 仓库架构/对标先 DeepWiki；第三方库、API、SDK、MCP、CLI 用法先查本地证据，本地不足时再按 `resolve_library_id -> query_docs` 使用 Context7
- 如果用户只是要规划、分析、评审或解释影响范围，保持只读，不要因为命令存在就直接执行写入
- 用户原话里已经明确要求“先梳理/脑暴”时，用户意图优先于不带 message 的默认 run context；先把原话带进 `openprd run . --context --message ...`，或直接进入脑暴模式
- 不要用固定关键词决定是否写 PRD，也不要用词表决定工具；先让 `openprd-requirement-intake` 按影响面、未知数、决策成本和验证成本做语义分流，再按用户目标、期望产物、交付阶段和证据缺口选择学习器、视觉评审或质量收口工具
- 当用户需要理解状态跳转、因果链、方案差异、边界分工或风险传播时，先读 `skills/openprd-diagram-review/SKILL.md`，优先用轻量解释型 SVG 辅助说明；不要把它误升级成正式评审图或视觉验收图
