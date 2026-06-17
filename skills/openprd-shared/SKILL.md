---
name: openprd-shared
description: OpenPrd 工作区与产物的共用守则。凡是需要查看、更新或推进 OpenPrd 工作区，包括 classify、interview、synthesize、diagram、freeze、handoff、图示评审或解读 `.openprd/` 状态文件时，都优先使用这份共用规则。
---

# OpenPrd Shared

## 概览

这份 skill 是所有 OpenPrd 工作的共用规则集。它负责放置跨场景约束，让各个领域 skill 更聚焦，也让 agent 行为更稳定、可预期。

## 用户心智与表达规则

- 默认把 OpenPrd 用户当成懂业务、懂产品、关心落地结果的人，而不是懂技术概念、内部流程或工具术语的人。
- 用户耐心低，输出要先给结论和下一步；能一句说清楚就不要拆成两步，细节等用户追问时再展开。
- 面向用户的 HTML、报告、评审说明和对话回复，避免 `freeze`、hook、门禁、EVO、schema、runtime 等内部词；必要技术名词只在确实影响决策时出现，并用业务语言解释结果。
- 主动替用户补全没有想到的情况：范围边界、失败路径、恢复路径、实现成本、维护成本、滥用风险、第三方依赖、上线后验证和后续扩展。
- 对外 README、首页概览、发布说明和带文字的示意图，默认先站在产品和业务用户角度解释：谁在什么场景下遇到什么问题、怎么确认、收益和风险是什么。解释需求分流时，优先使用“直接处理 / 现有功能优化 / 新功能/新流程方案”这些用户可理解名称，再在内部保留 L0/L1/L2。
- 默认成本敏感，追求“效果足够好 + 投入最少 + 后续维护不重”的性价比；不要为了技术漂亮引入昂贵或复杂方案。
- 涉及第三方 API、模型、云服务、付费工具或外部供应商时，优先比较多家可行方案，用表格列出效果、价格、接入成本、限制、风险和推荐理由，并给出性价比最好的默认选择。
- 当用户的问题包含多个对象、方案、文件、场景、风险、验证项、素材或任务，并且需要同时呈现状态、证据、影响、动作或推荐时，Agent 应主动使用 Markdown 表格，不等用户要求。先用一句话给结论，再给表格。
- 表格优先用于方案对比、状态盘点、问题排查、风险审查、多对象 QA、文件/命令清单、需求场景覆盖和内容/素材规划；单一结论、单一动作、代码示例、命令示例和叙事型说明不要强行表格化。
- 当用户需要理解复杂关系、状态跳转、因果链、边界分工、路径差异、风险传播或方案取舍时，优先用“结论 + 解释型 SVG 图 + 少量补充”的图解优先表达；能被一张图讲清的内容，不要先输出长段落文字。
- 解释型 SVG 是对话辅助，不是正式评审或验收产物；它用于让用户快速看懂，不替代 `review.html`、`openprd diagram`、`visual-compare`、测试证据、调研证据或实现截图。
- 图解优先不等于所有问题都画图：单一事实、短命令输出、简单 yes/no、精确错误文本、合规/安全必须逐字说明的内容，仍用简短文字或表格。
- 如果用户明确说质量优先、稳定性优先或体验优先，就降低价格权重，优先保证效果、可靠性和长期可维护性。

## 共用运行规则

1. 动手前先从工作区重建上下文。
   - 优先读取 `.openprd/state/current.json`、`.openprd/state/task-graph.json`、`.openprd/state/release-ledger.json`、最新版本快照和当前 engagement 文件，不要只依赖聊天上下文。
2. 明确区分只读命令和写入命令。
   - 只读命令：`status`、`validate`、`next`、`history`、`diff`、`interview`、`doctor`
   - 写入命令：`init`、`setup`、`update`、`classify`、`synthesize`、`diagram`、`release`、`freeze`、`handoff`
   - 执行命令：`loop --run`、`tasks --advance`、`discovery --advance`、`loop --finish --commit`、git commit、git push，必须有当前用户明确执行意图。
