---
name: openprd-benchmark-router
description: 为 OpenPrd 产品、CLI、Agent harness、AI code review / PR review harness、上下文工程、提示词优化和图标资源选择对标来源与调研路径。适用于最佳实践、benchmark、参考产品、Superpowers、OpenSpec、Anthropic Skills、Lark CLI、长程 Agent、harness、深度审查 lane、context engineering、prompt engineering 和 icon resource 相关请求。
---

# OpenPrd Benchmark Router

## 概览

这份 skill 负责把“最佳实践 / 对标 / benchmark / 参考产品 / prompt engineering / Agent harness / context engineering / CLI skill 体系优化 / 图标资源”类请求先路由到合适的证据源，再把结论落回 OpenPrd 的生成规则、skills、hooks、CLI 或测试。

它不是长文资料库，也不是外部项目复刻器。它的职责是：先判断该参考谁、怎么查、查到什么程度够用，然后再进入 OpenPrd 的设计和修改。

## 核心原则

- 不把对标当成固定关键词匹配。结合用户目标判断参考源是否真的能提升设计、实现、排查、评审、规划或文档质量。
- 不强行对标。环境、权限、账号、普通脚本报错、一次性短问答或与产品/领域设计无关的问题，继续当前任务即可。
- 不默认下载全文、仓库或整站。先保留轻量链接、来源 ID 和适用边界；真正需要事实时再读取。
- 通常只选 1-3 个最相关来源；不要为了显得全面而扩大上下文。
- 不把索引、来源目录或记忆当事实来源；未经核验的外部内容不能作为已确认事实输出。

## 触发信号

- 用户提到 OpenPrd、OpenSpec、Superpowers、Anthropic Skills、Lark CLI、Agent harness、AI code review、PR review、review lane、long-running agents、context engineering、prompt engineering、最佳实践、对标、参考、复刻或优化设计。
- 用户提到图标、icon、图标站、图标库、图标资源、UI 图标、AI 图标、技术图标、3D 图标、功能图标、iconfont 或视觉资产参考。
- 用户要求解释某个 Codex / Claude / Cursor agent 为什么没有发现 skill，或希望提升 skill 自动识别、路由、生成、安装和持续执行能力。
- 用户没有显式说 skill 名也要触发；不要要求用户记住 `$openprd-benchmark-router`。

## 路由流程

1. 先识别优化对象：OpenPrd 产品/PRD 流程、CLI、skill 体系、长程任务、通用 harness、AI code review / PR review harness、context engineering、prompt engineering、图标资源或图标实现库。
2. 读取当前工作区证据：`.openprd/`、`.openprd/benchmarks/index.md`、`.openprd/benchmarks/sources.yaml`、`AGENTS.md`、repo-local skills、生成的 `.codex/.claude/.cursor` 引导和相关源码。
3. 选择最小足够的外部证据源：公开 GitHub 仓库走 DeepWiki；第三方工具、SDK、CLI 或官方 API 用 Context7；产品官方文档、工程博客和一手资料用官方来源。
4. 形成 OpenPrd 设计判断时，明确区分已证实事实、从来源归纳出的设计原则，以及对本项目的推断。
5. 用分析维度提炼可迁移原则，避免照搬表面功能。
6. 如果任务变成大量参考项目行为挖掘、长时间覆盖或需求补全，再路由到 `$openprd-discovery-loop` 承接持续调研。

## Project Registry

- 项目自己的 `.openprd/benchmarks/` 优先于 OpenPrd 内置 Source Map。
- `sources.yaml` 里的 approved source 是长期可复用参考；`inbox/` 里的 candidate 只表示待确认线索。
- 用 `openprd benchmark add <url|repo|file>` 写入 candidate，用 `openprd benchmark approve <id>` 纳入 approved registry。
- 用 `openprd benchmark verify` 检查重复来源、失效链接、缺失本地文件和过宽触发规则。

## Source Policy

