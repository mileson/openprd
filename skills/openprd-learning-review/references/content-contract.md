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
- `visualExplainer`
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

### Visual Explainer

- `title`
- `analogy`
- `scene`
- `whyItMatters`
- `takeaways`
- `image`

### Visual Explainer Image

- `path`
- `alt`
- `caption`
- `prompt`

## Rules

- Facts belong to evidence.
- Narrative belongs to the contract.
- Prompt engineering belongs to `stylePromptEngineering`.
- Style migration audit belongs to `styleTransfer`.
- Rendering belongs to the HTML reader.
- The outline should stay chapter-oriented; retrieval questions remain in chapter body content instead of separate TOC leaf nodes.
- `visualExplainer` helps readers form intuition faster, but it cannot replace evidence or introduce unsupported facts.
- If `visualExplainer.image.path` is present, prefer a relative path under `packagePaths.assetsDir` so the archived reader stays portable.
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
      "visualExplainer": {
        "title": "像开业前先做联合质检",
        "analogy": "先别急着开门营业，而是让不同角色独立检查风险。",
        "scene": "产品负责人先看用户旅程，工程负责人再看实现风险。",
        "whyItMatters": "非技术读者可以先抓住机制，再回到证据细节。",
        "takeaways": ["先独立看", "后统一判", "再决定做不做"],
        "image": {
          "path": "assets/chapter-1.png",
          "alt": "开业前联合质检的图文示意",
          "caption": "图片只帮助理解，不替代证据。"
        }
      },
      "retrievalBlocks": [],
      "workedExamples": [],
      "evidenceIds": ["current-state", "task-graph"]
    }
  ]
}
```
