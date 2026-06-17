import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { VISUAL_REVIEW_SCHEMA } from './quality-visual-review.js';
import { compactTimestamp, timestamp } from './time.js';
import {
  OPENPRD_FALLBACK_LOCALE,
  detectPrimaryLanguage,
  isChineseLocale,
  isEnglishHeavyText,
  normalizeOutputLocale,
} from './language-policy.js';

const DEFAULT_PANEL_WIDTH = 1180;
const DEFAULT_QUALITY = 85;
const DEFAULT_REFERENCE_LABEL = '效果图';
const DEFAULT_ACTUAL_LABEL = '实现截图';
const DEFAULT_BEFORE_LABEL = '修改前';
const DEFAULT_AFTER_LABEL = '修改后';
const DEFAULT_FOCUS_TITLE = '局部焦点证据板';
const DEFAULT_PARALLEL_TITLE = '并行实验证据板';
const DEFAULT_VERIFICATION_TITLE = '截图实测证据板';
const DEFAULT_ALIGNMENT_TITLE = '对齐辅助线证据板';
const DEFAULT_CENTERING_TITLE = '单元素内部居中证据板';
const DEFAULT_PARALLEL_CARD_WIDTH = 380;
const DEFAULT_PARALLEL_COLUMNS = 3;
const OUTPUT_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const NON_VISIBLE_BOARD_KEYS = new Set([
  'actual',
  'after',
  'before',
  'boardSource',
  'box',
  'boxes',
  'cardWidth',
  'color',
  'columns',
  'format',
  'generatedAt',
  'grid',
  'height',
  'id',
  'image',
  'mode',
  'outputPath',
  'overlay',
  'path',
  'reference',
  'schema',
  'screenshot',
  'source',
  'sourcePath',
  'targetBox',
  'unit',
  'url',
  'width',
  'x',
  'y',
]);
const VISUAL_COPY = {
  zh: {
    separator: '：',
    materialLabel: (index) => `素材 ${index + 1}`,
    metricTextLabel: '说明',
    metricFallbackLabel: '指标',
    referenceLabel: DEFAULT_REFERENCE_LABEL,
    actualLabel: DEFAULT_ACTUAL_LABEL,
    beforeLabel: DEFAULT_BEFORE_LABEL,
    afterLabel: DEFAULT_AFTER_LABEL,
    focusTitle: DEFAULT_FOCUS_TITLE,
    parallelTitle: DEFAULT_PARALLEL_TITLE,
    verificationTitle: DEFAULT_VERIFICATION_TITLE,
    alignmentTitle: DEFAULT_ALIGNMENT_TITLE,
    centeringTitle: DEFAULT_CENTERING_TITLE,
    focusSummary: '先看整体标框，再看编号对应的局部放大；局部差异优先在这里复核。',
    focusEyebrow: '视觉验收 / 局部焦点',
    focusRegionLabel: (index) => `焦点 ${index + 1}`,
    referenceEyebrow: '视觉验收 / 效果对比',
    beforeAfterEyebrow: '视觉验收 / 修改前后',
    parallelEyebrow: '视觉验收 / 并行实验',
    parallelSummary: '把多方向产物、局部截图、GIF 首帧和指标放到一板里，方便统一审查。',
    parallelItemLabel: (index) => `方案 ${index + 1}`,
    verificationEyebrow: '视觉验收 / 截图实测',
    verificationCardEyebrow: '截图实测',
    verificationSingleLabel: '实测截图',
    verificationItemLabel: (index) => `实测截图 ${index + 1}`,
    verificationMediaLabel: (index) => `截图 ${index + 1}`,
    alignmentSummary: '用辅助线和坐标 spread 同时验证同构列表、卡片、网格或表格的容器轨道与内部内容槽位是否对齐。',
    alignmentEyebrow: '视觉验收 / 对齐辅助线',
    alignmentScreenshotLabel: '真实截图',
    alignmentOverlayLabel: '辅助线截图',
    alignmentMeasureEyebrow: '对齐量测',
    alignmentGroupLabel: (index) => `对齐分组 ${index + 1}`,
    alignmentGuideLabel: (index) => `辅助线 ${index + 1}`,
    alignmentRegionLabel: (index) => `区域 ${index + 1}`,
    alignmentContainerLevel: '容器轨道',
    alignmentContentSlotLevel: '内容槽位轨道',
    alignmentExpectedPrefix: '预期',
    alignmentStructurePrefix: '结构',
    alignmentItemLabel: '对齐项',
    alignmentThresholdLabel: '阈值',
    passVerdict: '通过',
    reworkVerdict: '需返工',
    centeringSummary: '用像素 mask 识别主体，红线是画布中心，绿色框是主体外接框，黄色点是视觉重心；同时检查外接框中心和视觉重心偏移。',
    centeringEyebrow: '视觉验收 / 内部居中',
    centeringImageLabel: '目标元素',
    centeringOverlayLabel: '量测覆盖图',
    centeringMeasureLabel: '内部居中量测',
    centeringMeasureEyebrow: '像素量测',
    centeringThresholdLabel: '阈值',
    centeringCanvasSizeLabel: '画布尺寸',
    centeringBoundsLabel: '主体外接框',
    centeringBboxOffsetLabel: '外接框中心偏移',
    centeringCentroidOffsetLabel: '视觉重心偏移',
    centeringMaxOffsetLabel: '最大偏移',
    centeringPixelRatioLabel: '主体像素占比',
    centeringCentroidLabel: '重心',
    centeringNotes: '红色=画布中心；绿色=主体外接框和外接框中心；黄色=视觉重心。若 mask 误判，改用 subject.ranges 或 subject.colors 后重跑。',
    resultPrefix: '结论',
    referenceNextActions: [
      '把输出图片作为视觉评审证据查看：左侧效果图，右侧实现截图。',
      '如果仍有明显差异，继续按效果图复刻并重新运行 visual-compare。',
      '只有对比图确认一致后，才声明本阶段界面视觉实现完成。',
    ],
    beforeAfterNextActions: [
      '把输出图片作为视觉改动自检证据查看：左侧修改前，右侧修改后。',
      '检查预期变化是否出现，以及未改区域是否有布局、颜色、密度或状态漂移。',
      '没有效果图时，这张图只证明改动前后差异已自检；大界面方向性改造仍需先完成方案评审。',
    ],
    verificationSummary: (route) => route
      ? `实测路径：${route}`
      : '把普通截图、Computer/Browser 实测路径和检查点拼到同一张板里，避免只用单张截图口头收口。',
    verificationNextActions: [
      '先核对实测路径和每张截图对应的检查点，再判断是否能声明视觉或运行态验收完成。',
      '普通截图只能作为原始素材；最终收口请引用这张截图实测证据板。',
      '如果发现局部差异，再补一张局部焦点证据板或重新生成本证据板。',
    ],
    focusNextActions: [
      '先看顶部编号框，再对照下面同编号的局部放大图复核差异。',
      '若局部区域仍有问题，优先围绕该编号返工，并重新生成焦点证据板。',
      '局部证据板适合补充整体对比，不建议只看整体图就结束界面验收。',
    ],
    parallelNextActions: [
      '横向比较每个实验卡片，再结合指标和结论判断是否要保留多条方向继续迭代。',
      '如果某个方向需要局部细看，再补一张局部焦点证据板，不要只盯整体缩略图。',
      '并行实验证据板适合在 Agent 自验收和用户评审时一起使用，减少来回口头解释。',
    ],
    alignmentNextActions: [
      '先看辅助线是否同时覆盖容器轨道和内容槽位轨道，再看每个分组里的 spread 是否低于阈值。',
      '列表、卡片、网格或表格的新功能开发，只要有同构重复单元，就把标题、副标题、描述、标签、状态、价格、按钮、图标等内部槽位作为默认量测项。',
      '如果只量了卡片外框、列宽或行顶，没有量内部内容槽位，不能声明卡片对齐已经完成。',
      '如果任一关键槽位超过阈值且没有设计解释，先返工再重新生成对齐证据板。',
    ],
    centeringNextActions: [
      '先看红色画布中心线、绿色主体外接框和黄色视觉重心点是否在同一中心附近。',
      '如果外接框中心或视觉重心偏移超过阈值，先调整元素画布、内边距或素材裁切，再重新生成内部居中证据板。',
      '如果自动 mask 把背景或阴影算进主体，改用 subject.ranges 或 subject.colors 明确主体颜色后重跑。',
      '单张原始截图或“看起来居中”的主观判断不能替代这张内部居中证据板。',
    ],
  },
  en: {
    separator: ': ',
    materialLabel: (index) => `Asset ${index + 1}`,
    metricTextLabel: 'Notes',
    metricFallbackLabel: 'Metric',
    referenceLabel: 'Reference',
    actualLabel: 'Implementation',
    beforeLabel: 'Before',
    afterLabel: 'After',
    focusTitle: 'Focus Evidence Board',
    parallelTitle: 'Parallel Experiment Board',
    verificationTitle: 'Screenshot Verification Board',
    alignmentTitle: 'Alignment Evidence Board',
    centeringTitle: 'Element Centering Board',
    focusSummary: 'Review the marked overview first, then inspect each numbered zoomed region.',
    focusEyebrow: 'Visual QA / Focus Regions',
    focusRegionLabel: (index) => `Focus ${index + 1}`,
    referenceEyebrow: 'Visual QA / Reference Comparison',
    beforeAfterEyebrow: 'Visual QA / Before and After',
    parallelEyebrow: 'Visual QA / Parallel Experiments',
    parallelSummary: 'Collect multiple directions, local screenshots, GIF key frames, and metrics on one board for review.',
    parallelItemLabel: (index) => `Option ${index + 1}`,
    verificationEyebrow: 'Visual QA / Screenshot Verification',
    verificationCardEyebrow: 'Screenshot Check',
    verificationSingleLabel: 'Verified Screenshot',
    verificationItemLabel: (index) => `Verified Screenshot ${index + 1}`,
    verificationMediaLabel: (index) => `Screenshot ${index + 1}`,
    alignmentSummary: 'Use guides and coordinate spread to verify container tracks and internal content slots across repeated UI units.',
    alignmentEyebrow: 'Visual QA / Alignment Guides',
    alignmentScreenshotLabel: 'Live Screenshot',
    alignmentOverlayLabel: 'Guide Overlay',
    alignmentMeasureEyebrow: 'Alignment Measurement',
    alignmentGroupLabel: (index) => `Alignment Group ${index + 1}`,
    alignmentGuideLabel: (index) => `Guide ${index + 1}`,
    alignmentRegionLabel: (index) => `Region ${index + 1}`,
    alignmentContainerLevel: 'Container Track',
    alignmentContentSlotLevel: 'Content Slot Track',
    alignmentExpectedPrefix: 'Expected',
    alignmentStructurePrefix: 'Structure',
    alignmentItemLabel: 'Alignment Item',
    alignmentThresholdLabel: 'Threshold',
    passVerdict: 'Pass',
    reworkVerdict: 'Needs Rework',
    centeringSummary: 'Use a pixel mask to isolate the subject: red lines mark the canvas center, the green box marks subject bounds, and the yellow dot marks visual centroid.',
    centeringEyebrow: 'Visual QA / Internal Centering',
    centeringImageLabel: 'Target Element',
    centeringOverlayLabel: 'Measurement Overlay',
    centeringMeasureLabel: 'Internal Centering Measurement',
    centeringMeasureEyebrow: 'Pixel Measurement',
    centeringThresholdLabel: 'Threshold',
    centeringCanvasSizeLabel: 'Canvas Size',
    centeringBoundsLabel: 'Subject Bounds',
    centeringBboxOffsetLabel: 'Bounds Center Offset',
    centeringCentroidOffsetLabel: 'Visual Centroid Offset',
    centeringMaxOffsetLabel: 'Max Offset',
    centeringPixelRatioLabel: 'Subject Pixel Ratio',
    centeringCentroidLabel: 'centroid',
    centeringNotes: 'Red=canvas center; green=subject bounds and bounds center; yellow=visual centroid. If the mask is wrong, rerun with subject.ranges or subject.colors.',
    resultPrefix: 'Result',
    referenceNextActions: [
      'Review the output image as visual QA evidence: reference on the left, implementation on the right.',
      'If visible differences remain, keep iterating against the reference and rerun visual-compare.',
      'Only claim this UI stage is visually complete after the comparison looks aligned.',
    ],
    beforeAfterNextActions: [
      'Review the output image as before/after evidence for the visual change.',
      'Check that the intended change appeared and unchanged areas did not drift in layout, color, density, or state.',
      'Without a reference image, this only proves a before/after self-check; large directional UI changes still need pre-implementation visual review.',
    ],
    verificationSummary: (route) => route
      ? `Checked path: ${route}`
      : 'Combine screenshots, Computer/Browser check paths, and checkpoints into one board instead of closing on a raw screenshot.',
    verificationNextActions: [
      'Review the checked path and every screenshot checkpoint before claiming visual or runtime verification is complete.',
      'Raw screenshots are only inputs; cite this screenshot verification board for final closeout.',
      'If a local difference appears, add a focus evidence board or regenerate this board.',
    ],
    focusNextActions: [
      'Review the numbered overview first, then inspect the matching zoomed regions below.',
      'If a focused region still has issues, iterate on that numbered region and regenerate the board.',
      'Use focus boards as supporting evidence for the overall comparison instead of closing on the overview alone.',
    ],
    parallelNextActions: [
      'Compare each experiment card side by side, then use the metrics and verdicts to decide which directions remain.',
      'If one direction needs closer inspection, add a focus evidence board instead of relying on the thumbnail.',
      'Use this board for both agent self-checks and user review to reduce back-and-forth explanation.',
    ],
    alignmentNextActions: [
      'Check that guides cover both container tracks and content-slot tracks, then confirm each group spread is under threshold.',
      'For repeated lists, cards, grids, or tables, measure internal slots such as title, subtitle, body, badge, status, price, buttons, and icons.',
      'If only card frames, column widths, or row tops were measured, do not claim card alignment is complete.',
      'If any critical slot exceeds threshold without a design rationale, fix it and regenerate the alignment board.',
    ],
    centeringNextActions: [
      'Check whether the red canvas center lines, green subject bounds, and yellow visual centroid land near the same center.',
      'If the bounds center or visual centroid exceeds threshold, adjust the canvas, padding, or asset crop and regenerate the board.',
      'If the automatic mask includes background or shadow pixels, rerun with explicit subject.ranges or subject.colors.',
      'A raw screenshot or a subjective “looks centered” check does not replace this centering evidence board.',
    ],
  },
};
const FOCUS_COLORS = ['#f97316', '#22c55e', '#38bdf8', '#eab308', '#fb7185', '#a78bfa'];
const ALIGNMENT_CONTAINER_TOKENS = [
  'container',
  'outer',
  'card edge',
  'column',
  'row',
  'width',
  'height',
  '容器',
  '外框',
  '边界',
  '列',
  '行',
  '卡片宽度',
  '列间距',
  '行顶',
  '宽度',
  '高度',
];
const ALIGNMENT_CONTENT_SLOT_TOKENS = [
  'content slot',
  'internal slot',
  'same slot',
  'title',
  'subtitle',
  'description',
  'body',
  'tag',
  'badge',
  'status',
  'price',
  'button',
  'action',
  'icon',
  '内容槽位',
  '内部槽位',
  '相同槽位',
  '文案类型',
  '组件槽位',
  '标题',
  '副标题',
  '描述',
  '正文',
  '标签',
  '状态',
  '价格',
  '按钮',
  '操作区',
  '图标',
  '基线',
];
const MODE_PREFIX = {
  'reference-actual': 'visual-compare',
  'before-after': 'visual-before-after',
  'focus-board': 'visual-focus-board',
  'parallel-board': 'visual-parallel-board',
  'verification-board': 'visual-verification-board',
  'alignment-board': 'visual-alignment-board',
  'centering-board': 'visual-centering-board',
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
  ['alignment', 'alignment-board'],
  ['alignment-board', 'alignment-board'],
  ['alignment-guide-board', 'alignment-board'],
  ['grid-alignment', 'alignment-board'],
  ['grid-alignment-board', 'alignment-board'],
  ['visual-alignment-board', 'alignment-board'],
  ['center', 'centering-board'],
  ['centering', 'centering-board'],
  ['center-board', 'centering-board'],
  ['centering-board', 'centering-board'],
  ['center-evidence-board', 'centering-board'],
  ['visual-centering-board', 'centering-board'],
]);

