# OpenPrd 复盘学习包 Agent 写作提示

学习包: lr-20260513-171625-空-reader-复核
主题: 空 reader 复核
触发方式: manual
来源范围: workspace

## 你的任务

请你亲自完成复盘学习正文。CLI 只准备了证据、约束、路径和 HTML 阅读器外壳。

所有读者可见的标题、副标题、目录项、章节标题、段落、检索练习、工作示例和下一步都由你负责撰写。

## 输入

- Agent 上下文: /Users/chaojifeng/Projects/harness-engineer/openprd/.openprd/learning/archive/lr-20260513-171625-reader/agent-context.json
- 证据清单: /Users/chaojifeng/Projects/harness-engineer/openprd/.openprd/learning/archive/lr-20260513-171625-reader/evidence-manifest.json
- 输出内容 JSON: /Users/chaojifeng/Projects/harness-engineer/openprd/.openprd/learning/archive/lr-20260513-171625-reader/learning-content.json
- 阅读器 HTML: /Users/chaojifeng/Projects/harness-engineer/openprd/.openprd/learning/archive/lr-20260513-171625-reader/reader.html

## 证据来源

- current-state: 当前状态 (state/current.json)
- task-graph: 任务图 (state/task-graph.json)
- version-index: 版本索引 (state/version-index.json)
- active-prd: 当前 PRD (engagements/active/prd.md)
- active-flows: 流程文档 (engagements/active/flows.md)
- active-roles: 角色文档 (engagements/active/roles.md)
- active-handoff: 交接文档 (engagements/active/handoff.md)
- decision-log: 决策记录 (engagements/active/decision-log.md)
- open-questions: 开放问题 (engagements/active/open-questions.md)
- progress: 进度记录 (engagements/active/progress.md)
- verification: 验证记录 (engagements/active/verification.md)
- docs-basic-file-structure: docs/basic/file-structure.md (../docs/basic/file-structure.md)
- docs-basic-app-flow: docs/basic/app-flow.md (../docs/basic/app-flow.md)
- docs-basic-backend-structure: docs/basic/backend-structure.md (../docs/basic/backend-structure.md)
- docs-basic-frontend-guidelines: docs/basic/frontend-guidelines.md (../docs/basic/frontend-guidelines.md)
- docs-basic-prd: docs/basic/prd.md (../docs/basic/prd.md)
- docs-basic-tech-stack: docs/basic/tech-stack.md (../docs/basic/tech-stack.md)

## 输出规则

- 不要让 CLI 生成标题、大纲或正文；这些字段必须由 Agent 根据证据写出。
- 每章 evidenceIds 只能引用 evidence-manifest.json 中存在的 source id。
- 正文中的任务事实必须能回到 evidence-manifest 的 source、claim 或 excerpt。
- 可以写推断，但要在表达上说明它来自多个证据的综合判断。

## 必需 JSON 结构

```json
{
  "schema": "openprd.learning-content.v1",
  "agentOwnedFields": [
    "title",
    "subtitle",
    "learningGoals",
    "overviewParagraphs",
    "outline",
    "chapters",
    "nextActions"
  ],
  "chapterShape": {
    "required": [
      "id",
      "label",
      "semanticTitle",
      "summary",
      "paragraphs",
      "evidenceIds"
    ],
    "optional": [
      "retrievalBlocks",
      "workedExamples"
    ],
    "retrievalBlockShape": [
      "prompt",
      "hint",
      "answer"
    ],
    "workedExampleShape": [
      "title",
      "scenario",
      "steps",
      "principle"
    ]
  },
  "rules": [
    "不要让 CLI 生成标题、大纲或正文；这些字段必须由 Agent 根据证据写出。",
    "每章 evidenceIds 只能引用 evidence-manifest.json 中存在的 source id。",
    "正文中的任务事实必须能回到 evidence-manifest 的 source、claim 或 excerpt。",
    "可以写推断，但要在表达上说明它来自多个证据的综合判断。"
  ]
}
```

写入 `learning-content.json` 后，使用下面命令重新渲染:

```sh
openprd learn . --content-json /Users/chaojifeng/Projects/harness-engineer/openprd/.openprd/learning/archive/lr-20260513-171625-reader/learning-content.json --open
```
