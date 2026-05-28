import fs from 'node:fs/promises';
import { appendJsonl, appendText, cjoin, exists, readJson, readJsonl, writeJson, writeText } from './fs-utils.js';
import { OPENPRD_HARNESS_TURN_STATE, recordKnowledgeReviewSignal, reviewKnowledgeWorkspace } from './knowledge.js';
import { readSessionBinding } from './session-binding.js';
import { timestamp } from './time.js';

const OPENPRD_HARNESS_DIR = cjoin('.openprd', 'harness');
const OPENPRD_HARNESS_RUN_STATE = cjoin(OPENPRD_HARNESS_DIR, 'run-state.json');
const OPENPRD_HARNESS_ITERATIONS = cjoin(OPENPRD_HARNESS_DIR, 'iterations.jsonl');
const OPENPRD_HARNESS_LEARNINGS = cjoin(OPENPRD_HARNESS_DIR, 'learnings.md');
const OPENPRD_HARNESS_LOOP_FEATURE_LIST = cjoin(OPENPRD_HARNESS_DIR, 'feature-list.json');
const OPENPRD_HARNESS_REQUIREMENT_GATE = cjoin(OPENPRD_HARNESS_DIR, 'requirement-gate.json');
const OPENPRD_HARNESS_REQUIREMENT_GATES_DIR = cjoin(OPENPRD_HARNESS_DIR, 'requirement-gates');
const OPENPRD_HARNESS_EVENTS = cjoin(OPENPRD_HARNESS_DIR, 'events.jsonl');
const OPENPRD_WORK_UNITS_DIR = cjoin('.openprd', 'engagements', 'work-units');
const OPENPRD_LOOP_REQUIRED_IMPLEMENTATION_TASK_THRESHOLD = 10;
const CONTINUATION_SESSION_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const CONTINUATION_TASK_HANDLE_PATTERN = /\b[a-z0-9._-]+:T\d{3}\.\d{2}:[a-z0-9._-]+\b/i;
const CONTINUATION_WORK_UNIT_PATTERN = /\bwu-[a-z0-9._-]+\b/i;
const CONTINUATION_EXPLICIT_PATTERN = /(继续(这个|这条|当前)?(对话|任务|会话|记录|历史)?|续做|接着做|继续执行|继续推进)/i;
const CONTINUATION_CURRENT_PATTERN = /(继续当前|当前(这个|这条)?(任务|会话|记录|需求|变更)|current\s+(task|change|session)|resume current)/i;
function harnessFile(projectRoot, relativePath) {
  return cjoin(projectRoot, relativePath);
}

async function ensureRunHarness(projectRoot) {
  await fs.mkdir(harnessFile(projectRoot, OPENPRD_HARNESS_DIR), { recursive: true });
  const statePath = harnessFile(projectRoot, OPENPRD_HARNESS_RUN_STATE);
  if (!(await exists(statePath))) {
    await writeJson(statePath, {
      version: 1,
      active: true,
      currentIteration: 0,
      lastContextAt: null,
      lastHookAt: null,
      lastOutcome: null,
      lastRecommendation: null,
    });
  }
  const iterationsPath = harnessFile(projectRoot, OPENPRD_HARNESS_ITERATIONS);
  if (!(await exists(iterationsPath))) {
    await writeText(iterationsPath, '');
  }
  const learningsPath = harnessFile(projectRoot, OPENPRD_HARNESS_LEARNINGS);
  if (!(await exists(learningsPath))) {
    await writeText(learningsPath, '# OpenPrd Harness Learnings\n\nReusable patterns discovered during hook-driven runs belong here.\n');
  }
}

async function readRunState(projectRoot) {
  await ensureRunHarness(projectRoot);
  return readJson(harnessFile(projectRoot, OPENPRD_HARNESS_RUN_STATE)).catch(() => ({
    version: 1,
    active: true,
    currentIteration: 0,
  }));
}

async function readActiveRequirementGate(projectRoot) {
  const gate = await readJson(harnessFile(projectRoot, OPENPRD_HARNESS_REQUIREMENT_GATE)).catch(() => null);
  return gate?.active ? gate : null;
}

async function writeRunState(projectRoot, state) {
  await writeJson(harnessFile(projectRoot, OPENPRD_HARNESS_RUN_STATE), {
    version: 1,
    active: true,
    ...state,
    updatedAt: timestamp(),
  });
}

function compactTask(task) {
  if (!task) {
    return null;
  }
  return {
    id: task.id,
    taskHandle: task.taskHandle ?? null,
    title: task.title,
    relativePath: task.relativePath,
    lineNumber: task.lineNumber,
    verify: task.metadata?.verify ?? null,
    done: task.metadata?.done ?? null,
    oracle: task.metadata?.oracle ?? null,
    deps: task.metadata?.deps ?? null,
    type: task.metadata?.type ?? task.metadata?.category ?? task.metadata?.kind ?? null,
  };
}

