import fs from 'node:fs/promises';
import path from 'node:path';
import { appendJsonl, cjoin, exists, readJson, readJsonl, writeJson, writeText } from './fs-utils.js';
import { resolveQualityLearningSource } from './quality-learning.js';
import { timestamp } from './time.js';

const KNOWLEDGE_DIR = cjoin('.openprd', 'knowledge');
const KNOWLEDGE_INDEX = cjoin(KNOWLEDGE_DIR, 'index.json');
const KNOWLEDGE_SKILLS_DIR = cjoin(KNOWLEDGE_DIR, 'skills');
const KNOWLEDGE_CANDIDATES_DIR = cjoin(KNOWLEDGE_DIR, 'candidates');
const KNOWLEDGE_DRAFTS_DIR = cjoin(KNOWLEDGE_DIR, 'drafts');
const KNOWLEDGE_ADOPTION_LOG = cjoin(KNOWLEDGE_DIR, 'adoption.jsonl');
const KNOWLEDGE_REVIEW_SIGNAL_LOG = cjoin(KNOWLEDGE_DIR, 'review-signals.jsonl');
const OPENPRD_HARNESS_TURN_STATE = cjoin('.openprd', 'harness', 'turn-state.json');
const QUALITY_LATEST_REPORT = cjoin('.openprd', 'quality', 'reports', 'latest.json');
const PENDING_KNOWLEDGE_CANDIDATE_STATUSES = new Set(['pending-review', 'pending']);
const REVIEWED_KNOWLEDGE_CANDIDATE_STATUSES = new Set([
  'promoted',
  'merged',
  'rejected',
  'archived',
  'reviewed-noise',
  'reviewed-duplicate',
  'reviewed-weak-signal',
]);

const CODE_EXTENSIONS = new Set([
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
  '.json',
  '.jsx',
  '.kt',
  '.md',
  '.mjs',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.vue',
  '.yaml',
  '.yml',
]);

function knowledgePath(projectRoot, relativePath) {
  return cjoin(projectRoot, relativePath);
}

function defaultKnowledgeIndex() {
  return {
    version: 2,
    updatedAt: timestamp(),
    incidents: [],
    patterns: [],
    skills: [],
    candidates: [],
    drafts: [],
  };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined) : [];
}

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

function defaultSkillAdoption() {
  return {
    hitCount: 0,
    referencedCount: 0,
    injectedCount: 0,
    lastHitAt: null,
    lastReferencedAt: null,
    lastInjectedAt: null,
    lastSource: null,
    recentEvents: [],
  };
}

function slugify(value, fallback = 'knowledge') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function toRelativeProjectPath(projectRoot, filePath) {
  if (!filePath) return null;
  const absolutePath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : knowledgePath(projectRoot, filePath);
  const relativePath = path.relative(projectRoot, absolutePath).split(path.sep).join('/');
  return relativePath && !relativePath.startsWith('..') ? relativePath : String(filePath).split(path.sep).join('/');
}

function readJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function trimPreview(value, max = 220) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function normalizeSkillAdoption(value) {
  const current = readJsonObject(value) ?? {};
  const recentEvents = Array.isArray(current.recentEvents)
    ? current.recentEvents
      .map((event) => readJsonObject(event))
      .filter(Boolean)
      .slice(0, 12)
    : [];
  return {
    ...defaultSkillAdoption(),
    ...current,
    hitCount: Number.isFinite(Number(current.hitCount)) ? Number(current.hitCount) : 0,
    referencedCount: Number.isFinite(Number(current.referencedCount)) ? Number(current.referencedCount) : 0,
    injectedCount: Number.isFinite(Number(current.injectedCount)) ? Number(current.injectedCount) : 0,
    recentEvents,
  };
}

function normalizeSkillIndexEntry(entry = {}) {
  const skill = readJsonObject(entry) ?? {};
  return {
    ...skill,
    skillName: firstString(skill.skillName, path.basename(path.dirname(String(skill.path ?? ''))), 'knowledge-skill') ?? 'knowledge-skill',
    path: firstString(skill.path),
    sourceKind: firstString(skill.sourceKind),
    sourceRef: firstString(skill.sourceRef),
    candidateId: firstString(skill.candidateId),
    candidateIds: uniq([
      ...normalizeStringList(skill.candidateIds),
      ...normalizeStringList(skill.candidateId ? [skill.candidateId] : []),
    ]),
    categories: normalizeStringList(skill.categories),
    triggerHints: normalizeStringList(skill.triggerHints),
    touchedFiles: normalizeStringList(skill.touchedFiles),
    evidencePaths: normalizeStringList(skill.evidencePaths),
    rootCauseLabels: normalizeStringList(skill.rootCauseLabels),
    description: firstString(skill.description),
    summary: firstString(skill.summary),
    adoption: normalizeSkillAdoption(skill.adoption),
  };
}

