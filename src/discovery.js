import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzePrdSnapshot, buildPrdSnapshot, formatVersionId } from './prd-core.js';
import { analyzeOpenSpecTaskVolumes } from './openspec/tasks.js';
import { legacyOpenSpecDiscoveryDir, openPrdDiscoveryDir, readDiscoveryConfig } from './openspec/paths.js';
import { appendJsonl, cjoin, exists, readJson, readJsonl, writeJson, writeText } from './fs-utils.js';
import { collectSourceInventory, shouldIgnoreSourceDirectory } from './source-inventory.js';
import { compactTimestamp, timestamp } from './time.js';

const OPENSPEC_DISCOVERY_MODES = ['brownfield', 'reference', 'requirement'];
const OPENSPEC_DISCOVERY_COVERAGE_STATUSES = ['pending', 'covered', 'blocked'];
const OPENSPEC_DISCOVERY_DEFAULT_MAX_ITERATIONS = 10;
const FLEET_DEFAULT_MAX_DEPTH = 4;
function slugify(value, fallback = 'item') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function normalizeDiscoveryMode(mode) {
  const normalized = String(mode ?? 'auto').trim().toLowerCase();
  if (!OPENSPEC_DISCOVERY_MODES.includes(normalized)) {
    throw new Error(`Unsupported OpenPrd discovery mode: ${mode}`);
  }
  return normalized;
}

async function resolveDiscoveryMode(projectRoot, options = {}) {
  const requested = String(options.mode ?? 'auto').trim().toLowerCase();
  if (requested && requested !== 'auto') {
    return normalizeDiscoveryMode(requested);
  }
  if (options.reference) {
    return 'reference';
  }

  let entries = [];
  try {
    entries = await fs.readdir(projectRoot, { withFileTypes: true });
  } catch {
    return 'requirement';
  }

  const hasProjectMaterial = entries.some((entry) => {
    if (shouldIgnoreSourceDirectory(entry.name)) {
      return false;
    }
    if (entry.isDirectory()) {
      return true;
    }
    return entry.isFile() && shouldInventorySourceFile(entry.name);
  });

  return hasProjectMaterial ? 'brownfield' : 'requirement';
}

function normalizeDiscoveryMaxIterations(value) {
  const normalized = Number(value ?? OPENSPEC_DISCOVERY_DEFAULT_MAX_ITERATIONS);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new Error(`Invalid OpenPrd discovery max iterations: ${value}`);
  }
  return normalized;
}

function normalizeCoverageStatus(status) {
  const normalized = String(status ?? 'covered').trim().toLowerCase();
  if (!OPENSPEC_DISCOVERY_COVERAGE_STATUSES.includes(normalized)) {
    throw new Error(`Unsupported OpenPrd discovery coverage status: ${status}`);
  }
  return normalized;
}

function normalizeClaimConfidence(value) {
  const normalized = Number(value ?? 0.7);
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1) {
    throw new Error(`Invalid OpenPrd discovery claim confidence: ${value}`);
  }
  return normalized;
}

function buildDiscoveryRunId(mode, now = new Date()) {
  const stamp = compactTimestamp(now);
  return `${stamp}-${mode}`;
}

function claimValuePreview(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 5).map((item) => String(item)).join(', ');
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value).slice(0, 240);
  }
  return String(value ?? '').slice(0, 240);
}

function buildSeedClaims(analysis) {
  return analysis.completeFields.slice(0, 80).map((field) => ({
    id: `claim:${slugify(field.path)}`,
    status: 'seeded',
    source: 'openprd-snapshot',
    confidence: 0.7,
    path: field.path,
    summary: `${field.label}: ${claimValuePreview(field.value)}`,
  }));
}