3. 不要虚构 OpenPrd 命令或产物类型。
   - 不确定时先对照 `openprd --help`。
4. 共用规则放在这里，领域规则放到对应 skill。
5. 用户可见文档、报告，以及 Agent 产出的 spec 和 tasks 跟随用户当前主语言；无法判断时用简体中文兜底。必要专有名词、品牌名、命令名、路径、字段名和 API 术语可以保留原文。
   - OpenPrd 自身及随包 workspace / template / skill README 默认把简体中文放在 `README.md`，英文放在 `README_EN.md`；如需兼容旧链接，可保留 `README_CN.md` 作为跳转入口。
   - 如果 README、概览图或发布说明存在双语版本，带文字的图片资产也要与 `README.md` / `README_EN.md` 成对维护并同步更新，避免一边改了文案、另一边还停留在旧说法。
   - 入口路由优先看 `skills/openprd-router/SKILL.md`
   - 工作流编排归 `$openprd-harness`
   - 最佳实践、benchmark、对标、参考产品、prompt engineering、Agent harness、context engineering、图标资源、CLI 或 skill 体系设计归 `$openprd-benchmark-router`
   - 图示生成与评审归 `$openprd-diagram-review`
   - 项目文档标准归 `$openprd-standards`
   - Agent 接入与 hook 健康度归 `$openprd-harness`，通过 `openprd setup/update/doctor` 维护
   - 具体命令速查优先看 `.openprd/harness/command-catalog.md`
   - `AGENTS.md` 只保留轻量合同；详细执行细则优先写进 repo-local skills、command catalog 和 hooks
5. 所有用户可见产物都跟随用户语言。
   - 标签、评审说明、摘要卡片和操作指引应跟随用户当前主语言。
   - 专有名词、产品名、协议名、API 名称、框架名和云产品名在翻译会损失清晰度时保持原样。
6. 对不确定性要显式表达，不要悄悄脑补。
   - 缺失假设、范围缺口和未解决问题都应该保留在开放问题或评审说明里。
7. 把 freeze 和 handoff 当成门禁动作。
   - 如果工作区仍有需要暴露给用户的关键不确定性，就不要声称已经就绪。
8. 优先使用图结构和状态来推导下一步。
   - 使用 `nextReadyNode`、blocker、当前产物和校验状态来解释为什么接下来该这么做。
9. 执行循环优先依赖 hook-stable 的 run 状态。
   - 用 `openprd run <path> --context` 选择下一个任务、discovery 条目或工作流动作。
   - 把 `run --context` 当作建议上下文，而不是直接执行命令。
   - 声称就绪前运行 `openprd run <path> --verify`。
   - 使用 `.openprd/harness/run-state.json`、`iterations.jsonl` 和 `learnings.md` 承接新会话。
   - 用户给出会话 ID 并要求继续时，按工具无关的历史会话精确续接；不要要求工具专属 ID，也不要用当前 active change、相似历史或 requirement gate 替代指定会话。
   - 用户没有给 ID、但明确描述了某个已有需求、change、task 或 work unit 时，先按描述解析对应对象；只有解析不出来时，才把当前工作区状态当作背景继续看。
   - 使用 `.openprd/harness/install-manifest.json`、`hook-state.json`、`events.jsonl` 和 `drift-report.json` 判断生成引导是否健康。
   - 前端体验任务进入实现前，优先读取 `skills/openprd-frontend-design/SKILL.md` 与 `.openprd/design/`，先锁定 lens、theme、layout 和组件，再决定是否实现。
   - 使用 `.openprd/harness/visual-reviews/` 承接用户已经确认纳入后续对比的 reference-set、选中方向、实现后视觉对比证据、局部焦点证据板、并行实验证据板、截图实测证据板和对齐辅助线证据板；候选效果图默认不要直接登记进去。
   - 使用 `.openprd/quality/config.json`、`.openprd/quality/reports/` 和 `.openprd/knowledge/` 判断实现就绪、当前场景必需 EVO 证据和可复用经验。
   - 使用 `.openprd/growth/` 承接收工阶段的自我成长复盘；工具识别补全和减少重复打扰这类高置信低风险项可自动补齐，用户偏好、项目协作规矩和 OpenPrd 默认行为留到收工时集中确认。
