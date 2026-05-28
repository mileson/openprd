import fs from 'node:fs';
import path from 'node:path';
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
  const suppressExtraConfirmation = Boolean(intent?.noReviewRequested || intent?.noConfirmationRequested);
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
  const args = ['run', '.', '--context', '--json'];
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

function renderRunContextText(result) {
  const lines = [
    'OpenPrd 运行上下文',
    '项目: ' + result.projectRoot,
    '验证: ' + (result.validation?.valid ? '通过' : '失败'),
  ];
  if (result.activeChange) {
    lines.push('激活变更: ' + result.activeChange);
  }
  if (result.lane?.summary) {
    lines.push('执行流: ' + result.lane.summary);
  }
  if (result.taskSummary) {
    lines.push('任务: ' + result.taskSummary.completed + '/' + result.taskSummary.total + ' 完成，' + result.taskSummary.pending + ' 待处理，' + result.taskSummary.blocked + ' 阻塞');
  }
  if (result.discovery) {
    lines.push('持续发现: ' + result.discovery.runId + ' 已覆盖 ' + result.discovery.summary.covered + '/' + result.discovery.summary.total + '，待处理 ' + result.discovery.summary.pending);
  }
  const recommendation = result.recommendation || {};
  lines.push('下一步类型: ' + recommendation.type);
  lines.push('下一步: ' + recommendation.title);
  lines.push('原因: ' + recommendation.reason);
  lines.push('建议只读命令: ' + recommendation.command);
  if (recommendation.preparationCommand || recommendation.executionCommand || recommendation.commitCommand) {
    lines.push('执行门槛: 仅当用户当前明确要求开发、实现、继续任务、深度调研、深度对标、复刻落地或提交时使用；规划、梳理、分析、审查类请求保持只读。');
  }
  if (recommendation.preparationCommand) {
    lines.push('准备命令: ' + recommendation.preparationCommand);
  }
  if (recommendation.executionCommand) {
    lines.push('执行命令: ' + recommendation.executionCommand);
  }
  if (recommendation.commitCommand) {
    lines.push('提交命令: ' + recommendation.commitCommand);
  }
  lines.push('验证命令: ' + recommendation.verifyCommand);
  lines.push('状态文件: ' + (result.files?.runState || '.openprd/harness/run-state.json'));
  return lines.filter(Boolean).join('\n');
}

