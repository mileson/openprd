import fs from 'node:fs/promises';
import path from 'node:path';
import { cjoin, exists, readText, readYaml, writeText, writeYaml } from './fs-utils.js';
import { timestamp } from './time.js';

const BENCHMARK_DIR = cjoin('.openprd', 'benchmarks');
const BENCHMARK_INBOX_DIR = cjoin(BENCHMARK_DIR, 'inbox');
const BENCHMARK_EVIDENCE_DIR = cjoin(BENCHMARK_DIR, 'evidence');
const BENCHMARK_SOURCES_FILE = cjoin(BENCHMARK_DIR, 'sources.yaml');
const BENCHMARK_INDEX_FILE = cjoin(BENCHMARK_DIR, 'index.md');

const OVERBROAD_TRIGGER_TOKENS = [
  'all',
  'any',
  'everything',
  'generic',
  'general',
  '所有',
  '任何',
  '全部',
  '通用',
  '任意任务',
  '任何任务',
  '所有任务',
];

function benchmarkPath(projectRoot, relativePath) {
  return cjoin(projectRoot, relativePath);
}

function slugify(value, fallback = 'benchmark') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function defaultSourcesFile() {
  return {
    version: 1,
    schema: 'openprd.benchmarks.v1',
    updatedAt: timestamp(),
    sources: [],
  };
}

function defaultIndex() {
  return [
    '# OpenPrd Benchmark Registry',
    '',
    '## 规则',
    '',
    '- 项目级 approved benchmark 优先于 OpenPrd 内置 Source Map。',
    '- `inbox/` 里的 candidate 只表示待确认线索，不表示长期最佳实践。',
    '- 每次只挑 1-3 个高相关来源；来源目录不是事实来源。',
    '',
    '## Approved Sources',
    '',
    '- 暂无已批准来源。',
    '',
    '## Candidate Sources',
    '',
    '- 暂无待确认来源。',
    '',
  ].join('\n');
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? '').trim());
}

function isGitHubShorthand(value) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(value ?? '').trim());
}

function normalizeRemoteUrl(value) {
  if (isGitHubShorthand(value)) {
    return `https://github.com/${String(value).trim()}`;
  }
  return String(value ?? '').trim();
}

function toRepoSlug(urlString) {
  try {
    const url = new URL(urlString);
    if (!/github\.com$/i.test(url.hostname)) {
      return null;
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      return null;
    }
    return `${segments[0]}/${segments[1]}`.replace(/\.git$/i, '');
  } catch {
    return null;
  }
}

function inferSourceType(urlString, sourceValue) {
  if (sourceValue?.kind === 'local-file') {
    return 'local-file';
  }
  const normalized = String(urlString ?? '').toLowerCase();
  if (normalized.includes('github.com/')) {
    return 'github';
  }
  if (
    normalized.includes('/docs')
    || normalized.includes('developers.openai.com')
    || normalized.includes('platform.claude.com')
    || normalized.includes('code.claude.com')
    || normalized.includes('ai.google.dev')
  ) {
    return 'official-docs';
  }
  if (
    normalized.includes('/blog/')
    || normalized.includes('/engineering/')
    || normalized.includes('openai.com/index/')
    || normalized.includes('anthropic.com/engineering/')
    || normalized.includes('langchain.com/blog/')
    || normalized.includes('manus.im/blog/')
  ) {
    return 'engineering-article';
  }
  return 'web';
}

function inferResearchMethod(sourceType) {
  if (sourceType === 'github') {
    return 'deepwiki_then_github';
  }
  if (sourceType === 'official-docs') {
    return 'context7_then_official';
  }
  if (sourceType === 'local-file') {
    return 'local_read_first';
  }
  return 'official_page_first';
}

