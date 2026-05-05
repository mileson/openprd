# OpenPrd Agent Contract

This repository ships its own agent-facing skills under `/Users/mileson/Workspace/AI工作室/OpenPrd/skills/`.

If you are an agent working in this repository, prefer these repo-local skills over unrelated global heuristics.

## Skill Routing

### Always read first

- `/Users/mileson/Workspace/AI工作室/OpenPrd/skills/openprd-shared/SKILL.md`

Use it for shared guardrails:
- language-following output
- proper noun preservation
- read-only vs mutating command discipline
- freeze / handoff gate awareness
- workspace-first reasoning using `.openprd/`

### Main workflow

- `/Users/mileson/Workspace/AI工作室/OpenPrd/skills/openprd-harness/SKILL.md`

Use it when advancing the workspace through:
- `init`
- `classify`
- `interview`
- `synthesize`
- `diagram`
- `freeze`
- `handoff`

### Diagram and visual review

- `/Users/mileson/Workspace/AI工作室/OpenPrd/skills/openprd-diagram-review/SKILL.md`

Use it when the task needs:
- an architecture diagram
- a product flow diagram
- a user journey / flow confirmation artifact
- a visual review before freeze

### OpenPrd discovery mode

- `skills/openprd-discovery-loop/SKILL.md`

Use it when the task needs:
- deep completion of requirements, specs, and tasks for an existing project
- reference project behavior mining
- sustained requirement clarification and coverage tracking

Natural-language routing:
- If the user says OpenPrd or OpenSpec plus 持续 / 深度 / 全面 / 完整 / 穷尽 / 补全 / 复刻 / 对标 / 参考, route to `skills/openprd-discovery-loop/SKILL.md`.
- Do not require the user to mention a skill name.
- Choose the discovery mode internally from the user intent and available project/reference context.
- When tasks exceed 25 substantive checkbox items, shard them as `tasks.md`, `tasks-002.md`, `tasks-003.md`, etc. The final checkbox in each non-final file must hand off to the next file.
- For stable long-running tasks, use only `deps`, `done`, and `verify` metadata under ids like `T009.07`; keep source evidence in `.openprd/discovery` state files.
- Run `openprd discovery <path> --verify` after task sharding so the CLI can catch change-structure errors, oversized files, missing handoffs, task dependency gaps, and spec delta issues.
- Use `openprd change <path> --generate --change <id>` when a frozen or synthesized PRD needs to become concrete OpenPrd change files.
- Use `openprd tasks <path> --change <id>` to find the next dependency-ready task, then `openprd tasks <path> --change <id> --advance --verify --item <task-id>` to run its verify command and mark it complete.
- Use `openprd change <path> --apply --change <id>` to promote specs into the accepted baseline, then `openprd change <path> --archive --change <id>` to move completed work out of active changes.

### OpenPrd standards

- `skills/openprd-standards/SKILL.md`

Use it when the task needs:
- project baseline docs under `docs/basic/`
- file manual standards
- folder README standards
- standards verification before change readiness

Natural-language routing:
- If the user asks to establish, check, repair, or enforce project docs, file manuals, folder manuals, or standardization, route to `skills/openprd-standards/SKILL.md`.
- Use `openprd standards <path> --init` to create the standards contract.
- Use `openprd standards <path> --verify` before claiming implementation readiness when standards are in scope.
- The canonical project docs path is only `docs/basic/`.

### OpenPrd agent setup

Use setup/update/doctor when the task needs automatic agent guidance instead of asking users to invoke skills manually.

- `openprd init <path>` installs the default agent integration.
- `openprd setup <path>` installs or repairs OpenPrd guidance for Codex, Claude, and Cursor.
- `openprd update <path>` refreshes generated guidance files from the canonical OpenPrd source.
- `openprd doctor <path>` verifies generated rules, standards, workspace validation, and Codex hooks.
- `openprd run <path> --context` selects the next hook-stable execution unit.
- `openprd run <path> --verify` verifies the current run gates.
- `openprd fleet <root> --dry-run` audits historical projects before batch updates.
- `openprd fleet <root> --update-openprd` refreshes only projects that already contain `.openprd/`.
- Codex hooks are expected to be enabled through project `.codex/config.toml` and user Codex config with `codex_hooks = true`.
- `.openprd/harness/` stores the install manifest, hook state, hook event log, and drift report.
- Treat drift as a repairable gate: run `openprd update <path>`, then `openprd doctor <path>`.

