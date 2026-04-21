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

## Tool Reality

The current CLI supports:

- `openprd clarify`
- `openprd capture`
- `openprd diagram --type architecture`
- `openprd diagram --type product-flow`

Do not invent commands or artifact types that are not implemented.

## Working Principles

1. Rebuild state from `.openprd/` before making workflow decisions.
2. Prefer `openprd status` and `openprd next` before mutating commands.
3. Ask the user for missing critical product facts before pushing the workspace forward; use `openprd clarify` to generate those questions and `openprd capture` to store the answers.
4. Prefer diagram review before freeze when the system or flow shape still needs confirmation.
5. Keep unresolved assumptions and open questions visible instead of silently resolving them.
