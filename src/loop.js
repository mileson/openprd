import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { listOpenSpecTaskWorkspace, advanceOpenSpecTaskWorkspace, verifyOpenSpecTaskWorkspace } from './openspec/execute.js';
import { validateOpenSpecChangeWorkspace } from './openspec/change-validate.js';

const LOOP_FEATURE_LIST = path.join('.openprd', 'harness', 'feature-list.json');
const LOOP_STATE = path.join('.openprd', 'harness', 'loop-state.json');
const LOOP_PROGRESS = path.join('.openprd', 'harness', 'progress.md');
const LOOP_SESSIONS = path.join('.openprd', 'harness', 'agent-sessions.jsonl');
const LOOP_BOOTSTRAP = path.join('.openprd', 'harness', 'bootstrap.sh');
const LOOP_PROMPTS_DIR = path.join('.openprd', 'harness', 'loop-prompts');
const LOOP_AGENT_VALUES = ['codex', 'claude'];

function cjoin(...parts) {
  return path.join(...parts);
}

function timestamp() {
  return new Date().toISOString();
}

function exists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

async function appendText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, text, 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await readText(filePath));
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function appendJsonl(filePath, value) {
  await appendText(filePath, `${JSON.stringify(value)}\n`);
}

function harnessPath(projectRoot, relativePath) {
  return cjoin(projectRoot, relativePath);
}

function normalizeAgent(agent = 'codex') {
  if (!LOOP_AGENT_VALUES.includes(agent)) {
    throw new Error(`Unsupported loop agent: ${agent}. Use codex or claude.`);
  }
  return agent;
}

function bootstrapScript() {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'ROOT="${1:-$(pwd)}"',
    'cd "$ROOT"',
    'echo "[openprd-loop] workspace: $PWD"',
    'openprd doctor . --tools all',
    'openprd run . --context',
    'git status --short || true',
    '',
  ].join('\n');
}

async function ensureLoopFiles(projectRoot) {
  await fs.mkdir(harnessPath(projectRoot, path.dirname(LOOP_FEATURE_LIST)), { recursive: true });
  await fs.mkdir(harnessPath(projectRoot, LOOP_PROMPTS_DIR), { recursive: true });

  const bootstrapPath = harnessPath(projectRoot, LOOP_BOOTSTRAP);
  if (!(await exists(bootstrapPath))) {
    await writeText(bootstrapPath, bootstrapScript());
    await fs.chmod(bootstrapPath, 0o755).catch(() => {});
  }
  if (!(await exists(harnessPath(projectRoot, LOOP_PROGRESS)))) {
    await writeText(harnessPath(projectRoot, LOOP_PROGRESS), '# OpenPrd Loop Progress\n\n');
  }
  if (!(await exists(harnessPath(projectRoot, LOOP_SESSIONS)))) {
    await writeText(harnessPath(projectRoot, LOOP_SESSIONS), '');
  }
  if (!(await exists(harnessPath(projectRoot, LOOP_STATE)))) {
    await writeJson(harnessPath(projectRoot, LOOP_STATE), {
      version: 1,
      active: true,
      currentTaskId: null,
      completedTaskIds: [],
      lastAgent: null,
      lastSessionAt: null,
      updatedAt: timestamp(),
    });
  }
}

