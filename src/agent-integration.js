import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { renderApprovedBenchmarkRegistrySection } from './benchmark.js';
import { timestamp } from './time.js';

const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OPENPRD_AGENT_TOOLS = ['codex', 'claude', 'cursor'];
const OPENPRD_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];
const OPENPRD_HOOK_PROFILES = {
  lite: ['UserPromptSubmit', 'PreToolUse'],
  guarded: ['UserPromptSubmit', 'PreToolUse'],
  full: OPENPRD_EVENTS,
};
const OPENPRD_DEFAULT_HOOK_PROFILE = 'lite';
const OPENPRD_HOOK_EVENTS_WITH_MATCHER = new Set(['PreToolUse', 'PostToolUse']);
const OPENPRD_LITE_WRITE_TOOL_MATCHER = '^(apply_patch|Write|Edit)$';
const OPENPRD_GUARDED_WRITE_TOOL_MATCHER = '^(Bash|apply_patch|Write|Edit)$';
const OPENPRD_HARNESS_DIR = cjoin('.openprd', 'harness');
const OPENPRD_HARNESS_EVENTS = cjoin(OPENPRD_HARNESS_DIR, 'events.jsonl');
const OPENPRD_HARNESS_HOOK_STATE = cjoin(OPENPRD_HARNESS_DIR, 'hook-state.json');
const OPENPRD_HARNESS_MANIFEST = cjoin(OPENPRD_HARNESS_DIR, 'install-manifest.json');
const OPENPRD_HARNESS_DRIFT = cjoin(OPENPRD_HARNESS_DIR, 'drift-report.json');
const LEGACY_CODEX_HOOK_OUTPUT_FIELDS = ['should_stop', 'additional_contexts', 'should_block', 'block_reason'];

