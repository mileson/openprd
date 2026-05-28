# 产品流程说明

## 核心流程

OpenPrd 的核心流程是：用户在项目中初始化或接入 `.openprd/` 工作区，Agent 先读取 `openprd run --context`、`status`、`next` 等只读状态，再根据用户当前意图决定是否推进实现、持续调研、变更任务或只读分析。当前流程强调三层协作面：前半段先通过 `intake-reflection.md` 做需求入口自省，并把 `clarify` 压缩成对话内轻量确认或简短清单，再通过 `review.html` 帮用户看清楚、比较清楚、确认清楚；执行段通过 tasks、loop、回归报告和必要的视觉对比图把实现与验证沉淀成结构化证据；质量段通过 `openprd quality --verify` 生成 HTML 回归测试报告，优先展示整体回归结果、逐需求模块结果、测试块通过情况、未通过项和需确认遗漏。用户只是要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、确认用效果图、视觉稿、mockup 或“先看样子”时，Agent 应直接调用 Codex 原生 Image 2 生成图片；`review.html` 不替代图片或效果图生成，`visual-compare` 只在进入实现阶段且已有参考图后用于实现截图对比。EVO 只作为内部质量评估/验证层代号，不作为用户读报告的前置概念。实现阶段必须同步经过 standards 和 quality 门禁，确认基础文档、文件说明书、文件夹说明书、日志、业务护栏、视觉复刻证据和评估证据是否需要补齐或更新。

## 用户路径