- GitHub 仓库：需要理解架构、核心模块、关键流程或对标结论时，先用 DeepWiki。默认顺序是 `read_wiki_structure` 1 次，再 `ask_question` 1-2 次；只有在本地源码和已有结论仍不足时才追加。DeepWiki 不可用或覆盖不足时，再回退到 GitHub README、源码和官方文档。
- 官方技术文档：涉及第三方库、框架、API、SDK、MCP、CLI 工具的用法、配置、限制、版本差异或迁移路径时，先检查本地代码、锁文件、README、类型定义；本地不足时再用 Context7，默认顺序是 `resolve_library_id` 1 次，再 `query_docs` 1-2 次。Context7 不足时说明缺口，再补官方文档、源码或其他一手资料。
- 工程文章和产品文档：优先读取当前线上一手页面，只抽取和当前任务相关的观点与设计原则，不复制长文；如果内容可能过时，要说明时效风险。
- 本地源码优先：当前工作区已经有相关源码时，常规修 bug、查实现、改功能优先读本地代码；DeepWiki 主要用于外部仓库架构理解和对标分析。
- 停止调研：找到足以支持当前决策的 1-3 个高相关来源后停止扩展；候选来源重复时保留更权威、更新或更贴近当前任务的来源。
- 追加调用前先写清“已确认什么、还缺什么”；不要为了同一问题只换个说法反复查询。

## Source Map

- OpenPrd / PRD 设计对标：`obra/superpowers`、`Fission-AI/OpenSpec`。
- CLI 与 skill 体系对标：`larksuite/cli`、`anthropics/skills`、Claude Skills 官方文档、Claude Code Skills 官方文档。
- 长程 Agent 任务：Anthropic long-running agents harness 工程文章。
- 通用 harness：OpenAI harness engineering、LangChain agent harness anatomy。
- AI code review / PR review harness：Nolan Lawson 的 “Using AI to write better code more slowly”、Milvus 关于多模型代码审查辩论/交叉验证的实验文章。
- Context engineering：Manus context engineering、Anthropic context engineering。
- Prompt engineering：OpenAI prompt engineering / prompt guidance、Claude prompt engineering、Gemini prompting strategies。
- 图标资源站一级最佳实践：UI 图标优先看 Phosphor Icons（https://phosphoricons.com/）；AI 公司与产品图标看 LobeHub Icons（https://lobehub.com/icons）；技术栈图标看 Tech Icons（https://techicons.dev/）；透明底 3D 图标看 Thiings（https://www.thiings.co/things）；功能图标、矢量插画、3D 插画和字体资源看 iconfont（https://www.iconfont.cn/）。
- 图标实现库二级最佳实践：Lucide、Tabler、React Icons。需要落到前端代码时，再结合当前项目框架、包管理器、bundle 体积和导入方式选择具体库。

## Evaluation Lenses

- 产品与工作流：用户从哪里开始、如何知道下一步、模糊输入如何变成结构化产物、哪些步骤要保存/展示/恢复、哪些步骤必须保留用户确认。
- Agent 与 Harness：目标、边界、停止条件、工具选择、进度记录、证据、验证结果、失败恢复和人工接管点是否清楚。
- PR 审查 lane：reviewer 是否独立审查、主代理是否先汇总再验证、是否有误报过滤、agreement matrix、严重级别和 merge recommendation。
- 上下文工程：哪些信息常驻、哪些按需检索，是否使用稳定路径、链接和来源 ID 支持 just-in-time 检索，如何处理过期、冲突和可信度。
- 提示词与 Skill 设计：触发描述是否具体但不过度强制，主说明是否短，细节是否按需放到 reference，是否明确不要硬套参考源。
- 图标与视觉资产：先判断用途是 UI、AI 品牌、技术栈、3D 物件还是功能图标；优先选最贴近用途的资源站，再在实现阶段选择合适的代码图标库。
- CLI 与开发者体验：命令是否可发现、可组合、可预测；错误信息是否说明发生了什么、影响是什么、下一步怎么做；危险操作是否有确认。

## 设计输出

- 给出 OpenPrd 应该内置什么、生成什么、路由什么、保留什么门禁。
- 优先把结论落到 `CANONICAL_SKILLS`、repo-local skills、AGENTS/CLAUDE/Cursor 生成规则、hooks 或测试，而不是停留在口头建议。
- 不把外部项目整包复制进 OpenPrd；只吸收可验证的路由、生成、门禁、状态承接和用户体验原则。
- 需要显式说明时，简短写出参考了哪个来源、借鉴点、适用原因、不照搬边界，以及落到当前任务的具体决策。

## Stop Rule

- 同一来源默认只做一次结构理解和一到两次聚焦问题；证据足够支撑当前决策后立即停止调研。
- 如果 DeepWiki、Context7 或官方资料覆盖不足，明确说明缺口，再把后续结论标为推断。

## 参考资料

- `references/benchmark-sources.md`
- `references/source-policy.md`
- `references/evaluation-lenses.md`
