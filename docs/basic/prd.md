# 产品逻辑说明

## 问题与目标

OpenPrd 要解决的是 Agent 在需求、调研、实现和交付之间缺少统一工作区状态与质量门禁的问题，同时避免质量门禁在小需求上变成额外负担。目标用户是使用 Codex、Claude 或 Cursor 进行产品/工程协作的团队。成功标准是 Agent 能基于 `.openprd/` 判断当前任务边界，只在明确执行意图下推进任务，并在实现完成前维护基础文档、文件说明书、文件夹说明书和业务成本护栏。对于仍处在 0 到 1 探索、脑暴或“值不值得做”判断的需求，OpenPrd 不只整理功能范围，还会默认补一层“验证与创业闭环”：第一批最容易触达的社区/种子用户、你为什么算这个社区里的自己人、当前替代方案和痛点证据、先怎么手工交付、手工作战卡、能不能先用 spreadsheet / 表单 / no-code 跑起来、如果必须开始做产品也只自动化最重复的一步并先压成 forms / lists / CRUD 骨架、什么承诺才算真需求、有没有 10 个样本和更强付费信号、第一版只做哪一件事、能不能压成周末级 MVP、第一批客户路径、从第一个客户开始怎么收费、客户 1 如何打平成本、达到什么条件才允许产品化，以及验证阶段怎样先活下来、增长阶段守什么纪律、这条路是否可逆、是否真在解决客户问题、是否符合团队价值观，以及这是不是团队愿意长期住进去、不会反过来绑住自己的业务形态。

## 初始化原则

OpenPrd 的需求初始化默认不是重问卷，而是先建立一层轻量的首轮项目画像：用户群体、产品形态、第一版切片、暂不处理、不能破坏和风险探针。只有当这层信息仍然模糊，或命中登录、数据、AI、外部服务、计费等高风险信号时，才继续追加更深的需求追问、技术边界确认和后续 PRD 结构化整理。如果当前问题更像创业验证而不是纯功能拆分，需求初始化会继续追问第一批可触达社区、社区契合依据、当前替代和痛点证据、手工交付路径、手工作战卡、一件事 MVP、周末级验证、最小工具桥接，以及如果必须开始做产品也只自动化最重复的一步并先压成 forms / lists / CRUD 骨架、第一批客户路径、初始收费假设、客户 1 盈利路径、付费验证信号、产品化门槛、增长纪律、default alive 约束、可逆性、客户真问题判断和价值观一致性，以及这是不是团队愿意长期住进去、不会反过来绑住自己的业务形态，而不是急着把方案写成既定功能。

## 用户故事