const CANONICAL_SKILLS = [
  {
    id: 'openprd-shared',
    description: 'OpenPrd 工作区、语言规则、门禁和 workspace-first 推理的共用守则。',
    body: [
      '# OpenPrd Shared',
      '',
      '这份规则集适用于所有 OpenPrd 工作。',
      '',
      '## 优先读取',
      '',
      '- `.openprd/state/current.json`',
      '- `.openprd/state/task-graph.json`',
      '- `.openprd/harness/install-manifest.json`',
      '- `.openprd/harness/hook-state.json`',
      '- `docs/basic/`',
      '',
      '## 运行规则',
      '',
      '- 动手前先从 `.openprd/` 重建上下文。',
      '- 选择写入命令前，优先运行 `openprd status .` 和 `openprd next .`。',
      '- 用户可见文档、进度日志、proposal、prompt 和报告默认使用简体中文；只保留必要专有名词、命令名、路径、字段名和 API 术语。',
      '- 当 `locale` 为 `zh-CN` 时，diagram contract 中所有可见字段都必须使用简体中文。',
      '- 面向用户的时间统一使用上海时区 `YYYY-MM-DD HH:mm:ss` 格式，不带 `T`、`Z` 或毫秒。',
      '- 保持未解决假设可见，不要悄悄补脑。',
      '- 项目基线文档路径只能是 `docs/basic/`。',
      '- 声称就绪前，至少通过 `openprd validate .` 和 `openprd standards . --verify`。',
      '- 实现就绪还要运行 `openprd quality . --verify`，并审阅 HTML 质量评估报告中的可观测性、业务护栏、评估执行环境、性能和知识缺口。',
      '- 看到生成文件疑似过期时，先运行 `openprd doctor .`。',
      '- `openprd run . --context` 只是建议。规划、分析、review、影响范围说明等请求保持只读，除非当前用户消息明确要求开发、实现、继续任务、深度调研、对标复刻或 commit/push。',
      '- 只要实现新增或修改文件，就做文档影响检查；缺失的 `docs/basic/`、文件说明书和文件夹 README 要补齐，已有文档受影响时要更新。',
      '- 涉及后端、脚本、Agent、工具链、服务或数据处理变更时，把 CLI 与 API 视为同级接入面：检查命令入口、参数、输出契约、`help`、`doctor`、`dry-run`、`status` 与接口协议、返回结构、身份边界是否受影响，并同步更新 `docs/basic/backend-structure.md`；若某一面不适用也要明确写原因。',
      '- Codex hooks 默认使用 `lite`：`UserPromptSubmit` 加轻量 `PreToolUse` 写入门禁。只有高风险流程才需要完整遥测。',
      '- 新产品、模块、流程需求在改代码前必须先完成需求入口：clarify、评审、任务拆解和用户明确确认。',
      '- 涉及最佳实践、benchmark、对标、参考产品、prompt engineering、Agent harness、context engineering、CLI 或 skill 体系设计时，先使用 `$openprd-benchmark-router` 选择证据源，再进入 Context7、DeepWiki 或官方资料调研。',
      '',
      '## 写入纪律',
      '',
      '- 只读命令优先：`status`、`next`、`validate`、`standards --verify`、`doctor`。',
      '- 下一道门禁没看清之前，不要贸然执行写入命令。',
      '- 面对规划、分析、审查类请求，不要运行 `openprd loop --run`、`openprd tasks --advance`、`openprd discovery --advance`、`openprd loop --finish --commit`、git commit 或 git push。',
      '- 代码改动完成后，要说明 `docs/basic/`、文件说明书和文件夹 README 是新增、更新还是有意不变。',
      '- `freeze`、`handoff`、`change --apply`、`change --archive`、commit、push、release、publish 等高风险动作都要求前置门禁全绿。',
      '',
      '## 修复路径',
      '',
      '1. 运行 `openprd doctor .`。',
      '2. 如果生成引导或 hooks 漂移，运行 `openprd update .`。',
      '3. 运行 `openprd standards . --verify` 并修复文档标准。',
      '4. 运行 `openprd quality . --verify` 并审阅 HTML 质量评估报告。',
      '5. 报告就绪前运行 `openprd validate .`。',
      '',
    ].join('\n'),
  },
  {
    id: 'openprd-benchmark-router',
    description: '为 OpenPrd 产品、CLI、Agent harness、上下文工程和提示词优化选择对标来源与调研路径。',
    body: [
      '# OpenPrd Benchmark Router',
      '',
      '当用户要求最佳实践、benchmark、对标、参考设计、产品优化、CLI 优化、Agent harness 优化、上下文工程或提示词工程时，先使用这份 skill。',
      '',
      '## 核心原则',
      '',
      '- 不把对标当成固定关键词匹配。结合用户目标判断参考源是否真的能提升设计、实现、排查、评审、规划或文档质量。',
      '- 不强行对标。环境、权限、账号、普通脚本报错、一次性短问答或与产品/领域设计无关的问题，继续当前任务即可。',
      '- 不默认下载全文、仓库或整站。先保留轻量链接、来源 ID 和适用边界；真正需要事实时再读取。',
      '- 通常只选 1-3 个最相关来源；不要为了显得全面而扩大上下文。',
      '- 不把索引、来源目录或记忆当事实来源；未经核验的外部内容不能作为已确认事实输出。',
      '',
      '## 触发信号',
      '',
      '- 用户提到 OpenPrd、OpenSpec、Superpowers、Anthropic Skills、Lark CLI、Agent harness、long-running agents、context engineering、prompt engineering、最佳实践、对标、参考、复刻或优化设计。',
      '- 用户要求解释某个 Codex / Claude / Cursor agent 为什么没有发现 skill，或希望提升 skill 自动识别、路由、生成、安装和持续执行能力。',
      '- 用户没有显式说 skill 名也要触发；不要要求用户记住 `$openprd-benchmark-router`。',
      '',
      '## 路由流程',
      '',
      '1. 先识别优化对象：OpenPrd 产品/PRD 流程、CLI、skill 体系、长程任务、通用 harness、context engineering、prompt engineering。',
      '2. 读取当前工作区证据：`.openprd/`、`.openprd/benchmarks/index.md`、`.openprd/benchmarks/sources.yaml`、`AGENTS.md`、repo-local skills、生成的 `.codex/.claude/.cursor` 引导和相关源码。',
      '3. 选择最小足够的外部证据源：公开 GitHub 仓库走 DeepWiki；第三方工具、SDK、CLI 或官方 API 用 Context7；产品官方文档、工程博客和一手资料用官方来源。',
      '4. 形成 OpenPrd 设计判断时，明确区分已证实事实、从来源归纳出的设计原则，以及对本项目的推断。',
      '5. 用分析维度提炼可迁移原则，避免照搬表面功能。',
      '6. 如果任务变成大量参考项目行为挖掘、长时间覆盖或需求补全，再路由到 `$openprd-discovery-loop` 承接持续调研。',
      '',
      '## Project Registry',
      '',
      '- 项目自己的 `.openprd/benchmarks/` 优先于 OpenPrd 内置 Source Map。',
      '- `sources.yaml` 里的 approved source 是长期可复用参考；`inbox/` 里的 candidate 只表示待确认线索。',
      '- 用 `openprd benchmark add <url|repo|file>` 写入 candidate，用 `openprd benchmark approve <id>` 纳入 approved registry。',
      '- 用 `openprd benchmark verify` 检查重复来源、失效链接、缺失本地文件和过宽触发规则。',
      '',
      '## Source Policy',
      '',
      '- GitHub 仓库：需要理解架构、核心模块、关键流程或对标结论时，先用 DeepWiki 的结构读取和聚焦问答；DeepWiki 不可用或覆盖不足时，再回退到 GitHub README、源码和官方文档。',
      '- 官方技术文档：涉及第三方库、框架、API、SDK、MCP、CLI 工具的用法、配置、限制、版本差异或迁移路径时，先用 Context7；Context7 不足时说明缺口，再补官方文档、源码或其他一手资料。',
      '- 工程文章和产品文档：优先读取当前线上一手页面，只抽取和当前任务相关的观点与设计原则，不复制长文；如果内容可能过时，要说明时效风险。',
      '- 本地源码优先：当前工作区已经有相关源码时，常规修 bug、查实现、改功能优先读本地代码；DeepWiki 主要用于外部仓库架构理解和对标分析。',
      '- 停止调研：找到足以支持当前决策的 1-3 个高相关来源后停止扩展；候选来源重复时保留更权威、更新或更贴近当前任务的来源。',
      '',
      '## Source Map',
      '',
      '- OpenPrd / PRD 设计对标：`obra/superpowers`、`Fission-AI/OpenSpec`。',
      '- CLI 与 skill 体系对标：`larksuite/cli`、`anthropics/skills`、Claude Skills 官方文档、Claude Code Skills 官方文档。',
      '- 长程 Agent 任务：Anthropic long-running agents harness 工程文章。',
      '- 通用 harness：OpenAI harness engineering、LangChain agent harness anatomy。',
      '- Context engineering：Manus context engineering、Anthropic context engineering。',
      '- Prompt engineering：OpenAI prompt engineering / prompt guidance、Claude prompt engineering、Gemini prompting strategies。',
      '',
      '## Evaluation Lenses',
      '',
      '- 产品与工作流：用户从哪里开始、如何知道下一步、模糊输入如何变成结构化产物、哪些步骤要保存/展示/恢复、哪些步骤必须保留用户确认。',
      '- Agent 与 Harness：目标、边界、停止条件、工具选择、进度记录、证据、验证结果、失败恢复和人工接管点是否清楚。',
      '- 上下文工程：哪些信息常驻、哪些按需检索，是否使用稳定路径、链接和来源 ID 支持 just-in-time 检索，如何处理过期、冲突和可信度。',
      '- 提示词与 Skill 设计：触发描述是否具体但不过度强制，主说明是否短，细节是否按需放到 reference，是否明确不要硬套参考源。',
      '- CLI 与开发者体验：命令是否可发现、可组合、可预测；错误信息是否说明发生了什么、影响是什么、下一步怎么做；危险操作是否有确认。',
      '',
      '## 设计输出',
      '',
      '- 给出 OpenPrd 应该内置什么、生成什么、路由什么、保留什么门禁。',
      '- 优先把结论落到 `CANONICAL_SKILLS`、repo-local skills、AGENTS/CLAUDE/Cursor 生成规则、hooks 或测试，而不是停留在口头建议。',
      '- 不把外部项目整包复制进 OpenPrd；只吸收可验证的路由、生成、门禁、状态承接和用户体验原则。',
      '- 需要显式说明时，简短写出参考了哪个来源、借鉴点、适用原因、不照搬边界，以及落到当前任务的具体决策。',
      '',
      '## Stop Rule',
      '',
      '- 同一来源默认只做一次结构理解和一到两次聚焦问题；证据足够支撑当前决策后立即停止调研。',
      '- 如果 DeepWiki、Context7 或官方资料覆盖不足，明确说明缺口，再把后续结论标为推断。',
      '',
    ].join('\n'),
  },
  {
    id: 'openprd-harness',
    description: '驱动 OpenPrd 工作区完成 clarify、synthesize、diagram、freeze、handoff、change、tasks 和验证。',
    body: [
      '# OpenPrd Harness',
      '',
      '当用户要求产品规划、需求细化、实现准备或执行就绪时，使用这份 skill。',
      '',
      '## 默认流程',
      '',
      '1. 先运行 `openprd run . --context`，获取 hook-stable 执行视图。',
      '2. 先判断当前用户意图，再决定是否跟随建议。',
      '3. 面对规划、分析、架构评审、“怎么改”或“会动哪些文件”类请求，保持只读并基于代码、文档和状态回答。',
      '4. 需要完整工作流细节时，运行 `openprd status .` 和 `openprd next .`。',
      '5. 涉及最佳实践、benchmark、对标、参考产品、prompt engineering、Agent harness、context engineering、CLI 或 skill 体系设计时，先使用 `$openprd-benchmark-router`。',
      '6. 新产品、模块、流程需求在改代码前必须先走需求入口：clarify、capture、synthesize/review、生成或检查 change、拆任务，并等待用户明确确认。',
      '7. 事实缺失时，用 `openprd clarify .` 和 `openprd capture .` 补全。',
      '8. 当 PRD 需要进入实现准备时，再运行 `openprd change . --generate --change <id>`。',
      '9. 长程实现使用 `openprd loop . --plan --change <id>`，并且只有用户明确要求开发、继续任务、深度调研、对标复刻或 commit 时才执行单任务 fresh session。',
      '10. 实现过程中，每次新增或修改文件都做文档影响检查，补齐缺失的 `docs/basic/`、文件说明书和文件夹 README，并更新受影响文档；涉及后端、脚本、Agent、工具链、服务或数据处理变更时，把 CLI 与 API 视为同级接入面：同步检查命令入口、参数、输出契约、`help`、`doctor`、`dry-run`、`status` 与接口协议、返回结构、身份边界是否受影响，并更新 `docs/basic/backend-structure.md` 或明确写不适用原因。',
      '11. 声称就绪前，运行 `openprd standards . --verify` 和 `openprd run . --verify`。',
      '12. 阶段性代码完成后，运行 `openprd quality . --verify`，把 HTML 质量评估报告当作日志、业务成本与滥用护栏、冒烟覆盖、性能、极端场景和项目知识的评审产物。',
      '',
      '## 门禁协议',
      '',
      '- 不要跳过 `openprd run . --context`；它是最适合 hooks 的控制面。',
      '- 不要把 `run --context` 里的建议当成直接用户命令。',
      '- 面对“看看、规划、梳理、分析、评估、怎么改、预计动哪些文件、review、explain”等只读意图，不运行 OpenPrd 写入命令。',
      '- 现有项目需求仍模糊时，优先 discovery，再考虑 synthesize。',
      '- freeze 或 handoff 前，运行 `openprd run . --verify` 并确认 review blocker 已关闭。',
      '- 声称实现就绪前，审阅最新 `.openprd/quality/reports/*.html` HTML 质量评估报告。',
      '- accepted spec 推进前，先运行 `openprd change . --validate --change <id>`。',
      '',
      '## hook 驱动循环',
      '',
      '- 把 `.openprd/harness/run-state.json` 和 `iterations.jsonl` 当成持久循环状态。',
      '- 默认 lite hooks 不记录每一轮细节，但会在明确 OpenPrd / 深度工作提示词和产品、模块、流程需求下注入上下文，并用轻量写入门禁阻断过早改代码。',
      '- 只有项目确实需要完整遥测时才使用 `--hook-profile full`。',
      '- 上下文注入后，hooks 会从 OpenPrd 状态里推荐下一项 task、discovery 或 workflow 动作。',
      '- 门禁失败时，任务或覆盖项保持未完成状态，让下一轮继续重试。',
      '- 可以把跨任务可复用经验记录到 `.openprd/harness/learnings.md`、本地 `AGENTS.md` 或 `docs/basic/`。',
      '',
      '## 长程实现循环',
      '',
      '- 运行 `openprd loop . --init`，再运行 `openprd loop . --plan --change <id>` 生成 `.openprd/harness/feature-list.json`。',
      '- 用 `openprd loop . --next` 找到下一个依赖已满足的任务。',
      '- 用 `openprd loop . --run --agent codex --dry-run` 或 `openprd loop . --run --agent claude --dry-run` 生成单任务 prompt 和启动命令。',
      '- 只有当前用户消息明确要求执行开发、继续任务或深度调研时，才运行 `openprd loop . --run`。单纯的规划问题不构成执行授权。',
      '- 每个 loop 任务对应一个全新 agent 会话边界，不要在同一会话里继续下一项任务。',
      '- 只有在任务 verify 命令和 `openprd run . --verify` 通过后，且用户明确要求 commit 时，才用 `openprd loop . --finish --item <task-id> --commit` 收尾。',
      '- 前端界面任务里，Codex desktop 优先用 Computer Use；Codex CLI 和 Claude Code 优先用 Playwright、MCP 浏览器自动化或项目现有 e2e 工具。',
      '- `openprd loop . --finish` 会写入 `.openprd/harness/test-reports/<task-id>.md`；把这份结构化测试报告和任务改动一起提交。',
      '- 让 `.openprd/harness/feature-list.json`、`progress.md`、`agent-sessions.jsonl`、`loop-state.json`、`loop-prompts/` 和 `test-reports/` 成为持久状态。',
      '',
      '## 失败处理',
      '',
      '- 命令失败后不要凭直觉继续。',
      '- 重新运行 `openprd run . --context`、`openprd doctor .`，并按输出里的修复命令处理。',
      '- 如果失败假设影响产品范围，把它保留在 `.openprd/engagements/active/open-questions.md`。',
      '',
      '## 历史项目',
      '',
      '- 批量处理旧项目之前，先用 `openprd fleet <root> --dry-run` 审计。',
      '- 用 `openprd fleet <root> --update-openprd` 只刷新已经包含 `.openprd/` 的项目。',
      '- 除非用户明确要求 OpenPrd 接管 agent-only 或 plain 项目，否则不要使用 `--setup-missing`。',
      '',
    ].join('\n'),
  },
  {
    id: 'openprd-standards',
    description: '初始化并校验 `docs/basic`、文件说明书和文件夹 README 标准。',
    body: [
      '# OpenPrd Standards',
      '',
      '当文档、文件说明书、文件夹 README 或实现就绪检查在范围内时，使用这份 skill。',
      '',
      '## 必需文档',
      '',
      '- `docs/basic/file-structure.md`',
      '- `docs/basic/app-flow.md`',
      '- `docs/basic/prd.md`',
      '- `docs/basic/frontend-guidelines.md`',
      '- `docs/basic/backend-structure.md`',
      '- `docs/basic/tech-stack.md`',
      '',
      '报告实现就绪前，先运行 `openprd standards . --verify`。',
      '对包含源码文件的项目，这个门禁还要求 `docs/basic/` 内容具体可用、文件头说明书存在，以及 `[project]_[folder]_README.md` 文件夹说明完整；如果涉及后端实现，`docs/basic/backend-structure.md` 还必须显式覆盖 CLI 接入面和 API 接入面，或写明不适用原因。',
      '',
      '## 文档影响检查',
      '',
      '- 编辑前先识别本次会变化的文件、文件夹、用户流程、架构边界、依赖和产品行为。',
      '- 新增源码文件：如果缺少文件说明书就补上，并确认所在文件夹 README 已存在。',
      '- 修改源码文件：若已有文件说明书，先读取；当文件职责、输入、输出、依赖或维护规则变化时更新它。',
      '- 文件夹内容新增、移动、删除或改作他用：新增或更新文件夹 README，使其反映当前职责和文件布局。',
      '- 功能、流程、架构、依赖或产品行为变化：即使文件已存在，也更新对应的 `docs/basic/` 文档。',
      '- 后端、脚本、Agent、工具链、服务或数据处理变化：把 CLI 与 API 视为同级接入面，更新 `docs/basic/backend-structure.md` 中的命令入口、输出契约、`help`/`doctor`/`dry-run`/`status`、接口协议和不适用说明。',
      '- 若必需文档或说明书缺失，或仍停留在模板态，就绪前必须补齐。',
      '- 如果最终不需要改文档，也要说明文档影响检查已完成，以及为什么可以保持不变。',
      '',
      '## 同步触发条件',
      '',
      '- 文件或文件夹新增、移动、删除：更新 `docs/basic/file-structure.md` 和相关文件夹 README。',
      '- 产品流程、状态、路由或任务行为变化：更新 `docs/basic/app-flow.md`。',
      '- 用户可见能力或验收标准变化：更新 `docs/basic/prd.md`。',
      '- 框架、依赖、运行时或构建命令变化：更新 `docs/basic/tech-stack.md`。',
      '- 前端或后端结构变化：更新对应的 `docs/basic/` 指南；后端变化时同时评估 CLI 与 API 两个接入面。',
      '',
      '## 门禁',
      '',
      '`openprd standards . --verify` 必须在 freeze、handoff、accepted spec apply/archive、commit、push、release 和 publish 之前通过。',
      '',
    ].join('\n'),
  },
  {
    id: 'openprd-discovery-loop',
    description: '面向现有项目、参考项目和模糊需求的持续 OpenPrd discovery。',
    body: [
      '# OpenPrd Discovery Loop',
      '',
      '当用户要求继续、深挖、补全、对比、复刻、全面梳理 requirements，或进行大量只读扫描时，使用这份 skill。',
      '',
      '## 大量只读扫描调度',
      '',
      '- 日常任务仍由主 agent 先直接读取本地上下文；不要因为用户只说“看看、分析、梳理、定位、排查”就自动并行。',
      '- 用户明确要求深度分析、深入调研、全面梳理、多角度评估、交叉验证、并行排查、对标复刻或风险审查时，优先考虑只读 subagent。',
      '- 任务需要同时阅读多个目录、文档、模块、日志、历史实现或参考项目，且并行收集证据能明显减少主上下文污染或节省时间时，可以启动。',
      '- 任务涉及外部技术事实、公开仓库对标、复杂排障、发布风险或安全风险，且需要独立复核时，可以启动；仍必须遵守 Context7、DeepWiki、secrets-vault 和长文件门禁。',
      '- 用户明确说“不用 subagent / 直接做 / 先别并行 / 只回答”时，不启动。',
      '- 单文件小改、明确文案微调、简单命令、非常短的问题或清晰 bug 修复，默认不启动。',
      '- 一旦进入深度研究型 subagent 流程，默认使用 3 个只读 subagent：2 个独立调研执行者 + 1 个审查/交叉验证者。',
      '- 最多启动 5 个 subagent：最多 4 个调研执行者 + 1 个审查者。只有任务天然拆成 4 个互不冲突的研究分支时才扩到 5 个。',
      '- 代码与文档调研优先使用 `spark-code-researcher`、`spark-doc-reader` 或 `documentation-explore`；对标复刻用 `electron-parity-mapper`；安装发布或渠道排障用 `release-diagnostics-researcher`、`channel-debug-researcher`；审查与风险扫描用 `skill-workflow-reviewer`、`security-risk-researcher`。',
      '- 每个 subagent 只回答一个清晰问题，不再继续 spawn；主 agent 负责决策、整合和所有写入，subagent 只做只读调研、归纳和交叉验证。',
      '- subagent 输出必须回到主 agent 汇总；写入 discovery claim、requirements、specs 或 tasks 前，主 agent 必须把结论映射到证据路径、置信度和未解决问题。',
      '',
      '## 循环',
      '',
      '- 用 `openprd discovery . --mode <brownfield|reference|requirement>` 启动或恢复。',
      '- 每次只推进一个有证据支撑的覆盖项。',
      '- 报告运行健康前，用 `openprd discovery . --verify` 做校验。',
      '- 通过 `openprd standards . --verify` 保持基线文档标准同步。',
      '- 阶段性实现或任务完成后，用 `openprd quality . --verify` 审查 HTML 质量评估报告里的日志、业务护栏、冒烟覆盖、性能和知识缺口。',
      '',
      '## 深度规则',
      '',
      '- 每个 claim 都要带来源、证据路径和置信度。',
      '- 推断出的行为不能直接变成 accepted requirement，必须保持可评审。',
      '- 大型任务文件必须分片并通过校验。',
      '- 只有在覆盖耗尽、被阻塞，或明确交接后才停止。',
      '',
    ].join('\n'),
  },
  {
    id: 'openprd-learning-review',
    description: '为 OpenPrd 工作区生成归档学习包、题材模板、证据清单和 HTML 电子书阅读器。',
    body: [
      '# OpenPrd Learning Review',
      '',
      '当用户希望生成复盘学习包、题材模板库、证据清单、检索模块、工作示例或 OpenPrd 工作区里的 HTML 电子书阅读器时，使用这份 skill。',
      '',
      '## 产出物',
      '',
      '- `learning-content.json`：版本化内容契约',
      '- `evidence-manifest.json`：source id、digest、摘录、claim 和缺口',
      '- `learning-content.md`：书籍式阅读稿',
      '- `reader.html`：固定电子书阅读器界面',
      '- `learning-package.json` 和 `.openprd/learning/index.json`：归档元数据',
      '',
      '## 工作流程',
      '',
      '1. 从 `.openprd/` 重建状态，并识别触发源是 loop finish 还是手动请求。',
      '2. 从参考库里选择题材。主题没有特殊要求时，默认使用 `internet-product`。',
      '3. 写正文前先从工作区状态、`docs/basic` 和 loop 报告收集证据。',
      '4. 分离证据清单、叙事正文和渲染器；所有判断都必须能引用 source id。',
      '5. 尽可能在每章加入检索模块和工作示例模块。',
      '6. 把学习包归档到 `.openprd/learning/archive/<packageId>/`，并在合适时打开 `reader.html`。',
      '',
      '## 扩展规则',
      '',
      '- 新增题材时扩展参考库，不要分叉渲染器。',
      '- 契约必须版本化；`openprd.learning-content.v1` 的演进要通过新版本完成。',
      '- 任何无法追溯到来源的句子都要显式标为推断。',
      '- 把阅读器保持为稳定的 HTML 电子书界面，包含 TOC、进度、上一章/下一章控制和证据侧栏。',
      '',
      '## 参考资料',
      '',
      '- `skills/openprd-learning-review/references/genre-library.md`',
      '- `skills/openprd-learning-review/references/content-contract.md`',
      '- `skills/openprd-learning-review/references/evidence-manifest.md`',
      '- `skills/openprd-learning-review/references/ebook-reader.md`',
      '- `skills/openprd-learning-review/references/retrieval-worked-example.md`',
      '- `skills/openprd-learning-review/references/quality-rubric.md`',
      '',
    ].join('\n'),
  },
  {
    id: 'openprd-quality',
    description: '评估可观测性、业务成本与滥用护栏、评估执行环境覆盖、性能基线、极端场景，以及 HTML 质量评估报告和项目知识 Skill。',
    body: [
      '# OpenPrd Quality',
      '',
      '当实现就绪、日志、链路追踪、免费额度、业务成本、滥用防护、评估执行环境、冒烟测试、性能基线、压力数据或项目级经验 Skill 在范围内时，使用这份 skill。',
      '',
      '## 命令',
      '',
      '- `openprd quality . --init`：初始化 `.openprd/quality/config.json` 和 `.openprd/knowledge/`',
      '- `openprd quality . --verify`：在 `.openprd/quality/reports/` 下生成 JSON 和 HTML 质量评估报告',
      '- `openprd quality . --learn --from <report-id-or-json>`：把已修复或已审查的质量问题沉淀为项目级经验 Skill',
      '',
      '## 审查契约',
      '',
      '- 可观测性：确认中心化 logs / traces / errors、共享 trace/request/task/error id、脱敏、保留期和查询示例。',
      '- 业务护栏：涉及免费用户、额度、AI 调用、第三方 API、生成、存储或下载时，确认成本来源、用户级限制、负向验证、监控、报警和止损动作。',
      '- 评估执行环境：确认冒烟测试、任务到功能覆盖、正常性能基线和极端数据压力场景。',
      '- HTML 报告：把 `.openprd/quality/reports/*.html` 当成面向人的评审产物，而不是次级导出。',
      '- 知识沉淀：当某个已验证修复具备重复性、高影响、隐藏性或由 agent 误判引发时，把模式抽象到 `.openprd/knowledge/skills/<skill>/SKILL.md`。',
      '',
      '## 收紧规则',
      '',
      'Agent 创建的性能基线从合理的行业平均默认值开始。用户可以放宽或收紧，但 Agent 的自更新只能收紧阈值。',
      '',
    ].join('\n'),
  },
  {
    id: 'openprd-diagram-review',
    description: '在 freeze 前生成并评审 OpenPrd 架构图和产品流程图。',
    body: [
      '# OpenPrd Diagram Review',
      '',
      '当需要架构、产品流程、用户旅程或可视化确认时，使用这份 skill。',
      '',
      '- 用 `openprd diagram . --type architecture` 生成架构图。',
      '- 用 `openprd diagram . --type product-flow` 生成产品流程图。',
      '- 只有在用户审阅完产物后，才使用 `--mark confirmed`。',
      '',
      '## 契约语言',
      '',
      '- Diagram contract 面向用户。当 `locale` 为 `zh-CN` 时，所有可见文本都要写成简体中文。',
      '- 这包括 `title`、`subtitle`、`components[].name`、`components[].subtitle`、`components[].details`、`flows[].label`、`summaryCards[].title`、`summaryCards[].items`、`sidePanels[].title`、`sidePanels[].items` 和 `reviewInstructions`。',
      '- MotiClaw、Electron、TypeScript、CLI、API、JSON、NDJSON、dry-run、Host API、schema、`waiting_approval` 这类必要术语可以保留，但周围句子必须是简体中文。',
      '- 不要在 zh-CN diagram contract 中保留完整英文句子；运行 `openprd diagram --input` 前先把英文偏重文本改成简体中文。',
      '',
      '## 评审门禁',
      '',
      '- 出图不等于确认。',
      '- 确认必须来自用户或项目 owner 对结构的接受。',
      '- 如果图示影响实现，同步更新 `docs/basic/app-flow.md`、`docs/basic/backend-structure.md` 或 `docs/basic/frontend-guidelines.md`。',
      '',
    ].join('\n'),
  },
];

