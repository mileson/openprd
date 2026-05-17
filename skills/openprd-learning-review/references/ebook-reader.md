# HTML Ebook Reader

The reader is the fixed output shell. It should be stable enough that archived packages remain readable later.

## Layout

- left: book-like outline with chapter-level navigation and section nodes, but without individual retrieval-question entries
- center: chapter reader with one chapter shown at a time
- no persistent right evidence panel; evidence lives in archive files and chapter-level source anchors

## Required Controls

- previous chapter
- next chapter
- font size down
- font size up
- progress indicator

## Reader Behavior

- Use chapter paging for next/prev navigation and keep scrolling confined to the chapter body.
- Highlight the active chapter in the TOC.
- Keep source anchors available without competing with the text.
- Collapse into a single column on narrow screens.
- Open automatically when the package is created and auto-open is enabled.

## Visual Rules

- Use a calm, paper-like palette.
- Keep typography readable and avoid over-decorating the page.
- Do not let side panels compete with the text.
- Keep all text and controls stable across resize.

## Output Files

- `reader.html`
- `learning-content.json`
- `learning-content.md`
- `evidence-manifest.json`
- `learning-package.json`
- `.openprd/learning/index.json`
- `.openprd/learning/current.json`