10. 生成图片内容时默认使用 `imagegen`，也就是 Codex 原生 Image 2；Image 2 是工具路径，不是审美豁免。
   - 当用户要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup、先看样子或先确认设计方向时，默认直接调用 `imagegen` 产出图片。
   - 生成前先写清用途、受众、气质、约束和记忆点，并把这些写进 prompt；没有品牌或参考图依据时，用 `.openprd/design/anti-slop.md` 排除默认紫白/蓝紫渐变、通用字体、白底卡片堆叠和无语境装饰。
   - 对 logo、icon、avatar、badge 等开发素材，如果用户没有明确要求 mockup、场景图、设备框、卡片承载、名片/包装展示或参考界面复刻，默认按 `独立素材输出（standalone asset）` 处理：使用全画布单主体，不额外添加 UI frame、卡片、设备壳、名片、桌面陈列、手持实拍或其他展示容器。
   - 只有当用户明确要求 mockup、场景化效果图、容器化呈现，或参考图本身就包含这些承载结构时，才生成对应的容器或场景。
   - 除非用户明确指定 HTML、SVG、CSS、Canvas、代码稿或可编辑矢量/source artifact，不要改用临时 HTML/SVG/CSS 再截图。
   - 只有实际发生 `imagegen` 调用后，才能汇报生图结果、失败或限流；未调用 `imagegen` 前，不要声称“生图限流”或“生图失败”。
   - 生图结果先当候选效果图，不要默认登记到 `.openprd/harness/visual-reviews/`。看图时不仅判断是否生成成功，还要判断气质、层级、字体/色彩/表面角色和记忆点是否成立。如果用户还要继续做实现，主动确认是否符合预期、是否纳入后续效果图/实现截图对比、以及是否按此继续实现；只有确认后才把选定方向、整张图或其中子图整理成 reference-set。
   - OpenPrd 的 `review.html` 只用于需求评审，不能替代图片或效果图生成；`visual-compare` 只用于实现阶段视觉证据：已有确认参考图时做“效果图 / 实现截图”对比；没有参考图时先判断新建界面还是修改既有界面，新建界面回到实现前 3 方向方案评审，修改既有界面做“修改前 / 修改后”自检；当局部细节更重要时，优先改用 `--board` 生成“局部焦点证据板”；当并行跑了多个优化方向时，优先改用 `--board` 生成“并行实验证据板”；普通截图、Computer/Browser/Playwright 实测截图要作为视觉证据时，优先改用 `--board` 生成“截图实测证据板”；新功能或改动包含同构列表、卡片、网格或表格，或用户反馈没有对齐/排版漂移时，优先改用 `--board` 生成“对齐辅助线证据板”，叠辅助线并量相同槽位的 x/y/宽高 spread。visual evidence 同时检查气质、层级、字体/色彩/动效/表面角色和记忆点，不只检查截图是否存在。