function analyzePromptIntent(prompt) {
  const text = String(prompt || '').trim();
  const normalized = text.toLowerCase();
  const continuationSessionId = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0] ?? null;
  const continuationTaskHandle = text.match(/\b[a-z0-9._-]+:T\d{3}\.\d{2}:[a-z0-9._-]+\b/i)?.[0] ?? null;
  const continuationWorkUnitId = text.match(/\bwu-[a-z0-9._-]+\b/i)?.[0] ?? null;
  const continuationRequest = /(继续(这个|这条|当前)?(对话|任务|会话|记录|历史)?|续做|接着做|继续执行|继续推进)/i.test(text)
    || Boolean(continuationSessionId || continuationTaskHandle || continuationWorkUnitId);
  const githubRepoPattern = /(?:https?:\/\/)?github\.com\/[^\s/]+\/[^\s/#?]+|(?:^|[\s(])[\w.-]+\/[\w.-]+(?=$|[\s)#?])/i;
  const internalOpenPrdExecution = /^#\s*OpenPrd\s+长程单任务执行会话/m.test(text)
    || /模式:\s*loop-run\b/i.test(text)
    || /模式:\s*loop-finish\b/i.test(text);
  const productPatterns = [
    /新增/,
    /增加/,
    /新建/,
    /我希望/,
    /用户反馈/,
    /需求/,
    /功能/,
    /模块/,
    /页面/,
    /界面/,
    /视觉/,
    /入口/,
    /流程/,
    /编排/,
    /一站式/,
    /体验/,
    /信息架构/,
    /团队搭建/,
    /agent\s*市场/i,
    /skill\s*library/i,
    /UI/i,
    /cli\s*库/i,
    /workflow/i,
    /wizard/i,
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
  const complexScopePatterns = [
    /新增|新建|模块|流程|编排|一站式|权限|审批|团队|agent\s*市场|AI/i,
  ];
  const explicitExecutionPatterns = [
    /直接(帮我|给我)?(改|做|实现|落地|修|修复|处理|解决)/,
    /如果.{0,24}(定位|确认|找到).{0,12}(原因|根因).{0,24}直接.{0,12}(帮我|给我)?(修|修复|改|处理|解决)/,
    /开始(改|做|实现|开发|落地)/,
    /请(直接)?(实现|落地|修改|修复|处理|解决)/,
    /可以(执行|落地|实现|开发)/,
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
  const promptReviewCommand = parseReviewMarkCommand(text);
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
    /规划/,
    /分析/,
    /梳理/,
    /评估/,
    /怎么改/,
    /预计动哪些文件/,
    /review/i,
    /explain/i,
  ];
  const bugfixOrDiagnostic = /诊断包|报错|错误|异常|崩溃|bug|问题|排查|定位|根因|复现|日志|故障/i.test(text)
    || /失败.{0,20}(原因|根因|排查|定位|修|修复|处理|解决)|(?:原因|根因|排查|定位).{0,20}失败/.test(text);
  const simpleConcrete = text.length <= 80
    && simpleConcretePatterns.some((pattern) => pattern.test(text))
    && !complexScopePatterns.some((pattern) => pattern.test(text));
  const explicitExecution = internalOpenPrdExecution || continuationRequest || explicitExecutionPatterns.some((pattern) => pattern.test(text));
  const implementationConfirmation = implementationConfirmationPatterns.some((pattern) => pattern.test(text));
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
  const visualReview = /效果图|实现截图|视觉对比|视觉评审|对标效果图|复刻/i.test(text);
  const directBugfixExecution = explicitExecution && bugfixOrDiagnostic;
  const publicRepoResearchRequest = githubRepoPattern.test(text)
    && /(github|仓库|repo|项目|参考|对标|复刻|review|学习|架构|模块|流程|构建|测试|扩展点)/i.test(text);
  const externalTechResearchRequest = /(第三方|library|framework|sdk|api|mcp|cli|依赖|包|版本|迁移|弃用|官方文档|参数|返回值|生命周期)/i.test(text)
    && /(怎么用|用法|配置|限制|版本|迁移|报错|集成|接入|最佳实践|示例|安装|参数|返回值|生命周期)/i.test(text);
  const skillWorkflowEditRequest = /SKILL\.md|AGENTS\.md/i.test(text)
    || (/(^|[^a-z])(skill|skills)([^a-z]|$)/i.test(text) && /(创建|修改|优化|重构|合并|拆分|更新|工作流|workflow|流程|路由|router|提示词|规则)/i.test(text))
    || (/AGENTS\.md/i.test(text) && /(创建|修改|优化|精简|收薄|重构|更新)/i.test(text));
  const secretsRequest = /(api\s*key|token|secret|credential|password|凭证|密钥|密码|账号信息|第三方服务凭证|个人信息|登录信息)/i.test(text);
  const weappValidationRequest = /(微信小程序|miniprogram|weapp|微信开发者工具|weapp-dev-mcp)/i.test(text);
  const browserSafetyRequest = /(computer use|browser use|浏览器|browser|网页|页面|窗口|标签页|tab|profile)/i.test(text)
    && /(点击|输入|提交|登录|注销|退出|支付|关闭|send|submit|type|click|switch account|切换账号)/i.test(text);
  const productCopyRequest = /(文案|copy|错误文案|空状态|成功提示|按钮文案|提示语|toast|placeholder|设置项文案|国际化|i18n|locales|translations|localizable)/i.test(text);
  const requiresIntake = !internalOpenPrdExecution
    && productPatterns.some((pattern) => pattern.test(text))
    && !tinyEditPatterns.some((pattern) => pattern.test(text))
    && !simpleConcrete
    && !visualMockupRequest
    && !directBugfixExecution
    && !(readOnly && !explicitExecution);
  return {
    promptText: text,
    requiresIntake,
    explicitExecution,
    confirmation,
    implementationConfirmation,
    noReviewRequested,
    noConfirmationRequested,
    reviewDecision,
    reviewCommand: promptReviewCommand,
    readOnly,
    simpleConcrete,
    visualMockupRequest,
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
      || explicitExecution
      || confirmation
      || readOnly
      || visualMockupRequest
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
    reason: 'new product/module/workflow requirement',
    requiredFlow: ['clarify', 'capture', 'synthesize', 'review', 'change-generate', 'tasks', 'implementation'],
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
    status: 'needs-weapp-mcp-validation',
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
  let nextStep = 'implementation-ready';
  let reason = 'PRD 评审与任务拆解已就绪；如果当前需求原本就明确要求实现，可直接继续执行，否则等待一句明确的执行指令。';
  if (!review.versionId) {
    nextStep = 'prd-review-required';
    reason = '当前还没有本轮最新 PRD 评审产物，先 synthesize 出稳定 review artifact，再等待用户评审。';
  } else if (review.status === 'needs-revision') {
    nextStep = 'prd-review-required';
    reason = '当前 PRD review artifact 已标记为需要调整，不能继续生成 change 或实现。';
  } else if (review.status !== 'confirmed') {
    nextStep = reviewPolicyAllowsSilentRecord(approvalPolicy)
      ? 'review-recording-required'
      : 'prd-review-required';
    reason = reviewPolicyAllowsSilentRecord(approvalPolicy)
      ? '当前稳定 PRD 评审稿已经生成。由于用户一开始已明确要求直接做且不再额外评审/确认，本轮可以直接记录这版稳定 review artifact，再继续 change 和 tasks。'
      : '当前 PRD review artifact 还没有被用户确认，不能把实现授权当成 review 确认。';
  } else if (!activeChange) {
    nextStep = 'change-generation-required';
    reason = 'PRD 评审已确认，下一步先生成 OpenPrd change。';
  } else if (!hasTaskBreakdown) {
    nextStep = 'task-breakdown-required';
    reason = 'OpenPrd change 已存在，但还缺任务拆解，不能直接进入实现。';
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
  return updateRequirementGate(root, {
    status: extra.status ?? progress.nextStep,
    confirmationPreview: preview(prompt, 500),
    reviewActionAuthorization,
  }, sessionId);
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
    /openprd\s+capture\b/i,
    /openprd\s+classify\b/i,
    /openprd\s+interview\b/i,
    /openprd\s+synthesize\b/i,
    /openprd\s+diagram\b/i,
    /openprd\s+review-presentation\b/i,
    /openprd\s+standards\s+.*--verify/i,
    /openprd\s+quality\s+.*--verify/i,
    /openprd\s+doctor\b/i,
  ];
  if (alwaysAllowed.some((pattern) => pattern.test(text))) {
    return true;
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
      status: 'validated-through-weapp-mcp',
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
    '当前任务涉及微信小程序测试、验证、截图、日志、网络请求、微信开发者工具自动化，或可能影响小程序运行态的代码修改。',
    '请先使用 `weapp-dev-mcp` skill，并通过本地 `weapp-dev-mcp` MCP 完成运行态验证；未通过本地 MCP 实际验证时，不要宣称“小程序已验证”。',
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
  ].filter(Boolean).join('\n');
}

function runOpenPrd(args, cwd) {
  const command = process.env.OPENPRD_CLI || 'openprd';
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
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
    return `run-verify: taskReady=yes, workspaceReady=no${workspaceWarnings.length ? ` (${workspaceWarnings[0]})` : ''}`;
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
      details: [runCheck.summary, ...(runCheck.warnings ?? [])].filter(Boolean),
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
      'Use Codex native Image 2 to generate the image; keep implementation, PRD review, and visual-compare for later explicit confirmation.',
    ].join('\n');
  }
  const status = gateBlocksImplementation ? 'active' : 'opened';
  return [
    'OpenPrd requirement intake gate: ' + status + '.',
    'This prompt looks like an L2 product/module/workflow requirement. Do not edit implementation files yet.',
    reviewPolicyAllowsSilentRecord(approvalPolicy)
      ? 'Decision-point policy: clarify the requirement, capture user answers, synthesize the PRD, record the exact current stable review artifact, generate the OpenPrd change, prepare the task breakdown, then implement within the confirmed scope.'
      : 'Decision-point policy: clarify the requirement, capture user answers, synthesize the PRD, wait for a human decision on the stable review artifact, generate the OpenPrd change, prepare the task breakdown, then implement within the confirmed scope.',
    reviewPolicyAllowsSilentRecord(approvalPolicy)
      ? 'This lane is in silent-record mode because the user upfront asked to implement without another review stop. You may record only the exact current version, digest, and work unit.'
      : 'Review-artifact confirmation and implementation authorization are different gates: do not treat "可以开做" as permission to run openprd review --mark confirmed.',
    'If the original request already asked to implement, execution can continue once the active approval policy and tasks are ready; otherwise wait for a clear execution request.',
    'Recommended next action: run openprd clarify ., summarize target, scope, out-of-scope, and acceptance in chat, then ask for confirmation. Do not open a clarification HTML page; the formal HTML review happens after synthesize/review.',
  ].join('\n');
}

