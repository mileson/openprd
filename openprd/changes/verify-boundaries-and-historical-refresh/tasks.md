# 任务

- [x] T001.01 评审生成的 spec 覆盖
  - type: governance
  - done: 生成的 agent-requirements spec 符合 PRD 意图
  - verify: openprd change . --validate --change verify-boundaries-and-historical-refresh

- [x] T001.02 收口 run context 的默认边界
  - type: implementation
  - deps: T001.01
  - done: 维护者运行 `openprd run . --context` 时，只会看到当前项目的主验证状态，不再被参考调研状态混入主上下文。
  - verify: openprd run . --verify

- [x] T001.03 收口 run verify 的参考噪音过滤
  - type: implementation
  - deps: T001.02
  - done: `openprd run . --verify` 默认忽略 reference discovery 和明显外部参考目录带来的主门禁噪音，只保留当前项目应处理的验证结果。
  - verify: openprd run . --verify

- [x] T001.04 调整 standards 与 source-manual 的外部参考目录默认处理
  - type: implementation
  - deps: T001.03
  - done: `research`、`toolkit-sources`、`marketplace-candidates` 等明显外部参考目录不会再被默认当成本项目源码说明书缺口，但维护者仍可显式确认它们的归类。
  - verify: openprd standards . --verify

- [x] T001.05 刷新历史项目的边界配置与生成物回填
  - type: implementation
  - deps: T001.04
  - done: 历史项目经过 `openprd fleet` 更新与必要回填后，默认继承新的验证边界，不会继续生成旧风格噪音结果。
  - verify: openprd run . --verify

- [x] T001.06 验证运行上下文和主验证结果不再被参考目录淹没
  - type: verification
  - deps: T001.05
  - done: 已验证 `openprd run . --context` 与 `openprd run . --verify` 只聚焦当前项目主验证状态，不再把 reference discovery 或明显外部参考目录当成首要门禁噪音。
  - verify: openprd run . --verify

- [x] T001.07 验证显式 classify-external 路径仍然可用
  - type: verification
  - deps: T001.06
  - done: 已验证对需要人工确认的 external reference 仍保留显式 `classify-external` 路径，不会因为默认静音而丢失处理入口。
  - verify: openprd standards . --verify

- [x] T001.08 验证历史项目刷新后能承接新的边界修复
  - type: verification
  - deps: T001.07
  - done: 已验证历史项目刷新后的生成物、运行上下文和主验证结果都能承接这次边界修复，不会回退到旧噪音行为。
  - verify: openprd run . --verify

- [x] T001.09 维护 docs/basic 项目基础文档
  - type: documentation
  - deps: T001.08
  - done: 已检查 docs/basic 是否缺失或因本次需求、流程、结构、依赖、产品行为变化而过期；若涉及后端、脚本、Agent 或工具链变更，已同步评估 CLI 与 API 接入面，并在 backend-structure.md 中记录事实或不适用原因；需要更新的基础文档已同步
  - verify: openprd standards . --verify

- [x] T001.10 更新文件说明书和文件夹 README
  - type: documentation
  - deps: T001.09
  - done: 本次变更涉及的文件说明书和文件夹 README 已检查；缺失的已补齐，过期的已更新
  - verify: openprd standards . --verify

- [x] T001.11 运行 OpenPrd spec 校验
  - type: governance
  - deps: T001.10
  - done: 生成的 change 通过 OpenPrd 校验
  - verify: openprd change . --validate --change verify-boundaries-and-historical-refresh
