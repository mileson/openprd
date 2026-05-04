# OpenPrd Command Map

## Core Lifecycle

1. `openprd init`
2. `openprd clarify`
3. `openprd capture`
4. `openprd classify`
5. `openprd interview`
6. `openprd synthesize`
7. `openprd diagram`
8. `openprd freeze`
9. `openprd handoff`
10. `openprd change`
11. `openprd changes`
12. `openprd specs`
13. `openprd tasks`
14. `openprd discovery`
15. `openprd standards`
16. `openprd setup`
17. `openprd update`
18. `openprd doctor`
19. `openprd run`

## Read / Inspect

- `openprd status`
- `openprd validate`
- `openprd next`
- `openprd history`
- `openprd diff`
- `openprd standards --check`
- `openprd standards --verify`
- `openprd doctor`
- `openprd run --context`
- `openprd run --verify`

## Routing Heuristics

- no workspace -> `init`
- missing key user-confirmed facts -> `clarify`
- user answers available -> `capture`
- no product type -> `classify`
- missing required fields after clarification -> `interview`
- draft needed -> `synthesize`
- structure unclear or user asks for visuals -> diagram review
- ready and validated -> `freeze`
- execution transfer needed -> `handoff`
- PRD snapshot should become concrete OpenPrd change files -> `change --generate --change <id>`
- OpenPrd coverage needs sustained discovery -> `discovery`
- user says OpenPrd or OpenSpec plus 持续 / 深度 / 全面 / 复刻 / 对标 / 补全 -> route to OpenPrd discovery mode
- one coverage item has evidence -> `discovery --advance`
- discovery state needs a health check -> `discovery --verify`
- project baseline docs or manual standards need setup -> `standards --init`
- docs/basic, file manual, or folder README standards need checking -> `standards --verify`
- agent rules, commands, or hooks need installing -> `setup`
- generated rules or hooks may be stale -> `update`
- Codex/Claude/Cursor guidance health is uncertain -> `doctor`
- hook-driven execution unit is needed -> `run --context`
- hook-driven loop needs gate validation -> `run --verify`
- change structure needs isolated validation -> `change --validate --change <id>`
- accepted specs need promotion -> `change --apply --change <id>`
- completed change should be moved out of active work -> `change --archive --change <id>`
- multiple changes need inspection -> `changes`
- accepted baseline specs need inspection -> `specs`
- next implementation task is needed -> `tasks --change <id>`
- a structured task is ready to complete -> `tasks --change <id> --advance --verify --item <task-id>`
- tasks exceed 25 substantive checkbox items -> shard as `tasks.md`, `tasks-002.md`, `tasks-003.md`, then verify
- stable long-running tasks need metadata -> use only `deps`, `done`, and `verify`
