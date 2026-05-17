# Evidence Manifest

The manifest is the provenance layer. It tells future readers what is evidence, what is inference, and what still needs verification.

## Source Shape

Each source should include:

- `id`
- `title`
- `type`
- `groups`
- `path`
- `relativePath`
- `summary`
- `excerpt`
- `digest`
- `note`

## Claim Shape

Each claim should include:

- `id`
- `statement`
- `sourceIds`
- `confidence`
- `kind`

## Gap Shape

Each gap should include:

- `id`
- `description`
- `severity`

## Rules

- Never write a claim without source ids.
- Never hide inference inside a factual statement.
- Keep the digest stable so later packages can compare evidence lines.
- Prefer short excerpts that are enough to orient the reader, not full-file dumps.
- If a source is missing, record the gap instead of pretending the source exists.

## Suggested Source Priorities

1. `current-state`
2. `task-graph`
3. `verification`
4. `latest-loop-report`
5. `active-prd` and other active engagement docs
6. `docs/basic/*`
7. version snapshots