function compactCoverageItem(item) {
  if (!item) {
    return null;
  }
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    source: item.source ?? null,
    evidence: item.evidence ?? [],
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function slugify(value, fallback = 'openprd-generated-change') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function reviewMarkCommand(snapshot) {
  if (!snapshot?.versionId || !snapshot?.digest) {
    return 'openprd review . --mark confirmed';
  }
  const parts = [
    'openprd review . --mark confirmed',
    `--version ${shellQuote(snapshot.versionId)}`,
    `--digest ${shellQuote(snapshot.digest)}`,
  ];
  if (snapshot.workUnitId) {
    parts.push(`--work-unit ${shellQuote(snapshot.workUnitId)}`);
  }
  return parts.join(' ');
}

function executionGate() {
  return {
    requiresExplicitIntent: true,
    allowedIntents: ['开发', '实现', '修复', '继续任务', '落地执行', '深度调研', '深度对标', '复刻落地', '提交'],
    readOnlyIntents: ['看看', '规划', '梳理', '分析', '评估', '预计动哪些文件', '怎么改', '代码审查'],
    rule: '只有当用户当前明确要求实现、继续、深度调研、对标或提交时，才运行 executionCommand。规划、分析、文件影响范围和审查类请求保持只读，并基于证据回答。',
  };
}

function analyzeRunMessage(message = null) {
  const text = String(message ?? '').trim();
  if (!text) {
    return {
      kind: 'default',
      requested: false,
      explicit: false,
      selectorType: null,
      selector: null,
      sessionId: null,
      taskHandle: null,
      workUnitId: null,
      explicitCurrent: false,
      text: '',
    };
  }

  const sessionId = text.match(CONTINUATION_SESSION_PATTERN)?.[0] ?? null;
  const taskHandle = text.match(CONTINUATION_TASK_HANDLE_PATTERN)?.[0] ?? null;
  const workUnitId = text.match(CONTINUATION_WORK_UNIT_PATTERN)?.[0] ?? null;
  const explicit = CONTINUATION_EXPLICIT_PATTERN.test(text);
  const explicitCurrent = CONTINUATION_CURRENT_PATTERN.test(text);
  const requested = explicit || Boolean(sessionId || taskHandle || workUnitId);
  if (!requested) {
    return {
      kind: 'default',
      requested: false,
      explicit: false,
      selectorType: null,
      selector: null,
      sessionId: null,
      taskHandle: null,
      workUnitId: null,
      explicitCurrent,
      text,
    };
  }

  return {
    kind: 'continuation',
    requested: true,
    explicit,
    selectorType: taskHandle ? 'task-handle' : workUnitId ? 'work-unit' : sessionId ? 'session' : 'implicit',
    selector: taskHandle ?? workUnitId ?? sessionId ?? null,
    sessionId,
    taskHandle,
    workUnitId,
    explicitCurrent,
    text,
  };
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[_:/.-]+/g, ' ')
    .replace(/[^\p{Letter}\p{Number}\u4e00-\u9fff]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueItems(items) {
  return [...new Set(items.filter(Boolean))];
}

function searchTokens(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized) {
    return [];
  }
  return uniqueItems(
    normalized
      .split(' ')
      .map((item) => item.trim())
      .filter((item) => item.length >= 2),
  );
}

function scoreSearchCandidate(query, fields = []) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return 0;
  }
  const queryTokens = searchTokens(query);
  let bestScore = 0;
  for (const field of fields) {
    const normalizedField = normalizeSearchText(field);
    if (!normalizedField) {
      continue;
    }
    if (normalizedField === normalizedQuery) {
      bestScore = Math.max(bestScore, 220);
      continue;
    }
    if (normalizedField.includes(normalizedQuery)) {
      bestScore = Math.max(bestScore, 180);
      continue;
    }
    if (normalizedQuery.includes(normalizedField) && normalizedField.length >= 6) {
      bestScore = Math.max(bestScore, 160);
      continue;
    }
    let score = 0;
    let hits = 0;
    for (const token of queryTokens) {
      if (!normalizedField.includes(token)) {
        continue;
      }
      hits += 1;
      score += token.length >= 4 ? 24 : 14;
    }
    if (hits > 0) {
      if (hits === queryTokens.length && queryTokens.length > 1) {
        score += 24;
      }
      if (normalizedField.includes(normalizedQuery.slice(0, Math.min(normalizedQuery.length, 12)))) {
        score += 12;
      }
    }
    bestScore = Math.max(bestScore, score);
  }
  return bestScore;
}

async function readFirstHeading(filePath, fallback = null) {
  const text = await fs.readFile(filePath, 'utf8').catch(() => '');
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
  return heading || fallback;
}

function workUnitBindingPath(projectRoot, workUnitId) {
  if (!workUnitId) {
    return null;
  }
  return cjoin(
    projectRoot,
    OPENPRD_WORK_UNITS_DIR,
    `${String(workUnitId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`,
  );
}

async function readWorkUnitBindingRecord(projectRoot, workUnitId) {
  const filePath = workUnitBindingPath(projectRoot, workUnitId);
  if (!filePath) {
    return null;
  }
  const binding = await readJson(filePath).catch(() => null);
  return binding ? { ...binding, path: filePath } : null;
}

function extractFirstSelectorMatch(texts, pattern) {
  for (const text of texts) {
    const match = String(text ?? '').match(pattern)?.[0] ?? null;
    if (match) {
      return match;
    }
  }
  return null;
}

async function buildRunResolutionIndex(projectRoot, changes, listOpenSpecTaskWorkspace) {
  const changeRows = Array.isArray(changes?.changes) ? changes.changes : [];
  const index = {
    changes: [],
    tasks: [],
  };
  for (const change of changeRows) {
    const title = await readFirstHeading(cjoin(change.changeDir, 'proposal.md'), change.id);
    const taskState = await listOpenSpecTaskWorkspace(projectRoot, { change: change.id }).catch(() => null);
    const pendingTaskTitles = Array.isArray(taskState?.tasks)
      ? taskState.tasks
          .filter((task) => !task.checked)
          .map((task) => String(task.title ?? '').trim())
          .filter(Boolean)
          .slice(0, 3)
      : [];
    index.changes.push({
      changeId: change.id,
      title,
      active: Boolean(change.active),
      pendingTaskTitles,
    });
    for (const task of taskState?.tasks ?? []) {
      index.tasks.push({
        changeId: change.id,
        changeTitle: title,
        checked: Boolean(task.checked),
        task: compactTask(task),
      });
    }
  }
  return index;
}

function findLoopTaskByHandle(loopFeatureList, taskHandle) {
  if (!taskHandle || !Array.isArray(loopFeatureList?.tasks)) {
    return null;
  }
  return loopFeatureList.tasks.find((task) => task.taskHandle === taskHandle) ?? null;
}

function buildTaskTarget(match, source, extra = {}) {
  if (!match) {
    return null;
  }
  return {
    matched: true,
    source,
    sessionId: extra.sessionId ?? null,
    taskId: match.task.id ?? match.taskId ?? null,
    taskHandle: match.task.taskHandle ?? match.taskHandle ?? null,
    changeId: match.changeId ?? null,
    workUnitId: extra.workUnitId ?? null,
    title: match.task.title ?? match.title ?? null,
    promptPreview: extra.promptPreview ?? null,
    reason: extra.reason ?? null,
    artifacts: extra.artifacts ?? null,
  };
}

function resolveTaskHandleTarget(taskHandle, index, loopFeatureList, extra = {}) {
  const loopTask = findLoopTaskByHandle(loopFeatureList, taskHandle);
  if (loopTask) {
    return buildTaskTarget({
      task: {
        id: loopTask.id,
        taskHandle: loopTask.taskHandle,
        title: loopTask.title,
      },
      changeId: loopTask.changeId,
    }, extra.source ?? 'task-handle', {
      ...extra,
      reason: extra.reason ?? `任务句柄 ${taskHandle} 命中 Loop 任务索引。`,
    });
  }
  const indexedTask = index?.tasks?.find((item) => item.task.taskHandle === taskHandle) ?? null;
  if (!indexedTask) {
    return {
      matched: false,
      source: extra.source ?? 'task-handle',
      sessionId: extra.sessionId ?? null,
      taskId: null,
      taskHandle,
      changeId: null,
      workUnitId: extra.workUnitId ?? null,
      title: null,
      promptPreview: extra.promptPreview ?? null,
      reason: extra.reason ?? `未在本地任务索引中找到任务句柄 ${taskHandle}。`,
      artifacts: extra.artifacts ?? null,
    };
  }
  return buildTaskTarget(indexedTask, extra.source ?? 'task-handle', {
    ...extra,
    reason: extra.reason ?? `任务句柄 ${taskHandle} 命中 OpenPrd 任务索引。`,
  });
}

