# Learning Content Contract

The contract must stay versioned and renderer-independent.

## Top-Level Fields

- `schema`
- `version`
- `packageId`
- `generatedAt`
- `title`
- `topic`
- `subtitle`
- `genre`
- `stylePromptPack`
- `stylePromptEngineering`
- `styleTransfer`
- `trigger`
- `sourceScope`
- `audience`
- `snapshot`
- `learningGoals`
- `overviewParagraphs`
- `outline`
- `chapters`
- `evidenceManifestPath`
- `packagePaths`
- `related`
- `nextActions`

## Chapter Shape

Each chapter should support:

- `id`
- `label`
- `semanticTitle`
- `summary`
- `paragraphs`
- `retrievalBlocks`
- `workedExamples`
- `evidenceIds`

## Block Shape

### Retrieval Block

- `prompt`
- `hint`
- `answer`

### Worked Example

- `title`
- `scenario`
- `steps`
- `principle`

## Rules

- Facts belong to evidence.
- Narrative belongs to the contract.
- Prompt engineering belongs to `stylePromptEngineering`.
- Style migration audit belongs to `styleTransfer`.
- Rendering belongs to the HTML reader.
- The outline should stay chapter-oriented; retrieval questions remain in chapter body content instead of separate TOC leaf nodes.
- Claims that cannot be supported by the manifest should be marked as inference.
- Version the contract whenever the shape changes.

## Minimal Example

```json
{
  "schema": "openprd.learning-content.v1",
  "version": 1,
  "packageId": "lr-20260512-120000-openprd-review",
  "title": "《OpenPrd 复盘学习书》",
  "genre": {
    "id": "internet-product",
    "label": "互联网产品"
  },
  "chapters": [
    {
      "id": "chapter-1",
      "label": "问题地图",
      "semanticTitle": "从任务完成回到工作区事实",
      "summary": "先把发生了什么说清楚。",
      "retrievalBlocks": [],
      "workedExamples": [],
      "evidenceIds": ["current-state", "task-graph"]
    }
  ]
}
```