function taskDeps(task) {
  const deps = task.metadata?.deps ?? '';
  return String(deps)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function featureTaskFromOpenSpecTask(task, changeId) {
  const deps = taskDeps(task);
  return {
    id: task.id,
    title: task.title,
    status: task.checked ? 'done' : 'pending',
    changeId,
    sourceTaskId: task.id,
    sourcePath: task.relativePath,
    sourceLine: task.lineNumber,
    deps,
    done: task.metadata?.done ?? null,
    verify: task.metadata?.verify ?? null,
    commitMessage: `Complete ${task.id}: ${task.title}`,
    sessionScope: [
      'Work on this task only.',
      'Do not start the next task in the same agent session.',
      'Keep docs/basic, file manuals, and folder README docs synchronized when touched.',
    ],
    updatedAt: timestamp(),
  };
}

function mergeExistingTaskState(existing, nextTask) {
  if (!existing) return nextTask;
  const preservedStatus = ['running', 'verified', 'done', 'failed', 'blocked'].includes(existing.status)
    ? existing.status
    : nextTask.status;
  return {
    ...nextTask,
    status: nextTask.status === 'done' ? 'done' : preservedStatus,
    lastSessionId: existing.lastSessionId ?? null,
    lastVerifiedAt: existing.lastVerifiedAt ?? null,
    lastCommittedAt: existing.lastCommittedAt ?? null,
    commitSha: existing.commitSha ?? null,
    updatedAt: timestamp(),
  };
}

async function readFeatureList(projectRoot) {
  const filePath = harnessPath(projectRoot, LOOP_FEATURE_LIST);
  if (!(await exists(filePath))) return null;
  return readJson(filePath);
}

function buildLoopSummary(featureList) {
  const tasks = featureList?.tasks ?? [];
  return {
    total: tasks.length,
    done: tasks.filter((task) => task.status === 'done').length,
    pending: tasks.filter((task) => task.status === 'pending').length,
    running: tasks.filter((task) => task.status === 'running').length,
    verified: tasks.filter((task) => task.status === 'verified').length,
    failed: tasks.filter((task) => task.status === 'failed').length,
    blocked: tasks.filter((task) => task.status === 'blocked').length,
  };
}

function dependencyState(task, tasks) {
  const taskById = new Map(tasks.map((item) => [item.id, item]));
  const missing = [];
  const incomplete = [];
  for (const depId of task.deps ?? []) {
    const dep = taskById.get(depId);
    if (!dep) {
      missing.push(depId);
    } else if (dep.status !== 'done') {
      incomplete.push(depId);
    }
  }
  return {
    missing,
    incomplete,
    ready: missing.length === 0 && incomplete.length === 0,
  };
}

function nextLoopTask(featureList, requestedId = null) {
  const tasks = featureList?.tasks ?? [];
  if (requestedId) {
    const task = tasks.find((item) => item.id === requestedId);
    if (!task) {
      throw new Error(`Unknown OpenPrd loop task: ${requestedId}`);
    }
    return { task, dependencyState: dependencyState(task, tasks) };
  }
  for (const task of tasks) {
    if (!['pending', 'failed'].includes(task.status)) continue;
    const state = dependencyState(task, tasks);
    if (state.ready) return { task, dependencyState: state };
  }
  return { task: null, dependencyState: null };
}

async function writeFeatureList(projectRoot, featureList) {
  await writeJson(harnessPath(projectRoot, LOOP_FEATURE_LIST), featureList);
}

async function updateLoopState(projectRoot, patch) {
  const statePath = harnessPath(projectRoot, LOOP_STATE);
  const state = (await exists(statePath)) ? await readJson(statePath) : {};
  const next = {
    version: 1,
    active: true,
    ...state,
    ...patch,
    updatedAt: timestamp(),
  };
  await writeJson(statePath, next);
  return next;
}

function renderProgressEntry(title, lines) {
  return `\n## ${title}\n\n${lines.filter(Boolean).map((line) => `- ${line}`).join('\n')}\n`;
}

function shellJoin(args) {
  return args.map((arg) => {
    const text = String(arg);
    if (/^[a-zA-Z0-9_./:=@-]+$/.test(text)) return text;
    return `'${text.replace(/'/g, "'\\''")}'`;
  }).join(' ');
}

function defaultAgentInvocation(agent, projectRoot, promptPath) {
  if (agent === 'codex') {
    return {
      command: 'codex',
      args: ['exec', '--full-auto', '-C', projectRoot, '-'],
      stdinFile: promptPath,
      display: `codex exec --full-auto -C ${shellJoin([projectRoot])} - < ${shellJoin([promptPath])}`,
    };
  }
  return {
    command: 'claude',
    args: ['--print', '--permission-mode', 'auto', '--output-format', 'text'],
    stdinFile: promptPath,
    display: `claude --print --permission-mode auto --output-format text < ${shellJoin([promptPath])}`,
  };
}

function renderLoopPrompt({ agent, projectRoot, featureList, task, dependency, mode }) {
  return [
    '# OpenPrd Long-Running Agent Session',
    '',
    `Agent: ${agent}`,
    `Mode: ${mode}`,
    `Project: ${projectRoot}`,
    `Change: ${task.changeId}`,
    `Task: ${task.id} ${task.title}`,
    '',
    '## Harness Contract',
    '',
    'You are running one isolated OpenPrd loop session. This session has no assumed memory from previous sessions.',
    'Use the project files and Git history as the source of continuity.',
    '',
    '## Required Startup',
    '',
    '1. Read `AGENTS.md` and follow the OpenPrd managed block.',
    '2. Run `.openprd/harness/bootstrap.sh .` if available.',
    '3. Inspect `git status --short` and do not overwrite unrelated user work.',
    '4. Read `.openprd/harness/feature-list.json`, `.openprd/harness/progress.md`, and this task source file.',
    '',
    '## Single Task Boundary',
    '',
    `Only implement task ${task.id}: ${task.title}`,
    `Done condition: ${task.done ?? 'not specified'}`,
    `Verify command: ${task.verify ?? 'not specified'}`,
    `Dependencies ready: ${dependency?.ready ? 'yes' : 'no'}`,
    dependency?.missing?.length ? `Missing dependencies: ${dependency.missing.join(', ')}` : '',
    dependency?.incomplete?.length ? `Incomplete dependencies: ${dependency.incomplete.join(', ')}` : '',
    `Source: ${task.sourcePath}:${task.sourceLine}`,
    '',
    'Do not begin the next task. If you discover the task is too broad, split it in the task file and stop after the smallest useful slice.',
    '',
    '## Required Finish',
    '',
    '1. Run the task verify command.',
    '2. Run `openprd run . --verify`.',
    '3. Leave a concise final summary with changed files and verification results.',
    '4. If this prompt is used manually, finish with:',
    `   openprd loop . --finish --item ${task.id} --commit --message ${JSON.stringify(task.commitMessage)}`,
    '',
    '## Feature List Snapshot',
    '',
    JSON.stringify({
      version: featureList.version,
      changeId: featureList.changeId,
      summary: buildLoopSummary(featureList),
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        deps: task.deps,
        done: task.done,
        verify: task.verify,
      },
    }, null, 2),
    '',
  ].filter((line) => line !== '').join('\n');
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: Boolean(options.shell),
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => resolve({ ok: false, status: null, stdout, stderr, error: error.message }));
    child.on('close', (status) => resolve({ ok: status === 0, status, stdout, stderr }));
    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}