const CANONICAL_COMMANDS = [
  {
    id: 'next',
    title: 'OpenPrd Next',
    body: [
      'Run `openprd status .` and `openprd next .`, summarize the current gate, then execute the suggested OpenPrd action when safe.',
    ].join('\n'),
  },
  {
    id: 'standards',
    title: 'OpenPrd Standards',
    body: [
      'Run `openprd standards . --verify`. If it fails, repair `docs/basic/`, file manual templates, or folder README templates before continuing.',
    ].join('\n'),
  },
  {
    id: 'change',
    title: 'OpenPrd Change',
    body: [
      'Generate or inspect an OpenPrd change. Prefer `openprd change . --generate --change <id>`, then `openprd change . --validate --change <id>`.',
    ].join('\n'),
  },
  {
    id: 'discovery',
    title: 'OpenPrd Discovery',
    body: [
      'Start or resume OpenPrd discovery. Use `openprd discovery . --resume` when a run exists; otherwise choose the mode from context.',
    ].join('\n'),
  },
  {
    id: 'doctor',
    title: 'OpenPrd Doctor',
    body: [
      'Run `openprd doctor .` and repair missing AGENTS, skills, commands, hooks, standards, or validation gates.',
    ].join('\n'),
  },
  {
    id: 'verify',
    title: 'OpenPrd Verify',
    body: [
      'Run `openprd run . --verify`. It verifies standards, workspace validation, active change structure, and active discovery state before reporting readiness.',
    ].join('\n'),
  },
  {
    id: 'run',
    title: 'OpenPrd Run',
    body: [
      'Use the hook-stable OpenPrd execution loop. Start with `openprd run . --context`, execute the recommended task/discovery/workflow action, then run `openprd run . --verify` before claiming completion.',
      '',
      'Intent gate: `openprd run . --context` is advisory. Execute mutating recommendations only when the current user message explicitly asks for development, implementation, task continuation, deep research/benchmarking, replication, or commit. Stay read-only for planning, analysis, review, explanation, and file-impact questions.',
    ].join('\n'),
  },
  {
    id: 'loop',
    title: 'OpenPrd Loop',
    body: [
      '使用长程 agent harness 做开发落地。',
      '',
      '1. Run `openprd loop . --init` once for the workspace.',
      '2. Run `openprd loop . --plan --change <id>` to build the feature list from structured change tasks.',
      '3. Run `openprd loop . --next` to inspect the next dependency-ready task.',
      '4. Run `openprd loop . --run --agent codex --dry-run` or `openprd loop . --run --agent claude --dry-run` to prepare one fresh single-task session.',
      '5. Only run `openprd loop . --run` when the current user message explicitly asks to execute development, continue a task, or perform deep research/benchmarking.',
      '6. 每个任务都必须先自测；前端界面任务在 Codex 桌面优先用 Computer Use，在 CLI/Claude Code 优先用 Playwright 或 MCP 自动化。',
      '7. After the session completes, run `openprd loop . --finish --item <task-id> --commit` only when commit is explicitly part of the requested execution.',
      '',
      'Do not continue into the next task inside the same agent session.',
    ].join('\n'),
  },
  {
    id: 'repair',
    title: 'OpenPrd Repair',
    body: [
      'Use `openprd doctor .` to identify drift or missing generated files. Run `openprd update .` for generated guidance drift, repair standards/docs manually, then re-run verification.',
    ].join('\n'),
  },
  {
    id: 'onboard',
    title: 'OpenPrd Onboard',
    body: [
      'Explain the current OpenPrd workspace by running `openprd status .`, `openprd next .`, and `openprd doctor .`, then summarize the current gate, blockers, standards state, and safest next command.',
    ].join('\n'),
  },
  {
    id: 'guard',
    title: 'OpenPrd Guard',
    body: [
      'Before a high-risk action, verify the harness gates: `openprd standards . --verify`, `openprd validate .`, and when relevant `openprd change . --validate --change <id>`.',
    ].join('\n'),
  },
  {
    id: 'fleet',
    title: 'OpenPrd Fleet',
    body: [
      'Audit or update historical projects. Start with `openprd fleet <root> --dry-run`; use `--update-openprd` only for projects that already have `.openprd/`, and reserve `--setup-missing` for explicitly selected projects.',
    ].join('\n'),
  },
];