- 作为项目负责人，我希望 Agent 在我要求“看看、梳理、怎么改”时只做只读分析，从而避免误启动执行任务。
- 作为项目负责人，我希望大量只读扫描的并行调研规则由 OpenPrd discovery 管理，从而不需要在项目 AGENTS 中长期维护大段 subagent 说明。
- 作为开发者，我希望一句话小需求不会触发每个工具调用的 OpenPrd hook，从而让简单改动保持轻量。
- 作为开发者，我希望 Agent 在编辑代码文件前后快速知道文件行数状态和建议动作，从而避免继续向过大的单文件堆职责。
- 作为开发者，我希望 Agent 在执行中发现未覆盖的文件类型、豁免规则或我的个人偏好时先形成待确认候选，从而让 OpenPrd 能随着项目使用逐步变聪明，又不会静默污染共享规则。
- 作为 OpenPrd 维护者，我希望新增配置类能力时 Agent 默认思考是否应该纳入 grow 体系，从而让我只需要提出需求，不必每次额外提醒“这个要不要做成可成长配置”。
- 作为工程协作者，我希望 Agent 在新增或修改代码时自动判断文档影响，从而让 `docs/basic/`、文件说明书和文件夹说明书保持可信。
- 作为界面需求负责人，我希望我要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿或先看样子时 Agent 默认调用 `imagegen`（Codex 原生 Image 2），而不是擅自写临时 HTML/SVG/CSS 再截图，从而更快拿到图片内容且不污染项目文件。
- 作为界面需求负责人，我希望大界面改动在实现前先基于产品内真实截图生成 3 种不同设计方向效果图，并拼成一张可评审大图，从而先选方向再让 Agent 开始改界面。
- 作为界面需求负责人，我希望 OpenPrd 内置一套前端设计框架、资产库和模板骨架，让 Agent 在进入真实界面实现前先锁定 lens、theme、layout 和组件，而不是每次临场拼审美。
- 作为界面需求负责人，我希望内容型页面在缺少真实图片时先被识别出来，并补齐图片前置合同，从而减少“排版挺好看但没有真图、成品很空”的情况。
- 作为界面需求负责人，我希望涉及产品事实、版本、发布时间、规格、价格或地点信息的页面先写事实表，再进入视觉实现，从而避免“画得好看但事实错了”的废稿。
- 作为界面需求负责人，我希望确认后的整板、网格图或多对象效果图能先被切成 reference-set 并生成 contact sheet，从而让我先确认裁剪完整，再让 Agent 按对象逐项复刻而不是整板盲比。
- 作为界面需求负责人，我希望已有参考效果图时 Agent 必须把效果图和实现截图拼成左右对比图并据此返工，从而减少“看起来差不多”但实际不一致的交付。
- 作为界面需求负责人，我希望没有参考效果图的界面改动也能留下修改前和修改后的左右对比图，从而让 Agent 自己检查预期变化和意外漂移。
- 作为工程协作者，我希望每次阶段性开发结束后获得 HTML 回归测试报告，从而能先看回归结论概览、回归流程图、测试覆盖图、必测结果和需处理项，再按需要展开证据链、执行环境和结构化细节。
- 作为项目负责人，我希望涉及免费用户、额度、AI 调用或第三方成本的需求会自动追问成本来源、限制、报警和止损动作，从而减少免费额度被滥用造成真实损失的风险。
- 作为项目维护者，我希望排查并验证修复的问题能抽象成项目级经验 skill，从而让同类问题下次被提前识别。
- 作为项目维护者，我希望 Agent 在任务中多次使用且被我采纳的高质量外部信源能先进入候选库，并在达到阈值后提醒我确认纳入 benchmark，从而让参考来源也能随项目使用逐步沉淀。
- 作为维护者，我希望旧项目通过 fleet 刷新后也获得同样的 agent guidance 和历史 PRD work unit 绑定，从而减少历史项目沿用旧规则或多对话串需求的风险。
- 作为项目复盘读者，我希望复盘学习书的标题、大纲和正文由 Agent 根据真实任务证据撰写，而不是由 CLI 套用固定模板。

## 功能范围