11. 界面视觉实现有参考图时，必须留下左右对比图。
   - 只要任务涉及界面、页面、视觉、样式或前端体验，并且已经有效果图、设计稿、截图或用户给图且进入实现阶段，阶段性完成后先截取实现截图。
   - 运行 `openprd visual-compare . --reference <效果图> --actual <实现截图> --locale <zh-CN|en>`，默认输出 JPG 到 `.openprd/harness/visual-reviews/`。
   - 如果一张参考图里有多个子图、网格或对象，先运行 `openprd visual-prepare . --reference <效果图> --grid <列>x<行>` 或 `--boxes <plan.json>`，检查 contact sheet 后再逐项对比。
   - 合成图左侧必须标注“效果图”，右侧必须标注“实现截图”；查看合成图后继续对标，直到结构、气质、层级、字体/色彩/表面角色和记忆点都没有明显差异。若用户后续说“跟效果图”“不一致”“好丑”“复刻”，至少先产出一份视觉证据图，不要只口头说已经对比过了。
   - 如果整体图之外还要审局部细节，再补一份 `openprd visual-compare . --board <focus-board.json> --locale <zh-CN|en>`，把整体标框和局部放大放在同一张证据板里。
   - 如果新开发或修改了同构列表、卡片、网格或表格，或用户反馈没对齐/排版漂移，再补一份 `openprd visual-compare . --board <alignment-board.json> --locale <zh-CN|en>`，把真实截图、对齐辅助线、标题/标签/描述/状态/操作区等相同槽位的 x/y/宽高 spread 放在同一张证据板里。
   - 未生成并查看对比图，或对比图仍有明显差异时，不要声称界面复刻或视觉实现完成。
12. 界面视觉实现无参考图时，先区分新建界面和修改既有界面。
   - 只要任务涉及界面、页面、视觉、样式或前端体验，但没有明确效果图、设计稿、截图或用户给图，先判断这是新建界面还是修改既有界面。
   - 新建首屏、首页、控制台或核心页面时，回到实现前 3 方向方案评审；修改既有界面时，动手前先用 Computer Use、Browser、Playwright 或项目现有工具截取修改前截图。
   - 修改既有界面完成后，用同一入口、视口、账号和数据状态截取修改后截图，再运行 `openprd visual-compare . --before <修改前截图> --after <修改后截图> --locale <zh-CN|en>`。
   - 合成图左侧必须标注“修改前”，右侧必须标注“修改后”；查看合成图后确认预期变化出现，并检查本轮审美意图、记忆点和未改区域没有明显布局、颜色、密度或状态漂移。
   - 如果并行试了多条优化方向，再补一份 `openprd visual-compare . --board <parallel-board.json> --locale <zh-CN|en>`，把多方案截图、GIF 首帧和指标放到同一板里对比。
   - 如果只是普通截图或 Computer/Browser/Playwright 实测截图作为视觉或运行态证据，再补一份 `openprd visual-compare . --board <verification-board.json> --locale <zh-CN|en>`，把检查路径、截图和 checkpoint 放到同一板里。
   - 这类自检不能替代大界面方向性改造的实现前方案评审。
13. 大界面改动实现前必须先完成视觉方案评审。
   - 触发条件：会明显改变页面信息架构、主视觉、核心布局、关键路径、组件层级/密度，或用户需要先选择设计方向。
   - 位置：需求分流之后、PRD 定稿或实现开工之前；它不是 `review.html`，也不是实现后的 `visual-compare`。
   - 步骤：已有界面时用 Codex Computer Use 进入产品内对应功能并截当前真实界面；冷启动没有现有界面时，基于已确认 PRD、用户群体、第一版切片、视觉目标、气质端点和记忆点生成设计 brief；用 `imagegen`（Codex 原生 Image 2）基于截图或设计 brief 至少生成 3 个不同设计思想方向；每个方向都要有具体审美主张和 anti-slop 自检；把效果图横向拼成一张大图，每张左上角标注 1/2/3，先作为候选效果图展示。
   - 交互：主动确认是否符合预期、是否纳入后续效果图/实现截图对比、以及是否按此继续实现；只有确认后才把选定方向、整张图或其中子图整理到 `.openprd/harness/visual-reviews/`。用户确认前，不进入大 UI 实现，也不要声称界面方案已定。
