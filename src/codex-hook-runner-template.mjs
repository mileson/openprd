import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const eventName = process.argv[2] || 'Unknown';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let payload = {};
  try { payload = input.trim() ? JSON.parse(input) : {}; } catch {}
  const cwd = payload.cwd || process.cwd();
  const result = handle(eventName, cwd, payload);
  if (result) {
    process.stdout.write(JSON.stringify(result));
  }
});

function now() {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function findProjectRoot(start) {
  let current = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(current, '.openprd'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(start || process.cwd());
    }
    current = parent;
  }
}

function harnessDir(root) {
  return path.join(root, '.openprd', 'harness');
}

function ensureHarness(root) {
  const dir = harnessDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const statePath = path.join(dir, 'hook-state.json');
  if (!fs.existsSync(statePath)) {
    writeJsonSync(statePath, {
      version: 1,
      active: true,
      lastEventAt: null,
      lastFingerprint: null,
      counters: {},
      recentFingerprints: {},
      suppressions: { inputLock: false },
    });
  }
  const eventsPath = path.join(dir, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) {
    fs.writeFileSync(eventsPath, '');
  }
}

function readJsonSync(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonSync(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function appendEvent(root, event) {
  ensureHarness(root);
  fs.appendFileSync(path.join(harnessDir(root), 'events.jsonl'), JSON.stringify({ at: now(), ...event }) + '\n');
}

function turnStatePath(root) {
  return path.join(harnessDir(root), 'turn-state.json');
}

function defaultTurnState() {
  return {
    version: 1,
    id: null,
    sessionId: null,
    prompt: null,
    promptPreview: null,
    title: null,
    status: 'needs-attention',
    startedAt: null,
    updatedAt: null,
    touchedFiles: [],
    reviewSignals: [],
    runtimeEvents: [],
    timeline: [],
    lastKnowledgePromptCandidateId: null,
    lastKnowledgePromptAt: null,
  };
}

function readTurnState(root) {
  return {
    ...defaultTurnState(),
    ...readJsonSync(turnStatePath(root), defaultTurnState()),
  };
}

function writeTurnState(root, next) {
  writeJsonSync(turnStatePath(root), {
    ...defaultTurnState(),
    ...next,
    updatedAt: now(),
  });
}

function normalizeProjectFile(root, filePath) {
  const raw = String(filePath || '').trim();
  if (!raw) return null;
  const absolutePath = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
  if (!relativePath || relativePath.startsWith('..')) {
    return null;
  }
  return relativePath;
}

function extractTouchedFiles(root, payload) {
  const files = [];
  const toolInput = payload?.tool_input ?? payload?.toolInput ?? payload?.input ?? null;
  const addFile = (value) => {
    const normalized = normalizeProjectFile(root, value);
    if (normalized) {
      files.push(normalized);
    }
  };
  if (toolInput && typeof toolInput === 'object') {
    for (const field of ['file_path', 'filePath', 'path', 'target_path', 'targetPath']) {
      if (typeof toolInput[field] === 'string') {
        addFile(toolInput[field]);
      }
    }
  }
  const patchText = typeof toolInput === 'string'
    ? toolInput
    : (typeof toolInput?.patch === 'string' ? toolInput.patch : '');
  if (patchText) {
    for (const line of patchText.split(/\r?\n/)) {
      const match = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/)
        || line.match(/^\*\*\* Move to: (.+)$/);
      if (match?.[1]) {
        addFile(match[1].trim());
      }
    }
  }
  return [...new Set(files)];
}

function beginTurnReview(root, baseEvent, prompt) {
  const promptPreview = preview(prompt, 240);
  writeTurnState(root, {
    version: 1,
    id: `turn-${String(Date.now())}-${baseEvent.fingerprint ?? 'openprd'}`,
    knowledgeCandidateId: null,
    sessionId: baseEvent.sessionId,
    prompt,
    promptPreview,
    title: promptPreview || '本轮项目回顾',
    summary: {
      title: promptPreview || '本轮项目回顾',
      status: 'needs-attention',
      message: '等待本轮实现和验证信号，用于 Stop 回顾生成项目经验草案。',
    },
    status: 'needs-attention',
    startedAt: now(),
    touchedFiles: [],
    reviewSignals: [],
    runtimeEvents: promptPreview ? [{
      eventName: 'user-prompt',
      status: 'pass',
      message: promptPreview,
      at: now(),
    }] : [],
    timeline: promptPreview ? [{
      event: 'user-prompt',
      status: 'pass',
      message: promptPreview,
      at: now(),
    }] : [],
    lastKnowledgePromptCandidateId: null,
    lastKnowledgePromptAt: null,
  });
}

function recordTouchedFiles(root, payload) {
  const touchedFiles = extractTouchedFiles(root, payload);
  if (touchedFiles.length === 0) {
    return [];
  }
  const state = readTurnState(root);
  writeTurnState(root, {
    ...state,
    touchedFiles: [...new Set([...(Array.isArray(state.touchedFiles) ? state.touchedFiles : []), ...touchedFiles])],
  });
  return touchedFiles;
}

function updateHookState(root, event) {
  ensureHarness(root);
  const statePath = path.join(harnessDir(root), 'hook-state.json');
  const state = readJsonSync(statePath, {
    version: 1,
    counters: {},
    recentFingerprints: {},
    suppressions: { inputLock: false },
  });
  state.lastEventAt = now();
  state.lastEvent = event.eventName;
  state.lastFingerprint = event.fingerprint;
  state.counters[event.eventName] = (state.counters[event.eventName] || 0) + 1;
  state.recentFingerprints = state.recentFingerprints || {};
  if (event.fingerprint) {
    state.recentFingerprints[event.fingerprint] = Date.now();
  }
  for (const [fingerprint, seenAt] of Object.entries(state.recentFingerprints)) {
    if (Date.now() - Number(seenAt) > 300000) {
      delete state.recentFingerprints[fingerprint];
    }
  }
  writeJsonSync(statePath, state);
  return state;
}

function isDuplicate(root, fingerprint, windowMs = 15000) {
  const state = readJsonSync(path.join(harnessDir(root), 'hook-state.json'), {});
  const seenAt = state?.recentFingerprints?.[fingerprint];
  return Boolean(seenAt && Date.now() - Number(seenAt) < windowMs);
}

function fingerprintFor(eventName, payload, risk) {
  const tool = payload.tool_name || payload.toolName || payload.name || '';
  const inputText = JSON.stringify(payload.tool_input || payload.toolInput || payload.input || payload || {}).slice(0, 2000);
  return crypto.createHash('sha256').update(JSON.stringify({ eventName, tool, inputText, risk: risk.level })).digest('hex').slice(0, 16);
}

function sanitizeSessionId(value) {
  const text = String(value || '').trim();
  return /^[a-zA-Z0-9._-]{6,160}$/.test(text) ? text : null;
}

function sessionIdFor(payload) {
  const direct = sanitizeSessionId(payload.session_id || payload.sessionId || payload.thread_id || payload.threadId || payload.conversation_id || payload.conversationId);
  if (direct) return direct;
  const transcript = String(payload.transcript_path || payload.transcriptPath || '');
  const match = transcript.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match ? sanitizeSessionId(match[1]) : null;
}

function payloadText(payload) {
  return JSON.stringify(payload.tool_input || payload.toolInput || payload.input || payload || {});
}

function promptText(payload) {
  return String(payload.prompt || payload.user_prompt || payload.message || '');
}

function preview(text, max = 600) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function commandText(payload) {
  const direct = typeof payload?.cmd === 'string'
    ? payload.cmd
    : typeof payload?.command === 'string'
      ? payload.command
      : '';
  if (direct) {
    return direct;
  }
  const toolInput = payload?.tool_input ?? payload?.toolInput ?? payload?.input ?? null;
  if (typeof toolInput === 'string') {
    return toolInput;
  }
  if (toolInput && typeof toolInput.cmd === 'string') {
    return toolInput.cmd;
  }
  return '';
}

function toolName(payload) {
  return String(payload?.tool_name || payload?.toolName || payload?.name || '').trim();
}

function namedGateDir(root, gateName) {
  return path.join(harnessDir(root), `${gateName}-gates`);
}

function namedGatePath(root, gateName, sessionId = null) {
  if (sessionId) {
    return path.join(namedGateDir(root, gateName), `${sessionId}.json`);
  }
  return path.join(harnessDir(root), `${gateName}-gate.json`);
}

function readNamedGate(root, gateName, sessionId = null) {
  return readJsonSync(namedGatePath(root, gateName, sessionId), null);
}

function writeNamedGate(root, gateName, value, sessionId = null) {
  const next = sessionId ? { ...value, sessionId } : value;
  writeJsonSync(namedGatePath(root, gateName, sessionId), next);
  if (sessionId) {
    writeJsonSync(namedGatePath(root, gateName), next);
  }
  return next;
}

function updateNamedGate(root, gateName, patch, sessionId = null) {
  const current = readNamedGate(root, gateName, sessionId);
  if (!current) {
    return null;
  }
  return writeNamedGate(root, gateName, {
    ...current,
    updatedAt: now(),
    ...patch,
  }, sessionId);
}

function legacyRequirementGatePath(root) {
  return path.join(harnessDir(root), 'requirement-gate.json');
}

function requirementGateDir(root) {
  return path.join(harnessDir(root), 'requirement-gates');
}

function requirementGatePath(root, sessionId = null) {
  if (sessionId) {
    return path.join(requirementGateDir(root), `${sessionId}.json`);
  }
  return legacyRequirementGatePath(root);
}

function sessionBindingDir(root) {
  return path.join(harnessDir(root), 'session-bindings');
}

function sessionBindingPath(root, sessionId = null) {
  if (!sessionId) {
    return null;
  }
  return path.join(sessionBindingDir(root), `${String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
}

function openprdHome() {
  return path.resolve(process.env.OPENPRD_HOME || path.join(os.homedir(), '.openprd'));
}

function sessionRegistryPath() {
  return path.join(openprdHome(), 'registry', 'sessions.jsonl');
}

function sessionStatePath(root, sessionId = null) {
  if (!sessionId) {
    return null;
  }
  return path.join(harnessDir(root), 'session-states', `${String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
}

function currentStatePath(root) {
  return path.join(root, '.openprd', 'state', 'current.json');
}

function normalizeReviewStatus(value) {
  return ['pending-confirmation', 'confirmed', 'needs-revision'].includes(value) ? value : 'missing';
}

function normalizeRequirementApprovalPolicy(policy = {}) {
  const reviewPolicy = ['required', 'silent-record'].includes(policy?.reviewPolicy)
    ? policy.reviewPolicy
    : 'required';
  const maxClarificationQuestionsRaw = Number(policy?.maxClarificationQuestions);
  const maxClarificationQuestions = Number.isFinite(maxClarificationQuestionsRaw) && maxClarificationQuestionsRaw > 0
    ? Math.max(1, Math.floor(maxClarificationQuestionsRaw))
    : null;
  return {
    mode: 'decision-points',
    reviewPolicy,
    executionMode: policy?.executionMode === 'auto-after-review-and-tasks'
      ? 'auto-after-review-and-tasks'
      : 'manual-after-review-and-tasks',
    suppressExtraConfirmation: Boolean(policy?.suppressExtraConfirmation),
    maxClarificationQuestions,
  };
}

function requirementApprovalPolicy(gate) {
  return normalizeRequirementApprovalPolicy(gate?.approvalPolicy);
}

function reviewPolicyRequiresHumanConfirmation(policy) {
  return normalizeRequirementApprovalPolicy(policy).reviewPolicy === 'required';
}

function reviewPolicyAllowsSilentRecord(policy) {
  return normalizeRequirementApprovalPolicy(policy).reviewPolicy === 'silent-record';
}

function resolveRequirementApprovalPolicy(prompt, intent = {}) {
  const suppressExtraConfirmation = Boolean(intent?.noConfirmationRequested);
  const explicitExecution = Boolean(intent?.explicitExecution);
  return normalizeRequirementApprovalPolicy({
    mode: 'decision-points',
    reviewPolicy: explicitExecution && suppressExtraConfirmation ? 'silent-record' : 'required',
    executionMode: explicitExecution ? 'auto-after-review-and-tasks' : 'manual-after-review-and-tasks',
    suppressExtraConfirmation,
    maxClarificationQuestions: explicitExecution
      ? (suppressExtraConfirmation ? 1 : 2)
      : null,
  });
}

function readCliFlagValue(command, flag) {
  const quotedPattern = new RegExp(`${flag}\\s+(?:'([^']+)'|"([^"]+)"|([^\\s]+))`, 'i');
  const match = String(command || '').match(quotedPattern);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function parseReviewMarkCommand(text) {
  const command = String(text || '');
  if (!/openprd\s+review\b/i.test(command) || !/--mark\b/i.test(command)) {
    return null;
  }
  const mark = readCliFlagValue(command, '--mark')?.toLowerCase() ?? null;
  const versionId = readCliFlagValue(command, '--version');
  const digest = readCliFlagValue(command, '--digest');
  const workUnitId = readCliFlagValue(command, '--work-unit');
  if (!mark) {
    return null;
  }
  return { mark, versionId, digest, workUnitId };
}

function readSessionBinding(root, sessionId = null) {
  return readJsonSync(sessionBindingPath(root, sessionId), null);
}

function appendJsonLine(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(value) + '\n');
}

function writeSessionRegistryEntry(root, sessionId, patch = {}) {
  if (!sessionId) {
    return null;
  }
  const workspaceRoot = path.resolve(root);
  const recordedAt = patch.recordedAt || now();
  const entry = {
    version: 1,
    sessionId,
    workspaceRoot,
    realpath: workspaceRoot,
    laneKind: patch.laneKind || 'requirement',
    tool: patch.tool || 'codex',
    threadId: patch.threadId || null,
    changeId: patch.changeId || null,
    taskHandle: patch.taskHandle || null,
    workUnitId: patch.workUnitId || null,
    versionId: patch.versionId || null,
    digest: patch.digest || null,
    title: patch.title || null,
    targetRoot: patch.targetRoot ? path.resolve(patch.targetRoot) : null,
    promptPreview: patch.promptPreview || null,
    reviewStatus: patch.reviewStatus || null,
    gateStatus: patch.gateStatus || null,
    gateActive: patch.gateActive === true,
    statePath: patch.statePath || sessionStatePath(root, sessionId),
    bindingPath: patch.bindingPath || sessionBindingPath(root, sessionId),
    firstRegisteredAt: patch.firstRegisteredAt || recordedAt,
    lastRegisteredAt: recordedAt,
    lastUpdatedAt: patch.updatedAt || recordedAt,
    recordedAt,
  };
  appendJsonLine(sessionRegistryPath(), entry);
  return entry;
}

function writeSessionBinding(root, sessionId, patch = {}) {
  if (!sessionId) {
    return null;
  }
  const filePath = sessionBindingPath(root, sessionId);
  const previous = readJsonSync(filePath, null);
  const next = {
    ...(previous ?? {}),
    version: 1,
    sessionId,
    ...patch,
    createdAt: previous?.createdAt ?? patch.createdAt ?? now(),
    updatedAt: patch.updatedAt ?? now(),
  };
  writeJsonSync(filePath, next);
  writeSessionRegistryEntry(root, sessionId, {
    laneKind: patch.laneKind ?? previous?.laneKind ?? 'requirement',
    tool: patch.tool ?? previous?.tool ?? 'codex',
    threadId: patch.threadId ?? previous?.threadId ?? null,
    changeId: patch.changeId ?? next.changeId ?? null,
    taskHandle: patch.taskHandle ?? next.taskHandle ?? null,
    workUnitId: patch.workUnitId ?? next.workUnitId ?? null,
    versionId: patch.versionId ?? next.versionId ?? null,
    digest: patch.digest ?? next.digest ?? null,
    title: patch.title ?? next.title ?? null,
    targetRoot: patch.targetRoot ?? next.targetRoot ?? null,
    promptPreview: patch.promptPreview ?? next.promptPreview ?? null,
    reviewStatus: patch.reviewStatus ?? next.reviewStatus ?? null,
    gateStatus: patch.gateStatus ?? next.gateStatus ?? null,
    gateActive: patch.gateActive ?? next.gateActive ?? false,
    bindingPath: filePath,
    statePath: sessionStatePath(root, sessionId),
    updatedAt: next.updatedAt,
  });
  return next;
}

function readCurrentPrdReview(root) {
  const currentState = readJsonSync(currentStatePath(root), {}) || {};
  const reviewStatus = currentState.reviewStatus ?? {};
  const versionId = String(reviewStatus.versionId || currentState.latestVersionId || '').trim() || null;
  const digest = String(currentState.latestVersionDigest || '').trim() || null;
  const workUnitId = String(reviewStatus.workUnitId || currentState.activeWorkUnitId || '').trim() || null;
  return {
    versionId,
    digest,
    workUnitId,
    status: versionId ? normalizeReviewStatus(reviewStatus.status) : 'missing',
    artifact: reviewStatus.reviewPath || reviewStatus.stableArtifact || reviewStatus.entryPath || reviewStatus.artifact || null,
  };
}

function readRequirementLaneReview(root, sessionId = null) {
  const binding = readSessionBinding(root, sessionId);
  if (binding?.versionId || binding?.digest || binding?.workUnitId) {
    return {
      versionId: binding.versionId ?? null,
      digest: binding.digest ?? null,
      workUnitId: binding.workUnitId ?? null,
      status: binding.versionId ? normalizeReviewStatus(binding.reviewStatus) : 'missing',
      artifact: binding.reviewPath || binding.stableReviewArtifact || binding.activeReviewPath || binding.reviewArtifact || null,
    };
  }
  return readCurrentPrdReview(root);
}

function reviewCommandMatchesReview(command, review) {
  if (!command || !review) {
    return false;
  }
  return Boolean(
    command.versionId
    && command.digest
    && command.workUnitId
    && review.versionId
    && review.digest
    && review.workUnitId
    && command.versionId === review.versionId
    && command.digest === review.digest
    && command.workUnitId === review.workUnitId
  );
}

function readTextSync(filePath, maxLength = 20000) {
  try {
    return fs.readFileSync(filePath, 'utf8').slice(0, maxLength);
  } catch {
    return '';
  }
}

function findChangeDir(root, changeId) {
  const candidates = [
    path.join(root, 'openprd', 'changes', changeId),
    path.join(root, 'openspec', 'changes', changeId),
    path.join(root, 'openprd', 'archive', 'changes', changeId),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function stripMarkdown(text) {
  return String(text || '')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function humanizeChangeId(changeId) {
  return String(changeId || '未命名需求').replace(/[-_]+/g, ' ');
}

function firstHeading(text, fallback = '') {
  const match = String(text || '').match(/^#\s+(.+)$/m);
  return stripMarkdown(match?.[1] || fallback);
}

function specRequirementTitle(text) {
  const match = String(text || '').match(/^###\s+需求[:：]\s*(.+)$/m);
  return stripMarkdown(match?.[1] || '');
}

function collectSectionSummary(text, headingPatterns, maxItems = 3) {
  const lines = String(text || '').split(/\r?\n/);
  const collected = [];
  let inSection = false;
  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      const headingText = stripMarkdown(heading[1]);
      if (inSection && !headingPatterns.some((pattern) => pattern.test(headingText))) {
        break;
      }
      inSection = headingPatterns.some((pattern) => pattern.test(headingText));
      continue;
    }
    if (!inSection) {
      continue;
    }
    const item = stripMarkdown(line);
    if (item) {
      collected.push(item);
    }
    if (collected.length >= maxItems) {
      break;
    }
  }
  return collected.join('；');
}

function cleanTaskTitle(title) {
  return stripMarkdown(title)
    .replace(/^T\d+\.\d+\s+/, '')
    .replace(/^(实现主流程|实现需求|验证验收目标)[:：]\s*/, '')
    .trim();
}

function pendingTaskTitles(root, changeId, maxItems = 3) {
  const dir = findChangeDir(root, changeId);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((name) => /^tasks(?:-\d+)?\.md$/.test(name)).sort();
  } catch {
    return [];
  }
  const tasks = [];
  for (const file of files) {
    const text = readTextSync(path.join(dir, file));
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^- \[ \]\s+(.+)$/);
      if (!match) {
        continue;
      }
      const title = cleanTaskTitle(match[1]);
      if (title) {
        tasks.push(title);
      }
    }
  }
  const productTasks = tasks.filter((title) => !/(spec|validate|校验|评审|测试|文档|打包)/i.test(title));
  return (productTasks.length > 0 ? productTasks : tasks).slice(0, maxItems);
}

function readLocalTaskSummary(root, changeId) {
  if (!changeId) {
    return null;
  }
  const dir = findChangeDir(root, changeId);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((name) => /^tasks(?:-\d+)?\.md$/.test(name)).sort();
  } catch {
    return null;
  }
  let total = 0;
  let completed = 0;
  let pending = 0;
  for (const file of files) {
    const text = readTextSync(path.join(dir, file));
    for (const line of text.split(/\r?\n/)) {
      if (/^- \[x\]\s+/i.test(line)) {
        total += 1;
        completed += 1;
      } else if (/^- \[ \]\s+/.test(line)) {
        total += 1;
        pending += 1;
      }
    }
  }
  if (total === 0) {
    return null;
  }
  return {
    total,
    completed,
    pending,
    blocked: 0,
  };
}

function changeRequirementSummary(root, changeId) {
  const dir = findChangeDir(root, changeId);
  const proposal = readTextSync(path.join(dir, 'proposal.md'));
  const design = readTextSync(path.join(dir, 'design.md'));
  let spec = '';
  try {
    const specsRoot = path.join(dir, 'specs');
    const capability = fs.readdirSync(specsRoot).find((name) => !name.startsWith('.'));
    if (capability) {
      spec = readTextSync(path.join(specsRoot, capability, 'spec.md'));
    }
  } catch {}

  const title = firstHeading(proposal)
    || specRequirementTitle(spec)
    || firstHeading(design)
    || humanizeChangeId(changeId);
  const summary = collectSectionSummary(proposal, [/背景/, /原因/, /为什么/], 2)
    || collectSectionSummary(spec, [/新增需求/, /需求/], 2)
    || collectSectionSummary(design, [/目标/, /背景/], 3);

  return {
    title,
    summary,
    pendingTasks: pendingTaskTitles(root, changeId),
  };
}

function runOpenPrdContext(cwd, prompt = null) {
  const args = ['run', '.', '--context', '--json', '--hook-inject'];
  if (String(prompt || '').trim()) {
    args.push('--message', String(prompt).trim());
  }
  const json = runOpenPrd(args, cwd);
  if (json.stdout) {
    try {
      const parsed = JSON.parse(json.stdout);
      return {
        ok: true,
        commandOk: json.ok,
        status: json.status,
        parsed,
        stdout: renderRunContextText(parsed),
      };
    } catch {}
  }
  const fallbackArgs = ['run', '.', '--context'];
  if (String(prompt || '').trim()) {
    fallbackArgs.push('--message', String(prompt).trim());
  }
  const text = runOpenPrd(fallbackArgs, cwd);
  return {
    ok: text.ok,
    parsed: null,
    stdout: text.stdout,
  };
}

function knowledgeSkillContextLines(knowledgeSkills) {
  const matched = Array.isArray(knowledgeSkills?.matched) ? knowledgeSkills.matched : [];
  if (matched.length === 0) {
    return [];
  }
  const lines = [
    `项目级 Skill: 自动命中 ${matched.length} 个，并已加入当前上下文`,
  ];
  for (const skill of matched.slice(0, 3)) {
    lines.push(`- ${skill.skillName}: ${skill.matchSummary || '命中当前上下文'}`);
    if (skill.description) {
      lines.push(`  说明: ${skill.description}`);
    }
    if (Array.isArray(skill.touchedFiles) && skill.touchedFiles.length > 0) {
      lines.push(`  相关文件: ${skill.touchedFiles.slice(0, 4).join('；')}`);
    }
    if (skill.adoption) {
      lines.push(`  复用指标: 命中 ${skill.adoption.hitCount || 0} / 引用 ${skill.adoption.referencedCount || 0} / 注入 ${skill.adoption.injectedCount || 0}`);
    }
  }
  return lines;
}

function renderRunContextText(result) {
  const lines = [
    '当前进展参考',
    '当前项目: ' + result.projectRoot,
    '基础检查: ' + (result.validation?.valid ? '通过' : '失败'),
  ];
  if (result.activeRequirementGate) {
    const gateStatus = result.activeRequirementGate.status ?? 'active';
    const gateSuffix = result.activeRequirementGate.relevance === 'background' ? '（仅背景提醒）' : '';
    lines.push('当前处理阶段: ' + gateStatus + gateSuffix);
  }
  if (result.activeChange) {
    const label = result.recommendation?.type === 'requirement-intake' ? '历史聚焦事项' : '当前聚焦事项';
    lines.push(label + ': ' + result.activeChange);
  }
  if (result.lane?.summary) {
    lines.push('当前处理路径: ' + result.lane.summary);
  }
  if (result.taskSummary) {
    lines.push('后续任务进度: ' + result.taskSummary.completed + '/' + result.taskSummary.total + ' 完成，' + result.taskSummary.pending + ' 待处理，' + result.taskSummary.blocked + ' 阻塞');
    if (result.taskSummary.implementation) {
      lines.push('待落地任务: ' + result.taskSummary.implementation.completed + '/' + result.taskSummary.implementation.total + ' 完成，' + result.taskSummary.implementation.pending + ' 待处理');
    }
  }
  if (result.discovery) {
    lines.push('调研进度: ' + result.discovery.runId + ' 已覆盖 ' + result.discovery.summary.covered + '/' + result.discovery.summary.total + '，待处理 ' + result.discovery.summary.pending);
  }
  lines.push(...knowledgeSkillContextLines(result.knowledgeSkills));
  lines.push('对外表达: 面向用户时，请优先说“本次调整”“后续任务”“继续落地”“完成后检查”这类人话，不要直接复述内部编号、命令、路径、版本号或流程术语。');
  const recommendation = result.recommendation || {};
  lines.push('建议下一步: ' + recommendation.title);
  lines.push('这样安排的原因: ' + recommendation.reason);
  if (recommendation.preparationCommand || recommendation.executionCommand || recommendation.commitCommand) {
    lines.push('开始动手前提: 只有在用户明确要求继续落地、实现、修复、深挖或提交时，才继续往下做；如果还缺这一步，就先用人话说明范围和影响。');
  }
  const checklist = recommendation.executionConfirmationChecklist;
  if (checklist?.required) {
    lines.push((checklist.title || '开始动手前先确认这些') + ':');
    if (checklist.objective) {
      lines.push('- 这次要做什么: ' + checklist.objective);
    }
    if (checklist.scope?.length > 0) {
      lines.push('- 这次范围: ' + checklist.scope.join('；'));
    }
    if (checklist.implementationItems?.length > 0) {
      lines.push('- 我会这样推进: ' + checklist.implementationItems.join('；'));
    }
    if (checklist.outOfScope?.length > 0) {
      lines.push('- 这次先不做: ' + checklist.outOfScope.join('；'));
    }
    if (checklist.verification?.length > 0) {
      lines.push('- 完成后会检查: ' + checklist.verification.join('；'));
    }
    if (checklist.risks?.length > 0) {
      lines.push('- 需要提前知道: ' + checklist.risks.join('；'));
    }
    if (checklist.confirmationPrompt) {
      lines.push('- 如果要我现在继续: ' + checklist.confirmationPrompt);
    }
  }
  if (recommendation.preparationCommand) {
    lines.push('内部准备参考: ' + recommendation.preparationCommand);
  }
  if (recommendation.executionCommand) {
    lines.push('内部执行参考: ' + recommendation.executionCommand);
  }
  if (recommendation.commitCommand) {
    lines.push('内部提交参考: ' + recommendation.commitCommand);
  }
  if (recommendation.loop?.worktreeRecommended) {
    lines.push('环境建议: 最好放到单独环境里继续，避免和别的事项串线。');
  }
  lines.push('内部检查参考: ' + recommendation.verifyCommand);
  lines.push('内部状态参考: ' + (result.files?.runState || '.openprd/harness/run-state.json'));
  return lines.filter(Boolean).join('\n');
}

function analyzePromptIntent(prompt) {
  const text = String(prompt || '').trim();
  const normalized = text.toLowerCase();
  const continuationSessionId = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0] ?? null;
  const continuationTaskHandle = text.match(/\b[a-z0-9._-]+:T\d{3}\.\d{2}:[a-z0-9._-]+\b/i)?.[0] ?? null;
  const continuationWorkUnitId = text.match(/\bwu-[a-z0-9._-]+\b/i)?.[0] ?? null;
  const promptReviewCommand = parseReviewMarkCommand(text);
  const continuationVerbMatched = /(?:(?:继续|续做|接着做|继续执行|继续推进)(?:这个|这条|当前)?\s*(?:对话|任务|会话|记录|历史|Codex\s*任务)|(?:对话|任务|会话|记录|历史|Codex\s*任务).{0,6}(?:继续|续做|接着做|继续执行|继续推进)|^(?:继续|续做|接着做|继续执行|继续推进)\s*(?::|：))/i.test(text);
  const continuationRequest = continuationVerbMatched
    || Boolean(
      continuationTaskHandle
        || (continuationWorkUnitId && !promptReviewCommand)
    );
  const githubRepoPattern = /(?:https?:\/\/)?github\.com\/[^\s/]+\/[^\s/#?]+|(?:^|[\s(])[\w.-]+\/[\w.-]+(?=$|[\s)#?])/i;
  const internalOpenPrdExecution = /^#\s*OpenPrd\s+长程单任务执行会话/m.test(text)
    || /模式:\s*loop-run\b/i.test(text)
    || /模式:\s*loop-finish\b/i.test(text);
  // These signals only decide when to inject/open the requirement-intake lane.
  // The matcher should stay conservative: only likely L2 requests open the
  // heavy gate; L0/L1 stay lightweight unless the user expands the scope.
  const requirementRoutingSignalsStrong = [
    /新增/,
    /增加/,
    /新建/,
    /我希望/,
    /需求/,
    /模块/,
    /入口/,
    /流程/,
    /编排/,
    /一站式/,
    /信息架构/,
    /团队搭建/,
    /agent\s*市场/i,
    /skill\s*library/i,
    /UI/i,
    /cli\s*库/i,
    /workflow/i,
    /wizard/i,
  ];
  const requirementRoutingSignalsWeak = [
    /用户反馈/,
    /功能/,
    /页面/,
    /界面/,
    /视觉/,
    /体验/,
  ];
  const requirementChangeIntentSignals = [
    /新增/,
    /增加/,
    /新建/,
    /改(动|版|造|进|一下)?/,
    /优化/,
    /调整/,
    /重做/,
    /重构/,
    /放到/,
    /移到/,
    /移动到/,
    /切到/,
    /切换到/,
    /替换(成|为)?/,
    /串联/,
    /接入/,
    /实现/,
    /落地/,
  ];
  const tinyEditPatterns = [
    /加(一个|个)?空格/,
    /增加(一个|个)?空格/,
    /删(一个|个)?空格/,
    /去掉(一个|个)?空格/,
    /空格|标点|错别字|拼写|大小写/,
    /文案.{0,8}(改短|调整|替换)/,
    /按钮文案/,
    /typo/i,
    /spacing/i,
    /copy/i,
  ];
  const simpleConcretePatterns = [
    /按钮|文案|颜色|圆角|位置|间距|字号|图标|标题|空格|标点|label|copy/i,
    /从.+(改到|移到|移动到|换到|变成|改成|改为).+/,
  ];
  const l2StructuralScopePatterns = [
    /模块/,
    /入口/,
    /流程/,
    /导入流/,
    /编排/,
    /workflow/i,
    /wizard/i,
  ];
  const l2StrategicScopePatterns = [
    /一站式/,
    /团队搭建/,
    /agent\s*市场/i,
    /skill\s*library/i,
    /cli\s*库/i,
    /权限/,
    /审批/,
    /计费/,
    /账号/,
    /第三方/,
    /云服务/,
    /迁移/,
    /跨系统/,
    /(AI|模型).{0,8}(接入|集成|编排)/i,
  ];
  const structuralExpansionIntensityPatterns = [
    /串联/,
    /一站式/,
    /整体/,
    /全链路/,
    /端到端/,
    /体系/,
    /平台/,
    /多个/,
  ];
  const featurePlanningPatterns = [
    /需求/,
    /方案/,
    /规划/,
    /产品/,
  ];
  const capabilityCreationPatterns = [
    /新增/,
    /增加/,
    /新建/,
    /做(一个|个)?/,
    /支持/,
    /提供/,
    /搭建/,
    /引入/,
    /接入/,
    /集成/,
  ];
  const crossSystemRiskPatterns = [
    /支付|登录|注册|账号|权限|订单|回调|风控|退款|计费|同步|迁移|数据库|schema|协议|网关|跨系统|第三方|云服务|OSS|CDN|MCP|SDK|CLI/i,
  ];
  const l1OptimizationPatterns = [
    /(优化|调整|改版|重做|重构|增强|补齐|梳理|统一|整理)/,
  ];
  const l0AdjustmentPatterns = [
    /(修复|修一下|改一下|调一下|换成|改成|去掉|补一个|补一下)/,
  ];
  const explicitExecutionPatterns = [
    /直接(帮我|给我)?(改|做|实现|落地|修|修复|处理|解决)/,
    /如果.{0,24}(定位|确认|找到).{0,12}(原因|根因).{0,24}直接.{0,12}(帮我|给我)?(修|修复|改|处理|解决)/,
    /开始(改|做|实现|开发|落地)/,
    /继续(改|做|实现|开发|落地|修|修复|处理|解决)/,
    /请(直接)?(实现|落地|修改|修复|处理|解决)/,
    /可以(执行|落地|实现|开发)/,
    /去(改|做|实现|开发|落地|修|修复|处理|解决)吧/,
    /那你去(改|做|实现|开发|落地|修|修复|处理|解决)吧/,
  ];
  const implementationConfirmationPatterns = [
    /确认.*(执行|落地|实现|继续|开发|修复|修改|处理|解决|改)/,
    /按(这个|刚才|上面|已确认)?.{0,12}(方案|计划|拆解).{0,12}(执行|落地|实现|开发|修复|修改|处理|解决|改)/,
    /按.{0,12}(思路|方案|计划|拆解).{0,12}(来吧|来|走|做|执行|落地|实现|开发|修复|修改|处理|解决|改)/,
  ];
  const noReviewRequestedPatterns = [
    /不需要评审/,
    /不用评审/,
    /无需评审/,
    /不要评审/,
    /别再评审/,
  ];
  const noConfirmationRequestedPatterns = [
    /不需要(再)?确认/,
    /不用(再)?确认/,
    /无需(再)?确认/,
    /不要(再)?确认/,
    /别再确认/,
    /不需要再跟我确认/,
  ];
  const reviewContinuationPatterns = [
    /认可方案并继续/,
    /认可并继续/,
    /继续当前\s*openprd\s*下一步/i,
    /按当前\s*openprd\s*下一步继续/i,
  ];
  const reviewConfirmPatterns = [
    /认可方案/,
    /确认(?:当前|这个|这版|该)?(?:PRD|评审稿|评审页|review|需求稿|版本)/i,
    /(?:PRD|评审稿|评审页|review|需求稿|版本).{0,12}(确认|通过|没问题|认可|可以)/i,
    /按这版(?:PRD|评审|需求稿)/i,
  ];
  const reviewNeedsRevisionPatterns = [
    /(?:PRD|评审稿|评审页|review|需求稿|版本).{0,12}(需要调整|需要修改|要调整|要修改)/i,
  ];
  const readOnlyPatterns = [
    /看看/,
    /看下(一下)?/,
    /你看/,
    /规划/,
    /分析/,
    /先分析(一下)?/,
    /梳理/,
    /评估/,
    /怎么改/,
    /预计动哪些文件/,
    /看(看)?(一下)?(原因|问题|风险|情况)/,
    /什么原因/,
    /怎么看/,
    /你觉得/,
    /可行吗/,
    /有没有可能/,
    /会有什么问题/,
    /值不值得/,
    /review/i,
    /explain/i,
  ];
  const bugfixOrDiagnostic = /诊断包|报错|错误|异常|崩溃|bug|问题|排查|定位|根因|复现|日志|故障/i.test(text)
    || /失败.{0,20}(原因|根因|排查|定位|修|修复|处理|解决)|(?:原因|根因|排查|定位).{0,20}失败/.test(text);
  const tinyEdit = tinyEditPatterns.some((pattern) => pattern.test(text));
  const crossSystemRiskMatched = crossSystemRiskPatterns.some((pattern) => pattern.test(text));
  const localUiScopeMatched = /(按钮|文案|颜色|圆角|位置|间距|字号|图标|标题|空格|标点|label|copy|toast|placeholder|样式|页面|界面|布局|信息架构|导航|列表|详情页|设置页)/i.test(text);
  const reviewContinuationRequested = reviewContinuationPatterns.some((pattern) => pattern.test(text));
  const explicitExecution = internalOpenPrdExecution
    || continuationVerbMatched
    || reviewContinuationRequested
    || explicitExecutionPatterns.some((pattern) => pattern.test(text));
  const implementationConfirmation = reviewContinuationRequested
    || implementationConfirmationPatterns.some((pattern) => pattern.test(text));
  const noReviewRequested = noReviewRequestedPatterns.some((pattern) => pattern.test(text));
  const noConfirmationRequested = noConfirmationRequestedPatterns.some((pattern) => pattern.test(text));
  const reviewDecision = promptReviewCommand?.mark
    ?? (reviewConfirmPatterns.some((pattern) => pattern.test(text)) ? 'confirmed' : null)
    ?? (reviewNeedsRevisionPatterns.some((pattern) => pattern.test(text)) ? 'needs-revision' : null);
  const confirmation = implementationConfirmation || Boolean(reviewDecision);
  const readOnly = readOnlyPatterns.some((pattern) => pattern.test(text));
  const codeVisualArtifactRequested = /HTML|SVG|CSS|Canvas|代码稿|源码|source artifact|可编辑矢量|可编辑稿/i.test(text);
  const imageGenerationTerms = /图片|封面图|封面|配图|海报|插画|图标|贴纸|头像|banner|横幅|KV|主视觉|运营图|宣传图|商品图|背景图|壁纸|位图资产|效果图|视觉稿|mockup|样子|设计方向|设计预览/i;
  const imageGenerationAction = /生成|出一张|做一张|做个|做一个|画|绘制|设计|产出|给我|来一张|先看|确认|预览|看看|截图/i;
  const visualMockupRequest = imageGenerationTerms.test(text)
    && imageGenerationAction.test(text)
    && !codeVisualArtifactRequested;
  const largeUiChangeRequest = /(界面|页面|视觉|样式|UI|前端体验|布局|信息架构|主视觉|效果图|视觉稿|mockup|设计方向|设计预览)/i.test(text)
    && /(大|较大|比较大|明显|重做|重构|改版|优化|重新设计|设计方向|三种|3种|方案|效果图|先看样子|确认方向|体验优化|产品内)/i.test(text);
  const visualReview = /效果图|实现截图|视觉对比|视觉评审|对标效果图|复刻/i.test(text);
  const directBugfixExecution = explicitExecution && bugfixOrDiagnostic;
  const newFeatureVerbMatched = /(新增|增加|新建)/.test(text);
  const capabilityCreationMatched = capabilityCreationPatterns.some((pattern) => pattern.test(text));
  const featurePlanningMatched = featurePlanningPatterns.some((pattern) => pattern.test(text));
  const structuralL2ScopeMatchCount = l2StructuralScopePatterns.filter((pattern) => pattern.test(text)).length;
  const strategicL2ScopeMatched = l2StrategicScopePatterns.some((pattern) => pattern.test(text));
  const structuralExpansionMatched = structuralL2ScopeMatchCount >= 2
    || (structuralL2ScopeMatchCount >= 1
      && (structuralExpansionIntensityPatterns.some((pattern) => pattern.test(text)) || (capabilityCreationMatched && !localUiScopeMatched)));
  const l2ScopeMatched = strategicL2ScopeMatched || structuralExpansionMatched;
  const simpleConcrete = text.length <= 80
    && simpleConcretePatterns.some((pattern) => pattern.test(text))
    && !l2ScopeMatched;
  const requirementSignalMatched = requirementRoutingSignalsStrong.some((pattern) => pattern.test(text))
    || (requirementRoutingSignalsWeak.some((pattern) => pattern.test(text))
      && requirementChangeIntentSignals.some((pattern) => pattern.test(text)));
  const l2FeatureExpansionMatched = !localUiScopeMatched
    && (
      (capabilityCreationMatched && (strategicL2ScopeMatched || structuralExpansionMatched))
      || (newFeatureVerbMatched && text.length > 18)
    );
  const l2PlanningRequestMatched = !readOnly
    && featurePlanningMatched
    && requirementChangeIntentSignals.some((pattern) => pattern.test(text))
    && (strategicL2ScopeMatched || structuralExpansionMatched);
  const l1OptimizationMatched = l1OptimizationPatterns.some((pattern) => pattern.test(text))
    && /(页面|界面|视觉|样式|布局|信息架构|交互|体验|流程|入口|导航|表单|设置页|列表|详情页)/i.test(text);
  const l0AdjustmentMatched = l0AdjustmentPatterns.some((pattern) => pattern.test(text))
    && /(按钮|文案|颜色|圆角|位置|间距|字号|图标|标题|空格|标点|label|copy|toast|placeholder|样式|一处)/i.test(text);
  const publicRepoResearchRequest = githubRepoPattern.test(text)
    && /(github|仓库|repo|项目|参考|对标|复刻|review|学习|架构|模块|流程|构建|测试|扩展点)/i.test(text);
  const externalTechResearchRequest = /(第三方|library|framework|sdk|api|mcp|cli|依赖|包|版本|迁移|弃用|官方文档|参数|返回值|生命周期)/i.test(text)
    && /(怎么用|用法|配置|限制|版本|迁移|报错|集成|接入|最佳实践|示例|安装|参数|返回值|生命周期)/i.test(text);
  const skillWorkflowEditRequest = /SKILL\.md|AGENTS\.md/i.test(text)
    || (/(^|[^a-z])(skill|skills)([^a-z]|$)/i.test(text) && /(创建|修改|优化|重构|合并|拆分|更新|工作流|workflow|流程|路由|router|提示词|规则)/i.test(text))
    || (/AGENTS\.md/i.test(text) && /(创建|修改|优化|精简|收薄|重构|更新)/i.test(text));
  const secretsRequest = /(api\s*key|token|secret|credential|password|凭证|密钥|密码|账号信息|第三方服务凭证|个人信息|登录信息)/i.test(text);
  const weappMention = /(微信小程序|miniprogram|weapp|微信开发者工具|weapp-dev-mcp)/i.test(text);
  const weappValidationAction = /(测试|验证|实测|复现|截图|日志|抓日志|抓包|网络请求|network|运行态|开发者工具自动化|从\s*0\s*到\s*1|冷启动|重开|重新打开|全流程)/i.test(text);
  const weappValidationRequest = /weapp-dev-mcp/i.test(text)
    || (weappMention && weappValidationAction);
  const browserSafetyRequest = /(computer use|browser use|浏览器|browser|网页|页面|窗口|标签页|tab|profile)/i.test(text)
    && /(点击|输入|提交|登录|注销|退出|支付|关闭|send|submit|type|click|switch account|切换账号)/i.test(text);
  const productCopyRequest = /(文案|copy|错误文案|空状态|成功提示|按钮文案|提示语|toast|placeholder|设置项文案|国际化|i18n|locales|translations|localizable)/i.test(text);
  const l2RequirementCandidate = (bugfixOrDiagnostic && crossSystemRiskMatched)
    || l2FeatureExpansionMatched
    || l2PlanningRequestMatched;
  const requirementTier = !internalOpenPrdExecution
    ? (l2RequirementCandidate
        && !tinyEdit
        && !simpleConcrete
        && !visualMockupRequest
        && !(readOnly && !explicitExecution)
      ? 'l2'
      : (!visualMockupRequest
          && (!readOnly || explicitExecution)
          && (tinyEdit
            || simpleConcrete
            || l0AdjustmentMatched
            || (directBugfixExecution && !crossSystemRiskMatched)
            || (bugfixOrDiagnostic && !crossSystemRiskMatched))
        ? 'l0'
        : (!visualMockupRequest
            && !readOnly
            && (largeUiChangeRequest || l1OptimizationMatched || requirementSignalMatched)
          ? 'l1'
          : null)))
    : null;
  const requiresIntake = requirementTier === 'l2';
  return {
    promptText: text,
    requirementTier,
    requiresIntake,
    explicitExecution,
    confirmation,
    implementationConfirmation,
    noReviewRequested,
    noConfirmationRequested,
    reviewDecision,
    reviewCommand: promptReviewCommand,
    reviewContinuationRequested,
    readOnly,
    simpleConcrete,
    visualMockupRequest,
    largeUiChangeRequest,
    continuationRequest,
    continuationSessionId,
    continuationTaskHandle,
    continuationWorkUnitId,
    publicRepoResearchRequest,
    externalTechResearchRequest,
    skillWorkflowEditRequest,
    secretsRequest,
    weappValidationRequest,
    browserSafetyRequest,
    productCopyRequest,
    shouldInject: requiresIntake
      || requirementTier === 'l1'
      || explicitExecution
      || confirmation
      || readOnly
      || visualMockupRequest
      || largeUiChangeRequest
      || continuationRequest
      || visualReview
      || publicRepoResearchRequest
      || externalTechResearchRequest
      || skillWorkflowEditRequest
      || secretsRequest
      || weappValidationRequest
      || browserSafetyRequest
      || productCopyRequest
      || /openprd/i.test(normalized)
      || /\bprd\b/i.test(normalized),
  };
}

function isShortAffirmativeConfirmation(prompt) {
  const text = stripMarkdown(prompt).trim();
  return /^(可以|好|行|确认|没问题|OK|ok|yes|Yes|yep|Yep)[。！!,.，s]*$/.test(text);
}

function detectRequirementIntakeMode(prompt) {
  const text = String(prompt || '');
  const deep = text.length >= 80
    || /新增|新建|模块|流程|编排|一站式|信息架构|工作流|workflow|wizard/i.test(text)
    || /多角色|权限|审批|协作|团队|客户|后台|管理/.test(text)
    || /AI|agent|模型|生成|自动化|集成|第三方/i.test(text)
    || /体验|优化|提升|更好|智能|自动|高效|完整|体系|平台/.test(text);
  return deep ? 'deep-reflection' : 'focused-reflection';
}

function readRequirementGate(root, sessionId = null) {
  return readJsonSync(requirementGatePath(root, sessionId), null);
}

function writeRequirementGate(root, value, sessionId = null) {
  const next = sessionId ? { ...value, sessionId } : value;
  writeJsonSync(requirementGatePath(root, sessionId), next);
  if (sessionId) {
    writeJsonSync(legacyRequirementGatePath(root), next);
    writeSessionBinding(root, sessionId, {
      promptPreview: next.promptPreview ?? null,
      gateStatus: next.status ?? null,
      gateActive: Boolean(next.active),
    });
  }
}

function mirrorRequirementGate(root, sessionId) {
  if (!sessionId) return null;
  const gate = readRequirementGate(root, sessionId);
  if (gate) {
    writeJsonSync(legacyRequirementGatePath(root), gate);
  }
  return gate;
}

function openRequirementGate(root, prompt, intent, sessionId = null) {
  const current = readRequirementGate(root, sessionId);
  const approvalPolicy = resolveRequirementApprovalPolicy(prompt, intent);
  const gate = {
    version: 1,
    active: true,
    status: 'requires-clarification',
    openedAt: current?.openedAt || now(),
    updatedAt: now(),
    promptPreview: preview(prompt, 500),
    reason: 'likely-l2 requirement flow',
    requiredFlow: ['requirement-intake', 'clarify', 'capture', 'synthesize', 'review', 'change-generate', 'tasks', 'implementation'],
    intakeMode: detectRequirementIntakeMode(prompt),
    intent,
    executionIntent: {
      explicitRequested: Boolean(intent?.explicitExecution),
      suppressExtraConfirmation: approvalPolicy.suppressExtraConfirmation,
      source: approvalPolicy.suppressExtraConfirmation ? 'user-opt-out' : 'default',
      latchedAt: now(),
    },
    approvalPolicy,
    reviewActionAuthorization: null,
  };
  writeRequirementGate(root, gate, sessionId);
  return gate;
}

function confirmRequirementGate(root, prompt, sessionId = null) {
  const current = readRequirementGate(root, sessionId);
  if (!current?.active) {
    return current;
  }
  const next = {
    ...current,
    active: false,
    status: 'user-confirmed-for-execution',
    confirmedAt: now(),
    confirmationPreview: preview(prompt, 500),
    reviewActionAuthorization: null,
  };
  writeRequirementGate(root, next, sessionId);
  return next;
}

function authorizeRequirementGateExecution(root, prompt, sessionId = null, options = {}) {
  const current = readRequirementGate(root, sessionId);
  if (!current?.active) {
    return current;
  }
  const next = {
    ...current,
    active: false,
    status: options.status ?? 'execution-authorized',
    confirmedAt: now(),
    confirmationPreview: preview(prompt || current.promptPreview || '', 500),
    authorizationReason: options.reason ?? null,
    reviewActionAuthorization: null,
  };
  writeRequirementGate(root, next, sessionId);
  return next;
}

function updateRequirementGate(root, patch, sessionId = null) {
  const current = readRequirementGate(root, sessionId);
  if (!current?.active) {
    return current;
  }
  const next = {
    ...current,
    active: true,
    updatedAt: now(),
    ...patch,
  };
  writeRequirementGate(root, next, sessionId);
  return next;
}

function openResearchGate(root, prompt, intent, sessionId = null) {
  const kind = intent?.publicRepoResearchRequest ? 'deepwiki' : 'context7';
  return writeNamedGate(root, 'research', {
    version: 1,
    active: true,
    kind,
    status: kind === 'deepwiki' ? 'needs-deepwiki-evidence' : 'needs-context7-evidence',
    openedAt: now(),
    updatedAt: now(),
    promptPreview: preview(prompt, 500),
    localEvidenceSeen: false,
    externalEvidence: {
      readWikiStructure: false,
      askQuestion: false,
      resolveLibraryId: false,
      queryDocs: false,
    },
  }, sessionId);
}

function closeResearchGate(root, sessionId = null, patch = {}) {
  const current = readNamedGate(root, 'research', sessionId);
  if (!current) {
    return null;
  }
  return writeNamedGate(root, 'research', {
    ...current,
    active: false,
    status: patch.status || 'closed',
    closedAt: patch.closedAt || now(),
    ...patch,
  }, sessionId);
}

function openSkillVisualizationGate(root, prompt, sessionId = null) {
  return writeNamedGate(root, 'skill-visualization', {
    version: 1,
    active: true,
    status: 'needs-visual-confirmation',
    openedAt: now(),
    updatedAt: now(),
    promptPreview: preview(prompt, 500),
  }, sessionId);
}

function confirmSkillVisualizationGate(root, prompt, sessionId = null) {
  const current = readNamedGate(root, 'skill-visualization', sessionId);
  if (!current) {
    return null;
  }
  return writeNamedGate(root, 'skill-visualization', {
    ...current,
    active: false,
    status: 'user-confirmed-after-visualization',
    confirmedAt: now(),
    confirmationPreview: preview(prompt, 500),
  }, sessionId);
}

function closeSkillVisualizationGate(root, sessionId = null, patch = {}) {
  const current = readNamedGate(root, 'skill-visualization', sessionId);
  if (!current) {
    return null;
  }
  return writeNamedGate(root, 'skill-visualization', {
    ...current,
    active: false,
    status: patch.status || 'closed',
    closedAt: patch.closedAt || now(),
    ...patch,
  }, sessionId);
}

function openWeappGate(root, prompt, sessionId = null) {
  return writeNamedGate(root, 'weapp', {
    version: 1,
    active: true,
    status: 'needs-weapp-runtime-validation',
    openedAt: now(),
    updatedAt: now(),
    promptPreview: preview(prompt, 500),
    validationSignals: {
      ensureConnection: false,
      runtimeAction: false,
    },
  }, sessionId);
}

function closeWeappGate(root, sessionId = null, patch = {}) {
  const current = readNamedGate(root, 'weapp', sessionId);
  if (!current) {
    return null;
  }
  return writeNamedGate(root, 'weapp', {
    ...current,
    active: false,
    status: patch.status || 'validated',
    closedAt: patch.closedAt || now(),
    ...patch,
  }, sessionId);
}

function evaluateRequirementGateProgress(root, sessionId = null) {
  const gate = readRequirementGate(root, sessionId);
  const binding = readSessionBinding(root, sessionId);
  const promptPreview = gate?.promptPreview ?? binding?.promptPreview ?? null;
  const run = runOpenPrdContext(root, promptPreview);
  const parsed = run.parsed ?? {};
  const review = readRequirementLaneReview(root, sessionId);
  const targetedFocusChangeId = parsed?.lane?.kind === 'targeted'
    ? (parsed.focus?.changeId ?? null)
    : null;
  const activeChange = binding?.changeId
    ?? (sessionId
      ? (targetedFocusChangeId ?? null)
      : (targetedFocusChangeId ?? parsed.focus?.changeId ?? parsed.activeChange ?? null));
  const taskSummary = activeChange ? readLocalTaskSummary(root, activeChange) : null;
  const hasTaskBreakdown = Boolean(activeChange && Number(taskSummary?.total ?? 0) > 0);
  const approvalPolicy = requirementApprovalPolicy(gate);
  const clarificationConfirmed = requirementWritePathExplicitlyAuthorized(gate);
  let nextStep = 'implementation-ready';
  let reason = '这版需求和后续任务都已经准备好了；如果用户原本就明确要继续做，就直接往下推进，否则再补一句清楚的人话授权。';
  if (!review.versionId) {
    nextStep = clarificationConfirmed ? 'prd-synthesis-required' : 'clarification-confirmation-required';
    reason = clarificationConfirmed
      ? (
          reviewPolicyAllowsSilentRecord(approvalPolicy)
            ? '用户已明确表示不需要再停下来确认，本轮可以直接整理需求事实、生成这版确认稿，并继续后面的整理步骤。'
            : '当前需求摘要已经确认，下一步把已确认内容整理成可确认的需求稿。'
        )
      : '当前还缺需求摘要确认。先在对话里按“需求判断 / 需求理解 / 功能范围 / 技术方案”整理结构化摘要，其中“功能范围”和“技术方案”优先用 Markdown 表格；用户没确认前，不要直接把核心需求写成既定事实。';
  } else if (review.status === 'needs-revision') {
    nextStep = 'prd-review-required';
    reason = '当前这版需求确认稿已经被标记为需要调整，先改完再继续后面的整理或实现。';
  } else if (review.status !== 'confirmed') {
    nextStep = reviewPolicyAllowsSilentRecord(approvalPolicy)
      ? 'review-recording-required'
      : 'prd-review-required';
    reason = reviewPolicyAllowsSilentRecord(approvalPolicy)
      ? '这版需求确认稿已经生成。由于用户已经明确表示不需要再停下来确认，本轮可以直接记录这次确认结果，再继续整理本次调整和后续任务。'
      : '这版需求确认稿还没有得到用户认可，不能把“请帮我实现/继续实现”当成已经确认这版内容。';
  } else if (!activeChange) {
    nextStep = 'change-generation-required';
    reason = '这版需求已经确认，下一步先整理本次调整范围。';
  } else if (!hasTaskBreakdown) {
    nextStep = 'task-breakdown-required';
    reason = '本次调整范围已经立起来了，但还没拆成可直接执行的后续任务。';
  }
  return {
    runContext: parsed,
    binding,
    review,
    activeChange,
    taskSummary,
    recommendation: parsed.recommendation ?? null,
    hasTaskBreakdown,
    approvalPolicy,
    nextStep,
    reason,
  };
}

function reviewActionAuthorizationFor(intent, progress, prompt) {
  const review = progress?.review ?? null;
  const requested = intent?.reviewCommand ?? null;
  const mark = requested?.mark ?? intent?.reviewDecision ?? null;
  if (!mark || !review?.versionId || !review?.digest || !review?.workUnitId) {
    return null;
  }
  if (requested && !reviewCommandMatchesReview(requested, review)) {
    return null;
  }
  return {
    mark,
    versionId: review.versionId,
    digest: review.digest,
    workUnitId: review.workUnitId,
    continueAfterReview: Boolean(
      intent?.reviewContinuationRequested
        || intent?.implementationConfirmation
        || intent?.explicitExecution
    ),
    promptPreview: preview(prompt, 500),
    grantedAt: now(),
    source: 'explicit-user-review-decision',
  };
}

function silentReviewActionAuthorizationFor(gate, progress, prompt) {
  const policy = requirementApprovalPolicy(gate);
  const review = progress?.review ?? null;
  if (!reviewPolicyAllowsSilentRecord(policy) || !review?.versionId || !review?.digest || !review?.workUnitId) {
    return null;
  }
  if (review.status === 'needs-revision') {
    return null;
  }
  return {
    mark: 'confirmed',
    versionId: review.versionId,
    digest: review.digest,
    workUnitId: review.workUnitId,
    promptPreview: preview(prompt || gate?.promptPreview || '', 500),
    grantedAt: now(),
    source: 'silent-record-policy',
  };
}

function holdRequirementGate(root, prompt, progress, sessionId = null, extra = {}) {
  const reviewActionAuthorization = extra.reviewActionAuthorization ?? null;
  const patch = {
    status: extra.status ?? progress.nextStep,
    confirmationPreview: preview(prompt, 500),
    reviewActionAuthorization,
  };
  if (extra.clarificationConfirmedAt) {
    patch.clarificationConfirmedAt = extra.clarificationConfirmedAt;
    patch.clarificationConfirmationPreview = extra.clarificationConfirmationPreview ?? preview(prompt, 500);
  }
  return updateRequirementGate(root, patch, sessionId);
}

function isImplementationAdvanceIntent(intent) {
  return Boolean(intent?.explicitExecution || intent?.implementationConfirmation);
}

function gateHasConfirmedCurrentReview(gate, progress) {
  const authorization = gate?.reviewActionAuthorization;
  const review = progress?.review;
  if (review?.status !== 'confirmed') {
    return false;
  }
  if (authorization) {
    return Boolean(
      authorization.versionId === review.versionId
        && authorization.digest === review.digest
        && authorization.workUnitId === review.workUnitId
    );
  }
  return reviewPolicyAllowsSilentRecord(requirementApprovalPolicy(gate))
    && Boolean(review.versionId && review.digest && review.workUnitId);
}

function canAutoAuthorizeRequirementExecution(gate, progress) {
  return Boolean(
    isBlockingRequirementGate(gate)
      && gate?.intent?.explicitExecution
      && progress?.nextStep === 'implementation-ready'
      && gateHasConfirmedCurrentReview(gate, progress)
  );
}

function isAuthorizedReviewMarkCommand(payload, gate) {
  const authorization = gate?.reviewActionAuthorization;
  const command = parseReviewMarkCommand(commandText(payload));
  if (!authorization || !command) {
    return false;
  }
  return authorization.mark === command.mark
    && authorization.versionId === command.versionId
    && authorization.digest === command.digest
    && authorization.workUnitId === command.workUnitId;
}

function isSilentRecordReviewMarkCommand(payload, gate, progress) {
  const authorization = silentReviewActionAuthorizationFor(gate, progress, gate?.promptPreview || '');
  const command = parseReviewMarkCommand(commandText(payload));
  if (!authorization || !command) {
    return false;
  }
  return authorization.mark === command.mark
    && authorization.versionId === command.versionId
    && authorization.digest === command.digest
    && authorization.workUnitId === command.workUnitId;
}

function isReadOnlyRequirementGate(gate) {
  return Boolean(gate?.active && gate?.intent?.readOnly && !gate?.intent?.explicitExecution);
}

function isBlockingRequirementGate(gate) {
  return Boolean(gate?.active && !isReadOnlyRequirementGate(gate));
}

function isRequirementGateActive(root, sessionId = null) {
  return isBlockingRequirementGate(readRequirementGate(root, sessionId));
}

function isMutationPayload(payload, risk) {
  const text = payloadText(payload);
  const tool = String(payload.tool_name || payload.toolName || payload.name || '');
  return risk.level === 'medium'
    || risk.level === 'high'
    || /apply_patch/i.test(tool)
    || /apply_patch/i.test(text)
    || /\*\*\* Begin Patch/.test(text);
}

function captureSourceFromCommand(command) {
  return readCliFlagValue(command, '--source');
}

function isNonSemanticCaptureCommand(command) {
  return /openprd\s+capture\b/i.test(command)
    && captureSourceFromCommand(command) === 'agent-normalized';
}

function gateHasClarificationConfirmation(gate) {
  return Boolean(gate?.clarificationConfirmedAt || gate?.status === 'clarification-confirmed');
}

function requirementWritePathExplicitlyAuthorized(gate) {
  return gateHasClarificationConfirmation(gate)
    || reviewPolicyAllowsSilentRecord(requirementApprovalPolicy(gate));
}

function isRequirementWritePathMutation(command) {
  return /openprd\s+(capture|classify|synthesize|diagram)\b/i.test(command);
}

function isAllowedDuringRequirementGate(root, payload, gate, sessionId = null) {
  const text = payloadText(payload);
  const command = commandText(payload);
  const progress = evaluateRequirementGateProgress(root, sessionId);
  const alwaysAllowed = [
    /openprd\s+status\b/i,
    /openprd\s+next\b/i,
    /openprd\s+run\s+\.\s+--context\b/i,
    /openprd\s+run\s+\.\s+--verify\b/i,
    /openprd\s+clarify\b/i,
    /openprd\s+interview\b/i,
    /openprd\s+standards\s+.*--verify/i,
    /openprd\s+quality\s+.*--verify/i,
    /openprd\s+doctor\b/i,
  ];
  if (alwaysAllowed.some((pattern) => pattern.test(text))) {
    return true;
  }
  if (/openprd\s+capture\b/i.test(command)) {
    return isNonSemanticCaptureCommand(command) || requirementWritePathExplicitlyAuthorized(gate);
  }
  if (/openprd\s+(classify|synthesize|diagram)\b/i.test(command)) {
    return requirementWritePathExplicitlyAuthorized(gate);
  }
  if (/openprd\s+review-presentation\b/i.test(command)) {
    return /--template\b/i.test(command) || Boolean(progress.review.versionId);
  }
  if (/openprd\s+review\b/i.test(command)) {
    if (!/--mark\b/i.test(command)) {
      return true;
    }
    return isAuthorizedReviewMarkCommand(payload, gate)
      || isSilentRecordReviewMarkCommand(payload, gate, progress);
  }
  if (/openprd\s+change\s+.*--generate/i.test(command)) {
    return progress.review.status === 'confirmed';
  }
  if (/openprd\s+change\s+.*--validate/i.test(command)) {
    return true;
  }
  if (/openprd\s+tasks\b/i.test(command) || /openprd\s+loop\s+.*--plan/i.test(command)) {
    return progress.review.status === 'confirmed' && Boolean(progress.activeChange);
  }
  return false;
}

function toolProbe(payload) {
  return `${toolName(payload)}\n${payloadText(payload)}\n${commandText(payload)}`.toLowerCase();
}

function looksLikeLocalEvidenceRead(payload) {
  const probe = toolProbe(payload);
  return /\b(rg|grep|cat|sed|head|tail|less|more|wc|ls|find|git show|read_file|open_file|view_file)\b/.test(probe)
    || /openprd\s+(status|next|doctor|run\s+\.\s+--context|run\s+\.\s+--verify)/.test(probe);
}

function applyResearchToolSignal(root, payload, sessionId = null) {
  const current = readNamedGate(root, 'research', sessionId);
  if (!current?.active) {
    return current;
  }
  const probe = toolProbe(payload);
  const externalEvidence = { ...(current.externalEvidence || {}) };
  if (looksLikeLocalEvidenceRead(payload)) {
    current.localEvidenceSeen = true;
  }
  if (/read[_-]?wiki[_-]?structure|readwikistructure/.test(probe)) {
    externalEvidence.readWikiStructure = true;
  }
  if (/ask[_-]?question|askquestion/.test(probe)) {
    externalEvidence.askQuestion = true;
  }
  if (/resolve[_-]?library[_-]?id|resolvelibraryid/.test(probe)) {
    externalEvidence.resolveLibraryId = true;
  }
  if (/query[_-]?docs|querydocs/.test(probe)) {
    externalEvidence.queryDocs = true;
  }
  const satisfied = current.kind === 'deepwiki'
    ? externalEvidence.readWikiStructure && externalEvidence.askQuestion
    : externalEvidence.resolveLibraryId && externalEvidence.queryDocs;
  if (satisfied) {
    return closeResearchGate(root, sessionId, {
      status: 'evidence-collected',
      externalEvidence,
      localEvidenceSeen: current.localEvidenceSeen,
      satisfiedAt: now(),
    });
  }
  return updateNamedGate(root, 'research', {
    externalEvidence,
    localEvidenceSeen: current.localEvidenceSeen,
  }, sessionId);
}

function looksLikeSkillContractMutation(root, payload) {
  const files = extractTouchedFiles(root, payload);
  if (files.some((file) => /(^|\/)(AGENTS\.md|SKILL\.md)$/i.test(file) || /(^|\/)skills\/.+/i.test(file))) {
    return true;
  }
  const probe = toolProbe(payload);
  return /AGENTS\.md|SKILL\.md|\/skills\//i.test(probe);
}

function isRawVaultReadAttempt(payload) {
  const probe = toolProbe(payload);
  const readLike = /\b(cat|sed|head|tail|less|more|rg|grep|read_file|open_file)\b/.test(probe);
  return readLike && /\bvault\b/.test(probe);
}

function applyWeappToolSignal(root, payload, sessionId = null) {
  const current = readNamedGate(root, 'weapp', sessionId);
  if (!current?.active) {
    return current;
  }
  const probe = toolProbe(payload);
  const validationSignals = { ...(current.validationSignals || {}) };
  if (/mp[_-]?ensureconnection|ensureconnection/.test(probe)) {
    validationSignals.ensureConnection = true;
  }
  if (/mp[_-]|weapp|miniprogram|page_|element_|mp_screenshot|network\b|evaluate\b/.test(probe)) {
    validationSignals.runtimeAction = true;
  }
  const satisfied = validationSignals.ensureConnection && validationSignals.runtimeAction;
  if (satisfied) {
    return closeWeappGate(root, sessionId, {
      status: 'validated-through-weapp-runtime-evidence',
      validationSignals,
      validatedAt: now(),
    });
  }
  return updateNamedGate(root, 'weapp', { validationSignals }, sessionId);
}

function isHighRiskBrowserAction(payload) {
  const probe = toolProbe(payload);
  const browserTool = /(computer|browser|chrome|playwright)/.test(probe);
  const dangerousAction = /(submit|send|delete|remove|logout|sign out|switch account|pay|purchase|close tab|close window|关闭标签页|关闭窗口|退出登录|切换账号|支付|删除|发送|提交)/.test(probe);
  return browserTool && dangerousAction;
}

function researchGateMessage(gate) {
  if (!gate?.active) {
    return null;
  }
  if (gate.kind === 'deepwiki') {
    return [
      'OpenPrd 外部仓库调研门禁: active。',
      '当前请求涉及公开 GitHub 仓库的架构、模块、流程或对标判断；在修改实现或把结论表述为已确认之前，先读本地证据，再使用 DeepWiki。',
      '最小动作: `read_wiki_structure` 一次，再用 `ask_question` 聚焦 1-2 个关键问题；证据够用后立即停止扩展。',
      gate.externalEvidence?.readWikiStructure ? '已记录: read_wiki_structure。' : '缺少: read_wiki_structure。',
      gate.externalEvidence?.askQuestion ? '已记录: ask_question。' : '缺少: ask_question。',
    ].join('\n');
  }
  return [
    'OpenPrd 外部技术调研门禁: active。',
    '当前请求涉及项目外技术事实、第三方库、框架、API、SDK、MCP 或 CLI 用法；在修改实现或输出配置/代码结论前，先检查本地代码、锁文件、README、类型定义是否足够，不足时再使用 Context7。',
    '最小动作: `resolve_library_id` 一次，再 `query_docs` 1-2 次；若覆盖不足，明确缺口后再补官方文档或源码。',
    gate.externalEvidence?.resolveLibraryId ? '已记录: resolve_library_id。' : '缺少: resolve_library_id。',
    gate.externalEvidence?.queryDocs ? '已记录: query_docs。' : '缺少: query_docs。',
  ].join('\n');
}

function skillVisualizationGateMessage(gate) {
  if (!gate?.active) {
    return null;
  }
  return [
    'OpenPrd skill/AGENTS 可视化确认门禁: active。',
    '当前请求涉及 skill、SKILL.md、AGENTS.md 或相关 workflow 规则变更。编辑前必须先读取现状，输出彩色 Mermaid 方案图，再用简短文字说明新增、修改、保持不变和删除/阻断项。',
    'Mermaid 必须包含 `unchanged`、`added`、`changed`、`removed` 四种 classDef，并等待用户明确确认后才能修改相关文件。',
  ].join('\n');
}

function credentialMessage(intent) {
  if (!intent?.secretsRequest) {
    return null;
  }
  return [
    'OpenPrd 敏感信息规则:',
    '如果任务需要 API key、token、账号信息、第三方服务凭证或个人信息，先使用 `secrets-vault` skill 获取已有凭证，不要立即向用户索要。',
    '不要直接读取原始 vault 文件，也不要在日志、代码或回复里暴露完整密钥。',
  ].join('\n');
}

function weappGateMessage(gate) {
  if (!gate?.active) {
    return null;
  }
  return [
    'OpenPrd 微信小程序验证门禁: active。',
    '只有当用户明确要求小程序实测、复现、截图、抓日志/网络、从 0 到 1 走流程，或当前改动高风险到必须依赖运行态证据时，才升级到本地小程序运行态验证。',
    '一旦进入小程序运行态验证，默认沿用当前小程序运行态或开发者工具会话连续验证，不要为了验证自动重开应用；只有用户明确要求从 0 到 1、冷启动、重开或重新打开时，才从头启动。',
    '优先使用当前环境已配置的小程序本地验证能力；如果当前客户端没有相应工具，不要假定已经安装，也不要把缺少工具本身当成任务失败。',
    '未拿到本地运行态证据前，不要宣称“小程序已验证”。',
  ].join('\n');
}

function browserSafetyMessage(intent) {
  if (!intent?.browserSafetyRequest) {
    return null;
  }
  return [
    'OpenPrd 浏览器安全提醒:',
    '用户明确要求 Computer Use 时，优先使用 Computer Use，并尽量在 Codex-owned browser window 中操作。',
    '执行点击、输入、提交、关闭、切换账号、退出登录、支付等高风险动作前，先确认窗口归属，检查当前窗口标题、目标页面和可见内容仍属于本任务。',
  ].join('\n');
}

function productCopyMessage(intent) {
  if (!intent?.productCopyRequest) {
    return null;
  }
  return [
    'OpenPrd 产品内文案提醒:',
    '先检查项目是否已有 i18n、locales、translations、Localizable 或其他语言资源；若已有，多语言要同步维护。',
    '用户可见文案默认面向普通用户，优先写结果和下一步，不要把 API、SDK、模型、数据库、缓存、错误码或其他实现细节直接暴露给用户。',
  ].join('\n');
}

function composeHookContext(root, intent = null, gate = null, progress = null, sessionId = null) {
  return [
    contextMessage(root, intent, gate, progress),
    researchGateMessage(readNamedGate(root, 'research', sessionId)),
    skillVisualizationGateMessage(readNamedGate(root, 'skill-visualization', sessionId)),
    credentialMessage(intent),
    weappGateMessage(readNamedGate(root, 'weapp', sessionId)),
    browserSafetyMessage(intent),
    productCopyMessage(intent),
    largeUiVisualDirectionMessage(intent),
  ].filter(Boolean).join('\n');
}

function runOpenPrd(args, cwd) {
  const configuredCommand = String(process.env.OPENPRD_CLI || 'openprd').trim() || 'openprd';
  const jsEntry = /\.(?:c|m)?js$/i.test(configuredCommand);
  let command = configuredCommand;
  let commandArgs = args;
  if (jsEntry) {
    const candidates = [];
    const addCollapsedPackageCandidate = (candidatePath) => {
      if (!candidatePath) {
        return;
      }
      const normalized = path.resolve(candidatePath);
      const binDir = path.dirname(normalized);
      const packageDir = path.dirname(binDir);
      const packageName = path.basename(packageDir);
      if (path.basename(binDir) === 'bin' && packageName === 'openprd') {
        candidates.push(path.join(path.dirname(packageDir), 'bin', 'openprd.js'));
      }
    };
    if (path.isAbsolute(configuredCommand)) {
      candidates.push(configuredCommand);
      addCollapsedPackageCandidate(configuredCommand);
    } else {
      candidates.push(path.resolve(cwd, configuredCommand));
      candidates.push(path.resolve(configuredCommand));
      addCollapsedPackageCandidate(path.resolve(cwd, configuredCommand));
      addCollapsedPackageCandidate(path.resolve(configuredCommand));
    }
    candidates.push(path.join(cwd, 'bin', 'openprd.js'));
    const resolvedEntry = candidates.find((candidate) => candidate && fs.existsSync(candidate));
    command = process.execPath;
    commandArgs = [resolvedEntry || configuredCommand, ...args];
  }
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
    env: process.env,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function parseJsonOutput(text) {
  const source = String(text || '').trim();
  if (!source) {
    return null;
  }
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function devCheckWrapUpMessage(root, turnState) {
  const files = Array.isArray(turnState?.touchedFiles)
    ? [...new Set(turnState.touchedFiles)].filter(Boolean)
    : [];
  if (files.length === 0) {
    return null;
  }
  const result = runOpenPrd(['dev-check', '.', ...files, '--json'], root);
  if (!result.ok && !result.stdout) {
    return [
      'OpenPrd 收工回顾：本轮有 touched code files，但 dev-check 未能完成。',
      '最终回复里请说明无法生成大文件审查表，并列出失败原因。',
      result.stderr ? `错误: ${result.stderr}` : null,
    ].filter(Boolean).join('\n');
  }
  const parsed = parseJsonOutput(result.stdout);
  if (!parsed?.wrapUp?.required || !parsed.wrapUp.markdownTable) {
    return null;
  }
  return [
    'OpenPrd 后续建议：本轮有改动对象需要主动说明。',
    '最终回复必须直接复用下面的 Markdown 表格，按 🔴 → 🟠 → 🟡 的顺序帮助产品或业务理解影响对象、本次处理结果和后续建议；不要只用工具名或一段话带过。',
    '如果你改写了“预警原因 / 本次处理结果 / 后续建议”，先用 `node scripts/dev-check-wrapup-copy.mjs --validate` 校验每格不超过 20 字；若报错，按提示缩短后重试。',
    '不要把“关注程度”列改写成纯 emoji；必须保留例如“🟠 中风险｜建议优先关注”这类完整标签。',
    parsed.wrapUp.markdownBlock ?? parsed.wrapUp.markdownTable,
  ].join('\n');
}

function shouldRunDoctorForHighRisk(payload) {
  const text = commandText(payload) || payloadText(payload);
  return /(git\s+(commit|push)\b|npm\s+publish|pnpm\s+publish|yarn\s+npm\s+publish|gh\s+release|openprd\s+(freeze|handoff|setup|update|fleet|doctor)\b|openprd\s+change\s+.*--(apply|archive)\b|release|publish)/i.test(text);
}

function summarizeRunVerifyCheck(parsed, fallbackText = '') {
  if (!parsed) {
    return fallbackText || 'run verify result unavailable';
  }
  const readiness = parsed.readiness ?? {};
  const failedTaskChecks = Array.isArray(parsed.checks)
    ? parsed.checks.filter((check) => check.scope !== 'workspace' && !check.ok).map((check) => check.name)
    : [];
  const workspaceWarnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
  if (readiness.taskReady === false) {
    return `run-verify: taskReady=no${failedTaskChecks.length ? ` (${failedTaskChecks.join(', ')})` : ''}`;
  }
  if (readiness.workspaceReady === false) {
    const workspaceDetail = parsed.workspaceAttention?.summary ?? workspaceWarnings[0] ?? null;
    return `run-verify: taskReady=yes, workspaceReady=no${workspaceDetail ? ` (${workspaceDetail})` : ''}`;
  }
  return 'run-verify: taskReady=yes, workspaceReady=yes';
}

function summarizeDoctorCheck(parsed, fallbackText = '') {
  if (!parsed?.agentIntegration && !parsed?.standards && !parsed?.validation) {
    return fallbackText || 'doctor result unavailable';
  }
  const parts = [];
  if (parsed.agentIntegration) {
    parts.push(`agentIntegration=${parsed.agentIntegration.ok ? 'ok' : 'failed'}`);
  }
  if (parsed.standards) {
    parts.push(`standards=${parsed.standards.ok ? 'ok' : 'failed'}`);
  }
  if (parsed.validation) {
    parts.push(`validation=${parsed.validation.valid ? 'ok' : 'failed'}`);
  }
  return `doctor: ${parts.join(', ')}`;
}

function buildGateFailureEnvelope(result) {
  const runCheck = result.checks.find((check) => check.name === 'run-verify') ?? null;
  const doctorCheck = result.checks.find((check) => check.name === 'doctor' && check.ok === false && check.agentIntegrationOk === false) ?? null;
  const changeCheck = result.checks.find((check) => check.name === 'change-validate' && check.ok === false) ?? null;
  if (doctorCheck) {
    return {
      kind: 'integration-drift',
      details: [doctorCheck.summary, ...(doctorCheck.details ?? [])].filter(Boolean),
      repair: 'Repair path: run openprd doctor . to inspect drift, then use openprd update . or the targeted repair command before retrying this high-risk action.',
    };
  }
  if (runCheck?.taskReady === false || changeCheck) {
    return {
      kind: 'task-failure',
      details: [
        runCheck?.summary,
        ...(runCheck?.errors ?? []),
        ...(changeCheck?.details ?? []),
      ].filter(Boolean),
      repair: 'Repair path: fix the task-scoped failure, rerun the relevant verification command, then retry this high-risk action.',
    };
  }
  if (runCheck?.workspaceReady === false) {
    return {
      kind: 'workspace-debt',
      details: [
        runCheck.summary,
        runCheck.workspaceAttention?.detail ?? null,
        ...(runCheck.warnings ?? []),
      ].filter(Boolean),
      repair: 'Repair path: resolve the workspace-level debt from openprd run . --verify or openprd quality . --verify, then retry this high-risk action.',
    };
  }
  return {
    kind: 'task-failure',
    details: result.checks.filter((check) => !check.ok).flatMap((check) => [check.summary, ...(check.details ?? [])]).filter(Boolean),
    repair: 'Repair path: rerun the relevant verification command, fix the failing check, then retry.',
  };
}

function formatHighRiskGateBlock(result) {
  const envelope = result.envelope ?? buildGateFailureEnvelope(result);
  const headline = envelope.kind === 'workspace-debt'
    ? 'OpenPrd blocked a high-risk action because the current task is done but the workspace is not fully ready.'
    : envelope.kind === 'integration-drift'
      ? 'OpenPrd blocked a high-risk action because the integration health gate failed.'
      : 'OpenPrd blocked a high-risk action because the current task is not ready.';
  return [
    headline,
    result.summary,
    ...envelope.details,
    envelope.repair,
  ].filter(Boolean).join('\n');
}

function classifyToolFailure(text) {
  const normalized = String(text || '').toLowerCase();
  if (/doctor|hook|hook-profile|hooks\.json|config\.toml|command-catalog|openprd-router|skill|integration|drift/.test(normalized)) {
    return 'integration-drift';
  }
  if (/production-ready|needs-attention|smoke evidence|feature coverage|workspace ready|workspace debt|quality/.test(normalized)) {
    return 'workspace-debt';
  }
  return 'task-failure';
}

function toolFailureMessage(kind) {
  if (kind === 'integration-drift') {
    return 'A tool command failed in a way that looks like integration drift. Use openprd doctor . first; if drift is confirmed, repair it with openprd update . or the targeted fix before continuing.';
  }
  if (kind === 'workspace-debt') {
    return 'A tool command failed against workspace-level readiness. Re-run openprd run . --verify or openprd quality . --verify, separate current-task status from historical workspace debt, and only then choose the repair path.';
  }
  return 'A tool command failed against the current task. Use openprd next . and the relevant verification command to identify the smallest task-scoped repair path.';
}

function recordRunHook(cwd, baseEvent, outcome) {
  const args = [
    'run',
    '.',
    '--record-hook',
    '--event',
    baseEvent.eventName,
    '--risk',
    baseEvent.risk.level,
    '--outcome',
    outcome,
  ];
  if (baseEvent.preview) {
    args.push('--preview', baseEvent.preview.slice(0, 300));
  }
  runOpenPrd(args, cwd);
}

function requirementGateMessage(intent, gate) {
  const gateBlocksImplementation = isBlockingRequirementGate(gate);
  const approvalPolicy = requirementApprovalPolicy(gate);
  if (!intent?.requiresIntake && !gateBlocksImplementation) {
    return null;
  }
  if (intent?.visualMockupRequest) {
    return [
      'OpenPrd requirement intake gate is active only for implementation writes.',
      'The user is asking for an image asset such as a cover image, poster, illustration, icon, sticker, visual mockup, or effect image, not code implementation.',
      'For logo, icon, avatar, badge, and similar development assets, default to a standalone asset: full-frame single subject with no extra UI frame, card shell, device mockup, or presentation container unless the user explicitly asked for one.',
      'Do not create temporary HTML/SVG/CSS files for this image unless the user explicitly requested that format.',
      'Use `imagegen`, which is Codex native Image 2, to generate the image; keep implementation, PRD review, and visual-compare for later explicit confirmation.',
    ].join('\n');
  }
  const status = gateBlocksImplementation ? 'active' : 'opened';
  return [
    'OpenPrd requirement intake gate: ' + status + '.',
    'This prompt looks like a likely 新功能/新流程方案 (L2), so the heavy requirement-intake lane is active. Do not decide from fixed keywords; first use $openprd-requirement-intake to classify the user-visible requirement type by impact, unknowns, decision cost, and validation cost.',
    'Keep this mapping visible for internal review: 快速修正=L0, 现有功能优化=L1, 新功能/新流程方案=L2.',
    'L0 and L1 stay on lightweight paths and should not be forced through formal PRD/review/change/tasks unless the scope expands.',
    'If the requirement type is 新功能/新流程方案 (L2), do not edit implementation files yet and proceed through PRD/review/change/tasks with the appropriate PRD scene lens: 通用场景、面向个人消费者场景、面向企业服务场景，或以 Agent 为主要使用场景。 Keep raw enum values such as base / consumer / b2b / agent for internal commands or records only; do not surface them to the user unless truly necessary.',
    reviewPolicyAllowsSilentRecord(approvalPolicy)
      ? 'Decision-point policy: because the user explicitly said there is no need for any confirmation stop, you may skip the requirement-summary confirmation stop, write back the requirement facts, synthesize the PRD, record the exact current stable review artifact, generate the OpenPrd change, prepare the task breakdown, then implement within the confirmed scope.'
      : 'Decision-point policy: first output a short structured requirement summary in chat with 需求判断 / 需求理解 / 功能范围 / 技术方案, where 功能范围 and 技术方案 should prefer Markdown tables; wait for the user to confirm that summary, then write back confirmed facts, synthesize the PRD, wait for a human decision on the stable review artifact, generate the OpenPrd change, prepare the task breakdown, then implement within the confirmed scope.',
    reviewPolicyAllowsSilentRecord(approvalPolicy)
      ? 'This lane is in silent-record mode only because the user explicitly said there is no need for any further review or confirmation stop. Plain "请帮我实现" is not enough; you may record only the exact current version, digest, and work unit.'
      : 'Requirement-summary confirmation, review-artifact confirmation, and implementation authorization are different gates: do not treat "可以开做", "继续实现", plain "请帮我实现", or "不需要评审" as permission to skip them.',
    'If the original request already asked to implement, execution can continue once the active approval policy and tasks are ready; otherwise wait for a clear execution request.',
    'Recommended next action: write a short 需求类型判断 in chat, and by default merge the route into the label as 需求类型：新功能/新流程方案（L2）; only add a separate 内部路由码 when internal debugging truly benefits. Then run openprd clarify ., summarize the requirement in chat using 需求判断 / 需求理解 / 功能范围 / 技术方案, prefer Markdown tables for 功能范围 and 技术方案, ask for confirmation, and only after that write back confirmed facts. Do not open a clarification HTML page; the formal HTML review happens after synthesize/review.',
  ].join('\n');
}

function lightweightRequirementMessage(intent) {
  if (intent?.requirementTier === 'l0') {
    return [
      'OpenPrd 轻量需求路径: 当前更接近快速修正 (L0)。',
      '先在 chat 用短格式写出“需求类型 / 理由 / 推荐下一步”，并默认写成“需求类型：快速修正（L0）”；只有内部排障确实需要时，才额外单列“内部路由码”。',
      '直接处理并事后说明即可，不打开正式 PRD/review/change/tasks。',
      '优先做最小足够验证，并用 1-2 句说明本轮特别需要强化的测试点；默认不要求正式测试报告。',
      '如果过程中暴露出跨系统依赖、支付/账号/权限/回调等高风险因素，再升级到 L2 重流程。',
    ].join('\n');
  }
  if (intent?.requirementTier === 'l1') {
    return [
      'OpenPrd 轻量需求路径: 当前更接近现有功能优化 (L1)。',
      '先在 chat 用短格式写出“需求类型 / 理由 / 推荐下一步”，并默认写成“需求类型：现有功能优化（L1）”，再给 3-5 行 mini-plan；只有内部排障确实需要时，才额外单列“内部路由码”。',
      '先在对话里给 3-5 行 mini-plan，至少写清目标、范围内、范围外和验证方式。',
      '默认不要打开正式 PRD/review/change/tasks；只有在 mini-plan 暴露新决策缺口、跨系统风险或范围升级时，才提升到 L2 重流程。',
      '验证采用最小足够组合即可，重点说明需要强化测试的地方；默认不要求正式测试报告。',
      intent?.largeUiChangeRequest
        ? '如果这是大界面改动，mini-plan 之后先做 3 方向视觉方案评审，再进入实现。'
        : '',
    ].filter(Boolean).join('\n');
  }
  return null;
}

function visualMockupMessage(intent) {
  if (!intent?.visualMockupRequest) {
    return null;
  }
  return [
    '当前用户要的是图片内容生成，例如图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿或 mockup。',
    '默认直接调用 `imagegen`，也就是 Codex 原生 Image 2，来生成图片；除非用户明确指定 HTML、SVG、CSS、Canvas、代码稿或可编辑矢量/source artifact，不要改用临时 HTML/SVG/CSS 再截图。',
    '对 logo、icon、avatar、badge 等开发素材，如果用户没有明确要求 mockup、场景图、设备框、卡片承载、名片/包装展示或参考界面复刻，默认按独立素材输出（standalone asset）处理：使用全画布单主体，不额外添加 UI frame、卡片、设备壳、名片、桌面陈列、手持实拍或其他展示容器。',
    '只有当用户明确要求 mockup、场景化效果图、容器化呈现，或参考图本身就包含这些承载结构时，才生成对应的容器或场景。',
    '只有在实际发生 `imagegen` 调用后，才能汇报生图结果、失败或限流；未调用 `imagegen` 前，不要声称“生图限流”或“生图失败”。',
    'OpenPrd review.html 只用于需求评审，visual-compare 只用于实现阶段视觉证据：已有参考图时做效果图/实现截图对比，无参考图但改动界面时做修改前/修改后自检；局部细节优先补局部焦点证据板，并行优化方向优先补并行实验证据板。',
  ].join('\n');
}

function largeUiVisualDirectionMessage(intent) {
  if (!intent?.largeUiChangeRequest) {
    return null;
  }
  return [
    'OpenPrd 大界面改动视觉方案评审:',
    '位置: 需求分流之后、PRD 定稿或实现开工之前；它不同于 review.html，也不同于实现后的 visual-compare。',
    '判断: 会明显改变信息架构、核心布局、主视觉、关键路径、组件层级/密度，或用户需要先选设计方向时触发。',
    '步骤: 用 Codex Computer Use 进入产品内对应功能并截当前真实界面；基于截图调用 `imagegen`（Codex 原生 Image 2）做图生图，至少生成 3 个不同设计思想方向；把效果图横向拼成一张大图，每张左上角标注 1/2/3，并保存到 .openprd/harness/visual-reviews/。',
    '交互: 把横向大图展示给用户评审确认；用户确认方向前，不进入大 UI 实现，也不要声称界面方案已定。',
  ].join('\n');
}

function codexConfirmationReplyRule() {
  return 'Codex 回复规则: 只有当前真的还缺人来拍板时，才在 final answer 里停下来请求确认。只要用户已经明确说了“认可并继续”，或已经确认了 mini-plan、范围边界、正式产品边界，就直接沿着已确认路径继续，不要再写“如果你认可”“确认的话我就继续”这类二次索取确认的话。面向用户时，不要直接抛 lane、change、tasks、review artifact、work unit、digest、worker shard、write-scope、worktree、内部版本号、命令或文件路径这些内部词；统一改说“需求确认稿”“本次调整”“后续任务”“继续落地”“完成后检查”。如果后面真的还需要额外授权，再用人话把会做什么、不会做什么、完成后怎么检查说清楚。如果当前仍在 L2 的首轮澄清或需求摘要确认阶段，不要写成“你回我一句我就开始实现”；只能承诺“我先整理需求摘要给你确认，确认后再继续”。如果当前 lane 已进入 silent-record 策略，只能说明用户已经明确说了“不需要进行任何确认”；单纯的“请帮我实现/继续实现”不能把 lane 切到 silent-record。';
}

function confirmationGateMessage(gate) {
  if (!gate || gate.active) {
    return null;
  }
  const intro = gate.status === 'execution-authorized'
    ? 'OpenPrd requirement intake gate auto-authorized execution after review confirmation and task preparation because the original user request already asked to implement.'
    : 'OpenPrd requirement intake gate was explicitly confirmed by the user.';
  return [
    intro,
    'Implementation may proceed only within the confirmed scope, with docs/basic, file manuals, folder README docs, standards verification, and OpenPrd run verification kept up to date. For backend, script, agent, tooling, service, or data-processing changes, keep CLI and API surface review current in docs/basic/backend-structure.md.',
    'For UI or visual work with an existing reference image, capture the implemented UI and run openprd visual-compare . --reference <effect-image> --actual <implementation-screenshot>; if local detail matters more than the whole screen, add openprd visual-compare . --board <focus-board.json> so the agent can review numbered zoom regions. When there is no reference image, capture the before screenshot first, implement, capture the after screenshot from the same entry, viewport, account, and data state, then run openprd visual-compare . --before <before-screenshot> --after <after-screenshot>; if the agent explored multiple optimization directions, add openprd visual-compare . --board <parallel-board.json> and inspect expected changes plus unintended drift before claiming completion.',
  ].join('\n');
}

function currentRequirementStatusLine(gate, progress) {
  if (gate?.status === 'review-confirmation-authorized') {
    return gate?.reviewActionAuthorization?.continueAfterReview
      ? '用户刚刚已经确认这版需求，并且明确表示继续。先记录这次确认结果，然后直接接着整理本次调整和后续任务；只有后面真的还缺额外授权时，再用人话说明影响和下一步。'
      : '用户刚刚已经确认这版需求；本回合只允许记录这次确认结果，不能把它直接扩展成开工授权。';
  }
  if (gate?.status === 'review-recording-authorized') {
    return '这版需求确认稿已经按免再次确认的规则授权记录；只记录这一次确认结果，然后继续整理本次调整和后续任务。';
  }
  switch (progress?.nextStep) {
    case 'clarification-confirmation-required':
      return '当前卡点: 先让用户确认当前需求摘要；在此之前不要把核心需求写成既定事实，也不要直接往后推进。';
    case 'prd-synthesis-required':
      return reviewPolicyAllowsSilentRecord(requirementApprovalPolicy(gate))
        ? '当前卡点: 用户已明确表示不需要再停下来确认，可以直接整理已确认内容，并生成这版需求确认稿。'
        : '当前卡点: 当前需求摘要已确认，下一步把已确认内容整理成这版需求确认稿。';
    case 'prd-review-required':
      return progress?.review?.versionId
        ? '当前卡点: 先等用户确认这版需求确认稿；不要把“继续做”“开落地吧”或单纯的“请帮我实现/继续实现”当成已经认可这版内容。'
        : '当前卡点: 先整理出这版需求确认稿，再等待用户确认。';
    case 'review-recording-required':
      return '当前卡点: 这版需求确认稿已经生成，而且用户已明确表示不需要再停下来确认；可以先记录这次确认结果，再继续后面的整理。';
    case 'change-generation-required':
      return '当前卡点: 这版需求已经确认，下一步先整理本次调整范围；这是当前流程的直接延续，不需要再重复索取同一轮确认。';
    case 'task-breakdown-required':
      return '当前卡点: 本次调整范围已经立起来了，下一步把它拆成可直接执行的后续任务。';
    case 'implementation-ready':
      return '当前卡点: 这版需求和后续任务都准备好了。如果用户一开始就明确要继续做，就直接进入实现；否则再用人话说明这次会做什么、不会做什么、完成后怎么检查。若用户刚刚确认的是 L1 范围边界或 mini-plan，承接话术要写成“已确认，我按这个继续”，不要再写成像二次索取确认的句子。';
    default:
      return '当前卡点: 继续按“澄清需求 -> 确认需求 -> 整理本次调整 -> 拆分后续任务 -> 开始实现”的顺序推进。';
  }
}

function currentRequirementMessage(intent, gate, progress) {
  const prompt = stripMarkdown(gate?.promptPreview || '');
  const approvalPolicy = requirementApprovalPolicy(gate);
  const gateStatus = isImplementationAdvanceIntent(intent)
    ? 'OpenPrd requirement intake gate was explicitly confirmed by the user.'
    : 'OpenPrd requirement intake gate: active.';
  const lines = [
    'OpenPrd 当前需求入口',
    gateStatus,
    '对外表达要求: 面向用户不要直接复述 PRD、review artifact、change、tasks、lane、approval policy、work unit、digest、worker shard、write-scope、worktree、内部版本号、命令或文件路径；改说“需求确认稿”“本次调整”“后续任务”“继续落地”“完成后检查”。',
    '当前输入已被判定为可能的新功能/新流程方案（L2），因此进入重流程需求入口。不要按固定关键词判断；先用 $openprd-requirement-intake 按影响面、未知数、决策成本和验证成本判断用户可见需求类型。',
    '内部审查保留固定对照：快速修正=L0，现有功能优化=L1，新功能/新流程方案=L2。',
    '如果用户刚刚已经确认了现有功能优化（L1）的 mini-plan、范围边界或正式产品边界，下一句要明确写成“已确认，我按这个继续/收口/落地”；不要只写一个“确认”，更不要写成“确认，我们就按这个……”这种容易让用户误以为还要再表态的句子。',
    '如果需求类型是新功能/新流程方案（L2），本轮只围绕这个新需求推进 PRD/review/change/tasks，并选择通用场景 / 面向个人消费者场景 / 面向企业服务场景 / 以 Agent 为主要使用场景的 PRD 视角，不自动继续历史 active change。对用户复述时不要直接把 consumer / b2b / agent 当展示词；这些枚举值只用于内部记录和命令。',
    prompt ? '本轮需求: ' + prompt : '',
    gate?.intakeMode === 'deep-reflection'
      ? '需求入口: 先运行需求自省，再输出对话内澄清摘要或简短清单。'
      : '需求入口: 先做轻量项目映射，再确认影响点和验收方式。',
    reviewPolicyAllowsSilentRecord(approvalPolicy)
      ? '当前 approval policy: decision-points / silent-record。之所以进入 silent-record，是因为用户已经明确表示不需要进行任何确认；单纯的“请帮我实现/继续实现”或“不要评审”都不够，仍然只能记录版本、digest、work unit 精确匹配的 artifact。'
      : '当前 approval policy: decision-points / human-review。当前 lane 仍需要一次 requirement 摘要确认和一次稳定 review artifact 的明确人类决策；单纯的“请帮我实现/继续实现”不算这两次决策。',
    intent?.reviewContinuationRequested
      ? '这条消息同时表达了“确认当前稳定评审稿并继续当前 OpenPrd 下一步”的意图：先记录精确 review artifact，再继续当前 lane；如果 review 后 tasks 已就绪但还需要执行授权，立刻展示执行确认清单，不要停在“如果你要我继续”。'
      : '',
    currentRequirementStatusLine(gate, progress),
    reviewPolicyAllowsSilentRecord(approvalPolicy)
      ? 'Decision-point order: because the user explicitly waived any confirmation stop, you may skip requirement-summary confirmation, write back requirement facts, synthesize the PRD, record the exact stable review artifact, generate the OpenPrd change, prepare the task breakdown, then implement within the confirmed scope.'
      : 'Decision-point order: clarify the requirement, summarize it in chat using 需求判断 / 需求理解 / 功能范围 / 技术方案, prefer Markdown tables for 功能范围 and 技术方案, wait for the user to confirm that requirement summary, write back only confirmed facts, synthesize the PRD, wait for a human review decision on the stable artifact, generate the OpenPrd change, prepare the task breakdown, then implement within the confirmed scope.',
    intent?.largeUiChangeRequest
      ? 'Large UI direction gate: before PRD freeze or implementation, capture the current in-product screen with Codex Computer Use, generate at least three Image 2 directions, combine them into one horizontal numbered contact sheet, and wait for the user to choose a direction.'
      : '',
    'Recommended next action: 先在 chat 输出“需求类型判断”，默认把路由码并进“需求类型：新功能/新流程方案（L2）”这类标签里；只有内部排障确实需要时，才额外写“内部路由码”。若为新功能/新流程方案（L2），再运行 openprd clarify .，并按“需求判断 / 需求理解 / 功能范围 / 技术方案”给出十句话左右的结构化摘要，其中“功能范围”和“技术方案”优先用 Markdown 表格；请求确认后再写回 requirement 事实并继续 classify/synthesize，不要把这一步表述成“确认后直接开始实现”。Do not open clarification HTML; use review.html only after synthesize/review.',
  ];
  if (isImplementationAdvanceIntent(intent)) {
    lines.splice(2, 1, gate?.active
      ? '用户表达了继续实现的意图；但在 review 评审、change 和任务拆解走完之前，仍然阻断实现写入。'
      : '用户已确认当前需求可以进入执行范围；仍需保持实现范围与已确认的需求入口一致。');
  }
  lines.push(codexConfirmationReplyRule());
  return lines.filter(Boolean).join('\n');
}

function requirementRoutingSummary() {
  return '需求类型由 $openprd-requirement-intake 按影响面、未知数、决策成本和验证成本判断：快速修正(L0)直接处理并事后说明，不打开正式 PRD/review/change/tasks；现有功能优化(L1)先给对话内 mini-plan，默认不生成正式 PRD/change/tasks；新功能/新流程方案(L2)才进入 requirement intake 与 PRD/review/change/tasks，并选择通用场景 / 面向个人消费者场景 / 面向企业服务场景 / 以 Agent 为主要使用场景的 PRD 视角。对用户复述时不要直接把 consumer / b2b / agent 当展示词；这些枚举值只用于内部记录和命令。单纯的“请帮我实现/继续实现”只表示有执行意图，不表示跳过 requirement 摘要确认或 review；只有用户明确表示不需要进行任何确认时，才允许静默走完整 requirement write path。';
}

function historicalRequirementReminder(root, runContext, intent, gate) {
  const activeChange = runContext?.activeChange;
  if (!activeChange || (!intent?.requiresIntake && !(intent?.confirmation && gate?.promptPreview))) {
    return null;
  }
  const summary = changeRequirementSummary(root, activeChange);
  const taskSummary = runContext.taskSummary;
  const status = taskSummary
    ? '当前状态: OpenPrd 仍显示 ' + taskSummary.completed + '/' + taskSummary.total + ' 项完成，' + taskSummary.pending + ' 项待处理，' + taskSummary.blocked + ' 项阻塞。它可能是真的未完成、已经开发完但忘记更新状态，或只是项目状态未收口。'
    : '当前状态: OpenPrd 仍把它标记为 active。它可能是真的未完成、已经开发完但忘记更新状态，或只是项目状态未收口。';
  const pending = summary.pendingTasks.length > 0
    ? '待判断的需求点: ' + summary.pendingTasks.join('；')
    : '';
  return [
    'OpenPrd 历史需求提醒',
    '检测到一个未收口的历史需求，但它和本轮新需求分开处理，本轮不会自动继续它。',
    '历史需求: ' + summary.title,
    summary.summary ? '需求说明: ' + summary.summary : '',
    status,
    pending,
    '可选处理: 继续当前新需求；查看这个历史需求还差什么；如果已完成则运行验证并收口；如果未完成再切回继续。',
  ].filter(Boolean).join('\n');
}

function knowledgeSkillReminder(runContext) {
  const lines = knowledgeSkillContextLines(runContext?.knowledgeSkills);
  return lines.length > 0 ? lines.join('\n') : null;
}

function contextMessage(cwd, intent = null, gate = null, progress = null) {
  const run = progress?.runContext
    ? { ok: true, parsed: progress.runContext, stdout: renderRunContextText(progress.runContext) }
    : runOpenPrdContext(cwd, intent?.promptText ?? null);
  const effectiveProgress = progress ?? evaluateRequirementGateProgress(cwd);
  const gateMessage = requirementGateMessage(intent, gate) || confirmationGateMessage(gate);
  if (run.ok) {
    const separateCurrentRequirement = Boolean(intent?.requiresIntake || ((intent?.confirmation || intent?.reviewDecision) && gate?.promptPreview));
    if (separateCurrentRequirement) {
      return [
        currentRequirementMessage(intent, gate, effectiveProgress),
        historicalRequirementReminder(cwd, run.parsed, intent, gate),
        knowledgeSkillReminder(run.parsed),
        'OpenPrd 上下文只是建议，不是自动执行指令。请先判断用户当前意图。',
        lightweightRequirementMessage(intent),
        visualMockupMessage(intent),
        largeUiVisualDirectionMessage(intent),
        requirementRoutingSummary(),
        '如果用户只是要求看看、规划、分析、审查、解释影响或列出文件，请保持只读并基于证据回答；不要运行 OpenPrd loop、任务推进、discovery 推进、commit 或其他写入命令。',
        '只有当用户当前明确要求开发、实现、修复、继续任务、深度调研、对标复刻或提交时，才运行 openprd loop --run、openprd tasks --advance、openprd discovery --advance、commit/push 等执行命令。',
        '代码修改完成后、最终回复前，针对本轮实际 touched code files 运行 openprd dev-check . <file...>；若出现需要关注的文件，最终回复必须以 **后续建议** 为标题，直接复用 dev-check 生成的 Markdown 表格，列出影响对象、关注程度、规模信号、预警原因、本次处理结果和后续建议，并按 🔴 → 🟠 → 🟡 排序；不要把“关注程度”列改写成纯 emoji，必须保留例如“🟠 中风险｜建议优先关注”这类完整标签；如果你改写了“预警原因 / 本次处理结果 / 后续建议”，先用 `node scripts/dev-check-wrapup-copy.mjs --validate` 校验每格不超过 20 字；若报错，按提示缩短后重试。',
        '大界面改动进入实现前，先用 Codex Computer Use 截取产品内当前功能截图，再用 `imagegen`（Codex 原生 Image 2）基于截图生成至少 3 个设计方向，横向拼接为一张带 1/2/3 序号的大图给用户确认；未确认方向前不要进入大 UI 实现。',
        '涉及界面、页面、视觉、样式或前端体验，且已经有效果图/设计稿/用户给图并进入实现阶段时，阶段性完成后必须截图并运行 openprd visual-compare . --reference <效果图> --actual <实现截图>；如果这次重点在局部细节，再补一份 openprd visual-compare . --board <focus-board.json>。没有明确参考图但改动界面时，动手前先截修改前截图，完成后用同一入口、视口、账号和数据状态截修改后截图，并运行 openprd visual-compare . --before <修改前截图> --after <修改后截图>；如果并行试了多个优化方向，再补一份 openprd visual-compare . --board <parallel-board.json>；默认输出 JPG 到 .openprd/harness/visual-reviews/。查看合成图后继续对标或自检，直到没有明显视觉差异或意外漂移。',
        '发现可沉淀项时不要中途打断任务：代码扩展识别这类白名单工具补全会自动应用并记录；用户偏好、项目协作规矩和 OpenPrd 默认行为先记录为候选，收工时运行 openprd grow . --review 集中确认。',
        '维护 OpenPrd 本身且涉及配置类能力时，先判断是否应纳入 openprd grow；高置信可成长默认纳入，不确定则主动询问用户。',
        '涉及后端、脚本、Agent、工具链、服务或数据处理变更时，把 CLI 与 API 视为同级接入面：同步检查命令入口、参数、输出契约、help/doctor/dry-run/status 与接口协议、返回结构、身份边界是否受影响，并更新 docs/basic/backend-structure.md 或明确写不适用原因。',
        '声明实现就绪前，先运行 openprd standards . --verify 和 openprd run . --verify。',
      ].filter(Boolean).join('\n');
    }
    return [
      run.stdout,
      gateMessage,
      knowledgeSkillReminder(run.parsed),
      'OpenPrd 上下文只是建议，不是自动执行指令。请先判断用户当前意图。',
      lightweightRequirementMessage(intent),
      visualMockupMessage(intent),
      largeUiVisualDirectionMessage(intent),
      requirementRoutingSummary(),
      '如果用户只是要求看看、规划、分析、审查、解释影响或列出文件，请保持只读并基于证据回答；不要运行 OpenPrd loop、任务推进、discovery 推进、commit 或其他写入命令。',
      '只有当用户当前明确要求开发、实现、修复、继续任务、深度调研、对标复刻或提交时，才运行 openprd loop --run、openprd tasks --advance、openprd discovery --advance、commit/push 等执行命令。',
      '代码修改完成后、最终回复前，针对本轮实际 touched code files 运行 openprd dev-check . <file...>；若出现需要关注的文件，最终回复必须以 **后续建议** 为标题，直接复用 dev-check 生成的 Markdown 表格，列出影响对象、关注程度、规模信号、预警原因、本次处理结果和后续建议，并按 🔴 → 🟠 → 🟡 排序；不要把“关注程度”列改写成纯 emoji，必须保留例如“🟠 中风险｜建议优先关注”这类完整标签；如果你改写了“预警原因 / 本次处理结果 / 后续建议”，先用 `node scripts/dev-check-wrapup-copy.mjs --validate` 校验每格不超过 20 字；若报错，按提示缩短后重试。',
      '大界面改动进入实现前，先用 Codex Computer Use 截取产品内当前功能截图，再用 `imagegen`（Codex 原生 Image 2）基于截图生成至少 3 个设计方向，横向拼接为一张带 1/2/3 序号的大图给用户确认；未确认方向前不要进入大 UI 实现。',
      '涉及界面、页面、视觉、样式或前端体验，且已经有效果图/设计稿/用户给图并进入实现阶段时，阶段性完成后必须截图并运行 openprd visual-compare . --reference <效果图> --actual <实现截图>；如果这次重点在局部细节，再补一份 openprd visual-compare . --board <focus-board.json>。没有明确参考图但改动界面时，动手前先截修改前截图，完成后用同一入口、视口、账号和数据状态截修改后截图，并运行 openprd visual-compare . --before <修改前截图> --after <修改后截图>；如果并行试了多个优化方向，再补一份 openprd visual-compare . --board <parallel-board.json>；默认输出 JPG 到 .openprd/harness/visual-reviews/。查看合成图后继续对标或自检，直到没有明显视觉差异或意外漂移。',
      '发现可沉淀项时不要中途打断任务：代码扩展识别这类白名单工具补全会自动应用并记录；用户偏好、项目协作规矩和 OpenPrd 默认行为先记录为候选，收工时运行 openprd grow . --review 集中确认。',
      '维护 OpenPrd 本身且涉及配置类能力时，先判断是否应纳入 openprd grow；高置信可成长默认纳入，不确定则主动询问用户。',
      '涉及后端、脚本、Agent、工具链、服务或数据处理变更时，把 CLI 与 API 视为同级接入面：同步检查命令入口、参数、输出契约、help/doctor/dry-run/status 与接口协议、返回结构、身份边界是否受影响，并更新 docs/basic/backend-structure.md 或明确写不适用原因。',
      '声明实现就绪前，先运行 openprd standards . --verify 和 openprd run . --verify。',
    ].filter(Boolean).join('\n');
  }
  const status = runOpenPrd(['status', '.'], cwd);
  const next = runOpenPrd(['next', '.'], cwd);
  if (!status.ok && !next.ok) {
    return '已安装 OpenPrd harness，但本轮无法读取工作区状态。声明就绪前请先运行 openprd doctor .。';
  }
  return [
    'OpenPrd harness 上下文:',
    status.ok ? status.stdout : '',
    next.ok ? next.stdout : '',
    gateMessage,
    lightweightRequirementMessage(intent),
    visualMockupMessage(intent),
    largeUiVisualDirectionMessage(intent),
    requirementRoutingSummary(),
    'OpenPrd 下一步只是建议。规划、分析、审查类请求保持只读；只有用户当前明确要求开发、深度调研、对标复刻或继续任务时才执行。',
    '代码修改完成后、最终回复前，针对本轮实际 touched code files 运行 openprd dev-check . <file...>；若出现需要关注的文件，最终回复必须以 **后续建议** 为标题，直接复用 dev-check 生成的 Markdown 表格，列出影响对象、关注程度、规模信号、预警原因、本次处理结果和后续建议，并按 🔴 → 🟠 → 🟡 排序；不要把“关注程度”列改写成纯 emoji，必须保留例如“🟠 中风险｜建议优先关注”这类完整标签；如果你改写了“预警原因 / 本次处理结果 / 后续建议”，先用 `node scripts/dev-check-wrapup-copy.mjs --validate` 校验每格不超过 20 字；若报错，按提示缩短后重试。',
    '发现可沉淀项时不要中途打断任务：代码扩展识别这类白名单工具补全会自动应用并记录；用户偏好、项目协作规矩和 OpenPrd 默认行为先记录为候选，收工时运行 openprd grow . --review 集中确认。',
    '维护 OpenPrd 本身且涉及配置类能力时，先判断是否应纳入 openprd grow；高置信可成长默认纳入，不确定则主动询问用户。',
    '涉及后端、脚本、Agent、工具链、服务或数据处理变更时，把 CLI 与 API 视为同级接入面，并同步更新 docs/basic/backend-structure.md 或明确写不适用原因。',
    '声明就绪前请验证 docs/basic 标准。',
  ].filter(Boolean).join('\n');
}

function shouldInjectOpenPrdContext(payload) {
  const prompt = promptText(payload);
  if (!prompt.trim()) {
    return false;
  }
  const intent = analyzePromptIntent(prompt);
  const hasProjectPathReference = /(?:^|[\s`"'(])(?:src|app|lib|server|scripts|test|tests|docs|skills|openprd|openspec)\/[^\s`"'()]+/i.test(prompt);
  if (
    intent.simpleConcrete
    && !intent.visualMockupRequest
    && !intent.largeUiChangeRequest
    && !intent.continuationRequest
    && !hasProjectPathReference
    && !intent.productCopyRequest
    && !intent.secretsRequest
    && !intent.weappValidationRequest
    && !intent.browserSafetyRequest
    && !intent.publicRepoResearchRequest
    && !intent.externalTechResearchRequest
    && !intent.skillWorkflowEditRequest
  ) {
    return false;
  }
  if (intent.shouldInject) {
    return true;
  }
  const normalized = prompt.toLowerCase();
  const triggers = [
    /openprd/i,
    /opens*prd/i,
    /\bprd\b/i,
    /openprd\s+(run|loop|fleet|doctor|standards|change|discovery|handoff|freeze)/i,
    /\b(fleet|standards)\b/i,
    /深度调研/,
    /深度对标/,
    /持续调研/,
    /复刻/,
    /对标/,
    /文件说明书/,
    /文件夹说明书/,
    /基础文档/,
    /docs\/basic/i,
    /standards/i,
    /handoff/i,
    /freeze/i,
    /新增/,
    /增加/,
    /新建/,
    /我希望/,
    /用户反馈/,
    /需求/,
    /功能/,
    /模块/,
    /页面/,
    /入口/,
    /流程/,
    /编排/,
    /一站式/,
    /体验/,
  ];
  return triggers.some((pattern) => pattern.test(normalized));
}

function classifyRisk(payload) {
  const text = payloadText(payload);
  const normalized = text.toLowerCase();
  const highPatterns = [
    /git\s+push/,
    /git\s+commit/,
    /npm\s+publish/,
    /pnpm\s+publish/,
    /yarn\s+npm\s+publish/,
    /gh\s+release/,
    /rm\s+-rf/,
    /openprd\s+freeze\b/,
    /openprd\s+handoff\b/,
    /openprd\s+change\s+.*--apply/,
    /openprd\s+change\s+.*--archive/,
  ];
  const mediumPatterns = [
    /apply_patch/,
    /npm\s+install/,
    /npm\s+i\s/,
    /pnpm\s+add/,
    /yarn\s+add/,
    /bun\s+add/,
    /openprd\s+setup\b/,
    /openprd\s+update\b/,
    /openprd\s+standards\s+.*--init/,
    /openprd\s+change\s+.*--generate/,
    /openprd\s+review\s+.*--mark\s+(pending-confirmation|confirmed|needs-revision)/,
    /openprd\s+tasks\s+.*--advance/,
    /openprd\s+discovery\s+.*--advance/,
    /openprd\s+(capture|classify|synthesize|diagram)\b/,
  ];
  if (highPatterns.some((pattern) => pattern.test(normalized))) {
    return { level: 'high', reason: 'release, history, freeze, handoff, destructive, or accepted-change action' };
  }
  if (mediumPatterns.some((pattern) => pattern.test(normalized))) {
    return { level: 'medium', reason: 'workspace mutation or dependency/configuration change' };
  }
  return { level: 'low', reason: 'read-only or local exploratory action' };
}

function extractChangeId(text) {
  const match = String(text || '').match(/--change\s+([a-zA-Z0-9._-]+)/);
  return match ? match[1] : null;
}

function runGateChecks(cwd, payload, risk) {
  const checks = [];
  const run = runOpenPrd(['run', '.', '--verify', '--json'], cwd);
  const runParsed = parseJsonOutput(run.stdout);
  const runTaskReady = runParsed?.readiness?.taskReady ?? run.ok;
  const runWorkspaceReady = runParsed?.readiness?.workspaceReady ?? run.ok;
  checks.push({
    name: 'run-verify',
    ok: runWorkspaceReady,
    taskReady: runTaskReady,
    workspaceReady: runWorkspaceReady,
    summary: summarizeRunVerifyCheck(runParsed, run.stdout || run.stderr),
    workspaceAttention: runParsed?.workspaceAttention ?? null,
    warnings: Array.isArray(runParsed?.warnings) ? runParsed.warnings : [],
    errors: Array.isArray(runParsed?.errors) ? runParsed.errors : [],
    details: [
      ...(Array.isArray(runParsed?.errors) ? runParsed.errors : []),
      ...(Array.isArray(runParsed?.warnings) ? runParsed.warnings : []),
    ],
    output: run.stdout || run.stderr,
  });
  const text = payloadText(payload);
  const changeId = extractChangeId(text);
  if (changeId && /openprd\s+change\s+.*--(apply|archive|validate)/i.test(text)) {
    const change = runOpenPrd(['change', '.', '--validate', '--change', changeId], cwd);
    checks.push({
      name: 'change-validate',
      ok: change.ok,
      summary: `change-validate: ${change.ok ? 'ok' : 'failed'}`,
      details: [change.stdout || change.stderr].filter(Boolean),
      output: change.stdout || change.stderr,
    });
  }
  if (risk.level === 'high' && shouldRunDoctorForHighRisk(payload) && runWorkspaceReady) {
    const doctor = runOpenPrd(['doctor', '.', '--tools', 'codex', '--json'], cwd);
    const doctorParsed = parseJsonOutput(doctor.stdout);
    checks.push({
      name: 'doctor',
      ok: doctor.ok,
      agentIntegrationOk: doctorParsed?.agentIntegration?.ok ?? null,
      standardsOk: doctorParsed?.standards?.ok ?? null,
      validationOk: doctorParsed?.validation?.valid ?? null,
      summary: summarizeDoctorCheck(doctorParsed, doctor.stdout || doctor.stderr),
      details: [doctor.stderr || doctor.stdout].filter(Boolean),
      output: doctor.stdout || doctor.stderr,
    });
  }
  const envelope = buildGateFailureEnvelope({ checks });
  return {
    ok: checks.every((check) => check.ok),
    checks,
    envelope,
    summary: checks.map((check) => check.summary || `${check.name}: ${check.ok ? 'ok' : 'failed'}`).join(', '),
  };
}

function hookSuppressed(root) {
  const state = readJsonSync(path.join(harnessDir(root), 'hook-state.json'), {});
  const lockPath = path.join(harnessDir(root), 'input-lock.json');
  const lock = readJsonSync(lockPath, null);
  return Boolean(state?.suppressions?.inputLock || (lock && lock.active));
}

function allowHook(additionalContext = null, outputEventName = eventName) {
  const result = { continue: true };
  if (additionalContext) {
    result.hookSpecificOutput = {
      hookEventName: outputEventName,
      additionalContext,
    };
  }
  return result;
}

function blockHook(reason) {
  return {
    decision: 'block',
    reason,
    systemMessage: reason,
  };
}

function handle(eventName, cwd, payload) {
  const root = findProjectRoot(cwd);
  ensureHarness(root);
  const risk = classifyRisk(payload);
  const fingerprint = fingerprintFor(eventName, payload, risk);
  const duplicate = isDuplicate(root, fingerprint);
  const sessionId = sessionIdFor(payload);
  const baseEvent = {
    eventName,
    risk,
    fingerprint,
    duplicate,
    sessionId,
    preview: preview(payloadText(payload)),
  };

  if (eventName === 'SessionStart') {
    return allowHook();
  }

  if (eventName === 'UserPromptSubmit') {
    if (duplicate) {
      return allowHook();
    }
    const prompt = promptText(payload);
    beginTurnReview(root, baseEvent, prompt);
    let intent = analyzePromptIntent(prompt);
    let gate = readRequirementGate(root, sessionId);
    let skillGate = readNamedGate(root, 'skill-visualization', sessionId);
    let researchGate = readNamedGate(root, 'research', sessionId);
    let weappGate = readNamedGate(root, 'weapp', sessionId);
    const shortAffirmative = isShortAffirmativeConfirmation(prompt);
    let progress = isBlockingRequirementGate(gate) ? evaluateRequirementGateProgress(root, sessionId) : null;
    if (isBlockingRequirementGate(gate) && shortAffirmative) {
      intent = {
        ...intent,
        shouldInject: true,
      };
    }
    if (!intent.confirmation && isBlockingRequirementGate(gate) && shortAffirmative && progress?.nextStep === 'implementation-ready') {
      intent = {
        ...intent,
        confirmation: true,
        implementationConfirmation: true,
        shouldInject: true,
      };
    }
    if (skillGate?.active && (shortAffirmative || intent.confirmation)) {
      skillGate = confirmSkillVisualizationGate(root, prompt, sessionId);
    } else if (intent.skillWorkflowEditRequest) {
      skillGate = openSkillVisualizationGate(root, prompt, sessionId);
    } else if (skillGate?.active) {
      skillGate = closeSkillVisualizationGate(root, sessionId, { status: 'superseded-by-new-prompt' });
    }
    if (intent.publicRepoResearchRequest || intent.externalTechResearchRequest) {
      researchGate = openResearchGate(root, prompt, intent, sessionId);
    } else if (researchGate?.active) {
      researchGate = closeResearchGate(root, sessionId, { status: 'superseded-by-new-prompt' });
    }
    if (intent.weappValidationRequest) {
      weappGate = openWeappGate(root, prompt, sessionId);
    } else if (weappGate?.active) {
      weappGate = closeWeappGate(root, sessionId, { status: 'superseded-by-new-prompt' });
    }
    if (canAutoAuthorizeRequirementExecution(gate, progress)) {
      gate = authorizeRequirementGateExecution(root, prompt, sessionId, {
        reason: 'original-execution-intent-after-reviewed-task-ready',
      });
      progress = null;
    }
    if (isBlockingRequirementGate(gate)) {
      if ((intent.confirmation || shortAffirmative) && progress?.nextStep === 'clarification-confirmation-required') {
        gate = holdRequirementGate(root, prompt, progress, sessionId, {
          status: 'clarification-confirmed',
          clarificationConfirmedAt: now(),
          clarificationConfirmationPreview: preview(prompt, 500),
        });
        progress = evaluateRequirementGateProgress(root, sessionId);
        appendEvent(root, { ...baseEvent, outcome: 'requirement-gate-clarification-confirmed' });
        recordRunHook(root, baseEvent, 'requirement-gate-clarification-confirmed');
        updateHookState(root, baseEvent);
        return allowHook(composeHookContext(root, intent, gate, progress, sessionId));
      }
      if (intent.reviewDecision) {
        const authorization = reviewActionAuthorizationFor(intent, progress, prompt);
        gate = holdRequirementGate(root, prompt, progress, sessionId, {
          status: authorization ? 'review-confirmation-authorized' : progress.nextStep,
          reviewActionAuthorization: authorization,
        });
        const outcome = authorization ? 'requirement-gate-review-authorized' : 'requirement-gate-awaiting-review';
        appendEvent(root, {
          ...baseEvent,
          outcome,
          reviewDecision: intent.reviewDecision,
          reviewVersionId: progress?.review?.versionId ?? null,
        });
        recordRunHook(root, baseEvent, outcome);
        updateHookState(root, baseEvent);
        return allowHook(composeHookContext(root, intent, gate, progress, sessionId));
      }
      if (isImplementationAdvanceIntent(intent)) {
        if (progress?.nextStep !== 'implementation-ready') {
          gate = holdRequirementGate(root, prompt, progress, sessionId);
          appendEvent(root, { ...baseEvent, outcome: 'requirement-gate-held', progress });
          recordRunHook(root, baseEvent, 'requirement-gate-held');
          updateHookState(root, baseEvent);
          return allowHook(composeHookContext(root, intent, gate, progress, sessionId));
        }
        gate = confirmRequirementGate(root, prompt, sessionId);
        appendEvent(root, { ...baseEvent, outcome: 'requirement-gate-confirmed', progress });
        recordRunHook(root, baseEvent, 'requirement-gate-confirmed');
        updateHookState(root, baseEvent);
        return allowHook(composeHookContext(root, intent, gate, progress, sessionId));
      }
    }
    if (intent.requiresIntake) {
      gate = openRequirementGate(root, prompt, intent, sessionId);
      const result = allowHook(composeHookContext(root, intent, gate, evaluateRequirementGateProgress(root, sessionId), sessionId));
      appendEvent(root, { ...baseEvent, outcome: 'requirement-gate-opened' });
      recordRunHook(root, baseEvent, 'requirement-gate-opened');
      updateHookState(root, baseEvent);
      return result;
    }
    if (!shouldInjectOpenPrdContext(payload)) {
      return allowHook();
    }
    const result = allowHook(composeHookContext(root, intent, gate, progress, sessionId));
    appendEvent(root, { ...baseEvent, outcome: 'context-injected' });
    recordRunHook(root, baseEvent, 'context-injected');
    updateHookState(root, baseEvent);
    return result;
  }

  if (eventName === 'PreToolUse') {
    const turnIntent = analyzePromptIntent(readTurnState(root).prompt || '');
    let gate = readRequirementGate(root, sessionId);
    const skillGate = readNamedGate(root, 'skill-visualization', sessionId);
    const researchGate = applyResearchToolSignal(root, payload, sessionId);
    const weappGate = applyWeappToolSignal(root, payload, sessionId);
    let progress = isBlockingRequirementGate(gate) ? evaluateRequirementGateProgress(root, sessionId) : null;
    if (canAutoAuthorizeRequirementExecution(gate, progress)) {
      gate = authorizeRequirementGateExecution(root, readTurnState(root).prompt || '', sessionId, {
        reason: 'original-execution-intent-after-reviewed-task-ready',
      });
      progress = null;
    }
    if (sessionId && isAllowedDuringRequirementGate(root, payload, gate, sessionId)) {
      mirrorRequirementGate(root, sessionId);
    }
    if (skillGate?.active && looksLikeSkillContractMutation(root, payload)) {
      appendEvent(root, { ...baseEvent, outcome: 'blocked-skill-visualization-gate' });
      recordRunHook(root, baseEvent, 'blocked-skill-visualization-gate');
      updateHookState(root, baseEvent);
      return blockHook([
        'OpenPrd blocked a skill/AGENTS mutation because the visualization-confirmation gate is still active.',
        'Before editing SKILL.md, AGENTS.md, or related skill workflow files, first output a color-coded Mermaid plan, summarize added/changed/unchanged/removed items, then wait for explicit user confirmation.',
      ].join('\n'));
    }
    if (researchGate?.active && isMutationPayload(payload, risk)) {
      appendEvent(root, { ...baseEvent, outcome: 'blocked-research-gate' });
      recordRunHook(root, baseEvent, 'blocked-research-gate');
      updateHookState(root, baseEvent);
      return blockHook([
        'OpenPrd blocked a mutating action because the external-evidence gate is still active.',
        researchGateMessage(researchGate),
      ].filter(Boolean).join('\n'));
    }
    if (turnIntent.secretsRequest && isRawVaultReadAttempt(payload)) {
      appendEvent(root, { ...baseEvent, outcome: 'blocked-raw-vault-read' });
      recordRunHook(root, baseEvent, 'blocked-raw-vault-read');
      updateHookState(root, baseEvent);
      return blockHook([
        'OpenPrd blocked a raw vault read attempt.',
        'Use the `secrets-vault` skill first and only read the minimum required fields; do not read the original vault file directly.',
      ].join('\n'));
    }
    if (isBlockingRequirementGate(gate) && isMutationPayload(payload, risk) && !isAllowedDuringRequirementGate(root, payload, gate, sessionId)) {
      const reviewMark = parseReviewMarkCommand(commandText(payload));
      const approvalPolicy = requirementApprovalPolicy(gate);
      const silentRecord = reviewPolicyAllowsSilentRecord(approvalPolicy);
      const writePathMutation = isRequirementWritePathMutation(commandText(payload));
      const reason = reviewMark
        ? [
            silentRecord
              ? 'OpenPrd blocked review status writing because this command does not match the exact stable PRD review artifact allowed by the current approval policy.'
              : 'OpenPrd blocked review status writing because the current user message did not explicitly confirm this exact PRD review artifact.',
            silentRecord
              ? 'This lane is in silent-record mode: you may record only the exact current version, digest, and work unit, then continue without another user stop.'
              : 'Only record PRD review confirmation from the copied review command or an explicit review approval tied to the current version, digest, and work unit.',
            progress?.review?.versionId
              ? `Current review artifact: version ${progress.review.versionId}, digest ${progress.review.digest}, work unit ${progress.review.workUnitId}.`
              : 'Current review artifact has not been synthesized yet. Run openprd synthesize . --open first.',
            silentRecord
              ? 'Do not mark any stale or different review artifact; only the exact current artifact is allowed.'
              : 'Implementation approval and review confirmation are different gates; do not treat "可以开做", plain "请帮我实现/继续实现", or similar wording as permission to run openprd review --mark confirmed.',
          ].filter(Boolean).join('\n')
        : [
            'OpenPrd blocked a mutating action because the requirement gate is still active.',
            progress?.reason || 'The requirement still needs PRD review, change generation, or task preparation.',
            progress?.nextStep === 'implementation-ready'
              ? 'Do not edit implementation files until the user clearly asks to execute this reviewed requirement.'
              : writePathMutation && progress?.nextStep === 'clarification-confirmation-required'
                ? 'Do not write requirement facts, classify, or synthesize yet. First summarize the requirement in chat using 需求判断 / 需求理解 / 功能范围 / 技术方案, prefer Markdown tables for 功能范围 and 技术方案, wait for the user to confirm that summary, then continue the requirement write path.'
                : writePathMutation && progress?.nextStep === 'prd-synthesis-required'
                  ? 'You may continue the requirement write path only within the confirmed summary: write back confirmed facts, classify if needed, synthesize the PRD, then proceed to review/change/tasks.'
              : progress?.nextStep === 'review-recording-required'
                ? 'Do not edit implementation files yet. First record the exact current stable review artifact, then generate change and tasks.'
                : 'Do not edit implementation files until the active approval policy is satisfied and the OpenPrd change has generated tasks.',
            silentRecord
              ? 'Decision-point order: because the user explicitly waived any confirmation stop, you may skip requirement-summary confirmation, write back requirement facts, synthesize the PRD, record the exact stable review artifact, generate the OpenPrd change, prepare the task breakdown, then implement within the confirmed scope.'
              : 'Decision-point order: clarify the requirement, summarize it in chat using 需求判断 / 需求理解 / 功能范围 / 技术方案, prefer Markdown tables for 功能范围 and 技术方案, wait for the user to confirm that requirement summary, write back only confirmed facts, synthesize the PRD, wait for a human review decision on the stable artifact, generate the OpenPrd change, prepare the task breakdown, then implement within the confirmed scope.',
          ].join('\n');
      appendEvent(root, { ...baseEvent, outcome: 'blocked-requirement-intake' });
      recordRunHook(root, baseEvent, 'blocked-requirement-intake');
      updateHookState(root, baseEvent);
      return blockHook(reason);
    }
    if (turnIntent.browserSafetyRequest && isHighRiskBrowserAction(payload)) {
      appendEvent(root, { ...baseEvent, outcome: 'browser-safety-reminder' });
      recordRunHook(root, baseEvent, 'browser-safety-reminder');
      updateHookState(root, baseEvent);
      return allowHook(browserSafetyMessage(turnIntent));
    }
    if (risk.level === 'high') {
      const gates = runGateChecks(root, payload, risk);
      appendEvent(root, { ...baseEvent, gates, outcome: gates.ok ? 'allowed-high-risk' : 'blocked-high-risk' });
      recordRunHook(root, baseEvent, gates.ok ? 'allowed-high-risk' : 'blocked-high-risk');
      updateHookState(root, baseEvent);
      if (!gates.ok) {
        return blockHook(formatHighRiskGateBlock(gates));
      }
      recordTouchedFiles(root, payload);
      return allowHook(`OpenPrd high-risk gate passed: ${gates.summary}.`);
    }
    if (risk.level === 'medium') {
      appendEvent(root, { ...baseEvent, outcome: 'allowed-medium-risk' });
      recordRunHook(root, baseEvent, 'allowed-medium-risk');
      updateHookState(root, baseEvent);
      recordTouchedFiles(root, payload);
      return allowHook('OpenPrd 检测到写入动作。本轮写入完成后、最终回复前，请针对实际 touched code files 运行 openprd dev-check . <file...>；如出现需要关注的文件，最终回复必须以 **后续建议** 为标题，直接复用 dev-check 生成的 Markdown 表格，说明影响对象、关注程度、规模信号、预警原因、本次处理结果和后续建议，并按 🔴 → 🟠 → 🟡 排序；不要把“关注程度”列改写成纯 emoji，必须保留例如“🟠 中风险｜建议优先关注”这类完整标签；如果你改写了“预警原因 / 本次处理结果 / 后续建议”，先用 `node scripts/dev-check-wrapup-copy.mjs --validate` 校验每格不超过 20 字；若报错，按提示缩短后重试；如涉及界面视觉且已有参考效果图并进入实现阶段，阶段性完成后运行 openprd visual-compare . --reference <效果图> --actual <实现截图> 并查看 JPG 对比图；若局部细节更重要，再补 openprd visual-compare . --board <focus-board.json>；如无参考图但改动界面，确认已先截修改前截图，并在完成后运行 openprd visual-compare . --before <修改前截图> --after <修改后截图> 查看 JPG 自检图；若并行试了多个优化方向，再补 openprd visual-compare . --board <parallel-board.json>；发现可沉淀项时不要中途打断任务，代码扩展识别这类白名单工具补全会自动应用并记录，用户偏好、项目协作规矩和 OpenPrd 默认行为留到收工时用 openprd grow . --review 集中确认；维护 OpenPrd 本身且涉及配置类能力时，先判断是否应纳入 openprd grow；声明就绪前，请同步维护 docs/basic、文件说明书、文件夹 README，以及相关 OpenPrd change/task 状态；如果涉及后端、脚本、Agent、工具链、服务或数据处理变更，还要把 CLI 与 API 视为同级接入面并更新 docs/basic/backend-structure.md。');
    }
    return allowHook();
  }

  if (eventName === 'PostToolUse') {
    const text = payloadText(payload);
    const failed = /command not found|no such file|permission denied|failed|error|exception/i.test(text);
    if (!failed) {
      return allowHook();
    }
    appendEvent(root, { ...baseEvent, outcome: failed ? 'tool-failure-detected' : 'tool-complete' });
    recordRunHook(root, baseEvent, failed ? 'tool-failure-detected' : 'tool-complete');
    updateHookState(root, baseEvent);
    if (failed && !duplicate) {
      return allowHook(toolFailureMessage(classifyToolFailure(text)));
    }
    return allowHook();
  }

  if (eventName === 'Stop') {
    appendEvent(root, { ...baseEvent, outcome: 'stop-check' });
    recordRunHook(root, baseEvent, 'stop-check');
    updateHookState(root, baseEvent);
    if (hookSuppressed(root)) {
      return allowHook();
    }
    const turnState = readTurnState(root);
    const stopIntent = analyzePromptIntent(turnState.prompt || '');
    const weappGate = readNamedGate(root, 'weapp', sessionId);
    if (weappGate?.active && stopIntent.weappValidationRequest) {
      return allowHook([
        'OpenPrd 在本轮收工回顾里发现小程序运行态验证仍未完成。',
        '如果这次任务是用户明确要求的小程序实测、复现、截图、抓日志/网络，或你已经承诺提供运行态证据，请补齐本地运行态验证；补齐时默认沿用当前小程序运行态或开发者工具会话连续验证，不要为了验证自动重开应用；否则不要把普通代码改动默认升级成小程序实测。',
        '如果当前环境没有可用的小程序本地验证工具，请明确说明未完成运行态验证，不要假定工具已安装。',
      ].join('\n'));
    }
    if (stopIntent.visualMockupRequest && (!Array.isArray(turnState.touchedFiles) || turnState.touchedFiles.length === 0)) {
      return allowHook([
        'OpenPrd 生图事实对齐提醒：如果这轮要汇报图片结果、失败或限流，请确保它来自一次实际的 `imagegen` 调用。',
        '未实际调用 `imagegen` 前，不要声称“生图限流”“生图失败”或“已经生成图片结果”；若本轮还没调用，请如实说明仍未开始或尚未完成生图。',
      ].join('\n'));
    }
    const devCheckMessage = devCheckWrapUpMessage(root, turnState);
    if (devCheckMessage) {
      return allowHook(devCheckMessage);
    }
    if (Array.isArray(turnState.touchedFiles) && turnState.touchedFiles.length > 0) {
      const review = runOpenPrd(['quality', '.', '--learn', '--review', '--from', '.openprd/harness/turn-state.json', '--json'], root);
      if (review.ok) {
        try {
          const parsedReview = JSON.parse(review.stdout);
          if (
            parsedReview
            && !parsedReview.skipped
            && parsedReview.ok !== false
            && parsedReview.candidateId
            && parsedReview.status === 'pending-review'
            && parsedReview.candidateId !== turnState.lastKnowledgePromptCandidateId
          ) {
            writeTurnState(root, {
              ...turnState,
              lastKnowledgePromptCandidateId: parsedReview.candidateId,
              lastKnowledgePromptAt: now(),
            });
            const userFacingMessage = String(parsedReview.userFacingExperience?.message || '').trim();
            return allowHook([
              'OpenPrd 在本轮收工回顾里发现了一条适合沉淀为当前项目经验的内容。',
              '请在最终回复结尾主动用下面这段结构化人话询问用户，不要改成内部术语，也不要提 Draft Skill、candidate、promote、路径或命令：',
              userFacingMessage || [
                '这次我观察到一个以后可能重复出现的情况：',
                '这次任务里已经形成了一种以后可能重复出现的处理方式。',
                '',
                '我计划保留一条项目经验：',
                '以后再遇到类似任务时，我会优先复用这次已经验证过的处理顺序和注意事项。',
                '',
                '以后如果再遇到类似任务，我会优先按这套经验来处理，减少重复解释和重复判断。',
                '这条经验只会保留在当前项目里。',
                '要我把它一起保留下来吗？',
              ].join('\n'),
              parsedReview.suggestedLearnCommand
                ? `如果用户明确同意，再执行：${parsedReview.suggestedLearnCommand}`
                : null,
              `如果用户明确表示暂不保留，执行：openprd knowledge reject --path . --id ${parsedReview.candidateId} --reason "<用户原话>"`,
              `如果用户表示先不处理、以后再说，执行：openprd knowledge archive --path . --id ${parsedReview.candidateId} --reason "<用户原话>"`,
            ].filter(Boolean).join('\n'));
          }
        } catch {}
      }
    }
    const run = runOpenPrd(['run', '.', '--context', '--json'], root);
    if (run.ok) {
      try {
        const parsed = JSON.parse(run.stdout);
        const command = parsed?.recommendation?.command || '';
        if (command && !/openprd\s+next\s+\./.test(command)) {
          return {
            continue: true,
            systemMessage: `OpenPrd still has a hook-driven next action:\n${parsed.recommendation.title}\nSuggested command: ${command}`,
          };
        }
      } catch {}
    }
  }

  appendEvent(root, { ...baseEvent, outcome: 'noop' });
  recordRunHook(root, baseEvent, 'noop');
  updateHookState(root, baseEvent);
return allowHook();
}
