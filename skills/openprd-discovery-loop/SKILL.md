---
name: openprd-discovery-loop
description: Route natural-language OpenPrd or OpenSpec deep, continuous, comprehensive, reference-mining, or requirement-discovery requests into OpenPrd's long-running discovery workflow. Use when users ask OpenPrd to continue, deeply analyze, fully cover, exhaustively mine, replicate, or complete requirements, specs, and tasks.
---

# OpenPrd Discovery Loop

## Overview

Use this skill when the user asks OpenPrd to deepen, continue, complete, or exhaustively discover requirement coverage. OpenSpec remains a supported output format and compatibility vocabulary, but OpenPrd is the owning entry point for routing, generation, validation, and task execution.

Users should not need to know skill names or CLI flags. Interpret their natural-language intent, choose the mode, then run the appropriate internal OpenPrd commands.

## Natural-Language Triggers

Route here when the user says OpenPrd or OpenSpec together with intent words such as:

- 持续, 继续, 一直推进, 不断补全, 长程
- 深度, 深挖, 深入梳理, 深入分析
- 全面, 完整, 全量, 穷尽, 尽可能覆盖
- 补全, 完善, 生成规范, 生成 OpenSpec, 整理成任务
- 复刻, 对标, 参考这个项目, 把这个项目逻辑转成规范

Examples that should trigger this skill:

- "用 OpenPrd 深度补全这个项目。"
- "用 OpenSpec 深度补全这个项目。"
- "全面梳理现有项目，把规范和任务补齐。"
- "参考这个仓库，持续复刻它的产品逻辑到新项目。"
- "继续深挖这个需求，直到覆盖完整。"

Do not require the user to say `Use $openprd-discovery-loop`.

## Modes

- `brownfield`: inspect an existing project and fill coverage from discovered behavior.
- `reference`: inspect a reference project and translate product logic into the current project's requirements, specs, and tasks.
- `requirement`: keep interviewing and refining a requirement until it has enough scope, constraints, flows, risks, acceptance criteria, and executable tasks.

## Auto Mode Selection

Choose the mode for the user:

- Choose `reference` when the user provides a GitHub repo, local reference path, or says 复刻 / 对标 / 参考 / clone / parity.
- Choose `brownfield` when the target is an existing local project and the user asks to 深度补全 / 全面梳理 / 扫描 / 完善.
- Choose `requirement` when the input is mainly an idea, vague request, product requirement, or feature concept without a separate reference project.

If the intent is mixed, prefer `reference` when a reference project exists; otherwise prefer `brownfield` when local code exists; otherwise use `requirement`.

## Before You Act

1. Read the shared OpenPrd guardrails from the first available path:
   - `skills/openprd-shared/SKILL.md`
   - `$HOME/.claude/skills/openprd-shared/SKILL.md`
   - `$HOME/.codex/skills/openprd-shared/SKILL.md`
2. Run or inspect `openprd status` and `openprd next` unless the user only asked for an explanation.
3. For hook-stable execution, run:
   - `openprd run <path> --context`
   - Execute the recommended task, discovery, or workflow command.
   - `openprd run <path> --verify`
4. If `.openprd/discovery/current.json` is missing, initialize a run with the selected mode:
   - `openprd discovery <path>`
   - `openprd discovery <path> --mode reference --reference <path>`
   - `openprd discovery <path> --mode requirement`
5. If a run already exists, resume it:
   - `openprd discovery <path> --resume`
6. After each coverage pass, advance or verify the run:
   - `openprd discovery <path> --advance --item <id> --claim <text> --evidence <path>`
   - `openprd discovery <path> --advance --item <id> --status blocked --notes <text>`
   - `openprd discovery <path> --verify`
7. When the PRD should become concrete change files, run:
   - `openprd change <path> --generate --change <id>`
8. Use `openprd change <path> --validate --change <id>` only when you need isolated change-structure validation; normal discovery verification includes it when `activeChange` is configured.
9. Use `openprd standards <path> --verify` before reporting discovered work as ready.
10. Rebuild state from the active run directory before changing docs or tasks.

## Run Directory

Each run writes:

