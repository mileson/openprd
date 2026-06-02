---
name: openprd-harness
description: 驱动 OpenPrd 工作区完成从澄清到 handoff 的主流程。适用于初始化 OpenPrd、查看 `.openprd/` 状态、选择下一条命令、推进 classify/interview/synthesize/freeze/handoff，或解释如何安全推进 OpenPrd 工作区。
---

# OpenPrd Harness

## 概览

这份 skill 负责主工作流编排。把它当成串起命令和产物的领域 skill；共用守则由 `$openprd-shared` 提供。

`AGENTS.md` 只保留轻量合同；入口路由优先看 `skills/openprd-router/SKILL.md`，具体命令速查看 `.openprd/harness/command-catalog.md`，更细的工作流步骤、路由边界和 hook 门禁以这份 skill、`$openprd-shared` 和 `$openprd-benchmark-router` 为准。

执行时优先继承 `$openprd-shared` 的用户心智与表达规则：用户懂业务和产品，但不想读技术黑话；默认耐心低、成本敏感，需要 Agent 主动补全遗漏，并用最短路径说明结论和下一步。

## 动手前

1. 读取第一个可用的共用规则文件：`skills/openprd-shared/SKILL.md`、`$HOME/.claude/skills/openprd-shared/SKILL.md` 或 `$HOME/.codex/skills/openprd-shared/SKILL.md`
2. 从 `.openprd/` 重建当前工作区状态
3. 如果用户期待自动化 agent 引导，运行 `openprd doctor <path>`，必要时用 `openprd setup <path>` 或 `openprd update <path>` 修复
4. 选择执行单元前，优先运行 `openprd run <path> --context`
5. 把 `openprd run <path> --context` 当作建议，不要自动执行其中的写入命令
   - 如果用户给出会话 ID 并要求继续，按工具无关的历史会话精确续接；不要要求或使用工具专属 ID，也不要用当前 active change、相似历史或当前 requirement gate 替代该会话 ID
   - 如果用户没有给 ID，但明确描述了某个已有需求、change、task 或 work unit，先把这段描述交给 `openprd run <path> --context --message <用户原话>` 做显式对象解析，不要先默认拿当前 active change
6. 先按需求复杂度分流：L0 小修（空格、错别字、按钮文案、简单样式、明确 bugfix）直接执行并事后说明；L1 中等改动先给对话内 mini-plan 再执行；L2 新产品、模块或工作流需求才进入 requirement intake、review、change、tasks 的完整路径
7. 如果用户是在规划、分析、架构评审，或问“怎么改”“会动哪些文件”，保持只读并基于证据回答
8. 实现任务完成代码修改后、最终回复前，针对本轮实际 touched code files 运行 `openprd dev-check <path> <file...>` 或 `node scripts/openprd-dev-check.mjs <path> <file...>`：700 行以内正常；701-1500 行需说明局部职责；超过 1500 行要判断本轮是否扩大职责，扩大则先重构/拆分/解耦并复查，窄 bugfix 或小修暂不拆时说明原因和后续拆分建议
9. 执行过程中发现新代码后缀、豁免路径、命令别名、项目约定或用户偏好时，运行 `openprd grow <path> --review`；共享规则必须经用户确认后再 `openprd grow <path> --apply --id <candidate-id>`，个人偏好进入 user-local 范围
10. 维护 OpenPrd 本身时，只要新增或修改配置类能力（阈值、规则、识别、豁免、命令别名、环境差异、用户偏好或策略开关），默认先做 grow-aware 自检：高置信应可成长时直接纳入 `openprd grow` 体系；不确定时主动询问用户是否做成可成长配置
11. 用户要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup、先看样子或先确认设计方向时，默认直接调用 Codex 原生 Image 2 生图能力产出图片；除非用户明确指定 HTML、SVG、CSS、Canvas、代码稿或可编辑矢量/source artifact，不要改用临时 HTML/SVG/CSS 再截图。OpenPrd 的 `review.html` 只用于需求评审，不能替代图片或效果图生成
12. 界面、页面、视觉、样式或前端体验任务中，如果已经有效果图、设计稿、图片资产、截图或用户给图且进入实现阶段，阶段性完成后先截实现图，再运行 `openprd visual-compare <path> --reference <效果图> --actual <实现截图>`。默认输出 JPG 到 `.openprd/harness/visual-reviews/`，左侧标注“效果图”、右侧标注“实现截图”；查看合成图后继续复刻，直到没有明显视觉差异。没有参考图但改动界面时，先截“修改前”，实现后用同一入口、视口、账号和数据状态截“修改后”，再运行 `openprd visual-compare <path> --before <修改前截图> --after <修改后截图>`，检查预期变化和未改区域漂移
13. 实现任务新增或修改文件时，做文档影响检查：缺失的 `docs/basic/`、文件说明书、文件夹 README 要补齐；受影响的已有文档要更新；涉及后端、脚本、Agent、工具链、服务或数据处理变更时，把 CLI 与 API 视为同级接入面，更新 `docs/basic/backend-structure.md` 中的命令入口、输出契约、`help`/`doctor`/`dry-run`/`status`、接口协议与不适用说明
14. 长时间实现任务使用 `openprd loop <path> --plan --change <id>`，并且只有当前用户消息明确要求开发、继续任务、深度调研、对标复刻或提交时，才为每个 loop 任务启动一个全新 agent 会话
15. 需要完整工作流细节时，使用 `openprd status` 和 `openprd next`
16. 用户要求最佳实践、benchmark、对标、参考产品、prompt engineering、Agent harness、context engineering、图标资源、CLI 或 skill 体系设计时，先路由到 `$openprd-benchmark-router`
17. 用户要求基线文档、文件说明书、文件夹 README 标准或实现就绪检查时，路由到 `$openprd-standards`
18. 用户要求日志、链路追踪、业务成本护栏、免费额度、滥用防护、评估执行环境、冒烟覆盖、性能基线、极端场景、HTML 质量评估报告或项目级经验 Skill 时，路由到 `$openprd-quality`
19. 用户需要可视化说明，或系统/产品形态仍不清晰时，在进入需求定稿前路由到 `$openprd-diagram-review`
20. 默认保持 Codex hooks 轻量。除非项目明确需要完整工具级遥测，否则 `openprd setup/update` 使用 `--hook-profile lite`；默认 `lite` 会保留 `Stop` 收工回顾，用于在本轮结束前提醒是否值得沉淀项目经验
21. hook 会强制阻断几类场景：需求入口未完成就写实现、外部证据不足就直接改第三方集成、skill/AGENTS 变更未先可视化确认、以及敏感信息场景下直接读原始 vault 文件
22. 当 `doctor` 报告生成引导漂移时，读取 `.openprd/harness/drift-report.json`

