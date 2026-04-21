---
name: openprd-harness
description: Drive an OpenPrd workspace through the main lifecycle from clarification to handoff. Use when Codex needs to initialize an OpenPrd workspace, inspect `.openprd/` state, choose the next command, move a product requirement through classify/interview/synthesize/freeze/handoff, or explain how an OpenPrd workspace should be advanced safely.
---

# OpenPrd Harness

## Overview

Use this skill to operate the main OpenPrd workflow. Treat it as the domain skill that sequences commands and artifacts, while `$openprd-shared` provides the common guardrails.

## Before You Act

1. Read `/Users/mileson/.codex/skills/openprd-shared/SKILL.md`.
2. Rebuild current workspace state from `.openprd/`.
3. Prefer `openprd status` and `openprd next` before making assumptions.
4. If the user asks for a visual explanation or the system/product shape is unclear, route to `$openprd-diagram-review` before freeze.

## Main Workflow

### 1. Initialize or locate the workspace

- If `.openprd/` does not exist, use:
  - `openprd init <path> --template-pack <base|consumer|b2b|agent>`
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

### 8. Export the handoff bundle

- Use:
  - `openprd handoff <path> --target openspec`

## Safe Defaults

- Prefer `openprd next` when there is ambiguity about the next action.
- Prefer review before freeze when the shape of the solution is still unclear.
- Prefer exposing blockers over silently resolving them.

## Forbidden Behaviors

- Do not invent missing commands.
- Do not freeze just because the CLI technically allows it if the user still needs to confirm the proposed structure.
- Do not handoff a workspace the user has not reviewed when a diagram or draft review is clearly warranted.

## Read These References When Needed

- `references/command-map.md` for command-by-command intent
- `references/workflow-gates.md` for gate decisions and readiness rules
- `references/examples.md` for concrete usage patterns
- `references/usage-guide.md` for the team/agent usage guide covering clarify, diagram, freeze, status/next, and batch capture
