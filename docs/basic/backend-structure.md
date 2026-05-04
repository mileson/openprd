# 后端架构设计

## 适用范围

说明后端服务、接口、数据处理和外部依赖的项目级架构约定。

## 服务边界

- CLI 入口: `bin/openprd.js` 只负责调用 `src/openprd.js` 的 `main(argv)` 并设置退出码。
- CLI 分发: `src/openprd.js` 负责命令分发、workspace 初始化、freeze、handoff、change 生成和对外导出。
- 工作区核心: `src/workspace-core.js` 负责 workspace 骨架、迁移、校验、版本索引、事件日志和共享文档渲染。
- 工作流命令: `src/workspace-workflow.js` 负责 classify、interview、clarify、capture、synthesize、diff、history、next 和 status guidance。
- 图表工作区: `src/diagram-workspace.js` 负责 diagram artifact 生成、评审状态读写和可选浏览器打开。
- CLI 表层: `src/cli/args.js` 解析参数，`src/cli/print.js` 统一渲染终端输出。
- 文件基础设施: `src/fs-utils.js` 统一封装文本、JSON、YAML、JSONL 读写。
- 运行编排: `src/run-harness.js` 负责 `openprd run` 上下文、hook 记录和 verify 门禁。
- 规模化操作: `src/fleet.js` 负责扫描历史项目并按依赖注入调用 setup/update/doctor。
- 持续调研: `src/discovery.js` 负责 discovery run、source inventory、coverage matrix、claims 和 discovery 验证。
- OpenSpec 文件域: `src/openspec/` 负责 change/spec/task 的读写、验证、应用和归档。

## 数据流

- 用户命令进入 `main(argv)`，由 `src/cli/args.js` 解析 flags 和 positionals。
- `main` 根据命令分发到 workspace workflow、diagram、standards、loop、openspec、discovery、fleet 或 run 模块。
- 工作区状态主要读写 `.openprd/` 下的 config、templates、state、engagements、exports 和 harness 文件。
- 模块返回结构化 result，`src/cli/print.js` 再根据 `--json` 决定输出 JSON 或用户可读文本。
- `run-harness`、`fleet`、`discovery` 通过工厂依赖注入调用核心工作区能力，避免从子模块反向导入 `src/openprd.js`。

## 维护规则

- 每次服务边界、数据流、存储或外部依赖发生变化后，必须检查并更新本文件。
