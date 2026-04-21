# Skill Architecture for OpenPrd

## Why Split the Skills

Borrow the `lark-shared` pattern:

- `openprd-shared` = common rules
- `openprd-harness` = workflow sequencing
- `openprd-diagram-review` = visual artifact generation and confirmation

This avoids one oversized skill and keeps trigger logic precise.

## Shared vs Domain Rules

### Shared

- language-following output
- proper noun preservation
- read-only vs mutating command distinction
- freeze/handoff gate discipline
- workspace-first reasoning

### Harness

- lifecycle sequencing
- command choice
- handoff readiness
- clarification-first behavior across startup scenarios

### Diagram Review

- diagram type selection
- contract shaping
- review checklist
- artifact opening and user confirmation loop

## Startup Scenarios

OpenPrd should distinguish:

- `cold-start-greenfield`
- `cold-start-existing-project`
- `continuing-workspace`

The required degree of user participation is different in each case. Shared rules should enforce that distinction instead of letting the agent silently normalize all three into the same workflow.