function cjoin(...parts) {
  return path.join(...parts);
}

function exists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await readText(filePath));
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function appendJsonl(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

async function packageVersion() {
  const pkg = await readJson(cjoin(PACKAGE_ROOT, 'package.json')).catch(() => ({}));
  return String(pkg.version ?? '0.0.0');
}

function checksum(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

async function fileChecksum(filePath) {
  const text = await readText(filePath);
  return checksum(text);
}

function normalizedRelativePath(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function harnessPath(projectRoot, relativePath) {
  return cjoin(projectRoot, relativePath);
}

function recordManagedFile(options, record) {
  if (!Array.isArray(options.managedFiles)) {
    return;
  }
  options.managedFiles.push(record);
}

function normalizeTools(value) {
  const raw = String(value ?? 'all').trim().toLowerCase();
  if (!raw || raw === 'all' || raw === 'auto') {
    return OPENPRD_AGENT_TOOLS;
  }
  const tools = raw.split(',').map((item) => item.trim()).filter(Boolean);
  const invalid = tools.filter((tool) => !OPENPRD_AGENT_TOOLS.includes(tool));
  if (invalid.length > 0) {
    throw new Error(`Unsupported OpenPrd agent tool(s): ${invalid.join(', ')}`);
  }
  return [...new Set(tools)];
}

function normalizeHookProfile(value) {
  const profile = String(value ?? OPENPRD_DEFAULT_HOOK_PROFILE).trim().toLowerCase() || OPENPRD_DEFAULT_HOOK_PROFILE;
  if (!Object.prototype.hasOwnProperty.call(OPENPRD_HOOK_PROFILES, profile)) {
    throw new Error(`Unsupported OpenPrd hook profile: ${profile}. Use lite, guarded, or full.`);
  }
  return profile;
}

function hookEventsForProfile(profile) {
  return OPENPRD_HOOK_PROFILES[normalizeHookProfile(profile)];
}

function codexHookMatcher(eventName, hookProfile) {
  if (!OPENPRD_HOOK_EVENTS_WITH_MATCHER.has(eventName)) return null;
  const profile = normalizeHookProfile(hookProfile);
  if (profile === 'lite' && eventName === 'PreToolUse') {
    return OPENPRD_LITE_WRITE_TOOL_MATCHER;
  }
  if (profile === 'guarded' && eventName === 'PreToolUse') {
    return OPENPRD_GUARDED_WRITE_TOOL_MATCHER;
  }
  return '*';
}

function resolveCodexHome(options = {}) {
  return options.codexHome
    ?? process.env.OPENPRD_CODEX_HOME
    ?? process.env.CODEX_HOME
    ?? cjoin(os.homedir(), '.codex');
}

function displayPath(filePath) {
  const home = os.homedir();
  return filePath.startsWith(`${home}${path.sep}`) ? `~/${path.relative(home, filePath)}` : filePath;
}

function managedBlock(id, body) {
  return [
    `<!-- OPENPRD:${id}:START -->`,
    body.trimEnd(),
    `<!-- OPENPRD:${id}:END -->`,
    '',
  ].join('\n');
}

function upsertManagedBlock(text, id, body) {
  const start = `<!-- OPENPRD:${id}:START -->`;
  const end = `<!-- OPENPRD:${id}:END -->`;
  const block = managedBlock(id, body);
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, 'm');
  if (pattern.test(text)) {
    return text.replace(pattern, block);
  }
  return `${text.trimEnd()}\n\n${block}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generatedMarker({ adapter, source, version, body, commentStyle = 'html' }) {
  const lines = [
    'OPENPRD:GENERATED',
    `adapter=${adapter}`,
    `source=${source}`,
    `version=${version}`,
    `checksum=${checksum(body)}`,
  ];
  if (commentStyle === 'js') {
    return `/* ${lines.join('\n')}\n*/`;
  }
  return [
    '<!-- OPENPRD:GENERATED',
    `adapter=${adapter}`,
    `source=${source}`,
    `version=${version}`,
    `checksum=${checksum(body)}`,
    '-->',
  ].join('\n');
}

function renderGeneratedFile(params) {
  const marker = generatedMarker(params);
  const body = params.body.trimEnd();
  if (params.commentStyle === 'js') {
    return `${marker}\n\n${body}\n`;
  }
  if (body.startsWith('---\n')) {
    const frontmatterEnd = body.indexOf('\n---\n', 4);
    if (frontmatterEnd >= 0) {
      const closeEnd = frontmatterEnd + '\n---\n'.length;
      return `${body.slice(0, closeEnd)}\n${marker}\n${body.slice(closeEnd)}\n`;
    }
  }
  return `${marker}\n\n${body}\n`;
}

async function writeGeneratedFile(filePath, params, options, changes) {
  const body = renderGeneratedFile(params);
  const rel = normalizedRelativePath(options.projectRoot, filePath);
  const current = await readText(filePath).catch(() => null);
  if (current && !current.includes('OPENPRD:GENERATED') && !options.force) {
    changes.push({ path: rel, status: 'skipped-user-file' });
    return;
  }
  await writeText(filePath, body);
  changes.push({ path: rel, status: current ? 'updated' : 'created' });
  recordManagedFile(options, {
    path: rel,
    scope: 'project',
    kind: 'generated-file',
    adapter: params.adapter,
    source: params.source,
    bodyChecksum: checksum(params.body),
    fileChecksum: checksum(body),
  });
}

async function upsertTextBlockFile(filePath, id, blockBody, options, changes) {
  const rel = normalizedRelativePath(options.projectRoot, filePath);
  const current = await readText(filePath).catch(() => '');
  const next = upsertManagedBlock(current || '# Project Instructions\n', id, blockBody);
  await writeText(filePath, next);
  changes.push({ path: rel, status: current ? 'updated-block' : 'created' });
  recordManagedFile(options, {
    path: rel,
    scope: 'project',
    kind: 'managed-block',
    marker: `OPENPRD:${id}`,
    bodyChecksum: checksum(blockBody),
  });
}

function agentContractBody() {
  return [
    '## OpenPrd Harness',
    '',
    '本项目由 OpenPrd 管理。Agent 应优先遵循 harness，而不是零散的临时指令。',
    '',
    '### 默认行为',
    '',
    '1. 在规划或改文件前，先从 `.openprd/` 重建状态。',
    '2. 选择下一个执行单元前先运行 `openprd run . --context`，但把它当作建议上下文，不要机械照执行。',
    '3. 跟随任何建议前先判断当前用户意图。遇到规划、分析、架构评审、“怎么改”或“会动哪些文件”这类请求时，保持只读并基于证据回答。',
    '4. 如果用户提出新的产品、模块或工作流需求，编码前先走需求入口：clarify、记录用户回答、synthesize/review、生成或检查 OpenPrd change、拆分任务，并等待用户明确确认。',
    '5. 如果用户在确认后要求实现，且工作会影响产品或架构，就要先生成或检查 OpenPrd change，再开始编码。',
    '6. 实现过程中，对每个新增或修改文件都做一次文档影响检查：缺少 `docs/basic/`、文件说明书或目录 README 就补齐；如果变更影响职责、流程、结构、依赖或产品行为，就同步更新现有文档。涉及后端、脚本、Agent、工具链、服务或数据处理变更时，还要把 CLI 与 API 视为同级接入面：同步检查命令入口、参数、输出契约、`help`、`doctor`、`dry-run`、`status` 与接口协议、返回结构、身份边界是否受影响，并更新 `docs/basic/backend-structure.md` 或明确写不适用原因。',
    '7. 在宣称准备就绪前，运行 `openprd standards . --verify`、`openprd quality . --verify` 和 `openprd run . --verify`。',
    '8. 把 `.openprd/harness/` 视为已安装的 agent 控制状态目录：其中包含 run state、iterations、events、hook state、install manifest 和 drift report。',
    '9. Codex hooks 默认使用 lite 模式：`UserPromptSubmit` 加一个轻量 `PreToolUse` 写入门禁。只有项目明确需要完整遥测时，才使用 `--hook-profile full`。',
    '10. 对任何带 `locale: zh-CN` 的 OpenPrd diagram contract，所有可见标签、节点文案、流程标签、卡片、面板和评审说明都必须使用简体中文。只保留必要的专有名词和技术字段名。',
    '11. 当用户要求最佳实践、benchmark、对标、参考产品、prompt engineering、Agent harness、context engineering、CLI 或 skill 体系优化时，先使用项目生成的 `openprd-benchmark-router`，再按 DeepWiki、Context7 或官方资料规则调研。',
    '',
    '### 标准命令',
    '',
    '- `openprd next .` - 选择下一步 harness 动作。',
    '- `openprd run . --context` - 选择下一个 hook-stable 执行单元。',
    '- `openprd run . --verify` - 校验当前 run 门禁。',
    '- `openprd quality . --verify` - 生成覆盖 observability、business guardrails、smoke、performance、极端场景和知识缺口的 HTML 质量评估报告。',
    '- `openprd quality . --learn --from <report-id-or-json>` - 把已审阅或修复的问题沉淀成项目级经验 skill 知识。',
    '- `openprd loop . --plan --change <id>` - 构建“一次会话只做一个任务”的 feature list。',
    '- `openprd loop . --run --agent codex|claude --dry-run` - 准备一个全新的单任务 agent 会话。',
    '- `openprd loop . --run --agent codex|claude` - 仅在用户明确要求开发、继续推进、深度调研 / benchmark 或复刻时执行。',
    '- `openprd loop . --finish --item <task-id> --commit` - 完成校验、写入暂存测试报告、标记 done，并且只有当用户明确要求 commit 时才创建任务提交。',
    '- `openprd standards . --verify` - 校验项目文档标准。',
    '- `openprd change . --validate --change <id>` - 校验 change 结构。',
    '- `openprd discovery . --verify` - verify long-running discovery state.',
    '- `openprd doctor .` - check agent integration health.',
    '- `openprd update .` - repair generated agent guidance drift.',
    '- `openprd update . --hook-profile lite|guarded|full` - choose Codex hook weight; default `lite` keeps requirement-intake write gates without full telemetry.',
    '- `openprd fleet <root> --dry-run` - audit historical projects before batch updates.',
    '',
    '`openprd setup` and `openprd update` also enable Codex hooks in the user Codex config when run from the CLI.',
    '',
    '### High-Risk Gate',
    '',
    'Before freeze, handoff, accepted spec apply/archive, commit, push, release, or publish, ensure `openprd standards . --verify`, `openprd quality . --verify`, `openprd run . --verify`, and `openprd doctor .` are healthy.',
    '',
    'The only baseline documentation path is `docs/basic/`.',
    '',
  ].join('\n');
}

async function renderSkill(skill, adapter, projectRoot) {
  const sections = [
    '---',
    `name: ${skill.id}`,
    `description: ${skill.description}`,
    '---',
    '',
    skill.body,
  ];
  if (skill.id === 'openprd-benchmark-router' && projectRoot) {
    sections.push('', await renderApprovedBenchmarkRegistrySection(projectRoot).catch(() => ''));
  }
  return sections.join('\n');
}

function renderCommand(command, adapter) {
  if (adapter === 'cursor') {
    return [
      `# ${command.title}`,
      '',
      command.body,
      '',
      'Always follow the OpenPrd managed rules in `.cursor/rules/openprd.mdc` and project `AGENTS.md`.',
      '',
    ].join('\n');
  }
  return [
    `# ${command.title}`,
    '',
    command.body,
    '',
    'Always rebuild state from `.openprd/` before acting.',
    '',
  ].join('\n');
}

