import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { renderApprovedBenchmarkRegistrySection } from './benchmark.js';
import { timestamp } from './time.js';
import { upsertWorkspaceRegistryEntry } from './workspace-registry.js';

const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OPENPRD_AGENT_TOOLS = ['codex', 'claude', 'cursor'];
const OPENPRD_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];
const OPENPRD_HOOK_PROFILES = {
  lite: ['UserPromptSubmit', 'PreToolUse', 'Stop'],
  guarded: ['UserPromptSubmit', 'PreToolUse', 'Stop'],
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
    id: 'openprd-router',
    description: 'OpenPrd 入口路由 skill：先判断当前任务该读哪个 skill、哪个命令面和哪个门禁。',
    body: [
      '# OpenPrd Router',
      '',
      '把这份 skill 当成 OpenPrd 的入口路由，而不是长文规则仓库。',
      '',
      '## 先做什么',
      '',
      '1. 先读 `.openprd/` 当前状态，并把 `openprd run . --context` 当作建议上下文，而不是自动执行指令。',
      '2. 需要具体命令时，优先读取 `.openprd/harness/command-catalog.md`，不要把命令清单继续塞回 `AGENTS.md`。',
      '3. 需要共用约束时，读 `$openprd-shared`；需要主工作流时，读 `$openprd-harness`。',
      '',
      '## 路由表',
      '',
      '- 主工作流、需求入口、review/change/tasks、`run/loop`：`$openprd-harness`',
      '- 最佳实践、benchmark、公开 GitHub 仓库、第三方技术事实、prompt/context engineering：`$openprd-benchmark-router`',
      '- `docs/basic/`、文件说明书、文件夹 README、文档标准：`$openprd-standards`',
      '- 就绪验证、EVO 门禁、HTML 质量评估报告、项目经验沉淀：`$openprd-quality`',
      '- 架构图、产品流程图、可视化评审：`$openprd-diagram-review`',
      '- 长时间只读挖掘、参考项目持续调研、requirements/specs/tasks 补全：`$openprd-discovery-loop`',
      '- 学习包、归档阅读器、知识整理：`$openprd-learning-review`',
      '',
      '## 路由原则',
      '',
      '- `AGENTS.md` 只保留轻量入口合同；详细规则放进 repo-local skills、`.openprd/harness/command-catalog.md` 和 hooks。',
      '- 公开 GitHub 仓库架构/对标先 DeepWiki；第三方库、API、SDK、MCP、CLI 用法先查本地证据，本地不足时再按 `resolve_library_id -> query_docs` 使用 Context7。',
      '- hooks 已经强制处理 requirement / research / secrets / skill-visualization / weapp / browser / copy 这些门禁；不要再把它们膨胀回 `AGENTS.md` 静态长文。',
      '',
    ].join('\n'),
  },
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
      '- 当 `locale` 为 `zh-CN` 时，diagram contract 中所有可见字段都必须使用简体中文；面向用户的 review.html 或 diagram HTML 文案不要使用 `freeze` 这类内部流程词，改写为“需求定稿前”“进入实现前确认”等业务可理解表达。',
      '- OpenPrd 用户默认懂业务和产品，但不想读技术黑话；对外输出先给结论和下一步，能一句讲清楚就不要拆成两步。',
      '- 主动替用户补全范围边界、失败路径、恢复路径、实现成本、维护成本、滥用风险和第三方依赖；默认按性价比选方案。',
      '- 涉及第三方 API、模型、云服务或付费工具时，用表格比较效果、价格、接入成本、限制、风险和推荐理由；用户明确质量优先时，提高质量和稳定性权重。',
      '- 当用户的问题包含多个对象、方案、文件、场景、风险、验证项、素材或任务，并且需要同时呈现状态、证据、影响、动作或推荐时，Agent 应主动使用 Markdown 表格，不等用户要求。先用一句话给结论，再给表格。',
      '- 表格优先用于方案对比、状态盘点、问题排查、风险审查、多对象 QA、文件/命令清单、需求场景覆盖和内容/素材规划；单一结论、单一动作、代码示例、命令示例和叙事型说明不要强行表格化。',
      '- 面向用户的时间统一使用上海时区 `YYYY-MM-DD HH:mm:ss` 格式，不带 `T`、`Z` 或毫秒。',
      '- 保持未解决假设可见，不要悄悄补脑。',
      '- 项目基线文档路径只能是 `docs/basic/`。',
      '- 声称就绪前，至少通过 `openprd validate .` 和 `openprd standards . --verify`。',
      '- 实现就绪还要运行 `openprd quality . --verify`，并审阅 HTML 质量评估报告中的场景标签、必需 EVO 门禁、可观测性、业务护栏、评估执行环境、性能和知识缺口。',
      '- 用户要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup、先看样子或先确认设计方向时，默认直接调用 Codex 原生 Image 2 生图能力产出图片；对 logo、icon、avatar、badge 等开发素材，如果用户未明确要求 mockup、场景图、设备框、卡片承载、名片/包装展示或参考界面复刻，默认按独立素材输出（standalone asset）处理：使用全画布单主体，不额外添加 UI frame、卡片、设备壳、名片、桌面陈列、手持实拍或其他展示容器。只有当用户明确要求 mockup、场景化效果图、容器化呈现，或参考图本身包含这些结构时，才生成对应容器或场景；除非用户明确指定 HTML、SVG、CSS、Canvas、代码稿或可编辑矢量/source artifact，不要改用临时 HTML/SVG/CSS 再截图。',
      '- OpenPrd 的 `review.html` 用于需求评审，不能替代图片或效果图生成；已有参考图时用 `visual-compare --reference/--actual`，无参考图但改动界面时用 `visual-compare --before/--after`。',
      '- 界面、页面、视觉、样式或前端体验开发中，只要已经有效果图、设计稿、图片资产或用户给图并进入实现阶段，阶段性完成后必须先截实现图，再运行 `openprd visual-compare . --reference <效果图> --actual <实现截图>` 生成左右对比 JPG。左侧标注“效果图”，右侧标注“实现截图”；Agent 必须查看合成图并继续对标，直到没有明显视觉差异，不能只凭主观判断宣称完成。没有参考图但改动界面时，必须先截“修改前”，实现后用同一入口、视口、账号和数据状态截“修改后”，再运行 `openprd visual-compare . --before <修改前截图> --after <修改后截图>` 生成自检 JPG，检查预期变化和未改区域漂移。',
      '- 看到生成文件疑似过期时，先运行 `openprd doctor .`。',
      '- OpenPrd 自身及随包 workspace / template / skill README 默认把简体中文放在 `README.md`，英文放在 `README_EN.md`；如需兼容旧链接，可保留 `README_CN.md` 作为跳转入口。',
      '- `openprd run . --context` 只是建议。规划、分析、review、影响范围说明等请求保持只读，除非当前用户消息明确要求开发、实现、继续任务、深度调研、对标复刻或 commit/push。',
      '- 用户给出会话 ID 并要求继续时，按工具无关的历史会话精确续接；不要要求或使用工具专属 ID；当前 active change、相似历史或 requirement gate 只能作为背景，不能替代该会话 ID。',
      '- 代码修改完成后、最终回复前，针对本轮实际 touched code files 运行 `openprd dev-check . <file...>` 或 `node scripts/openprd-dev-check.mjs . <file...>`；700 行以内正常，701-1500 行需说明局部职责，超过 1500 行要判断本轮是否扩大职责，扩大则先重构/拆分/解耦并复查，窄 bugfix 或小修暂不拆时说明原因和后续拆分建议。',
      '- 执行中发现配置缺口、未知代码扩展名、可复用豁免、命令习惯或用户偏好时，先沉淀为 `.openprd/growth` 候选并运行 `openprd grow . --review`；共享规则必须经用户确认后再 apply。',
      '- 维护 OpenPrd 本身时，只要新增或修改配置类能力（阈值、规则、识别、豁免、命令别名、环境差异、用户偏好或策略开关），都要做 grow-aware 自检：高置信应可成长时默认纳入 `openprd grow`；不确定时主动问用户；明确一次性或固定规则时才保持静态配置。',
      '- 只要实现新增或修改文件，就做文档影响检查；缺失的 `docs/basic/`、文件说明书和文件夹 README 要补齐，已有文档受影响时要更新。',
      '- 涉及后端、脚本、Agent、工具链、服务或数据处理变更时，把 CLI 与 API 视为同级接入面：检查命令入口、参数、输出契约、`help`、`doctor`、`dry-run`、`status` 与接口协议、返回结构、身份边界是否受影响，并同步更新 `docs/basic/backend-structure.md`；若某一面不适用也要明确写原因。',
      '- Codex hooks 默认使用 `lite`：`UserPromptSubmit` 注入上下文、轻量 `PreToolUse` 写入门禁，以及 `Stop` 本轮收工回顾。只有项目明确需要更重的工具级遥测时，才切到 `full`。',
      '- 先按复杂度分流：L0 小修（空格、错别字、按钮文案、简单样式、明确 bugfix）直接处理并事后说明；L1 中等改动先给对话内 mini-plan 再执行；L2 新产品、模块、流程需求在改代码前必须先完成需求入口：clarify、评审、任务拆解。`review --mark confirmed` 只记录稳定评审稿确认；如果用户刚刚已经确认了现有功能优化（L1）的 mini-plan、范围边界或正式产品边界，后续承接要明确写成“已确认，我按这个继续/收口/落地”，不要用“确认，我们就按这个……”这类像再次索取确认的句子。如果用户原始意图已经明确要求实现，tasks 就绪后可直接进入执行；否则在请求执行授权前，先输出执行确认清单，列出本轮目标、将执行内容、不做事项、验证方式和已知风险，不能只要求用户回复一句确认。',
      '- 涉及最佳实践、benchmark、对标、参考产品、prompt engineering、Agent harness、context engineering、图标资源、CLI 或 skill 体系设计时，先使用 `$openprd-benchmark-router` 选择证据源，再进入 Context7、DeepWiki 或官方资料调研。',
      '- 入口路由优先看 `$openprd-router`；具体命令速查优先看 `.openprd/harness/command-catalog.md`。',
      '- `AGENTS.md` 只保留轻量合同；详细执行细则优先沉淀到 repo-local skills、command catalog 和 hooks。',
      '- 任务需要 API key、token、账号信息、第三方服务凭证或个人信息时，先使用 `secrets-vault` skill，且不要直接读取原始 vault 文件。',
      '- 修改 skill、`SKILL.md`、`AGENTS.md` 或相关 workflow 前，先读取现状、输出彩色 Mermaid 方案图，并等待用户确认后再编辑相关文件。',
      '- 涉及微信小程序测试、验证、截图、日志、网络请求、开发者工具自动化或运行态相关改动时，先使用 `weapp-dev-mcp` skill；未通过本地 MCP 实际验证时，不要宣称“小程序已验证”。',
      '- 用户明确要求 Computer Use 时优先使用 Computer Use，并尽量在 Codex-owned browser window 中操作；对提交、删除、发送、切换账号、退出登录、支付、关闭标签页等高风险网页动作先确认窗口归属。',
      '- 修改用户可见文案前，先检查 `i18n`、`locales`、`translations`、`Localizable` 或其他语言资源；若项目已有多语言结构，用户可见文案要同步维护到所有已支持语言，并避免暴露 API、SDK、模型、数据库、缓存或错误码等实现细节。',
      '',
      '## 写入纪律',
      '',
      '- 只读命令优先：`status`、`next`、`validate`、`standards --verify`、`doctor`。',
      '- 下一道门禁没看清之前，不要贸然执行写入命令。',
      '- 面对规划、分析、审查类请求，不要运行 `openprd loop --run`、`openprd tasks --advance`、`openprd discovery --advance`、`openprd loop --finish --commit`、git commit 或 git push。',
      '- 代码改动完成后，要回顾 `openprd dev-check` 输出；若出现 `attention` 或 `warning`，说明是否已局部处理、是否已拆分，或为什么窄修暂不拆。',
      '- 代码改动完成后，要回顾 `openprd grow . --review`；只说明待确认候选，不要把未确认候选描述成已固化规则。',
      '- 代码改动完成后，要说明 `docs/basic/`、文件说明书和文件夹 README 是新增、更新还是有意不变。',
      '- 用户要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup、先看样子或先确认设计方向时，最终回复应给出 Image 2 生成的图片结果；如果是 logo、icon、avatar、badge 等开发素材且用户未明确要求 mockup 或场景化呈现，默认给出独立素材输出结果。进入实现阶段后，有参考图时给出 `openprd visual-compare --reference/--actual` 生成的 JPG 路径并说明差异；无参考图但改动界面时给出 `openprd visual-compare --before/--after` 生成的修改前后 JPG 路径并说明预期变化和漂移检查结果。',
      '- `freeze`、`handoff`、`change --apply`、`change --archive`、commit、push、release、publish 等高风险动作都要求前置门禁全绿。',
      '',
      '## 修复路径',
      '',
      '1. 运行 `openprd doctor .`。',
      '2. 如果生成引导或 hooks 漂移，运行 `openprd update .`。',
      '3. 运行 `openprd standards . --verify` 并修复文档标准。',
      '4. 运行 `openprd quality . --verify` 并审阅 HTML 质量评估报告；若 `productionReady=false`，最终回复必须列出缺证据或需关注的必需 EVO 门禁。',
      '5. 报告就绪前运行 `openprd validate .`。',
      '',
    ].join('\n'),
  },
  {
    id: 'openprd-benchmark-router',
    description: '为 OpenPrd 产品、CLI、Agent harness、AI code review / PR review harness、上下文工程、提示词优化和图标资源选择对标来源与调研路径。',
    body: [
      '# OpenPrd Benchmark Router',
      '',
      '当用户要求最佳实践、benchmark、对标、参考设计、产品优化、CLI 优化、Agent harness 优化、AI code review / PR review harness、上下文工程、提示词工程或图标资源时，先使用这份 skill。',
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
      '- 用户提到 OpenPrd、OpenSpec、Superpowers、Anthropic Skills、Lark CLI、Agent harness、AI code review、PR review、review lane、long-running agents、context engineering、prompt engineering、最佳实践、对标、参考、复刻或优化设计。',
      '- 用户提到图标、icon、图标站、图标库、图标资源、UI 图标、AI 图标、技术图标、3D 图标、功能图标、iconfont 或视觉资产参考。',
      '- 用户要求解释某个 Codex / Claude / Cursor agent 为什么没有发现 skill，或希望提升 skill 自动识别、路由、生成、安装和持续执行能力。',
      '- 用户没有显式说 skill 名也要触发；不要要求用户记住 `$openprd-benchmark-router`。',
      '',
      '## 路由流程',
      '',
      '1. 先识别优化对象：OpenPrd 产品/PRD 流程、CLI、skill 体系、长程任务、通用 harness、AI code review / PR review harness、context engineering、prompt engineering、图标资源或图标实现库。',
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
      '- GitHub 仓库：需要理解架构、核心模块、关键流程或对标结论时，先用 DeepWiki。默认顺序是 `read_wiki_structure` 1 次，再 `ask_question` 1-2 次；只有在本地源码和已有结论仍不足时才追加。DeepWiki 不可用或覆盖不足时，再回退到 GitHub README、源码和官方文档。',
      '- 官方技术文档：涉及第三方库、框架、API、SDK、MCP、CLI 工具的用法、配置、限制、版本差异或迁移路径时，先检查本地代码、锁文件、README、类型定义；本地不足时再用 Context7，默认顺序是 `resolve_library_id` 1 次，再 `query_docs` 1-2 次。Context7 不足时说明缺口，再补官方文档、源码或其他一手资料。',
      '- 工程文章和产品文档：优先读取当前线上一手页面，只抽取和当前任务相关的观点与设计原则，不复制长文；如果内容可能过时，要说明时效风险。',
      '- 本地源码优先：当前工作区已经有相关源码时，常规修 bug、查实现、改功能优先读本地代码；DeepWiki 主要用于外部仓库架构理解和对标分析。',
      '- 停止调研：找到足以支持当前决策的 1-3 个高相关来源后停止扩展；候选来源重复时保留更权威、更新或更贴近当前任务的来源。',
      '- 追加调用前先写清“已确认什么、还缺什么”；不要为了同一问题只换个说法反复查询。',
      '',
      '## Source Map',
      '',
      '- OpenPrd / PRD 设计对标：`obra/superpowers`、`Fission-AI/OpenSpec`。',
      '- CLI 与 skill 体系对标：`larksuite/cli`、`anthropics/skills`、Claude Skills 官方文档、Claude Code Skills 官方文档。',
      '- 长程 Agent 任务：Anthropic long-running agents harness 工程文章。',
      '- 通用 harness：OpenAI harness engineering、LangChain agent harness anatomy。',
      '- AI code review / PR review harness：Nolan Lawson 的 “Using AI to write better code more slowly”、Milvus 关于多模型代码审查辩论/交叉验证的实验文章。',
      '- Context engineering：Manus context engineering、Anthropic context engineering。',
      '- Prompt engineering：OpenAI prompt engineering / prompt guidance、Claude prompt engineering、Gemini prompting strategies。',
      '- 图标资源站一级最佳实践：UI 图标优先看 Phosphor Icons（https://phosphoricons.com/）；AI 公司与产品图标看 LobeHub Icons（https://lobehub.com/icons）；技术栈图标看 Tech Icons（https://techicons.dev/）；透明底 3D 图标看 Thiings（https://www.thiings.co/things）；功能图标、矢量插画、3D 插画和字体资源看 iconfont（https://www.iconfont.cn/）。',
      '- 图标实现库二级最佳实践：Lucide、Tabler、React Icons。需要落到前端代码时，再结合当前项目框架、包管理器、bundle 体积和导入方式选择具体库。',
      '',
      '## Evaluation Lenses',
      '',
      '- 产品与工作流：用户从哪里开始、如何知道下一步、模糊输入如何变成结构化产物、哪些步骤要保存/展示/恢复、哪些步骤必须保留用户确认。',
      '- Agent 与 Harness：目标、边界、停止条件、工具选择、进度记录、证据、验证结果、失败恢复和人工接管点是否清楚。',
      '- PR 审查 lane：reviewer 是否独立审查、主代理是否先汇总再验证、是否有误报过滤、agreement matrix、严重级别和 merge recommendation。',
      '- 上下文工程：哪些信息常驻、哪些按需检索，是否使用稳定路径、链接和来源 ID 支持 just-in-time 检索，如何处理过期、冲突和可信度。',
      '- 提示词与 Skill 设计：触发描述是否具体但不过度强制，主说明是否短，细节是否按需放到 reference，是否明确不要硬套参考源。',
      '- 图标与视觉资产：先判断用途是 UI、AI 品牌、技术栈、3D 物件还是功能图标；优先选最贴近用途的资源站，再在实现阶段选择合适的代码图标库。',
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
      '- 会话 ID 续接：用户给出会话 ID 并要求继续时，把它当成工具无关的历史会话续接请求；先精确恢复该会话历史，不要把当前 active change、相似历史或当前 requirement gate 当成替代目标，也不要把它称为工具专属 ID。',
      '3. 面对规划、分析、架构评审、“怎么改”或“会动哪些文件”类请求，保持只读并基于代码、文档和状态回答。',
      '4. 需要完整工作流细节时，运行 `openprd status .` 和 `openprd next .`。',
      '5. 涉及最佳实践、benchmark、对标、参考产品、prompt engineering、Agent harness、context engineering、图标资源、CLI 或 skill 体系设计时，先使用 `$openprd-benchmark-router`。',
      '6. 先做 L0/L1/L2 分流：L0 小修直接处理并事后说明；L1 给对话内 mini-plan 后执行；L2 新产品、模块、流程需求在改代码前必须先走需求入口：`openprd clarify .` 会生成需求入口自省，并只在对话内输出澄清摘要或简短清单；正式 HTML 评审留给后续 review。',
      '7. 事实缺失时，用 `openprd clarify .` 和 `openprd capture .` 补全，再 synthesize/review、生成或检查 change、拆任务。`clarifyPresentation.mode` 为 `inline` 或 `inline-with-checklist`，直接在对话中用目标、范围、非目标和验收方式压缩确认，不打开澄清 HTML。review 重点摘要胶囊应控制在 15 个字以内，作为扫读标签，不写成长句；对用户给稳定 artifact 路径，确认命令使用页面复制出的 `--version`、`--digest` 和 `--work-unit`，不要把可被其他对话覆盖的 active review 当成唯一确认入口，也不要把“可以开做”“继续实现”之类实现授权当成 `review --mark confirmed` 的依据。如果 synthesize 被简体中文 spec 预检阻断，先把纯内部措辞整理用 `openprd capture . --source agent-normalized` 写回，再重新 synthesize；这类非语义规范化不应重开用户 review。默认 approval policy 是 decision-points：需要时保留稳定 `review.html`，但只有当前 lane 仍要求人类决策时才停下来请求确认；如果用户一开始就明确要求直接做且不需要再评审/确认，则允许按当前稳定 artifact 的精确 `version + digest + work-unit` 记录 review，再继续 change/tasks。若用户刚刚已经确认了现有功能优化（L1）的 mini-plan、范围边界或正式产品边界，后续承接要写成“已确认，我按这个继续”，不要写成“确认，我们就按这个……”这类像再次索取确认的句子。若用户原始意图已明确要求实现，则在当前 approval policy 满足且 tasks 就绪后直接进入执行；否则先输出执行确认清单，列出本轮目标、将执行内容、不做事项、验证方式和已知风险，再请求明确执行授权，不能只要求用户回复一句确认。',
      '8. 评审页里的需求关系图、需求流程图和重点摘要不要靠 HTML 截断；先用 `openprd review-presentation . --template` 查看展示文案契约，让 Agent 按 reviewPresentation 写短文案，再用 `openprd review-presentation . --presentation <json> --write --fail-on-violation` 校验并写回。超限时重新提炼，不裁剪原文。',
      '9. 对外说明默认用业务和产品语言，先给结论和下一步；涉及第三方 API、模型、云服务或付费工具时，用表格比较多家方案的效果、价格、接入成本、限制、风险和推荐理由，默认选择性价比最优；当用户的问题包含多个对象、方案、文件、场景、风险、验证项、素材或任务，并且需要同时呈现状态、证据、影响、动作或推荐时，主动使用 Markdown 表格，单一结论、代码示例、命令示例和叙事型说明不要强行表格化。',
      '10. 当 PRD 需要进入实现准备时，再运行 `openprd change . --generate --change <id>`。',
      '11. 长程实现使用 `openprd loop . --plan --change <id>`，并且只有用户明确要求开发、继续任务、深度调研、对标复刻或 commit 时才执行单任务 fresh session。',
      '12. 代码修改完成后、最终回复前，针对本轮实际 touched code files 运行 `openprd dev-check . <file...>` 或 `node scripts/openprd-dev-check.mjs . <file...>` 回顾行数状态：700 行以内正常，701-1500 行需说明局部职责，超过 1500 行要判断本轮是否扩大职责，扩大则先重构/拆分/解耦并复查，窄 bugfix 或小修暂不拆时说明原因和后续拆分建议。',
      '13. 如果执行中发现新代码后缀、豁免路径、命令别名、项目约定或用户偏好，应形成 growth candidate；先运行 `openprd grow . --review`，确认后再 `openprd grow . --apply --id <candidate-id>`，不要静默修改共享规则。',
      '14. 维护 OpenPrd 本身时，只要新增或修改配置类能力（阈值、规则、识别、豁免、命令别名、环境差异、用户偏好或策略开关），默认先做 grow-aware 自检：高置信应可成长时直接纳入 `openprd grow` 体系；不确定时主动询问用户是否做成可成长配置。',
      '15. 实现过程中，每次新增或修改文件都做文档影响检查，补齐缺失的 `docs/basic/`、文件说明书和文件夹 README，并更新受影响文档；涉及后端、脚本、Agent、工具链、服务或数据处理变更时，把 CLI 与 API 视为同级接入面：同步检查命令入口、参数、输出契约、`help`、`doctor`、`dry-run`、`status` 与接口协议、返回结构、身份边界是否受影响，并更新 `docs/basic/backend-structure.md` 或明确写不适用原因。',
      '16. 用户要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup、先看样子或先确认设计方向时，默认直接调用 Codex 原生 Image 2 生图能力产出图片；对 logo、icon、avatar、badge 等开发素材，如果用户未明确要求 mockup、场景图、设备框、卡片承载、名片/包装展示或参考界面复刻，默认按独立素材输出（standalone asset）处理：使用全画布单主体，不额外添加 UI frame、卡片、设备壳、名片、桌面陈列、手持实拍或其他展示容器。只有当用户明确要求 mockup、场景化效果图、容器化呈现，或参考图本身包含这些结构时，才生成对应容器或场景；除非用户明确指定 HTML、SVG、CSS、Canvas、代码稿或可编辑矢量/source artifact，不要改用临时 HTML/SVG/CSS 再截图。OpenPrd 的 `review.html` 只用于需求评审，不能替代图片或效果图生成。',
      '17. 界面、页面、视觉、样式或前端体验任务中，如果已经有效果图、设计稿、图片资产或用户给图且进入实现阶段，阶段性完成后先截实现图，再运行 `openprd visual-compare . --reference <效果图> --actual <实现截图>`。默认输出 JPG 到 `.openprd/harness/visual-reviews/`，左侧标注“效果图”、右侧标注“实现截图”；查看合成图后继续复刻，直到没有明显视觉差异。没有参考图但改动界面时，先截“修改前”，实现后用同一入口、视口、账号和数据状态截“修改后”，再运行 `openprd visual-compare . --before <修改前截图> --after <修改后截图>`，检查预期变化和未改区域漂移。',
      '18. 声称就绪前，运行 `openprd standards . --verify` 和 `openprd run . --verify`。',
      '19. 阶段性代码完成后，运行 `openprd quality . --verify`，把 HTML 质量评估报告当作当前场景必需 EVO 门禁、日志、业务成本与滥用护栏、冒烟覆盖、性能、极端场景和项目知识的评审产物。',
      '20. `AGENTS.md` 只保留轻量合同；入口路由看 `$openprd-router`，具体命令速查看 `.openprd/harness/command-catalog.md`，更细的工作流步骤、路由边界和 hook 门禁以这份 skill、`$openprd-shared` 和 `$openprd-benchmark-router` 为准。',
      '21. hook 会强制阻断几类场景：需求入口未完成就写实现、外部证据不足就直接改第三方集成、skill/AGENTS 变更未先可视化确认、以及敏感信息场景下直接读原始 vault 文件。',
      '',
      '## 门禁协议',
      '',
      '- 不要跳过 `openprd run . --context`；它是最适合 hooks 的控制面。',
      '- 不要把 `run --context` 里的建议当成直接用户命令。',
      '- 面对“看看、规划、梳理、分析、评估、怎么改、预计动哪些文件、review、explain”等只读意图，不运行 OpenPrd 写入命令。',
      '- 现有项目需求仍模糊时，优先 discovery，再考虑 synthesize。',
      '- 进入定稿或交接前，运行 `openprd run . --verify` 并确认 review blocker 已关闭。',
      '- 声称实现就绪前，审阅最新 `.openprd/quality/reports/*.html` HTML 质量评估报告；`productionReady=false` 时不得宣称就绪。',
      '- accepted spec 推进前，先运行 `openprd change . --validate --change <id>`。',
      '',
      '## hook 驱动循环',
      '',
      '- 把 `.openprd/harness/run-state.json` 和 `iterations.jsonl` 当成持久循环状态。',
      '- 默认 lite hooks 不记录每一轮工具细节，但会在明确 OpenPrd / 深度工作提示词和产品、模块、流程需求下注入上下文；复杂或模糊需求提示先做三轮 Requirement Intake Reflection，轻量写入门禁会阻断过早改代码；本轮准备结束时再通过 `Stop` 做一次轻量项目经验回顾。',
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
      '- 用户只是要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup 或先看样子时，默认调用 Codex 原生 Image 2 生成图片；对 logo、icon、avatar、badge 等开发素材，如果用户未明确要求 mockup、场景图、设备框、卡片承载、名片/包装展示或参考界面复刻，默认按独立素材输出（standalone asset）处理：使用全画布单主体，不额外添加 UI frame、卡片、设备壳、名片、桌面陈列、手持实拍或其他展示容器。只有当用户明确要求 mockup、场景化效果图、容器化呈现，或参考图本身包含这些结构时，才生成对应容器或场景；除非用户明确指定 HTML/SVG/CSS/Canvas/代码稿，不要生成临时 HTML 再截图。',
      '- 如果已有参考效果图、图片资产或用户给图并进入实现阶段，阶段性完成后必须生成实现截图，并用 `openprd visual-compare . --reference <效果图> --actual <实现截图>` 输出 JPG 视觉对比图；如果没有参考图但改动界面，先截修改前，完成后截修改后，并用 `openprd visual-compare . --before <修改前截图> --after <修改后截图>` 输出 JPG 自检图。未查看对比图、对比图仍有明显差异或未改区域漂移时，不要声称界面复刻或视觉自检完成。',
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
      '- 已有历史项目要先回填全局名册时，用 `openprd fleet <root> --sync-registry` 把已初始化的 `.openprd/` 工作区写回 `~/.openprd/registry/workspaces.jsonl`。',
      '- 用 `openprd fleet <root> --backfill-work-units` 为已有 PRD 版本补 work unit、digest 和稳定评审页。',
      '- 用 `openprd fleet <root> --update-openprd` 只刷新已经包含 `.openprd/` 的项目，并顺带补齐历史 work unit 绑定。',
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
      '研发期代码修改完成后、最终回复前，运行 `openprd dev-check . <file...>` 或 `node scripts/openprd-dev-check.mjs . <file...>`；该标准层只检查本轮实际 touched code files 的行数状态，不替代 `standards --verify`。',
      '当 dev-check 把未知扩展名识别为代码候选，或发现豁免路径、规则配置需要增量时，先用 `openprd grow . --review` 审查；用户确认后再 apply，不要直接改共享配置。',
      '维护 OpenPrd 本身时，新增或修改任何配置类能力都要检查是否应该成为 grow-aware 配置：高置信可复用、可被用户习惯影响、会随项目环境变化的配置默认纳入 `openprd grow`；不确定时主动询问用户；一次性固定规则才保留为静态配置。',
      '',
      '## 文档影响检查',
      '',
      '- 编辑前先识别本次会变化的文件、文件夹、用户流程、架构边界、依赖和产品行为。',
      '- 代码修改完成后用 dev-check 回顾行数：`ok` 可正常收尾，`attention` 需要说明局部职责，`warning` 需要判断本轮是否扩大职责；扩大则先拆分/解耦并复查，窄修暂不拆时说明原因和后续拆分建议。',
      '- 新增配置类能力时同步评审 grow-aware 入口：候选类型、scope、review/apply 行为、拒绝后不重复提示，以及 user-local 与项目共享配置的边界。',
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
      '- 阶段性实现或任务完成后，用 `openprd quality . --verify` 审查 HTML 质量评估报告里的场景标签、必需 EVO 门禁、日志、业务护栏、冒烟覆盖、性能和知识缺口。',
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
    description: '为 OpenPrd 工作区生成归档学习包、题材模板、证据清单、图文讲解模块和 HTML 电子书阅读器。',
    body: [
      '# OpenPrd Learning Review',
      '',
      '当用户希望生成复盘学习包、题材模板库、证据清单、图文讲解模块、检索模块、工作示例或 OpenPrd 工作区里的 HTML 电子书阅读器时，使用这份 skill。',
      '',
      '## 产出物',
      '',
      '- `learning-content.json`：版本化内容契约',
      '- `evidence-manifest.json`：source id、digest、摘录、claim 和缺口',
      '- `learning-content.md`：书籍式阅读稿',
      '- `reader.html`：固定电子书阅读器界面，支持章节级 `visualExplainer` 图卡',
      '- `assets/`：可选图片素材目录，用于归档 Codex Image 2 生成的图文解释图片',
      '- `learning-package.json` 和 `.openprd/learning/index.json`：归档元数据',
      '',
      '## 工作流程',
      '',
      '1. 从 `.openprd/` 重建状态，并识别触发源是 loop finish 还是手动请求。',
      '2. 从参考库里选择题材。主题没有特殊要求时，默认使用 `internet-product`。',
      '3. 写正文前先从工作区状态、`docs/basic` 和 loop 报告收集证据。',
      '4. 分离证据清单、叙事正文和渲染器；所有判断都必须能引用 source id。面向产品或非技术读者时，优先补 `visualExplainer` 图卡。',
      '5. 尽可能在每章加入检索模块、工作示例模块和必要的图文比喻卡。',
      '6. 把学习包归档到 `.openprd/learning/archive/<packageId>/`，并在合适时打开 `reader.html`。',
      '',
      '## 扩展规则',
      '',
      '- 新增题材时扩展参考库，不要分叉渲染器。',
      '- 契约必须版本化；`openprd.learning-content.v1` 的演进要通过新版本完成。',
      '- 任何无法追溯到来源的句子都要显式标为推断。',
      '- 把阅读器保持为稳定的 HTML 电子书界面，包含 TOC、进度、上一章/下一章控制、章节内轻量证据锚点和可选图文解释卡。',
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
      '- `openprd grow . --review`：审查执行中发现的可复用配置、规则候选或 user-local 偏好；和 `quality --learn` 互补，前者沉淀操作配置，后者沉淀已验证质量经验。',
      '',
      '## 审查契约',
      '',
      '- 场景画像：先判断当前变更是基础、前端、桌面端、后端、成本、安全、性能、极端数据还是发布交付场景，再确定必需 EVO 门禁。',
      '- 可观测性：确认中心化 logs / traces / errors、共享 trace/request/task/error id、脱敏、保留期和查询示例。',
      '- 业务护栏：涉及免费用户、额度、AI 调用、第三方 API、生成、存储或下载时，确认成本来源、用户级限制、负向验证、监控、报警和止损动作。',
      '- 评估执行环境：确认冒烟测试、任务到功能覆盖、正常性能基线和极端数据压力场景；脚本存在只代表能力，不能替代本次运行证据。',
      '- 视觉评审证据：涉及界面视觉实现且已有参考效果图时，确认 `.openprd/harness/visual-reviews/` 下存在本次 `openprd visual-compare` 输出的“效果图 / 实现截图”JPG，并且 Agent 已基于合成图复核差异；无参考图但改动界面时，确认存在“修改前 / 修改后”JPG，并已检查预期变化和未改区域漂移。',
      '- HTML 报告：把 `.openprd/quality/reports/*.html` 当成面向人的评审产物，而不是次级导出。',
      '- 知识沉淀：当某个已验证修复具备重复性、高影响、隐藏性或由 agent 误判引发时，把模式抽象到 `.openprd/knowledge/skills/<skill>/SKILL.md`。',
      '- 自我成长：当问题来自配置缺口、文件识别、命令习惯或用户偏好时，优先记录为 `.openprd/growth` 候选，经用户确认后固化；不要把个人偏好混进项目共享质量经验。',
      '',
      '## 就绪规则',
      '',
      '- `openprd run . --verify` 中只要质量报告 `productionReady=false`，就不能宣称整体就绪。',
      '- UI 任务有参考图但缺少 visual-compare 输出时，不要宣称视觉实现完成；无参考图的 UI 改动缺少修改前后截图对比时，不要宣称视觉自检完成；如果对比图仍有明显偏差或漂移，先返工而不是把差异留给用户发现。',
      '- 最终回复必须列出未通过的必需 EVO 门禁；场景可选门禁可以说明为 advisory，但不能混同为已通过。',
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
      '- 面向用户的 review.html 或 diagram HTML 文案不要使用 `freeze` 这类内部流程词，改写为“需求定稿前”“进入实现前确认”等业务可理解表达。',
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
    id: 'grow',
    title: 'OpenPrd Grow',
    body: [
      'Run `openprd grow . --review` after implementation or dev-check. When maintaining OpenPrd itself, treat new configuration-like capabilities as grow-aware by default when confidence is high; ask the user when uncertain. Apply only user-confirmed candidates with `openprd grow . --apply --id <candidate-id>`; reject unsuitable candidates with `openprd grow . --reject --id <candidate-id>`.',
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
      'Run `openprd run . --verify`. It verifies standards, workspace validation, the currently focused change structure (not just the global active change), and active discovery state, then reports `taskReady` separately from `workspaceReady`.',
    ].join('\n'),
  },
  {
    id: 'visual-compare',
    title: 'OpenPrd Visual Compare',
    body: [
      'When UI work has a reference effect image or user-provided design, capture the implemented UI screenshot, then run `openprd visual-compare . --reference <effect-image> --actual <implementation-screenshot>`.',
      'When UI work has no reference image, capture the before screenshot first, implement the change, capture the after screenshot from the same entry, viewport, account, and data state, then run `openprd visual-compare . --before <before-screenshot> --after <after-screenshot>`.',
      'The command creates a side-by-side JPG under `.openprd/harness/visual-reviews/` by default, with Simplified Chinese labels: `效果图` / `实现截图` for reference mode or `修改前` / `修改后` for before/after mode.',
      'Inspect the generated image and keep iterating until there are no obvious visual differences or unintended drift before claiming completion.',
    ].join('\n'),
  },
  {
    id: 'run',
    title: 'OpenPrd Run',
    body: [
      'Use the hook-stable OpenPrd execution loop. Start with `openprd run . --context`, execute the recommended task/discovery/workflow action, then run `openprd run . --verify` before claiming completion.',
      'When the user gives a historical session ID, task handle, work unit, or a clear requirement/task description, pass `--message <user-prompt>` so `run --context` resolves that explicit target before considering the global active change. Treat session IDs as tool-neutral; do not require or invent tool-specific ID syntax.',
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
      'Audit or update historical projects. Start with `openprd fleet <root> --dry-run`; use `--sync-registry` to backfill the global workspace registry, `--backfill-work-units` for historical PRD identity binding, `--update-openprd` only for projects that already have `.openprd/`, and reserve `--setup-missing` for explicitly selected projects.',
    ].join('\n'),
  },
];

function renderCommandCatalog() {
  return [
    '# OpenPrd Command Catalog',
    '',
    '这份清单只负责回答两件事：当前 CLI 有哪些稳定入口，以及什么情况下该用哪条命令。',
    '',
    '## 状态与修复',
    '',
    '- `openprd run . --context`：读取 hook-stable 建议上下文；它是建议，不是自动执行指令。续做历史任务或按用户描述找对应需求/任务时，可带 `--message <用户原话>` 先解析显式目标。',
    '- `openprd run . --verify`：校验当前 run 门禁，并把 `taskReady` 与 `workspaceReady` 分开报告。',
    '- `openprd doctor .`：检查生成引导、hooks、skills、standards 与验证健康度。',
    '- `openprd update .`：修复生成引导、skills、hooks 与 drift。',
    '- `openprd next .`：查看下一步 harness 动作。',
    '',
    '## 需求与评审',
    '',
    '- `openprd clarify .`：生成需求入口自省，并把澄清压缩回对话内确认。',
    '- `openprd capture . --field <path> --value <text|json>`：把用户确认写回状态。',
    '- `openprd synthesize .`：生成可评审 PRD 与 `review.html`。',
    '- `openprd review . --open`：打开当前 PRD review artifact。',
    '- `openprd review . --mark confirmed --version <id> --digest <sha256> --work-unit <id>`：记录当前稳定评审稿；默认用于人类确认后的记录，若当前 lane 已进入 silent-record policy，也只能对精确匹配的稳定 artifact 记录。',
    '',
    '## 设计与实现准备',
    '',
    '- `openprd change . --generate --change <id>`：把 PRD 转成 change。',
    '- `openprd change . --validate --change <id>`：校验 change 结构。',
    '- `openprd tasks . --change <id>`：查看当前 dependency-ready 任务。',
    '- `openprd tasks . --change <id> --advance --verify --item <task-id>`：运行 verify 并推进单个任务。',
    '- `openprd loop . --plan --change <id>`：为长程实现构建单任务列表。',
    '- `openprd loop . --run --agent codex|claude --dry-run`：准备一个 fresh single-task session。',
    '',
    '## Benchmark 与学习包',
    '',
    '- `openprd benchmark add <url|repo|file> --notes <text>`：把外部最佳实践先写入 candidate，用于后续 approve/verify。',
    '- `openprd benchmark list .`：查看当前项目的 approved 与 candidate benchmark source。',
    '- `openprd benchmark approve <benchmark-id>`：把 candidate 纳入项目级长期 registry。',
    '- `openprd benchmark verify .`：检查重复来源、失效链接、缺场景和过宽触发词。',
    '- `openprd learn . --topic <text> --open`：生成当前项目的学习包骨架和 HTML 阅读器。',
    '- `openprd learn . --content-json <file> --open`：让 Agent 写完 `learning-content.json` 后重新渲染最终图文阅读器。',
    '',
    '## 视觉与质量',
    '',
    '- `openprd visual-compare . --reference <效果图> --actual <实现截图>`：已有参考图时输出左右对比 JPG。',
    '- `openprd visual-compare . --before <修改前截图> --after <修改后截图>`：无参考图但改动界面时输出修改前后自检 JPG。',
    '- `openprd dev-check . <file...>`：收工回顾 touched code files 的行数状态与下一步动作。',
    '- `openprd standards . --verify`：校验 `docs/basic/`、文件说明书、文件夹 README 等标准。',
    '- `openprd quality . --verify`：生成 HTML 质量评估报告并检查 EVO 门禁。',
    '- `openprd grow . --review`：审查执行中发现的规则/配置候选，再决定是否 apply。',
    '',
    '## 深度扫描与历史项目',
    '',
    '- `openprd discovery . --resume|--verify`：恢复或校验 discovery 状态。',
    '- `openprd fleet <root> --dry-run`：批量审计历史项目。',
    '- `openprd fleet <root> --sync-registry`：把当前 root 下已初始化的 `.openprd/` 工作区回填到全局 registry。',
    '- `openprd fleet <root> --backfill-work-units`：补历史 PRD work unit 绑定。',
    '- `openprd fleet <root> --update-openprd`：只刷新已有 `.openprd/` 的项目。',
    '',
    '## 使用原则',
    '',
    '- 规划、分析、评审、解释影响范围时，保持只读；不要因为命令存在就直接执行写入。',
    '- 只有用户明确要求实现、继续任务、深度调研、对标复刻或提交时，才进入 `tasks --advance`、`loop --run`、commit、push 等执行动作。',
    '- 高风险动作前先过 `openprd standards . --verify`、`openprd quality . --verify` 和 `openprd run . --verify`；`openprd doctor .` 主要用于集成漂移、生成引导 drift，或 commit/push/freeze/handoff 前的最终健康检查。',
    '',
  ].join('\n');
}

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
  if (!String(text || '').trim()) {
    return block;
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
  const next = upsertManagedBlock(current || '', id, blockBody);
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

async function writeProjectCommandCatalog(projectRoot, options, changes) {
  const version = await packageVersion();
  await writeGeneratedFile(
    cjoin(projectRoot, '.openprd', 'harness', 'command-catalog.md'),
    { adapter: 'project', source: 'command-catalog', version, body: renderCommandCatalog() },
    options,
    changes,
  );
}

function agentContractBody() {
  return [
    '## OpenPrd Harness',
    '',
    '本项目由 OpenPrd 管理。Agent 应优先遵循 repo-local skills 和 hooks；`AGENTS.md` 只保留轻量入口合同。',
    '',
    '### Scope',
    '',
    '- skill 路由放在 `openprd-router`，命令清单放在 command catalog，强约束放在 hooks。',
    '- `AGENTS.md` 只说明入口、默认行为和高风险门禁，不再承载静态长清单。',
    '',
    '### Entry Points',
    '',
    '- 先读 `skills/openprd-router/SKILL.md`；在生成的 Codex / Claude 环境里，优先读同名 `openprd-router` skill。',
    '- 需要具体命令时，优先读 `.openprd/harness/command-catalog.md`，不要继续把命令清单膨胀回 `AGENTS.md`。',
    '- `$openprd-shared`：共用语言、文档影响、敏感信息、浏览器安全、小程序验证、产品文案与 i18n 规则。',
    '- `$openprd-harness`：主工作流、`run/loop`、需求入口、review/change/tasks 与执行节奏。',
    '- `$openprd-benchmark-router`：外部技术、公开 GitHub 仓库、benchmark/对标/最佳实践路由。',
    '- `$openprd-standards` / `$openprd-quality`：`docs/basic/`、就绪验证、EVO 门禁、知识沉淀。',
    '- `$openprd-diagram-review` / `$openprd-discovery-loop`：可视评审与长时间只读挖掘。',
    '',
    '### 默认行为',
    '',
    '1. 动手前先从 `.openprd/` 重建状态，并先运行 `openprd run . --context`；它是建议上下文，不是自动执行指令。',
    '2. 规划、分析、架构评审、“怎么改”或“会动哪些文件”类请求保持只读；只有用户明确要求实现、继续任务、深度调研、对标复刻或提交时才进入执行。',
    '3. 先分流再执行：L0 小修（空格、错别字、按钮文案、简单样式、明确 bugfix）直接处理并事后说明；L1 中等改动先在对话内给 mini-plan 再执行；如果用户刚刚已经确认了 L1 mini-plan、范围边界或正式产品边界，后续承接要写成“已确认，我按这个继续”，不要用“确认，我们就按这个……”这类像再次索取确认的句子。L2 新产品、模块或工作流需求先走 requirement intake，再 `review/change/tasks`，最后才实现。`review.html` 是稳定评审 artifact，不再默认等于唯一的人类停顿点；默认按 decision-points approval policy 执行，只有当前 lane 仍要求人类决策时才在 final answer 主体里停下请求确认；当 review 已确认且 tasks 已就绪但还需要执行授权时，先给执行确认清单再请用户确认。',
    '4. 纯图片、封面图、配图、海报、插画、图标、贴纸、mockup 或“先看样子”请求默认直接使用 Codex 原生 Image 2；其中 logo、icon、avatar、badge 等开发素材在用户未明确要求场景化展示时，默认按独立素材输出（standalone asset）生成：全画布单主体，不额外添加卡片、设备框或其他展示容器；进入实现阶段时，已有参考图用 `openprd visual-compare --reference/--actual`，无参考图但改动界面用 `openprd visual-compare --before/--after`。',
    '5. 用户给出会话 ID 并要求继续时，按工具无关的历史会话续接；不要要求工具专属 ID，也不要用当前 active change 或相似历史替代指定会话。',
    '6. 代码修改完成后、最终回复前，针对本轮实际 touched code files 运行 `openprd dev-check . <file...>`；宣称准备就绪前，运行 `openprd standards . --verify`、`openprd quality . --verify` 和 `openprd run . --verify`。',
    '',
    '### Hook-Enforced Gates',
    '',
    '- requirement：需求未完成 `clarify/review/change/tasks` 前阻断实现写入；tasks 就绪后，只有用户原始意图已明确要求实现，或后续明确发出执行指令时才放行。',
    '- research：公开 GitHub 架构/对标先 DeepWiki；第三方技术用法、配置、限制、版本差异或迁移先查本地证据，不足时再按 `resolve_library_id -> query_docs` 使用 Context7。',
    '- skill-visualization：修改 skill、`SKILL.md`、`AGENTS.md` 或相关 workflow 前，先输出彩色 Mermaid 方案并等待用户确认。',
    '- secrets / weapp / browser / copy：分别处理 `secrets-vault`、`weapp-dev-mcp`、窗口归属与 i18n/普通用户文案提醒。',
    '- 需要细节时，读 router 指向的 skill 和 command catalog，而不是继续扩写 `AGENTS.md`。',
    '',
    '### High-Risk Gate',
    '',
    'Before freeze, handoff, accepted spec apply/archive, commit, push, release, or publish, ensure `openprd standards . --verify`, `openprd quality . --verify`, `openprd run . --verify`, and `openprd doctor .` are healthy.',
    'If the quality report says `productionReady=false`, do not claim readiness; list the missing evidence or gates.',
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
  return readFileSync(cjoin(PACKAGE_ROOT, 'src', 'codex-hook-runner-template.mjs'), 'utf8').trimEnd();
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
  await writeProjectCommandCatalog(projectRoot, normalizedOptions, changes);
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
  const registry = await upsertWorkspaceRegistryEntry(projectRoot, {
    openprdHome: options.openprdHome,
    manifest,
    action: options.action ?? 'setup',
    tools,
    hookProfile,
    recordedAt: manifest.generatedAt,
  });
  await appendJsonl(harnessPath(projectRoot, OPENPRD_HARNESS_EVENTS), {
    at: registry.entry.lastRegisteredAt,
    event: 'workspace-registry-updated',
    registryPath: registry.registryPath,
    status: registry.status,
    knownTotal: registry.knownTotal,
  });

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
    registry,
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
  await collectDoctorCheck(projectRoot, checks, '.openprd/harness/command-catalog.md', (file) => fileHas(file, 'OPENPRD:GENERATED'), 'Missing OpenPrd command catalog.');

  if (tools.includes('codex')) {
    await collectDoctorCheck(projectRoot, checks, '.codex/config.toml', (file) => fileHas(file, 'codex_hooks = true'), 'Codex hooks feature is not enabled.');
    await collectDoctorCheck(projectRoot, checks, '.codex/hooks.json', (file) => fileHas(file, 'openprd-hook.mjs'), 'Codex hooks.json is missing OpenPrd hooks.');
    await collectDoctorCheck(projectRoot, checks, '.codex/hooks/openprd-hook.mjs', (file) => fileHas(file, 'OpenPrd harness 上下文'), 'Codex hook runner is missing.');
    const smoke = await smokeTestCodexHook(projectRoot, { hookProfile });
    checks.push({ path: '.codex/hooks/openprd-hook.mjs:smoke', ok: smoke.ok, message: smoke.message });
    await collectDoctorCheck(projectRoot, checks, '.codex/skills/openprd-router/SKILL.md', (file) => fileHas(file, 'OPENPRD:GENERATED'), 'Codex OpenPrd router skill is missing.');
    await collectDoctorCheck(projectRoot, checks, '.codex/skills/openprd-harness/SKILL.md', (file) => fileHas(file, 'OPENPRD:GENERATED'), 'Codex OpenPrd harness skill is missing.');
    await collectDoctorCheck(projectRoot, checks, '.codex/skills/openprd-learning-review/SKILL.md', (file) => fileHas(file, 'OPENPRD:GENERATED'), 'Codex OpenPrd learning review skill is missing.');
    if (options.enableUserCodexConfig) {
      const userConfigPath = cjoin(resolveCodexHome(options), 'config.toml');
      await collectDoctorCheckAbsolute(checks, displayPath(userConfigPath), userConfigPath, (file) => fileHas(file, 'codex_hooks = true'), 'User Codex config has not enabled hooks.');
    }
  }
  if (tools.includes('claude')) {
    await collectDoctorCheck(projectRoot, checks, 'CLAUDE.md', (file) => fileHas(file, 'OPENPRD:CLAUDE:START'), 'Missing OpenPrd managed CLAUDE block.');
    await collectDoctorCheck(projectRoot, checks, '.claude/skills/openprd-router/SKILL.md', (file) => fileHas(file, 'OPENPRD:GENERATED'), 'Claude OpenPrd router skill is missing.');
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
