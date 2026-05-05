# 产品流程说明

## 核心流程

OpenPrd 的核心流程是：用户在项目中初始化或接入 `.openprd/` 工作区，Agent 先读取 `openprd run --context`、`status`、`next` 等只读状态，再根据用户当前意图决定是否推进实现、持续调研、变更任务或只读分析。实现阶段必须同步经过 standards 门禁，确认基础文档、文件说明书和文件夹说明书是否需要补齐或更新。

## 用户路径

- 初始化项目：用户运行 `openprd init` 或 `openprd setup`，生成 `.openprd/`、`docs/basic/`、AGENTS 和各端 agent guidance；Codex hook 默认使用 `lite`，只在明确 OpenPrd/深度流程提示词下注入上下文。
- 规划或分析：用户要求“看看、梳理、怎么改、预计动哪些文件”时，Agent 只读检查代码、文档和 OpenPrd 状态后输出证据化结论，不启动 loop 或推进任务。
- 实现或继续任务：用户明确要求开发、实现、继续、深度调研、深度对标或复刻落地时，Agent 才能运行 execution command，并在完成前检查 `docs/basic/`、文件说明书和文件夹说明书是否缺失或过期。
- 验证 readiness：实现完成后运行项目测试、`openprd standards --verify`、`openprd run --verify` 和必要的 `doctor`，再报告结果。

## 状态变化

- `run --context` 只产生 advisory context，不自动授权执行。
- 默认 hook 不再为每个工具调用运行 PreToolUse/PostToolUse；只有 `guarded` 或 `full` profile 才启用更重的 per-tool 门禁。
- `loop --run`、`tasks --advance`、`discovery --advance`、`finish --commit` 只有在用户明确执行意图下才进入执行状态。
- 新增或修改文件会触发文档影响判定：缺失文档进入补齐状态，已有但受影响的文档进入更新状态，无需更新时要说明理由。
- standards、validate 或 doctor 失败时，状态回到修复阶段，不应声明实现完成。

## 维护规则

- 每次用户流程、页面跳转、任务状态或异常处理发生变化后，必须检查并更新本文件。
