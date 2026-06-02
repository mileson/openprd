# OpenPrd

简体中文 | [English](./README_EN.md)

> 面向需求澄清、HTML 优先评审、图形确认与交接的 AI 原生 PRD 工作区与 CLI。

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.19.0-339933.svg)](https://nodejs.org/)
[![GitHub stars](https://img.shields.io/github/stars/mileson/openprd?style=social)](https://github.com/mileson/openprd)

OpenPrd 是一个轻量但结构化的 **PRD harness**。它不只是“生成一份文档”，而是帮助团队和 Agent 完成：

- 需求澄清
- 用户确认
- 图形化评审
- 冻结前关卡控制
- 面向执行系统的结构化交接

它把关键确认点沉淀成稳定的 HTML 产物，而不是把版本状态散落在聊天记录或终端输出里。

![OpenPrd 能力总览](https://raw.githubusercontent.com/mileson/openprd/main/docs/assets/openprd-capability-overview-zh.png)

## 适合什么场景

如果你希望：

- 在写 PRD 前先澄清需求
- 区分用户确认、项目已有事实和 Agent 推断
- 在 freeze 前插入架构图 / 流程图评审
- 让 Agent 遵循 repo 内置的协同规则

那么 OpenPrd 就很适合你。

## OpenPrd 和 OpenSpec / Superpowers 有什么不一样

OpenPrd 解决的问题，不只是“把 spec 写出来”，也不只是“把代码跑起来”，而是让
人和 Agent 在需求、评审、执行、交付这些关键节点上始终对齐。

| 工具 | 重心 | 用户主要看到的产物 | 更适合什么 |
|------|------|--------------------|------------|
| **OpenPrd** | 需求澄清、HTML 优先协作、交付门禁 | `review.html`、学习阅读器、质量报告、图示、结构化 change/task 状态 | 需要把人机协同、评审确认、执行推进和交付判断串起来的团队 |
| **OpenSpec** | spec / change 生命周期 | Markdown proposal、spec、design、tasks | 更关注 spec 增量治理和变更编排的团队 |
| **Superpowers** | skill 驱动的编码执行流 | skills、plans、worktree / subagent 流程、代码评审检查点 | 更关注 AI Agent 如何规划、编码、review、收尾的工程团队 |

OpenPrd 最有特色的地方，在于它把“这次到底在做什么、谁来确认、凭什么继续往下走”
做成稳定可见的协作面，而不是只留在 spec 文件或 prompt 流程里。

## 典型真实场景

最近 30 天的 Codex 项目记录里，OpenPrd 反复出现在几类连续工作里：模糊需求澄清、
已有产品流程改造、发布与交付、线上问题闭环，以及把一次完成的工作整理成可复用学习资料。

| 场景 | 为什么这里更像 OpenPrd 的强项 | 主要产物 |
|------|--------------------------------|----------|
| 模糊产品需求，先别急着写代码 | 先澄清，再区分用户确认事实与 Agent 推断，最后把结果沉淀成稳定评审页。 | `clarify`、`capture`、`synthesize`、`review.html` |
| 已有流程或登录入口改造 | 先从仓库与运行态重建当前事实，再决定下一步 change，而不是直接拍脑袋改。 | `discovery`、`diagram`、`review.html`、`change` |
| 流程图、界面或架构确认 | 把理解差异放到图示和可评审产物里，而不是埋在聊天记录里。 | `diagram`、`visual-compare`、左右对比 JPG |
| 长程 Agent 执行链路 | 把确认后的工作拆成按依赖可执行的小任务，每次新会话只推进一个任务并带验证门禁。 | `tasks`、`loop`、任务提示词、进度日志、验证报告 |
| 发布、开源、交接前收口 | 让“现在能不能交付”变成有证据的显式判断，而不是靠感觉。 | `quality`、`run --verify`、`doctor`、`handoff` |
| 一次需求或修复做完后沉淀学习资料 | 把最终需求、过程判断和结果整理成新成员可以直接学习的资料。 | 学习阅读器、`.openprd/knowledge/skills/`、docs 同步 |

## HTML 优先协作产物

OpenPrd 会生成可以直接分享的 HTML 面板，让产品、研发和 Agent
围绕同一份稳定 artifact 协作，而不是各自回放聊天记录或命令输出。

### `review.html`

把当前需求版本整理成可评审页面，适合先给产品、研发或负责人确认“这次到底在做什么”。

![OpenPrd review HTML](https://raw.githubusercontent.com/mileson/openprd/main/docs/assets/openprd-review-html.png)

### 学习阅读器

把一次需求、修复或协作方法整理成图文学习资料，方便新成员理解“这套流程为什么这样设计”。

![OpenPrd learning HTML](https://raw.githubusercontent.com/mileson/openprd/main/docs/assets/openprd-learning-html.png)

### 质量回归报告

把准备就绪状态、必需门禁、验证材料和仍需人工判断的点放到一个可读页面里，再决定是否继续交付或发布。

![OpenPrd quality HTML](https://raw.githubusercontent.com/mileson/openprd/main/docs/assets/openprd-quality-html.png)

### 效果图与截图拼图对比，自动优化

把效果图和实现截图放进同一张左右对比图里，适合登录入口改造、条款页本地化、弹窗复刻这类阶段性评审。

![效果图与截图拼图对比，自动优化](https://raw.githubusercontent.com/mileson/openprd/main/docs/assets/openprd-visual-compare-case-study-zh.png)

## 自我成长机制

OpenPrd 会沿着两条看得见的循环，越用越贴合你们的协作方式。一条循环把真实项目里反复验证过的做法沉淀成可复用的 `项目级 Skill`；另一条循环把不同场景下更合适的协作设置沉淀成 `动态参数配置`，让下次启动时直接带上更合适的默认做法。

![OpenPrd 自我成长机制](https://raw.githubusercontent.com/mileson/openprd/main/docs/assets/openprd-self-evolving-mechanisms-zh.png)

### 场景一：项目级 Skill

当团队在真实工作里反复确认同一种判断，OpenPrd 不会让它继续散落在聊天记录里，而是把它留在项目身边。

- 例子：一次登录入口改造里，团队确认“登录、注册、找回密码都走官网”。
- 下次能直接复用什么：相关页面要一起检查、发布前要核对哪些入口和文案、类似需求应该沿着什么路径推进。
- 为什么有用：下一次类似需求不会再从零开始，新成员接手也能直接照着做。

### 场景二：动态参数配置

不是每个项目都该用同一套起手方式。OpenPrd 会把不同场景下更合适的协作设置留住，并在下次自动带回来。

- 例子：一个新项目会先澄清目标和范围，一个接手中的旧项目会先还原现状和改动边界。
- 下次会自动带上什么：先问什么、先看什么、交付前先收什么材料。
- 为什么有用：团队不用每次重新解释“这类项目该怎么开场”，而是直接从更合适的默认方式开始。

## 功能

- **Clarification-first**：`clarify -> capture -> classify -> interview -> synthesize -> diagram -> freeze -> handoff`
- **场景感知协同**：区分空项目冷启动、已有项目首次接入、持续推进中的 workspace
- **自我成长机制**：把真实项目里确认过的做法沉淀成可复用的 `项目级 Skill`，并按场景沉淀 `动态参数配置`
- **来源感知采集**：支持 `user-confirmed` / `project-derived` / `agent-inferred` / `agent-normalized`
- **图形评审工件**：支持 `architecture` 和 `product-flow`
- **界面视觉对比工件**：把效果图与实现截图合成左右对比 JPG，用于阶段性复刻评审
- **Contract 驱动图渲染**：支持从 JSON contract 显式渲染
- **Review status**：支持 `pending-confirmation` / `confirmed` / `needs-revision`
- **用户视角变化摘要**：`loop commit`、`handoff` / 版本说明、`review` 摘要默认优先使用 `新增 / 修复 / 优化 / 调整 / 移除` 这类短标签
- **策略化评审门禁**：PRD review 记录和执行意图分离；不能把“可以开做”当成任意评审稿的 `review --mark confirmed`
- **OpenPrd 发现模式**：为已有项目、参考项目或不清晰需求初始化可持续推进的覆盖状态
- **项目标准化**：初始化并验证 `docs/basic/`、文件说明书模板和文件夹 README 模板
- **OpenPrd change 与任务执行**：从 PRD 快照生成 change 文件，校验结构，沉淀 accepted specs，归档变更，并按依赖顺序推进结构化任务
- **长程 Agent Loop**：把 change 任务转成“一次新会话只做一个任务”的 Codex / Claude 执行提示词，并沉淀验证、进度日志和可选任务 commit
- **默认 Agent 接入**：从一套 OpenPrd 源生成 Codex、Claude、Cursor 三端规则，并默认开启 Codex hooks
- **Repo 内置 skills**：工具和 Agent 协同约束一起发布

## 一句话安装

```bash
npm install -g @openprd/cli
```

安装后验证：

```bash
openprd --help
```

之后更新 CLI 时先预演，再执行：

```bash
openprd self-update --dry-run
openprd self-update
```

## 快速开始

### 1. 初始化

```bash
openprd init /path/to/project --template-pack agent
```

`init` 会创建 `.openprd/`、`docs/basic/`、`AGENTS.md`，并生成 Codex / Claude / Cursor 三端引导。Codex 项目会同时写入 `.codex/config.toml`、`.codex/hooks.json`、`.codex/hooks/openprd-hook.mjs`，并开启用户级 Codex `codex_hooks = true`。

Codex hooks 默认使用 `lite` 模式：安装 `UserPromptSubmit`、轻量
`PreToolUse` 写入门禁，以及轻量 `Stop` 收工回顾。明确提到 OpenPrd、PRD、深度调研、深度对标、复刻、
standards、fleet、文档标准化，或看起来像新产品 / 模块 / 流程需求的提示词都会
注入上下文；`lite` 写入门禁只匹配直接编辑工具，让只读 shell 探查保持安静；`Stop`
会在本轮结束前回顾是否值得沉淀项目经验。
需要连 shell 命令也进入写入门禁时使用 `guarded`，只有临时深度诊断才使用
`full`。
如果用户给出报错、日志、复现、根因排查等明确故障证据，并要求直接修复，
hook 会按小型 bugfix 处理，不开启需求入口；“确认修复”这类确认词也会关闭
已打开的需求入口。

### 2. 查看当前协同节奏

```bash
openprd status /path/to/project
openprd next /path/to/project
```

### 3. 先向用户澄清

```bash
openprd clarify /path/to/project
```

澄清阶段只在对话里输出提纲或简短清单；正式 HTML 评审统一留给合成后的 `review.html`。

### 4. 写回答案

单条写回：

```bash
openprd capture /path/to/project \
  --field problem.problemStatement \
  --value "移动端缺少高效的 Agent 会话与节点管理入口" \
  --source user-confirmed
```

批量写回：

```bash
openprd capture /path/to/project --json-file answers.json
```

`--source agent-normalized` 只用于 `capture` 之后的纯内部措辞整理，
这类没有语义变化的润色不应重开当前 `review.html` 的确认。

### 5. 生成草稿与图

```bash
openprd synthesize /path/to/project \
  --title "Moticlaw Mobile" \
  --owner "Moticlaw" \
  --problem "移动端用户缺少直连优先的节点选择与 Agent 会话入口。" \
  --why-now "控制面已经具备，当前缺少的是移动端入口。"

openprd review-presentation /path/to/project --template
openprd review-presentation /path/to/project \
  --presentation review-presentation.json \
  --write \
  --fail-on-violation

openprd diagram /path/to/project --type architecture --open
openprd diagram /path/to/project --type product-flow --open
openprd review /path/to/project --open
openprd review /path/to/project --mark confirmed --version <id> --digest <sha256> --work-unit <id>
```

`review.html` 是当前 PRD 的稳定评审稿，但默认 approval policy 是
`decision-points`，不是“每次都必须停在这里”。常规 lane 下，用户先看稳定
artifact，再用页面复制出来的精确 `--version`、`--digest`、`--work-unit`
记录确认；`silent-record` lane 只有在用户一开始已经明确要求直接做、并显式
表示不需要额外评审或确认时，才允许直接记录当前这份精确 artifact。不要把
实现授权当成给任意评审稿补确认，也不要把评审记录当成实现授权。当前 artifact
记录完成后，再生成 OpenPrd change 和任务拆解；如果用户原始意图已明确要求
实现，tasks 就绪后即可直接执行，否则等待一句明确的执行指令：

```bash
openprd change /path/to/project --generate --change <change-id>
openprd tasks /path/to/project --change <change-id>
```

### 6. Freeze 与 handoff

```bash
openprd freeze /path/to/project
openprd handoff /path/to/project --target openprd
```

`handoff` 导出的 `handoff.json` 和 `handoff.md` 会同时带上用户视角的变化摘要 / 版本说明片段，默认按 `新增 / 修复 / 优化 / 调整 / 移除` 组织，方便直接扫读或复用。

### 7. 启动 OpenPrd 发现模式

用户可以直接用自然语言说：

```text
用 OpenPrd 深度补全这个项目。
用 OpenPrd 全面复刻这个参考项目的产品逻辑。
继续深挖这个需求，直到 OpenPrd 覆盖完整。
```

Discovery 和 loop 执行需要明确的深度或执行意图。用户只是说“看看、规划、
梳理、分析、预计动哪些文件、怎么改”时，Agent 应只读检查状态和代码后回答，
不得推进 coverage，也不得启动 loop 任务。

Agent 会在内部完成路由。底层命令是：

```bash
openprd discovery /path/to/project --mode brownfield
openprd discovery /path/to/project --resume
openprd discovery /path/to/project --advance --claim "用户可以从工作台发起会话" --evidence src/app.ts
openprd discovery /path/to/project --verify
openprd change /path/to/project --generate --change <change-id>
openprd change /path/to/project --validate --change <change-id>
openprd standards /path/to/project --verify
openprd tasks /path/to/project --change <change-id>
openprd tasks /path/to/project --change <change-id> --advance --verify --item T001.01
openprd change /path/to/project --apply --change <change-id>
openprd change /path/to/project --archive --change <change-id>
openprd specs /path/to/project
openprd changes /path/to/project
```

持续发现的校验也会检查当前 OpenPrd change 结构、spec delta、`docs/basic/`
标准化文档和长程任务文件。保留 `tasks.md` 作为第一个入口，每个任务文件最多放
25 个实质 checkbox 任务；超过后继续使用 `tasks-002.md`、`tasks-003.md`。
每个非最终任务文件的最后一个 checkbox 应指向下一个任务文件，方便 Agent 按顺序
继续。项目也可以通过 `.openprd/discovery/config.json` 的
`taskSharding.maxItemsPerFile` 使用更细的本地限制。

这里的 25 只是分片上限，不是拆解目标。任务标题应优先描述可直接落地的实现单元、
接线边界、页面入口、集成闭环和回归项，而不是把“主流程 / 功能需求 / 验收目标 /
非功能需求”这些 PRD 小节逐条平移成 checkbox。

如果任务需要稳定编号来支撑长程执行，只保留最小元数据：

```md
- [ ] T009.07 Port legacy database import preview
  - type: implementation
  - deps: T001.14, T007.06
  - done: preview shows counts, conflicts, skipped items, warnings
  - verify: npm run test -- migration
  - test-layer: unit, integration
  - test-size: medium
  - test-scope: cli-contract
  - evidence-plan: 单元测试覆盖导入解析，命令行契约输出留下证据
```

`type` 用来区分 `implementation`、`verification`、`documentation` 和
`governance`。`deps` 只在依赖前置任务时填写；`done` 写完成条件；`verify`
写验证命令或审查步骤。生成的 `implementation` 和 `verification` 任务默认使用
`openprd tasks . --change <id> --item <task-id> --evidence-required`：Agent 先运行本任务最小足够测试或审查，再通过
`--evidence <路径或摘要>` 传入证据，或在任务 metadata 写入 `evidence:` /
`waiver-reason:`；文档任务仍使用 standards 校验。`openprd run . --verify`
保留给阶段或最终门禁，不作为每个任务的默认验证；也不能只用
`openprd change . --validate` 代替真实落地证据。旧版生成任务如果仍写着
`verify: openprd run . --verify`，通过 `openprd tasks --verify` 执行时也会
按本任务 evidence 门处理，不会继续反复生成 workspace quality 报告。

任务也可以包含测试策略元数据。`test-layer`、`test-size`、`test-scope`
和 `evidence-plan` 用来帮助 OpenPrd 按风险选择最小足够证据：局部逻辑优先单元测试，
触达 CLI/API/Agent 契约或跨模块状态时使用集成/契约验证，触达用户主路径、视觉、小程序、
性能、安全或成本风险时升级到端到端或专项验证。这些字段是证据分流，不是固定 70/20/10
比例门禁。

`tasks` 默认列出下一个依赖已满足的任务。`--advance` 会勾选完成任务；
同时传 `--verify` 时，会先运行该任务的 `verify` 命令，通过后再勾选。执行记录
写在任务文件外，避免把 `tasks.md` 元数据变复杂。

## 项目标准化

`openprd init` 会创建项目标准化契约：

- `docs/basic/file-structure.md`
- `docs/basic/app-flow.md`
- `docs/basic/prd.md`
- `docs/basic/frontend-guidelines.md`
- `docs/basic/backend-structure.md`
- `docs/basic/tech-stack.md`
- `.openprd/standards/file-manual-template.md`
- `.openprd/standards/folder-readme-template.md`

当项目已经存在源码文件时，`openprd standards --verify` 不只检查文件是否存在，还会阻断以下情况：

- `docs/basic/` 仍停留在“待补充”等模板占位内容。
- 源码文件头部缺少文件说明书。
- 承载源码的文件夹缺少 `[项目名]_[文件夹名]_README.md` 文件夹说明书。

检查命令：

```bash
openprd standards /path/to/project --verify
```

OpenPrd 生成的 change 会包含标准化维护任务，change 校验也会检查这套契约。
项目基础文档的唯一标准路径是 `docs/basic/`。

实现阶段的标准化维护是明确的影响判定，不是最后顺手清理。每次新增或修改源码
文件时，Agent 都要检查 `docs/basic/`、文件说明书、所在文件夹 README 是否缺失
或已因本次变更过期。缺失的必须补齐；已有文档如果受到职责、流程、结构、依赖
或产品行为变化影响，也必须同步更新。如果无需更新，应说明已经完成影响判定以及
为什么现有文档仍然准确。

## 效果图与截图拼图对比，自动优化

当界面任务已经有效果图、设计稿、用户给图或 Agent 自己生成的 mock 时，Agent
在阶段性完成后应先截实现图，再生成左右对比图，不能只靠主观印象判断是否一致：

```bash
openprd visual-compare /path/to/project \
  --reference effect-image.png \
  --actual implementation-screenshot.jpg
```

默认会在 `.openprd/harness/visual-reviews/` 下输出体积较小的 JPG。左侧标注
`效果图`，右侧标注 `实现截图`。输入可以是 `sharp` 支持的常见图片格式。

如果界面任务没有明确效果图，Agent 应先截修改前截图，完成改动后用同一入口、
视口、账号和数据状态再截修改后截图：

```bash
openprd visual-compare /path/to/project \
  --before before-screenshot.png \
  --after after-screenshot.jpg
```

修改前后模式会把左侧标注为 `修改前`、右侧标注为 `修改后`，帮助 Agent 检查
预期变化是否出现，以及未改区域是否有布局、颜色、密度或状态漂移。输出也可以按需要调整：

```bash
openprd visual-compare /path/to/project \
  --reference effect-image.png \
  --actual implementation-screenshot.jpg \
  --out review.webp \
  --format webp \
  --quality 82 \
  --max-panel-width 1180
```

Agent 必须查看生成图并继续对标，直到没有明显视觉差异。最终回复里应给出本次
生成的对比图路径，并说明对比后是否仍有差异。

## 回归测试与质量评估报告

`openprd init` 同时会创建质量契约：

- `.openprd/quality/config.json`
- `.openprd/quality/reports/`
- `.openprd/knowledge/`

检查命令：

```bash
openprd quality /path/to/project --verify
```

该命令会在 `.openprd/quality/reports/` 下同时写入 JSON 和 HTML。HTML 回归测试报告
是阶段性质量查看的主要产物，优先展示整体回归结果、逐需求模块结果、测试块通过情况、
分层测试策略矩阵、未通过项和需要确认是否属于本期的遗漏。EVO 是 OpenPrd 内部对
“质量评估/验证层”的简称；用户可见报告不要求理解这个缩写。脚本、依赖或 fixture
存在只代表项目具备能力，不能替代本次运行证据。

当需求涉及免费用户、额度、AI 调用、第三方 API、生成、存储、下载或其他消耗型成本时，
`quality --verify` 会额外检查是否存在成本来源、用户级限制、负向验证、用量/成本监控、
报警阈值和止损动作，避免免费额度或高成本路径在上线后才暴露。

`openprd quality --verify` 默认会在本期必测块未 production-ready 时返回失败；
`openprd run --verify` 会再次执行这个质量门禁。Agent 不得在本期必测块缺证据或需关注时宣称就绪。
如果界面任务已有参考图，视觉就绪还需要 `.openprd/harness/visual-reviews/`
下存在本次 `openprd visual-compare --reference/--actual` 产物；如果没有参考图但改动界面，
还需要存在 `openprd visual-compare --before/--after` 修改前后产物。对比图仍有明显差异或漂移时，应回到实现继续调整。

当一个问题已经修复并完成验证后，可以把抽象模式沉淀为项目级经验：

```bash
openprd quality /path/to/project --learn --review --from .openprd/harness/turn-state.json
openprd quality /path/to/project --learn --from <report-id-or-json>
openprd quality /path/to/project --learn --from ./diagnostics/incident-2026-05-24
```

`--learn --review` 会先在 `.openprd/knowledge/candidates/` 生成待确认
knowledge candidate，并在 `.openprd/knowledge/drafts/` 生成 draft skill。
确认值得长期保留后，再用 `--learn --from` promote 为 `.openprd/knowledge/`
下的 incident、pattern 和经验 Skill，让后续任务能提前触发同类经验，而不是重新排查一遍。`--from`
现在既可以接质量报告 JSON，也可以直接接已经导出的诊断目录 / 证据文件；
只要里面已经有 `diagnostic-report`、`runtime-events`、`timeline`、
`root-cause-candidates` 这些结构化诊断产物，就能直接沉淀成可复用的排查 Skill。

## Agent 自动接入

OpenPrd 会把协同规则装进项目，让用户不需要记住具体 skill、命令或 hook：

```bash
openprd setup /path/to/project
openprd doctor /path/to/project
openprd self-update --dry-run
openprd self-update
openprd update /path/to/project
openprd update /path/to/project --hook-profile lite
openprd upgrade /path/to/project --dry-run
openprd upgrade /path/to/project
openprd upgrade /path/to/projects --fleet --dry-run
openprd fleet /path/to/projects --dry-run
openprd fleet /path/to/projects --sync-registry
openprd run /path/to/project --context
openprd run /path/to/project --verify
openprd loop /path/to/project --plan --change <change-id>
openprd loop /path/to/project --run --agent codex --dry-run
```

仅安装 CLI 不会直接改写项目或用户配置。用户在项目里运行 `openprd init` 或
`openprd setup` 时，才会安装完整的 Codex / Claude / Cursor 适配配置。

`setup` 与 `init` 会生成：

- `AGENTS.md` 中的 OpenPrd 管理规则
- `.codex/skills/`、`.codex/prompts/`、`.codex/config.toml`、`.codex/hooks.json` 和 `.codex/hooks/openprd-hook.mjs`
- 用户级 Codex config 的 `features.codex_hooks = true`
- `.claude/skills/`、`.claude/commands/openprd/` 和 `CLAUDE.md`
- `.cursor/rules/openprd.mdc` 和 `.cursor/commands/`
- `.openprd/harness/install-manifest.json`、`hook-state.json`、`events.jsonl`、`drift-report.json` 和 `visual-reviews/`

`doctor` 会检查三端引导、Codex hooks 开关、项目标准化和 OpenPrd 工作区验证是否健康。`update` 会从 OpenPrd 的统一源刷新这些生成文件，并保留用户自己已有的 hook 分组。

`self-update` 只更新 OpenPrd CLI 自身，默认使用公开 npm 包。
`upgrade` 会编排两层更新：先执行 `self-update`，再重新解析安装后的
`openprd` 可执行文件，然后执行 `update <project>`；加 `--fleet` 时会执行
`fleet <root> --update-openprd`，只刷新已有 `.openprd/` 的历史项目。两个入口都支持
`--dry-run`，预演时只打印安装和刷新命令，不修改 CLI、项目、registry 或 harness 状态。

这套 harness 是有状态的，但 hook 重量由 profile 控制。默认 `lite` 保留轻量
PreToolUse 写入门禁，并把匹配范围限制在直接编辑工具上，同时在 `Stop` 做一轮轻量项目经验回顾，避免只读 shell 噪声和完整工具级遥测；`guarded` 会额外覆盖 shell 工具，`full` 只建议用于临时深度诊断。`freeze`、`handoff`、accepted spec apply/archive、commit、push、release、publish 等高风险动作会先经过 `openprd run . --verify`，覆盖标准化、工作区校验、激活 change 校验和激活 discovery 校验。

`openprd run . --context` 是类似 Ralph 的循环控制面。它会从激活 change 任务、discovery coverage 或普通 OpenPrd 工作流状态里选择下一项可执行单元，并把 hook turn 记录到 `.openprd/harness/iterations.jsonl`。

### 长程 Agent Loop

如果进入真正的开发落地阶段，建议使用 `openprd loop`。它比 `run --context`
更严格：先生成稳定的 feature list，再为每个任务写出单独提示词，启动一个新的
Codex 或 Claude 会话只处理这一个任务。每个任务完成后必须先自测，失败就修复并
重新自测；前端界面任务在 Codex 客户端优先用 Computer Use，在 Codex CLI 和
Claude Code 中优先用 Playwright、MCP 浏览器自动化或项目已有 e2e 工具。验证
通过后，`loop --finish` 会写入阶段性测试报告，并可为该任务生成独立 commit。
界面任务完成前必须运行 `openprd visual-compare`：已有参考图时截实现图并走
`--reference/--actual`，没有参考图但改动界面时先留修改前截图、完成后留修改后截图并走
`--before/--after`，查看左右对比 JPG 后才能完成任务。

`openprd run --context` 可能展示 loop 相关执行命令，但它不是自动执行指令。
只有当用户当前明确要求开发、实现、继续任务、深度调研、深度对标、复刻落地或
提交时，Agent 才能运行 `openprd loop --run`、`openprd tasks --advance`、
`openprd discovery --advance` 或 commit 命令。规划和审查类对话应止步于模块 /
文件清单和证据说明。

Loop 建议按实质实现任务数触发，而不是按所有 checkbox 触发。当一个 change 的
`implementation` 任务总数或待处理数达到 10 个时，`run --context` 会建议使用
独立 worktree 或等价隔离环境，并通过单任务 Loop 会话推进。

```bash
openprd loop . --init
openprd loop . --plan --change <change-id>
openprd loop . --next
openprd loop . --prompt --agent codex
openprd loop . --run --agent codex --dry-run
openprd loop . --run --agent claude --dry-run
openprd loop . --verify --item T001.01
openprd loop . --finish --item T001.01 --commit --message "Complete T001.01"
```

Loop 状态会沉淀在 `.openprd/harness/`：

- `feature-list.json`：按依赖排序的执行任务列表
- `feature-list.json`：每个任务都会带一个人类可读的 `taskHandle`，例如
  `change-id:T001.01:task-title`，方便跨对话继续同一任务，而不是只靠聊天 UUID
- `progress.md`：给人看的进度记录
- `agent-sessions.jsonl`：每次 prompt / run / finish 的结构化事件，也会记录任务句柄和任务标题
- `bootstrap.sh`：每个新会话启动时执行的检查脚本
- `loop-state.json`：当前任务 id、任务句柄、任务标题，以及最近一次 Agent 会话状态
- `loop-prompts/`：生成过的单任务提示词，便于审计和复用
- `test-reports/`：每个任务的阶段性测试报告，会和任务改动一起提交

建议先用 `--dry-run`，让 OpenPrd 生成提示词和准确执行命令，但不直接启动 Agent。
`--agent codex` / `--agent claude` 会使用默认 CLI 集成；只有需要接入团队自定义
包装器时，才使用 `--agent-command "<custom command>"`。

OpenPrd 面向用户的时间统一使用上海时区的 `YYYY-MM-DD HH:mm:ss` 格式，不输出
`T`、`Z` 或毫秒后缀。除命令、字段名、文件路径、API 名称、品牌名和产品名等必要
专有术语外，生成文档、进度日志、proposal、prompt、测试报告，以及 Agent 产出的
`spec.md` 与 tasks 默认使用简体中文。结构字段优先使用“新增需求”“需求”“场景”
“当”“则”等中文表达，同时继续兼容历史 OpenSpec 英文结构字段。

历史项目不要手写 shell 循环批量改。使用 `fleet` 先扫描报告；它现在会顺带提示全局 registry 里已经登记了多少 OpenPrd 工作区、当前 root 外还有多少已知项目。`--sync-registry` 用来把当前 root 下已初始化的 `.openprd/` 工作区回填到 `~/.openprd/registry/workspaces.jsonl`。`--update-openprd` 只刷新已经有 `.openprd/` 的项目，项目自身 standards 或 validate 缺口会作为“项目健康需关注”报告，但不阻断生成引导更新；只有 agent 配置或普通项目默认保持不变，除非显式用 `--setup-missing` 接管。

## 怎么看 `status` / `next`

### `openprd status`

重点看：

- `Scenario`
- `User participation mode`
- `Current gate`
- `Upcoming gate`

### `openprd next`

重点看：

- `Next action`
- `Current gate`
- `Upcoming gate`
- `Suggested command`
- `Suggested questions`

## 图 Contract

OpenPrd 支持：

- `architecture`
- `product-flow`

也支持从显式 contract 渲染：

```bash
openprd diagram /path/to/project \
  --type product-flow \
  --input ./product-flow-contract.json
```

## Agent Skills

仓库内自带：

- `skills/openprd-shared/`
- `skills/openprd-harness/`
- `skills/openprd-standards/`
- `skills/openprd-diagram-review/`
- `skills/openprd-discovery-loop/`

配合顶层 `AGENTS.md` 使用，可以让 Agent 更稳定地按照 OpenPrd 的协同方式工作。

## 贡献与安全

- 贡献说明：见 [CONTRIBUTING.md](./CONTRIBUTING.md)
- 安全披露：见 [SECURITY.md](./SECURITY.md)

## 许可证

MIT — 见 [LICENSE](./LICENSE)

## 作者

- X: [Mileson07](https://x.com/Mileson07)
- 小红书: [超级峰](https://xhslink.com/m/4LnJ9aB1f97)
- 抖音: [超级峰](https://v.douyin.com/rH645q7trd8/)
