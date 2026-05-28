import fs from 'node:fs/promises';
import path from 'node:path';
import { appendJsonl, cjoin, exists, readJson, readJsonl, writeJson } from './fs-utils.js';

export const OPENPRD_GROWTH_DIR = path.join('.openprd', 'growth');
export const OPENPRD_GROWTH_CANDIDATES = path.join(OPENPRD_GROWTH_DIR, 'candidates.jsonl');
export const OPENPRD_GROWTH_ACCEPTED = path.join(OPENPRD_GROWTH_DIR, 'accepted.json');
export const OPENPRD_GROWTH_REJECTED = path.join(OPENPRD_GROWTH_DIR, 'rejected.json');
export const OPENPRD_GROWTH_LOCAL_PREFERENCES = path.join(OPENPRD_GROWTH_DIR, 'preferences.local.json');
export const OPENPRD_STANDARDS_CONFIG = path.join('.openprd', 'standards', 'config.json');

export const DEFAULT_GROWTH_CONFIG = {
  enabled: true,
  reviewRequired: true,
  candidateLimit: 200,
  scopes: ['project', 'user-local', 'openprd-core'],
  supportedCandidateTypes: [
    'code-extension',
    'exempt-path-segment',
    'exempt-file-pattern',
    'user-preference',
    'workflow-gotcha',
    'standards-rule',
  ],
};

const SAFE_APPLY_TYPES = new Set(['code-extension', 'exempt-path-segment', 'exempt-file-pattern', 'user-preference']);

function normalizePosixPath(value) {
  return String(value ?? '').split(path.sep).join('/');
}

function normalizeExtension(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  return raw.startsWith('.') ? raw : `.${raw}`;
}

function slug(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'unknown';
}

export function growthCandidateId(type, key) {
  return `${slug(type)}-${slug(key)}`;
}

function growthPath(projectRoot, relativePath) {
  return cjoin(projectRoot, relativePath);
}

function nowIso() {
  return new Date().toISOString();
}

async function readJsonIfExists(filePath, fallback) {
  if (!(await exists(filePath))) return fallback;
  return readJson(filePath).catch(() => fallback);
}

async function readJsonlIfExists(filePath) {
  if (!(await exists(filePath))) return [];
  return readJsonl(filePath).catch(() => []);
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined) : [];
}

function normalizeCandidate(raw = {}) {
  const type = String(raw.type ?? '').trim();
  const key = String(raw.key ?? raw.extension ?? raw.pattern ?? raw.preferenceKey ?? '').trim();
  const id = raw.id ? String(raw.id) : growthCandidateId(type || 'candidate', key || raw.title || raw.path || 'unknown');
  const scope = ['project', 'user-local', 'openprd-core'].includes(raw.scope) ? raw.scope : 'project';
  const status = ['pending', 'applied', 'rejected'].includes(raw.status) ? raw.status : 'pending';
  return {
    version: 1,
    id,
    type,
    key,
    scope,
    status,
    title: String(raw.title ?? `${type}: ${key}`).trim(),
    summary: String(raw.summary ?? '').trim(),
    evidence: normalizeArray(raw.evidence).map((item) => {
      if (typeof item === 'string') return { note: item };
      return item;
    }),
    confidence: typeof raw.confidence === 'number' ? raw.confidence : null,
    suggestedPatch: raw.suggestedPatch ?? null,
    createdAt: raw.createdAt ?? nowIso(),
    updatedAt: raw.updatedAt ?? nowIso(),
  };
}

