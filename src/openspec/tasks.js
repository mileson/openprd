import fs from 'node:fs/promises';
import path from 'node:path';
import {
  OPENSPEC_TASK_FILE_PATTERN,
  OPENSPEC_TASK_ID_PATTERN,
  OPENSPEC_TASK_MAX_ITEMS_PER_FILE,
} from './constants.js';
import { cjoin, exists, listChangeDirs, readDiscoveryConfig, resolveChangeDir } from './paths.js';

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function readJson(filePath) {
  const text = await readText(filePath);
  return JSON.parse(text);
}

export function sortOpenSpecTaskFiles(files) {
  return [...files].sort((a, b) => {
    if (a.fileName === 'tasks.md') return -1;
    if (b.fileName === 'tasks.md') return 1;
    return a.fileName.localeCompare(b.fileName);
  });
}

export function parseOpenSpecTaskFile(text) {
  const checkboxLines = [];
  const substantiveCheckboxLines = [];
  const structuredTasks = [];
  let currentTask = null;

  text.split(/\r?\n/).forEach((line, index) => {
    const checkboxMatch = line.match(/^- \[([ xX])\] (.*)$/);
    if (checkboxMatch) {
      checkboxLines.push(line);
      if (/`tasks-\d{3}\.md`/.test(line) && /\b(continue|continuing)\b/i.test(line)) {
        currentTask = null;
        return;
      }

      substantiveCheckboxLines.push(line);
      const title = checkboxMatch[2].trim();
      const structuredMatch = title.match(/^(T\d{3}\.\d+)\s+(.+)$/);
      if (!structuredMatch) {
        currentTask = null;
        return;
      }

      currentTask = {
        id: structuredMatch[1],
        title: structuredMatch[2].trim(),
        checked: checkboxMatch[1].toLowerCase() === 'x',
        lineNumber: index + 1,
        metadata: {},
      };
      structuredTasks.push(currentTask);
      return;
    }

    const metadataMatch = line.match(/^\s{2,}-\s+(deps|done|verify):\s*(.*)$/i);
    if (currentTask && metadataMatch) {
      currentTask.metadata[metadataMatch[1].toLowerCase()] = metadataMatch[2].trim();
    }
  });

  return {
    checkboxLines,
    substantiveCheckboxLines,
    structuredTasks,
  };
}

export function parseOpenSpecTaskDeps(rawValue) {
  const value = String(rawValue ?? '').trim();
  if (!value || /^(none|n\/a|na|-)$/.test(value.toLowerCase())) {
    return [];
  }
  return value.split(',').map((dep) => dep.trim()).filter(Boolean);
}

export function formatOpenSpecTaskLocation(task) {
  return `${task.relativePath}:${task.lineNumber}`;
}

export async function collectOpenSpecTaskFiles(projectRoot, options = {}) {
  const files = [];
  const roots = options.changeId
    ? [await resolveChangeDir(projectRoot, options.changeId)]
    : (await listChangeDirs(projectRoot)).filter((change) => !change.archived).map((change) => change.changeDir);
  if (roots.length === 0) {
    return files;
  }

  async function walk(currentDir) {
    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolutePath = cjoin(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || !OPENSPEC_TASK_FILE_PATTERN.test(entry.name)) {
        continue;
      }
      const text = await readText(absolutePath);
      const parsedTasks = parseOpenSpecTaskFile(text);
      files.push({
        absolutePath,
        relativePath: path.relative(projectRoot, absolutePath),
        groupDir: path.dirname(absolutePath),
        fileName: entry.name,
        text,
        checkboxCount: parsedTasks.substantiveCheckboxLines.length,
        lastCheckboxLine: parsedTasks.checkboxLines.at(-1) ?? '',
        structuredTasks: parsedTasks.structuredTasks.map((task) => ({
          ...task,
          absolutePath,
          relativePath: path.relative(projectRoot, absolutePath),
          groupDir: path.dirname(absolutePath),
          fileName: entry.name,
        })),
      });
    }
  }

  for (const root of roots) {
    if (await exists(root)) {
      await walk(root);
    }
  }
  return files;
}

export function flattenOpenSpecStructuredTasks(files) {
  const sortedFiles = sortOpenSpecTaskFiles(files);
  const tasks = [];
  let order = 0;

  for (const file of sortedFiles) {
    for (const task of file.structuredTasks ?? []) {
      order += 1;
      tasks.push({
        ...task,
        order,
      });
    }
  }

  return tasks;
}

