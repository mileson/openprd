# Example Requests

## Example 1

User:

> 用 OpenPrd 帮我把这个 AI 教学产品从需求澄清推进到可以 handoff 的状态。

Expected routing:

- use `openprd status`
- use `openprd next`
- continue through classify/interview/synthesize
- route to `$openprd-diagram-review` before freeze if the structure is still unclear

## Example 2

User:

> 这个工作区现在应该先 freeze 还是先补图？

Expected routing:

- inspect current state
- inspect next/blockers
- if system shape still needs confirmation, recommend diagram review first