function renderCursorRule() {
  return [
    '---',
    'description: OpenPrd harness 规则',
    'globs:',
    '  - "**/*"',
    'alwaysApply: true',
    '---',
    '',
    '# OpenPrd Harness',
    '',
    agentContractBody(),
  ].join('\n');
}

function quoteForToml(value) {
  return JSON.stringify(value);
}

function hookCommand(projectRoot, eventName) {
  const hookPath = cjoin(projectRoot, '.codex', 'hooks', 'openprd-hook.mjs');
  return `node ${quoteShell(hookPath)} ${eventName}`;
}

function quoteShell(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function renderCodexHookRunner() {
  return `import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const eventName = process.argv[2] || 'Unknown';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let payload = {};
  try { payload = input.trim() ? JSON.parse(input) : {}; } catch {}
  const cwd = payload.cwd || process.cwd();
  const result = handle(eventName, cwd, payload);
  if (result) {
    process.stdout.write(JSON.stringify(result));
  }
});

function now() {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return \`\${parts.year}-\${parts.month}-\${parts.day} \${parts.hour}:\${parts.minute}:\${parts.second}\`;
}

function findProjectRoot(start) {
  let current = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(current, '.openprd'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(start || process.cwd());
    }
    current = parent;
  }
}

function harnessDir(root) {
  return path.join(root, '.openprd', 'harness');
}

function ensureHarness(root) {
  const dir = harnessDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const statePath = path.join(dir, 'hook-state.json');
  if (!fs.existsSync(statePath)) {
    writeJsonSync(statePath, {
      version: 1,
      active: true,
      lastEventAt: null,
      lastFingerprint: null,
      counters: {},
      recentFingerprints: {},
      suppressions: { inputLock: false },
    });
  }
  const eventsPath = path.join(dir, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) {
    fs.writeFileSync(eventsPath, '');
  }
}

function readJsonSync(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonSync(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\\n');
}

function appendEvent(root, event) {
  ensureHarness(root);
  fs.appendFileSync(path.join(harnessDir(root), 'events.jsonl'), JSON.stringify({ at: now(), ...event }) + '\\n');
}

function updateHookState(root, event) {
  ensureHarness(root);
  const statePath = path.join(harnessDir(root), 'hook-state.json');
  const state = readJsonSync(statePath, {
    version: 1,
    counters: {},
    recentFingerprints: {},
    suppressions: { inputLock: false },
  });
  state.lastEventAt = now();
  state.lastEvent = event.eventName;
  state.lastFingerprint = event.fingerprint;
  state.counters[event.eventName] = (state.counters[event.eventName] || 0) + 1;
  state.recentFingerprints = state.recentFingerprints || {};
  if (event.fingerprint) {
    state.recentFingerprints[event.fingerprint] = Date.now();
  }
  for (const [fingerprint, seenAt] of Object.entries(state.recentFingerprints)) {
    if (Date.now() - Number(seenAt) > 300000) {
      delete state.recentFingerprints[fingerprint];
    }
  }
  writeJsonSync(statePath, state);
  return state;
}

function isDuplicate(root, fingerprint, windowMs = 15000) {
  const state = readJsonSync(path.join(harnessDir(root), 'hook-state.json'), {});
  const seenAt = state?.recentFingerprints?.[fingerprint];
  return Boolean(seenAt && Date.now() - Number(seenAt) < windowMs);
}

function fingerprintFor(eventName, payload, risk) {
  const tool = payload.tool_name || payload.toolName || payload.name || '';
  const inputText = JSON.stringify(payload.tool_input || payload.toolInput || payload.input || payload || {}).slice(0, 2000);
  return crypto.createHash('sha256').update(JSON.stringify({ eventName, tool, inputText, risk: risk.level })).digest('hex').slice(0, 16);
}

function payloadText(payload) {
  return JSON.stringify(payload.tool_input || payload.toolInput || payload.input || payload || {});
}

function promptText(payload) {
  return String(payload.prompt || payload.user_prompt || payload.message || '');
}

function preview(text, max = 600) {
  return String(text || '').replace(/\\s+/g, ' ').trim().slice(0, max);
}

function requirementGatePath(root) {
  return path.join(harnessDir(root), 'requirement-gate.json');
}

function analyzePromptIntent(prompt) {
  const text = String(prompt || '').trim();
  const normalized = text.toLowerCase();
  const internalOpenPrdExecution = /^#\\s*OpenPrd\\s+长程单任务执行会话/m.test(text)
    || /模式:\\s*loop-run\\b/i.test(text)
    || /模式:\\s*loop-finish\\b/i.test(text);
  const productPatterns = [
    /新增/,
    /增加/,
    /新建/,
    /我希望/,
    /用户反馈/,
    /需求/,
    /功能/,
    /模块/,
    /页面/,
    /入口/,
    /流程/,
    /编排/,
    /一站式/,
    /体验/,
    /信息架构/,
    /团队搭建/,
    /agent\\s*市场/i,
    /skill\\s*library/i,
    /cli\\s*库/i,
    /workflow/i,
    /wizard/i,
  ];
  const tinyEditPatterns = [
    /文案.{0,8}(改短|调整|替换)/,
    /按钮文案/,
    /typo/i,
    /copy/i,
  ];
  const explicitExecutionPatterns = [
    /直接(改|做|实现|落地|修)/,
    /开始(改|做|实现|开发|落地)/,
    /请(实现|落地|修改|修复)/,
    /可以(执行|落地|实现|开发)/,
  ];
  const confirmationPatterns = [
    /确认.*(执行|落地|实现|继续|开发)/,
    /按(这个|刚才|上面|已确认)?.{0,12}(方案|计划|拆解).{0,12}(执行|落地|实现|开发)/,
  ];
  const readOnlyPatterns = [
    /看看/,
    /规划/,
    /分析/,
    /梳理/,
    /评估/,
    /怎么改/,
    /预计动哪些文件/,
    /review/i,
    /explain/i,
  ];
  const requiresIntake = !internalOpenPrdExecution
    && productPatterns.some((pattern) => pattern.test(text))
    && !tinyEditPatterns.some((pattern) => pattern.test(text));
  const explicitExecution = internalOpenPrdExecution || explicitExecutionPatterns.some((pattern) => pattern.test(text));
  const confirmation = confirmationPatterns.some((pattern) => pattern.test(text));
  const readOnly = readOnlyPatterns.some((pattern) => pattern.test(text));
  return {
    requiresIntake,
    explicitExecution,
    confirmation,
    readOnly,
    shouldInject: requiresIntake || explicitExecution || confirmation || readOnly || /openprd/i.test(normalized) || /\\bprd\\b/i.test(normalized),
  };
}

function readRequirementGate(root) {
  return readJsonSync(requirementGatePath(root), null);
}

function writeRequirementGate(root, value) {
  writeJsonSync(requirementGatePath(root), value);
}

function openRequirementGate(root, prompt, intent) {
  const current = readRequirementGate(root);
  const gate = {
    version: 1,
    active: true,
    status: 'requires-clarification',
    openedAt: current?.openedAt || now(),
    updatedAt: now(),
    promptPreview: preview(prompt, 500),
    reason: 'new product/module/workflow requirement',
    requiredFlow: ['clarify', 'capture', 'review', 'tasks', 'user-confirmation', 'implementation'],
    intent,
  };
  writeRequirementGate(root, gate);
  return gate;
}

function confirmRequirementGate(root, prompt) {
  const current = readRequirementGate(root);
  if (!current?.active) {
    return current;
  }
  const next = {
    ...current,
    active: false,
    status: 'user-confirmed-for-execution',
    confirmedAt: now(),
    confirmationPreview: preview(prompt, 500),
  };
  writeRequirementGate(root, next);
  return next;
}

function isRequirementGateActive(root) {
  return Boolean(readRequirementGate(root)?.active);
}

function isMutationPayload(payload, risk) {
  const text = payloadText(payload);
  const tool = String(payload.tool_name || payload.toolName || payload.name || '');
  return risk.level === 'medium'
    || risk.level === 'high'
    || /apply_patch/i.test(tool)
    || /apply_patch/i.test(text)
    || /\\*\\*\\* Begin Patch/.test(text);
}

function isAllowedDuringRequirementGate(payload) {
  const text = payloadText(payload);
  const allowedOpenPrd = [
    /openprd\\s+status\\b/i,
    /openprd\\s+next\\b/i,
    /openprd\\s+run\\s+\\.\\s+--context\\b/i,
    /openprd\\s+clarify\\b/i,
    /openprd\\s+capture\\b/i,
    /openprd\\s+classify\\b/i,
    /openprd\\s+interview\\b/i,
    /openprd\\s+synthesize\\b/i,
    /openprd\\s+diagram\\b/i,
    /openprd\\s+change\\s+.*--generate/i,
    /openprd\\s+change\\s+.*--validate/i,
    /openprd\\s+loop\\s+.*--plan/i,
    /openprd\\s+standards\\s+.*--verify/i,
    /openprd\\s+doctor\\b/i,
  ];
  return allowedOpenPrd.some((pattern) => pattern.test(text));
}

function runOpenPrd(args, cwd) {
  const command = process.env.OPENPRD_CLI || 'openprd';
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: process.env,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function recordRunHook(cwd, baseEvent, outcome) {
  const args = [
    'run',
    '.',
    '--record-hook',
    '--event',
    baseEvent.eventName,
    '--risk',
    baseEvent.risk.level,
    '--outcome',
    outcome,
  ];
  if (baseEvent.preview) {
    args.push('--preview', baseEvent.preview.slice(0, 300));
  }
  runOpenPrd(args, cwd);
}

function requirementGateMessage(intent, gate) {
  if (!intent?.requiresIntake && !gate?.active) {
    return null;
  }
  const status = gate?.active ? 'active' : 'opened';
  return [
    'OpenPrd requirement intake gate: ' + status + '.',
    'This prompt looks like a new product/module/workflow requirement. Do not edit implementation files yet.',
    'Required order: clarify the requirement, capture user answers, synthesize or review the artifact, decompose tasks, get explicit user confirmation, then implement.',
    'Recommended next action: run openprd clarify . to inspect missing questions; only open the HTML artifact when it actually contains user-facing questions or a useful review surface.',
  ].join('\\n');
}

function confirmationGateMessage(gate) {
  if (!gate || gate.active) {
    return null;
  }
  return [
    'OpenPrd requirement intake gate was explicitly confirmed by the user.',
    'Implementation may proceed only within the confirmed scope, with docs/basic, file manuals, folder README docs, standards verification, and OpenPrd run verification kept up to date. For backend, script, agent, tooling, service, or data-processing changes, keep CLI and API surface review current in docs/basic/backend-structure.md.',
  ].join('\\n');
}

function contextMessage(cwd, intent = null, gate = null) {
  const run = runOpenPrd(['run', '.', '--context'], cwd);
  const gateMessage = requirementGateMessage(intent, gate) || confirmationGateMessage(gate);
  if (run.ok) {
    return [
      run.stdout,
      gateMessage,
      'OpenPrd 上下文只是建议，不是自动执行指令。请先判断用户当前意图。',
      '新产品、模块或流程需求在改代码前必须先完成需求入口：澄清、评审、任务拆解，并等待用户明确确认。',
      '如果用户只是要求看看、规划、分析、审查、解释影响或列出文件，请保持只读并基于证据回答；不要运行 OpenPrd loop、任务推进、discovery 推进、commit 或其他写入命令。',
      '只有当用户当前明确要求开发、实现、修复、继续任务、深度调研、对标复刻或提交时，才运行 openprd loop --run、openprd tasks --advance、openprd discovery --advance、commit/push 等执行命令。',
      '涉及后端、脚本、Agent、工具链、服务或数据处理变更时，把 CLI 与 API 视为同级接入面：同步检查命令入口、参数、输出契约、help/doctor/dry-run/status 与接口协议、返回结构、身份边界是否受影响，并更新 docs/basic/backend-structure.md 或明确写不适用原因。',
      '声明实现就绪前，先运行 openprd standards . --verify 和 openprd run . --verify。',
    ].filter(Boolean).join('\\n');
  }
  const status = runOpenPrd(['status', '.'], cwd);
  const next = runOpenPrd(['next', '.'], cwd);
  if (!status.ok && !next.ok) {
    return '已安装 OpenPrd harness，但本轮无法读取工作区状态。声明就绪前请先运行 openprd doctor .。';
  }
  return [
    'OpenPrd harness 上下文:',
    status.ok ? status.stdout : '',
    next.ok ? next.stdout : '',
    gateMessage,
    '新产品、模块或流程需求在改代码前必须先完成需求入口：澄清、评审、任务拆解，并等待用户明确确认。',
    'OpenPrd 下一步只是建议。规划、分析、审查类请求保持只读；只有用户当前明确要求开发、深度调研、对标复刻或继续任务时才执行。',
    '涉及后端、脚本、Agent、工具链、服务或数据处理变更时，把 CLI 与 API 视为同级接入面，并同步更新 docs/basic/backend-structure.md 或明确写不适用原因。',
    '声明就绪前请验证 docs/basic 标准。',
  ].filter(Boolean).join('\\n');
}

function shouldInjectOpenPrdContext(payload) {
  const prompt = promptText(payload);
  if (!prompt.trim()) {
    return false;
  }
  const intent = analyzePromptIntent(prompt);
  if (intent.shouldInject) {
    return true;
  }
  const normalized = prompt.toLowerCase();
  const triggers = [
    /openprd/i,
    /open\s*prd/i,
    /\\bprd\\b/i,
    /openprd\\s+(run|loop|fleet|doctor|standards|change|discovery|handoff|freeze)/i,
    /\\b(fleet|standards)\\b/i,
    /深度调研/,
    /深度对标/,
    /持续调研/,
    /复刻/,
    /对标/,
    /文件说明书/,
    /文件夹说明书/,
    /基础文档/,
    /docs\\/basic/i,
    /standards/i,
    /handoff/i,
    /freeze/i,
    /新增/,
    /增加/,
    /新建/,
    /我希望/,
    /用户反馈/,
    /需求/,
    /功能/,
    /模块/,
    /页面/,
    /入口/,
    /流程/,
    /编排/,
    /一站式/,
    /体验/,
  ];
  return triggers.some((pattern) => pattern.test(normalized));
}

function classifyRisk(payload) {
  const text = payloadText(payload);
  const normalized = text.toLowerCase();
  const highPatterns = [
    /git\\s+push/,
    /git\\s+commit/,
    /npm\\s+publish/,
    /pnpm\\s+publish/,
    /yarn\\s+npm\\s+publish/,
    /gh\\s+release/,
    /rm\\s+-rf/,
    /openprd\\s+freeze\\b/,
    /openprd\\s+handoff\\b/,
    /openprd\\s+change\\s+.*--apply/,
    /openprd\\s+change\\s+.*--archive/,
  ];
  const mediumPatterns = [
    /apply_patch/,
    /npm\\s+install/,
    /npm\\s+i\\s/,
    /pnpm\\s+add/,
    /yarn\\s+add/,
    /bun\\s+add/,
    /openprd\\s+setup\\b/,
    /openprd\\s+update\\b/,
    /openprd\\s+standards\\s+.*--init/,
    /openprd\\s+change\\s+.*--generate/,
    /openprd\\s+tasks\\s+.*--advance/,
    /openprd\\s+discovery\\s+.*--advance/,
    /openprd\\s+(capture|classify|synthesize|diagram)\\b/,
  ];
  if (highPatterns.some((pattern) => pattern.test(normalized))) {
    return { level: 'high', reason: 'release, history, freeze, handoff, destructive, or accepted-change action' };
  }
  if (mediumPatterns.some((pattern) => pattern.test(normalized))) {
    return { level: 'medium', reason: 'workspace mutation or dependency/configuration change' };
  }
  return { level: 'low', reason: 'read-only or local exploratory action' };
}

function extractChangeId(text) {
  const match = String(text || '').match(/--change\\s+([a-zA-Z0-9._-]+)/);
  return match ? match[1] : null;
}

function runGateChecks(cwd, payload, risk) {
  const checks = [];
  const run = runOpenPrd(['run', '.', '--verify'], cwd);
  checks.push({ name: 'run-verify', ok: run.ok, output: run.stdout || run.stderr });
  const text = payloadText(payload);
  const changeId = extractChangeId(text);
  if (changeId && /openprd\\s+change\\s+.*--(apply|archive|validate)/i.test(text)) {
    const change = runOpenPrd(['change', '.', '--validate', '--change', changeId], cwd);
    checks.push({ name: 'change-validate', ok: change.ok, output: change.stdout || change.stderr });
  }
  return {
    ok: checks.every((check) => check.ok),
    checks,
    summary: checks.map((check) => \`\${check.name}: \${check.ok ? 'ok' : 'failed'}\`).join(', '),
  };
}

function hookSuppressed(root) {
  const state = readJsonSync(path.join(harnessDir(root), 'hook-state.json'), {});
  const lockPath = path.join(harnessDir(root), 'input-lock.json');
  const lock = readJsonSync(lockPath, null);
  return Boolean(state?.suppressions?.inputLock || (lock && lock.active));
}

function allowHook(additionalContext = null, outputEventName = eventName) {
  const result = { continue: true };
  if (additionalContext) {
    result.hookSpecificOutput = {
      hookEventName: outputEventName,
      additionalContext,
    };
  }
  return result;
}

function blockHook(reason) {
  return {
    decision: 'block',
    reason,
    systemMessage: reason,
  };
}

function handle(eventName, cwd, payload) {
  const root = findProjectRoot(cwd);
  ensureHarness(root);
  const risk = classifyRisk(payload);
  const fingerprint = fingerprintFor(eventName, payload, risk);
  const duplicate = isDuplicate(root, fingerprint);
  const baseEvent = {
    eventName,
    risk,
    fingerprint,
    duplicate,
    preview: preview(payloadText(payload)),
  };

  if (eventName === 'SessionStart') {
    return allowHook();
  }

  if (eventName === 'UserPromptSubmit') {
    if (duplicate) {
      return allowHook();
    }
    const prompt = promptText(payload);
    const intent = analyzePromptIntent(prompt);
    let gate = readRequirementGate(root);
    if (intent.confirmation && gate?.active) {
      gate = confirmRequirementGate(root, prompt);
      appendEvent(root, { ...baseEvent, outcome: 'requirement-gate-confirmed' });
      recordRunHook(root, baseEvent, 'requirement-gate-confirmed');
      updateHookState(root, baseEvent);
      return allowHook(contextMessage(root, intent, gate));
    }
    if (intent.requiresIntake) {
      gate = openRequirementGate(root, prompt, intent);
      const result = allowHook(contextMessage(root, intent, gate));
      appendEvent(root, { ...baseEvent, outcome: 'requirement-gate-opened' });
      recordRunHook(root, baseEvent, 'requirement-gate-opened');
      updateHookState(root, baseEvent);
      return result;
    }
    if (!shouldInjectOpenPrdContext(payload)) {
      return allowHook();
    }
    const result = allowHook(contextMessage(root, intent, gate));
    appendEvent(root, { ...baseEvent, outcome: 'context-injected' });
    recordRunHook(root, baseEvent, 'context-injected');
    updateHookState(root, baseEvent);
    return result;
  }

  if (eventName === 'PreToolUse') {
    if (isRequirementGateActive(root) && isMutationPayload(payload, risk) && !isAllowedDuringRequirementGate(payload)) {
      const reason = [
        'OpenPrd blocked a mutating action because a new requirement is still in requirement intake.',
        'Do not edit implementation files until the user has reviewed the clarify/review artifacts and explicitly confirmed the task breakdown.',
        'Next allowed actions: run openprd clarify ., capture answers with openprd capture ., synthesize/review, generate or inspect change/tasks, then ask the user to confirm execution. Open the HTML artifact only when it contains user-facing questions or a useful review surface.',
        'After the user explicitly confirms, retry the implementation within the confirmed scope.',
      ].join('\\n');
      appendEvent(root, { ...baseEvent, outcome: 'blocked-requirement-intake' });
      recordRunHook(root, baseEvent, 'blocked-requirement-intake');
      updateHookState(root, baseEvent);
      return blockHook(reason);
    }
    if (risk.level === 'high') {
      const gates = runGateChecks(root, payload, risk);
      appendEvent(root, { ...baseEvent, gates, outcome: gates.ok ? 'allowed-high-risk' : 'blocked-high-risk' });
      recordRunHook(root, baseEvent, gates.ok ? 'allowed-high-risk' : 'blocked-high-risk');
      updateHookState(root, baseEvent);
      if (!gates.ok) {
        return blockHook([
          'OpenPrd blocked a high-risk action because a harness gate failed.',
          gates.summary,
          ...gates.checks.filter((check) => !check.ok).map((check) => check.output).filter(Boolean),
          'Run openprd run . --context and openprd doctor .; repair the failed gate, then retry.',
        ].filter(Boolean).join('\\n'));
      }
      return allowHook(\`OpenPrd high-risk gate passed: \${gates.summary}.\`);
    }
    if (risk.level === 'medium') {
      appendEvent(root, { ...baseEvent, outcome: 'allowed-medium-risk' });
      recordRunHook(root, baseEvent, 'allowed-medium-risk');
      updateHookState(root, baseEvent);
      return allowHook('OpenPrd 检测到写入动作。声明就绪前，请同步维护 docs/basic、文件说明书、文件夹 README，以及相关 OpenPrd change/task 状态；如果涉及后端、脚本、Agent、工具链、服务或数据处理变更，还要把 CLI 与 API 视为同级接入面并更新 docs/basic/backend-structure.md。');
    }
    return allowHook();
  }

  if (eventName === 'PostToolUse') {
    const text = payloadText(payload);
    const failed = /command not found|no such file|permission denied|failed|error|exception/i.test(text);
    if (!failed) {
      return allowHook();
    }
    appendEvent(root, { ...baseEvent, outcome: failed ? 'tool-failure-detected' : 'tool-complete' });
    recordRunHook(root, baseEvent, failed ? 'tool-failure-detected' : 'tool-complete');
    updateHookState(root, baseEvent);
    if (failed && !duplicate) {
      return allowHook('A tool command appears to have failed. Use openprd doctor ., openprd next ., and the relevant verification command to choose the repair path.');
    }
    return allowHook();
  }

  if (eventName === 'Stop') {
    appendEvent(root, { ...baseEvent, outcome: 'stop-check' });
    recordRunHook(root, baseEvent, 'stop-check');
    updateHookState(root, baseEvent);
    if (hookSuppressed(root)) {
      return allowHook();
    }
    const run = runOpenPrd(['run', '.', '--context', '--json'], root);
    if (run.ok) {
      try {
        const parsed = JSON.parse(run.stdout);
        const command = parsed?.recommendation?.command || '';
        if (command && !/openprd\\s+next\\s+\\./.test(command)) {
          return {
            continue: true,
            systemMessage: \`OpenPrd still has a hook-driven next action:\\n\${parsed.recommendation.title}\\nSuggested command: \${command}\`,
          };
        }
      } catch {}
    }
  }

  appendEvent(root, { ...baseEvent, outcome: 'noop' });
  recordRunHook(root, baseEvent, 'noop');
  updateHookState(root, baseEvent);
return allowHook();
}
`;
}

function ensureFeatureHooks(text) {
  const featureHeader = /^\[features\]\s*$/m;
  if (!featureHeader.test(text)) {
    const prefix = text.trimEnd();
    return `${prefix ? `${prefix}\n\n` : ''}[features]\ncodex_hooks = true\n`;
  }

  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '[features]');
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\[.+\]\s*$/.test(lines[index].trim())) {
      end = index;
      break;
    }
  }
  let hasHooks = false;
  const legacyHookLines = [];
  for (let index = start + 1; index < end; index += 1) {
    if (/^\s*codex_hooks\s*=/.test(lines[index])) {
      lines[index] = 'codex_hooks = true';
      hasHooks = true;
    } else if (/^\s*hooks\s*=/.test(lines[index])) {
      legacyHookLines.push(index);
    }
  }
  if (hasHooks) {
    for (let index = legacyHookLines.length - 1; index >= 0; index -= 1) {
      lines.splice(legacyHookLines[index], 1);
    }
  } else if (legacyHookLines.length > 0) {
    lines[legacyHookLines[0]] = 'codex_hooks = true';
    for (let index = legacyHookLines.length - 1; index >= 1; index -= 1) {
      lines.splice(legacyHookLines[index], 1);
    }
  } else {
    lines.splice(end, 0, 'codex_hooks = true');
  }
  return lines.join('\n');
}

