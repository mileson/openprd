# OpenPrd Shared Operating Rules

## Command Categories

### Read-only

- `openprd status`
- `openprd validate`
- `openprd next`
- `openprd history`
- `openprd diff`
- `openprd interview`

Use these first when rebuilding context.

### Mutating

- `openprd init`
- `openprd classify`
- `openprd synthesize`
- `openprd diagram`
- `openprd freeze`
- `openprd handoff`

Use these only after understanding current state.

## Borrowed Pattern from `larksuite/cli`

OpenPrd should mirror the `lark-shared + domain skill` pattern:

- shared rules live in one place
- domain skills stay narrow
- safety guidance is written once
- scope/routing rules are explicit

## Workspace-First Reasoning

Prefer filesystem truth over conversational memory:

- `.openprd/state/current.json`
- `.openprd/state/task-graph.json`
- `.openprd/state/versions/*.json`
- `.openprd/engagements/active/*.md`

## Safe Defaults

- Use `openprd next` if unsure about the next command.
- Route to diagram review before freeze when structure still needs visual confirmation.
- Keep missing information visible.

## Do Not

- do not invent commands
- do not silently manufacture certainty
- do not skip a user review that the workflow clearly needs
