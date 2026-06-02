# 后端架构设计

## 适用范围

说明后端服务、接口、数据处理和外部依赖的项目级架构约定。

## 服务边界

- CLI 入口: `bin/openprd.js` 只负责调用 `src/openprd.js` 的 `main(argv)` 并设置退出码。
- CLI 分发: `src/openprd.js` 负责命令分发、workspace 初始化、freeze、handoff、change 生成和对外导出；change 生成会校验当前稳定 PRD artifact 的 review 是否已记录，未记录时返回可执行的 review 记录命令。
- 工作区核心: `src/workspace-core.js` 负责 workspace 骨架、迁移、校验、版本索引、事件日志和共享文档渲染，并随包同步 `.openprd/README.md` 与 `templates/*/README.md` 的简体中文默认文档，以及配套的 `README_EN.md` 英文切换入口；如需兼容旧外链，可额外保留 `README_CN.md` 跳转页。
- 工作流命令: `src/workspace-workflow.js` 负责 classify、interview、clarify、capture、synthesize、review、diff、history、next 和 status guidance，并在 clarify 前生成需求入口自省记录。`clarify` 只在对话内输出轻量澄清或简短清单，不生成 `clarify.html`；正式 HTML 确认面由 synthesize/review 阶段的稳定评审页承担。`synthesize` 会在写出 `review.html` 前先用生成后的 `spec.md` 跑简体中文预检，避免先确认 review 再被 change/spec 规则打回；若只是内部措辞规范化，可先用 `openprd capture . --source agent-normalized` 整理后重跑 synthesize。通过预检后，`synthesize` 会生成工具无关的 work unit id，把本轮需求的目标根目录、版本、摘要指纹和稳定评审页写入 `.openprd/engagements/work-units/`，并优先打开版本化 artifact；`engagements/active/review.html` 只作为最新快捷入口。默认 approval policy 是 `decision-points`：CLI 输出和 hooks 需要说明当前 lane 是“需要人类决策”还是“只需记录当前 artifact”。`review` 负责记录当前 PRD 版本的 `pending-confirmation`、`confirmed` 或 `needs-revision` 状态，并在传入 `--version`、`--digest`、`--work-unit` 时做一致性校验。`review --mark confirmed` 只记录当前稳定评审稿；常规 lane 由用户先评审后记录，`silent-record` lane 只允许在用户已明确要求直接做且显式表示不需要额外评审或确认时，对当前精确匹配的稳定 artifact 直接记录。Agent 不能把“继续实现”类话术直接升级成别的 artifact 的 `review --mark confirmed`。如果用户刚刚确认的是现有功能优化（L1）的 mini-plan、范围边界或正式产品边界，后续承接文案必须写成“已确认，我按这个继续”，而不是“确认，我们就按这个……”这种像再次索取确认的句子。当 review 已记录且 tasks 已生成后，如果用户原始意图已明确要求实现，可直接进入实现；否则 `run --context` 和 hooks 会要求先展示执行确认清单，列出目标、将执行内容、不做事项、验证方式和风险，再请求执行授权。
- 工作流隔离: active requirement gate 存在时，`synthesize` 必须看到晚于本轮入口的 `capture`，或在命令参数中显式提供标题、问题、原因等 PRD 字段，否则拒绝合成，避免复用历史 `current.json`。已有版本评审后再次 `capture` 用户确认或推导得到的 PRD 内容时，旧 `latestVersionId`、摘要和 work unit active 指针会移动到 previous 字段，当前 `reviewStatus` 标记为 `needs-revision` 且 `stale: true`，避免出现“新需求草稿 + 旧评审 artifact”的混合状态；仅用于 `agent-normalized` 的内部中文规范化，或 `reviewPresentation` 这类展示层写回，不会触发二次 review。
- 图表工作区: `src/diagram-workspace.js` 负责 diagram artifact 生成、评审状态读写和可选浏览器打开。
- HTML artifact: `src/html-artifacts.js` 负责 `review.html`、复盘学习 reader 和质量报告渲染出口；`src/quality-html-artifact.js` 负责 `openprd quality --verify` 的用户可见回归测试报告框架。`clarify` 模式由 CLI 输出对话内澄清提纲，不进入 HTML 渲染。`review.html` 使用自包含原生 HTML/CSS 与内联 SVG，按需求概览、需求关系图或需求流程图、四个固定评审卡片和底部固定双按钮工具栏组织信息。评审图用更小字号、紧凑高度、小尺寸节点和完整换行展示摘要内容，节点标题约束为 Agent 输出 15 字以内胶囊，节点正文约束为 Agent 输出 30 字以内短句；HTML 优先读取 `reviewPresentation.mapNodes` 与 `reviewPresentation.flowNodes` 展示图中文字，不直接裁剪原文，并在 OpenPrD review 结构化上下文中写入 `presentationContract` 和 `presentationFeedback`，用于反馈给 Agent 重新概括超限内容；`src/review-presentation.js` 为 `openprd review-presentation` 和 `scripts/openprd-review-presentation.mjs` 提供同一套展示文案模板与校验，Agent 可在写入 `reviewPresentation` 前先校验并按反馈重写。评审卡片先展示限量重点摘要胶囊，胶囊摘要控制在 15 个字以内、按内容自适应宽度且完整显示，明细分点按 `- **摘要内容**：明细一句话` 的结构反馈给 Agent，并在 HTML 中渲染为“加粗摘要 + 一句说明”，副标题句末不加句号；主流程卡片额外用轻量 SVG 小图展示用户旅程、关键步骤、边界情况和恢复路径，再展示明细列表；底部工具栏固定跟随窗口滚动，只保留“需要调整”和“认可方案”两个动作，复制内容携带 OpenPrD review 结构化上下文、版本、摘要指纹和 work unit，让多 Agent 或多对话返回确认时可以校验是否仍是同一需求；面向用户的 HTML 文案使用“需求定稿前”“进入实现前确认”等业务可理解表达，避免暴露 `freeze` 这类内部流程词。
- 质量报告 HTML: `src/quality-html-artifact.js` 不复用 PRD 评审的信息结构，但复用同一套用户体验心智：首屏先给回归结论概览，再给回归流程与测试覆盖图，下面固定展示“本期必测结果”“需要处理 / 需确认”“验证材料”“执行环境与覆盖”四个模块。回归流程图由 OpenPrD 工具生成固定步骤，展示成本护栏、冒烟测试、任务覆盖、风险复核、验证材料和最终结论；未通过或待确认步骤自动挂旁路原因卡，原因短句控制在 15 字以内，不让 Agent 手动画线或写长句。测试覆盖图由 OpenPrD 工具生成固定槽位，卡片只表达检查范围、必测结果、待处理、验证材料和最终判断；卡片正文由渲染逻辑先总结为 30 字以内短句，标题控制在 15 字以内胶囊，不依赖 CSS 省略，也不让 Agent 直接手写 SVG；四个模块明细按“加粗摘要 + 一句话说明”展示；底部固定双按钮只保留“需要补测”和“认可回归”，复制内容携带报告 ID、当前结论、需处理项、需确认项和复跑要求。旧表格、证据链、结构化 JSON 和给 Agent 的质量报告框架保留在折叠详情里。
- 视觉对比工具: `src/visual-compare.js` 负责 `openprd visual-compare` 的位图处理，使用 `sharp` 读取常见图片、按面板宽度缩放、在左上角叠加简体中文标签，并默认输出 JPG 到 `.openprd/harness/visual-reviews/`，作为界面复刻任务或无参考图界面改动自检的阶段性评审证据。
- CLI 表层: `src/cli/args.js` 解析参数，`src/cli/print.js` 统一渲染终端输出。
- 研发期标准层: `src/dev-standards.js` 负责 touched code files 行数统计、状态分级和下一步动作建议；它读取 `.openprd/standards/config.json` 的 `developmentStandards`，但只检查本次传入的文件，不做全仓库阻断。
- 自我成长标准层: `src/growth.js` 负责 `.openprd/growth/` 候选队列、review/apply/reject、共享配置安全写入和 user-local 偏好隔离；当前自动 apply 仅覆盖代码扩展名、豁免路径、豁免文件模式和本地偏好。
- OpenPrd 维护规范: `src/agent-integration.js` 和 repo-local skills 共同要求新增或修改配置类能力时先做 grow-aware 自检；高置信可成长配置默认进入 growth 设计，不确定时由 Agent 主动询问用户。
- 文件基础设施: `src/fs-utils.js` 统一封装文本、JSON、YAML、JSONL 读写。
- 运行编排: `src/run-harness.js` 负责 `openprd run` 上下文、hook 记录和 verify 门禁；当最新 PRD review 已确认但还没有 active change 时，会优先建议 `change --generate`，已有 active change 时按 `implementation` 任务数量判断是否建议独立 worktree / Loop 单任务会话。`run --context` 和 `run --verify` 默认只展示当前项目主验证状态，不把 `mode=reference` 的 discovery run 自动混入主上下文或主校验；参考调研仍通过 `openprd discovery --resume|--verify` 单独查看。
- 工作单元绑定: `src/work-unit.js` 负责工具无关的 work unit id 生成、校验、目标根目录解析和 `.openprd/engagements/work-units/` 状态读写；工作流模块只调用它，不在主流程文件里堆叠绑定细节。
- 质量评估: `src/quality.js` 负责 `.openprd/quality/config.json` 初始化、当前质量场景识别、本期必测块与本次证据检测、日志/链路追踪检测、业务成本与滥用护栏检测、评估执行环境检测、HTML 回归测试报告写入，以及 `.openprd/knowledge/` 经验 Skill 沉淀入口；`src/knowledge.js` 负责 turn-state 回顾信号、knowledge candidate、draft skill 和 promote 标记。
- Agent 集成: `src/agent-integration.js` 负责生成 AGENTS、skills、commands、Codex hooks、hook profile、Codex hooks feature flag 迁移和执行/文档门禁提示；生成给项目的 Codex hook runner 源码由 `src/codex-hook-runner-template.mjs` 单独承接，避免把运行态模板继续堆在 adapter 编排文件里；runner 会在 `UserPromptSubmit` 重置本轮 turn-state、在 `PreToolUse` 记录 touched files，并在 `Stop` 基于本轮信号调用 `quality --learn --review` 判断是否生成 knowledge candidate；新需求入口会把当前需求与历史 active change 分开，并按简单局部调整、轻量需求自省或三轮需求自省分流，历史未完成项只作为需求语言的提醒输出；用户要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup 或先看样子时，hook 只注入 Image 2 优先提醒，不把该输入升级为实现写入门禁；对 logo、icon、avatar、badge 等开发素材，若用户未明确要求 mockup、场景图、设备框、卡片承载、名片/包装展示或参考界面复刻，hook 会额外注入 `standalone asset` 默认规则，要求输出全画布单主体、非容器化素材，而不是展示型效果图；benchmark router 生成源同时承接 OpenAI/Anthropic 等最佳实践来源和图标资源站/图标实现库路由；多对象、多维属性的对话输出规则会进入 shared skill、harness skill 和 AGENTS 合同，引导 Agent 在方案对比、状态盘点、排查、风险审查、QA、清单、场景覆盖和内容规划时主动使用 Markdown 表格；大量只读扫描的 subagent 调度规则生成到 OpenPrd discovery skill，而不是写入 AGENTS 合同。
- 标准化: `src/standards.js` 负责 `docs/basic/`、文件说明书模板、文件夹说明书模板和 standards 校验。对已显式登记在 `externalReferences.paths` 的目录继续完全跳过逐文件说明书；对嵌套 Git 参考仓库和 `toolkit-sources` 这类明显外部参考候选，默认先降级为候选提示，不直接把逐文件说明书缺口当作主阻塞，仍要求维护者后续显式确认是否归类。
- Loop 编排: `src/loop.js` 负责长任务拆分、单任务 prompt、session 记录、任务 verify 和 finish。每个 loop 任务都会生成稳定的 `taskHandle`（例如 `change-id:T001.01:task-title`），并把它写入 `feature-list.json`、`agent-sessions.jsonl`、`loop-state.json` 和 CLI 输出，便于跨对话继续同一任务而不依赖聊天侧 UUID。
- 复盘学习: `src/learning-review.js` 负责收集证据、生成 Agent 写作工具包、校验 Agent 写入的 `learning-content.json`，并调用 HTML reader 渲染；内容契约现在支持章节级 `visualExplainer`，可把比喻、场景化解释和可选图片槽位一起归档到学习包。
- 规模化操作: `src/fleet.js` 负责扫描历史项目、合并 `~/.openprd/registry/workspaces.jsonl` 里的已知工作区视角，并按依赖注入调用 setup/update/doctor/work-unit backfill 或 registry sync；`--sync-registry` 会把当前 root 下已初始化的 `.openprd/` 工作区写回全局 registry，`--update-openprd` 会刷新已有 OpenPrD 工作区并顺带补齐历史 PRD work unit 绑定，项目自身 standards 或 validate 缺口只作为项目健康问题报告，不阻断生成引导更新；`--backfill-work-units` 可只刷新版本身份和稳定评审 artifact。
- 持续调研: `src/discovery.js` 负责 discovery run、source inventory、coverage matrix、claims 和 discovery 验证。
- OpenSpec 文件域: `src/openspec/` 负责 change/spec/task 的读写、验证、应用和归档；`generate` 写入 `type: implementation|verification|documentation|governance` 任务元数据，`tasks` / `execute` 解析并汇总类型数量，让 run-harness 只用实质实现任务数判断长程拆分。

