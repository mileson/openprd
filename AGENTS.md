# OpenPrd Agent Contract

This repository ships its own agent-facing skills under `/Users/mileson/Workspace/AI工作室/OpenPrd/skills/`.

If you are an agent working in this repository, prefer these repo-local skills over unrelated global heuristics.

## Skill Routing

### Always read first

- `/Users/mileson/Workspace/AI工作室/OpenPrd/skills/openprd-shared/SKILL.md`

Use it for shared guardrails:
- language-following output
- proper noun preservation
- read-only vs mutating command discipline
- freeze / handoff gate awareness
- workspace-first reasoning using `.openprd/`

### Main workflow

- `/Users/mileson/Workspace/AI工作室/OpenPrd/skills/openprd-harness/SKILL.md`

Use it when advancing the workspace through:
- `init`
- `classify`
- `interview`
- `synthesize`
- `diagram`
- `freeze`
- `handoff`

### Diagram and visual review

- `/Users/mileson/Workspace/AI工作室/OpenPrd/skills/openprd-diagram-review/SKILL.md`

Use it when the task needs:
- an architecture diagram
- a product flow diagram
- a user journey / flow confirmation artifact
- a visual review before freeze

### OpenPrd discovery mode

- `skills/openprd-discovery-loop/SKILL.md`

Use it when the task needs:
- deep completion of requirements, specs, and tasks for an existing project
- reference project behavior mining
- sustained requirement clarification and coverage tracking

Natural-language routing:
- If the user says OpenPrd or OpenSpec plus 持续 / 深度 / 全面 / 完整 / 穷尽 / 补全 / 复刻 / 对标 / 参考, route to `skills/openprd-discovery-loop/SKILL.md`.
- Do not require the user to mention a skill name.
- Choose the discovery mode internally from the user intent and available project/reference context.
- When tasks exceed 25 substantive checkbox items, shard them as `tasks.md`, `tasks-002.md`, `tasks-003.md`, etc. The final checkbox in each non-final file must hand off to the next file.
- For stable long-running tasks, use only `deps`, `done`, and `verify` metadata under ids like `T009.07`; keep source evidence in `.openprd/discovery` state files.
- Run `openprd discovery <path> --verify` after task sharding so the CLI can catch change-structure errors, oversized files, missing handoffs, task dependency gaps, and spec delta issues.
- Use `openprd change <path> --generate --change <id>` when a frozen or synthesized PRD needs to become concrete OpenPrd change files.
- Use `openprd tasks <path> --change <id>` to find the next dependency-ready task, then `openprd tasks <path> --change <id> --advance --verify --item <task-id>` to run its verify command and mark it complete.
- Use `openprd change <path> --apply --change <id>` to promote specs into the accepted baseline, then `openprd change <path> --archive --change <id>` to move completed work out of active changes.

### OpenPrd benchmark routing

- `skills/openprd-benchmark-router/SKILL.md`

Use it when the task needs:
- best practices / benchmark research
- reference product or reference repo design comparison
- OpenPrd product or PRD workflow optimization
- CLI, skill, command, adapter, hook, or generated guidance optimization
- Agent harness, long-running task, context engineering, or prompt engineering design

Natural-language routing:
- If the user asks for 最佳实践 / 对标 / benchmark / 参考 / 复刻 / prompt engineering / Agent harness / context engineering / CLI skill 体系, route to `skills/openprd-benchmark-router/SKILL.md` before forming the design conclusion.
- Public GitHub project architecture and cross-module design comparisons use DeepWiki first.
- Third-party library, API, SDK, MCP, CLI, or version-specific usage uses Context7 first.
- Official product docs and engineering blogs should be treated as primary sources; clearly separate verified facts from OpenPrd-specific inference.
- If benchmark work expands into sustained reference-project mining or requirements completion, hand off to `skills/openprd-discovery-loop/SKILL.md`.

### OpenPrd standards

- `skills/openprd-standards/SKILL.md`

Use it when the task needs:
- project baseline docs under `docs/basic/`
- file manual standards
- folder README standards
- standards verification before change readiness

Natural-language routing:
- If the user asks to establish, check, repair, or enforce project docs, file manuals, folder manuals, or standardization, route to `skills/openprd-standards/SKILL.md`.
- Use `openprd standards <path> --init` to create the standards contract.
- Use `openprd standards <path> --verify` before claiming implementation readiness when standards are in scope.
- The canonical project docs path is only `docs/basic/`.

### OpenPrd agent setup

Use setup/update/doctor when the task needs automatic agent guidance instead of asking users to invoke skills manually.

- `openprd init <path>` installs the default agent integration.
- `openprd setup <path>` installs or repairs OpenPrd guidance for Codex, Claude, and Cursor.
- `openprd update <path>` refreshes generated guidance files from the canonical OpenPrd source.
- `openprd doctor <path>` verifies generated rules, standards, workspace validation, and Codex hooks.
- `openprd run <path> --context` selects the next hook-stable execution unit.
- `openprd run <path> --verify` verifies the current run gates.
- `openprd fleet <root> --dry-run` audits historical projects before batch updates.
- `openprd fleet <root> --update-openprd` refreshes only projects that already contain `.openprd/`.
- Codex hooks are expected to be enabled through project `.codex/config.toml` and user Codex config with `codex_hooks = true`.
- `.openprd/harness/` stores the install manifest, hook state, hook event log, and drift report.
- Treat drift as a repairable gate: run `openprd update <path>`, then `openprd doctor <path>`.

