# 产品逻辑说明

## 问题与目标

OpenPrd 要解决的是 Agent 在需求、调研、实现和交付之间缺少统一工作区状态与质量门禁的问题，同时避免质量门禁在小需求上变成额外负担。目标用户是使用 Codex、Claude 或 Cursor 进行产品/工程协作的团队。成功标准是 Agent 能基于 `.openprd/` 判断当前任务边界，只在明确执行意图下推进任务，并在实现完成前维护基础文档、文件说明书、文件夹说明书和业务成本护栏。

## 用户故事

- 作为项目负责人，我希望 Agent 在我要求“看看、梳理、怎么改”时只做只读分析，从而避免误启动执行任务。
- 作为项目负责人，我希望大量只读扫描的并行调研规则由 OpenPrd discovery 管理，从而不需要在项目 AGENTS 中长期维护大段 subagent 说明。
- 作为开发者，我希望一句话小需求不会触发每个工具调用的 OpenPrd hook，从而让简单改动保持轻量。
- 作为开发者，我希望 Agent 在编辑代码文件前后快速知道文件行数状态和建议动作，从而避免继续向过大的单文件堆职责。
- 作为开发者，我希望 Agent 在执行中发现未覆盖的文件类型、豁免规则或我的个人偏好时先形成待确认候选，从而让 OpenPrd 能随着项目使用逐步变聪明，又不会静默污染共享规则。
- 作为 OpenPrd 维护者，我希望新增配置类能力时 Agent 默认思考是否应该纳入 grow 体系，从而让我只需要提出需求，不必每次额外提醒“这个要不要做成可成长配置”。
- 作为工程协作者，我希望 Agent 在新增或修改代码时自动判断文档影响，从而让 `docs/basic/`、文件说明书和文件夹说明书保持可信。
- 作为界面需求负责人，我希望我要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿或先看样子时 Agent 默认调用 Codex 原生 Image 2，而不是擅自写临时 HTML/SVG/CSS 再截图，从而更快拿到图片内容且不污染项目文件。
- 作为界面需求负责人，我希望已有参考效果图时 Agent 必须把效果图和实现截图拼成左右对比图并据此返工，从而减少“看起来差不多”但实际不一致的交付。
- 作为工程协作者，我希望每次阶段性开发结束后获得 HTML 回归测试报告，从而能先看回归结论概览、回归流程图、测试覆盖图、必测结果和需处理项，再按需要展开证据链、执行环境和结构化细节。
- 作为项目负责人，我希望涉及免费用户、额度、AI 调用或第三方成本的需求会自动追问成本来源、限制、报警和止损动作，从而减少免费额度被滥用造成真实损失的风险。
- 作为项目维护者，我希望排查并验证修复的问题能抽象成项目级经验 skill，从而让同类问题下次被提前识别。
- 作为维护者，我希望旧项目通过 fleet 刷新后也获得同样的 agent guidance 和历史 PRD work unit 绑定，从而减少历史项目沿用旧规则或多对话串需求的风险。
- 作为项目复盘读者，我希望复盘学习书的标题、大纲和正文由 Agent 根据真实任务证据撰写，而不是由 CLI 套用固定模板。

## 功能范围

