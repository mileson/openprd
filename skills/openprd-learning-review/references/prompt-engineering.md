# Style Prompt Engineering

The learning review generator uses prompt packs to move from neutral facts to styled reading content.

## Principle

Facts do not move. Style moves around them.

The Agent must preserve:

- `schema`
- `packageId`
- `sourceScope`
- evidence ids
- file paths
- digests
- command names
- OpenPrd terms

The Agent may rewrite:

- title
- subtitle
- outline labels
- chapter titles
- chapter summaries
- chapter `visualExplainer`
- paragraphs
- retrieval prompts
- worked-example framing

## Prompt Pack Shape

Each style pack should define:

- `id`
- `label`
- `concept`
- `titlePatterns`
- `outlineArc`
- `imageryBank`
- `sentenceRhythm`
- `taboo`
- `systemPrompt`
- `titlePrompt`
- `outlinePrompt`
- `chapterPrompt`
- `proseRewritePrompt`
- `evidenceBindingPrompt`
- `qualityReviewPrompt`

## Agent-In-The-Loop Steps

1. Read `evidence-manifest.json`.
2. Read the neutral `learning-content.json`.
3. Load the selected prompt pack by `genre.style`.
4. Use `titlePrompt` to create a book-like title and subtitle.
5. Use `outlinePrompt` to build a three-level outline at most, but keep retrieval questions in the body rather than the outline.
6. Use `chapterPrompt` and `proseRewritePrompt` to migrate each chapter into the style, and create `visualExplainer` cards when they help non-technical readers.
7. Use `evidenceBindingPrompt` to preserve every source anchor.
8. Use `qualityReviewPrompt` to check style fit and fact drift.
9. Render `reader.html` only after the quality checks pass.

## Quality Bar

- The result should feel like a readable book, not a decorated report.
- The outline should support scanning before reading.
- The style should be visible in title, outline, rhythm, and paragraph movement.
- If visual explainers are used, they should reduce understanding cost instead of restating the chapter mechanically.
- Every important claim should still point back to evidence.
- Evidence should be available but should not dominate the reading surface.
