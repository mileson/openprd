import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { VISUAL_REVIEW_SCHEMA } from './quality-visual-review.js';
import { compactTimestamp, timestamp } from './time.js';

const DEFAULT_PANEL_WIDTH = 1180;
const DEFAULT_QUALITY = 85;
const DEFAULT_REFERENCE_LABEL = '效果图';
const DEFAULT_ACTUAL_LABEL = '实现截图';
const DEFAULT_BEFORE_LABEL = '修改前';
const DEFAULT_AFTER_LABEL = '修改后';
const DEFAULT_FOCUS_TITLE = '局部焦点证据板';
const DEFAULT_PARALLEL_TITLE = '并行实验证据板';
const DEFAULT_VERIFICATION_TITLE = '截图实测证据板';
const DEFAULT_PARALLEL_CARD_WIDTH = 380;
const DEFAULT_PARALLEL_COLUMNS = 3;
const OUTPUT_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const FOCUS_COLORS = ['#f97316', '#22c55e', '#38bdf8', '#eab308', '#fb7185', '#a78bfa'];
const MODE_PREFIX = {
  'reference-actual': 'visual-compare',
  'before-after': 'visual-before-after',
  'focus-board': 'visual-focus-board',
  'parallel-board': 'visual-parallel-board',
  'verification-board': 'visual-verification-board',
};
const BOARD_MODE_ALIASES = new Map([
  ['focus', 'focus-board'],
  ['focus-board', 'focus-board'],
  ['focus-region', 'focus-board'],
  ['focus-region-board', 'focus-board'],
  ['parallel', 'parallel-board'],
  ['parallel-board', 'parallel-board'],
  ['parallel-experiment-board', 'parallel-board'],
  ['experiment-board', 'parallel-board'],
  ['verification', 'verification-board'],
  ['verification-board', 'verification-board'],
  ['screenshot-board', 'verification-board'],
  ['screenshot-evidence-board', 'verification-board'],
  ['visual-verification-board', 'verification-board'],
]);