function buildCoverageItems({ mode, inventory, analysis }) {
  const missingFieldItems = analysis.missingFields.map((field) => ({
    id: `field:${slugify(field.path)}`,
    title: field.label,
    kind: 'missing-prd-field',
    status: 'pending',
    priority: 'high',
    target: field.path,
    prompt: field.prompt,
    source: 'openprd-analysis',
    claimIds: [],
  }));

  const sourceItems = inventory.files.slice(0, 120).map((file) => ({
    id: `source:${slugify(file.path)}`,
    title: file.path,
    kind: `${file.kind}-evidence`,
    status: 'pending',
    priority: file.kind === 'implementation' || file.kind === 'schema' ? 'medium' : 'low',
    source: file.path,
    claimIds: [],
  }));

  const items = mode === 'requirement'
    ? missingFieldItems
    : [...missingFieldItems, ...sourceItems];

  if (items.length === 0) {
    items.push({
      id: 'review:openprd-completeness',
      title: 'OpenPrd completeness review',
      kind: 'review',
      status: 'pending',
      priority: 'medium',
      source: 'generated',
      claimIds: [],
    });
  }

  const pendingItems = items.filter((item) => item.status === 'pending');
  return {
    version: 1,
    generatedAt: timestamp(),
    mode,
    summary: {
      total: items.length,
      pending: pendingItems.length,
      covered: items.filter((item) => item.status === 'covered').length,
      blocked: items.filter((item) => item.status === 'blocked').length,
    },
    nextPendingItem: pendingItems[0] ?? null,
    items,
  };
}

function summarizeCoverageItems(items) {
  const pendingItems = items.filter((item) => item.status === 'pending');
  return {
    summary: {
      total: items.length,
      pending: pendingItems.length,
      covered: items.filter((item) => item.status === 'covered').length,
      blocked: items.filter((item) => item.status === 'blocked').length,
    },
    nextPendingItem: pendingItems[0] ?? null,
  };
}

function refreshCoverageMatrix(coverageMatrix) {
  const { summary, nextPendingItem } = summarizeCoverageItems(coverageMatrix.items ?? []);
  return {
    ...coverageMatrix,
    generatedAt: timestamp(),
    summary,
    nextPendingItem,
  };
}

function renderDiscoveryContext({ mode, projectRoot, sourceRoot, snapshot, analysis, coverageMatrix }) {
  const next = coverageMatrix.nextPendingItem;
  return [
    '# OpenPrd Discovery Context',
    '',
    `- 模式: ${mode}`,
    `- 项目根目录: ${projectRoot}`,
    `- 来源根目录: ${sourceRoot}`,
    `- PRD 版本: ${snapshot.versionId}`,
    `- 产品类型: ${snapshot.productType ?? '未分类'}`,
    `- 必填字段完成度: ${analysis.completedRequiredFields}/${analysis.totalRequiredFields}`,
    `- 覆盖项: ${coverageMatrix.summary.pending}/${coverageMatrix.summary.total} 待处理`,
    next ? `- 下一项: ${next.title}` : '- 下一项: 无',
    '',
    '## 执行循环',
    '',
    '1. 从本次运行目录和 OpenPrd 工作区重建上下文。',
    '2. 选择下一个待处理覆盖项。',
    '3. 在写入新的 OpenPrd claim 前先收集证据。',
    '4. 更新 OpenPrd 文档、claims、覆盖状态、开放问题和迭代记录。',
    '5. 只有在覆盖项处理完成、被阻断或达到迭代预算时才停止。',
    '',
  ].join('\n');
}

function renderDiscoveryOpenQuestions(analysis, mode) {
  const questions = analysis.missingFields.map((field) => `- [ ] ${field.prompt} (${field.path})`);
  if (questions.length === 0) {
    questions.push('- [ ] 检查是否仍有隐含行为缺少 OpenPrd 覆盖。');
  }
  return [
    '# 开放问题',
    '',
    `模式: ${mode}`,
    '',
    ...questions,
    '',
  ].join('\n');
}

