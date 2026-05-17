# Genre Reference Library

This library gives the outer voice and chapter shape. Detailed writing behavior belongs to style prompt packs.

## Registry

| id | label | Use When | Voice | Chapter Labels |
|---|---|---|---|---|
| `internet-product` | 互联网产品 | Default for code, CLI, workflow, and product systems | 清晰、务实、讲路径、讲状态、讲证据 | 问题地图 / 系统结构 / 证据链 / 工作示例 / 下一步动作 |
| `scientific` | 严肃科研 | When the user wants rigor, verification, or research framing | 严谨、可验证、重证据、重边界 | 研究问题 / 方法框架 / 证据链 / 复现实验 / 结论回收 |
| `fairy-tale` | 童话故事 | When the user wants gentle, memorable teaching prose | 温暖、清楚、带一点故事感 | 故事开头 / 旅程地图 / 线索与证据 / 角色示例 / 回家路上 |
| `web-novel` | 网文小说 | When the user wants stronger rhythm and chapter pacing | 节奏更强、推进更快、强调冲突和转折 | 开卷入局 / 结构铺陈 / 证据反转 / 范例拆招 / 收束留白 |
| `xianxia` | 仙侠修真 | When the user wants a cultivation-style metaphor | 带一点修炼感，但仍然要稳住事实和证据 | 筑基 / 观想 / 破境 / 传功 / 归元 |

## Prompt Pack Rule

Each genre can own multiple substyle prompt packs. For example:

- `xianxia.cultivation`: 修行札记
- `xianxia.sect-intrigue`: 宗门权谋，planned
- `xianxia.artifact-refining`: 炼器法门，planned

The CLI can select a substyle with `--style <id>`. If omitted, the genre default is used.

## Extension Rules

- Prefer one stable registry entry per genre.
- New genres should define:
  - `id`
  - `label`
  - `voice`
  - `chapterLabels`
  - `opening`
  - `closing`
- Keep the chapter labels human-readable and easy to scan.
- Never let the genre layer or style prompt pack overwrite evidence semantics.

## Selection Hints

- Use `internet-product` when the topic is a codebase, CLI, workflow, or project execution path.
- Use `scientific` when the user wants conceptual rigor or repeatability.
- Use `fairy-tale` when the user wants the material to feel gentle and easier to remember.
- Use `web-novel` or `xianxia` when the user explicitly asks for a more stylized narrative shell.