- 初始化项目：用户运行 `openprd init` 或 `openprd setup`，生成 `.openprd/`、`docs/basic/`、AGENTS 和各端 agent guidance；Codex hook 默认使用 `lite`，在明确 OpenPrd/深度流程提示词和新产品、模块、流程类需求下注入上下文，用只匹配直接编辑工具的轻量写入门禁阻断未确认需求的实现改动，并在本轮结束前通过 `Stop` 回顾是否值得沉淀项目经验。
- 规划或分析：用户要求“看看、梳理、怎么改、预计动哪些文件”时，Agent 只读检查代码、文档和 OpenPrd 状态后输出证据化结论，不启动 loop 或推进任务。
- 生成图片内容：用户要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup、先看样子或确认设计方向时，Codex hook 只注入提醒，不打开需求入口写入门禁；Agent 默认调用 Codex 原生 Image 2 产出图片，除非用户明确指定 HTML、SVG、CSS、Canvas、代码稿或可编辑矢量产物。
- 澄清与确认：当需求仍模糊、只有一句话、或需要多方案比较时，Agent 优先运行 `openprd clarify`。复杂或模糊需求会先生成三轮 `intake-reflection.md`，从用户意图、项目上下文和产品质量缺口压缩出必须确认的问题；简单明确调整只做轻量项目映射，不进入完整问题墙。`clarify` 只返回 `inline` 或 `inline-with-checklist`，Agent 直接在聊天里压缩目标、范围、非目标和验收点请用户确认，不生成或打开澄清 HTML。active requirement gate 存在时，`synthesize` 必须基于本轮 `capture` 后的状态，或显式传入新的 PRD 字段；不能直接复用历史 `current.json` 去合成并打开评审页。`synthesize` 在写出 `review.html` 前还会先预检生成的 `spec.md` 是否满足简体中文规则；如果只是内部措辞整理，应先用 `openprd capture . --source agent-normalized` 写回，再重新 synthesize。合成 PRD 后会生成一个工具无关的 work unit id，把本轮需求、目标根目录、版本、摘要指纹和稳定评审页写入 `.openprd/engagements/work-units/`。Agent 应优先把 `.openprd/artifacts/active/<version>-review/artifact.html` 这类稳定 artifact 路径给用户，而不是依赖可能被其他对话覆盖的 `engagements/active/review.html`；页面复制出的确认命令会携带 `--version`、`--digest` 和 `--work-unit`，`review` 校验一致后才记录确认状态。默认 approval policy 是 `decision-points`：当前 lane 仍需要人类决策时，先让用户评审当前稳定 artifact，再记录确认；如果用户一开始已经明确要求直接做，并显式表示不需要额外评审或确认，lane 才能进入 `silent-record`，只对当前精确匹配的 artifact 直接记录 review。已合成版本后再次 `capture` 用户确认或推导得到的 PRD 内容，会把旧评审状态标记为过期，并清掉 active 版本指针，防止多对话混用旧评审 artifact；仅用于 `agent-normalized` 的内部中文规范化或 `reviewPresentation` 展示层写回，不会重开用户 review。未记录 review 或标记为 `needs-revision` 的 PRD 不能生成 OpenPrd change 或进入实现；当前 artifact 记录完成后应先运行 `openprd change --generate` 产出 specs 和 tasks。若用户原始意图已经明确要求实现，tasks 就绪后可直接继续执行；否则等待一句明确的执行指令。
- 业务护栏澄清：当 PRD 命中免费用户、额度、AI 生成、模型调用或第三方成本风险时，`next` 会把成本来源、额度限制、滥用防护、监控信号、报警阈值和止损动作列为待确认问题。
- 大量只读扫描：当用户明确要求深度调研、全面梳理、交叉验证、并行排查或对标复刻时，OpenPrd discovery skill 负责判断是否启动只读 subagent，并要求主 Agent 汇总证据后再写入 claim、requirements、specs 或 tasks。
- 实现或继续任务：用户明确要求开发、实现、继续、深度调研、深度对标或复刻落地时，Agent 才能运行执行命令。`openprd run --context` 会优先推荐已确认 PRD 的 change 生成；如果已有 active change，则按任务 `type` 统计实质实现任务，`implementation` 任务达到 10 个时建议使用独立 worktree 或等价隔离环境，并通过单任务 Loop 会话推进。新增或修改代码文件前后，Agent 先对 touched files 运行 `openprd dev-check` 或 `scripts/openprd-dev-check.mjs`，根据 `ok`、`attention`、`warning` 状态判断是否可以局部编辑、是否需要说明职责边界、是否优先拆分或创建拆分任务；如果界面任务已有参考效果图、设计稿或用户给图，阶段性完成后必须截实现图并运行 `openprd visual-compare` 输出左右对比 JPG，查看后继续复刻到无明显差异；完成前还要检查 `docs/basic/`、文件说明书、文件夹说明书、结构化日志、业务护栏、视觉复刻证据和评估证据是否缺失或过期。
- 自我成长：当执行中发现未知代码扩展名、豁免路径、命令习惯、项目约定或用户偏好时，Agent 先运行 `openprd grow --review` 展示候选；共享规则只有在用户确认后才通过 `openprd grow --apply --id <candidate-id>` 固化，少量个人偏好只进入 user-local 范围。
- OpenPrd 自身维护：当需求涉及新增或修改配置类能力时，Agent 先判断是否 grow-aware。高置信可成长的能力默认补 candidate type、scope、review/apply 行为；不确定时主动询问用户是否纳入 `openprd grow`。
- 回归与就绪检查：实现完成后运行项目测试、`openprd standards --verify`、`openprd quality --verify`、`openprd run --verify` 和必要的 `doctor`。同时沉淀阶段性回归报告：前端任务优先记录界面验证策略；已有参考图的界面任务还要沉淀 `.openprd/harness/visual-reviews/` 下的 `openprd visual-compare` 视觉对比图；后端任务记录脚本或命令验证；`loop --finish` 在最后一个任务完成时会自动执行最终质量门禁，未 production-ready 时不标记最终任务完成。最终输出结构化测试报告、HTML 回归报告和 HTML 质量评估报告。涉及消耗型成本时，还要确认额度绕过、并发请求、越权身份、成本监控、报警阈值和止损动作已覆盖；如果质量报告 `productionReady=false`，最终输出必须列出缺证据或需关注的本期必测块，不能宣称整体就绪。
- 复盘学习与经验沉淀：`openprd learn` 先生成证据清单、Agent 上下文和写作提示；标题、大纲、正文、检索练习和工作示例由 Agent 基于证据写入 `learning-content.json` 后再渲染到 `reader.html`。已验证修复、重复问题、高影响排障或 Agent 误判问题会先通过 `openprd quality --learn --review --from <turn-state|report|diagnostics>` 生成 `.openprd/knowledge/candidates/` 和 `.openprd/knowledge/drafts/` 下的待确认草案，再通过 `openprd quality --learn --from <candidate-dir|report>` promote 为 `.openprd/knowledge/skills/` 下的项目级经验 skill。