async function openspecDiscoveryWorkspaceImpl(projectRoot, options = {}, dependencies = {}) {
  const {
    appendProgress,
    appendWorkflowEvent,
    loadLatestVersionSnapshot,
    loadWorkspace,
    readVersionIndex,
    resolveActiveTemplatePack,
    resolveCurrentProductType,
  } = dependencies;
  if (options.verify) {
    return verifyOpenSpecDiscoveryWorkspace(projectRoot, dependencies);
  }

  if (options.advance) {
    return advanceOpenSpecDiscoveryWorkspace(projectRoot, options);
  }

  if (options.resume) {
    return resumeOpenSpecDiscoveryWorkspace(projectRoot);
  }

  const mode = await resolveDiscoveryMode(projectRoot, options);
  const maxIterations = normalizeDiscoveryMaxIterations(options.maxIterations);
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const versionIndex = await readVersionIndex(ws);
  const latest = await loadLatestVersionSnapshot(ws).catch(() => null);
  const currentState = ws.data.currentState ?? {};
  const snapshot = latest?.snapshot ?? buildPrdSnapshot(ws, {
    ...currentState,
    versionNumber: currentState.prdVersion ?? (versionIndex.at(-1)?.versionNumber ?? 0),
    versionId: currentState.prdVersion > 0
      ? formatVersionId(currentState.prdVersion)
      : (versionIndex.at(-1)?.versionId ?? 'v0000'),
    productType: resolveCurrentProductType(ws),
    templatePack: resolveActiveTemplatePack(ws),
  });
  const analysis = analyzePrdSnapshot(snapshot);

  const sourceRoot = mode === 'reference' && options.reference
    ? path.resolve(projectRoot, options.reference)
    : projectRoot;
  const inventory = await collectSourceInventory(sourceRoot, {
    maxDepth: options.maxDepth,
    maxFiles: options.maxFiles,
  });
  const coverageMatrix = buildCoverageItems({ mode, inventory, analysis });
  const claims = buildSeedClaims(analysis);
  const runId = options.runId ?? buildDiscoveryRunId(mode);
  const discoveryRoot = openPrdDiscoveryDir(projectRoot);
  const runDir = cjoin(discoveryRoot, 'runs', runId);
  const now = timestamp();
  const control = {
    version: 1,
    runId,
    mode,
    status: coverageMatrix.summary.pending > 0 ? 'active' : 'ready_for_review',
    iteration: 1,
    maxIterations,
    createdAt: now,
    updatedAt: now,
    projectRoot,
    openprdWorkspaceRoot: ws.workspaceRoot,
    sourceRoot,
    referencePath: mode === 'reference' ? (options.reference ?? null) : null,
    latestPrdVersion: snapshot.versionId,
    nextAction: coverageMatrix.nextPendingItem
      ? `Investigate ${coverageMatrix.nextPendingItem.title}`
      : 'Review OpenPrd completeness',
  };
  const firstIteration = {
    iteration: 1,
    at: now,
    action: 'initialized',
    mode,
    nextCoverageItemId: coverageMatrix.nextPendingItem?.id ?? null,
    pendingCoverageItems: coverageMatrix.summary.pending,
    seededClaims: claims.length,
  };

  await fs.mkdir(runDir, { recursive: true });
  await writeJson(cjoin(discoveryRoot, 'current.json'), {
    version: 1,
    activeRunId: runId,
    activeRunDir: runDir,
    mode,
    updatedAt: now,
  });
  await writeText(cjoin(discoveryRoot, 'README.md'), [
    '# OpenPrd Discovery',
    '',
    'This directory stores continuous discovery state for OpenPrd work.',
    '',
    '## Files',
    '',
    '- `control.json` tracks the active loop state and iteration budget.',
    '- `coverage-matrix.json` tracks what still needs to be mined into OpenPrd specs and tasks.',
    '- `claims.jsonl` records evidence-backed requirement claims.',
    '- `open-questions.md` keeps unresolved user or product questions visible.',
    '- `iterations.jsonl` records each loop pass.',
    '',
    '## Task Sharding',
    '',
    '- Keep `tasks.md` as the first task entry.',
    '- Continue long changes with `tasks-002.md`, `tasks-003.md`, and so on.',
    '- The last checkbox in every non-final task file must hand off to the next file.',
    '- Projects may override the max task count in `.openprd/discovery/config.json` at `taskSharding.maxItemsPerFile`.',
    '- For structured tasks, use only `deps`, `done`, and `verify` metadata under a stable task id.',
    '',
    '```md',
    '- [ ] T009.07 Port legacy database import preview',
    '  - deps: T001.14, T007.06',
    '  - done: preview shows counts, conflicts, skipped items, warnings',
    '  - verify: npm run test -- migration',
    '```',
    '',
    '- Omit `deps` when there are no dependencies.',
    '',
  ].join('\n'));
  await writeJson(cjoin(runDir, 'control.json'), control);
  await writeText(cjoin(runDir, 'context.md'), renderDiscoveryContext({
    mode,
    projectRoot,
    sourceRoot,
    snapshot,
    analysis,
    coverageMatrix,
  }));
  await writeJson(cjoin(runDir, 'source-inventory.json'), inventory);
  await writeJson(cjoin(runDir, 'coverage-matrix.json'), coverageMatrix);
  await writeText(cjoin(runDir, 'claims.jsonl'), `${claims.map((claim) => JSON.stringify(claim)).join('\n')}${claims.length > 0 ? '\n' : ''}`);
  await writeText(cjoin(runDir, 'open-questions.md'), renderDiscoveryOpenQuestions(analysis, mode));
  await writeText(cjoin(runDir, 'iterations.jsonl'), `${JSON.stringify(firstIteration)}\n`);

  await appendWorkflowEvent(ws, 'openspec_discovery_initialized', {
    runId,
    mode,
    pendingCoverageItems: coverageMatrix.summary.pending,
  });
  await appendProgress(ws, [
    `Initialized OpenPrd discovery run ${runId}.`,
    `Mode: ${mode}.`,
    `Pending coverage items: ${coverageMatrix.summary.pending}.`,
  ]);

  return {
    ok: true,
    resumed: false,
    ws,
    runId,
    runDir,
    discoveryRoot,
    control,
    inventory,
    coverageMatrix,
    claims,
    openQuestionsPath: cjoin(runDir, 'open-questions.md'),
  };
}

