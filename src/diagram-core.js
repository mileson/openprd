import { timestamp } from './time.js';
import { isEnglishHeavyText, normalizeOutputLocale } from './language-policy.js';

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
  if (!text) return '待补充';
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
  return subtitle && subtitle !== '待补充' ? `${title}<br/>${subtitle}` : title;
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
  return cleanLabel && cleanLabel !== '待补充'
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

function joinList(value, fallback = '待补充', separator = ' · ') {
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
    frontend: { fill: '#eff6ff', stroke: '#2563eb', title: '#1d4ed8' },
    backend: { fill: '#f0fdfa', stroke: '#0f766e', title: '#0f766e' },
    database: { fill: '#eef2ff', stroke: '#4f46e5', title: '#4338ca' },
    cloud: { fill: '#fffbeb', stroke: '#b45309', title: '#b45309' },
    security: { fill: '#fef2f2', stroke: '#dc2626', title: '#b91c1c' },
    external: { fill: '#f8fafc', stroke: '#94a3b8', title: '#475569' },
    user_action: { fill: '#eff6ff', stroke: '#2563eb', title: '#1d4ed8' },
    system_process: { fill: '#f0fdfa', stroke: '#0f766e', title: '#0f766e' },
    decision: { fill: '#fffbeb', stroke: '#b45309', title: '#b45309' },
    error_path: { fill: '#fef2f2', stroke: '#dc2626', title: '#b91c1c' },
    success: { fill: '#eef2ff', stroke: '#4f46e5', title: '#4338ca' },
  };
  return themes[type] ?? themes.external;
}

function normalizeCard(card, fallbackTitle = '摘要', fallbackColor = 'external') {
  return {
    title: pickValue(card?.title, fallbackTitle),
    color: pickValue(card?.color, fallbackColor),
    items: normalizeList(card?.items, ['待补充']),
  };
}

function normalizePanel(panel, fallbackTitle = '评审备注', fallbackColor = 'external') {
  return {
    title: pickValue(panel?.title, fallbackTitle),
    color: pickValue(panel?.color, fallbackColor),
    items: normalizeList(panel?.items, ['待补充']),
  };
}

function normalizeLocale(contract) {
  return normalizeOutputLocale(pickValue(contract?.locale, contract?.lang ?? 'zh-CN'));
}

function normalizeReviewStatus(value) {
  return pickValue(value, 'pending-confirmation');
}

function collectDiagramTexts(model) {
  const entries = [];
  const push = (path, value) => {
    if (typeof value === 'string' && value.trim()) {
      entries.push({ path, value: value.trim() });
    }
  };
  push('title', model.title);
  push('subtitle', model.subtitle);
  push('metadata.projectName', model.metadata?.projectName);
  for (const [index, component] of (model.components ?? []).entries()) {
    push(`components.${index}.name`, component.name);
    push(`components.${index}.subtitle`, component.subtitle);
    for (const [detailIndex, detail] of (component.details ?? []).entries()) {
      push(`components.${index}.details.${detailIndex}`, detail);
    }
  }
  for (const [index, flow] of (model.flows ?? []).entries()) {
    push(`flows.${index}.label`, flow.label);
  }
  for (const [index, card] of (model.summaryCards ?? []).entries()) {
    push(`summaryCards.${index}.title`, card.title);
    for (const [itemIndex, item] of (card.items ?? []).entries()) {
      push(`summaryCards.${index}.items.${itemIndex}`, item);
    }
  }
  for (const [index, panel] of (model.sidePanels ?? []).entries()) {
    push(`sidePanels.${index}.title`, panel.title);
    for (const [itemIndex, item] of (panel.items ?? []).entries()) {
      push(`sidePanels.${index}.items.${itemIndex}`, item);
    }
  }
  for (const [index, instruction] of (model.reviewInstructions ?? []).entries()) {
    push(`reviewInstructions.${index}`, instruction);
  }
  return entries;
}