14. 界面任务进入实现前，先用 `.openprd/design/` 锁定设计框架。
   - 页面涉及具体产品事实、版本、发布时间、规格、价格、引用数据或地点事实时，先补 `.openprd/design/active/facts-sheet.md`，不要凭记忆写页面。
   - 页面依赖 logo、产品图、UI 图、摄影图、插图、图表或品牌色字体时，先补 `.openprd/design/active/asset-spec.md`。
   - 旅游、展览、内容、案例、发布、品牌故事等内容型页面，要先判断真实图片是不是页面成立前提；必要时先补 `.openprd/design/active/image-preflight.md`，不要默认用占位块硬做。
   - 没有明确参考方向时，先补 `.openprd/design/active/direction-plan.md`，并确保 3 个方向来自不同生成逻辑，而不是三个同一种安全解的轻微变体。
   - 用户选定方向后，再补 `.openprd/design/active/selected-direction.md`，把选中的 lens、theme、layout、组件和风险锁定。
15. 把文档与结构回顾视为实现的一部分，而不是开工前的噪声。
   - 代码修改完成后、最终回复前，针对本轮实际新增或修改的 code files 运行 `openprd dev-check . <file...>` 或 `node scripts/openprd-dev-check.mjs . <file...>`。
   - dev-check 默认是收工回顾，不是开工许可证；只有用户明确询问影响文件、拆分边界，或你已经判断需要先设计拆分范围时，才在开发前额外运行。
   - 行数状态按研发期标准解读：700 行以内正常；701-1500 行需留意；超过 1500 行说明后续改动成本较高。若出现需要关注的文件，最终回复必须以 **后续建议** 为标题，用 Markdown 表格列出影响位置、关注程度、规模信号、为什么需要关注、本次处理和后续建议，并按 🔴 → 🟠 → 🟡 排序；若只是窄 bugfix 或小修且暂不拆，要在表格里说明本次处理边界并留下后续拆分建议。
   - 如果 dev-check 或执行过程发现可沉淀项，不要中途打断当前任务。高置信工具识别补全可自动固化并简短说明；用户偏好、项目协作规矩或 OpenPrd 默认行为先记录为候选，收工时运行 `openprd grow . --review` 集中确认。
   - 维护 OpenPrd 本身时，只要新增或修改配置类能力（阈值、规则、识别、豁免、命令别名、环境差异、用户偏好或策略开关），都要做 grow-aware 自检：高置信应可成长时默认纳入 `openprd grow`；不确定时主动问用户；明确一次性或固定规则时才保持静态配置。
   - 新增或修改文件时，检查 `docs/basic/`、文件说明书和文件夹 README 是否缺失或已过期。
   - 当职责、流程、结构、依赖或产品行为变化时，补齐缺失文档并更新已有文档。
   - 涉及后端、脚本、Agent、工具链、服务或数据处理变更时，把 CLI 与 API 视为同级接入面；检查命令入口、参数、输出契约、`help`/`doctor`/`dry-run`/`status` 与接口协议、返回结构、身份边界是否受影响，并同步更新 `docs/basic/backend-structure.md`；若某一面不适用也要明确写原因。
   - `.openprd/harness/install-manifest.json` 的 `optionalCapabilities` 用来记录非阻断式增强建议，例如 Context7、DeepWiki。当前任务明显受益但状态仍是 `recommended` 时，在后续建议里解释它能帮什么、附官方文档和 GitHub 链接，并可顺手提出“如果你愿意，我可以按当前客户端帮你补配置”；不要因为它未配置就阻断当前任务。
16. hook 重量要和任务风险匹配。
   - 默认 Codex hook profile 是 `lite`：`UserPromptSubmit` 注入上下文，轻量 `PreToolUse` 写入门禁阻断过早实现，`Stop` 在本轮结束前回顾是否值得沉淀项目经验。明确的 OpenPrd / 深度工作提示词，以及新的产品、模块、流程需求都会注入上下文。
   - 只有项目明确需要完整 hook 遥测或临时深度诊断时才使用 `full`。