async function gitCommit(projectRoot, message) {
  const status = await runCommand('git', ['status', '--porcelain'], { cwd: projectRoot });
  if (!status.ok) {
    return { ok: false, skipped: false, message: 'git status failed', status };
  }
  if (!status.stdout.trim()) {
    return { ok: true, skipped: true, message: 'No git changes to commit.' };
  }
  const add = await runCommand('git', ['add', '-A'], { cwd: projectRoot });
  if (!add.ok) {
    return { ok: false, skipped: false, message: 'git add failed', add };
  }
  const commit = await runCommand('git', ['commit', '-m', message], { cwd: projectRoot });
  if (!commit.ok) {
    return { ok: false, skipped: false, message: 'git commit failed', commit };
  }
  const rev = await runCommand('git', ['rev-parse', '--short', 'HEAD'], { cwd: projectRoot });
  return {
    ok: true,
    skipped: false,
    message: 'committed',
    sha: rev.stdout.trim() || null,
    commit,
  };
}

export async function initLoopWorkspace(projectRoot, options = {}) {
  await ensureLoopFiles(projectRoot);
  const featureList = (await readFeatureList(projectRoot)) ?? {
    version: 1,
    generatedAt: timestamp(),
    updatedAt: timestamp(),
    projectRoot,
    changeId: options.change ?? null,
    policy: {
      oneTaskPerSession: true,
      requireVerify: true,
      requireCommit: true,
      continuity: 'files-and-git-history',
    },
    source: 'openprd loop init',
    tasks: [],
  };
  await writeFeatureList(projectRoot, featureList);
  await appendText(harnessPath(projectRoot, LOOP_PROGRESS), renderProgressEntry(timestamp(), [
    'Loop harness initialized.',
    `Agent default: ${normalizeAgent(options.agent ?? 'codex')}.`,
  ]));
  return {
    ok: true,
    action: 'loop-init',
    projectRoot,
    files: {
      featureList: LOOP_FEATURE_LIST,
      loopState: LOOP_STATE,
      progress: LOOP_PROGRESS,
      sessions: LOOP_SESSIONS,
      bootstrap: LOOP_BOOTSTRAP,
    },
    featureList,
  };
}

