import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { cjoin, writeText } from './fs-utils.js';
import { renderQualityEvalArtifact as renderQualityEvalArtifactV2 } from './quality-html-artifact.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function leafName(value) {
  return String(value ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? String(value ?? '');
}

function listMarkup(items, emptyText = '暂无') {
  const normalized = Array.isArray(items) ? items.filter(Boolean) : [];
  if (normalized.length === 0) {
    return `<li class="empty">${escapeHtml(emptyText)}</li>`;
  }
  return normalized.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

function card(title, body) {
  return `
    <section class="card">
      <div class="card-header">${escapeHtml(title)}</div>
      <div class="card-body">${body}</div>
    </section>
  `;
}

function pageShell({ title, subtitle, eyebrow, summaryCards = [], sections = [], footer = '', statusBadge = null, topMeta = [] }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f4ed;
        --panel: rgba(255,255,255,0.88);
        --text: #1f2937;
        --muted: #6b7280;
        --line: rgba(31,41,55,0.12);
        --accent: #d97706;
        --accent-soft: rgba(217,119,6,0.12);
        --danger: #dc2626;
        --danger-soft: rgba(220,38,38,0.08);
        --ok: #15803d;
        --ok-soft: rgba(21,128,61,0.08);
        --mono: "JetBrains Mono","SFMono-Regular",Menlo,monospace;
        --serif: "Iowan Old Style","Palatino Linotype","Book Antiqua",Palatino,serif;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background:
          radial-gradient(circle at top left, rgba(217,119,6,0.08), transparent 25%),
          linear-gradient(180deg, #faf8f2 0%, var(--bg) 100%);
        color: var(--text);
        font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      .page {
        max-width: 1180px;
        margin: 0 auto;
        padding: 32px 24px 56px;
      }
      .hero {
        display: grid;
        gap: 16px;
        margin-bottom: 28px;
      }
      .eyebrow {
        display: inline-flex;
        width: fit-content;
        padding: 6px 12px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.72);
        color: var(--muted);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .hero-topline {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }
      .status-badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        width: fit-content;
        padding: 8px 14px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0.03em;
        border: 2px solid transparent;
        box-shadow: 0 10px 24px rgba(15,23,42,0.08);
      }
      .status-badge::before {
        content: "";
        width: 9px;
        height: 9px;
        border-radius: 999px;
        background: currentColor;
        box-shadow: 0 0 0 4px rgba(255,255,255,0.35);
      }
      .status-pass {
        color: #166534;
        background: #dcfce7;
        border-color: #22c55e;
      }
      .status-fail {
        color: #991b1b;
        background: #fee2e2;
        border-color: #ef4444;
      }
      .status-warn {
        color: #92400e;
        background: #fef3c7;
        border-color: #f59e0b;
      }
      .mini-status {
        padding: 4px 10px;
        font-size: 11px;
        border-width: 1.5px;
        box-shadow: none;
      }
      .mini-status::before {
        width: 7px;
        height: 7px;
        box-shadow: none;
      }
      h1 {
        margin: 0;
        font-size: clamp(34px, 5vw, 56px);
        line-height: 1;
        font-family: var(--serif);
        font-weight: 600;
      }
      .subtitle {
        max-width: 880px;
        margin: 0;
        color: var(--muted);
        font-size: 18px;
        line-height: 1.7;
      }
      .summary-grid,
      .section-grid {
        display: grid;
        gap: 16px;
      }
      .summary-grid {
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        margin-bottom: 28px;
      }
      .evidence-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 12px;
        margin-bottom: 14px;
      }
      .section-grid {
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      }
      .card {
        border: 1px solid var(--line);
        border-radius: 20px;
        background: var(--panel);
        backdrop-filter: blur(8px);
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.05);
        overflow: hidden;
      }
      .card-header {
        padding: 14px 18px 0;
        font-size: 12px;
        letter-spacing: 0.08em;
        color: var(--muted);
        text-transform: uppercase;
      }
      .card-body {
        padding: 12px 18px 18px;
      }
      .metric {
        font-size: 30px;
        line-height: 1.1;
        font-family: var(--serif);
        font-weight: 600;
      }
      .metric-sub {
        margin-top: 8px;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
      }
      .mini-metric {
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.72);
      }
      .mini-metric-value {
        font-size: 18px;
        line-height: 1.25;
        font-weight: 750;
        word-break: break-word;
      }
      .mini-metric-label {
        margin-bottom: 5px;
        color: var(--muted);
        font-size: 12px;
      }
      .mini-metric-sub {
        margin-top: 5px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.45;
        word-break: break-word;
      }
      ul {
        margin: 0;
        padding-left: 18px;
        line-height: 1.7;
      }
      li + li { margin-top: 8px; }
      .empty { color: var(--muted); }
      .qa-item,
      .option-item,
      .export-item,
      .evidence-item {
        padding: 12px 14px;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.7);
      }
      .qa-label,
      .option-title,
      .export-title,
      .evidence-title {
        font-weight: 600;
      }
      .qa-status-row {
        display: flex;
        justify-content: flex-start;
        margin-top: 8px;
      }
      .qa-meta,
      .option-meta,
      .export-meta,
      .evidence-meta {
        margin-top: 6px;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
      }
      .warning {
        border-color: rgba(220,38,38,0.18);
        background: var(--danger-soft);
      }
      .success {
        border-color: rgba(21,128,61,0.18);
        background: var(--ok-soft);
      }
      .chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: white;
        color: var(--muted);
        font-size: 12px;
        font-family: var(--mono);
      }
      .code-block {
        overflow-x: auto;
        padding: 14px;
        border-radius: 14px;
        background: #161b22;
        color: #e5e7eb;
        font-family: var(--mono);
        font-size: 13px;
        line-height: 1.6;
      }
      .footer {
        margin-top: 28px;
        color: var(--muted);
        font-size: 13px;
      }
      @media (max-width: 700px) {
        .page { padding: 20px 14px 40px; }
        .subtitle { font-size: 16px; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="hero">
        <div class="hero-topline">
          <div class="eyebrow">${escapeHtml(eyebrow)}</div>
          ${statusBadge ? `<div class="status-badge ${escapeHtml(statusBadge.className)}">${escapeHtml(statusBadge.label)}</div>` : ''}
        </div>
        <h1>${escapeHtml(title)}</h1>
        ${topMeta.length ? `<div class="top-meta">${topMeta.map((item) => `<div class="meta-chip">${escapeHtml(item)}</div>`).join('')}</div>` : ''}
        <p class="subtitle">${escapeHtml(subtitle)}</p>
      </header>
      <section class="summary-grid">${summaryCards.join('\n')}</section>
      <section class="section-grid">${sections.join('\n')}</section>
      ${footer ? `<div class="footer">${escapeHtml(footer)}</div>` : ''}
      <script>
        document.querySelectorAll('[data-copy-target]').forEach((button) => {
          button.addEventListener('click', async () => {
            const block = button.closest('.export-item')?.querySelector('[data-copy-block]');
            if (!block) return;
            await navigator.clipboard.writeText(block.textContent || '');
            const old = button.textContent;
            button.textContent = '✓ 已复制';
            setTimeout(() => { button.textContent = old; }, 1200);
          });
        });
      </script>
    </main>
  </body>
</html>`;
}

function metricCard(title, metric, subtext) {
  return card(title, `
    <div class="metric">${escapeHtml(metric)}</div>
    <div class="metric-sub">${escapeHtml(subtext)}</div>
  `);
}

function slugify(value, fallback = 'artifact') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function formatClarificationQuestion(item) {
  return `
    <div class="qa-item ${item.reason === 'missing' ? 'warning' : ''}">
      <div class="qa-label">${escapeHtml(item.prompt)}</div>
      <div class="qa-meta">来源: ${escapeHtml(item.reason)} · 字段: ${escapeHtml(item.id)}</div>
    </div>
  `;
}

function formatOption(option) {
  return `
    <div class="option-item">
      <div class="option-title">${escapeHtml(option.title)}</div>
      <div class="option-meta">${escapeHtml(option.summary)}</div>
      <ul>${listMarkup(option.tradeoffs, '暂无明确 tradeoff')}</ul>
    </div>
  `;
}

function formatExportItem(item) {
  return `
    <div class="export-item success">
      <div class="export-title">${escapeHtml(item.title)}</div>
      <div class="export-meta">${escapeHtml(item.description)}</div>
      <div class="code-block" data-copy-block>${escapeHtml(item.payload)}</div>
      <div class="actions">
        <button type="button" class="copy-button" data-copy-target>⧉ 复制</button>
      </div>
    </div>
  `;
}

function formatEvidenceItem(item) {
  return `
    <div class="evidence-item">
      <div class="evidence-title">${escapeHtml(item.title)}</div>
      <div class="evidence-meta">${escapeHtml(item.description)}</div>
      <ul>${listMarkup(item.items, '暂无')}</ul>
    </div>
  `;
}


export function buildReviewExportPayload(snapshot) {
  const sections = snapshot.sections ?? {};
  const presentation = buildReviewPresentationFeedback(snapshot);
  return {
    versionId: snapshot.versionId,
    title: snapshot.title,
    digest: snapshot.digest ?? null,
    workUnitId: snapshot.workUnitId ?? null,
    targetRoot: snapshot.targetRoot ?? null,
    reviewStatus: 'pending-confirmation',
    recommendedActions: [
      '确认问题与目标',
      '确认范围内 / 范围外',
      '确认主流程与失败路径',
      '确认关键风险与开放问题',
    ],
    sectionKeys: Object.keys(sections),
    presentationContract: presentation.contract,
    presentationFeedback: presentation.violations,
    exportedAt: new Date().toISOString(),
  };
}

const REVIEW_PRESENTATION_CONTRACT = {
  intent: '这些限制用于反馈给 Agent 重新概括，不由 HTML 模板截断原文。',
  expectedDataShape: {
    reviewPresentation: {
      mapNodes: {
        problem: { title: '问题定义', text: '30 字以内的图中正文' },
        goal: { title: '15 字以内标题', text: '30 字以内的图中正文' },
        scope: { title: '15 字以内标题', text: '30 字以内的图中正文' },
        flow: { title: '15 字以内标题', text: '30 字以内的图中正文' },
        risk: { title: '15 字以内标题', text: '30 字以内的图中正文' },
      },
      flowNodes: [
        { text: '30 字以内的流程卡片正文' },
      ],
    },
  },
  rules: [
    {
      id: 'review-map-card-text',
      area: '需求关系图 / 需求流程图',
      target: '图中每个卡片的正文',
      maxChars: 30,
      action: '请写入 reviewPresentation.mapNodes.*.text 或 reviewPresentation.flowNodes[].text，重写成用户一眼能扫懂的短句，不要靠省略号或截断。',
    },
    {
      id: 'review-map-card-title',
      area: '需求关系图 / 需求流程图',
      target: '图中卡片标题胶囊',
      maxChars: 15,
      action: '请写入 reviewPresentation.mapNodes.*.title，重写成短标题，优先使用业务词，不使用内部技术词。',
    },
    {
      id: 'review-highlight-chip',
      area: '四个评审卡片',
      target: '重点摘要胶囊',
      maxChars: 15,
      action: '请重写成短标签，保留结论，不要堆叠长句。',
    },
    {
      id: 'review-panel-detail-format',
      area: '四个评审卡片',
      target: '明细分点',
      format: '- **摘要内容**：明细一句话',
      action: '请把每个明细改写为“加粗短摘要 + 一句话说明”，方便用户先扫重点再读细节。',
    },
  ],
};

export function buildReviewPresentationFeedback(snapshot) {
  const sectionsData = snapshot.sections ?? {};
  const violations = [];
  const addViolation = ({ ruleId, area, target, value, maxChars }) => {
    const text = normalizedReviewVisibleText(value);
    const currentChars = reviewVisibleChars(text);
    if (currentChars <= maxChars) return;
    violations.push({
      ruleId,
      area,
      target,
      currentChars,
      maxChars,
      currentText: text,
      action: '请让 Agent 重新提炼这段内容，生成更短、更完整的表达；不要由 HTML 模板直接裁剪。',
    });
  };

  const primaryFlows = reviewList(sectionsData.scenarios?.primaryFlows);
  if (primaryFlows.length >= 2) {
    primaryFlows.slice(0, 4).forEach((item, index) => {
      addViolation({
        ruleId: 'review-map-card-text',
        area: '需求流程图',
        target: `流程卡片 ${index + 1}`,
        value: reviewPresentationFlowNode(snapshot, index, reviewMapText(item)),
        maxChars: 30,
      });
    });
  } else {
    const relationshipNodes = [
      ['problem', '问题定义', sectionsData.problem?.problemStatement || '待确认问题定义'],
      ['goal', '目标', firstReviewMapValue(sectionsData.goals?.goals, sectionsData.goals?.successMetrics, '待确认目标')],
      ['scope', '范围', firstReviewMapValue(sectionsData.scope?.inScope, sectionsData.scope?.outOfScope, '待确认范围')],
      ['flow', '流程', firstReviewMapValue(sectionsData.scenarios?.primaryFlows, sectionsData.scenarios?.edgeCases, '待确认流程')],
      ['risk', '风险', firstReviewMapValue(sectionsData.risks?.risks, sectionsData.risks?.openQuestions, '待确认风险')],
    ];
    relationshipNodes.forEach(([key, fallbackLabel, fallbackValue]) => {
      const node = reviewPresentationMapNode(snapshot, key, fallbackLabel, reviewMapText(fallbackValue));
      addViolation({
        ruleId: 'review-map-card-title',
        area: '需求关系图',
        target: `${fallbackLabel}卡片标题`,
        value: node.label,
        maxChars: 15,
      });
      addViolation({
        ruleId: 'review-map-card-text',
        area: '需求关系图',
        target: `${fallbackLabel}卡片正文`,
        value: node.value,
        maxChars: 30,
      });
    });
  }

  const panelChipSources = [
    ...primaryFlows,
    ...reviewList(sectionsData.scenarios?.edgeCases),
    ...reviewList(sectionsData.scenarios?.failureModes),
    ...reviewList(sectionsData.requirements?.functional),
    ...reviewList(sectionsData.requirements?.nonFunctional),
    ...reviewList(sectionsData.constraints?.technical),
    ...reviewList(sectionsData.constraints?.compliance),
    ...reviewList(sectionsData.constraints?.dependencies),
    ...reviewList(sectionsData.businessGuardrails?.rateLimits),
    ...reviewList(sectionsData.businessGuardrails?.abusePrevention),
    ...reviewList(sectionsData.businessGuardrails?.costControls),
    ...reviewList(sectionsData.risks?.risks),
    ...reviewList(sectionsData.risks?.openQuestions),
  ];
  panelChipSources.map((item) => summarizeReviewChip(item)).filter(Boolean).forEach((chip) => {
    addViolation({
      ruleId: 'review-highlight-chip',
      area: '评审卡片重点摘要',
      target: '重点摘要胶囊',
      value: chip,
      maxChars: 15,
    });
  });

  reviewPanelDetailGroups(sectionsData).forEach((group) => {
    group.items.forEach((item, index) => {
      if (isStructuredReviewPanelDetail(item)) return;
      violations.push({
        ruleId: 'review-panel-detail-format',
        area: group.area,
        target: `明细 ${index + 1}`,
        expectedFormat: '- **摘要内容**：明细一句话',
        currentText: normalizedReviewVisibleText(item),
        action: '请让 Agent 重新写成“**短摘要**：一句明细”，摘要用于扫读，明细保留完整判断。',
      });
    });
  });

  return {
    contract: REVIEW_PRESENTATION_CONTRACT,
    violations,
  };
}

function normalizedReviewVisibleText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function reviewVisibleChars(value) {
  return Array.from(normalizedReviewVisibleText(value)).length;
}

function reviewPresentation(snapshot) {
  const presentation = snapshot?.reviewPresentation;
  return presentation && typeof presentation === 'object' && !Array.isArray(presentation) ? presentation : {};
}

function reviewPresentationMapNodes(snapshot) {
  const nodes = reviewPresentation(snapshot).mapNodes;
  return nodes && typeof nodes === 'object' && !Array.isArray(nodes) ? nodes : {};
}

function reviewPresentationMapNode(snapshot, key, fallbackLabel, fallbackValue) {
  const node = reviewPresentationMapNodes(snapshot)[key];
  const candidate = node && typeof node === 'object' && !Array.isArray(node) ? node : {};
  return {
    label: normalizedReviewVisibleText(candidate.title ?? candidate.label ?? fallbackLabel) || fallbackLabel,
    value: normalizedReviewVisibleText(candidate.text ?? candidate.value ?? fallbackValue) || fallbackValue,
  };
}

function reviewPresentationFlowNode(snapshot, index, fallbackValue) {
  const nodes = reviewPresentation(snapshot).flowNodes;
  const node = Array.isArray(nodes) ? nodes[index] : null;
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return fallbackValue;
  }
  return normalizedReviewVisibleText(node.text ?? node.value ?? fallbackValue) || fallbackValue;
}

function reviewPanelDetailGroups(sectionsData) {
  return [
    {
      area: '主流程与边界情况',
      items: [
        ...reviewList(sectionsData.scenarios?.primaryFlows),
        ...reviewList(sectionsData.scenarios?.edgeCases),
        ...reviewList(sectionsData.scenarios?.failureModes),
      ],
    },
    {
      area: '功能与约束',
      items: [
        ...reviewList(sectionsData.requirements?.functional),
        ...reviewList(sectionsData.requirements?.nonFunctional),
        ...reviewList(sectionsData.constraints?.technical),
        ...reviewList(sectionsData.constraints?.compliance),
        ...reviewList(sectionsData.constraints?.dependencies),
      ],
    },
    {
      area: '业务成本与滥用护栏',
      items: [
        ...reviewList(sectionsData.businessGuardrails?.rateLimits),
        ...reviewList(sectionsData.businessGuardrails?.abusePrevention),
        ...reviewList(sectionsData.businessGuardrails?.costControls),
      ],
    },
    {
      area: '开放问题与风险',
      items: [
        ...reviewList(sectionsData.risks?.risks),
        ...reviewList(sectionsData.risks?.openQuestions),
      ],
    },
  ];
}

function isStructuredReviewPanelDetail(value) {
  const text = normalizedReviewVisibleText(value);
  return /^\*\*[^*]{1,24}\*\*\s*[：:]\s*\S+/u.test(text);
}

function reviewList(items) {
  return Array.isArray(items) ? items.filter(Boolean).map((item) => String(item).trim()).filter(Boolean) : [];
}

function splitSvgLines(value, maxChars = 17) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim() || '待补充';
  const tokens = text.match(/[A-Za-z0-9_./:-]+|[\u4e00-\u9fff]|[^\s]/g) ?? [text];
  const lines = [];
  let line = '';
  let length = 0;
  const visualLength = (token) => /^[A-Za-z0-9_./:-]+$/.test(token)
    ? Math.max(1, token.length * 0.62)
    : 1;
  for (const token of tokens) {
    const nextLength = visualLength(token);
    if (line && length + nextLength > maxChars) {
      lines.push(line);
      line = token;
      length = nextLength;
    } else {
      line += token;
      length += nextLength;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

function svgText(value, x, y, className, maxChars = 17, lineHeight = 16, anchor = 'middle') {
  const lines = splitSvgLines(value, maxChars);
  return `<text class="${className}" x="${x}" y="${y}" text-anchor="${anchor}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeHtml(line)}</tspan>`).join('')}</text>`;
}

function reviewIcon(kind) {
  const icons = {
    flow: '<svg viewBox="0 0 24 24" role="img" aria-label="流程"><path d="M5 6.5h6.4a3.6 3.6 0 0 1 3.6 3.6v.8" /><path d="M15 17.5H8.6A3.6 3.6 0 0 1 5 13.9v-.8" /><path d="m12 8.5 3-3 3 3" /><path d="m8 15.5-3 3-3-3" /></svg>',
    function: '<svg viewBox="0 0 24 24" role="img" aria-label="功能"><path d="M5 7h14" /><path d="M5 12h14" /><path d="M5 17h14" /><circle cx="8" cy="7" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="11" cy="17" r="2" /></svg>',
    guardrail: '<svg viewBox="0 0 24 24" role="img" aria-label="护栏"><path d="M12 3 5 6v5c0 4.4 2.8 8.4 7 9.8 4.2-1.4 7-5.4 7-9.8V6l-7-3Z" /><path d="M9 12.2 11 14l4-4.4" /></svg>',
    risk: '<svg viewBox="0 0 24 24" role="img" aria-label="风险"><path d="M12 4 3.5 19h17L12 4Z" /><path d="M12 9v4" /><path d="M12 16.5h.01" /></svg>',
    map: '<svg viewBox="0 0 24 24" role="img" aria-label="图谱"><path d="M12 5v14" /><path d="M5 8h14" /><path d="M7 16h10" /><circle cx="12" cy="5" r="2" /><circle cx="5" cy="8" r="2" /><circle cx="19" cy="8" r="2" /><circle cx="7" cy="16" r="2" /><circle cx="17" cy="16" r="2" /></svg>',
  };
  return `<span class="review-icon review-icon-${escapeHtml(kind)}" aria-hidden="true">${icons[kind] ?? icons.flow}</span>`;
}

function renderReviewOverview(snapshot, sectionsData) {
  const problem = sectionsData.problem?.problemStatement || '尚未形成明确问题定义';
  return `
    <section class="review-overview" aria-labelledby="reviewOverviewTitle">
      <div class="review-overview-copy">
        <p class="review-kicker">需求概览</p>
        <h1 id="reviewOverviewTitle">${escapeHtml(snapshot.title || 'PRD 评审')}</h1>
        <p class="review-problem">${escapeHtml(problem)}</p>
      </div>
    </section>
  `;
}

function renderReviewFlowSvg(snapshot, sectionsData) {
  const flowItems = reviewList(sectionsData.scenarios?.primaryFlows);
  if (flowItems.length < 2) {
    return renderReviewMindMapSvg(snapshot, sectionsData);
  }
  const nodes = (flowItems.length ? flowItems : [
    '确认问题定义',
    '确认范围与边界',
    '确认主流程',
    '确认风险与开放问题',
  ]).slice(0, 4);
  const positions = [116, 360, 604, 848].slice(0, nodes.length);
  const arrows = positions.slice(1).map((x, index) => `
    <path class="review-map-arrow" d="M ${positions[index] + 82} 124 H ${x - 92}" marker-end="url(#reviewArrow)" />
  `).join('');
  const nodeMarkup = nodes.map((item, index) => `
    <g>
      <rect class="review-map-node node-${index + 1}" x="${positions[index] - 104}" y="72" width="208" height="118" rx="8" />
      <text class="review-map-step" x="${positions[index] - 78}" y="102">${index + 1}</text>
      ${svgText(reviewMapCardText(reviewPresentationFlowNode(snapshot, index, reviewMapText(item))), positions[index], 126, 'review-map-label', 13, 15)}
    </g>
  `).join('');
  const overflowNote = flowItems.length > nodes.length
    ? `<p class="review-map-note">还有 ${flowItems.length - nodes.length} 条流程在下方“主流程与边界情况”里查看。</p>`
    : '';
  return `
    <section class="review-map" aria-labelledby="reviewMapTitle">
      <div class="review-section-heading">
        ${reviewIcon('map')}
        <div>
          <h2 id="reviewMapTitle">需求流程图</h2>
        </div>
      </div>
      <div class="review-map-canvas">
        <svg viewBox="0 0 960 280" role="img" aria-label="需求流程图" preserveAspectRatio="xMidYMid meet">
          <defs>
            <marker id="reviewArrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
              <path d="M 0 0 L 12 6 L 0 12 z" fill="#4f46e5" />
            </marker>
          </defs>
          <rect class="review-map-bg" x="2" y="2" width="956" height="276" rx="8" />
          ${arrows}
          ${nodeMarkup}
        </svg>
      </div>
      ${overflowNote}
    </section>
  `;
}

function renderReviewMindMapSvg(snapshot, sectionsData) {
  const problem = sectionsData.problem?.problemStatement || '待确认问题定义';
  const center = { x: 480, y: 168 };
  const nodes = [
    {
      key: 'goal',
      label: '目标',
      value: firstReviewMapValue(sectionsData.goals?.goals, sectionsData.goals?.successMetrics, '待确认目标'),
      x: 250,
      y: 94,
      className: 'node-1',
    },
    {
      key: 'scope',
      label: '范围',
      value: firstReviewMapValue(sectionsData.scope?.inScope, sectionsData.scope?.outOfScope, '待确认范围'),
      x: 710,
      y: 94,
      className: 'node-2',
    },
    {
      key: 'flow',
      label: '流程',
      value: firstReviewMapValue(sectionsData.scenarios?.primaryFlows, sectionsData.scenarios?.edgeCases, '待确认流程'),
      x: 250,
      y: 242,
      className: 'node-3',
    },
    {
      key: 'risk',
      label: '风险',
      value: firstReviewMapValue(sectionsData.risks?.risks, sectionsData.risks?.openQuestions, '待确认风险'),
      x: 710,
      y: 242,
      className: 'node-4',
    },
  ];
  const links = nodes.map((node) => `<path class="review-map-link" d="M ${center.x} ${center.y} L ${node.x} ${node.y}" />`).join('');
  const satelliteNodes = nodes.map((node) => {
    const displayNode = reviewPresentationMapNode(snapshot, node.key, node.label, reviewMapText(node.value));
    return `
    <g>
      <rect class="review-map-node ${node.className}" x="${node.x - 122}" y="${node.y - 43}" width="244" height="86" rx="8" />
      ${reviewMapTagPill(displayNode.label, node.x, node.y - 22, node.className)}
      ${svgText(reviewMapCardText(displayNode.value), node.x - 94, node.y + 6, 'review-map-label', 15, 14, 'start')}
    </g>
  `;
  }).join('');
  const centerDisplayNode = reviewPresentationMapNode(snapshot, 'problem', '问题定义', reviewMapText(problem));
  const centerNode = `
    <g class="review-map-center-group">
      <rect class="review-map-center" x="330" y="124" width="300" height="88" rx="8" />
      ${reviewMapTagPill(centerDisplayNode.label, center.x, 146, 'center')}
      ${svgText(reviewMapCardText(centerDisplayNode.value), 360, 176, 'review-map-label center', 16, 14, 'start')}
    </g>
  `;
  return `
    <section class="review-map" aria-labelledby="reviewMapTitle">
      <div class="review-section-heading">
        ${reviewIcon('map')}
        <div>
          <h2 id="reviewMapTitle">需求关系图</h2>
        </div>
      </div>
      <div class="review-map-canvas">
        <svg viewBox="0 0 960 336" role="img" aria-label="需求关系图" preserveAspectRatio="xMidYMid meet">
          <rect class="review-map-bg" x="2" y="2" width="956" height="332" rx="8" />
          ${links}
          ${satelliteNodes}
          ${centerNode}
        </svg>
      </div>
    </section>
  `;
}

function reviewMapTagPill(label, x, y, className) {
  const text = trimReviewChipBoundary(label) || '未命名';
  const width = Math.max(54, Array.from(text).length * 14 + 26);
  return `
    <rect class="review-map-tag-pill ${escapeHtml(className)}" x="${x - width / 2}" y="${y - 13}" width="${width}" height="26" rx="13" />
    <text class="review-map-tag ${escapeHtml(className)}" x="${x}" y="${y + 4}" text-anchor="middle">${escapeHtml(text)}</text>
  `;
}

function firstReviewMapValue(primaryItems, secondaryItems, fallback) {
  return reviewList(primaryItems)[0] ?? reviewList(secondaryItems)[0] ?? fallback;
}

function reviewMapText(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim() || '待补充';
  return text.split(/[。！？!?]/).map((item) => item.trim()).find(Boolean) ?? text;
}

function reviewMapCardText(value) {
  return reviewMapText(value);
}

function trimReviewChipBoundary(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s/|｜:：,，、;；.!?？。-]+$/u, '')
    .trim();
}