## CLI 接入面

- `openprd` 是当前项目面向用户和 agent 的主接入面；`bin/openprd.js` 提供进程入口，`src/cli/args.js` 负责参数与 flag 解析，`src/cli/print.js` 负责终端输出契约。
- `src/openprd.js` 把 `doctor`、`run --context`、`review --mark`、`standards --verify`、`quality --verify`、`dev-check`、`change`、`loop`、`discovery` 等命令暴露为一级 CLI 能力，而不是内部模块上的薄包装；`change --generate` 在写文件前检查 PRD review 状态，避免绕过用户确认直接进入任务拆解。
- `openprd dev-check <path> <file...>` 和 `node scripts/openprd-dev-check.mjs <path> <file...>` 是 Agent 编辑代码文件前后的轻量工具入口，输出每个文件的行数、`ok` / `attention` / `warning` / `exempt` 状态和下一步动作建议；700 行以内正常，701-1500 行需说明局部职责，超过 1500 行优先拆分或创建拆分任务。
- `openprd grow <path> --review|--apply --id <candidate-id>|--reject --id <candidate-id>|--init|--check` 是 Agent 自我成长入口。`dev-check` 发现未知代码扩展名时会先按代码候选参与本次行数分级，并写入待确认候选；共享规则必须 review 后由用户确认 apply。
- `openprd visual-compare <path> --reference <效果图> --actual <实现截图> [--out <file>] [--format <jpg|png|webp>] [--quality <1..100>] [--max-panel-width <px>]` 与 `openprd visual-compare <path> --before <修改前截图> --after <修改后截图> [--out <file>] [--format <jpg|png|webp>] [--quality <1..100>] [--max-panel-width <px>]` 是界面视觉证据入口。前者用于效果图复刻，后者用于无参考图的修改前后自检；两种模式都输出结构化结果和图片路径，默认使用 JPG 降低文件体积，也支持 PNG / WebP。它不负责生成图片内容或确认用效果图，这类图片由 Codex 原生 Image 2 承接。
- 对 OpenPrd 本身新增配置类能力时，CLI/skill 设计必须说明该能力是否 grow-aware；若默认纳入 growth，要同时设计 candidate type、scope、review/apply 行为和拒绝后的不重复提示策略。
- 预演与诊断能力也属于 CLI 契约的一部分：当前通过 `loop --run --dry-run`、`fleet --dry-run`、`doctor`、`status`、`next` 等命令承接可发现性、风险预演和健康检查。
- 后端改动如果影响命令入口、参数、输出格式、退出码、`help`、`doctor`、`dry-run`、`status` 或命令组合方式，必须与内部实现一起评审并同步更新本文档。

