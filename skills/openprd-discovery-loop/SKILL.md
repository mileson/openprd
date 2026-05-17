---
name: openprd-discovery-loop
description: 把自然语言里的 OpenPrd 或 OpenSpec 深度、持续、全面、参考挖掘、需求发现类请求，路由到 OpenPrd 的长程 discovery 工作流。适用于继续推进、深度分析、全面补齐、对标复刻或完善 requirements、specs 和 tasks 的场景。
---

# OpenPrd Discovery Loop

## 概览

当用户要求 OpenPrd 持续推进、深度补全、完整覆盖或穷尽式梳理需求覆盖时，使用这份 skill。OpenSpec 仍然是支持的输出格式和兼容词汇，但 OpenPrd 才是负责路由、生成、校验和任务执行的主入口。

用户不需要知道 skill 名称或 CLI 参数。你要根据自然语言意图判断模式，再调用对应的 OpenPrd 内部命令。

## 自然语言触发词

当用户把 OpenPrd 或 OpenSpec 和这些意图词连在一起时，路由到这里：

- 持续、继续、一直推进、不断补全、长程
- 深度、深挖、深入梳理、深入分析
- 全面、完整、全量、穷尽、尽可能覆盖
- 大量扫描、只读扫描、跨模块证据收集、独立复核
- 补全、完善、生成规范、生成 OpenSpec、整理成任务
- 复刻、对标、参考这个项目、把这个项目逻辑转成规范

应该命中本 skill 的示例：

- “用 OpenPrd 深度补全这个项目。”
- “用 OpenSpec 深度补全这个项目。”
- “全面梳理现有项目，把规范和任务补齐。”
- “参考这个仓库，持续复刻它的产品逻辑到新项目。”
- “继续深挖这个需求，直到覆盖完整。”

不要要求用户显式说出 `Use $openprd-discovery-loop`。

## 模式

- `brownfield`：检查现有项目，并把发现到的行为补充进覆盖项
- `reference`：检查参考项目，并把产品逻辑翻译成当前项目的 requirements、specs 和 tasks
- `requirement`：持续追问和细化一个需求，直到它具备足够的范围、约束、流程、风险、验收标准和可执行任务

## 自动模式选择

替用户选模式：

- 当用户提供 GitHub 仓库、本地参考路径，或明确说复刻 / 对标 / 参考 / clone / parity 时，选 `reference`
- 当目标是现有本地项目，且用户要求深度补全 / 全面梳理 / 扫描 / 完善时，选 `brownfield`
- 当输入主要是想法、模糊请求、产品需求或功能概念，且没有单独参考项目时，选 `requirement`

如果意图混合：优先 `reference`；没有参考项目但有本地代码时优先 `brownfield`；两者都没有再用 `requirement`

## 大量只读扫描调度

当 OpenPrd discovery 需要大量只读扫描时，由主 agent 判断是否派发只读 subagent。日常任务仍由主 agent 先直接读取本地上下文；不要因为用户只说“看看、分析、梳理、定位、排查”就自动并行。

### 启动条件

- 用户明确要求深度分析、深入调研、全面梳理、多角度评估、交叉验证、并行排查、对标复刻或风险审查时，优先考虑只读 subagent。
- 任务需要同时阅读多个目录、文档、模块、日志、历史实现或参考项目，且并行收集证据能明显减少主上下文污染或节省时间时，可以启动。
- 任务涉及外部技术事实、公开仓库对标、复杂排障、发布风险或安全风险，且需要独立复核时，可以启动；仍必须遵守 Context7、DeepWiki、secrets-vault 和长文件门禁。
- 用户明确说“不用 subagent / 直接做 / 先别并行 / 只回答”时，不启动。
- 单文件小改、明确文案微调、简单命令、非常短的问题或清晰 bug 修复，默认不启动。

### 默认队形

