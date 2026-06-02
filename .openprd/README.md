# OpenPrd 工作区

简体中文 | [English](./README_EN.md)

`.openprd/` 是项目内的事实源，承接 discovery、PRD synthesize、validate、freeze 和 handoff。

## 生命周期

```text
classify -> interview -> synthesize -> validate -> freeze -> handoff
```

## 这里包含什么

- `config.yaml` - 运行时默认值和工作流策略
- `schema/` - 标准 PRD schema 与校验规则
- `schema/diagram-architecture.schema.yaml` - 架构图最小契约 schema
- `schema/diagram-product-flow.schema.yaml` - 产品流程图最小契约 schema
- `templates/` - starter pack 和模板注册表
- `templates/diagram/` - 图表产物的 contract 模板
- `standards/` - 项目标准契约与说明书模板
- `engagements/active/` - 当前默认 PRD 草稿、流程、角色和交接文档
- `engagements/active/decision-log.md` - 持久化决策历史
- `engagements/active/open-questions.md` - 未解决问题与 discovery 缺口
- `engagements/active/progress.md` - 追加式执行进度
- `engagements/active/verification.md` - freeze 和 validation 证据
- `engagements/active/architecture-diagram.html` - 可评审的架构图 artifact
- `engagements/active/architecture-diagram.json` - 便于迭代的结构化图表 contract
- `engagements/active/product-flow-diagram.html` - 可评审的产品流程图 artifact
- `engagements/active/product-flow-diagram.json` - 便于迭代的结构化流程图 contract
- `artifacts/active/` - human-in-the-loop 评审与 playground 工作流使用的 HTML + Markdown + patch bundle
- `artifacts/archive/` - 需求评审或 handoff 后归档的 artifact bundle
- `state/` - 运行时状态、版本索引、freeze 快照、会话元数据和执行图
- `state/task-graph.json` - 工作流 / 任务图、blocker 和 next-ready 节点
- `state/events.jsonl` - 追加式生命周期事件流
- `state/versions/` - 不可变版本快照
- `sessions/` - 每个 engagement 的工作状态
- `exports/` - 下游输出，例如 OpenSpec handoff bundle

## 模板层级

```text
base -> industry -> company -> project -> session
```

规则：

- 核心 PRD 字段固定。
- 模板层可以新增或重排章节。
- 模板层不能删除必需语义。
- active engagement 是会持续演进的工作草稿。
- `classify` 负责设置产品类型；`interview` 负责加载 discovery 提示。
- `next` 负责推荐下一步动作和 discovery 问题。
- `synthesize` 负责写入新的版本化 PRD 快照。
- HTML review 与 playground artifact 应同时配对 markdown 数据源和 machine-readable capture patch。
- `diff` 比较版本快照。
- `history` 列出版本索引。
- freeze 前必须先通过 validation。
- `standards` 会校验 `docs/basic/`、文件说明书模板和文件夹 README 模板。

## 项目标准

项目级基线文档路径固定为 `docs/basic/`。

必需文档：

- `docs/basic/file-structure.md`
- `docs/basic/app-flow.md`
- `docs/basic/prd.md`
- `docs/basic/frontend-guidelines.md`
- `docs/basic/backend-structure.md`
- `docs/basic/tech-stack.md`

在汇报变更已就绪前，先运行 `openprd standards <path> --verify`。

## 支持的产品类型

- `consumer`
- `b2b`
- `agent`

## 交接原则

目标不只是写出一份 PRD，而是让 PRD 能随着产品演进持续存活，并在执行启动时导出稳定的 handoff 包。
