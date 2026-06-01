<!-- OPENPRD:AGENTS:START -->
## OpenPrd Harness

本项目由 OpenPrd 管理。Agent 应优先遵循 repo-local skills 和 hooks；`AGENTS.md` 只保留轻量入口合同。

### Scope

- skill 路由放在 `openprd-router`，命令清单放在 command catalog，强约束放在 hooks。
- `AGENTS.md` 只说明入口、默认行为和高风险门禁，不再承载静态长清单。

### Entry Points

- 先读 `skills/openprd-router/SKILL.md`；在生成的 Codex / Claude 环境里，优先读同名 `openprd-router` skill。
- 需要具体命令时，优先读 `.openprd/harness/command-catalog.md`，不要继续把命令清单膨胀回 `AGENTS.md`。
- `$openprd-shared`：共用语言、文档影响、敏感信息、浏览器安全、小程序验证、产品文案与 i18n 规则。
- `$openprd-harness`：主工作流、`run/loop`、需求入口、review/change/tasks 与执行节奏。
- `$openprd-benchmark-router`：外部技术、公开 GitHub 仓库、benchmark/对标/最佳实践路由。
- `$openprd-standards` / `$openprd-quality`：`docs/basic/`、就绪验证、EVO 门禁、知识沉淀。
- `$openprd-diagram-review` / `$openprd-discovery-loop`：可视评审与长时间只读挖掘。

### 默认行为

1. 动手前先从 `.openprd/` 重建状态，并先运行 `openprd run . --context`；它是建议上下文，不是自动执行指令。
2. 规划、分析、架构评审、“怎么改”或“会动哪些文件”类请求保持只读；只有用户明确要求实现、继续任务、深度调研、对标复刻或提交时才进入执行。
3. 先分流再执行：L0 小修（空格、错别字、按钮文案、简单样式、明确 bugfix）直接处理并事后说明；L1 中等改动先在对话内给 mini-plan 再执行；L2 新产品、模块或工作流需求先走 requirement intake，再 `review/change/tasks`，最后才实现。`review.html` 是稳定评审 artifact，不再默认等于唯一的人类停顿点；默认按 decision-points approval policy 执行，只有当前 lane 仍要求人类决策时才在 final answer 主体里停下请求确认。
4. 纯图片、封面图、配图、海报、插画、图标、贴纸、mockup 或“先看样子”请求默认直接使用 Codex 原生 Image 2；其中 logo、icon、avatar、badge 等开发素材在用户未明确要求场景化展示时，默认按独立素材输出（standalone asset）生成：全画布单主体，不额外添加卡片、设备框或其他展示容器；进入实现阶段时，已有参考图用 `openprd visual-compare --reference/--actual`，无参考图但改动界面用 `openprd visual-compare --before/--after`。
5. 用户给出会话 ID 并要求继续时，按工具无关的历史会话续接；不要要求工具专属 ID，也不要用当前 active change 或相似历史替代指定会话。
6. 代码修改完成后、最终回复前，针对本轮实际 touched code files 运行 `openprd dev-check . <file...>`；宣称准备就绪前，运行 `openprd standards . --verify`、`openprd quality . --verify` 和 `openprd run . --verify`。

### Hook-Enforced Gates

- requirement：需求未完成 `clarify/review/change/tasks` 前阻断实现写入；tasks 就绪后，只有用户原始意图已明确要求实现，或后续明确发出执行指令时才放行。
- research：公开 GitHub 架构/对标先 DeepWiki；第三方技术用法、配置、限制、版本差异或迁移先查本地证据，不足时再按 `resolve_library_id -> query_docs` 使用 Context7。
- skill-visualization：修改 skill、`SKILL.md`、`AGENTS.md` 或相关 workflow 前，先输出彩色 Mermaid 方案并等待用户确认。
- secrets / weapp / browser / copy：分别处理 `secrets-vault`、`weapp-dev-mcp`、窗口归属与 i18n/普通用户文案提醒。
- 需要细节时，读 router 指向的 skill 和 command catalog，而不是继续扩写 `AGENTS.md`。

### High-Risk Gate

Before freeze, handoff, accepted spec apply/archive, commit, push, release, or publish, ensure `openprd standards . --verify`, `openprd quality . --verify`, `openprd run . --verify`, and `openprd doctor .` are healthy.
If the quality report says `productionReady=false`, do not claim readiness; list the missing evidence or gates.
The only baseline documentation path is `docs/basic/`.
<!-- OPENPRD:AGENTS:END -->