17. 需求流程先分流再加门禁。
   - 分流优先使用 `$openprd-requirement-intake`，不要按固定关键词判断。
   - 用户可见需求类型和内部路由码的固定对照为：直接处理=L0、现有功能优化=L1、新功能/新流程方案=L2；默认把路由码并进“需求类型：直接处理（L0）”这类标签里，只有内部排障确实受益时才额外补“内部路由码”。
   - 直接处理通常包括空格、错别字、按钮文案、简单样式、明确 bugfix 和低风险局部调整；直接执行，完成后说明变更和验证。
   - 现有功能优化有明确落点但影响多个文件或行为；先给对话内 mini-plan，再实现和验证。
   - 如果用户刚刚已经确认了现有功能优化（L1）的 mini-plan、范围边界或正式产品边界，后续承接要明确写成“已确认，我按这个继续/收口/落地”，不要只写一个“确认”，也不要写成“确认，我们就按这个……”这种像再次索取确认的句子。
- 新功能/新流程方案包括新产品、模块、流程、权限、计费、AI/第三方集成、云服务、跨系统、数据迁移或边界不清的需求；先走 requirement intake、对话内 requirement 摘要确认、review、change 和 tasks，再实现。
- 对话内 requirement 摘要保持原有“需求判断 / 需求理解 / 功能范围 / 技术方案”结构，但 `需求判断` 和 `需求理解` 先用轻量主句说清结论；边界、风险、异常例子和技术细节下沉到后面的分项或表格，不要把它们挤成一大段。
- 对于 L2 或脑暴诉求，默认再补一层“创业验证闭环”：第一批最容易触达的人群/社区、你为什么算这个社区里的自己人、当前替代方案和痛点证据、先不做完整产品时的手工路径、手工作战卡、一件事 MVP、周末级验证、能否先用 spreadsheet / 表单 / no-code 跑起来、如果必须开始做产品也只自动化最重复的一步并先压成 forms / lists / CRUD 骨架、第一批客户路径、从第一个客户开始怎么收费、客户 1 如何打平成本、有没有 10 个样本和更强付费信号、达到什么条件才允许产品化、增长阶段守什么纪律，以及验证阶段怎样先活下来、这条路是否可逆、是否真在解决客户问题、是否符合团队价值观，以及这是不是你愿意长期住进去、不会反过来绑住团队的业务形态。
- 历史 active change 在新 requirement intake 激活时只作为提醒，不抢当前主线。
   - 会话 ID、task handle、work unit 和用户明确描述的已有需求对象，都比全局 active change 更具体；必须先解析这些显式目标，再决定是否沿用当前工作区状态。
18. 关键产品事实缺失时，先问用户再推进。
   - 如果当前模式不能使用结构化 ask-user 工具，就用自然语言直接询问。
   - 不要把“工具不可用”当成可以悄悄猜测的理由。
19. 外部技术与公开仓库调研遵循“本地优先、外部证据最小够用”。
   - 先读本地代码、锁文件、README、类型定义和现有上下文。
   - 涉及第三方库、框架、API、SDK、MCP、CLI 工具的用法、配置、限制、版本差异或迁移路径，本地证据不足时再交给 `$openprd-benchmark-router`，并按 `resolve_library_id -> query_docs` 使用 Context7。
   - 涉及公开 GitHub 仓库的架构、核心模块、关键流程或对标结论时，先交给 `$openprd-benchmark-router`，并按 `read_wiki_structure -> ask_question` 使用 DeepWiki。
   - 一旦证据足够支撑当前决策就停止扩展；如果 DeepWiki、Context7 或官方资料覆盖不足，要明确写出缺口。