## 主工作流

### 1. 初始化或定位工作区

- 如果 `.openprd/` 不存在，使用：
  - `openprd init <path> --template-pack <base|consumer|b2b|agent>`
- `init` 会同时创建 standards 和 agent integration，包括 Codex、Claude、Cursor 的生成引导、项目级 Codex hooks 和用户级 Codex hooks feature flag
- `init` 也会创建质量状态，包括 `.openprd/quality/config.json`、`.openprd/quality/reports/` 和 `.openprd/knowledge/`
- `init` 也会创建自我成长候选队列，包括 `.openprd/growth/candidates.jsonl`、`accepted.json`、`rejected.json` 和本地偏好文件
- 如果 standards 缺失，或用户要求修复：
  - `openprd standards <path> --init`
- 如果生成的 agent 引导或 hooks 缺失：
  - `openprd setup <path>`
  - `openprd doctor <path>`
- 如果生成引导存在但漂移了：
  - `openprd update <path>`
  - `openprd doctor <path>`
- hook 驱动执行循环使用：
  - `openprd run <path> --context`
  - `openprd run <path> --verify`
  - 让 `.openprd/harness/run-state.json`、`iterations.jsonl` 和 `learnings.md` 成为持久循环状态
  - 不要把 `run --context` 建议当作直接用户命令
  - 用户给出会话 ID 续接历史任务时，使用 `openprd run <path> --context --message <用户原话或会话ID>` 保留通用会话 ID 语义；先恢复指定会话，不要让当前 active change 抢主线
  - 用户没有给 ID、但明确描述了已有需求/任务对象时，也使用 `openprd run <path> --context --message <用户原话>`；先解析对应的 change/task/work unit，再决定是否沿用当前工作区状态
  - 默认 lite Codex hooks 会为明确的 OpenPrd、PRD、深度调研、对标复刻、standards、fleet、文档标准化提示词，以及 L2 新产品、模块、流程需求注入上下文；L0 小修不打开 requirement gate，L1 用对话内 mini-plan 承接，复杂或模糊 L2 需求会提示先做三轮 Requirement Intake Reflection；轻量 `PreToolUse` 写入门禁会在需求入口未确认前阻断过早实现；本轮准备结束时，`Stop` 会基于 touched files 和 verify/finish 信号回顾是否要生成项目经验草案
  - 只有当项目确实需要完整 hook 遥测或临时深度诊断时，才用 `openprd update <path> --hook-profile full`
