import fs from 'node:fs/promises';
import path from 'node:path';
import { cjoin, readJson } from './fs-utils.js';

const VISUAL_REVIEW_DIR = cjoin('.openprd', 'harness', 'visual-reviews');
const VISUAL_REVIEW_SCHEMA = 'openprd.visual-review.v1';
const VISUAL_REVIEW_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function normalizeWorkspacePath(value) {
  return String(value ?? '').split(path.sep).join('/');
}

function inferVisualReviewMode(value) {
  const normalized = normalizeWorkspacePath(value).toLowerCase();
  if (normalized.includes('visual-focus-board') || normalized.includes('focus-board') || normalized.includes('focus-region')) {
    return 'focus-board';
  }
  if (normalized.includes('visual-parallel-board') || normalized.includes('parallel-board') || normalized.includes('experiment-board')) {
    return 'parallel-board';
  }
  if (normalized.includes('visual-verification-board') || normalized.includes('verification-board') || normalized.includes('screenshot-evidence-board') || normalized.includes('screenshot-board')) {
    return 'verification-board';
  }
  if (normalized.includes('visual-alignment-board') || normalized.includes('alignment-board') || normalized.includes('grid-alignment')) {
    return 'alignment-board';
  }
  if (normalized.includes('visual-centering-board') || normalized.includes('centering-board') || normalized.includes('center-board')) {
    return 'centering-board';
  }
  if (normalized.includes('visual-before-after') || normalized.includes('before-after')) {
    return 'before-after';
  }
  if (normalized.includes('visual-compare') || normalized.includes('reference-actual')) {
    return 'reference-actual';
  }
  return null;
}

async function walkVisualReviewDir(projectRoot, dir, collected) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = cjoin(dir, entry.name);
    if (entry.isDirectory()) {
      await walkVisualReviewDir(projectRoot, fullPath, collected);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!VISUAL_REVIEW_IMAGE_EXTENSIONS.has(ext) && ext !== '.json') {
      continue;
    }
    const relativePath = normalizeWorkspacePath(path.relative(projectRoot, fullPath));
    collected.push({ fullPath, relativePath, ext });
  }
}

export async function listVisualReviewArtifacts(projectRoot) {
  const root = cjoin(projectRoot, VISUAL_REVIEW_DIR);
  const entries = [];
  await walkVisualReviewDir(projectRoot, root, entries);
  const artifactsByKey = new Map();

  for (const entry of entries) {
    if (entry.ext === '.json') {
      const payload = await readJson(entry.fullPath).catch(() => null);
      if (payload?.schema !== VISUAL_REVIEW_SCHEMA) {
        continue;
      }
      const key = normalizeWorkspacePath(String(payload.outputPath ?? entry.relativePath).replace(/\.[^.]+$/u, ''));
      const existing = artifactsByKey.get(key) ?? {};
      const outputPath = normalizeWorkspacePath(payload.outputPath ?? '');
      const inferredMode = payload.mode ?? inferVisualReviewMode(outputPath) ?? inferVisualReviewMode(entry.relativePath);
      if (!inferredMode) {
        continue;
      }
      const stat = await fs.stat(entry.fullPath).catch(() => null);
      artifactsByKey.set(key, {
        ...existing,
        path: outputPath || existing.path || entry.relativePath,
        metadataPath: entry.relativePath,
        mode: inferredMode,
        labels: payload.labels ?? existing.labels ?? null,
        alignmentScope: payload.alignmentScope ?? existing.alignmentScope ?? null,
        centering: payload.centering ?? existing.centering ?? null,
        groups: Array.isArray(payload.groups) ? payload.groups : (existing.groups ?? null),
        generatedAt: payload.generatedAt ?? existing.generatedAt ?? null,
        mtimeMs: stat?.mtimeMs ?? existing.mtimeMs ?? 0,
      });
      continue;
    }

    const key = entry.relativePath.replace(/\.[^.]+$/u, '');
    const existing = artifactsByKey.get(key) ?? {};
    const inferredMode = inferVisualReviewMode(entry.relativePath);
    if (!inferredMode) {
      continue;
    }
    const stat = await fs.stat(entry.fullPath).catch(() => null);
    artifactsByKey.set(key, {
      ...existing,
      path: entry.relativePath,
      mode: existing.mode ?? inferredMode,
      mtimeMs: stat?.mtimeMs ?? existing.mtimeMs ?? 0,
    });
  }

  return [...artifactsByKey.values()]
    .filter((artifact) => artifact.path && artifact.mode)
    .sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))
    .slice(0, 24);
}