export async function planLoopWorkspace(projectRoot, options = {}) {
  await ensureLoopFiles(projectRoot);
  const taskState = await listOpenSpecTaskWorkspace(projectRoot, { change: options.change });
  const existing = await readFeatureList(projectRoot);
  const existingById = new Map((existing?.tasks ?? []).map((task) => [task.id, task]));
  const tasks = taskState.tasks.map((task) => mergeExistingTaskState(
    existingById.get(task.id),
    featureTaskFromOpenSpecTask(task, taskState.changeId),
  ));
  const featureList = {
    version: 1,
    generatedAt: existing?.generatedAt ?? timestamp(),
    updatedAt: timestamp(),
    projectRoot,
    changeId: taskState.changeId,
    changeDir: path.relative(projectRoot, taskState.changeDir),
    source: 'openprd loop plan',
    policy: {
      oneTaskPerSession: true,
      requireVerify: true,
      requireCommit: true,
      continuity: 'files-and-git-history',
      agentSessionRule: 'start a new Codex or Claude session for exactly one task',
    },
    tasks,
  };
  await writeFeatureList(projectRoot, featureList);
  await appendText(harnessPath(projectRoot, LOOP_PROGRESS), renderProgressEntry(timestamp(), [
    `Planned ${tasks.length} loop task(s) from change ${taskState.changeId}.`,
    'Each task is a separate agent session boundary.',
  ]));
  return {
    ok: true,
    action: 'loop-plan',
    projectRoot,
    changeId: taskState.changeId,
    featureList,
    summary: buildLoopSummary(featureList),
    next: nextLoopTask(featureList).task,
  };
}

export async function statusLoopWorkspace(projectRoot) {
  await ensureLoopFiles(projectRoot);
  const featureList = await readFeatureList(projectRoot);
  if (!featureList) {
    return {
      ok: false,
      action: 'loop-status',
      projectRoot,
      summary: buildLoopSummary(null),
      next: null,
      errors: ['Loop feature list is missing. Run openprd loop . --plan --change <id>.'],
    };
  }
  const { task, dependencyState: state } = nextLoopTask(featureList);
  return {
    ok: true,
    action: 'loop-status',
    projectRoot,
    changeId: featureList.changeId,
    summary: buildLoopSummary(featureList),
    next: task,
    dependencyState: state,
    files: {
      featureList: LOOP_FEATURE_LIST,
      progress: LOOP_PROGRESS,
      sessions: LOOP_SESSIONS,
    },
  };
}

export async function nextLoopWorkspace(projectRoot, options = {}) {
  const status = await statusLoopWorkspace(projectRoot);
  if (!status.ok) return status;
  if (options.item) {
    const featureList = await readFeatureList(projectRoot);
    const selected = nextLoopTask(featureList, options.item);
    return {
      ...status,
      action: 'loop-next',
      next: selected.task,
      dependencyState: selected.dependencyState,
    };
  }
  return { ...status, action: 'loop-next' };
}

export async function promptLoopWorkspace(projectRoot, options = {}) {
  await ensureLoopFiles(projectRoot);
  const agent = normalizeAgent(options.agent ?? 'codex');
  const featureList = await readFeatureList(projectRoot);
  if (!featureList) {
    throw new Error('Loop feature list is missing. Run openprd loop . --plan --change <id>.');
  }
  const { task, dependencyState: state } = nextLoopTask(featureList, options.item);
  if (!task) {
    return {
      ok: false,
      action: 'loop-prompt',
      projectRoot,
      agent,
      errors: ['No ready loop task is available.'],
    };
  }
  if (!state.ready) {
    return {
      ok: false,
      action: 'loop-prompt',
      projectRoot,
      agent,
      task,
      dependencyState: state,
      errors: [`Task ${task.id} is not ready.`],
    };
  }
  const prompt = renderLoopPrompt({
    agent,
    projectRoot,
    featureList,
    task,
    dependency: state,
    mode: options.mode ?? 'manual',
  });
  const promptFileName = `${task.id.replace(/[^a-zA-Z0-9._-]/g, '_')}-${agent}-${Date.now()}.md`;
  const promptPath = harnessPath(projectRoot, cjoin(LOOP_PROMPTS_DIR, promptFileName));
  await writeText(promptPath, prompt);
  const invocation = defaultAgentInvocation(agent, projectRoot, path.relative(projectRoot, promptPath));
  return {
    ok: true,
    action: 'loop-prompt',
    projectRoot,
    agent,
    task,
    dependencyState: state,
    prompt,
    promptPath: path.relative(projectRoot, promptPath),
    invocation,
  };
}

