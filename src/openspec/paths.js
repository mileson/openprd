import fs from 'node:fs/promises';
import path from 'node:path';
import {
  LEGACY_OPENSPEC_CHANGE_ROOT,
  LEGACY_OPENSPEC_DISCOVERY_CONFIG_PATH,
  LEGACY_OPENSPEC_DISCOVERY_DIR,
  OPENPRD_ACCEPTED_SPEC_ROOT,
  OPENPRD_ARCHIVE_CHANGE_ROOT,
  OPENPRD_CHANGE_ROOT,
  OPENPRD_DISCOVERY_CONFIG_PATH,
  OPENPRD_DISCOVERY_DIR,
} from './constants.js';

export function cjoin(...parts) {
  return path.join(...parts);
}

export function exists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

export function openPrdDiscoveryDir(projectRoot) {
  return cjoin(projectRoot, ...OPENPRD_DISCOVERY_DIR);
}

export function legacyOpenSpecDiscoveryDir(projectRoot) {
  return cjoin(projectRoot, ...LEGACY_OPENSPEC_DISCOVERY_DIR);
}

export function openPrdDiscoveryConfigPath(projectRoot) {
  return cjoin(projectRoot, ...OPENPRD_DISCOVERY_CONFIG_PATH);
}

export function legacyOpenSpecDiscoveryConfigPath(projectRoot) {
  return cjoin(projectRoot, ...LEGACY_OPENSPEC_DISCOVERY_CONFIG_PATH);
}

export async function readDiscoveryConfig(projectRoot, readJson) {
  const primary = openPrdDiscoveryConfigPath(projectRoot);
  const legacy = legacyOpenSpecDiscoveryConfigPath(projectRoot);
  return (await readJson(primary).catch(() => null))
    ?? (await readJson(legacy).catch(() => null))
    ?? {};
}

export function openPrdChangeRoot(projectRoot) {
  return cjoin(projectRoot, ...OPENPRD_CHANGE_ROOT);
}

export function legacyOpenSpecChangeRoot(projectRoot) {
  return cjoin(projectRoot, ...LEGACY_OPENSPEC_CHANGE_ROOT);
}

export function openPrdAcceptedSpecRoot(projectRoot) {
  return cjoin(projectRoot, ...OPENPRD_ACCEPTED_SPEC_ROOT);
}

export function openPrdArchiveChangeRoot(projectRoot) {
  return cjoin(projectRoot, ...OPENPRD_ARCHIVE_CHANGE_ROOT);
}

export async function resolveChangeDir(projectRoot, changeId) {
  const candidates = [
    cjoin(openPrdChangeRoot(projectRoot), changeId),
    cjoin(legacyOpenSpecChangeRoot(projectRoot), changeId),
    cjoin(openPrdArchiveChangeRoot(projectRoot), changeId),
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return cjoin(openPrdChangeRoot(projectRoot), changeId);
}

export async function listChangeDirs(projectRoot) {
  const roots = [
    { root: openPrdChangeRoot(projectRoot), source: 'openprd', archived: false },
    { root: legacyOpenSpecChangeRoot(projectRoot), source: 'legacy-openspec', archived: false },
    { root: openPrdArchiveChangeRoot(projectRoot), source: 'openprd-archive', archived: true },
  ];
  const changes = [];
  const seen = new Set();

  for (const entryRoot of roots) {
    let entries = [];
    try {
      entries = await fs.readdir(entryRoot.root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }
      const key = `${entry.name}:${entryRoot.source}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      changes.push({
        id: entry.name,
        source: entryRoot.source,
        archived: entryRoot.archived,
        changeDir: cjoin(entryRoot.root, entry.name),
      });
    }
  }

  return changes.sort((a, b) => a.id.localeCompare(b.id) || a.source.localeCompare(b.source));
}
