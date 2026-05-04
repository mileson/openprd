---
name: openprd-harness
description: Drive an OpenPrd workspace through the main lifecycle from clarification to handoff. Use when Codex needs to initialize an OpenPrd workspace, inspect `.openprd/` state, choose the next command, move a product requirement through classify/interview/synthesize/freeze/handoff, or explain how an OpenPrd workspace should be advanced safely.
---

# OpenPrd Harness

## Overview

Use this skill to operate the main OpenPrd workflow. Treat it as the domain skill that sequences commands and artifacts, while `$openprd-shared` provides the common guardrails.

## Before You Act

1. Read the first available shared rules file: `skills/openprd-shared/SKILL.md`, `$HOME/.claude/skills/openprd-shared/SKILL.md`, or `$HOME/.codex/skills/openprd-shared/SKILL.md`.
2. Rebuild current workspace state from `.openprd/`.
3. If the user expects automatic agent guidance, use `openprd doctor <path>` and repair with `openprd setup <path>` or `openprd update <path>`.
4. Prefer `openprd run <path> --context` before choosing an execution unit.
5. Use `openprd status` and `openprd next` when you need full workflow detail.
6. If the user asks for baseline docs, file manuals, folder README standards, or implementation readiness, route to `$openprd-standards`.
7. If the user asks for a visual explanation or the system/product shape is unclear, route to `$openprd-diagram-review` before freeze.
8. Read `.openprd/harness/drift-report.json` when `doctor` reports generated guidance drift.

## Main Workflow

### 1. Initialize or locate the workspace

- If `.openprd/` does not exist, use:
  - `openprd init <path> --template-pack <base|consumer|b2b|agent>`
- Standards and agent integration are created during init. This includes Codex, Claude, Cursor generated guidance, project Codex hooks, and the user-level Codex hooks feature flag.
- If standards are missing or the user asks to repair them, use:
  - `openprd standards <path> --init`
- If generated agent guidance or hooks are missing, use:
  - `openprd setup <path>`
  - `openprd doctor <path>`
- If generated guidance exists but has drifted, use:
  - `openprd update <path>`
  - `openprd doctor <path>`
- For hook-driven execution loops, use:
  - `openprd run <path> --context`
  - `openprd run <path> --verify`
  - Keep `.openprd/harness/run-state.json`, `iterations.jsonl`, and `learnings.md` as durable loop state.
- For historical project fleets, audit before mutating:
  - `openprd fleet <root> --dry-run`
  - `openprd fleet <root> --update-openprd`
  - Do not use `--setup-missing` unless the user explicitly wants agent-only/plain projects to be claimed by OpenPrd.
- If it exists, inspect it before mutating anything.
- After initialization, do not jump straight to synthesis. Prefer explicit clarification first.

### 2. Clarify with the user

- Use:
  - `openprd clarify <path>`
- Ask the user the returned questions directly when critical product facts are still missing.
- After receiving answers, write them back with:
  - `openprd capture <path> --field <section.path> --value <text|json>`
- Use `--append` for list-like fields when you are adding more items instead of replacing the whole field.

### 3. Lock the product type

- If `productType` is missing, run:
  - `openprd classify <path> <consumer|b2b|agent>`

### 4. Load clarification prompts

- If required fields are missing, use:
  - `openprd interview <path> --product-type <type>`
- Keep unresolved issues visible instead of pretending the intake is complete.

### 5. Generate a reviewable draft

- Use:
  - `openprd synthesize <path> --title ... --owner ... --problem ... --why-now ...`
- Explain what is still missing if the draft is sparse.

### 6. Create a visual review artifact when needed

- Route to `$openprd-diagram-review` if the user needs:
  - architecture confirmation
  - flow/journey confirmation
  - a visual review before freeze

### 7. Freeze only when the draft is ready

- Use:
  - `openprd freeze <path>`
- Freeze is a gate, not just another render step.
- Before reporting implementation readiness, verify standards:
  - `openprd standards <path> --verify`
- Before high-risk actions, verify the full harness:
  - `openprd run <path> --verify`
  - `openprd doctor <path>`

### 8. Export the handoff bundle

- Use:
  - `openprd handoff <path> --target openprd`

## Safe Defaults

- Prefer `openprd next` when there is ambiguity about the next action.
- Prefer `openprd run --context` when the task is part of an execution loop.
- Prefer `openprd doctor` when the agent environment may not be following OpenPrd automatically.
- Prefer repairing drift with `openprd update` instead of manually editing generated adapter files.
- Prefer review before freeze when the shape of the solution is still unclear.
- Prefer exposing blockers over silently resolving them.

## Forbidden Behaviors

- Do not invent missing commands.
- Do not freeze just because the CLI technically allows it if the user still needs to confirm the proposed structure.
- Do not handoff a workspace the user has not reviewed when a diagram or draft review is clearly warranted.
- Use `docs/basic/` as the only project baseline docs path.
- Do not ask users to remember specific skills when `openprd setup`, generated rules, and hooks can lead the agent.

## Read These References When Needed

- `references/command-map.md` for command-by-command intent
- `references/workflow-gates.md` for gate decisions and readiness rules
- `references/examples.md` for concrete usage patterns
- `references/usage-guide.md` for the team/agent usage guide covering clarify, diagram, freeze, status/next, and batch capture
