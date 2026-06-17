# 项目技术栈

## 运行环境

- Node.js 20.19.0 或更高版本。
- ESM 模块格式，`package.json` 设置 `"type": "module"`。

## 核心依赖

- `yaml`: 读写 `.openprd/config.yaml`、schema 和 OpenSpec 元数据。
- `sharp`: 读取常见图片格式、缩放截图、切片参考图、生成 contact sheet、合成界面效果图与实现截图，或合成修改前后截图，并输出 JPG / PNG / WebP 视觉评审图。
- Node.js 标准库: `fs/promises`、`path`、`crypto`、`child_process`、`url`。

## 工具链

- `npm test`: 使用 Node test runner 运行全量测试。
- `npm run test:perf`: 运行项目级版本轨道与变化摘要路径的正常性能基线检查，并把结果写入 `.openprd/harness/test-reports/quality-normal-performance.md`。
- `npm run test:perf:extreme`: 使用 `test/fixtures/release-ledger-extreme.json` 执行极端规模性能检查，并把结果写入 `.openprd/harness/test-reports/quality-extreme-performance.md`。
- `node --check <file>`: 对单个 ESM 文件做语法检查。
- `node ./bin/openprd.js standards . --verify`: 校验 `docs/basic/` 和 standards 基础契约。
- `node ./bin/openprd.js dev-check . <file...>` / `node scripts/openprd-dev-check.mjs . <file...>`: Agent 研发期检查 touched code files 的关注程度和下一步动作建议；需要关注的文件会输出最终回复可直接使用的 **后续建议** Markdown 区块。
- `node scripts/openprd-codex-isolated-worker.mjs --cwd <path> --prompt-file <prompt.md> --output-jsonl <output.jsonl> --output-last-message <last.txt>`: 用隔离 `CODEX_HOME` 启动独立 Codex worker，只复制认证文件，可选继承 model，并保存 raw JSONL 与最后一条 agent 消息，适合 blind worker 回归或全局 Codex home 已被启动噪音污染的场景。
- `node ./bin/openprd.js grow . --review|--apply --id <candidate-id>|--reject --id <candidate-id>`: 收工时审查并固化需要用户确认的配置、规则候选或 user-local 偏好；代码扩展识别这类白名单工具补全可由 dev-check 自动固化并记录。
- `node ./bin/openprd.js synthesize . --work-unit <id> --target-root <path>` / `node ./bin/openprd.js review . --mark confirmed --version <id> --digest <sha256> --work-unit <id>`: 绑定并校验工具无关的需求工作单元，避免多 Agent 或多对话确认到其他需求。
- `node ./bin/openprd.js fleet <root> --sync-registry`: 把当前 root 下已初始化的 `.openprd/` 工作区回填到 `~/.openprd/registry/workspaces.jsonl`，给后续历史项目更新提供全局视角。
- `node ./bin/openprd.js fleet <root> --backfill-work-units`: 为历史 OpenPrD 工作区的既有 PRD 版本补 work unit 绑定、digest 校验命令和稳定评审 artifact；`--update-openprd` 会顺带执行该回填。
- `node ./bin/openprd.js quality . --verify`: 生成 JSON 与 HTML 回归测试报告，展示整体回归结果、逐需求模块结果、测试块通过情况、本次执行证据、日志链路、业务成本与滥用护栏、冒烟覆盖、性能基线、极端场景和项目经验沉淀。
- `node ./bin/openprd.js quality . --learn --from <report>`: 将审查过的问题修复抽象为 `.openprd/knowledge/skills/` 下的项目级经验 skill。
- `node ./bin/openprd.js visual-prepare . --reference <效果图> --grid <列>x<行>` / `--boxes <plan.json>`: 把确认后的整板、网格图或多对象效果图整理成 reference-set，输出 crops、contact sheet、compare-plan 和 board 模板，供后续逐项视觉验收使用。
- `node ./bin/openprd.js visual-compare . --reference <效果图> --actual <实现截图> --locale <zh-CN|en>`: 把参考图和实现截图合成左右对比图；`node ./bin/openprd.js visual-compare . --before <修改前截图> --after <修改后截图> --locale <zh-CN|en>` 会在无参考图界面改动中生成修改前后自检图；`node ./bin/openprd.js visual-compare . --board <board.json> --locale <zh-CN|en>` 则可生成局部焦点证据板或并行实验证据板。默认输出 JPG 到 `.openprd/harness/visual-reviews/`，可用 `--format jpg|png|webp`、`--quality` 和 `--max-panel-width` 调整。
- `node ./bin/openprd.js run . --context`: 生成 hook-stable 执行上下文。
- `node ./bin/openprd.js update . --hook-profile lite|guarded|full`: 刷新 agent guidance 并选择 Codex hook 重量；默认 `lite` 保留需求澄清写入门禁但不启用完整遥测。

## 维护规则

- 每次新增、移除或升级核心依赖、运行时和工具链后，必须检查并更新本文件。
