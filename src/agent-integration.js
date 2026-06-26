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
const OPENPRD_LITE_WRITE_TOOL_MATCHER = '^(Bash|Read|Write|Edit|MultiEdit|apply_patch|WebSearch|web_search)$';
const OPENPRD_GUARDED_WRITE_TOOL_MATCHER = '^(Bash|Read|Glob|Grep|LS|Write|Edit|MultiEdit|apply_patch|WebSearch|web_search)$';
const OPENPRD_HARNESS_DIR = cjoin('.openprd', 'harness');
const OPENPRD_HARNESS_EVENTS = cjoin(OPENPRD_HARNESS_DIR, 'events.jsonl');
const OPENPRD_HARNESS_HOOK_STATE = cjoin(OPENPRD_HARNESS_DIR, 'hook-state.json');
const OPENPRD_HARNESS_MANIFEST = cjoin(OPENPRD_HARNESS_DIR, 'install-manifest.json');
const OPENPRD_HARNESS_DRIFT = cjoin(OPENPRD_HARNESS_DIR, 'drift-report.json');
const LEGACY_CODEX_HOOK_OUTPUT_FIELDS = ['should_stop', 'additional_contexts', 'should_block', 'block_reason'];
const OPENPRD_GENERATED_MARKER = 'OPENPRD:GENERATED';
const OPTIONAL_CAPABILITY_REGISTRY = [
  {
    id: 'context7',
    name: 'Context7',
    summary: '帮助 Agent 获取最新的第三方技术文档、配置、版本差异、迁移路径和高质量实现信息。',
    recommendedFor: '涉及第三方库、框架、API、SDK、MCP、CLI 的最新用法、配置或迁移时尤其有帮助。',
    docsUrl: 'https://context7.com/docs/resources/all-clients',
    repoUrl: 'https://github.com/upstash/context7',
    serverUrl: 'https://mcp.context7.com/mcp',
    patterns: ['mcp.context7.com/mcp', 'context7'],
  },
  {
    id: 'deepwiki',
    name: 'DeepWiki',
    summary: '帮助 Agent 用对话方式理解 GitHub 公开仓库的架构、关键模块、关键流程和实现线索。',
    recommendedFor: '需要理解公开 GitHub 仓库整体结构、跨模块设计或关键流程时尤其有帮助。',
    docsUrl: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp',
    repoUrl: 'https://github.com/CognitionAI/deepwiki',
    serverUrl: 'https://mcp.deepwiki.com/mcp',
    patterns: ['mcp.deepwiki.com/mcp', 'deepwiki'],
  },
];

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
      '1. 如果用户当前明确在说“帮我梳理下”“先想清楚”“进入脑暴模式”，先读 `$openprd-requirement-intake`，并优先运行 `openprd run . --context --message <用户原话>`；需要时直接进入 `openprd brainstorm . --open`，不要只跑不带 message 的 `openprd run . --context`。',
      '2. 其他情况再读 `.openprd/` 当前状态，并把 `openprd run . --context` 当作建议上下文，而不是自动执行指令。',
      '3. 如果当前是空白工作区的前端/页面冷启动，而且用户已经给了明确的页面主题、模块范围或“直接实现”的意图，优先改用 `openprd run . --context --message <用户原话>`；不要先跑不带 message 的 `openprd run . --context`，再被空白工作区自己的 `clarify-user` 带偏。',
      '4. 需要具体命令时，优先读取 `.openprd/harness/command-catalog.md`，不要把命令清单继续塞回 `AGENTS.md`。',
      '5. 需要共用约束时，读 `$openprd-shared`；需要主工作流时，读 `$openprd-harness`。',
      '6. 任务涉及界面、页面、视觉、样式、信息架构、内容型页面或前端体验时，额外读取 `$openprd-frontend-design`。',
      '7. 如果这类空白前端任务在带 message 的前提下仍短暂返回 `clarify-user`，但用户原话已经明确要求直接实现单页/首页/原型，就把它当成摘要级提醒；先用 3 到 5 行 mini-plan 收口，再按 frontend design 的 `design-starter -> Patch Mode` 路径继续，不要回到长澄清或模板源码漫游。',
      '',
      '## 路由表',
      '',
      '- 需求入口分流、用户可见需求类型与内部 L0/L1/L2 路由码对照、PRD 场景视角选择：`$openprd-requirement-intake`',
      '- 主工作流、review/change/tasks、`run/loop`：`$openprd-harness`',
      '- 前端设计框架、审美资产库、主题/骨架/组件/配方/模板、事实与素材前置门：`$openprd-frontend-design`',
      '- 测试策略分流、分层验证和任务级 evidence-plan：`$openprd-test-strategy`',
      '- 最佳实践、benchmark、公开 GitHub 仓库、第三方技术事实、prompt/context engineering：`$openprd-benchmark-router`',
      '- `docs/basic/`、文件说明书、文件夹 README、文档标准：`$openprd-standards`',
      '- 就绪验证、EVO 门禁、HTML 质量评估报告、项目经验沉淀：`$openprd-quality`',
      '- 架构图、产品流程图、解释型 SVG、可视化评审、大界面改动效果图方案评审：`$openprd-diagram-review` 与 `$openprd-harness`',
      '- 长时间只读挖掘、参考项目持续调研、requirements/specs/tasks 补全：`$openprd-discovery-loop`',
      '- 学习包、归档阅读器、知识整理：`$openprd-learning-review`',
      '',
      '## 路由原则',
      '',
      '- `AGENTS.md` 只保留轻量入口合同；详细规则放进 repo-local skills、`.openprd/harness/command-catalog.md` 和 hooks。',
      '- 公开 GitHub 仓库架构/对标先 DeepWiki；第三方库、API、SDK、MCP、CLI 用法先查本地证据，本地不足时再按 `resolve_library_id -> query_docs` 使用 Context7。',
      '- hooks 已经强制处理 requirement / research / secrets / skill-visualization / weapp / browser / copy 这些门禁；不要再把它们膨胀回 `AGENTS.md` 静态长文。',
      '- 用户原话里已经明确要求“先梳理/脑暴”时，用户意图优先于不带 message 的默认 run context；先把原话带进 `openprd run . --context --message ...`，或直接进入脑暴模式。',
      '- 不要用固定关键词决定是否写 PRD，也不要用词表决定工具；先让 `$openprd-requirement-intake` 按影响面、未知数、决策成本和验证成本做语义分流，再按用户目标、期望产物、交付阶段和证据缺口选择学习器、视觉评审或质量收口工具。',
      '- 当用户需要理解状态跳转、因果链、方案差异、边界分工或风险传播时，先读 `$openprd-diagram-review`，优先用轻量解释型 SVG 辅助说明；不要把它误升级成正式评审图或视觉验收图。',
      '- 不要用“需求大小”机械决定测试层级；先让 `$openprd-test-strategy` 按风险、触达面、失败后果和证据成本分流。',
      '',
    ].join('\n'),
  },
  {
    id: 'openprd-test-strategy',
    description: 'OpenPrd 测试策略分流 skill：按风险把任务分到单元、集成、端到端、人工、视觉、小程序、性能和安全验证，并要求 evidence-plan。',
    body: [
      '# OpenPrd Test Strategy',
      '',
      '当需求进入实现、任务拆分、验证计划、质量评估或 loop 单任务执行时，使用这份 skill。',
      '',
      '## 核心判断',
      '',
      '- 先接住 `$openprd-requirement-intake` 的需求类型，再按风险、触达面、失败后果和证据成本选择测试组合。',
      '- 不把“小需求=单测、中需求=集成、大需求=端到端”写成硬规则；它只是默认起点。',
      '- 70/20/10 只作为健康形状参考，不作为 OpenPrd 的硬性比例门禁。',
      '- 脚本存在只能说明项目具备能力，不能替代本次执行证据。',
      '',
      '## 默认分流',
      '',
      '- 局部纯逻辑、格式化、解析、规则函数：优先 `test-layer: unit`，`test-size: small`，`test-scope: isolated`。',
      '- 触达 CLI/API/Agent 契约、生成物、跨模块状态、任务推进、quality/run/loop：使用 `unit, integration`，`test-size: medium`，`test-scope: cli-contract|api-contract|module`。',
      '- 触达用户主路径、页面、发布链路、真实浏览器、登录权限或第三方依赖：升级到 `integration, e2e`，`test-size: large`，`test-scope: user-flow`。',
      '- 触达视觉还原：补 `visual` 或 `visual-flow`；已有参考图时用 `openprd visual-compare --reference/--actual` 留证据；没有参考图时先判断新建界面还是修改既有界面，新建界面先按用户目标、信息架构和视觉决策成本判断是否需要 3 方向方案评审，修改既有界面用 `openprd visual-compare --before/--after` 留修改前后自检证据；局部细节优先补“局部焦点证据板”，多方向实验优先补“并行实验证据板”。卡片宽度、间距、留白、对齐、颜色、圆角、字号、按钮或图标等轻量 UI 可视优化也需要视觉证据，build、package 和 dev-check 不能替代。新功能或改动包含同构列表、卡片、网格、表格时，或用户反馈排版没对齐时，还要补“对齐辅助线证据板”，同时量测容器轨道和内容槽位轨道；内容槽位包括标题、副标题、描述、标签、状态、价格、按钮、图标或操作区等相同文案类型/相同组件槽位的 x/y/宽高/baseline spread。单个 logo、icon、avatar、badge、按钮图形或图片内部需要居中判定、视觉重心评估或用户反馈偏心时，补“内部居中证据板”，用 `centering-board` 量画布中心、主体外接框中心和视觉重心偏移。',
      '- 明确要求微信小程序运行态证据，或改动高风险且只能靠真实运行态确认时：补 `weapp` 和 `weapp-runtime`，并使用当前环境已配置的本地小程序验证能力；默认沿用当前小程序运行态或开发者工具会话连续验证，不要为了验证自动重开应用；普通小改默认先选更轻的验证，不要自动升级到小程序运行态验证。',
      '- 触达性能、成本、额度、并发、滥用、安全、敏感信息：增加 `performance` 或 `security` 专项验证和负向场景。',
      '- 纯文档或治理任务：使用 `manual`，并记录标准校验、review、change validate 或人工审查证据。',
      '',
      '## 任务元数据',
      '',
      'OpenSpec 任务可以显式写入：',
      '',
      '```md',
      '- test-layer: unit|integration|e2e|manual|smoke|visual|performance|security|weapp|none',
      '- test-size: small|medium|large|manual|advisory|none',
      '- test-scope: isolated|module|contract|cli-contract|api-contract|user-flow|visual-flow|weapp-runtime|performance|security|governance|docs|none',
      '- evidence-plan: 说明本任务准备留下什么验证证据',
      '- evidence: 本次已经产生的证据路径或摘要',
      '- waiver-reason: 不做某层测试时的原因和剩余风险',
      '```',
      '',
      '## 收尾要求',
      '',
      '- loop 单任务完成时，阶段性测试报告必须包含测试策略、执行命令、结果和证据路径。',
      '- `openprd quality . --verify` 应能看到分层测试策略矩阵；缺少本次证据时只能写需补证据，不能宣称已验证。',
      '- 如果策略被升级或豁免，把原因写进 `upgrade-reason` 或 `waiver-reason`，方便后续 review。',
      '',
    ].join('\n'),
  },
  {
    id: 'openprd-requirement-intake',
    sourceSkill: 'openprd-requirement-intake',
    description: 'OpenPrd 需求入口与 PRD 分流 skill：判断用户可见需求类型和内部 L0/L1/L2 路由码，决定直接澄清、mini-plan 或正式 PRD，并选择通用 / 面向个人消费者场景 / 面向企业服务场景 / 以 Agent 为主要使用场景的 PRD 视角。对用户复述时不要直接把 consumer / b2b / agent 当展示词；这些枚举值只用于内部记录和命令。',
  },
  {
    id: 'openprd-frontend-design',
    sourceSkill: 'openprd-frontend-design',
    description: 'OpenPrd 前端设计框架 skill：为界面、页面、视觉、样式和前端体验任务提供设计资产框架、审美立意、反 AI 味门禁和实现前方向评审规则。',
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
      '- 用户可见文档、进度日志、proposal、prompt、报告，以及 Agent 产出的 spec 和 tasks 跟随用户当前主语言；无法判断时使用简体中文兜底。只保留必要专有名词、品牌名、命令名、路径、字段名和 API 术语。',
      '- OpenPrd 自身及随包 workspace / template / skill README 默认把简体中文放在 `README.md`，英文放在 `README_EN.md`；如需兼容旧链接，可保留 `README_CN.md` 作为跳转入口。',
      '- 当 `locale` 为 `zh-CN` 时，diagram contract 中所有可见字段都必须使用简体中文；面向用户的 review.html 或 diagram HTML 文案不要使用 `freeze` 这类内部流程词，改写为“需求定稿前”“进入实现前确认”等业务可理解表达。',
      '- OpenPrd 用户默认懂业务和产品，但不想读技术黑话；对外输出先给结论和下一步，能一句讲清楚就不要拆成两步。',
      '- 主动替用户补全范围边界、失败路径、恢复路径、实现成本、维护成本、滥用风险和第三方依赖；默认按性价比选方案。',
      '- 涉及第三方 API、模型、云服务或付费工具时，用表格比较效果、价格、接入成本、限制、风险和推荐理由；用户明确质量优先时，提高质量和稳定性权重。',
      '- 当用户的问题包含多个对象、方案、文件、场景、风险、验证项、素材或任务，并且需要同时呈现状态、证据、影响、动作或推荐时，Agent 应主动使用 Markdown 表格，不等用户要求。先用一句话给结论，再给表格。',
      '- 表格优先用于方案对比、状态盘点、问题排查、风险审查、多对象 QA、文件/命令清单、需求场景覆盖和内容/素材规划；单一结论、单一动作、代码示例、命令示例和叙事型说明不要强行表格化。',
      '- 当用户需要理解复杂关系、状态跳转、因果链、边界分工、路径差异、风险传播或方案取舍时，优先用“结论 + 解释型 SVG 图 + 少量补充”的图解优先表达；能被一张图讲清的内容，不要先输出长段落文字。',
      '- 解释型 SVG 是对话辅助，不是正式评审或验收产物；它用于让用户快速看懂，不替代 `review.html`、`openprd diagram`、`visual-compare`、测试证据、调研证据或实现截图。',
      '- 图解优先不等于所有问题都画图：单一事实、短命令输出、简单 yes/no、精确错误文本、合规/安全必须逐字说明的内容，仍用简短文字或表格。',
      '- 面向用户的时间统一使用上海时区 `YYYY-MM-DD HH:mm:ss` 格式，不带 `T`、`Z` 或毫秒。',
      '- 保持未解决假设可见，不要悄悄补脑。',
      '- 对于 L2、脑暴或仍在判断值不值得做的 0 到 1 需求，默认再补一层“创业验证闭环”：第一批最容易触达的人群/社区、你为什么算这个社区里的自己人、当前替代方案和痛点证据、先不做完整产品时的手工路径、能否先用 spreadsheet / 表单 / no-code 跑起来、如果必须开始做产品也只自动化最重复的一步并先压成 forms / lists / CRUD 骨架、什么真实承诺才算真需求、有没有 10 个样本和更强付费信号、最低成本验证动作、达到什么条件才允许产品化，以及验证阶段怎样先活下来、增长阶段守什么纪律，以及这是不是你愿意长期住进去、不会反过来绑住自己的业务形态。',
      '- 项目基线文档路径只能是 `docs/basic/`。',
      '- 声称就绪前，至少通过 `openprd validate .` 和 `openprd standards . --verify`。',
      '- 实现就绪还要运行 `openprd quality . --verify`，并审阅 HTML 质量评估报告中的场景标签、必需 EVO 门禁、可观测性、业务护栏、评估执行环境、性能和知识缺口。L2 或跨页面实现的最终回复必须带上最新 HTML 质量报告和 task-scoped 测试报告路径；缺失时只能说“实现完成但项目级收口未完成”。',
      '- 用户要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup、先看样子或先确认设计方向时，默认直接调用 `imagegen`，也就是 Codex 原生 Image 2，产出图片；Image 2 是工具路径，不是审美豁免。生成前先写清用途、受众、气质、约束和记忆点，并把它们写进 prompt；没有品牌或参考图依据时，用 anti-slop 排除默认紫白/蓝紫渐变、通用字体、白底卡片堆叠和无语境装饰。对 logo、icon、avatar、badge 等开发素材，如果用户未明确要求 mockup、场景图、设备框、卡片承载、名片/包装展示或参考界面复刻，默认按独立素材输出（standalone asset）处理：使用全画布单主体，不额外添加 UI frame、卡片、设备壳、名片、桌面陈列、手持实拍或其他展示容器。只有当用户明确要求 mockup、场景化效果图、容器化呈现，或参考图本身包含这些结构时，才生成对应容器或场景；除非用户明确指定 HTML、SVG、CSS、Canvas、代码稿或可编辑矢量/source artifact，不要改用临时 HTML/SVG/CSS 再截图。只有实际发生 `imagegen` 调用后，才能汇报生图结果、失败或限流。生图结果先当候选效果图，不要默认登记到 `.openprd/harness/visual-reviews/`；如果用户还要继续做实现，主动确认是否符合预期、是否纳入后续效果图/实现截图对比、以及是否按此继续实现。',
      '- 对 logo、icon、avatar、badge、贴纸、空态插画、单物件 UI 位图等开发素材，如果最终要接入 UI 并需要透明背景，默认走“候选评审 -> 资产工程化 -> 接入验证”的图标资产链路：先基于用途、受众、气质、约束和记忆点生成 3 个差异足够大的独立素材候选方向，并保持纯 `#00ff00` 绿幕、无文字、无 UI 容器、主体居中且留足裁切边距；用户选定前不写入项目文件。用户选定后再定位源图或 contact sheet，保留绿幕源图，用 `remove_chroma_key.py` 抠成透明 PNG/WebP，按真实 UI 需要裁切居中并导出 384px 或多尺寸资产；接入时按首页卡片、工具格、吸顶栏、偏好预览等实际场景分别调显示比例，而不是只换图片路径。收口时同步写回 `.openprd/design/active/asset-spec.md` 和 `selected-direction.md`，说明选中的方向、资产路径、透明产物、接入位置和验证结果；最终回复必须区分绿幕源图、透明产物和是否已经接入。',
      '- OpenPrd 的 `review.html` 用于需求评审，不能替代图片或效果图生成；`visual-compare` 只用于实现阶段视觉证据：已有确认参考图时对比“效果图 / 实现截图”；没有参考图时先判断新建界面还是修改既有界面，新建界面回到实现前 3 方向方案评审，修改既有界面再对比“修改前 / 修改后”；当局部细节更重要时，优先改用 `--board` 生成“局部焦点证据板”；当并行跑了多个优化方向时，优先改用 `--board` 生成“并行实验证据板”；当普通截图、Computer/Browser/Playwright 实测截图被用作证据时，必须改用 `--board` 生成“截图实测证据板”；当新功能或改动包含同构列表、卡片、网格、表格，或用户反馈排版没对齐时，必须改用 `--board` 生成“对齐辅助线证据板”，且同时覆盖容器轨道和内部内容槽位轨道；当单个 logo、icon、avatar、badge、按钮图形或图片内部需要居中判定、视觉重心评估或用户反馈偏心时，必须改用 `--board` 生成“内部居中证据板”，用红色画布中心线、绿色主体外接框和黄色视觉重心点展示偏移。视觉证据不仅检查位置和结构，也要检查选定气质、层级、字体/色彩/动效/表面角色和记忆点是否保住。当参考图是一张整板、网格图、多对象或多子图组合时，先运行 `openprd visual-prepare` 生成 reference-set、contact sheet 和 board 模板，再进入实现对比。',
      '- 轻量 UI 可视优化也要走视觉证据门：卡片宽度、间距、留白、对齐、颜色、圆角、字号、按钮、图标这类用户可见小改，不自动升级成大界面 3 方向评审，但动手前要有一句本轮审美意图和记忆点，收口前至少补 `visual-compare --before/--after`、`--board <focus-board.json>` 或 `--board <verification-board.json>`；如果存在同构列表、卡片、网格或表格，或用户反馈没对齐，还要补 `--board <alignment-board.json>`，把真实截图、辅助线、容器轨道 spread 和内容槽位 spread 放在一张板里；如果关注单个素材/图标/头像/徽标/按钮图形的内部居中或视觉重心，还要补 `--board <centering-board.json>`，把画布中心、主体外接框中心和视觉重心偏移放在一张板里；build、package、dev-check、单元测试和单张原始截图都不能替代视觉证据。',
      '- 大界面改动在需求分流后、PRD 定稿或实现开工前先做视觉方案评审。先判断这是不是会决定首屏、核心布局、信息架构、主视觉或关键路径的场景，而不是按关键词触发；已有界面时用 Codex Computer Use 进入产品内对应功能并截当前真实界面，冷启动没有现有界面时基于已确认 PRD、用户群体、第一版切片和视觉目标生成设计 brief。brief 必须写清用途、受众、气质端点、约束和记忆点，3 个方向要分别说明审美主张和主动避开的模板味。再调用 `imagegen`（Codex 原生 Image 2）生成至少 3 个不同设计思想方向；把效果图横向拼成一张带 1/2/3 序号的大图，先作为候选效果图展示给用户。只有用户确认纳入后续对比或继续实现后，才把选定方向、整张图或其中子图整理到 `.openprd/harness/visual-reviews/` 并进入实现。',
      '- 界面、页面、视觉、样式或前端体验开发中，只要已经有效果图、设计稿、图片资产或用户给图并进入实现阶段，阶段性完成后必须先截实现图，再运行 `openprd visual-compare . --reference <效果图> --actual <实现截图> --locale <当前主语言>` 生成左右对比 JPG；中文语境默认标注“效果图 / 实现截图”，英文语境默认标注“Reference / Implementation”。如果这次要审局部细节，就补一份 `--board <focus-board.json>` 的局部焦点证据板。如果一张参考图里有多个子图、网格或对象，先运行 `openprd visual-prepare . --reference <效果图> --grid <列>x<行>` 或 `--boxes <plan.json>`，确认 contact sheet 后再逐项对比。普通截图和 Computer/Browser/Playwright 实测截图只能作为原始素材，收口前要用 `--board <verification-board.json> --locale <当前主语言>` 拼成截图实测证据板。证据板 JSON 里的 title、summary、label、notes、checks 等用户可见文案必须跟随用户当前主语言；中文语境不要整段写英文，英文语境不要混入默认中文标签。新功能开发或既有调整里出现同构列表、卡片、网格、表格时，即使用户没有主动提“对齐”，也要用 `--board <alignment-board.json>` 生成对齐辅助线证据板，先检查卡片外框、列宽、行顶等容器轨道，再检查标题、副标题、描述、标签、状态、价格、按钮、图标和操作区等内部内容槽位是否成轨；用户反馈没对齐/排版漂移时也走同一条路径。单个 logo、icon、avatar、badge、按钮图形或图片内部需要居中判定、视觉重心评估或用户反馈偏心时，要用 `--board <centering-board.json>` 生成内部居中证据板，检查画布中心、主体外接框中心和视觉重心偏移。Agent 必须查看合成图并继续对标，直到结构、气质、层级、字体/色彩/表面角色和记忆点都没有明显差异；如果用户后续说“跟效果图”“不一致”“好丑”“复刻”，至少先产出一份视觉证据图，不能只凭主观判断宣称完成。',
      '- 界面、页面、视觉、样式或前端体验开发中，如果没有明确效果图、设计稿、图片资产或用户给图，要先判断这是新建界面还是修改既有界面：新建界面走实现前 3 方向方案评审；修改既有界面则动手前必须先用 Computer Use、Browser、Playwright 或项目现有工具截取修改前截图。完成后用同一入口、视口、账号和数据状态截取修改后截图，再运行 `openprd visual-compare . --before <修改前截图> --after <修改后截图> --locale <zh-CN|en>`。如果这次并行试了多条优化方向，再补一份 `--board <parallel-board.json>` 的并行实验证据板；如果只是普通截图或 Computer/Browser/Playwright 实测截图，也必须补 `--board <verification-board.json>` 的截图实测证据板。Agent 必须查看合成图，确认预期变化出现且未改区域没有明显漂移。',
      '- 界面任务进入实现前，先用 `.openprd/design/` 锁定设计框架：页面涉及具体产品事实、版本、发布时间、规格、价格、引用数据或地点事实时，先补 `.openprd/design/active/facts-sheet.md`；页面依赖 logo、产品图、UI 图、摄影图、插图、图表或品牌色字体时，先补 `.openprd/design/active/asset-spec.md`；旅游、展览、内容、案例、发布、品牌故事等内容型页面，要先判断真实图片是不是页面成立前提，必要时先补 `.openprd/design/active/image-preflight.md`；没有明确参考方向时，先补 `.openprd/design/active/direction-plan.md`，并确保 3 个方向来自不同生成逻辑；用户选定方向后，再补 `.openprd/design/active/selected-direction.md`，把选中的 lens、theme、layout、组件和风险锁定。如果用户已经给了效果图、设计稿、参考截图或其他明确参考图，先把它当成主参考源：只有现有 starter、theme、layout 足够接近时才复用，不接近就允许偏离默认组合，以参考图为准。空白工作区的静态原型优先从 `.openprd/design/templates/` 里挑最近模板；如果当前轮用户已经把页面主题、模块范围或“直接实现”的意图说清，优先运行 `openprd run . --context --message <用户原话>`。如果页面主题和模块范围已经明确，优先运行 `openprd design-starter . --starter <starter-id> --out index.html --brief "<页面主题>" --sections "<模块1|模块2|模块3>"`，让 starter 一次写实 active design artifacts 和第一版真实页面。只有像个人博客、工具台、纯结构化产品页这类确认不靠真实图片成立的页面，才在 active design artifacts 写清无依赖并补 `--no-external-facts --no-brand-assets --no-real-images`；若题目更像旅游、导览、展览、博物馆、城市、自然观察或案例内容页，先不要带 `--no-real-images`，让 starter 先尝试补首批真实图片；若这类冷启动即使带 message 仍短暂返回 `clarify-user`，把它当成摘要级提醒，先用 3 到 5 行 mini-plan 收口，再继续。starter 落地后默认进入 `Patch Mode`：必须直接在生成的入口文件上补丁修改；即使结构要大改，也是在同一路径内覆盖，不做 delete-first，更不要删除 `index.html` 后另起新稿。如果确实要整页重写，先把完整新稿写到 sibling draft，例如 `index.next.html`，确认内容成形后再覆盖回 `index.html`，不要让正式入口出现空窗。starter 一落地后，只允许做一轮就地对焦：快速读一次生成的入口文件和必要的 active design artifacts；这轮对焦结束后，下一步就必须是真实写入口，不要再回头搜网页、翻 `docs/basic/` 或继续模板漫游。把最后一批必要的查事实、查图、读模板动作放在口头宣布之前做完；一旦已经说“开始覆盖入口文件”或“开始整页重写”，下一步必须出现真实写文件动作，而不是继续只读浏览、压图或停在口头承诺；必要时 hook 会把这类非写入动作挡回去。`Patch Mode` 完成不等于只补合同、只下载素材或只写计划；至少要把入口文件本体改完、主要占位清掉，并把已准备好的真实图片或参考约束真正落进页面。',
      '- 看到生成文件疑似过期时，先运行 `openprd doctor .`。',
      '- `.openprd/harness/install-manifest.json` 里的 `optionalCapabilities` 用来记录非阻断式增强建议：如果当前任务明显受益但状态还是 `recommended`，在后续建议里说明它能帮什么、给出文档和 GitHub 链接，并可顺手提出“如果你愿意，我可以按当前客户端帮你补配置”；不要因为它未配置就阻断当前任务。',
      '- 前端体验任务进入实现前，优先读取 `$openprd-frontend-design` 与 `.openprd/design/`，先锁定审美主张、记忆点、lens、theme、layout 和组件，再决定是否实现。',
      '- `openprd run . --context` 只是建议。规划、分析、review、影响范围说明等请求保持只读，除非当前用户消息明确要求开发、实现、继续任务、深度调研、对标复刻或 commit/push。',
      '- 用户给出会话 ID 并要求继续时，按工具无关的历史会话精确续接；不要要求或使用工具专属 ID；当前 active change、相似历史或 requirement gate 只能作为背景，不能替代该会话 ID。',
      '- 代码修改完成后、最终回复前，针对本轮实际 touched code files 运行 `openprd dev-check . <file...>` 或 `node scripts/openprd-dev-check.mjs . <file...>`；700 行以内正常，701-1500 行需注意，超过 1500 行警告。若出现需要关注的文件，最终回复必须以 **后续建议** 为标题，直接复用 dev-check 生成的 Markdown 表格，列出影响对象、关注程度、规模信号、预警原因、本次处理结果和后续建议，并按 🔴 → 🟠 → 🟡 排序；不要把“关注程度”列改写成纯 emoji，必须保留例如 `🟠 中风险｜建议优先关注` 这类完整标签；如果你改写了“预警原因 / 本次处理结果 / 后续建议”，先用 `node scripts/dev-check-wrapup-copy.mjs --validate` 校验每格不超过 20 字；若报错，按提示缩短后重试。',
      '- 执行中发现可沉淀项时，不要中途打断当前任务：代码扩展识别这类白名单工具补全会自动应用并记录；用户偏好、项目协作规矩和 OpenPrd 默认行为先沉淀为 `.openprd/growth` 候选，收工时再集中运行 `openprd grow . --review` 请用户确认。',
      '- 维护 OpenPrd 本身时，只要新增或修改配置类能力（阈值、规则、识别、豁免、命令别名、环境差异、用户偏好或策略开关），都要做 grow-aware 自检：高置信应可成长时默认纳入 `openprd grow`；不确定时主动问用户；明确一次性或固定规则时才保持静态配置。',
      '- 只要实现新增或修改文件，就做文档影响检查；缺失的 `docs/basic/`、文件说明书和文件夹 README 要补齐，已有文档受影响时要更新。',
      '- 涉及后端、脚本、Agent、工具链、服务或数据处理变更时，把 CLI 与 API 视为同级接入面：检查命令入口、参数、输出契约、`help`、`doctor`、`dry-run`、`status` 与接口协议、返回结构、身份边界是否受影响，并同步更新 `docs/basic/backend-structure.md`；若某一面不适用也要明确写原因。',
      '- Codex hooks 默认使用 `lite`：`UserPromptSubmit` 注入上下文、轻量 `PreToolUse` 写入门禁，以及 `Stop` 本轮收工回顾。若发现可复用的项目经验，`Stop` 会要求 Agent 在最终回复结尾用人话说明“本次观察到的情况 / 计划保留的项目经验 / 以后怎么复用 / 只保留在当前项目里”，再询问用户是否保留；只有项目明确需要更重的工具级遥测时，才切到 `full`。',
      '- 需求分流优先使用 `$openprd-requirement-intake`，不要按固定关键词判断。用户可见需求类型和内部路由码的固定对照为：直接处理=L0、现有功能优化=L1、新功能/新流程方案=L2。用户审查默认把路由码并进“需求类型：直接处理（L0）”这类标签里；只有内部排障确实受益时，才额外附“内部路由码”。L0 可直接处理并事后说明，不打开正式 PRD/review/change/tasks；L1 先给对话内 mini-plan，默认不生成正式 PRD/change/tasks；只有 L2 才进入 requirement intake 与 PRD/review/change/tasks。L2 的对话内 requirement 摘要默认按“需求判断 / 需求理解 / 功能范围 / 技术方案”四段来写，其中“功能范围”和“技术方案”优先用 Markdown 表格，帮助用户先总后分地看清范围和实现方向；`需求判断` 和 `需求理解` 先用 1 到 2 句轻量主句说清这次是什么、核心问题和第一版目标，边界、风险、异常例子和技术细节下沉到后面的分项或表格，不要把它们都塞进一整段长话里，也不要把某条示例文案写成固定模板。若当前仍是 0 到 1 探索、脑暴或值不值得做的判断，摘要里还要主动补上“验证与创业闭环”：第一批最容易触达的社区或种子用户、你为什么算这个社区里的自己人、当前替代方案和痛点证据、先怎么手工交付、手工作战卡怎么写、能不能先用 spreadsheet / 表单 / no-code 跑起来、如果必须开始做产品也只自动化最重复的一步并先压成 forms / lists / CRUD 骨架、第一版只做哪一件事、能不能压成周末级 MVP、第一批客户路径、从第一个客户开始怎么收费、客户 1 如何打平成本、有没有 10 个样本和更强付费信号、达到什么条件才允许产品化、增长阶段守什么纪律、这条路是否可逆、是否真在解决客户问题、以及是否符合团队价值观、是不是你愿意长期住进去的业务形态。如果用户刚刚已经确认了现有功能优化（L1）的 mini-plan、范围边界或正式产品边界，后续承接要明确写成“已确认，我按这个继续/收口/落地”，不要用“确认，我们就按这个……”这类像再次索取确认的句子。单纯的“请帮我实现/继续实现”不等于跳过 requirement 摘要确认、`capture/classify/synthesize` 写入路径或 review；只有用户明确表示“不需要进行任何确认”时，才允许静默走完整 requirement write path。若当前仍在 L2 的首轮澄清或 requirement 摘要确认阶段，不要写成“你回我一句我就开始实现”；只能承诺“我先整理需求摘要给你确认，确认后再进入 PRD / review 流程”。如果用户的下一条回复只是承接上一轮 requirement 摘要的短跟进，而不是提出新范围、改目标或重新发起分析请求，就把它当成对上一轮摘要、默认方向或选项的继续确认，不要重新开一轮泛化 clarify；应直接按当前对话上下文把已确认事实用 canonical capture 路径、`user-confirmed` 来源写回，而不是继续写 `agent-inferred/project-derived` 的用户澄清字段。若用户原始意图已经明确要求实现，review 已确认且 tasks 就绪后可直接进入执行；否则在请求执行授权前，先输出执行确认清单，列出本轮目标、将执行内容、不做事项、验证方式和已知风险，不能只要求用户回复一句确认。',
      '- 涉及最佳实践、benchmark、对标、参考产品、prompt engineering、Agent harness、context engineering、图标资源、CLI 或 skill 体系设计时，先使用 `$openprd-benchmark-router` 选择证据源，再进入 Context7、DeepWiki 或官方资料调研。',
      '- 入口路由优先看 `$openprd-router`；具体命令速查优先看 `.openprd/harness/command-catalog.md`。',
      '- `AGENTS.md` 只保留轻量合同；详细执行细则优先沉淀到 repo-local skills、command catalog 和 hooks。',
      '- 任务需要 API key、token、账号信息、第三方服务凭证或个人信息时，先使用 `secrets-vault` skill，且不要直接读取原始 vault 文件。',
      '- 修改 skill、`SKILL.md`、`AGENTS.md` 或相关 workflow 前，先读取现状、输出彩色 Mermaid 方案图，并等待用户确认后再编辑相关文件。',
      '- 涉及微信小程序测试、验证、截图、日志、网络请求、开发者工具自动化或运行态相关改动时，先判断是否真的需要运行态证据：只有用户明确要求小程序实测、复现、截图、抓日志/网络、从 0 到 1 走流程，或当前改动高风险到无法靠静态检查、单测、代码审查或现有证据确认时，才升级到本地小程序运行态验证；低风险小改、纯文案、局部样式或可由更轻验证覆盖的改动，默认不要自动触发小程序运行态验证。',
      '- 一旦进入小程序运行态验证，默认沿用当前小程序运行态或开发者工具会话连续验证，不要为了验证自动重开应用；只有用户明确要求从 0 到 1、冷启动、重开或重新打开时，才从头启动。',
      '- 一旦进入小程序运行态验证，优先使用当前环境已配置的小程序本地验证能力；如果当前客户端没有相应工具，不要假定已经安装，也不要把缺少工具本身当成任务失败。未拿到本地运行态证据前，不要宣称“小程序已验证”。',
      '- 用户明确要求 Computer Use 时优先使用 Computer Use，并尽量在 Codex-owned browser window 中操作；对提交、删除、发送、切换账号、退出登录、支付、关闭标签页等高风险网页动作先确认窗口归属。',
      '- 修改用户可见文案前，先检查 `i18n`、`locales`、`translations`、`Localizable` 或其他语言资源；若项目已有多语言结构，用户可见文案要同步维护到所有已支持语言，并避免暴露 API、SDK、模型、数据库、缓存或错误码等实现细节。',
      '',
      '## 写入纪律',
      '',
      '- 只读命令优先：`status`、`next`、`validate`、`standards --verify`、`doctor`。',
      '- 下一道门禁没看清之前，不要贸然执行写入命令。',
      '- 面对规划、分析、审查类请求，不要运行 `openprd loop --run`、`openprd tasks --advance`、`openprd discovery --advance`、`openprd loop --finish --commit`、git commit 或 git push。',
      '- 代码改动完成后，要回顾 `openprd dev-check` 输出；若出现需要关注的文件，直接复用 dev-check 生成的 **后续建议** 表格，并保留“关注程度”列里的完整风险标签，不要缩成纯 emoji。',
      '- 代码改动完成后，要回顾自我成长项：已自动补齐的低风险工具识别项简短说明；仍待确认的偏好、项目规矩或 OpenPrd 默认行为再用 `openprd grow . --review` 集中呈现；若 `Stop` 提醒本轮有可沉淀的项目经验，结尾要先用人话说明“这次情况 / 计划保留的经验 / 以后怎么复用 / 只保留在当前项目里”，再问用户要不要保留。',
      '- 代码改动完成后，要说明 `docs/basic/`、文件说明书和文件夹 README 是新增、更新还是有意不变。',
      '- 用户要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup、先看样子或先确认设计方向时，最终回复应给出 `imagegen` 生成的图片结果；只有实际发生 `imagegen` 调用后，才能汇报生图结果、失败或限流。Image 2 是工具路径，不是审美豁免；最终回复要能说明候选图是否满足用途、受众、气质和记忆点。大界面改动进入实现前先按用户目标、信息架构变化、视觉决策成本和验证风险判断是否需要 3 方向横向效果图大图；需要时等待用户选择方向后再实现。如果是 logo、icon、avatar、badge 等开发素材且用户未明确要求 mockup 或场景化呈现，默认给出独立素材输出结果。进入实现阶段后，已有参考图才给出 `openprd visual-compare --reference/--actual` 生成的 JPG 路径；没有参考图时先判断新建界面还是修改既有界面：新建界面回到实现前 3 方向方案评审，修改既有界面给出 `openprd visual-compare --before/--after` 生成的 JPG 路径；局部细节重点则补 `openprd visual-compare --board <focus-board.json>`，并行实验则补 `openprd visual-compare --board <parallel-board.json>`；普通截图或 Computer/Browser/Playwright 实测截图作为证据时补 `openprd visual-compare --board <verification-board.json>`；同构列表、卡片、网格、表格或用户反馈没对齐时补 `openprd visual-compare --board <alignment-board.json>`，并分别说明容器轨道 spread 和标题/副标题/描述/标签/状态/价格/按钮/图标等内容槽位 spread 是否仍有偏差；单个素材、图标、头像、徽标、按钮图形或图片内部居中/视觉重心问题时补 `openprd visual-compare --board <centering-board.json>`，并说明主体外接框中心和视觉重心偏移。',
      '- 如果本轮是卡片宽度、间距、留白、对齐、颜色、圆角、字号、按钮或图标等轻量 UI 可视优化，最终回复可以说明代码、构建或 dev-check 状态，但只有补齐 `visual-compare`、局部焦点证据板、截图实测证据板、对齐辅助线证据板或内部居中证据板，并确认审美意图和记忆点成立后，才能说视觉优化已完成。',
      '- `freeze`、`handoff`、`change --apply`、`change --archive`、commit、push、release、publish 等高风险动作都要求前置门禁全绿。',
      '',
      '## 修复路径',
      '',
      '1. 运行 `openprd doctor .`。',
      '2. 如果生成引导或 hooks 漂移，运行 `openprd update .`。',
      '3. 运行 `openprd standards . --verify` 并修复文档标准。',
      '4. 运行 `openprd quality . --verify` 并审阅 HTML 质量评估报告；若 `productionReady=false`，最终回复必须先区分 `taskReady` 与 `workspaceReady`，再列出缺证据或需关注的必需 EVO 门禁；如果只剩 `feature-coverage`，说明是任务账本或覆盖证据未收口，不要把本次功能说成失败。',
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
      '- 用户提到界面审美、设计框架、主题库、模板库、组件骨架、视觉资产库、前端体验风格或页面参考方法。',
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
      '- 执行或复盘中发现被用户采纳的优质信源时，用 `openprd benchmark observe <url|repo|file> --notes <text>` 累计 evidence；达到阈值后只推荐 approve，不自动晋级。',
      '- 用 `openprd benchmark verify` 检查重复来源、失效链接、缺失本地文件和过宽触发规则。',
      '',
      '## Source Policy',
      '',
      '- GitHub 仓库：需要理解架构、核心模块、关键流程或对标结论时，先用 DeepWiki。默认顺序是 `read_wiki_structure` 1 次，再 `ask_question` 1-2 次；只有在本地源码和已有结论仍不足时才追加。DeepWiki 不可用或覆盖不足时，再回退到 GitHub README、源码和官方文档。',
      '- 官方技术文档：涉及第三方库、框架、API、SDK、MCP、CLI 工具的用法、配置、限制、版本差异或迁移路径时，先检查本地代码、锁文件、README、类型定义；本地不足时再用 Context7，默认顺序是 `resolve_library_id` 1 次，再 `query_docs` 1-2 次。Context7 不足时说明缺口，再补官方文档、源码或其他一手资料。',
      '- 工程文章和产品文档：优先读取当前线上一手页面，只抽取和当前任务相关的观点与设计原则，不复制长文；如果内容可能过时，要说明时效风险。',
      '- 视觉与设计参考：优先吸收结构、节奏、信息组织、资产策略和质量门，不照搬品牌表层风格。需要官方品牌或产品事实时，优先官方站点、官方媒体包、官方设计系统和项目自身 approved benchmark。',
      '- 本地源码优先：当前工作区已经有相关源码时，常规修 bug、查实现、改功能优先读本地代码；DeepWiki 主要用于外部仓库架构理解和对标分析。',
      '- 停止调研：找到足以支持当前决策的 1-3 个高相关来源后停止扩展；候选来源重复时保留更权威、更新或更贴近当前任务的来源。',
      '- 追加调用前先写清“已确认什么、还缺什么”；不要为了同一问题只换个说法反复查询。',
      '',
      '## Source Map',
      '',
      '- `Fission-AI/OpenSpec`：适合对标 spec 驱动变更流程、change lifecycle、spec 与 execution artifact 分层、动态 agent 指令组装和验证门禁。',
      '- `obra/superpowers`：适合对标 mandatory skill routing、多平台适配、轻量 bootstrap、worktree/subagent 协作和 skill 深浅分层。',
      '- `slavingia/skills`：适合对标 0 到 1 验证、community-first、10 specific people、current workaround、manual-first delivery、Magic Piece of Paper、spreadsheet / no-code first、automate-one-step-at-a-time、forms and lists / CRUD first、build for today\'s customers not hypothetical future ones、avoid irreversible decisions、one-thing MVP、weekend test、3-of-10 payment proof、10+ paying before productize、first-customer circles、100 paying before launch、charge-from-day-one、customer-1 profitability、spend time before money、minimalist review 和 default alive 思路，并把这些原则回写到 requirement-intake、brainstorm 和 PRD 结构。',
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
      '- 前端设计框架：先判断要借的是主题锁定、布局骨架、组件清单、事实前置、素材前置、图片前置还是质量门；把可迁移原则落回 `.openprd/design/`、repo-local skill、hooks 或测试，不要停留在“参考了几个好看页面”。',
      '- CLI 与开发者体验：命令是否可发现、可组合、可预测；错误信息是否说明发生了什么、影响是什么、下一步怎么做；危险操作是否有确认。',
      '',
      '## 设计输出',
      '',
      '- 给出 OpenPrd 应该内置什么、生成什么、路由什么、保留什么门禁。',
      '- 如果来源本质上在讲 0 到 1 验证或创业判断，优先把“社区契合 -> 当前替代与痛点证据 -> 手工/表单/no-code 桥接 -> 付费验证 -> 产品化门槛 -> 增长纪律”落到 requirement-intake、brainstorm、PRD 模板和 hook 提示里，而不是只加一条灵感备注。',
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
      '4a. `openprd init/setup/update/doctor` 可能会把 Context7、DeepWiki 这类非阻断式增强能力写进 `.openprd/harness/install-manifest.json` 的 `optionalCapabilities`。把它当成软建议：初始化、诊断和当前任务都不因它失败；只有当当前任务会明显受益时，才在后续建议里解释能力价值、附官方文档 / GitHub 链接，并视情况提出可代为补配置。',
      '5. 涉及最佳实践、benchmark、对标、参考产品、prompt engineering、Agent harness、context engineering、图标资源、CLI 或 skill 体系设计时，先使用 `$openprd-benchmark-router`。',
      '6. 先用 `$openprd-requirement-intake` 做需求类型语义分流：直接处理(L0)可直接处理并事后说明，不打开正式 PRD/review/change/tasks；现有功能优化(L1)给对话内 mini-plan 后执行，默认不生成正式 PRD/change/tasks；只有新功能/新流程方案(L2)在改代码前必须先走需求入口：`openprd clarify .` 会生成需求入口自省，并只在对话内输出澄清摘要或简短清单；正式 HTML 评审留给后续 review。若当前问题本质上还在判断值不值得做、先找谁验证、能不能先手工交付，就先补“创业验证透镜”，不要急着把方案写成既定需求。',
      '6a. 任何界面、页面、视觉、样式或前端体验任务在进入实现前，都要额外读取 `$openprd-frontend-design`，并优先检查 `.openprd/design/active/` 下是否已经补齐 `facts-sheet / asset-spec / image-preflight / direction-plan / selected-direction`。',
      '7. 事实缺失时，先用 `openprd clarify .` 生成需求入口自省，并在对话里先按“需求判断 / 需求理解 / 功能范围 / 技术方案”给 requirement 摘要；其中“功能范围”和“技术方案”优先用 Markdown 表格，分别写清 `功能模块 | 这次先做什么 | 这次先不做什么` 与 `技术部分 | 初步方案 | 主要负责什么`。`需求判断` 和 `需求理解` 先用 1 到 2 句轻量主句说清这次是什么、核心问题和第一版目标；边界、风险、异常例子和技术细节下沉到后续分项或表格，不要揉成一大段长话，也不要把某条示例文案写成固定模板。若当前更像 0 到 1 验证，摘要里还要主动抬出：第一批最容易触达的社区或种子用户、你为什么算这个社区里的自己人、当前替代方案和痛点证据、先怎么手工交付、手工作战卡怎么写、第一版只做哪一件事、能不能压成周末级 MVP、能不能先用 spreadsheet / 表单 / no-code 跑起来、第一批客户路径、从第一个客户开始怎么收费、客户 1 如何打平成本、有没有 10 个样本和更强付费信号、达到什么条件才允许产品化、增长阶段守什么纪律、这条路是否可逆、是否真在解决客户问题、是否符合团队价值观、是不是你愿意长期住进去的业务形态，以及最低成本先验证什么和验证阶段怎样先活下来。确认该 requirement 摘要后，再用 `openprd capture .` 写回已确认事实，并继续 classify/synthesize/review、生成或检查 change、拆任务。如果用户的下一条回复只是承接上一轮 requirement 摘要的短跟进，而不是提出新范围、改目标或重新发起分析请求，就把它当成对上一轮摘要、默认方向或选项的继续确认，不要重新开一轮泛化 clarify；应直接按当前对话上下文把已确认事实用 canonical capture 路径、`user-confirmed` 来源写回，而不是继续写 `agent-inferred/project-derived` 的用户澄清字段。`clarifyPresentation.mode` 为 `inline` 或 `inline-with-checklist`，直接在对话中先整理首轮项目画像：用户群体、产品形态、第一版切片、暂不处理、不能破坏和风险探针，再压缩成用户容易看懂的总分结构，不打开澄清 HTML。L2 的首轮澄清只能承诺“我先整理需求摘要给你确认，确认后再进入 PRD / review 流程”；不要写成“你回我一句我就开始实现”，也不要把 requirement 摘要确认、review 和实现合成一步。review 重点摘要胶囊应控制在 15 个字以内，作为扫读标签，不写成长句；对用户给稳定 artifact 路径，确认命令使用页面复制出的 `--version`、`--digest` 和 `--work-unit`，不要把可被其他对话覆盖的 active review 当成唯一确认入口，也不要把“可以开做”“继续实现”、单纯的“请帮我实现”，或单独一句“不要评审”当成 `review --mark confirmed` 或 requirement 写入路径的依据。生成 spec 和 tasks 时跟随用户当前主语言；无法判断时使用简体中文兜底。必要专有名词、品牌名、命令名、路径、字段名和 API 术语可以保留原文；如果只是纯内部措辞整理，可用 `openprd capture . --source agent-normalized` 写回，这类非语义规范化不应重开用户 review。默认 approval policy 是 decision-points：需要时保留稳定 `review.html`，但只有用户明确表示不需要进行任何确认时，才允许跳过 requirement 摘要确认并按当前稳定 artifact 的精确 `version + digest + work-unit` 静默记录 review；单纯的“请帮我实现/继续实现”不触发这个豁免。若用户刚刚已经确认了现有功能优化（L1）的 mini-plan、范围边界或正式产品边界，后续承接要写成“已确认，我按这个继续”，不要写成“确认，我们就按这个……”这类像再次索取确认的句子。若用户原始意图已明确要求实现，则在当前 approval policy 满足且 tasks 就绪后直接进入执行；否则先输出执行确认清单，列出本轮目标、将执行内容、不做事项、验证方式和已知风险，再请求明确执行授权，不能只要求用户回复一句确认。',
      '8. 评审页里的需求关系图、需求流程图和重点摘要不要靠 HTML 截断；`openprd synthesize` 生成版本快照后，不要直接让用户确认 review。必须先用 `openprd review-presentation . --template` 查看展示文案契约，让 Agent 按 reviewPresentation 写短文案，再用 `openprd review-presentation . --presentation <json> --write --fail-on-violation` 校验并写回；脚本会在通过后写入校验元信息并重渲染可确认 review.html。超限时按脚本返回的 jsonPath 和字数限制重新提炼，不手工改快照、不裁剪原文。',
      '8a. 界面、页面、视觉、样式或前端体验需求要额外判断 UI 影响面：若会明显改变信息架构、核心布局、主视觉、关键路径、组件层级/密度，或用户需要先选设计方向，先做“大界面改动视觉方案评审”。在 PRD 定稿或实现开工前，已有界面时用 Codex Computer Use 截取产品内对应功能当前界面，冷启动没有现有界面时基于已确认 PRD、用户群体、第一版切片和视觉目标生成设计 brief；brief 必须写清用途、受众、气质端点、约束和记忆点；再用 `imagegen`（Codex 原生 Image 2）生成至少 3 个不同设计思想方向，横向拼接为一张左上角标注 1/2/3 的大图作为候选效果图展示。主动确认是否符合预期、是否纳入后续效果图/实现截图对比、以及是否按此继续实现；只有确认后才把选定方向、整张图或其中子图整理到 `.openprd/harness/visual-reviews/`。',
      '8b. 3 个方向不能只是同一种安全解的轻微变化。至少要在 `.openprd/design/active/direction-plan.md` 里区分不同生成逻辑、适用场景、审美主张、记忆点和主要风险；没有品牌或参考图依据时，用 anti-slop 排除默认紫白/蓝紫渐变、通用字体、白底卡片堆叠和无语境装饰；一旦用户确认方向，先在 `.openprd/design/active/selected-direction.md` 锁定选中的 lens、theme、layout、组件、审美主张和记忆点，再进入编码。',
      '9. 对外说明默认用业务和产品语言，先给结论和下一步；涉及第三方 API、模型、云服务或付费工具时，用表格比较多家方案的效果、价格、接入成本、限制、风险和推荐理由，默认选择性价比最优；当用户的问题包含多个对象、方案、文件、场景、风险、验证项、素材或任务，并且需要同时呈现状态、证据、影响、动作或推荐时，主动使用 Markdown 表格，单一结论、代码示例、命令示例和叙事型说明不要强行表格化。',
      '10. 当 PRD 需要进入实现准备时，再运行 `openprd change . --generate --change <id>`。',
      '11. change/tasks 就绪后，用 `$openprd-test-strategy` 为每个任务确认 test-layer、test-size、test-scope、evidence-plan、升级原因或豁免原因；小改动从单测开始，触达契约、用户主路径、视觉、小程序、性能、安全或成本风险时升级验证层级。并且同步按 execution strategy 标注 `serial / parallel-workers / parallel-workers-isolated`、`write-scope`、`owner-role`、`local-verify` 和 `integration-owner`，让主 Agent 可以做 worker 分片和最终审查。',
      '12. 长程实现使用 `openprd loop . --plan --change <id>`，并且只有用户明确要求开发、继续任务、深度调研、对标复刻或 commit 时才执行单任务 fresh session。中等规模 L1/L2 任务可先用 `parallel-workers` 让主 Agent 分配多个 worker shard；达到长程阈值后再升级到隔离 loop 会话。',
      '13. 代码修改完成后、最终回复前，针对本轮实际 touched code files 运行 `openprd dev-check . <file...>` 或 `node scripts/openprd-dev-check.mjs . <file...>` 回顾行数状态：700 行以内正常，701-1500 行需注意，超过 1500 行警告。若出现需要关注的文件，最终回复必须以 **后续建议** 为标题，直接复用 dev-check 生成的 Markdown 表格，列出影响对象、关注程度、规模信号、预警原因、本次处理结果和后续建议，并按 🔴 → 🟠 → 🟡 排序；不要把“关注程度”列改写成纯 emoji，必须保留例如 `🟠 中风险｜建议优先关注` 这类完整标签；如果你改写了“预警原因 / 本次处理结果 / 后续建议”，先用 `node scripts/dev-check-wrapup-copy.mjs --validate` 校验每格不超过 20 字；若报错，按提示缩短后重试；若只是窄 bugfix 或小修暂不拆，在表格里说明本次处理结果和后续建议。',
      '14. 如果执行中发现新代码后缀、豁免路径、命令别名、项目约定或用户偏好，不要中途打断任务。代码扩展识别这类白名单工具补全会自动应用并记录；用户偏好、项目协作规矩和 OpenPrd 默认行为形成 growth candidate，收工时用 `openprd grow . --review` 集中确认。',
      '15. 维护 OpenPrd 本身时，只要新增或修改配置类能力（阈值、规则、识别、豁免、命令别名、环境差异、用户偏好或策略开关），默认先做 grow-aware 自检：高置信应可成长时直接纳入 `openprd grow` 体系；不确定时主动询问用户是否做成可成长配置。',
      '16. 实现过程中，每次新增或修改文件都做文档影响检查，补齐缺失的 `docs/basic/`、文件说明书和文件夹 README，并更新受影响文档；涉及后端、脚本、Agent、工具链、服务或数据处理变更时，把 CLI 与 API 视为同级接入面：同步检查命令入口、参数、输出契约、`help`、`doctor`、`dry-run`、`status` 与接口协议、返回结构、身份边界是否受影响，并更新 `docs/basic/backend-structure.md` 或明确写不适用原因。',
      '16a. 如果这轮实现补充了新的前端设计主题、布局骨架、组件 recipe 或 anti-slop 规则，同步更新 `.openprd/design/` 与 `docs/basic/frontend-guidelines.md`，不要只留在代码里。',
      '17. 用户要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup、先看样子或先确认设计方向时，默认直接调用 `imagegen`，也就是 Codex 原生 Image 2，产出图片；Image 2 是工具路径，不是审美豁免。生成前先写清用途、受众、气质、约束和记忆点，并用 anti-slop 避免默认紫白/蓝紫渐变、通用字体、白底卡片堆叠和无语境装饰。对 logo、icon、avatar、badge 等开发素材，如果用户未明确要求 mockup、场景图、设备框、卡片承载、名片/包装展示或参考界面复刻，默认按独立素材输出（standalone asset）处理：使用全画布单主体，不额外添加 UI frame、卡片、设备壳、名片、桌面陈列、手持实拍或其他展示容器。只有当用户明确要求 mockup、场景化效果图、容器化呈现，或参考图本身包含这些结构时，才生成对应容器或场景；除非用户明确指定 HTML、SVG、CSS、Canvas、代码稿或可编辑矢量/source artifact，不要改用临时 HTML/SVG/CSS 再截图。只有实际发生 `imagegen` 调用后，才能汇报生图结果、失败或限流。OpenPrd 的 `review.html` 只用于需求评审，不能替代图片或效果图生成。若用户目标是把本次工作转成可学习、可复用、可回看或可教学的材料，先按产物形态判断是否需要 `openprd learn .` 的学习包和阅读器；不要用关键词表触发，普通 Markdown 只能作为辅助讲义。“请生成一份仙侠风格的学习材料”这类短请求也按学习型交付物处理，仙侠等风格是题材参数。',
      '18. 用户要求界面更好看、更稳定、有一致审美、能复用视觉资产或内置模板时，先路由到 `$openprd-frontend-design`。',
      '18. 大界面改动进入实现前，先把 3 方向效果图当候选效果图展示给用户，并主动确认是否符合预期、是否纳入后续效果图/实现截图对比、以及是否按此继续实现；只有确认后才把选定方向、整张图或其中子图整理成 reference-set 并写入 `.openprd/harness/visual-reviews/`。冷启动没有现有界面、新建首屏、首页、控制台或核心页面时，即使没有修改前截图，也要基于 PRD、用户画像、用途、气质和记忆点先出 3 个方向。进入实现后，如果已经有确认参考图、设计稿、图片资产或用户给图，阶段性完成后先截实现图，再运行 `openprd visual-compare . --reference <效果图> --actual <实现截图> --locale <zh-CN|en>`。如果一张参考图里包含多个子图、网格或对象，先运行 `openprd visual-prepare` 生成 reference-set、contact sheet 和模板，再逐项对比。如果没有明确参考图，先判断新建界面还是修改既有界面：新建界面先完成 3 方向方案评审，修改既有界面动手前先截修改前截图，完成后用同一入口、视口、账号和数据状态截修改后截图，再运行 `openprd visual-compare . --before <修改前截图> --after <修改后截图> --locale <zh-CN|en>`。如果重点在局部变化，或局部细节需要放到同一张证据板里审阅，默认再补一份 `openprd visual-compare . --board <focus-board.json> --locale <zh-CN|en>` 的局部焦点证据板，把局部变化组合到同一张证据板里统一验收；如果普通截图、Computer/Browser/Playwright 实测截图要作为证据，默认补 `openprd visual-compare . --board <verification-board.json> --locale <zh-CN|en>` 的截图实测证据板；如果界面包含同构列表、卡片、网格或表格，默认补 `openprd visual-compare . --board <alignment-board.json> --locale <zh-CN|en>` 的对齐辅助线证据板，且同一张板里要同时覆盖容器轨道和内部内容槽位轨道；如果单个 logo、icon、avatar、badge、按钮图形或图片内部需要居中判定、视觉重心评估或用户反馈偏心，默认补 `openprd visual-compare . --board <centering-board.json> --locale <zh-CN|en>` 的内部居中证据板，且同一张板里要显示红色画布中心、绿色主体外接框和黄色视觉重心。默认输出 JPG 到 `.openprd/harness/visual-reviews/`；查看合成图后继续复核，直到预期变化出现，且气质、层级、字体/色彩/表面角色、记忆点和未改区域都没有明显漂移。用户后续如果说“跟效果图”“不一致”“好丑”“复刻”，不能只口头说对比过了，至少产出一份视觉证据图。',
      '18a. 卡片宽度、间距、留白、对齐、颜色、圆角、字号、按钮或图标等轻量 UI 可视优化，仍可按 L0/L1 小范围修正推进，不自动升级成大界面 3 方向方案评审；但动手前要有一句审美意图和记忆点，收口时必须有 `visual-compare` 修改前后图、局部焦点证据板、截图实测证据板、对齐辅助线证据板或内部居中证据板，并检查气质、层级、颜色、字号、间距和表面角色是否成立。只要界面里有同构列表、卡片、网格或表格，就把容器轨道以及标题、副标题、描述、标签、状态、价格、按钮、图标、操作区等相同文案类型/相同组件槽位的对齐当作默认验收项，不等用户先投诉；只量外框、列宽或行顶不算完整对齐验收。只要任务在判断单个素材/图标/头像/徽标/按钮图形的内部居中、偏心或视觉重心，就把 centering-board 当作默认验收项；单张原始截图或主观“看起来居中”不算完整居中验收。build、package、dev-check 和单张原始截图不能替代。',
      '19. 声称单个 task 完成前，运行本任务 verify/dev-check/必要界面验证，并通过 `--evidence`、测试报告或任务 metadata 留下 task-scoped evidence；不要把全局 `openprd run . --verify` 当作 per-task 默认。',
      '20. 阶段收口、全部实现完成、handoff/commit/release/publish 前，运行 `openprd standards . --verify`、`openprd quality . --verify` 和 `openprd run . --verify`，把 HTML 质量评估报告当作整体 EVO 门禁、日志、业务成本与滥用护栏、测试策略矩阵、冒烟覆盖、性能、极端场景和项目知识的评审产物；L2 或跨页面实现的最终回复必须列出最新 HTML 质量报告和 task-scoped Markdown/HTML 测试报告路径。最终回复优先复用 `run . --verify` 的 `taskReady/workspaceReady` 拆分，不要把任务通过和工作区欠账混成一句泛化尾巴。',
      '21. `AGENTS.md` 只保留轻量合同；入口路由看 `$openprd-router`，具体命令速查看 `.openprd/harness/command-catalog.md`，更细的工作流步骤、路由边界和 hook 门禁以这份 skill、`$openprd-shared`、`$openprd-test-strategy` 和 `$openprd-benchmark-router` 为准。',
      '22. hook 会强制阻断几类场景：需求入口未完成就写实现、外部证据不足就直接改第三方集成、skill/AGENTS 变更未先可视化确认、以及敏感信息场景下直接读原始 vault 文件。',
      '',
      '## 门禁协议',
      '',
      '- 不要跳过 `openprd run . --context`；它是最适合 hooks 的控制面。',
      '- 不要把 `run --context` 里的建议当成直接用户命令。',
      '- 面对“看看、规划、梳理、分析、评估、怎么改、预计动哪些文件、review、explain”等只读意图，不运行 OpenPrd 写入命令。',
      '- 现有项目需求仍模糊时，优先 discovery，再考虑 synthesize。',
      '- 进入定稿或交接前，运行 `openprd run . --verify` 并确认 review blocker 已关闭。',
      '- 声称实现就绪前，审阅最新 `.openprd/quality/reports/*.html` HTML 质量评估报告；若 `taskReady=true` 且 `workspaceReady=false`，先明确写“当前任务通过，工作区待关注”，再列出缺证据或待关注门禁；如果只剩 `feature-coverage`，说明是任务账本或覆盖证据未收口，不要把本次功能表述成失败。',
      '- accepted spec 推进前，先运行 `openprd change . --validate --change <id>`。',
      '',
      '## hook 驱动循环',
      '',
      '- 把 `.openprd/harness/run-state.json` 和 `iterations.jsonl` 当成持久循环状态。',
      '- 默认 lite hooks 不记录每一轮工具细节，但会在明确 OpenPrd / 深度工作提示词和产品、模块、流程需求下注入上下文；复杂或模糊需求提示先做三轮 Requirement Intake Reflection，轻量写入门禁会阻断过早改代码；本轮准备结束时再通过 `Stop` 做一次轻量项目经验回顾，并要求 Agent 先用人话明确“这条经验只会保留在当前项目里”，再向用户确认是否保留。',
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
      '- 只有在任务 verify 命令和 task-scoped evidence 通过后，才用 `openprd loop . --finish --item <task-id> --evidence <path-or-summary>` 收尾；如果用户明确要求 commit，再先通过高风险最终门禁。',
      '- 前端界面任务里，Codex desktop 优先用 Computer Use；Codex CLI 和 Claude Code 优先用 Playwright、MCP 浏览器自动化或项目现有 e2e 工具。大界面改动进入实现前，先按用户目标、信息架构变化、视觉决策成本和验证风险判断方案评审形态：已有界面时 Codex desktop 必须优先用 Computer Use 获取产品内当前功能截图；冷启动没有现有界面时，基于已确认 PRD、用户群体、第一版切片和视觉目标生成设计 brief。',
      '- 用户只是要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup 或先看样子时，默认调用 `imagegen`（Codex 原生 Image 2）生成图片；Image 2 是工具路径，不是审美豁免，生成前先写清用途、受众、气质、约束和记忆点，并用 anti-slop 避免默认紫白/蓝紫渐变、通用字体、白底卡片堆叠和无语境装饰；对 logo、icon、avatar、badge 等开发素材，如果用户未明确要求 mockup、场景图、设备框、卡片承载、名片/包装展示或参考界面复刻，默认按独立素材输出（standalone asset）处理：使用全画布单主体，不额外添加 UI frame、卡片、设备壳、名片、桌面陈列、手持实拍或其他展示容器。只有当用户明确要求 mockup、场景化效果图、容器化呈现，或参考图本身包含这些结构时，才生成对应容器或场景；除非用户明确指定 HTML/SVG/CSS/Canvas/代码稿，不要生成临时 HTML 再截图；未调用 `imagegen` 前，不要声称生图已完成、失败或限流。',
      '- 如果场景判断属于大界面改动，已有界面时基于产品截图生成至少 3 个设计方向；冷启动没有现有界面时基于已确认 PRD、用户群体、第一版切片、视觉目标、气质端点和记忆点生成至少 3 个设计方向；再横向拼接成带 1/2/3 序号的大图作为候选效果图给用户确认，并主动确认是否符合预期、是否纳入后续效果图/实现截图对比、以及是否按此继续实现。只有确认后才把选定方向、整张图或其中子图整理到 `.openprd/harness/visual-reviews/`。如果已有确认参考效果图、图片资产或用户给图并进入实现阶段，阶段性完成后必须生成实现截图，并用 `openprd visual-compare . --reference <效果图> --actual <实现截图> --locale <zh-CN|en>` 输出 JPG 视觉对比图；如果参考图里有多个子图、网格或对象，先运行 `openprd visual-prepare` 生成 reference-set、contact sheet 和模板，再逐项对比；如果没有明确参考图，先判断新建界面还是修改既有界面：新建界面先完成 3 方向方案评审，修改既有界面动手前先截修改前截图，完成后截修改后截图，并用 `openprd visual-compare . --before <修改前截图> --after <修改后截图> --locale <zh-CN|en>` 输出 JPG 自检图。普通截图或 Computer/Browser/Playwright 实测截图也必须拼成 `verification-board` 截图实测证据板后才能作为视觉收口证据；同构列表、卡片、网格、表格必须拼成 `alignment-board` 对齐辅助线证据板后才能声明相同槽位已对齐，且同一张板要同时覆盖容器轨道和标题/副标题/描述/标签/状态/价格/按钮/图标等内部内容槽位；单个素材/图标/头像/徽标/按钮图形/图片内部居中或视觉重心判断必须拼成 `centering-board` 内部居中证据板后才能声明居中完成，且同一张板要同时展示画布中心、主体外接框和视觉重心偏移。未查看对比图，或对比图仍有结构、气质、层级、字体/色彩/表面角色、记忆点差异/漂移时，不要声称界面视觉完成；如果用户后续说“跟效果图”“不一致”“好丑”“复刻”，至少先产出一份视觉证据图。',
      '- `openprd loop . --finish` 会写入 `.openprd/harness/test-reports/<task-id>.md` 和 `.openprd/harness/test-reports/<task-id>.html`；把这两份结构化测试报告和任务改动一起提交。',
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
      '研发期代码修改完成后、最终回复前，运行 `openprd dev-check . <file...>` 或 `node scripts/openprd-dev-check.mjs . <file...>`；该标准层只检查本轮实际 touched code files 的行数状态，不替代 `standards --verify`；需要关注的文件会提供“后续建议”表格行，最终回复应按 🔴 → 🟠 → 🟡 的顺序呈现。',
      '当 dev-check 识别出新的代码扩展名时，会自动补齐识别规则并记录；豁免路径、项目规矩、用户偏好或 OpenPrd 默认行为只作为候选留到收工复盘，用 `openprd grow . --review` 集中确认。',
      '维护 OpenPrd 本身时，新增或修改任何配置类能力都要检查是否应该成为 grow-aware 配置：高置信可复用、可被用户习惯影响、会随项目环境变化的配置默认纳入 `openprd grow`；不确定时主动询问用户；一次性固定规则才保留为静态配置。',
      '',
      '## 文档影响检查',
      '',
      '- 编辑前先识别本次会变化的文件、文件夹、用户流程、架构边界、依赖和产品行为。',
      '- 代码修改完成后用 dev-check 回顾行数：`ok` 可正常收尾；需要关注的文件必须在最终回复以 **后续建议** 表格呈现，并按 🔴 → 🟠 → 🟡 排序；直接复用 dev-check 生成的表格，保留“关注程度”列里的完整风险标签，不要缩成纯 emoji。',
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
      '- 单个任务完成后只保留 task-scoped evidence；阶段收口或整体实现完成后，再用 `openprd quality . --verify` 审查 HTML 质量评估报告里的场景标签、必需 EVO 门禁、日志、业务护栏、冒烟覆盖、性能和知识缺口。',
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
      '当用户目标是学习、复盘、教学、经验沉淀或把一次工作转成可长期阅读的材料时，先判断期望产物是否需要章节结构、证据锚点、图文讲解、检索练习或阅读体验；需要时默认走这条路径。普通 Markdown 可以作为讲义补充，但不能替代阅读器；这个判断基于场景和产物形态，不基于关键词表。',
      '即使用户只说“请生成一份仙侠风格的学习材料”这类短请求，也先把它理解成学习型交付物；仙侠、科幻、童话等风格是题材/文体参数，不能成为绕过学习包和阅读器流程、只在聊天里写普通文章的理由。',
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
      '- `openprd grow . --review`：审查执行中发现的可复用配置、规则候选或 user-local 偏好；和 `quality --learn` 互补，前者沉淀操作配置，后者沉淀已验证质量经验。若 `quality --learn --review` 命中项目经验候选，先在最终回复结尾用人话说明“本次情况 / 计划保留的经验 / 以后怎么复用 / 只保留在当前项目里”，再询问用户是否保留。',
      '',
      '## 审查契约',
      '',
      '- 场景画像：先判断当前变更是基础、前端、桌面端、后端、成本、安全、性能、极端数据还是发布交付场景，再确定必需 EVO 门禁。',
      '- 可观测性：确认中心化 logs / traces / errors、共享 trace/request/task/error id、脱敏、保留期和查询示例。',
      '- 业务护栏：涉及免费用户、额度、AI 调用、第三方 API、生成、存储或下载时，确认成本来源、用户级限制、负向验证、监控、报警和止损动作。',
      '- 评估执行环境：确认冒烟测试、任务到功能覆盖、正常性能基线和极端数据压力场景；脚本存在只代表能力，不能替代本次运行证据。',
      '- 大界面改动证据：先按用户目标、信息架构变化、视觉决策成本和验证风险判断是否需要方案评审；需要时确认候选效果图已经给用户看过，并且每个方向有清楚的用途、受众、气质端点、审美主张和记忆点；用户已明确确认哪个方向、整张图或哪些子图纳入后续对比；只有确认后的 reference-set 才应出现在 `.openprd/harness/visual-reviews/`。',
      '- 视觉评审证据：涉及界面视觉实现且已有确认参考效果图时，确认 `.openprd/harness/visual-reviews/` 下存在本次 `openprd visual-compare` 输出的“效果图 / 实现截图”JPG，并且 Agent 已基于合成图复核差异；如果参考图来自整板、网格图或多对象候选图，确认已完成 `openprd visual-prepare` 产出的 reference-set、contact sheet 或 board 模板审查。没有参考图时先按场景区分新建界面和修改既有界面：新建界面确认实现前 3 方向方案评审已完成，修改既有界面确认存在“修改前 / 修改后”JPG，并已检查预期变化和未改区域漂移；若验收关注局部细节，确认存在“局部焦点证据板”；若并行跑了多个优化方向，确认存在“并行实验证据板”；若使用普通截图或 Computer/Browser/Playwright 实测截图作为证据，确认存在“截图实测证据板”；若新功能或改动包含同构列表、卡片、网格、表格，或用户反馈排版没对齐，确认存在“对齐辅助线证据板”，并同时包含容器轨道 spread 和标题/副标题/描述/标签/状态/价格/按钮/图标等内部内容槽位 spread 量测；若用户反馈或任务目标是单个素材/图标/头像/徽标/按钮图形/图片内部居中、视觉重心或偏心，确认存在“内部居中证据板”，并同时包含主体外接框中心偏移和视觉重心偏移。这些证据不只查有无图片，还要查气质、层级、字体/色彩/动效/表面角色和记忆点是否成立。',
      '- 轻量 UI 可视优化证据：卡片宽度、间距、留白、对齐、颜色、圆角、字号、按钮或图标等小改仍属于用户可见变化。质量审查时至少确认存在修改前后视觉对比、局部焦点证据板、截图实测证据板、对齐辅助线证据板或内部居中证据板，并且本轮审美意图、气质、层级和记忆点已被复核；build、package、dev-check、单元测试或单张原始截图都不能替代视觉收口证据。',
      '- HTML 报告：把 `.openprd/quality/reports/*.html` 当成面向人的评审产物，而不是次级导出。',
      '- 知识沉淀：当某个已验证修复具备重复性、高影响、隐藏性或由 agent 误判引发时，把模式抽象到 `.openprd/knowledge/skills/<skill>/SKILL.md`。',
      '- 自我成长：当问题来自配置缺口、文件识别、命令习惯或用户偏好时，优先记录为 `.openprd/growth` 候选，经用户确认后固化；不要把个人偏好混进项目共享质量经验。',
      '',
      '## 就绪规则',
      '',
      '- `openprd run . --verify` 若显示 `taskReady=true` 且 `workspaceReady=false`，不能宣称整体工作区就绪；先明确区分“当前任务通过，工作区待关注”，再列出未通过门禁。若只剩 `feature-coverage`，说明是任务账本或覆盖证据未收口，不要把本次功能表述成失败。',
      '- 大界面改动缺少实现前 3 方向效果图评审、缺少审美主张/记忆点，或用户未确认方向时，不要进入大 UI 实现；UI 任务有参考图但缺少 visual-compare 输出时，不要宣称视觉实现完成；没有参考图时先判断新建界面还是修改既有界面，新建界面缺少 3 方向方案评审、修改既有界面缺少修改前后截图对比时，都不要宣称视觉自检完成；轻量 UI 可视优化缺少视觉证据或审美复核时，可以说代码或构建已处理，但不要说界面已经优化完成；如果只做了普通截图或 Computer 实测截图而没有截图实测证据板，也不要宣称视觉收口完成；如果界面包含同构列表、卡片、网格、表格却没有对齐辅助线证据板，也不要宣称相同槽位已经对齐；如果 alignment-board 只量了外框、列宽或行顶，缺少标题、副标题、描述、标签、状态、价格、按钮、图标等内部内容槽位，也不要宣称卡片/列表/网格已经对齐；如果对比图仍有明显结构、气质、层级、字体/色彩/表面角色、记忆点偏差或漂移，先返工而不是把差异留给用户发现。',
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
    sourceSkill: 'openprd-diagram-review',
    description: '生成并迭代 OpenPrd 图示产物，供用户确认或理解。适用于解释型 SVG、架构图、产品流程图、用户旅程、流程图、系统边界图、依赖图，以及 freeze 前的可视化评审场景。',
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
      'Treat grow as an end-of-task review layer, not an in-task interruption. Auto-apply whitelisted tool-recognition fixes such as detected code extensions; queue user preferences, project governance rules, and OpenPrd default behavior as candidates, then run `openprd grow . --review` at wrap-up for user confirmation.',
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
      'Run `openprd doctor .` and repair missing AGENTS, skills, commands, hooks, standards, validation gates, or Codex CLI runtime health.',
      'For Codex CLI optional dependency failures, first inspect `openprd doctor . --tools codex`; only run `openprd doctor . --tools codex --fix` when the user explicitly wants OpenPrd to execute the global npm repair command.',
    ].join('\n'),
  },
  {
    id: 'verify',
    title: 'OpenPrd Verify',
    body: [
      'Run `openprd run . --verify`. It verifies standards, workspace validation, the currently focused change structure (not just the global active change), and active discovery state, then reports `taskReady` separately from `workspaceReady`. When `taskReady=true` and `workspaceReady=false`, final reporting must preserve that split; if the only attention gate is `feature-coverage`, describe it as task-ledger or evidence debt rather than a failed implementation.',
    ].join('\n'),
  },
  {
    id: 'visual-prepare',
    title: 'OpenPrd Visual Prepare',
    body: [
      'When one confirmed reference image contains multiple sub-images, grid cells, or objects, run `openprd visual-prepare . --reference <effect-image> --grid <columns>x<rows>` or `--boxes <plan.json>` before implementation comparison.',
      'Treat newly generated images as candidate references until the user confirms they match expectations, should be used for later effect-image vs implementation comparison, and should drive implementation.',
      'The command writes a deterministic reference-set under `.openprd/harness/visual-reviews/reference-sets/<id>/`, including `reference-set.json`, `crops/`, `contact-sheet.jpg`, `focus-board.template.json`, `parallel-board.template.json`, and `compare-plan.json`.',
      'Use `--include <csv>` when the user only wants part of a grid or board to enter later acceptance, instead of blindly carrying the whole image forward.',
      'Always open the generated contact sheet before proceeding, and reject any run where the numbering, crop boundaries, or object completeness look wrong.',
      'After preparation, use `compare-plan.json` for per-item `openprd visual-compare --reference/--actual` commands, or edit the generated board templates when one whole screen needs local-region acceptance.',
    ].join('\n'),
  },
  {
    id: 'visual-compare',
    title: 'OpenPrd Visual Compare',
    body: [
      'When UI work has a confirmed reference effect image or user-provided design, capture the implemented UI screenshot, then run `openprd visual-compare . --reference <effect-image> --actual <implementation-screenshot> --locale <zh-CN|en>`.',
      'Treat newly generated images as candidate references until the user confirms they match expectations, should be used for later effect-image vs implementation comparison, and should drive implementation.',
      'The command creates a side-by-side JPG under `.openprd/harness/visual-reviews/` by default. Labels follow the current user language: Chinese contexts use `效果图` / `实现截图`; English contexts use `Reference` / `Implementation`. Pass `--locale <zh-CN|en>` when the conversation language is known.',
      'When UI work has no reference image, first distinguish new UI from existing UI changes. For new screens, return to the pre-implementation three-direction visual review. For existing UI changes, capture the before screenshot first, implement the change, capture the after screenshot from the same entry, viewport, account, and data state, then run `openprd visual-compare . --before <before-screenshot> --after <after-screenshot> --locale <zh-CN|en>` for a before/after self-check whose labels follow the current user language.',
      'When one reference image contains multiple sub-images, grid cells, or objects, run `openprd visual-prepare . --reference <effect-image> --grid <columns>x<rows>` or `--boxes <plan.json>` first so the agent compares item by item instead of comparing the whole board blindly.',
      'When local detail matters more than the whole screen, prepare a board JSON and run `openprd visual-compare . --board <board.json> --locale <zh-CN|en>` to generate a `focus-board` with overview boxes plus numbered zoom panels.',
      'When the agent explores multiple optimization directions in parallel, use `openprd visual-compare . --board <board.json> --locale <zh-CN|en>` with `mode=parallel-board` to assemble screenshots, GIF first frames, and key metrics into one review board.',
      'When ordinary screenshots or Computer/Browser/Playwright checks are used as visual or runtime evidence, use `openprd visual-compare . --board <board.json> --locale <zh-CN|en>` with `mode=verification-board` to assemble screenshots, checked path, and checkpoints into one screenshot verification board. Board-visible text such as title, summary, labels, notes, and checks must follow the current user language. Raw screenshots are inputs, not final visual closeout evidence.',
      'When a new feature or visible change contains repeated homogeneous cards, lists, grids, or tables, or when the user reports misalignment, capture the real UI, overlay guide lines, measure both container-track spread and internal content-slot spread, and use `openprd visual-compare . --board <board.json> --locale <zh-CN|en>` with `mode=alignment-board` to assemble the screenshot, guides, and metrics into one alignment evidence board. Internal content slots include titles, subtitles, descriptions, tags, status, prices, buttons, icons, and action areas; measuring only card edges, columns, rows, or outer frames is not enough.',
      'When a single logo, icon, avatar, badge, button graphic, or image crop needs internal centering, visual-centroid review, or off-center diagnosis, crop the target if needed and use `openprd visual-compare . --board <board.json> --locale <zh-CN|en>` with `mode=centering-board`. The board must show the red canvas center, green active subject bounds, yellow visual centroid, and metadata for bounding-box center offset plus visual-centroid offset; a raw screenshot or subjective “looks centered” note is not enough.',
      'Lightweight visible UI fixes such as card width, spacing, whitespace, alignment, colors, border radius, font size, buttons, or icons still need visual evidence before claiming the UI is done; state the aesthetic intent and memory point first, then use evidence to check tone, hierarchy, color, type, spacing, surface role, and memory point. Builds, packages, dev-check, unit tests, and raw single screenshots are not substitutes.',
      'Inspect the generated image and keep iterating until there are no obvious structural or aesthetic differences before claiming completion. If the user says the implementation looks wrong, ugly, inconsistent, or asks for replication, do not claim you already compared it without producing at least one visual evidence artifact.',
      'For large UI changes before implementation, decide from user goal, information architecture change, visual decision cost, and validation risk. If an existing screen is available, capture the current in-product screen with Codex Computer Use; if this is a cold-start screen, create a design brief from the confirmed PRD, audience, first slice, visual goal, intended tone, constraints, and memory point. Generate at least three Image 2 directions from that screenshot or brief, each with a distinct aesthetic claim and anti-slop check, combine them into one horizontal numbered contact sheet as a candidate effect-image board, and ask the user whether it matches expectations, should be used for later comparison, and should drive implementation before you store the chosen reference-set under `.openprd/harness/visual-reviews/`.',
    ].join('\n'),
  },
  {
    id: 'run',
    title: 'OpenPrd Run',
    body: [
      'Use the hook-stable OpenPrd execution loop. Start with `openprd run . --context`, inspect the recommended `executionMode` / `parallelPlan`, execute the recommended task/discovery/workflow action, keep per-task verification task-scoped, and reserve `openprd run . --verify` for phase/final readiness or high-risk actions.',
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
      '5. For real Codex runs, OpenPrd preflights `codex --version` before launching the child session. If a Codex optional dependency is missing, diagnose it with `openprd doctor . --tools codex`; only use `openprd loop . --run --agent codex --repair-agent` when the user explicitly approves the global npm repair.',
      '6. Only run `openprd loop . --run` when the current user message explicitly asks to execute development, continue a task, or perform deep research/benchmarking.',
      '7. 每个任务都必须先自测；前端界面任务在 Codex 桌面优先用 Computer Use，在 CLI/Claude Code 优先用 Playwright 或 MCP 自动化。',
      '8. After the session completes, run `openprd loop . --finish --item <task-id> --commit` only when commit is explicitly part of the requested execution.',
      '',
      'Do not continue into the next task inside the same agent session.',
    ].join('\n'),
  },
  {
    id: 'repair',
    title: 'OpenPrd Repair',
    body: [
      'Use `openprd doctor .` to identify drift or missing generated files. Run `openprd update .` for generated guidance drift, repair standards/docs manually, then re-run verification.',
      'Codex CLI runtime repair is explicit: use `openprd doctor . --tools codex --fix` or `openprd loop . --run --agent codex --repair-agent` only after the user accepts that OpenPrd will run `npm install -g @openai/codex@latest`.',
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
    '- `openprd run . --verify`：校验当前 run 门禁，并把 `taskReady` 与 `workspaceReady` 分开报告；如果只剩 `feature-coverage`，表示任务账本或覆盖证据待收口，不等于本次功能失败。',
    '- `openprd doctor .`：检查生成引导、hooks、skills、standards 与验证健康度；`--tools codex` 还会检查 `codex --version`。',
    '- `openprd doctor . --tools codex --fix`：在用户明确同意后运行 `npm install -g @openai/codex@latest`，并在安装后复查 Codex CLI。',
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
    '- 界面、页面、视觉、样式、信息架构或前端体验任务进入实现前，先读取 `$openprd-frontend-design` 与 `.openprd/design/`；优先补齐 `.openprd/design/active/facts-sheet.md`、`asset-spec.md`、`image-preflight.md`、`direction-plan.md`、`selected-direction.md`，再开始编码。如果用户已经给了效果图、设计稿、参考截图或其他明确参考图，先把它当成主参考源：只有现有 starter、theme、layout 足够接近时才复用，不接近就允许偏离默认组合，以参考图为准。空白工作区优先从 `.openprd/design/templates/` 里挑最近模板；如果当前轮用户已经把页面主题、模块范围或“直接实现”的意图说清，优先运行 `openprd run . --context --message <用户原话>`。如果页面主题和模块范围已经明确，优先运行 `openprd design-starter . --starter <starter-id> --out index.html --brief "<页面主题>" --sections "<模块1|模块2|模块3>"` 起第一版真实页面。只有当前页确认不依赖外部产品事实、品牌素材或真实图片，才在 active design artifacts 写清无依赖并补 `--no-external-facts --no-brand-assets --no-real-images`；若题目更像旅游、导览、展览、博物馆、城市、自然观察或案例内容页，先不要带 `--no-real-images`，让 starter 先尝试补首批真实图片；若这类冷启动即使带 message 仍短暂返回 `clarify-user`，把它当成摘要级提醒，先用 3 到 5 行 mini-plan 收口，再继续。starter 落地后默认进入 `Patch Mode`：必须直接在生成的入口文件上补丁修改；即使结构要大改，也是在同一路径内覆盖，不做 delete-first，更不要删除 `index.html` 后另起新稿。如果确实要整页重写，先把完整新稿写到 sibling draft，例如 `index.next.html`，确认内容成形后再覆盖回 `index.html`，不要让正式入口出现空窗。starter 一落地后，只允许做一轮就地对焦：快速读一次生成的入口文件和必要的 active design artifacts；这轮对焦结束后，下一步就必须是真实写入口，不要再回头搜网页、翻 `docs/basic/` 或继续模板漫游。把最后一批必要的查事实、查图、读模板动作放在口头宣布之前做完；一旦已经说“开始覆盖入口文件”或“开始整页重写”，下一步必须出现真实写文件动作，而不是继续只读浏览、压图或停在口头承诺；必要时 hook 会把这类非写入动作挡回去。`Patch Mode` 完成不等于只补合同、只下载素材或只写计划；至少要把入口文件本体改完、主要占位清掉，并把已准备好的真实图片或参考约束真正落进页面。',
    '- `openprd design-starter . --starter <content-home|product-launch|ops-dashboard> --out <index.html>`：把内置页面模板直接落成当前项目入口文件，避免空白工作区卡在“知道该用哪份模板，但还没真正开始写页面”的阶段。若再补 `--brief <页面主题> --sections <模块1|模块2|模块3>`，starter 会同步写实 active design artifacts，并把模板占位替成第一版真实内容。',
    '- 没有明确参考方向时，不要直接落回同一种安全极简解；先在 `.openprd/design/active/direction-plan.md` 里给出 3 个异源方向，至少拉开 lens、theme、layout 或素材策略。',
    '- 大界面改动视觉方案评审：先按用户目标、信息架构变化、视觉决策成本和验证风险判断是否需要方案评审；已有界面时用 Codex Computer Use 截取产品内当前功能截图，冷启动没有现有界面时用已确认 PRD、用户群体、第一版切片、视觉目标、气质端点和记忆点生成设计 brief；再用 `imagegen`（Codex 原生 Image 2）生成至少 3 个设计方向，并横向拼接为一张左上角标注 1/2/3 的大图作为候选效果图。每个方向都要有具体审美主张和 anti-slop 自检。Agent 主动确认是否符合预期、是否纳入后续效果图/实现截图对比、以及是否按此继续实现；只有确认后，才把选定方向、整张图或其中子图整理到 `.openprd/harness/visual-reviews/`，并进入大 UI 实现。',
    '- `openprd change . --generate --change <id>`：把 PRD 转成 change。',
    '- `openprd change . --validate --change <id>`：校验 change 结构。',
    '- `openprd tasks . --change <id>`：查看当前 dependency-ready 任务。',
    '- `openprd tasks . --change <id> --advance --verify --item <task-id>`：运行 verify 并推进单个任务。',
    '- `openprd loop . --plan --change <id>`：为长程实现构建单任务列表。',
    '- `openprd loop . --run --agent codex|claude --dry-run`：准备一个 fresh single-task session。',
    '- `openprd loop . --run --agent codex --repair-agent`：Codex 真实运行前健康检查失败时，显式执行同一全局 npm 修复入口后再重试检查。',
    '',
    '## Benchmark 与学习包',
    '',
    '- `openprd benchmark add <url|repo|file> --notes <text>`：把外部最佳实践先写入 candidate，用于后续 approve/verify。',
    '- `openprd benchmark observe <url|repo|file> --notes <text>`：记录本轮被采纳的外部信源，累计 evidence 和采纳次数；达到阈值后只提示 approve，不自动晋级。',
    '- `openprd benchmark list .`：查看当前项目的 approved 与 candidate benchmark source。',
    '- `openprd benchmark approve <benchmark-id>`：把 candidate 纳入项目级长期 registry。',
    '- `openprd benchmark verify .`：检查重复来源、失效链接、缺场景和过宽触发词。',
    '- `openprd learn . --topic <text> --open`：生成当前项目的学习包骨架和 HTML 阅读器；当用户目标是学习、复盘、教学、经验沉淀或长期阅读，并且产物需要章节、证据锚点、图文讲解、检索练习或阅读体验时，默认先走这条路径。',
    '- `openprd learn . --topic <text> --genre xianxia --open`：短请求如“请生成一份仙侠风格的学习材料”时，把“仙侠风格”作为题材/文体参数；仍然先生成学习包骨架和 reader，而不是只回普通 Markdown。',
    '- `openprd learn . --content-json <file> --open`：让 Agent 写完 `learning-content.json` 后重新渲染最终图文阅读器。',
    '',
    '## 发布与版本',
    '',
    '- `openprd release . --set <0.1.23>`：设置当前项目版本，并启用 release-ledger。',
    '- `openprd release . --notes "<新增 / 修复 / 优化 ...>"`：把本轮用户可感知变化累计到当前项目版本。',
    '- `node scripts/openprd-github-release-notes.mjs . --version <0.1.23> --tag <0.1.23|v0.1.23> --out <file>`：从当前 release-ledger 渲染 GitHub Release 文案；缺少匹配版本或版本条目时直接失败。',
    '',
    '## 视觉与质量',
    '',
    '- `openprd visual-prepare . --reference <效果图> --grid <列>x<行>` / `--boxes <plan.json>`：把整板、网格图或多对象参考图整理成 reference-set，生成 crops、contact sheet 和 board 模板；先检查 contact sheet，再决定哪些对象进入后续实现与验收。',
    '- `openprd visual-compare . --reference <效果图> --actual <实现截图> --locale <zh-CN|en>`：实现阶段已有确认参考图后，输出左右对比 JPG；如果参考图是一张多子图、网格或多对象组合，先运行 `visual-prepare` 整理 reference-set，再逐项对比；对比时同时检查结构、气质、层级、字体/色彩/表面角色和记忆点。',
    '- `openprd visual-compare . --before <修改前截图> --after <修改后截图> --locale <zh-CN|en>`：实现阶段没有参考图时先判断新建界面还是修改既有界面；新建界面回到实现前 3 方向方案评审，修改既有界面输出修改前后自检 JPG，并检查本轮审美意图是否成立。',
    '- `openprd visual-compare . --board <board.json> --locale <zh-CN|en>`：当要审局部细节、整板局部映射或多对象验收时输出“局部焦点证据板”；当并行跑了多个优化方向时用 `mode=parallel-board` 输出“并行实验证据板”；当普通截图、Computer/Browser/Playwright 实测截图要作为证据时用 `mode=verification-board` 输出“截图实测证据板”；当新功能或改动包含同构列表、卡片、网格、表格，或用户反馈没对齐/排版漂移时用 `mode=alignment-board` 输出“对齐辅助线证据板”，叠辅助线并同时量容器轨道与内部内容槽位的 x/y/宽高/baseline spread；当单个 logo、icon、avatar、badge、按钮图形或图片内部需要居中判定、视觉重心评估或偏心排查时用 `mode=centering-board` 输出“内部居中证据板”，用红色画布中心线、绿色主体外接框和黄色视觉重心点量主体外接框中心偏移与视觉重心偏移；证据板必须承接审美意图，不只拼截图。',
    '- 轻量 UI 可视优化（卡片宽度、间距、留白、对齐、颜色、圆角、字号、按钮、图标等）也要留下视觉证据，并先说明审美意图和记忆点；同构列表、卡片、网格或表格的容器轨道，以及标题、副标题、描述、标签、状态、价格、按钮、图标、操作区等相同文案类型/相同组件槽位默认要做对齐验收，不等用户先投诉；只量外框、列宽或行顶不算完整对齐验收；build、package、`openprd dev-check`、单张原始截图不能替代 `visual-compare` 或证据板。',
    '- `openprd dev-check . <file...>`：收工回顾 touched code files 的行数状态与下一步动作；需要关注的文件会给最终回复可直接使用的“后续建议”表格行。',
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
    '- OpenPrd 自身发布到 GitHub 的新版本，默认要同时具备匹配的项目版本、版本 tag 和 GitHub Release；只有 push/tag 没有 Release 不算发布闭环。',
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

function resolveCursorHome(options = {}) {
  return options.cursorHome
    ?? process.env.OPENPRD_CURSOR_HOME
    ?? process.env.CURSOR_HOME
    ?? cjoin(os.homedir(), '.cursor');
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
  if (current && !current.includes(OPENPRD_GENERATED_MARKER) && !options.force) {
    changes.push({
      path: rel,
      status: 'skipped-user-file',
      reason: 'missing-generated-marker',
      message: 'Existing file has no OPENPRD:GENERATED marker; preserved as a user file.',
      repairHint: `Review ${rel}; run openprd update . --force to replace it with the canonical OpenPrd generated file if appropriate.`,
    });
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
    '- `$openprd-requirement-intake`：需求入口分流、用户可见需求类型与内部 L0/L1/L2 路由码对照、PRD 场景视角选择，以及创业验证闭环。',
    '- `$openprd-test-strategy`：测试策略分流、分层验证、任务级 evidence-plan、升级原因与豁免理由。',
    '- `$openprd-harness`：主工作流、`run/loop`、review/change/tasks 与执行节奏。',
    '- `$openprd-frontend-design`：前端设计框架、审美资产库、设计主题/骨架/组件/配方/模板，以及事实、素材、图片和方向前置门。',
    '- `$openprd-benchmark-router`：外部技术、公开 GitHub 仓库、benchmark/对标/最佳实践路由。',
    '- `$openprd-standards` / `$openprd-quality`：`docs/basic/`、就绪验证、EVO 门禁、知识沉淀。',
    '- `$openprd-diagram-review` / `$openprd-discovery-loop`：可视评审与长时间只读挖掘。',
    '',
    '### 默认行为',
    '',
    '1. 动手前先从 `.openprd/` 重建状态，并先运行 `openprd run . --context`；它是建议上下文，不是自动执行指令。',
    '2. 规划、分析、架构评审、“怎么改”或“会动哪些文件”类请求保持只读；只有用户明确要求实现、继续任务、深度调研、对标复刻或提交时才进入执行。',
    '3. 先分流再执行：`openprd-requirement-intake` 按影响面、未知数、决策成本和验证成本判断需求类型，并保留内部路由码对照：直接处理=L0，现有功能优化=L1，新功能/新流程方案=L2。用户审查默认把路由码并进“需求类型：直接处理（L0）”这类标签里；只有内部排障确实受益时，才额外附“内部路由码”。直接处理类需求可直接处理并事后说明，不打开正式 PRD/review/change/tasks；现有功能优化先在对话内给 mini-plan 再执行，默认不生成正式 PRD/change/tasks；如果用户刚刚已经确认了 L1 mini-plan、范围边界或正式产品边界，后续承接要写成“已确认，我按这个继续”，不要用“确认，我们就按这个……”这类像再次索取确认的句子。只有新功能/新流程方案才先走 requirement intake、对话内 requirement 摘要确认，再 `review/change/tasks`，最后才实现。L2 的 requirement 摘要默认按“需求判断 / 需求理解 / 功能范围 / 技术方案”来写，其中“功能范围”和“技术方案”优先用 Markdown 表格，帮助用户一眼看清；`需求判断` 和 `需求理解` 先用 1 到 2 句轻量主句说清这次是什么、核心问题和第一版目标，边界、风险、异常例子和技术细节下沉到后面的分项或表格，不要把它们都塞进一整段长话里，也不要把某条示例文案写成固定模板。若当前仍在 0 到 1 探索、脑暴或值不值得做的判断，摘要里还要主动补上“验证与创业闭环”：第一批最容易触达的社区或种子用户、你为什么算这个社区里的自己人、当前替代方案和痛点证据、先怎么手工交付、手工作战卡怎么写、能不能先用 spreadsheet / 表单 / no-code 跑起来、如果必须开始做产品也只自动化最重复的一步并先压成 forms / lists / CRUD 骨架、第一版只做哪一件事、能不能压成周末级 MVP、第一批客户路径、从第一个客户开始怎么收费、客户 1 如何打平成本、有没有 10 个样本和更强付费信号、达到什么条件才允许产品化、增长阶段守什么纪律、这条路是否可逆、是否真在解决客户问题、以及是否符合团队价值观、是不是你愿意长期住进去的业务形态。L2 的首轮澄清只能承诺“我先整理需求摘要给你确认”，不能把 requirement 摘要确认、review 和实现压成一句“你回我一句我就开始实现”。如果 `openprd run . --context` 仍然建议 `clarify-user`，当前这轮回复的目标就只能是 `需求摘要` 或 `1 个最高价值澄清点`，不要写成“我先按默认方案实现”。如果用户的下一条回复只是承接上一轮 requirement 摘要的短跟进，而不是提出新范围、改目标或重新发起分析请求，就把它当成对上一轮摘要、默认方向或选项的继续确认，不要重新开一轮泛化 clarify；应直接按当前对话上下文把已确认事实用 canonical capture 路径、`user-confirmed` 来源写回，而不是继续写 `agent-inferred/project-derived` 的用户澄清字段。单纯的“请帮我实现/继续实现”只表示有执行意图，不表示可以跳过 requirement 摘要确认、`capture/classify/synthesize` 写入路径或 review；只有用户明确表示“不需要进行任何确认”时，才允许静默走完整 requirement write path。`review.html` 是稳定评审 artifact，不再默认等于唯一的人类停顿点；默认按 decision-points approval policy 执行，只有当前 lane 仍要求人类决策时才在 final answer 主体里停下请求确认；当 review 已确认且 tasks 已就绪但还需要执行授权时，先给执行确认清单再请用户确认。',
    '4. change/tasks 就绪后，用 `openprd-test-strategy` 按风险选择单元、集成、端到端、人工、视觉、小程序、性能或安全验证组合，并在任务或报告中保留 evidence-plan；同时根据任务边界记录 execution strategy：小范围修正保持 `serial`，中等规模 L1/L2 可推荐 `parallel-workers`，高风险或大规模实现再升级到 `parallel-workers-isolated`；70/20/10 只作健康形状参考，不作硬门禁。',
    '5. 纯图片、封面图、配图、海报、插画、图标、贴纸、mockup 或“先看样子”请求默认直接使用 `imagegen`，也就是 Codex 原生 Image 2；Image 2 是工具路径，不是审美豁免，生成前先写清用途、受众、气质、约束和记忆点，并用 anti-slop 避免默认紫白/蓝紫渐变、通用字体、白底卡片堆叠和无语境装饰；其中 logo、icon、avatar、badge 等开发素材在用户未明确要求场景化展示时，默认按独立素材输出（standalone asset）生成：全画布单主体，不额外添加卡片、设备框或其他展示容器；只有实际发生 `imagegen` 调用后，才能汇报生图结果、失败或限流。生图结果先当候选效果图，不要默认登记到 `.openprd/harness/visual-reviews/`。Agent 要主动确认是否符合预期、是否纳入后续效果图/实现截图对比、以及是否按此继续实现；只有确认后，才把选定方向、整张图或其中子图整理成 reference-set 并进入实现。进入实现阶段时，已有确认参考图用 `openprd visual-compare --reference/--actual`；如果参考图是一张整板、网格图或多对象组合，先运行 `openprd visual-prepare --reference <效果图> --grid <列>x<行>` 或 `--boxes <plan.json>`，确认 contact sheet 后再逐项对比；没有参考图时先判断新建界面还是修改既有界面，新建界面先按用户目标、信息架构变化、视觉决策成本和验证风险完成 3 方向方案评审，修改既有界面用 `openprd visual-compare --before/--after`；局部细节重点则补 `openprd visual-compare --board <focus-board.json>`，多方向实验则补 `openprd visual-compare --board <parallel-board.json>`；普通截图、Computer/Browser/Playwright 实测截图要作为证据时补 `openprd visual-compare --board <verification-board.json>`；同构列表、卡片、网格、表格或用户反馈没对齐时补 `openprd visual-compare --board <alignment-board.json>`，并同时覆盖容器轨道与内部内容槽位轨道；单个 logo、icon、avatar、badge、按钮图形或图片内部居中/视觉重心/偏心问题补 `openprd visual-compare --board <centering-board.json>`，并同时覆盖画布中心、主体外接框中心和视觉重心偏移。visual evidence 同时检查气质、层级、字体/色彩/表面角色和记忆点，不只检查截图是否存在。用户后续如果说“跟效果图”“不一致”“好丑”“复刻”，不能只口头说对比过了，至少先产出一份视觉证据图。如果用户目标是把工作转成可学习、可复用、可回看、可教学或可沉淀的材料，先按期望产物是否需要章节结构、证据锚点、图文讲解、检索练习、工作示例或长期阅读体验来判断；需要时优先走 `openprd learn .` 生成学习包和阅读器，不要用关键词表触发；“仙侠风格的学习材料”这类短请求也按学习型交付物处理，风格只作为 `--genre` 题材参数。',
    '5a. 对 logo、icon、avatar、badge、贴纸、空态插画、单物件 UI 位图等开发素材，如果最终要接入 UI 并需要透明背景，默认走“候选评审 -> 资产工程化 -> 接入验证”的图标资产链路：先基于用途、受众、气质、约束和记忆点生成 3 个差异足够大的独立素材候选方向，并保持纯 `#00ff00` 绿幕、无文字、无 UI 容器、主体居中且留足裁切边距；用户选定前不写入项目文件。用户选定后再定位源图或 contact sheet，保留绿幕源图，用 `remove_chroma_key.py` 抠成透明 PNG/WebP，按真实 UI 需要裁切居中并导出 384px 或多尺寸资产；接入时按首页卡片、工具格、吸顶栏、偏好预览等实际场景分别调显示比例，而不是只换图片路径。收口时同步写回 `.openprd/design/active/asset-spec.md` 和 `selected-direction.md`，说明选中的方向、资产路径、透明产物、接入位置和验证结果；最终回复必须区分绿幕源图、透明产物和是否已经接入。',
    '5b. 卡片宽度、间距、留白、对齐、颜色、圆角、字号、按钮或图标等轻量 UI 可视优化，仍可按 L0/L1 小范围修正推进，不自动升级成大界面 3 方向方案评审；但它是用户可见变化，动手前要有一句审美意图和记忆点，收口必须补 `visual-compare` 修改前后图、局部焦点证据板、截图实测证据板、对齐辅助线证据板或内部居中证据板，并检查气质、层级、颜色、字号、间距和表面角色是否成立。只要界面里有同构列表、卡片、网格或表格，就把容器轨道以及标题、副标题、描述、标签、状态、价格、按钮、图标、操作区等相同文案类型/相同组件槽位的对齐当作默认验收项，不等用户先投诉；只量外框、列宽或行顶不算完整对齐验收。只要任务在判断单个素材/图标/头像/徽标/按钮图形的内部居中、偏心或视觉重心，就把 centering-board 当作默认验收项；单张原始截图或主观“看起来居中”不算完整居中验收。build、package、`openprd dev-check` 和单张原始截图不能替代视觉证据。',
    '6. 界面、页面、视觉、样式、信息架构或前端体验任务进入实现前，先读取 `$openprd-frontend-design`，并用 `.openprd/design/active/` 补齐 `facts-sheet / asset-spec / image-preflight / direction-plan / selected-direction`；空白工作区优先从 `.openprd/design/templates/` 选最近模板。若用户已经给了效果图、设计稿、参考截图或其他明确参考图，先把它当成主参考源；只有现有 starter、theme、layout 足够接近时才复用，不接近就允许偏离默认组合，以参考图为准。若当前轮用户已经把页面主题、模块范围或“直接实现”的意图说清，优先运行 `openprd run . --context --message <用户原话>`。若页面主题和模块范围已经明确，优先运行 `openprd design-starter . --starter <starter-id> --out index.html --brief "<页面主题>" --sections "<模块1|模块2|模块3>"` 起第一版真实页面；只有这个页面本来就不依赖外部产品事实、品牌素材或真实图片时，才在 active design artifacts 写清无依赖并补 `--no-external-facts --no-brand-assets --no-real-images`；若题目更像旅游、导览、展览、博物馆、城市、自然观察或案例内容页，先不要带 `--no-real-images`，让 starter 先尝试补首批真实图片；若这类冷启动即使带 message 仍短暂返回 `clarify-user`，把它当成摘要级提醒，先用 3 到 5 行 mini-plan 收口，再继续。starter 落地后默认进入 `Patch Mode`，必须直接在生成的入口文件上补丁修改；即使结构要大改，也是在同一路径内覆盖，不做 delete-first，更不要删除 `index.html` 后另起新稿。如果确实要整页重写，先把完整新稿写到 sibling draft，例如 `index.next.html`，确认内容成形后再覆盖回 `index.html`，不要让正式入口出现空窗；starter 一落地后，只允许做一轮就地对焦：快速读一次生成的入口文件和必要的 active design artifacts；这轮对焦结束后，下一步就必须是真实写入口，不要再回头搜网页、翻 `docs/basic/` 或继续模板漫游；把最后一批必要的查事实、查图、读模板动作放在口头宣布之前做完；一旦已经说“开始覆盖入口文件”或“开始整页重写”，下一步必须出现真实写文件动作，而不是继续只读浏览、压图或停在口头承诺；必要时 hook 会把这类非写入动作挡回去；`Patch Mode` 完成不等于只补合同、只下载素材或只写计划；至少要把入口文件本体改完、主要占位清掉，并把已准备好的真实图片或参考约束真正落进页面；没有明确参考方向时，不要直接落回同一种安全极简解。',
    '7. 用户给出会话 ID 并要求继续时，按工具无关的历史会话续接；不要要求工具专属 ID，也不要用当前 active change 或相似历史替代指定会话。',
      '8. 单个 task 收尾时只运行本任务最小足够验证，并通过 `--evidence`、测试报告或任务 metadata 留下 task-scoped evidence；代码修改完成后、最终回复前，针对本轮实际 touched code files 运行 `openprd dev-check . <file...>`。阶段收口、全部实现完成、handoff/commit/release/publish 前，再运行 `openprd standards . --verify`、`openprd quality . --verify` 和 `openprd run . --verify`；L2 或跨页面实现的最终回复必须列出最新 HTML 质量报告和 task-scoped Markdown/HTML 测试报告路径。如果还没有 `.openprd/harness/test-reports/` 下的 Markdown / HTML 测试报告，就不要把状态表述成项目级已经闭环。',
    '9. 微信小程序相关任务默认按“最小足够验证”执行：只有用户明确要求小程序实测、截图、抓日志/网络、复现问题，或当前改动必须依赖运行态证据时，才升级到本地小程序运行态验证；默认沿用当前小程序运行态或开发者工具会话连续验证，不要为了验证自动重开应用；只有用户明确要求从 0 到 1、冷启动或重开时，才从头启动。如果当前客户端没有相应工具，不要假定已经安装，也不要把缺少工具当成阻断。',
    '10. `openprd init/setup/update/doctor` 记录的 `optionalCapabilities` 是非阻断式增强建议。当前任务明显受益但能力还未配置时，可在后续建议里说明它能帮什么、附官方文档 / GitHub 链接，并询问用户是否需要按当前客户端补配置；不要因为它未配置就阻断当前任务。',
    '',
    '### Hook-Enforced Gates',
    '',
    '- requirement：需求未完成 `clarify/review/change/tasks` 前阻断实现写入；tasks 就绪后，只有用户原始意图已明确要求实现，或后续在看过执行确认清单后明确发出执行指令时才放行。',
    '- research：公开 GitHub 架构/对标先 DeepWiki；第三方技术用法、配置、限制、版本差异或迁移先查本地证据，不足时再按 `resolve_library_id -> query_docs` 使用 Context7。',
    '- design：界面、页面、视觉和前端体验任务进入实现前，先读取 `$openprd-frontend-design`，并补齐 `.openprd/design/active/` 下的事实、素材、图片和方向合同。',
    '- skill-visualization：修改 skill、`SKILL.md`、`AGENTS.md` 或相关 workflow 前，先输出彩色 Mermaid 方案并等待用户确认。',
    '- secrets / weapp / browser / copy：分别处理 `secrets-vault`、按需的小程序运行态验证、窗口归属与 i18n/普通用户文案提醒。',
    '- 需要细节时，读 router 指向的 skill 和 command catalog，而不是继续扩写 `AGENTS.md`。',
    '',
    '### High-Risk Gate',
    '',
    'Before freeze, handoff, accepted spec apply/archive, commit, push, release, or publish, ensure `openprd standards . --verify`, `openprd quality . --verify`, `openprd run . --verify`, and `openprd doctor .` are healthy.',
    'If the quality report says `productionReady=false`, do not claim overall readiness. Reuse `openprd run . --verify` to separate current-task status from workspace-level debt, list the missing evidence or gates, and when only `feature-coverage` is pending describe it as task-ledger or evidence debt rather than a failed implementation.',
    'The only baseline documentation path is `docs/basic/`.',
    '',
  ].join('\n');
}

function parseSkillSourceMarkdown(text) {
  const raw = String(text ?? '').trimEnd();
  if (!raw.startsWith('---\n')) {
    return { frontmatter: {}, body: raw };
  }
  const frontmatterEnd = raw.indexOf('\n---\n', 4);
  if (frontmatterEnd < 0) {
    return { frontmatter: {}, body: raw };
  }
  const frontmatterText = raw.slice(4, frontmatterEnd).trim();
  const body = raw.slice(frontmatterEnd + '\n---\n'.length).trimStart();
  const frontmatter = {};
  for (const line of frontmatterText.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) {
      frontmatter[match[1]] = match[2].trim();
    }
  }
  return { frontmatter, body };
}

async function loadSourceSkill(skill) {
  if (!skill.sourceSkill) {
    return { description: skill.description, body: skill.body };
  }
  const sourcePath = cjoin(PACKAGE_ROOT, 'skills', skill.sourceSkill, 'SKILL.md');
  const parsed = parseSkillSourceMarkdown(await readText(sourcePath));
  return {
    description: skill.description ?? parsed.frontmatter.description,
    body: skill.body ?? parsed.body,
  };
}

async function renderSkill(skill, adapter, projectRoot) {
  const source = await loadSourceSkill(skill);
  const sections = [
    '---',
    `name: ${skill.id}`,
    `description: ${source.description}`,
    '---',
    '',
    source.body,
  ];
  if (skill.id === 'openprd-benchmark-router' && projectRoot) {
    sections.push('', await renderApprovedBenchmarkRegistrySection(projectRoot).catch(() => ''));
  }
  return sections.join('\n');
}

async function listFilesRecursive(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const itemPath = cjoin(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(itemPath));
    } else if (entry.isFile()) {
      files.push(itemPath);
    }
  }
  return files;
}

