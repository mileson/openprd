# 流程

## 主流程

- 维护者运行 openprd run . --context 或 openprd run . --verify 时，只看到当前项目主验证状态；仓库中存在 research、toolkit-sources、marketplace-candidates 等参考目录时，默认不会被当成本项目源码说明书缺口直接淹没结果；维护者可以继续按需显式 classify-external。

## Mermaid 流程图

```mermaid
flowchart LR
  entry["入口触发<br/>维护者运行 openprd run . --context 或 openprd run . --verify 时，只看到当前项…"]
  experience["产品内步骤<br/>修复 OpenPrd verify 边界，避免外部参考目录和 reference discovery 污染主验证，并刷新历史项…"]
  decision{"决策点<br/>边界情况仍需澄清"}
  success(["成功结果<br/>存在 reference discovery 时 openprd run . --context 不再默认展示它"])
  failure[["失败与恢复<br/>reference discovery 仍然混入 run context 或 run verify"]]
  entry -->|"维护者运行 openprd run . --context 或 openprd r…"| experience
  experience -->|"系统处理请求"| decision
  decision -->|"让主验证只关注当前项目源码和当前实现门禁"| success
  decision -.->|"reference discovery 仍然混入 run context 或 ru…"| failure
```

## 边界情况

- 待补充

## 失败模式

- reference discovery 仍然混入 run context 或 run verify
- standards verify 继续被 research 或 toolkit-sources 之类参考目录的说明书缺口淹没
- fleet 更新后历史项目仍保留旧的 verify 噪音行为