async function loadOpenSpecDiscoveryRun(projectRoot) {
  let discoveryRoot = openPrdDiscoveryDir(projectRoot);
  if (!(await exists(cjoin(discoveryRoot, 'current.json')))) {
    const legacyRoot = legacyOpenSpecDiscoveryDir(projectRoot);
    if (await exists(cjoin(legacyRoot, 'current.json'))) {
      discoveryRoot = legacyRoot;
    }
  }
  const currentPath = cjoin(discoveryRoot, 'current.json');
  if (!(await exists(currentPath))) {
    throw new Error(`Missing OpenPrd discovery state: ${currentPath}`);
  }

  const current = await readJson(currentPath);
  const runDir = current.activeRunDir;
  const control = await readJson(cjoin(runDir, 'control.json'));
  const inventory = await readJson(cjoin(runDir, 'source-inventory.json'));
  const coverageMatrix = await readJson(cjoin(runDir, 'coverage-matrix.json'));
  const claims = await readJsonl(cjoin(runDir, 'claims.jsonl')).catch(() => []);

  return {
    current,
    runId: current.activeRunId,
    runDir,
    discoveryRoot,
    control,
    inventory,
    coverageMatrix,
    claims,
    openQuestionsPath: cjoin(runDir, 'open-questions.md'),
  };
}

async function resumeOpenSpecDiscoveryWorkspace(projectRoot) {
  const state = await loadOpenSpecDiscoveryRun(projectRoot);

  return {
    ok: true,
    resumed: true,
    runId: state.runId,
    runDir: state.runDir,
    discoveryRoot: state.discoveryRoot,
    control: state.control,
    inventory: state.inventory,
    coverageMatrix: state.coverageMatrix,
    claims: state.claims,
    openQuestionsPath: state.openQuestionsPath,
  };
}