20. 涉及凭证、账号和个人信息时，先走 `secrets-vault`。
   - 任务需要 API key、token、账号信息、第三方服务凭证或个人信息时，先使用 `secrets-vault` skill 获取已有凭证，不要立即向用户索要。
   - 只读取当前任务所需的最小字段；不要直接读取原始 vault 文件，也不要在日志、代码、回复或提交里暴露完整密钥。
21. 修改 skill、`SKILL.md`、`AGENTS.md` 或相关 workflow 前，先可视化确认。
   - 先读取当前 skill / AGENTS 现状，再输出一张彩色 Mermaid 方案图。
   - Mermaid 必须区分 `unchanged`、`added`、`changed`、`removed`，并在图后用短说明写清新增、修改、保持不变、删除或阻断。
   - 必须等待用户明确确认后，才能修改相关文件。
22. 涉及微信小程序运行态时，只在明确需要运行态证据时再升级到本地验证。
   - 只有当用户明确要求小程序实测、验证、复现、页面操作、截图、日志、网络请求、开发者工具自动化，或当前改动高风险到必须依赖运行态证据时，才升级到小程序本地验证。
   - 一旦进入小程序运行态验证，默认沿用当前小程序运行态或开发者工具会话连续验证，不要为了验证自动重开应用；只有用户明确要求从 0 到 1、冷启动、重开或重新打开时，才从头启动。
   - 优先使用当前环境已配置的小程序本地验证能力；如果当前客户端没有相应工具，不要假定已经安装，也不要把缺少工具本身当成任务失败。
   - 未拿到本地运行态证据前，不要宣称“小程序已验证”。
23. 浏览器高风险动作要先确认窗口归属。
   - 用户明确要求使用 Computer Use 时，优先尊重该工具选择，并尽量在 Codex-owned browser window 中操作。
   - 对提交表单、删除内容、发送消息、切换账号、退出登录、支付、关闭标签页等高风险动作，先确认窗口标题、目标页面和可见内容仍属于本任务。
24. 产品内文案默认面向普通用户，并先检查多语言结构。
   - 修改用户可见文案前，先检查是否已有 `i18n`、`locales`、`translations`、`Localizable` 或其他语言资源；若已有，用户可见文案要同步维护到所有已支持语言。
   - 文案优先说明用户能做什么、会发生什么、下一步怎么做；避免把 API、SDK、模型、数据库、缓存、错误码等实现细节直接暴露给用户。
   - commit 说明、handoff / 版本说明、review 摘要这类面向人阅读的变化说明，默认优先使用 `新增 / 修复 / 优化 / 调整 / 移除` 这类短标签，并从用户可感知变化出发组织一句话说明。
   - 如果项目启用了 `openprd release` 版本轨道，优先把这些变化条目累计到当前项目版本（例如 `0.1.23`）下；不要把它和内部 PRD `v0004` 这类版本号混成一个概念。
   - 如果仓库要把新版本正式发布到 GitHub，默认要先把同版本的用户可见变化累计到 `openprd release` 版本轨道，再要求匹配的版本 tag 和 GitHub Release 一起存在；只有 semver bump 或 tag push 不算完整发布。
   - GitHub Release 文案优先从当前项目的 `release-ledger` 渲染，不再手写第二份版本事实。

## 共用确认规则

