---
name: openprd-quality
description: 评估 OpenPrd 的可观测性、业务成本与滥用护栏、评估执行环境覆盖、性能基线、极端场景，以及 HTML 质量评估报告和项目级经验 Skill。
---

# OpenPrd Quality

## 何时使用

当实现就绪、日志、链路追踪、业务成本、免费额度、滥用防护、评估执行环境、冒烟测试、性能阈值、压力数据、HTML 质量评估报告或项目级经验 Skill 在范围内时，使用这份 skill。

典型触发词：

- 日志、链路追踪、中心化日志、排查证据、报错回溯
- 免费用户、额度、限流、AI 调用、第三方 API、成本、预算、报警、止损、滥用
- eval、评估体系、冒烟测试、功能覆盖、异常流程、逆向流程
- CPU、内存、加载时间、接口耗时、压力测试、极端数据
- 质量评估报告、HTML 审查产物、质量门禁
- 界面效果图、实现截图、视觉对比、复刻对标、阶段性视觉评审
- 复盘后沉淀经验 Skill，避免同类问题反复出现

## 核心命令

- 初始化质量状态：
  - `openprd quality <path> --init`
- 生成评审产物：
  - `openprd quality <path> --verify`
- 先生成待确认经验草案：
  - `openprd quality <path> --learn --review --from .openprd/harness/turn-state.json`
- 生成界面视觉对比图：
  - `openprd visual-compare <path> --reference <效果图> --actual <实现截图>`
- 基于已审查报告生成或刷新项目级经验：
  - `openprd quality <path> --learn --from <candidate-dir|report-id-or-json>`
- 审查执行中发现的配置、规则候选或 user-local 偏好：
  - `openprd grow <path> --review`

## 质量审查契约

每次阶段性实现都应先判断 EVO 场景，再按场景要求审查。基础场景至少要覆盖冒烟和任务/功能覆盖；涉及 UI、桌面端、后端、成本、安全、性能、极端数据、发布交付时，再叠加对应门禁。

脚本、依赖或 fixture “存在”只能说明项目具备能力，不能说明本次已经执行。质量报告必须区分：

- `pass`：当前场景必需门禁已经满足，且有本次执行证据或明确项目证据
- `needs-evidence`：能力可能存在，但缺本次执行证据
- `needs-attention`：能力、配置、任务或护栏本身缺失
- `advisory`：当前场景不阻断，但发布或风险进入范围时必须补齐

每次阶段性实现都应从六层审查：

- 质量契约：这项任务承诺覆盖什么
- 可观测性：前端、后端、agent 工具、异步任务和错误路径能否通过共享 trace/request/task/error id 串起来
- 业务成本与滥用护栏：免费、试用、消耗型资源、AI 调用、第三方 API、下载、存储等路径是否有额度、负向验证、监控、报警和止损
- 评估执行环境：冒烟测试、功能覆盖、正常性能和极端数据场景是否存在并持续维护
- 视觉评审证据：涉及界面视觉实现且已有参考效果图时，确认 `.openprd/harness/visual-reviews/` 下存在本次 `openprd visual-compare` 输出的 JPG，并且 Agent 已基于合成图复核差异
- HTML 质量评估报告：`.openprd/quality/reports/` 下的人类审查产物是否存在，且足以支持就绪判断
- 知识 Skill：已验证修复是否应该先生成 `.openprd/knowledge/candidates/` 和 `.openprd/knowledge/drafts/` 下的草案，再 promote 为 `.openprd/knowledge/skills/` 下可复用的项目经验
- 自我成长：配置缺口、文件识别、命令习惯或用户偏好优先沉淀为 `.openprd/growth` 候选，经用户确认后固化；不要把个人偏好混进项目共享质量经验

## 可观测性规则

- 优先使用中心化 logs / traces / errors / metrics，而不是零散本地日志。
- 跨层诊断必须具备关联字段：`trace_id`、`span_id`、`request_id`、`task_id`、`user_session_id`、`error_id`。
- secrets、token、凭证、个人信息和大体积 payload 必须做脱敏。
- 每次代码变更都要自查是否需要新增结构化日志或查询示例。

## 业务护栏规则

- 只要需求涉及免费用户、试用、额度、AI 调用、第三方 API、生成、存储、下载或其他消耗型成本，就必须明确成本来源和用户级限制。
- 必须覆盖额度绕过、重复请求、并发请求、越权身份、异常恢复等负向场景。
- 必须有用量、成本、调用量或异常行为监控信号，以及可执行的报警阈值。
- 必须说明异常后如何关闭、降级、暂停或熔断高成本路径，并明确处理负责人或交接动作。

## 评估执行环境规则

- 如果项目还没有冒烟测试体系，先补最小可用的 smoke 路径；如果已有 smoke，也必须留下本次运行证据。
- 把任务列表映射到主流程、异常流程、逆向/负向流程和边界条件。
- 持续维护项目级和功能级性能基线；只有性能敏感、批量、发布交付或用户明确要求时，正常性能门禁才应阻断。
- 持续维护能覆盖当前功能面的极端 fixture 或压力数据；只有极端数据、并发压力、批量处理、发布交付或用户明确要求时，极端压力门禁才应阻断。
- Agent 自动收紧基线可以做，但放宽阈值必须有用户明确要求。

## 就绪判断规则

- `openprd quality <path> --verify` 生成 advisory 报告时，仍要认真阅读 HTML，不得只看命令退出结果。
- `openprd run <path> --verify` 中只要质量报告 `productionReady=false`，就不能宣称整体就绪。
- UI 任务有参考图但缺少 visual-compare 输出时，不要宣称视觉实现完成；如果对比图仍有明显偏差，先返工而不是把差异留给用户发现。
- 最终回复必须列出未通过的必需 EVO 门禁；如果某门禁被判定不适用，要说明它是当前场景可选或已有明确豁免。

## 经验 Skill 规则

只有当问题具备重复性、高影响、难以重新发现，或明显由 Agent 误判导致时，才生成项目级 Skill。

每个经验 Skill 至少应包含：

- 触发条件
- 先看什么
- 根因模式
- 修复策略
- 验证证据
- 预防要求

不要把一次性噪声沉淀成 Skill；知识层应该保持锋利，下一次拿来就有用。
