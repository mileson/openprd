# 项目文件结构

## 项目定位

OpenPrd 是一个 Node.js CLI 项目，入口命令通过 `bin/openprd.js` 调用 `src/openprd.js` 的 `main` 函数。`src/openprd.js` 保留 CLI 分发、初始化、freeze、handoff 和公开导出，工作区核心能力与横向流程拆入独立模块，避免入口文件继续承担所有实现细节。

## 核心目录

- `bin/`: CLI 可执行入口。
- `src/`: OpenPrd CLI 源码。
- `src/cli/`: 命令行参数解析和终端输出渲染。
- `src/codex-hook-runner-template.mjs`: 生成到项目 `.codex/hooks/openprd-hook.mjs` 的自包含 Codex hook runner 模板，承接运行态门禁逻辑源码，并把“生成图片/封面图/配图/海报/插画/图标/贴纸/头像/banner/主视觉/KV/运营图/效果图/视觉稿/mockup”识别为 Image 2 优先的图片内容请求，而不是实现写入需求。
- `src/dev-standards.js`: 研发期 touched code files 标准层，当前提供代码文件行数状态和下一步动作建议。
- `src/growth.js`: 自我成长标准层，记录、审查、应用或拒绝执行中发现的配置、规则和 user-local 偏好候选。
- `src/openspec/`: OpenPrd change、spec、task 的结构化文件操作。
- `src/diagram-workspace.js`: diagram 命令的 artifact 生成、评审状态和浏览器打开逻辑。
- `src/discovery.js`: discovery 运行、覆盖矩阵、claims 和验证逻辑。
- `src/fleet.js`: 历史项目扫描和批量 setup/update/doctor/work-unit backfill 编排。
- `src/fs-utils.js`: 共享文件、JSON、YAML、JSONL 读写工具。
- `src/html-artifacts.js`: HTML 协作 artifact 和复盘学习 reader 的渲染骨架；学习 reader 在这里承接章节级图文比喻卡、可选图片槽位和证据锚点，质量报告 HTML 通过独立渲染器接入，避免继续扩大通用 artifact 文件。
- `src/quality-html-artifact.js`: `openprd quality --verify` 的 HTML 回归测试报告框架层，负责回归结论概览、工具生成的回归流程图和测试覆盖图、四个固定信息模块、底部双按钮操作栏和折叠明细。
- `src/visual-compare.js`: `openprd visual-compare` 的图片合成工具，负责读取两张输入图片、缩放面板、按模式添加“效果图 / 实现截图”或“修改前 / 修改后”标签，并输出 JPG / PNG / WebP 视觉评审图。
- `src/learning-review.js`: 复盘学习包的证据收集、Agent 写作工具包、内容合同校验、图文解释字段校验和 reader 归档。
- `src/quality.js`: 质量契约、质量场景与证据检测、日志/追踪检测、业务成本与滥用护栏检测、评估执行环境检测、HTML 回归测试报告和项目经验 Skill 沉淀。
- `src/run-harness.js`: `openprd run` 的 hook-stable context、verify 和 hook 事件记录。
- `src/loop.js`: 长任务拆分、单任务 prompt、session 记录、任务 verify / finish，以及可跨对话引用的 `taskHandle` 生成。
- `src/source-inventory.js`: discovery 使用的源码盘点和忽略规则。
- `src/work-unit.js`: 工具无关的需求工作单元 ID、目标根目录、版本评审 artifact 和确认状态绑定。
- `src/work-unit-migration.js`: 历史 PRD 版本的 work unit 身份回填、稳定评审页刷新和绑定写入。
- `src/workspace-core.js`: workspace 骨架、迁移、校验、版本索引、事件日志和共享文档渲染。
- `src/workspace-workflow.js`: classify、interview、clarify、capture、synthesize、review、diff、history、next、status guidance。
- `docs/basic/`: 项目级基础说明。
- `scripts/openprd-dev-check.mjs`: Agent 可直接执行的研发期行数检查脚本，等价调用 `openprd dev-check`。
- `.openprd/engagements/active/intake-reflection.md`: 复杂或模糊需求在进入澄清问题前的需求入口自省记录。
- `.openprd/engagements/work-units/`: 工具无关的需求工作单元绑定，每个文件记录 work unit id、目标根目录、版本、摘要指纹和稳定评审 artifact，避免多 Agent 或多对话共用 `active` 时串到其他需求。
- `.openprd/quality/`: 质量基线配置和回归测试报告归档。
- `.openprd/growth/`: 执行中发现的配置缺口、规则候选和本地偏好队列；共享规则经用户确认后才固化。
- `.openprd/knowledge/`: incident、abstract pattern 和项目级经验 Skill 归档。
- `.openprd/harness/feature-list.json`: loop 任务清单；每个任务包含 `taskHandle`、标题、依赖、verify 命令、可选 `oracle` 对照基准和状态。
- `.openprd/harness/failed-approaches.md`: loop 死路账本，记录 reference/oracle 偏差、失败尝试及其原因，避免跨会话重复踩坑。
- `.openprd/harness/agent-sessions.jsonl`: loop prompt / run / finish 的结构化事件日志，包含 `taskHandle` 与任务标题，便于跨会话续接。
- `.openprd/harness/loop-state.json`: 当前 loop 任务 id、任务句柄、任务标题和最近一次 Agent 会话状态。
- `.openprd/harness/visual-reviews/`: 界面视觉对比图归档，默认存放 `openprd visual-compare` 输出的“效果图 / 实现截图”或“修改前 / 修改后”JPG。
- `skills/`: OpenPrd 自带 agent skills。
- `test/`: Node test runner 测试用例。

## 文件组织规则

- 新增或修改文件时，应同步判断 `docs/basic/`、文件说明书、所在文件夹说明书是否缺失或过期；缺失的要补齐，受本次变更影响的已有说明要更新。
- 跨模块移动文件时，应更新本文件中的目录结构和职责说明。
- CLI 表层逻辑优先放入 `src/cli/`，不要回填到 `src/openprd.js`。
- 研发期标准规则优先放入 `src/dev-standards.js`，CLI 与脚本入口只负责调用和输出。
- 自我成长候选的记录、review/apply/reject 和安全配置写入放入 `src/growth.js`；`dev-check` 只负责发现候选并给出下一步建议。
- 共享 IO 工具优先放入 `src/fs-utils.js`，业务模块只保留自己的领域判断。
- discovery、fleet、run harness 这类可独立验证的流程应保持在各自模块内，通过依赖注入接入工作区核心能力。
- quality 相关扫描、业务护栏、报告写入和经验沉淀逻辑归入 `src/quality.js`；质量报告的用户可见 HTML 框架归入 `src/quality-html-artifact.js`，`src/html-artifacts.js` 只保留转发出口。
- 工作区核心状态工具归入 `src/workspace-core.js`；面向用户的工作流命令归入 `src/workspace-workflow.js`。

## 维护规则

- 每次新增、删除、移动目录或核心文件后，必须检查并更新本文件。
- 本文档只记录项目结构事实，不承载具体功能需求细节。