function resolveSemanticTarget(query, index, extra = {}) {
  if (!String(query ?? '').trim()) {
    return null;
  }
  const candidates = [];
  for (const taskEntry of index?.tasks ?? []) {
    const score = scoreSearchCandidate(query, [
      taskEntry.task.taskHandle,
      taskEntry.task.id,
      taskEntry.task.title,
      taskEntry.changeId,
      taskEntry.changeTitle,
    ]);
    if (score > 0) {
      candidates.push({
        kind: 'task',
        score,
        source: extra.source ?? 'semantic',
        changeId: taskEntry.changeId,
        taskId: taskEntry.task.id,
        taskHandle: taskEntry.task.taskHandle,
        title: taskEntry.task.title,
      });
    }
  }
  for (const changeEntry of index?.changes ?? []) {
    const score = scoreSearchCandidate(query, [
      changeEntry.changeId,
      changeEntry.title,
      ...(changeEntry.pendingTaskTitles ?? []),
    ]);
    if (score > 0) {
      candidates.push({
        kind: 'change',
        score,
        source: extra.source ?? 'semantic',
        changeId: changeEntry.changeId,
        taskId: null,
        taskHandle: null,
        title: changeEntry.title,
      });
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  const second = candidates[1] ?? null;
  const ambiguous = second
    && second.changeId !== best.changeId
    && best.score < (second.score + 18);
  if (best.score < 70 || ambiguous) {
    return null;
  }
  return {
    matched: true,
    source: best.source,
    sessionId: extra.sessionId ?? null,
    changeId: best.changeId,
    taskId: best.taskId,
    taskHandle: best.taskHandle,
    workUnitId: extra.workUnitId ?? null,
    title: best.title,
    promptPreview: extra.promptPreview ?? null,
    reason: extra.reason ?? `用户描述命中已有${best.kind === 'task' ? '任务' : '变更'} ${best.taskId ?? best.changeId}。`,
    score: best.score,
    artifacts: extra.artifacts ?? null,
  };
}

async function resolveWorkUnitTarget(projectRoot, workUnitId, index, extra = {}) {
  const binding = await readWorkUnitBindingRecord(projectRoot, workUnitId);
  if (!binding) {
    return {
      matched: false,
      source: extra.source ?? 'work-unit',
      sessionId: extra.sessionId ?? null,
      taskId: null,
      taskHandle: null,
      changeId: null,
      workUnitId,
      title: null,
      promptPreview: extra.promptPreview ?? null,
      reason: extra.reason ?? `未在本地 work unit 绑定中找到 ${workUnitId}。`,
      artifacts: extra.artifacts ?? null,
      binding: null,
    };
  }
  const semanticMatch = resolveSemanticTarget(
    [
      binding.title,
      binding.latestVersionId,
      extra.promptPreview,
      extra.query,
    ].filter(Boolean).join(' '),
    index,
    {
      source: extra.source ?? 'work-unit',
      sessionId: extra.sessionId ?? null,
      workUnitId,
      promptPreview: extra.promptPreview ?? null,
      artifacts: extra.artifacts ?? null,
      reason: `工作单元 ${workUnitId} 命中 ${binding.title ?? binding.latestVersionId ?? '本地绑定'}。`,
    },
  );
  if (semanticMatch) {
    return {
      ...semanticMatch,
      workUnitId,
      binding,
    };
  }
  return {
    matched: true,
    source: extra.source ?? 'work-unit',
    sessionId: extra.sessionId ?? null,
    taskId: null,
    taskHandle: null,
    changeId: null,
    workUnitId,
    title: binding.title ?? binding.latestVersionId ?? null,
    promptPreview: extra.promptPreview ?? null,
    reason: extra.reason ?? `定位到工作单元 ${workUnitId}，但还没有足够证据绑定到具体 change/task。`,
    artifacts: extra.artifacts ?? null,
    binding,
  };
}

async function readSessionRequirementGate(projectRoot, sessionId) {
  if (!sessionId) {
    return null;
  }
  return readJson(cjoin(projectRoot, OPENPRD_HARNESS_REQUIREMENT_GATES_DIR, `${sessionId}.json`)).catch(() => null);
}

async function readSessionEvents(projectRoot, sessionId) {
  if (!sessionId) {
    return [];
  }
  const events = await readJsonl(cjoin(projectRoot, OPENPRD_HARNESS_EVENTS)).catch(() => []);
  return events.filter((event) => event?.sessionId === sessionId);
}

async function resolveSessionTarget(projectRoot, sessionId, index, loopFeatureList) {
  const binding = await readSessionBinding(projectRoot, sessionId);
  const gate = await readSessionRequirementGate(projectRoot, sessionId);
  const events = await readSessionEvents(projectRoot, sessionId);
  const directBindingArtifacts = binding ? { sessionBinding: true } : {};
  if (binding?.taskHandle) {
    return resolveTaskHandleTarget(binding.taskHandle, index, loopFeatureList, {
      source: 'session-binding',
      sessionId,
      workUnitId: binding.workUnitId ?? null,
      promptPreview: binding.promptPreview ?? null,
      artifacts: {
        ...directBindingArtifacts,
        requirementGate: Boolean(gate),
        events: events.length,
      },
      reason: `会话 ${sessionId} 的 lane 绑定命中任务句柄 ${binding.taskHandle}。`,
    });
  }
  if (binding?.changeId) {
    return {
      matched: true,
      source: 'session-binding',
      sessionId,
      taskId: null,
      taskHandle: binding.taskHandle ?? null,
      changeId: binding.changeId,
      workUnitId: binding.workUnitId ?? null,
      title: binding.title ?? null,
      promptPreview: binding.promptPreview ?? null,
      reason: `会话 ${sessionId} 的 lane 绑定指向变更 ${binding.changeId}。`,
      artifacts: {
        ...directBindingArtifacts,
        requirementGate: Boolean(gate),
        events: events.length,
      },
    };
  }
  if (binding?.workUnitId) {
    const boundWorkUnitTarget = await resolveWorkUnitTarget(projectRoot, binding.workUnitId, index, {
      source: 'session-binding',
      sessionId,
      promptPreview: binding.promptPreview ?? null,
      artifacts: {
        ...directBindingArtifacts,
        requirementGate: Boolean(gate),
        events: events.length,
      },
      query: [binding.title, binding.promptPreview, gate?.promptPreview].filter(Boolean).join(' '),
      reason: `会话 ${sessionId} 的 lane 绑定命中工作单元 ${binding.workUnitId}。`,
    });
    if (boundWorkUnitTarget?.matched) {
      return {
        ...boundWorkUnitTarget,
        changeId: boundWorkUnitTarget.changeId ?? binding.changeId ?? null,
        title: boundWorkUnitTarget.title ?? binding.title ?? null,
      };
    }
  }
  const promptPreview = gate?.promptPreview
    ?? binding?.promptPreview
    ?? gate?.reviewActionAuthorization?.promptPreview
    ?? events.find((event) => typeof event?.preview === 'string')?.preview
    ?? null;
  const texts = [
    binding?.title,
    binding?.promptPreview,
    gate?.promptPreview,
    gate?.confirmationPreview,
    gate?.reviewActionAuthorization?.promptPreview,
    ...events.map((event) => event?.preview ?? null),
  ].filter(Boolean);
  const artifacts = {
    sessionBinding: Boolean(binding),
    requirementGate: Boolean(gate),
    events: events.length,
  };
  const taskHandle = extractFirstSelectorMatch(texts, CONTINUATION_TASK_HANDLE_PATTERN);
  if (taskHandle) {
    return resolveTaskHandleTarget(taskHandle, index, loopFeatureList, {
      source: 'session',
      sessionId,
      promptPreview,
      artifacts,
      reason: `会话 ${sessionId} 的本地记录命中任务句柄 ${taskHandle}。`,
    });
  }
  const workUnitId = gate?.reviewActionAuthorization?.workUnitId
    ?? extractFirstSelectorMatch(texts, CONTINUATION_WORK_UNIT_PATTERN);
  if (workUnitId) {
    return resolveWorkUnitTarget(projectRoot, workUnitId, index, {
      source: 'session',
      sessionId,
      promptPreview,
      artifacts,
      query: texts.join(' '),
      reason: `会话 ${sessionId} 的本地记录命中工作单元 ${workUnitId}。`,
    });
  }
  const semanticMatch = resolveSemanticTarget(texts.join(' '), index, {
    source: 'session',
    sessionId,
    promptPreview,
    artifacts,
    reason: `会话 ${sessionId} 的本地 requirement / hook 历史命中已有任务对象。`,
  });
  if (semanticMatch) {
    return semanticMatch;
  }
  return {
    matched: false,
    source: 'session',
    sessionId,
    taskId: null,
    taskHandle: null,
    changeId: null,
    workUnitId: null,
    title: null,
    promptPreview,
    reason: gate || events.length > 0
      ? `本地找到了会话 ${sessionId} 的 requirement gate / hook 事件，但还没有足够证据绑定到具体 change/task/work unit。`
      : `本地没有会话 ${sessionId} 的 requirement gate、hook 事件或 work unit 绑定。`,
    artifacts,
  };
}

async function resolveRunTarget({
  projectRoot,
  message,
  request,
  index,
  loopFeatureList,
}) {
  const text = String(message ?? '').trim();
  if (!text) {
    return null;
  }
  if (request.sessionId) {
    return resolveSessionTarget(projectRoot, request.sessionId, index, loopFeatureList);
  }
  if (request.taskHandle) {
    return resolveTaskHandleTarget(request.taskHandle, index, loopFeatureList);
  }
  if (request.workUnitId) {
    return resolveWorkUnitTarget(projectRoot, request.workUnitId, index, {
      query: text,
    });
  }
  if (request.explicitCurrent) {
    return null;
  }
  return resolveSemanticTarget(text, index);
}

function selectFocusedChangeId(request, resolvedTarget, activeChange) {
  if (resolvedTarget?.changeId) {
    return resolvedTarget.changeId;
  }
  if (request.sessionId || request.taskHandle || request.workUnitId) {
    return null;
  }
  return activeChange ?? null;
}

function describeRunLane(lane) {
  if (lane?.kind === 'targeted') {
    const target = lane.target?.taskHandle
      ?? lane.target?.taskId
      ?? lane.target?.changeId
      ?? lane.target?.workUnitId
      ?? '已有对象';
    return `按用户描述定位已有对象 (${target})`;
  }
  if (lane?.kind !== 'continuation') {
    return '默认执行流';
  }
  const selectorLabel = lane.selectorType === 'task-handle'
    ? '任务句柄'
    : lane.selectorType === 'work-unit'
      ? '工作单元'
      : lane.selectorType === 'session'
        ? '历史会话'
        : '继续提示';
  const target = lane.target?.sessionId
    ?? lane.target?.taskHandle
    ?? lane.target?.taskId
    ?? lane.target?.changeId
    ?? lane.target?.workUnitId
    ?? lane.selector
    ?? '当前活动上下文';
  return `继续已有任务 (${selectorLabel}: ${target})`;
}

function buildRunLane({ message, recommendation, activeChange, latestPrd, loopFeatureList, resolvedTarget }) {
  const request = analyzeRunMessage(message);
  if (!request.requested) {
    if (resolvedTarget?.matched) {
      const target = {
        sessionId: resolvedTarget.sessionId ?? null,
        taskHandle: resolvedTarget.taskHandle ?? recommendation?.task?.taskHandle ?? null,
        taskId: resolvedTarget.taskId ?? recommendation?.task?.id ?? null,
        changeId: resolvedTarget.changeId ?? recommendation?.changeId ?? null,
        workUnitId: resolvedTarget.workUnitId ?? latestPrd?.workUnitId ?? null,
      };
      const lane = {
        kind: 'targeted',
        requested: false,
        selectorType: resolvedTarget.source ?? 'semantic',
        selector: null,
        target,
        matched: Boolean(target.sessionId || target.taskHandle || target.taskId || target.changeId || target.workUnitId),
        resolution: resolvedTarget,
        activeChange,
      };
      return {
        ...lane,
        summary: describeRunLane(lane),
      };
    }
    return {
      kind: 'default',
      requested: false,
      summary: '默认执行流',
    };
  }

  const matchedLoopTask = request.taskHandle ? findLoopTaskByHandle(loopFeatureList, request.taskHandle) : null;
  let target;
  let matched;
  if (request.selectorType === 'session') {
    target = {
      sessionId: request.sessionId,
      taskHandle: resolvedTarget?.taskHandle ?? null,
      taskId: resolvedTarget?.taskId ?? null,
      changeId: resolvedTarget?.changeId ?? null,
      workUnitId: resolvedTarget?.workUnitId ?? null,
    };
    matched = Boolean(resolvedTarget?.matched);
  } else if (request.selectorType === 'task-handle') {
    target = {
      sessionId: null,
      taskHandle: resolvedTarget?.taskHandle ?? matchedLoopTask?.taskHandle ?? request.taskHandle ?? null,
      taskId: resolvedTarget?.taskId ?? matchedLoopTask?.id ?? null,
      changeId: resolvedTarget?.changeId ?? matchedLoopTask?.changeId ?? null,
      workUnitId: resolvedTarget?.workUnitId ?? null,
    };
    matched = Boolean(resolvedTarget?.matched || matchedLoopTask);
  } else if (request.selectorType === 'work-unit') {
    target = {
      sessionId: null,
      taskHandle: resolvedTarget?.taskHandle ?? null,
      taskId: resolvedTarget?.taskId ?? null,
      changeId: resolvedTarget?.changeId ?? null,
      workUnitId: resolvedTarget?.workUnitId ?? request.workUnitId ?? null,
    };
    matched = Boolean(resolvedTarget?.matched);
  } else {
    target = {
      sessionId: null,
      taskHandle: recommendation?.task?.taskHandle ?? null,
      taskId: recommendation?.task?.id ?? null,
      changeId: recommendation?.changeId ?? activeChange ?? null,
      workUnitId: latestPrd?.workUnitId ?? null,
    };
    matched = Boolean(target.taskHandle || target.taskId || target.changeId || target.workUnitId);
  }
  const lane = {
    ...request,
    target,
    matched,
    resolution: resolvedTarget ?? null,
    activeChange,
  };
  return {
    ...lane,
    summary: describeRunLane(lane),
  };
}

function buildSessionContinuationRecommendation(recommendation, lane) {
  const sessionId = lane?.target?.sessionId ?? lane?.sessionId ?? lane?.selector ?? null;
  const recoveredTarget = [
    lane?.target?.changeId ? `变更 ${lane.target.changeId}` : null,
    lane?.target?.taskHandle ? `任务句柄 ${lane.target.taskHandle}` : null,
    lane?.target?.workUnitId ? `工作单元 ${lane.target.workUnitId}` : null,
  ].filter(Boolean).join('、');
  return {
    type: 'session-continuation',
    title: sessionId ? `恢复历史会话 ${sessionId}` : '恢复历史会话',
    command: sessionId
      ? `openprd run . --context --message ${shellQuote(sessionId)}`
      : 'openprd run . --context',
    verifyCommand: 'openprd run . --verify',
    reason: [
      '当前请求给出的是工具无关的会话 ID；先按本地会话索引恢复该会话历史，再决定后续任务对象。',
      recoveredTarget ? `本地已恢复到 ${recoveredTarget}。` : (lane?.resolution?.reason ?? '本地还没有足够证据把这个会话绑定到具体 change/task/work unit。'),
      lane?.resolution?.promptPreview ? `会话摘要: ${lane.resolution.promptPreview}` : null,
      '不能用相似历史、当前 active change 或当前 requirement gate 替代这个会话 ID。',
      lane?.activeChange && lane.activeChange !== lane?.target?.changeId
        ? `当前工作区 active change ${lane.activeChange} 只作为背景提醒。`
        : null,
    ].filter(Boolean).join(' '),
    changeId: lane?.target?.changeId ?? null,
    task: lane?.target?.taskId || lane?.target?.taskHandle
      ? {
          id: lane.target.taskId ?? null,
          taskHandle: lane.target.taskHandle ?? null,
          title: lane?.resolution?.title ?? null,
        }
      : null,
    coverageItem: null,
    continuationTarget: lane.target ?? null,
    previousRecommendation: recommendation
      ? {
          type: recommendation.type ?? null,
          title: recommendation.title ?? null,
          changeId: recommendation.changeId ?? null,
          task: recommendation.task ?? null,
        }
      : null,
  };
}

function buildUnresolvedContinuationRecommendation({ message, request, resolution, activeChange }) {
  const selectorLabel = request.selectorType === 'task-handle'
    ? '任务句柄'
    : request.selectorType === 'work-unit'
      ? '工作单元'
      : '继续目标';
  const selectorValue = request.selector ?? String(message ?? '').trim() ?? '';
  return {
    type: 'continuation-unresolved',
    title: `未能解析${selectorLabel} ${selectorValue}`,
    command: String(message ?? '').trim()
      ? `openprd run . --context --message ${shellQuote(String(message).trim())}`
      : 'openprd run . --context',
    verifyCommand: 'openprd run . --verify',
    reason: [
      `当前请求显式给出了${selectorLabel}，但本地 OpenPrd 索引还不能把它精确绑定到 change/task/work unit。`,
      resolution?.reason ?? null,
      activeChange ? `当前工作区 active change ${activeChange} 只作为背景提醒，不会自动顶替这个显式目标。` : null,
    ].filter(Boolean).join(' '),
    changeId: null,
    task: null,
    coverageItem: null,
    continuationTarget: {
      sessionId: request.sessionId ?? null,
      taskHandle: request.taskHandle ?? null,
      taskId: null,
      changeId: null,
      workUnitId: request.workUnitId ?? null,
    },
  };
}

function applyLaneToRecommendation(recommendation, lane) {
  if (!recommendation || !['continuation', 'targeted'].includes(lane?.kind)) {
    return recommendation;
  }
  if (lane.selectorType === 'session') {
    return buildSessionContinuationRecommendation(recommendation, lane);
  }
  if (
    lane.kind === 'continuation'
    && ['task-handle', 'work-unit'].includes(lane.selectorType)
    && !lane.matched
  ) {
    return buildUnresolvedContinuationRecommendation({
      message: lane.text,
      request: lane,
      resolution: lane.resolution,
      activeChange: recommendation?.changeId ?? null,
    });
  }
  const targetParts = [
    lane.target?.sessionId ? `会话 ${lane.target.sessionId}` : null,
    lane.target?.taskHandle ? `任务句柄 ${lane.target.taskHandle}` : null,
    lane.target?.changeId ? `变更 ${lane.target.changeId}` : null,
    lane.target?.workUnitId ? `工作单元 ${lane.target.workUnitId}` : null,
  ].filter(Boolean);
  const prefix = lane.kind === 'targeted'
    ? `当前用户消息已经命中${targetParts.join('、') || '已有对象'}；优先围绕这个目标给出结论，再把工作区历史 debt 单列。`
    : lane.matched
      ? `当前请求是在继续已有任务；优先围绕${targetParts.join('、') || '当前活动上下文'}给出任务级结论，再把工作区历史 debt 单列。`
      : '当前请求是在继续已有任务；先恢复最接近的任务上下文，再把工作区历史 debt 单列。';
  return {
    ...recommendation,
    reason: `${prefix} ${recommendation.reason}`.trim(),
    continuationTarget: lane.target ?? null,
  };
}

function shouldSurfaceDiscoveryInRunContext(discovery) {
  const mode = String(discovery?.control?.mode ?? '').trim().toLowerCase();
  if (!mode) {
    return Boolean(discovery);
  }
  return mode !== 'reference';
}

function buildPrdPromotionRecommendation({ changes, next }) {
  if (changes?.activeChange) {
    return null;
  }

  const snapshot = next?.analysisSnapshot ?? null;
  if (!snapshot?.digest) {
    return null;
  }

  const reviewState = next?.prdReviewState ?? null;
  const suggestedChangeId = slugify(snapshot.title ?? snapshot.versionId);
  if (reviewState?.status !== 'confirmed') {
    return null;
  }

  return {
    type: 'prd-change',
    title: `生成 ${suggestedChangeId} 的 change 和任务拆解`,
    command: 'openprd review . --open',
    executionCommand: `openprd change . --generate --change ${shellQuote(suggestedChangeId)}`,
    verifyCommand: `openprd change . --validate --change ${shellQuote(suggestedChangeId)}`,
    reason: '最新 PRD review.html 已确认，但还没有 active change；进入实现前需要先生成 change、spec 和结构化任务。',
    changeId: suggestedChangeId,
    task: null,
    coverageItem: null,
    prd: {
      versionId: snapshot.versionId,
      digest: snapshot.digest,
      workUnitId: snapshot.workUnitId ?? null,
      reviewStatus: reviewState.status,
      reviewCommand: reviewMarkCommand(snapshot),
    },
    intentGate: executionGate(),
  };
}

function buildRequirementIntakeRecommendation({ gate, next, activeChange }) {
  const nextAction = next?.recommendation?.nextAction ?? 'clarify-user';
  const titleByAction = {
    'clarify-user': '继续本轮需求入口澄清',
    classify: '补齐本轮需求的产品类型',
    interview: '补齐本轮需求的关键事实',
    synthesize: '生成本轮需求的 PRD 评审稿',
    diagram: '生成本轮需求的可视化评审',
    review: '确认本轮需求的 review.html',
    freeze: '进入本轮需求定稿前检查',
    handoff: '导出本轮需求交接包',
  };
  return {
    type: 'requirement-intake',
    title: titleByAction[nextAction] ?? '继续本轮需求入口',
    command: next?.recommendation?.suggestedCommand ?? 'openprd clarify .',
    verifyCommand: 'openprd run . --verify',
    reason: [
      '当前有 active requirement intake；先围绕本轮需求完成澄清、评审、change 和任务拆解。',
      activeChange ? `历史 active change ${activeChange} 仅作为提醒，不抢本轮默认执行路线。` : null,
      next?.recommendation?.reason ?? null,
    ].filter(Boolean).join(' '),
    changeId: null,
    task: null,
    coverageItem: null,
    requirementGate: {
      status: gate?.status ?? null,
      promptPreview: gate?.promptPreview ?? null,
      intakeMode: gate?.intakeMode ?? null,
      sessionId: gate?.sessionId ?? null,
    },
  };
}

function buildRunRecommendation({
  message,
  changes,
  activeChange,
  focusedChangeId,
  taskState,
  discovery,
  next,
  loopFeatureList,
  requirementGate,
  laneRequest,
  resolvedTarget,
}) {
  if (
    ['task-handle', 'work-unit'].includes(laneRequest?.selectorType)
    && !resolvedTarget?.matched
  ) {
    return buildUnresolvedContinuationRecommendation({
      message,
      request: laneRequest,
      resolution: resolvedTarget,
      activeChange,
    });
  }
  if (requirementGate?.active && !laneRequest?.requested && !resolvedTarget?.matched) {
    return buildRequirementIntakeRecommendation({ gate: requirementGate, next, activeChange });
  }
  if (taskState?.nextTask) {
    const task = compactTask(taskState.nextTask);
    const totalTasks = Number(taskState.summary?.total ?? taskState.tasks?.length ?? 0);
    const pendingTasks = Number(taskState.summary?.pending ?? 0);
    const implementationTasks = Number(taskState.summary?.implementation?.total ?? 0);
    const pendingImplementationTasks = Number(taskState.summary?.implementation?.pending ?? 0);
    if (
      implementationTasks >= OPENPRD_LOOP_REQUIRED_IMPLEMENTATION_TASK_THRESHOLD
      || pendingImplementationTasks >= OPENPRD_LOOP_REQUIRED_IMPLEMENTATION_TASK_THRESHOLD
    ) {
      const loopReady = loopFeatureList?.changeId === taskState.changeId && Array.isArray(loopFeatureList.tasks);
      return {
        type: 'loop-task',
        title: `用 Loop 执行 ${task.id}: ${task.title}`,
        command: `openprd tasks . --change ${shellQuote(taskState.changeId)}`,
        preparationCommand: loopReady
          ? `openprd loop . --next --item ${shellQuote(task.id)}`
          : `openprd loop . --plan --change ${shellQuote(taskState.changeId)}`,
        executionCommand: loopReady
          ? `openprd loop . --run --agent codex --item ${shellQuote(task.id)}`
          : `openprd loop . --plan --change ${shellQuote(taskState.changeId)} && openprd loop . --run --agent codex --item ${shellQuote(task.id)}`,
        commitCommand: `openprd loop . --finish --item ${shellQuote(task.id)} --commit`,
        verifyCommand: `openprd loop . --verify --item ${shellQuote(task.id)}`,
        reason: `当前变更包含 ${implementationTasks} 个实质实现任务，达到 ${OPENPRD_LOOP_REQUIRED_IMPLEMENTATION_TASK_THRESHOLD} 个实现任务的拆分阈值；建议使用独立 worktree 和 OpenPrd Loop 单任务会话，且只有用户明确要求开发、继续任务或深度对标落地时才执行。`,
        changeId: taskState.changeId,
        task,
        coverageItem: null,
        intentGate: executionGate(),
        loop: {
          required: true,
          threshold: OPENPRD_LOOP_REQUIRED_IMPLEMENTATION_TASK_THRESHOLD,
          planned: loopReady,
          totalTasks,
          pendingTasks,
          implementationTasks,
          pendingImplementationTasks,
          worktreeRecommended: true,
        },
      };
    }
    return {
      type: 'task',
      title: `推进 ${task.id}: ${task.title}`,
      command: `openprd tasks . --change ${shellQuote(taskState.changeId)}`,
      executionCommand: `openprd tasks . --change ${shellQuote(taskState.changeId)} --advance --verify --item ${shellQuote(task.id)}`,
      verifyCommand: task.verify ?? `openprd tasks . --change ${shellQuote(taskState.changeId)} --verify --item ${shellQuote(task.id)}`,
      reason: '存在一个依赖已就绪的 OpenPrd 任务；只有用户明确要求开发、实现或继续任务时才推进。',
      changeId: taskState.changeId,
      task,
      coverageItem: null,
      intentGate: executionGate(),
      loop: {
        required: false,
        threshold: OPENPRD_LOOP_REQUIRED_IMPLEMENTATION_TASK_THRESHOLD,
        totalTasks,
        pendingTasks,
        implementationTasks,
        pendingImplementationTasks,
        worktreeRecommended: false,
      },
    };
  }
  if (taskState && taskState.summary?.pending === 0 && focusedChangeId) {
    return {
      type: 'change-review',
      title: `校验已完成的变更 ${focusedChangeId}`,
      command: `openprd change . --validate --change ${shellQuote(focusedChangeId)}`,
      verifyCommand: `openprd change . --validate --change ${shellQuote(focusedChangeId)}`,
      reason: '当前激活变更没有待处理的结构化任务。',
      changeId: focusedChangeId,
      task: null,
      coverageItem: null,
    };
  }
  const prdPromotion = buildPrdPromotionRecommendation({ changes, next });
  if (prdPromotion) {
    return prdPromotion;
  }
  const nextCoverage = discovery?.coverageMatrix?.nextPendingItem;
  if (nextCoverage) {
    const item = compactCoverageItem(nextCoverage);
    return {
      type: 'discovery',
      title: `调研 ${item.title}`,
      command: 'openprd discovery . --verify',
      executionCommand: `openprd discovery . --advance --item ${shellQuote(item.id)} --claim <evidence-backed-claim> --evidence <path>`,
      verifyCommand: 'openprd discovery . --verify',
      reason: '存在一个待处理的 OpenPrd discovery 覆盖项；只有用户明确要求深度调研、对标、复刻或持续补全时才推进覆盖项。',
      changeId: focusedChangeId ?? activeChange,
      task: null,
      coverageItem: item,
      intentGate: executionGate(),
    };
  }
  if (discovery?.coverageMatrix?.summary?.pending === 0 && discovery?.runId) {
    return {
      type: 'discovery-review',
      title: `校验 discovery run ${discovery.runId}`,
      command: 'openprd discovery . --verify',
      verifyCommand: 'openprd discovery . --verify',
      reason: '当前 discovery run 没有待处理覆盖项。',
      changeId: focusedChangeId ?? activeChange,
      task: null,
      coverageItem: null,
    };
  }
  return {
    type: 'workflow',
    title: next?.recommendation?.nextAction ?? 'Inspect OpenPrd next action',
    command: next?.recommendation?.suggestedCommand ?? 'openprd next .',
    verifyCommand: 'openprd validate .',
    reason: next?.recommendation?.reason ?? 'No active task or discovery item was found.',
    changeId: focusedChangeId ?? activeChange,
    task: null,
    coverageItem: null,
  };
}

async function buildRunContext(projectRoot, dependencies, options = {}) {
  const {
    listOpenPrdChangesWorkspace,
    listOpenSpecTaskWorkspace,
    nextWorkspace,
    resumeOpenSpecDiscoveryWorkspace,
    validateWorkspace,
  } = dependencies;
  await ensureRunHarness(projectRoot);
  const runState = await readRunState(projectRoot);
  const laneRequest = analyzeRunMessage(options.message);
  const validation = await validateWorkspace(projectRoot)
    .then(({ report }) => report)
    .catch((error) => ({
      valid: false,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings: [],
      checks: [],
    }));
  const next = await nextWorkspace(projectRoot).catch(() => null);
  const requirementGate = await readActiveRequirementGate(projectRoot);
  const changes = await listOpenPrdChangesWorkspace(projectRoot).catch(() => null);
  const activeChange = changes?.activeChange ?? null;
  const latestPrd = next?.analysisSnapshot
    ? {
        versionId: next.analysisSnapshot.versionId ?? null,
        digest: next.analysisSnapshot.digest ?? null,
        workUnitId: next.analysisSnapshot.workUnitId ?? null,
        title: next.analysisSnapshot.title ?? null,
        status: next.analysisSnapshot.status ?? null,
      }
    : null;
  const loopFeatureList = await readJson(harnessFile(projectRoot, OPENPRD_HARNESS_LOOP_FEATURE_LIST)).catch(() => null);
  const shouldResolveTarget = Boolean(String(options.message ?? '').trim());
  const resolutionIndex = shouldResolveTarget
    ? await buildRunResolutionIndex(projectRoot, changes, listOpenSpecTaskWorkspace)
    : null;
  const resolvedTarget = shouldResolveTarget
    ? await resolveRunTarget({
        projectRoot,
        message: options.message,
        request: laneRequest,
        index: resolutionIndex,
        loopFeatureList,
      })
    : null;
  const focusedChangeId = selectFocusedChangeId(laneRequest, resolvedTarget, activeChange);
  const taskState = focusedChangeId
    ? await listOpenSpecTaskWorkspace(projectRoot, { change: focusedChangeId }).catch(() => null)
    : null;
  const resumedDiscovery = await resumeOpenSpecDiscoveryWorkspace(projectRoot).catch(() => null);
  const discovery = shouldSurfaceDiscoveryInRunContext(resumedDiscovery) ? resumedDiscovery : null;
  const recommendation = buildRunRecommendation({
    message: options.message,
    changes,
    activeChange,
    focusedChangeId,
    taskState,
    discovery,
    next,
    loopFeatureList,
    requirementGate,
    laneRequest,
    resolvedTarget,
  });
  const nextTask = compactTask(taskState?.nextTask ?? null);
  const lane = buildRunLane({
    message: options.message,
    recommendation,
    activeChange,
    latestPrd,
    loopFeatureList,
    resolvedTarget,
  });
  const effectiveRecommendation = applyLaneToRecommendation(recommendation, lane);

  const context = {
    ok: validation.valid,
    action: 'run-context',
    projectRoot,
    generatedAt: timestamp(),
    runState,
    validation: {
      valid: validation.valid,
      errors: validation.errors ?? [],
      warnings: validation.warnings ?? [],
    },
    workflow: next?.workflow ?? [],
    next: next?.recommendation ?? null,
    activeRequirementGate: requirementGate
      ? {
          status: requirementGate.status ?? null,
          promptPreview: requirementGate.promptPreview ?? null,
          intakeMode: requirementGate.intakeMode ?? null,
          sessionId: requirementGate.sessionId ?? null,
        }
      : null,
    prdReviewState: next?.prdReviewState
      ? {
          versionId: next.prdReviewState.versionId ?? null,
          status: next.prdReviewState.status ?? null,
          artifactExists: Boolean(next.prdReviewState.artifactExists),
          artifact: next.prdReviewState.artifact ?? null,
          shouldGateFreeze: Boolean(next.prdReviewState.shouldGateFreeze),
        }
      : null,
    latestPrd,
    activeChange,
    focus: {
      changeId: focusedChangeId,
      source: resolvedTarget?.source ?? null,
      sessionId: resolvedTarget?.sessionId ?? lane.target?.sessionId ?? null,
      taskHandle: resolvedTarget?.taskHandle ?? null,
      workUnitId: resolvedTarget?.workUnitId ?? null,
      matched: Boolean(resolvedTarget?.matched),
      reason: resolvedTarget?.reason ?? null,
      promptPreview: resolvedTarget?.promptPreview ?? null,
    },
    taskSummary: taskState?.summary ?? null,
    nextTask,
    blockedTasks: taskState?.blockedTasks ?? [],
    discovery: discovery
      ? {
          runId: discovery.runId,
          mode: discovery.control?.mode ?? null,
          status: discovery.control?.status ?? null,
          iteration: discovery.control?.iteration ?? null,
          maxIterations: discovery.control?.maxIterations ?? null,
          summary: discovery.coverageMatrix?.summary ?? null,
          nextPendingItem: compactCoverageItem(discovery.coverageMatrix?.nextPendingItem ?? null),
        }
      : null,
    lane,
    recommendation: effectiveRecommendation,
    files: {
      runState: OPENPRD_HARNESS_RUN_STATE,
      iterations: OPENPRD_HARNESS_ITERATIONS,
      learnings: OPENPRD_HARNESS_LEARNINGS,
    },
  };

  await writeRunState(projectRoot, {
    ...runState,
    lastContextAt: context.generatedAt,
    lastRecommendation: effectiveRecommendation,
  });

  return context;
}

async function recordRunHook(projectRoot, options = {}) {
  await ensureRunHarness(projectRoot);
  const state = await readRunState(projectRoot);
  const currentIteration = Number(state.currentIteration ?? 0) + 1;
  const event = {
    version: 1,
    at: timestamp(),
    iteration: currentIteration,
    type: 'hook',
    eventName: options.event ?? 'Unknown',
    risk: options.risk ?? 'unknown',
    outcome: options.outcome ?? 'unknown',
    preview: options.preview ?? null,
  };
  await appendJsonl(harnessFile(projectRoot, OPENPRD_HARNESS_ITERATIONS), event);
  await writeRunState(projectRoot, {
    ...state,
    currentIteration,
    lastHookAt: event.at,
    lastOutcome: event.outcome,
  });
  if (options.learn) {
    await appendText(harnessFile(projectRoot, OPENPRD_HARNESS_LEARNINGS), `\n## ${event.at}\n\n- ${options.learn}\n`);
  }
  return {
    ok: true,
    action: 'run-record-hook',
    projectRoot,
    event,
    files: {
      runState: OPENPRD_HARNESS_RUN_STATE,
      iterations: OPENPRD_HARNESS_ITERATIONS,
      learnings: OPENPRD_HARNESS_LEARNINGS,
    },
  };
}

async function verifyRunWorkspace(projectRoot, dependencies, options = {}) {
  const {
    checkStandardsWorkspace,
    validateOpenSpecChangeWorkspace,
    validateWorkspace,
    verifyOpenSpecDiscoveryWorkspace,
    verifyQualityWorkspace,
  } = dependencies;
  const context = await buildRunContext(projectRoot, dependencies, options);
  const standards = await checkStandardsWorkspace(projectRoot);
  const validation = await validateWorkspace(projectRoot).then(({ report }) => report);
  const checks = [
    { name: 'standards', scope: 'task', ok: standards.ok, errors: standards.errors ?? [] },
    { name: 'validate', scope: 'task', ok: validation.valid, errors: validation.errors ?? [] },
  ];
  if (verifyQualityWorkspace) {
    const quality = await verifyQualityWorkspace(projectRoot, { strict: false }).catch((error) => ({
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    }));
    const productionReady = quality.report?.readiness?.productionReady ?? null;
    const qualityErrors = [
      ...(quality.errors ?? []),
      ...(productionReady === false ? ['Quality report is not production-ready. Review required gates and evidence before claiming readiness.'] : []),
    ];
    checks.push({
      name: 'quality',
      scope: 'workspace',
      ok: quality.ok && productionReady === true,
      errors: qualityErrors,
      reportPath: quality.reportPath ?? null,
      htmlPath: quality.htmlPath ?? null,
      productionReady,
      attentionGates: quality.report?.readiness?.attentionGates ?? [],
    });
  }
  const changeToVerify = context.focus?.changeId ?? context.recommendation?.changeId ?? context.activeChange ?? null;
  if (changeToVerify) {
    const change = await validateOpenSpecChangeWorkspace(projectRoot, { change: changeToVerify });
    checks.push({ name: 'change', scope: 'task', ok: change.ok, errors: change.errors ?? [] });
  }
  if (context.discovery) {
    const discovery = await verifyOpenSpecDiscoveryWorkspace(projectRoot);
    checks.push({ name: 'discovery', scope: 'task', ok: discovery.ok, errors: discovery.verification.errors ?? [] });
  }
  const taskChecks = checks.filter((check) => check.scope !== 'workspace');
  const workspaceChecks = checks;
  const taskReady = taskChecks.every((check) => check.ok);
  const workspaceReady = workspaceChecks.every((check) => check.ok);
  const ok = taskReady;
  const qualityCheck = checks.find((check) => check.name === 'quality');
  const readiness = {
    taskReady,
    workspaceReady,
    releaseReady: workspaceReady,
    doctorReady: null,
    qualityProductionReady: qualityCheck?.productionReady ?? null,
  };
  const knowledgeSignal = {
    kind: 'run-verify',
    ok: workspaceReady,
    taskReady,
    workspaceReady,
    productionReady: qualityCheck?.productionReady ?? null,
    attentionGates: qualityCheck?.attentionGates ?? [],
    summary: taskReady
      ? (workspaceReady ? 'run verify passed' : `run verify task-ready with workspace attention: ${workspaceChecks.filter((check) => !check.ok).map((check) => check.name).join(', ')}`)
      : `run verify failed: ${taskChecks.filter((check) => !check.ok).map((check) => check.name).join(', ')}`,
  };
  await recordKnowledgeReviewSignal(projectRoot, knowledgeSignal).catch(() => null);
  const reviewSource = (await exists(harnessFile(projectRoot, OPENPRD_HARNESS_TURN_STATE)))
    ? OPENPRD_HARNESS_TURN_STATE
    : (qualityCheck?.reportPath ?? null);
  const knowledgeReview = await reviewKnowledgeWorkspace(projectRoot, {
    from: reviewSource,
    signal: knowledgeSignal,
  }).catch((error) => ({
    ok: false,
    action: 'quality-knowledge-review',
    skipped: false,
    errors: [error instanceof Error ? error.message : String(error)],
  }));
  await appendJsonl(harnessFile(projectRoot, OPENPRD_HARNESS_ITERATIONS), {
    version: 1,
    at: timestamp(),
    type: 'verify',
    ok,
    readiness,
    checks: checks.map((check) => ({ name: check.name, scope: check.scope, ok: check.ok, errors: check.errors.length })),
  });
  const errors = taskChecks.flatMap((check) => check.errors.map((error) => `${check.name}: ${error}`));
  const warnings = workspaceChecks
    .filter((check) => check.scope === 'workspace' && !check.ok)
    .flatMap((check) => check.errors.map((error) => `${check.name}: ${error}`));
  return {
    ok,
    action: 'run-verify',
    projectRoot,
    context,
    checks,
    readiness,
    warnings,
    knowledgeReview,
    errors,
  };
}

async function runWorkspaceImpl(projectRoot, options = {}, dependencies = {}) {
  if (options.recordHook) {
    return recordRunHook(projectRoot, options);
  }
  if (options.verify) {
    return verifyRunWorkspace(projectRoot, dependencies, options);
  }
  return buildRunContext(projectRoot, dependencies, options);
}


function createRunWorkspace(dependencies) {
  return function runWorkspace(projectRoot, options = {}) {
    return runWorkspaceImpl(projectRoot, options, dependencies);
  };
}

export { createRunWorkspace };
