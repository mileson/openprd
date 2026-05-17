---
name: openprd-learning-review
description: 生成并维护 OpenPrd 复盘学习包、题材参考库、证据清单、检索/工作示例模块，以及 HTML 电子书阅读器。
---

# OpenPrd Learning Review

## 何时使用

当用户希望把 OpenPrd 工作区、已完成的 loop 任务，或某个项目领域整理成复盘学习包时，使用这份 skill。典型触发包括：

- 长任务结束，或某个已验证 loop 任务刚完成
- 用户明确要求复盘某个项目领域或能力面
- 需要构建或刷新题材模板、证据清单、检索模块或工作示例
- 需要生成归档在 `.openprd/` 内的 HTML 电子书阅读器
- 需要把已验证修复或质量复盘连接到可复用的项目经验；此时让 Skill 产物继续经过 `$openprd-quality`，把抽象模式沉淀到 `.openprd/knowledge/skills/`

## 核心契约

- 严格分离五层：证据清单、无风格学习内容契约、风格提示词包、带风格学习内容、HTML 阅读器。
- 默认模式由配置开启；即使自动模式关闭，手动生成也必须可用。
- 学习包统一归档到 `.openprd/learning/archive/<packageId>/`。
- 项目级预防 Skill 单独放在 `.openprd/knowledge/skills/`，不要把复发预防规则只埋在学习电子书里。
- 每一条结论都必须能追溯到 source id、路径、摘录和 digest。
- 除专门的 Markdown 阅读稿外，不要把叙事正文和 provenance 元数据混在同一个文件里。

## 工作流程

1. 从 `.openprd/state/current.json`、`.openprd/state/task-graph.json`、当前 PRD 产物、`docs/basic` 和最近的 loop 报告重建上下文。
2. 选择主题、题材和可选子风格。默认使用 `internet-product`；对 `xianxia` 默认使用 `cultivation` 提示词包。
3. 先构建 `evidence-manifest.json`。凡是无法追溯的句子，都标成推断。
4. 先生成中性的 `learning-content.json`，再加载风格提示词包并运行 Agent-in-the-loop 风格迁移。
5. 在内容契约里记录提示词包 id、提示词文本、风格迁移报告和质量检查结果。
6. 把 `reader.html` 渲染为固定电子书界面：有书式目录、章节分页、正文独立滚动、进度、上一章/下一章、字体控制和章节级 source 锚点。不要把单个检索题放进目录。
7. 把 `learning-package.json`、`learning-content.json`、`learning-content.md`、`evidence-manifest.json` 和 `reader.html` 一起写入归档目录。
8. 更新 `.openprd/learning/index.json` 和 `.openprd/learning/current.json`，让后续任务能快速找到最新学习包。
9. 当配置允许自动打开时，在学习包创建后自动打开阅读器。
10. 如果学习包记录的是已验证修复、重复问题、隐藏调试路径或 Agent 误判，运行或建议运行 `openprd quality <path> --learn --from <eval-report>`，把抽象模式沉淀成未来可触发的项目 Skill。

## 章节结构

每个学习包都尽量覆盖这些模块：

- 解释学习包为何存在的叙事开场
- 点名相关 `.openprd/` 文件和工作流状态的系统地图章节
- 区分事实、claim 和推断的 provenance 章节
- 让读者回忆关键机制的检索模块
- 展示如何迁移到新场景的工作示例模块
- 告诉读者下一步做什么的收束章节

## 扩展规则

- 新增题材时，扩展题材参考库，不要分叉渲染器。
- 内容契约必须版本化；当结构变化时，引入新的 schema 版本。
- 即使文风变化，证据清单中的 source id 和路径也必须保留。
- 保持 HTML 阅读器稳定，确保历史归档学习包在未来仍可重新打开。

## 参考资料

- `references/prompt-engineering.md`
- `references/style-packs/xianxia-cultivation.prompt.md`
- `references/genre-library.md`
- `references/content-contract.md`
- `references/evidence-manifest.md`
- `references/ebook-reader.md`
- `references/retrieval-worked-example.md`
- `references/quality-rubric.md`

## 输出期望

最终产物应该像真正可阅读的学习材料，而不是套了浏览器壳的 JSON 导出。内容是主角，阅读器只是稳定的承载框架。
