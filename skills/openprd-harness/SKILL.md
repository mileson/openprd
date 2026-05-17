---
name: openprd-harness
description: 驱动 OpenPrd 工作区完成从澄清到 handoff 的主流程。适用于初始化 OpenPrd、查看 `.openprd/` 状态、选择下一条命令、推进 classify/interview/synthesize/freeze/handoff，或解释如何安全推进 OpenPrd 工作区。
---

# OpenPrd Harness

## 概览

这份 skill 负责主工作流编排。把它当成串起命令和产物的领域 skill；共用守则由 `$openprd-shared` 提供。

## 动手前

1. 读取第一个可用的共用规则文件：`skills/openprd-shared/SKILL.md`、`$HOME/.claude/skills/openprd-shared/SKILL.md` 或 `$HOME/.codex/skills/openprd-shared/SKILL.md`
2. 从 `.openprd/` 重建当前工作区状态
3. 如果用户期待自动化 agent 引导，运行 `openprd doctor <path>`，必要时用 `openprd setup <path>` 或 `openprd update <path>` 修复
4. 选择执行单元前，优先运行 `openprd run <path> --context`
5. 把 `openprd run <path> --context` 当作建议，不要自动执行其中的写入命令
6. 如果用户是在规划、分析、架构评审，或问“怎么改”“会动哪些文件”，保持只读并基于证据回答
7. 实现任务新增或修改文件时，做文档影响检查：缺失的 `docs/basic/`、文件说明书、文件夹 README 要补齐；受影响的已有文档要更新；涉及后端、脚本、Agent、工具链、服务或数据处理变更时，把 CLI 与 API 视为同级接入面，更新 `docs/basic/backend-structure.md` 中的命令入口、输出契约、`help`/`doctor`/`dry-run`/`status`、接口协议与不适用说明
8. 长时间实现任务使用 `openprd loop <path> --plan --change <id>`，并且只有当前用户消息明确要求开发、继续任务、深度调研、对标复刻或提交时，才为每个 loop 任务启动一个全新 agent 会话
9. 需要完整工作流细节时，使用 `openprd status` 和 `openprd next`
10. 用户要求最佳实践、benchmark、对标、参考产品、prompt engineering、Agent harness、context engineering、CLI 或 skill 体系设计时，先路由到 `$openprd-benchmark-router`
11. 用户要求基线文档、文件说明书、文件夹 README 标准或实现就绪检查时，路由到 `$openprd-standards`
12. 用户要求日志、链路追踪、业务成本护栏、免费额度、滥用防护、评估执行环境、冒烟覆盖、性能基线、极端场景、HTML 质量评估报告或项目级经验 Skill 时，路由到 `$openprd-quality`
13. 用户需要可视化说明，或系统/产品形态仍不清晰时，在 freeze 前路由到 `$openprd-diagram-review`
14. 默认保持 Codex hooks 轻量。除非项目明确需要完整工具级遥测，否则 `openprd setup/update` 使用 `--hook-profile lite`
15. 当 `doctor` 报告生成引导漂移时，读取 `.openprd/harness/drift-report.json`

## 主工作流

### 1. 初始化或定位工作区

- 如果 `.openprd/` 不存在，使用：
  - `openprd init <path> --template-pack <base|consumer|b2b|agent>`
- `init` 会同时创建 standards 和 agent integration，包括 Codex、Claude、Cursor 的生成引导、项目级 Codex hooks 和用户级 Codex hooks feature flag
- `init` 也会创建质量状态，包括 `.openprd/quality/config.json`、`.openprd/quality/reports/` 和 `.openprd/knowledge/`
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
  - 默认 lite Codex hooks 会为明确的 OpenPrd、PRD、深度调研、对标复刻、standards、fleet、文档标准化提示词，以及新产品、模块、流程需求注入上下文；轻量 `PreToolUse` 写入门禁会在需求入口未确认前阻断过早实现
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
  - `openprd loop <path> --finish` 前，先完成文档影响检查并更新缺失或过期的 `docs/basic/`、文件说明书和文件夹 README；涉及后端、脚本、Agent、工具链、服务或数据处理变更时，同步评估 CLI 与 API 两个接入面
  - 声称任务就绪前，运行 `openprd quality <path> --verify` 并审阅生成的 HTML 质量评估报告，检查日志、业务护栏、冒烟覆盖、任务完整性、性能基线、极端场景和知识缺口
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
- 当关键产品事实缺失时，直接把返回的问题问给用户
- 当需求模糊、起点只有一句想法，或需要先做方案探索时，把生成的 `clarify.html` 当成人机协作主界面
- 优先分阶段确认：问题、用户、范围、成功标准和开放问题；如果 artifact 能更清楚地展示，就不要把问题墙一样一次性砸给用户
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
- 在 freeze 前，当用户需要对问题定义、范围、主流程、风险或开放问题做反馈时，把生成的 `review.html` 当作首选确认界面

### 6. 需要时生成可视化评审产物

- 当用户需要以下内容时，路由到 `$openprd-diagram-review`：
  - 架构确认
  - 流程 / 旅程确认
  - freeze 前的可视化评审

### 7. 只在草稿准备好时 freeze

- 使用：
  - `openprd freeze <path>`
- Freeze 是门禁，不只是另一次渲染
- 声称实现就绪前，先校验 standards：
  - `openprd standards <path> --verify`
  - 这不只是缺文件检查；对已变更文件，还要判断现有文档是否过期，并在必要时更新
- 声称实现就绪前，再校验质量：
  - `openprd quality <path> --verify`
  - 把 `.openprd/quality/reports/<id>.html` 当作面向人的评审产物，用于查看可观测性、业务成本与滥用护栏、评估执行环境、性能、压力数据和项目知识
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
- 当方案形态仍不清晰时，优先先 review 再 freeze
- 遇到 blocker 时，优先把阻塞条件显式暴露出来，而不是悄悄补脑

## 禁止行为

- 不要发明不存在的命令
- 不要因为 CLI 技术上允许，就在用户还没确认方案结构时直接 freeze
- 当图示评审或草稿评审明显仍有必要时，不要 handoff 一个用户尚未审阅的工作区
- 项目基线文档路径只能是 `docs/basic/`
- 当 `openprd setup`、生成规则和 hooks 已经可以引导 agent 时，不要反过来要求用户记住具体 skill 名

## 需要时阅读这些参考资料

- `references/command-map.md`：命令到意图的映射
- `references/workflow-gates.md`：门禁判断和就绪规则
- `references/examples.md`：具体使用模式
- `references/usage-guide.md`：面向团队和 agent 的使用指南，覆盖 clarify、diagram、freeze、status/next 和批量 capture