- 包含：OpenPrd workspace 初始化、agent guidance 生成、意图门禁、run/loop/discovery/task 执行建议、standards 校验、历史项目 fleet 刷新和历史 PRD work unit 回填。
- 包含：主运行校验边界收敛，默认只展示当前项目主验证状态；参考调研和明显外部参考候选保持可见，但不直接污染主 `run --context` / `run --verify` 结果。
- 包含：OpenPrd discovery 的大量只读扫描调度规则，覆盖何时启动只读 subagent、默认调研与审查队形、最大并行数量、角色选择和证据合并要求。
- 包含：Codex hook profile，默认 `lite` 安装 `UserPromptSubmit` 和只匹配直接编辑工具的轻量 `PreToolUse` 写入门禁，`guarded` 额外覆盖 shell 工具，`full` 作为完整 hook 遥测的显式开启选项。
- 包含：实现阶段的文档影响判定规则，覆盖缺失文档补齐和已有文档过期检查。
- 包含：生成图片内容的 agent guidance，要求用户说“生成图片 / 封面图 / 配图 / 海报 / 插画 / 图标 / 贴纸 / 头像 / banner / 主视觉/KV / 运营图 / 效果图 / 视觉稿 / mockup / 先看样子 / 确认设计方向”时默认走 `imagegen`（Codex 原生 Image 2）；只有用户明确指定 HTML、SVG、CSS、Canvas、代码稿或可编辑矢量/source artifact 时才使用代码绘图路径。
- 包含：面向 UI 接入的图标资产链路，要求 logo、icon、avatar、badge、贴纸、空态插画、单物件 UI 位图等透明素材先生成 3 个异源候选方向，候选使用纯 `#00ff00` 绿幕、无文字、无 UI 容器并留足裁切边距；用户选定后再抠透明、裁切居中、导出 384px 或多尺寸资产，按真实 UI 位置调显示比例，并记录源图、透明产物、接入位置和验证结果。
- 包含：大界面改动的实现前视觉方案评审，要求 Agent 使用 Codex Computer Use 截取产品内当前功能截图，再用 `imagegen`（Codex 原生 Image 2）基于截图生成至少 3 个不同设计方向，并横向拼接成带 1/2/3 序号的大图供用户确认。
- 包含：`.openprd/design/` 前端设计框架层，内置 lenses、themes、layouts、components、recipes、checklists、assets 和 `active/` 活动合同，用于界面实现前的审美框架、资产约束和模板骨架复用。
- 包含：界面任务的设计前置门，要求按需补齐 `facts-sheet`、`asset-spec`、`image-preflight`、`direction-plan` 和 `selected-direction`，再进入真实编码。
- 包含：参考图预处理工具，通过 `openprd visual-prepare --reference <效果图> --grid <列>x<行>` 或 `--boxes <plan.json>` 把确认后的整板、网格图或多对象效果图整理成 reference-set，并生成 crops、contact sheet、compare-plan 以及 board 模板。
- 包含：界面视觉对比工具，通过 `openprd visual-compare --reference <效果图> --actual <实现截图> --locale <zh-CN|en>` 把两张图合成按当前用户主语言标注的左右对比图；没有参考图但改动界面时，通过 `openprd visual-compare --before <修改前截图> --after <修改后截图> --locale <zh-CN|en>` 合成同语言策略的自检图。默认输出 JPG 到 `.openprd/harness/visual-reviews/`；该工具只用于实现阶段视觉证据，不能替代实现前效果图方向评审。
- 包含：研发期 touched code files 标准层，通过 `openprd dev-check` 或 `scripts/openprd-dev-check.mjs` 返回代码文件行数、状态和下一步动作建议；需要关注的文件会形成“后续建议”表格行，并按 🔴 → 🟠 → 🟡 的关注程度排序。
- 包含：自我成长标准层，通过 `.openprd/growth/` 和 `openprd grow --review|--apply|--reject` 管理执行中发现的代码扩展名、豁免规则、命令习惯、项目约定和 user-local 偏好候选；代码扩展识别这类白名单工具补全可自动固化，用户偏好、项目协作规矩和 OpenPrd 默认行为留到收工复盘确认。
- 包含：benchmark 信源观察层，通过 `openprd benchmark observe` 把被用户采纳的高质量外部来源写入 candidate，保留累计采纳证据，并按最近 7 天滚动统计决定是否提示用户 approve；达到阈值后只提示用户 approve，不自动进入 approved registry。
- 包含：OpenPrd 自身维护时的 grow-aware 配置自检，覆盖新增或修改阈值、规则、识别、豁免、命令别名、环境差异、用户偏好和策略开关；高置信可成长时默认纳入 grow，不确定时主动询问用户。
- 包含：PRD 业务护栏层，在命中免费、额度、用量、AI 生成、模型调用或第三方成本信号时，要求补齐成本来源、额度限制、滥用防护、监控信号、报警阈值和止损动作。
- 包含：L2/脑暴阶段的创业验证闭环，要求 requirement 摘要、brainstorm 工作台和 PRD 同步呈现社区契合依据、当前替代与痛点证据、手工/表单/no-code 桥接、付费验证信号、产品化门槛、增长纪律和先活下来方案。
- 包含：`openprd quality` 质量层，初始化 `.openprd/quality/config.json`，生成 JSON + HTML 回归测试报告，评估当前质量场景、本期必测块、本次执行证据、中心化日志、链路关联字段、业务成本与滥用护栏、冒烟测试、任务覆盖、正常性能、极端压力数据和知识库沉淀。EVO 只作为内部质量评估/验证层代号，不要求用户在报告中理解该缩写。
- 包含：`.openprd/knowledge/` 项目级经验层，将已验证修复抽象为 incident、pattern 和可复用 skill。
- 包含：复盘学习包的 Agent 写作工具包、内容合同校验和 HTML reader 骨架；CLI 不直接生成读者可见的文章内容。
- 不包含：自动推断所有文档内容是否语义最新；Agent 仍需基于本次变更证据进行人工级判断并说明理由。