function codexHooksTomlBlock(projectRoot, options = {}) {
  const events = hookEventsForProfile(options.hookProfile);
  const groups = [];
  for (const eventName of events) {
    groups.push(`[[hooks.${eventName}]]`);
    const matcher = codexHookMatcher(eventName, options.hookProfile);
    if (matcher) {
      groups.push(`matcher = ${quoteForToml(matcher)}`);
    }
    groups.push(`hooks = [{ type = "command", command = ${quoteForToml(hookCommand(projectRoot, eventName))}, timeout = 15000 }]`);
    groups.push('');
  }
  return groups.join('\n').trimEnd();
}

function upsertTomlManagedBlock(text, id, body) {
  const start = `# OPENPRD:${id}:START`;
  const end = `# OPENPRD:${id}:END`;
  const block = `${start}\n${body.trimEnd()}\n${end}\n`;
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, 'm');
  if (pattern.test(text)) {
    return text.replace(pattern, block);
  }
  return `${text.trimEnd()}\n\n${block}`;
}

async function writeCodexConfig(projectRoot, options, changes) {
  const configPath = cjoin(projectRoot, '.codex', 'config.toml');
  const rel = normalizedRelativePath(projectRoot, configPath);
  const current = await readText(configPath).catch(() => '');
  let next = ensureFeatureHooks(current || '');
  next = upsertTomlManagedBlock(next, 'CODEX-HOOKS', codexHooksTomlBlock(projectRoot, options));
  await writeText(configPath, next);
  changes.push({ path: rel, status: current ? 'updated' : 'created' });
  recordManagedFile(options, {
    path: rel,
    scope: 'project',
    kind: 'codex-config',
    marker: 'OPENPRD:CODEX-HOOKS',
  });
}

