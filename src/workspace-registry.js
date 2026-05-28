import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appendJsonl, cjoin, exists, readJson, readJsonl } from './fs-utils.js';
import { timestamp } from './time.js';

const OPENPRD_WORKSPACE_MARKER = '.openprd';
const OPENPRD_HARNESS_MANIFEST = cjoin('.openprd', 'harness', 'install-manifest.json');
const OPENPRD_WORKSPACE_REGISTRY = cjoin('registry', 'workspaces.jsonl');

function normalizeToolsArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeWorkspaceRegistryEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }
  const workspaceRoot = entry.workspaceRoot ? path.resolve(String(entry.workspaceRoot)) : null;
  if (!workspaceRoot) {
    return null;
  }
  const realpath = entry.realpath ? path.resolve(String(entry.realpath)) : workspaceRoot;
  const manifestPath = entry.manifestPath
    ? path.resolve(String(entry.manifestPath))
    : cjoin(workspaceRoot, OPENPRD_HARNESS_MANIFEST);
  const lastUpdatedAt = entry.lastUpdatedAt ?? entry.generatedAt ?? entry.recordedAt ?? null;
  const firstRegisteredAt = entry.firstRegisteredAt ?? entry.recordedAt ?? lastUpdatedAt;
  return {
    version: 1,
    workspaceRoot,
    realpath,
    workspaceName: entry.workspaceName ?? path.basename(workspaceRoot),
    manifestPath,
    openprdVersion: entry.openprdVersion ?? null,
    tools: normalizeToolsArray(entry.tools),
    hookProfile: entry.hookProfile ? String(entry.hookProfile) : null,
    initializedAt: entry.initializedAt ?? lastUpdatedAt,
    lastUpdatedAt,
    firstRegisteredAt,
    lastRegisteredAt: entry.lastRegisteredAt ?? entry.recordedAt ?? lastUpdatedAt,
    lastAction: entry.lastAction ?? entry.action ?? null,
    manifestPresent: entry.manifestPresent !== false,
  };
}

function resolveOpenPrdHome(options = {}) {
  return path.resolve(
    options.openprdHome
      ?? process.env.OPENPRD_HOME
      ?? cjoin(os.homedir(), '.openprd'),
  );
}

function workspaceRegistryFilePath(options = {}) {
  return cjoin(resolveOpenPrdHome(options), OPENPRD_WORKSPACE_REGISTRY);
}

async function buildWorkspaceRegistrySnapshot(projectRoot, options = {}) {
  const workspaceRoot = path.resolve(projectRoot);
  const realpath = await fs.realpath(workspaceRoot).catch(() => workspaceRoot);
  const manifestPath = cjoin(workspaceRoot, OPENPRD_HARNESS_MANIFEST);
  const manifest = options.manifest ?? await readJson(manifestPath).catch(() => null);
  const recordedAt = options.recordedAt ?? timestamp();

  return normalizeWorkspaceRegistryEntry({
    workspaceRoot,
    realpath,
    workspaceName: path.basename(workspaceRoot),
    manifestPath,
    openprdVersion: options.openprdVersion ?? manifest?.openprdVersion ?? null,
    tools: normalizeToolsArray(options.tools ?? manifest?.tools),
    hookProfile: options.hookProfile ?? manifest?.hooks?.profile ?? null,
    initializedAt: manifest?.generatedAt ?? recordedAt,
    lastUpdatedAt: manifest?.generatedAt ?? recordedAt,
    lastRegisteredAt: recordedAt,
    lastAction: options.action ?? manifest?.action ?? 'detected',
    manifestPresent: manifest !== null,
    recordedAt,
  });
}

async function readWorkspaceRegistry(options = {}) {
  const home = resolveOpenPrdHome(options);
  const registryPath = workspaceRegistryFilePath({ openprdHome: home });
  const events = await readJsonl(registryPath).catch(() => []);
  const currentByKey = new Map();
  for (const event of events) {
    const entry = normalizeWorkspaceRegistryEntry(event);
    if (!entry) {
      continue;
    }
    currentByKey.set(entry.realpath || entry.workspaceRoot, entry);
  }

  const entries = Array.from(currentByKey.values())
    .sort((left, right) => left.workspaceRoot.localeCompare(right.workspaceRoot));

  const staleEntries = [];
  for (const entry of entries) {
    const workspaceExists = await exists(entry.workspaceRoot);
    const markerExists = workspaceExists && await exists(cjoin(entry.workspaceRoot, OPENPRD_WORKSPACE_MARKER));
    if (!markerExists) {
      staleEntries.push({
        ...entry,
        reason: workspaceExists ? 'missing-openprd-marker' : 'missing-path',
      });
    }
  }

  return {
    home,
    registryPath,
    totalEvents: events.length,
    entries,
    staleEntries,
  };
}

async function upsertWorkspaceRegistryEntry(projectRoot, options = {}) {
  const registry = await readWorkspaceRegistry(options);
  const snapshot = await buildWorkspaceRegistrySnapshot(projectRoot, options);
  const existing = registry.entries.find((entry) => entry.realpath === snapshot.realpath || entry.workspaceRoot === snapshot.workspaceRoot) ?? null;
  const recordedAt = options.recordedAt ?? timestamp();
  const entry = {
    ...existing,
    ...snapshot,
    version: 1,
    initializedAt: existing?.initializedAt ?? snapshot.initializedAt ?? recordedAt,
    firstRegisteredAt: existing?.firstRegisteredAt ?? recordedAt,
    lastRegisteredAt: recordedAt,
    lastUpdatedAt: snapshot.lastUpdatedAt ?? existing?.lastUpdatedAt ?? recordedAt,
    lastAction: snapshot.lastAction ?? existing?.lastAction ?? 'detected',
  };

  await appendJsonl(registry.registryPath, entry);
  return {
    home: registry.home,
    registryPath: registry.registryPath,
    entry,
    status: existing ? 'updated' : 'created',
    knownTotal: existing ? registry.entries.length : registry.entries.length + 1,
  };
}

export {
  readWorkspaceRegistry,
  resolveOpenPrdHome,
  upsertWorkspaceRegistryEntry,
  workspaceRegistryFilePath,
};