## Tool Reality

The current CLI supports:

- `openprd clarify`
- `openprd capture`
- `openprd setup`
- `openprd update`
- `openprd doctor`
- `openprd run`
- `openprd diagram --type architecture`
- `openprd diagram --type product-flow`
- `openprd change`
- `openprd changes`
- `openprd specs`
- `openprd tasks`
- `openprd discovery`
- `openprd standards`

Do not invent commands or artifact types that are not implemented.

## Working Principles

1. Rebuild state from `.openprd/` before making workflow decisions.
2. Prefer `openprd status` and `openprd next` before mutating commands.
3. Ask the user for missing critical product facts before pushing the workspace forward; use `openprd clarify` to generate those questions and `openprd capture` to store the answers.
4. Prefer diagram review before freeze when the system or flow shape still needs confirmation.
5. Keep unresolved assumptions and open questions visible instead of silently resolving them.

<!-- OPENPRD:AGENTS:START -->
## OpenPrd Harness

This project is managed by OpenPrd. Agents should be led by the harness rather than by ad hoc user instructions.

### Default Behavior

1. Rebuild state from `.openprd/` before planning or changing files.
2. Run `openprd run . --context` before choosing the next execution unit, but treat it as advisory context rather than an automatic command.
3. Classify the current user intent before following any recommendation. For planning, analysis, architecture review, "how would we change this?", or "which files are involved?" requests, stay read-only and answer from evidence.
4. If the user asks for implementation, generate or inspect an OpenPrd change before coding when the work has product or architecture impact.
5. During implementation, perform a documentation impact check for every added or modified file: create missing `docs/basic/`, file manuals, or folder README docs, and update existing ones when the change affects responsibilities, flows, structure, dependencies, or product behavior.
6. Before claiming readiness, run `openprd standards . --verify` and `openprd run . --verify`.
7. Treat `.openprd/harness/` as the installed agent-control state: run state, iterations, events, hook state, install manifest, and drift report.
8. Codex hooks default to lite mode: only `UserPromptSubmit`, and only OpenPrd/deep-work prompts receive injected context. Use `--hook-profile guarded|full` only when a project explicitly needs per-tool gates.
9. For any OpenPrd diagram contract with `locale: zh-CN`, write visible labels, node text, flow labels, cards, panels, and review instructions in Simplified Chinese. Preserve only necessary proper nouns and technical field names.

### Canonical Commands

- `openprd next .` - choose the next harness action.
- `openprd run . --context` - choose the next hook-stable execution unit.
- `openprd run . --verify` - verify the current run gates.
- `openprd loop . --plan --change <id>` - build the one-task-per-session feature list.
- `openprd loop . --run --agent codex|claude --dry-run` - prepare a fresh single-task agent session.
- `openprd loop . --run --agent codex|claude` - execute only when the user explicitly asks for development, continuation, deep research/benchmarking, or replication.
- `openprd loop . --finish --item <task-id> --commit` - verify, write staged test report, mark done, and create the task commit only when commit is explicitly part of the requested execution.
- `openprd standards . --verify` - verify project documentation standards.
- `openprd change . --validate --change <id>` - verify change structure.
- `openprd discovery . --verify` - verify long-running discovery state.
- `openprd doctor .` - check agent integration health.
- `openprd update .` - repair generated agent guidance drift.
- `openprd update . --hook-profile lite|guarded|full` - choose Codex hook weight; default `lite` avoids per-tool hooks.
- `openprd fleet <root> --dry-run` - audit historical projects before batch updates.

`openprd setup` and `openprd update` also enable Codex hooks in the user Codex config when run from the CLI.

### High-Risk Gate

Before freeze, handoff, accepted spec apply/archive, commit, push, release, or publish, ensure `openprd standards . --verify`, `openprd run . --verify`, and `openprd doctor .` are healthy.

The only baseline documentation path is `docs/basic/`.
<!-- OPENPRD:AGENTS:END -->
