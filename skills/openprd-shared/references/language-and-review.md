# Language and Review Rules

## Language Following

User-facing artifact text should follow the user's current primary language.

Translate:

- titles
- subtitles
- section labels
- legend labels
- review instructions
- summary-card labels
- diagram contract visible fields, including component names, subtitles, details, flow labels, cards, panels, and review instructions

For `locale: zh-CN` diagram contracts, translate full sentences into Simplified Chinese and preserve only necessary product names, framework names, protocol names, command names, field keys, and file paths. Examples that may stay unchanged inside Chinese sentences: MotiClaw, Electron, TypeScript, CLI, API, JSON, NDJSON, dry-run, Host API, schema, `waiting_approval`.

Do not translate by default:

- product names
- project names
- service names
- framework names
- API names
- protocol names
- cloud product names

## Review Before Freeze

If the user still needs to confirm:

- system boundaries
- missing modules
- user-flow shape
- key dependencies
- review/sign-off behavior

prefer a visual review artifact before freeze.

## Open Questions Stay Visible

Do not hide:

- assumptions
- unresolved dependencies
- missing success criteria
- incomplete edge cases

These should remain visible in the artifact or review notes.
