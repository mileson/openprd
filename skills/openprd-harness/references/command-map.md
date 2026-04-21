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

## Read / Inspect

- `openprd status`
- `openprd validate`
- `openprd next`
- `openprd history`
- `openprd diff`

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