function visualMockupMessage(intent) {
  if (!intent?.visualMockupRequest) {
    return null;
  }
  return [
    '当前用户要的是图片内容生成，例如图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿或 mockup。',
    '默认直接调用 Codex 原生 Image 2 生成图片；除非用户明确指定 HTML、SVG、CSS、Canvas、代码稿或可编辑矢量/source artifact，不要改用临时 HTML/SVG/CSS 再截图。',
    '对 logo、icon、avatar、badge 等开发素材，如果用户没有明确要求 mockup、场景图、设备框、卡片承载、名片/包装展示或参考界面复刻，默认按独立素材输出（standalone asset）处理：使用全画布单主体，不额外添加 UI frame、卡片、设备壳、名片、桌面陈列、手持实拍或其他展示容器。',
    '只有当用户明确要求 mockup、场景化效果图、容器化呈现，或参考图本身就包含这些承载结构时，才生成对应的容器或场景。',
    'OpenPrd review.html 只用于需求评审，visual-compare 只用于实现阶段已有参考图后的实现截图对比。',
  ].join('\n');
}

function codexConfirmationReplyRule() {
  return 'Codex UI 规则: 只有当前 approval policy 仍然需要人类对稳定 review artifact 做决定时，才在 final answer 里停下来请求确认；如果当前 lane 已进入 silent-record 策略，就继续记录精确 review artifact 并推进，不要为了同一个需求再额外停顿。';
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
    'For UI or visual work with an existing reference image, capture the implemented UI and run openprd visual-compare . --reference <effect-image> --actual <implementation-screenshot>; inspect the generated JPG before claiming the visual work is complete.',
  ].join('\n');
}

