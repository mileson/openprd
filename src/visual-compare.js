import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { compactTimestamp } from './time.js';

const DEFAULT_PANEL_WIDTH = 1180;
const DEFAULT_QUALITY = 85;
const DEFAULT_REFERENCE_LABEL = '效果图';
const DEFAULT_ACTUAL_LABEL = '实现截图';
const OUTPUT_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp']);

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

function defaultOutputPath(projectRoot, format) {
  return path.join(
    projectRoot,
    '.openprd',
    'harness',
    'visual-reviews',
    `visual-compare-${compactTimestamp()}.${outputExtension(format)}`,
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

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function labelSvg(label) {
  const text = escapeXml(label);
  const charCount = Array.from(label).length;
  const width = Math.max(126, charCount * 26 + 42);
  return Buffer.from(`
<svg width="${width}" height="46" viewBox="0 0 ${width} 46" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${width}" height="46" rx="14" fill="#111827" fill-opacity="0.82"/>
  <rect x="0.75" y="0.75" width="${width - 1.5}" height="44.5" rx="13.25" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="1.5"/>
  <text x="21" y="30" fill="#ffffff" font-size="22" font-weight="700" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, Arial Unicode MS, sans-serif">${text}</text>
</svg>`);
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

function encodePipeline(image, format, quality) {
  if (format === 'png') {
    return image.png();
  }
  if (format === 'webp') {
    return image.webp({ quality });
  }
  return image.jpeg({ quality });
}

async function visualCompareWorkspace(projectRoot, options = {}) {
  const reference = options.reference;
  const actual = options.actual;
  if (!reference) {
    throw new Error('Missing --reference image path.');
  }
  if (!actual) {
    throw new Error('Missing --actual image path.');
  }

  const format = normalizeFormat(options.format, options.out);
  const outputPath = options.out
    ? path.resolve(projectRoot, options.out)
    : defaultOutputPath(projectRoot, format);
  const quality = parseQuality(options.quality);
  const maxPanelWidth = parsePositiveInteger(options.maxPanelWidth, DEFAULT_PANEL_WIDTH, '--max-panel-width');
  const referenceLabel = options.referenceLabel || DEFAULT_REFERENCE_LABEL;
  const actualLabel = options.actualLabel || DEFAULT_ACTUAL_LABEL;

  const referencePanel = await resizePanel(reference, maxPanelWidth);
  const actualPanel = await resizePanel(actual, maxPanelWidth);
  const panelWidth = Math.min(
    maxPanelWidth,
    Math.max(referencePanel.width, actualPanel.width),
  );
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
    { input: labelSvg(referenceLabel), left: referenceLeft + 16, top: referenceTop + 16 },
    { input: labelSvg(actualLabel), left: actualLeft + 16, top: actualTop + 16 },
  ]);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await encodePipeline(canvas, format, quality).toFile(outputPath);

  return {
    ok: true,
    action: 'visual-compare',
    projectRoot,
    outputPath,
    format,
    quality: format === 'png' ? null : quality,
    maxPanelWidth,
    labels: {
      reference: referenceLabel,
      actual: actualLabel,
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
    nextActions: [
      '把输出图片作为视觉评审证据查看：左侧效果图，右侧实现截图。',
      '如果仍有明显差异，继续按效果图复刻并重新运行 visual-compare。',
      '只有对比图确认一致后，才声明本阶段界面视觉实现完成。',
    ],
  };
}

export { visualCompareWorkspace };
