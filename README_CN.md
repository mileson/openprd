# OpenPrd

English | [简体中文](./README_CN.md)

> 面向需求澄清、评审关卡、图形确认与交接的 AI 原生 PRD 工作区与 CLI。

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.19.0-339933.svg)](https://nodejs.org/)
[![GitHub stars](https://img.shields.io/github/stars/mileson/openprd?style=social)](https://github.com/mileson/openprd)

OpenPrd 是一个轻量但结构化的 **PRD harness**。它不只是“生成一份文档”，而是帮助团队和 Agent 完成：

- 需求澄清
- 用户确认
- 图形化评审
- 冻结前关卡控制
- 面向执行系统的结构化交接

![OpenPrd 图示示例](./docs/assets/openprd-diagram-demo.png)

## 适合什么场景

如果你希望：

- 在写 PRD 前先澄清需求
- 区分用户确认、项目已有事实和 Agent 推断
- 在 freeze 前插入架构图 / 流程图评审
- 让 Agent 遵循 repo 内置的协同规则

那么 OpenPrd 就很适合你。

## 核心能力

- **Clarification-first**：`clarify -> capture -> classify -> interview -> synthesize -> diagram -> freeze -> handoff`
- **场景感知协同**：区分空项目冷启动、已有项目首次接入、持续推进中的 workspace
- **来源感知采集**：支持 `user-confirmed` / `project-derived` / `agent-inferred`
- **图形评审工件**：支持 `architecture` 和 `product-flow`
- **Contract 驱动图渲染**：支持从 JSON contract 显式渲染
- **Review status**：支持 `pending-confirmation` / `confirmed` / `needs-revision`
- **Repo 内置 skills**：工具和 Agent 协同约束一起发布

## 一句话安装

```bash
npm install -g git+https://github.com/mileson/openprd.git
```

安装后验证：

```bash
openprd --help
```

## 快速开始

### 1. 初始化

```bash
openprd init /path/to/project --template-pack agent
```

### 2. 查看当前协同节奏

```bash
openprd status /path/to/project
openprd next /path/to/project
```

### 3. 先向用户澄清

```bash
openprd clarify /path/to/project
```

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

### 5. 生成草稿与图

```bash
openprd synthesize /path/to/project \
  --title "Moticlaw Mobile" \
  --owner "Moticlaw" \
  --problem "移动端用户缺少直连优先的节点选择与 Agent 会话入口。" \
  --why-now "控制面已经具备，当前缺少的是移动端入口。"

openprd diagram /path/to/project --type architecture --open
openprd diagram /path/to/project --type product-flow --open
```

### 6. Freeze 与 handoff

```bash
openprd freeze /path/to/project
openprd handoff /path/to/project --target openspec
```

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
- `skills/openprd-diagram-review/`

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