function dedupe(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function inferScenarios(text) {
  const normalized = String(text ?? '').toLowerCase();
  const scenarios = [];
  const add = (value) => {
    if (!scenarios.includes(value)) {
      scenarios.push(value);
    }
  };

  if (/(openprd|openspec|superpowers|prd|product requirements?)/i.test(normalized)) {
    add('openprd-product');
  }
  if (/(cli|doctor|dry-run|command discoverability|developer experience|dx)/i.test(normalized)) {
    add('cli-tooling');
    add('developer-experience');
  }
  if (/(skill|skills|skill discovery|skill install|skill router)/i.test(normalized)) {
    add('skill-design');
  }
  if (/(harness|agent|long-running|workflow loop|managed agents)/i.test(normalized)) {
    add('agent-harness');
  }
  if (/(context engineering|context window|context registry|retrieval)/i.test(normalized)) {
    add('context-engineering');
  }
  if (/(prompt engineering|prompting|system prompt|prompt guidance)/i.test(normalized)) {
    add('prompt-engineering');
  }

  return scenarios;
}

function inferTriggerWhen(scenarios) {
  const lines = [];
  for (const scenario of scenarios) {
    if (scenario === 'openprd-product') {
      lines.push('设计 OpenPrd / PRD 工作流、需求入口、状态承接或生成规则');
    }
    if (scenario === 'cli-tooling') {
      lines.push('设计 CLI 命令、doctor、dry-run、错误提示、确认流程或可发现性');
    }
    if (scenario === 'skill-design') {
      lines.push('设计 skill 触发、metadata、安装方式、自动识别或项目级覆盖规则');
    }
    if (scenario === 'agent-harness') {
      lines.push('设计 Agent harness、长程任务、状态持久化、验证门禁或人工接管');
    }
    if (scenario === 'context-engineering') {
      lines.push('设计上下文常驻、按需检索、registry/索引或证据优先级');
    }
    if (scenario === 'prompt-engineering') {
      lines.push('设计系统提示、skill 提示、任务提示或 structured prompting');
    }
    if (scenario === 'developer-experience') {
      lines.push('设计开发者体验、命令组合方式、输出结构或错误恢复路径');
    }
  }
  return dedupe(lines).slice(0, 3);
}

function inferNotFor(scenarios) {
  const exclusions = [];
  if (!scenarios.includes('openprd-product')) {
    exclusions.push('普通 PRD / 产品流程设计');
  }
  if (!scenarios.includes('cli-tooling')) {
    exclusions.push('与 CLI 无关的一次性 UI 视觉问题');
  }
  if (!scenarios.includes('agent-harness')) {
    exclusions.push('单次脚本报错或纯环境权限问题');
  }
  if (!scenarios.includes('prompt-engineering')) {
    exclusions.push('不涉及提示词或上下文工程的纯实现细节');
  }
  return dedupe(exclusions).slice(0, 3);
}

function titleFromSource(sourceValue, normalizedUrl, sourceType) {
  if (sourceValue.kind === 'local-file') {
    return path.basename(sourceValue.absolutePath);
  }
  if (sourceType === 'github') {
    return toRepoSlug(normalizedUrl) ?? normalizedUrl;
  }
  try {
    const url = new URL(normalizedUrl);
    const lastSegment = url.pathname.split('/').filter(Boolean).at(-1);
    return lastSegment ? `${url.hostname}/${lastSegment}` : url.hostname;
  } catch {
    return normalizedUrl;
  }
}

function normalizeSourceRecord(record) {
  return {
    id: record.id,
    title: record.title,
    scope: record.scope ?? 'project',
    status: record.status,
    sourceType: record.sourceType,
    url: record.url ?? null,
    path: record.path ?? null,
    repo: record.repo ?? null,
    researchMethod: record.researchMethod,
    scenarios: dedupe(record.scenarios ?? []),
    triggerWhen: dedupe(record.triggerWhen ?? []),
    notFor: dedupe(record.notFor ?? []),
    note: record.note ?? null,
    value: record.value ?? null,
    addedAt: record.addedAt ?? timestamp(),
    approvedAt: record.approvedAt ?? null,
    lastVerified: record.lastVerified ?? null,
  };
}

async function ensureOpenPrdWorkspace(projectRoot) {
  const workspaceRoot = cjoin(projectRoot, '.openprd');
  if (!(await exists(workspaceRoot))) {
    throw new Error('Project is not initialized with OpenPrd. Run `openprd init .` first.');
  }
}

async function ensureBenchmarkWorkspace(projectRoot) {
  await ensureOpenPrdWorkspace(projectRoot);
  await fs.mkdir(benchmarkPath(projectRoot, BENCHMARK_INBOX_DIR), { recursive: true });
  await fs.mkdir(benchmarkPath(projectRoot, BENCHMARK_EVIDENCE_DIR), { recursive: true });
  if (!(await exists(benchmarkPath(projectRoot, BENCHMARK_SOURCES_FILE)))) {
    await writeYaml(benchmarkPath(projectRoot, BENCHMARK_SOURCES_FILE), defaultSourcesFile());
  }
  if (!(await exists(benchmarkPath(projectRoot, BENCHMARK_INDEX_FILE)))) {
    await writeText(benchmarkPath(projectRoot, BENCHMARK_INDEX_FILE), `${defaultIndex()}\n`);
  }
}

async function loadApprovedSources(projectRoot) {
  const payload = await readYaml(benchmarkPath(projectRoot, BENCHMARK_SOURCES_FILE)).catch(() => defaultSourcesFile());
  return Array.isArray(payload.sources) ? payload.sources.map(normalizeSourceRecord) : [];
}

async function loadCandidateSources(projectRoot) {
  const inboxDir = benchmarkPath(projectRoot, BENCHMARK_INBOX_DIR);
  const entries = await fs.readdir(inboxDir, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(yaml|yml)$/i.test(entry.name)) {
      continue;
    }
    const filePath = cjoin(inboxDir, entry.name);
    const payload = await readYaml(filePath).catch(() => null);
    if (payload && typeof payload === 'object') {
      candidates.push(normalizeSourceRecord(payload));
    }
  }
  return candidates.sort((left, right) => left.id.localeCompare(right.id));
}

