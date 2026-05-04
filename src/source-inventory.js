import fs from 'node:fs/promises';
import path from 'node:path';
import { cjoin, exists } from './fs-utils.js';
import { timestamp } from './time.js';

const SOURCE_INVENTORY_IGNORE_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.openprd',
  '.openspec',
  '.next',
  '.turbo',
  '.cache',
  '.env',
  '.eggs',
  '.mypy_cache',
  '.parcel-cache',
  '.pytest_cache',
  '.ruff_cache',
  '.tox',
  '.venv',
  '.vite',
  '.vscode',
  'coverage',
  'dist',
  'env',
  'build',
  'node_modules',
  'vendor',
  'venv',
  '__pycache__',
]);
const SOURCE_INVENTORY_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.go',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.md',
  '.mjs',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.vue',
  '.yaml',
  '.yml',
]);
const SOURCE_INVENTORY_SPECIAL_FILES = new Set([
  'Dockerfile',
  'Makefile',
  'Procfile',
  'README',
  'LICENSE',
  'AGENTS.md',
  'CLAUDE.md',
]);

function shouldIgnoreSourceDirectory(name) {
  const normalized = String(name ?? '').toLowerCase();
  return SOURCE_INVENTORY_IGNORE_DIRS.has(normalized)
    || /^\.?venv(?:[-_].*)?$/.test(normalized)
    || /^env(?:[-_].*)?$/.test(normalized);
}

function shouldInventorySourceFile(name) {
  if (SOURCE_INVENTORY_SPECIAL_FILES.has(name)) {
    return true;
  }
  return SOURCE_INVENTORY_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function compareSourceInventoryEntries(a, b) {
  const aHidden = a.name.startsWith('.');
  const bHidden = b.name.startsWith('.');
  if (aHidden !== bHidden) {
    return aHidden ? 1 : -1;
  }
  if (a.isDirectory() !== b.isDirectory()) {
    return a.isDirectory() ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

function classifyInventoryFile(relativePath) {
  const lower = relativePath.toLowerCase();
  const base = path.basename(lower);
  if (base.includes('test') || base.includes('spec') || lower.includes('/test/') || lower.includes('/tests/')) {
    return 'test';
  }
  if (lower.endsWith('.md') || lower.includes('/docs/') || base === 'readme') {
    return 'document';
  }
  if (['package.json', 'tsconfig.json', 'vite.config.ts', 'next.config.js', 'dockerfile', 'makefile'].includes(base) || lower.endsWith('.yaml') || lower.endsWith('.yml') || lower.endsWith('.toml')) {
    return 'configuration';
  }
  if (lower.includes('/schema/') || lower.endsWith('.sql')) {
    return 'schema';
  }
  return 'implementation';
}

function sourceLanguage(relativePath) {
  const ext = path.extname(relativePath).toLowerCase().replace('.', '');
  if (!ext) {
    return path.basename(relativePath);
  }
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return 'javascript';
  if (['ts', 'tsx'].includes(ext)) return 'typescript';
  if (['yml', 'yaml'].includes(ext)) return 'yaml';
  if (ext === 'md') return 'markdown';
  return ext;
}

async function collectSourceInventory(sourceRoot, options = {}) {
  const maxDepth = Number(options.maxDepth ?? 6);
  const maxFiles = Number(options.maxFiles ?? 250);
  const files = [];
  const directories = [];
  const languageBreakdown = {};
  let truncated = false;

  if (!(await exists(sourceRoot))) {
    throw new Error(`Missing source root for OpenPrd discovery: ${sourceRoot}`);
  }

  async function walk(currentDir, depth) {
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }

    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort(compareSourceInventoryEntries);

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }

      const absolutePath = cjoin(currentDir, entry.name);
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (!relativePath || relativePath.startsWith('..')) {
        continue;
      }

      if (entry.isDirectory()) {
        if (shouldIgnoreSourceDirectory(entry.name)) {
          continue;
        }
        directories.push(relativePath);
        if (depth < maxDepth) {
          await walk(absolutePath, depth + 1);
        } else {
          truncated = true;
        }
        continue;
      }

      if (!entry.isFile() || !shouldInventorySourceFile(entry.name)) {
        continue;
      }

      let stats = null;
      try {
        stats = await fs.stat(absolutePath);
      } catch {
        stats = null;
      }

      const language = sourceLanguage(relativePath);
      languageBreakdown[language] = (languageBreakdown[language] ?? 0) + 1;
      files.push({
        path: relativePath,
        kind: classifyInventoryFile(relativePath),
        language,
        sizeBytes: stats?.size ?? null,
      });
    }
  }

  await walk(sourceRoot, 0);

  return {
    version: 1,
    generatedAt: timestamp(),
    sourceRoot,
    summary: {
      files: files.length,
      directories: directories.length,
      truncated,
      languageBreakdown,
      topLevelDirectories: [...new Set(directories.map((dir) => dir.split(path.sep)[0]))].slice(0, 30),
    },
    files,
    directories,
  };
}


export {
  SOURCE_INVENTORY_IGNORE_DIRS,
  collectSourceInventory,
  shouldIgnoreSourceDirectory
};