- 一旦进入深度研究型 subagent 流程，默认使用 3 个只读 subagent：2 个独立调研执行者 + 1 个审查/交叉验证者。
- 最多启动 5 个 subagent：最多 4 个调研执行者 + 1 个审查者。只有任务天然拆成 4 个互不冲突的研究分支时才扩到 5 个。
- 每个 subagent 只回答一个清晰问题；不要让 subagent 再继续 spawn subagent。
- 主 agent 负责决策、整合和所有写入；subagent 只做快读、快扫、归纳、交叉验证，不直接修改文件、执行迁移、安装依赖、发布、提交表单、账号操作或删除文件。
- 主 agent 可以在 subagent 后台运行时继续做不冲突的本地工作；只有下一步确实依赖其结论时才等待。

### 角色选择

- 代码与文档调研：`spark-code-researcher`、`spark-doc-reader`、`documentation-explore`
- 对标复刻前置分析：`electron-parity-mapper`
- 安装、构建、发布或渠道排障：`release-diagnostics-researcher`、`channel-debug-researcher`
- 审查与风险扫描：`skill-workflow-reviewer`、`security-risk-researcher`

其余细分 agent 只在任务已经命中明确工作流时使用，例如离职交接和 Rollbar crash team。不要为一次性、小范围、单文件任务新增 agent 或强行并行。

### 证据合并

- 调研分支要拆分清楚范围，避免多个 subagent 研究同一批文件。
- subagent 输出必须回到主 agent 汇总；不能把 subagent 推断直接当成最终结论。
- 写入 discovery claim、requirements、specs 或 tasks 前，主 agent 必须把结论映射到证据路径、置信度和未解决问题。
- 审查者负责检查证据是否充分、是否遗漏关键风险、是否违反 Context7、DeepWiki、secrets-vault、长文件和写入门禁；审查者不替代主 agent 决策。

## 动手前

1. 读取第一份可用的 OpenPrd 共用规则：
   - `skills/openprd-shared/SKILL.md`
   - `$HOME/.claude/skills/openprd-shared/SKILL.md`
   - `$HOME/.codex/skills/openprd-shared/SKILL.md`
2. 除非用户只是在问原理，否则先运行或检查 `openprd status` 和 `openprd next`
3. 需要 hook-stable 执行时，运行：
   - `openprd run <path> --context`
   - 再执行推荐的 task、discovery 或 workflow 命令
   - `openprd run <path> --verify`
4. 如果 `.openprd/discovery/current.json` 不存在，用选定模式初始化：
   - `openprd discovery <path>`
   - `openprd discovery <path> --mode reference --reference <path>`
   - `openprd discovery <path> --mode requirement`
5. 如果已有运行状态，就继续：
   - `openprd discovery <path> --resume`
6. 每轮覆盖之后，用下面命令推进或校验：
   - `openprd discovery <path> --advance --item <id> --claim <text> --evidence <path>`
   - `openprd discovery <path> --advance --item <id> --status blocked --notes <text>`
   - `openprd discovery <path> --verify`
7. 当 PRD 需要变成具体 change 文件时，运行：
   - `openprd change <path> --generate --change <id>`
8. 只有在需要单独检查 change 结构时，才运行 `openprd change <path> --validate --change <id>`；通常 discovery verify 在配置了 `activeChange` 时会一并检查
9. 报告发现结果就绪前，运行 `openprd standards <path> --verify`
10. 阶段性实现或任务完成后，运行 `openprd quality <path> --verify`，让 HTML 质量评估报告审查日志、业务护栏、冒烟覆盖、功能覆盖、性能基线、极端数据和知识缺口
11. 修改文档或任务前，先从当前 run 目录重新读取状态

## 运行目录

每次 run 会写入：

- `control.json`：当前模式、迭代、预算、来源根目录和下一步动作
- `context.md`：下一轮要用的紧凑状态摘要
- `source-inventory.json`：索引后的项目或参考文件
- `coverage-matrix.json`：待处理、已覆盖和已阻塞的覆盖项
- `claims.jsonl`：带证据的需求 claim
- `open-questions.md`：需要保持可见的未决问题
- `iterations.jsonl`：每一轮推进的追加记录

hook harness 还会写入：

- `.openprd/harness/run-state.json`：当前循环摘要和上一条建议
- `.openprd/harness/iterations.jsonl`：hook turn 记录、门禁结果和 run 校验
- `.openprd/harness/learnings.md`：跨新会话保留的可复用经验

