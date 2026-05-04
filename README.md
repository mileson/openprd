# OpenPrd

[简体中文](./README_CN.md) | English

> AI-native PRD workspace and lifecycle CLI for requirement clarification, review gates, diagram confirmation, and handoff.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.19.0-339933.svg)](https://nodejs.org/)
[![GitHub stars](https://img.shields.io/github/stars/mileson/openprd?style=social)](https://github.com/mileson/openprd)

OpenPrd is a lightweight **PRD harness** for teams and agents that need more than “write a document”. It gives you a local workspace, a clarification-first workflow, explicit review gates, diagram artifacts, and a structured change/spec/task workflow.

![OpenPrd diagram demo](./docs/assets/openprd-diagram-demo.png)

## Why OpenPrd

OpenPrd is designed for the gap between:

- vague product ideas that need clarification
- agent-assisted requirement drafting
- human confirmation before implementation
- structured handoff into execution systems

It is especially useful when you want:

- **clarify before drafting** instead of jumping straight to implementation
- **source-aware capture** so user-confirmed facts stay separate from repo-derived or agent-inferred context
- **diagram review gates** before freezing a requirement set
- **agent-facing skills** shipped with the tool, not hidden in a local environment

## Features

- **Clarification-first workflow**: `clarify -> capture -> classify -> interview -> synthesize -> diagram -> freeze -> handoff`
- **Scenario-aware collaboration**: distinguish greenfield cold start, existing-project cold start, and continuing workspaces
- **Source-aware capture**: mark inputs as `user-confirmed`, `project-derived`, or `agent-inferred`
- **Visual review artifacts**: generate both architecture and product-flow diagrams
- **Contract-driven diagrams**: render from validated JSON contracts
- **Review status tracking**: use `pending-confirmation`, `confirmed`, and `needs-revision`
- **OpenPrd discovery mode**: initialize durable coverage runs for existing projects, reference projects, or unclear requirements
- **Project standards**: initialize and verify `docs/basic/`, file manual templates, and folder README templates as part of execution quality gates
- **OpenPrd change and task execution**: materialize PRD snapshots into change files, validate them, apply accepted specs, archive changes, and advance structured tasks by dependency order
- **Long-running agent loop**: turn accepted change tasks into one-task-per-session Codex or Claude execution prompts with verification, progress logs, and optional task commits
- **Default agent integration**: generate Codex, Claude, and Cursor guidance from one OpenPrd source, including Codex hooks with `codex_hooks = true`
- **Agent harness skills**: repo-local skills for shared rules, workflow control, and diagram review

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20+ |
| CLI | Native Node ESM |
| Config / state | JSON + YAML |
| Diagram renderer | Self-contained HTML + inline SVG |
| Testing | `node --test` |
| Agent guidance | Repo-local `skills/` + `AGENTS.md` + Codex / Claude / Cursor generated adapters |

## One-line Install

Install directly from GitHub:

```bash
npm install -g git+https://github.com/mileson/openprd.git
```

Then verify:

```bash
openprd --help
```

## Quick Start

### 1. Initialize a workspace

```bash
openprd init /path/to/project --template-pack agent
```

`init` creates `.openprd/`, `docs/basic/`, `AGENTS.md`, and generated Codex / Claude / Cursor guidance. Codex projects also get `.codex/config.toml`, `.codex/hooks.json`, `.codex/hooks/openprd-hook.mjs`, and user-level Codex `codex_hooks = true`.

### 2. Check the current collaboration state

```bash
openprd status /path/to/project
openprd next /path/to/project
```

### 3. Clarify with the user

```bash
openprd clarify /path/to/project
```

### 4. Capture answers back into the workspace

Single field:

```bash
openprd capture /path/to/project \
  --field problem.problemStatement \
  --value "Mobile users cannot efficiently manage agent sessions on the go" \
  --source user-confirmed
```

Batch capture:

```bash
openprd capture /path/to/project --json-file answers.json
```

### 5. Draft and review

```bash
openprd synthesize /path/to/project \
  --title "Moticlaw Mobile" \
  --owner "Moticlaw" \
  --problem "Mobile users lack a direct-first client for node selection and agent interaction." \
  --why-now "The control plane already exists and the missing piece is a mobile entry point."

openprd diagram /path/to/project --type architecture --open
openprd diagram /path/to/project --type product-flow --open
```

### 6. Freeze and handoff

```bash
openprd freeze /path/to/project
openprd handoff /path/to/project --target openprd
```

### 7. Start OpenPrd discovery mode

Users can ask in natural language:

```text
Use OpenPrd to deeply complete this project.
Use OpenPrd to comprehensively mine this reference project into the new project.
Keep digging into this requirement until OpenPrd coverage is complete.
```

Agents route those requests internally. The underlying command is:

```bash
openprd discovery /path/to/project --mode brownfield
openprd discovery /path/to/project --resume
openprd discovery /path/to/project --advance --claim "Users can start a session from the dashboard" --evidence src/app.ts
openprd discovery /path/to/project --verify
openprd change /path/to/project --generate --change <change-id>
openprd change /path/to/project --validate --change <change-id>
openprd standards /path/to/project --verify
openprd tasks /path/to/project --change <change-id>
openprd tasks /path/to/project --change <change-id> --advance --verify --item T001.01
openprd change /path/to/project --apply --change <change-id>
openprd change /path/to/project --archive --change <change-id>
openprd specs /path/to/project
openprd changes /path/to/project
```

Discovery verification also checks the active OpenPrd change structure, spec deltas,
`docs/basic/` standards, and long-running task files. Keep `tasks.md` as the first
entry, cap each task file at 25 substantive checkbox tasks, and continue with
`tasks-002.md`, `tasks-003.md`, etc. The final checkbox in every non-final file
should hand off to the next file so agents can resume in order. A project can use
a stricter local cap with `.openprd/discovery/config.json` at
`taskSharding.maxItemsPerFile`.

When a task needs a stable id for long-running execution, keep the metadata small:

```md
- [ ] T009.07 Port legacy database import preview
  - deps: T001.14, T007.06
  - done: preview shows counts, conflicts, skipped items, warnings
  - verify: npm run test -- migration
```

Use `deps` only when the task depends on earlier task ids. `done` is the completion
condition, and `verify` is the command or review step that proves it.

`tasks` lists the next dependency-ready task by default. `--advance` marks
one task complete, and `--verify` runs that task's `verify` command before marking
it complete. Execution events are stored outside the task files so the task metadata
stays small.

## Project Standards

`openprd init` creates a project standards contract:

- `docs/basic/file-structure.md`
- `docs/basic/app-flow.md`
- `docs/basic/prd.md`
- `docs/basic/frontend-guidelines.md`
- `docs/basic/backend-structure.md`
- `docs/basic/tech-stack.md`
- `.openprd/standards/file-manual-template.md`
- `.openprd/standards/folder-readme-template.md`

Use:

```bash
openprd standards /path/to/project --verify
```

OpenPrd generated changes include standards maintenance tasks, and change validation
checks the standards contract. The canonical project docs path is only
`docs/basic/`.

## Agent Setup

OpenPrd can install the project harness into the agent environment so users do not
need to remember which skill, command, or hook to invoke:

```bash
openprd setup /path/to/project
openprd doctor /path/to/project
openprd update /path/to/project
openprd fleet /path/to/projects --dry-run
openprd run /path/to/project --context
openprd run /path/to/project --verify
openprd loop /path/to/project --plan --change <change-id>
openprd loop /path/to/project --run --agent codex --dry-run
```

Installing the CLI alone does not mutate a project or user config. The full
Codex/Claude/Cursor adapter set is installed when the user runs `openprd init`
or `openprd setup` inside a project.

`setup` and `init` generate:

- `AGENTS.md` managed OpenPrd rules
- `.codex/skills/`, `.codex/prompts/`, `.codex/config.toml`, `.codex/hooks.json`, and `.codex/hooks/openprd-hook.mjs`
- user-level Codex config with `features.codex_hooks = true`
- `.claude/skills/`, `.claude/commands/openprd/`, and `CLAUDE.md`
- `.cursor/rules/openprd.mdc` and `.cursor/commands/`
- `.openprd/harness/install-manifest.json`, `hook-state.json`, `events.jsonl`, and `drift-report.json`

`doctor` verifies that the generated rules, Codex hooks feature flag, standards,
and workspace validation are healthy. `update` refreshes the generated adapter
files from the canonical OpenPrd source while preserving unrelated user hook
groups.

The harness is stateful. Hooks append structured events, record risk decisions,
and check drift against the install manifest. High-risk actions such as freeze,
handoff, accepted spec apply/archive, commit, push, release, or publish are gated
by `openprd run . --verify`, which covers standards, workspace validation, active
change validation, and active discovery verification.

`openprd run . --context` is the Ralph-style loop surface for agents. It selects
the next executable unit from active change tasks, discovery coverage, or normal
OpenPrd workflow state, and records hook turns in `.openprd/harness/iterations.jsonl`.

### Long-Running Agent Loop

For implementation work that should behave like the harness pattern described by
Anthropic's long-running agent guidance, use `openprd loop`. The loop is stricter
than `run --context`: it creates a durable feature list, writes a single-task
prompt, starts a fresh Codex or Claude session for exactly one task, verifies the
task, and can commit that task before moving on.

```bash
openprd loop . --init
openprd loop . --plan --change <change-id>
openprd loop . --next
openprd loop . --prompt --agent codex
openprd loop . --run --agent codex --dry-run
openprd loop . --run --agent claude --dry-run
openprd loop . --verify --item T001.01
openprd loop . --finish --item T001.01 --commit --message "Complete T001.01"
```

The loop writes its durable state under `.openprd/harness/`:

- `feature-list.json` is the ordered implementation task list.
- `progress.md` is the human-readable progress log.
- `agent-sessions.jsonl` records each prompt/run/finish event.
- `bootstrap.sh` is the startup check each fresh agent session runs.
- `loop-state.json` stores the current task and last agent session.
- `loop-prompts/` stores generated single-task prompts for audit and reuse.

Use `--dry-run` first when you want OpenPrd to prepare the prompt and exact command
without launching an agent. Use `--agent codex` or `--agent claude` for the default
CLI integrations. Use `--agent-command "<custom command>"` only when you want to
pipe the OpenPrd prompt into a project-specific wrapper.

For historical projects, use `fleet` instead of hand-writing shell loops. By
default it scans and reports only. `--update-openprd` refreshes projects that
already contain `.openprd/`, while agent-only or plain projects stay untouched
unless explicitly selected with `--setup-missing`.

## How to Read `status` and `next`

OpenPrd is not just a command runner. It exposes collaboration state.

### `openprd status`

Use it to understand:

- current scenario
- user participation mode
- current gate
- upcoming gate

Example signals:

- `Scenario: Cold start (existing project)`
- `User participation mode: context-plus-confirmation`
- `Current gate: clarify-user`
- `Upcoming gate: architecture diagram review`

### `openprd next`

Use it to understand:

- what should happen next
- why that step is recommended
- which questions should be asked now

## Diagram Contracts

OpenPrd supports:

- `architecture`
- `product-flow`

You can let the tool infer a draft from the current workspace, or supply an explicit contract:

```bash
openprd diagram /path/to/project \
  --type product-flow \
  --input ./product-flow-contract.json
```

The diagram contract is validated against built-in schema files in `.openprd/schema/`.

## Agent Skills

This repository ships a repo-local `skills/` directory modeled after the `lark-shared + domain skills` pattern used by `larksuite/cli`.

- `skills/openprd-shared/` — shared guardrails and language/review rules
- `skills/openprd-harness/` — main OpenPrd workflow sequencing
- `skills/openprd-standards/` — project docs, file manual, and folder README standards
- `skills/openprd-diagram-review/` — diagram generation and review loop guidance
- `skills/openprd-discovery-loop/` — sustained OpenPrd coverage discovery

Agents entering this repository should read:

- `AGENTS.md`

## Project Structure

```text
.
├── AGENTS.md
├── bin/
├── src/
├── skills/
├── test/
├── docs/
│   └── basic/
├── openprd/
│   ├── changes/
│   ├── specs/
│   └── archive/
└── .openprd/
    ├── schema/
    ├── templates/
    ├── engagements/
    ├── state/
    └── exports/
```

Key directories:

- `src/` — CLI logic, PRD core, diagram rendering
- `docs/basic/` — project-level baseline docs maintained by OpenPrd standards
- `skills/` — repo-local agent skill system
- `.openprd/` — shipped workspace seed
- `test/` — regression coverage for clarify / capture / diagram / gate logic

## Agent Prompt Examples

You can steer agents with prompts like:

```text
Use $openprd-harness to initialize and advance an OpenPrd workspace for this product idea.
```

```text
Use $openprd-diagram-review to generate a product-flow review artifact before freeze.
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security

See [SECURITY.md](./SECURITY.md).

## License

MIT — see [LICENSE](./LICENSE).

## Author

- X: [Mileson07](https://x.com/Mileson07)
- Xiaohongshu: [超级峰](https://xhslink.com/m/4LnJ9aB1f97)
- Douyin: [超级峰](https://v.douyin.com/rH645q7trd8/)