export function detectVisualReview({ policy, activeChangeContext, activeTasks, visualArtifacts, includesAny }) {
  const relevant = policy.requiredGates.includes('visual-review');
  const haystack = [
    activeChangeContext.text,
    activeTasks.tasks.map((task) => [
      task.title,
      ...Object.entries(task.metadata ?? {}).map(([key, value]) => `${key}: ${value}`),
    ].join('\n')).join('\n'),
  ].join('\n');
  const referenceTokens = [
    'reference image',
    'reference design',
    'design reference',
    'effect image',
    'mockup',
    'figma',
    '效果图',
    '设计稿',
    '视觉稿',
    '参考图',
    '用户给图',
    '图片资产',
  ];
  const focusTokens = [
    'focus board',
    'focus region',
    'focus-region',
    'local compare',
    'zoom compare',
    '局部对比',
    '局部放大',
    '焦点区域',
    'focus',
  ];
  const parallelTokens = [
    'parallel board',
    'parallel experiment',
    'experiment board',
    '并行实验',
    '并行方向',
    '多方向实验',
    '方案对比板',
  ];
  const verificationTokens = [
    'verification board',
    'verification-board',
    'screenshot board',
    'screenshot-evidence-board',
    'visual-verification-board',
    'computer screenshot',
    'computer use screenshot',
    'browser screenshot',
    'playwright screenshot',
    'screencapture',
    '普通截图',
    '实测截图',
    '截图实测',
    '截图证据',
    '截图验收',
    'Computer 实测',
    'Browser 实测',
    '运行态截图',
  ];
  const alignmentTokens = [
    'alignment board',
    'alignment-board',
    'grid alignment',
    'grid-alignment',
    'baseline',
    'baseline spread',
    'same slot',
    'repeated card',
    'homogeneous card',
    'list card',
    'card grid',
    'table layout',
    '对齐辅助线',
    '辅助线',
    '网格对齐',
    '基线',
    '坐标偏差',
    '同构',
    '重复单元',
    '相同槽位',
    '相同文案类型',
    '列表卡片',
    '卡片列表',
    '卡片网格',
    '网格卡片',
    '网格列表',
    '列表网格',
    '表格',
    '排版对齐',
    '排版漂移',
    '布局漂移',
    '对齐有问题',
    '对齐问题',
    '对齐不准',
    '对不齐',
    '不对齐',
    '没有对齐',
    '没对齐',
    '左右偏差',
    '上下偏差',
    '横向偏差',
    '竖向偏差',
  ];
  const centeringTokens = [
    'centering board',
    'centering-board',
    'center board',
    'center-board',
    'visual-centering-board',
    'canvas center',
    'visual centroid',
    'bbox center',
    'bounding box center',
    'active bounds',
    'single element',
    'inside centered',
    'internal centering',
    'logo center',
    'logo centered',
    'logo internal',
    'icon center',
    'icon centered',
    'icon internal',
    'avatar center',
    'badge center',
    'button graphic',
    '内部居中',
    '内部不居中',
    '居中判定',
    '居中识别',
    '居中评估',
    '视觉重心',
    '主体外接框',
    '外接框中心',
    '画布中心',
    '单元素',
    '单个元素',
    '单一元素',
    '图标内部',
    '图片内部',
    '素材内部',
    '按钮图形',
    '偏心',
    '不居中',
    '没居中',
    '左偏',
    '右偏',
    '上飘',
    '下沉',
  ];
  const contentSlotAlignmentTokens = [
    'content slot',
    'internal slot',
    'same slot',
    'title slot',
    'price slot',
    'button slot',
    'card content',
    'repeated card',
    'homogeneous card',
    'list card',
    'card grid',
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
    '内容槽位',
    '内部槽位',
    '相同槽位',
    '相同文案类型',
    '相同组件槽位',
    '列表卡片',
    '卡片列表',
    '卡片网格',
    '网格卡片',
    '网格列表',
    '列表网格',
  ];
  const expectsReferenceCompare = includesAny(haystack, referenceTokens);
  const expectsFocusBoard = includesAny(haystack, focusTokens);
  const expectsParallelBoard = includesAny(haystack, parallelTokens);
  const expectsVerificationBoard = includesAny(haystack, verificationTokens);
  const expectsAlignmentBoard = includesAny(haystack, alignmentTokens);
  const expectsCenteringBoard = includesAny(haystack, centeringTokens);
  const expectsContentSlotAlignment = expectsAlignmentBoard && includesAny(haystack, contentSlotAlignmentTokens);
  const referenceArtifacts = visualArtifacts.filter((artifact) => artifact.mode === 'reference-actual');
  const beforeAfterArtifacts = visualArtifacts.filter((artifact) => artifact.mode === 'before-after');
  const focusArtifacts = visualArtifacts.filter((artifact) => artifact.mode === 'focus-board');
  const parallelArtifacts = visualArtifacts.filter((artifact) => artifact.mode === 'parallel-board');
  const verificationArtifacts = visualArtifacts.filter((artifact) => artifact.mode === 'verification-board');
  const alignmentArtifacts = visualArtifacts.filter((artifact) => artifact.mode === 'alignment-board');
  const centeringArtifacts = visualArtifacts.filter((artifact) => artifact.mode === 'centering-board');
  const contentSlotAlignmentArtifacts = alignmentArtifacts.filter(hasContentSlotAlignmentEvidence);
  let matchingArtifacts;
  if (expectsCenteringBoard) {
    matchingArtifacts = centeringArtifacts;
  } else if (expectsAlignmentBoard) {
    matchingArtifacts = alignmentArtifacts;
  } else if (expectsVerificationBoard) {
    matchingArtifacts = verificationArtifacts;
  } else if (expectsParallelBoard) {
    matchingArtifacts = parallelArtifacts;
  } else if (expectsFocusBoard) {
    matchingArtifacts = focusArtifacts;
  } else if (expectsReferenceCompare) {
    matchingArtifacts = referenceArtifacts;
  } else {
    matchingArtifacts = [...referenceArtifacts, ...beforeAfterArtifacts, ...focusArtifacts, ...parallelArtifacts, ...verificationArtifacts, ...alignmentArtifacts, ...centeringArtifacts];
  }
  const evidenceSources = matchingArtifacts.slice(0, 12).map((artifact) => ({
    path: artifact.path,
    source: artifact.mode === 'reference-actual'
      ? 'visual-review/reference-actual'
      : artifact.mode === 'before-after'
        ? 'visual-review/before-after'
        : artifact.mode === 'focus-board'
          ? 'visual-review/focus-board'
          : artifact.mode === 'parallel-board'
            ? 'visual-review/parallel-board'
            : artifact.mode === 'verification-board'
              ? 'visual-review/verification-board'
              : artifact.mode === 'alignment-board'
                ? 'visual-review/alignment-board'
                : 'visual-review/centering-board',
  }));
  const warnings = [];
  const missingContentSlotAlignment = relevant
    && expectsContentSlotAlignment
    && alignmentArtifacts.length > 0
    && contentSlotAlignmentArtifacts.length === 0;

  if (relevant && matchingArtifacts.length === 0) {
    warnings.push(
      expectsCenteringBoard
        ? '检测到 logo、图标、头像、徽标、图片或按钮图形等单个元素的内部居中/视觉重心语义，但未看到本次内部居中证据板。单张截图或主观“看起来居中”不能替代画布中心、主体外接框和视觉重心偏移量测。'
        : expectsAlignmentBoard
        ? '检测到同构列表、卡片、网格、表格或对齐反馈语义，但未看到本次对齐辅助线证据板。新功能开发中只要有重复同构单元，也应同时量测容器轨道和内部内容槽位的坐标偏差。'
        : expectsParallelBoard
        ? '检测到界面视觉改动且用户在比较多方向实验，但未看到本次并行实验证据板。'
        : expectsVerificationBoard
          ? '检测到普通截图、Computer/Browser 实测或运行态截图语义，但未看到本次截图实测证据板。普通截图只能作为原始素材，不能单独替代视觉收口拼图。'
          : expectsFocusBoard
          ? '检测到界面视觉改动且用户在关注局部细节，但未看到本次局部焦点证据板。'
          : expectsReferenceCompare
        ? '检测到界面视觉改动且已有参考图/设计稿语义，但未看到本次“效果图 / 实现截图”对比证据。'
        : '检测到界面视觉改动，但未看到本次 visual-compare 产出的视觉对比或修改前后自检证据。'
    );
  } else if (relevant && expectsReferenceCompare && referenceArtifacts.length === 0 && beforeAfterArtifacts.length > 0) {
    warnings.push('当前只发现修改前后自检图；如果已有参考图或设计稿，请补一份“效果图 / 实现截图”对比图。');
  } else if (relevant && expectsFocusBoard && focusArtifacts.length === 0 && matchingArtifacts.length > 0) {
    warnings.push('当前有视觉证据，但局部细节仍建议补一份局部焦点证据板，方便围绕编号区域复核。');
  } else if (relevant && expectsParallelBoard && parallelArtifacts.length === 0 && matchingArtifacts.length > 0) {
    warnings.push('当前有视觉证据，但多方向实验仍建议补一份并行实验证据板，把方案和指标放到同一板里审查。');
  } else if (relevant && expectsVerificationBoard && verificationArtifacts.length === 0 && matchingArtifacts.length > 0) {
    warnings.push('当前有视觉证据，但普通截图或 Computer 实测仍建议补一份截图实测证据板，把截图、实测路径和检查点拼到同一张图里。');
  } else if (relevant && expectsAlignmentBoard && alignmentArtifacts.length === 0 && matchingArtifacts.length > 0) {
    warnings.push('当前有视觉证据，但同构列表、卡片、网格或表格仍建议补一份对齐辅助线证据板，把相同槽位的 spread 放到同一张图里。');
  } else if (relevant && expectsCenteringBoard && centeringArtifacts.length === 0 && matchingArtifacts.length > 0) {
    warnings.push('当前有视觉证据，但单元素内部居中仍建议补一份内部居中证据板，把画布中心、主体外接框和视觉重心偏移放到同一张图里。');
  } else if (missingContentSlotAlignment) {
    warnings.push('当前只看到对齐辅助线证据板，但没有看到标题、副标题、描述、标签、状态、价格、按钮或图标等内部内容槽位量测。卡片/列表/网格不能只量外框、列宽或行顶。');
  }

  const summary = !relevant
    ? '当前场景未要求视觉评审证据'
    : matchingArtifacts.length > 0
        ? (
          missingContentSlotAlignment
            ? '已找到对齐辅助线证据板，但缺少内部内容槽位量测'
            : expectsCenteringBoard
            ? `已找到 ${matchingArtifacts.length} 份内部居中证据板`
            : expectsAlignmentBoard
            ? `已找到 ${matchingArtifacts.length} 份对齐辅助线证据板`
            : expectsParallelBoard
            ? `已找到 ${matchingArtifacts.length} 份并行实验证据板`
            : expectsVerificationBoard
              ? `已找到 ${matchingArtifacts.length} 份截图实测证据板`
              : expectsFocusBoard
              ? `已找到 ${matchingArtifacts.length} 份局部焦点证据板`
              : expectsReferenceCompare
            ? `已找到 ${matchingArtifacts.length} 份效果图 / 实现截图对比证据`
            : `已找到 ${matchingArtifacts.length} 份视觉对比、局部焦点、截图实测或修改前后自检证据`
        )
      : (
          expectsCenteringBoard
            ? '未找到本次内部居中证据板'
            : expectsAlignmentBoard
            ? '未找到本次对齐辅助线证据板'
            : expectsParallelBoard
            ? '未找到本次并行实验证据板'
            : expectsVerificationBoard
              ? '未找到本次截图实测证据板'
              : expectsFocusBoard
              ? '未找到本次局部焦点证据板'
              : expectsReferenceCompare
            ? '未找到本次效果图 / 实现截图对比证据'
            : '未找到本次 visual-compare 视觉证据'
        );

  return {
    status: !relevant || (matchingArtifacts.length > 0 && !missingContentSlotAlignment) ? 'pass' : 'needs-evidence',
    relevant,
    expectsReferenceCompare,
    expectsFocusBoard,
    expectsParallelBoard,
    expectsVerificationBoard,
    expectsAlignmentBoard,
    expectsCenteringBoard,
    expectsContentSlotAlignment,
    artifacts: visualArtifacts,
    matchingArtifacts,
    contentSlotAlignmentArtifacts,
    centeringArtifacts,
    warnings,
    evidence: {
      present: matchingArtifacts.length > 0,
      sources: evidenceSources,
      summary,
    },
  };
}

function hasContentSlotAlignmentEvidence(artifact) {
  const haystack = JSON.stringify([
    artifact.path,
    artifact.metadataPath,
    artifact.labels,
    artifact.alignmentScope,
    artifact.groups,
  ]).toLowerCase();
  return [
    'content-slot',
    'content slot',
    'internal slot',
    '内容槽位',
    '内部槽位',
    '相同槽位',
    '相同文案类型',
    '相同组件槽位',
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
  ].some((token) => haystack.includes(String(token).toLowerCase()));
}

export {
  VISUAL_REVIEW_DIR,
  VISUAL_REVIEW_SCHEMA,
};
