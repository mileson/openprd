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
- `node ./bin/openprd.js run . --context`: 生成 hook-stable 执行上下文。

## 维护规则

- 每次新增、移除或升级核心依赖、运行时和工具链后，必须检查并更新本文件。
