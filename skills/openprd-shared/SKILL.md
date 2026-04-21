---
name: openprd-shared
description: Shared guardrails for operating OpenPrd workspaces and artifacts. Use whenever Codex needs to inspect, update, or advance an OpenPrd workspace, including classify/interview/synthesize/diagram/freeze/handoff flows, diagram review, or interpretation of `.openprd/` state files. Provides common rules for language-following output, safe defaults, confirmation gates, and command selection.
---

# OpenPrd Shared

## Overview

Use this skill as the shared rulebook for all OpenPrd work. It plays the same role that `lark-shared` plays in `larksuite/cli`: put cross-cutting rules in one place, keep domain skills smaller, and make agent behavior predictable.

## Shared Operating Rules

1. Rebuild context from the workspace before acting.
   - Prefer reading `.openprd/state/current.json`, `.openprd/state/task-graph.json`, latest version snapshots, and active engagement files over relying on chat history.
2. Distinguish read-only commands from mutating commands.
   - Read-only: `status`, `validate`, `next`, `history`, `diff`, `interview`
   - Mutating: `init`, `classify`, `synthesize`, `diagram`, `freeze`, `handoff`
3. Never invent OpenPrd commands or artifact types.
   - Confirm against `openprd --help` if unsure.
4. Keep shared rules here and domain-specific rules in the relevant skill.
   - Workflow sequencing belongs in `$openprd-harness`.
   - Diagram generation and review belongs in `$openprd-diagram-review`.
5. Follow the user’s language in all user-facing artifacts.
   - Labels, review notes, summary cards, and instructions should follow the user’s current primary language.
   - Keep proper nouns, product names, protocols, API names, framework names, and cloud product names unchanged when translation would be harmful.
6. Prefer explicit uncertainty over silent filling.
   - Missing assumptions, scope gaps, and unresolved questions should remain visible as open questions or review notes.
7. Treat freeze and handoff as gated actions.
   - Do not claim readiness if the workspace still has blocking uncertainty that should be surfaced to the user.
8. Prefer graph/state reasoning over freeform narration.
   - Use `nextReadyNode`, blockers, active artifacts, and validation status to justify the next step.
9. When critical product facts are missing, ask the user before pushing the workspace forward.
   - If the current mode cannot use a structured ask-user tool, ask directly in plain language.
   - Do not treat “tool unavailable” as permission to silently guess.

## Shared Confirmation Rules

- Ask for user confirmation before freeze when the system shape, product flow, or external dependencies are still materially uncertain.
- Ask for user confirmation before handoff when the user has not yet seen the latest synthesized or visualized artifact.
- If the user asks for a visual explanation, route to `$openprd-diagram-review`.

## Shared Routing Rules

- Need to move the workspace through the main lifecycle? Use `$openprd-harness`.
- Need an architecture diagram, product flow diagram, user journey, or visual confirmation loop? Use `$openprd-diagram-review`.
- Need deeper details on language handling or command categories? Read:
  - `references/operating-rules.md`
  - `references/language-and-review.md`
  - `references/skill-architecture.md`
