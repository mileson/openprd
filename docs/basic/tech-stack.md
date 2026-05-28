# 项目技术栈

## 运行环境

- Node.js 20.19.0 或更高版本。
- ESM 模块格式，`package.json` 设置 `"type": "module"`。

## 核心依赖

- `yaml`: 读写 `.openprd/config.yaml`、schema 和 OpenSpec 元数据。
- `sharp`: 读取常见图片格式、缩放截图、合成界面效果图与实现截图，并输出 JPG / PNG / WebP 视觉评审图。
- Node.js 标准库: `fs/promises`、`path`、`crypto`、`child_process`、`url`。

## 工具链

- `npm test`: 使用 Node test runner 运行全量测试。
- `node --check <file>`: 对单个 ESM 文件做语法检查。
- `node ./bin/openprd.js standards . --verify`: 校验 `docs/basic/` 和 standards 基础契约。
- `node ./bin/openprd.js dev-check . <file...>` / `node scripts/openprd-dev-check.mjs . <file...>`: Agent 研发期检查 touched code files 的行数状态和下一步动作建议。
- `node ./bin/openprd.js grow . --review|--apply --id <candidate-id>|--reject --id <candidate-id>`: 审查并固化执行中发现的配置、规则候选或 user-local 偏好。
- `node ./bin/openprd.js synthesize . --work-unit <id> --target-root <path>` / `node ./bin/openprd.js review . --mark confirmed --version <id> --digest <sha256> --work-unit <id>`: 绑定并校验工具无关的需求工作单元，避免多 Agent 或多对话确认到其他需求。
- `node ./bin/openprd.js fleet <root> --sync-registry`: 把当前 root 下已初始化的 `.openprd/` 工作区回填到 `~/.openprd/registry/workspaces.jsonl`，给后续历史项目更新提供全局视角。
- `node ./bin/openprd.js fleet <root> --backfill-work-units`: 为历史 OpenPrD 工作区的既有 PRD 版本补 work unit 绑定、digest 校验命令和稳定评审 artifact；`--update-openprd` 会顺带执行该回填。
- `node ./bin/openprd.js quality . --verify`: 生成 JSON 与 HTML 回归测试报告，展示整体回归结果、逐需求模块结果、测试块通过情况、本次执行证据、日志链路、业务成本与滥用护栏、冒烟覆盖、性能基线、极端场景和项目经验沉淀。
- `node ./bin/openprd.js quality . --learn --from <report>`: 将审查过的问题修复抽象为 `.openprd/knowledge/skills/` 下的项目级经验 skill。
- `node ./bin/openprd.js visual-compare . --reference <效果图> --actual <实现截图>`: 把参考图和实现截图合成左右对比图；默认输出 JPG 到 `.openprd/harness/visual-reviews/`，可用 `--format jpg|png|webp`、`--quality` 和 `--max-panel-width` 调整。
- `node ./bin/openprd.js run . --context`: 生成 hook-stable 执行上下文。
- `node ./bin/openprd.js update . --hook-profile lite|guarded|full`: 刷新 agent guidance 并选择 Codex hook 重量；默认 `lite` 保留需求澄清写入门禁但不启用完整遥测。

## 维护规则

- 每次新增、移除或升级核心依赖、运行时和工具链后，必须检查并更新本文件。