当前存储路径是 `.openprd/discovery`。历史 `.openspec/discovery` 状态仍可兼容读取，但新工作应写入 OpenPrd 自己的 discovery 状态。

## 工作循环

1. 从 `coverage-matrix.json` 选择下一个待处理项
2. 写入新 claim 前，先收集本地证据
3. 只用已确认或有证据支撑的材料更新文档或任务
4. 每条新事实都写入 `claims.jsonl`，附带来源和置信度
5. 把覆盖项标记为 covered、pending 或 blocked
6. 把本轮摘要追加到 `iterations.jsonl`
7. 只有当覆盖耗尽、被阻塞，或达到迭代预算时才停止

## 任务分片

大型 change 必须保持对 agent 易读、易恢复：

- `tasks.md` 始终是第一份也是标准任务入口
- 每个任务文件最多保留 25 个有实质内容的 checkbox 任务
- 项目可以在 `.openprd/discovery/config.json` 里通过 `taskSharding.maxItemsPerFile` 设更严格上限
- 如果任务更多，就继续写 `tasks-002.md`、`tasks-003.md` 等同级文件
- 每个非最终任务文件的最后一个 checkbox 都必须交接到下一个文件，例如：
  - `[ ] Continue with tasks-002.md after completing this file.`
- 尽量把相关章节放在一起，不要为了凑行数硬拆强耦合功能
- 稳定的长程任务只使用 `deps`、`done` 和 `verify` 元数据：
  - `[ ] T009.07 Port legacy database import preview`
  - `  - deps: T001.14, T007.06`
  - `  - done: preview shows counts, conflicts, skipped items, warnings`
  - `  - verify: npm run test -- migration`
- 没有依赖时省略 `deps`；来源证据保留在 discovery claims 和 coverage 文件中
- 报告 discovery 状态健康前，运行 `openprd discovery <path> --verify`。它会校验 discovery 状态、激活的 change 结构、spec delta、`docs/basic/` standards、任务分片和结构化任务依赖

## CLI 推进规则

- 在一个覆盖项调查完之后再用 `--advance`
- 用 `--claim` 记录发现到的 requirement、行为、规则或验收标准
- 当 claim 来自文件时，用 `--evidence`
- 当条目暂时无法解决时，用 `--status blocked --notes ...`
- 在报告 run 健康或进入评审前，用 `--verify`

## 任务执行

- 使用 `openprd tasks <path> --change <id>` 查看进度和下一个依赖已满足的任务
- 当某项任务已经可以通过自己的 `verify` 命令完成时，使用 `openprd tasks <path> --change <id> --advance --verify --item <task-id>`
- 使用 `openprd change <path> --apply --change <id>` 把完成的 change specs 推进到 `openprd/specs`
- 使用 `openprd change <path> --archive --change <id>` 把完成的 change 文件移动到 `openprd/archive/changes`
- 当任务或 discovery pass 改动了基线文档、文件说明书或文件夹 README 时，运行 `openprd standards <path> --verify`
- 在声明任务实现就绪前，运行 `openprd quality <path> --verify`；当某个已验证修复应该沉淀为项目级复用经验时，运行 `openprd quality <path> --learn --from <report>`
- 如果任务被依赖阻塞，先完成更早的任务 id；不要人工跳过依赖顺序
- 执行证据应保留在生成的任务事件或 discovery claims 中，不要给每个任务额外挂一堆元数据

## 证据规则

- 来自代码、测试、schema 或文档的 claim 应包含来源文件路径
- 由 agent 推断出来的 claim 必须显式标为 inferred，并保持可评审
- 用户确认过的答案应保留为 user-confirmed claim
- 不要把未解决问题悄悄改写成 requirements

## 安全默认值

- 优先做小而高置信的更新，不做大而猜测性的重写
- 证据薄弱时，让覆盖缺口保持可见
- 面对参考项目时，优先描述行为和验收标准，不要复制实现细节
- 当下一步需要用户判断时，把它写进 `open-questions.md`，并明确报告 blocker
- 项目基线文档路径只能是 `docs/basic/`