function condensedReviewChipLabel(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  const rules = [
    { pattern: /截图|红框|口径|用户预期|预期不一致/u, label: '确认分类口径' },
    { pattern: /Playwright/i, label: 'Playwright 验证' },
    { pattern: /Host API/i, label: '不新增 Host API' },
    { pattern: /用量|额度|成本/u, label: '用量额度不变' },
    { pattern: /后台任务|重复触发|轮询/u, label: '不新增后台任务' },
    { pattern: /窄屏|响应式/u, label: '窄屏响应式' },
    { pattern: /滚动|稳定性/u, label: '滚动稳定性' },
    { pattern: /CSS|样式/i, label: 'CSS 样式' },
  ];
  return rules.find((rule) => rule.pattern.test(text))?.label ?? null;
}

function summarizeReviewChip(value, maxLength = 15) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const clauses = text.split(/[。；;，,、.!?？]/).map((item) => item.trim()).filter(Boolean);
  const compact =
    clauses.find((item) => item.length >= 4 && item.length <= maxLength) ??
    condensedReviewChipLabel(text) ??
    clauses.find((item) => item.length >= 4) ??
    clauses[0] ??
    text;
  return trimReviewChipBoundary(compact);
}

function reviewHighlightChips(items, emptyText) {
  const chips = [];
  for (const item of reviewList(items)) {
    const chip = summarizeReviewChip(item);
    if (chip && !chips.includes(chip)) {
      chips.push(chip);
    }
    if (chips.length >= 4) break;
  }
  if (chips.length === 0) {
    return `<span class="review-chip empty">${escapeHtml(emptyText)}</span>`;
  }
  return chips.map((chip) => `<span class="review-chip">${escapeHtml(chip)}</span>`).join('');
}

function reviewJourneyLabel(items, fallback) {
  const text = reviewList(items)[0] ?? fallback;
  return summarizeReviewChip(text, 18) || fallback;
}

function reviewJourneyClauses(items) {
  return reviewList(items)
    .flatMap((item) => item.split(/[。；;.!?？]/))
    .flatMap((item) => item.split(/[，,]/))
    .map((item) => item.trim())
    .filter((item) => item.length >= 4);
}

