# 产品逻辑说明

## 问题与目标

OpenPrd 要解决的是 Agent 在需求、调研、实现和交付之间缺少统一工作区状态与质量门禁的问题，同时避免质量门禁在小需求上变成额外负担。目标用户是使用 Codex、Claude 或 Cursor 进行产品/工程协作的团队。成功标准是 Agent 能基于 `.openprd/` 判断当前任务边界，只在明确执行意图下推进任务，并在实现完成前维护基础文档、文件说明书、文件夹说明书和业务成本护栏。

## 用户故事

- 作为项目负责人，我希望 Agent 在我要求“看看、梳理、怎么改”时只做只读分析，从而避免误启动执行任务。
- 作为项目负责人，我希望大量只读扫描的并行调研规则由 OpenPrd discovery 管理，从而不需要在项目 AGENTS 中长期维护大段 subagent 说明。
- 作为开发者，我希望一句话小需求不会触发每个工具调用的 OpenPrd hook，从而让简单改动保持轻量。
- 作为工程协作者，我希望 Agent 在新增或修改代码时自动判断文档影响，从而让 `docs/basic/`、文件说明书和文件夹说明书保持可信。
- 作为工程协作者，我希望每次阶段性开发结束后获得 HTML 质量评估报告，从而能审查日志链路、业务护栏、冒烟测试、功能覆盖、性能基线和极端场景证据。
- 作为项目负责人，我希望涉及免费用户、额度、AI 调用或第三方成本的需求会自动追问成本来源、限制、报警和止损动作，从而减少免费额度被滥用造成真实损失的风险。
- 作为项目维护者，我希望排查并验证修复的问题能抽象成项目级经验 skill，从而让同类问题下次被提前识别。
- 作为维护者，我希望旧项目通过 fleet 刷新后也获得同样的 agent guidance，从而减少历史项目沿用旧规则的风险。
- 作为项目复盘读者，我希望复盘学习书的标题、大纲和正文由 Agent 根据真实任务证据撰写，而不是由 CLI 套用固定模板。

## 功能范围

- 包含：OpenPrd workspace 初始化、agent guidance 生成、意图门禁、run/loop/discovery/task 执行建议、standards 校验、历史项目 fleet 刷新。
- 包含：OpenPrd discovery 的大量只读扫描调度规则，覆盖何时启动只读 subagent、默认调研与审查队形、最大并行数量、角色选择和证据合并要求。
- 包含：Codex hook profile，默认 `lite` 安装 `UserPromptSubmit` 和只匹配直接编辑工具的轻量 `PreToolUse` 写入门禁，`guarded` 额外覆盖 shell 工具，`full` 作为完整 hook 遥测的显式开启选项。
- 包含：实现阶段的文档影响判定规则，覆盖缺失文档补齐和已有文档过期检查。
- 包含：PRD 业务护栏层，在命中免费、额度、用量、AI 生成、模型调用或第三方成本信号时，要求补齐成本来源、额度限制、滥用防护、监控信号、报警阈值和止损动作。
- 包含：`openprd quality` 质量层，初始化 `.openprd/quality/config.json`，生成 JSON + HTML 质量评估报告，评估中心化日志、链路关联字段、业务成本与滥用护栏、冒烟测试、任务覆盖、正常性能、极端压力数据和知识库沉淀。
- 包含：`.openprd/knowledge/` 项目级经验层，将已验证修复抽象为 incident、pattern 和可复用 skill。
- 包含：复盘学习包的 Agent 写作工具包、内容合同校验和 HTML reader 骨架；CLI 不直接生成读者可见的文章内容。
- 不包含：自动推断所有文档内容是否语义最新；Agent 仍需基于本次变更证据进行人工级判断并说明理由。

## 验收标准

- 规划、分析、审查类请求不会因 `run --context` 推荐而自动执行 loop、task advance、discovery advance 或 commit。
- 大量只读 discovery 的 subagent 调度规则存在于 OpenPrd skill 生成源和生成后的 skill 文件中，生成的 AGENTS 合同不包含这段长规则。
- 默认安装后的 Codex 配置包含轻量 OpenPrd `PreToolUse` 写入门禁，且 matcher 收窄到直接编辑工具，不包含只读 shell、PostToolUse 或 Stop 遥测 hooks。
- 明确实现类请求在完成前会检查基础文档、文件说明书、文件夹说明书是否缺失或过期，并补齐或说明无需更新。
- 命中消耗型成本风险的 PRD 在业务护栏字段缺失时会回到 `clarify-user`，不会直接进入 freeze。
- 命中消耗型成本风险的 change 会自动生成成本额度、滥用越权、监控报警和止损验证任务。
- `openprd quality --verify` 会生成 `.openprd/quality/reports/<id>.html`，报告包含日志追踪、业务成本与滥用护栏、冒烟/功能覆盖、性能基线、极端场景和经验沉淀审查结论。
- `openprd quality --learn --from <report>` 会把已审查报告沉淀为 `.openprd/knowledge/` 下的 incident、pattern 和项目级经验 Skill。
- `openprd learn` 未传入 Agent 写作内容时只生成待写作包；传入 `--content-json` 后，输出内容必须包含 Agent 写出的标题、大纲、章节和有效证据引用。
- `npm test`、`openprd standards --verify`、`openprd quality --verify`、`openprd run --verify` 能验证关键门禁没有回退。

## 维护规则

- 每次需求边界、用户故事、验收标准发生变化后，必须检查并更新本文件。
