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

### Context Engineering

- Manus context engineering：重点看上下文压缩、文件系统作为记忆、可恢复状态和错误保留。
- Anthropic context engineering：重点看上下文选择、组织、工具反馈和长期任务信息边界。

### Prompt Engineering

- OpenAI prompt engineering / prompt guidance。
- Claude prompt engineering。
- Gemini prompting strategies。

## 输出模板

每次 benchmark 调研后，用这个结构回到 OpenPrd 设计：

1. 已确认的外部事实。
2. 对 OpenPrd 有价值的设计原则。
3. 应改动的 OpenPrd 表面：CLI、skill、AGENTS/CLAUDE/Cursor 生成、hooks、文档或测试。
4. 不采用的做法和原因。
5. 仍缺的证据或需要用户确认的取舍。