function renderReviewJourneySvg({ primaryFlows, edgeCases, failureModes }) {
  const primary = reviewList(primaryFlows);
  const edges = reviewList(edgeCases);
  const failures = reviewList(failureModes);
  const primaryClauses = reviewJourneyClauses(primary);
  const journey = reviewJourneyLabel(primaryClauses.length ? primaryClauses : primary, '待确认用户入口');
  const step = reviewJourneyLabel(primaryClauses.slice(1).length ? primaryClauses.slice(1) : primary.slice(1), '待确认关键步骤');
  const outcome = reviewJourneyLabel(primaryClauses.slice(2).length ? primaryClauses.slice(2) : primary.slice(2), '待确认完成状态');
  const boundary = reviewJourneyLabel(edges, '待确认边界情况');
  const recovery = reviewJourneyLabel(failures.length ? failures : edges.slice(1), '待确认恢复路径');
  return `
    <div class="review-journey-map" aria-label="主流程小图">
      <svg viewBox="0 0 680 320" role="img" aria-label="用户旅程、关键步骤、边界情况和恢复路径" preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="reviewJourneyArrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#0d9488" />
          </marker>
        </defs>
        <rect class="review-journey-bg" x="2" y="2" width="676" height="316" rx="8" />
        <path class="review-journey-arrow" d="M 202 88 H 248" marker-end="url(#reviewJourneyArrow)" />
        <path class="review-journey-arrow" d="M 432 88 H 478" marker-end="url(#reviewJourneyArrow)" />
        <path class="review-journey-arrow branch" d="M 340 134 V 164 H 236 V 190" marker-end="url(#reviewJourneyArrow)" />
        <path class="review-journey-arrow branch" d="M 340 134 V 164 H 454 V 190" marker-end="url(#reviewJourneyArrow)" />
        <g>
          <rect class="review-journey-node stage-journey" x="26" y="40" width="176" height="96" rx="8" />
          <circle class="review-journey-dot stage-journey" cx="56" cy="64" r="12" />
          <text class="review-journey-number" x="56" y="64" text-anchor="middle">1</text>
          <text class="review-journey-tag" x="114" y="66" text-anchor="middle">用户旅程</text>
          ${svgText(journey, 114, 92, 'review-journey-label', 12, 13)}
        </g>
        <g>
          <rect class="review-journey-node stage-step" x="252" y="40" width="176" height="96" rx="8" />
          <circle class="review-journey-dot stage-step" cx="282" cy="64" r="12" />
          <text class="review-journey-number" x="282" y="64" text-anchor="middle">2</text>
          <text class="review-journey-tag" x="340" y="66" text-anchor="middle">关键步骤</text>
          ${svgText(step, 340, 92, 'review-journey-label', 12, 13)}
        </g>
        <g>
          <rect class="review-journey-node stage-outcome" x="478" y="40" width="176" height="96" rx="8" />
          <circle class="review-journey-dot stage-outcome" cx="508" cy="64" r="12" />
          <text class="review-journey-number" x="508" y="64" text-anchor="middle">3</text>
          <text class="review-journey-tag" x="566" y="66" text-anchor="middle">结果确认</text>
          ${svgText(outcome, 566, 92, 'review-journey-label', 12, 13)}
        </g>
        <g>
          <rect class="review-journey-node stage-boundary" x="126" y="194" width="220" height="88" rx="8" />
          <circle class="review-journey-dot stage-boundary" cx="158" cy="218" r="12" />
          <text class="review-journey-number" x="158" y="218" text-anchor="middle">B</text>
          <text class="review-journey-tag" x="236" y="220" text-anchor="middle">边界情况</text>
          ${svgText(boundary, 236, 246, 'review-journey-label', 15, 13)}
        </g>
        <g>
          <rect class="review-journey-node stage-recovery" x="356" y="194" width="220" height="88" rx="8" />
          <circle class="review-journey-dot stage-recovery" cx="388" cy="218" r="12" />
          <text class="review-journey-number" x="388" y="218" text-anchor="middle">R</text>
          <text class="review-journey-tag" x="466" y="220" text-anchor="middle">恢复路径</text>
          ${svgText(recovery, 466, 246, 'review-journey-label', 15, 13)}
        </g>
      </svg>
    </div>
  `;
}

function reviewSubtitleText(value) {
  return String(value ?? '').replace(/[。.]$/u, '');
}

function renderReviewPanel({ kind, title, description, items, emptyText, visual = '' }) {
  return `
    <section class="review-panel review-panel-${escapeHtml(kind)}">
      <header class="review-panel-head">
        ${reviewIcon(kind)}
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(reviewSubtitleText(description))}</p>
        </div>
      </header>
      <div class="review-chip-row" aria-label="${escapeHtml(title)}重点摘要">
        ${reviewHighlightChips(items, emptyText)}
      </div>
      ${visual}
      <ul class="review-panel-list">${reviewPanelListMarkup(items, emptyText)}</ul>
    </section>
  `;
}

function reviewPanelListMarkup(items, emptyText = '暂无') {
  const normalized = Array.isArray(items) ? items.filter(Boolean).map((item) => String(item).trim()).filter(Boolean) : [];
  if (normalized.length === 0) {
    return `<li class="empty">${escapeHtml(emptyText)}</li>`;
  }
  return normalized.map((item) => {
    const parsed = parseReviewPanelDetail(item);
    return `<li><strong class="review-detail-summary">${escapeHtml(parsed.summary)}</strong><span class="review-detail-body">：${escapeHtml(parsed.detail)}</span></li>`;
  }).join('');
}

function parseReviewPanelDetail(value) {
  const text = normalizedReviewVisibleText(value);
  const markdown = text.match(/^\*\*([^*]+)\*\*\s*[：:]\s*(.+)$/u);
  if (markdown) {
    return {
      summary: markdown[1].trim(),
      detail: markdown[2].trim(),
    };
  }
  const plain = text.match(/^([^：:]{2,18})[：:]\s*(.+)$/u);
  if (plain) {
    return {
      summary: plain[1].trim(),
      detail: plain[2].trim(),
    };
  }
  return {
    summary: reviewDetailSummary(text),
    detail: text,
  };
}

function reviewDetailSummary(value) {
  const text = normalizedReviewVisibleText(value);
  const clause = text.split(/[。；;，,、.!?？]/u).map((item) => item.trim()).find((item) => item.length >= 2 && item.length <= 18);
  return condensedReviewChipLabel(text) ?? clause ?? '重点说明';
}

