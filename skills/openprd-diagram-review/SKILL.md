---
name: openprd-diagram-review
description: 生成并迭代 OpenPrd 图示产物，供用户确认。适用于架构图、产品流程图、用户旅程、流程图、系统边界图、依赖图，以及 freeze 前的可视化评审场景。
---

# OpenPrd Diagram Review

## 概览

这份 skill 用来判断当前需要哪种图、生成可渲染的 diagram contract、调用 OpenPrd 当前支持的渲染能力，并把结果变成和用户往返确认的评审循环，而不是一次性出图。

## 动手前

1. 读取 `skills/openprd-shared/SKILL.md`
2. 重建当前工作区状态，判断用户究竟想确认什么
3. 决定用户需要的是：
   - `architecture` 视图
   - `product-flow` 视图
4. 不要虚构今天还不存在的 OpenPrd diagram 命令

## 图示类型选择

当用户在问这些内容时，选 `architecture`：

- 模块
- 系统边界
- 服务
- 外部依赖
- 可靠性 / 合规性问题
- handoff 形态

当用户在问这些内容时，选 `product-flow`：

- 用户步骤
- 决策点
- 正常路径 / 错误路径
- onboarding 或旅程流程
- 页面到页面、步骤到步骤的推进

如果两者都出现：

- 当用户行为和流程仍不清楚时，先做 `product-flow` contract
- 流程清楚后，再做架构评审

## 当前工具能力

当前 OpenPrd CLI 提供：

- `openprd diagram <path> [--open] [--json]`

现在它主要渲染面向架构的 HTML / JSON 产物。

因此：

- 对 `architecture`，直接调用内置命令
- 对 `product-flow`，即使还没有专门渲染器，也先生成结构化 contract 和评审清单
- 如果工具还没有专用流程渲染器，就不要假装它已经存在

## 语言规则

- 所有用户可见标签和评审说明都跟随用户当前主语言
- Diagram contract 是用户可见产物。当 `locale` 为 `zh-CN` 时，以下可见字段必须写成简体中文：
  - `title`、`subtitle`
  - `components[].name`、`components[].subtitle`、`components[].details`
  - `flows[].label`
  - `summaryCards[].title`、`summaryCards[].items`
  - `sidePanels[].title`、`sidePanels[].items`
  - `reviewInstructions`
- 专有名词、产品名、协议名、API 名称、框架名和云服务名在翻译会降低清晰度时保持原样
- 像 MotiClaw、Electron、TypeScript、CLI、API、JSON、NDJSON、dry-run、Host API、schema、`waiting_approval` 这类必要术语可以保留，但周围句子必须译成简体中文
- 不要在 zh-CN diagram contract 里写完整英文句子。运行 `openprd diagram --input` 前，至少人工检查一遍并把英文偏重的可见文本改成简体中文
- 如果对话语言混合，优先跟随最近几轮需求澄清中占主导的语言

## 评审循环

生成图示产物后：

1. 展示或打开图示产物
2. 请用户确认：
   - 是否缺了组件或步骤
   - 系统边界或泳道是否画错
   - 是否遗漏依赖或路径
   - 是否缺少错误路径或签核点
3. 把未解决项继续保留为假设或开放问题
4. 只有在可视化评审收敛后，才建议 freeze

## 需要时阅读这些参考资料

- `references/diagram-contracts.md`：架构图和产品流程图 contract
- `references/review-checklist.md`：渲染后应该问用户什么
- `references/cocoon-patterns.md`：从 `Cocoon-AI/architecture-diagram-generator` 借来的可复用模式