function currentRequirementStatusLine(gate, progress) {
  if (gate?.status === 'review-confirmation-authorized') {
    return '用户刚刚确认了当前稳定 PRD 评审稿；本回合只允许记录这一个版本的 review 状态，不能把它直接扩展成实现确认。';
  }
  if (gate?.status === 'review-recording-authorized') {
    return '当前稳定 PRD 评审稿已经按 silent-record 策略授权记录；只允许写回这一个版本，随后继续 change 和 tasks。';
  }
  switch (progress?.nextStep) {
    case 'prd-review-required':
      return progress?.review?.versionId
        ? '当前卡点: 先等用户确认当前稳定 PRD 评审稿；不要把“继续做”或“开落地吧”当成 review 确认。'
        : '当前卡点: 先 synthesize 出本轮稳定 PRD 评审稿，再等待用户评审。';
    case 'review-recording-required':
      return '当前卡点: 稳定 PRD 评审稿已经生成；按当前 approval policy 可直接记录这版 review artifact，不需要再额外追问用户。';
    case 'change-generation-required':
      return '当前卡点: PRD 评审已确认，下一步先生成 OpenPrd change。';
    case 'task-breakdown-required':
      return '当前卡点: change 已存在，但还缺任务拆解，不能直接进入实现。';
    case 'implementation-ready':
      return '当前卡点: review 已确认且 tasks 已就绪；如果当前需求原本就明确要求实现，可直接进入实现，否则等待一句明确的执行指令。';
    default:
      return '当前卡点: 继续按“澄清 -> 评审 -> change -> tasks -> 实现”的顺序推进。';
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
    '当前输入看起来是一个 L2 新产品、模块或流程需求。本轮只围绕这个新需求推进需求入口，不自动继续历史 active change。',
    prompt ? '本轮需求: ' + prompt : '',
    gate?.intakeMode === 'deep-reflection'
      ? '需求入口: 先运行需求自省，再输出对话内澄清摘要或简短清单。'
      : '需求入口: 先做轻量项目映射，再确认影响点和验收方式。',
    reviewPolicyAllowsSilentRecord(approvalPolicy)
      ? '当前 approval policy: decision-points / silent-record。保留稳定 review artifact，但在版本、digest、work unit 精确匹配时不再额外停下来追问用户。'
      : '当前 approval policy: decision-points / human-review。稳定 review artifact 仍需要一次明确的人类决策。',
    currentRequirementStatusLine(gate, progress),
    reviewPolicyAllowsSilentRecord(approvalPolicy)
      ? 'Decision-point order: clarify the requirement, capture user answers, synthesize the PRD, record the exact stable review artifact, generate the OpenPrd change, prepare the task breakdown, then implement within the confirmed scope.'
      : 'Decision-point order: clarify the requirement, capture user answers, synthesize the PRD, wait for a human review decision on the stable artifact, generate the OpenPrd change, prepare the task breakdown, then implement within the confirmed scope.',
    'Recommended next action: run openprd clarify ., then answer in chat within roughly ten sentences: target, scope, out-of-scope, acceptance, and ask for confirmation. Do not open clarification HTML; use review.html only after synthesize/review.',
  ];
  if (isImplementationAdvanceIntent(intent)) {
    lines.splice(2, 1, gate?.active
      ? '用户表达了继续实现的意图；但在 review 评审、change 和任务拆解走完之前，仍然阻断实现写入。'
      : '用户已确认当前需求可以进入执行范围；仍需保持实现范围与已确认的需求入口一致。');
  }
  lines.push(codexConfirmationReplyRule());
  return lines.filter(Boolean).join('\n');
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
        'OpenPrd 上下文只是建议，不是自动执行指令。请先判断用户当前意图。',
        visualMockupMessage(intent),
        'L0 小修直接处理并事后说明，L1 中等改动先给对话内 mini-plan，L2 新产品、模块或流程需求在改代码前必须先完成需求入口：澄清、评审、任务拆解。只有在用户原始意图已明确要求实现，或后续明确发出执行指令时，才进入实现。',
        '如果用户只是要求看看、规划、分析、审查、解释影响或列出文件，请保持只读并基于证据回答；不要运行 OpenPrd loop、任务推进、discovery 推进、commit 或其他写入命令。',
        '只有当用户当前明确要求开发、实现、修复、继续任务、深度调研、对标复刻或提交时，才运行 openprd loop --run、openprd tasks --advance、openprd discovery --advance、commit/push 等执行命令。',
        '代码修改完成后、最终回复前，针对本轮实际 touched code files 运行 openprd dev-check . <file...>；attention 需说明局部职责，warning 需判断本轮是否扩大职责，扩大则先重构/拆分/解耦并复查，窄修暂不拆时说明原因和后续拆分建议。',
        '涉及界面、页面、视觉、样式或前端体验，且已经有效果图/设计稿/用户给图并进入实现阶段时，阶段性完成后必须截图并运行 openprd visual-compare . --reference <效果图> --actual <实现截图>；默认输出 JPG 到 .openprd/harness/visual-reviews/。查看合成图后继续对标，直到没有明显视觉差异。',
        '发现配置缺口、未知代码扩展名或用户偏好时，先运行 openprd grow . --review；共享规则必须经用户确认后再 apply。',
        '维护 OpenPrd 本身且涉及配置类能力时，先判断是否应纳入 openprd grow；高置信可成长默认纳入，不确定则主动询问用户。',
        '涉及后端、脚本、Agent、工具链、服务或数据处理变更时，把 CLI 与 API 视为同级接入面：同步检查命令入口、参数、输出契约、help/doctor/dry-run/status 与接口协议、返回结构、身份边界是否受影响，并更新 docs/basic/backend-structure.md 或明确写不适用原因。',
        '声明实现就绪前，先运行 openprd standards . --verify 和 openprd run . --verify。',
      ].filter(Boolean).join('\n');
    }
    return [
      run.stdout,
      gateMessage,
      'OpenPrd 上下文只是建议，不是自动执行指令。请先判断用户当前意图。',
      visualMockupMessage(intent),
      'L0 小修直接处理并事后说明，L1 中等改动先给对话内 mini-plan，L2 新产品、模块或流程需求在改代码前必须先完成需求入口：澄清、评审、任务拆解。只有在用户原始意图已明确要求实现，或后续明确发出执行指令时，才进入实现。',
      '如果用户只是要求看看、规划、分析、审查、解释影响或列出文件，请保持只读并基于证据回答；不要运行 OpenPrd loop、任务推进、discovery 推进、commit 或其他写入命令。',
      '只有当用户当前明确要求开发、实现、修复、继续任务、深度调研、对标复刻或提交时，才运行 openprd loop --run、openprd tasks --advance、openprd discovery --advance、commit/push 等执行命令。',
      '代码修改完成后、最终回复前，针对本轮实际 touched code files 运行 openprd dev-check . <file...>；attention 需说明局部职责，warning 需判断本轮是否扩大职责，扩大则先重构/拆分/解耦并复查，窄修暂不拆时说明原因和后续拆分建议。',
      '涉及界面、页面、视觉、样式或前端体验，且已经有效果图/设计稿/用户给图并进入实现阶段时，阶段性完成后必须截图并运行 openprd visual-compare . --reference <效果图> --actual <实现截图>；默认输出 JPG 到 .openprd/harness/visual-reviews/。查看合成图后继续对标，直到没有明显视觉差异。',
      '发现配置缺口、未知代码扩展名或用户偏好时，先运行 openprd grow . --review；共享规则必须经用户确认后再 apply。',
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
    visualMockupMessage(intent),
    'L0 小修直接处理并事后说明，L1 中等改动先给对话内 mini-plan，L2 新产品、模块或流程需求在改代码前必须先完成需求入口：澄清、评审、任务拆解。只有在用户原始意图已明确要求实现，或后续明确发出执行指令时，才进入实现。',
    'OpenPrd 下一步只是建议。规划、分析、审查类请求保持只读；只有用户当前明确要求开发、深度调研、对标复刻或继续任务时才执行。',
    '代码修改完成后、最终回复前，针对本轮实际 touched code files 运行 openprd dev-check . <file...>；attention 需说明局部职责，warning 需判断本轮是否扩大职责，扩大则先重构/拆分/解耦并复查，窄修暂不拆时说明原因和后续拆分建议。',
    '发现配置缺口、未知代码扩展名或用户偏好时，先运行 openprd grow . --review；共享规则必须经用户确认后再 apply。',
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
  if (
    intent.simpleConcrete
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
  if (risk.level === 'high' && shouldRunDoctorForHighRisk(payload)) {
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
              : 'Implementation approval and review confirmation are different gates; do not treat "可以开做" or similar wording as permission to run openprd review --mark confirmed.',
          ].filter(Boolean).join('\n')
        : [
            'OpenPrd blocked a mutating action because the requirement gate is still active.',
            progress?.reason || 'The requirement still needs PRD review, change generation, or task preparation.',
            progress?.nextStep === 'implementation-ready'
              ? 'Do not edit implementation files until the user clearly asks to execute this reviewed requirement.'
              : progress?.nextStep === 'review-recording-required'
                ? 'Do not edit implementation files yet. First record the exact current stable review artifact, then generate change and tasks.'
                : 'Do not edit implementation files until the active approval policy is satisfied and the OpenPrd change has generated tasks.',
            silentRecord
              ? 'Decision-point order: clarify the requirement, capture user answers, synthesize the PRD, record the exact stable review artifact, generate the OpenPrd change, prepare the task breakdown, then implement within the confirmed scope.'
              : 'Decision-point order: clarify the requirement, capture user answers, synthesize the PRD, wait for a human review decision on the stable artifact, generate the OpenPrd change, prepare the task breakdown, then implement within the confirmed scope.',
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
      return allowHook('OpenPrd 检测到写入动作。本轮写入完成后、最终回复前，请针对实际 touched code files 运行 openprd dev-check . <file...>；如出现 warning，判断本轮是否扩大职责，扩大则先重构/拆分/解耦并复查，窄修暂不拆时说明原因和后续拆分建议；如涉及界面视觉且已有参考效果图并进入实现阶段，阶段性完成后运行 openprd visual-compare . --reference <效果图> --actual <实现截图> 并查看 JPG 对比图；如发现配置缺口、未知代码扩展名或用户偏好，运行 openprd grow . --review，确认后再 apply；维护 OpenPrd 本身且涉及配置类能力时，先判断是否应纳入 openprd grow；声明就绪前，请同步维护 docs/basic、文件说明书、文件夹 README，以及相关 OpenPrd change/task 状态；如果涉及后端、脚本、Agent、工具链、服务或数据处理变更，还要把 CLI 与 API 视为同级接入面并更新 docs/basic/backend-structure.md。');
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
    if (weappGate?.active && (stopIntent.weappValidationRequest || (Array.isArray(turnState.touchedFiles) && turnState.touchedFiles.length > 0))) {
      return allowHook([
        'OpenPrd 在本轮收工回顾里发现微信小程序验证仍未完成。',
        '如果这次任务涉及微信小程序测试、验证、截图、日志、网络请求、微信开发者工具自动化，或修改了可能影响运行态的代码，请先用 `weapp-dev-mcp` skill 和本地 `weapp-dev-mcp` MCP 做实际验证。',
        '在没有本地 MCP 验证证据前，不要宣称“小程序已验证”。',
      ].join('\n'));
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
            && parsedReview.candidateId !== turnState.lastKnowledgePromptCandidateId
          ) {
            writeTurnState(root, {
              ...turnState,
              lastKnowledgePromptCandidateId: parsedReview.candidateId,
              lastKnowledgePromptAt: now(),
            });
            return allowHook([
              'OpenPrd 在本轮 Stop 回顾里发现了可沉淀的项目经验草案。',
              `Draft Skill: ${parsedReview.files?.draftSkill ?? 'unknown'}`,
              `候选目录: ${parsedReview.files?.candidateDir ?? 'unknown'}`,
              parsedReview.suggestedLearnCommand
                ? `后续 promote: ${parsedReview.suggestedLearnCommand}`
                : null,
              '在最终回复里说明这次修复是否值得沉淀，以及草案已写到哪里。',
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
