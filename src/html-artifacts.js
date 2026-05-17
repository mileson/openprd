import { spawn } from 'node:child_process';
import { cjoin, writeText } from './fs-utils.js';

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

function optionCandidates(clarification) {
  const mainQuestion = clarification.mustAskUser[0]?.prompt ?? '先确认一句话需求的真实目标。';
  return [
    {
      title: '方向 A · 澄清优先',
      summary: '先把问题、用户、成功标准问清楚，再收敛范围，适合一句话模糊需求。',
      tradeoffs: [
        mainQuestion,
        '优点: 风险低，适合需求仍在早期发散。',
        '代价: 前期问题较多，进入执行稍慢。',
      ],
    },
    {
      title: '方向 B · 方案对比优先',
      summary: '直接生成多个方案给用户选，再反推需求边界，适合用户有判断但说不清。',
      tradeoffs: [
        '优点: 用户更容易通过“看方案”表达偏好。',
        '代价: 如果基础目标没问清，方案容易偏题。',
      ],
    },
    {
      title: '方向 C · 参数试玩优先',
      summary: '先给一个可调参数的 playground，让用户先玩出偏好，再结构化回写。',
      tradeoffs: [
        '优点: 特别适合流程、布局、密度、节奏类决策。',
        '代价: 需要更强的 HTML artifact 支撑。',
      ],
    },
  ];
}

function buildClarifyExportPayload(clarification) {
  return {
    action: 'capture',
    nextRecommendedPhase: clarification.shouldAskUser ? 'clarify' : 'synthesize',
    confirmedQuestionIds: clarification.mustAskUser.map((item) => item.id),
    requirementIntake: clarification.requirementIntake ?? null,
    exportedAt: new Date().toISOString(),
  };
}

function formatRequirementIntakeDepth(requirementIntake) {
  if (!requirementIntake?.active) {
    return '';
  }
  const checklist = requirementIntake.layers.map((layer) => `${layer.title}: ${layer.question}`);
  const asciiTemplate = [
    '页面 / 流程草图（如涉及界面）',
    '+--------------------------------------------------+',
    '| 入口 / 标题                                      |',
    '+----------------------+---------------------------+',
    '| 主要选择区           | 方案预览 / 风险提示       |',
    '| - 用户/对象           | - 将创建或更新什么        |',
    '| - 技能/配置/步骤      | - 需要用户确认的动作      |',
    '+----------------------+---------------------------+',
    '| [保存草稿] [预览方案] [确认应用]                 |',
    '+--------------------------------------------------+',
  ].join('\n');
  return [
    formatEvidenceItem({
      title: '需求入口深挖门禁',
      description: `新产品、模块或流程需求至少先确认 ${requirementIntake.minimumDepth} 层：用户场景问题、目标流程、细节验收。`,
      items: checklist,
    }),
    formatExportItem({
      title: 'ASCII 线框提示',
      description: requirementIntake.needsInterfaceSketch
        ? '本需求看起来涉及界面，请先把大致布局画给用户确认。'
        : '如果后续发现涉及界面，也要先补这类线框再进入 PRD 合成。',
      payload: asciiTemplate,
    }),
  ].join('\n');
}