## 验收标准

- 规划、分析、审查类请求不会因 `run --context` 推荐而自动执行 loop、task advance、discovery advance 或 commit。
- `run --context` / `run --verify` 默认不会把 `mode=reference` 的 discovery run 当作主上下文或主校验结果；参考调研需要通过 `openprd discovery` 单独查看。
- standards 遇到嵌套 Git 参考仓库或 `toolkit-sources` 这类明显外部参考候选时，会先提示候选与 `classify-external` 命令，而不是直接用逐文件说明书缺口淹没主验证结果。
- 大量只读 discovery 的 subagent 调度规则存在于 OpenPrd skill 生成源和生成后的 skill 文件中，生成的 AGENTS 合同不包含这段长规则。
- 默认安装后的 Codex 配置包含轻量 OpenPrd `PreToolUse` 写入门禁，且 matcher 收窄到直接编辑工具，不包含只读 shell、PostToolUse 或 Stop 遥测 hooks。
- 明确实现类请求在完成前会检查基础文档、文件说明书、文件夹说明书是否缺失或过期，并补齐或说明无需更新。
- 用户要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup、先看样子或确认设计方向时，Codex hook 不把该输入升级为实现写入需求，Agent guidance 明确要求优先调用 `imagegen`（Codex 原生 Image 2）；除非用户指定 HTML/SVG/CSS/Canvas/代码稿，否则不得默认写临时 HTML 再截图。
- 大界面改动进入实现前，Agent guidance 会要求先用 Codex Computer Use 获取产品内当前功能截图，再用 Image 2 做 3 方向效果图，并把结果拼成横向评审大图给用户确认；未确认方向前不得进入大 UI 实现。
- 界面、页面、视觉、样式或前端体验任务进入真实实现前，生成的 AGENTS、shared/harness skill 和 command catalog 会明确要求先读取 `openprd-frontend-design` 与 `.openprd/design/`，并按需补齐 `facts-sheet / asset-spec / image-preflight / direction-plan / selected-direction`。
- 无明确参考方向的界面任务，3 个候选方向必须来自不同生成逻辑，至少在 lens、theme、layout 或素材策略上显著拉开；不能只是同一种安全极简解的轻微变化。
- `init/setup/update` 后，新工作区默认会带出 `.openprd/design/` 设计框架层和 `openprd-frontend-design` 生成 skill，`doctor` 能检查它们是否缺失或漂移。
- 如果确认参考图是一张整板、网格图或多对象组合，Agent guidance 会要求先运行 `openprd visual-prepare` 并检查 contact sheet；未生成 reference-set、compare-plan 或 board 模板前，不得把整板盲比当成充分验收。
- 界面、页面、视觉、样式或前端体验任务在已有参考图并进入实现阶段时，会先截实现图并运行 `openprd visual-compare --reference/--actual --locale <zh-CN|en>`；输出图标签跟随用户当前主语言，中文语境默认“效果图 / 实现截图”，英文语境默认“Reference / Implementation”。无参考图但改动界面时，Agent 会在动手前截修改前截图，完成后用同一入口、视口、账号和数据状态截修改后截图，并运行 `openprd visual-compare --before/--after --locale <zh-CN|en>`；输出图标签也跟随同一语言策略。Agent 需查看合成图并继续复刻或自检到无明显差异/漂移后才宣称视觉完成。
- 明确实现类请求在新增或修改代码文件前后，可以运行 `openprd dev-check <path> <file...>` 获取改动文件的关注程度和下一步建议；需要关注的文件必须在最终回复以 **后续建议** 为标题，用 Markdown 表格说明影响位置、关注程度、规模信号、为什么需要关注、本次处理和后续建议。
- 当 dev-check 识别出未知代码扩展名时，本次检查会按候选代码文件给出行数建议，并自动补齐识别规则、记录证据；非工具识别类候选通过 `openprd grow --review` 在收工时集中确认。未确认候选不得被描述为已生效规则。
- 当同一规范化外部信源被 `benchmark observe` 记录到采纳阈值时，`benchmark list` 和 `grow --review` 会给出 approve 建议；用户确认前该来源仍是 candidate，不能作为长期 approved benchmark 使用。
- 修改 OpenPrd 本身且涉及配置类能力时，Agent 会说明该能力是否 grow-aware；高置信可成长的配置默认带候选类型、scope、review/apply 行为，不确定时主动询问用户。
- 命中消耗型成本风险的 PRD 在业务护栏字段缺失时会回到 `clarify-user`，不会直接进入 freeze。
- 合成 PRD 后会生成工具无关的 work unit id 和稳定评审 artifact；默认 approval policy 是 `decision-points`，用户确认时应使用带 `--version`、`--digest`、`--work-unit` 的 `openprd review --mark confirmed`，参数不匹配时必须阻断，避免多 Agent 或多对话把确认写到其他需求。实现授权和 review 记录不能互相替代；常规 lane 下仍需用户先评审当前 artifact，只有在用户明确表示“不需要进行任何确认”时，才允许以 `silent-record` policy 直接记录当前精确匹配的稳定评审稿，单纯的“请帮我实现/继续实现”不触发这个豁免。
- 新需求入口打开后，`synthesize` 只能使用本轮已 `capture` 的需求状态或命令中显式传入的新 PRD 字段，不允许直接复用旧 `current.json` 伪造新的评审稿。Agent 在生成 `spec.md`、tasks 和对外说明时跟随用户当前主语言；无法判断时使用简体中文兜底。必要专有名词、品牌名、命令名、路径、字段名和 API 术语可以保留原文。已合成版本后再次 `capture` 用户确认或推导得到的内容，必须把旧评审状态标记为过期并清掉 active 版本指针；仅用于 `agent-normalized` 的内部措辞规范化或 `reviewPresentation` 展示层写回，不触发二次 review。
- 新 PRD 模板会单独保留“验证与创业闭环”章节，用来记录第一批先找谁、为什么算这个社区里的自己人、用户当前怎么替代、痛点证据、如何先手工或 no-code 交付、如果必须开始做产品也只自动化最重复的一步并先压成 forms / lists / CRUD 骨架、什么承诺算真需求、最低成本验证动作、达到什么条件才允许产品化、增长阶段守什么纪律，以及 default alive 约束，以及这是不是团队愿意长期住进去、不会反过来绑住自己的业务形态。
- 命中消耗型成本风险的 change 会自动生成成本额度、滥用越权、监控报警和止损验证任务。
- `openprd quality --verify` 会生成 `.openprd/quality/reports/<id>.html`，报告包含回归结论概览、回归流程图、测试覆盖图、本期必测结果、需要处理或确认的事项、验证材料、执行环境与覆盖、折叠明细和底部“需要补测 / 认可回归”操作栏。
- `openprd quality --verify` 默认在本期必测块未 production-ready 时返回失败；`openprd run --verify` 会再次执行该阻断，避免最终就绪判断忽略质量报告。
- `openprd loop --finish` 完成最后一个任务时会自动跑最终质量门禁；报告未 production-ready 时不标记最终任务完成。
- `openprd quality --learn --from <report>` 会把已审查报告沉淀为 `.openprd/knowledge/` 下的 incident、pattern 和项目级经验 Skill。
- `openprd learn` 未传入 Agent 写作内容时只生成待写作包；传入 `--content-json` 后，输出内容必须包含 Agent 写出的标题、大纲、章节和有效证据引用。
- `npm test`、`openprd standards --verify`、`openprd quality --verify`、`openprd run --verify` 能验证关键门禁没有回退。

## 维护规则

- 每次需求边界、用户故事、验收标准发生变化后，必须检查并更新本文件。