- `control.json`: active mode, iteration, budget, source root, and next action.
- `context.md`: compact state summary for the next pass.
- `source-inventory.json`: indexed project or reference files.
- `coverage-matrix.json`: pending, covered, and blocked coverage items.
- `claims.jsonl`: evidence-backed requirement claims.
- `open-questions.md`: unresolved questions that should stay visible.
- `iterations.jsonl`: append-only record of each pass.

The hook harness also writes:

- `.openprd/harness/run-state.json`: the current loop summary and last recommendation.
- `.openprd/harness/iterations.jsonl`: hook turn records, gate outcomes, and run verifications.
- `.openprd/harness/learnings.md`: reusable learnings that should survive fresh contexts.

The current storage path is `.openprd/discovery`. Legacy `.openspec/discovery` state may still be read for older projects, but new work should write OpenPrd-owned discovery state.

## Working Loop

1. Pick the next pending item from `coverage-matrix.json`.
2. Gather local evidence before writing a new claim.
3. Update docs or tasks only with confirmed or evidence-backed material.
4. Record every new fact in `claims.jsonl` with source and confidence.
5. Mark coverage items as covered, pending, or blocked.
6. Append the pass summary to `iterations.jsonl`.
7. Stop only when coverage is exhausted, blocked, or the iteration budget is reached.

## Task Sharding

Large changes must stay easy for an agent to read and resume.

- Keep `tasks.md` as the first and canonical task entry.
- Limit each task file to at most 25 substantive checkbox tasks.
- A project may set a stricter limit in `.openprd/discovery/config.json` with `taskSharding.maxItemsPerFile`.
- If more tasks are needed, continue with `tasks-002.md`, `tasks-003.md`, and so on in the same change directory.
- The final checkbox in every non-final task file must hand off to the next task file, for example:
  - `[ ] Continue with tasks-002.md after completing this file.`
- Keep related sections together when possible; do not split a tightly coupled feature just to hit an exact number.
- For stable long-running tasks, use only `deps`, `done`, and `verify` metadata:
  - `[ ] T009.07 Port legacy database import preview`
  - `  - deps: T001.14, T007.06`
  - `  - done: preview shows counts, conflicts, skipped items, warnings`
  - `  - verify: npm run test -- migration`
- Omit `deps` when there are no dependencies; keep source evidence in discovery claims and coverage files.
- Run `openprd discovery <path> --verify` before reporting the discovery state as healthy. It validates discovery state, active change structure, spec deltas, `docs/basic/` standards, task sharding, and structured task dependencies.

## CLI Advancement

- Use `--advance` after one coverage item has been investigated.
- Use `--claim` for the discovered requirement, behavior, rule, or acceptance criterion.
- Use `--evidence` when the claim comes from a file.
- Use `--status blocked --notes ...` when the item cannot be resolved yet.
- Use `--verify` before reporting a run as healthy or ready for review.

## Task Execution

- Use `openprd tasks <path> --change <id>` to list progress and the next dependency-ready task.
- Use `openprd tasks <path> --change <id> --advance --verify --item <task-id>` when a task is ready to complete through its `verify` command.
- Use `openprd change <path> --apply --change <id>` to promote completed change specs into `openprd/specs`.
- Use `openprd change <path> --archive --change <id>` to move completed change files into `openprd/archive/changes`.
- Use `openprd standards <path> --verify` when a task or discovery pass changes baseline docs, file manuals, or folder README docs.
- If a task is blocked by dependencies, complete the earlier task ids first; do not manually bypass the dependency order.
- Keep execution evidence in generated task events or discovery claims, not as extra metadata under every task.

## Evidence Rules

- Claims from code, tests, schemas, or docs should include a source file path.
- Claims inferred by the agent should be marked as inferred and kept reviewable.
- User-confirmed answers should be preserved as user-confirmed claims.
- Do not silently convert unresolved questions into requirements.

## Safe Defaults

- Prefer small, high-confidence updates over large speculative rewrites.
- Keep coverage gaps visible when evidence is thin.
- For reference projects, describe behavior and acceptance criteria instead of copying implementation details.
- When the next action needs user judgment, add it to `open-questions.md` and report the blocker.
- Use `docs/basic/` as the only project baseline docs path.