function extractCandidateIds(skill = {}) {
  return uniq([
    ...normalizeStringList(skill.candidateIds),
    ...normalizeStringList(skill.candidateId ? [skill.candidateId] : []),
    ...String(skill.sourceRef ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => /^candidate-[a-z0-9-]+$/i.test(item)),
  ]);
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[`"'()[\]{}:;,!?]/g, ' ')
    .replace(/[_/\\.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSearchTokens(value) {
  const text = normalizeSearchText(value);
  const asciiTokens = text
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);
  const hanTokens = String(value ?? '').match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
  return uniq([...asciiTokens, ...hanTokens]);
}

function sortByLength(items = []) {
  return [...items].sort((left, right) => String(right).length - String(left).length);
}

function scoreQueryAgainstFields(queryText, queryTokens, fields = []) {
  let score = 0;
  const matchedOn = [];
  for (const field of fields) {
    const text = String(field ?? '').trim();
    if (!text) continue;
    const normalized = normalizeSearchText(text);
    if (!normalized) continue;
    let matched = false;
    if (normalized.length >= 6 && queryText.includes(normalized)) {
      matched = true;
      score += normalized.length >= 18 ? 10 : 7;
    } else {
      const fieldTokens = normalizeSearchTokens(text);
      const overlap = fieldTokens.filter((token) => queryTokens.includes(token));
      if (overlap.length > 0) {
        matched = true;
        score += Math.min(overlap.length, 4) * 2;
      }
    }
    if (matched) {
      matchedOn.push(trimPreview(text, 120));
    }
  }
  return {
    score,
    matchedOn: uniq(matchedOn).slice(0, 6),
  };
}

function parseMarkdownSectionList(markdown, headings = []) {
  if (!markdown) return [];
  const lines = String(markdown).split(/\r?\n/);
  const sectionSet = new Set(headings);
  const collected = [];
  let active = false;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      active = sectionSet.has(heading[1].trim());
      continue;
    }
    if (!active) continue;
    const bullet = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (bullet) {
      collected.push(bullet[1].trim());
    }
  }
  return uniq(collected);
}

function parseSkillMetadataFromText(markdown) {
  const text = String(markdown ?? '');
  const frontmatter = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const descriptionLine = frontmatter?.[1]
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('description:'));
  const description = descriptionLine ? descriptionLine.replace(/^description:\s*/, '').trim() : null;
  const triggerHints = parseMarkdownSectionList(text, ['触发场景', '常见误判', '先看什么', '收尾顺序', '反模式', '下次触发时先看什么']);
  const rootCauseLabels = parseMarkdownSectionList(text, ['可复用模式']);
  const evidencePaths = uniq((text.match(/`([^`]+)`/g) ?? [])
    .map((entry) => entry.replace(/`/g, '').trim())
    .filter((entry) => entry.includes('/') || entry.endsWith('.md') || entry.endsWith('.js') || entry.endsWith('.ts')));
  return {
    description,
    triggerHints,
    rootCauseLabels,
    evidencePaths,
  };
}

async function ensureKnowledgeWorkspace(projectRoot) {
  await fs.mkdir(knowledgePath(projectRoot, cjoin(KNOWLEDGE_DIR, 'incidents')), { recursive: true });
  await fs.mkdir(knowledgePath(projectRoot, cjoin(KNOWLEDGE_DIR, 'patterns')), { recursive: true });
  await fs.mkdir(knowledgePath(projectRoot, KNOWLEDGE_SKILLS_DIR), { recursive: true });
  await fs.mkdir(knowledgePath(projectRoot, KNOWLEDGE_CANDIDATES_DIR), { recursive: true });
  await fs.mkdir(knowledgePath(projectRoot, KNOWLEDGE_DRAFTS_DIR), { recursive: true });
  const indexPath = knowledgePath(projectRoot, KNOWLEDGE_INDEX);
  if (!(await exists(indexPath))) {
    await writeJson(indexPath, defaultKnowledgeIndex());
  }
}

async function readKnowledgeIndex(projectRoot) {
  await ensureKnowledgeWorkspace(projectRoot);
  const current = await readJson(knowledgePath(projectRoot, KNOWLEDGE_INDEX)).catch(() => defaultKnowledgeIndex());
  return {
    ...defaultKnowledgeIndex(),
    ...current,
    incidents: Array.isArray(current?.incidents) ? current.incidents : [],
    patterns: Array.isArray(current?.patterns) ? current.patterns : [],
    skills: Array.isArray(current?.skills) ? current.skills : [],
    candidates: Array.isArray(current?.candidates) ? current.candidates : [],
    drafts: Array.isArray(current?.drafts) ? current.drafts : [],
  };
}

async function writeKnowledgeIndex(projectRoot, index) {
  await writeJson(knowledgePath(projectRoot, KNOWLEDGE_INDEX), {
    ...defaultKnowledgeIndex(),
    ...index,
    updatedAt: timestamp(),
  });
}

async function readCandidateSupportBundle(projectRoot, candidateId) {
  const candidate = await readCandidateById(projectRoot, candidateId);
  if (!candidate) {
    return null;
  }
  const candidateDir = candidate.files?.candidateDir ?? knowledgePath(projectRoot, cjoin(KNOWLEDGE_CANDIDATES_DIR, candidateId));
  const rootCauseCandidates = await readJson(path.join(candidateDir, 'root-cause-candidates.json')).catch(() => []);
  return {
    candidateId,
    categories: normalizeStringList(candidate.categories),
    touchedFiles: normalizeStringList(candidate.touchedFiles),
    evidencePaths: uniq([
      toRelativeProjectPath(projectRoot, candidate.files?.candidate),
      ...normalizeStringList(candidate.touchedFiles),
    ]),
    rootCauseLabels: uniq(normalizeArray(rootCauseCandidates)
      .map((item) => firstString(item?.title, item?.label, item?.name))
      .filter(Boolean)),
    triggerHints: uniq([
      ...normalizeStringList(candidate.reasons),
      ...normalizeStringList(candidate.reviewSignals?.map((signal) => signal.summary)),
    ]),
    summary: firstString(candidate.summary),
  };
}

async function hydrateKnowledgeSkillEntry(projectRoot, entry, cache = new Map()) {
  const current = normalizeSkillIndexEntry(entry);
  const skillPath = current.path
    ? (path.isAbsolute(current.path) ? path.resolve(current.path) : knowledgePath(projectRoot, current.path))
    : null;
  const markdown = skillPath ? await fs.readFile(skillPath, 'utf8').catch(() => '') : '';
  const parsedSkill = parseSkillMetadataFromText(markdown);
  const candidateIds = extractCandidateIds(current);
  const candidateBundles = [];
  for (const candidateId of candidateIds) {
    const cacheKey = `candidate:${candidateId}`;
    if (!cache.has(cacheKey)) {
      cache.set(cacheKey, readCandidateSupportBundle(projectRoot, candidateId));
    }
    const bundle = await cache.get(cacheKey);
    if (bundle) {
      candidateBundles.push(bundle);
    }
  }
  const next = {
    ...current,
    candidateId: current.candidateId ?? candidateIds[0] ?? null,
    candidateIds,
    categories: uniq([
      ...current.categories,
      ...candidateBundles.flatMap((bundle) => bundle.categories),
    ]).slice(0, 24),
    triggerHints: uniq([
      ...current.triggerHints,
      ...parsedSkill.triggerHints,
      ...candidateBundles.flatMap((bundle) => bundle.triggerHints),
    ]).slice(0, 24),
    touchedFiles: uniq([
      ...current.touchedFiles,
      ...candidateBundles.flatMap((bundle) => bundle.touchedFiles),
    ]).slice(0, 24),
    evidencePaths: uniq([
      ...current.evidencePaths,
      ...parsedSkill.evidencePaths,
      ...candidateBundles.flatMap((bundle) => bundle.evidencePaths),
    ]).slice(0, 24),
    rootCauseLabels: uniq([
      ...current.rootCauseLabels,
      ...parsedSkill.rootCauseLabels,
      ...candidateBundles.flatMap((bundle) => bundle.rootCauseLabels),
    ]).slice(0, 24),
    description: current.description ?? parsedSkill.description,
    summary: current.summary ?? candidateBundles.map((bundle) => bundle.summary).find(Boolean) ?? null,
    adoption: normalizeSkillAdoption(current.adoption),
  };
  return next;
}

function serializeComparable(value) {
  return JSON.stringify(value);
}

async function hydrateKnowledgeSkills(projectRoot) {
  const index = await readKnowledgeIndex(projectRoot);
  const cache = new Map();
  const hydratedSkills = [];
  let changed = false;
  for (const skill of index.skills.map((entry) => normalizeSkillIndexEntry(entry))) {
    const hydrated = await hydrateKnowledgeSkillEntry(projectRoot, skill, cache);
    hydratedSkills.push(hydrated);
    if (serializeComparable(hydrated) !== serializeComparable(skill)) {
      changed = true;
    }
  }
  if (changed) {
    await writeKnowledgeIndex(projectRoot, {
      ...index,
      skills: hydratedSkills,
    });
  }
  return {
    index: changed ? { ...index, skills: hydratedSkills } : index,
    skills: hydratedSkills,
  };
}

function buildKnowledgeAdoptionSummary(skills = []) {
  const totals = {
    hit: 0,
    referenced: 0,
    injected: 0,
  };
  const activeSkills = {
    hit: 0,
    referenced: 0,
    injected: 0,
  };
  for (const skill of skills.map((entry) => normalizeSkillIndexEntry(entry))) {
    const adoption = normalizeSkillAdoption(skill.adoption);
    totals.hit += adoption.hitCount;
    totals.referenced += adoption.referencedCount;
    totals.injected += adoption.injectedCount;
    if (adoption.hitCount > 0) activeSkills.hit += 1;
    if (adoption.referencedCount > 0) activeSkills.referenced += 1;
    if (adoption.injectedCount > 0) activeSkills.injected += 1;
  }
  return {
    totals,
    activeSkills,
    totalSkills: skills.length,
  };
}

function upsertBy(items, key, value, max = 200) {
  return [value, ...items.filter((item) => item?.[key] !== value[key])].slice(0, max);
}

function normalizeCandidateStatus(status) {
  const normalized = String(status ?? '').trim();
  if (!normalized || normalized === 'pending') return 'pending-review';
  return normalized;
}

function isPendingKnowledgeCandidateStatus(status) {
  return PENDING_KNOWLEDGE_CANDIDATE_STATUSES.has(String(status ?? '').trim() || 'pending-review');
}

function isReviewedKnowledgeCandidateStatus(status) {
  const normalized = normalizeCandidateStatus(status);
  return REVIEWED_KNOWLEDGE_CANDIDATE_STATUSES.has(normalized)
    || !isPendingKnowledgeCandidateStatus(normalized);
}

function candidateStatusGroup(status) {
  const normalized = normalizeCandidateStatus(status);
  if (isPendingKnowledgeCandidateStatus(normalized)) return 'pending';
  if (['promoted', 'merged'].includes(normalized)) return 'promoted';
  if (normalized === 'rejected') return 'rejected';
  if (normalized === 'archived') return 'archived';
  return 'reviewed';
}

function resolveCandidateStatus(candidateStatus, indexStatus) {
  const hasCandidateStatus = candidateStatus !== undefined && candidateStatus !== null && String(candidateStatus).trim();
  const hasIndexStatus = indexStatus !== undefined && indexStatus !== null && String(indexStatus).trim();
  const normalizedCandidate = normalizeCandidateStatus(candidateStatus);
  const normalizedIndex = normalizeCandidateStatus(indexStatus);
  if (
    hasCandidateStatus
    && isPendingKnowledgeCandidateStatus(normalizedCandidate)
    && hasIndexStatus
    && isReviewedKnowledgeCandidateStatus(normalizedIndex)
  ) {
    return normalizedIndex;
  }
  return hasCandidateStatus ? normalizedCandidate : normalizedIndex;
}

function signalSummary(signal) {
  if (!signal) return null;
  const parts = [];
  if (signal.summary) parts.push(signal.summary);
  if (Array.isArray(signal.attentionGates) && signal.attentionGates.length > 0) {
    parts.push(`attention gates: ${signal.attentionGates.join(', ')}`);
  }
  if (Array.isArray(signal.touchedFiles) && signal.touchedFiles.length > 0) {
    parts.push(`touched: ${signal.touchedFiles.slice(0, 6).join(', ')}`);
  }
  return parts.join(' | ') || null;
}

function normalizeReviewSignal(projectRoot, signal = {}) {
  const touchedFiles = uniq(normalizeStringList(signal.touchedFiles).map((file) => toRelativeProjectPath(projectRoot, file)));
  return {
    id: firstString(signal.id, signal.kind, signal.source, signal.title, timestamp()) ?? timestamp(),
    kind: firstString(signal.kind, signal.source, 'signal') ?? 'signal',
    at: signal.at ?? timestamp(),
    ok: typeof signal.ok === 'boolean' ? signal.ok : null,
    productionReady: typeof signal.productionReady === 'boolean' ? signal.productionReady : null,
    attentionGates: normalizeStringList(signal.attentionGates),
    summary: firstString(signal.summary, signal.message, signal.reason),
    touchedFiles,
  };
}

function normalizeTouchedFiles(projectRoot, value) {
  return uniq(normalizeStringList(value).map((file) => toRelativeProjectPath(projectRoot, file))).filter(Boolean);
}

async function readRecentKnowledgeReviewSignals(projectRoot, options = {}) {
  const limit = Math.max(1, Number(options.limit ?? 24));
  const entries = await readJsonl(knowledgePath(projectRoot, KNOWLEDGE_REVIEW_SIGNAL_LOG)).catch(() => []);
  return entries
    .map((signal) => normalizeReviewSignal(projectRoot, signal))
    .filter((signal) => signal.summary || signal.touchedFiles.length > 0 || signal.kind)
    .slice(-limit)
    .reverse();
}

function hasOverlap(left = [], right = []) {
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}

function buildReviewContext(projectRoot, raw = {}, options = {}) {
  const rawTouchedFiles = normalizeTouchedFiles(projectRoot, raw.touchedFiles);
  const optionTouchedFiles = normalizeTouchedFiles(projectRoot, options.touchedFiles);
  const optionSignal = options.signal ? normalizeReviewSignal(projectRoot, options.signal) : null;
  const recentSignals = Array.isArray(options.recentSignals)
    ? options.recentSignals.map((signal) => normalizeReviewSignal(projectRoot, signal))
    : [];
  const embeddedSignals = Array.isArray(raw.reviewSignals)
    ? raw.reviewSignals.map((signal) => normalizeReviewSignal(projectRoot, signal))
    : [];
  const latestSignalTouchedFiles = [
    ...(embeddedSignals.find((signal) => signal.touchedFiles.length > 0)?.touchedFiles ?? []),
    ...(recentSignals.find((signal) => signal.touchedFiles.length > 0)?.touchedFiles ?? []),
  ];
  const touchedFiles = optionTouchedFiles.length > 0
    ? optionTouchedFiles
    : (optionSignal?.touchedFiles?.length ? optionSignal.touchedFiles : (latestSignalTouchedFiles.length > 0 ? latestSignalTouchedFiles : rawTouchedFiles));
  const signalEntries = [];
  if (optionSignal) {
    signalEntries.push(optionSignal);
  }
  for (const signal of [...embeddedSignals, ...recentSignals]) {
    const isSameSignal = optionSignal && signal.id === optionSignal.id && signal.kind === optionSignal.kind;
    if (isSameSignal) continue;
    if (!optionSignal) {
      signalEntries.push(signal);
      continue;
    }
    if (signal.touchedFiles.length > 0 && hasOverlap(signal.touchedFiles, touchedFiles)) {
      signalEntries.push(signal);
    }
  }
  const reviewSignals = uniq(signalEntries.map((signal) => JSON.stringify(signal))).map((entry) => JSON.parse(entry));
  return {
    touchedFiles,
    reviewSignals,
  };
}

function isSubstantiveTouchedFile(filePath) {
  const normalized = String(filePath ?? '').split(path.sep).join('/');
  if (!normalized) return false;
  if (/^docs\/basic\//.test(normalized)) return true;
  if (/^skills\/.+\/SKILL\.md$/.test(normalized)) return true;
  if (/^AGENTS\.md$/.test(normalized)) return true;
  const extension = path.extname(normalized).toLowerCase();
  if (!CODE_EXTENSIONS.has(extension)) return false;
  if (/README/i.test(path.basename(normalized)) && !/^docs\/basic\//.test(normalized)) {
    return false;
  }
  return true;
}

function buildKnowledgeCategories({ source, touchedFiles, reviewSignals }) {
  const categories = [];
  const signalKinds = reviewSignals.map((signal) => signal.kind);
  const touchesAgentInfra = touchedFiles.some((file) => /(agent|harness|hook|workflow|skill|prompt|quality|run-harness|loop|growth|standards)/i.test(file));
  const hasRuntimePattern = source.rootCauseCandidates.length > 0 || source.eventNames.length > 0 || source.symptoms.length > 1;
  const hasVerifiedOutcome = reviewSignals.some((signal) => (
    signal.ok === true || signal.productionReady === true
  ) && ['quality-verify', 'run-verify', 'loop-finish'].includes(signal.kind));
  const hasAttentionOutcome = reviewSignals.some((signal) => signal.ok === false || signal.productionReady === false || signal.attentionGates.length > 0);

  if (hasRuntimePattern || hasAttentionOutcome) {
    categories.push('hidden-debug-knowledge');
  }
  if (touchesAgentInfra) {
    categories.push('agent-misjudgment');
  }
  if (hasVerifiedOutcome || signalKinds.includes('loop-finish') || signalKinds.includes('run-verify')) {
    categories.push('high-impact-fix');
  }
  return uniq(categories);
}

function applicabilityFromTouchedFiles(touchedFiles = []) {
  const normalized = touchedFiles.map((file) => String(file).split(path.sep).join('/'));
  const hints = [];
  if (normalized.some((file) => file.startsWith('src/') || file.startsWith('app/') || file.startsWith('lib/'))) {
    hints.push('适用于项目源码或核心流程已经落地、需要把实现经验固化为项目知识的任务。');
  }
  if (normalized.some((file) => file.startsWith('test/') || file.startsWith('tests/'))) {
    hints.push('适用于本轮补过验证或测试夹具，后续同类需求需要同步复用验证方式的任务。');
  }
  if (normalized.some((file) => file.startsWith('docs/basic/'))) {
    hints.push('适用于这轮改动同时影响 docs/basic、CLI 契约或实现说明，需要把文档同步经验一起沉淀的任务。');
  }
  if (normalized.some((file) => /(hook|harness|agent|skill|quality|run-harness|growth|loop)/i.test(file))) {
    hints.push('特别适用于 Agent、hook、harness、quality 或 growth 工作流改动，避免下次再次靠聊天上下文兜底。');
  }
  if (hints.length === 0 && normalized.length > 0) {
    hints.push(`适用于再次改动 ${normalized.slice(0, 4).join('、')} 这类相关文件时，优先复用本轮模式。`);
  }
  return hints;
}

function summarizeReviewSignalKinds(reviewSignals = []) {
  return uniq(reviewSignals.map((signal) => signal.kind).filter(Boolean)).slice(0, 6);
}

function buildKnowledgeAbstraction({
  candidate,
  source,
  touchedFiles,
  reviewSignals,
  relativeCandidateDir,
  relativeDraftSkillPath,
}) {
  const triggerConditions = uniq([
    ...candidate.reasons,
    ...normalizeStringList(source.triggers),
    ...source.symptoms.map((item) => `症状: ${item}`),
    ...reviewSignals.map((signal) => {
      const summary = signalSummary(signal);
      return summary ? `${signal.kind}: ${summary}` : signal.kind;
    }),
  ]).slice(0, 8);
  const applicability = uniq([
    source.abstractPattern ? `抽象模式: ${source.abstractPattern}` : null,
    ...applicabilityFromTouchedFiles(touchedFiles),
  ]).slice(0, 6);
  const verificationSteps = uniq([
    ...reviewSignals.map((signal) => signal.summary).filter(Boolean),
    ...source.verificationSteps,
  ]).slice(0, 8);
  const typicalInputs = uniq([
    firstString(source.title, candidate.title) ? `任务摘要: ${firstString(source.title, candidate.title)}` : null,
    touchedFiles.length > 0 ? `相关文件: ${touchedFiles.slice(0, 6).join('、')}` : null,
    source.evidenceSources.length > 0
      ? `已有证据: ${source.evidenceSources.slice(0, 4).map((item) => `${item.kind}:${item.path}`).join('；')}`
      : null,
    reviewSignals.length > 0
      ? `验证信号: ${summarizeReviewSignalKinds(reviewSignals).join('、')}`
      : null,
  ]).slice(0, 6);
  const typicalOutputs = uniq([
    relativeCandidateDir ? `knowledge candidate: ${relativeCandidateDir}/candidate.json` : null,
    relativeCandidateDir ? `诊断报告: ${relativeCandidateDir}/diagnostic-report.json` : null,
    relativeDraftSkillPath ? `draft skill: ${relativeDraftSkillPath}` : null,
    verificationSteps[0] ? `验证结论: ${verificationSteps[0]}` : null,
  ]).slice(0, 6);
  return {
    triggerConditions,
    applicability,
    verificationSteps,
    typicalInputs,
    typicalOutputs,
  };
}

function categoryReason(category) {
  if (category === 'hidden-debug-knowledge') {
    return '本轮结果里已经出现可复用的症状、排查线索或根因模式，不应该只留在当前对话里。';
  }
  if (category === 'agent-misjudgment') {
    return '这次改动直接影响 Agent / harness / hook / skill 行为，后续很容易再次踩到同类判断问题。';
  }
  if (category === 'high-impact-fix') {
    return '这次修复已经带有验证或收尾证据，适合尽快抽象成项目级研发经验。';
  }
  return '这次实现已经具备沉淀项目经验的价值。';
}

function deriveKnowledgeNames(source) {
  const sourceRef = source?.sourceId ?? source?.title ?? source?.status ?? 'diagnostic';
  const sourceKind = source?.kind === 'quality-report' ? 'quality' : 'diagnostic';
  const incidentId = source?.kind === 'quality-report'
    ? `incident-${sourceRef}`
    : `incident-${slugify(sourceRef, 'diagnostic')}`;
  const patternId = `${sourceKind}-${slugify(sourceRef, sourceKind)}`;
  const skillName = `openprd-experience-${slugify(patternId)}`;
  return { incidentId, patternId, skillName };
}

function buildTurnReviewTitle(raw, source) {
  return firstString(
    raw?.title,
    raw?.summary?.title,
    raw?.promptPreview,
    raw?.prompt,
    source.title,
    source.sourceId,
    '项目经验草案',
  ) ?? '项目经验草案';
}

async function loadRawReviewInput(projectRoot, from) {
  if (!from) return { sourcePath: null, raw: null };
  const resolved = path.isAbsolute(from) ? path.resolve(from) : knowledgePath(projectRoot, from);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat) {
    return { sourcePath: resolved, raw: null };
  }
  if (stat.isDirectory()) {
    const diagnosticPath = path.join(resolved, 'diagnostic-report.json');
    const diagnostic = await readJson(diagnosticPath).catch(() => null);
    return { sourcePath: resolved, raw: readJsonObject(diagnostic) };
  }
  const parsed = await readJson(resolved).catch(() => null);
  return { sourcePath: resolved, raw: readJsonObject(parsed) };
}

function shouldIgnoreInferredTouchedPath(relativePath) {
  const normalized = String(relativePath ?? '').split(path.sep).join('/');
  return [
    '.git/',
    'node_modules/',
    '.openprd/',
    'dist/',
    'build/',
    'coverage/',
    'test-results/',
    '.next/',
    '.turbo/',
  ].some((prefix) => normalized.startsWith(prefix));
}

function looksLikeInferredTouchedFile(relativePath) {
  const normalized = String(relativePath ?? '').split(path.sep).join('/');
  if (!normalized || shouldIgnoreInferredTouchedPath(normalized)) {
    return false;
  }
  if (normalized === 'AGENTS.md' || /^docs\/basic\//.test(normalized) || /^skills\/.+\/SKILL\.md$/.test(normalized)) {
    return true;
  }
  if (/^(src|app|lib|server|scripts|test|tests|templates)\//.test(normalized)) {
    return true;
  }
  return CODE_EXTENSIONS.has(path.extname(normalized).toLowerCase());
}

async function inferRecentTouchedFiles(projectRoot, options = {}) {
  const limit = Math.max(1, Number(options.limit ?? 8));
  const lookbackMs = Math.max(1, Number(options.lookbackMs ?? (4 * 60 * 60 * 1000)));
  const nowValue = Date.now();
  const collected = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(projectRoot, fullPath).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (shouldIgnoreInferredTouchedPath(`${relativePath}/`)) {
          continue;
        }
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !looksLikeInferredTouchedFile(relativePath)) {
        continue;
      }
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat) continue;
      collected.push({
        path: relativePath,
        mtimeMs: Number(stat.mtimeMs ?? 0),
      });
    }
  }
  await walk(projectRoot);
  const sorted = collected.sort((left, right) => right.mtimeMs - left.mtimeMs || left.path.localeCompare(right.path));
  const recent = sorted.filter((file) => nowValue - file.mtimeMs <= lookbackMs);
  const selected = (recent.length > 0 ? recent : sorted).slice(0, limit).map((file) => file.path);
  return uniq(selected);
}

function buildSyntheticReviewSource(projectRoot, options = {}) {
  const currentSignal = options.signal ? normalizeReviewSignal(projectRoot, options.signal) : null;
  const recentSignals = Array.isArray(options.recentSignals)
    ? options.recentSignals.map((signal) => normalizeReviewSignal(projectRoot, signal))
    : [];
  const touchedFiles = uniq([
    ...normalizeTouchedFiles(projectRoot, options.touchedFiles),
    ...(currentSignal?.touchedFiles ?? []),
    ...recentSignals.flatMap((signal) => signal.touchedFiles),
  ]).slice(0, 8);
  const summaries = uniq([
    currentSignal?.summary,
    ...recentSignals.map((signal) => signal.summary),
  ]).filter(Boolean).slice(0, 6);
  const signalKinds = uniq([
    currentSignal?.kind,
    ...recentSignals.map((signal) => signal.kind),
  ]).filter(Boolean).slice(0, 6);
  const attentionGates = uniq([
    ...(currentSignal?.attentionGates ?? []),
    ...recentSignals.flatMap((signal) => signal.attentionGates ?? []),
  ]);
  const title = firstString(
    options.title,
    summaries[0],
    touchedFiles[0] ? `完成态回顾 ${path.basename(touchedFiles[0])}` : null,
    '已完成任务回顾',
  ) ?? '已完成任务回顾';
  return {
    kind: 'completion-review',
    sourceId: slugify(firstString(options.sourceId, title), 'completion-review'),
    sourcePath: firstString(options.sourcePath, KNOWLEDGE_REVIEW_SIGNAL_LOG),
    primaryPath: firstString(options.sourcePath, KNOWLEDGE_REVIEW_SIGNAL_LOG),
    sourcePaths: [firstString(options.sourcePath, KNOWLEDGE_REVIEW_SIGNAL_LOG)].filter(Boolean),
    title,
    status: currentSignal?.ok === false || currentSignal?.productionReady === false ? 'needs-attention' : 'pass',
    symptoms: summaries,
    attentionGates,
    correlationFields: [],
    extraContextFields: [],
    missingCorrelationFields: [],
    eventNames: signalKinds,
    rootCauseCandidates: touchedFiles.slice(0, 4).map((file) => ({
      title: `复用 ${file} 中已经验证过的实现与回归模式`,
      nextSteps: ['按本轮验证链路补齐最小证据，再决定是否 promote 为项目级 skill。'],
    })),
    evidenceSources: [
      ...touchedFiles.slice(0, 6).map((file) => ({ kind: 'touched-file', path: file })),
      ...signalKinds.slice(0, 4).map((kind) => ({ kind: 'review-signal', path: kind })),
    ],
    queryExamples: [
      touchedFiles.length > 0 ? `先复看本轮改动文件：${touchedFiles.slice(0, 4).join('、')}。` : null,
      signalKinds.length > 0 ? `对齐本轮验证信号：${signalKinds.join('、')}。` : null,
      '把本轮触发条件、适用范围、验证步骤和典型输入输出抽成 candidate，避免只留在当前对话里。',
    ].filter(Boolean),
    abstractPattern: '当一轮实现已经达到可交付状态时，即使没有 turn-state，也要从最近验证信号和最近改动文件中自动抽出可复用的项目经验。',
    triggers: uniq([
      ...summaries,
      ...signalKinds.map((kind) => `完成信号: ${kind}`),
      ...touchedFiles.map((file) => `相关文件: ${file}`),
    ]).slice(0, 8),
    prevention: [
      '任务完成后自动生成 knowledge candidate，再由维护者决定 promote、reject 或 archive。',
      '即使没有 hook turn-state，也要回退到最近验证信号和最近改动文件完成后置沉淀。',
      '保持验证证据、实现文件和知识草案之间的最小关联，减少下次复盘时重新拼上下文的成本。',
    ],
    verificationSteps: [
      ...summaries,
      '确认自动抽象出来的触发条件、适用范围、典型输入输出和验证步骤与本轮交付一致。',
      '再次执行当前主验证命令，确认输出与知识草案描述没有偏差。',
    ].filter(Boolean),
  };
}

function renderList(items, fallback) {
  const list = items.filter(Boolean);
  if (list.length === 0) {
    return `- ${fallback}`;
  }
  return list.map((item) => `- ${item}`).join('\n');
}

function renderKnowledgeDraftSkill({ skillName, candidate, source, relativeCandidateDir }) {
  const abstraction = readJsonObject(candidate.abstraction) ?? {};
  const inspectItems = uniq([
    ...candidate.touchedFiles.map((file) => `\`${file}\``),
    ...source.evidenceSources.map((item) => `\`${item.path}\``),
  ]);
  return `---
name: ${skillName}
description: OpenPrd 在本轮回顾时自动生成的待确认项目经验草案。
---

# ${skillName}

> 状态：draft
> 候选目录：\`${relativeCandidateDir}\`
> Promote：\`openprd quality . --learn --from ${relativeCandidateDir}\`

## 触发条件

${renderList(abstraction.triggerConditions ?? [], '本轮实现已经出现值得复用的排查或修复模式。')}

## 适用范围

${renderList(abstraction.applicability ?? [], '当同类任务再次出现时，优先复用本轮已经验证过的实现与回归模式。')}

## 典型输入

${renderList(abstraction.typicalInputs ?? [], '至少带上当前任务摘要、相关文件和现有验证证据。')}

## 典型输出

${renderList(abstraction.typicalOutputs ?? [], '至少产出 knowledge candidate、诊断报告和可复用验证结论。')}

## 下次触发时先看什么

${renderList(inspectItems, '先看本轮 touched files 和已有诊断证据。')}

## 可复用模式

${renderList(source.rootCauseCandidates.map((candidateItem) => candidateItem.title), '先按本轮诊断线索复走一次，再补最小必要证据。')}

## 验证方式

${renderList(abstraction.verificationSteps ?? [], '修复后重新走一遍本轮验证链路，确认问题不再复现。')}
`;
}