export async function verifyLoopWorkspace(projectRoot, options = {}) {
  await ensureLoopFiles(projectRoot);
  const featureList = await readFeatureList(projectRoot);
  if (!featureList) {
    throw new Error('Loop feature list is missing. Run openprd loop . --plan --change <id>.');
  }
  const { task, dependencyState: state } = nextLoopTask(featureList, options.item);
  if (!task) {
    return { ok: false, action: 'loop-verify', projectRoot, errors: ['No ready loop task is available.'] };
  }
  if (!state.ready) {
    return { ok: false, action: 'loop-verify', projectRoot, task, dependencyState: state, errors: [`Task ${task.id} is not ready.`] };
  }
  const verify = await verifyOpenSpecTaskWorkspace(projectRoot, { change: task.changeId, item: task.sourceTaskId });
  return {
    ok: verify.ok,
    action: 'loop-verify',
    projectRoot,
    task,
    dependencyState: state,
    verify,
    errors: verify.ok ? [] : [verify.verification?.stderr || verify.verification?.stdout || `Task ${task.id} verify failed.`],
  };
}

function updateTask(featureList, taskId, patch) {
  return {
    ...featureList,
    updatedAt: timestamp(),
    tasks: featureList.tasks.map((task) => (
      task.id === taskId ? { ...task, ...patch, updatedAt: timestamp() } : task
    )),
  };
}

export async function finishLoopWorkspace(projectRoot, options = {}) {
  await ensureLoopFiles(projectRoot);
  const featureList = await readFeatureList(projectRoot);
  if (!featureList) {
    throw new Error('Loop feature list is missing. Run openprd loop . --plan --change <id>.');
  }
  const { task, dependencyState: state } = nextLoopTask(featureList, options.item);
  if (!task) {
    return { ok: false, action: 'loop-finish', projectRoot, errors: ['No ready loop task is available.'] };
  }
  if (!state.ready) {
    return { ok: false, action: 'loop-finish', projectRoot, task, dependencyState: state, errors: [`Task ${task.id} is not ready.`] };
  }

  const beforeChange = await validateOpenSpecChangeWorkspace(projectRoot, { change: task.changeId });
  if (!beforeChange.ok) {
    return {
      ok: false,
      action: 'loop-finish',
      projectRoot,
      task,
      change: beforeChange,
      errors: beforeChange.errors,
    };
  }

  const advanced = await advanceOpenSpecTaskWorkspace(projectRoot, {
    change: task.changeId,
    item: task.sourceTaskId,
    verify: true,
    evidence: options.evidence,
    notes: options.notes,
  });
  if (!advanced.ok) {
    const failedList = updateTask(featureList, task.id, { status: 'failed', lastError: advanced.verification?.stderr || advanced.verification?.stdout || 'verify failed' });
    await writeFeatureList(projectRoot, failedList);
    return {
      ok: false,
      action: 'loop-finish',
      projectRoot,
      task,
      advanced,
      errors: [advanced.verification?.stderr || advanced.verification?.stdout || `Task ${task.id} verify failed.`],
    };
  }

  const change = await validateOpenSpecChangeWorkspace(projectRoot, { change: task.changeId });
  if (!change.ok) {
    const failedList = updateTask(featureList, task.id, { status: 'failed', lastError: change.errors.join('; ') });
    await writeFeatureList(projectRoot, failedList);
    return {
      ok: false,
      action: 'loop-finish',
      projectRoot,
      task,
      advanced,
      change,
      errors: change.errors,
    };
  }

  let commit = null;
  if (options.commit) {
    commit = await gitCommit(projectRoot, options.message ?? task.commitMessage);
    if (!commit.ok) {
      return {
        ok: false,
        action: 'loop-finish',
        projectRoot,
        task,
        advanced,
        change,
        commit,
        errors: [commit.message],
      };
    }
  }

  const updatedList = updateTask(featureList, task.id, {
    status: 'done',
    lastVerifiedAt: timestamp(),
    lastCommittedAt: commit && !commit.skipped ? timestamp() : null,
    commitSha: commit?.sha ?? null,
  });
  await writeFeatureList(projectRoot, updatedList);
  await appendText(harnessPath(projectRoot, LOOP_PROGRESS), renderProgressEntry(timestamp(), [
    `Finished ${task.id}: ${task.title}.`,
    `Verify: ${advanced.verification?.ok ? 'ok' : 'not-run'}.`,
    commit ? `Commit: ${commit.skipped ? 'skipped' : commit.sha}` : 'Commit: not requested.',
  ]));
  await appendJsonl(harnessPath(projectRoot, LOOP_SESSIONS), {
    version: 1,
    at: timestamp(),
    action: 'finish',
    taskId: task.id,
    changeId: task.changeId,
    ok: true,
    commit: commit ? { ok: commit.ok, skipped: commit.skipped, sha: commit.sha ?? null } : null,
  });
  await updateLoopState(projectRoot, {
    currentTaskId: advanced.nextTask?.id ?? null,
    completedTaskIds: updatedList.tasks.filter((item) => item.status === 'done').map((item) => item.id),
  });
  return {
    ok: true,
    action: 'loop-finish',
    projectRoot,
    task,
    advanced,
    change,
    commit,
    summary: buildLoopSummary(updatedList),
    next: nextLoopTask(updatedList).task,
  };
}

