# 项目技术栈

## 运行环境

- Node.js 20.19.0 或更高版本。
- ESM 模块格式，`package.json` 设置 `"type": "module"`。

## 核心依赖

- `yaml`: 读写 `.openprd/config.yaml`、schema 和 OpenSpec 元数据。
- Node.js 标准库: `fs/promises`、`path`、`crypto`、`child_process`、`url`。

## 工具链

- `npm test`: 使用 Node test runner 运行全量测试。
- `node --check <file>`: 对单个 ESM 文件做语法检查。
- `node ./bin/openprd.js standards . --verify`: 校验 `docs/basic/` 和 standards 基础契约。
- `node ./bin/openprd.js quality . --verify`: 生成 JSON 与 HTML 质量评估报告，审查日志链路、业务成本与滥用护栏、冒烟覆盖、性能基线、极端场景和项目经验沉淀。
- `node ./bin/openprd.js quality . --learn --from <report>`: 将审查过的问题修复抽象为 `.openprd/knowledge/skills/` 下的项目级经验 skill。
- `node ./bin/openprd.js run . --context`: 生成 hook-stable 执行上下文。
- `node ./bin/openprd.js update . --hook-profile lite|guarded|full`: 刷新 agent guidance 并选择 Codex hook 重量；默认 `lite` 保留需求澄清写入门禁但不启用完整遥测。

## 维护规则

- 每次新增、移除或升级核心依赖、运行时和工具链后，必须检查并更新本文件。
