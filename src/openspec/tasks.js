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

    const metadataMatch = line.match(/^\s{2,}-\s+(deps|done|verify|type|category|kind|oracle):\s*(.*)$/i);
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

const GENERIC_TASK_TITLE_PATTERNS = [
  /^(实现主流程|实现需求|实现验收目标|实现非功能需求)\s*[:：]/i,
  /^(验证验收目标|验证非功能需求)\s*[:：]/i,
  /^(Implement primary flow|Implement requirement|Implement acceptance goal|Implement non-functional requirement)\s*[:：]/i,
  /^(Validate acceptance goal|Validate non-functional requirement)\s*[:：]/i,
];

function looksLikeGovernanceTitle(title) {
  const value = String(title ?? '').trim();
  return (
    /^(评审|检查|校验|验证|运行|Review|Check|Validate|Verify|Run)/i.test(value)
    && /(OpenPrd\s+spec|OpenPrd\s+change|change\s+structure|change\s+schema|spec\s*(覆盖|校验|语言)?|review(?:\.html|\s+html)?|proposal|design|任务拆解)/i.test(value)
  );
}

function isSpecOnlyValidateCommand(rawValue) {
  const value = String(rawValue ?? '').replace(/\s+/g, ' ').trim();
  if (!value || !/^openprd change \. --validate\b/i.test(value)) {
    return false;
  }
  return !/(?:&&|\|\||;|\n)/.test(value);
}

export function normalizeOpenSpecTaskType(taskOrType) {
  const rawType = typeof taskOrType === 'string'
    ? taskOrType
    : (taskOrType?.metadata?.type ?? taskOrType?.metadata?.category ?? taskOrType?.metadata?.kind ?? '');
  const value = String(rawType ?? '').trim().toLowerCase();
  if (['implementation', 'impl', 'feature', 'code'].includes(value)) {
    return 'implementation';
  }
  if (['verification', 'verify', 'test', 'qa'].includes(value)) {
    return 'verification';
  }
  if (['documentation', 'docs', 'doc'].includes(value)) {
    return 'documentation';
  }
  if (['governance', 'spec', 'review', 'process'].includes(value)) {
    return 'governance';
  }

  const title = typeof taskOrType === 'string' ? '' : String(taskOrType?.title ?? '');
  if (looksLikeGovernanceTitle(title)) {
    return 'governance';
  }
  if (/^(实现|新增|创建|接入|改造|搭建|Build|Create|Add|Implement|Wire|Prepare)/i.test(title)) {
    return 'implementation';
  }
  if (/^(验证|测试|校验|运行|Verify|Test|Validate)/i.test(title)) {
    return 'verification';
  }
  if (/docs\/basic|README|文档|说明书|Documentation|Docs/i.test(title)) {
    return 'documentation';
  }
  return 'governance';
}

export function summarizeOpenSpecTaskTypes(tasks) {
  const byType = {};
  for (const type of ['implementation', 'verification', 'documentation', 'governance']) {
    byType[type] = {
      total: 0,
      completed: 0,
      pending: 0,
    };
  }

  for (const task of tasks ?? []) {
    const type = normalizeOpenSpecTaskType(task);
    if (!byType[type]) {
      byType[type] = { total: 0, completed: 0, pending: 0 };
    }
    byType[type].total += 1;
    if (task.checked) {
      byType[type].completed += 1;
    } else {
      byType[type].pending += 1;
    }
  }

  return byType;
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
      errors.push(`${formatOpenSpecTaskLocation(task)} 重复使用任务 id ${task.id}。`);
      continue;
    }
    taskById.set(task.id, task);
  }

  for (const task of tasks) {
    const normalizedType = normalizeOpenSpecTaskType(task);
    if (!task.metadata.done) {
      errors.push(`${formatOpenSpecTaskLocation(task)} 缺少 "done:"。`);
    }
    if (!task.metadata.verify) {
      errors.push(`${formatOpenSpecTaskLocation(task)} 缺少 "verify:"。`);
    }
    if (GENERIC_TASK_TITLE_PATTERNS.some((pattern) => pattern.test(task.title))) {
      errors.push(`${formatOpenSpecTaskLocation(task)} 任务标题仍在按 PRD 小节平移（${task.title}）；请改成可直接执行的实现或验证单元，不要使用“实现主流程:”或“验证验收目标:”这类泛化标题。`);
    }
    if (normalizedType !== 'governance' && isSpecOnlyValidateCommand(task.metadata.verify)) {
      errors.push(`${formatOpenSpecTaskLocation(task)} 的 verify 只做了 change 结构校验；${normalizedType} 任务必须提供能证明实际落地的验证命令或审查步骤。`);
    }

    for (const depId of parseOpenSpecTaskDeps(task.metadata.deps)) {
      if (!OPENSPEC_TASK_ID_PATTERN.test(depId)) {
        errors.push(`${formatOpenSpecTaskLocation(task)} 存在无效依赖 id ${depId}。`);
        continue;
      }

      const dependency = taskById.get(depId);
      if (!dependency) {
        errors.push(`${formatOpenSpecTaskLocation(task)} 依赖未知任务 ${depId}。`);
        continue;
      }
      if (dependency.order >= task.order) {
        errors.push(`${formatOpenSpecTaskLocation(task)} 依赖 ${depId}，该任务必须出现在 ${task.id} 之前。`);
      }
    }
  }

  checks.push(`结构化 OpenPrd 任务: ${tasks.length} 个任务，${dependencyCount} 条依赖。`);
}

export async function analyzeOpenSpecTaskVolumes(projectRoot, options = {}) {
  const discoveryConfig = await readDiscoveryConfig(projectRoot, readJson);
  const maxItemsPerFile = Number(discoveryConfig?.taskSharding?.maxItemsPerFile ?? OPENSPEC_TASK_MAX_ITEMS_PER_FILE);
  const taskFiles = await collectOpenSpecTaskFiles(projectRoot, options);
  const errors = [];
  const checks = [];
  const filesByGroup = new Map();

  if (!Number.isInteger(maxItemsPerFile) || maxItemsPerFile < 1) {
    errors.push(`OpenPrd 任务分片 maxItemsPerFile 无效: ${discoveryConfig?.taskSharding?.maxItemsPerFile}`);
  }

  for (const file of taskFiles) {
    if (file.checkboxCount > maxItemsPerFile) {
      errors.push(`${file.relativePath} 包含 ${file.checkboxCount} 个 checkbox 任务；请拆分到每个文件不超过 ${maxItemsPerFile} 个。`);
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
        errors.push(`${file.relativePath} 最后必须用 checkbox 任务交接到 ${next.fileName}。`);
      }
    }
    validateOpenSpecStructuredTasks(sortedFiles, errors, checks);
  }

  if (taskFiles.length > 0) {
    const totalCheckboxes = taskFiles.reduce((sum, file) => sum + file.checkboxCount, 0);
    checks.push(`OpenPrd 任务文件: ${taskFiles.length} 个文件，${totalCheckboxes} 个 checkbox 任务，每个文件最多 ${maxItemsPerFile} 个。`);
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