function visualCopyForLocale(locale) {
  return isChineseLocale(locale) ? VISUAL_COPY.zh : VISUAL_COPY.en;
}

function localeFromOptions(options = {}) {
  return normalizeOutputLocale(options.locale ?? options.lang);
}

function resolveBoardLocale(options = {}, payload = {}) {
  const explicit = options.locale ?? options.lang ?? payload.locale ?? payload.lang;
  if (explicit) {
    return normalizeOutputLocale(explicit);
  }
  return detectPrimaryLanguage(collectBoardVisibleTextEntries(payload).map((entry) => entry.value));
}

function collectBoardVisibleTextEntries(value, basePath = '') {
  const entries = [];
  const visit = (node, pathKey) => {
    if (typeof node === 'string') {
      const key = pathKey.split('.').at(-1) ?? '';
      if (!NON_VISIBLE_BOARD_KEYS.has(key) && node.trim()) {
        entries.push({ path: pathKey || 'value', value: node.trim() });
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const [index, item] of node.entries()) {
        visit(item, `${pathKey}.${index}`.replace(/^\./, ''));
      }
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, item] of Object.entries(node)) {
        if (NON_VISIBLE_BOARD_KEYS.has(key)) {
          continue;
        }
        visit(item, `${pathKey}.${key}`.replace(/^\./, ''));
      }
    }
  };
  visit(value, basePath);
  return entries;
}

