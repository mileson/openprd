---
schema: openprd.learning-content.v1
version: 1
packageId: lr-20260512-164427-openprd-复盘学习模式
title: 《OpenPrd 复盘学习模式》复盘学习书
topic: OpenPrd 复盘学习模式
genreId: xianxia
genreLabel: 仙侠修真
trigger: manual
sourceScope: all
evidenceManifestPath: /Users/chaojifeng/Projects/harness-engineer/openprd/.openprd/learning/archive/lr-20260512-164427-openprd/evidence-manifest.json
---

# 《OpenPrd 复盘学习模式》复盘学习书

> 仙侠修真 · 用户主动提出 · sourceScope=all

## 你会学到什么

- 把任务事实、证据和叙述拆开再合起来。
- 知道如何从 `.openprd/` 里把 long task 的完成状态重新读出来。
- 理解 genre reference library、content contract 和 reader 之间的分工。
- 能够用 retrieval block 和 worked example 复习并迁移到下一轮任务。

## 读法

- 先看目录，再看章节标题。
- 章节内先读叙述，再做检索练习，最后看 worked example。
- 所有重要判断都可以回到 evidence manifest。

## 证据包结构

```text
.openprd/learning/archive/lr-20260512-164427-openprd-复盘学习模式/
  learning-package.json
  learning-content.json
  learning-content.md
  evidence-manifest.json
  reader.html
```

## 筑基 · 从任务完成回到工作区事实

先把发生了什么、为什么结束、有哪些可验证结果说清楚。

这一章先把《OpenPrd 复盘学习模式》的任务完成事实固定下来。长程任务结束时，真正值得保留的不是“我感觉做完了”，而是“哪个任务、哪个验证、哪份报告、哪个路径都能再找到”。

如果这次是自动生成，触发源来自 loop finish；如果这是用户主动提出，触发源来自明确的复盘请求。两种情形最终都会落回同一条原则：先留证据，再写故事。

### 检索练习

1. 如果只看一个位置，你会先从哪里确认当前工作区真的结束了？
   - 提示: 想想 current state、task graph、验证记录之间的关系。
   - 参考答案: 优先看 `.openprd/state/current.json` 和 `.openprd/state/task-graph.json`，再去对照最近一次验证记录或 loop 报告。
1. 这份学习书为什么不直接把所有内容写成普通 Markdown？
   - 提示: 考虑可复用、可归档、可再渲染。
   - 参考答案: 因为内容合同与 evidence manifest 需要独立维护，HTML reader 只是一个可视化输出层，后续可以换皮但不破坏语义。

### 工作示例（Worked Example）

- Worked Example: 从 loop finish 进入学习归档
  - 场景: 一个长程任务刚刚完成，验证也通过了。
  - 步骤:
    - 先收集 task、change、verify 和 test report 的证据。
    - 把这些证据写成 manifest，而不是直接塞进叙述正文。
    - 生成 learning-content.json 和 learning-content.md。
    - 把 reader.html 归档到 `.openprd/learning/archive/<packageId>/`。
  - 原则: 先结构化，再叙述；先证据，后表达。

### 证据引用

- current-state
- task-graph
- verification

## 观想 · 从 `.openprd/` 读懂系统结构

把 workspace、docs/basic、loop、artifact、skills 这几层关系摊平。

OpenPrd 的学习材料不是单独发明一套结构，而是把原有的 `.openprd/`、`docs/basic/`、`skills/` 和长程任务产物串成一条可以阅读的路径。

因此这个章节最重要的，不是“写得像不像书”，而是让用户在读完后能重新指出：哪些文件属于核心事实、哪些属于过程记录、哪些属于视觉化输出、哪些属于可延展的技能层。

### 检索练习

1. 哪些文件更像事实源，哪些文件更像过程源？
   - 提示: 区分 state / docs / report / skill 四类东西。
   - 参考答案: 事实源通常是 current state、version snapshot、docs/basic 基线文档；过程源通常是 decision log、progress、verification、loop report。

### 工作示例（Worked Example）

- Worked Example: 把一个新 learning 包定位到目录里
  - 场景: 未来维护者第一次打开 `.openprd/learning/archive/`。
  - 步骤:
    - 先看 current.json，确认最近一次学习包是什么。
    - 再看 archive 目录中的 packageId，定位 reader.html。
    - 最后对照 learning-content.json 和 evidence-manifest.json 回看来源。
  - 原则: 目录结构要先能被人找到，再谈内容深度。

### 证据引用

