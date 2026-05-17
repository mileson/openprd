# 项目文件结构

## 项目定位

OpenPrd 是一个 Node.js CLI 项目，入口命令通过 `bin/openprd.js` 调用 `src/openprd.js` 的 `main` 函数。`src/openprd.js` 保留 CLI 分发、初始化、freeze、handoff 和公开导出，工作区核心能力与横向流程拆入独立模块，避免入口文件继续承担所有实现细节。

## 核心目录

- `bin/`: CLI 可执行入口。
- `src/`: OpenPrd CLI 源码。
- `src/cli/`: 命令行参数解析和终端输出渲染。
- `src/openspec/`: OpenPrd change、spec、task 的结构化文件操作。
- `src/diagram-workspace.js`: diagram 命令的 artifact 生成、评审状态和浏览器打开逻辑。
- `src/discovery.js`: discovery 运行、覆盖矩阵、claims 和验证逻辑。
- `src/fleet.js`: 历史项目扫描和批量 setup/update/doctor 编排。
- `src/fs-utils.js`: 共享文件、JSON、YAML、JSONL 读写工具。
- `src/html-artifacts.js`: HTML 协作 artifact、回归报告和复盘学习 reader 的渲染骨架。
- `src/learning-review.js`: 复盘学习包的证据收集、Agent 写作工具包、内容合同校验和 reader 归档。
- `src/quality.js`: 质量契约、日志/追踪检测、业务成本与滥用护栏检测、评估执行环境检测、HTML 质量评估报告和项目经验 Skill 沉淀。
- `src/run-harness.js`: `openprd run` 的 hook-stable context、verify 和 hook 事件记录。
- `src/source-inventory.js`: discovery 使用的源码盘点和忽略规则。
- `src/workspace-core.js`: workspace 骨架、迁移、校验、版本索引、事件日志和共享文档渲染。
- `src/workspace-workflow.js`: classify、interview、clarify、capture、synthesize、diff、history、next、status guidance。
- `docs/basic/`: 项目级基础说明。
- `.openprd/quality/`: 质量基线配置和质量评估报告归档。
- `.openprd/knowledge/`: incident、abstract pattern 和项目级经验 Skill 归档。
- `skills/`: OpenPrd 自带 agent skills。
- `test/`: Node test runner 测试用例。

## 文件组织规则

- 新增或修改文件时，应同步判断 `docs/basic/`、文件说明书、所在文件夹说明书是否缺失或过期；缺失的要补齐，受本次变更影响的已有说明要更新。
- 跨模块移动文件时，应更新本文件中的目录结构和职责说明。
- CLI 表层逻辑优先放入 `src/cli/`，不要回填到 `src/openprd.js`。
- 共享 IO 工具优先放入 `src/fs-utils.js`，业务模块只保留自己的领域判断。
- discovery、fleet、run harness 这类可独立验证的流程应保持在各自模块内，通过依赖注入接入工作区核心能力。
- quality 相关扫描、业务护栏、报告和经验沉淀逻辑归入 `src/quality.js`，HTML 表现层只放在 `src/html-artifacts.js`。
- 工作区核心状态工具归入 `src/workspace-core.js`；面向用户的工作流命令归入 `src/workspace-workflow.js`。

## 维护规则

- 每次新增、删除、移动目录或核心文件后，必须检查并更新本文件。
- 本文档只记录项目结构事实，不承载具体功能需求细节。