- 长程实现循环使用：
  - `openprd loop <path> --init`
  - `openprd loop <path> --plan --change <id>`
  - `openprd loop <path> --next`
  - `openprd loop <path> --prompt --agent codex`
  - `openprd loop <path> --run --agent codex --dry-run`
  - `openprd loop <path> --run --agent claude --dry-run`
  - `openprd loop <path> --finish --item <task-id> --commit`
  - 让 `.openprd/harness/feature-list.json`、`progress.md`、`agent-sessions.jsonl`、`loop-state.json` 和 `loop-prompts/` 成为持久实现状态
  - 只有在当前用户消息明确要求开发、继续任务、深度调研、对标复刻或提交时，才运行 `openprd loop <path> --run`
  - 代码修改完成后、最终回复前，运行 `openprd dev-check <path> <file...>`；attention/warning 必须在最终回复里说明是否局部处理、是否已拆分，或为什么窄修暂不拆
  - 用户只是要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup 或先看样子时，默认调用 Codex 原生 Image 2 生成图片；除非用户明确指定 HTML/SVG/CSS/Canvas/代码稿，不要生成临时 HTML 再截图
  - 如果已有参考效果图、图片资产、设计稿、截图或用户给图并进入实现阶段，阶段性完成后必须生成实现截图，并用 `openprd visual-compare <path> --reference <效果图> --actual <实现截图>` 输出 JPG 视觉对比图；如果没有参考图但改动界面，先截修改前，完成后截修改后，并用 `openprd visual-compare <path> --before <修改前截图> --after <修改后截图>` 输出 JPG 自检图。未查看对比图、对比图仍有明显差异或未改区域漂移时，不要声称界面复刻或视觉自检完成
  - `openprd loop <path> --finish` 前，先完成文档影响检查并更新缺失或过期的 `docs/basic/`、文件说明书和文件夹 README；涉及后端、脚本、Agent、工具链、服务或数据处理变更时，同步评估 CLI 与 API 两个接入面
  - 声称任务就绪前，运行 `openprd quality <path> --verify` 并审阅生成的 HTML 质量评估报告，检查场景标签、必需 EVO 门禁、日志、业务护栏、冒烟覆盖、任务完整性、性能基线、极端场景和知识缺口
  - 如果本轮修复已经出现可复用模式，可先运行 `openprd quality <path> --learn --review --from .openprd/harness/turn-state.json` 生成 knowledge candidate / draft skill；确认值得长期保留后，再运行 `openprd quality <path> --learn --from <candidate-dir>` promote 为正式项目经验
  - `openprd loop <path> --finish` 应同时留下 Markdown 和 HTML 回归证据到 `.openprd/harness/test-reports/`，把它们视作任务交付物的一部分
  - 每个 loop 任务都对应一个全新 Codex 或 Claude 会话边界，不要在同一会话里继续下一项任务
- 处理历史项目集群前先审计：
  - `openprd fleet <root> --dry-run`
  - `openprd fleet <root> --update-openprd`
  - 除非用户明确要求 OpenPrd 接管 agent-only/plain 项目，否则不要使用 `--setup-missing`
- 如果工作区已经存在，先检查再写入
- 初始化后不要立刻跳到 synthesize，优先做明确澄清

### 2. 与用户澄清

- 使用：
  - `openprd clarify <path>`
- 当关键产品事实缺失时，先查看 `intake-reflection.md` 的需求入口自省，再把压缩后的必须确认问题问给用户
- 当需求模糊、起点只有一句想法，或需要先做方案探索时，先查看生成的 `intake-reflection.md`，再把压缩后的目标、范围、非目标、验收方式和必须确认问题放在对话里请用户确认；不要生成或打开澄清 HTML
- 优先分阶段确认：问题、用户、范围、成功标准和开放问题；复杂需求先让 OpenPrD 内部完成意图归一化、项目上下文映射和产品质量自检，不要把固定问题墙一次性砸给用户
- 收到答案后，用下面命令写回：
  - `openprd capture <path> --field <section.path> --value <text|json>`
- 当你是在追加列表型字段，而不是整体替换时，使用 `--append`

### 3. 锁定产品类型

- 如果 `productType` 缺失，运行：
  - `openprd classify <path> <consumer|b2b|agent>`

### 4. 加载澄清提示

- 如果必填字段仍缺失，使用：
  - `openprd interview <path> --product-type <type>`
- 未解决的问题要保持可见，不要假装 intake 已经完整

### 5. 生成可评审草稿

- 使用：
  - `openprd synthesize <path> --title ... --owner ... --problem ... --why-now ...`
