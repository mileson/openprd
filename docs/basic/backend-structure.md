# 后端架构设计

## 适用范围

说明后端服务、接口、数据处理和外部依赖的项目级架构约定。

## 服务边界

- CLI 入口: `bin/openprd.js` 只负责调用 `src/openprd.js` 的 `main(argv)` 并设置退出码。
- CLI 分发: `src/openprd.js` 负责命令分发、workspace 初始化、freeze、handoff、change 生成和对外导出。
- 工作区核心: `src/workspace-core.js` 负责 workspace 骨架、迁移、校验、版本索引、事件日志和共享文档渲染。
- 工作流命令: `src/workspace-workflow.js` 负责 classify、interview、clarify、capture、synthesize、diff、history、next 和 status guidance，并在 clarify / synthesize 阶段生成 HTML 协作 artifact。
- 图表工作区: `src/diagram-workspace.js` 负责 diagram artifact 生成、评审状态读写和可选浏览器打开。
- HTML artifact: `src/html-artifacts.js` 负责 `clarify.html`、`review.html`、回归报告 HTML 等 human-in-the-loop 协作界面渲染。
- CLI 表层: `src/cli/args.js` 解析参数，`src/cli/print.js` 统一渲染终端输出。
- 文件基础设施: `src/fs-utils.js` 统一封装文本、JSON、YAML、JSONL 读写。
- 运行编排: `src/run-harness.js` 负责 `openprd run` 上下文、hook 记录和 verify 门禁。
- 质量评估: `src/quality.js` 负责 `.openprd/quality/config.json` 初始化、日志/链路追踪检测、业务成本与滥用护栏检测、评估执行环境检测、HTML 质量评估报告写入，以及 `.openprd/knowledge/` 经验 Skill 沉淀。
- Agent 集成: `src/agent-integration.js` 负责生成 AGENTS、skills、commands、Codex hooks、hook profile、Codex hooks feature flag 迁移和执行/文档门禁提示；大量只读扫描的 subagent 调度规则生成到 OpenPrd discovery skill，而不是写入 AGENTS 合同。
- 标准化: `src/standards.js` 负责 `docs/basic/`、文件说明书模板、文件夹说明书模板和 standards 校验。
- Loop 编排: `src/loop.js` 负责长任务拆分、单任务 prompt、session 记录、任务 verify 和 finish。
- 复盘学习: `src/learning-review.js` 负责收集证据、生成 Agent 写作工具包、校验 Agent 写入的 `learning-content.json`，并调用 HTML reader 渲染。
- 规模化操作: `src/fleet.js` 负责扫描历史项目并按依赖注入调用 setup/update/doctor。
- 持续调研: `src/discovery.js` 负责 discovery run、source inventory、coverage matrix、claims 和 discovery 验证。
- OpenSpec 文件域: `src/openspec/` 负责 change/spec/task 的读写、验证、应用和归档。

## CLI 接入面

- `openprd` 是当前项目面向用户和 agent 的主接入面；`bin/openprd.js` 提供进程入口，`src/cli/args.js` 负责参数与 flag 解析，`src/cli/print.js` 负责终端输出契约。
- `src/openprd.js` 把 `doctor`、`run --context`、`standards --verify`、`quality --verify`、`change`、`loop`、`discovery` 等命令暴露为一级 CLI 能力，而不是内部模块上的薄包装。
- 预演与诊断能力也属于 CLI 契约的一部分：当前通过 `loop --run --dry-run`、`fleet --dry-run`、`doctor`、`status`、`next` 等命令承接可发现性、风险预演和健康检查。
- 后端改动如果影响命令入口、参数、输出格式、退出码、`help`、`doctor`、`dry-run`、`status` 或命令组合方式，必须与内部实现一起评审并同步更新本文档。

## API 接入面

- 当前项目不提供对外 HTTP、RPC 或 WebSocket API；CLI 是主要稳定接入面。
- 内部模块之间通过 `src/openprd.js` 暴露的 workspace 函数和工厂依赖注入协作，但这些内部调用链不默认承诺为公共 API。
- 如果未来引入 HTTP 服务、daemon、MCP gateway 或 SDK 适配层，需要把它与现有 CLI 并列记录：明确协议、身份边界、返回结构、兼容范围，以及与 CLI 之间的职责分工。

## 数据流

- 用户命令进入 `main(argv)`，由 `src/cli/args.js` 解析 flags 和 positionals。
- `main` 根据命令分发到 workspace workflow、diagram、standards、quality、loop、openspec、discovery、fleet 或 run 模块。
- 工作区状态主要读写 `.openprd/` 下的 config、templates、state、engagements、exports 和 harness 文件。JSON/Markdown 继续作为事实源和归档层，HTML artifact 作为主要确认与评审界面。
- 模块返回结构化 result，`src/cli/print.js` 再根据 `--json` 决定输出 JSON 或用户可读文本。
- `run-harness`、`fleet`、`discovery` 通过工厂依赖注入调用核心工作区能力，避免从子模块反向导入 `src/openprd.js`。
- `agent-integration` 将 canonical skills 和 AGENTS 合同渲染到各端 adapter；这些生成物必须包含意图门禁、轻量 hook profile、HTML 协作优先的确认规则和文档影响判定规则，并把大量只读扫描调度保留在 discovery skill 中。
- `openspec/generate` 生成的 `spec.md` 使用中文结构字段，并在 change tasks 中加入 `docs/basic`、业务护栏验证与说明书维护任务；`standards` 在 verify 阶段检查基础契约是否存在并满足结构要求。
- `loop` 在 finish 阶段同时沉淀 Markdown 测试报告与 HTML 回归报告，供后续复盘、交接和重复执行使用。
- `quality` 在 verify 阶段扫描项目代码、包脚本、OpenPrd 任务状态和知识库状态，识别消耗型成本风险及其额度、滥用、监控、报警和止损证据，生成 JSON 与 HTML 质量评估报告；在 learn 阶段把报告沉淀为 incident、pattern 和经验 Skill。
- `learning-review` 在未收到 Agent 内容时只写入 `agent-context.json`、`agent-prompt.md`、空内容合同和 reader 骨架；收到 `--content-json` 后校验内容结构与证据引用，再生成最终阅读器。

## 维护规则

- 每次服务边界、CLI/API 接入契约、数据流、存储或外部依赖发生变化后，必须检查并更新本文件。
