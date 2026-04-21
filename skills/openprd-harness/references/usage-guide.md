# OpenPrd 使用指南

这份指南是给 **团队成员** 和 **Agent** 的 OpenPrd 实战使用说明。重点不是命令表，而是：

- 什么时候先 `clarify`
- 什么时候先 `diagram`
- 什么时候可以直接 `freeze`
- `status` / `next` 该怎么看
- `batch capture` 怎么用

## 一、先判断你处于哪种场景

OpenPrd 现在会区分 3 种场景：

### 1. Cold start (greenfield)

特点：

- 项目目录基本是空的
- `.openprd/` 刚初始化
- 没有现成产品上下文可复用

协同方式：

- 高协同
- 先问用户
- 不要自己先写完整 PRD

优先动作：

- `openprd clarify`
- 根据用户回答 `openprd capture`

### 2. Cold start (existing project)

特点：

- 项目已有 README / docs / 代码 / 现成能力
- `.openprd/` 是第一次接入

协同方式：

- 先复用现有上下文
- 但关键产品事实必须让用户确认

优先动作：

- `openprd status`
- `openprd clarify`
- 用 `openprd capture --source project-derived` 导入已有事实
- 用 `openprd capture --source user-confirmed` 写回用户确认

### 3. Continuing workspace

特点：

- 已有 `.openprd/` 历史
- 已经 synthesize / freeze / handoff 过

协同方式：

- 只做增量澄清
- 不重跑全量初始化

优先动作：

- `openprd status`
- `openprd next`
- 只补变化部分

---

## 二、什么场景先 `clarify`

优先 `clarify` 的情况：

- 项目刚初始化
- 关键产品字段缺失
- 用户的目标、范围、成功标准还不清楚
- 虽然 repo 有内容，但你还不能判断“这次 OpenPrd 到底定义什么”
- 你手上只有技术上下文，没有用户确认

### 典型信号

如果 `openprd next` 或 `openprd status` 显示：

- `Current gate: clarify-user`

那么不要继续往 `synthesize`、`diagram`、`freeze` 推进。

### 推荐操作

```bash
openprd clarify <path>
```

然后把用户回答写回：

```bash
openprd capture <path> --field problem.problemStatement --value "..."
openprd capture <path> --field goals.successMetrics --value "..."
```

---

## 三、什么场景先 `diagram`

优先 `diagram` 的情况：

- 需求的**系统边界**需要确认
- 依赖、模块、数据/控制流复杂
- 用户流程、决策点、失败路径复杂
- freeze 前需要一个 visual artifact 来做协同确认

### 什么时候画 architecture

适用于：

- 模块边界
- 服务依赖
- control plane / data plane 分工
- 权限、审核、可靠性边界

```bash
openprd diagram <path> --type architecture
```

### 什么时候画 product-flow

适用于：

- onboarding
- 用户操作步骤
- decision / error path
- human + agent 协作流程

```bash
openprd diagram <path> --type product-flow
```

### 什么时候用 `--input`

如果 Agent 已经基于 Skill 生成了结构化 diagram contract：

```bash
openprd diagram <path> --type product-flow --input flow-contract.json
```

这比依赖工具自己推断更稳，也更适合多 Agent 协作。

---

## 四、什么场景可以直接 `freeze`

只有在下面几件事都满足时，才建议 `freeze`：

1. 关键产品字段已经补齐
2. 用户确认问题已经基本收敛
3. 如果 diagram gate 生效，对应 diagram 已确认
4. `openprd next` 不再提示 `clarify-user`
5. `openprd next` 不再提示 `diagram`

### 典型信号

如果 `openprd next` 显示：

- `Current gate: freeze review`

并且 `Suggested command: openprd freeze .`

这时才适合 freeze。

---

## 五、`status` / `next` 应该怎么看

### `openprd status`

适合回答：

- 我现在处于什么场景？
- 用户应该参与到什么程度？
- 当前卡在哪一关？
- 接下来最可能是哪一关？

重点看这 4 个字段：

- `Scenario`
- `User participation mode`
- `Current gate`
- `Upcoming gate`

例如：

- `Scenario: Cold start (existing project)`
- `User participation mode: context-plus-confirmation`
- `Current gate: clarify-user`
- `Upcoming gate: freeze review`

这说明：

- 项目里已有上下文可以用
- 但当前仍然要先和用户确认
- 还没到可以 freeze 的阶段

### `openprd next`

适合回答：

- 下一步最应该做什么？
- 为什么是这一步？
- 建议直接执行什么命令？
- 当前应该问用户哪些问题？

重点看：

- `Next action`
- `Current gate`
- `Upcoming gate`
- `Suggested command`
- `Suggested questions`

---

## 六、batch capture 怎么用

### 适用场景

Agent 一轮把用户问完之后，最好不要一条条写：

```bash
openprd capture ... --field ...
openprd capture ... --field ...
openprd capture ... --field ...
```

而是用批量模式。

### 命令

```bash
openprd capture <path> --json-file answers.json
```

### 推荐 JSON 格式

```json
{
  "problem.problemStatement": {
    "value": "移动端缺少高效的 Agent 会话与节点管理入口",
    "source": "user-confirmed"
  },
  "users.primaryUsers": {
    "value": ["运维人员", "Agent 重度用户"],
    "source": "user-confirmed"
  },
  "constraints.dependencies": {
    "value": ["Auth API", "Node service"],
    "source": "project-derived"
  }
}
```

### source 的意义

- `user-confirmed`：用户亲口确认
- `project-derived`：从项目已有材料提取
- `agent-inferred`：Agent 的推断

最佳实践：

- 产品关键字段优先写成 `user-confirmed`
- 技术现状、已有系统能力可以写成 `project-derived`
- 谨慎使用 `agent-inferred`

---

## 七、推荐的最小工作节奏

### 对新项目

```bash
openprd init <path> --template-pack agent
openprd status <path>
openprd clarify <path>
openprd capture <path> --json-file answers.json
openprd next <path>
```

### 对已有项目首次接入 OpenPrd

```bash
openprd init <path> --template-pack agent
openprd status <path>
openprd clarify <path>
openprd capture <path> --json-file derived-and-confirmed.json
openprd classify <path> agent
openprd next <path>
```

### 对继续推进中的 workspace

```bash
openprd status <path>
openprd next <path>
openprd clarify <path>
openprd capture <path> --json-file delta-answers.json
```

---

## 八、团队协作建议

### 给人类看什么

- `openprd status`
- `openprd next`
- 当前 diagram artifact
- open questions

### 给 Agent 什么输入

- repo / docs / README
- `.openprd/` 当前状态
- diagram contract
- 批量 capture 的 answers.json

### 不要做什么

- 不要把 `project-derived` 当成 `user-confirmed`
- 不要在 `Current gate: clarify-user` 时急着 `synthesize`
- 不要在 diagram gate 还没过时直接 `freeze`