function buildCandidateDiagnosticReport({ candidateId, title, summary, source, touchedFiles, reviewSignals, abstraction }) {
  return {
    id: candidateId,
    knowledgeCandidateId: candidateId,
    title,
    status: reviewSignals.some((signal) => signal.ok === false || signal.productionReady === false) ? 'needs-attention' : 'pass',
    summary: {
      title,
      status: reviewSignals.some((signal) => signal.ok === false || signal.productionReady === false) ? 'needs-attention' : 'pass',
      message: summary,
    },
    problem: summary,
    message: summary,
    touchedFiles,
    reviewSignals,
    abstraction,
    runtimeEvents: reviewSignals.map((signal) => ({
      eventName: signal.kind,
      status: signal.ok === false || signal.productionReady === false ? 'needs-attention' : 'pass',
      message: signal.summary ?? signal.kind,
      touchedFiles: signal.touchedFiles,
      at: signal.at,
    })),
    timeline: reviewSignals.map((signal) => ({
      event: signal.kind,
      message: signal.summary ?? signal.kind,
      status: signal.ok === false || signal.productionReady === false ? 'needs-attention' : 'pass',
      line: null,
      at: signal.at,
    })),
    rootCauseCandidates: source.rootCauseCandidates.length > 0
      ? source.rootCauseCandidates
      : source.symptoms.map((symptom) => ({ title: symptom })),
    verificationSteps: uniq([
      ...reviewSignals.map((signal) => signal.summary).filter(Boolean),
      ...source.verificationSteps,
    ]),
    prevention: uniq([
      '把本轮修复抽象成项目级 skill，而不是只保留一次性聊天上下文。',
      ...source.prevention,
    ]),
  };
}

