# 角色

## 用户

- 主要用户:
- 维护 OpenPrd 的 Agent 工程师
- 使用 OpenPrd 管理历史项目的项目维护者

- 次要用户:
- 待补充

- 相关方:
- 待补充

## 类型专项

- humanAgentContract: Agent 可以识别并提示 reference discovery 与外部参考目录边界，但把目录正式归类为 external reference 仍需要人确认；批量刷新历史项目可以自动执行。
- autonomyBoundary: Agent 可以修改 OpenPrd CLI、补测试、更新文档、运行 fleet dry-run 与 update-openprd/backfill-work-units，并验证结果；不得静默把任意历史目录永久归类为 external reference。
- toolBoundary: 使用本地代码检索、OpenPrd CLI、自带测试、fleet 更新、doctor 与 verify 完成实现和验证；本次不需要外部第三方文档调研。
- stateModel: 需要保留三类状态：当前项目源码验证状态、reference discovery 状态、standards external reference 显式配置；主 run/verify 只默认消费第一类，其他两类按边界显式暴露。
- evalPlan: 通过针对 run-harness、standards 和 fleet 的单测与集成验证评估；再用历史项目 dry-run 与 update-openprd/backfill-work-units 验证刷新结果。
