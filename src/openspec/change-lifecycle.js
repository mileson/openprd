import fs from 'node:fs/promises';
import path from 'node:path';
import { validateOpenSpecChangeWorkspace, resolveOpenSpecChangeId } from './change-validate.js';
import { listOpenSpecStructuredTasks } from './tasks.js';
import {
  cjoin,
  exists,
  listChangeDirs,
  openPrdAcceptedSpecRoot,
  openPrdArchiveChangeRoot,
  openPrdDiscoveryConfigPath,
  readDiscoveryConfig,
  resolveChangeDir,
} from './paths.js';

function timestamp() {
  return new Date().toISOString();
}

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function readJson(filePath) {
  const text = await readText(filePath);
  return JSON.parse(text);
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function changesStatePath(projectRoot) {
  return cjoin(projectRoot, '.openprd', 'state', 'changes.json');
}

async function readChangesState(projectRoot) {
  return (await readJson(changesStatePath(projectRoot)).catch(() => null)) ?? {
    version: 1,
    activeChange: null,
    changes: {},
  };
}

async function writeChangesState(projectRoot, state) {
  await writeJson(changesStatePath(projectRoot), {
    version: 1,
    activeChange: state.activeChange ?? null,
    updatedAt: timestamp(),
    changes: state.changes ?? {},
  });
}

async function writeActiveChange(projectRoot, changeId) {
  const state = await readChangesState(projectRoot);
  state.activeChange = changeId;
  state.changes[changeId] = {
    ...(state.changes[changeId] ?? {}),
    id: changeId,
    status: 'active',
    activatedAt: timestamp(),
  };
  await writeChangesState(projectRoot, state);

  const config = await readDiscoveryConfig(projectRoot, readJson);
  await writeJson(openPrdDiscoveryConfigPath(projectRoot), {
    ...config,
    activeChange: changeId,
  });

  return state;
}

async function readAcceptedIndex(projectRoot) {
  const indexPath = cjoin(openPrdAcceptedSpecRoot(projectRoot), 'index.json');
  return (await readJson(indexPath).catch(() => null)) ?? {
    version: 1,
    updatedAt: null,
    capabilities: {},
    appliedChanges: [],
  };
}

async function writeAcceptedIndex(projectRoot, index) {
  await writeJson(cjoin(openPrdAcceptedSpecRoot(projectRoot), 'index.json'), {
    version: 1,
    updatedAt: timestamp(),
    capabilities: index.capabilities ?? {},
    appliedChanges: index.appliedChanges ?? [],
  });
}

async function collectChangeSpecs(changeDir) {
  const specsRoot = cjoin(changeDir, 'specs');
  const specs = [];
  let entries = [];
  try {
    entries = await fs.readdir(specsRoot, { withFileTypes: true });
  } catch {
    return specs;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue;
    }
    const sourcePath = cjoin(specsRoot, entry.name, 'spec.md');
    if (await exists(sourcePath)) {
      specs.push({
        capability: entry.name,
        sourcePath,
      });
    }
  }

  return specs;
}

async function allStructuredTasksComplete(projectRoot, changeId) {
  const { tasks } = await listOpenSpecStructuredTasks(projectRoot, { changeId });
  if (tasks.length === 0) {
    return { complete: true, total: 0, incomplete: [] };
  }
  const incomplete = tasks.filter((task) => !task.checked);
  return {
    complete: incomplete.length === 0,
    total: tasks.length,
    incomplete: incomplete.map((task) => task.id),
  };
}

async function updateChangeStatus(projectRoot, changeId, status, extra = {}) {
  const state = await readChangesState(projectRoot);
  state.changes[changeId] = {
    ...(state.changes[changeId] ?? {}),
    id: changeId,
    status,
    updatedAt: timestamp(),
    ...extra,
  };
  if (status === 'active') {
    state.activeChange = changeId;
  }
  if ((status === 'closed' || status === 'archived' || status === 'applied') && state.activeChange === changeId) {
    state.activeChange = null;
  }
  await writeChangesState(projectRoot, state);
  return state;
}

export async function listOpenPrdChangesWorkspace(projectRoot) {
  const state = await readChangesState(projectRoot);
  const discoveryConfig = await readDiscoveryConfig(projectRoot, readJson);
  const activeChange = state.activeChange ?? discoveryConfig.activeChange ?? null;
  const changes = await listChangeDirs(projectRoot);
  const rows = [];

  for (const change of changes) {
    const taskState = await allStructuredTasksComplete(projectRoot, change.id).catch(() => ({ total: 0, incomplete: [] }));
    rows.push({
      id: change.id,
      source: change.source,
      status: state.changes?.[change.id]?.status ?? (change.archived ? 'archived' : 'draft'),
      active: change.id === activeChange,
      archived: change.archived,
      changeDir: change.changeDir,
      taskTotal: taskState.total,
      taskIncomplete: taskState.incomplete.length,
    });
  }

  return {
    ok: true,
    action: 'list',
    projectRoot,
    activeChange,
    changes: rows,
  };
}