- 包含：OpenPrd workspace 初始化、agent guidance 生成、意图门禁、run/loop/discovery/task 执行建议、standards 校验、历史项目 fleet 刷新和历史 PRD work unit 回填。
- 包含：主运行校验边界收敛，默认只展示当前项目主验证状态；参考调研和明显外部参考候选保持可见，但不直接污染主 `run --context` / `run --verify` 结果。
- 包含：OpenPrd discovery 的大量只读扫描调度规则，覆盖何时启动只读 subagent、默认调研与审查队形、最大并行数量、角色选择和证据合并要求。
- 包含：Codex hook profile，默认 `lite` 安装 `UserPromptSubmit` 和只匹配直接编辑工具的轻量 `PreToolUse` 写入门禁，`guarded` 额外覆盖 shell 工具，`full` 作为完整 hook 遥测的显式开启选项。
- 包含：实现阶段的文档影响判定规则，覆盖缺失文档补齐和已有文档过期检查。
- 包含：生成图片内容的 agent guidance，要求用户说“生成图片 / 封面图 / 配图 / 海报 / 插画 / 图标 / 贴纸 / 头像 / banner / 主视觉/KV / 运营图 / 效果图 / 视觉稿 / mockup / 先看样子 / 确认设计方向”时默认走 Codex 原生 Image 2；只有用户明确指定 HTML、SVG、CSS、Canvas、代码稿或可编辑矢量/source artifact 时才使用代码绘图路径。
- 包含：界面视觉对比工具，通过 `openprd visual-compare --reference <效果图> --actual <实现截图>` 把两张图合成带“效果图 / 实现截图”简体中文标签的左右对比图，默认输出 JPG 到 `.openprd/harness/visual-reviews/`；该工具只用于实现阶段已有参考图后的复刻验证。
- 包含：研发期 touched code files 标准层，通过 `openprd dev-check` 或 `scripts/openprd-dev-check.mjs` 返回代码文件行数、状态和下一步动作建议；700 行以内正常，701-1500 行需注意，超过 1500 行警告。
- 包含：自我成长标准层，通过 `.openprd/growth/` 和 `openprd grow --review|--apply|--reject` 管理执行中发现的代码扩展名、豁免规则、命令习惯、项目约定和 user-local 偏好候选；共享配置必须经用户确认后才固化。
- 包含：OpenPrd 自身维护时的 grow-aware 配置自检，覆盖新增或修改阈值、规则、识别、豁免、命令别名、环境差异、用户偏好和策略开关；高置信可成长时默认纳入 grow，不确定时主动询问用户。
- 包含：PRD 业务护栏层，在命中免费、额度、用量、AI 生成、模型调用或第三方成本信号时，要求补齐成本来源、额度限制、滥用防护、监控信号、报警阈值和止损动作。
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
- 用户要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup、先看样子或确认设计方向时，Codex hook 不把该输入升级为实现写入需求，Agent guidance 明确要求优先调用 Codex 原生 Image 2；除非用户指定 HTML/SVG/CSS/Canvas/代码稿，否则不得默认写临时 HTML 再截图。
- 界面、页面、视觉、样式或前端体验任务在已有参考图并进入实现阶段时，会先截实现图并运行 `openprd visual-compare`；输出图左侧标注“效果图”、右侧标注“实现截图”，Agent 需查看合成图并继续复刻到无明显差异后才宣称视觉完成。
- 明确实现类请求在新增或修改代码文件前后，可以运行 `openprd dev-check <path> <file...>` 获取 `ok` / `attention` / `warning` / `exempt` 状态；`attention` 需要说明局部职责，`warning` 需要优先拆分或创建拆分任务。
- 当 dev-check 识别出未知代码扩展名时，本次检查会按候选代码文件给出行数建议，并生成可通过 `openprd grow --review` 查看、通过 `openprd grow --apply --id <candidate-id>` 固化的候选；未确认候选不得被描述为已生效规则。
- 修改 OpenPrd 本身且涉及配置类能力时，Agent 会说明该能力是否 grow-aware；高置信可成长的配置默认带候选类型、scope、review/apply 行为，不确定时主动询问用户。
- 命中消耗型成本风险的 PRD 在业务护栏字段缺失时会回到 `clarify-user`，不会直接进入 freeze。
- 合成 PRD 后会生成工具无关的 work unit id 和稳定评审 artifact；默认 approval policy 是 `decision-points`，用户确认时应使用带 `--version`、`--digest`、`--work-unit` 的 `openprd review --mark confirmed`，参数不匹配时必须阻断，避免多 Agent 或多对话把确认写到其他需求。实现授权和 review 记录不能互相替代；常规 lane 下仍需用户先评审当前 artifact，只有在用户一开始已经明确要求直接做、并显式表示不需要额外评审或确认时，才允许以 `silent-record` policy 直接记录当前精确匹配的稳定评审稿。
- 新需求入口打开后，`synthesize` 只能使用本轮已 `capture` 的需求状态或命令中显式传入的新 PRD 字段；在生成 `review.html` 前会先预检派生出来的 `spec.md` 是否满足简体中文规则，避免 review 确认后再被 spec 规则打回。已合成版本后再次 `capture` 用户确认或推导得到的内容，必须把旧评审状态标记为过期并清掉 active 版本指针；仅用于 `agent-normalized` 的内部措辞规范化或 `reviewPresentation` 展示层写回，不触发二次 review。
- 命中消耗型成本风险的 change 会自动生成成本额度、滥用越权、监控报警和止损验证任务。
- `openprd quality --verify` 会生成 `.openprd/quality/reports/<id>.html`，报告包含回归结论概览、回归流程图、测试覆盖图、本期必测结果、需要处理或确认的事项、验证材料、执行环境与覆盖、折叠明细和底部“需要补测 / 认可回归”操作栏。
- `openprd quality --verify` 默认在本期必测块未 production-ready 时返回失败；`openprd run --verify` 会再次执行该阻断，避免最终就绪判断忽略质量报告。
- `openprd loop --finish` 完成最后一个任务时会自动跑最终质量门禁；报告未 production-ready 时不标记最终任务完成。
- `openprd quality --learn --from <report>` 会把已审查报告沉淀为 `.openprd/knowledge/` 下的 incident、pattern 和项目级经验 Skill。
- `openprd learn` 未传入 Agent 写作内容时只生成待写作包；传入 `--content-json` 后，输出内容必须包含 Agent 写出的标题、大纲、章节和有效证据引用。
- `npm test`、`openprd standards --verify`、`openprd quality --verify`、`openprd run --verify` 能验证关键门禁没有回退。

## 维护规则

- 每次需求边界、用户故事、验收标准发生变化后，必须检查并更新本文件。
