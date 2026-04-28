function escapeHtml(value) {
  return `${value ?? ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function trimText(value, max = 96) {
  const text = `${value ?? ''}`.trim();
  if (!text) return 'TBD';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function mermaidId(value, fallback = 'node') {
  const text = `${value ?? ''}`.trim();
  const normalized = text
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  const id = normalized || fallback;
  return /^[a-zA-Z_]/.test(id) ? id : `${fallback}_${id}`;
}

function mermaidText(value, max = 64) {
  return trimText(value, max)
    .replace(/["`]/g, "'")
    .replace(/[|<>]/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mermaidNodeLabel(primary, secondary) {
  const title = mermaidText(primary, 34);
  const subtitle = mermaidText(secondary, 64);
  return subtitle && subtitle !== 'TBD' ? `${title}<br/>${subtitle}` : title;
}

function mermaidNodeDeclaration(id, label, type) {
  if (type === 'decision') {
    return `  ${id}{"${label}"}`;
  }
  if (type === 'success') {
    return `  ${id}(["${label}"])`;
  }
  if (type === 'error_path') {
    return `  ${id}[["${label}"]]`;
  }
  return `  ${id}["${label}"]`;
}

function mermaidEdge(source, target, label, type = 'standard') {
  const cleanLabel = mermaidText(label, 42);
  const arrow = type === 'security' || type === 'error_path' ? '-.->' : '-->';
  return cleanLabel && cleanLabel !== 'TBD'
    ? `  ${source} ${arrow}|"${cleanLabel}"| ${target}`
    : `  ${source} ${arrow} ${target}`;
}

function normalizeList(value, fallback = []) {
  if (Array.isArray(value)) {
    const items = value.map((item) => `${item ?? ''}`.trim()).filter(Boolean);
    return items.length > 0 ? items : fallback;
  }
  const text = `${value ?? ''}`.trim();
  return text ? [text] : fallback;
}

function takeList(value, count, fallback = []) {
  return normalizeList(value, fallback).slice(0, count);
}

function joinList(value, fallback = 'TBD', separator = ' · ') {
  const items = normalizeList(value);
  return items.length > 0 ? items.join(separator) : fallback;
}

function pickValue(primary, fallback) {
  if (primary === null || primary === undefined) return fallback;
  if (typeof primary === 'string' && primary.trim() === '') return fallback;
  if (Array.isArray(primary) && primary.length === 0) return fallback;
  return primary;
}

function theme(type) {
  const themes = {
    frontend: { fill: '#0f172a', stroke: '#22d3ee', title: '#67e8f9' },
    backend: { fill: '#0f172a', stroke: '#34d399', title: '#6ee7b7' },
    database: { fill: '#0f172a', stroke: '#c084fc', title: '#d8b4fe' },
    cloud: { fill: '#0f172a', stroke: '#f59e0b', title: '#fcd34d' },
    security: { fill: '#0f172a', stroke: '#fb7185', title: '#fda4af' },
    external: { fill: '#0f172a', stroke: '#94a3b8', title: '#e2e8f0' },
    user_action: { fill: '#0f172a', stroke: '#22d3ee', title: '#67e8f9' },
    system_process: { fill: '#0f172a', stroke: '#34d399', title: '#6ee7b7' },
    decision: { fill: '#0f172a', stroke: '#f59e0b', title: '#fcd34d' },
    error_path: { fill: '#0f172a', stroke: '#fb7185', title: '#fda4af' },
    success: { fill: '#0f172a', stroke: '#c084fc', title: '#d8b4fe' },
  };
  return themes[type] ?? themes.external;
}

function normalizeCard(card, fallbackTitle = 'Summary', fallbackColor = 'external') {
  return {
    title: pickValue(card?.title, fallbackTitle),
    color: pickValue(card?.color, fallbackColor),
    items: normalizeList(card?.items, ['TBD']),
  };
}

function normalizePanel(panel, fallbackTitle = 'Review Notes', fallbackColor = 'external') {
  return {
    title: pickValue(panel?.title, fallbackTitle),
    color: pickValue(panel?.color, fallbackColor),
    items: normalizeList(panel?.items, ['TBD']),
  };
}

function normalizeLocale(contract) {
  return pickValue(contract?.locale, contract?.lang ?? 'en');
}

function normalizeReviewStatus(value) {
  return pickValue(value, 'pending-confirmation');
}

function getAtPath(root, path) {
  return path.split('.').reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), root);
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function renderShell({ lang = 'en', title, subtitle, projectName, svgMarkup, summaryCards, sidePanels, footer }) {
  const cards = summaryCards.map((card) => {
    const cardTheme = theme(card.color);
    const items = (card.items ?? []).map((item) => `<li>${escapeHtml(trimText(item, 132))}</li>`).join('');
    return `
      <div class="card">
        <div class="card-header">
          <span class="dot" style="background:${cardTheme.stroke}"></span>
          <span>${escapeHtml(card.title)}</span>
        </div>
        <ul>${items}</ul>
      </div>
    `;
  }).join('\n');

  const panels = sidePanels.map((panel) => {
    const panelTheme = theme(panel.color);
    const items = (panel.items ?? []).map((item) => `<li>${escapeHtml(trimText(item, 120))}</li>`).join('');
    return `
      <div class="card">
        <div class="card-header">
          <span class="dot" style="background:${panelTheme.stroke}"></span>
          <span>${escapeHtml(panel.title)}</span>
        </div>
        <ul>${items}</ul>
      </div>
    `;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #020617;
        --panel: rgba(15, 23, 42, 0.92);
        --text: #e2e8f0;
        --muted: #94a3b8;
        --grid: rgba(148, 163, 184, 0.12);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "JetBrains Mono", "SFMono-Regular", Menlo, monospace;
        color: var(--text);
        background:
          linear-gradient(var(--grid) 1px, transparent 1px),
          linear-gradient(90deg, var(--grid) 1px, transparent 1px),
          radial-gradient(circle at top, rgba(34, 211, 238, 0.12), transparent 30%),
          var(--bg);
        background-size: 40px 40px, 40px 40px, 100% 100%, auto;
      }
      .page { max-width: 1240px; margin: 0 auto; padding: 32px 24px 48px; }
      .header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
      .header-copy { display: flex; flex-direction: column; gap: 4px; }
      .pulse {
        width: 12px; height: 12px; border-radius: 999px; background: #22d3ee;
        box-shadow: 0 0 0 0 rgba(34, 211, 238, 0.7); animation: pulse 2s infinite;
      }
      @keyframes pulse {
        0% { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0.7); }
        70% { box-shadow: 0 0 0 10px rgba(34, 211, 238, 0); }
        100% { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0); }
      }
      .project-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        width: fit-content;
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.24);
        background: rgba(15, 23, 42, 0.72);
        color: #cbd5e1;
        font-size: 11px;
      }
      h1 { margin: 0; font-size: 28px; }
      .subtitle-block { margin: 6px 0 0 24px; color: var(--muted); font-size: 13px; }
      .diagram-shell {
        margin-top: 24px; border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 20px;
        padding: 20px; background: rgba(2, 6, 23, 0.72); backdrop-filter: blur(6px);
      }
      svg { width: 100%; height: auto; display: block; }
      .node-title { font-size: 13px; font-weight: 700; }
      .node-subtitle, .detail, .flow-label, .legend-label, .footer { font-size: 10px; fill: #cbd5e1; }
      .detail { fill: #94a3b8; }
      .summary-grid, .side-grid { display: grid; gap: 16px; margin-top: 24px; }
      .summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .side-grid { grid-template-columns: 1fr 1fr; }
      .card {
        border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 16px;
        background: var(--panel); padding: 14px 16px;
      }
      .card-header { display: flex; align-items: center; gap: 10px; font-size: 12px; margin-bottom: 8px; }
      .dot { width: 10px; height: 10px; border-radius: 999px; }
      ul { padding-left: 18px; margin: 0; color: #cbd5e1; font-size: 12px; line-height: 1.65; }
      .footer { margin-top: 18px; color: var(--muted); }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="header">
        <div class="pulse"></div>
        <div class="header-copy">
          <div class="project-chip">${escapeHtml(projectName ?? title)}</div>
          <h1>${escapeHtml(title)}</h1>
          <p class="subtitle-block">${escapeHtml(subtitle)}</p>
        </div>
      </div>
      <div class="diagram-shell">${svgMarkup}</div>
      <div class="summary-grid">${cards}</div>
      <div class="side-grid">${panels}</div>
      <div class="footer">${escapeHtml(footer)}</div>
    </div>
  </body>
</html>`;
}

function renderBox(node, layout) {
  const nodeTheme = theme(node.type);
  const detailLines = (node.details ?? []).slice(0, 4);
  const detailMarkup = detailLines.map((line, index) => (
    `<text x="${layout.x + 16}" y="${layout.y + 54 + (index * 16)}" class="detail">${escapeHtml(trimText(line, 42))}</text>`
  )).join('');

  return `
    <g>
      <rect x="${layout.x}" y="${layout.y}" width="${layout.width}" height="${layout.height}" rx="14" fill="${nodeTheme.fill}" fill-opacity="0.92" stroke="${nodeTheme.stroke}" stroke-width="1.5"></rect>
      <text x="${layout.x + 16}" y="${layout.y + 28}" class="node-title" fill="${nodeTheme.title}">${escapeHtml(node.name)}</text>
      <text x="${layout.x + 16}" y="${layout.y + 44}" class="node-subtitle">${escapeHtml(trimText(node.subtitle, 48))}</text>
      ${detailMarkup}
    </g>
  `;
}

function renderArrow(def) {
  const dashed = def.type === 'security' || def.type === 'error_path' ? 'stroke-dasharray="6,4"' : '';
  const stroke = def.type === 'security' || def.type === 'error_path' ? '#fb7185' : '#7dd3fc';
  return `<path d="${def.path}" fill="none" stroke="${stroke}" stroke-width="2" ${dashed} marker-end="url(#arrowhead)"></path>
  <text x="${def.labelX}" y="${def.labelY}" class="flow-label">${escapeHtml(def.label)}</text>`;
}

function resolveProductLayerTitle(productType) {
  if (productType === 'consumer') return 'Consumer Experience Layer';
  if (productType === 'b2b') return 'Business Workflow Layer';
  if (productType === 'agent') return 'Agent Runtime Layer';
  return 'Product Experience Layer';
}

function buildArchitectureComponents(snapshot) {
  const { sections } = snapshot;
  const reviewTarget = sections.handoff.targetSystem ?? 'OpenSpec';
  return [
    {
      id: 'users',
      name: 'Primary Users',
      type: 'external',
      subtitle: joinList(sections.users.primaryUsers, 'Users'),
      details: takeList(sections.users.stakeholders, 3, ['Stakeholders need confirmation']),
    },
    {
      id: 'experience',
      name: resolveProductLayerTitle(snapshot.productType),
      type: 'frontend',
      subtitle: trimText(joinList(sections.scenarios.primaryFlows, sections.meta.title)),
      details: takeList(sections.scope.inScope, 3, ['Scope still needs refinement']),
    },
    {
      id: 'core',
      name: 'Core Product Logic',
      type: 'backend',
      subtitle: trimText(sections.problem.problemStatement ?? 'Core logic to be clarified'),
      details: takeList(sections.requirements.functional, 3, ['Functional requirements TBD']),
    },
    {
      id: 'integrations',
      name: 'Dependencies & Integrations',
      type: 'cloud',
      subtitle: trimText(joinList(sections.constraints.dependencies, 'No external dependencies recorded')),
      details: takeList(sections.constraints.dependencies, 4, ['Dependencies not confirmed']),
    },
    {
      id: 'governance',
      name: 'Guardrails & Reliability',
      type: 'security',
      subtitle: trimText(joinList(sections.constraints.compliance, joinList(sections.requirements.nonFunctional, 'No explicit guardrails yet'))),
      details: [
        ...takeList(sections.constraints.compliance, 2),
        ...takeList(sections.requirements.nonFunctional, 2),
      ].slice(0, 4),
    },
    {
      id: 'delivery',
      name: 'Validation & Handoff',
      type: 'database',
      subtitle: trimText(joinList(sections.goals.successMetrics, 'Success metrics to confirm')),
      details: [
        `Target: ${reviewTarget}`,
        `Next: ${trimText(sections.handoff.nextStep ?? 'Confirm next step', 48)}`,
        ...takeList(sections.goals.acceptanceGoals, 2),
      ].slice(0, 4),
    },
  ];
}

export function buildArchitectureDiagramModel(snapshot) {
  const scopeIn = takeList(snapshot.sections.scope.inScope, 3, ['Scope to be clarified']);
  const scopeOut = takeList(snapshot.sections.scope.outOfScope, 2, ['Out-of-scope not yet explicit']);
  const assumptions = takeList(snapshot.sections.risks.assumptions, 4, ['Assumptions still need review']);
  const openQuestions = takeList(snapshot.sections.risks.openQuestions, 4, ['No open questions captured yet']);
  const primaryFlows = takeList(snapshot.sections.scenarios.primaryFlows, 3, ['Primary flow still needs confirmation']);

  return {
    type: 'architecture',
    version: 1,
    generatedAt: new Date().toISOString(),
    locale: 'en',
    title: 'Architecture Review',
    subtitle: 'Review the proposed system boundaries, dependencies, and handoff shape before freeze.',
    components: buildArchitectureComponents(snapshot),
    flows: [
      { source: 'users', target: 'experience', label: trimText(primaryFlows[0] ?? 'User enters the product flow', 40), type: 'standard' },
      { source: 'experience', target: 'core', label: 'Product actions + orchestration', type: 'standard' },
      { source: 'core', target: 'integrations', label: 'Dependencies / external services', type: 'standard' },
      { source: 'core', target: 'governance', label: 'Policies / reliability / compliance', type: 'security' },
      { source: 'core', target: 'delivery', label: 'Success criteria + handoff', type: 'standard' },
      { source: 'integrations', target: 'delivery', label: 'Operational readiness', type: 'standard' },
      { source: 'governance', target: 'delivery', label: 'Review + sign-off', type: 'security' },
    ],
    summaryCards: [
      {
        title: 'Scope',
        color: 'frontend',
        items: [
          `In scope: ${scopeIn.join(' / ')}`,
          `Out of scope: ${scopeOut.join(' / ')}`,
          `Primary flow: ${primaryFlows.join(' / ')}`,
        ],
      },
      {
        title: 'Architecture Checks',
        color: 'backend',
        items: [
          `Core logic: ${takeList(snapshot.sections.requirements.functional, 2, ['Functional requirements TBD']).join(' / ')}`,
          `Dependencies: ${takeList(snapshot.sections.constraints.dependencies, 2, ['Dependencies TBD']).join(' / ')}`,
          `Guardrails: ${takeList(snapshot.sections.constraints.compliance, 2, takeList(snapshot.sections.requirements.nonFunctional, 2, ['Guardrails TBD'])).join(' / ')}`,
        ],
      },
      {
        title: 'Review Focus',
        color: 'cloud',
        items: [
          `Confirm missing assumptions: ${assumptions.join(' / ')}`,
          `Open questions: ${openQuestions.join(' / ')}`,
          'Ask the user to confirm boxes, boundaries, and missing systems before freeze.',
        ],
      },
    ],
    sidePanels: [
      { title: 'Assumptions', color: 'database', items: assumptions },
      {
        title: 'Review Instructions',
        color: 'cloud',
        items: [
          'Confirm whether the boxes reflect the intended architecture after clarification.',
          'Mark any missing systems, boundaries, or external dependencies.',
          'Validate reliability, compliance, and handoff expectations before freeze.',
        ],
      },
    ],
    metadata: {
      projectName: snapshot.title,
      productType: snapshot.productType ?? 'unclassified',
      owner: snapshot.owner,
      versionId: snapshot.versionId,
      targetSystem: snapshot.sections.handoff.targetSystem ?? 'OpenSpec',
      reviewStatus: normalizeReviewStatus(snapshot?.reviewStatus),
    },
  };
}

export function renderArchitectureDiagramHtml(model) {
  const layouts = {
    users: { x: 390, y: 48, width: 300, height: 96 },
    experience: { x: 70, y: 228, width: 290, height: 120 },
    core: { x: 395, y: 228, width: 290, height: 120 },
    delivery: { x: 720, y: 228, width: 290, height: 120 },
    integrations: { x: 180, y: 448, width: 290, height: 120 },
    governance: { x: 610, y: 448, width: 290, height: 120 },
  };
  const fallbackLayouts = [
    { x: 390, y: 48, width: 300, height: 96 },
    { x: 70, y: 228, width: 290, height: 120 },
    { x: 395, y: 228, width: 290, height: 120 },
    { x: 720, y: 228, width: 290, height: 120 },
    { x: 180, y: 448, width: 290, height: 120 },
    { x: 610, y: 448, width: 290, height: 120 },
  ];

  const arrows = [
    { path: 'M 540 144 C 540 182, 215 176, 215 228', label: model.flows[0]?.label ?? 'User flow', labelX: 312, labelY: 176, type: model.flows[0]?.type ?? 'standard' },
    { path: 'M 360 288 L 395 288', label: model.flows[1]?.label ?? 'Product actions', labelX: 366, labelY: 276, type: model.flows[1]?.type ?? 'standard' },
    { path: 'M 685 288 L 720 288', label: model.flows[4]?.label ?? 'Success criteria', labelX: 694, labelY: 276, type: model.flows[4]?.type ?? 'standard' },
    { path: 'M 540 348 C 540 392, 325 396, 325 448', label: model.flows[2]?.label ?? 'Dependencies', labelX: 300, labelY: 392, type: model.flows[2]?.type ?? 'standard' },
    { path: 'M 540 348 C 540 392, 755 396, 755 448', label: model.flows[3]?.label ?? 'Guardrails', labelX: 692, labelY: 392, type: model.flows[3]?.type ?? 'security' },
    { path: 'M 470 568 C 470 610, 820 610, 820 348', label: model.flows[5]?.label ?? 'Operational readiness', labelX: 596, labelY: 614, type: model.flows[5]?.type ?? 'standard' },
    { path: 'M 820 568 C 920 612, 920 416, 865 348', label: model.flows[6]?.label ?? 'Review + sign-off', labelX: 850, labelY: 612, type: model.flows[6]?.type ?? 'security' },
  ];

  const componentMarkup = model.components
    .map((component, index) => renderBox(component, layouts[component.id] ?? fallbackLayouts[index] ?? fallbackLayouts.at(-1)))
    .join('\n');
  const arrowMarkup = arrows.map(renderArrow).join('\n');
  const svgMarkup = `
    <svg viewBox="0 0 1080 720" role="img" aria-label="${escapeHtml(model.title)}">
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
          <polygon points="0 0, 10 5, 0 10" fill="#7dd3fc"></polygon>
        </marker>
      </defs>
      <rect x="40" y="172" width="1000" height="430" rx="18" fill="none" stroke="#f59e0b" stroke-opacity="0.55" stroke-width="1.5" stroke-dasharray="8,5"></rect>
      <text x="58" y="194" class="legend-label">Proposed Solution Boundary</text>
      ${arrowMarkup}
      ${componentMarkup}
      <g>
        <text x="54" y="652" class="legend-label">Legend</text>
        <rect x="54" y="666" width="12" height="12" rx="3" fill="#22d3ee"></rect><text x="74" y="676" class="legend-label">Experience</text>
        <rect x="182" y="666" width="12" height="12" rx="3" fill="#34d399"></rect><text x="202" y="676" class="legend-label">Core Logic</text>
        <rect x="330" y="666" width="12" height="12" rx="3" fill="#c084fc"></rect><text x="350" y="676" class="legend-label">Validation</text>
        <rect x="476" y="666" width="12" height="12" rx="3" fill="#f59e0b"></rect><text x="496" y="676" class="legend-label">Dependencies</text>
        <rect x="640" y="666" width="12" height="12" rx="3" fill="#fb7185"></rect><text x="660" y="676" class="legend-label">Guardrails</text>
        <rect x="798" y="666" width="12" height="12" rx="3" fill="#94a3b8"></rect><text x="818" y="676" class="legend-label">External / Users</text>
      </g>
    </svg>
  `;

  return renderShell({
    lang: model.locale ?? 'en',
    title: model.title,
    subtitle: model.subtitle,
    projectName: model.metadata?.projectName ?? model.title,
    svgMarkup,
    summaryCards: model.summaryCards,
    sidePanels: model.sidePanels,
    footer: `Owner: ${model.metadata.owner} · Version: ${model.metadata.versionId} · Target: ${model.metadata.targetSystem} · Generated: ${model.generatedAt}`,
  });
}

export function buildProductFlowDiagramModel(snapshot) {
  const primaryUsers = takeList(snapshot.sections.users.primaryUsers, 2, ['Primary user']);
  const primaryFlows = takeList(snapshot.sections.scenarios.primaryFlows, 4, ['Primary flow still needs confirmation']);
  const edgeCases = takeList(snapshot.sections.scenarios.edgeCases, 3, ['Edge cases still need clarification']);
  const failureModes = takeList(snapshot.sections.scenarios.failureModes, 3, ['Failure paths still need clarification']);
  const goals = takeList(snapshot.sections.goals.goals, 2, ['Goal still needs confirmation']);
  const successMetrics = takeList(snapshot.sections.goals.successMetrics, 2, ['Success metric still needs confirmation']);
  const openQuestions = takeList(snapshot.sections.risks.openQuestions, 4, ['No open questions captured yet']);
  const steps = [
    {
      id: 'entry',
      name: 'Entry Trigger',
      type: 'user_action',
      lane: primaryUsers[0],
      subtitle: trimText(primaryFlows[0] ?? 'User enters the flow'),
      details: takeList(snapshot.sections.scope.inScope, 2, ['Scope still needs refinement']),
    },
    {
      id: 'experience',
      name: 'In-Product Step',
      type: 'system_process',
      lane: 'Product',
      subtitle: trimText(primaryFlows[1] ?? snapshot.sections.problem.problemStatement ?? 'Core product step'),
      details: takeList(snapshot.sections.requirements.functional, 2, ['Functional requirements TBD']),
    },
    {
      id: 'decision',
      name: 'Decision Point',
      type: 'decision',
      lane: 'Decision',
      subtitle: trimText(edgeCases[0] ?? 'Decision criteria need clarification'),
      details: [
        `Goal: ${trimText(goals[0], 40)}`,
        `Metric: ${trimText(successMetrics[0], 40)}`,
      ],
    },
    {
      id: 'success',
      name: 'Success Outcome',
      type: 'success',
      lane: 'Outcome',
      subtitle: trimText(successMetrics[0] ?? 'Success still needs confirmation'),
      details: takeList(snapshot.sections.goals.acceptanceGoals, 2, ['Acceptance goal TBD']),
    },
    {
      id: 'failure',
      name: 'Failure / Recovery',
      type: 'error_path',
      lane: 'Outcome',
      subtitle: trimText(failureModes[0] ?? 'Failure path needs clarification'),
      details: [
        ...failureModes.slice(0, 2),
        ...openQuestions.slice(0, 2),
      ].slice(0, 4),
    },
  ];

  return {
    type: 'product-flow',
    version: 1,
    generatedAt: new Date().toISOString(),
    locale: 'en',
    title: 'Product Flow Review',
    subtitle: 'Review the primary journey, decision points, and recovery paths before freeze.',
    actors: primaryUsers,
    steps,
    transitions: [
      { from: 'entry', to: 'experience', label: primaryFlows[0] ?? 'Start journey', type: 'standard' },
      { from: 'experience', to: 'decision', label: primaryFlows[1] ?? 'System processes request', type: 'standard' },
      { from: 'decision', to: 'success', label: goals[0] ?? 'Success path', type: 'standard' },
      { from: 'decision', to: 'failure', label: failureModes[0] ?? 'Failure path', type: 'error_path' },
    ],
    summaryCards: [
      {
        title: 'Actors & Scope',
        color: 'user_action',
        items: [
          `Actors: ${primaryUsers.join(' / ')}`,
          `In scope: ${takeList(snapshot.sections.scope.inScope, 2, ['Scope TBD']).join(' / ')}`,
          `Out of scope: ${takeList(snapshot.sections.scope.outOfScope, 2, ['Out-of-scope TBD']).join(' / ')}`,
        ],
      },
      {
        title: 'Flow Checks',
        color: 'system_process',
        items: [
          `Primary flow: ${primaryFlows.join(' / ')}`,
          `Edge cases: ${edgeCases.join(' / ')}`,
          `Failure modes: ${failureModes.join(' / ')}`,
        ],
      },
      {
        title: 'Review Focus',
        color: 'decision',
        items: [
          `Goals: ${goals.join(' / ')}`,
          `Success metrics: ${successMetrics.join(' / ')}`,
          'Confirm steps, decision points, and missing recovery paths before freeze.',
        ],
      },
    ],
    sidePanels: [
      { title: 'Open Questions', color: 'error_path', items: openQuestions },
      {
        title: 'Review Instructions',
        color: 'decision',
        items: [
          'Confirm whether the user journey and system responses are in the right order.',
          'Mark missing decision points, failure paths, and recovery steps.',
          'Confirm that this flow is complete enough to support freeze.',
        ],
      },
    ],
    metadata: {
      projectName: snapshot.title,
      productType: snapshot.productType ?? 'unclassified',
      owner: snapshot.owner,
      versionId: snapshot.versionId,
      targetSystem: snapshot.sections.handoff.targetSystem ?? 'OpenSpec',
      reviewStatus: normalizeReviewStatus(snapshot?.reviewStatus),
    },
  };
}

export function renderProductFlowDiagramHtml(model) {
  const layouts = {
    entry: { x: 90, y: 250, width: 190, height: 112 },
    experience: { x: 330, y: 250, width: 210, height: 112 },
    decision: { x: 590, y: 245, width: 180, height: 122 },
    success: { x: 820, y: 140, width: 180, height: 112 },
    failure: { x: 820, y: 360, width: 180, height: 122 },
  };
  const fallbackLayouts = [
    { x: 90, y: 250, width: 190, height: 112 },
    { x: 330, y: 250, width: 210, height: 112 },
    { x: 590, y: 245, width: 180, height: 122 },
    { x: 820, y: 140, width: 180, height: 112 },
    { x: 820, y: 360, width: 180, height: 122 },
  ];

  const laneMarkup = [
    { y: 118, label: 'User / Trigger' },
    { y: 220, label: 'Core Flow' },
    { y: 438, label: 'Outcomes / Recovery' },
  ].map((lane) => `
    <g>
      <line x1="70" y1="${lane.y}" x2="1020" y2="${lane.y}" stroke="#334155" stroke-width="1" stroke-dasharray="6,4"></line>
      <text x="74" y="${lane.y - 8}" class="legend-label">${escapeHtml(lane.label)}</text>
    </g>
  `).join('\n');

  const stepMarkup = model.steps
    .map((step, index) => renderBox(step, layouts[step.id] ?? fallbackLayouts[index] ?? fallbackLayouts.at(-1)))
    .join('\n');
  const transitions = [
    { path: 'M 280 306 L 330 306', label: model.transitions[0]?.label ?? 'Start', labelX: 288, labelY: 294, type: model.transitions[0]?.type ?? 'standard' },
    { path: 'M 540 306 L 590 306', label: model.transitions[1]?.label ?? 'Core step', labelX: 546, labelY: 294, type: model.transitions[1]?.type ?? 'standard' },
    { path: 'M 770 282 C 800 240, 820 220, 820 196', label: model.transitions[2]?.label ?? 'Success path', labelX: 786, labelY: 226, type: model.transitions[2]?.type ?? 'standard' },
    { path: 'M 770 330 C 800 370, 820 400, 820 420', label: model.transitions[3]?.label ?? 'Failure path', labelX: 786, labelY: 388, type: model.transitions[3]?.type ?? 'error_path' },
  ].map(renderArrow).join('\n');

  const svgMarkup = `
    <svg viewBox="0 0 1080 720" role="img" aria-label="${escapeHtml(model.title)}">
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
          <polygon points="0 0, 10 5, 0 10" fill="#7dd3fc"></polygon>
        </marker>
      </defs>
      <rect x="56" y="92" width="968" height="520" rx="18" fill="none" stroke="#f59e0b" stroke-opacity="0.45" stroke-width="1.5" stroke-dasharray="8,5"></rect>
      <text x="74" y="118" class="legend-label">Product Flow Boundary</text>
      ${laneMarkup}
      ${transitions}
      ${stepMarkup}
      <g>
        <text x="54" y="652" class="legend-label">Legend</text>
        <rect x="54" y="666" width="12" height="12" rx="3" fill="#22d3ee"></rect><text x="74" y="676" class="legend-label">User Action</text>
        <rect x="196" y="666" width="12" height="12" rx="3" fill="#34d399"></rect><text x="216" y="676" class="legend-label">System Process</text>
        <rect x="372" y="666" width="12" height="12" rx="3" fill="#f59e0b"></rect><text x="392" y="676" class="legend-label">Decision</text>
        <rect x="516" y="666" width="12" height="12" rx="3" fill="#c084fc"></rect><text x="536" y="676" class="legend-label">Success</text>
        <rect x="648" y="666" width="12" height="12" rx="3" fill="#fb7185"></rect><text x="668" y="676" class="legend-label">Error / Recovery</text>
      </g>
    </svg>
  `;

  return renderShell({
    lang: model.locale ?? 'en',
    title: model.title,
    subtitle: model.subtitle,
    projectName: model.metadata?.projectName ?? model.title,
    svgMarkup,
    summaryCards: model.summaryCards,
    sidePanels: model.sidePanels,
    footer: `Owner: ${model.metadata.owner} · Version: ${model.metadata.versionId} · Target: ${model.metadata.targetSystem} · Generated: ${model.generatedAt}`,
  });
}

export function renderProductFlowMermaid(model) {
  const steps = Array.isArray(model.steps) ? model.steps : [];
  const idMap = new Map();
  const declarations = steps.map((step, index) => {
    const id = mermaidId(step.id, `step_${index + 1}`);
    idMap.set(step.id, id);
    const label = mermaidNodeLabel(step.name, step.subtitle ?? step.description);
    return mermaidNodeDeclaration(id, label, step.type);
  });
  const edges = (Array.isArray(model.transitions) ? model.transitions : [])
    .map((transition) => {
      const from = idMap.get(transition.from) ?? mermaidId(transition.from, 'from');
      const to = idMap.get(transition.to) ?? mermaidId(transition.to, 'to');
      return mermaidEdge(from, to, transition.label, transition.type);
    });

  return [
    'flowchart LR',
    ...declarations,
    ...edges,
  ].join('\n');
}

export function renderArchitectureMermaid(model) {
  const components = Array.isArray(model.components) ? model.components : [];
  const idMap = new Map();
  const external = [];
  const internal = [];

  for (const [index, component] of components.entries()) {
    const id = mermaidId(component.id, `component_${index + 1}`);
    idMap.set(component.id, id);
    const label = mermaidNodeLabel(component.name, component.subtitle ?? component.description);
    const declaration = mermaidNodeDeclaration(id, label, component.type === 'security' ? 'error_path' : 'system_process');
    if (component.type === 'external') {
      external.push(declaration);
    } else {
      internal.push(declaration);
    }
  }

  const edges = (Array.isArray(model.flows) ? model.flows : [])
    .map((flow) => {
      const source = idMap.get(flow.source) ?? mermaidId(flow.source, 'source');
      const target = idMap.get(flow.target) ?? mermaidId(flow.target, 'target');
      return mermaidEdge(source, target, flow.label, flow.type);
    });

  return [
    'flowchart LR',
    ...external,
    '  subgraph solution["Proposed Solution Boundary"]',
    ...internal.map((line) => `  ${line}`),
    '  end',
    ...edges,
  ].join('\n');
}

export function renderDiagramMermaidFromModel(type, model) {
  if (type === 'product-flow') {
    return renderProductFlowMermaid(model);
  }
  return renderArchitectureMermaid(model);
}

export function buildDiagramArtifact(snapshot, options = {}) {
  const type = options.type ?? 'architecture';
  const contract = options.contract ?? null;

  if (type === 'product-flow' && contract) {
    const base = buildProductFlowDiagramModel(snapshot);
    const model = {
      ...base,
      ...contract,
      type: 'product-flow',
      locale: normalizeLocale(contract),
      title: pickValue(contract.title, base.title),
      subtitle: pickValue(contract.subtitle, base.subtitle),
      actors: normalizeList(contract.actors, base.actors),
      steps: Array.isArray(contract.steps) && contract.steps.length > 0
        ? contract.steps.map((step, index) => ({
          id: pickValue(step?.id, `step-${index + 1}`),
          name: pickValue(step?.name, `Step ${index + 1}`),
          type: pickValue(step?.type, 'system_process'),
          lane: pickValue(step?.lane, 'Flow'),
          subtitle: pickValue(step?.subtitle, step?.description ?? 'TBD'),
          details: normalizeList(step?.details ?? step?.notes ?? step?.data_involved, ['TBD']),
        }))
        : base.steps,
      transitions: Array.isArray(contract.transitions) && contract.transitions.length > 0
        ? contract.transitions.map((transition) => ({
          from: pickValue(transition?.from, transition?.from_step_id),
          to: pickValue(transition?.to, transition?.to_step_id),
          label: pickValue(transition?.label, transition?.condition ?? 'Transition'),
          type: pickValue(transition?.type, 'standard'),
        }))
        : base.transitions,
      summaryCards: Array.isArray(contract.summaryCards) && contract.summaryCards.length > 0
        ? contract.summaryCards.map((card, index) => normalizeCard(card, `Summary ${index + 1}`, 'system_process'))
        : base.summaryCards,
      sidePanels: Array.isArray(contract.sidePanels) && contract.sidePanels.length > 0
        ? contract.sidePanels.map((panel, index) => normalizePanel(panel, `Panel ${index + 1}`, 'decision'))
        : [
          normalizePanel({
            title: contract.openQuestionsTitle ?? 'Open Questions',
            color: 'error_path',
            items: contract.openQuestions,
          }),
          normalizePanel({
            title: contract.reviewInstructionsTitle ?? 'Review Instructions',
            color: 'decision',
            items: contract.reviewInstructions,
          }),
        ],
      metadata: {
        ...base.metadata,
        ...(contract.metadata ?? {}),
        versionId: pickValue(contract?.metadata?.versionId, base.metadata.versionId),
        owner: pickValue(contract?.metadata?.owner, base.metadata.owner),
        targetSystem: pickValue(contract?.metadata?.targetSystem, base.metadata.targetSystem),
      },
    };

    return { type, model, html: renderProductFlowDiagramHtml(model) };
  }

  if (type === 'architecture' && contract) {
    const base = buildArchitectureDiagramModel(snapshot);
    const model = {
      ...base,
      ...contract,
      type: 'architecture',
      locale: normalizeLocale(contract),
      title: pickValue(contract.title, base.title),
      subtitle: pickValue(contract.subtitle, base.subtitle),
      components: Array.isArray(contract.components) && contract.components.length > 0
        ? contract.components.map((component, index) => ({
          id: pickValue(component?.id, `component-${index + 1}`),
          name: pickValue(component?.name, `Component ${index + 1}`),
          type: pickValue(component?.type, 'external'),
          subtitle: pickValue(component?.subtitle, component?.description ?? 'TBD'),
          details: normalizeList(component?.details, ['TBD']),
        }))
        : base.components,
      flows: Array.isArray(contract.flows) && contract.flows.length > 0
        ? contract.flows.map((flow) => ({
          source: pickValue(flow?.source, 'source'),
          target: pickValue(flow?.target, 'target'),
          label: pickValue(flow?.label, 'Flow'),
          type: pickValue(flow?.type, 'standard'),
        }))
        : base.flows,
      summaryCards: Array.isArray(contract.summaryCards) && contract.summaryCards.length > 0
        ? contract.summaryCards.map((card, index) => normalizeCard(card, `Summary ${index + 1}`, 'frontend'))
        : base.summaryCards,
      sidePanels: Array.isArray(contract.sidePanels) && contract.sidePanels.length > 0
        ? contract.sidePanels.map((panel, index) => normalizePanel(panel, `Panel ${index + 1}`, 'database'))
        : [
          normalizePanel({
            title: contract.assumptionsTitle ?? 'Assumptions',
            color: 'database',
            items: contract.assumptions,
          }),
          normalizePanel({
            title: contract.reviewInstructionsTitle ?? 'Review Instructions',
            color: 'cloud',
            items: contract.reviewInstructions,
          }),
        ],
      metadata: {
        ...base.metadata,
        ...(contract.metadata ?? {}),
        versionId: pickValue(contract?.metadata?.versionId, base.metadata.versionId),
        owner: pickValue(contract?.metadata?.owner, base.metadata.owner),
        targetSystem: pickValue(contract?.metadata?.targetSystem, base.metadata.targetSystem),
      },
    };

    return { type, model, html: renderArchitectureDiagramHtml(model) };
  }

  if (type === 'product-flow') {
    const model = buildProductFlowDiagramModel(snapshot);
    return {
      type,
      model,
      html: renderProductFlowDiagramHtml(model),
    };
  }

  const model = buildArchitectureDiagramModel(snapshot);
  return {
    type: 'architecture',
    model,
    html: renderArchitectureDiagramHtml(model),
  };
}

export function renderDiagramArtifactFromModel(type, model) {
  if (type === 'product-flow') {
    return renderProductFlowDiagramHtml(model);
  }
  return renderArchitectureDiagramHtml(model);
}

export function validateDiagramContract(contract, schema) {
  const errors = [];
  if (!schema || typeof schema !== 'object') {
    return { valid: false, errors: ['Missing diagram schema'] };
  }
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    return { valid: false, errors: ['Diagram contract must be a JSON object'] };
  }

  const requiredFields = Array.isArray(schema.requiredFields) ? schema.requiredFields : [];
  for (const field of requiredFields) {
    if (!hasValue(getAtPath(contract, field))) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  const requiredArrays = schema.requiredArrays ?? {};
  for (const [field, minItems] of Object.entries(requiredArrays)) {
    const value = getAtPath(contract, field);
    if (!Array.isArray(value)) {
      errors.push(`Field must be an array: ${field}`);
      continue;
    }
    if (value.length < Number(minItems)) {
      errors.push(`Field requires at least ${minItems} item(s): ${field}`);
    }
  }

  const itemRequiredFields = schema.itemRequiredFields ?? {};
  for (const [field, nestedFields] of Object.entries(itemRequiredFields)) {
    const list = getAtPath(contract, field);
    if (!Array.isArray(list)) continue;
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      for (const nestedField of nestedFields) {
        const aliases = nestedField.split('|');
        const ok = aliases.some((alias) => hasValue(item?.[alias]));
        if (!ok) {
          errors.push(`Missing required field in ${field}[${index}]: ${nestedField}`);
        }
      }
    }
  }

  const allowedValues = schema.allowedValues ?? {};
  for (const [field, allowed] of Object.entries(allowedValues)) {
    const value = getAtPath(contract, field);
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!allowed.includes(item)) {
          errors.push(`Unsupported value in ${field}: ${item}`);
        }
      }
      continue;
    }
    if (!allowed.includes(value)) {
      errors.push(`Unsupported value for ${field}: ${value}`);
    }
  }

  const itemAllowedValues = schema.itemAllowedValues ?? {};
  for (const [field, mapping] of Object.entries(itemAllowedValues)) {
    const list = getAtPath(contract, field);
    if (!Array.isArray(list)) continue;
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      for (const [nestedField, allowed] of Object.entries(mapping)) {
        const value = item?.[nestedField];
        if (value === undefined || value === null || value === '') continue;
        if (!allowed.includes(value)) {
          errors.push(`Unsupported value for ${field}[${index}].${nestedField}: ${value}`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
