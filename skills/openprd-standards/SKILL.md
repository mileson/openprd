---
name: openprd-standards
description: 维护 OpenPrd 项目文档标准，包括 `docs/basic` 基线文档、文件说明书模板、文件夹 README 模板，以及 change/spec/task 执行阶段的 standards 校验。
---

# OpenPrd Standards

## 概览

当用户要求 OpenPrd 建立、维护、修复或解释项目文档标准时，使用这份 skill。它覆盖需求发现、change 生成、任务执行和发布就绪检查阶段的文档标准。

OpenPrd standards 管三件事：

- `docs/basic/` 下的项目基线文档
- `.openprd/standards/file-manual-template.md` 定义的文件说明书规则
- `.openprd/standards/folder-readme-template.md` 定义的文件夹 README 规则

唯一的基线路径就是 `docs/basic/`。

## 动手前

1. 先读 `skills/openprd-shared/SKILL.md`
2. 从 `.openprd/` 重建工作区状态
3. 编辑前先检查 standards：
   - `openprd standards <path> --verify`
4. 只有当用户要求初始化，或工作区正在初始化时，才补缺失 standards：
   - `openprd standards <path> --init`

## 必需基线文档

OpenPrd standards 要求以下文档存在：

- `docs/basic/file-structure.md`
- `docs/basic/app-flow.md`
- `docs/basic/prd.md`
- `docs/basic/frontend-guidelines.md`
- `docs/basic/backend-structure.md`
- `docs/basic/tech-stack.md`

如果涉及后端实现，`docs/basic/backend-structure.md` 必须显式覆盖 CLI 接入面和 API 接入面；如果某一面不适用，也要写明原因，而不是省略。

## 执行规则

- 声称某个 change 就绪前，先运行 `openprd standards <path> --verify`
- OpenPrd 自动生成的 change tasks 应包含 standards 维护任务
- 每次新增或修改源码文件，都要做文档影响检查
- 如果 `docs/basic/`、文件说明书或文件夹 README 缺失，或还停留在模板态，就绪前必须补齐
- 如果涉及后端、脚本、Agent、工具链、服务或数据处理变更，必须把 CLI 与 API 视为同级接入面，更新 `docs/basic/backend-structure.md` 中的命令入口、参数、输出契约、`help`/`doctor`/`dry-run`/`status`、接口协议和不适用说明
- 如果文档已经存在，也要检查这次变更是否让它过期；职责、流程、结构、依赖或产品行为变化时必须更新
- 功能变更影响文件、文件夹、流程、架构、依赖或产品逻辑时，更新对应的 `docs/basic/` 文档
- 功能变更影响代码文件职责时，更新对应文件说明书
- 功能变更影响文件夹职责或文件布局时，更新对应文件夹 README
- 如果最终不需要改文档，也要说明已经做过影响检查，以及为什么现有文档依然准确

## 文档影响检查

实现阶段按这份清单执行：

- 新增源码文件：若缺少文件说明书就补上，并确认所在文件夹 README 已存在
- 修改源码文件：若已有文件说明书，先读再决定是否更新；当职责、输入、输出、依赖或维护规则变化时必须更新
- 文件夹内容新增、移动、删除或改作他用：新增或更新文件夹 README，使其反映当前文件夹职责和文件布局
- 功能、流程、架构、依赖或产品行为变化：即使文件已存在，也更新相关 `docs/basic/` 文档
- 后端、脚本、Agent、工具链、服务或数据处理变化：即使没有新增 API，也要显式评估 CLI 与 API 两个接入面，并在 `docs/basic/backend-structure.md` 写清楚事实或不适用原因
- standards 契约缺失：仅在工作区初始化或用户明确要求修复 standards 时运行 `openprd standards <path> --init`，随后用项目事实替换模板内容

## 不要这样做

- 不要把 `docs/basic/` 以外的路径当成项目基线文档目录
- 不要在 `docs/basic/` 缺失时悄悄放过 standards 校验
- 不要仅因为实现测试通过，就把文档工作标记为完成