export async function activateOpenPrdChangeWorkspace(projectRoot, options = {}) {
  const changeId = await resolveOpenSpecChangeId(projectRoot, options.change);
  const changeDir = await resolveChangeDir(projectRoot, changeId);
  if (!(await exists(changeDir))) {
    throw new Error(`Missing OpenPrd change directory: ${path.relative(projectRoot, changeDir)}`);
  }
  await writeActiveChange(projectRoot, changeId);
  return {
    ok: true,
    action: 'activate',
    projectRoot,
    changeId,
    changeDir,
  };
}

export async function closeOpenPrdChangeWorkspace(projectRoot, options = {}) {
  const changeId = await resolveOpenSpecChangeId(projectRoot, options.change);
  const state = await updateChangeStatus(projectRoot, changeId, 'closed', {
    closedAt: timestamp(),
    reason: options.notes ?? null,
  });
  return {
    ok: true,
    action: 'close',
    projectRoot,
    changeId,
    activeChange: state.activeChange,
  };
}

export async function applyOpenPrdChangeWorkspace(projectRoot, options = {}) {
  const changeId = await resolveOpenSpecChangeId(projectRoot, options.change);
  const validation = await validateOpenSpecChangeWorkspace(projectRoot, { change: changeId });
  if (!validation.ok) {
    return {
      ok: false,
      action: 'apply',
      projectRoot,
      changeId,
      validation,
      appliedSpecs: [],
      errors: validation.errors,
    };
  }

  const taskState = await allStructuredTasksComplete(projectRoot, changeId);
  if (!taskState.complete && !options.force) {
    return {
      ok: false,
      action: 'apply',
      projectRoot,
      changeId,
      validation,
      appliedSpecs: [],
      errors: [`Change ${changeId} still has incomplete task(s): ${taskState.incomplete.join(', ')}. Use --force to apply anyway.`],
    };
  }

  const changeDir = await resolveChangeDir(projectRoot, changeId);
  const specs = await collectChangeSpecs(changeDir);
  const acceptedRoot = openPrdAcceptedSpecRoot(projectRoot);
  const acceptedIndex = await readAcceptedIndex(projectRoot);
  const appliedSpecs = [];
  const now = timestamp();

  for (const spec of specs) {
    const targetPath = cjoin(acceptedRoot, spec.capability, 'spec.md');
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(spec.sourcePath, targetPath);
    acceptedIndex.capabilities[spec.capability] = {
      capability: spec.capability,
      specPath: path.relative(projectRoot, targetPath),
      sourceChange: changeId,
      appliedAt: now,
    };
    appliedSpecs.push({
      capability: spec.capability,
      specPath: targetPath,
    });
  }

  acceptedIndex.appliedChanges.push({
    changeId,
    appliedAt: now,
    forced: Boolean(options.force),
    capabilities: appliedSpecs.map((spec) => spec.capability),
  });
  await writeAcceptedIndex(projectRoot, acceptedIndex);
  await updateChangeStatus(projectRoot, changeId, 'applied', {
    appliedAt: now,
    forced: Boolean(options.force),
    acceptedSpecCount: appliedSpecs.length,
  });

  return {
    ok: true,
    action: 'apply',
    projectRoot,
    changeId,
    validation,
    appliedSpecs,
    acceptedRoot,
    taskState,
  };
}

export async function archiveOpenPrdChangeWorkspace(projectRoot, options = {}) {
  const changeId = await resolveOpenSpecChangeId(projectRoot, options.change);
  const changeDir = await resolveChangeDir(projectRoot, changeId);
  if (!(await exists(changeDir))) {
    throw new Error(`Missing OpenPrd change directory: ${path.relative(projectRoot, changeDir)}`);
  }
  const archiveDir = cjoin(openPrdArchiveChangeRoot(projectRoot), changeId);
  if (await exists(archiveDir)) {
    if (!options.force) {
      throw new Error(`Archived change already exists: ${path.relative(projectRoot, archiveDir)}. Use --force to overwrite.`);
    }
    await fs.rm(archiveDir, { recursive: true, force: true });
  }
  await fs.mkdir(path.dirname(archiveDir), { recursive: true });
  await fs.cp(changeDir, archiveDir, { recursive: true });
  if (!options.keep) {
    await fs.rm(changeDir, { recursive: true, force: true });
  }
  await updateChangeStatus(projectRoot, changeId, 'archived', {
    archivedAt: timestamp(),
    archiveDir: path.relative(projectRoot, archiveDir),
    sourceDir: path.relative(projectRoot, changeDir),
    keptSource: Boolean(options.keep),
  });

  return {
    ok: true,
    action: 'archive',
    projectRoot,
    changeId,
    archiveDir,
    removedSource: !options.keep,
  };
}

export async function listAcceptedSpecsWorkspace(projectRoot) {
  const acceptedRoot = openPrdAcceptedSpecRoot(projectRoot);
  const index = await readAcceptedIndex(projectRoot);
  const specs = [];

  let entries = [];
  try {
    entries = await fs.readdir(acceptedRoot, { withFileTypes: true });
  } catch {
    entries = [];
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue;
    }
    const specPath = cjoin(acceptedRoot, entry.name, 'spec.md');
    if (await exists(specPath)) {
      specs.push({
        capability: entry.name,
        specPath,
        metadata: index.capabilities?.[entry.name] ?? null,
      });
    }
  }

  return {
    ok: true,
    action: 'specs',
    projectRoot,
    acceptedRoot,
    specs,
    appliedChanges: index.appliedChanges ?? [],
  };
}
