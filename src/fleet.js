import fs from 'node:fs/promises';
import path from 'node:path';
import { cjoin, exists, writeJson } from './fs-utils.js';
import { SOURCE_INVENTORY_IGNORE_DIRS } from './source-inventory.js';
import { timestamp } from './time.js';
import { readWorkspaceRegistry, upsertWorkspaceRegistryEntry } from './workspace-registry.js';

const FLEET_DEFAULT_MAX_DEPTH = 4;
const FLEET_IGNORE_DIRS = new Set([
  ...SOURCE_INVENTORY_IGNORE_DIRS,
  '.idea',
  '.DS_Store',
  '.Trash',
  'DerivedData',
  'Library',
  'logs',
  'tmp',
]);
const FLEET_PROJECT_MARKERS = [
  '.openprd',
  '.codex',
  '.claude',
  '.cursor',
  'AGENTS.md',
  'CLAUDE.md',
  '.git',
  'package.json',
  'pnpm-workspace.yaml',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'deno.json',
  'Makefile',
];
const FLEET_AGENT_MARKERS = ['.codex', '.claude', '.cursor', 'AGENTS.md', 'CLAUDE.md'];

function normalizeCsvList(value) {
  if (!value) {
    return [];
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function projectPathMatches(projectRoot, candidatePath, patterns) {
  if (patterns.length === 0) {
    return true;
  }
  const absolutePath = path.resolve(candidatePath);
  const relativePath = path.relative(projectRoot, absolutePath) || '.';
  return patterns.some((pattern) => {
    const resolvedPattern = path.isAbsolute(pattern) ? path.resolve(pattern) : pattern;
    return absolutePath === resolvedPattern
      || absolutePath.includes(resolvedPattern)
      || relativePath === pattern
      || relativePath.includes(pattern);
  });
}

function pathWithinRoot(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, path.resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function classifyFleetMarkers(markers) {
  if (markers.includes('.openprd')) {
    return 'openprd-workspace';
  }
  if (markers.some((marker) => FLEET_AGENT_MARKERS.includes(marker))) {
    return 'agent-configured';
  }
  return 'plain-project';
}

function plannedFleetAction(category, options) {
  if (category === 'openprd-workspace') {
    if (options.updateOpenprd) {
      return 'update';
    }
    if (options.backfillWorkUnits) {
      return 'backfill-work-units';
    }
    if (options.doctor) {
      return 'doctor';
    }
    if (options.syncRegistry) {
      return 'sync-registry';
    }
    return 'report';
  }
  if (category === 'agent-configured') {
    return options.setupMissing ? 'setup' : 'report';
  }
  return 'skip';
}

async function detectFleetMarkers(projectPath) {
  const entries = await fs.readdir(projectPath, { withFileTypes: true }).catch(() => []);
  const names = new Set(entries.map((entry) => entry.name));
  return FLEET_PROJECT_MARKERS.filter((marker) => names.has(marker));
}

async function scanFleetProjects(rootPath, options = {}) {
  const root = path.resolve(rootPath);
  const maxDepth = parsePositiveInteger(options.maxDepth, FLEET_DEFAULT_MAX_DEPTH);
  const include = normalizeCsvList(options.include);
  const exclude = normalizeCsvList(options.exclude);
  const projects = [];
  const seenRealPaths = new Set();

  async function walk(currentPath, depth) {
    if (depth > maxDepth) {
      return;
    }

    const name = path.basename(currentPath);
    if (depth > 0 && FLEET_IGNORE_DIRS.has(name)) {
      return;
    }

    const realPath = await fs.realpath(currentPath).catch(() => currentPath);
    if (seenRealPaths.has(realPath)) {
      return;
    }
    seenRealPaths.add(realPath);

    const markers = await detectFleetMarkers(currentPath);
    if (markers.length > 0) {
      const category = classifyFleetMarkers(markers);
      const included = projectPathMatches(root, currentPath, include);
      const excluded = exclude.length > 0 && projectPathMatches(root, currentPath, exclude);
      if (included && !excluded) {
        projects.push({
          path: currentPath,
          relativePath: path.relative(root, currentPath) || '.',
          category,
          markers,
          discoverySource: 'scan',
          registryKnown: false,
        });
      }
    }

    let entries = [];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink?.()) {
        continue;
      }
      if (FLEET_IGNORE_DIRS.has(entry.name)) {
        continue;
      }
      await walk(cjoin(currentPath, entry.name), depth + 1);
    }
  }

  await walk(root, 0);
  return projects.sort((left, right) => left.path.localeCompare(right.path));
}

async function collectRegistryFleetScope(rootPath, options, registry) {
  const root = path.resolve(rootPath);
  const include = normalizeCsvList(options.include);
  const exclude = normalizeCsvList(options.exclude);
  const projects = [];
  let scopedKnown = 0;
  let outsideRoot = 0;

  for (const entry of registry.entries) {
    if (!pathWithinRoot(root, entry.workspaceRoot)) {
      outsideRoot += 1;
      continue;
    }
    const included = projectPathMatches(root, entry.workspaceRoot, include);
    const excluded = exclude.length > 0 && projectPathMatches(root, entry.workspaceRoot, exclude);
    if (!included || excluded) {
      continue;
    }
    scopedKnown += 1;
    if (!(await exists(cjoin(entry.workspaceRoot, '.openprd')))) {
      continue;
    }
    projects.push({
      path: entry.workspaceRoot,
      relativePath: path.relative(root, entry.workspaceRoot) || '.',
      category: 'openprd-workspace',
      markers: ['.openprd'],
      discoverySource: 'registry',
      registryKnown: true,
      registryEntry: entry,
    });
  }

  return { projects, scopedKnown, outsideRoot };
}

async function mergeFleetProjects(scannedProjects, registryProjects) {
  const merged = [];
  const byKey = new Map();

  async function mergeProject(project) {
    const resolvedPath = path.resolve(project.path);
    const key = await fs.realpath(resolvedPath).catch(() => resolvedPath);
    const existing = byKey.get(key);
    if (!existing) {
      const next = { ...project, path: resolvedPath };
      byKey.set(key, next);
      merged.push(next);
      return;
    }
    existing.markers = Array.from(new Set([...(existing.markers ?? []), ...(project.markers ?? [])]));
    existing.registryKnown = existing.registryKnown || project.registryKnown;
    existing.registryEntry = existing.registryEntry ?? project.registryEntry;
    if (existing.discoverySource !== project.discoverySource) {
      existing.discoverySource = 'scan+registry';
    }
  }

  for (const project of scannedProjects) {
    await mergeProject(project);
  }
  for (const project of registryProjects) {
    await mergeProject(project);
  }

  return merged.sort((left, right) => left.path.localeCompare(right.path));
}

function summarizeFleetProjects(projects) {
  const summary = {
    total: projects.length,
    openprd: 0,
    agentConfigured: 0,
    plain: 0,
    planned: 0,
    updated: 0,
    setup: 0,
    doctored: 0,
    backfilled: 0,
    synced: 0,
    skipped: 0,
    failed: 0,
    healthAttention: 0,
  };
  for (const project of projects) {
    if (project.category === 'openprd-workspace') {
      summary.openprd += 1;
    } else if (project.category === 'agent-configured') {
      summary.agentConfigured += 1;
    } else {
      summary.plain += 1;
    }
    if (project.status === 'planned') {
      summary.planned += 1;
    } else if (project.status === 'updated') {
      summary.updated += 1;
    } else if (project.status === 'setup') {
      summary.setup += 1;
    } else if (project.status === 'doctored') {
      summary.doctored += 1;
    } else if (project.status === 'backfilled') {
      summary.backfilled += 1;
    } else if (project.status === 'synced') {
      summary.synced += 1;
    } else if (project.status === 'failed') {
      summary.failed += 1;
    } else if (project.status === 'skipped') {
      summary.skipped += 1;
    }
    if (project.workUnits?.changedVersions > 0 && project.status !== 'backfilled') {
      summary.backfilled += 1;
    }
    if (project.healthOk === false || (project.healthErrors?.length ?? 0) > 0) {
      summary.healthAttention += 1;
    }
  }
  return summary;
}

async function collectFleetProjectHealth(projectPath, options, doctorWorkspace) {
  if (!doctorWorkspace) {
    return { ok: true, errors: [] };
  }
  try {
    const doctor = await doctorWorkspace(projectPath, {
      tools: options.tools ?? 'all',
      hookProfile: options.hookProfile,
      enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
      codexHome: options.codexHome,
      openprdHome: options.openprdHome,
    });
    return {
      ok: doctor.ok,
      errors: doctor.errors ?? [],
    };
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function buildFleetRegistrySummary(rootPath, options, registry) {
  const root = path.resolve(rootPath);
  const include = normalizeCsvList(options.include);
  const exclude = normalizeCsvList(options.exclude);
  const scopedKnown = registry.entries.filter((entry) => {
    if (!pathWithinRoot(root, entry.workspaceRoot)) {
      return false;
    }
    const included = projectPathMatches(root, entry.workspaceRoot, include);
    const excluded = exclude.length > 0 && projectPathMatches(root, entry.workspaceRoot, exclude);
    return included && !excluded;
  }).length;
  const outsideRoot = registry.entries.filter((entry) => !pathWithinRoot(root, entry.workspaceRoot)).length;
  return {
    home: registry.home,
    registryPath: registry.registryPath,
    knownTotal: registry.entries.length,
    scopedKnown,
    outsideRoot,
    stale: registry.staleEntries.length,
  };
}

async function fleetWorkspaceImpl(rootPath, options = {}, dependencies = {}) {
  const {
    doctorWorkspace,
    backfillWorkUnitsWorkspace,
    setupAgentIntegrationWorkspace,
    updateAgentIntegrationWorkspace,
  } = dependencies;
  const root = path.resolve(rootPath);
  if (!(await exists(root))) {
    throw new Error(`Fleet root does not exist: ${root}`);
  }

  const hasMutationAction = Boolean(
    options.updateOpenprd
      || options.setupMissing
      || options.doctor
      || options.backfillWorkUnits
      || options.syncRegistry,
  );
  const dryRun = Boolean(options.dryRun) || !hasMutationAction;
  const registryBefore = await readWorkspaceRegistry({ openprdHome: options.openprdHome });
  const registryScope = await collectRegistryFleetScope(root, options, registryBefore);
  const scanned = await scanFleetProjects(root, options);
  const mergedProjects = await mergeFleetProjects(scanned, registryScope.projects);
  const projects = [];

  for (const project of mergedProjects) {
    const plannedAction = plannedFleetAction(project.category, options);
    const item = {
      ...project,
      plannedAction,
      status: plannedAction === 'skip' ? 'skipped' : (dryRun ? 'planned' : 'skipped'),
      ok: true,
      changes: [],
      errors: [],
      workUnits: null,
    };

    if (plannedAction === 'skip' || plannedAction === 'report') {
      item.status = dryRun ? 'planned' : 'skipped';
      projects.push(item);
      continue;
    }

    if (dryRun) {
      if (plannedAction === 'backfill-work-units' && backfillWorkUnitsWorkspace) {
        const backfill = await backfillWorkUnitsWorkspace(project.path, { dryRun: true });
        item.workUnits = {
          totalVersions: backfill.totalVersions,
          changedVersions: backfill.changedVersions,
        };
        item.changes = backfill.changes.map((change) => ({ ...change, source: 'work-unit' }));
        item.errors = backfill.errors ?? [];
        item.ok = backfill.ok;
      }
      projects.push(item);
      continue;
    }

    try {
      if (plannedAction === 'update') {
        const update = await updateAgentIntegrationWorkspace(project.path, {
          tools: options.tools ?? 'all',
          hookProfile: options.hookProfile,
          force: Boolean(options.force),
          enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
          codexHome: options.codexHome,
          openprdHome: options.openprdHome,
        });
        const backfill = backfillWorkUnitsWorkspace
          ? await backfillWorkUnitsWorkspace(project.path, {})
          : { ok: true, changes: [], errors: [], totalVersions: 0, changedVersions: 0 };
        const health = await collectFleetProjectHealth(project.path, options, doctorWorkspace);
        item.status = update.ok && backfill.ok ? 'updated' : 'failed';
        item.ok = update.ok && backfill.ok;
        item.registry = update.registry ?? null;
        item.changes = [
          ...(update.migration?.changes ?? []).map((change) => ({ ...change, source: 'workspace' })),
          ...(update.changes ?? []).map((change) => ({ ...change, source: 'agent' })),
          ...(backfill.changes ?? []).map((change) => ({ ...change, source: 'work-unit' })),
        ];
        item.doctorOk = health.ok;
        item.healthOk = health.ok;
        item.healthErrors = health.errors;
        item.workUnits = {
          totalVersions: backfill.totalVersions,
          changedVersions: backfill.changedVersions,
        };
        item.errors = [...(update.doctor?.errors ?? []), ...(backfill.errors ?? [])];
      } else if (plannedAction === 'setup') {
        const setup = await setupAgentIntegrationWorkspace(project.path, {
          tools: options.tools ?? 'all',
          hookProfile: options.hookProfile,
          force: Boolean(options.force),
          enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
          codexHome: options.codexHome,
          openprdHome: options.openprdHome,
        });
        item.status = setup.ok ? 'setup' : 'failed';
        item.ok = setup.ok;
        item.registry = setup.registry ?? null;
        item.changes = [
          ...(setup.migration?.changes ?? []).map((change) => ({ ...change, source: 'workspace' })),
          ...(setup.changes ?? []).map((change) => ({ ...change, source: 'agent' })),
        ];
        item.errors = setup.doctor?.errors ?? [];
      } else if (plannedAction === 'doctor') {
        const doctor = await doctorWorkspace(project.path, {
          tools: options.tools ?? 'all',
          hookProfile: options.hookProfile,
          enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
          codexHome: options.codexHome,
          openprdHome: options.openprdHome,
        });
        item.status = doctor.ok ? 'doctored' : 'failed';
        item.ok = doctor.ok;
        item.doctorOk = doctor.ok;
        item.errors = doctor.errors ?? [];
      } else if (plannedAction === 'backfill-work-units') {
        if (!backfillWorkUnitsWorkspace) {
          throw new Error('Missing fleet dependency: backfillWorkUnitsWorkspace');
        }
        const backfill = await backfillWorkUnitsWorkspace(project.path, {});
        item.status = backfill.ok ? (backfill.totalVersions > 0 ? 'backfilled' : 'skipped') : 'failed';
        item.ok = backfill.ok;
        item.workUnits = {
          totalVersions: backfill.totalVersions,
          changedVersions: backfill.changedVersions,
        };
        item.changes = (backfill.changes ?? []).map((change) => ({ ...change, source: 'work-unit' }));
        item.errors = backfill.errors ?? [];
      } else if (plannedAction === 'sync-registry') {
        const registrySync = await upsertWorkspaceRegistryEntry(project.path, {
          openprdHome: options.openprdHome,
          action: 'fleet-sync',
        });
        item.status = 'synced';
        item.registry = registrySync;
      }
    } catch (error) {
      item.status = 'failed';
      item.ok = false;
      item.errors = [error instanceof Error ? error.message : String(error)];
    }
    projects.push(item);
  }

  const registryAfter = await readWorkspaceRegistry({ openprdHome: options.openprdHome });
  const registrySummary = buildFleetRegistrySummary(root, options, registryAfter);
  const result = {
    ok: projects.every((project) => project.ok),
    action: 'fleet',
    root,
    dryRun,
    tools: options.tools ?? 'all',
    hookProfile: options.hookProfile ?? 'lite',
    maxDepth: parsePositiveInteger(options.maxDepth, FLEET_DEFAULT_MAX_DEPTH),
    include: normalizeCsvList(options.include),
    exclude: normalizeCsvList(options.exclude),
    requestedActions: {
      updateOpenprd: Boolean(options.updateOpenprd),
      setupMissing: Boolean(options.setupMissing),
      doctor: Boolean(options.doctor),
      backfillWorkUnits: Boolean(options.backfillWorkUnits),
      syncRegistry: Boolean(options.syncRegistry),
    },
    scannedAt: timestamp(),
    summary: summarizeFleetProjects(projects),
    registry: registrySummary,
    projects,
    errors: projects.flatMap((project) => project.errors.map((error) => `${project.relativePath}: ${error}`)),
    healthErrors: projects.flatMap((project) => (project.healthErrors ?? []).map((error) => `${project.relativePath}: ${error}`)),
  };

  if (options.report) {
    const reportPath = path.resolve(options.report);
    await writeJson(reportPath, result);
    result.reportPath = reportPath;
  }

  return result;
}

function createFleetWorkspace(dependencies) {
  return function fleetWorkspace(rootPath, options = {}) {
    return fleetWorkspaceImpl(rootPath, options, dependencies);
  };
}

export { createFleetWorkspace };
