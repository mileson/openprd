---
name: openprd-shared
description: OpenPrd 工作区与产物的共用守则。凡是需要查看、更新或推进 OpenPrd 工作区，包括 classify、interview、synthesize、diagram、freeze、handoff、图示评审或解读 `.openprd/` 状态文件时，都优先使用这份共用规则。
---

# OpenPrd Shared

## 概览

这份 skill 是所有 OpenPrd 工作的共用规则集。它负责放置跨场景约束，让各个领域 skill 更聚焦，也让 agent 行为更稳定、可预期。

## 共用运行规则

1. 动手前先从工作区重建上下文。
   - 优先读取 `.openprd/state/current.json`、`.openprd/state/task-graph.json`、最新版本快照和当前 engagement 文件，不要只依赖聊天上下文。
2. 明确区分只读命令和写入命令。
   - 只读命令：`status`、`validate`、`next`、`history`、`diff`、`interview`、`doctor`
   - 写入命令：`init`、`setup`、`update`、`classify`、`synthesize`、`diagram`、`freeze`、`handoff`
   - 执行命令：`loop --run`、`tasks --advance`、`discovery --advance`、`loop --finish --commit`、git commit、git push，必须有当前用户明确执行意图。
3. 不要虚构 OpenPrd 命令或产物类型。
   - 不确定时先对照 `openprd --help`。
4. 共用规则放在这里，领域规则放到对应 skill。
   - 工作流编排归 `$openprd-harness`
   - 最佳实践、benchmark、对标、参考产品、prompt engineering、Agent harness、context engineering、CLI 或 skill 体系设计归 `$openprd-benchmark-router`
   - 图示生成与评审归 `$openprd-diagram-review`
   - 项目文档标准归 `$openprd-standards`
   - Agent 接入与 hook 健康度归 `$openprd-harness`，通过 `openprd setup/update/doctor` 维护
5. 所有用户可见产物都跟随用户语言。
   - 标签、评审说明、摘要卡片和操作指引应跟随用户当前主语言。
   - 专有名词、产品名、协议名、API 名称、框架名和云产品名在翻译会损失清晰度时保持原样。
6. 对不确定性要显式表达，不要悄悄脑补。
   - 缺失假设、范围缺口和未解决问题都应该保留在开放问题或评审说明里。
7. 把 freeze 和 handoff 当成门禁动作。
   - 如果工作区仍有需要暴露给用户的关键不确定性，就不要声称已经就绪。
8. 优先使用图结构和状态来推导下一步。
   - 使用 `nextReadyNode`、blocker、当前产物和校验状态来解释为什么接下来该这么做。
9. 执行循环优先依赖 hook-stable 的 run 状态。
   - 用 `openprd run <path> --context` 选择下一个任务、discovery 条目或工作流动作。
   - 把 `run --context` 当作建议上下文，而不是直接执行命令。
   - 声称就绪前运行 `openprd run <path> --verify`。
   - 使用 `.openprd/harness/run-state.json`、`iterations.jsonl` 和 `learnings.md` 承接新会话。
   - 使用 `.openprd/harness/install-manifest.json`、`hook-state.json`、`events.jsonl` 和 `drift-report.json` 判断生成引导是否健康。
   - 使用 `.openprd/quality/config.json`、`.openprd/quality/reports/` 和 `.openprd/knowledge/` 判断实现就绪、评估证据和可复用经验。
10. 把文档视为实现的一部分，而不是收尾清洁。
   - 新增或修改文件时，检查 `docs/basic/`、文件说明书和文件夹 README 是否缺失或已过期。
   - 当职责、流程、结构、依赖或产品行为变化时，补齐缺失文档并更新已有文档。
   - 涉及后端、脚本、Agent、工具链、服务或数据处理变更时，把 CLI 与 API 视为同级接入面；检查命令入口、参数、输出契约、`help`/`doctor`/`dry-run`/`status` 与接口协议、返回结构、身份边界是否受影响，并同步更新 `docs/basic/backend-structure.md`；若某一面不适用也要明确写原因。
11. hook 重量要和任务风险匹配。
   - 默认 Codex hook profile 是 `lite`：`UserPromptSubmit` 加轻量 `PreToolUse` 写入门禁。明确的 OpenPrd / 深度工作提示词，以及新的产品、模块、流程需求会注入上下文。
   - 只有项目明确需要完整 hook 遥测或临时深度诊断时才使用 `full`。
12. 关键产品事实缺失时，先问用户再推进。
   - 如果当前模式不能使用结构化 ask-user 工具，就用自然语言直接询问。
   - 不要把“工具不可用”当成可以悄悄猜测的理由。

## 共用确认规则

- 当用户要求“看看、规划、梳理、分析、评估、explain、review”或列出影响文件时，保持只读。此时只基于证据回答，不运行 `openprd loop --run`、`openprd tasks --advance`、`openprd discovery --advance`、commit、push 或其他写入命令。
- 只有当当前用户消息明确要求开发、实现、修复、继续任务、深度调研、对标复刻或提交时，才执行 OpenPrd loop、task 或 discovery 推进。
- 声称实现就绪前，要说明文档影响检查是新增、更新，还是有意保持 `docs/basic/`、文件说明书和文件夹 README 不变。
- 在系统形态、产品流程或外部依赖仍有实质不确定性时，freeze 前先向用户确认。
- 当用户还没看过最新的 synthesize 产物或图示产物时，handoff 前先确认。
- 当用户要求可视化说明时，路由到 `$openprd-diagram-review`。

## 共用路由规则

- 需要推进主工作流生命周期：使用 `$openprd-harness`
- 需要最佳实践、benchmark、对标、参考产品、prompt engineering、Agent harness、context engineering、CLI 或 skill 体系设计：先使用 `$openprd-benchmark-router` 选择证据源，再按 DeepWiki、Context7 或官方资料规则调研
- 需要架构图、产品流程图、用户旅程或可视确认循环：使用 `$openprd-diagram-review`
- 需要更细的语言规则或命令分类说明时，阅读：
  - `references/operating-rules.md`
  - `references/language-and-review.md`
  - `references/skill-architecture.md`
- 需要项目基线文档、文件说明书、文件夹 README 规则或 standards 校验：使用 `$openprd-standards`
- 需要日志、链路追踪、业务成本护栏、免费额度、滥用防护、冒烟覆盖、性能基线、压力场景、HTML 质量评估报告或项目经验 Skill：使用 `$openprd-quality`
- 需要检查生成引导漂移、hooks 或用户级 Codex 配置：使用 `$openprd-harness`，并运行 `openprd doctor/update`
- 需要 Ralph 风格的 hook 驱动执行：使用 `$openprd-harness` 和 `openprd run`
- 需要按单任务拆分、每个任务一个全新 Codex 或 Claude 会话的长程实现：使用 `$openprd-harness` 和 `openprd loop`
