import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveOpenSpecChangeId } from './change-validate.js';
import { cjoin, resolveChangeDir } from './paths.js';
import {
  listOpenSpecStructuredTasks,
  parseOpenSpecTaskDeps,
} from './tasks.js';

function timestamp() {
  return new Date().toISOString();
}

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

async function appendJsonl(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

function getDependencyState(task, taskById) {
  const deps = parseOpenSpecTaskDeps(task.metadata.deps);
  const missing = [];
  const incomplete = [];

  for (const depId of deps) {
    const dependency = taskById.get(depId);
    if (!dependency) {
      missing.push(depId);
      continue;
    }
    if (!dependency.checked) {
      incomplete.push(depId);
    }
  }

  return {
    deps,
    missing,
    incomplete,
    ready: missing.length === 0 && incomplete.length === 0,
  };
}

function summarizeOpenSpecTasks(tasks, taskById) {
  const pending = tasks.filter((task) => !task.checked);
  const completed = tasks.filter((task) => task.checked);
  const blocked = pending
    .map((task) => ({
      task,
      dependencyState: getDependencyState(task, taskById),
    }))
    .filter((item) => !item.dependencyState.ready);
  const nextReady = pending.find((task) => getDependencyState(task, taskById).ready) ?? null;

  return {
    total: tasks.length,
    completed: completed.length,
    pending: pending.length,
    blocked: blocked.length,
    nextReady,
    blockedTasks: blocked,
  };
}

async function loadTaskState(projectRoot, options = {}) {
  const changeId = await resolveOpenSpecChangeId(projectRoot, options.change);
  const { files, tasks, taskById } = await listOpenSpecStructuredTasks(projectRoot, { changeId });
  const summary = summarizeOpenSpecTasks(tasks, taskById);

  return {
    projectRoot,
    changeId,
    changeDir: await resolveChangeDir(projectRoot, changeId),
    files,
    tasks,
    taskById,
    summary,
  };
}

function resolveTaskSelection(state, options = {}) {
  const requestedId = options.item ?? options.id ?? null;
  const task = requestedId
    ? state.taskById.get(requestedId)
    : state.summary.nextReady;

  if (!task) {
    if (requestedId) {
      throw new Error(`Unknown OpenSpec task: ${requestedId}`);
    }
    throw new Error('No ready OpenSpec task is available.');
  }

  return task;
}

function assertTaskReady(task, state) {
  const dependencyState = getDependencyState(task, state.taskById);
  if (dependencyState.missing.length > 0) {
    throw new Error(`${task.id} depends on unknown task(s): ${dependencyState.missing.join(', ')}`);
  }
  if (dependencyState.incomplete.length > 0) {
    throw new Error(`${task.id} is blocked by incomplete task(s): ${dependencyState.incomplete.join(', ')}`);
  }
  return dependencyState;
}

async function runVerifyCommand(command, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-64000);
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-64000);
    });
    child.on('error', (error) => {
      resolve({
        ok: false,
        command,
        exitCode: null,
        stdout,
        stderr: `${stderr}${error.message}`,
      });
    });
    child.on('close', (exitCode) => {
      resolve({
        ok: exitCode === 0,
        command,
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}

async function markTaskComplete(task) {
  const text = await readText(task.absolutePath);
  const lines = text.split(/\r?\n/);
  const index = task.lineNumber - 1;
  if (!lines[index]) {
    throw new Error(`Cannot update ${task.relativePath}:${task.lineNumber}; line is missing.`);
  }
  if (!lines[index].startsWith('- [x]') && !lines[index].startsWith('- [X]')) {
    lines[index] = lines[index].replace(/^- \[ \]/, '- [x]');
  }
  await writeText(task.absolutePath, lines.join('\n'));
}

async function appendTaskEvent(state, event) {
  await appendJsonl(cjoin(state.changeDir, 'task-events.jsonl'), {
    version: 1,
    at: timestamp(),
    changeId: state.changeId,
    ...event,
  });
}

export async function listOpenSpecTaskWorkspace(projectRoot, options = {}) {
  const state = await loadTaskState(projectRoot, options);
  return {
    ok: true,
    action: 'list',
    projectRoot,
    changeId: state.changeId,
    changeDir: state.changeDir,
    tasks: state.tasks,
    summary: {
      total: state.summary.total,
      completed: state.summary.completed,
      pending: state.summary.pending,
      blocked: state.summary.blocked,
    },
    nextTask: state.summary.nextReady,
    blockedTasks: state.summary.blockedTasks.map(({ task, dependencyState }) => ({
      id: task.id,
      title: task.title,
      missing: dependencyState.missing,
      incomplete: dependencyState.incomplete,
    })),
  };
}

export async function verifyOpenSpecTaskWorkspace(projectRoot, options = {}) {
  const state = await loadTaskState(projectRoot, options);
  const task = resolveTaskSelection(state, options);
  assertTaskReady(task, state);
  if (!task.metadata.verify) {
    throw new Error(`${task.id} is missing verify command.`);
  }
  const verification = await runVerifyCommand(task.metadata.verify, projectRoot);
  await appendTaskEvent(state, {
    action: 'verify',
    taskId: task.id,
    taskTitle: task.title,
    ok: verification.ok,
    verify: verification,
    evidence: options.evidence ?? null,
    notes: options.notes ?? null,
  });

  return {
    ok: verification.ok,
    action: 'verify',
    projectRoot,
    changeId: state.changeId,
    task,
    verification,
  };
}

export async function advanceOpenSpecTaskWorkspace(projectRoot, options = {}) {
  const state = await loadTaskState(projectRoot, options);
  const task = resolveTaskSelection(state, options);
  const dependencyState = assertTaskReady(task, state);
  let verification = null;

  if (options.verify) {
    if (!task.metadata.verify) {
      throw new Error(`${task.id} is missing verify command.`);
    }
    verification = await runVerifyCommand(task.metadata.verify, projectRoot);
    if (!verification.ok) {
      await appendTaskEvent(state, {
        action: 'advance_failed',
        taskId: task.id,
        taskTitle: task.title,
        ok: false,
        verify: verification,
        evidence: options.evidence ?? null,
        notes: options.notes ?? null,
      });
      return {
        ok: false,
        action: 'advance',
        projectRoot,
        changeId: state.changeId,
        task,
        dependencyState,
        verification,
        advanced: false,
      };
    }
  }

  await markTaskComplete(task);
  await appendTaskEvent(state, {
    action: 'advance',
    taskId: task.id,
    taskTitle: task.title,
    ok: true,
    verify: verification,
    evidence: options.evidence ?? null,
    notes: options.notes ?? null,
  });

  const updatedState = await loadTaskState(projectRoot, { change: state.changeId });
  return {
    ok: true,
    action: 'advance',
    projectRoot,
    changeId: state.changeId,
    task: {
      ...task,
      checked: true,
    },
    dependencyState,
    verification,
    advanced: true,
    nextTask: updatedState.summary.nextReady,
    summary: {
      total: updatedState.summary.total,
      completed: updatedState.summary.completed,
      pending: updatedState.summary.pending,
      blocked: updatedState.summary.blocked,
    },
  };
}
