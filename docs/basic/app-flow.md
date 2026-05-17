# 产品流程说明

## 核心流程

OpenPrd 的核心流程是：用户在项目中初始化或接入 `.openprd/` 工作区，Agent 先读取 `openprd run --context`、`status`、`next` 等只读状态，再根据用户当前意图决定是否推进实现、持续调研、变更任务或只读分析。当前流程强调三层协作面：前半段通过 `clarify.html`、`review.html` 等 HTML 产物帮用户看清楚、比较清楚、确认清楚；执行段通过 tasks、loop、回归报告把实现与验证沉淀成结构化证据；质量段通过 `openprd quality --verify` 生成 HTML 质量评估报告，审查日志链路、业务成本与滥用护栏、冒烟覆盖、任务完整性、性能基线、极端场景和项目级经验沉淀。实现阶段必须同步经过 standards 和 quality 门禁，确认基础文档、文件说明书、文件夹说明书、日志、业务护栏和评估证据是否需要补齐或更新。

## 用户路径

- 初始化项目：用户运行 `openprd init` 或 `openprd setup`，生成 `.openprd/`、`docs/basic/`、AGENTS 和各端 agent guidance；Codex hook 默认使用 `lite`，在明确 OpenPrd/深度流程提示词和新产品、模块、流程类需求下注入上下文，并用只匹配直接编辑工具的轻量写入门禁阻断未确认需求的实现改动。
- 规划或分析：用户要求“看看、梳理、怎么改、预计动哪些文件”时，Agent 只读检查代码、文档和 OpenPrd 状态后输出证据化结论，不启动 loop 或推进任务。
- 澄清与确认：当需求仍模糊、只有一句话、或需要多方案比较时，Agent 优先运行 `openprd clarify`，生成 `clarify.html` 给用户确认问题树、探索方向和导回 payload；合成 PRD 后再生成 `review.html` 用于 freeze 前确认问题、范围、流程和风险。
- 业务护栏澄清：当 PRD 命中免费用户、额度、AI 生成、模型调用或第三方成本风险时，`next` 会把成本来源、额度限制、滥用防护、监控信号、报警阈值和止损动作列为待确认问题。
- 大量只读扫描：当用户明确要求深度调研、全面梳理、交叉验证、并行排查或对标复刻时，OpenPrd discovery skill 负责判断是否启动只读 subagent，并要求主 Agent 汇总证据后再写入 claim、requirements、specs 或 tasks。
- 实现或继续任务：用户明确要求开发、实现、继续、深度调研、深度对标或复刻落地时，Agent 才能运行执行命令，并在完成前检查 `docs/basic/`、文件说明书、文件夹说明书、结构化日志、业务护栏和评估证据是否缺失或过期。
- 回归与就绪检查：实现完成后运行项目测试、`openprd standards --verify`、`openprd quality --verify`、`openprd run --verify` 和必要的 `doctor`。同时沉淀阶段性回归报告：前端任务优先记录界面验证策略，后端任务记录脚本或命令验证；最终输出结构化测试报告、HTML 回归报告和 HTML 质量评估报告。涉及消耗型成本时，还要确认额度绕过、并发请求、越权身份、成本监控、报警阈值和止损动作已覆盖。
- 复盘学习与经验沉淀：`openprd learn` 先生成证据清单、Agent 上下文和写作提示；标题、大纲、正文、检索练习和工作示例由 Agent 基于证据写入 `learning-content.json` 后再渲染到 `reader.html`。已验证修复、重复问题、高影响排障或 Agent 误判问题通过 `openprd quality --learn --from <report>` 抽象为 `.openprd/knowledge/skills/` 下的项目级经验 skill。

## 状态变化

- `run --context` 只产生建议上下文，不自动授权执行。
- 默认 hook 只保留轻量 PreToolUse 写入门禁，并把 matcher 收窄到直接编辑工具，不运行只读 shell 探查、PostToolUse 或 Stop 遥测；`guarded` 会额外覆盖 shell 工具，只有 `full` profile 才启用更重的全量工具级诊断。
- `loop --run`、`tasks --advance`、`discovery --advance`、`finish --commit` 只有在用户明确执行意图下才进入执行状态。
- 深度 discovery 的只读 subagent 输出只作为候选证据，最终状态更新仍由主 Agent 通过 OpenPrd claim、任务和验证流程落地。
- `clarify` 会产出 `clarify.html`，把本轮关键问题、发散方向和导回 payload 变成可打开确认的协作面。
- `synthesize` 会产出 `review.html`，把问题、范围、主流程、业务护栏、风险和开放问题压缩成 freeze 前的人机确认界面。
- `loop --finish` 会同时产出 Markdown 测试报告和 HTML 回归报告，用于复盘、交接和重复验证。
- `quality --verify` 会产出 `.openprd/quality/reports/<id>.json` 和 `.openprd/quality/reports/<id>.html`，HTML 质量评估报告是阶段性质量审查的主要产物，包含业务成本与滥用护栏 gate。
- `quality --learn` 会把已审查报告抽象为 incident、pattern 和项目经验 Skill，形成“问题修复 -> 验证 -> 沉淀 -> 下次触发”的项目级认知循环。
- `learn` 默认进入 `awaiting-agent-content` 状态，只提供 HTML 阅读器骨架和 Agent 写作工具包；传入 `--content-json` 后才进入 `agent-authored` 状态并展示正文。
- 新增或修改文件会触发文档影响判定：缺失文档进入补齐状态，已有但受影响的文档进入更新状态，无需更新时要说明理由。
- standards、validate 或 doctor 失败时，状态回到修复阶段，不应声明实现完成。

## 维护规则

- 每次用户流程、页面跳转、任务状态或异常处理发生变化后，必须检查并更新本文件。
