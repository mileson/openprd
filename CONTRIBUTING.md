# Contributing

Thanks for considering a contribution to OpenPrd.

## Development Setup

```bash
npm install
npm test
```

## Core Principles

- Keep OpenPrd lightweight and avoid premature workflow complexity.
- Prefer clarification, review gates, and durable artifacts over hidden assumptions.
- Keep agent-facing behavior in `skills/` and repository-level guidance in `AGENTS.md`.
- Avoid inventing commands or expanding the workflow unless a real usage pattern justifies it.

## Before Opening a PR

Please make sure:

- tests pass with `npm test`
- new CLI behavior is covered by tests
- README or skill references are updated when user-facing behavior changes
- sensitive values are not committed

## Scope Guidance

OpenPrd is a PRD harness, not a full project management platform. Contributions that add heavy orchestration or premature complexity may be declined even if technically correct.
