import fs from 'node:fs/promises';
import path from 'node:path';
import { cjoin, exists, readJson } from './fs-utils.js';
import { buildCodeExtensionCandidate, observeGrowthWorkspace } from './growth.js';
import { recordKnowledgeReviewSignal, reviewKnowledgeWorkspace } from './knowledge.js';

const DEVELOPMENT_STANDARDS_CONFIG = cjoin('.openprd', 'standards', 'config.json');
const CODE_FILE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cjs',
  '.cpp',
  '.cs',
  '.css',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.mjs',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.swift',
  '.ts',
  '.tsx',
  '.vue',
]);
const EXEMPT_PATH_SEGMENTS = new Set([
  '.git',
  '.openprd',
  '.openspec',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  'coverage',
  'generated',
  '__fixtures__',
  'fixtures',
  'snapshots',
]);
const EXEMPT_FILE_PATTERNS = [
  /(^|\/)package-lock\.json$/i,
  /(^|\/)pnpm-lock\.yaml$/i,
  /(^|\/)yarn\.lock$/i,
  /(^|\/)bun\.lockb$/i,
  /\.min\.(js|css)$/i,
  /\.(generated|gen)\.[^.]+$/i,
  /\.snap$/i,
];

export const DEFAULT_DEVELOPMENT_STANDARDS = {
  codeFileLines: {
    enabled: true,
    okMax: 700,
    attentionMax: 1500,
    appliesTo: 'agent-touched-code-files',
  },
};

function normalizePathForReport(value) {
  return String(value ?? '').split(path.sep).join('/');
}

function countTextLines(text) {
  if (!text) return 0;
  const lineCount = text.split(/\r\n|\r|\n/).length;
  return /(\r\n|\r|\n)$/.test(text) ? lineCount - 1 : lineCount;
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
}

function normalizeExtension(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  return raw.startsWith('.') ? raw : `.${raw}`;
}

function compilePattern(value) {
  if (value instanceof RegExp) return value;
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    return new RegExp(raw, 'i');
  } catch {
    return null;
  }
}

function isCodeFile(relativePath, lineConfig) {
  return lineConfig.codeFileExtensions.has(path.extname(relativePath).toLowerCase());
}

function isExemptPath(relativePath, lineConfig) {
  const normalized = normalizePathForReport(relativePath);
  const segments = normalized.split('/').filter(Boolean);
  return segments.some((segment) => lineConfig.exemptPathSegments.has(segment))
    || lineConfig.exemptFilePatterns.some((pattern) => pattern.test(normalized));
}