export function validateDiagramLanguage(model) {
  const locale = normalizeOutputLocale(model?.locale ?? 'zh-CN').toLowerCase();
  if (!locale.startsWith('zh')) {
    return { valid: true, errors: [] };
  }
  const offenders = collectDiagramTexts(model)
    .filter((entry) => isEnglishHeavyText(entry.value))
    .slice(0, 12);
  return {
    valid: offenders.length === 0,
    errors: offenders.map((entry) => (
      `${entry.path} 应使用简体中文表达，当前内容偏英文: ${trimText(entry.value, 96)}`
    )),
  };
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

function renderShell({ lang = 'zh-CN', title, subtitle, projectName, svgMarkup, summaryCards, sidePanels, footer }) {
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
        color-scheme: light;
        --bg: #f6f8fb;
        --panel: #ffffff;
        --panel-soft: #f9fafb;
        --text: #172033;
        --muted: #667085;
        --line: #d8dee8;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--text);
        background: var(--bg);
      }
      .page { max-width: 1240px; margin: 0 auto; padding: 32px 24px 48px; }
      .header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
      .header-copy { display: flex; flex-direction: column; gap: 4px; }
      .pulse {
        width: 12px; height: 12px; border-radius: 999px; background: #2563eb;
        box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.5); animation: pulse 2s infinite;
      }
      @keyframes pulse {
        0% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.5); }
        70% { box-shadow: 0 0 0 10px rgba(37, 99, 235, 0); }
        100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
      }
      .project-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        width: fit-content;
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: var(--panel);
        color: var(--muted);
        font-size: 11px;
      }
      h1 { margin: 0; font-size: 28px; font-weight: 700; }
      .subtitle-block { margin: 6px 0 0 24px; color: var(--muted); font-size: 13px; }
      .diagram-shell {
        margin-top: 24px; border: 1px solid var(--line); border-radius: 20px;
        padding: 20px; background: var(--panel);
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.05);
      }
      svg { width: 100%; height: auto; display: block; }
      .node-title { font-size: 13px; font-weight: 700; }
      .node-subtitle, .detail, .flow-label, .legend-label, .footer { font-size: 10px; fill: #334155; }
      .detail { fill: #667085; }
      .lane-chip { font-size: 9px; fill: #94a3b8; }
      .legend-label { fill: #667085; }
      .flow-label { fill: #334155; paint-order: stroke; stroke: #ffffff; stroke-width: 4px; stroke-linejoin: round; }
      .summary-grid, .side-grid { display: grid; gap: 16px; margin-top: 24px; }
      .summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .side-grid { grid-template-columns: 1fr 1fr; }
      .card {
        border: 1px solid var(--line); border-radius: 16px;
        background: var(--panel); padding: 14px 16px;
        box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
      }
      .card-header { display: flex; align-items: center; gap: 10px; font-size: 12px; margin-bottom: 8px; font-weight: 600; }
      .dot { width: 10px; height: 10px; border-radius: 999px; }
      ul { padding-left: 18px; margin: 0; color: #475467; font-size: 12px; line-height: 1.65; }
      .footer { margin-top: 18px; color: var(--muted); font-size: 12px; }
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

function textUnits(text) {
  let units = 0;
  for (const ch of `${text ?? ''}`) {
    units += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1;
  }
  return units;
}

function wrapTextLines(text, maxUnits, maxLines = 3) {
  const value = `${text ?? ''}`.trim().replace(/\s+/g, ' ');
  if (!value) return [];
  const lines = [];
  let current = '';
  let currentUnits = 0;
  for (const ch of value) {
    const chUnits = textUnits(ch);
    if (currentUnits + chUnits > maxUnits && current) {
      lines.push(current);
      current = ch === ' ' ? '' : ch;
      currentUnits = ch === ' ' ? 0 : chUnits;
      if (lines.length === maxLines) break;
    } else {
      current += ch;
      currentUnits += chUnits;
    }
  }
  if (lines.length < maxLines && current) {
    lines.push(current);
  } else if (lines.length === maxLines && current) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = `${last.slice(0, Math.max(0, last.length - 1))}…`;
  }
  return lines;
}

const FLOW_LAYOUT_DEFAULTS = {
  boxWidth: 232,
  gapX: 96,
  gapY: 30,
  marginX: 72,
  marginY: 96,
  titleHeight: 30,
  lineHeight: 15,
  subtitleMaxLines: 3,
  detailMaxItems: 4,
  bottomPadding: 14,
};

function assignLayers(nodes, edges) {
  const ids = new Set(nodes.map((node) => node.id));
  const validEdges = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to);
  const layers = new Map(nodes.map((node) => [node.id, 0]));
  const maxIterations = Math.max(4, nodes.length * nodes.length);
  let changed = true;
  let iterations = 0;
  while (changed && iterations < maxIterations) {
    changed = false;
    iterations += 1;
    for (const edge of validEdges) {
      const required = layers.get(edge.from) + 1;
      if (layers.get(edge.to) < required && required <= nodes.length) {
        layers.set(edge.to, required);
        changed = true;
      }
    }
  }
  return { layers, validEdges };
}

function layoutFlowDiagram(nodes, edges, options = {}) {
  const config = { ...FLOW_LAYOUT_DEFAULTS, ...options };
  const { layers, validEdges } = assignLayers(nodes, edges);

  const positioned = new Map();
  for (const node of nodes) {
    const subtitle = `${node.subtitle ?? ''}`.trim() === '待补充' ? '' : node.subtitle;
    const subtitleLines = wrapTextLines(subtitle, 34, config.subtitleMaxLines);
    const detailLines = (node.details ?? []).slice(0, config.detailMaxItems)
      .filter((line) => `${line ?? ''}`.trim() !== '待补充')
      .map((line) => wrapTextLines(line, 34, 1)[0])
      .filter(Boolean);
    const height = config.titleHeight
      + (subtitleLines.length * config.lineHeight)
      + (detailLines.length > 0 ? 6 + detailLines.length * config.lineHeight : 0)
      + config.bottomPadding;
    positioned.set(node.id, {
      node,
      subtitleLines,
      detailLines,
      width: config.boxWidth,
      height: Math.max(height, 64),
      layer: layers.get(node.id) ?? 0,
      x: 0,
      y: 0,
    });
  }

  const columns = new Map();
  for (const entry of positioned.values()) {
    if (!columns.has(entry.layer)) columns.set(entry.layer, []);
    columns.get(entry.layer).push(entry);
  }

  const incoming = new Map();
  for (const edge of validEdges) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to).push(edge.from);
  }

  const layerKeys = [...columns.keys()].sort((a, b) => a - b);
  let maxColumnHeight = 0;
  for (const key of layerKeys) {
    const column = columns.get(key);
    column.sort((a, b) => {
      const aPreds = incoming.get(a.node.id) ?? [];
      const bPreds = incoming.get(b.node.id) ?? [];
      const avg = (preds) => {
        const ys = preds.map((id) => positioned.get(id)?.y ?? 0);
        return ys.length > 0 ? ys.reduce((sum, y) => sum + y, 0) / ys.length : Number.MAX_SAFE_INTEGER;
      };
      const diff = avg(aPreds) - avg(bPreds);
      if (diff !== 0) return diff;
      return (a.node.type === 'error_path' ? 1 : 0) - (b.node.type === 'error_path' ? 1 : 0);
    });
    const columnHeight = column.reduce((sum, entry) => sum + entry.height, 0) + Math.max(0, column.length - 1) * config.gapY;
    maxColumnHeight = Math.max(maxColumnHeight, columnHeight);
  }

  for (const [index, key] of layerKeys.entries()) {
    const column = columns.get(key);
    const columnHeight = column.reduce((sum, entry) => sum + entry.height, 0) + Math.max(0, column.length - 1) * config.gapY;
    let cursorY = config.marginY + (maxColumnHeight - columnHeight) / 2;
    for (const entry of column) {
      entry.x = config.marginX + index * (config.boxWidth + config.gapX);
      entry.y = cursorY;
      cursorY += entry.height + config.gapY;
    }
  }

  const width = config.marginX * 2 + layerKeys.length * config.boxWidth + Math.max(0, layerKeys.length - 1) * config.gapX;
  const height = config.marginY + maxColumnHeight + 96;
  return { positioned, validEdges, width: Math.max(width, 760), height: Math.max(height, 360), config };
}

function routeFlowEdge(source, target, index, laneOffset) {
  if (target.layer > source.layer) {
    const startX = source.x + source.width;
    const startY = source.y + source.height / 2;
    const endX = target.x;
    const endY = target.y + target.height / 2;
    const midX = (startX + endX) / 2;
    return {
      path: `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`,
      labelX: midX,
      labelY: (startY + endY) / 2 - 8 - laneOffset,
    };
  }
  if (target.layer === source.layer) {
    const downward = target.y > source.y;
    const startX = source.x + source.width / 2;
    const startY = downward ? source.y + source.height : source.y;
    const endX = target.x + target.width / 2;
    const endY = downward ? target.y : target.y + target.height;
    const midY = (startY + endY) / 2;
    return {
      path: `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`,
      labelX: (startX + endX) / 2 + 10,
      labelY: midY - laneOffset,
    };
  }
  const startX = source.x;
  const startY = source.y + source.height / 2;
  const endX = target.x + target.width;
  const endY = target.y + target.height / 2;
  const drop = Math.max(startY, endY) + 56 + index * 14;
  return {
    path: `M ${startX} ${startY} C ${startX - 60} ${drop}, ${endX + 60} ${drop}, ${endX} ${endY}`,
    labelX: (startX + endX) / 2,
    labelY: drop - 8,
  };
}

function renderBox(node, layout) {
  const nodeTheme = theme(node.type);
  const subtitleLines = layout.subtitleLines ?? wrapTextLines(node.subtitle, 34, 3);
  const detailLines = layout.detailLines
    ?? (node.details ?? []).slice(0, 4).map((line) => wrapTextLines(line, 34, 1)[0]).filter(Boolean);
  const lineHeight = 15;
  let cursorY = layout.y + 24;
  const titleMarkup = `<text x="${layout.x + 16}" y="${cursorY}" class="node-title" fill="${nodeTheme.title}">${escapeHtml(trimText(node.name, 30))}</text>`;
  const laneMarkup = node.lane
    ? `<text x="${layout.x + layout.width - 14}" y="${layout.y + 22}" class="lane-chip" text-anchor="end">${escapeHtml(trimText(node.lane, 12))}</text>`
    : '';
  cursorY += 18;
  const subtitleMarkup = subtitleLines.map((line) => {
    const markup = `<text x="${layout.x + 16}" y="${cursorY}" class="node-subtitle">${escapeHtml(line)}</text>`;
    cursorY += lineHeight;
    return markup;
  }).join('');
  if (detailLines.length > 0) cursorY += 6;
  const detailMarkup = detailLines.map((line) => {
    const markup = `<text x="${layout.x + 16}" y="${cursorY}" class="detail">${escapeHtml(line)}</text>`;
    cursorY += lineHeight;
    return markup;
  }).join('');

  return `
    <g>
      <rect x="${layout.x}" y="${layout.y}" width="${layout.width}" height="${layout.height}" rx="14" fill="${nodeTheme.fill}" fill-opacity="0.92" stroke="${nodeTheme.stroke}" stroke-width="1.5"></rect>
      ${titleMarkup}
      ${laneMarkup}
      ${subtitleMarkup}
      ${detailMarkup}
    </g>
  `;
}

function renderArrow(def) {
  const isError = def.type === 'security' || def.type === 'error_path';
  const dashed = isError ? 'stroke-dasharray="6,4"' : '';
  const stroke = isError ? '#dc2626' : '#64748b';
  const marker = isError ? 'arrowhead-error' : 'arrowhead';
  const label = trimText(def.label, 24);
  const labelMarkup = label && label !== '待补充'
    ? `<text x="${def.labelX}" y="${def.labelY}" class="flow-label" text-anchor="middle">${escapeHtml(label)}</text>`
    : '';
  return `<path d="${def.path}" fill="none" stroke="${stroke}" stroke-width="1.8" ${dashed} marker-end="url(#${marker})"></path>
  ${labelMarkup}`;
}

const DIAGRAM_ARROW_DEFS = `
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
          <polygon points="0 0, 10 5, 0 10" fill="#64748b"></polygon>
        </marker>
        <marker id="arrowhead-error" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
          <polygon points="0 0, 10 5, 0 10" fill="#dc2626"></polygon>
        </marker>
      </defs>`;

function renderFlowEdges(layout) {
  const labelSlots = new Map();
  return layout.validEdges.map((edge, index) => {
    const source = layout.positioned.get(edge.from);
    const target = layout.positioned.get(edge.to);
    if (!source || !target) return '';
    const slotKey = `${source.layer}->${target.layer === source.layer ? `${edge.to}` : target.layer}`;
    const slot = labelSlots.get(slotKey) ?? 0;
    labelSlots.set(slotKey, slot + 1);
    const routed = routeFlowEdge(source, target, index, slot * 16);
    return renderArrow({ ...routed, label: edge.label, type: edge.type });
  }).join('\n');
}

function renderLegend(entries, originY) {
  let cursorX = 54;
  const items = entries.map(({ color, label }) => {
    const markup = `<rect x="${cursorX}" y="${originY + 14}" width="12" height="12" rx="3" fill="${color}"></rect><text x="${cursorX + 20}" y="${originY + 24}" class="legend-label">${escapeHtml(label)}</text>`;
    cursorX += 20 + textUnits(label) * 7 + 36;
    return markup;
  }).join('');
  return `
      <g>
        <text x="54" y="${originY}" class="legend-label">图例</text>
        ${items}
      </g>
  `;
}

function resolveProductLayerTitle(productType) {
  if (productType === 'consumer') return '个人消费者场景层';
  if (productType === 'b2b') return '企业服务场景层';
  if (productType === 'agent') return 'Agent 使用场景层';
  return '产品体验层';
}

function buildArchitectureComponents(snapshot) {
  const { sections } = snapshot;
  const reviewTarget = sections.handoff.targetSystem ?? 'OpenSpec';
  return [
    {
      id: 'users',
      name: '主要用户',
      type: 'external',
      subtitle: joinList(sections.users.primaryUsers, '用户'),
      details: takeList(sections.users.stakeholders, 3, ['相关方需要确认']),
    },
    {
      id: 'experience',
      name: resolveProductLayerTitle(snapshot.productType),
      type: 'frontend',
      subtitle: trimText(joinList(sections.scenarios.primaryFlows, sections.meta.title)),
      details: takeList(sections.scope.inScope, 3, ['范围仍需细化']),
    },
    {
      id: 'core',
      name: '核心产品逻辑',
      type: 'backend',
      subtitle: trimText(sections.problem.problemStatement ?? '核心逻辑待澄清'),
      details: takeList(sections.requirements.functional, 3, ['功能需求待补充']),
    },
    {
      id: 'integrations',
      name: '依赖与集成',
      type: 'cloud',
      subtitle: trimText(joinList(sections.constraints.dependencies, '暂无外部依赖记录')),
      details: takeList(sections.constraints.dependencies, 4, ['依赖尚未确认']),
    },
    {
      id: 'governance',
      name: '约束与可靠性',
      type: 'security',
      subtitle: trimText(joinList(sections.constraints.compliance, joinList(sections.requirements.nonFunctional, '暂无明确约束'))),
      details: [
        ...takeList(sections.constraints.compliance, 2),
        ...takeList(sections.requirements.nonFunctional, 2),
      ].slice(0, 4),
    },
    {
      id: 'delivery',
      name: '验证与交接',
      type: 'database',
      subtitle: trimText(joinList(sections.goals.successMetrics, '成功指标待确认')),
      details: [
        `目标: ${reviewTarget}`,
        `下一步: ${trimText(sections.handoff.nextStep ?? '确认下一步', 48)}`,
        ...takeList(sections.goals.acceptanceGoals, 2),
      ].slice(0, 4),
    },
  ];
}

export function buildArchitectureDiagramModel(snapshot) {
  const scopeIn = takeList(snapshot.sections.scope.inScope, 3, ['范围待澄清']);
  const scopeOut = takeList(snapshot.sections.scope.outOfScope, 2, ['范围外内容尚未明确']);
  const assumptions = takeList(snapshot.sections.risks.assumptions, 4, ['假设仍需评审']);
  const openQuestions = takeList(snapshot.sections.risks.openQuestions, 4, ['暂无开放问题记录']);
  const primaryFlows = takeList(snapshot.sections.scenarios.primaryFlows, 3, ['主流程仍需确认']);

  return {
    type: 'architecture',
    version: 1,
    generatedAt: timestamp(),
    locale: 'zh-CN',
    title: '架构评审',
    subtitle: '在需求定稿前评审系统边界、依赖和交接形态。',
    components: buildArchitectureComponents(snapshot),
    flows: [
      { source: 'users', target: 'experience', label: trimText(primaryFlows[0] ?? '用户进入产品流程', 40), type: 'standard' },
      { source: 'experience', target: 'core', label: '产品动作与编排', type: 'standard' },
      { source: 'core', target: 'integrations', label: '依赖与外部服务', type: 'standard' },
      { source: 'core', target: 'governance', label: '策略、可靠性与合规', type: 'security' },
      { source: 'core', target: 'delivery', label: '成功标准与交接', type: 'standard' },
      { source: 'integrations', target: 'delivery', label: '运营就绪', type: 'standard' },
      { source: 'governance', target: 'delivery', label: '评审与确认', type: 'security' },
    ],
    summaryCards: [
      {
        title: '范围',
        color: 'frontend',
        items: [
          `范围内: ${scopeIn.join(' / ')}`,
          `范围外: ${scopeOut.join(' / ')}`,
          `主流程: ${primaryFlows.join(' / ')}`,
        ],
      },
      {
        title: '架构检查',
        color: 'backend',
        items: [
          `核心逻辑: ${takeList(snapshot.sections.requirements.functional, 2, ['功能需求待补充']).join(' / ')}`,
          `依赖: ${takeList(snapshot.sections.constraints.dependencies, 2, ['依赖待补充']).join(' / ')}`,
          `约束: ${takeList(snapshot.sections.constraints.compliance, 2, takeList(snapshot.sections.requirements.nonFunctional, 2, ['约束待补充'])).join(' / ')}`,
        ],
      },
      {
        title: '评审重点',
        color: 'cloud',
        items: [
          `确认缺失假设: ${assumptions.join(' / ')}`,
          `开放问题: ${openQuestions.join(' / ')}`,
          '在需求定稿前请用户确认模块、边界和缺失系统。',
        ],
      },
    ],
    sidePanels: [
      { title: '假设', color: 'database', items: assumptions },
      {
        title: '评审说明',
        color: 'cloud',
        items: [
          '确认这些模块是否反映澄清后的目标架构。',
          '标记缺失系统、边界或外部依赖。',
          '在需求定稿前验证可靠性、合规和交接预期。',
        ],
      },
    ],
    metadata: {
      projectName: snapshot.title,
      productType: snapshot.productType ?? '未分类',
      owner: snapshot.owner,
      versionId: snapshot.versionId,
      targetSystem: snapshot.sections.handoff.targetSystem ?? 'OpenSpec',
      reviewStatus: normalizeReviewStatus(snapshot?.reviewStatus),
    },
  };
}

export function renderArchitectureDiagramHtml(model) {
  const components = Array.isArray(model.components) ? model.components : [];
  const flows = Array.isArray(model.flows) ? model.flows : [];
  const layout = layoutFlowDiagram(components, flows.map((flow) => ({
    from: flow.source,
    to: flow.target,
    label: flow.label,
    type: flow.type,
  })), { boxWidth: 256 });

  const componentMarkup = components
    .map((component) => {
      const entry = layout.positioned.get(component.id);
      return entry ? renderBox(component, entry) : '';
    })
    .join('\n');
  const edgeMarkup = renderFlowEdges(layout);

  const internalEntries = components
    .filter((component) => component.type !== 'external')
    .map((component) => layout.positioned.get(component.id))
    .filter(Boolean);
  let boundaryMarkup = '';
  let boundaryBottom = layout.height - 96;
  if (internalEntries.length > 0) {
    const minX = Math.min(...internalEntries.map((entry) => entry.x)) - 26;
    const minY = Math.min(...internalEntries.map((entry) => entry.y)) - 34;
    const maxX = Math.max(...internalEntries.map((entry) => entry.x + entry.width)) + 26;
    const maxY = Math.max(...internalEntries.map((entry) => entry.y + entry.height)) + 26;
    boundaryBottom = Math.max(boundaryBottom, maxY);
    boundaryMarkup = `
      <rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" rx="18" fill="none" stroke="#b45309" stroke-opacity="0.55" stroke-width="1.5" stroke-dasharray="8,5"></rect>
      <text x="${minX + 18}" y="${minY + 22}" class="legend-label">方案边界</text>
    `;
  }

  const legendY = boundaryBottom + 34;
  const legendMarkup = renderLegend([
    { color: '#2563eb', label: '体验' },
    { color: '#0f766e', label: '核心逻辑' },
    { color: '#4f46e5', label: '验证' },
    { color: '#b45309', label: '依赖' },
    { color: '#dc2626', label: '约束' },
    { color: '#94a3b8', label: '外部/用户' },
  ], legendY);

  const svgHeight = legendY + 48;
  const svgMarkup = `
    <svg viewBox="0 0 ${layout.width} ${svgHeight}" role="img" aria-label="${escapeHtml(model.title)}">
      ${DIAGRAM_ARROW_DEFS}
      ${boundaryMarkup}
      ${edgeMarkup}
      ${componentMarkup}
      ${legendMarkup}
    </svg>
  `;

  return renderShell({
    lang: model.locale ?? 'zh-CN',
    title: model.title,
    subtitle: model.subtitle,
    projectName: model.metadata?.projectName ?? model.title,
    svgMarkup,
    summaryCards: model.summaryCards,
    sidePanels: model.sidePanels,
    footer: `负责人: ${model.metadata.owner} · 交接去向: ${model.metadata.targetSystem} · 最近生成: ${model.generatedAt}`,
  });
}

export function buildProductFlowDiagramModel(snapshot) {
  const primaryUsers = takeList(snapshot.sections.users.primaryUsers, 2, ['主要用户']);
  const primaryFlows = takeList(snapshot.sections.scenarios.primaryFlows, 4, ['主流程仍需确认']);
  const edgeCases = takeList(snapshot.sections.scenarios.edgeCases, 3, ['边界情况仍需澄清']);
  const failureModes = takeList(snapshot.sections.scenarios.failureModes, 3, ['失败路径仍需澄清']);
  const goals = takeList(snapshot.sections.goals.goals, 2, ['目标仍需确认']);
  const successMetrics = takeList(snapshot.sections.goals.successMetrics, 2, ['成功指标仍需确认']);
  const openQuestions = takeList(snapshot.sections.risks.openQuestions, 4, ['暂无开放问题记录']);
  const steps = [
    {
      id: 'entry',
      name: '入口触发',
      type: 'user_action',
      lane: primaryUsers[0],
      subtitle: trimText(primaryFlows[0] ?? '用户进入流程'),
      details: takeList(snapshot.sections.scope.inScope, 2, ['范围仍需细化']),
    },
    {
      id: 'experience',
      name: '产品内步骤',
      type: 'system_process',
      lane: '产品',
      subtitle: trimText(primaryFlows[1] ?? snapshot.sections.problem.problemStatement ?? '核心产品步骤'),
      details: takeList(snapshot.sections.requirements.functional, 2, ['功能需求待补充']),
    },
    {
      id: 'decision',
      name: '决策点',
      type: 'decision',
      lane: '决策',
      subtitle: trimText(edgeCases[0] ?? '决策标准待澄清'),
      details: [
        `目标: ${trimText(goals[0], 40)}`,
        `指标: ${trimText(successMetrics[0], 40)}`,
      ],
    },
    {
      id: 'success',
      name: '成功结果',
      type: 'success',
      lane: '结果',
      subtitle: trimText(successMetrics[0] ?? '成功结果仍需确认'),
      details: takeList(snapshot.sections.goals.acceptanceGoals, 2, ['验收目标待补充']),
    },
    {
      id: 'failure',
      name: '失败与恢复',
      type: 'error_path',
      lane: '结果',
      subtitle: trimText(failureModes[0] ?? '失败路径待澄清'),
      details: [
        ...failureModes.slice(0, 2),
        ...openQuestions.slice(0, 2),
      ].slice(0, 4),
    },
  ];

  return {
    type: 'product-flow',
    version: 1,
    generatedAt: timestamp(),
    locale: 'zh-CN',
    title: '产品流程评审',
    subtitle: '在需求定稿前评审主要旅程、决策点和恢复路径。',
    actors: primaryUsers,
    steps,
    transitions: [
      { from: 'entry', to: 'experience', label: primaryFlows[0] ?? '开始旅程', type: 'standard' },
      { from: 'experience', to: 'decision', label: primaryFlows[1] ?? '系统处理请求', type: 'standard' },
      { from: 'decision', to: 'success', label: goals[0] ?? '成功路径', type: 'standard' },
      { from: 'decision', to: 'failure', label: failureModes[0] ?? '失败路径', type: 'error_path' },
    ],
    summaryCards: [
      {
        title: '参与者与范围',
        color: 'user_action',
        items: [
          `参与者: ${primaryUsers.join(' / ')}`,
          `范围内: ${takeList(snapshot.sections.scope.inScope, 2, ['范围待补充']).join(' / ')}`,
          `范围外: ${takeList(snapshot.sections.scope.outOfScope, 2, ['范围外内容待补充']).join(' / ')}`,
        ],
      },
      {
        title: '流程检查',
        color: 'system_process',
        items: [
          `主流程: ${primaryFlows.join(' / ')}`,
          `边界情况: ${edgeCases.join(' / ')}`,
          `失败模式: ${failureModes.join(' / ')}`,
        ],
      },
      {
        title: '评审重点',
        color: 'decision',
        items: [
          `目标: ${goals.join(' / ')}`,
          `成功指标: ${successMetrics.join(' / ')}`,
          '在需求定稿前确认步骤、决策点和缺失的恢复路径。',
        ],
      },
    ],
    sidePanels: [
      { title: '开放问题', color: 'error_path', items: openQuestions },
      {
        title: '评审说明',
        color: 'decision',
        items: [
          '确认用户旅程和系统响应顺序是否正确。',
          '标记缺失的决策点、失败路径和恢复步骤。',
          '确认该流程是否足以支持进入实现前确认。',
        ],
      },
    ],
    metadata: {
      projectName: snapshot.title,
      productType: snapshot.productType ?? '未分类',
      owner: snapshot.owner,
      versionId: snapshot.versionId,
      targetSystem: snapshot.sections.handoff.targetSystem ?? 'OpenSpec',
      reviewStatus: normalizeReviewStatus(snapshot?.reviewStatus),
    },
  };
}

export function renderProductFlowDiagramHtml(model) {
  const steps = Array.isArray(model.steps) ? model.steps : [];
  const transitions = Array.isArray(model.transitions) ? model.transitions : [];
  const layout = layoutFlowDiagram(steps, transitions.map((transition) => ({
    from: transition.from,
    to: transition.to,
    label: transition.label,
    type: transition.type,
  })));

  const stepMarkup = steps
    .map((step) => {
      const entry = layout.positioned.get(step.id);
      return entry ? renderBox(step, entry) : '';
    })
    .join('\n');
  const edgeMarkup = renderFlowEdges(layout);

  const boundary = {
    x: layout.config.marginX - 24,
    y: layout.config.marginY - 36,
    width: layout.width - (layout.config.marginX - 24) * 2,
    height: layout.height - layout.config.marginY - 36,
  };
  const legendY = boundary.y + boundary.height + 30;
  const legendMarkup = renderLegend([
    { color: '#2563eb', label: '用户动作' },
    { color: '#0f766e', label: '系统处理' },
    { color: '#b45309', label: '决策' },
    { color: '#4f46e5', label: '成功' },
    { color: '#dc2626', label: '错误/恢复' },
  ], legendY);

  const svgHeight = legendY + 48;
  const svgMarkup = `
    <svg viewBox="0 0 ${layout.width} ${svgHeight}" role="img" aria-label="${escapeHtml(model.title)}">
      ${DIAGRAM_ARROW_DEFS}
      <rect x="${boundary.x}" y="${boundary.y}" width="${boundary.width}" height="${boundary.height}" rx="18" fill="none" stroke="#b45309" stroke-opacity="0.45" stroke-width="1.5" stroke-dasharray="8,5"></rect>
      <text x="${boundary.x + 18}" y="${boundary.y + 24}" class="legend-label">产品流程边界</text>
      ${edgeMarkup}
      ${stepMarkup}
      ${legendMarkup}
    </svg>
  `;

  return renderShell({
    lang: model.locale ?? 'zh-CN',
    title: model.title,
    subtitle: model.subtitle,
    projectName: model.metadata?.projectName ?? model.title,
    svgMarkup,
    summaryCards: model.summaryCards,
    sidePanels: model.sidePanels,
    footer: `负责人: ${model.metadata.owner} · 交接去向: ${model.metadata.targetSystem} · 最近生成: ${model.generatedAt}`,
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
    '  subgraph solution["方案边界"]',
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
          name: pickValue(step?.name, `步骤 ${index + 1}`),
          type: pickValue(step?.type, 'system_process'),
          lane: pickValue(step?.lane, '流程'),
          subtitle: pickValue(step?.subtitle, step?.description ?? '待补充'),
          details: normalizeList(step?.details ?? step?.notes ?? step?.data_involved, ['待补充']),
        }))
        : base.steps,
      transitions: Array.isArray(contract.transitions) && contract.transitions.length > 0
        ? contract.transitions.map((transition) => ({
          from: pickValue(transition?.from, transition?.from_step_id),
          to: pickValue(transition?.to, transition?.to_step_id),
          label: pickValue(transition?.label, transition?.condition ?? '流转'),
          type: pickValue(transition?.type, 'standard'),
        }))
        : base.transitions,
      summaryCards: Array.isArray(contract.summaryCards) && contract.summaryCards.length > 0
        ? contract.summaryCards.map((card, index) => normalizeCard(card, `摘要 ${index + 1}`, 'system_process'))
        : base.summaryCards,
      sidePanels: Array.isArray(contract.sidePanels) && contract.sidePanels.length > 0
        ? contract.sidePanels.map((panel, index) => normalizePanel(panel, `面板 ${index + 1}`, 'decision'))
        : [
          normalizePanel({
            title: contract.openQuestionsTitle ?? '开放问题',
            color: 'error_path',
            items: contract.openQuestions,
          }),
          normalizePanel({
            title: contract.reviewInstructionsTitle ?? '评审说明',
            color: 'decision',
            items: contract.reviewInstructions,
          }),
        ],
      metadata: {
        ...base.metadata,
        ...(contract.metadata ?? {}),
        projectName: pickValue(contract?.metadata?.projectName, pickValue(contract.title, base.metadata.projectName)),
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
          name: pickValue(component?.name, `组件 ${index + 1}`),
          type: pickValue(component?.type, 'external'),
          subtitle: pickValue(component?.subtitle, component?.description ?? '待补充'),
          details: normalizeList(component?.details, ['待补充']),
        }))
        : base.components,
      flows: Array.isArray(contract.flows) && contract.flows.length > 0
        ? contract.flows.map((flow) => ({
          source: pickValue(flow?.source, 'source'),
          target: pickValue(flow?.target, 'target'),
          label: pickValue(flow?.label, '流程'),
          type: pickValue(flow?.type, 'standard'),
        }))
        : base.flows,
      summaryCards: Array.isArray(contract.summaryCards) && contract.summaryCards.length > 0
        ? contract.summaryCards.map((card, index) => normalizeCard(card, `摘要 ${index + 1}`, 'frontend'))
        : base.summaryCards,
      sidePanels: Array.isArray(contract.sidePanels) && contract.sidePanels.length > 0
        ? contract.sidePanels.map((panel, index) => normalizePanel(panel, `面板 ${index + 1}`, 'database'))
        : [
          normalizePanel({
            title: contract.assumptionsTitle ?? '假设',
            color: 'database',
            items: contract.assumptions,
          }),
          normalizePanel({
            title: contract.reviewInstructionsTitle ?? '评审说明',
            color: 'cloud',
            items: contract.reviewInstructions,
          }),
        ],
      metadata: {
        ...base.metadata,
        ...(contract.metadata ?? {}),
        projectName: pickValue(contract?.metadata?.projectName, pickValue(contract.title, base.metadata.projectName)),
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