## Tool Reality

The current CLI supports:

- `openprd clarify`
- `openprd capture`
- `openprd setup`
- `openprd update`
- `openprd doctor`
- `openprd run`
- `openprd diagram --type architecture`
- `openprd diagram --type product-flow`
- `openprd change`
- `openprd changes`
- `openprd specs`
- `openprd tasks`
- `openprd discovery`
- `openprd standards`

Do not invent commands or artifact types that are not implemented.

## Working Principles

1. Rebuild state from `.openprd/` before making workflow decisions.
2. Prefer `openprd status` and `openprd next` before mutating commands.
3. Ask the user for missing critical product facts before pushing the workspace forward; use `openprd clarify` to generate those questions and `openprd capture` to store the answers.
4. Prefer diagram review before freeze when the system or flow shape still needs confirmation.
5. Keep unresolved assumptions and open questions visible instead of silently resolving them.

<!-- OPENPRD:AGENTS:START -->
## OpenPrd Harness

本项目由 OpenPrd 管理。Agent 应优先遵循 harness，而不是零散的临时指令。

### 默认行为

1. 在规划或改文件前，先从 `.openprd/` 重建状态。
2. 选择下一个执行单元前先运行 `openprd run . --context`，但把它当作建议上下文，不要机械照执行。
3. 跟随任何建议前先判断当前用户意图。遇到规划、分析、架构评审、“怎么改”或“会动哪些文件”这类请求时，保持只读并基于证据回答。
4. 如果用户提出新的产品、模块或工作流需求，编码前先走需求入口：clarify、记录用户回答、synthesize/review、生成或检查 OpenPrd change、拆分任务，并等待用户明确确认。
5. 如果用户在确认后要求实现，且工作会影响产品或架构，就要先生成或检查 OpenPrd change，再开始编码。
6. 实现过程中，对每个新增或修改文件都做一次文档影响检查：缺少 `docs/basic/`、文件说明书或目录 README 就补齐；如果变更影响职责、流程、结构、依赖或产品行为，就同步更新现有文档。涉及后端、脚本、Agent、工具链、服务或数据处理变更时，还要把 CLI 与 API 视为同级接入面：同步检查命令入口、参数、输出契约、`help`、`doctor`、`dry-run`、`status` 与接口协议、返回结构、身份边界是否受影响，并更新 `docs/basic/backend-structure.md` 或明确写不适用原因。
7. 在宣称准备就绪前，运行 `openprd standards . --verify`、`openprd quality . --verify` 和 `openprd run . --verify`。
8. 把 `.openprd/harness/` 视为已安装的 agent 控制状态目录：其中包含 run state、iterations、events、hook state、install manifest 和 drift report。
9. Codex hooks 默认使用 lite 模式：`UserPromptSubmit` 加一个轻量 `PreToolUse` 写入门禁。只有项目明确需要完整遥测时，才使用 `--hook-profile full`。
10. 对任何带 `locale: zh-CN` 的 OpenPrd diagram contract，所有可见标签、节点文案、流程标签、卡片、面板和评审说明都必须使用简体中文。只保留必要的专有名词和技术字段名。
11. 当用户要求最佳实践、benchmark、对标、参考产品、prompt engineering、Agent harness、context engineering、CLI 或 skill 体系优化时，先使用项目生成的 `openprd-benchmark-router`，再按 DeepWiki、Context7 或官方资料规则调研。

### 标准命令

- `openprd next .` - 选择下一步 harness 动作。
- `openprd run . --context` - 选择下一个 hook-stable 执行单元。
- `openprd run . --verify` - 校验当前 run 门禁。
- `openprd quality . --verify` - 生成覆盖 observability、business guardrails、smoke、performance、极端场景和知识缺口的 HTML 质量评估报告。
- `openprd quality . --learn --from <report-id-or-json>` - 把已审阅或修复的问题沉淀成项目级经验 skill 知识。
- `openprd loop . --plan --change <id>` - 构建“一次会话只做一个任务”的 feature list。
- `openprd loop . --run --agent codex|claude --dry-run` - 准备一个全新的单任务 agent 会话。
- `openprd loop . --run --agent codex|claude` - 仅在用户明确要求开发、继续推进、深度调研 / benchmark 或复刻时执行。
- `openprd loop . --finish --item <task-id> --commit` - 完成校验、写入暂存测试报告、标记 done，并且只有当用户明确要求 commit 时才创建任务提交。
- `openprd standards . --verify` - 校验项目文档标准。
- `openprd change . --validate --change <id>` - 校验 change 结构。
- `openprd discovery . --verify` - verify long-running discovery state.
- `openprd doctor .` - check agent integration health.
- `openprd update .` - repair generated agent guidance drift.
- `openprd update . --hook-profile lite|guarded|full` - choose Codex hook weight; default `lite` keeps requirement-intake write gates without full telemetry.
- `openprd fleet <root> --dry-run` - audit historical projects before batch updates.

`openprd setup` and `openprd update` also enable Codex hooks in the user Codex config when run from the CLI.

### High-Risk Gate

Before freeze, handoff, accepted spec apply/archive, commit, push, release, or publish, ensure `openprd standards . --verify`, `openprd quality . --verify`, `openprd run . --verify`, and `openprd doctor .` are healthy.

The only baseline documentation path is `docs/basic/`.
<!-- OPENPRD:AGENTS:END -->