export async function runLoopWorkspace(projectRoot, options = {}) {
  const agent = normalizeAgent(options.agent ?? 'codex');
  const promptResult = await promptLoopWorkspace(projectRoot, { ...options, agent, mode: 'loop-run' });
  if (!promptResult.ok) return promptResult;

  const absolutePromptPath = harnessPath(projectRoot, promptResult.promptPath);
  const prompt = await readText(absolutePromptPath);
  const invocation = options.agentCommand
    ? {
      command: options.agentCommand,
      args: [],
      stdinFile: promptResult.promptPath,
      display: `${options.agentCommand} < ${shellJoin([promptResult.promptPath])}`,
      shell: true,
    }
    : defaultAgentInvocation(agent, projectRoot, promptResult.promptPath);

  const sessionEvent = {
    version: 1,
    at: timestamp(),
    action: options.dryRun ? 'run-dry-run' : 'run',
    agent,
    taskId: promptResult.task.id,
    changeId: promptResult.task.changeId,
    promptPath: promptResult.promptPath,
    invocation: invocation.display,
  };
  await appendJsonl(harnessPath(projectRoot, LOOP_SESSIONS), sessionEvent);
  await updateLoopState(projectRoot, {
    currentTaskId: promptResult.task.id,
    lastAgent: agent,
    lastSessionAt: sessionEvent.at,
  });

  if (options.dryRun) {
    return {
      ok: true,
      action: 'loop-run',
      dryRun: true,
      projectRoot,
      agent,
      task: promptResult.task,
      promptPath: promptResult.promptPath,
      invocation,
      prompt: promptResult.prompt,
    };
  }

  const run = invocation.shell
    ? await runCommand(invocation.command, [], { cwd: projectRoot, shell: true, stdin: prompt })
    : await runCommand(invocation.command, invocation.args, { cwd: projectRoot, stdin: prompt });
  await appendJsonl(harnessPath(projectRoot, LOOP_SESSIONS), {
    version: 1,
    at: timestamp(),
    action: 'agent-exit',
    agent,
    taskId: promptResult.task.id,
    ok: run.ok,
    status: run.status,
  });
  if (!run.ok) {
    return {
      ok: false,
      action: 'loop-run',
      projectRoot,
      agent,
      task: promptResult.task,
      run,
      errors: [run.stderr || run.stdout || 'Agent command failed.'],
    };
  }

  const finish = await finishLoopWorkspace(projectRoot, {
    item: promptResult.task.id,
    commit: options.commit,
    message: options.message ?? promptResult.task.commitMessage,
    notes: `Finished by openprd loop run --agent ${agent}.`,
  });
  return {
    ok: finish.ok,
    action: 'loop-run',
    projectRoot,
    agent,
    task: promptResult.task,
    run,
    finish,
    errors: finish.errors ?? [],
  };
}