function buildReviewExportPayload(snapshot) {
  const sections = snapshot.sections ?? {};
  return {
    versionId: snapshot.versionId,
    title: snapshot.title,
    reviewStatus: 'pending-confirmation',
    recommendedActions: [
      '确认问题与目标',
      '确认范围内 / 范围外',
      '确认主流程与失败路径',
      '确认关键风险与开放问题',
    ],
    sectionKeys: Object.keys(sections),
    exportedAt: new Date().toISOString(),
  };
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

export function renderClarifyArtifact({ snapshot, clarification }) {
  const hasUserQuestions = clarification.mustAskUser.length > 0;
  const questionContent = hasUserQuestions
    ? clarification.mustAskUser.map(formatClarificationQuestion).join('\n')
    : '<p class="empty">当前没有必须由用户确认的问题。可以回到 Agent 对话继续确认任务拆解或推进下一步；只有需要方案对比、可视审阅或留痕时，再打开这份 HTML。</p>';
  const directionSection = hasUserQuestions
    ? card('推荐发散方向', optionCandidates(clarification).map(formatOption).join('\n'))
    : formatEvidenceItem({
        title: '建议继续方式',
        description: '当前信息已经足够支撑下一步，不需要额外 HTML 确认。',
        items: [
          '在 Agent 对话中确认任务拆解或继续执行。',
          '如需留痕，可使用下方回写数据交给 openprd capture 或下一轮 prompt。',
        ],
      });
  const summaryCards = [
    metricCard('场景', clarification.scenario.label, clarification.scenario.reason),
    metricCard('必填缺口', `${clarification.missingRequiredFields}`, '当前仍需用户确认或 agent 补全的关键字段数'),
    metricCard('本轮提问', `${clarification.mustAskUser.length}`, '建议先逐条确认，不一次性压给用户整包问题'),
    metricCard('后续可推断', `${clarification.canInferLater.length}`, '可在拿到更多事实后由 agent 继续补全'),
  ];

  const sections = [
    card('本轮需要用户确认', questionContent),
    formatRequirementIntakeDepth(clarification.requirementIntake),
    directionSection,
    formatEvidenceItem({
      title: '当前开放问题',
      description: '这些问题会同时记录进 OpenPrD 工作区，避免在后续讨论中丢失。',
      items: clarification.mustAskUser.map((item) => item.prompt),
    }),
    formatExportItem({
      title: '给 Agent 的回写数据',
      description: '这份 JSON 供 openprd capture、决策回写或下一轮 prompt 使用，不是需要用户填写的表单。',
      payload: JSON.stringify(buildClarifyExportPayload(clarification), null, 2),
    }),
  ];

  return pageShell({
    eyebrow: 'OpenPrd / 需求澄清面板',
    title: snapshot.title || '需求澄清',
    subtitle: '先把问题、目标、范围和探索方向看清楚，再决定是否继续发散、对比或合成正式 PRD。',
    summaryCards,
    sections,
    footer: `版本: ${snapshot.versionId} · 产品类型: ${snapshot.productType ?? '未分类'} · 建议下一步: ${clarification.shouldAskUser ? '继续澄清 / 必要时打开 HTML 方案对比' : '回到 Agent 对话继续确认或合成 PRD'}`,
  });
}

export function renderReviewArtifact({ snapshot }) {
  const sectionsData = snapshot.sections ?? {};
  const summaryCards = [
    metricCard('问题定义', sectionsData.problem?.problemStatement ? '已填写' : '待确认', sectionsData.problem?.problemStatement ?? '尚未形成明确问题定义'),
    metricCard('目标与指标', `${(sectionsData.goals?.goals ?? []).length} / ${(sectionsData.goals?.successMetrics ?? []).length}`, '目标数 / 成功指标数'),
    metricCard('范围', `${(sectionsData.scope?.inScope ?? []).length} / ${(sectionsData.scope?.outOfScope ?? []).length}`, '范围内 / 范围外条目数'),
    metricCard('业务护栏', `${(sectionsData.businessGuardrails?.usageLimits ?? []).length} / ${(sectionsData.businessGuardrails?.alertThresholds ?? []).length}`, '额度限制 / 报警阈值条目数'),
    metricCard('风险与问题', `${(sectionsData.risks?.risks ?? []).length} / ${(sectionsData.risks?.openQuestions ?? []).length}`, '风险数 / 开放问题数'),
  ];

  const sections = [
    formatEvidenceItem({
      title: '主流程与边界情况',
      description: '先确认用户旅程、关键步骤、恢复路径是否足够支撑 freeze。',
      items: [
        ...(sectionsData.scenarios?.primaryFlows ?? []),
        ...(sectionsData.scenarios?.edgeCases ?? []),
        ...(sectionsData.scenarios?.failureModes ?? []),
      ],
    }),
    formatEvidenceItem({
      title: '功能与约束',
      description: '这里最适合标出“哪些是必须的，哪些只是当前假设”。',
      items: [
        ...(sectionsData.requirements?.functional ?? []),
        ...(sectionsData.requirements?.nonFunctional ?? []),
        ...(sectionsData.constraints?.dependencies ?? []),
      ],
    }),
    formatEvidenceItem({
      title: '业务成本与滥用护栏',
      description: '涉及免费额度、消耗型成本或第三方调用时，先确认限制、报警和止损动作。',
      items: [
        ...(sectionsData.businessGuardrails?.costDrivers ?? []),
        ...(sectionsData.businessGuardrails?.usageLimits ?? []),
        ...(sectionsData.businessGuardrails?.abusePrevention ?? []),
        ...(sectionsData.businessGuardrails?.monitoringSignals ?? []),
        ...(sectionsData.businessGuardrails?.alertThresholds ?? []),
        ...(sectionsData.businessGuardrails?.stopLossActions ?? []),
      ],
    }),
    formatEvidenceItem({
      title: '开放问题与风险',
      description: 'Freeze 前没有被关掉的问题，应该继续停留在这里，而不是被默默假定解决。',
      items: [
        ...(sectionsData.risks?.assumptions ?? []),
        ...(sectionsData.risks?.risks ?? []),
        ...(sectionsData.risks?.openQuestions ?? []),
      ],
    }),
    formatExportItem({
      title: '一键导回 PRD Review 决策',
      description: '后续可用于 review 状态更新、生成 decision log 或继续进入 diagram review。',
      payload: JSON.stringify(buildReviewExportPayload(snapshot), null, 2),
    }),
  ];

  return pageShell({
    eyebrow: 'OpenPrd / 评审面板',
    title: snapshot.title || 'PRD 评审',
    subtitle: '这不是归档文档，而是 freeze 前的人机确认界面。建议在这里确认问题、范围、流程、风险，再进入 diagram / freeze。',
    summaryCards,
    sections,
    footer: `版本: ${snapshot.versionId} · 负责人: ${snapshot.owner} · 目标系统: ${sectionsData.handoff?.targetSystem ?? 'OpenSpec'}`,
  });
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

export function renderQualityEvalArtifact({ report }) {
  const summaryCards = [
    metricCard('质量状态', report.summary.status, `关注门禁: ${report.summary.attentionCount}`),
    metricCard('扫描文件', `${report.summary.filesScanned}`, '用于识别日志、测试、性能与知识库信号'),
    metricCard('激活变更', report.summary.activeChange ?? '无', '用于评估任务覆盖完整性'),
    metricCard('报告格式', 'HTML + JSON', report.id),
  ];

  const gateItems = report.gates.map((gate) => `
    <div class="qa-item ${qualityStatusClass(gate.status)}">
      <div class="qa-label">${escapeHtml(gate.label)}</div>
      <div class="qa-status-row">
        <div class="status-badge mini-status ${gate.status === 'pass' ? 'status-pass' : 'status-warn'}">${qualityStatusLabel(gate.status)}</div>
      </div>
      <ul>${listMarkup(gate.warnings, '暂无额外风险')}</ul>
    </div>
  `).join('\n');

  const obs = report.observability;
  const evalHarness = report.evalHarness;
  const businessGuardrails = report.businessGuardrails;
  const knowledge = report.knowledge;
  const sections = [
    card('质量门禁总览', gateItems),
    card('日志与链路追踪', `
      <div class="evidence-grid">
        ${miniMetric('中心化系统', obs.centralizedTools.length > 0 ? obs.centralizedTools.join(', ') : '未检测到', 'OpenTelemetry/Sentry/Datadog/New Relic 等信号')}
        ${miniMetric('本地日志', obs.localLoggers.length > 0 ? obs.localLoggers.join(', ') : '未检测到', 'console/pino/winston 等项目内日志调用')}
        ${miniMetric('关联字段', `${obs.correlationFields.length}/${report.configSnapshot.observability.requiredCorrelationFields.length}`, obs.correlationFields.join(', ') || '未检测到')}
      </div>
      <ul>${listMarkup(obs.recommendations)}</ul>
    `),
    card('业务成本与滥用护栏', `
      <div class="evidence-grid">
        ${miniMetric('风险信号', businessGuardrails.riskDetected ? '已检测' : '未检测', businessGuardrails.matchedRiskIndicators.slice(0, 4).join(', ') || '暂无命中')}
        ${miniMetric('缺口数量', `${businessGuardrails.missingEvidence.length}`, businessGuardrails.missingEvidence.join(', ') || '暂无缺口')}
        ${miniMetric('护栏状态', businessGuardrails.status, businessGuardrails.enabled ? '已启用' : '未启用')}
      </div>
      <ul>${listMarkup(businessGuardrails.recommendations)}</ul>
    `),
    card('评估执行环境', `
      <div class="evidence-grid">
        ${miniMetric('冒烟测试', evalHarness.smoke.present ? '已发现' : '缺失', evalHarness.smoke.commands.join(' | ') || '暂无命令')}
        ${miniMetric('性能测试', evalHarness.performance.present ? '已发现' : '缺失', evalHarness.performance.commands.join(' | ') || '暂无命令')}
        ${miniMetric('极端数据', evalHarness.extremeData.present ? '已发现' : '缺失', evalHarness.extremeData.evidence.slice(0, 3).join(', ') || '暂无 evidence')}
      </div>
      <div class="qa-meta">正常性能基线: ${escapeHtml(JSON.stringify(evalHarness.performance.normalBaseline))}</div>
      <div class="qa-meta">极端性能基线: ${escapeHtml(JSON.stringify(evalHarness.performance.extremeBaseline))}</div>
      <ul>${listMarkup(evalHarness.recommendations)}</ul>
    `),
    card('功能覆盖矩阵', `
      <div class="evidence-grid">
        ${miniMetric('任务总数', `${evalHarness.featureCoverage.activeTasks.total}`, '来自当前激活 change 的 tasks.md')}
        ${miniMetric('已完成', `${evalHarness.featureCoverage.activeTasks.done}`, '已勾选任务')}
        ${miniMetric('待处理', `${evalHarness.featureCoverage.activeTasks.pending}`, '需要继续补齐或验证')}
      </div>
      <ul>${listMarkup(evalHarness.featureCoverage.requiredFlows)}</ul>
    `),
    card('项目级知识库经验层', `
      <div class="evidence-grid">
        ${miniMetric('经验 Skill', `${knowledge.skills.length}`, knowledge.skillDir)}
        ${miniMetric('事故记录', `${knowledge.incidents.length}`, '用于沉淀验证已修复的问题')}
      </div>
      <ul>${listMarkup(knowledge.recommendations)}</ul>
    `),
    formatExportItem({
      title: '结构化质量报告',
      description: '供 CI、交接、复盘学习、经验 skill 生成和后续质量提升使用。',
      payload: JSON.stringify(report, null, 2),
    }),
  ];

  return pageShell({
    eyebrow: 'OpenPrd / 质量评估报告',
    title: `质量评估报告 ${report.id}`,
    subtitle: '用于审查日志追踪、业务护栏、冒烟测试、功能覆盖、性能基线、极端场景和项目级经验沉淀。',
    statusBadge: {
      label: report.summary.status === 'production-ready' ? '生产就绪' : '需补证据',
      className: qualityBadgeClass(report.summary.status),
    },
    topMeta: [
      `生成时间: ${report.generatedAt}`,
      `执行模式: ${report.readiness.enforcement}`,
    ],
    summaryCards,
    sections,
    footer: 'OpenPrd 质量报告',
  });
}

function learningSourceAnchor(sourceId) {
  return `source-${slugify(sourceId, 'source')}`;
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

function formatLearningEvidenceDetails(chapter, sourcesById) {
  const ids = Array.isArray(chapter.evidenceIds) ? chapter.evidenceIds.filter(Boolean) : [];
  if (ids.length === 0) return '';
  return `
    <details class="chapter-evidence" id="${escapeHtml(chapter.id)}-evidence">
      <summary><span>本章出处</span>${formatLearningEvidenceChips(ids)}</summary>
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
    <section class="chapter" id="${escapeHtml(chapter.id)}" data-chapter-index="${index}"${index === 0 ? '' : ' hidden'}>
      <div class="chapter-kicker" id="${escapeHtml(chapter.id)}-reading">第 ${index + 1} 章 · ${escapeHtml(chapter.label)}</div>
      <h2>${escapeHtml(chapter.semanticTitle)}</h2>
      <p class="chapter-summary">${escapeHtml(chapter.summary)}</p>
      ${formatLearningParagraphs(chapter.paragraphs)}
      ${formatLearningRetrievalBlocks(chapter.retrievalBlocks, chapter.id)}
      ${formatLearningWorkedExamples(chapter.workedExamples, chapter.id)}
      ${formatLearningEvidenceDetails(chapter, sourcesById)}
    </section>
  `;
}

function formatLearningOutlineNode(node, indexPath = '1') {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const label = `
    <span class="outline-jump depth-${escapeHtml(node.depth ?? 1)}" data-target-id="${escapeHtml(node.id)}">
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
          ${node.children.map((child, childIndex) => formatLearningOutlineNode(child, `${indexPath}.${childIndex + 1}`)).join('\n')}
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
        <li>由 Agent 把标题、目录、章节正文、检索练习和工作示例写进 <code>learning-content.json</code>。</li>
        <li>写完后重新执行渲染命令，再打开阅读器查看成品。</li>
      </ol>
      <div class="empty-paths">
        ${promptPath ? `<div><strong>写作提示</strong><span>${escapeHtml(promptPath)}</span></div>` : ''}
        ${contextPath ? `<div><strong>上下文</strong><span>${escapeHtml(contextPath)}</span></div>` : ''}
        ${contentPath ? `<div><strong>内容 JSON</strong><span>${escapeHtml(contentPath)}</span></div>` : ''}
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
  const retrievalCount = chapters.reduce((sum, chapter) => sum + (chapter.retrievalBlocks?.length ?? 0), 0);
  const workedCount = chapters.reduce((sum, chapter) => sum + (chapter.workedExamples?.length ?? 0), 0);
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

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #efede6;
        --paper: #fbfaf6;
        --panel: #fffefa;
        --ink: #151513;
        --text: #26241f;
        --muted: #6f6a60;
        --line: #ded8cc;
        --line-strong: #c9c0b2;
        --accent: #13736b;
        --accent-deep: #0c514c;
        --accent-soft: #e5f1ee;
        --amber: #7a5428;
        --amber-soft: #f1e7d7;
        --jade: #13736b;
        --wash: #f7f5ef;
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
          linear-gradient(90deg, rgba(21,21,19,0.04) 0 1px, transparent 1px 100%),
          linear-gradient(180deg, #f7f5ef 0%, var(--bg) 100%);
        background-size: 64px 64px, auto;
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
        box-shadow: 0 18px 44px rgba(27, 24, 20, 0.08);
      }
      .side-panel {
        position: sticky;
        top: 18px;
        align-self: start;
        max-height: calc(100vh - 36px);
        overflow: auto;
        padding: 18px;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.9), rgba(251,250,246,0.96)),
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
          linear-gradient(135deg, rgba(255,254,250,0.98), rgba(247,245,239,0.96)),
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
        font-size: clamp(28px, 3.4vw, 38px);
        line-height: 1.12;
        font-weight: 800;
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
      .meta-details summary {
        width: fit-content;
        cursor: pointer;
        color: var(--accent-deep);
        font-weight: 750;
        line-height: 1.4;
      }
      .meta-pill,
      .evidence-chip {
        display: inline-flex;
        width: fit-content;
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 5px 9px;
        background: #ffffff;
        color: var(--muted);
        font-size: 11px;
        text-decoration: none;
      }
      .evidence-chip {
        color: var(--accent);
        background: var(--accent-soft);
        border-color: rgba(15,118,110,0.22);
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
        background: #fffefa;
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
      .outline-jump.active,
      .outline-jump:hover {
        border-color: rgba(15,118,110,0.24);
        background: var(--accent-soft);
        color: #134e4a;
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
        box-shadow: inset 5px 0 0 var(--accent);
      }
      .chapter-kicker {
        color: var(--accent);
        font-size: 13px;
        font-weight: 800;
        margin-bottom: 8px;
      }
      .chapter h2 {
        margin: 0 0 12px;
        font-family: var(--serif);
        font-size: 42px;
        line-height: 1.22;
      }
      .chapter-summary {
        margin: 0 0 20px;
        color: var(--muted);
        font-size: 16px;
        line-height: 1.8;
      }
      .chapter p,
      .learning-block p,
      .source-card p {
        font-size: calc(17px * var(--reader-scale));
        line-height: 1.85;
      }
      .learning-block {
        margin: 22px 0;
        border: 1px solid var(--line);
        border-left-width: 4px;
        border-radius: 16px;
        padding: 18px 20px;
        background: #fffefa;
      }
      .learning-block h4 {
        margin: 0 0 12px;
        font-size: 16px;
      }
      .learning-block.retrieval { border-left-color: var(--accent); }
      .learning-block.worked { border-left-color: var(--amber); background: #fbf6ec; }
      .retrieval-item {
        border-top: 1px solid var(--line);
        padding: 10px 0;
      }
      .retrieval-item:first-of-type { border-top: 0; }
      .retrieval-item summary {
        cursor: pointer;
        font-weight: 750;
        line-height: 1.6;
      }
      .retrieval-item summary span {
        display: inline-flex;
        margin-right: 8px;
        color: var(--accent);
        font-family: var(--mono);
        font-size: 12px;
      }
      .retrieval-hint,
      .retrieval-answer,
      .worked-principle {
        color: var(--muted);
        line-height: 1.7;
        margin-top: 8px;
      }
      .worked-item + .worked-item { margin-top: 14px; }
      .worked-title {
        font-weight: 800;
      }
      ol,
      ul {
        margin: 10px 0 0;
        padding-left: 20px;
        line-height: 1.75;
      }
      .chapter-evidence {
        display: block;
        margin-top: 20px;
        padding-top: 14px;
        border-top: 1px solid var(--line);
      }
      .chapter-evidence summary {
        cursor: pointer;
      }
      .chapter-evidence summary > span {
        color: var(--muted);
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
        margin-right: 8px;
      }
      .evidence-mini-list {
        display: grid;
        gap: 8px;
        margin-top: 10px;
      }
      .evidence-mini-card {
        border: 1px solid var(--line);
        border-radius: 12px;
        background: rgba(255,255,255,0.72);
        padding: 10px;
      }
      .evidence-mini-card strong,
      .evidence-mini-card span {
        display: block;
      }
      .evidence-mini-card span {
        color: var(--muted);
        font-size: 12px;
        margin-top: 3px;
      }
      .evidence-mini-card p {
        margin: 8px 0 0;
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
      }
      @media (max-width: 700px) {
        .reader-header { padding: 18px 20px 12px; }
        h1 { font-size: 30px; }
        .chapter h2 { font-size: 28px; }
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
          ${outline.length > 0 ? outline.map((node, index) => formatLearningOutlineNode(node, `${index + 1}`)).join('\n') : '<li><span class="outline-jump"><span class="outline-number">0</span><span class="outline-copy"><strong>证据包待写作</strong><small>正文完成后显示目录</small></span></span></li>'}
        </ol>
        <div class="stat-grid">
          <div class="stat"><div class="stat-value">${chapters.length}</div><div class="stat-label">${isAwaitingAgent ? `待 Agent 写作 · ${sources.length} 份证据` : `章 · ${retrievalCount} 道检索 · ${workedCount} 个示例`}</div></div>
        </div>
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
              <button type="button" id="prevChapter"${chapters.length === 0 ? ' disabled' : ''}>上一章</button>
              <button type="button" id="nextChapter"${chapters.length === 0 ? ' disabled' : ''}>下一章</button>
              <button type="button" id="smallerText">A-</button>
              <button type="button" id="largerText">A+</button>
            </div>
            <div class="progress-wrap">
              <div class="progress-meta">
                <span id="progressTitle">阅读进度</span>
                <span id="progressText">${chapters.length > 0 ? `1/${chapters.length}` : '0/0'}</span>
              </div>
              <div class="progress-track"><div class="progress-bar" id="progressBar"></div></div>
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

export function defaultClarifyArtifactPath(ws) {
  return cjoin(ws.workspaceRoot, 'engagements', 'active', 'clarify.html');
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