function reviewCopyBundle({ label, command, payload, message = null }) {
  return [
    `OpenPrD Review: ${label}`,
    message ?? null,
    command ? '命令:' : null,
    command,
    '上下文:',
    payload,
  ].filter(Boolean).join('\n\n');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function reviewCommand(snapshot, status, notes = null) {
  const parts = ['openprd review . --mark', status];
  if (snapshot.versionId) {
    parts.push('--version', shellQuote(snapshot.versionId));
  }
  if (snapshot.digest) {
    parts.push('--digest', shellQuote(snapshot.digest));
  }
  if (snapshot.workUnitId) {
    parts.push('--work-unit', shellQuote(snapshot.workUnitId));
  }
  if (notes) {
    parts.push('--notes', shellQuote(notes));
  }
  return parts.join(' ');
}

function renderReviewDecision(snapshot) {
  const payload = JSON.stringify(buildReviewExportPayload(snapshot), null, 2);
  const confirmCommand = reviewCommand(snapshot, 'confirmed');
  const reviseCommand = reviewCommand(snapshot, 'needs-revision', '说明需要调整的点');
  const confirmCopy = reviewCopyBundle({ label: '认可方案', command: confirmCommand, payload });
  const reviseCopy = reviewCopyBundle({ label: '需要调整', command: reviseCommand, payload });
  return `
    <nav class="review-bottom-bar" aria-label="评审决定">
      <div class="review-bottom-bar-inner">
        <button type="button" class="review-bottom-action revise" data-copy-value="${escapeHtml(reviseCopy)}" title="${escapeHtml(reviseCommand)}">
          需要调整
        </button>
        <button type="button" class="review-bottom-action confirm" data-copy-value="${escapeHtml(confirmCopy)}" title="${escapeHtml(confirmCommand)}">
          认可方案
        </button>
      </div>
    </nav>
  `;
}

function renderReviewPage({ snapshot, sectionsData }) {
  const primaryFlows = reviewList(sectionsData.scenarios?.primaryFlows);
  const edgeCases = reviewList(sectionsData.scenarios?.edgeCases);
  const failureModes = reviewList(sectionsData.scenarios?.failureModes);
  const panels = [
    renderReviewPanel({
      kind: 'flow',
      title: '主流程与边界情况',
      description: '确认用户旅程、关键步骤和恢复路径是否已经讲清楚，能否进入实现前确认',
      emptyText: '暂无主流程、边界情况或失败路径。',
      visual: renderReviewJourneySvg({ primaryFlows, edgeCases, failureModes }),
      items: [
        ...primaryFlows,
        ...edgeCases,
        ...failureModes,
      ],
    }),
    renderReviewPanel({
      kind: 'function',
      title: '功能与约束',
      description: '区分必须交付、非功能要求和当前依赖假设',
      emptyText: '暂无功能、非功能要求或依赖约束。',
      items: [
        ...reviewList(sectionsData.requirements?.functional),
        ...reviewList(sectionsData.requirements?.nonFunctional),
        ...reviewList(sectionsData.constraints?.dependencies),
      ],
    }),
    renderReviewPanel({
      kind: 'guardrail',
      title: '业务成本与滥用护栏',
      description: '涉及免费额度、消耗型成本或第三方调用时，先确认限制、报警和止损动作',
      emptyText: '暂无业务成本或滥用护栏。',
      items: [
        ...reviewList(sectionsData.businessGuardrails?.costDrivers),
        ...reviewList(sectionsData.businessGuardrails?.usageLimits),
        ...reviewList(sectionsData.businessGuardrails?.abusePrevention),
        ...reviewList(sectionsData.businessGuardrails?.monitoringSignals),
        ...reviewList(sectionsData.businessGuardrails?.alertThresholds),
        ...reviewList(sectionsData.businessGuardrails?.stopLossActions),
      ],
    }),
    renderReviewPanel({
      kind: 'risk',
      title: '开放问题与风险',
      description: '需求定稿前还没关掉的问题要留在这里，不要默默假定解决',
      emptyText: '暂无假设、风险或开放问题。',
      items: [
        ...reviewList(sectionsData.risks?.assumptions),
        ...reviewList(sectionsData.risks?.risks),
        ...reviewList(sectionsData.risks?.openQuestions),
      ],
    }),
  ];
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(snapshot.title || 'PRD 评审')}</title>
    <style>
      :root {
        color-scheme: light;
        --review-bg: #f6f8fb;
        --review-panel: #ffffff;
        --review-panel-soft: #f9fafb;
        --review-text: #172033;
        --review-muted: #667085;
        --review-line: #d8dee8;
        --review-blue: #2563eb;
        --review-teal: #0f766e;
        --review-indigo: #4f46e5;
        --review-amber: #b45309;
        --review-red: #dc2626;
        --review-green: #15803d;
        --review-mono: "JetBrains Mono", "SFMono-Regular", Menlo, monospace;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--review-bg);
        color: var(--review-text);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow-x: hidden;
      }
      .review-page {
        max-width: 1220px;
        margin: 0 auto;
        padding: 28px 22px 120px;
      }
      .review-topbar {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 16px;
        margin-bottom: 16px;
      }
      .review-brand {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        border: 1px solid var(--review-line);
        border-radius: 999px;
        background: var(--review-panel);
        color: var(--review-muted);
        padding: 0 12px;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0;
      }
      .review-kicker {
        margin: 0 0 6px;
        color: var(--review-muted);
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0;
      }
      .review-overview,
      .review-map {
        border: 1px solid var(--review-line);
        border-radius: 8px;
        background: var(--review-panel);
        box-shadow: 0 16px 34px rgba(15, 23, 42, 0.06);
      }
      .review-overview {
        display: block;
        padding: 24px;
      }
      .review-overview-copy,
      .review-panel {
        min-width: 0;
      }
      .review-overview h1,
      .review-map h2,
      .review-panel h3 {
        margin: 0;
        color: var(--review-text);
        letter-spacing: 0;
        overflow-wrap: anywhere;
      }
      .review-overview h1 {
        font-size: 32px;
        line-height: 1.16;
        word-break: break-word;
      }
      .review-problem {
        max-width: 760px;
        margin: 12px 0 0;
        color: var(--review-muted);
        font-size: 16px;
        line-height: 1.75;
        overflow-wrap: anywhere;
      }
      .review-map {
        margin-top: 18px;
        padding: 20px;
      }
      .review-section-heading,
      .review-panel-head {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }
      .review-section-heading h2 {
        font-size: 22px;
      }
      .review-icon {
        flex: 0 0 auto;
        display: inline-flex;
        width: 38px;
        height: 38px;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
      }
      .review-icon svg {
        width: 22px;
        height: 22px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .review-icon-map { color: var(--review-indigo); background: #eef2ff; }
      .review-icon-flow { color: var(--review-teal); background: #ccfbf1; }
      .review-icon-function { color: var(--review-blue); background: #dbeafe; }
      .review-icon-guardrail { color: var(--review-amber); background: #fef3c7; }
      .review-icon-risk { color: var(--review-red); background: #fee2e2; }
      .review-map-canvas {
        margin-top: 14px;
        overflow-x: auto;
        max-width: 100%;
      }
      .review-map-canvas svg {
        display: block;
        width: 100%;
        min-width: 680px;
        height: auto;
      }
      .review-map-bg {
        fill: #f8fafc;
        stroke: #e2e8f0;
      }
      .review-map-arrow {
        fill: none;
        stroke: var(--review-indigo);
        stroke-width: 3;
        stroke-linecap: round;
      }
      .review-map-link {
        fill: none;
        stroke: #a5b4fc;
        stroke-width: 2.5;
        stroke-linecap: round;
      }
      .review-map-node {
        fill: #ffffff;
        stroke: #cbd5e1;
        stroke-width: 1.5;
        filter: drop-shadow(0 10px 16px rgba(15, 23, 42, 0.08));
      }
      .review-map-center {
        fill: #eef2ff;
        stroke: #818cf8;
        stroke-width: 1.5;
        filter: drop-shadow(0 14px 18px rgba(79, 70, 229, 0.12));
      }
      .review-map-node.node-1 { stroke: #99f6e4; }
      .review-map-node.node-2 { stroke: #bfdbfe; }
      .review-map-node.node-3 { stroke: #fde68a; }
      .review-map-node.node-4 { stroke: #fecaca; }
      .review-map-step {
        fill: var(--review-indigo);
        font-size: 13px;
        font-weight: 800;
      }
      .review-map-tag {
        fill: var(--review-muted);
        font-size: 11px;
        font-weight: 800;
      }
      .review-map-tag-pill {
        fill: #f8fafc;
        stroke: #cbd5e1;
        stroke-width: 1;
      }
      .review-map-tag-pill.center { fill: #e0e7ff; stroke: #a5b4fc; }
      .review-map-tag-pill.node-1 { fill: #ccfbf1; stroke: #5eead4; }
      .review-map-tag-pill.node-2 { fill: #dbeafe; stroke: #93c5fd; }
      .review-map-tag-pill.node-3 { fill: #fef3c7; stroke: #facc15; }
      .review-map-tag-pill.node-4 { fill: #fee2e2; stroke: #fca5a5; }
      .review-map-tag.center { fill: var(--review-indigo); }
      .review-map-tag.node-1 { fill: #0f766e; }
      .review-map-tag.node-2 { fill: #2563eb; }
      .review-map-tag.node-3 { fill: #b45309; }
      .review-map-tag.node-4 { fill: #dc2626; }
      .review-map-label {
        fill: var(--review-text);
        font-size: 12px;
        font-weight: 680;
      }
      .review-map-note {
        margin: 10px 0 0;
        color: var(--review-muted);
        font-size: 13px;
      }
      .review-panel-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        margin-top: 18px;
      }
      .review-panel {
        min-height: 260px;
        border: 1px solid var(--review-line);
        border-radius: 8px;
        background: var(--review-panel);
        padding: 18px;
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
      }
      .review-panel h3 {
        font-size: 20px;
      }
      .review-panel-head p {
        margin: 5px 0 0;
        color: var(--review-muted);
        font-size: 14px;
        line-height: 1.55;
      }
      .review-chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 16px;
        padding: 12px;
        border-radius: 8px;
        background: var(--review-panel-soft);
        border: 1px solid var(--review-line);
      }
      .review-chip {
        display: inline-flex;
        align-items: center;
        width: fit-content;
        max-width: 100%;
        min-height: 28px;
        padding: 5px 10px;
        border-radius: 999px;
        border: 1px solid var(--review-line);
        background: #ffffff;
        color: var(--review-text);
        font-size: 13px;
        font-weight: 750;
        line-height: 1.25;
        white-space: nowrap;
        overflow-wrap: normal;
        word-break: keep-all;
      }
      .review-panel-flow .review-chip { border-color: #99f6e4; background: #f0fdfa; color: #115e59; }
      .review-panel-function .review-chip { border-color: #bfdbfe; background: #eff6ff; color: #1d4ed8; }
      .review-panel-guardrail .review-chip { border-color: #fde68a; background: #fffbeb; color: #92400e; }
      .review-panel-risk .review-chip { border-color: #fecaca; background: #fff1f2; color: #991b1b; }
      .review-chip.empty {
        color: var(--review-muted);
        background: #ffffff;
        border-color: var(--review-line);
      }
      .review-journey-map {
        margin-top: 12px;
        border: 1px solid var(--review-line);
        border-radius: 8px;
        background: #f8fafc;
        overflow-x: auto;
        overflow-y: hidden;
      }
      .review-journey-map svg {
        display: block;
        width: 100%;
        min-width: 0;
        min-height: 230px;
      }
      .review-journey-bg {
        fill: #fbfdff;
        stroke: none;
      }
      .review-journey-arrow {
        fill: none;
        stroke: #0d9488;
        stroke-width: 2;
        stroke-linecap: round;
      }
      .review-journey-arrow.branch {
        stroke: #94a3b8;
        stroke-dasharray: 5 6;
      }
      .review-journey-node {
        fill: #ffffff;
        stroke-width: 1.6;
        filter: drop-shadow(0 10px 18px rgba(15, 23, 42, 0.08));
      }
      .review-journey-node.stage-journey { stroke: #5eead4; }
      .review-journey-node.stage-step { stroke: #93c5fd; }
      .review-journey-node.stage-outcome { stroke: #a5b4fc; }
      .review-journey-node.stage-boundary { stroke: #fde68a; }
      .review-journey-node.stage-recovery { stroke: #fecaca; }
      .review-journey-dot {
        fill: #0f172a;
      }
      .review-journey-dot.stage-journey { fill: #0d9488; }
      .review-journey-dot.stage-step { fill: #2563eb; }
      .review-journey-dot.stage-outcome { fill: #4f46e5; }
      .review-journey-dot.stage-boundary { fill: #ca8a04; }
      .review-journey-dot.stage-recovery { fill: #dc2626; }
      .review-journey-number {
        fill: #ffffff;
        font-size: 11px;
        font-weight: 850;
        dominant-baseline: central;
      }
      .review-journey-tag {
        fill: #64748b;
        font-size: 12px;
        font-weight: 850;
      }
      .review-journey-label {
        fill: #0f172a;
        font-size: 12px;
        font-weight: 760;
      }
      .review-panel-list {
        margin: 16px 0 0;
        padding-left: 18px;
        color: var(--review-text);
        font-size: 15px;
        line-height: 1.72;
        overflow-wrap: anywhere;
      }
      .review-panel-list li + li {
        margin-top: 9px;
      }
      .review-detail-summary {
        font-weight: 850;
        color: var(--review-text);
      }
      .review-detail-body {
        color: var(--review-text);
      }
      .review-panel-list .empty {
        color: var(--review-muted);
      }
      .review-bottom-bar {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 30;
        padding: 12px 22px calc(12px + env(safe-area-inset-bottom));
        border-top: 1px solid var(--review-line);
        background: rgba(246, 248, 251, 0.94);
        box-shadow: 0 -14px 32px rgba(15, 23, 42, 0.08);
        backdrop-filter: blur(14px);
      }
      .review-bottom-bar-inner {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        max-width: 1220px;
        margin: 0 auto;
      }
      .review-bottom-action {
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 152px;
        min-height: 48px;
        border: 1px solid transparent;
        border-radius: 12px;
        padding: 0 20px;
        font: inherit;
        font-size: 16px;
        font-weight: 850;
        letter-spacing: 0;
        line-height: 1;
        white-space: nowrap;
        box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06);
        transition: background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
      }
      .review-bottom-action.revise {
        border-color: #fecaca;
        background: #fff1f2;
        color: #b42318;
      }
      .review-bottom-action.confirm {
        border-color: #bbf7d0;
        background: #ecfdf3;
        color: #067647;
      }
      .review-bottom-action:hover,
      .review-bottom-action:focus-visible {
        box-shadow: 0 10px 22px rgba(15, 23, 42, 0.1);
        transform: translateY(-1px);
        outline: none;
      }
      .review-bottom-action.revise:hover,
      .review-bottom-action.revise:focus-visible {
        border-color: #fda4af;
        background: #ffe4e6;
      }
      .review-bottom-action.confirm:hover,
      .review-bottom-action.confirm:focus-visible {
        border-color: #86efac;
        background: #dcfce7;
      }
      .review-bottom-action:active {
        box-shadow: 0 4px 10px rgba(15, 23, 42, 0.08);
        transform: translateY(0);
      }
      @media (max-width: 860px) {
        .review-overview {
          grid-template-columns: 1fr;
        }
        .review-panel-grid {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 620px) {
        .review-page { padding: 18px 12px 128px; }
        .review-topbar { align-items: flex-start; flex-direction: column; }
        .review-overview { padding: 18px; }
        .review-overview h1 {
          font-size: 26px;
          word-break: break-all;
        }
        .review-problem { word-break: break-all; }
        .review-map-canvas svg { min-width: 0; }
        .review-journey-map svg { min-width: 620px; }
        .review-section-heading h2 { font-size: 20px; }
        .review-bottom-bar { padding-inline: 12px; }
        .review-bottom-bar-inner {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .review-bottom-action {
          justify-content: center;
          padding-inline: 10px;
          font-size: 15px;
        }
      }
    </style>
  </head>
  <body>
    <main class="review-page">
      <header class="review-topbar">
        <div class="review-brand">OpenPrd / 评审面板</div>
      </header>
      ${renderReviewOverview(snapshot, sectionsData)}
      ${renderReviewFlowSvg(snapshot, sectionsData)}
      <section class="review-panel-grid" aria-label="固定评审项">
        ${panels.join('\n')}
      </section>
      ${renderReviewDecision(snapshot)}
      <script>
        async function copyReviewText(text) {
          try {
            await navigator.clipboard.writeText(text);
          } catch (error) {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
          }
        }
        function flashCopied(button) {
          const old = button.innerHTML;
          button.textContent = '已复制';
          setTimeout(() => { button.innerHTML = old; }, 1200);
        }
        document.querySelectorAll('[data-copy-value]').forEach((button) => {
          button.addEventListener('click', async () => {
            await copyReviewText(button.dataset.copyValue || '');
            flashCopied(button);
          });
        });
      </script>
    </main>
  </body>
</html>`;
}

function toYamlLines(value, depth = 0) {
  const indent = '  '.repeat(depth);
  const scalar = (input) => JSON.stringify(String(input ?? ''));
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}[]`];
    return value.flatMap((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const [firstKey] = Object.keys(item);
        const nested = toYamlLines(item[firstKey], depth + 1);
        return [`${indent}- ${firstKey}:`, ...nested];
      }
      return [`${indent}- ${scalar(item)}`];
    });
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => {
      if (Array.isArray(entry) || (entry && typeof entry === 'object')) {
        return [`${indent}${key}:`, ...toYamlLines(entry, depth + 1)];
      }
      return [`${indent}${key}: ${scalar(entry)}`];
    });
  }
  return [`${indent}${scalar(value)}`];
}

function renderArtifactFrontmatter(value) {
  const lines = ['---'];
  for (const [key, entry] of Object.entries(value)) {
    if (Array.isArray(entry) || (entry && typeof entry === 'object')) {
      lines.push(`${key}:`);
      lines.push(...toYamlLines(entry, 1));
    } else {
      lines.push(`${key}: ${String(entry ?? '')}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

function playgroundFieldDefinitions() {
  return [
    { key: 'problemStatement', label: '问题定义', kind: 'text' },
    { key: 'goals', label: '目标', kind: 'list' },
    { key: 'successMetrics', label: '成功指标', kind: 'list' },
    { key: 'inScope', label: '范围内', kind: 'list' },
    { key: 'outOfScope', label: '范围外', kind: 'list' },
    { key: 'primaryFlows', label: '主流程', kind: 'list' },
    { key: 'openQuestions', label: '开放问题', kind: 'list' },
  ];
}

export function renderPlaygroundMarkdown({ snapshot, state }) {
  const capturePatch = {
    'problem.problemStatement': { value: state.problemStatement, source: 'user-confirmed' },
    'goals.goals': { value: state.goals, source: 'user-confirmed' },
    'goals.successMetrics': { value: state.successMetrics, source: 'user-confirmed' },
    'scope.inScope': { value: state.inScope, source: 'user-confirmed' },
    'scope.outOfScope': { value: state.outOfScope, source: 'user-confirmed' },
    'scenarios.primaryFlows': { value: state.primaryFlows, source: 'user-confirmed' },
    'risks.openQuestions': { value: state.openQuestions, source: 'user-confirmed' },
  };
  const frontmatter = renderArtifactFrontmatter({
    schema: 'openprd.artifact.v1',
    kind: 'playground',
    versionId: snapshot.versionId,
    title: snapshot.title,
    capturePatch,
    editableState: state,
  });
  return `${frontmatter}# 调试数据\n\n## 问题定义\n\n${state.problemStatement || '待补充'}\n\n## 目标\n\n${state.goals.map((item) => `- ${item}`).join('\n') || '- 待补充'}\n\n## 成功指标\n\n${state.successMetrics.map((item) => `- ${item}`).join('\n') || '- 待补充'}\n\n## 范围内\n\n${state.inScope.map((item) => `- ${item}`).join('\n') || '- 待补充'}\n\n## 范围外\n\n${state.outOfScope.map((item) => `- ${item}`).join('\n') || '- 待补充'}\n\n## 主流程\n\n${state.primaryFlows.map((item) => `- ${item}`).join('\n') || '- 待补充'}\n\n## 开放问题\n\n${state.openQuestions.map((item) => `- ${item}`).join('\n') || '- 待补充'}\n`;
}

export function renderPlaygroundPatch({ state }) {
  return {
    'problem.problemStatement': { value: state.problemStatement, source: 'user-confirmed' },
    'goals.goals': { value: state.goals, source: 'user-confirmed' },
    'goals.successMetrics': { value: state.successMetrics, source: 'user-confirmed' },
    'scope.inScope': { value: state.inScope, source: 'user-confirmed' },
    'scope.outOfScope': { value: state.outOfScope, source: 'user-confirmed' },
    'scenarios.primaryFlows': { value: state.primaryFlows, source: 'user-confirmed' },
    'risks.openQuestions': { value: state.openQuestions, source: 'user-confirmed' },
  };
}

export function renderPlaygroundArtifact({ snapshot, state, markdownPath, patchPath }) {
  const fields = playgroundFieldDefinitions();
  const formControls = fields.map((field) => `
    <label class="card">
      <div class="card-header">${escapeHtml(field.label)}</div>
      <div class="card-body">
        ${field.kind === 'text'
          ? `<textarea data-field="${field.key}" rows="4">${escapeHtml(state[field.key] ?? '')}</textarea>`
          : `<textarea data-field="${field.key}" rows="6">${escapeHtml((state[field.key] ?? []).join('\n'))}</textarea>`}
      </div>
    </label>
  `).join('\n');

  const initialMarkdown = renderPlaygroundMarkdown({ snapshot, state });
  const initialPatch = renderPlaygroundPatch({ state });

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(snapshot.title)} Playground</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #fffaf0;
        --panel: #ffffff;
        --line: rgba(15,23,42,0.12);
        --text: #1f2937;
        --muted: #6b7280;
        --accent: #0f766e;
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--text); font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .page { max-width: 1320px; margin: 0 auto; padding: 24px; }
      h1 { margin: 0 0 8px; font-size: 42px; }
      .subtitle { margin: 0 0 20px; color: var(--muted); line-height: 1.7; }
      .chip-row { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
      .chip { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; padding: 6px 10px; background: #fff; color: var(--muted); font-size: 12px; }
      .layout { display: grid; grid-template-columns: minmax(320px, 0.95fr) minmax(360px, 1.05fr); gap: 16px; }
      .form-grid { display: grid; gap: 14px; }
      .card { border: 1px solid var(--line); border-radius: 18px; background: var(--panel); overflow: hidden; }
      .card-header { padding: 12px 16px 0; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
      .card-body { padding: 12px 16px 16px; }
      textarea { width: 100%; border: 1px solid var(--line); border-radius: 12px; padding: 12px; font: inherit; line-height: 1.6; resize: vertical; }
      .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
      button { border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; background: #fff; cursor: pointer; }
      .primary { background: #0f766e; color: #fff; border-color: #0f766e; }
      pre { margin: 0; border-radius: 14px; background: #111827; color: #e5e7eb; padding: 14px; overflow: auto; white-space: pre-wrap; line-height: 1.6; font-size: 13px; }
      .hint { color: var(--muted); font-size: 13px; line-height: 1.6; }
      .top-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: -4px;
      }
      .meta-chip {
        display: inline-flex;
        width: fit-content;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.85);
        color: var(--muted);
        font-size: 12px;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 12px;
      }
      .copy-button {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid rgba(15,23,42,0.18);
        border-radius: 999px;
        background: #fff;
        color: var(--text);
        padding: 9px 14px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      .copy-button:hover {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px var(--accent-soft);
      }
      @media (max-width: 980px) { .layout { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main class="page">
      <h1>${escapeHtml(snapshot.title)} 调试面板</h1>
      <p class="subtitle">左侧调整关键 PRD 参数，右侧会实时生成 Markdown 数据源和 capture patch。你可以复制 Markdown、复制 patch，或下载文件后再用 <code>openprd capture --artifact-markdown</code> 导回工作区。</p>
      <div class="chip-row">
        <span class="chip">版本: ${escapeHtml(snapshot.versionId)}</span>
        <span class="chip">Markdown 数据源: ${escapeHtml(markdownPath)}</span>
        <span class="chip">捕获补丁: ${escapeHtml(patchPath)}</span>
      </div>
      <section class="layout">
        <div class="form-grid">${formControls}
          <div class="card">
            <div class="card-header">操作</div>
            <div class="card-body">
              <div class="actions">
                <button id="copyMarkdown" class="primary">复制更新后的 Markdown</button>
                <button id="copyPatch">复制捕获补丁 JSON</button>
                <button id="downloadMarkdown">下载 data.md</button>
                <button id="downloadPatch">下载 capture-patch.json</button>
              </div>
              <p class="hint">推荐流程：在这里微调参数 -> 复制或下载 Markdown / patch -> 运行 <code>openprd capture . --artifact-markdown &lt;data.md&gt;</code> 或使用 JSON patch 导回。</p>
            </div>
          </div>
        </div>
        <div class="form-grid">
          <div class="card">
            <div class="card-header">Markdown 数据源</div>
            <div class="card-body"><pre id="markdownPreview">${escapeHtml(initialMarkdown)}</pre></div>
          </div>
          <div class="card">
            <div class="card-header">捕获补丁 JSON</div>
            <div class="card-body"><pre id="patchPreview">${escapeHtml(JSON.stringify(initialPatch, null, 2))}</pre></div>
          </div>
        </div>
      </section>
    </main>
    <script>
      const fields = ${JSON.stringify(fields)};
      const state = ${JSON.stringify(state)};
      const markdownPreview = document.getElementById('markdownPreview');
      const patchPreview = document.getElementById('patchPreview');

      function splitList(value) {
        return String(value || '').split(/\\n+/).map((item) => item.trim()).filter(Boolean);
      }

      function yamlValue(value, depth = 0) {
        const indent = '  '.repeat(depth);
        if (Array.isArray(value)) {
          if (value.length === 0) return [indent + '[]'];
          return value.map((item) => indent + '- ' + JSON.stringify(String(item ?? '')));
        }
        if (value && typeof value === 'object') {
          return Object.entries(value).flatMap(([key, entry]) => {
            if (Array.isArray(entry) || (entry && typeof entry === 'object')) {
              return [indent + key + ':', ...yamlValue(entry, depth + 1)];
            }
            return [indent + key + ': ' + JSON.stringify(String(entry ?? ''))];
          });
        }
        return [indent + JSON.stringify(String(value ?? ''))];
      }

      function buildPatch() {
        return {
          "problem.problemStatement": { value: state.problemStatement, source: "user-confirmed" },
          "goals.goals": { value: state.goals, source: "user-confirmed" },
          "goals.successMetrics": { value: state.successMetrics, source: "user-confirmed" },
          "scope.inScope": { value: state.inScope, source: "user-confirmed" },
          "scope.outOfScope": { value: state.outOfScope, source: "user-confirmed" },
          "scenarios.primaryFlows": { value: state.primaryFlows, source: "user-confirmed" },
          "risks.openQuestions": { value: state.openQuestions, source: "user-confirmed" }
        };
      }

      function buildMarkdown() {
        const patch = buildPatch();
        const frontmatter = ['---',
          'schema: openprd.artifact.v1',
          'kind: playground',
          'versionId: ${escapeHtml(snapshot.versionId)}',
          'title: ${escapeHtml(snapshot.title)}',
          'capturePatch:',
          ...yamlValue(patch, 1),
          'editableState:',
          ...yamlValue(state, 1),
          '---',
          '',
          '# 调试数据',
          '',
          '## 问题定义',
          '',
          state.problemStatement || '待补充',
          '',
          '## 目标',
          '',
          ...(state.goals.length ? state.goals.map((item) => '- ' + item) : ['- 待补充']),
          '',
          '## 成功指标',
          '',
          ...(state.successMetrics.length ? state.successMetrics.map((item) => '- ' + item) : ['- 待补充']),
          '',
          '## 范围内',
          '',
          ...(state.inScope.length ? state.inScope.map((item) => '- ' + item) : ['- 待补充']),
          '',
          '## 范围外',
          '',
          ...(state.outOfScope.length ? state.outOfScope.map((item) => '- ' + item) : ['- 待补充']),
          '',
          '## 主流程',
          '',
          ...(state.primaryFlows.length ? state.primaryFlows.map((item) => '- ' + item) : ['- 待补充']),
          '',
          '## 开放问题',
          '',
          ...(state.openQuestions.length ? state.openQuestions.map((item) => '- ' + item) : ['- 待补充']),
          ''
        ];
        return frontmatter.join('\\n');
      }

      function refreshOutputs() {
        markdownPreview.textContent = buildMarkdown();
        patchPreview.textContent = JSON.stringify(buildPatch(), null, 2);
      }

      document.querySelectorAll('textarea[data-field]').forEach((textarea) => {
        textarea.addEventListener('input', () => {
          const field = textarea.dataset.field;
          const definition = fields.find((item) => item.key === field);
          state[field] = definition.kind === 'text' ? textarea.value.trim() : splitList(textarea.value);
          refreshOutputs();
        });
      });

      async function copyText(text) {
        await navigator.clipboard.writeText(text);
      }

      document.getElementById('copyMarkdown').addEventListener('click', () => copyText(markdownPreview.textContent));
      document.getElementById('copyPatch').addEventListener('click', () => copyText(patchPreview.textContent));

      function download(name, text) {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        URL.revokeObjectURL(url);
      }

      document.getElementById('downloadMarkdown').addEventListener('click', () => download('playground.data.md', markdownPreview.textContent));
      document.getElementById('downloadPatch').addEventListener('click', () => download('playground.capture-patch.json', patchPreview.textContent));

      refreshOutputs();
    </script>
  </body>
</html>`;
}

export function renderReviewArtifact({ snapshot }) {
  const sectionsData = snapshot.sections ?? {};
  return renderReviewPage({ snapshot, sectionsData });
}

export function renderRegressionArtifact({ task, report }) {
  const passed = report.summary.failed === 0;
  const summaryCards = [
    metricCard('任务', task.id, task.title),
    metricCard('验证方式', report.kind || 'command', report.verifyCommand || '未指定'),
    metricCard('通过用例', `${report.summary.passed}/${report.summary.total}`, '本次回归通过的测试用例数量'),
    metricCard('失败用例', `${report.summary.failed}`, '需要继续修复或补证据的测试用例数量'),
  ];

  const sections = [
    card('回归用例清单', report.cases.map((item) => `
      <div class="qa-item ${item.passed ? 'success' : 'warning'}">
        <div class="qa-label">${escapeHtml(item.id)} · ${escapeHtml(item.title)}</div>
        <div class="qa-status-row">
          <div class="status-badge mini-status ${item.passed ? 'status-pass' : 'status-fail'}">${item.passed ? '通过' : '未通过'}</div>
        </div>
        <div class="qa-meta">预期: ${escapeHtml(item.expected)}</div>
        <div class="qa-meta">结果: ${escapeHtml(item.actual)}</div>
        <div class="qa-meta">证据: ${escapeHtml(leafName(item.evidence))}</div>
      </div>
    `).join('\n')),
    ...(report.screenshots?.length ? [
      card('截图证据', report.screenshots.map((item) => `
        <div class="evidence-item">
          <div class="card-body"><img src="${escapeHtml(item.url)}" alt="截图证据" style="max-width:100%; border-radius:12px; border:1px solid rgba(15,23,42,0.12);" /></div>
        </div>
      `).join('\n')),
    ] : []),
    formatExportItem({
      title: '结构化回归结论',
      description: '供后续 commit、handoff、回归复跑或汇总报告使用。',
      payload: JSON.stringify(report, null, 2),
    }),
  ];

  return pageShell({
    eyebrow: 'OpenPrd / 回归报告',
    title: `${task.id} 回归验证`,
    subtitle: '执行结果必须沉淀成结构化回归资产，而不是只把 verify 命令跑一遍。',
    statusBadge: passed
      ? { label: '通过', className: 'status-pass' }
      : { label: '未通过', className: 'status-fail' },
    topMeta: [
      `任务来源: ${task.changeId}`,
    ],
    summaryCards,
    sections,
    footer: '',
  });
}

function qualityStatusLabel(status) {
  if (status === 'pass') return '通过';
  if (status === 'fail') return '失败';
  if (status === 'needs-evidence') return '需补证据';
  if (status === 'advisory') return '建议关注';
  if (status === 'waived') return '已豁免';
  return '需关注';
}

function qualityStatusClass(status) {
  if (status === 'pass') return 'success';
  if (status === 'fail') return 'warning';
  return 'warning';
}

function qualityBadgeClass(status) {
  if (status === 'production-ready') return 'status-pass';
  if (status === 'failed') return 'status-fail';
  return 'status-warn';
}

function miniMetric(title, metric, subtext) {
  return `
    <div class="mini-metric">
      <div class="mini-metric-label">${escapeHtml(title)}</div>
      <div class="mini-metric-value">${escapeHtml(metric)}</div>
      <div class="mini-metric-sub">${escapeHtml(subtext)}</div>
    </div>
  `;
}

function auditStatusClass(status) {
  if (status === 'pass' || status === 'production-ready' || status === 'waived') return 'audit-pass';
  if (status === 'fail' || status === 'failed' || status === 'needs-attention') return 'audit-fail';
  if (status === 'needs-evidence') return 'audit-evidence';
  return 'audit-advisory';
}

function auditGateDecision(gate) {
  if (gate.required && gate.status === 'pass') return '本期必测块已通过';
  if (gate.required && gate.status === 'waived') return '已豁免，需保留依据';
  if (gate.required) return '本期必测未通过，不能宣称就绪';
  if (gate.status === 'pass') return '按风险确认项已有证据';
  if (gate.status === 'advisory') return '当前可选，风险进入范围后升级';
  return '当前不阻断，建议补证据';
}

function auditChips(items, emptyText = '无') {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (list.length === 0) return `<span class="audit-chip muted">${escapeHtml(emptyText)}</span>`;
  return list.map((item) => `<span class="audit-chip">${escapeHtml(item)}</span>`).join('\n');
}

function auditActionItems(report) {
  const requiredGates = report.gates.filter((gate) => gate.required);
  const failingRequired = requiredGates.filter((gate) => !['pass', 'waived'].includes(gate.status));
  const advisory = report.gates.filter((gate) => !gate.required && gate.status !== 'pass');
  if (failingRequired.length > 0) {
    return failingRequired.map((gate) => `${reviewerGateDisplay(gate)}: ${gate.warnings[0] ?? gate.evidence?.summary ?? '补齐必需证据后再继续'}`);
  }
  if (advisory.length > 0) {
    return advisory.map((gate) => `${reviewerGateDisplay(gate)}: ${auditGateDecision(gate)}`);
  }
  return ['当前本期必测块全部通过；继续保留本次执行证据，交付前复跑 openprd run --verify。'];
}

function auditEvidenceRows(report) {
  return report.gates.flatMap((gate) => {
    const sources = gate.evidence?.sources ?? [];
    if (sources.length === 0) {
      return [{
        gate,
        source: '未提供',
        path: gate.required ? '缺少必需证据' : '当前场景未要求',
        empty: true,
      }];
    }
    return sources.map((source) => ({
      gate,
      source: source.source ?? 'evidence',
      path: source.path ?? 'unknown',
      empty: false,
    }));
  });
}

function reviewerGateFocus(gate) {
  const focusByGate = {
    smoke: '看主流程和最容易出错的失败路径是否真的跑过，而不是只写了测试文件。',
    'feature-coverage': '看本次需求、任务和验收点是否都被覆盖；如果没有激活任务，要确认这是不是合理状态。',
    'business-guardrails': '看成本、免费额度、滥用、报警和止损动作是否讲清楚，避免上线后失控。',
    traceability: '看出问题时能不能从用户动作追到请求、任务和错误，方便复现和定位。',
    redaction: '看日志、截图、报告和错误信息里是否可能泄露用户隐私、密钥或敏感业务数据。',
    'normal-performance': '看普通规模下是否会卡顿、超时、资源异常，是否有可比较的基线。',
    'extreme-performance': '看大数据、并发、异常输入或边界规模下是否有兜底，不只是跑小样本。',
    knowledge: '看这次发现的问题是否值得沉淀，避免下次 Agent 或团队重复踩同一个坑。',
  };
  return focusByGate[gate.id] ?? '看这个测试块是否和本次需求相关，证据是否来自本次执行。';
}

function reviewerGateQuestion(gate) {
  if (gate.required && gate.status === 'pass') {
    return '你可以抽查证据是否对应本次需求；如果证据太泛，要求 Agent 补本次执行记录。';
  }
  if (gate.required) {
    return '这里不能放行。请要求 Agent 补证据、修复问题，并重新生成回归测试报告。';
  }
  if (gate.status === 'pass') {
    return '当前不阻断；你只需要判断这项是否和本次风险相关，必要时抽查证据。';
  }
  return '你要决定是否接受本次不补；如果准备发布或风险变高，应要求升级为本期必测。';
}

function reviewerScenarioLabel(tag) {
  const labels = {
    core: '基础验证',
    frontend: '界面体验',
    desktop: '桌面端体验',
    backend: '服务与数据处理',
    businessCost: '成本与滥用风险',
    security: '隐私与安全',
    performance: '性能风险',
    extreme: '极端场景',
    release: '上线交付',
    legacy: '历史兼容',
  };
  return labels[tag] ?? tag;
}

function reviewerGateLabel(report, gateId) {
  const gate = report.gates.find((item) => item.id === gateId);
  return reviewerGateDisplay(gate ?? { id: gateId, label: gateId });
}

function reviewerGateDisplay(gate) {
  if (gate.id === 'knowledge') return '经验沉淀';
  return String(gate.label ?? gate.id).replace(/\s*Skill\s*/g, ' ');
}

function reviewerEnforcementLabel(value) {
  if (value === 'blocking') return '严格阻断';
  if (value === 'advisory') return '建议模式';
  return value ?? '未标明';
}

function reviewerPolicyLabels(report) {
  const policy = report.qualityPolicy ?? { scenarioTags: [], requiredGates: [], optionalGates: [] };
  return {
    scenarioLabels: policy.scenarioTags.map(reviewerScenarioLabel),
    requiredLabels: policy.requiredGates.map((gateId) => reviewerGateLabel(report, gateId)),
    optionalLabels: policy.optionalGates.map((gateId) => reviewerGateLabel(report, gateId)),
  };
}

function reviewerDecisionPayload(report, actionItems) {
  const labels = reviewerPolicyLabels(report);
  const failingRequired = report.gates
    .filter((gate) => gate.required && !['pass', 'waived'].includes(gate.status))
    .map(reviewerGateDisplay);
  const advisory = report.gates
    .filter((gate) => !gate.required && gate.status !== 'pass')
    .map(reviewerGateDisplay);
  return [
    `我看了回归测试报告 ${report.id}，我的确认意见如下：`,
    '',
    `1. 场景判断：${labels.scenarioLabels.join(', ') || '未标明'}。我认为这个场景【接受 / 不接受】，原因是：`,
    `2. 本期必测块：${labels.requiredLabels.join(', ') || '无'}。我认为这些回归结果【可信 / 不可信】，需要补充：`,
    `3. 需确认遗漏：${advisory.join(', ') || '无'}。我选择【不属于本期，可延期 / 属于本期，需要现在补齐】。`,
    `4. 放行结论：${failingRequired.length === 0 ? '本期必测块可以继续，但请按我的选择处理需确认遗漏。' : `我不同意放行，未通过项包括：${failingRequired.join(', ')}`}`,
    '',
    '我希望 Agent 接下来处理：',
    ...actionItems.map((item) => `- ${item}`),
  ].join('\n');
}

function reviewerEvidencePayload(report) {
  const missing = report.gates.filter((gate) => gate.status !== 'pass' || !gate.evidence?.present);
  return [
    `请根据回归测试报告 ${report.id} 补齐或解释以下回归遗漏：`,
    '',
    ...missing.map((gate) => [
      `- ${reviewerGateDisplay(gate)}（${gate.required ? '本期必测' : '按风险确认'}，当前状态：${qualityStatusLabel(gate.status)}）`,
      `  我要确认：${reviewerGateFocus(gate)}`,
      `  你需要补充：${regressionHumanText(gate.warnings[0] ?? gate.evidence?.summary ?? '本次执行证据、覆盖范围和判断理由')}`,
    ].join('\n')),
    '',
    '补完后请重新运行 openprd quality . --verify 和 openprd run . --verify，并给我新的报告链接。',
  ].join('\n');
}

function reviewerScenarioPayload(report) {
  const labels = reviewerPolicyLabels(report);
  return [
    `我想重新确认回归测试场景。当前报告 ${report.id} 的场景是：${labels.scenarioLabels.join(', ') || '未标明'}。`,
    '',
    '请你重新判断：',
    '- 这个需求是否其实应该按上线交付 / 隐私与安全 / 性能风险 / 服务与数据处理 / 极端场景处理？',
    '- 哪些按风险确认的测试块应该升级为本期必测？',
    '- 如果仍保持当前场景，请用面向评审者的语言解释为什么。',
    '',
    `当前本期必测块：${labels.requiredLabels.join(', ') || '无'}`,
  ].join('\n');
}

function reviewCopyCard(title, description, payload) {
  return `
    <div class="review-copy">
      <div class="review-copy-head">
        <div>
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(description)}</span>
        </div>
        <button type="button" data-copy-nearest>复制回对话</button>
      </div>
      <textarea readonly data-review-copy>${escapeHtml(payload)}</textarea>
    </div>
  `;
}

function regressionGateCopyPayload(gate, report) {
  const warnings = gate.warnings.map(regressionHumanText);
  const missingText = warnings.length > 0
    ? warnings.map((item) => `- ${item}`).join('\n')
    : `- ${gate.evidence?.summary ?? '请补充本次执行证据和判断理由'}`;
  return [
    `请处理回归测试报告 ${report.id} 里的这项问题：${reviewerGateDisplay(gate)}`,
    '',
    `当前状态：${regressionResultLabel(gate)}`,
    `本期要求：${gate.required ? '本期必须处理' : '请判断是否属于本期'}`,
    `我关心的是：${regressionBlockDescription(gate)}`,
    '',
    '当前问题：',
    missingText,
    '',
    '请你接下来：',
    '1. 如果属于本期需求，请直接修复、补测或补证据。',
    '2. 如果你认为可以延期，请用需求视角说明原因、影响和后续条件。',
    '3. 处理后重新运行 openprd quality . --verify 和 openprd run . --verify，并给我新的报告链接。',
  ].join('\n');
}

function regressionGateHints(gate) {
  if (gate.required && gate.status !== 'pass') {
    return [
      '不要让用户决策是否修；先按本期必测块修复或补证据。',
      '补完后重新生成报告，确认必须修复数归零。',
    ];
  }
  if (gate.id === 'feature-coverage' && gate.evidence?.summary === '当前没有激活任务清单') {
    return [
      '如果这是具体需求交付，先补 active change/tasks.md。',
      '把新增、修改、删除、异常路径拆成可验收任务后再回归。',
    ];
  }
  if (gate.status === 'needs-evidence') {
    return [
      '先确认项目是否只是有能力但缺本次执行证据。',
      '如果属于本期风险，补一次实际运行记录，而不是只引用脚本存在。',
    ];
  }
  return [
    '先判断它是否真的属于本期需求风险。',
    '属于本期就补测；不属于本期才写清延期理由和触发条件。',
  ];
}

function regressionGateSimpleSuggestion(gate) {
  if (gate.required && gate.status !== 'pass') return '先修复或补证据，再重跑报告。';
  if (gate.id === 'feature-coverage' && gate.evidence?.summary === '当前没有激活任务清单') {
    return '具体需求交付时先补 tasks.md。';
  }
  if (gate.status === 'needs-evidence') return '如果属于本期，就补本次执行证据。';
  return '相关就补测，不相关就写清延期理由。';
}

function regressionResultLabel(gate) {
  if (gate.status === 'pass') return '已通过';
  if (gate.required) return '未通过';
  if (gate.status === 'needs-evidence') return '缺少证据';
  if (gate.status === 'advisory') return '需确认是否本期处理';
  return qualityStatusLabel(gate.status);
}

function regressionResultClass(gate) {
  if (gate.status === 'pass') return 'audit-pass';
  if (gate.required) return 'audit-fail';
  if (gate.status === 'needs-evidence') return 'audit-evidence';
  return 'audit-advisory';
}

function regressionExpectation(gate) {
  if (gate.id === 'feature-coverage' && gate.evidence?.summary === '当前没有激活任务清单') {
    return '全项目检查可接受；具体需求交付时必须有任务拆解';
  }
  if (gate.required) return '本期必须通过';
  return '本期默认不阻断；若需求涉及此风险，应升级为本期测试';
}

function regressionTreatment(gate) {
  if (gate.id === 'feature-coverage' && gate.evidence?.summary === '当前没有激活任务清单') {
    return '如果这是具体需求交付，应先补 active change/tasks，否则无法证明新增/修改/删除等需求项逐项回归。';
  }
  if (gate.required && gate.status === 'pass') return '不需要人工评审；保留证据即可继续。';
  if (gate.required) return '应当现在修复或补证据，修完后重新生成报告。';
  if (gate.status === 'pass') return '已覆盖，可作为辅助证据保留。';
  return '需要判断是否属于本期需求；属于就现在补测，不属于才记录为后续风险。';
}

function regressionBlockDescription(gate) {
  const descriptions = {
    smoke: '核心路径能否跑通，至少覆盖主流程和最关键的失败路径。',
    'feature-coverage': '需求拆解项是否全部完成，验收点是否有对应回归。',
    'business-guardrails': '成本、额度、滥用、报警、止损是否有明确保护。',
    traceability: '出问题时是否能追到用户动作、请求、任务和错误。',
    redaction: '报告、日志和错误信息是否会暴露隐私、密钥或敏感数据。',
    'normal-performance': '普通规模下是否可用、不卡顿、不超时。',
    'extreme-performance': '大数据、并发、异常输入、边界规模是否有兜底。',
    knowledge: '本次问题是否需要沉淀成经验，避免下次重复漏测。',
  };
  return descriptions[gate.id] ?? reviewerGateFocus(gate);
}

function regressionHumanText(value) {
  return String(value ?? '')
    .replace(/阻断此门禁/g, '作为本期必测阻断')
    .replace(/必需门禁/g, '本期必测块')
    .replace(/可选门禁/g, '按风险确认项')
    .replace(/门禁/g, '测试块');
}

function regressionTaskStatus(task) {
  if (task.done) return '已完成';
  if (task.blocked) return '阻塞';
  return '未完成';
}

function regressionRequirementRows(activeTasks, report) {
  const tasks = activeTasks.tasks ?? [];
  const requiredGates = report.gates.filter((gate) => gate.required);
  const requiredPassed = requiredGates.filter((gate) => ['pass', 'waived'].includes(gate.status)).length;
  const failingRequired = requiredGates.filter((gate) => !['pass', 'waived'].includes(gate.status));
  const advisoryGates = report.gates.filter((gate) => !gate.required && gate.status !== 'pass');
  if (tasks.length === 0) {
    return `
      <tr class="audit-evidence">
        <td>当前没有激活需求任务</td>
        <td>项目级必测 ${escapeHtml(`${requiredPassed}/${requiredGates.length}`)} 通过</td>
        <td>如果这是具体需求交付，应先生成或保留 tasks.md，再逐项回归。</td>
      </tr>
    `;
  }
  return tasks.map((task) => {
    const statusClass = !task.done || failingRequired.length > 0
      ? 'audit-fail'
      : advisoryGates.length > 0
        ? 'audit-advisory'
        : 'audit-pass';
    const conclusion = !task.done
      ? '不能放行，应完成或明确延期原因。'
      : failingRequired.length > 0
        ? '不能放行，仍有本期必测块未通过。'
        : advisoryGates.length > 0
          ? '功能已完成；需确认风险项是否属于本期。'
          : '通过，无需人工评审。';
    return `
      <tr class="${statusClass}">
        <td>
          <strong>${escapeHtml(task.title)}</strong>
          <span><code>${escapeHtml(`${task.source}:${task.line}`)}</code></span>
        </td>
        <td>${escapeHtml(regressionTaskStatus(task))} · 必测 ${escapeHtml(`${requiredPassed}/${requiredGates.length}`)}</td>
        <td>${escapeHtml(conclusion)}</td>
      </tr>
    `;
  }).join('\n');
}

function regressionGateSummaryCards(report) {
  return report.gates.map((gate) => `
    <div class="audit-block-card ${regressionResultClass(gate)}">
      <div class="audit-block-card-head">
        <strong>${escapeHtml(reviewerGateDisplay(gate))}</strong>
        <span class="audit-status ${regressionResultClass(gate)}">${escapeHtml(regressionResultLabel(gate))}</span>
      </div>
      <div class="audit-block-meta">
        <span>${gate.required ? '本期必测' : '按风险确认'}</span>
        <span>${gate.evidence?.present ? `${gate.evidence.sources.length} 条证据` : '缺少本次证据'}</span>
      </div>
    </div>
  `).join('\n');
}

function regressionExceptionItems(report) {
  const items = report.gates.filter((gate) => gate.required ? gate.status !== 'pass' : gate.status !== 'pass');
  if (items.length === 0) {
    return '<div class="audit-empty">没有未通过或需确认的回归块。查看者只需要确认报告对应的是本次需求即可。</div>';
  }
  return items.map((gate) => `
    <div class="audit-risk-card ${regressionResultClass(gate)}">
      <div class="audit-risk-card-head">
        <div>
          <strong>${escapeHtml(reviewerGateDisplay(gate))}</strong>
          <span>${escapeHtml(regressionResultLabel(gate))}</span>
        </div>
        <button type="button" data-copy-nearest>复制给 Agent</button>
      </div>
      <p>${escapeHtml(regressionBlockDescription(gate))}</p>
      <div class="qa-meta">${escapeHtml(regressionGateSimpleSuggestion(gate))}</div>
      <textarea readonly class="copy-source" data-review-copy>${escapeHtml(regressionGateCopyPayload(gate, report))}</textarea>
    </div>
  `).join('\n');
}

export function renderQualityEvalArtifact({ report }) {
  return renderQualityEvalArtifactV2({ report });
}

function learningSourceAnchor(sourceId) {
  return `source-${slugify(sourceId, 'source')}`;
}

function learningAssetUrl(rawPath) {
  const value = String(rawPath ?? '').trim();
  if (!value) return null;
  if (/^(?:https?:|data:|file:)/i.test(value)) return value;
  if (path.isAbsolute(value)) return pathToFileURL(value).href;
  return encodeURI(value.split(path.sep).join('/'));
}

function formatLearningParagraphs(paragraphs) {
  const list = Array.isArray(paragraphs) ? paragraphs.filter(Boolean) : [];
  return list.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n');
}

function formatLearningEvidenceChips(sourceIds) {
  const list = Array.isArray(sourceIds) ? sourceIds.filter(Boolean) : [];
  if (list.length === 0) {
    return '<span class="evidence-chip muted">暂无证据引用</span>';
  }
  return list.map((id) => `
    <span class="evidence-chip">${escapeHtml(id)}</span>
  `).join('\n');
}

function formatLearningRetrievalBlocks(blocks, chapterId) {
  const list = Array.isArray(blocks) ? blocks.filter(Boolean) : [];
  if (list.length === 0) return '';
  return `
    <section class="learning-block retrieval" id="${escapeHtml(chapterId)}-retrieval">
      <h4>检索练习</h4>
      ${list.map((block, index) => `
        <details class="retrieval-item" id="${escapeHtml(chapterId)}-retrieval-${index + 1}">
          <summary><span>R${index + 1}</span>${escapeHtml(block.prompt)}</summary>
          ${block.hint ? `<div class="retrieval-hint">提示: ${escapeHtml(block.hint)}</div>` : ''}
          <div class="retrieval-answer">参考答案: ${escapeHtml(block.answer)}</div>
        </details>
      `).join('\n')}
    </section>
  `;
}

function formatLearningWorkedExamples(examples, chapterId) {
  const list = Array.isArray(examples) ? examples.filter(Boolean) : [];
  if (list.length === 0) return '';
  return `
    <section class="learning-block worked" id="${escapeHtml(chapterId)}-worked">
      <h4>工作示例</h4>
      ${list.map((example, index) => `
        <div class="worked-item" id="${escapeHtml(chapterId)}-worked-${index + 1}">
          <div class="worked-title">${escapeHtml(example.title)}</div>
          <p>${escapeHtml(example.scenario)}</p>
          <ol>${listMarkup(example.steps, '暂无步骤')}</ol>
          ${example.principle ? `<div class="worked-principle">原则: ${escapeHtml(example.principle)}</div>` : ''}
        </div>
      `).join('\n')}
    </section>
  `;
}

function formatLearningVisualExplainer(explainer, chapterId) {
  if (!explainer || typeof explainer !== 'object') return '';
  const takeaways = Array.isArray(explainer.takeaways) ? explainer.takeaways.filter(Boolean) : [];
  const imageUrl = learningAssetUrl(explainer.image?.path);
  const hasImage = Boolean(imageUrl);
  return `
    <section class="learning-block visual" id="${escapeHtml(chapterId)}-visual">
      <div class="visual-header">
        <div class="visual-kicker">一眼看懂</div>
        <h4>${escapeHtml(explainer.title ?? '图文解释')}</h4>
      </div>
      <div class="visual-grid${hasImage ? ' has-image' : ''}">
        ${hasImage ? `
          <figure class="visual-figure">
            <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(explainer.image?.alt ?? explainer.title ?? 'visual explainer')}" loading="lazy" />
            ${explainer.image?.caption ? `<figcaption>${escapeHtml(explainer.image.caption)}</figcaption>` : ''}
          </figure>
        ` : ''}
        <div class="visual-copy">
          <div class="visual-note">
            <div class="visual-label">比喻</div>
            <p>${escapeHtml(explainer.analogy ?? '')}</p>
          </div>
          <div class="visual-note">
            <div class="visual-label">场景</div>
            <p>${escapeHtml(explainer.scene ?? '')}</p>
          </div>
          <div class="visual-note">
            <div class="visual-label">为什么这张图有用</div>
            <p>${escapeHtml(explainer.whyItMatters ?? '')}</p>
          </div>
          ${takeaways.length > 0 ? `
            <div class="visual-note">
              <div class="visual-label">看图重点</div>
              <ul class="visual-takeaways">${listMarkup(takeaways, '暂无重点')}</ul>
            </div>
          ` : ''}
        </div>
      </div>
    </section>
  `;
}

function formatLearningEvidenceDetails(chapter, sourcesById) {
  const ids = Array.isArray(chapter.evidenceIds) ? chapter.evidenceIds.filter(Boolean) : [];
  if (ids.length === 0) return '';
  return `
    <details class="chapter-evidence" id="${escapeHtml(chapter.id)}-evidence">
      <summary>
        <span class="evidence-summary-title">本章出处</span>
        <span class="evidence-summary-count">${ids.length} 个来源</span>
      </summary>
      <div class="evidence-mini-list">
        ${ids.map((id) => {
          const source = sourcesById.get(id);
          return `
            <div class="evidence-mini-card">
              <strong>${escapeHtml(source?.title ?? id)}</strong>
              <span>${escapeHtml(source?.relativePath ?? source?.path ?? id)}</span>
              ${source?.summary ? `<p>${escapeHtml(source.summary)}</p>` : ''}
            </div>
          `;
        }).join('\n')}
      </div>
    </details>
  `;
}

function formatLearningChapter(chapter, index, sourcesById) {
  return `
    <section class="chapter${index === 0 ? ' active' : ''}" id="${escapeHtml(chapter.id)}" data-chapter-index="${index}"${index === 0 ? '' : ' hidden'}>
      <div class="chapter-kicker" id="${escapeHtml(chapter.id)}-reading">第 ${index + 1} 章 · ${escapeHtml(chapter.label)}</div>
      <h2>${escapeHtml(chapter.semanticTitle)}</h2>
      <p class="chapter-summary">${escapeHtml(chapter.summary)}</p>
      ${formatLearningVisualExplainer(chapter.visualExplainer, chapter.id)}
      ${formatLearningParagraphs(chapter.paragraphs)}
      ${formatLearningRetrievalBlocks(chapter.retrievalBlocks, chapter.id)}
      ${formatLearningWorkedExamples(chapter.workedExamples, chapter.id)}
      ${formatLearningEvidenceDetails(chapter, sourcesById)}
    </section>
  `;
}

function formatLearningOutlineNode(node, indexPath = '1', activeChapterId = null) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const label = `
    <span class="outline-jump depth-${escapeHtml(node.depth ?? 1)}${node.id === activeChapterId ? ' active' : ''}" data-target-id="${escapeHtml(node.id)}">
      <span class="outline-number">${escapeHtml(indexPath)}</span>
      <span class="outline-copy">
        <strong>${escapeHtml(node.title)}</strong>
        ${node.subtitle ? `<small>${escapeHtml(node.subtitle)}</small>` : ''}
      </span>
    </span>
  `;
  if (!hasChildren) return `<li>${label}</li>`;
  return `
    <li>
      <details class="outline-branch" open>
        <summary>${label}</summary>
        <ol>
          ${node.children.map((child, childIndex) => formatLearningOutlineNode(child, `${indexPath}.${childIndex + 1}`, activeChapterId)).join('\n')}
        </ol>
      </details>
    </li>
  `;
}

function formatLearningSource(source) {
  return `
    <section class="source-card" id="${escapeHtml(learningSourceAnchor(source.id))}">
      <div class="source-title">${escapeHtml(source.title)}</div>
      <div class="source-meta">${escapeHtml(source.type)} · ${escapeHtml(source.relativePath ?? source.path ?? '')}</div>
      ${source.summary ? `<p>${escapeHtml(source.summary)}</p>` : ''}
      ${source.excerpt ? `<pre>${escapeHtml(source.excerpt)}</pre>` : ''}
      <div class="source-digest">digest: ${escapeHtml(source.digest ?? 'none')}</div>
    </section>
  `;
}

function formatLearningClaim(claim) {
  return `
    <div class="claim-item">
      <div class="claim-statement">${escapeHtml(claim.statement)}</div>
      <div class="claim-meta">confidence: ${escapeHtml(claim.confidence ?? 'unknown')} · sources: ${(claim.sourceIds ?? []).map((id) => escapeHtml(id)).join(', ') || 'none'}</div>
    </div>
  `;
}

function formatLearningEmptyState(content, packageMeta, evidenceManifest) {
  const promptPath = content.agentPromptPath ?? packageMeta?.paths?.agentPrompt ?? null;
  const contextPath = content.agentContextPath ?? packageMeta?.paths?.agentContext ?? null;
  const contentPath = content.packagePaths?.contentJson ?? packageMeta?.paths?.contentJson ?? null;
  const assetsDir = content.packagePaths?.assetsDir ?? packageMeta?.paths?.assetsDir ?? null;
  const renderCommand = contentPath ? `openprd learn . --content-json ${contentPath} --open` : null;
  const sourceCount = evidenceManifest?.sourceCount ?? (evidenceManifest?.sources?.length ?? 0);
  const claimCount = evidenceManifest?.claimCount ?? (evidenceManifest?.claims?.length ?? 0);
  const gapCount = Array.isArray(evidenceManifest?.gaps) ? evidenceManifest.gaps.length : 0;
  return `
    <section class="empty-reader" id="agent-authoring">
      <p class="chapter-kicker">证据包待写作</p>
      <h2>还没有生成可阅读正文</h2>
      <p>这一步只完成了学习包归档和证据收集。真正给人阅读的标题、大纲、章节、检索练习和工作示例，还需要由 Agent 根据证据写入内容 JSON 后再渲染。</p>
      <div class="stat-grid">
        <div class="stat"><div class="stat-value">${sourceCount}</div><div class="stat-label">份证据来源</div></div>
        <div class="stat"><div class="stat-value">${claimCount}</div><div class="stat-label">条结构化判断</div></div>
        <div class="stat"><div class="stat-value">${gapCount}</div><div class="stat-label">个待补缺口</div></div>
      </div>
	      <ol class="empty-steps">
	        <li>让 Agent 读取写作提示、上下文和证据清单。</li>
	        <li>由 Agent 把标题、目录、章节正文、检索练习、工作示例和需要的 visualExplainer 写进 <code>learning-content.json</code>。</li>
	        <li>写完后重新执行渲染命令，再打开阅读器查看成品。</li>
	      </ol>
	      <div class="empty-paths">
	        ${promptPath ? `<div><strong>写作提示</strong><span>${escapeHtml(promptPath)}</span></div>` : ''}
	        ${contextPath ? `<div><strong>上下文</strong><span>${escapeHtml(contextPath)}</span></div>` : ''}
	        ${contentPath ? `<div><strong>内容 JSON</strong><span>${escapeHtml(contentPath)}</span></div>` : ''}
	        ${assetsDir ? `<div><strong>图片素材目录</strong><span>${escapeHtml(assetsDir)}</span></div>` : ''}
	        ${renderCommand ? `<div><strong>重渲染命令</strong><span>${escapeHtml(renderCommand)}</span></div>` : ''}
	      </div>
	    </section>
	  `;
}

export function renderLearningArtifact({ packageMeta, content, evidenceManifest }) {
  const chapters = Array.isArray(content.chapters) ? content.chapters : [];
  const sources = Array.isArray(evidenceManifest.sources) ? evidenceManifest.sources : [];
  const claims = Array.isArray(evidenceManifest.claims) ? evidenceManifest.claims : [];
  const gaps = Array.isArray(evidenceManifest.gaps) ? evidenceManifest.gaps : [];
  const isAwaitingAgent = content.authoringStatus === 'awaiting-agent-content' || chapters.length === 0;
  const title = content.title || packageMeta?.title || 'OpenPrd 复盘学习包';
  const outline = Array.isArray(content.outline) && content.outline.length > 0
    ? content.outline
    : chapters.map((chapter, index) => ({
      id: chapter.id,
      depth: 1,
      title: `第 ${index + 1} 章 · ${chapter.label}`,
      subtitle: chapter.semanticTitle,
      children: [],
    }));
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const initialChapterId = chapters[0]?.id ?? outline[0]?.id ?? null;
  const initialProgressPercent = chapters.length > 0 ? String((1 / chapters.length) * 100) : '0';

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6fbff;
        --bg-deep: #eef6ff;
        --paper: #ffffff;
        --panel: rgba(255, 255, 255, 0.96);
        --ink: #171411;
        --text: #1f2b3d;
        --muted: #66758b;
        --line: rgba(121, 151, 194, 0.28);
        --line-strong: rgba(91, 126, 177, 0.32);
        --accent: #ef7b43;
        --accent-deep: #d95f26;
        --accent-soft: #fff2e8;
        --amber: #8a5a2b;
        --amber-soft: #f6e7d4;
        --jade: #ef7b43;
        --wash: #f5f9ff;
        --danger-soft: rgba(220,38,38,0.08);
        --reader-scale: 1;
        --mono: "JetBrains Mono","SFMono-Regular",Menlo,monospace;
        --serif: "Songti SC","Noto Serif CJK SC","Iowan Old Style","Palatino Linotype",serif;
        --ui: "Avenir Next","Gill Sans","Trebuchet MS",sans-serif;
      }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body {
        margin: 0;
        background:
          linear-gradient(90deg, rgba(95, 129, 181, 0.07) 0 1px, transparent 1px 100%),
          linear-gradient(rgba(95, 129, 181, 0.07) 0 1px, transparent 1px 100%),
          radial-gradient(circle at top, rgba(255,255,255,0.82), transparent 30%),
          linear-gradient(180deg, #fbfdff 0%, var(--bg) 50%, var(--bg-deep) 100%);
        background-size: 56px 56px, 56px 56px, auto, auto;
        color: var(--text);
        font-family: var(--ui);
        overflow: hidden;
      }
      .shell {
        display: grid;
        grid-template-columns: minmax(280px, 330px) minmax(0, 980px);
        gap: 18px;
        max-width: 1340px;
        height: 100vh;
        margin: 0 auto;
        padding: 18px;
      }
      .side-panel,
      .reader {
        border: 1px solid var(--line);
        border-radius: 18px;
        background: var(--panel);
        box-shadow: 0 20px 50px rgba(92, 122, 168, 0.14);
      }
      .side-panel {
        position: sticky;
        top: 18px;
        align-self: start;
        max-height: calc(100vh - 36px);
        overflow: auto;
        padding: 18px;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.985), rgba(252,254,255,0.985)),
          var(--panel);
      }
      .reader {
        min-width: 0;
        background: var(--paper);
        overflow: hidden;
        position: relative;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        height: calc(100vh - 36px);
      }
      .reader-header {
        border-bottom: 1px solid var(--line);
        background:
          linear-gradient(135deg, rgba(255,255,255,0.995), rgba(249,252,255,0.98)),
          var(--paper);
        padding: 16px 30px 10px;
      }
      .reader-scroll {
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
        scroll-padding-top: 24px;
      }
      .eyebrow {
        margin: 0 0 8px;
        color: var(--accent);
        font-size: 13px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0;
      }
      h1 {
        margin: 0;
        font-family: var(--serif);
        font-size: clamp(27px, 3.2vw, 36px);
        line-height: 1.14;
        font-weight: 700;
        letter-spacing: 0.01em;
        color: var(--ink);
      }
      .subtitle {
        margin: 10px 0 0;
        color: var(--muted);
        line-height: 1.55;
        font-size: 15px;
      }
      .meta-row,
      .controls,
      .chapter-evidence {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .meta-row { margin-top: 8px; }
      .meta-details {
        margin-top: 10px;
        color: var(--muted);
        font-size: 12px;
      }
      .meta-details summary,
      .retrieval-item summary,
      .chapter-evidence summary {
        list-style: none;
      }
      .meta-details summary::-webkit-details-marker,
      .retrieval-item summary::-webkit-details-marker,
      .chapter-evidence summary::-webkit-details-marker {
        display: none;
      }
      .meta-details summary {
        width: fit-content;
        cursor: pointer;
        color: var(--accent-deep);
        font-weight: 650;
        line-height: 1.4;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .meta-details summary::before,
      .retrieval-item summary::before,
      .chapter-evidence summary::before {
        content: "▸";
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 12px;
        color: var(--accent-deep);
        font-size: 11px;
        transform-origin: 50% 50%;
        transition: transform 120ms ease;
      }
      .meta-details[open] summary::before,
      .retrieval-item[open] summary::before,
      .chapter-evidence[open] summary::before {
        transform: rotate(90deg);
      }
      .meta-pill,
      .evidence-chip {
        display: inline-flex;
        width: fit-content;
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 4px 8px;
        background: rgba(255,255,255,0.86);
        color: var(--muted);
        font-size: 10.5px;
        text-decoration: none;
      }
      .evidence-chip {
        color: var(--accent);
        background: var(--accent-soft);
        border-color: rgba(239,123,67,0.22);
      }
      .evidence-chip.muted {
        color: var(--muted);
        background: #f8fafc;
      }
      .controls {
        justify-content: space-between;
        margin-top: 9px;
        border-top: 1px solid var(--line);
        padding-top: 9px;
        background: transparent;
        gap: 14px;
      }
      .button-row { display: flex; gap: 8px; flex-wrap: wrap; }
      button {
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 7px 10px;
        background: rgba(255, 255, 255, 0.96);
        color: var(--text);
        font: inherit;
        font-size: 14px;
        cursor: pointer;
      }
      button:hover { border-color: var(--accent); }
      button:disabled { color: var(--muted); cursor: not-allowed; opacity: 0.58; }
      .progress-wrap {
        min-width: 180px;
        flex: 1;
      }
      .progress-meta {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 6px;
      }
      .progress-track {
        height: 7px;
        border-radius: 999px;
        background: #e5dfd4;
        overflow: hidden;
      }
      .progress-bar {
        height: 100%;
        width: 0%;
        border-radius: inherit;
        background: var(--accent);
        transition: width 180ms ease;
      }
      .toc-title,
      .panel-title {
        margin: 0 0 12px;
        font-size: 14px;
        font-weight: 800;
        color: var(--accent-deep);
      }
      .toc-subtitle {
        margin: -4px 0 16px;
        color: var(--muted);
        line-height: 1.6;
        font-size: 13px;
      }
      .outline-list,
      .outline-list ol {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .outline-list ol {
        margin-left: 12px;
        padding-left: 12px;
        border-left: 1px solid var(--line);
      }
      .outline-branch summary {
        list-style: none;
      }
      .outline-branch summary::-webkit-details-marker { display: none; }
      .outline-jump {
        display: grid;
        grid-template-columns: 42px 1fr;
        gap: 10px;
        width: 100%;
        text-align: left;
        border-color: transparent;
        background: transparent;
        color: var(--text);
        line-height: 1.45;
        padding: 9px 8px;
        border-radius: 12px;
        border: 1px solid transparent;
        cursor: pointer;
      }
      .outline-jump:hover {
        border-color: rgba(239,123,67,0.18);
        background: rgba(255, 246, 239, 0.78);
        color: var(--accent-deep);
      }
      .outline-jump.active {
        border-color: rgba(239,123,67,0.24);
        background: linear-gradient(180deg, rgba(255,246,239,0.96), rgba(255,250,245,0.98));
        color: var(--accent-deep);
      }
      .outline-jump.active .outline-number,
      .outline-jump.active .outline-copy strong {
        color: var(--accent-deep);
      }
      .outline-jump.active .outline-copy small {
        color: #b27044;
      }
      .outline-number {
        color: var(--amber);
        font-family: var(--serif);
        font-weight: 800;
      }
      .outline-copy strong,
      .outline-copy small {
        display: block;
      }
      .outline-copy strong {
        font-weight: 700;
      }
      .outline-copy small {
        margin-top: 3px;
        color: var(--muted);
        font-size: 12px;
      }
      .stat-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
        margin-top: 16px;
      }
      .stat {
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 10px;
        background: var(--wash);
      }
      .stat-value {
        font-family: var(--serif);
        font-size: 26px;
        font-weight: 700;
      }
      .stat-label {
        color: var(--muted);
        font-size: 12px;
        margin-top: 2px;
      }
      .chapter {
        padding: 38px 52px 54px;
        min-height: 100%;
      }
      .chapter[hidden] { display: none; }
      .chapter.active {
        box-shadow: none;
      }
      .chapter-kicker {
        color: var(--accent-deep);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.04em;
        margin-bottom: 8px;
      }
      .chapter h2 {
        margin: 0 0 12px;
        font-family: var(--serif);
        font-size: 38px;
        line-height: 1.24;
        font-weight: 600;
        letter-spacing: 0.01em;
      }
      .chapter-summary {
        margin: 0 0 20px;
        color: var(--muted);
        font-size: 15px;
        line-height: 1.8;
        max-width: 36em;
      }
      .chapter > p {
        max-width: 42em;
      }
      .chapter p,
      .learning-block p,
      .source-card p {
        font-size: calc(17px * var(--reader-scale));
        line-height: 1.85;
      }
      .learning-block {
        margin: 34px 0 0;
        border: 0;
        border-top: 1px solid var(--line);
        border-radius: 0;
        padding: 22px 0 0;
        background: transparent;
      }
      .learning-block h4 {
        margin: 0 0 14px;
        font-family: var(--serif);
        font-size: 24px;
        line-height: 1.3;
        font-weight: 600;
        letter-spacing: 0.01em;
      }
      .learning-block.retrieval,
      .learning-block.worked,
      .learning-block.visual {
        border-top-color: rgba(239,123,67,0.2);
      }
      .learning-block.visual {
        padding-top: 26px;
      }
      .visual-header {
        display: grid;
        gap: 6px;
        margin-bottom: 18px;
      }
      .visual-kicker {
        color: var(--accent-deep);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.12em;
      }
      .visual-header h4 {
        margin: 0;
        font-size: 30px;
        line-height: 1.28;
        font-weight: 600;
      }
      .visual-grid {
        display: grid;
        gap: 26px;
      }
      .visual-grid.has-image {
        grid-template-columns: minmax(0, 1.28fr) minmax(240px, 320px);
        align-items: start;
      }
      .visual-copy {
        display: grid;
        gap: 0;
        border-left: 1px solid var(--line);
        padding-left: 22px;
      }
      .visual-note {
        border: 0;
        border-radius: 0;
        background: transparent;
        padding: 0 0 16px;
      }
      .visual-note + .visual-note {
        border-top: 1px solid rgba(121, 151, 194, 0.22);
        padding-top: 16px;
      }
      .visual-label {
        color: var(--accent-deep);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        margin-bottom: 8px;
      }
      .visual-note p {
        margin: 0;
      }
      .visual-takeaways {
        margin: 0;
        padding-left: 20px;
      }
      .visual-figure {
        margin: 0;
        border: 1px solid rgba(121, 151, 194, 0.2);
        border-radius: 16px;
        overflow: hidden;
        background: rgba(255,255,255,0.98);
        box-shadow: 0 18px 42px rgba(91, 126, 177, 0.08);
      }
      .visual-figure img {
        display: block;
        width: 100%;
        height: auto;
        background:
          linear-gradient(90deg, rgba(95, 129, 181, 0.07) 0 1px, transparent 1px 100%),
          linear-gradient(rgba(95, 129, 181, 0.07) 0 1px, transparent 1px 100%),
          #f8fbff;
        background-size: 24px 24px, 24px 24px, auto;
      }
      .visual-figure figcaption {
        padding: 12px 14px 14px;
        border-top: 1px solid rgba(121, 151, 194, 0.16);
        color: var(--muted);
        font-size: 12px;
        line-height: 1.6;
      }
      .retrieval-item {
        border-top: 1px solid var(--line);
        padding: 16px 0;
      }
      .retrieval-item:first-of-type { border-top: 0; }
      .retrieval-item summary {
        cursor: pointer;
        font-weight: 650;
        line-height: 1.6;
        display: flex;
        gap: 10px;
        align-items: flex-start;
      }
      .retrieval-item summary span {
        display: inline-flex;
        color: var(--accent);
        font-family: var(--mono);
        font-size: 11px;
        min-width: 24px;
        padding-top: 2px;
      }
      .retrieval-hint,
      .retrieval-answer {
        color: var(--muted);
        line-height: 1.7;
        margin-top: 8px;
        margin-left: 34px;
      }
      .worked-item {
        padding: 18px 0;
        border-top: 1px solid var(--line);
      }
      .worked-item:first-of-type {
        padding-top: 6px;
        border-top: 0;
      }
      .worked-title {
        font-family: var(--serif);
        font-size: 24px;
        font-weight: 600;
        line-height: 1.35;
      }
      .worked-principle {
        color: var(--muted);
        line-height: 1.7;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid rgba(239,123,67,0.16);
      }
      ol,
      ul {
        margin: 10px 0 0;
        padding-left: 20px;
        line-height: 1.75;
      }
      .chapter-evidence {
        display: block;
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid var(--line);
      }
      .chapter-evidence summary {
        cursor: pointer;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        color: var(--muted);
      }
      .evidence-summary-title {
        color: var(--accent-deep);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.04em;
      }
      .evidence-summary-count {
        color: var(--muted);
        font-size: 12px;
      }
      .evidence-mini-list {
        display: grid;
        gap: 0;
        margin-top: 12px;
      }
      .evidence-mini-card {
        border: 0;
        border-top: 1px solid rgba(121, 151, 194, 0.16);
        border-radius: 0;
        background: transparent;
        padding: 12px 0;
      }
      .evidence-mini-card:first-child {
        border-top: 0;
        padding-top: 0;
      }
      .evidence-mini-card strong,
      .evidence-mini-card span {
        display: block;
      }
      .evidence-mini-card strong {
        font-weight: 650;
        font-size: 14px;
        line-height: 1.5;
      }
      .evidence-mini-card span {
        color: var(--muted);
        font-family: var(--mono);
        font-size: 11px;
        letter-spacing: 0.02em;
        margin-top: 4px;
      }
      .evidence-mini-card p {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.6;
      }
      .source-card,
      .claim-item,
      .gap-item {
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 12px;
        background: #fffefa;
        margin-bottom: 10px;
      }
      .source-title,
      .claim-statement {
        font-weight: 800;
        line-height: 1.5;
      }
      .source-meta,
      .claim-meta,
      .source-digest {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.6;
        margin-top: 4px;
      }
      .source-card pre {
        margin: 10px 0 0;
        white-space: pre-wrap;
        word-break: break-word;
        border-radius: 8px;
        background: #111827;
        color: #e5e7eb;
        padding: 10px;
        font-family: var(--mono);
        font-size: 12px;
        line-height: 1.5;
      }
      .gap-item {
        border-color: rgba(220,38,38,0.16);
        background: var(--danger-soft);
      }
      .empty-reader {
        margin: 38px 52px 54px;
        padding: 28px;
        border: 1px dashed var(--line-strong);
        border-radius: 16px;
        background: var(--wash);
      }
      .empty-reader h2 {
        margin: 0 0 12px;
        font-family: var(--serif);
        font-size: 34px;
        line-height: 1.2;
      }
      .empty-reader p {
        margin: 0;
        color: var(--muted);
        font-size: 17px;
        line-height: 1.8;
      }
      .empty-steps {
        margin: 18px 0 0;
        padding-left: 22px;
        color: var(--muted);
        line-height: 1.8;
      }
      .empty-steps li + li {
        margin-top: 6px;
      }
      .empty-paths {
        display: grid;
        gap: 10px;
        margin-top: 18px;
      }
      .empty-paths div {
        display: grid;
        gap: 4px;
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 10px 12px;
        background: #fffefa;
      }
      .empty-paths strong {
        color: var(--accent-deep);
        font-size: 13px;
      }
      .empty-paths span {
        color: var(--muted);
        font-family: var(--mono);
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      @media (max-width: 1120px) {
        body { overflow: auto; }
        .shell { grid-template-columns: 1fr; height: auto; min-height: 100vh; padding: 12px; }
        .side-panel {
          position: static;
          max-height: none;
        }
        .reader { height: auto; }
        .reader-scroll { height: auto; overflow: visible; }
        .chapter { min-height: auto; padding: 24px 20px 30px; }
        .visual-grid.has-image { grid-template-columns: 1fr; }
        .visual-copy {
          border-left: 0;
          border-top: 1px solid var(--line);
          padding-left: 0;
          padding-top: 18px;
        }
      }
      @media (max-width: 700px) {
        .reader-header { padding: 18px 20px 12px; }
        h1 { font-size: 30px; }
        .chapter h2 { font-size: 28px; }
        .learning-block h4,
        .visual-header h4,
        .worked-title {
          font-size: 24px;
        }
        .stat-grid { grid-template-columns: 1fr; }
        .controls { display: grid; gap: 12px; }
        .chapter { padding: 30px 22px 38px; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <aside class="side-panel">
        <p class="toc-title">书籍大纲</p>
        <p class="toc-subtitle">最多三层展开。先读章名，再进入心法、练习与示例。</p>
        <ol class="outline-list">
          ${outline.length > 0 ? outline.map((node, index) => formatLearningOutlineNode(node, `${index + 1}`, initialChapterId)).join('\n') : '<li><span class="outline-jump"><span class="outline-number">0</span><span class="outline-copy"><strong>证据包待写作</strong><small>正文完成后显示目录</small></span></span></li>'}
        </ol>
      </aside>

      <article class="reader">
        <header class="reader-header">
          <p class="eyebrow">OpenPrd 复盘学习 · ${escapeHtml(content.genre?.label ?? '默认题材')}</p>
          <h1>${escapeHtml(title)}</h1>
          <p class="subtitle">${escapeHtml(content.subtitle ?? '')}</p>
          <details class="meta-details">
            <summary>生成信息</summary>
            <div class="meta-row">
              <span class="meta-pill">topic: ${escapeHtml(content.topic ?? '未指定')}</span>
              <span class="meta-pill">genre: ${escapeHtml(content.genre?.id ?? 'unknown')}</span>
              <span class="meta-pill">风格: ${escapeHtml(content.stylePromptPack?.styleId ?? packageMeta?.styleId ?? 'default')}</span>
              <span class="meta-pill">trigger: ${escapeHtml(packageMeta?.trigger ?? content.trigger ?? 'manual')}</span>
            </div>
          </details>
          <div class="controls">
            <div class="button-row">
              <button type="button" id="prevChapter" disabled>上一章</button>
              <button type="button" id="nextChapter"${chapters.length <= 1 ? ' disabled' : ''}>下一章</button>
              <button type="button" id="smallerText">A-</button>
              <button type="button" id="largerText">A+</button>
            </div>
            <div class="progress-wrap">
              <div class="progress-meta">
                <span id="progressTitle">阅读进度</span>
                <span id="progressText">${chapters.length > 0 ? `1/${chapters.length}` : '0/0'}</span>
              </div>
              <div class="progress-track"><div class="progress-bar" id="progressBar" style="width: ${initialProgressPercent}%"></div></div>
            </div>
          </div>
        </header>
        <div class="reader-scroll" tabindex="0" aria-label="OpenPrd 复盘学习阅读器 · 当前章节正文">
          ${chapters.length > 0 ? chapters.map((chapter, index) => formatLearningChapter(chapter, index, sourcesById)).join('\n') : formatLearningEmptyState(content, packageMeta, evidenceManifest)}
        </div>
      </article>
    </main>
    <script>
      const scrollRoot = document.querySelector('.reader-scroll');
      const chapters = Array.from(document.querySelectorAll('.chapter'));
      const outlineItems = Array.from(document.querySelectorAll('[data-target-id]'));
      const prevButton = document.getElementById('prevChapter');
      const nextButton = document.getElementById('nextChapter');
      const progressBar = document.getElementById('progressBar');
      const progressText = document.getElementById('progressText');
      let activeIndex = 0;
      let fontScale = Number(localStorage.getItem('openprd-learning-font-scale') || '1');

      function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
      }

      function applyFontScale() {
        fontScale = clamp(fontScale, 0.9, 1.25);
        document.documentElement.style.setProperty('--reader-scale', String(fontScale));
        localStorage.setItem('openprd-learning-font-scale', String(fontScale));
      }

      function setActive(index, shouldScroll = false) {
        if (chapters.length === 0) return;
        activeIndex = clamp(index, 0, chapters.length - 1);
        chapters.forEach((chapter, chapterIndex) => {
          const isActive = chapterIndex === activeIndex;
          chapter.hidden = !isActive;
          chapter.classList.toggle('active', isActive);
        });
        const activeChapterId = chapters[activeIndex].id;
        outlineItems.forEach((item) => item.classList.toggle('active', item.dataset.targetId === activeChapterId));
        prevButton.disabled = activeIndex === 0;
        nextButton.disabled = activeIndex === chapters.length - 1;
        progressText.textContent = String(activeIndex + 1) + '/' + String(chapters.length);
        progressBar.style.width = String(((activeIndex + 1) / chapters.length) * 100) + '%';
        if (shouldScroll) {
          scrollRoot?.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }

      function scrollToReaderTarget(target) {
        if (!target || !scrollRoot) return;
        const rootTop = scrollRoot.getBoundingClientRect().top;
        const targetTop = target.getBoundingClientRect().top;
        scrollRoot.scrollTo({
          top: scrollRoot.scrollTop + targetTop - rootTop - 18,
          behavior: 'smooth',
        });
      }

      outlineItems.forEach((item) => {
        item.addEventListener('click', () => {
          const target = document.getElementById(item.dataset.targetId);
          if (!target) return;
          const chapterIndex = chapters.findIndex((chapter) => chapter.id === target.id || chapter.contains(target));
          if (chapterIndex >= 0) setActive(chapterIndex, false);
          scrollToReaderTarget(target);
        });
      });
      prevButton.addEventListener('click', () => setActive(activeIndex - 1, true));
      nextButton.addEventListener('click', () => setActive(activeIndex + 1, true));
      document.getElementById('smallerText').addEventListener('click', () => {
        fontScale -= 0.05;
        applyFontScale();
      });
      document.getElementById('largerText').addEventListener('click', () => {
        fontScale += 0.05;
        applyFontScale();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowRight' || event.key === 'PageDown') setActive(activeIndex + 1, true);
        if (event.key === 'ArrowLeft' || event.key === 'PageUp') setActive(activeIndex - 1, true);
      });

      applyFontScale();
      setActive(0, false);
    </script>
  </body>
</html>`;
}

export async function writeHtmlArtifact(filePath, html) {
  await writeText(filePath, html);
  return filePath;
}

export async function openArtifactInBrowser(filePath) {
  const platform = process.platform;
  const command = platform === 'darwin'
    ? 'open'
    : platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = platform === 'win32'
    ? ['/c', 'start', '', filePath]
    : [filePath];
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

export function canonicalReviewPath(ws, versionId) {
  return cjoin(ws.workspaceRoot, 'reviews', `${slugify(versionId, 'review')}.html`);
}

function toRelativeHref(fromFilePath, targetFilePath) {
  const relative = path.relative(path.dirname(fromFilePath), targetFilePath) || path.basename(targetFilePath);
  return relative.split(path.sep).join('/');
}

export function renderReviewEntryHtml({ entryPath, reviewPath, title = 'OpenPrd Review' }) {
  const href = escapeHtml(toRelativeHref(entryPath, reviewPath));
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="refresh" content="0; url=${href}" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f8fafc;
        --panel: #ffffff;
        --text: #111827;
        --muted: #6b7280;
        --line: rgba(17,24,39,0.12);
        --accent: #2563eb;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
        color: var(--text);
        font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      .panel {
        width: min(560px, calc(100vw - 32px));
        padding: 28px 24px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: var(--panel);
        box-shadow: 0 18px 40px rgba(15,23,42,0.08);
      }
      h1 {
        margin: 0 0 10px;
        font-size: 24px;
        line-height: 1.25;
      }
      p {
        margin: 0 0 12px;
        color: var(--muted);
        line-height: 1.6;
      }
      a {
        color: var(--accent);
        font-weight: 700;
        text-decoration: none;
      }
      a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <main class="panel">
      <h1>${escapeHtml(title)}</h1>
      <p>这个入口只保留当前评审稿的固定路径，页面会自动跳转到最新的版本化评审文件。</p>
      <p><a href="${href}">如果没有自动跳转，点这里打开评审面板</a></p>
    </main>
  </body>
</html>`;
}


export function defaultReviewArtifactPath(ws) {
  return cjoin(ws.workspaceRoot, 'engagements', 'active', 'review.html');
}

export function defaultRegressionArtifactPath(projectRoot, taskId) {
  return cjoin(projectRoot, '.openprd', 'harness', 'test-reports', `${taskId.replace(/[^a-zA-Z0-9._-]/g, '_')}.html`);
}

export function artifactBundleDir(ws, artifactId) {
  return cjoin(ws.paths.artifactsActiveDir, slugify(artifactId));
}

export function artifactBundlePaths(ws, artifactId) {
  const dir = artifactBundleDir(ws, artifactId);
  return {
    dir,
    html: cjoin(dir, 'artifact.html'),
    markdown: cjoin(dir, 'data.md'),
    patch: cjoin(dir, 'capture-patch.json'),
  };
}

export function learningPackagePaths(ws, packageId) {
  const dir = cjoin(ws.paths.learningArchiveDir, slugify(packageId, 'learning-package'));
  return {
    dir,
    readerHtml: cjoin(dir, 'reader.html'),
    assetsDir: cjoin(dir, 'assets'),
    packageJson: cjoin(dir, 'learning-package.json'),
    contentJson: cjoin(dir, 'learning-content.json'),
    contentMarkdown: cjoin(dir, 'learning-content.md'),
    evidenceManifest: cjoin(dir, 'evidence-manifest.json'),
    agentContext: cjoin(dir, 'agent-context.json'),
    agentPrompt: cjoin(dir, 'agent-prompt.md'),
  };
}

export function renderMarkdownDataDocument({ title, sections }) {
  const lines = [`# ${title}`, ''];
  for (const section of sections) {
    lines.push(`## ${section.title}`);
    lines.push('');
    lines.push(...section.lines);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