function buildKnowledgeCandidateMeta({
  projectRoot,
  candidateId,
  candidatePath,
  draftSkillPath,
  candidateDir,
  source,
  title,
  summary,
  categories,
  reasons,
  touchedFiles,
  touchedFileSource,
  reviewSignals,
  existingCandidate,
  abstraction,
}) {
  const existingStatus = normalizeCandidateStatus(existingCandidate?.status);
  return {
    version: 1,
    candidateId,
    status: isReviewedKnowledgeCandidateStatus(existingStatus) ? existingStatus : 'pending-review',
    createdAt: existingCandidate?.createdAt ?? timestamp(),
    updatedAt: timestamp(),
    sourceKind: source.kind,
    sourceRef: source.sourceId,
    title,
    summary,
    categories,
    reasons,
    touchedFiles,
    touchedFileSource,
    reviewSignals,
    abstraction,
    files: {
      candidate: candidatePath,
      candidateDir,
      draftSkill: draftSkillPath,
    },
    suggestedLearnCommand: `openprd quality . --learn --from ${path.relative(projectRoot, candidateDir) || '.'}`,
  };
}

function cleanUserFacingExperienceText(value, fallback = null, max = 160) {
  let text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return fallback;
  }
  const replacements = [
    [/\bknowledge candidate\b/gi, '候选经验'],
    [/\bdraft skill\b/gi, '项目经验'],
    [/\bskill\b/gi, '经验'],
    [/\bpromote\b/gi, '保留'],
    [/\breject\b/gi, '暂不保留'],
    [/\barchive\b/gi, '先归档'],
    [/\bhook\b/gi, '收尾流程'],
    [/\bharness\b/gi, '项目流程'],
    [/\bturn-state\b/gi, '本轮记录'],
    [/\brun-state\b/gi, '当前状态'],
    [/\bOpenPrd\b/gi, '当前流程'],
    [/\.openprd\/[^\s，。；]+/g, ''],
    [/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+/g, ''],
  ];
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  text = text
    .replace(/[()]/g, '')
    .replace(/[;；]+/g, '，')
    .replace(/\s+,/g, '，')
    .replace(/,+/g, '，')
    .replace(/\s+/g, ' ')
    .replace(/^[，,。\s]+|[，,。\s]+$/g, '')
    .trim();
  if (!text) {
    return fallback;
  }
  return trimPreview(text, max) ?? fallback;
}

