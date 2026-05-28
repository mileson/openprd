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

1. 先从 `.openprd/` 重建当前状态，并运行 `openprd run . --context`
2. 需要具体命令时，优先读取 `.openprd/harness/command-catalog.md`
3. 需要共用约束时，读取 `skills/openprd-shared/SKILL.md`
4. 需要主工作流时，读取 `skills/openprd-harness/SKILL.md`

## 路由表

- 主工作流、需求入口、review/change/tasks、`run/loop`：`skills/openprd-harness/SKILL.md`
- 最佳实践、benchmark、公开 GitHub 仓库、第三方技术事实、prompt/context engineering：`skills/openprd-benchmark-router/SKILL.md`
- `docs/basic/`、文件说明书、文件夹 README、文档标准：`skills/openprd-standards/SKILL.md`
- 就绪验证、EVO 门禁、HTML 质量评估报告、项目经验沉淀：`skills/openprd-quality/SKILL.md`
- 架构图、产品流程图、可视评审：`skills/openprd-diagram-review/SKILL.md`
- 长时间只读挖掘、参考项目持续调研、requirements/specs/tasks 补全：`skills/openprd-discovery-loop/SKILL.md`
- 学习包、归档阅读器、知识整理：`skills/openprd-learning-review/SKILL.md`

## 路由原则

- `AGENTS.md` 只保留轻量入口合同；不要再把整套 skill 路由和命令清单塞回 `AGENTS.md`
- hooks 已经强制处理 requirement / research / secrets / skill-visualization / weapp / browser / copy 这些门禁
- 公开 GitHub 仓库架构/对标先 DeepWiki；第三方库、API、SDK、MCP、CLI 用法先查本地证据，本地不足时再按 `resolve_library_id -> query_docs` 使用 Context7
- 如果用户只是要规划、分析、评审或解释影响范围，保持只读，不要因为命令存在就直接执行写入