function renderSourceCard(source) {
  const location = source.url ?? source.path ?? 'unknown';
  const scenarios = source.scenarios.length > 0 ? source.scenarios.join(', ') : '未分类';
  const triggerWhen = source.triggerWhen.length > 0 ? source.triggerWhen.join('；') : '待补充';
  const notFor = source.notFor.length > 0 ? source.notFor.join('；') : '待补充';
  const lines = [
    `### ${source.title} \`${source.id}\``,
    '',
    `- 状态: ${source.status}`,
    `- 来源类型: ${source.sourceType}`,
    `- 场景: ${scenarios}`,
    `- 触发: ${triggerWhen}`,
    `- 不适用: ${notFor}`,
    `- 研究方式: ${source.researchMethod}`,
    `- 来源: ${location}`,
  ];
  if (source.note) {
    lines.push(`- 备注: ${source.note}`);
  }
  if (source.value) {
    lines.push(`- 价值: ${source.value}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderBenchmarkIndex(approved, candidates) {
  const lines = [
    '# OpenPrd Benchmark Registry',
    '',
    '## 规则',
    '',
    '- 项目级 approved benchmark 优先于 OpenPrd 内置 Source Map。',
    '- `inbox/` 里的 candidate 只表示待确认线索，不表示长期最佳实践。',
    '- 每次只挑 1-3 个高相关来源；来源目录不是事实来源。',
    '',
    '## Approved Sources',
    '',
  ];
  if (approved.length === 0) {
    lines.push('- 暂无已批准来源。', '');
  } else {
    for (const source of approved) {
      lines.push(renderSourceCard(source));
    }
  }
  lines.push('## Candidate Sources', '');
  if (candidates.length === 0) {
    lines.push('- 暂无待确认来源。', '');
  } else {
    for (const source of candidates) {
      lines.push(renderSourceCard(source));
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

async function writeApprovedSources(projectRoot, sources) {
  const next = {
    ...defaultSourcesFile(),
    updatedAt: timestamp(),
    sources: sources
      .map(normalizeSourceRecord)
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
  await writeYaml(benchmarkPath(projectRoot, BENCHMARK_SOURCES_FILE), next);
}

async function refreshBenchmarkIndex(projectRoot) {
  const approved = await loadApprovedSources(projectRoot);
  const candidates = await loadCandidateSources(projectRoot);
  await writeText(benchmarkPath(projectRoot, BENCHMARK_INDEX_FILE), renderBenchmarkIndex(approved, candidates));
  return { approved, candidates };
}

async function resolveSourceInput(projectRoot, source) {
  const raw = String(source ?? '').trim();
  if (!raw) {
    throw new Error('Benchmark source is required.');
  }

  if (isGitHubShorthand(raw) || isHttpUrl(raw)) {
    const url = normalizeRemoteUrl(raw);
    return { kind: 'remote-url', raw, url };
  }

  const absolutePath = path.isAbsolute(raw) ? raw : path.resolve(projectRoot, raw);
  if (await exists(absolutePath)) {
    return {
      kind: 'local-file',
      raw,
      absolutePath,
      relativePath: path.relative(projectRoot, absolutePath) || path.basename(absolutePath),
    };
  }

  throw new Error(`Cannot resolve benchmark source: ${raw}`);
}

function buildSourceValue(sourceValue, note) {
  const normalizedUrl = sourceValue.kind === 'remote-url' ? sourceValue.url : null;
  const sourceType = inferSourceType(normalizedUrl, sourceValue);
  const combinedText = [sourceValue.raw, normalizedUrl, sourceValue.relativePath, note].filter(Boolean).join(' ');
  const scenarios = inferScenarios(combinedText);
  const title = titleFromSource(sourceValue, normalizedUrl, sourceType);
  const repo = normalizedUrl ? toRepoSlug(normalizedUrl) : null;
  const idSeed = repo ?? sourceValue.relativePath ?? title;
  const id = slugify(idSeed, 'benchmark-source');

  return normalizeSourceRecord({
    id,
    title,
    scope: 'project',
    status: 'candidate',
    sourceType,
    url: normalizedUrl,
    path: sourceValue.kind === 'local-file' ? sourceValue.relativePath : null,
    repo,
    researchMethod: inferResearchMethod(sourceType),
    scenarios,
    triggerWhen: inferTriggerWhen(scenarios),
    notFor: inferNotFor(scenarios),
    note: note ?? null,
    value: note ?? null,
    addedAt: timestamp(),
  });
}

function sourceIdentity(source) {
  if (source.url) {
    return `url:${source.url.toLowerCase()}`;
  }
  if (source.path) {
    return `path:${source.path}`;
  }
  return `id:${source.id}`;
}

function duplicateSource(existingSources, candidate) {
  const wanted = sourceIdentity(candidate);
  return existingSources.find((source) => source.id === candidate.id || sourceIdentity(source) === wanted) ?? null;
}

function renderEvidence(source) {
  return [
    `# ${source.title}`,
    '',
    `- ID: ${source.id}`,
    `- 状态: ${source.status}`,
    `- 场景: ${source.scenarios.join(', ') || '未分类'}`,
    `- 触发: ${source.triggerWhen.join('；') || '待补充'}`,
    `- 不适用: ${source.notFor.join('；') || '待补充'}`,
    `- 研究方式: ${source.researchMethod}`,
    `- 来源: ${source.url ?? source.path ?? 'unknown'}`,
    '',
    '## 备注',
    '',
    source.note ?? '待补充',
    '',
  ].join('\n');
}

function sourceFilePath(projectRoot, id) {
  return benchmarkPath(projectRoot, cjoin(BENCHMARK_INBOX_DIR, `${id}.yaml`));
}

function evidenceFilePath(projectRoot, id) {
  return benchmarkPath(projectRoot, cjoin(BENCHMARK_EVIDENCE_DIR, `${id}.md`));
}

export async function addBenchmarkWorkspace(projectRoot, options = {}) {
  await ensureBenchmarkWorkspace(projectRoot);
  const sourceValue = await resolveSourceInput(projectRoot, options.source ?? options.target ?? options.reference ?? null);
  const source = buildSourceValue(sourceValue, options.notes ?? null);
  const approved = await loadApprovedSources(projectRoot);
  const candidates = await loadCandidateSources(projectRoot);
  const duplicate = duplicateSource([...approved, ...candidates], source);
  if (duplicate) {
    return {
      ok: false,
      action: 'benchmark-add',
      projectRoot,
      error: `Benchmark source already exists: ${duplicate.id}`,
      duplicate,
    };
  }

  const candidatePath = sourceFilePath(projectRoot, source.id);
  const evidencePath = evidenceFilePath(projectRoot, source.id);
  await writeYaml(candidatePath, source);
  await writeText(evidencePath, `${renderEvidence(source)}\n`);
  const refreshed = await refreshBenchmarkIndex(projectRoot);

  return {
    ok: true,
    action: 'benchmark-add',
    projectRoot,
    source,
    files: {
      candidate: candidatePath,
      evidence: evidencePath,
      index: benchmarkPath(projectRoot, BENCHMARK_INDEX_FILE),
      sources: benchmarkPath(projectRoot, BENCHMARK_SOURCES_FILE),
    },
    summary: {
      approved: refreshed.approved.length,
      candidates: refreshed.candidates.length,
    },
  };
}

export async function listBenchmarkWorkspace(projectRoot) {
  await ensureBenchmarkWorkspace(projectRoot);
  const approved = await loadApprovedSources(projectRoot);
  const candidates = await loadCandidateSources(projectRoot);
  return {
    ok: true,
    action: 'benchmark-list',
    projectRoot,
    approved,
    candidates,
    counts: {
      approved: approved.length,
      candidates: candidates.length,
    },
  };
}

async function readCandidateById(projectRoot, id) {
  const filePath = sourceFilePath(projectRoot, id);
  if (!(await exists(filePath))) {
    return null;
  }
  const payload = await readYaml(filePath);
  return normalizeSourceRecord(payload);
}

export async function approveBenchmarkWorkspace(projectRoot, options = {}) {
  await ensureBenchmarkWorkspace(projectRoot);
  const id = String(options.id ?? '').trim();
  if (!id) {
    throw new Error('Benchmark id is required for approve.');
  }
  const candidate = await readCandidateById(projectRoot, id);
  if (!candidate) {
    throw new Error(`Benchmark candidate not found: ${id}`);
  }

  const approved = await loadApprovedSources(projectRoot);
  const approvedSource = normalizeSourceRecord({
    ...candidate,
    status: 'approved',
    approvedAt: timestamp(),
  });
  const nextApproved = approved.filter((source) => source.id !== id);
  nextApproved.push(approvedSource);
  await writeApprovedSources(projectRoot, nextApproved);
  await fs.rm(sourceFilePath(projectRoot, id), { force: true });
  await writeText(evidenceFilePath(projectRoot, id), `${renderEvidence(approvedSource)}\n`);
  const refreshed = await refreshBenchmarkIndex(projectRoot);

  return {
    ok: true,
    action: 'benchmark-approve',
    projectRoot,
    source: approvedSource,
    counts: {
      approved: refreshed.approved.length,
      candidates: refreshed.candidates.length,
    },
    files: {
      sources: benchmarkPath(projectRoot, BENCHMARK_SOURCES_FILE),
      index: benchmarkPath(projectRoot, BENCHMARK_INDEX_FILE),
    },
  };
}

async function probeRemoteSource(urlString) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const headResponse = await fetch(urlString, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    });
    if (headResponse.ok || headResponse.status === 405) {
      return { ok: true, status: headResponse.status };
    }
    return { ok: false, status: headResponse.status, reason: `HTTP ${headResponse.status}` };
  } catch {
    try {
      const getResponse = await fetch(urlString, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
      if (getResponse.ok) {
        return { ok: true, status: getResponse.status };
      }
      return { ok: false, status: getResponse.status, reason: `HTTP ${getResponse.status}` };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  } finally {
    clearTimeout(timeout);
  }
}

function hasOverbroadTrigger(source) {
  if (!Array.isArray(source.triggerWhen) || source.triggerWhen.length === 0) {
    return true;
  }
  const combined = source.triggerWhen.join(' ').toLowerCase();
  return OVERBROAD_TRIGGER_TOKENS.some((token) => combined.includes(token.toLowerCase()));
}

function normalizeCheckedSource(source) {
  return normalizeSourceRecord({
    ...source,
    lastVerified: timestamp(),
  });
}

export async function verifyBenchmarkWorkspace(projectRoot) {
  await ensureBenchmarkWorkspace(projectRoot);
  const approved = await loadApprovedSources(projectRoot);
  const candidates = await loadCandidateSources(projectRoot);
  const allSources = [...approved, ...candidates];
  const checks = [];
  const seenIds = new Map();
  const seenLocations = new Map();
  const approvedUpdates = new Map();
  const candidateUpdates = new Map();

  for (const source of allSources) {
    const issues = [];
    if (seenIds.has(source.id)) {
      issues.push({ level: 'error', code: 'duplicate-id', message: `Duplicate benchmark id with ${seenIds.get(source.id)}` });
    } else {
      seenIds.set(source.id, source.id);
    }

    const identity = sourceIdentity(source);
    if (seenLocations.has(identity)) {
      issues.push({ level: 'error', code: 'duplicate-source', message: `Duplicate benchmark source with ${seenLocations.get(identity)}` });
    } else {
      seenLocations.set(identity, source.id);
    }

    if (source.url) {
      try {
        new URL(source.url);
      } catch {
        issues.push({ level: 'error', code: 'invalid-url', message: `Invalid URL: ${source.url}` });
      }
      if (!issues.some((issue) => issue.code === 'invalid-url')) {
        const probe = await probeRemoteSource(source.url);
        if (!probe.ok) {
          issues.push({ level: 'error', code: 'unreachable-source', message: `Unreachable source: ${source.url} (${probe.reason ?? 'unknown'})` });
        }
      }
    }

    if (source.path) {
      const absolutePath = path.resolve(projectRoot, source.path);
      if (!(await exists(absolutePath))) {
        issues.push({ level: 'error', code: 'missing-local-source', message: `Missing local source: ${source.path}` });
      }
    }

    if (!Array.isArray(source.scenarios) || source.scenarios.length === 0) {
      issues.push({ level: 'warning', code: 'missing-scenarios', message: 'Missing benchmark scenarios.' });
    }
    if (hasOverbroadTrigger(source)) {
      issues.push({ level: 'warning', code: 'overbroad-trigger', message: 'Trigger rules are too broad or missing.' });
    }

    const ok = !issues.some((issue) => issue.level === 'error');
    const nextSource = ok ? normalizeCheckedSource(source) : source;
    if (source.status === 'approved') {
      approvedUpdates.set(source.id, nextSource);
    } else {
      candidateUpdates.set(source.id, nextSource);
    }
    checks.push({
      id: source.id,
      title: source.title,
      status: source.status,
      ok,
      issues,
    });
  }

  const approvedNext = approved.map((source) => approvedUpdates.get(source.id) ?? source);
  const candidateNext = candidates.map((source) => candidateUpdates.get(source.id) ?? source);
  await writeApprovedSources(projectRoot, approvedNext);
  for (const source of candidateNext) {
    await writeYaml(sourceFilePath(projectRoot, source.id), source);
  }
  await refreshBenchmarkIndex(projectRoot);

  const errors = checks.flatMap((check) => check.issues.filter((issue) => issue.level === 'error').map((issue) => `${check.id}: ${issue.message}`));
  const warnings = checks.flatMap((check) => check.issues.filter((issue) => issue.level !== 'error').map((issue) => `${check.id}: ${issue.message}`));

  return {
    ok: errors.length === 0,
    action: 'benchmark-verify',
    projectRoot,
    checkedAt: timestamp(),
    checks,
    errors,
    warnings,
  };
}

export async function benchmarkWorkspace(projectRoot, options = {}) {
  const action = options.action ?? 'list';
  if (action === 'add') {
    return addBenchmarkWorkspace(projectRoot, options);
  }
  if (action === 'approve') {
    return approveBenchmarkWorkspace(projectRoot, options);
  }
  if (action === 'verify') {
    return verifyBenchmarkWorkspace(projectRoot, options);
  }
  return listBenchmarkWorkspace(projectRoot, options);
}

export async function renderApprovedBenchmarkRegistrySection(projectRoot) {
  await ensureBenchmarkWorkspace(projectRoot);
  const approved = await loadApprovedSources(projectRoot);
  if (approved.length === 0) {
    return [
      '## Project Benchmark Registry',
      '',
      '- 当前项目还没有 approved benchmark source。',
      '- 如需补充，用 `openprd benchmark add <url|repo|file>` 添加 candidate，再用 `openprd benchmark approve <id>` 纳入项目级 registry。',
      '- Agent 仍应先读取 `.openprd/benchmarks/index.md` 和 `.openprd/benchmarks/sources.yaml`，但 candidate inbox 不能当成长期事实来源。',
      '',
    ].join('\n');
  }

  const lines = [
    '## Project Benchmark Registry',
    '',
    '- 先读取 `.openprd/benchmarks/index.md` 和 `.openprd/benchmarks/sources.yaml`。',
    '- 项目级 approved benchmark 优先于 OpenPrd 内置 Source Map；`inbox/` candidate 只能作为待确认线索。',
    '- 每次最多优先挑 1-3 个与当前任务最相关的 approved source。',
    '',
    '### Approved Sources',
    '',
  ];

  for (const source of approved.slice(0, 20)) {
    const location = source.repo ? `${source.repo} (${source.url})` : (source.url ?? source.path ?? 'unknown');
    lines.push(`- \`${source.id}\` ${source.title}`);
    lines.push(`  - 场景: ${source.scenarios.join(', ') || '未分类'}`);
    lines.push(`  - 触发: ${source.triggerWhen.join('；') || '待补充'}`);
    lines.push(`  - 不适用: ${source.notFor.join('；') || '待补充'}`);
    lines.push(`  - 研究方式: ${source.researchMethod}`);
    lines.push(`  - 来源: ${location}`);
  }
  lines.push('');
  return lines.join('\n');
}

export {
  BENCHMARK_DIR,
  BENCHMARK_EVIDENCE_DIR,
  BENCHMARK_INDEX_FILE,
  BENCHMARK_INBOX_DIR,
  BENCHMARK_SOURCES_FILE,
  ensureBenchmarkWorkspace,
};