async function writeSourceSkillReferences(projectRoot, skill, destinationDir, adapter, version, options, changes) {
  if (!skill.sourceSkill) {
    return;
  }
  const sourceDir = cjoin(PACKAGE_ROOT, 'skills', skill.sourceSkill, 'references');
  const files = await listFilesRecursive(sourceDir);
  for (const filePath of files) {
    const relative = path.relative(sourceDir, filePath).split(path.sep).join('/');
    const body = await readText(filePath);
    await writeGeneratedFile(
      cjoin(destinationDir, 'references', relative),
      { adapter, source: `${skill.id}:reference:${relative}`, version, body },
      options,
      changes,
    );
  }
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

function resolveShellPlatform(options = {}) {
  return options.platform ?? process.platform;
}

function hookCommand(projectRoot, eventName, options = {}) {
  const hookPath = cjoin(projectRoot, '.codex', 'hooks', 'openprd-hook.mjs');
  return `node ${quoteShell(hookPath, options)} ${eventName}`;
}

function quoteShell(value, options = {}) {
  if (resolveShellPlatform(options) === 'win32') {
    return `"${String(value).replace(/"/g, '""')}"`;
  }
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function renderCodexHookRunner() {
  return readFileSync(cjoin(PACKAGE_ROOT, 'src', 'codex-hook-runner-template.mjs'), 'utf8').trimEnd();
}

function normalizeFeatureHooks(text) {
  const featureHeader = /^\[features\]\s*$/m;
  if (!featureHeader.test(text)) {
    const prefix = text.trimEnd();
    return `${prefix ? `${prefix}\n\n` : ''}[features]\nhooks = true\n`;
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
  const normalized = [];
  let hasHooks = false;
  for (let index = start + 1; index < end; index += 1) {
    if (/^\s*(hooks|codex_hooks)\s*=/.test(lines[index])) {
      if (!hasHooks) {
        normalized.push('hooks = true');
        hasHooks = true;
      }
      continue;
    }
    normalized.push(lines[index]);
  }
  if (!hasHooks) {
    normalized.push('hooks = true');
  }
  lines.splice(start + 1, end - start - 1, ...normalized);
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
    groups.push(`[[hooks.${eventName}.hooks]]`);
    groups.push('type = "command"');
    groups.push(`command = ${quoteForToml(hookCommand(projectRoot, eventName, options))}`);
    groups.push('timeout = 15000');
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
  let next = normalizeFeatureHooks(current || '');
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
  const next = normalizeFeatureHooks(current || '');
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
    marker: 'hooks = true',
  });
}

function codexHookGroup(projectRoot, eventName, options = {}) {
  const group = {
    hooks: [
      {
        type: 'command',
        command: hookCommand(projectRoot, eventName, options),
        timeout: 30000,
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
    const skillDir = cjoin(projectRoot, '.codex', 'skills', skill.id);
    await writeGeneratedFile(
      cjoin(skillDir, 'SKILL.md'),
      { adapter: 'codex', source: skill.id, version, body },
      options,
      changes,
    );
    await writeSourceSkillReferences(projectRoot, skill, skillDir, 'codex', version, options, changes);
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
    const skillDir = cjoin(projectRoot, '.claude', 'skills', skill.id);
    await writeGeneratedFile(
      cjoin(skillDir, 'SKILL.md'),
      { adapter: 'claude', source: skill.id, version, body },
      options,
      changes,
    );
    await writeSourceSkillReferences(projectRoot, skill, skillDir, 'claude', version, options, changes);
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

function optionalCapabilityLocations(projectRoot, tools, options = {}) {
  const locations = [];
  if (tools.includes('codex')) {
    const projectPath = cjoin(projectRoot, '.codex', 'config.toml');
    const userPath = cjoin(resolveCodexHome(options), 'config.toml');
    locations.push(
      { client: 'codex', scope: 'project', absolutePath: projectPath, path: normalizedRelativePath(projectRoot, projectPath) },
      { client: 'codex', scope: 'user', absolutePath: userPath, path: displayPath(userPath) },
    );
  }
  if (tools.includes('cursor')) {
    const projectPath = cjoin(projectRoot, '.cursor', 'mcp.json');
    const userPath = cjoin(resolveCursorHome(options), 'mcp.json');
    locations.push(
      { client: 'cursor', scope: 'project', absolutePath: projectPath, path: normalizedRelativePath(projectRoot, projectPath) },
      { client: 'cursor', scope: 'user', absolutePath: userPath, path: displayPath(userPath) },
    );
  }
  if (tools.includes('claude')) {
    const projectPath = cjoin(projectRoot, '.mcp.json');
    locations.push({ client: 'claude', scope: 'project', absolutePath: projectPath, path: normalizedRelativePath(projectRoot, projectPath) });
  }
  return locations;
}

async function collectOptionalCapabilities(projectRoot, tools, options = {}) {
  const locations = optionalCapabilityLocations(projectRoot, tools, options);
  return Promise.all(OPTIONAL_CAPABILITY_REGISTRY.map(async (capability) => {
    const patterns = capability.patterns.map((pattern) => pattern.toLowerCase());
    const checkedLocations = [];
    const configuredLocations = [];
    for (const location of locations) {
      const locationExists = await exists(location.absolutePath);
      let matched = false;
      if (locationExists) {
        const raw = await readText(location.absolutePath).catch(() => '');
        const normalized = raw.toLowerCase();
        matched = patterns.some((pattern) => normalized.includes(pattern));
      }
      const entry = {
        client: location.client,
        scope: location.scope,
        path: location.path,
        exists: locationExists,
        matched,
      };
      checkedLocations.push(entry);
      if (matched) {
        configuredLocations.push({
          client: location.client,
          scope: location.scope,
          path: location.path,
        });
      }
    }
    return {
      id: capability.id,
      name: capability.name,
      status: configuredLocations.length > 0 ? 'configured' : 'recommended',
      configured: configuredLocations.length > 0,
      summary: capability.summary,
      recommendedFor: capability.recommendedFor,
      docsUrl: capability.docsUrl,
      repoUrl: capability.repoUrl,
      serverUrl: capability.serverUrl,
      configuredLocations,
      checkedLocations,
    };
  }));
}

async function writeInstallManifest(projectRoot, options, changes, tools, optionalCapabilities) {
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
    optionalCapabilities,
  };
  const manifestPath = harnessPath(projectRoot, OPENPRD_HARNESS_MANIFEST);
  const existed = await exists(manifestPath);
  await writeJson(manifestPath, manifest);
  const configuredCount = optionalCapabilities.filter((capability) => capability.configured).length;
  changes.push({ path: OPENPRD_HARNESS_MANIFEST, status: existed ? 'updated' : 'created' });
  await appendJsonl(harnessPath(projectRoot, OPENPRD_HARNESS_EVENTS), {
    at: manifest.generatedAt,
    event: 'agent-integration-installed',
    action: manifest.action,
    tools,
    hookProfile,
    managedFileCount: managedFiles.length,
    optionalCapabilityConfiguredCount: configuredCount,
    optionalCapabilityRecommendedCount: optionalCapabilities.length - configuredCount,
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
  const optionalCapabilities = await collectOptionalCapabilities(projectRoot, tools, normalizedOptions);
  const manifest = await writeInstallManifest(projectRoot, normalizedOptions, changes, tools, optionalCapabilities);
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
    optionalCapabilities: doctor.optionalCapabilities ?? optionalCapabilities,
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
  checks.push({ path: pathName, ok, reason: ok ? 'ok' : 'check-failed', message: ok ? 'ok' : message });
}

async function collectDoctorCheckAbsolute(checks, pathName, absolutePath, predicate, message) {
  const ok = await predicate(absolutePath);
  checks.push({ path: pathName, ok, reason: ok ? 'ok' : 'check-failed', message: ok ? 'ok' : message });
}

async function collectGeneratedDoctorCheck(projectRoot, checks, pathName, description) {
  const absolutePath = cjoin(projectRoot, pathName);
  if (!(await exists(absolutePath))) {
    checks.push({
      path: pathName,
      ok: false,
      kind: 'generated-file',
      reason: 'missing-file',
      message: `${description} is missing.`,
      repairHint: 'Run openprd update . to regenerate missing OpenPrd guidance.',
    });
    return;
  }

  const text = await readText(absolutePath);
  if (!text.includes(OPENPRD_GENERATED_MARKER)) {
    checks.push({
      path: pathName,
      ok: false,
      kind: 'generated-file',
      reason: 'missing-generated-marker',
      message: `${description} exists but is not recognized as an OpenPrd generated file because it lacks OPENPRD:GENERATED.`,
      repairHint: 'Review the local file; if it should be managed by OpenPrd, run openprd update . --force to regenerate it.',
    });
    return;
  }

  checks.push({ path: pathName, ok: true, kind: 'generated-file', reason: 'ok', message: 'ok' });
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
        timeout: 30000,
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
  const optionalCapabilities = await collectOptionalCapabilities(projectRoot, tools, options);

  await collectDoctorCheck(projectRoot, checks, 'AGENTS.md', (file) => fileHas(file, 'OPENPRD:AGENTS:START'), 'Missing OpenPrd managed AGENTS block.');
  await collectDoctorCheck(projectRoot, checks, OPENPRD_HARNESS_MANIFEST, (file) => fileHas(file, '"managedFiles"'), 'Missing OpenPrd install manifest.');
  await collectDoctorCheck(projectRoot, checks, OPENPRD_HARNESS_HOOK_STATE, (file) => fileHas(file, '"version"'), 'Missing OpenPrd hook state.');
  await collectDoctorCheck(projectRoot, checks, OPENPRD_HARNESS_EVENTS, (file) => exists(file), 'Missing OpenPrd harness events log.');
  await collectGeneratedDoctorCheck(projectRoot, checks, '.openprd/harness/command-catalog.md', 'OpenPrd command catalog');

  if (tools.includes('codex')) {
    await collectDoctorCheck(projectRoot, checks, '.codex/config.toml', (file) => fileHas(file, '[[hooks.UserPromptSubmit]]') && fileHas(file, '[[hooks.PreToolUse]]'), 'Codex config is missing OpenPrd hook definitions.');
    await collectDoctorCheck(projectRoot, checks, '.codex/hooks.json', (file) => fileHas(file, 'openprd-hook.mjs'), 'Codex hooks.json is missing OpenPrd hooks.');
    await collectDoctorCheck(projectRoot, checks, '.codex/hooks/openprd-hook.mjs', (file) => fileHas(file, 'OpenPrd harness 上下文'), 'Codex hook runner is missing.');
    const smoke = await smokeTestCodexHook(projectRoot, { hookProfile });
    checks.push({ path: '.codex/hooks/openprd-hook.mjs:smoke', ok: smoke.ok, message: smoke.message });
    await collectGeneratedDoctorCheck(projectRoot, checks, '.codex/skills/openprd-router/SKILL.md', 'Codex OpenPrd router skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.codex/skills/openprd-requirement-intake/SKILL.md', 'Codex OpenPrd requirement intake skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.codex/skills/openprd-frontend-design/SKILL.md', 'Codex OpenPrd frontend design skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.codex/skills/openprd-test-strategy/SKILL.md', 'Codex OpenPrd test strategy skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.codex/skills/openprd-harness/SKILL.md', 'Codex OpenPrd harness skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.codex/skills/openprd-learning-review/SKILL.md', 'Codex OpenPrd learning review skill');
    if (options.enableUserCodexConfig) {
      const userConfigPath = cjoin(resolveCodexHome(options), 'config.toml');
      if (await exists(userConfigPath)) {
        await collectDoctorCheckAbsolute(checks, displayPath(userConfigPath), userConfigPath, async (file) => {
          const hasHooks = await fileHas(file, 'hooks = true');
          const hasLegacyHooks = await fileHas(file, 'codex_hooks = true');
          return hasHooks && !hasLegacyHooks;
        }, 'User Codex config hook feature flags are not normalized.');
      }
    }
  }
  if (tools.includes('claude')) {
    await collectDoctorCheck(projectRoot, checks, 'CLAUDE.md', (file) => fileHas(file, 'OPENPRD:CLAUDE:START'), 'Missing OpenPrd managed CLAUDE block.');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.claude/skills/openprd-router/SKILL.md', 'Claude OpenPrd router skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.claude/skills/openprd-requirement-intake/SKILL.md', 'Claude OpenPrd requirement intake skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.claude/skills/openprd-frontend-design/SKILL.md', 'Claude OpenPrd frontend design skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.claude/skills/openprd-test-strategy/SKILL.md', 'Claude OpenPrd test strategy skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.claude/skills/openprd-harness/SKILL.md', 'Claude OpenPrd harness skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.claude/skills/openprd-learning-review/SKILL.md', 'Claude OpenPrd learning review skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.claude/commands/openprd/next.md', 'Claude OpenPrd next command');
  }
  if (tools.includes('cursor')) {
    await collectGeneratedDoctorCheck(projectRoot, checks, '.cursor/rules/openprd.mdc', 'Cursor OpenPrd rule');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.cursor/commands/openprd-next.md', 'Cursor OpenPrd next command');
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
    optionalCapabilities,
    errors: checks.filter((check) => !check.ok).map((check) => (
      `${check.path}: ${check.message}${check.repairHint ? ` ${check.repairHint}` : ''}`
    )),
  };
}
