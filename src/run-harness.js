import fs from 'node:fs/promises';
import { appendJsonl, appendText, cjoin, exists, readJson, writeJson, writeText } from './fs-utils.js';
import { timestamp } from './time.js';

const OPENPRD_HARNESS_DIR = cjoin('.openprd', 'harness');
const OPENPRD_HARNESS_RUN_STATE = cjoin(OPENPRD_HARNESS_DIR, 'run-state.json');
const OPENPRD_HARNESS_ITERATIONS = cjoin(OPENPRD_HARNESS_DIR, 'iterations.jsonl');
const OPENPRD_HARNESS_LEARNINGS = cjoin(OPENPRD_HARNESS_DIR, 'learnings.md');
const OPENPRD_HARNESS_LOOP_FEATURE_LIST = cjoin(OPENPRD_HARNESS_DIR, 'feature-list.json');
const OPENPRD_LOOP_REQUIRED_TASK_THRESHOLD = 5;
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
    title: task.title,
    relativePath: task.relativePath,
    lineNumber: task.lineNumber,
    verify: task.metadata?.verify ?? null,
    done: task.metadata?.done ?? null,
    deps: task.metadata?.deps ?? null,
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

function buildRunRecommendation({ changes, taskState, discovery, next, loopFeatureList }) {
  const activeChange = changes?.activeChange ?? null;
  if (taskState?.nextTask) {
    const task = compactTask(taskState.nextTask);
    const totalTasks = Number(taskState.summary?.total ?? taskState.tasks?.length ?? 0);
    const pendingTasks = Number(taskState.summary?.pending ?? 0);
    if (totalTasks > OPENPRD_LOOP_REQUIRED_TASK_THRESHOLD || pendingTasks > OPENPRD_LOOP_REQUIRED_TASK_THRESHOLD) {
      const loopReady = loopFeatureList?.changeId === taskState.changeId && Array.isArray(loopFeatureList.tasks);
      return {
        type: 'loop-task',
        title: `用 Loop 执行 ${task.id}: ${task.title}`,
        command: loopReady
          ? `openprd loop . --run --agent codex --item ${shellQuote(task.id)} --commit`
          : `openprd loop . --plan --change ${shellQuote(taskState.changeId)} && openprd loop . --run --agent codex --item ${shellQuote(task.id)} --commit`,
        verifyCommand: `openprd loop . --verify --item ${shellQuote(task.id)}`,
        reason: `当前变更包含 ${totalTasks} 个任务，超过 ${OPENPRD_LOOP_REQUIRED_TASK_THRESHOLD} 个任务的轻量执行上限；必须按 OpenPrd Loop 拆成独立单任务会话、自测、测试报告和 commit。`,
        changeId: taskState.changeId,
        task,
        coverageItem: null,
        loop: {
          required: true,
          threshold: OPENPRD_LOOP_REQUIRED_TASK_THRESHOLD,
          planned: loopReady,
          totalTasks,
          pendingTasks,
        },
      };
    }
    return {
      type: 'task',
      title: `推进 ${task.id}: ${task.title}`,
      command: `openprd tasks . --change ${shellQuote(taskState.changeId)} --advance --verify --item ${shellQuote(task.id)}`,
      verifyCommand: task.verify ?? `openprd tasks . --change ${shellQuote(taskState.changeId)} --verify --item ${shellQuote(task.id)}`,
      reason: '存在一个依赖已就绪的 OpenPrd 任务。',
      changeId: taskState.changeId,
      task,
      coverageItem: null,
      loop: {
        required: false,
        threshold: OPENPRD_LOOP_REQUIRED_TASK_THRESHOLD,
        totalTasks,
        pendingTasks,
      },
    };
  }
  if (taskState && taskState.summary?.pending === 0 && activeChange) {
    return {
      type: 'change-review',
      title: `校验已完成的变更 ${activeChange}`,
      command: `openprd change . --validate --change ${shellQuote(activeChange)}`,
      verifyCommand: `openprd change . --validate --change ${shellQuote(activeChange)}`,
      reason: '当前激活变更没有待处理的结构化任务。',
      changeId: activeChange,
      task: null,
      coverageItem: null,
    };
  }
  const nextCoverage = discovery?.coverageMatrix?.nextPendingItem;
  if (nextCoverage) {
    const item = compactCoverageItem(nextCoverage);
    return {
      type: 'discovery',
      title: `调研 ${item.title}`,
      command: `openprd discovery . --advance --item ${shellQuote(item.id)} --claim <evidence-backed-claim> --evidence <path>`,
      verifyCommand: 'openprd discovery . --verify',
      reason: '存在一个待处理的 OpenPrd discovery 覆盖项。',
      changeId: activeChange,
      task: null,
      coverageItem: item,
    };
  }
  if (discovery?.coverageMatrix?.summary?.pending === 0 && discovery?.runId) {
    return {
      type: 'discovery-review',
      title: `校验 discovery run ${discovery.runId}`,
      command: 'openprd discovery . --verify',
      verifyCommand: 'openprd discovery . --verify',
      reason: '当前 discovery run 没有待处理覆盖项。',
      changeId: activeChange,
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
    changeId: activeChange,
    task: null,
    coverageItem: null,
  };
}

async function buildRunContext(projectRoot, dependencies) {
  const {
    listOpenPrdChangesWorkspace,
    listOpenSpecTaskWorkspace,
    nextWorkspace,
    resumeOpenSpecDiscoveryWorkspace,
    validateWorkspace,
  } = dependencies;
  await ensureRunHarness(projectRoot);
  const runState = await readRunState(projectRoot);
  const validation = await validateWorkspace(projectRoot)
    .then(({ report }) => report)
    .catch((error) => ({
      valid: false,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings: [],
      checks: [],
    }));
  const next = await nextWorkspace(projectRoot).catch(() => null);
  const changes = await listOpenPrdChangesWorkspace(projectRoot).catch(() => null);
  const activeChange = changes?.activeChange ?? null;
  const taskState = activeChange
    ? await listOpenSpecTaskWorkspace(projectRoot, { change: activeChange }).catch(() => null)
    : null;
  const discovery = await resumeOpenSpecDiscoveryWorkspace(projectRoot).catch(() => null);
  const loopFeatureList = await readJson(harnessFile(projectRoot, OPENPRD_HARNESS_LOOP_FEATURE_LIST)).catch(() => null);
  const recommendation = buildRunRecommendation({ changes, taskState, discovery, next, loopFeatureList });

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
    activeChange,
    taskSummary: taskState?.summary ?? null,
    nextTask: compactTask(taskState?.nextTask ?? null),
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
    recommendation,
    files: {
      runState: OPENPRD_HARNESS_RUN_STATE,
      iterations: OPENPRD_HARNESS_ITERATIONS,
      learnings: OPENPRD_HARNESS_LEARNINGS,
    },
  };

  await writeRunState(projectRoot, {
    ...runState,
    lastContextAt: context.generatedAt,
    lastRecommendation: recommendation,
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

async function verifyRunWorkspace(projectRoot, dependencies) {
  const {
    checkStandardsWorkspace,
    validateOpenSpecChangeWorkspace,
    validateWorkspace,
    verifyOpenSpecDiscoveryWorkspace,
  } = dependencies;
  const context = await buildRunContext(projectRoot, dependencies);
  const standards = await checkStandardsWorkspace(projectRoot);
  const validation = await validateWorkspace(projectRoot).then(({ report }) => report);
  const checks = [
    { name: 'standards', ok: standards.ok, errors: standards.errors ?? [] },
    { name: 'validate', ok: validation.valid, errors: validation.errors ?? [] },
  ];
  if (context.activeChange) {
    const change = await validateOpenSpecChangeWorkspace(projectRoot, { change: context.activeChange });
    checks.push({ name: 'change', ok: change.ok, errors: change.errors ?? [] });
  }
  if (context.discovery) {
    const discovery = await verifyOpenSpecDiscoveryWorkspace(projectRoot);
    checks.push({ name: 'discovery', ok: discovery.ok, errors: discovery.verification.errors ?? [] });
  }
  const ok = checks.every((check) => check.ok);
  await appendJsonl(harnessFile(projectRoot, OPENPRD_HARNESS_ITERATIONS), {
    version: 1,
    at: timestamp(),
    type: 'verify',
    ok,
    checks: checks.map((check) => ({ name: check.name, ok: check.ok, errors: check.errors.length })),
  });
  return {
    ok,
    action: 'run-verify',
    projectRoot,
    context,
    checks,
    errors: checks.flatMap((check) => check.errors.map((error) => `${check.name}: ${error}`)),
  };
}

async function runWorkspaceImpl(projectRoot, options = {}, dependencies = {}) {
  if (options.recordHook) {
    return recordRunHook(projectRoot, options);
  }
  if (options.verify) {
    return verifyRunWorkspace(projectRoot, dependencies);
  }
  return buildRunContext(projectRoot, dependencies);
}


function createRunWorkspace(dependencies) {
  return function runWorkspace(projectRoot, options = {}) {
    return runWorkspaceImpl(projectRoot, options, dependencies);
  };
}

export { createRunWorkspace };