export function validateOpenSpecStructuredTasks(sortedFiles, errors, checks) {
  const tasks = flattenOpenSpecStructuredTasks(sortedFiles);

  if (tasks.length === 0) {
    return;
  }

  const taskById = new Map();
  const dependencyCount = tasks.reduce((sum, task) => sum + parseOpenSpecTaskDeps(task.metadata.deps).length, 0);

  for (const task of tasks) {
    if (taskById.has(task.id)) {
      errors.push(`${formatOpenSpecTaskLocation(task)} duplicates task id ${task.id}.`);
      continue;
    }
    taskById.set(task.id, task);
  }

  for (const task of tasks) {
    if (!task.metadata.done) {
      errors.push(`${formatOpenSpecTaskLocation(task)} is missing "done:".`);
    }
    if (!task.metadata.verify) {
      errors.push(`${formatOpenSpecTaskLocation(task)} is missing "verify:".`);
    }

    for (const depId of parseOpenSpecTaskDeps(task.metadata.deps)) {
      if (!OPENSPEC_TASK_ID_PATTERN.test(depId)) {
        errors.push(`${formatOpenSpecTaskLocation(task)} has invalid dependency id ${depId}.`);
        continue;
      }

      const dependency = taskById.get(depId);
      if (!dependency) {
        errors.push(`${formatOpenSpecTaskLocation(task)} depends on unknown task ${depId}.`);
        continue;
      }
      if (dependency.order >= task.order) {
        errors.push(`${formatOpenSpecTaskLocation(task)} depends on ${depId}, which must appear before ${task.id}.`);
      }
    }
  }

  checks.push(`Structured OpenPrd tasks: ${tasks.length} task(s), ${dependencyCount} dependency link(s).`);
}

export async function analyzeOpenSpecTaskVolumes(projectRoot, options = {}) {
  const discoveryConfig = await readDiscoveryConfig(projectRoot, readJson);
  const maxItemsPerFile = Number(discoveryConfig?.taskSharding?.maxItemsPerFile ?? OPENSPEC_TASK_MAX_ITEMS_PER_FILE);
  const taskFiles = await collectOpenSpecTaskFiles(projectRoot, options);
  const errors = [];
  const checks = [];
  const filesByGroup = new Map();

  if (!Number.isInteger(maxItemsPerFile) || maxItemsPerFile < 1) {
    errors.push(`Invalid OpenPrd task sharding maxItemsPerFile: ${discoveryConfig?.taskSharding?.maxItemsPerFile}`);
  }

  for (const file of taskFiles) {
    if (file.checkboxCount > maxItemsPerFile) {
      errors.push(`${file.relativePath} has ${file.checkboxCount} checkbox tasks; split it to ${maxItemsPerFile} or fewer per file.`);
    }
    if (!filesByGroup.has(file.groupDir)) {
      filesByGroup.set(file.groupDir, []);
    }
    filesByGroup.get(file.groupDir).push(file);
  }

  for (const files of filesByGroup.values()) {
    const sortedFiles = sortOpenSpecTaskFiles(files);
    for (let index = 0; index < sortedFiles.length - 1; index += 1) {
      const file = sortedFiles[index];
      const next = sortedFiles[index + 1];
      if (!file.lastCheckboxLine.includes(next.fileName)) {
        errors.push(`${file.relativePath} must end with a checkbox that hands off to ${next.fileName}.`);
      }
    }
    validateOpenSpecStructuredTasks(sortedFiles, errors, checks);
  }

  if (taskFiles.length > 0) {
    const totalCheckboxes = taskFiles.reduce((sum, file) => sum + file.checkboxCount, 0);
    checks.push(`OpenPrd task files: ${taskFiles.length} file(s), ${totalCheckboxes} checkbox task(s), max ${maxItemsPerFile} per file.`);
  }

  return {
    maxItemsPerFile,
    files: taskFiles,
    errors,
    checks,
  };
}

export async function listOpenSpecStructuredTasks(projectRoot, options = {}) {
  const files = await collectOpenSpecTaskFiles(projectRoot, options);
  const tasks = flattenOpenSpecStructuredTasks(files);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return {
    files,
    tasks,
    taskById,
  };
}