function looksLikeCodeFile(relativePath, text) {
  const extension = path.extname(relativePath);
  if (!extension || !text.trim()) {
    return { match: false, confidence: 0, reason: 'no-extension-or-empty' };
  }
  const checks = [
    { pattern: /^#!.*\b(node|deno|python|ruby|bash|sh|zsh|perl|php)\b/m, weight: 0.9, reason: 'shebang' },
    { pattern: /^\s*(import|export)\s.+from\s+['"][^'"]+['"]/m, weight: 0.85, reason: 'module-import' },
    { pattern: /^\s*(const|let|var)\s+[A-Za-z_$][\w$]*\s*=/m, weight: 0.72, reason: 'variable-declaration' },
    { pattern: /^\s*(function|class|interface|type|enum)\s+[A-Za-z_$][\w$]*/m, weight: 0.78, reason: 'declaration' },
    { pattern: /^\s*(def|class)\s+[A-Za-z_][\w_]*\s*[\(:]/m, weight: 0.78, reason: 'python-declaration' },
    { pattern: /^\s*package\s+[A-Za-z_][\w.]*/m, weight: 0.78, reason: 'package-declaration' },
    { pattern: /<script\b[^>]*>[\s\S]{0,200}(import|export|const|let|function)\b/i, weight: 0.82, reason: 'script-block' },
    { pattern: /[{;}]\s*$/m, weight: 0.55, reason: 'code-punctuation' },
  ];
  let best = { match: false, confidence: 0, reason: 'no-code-signal' };
  for (const check of checks) {
    if (check.pattern.test(text) && check.weight > best.confidence) {
      best = { match: true, confidence: check.weight, reason: check.reason };
    }
  }
  return best;
}

function normalizeLineConfig(config = {}) {
  const source = config?.developmentStandards?.codeFileLines ?? config?.codeFileLines ?? {};
  const okMax = Number(source.okMax ?? DEFAULT_DEVELOPMENT_STANDARDS.codeFileLines.okMax);
  const attentionMax = Number(source.attentionMax ?? DEFAULT_DEVELOPMENT_STANDARDS.codeFileLines.attentionMax);
  const codeFileExtensions = new Set([
    ...CODE_FILE_EXTENSIONS,
    ...normalizeStringList(source.codeFileExtensions).map(normalizeExtension).filter(Boolean),
    ...normalizeStringList(source.additionalCodeFileExtensions).map(normalizeExtension).filter(Boolean),
  ]);
  const exemptPathSegments = new Set([
    ...EXEMPT_PATH_SEGMENTS,
    ...normalizeStringList(source.exemptPathSegments),
    ...normalizeStringList(source.additionalExemptPathSegments),
  ]);
  const customPatterns = [
    ...normalizeStringList(source.exemptFilePatterns),
    ...normalizeStringList(source.additionalExemptFilePatterns),
  ].map(compilePattern).filter(Boolean);
  return {
    enabled: source.enabled !== false,
    okMax: Number.isInteger(okMax) && okMax > 0 ? okMax : DEFAULT_DEVELOPMENT_STANDARDS.codeFileLines.okMax,
    attentionMax: Number.isInteger(attentionMax) && attentionMax > okMax
      ? attentionMax
      : DEFAULT_DEVELOPMENT_STANDARDS.codeFileLines.attentionMax,
    codeFileExtensions,
    exemptPathSegments,
    exemptFilePatterns: [...EXEMPT_FILE_PATTERNS, ...customPatterns],
    growthEnabled: config?.growth?.enabled !== false,
  };
}

export function validateDevelopmentStandardsConfig(config, errors = []) {
  const lineConfig = config?.developmentStandards?.codeFileLines;
  if (!lineConfig) return errors;
  const okMax = Number(lineConfig.okMax);
  const attentionMax = Number(lineConfig.attentionMax);
  if (!Number.isInteger(okMax) || okMax < 1) {
    errors.push(`${DEVELOPMENT_STANDARDS_CONFIG} developmentStandards.codeFileLines.okMax must be a positive integer.`);
  }
  if (!Number.isInteger(attentionMax) || attentionMax <= okMax) {
    errors.push(`${DEVELOPMENT_STANDARDS_CONFIG} developmentStandards.codeFileLines.attentionMax must be greater than okMax.`);
  }
  for (const field of ['codeFileExtensions', 'additionalCodeFileExtensions', 'exemptPathSegments', 'additionalExemptPathSegments', 'exemptFilePatterns', 'additionalExemptFilePatterns']) {
    if (lineConfig[field] !== undefined && !Array.isArray(lineConfig[field])) {
      errors.push(`${DEVELOPMENT_STANDARDS_CONFIG} developmentStandards.codeFileLines.${field} must be an array.`);
    }
  }
  for (const value of [
    ...normalizeStringList(lineConfig.exemptFilePatterns),
    ...normalizeStringList(lineConfig.additionalExemptFilePatterns),
  ]) {
    if (!compilePattern(value)) {
      errors.push(`${DEVELOPMENT_STANDARDS_CONFIG} developmentStandards.codeFileLines exempt file pattern is invalid: ${value}`);
    }
  }
  return errors;
}

async function readDevelopmentConfig(projectRoot) {
  const configPath = cjoin(projectRoot, DEVELOPMENT_STANDARDS_CONFIG);
  if (!(await exists(configPath))) {
    return {};
  }
  return readJson(configPath).catch(() => ({}));
}

function fileStatus(lineCount, lineConfig) {
  if (lineCount <= lineConfig.okMax) return 'ok';
  if (lineCount <= lineConfig.attentionMax) return 'attention';
  return 'warning';
}

function nextActionForStatus(status, lineConfig) {
  if (status === 'ok') {
    return `结构状态正常；最终回复中可简要说明 dev-check 已回顾 touched files。`;
  }
  if (status === 'attention') {
    return `最终回复说明本轮只触碰的局部职责和影响范围，避免继续新增无关职责。`;
  }
  if (status === 'warning') {
    return `判断本轮是否继续扩大职责或堆叠逻辑；若扩大了，先重构、拆分或解耦后复查；若只是窄 bugfix 或小修且暂不拆，说明原因并留下后续拆分建议。`;
  }
  if (status === 'exempt') {
    return `豁免治理；只记录行数，不要求拆分。`;
  }
  if (status === 'not-code') {
    return `不适用；研发期行数规则只约束代码文件。`;
  }
  return `无法检查；请确认文件路径。`;
}

async function analyzeDevelopmentFile(projectRoot, targetPath, lineConfig) {
  const absolutePath = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : cjoin(projectRoot, targetPath);
  const relativePath = normalizePathForReport(path.relative(projectRoot, absolutePath));

  if (!relativePath || relativePath.startsWith('..')) {
    return {
      path: targetPath,
      status: 'error',
      lineCount: null,
      nextAction: '文件必须位于当前项目内。',
      error: 'file-outside-project',
    };
  }

  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat) {
    return {
      path: relativePath,
      status: 'error',
      lineCount: null,
      nextAction: '文件不存在；请确认路径后重试。',
      error: 'file-missing',
    };
  }
  if (!stat.isFile()) {
    return {
      path: relativePath,
      status: 'error',
      lineCount: null,
      nextAction: '目标不是文件；请传入具体代码文件。',
      error: 'not-a-file',
    };
  }

  const text = await fs.readFile(absolutePath, 'utf8').catch(() => '');
  const lineCount = countTextLines(text);
  const codeFile = isCodeFile(relativePath, lineConfig);
  const exempt = isExemptPath(relativePath, lineConfig);
  const codeSignal = codeFile || exempt ? { match: false, confidence: 0, reason: null } : looksLikeCodeFile(relativePath, text);
  const candidateCode = !codeFile && !exempt && codeSignal.match;
  const status = exempt ? 'exempt' : (codeFile || candidateCode ? fileStatus(lineCount, lineConfig) : 'not-code');
  let growthCandidate = null;
  if (candidateCode) {
    growthCandidate = buildCodeExtensionCandidate(relativePath, {
      lineCount,
      confidence: codeSignal.confidence,
      reason: codeSignal.reason,
    });
    if (lineConfig.growthEnabled) {
      await observeGrowthWorkspace(projectRoot, growthCandidate);
    }
  }
  const baseAction = nextActionForStatus(status, lineConfig);
  const nextAction = growthCandidate
    ? `${baseAction} 另外：该扩展名尚未固化为代码文件规则，先按代码候选处理；运行 openprd grow . --review 审查，确认后执行 openprd grow . --apply --id ${growthCandidate.id}。`
    : baseAction;

  return {
    path: relativePath,
    absolutePath,
    status,
    fileKind: exempt ? 'exempt' : (codeFile ? 'code' : (candidateCode ? 'candidate-code' : 'non-code')),
    lineCount,
    sizeBytes: stat.size,
    thresholds: {
      okMax: lineConfig.okMax,
      attentionMax: lineConfig.attentionMax,
    },
    growthCandidate,
    nextAction,
  };
}

export async function checkDevelopmentStandardsWorkspace(projectRoot, options = {}) {
  const targets = Array.isArray(options.files) ? options.files.filter(Boolean) : [];
  const errors = [];
  if (targets.length === 0) {
    errors.push('No files provided. Usage: openprd dev-check [project] <file...>');
  }

  const config = await readDevelopmentConfig(projectRoot);
  const lineConfig = normalizeLineConfig(config);
  const files = [];
  if (lineConfig.enabled) {
    for (const target of targets) {
      files.push(await analyzeDevelopmentFile(projectRoot, target, lineConfig));
    }
  }

  const statusCounts = files.reduce((counts, file) => {
    counts[file.status] = (counts[file.status] ?? 0) + 1;
    return counts;
  }, {});
  errors.push(...files.filter((file) => file.status === 'error').map((file) => `${file.path}: ${file.nextAction}`));
  const touchedFiles = files
    .filter((file) => file.status !== 'error')
    .map((file) => file.path);
  const knowledgeSignal = {
    kind: 'dev-check',
    ok: errors.length === 0,
    summary: `dev-check attention=${statusCounts.attention ?? 0}, warning=${statusCounts.warning ?? 0}`,
    touchedFiles,
  };
  await recordKnowledgeReviewSignal(projectRoot, knowledgeSignal).catch(() => null);
  const knowledgeReview = await reviewKnowledgeWorkspace(projectRoot, {
    signal: knowledgeSignal,
    touchedFiles,
  }).catch((error) => ({
    ok: false,
    action: 'quality-knowledge-review',
    skipped: false,
    errors: [error instanceof Error ? error.message : String(error)],
  }));

  return {
    ok: errors.length === 0,
    action: 'dev-check',
    projectRoot,
    enabled: lineConfig.enabled,
    thresholds: {
      okMax: lineConfig.okMax,
      attentionMax: lineConfig.attentionMax,
      warningAbove: lineConfig.attentionMax,
    },
    summary: {
      total: files.length,
      statusCounts,
      attention: statusCounts.attention ?? 0,
      warning: statusCounts.warning ?? 0,
    },
    files,
    knowledgeReview,
    errors,
  };
}