function normalizeFormat(format, outPath) {
  const requested = String(format || '').trim().toLowerCase();
  if (requested) {
    if (!OUTPUT_FORMATS.has(requested)) {
      throw new Error(`Unsupported visual compare format: ${format}. Use jpg, png, or webp.`);
    }
    return requested === 'jpeg' ? 'jpg' : requested;
  }

  const ext = path.extname(String(outPath || '')).slice(1).toLowerCase();
  if (OUTPUT_FORMATS.has(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  return 'jpg';
}

function outputExtension(format) {
  return format === 'jpeg' ? 'jpg' : format;
}

function normalizeWorkspacePath(value) {
  return String(value ?? '').split(path.sep).join('/');
}

function toWorkspacePath(projectRoot, filePath) {
  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(projectRoot, absolutePath);
  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return normalizeWorkspacePath(relativePath);
  }
  return absolutePath;
}

function resolveProjectPath(projectRoot, filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
}

function defaultOutputPath(projectRoot, format, mode) {
  const prefix = MODE_PREFIX[mode] ?? 'visual-compare';
  return path.join(
    projectRoot,
    '.openprd',
    'harness',
    'visual-reviews',
    `${prefix}-${compactTimestamp()}.${outputExtension(format)}`,
  );
}

function parsePositiveInteger(value, fallback, label) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseQuality(value) {
  const quality = parsePositiveInteger(value, DEFAULT_QUALITY, '--quality');
  if (quality < 1 || quality > 100) {
    throw new Error('--quality must be between 1 and 100.');
  }
  return quality;
}

function metadataPathForOutput(outputPath) {
  const ext = path.extname(outputPath);
  return ext ? outputPath.slice(0, -ext.length) + '.json' : `${outputPath}.json`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function charCount(value) {
  return Array.from(String(value ?? '')).length;
}

function wrapText(value, maxCharsPerLine) {
  const lines = [];
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return lines;
  }
  for (const rawLine of normalized.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    let buffer = '';
    for (const char of Array.from(line)) {
      if (charCount(buffer) >= maxCharsPerLine) {
        lines.push(buffer);
        buffer = '';
      }
      buffer += char;
    }
    if (buffer) {
      lines.push(buffer);
    }
  }
  return lines;
}

function lineSvg(lines, {
  x = 0,
  y = 0,
  lineHeight = 24,
  fontSize = 18,
  fill = '#e5e7eb',
  fontWeight = 500,
} = {}) {
  return lines.map((line, index) => (
    `<text x="${x}" y="${y + index * lineHeight}" fill="${fill}" font-size="${fontSize}" font-weight="${fontWeight}" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, Arial Unicode MS, sans-serif">${escapeXml(line)}</text>`
  )).join('');
}

function labelSvg(label, options = {}) {
  const text = escapeXml(label);
  const fontSize = options.fontSize ?? 22;
  const height = options.height ?? 46;
  const paddingX = options.paddingX ?? 21;
  const radius = options.radius ?? 14;
  const bg = options.background ?? '#111827';
  const bgOpacity = options.backgroundOpacity ?? 0.82;
  const stroke = options.stroke ?? '#ffffff';
  const strokeOpacity = options.strokeOpacity ?? 0.22;
  const width = Math.max(options.minWidth ?? 126, charCount(label) * (fontSize + 4) + paddingX * 2);
  return Buffer.from(`
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" fill="${bg}" fill-opacity="${bgOpacity}"/>
  <rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="${Math.max(radius - 0.75, 1)}" fill="none" stroke="${stroke}" stroke-opacity="${strokeOpacity}" stroke-width="1.5"/>
  <text x="${paddingX}" y="${Math.round(height * 0.64)}" fill="#ffffff" font-size="${fontSize}" font-weight="700" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, Arial Unicode MS, sans-serif">${text}</text>
</svg>`);
}

function titleBlockSvg(width, title, subtitle, eyebrow = null) {
  const contentWidth = Math.max(Number(width) || 0, 1);
  const titleLines = wrapText(title, Math.max(12, Math.floor((contentWidth - 48) / 18)));
  const subtitleLines = wrapText(subtitle, Math.max(16, Math.floor((contentWidth - 48) / 16)));
  const eyebrowLines = wrapText(eyebrow, Math.max(18, Math.floor((contentWidth - 48) / 18)));
  let y = eyebrowLines.length > 0 ? 28 : 0;
  const parts = [];
  if (eyebrowLines.length > 0) {
    parts.push(lineSvg(eyebrowLines, {
      x: 0,
      y: y,
      lineHeight: 20,
      fontSize: 16,
      fill: '#93c5fd',
      fontWeight: 700,
    }));
    y += eyebrowLines.length * 20 + 14;
  }
  parts.push(lineSvg(titleLines, {
    x: 0,
    y: y + 30,
    lineHeight: 34,
    fontSize: 30,
    fill: '#f8fafc',
    fontWeight: 800,
  }));
  y += titleLines.length * 34 + 10;
  if (subtitleLines.length > 0) {
    parts.push(lineSvg(subtitleLines, {
      x: 0,
      y: y + 24,
      lineHeight: 24,
      fontSize: 18,
      fill: '#cbd5e1',
      fontWeight: 500,
    }));
    y += subtitleLines.length * 24 + 6;
  }
  const height = Math.max(72, y + 16);
  return {
    height,
    input: Buffer.from(`
<svg width="${contentWidth}" height="${height}" viewBox="0 0 ${contentWidth} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${parts.join('')}
</svg>`),
  };
}

function sectionHeaderSvg(width, index, label, reason = '') {
  const contentWidth = Math.max(Number(width) || 0, 1);
  const titleLines = wrapText(`${index}. ${label}`, Math.max(10, Math.floor((contentWidth - 48) / 18)));
  const reasonLines = wrapText(reason, Math.max(14, Math.floor((contentWidth - 48) / 16)));
  const height = 32 + titleLines.length * 28 + (reasonLines.length > 0 ? 10 + reasonLines.length * 22 : 0);
  return {
    height,
    input: Buffer.from(`
<svg width="${contentWidth}" height="${height}" viewBox="0 0 ${contentWidth} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${contentWidth}" height="${height}" rx="18" fill="#0f172a" fill-opacity="0.92"/>
  <rect x="0.75" y="0.75" width="${contentWidth - 1.5}" height="${height - 1.5}" rx="17.25" fill="none" stroke="#475569" stroke-opacity="0.45" stroke-width="1.5"/>
  ${lineSvg(titleLines, {
    x: 20,
    y: 30,
    lineHeight: 28,
    fontSize: 24,
    fill: '#f8fafc',
    fontWeight: 800,
  })}
  ${reasonLines.length > 0 ? lineSvg(reasonLines, {
    x: 20,
    y: 30 + titleLines.length * 28 + 10,
    lineHeight: 22,
    fontSize: 16,
    fill: '#cbd5e1',
    fontWeight: 500,
  }) : ''}
</svg>`),
  };
}

function metricsSvg(width, metrics = [], notes = null) {
  const contentWidth = Math.max(Number(width) || 0, 1);
  const lines = [];
  for (const metric of metrics) {
    lines.push(`${metric.label}：${metric.value}`);
  }
  if (notes) {
    lines.push(...wrapText(notes, Math.max(12, Math.floor((contentWidth - 24) / 16))));
  }
  if (lines.length === 0) {
    return { height: 0, input: null };
  }
  const height = 18 + lines.length * 22;
  return {
    height,
    input: Buffer.from(`
<svg width="${contentWidth}" height="${height}" viewBox="0 0 ${contentWidth} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${lineSvg(lines, {
    x: 0,
    y: 20,
    lineHeight: 22,
    fontSize: 16,
    fill: '#cbd5e1',
    fontWeight: 500,
  })}
</svg>`),
  };
}

async function resizePanel(inputPath, panelWidth) {
  const source = path.resolve(inputPath);
  const metadata = await sharp(source).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Cannot read image dimensions: ${inputPath}`);
  }
  const { data, info } = await sharp(source)
    .rotate()
    .resize({
      width: panelWidth,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    input: data,
    width: info.width,
    height: info.height,
    source,
    original: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format ?? null,
    },
  };
}

async function extractCrop(inputPath, box, outputWidth) {
  const source = path.resolve(inputPath);
  const { data, info } = await sharp(source)
    .rotate()
    .extract({
      left: box.x,
      top: box.y,
      width: box.width,
      height: box.height,
    })
    .resize({
      width: outputWidth,
      fit: 'inside',
      withoutEnlargement: false,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    input: data,
    width: info.width,
    height: info.height,
    source,
    absolute: box,
  };
}

function encodePipeline(image, format, quality) {
  if (format === 'png') {
    return image.png();
  }
  if (format === 'webp') {
    return image.webp({ quality });
  }
  return image.jpeg({ quality });
}

function resolveComparisonInputs(options) {
  const hasReferenceActual = Boolean(options.reference || options.actual);
  const hasBeforeAfter = Boolean(options.before || options.after);
  const hasBoard = Boolean(options.board);
  const modeCount = [hasReferenceActual, hasBeforeAfter, hasBoard].filter(Boolean).length;
  if (modeCount > 1) {
    throw new Error('Use either --reference/--actual, --before/--after, or --board, not multiple modes together.');
  }
  if (hasBeforeAfter) {
    if (!options.before) {
      throw new Error('Missing --before image path.');
    }
    if (!options.after) {
      throw new Error('Missing --after image path.');
    }
    return {
      mode: 'before-after',
      left: options.before,
      right: options.after,
      leftLabel: options.referenceLabel || DEFAULT_BEFORE_LABEL,
      rightLabel: options.actualLabel || DEFAULT_AFTER_LABEL,
      nextActions: [
        '把输出图片作为视觉改动自检证据查看：左侧修改前，右侧修改后。',
        '检查预期变化是否出现，以及未改区域是否有布局、颜色、密度或状态漂移。',
        '没有效果图时，这张图只证明改动前后差异已自检；大界面方向性改造仍需先完成方案评审。',
      ],
    };
  }
  if (hasReferenceActual) {
    if (!options.reference) {
      throw new Error('Missing --reference image path.');
    }
    if (!options.actual) {
      throw new Error('Missing --actual image path.');
    }
    return {
      mode: 'reference-actual',
      left: options.reference,
      right: options.actual,
      leftLabel: options.referenceLabel || DEFAULT_REFERENCE_LABEL,
      rightLabel: options.actualLabel || DEFAULT_ACTUAL_LABEL,
      nextActions: [
        '把输出图片作为视觉评审证据查看：左侧效果图，右侧实现截图。',
        '如果仍有明显差异，继续按效果图复刻并重新运行 visual-compare。',
        '只有对比图确认一致后，才声明本阶段界面视觉实现完成。',
      ],
    };
  }
  if (hasBoard) {
    return {
      mode: 'board',
      board: options.board,
    };
  }
  throw new Error('Missing visual compare input. Use --reference/--actual, --before/--after, or --board.');
}

function normalizeBoardMode(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return BOARD_MODE_ALIASES.get(key) ?? null;
}

async function readBoardSpec(projectRoot, boardPath) {
  const sourcePath = resolveProjectPath(projectRoot, boardPath);
  const payload = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  const mode = normalizeBoardMode(payload.mode);
  if (!mode) {
    throw new Error(`Unsupported board mode in ${boardPath}. Use focus-board, parallel-board, or verification-board.`);
  }
  return {
    mode,
    sourcePath,
    payload,
  };
}

function normalizeImageSpec(projectRoot, value, fallbackLabel) {
  if (!value) {
    throw new Error('Board image spec is missing.');
  }
  if (typeof value === 'string') {
    return {
      path: resolveProjectPath(projectRoot, value),
      label: fallbackLabel,
    };
  }
  if (typeof value === 'object' && value.path) {
    return {
      path: resolveProjectPath(projectRoot, value.path),
      label: value.label ? String(value.label) : fallbackLabel,
    };
  }
  throw new Error('Board image spec must be a path string or an object with { path, label? }.');
}

function normalizeMetricList(metrics) {
  if (!metrics) {
    return [];
  }
  if (Array.isArray(metrics)) {
    return metrics
      .filter(Boolean)
      .map((item) => {
        if (typeof item === 'string') {
          return { label: '说明', value: item };
        }
        return {
          label: String(item.label ?? item.key ?? '指标'),
          value: String(item.value ?? ''),
        };
      })
      .filter((item) => item.value.trim());
  }
  if (typeof metrics === 'object') {
    return Object.entries(metrics)
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
      .map(([key, value]) => ({ label: key, value: String(value) }));
  }
  return [];
}

function normalizeMediaList(projectRoot, media) {
  if (!Array.isArray(media)) {
    return [];
  }
  return media
    .filter(Boolean)
    .map((entry, index) => {
      if (typeof entry === 'string') {
        return {
          path: resolveProjectPath(projectRoot, entry),
          label: `素材 ${index + 1}`,
        };
      }
      if (!entry.path) {
        throw new Error(`Parallel board media[${index}] is missing path.`);
      }
      return {
        path: resolveProjectPath(projectRoot, entry.path),
        label: String(entry.label ?? `素材 ${index + 1}`),
      };
    });
}

function normalizeVerificationItems(projectRoot, payload) {
  let rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (rawItems.length === 0 && Array.isArray(payload.screenshots)) {
    rawItems = payload.screenshots;
  }
  if (rawItems.length === 0) {
    const singlePath = payload.screenshot ?? payload.actual ?? payload.path;
    if (singlePath) {
      rawItems = [{
        path: singlePath,
        label: payload.label ?? '实测截图',
        notes: payload.notes ?? payload.note ?? payload.summary,
        checks: payload.checks ?? payload.checkpoints,
      }];
    }
  }
  return rawItems.map((item, index) => {
    if (typeof item === 'string') {
      return {
        label: `实测截图 ${index + 1}`,
        subtitle: '',
        verdict: '',
        media: [{ path: item, label: '实测截图' }],
        metrics: [],
        notes: '',
      };
    }
    const media = Array.isArray(item.media) && item.media.length > 0
      ? item.media
      : (item.path ? [{ path: item.path, label: item.mediaLabel ?? item.label ?? `截图 ${index + 1}` }] : []);
    return {
      label: String(item.label ?? item.title ?? `实测截图 ${index + 1}`),
      subtitle: String(item.subtitle ?? item.route ?? item.step ?? '').trim(),
      verdict: String(item.verdict ?? item.status ?? '').trim(),
      media,
      metrics: item.metrics ?? item.checks ?? item.checkpoints,
      notes: String(item.notes ?? item.note ?? item.expected ?? '').trim(),
    };
  });
}

function parseCropDimension(box, key, alias) {
  const primary = box[key];
  const secondary = alias ? box[alias] : undefined;
  const value = primary ?? secondary;
  if (value === null || value === undefined || value === '') {
    throw new Error(`Missing ${key} in focus region box.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${key} in focus region box.`);
  }
  return parsed;
}

function clampBox(box, original) {
  const x = Math.max(0, Math.min(box.x, original.width - 1));
  const y = Math.max(0, Math.min(box.y, original.height - 1));
  const width = Math.max(1, Math.min(box.width, original.width - x));
  const height = Math.max(1, Math.min(box.height, original.height - y));
  return {
    x,
    y,
    width,
    height,
  };
}

function resolveCropBox(box, original) {
  if (!box || typeof box !== 'object') {
    throw new Error('Focus region box must be an object.');
  }
  const rawUnit = String(box.unit ?? 'ratio').trim().toLowerCase();
  const x = parseCropDimension(box, 'x', 'left');
  const y = parseCropDimension(box, 'y', 'top');
  const width = parseCropDimension(box, 'width', 'w');
  const height = parseCropDimension(box, 'height', 'h');
  let absolute;

  if (rawUnit === 'ratio') {
    absolute = {
      x: Math.round(x * original.width),
      y: Math.round(y * original.height),
      width: Math.round(width * original.width),
      height: Math.round(height * original.height),
    };
  } else if (rawUnit === 'percent') {
    absolute = {
      x: Math.round((x / 100) * original.width),
      y: Math.round((y / 100) * original.height),
      width: Math.round((width / 100) * original.width),
      height: Math.round((height / 100) * original.height),
    };
  } else if (rawUnit === 'px' || rawUnit === 'pixel' || rawUnit === 'pixels') {
    absolute = {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    };
  } else {
    throw new Error(`Unsupported focus region unit: ${rawUnit}. Use ratio, percent, or px.`);
  }

  return {
    unit: rawUnit === 'pixel' || rawUnit === 'pixels' ? 'px' : rawUnit,
    requested: { x, y, width, height },
    absolute: clampBox(absolute, original),
  };
}

function renderedBoxFromAbsolute(box, panel) {
  const scaleX = panel.width / panel.original.width;
  const scaleY = panel.height / panel.original.height;
  return {
    x: Math.round(box.x * scaleX),
    y: Math.round(box.y * scaleY),
    width: Math.max(2, Math.round(box.width * scaleX)),
    height: Math.max(2, Math.round(box.height * scaleY)),
  };
}

function focusOverlaySvg(width, height, regions) {
  const overlays = regions.map((region, index) => {
    const color = region.color;
    const box = region.box;
    const badgeSize = 32;
    const badgeX = Math.max(10, box.x + 10);
    const badgeY = Math.max(10, box.y + 10);
    return `
      <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="16" fill="none" stroke="${color}" stroke-width="4"/>
      <rect x="${badgeX}" y="${badgeY}" width="${badgeSize}" height="${badgeSize}" rx="16" fill="${color}"/>
      <text x="${badgeX + 10}" y="${badgeY + 22}" fill="#0f172a" font-size="18" font-weight="800" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, Arial Unicode MS, sans-serif">${index + 1}</text>
    `;
  }).join('');
  return Buffer.from(`
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${overlays}
</svg>`);
}

async function renderStandardComparison(projectRoot, comparison, options = {}) {
  const format = normalizeFormat(options.format, options.out);
  const outputPath = options.out
    ? path.resolve(projectRoot, options.out)
    : defaultOutputPath(projectRoot, format, comparison.mode);
  const quality = parseQuality(options.quality);
  const maxPanelWidth = parsePositiveInteger(options.maxPanelWidth, DEFAULT_PANEL_WIDTH, '--max-panel-width');
  const referencePanel = await resizePanel(comparison.left, maxPanelWidth);
  const actualPanel = await resizePanel(comparison.right, maxPanelWidth);
  const panelWidth = Math.min(maxPanelWidth, Math.max(referencePanel.width, actualPanel.width));
  const maxPanelHeight = Math.max(referencePanel.height, actualPanel.height);
  const margin = 24;
  const gap = 24;
  const canvasWidth = margin * 2 + panelWidth * 2 + gap;
  const canvasHeight = margin * 2 + maxPanelHeight;
  const leftPanelX = margin;
  const rightPanelX = margin + panelWidth + gap;
  const top = margin;

  const referenceLeft = leftPanelX + Math.round((panelWidth - referencePanel.width) / 2);
  const actualLeft = rightPanelX + Math.round((panelWidth - actualPanel.width) / 2);
  const referenceTop = top + Math.round((maxPanelHeight - referencePanel.height) / 2);
  const actualTop = top + Math.round((maxPanelHeight - actualPanel.height) / 2);

  const canvas = sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: '#111827',
    },
  }).composite([
    { input: referencePanel.input, left: referenceLeft, top: referenceTop },
    { input: actualPanel.input, left: actualLeft, top: actualTop },
    { input: labelSvg(comparison.leftLabel), left: referenceLeft + 16, top: referenceTop + 16 },
    { input: labelSvg(comparison.rightLabel), left: actualLeft + 16, top: actualTop + 16 },
  ]);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await encodePipeline(canvas, format, quality).toFile(outputPath);
  const metadataPath = metadataPathForOutput(outputPath);
  const reviewArtifact = {
    version: 1,
    schema: VISUAL_REVIEW_SCHEMA,
    generatedAt: timestamp(),
    mode: comparison.mode,
    outputPath: toWorkspacePath(projectRoot, outputPath),
    format,
    labels: {
      reference: comparison.leftLabel,
      actual: comparison.rightLabel,
    },
    reference: {
      path: toWorkspacePath(projectRoot, referencePanel.source),
      original: referencePanel.original,
      rendered: {
        width: referencePanel.width,
        height: referencePanel.height,
      },
    },
    actual: {
      path: toWorkspacePath(projectRoot, actualPanel.source),
      original: actualPanel.original,
      rendered: {
        width: actualPanel.width,
        height: actualPanel.height,
      },
    },
    canvas: {
      width: canvasWidth,
      height: canvasHeight,
    },
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(reviewArtifact, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    action: 'visual-compare',
    mode: comparison.mode,
    projectRoot,
    outputPath,
    metadataPath,
    format,
    quality: format === 'png' ? null : quality,
    maxPanelWidth,
    labels: {
      reference: comparison.leftLabel,
      actual: comparison.rightLabel,
    },
    reference: {
      path: referencePanel.source,
      original: referencePanel.original,
      rendered: {
        width: referencePanel.width,
        height: referencePanel.height,
      },
    },
    actual: {
      path: actualPanel.source,
      original: actualPanel.original,
      rendered: {
        width: actualPanel.width,
        height: actualPanel.height,
      },
    },
    canvas: {
      width: canvasWidth,
      height: canvasHeight,
    },
    reviewArtifact,
    nextActions: comparison.nextActions,
  };
}

async function renderFocusBoard(projectRoot, board, options = {}) {
  const format = normalizeFormat(options.format, options.out);
  const outputPath = options.out
    ? path.resolve(projectRoot, options.out)
    : defaultOutputPath(projectRoot, format, 'focus-board');
  const quality = parseQuality(options.quality);
  const maxPanelWidth = parsePositiveInteger(options.maxPanelWidth, DEFAULT_PANEL_WIDTH, '--max-panel-width');
  const leftSpec = normalizeImageSpec(projectRoot, board.payload.left ?? board.payload.reference, board.payload.leftLabel ?? DEFAULT_REFERENCE_LABEL);
  const rightSpec = normalizeImageSpec(projectRoot, board.payload.right ?? board.payload.actual, board.payload.rightLabel ?? DEFAULT_ACTUAL_LABEL);
  const focusRegions = Array.isArray(board.payload.focusRegions ?? board.payload.regions) ? (board.payload.focusRegions ?? board.payload.regions) : [];
  if (focusRegions.length === 0) {
    throw new Error('Focus board requires focusRegions with at least one region.');
  }

  const leftPanel = await resizePanel(leftSpec.path, maxPanelWidth);
  const rightPanel = await resizePanel(rightSpec.path, maxPanelWidth);
  const panelWidth = Math.min(maxPanelWidth, Math.max(leftPanel.width, rightPanel.width));
  const overviewHeight = Math.max(leftPanel.height, rightPanel.height);
  const margin = 24;
  const gap = 24;
  const sectionGap = 28;
  const contentWidth = margin * 2 + panelWidth * 2 + gap;
  const titleBlock = titleBlockSvg(
    contentWidth - margin * 2,
    String(board.payload.title ?? DEFAULT_FOCUS_TITLE),
    String(board.payload.summary ?? '先看整体标框，再看编号对应的局部放大；局部差异优先在这里复核。'),
    '视觉验收 / 局部焦点',
  );

  const leftOverviewX = margin + Math.round((panelWidth - leftPanel.width) / 2);
  const rightOverviewX = margin + panelWidth + gap + Math.round((panelWidth - rightPanel.width) / 2);
  const overviewTop = margin + titleBlock.height + 18;
  const leftOverviewY = overviewTop + Math.round((overviewHeight - leftPanel.height) / 2);
  const rightOverviewY = overviewTop + Math.round((overviewHeight - rightPanel.height) / 2);

  const composites = [
    { input: titleBlock.input, left: margin, top: margin },
    { input: leftPanel.input, left: leftOverviewX, top: leftOverviewY },
    { input: rightPanel.input, left: rightOverviewX, top: rightOverviewY },
    { input: labelSvg(leftSpec.label), left: leftOverviewX + 16, top: leftOverviewY + 16 },
    { input: labelSvg(rightSpec.label), left: rightOverviewX + 16, top: rightOverviewY + 16 },
  ];

  const metadataRegions = [];
  const leftOverlayRegions = [];
  const rightOverlayRegions = [];
  let currentTop = overviewTop + overviewHeight + sectionGap;

  for (const [index, region] of focusRegions.entries()) {
    const label = String(region.label ?? region.name ?? `焦点 ${index + 1}`);
    const reason = String(region.reason ?? region.note ?? '').trim();
    const color = FOCUS_COLORS[index % FOCUS_COLORS.length];
    const leftResolved = resolveCropBox(region.leftBox ?? region.referenceBox ?? region.box, leftPanel.original);
    const rightResolved = resolveCropBox(region.rightBox ?? region.actualBox ?? region.box, rightPanel.original);
    const leftRenderedBox = renderedBoxFromAbsolute(leftResolved.absolute, leftPanel);
    const rightRenderedBox = renderedBoxFromAbsolute(rightResolved.absolute, rightPanel);
    const leftCrop = await extractCrop(leftPanel.source, leftResolved.absolute, panelWidth);
    const rightCrop = await extractCrop(rightPanel.source, rightResolved.absolute, panelWidth);
    const header = sectionHeaderSvg(contentWidth - margin * 2, index + 1, label, reason);
    const cropTop = currentTop + header.height + 12;
    const cropHeight = Math.max(leftCrop.height, rightCrop.height);
    const leftCropX = margin + Math.round((panelWidth - leftCrop.width) / 2);
    const rightCropX = margin + panelWidth + gap + Math.round((panelWidth - rightCrop.width) / 2);
    const leftCropY = cropTop + Math.round((cropHeight - leftCrop.height) / 2);
    const rightCropY = cropTop + Math.round((cropHeight - rightCrop.height) / 2);

    composites.push(
      { input: header.input, left: margin, top: currentTop },
      { input: leftCrop.input, left: leftCropX, top: leftCropY },
      { input: rightCrop.input, left: rightCropX, top: rightCropY },
      { input: labelSvg(leftSpec.label, { fontSize: 18, height: 40, minWidth: 112 }), left: leftCropX + 12, top: leftCropY + 12 },
      { input: labelSvg(rightSpec.label, { fontSize: 18, height: 40, minWidth: 112 }), left: rightCropX + 12, top: rightCropY + 12 },
    );
    leftOverlayRegions.push({ color, box: leftRenderedBox });
    rightOverlayRegions.push({ color, box: rightRenderedBox });
    metadataRegions.push({
      index: index + 1,
      label,
      reason,
      color,
      leftBox: {
        unit: leftResolved.unit,
        requested: leftResolved.requested,
        absolute: leftResolved.absolute,
        rendered: leftRenderedBox,
      },
      rightBox: {
        unit: rightResolved.unit,
        requested: rightResolved.requested,
        absolute: rightResolved.absolute,
        rendered: rightRenderedBox,
      },
      leftCrop: {
        width: leftCrop.width,
        height: leftCrop.height,
      },
      rightCrop: {
        width: rightCrop.width,
        height: rightCrop.height,
      },
    });
    currentTop = cropTop + cropHeight + sectionGap;
  }

  composites.push(
    { input: focusOverlaySvg(leftPanel.width, leftPanel.height, leftOverlayRegions), left: leftOverviewX, top: leftOverviewY },
    { input: focusOverlaySvg(rightPanel.width, rightPanel.height, rightOverlayRegions), left: rightOverviewX, top: rightOverviewY },
  );

  const canvasHeight = currentTop + margin - sectionGap;
  const canvas = sharp({
    create: {
      width: contentWidth,
      height: canvasHeight,
      channels: 3,
      background: '#111827',
    },
  }).composite(composites);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await encodePipeline(canvas, format, quality).toFile(outputPath);
  const metadataPath = metadataPathForOutput(outputPath);
  const reviewArtifact = {
    version: 1,
    schema: VISUAL_REVIEW_SCHEMA,
    generatedAt: timestamp(),
    mode: 'focus-board',
    outputPath: toWorkspacePath(projectRoot, outputPath),
    format,
    boardSource: toWorkspacePath(projectRoot, board.sourcePath),
    title: String(board.payload.title ?? DEFAULT_FOCUS_TITLE),
    labels: {
      reference: leftSpec.label,
      actual: rightSpec.label,
    },
    reference: {
      path: toWorkspacePath(projectRoot, leftPanel.source),
      original: leftPanel.original,
      rendered: {
        width: leftPanel.width,
        height: leftPanel.height,
      },
    },
    actual: {
      path: toWorkspacePath(projectRoot, rightPanel.source),
      original: rightPanel.original,
      rendered: {
        width: rightPanel.width,
        height: rightPanel.height,
      },
    },
    focusRegions: metadataRegions,
    canvas: {
      width: contentWidth,
      height: canvasHeight,
    },
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(reviewArtifact, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    action: 'visual-compare',
    mode: 'focus-board',
    projectRoot,
    outputPath,
    metadataPath,
    format,
    quality: format === 'png' ? null : quality,
    maxPanelWidth,
    labels: reviewArtifact.labels,
    reference: reviewArtifact.reference,
    actual: reviewArtifact.actual,
    focusRegions: metadataRegions,
    canvas: reviewArtifact.canvas,
    reviewArtifact,
    nextActions: [
      '先看顶部编号框，再对照下面同编号的局部放大图复核差异。',
      '若局部区域仍有问题，优先围绕该编号返工，并重新生成焦点证据板。',
      '局部证据板适合补充整体对比，不建议只看整体图就结束界面验收。',
    ],
  };
}

async function renderParallelCard(projectRoot, item, index, options = {}) {
  const cardWidth = options.cardWidth;
  const contentWidth = cardWidth - 36;
  const title = String(item.label ?? item.title ?? `方案 ${index + 1}`);
  const subtitle = String(item.subtitle ?? item.summary ?? '').trim();
  const verdict = String(item.verdict ?? '').trim();
  const mediaList = normalizeMediaList(projectRoot, item.media);
  const metrics = normalizeMetricList(item.metrics ?? item.metricMap);
  const notes = String(item.notes ?? item.note ?? '').trim();
  const header = titleBlockSvg(
    contentWidth,
    `${index + 1}. ${title}`,
    subtitle,
    verdict ? `结论：${verdict}` : (options.eyebrow ?? '并行实验'),
  );
  const composites = [
    { input: header.input, left: 18, top: 18 },
  ];
  const renderedMedia = [];
  let currentTop = 18 + header.height + 12;

  for (const media of mediaList) {
    const label = labelSvg(media.label, {
      fontSize: 16,
      height: 36,
      minWidth: 96,
      paddingX: 16,
      radius: 12,
    });
    const mediaPanel = await resizePanel(media.path, contentWidth);
    composites.push(
      { input: label, left: 18, top: currentTop },
      { input: mediaPanel.input, left: 18 + Math.round((contentWidth - mediaPanel.width) / 2), top: currentTop + 42 },
    );
    renderedMedia.push({
      path: toWorkspacePath(projectRoot, media.path),
      label: media.label,
      original: mediaPanel.original,
      rendered: {
        width: mediaPanel.width,
        height: mediaPanel.height,
      },
    });
    currentTop += 42 + mediaPanel.height + 16;
  }

  const metricsBlock = metricsSvg(contentWidth, metrics, notes);
  if (metricsBlock.input) {
    composites.push({ input: metricsBlock.input, left: 18, top: currentTop });
    currentTop += metricsBlock.height + 12;
  }

  const cardHeight = currentTop + 18;
  const card = sharp({
    create: {
      width: cardWidth,
      height: cardHeight,
      channels: 3,
      background: '#0f172a',
    },
  }).composite([
    ...composites,
    {
      input: Buffer.from(`
<svg width="${cardWidth}" height="${cardHeight}" viewBox="0 0 ${cardWidth} ${cardHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0.75" y="0.75" width="${cardWidth - 1.5}" height="${cardHeight - 1.5}" rx="22" fill="none" stroke="#334155" stroke-width="1.5"/>
</svg>`),
      left: 0,
      top: 0,
    },
  ]);

  return {
    image: await card.png().toBuffer(),
    width: cardWidth,
    height: cardHeight,
    item: {
      index: index + 1,
      label: title,
      subtitle,
      verdict,
      metrics,
      notes,
      media: renderedMedia,
    },
  };
}

async function renderParallelBoard(projectRoot, board, options = {}) {
  const format = normalizeFormat(options.format, options.out);
  const outputPath = options.out
    ? path.resolve(projectRoot, options.out)
    : defaultOutputPath(projectRoot, format, 'parallel-board');
  const quality = parseQuality(options.quality);
  const items = Array.isArray(board.payload.items) ? board.payload.items : [];
  if (items.length === 0) {
    throw new Error('Parallel board requires items with at least one experiment.');
  }
  const cardWidth = parsePositiveInteger(board.payload.cardWidth ?? options.maxPanelWidth, DEFAULT_PARALLEL_CARD_WIDTH, 'cardWidth');
  const columns = Math.max(1, Math.min(parsePositiveInteger(board.payload.columns, Math.min(DEFAULT_PARALLEL_COLUMNS, items.length), 'columns'), 4));
  const margin = 24;
  const gap = 24;
  const titleBlock = titleBlockSvg(
    columns * cardWidth + (columns - 1) * gap,
    String(board.payload.title ?? DEFAULT_PARALLEL_TITLE),
    String(board.payload.summary ?? '把多方向产物、局部截图、GIF 首帧和指标放到一板里，方便统一审查。'),
    '视觉验收 / 并行实验',
  );

  const renderedCards = [];
  for (const [index, item] of items.entries()) {
    renderedCards.push(await renderParallelCard(projectRoot, item, index, { cardWidth }));
  }

  const rowHeights = [];
  for (let index = 0; index < renderedCards.length; index += columns) {
    rowHeights.push(Math.max(...renderedCards.slice(index, index + columns).map((card) => card.height)));
  }
  const canvasWidth = margin * 2 + columns * cardWidth + (columns - 1) * gap;
  const canvasHeight = margin * 2 + titleBlock.height + 18 + rowHeights.reduce((sum, value) => sum + value, 0) + Math.max(0, rowHeights.length - 1) * gap;
  const composites = [
    { input: titleBlock.input, left: margin, top: margin },
  ];
  let currentTop = margin + titleBlock.height + 18;
  for (let row = 0; row < rowHeights.length; row += 1) {
    const rowCards = renderedCards.slice(row * columns, row * columns + columns);
    for (const [column, card] of rowCards.entries()) {
      composites.push({
        input: card.image,
        left: margin + column * (cardWidth + gap),
        top: currentTop,
      });
    }
    currentTop += rowHeights[row] + gap;
  }

  const canvas = sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: '#111827',
    },
  }).composite(composites);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await encodePipeline(canvas, format, quality).toFile(outputPath);
  const metadataPath = metadataPathForOutput(outputPath);
  const reviewArtifact = {
    version: 1,
    schema: VISUAL_REVIEW_SCHEMA,
    generatedAt: timestamp(),
    mode: 'parallel-board',
    outputPath: toWorkspacePath(projectRoot, outputPath),
    format,
    boardSource: toWorkspacePath(projectRoot, board.sourcePath),
    title: String(board.payload.title ?? DEFAULT_PARALLEL_TITLE),
    layout: {
      columns,
      cardWidth,
      rowCount: rowHeights.length,
    },
    items: renderedCards.map((card) => card.item),
    canvas: {
      width: canvasWidth,
      height: canvasHeight,
    },
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(reviewArtifact, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    action: 'visual-compare',
    mode: 'parallel-board',
    projectRoot,
    outputPath,
    metadataPath,
    format,
    quality: format === 'png' ? null : quality,
    canvas: reviewArtifact.canvas,
    reviewArtifact,
    items: reviewArtifact.items,
    nextActions: [
      '横向比较每个实验卡片，再结合指标和结论判断是否要保留多条方向继续迭代。',
      '如果某个方向需要局部细看，再补一张局部焦点证据板，不要只盯整体缩略图。',
      '并行实验证据板适合在 Agent 自验收和用户评审时一起使用，减少来回口头解释。',
    ],
  };
}

async function renderVerificationBoard(projectRoot, board, options = {}) {
  const format = normalizeFormat(options.format, options.out);
  const outputPath = options.out
    ? path.resolve(projectRoot, options.out)
    : defaultOutputPath(projectRoot, format, 'verification-board');
  const quality = parseQuality(options.quality);
  const items = normalizeVerificationItems(projectRoot, board.payload);
  if (items.length === 0) {
    throw new Error('Verification board requires screenshots, items, or a single screenshot/path entry.');
  }
  const cardWidth = parsePositiveInteger(board.payload.cardWidth ?? options.maxPanelWidth, DEFAULT_PARALLEL_CARD_WIDTH, 'cardWidth');
  const columns = Math.max(1, Math.min(parsePositiveInteger(board.payload.columns, Math.min(DEFAULT_PARALLEL_COLUMNS, items.length), 'columns'), 4));
  const margin = 24;
  const gap = 24;
  const route = String(board.payload.route ?? board.payload.flow ?? board.payload.method ?? '').trim();
  const summary = String(board.payload.summary
    ?? (route ? `实测路径：${route}` : '把普通截图、Computer/Browser 实测路径和检查点拼到同一张板里，避免只用单张截图口头收口。'));
  const titleBlock = titleBlockSvg(
    columns * cardWidth + (columns - 1) * gap,
    String(board.payload.title ?? DEFAULT_VERIFICATION_TITLE),
    summary,
    '视觉验收 / 截图实测',
  );

  const renderedCards = [];
  for (const [index, item] of items.entries()) {
    renderedCards.push(await renderParallelCard(projectRoot, item, index, {
      cardWidth,
      eyebrow: '截图实测',
    }));
  }

  const rowHeights = [];
  for (let index = 0; index < renderedCards.length; index += columns) {
    rowHeights.push(Math.max(...renderedCards.slice(index, index + columns).map((card) => card.height)));
  }
  const canvasWidth = margin * 2 + columns * cardWidth + (columns - 1) * gap;
  const canvasHeight = margin * 2 + titleBlock.height + 18 + rowHeights.reduce((sum, value) => sum + value, 0) + Math.max(0, rowHeights.length - 1) * gap;
  const composites = [
    { input: titleBlock.input, left: margin, top: margin },
  ];
  let currentTop = margin + titleBlock.height + 18;
  for (let row = 0; row < rowHeights.length; row += 1) {
    const rowCards = renderedCards.slice(row * columns, row * columns + columns);
    for (const [column, card] of rowCards.entries()) {
      composites.push({
        input: card.image,
        left: margin + column * (cardWidth + gap),
        top: currentTop,
      });
    }
    currentTop += rowHeights[row] + gap;
  }

  const canvas = sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: '#111827',
    },
  }).composite(composites);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await encodePipeline(canvas, format, quality).toFile(outputPath);
  const metadataPath = metadataPathForOutput(outputPath);
  const reviewArtifact = {
    version: 1,
    schema: VISUAL_REVIEW_SCHEMA,
    generatedAt: timestamp(),
    mode: 'verification-board',
    outputPath: toWorkspacePath(projectRoot, outputPath),
    format,
    boardSource: toWorkspacePath(projectRoot, board.sourcePath),
    title: String(board.payload.title ?? DEFAULT_VERIFICATION_TITLE),
    route: route || null,
    layout: {
      columns,
      cardWidth,
      rowCount: rowHeights.length,
    },
    items: renderedCards.map((card) => card.item),
    canvas: {
      width: canvasWidth,
      height: canvasHeight,
    },
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(reviewArtifact, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    action: 'visual-compare',
    mode: 'verification-board',
    projectRoot,
    outputPath,
    metadataPath,
    format,
    quality: format === 'png' ? null : quality,
    canvas: reviewArtifact.canvas,
    reviewArtifact,
    items: reviewArtifact.items,
    nextActions: [
      '先核对实测路径和每张截图对应的检查点，再判断是否能声明视觉或运行态验收完成。',
      '普通截图只能作为原始素材；最终收口请引用这张截图实测证据板。',
      '如果发现局部差异，再补一张局部焦点证据板或重新生成本证据板。',
    ],
  };
}

async function visualCompareWorkspace(projectRoot, options = {}) {
  const request = resolveComparisonInputs(options);
  if (request.mode === 'board') {
    const board = await readBoardSpec(projectRoot, request.board);
    if (board.mode === 'focus-board') {
      return renderFocusBoard(projectRoot, board, options);
    }
    if (board.mode === 'parallel-board') {
      return renderParallelBoard(projectRoot, board, options);
    }
    if (board.mode === 'verification-board') {
      return renderVerificationBoard(projectRoot, board, options);
    }
    throw new Error(`Unsupported board mode: ${board.mode}`);
  }
  return renderStandardComparison(projectRoot, request, options);
}

export { visualCompareWorkspace };