## 状态变化

- `run --context` 只产生建议上下文，不自动授权执行。
- `run --context` 和 `run --verify` 默认只面向当前项目主验证状态；`mode=reference` 的 discovery run 不会自动混入主上下文或主校验，参考调研需通过 `openprd discovery` 命令单独查看。
- 默认 hook 保留轻量 PreToolUse 写入门禁，并把 matcher 收窄到直接编辑工具；`Stop` 不做完整工具级遥测，只在本轮结束前回顾 touched files 和 verify/finish 信号，判断是否生成项目经验草案。`guarded` 会额外覆盖 shell 工具，只有 `full` profile 才启用更重的全量工具级诊断。新产品、模块或流程需求会进入需求入口；带报错、日志、复现、根因排查等故障证据且用户明确要求直接修复的小型 bugfix 不进入需求入口，已打开入口也接受“确认修复”等自然确认词。
- `loop --run`、`tasks --advance`、`discovery --advance`、`finish --commit` 只有在用户明确执行意图下才进入执行状态。
- 深度 discovery 的只读 subagent 输出只作为候选证据，最终状态更新仍由主 Agent 通过 OpenPrd claim、任务和验证流程落地。
- standards 遇到嵌套 Git 参考仓库或 `toolkit-sources` 这类明显外部参考候选时，会先提示候选和归类命令，而不是直接把逐文件说明书缺口作为主阻塞；只有显式归类后才会稳定写入 `externalReferences.paths`。
- `clarify` 会先产出 `intake-reflection.md` 作为可审计的内部自省记录，再用 `inline` 或 `inline-with-checklist` 在 CLI 和对话内输出轻量澄清提纲。澄清阶段不生成 HTML，也不会自动打开浏览器；需要用户正式评审时，统一进入后续 `review.html`。
- `synthesize` 会产出稳定版本评审页和 active 快捷入口，交互式 CLI 自动打开稳定版本评审页。评审页用需求概览、需求关系图或需求流程图、四个带重点摘要胶囊的固定评审卡片和底部固定双按钮工具栏，把问题、范围、主流程、业务护栏、风险和开放问题压缩成需求定稿前的人机确认界面；顶部不展示低价值计数和状态噪音。需求关系图使用紧凑高度和小尺寸节点，节点标题应由 Agent 控制在 15 字以内，节点正文左对齐且每个卡片正文应由 Agent 控制在 30 字以内，避免大块居中文案占用视线；HTML 优先读取 `reviewPresentation.mapNodes` 和 `reviewPresentation.flowNodes` 作为图中展示文案，不直接裁剪原文。Agent 可以先运行 `openprd review-presentation . --template` 获取展示文案模板，再用 `openprd review-presentation . --presentation review-presentation.json --fail-on-violation` 校验；通过后用 `openprd capture . --field reviewPresentation --value "$(cat review-presentation.json)" --source agent-inferred` 写入展示层，也可以用随包发布的 `scripts/openprd-review-presentation.mjs` 做同样校验。OpenPrD review 上下文也会输出 `presentationContract`、`presentationFeedback`、`versionId`、`digest` 和 `workUnitId`，让 Agent 重新提炼超限内容并在确认时校验是否仍是本轮需求。“主流程与边界情况”卡片内会用轻量 SVG 小图展示用户旅程、关键步骤、边界情况和恢复路径，再展示明细列表。四个评审卡片的明细分点应由 Agent 写成 `- **摘要内容**：明细一句话`，HTML 会按“加粗摘要 + 一句说明”渲染，缺少该结构时通过 `presentationFeedback` 提醒 Agent 重写。重点摘要胶囊用于扫读，Agent 应控制在 15 个字以内，HTML 侧按内容自适应宽度并完整显示，不使用省略号截断；评审卡片副标题句末不加句号。底部工具栏固定在窗口底部，只保留“需要调整”和“认可方案”两个动作，点击复制内容必须带上版本、摘要指纹、work unit、标题和 OpenPrD review 上下文。面向用户的 review.html 和 diagram HTML 文案不得使用 `freeze` 这类内部词，应改写为“需求定稿前”或“进入实现前确认”。Agent 必须告知稳定 HTML 路径。当前 lane 仍要求人类决策时，确认请求要围绕这份稳定 artifact 发起；`review --mark confirmed` 只用于记录当前精确匹配的 PRD 版本，如果传入的 `--version`、`--digest` 或 `--work-unit` 与快照不一致，确认会被阻断。实现授权和 review 记录是两个独立门禁；用户已经说“可以开做”时，仍不能替另一份 artifact 补确认，但在显式直做且无需额外确认的 `silent-record` lane 中，可以对当前精确匹配的稳定 artifact 直接记录 review，然后继续 change / tasks。
- `change --generate` 只能在最新 PRD review 已确认后执行，并会在生成的任务里写入 `type` 元数据。`implementation` 任务用于判断是否进入长程实现拆分，`verification`、`documentation` 和 `governance` 任务用于保证验证、文档和流程收口不会被误计为实现复杂度。
- `loop --finish` 会同时产出 Markdown 测试报告和 HTML 回归报告，用于复盘、交接和重复验证。
- `visual-compare` 会把效果图和实现截图合成左右对比图片，默认输出 JPG 到 `.openprd/harness/visual-reviews/`；它只用于实现阶段已有参考图后的复刻验证，不能替代 Codex Image 2 的图片或效果图生成。
- `dev-check` 只检查 Agent 本次传入的代码文件，不扫描全仓库；它把 700 行以内标记为 `ok`，701-1500 行标记为 `attention`，超过 1500 行标记为 `warning`，生成文件、lock、vendor、快照等只记录为 `exempt`。
- `dev-check` 若遇到未配置扩展名但内容明显像代码，会先按代码候选参与本次分级，并把扩展名写入 `.openprd/growth/candidates.jsonl`；`grow --review` 展示待确认候选，`grow --apply` 才更新 `.openprd/standards/config.json`。
- 新增配置能力时，状态变化不止是“写入代码”：Agent 还要给出该能力是否纳入 growth 的判断。高置信可成长时直接成为 grow-aware 设计；不确定时停在用户确认状态。
- `quality --verify` 会产出 `.openprd/quality/reports/<id>.json` 和 `.openprd/quality/reports/<id>.html`，HTML 回归测试报告是阶段性质量查看的主要产物，包含整体结果、需求模块结果、测试块状态、本次执行证据和业务成本与滥用护栏。
- `quality --learn --review` 会先生成 knowledge candidate 和 draft skill；`quality --learn` 再把已确认的模式抽象为 incident、pattern 和项目经验 Skill，形成“问题修复 -> 验证 -> 草案 -> 沉淀 -> 下次触发”的项目级认知循环。
- `learn` 默认进入 `awaiting-agent-content` 状态，只提供 HTML 阅读器骨架和 Agent 写作工具包；传入 `--content-json` 后才进入 `agent-authored` 状态并展示正文。
- 新增或修改代码文件会先触发研发期行数回顾；新增或修改任何文件还会触发文档影响判定：缺失文档进入补齐状态，已有但受影响的文档进入更新状态，无需更新时要说明理由。
- standards、validate 或 doctor 失败时，状态回到修复阶段，不应声明实现完成。

## 维护规则

- 每次用户流程、页面跳转、任务状态或异常处理发生变化后，必须检查并更新本文件。
