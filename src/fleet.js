import fs from 'node:fs/promises';
import path from 'node:path';
import { cjoin, exists, writeJson } from './fs-utils.js';
import { SOURCE_INVENTORY_IGNORE_DIRS } from './source-inventory.js';
import { timestamp } from './time.js';

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
    if (options.doctor) {
      return 'doctor';
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
  return projects.sort((a, b) => a.path.localeCompare(b.path));
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
    skipped: 0,
    failed: 0,
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
    } else if (project.status === 'failed') {
      summary.failed += 1;
    } else if (project.status === 'skipped') {
      summary.skipped += 1;
    }
  }
  return summary;
}

async function fleetWorkspaceImpl(rootPath, options = {}, dependencies = {}) {
  const {
    doctorWorkspace,
    setupAgentIntegrationWorkspace,
    updateAgentIntegrationWorkspace,
  } = dependencies;
  const root = path.resolve(rootPath);
  if (!(await exists(root))) {
    throw new Error(`Fleet root does not exist: ${root}`);
  }

  const dryRun = Boolean(options.dryRun) || (!options.updateOpenprd && !options.setupMissing && !options.doctor);
  const scanned = await scanFleetProjects(root, options);
  const projects = [];

  for (const project of scanned) {
    const plannedAction = plannedFleetAction(project.category, options);
    const item = {
      ...project,
      plannedAction,
      status: plannedAction === 'skip' ? 'skipped' : (dryRun ? 'planned' : 'skipped'),
      ok: true,
      changes: [],
      errors: [],
    };

    if (plannedAction === 'skip' || plannedAction === 'report') {
      item.status = dryRun ? 'planned' : 'skipped';
      projects.push(item);
      continue;
    }

    if (dryRun) {
      projects.push(item);
      continue;
    }

    try {
      if (plannedAction === 'update') {
        const update = await updateAgentIntegrationWorkspace(project.path, {
          tools: options.tools ?? 'all',
          force: Boolean(options.force),
          enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
          codexHome: options.codexHome,
        });
        const doctor = await doctorWorkspace(project.path, {
          tools: options.tools ?? 'all',
          enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
          codexHome: options.codexHome,
        });
        item.status = update.ok && doctor.ok ? 'updated' : 'failed';
        item.ok = update.ok && doctor.ok;
        item.changes = [
          ...(update.migration?.changes ?? []).map((change) => ({ ...change, source: 'workspace' })),
          ...(update.changes ?? []).map((change) => ({ ...change, source: 'agent' })),
        ];
        item.doctorOk = doctor.ok;
        item.errors = [...(update.doctor?.errors ?? []), ...(doctor.errors ?? [])];
      } else if (plannedAction === 'setup') {
        const setup = await setupAgentIntegrationWorkspace(project.path, {
          tools: options.tools ?? 'all',
          force: Boolean(options.force),
          enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
          codexHome: options.codexHome,
        });
        item.status = setup.ok ? 'setup' : 'failed';
        item.ok = setup.ok;
        item.changes = [
          ...(setup.migration?.changes ?? []).map((change) => ({ ...change, source: 'workspace' })),
          ...(setup.changes ?? []).map((change) => ({ ...change, source: 'agent' })),
        ];
        item.errors = setup.doctor?.errors ?? [];
      } else if (plannedAction === 'doctor') {
        const doctor = await doctorWorkspace(project.path, {
          tools: options.tools ?? 'all',
          enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
          codexHome: options.codexHome,
        });
        item.status = doctor.ok ? 'doctored' : 'failed';
        item.ok = doctor.ok;
        item.doctorOk = doctor.ok;
        item.errors = doctor.errors ?? [];
      }
    } catch (error) {
      item.status = 'failed';
      item.ok = false;
      item.errors = [error instanceof Error ? error.message : String(error)];
    }
    projects.push(item);
  }

  const result = {
    ok: projects.every((project) => project.ok),
    action: 'fleet',
    root,
    dryRun,
    tools: options.tools ?? 'all',
    maxDepth: parsePositiveInteger(options.maxDepth, FLEET_DEFAULT_MAX_DEPTH),
    include: normalizeCsvList(options.include),
    exclude: normalizeCsvList(options.exclude),
    requestedActions: {
      updateOpenprd: Boolean(options.updateOpenprd),
      setupMissing: Boolean(options.setupMissing),
      doctor: Boolean(options.doctor),
    },
    scannedAt: timestamp(),
    summary: summarizeFleetProjects(projects),
    projects,
    errors: projects.flatMap((project) => project.errors.map((error) => `${project.relativePath}: ${error}`)),
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