async function writeCodexUserConfig(options, changes) {
  const configPath = cjoin(resolveCodexHome(options), 'config.toml');
  const current = await readText(configPath).catch(() => '');
  const next = ensureFeatureHooks(current || '');
  if (next !== current) {
    await writeText(configPath, next);
  }
  changes.push({
    path: displayPath(configPath),
    status: current ? (next === current ? 'unchanged' : 'updated') : 'created',
  });
  recordManagedFile(options, {
    path: displayPath(configPath),
    scope: 'user',
    kind: 'codex-user-config',
    marker: 'codex_hooks = true',
  });
}

function codexHookGroup(projectRoot, eventName, options = {}) {
  const group = {
    hooks: [
      {
        type: 'command',
        command: hookCommand(projectRoot, eventName),
        timeout: 15000,
      },
    ],
  };
  const matcher = codexHookMatcher(eventName, options.hookProfile);
  if (matcher) {
    group.matcher = matcher;
  }
  return group;
}

function isOpenPrdHookGroup(group) {
  return JSON.stringify(group ?? {}).includes('openprd-hook.mjs');
}

async function writeCodexHooksJson(projectRoot, options, changes) {
  const hooksPath = cjoin(projectRoot, '.codex', 'hooks.json');
  const rel = normalizedRelativePath(projectRoot, hooksPath);
  const existed = await exists(hooksPath);
  const current = existed ? await readJson(hooksPath).catch(() => ({})) : {};
  const next = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const activeEvents = new Set(hookEventsForProfile(options.hookProfile));
  for (const eventName of OPENPRD_EVENTS) {
    const existing = Array.isArray(next[eventName]) ? next[eventName] : [];
    const kept = existing.filter((group) => !isOpenPrdHookGroup(group));
    if (activeEvents.has(eventName)) {
      next[eventName] = [
        ...kept,
        codexHookGroup(projectRoot, eventName, options),
      ];
    } else if (kept.length > 0) {
      next[eventName] = kept;
    } else {
      delete next[eventName];
    }
  }
  await writeJson(hooksPath, next);
  changes.push({ path: rel, status: existed ? 'updated' : 'created' });
  recordManagedFile(options, {
    path: rel,
    scope: 'project',
    kind: 'codex-hooks-json',
    marker: 'openprd-hook.mjs',
  });
}

async function writeCodexAdapter(projectRoot, options, changes) {
  const version = await packageVersion();
  for (const skill of CANONICAL_SKILLS) {
    const body = await renderSkill(skill, 'codex', projectRoot);
    await writeGeneratedFile(
      cjoin(projectRoot, '.codex', 'skills', skill.id, 'SKILL.md'),
      { adapter: 'codex', source: skill.id, version, body },
      options,
      changes,
    );
  }
  for (const command of CANONICAL_COMMANDS) {
    await writeGeneratedFile(
      cjoin(projectRoot, '.codex', 'prompts', `openprd-${command.id}.md`),
      { adapter: 'codex', source: `command:${command.id}`, version, body: renderCommand(command, 'codex') },
      options,
      changes,
    );
  }
  const hookPath = cjoin(projectRoot, '.codex', 'hooks', 'openprd-hook.mjs');
  await writeGeneratedFile(
    hookPath,
    { adapter: 'codex', source: 'codex-hooks', version, body: renderCodexHookRunner(), commentStyle: 'js' },
    { ...options, force: true },
    changes,
  );
  await fs.chmod(hookPath, 0o755).catch(() => {});
  await writeCodexConfig(projectRoot, options, changes);
  await writeCodexHooksJson(projectRoot, options, changes);
  if (options.enableUserCodexConfig) {
    await writeCodexUserConfig(options, changes);
  }
}

async function writeClaudeAdapter(projectRoot, options, changes) {
  const version = await packageVersion();
  await upsertTextBlockFile(cjoin(projectRoot, 'CLAUDE.md'), 'CLAUDE', agentContractBody(), options, changes);
  for (const skill of CANONICAL_SKILLS) {
    const body = await renderSkill(skill, 'claude', projectRoot);
    await writeGeneratedFile(
      cjoin(projectRoot, '.claude', 'skills', skill.id, 'SKILL.md'),
      { adapter: 'claude', source: skill.id, version, body },
      options,
      changes,
    );
  }
  for (const command of CANONICAL_COMMANDS) {
    await writeGeneratedFile(
      cjoin(projectRoot, '.claude', 'commands', 'openprd', `${command.id}.md`),
      { adapter: 'claude', source: `command:${command.id}`, version, body: renderCommand(command, 'claude') },
      options,
      changes,
    );
  }
}

async function writeCursorAdapter(projectRoot, options, changes) {
  const version = await packageVersion();
  await writeGeneratedFile(
    cjoin(projectRoot, '.cursor', 'rules', 'openprd.mdc'),
    { adapter: 'cursor', source: 'cursor-rules', version, body: renderCursorRule() },
    options,
    changes,
  );
  for (const command of CANONICAL_COMMANDS) {
    await writeGeneratedFile(
      cjoin(projectRoot, '.cursor', 'commands', `openprd-${command.id}.md`),
      { adapter: 'cursor', source: `command:${command.id}`, version, body: renderCommand(command, 'cursor') },
      options,
      changes,
    );
  }
}

async function ensureHarnessState(projectRoot) {
  await fs.mkdir(harnessPath(projectRoot, OPENPRD_HARNESS_DIR), { recursive: true });
  const hookStatePath = harnessPath(projectRoot, OPENPRD_HARNESS_HOOK_STATE);
  if (!(await exists(hookStatePath))) {
    await writeJson(hookStatePath, {
      version: 1,
      active: true,
      lastEventAt: null,
      lastFingerprint: null,
      counters: {},
      suppressions: {
        inputLock: false,
      },
    });
  }
  const eventsPath = harnessPath(projectRoot, OPENPRD_HARNESS_EVENTS);
  if (!(await exists(eventsPath))) {
    await writeText(eventsPath, '');
  }
}

async function writeInstallManifest(projectRoot, options, changes, tools) {
  const version = await packageVersion();
  const managedFiles = Array.isArray(options.managedFiles) ? options.managedFiles : [];
  const hookProfile = normalizeHookProfile(options.hookProfile);
  const manifest = {
    version: 1,
    openprdVersion: version,
    action: options.action ?? 'setup',
    generatedAt: timestamp(),
    tools,
    managedFiles,
    hooks: {
      profile: hookProfile,
      events: hookEventsForProfile(hookProfile),
      availableProfiles: Object.keys(OPENPRD_HOOK_PROFILES),
      state: OPENPRD_HARNESS_HOOK_STATE,
      eventsLog: OPENPRD_HARNESS_EVENTS,
      driftReport: OPENPRD_HARNESS_DRIFT,
    },
  };
  const manifestPath = harnessPath(projectRoot, OPENPRD_HARNESS_MANIFEST);
  const existed = await exists(manifestPath);
  await writeJson(manifestPath, manifest);
  changes.push({ path: OPENPRD_HARNESS_MANIFEST, status: existed ? 'updated' : 'created' });
  await appendJsonl(harnessPath(projectRoot, OPENPRD_HARNESS_EVENTS), {
    at: manifest.generatedAt,
    event: 'agent-integration-installed',
    action: manifest.action,
    tools,
    hookProfile,
    managedFileCount: managedFiles.length,
  });
  return manifest;
}

async function readInstallManifest(projectRoot) {
  return readJson(harnessPath(projectRoot, OPENPRD_HARNESS_MANIFEST)).catch(() => null);
}