- 当用户要求“看看、规划、梳理、分析、评估、explain、review”或列出影响文件时，保持只读。此时只基于证据回答，不运行 `openprd loop --run`、`openprd tasks --advance`、`openprd discovery --advance`、commit、push 或其他写入命令。
- 只有当当前用户消息明确要求开发、实现、修复、继续任务、深度调研、对标复刻或提交时，才执行 OpenPrd loop、task 或 discovery 推进。
- 单纯的“请帮我实现/继续实现”只表示有执行意图，不表示可以跳过 requirement 摘要确认、`capture/classify/synthesize` 写入路径或 review；只有用户明确表示“不需要进行任何确认”时，才允许静默走完整 requirement write path。
- 声称实现就绪前，要说明文档影响检查是新增、更新，还是有意保持 `docs/basic/`、文件说明书和文件夹 README 不变。
- 用户要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup、先看样子或先确认设计方向时，最终回复应给出 `imagegen` 生成的图片结果；只有实际发生 `imagegen` 调用后，才能汇报生图结果、失败或限流。Image 2 是工具路径，不是审美豁免；最终回复要能说明候选图是否满足用途、受众、气质和记忆点。生图结果先当候选效果图，并主动确认是否符合预期、是否纳入后续效果图/实现截图对比、以及是否按此继续实现。进入实现阶段后，已有确认参考图才给出 `openprd visual-compare --reference/--actual` 生成的 JPG 路径；如果参考图是一张整板、网格图或多对象组合，先运行 `openprd visual-prepare --reference <效果图> --grid <列>x<行>` 或 `--boxes <plan.json>` 并说明 contact sheet / compare-plan；没有参考图时先判断新建界面还是修改既有界面，新建界面先完成 3 方向方案评审，修改既有界面给出 `openprd visual-compare --before/--after` 生成的 JPG 路径；普通截图实测补 `openprd visual-compare --board <verification-board.json>`，同构列表、卡片、网格、表格或用户反馈没对齐时补 `openprd visual-compare --board <alignment-board.json>`，并说明相同槽位 spread 是否仍有偏差；最终同时说明是否仍有结构、气质、层级、颜色、字号、间距或记忆点差异。
- 大界面改动进入实现前，最终回复或阶段性回复应给出 3 方向横向候选效果图大图，并明确等待用户确认是否纳入后续对比和继续实现；只有确认后再进入实现。
- 在系统形态、产品流程或外部依赖仍有实质不确定性时，需求定稿前先向用户确认。
- 当用户还没看过最新的 synthesize 产物或图示产物时，handoff 前先确认。
- 当用户要求可视化说明，或当前解释明显包含复杂关系、路径、对比、边界或风险传播时，路由到 `$openprd-diagram-review`；优先判断是否适合轻量解释型 SVG，而不是默认进入正式评审图。

## 共用路由规则

- 需要判断需求该直接做、mini-plan 还是写 PRD：使用 `$openprd-requirement-intake`
- 需要推进主工作流生命周期：使用 `$openprd-harness`
- 需要前端审美框架、设计资产、主题/骨架/组件/任务 recipe、事实/素材/image-preflight/direction-plan：使用 `$openprd-frontend-design`
- 需要最佳实践、benchmark、对标、参考产品、prompt engineering、Agent harness、context engineering、图标资源、CLI 或 skill 体系设计：先使用 `$openprd-benchmark-router` 选择证据源，再按 DeepWiki、Context7 或官方资料规则调研
- 需要架构图、产品流程图、用户旅程、解释型 SVG 或可视确认循环：使用 `$openprd-diagram-review`
- 需要更细的语言规则或命令分类说明时，阅读：
  - `references/operating-rules.md`
  - `references/language-and-review.md`
  - `references/skill-architecture.md`
- 需要项目基线文档、文件说明书、文件夹 README 规则或 standards 校验：使用 `$openprd-standards`
- 需要日志、链路追踪、业务成本护栏、免费额度、滥用防护、冒烟覆盖、性能基线、压力场景、HTML 质量评估报告、当前场景 EVO 门禁或项目经验 Skill：使用 `$openprd-quality`
- 需要检查生成引导漂移、hooks 或用户级 Codex 配置：使用 `$openprd-harness`，并运行 `openprd doctor/update`
- 需要 Ralph 风格的 hook 驱动执行：使用 `$openprd-harness` 和 `openprd run`
- 需要按单任务拆分、每个任务一个全新 Codex 或 Claude 会话的长程实现：使用 `$openprd-harness` 和 `openprd loop`
