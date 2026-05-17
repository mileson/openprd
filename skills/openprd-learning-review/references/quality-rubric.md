# Quality Rubric

Use this rubric to decide whether a learning package is good enough to ship.

## Must Pass

- Every claim points to one or more source ids.
- The package has a stable archive path under `.openprd/learning/archive/`.
- The reader opens and navigates by chapter.
- The package includes retrieval blocks and worked examples.
- Retrieval questions stay in the body, not as separate TOC leaf items.
- The content contract is versioned.

## Should Pass

- The genre choice matches the user's request.
- The opening paragraph explains why the package exists.
- The chapters are easy to scan.
- Chapter-level source anchors help the reader jump back to sources without crowding the page.
- The next-actions section says how to reuse the pattern.

## Stop Conditions

- If the manifest has too many gaps, stop and gather more evidence.
- If the topic is too broad, narrow it before generating prose.
- If the user wants a different genre, switch the reference library first and regenerate.