async function inspectManagedFile(projectRoot, entry) {
  if (!entry || entry.scope === 'user') {
    return { ...entry, ok: true, skipped: true, reason: 'external-user-scope' };
  }
  const absolutePath = cjoin(projectRoot, entry.path);
  const fileExists = await exists(absolutePath);
  if (!fileExists) {
    return { ...entry, ok: false, reason: 'missing' };
  }
  const text = await readText(absolutePath);
  if (entry.marker && !text.includes(entry.marker)) {
    return { ...entry, ok: false, reason: 'missing-marker' };
  }
  if (entry.fileChecksum && checksum(text) !== entry.fileChecksum) {
    return { ...entry, ok: false, reason: 'checksum-drift' };
  }
  return { ...entry, ok: true, reason: 'ok' };
}

async function computeDriftReport(projectRoot, tools) {
  const manifest = await readInstallManifest(projectRoot);
  const checks = [];
  if (!manifest) {
    const report = {
      ok: false,
      checkedAt: timestamp(),
      tools,
      errors: [`${OPENPRD_HARNESS_MANIFEST} is missing. Run openprd update .`],
      checks,
    };
    await writeJson(harnessPath(projectRoot, OPENPRD_HARNESS_DRIFT), report);
    return report;
  }
  for (const entry of manifest.managedFiles ?? []) {
    checks.push(await inspectManagedFile(projectRoot, entry));
  }
  const errors = checks
    .filter((check) => !check.ok)
    .map((check) => `${check.path}: ${check.reason}`);
  const report = {
    ok: errors.length === 0,
    checkedAt: timestamp(),
    tools,
    manifestVersion: manifest.version,
    generatedAt: manifest.generatedAt,
    errors,
    checks,
  };
  await writeJson(harnessPath(projectRoot, OPENPRD_HARNESS_DRIFT), report);
  return report;
}

export async function setupOpenPrdAgentIntegration(projectRoot, options = {}) {
  const tools = normalizeTools(options.tools);
  const hookProfile = normalizeHookProfile(options.hookProfile);
  const changes = [];
  const managedFiles = [];
  const normalizedOptions = {
    ...options,
    projectRoot,
    hookProfile,
    managedFiles,
  };

  await ensureHarnessState(projectRoot);
  await upsertTextBlockFile(cjoin(projectRoot, 'AGENTS.md'), 'AGENTS', agentContractBody(), normalizedOptions, changes);

  if (tools.includes('codex')) {
    await writeCodexAdapter(projectRoot, normalizedOptions, changes);
  }
  if (tools.includes('claude')) {
    await writeClaudeAdapter(projectRoot, normalizedOptions, changes);
  }
  if (tools.includes('cursor')) {
    await writeCursorAdapter(projectRoot, normalizedOptions, changes);
  }
  const manifest = await writeInstallManifest(projectRoot, normalizedOptions, changes, tools);

  const doctor = await doctorOpenPrdAgentIntegration(projectRoot, {
    tools,
    enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
    codexHome: options.codexHome,
    hookProfile,
  });
  return {
    ok: doctor.ok,
    action: options.action ?? 'setup',
    projectRoot,
    tools,
    hookProfile,
    changes,
    manifest,
    doctor,
  };
}

export async function updateOpenPrdAgentIntegration(projectRoot, options = {}) {
  return setupOpenPrdAgentIntegration(projectRoot, { ...options, action: 'update' });
}

async function fileHas(filePath, pattern) {
  const text = await readText(filePath).catch(() => '');
  return text.includes(pattern);
}

async function collectDoctorCheck(projectRoot, checks, pathName, predicate, message) {
  const absolutePath = cjoin(projectRoot, pathName);
  const ok = await predicate(absolutePath);
  checks.push({ path: pathName, ok, message: ok ? 'ok' : message });
}

async function collectDoctorCheckAbsolute(checks, pathName, absolutePath, predicate, message) {
  const ok = await predicate(absolutePath);
  checks.push({ path: pathName, ok, message: ok ? 'ok' : message });
}

function codexHookSmokePayload(projectRoot, eventName, smokeId) {
  if (eventName === 'SessionStart') {
    return { cwd: projectRoot, session_id: smokeId };
  }
  if (eventName === 'UserPromptSubmit') {
    return { cwd: projectRoot, prompt: `OpenPrd doctor hook smoke ${smokeId}` };
  }
  if (eventName === 'PreToolUse') {
    return {
      cwd: projectRoot,
      tool_name: 'Read',
      tool_input: {
        file_path: '.openprd/state/current.json',
      },
    };
  }
  if (eventName === 'PostToolUse') {
    return {
      cwd: projectRoot,
      tool_name: 'Read',
      tool_input: {
        file_path: '.openprd/state/current.json',
      },
      tool_response: {},
    };
  }
  return { cwd: projectRoot };
}

function validateCodexHookSmokeOutput(eventName, run) {
  if (run.error) {
    return `Codex hook smoke failed for ${eventName}: ${run.error.message}`;
  }
  if (run.status !== 0) {
    return `Codex hook smoke failed for ${eventName}: exit ${run.status}; ${String(run.stderr ?? '').trim() || 'no stderr'}`;
  }

  let output;
  try {
    output = JSON.parse(String(run.stdout ?? '').trim());
  } catch (error) {
    return `Codex hook smoke emitted invalid JSON for ${eventName}: ${error.message}`;
  }

  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return `Codex hook smoke emitted a non-object payload for ${eventName}.`;
  }

  const legacyFields = LEGACY_CODEX_HOOK_OUTPUT_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(output, field));
  if (legacyFields.length > 0) {
    return `Codex hook smoke emitted legacy fields for ${eventName}: ${legacyFields.join(', ')}`;
  }

  if (output.continue !== true) {
    return `Codex hook smoke omitted continue=true for ${eventName}.`;
  }

  if (output.hookSpecificOutput !== undefined) {
    if (!output.hookSpecificOutput || typeof output.hookSpecificOutput !== 'object' || Array.isArray(output.hookSpecificOutput)) {
      return `Codex hook smoke emitted invalid hookSpecificOutput for ${eventName}.`;
    }
    if (output.hookSpecificOutput.hookEventName !== eventName) {
      return `Codex hook smoke emitted hookSpecificOutput.hookEventName=${output.hookSpecificOutput.hookEventName ?? 'null'} for ${eventName}.`;
    }
  }

  return null;
}

async function smokeTestCodexHook(projectRoot, options = {}) {
  const hookPath = cjoin(projectRoot, '.codex', 'hooks', 'openprd-hook.mjs');
  if (!(await exists(hookPath))) {
    return { ok: false, message: 'Codex hook runner is missing.' };
  }

  const smokeId = `doctor-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-hook-smoke-'));
  try {
    for (const eventName of hookEventsForProfile(options.hookProfile)) {
      const run = spawnSync(process.execPath, [hookPath, eventName], {
        cwd: smokeRoot,
        input: JSON.stringify(codexHookSmokePayload(smokeRoot, eventName, smokeId)),
        encoding: 'utf8',
        timeout: 15000,
        env: {
          ...process.env,
          OPENPRD_CLI: process.env.OPENPRD_CLI || cjoin(PACKAGE_ROOT, 'bin', 'openprd.js'),
        },
      });
      const error = validateCodexHookSmokeOutput(eventName, run);
      if (error) {
        return { ok: false, message: error };
      }
    }

    return { ok: true, message: 'ok' };
  } finally {
    await fs.rm(smokeRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export async function doctorOpenPrdAgentIntegration(projectRoot, options = {}) {
  const tools = normalizeTools(options.tools);
  const checks = [];
  await ensureHarnessState(projectRoot);
  const manifest = await readInstallManifest(projectRoot);
  const hookProfile = normalizeHookProfile(options.hookProfile ?? manifest?.hooks?.profile);

  await collectDoctorCheck(projectRoot, checks, 'AGENTS.md', (file) => fileHas(file, 'OPENPRD:AGENTS:START'), 'Missing OpenPrd managed AGENTS block.');
  await collectDoctorCheck(projectRoot, checks, OPENPRD_HARNESS_MANIFEST, (file) => fileHas(file, '"managedFiles"'), 'Missing OpenPrd install manifest.');
  await collectDoctorCheck(projectRoot, checks, OPENPRD_HARNESS_HOOK_STATE, (file) => fileHas(file, '"version"'), 'Missing OpenPrd hook state.');
  await collectDoctorCheck(projectRoot, checks, OPENPRD_HARNESS_EVENTS, (file) => exists(file), 'Missing OpenPrd harness events log.');

  if (tools.includes('codex')) {
    await collectDoctorCheck(projectRoot, checks, '.codex/config.toml', (file) => fileHas(file, 'codex_hooks = true'), 'Codex hooks feature is not enabled.');
    await collectDoctorCheck(projectRoot, checks, '.codex/hooks.json', (file) => fileHas(file, 'openprd-hook.mjs'), 'Codex hooks.json is missing OpenPrd hooks.');
    await collectDoctorCheck(projectRoot, checks, '.codex/hooks/openprd-hook.mjs', (file) => fileHas(file, 'OpenPrd harness 上下文'), 'Codex hook runner is missing.');
    const smoke = await smokeTestCodexHook(projectRoot, { hookProfile });
    checks.push({ path: '.codex/hooks/openprd-hook.mjs:smoke', ok: smoke.ok, message: smoke.message });
    await collectDoctorCheck(projectRoot, checks, '.codex/skills/openprd-harness/SKILL.md', (file) => fileHas(file, 'OPENPRD:GENERATED'), 'Codex OpenPrd harness skill is missing.');
    await collectDoctorCheck(projectRoot, checks, '.codex/skills/openprd-learning-review/SKILL.md', (file) => fileHas(file, 'OPENPRD:GENERATED'), 'Codex OpenPrd learning review skill is missing.');
    if (options.enableUserCodexConfig) {
      const userConfigPath = cjoin(resolveCodexHome(options), 'config.toml');
      await collectDoctorCheckAbsolute(checks, displayPath(userConfigPath), userConfigPath, (file) => fileHas(file, 'codex_hooks = true'), 'User Codex config has not enabled hooks.');
    }
  }
  if (tools.includes('claude')) {
    await collectDoctorCheck(projectRoot, checks, 'CLAUDE.md', (file) => fileHas(file, 'OPENPRD:CLAUDE:START'), 'Missing OpenPrd managed CLAUDE block.');
    await collectDoctorCheck(projectRoot, checks, '.claude/skills/openprd-harness/SKILL.md', (file) => fileHas(file, 'OPENPRD:GENERATED'), 'Claude OpenPrd harness skill is missing.');
    await collectDoctorCheck(projectRoot, checks, '.claude/skills/openprd-learning-review/SKILL.md', (file) => fileHas(file, 'OPENPRD:GENERATED'), 'Claude OpenPrd learning review skill is missing.');
    await collectDoctorCheck(projectRoot, checks, '.claude/commands/openprd/next.md', (file) => fileHas(file, 'OPENPRD:GENERATED'), 'Claude OpenPrd next command is missing.');
  }
  if (tools.includes('cursor')) {
    await collectDoctorCheck(projectRoot, checks, '.cursor/rules/openprd.mdc', (file) => fileHas(file, 'OPENPRD:GENERATED'), 'Cursor OpenPrd rule is missing.');
    await collectDoctorCheck(projectRoot, checks, '.cursor/commands/openprd-next.md', (file) => fileHas(file, 'OPENPRD:GENERATED'), 'Cursor OpenPrd next command is missing.');
  }
  const drift = await computeDriftReport(projectRoot, tools);
  for (const error of drift.errors) {
    checks.push({ path: OPENPRD_HARNESS_DRIFT, ok: false, message: error });
  }

  return {
    ok: checks.every((check) => check.ok),
    action: 'doctor',
    projectRoot,
    tools,
    hookProfile,
    checks,
    drift,
    errors: checks.filter((check) => !check.ok).map((check) => `${check.path}: ${check.message}`),
  };
}