async function advanceOpenSpecDiscoveryWorkspace(projectRoot, options = {}) {
  const state = await loadOpenSpecDiscoveryRun(projectRoot);
  const coverageMatrix = state.coverageMatrix;
  const items = Array.isArray(coverageMatrix.items) ? coverageMatrix.items : [];
  const nextPending = coverageMatrix.nextPendingItem ?? items.find((item) => item.status === 'pending');
  const itemId = options.item ?? nextPending?.id;
  if (!itemId) {
    throw new Error('No pending OpenPrd discovery coverage item to advance.');
  }

  const itemIndex = items.findIndex((item) => item.id === itemId);
  if (itemIndex < 0) {
    throw new Error(`Unknown OpenPrd discovery coverage item: ${itemId}`);
  }

  const status = normalizeCoverageStatus(options.status);
  const claimSummary = options.claim ?? null;
  const notes = options.notes ?? null;
  if (status === 'covered' && !claimSummary && !notes) {
    throw new Error('Covering an OpenPrd discovery item requires --claim or --notes.');
  }
  if (status === 'blocked' && !notes && !claimSummary) {
    throw new Error('Blocking an OpenPrd discovery item requires --notes or --claim.');
  }

  const now = timestamp();
  const item = {
    ...items[itemIndex],
    status,
    updatedAt: now,
  };
  if (notes) {
    item.notes = notes;
  }
  if (options.evidence) {
    item.evidence = [...new Set([...(item.evidence ?? []), options.evidence])];
  }

  let claim = null;
  if (claimSummary) {
    const nextIteration = Number(state.control.iteration ?? 0) + 1;
    claim = {
      id: `claim:${slugify(item.id)}:${nextIteration}`,
      status: 'active',
      source: options.source ?? (options.evidence ? 'project-derived' : 'agent-inferred'),
      confidence: normalizeClaimConfidence(options.confidence),
      coverageItemId: item.id,
      summary: claimSummary,
      evidence: options.evidence ? [options.evidence] : [],
      notes,
      createdAt: now,
    };
    item.claimIds = [...new Set([...(item.claimIds ?? []), claim.id])];
    await appendJsonl(cjoin(state.runDir, 'claims.jsonl'), claim);
  }

  items[itemIndex] = item;
  const updatedCoverageMatrix = refreshCoverageMatrix({
    ...coverageMatrix,
    items,
  });
  const nextIteration = Number(state.control.iteration ?? 0) + 1;
  const updatedControl = {
    ...state.control,
    iteration: nextIteration,
    updatedAt: now,
    status: updatedCoverageMatrix.summary.pending > 0 ? 'active' : 'ready_for_review',
    nextAction: updatedCoverageMatrix.nextPendingItem
      ? `Investigate ${updatedCoverageMatrix.nextPendingItem.title}`
      : 'Review OpenPrd completeness',
  };
  const iterationEntry = {
    iteration: nextIteration,
    at: now,
    action: 'advance',
    coverageItemId: item.id,
    status,
    claimId: claim?.id ?? null,
    evidence: options.evidence ?? null,
    notes,
    pendingCoverageItems: updatedCoverageMatrix.summary.pending,
  };

  await writeJson(cjoin(state.runDir, 'coverage-matrix.json'), updatedCoverageMatrix);
  await writeJson(cjoin(state.runDir, 'control.json'), updatedControl);
  await appendJsonl(cjoin(state.runDir, 'iterations.jsonl'), iterationEntry);

  return {
    ok: true,
    advanced: true,
    runId: state.runId,
    runDir: state.runDir,
    discoveryRoot: state.discoveryRoot,
    control: updatedControl,
    inventory: state.inventory,
    coverageMatrix: updatedCoverageMatrix,
    claims: claim ? [...state.claims, claim] : state.claims,
    advancedItem: item,
    claim,
    openQuestionsPath: state.openQuestionsPath,
  };
}

function verifyOpenSpecDiscoveryState(state) {
  const errors = [];
  const warnings = [];
  const checks = [];
  const items = Array.isArray(state.coverageMatrix.items) ? state.coverageMatrix.items : [];

  if (!state.control.runId) {
    errors.push('control.json is missing runId.');
  }
  if (!OPENSPEC_DISCOVERY_MODES.includes(state.control.mode)) {
    errors.push(`control.json has unsupported mode: ${state.control.mode}`);
  }
  if (!Number.isInteger(Number(state.control.iteration)) || Number(state.control.iteration) < 1) {
    errors.push('control.json has invalid iteration.');
  }
  if (!Number.isInteger(Number(state.control.maxIterations)) || Number(state.control.maxIterations) < 1) {
    errors.push('control.json has invalid maxIterations.');
  }
  if (Number(state.control.iteration) > Number(state.control.maxIterations)) {
    warnings.push('OpenPrd discovery iteration budget has been reached.');
  }

  if (!Array.isArray(state.coverageMatrix.items)) {
    errors.push('coverage-matrix.json is missing items.');
  }

  for (const item of items) {
    if (!item.id) {
      errors.push('coverage item is missing id.');
    }
    if (!OPENSPEC_DISCOVERY_COVERAGE_STATUSES.includes(item.status)) {
      errors.push(`coverage item ${item.id ?? '<unknown>'} has unsupported status: ${item.status}`);
    }
    if (item.status === 'covered' && (!Array.isArray(item.claimIds) || item.claimIds.length === 0) && !item.notes) {
      warnings.push(`covered item ${item.id} has no claimIds or notes.`);
    }
  }

  const recomputed = summarizeCoverageItems(items);
  const storedSummary = state.coverageMatrix.summary ?? {};
  for (const key of ['total', 'pending', 'covered', 'blocked']) {
    if (Number(storedSummary[key] ?? 0) !== recomputed.summary[key]) {
      errors.push(`coverage summary mismatch for ${key}: expected ${recomputed.summary[key]}, found ${storedSummary[key]}`);
    }
  }

  for (const claim of state.claims) {
    if (!claim.id) {
      errors.push('claim is missing id.');
    }
    if (!claim.summary) {
      errors.push(`claim ${claim.id ?? '<unknown>'} is missing summary.`);
    }
    if (!claim.source) {
      warnings.push(`claim ${claim.id ?? '<unknown>'} is missing source.`);
    }
    if (claim.source !== 'user-confirmed' && claim.source !== 'openprd-snapshot' && (!Array.isArray(claim.evidence) || claim.evidence.length === 0)) {
      warnings.push(`claim ${claim.id ?? '<unknown>'} has no evidence path.`);
    }
  }

  checks.push(`Coverage: ${recomputed.summary.covered}/${recomputed.summary.total} covered, ${recomputed.summary.pending} pending, ${recomputed.summary.blocked} blocked.`);
  checks.push(`Claims: ${state.claims.length}.`);

  return {
    valid: errors.length === 0,
    complete: recomputed.summary.pending === 0,
    errors,
    warnings,
    checks,
    coverage: recomputed.summary,
    nextPendingItem: recomputed.nextPendingItem,
  };
}

