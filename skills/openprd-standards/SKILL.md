---
name: openprd-standards
description: Operate OpenPrd project standards for docs/basic baseline docs, file manual templates, folder README templates, and standards verification during change/spec/task execution. Use when Codex needs to initialize, check, repair, or explain OpenPrd standards.
---

# OpenPrd Standards

## Overview

Use this skill when the user asks OpenPrd to establish or maintain project documentation standards during requirement discovery, change generation, task execution, or release readiness.

OpenPrd standards own three things:

- project baseline docs under `docs/basic/`
- file manual rules through `.openprd/standards/file-manual-template.md`
- folder README rules through `.openprd/standards/folder-readme-template.md`

The canonical path is only `docs/basic/`.

## Before You Act

1. Read `skills/openprd-shared/SKILL.md`.
2. Rebuild workspace state from `.openprd/`.
3. Inspect standards before editing:
   - `openprd standards <path> --verify`
4. Initialize missing standards only when the user wants setup or the workspace is being initialized:
   - `openprd standards <path> --init`

## Required Baseline Docs

OpenPrd standards require:

- `docs/basic/file-structure.md`
- `docs/basic/app-flow.md`
- `docs/basic/prd.md`
- `docs/basic/frontend-guidelines.md`
- `docs/basic/backend-structure.md`
- `docs/basic/tech-stack.md`

## Execution Rules

- Run `openprd standards <path> --verify` before claiming a change is ready.
- Generated OpenPrd change tasks should include standards maintenance tasks.
- For every added or modified source file, perform a documentation impact check.
- If `docs/basic/`, a file manual, or a folder README is missing or still template-like, supplement it before claiming readiness.
- If the documentation already exists, review whether this change makes it stale and update it when responsibilities, flows, structure, dependencies, or product behavior changed.
- When a feature changes files, folders, flows, architecture, dependencies, or product logic, update the relevant `docs/basic/` document.
- When a feature changes code file responsibilities, update the file manual.
- When a feature changes folder responsibilities or file layout, update the folder README.
- If no documentation update is needed, report that the impact check was performed and why the existing docs remain accurate.

## Documentation Impact Check

Use this checklist during implementation:

- Added source file: add a file manual if it is missing and ensure the containing folder README exists.
- Modified source file: read the existing file manual when present; update it if the file responsibilities, inputs, outputs, dependencies, or maintenance rules changed.
- Added, moved, removed, or repurposed folder content: add or update the folder README so it reflects the current folder responsibility and file layout.
- Feature, flow, architecture, dependency, or product behavior changed: update the relevant `docs/basic/` document even when the file already exists.
- Missing standards contract: run `openprd standards <path> --init` only for workspace setup or explicit standards repair, then replace template content with project facts.

## Do Not

- Use `docs/basic/` as the only project baseline docs path.
- Do not silently pass standards verification if `docs/basic/` is missing.
- Do not mark documentation work complete just because the implementation tests pass.
