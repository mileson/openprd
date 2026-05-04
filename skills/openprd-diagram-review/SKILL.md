---
name: openprd-diagram-review
description: Generate and iterate OpenPrd diagram artifacts for user confirmation. Use when the user asks for an architecture diagram, product flow diagram, user journey, flowchart, system boundary view, dependency map, or a visual review before freeze. This skill chooses the right diagram contract, enforces language-following output, and turns the diagram into a confirmation loop instead of a one-shot render.
---

# OpenPrd Diagram Review

## Overview

Use this skill to decide what kind of diagram is needed, generate a diagram-ready contract, render what the current OpenPrd tool supports, and turn the result into a review loop with the user.

## Before You Act

1. Read `/Users/mileson/.codex/skills/openprd-shared/SKILL.md`.
2. Rebuild current workspace state and identify what the user is trying to confirm.
3. Decide whether the user needs:
   - an `architecture` view
   - a `product-flow` view
4. Do not invent OpenPrd commands that do not exist today.

## Diagram Type Selection

Choose `architecture` if the user is asking about:
- modules
- system boundaries
- services
- external dependencies
- reliability/compliance concerns
- handoff shape

Choose `product-flow` if the user is asking about:
- user steps
- decision points
- happy path / error path
- onboarding or journey flows
- screen-to-screen or step-to-step progression

If both are present:
- create the product-flow contract first when user behavior is still unclear
- create the architecture review after the flow is understandable

## Current Tool Reality

The current OpenPrd CLI exposes:
- `openprd diagram <path> [--open] [--json]`

This currently renders an architecture-oriented HTML/JSON artifact.

Therefore:
- for `architecture`, use the built-in command directly
- for `product-flow`, create a structured contract and a review checklist even if the renderer is not yet dedicated
- never claim a dedicated flow renderer exists if it does not

## Language Rules

- Follow the user's current primary language for all user-facing labels and review notes.
- Diagram contracts are user-facing. When `locale` is `zh-CN`, write visible text in Simplified Chinese:
  - `title`, `subtitle`
  - `components[].name`, `components[].subtitle`, `components[].details`
  - `flows[].label`
  - `summaryCards[].title`, `summaryCards[].items`
  - `sidePanels[].title`, `sidePanels[].items`
  - `reviewInstructions`
- Keep proper nouns, product names, protocol names, API names, framework names, and cloud service names unchanged when translation would reduce clarity.
- Keep necessary terms such as MotiClaw, Electron, TypeScript, CLI, API, JSON, NDJSON, dry-run, Host API, schema, and `waiting_approval` unchanged, but translate the surrounding sentence into Simplified Chinese.
- Do not write full English sentences in zh-CN diagram contracts. Before running `openprd diagram --input`, inspect the contract once and rewrite English-heavy visible text into Simplified Chinese.
- If the conversation language is mixed, prefer the dominant language of the latest requirement-clarification turns.

## Review Loop

After generating the artifact:

1. Show or open the diagram artifact.
2. Ask the user to confirm:
   - missing components or steps
   - wrong boundaries or swimlanes
   - missing dependencies or paths
   - missing error paths or sign-off points
3. Keep unresolved items visible as assumptions or open questions.
4. Recommend freeze only after the visual review has converged.

## Read These References When Needed

- `references/diagram-contracts.md` for architecture and product-flow contracts
- `references/review-checklist.md` for what to ask the user after rendering
- `references/cocoon-patterns.md` for reusable ideas borrowed from `Cocoon-AI/architecture-diagram-generator`