async function verifyOpenSpecDiscoveryWorkspace(projectRoot, dependencies = {}) {
  const {
    checkStandardsWorkspace,
    validateOpenSpecChangeWorkspace,
  } = dependencies;
  const state = await loadOpenSpecDiscoveryRun(projectRoot);
  const verification = verifyOpenSpecDiscoveryState(state);
  const discoveryConfig = await readDiscoveryConfig(projectRoot, readJson);
  let openSpecChange = null;
  let taskVolume = null;
  let standards = null;
  if (discoveryConfig?.activeChange) {
    openSpecChange = await validateOpenSpecChangeWorkspace(projectRoot, {
      change: discoveryConfig.activeChange,
      sourceManuals: false,
      docsContent: false,
    });
    taskVolume = openSpecChange.taskVolume;
    standards = openSpecChange.standards ?? null;
    verification.errors.push(...openSpecChange.errors);
    verification.warnings.push(...openSpecChange.warnings);
    verification.checks.push(...openSpecChange.checks);
  } else {
    taskVolume = await analyzeOpenSpecTaskVolumes(projectRoot);
    verification.errors.push(...taskVolume.errors);
    verification.checks.push(...taskVolume.checks);
    standards = await checkStandardsWorkspace(projectRoot, {
      optional: !(await exists(cjoin(projectRoot, '.openprd'))),
      sourceManuals: false,
      docsContent: false,
    });
    if (!standards.skipped) {
      verification.errors.push(...standards.errors);
      verification.warnings.push(...standards.warnings);
      verification.checks.push(...standards.checks);
    }
  }
  verification.valid = verification.errors.length === 0;
  const now = timestamp();
  const updatedControl = {
    ...state.control,
    status: verification.complete && verification.valid ? 'ready_for_review' : state.control.status,
    lastVerifiedAt: now,
    updatedAt: now,
  };
  await writeJson(cjoin(state.runDir, 'control.json'), updatedControl);
  await appendJsonl(cjoin(state.runDir, 'iterations.jsonl'), {
    iteration: state.control.iteration,
    at: now,
    action: 'verify',
    valid: verification.valid,
    complete: verification.complete,
    errors: verification.errors.length,
    warnings: verification.warnings.length,
  });

  return {
    ok: verification.valid,
    verified: true,
    runId: state.runId,
    runDir: state.runDir,
    discoveryRoot: state.discoveryRoot,
    control: updatedControl,
    inventory: state.inventory,
    coverageMatrix: state.coverageMatrix,
    claims: state.claims,
    verification,
    openSpecChange,
    taskVolume,
    standards,
    openQuestionsPath: state.openQuestionsPath,
  };
}


function createOpenSpecDiscoveryWorkspace(dependencies) {
  return {
    openspecDiscoveryWorkspace(projectRoot, options = {}) {
      return openspecDiscoveryWorkspaceImpl(projectRoot, options, dependencies);
    },
    resumeOpenSpecDiscoveryWorkspace(projectRoot) {
      return resumeOpenSpecDiscoveryWorkspace(projectRoot);
    },
    verifyOpenSpecDiscoveryWorkspace(projectRoot) {
      return verifyOpenSpecDiscoveryWorkspace(projectRoot, dependencies);
    },
  };
}

export { createOpenSpecDiscoveryWorkspace };
