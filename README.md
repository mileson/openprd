# OpenPrd

OpenPrd is an AI-native PRD workspace and lifecycle CLI.

It now also ships agent-facing skills inside the repository under `skills/`, so the harness rules can travel with the tool instead of living only in a local Codex home.

## What it does

- `openprd init` seeds a `.openprd/` workspace in any project.
- `openprd clarify` lists the key questions that must be confirmed with the user before pushing the workspace forward.
- `openprd capture` writes clarification answers back into the workspace state, either one field at a time or from a JSON answer bundle.
- `openprd classify` sets the active product type.
- `openprd interview` loads the discovery prompts for the active product type.
- `openprd next` recommends the next action and the next questions.
- `openprd status` now surfaces the current gate, upcoming gate, scenario, and expected user participation mode.
- `openprd synthesize` generates a versioned PRD snapshot.
- `openprd diagram` generates a reviewable diagram artifact for `architecture` or `product-flow`, can open it in the browser, can render from an explicit contract JSON, and can update review status.
- `openprd diff` compares PRD versions.
- `openprd history` lists PRD versions.
- `openprd validate` checks the canonical schema, templates, and starter engagement.
- `openprd freeze` creates a validated snapshot.
- `openprd handoff` exports a structured bundle for downstream execution systems.

## Quick start

```bash
npm install
node ./bin/openprd.js init /path/to/project --template-pack consumer
node ./bin/openprd.js validate /path/to/project
node ./bin/openprd.js freeze /path/to/project
node ./bin/openprd.js handoff /path/to/project --target openspec
```

## Workspace layout

```text
.openprd/
├── config.yaml
├── schema/
├── templates/
├── engagements/
├── state/
└── exports/
```

The active engagement now also keeps `decision-log.md`, `open-questions.md`, `progress.md`, `verification.md`, `state/task-graph.json`, and `state/events.jsonl` as durable execution records.

## Embedded agent skills

OpenPrd ships a repo-local `skills/` directory modeled after the `lark-shared + domain skills` pattern used by `larksuite/cli`:

- `skills/openprd-shared/` - shared guardrails and language/review rules
- `skills/openprd-harness/` - main OpenPrd workflow sequencing
- `skills/openprd-diagram-review/` - diagram generation and review loop guidance

These skills are intended for agents using OpenPrd as a harness, so the operational contract ships with the tool.

The repository also includes a top-level `AGENTS.md` that routes agents to these repo-local skills before they mutate the workspace.

OpenPrd also ships diagram schema and template files under `.openprd/schema/` and `.openprd/templates/diagram/` so multi-agent workflows can produce contract-driven visual artifacts with tool-level validation.