function observedSituationFromSource({ source, reviewSignals, touchedFiles }) {
  const direct = [
    source.symptoms[0],
    reviewSignals.find((signal) => signal.summary)?.summary,
    source.abstractPattern,
    source.title,
  ]
    .map((item) => cleanUserFacingExperienceText(item))
    .find(Boolean);
  if (direct) {
    return direct;
  }
  if (touchedFiles.length > 0) {
    return `这次任务在 ${touchedFiles.slice(0, 3).join('、')} 这些位置形成了一套后续可能会重复用到的处理方式。`;
  }
  return '这次任务里已经形成了一种以后可能重复出现的处理方式。';
}

function plannedExperienceFromContext({ source, categories, touchedFiles }) {
  const touchesDocs = touchedFiles.some((file) => String(file).startsWith('docs/basic/'));
  const touchesTests = touchedFiles.some((file) => /^(test|tests)\//.test(String(file)));
  if (categories.includes('agent-misjudgment')) {
    return '以后做类似任务收尾时，我会先把本次情况、准备保留的经验和适用场景整理清楚，再用人话确认是否保留为当前项目经验。';
  }
  if (categories.includes('hidden-debug-knowledge')) {
    return '以后再遇到类似问题时，我会优先复用这次已经验证过的判断依据、排查顺序和收尾检查方式，而不是从零开始重新摸索。';
  }
  if (touchesDocs && touchesTests) {
    return '以后再遇到类似任务时，我会把处理方式、相关说明和验证方式一起整理成可复用经验，减少重复补充。';
  }
  if (touchesTests) {
    return '以后再遇到类似任务时，我会连同这次已经跑通的验证方式一起复用，避免只记住改法、忘记检查方式。';
  }
  const prevention = cleanUserFacingExperienceText(source.prevention[0]);
  if (prevention) {
    return prevention;
  }
  return '以后再遇到类似任务时，我会把这次已经验证过的处理顺序和注意事项保留下来，作为当前项目的默认经验。';
}

function futureHandlingFromContext({ categories, touchedFiles }) {
  const touchesDocs = touchedFiles.some((file) => String(file).startsWith('docs/basic/'));
  if (categories.includes('agent-misjudgment')) {
    return '以后如果再遇到类似任务，我会优先按这套说法和处理顺序来收尾，减少重复解释和重复判断。';
  }
  if (touchesDocs) {
    return '以后如果再遇到类似任务，我会优先把处理方式和相关说明一起整理，减少来回补充。';
  }
  return '以后如果再遇到类似任务，我会优先按这套经验来处理，减少重复解释和重复判断。';
}

function knowledgeReviewStateNote(status) {
  const normalized = normalizeCandidateStatus(status);
  if (normalized === 'rejected') {
    return '这条经验之前已经标记为暂不保留，本轮不会再次向用户追问。';
  }
  if (normalized === 'archived') {
    return '这条经验之前已经先归档，本轮不会再次向用户追问。';
  }
  if (normalized === 'promoted' || normalized === 'merged') {
    return '这条经验已经保留为当前项目经验，本轮不需要再次确认。';
  }
  return null;
}

function buildKnowledgeUserFacingExperience({ candidate, source, touchedFiles, reviewSignals, categories }) {
  const observedSituation = observedSituationFromSource({ source, reviewSignals, touchedFiles });
  const plannedExperience = plannedExperienceFromContext({ source, categories, touchedFiles });
  const futureHandling = futureHandlingFromContext({ categories, touchedFiles });
  const scopeNote = '这条经验只会保留在当前项目里。';
  const reviewStateNote = knowledgeReviewStateNote(candidate.status);
  const shouldAskUser = normalizeCandidateStatus(candidate.status) === 'pending-review';
  const question = shouldAskUser ? '要我把它一起保留下来吗？' : null;
  const messageLines = [
    '这次我观察到一个以后可能重复出现的情况：',
    observedSituation,
    '',
    '我计划保留一条项目经验：',
    plannedExperience,
    '',
    futureHandling,
    scopeNote,
    question ?? reviewStateNote,
  ].filter(Boolean);
  return {
    observedSituation,
    plannedExperience,
    futureHandling,
    scopeNote,
    question,
    reviewStateNote,
    shouldAskUser,
    projectOnly: true,
    message: messageLines.join('\n'),
  };
}

export async function recordKnowledgeReviewSignal(projectRoot, signal = {}) {
  const statePath = knowledgePath(projectRoot, OPENPRD_HARNESS_TURN_STATE);
  const normalized = normalizeReviewSignal(projectRoot, signal);
  await appendJsonl(knowledgePath(projectRoot, KNOWLEDGE_REVIEW_SIGNAL_LOG), normalized).catch(() => null);
  if (!(await exists(statePath))) {
    return { ok: true, recorded: false, reason: 'turn-state-missing', turnStatePath: statePath };
  }
  const state = await readJson(statePath).catch(() => null);
  const current = readJsonObject(state);
  if (!current) {
    return { ok: true, recorded: false, reason: 'turn-state-invalid', turnStatePath: statePath };
  }
  const existingSignals = Array.isArray(current.reviewSignals) ? current.reviewSignals : [];
  const reviewSignals = [normalized, ...existingSignals.filter((item) => item?.id !== normalized.id)].slice(0, 24);
  const touchedFiles = uniq([
    ...normalizeStringList(current.touchedFiles).map((file) => toRelativeProjectPath(projectRoot, file)),
    ...normalized.touchedFiles,
  ]);
  const runtimeEvents = Array.isArray(current.runtimeEvents) ? current.runtimeEvents : [];
  const timeline = Array.isArray(current.timeline) ? current.timeline : [];
  await writeJson(statePath, {
    ...current,
    touchedFiles,
    reviewSignals,
    runtimeEvents: [
      {
        eventName: normalized.kind,
        status: normalized.ok === false || normalized.productionReady === false ? 'needs-attention' : 'pass',
        message: normalized.summary ?? normalized.kind,
        at: normalized.at,
      },
      ...runtimeEvents,
    ].slice(0, 32),
    timeline: [
      {
        event: normalized.kind,
        message: normalized.summary ?? normalized.kind,
        status: normalized.ok === false || normalized.productionReady === false ? 'needs-attention' : 'pass',
        at: normalized.at,
      },
      ...timeline,
    ].slice(0, 32),
    updatedAt: timestamp(),
  });
  return {
    ok: true,
    recorded: true,
    turnStatePath: statePath,
  };
}

export async function reviewKnowledgeWorkspace(projectRoot, options = {}) {
  await ensureKnowledgeWorkspace(projectRoot);
  const recentSignals = await readRecentKnowledgeReviewSignals(projectRoot, { limit: 24 });
  const latestQuality = await readJson(knowledgePath(projectRoot, QUALITY_LATEST_REPORT)).catch(() => null);
  const latestReportPath = firstString(options.latestReportPath, latestQuality?.jsonPath, latestQuality?.reportPath);
  const turnStateSource = (await exists(knowledgePath(projectRoot, OPENPRD_HARNESS_TURN_STATE))) ? OPENPRD_HARNESS_TURN_STATE : null;
  const from = firstString(options.from, turnStateSource, latestReportPath);
  const rawInput = from ? await loadRawReviewInput(projectRoot, from) : { sourcePath: null, raw: null };
  const resolved = from
    ? await resolveQualityLearningSource(projectRoot, {
      from,
      latestReportPath,
      requiredCorrelationFields: Array.isArray(options.requiredCorrelationFields) ? options.requiredCorrelationFields : [],
    })
    : { ok: false, error: 'no-review-source' };
  const source = resolved.ok
    ? resolved.source
    : buildSyntheticReviewSource(projectRoot, {
      signal: options.signal,
      recentSignals,
      touchedFiles: options.touchedFiles,
      sourcePath: rawInput.sourcePath ?? latestReportPath ?? KNOWLEDGE_REVIEW_SIGNAL_LOG,
      title: firstString(options.title, readJsonObject(rawInput.raw)?.title),
    });
  if (!resolved.ok && source.evidenceSources.length === 0 && source.rootCauseCandidates.length === 0) {
    return {
      ok: true,
      action: 'quality-knowledge-review',
      skipped: true,
      reason: resolved.error,
    };
  }
  const raw = readJsonObject(rawInput.raw) ?? {};
  const explicitTouchedFiles = normalizeTouchedFiles(projectRoot, options.touchedFiles);
  const optionSignal = options.signal ? normalizeReviewSignal(projectRoot, options.signal) : null;
  const rawTouchedFiles = normalizeTouchedFiles(projectRoot, raw.touchedFiles);
  const reviewContext = buildReviewContext(projectRoot, raw, {
    ...options,
    recentSignals,
  });
  let touchedFiles = reviewContext.touchedFiles;
  let touchedFileSource = explicitTouchedFiles.length > 0
    ? 'explicit'
    : optionSignal?.touchedFiles?.length
      ? 'signal'
      : rawTouchedFiles.length > 0
        ? 'review-source'
        : (recentSignals.some((signal) => signal.touchedFiles.length > 0) ? 'recent-signals' : null);
  if (touchedFiles.length === 0) {
    touchedFiles = await inferRecentTouchedFiles(projectRoot, { limit: 8 });
    if (touchedFiles.length > 0) {
      touchedFileSource = 'inferred-recent-files';
    }
  }
  const substantiveTouchedFiles = touchedFiles.filter(isSubstantiveTouchedFile);
  const reviewSignals = reviewContext.reviewSignals;
  const categories = buildKnowledgeCategories({ source, touchedFiles: substantiveTouchedFiles, reviewSignals });
  const reasons = categories.map(categoryReason);
  const hasStrongSignal = categories.length > 0
    || source.rootCauseCandidates.length > 0
    || source.symptoms.length > 1
    || source.kind === 'completion-review'
    || reviewSignals.some((signal) => signal.ok === true || signal.productionReady === true);

  if (substantiveTouchedFiles.length === 0 || !hasStrongSignal) {
    return {
      ok: true,
      action: 'quality-knowledge-review',
      skipped: true,
      reason: substantiveTouchedFiles.length === 0 ? 'no-substantive-touched-files' : 'no-knowledge-signal',
      sourceKind: source.kind,
      sourcePath: source.sourcePath,
    };
  }

  const title = buildTurnReviewTitle(raw, source);
  const rawCandidateRef = firstString(raw.knowledgeCandidateId, raw.id);
  const candidateId = rawCandidateRef
    ? (rawCandidateRef.startsWith('candidate-') ? rawCandidateRef : `candidate-${slugify(rawCandidateRef, 'knowledge')}`)
    : `candidate-${slugify(source.sourceId ?? title, 'knowledge')}`;
  const promotedSource = { ...source, sourceId: candidateId };
  const names = deriveKnowledgeNames(promotedSource);
  const candidateDir = knowledgePath(projectRoot, cjoin(KNOWLEDGE_CANDIDATES_DIR, candidateId));
  const candidatePath = path.join(candidateDir, 'candidate.json');
  const diagnosticReportPath = path.join(candidateDir, 'diagnostic-report.json');
  const rootCausePath = path.join(candidateDir, 'root-cause-candidates.json');
  const timelinePath = path.join(candidateDir, 'timeline.json');
  const draftSkillPath = knowledgePath(projectRoot, cjoin(KNOWLEDGE_DRAFTS_DIR, names.skillName, 'SKILL.md'));
  const existingCandidate = await readJson(candidatePath).catch(() => null);
  const relativeCandidateDir = path.relative(projectRoot, candidateDir).split(path.sep).join('/');
  const relativeDraftSkillPath = path.relative(projectRoot, draftSkillPath).split(path.sep).join('/');
  const reviewSummary = [
    `本轮围绕 ${substantiveTouchedFiles.length} 个可沉淀文件生成回顾。`,
    reasons[0] ?? '这次实现已经具备项目级经验抽象价值。',
    reviewSignals.length > 0 ? `已记录 ${reviewSignals.length} 条回顾信号。` : null,
    touchedFileSource === 'inferred-recent-files' ? '本轮 touched files 来自最近修改文件推断。' : null,
  ].filter(Boolean).join(' ');
  const draftCandidate = buildKnowledgeCandidateMeta({
    projectRoot,
    candidateId,
    candidatePath,
    draftSkillPath,
    candidateDir,
    source: promotedSource,
    title,
    summary: reviewSummary,
    categories,
    reasons,
    touchedFiles: substantiveTouchedFiles,
    touchedFileSource,
    reviewSignals,
    existingCandidate: readJsonObject(existingCandidate) ?? null,
    abstraction: null,
  });
  const abstraction = buildKnowledgeAbstraction({
    candidate: draftCandidate,
    source,
    touchedFiles: substantiveTouchedFiles,
    reviewSignals,
    relativeCandidateDir,
    relativeDraftSkillPath,
  });
  const candidate = {
    ...draftCandidate,
    abstraction,
  };
  const userFacingExperience = buildKnowledgeUserFacingExperience({
    candidate,
    source,
    touchedFiles: substantiveTouchedFiles,
    reviewSignals,
    categories,
  });
  await writeJson(candidatePath, candidate);
  await writeJson(diagnosticReportPath, buildCandidateDiagnosticReport({
    candidateId,
    title,
    summary: reviewSummary,
    source,
    touchedFiles: substantiveTouchedFiles,
    reviewSignals,
    abstraction,
  }));
  await writeJson(rootCausePath, source.rootCauseCandidates.length > 0 ? source.rootCauseCandidates : substantiveTouchedFiles.map((file) => ({ title: `Inspect ${file}` })));
  await writeJson(timelinePath, reviewSignals.map((signal) => ({
    event: signal.kind,
    message: signal.summary ?? signal.kind,
    status: signal.ok === false || signal.productionReady === false ? 'needs-attention' : 'pass',
    at: signal.at,
  })));
  await writeText(draftSkillPath, renderKnowledgeDraftSkill({
    skillName: names.skillName,
    candidate,
    source,
    relativeCandidateDir,
  }));

  const index = await readKnowledgeIndex(projectRoot);
  await writeKnowledgeIndex(projectRoot, {
    ...index,
    candidates: upsertBy(index.candidates, 'candidateId', {
      candidateId,
      status: candidate.status,
      path: candidatePath,
      sourceKind: promotedSource.kind,
      sourceRef: promotedSource.sourceId,
      title,
      draftSkillPath,
    }),
    drafts: upsertBy(index.drafts, 'skillName', {
      skillName: names.skillName,
      path: draftSkillPath,
      candidateId,
      status: candidate.status,
    }),
  });

  return {
    ok: true,
    action: 'quality-knowledge-review',
    skipped: false,
    projectRoot,
    sourceKind: source.kind,
    sourcePath: source.sourcePath,
    candidateId,
    skillName: names.skillName,
    categories,
    reasons,
    status: candidate.status,
    summary: reviewSummary,
    userFacingExperience,
    suggestedLearnCommand: candidate.suggestedLearnCommand,
    files: {
      candidate: candidatePath,
      candidateDir,
      diagnosticReport: diagnosticReportPath,
      rootCauseCandidates: rootCausePath,
      timeline: timelinePath,
      draftSkill: draftSkillPath,
      index: knowledgePath(projectRoot, KNOWLEDGE_INDEX),
    },
  };
}

function candidateIdFromSourcePath(projectRoot, sourcePath) {
  if (!sourcePath) return null;
  const relative = toRelativeProjectPath(projectRoot, sourcePath);
  const match = relative.match(/^\.openprd\/knowledge\/candidates\/([^/]+)/);
  return match ? match[1] : null;
}

function candidateIdFromPath(projectRoot, candidatePath) {
  const direct = candidateIdFromSourcePath(projectRoot, candidatePath);
  if (direct) return direct;
  const basename = path.basename(String(candidatePath ?? ''));
  return basename && basename !== 'candidate.json' ? basename : null;
}

async function readCandidateById(projectRoot, candidateId) {
  if (!candidateId) return null;
  const candidatePath = knowledgePath(projectRoot, cjoin(KNOWLEDGE_CANDIDATES_DIR, candidateId, 'candidate.json'));
  const candidate = await readJson(candidatePath).catch(() => null);
  if (!candidate) return null;
  return {
    ...candidate,
    candidateId: candidate.candidateId ?? candidate.id ?? candidateId,
    status: normalizeCandidateStatus(candidate.status),
    files: {
      ...(candidate.files ?? {}),
      candidate: candidate.files?.candidate ?? candidatePath,
      candidateDir: candidate.files?.candidateDir ?? path.dirname(candidatePath),
    },
  };
}

function candidateIndexEntry(projectRoot, candidate, patch = {}) {
  const candidateId = candidate.candidateId ?? candidate.id ?? patch.candidateId;
  const candidatePath = candidate.files?.candidate
    ?? knowledgePath(projectRoot, cjoin(KNOWLEDGE_CANDIDATES_DIR, candidateId, 'candidate.json'));
  return {
    candidateId,
    status: normalizeCandidateStatus(candidate.status),
    path: candidatePath,
    sourceKind: candidate.sourceKind ?? null,
    sourceRef: candidate.sourceRef ?? null,
    title: candidate.title ?? candidateId,
    draftSkillPath: candidate.files?.draftSkill ?? null,
    ...patch,
  };
}

async function syncKnowledgeCandidateIndex(projectRoot, candidate, patch = {}) {
  const index = await readKnowledgeIndex(projectRoot);
  const entry = candidateIndexEntry(projectRoot, candidate, patch);
  await writeKnowledgeIndex(projectRoot, {
    ...index,
    candidates: upsertBy(index.candidates, 'candidateId', entry),
    drafts: entry.draftSkillPath
      ? upsertBy(index.drafts, 'skillName', {
          skillName: path.basename(path.dirname(entry.draftSkillPath)),
          path: entry.draftSkillPath,
          candidateId: entry.candidateId,
          status: entry.status,
        })
      : index.drafts,
  });
  return entry;
}

function mergeCandidateWithIndex(candidate, indexEntry, projectRoot) {
  const candidateId = candidate?.candidateId ?? candidate?.id ?? indexEntry?.candidateId ?? candidateIdFromPath(projectRoot, indexEntry?.path);
  const status = resolveCandidateStatus(candidate?.status, indexEntry?.status);
  const candidatePath = candidate?.files?.candidate
    ?? indexEntry?.path
    ?? (candidateId ? knowledgePath(projectRoot, cjoin(KNOWLEDGE_CANDIDATES_DIR, candidateId, 'candidate.json')) : null);
  const draftSkillPath = candidate?.files?.draftSkill ?? indexEntry?.draftSkillPath ?? null;
  return {
    ...(indexEntry ?? {}),
    ...(candidate ?? {}),
    candidateId,
    status,
    statusGroup: candidateStatusGroup(status),
    pending: isPendingKnowledgeCandidateStatus(status),
    reviewed: isReviewedKnowledgeCandidateStatus(status),
    path: candidatePath,
    draftSkillPath,
    title: candidate?.title ?? indexEntry?.title ?? candidateId,
    sourceKind: candidate?.sourceKind ?? indexEntry?.sourceKind ?? null,
    sourceRef: candidate?.sourceRef ?? indexEntry?.sourceRef ?? null,
    files: {
      ...(candidate?.files ?? {}),
      candidate: candidatePath,
      candidateDir: candidate?.files?.candidateDir ?? (candidatePath ? path.dirname(candidatePath) : null),
      draftSkill: draftSkillPath,
    },
  };
}

function buildCandidateCounts(candidates) {
  const counts = {
    total: candidates.length,
    pending: 0,
    promoted: 0,
    rejected: 0,
    archived: 0,
    reviewed: 0,
    byStatus: {},
  };
  for (const candidate of candidates) {
    counts.byStatus[candidate.status] = (counts.byStatus[candidate.status] ?? 0) + 1;
    counts[candidate.statusGroup] = (counts[candidate.statusGroup] ?? 0) + 1;
  }
  return counts;
}

function buildKnowledgeMatchQuery(options = {}) {
  const candidateFields = [
    options.message,
    options.prompt,
    options.promptPreview,
    options.recommendationTitle,
    options.recommendationReason,
    options.activeChange,
    options.nextTaskTitle,
    ...(normalizeStringList(options.relatedFiles)),
  ].filter(Boolean);
  const text = candidateFields.join('\n');
  return {
    text,
    normalizedText: normalizeSearchText(text),
    tokens: normalizeSearchTokens(text),
  };
}

function scoreKnowledgeSkillMatch(skill, query) {
  const fileHints = uniq([
    ...skill.touchedFiles,
    ...skill.touchedFiles.map((file) => path.basename(file)),
    ...skill.evidencePaths,
    ...skill.evidencePaths.map((file) => path.basename(file)),
  ]);
  const fields = [
    skill.skillName,
    skill.description,
    skill.summary,
    ...skill.categories,
    ...skill.triggerHints,
    ...skill.rootCauseLabels,
    ...fileHints,
  ];
  const result = scoreQueryAgainstFields(query.normalizedText, query.tokens, fields);
  return {
    score: result.score,
    matchedOn: result.matchedOn,
    matchSummary: result.matchedOn.length > 0
      ? `命中 ${result.matchedOn.slice(0, 3).join(' / ')}`
      : '根据当前上下文自动命中',
  };
}

export async function resolveKnowledgeSkillMatches(projectRoot, options = {}) {
  await ensureKnowledgeWorkspace(projectRoot);
  const { skills } = await hydrateKnowledgeSkills(projectRoot);
  const query = buildKnowledgeMatchQuery(options);
  if (!query.normalizedText) {
    return {
      ok: true,
      action: 'knowledge-match',
      projectRoot,
      query: '',
      matched: [],
      summary: {
        matched: 0,
      },
    };
  }
  const matches = skills
    .map((skill) => {
      const match = scoreKnowledgeSkillMatch(skill, query);
      return match.score > 0
        ? {
            ...skill,
            score: match.score,
            matchedOn: match.matchedOn,
            matchSummary: match.matchSummary,
          }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.skillName.localeCompare(right.skillName))
    .slice(0, Math.max(1, Number(options.limit ?? 3)));
  return {
    ok: true,
    action: 'knowledge-match',
    projectRoot,
    query: trimPreview(query.text, 320),
    matched: matches,
    summary: {
      matched: matches.length,
    },
  };
}

function adoptionStageField(stage) {
  if (stage === 'referenced') {
    return { count: 'referencedCount', at: 'lastReferencedAt' };
  }
  if (stage === 'injected') {
    return { count: 'injectedCount', at: 'lastInjectedAt' };
  }
  return { count: 'hitCount', at: 'lastHitAt' };
}

export async function recordKnowledgeSkillAdoption(projectRoot, options = {}) {
  const requestedStages = uniq(normalizeStringList(options.stages ?? [options.stage]))
    .filter((stage) => ['hit', 'referenced', 'injected'].includes(stage));
  if (requestedStages.length === 0) {
    return {
      ok: true,
      action: 'knowledge-adoption',
      projectRoot,
      updated: 0,
      stages: [],
      summary: buildKnowledgeAdoptionSummary([]),
    };
  }
  const matchedSkills = normalizeArray(options.matches)
    .map((skill) => normalizeSkillIndexEntry(skill))
    .filter((skill) => skill.skillName);
  if (matchedSkills.length === 0) {
    const { skills } = await hydrateKnowledgeSkills(projectRoot);
    return {
      ok: true,
      action: 'knowledge-adoption',
      projectRoot,
      updated: 0,
      stages: requestedStages,
      summary: buildKnowledgeAdoptionSummary(skills),
    };
  }

  const { index, skills } = await hydrateKnowledgeSkills(projectRoot);
  const nowValue = timestamp();
  const skillNameSet = new Set(matchedSkills.map((skill) => skill.skillName));
  const nextSkills = [];
  let updated = 0;
  for (const skill of skills) {
    if (!skillNameSet.has(skill.skillName)) {
      nextSkills.push(skill);
      continue;
    }
    const match = matchedSkills.find((item) => item.skillName === skill.skillName) ?? skill;
    const adoption = normalizeSkillAdoption(skill.adoption);
    for (const stage of requestedStages) {
      const field = adoptionStageField(stage);
      adoption[field.count] += 1;
      adoption[field.at] = nowValue;
      adoption.lastSource = firstString(options.source, adoption.lastSource);
      adoption.recentEvents = [
        {
          at: nowValue,
          stage,
          source: firstString(options.source),
          sessionId: firstString(options.sessionId),
          promptPreview: trimPreview(options.promptPreview),
          matchSummary: firstString(match.matchSummary),
          matchedOn: normalizeStringList(match.matchedOn).slice(0, 4),
        },
        ...adoption.recentEvents,
      ].slice(0, 12);
      await appendJsonl(knowledgePath(projectRoot, KNOWLEDGE_ADOPTION_LOG), {
        version: 1,
        at: nowValue,
        stage,
        skillName: skill.skillName,
        source: firstString(options.source),
        sessionId: firstString(options.sessionId),
        promptPreview: trimPreview(options.promptPreview),
        matchSummary: firstString(match.matchSummary),
        matchedOn: normalizeStringList(match.matchedOn).slice(0, 6),
      });
    }
    nextSkills.push({
      ...skill,
      adoption,
    });
    updated += 1;
  }
  await writeKnowledgeIndex(projectRoot, {
    ...index,
    skills: nextSkills,
  });
  return {
    ok: true,
    action: 'knowledge-adoption',
    projectRoot,
    updated,
    stages: requestedStages,
    summary: buildKnowledgeAdoptionSummary(nextSkills),
  };
}

export async function listKnowledgeCandidates(projectRoot, options = {}) {
  await ensureKnowledgeWorkspace(projectRoot);
  const index = await readKnowledgeIndex(projectRoot);
  const byId = new Map();
  for (const entry of index.candidates) {
    if (!entry?.candidateId) continue;
    byId.set(entry.candidateId, mergeCandidateWithIndex(null, entry, projectRoot));
  }
  const candidateRoot = knowledgePath(projectRoot, KNOWLEDGE_CANDIDATES_DIR);
  const dirs = await fs.readdir(candidateRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    const candidate = await readCandidateById(projectRoot, entry.name);
    if (!candidate) continue;
    byId.set(candidate.candidateId, mergeCandidateWithIndex(candidate, byId.get(candidate.candidateId), projectRoot));
  }
  const all = [...byId.values()].sort((left, right) => {
    const leftAt = left.updatedAt ?? left.reviewedAt ?? left.createdAt ?? '';
    const rightAt = right.updatedAt ?? right.reviewedAt ?? right.createdAt ?? '';
    return String(rightAt).localeCompare(String(leftAt));
  });
  const status = normalizeCandidateStatus(options.status ?? 'pending-review');
  const filtered = status === 'all'
    ? all
    : all.filter((candidate) => normalizeCandidateStatus(candidate.status) === status);
  const pending = all.filter((candidate) => candidate.pending);
  const reviewed = all.filter((candidate) => !candidate.pending);
  return {
    ok: true,
    action: 'knowledge-candidates',
    projectRoot,
    status: options.status ?? 'pending-review',
    candidates: filtered,
    pending,
    reviewed,
    counts: buildCandidateCounts(all),
    files: {
      knowledgeIndex: knowledgePath(projectRoot, KNOWLEDGE_INDEX),
      candidatesDir: candidateRoot,
    },
  };
}

async function updateKnowledgeCandidateStatus(projectRoot, options = {}) {
  await ensureKnowledgeWorkspace(projectRoot);
  const candidateId = options.id ?? candidateIdFromPath(projectRoot, options.path);
  if (!candidateId) {
    return {
      ok: false,
      action: `knowledge-${options.action ?? 'update'}`,
      projectRoot,
      errors: ['Knowledge candidate id is required.'],
    };
  }
  const candidate = await readCandidateById(projectRoot, candidateId);
  if (!candidate) {
    return {
      ok: false,
      action: `knowledge-${options.action ?? 'update'}`,
      projectRoot,
      candidateId,
      errors: [`Knowledge candidate not found: ${candidateId}`],
    };
  }
  const status = normalizeCandidateStatus(options.status);
  const nowValue = timestamp();
  const reviewReason = firstString(options.reason, options.notes, options.reviewDecision);
  const patch = {
    status,
    updatedAt: nowValue,
    reviewedAt: status === 'pending-review' ? candidate.reviewedAt ?? null : nowValue,
    reviewedBy: status === 'pending-review' ? candidate.reviewedBy ?? null : firstString(options.reviewedBy, 'codex'),
    reviewDecision: firstString(options.reviewDecision, reviewReason, status),
    reviewReason: reviewReason ?? null,
  };
  if (status === 'rejected') {
    patch.rejectedAt = nowValue;
  }
  if (status === 'archived') {
    patch.archivedAt = nowValue;
  }
  if (status === 'pending-review') {
    patch.restoredAt = nowValue;
    patch.reviewDecision = null;
    patch.reviewReason = null;
  }
  const nextCandidate = {
    ...candidate,
    ...patch,
    files: candidate.files,
  };
  const candidatePath = nextCandidate.files.candidate;
  await writeJson(candidatePath, nextCandidate);
  const indexPatch = {
    ...patch,
    reviewedAt: nextCandidate.reviewedAt,
    reviewedBy: nextCandidate.reviewedBy,
    reviewDecision: nextCandidate.reviewDecision,
    reviewReason: nextCandidate.reviewReason,
  };
  const entry = await syncKnowledgeCandidateIndex(projectRoot, nextCandidate, indexPatch);
  return {
    ok: true,
    action: `knowledge-${options.action ?? status}`,
    projectRoot,
    candidateId,
    candidate: mergeCandidateWithIndex(nextCandidate, entry, projectRoot),
    files: {
      candidate: candidatePath,
      knowledgeIndex: knowledgePath(projectRoot, KNOWLEDGE_INDEX),
    },
  };
}

export async function rejectKnowledgeCandidate(projectRoot, options = {}) {
  return updateKnowledgeCandidateStatus(projectRoot, {
    ...options,
    action: 'reject',
    status: 'rejected',
    reviewDecision: firstString(options.reason, options.notes, 'rejected'),
  });
}

export async function archiveKnowledgeCandidate(projectRoot, options = {}) {
  return updateKnowledgeCandidateStatus(projectRoot, {
    ...options,
    action: 'archive',
    status: 'archived',
    reviewDecision: firstString(options.reason, options.notes, 'archived'),
  });
}

export async function restoreKnowledgeCandidate(projectRoot, options = {}) {
  return updateKnowledgeCandidateStatus(projectRoot, {
    ...options,
    action: 'restore',
    status: 'pending-review',
    reviewDecision: null,
  });
}

export async function markKnowledgeCandidatePromoted(projectRoot, options = {}) {
  await ensureKnowledgeWorkspace(projectRoot);
  const candidateId = candidateIdFromSourcePath(projectRoot, options.sourcePath)
    ?? (Array.isArray(options.sourcePaths)
      ? options.sourcePaths.map((entry) => candidateIdFromSourcePath(projectRoot, entry)).find(Boolean)
      : null);
  if (!candidateId) {
    return { ok: true, updated: false };
  }
  const candidatePath = knowledgePath(projectRoot, cjoin(KNOWLEDGE_CANDIDATES_DIR, candidateId, 'candidate.json'));
  const candidate = await readJson(candidatePath).catch(() => null);
  if (!candidate) {
    return { ok: true, updated: false };
  }
  const nextCandidate = {
    ...candidate,
    candidateId: candidate.candidateId ?? candidate.id ?? candidateId,
    status: 'promoted',
    promotedAt: timestamp(),
    promotedSkillPath: options.skillPath ?? null,
    promotedIncidentPath: options.incidentPath ?? null,
    promotedPatternPath: options.patternPath ?? null,
    updatedAt: timestamp(),
    files: {
      ...(candidate.files ?? {}),
      candidate: candidate.files?.candidate ?? candidatePath,
      candidateDir: candidate.files?.candidateDir ?? path.dirname(candidatePath),
    },
  };
  await writeJson(candidatePath, nextCandidate);
  await syncKnowledgeCandidateIndex(projectRoot, nextCandidate, {
    status: 'promoted',
    promotedAt: nextCandidate.promotedAt,
    promotedSkillPath: nextCandidate.promotedSkillPath,
  });
  return {
    ok: true,
    updated: true,
    candidateId,
    candidatePath,
  };
}

export {
  deriveKnowledgeNames,
  ensureKnowledgeWorkspace,
  isPendingKnowledgeCandidateStatus,
  isReviewedKnowledgeCandidateStatus,
  KNOWLEDGE_ADOPTION_LOG,
  KNOWLEDGE_CANDIDATES_DIR,
  KNOWLEDGE_DRAFTS_DIR,
  KNOWLEDGE_INDEX,
  KNOWLEDGE_SKILLS_DIR,
  normalizeCandidateStatus,
  OPENPRD_HARNESS_TURN_STATE,
  buildKnowledgeAdoptionSummary,
  };