function latestCandidates(records = []) {
  const byId = new Map();
  for (const record of records) {
    const candidate = normalizeCandidate(record);
    const previous = byId.get(candidate.id);
    if (!previous || String(candidate.updatedAt) >= String(previous.updatedAt)) {
      byId.set(candidate.id, candidate);
    }
  }
  return [...byId.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

async function writeCandidateEvent(projectRoot, candidate, patch = {}) {
  const event = {
    ...candidate,
    ...patch,
    updatedAt: nowIso(),
  };
  await appendJsonl(growthPath(projectRoot, OPENPRD_GROWTH_CANDIDATES), event);
  return normalizeCandidate(event);
}

async function ensureGrowthFiles(projectRoot) {
  await fs.mkdir(growthPath(projectRoot, OPENPRD_GROWTH_DIR), { recursive: true });
  const acceptedPath = growthPath(projectRoot, OPENPRD_GROWTH_ACCEPTED);
  const rejectedPath = growthPath(projectRoot, OPENPRD_GROWTH_REJECTED);
  const localPreferencesPath = growthPath(projectRoot, OPENPRD_GROWTH_LOCAL_PREFERENCES);
  if (!(await exists(acceptedPath))) {
    await writeJson(acceptedPath, { version: 1, candidates: [] });
  }
  if (!(await exists(rejectedPath))) {
    await writeJson(rejectedPath, { version: 1, candidates: [] });
  }
  if (!(await exists(localPreferencesPath))) {
    await writeJson(localPreferencesPath, { version: 1, preferences: {} });
  }
}

export async function initGrowthWorkspace(projectRoot) {
  await ensureGrowthFiles(projectRoot);
  return {
    ok: true,
    action: 'growth-init',
    projectRoot,
    files: {
      dir: OPENPRD_GROWTH_DIR,
      candidates: OPENPRD_GROWTH_CANDIDATES,
      accepted: OPENPRD_GROWTH_ACCEPTED,
      rejected: OPENPRD_GROWTH_REJECTED,
      localPreferences: OPENPRD_GROWTH_LOCAL_PREFERENCES,
    },
  };
}

async function readGrowthState(projectRoot) {
  await ensureGrowthFiles(projectRoot);
  const records = await readJsonlIfExists(growthPath(projectRoot, OPENPRD_GROWTH_CANDIDATES));
  const candidates = latestCandidates(records);
  const accepted = await readJsonIfExists(growthPath(projectRoot, OPENPRD_GROWTH_ACCEPTED), { version: 1, candidates: [] });
  const rejected = await readJsonIfExists(growthPath(projectRoot, OPENPRD_GROWTH_REJECTED), { version: 1, candidates: [] });
  return {
    candidates,
    accepted: normalizeArray(accepted.candidates),
    rejected: normalizeArray(rejected.candidates),
  };
}

export async function observeGrowthWorkspace(projectRoot, rawCandidate = {}) {
  const candidate = normalizeCandidate(rawCandidate);
  if (!candidate.type || !candidate.key) {
    return { ok: false, action: 'growth-observe', skipped: true, reason: 'missing-type-or-key', candidate };
  }
  await ensureGrowthFiles(projectRoot);
  const state = await readGrowthState(projectRoot);
  const existing = state.candidates.find((item) => item.id === candidate.id);
  if (existing?.status === 'applied' || existing?.status === 'rejected') {
    return { ok: true, action: 'growth-observe', skipped: true, reason: `candidate-${existing.status}`, candidate: existing };
  }
  if (existing?.status === 'pending') {
    return { ok: true, action: 'growth-observe', skipped: true, reason: 'candidate-already-pending', candidate: existing };
  }
  const stored = await writeCandidateEvent(projectRoot, candidate);
  return { ok: true, action: 'growth-observe', skipped: false, candidate: stored };
}

export async function reviewGrowthWorkspace(projectRoot) {
  const state = await readGrowthState(projectRoot);
  const pending = state.candidates.filter((candidate) => candidate.status === 'pending');
  return {
    ok: true,
    action: 'growth-review',
    projectRoot,
    pending,
    applied: state.candidates.filter((candidate) => candidate.status === 'applied'),
    rejected: state.candidates.filter((candidate) => candidate.status === 'rejected'),
    summary: {
      pending: pending.length,
      applied: state.candidates.filter((candidate) => candidate.status === 'applied').length,
      rejected: state.candidates.filter((candidate) => candidate.status === 'rejected').length,
    },
    nextActions: pending.length === 0
      ? ['当前没有待确认增长候选。']
      : pending.map((candidate) => `确认后运行 openprd grow . --apply --id ${candidate.id}；不采用则运行 openprd grow . --reject --id ${candidate.id}`),
  };
}

function ensureStandardsConfigShape(config) {
  const next = config && typeof config === 'object' ? { ...config } : {};
  next.developmentStandards = next.developmentStandards && typeof next.developmentStandards === 'object'
    ? { ...next.developmentStandards }
    : {};
  next.developmentStandards.codeFileLines = next.developmentStandards.codeFileLines && typeof next.developmentStandards.codeFileLines === 'object'
    ? { ...next.developmentStandards.codeFileLines }
    : {};
  next.growth = next.growth && typeof next.growth === 'object'
    ? { ...next.growth }
    : { ...DEFAULT_GROWTH_CONFIG };
  return next;
}

function appendUnique(list, value, normalize = (item) => String(item)) {
  const next = normalizeArray(list).map((item) => normalize(item)).filter(Boolean);
  const normalized = normalize(value);
  if (normalized && !next.includes(normalized)) {
    next.push(normalized);
  }
  return next;
}

async function applyStandardsCandidate(projectRoot, candidate) {
  const configPath = growthPath(projectRoot, OPENPRD_STANDARDS_CONFIG);
  if (!(await exists(configPath))) {
    return {
      ok: false,
      errors: [`${OPENPRD_STANDARDS_CONFIG} is required. Run: openprd standards . --init`],
      changed: [],
    };
  }

  const config = ensureStandardsConfigShape(await readJson(configPath));
  const lineConfig = config.developmentStandards.codeFileLines;
  const changed = [];
  if (candidate.type === 'code-extension') {
    const extension = normalizeExtension(candidate.key);
    lineConfig.codeFileExtensions = appendUnique(lineConfig.codeFileExtensions, extension, normalizeExtension);
    changed.push(`developmentStandards.codeFileLines.codeFileExtensions += ${extension}`);
  } else if (candidate.type === 'exempt-path-segment') {
    lineConfig.exemptPathSegments = appendUnique(lineConfig.exemptPathSegments, candidate.key);
    changed.push(`developmentStandards.codeFileLines.exemptPathSegments += ${candidate.key}`);
  } else if (candidate.type === 'exempt-file-pattern') {
    lineConfig.exemptFilePatterns = appendUnique(lineConfig.exemptFilePatterns, candidate.key);
    changed.push(`developmentStandards.codeFileLines.exemptFilePatterns += ${candidate.key}`);
  } else {
    return { ok: false, errors: [`${candidate.type} cannot update standards config automatically.`], changed: [] };
  }
  await writeJson(configPath, config);
  return { ok: true, errors: [], changed };
}

async function applyUserPreferenceCandidate(projectRoot, candidate) {
  const preferencesPath = growthPath(projectRoot, OPENPRD_GROWTH_LOCAL_PREFERENCES);
  const current = await readJsonIfExists(preferencesPath, { version: 1, preferences: {} });
  const preferences = current.preferences && typeof current.preferences === 'object' ? { ...current.preferences } : {};
  preferences[candidate.key] = candidate.suggestedPatch?.value ?? candidate.summary ?? true;
  await writeJson(preferencesPath, { version: 1, preferences, updatedAt: nowIso() });
  return {
    ok: true,
    errors: [],
    changed: [`${OPENPRD_GROWTH_LOCAL_PREFERENCES} preferences.${candidate.key}`],
  };
}

export async function applyGrowthCandidateWorkspace(projectRoot, options = {}) {
  const id = String(options.id ?? '').trim();
  if (!id) {
    return { ok: false, action: 'growth-apply', projectRoot, errors: ['--id is required.'] };
  }
  const state = await readGrowthState(projectRoot);
  const candidate = state.candidates.find((item) => item.id === id);
  if (!candidate) {
    return { ok: false, action: 'growth-apply', projectRoot, errors: [`Growth candidate not found: ${id}`] };
  }
  if (candidate.status !== 'pending') {
    return { ok: false, action: 'growth-apply', projectRoot, candidate, errors: [`Growth candidate is already ${candidate.status}.`] };
  }
  if (!SAFE_APPLY_TYPES.has(candidate.type)) {
    return { ok: false, action: 'growth-apply', projectRoot, candidate, errors: [`Growth candidate type requires manual review: ${candidate.type}`] };
  }

  const applied = candidate.type === 'user-preference'
    ? await applyUserPreferenceCandidate(projectRoot, candidate)
    : await applyStandardsCandidate(projectRoot, candidate);
  if (!applied.ok) {
    return { ok: false, action: 'growth-apply', projectRoot, candidate, errors: applied.errors };
  }

  const stored = await writeCandidateEvent(projectRoot, candidate, {
    status: 'applied',
    appliedAt: nowIso(),
    appliedChanges: applied.changed,
  });
  const acceptedPath = growthPath(projectRoot, OPENPRD_GROWTH_ACCEPTED);
  const accepted = await readJsonIfExists(acceptedPath, { version: 1, candidates: [] });
  const acceptedCandidates = normalizeArray(accepted.candidates).filter((item) => item.id !== stored.id);
  acceptedCandidates.push(stored);
  await writeJson(acceptedPath, { version: 1, candidates: acceptedCandidates });

  return {
    ok: true,
    action: 'growth-apply',
    projectRoot,
    candidate: stored,
    changed: applied.changed,
    errors: [],
  };
}

export async function rejectGrowthCandidateWorkspace(projectRoot, options = {}) {
  const id = String(options.id ?? '').trim();
  if (!id) {
    return { ok: false, action: 'growth-reject', projectRoot, errors: ['--id is required.'] };
  }
  const state = await readGrowthState(projectRoot);
  const candidate = state.candidates.find((item) => item.id === id);
  if (!candidate) {
    return { ok: false, action: 'growth-reject', projectRoot, errors: [`Growth candidate not found: ${id}`] };
  }
  if (candidate.status !== 'pending') {
    return { ok: false, action: 'growth-reject', projectRoot, candidate, errors: [`Growth candidate is already ${candidate.status}.`] };
  }
  const stored = await writeCandidateEvent(projectRoot, candidate, {
    status: 'rejected',
    rejectedAt: nowIso(),
    notes: String(options.notes ?? '').trim() || null,
  });
  const rejectedPath = growthPath(projectRoot, OPENPRD_GROWTH_REJECTED);
  const rejected = await readJsonIfExists(rejectedPath, { version: 1, candidates: [] });
  const rejectedCandidates = normalizeArray(rejected.candidates).filter((item) => item.id !== stored.id);
  rejectedCandidates.push(stored);
  await writeJson(rejectedPath, { version: 1, candidates: rejectedCandidates });

  return {
    ok: true,
    action: 'growth-reject',
    projectRoot,
    candidate: stored,
    errors: [],
  };
}

export async function checkGrowthWorkspace(projectRoot) {
  const state = await readGrowthState(projectRoot);
  const pending = state.candidates.filter((candidate) => candidate.status === 'pending');
  const applied = state.candidates.filter((candidate) => candidate.status === 'applied');
  const rejected = state.candidates.filter((candidate) => candidate.status === 'rejected');
  return {
    ok: true,
    action: 'growth-check',
    projectRoot,
    pending,
    applied,
    rejected,
    summary: {
      pending: pending.length,
      applied: applied.length,
      rejected: rejected.length,
    },
  };
}

export function validateGrowthConfig(config, errors = []) {
  const growth = config?.growth;
  if (!growth) return errors;
  if (growth.enabled !== undefined && typeof growth.enabled !== 'boolean') {
    errors.push(`${OPENPRD_STANDARDS_CONFIG} growth.enabled must be a boolean.`);
  }
  if (growth.reviewRequired !== undefined && growth.reviewRequired !== true) {
    errors.push(`${OPENPRD_STANDARDS_CONFIG} growth.reviewRequired must remain true; shared rules cannot be auto-applied.`);
  }
  if (growth.candidateLimit !== undefined) {
    const limit = Number(growth.candidateLimit);
    if (!Number.isInteger(limit) || limit < 1) {
      errors.push(`${OPENPRD_STANDARDS_CONFIG} growth.candidateLimit must be a positive integer.`);
    }
  }
  return errors;
}

export function buildCodeExtensionCandidate(relativePath, details = {}) {
  const normalized = normalizePosixPath(relativePath);
  const extension = normalizeExtension(path.extname(normalized));
  return normalizeCandidate({
    type: 'code-extension',
    key: extension,
    scope: 'project',
    title: `新增代码文件扩展名 ${extension}`,
    summary: `检测到 ${normalized} 看起来像代码文件，但 ${extension} 尚未纳入 OpenPrd dev-check 代码扩展名配置。`,
    evidence: [
      {
        path: normalized,
        lineCount: details.lineCount ?? null,
        reason: details.reason ?? 'looks-like-code',
      },
    ],
    confidence: details.confidence ?? 0.74,
    suggestedPatch: {
      file: OPENPRD_STANDARDS_CONFIG,
      op: 'append',
      path: 'developmentStandards.codeFileLines.codeFileExtensions',
      value: extension,
    },
  });
}