## API 接入面

- 当前项目不提供对外 HTTP、RPC 或 WebSocket API；CLI 是主要稳定接入面。
- 内部模块之间通过 `src/openprd.js` 暴露的 workspace 函数和工厂依赖注入协作，但这些内部调用链不默认承诺为公共 API。
- 如果未来引入 HTTP 服务、daemon、MCP gateway 或 SDK 适配层，需要把它与现有 CLI 并列记录：明确协议、身份边界、返回结构、兼容范围，以及与 CLI 之间的职责分工。

## 数据流

- 用户命令进入 `main(argv)`，由 `src/cli/args.js` 解析 flags 和 positionals。
- `main` 根据命令分发到 workspace workflow、review、diagram、standards、quality、visual compare、dev standards、growth、loop、openspec、discovery、fleet 或 run 模块。
- 工作区状态主要读写 `.openprd/` 下的 config、templates、state、engagements、exports 和 harness 文件。JSON/Markdown 继续作为事实源和归档层；澄清阶段只输出对话内提纲，评审与质量阶段继续以 HTML artifact 作为主要确认与评审界面。
- 模块返回结构化 result，`src/cli/print.js` 再根据 `--json` 决定输出 JSON 或用户可读文本。
- `visual-compare` 读取命令传入的两张图片，在参考模式下合成带“效果图 / 实现截图”标签的左右对比位图，在自检模式下合成带“修改前 / 修改后”标签的左右对比位图，并把产物归档到 `.openprd/harness/visual-reviews/`；Agent guidance 会要求界面任务在有参考图并进入实现阶段时查看该图并继续返工到无明显差异，无参考图的界面改动则检查预期变化和未改区域漂移，不能把该工具当作生成图片内容或效果图的默认路径。
- `run-harness`、`fleet`、`discovery` 通过工厂依赖注入调用核心工作区能力，避免从子模块反向导入 `src/openprd.js`；历史 work unit 回填通过 `src/work-unit-migration.js` 独立承接，避免把版本迁移细节堆进 fleet 扫描器。
- `agent-integration` 将 canonical skills 和 AGENTS 合同渲染到各端 adapter，并从 `codex-hook-runner-template` 读取自包含 Codex hook runner 源码；这些生成物必须包含意图门禁、轻量 hook profile、需求入口自省、对话内轻量确认、review HTML 正式评审、图片内容与效果图生成默认走 Codex Image 2 的提醒、logo/icon/avatar/badge 等开发素材默认按 `standalone asset` 生成且避免容器套壳的约束、历史 active change 的需求级健康提醒、benchmark/icon resource 路由、多对象多维信息的 Markdown 表格输出判断和文档影响判定规则，并把大量只读扫描调度保留在 discovery skill 中。对 Codex 的确认门禁还要额外声明：只有当前 lane 仍要求人类决策时，Agent 才必须用 final answer 结束本轮并发出确认请求；若当前 lane 已进入 `silent-record`，则可以直接记录当前精确匹配的稳定 artifact，不再重复停顿。
- `openspec/generate` 生成的 `spec.md` 使用中文结构字段，并在 change tasks 中加入 `docs/basic`、业务护栏验证与说明书维护任务；生成任务会用 `type` 区分实现、验证、文档和治理工作，避免文档/校验 checkbox 误触发长程实现阈值。任务标题默认按实现边界、入口接线、集成闭环和回归项来写，不允许把“主流程 / 功能需求 / 验收目标 / 非功能需求”这类 PRD 小节直接平移成任务；每个 `tasks*.md` 文件的 25 条上限只用于分片，不是默认拆解目标。除治理任务外，`verify` 必须是能证明实际落地的命令或审查步骤，不能只写 `openprd change . --validate`；`standards` 在 verify 阶段检查基础契约是否存在并满足结构要求。
- `loop` 在 finish 阶段同时沉淀 Markdown 测试报告与 HTML 回归报告，供后续复盘、交接和重复执行使用；当完成的是最后一个 loop 任务时，还会运行最终质量门禁，未 production-ready 时保持任务失败，避免把缺证据交付误判为完成。loop 的任务选择既支持内部 `task.id`，也支持人类可读的 `taskHandle`，让另一个对话只凭任务句柄就能继续同一执行单元。
- `quality` 在 verify 阶段扫描项目代码、包脚本、OpenPrd 任务状态、质量证据源和知识库状态，识别当前场景本期必测块、消耗型成本风险及其额度、滥用、监控、报警和止损证据，生成 JSON 与 HTML 回归测试报告；在 learn 阶段把报告沉淀为 incident、pattern 和经验 Skill。
- `growth` 在 observe 阶段只记录候选，不静默改变共享规则；在 apply 阶段只执行白名单配置写入，复杂候选保留为人工建议；`preferences.local.json` 用于少量用户个性化要求，不应提交到共享项目规则。
- OpenPrd 自身维护数据流中，配置类能力先经过 grow-aware 判断，再进入普通实现或 growth 候选设计；高置信可成长时直接补齐候选元数据，不确定时停在用户确认问题。
- `learning-review` 在未收到 Agent 内容时只写入 `agent-context.json`、`agent-prompt.md`、空内容合同和 reader 骨架；收到 `--content-json` 后校验内容结构、`visualExplainer` 字段与证据引用，再生成最终阅读器。学习包归档目录下还会预留 `assets/`，供 Codex Image 2 生成的图文解释图片落盘。

## 维护规则

- 每次服务边界、CLI/API 接入契约、数据流、存储或外部依赖发生变化后，必须检查并更新本文件。
