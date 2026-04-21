# OpenPrd

> AI-native PRD workspace and lifecycle CLI for requirement clarification, review gates, diagram confirmation, and handoff.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.19.0-339933.svg)](https://nodejs.org/)
[![GitHub stars](https://img.shields.io/github/stars/mileson/openprd?style=social)](https://github.com/mileson/openprd)

OpenPrd is a lightweight **PRD harness** for teams and agents that need more than “write a document”. It gives you a local workspace, a clarification-first workflow, explicit review gates, diagram artifacts, and a structured handoff package for downstream systems such as OpenSpec.

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
- **Agent harness skills**: repo-local skills for shared rules, workflow control, and diagram review

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20+ |
| CLI | Native Node ESM |
| Config / state | JSON + YAML |
| Diagram renderer | Self-contained HTML + inline SVG |
| Testing | `node --test` |
| Agent guidance | Repo-local `skills/` + `AGENTS.md` |

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
openprd handoff /path/to/project --target openspec
```

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
- `skills/openprd-diagram-review/` — diagram generation and review loop guidance

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
└── .openprd/
    ├── schema/
    ├── templates/
    ├── engagements/
    ├── state/
    └── exports/
```

Key directories:

- `src/` — CLI logic, PRD core, diagram rendering
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