- 如果草稿仍然稀疏，明确说明还缺什么
- `synthesize` 生成 `review.html` 后，必须把 HTML 路径告诉用户，并自动打开它（或紧接着运行 `openprd review <path> --open`）
- 评审页里的需求关系图、需求流程图和重点摘要不要靠 HTML 截断；先用 `openprd review-presentation <path> --template` 查看展示文案契约，让 Agent 按 `reviewPresentation` 写短文案，再用 `openprd review-presentation <path> --presentation <json> --write --fail-on-violation` 校验并写回。超限时让 Agent 重新提炼，不要裁剪原文
- 把生成的 `review.html` 当作首选稳定评审 artifact。默认 approval policy 是 `decision-points`：当前 lane 仍需要人类决策时，请用户先评审问题定义、范围、主流程、风险和开放问题，再运行带精确 `--version`、`--digest`、`--work-unit` 的 `openprd review <path> --mark confirmed`。若用户一开始已经明确要求直接做，并显式表示不需要额外评审或确认，lane 可进入 `silent-record`，这时只允许记录当前精确匹配的稳定 artifact，不能借机替别的版本补确认。review 记录完成且 tasks 就绪后，如果用户刚刚确认的是现有功能优化（L1）的 mini-plan、范围边界或正式产品边界，后续承接要写成“已确认，我按这个继续”，不要写成“确认，我们就按这个……”这种像再次索取确认的句子；如果用户原始意图已经明确要求实现，可直接继续执行；否则先输出执行确认清单，列出本轮目标、将执行内容、不做事项、验证方式和已知风险，再请求明确执行授权，不能只要求用户回复一句确认

### 6. 需要时生成可视化评审产物

- 当用户需要以下内容时，路由到 `$openprd-diagram-review`：
  - 架构确认
  - 流程 / 旅程确认
  - 需求定稿前的可视化评审

### 7. 只在草稿准备好时 freeze

- 使用：
  - `openprd freeze <path>`
- Freeze 是门禁，不只是另一次渲染
- 声称实现就绪前，先校验 standards：
  - `openprd standards <path> --verify`
  - 这不只是缺文件检查；对已变更文件，还要判断现有文档是否过期，并在必要时更新
- 声称实现就绪前，再校验质量：
  - `openprd quality <path> --verify`
  - 把 `.openprd/quality/reports/<id>.html` 当作面向人的评审产物，用于查看当前场景必需 EVO 门禁、可观测性、业务成本与滥用护栏、评估执行环境、性能、压力数据和项目知识
  - 如果 HTML 或 `openprd run <path> --verify` 显示 `productionReady=false`，最终回复不得宣称就绪；必须列出缺证据或需关注的必需门禁
- 进入高风险动作前，校验完整 harness：
  - `openprd run <path> --verify`
  - `openprd doctor <path>`

### 8. 导出 handoff 包

- 使用：
  - `openprd handoff <path> --target openprd`

## 安全默认值

- 当下一步存在歧义时，优先用 `openprd next`
- 当任务属于一般执行循环时，优先用 `openprd run --context`
- 当任务是需要拆成“每个任务一个全新 agent 会话”的实现工作时，优先用 `openprd loop --plan` 和 `openprd loop --run --dry-run`
- 当用户要求“看看、规划、梳理、分析、评估、explain、review”或列出影响文件时，优先保持只读检查
- 除非当前用户消息明确要求执行，否则不要运行 `openprd loop --run`、`openprd tasks --advance`、`openprd discovery --advance`、`openprd loop --finish --commit`、git commit 或 git push
- 当 agent 环境可能没有正确跟随 OpenPrd 时，优先用 `openprd doctor`
- 生成 adapter 文件漂移时，优先运行 `openprd update` 修复，而不是手改生成文件
- 当方案形态仍不清晰时，优先先 review 再进入需求定稿
- 用户要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup 或先看样子时，优先调用 Codex 原生 Image 2；界面任务已有参考图并进入实现阶段时，用 `openprd visual-compare --reference/--actual` 生成左右对比 JPG；无参考图但改动界面时，用 `openprd visual-compare --before/--after` 生成修改前后自检 JPG，作为视觉就绪判断依据
- 遇到 blocker 时，优先把阻塞条件显式暴露出来，而不是悄悄补脑

## 禁止行为

- 不要发明不存在的命令
- 不要因为 CLI 技术上允许，就在用户还没确认方案结构时直接进入需求定稿
- 当图示评审或草稿评审明显仍有必要时，不要 handoff 一个用户尚未审阅的工作区
- 项目基线文档路径只能是 `docs/basic/`
- 当 `openprd setup`、生成规则和 hooks 已经可以引导 agent 时，不要反过来要求用户记住具体 skill 名

## 需要时阅读这些参考资料

- `references/command-map.md`：命令到意图的映射
- `references/workflow-gates.md`：门禁判断和就绪规则
- `references/examples.md`：具体使用模式
- `references/usage-guide.md`：面向团队和 agent 的使用指南，覆盖 clarify、diagram、freeze、status/next 和批量 capture