function validateBoardVisibleLanguage(board, locale) {
  if (!isChineseLocale(locale)) {
    return;
  }
  const offenders = collectBoardVisibleTextEntries(board.payload)
    .filter((entry) => isEnglishHeavyText(entry.value))
    .slice(0, 12);
  if (offenders.length === 0) {
    return;
  }
  const details = offenders
    .map((entry) => `- ${entry.path} 应跟随中文语境，当前内容偏英文: ${entry.value.slice(0, 96)}`)
    .join('\n');
  throw new Error(`Invalid visual board language for locale zh-CN:\n${details}`);
}

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

function compactLabel(value, maxChars = 14) {
  const chars = Array.from(String(value ?? ''));
  if (chars.length <= maxChars) {
    return chars.join('');
  }
  return `${chars.slice(0, Math.max(1, maxChars - 3)).join('')}...`;
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
  const fontSize = options.fontSize ?? 22;
  const height = options.height ?? 46;
  const paddingX = options.paddingX ?? 21;
  const radius = options.radius ?? 14;
  const bg = options.background ?? '#111827';
  const bgOpacity = options.backgroundOpacity ?? 0.82;
  const stroke = options.stroke ?? '#ffffff';
  const strokeOpacity = options.strokeOpacity ?? 0.22;
  const maxWidth = Number.isFinite(Number(options.maxWidth)) ? Math.max(1, Number(options.maxWidth)) : Infinity;
  const minWidth = Math.min(options.minWidth ?? 126, maxWidth);
  const availableChars = Number.isFinite(maxWidth)
    ? Math.max(1, Math.floor((maxWidth - paddingX * 2) / Math.max(fontSize + 4, 1)))
    : charCount(label);
  const displayLabel = Number.isFinite(maxWidth) ? compactLabel(label, availableChars) : String(label ?? '');
  const text = escapeXml(displayLabel);
  const width = Math.min(maxWidth, Math.max(minWidth, charCount(displayLabel) * (fontSize + 4) + paddingX * 2));
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

function metricsSvg(width, metrics = [], notes = null, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  const contentWidth = Math.max(Number(width) || 0, 1);
  const lines = [];
  for (const metric of metrics) {
    lines.push(`${metric.label}${copy.separator}${metric.value}`);
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
  const locale = localeFromOptions(options);
  const copy = visualCopyForLocale(locale);
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
      locale,
      left: options.before,
      right: options.after,
      leftLabel: options.referenceLabel || copy.beforeLabel,
      rightLabel: options.actualLabel || copy.afterLabel,
      eyebrow: copy.beforeAfterEyebrow,
      nextActions: copy.beforeAfterNextActions,
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
      locale,
      left: options.reference,
      right: options.actual,
      leftLabel: options.referenceLabel || copy.referenceLabel,
      rightLabel: options.actualLabel || copy.actualLabel,
      eyebrow: copy.referenceEyebrow,
      nextActions: copy.referenceNextActions,
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
    throw new Error(`Unsupported board mode in ${boardPath}. Use focus-board, parallel-board, verification-board, alignment-board, or centering-board.`);
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

function normalizeMetricList(metrics, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  if (!metrics) {
    return [];
  }
  if (Array.isArray(metrics)) {
    return metrics
      .filter(Boolean)
      .map((item) => {
        if (typeof item === 'string') {
          return { label: copy.metricTextLabel, value: item };
        }
        return {
          label: String(item.label ?? item.key ?? copy.metricFallbackLabel),
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

function normalizeMediaList(projectRoot, media, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  if (!Array.isArray(media)) {
    return [];
  }
  return media
    .filter(Boolean)
    .map((entry, index) => {
      if (typeof entry === 'string') {
        return {
          path: resolveProjectPath(projectRoot, entry),
          label: copy.materialLabel(index),
        };
      }
      if (!entry.path) {
        throw new Error(`Parallel board media[${index}] is missing path.`);
      }
      return {
        path: resolveProjectPath(projectRoot, entry.path),
        label: String(entry.label ?? copy.materialLabel(index)),
      };
    });
}

function normalizeVerificationItems(projectRoot, payload, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  let rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (rawItems.length === 0 && Array.isArray(payload.screenshots)) {
    rawItems = payload.screenshots;
  }
  if (rawItems.length === 0) {
    const singlePath = payload.screenshot ?? payload.actual ?? payload.path;
    if (singlePath) {
      rawItems = [{
        path: singlePath,
        label: payload.label ?? copy.verificationSingleLabel,
        notes: payload.notes ?? payload.note ?? payload.summary,
        checks: payload.checks ?? payload.checkpoints,
      }];
    }
  }
  return rawItems.map((item, index) => {
    if (typeof item === 'string') {
      return {
        label: copy.verificationItemLabel(index),
        subtitle: '',
        verdict: '',
        media: [{ path: item, label: copy.verificationSingleLabel }],
        metrics: [],
        notes: '',
      };
    }
    const media = Array.isArray(item.media) && item.media.length > 0
      ? item.media
      : (item.path ? [{ path: item.path, label: item.mediaLabel ?? item.label ?? copy.verificationMediaLabel(index) }] : []);
    return {
      label: String(item.label ?? item.title ?? copy.verificationItemLabel(index)),
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
    { input: labelSvg(comparison.leftLabel, { maxWidth: Math.max(32, referencePanel.width - 32) }), left: referenceLeft + 16, top: referenceTop + 16 },
    { input: labelSvg(comparison.rightLabel, { maxWidth: Math.max(32, actualPanel.width - 32) }), left: actualLeft + 16, top: actualTop + 16 },
  ]);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await encodePipeline(canvas, format, quality).toFile(outputPath);
  const metadataPath = metadataPathForOutput(outputPath);
  const reviewArtifact = {
    version: 1,
    schema: VISUAL_REVIEW_SCHEMA,
    generatedAt: timestamp(),
    mode: comparison.mode,
    locale: comparison.locale,
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
  const locale = localeFromOptions(options);
  const copy = visualCopyForLocale(locale);
  const format = normalizeFormat(options.format, options.out);
  const outputPath = options.out
    ? path.resolve(projectRoot, options.out)
    : defaultOutputPath(projectRoot, format, 'focus-board');
  const quality = parseQuality(options.quality);
  const maxPanelWidth = parsePositiveInteger(options.maxPanelWidth, DEFAULT_PANEL_WIDTH, '--max-panel-width');
  const leftSpec = normalizeImageSpec(projectRoot, board.payload.left ?? board.payload.reference, board.payload.leftLabel ?? copy.referenceLabel);
  const rightSpec = normalizeImageSpec(projectRoot, board.payload.right ?? board.payload.actual, board.payload.rightLabel ?? copy.actualLabel);
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
    String(board.payload.title ?? copy.focusTitle),
    String(board.payload.summary ?? copy.focusSummary),
    copy.focusEyebrow,
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
    { input: labelSvg(leftSpec.label, { maxWidth: Math.max(32, leftPanel.width - 32) }), left: leftOverviewX + 16, top: leftOverviewY + 16 },
    { input: labelSvg(rightSpec.label, { maxWidth: Math.max(32, rightPanel.width - 32) }), left: rightOverviewX + 16, top: rightOverviewY + 16 },
  ];

  const metadataRegions = [];
  const leftOverlayRegions = [];
  const rightOverlayRegions = [];
  let currentTop = overviewTop + overviewHeight + sectionGap;

  for (const [index, region] of focusRegions.entries()) {
    const label = String(region.label ?? region.name ?? copy.focusRegionLabel(index));
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
      { input: labelSvg(leftSpec.label, { fontSize: 18, height: 40, minWidth: 112, maxWidth: Math.max(32, leftCrop.width - 24) }), left: leftCropX + 12, top: leftCropY + 12 },
      { input: labelSvg(rightSpec.label, { fontSize: 18, height: 40, minWidth: 112, maxWidth: Math.max(32, rightCrop.width - 24) }), left: rightCropX + 12, top: rightCropY + 12 },
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
    locale,
    outputPath: toWorkspacePath(projectRoot, outputPath),
    format,
    boardSource: toWorkspacePath(projectRoot, board.sourcePath),
    title: String(board.payload.title ?? copy.focusTitle),
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
    nextActions: copy.focusNextActions,
  };
}

async function renderParallelCard(projectRoot, item, index, options = {}) {
  const cardWidth = options.cardWidth;
  const locale = localeFromOptions(options);
  const copy = visualCopyForLocale(locale);
  const contentWidth = cardWidth - 36;
  const title = String(item.label ?? item.title ?? copy.parallelItemLabel(index));
  const subtitle = String(item.subtitle ?? item.summary ?? '').trim();
  const verdict = String(item.verdict ?? '').trim();
  const mediaList = normalizeMediaList(projectRoot, item.media, locale);
  const metrics = normalizeMetricList(item.metrics ?? item.metricMap, locale);
  const notes = String(item.notes ?? item.note ?? '').trim();
  const header = titleBlockSvg(
    contentWidth,
    `${index + 1}. ${title}`,
    subtitle,
    verdict ? `${copy.resultPrefix}${copy.separator}${verdict}` : (options.eyebrow ?? copy.parallelEyebrow),
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
      maxWidth: contentWidth,
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

  const metricsBlock = metricsSvg(contentWidth, metrics, notes, locale);
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
      level: item.level ?? '',
      levelLabel: item.levelLabel ?? '',
      verdict,
      metrics,
      notes,
      media: renderedMedia,
    },
  };
}

async function renderParallelBoard(projectRoot, board, options = {}) {
  const locale = localeFromOptions(options);
  const copy = visualCopyForLocale(locale);
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
    String(board.payload.title ?? copy.parallelTitle),
    String(board.payload.summary ?? copy.parallelSummary),
    copy.parallelEyebrow,
  );

  const renderedCards = [];
  for (const [index, item] of items.entries()) {
    renderedCards.push(await renderParallelCard(projectRoot, item, index, { cardWidth, locale }));
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
    locale,
    outputPath: toWorkspacePath(projectRoot, outputPath),
    format,
    boardSource: toWorkspacePath(projectRoot, board.sourcePath),
    title: String(board.payload.title ?? copy.parallelTitle),
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
    nextActions: copy.parallelNextActions,
  };
}

async function renderVerificationBoard(projectRoot, board, options = {}) {
  const locale = localeFromOptions(options);
  const copy = visualCopyForLocale(locale);
  const format = normalizeFormat(options.format, options.out);
  const outputPath = options.out
    ? path.resolve(projectRoot, options.out)
    : defaultOutputPath(projectRoot, format, 'verification-board');
  const quality = parseQuality(options.quality);
  const items = normalizeVerificationItems(projectRoot, board.payload, locale);
  if (items.length === 0) {
    throw new Error('Verification board requires screenshots, items, or a single screenshot/path entry.');
  }
  const cardWidth = parsePositiveInteger(board.payload.cardWidth ?? options.maxPanelWidth, DEFAULT_PARALLEL_CARD_WIDTH, 'cardWidth');
  const columns = Math.max(1, Math.min(parsePositiveInteger(board.payload.columns, Math.min(DEFAULT_PARALLEL_COLUMNS, items.length), 'columns'), 4));
  const margin = 24;
  const gap = 24;
  const route = String(board.payload.route ?? board.payload.flow ?? board.payload.method ?? '').trim();
  const summary = String(board.payload.summary ?? copy.verificationSummary(route));
  const titleBlock = titleBlockSvg(
    columns * cardWidth + (columns - 1) * gap,
    String(board.payload.title ?? copy.verificationTitle),
    summary,
    copy.verificationEyebrow,
  );

  const renderedCards = [];
  for (const [index, item] of items.entries()) {
    renderedCards.push(await renderParallelCard(projectRoot, item, index, {
      cardWidth,
      eyebrow: copy.verificationCardEyebrow,
      locale,
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
    locale,
    outputPath: toWorkspacePath(projectRoot, outputPath),
    format,
    boardSource: toWorkspacePath(projectRoot, board.sourcePath),
    title: String(board.payload.title ?? copy.verificationTitle),
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
    nextActions: copy.verificationNextActions,
  };
}

function normalizeAlignmentGroups(payload, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  const groupEntries = normalizeAlignmentGroupEntries(payload);
  const defaultThreshold = payload.thresholdPx ?? payload.threshold ?? 2;
  return groupEntries.map(({ group, fallbackLevel }, index) => {
    const threshold = group.thresholdPx ?? group.threshold ?? defaultThreshold;
    const metrics = normalizeAlignmentMetrics(group.metrics ?? group.measurements ?? group.checks, threshold, locale);
    const expected = String(group.expected ?? group.expectation ?? '').trim();
    const pattern = String(group.pattern ?? group.structure ?? '').trim();
    const level = normalizeAlignmentLevel(group.level ?? group.kind ?? group.type ?? group.scopeKind)
      ?? fallbackLevel
      ?? inferAlignmentLevel([group.label, group.title, group.subtitle, group.scope, pattern, expected, ...metrics.map((metric) => metric.label)].join(' '));
    const levelLabel = alignmentLevelLabel(level, locale);
    const notes = [
      expected ? `${copy.alignmentExpectedPrefix}${copy.separator}${expected}` : '',
      pattern ? `${copy.alignmentStructurePrefix}${copy.separator}${pattern}` : '',
      String(group.notes ?? group.note ?? '').trim(),
    ].filter(Boolean).join('\n');
    const subtitle = [
      levelLabel,
      String(group.subtitle ?? group.scope ?? group.selector ?? '').trim(),
    ].filter(Boolean).join(' / ');
    return {
      label: String(group.label ?? group.title ?? copy.alignmentGroupLabel(index)),
      subtitle,
      level,
      levelLabel,
      verdict: String(group.verdict ?? group.status ?? '').trim(),
      metrics,
      notes,
    };
  });
}

function normalizeAlignmentGroupEntries(payload) {
  const entries = [];
  const add = (groups, fallbackLevel) => {
    if (!Array.isArray(groups)) {
      return;
    }
    for (const group of groups) {
      if (group) {
        entries.push({ group, fallbackLevel });
      }
    }
  };
  if (Array.isArray(payload.groups)) {
    add(payload.groups, null);
  } else {
    add(payload.items, null);
  }
  add(payload.containerGroups ?? payload.containerTracks, 'container');
  add(payload.contentSlots ?? payload.slotGroups ?? payload.contentSlotGroups ?? payload.internalSlots, 'content-slot');
  return entries;
}

function normalizeAlignmentLevel(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (['container', 'outer', 'outer-frame', 'frame', 'grid', '容器', '外框', '网格'].includes(normalized)) {
    return 'container';
  }
  if (['content', 'content-slot', 'internal', 'internal-slot', 'slot', 'same-slot', '内容', '内容槽位', '内部槽位', '槽位'].includes(normalized)) {
    return 'content-slot';
  }
  return null;
}

function alignmentLevelLabel(level, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  if (level === 'container') {
    return copy.alignmentContainerLevel;
  }
  if (level === 'content-slot') {
    return copy.alignmentContentSlotLevel;
  }
  return '';
}

function inferAlignmentLevel(text) {
  const normalized = String(text ?? '').toLowerCase();
  if (ALIGNMENT_CONTENT_SLOT_TOKENS.some((token) => normalized.includes(String(token).toLowerCase()))) {
    return 'content-slot';
  }
  if (ALIGNMENT_CONTAINER_TOKENS.some((token) => normalized.includes(String(token).toLowerCase()))) {
    return 'container';
  }
  return 'custom';
}

function summarizeAlignmentScope(groups) {
  return {
    containerGroups: groups.filter((group) => group.level === 'container').map((group) => group.label),
    contentSlotGroups: groups.filter((group) => group.level === 'content-slot').map((group) => group.label),
  };
}

function normalizeAlignmentMetrics(metrics, threshold, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  if (!Array.isArray(metrics)) {
    return normalizeMetricList(metrics, locale);
  }
  return metrics
    .filter(Boolean)
    .flatMap((metric) => {
      if (typeof metric === 'string') {
        return [{ label: copy.metricTextLabel, value: metric }];
      }
      const label = String(metric.label ?? metric.name ?? metric.key ?? copy.alignmentItemLabel);
      const values = Array.isArray(metric.values)
        ? metric.values.map((value) => Number(value)).filter((value) => Number.isFinite(value))
        : [];
      const metricThreshold = metric.thresholdPx ?? metric.threshold ?? threshold;
      const spread = metric.spreadPx ?? metric.spread ?? (
        values.length > 0 ? Math.max(...values) - Math.min(...values) : null
      );
      const parts = [];
      if (values.length > 0) {
        parts.push(`${values.join(', ')}px`);
      } else if (metric.value !== null && metric.value !== undefined) {
        parts.push(String(metric.value));
      }
      if (spread !== null && spread !== undefined && spread !== '') {
        const verdict = metric.verdict ?? metric.status ?? (
          Number(spread) <= Number(metricThreshold) ? copy.passVerdict : copy.reworkVerdict
        );
        parts.push(`spread=${spread}px`);
        if (metricThreshold !== null && metricThreshold !== undefined && metricThreshold !== '') {
          parts.push(`${copy.alignmentThresholdLabel}=${metricThreshold}px`);
        }
        parts.push(String(verdict));
      }
      return [{
        label,
        value: parts.filter(Boolean).join(' / '),
      }];
    })
    .filter((metric) => metric.value.trim());
}

function normalizeAlignmentGuides(payload, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  const rawGuides = Array.isArray(payload.guides)
    ? payload.guides
    : (Array.isArray(payload.lines) ? payload.lines : []);
  return rawGuides
    .filter(Boolean)
    .map((guide, index) => ({
      ...guide,
      label: String(guide.label ?? guide.name ?? copy.alignmentGuideLabel(index)),
      color: String(guide.color ?? FOCUS_COLORS[index % FOCUS_COLORS.length]),
    }));
}

function normalizeAlignmentBoxes(payload, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  const rawBoxes = Array.isArray(payload.boxes)
    ? payload.boxes
    : (Array.isArray(payload.regions) ? payload.regions : []);
  return rawBoxes
    .filter(Boolean)
    .map((box, index) => ({
      ...box,
      label: String(box.label ?? box.name ?? copy.alignmentRegionLabel(index)),
      color: String(box.color ?? FOCUS_COLORS[index % FOCUS_COLORS.length]),
    }));
}

function resolveGuideAxis(guide) {
  const raw = String(guide.axis ?? guide.orientation ?? '').trim().toLowerCase();
  if (['x', 'vertical', 'v', 'left', 'right', 'column'].includes(raw)) {
    return 'x';
  }
  if (['y', 'horizontal', 'h', 'top', 'bottom', 'row', 'baseline'].includes(raw)) {
    return 'y';
  }
  if (guide.x !== null && guide.x !== undefined) {
    return 'x';
  }
  return 'y';
}

function resolveGuidePosition(guide, axis, original) {
  const raw = guide.position ?? guide.value ?? (axis === 'x' ? (guide.x ?? guide.left) : (guide.y ?? guide.top));
  if (raw === null || raw === undefined || raw === '') {
    throw new Error(`Alignment guide "${guide.label}" is missing position.`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Alignment guide "${guide.label}" has invalid position.`);
  }
  const max = axis === 'x' ? original.width : original.height;
  const unit = String(guide.unit ?? 'px').trim().toLowerCase();
  if (unit === 'ratio') {
    return Math.round(value * max);
  }
  if (unit === 'percent') {
    return Math.round((value / 100) * max);
  }
  return Math.round(value);
}

function alignmentGuideOverlaySvg(panel, payload, locale = OPENPRD_FALLBACK_LOCALE) {
  const guides = normalizeAlignmentGuides(payload, locale);
  const boxes = normalizeAlignmentBoxes(payload, locale);
  const guideSvg = guides.map((guide, index) => {
    const axis = resolveGuideAxis(guide);
    const absolute = resolveGuidePosition(guide, axis, panel.original);
    const color = escapeXml(guide.color);
    const label = escapeXml(guide.label);
    if (axis === 'x') {
      const x = Math.round(absolute * (panel.width / panel.original.width));
      const labelY = 28 + (index % 5) * 28;
      return `
        <line x1="${x}" y1="0" x2="${x}" y2="${panel.height}" stroke="${color}" stroke-width="2.5" stroke-dasharray="10 8"/>
        <rect x="${Math.min(Math.max(x + 8, 8), Math.max(8, panel.width - 160))}" y="${labelY - 20}" width="148" height="24" rx="12" fill="#0f172a" fill-opacity="0.82"/>
        <text x="${Math.min(Math.max(x + 18, 18), Math.max(18, panel.width - 150))}" y="${labelY - 4}" fill="${color}" font-size="14" font-weight="800" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, Arial Unicode MS, sans-serif">${label}: x=${absolute}</text>
      `;
    }
    const y = Math.round(absolute * (panel.height / panel.original.height));
    const labelX = 14 + (index % 3) * 164;
    return `
      <line x1="0" y1="${y}" x2="${panel.width}" y2="${y}" stroke="${color}" stroke-width="2.5" stroke-dasharray="10 8"/>
      <rect x="${labelX}" y="${Math.max(8, y - 30)}" width="154" height="24" rx="12" fill="#0f172a" fill-opacity="0.82"/>
      <text x="${labelX + 10}" y="${Math.max(24, y - 14)}" fill="${color}" font-size="14" font-weight="800" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, Arial Unicode MS, sans-serif">${label}: y=${absolute}</text>
    `;
  }).join('');
  const boxSvg = boxes.map((box, index) => {
    const resolved = resolveCropBox(box.box ?? box, panel.original);
    const rendered = renderedBoxFromAbsolute(resolved.absolute, panel);
    const color = escapeXml(box.color);
    const label = escapeXml(box.label);
    const badgeY = Math.max(10, rendered.y + 10);
    const badgeX = Math.max(10, rendered.x + 10);
    return `
      <rect x="${rendered.x}" y="${rendered.y}" width="${rendered.width}" height="${rendered.height}" rx="12" fill="none" stroke="${color}" stroke-width="3"/>
      <rect x="${badgeX}" y="${badgeY}" width="${Math.max(34, 24 + label.length * 14)}" height="28" rx="14" fill="${color}" fill-opacity="0.92"/>
      <text x="${badgeX + 10}" y="${badgeY + 19}" fill="#0f172a" font-size="14" font-weight="800" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, Arial Unicode MS, sans-serif">${index + 1}. ${label}</text>
    `;
  }).join('');
  return Buffer.from(`
<svg width="${panel.width}" height="${panel.height}" viewBox="0 0 ${panel.width} ${panel.height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${panel.width}" height="${panel.height}" fill="#020617" fill-opacity="0.08"/>
  ${guideSvg}
  ${boxSvg}
</svg>`);
}

async function createAlignmentOverlayPanel(basePanel, payload, locale = OPENPRD_FALLBACK_LOCALE) {
  const overlay = alignmentGuideOverlaySvg(basePanel, payload, locale);
  const input = await sharp(basePanel.input)
    .composite([{ input: overlay, left: 0, top: 0 }])
    .png()
    .toBuffer();
  return {
    ...basePanel,
    input,
  };
}

function round1(value) {
  const rounded = Math.round(Number(value) * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatSignedPx(value) {
  const rounded = round1(value);
  return `${rounded >= 0 ? '+' : ''}${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}px`;
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function colorDistance(r, g, b, color) {
  return Math.sqrt(
    ((r - color.r) ** 2)
    + ((g - color.g) ** 2)
    + ((b - color.b) ** 2),
  );
}

function parseChannelRange(range, key) {
  const raw = range?.[key];
  if (raw === null || raw === undefined || raw === '') {
    return [key === 'a' ? 1 : 0, 255];
  }
  if (Array.isArray(raw)) {
    return [
      Math.max(0, Math.min(255, Number(raw[0] ?? 0))),
      Math.max(0, Math.min(255, Number(raw[1] ?? 255))),
    ];
  }
  if (typeof raw === 'object') {
    return [
      Math.max(0, Math.min(255, Number(raw.min ?? raw.from ?? 0))),
      Math.max(0, Math.min(255, Number(raw.max ?? raw.to ?? 255))),
    ];
  }
  const value = Math.max(0, Math.min(255, Number(raw)));
  return [value, value];
}

function pixelInRange(r, g, b, a, range) {
  const [rMin, rMax] = parseChannelRange(range, 'r');
  const [gMin, gMax] = parseChannelRange(range, 'g');
  const [bMin, bMax] = parseChannelRange(range, 'b');
  const [aMin, aMax] = parseChannelRange(range, 'a');
  return r >= rMin && r <= rMax
    && g >= gMin && g <= gMax
    && b >= bMin && b <= bMax
    && a >= aMin && a <= aMax;
}

function parseColorSpec(value, fallbackTolerance) {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    const hex = value.trim().replace(/^#/u, '');
    if (/^[0-9a-f]{6}$/iu.test(hex)) {
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
        tolerance: fallbackTolerance,
      };
    }
    return null;
  }
  if (typeof value !== 'object') {
    return null;
  }
  const fromHex = parseColorSpec(value.hex ?? value.color, fallbackTolerance);
  if (fromHex) {
    return {
      ...fromHex,
      tolerance: Number(value.tolerance ?? value.threshold ?? fallbackTolerance),
    };
  }
  const r = Number(value.r);
  const g = Number(value.g);
  const b = Number(value.b);
  if (![r, g, b].every(Number.isFinite)) {
    return null;
  }
  return {
    r: Math.max(0, Math.min(255, r)),
    g: Math.max(0, Math.min(255, g)),
    b: Math.max(0, Math.min(255, b)),
    tolerance: Number(value.tolerance ?? value.threshold ?? fallbackTolerance),
  };
}

function normalizeColorSpecs(subject, fallbackTolerance) {
  const raw = subject.colors ?? subject.color ?? subject.includeColors;
  const entries = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return entries
    .map((entry) => parseColorSpec(entry, fallbackTolerance))
    .filter(Boolean);
}

function normalizeCenteringSubject(payload) {
  const subject = (payload.subject && typeof payload.subject === 'object')
    ? payload.subject
    : ((payload.mask && typeof payload.mask === 'object') ? payload.mask : {});
  const mode = String(subject.mode ?? payload.maskMode ?? 'auto').trim().toLowerCase();
  const colorDistanceThreshold = Number(subject.colorDistanceThreshold ?? subject.colorThreshold ?? payload.colorDistanceThreshold ?? 28);
  const lumaThreshold = Number(subject.lumaThreshold ?? payload.lumaThreshold ?? 22);
  return {
    mode: ['alpha', 'range', 'ranges', 'color', 'colors'].includes(mode)
      ? (mode === 'ranges' ? 'range' : (mode === 'colors' ? 'color' : mode))
      : 'auto',
    alphaThreshold: Number(subject.alphaThreshold ?? payload.alphaThreshold ?? 8),
    colorDistanceThreshold,
    lumaThreshold,
    weight: String(subject.weight ?? payload.weight ?? 'contrast').trim().toLowerCase(),
    ranges: Array.isArray(subject.ranges ?? subject.include)
      ? (subject.ranges ?? subject.include)
      : (subject.range ? [subject.range] : []),
    colors: normalizeColorSpecs(subject, colorDistanceThreshold),
  };
}

function estimateCornerBackground(data, width, height, channels) {
  const sample = Math.max(2, Math.min(12, Math.floor(Math.min(width, height) * 0.06)));
  const points = [];
  for (const yStart of [0, Math.max(0, height - sample)]) {
    for (const xStart of [0, Math.max(0, width - sample)]) {
      for (let y = yStart; y < Math.min(height, yStart + sample); y += 1) {
        for (let x = xStart; x < Math.min(width, xStart + sample); x += 1) {
          points.push((y * width + x) * channels);
        }
      }
    }
  }
  const totals = { r: 0, g: 0, b: 0, a: 0 };
  for (const index of points) {
    totals.r += data[index];
    totals.g += data[index + 1];
    totals.b += data[index + 2];
    totals.a += data[index + 3] ?? 255;
  }
  const count = Math.max(points.length, 1);
  return {
    r: totals.r / count,
    g: totals.g / count,
    b: totals.b / count,
    a: totals.a / count,
  };
}

function centerPoint(width, height) {
  return {
    x: width / 2,
    y: height / 2,
  };
}

function centeringPixelActive(r, g, b, a, subject, background) {
  if (a <= subject.alphaThreshold) {
    return false;
  }
  if (subject.mode === 'alpha') {
    return true;
  }
  if (subject.mode === 'range') {
    return subject.ranges.some((range) => pixelInRange(r, g, b, a, range));
  }
  if (subject.mode === 'color') {
    return subject.colors.some((color) => colorDistance(r, g, b, color) <= color.tolerance);
  }
  if (background.a <= subject.alphaThreshold) {
    return true;
  }
  return colorDistance(r, g, b, background) >= subject.colorDistanceThreshold
    || Math.abs(luminance(r, g, b) - luminance(background.r, background.g, background.b)) >= subject.lumaThreshold;
}

function centeringPixelWeight(r, g, b, a, subject, background) {
  if (subject.weight === 'presence') {
    return 1;
  }
  if (subject.weight === 'alpha') {
    return Math.max(a / 255, 0.01);
  }
  if (subject.weight === 'luma') {
    return Math.max(luminance(r, g, b) / 255, 0.01);
  }
  return Math.max(colorDistance(r, g, b, background), 1);
}

async function loadCenteringRaw(sourcePath, box) {
  const { data, info } = await sharp(sourcePath)
    .rotate()
    .extract({
      left: box.x,
      top: box.y,
      width: box.width,
      height: box.height,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
}

async function extractCenteringTargetPanel(inputPath, box, outputWidth, sourceOriginal) {
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
      withoutEnlargement: true,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    input: data,
    width: info.width,
    height: info.height,
    source,
    absolute: box,
    original: {
      width: box.width,
      height: box.height,
      sourceWidth: sourceOriginal.width,
      sourceHeight: sourceOriginal.height,
      format: sourceOriginal.format ?? null,
    },
  };
}

async function analyzeCenteringTarget(sourcePath, box, payload, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  const raw = await loadCenteringRaw(sourcePath, box);
  const subject = normalizeCenteringSubject(payload);
  if (subject.mode === 'range' && subject.ranges.length === 0) {
    throw new Error('Centering board subject.mode=range requires subject.ranges or subject.include.');
  }
  if (subject.mode === 'color' && subject.colors.length === 0) {
    throw new Error('Centering board subject.mode=color requires subject.colors or subject.color.');
  }
  const background = estimateCornerBackground(raw.data, raw.width, raw.height, raw.channels);
  let minX = raw.width;
  let minY = raw.height;
  let maxX = -1;
  let maxY = -1;
  let activePixelCount = 0;
  let weightSum = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (let y = 0; y < raw.height; y += 1) {
    for (let x = 0; x < raw.width; x += 1) {
      const index = (y * raw.width + x) * raw.channels;
      const r = raw.data[index];
      const g = raw.data[index + 1];
      const b = raw.data[index + 2];
      const a = raw.data[index + 3] ?? 255;
      if (!centeringPixelActive(r, g, b, a, subject, background)) {
        continue;
      }
      activePixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const weight = centeringPixelWeight(r, g, b, a, subject, background);
      weightSum += weight;
      weightedX += (x + 0.5) * weight;
      weightedY += (y + 0.5) * weight;
    }
  }

  if (activePixelCount === 0) {
    throw new Error('Centering board could not isolate active subject pixels. Use subject.mode=range or subject.mode=color with explicit ranges/colors.');
  }

  const bounds = {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
  const canvasCenter = centerPoint(raw.width, raw.height);
  const bboxCenter = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const visualCentroid = {
    x: weightedX / Math.max(weightSum, 1),
    y: weightedY / Math.max(weightSum, 1),
  };
  const bboxCenterOffset = {
    x: round1(bboxCenter.x - canvasCenter.x),
    y: round1(bboxCenter.y - canvasCenter.y),
  };
  const visualCentroidOffset = {
    x: round1(visualCentroid.x - canvasCenter.x),
    y: round1(visualCentroid.y - canvasCenter.y),
  };
  const thresholdPx = Number(payload.thresholdPx ?? payload.threshold ?? 8);
  const maxAbsOffset = Math.max(
    Math.abs(bboxCenterOffset.x),
    Math.abs(bboxCenterOffset.y),
    Math.abs(visualCentroidOffset.x),
    Math.abs(visualCentroidOffset.y),
  );
  const passed = maxAbsOffset <= thresholdPx;
  return {
    thresholdPx,
    verdict: passed ? copy.passVerdict : copy.reworkVerdict,
    passed,
    maxAbsOffset: round1(maxAbsOffset),
    canvas: {
      width: raw.width,
      height: raw.height,
    },
    canvasCenter: {
      x: round1(canvasCenter.x),
      y: round1(canvasCenter.y),
    },
    activeBounds: bounds,
    bboxCenter: {
      x: round1(bboxCenter.x),
      y: round1(bboxCenter.y),
    },
    bboxCenterOffset,
    visualCentroid: {
      x: round1(visualCentroid.x),
      y: round1(visualCentroid.y),
    },
    visualCentroidOffset,
    activePixelCount,
    activePixelRatio: round1((activePixelCount / Math.max(raw.width * raw.height, 1)) * 100),
    subject: {
      mode: subject.mode,
      weight: subject.weight,
      alphaThreshold: subject.alphaThreshold,
      colorDistanceThreshold: subject.colorDistanceThreshold,
      lumaThreshold: subject.lumaThreshold,
      rangeCount: subject.ranges.length,
      colorCount: subject.colors.length,
    },
    background: {
      r: round1(background.r),
      g: round1(background.g),
      b: round1(background.b),
      a: round1(background.a),
    },
  };
}

function centeringOverlaySvg(panel, analysis, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  const scaleX = panel.width / analysis.canvas.width;
  const scaleY = panel.height / analysis.canvas.height;
  const centerX = round1(analysis.canvasCenter.x * scaleX);
  const centerY = round1(analysis.canvasCenter.y * scaleY);
  const bounds = {
    x: round1(analysis.activeBounds.x * scaleX),
    y: round1(analysis.activeBounds.y * scaleY),
    width: Math.max(2, round1(analysis.activeBounds.width * scaleX)),
    height: Math.max(2, round1(analysis.activeBounds.height * scaleY)),
  };
  const bboxCenterX = round1(analysis.bboxCenter.x * scaleX);
  const bboxCenterY = round1(analysis.bboxCenter.y * scaleY);
  const centroidX = round1(analysis.visualCentroid.x * scaleX);
  const centroidY = round1(analysis.visualCentroid.y * scaleY);
  const gridLines = [];
  for (const ratio of [0.25, 0.5, 0.75]) {
    const x = round1(panel.width * ratio);
    const y = round1(panel.height * ratio);
    gridLines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${panel.height}" stroke="#94a3b8" stroke-opacity="0.22" stroke-width="1"/>`);
    gridLines.push(`<line x1="0" y1="${y}" x2="${panel.width}" y2="${y}" stroke="#94a3b8" stroke-opacity="0.22" stroke-width="1"/>`);
  }
  const bboxText = `bbox ${formatSignedPx(analysis.bboxCenterOffset.x)}, ${formatSignedPx(analysis.bboxCenterOffset.y)}`;
  const centroidText = `${copy.centeringCentroidLabel} ${formatSignedPx(analysis.visualCentroidOffset.x)}, ${formatSignedPx(analysis.visualCentroidOffset.y)}`;
  const badgeText = panel.width < 360 ? bboxText : `${bboxText} / ${centroidText}`;
  const badgeWidth = Math.max(24, Math.min(Math.max(24, panel.width - 24), Math.max(320, charCount(badgeText) * 13 + 32)));
  return Buffer.from(`
<svg width="${panel.width}" height="${panel.height}" viewBox="0 0 ${panel.width} ${panel.height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${panel.width}" height="${panel.height}" fill="#020617" fill-opacity="0.06"/>
  ${gridLines.join('')}
  <line x1="${centerX}" y1="0" x2="${centerX}" y2="${panel.height}" stroke="#ef4444" stroke-width="3" stroke-dasharray="12 8"/>
  <line x1="0" y1="${centerY}" x2="${panel.width}" y2="${centerY}" stroke="#ef4444" stroke-width="3" stroke-dasharray="12 8"/>
  <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" rx="8" fill="none" stroke="#22c55e" stroke-width="4"/>
  <line x1="${bboxCenterX - 16}" y1="${bboxCenterY}" x2="${bboxCenterX + 16}" y2="${bboxCenterY}" stroke="#22c55e" stroke-width="4"/>
  <line x1="${bboxCenterX}" y1="${bboxCenterY - 16}" x2="${bboxCenterX}" y2="${bboxCenterY + 16}" stroke="#22c55e" stroke-width="4"/>
  <circle cx="${centroidX}" cy="${centroidY}" r="9" fill="#facc15" stroke="#111827" stroke-width="3"/>
  <rect x="12" y="12" width="${badgeWidth}" height="34" rx="17" fill="#0f172a" fill-opacity="0.88"/>
  <text x="28" y="35" fill="#f8fafc" font-size="16" font-weight="800" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, Arial Unicode MS, sans-serif">${escapeXml(badgeText)}</text>
  <rect x="0.75" y="0.75" width="${panel.width - 1.5}" height="${panel.height - 1.5}" rx="12" fill="none" stroke="#475569" stroke-opacity="0.6" stroke-width="1.5"/>
</svg>`);
}

async function createCenteringOverlayPanel(targetPanel, analysis, locale = OPENPRD_FALLBACK_LOCALE) {
  const overlay = centeringOverlaySvg(targetPanel, analysis, locale);
  const input = await sharp(targetPanel.input)
    .composite([{ input: overlay, left: 0, top: 0 }])
    .png()
    .toBuffer();
  return {
    ...targetPanel,
    input,
  };
}

function normalizeCenteringTargetBox(rawBox, original) {
  if (!rawBox) {
    const width = Math.max(1, Math.round(original.width));
    const height = Math.max(1, Math.round(original.height));
    return {
      unit: 'px',
      requested: { x: 0, y: 0, width, height },
      absolute: { x: 0, y: 0, width, height },
    };
  }
  return resolveCropBox(rawBox, original);
}

async function renderCenteringBoard(projectRoot, board, options = {}) {
  const locale = localeFromOptions(options);
  const copy = visualCopyForLocale(locale);
  const format = normalizeFormat(options.format, options.out);
  const outputPath = options.out
    ? path.resolve(projectRoot, options.out)
    : defaultOutputPath(projectRoot, format, 'centering-board');
  const quality = parseQuality(options.quality);
  const maxPanelWidth = parsePositiveInteger(options.maxPanelWidth, DEFAULT_PANEL_WIDTH, '--max-panel-width');
  const rawImage = board.payload.image ?? board.payload.screenshot ?? board.payload.actual ?? board.payload.path;
  if (!rawImage) {
    throw new Error('Centering board requires image, screenshot, actual, or path.');
  }
  const imageSpec = normalizeImageSpec(
    projectRoot,
    rawImage,
    board.payload.imageLabel ?? board.payload.screenshotLabel ?? copy.centeringImageLabel,
  );
  const sourceMetadata = await sharp(imageSpec.path).metadata();
  if (!sourceMetadata.width || !sourceMetadata.height) {
    throw new Error(`Cannot read image dimensions: ${imageSpec.path}`);
  }
  const sourceOriginal = {
    width: sourceMetadata.width,
    height: sourceMetadata.height,
    format: sourceMetadata.format ?? null,
  };
  const targetBox = normalizeCenteringTargetBox(
    board.payload.targetBox ?? board.payload.box ?? board.payload.region,
    sourceOriginal,
  );
  const targetPanel = await extractCenteringTargetPanel(
    imageSpec.path,
    targetBox.absolute,
    maxPanelWidth,
    sourceOriginal,
  );
  const analysis = await analyzeCenteringTarget(imageSpec.path, targetBox.absolute, board.payload, locale);
  const overlayPanel = await createCenteringOverlayPanel(targetPanel, analysis, locale);
  const panelWidth = Math.min(maxPanelWidth, Math.max(targetPanel.width, overlayPanel.width, 180));
  const overviewHeight = Math.max(targetPanel.height, overlayPanel.height);
  const margin = 24;
  const gap = 24;
  const contentWidth = Math.max(560, margin * 2 + panelWidth * 2 + gap);
  const summary = String(board.payload.summary ?? copy.centeringSummary);
  const titleBlock = titleBlockSvg(
    contentWidth - margin * 2,
    String(board.payload.title ?? copy.centeringTitle),
    summary,
    copy.centeringEyebrow,
  );
  const targetX = margin + Math.round((panelWidth - targetPanel.width) / 2);
  const overlayX = margin + panelWidth + gap + Math.round((panelWidth - overlayPanel.width) / 2);
  const overviewTop = margin + titleBlock.height + 18;
  const targetY = overviewTop + Math.round((overviewHeight - targetPanel.height) / 2);
  const overlayY = overviewTop + Math.round((overviewHeight - overlayPanel.height) / 2);
  const metricsCard = await renderParallelCard(projectRoot, {
    label: copy.centeringMeasureLabel,
    subtitle: `${copy.centeringThresholdLabel} ${analysis.thresholdPx}px / ${analysis.verdict}`,
    verdict: analysis.verdict,
    metrics: [
      { label: copy.centeringCanvasSizeLabel, value: `${analysis.canvas.width}x${analysis.canvas.height}px` },
      { label: copy.centeringBoundsLabel, value: `x=${analysis.activeBounds.x}, y=${analysis.activeBounds.y}, ${analysis.activeBounds.width}x${analysis.activeBounds.height}px` },
      { label: copy.centeringBboxOffsetLabel, value: `${formatSignedPx(analysis.bboxCenterOffset.x)}, ${formatSignedPx(analysis.bboxCenterOffset.y)}` },
      { label: copy.centeringCentroidOffsetLabel, value: `${formatSignedPx(analysis.visualCentroidOffset.x)}, ${formatSignedPx(analysis.visualCentroidOffset.y)}` },
      { label: copy.centeringMaxOffsetLabel, value: `${analysis.maxAbsOffset}px` },
      { label: copy.centeringPixelRatioLabel, value: `${analysis.activePixelRatio}%` },
      { label: 'mask', value: `${analysis.subject.mode} / weight=${analysis.subject.weight}` },
    ],
    notes: copy.centeringNotes,
  }, 0, {
    cardWidth: Math.min(contentWidth - margin * 2, Math.max(560, panelWidth * 2 + gap)),
    eyebrow: copy.centeringMeasureEyebrow,
    locale,
  });
  const metricsTop = overviewTop + overviewHeight + 28;
  const composites = [
    { input: titleBlock.input, left: margin, top: margin },
    { input: targetPanel.input, left: targetX, top: targetY },
    { input: overlayPanel.input, left: overlayX, top: overlayY },
    {
      input: labelSvg(compactLabel(imageSpec.label), {
        fontSize: 14,
        height: 32,
        paddingX: 12,
        radius: 10,
        minWidth: 80,
        maxWidth: Math.max(32, targetPanel.width - 32),
      }),
      left: targetX + 16,
      top: targetY + 16,
    },
    { input: metricsCard.image, left: margin, top: metricsTop },
  ];
  const canvasHeight = metricsTop + metricsCard.height + margin;
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
    mode: 'centering-board',
    locale,
    outputPath: toWorkspacePath(projectRoot, outputPath),
    format,
    boardSource: toWorkspacePath(projectRoot, board.sourcePath),
    title: String(board.payload.title ?? copy.centeringTitle),
    labels: {
      image: imageSpec.label,
      overlay: copy.centeringOverlayLabel,
    },
    target: {
      path: toWorkspacePath(projectRoot, imageSpec.path),
      original: sourceOriginal,
      box: {
        unit: targetBox.unit,
        requested: targetBox.requested,
        absolute: targetBox.absolute,
      },
      rendered: {
        width: targetPanel.width,
        height: targetPanel.height,
      },
    },
    centering: analysis,
    canvas: {
      width: contentWidth,
      height: canvasHeight,
    },
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(reviewArtifact, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    action: 'visual-compare',
    mode: 'centering-board',
    projectRoot,
    outputPath,
    metadataPath,
    format,
    quality: format === 'png' ? null : quality,
    canvas: reviewArtifact.canvas,
    target: reviewArtifact.target,
    centering: analysis,
    reviewArtifact,
    nextActions: copy.centeringNextActions,
  };
}

async function renderAlignmentBoard(projectRoot, board, options = {}) {
  const locale = localeFromOptions(options);
  const copy = visualCopyForLocale(locale);
  const format = normalizeFormat(options.format, options.out);
  const outputPath = options.out
    ? path.resolve(projectRoot, options.out)
    : defaultOutputPath(projectRoot, format, 'alignment-board');
  const quality = parseQuality(options.quality);
  const maxPanelWidth = parsePositiveInteger(options.maxPanelWidth, DEFAULT_PANEL_WIDTH, '--max-panel-width');
  const rawScreenshot = board.payload.screenshot ?? board.payload.actual ?? board.payload.path;
  if (!rawScreenshot && !board.payload.overlay) {
    throw new Error('Alignment board requires screenshot, actual, path, or overlay image.');
  }
  const screenshotSpec = normalizeImageSpec(
    projectRoot,
    rawScreenshot ?? board.payload.overlay,
    board.payload.screenshotLabel ?? copy.alignmentScreenshotLabel,
  );
  const overlaySpec = board.payload.overlay
    ? normalizeImageSpec(projectRoot, board.payload.overlay, board.payload.overlayLabel ?? copy.alignmentOverlayLabel)
    : null;
  const screenshotPanel = await resizePanel(screenshotSpec.path, maxPanelWidth);
  const overlayPanel = overlaySpec
    ? await resizePanel(overlaySpec.path, maxPanelWidth)
    : await createAlignmentOverlayPanel(screenshotPanel, board.payload, locale);
  const panelWidth = Math.min(maxPanelWidth, Math.max(screenshotPanel.width, overlayPanel.width));
  const overviewHeight = Math.max(screenshotPanel.height, overlayPanel.height);
  const margin = 24;
  const gap = 24;
  const groups = normalizeAlignmentGroups(board.payload, locale);
  const cardWidth = parsePositiveInteger(board.payload.cardWidth ?? options.maxPanelWidth, DEFAULT_PARALLEL_CARD_WIDTH, 'cardWidth');
  const columns = Math.max(1, Math.min(parsePositiveInteger(board.payload.columns, Math.min(DEFAULT_PARALLEL_COLUMNS, Math.max(groups.length, 1)), 'columns'), 4));
  const contentWidth = Math.max(margin * 2 + panelWidth * 2 + gap, margin * 2 + columns * cardWidth + (columns - 1) * gap);
  const summary = String(board.payload.summary ?? copy.alignmentSummary);
  const titleBlock = titleBlockSvg(
    contentWidth - margin * 2,
    String(board.payload.title ?? copy.alignmentTitle),
    summary,
    copy.alignmentEyebrow,
  );
  const screenshotX = margin + Math.round((panelWidth - screenshotPanel.width) / 2);
  const overlayX = margin + panelWidth + gap + Math.round((panelWidth - overlayPanel.width) / 2);
  const overviewTop = margin + titleBlock.height + 18;
  const screenshotY = overviewTop + Math.round((overviewHeight - screenshotPanel.height) / 2);
  const overlayY = overviewTop + Math.round((overviewHeight - overlayPanel.height) / 2);
  const composites = [
    { input: titleBlock.input, left: margin, top: margin },
    { input: screenshotPanel.input, left: screenshotX, top: screenshotY },
    { input: overlayPanel.input, left: overlayX, top: overlayY },
    { input: labelSvg(screenshotSpec.label, { maxWidth: Math.max(32, screenshotPanel.width - 32) }), left: screenshotX + 16, top: screenshotY + 16 },
    { input: labelSvg(overlaySpec?.label ?? copy.alignmentOverlayLabel, { maxWidth: Math.max(32, overlayPanel.width - 32) }), left: overlayX + 16, top: overlayY + 16 },
  ];
  const renderedCards = [];
  for (const [index, group] of groups.entries()) {
    renderedCards.push(await renderParallelCard(projectRoot, group, index, {
      cardWidth,
      eyebrow: copy.alignmentMeasureEyebrow,
      locale,
    }));
  }
  const rowHeights = [];
  for (let index = 0; index < renderedCards.length; index += columns) {
    rowHeights.push(Math.max(...renderedCards.slice(index, index + columns).map((card) => card.height)));
  }
  let currentTop = overviewTop + overviewHeight + 28;
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
  const canvasHeight = currentTop + margin - (rowHeights.length > 0 ? gap : 0);
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
    mode: 'alignment-board',
    locale,
    outputPath: toWorkspacePath(projectRoot, outputPath),
    format,
    boardSource: toWorkspacePath(projectRoot, board.sourcePath),
    title: String(board.payload.title ?? copy.alignmentTitle),
    alignmentScope: summarizeAlignmentScope(renderedCards.map((card) => card.item)),
    labels: {
      screenshot: screenshotSpec.label,
      overlay: overlaySpec?.label ?? copy.alignmentOverlayLabel,
    },
    screenshot: {
      path: toWorkspacePath(projectRoot, screenshotPanel.source),
      original: screenshotPanel.original,
      rendered: {
        width: screenshotPanel.width,
        height: screenshotPanel.height,
      },
    },
    overlay: overlaySpec ? {
      path: toWorkspacePath(projectRoot, overlayPanel.source),
      original: overlayPanel.original,
      rendered: {
        width: overlayPanel.width,
        height: overlayPanel.height,
      },
    } : {
      generatedFrom: toWorkspacePath(projectRoot, screenshotPanel.source),
      guides: normalizeAlignmentGuides(board.payload, locale),
      boxes: normalizeAlignmentBoxes(board.payload, locale),
    },
    groups: renderedCards.map((card) => card.item),
    canvas: {
      width: contentWidth,
      height: canvasHeight,
    },
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(reviewArtifact, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    action: 'visual-compare',
    mode: 'alignment-board',
    projectRoot,
    outputPath,
    metadataPath,
    format,
    quality: format === 'png' ? null : quality,
    canvas: reviewArtifact.canvas,
    reviewArtifact,
    groups: reviewArtifact.groups,
    nextActions: copy.alignmentNextActions,
  };
}

async function visualCompareWorkspace(projectRoot, options = {}) {
  const request = resolveComparisonInputs(options);
  if (request.mode === 'board') {
    const board = await readBoardSpec(projectRoot, request.board);
    const locale = resolveBoardLocale(options, board.payload);
    validateBoardVisibleLanguage(board, locale);
    const renderOptions = { ...options, locale };
    if (board.mode === 'focus-board') {
      return renderFocusBoard(projectRoot, board, renderOptions);
    }
    if (board.mode === 'parallel-board') {
      return renderParallelBoard(projectRoot, board, renderOptions);
    }
    if (board.mode === 'verification-board') {
      return renderVerificationBoard(projectRoot, board, renderOptions);
    }
    if (board.mode === 'alignment-board') {
      return renderAlignmentBoard(projectRoot, board, renderOptions);
    }
    if (board.mode === 'centering-board') {
      return renderCenteringBoard(projectRoot, board, renderOptions);
    }
    throw new Error(`Unsupported board mode: ${board.mode}`);
  }
  return renderStandardComparison(projectRoot, request, options);
}

export { visualCompareWorkspace };
