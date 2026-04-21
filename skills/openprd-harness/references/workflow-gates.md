# OpenPrd Workflow Gates

## Clarification Gate

Do not synthesize with false confidence. Surface gaps first.

Scenario-aware expectations:

- `cold-start-greenfield`: high user collaboration before structure is locked
- `cold-start-existing-project`: reuse existing repo context, but still ask the user to confirm the new workspace boundary
- `continuing-workspace`: ask only targeted delta questions

Examples:

- problem statement still vague
- primary user unclear
- success metric missing
- scope not explicit

## Diagram Gate

Route to diagram review before freeze if:

- architecture still needs confirmation
- user flow still needs confirmation
- dependencies or boundaries are important to approval
- the user explicitly asks for a diagram, flow, or visual explanation

## Freeze Gate

Freeze is appropriate when:

- the synthesized draft exists
- the user has reviewed the latest critical artifact(s)
- there are no blockers hidden behind assumptions that should be reviewed first

## Handoff Gate

Handoff is appropriate when:

- freeze succeeded
- target system is known
- the user is ready to move from planning into execution transfer
