# Benchmark Sources

## 选择原则

- 先选和当前优化对象最贴近的来源，不做泛泛资料堆叠。
- 不把对标当成固定关键词匹配；如果参考源不能明显提升当前任务质量，就不要为了使用 skill 而调研。
- 通常只选 1-3 个来源；候选重复时保留更权威、更新或更贴近当前任务的来源。
- 环境、权限、账号、普通脚本报错、一次性短问答或与产品/领域设计无关的问题，不强行对标。
- 公开 GitHub 仓库需要理解架构、子系统或生成链路时，优先用 DeepWiki。
- 第三方工具、SDK、CLI、API、MCP 或版本相关文档，优先用 Context7。
- 官方工程博客和官方文档只提炼可验证原则，不复制大段原文。
- 足够支撑当前 OpenPrd 决策后停止调研。

## 来源分组

### OpenPrd / PRD 设计

- `obra/superpowers`：重点看启动时 skill check、项目级 skill 优先级、强制路由和 session bootstrap。
- `Fission-AI/OpenSpec`：重点看 tool adapter、动态生成 skill/command、配置 profile 和 instruction layering。

### CLI 与 Skill 体系

- `larksuite/cli`：重点看 CLI 入口、插件/命令组织和用户引导。
- `anthropics/skills`：重点看 skill 文件结构、触发描述、progressive disclosure 和跨工具分发。
- Claude Skills / Claude Code Skills 官方文档：重点看 agent 如何发现、选择和调用 skill。

### 长程 Agent 任务

- Anthropic long-running agents harness：重点看任务拆分、状态承接、失败恢复、验证回路和人工接管点。

### 通用 Harness

- OpenAI harness engineering：重点看 agent harness 的环境、工具、评估和反馈闭环。
- LangChain agent harness anatomy：重点看 harness 组成、状态、工具执行和观察面。

### AI Code Review / PR Review Harness

- Nolan Lawson《Using AI to write better code more slowly》：重点看独立 reviewer 并行、主代理先不站队、汇总后再验证、严重级别与 merge 建议。
- Milvus 多模型代码审查实验：重点看 reviewer agreement、交叉验证如何降低 hallucination 和 false positive。

### Context Engineering

- Manus context engineering：重点看上下文压缩、文件系统作为记忆、可恢复状态和错误保留。
- Anthropic context engineering：重点看上下文选择、组织、工具反馈和长期任务信息边界。

### Prompt Engineering

- OpenAI prompt engineering / prompt guidance。
- Claude prompt engineering。
- Gemini prompting strategies。

### 图标资源站一级最佳实践

- Phosphor Icons（https://phosphoricons.com/）：UI、图表、演示和通用界面图标；适合需要统一线性/填充风格、开源授权和批量下载的场景。
- LobeHub Icons（https://lobehub.com/icons）：AI 公司、AI 产品和模型品牌图标；适合需要 SVG、PNG、WebP 高清素材的 AI 相关页面、图示和演示。
- Tech Icons（https://techicons.dev/）：Python、Swift 等技术栈图标；适合开发者工具、技术架构图、工程文档和技术产品界面。
- Thiings（https://www.thiings.co/things）：透明底 3D 动物、物品、人物等图标；适合需要轻量 3D 视觉资产、封面或运营配图的场景。
- iconfont（https://www.iconfont.cn/）：功能图标、矢量插画、3D 插画和字体资源；适合中文生态、语义搜索、在线编辑和彩色/可变字体图标场景。

### 图标实现库二级最佳实践

- Lucide：适合需要轻量、统一、开源线性图标并直接落到现代前端组件的场景。
- Tabler：适合需要大量通用 UI 符号、细线风格和稳定 SVG/React 资产的场景。
- React Icons：适合需要聚合多个图标集、快速覆盖品牌或历史图标需求的 React 项目；使用时关注子包导入和 bundle 体积。

## 输出模板

每次 benchmark 调研后，用这个结构回到 OpenPrd 设计：

1. 已确认的外部事实。
2. 对 OpenPrd 有价值的设计原则。
3. 应改动的 OpenPrd 表面：CLI、skill、AGENTS/CLAUDE/Cursor 生成、hooks、文档或测试。
4. 不采用的做法和原因。
5. 仍缺的证据或需要用户确认的取舍。