- current-state
- version-index
- docs-basic-file-structure
- docs-basic-app-flow
- docs-basic-backend-structure

## 破境 · 把来源和推断分开

所有正文都要能回到 manifest，推断部分必须显式标记。

真正长期可维护的学习内容，不是“描述得很美”，而是“每一句都知道从哪来”。这就是 evidence manifest 的意义：把来源、摘要、置信度、推断关系拆开。

在这个模型里，正文可以有风格，但不能有失真。凡是从多个来源综合出来的结论，都应该像科研笔记一样带着 sourceIds，让后面的读者可以一键回溯。

### 检索练习

1. manifest 里最应该避免的是什么？
   - 提示: 想一想“看起来像事实，但其实没来源”的句子。
   - 参考答案: 最应该避免的是没有 sourceIds、没有路径、没有置信度，却被写成确定事实的句子。

### 工作示例（Worked Example）

- Worked Example: 把一条推断句写对
  - 场景: 你想表达“这个项目现在适合进入学习归档”。
  - 步骤:
    - 先写来源：current state、task graph、verification、loop report。
    - 再写推断：这些来源组合起来说明任务已经到了可沉淀阶段。
    - 最后把推断标成 inference，并保留 sourceIds。
  - 原则: 推断不是不能写，而是不能装成未验证的事实。

### 证据引用

- current-state
- task-graph
- verification
- docs-basic-prd

## 传功 · 把内容合同写成可复用模板

genre reference library 负责外壳，content contract 负责结构，renderer 负责输出。

genre reference library 负责决定这本书用什么语气说话：是严肃科研、仙侠修真、童话故事，还是网文小说。content contract 负责约束这本书必须有哪些字段：标题、主题、章节、检索练习、worked example、证据源。

这两个层次不能混在一起。题材风格可以扩展，合同结构必须稳定。这样后续如果要新增 genre，只需要加参考库和少量映射，不需要重写整套渲染逻辑。

### 检索练习

1. 新增一个 genre 时，最少要补哪三样东西？
   - 提示: 想想 reference、contract、renderer 的分工。
   - 参考答案: 至少要补 genre reference、对应的内容合同参数，必要时再补渲染器中对标题和章节结构的映射。

### 工作示例（Worked Example）

- Worked Example: 新增一个题材风格
  - 场景: 你想增加“行业访谈”风格。
  - 步骤:
    - 先在 genre reference library 里新增条目，定义 voice、chapterLabels 和 opening / closing。
    - 再保证 content contract 仍然输出同样的 schema 字段。
    - 最后只改 renderer 的标签映射，而不是改内容数据结构。
  - 原则: 题材可以长，合同不能散。

### 证据引用

- docs-basic-frontend-guidelines
- docs-basic-tech-stack

## 归元 · 检索练习与工作示例

让读者在阅读后能回忆、重做、迁移，而不是只看完。

真正让学习内容变成“书”的，不是长，而是可反复检索。retrieval block 负责让读者先回忆再对照，worked example 则负责把抽象原则压成可抄的步骤。

这也是为什么这套格式会适合 agentic 编程：Agent 可以生成内容，用户可以复习内容，后续任务也可以直接复用相同的输出合同。

### 检索练习

1. 如果用户只允许你记住一个目录，你会优先记哪一个？
   - 提示: 想想哪个目录保存的是“可再阅读的结果”。
   - 参考答案: 优先记 `.openprd/learning/archive/`，因为那里保存的是可读、可回溯、可复用的学习包。
1. 如果要把这套模式移植到另一个项目，应该先迁移什么？
   - 提示: 先迁移结构，再迁移语气。
   - 参考答案: 先迁移 content contract 和 evidence manifest 的结构，再迁移 genre reference library，最后补渲染器和自动触发规则。

### 工作示例（Worked Example）

- Worked Example: 复盘后再发起下一轮任务
  - 场景: 一个项目的学习包已经生成，用户准备开始下一轮改动。
  - 步骤:
    - 先从 reader.html 里回顾上一轮的证据和结论。
    - 在 retrieval block 中确认自己是否真的理解了关键路径。
    - 再把下一轮任务写进新的 change 或 loop 任务。
  - 原则: 学习不是终点，而是下一轮执行的入口。

### 证据引用

- decision-log
- progress
- docs-basic-app-flow

## 证据清单

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

## 下一步

- 用 reader.html 按目录复习这份书。
- 如果题材变化，就继续扩展 genre reference library，而不是重写合同。
- 如果证据不足，就先补 manifest，再改正文。
