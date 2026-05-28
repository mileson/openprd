# Verify 边界与历史项目刷新

## 背景与原因

修复 OpenPrd 校验边界，避免外部参考目录和参考调研状态污染主验证，并刷新历史项目生成物。

## 变更内容

- 调整 run context 与 run verify 对 discovery 的纳入规则
- 调整 standards/source-manual 默认对明显外部参考目录的处理策略
- 为历史项目执行 openprd fleet 更新与必要回填
- 运行上下文与运行校验的默认结果不再把参考调研状态或明显外部参考目录当成主门禁噪音
- 历史项目刷新后生成物能承接这次边界修复
- 对需要人工确认的外部参考目录仍保留显式 `classify-external` 路径

## 能力范围

- `agent-requirements`: Verify 边界与历史项目刷新 需求。

## 影响范围

- 主要用户: 维护 OpenPrd 的 Agent 工程师
- 主要用户: 使用 OpenPrd 管理历史项目的项目维护者
