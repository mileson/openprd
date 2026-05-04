import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { analyzePrdSnapshot, buildPrdSnapshot, diffSnapshots, formatVersionId, getRequiredFieldDescriptors, renderPrdMarkdown, summarizeSnapshot } from './prd-core.js';
import { buildDiagramArtifact, renderDiagramArtifactFromModel, renderDiagramMermaidFromModel, validateDiagramContract, validateDiagramLanguage } from './diagram-core.js';
import { validateOpenSpecChangeWorkspace } from './openspec/change-validate.js';
import { generateOpenSpecChangeWorkspace as writeOpenSpecChangeWorkspace } from './openspec/generate.js';
import { advanceOpenSpecTaskWorkspace, listOpenSpecTaskWorkspace, verifyOpenSpecTaskWorkspace } from './openspec/execute.js';
import { analyzeOpenSpecTaskVolumes } from './openspec/tasks.js';
import { activateOpenPrdChangeWorkspace, applyOpenPrdChangeWorkspace, archiveOpenPrdChangeWorkspace, closeOpenPrdChangeWorkspace, listAcceptedSpecsWorkspace, listOpenPrdChangesWorkspace } from './openspec/change-lifecycle.js';
import { legacyOpenSpecDiscoveryDir, openPrdDiscoveryDir, readDiscoveryConfig } from './openspec/paths.js';
import { checkStandardsWorkspace, initStandardsWorkspace } from './standards.js';
import { doctorOpenPrdAgentIntegration, setupOpenPrdAgentIntegration, updateOpenPrdAgentIntegration } from './agent-integration.js';
import { finishLoopWorkspace, initLoopWorkspace, nextLoopWorkspace, planLoopWorkspace, promptLoopWorkspace, runLoopWorkspace, statusLoopWorkspace, verifyLoopWorkspace } from './loop.js';
import { compactTimestamp, timestamp } from './time.js';

const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SEED_WORKSPACE = path.join(PACKAGE_ROOT, '.openprd');
const REQUIRED_PRODUCT_TYPES = ['consumer', 'b2b', 'agent'];
const REQUIRED_SECTIONS = ['meta', 'problem', 'users', 'goals', 'scope', 'scenarios', 'requirements', 'constraints', 'risks', 'handoff'];
const OPENSPEC_DISCOVERY_MODES = ['brownfield', 'reference', 'requirement'];
const OPENSPEC_DISCOVERY_COVERAGE_STATUSES = ['pending', 'covered', 'blocked'];
const OPENSPEC_DISCOVERY_DEFAULT_MAX_ITERATIONS = 10;
const FLEET_DEFAULT_MAX_DEPTH = 4;
const OPENPRD_HARNESS_DIR = cjoin('.openprd', 'harness');
const OPENPRD_HARNESS_RUN_STATE = cjoin(OPENPRD_HARNESS_DIR, 'run-state.json');
const OPENPRD_HARNESS_ITERATIONS = cjoin(OPENPRD_HARNESS_DIR, 'iterations.jsonl');
const OPENPRD_HARNESS_LEARNINGS = cjoin(OPENPRD_HARNESS_DIR, 'learnings.md');
const OPENPRD_HARNESS_LOOP_FEATURE_LIST = cjoin(OPENPRD_HARNESS_DIR, 'feature-list.json');
const OPENPRD_LOOP_REQUIRED_TASK_THRESHOLD = 5;
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

const CORE_TEMPLATE_FILES = [
  'README.md',
  'config.yaml',
  'schema/prd.schema.yaml',
  'schema/diagram-architecture.schema.yaml',
  'schema/diagram-product-flow.schema.yaml',
  'templates/manifest.yaml',
  'templates/base/prd.md',
  'templates/base/intake.md',
  'templates/diagram/architecture.contract.json',
  'templates/diagram/product-flow.contract.json',
  'templates/consumer/prd.md',
  'templates/consumer/intake.md',
  'templates/b2b/prd.md',
  'templates/b2b/intake.md',
  'templates/agent/prd.md',
  'templates/agent/intake.md',
  'templates/company/README.md',
  'templates/industry/README.md',
  'templates/project/README.md',
  'templates/session/README.md',
  'standards/config.json',
  'standards/file-manual-template.md',
  'standards/folder-readme-template.md',
  'engagements/active/intake.md',
  'engagements/active/prd.md',
  'engagements/active/flows.md',
  'engagements/active/roles.md',
  'engagements/active/handoff.md',
  'engagements/active/decision-log.md',
  'engagements/active/open-questions.md',
  'engagements/active/progress.md',
  'engagements/active/verification.md',
  'state/task-graph.json',
  'state/events.jsonl',
];
const WORKSPACE_SEED_REFRESH_FILES = [
  'README.md',
  'schema/prd.schema.yaml',
  'schema/diagram-architecture.schema.yaml',
  'schema/diagram-product-flow.schema.yaml',
  'templates/manifest.yaml',
  'templates/base/prd.md',
  'templates/base/intake.md',
  'templates/diagram/architecture.contract.json',
  'templates/diagram/product-flow.contract.json',
  'templates/consumer/prd.md',
  'templates/consumer/intake.md',
  'templates/b2b/prd.md',
  'templates/b2b/intake.md',
  'templates/agent/prd.md',
  'templates/agent/intake.md',
  'templates/company/README.md',
  'templates/industry/README.md',
  'templates/project/README.md',
  'templates/session/README.md',
  'standards/config.json',
  'standards/file-manual-template.md',
  'standards/folder-readme-template.md',
];
const WORKSPACE_SEED_COPY_IGNORE = new Set([
  'harness',
  'state',
  'sessions',
  'exports',
  'engagements/active/decision-log.md',
  'engagements/active/open-questions.md',
  'engagements/active/progress.md',
  'engagements/active/verification.md',
]);

function cjoin(...parts) {
  return path.join(...parts);
}

function exists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function readYaml(filePath) {
  const text = await readText(filePath);
  const parsed = YAML.parse(text);
  return parsed ?? {};
}

async function readJson(filePath) {
  const text = await readText(filePath);
  return JSON.parse(text);
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

async function appendText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, text, 'utf8');
}

async function writeYaml(filePath, value) {
  const text = YAML.stringify(value, { indent: 2, lineWidth: 100 });
  await writeText(filePath, text);
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function appendJsonl(filePath, value) {
  await appendText(filePath, `${JSON.stringify(value)}\n`);
}

async function readJsonl(filePath) {
  const text = await readText(filePath);
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function formatMarkdownLines(lines) {
  return lines.filter(Boolean).map((line) => `- ${line}`).join('\n');
}

function renderLogEntry(title, lines) {
  return `\n## ${title}\n\n${formatMarkdownLines(lines)}\n`;
}

function normalizeMarkdownTimestampHeadings(text) {
  return text.replace(/^##\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)\s*$/gm, (_match, isoValue) => {
    const parsed = new Date(isoValue);
    if (Number.isNaN(parsed.getTime())) {
      return `## ${isoValue}`;
    }
    return `## ${timestamp(parsed)}`;
  });
}

async function normalizeWorkspaceMarkdownTimestamps(projectRoot, changes) {
  const relativePaths = [
    'engagements/active/decision-log.md',
    'engagements/active/open-questions.md',
    'engagements/active/progress.md',
    'engagements/active/verification.md',
  ];
  for (const relativePath of relativePaths) {
    const targetPath = cjoin(projectRoot, '.openprd', relativePath);
    const current = await readText(targetPath).catch(() => null);
    if (current === null) {
      continue;
    }
    const next = normalizeMarkdownTimestampHeadings(current);
    if (next !== current) {
      await writeText(targetPath, next);
      changes.push({ path: cjoin('.openprd', relativePath), status: 'updated-timestamp-format' });
    }
  }
}

function buildWorkflowTaskGraph(snapshot = null, analysis = null, options = {}) {
  const productType = snapshot?.productType ?? null;
  const prdVersion = Number(snapshot?.versionNumber ?? snapshot?.prdVersion ?? 0);
  const isSynthesized = Boolean(snapshot?.digest || prdVersion > 0);
  const isFrozen = snapshot?.status === 'frozen';
  const isHandedOff = snapshot?.status === 'handed_off';
  const isInterviewComplete = Boolean(
    snapshot?.sections?.problem?.problemStatement
    && snapshot?.sections?.users?.primaryUsers?.length
    && snapshot?.sections?.goals?.goals?.length
  );

  const blockers = analysis?.missingFields?.map((field) => ({
    id: field.path,
    label: field.label,
    question: field.prompt,
    section: field.section,
    status: 'blocked',
  })) ?? [];
  const diagramState = options.diagramState ?? null;
  const diagramGateActive = Boolean(diagramState?.shouldGateFreeze);
  const clarificationState = options.clarificationState ?? null;
  const clarifyGateActive = Boolean(clarificationState?.shouldAskUser);

  const workflow = [
    {
      id: 'clarify',
      label: 'clarify',
      kind: 'workflow-step',
      status: clarifyGateActive ? 'ready' : 'done',
      dependsOn: [],
    },
    {
      id: 'classify',
      label: 'classify',
      kind: 'workflow-step',
      status: productType ? 'done' : (clarifyGateActive ? 'blocked' : 'ready'),
      dependsOn: ['clarify'],
    },
    {
      id: 'interview',
      label: 'interview',
      kind: 'workflow-step',
      status: isInterviewComplete || isSynthesized ? 'done' : (productType ? 'ready' : 'blocked'),
      dependsOn: ['classify'],
    },
    {
      id: 'synthesize',
      label: 'synthesize',
      kind: 'workflow-step',
      status: isSynthesized ? 'done' : (productType ? 'ready' : 'blocked'),
      dependsOn: ['classify', 'interview'],
    },
    {
      id: 'validate',
      label: 'validate',
      kind: 'workflow-step',
      status: isFrozen || isHandedOff ? 'done' : (isSynthesized ? 'ready' : 'blocked'),
      dependsOn: ['synthesize'],
    },
    {
      id: 'diagram',
      label: 'diagram',
      kind: 'workflow-step',
      status: !isSynthesized
        ? 'blocked'
        : (diagramGateActive ? 'ready' : 'done'),
      dependsOn: ['synthesize'],
    },
    {
      id: 'freeze',
      label: 'freeze',
      kind: 'workflow-step',
      status: isFrozen || isHandedOff ? 'done' : (snapshot?.digest && !diagramGateActive ? 'ready' : 'blocked'),
      dependsOn: diagramGateActive ? ['validate', 'diagram'] : ['validate'],
    },
    {
      id: 'handoff',
      label: 'handoff',
      kind: 'workflow-step',
      status: isHandedOff ? 'done' : (isFrozen ? 'ready' : 'blocked'),
      dependsOn: ['freeze'],
    },
    {
      id: 'archive',
      label: 'archive',
      kind: 'workflow-step',
      status: isHandedOff ? 'done' : 'blocked',
      dependsOn: ['handoff'],
    },
  ];

  const artifacts = [
    {
      id: 'decision-log',
      label: 'decision-log.md',
      kind: 'record',
      status: 'ready',
      dependsOn: [],
    },
    {
      id: 'open-questions',
      label: 'open-questions.md',
      kind: 'record',
      status: productType ? (analysis?.missingRequiredFields > 0 ? 'ready' : 'done') : 'ready',
      dependsOn: ['interview'],
    },
    {
      id: 'progress',
      label: 'progress.md',
      kind: 'record',
      status: isSynthesized || isFrozen || isHandedOff ? 'done' : 'ready',
      dependsOn: ['classify'],
    },
    {
      id: 'verification',
      label: 'verification.md',
      kind: 'record',
      status: isFrozen || isHandedOff ? 'done' : 'ready',
      dependsOn: ['freeze'],
    },
    {
      id: 'architecture-diagram',
      label: 'architecture-diagram.html',
      kind: 'artifact',
      status: diagramState?.architecture?.exists ? 'done' : (isSynthesized ? 'ready' : 'blocked'),
      dependsOn: ['diagram'],
    },
    {
      id: 'product-flow-diagram',
      label: 'product-flow-diagram.html',
      kind: 'artifact',
      status: diagramState?.productFlow?.exists ? 'done' : (isSynthesized ? 'ready' : 'blocked'),
      dependsOn: ['diagram'],
    },
    {
      id: 'prd',
      label: 'prd.md',
      kind: 'artifact',
      status: isSynthesized || isFrozen || isHandedOff ? 'done' : 'ready',
      dependsOn: ['synthesize'],
    },
    {
      id: 'flows',
      label: 'flows.md',
      kind: 'artifact',
      status: isSynthesized || isFrozen || isHandedOff ? 'done' : 'ready',
      dependsOn: ['synthesize'],
    },
    {
      id: 'roles',
      label: 'roles.md',
      kind: 'artifact',
      status: isSynthesized || isFrozen || isHandedOff ? 'done' : 'ready',
      dependsOn: ['synthesize'],
    },
    {
      id: 'handoff',
      label: 'handoff.md',
      kind: 'artifact',
      status: isHandedOff ? 'done' : (isFrozen ? 'ready' : 'blocked'),
      dependsOn: ['freeze'],
    },
  ];

  let nextReadyNode = 'classify';
  if (clarifyGateActive) {
    nextReadyNode = 'clarify';
  } else if (!productType) {
    nextReadyNode = 'classify';
  } else if (analysis?.missingRequiredFields > 0) {
    nextReadyNode = 'interview';
  } else if (diagramGateActive) {
    nextReadyNode = 'diagram';
  } else if (isFrozen) {
    nextReadyNode = 'handoff';
  } else if (isHandedOff) {
    nextReadyNode = 'archive';
  } else if (isSynthesized) {
    nextReadyNode = 'freeze';
  } else {
    nextReadyNode = 'synthesize';
  }

  return {
    version: 1,
    generatedAt: timestamp(),
    nextReadyNode,
    workflow,
    artifacts,
    nodes: [
      ...workflow.map((step) => ({
        id: step.id,
        label: step.label,
        kind: step.kind,
        status: step.status,
        dependsOn: step.dependsOn,
      })),
      ...artifacts.map((artifact) => ({
        id: artifact.id,
        label: artifact.label,
        kind: artifact.kind,
        status: artifact.status,
        dependsOn: artifact.dependsOn,
      })),
    ],
    edges: [
      { from: 'clarify', to: 'classify', relation: 'unblocks' },
      { from: 'classify', to: 'interview', relation: 'enables' },
      { from: 'interview', to: 'synthesize', relation: 'enables' },
      { from: 'synthesize', to: 'validate', relation: 'enables' },
      { from: 'synthesize', to: 'diagram', relation: 'enables' },
      { from: 'diagram', to: 'freeze', relation: 'confirms' },
      { from: 'validate', to: 'freeze', relation: 'guards' },
      { from: 'freeze', to: 'handoff', relation: 'enables' },
      { from: 'handoff', to: 'archive', relation: 'enables' },
      { from: 'interview', to: 'open-questions', relation: 'updates' },
      { from: 'synthesize', to: 'prd', relation: 'produces' },
      { from: 'synthesize', to: 'flows', relation: 'produces' },
      { from: 'synthesize', to: 'roles', relation: 'produces' },
      { from: 'diagram', to: 'architecture-diagram', relation: 'produces' },
      { from: 'diagram', to: 'product-flow-diagram', relation: 'produces' },
      { from: 'freeze', to: 'verification', relation: 'produces' },
      { from: 'freeze', to: 'handoff', relation: 'produces' },
    ],
    blockers,
  };
}

async function appendWorkflowEvent(ws, type, payload = {}) {
  await appendJsonl(ws.paths.eventsLog, {
    type,
    at: timestamp(),
    ...payload,
  });
}

async function appendDecision(ws, lines) {
  await appendText(ws.paths.decisionLog, renderLogEntry(timestamp(), lines));
}

async function appendProgress(ws, lines) {
  await appendText(ws.paths.progressLog, renderLogEntry(timestamp(), lines));
}

async function appendOpenQuestions(ws, lines) {
  await appendText(ws.paths.openQuestionsLog, renderLogEntry(timestamp(), lines));
}

async function appendVerification(ws, lines) {
  await appendText(ws.paths.verificationLog, renderLogEntry(timestamp(), lines));
}

function normalizeRelativePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function shouldIgnoreSeedCopy(relativePath, ignorePaths) {
  const normalized = normalizeRelativePath(relativePath);
  return ignorePaths.has(normalized)
    || [...ignorePaths].some((ignored) => normalized.startsWith(`${ignored}/`));
}

async function copyTree(sourceDir, targetDir, { overwrite = false, ignorePaths = new Set(), rootDir = sourceDir } = {}) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  let created = 0;

  await fs.mkdir(targetDir, { recursive: true });

  for (const entry of entries) {
    const sourcePath = cjoin(sourceDir, entry.name);
    const targetPath = cjoin(targetDir, entry.name);
    const relativePath = path.relative(rootDir, sourcePath);
    if (shouldIgnoreSeedCopy(relativePath, ignorePaths)) {
      continue;
    }

    if (entry.isDirectory()) {
      created += await copyTree(sourcePath, targetPath, { overwrite, ignorePaths, rootDir });
      continue;
    }

    if (!overwrite && await exists(targetPath)) {
      continue;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    created += 1;
  }

  return created;
}

async function ensureWorkspaceSkeleton(projectRoot, options = {}) {
  const workspaceRoot = cjoin(projectRoot, '.openprd');
  const created = await copyTree(SEED_WORKSPACE, workspaceRoot, {
    overwrite: Boolean(options.force),
    ignorePaths: WORKSPACE_SEED_COPY_IGNORE,
    rootDir: SEED_WORKSPACE,
  });
  await fs.mkdir(cjoin(workspaceRoot, 'state'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'state', 'versions'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'sessions'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'exports'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'engagements', 'active'), { recursive: true });

  const defaults = [
    [cjoin(workspaceRoot, 'engagements', 'active', 'decision-log.md'), '# 决策记录\n\n- 已初始化 OpenPrd 决策跟踪。\n'],
    [cjoin(workspaceRoot, 'engagements', 'active', 'open-questions.md'), '# 开放问题\n\n- 已初始化 OpenPrd 问题跟踪。\n'],
    [cjoin(workspaceRoot, 'engagements', 'active', 'progress.md'), '# 进度\n\n- 已初始化 OpenPrd 进度跟踪。\n'],
    [cjoin(workspaceRoot, 'engagements', 'active', 'verification.md'), '# 验证\n\n- 已初始化 OpenPrd 验证跟踪。\n'],
    [cjoin(workspaceRoot, 'state', 'task-graph.json'), JSON.stringify(buildWorkflowTaskGraph(), null, 2) + '\n'],
    [cjoin(workspaceRoot, 'state', 'events.jsonl'), ''],
  ];

  for (const [filePath, content] of defaults) {
    if (!(await exists(filePath))) {
      await writeText(filePath, content);
    }
  }

  return { workspaceRoot, created };
}

async function copySeedFileIfChanged(projectRoot, relativePath, changes) {
  const sourcePath = cjoin(SEED_WORKSPACE, relativePath);
  const targetPath = cjoin(projectRoot, '.openprd', relativePath);
  if (!(await exists(sourcePath))) {
    return;
  }
  const next = await readText(sourcePath);
  const current = await readText(targetPath).catch(() => null);
  if (current === next) {
    changes.push({ path: cjoin('.openprd', relativePath), status: 'unchanged' });
    return;
  }
  await writeText(targetPath, next);
  changes.push({ path: cjoin('.openprd', relativePath), status: current === null ? 'created' : 'updated' });
}

async function migrateWorkspaceConfig(projectRoot, changes) {
  const sourcePath = cjoin(SEED_WORKSPACE, 'config.yaml');
  const targetPath = cjoin(projectRoot, '.openprd', 'config.yaml');
  const seed = await readYaml(sourcePath);
  const current = await readYaml(targetPath).catch(() => ({}));
  const next = {
    ...seed,
    ...current,
    supportedProductTypes: seed.supportedProductTypes,
    templateInheritance: seed.templateInheritance,
    workflow: seed.workflow,
    qualityGates: {
      ...(seed.qualityGates ?? {}),
      ...(current.qualityGates ?? {}),
      standards: seed.qualityGates?.standards,
      freezeRequires: seed.qualityGates?.freezeRequires,
    },
  };
  const currentText = await readText(targetPath).catch(() => null);
  const nextText = YAML.stringify(next, { indent: 2, lineWidth: 100 });
  if (currentText !== nextText) {
    await writeText(targetPath, nextText);
    changes.push({ path: cjoin('.openprd', 'config.yaml'), status: currentText === null ? 'created' : 'updated' });
  } else {
    changes.push({ path: cjoin('.openprd', 'config.yaml'), status: 'unchanged' });
  }
}

function extractMarkdownSection(text, heading) {
  const start = text.indexOf(heading);
  if (start < 0) {
    return '';
  }
  const rest = text.slice(start);
  const nextHeading = rest.slice(heading.length).search(/\n##\s+/);
  if (nextHeading < 0) {
    return rest.trim();
  }
  return rest.slice(0, heading.length + nextHeading).trim();
}

async function ensureActiveFileContains(projectRoot, relativePath, requiredToken, seedFallback, changes) {
  const targetPath = cjoin(projectRoot, '.openprd', relativePath);
  const current = await readText(targetPath).catch(() => null);
  if (current?.includes(requiredToken)) {
    changes.push({ path: cjoin('.openprd', relativePath), status: 'unchanged' });
    return;
  }
  const next = current
    ? `${current.trimEnd()}\n\n---\n\n${seedFallback.trim()}\n`
    : `${seedFallback.trim()}\n`;
  await writeText(targetPath, next);
  changes.push({ path: cjoin('.openprd', relativePath), status: current === null ? 'created' : 'updated-append' });
}

async function ensureHeadingFile(projectRoot, relativePath, heading, fallbackBody, changes) {
  const targetPath = cjoin(projectRoot, '.openprd', relativePath);
  const current = await readText(targetPath).catch(() => null);
  if (current?.includes(heading)) {
    changes.push({ path: cjoin('.openprd', relativePath), status: 'unchanged' });
    return;
  }
  const next = current
    ? `${heading}\n\n${current.trim()}\n`
    : fallbackBody;
  await writeText(targetPath, next);
  changes.push({ path: cjoin('.openprd', relativePath), status: current === null ? 'created' : 'updated-prepend' });
}

async function migrateWorkspaceSkeleton(projectRoot, options = {}) {
  const changes = [];
  const workspaceRoot = cjoin(projectRoot, '.openprd');
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'state'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'state', 'versions'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'sessions'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'exports'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'engagements', 'active'), { recursive: true });

  await migrateWorkspaceConfig(projectRoot, changes);
  for (const relativePath of WORKSPACE_SEED_REFRESH_FILES) {
    await copySeedFileIfChanged(projectRoot, relativePath, changes);
  }

  const seedIntake = await readText(cjoin(SEED_WORKSPACE, 'engagements', 'active', 'intake.md'));
  const seedPrd = await readText(cjoin(SEED_WORKSPACE, 'engagements', 'active', 'prd.md'));
  const typeSpecificBlock = extractMarkdownSection(seedPrd, '## 类型专项模块') || seedPrd;
  await ensureActiveFileContains(projectRoot, 'engagements/active/intake.md', '我们要解决什么问题？', seedIntake, changes);
  await ensureActiveFileContains(projectRoot, 'engagements/active/prd.md', '类型专项模块', typeSpecificBlock, changes);
  await ensureHeadingFile(projectRoot, 'engagements/active/decision-log.md', '# 决策记录', '# 决策记录\n\n- 已初始化 OpenPrd 决策跟踪。\n', changes);
  await ensureHeadingFile(projectRoot, 'engagements/active/open-questions.md', '# 开放问题', '# 开放问题\n\n- 已初始化 OpenPrd 问题跟踪。\n', changes);
  await ensureHeadingFile(projectRoot, 'engagements/active/progress.md', '# 进度', '# 进度\n\n- 已初始化 OpenPrd 进度跟踪。\n', changes);
  await ensureHeadingFile(projectRoot, 'engagements/active/verification.md', '# 验证', '# 验证\n\n- 已初始化 OpenPrd 验证跟踪。\n', changes);
  await normalizeWorkspaceMarkdownTimestamps(projectRoot, changes);

  const ws = await loadWorkspace(projectRoot);
  const taskGraphPath = cjoin(projectRoot, '.openprd', 'state', 'task-graph.json');
  const currentTaskGraph = await readText(taskGraphPath).catch(() => null);
  let shouldRewriteTaskGraph = currentTaskGraph === null;
  if (currentTaskGraph !== null) {
    try {
      const parsed = JSON.parse(currentTaskGraph);
      shouldRewriteTaskGraph = !Array.isArray(parsed.workflow) || !Array.isArray(parsed.nodes);
    } catch {
      shouldRewriteTaskGraph = true;
    }
  }
  if (shouldRewriteTaskGraph) {
    await writeJson(taskGraphPath, buildWorkflowTaskGraph(ws.data.currentState));
    changes.push({ path: cjoin('.openprd', 'state', 'task-graph.json'), status: currentTaskGraph === null ? 'created' : 'updated' });
  } else {
    changes.push({ path: cjoin('.openprd', 'state', 'task-graph.json'), status: 'unchanged' });
  }
  if (!(await exists(cjoin(projectRoot, '.openprd', 'state', 'events.jsonl')))) {
    await writeText(cjoin(projectRoot, '.openprd', 'state', 'events.jsonl'), '');
    changes.push({ path: cjoin('.openprd', 'state', 'events.jsonl'), status: 'created' });
  }

  const changedCount = changes.filter((change) => change.status !== 'unchanged').length;
  if (options.recordEvent && changedCount > 0) {
    const nextWs = await loadWorkspace(projectRoot);
    await appendWorkflowEvent(nextWs, 'workspace_migrated', {
      changed: changedCount,
    });
  }

  return {
    ok: true,
    action: 'migrate',
    projectRoot,
    workspaceRoot,
    changes,
  };
}

async function loadWorkspace(projectRoot) {
  const workspaceRoot = cjoin(projectRoot, '.openprd');
  const paths = {
    workspaceRoot,
    config: cjoin(workspaceRoot, 'config.yaml'),
    schema: cjoin(workspaceRoot, 'schema', 'prd.schema.yaml'),
    diagramArchitectureSchema: cjoin(workspaceRoot, 'schema', 'diagram-architecture.schema.yaml'),
    diagramProductFlowSchema: cjoin(workspaceRoot, 'schema', 'diagram-product-flow.schema.yaml'),
    manifest: cjoin(workspaceRoot, 'templates', 'manifest.yaml'),
    basePrd: cjoin(workspaceRoot, 'templates', 'base', 'prd.md'),
    baseIntake: cjoin(workspaceRoot, 'templates', 'base', 'intake.md'),
    diagramArchitectureTemplate: cjoin(workspaceRoot, 'templates', 'diagram', 'architecture.contract.json'),
    diagramProductFlowTemplate: cjoin(workspaceRoot, 'templates', 'diagram', 'product-flow.contract.json'),
    consumerPrd: cjoin(workspaceRoot, 'templates', 'consumer', 'prd.md'),
    consumerIntake: cjoin(workspaceRoot, 'templates', 'consumer', 'intake.md'),
    b2bPrd: cjoin(workspaceRoot, 'templates', 'b2b', 'prd.md'),
    b2bIntake: cjoin(workspaceRoot, 'templates', 'b2b', 'intake.md'),
    agentPrd: cjoin(workspaceRoot, 'templates', 'agent', 'prd.md'),
    agentIntake: cjoin(workspaceRoot, 'templates', 'agent', 'intake.md'),
    activeIntake: cjoin(workspaceRoot, 'engagements', 'active', 'intake.md'),
    activePrd: cjoin(workspaceRoot, 'engagements', 'active', 'prd.md'),
    activeFlows: cjoin(workspaceRoot, 'engagements', 'active', 'flows.md'),
    activeRoles: cjoin(workspaceRoot, 'engagements', 'active', 'roles.md'),
    activeHandoff: cjoin(workspaceRoot, 'engagements', 'active', 'handoff.md'),
    activeArchitectureDiagramHtml: cjoin(workspaceRoot, 'engagements', 'active', 'architecture-diagram.html'),
    activeArchitectureDiagramJson: cjoin(workspaceRoot, 'engagements', 'active', 'architecture-diagram.json'),
    activeArchitectureDiagramMermaid: cjoin(workspaceRoot, 'engagements', 'active', 'architecture-diagram.mmd'),
    activeProductFlowDiagramHtml: cjoin(workspaceRoot, 'engagements', 'active', 'product-flow-diagram.html'),
    activeProductFlowDiagramJson: cjoin(workspaceRoot, 'engagements', 'active', 'product-flow-diagram.json'),
    activeProductFlowDiagramMermaid: cjoin(workspaceRoot, 'engagements', 'active', 'product-flow-diagram.mmd'),
    decisionLog: cjoin(workspaceRoot, 'engagements', 'active', 'decision-log.md'),
    openQuestionsLog: cjoin(workspaceRoot, 'engagements', 'active', 'open-questions.md'),
    progressLog: cjoin(workspaceRoot, 'engagements', 'active', 'progress.md'),
    verificationLog: cjoin(workspaceRoot, 'engagements', 'active', 'verification.md'),
    stateDir: cjoin(workspaceRoot, 'state'),
    versionsDir: cjoin(workspaceRoot, 'state', 'versions'),
    versionIndex: cjoin(workspaceRoot, 'state', 'version-index.json'),
    currentState: cjoin(workspaceRoot, 'state', 'current.json'),
    freezeState: cjoin(workspaceRoot, 'state', 'freeze.json'),
    taskGraph: cjoin(workspaceRoot, 'state', 'task-graph.json'),
    eventsLog: cjoin(workspaceRoot, 'state', 'events.jsonl'),
    standardsConfig: cjoin(workspaceRoot, 'standards', 'config.json'),
    standardsFileManualTemplate: cjoin(workspaceRoot, 'standards', 'file-manual-template.md'),
    standardsFolderReadmeTemplate: cjoin(workspaceRoot, 'standards', 'folder-readme-template.md'),
    exportsDir: cjoin(workspaceRoot, 'exports'),
    openspecExportDir: cjoin(workspaceRoot, 'exports', 'openspec'),
    openspecHandoffJson: cjoin(workspaceRoot, 'exports', 'openspec', 'handoff.json'),
    openspecHandoffMd: cjoin(workspaceRoot, 'exports', 'openspec', 'handoff.md'),
  };

  const data = {
    config: await readYaml(paths.config).catch(() => null),
    schema: await readYaml(paths.schema).catch(() => null),
    diagramArchitectureSchema: await readYaml(paths.diagramArchitectureSchema).catch(() => null),
    diagramProductFlowSchema: await readYaml(paths.diagramProductFlowSchema).catch(() => null),
    manifest: await readYaml(paths.manifest).catch(() => null),
    currentState: await readJson(paths.currentState).catch(() => null),
    freezeState: await readJson(paths.freezeState).catch(() => null),
    versionIndex: await readJson(paths.versionIndex).catch(() => []),
  };

  return { projectRoot, workspaceRoot, paths, data };
}

function isSupportedProductType(value) {
  return REQUIRED_PRODUCT_TYPES.includes(value);
}

function resolveActiveTemplatePack(ws) {
  return ws.data.currentState?.templatePack ?? ws.data.config?.activeTemplatePack ?? 'base';
}

function resolveCurrentProductType(ws) {
  return ws.data.currentState?.productType ?? null;
}

const USER_CLARIFICATION_PATHS = new Set([
  'meta.productType',
  'problem.problemStatement',
  'problem.whyNow',
  'users.primaryUsers',
  'goals.goals',
  'goals.successMetrics',
  'scope.inScope',
  'scope.outOfScope',
  'scenarios.primaryFlows',
  'requirements.functional',
  'risks.openQuestions',
  'handoff.owner',
  'handoff.nextStep',
  'handoff.targetSystem',
  'typeSpecific.fields.humanAgentContract',
  'typeSpecific.fields.autonomyBoundary',
  'typeSpecific.fields.toolBoundary',
  'typeSpecific.fields.evalPlan',
  'typeSpecific.fields.persona',
  'typeSpecific.fields.journey',
  'typeSpecific.fields.roles',
  'typeSpecific.fields.asIs',
  'typeSpecific.fields.toBe',
]);

const FIELD_PATH_TO_STATE_KEY = {
  'meta.title': 'title',
  'meta.owner': 'owner',
  'meta.status': 'status',
  'meta.version': 'versionLabel',
  'meta.productType': 'productType',
  'problem.problemStatement': 'problemStatement',
  'problem.whyNow': 'whyNow',
  'problem.evidence': 'evidence',
  'users.primaryUsers': 'primaryUsers',
  'users.secondaryUsers': 'secondaryUsers',
  'users.stakeholders': 'stakeholders',
  'goals.goals': 'goals',
  'goals.successMetrics': 'successMetrics',
  'goals.acceptanceGoals': 'acceptanceGoals',
  'scope.inScope': 'inScope',
  'scope.outOfScope': 'outOfScope',
  'scenarios.primaryFlows': 'primaryFlows',
  'scenarios.edgeCases': 'edgeCases',
  'scenarios.failureModes': 'failureModes',
  'requirements.functional': 'functional',
  'requirements.nonFunctional': 'nonFunctional',
  'requirements.businessRules': 'businessRules',
  'constraints.technical': 'technical',
  'constraints.compliance': 'compliance',
  'constraints.dependencies': 'dependencies',
  'risks.assumptions': 'assumptions',
  'risks.risks': 'risks',
  'risks.openQuestions': 'openQuestions',
  'handoff.owner': 'handoffOwner',
  'handoff.nextStep': 'nextStep',
  'handoff.targetSystem': 'targetSystem',
  'typeSpecific.fields.persona': 'persona',
  'typeSpecific.fields.segment': 'segment',
  'typeSpecific.fields.journey': 'journey',
  'typeSpecific.fields.activationMetric': 'activationMetric',
  'typeSpecific.fields.retentionMetric': 'retentionMetric',
  'typeSpecific.fields.buyer': 'buyer',
  'typeSpecific.fields.user': 'user',
  'typeSpecific.fields.admin': 'admin',
  'typeSpecific.fields.operator': 'operator',
  'typeSpecific.fields.roles': 'roles',
  'typeSpecific.fields.asIs': 'asIs',
  'typeSpecific.fields.toBe': 'toBe',
  'typeSpecific.fields.permissionMatrix': 'permissionMatrix',
  'typeSpecific.fields.approvalFlow': 'approvalFlow',
  'typeSpecific.fields.humanAgentContract': 'humanAgentContract',
  'typeSpecific.fields.autonomyBoundary': 'autonomyBoundary',
  'typeSpecific.fields.toolBoundary': 'toolBoundary',
  'typeSpecific.fields.stateModel': 'stateModel',
  'typeSpecific.fields.evalPlan': 'evalPlan',
};

const CAPTURE_SOURCES = ['user-confirmed', 'project-derived', 'agent-inferred'];

function listMissing(actual, expected) {
  const actualSet = new Set(actual);
  return expected.filter((item) => !actualSet.has(item));
}

async function validateWorkspace(projectRoot) {
  const report = {
    valid: true,
    errors: [],
    warnings: [],
    checks: [],
  };

  const ws = await loadWorkspace(projectRoot);

  if (!(await exists(ws.workspaceRoot))) {
    report.valid = false;
    report.errors.push(`Missing workspace: ${ws.workspaceRoot}`);
    return { report, ws };
  }

  const requiredFiles = [
    ws.paths.config,
    ws.paths.schema,
    ws.paths.diagramArchitectureSchema,
    ws.paths.diagramProductFlowSchema,
    ws.paths.manifest,
    ws.paths.basePrd,
    ws.paths.baseIntake,
    ws.paths.diagramArchitectureTemplate,
    ws.paths.diagramProductFlowTemplate,
    ws.paths.consumerPrd,
    ws.paths.consumerIntake,
    ws.paths.b2bPrd,
    ws.paths.b2bIntake,
    ws.paths.agentPrd,
    ws.paths.agentIntake,
    ws.paths.activeIntake,
    ws.paths.activePrd,
    ws.paths.activeFlows,
    ws.paths.activeRoles,
    ws.paths.activeHandoff,
    ws.paths.decisionLog,
    ws.paths.openQuestionsLog,
    ws.paths.progressLog,
    ws.paths.verificationLog,
    ws.paths.taskGraph,
    ws.paths.eventsLog,
    ws.paths.standardsConfig,
    ws.paths.standardsFileManualTemplate,
    ws.paths.standardsFolderReadmeTemplate,
  ];

  const missingFiles = [];
  for (const filePath of requiredFiles) {
    if (!(await exists(filePath))) {
      missingFiles.push(path.relative(ws.workspaceRoot, filePath));
    }
  }
  if (missingFiles.length > 0) {
    report.valid = false;
    report.errors.push(`Missing required files: ${missingFiles.join(', ')}`);
  }

  if (!ws.data.config) {
    report.valid = false;
    report.errors.push('Failed to parse config.yaml');
    return { report, ws };
  }

  if (!ws.data.schema) {
    report.valid = false;
    report.errors.push('Failed to parse prd.schema.yaml');
    return { report, ws };
  }

  if (!ws.data.diagramArchitectureSchema) {
    report.valid = false;
    report.errors.push('Failed to parse diagram-architecture.schema.yaml');
    return { report, ws };
  }

  if (!ws.data.diagramProductFlowSchema) {
    report.valid = false;
    report.errors.push('Failed to parse diagram-product-flow.schema.yaml');
    return { report, ws };
  }

  if (!ws.data.manifest) {
    report.valid = false;
    report.errors.push('Failed to parse templates/manifest.yaml');
    return { report, ws };
  }

  const config = ws.data.config;
  const schema = ws.data.schema;
  const manifest = ws.data.manifest;

  if (config.schema !== schema.name) {
    report.valid = false;
    report.errors.push(`config.schema (${config.schema}) must match schema.name (${schema.name})`);
  }

  const missingTypes = listMissing(config.supportedProductTypes ?? [], REQUIRED_PRODUCT_TYPES);
  if (missingTypes.length > 0) {
    report.valid = false;
    report.errors.push(`config.supportedProductTypes is missing: ${missingTypes.join(', ')}`);
  }

  const inheritance = JSON.stringify(config.templateInheritance ?? []);
  const expectedInheritance = JSON.stringify(['base', 'industry', 'company', 'project', 'session']);
  if (inheritance !== expectedInheritance) {
    report.valid = false;
    report.errors.push('config.templateInheritance must equal base -> industry -> company -> project -> session');
  }

  const sections = Object.keys(schema.sections ?? {});
  const missingSections = listMissing(sections, REQUIRED_SECTIONS);
  if (missingSections.length > 0) {
    report.valid = false;
    report.errors.push(`schema.sections is missing: ${missingSections.join(', ')}`);
  }

  const extensions = Object.keys(schema.extensions ?? {});
  const missingExtensions = listMissing(extensions, REQUIRED_PRODUCT_TYPES);
  if (missingExtensions.length > 0) {
    report.valid = false;
    report.errors.push(`schema.extensions is missing: ${missingExtensions.join(', ')}`);
  }

  const registry = manifest.registry ?? {};
  const missingRegistry = listMissing(Object.keys(registry), ['base', 'consumer', 'b2b', 'agent']);
  if (missingRegistry.length > 0) {
    report.valid = false;
    report.errors.push(`manifest.registry is missing: ${missingRegistry.join(', ')}`);
  }

  if (registry.base?.path !== 'base/prd.md') {
    report.valid = false;
    report.errors.push('manifest.registry.base.path must be base/prd.md');
  }

  for (const key of ['consumer', 'b2b', 'agent']) {
    const entry = registry[key];
    if (!entry || !Array.isArray(entry.extends) || entry.extends.length !== 1 || entry.extends[0] !== 'base') {
      report.valid = false;
      report.errors.push(`manifest.registry.${key}.extends must be ["base"]`);
    }
  }

  const basePrd = await readText(ws.paths.basePrd);
  for (const section of ['元信息', '问题', '用户与相关方', '目标与成功标准', '范围与非目标', '场景与流程', '需求', '约束、依赖与风险', '交接']) {
    if (!basePrd.includes(section)) {
      report.valid = false;
      report.errors.push(`templates/base/prd.md is missing section heading: ${section}`);
    }
  }

  const consumerPrd = await readText(ws.paths.consumerPrd);
  for (const token of ['用户画像', '用户分层', '用户旅程', '激活指标', '留存指标']) {
    if (!consumerPrd.includes(token)) {
      report.valid = false;
      report.errors.push(`templates/consumer/prd.md is missing field: ${token}`);
    }
  }

  const b2bPrd = await readText(ws.paths.b2bPrd);
  for (const token of ['采购方', '使用者', '管理员', '运营者', '权限矩阵', '审批流程']) {
    if (!b2bPrd.includes(token)) {
      report.valid = false;
      report.errors.push(`templates/b2b/prd.md is missing field: ${token}`);
    }
  }

  const agentPrd = await readText(ws.paths.agentPrd);
  for (const token of ['Human-Agent contract', '自主边界', '工具边界', '状态模型', '评估计划']) {
    if (!agentPrd.includes(token)) {
      report.valid = false;
      report.errors.push(`templates/agent/prd.md is missing field: ${token}`);
    }
  }

  const architectureTemplate = await readJson(ws.paths.diagramArchitectureTemplate).catch(() => null);
  if (!architectureTemplate || architectureTemplate.type !== 'architecture') {
    report.valid = false;
    report.errors.push('templates/diagram/architecture.contract.json is missing or invalid');
  }

  const productFlowTemplate = await readJson(ws.paths.diagramProductFlowTemplate).catch(() => null);
  if (!productFlowTemplate || productFlowTemplate.type !== 'product-flow') {
    report.valid = false;
    report.errors.push('templates/diagram/product-flow.contract.json is missing or invalid');
  }

  const activeIntake = await readText(ws.paths.activeIntake);
  if (!activeIntake.includes('我们要解决什么问题？')) {
    report.valid = false;
    report.errors.push('engagements/active/intake.md is missing the core discovery prompts');
  }

  const activePrd = await readText(ws.paths.activePrd);
  if (!activePrd.includes('类型专项模块')) {
    report.valid = false;
    report.errors.push('engagements/active/prd.md is missing the type-specific block');
  }

  const decisionLog = await readText(ws.paths.decisionLog);
  if (!decisionLog.includes('# 决策记录')) {
    report.valid = false;
    report.errors.push('engagements/active/decision-log.md is missing the decision log heading');
  }

  const openQuestionsLog = await readText(ws.paths.openQuestionsLog);
  if (!openQuestionsLog.includes('# 开放问题')) {
    report.valid = false;
    report.errors.push('engagements/active/open-questions.md is missing the open questions heading');
  }

  const progressLog = await readText(ws.paths.progressLog);
  if (!progressLog.includes('# 进度')) {
    report.valid = false;
    report.errors.push('engagements/active/progress.md is missing the progress heading');
  }

  const verificationLog = await readText(ws.paths.verificationLog);
  if (!verificationLog.includes('# 验证')) {
    report.valid = false;
    report.errors.push('engagements/active/verification.md is missing the verification heading');
  }

  const taskGraph = await readJson(ws.paths.taskGraph).catch(() => null);
  if (!taskGraph || !Array.isArray(taskGraph.nodes) || !Array.isArray(taskGraph.edges) || !Array.isArray(taskGraph.workflow) || !Array.isArray(taskGraph.artifacts) || typeof taskGraph.nextReadyNode !== 'string') {
    report.valid = false;
    report.errors.push('state/task-graph.json is missing a valid graph structure');
  }

  const eventsLog = await readText(ws.paths.eventsLog);
  if (typeof eventsLog !== 'string') {
    report.valid = false;
    report.errors.push('state/events.jsonl is missing');
  }

  const standards = await checkStandardsWorkspace(projectRoot, { optional: true });
  if (!standards.skipped) {
    if (standards.errors.length > 0) {
      report.valid = false;
    }
    report.errors.push(...standards.errors);
    report.warnings.push(...standards.warnings);
    report.checks.push(...standards.checks.map((check) => ({ name: `standards: ${check}`, ok: standards.ok })));
  }

  if (ws.data.currentState && ws.data.currentState.templatePack && !['base', 'consumer', 'b2b', 'agent'].includes(ws.data.currentState.templatePack)) {
    report.warnings.push(`state/current.json has unknown templatePack: ${ws.data.currentState.templatePack}`);
  }

  if (ws.data.currentState && ws.data.currentState.productType && !isSupportedProductType(ws.data.currentState.productType)) {
    report.valid = false;
    report.errors.push(`state/current.json has unknown productType: ${ws.data.currentState.productType}`);
  }

  const prdVersion = Number(ws.data.currentState?.prdVersion ?? 0);
  const versionIndex = Array.isArray(ws.data.versionIndex) ? ws.data.versionIndex : [];
  if (prdVersion > 0 && versionIndex.length === 0) {
    report.valid = false;
    report.errors.push('state/current.json indicates a synthesized PRD, but no version history exists');
  }
  if (versionIndex.length > 0) {
    const latest = versionIndex[versionIndex.length - 1];
    if (prdVersion > 0 && Number(latest.versionNumber) !== prdVersion) {
      report.warnings.push(`PRD version history latest (${latest.versionId}) does not match current prdVersion (${prdVersion})`);
    }
  }

  report.checks.push({ name: 'workspace', ok: true });
  report.checks.push({ name: 'schema', ok: true });
  report.checks.push({ name: 'manifest', ok: true });

  return { report, ws };
}

async function computeWorkspaceDigest(ws) {
  const hash = crypto.createHash('sha256');
  for (const rel of CORE_TEMPLATE_FILES) {
    const abs = cjoin(ws.workspaceRoot, rel);
    if (await exists(abs)) {
      hash.update(rel);
      hash.update('\n');
      hash.update(await readText(abs));
      hash.update('\n');
    }
  }
  return hash.digest('hex');
}


function sortVersionIndex(index) {
  return [...index].sort((a, b) => Number(a.versionNumber) - Number(b.versionNumber));
}

async function readVersionIndex(ws) {
  if (await exists(ws.paths.versionIndex)) {
    const diskIndex = await readJson(ws.paths.versionIndex).catch(() => []);
    return sortVersionIndex(Array.isArray(diskIndex) ? diskIndex : []);
  }

  const index = Array.isArray(ws.data.versionIndex) ? ws.data.versionIndex : [];
  return sortVersionIndex(index);
}

async function writeVersionIndex(ws, index) {
  await writeJson(ws.paths.versionIndex, sortVersionIndex(index));
}

function normalizeVersionId(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = `${value}`.trim();
  if (!text) {
    return null;
  }

  if (/^v\d+$/i.test(text)) {
    return text.toLowerCase();
  }

  if (/^\d+$/.test(text)) {
    return formatVersionId(Number(text));
  }

  return text;
}

function coerceCapturedValue(pathString, rawValue, append = false) {
  if (rawValue === null || rawValue === undefined) {
    return rawValue;
  }

  const text = `${rawValue}`.trim();
  if (text === '') {
    return rawValue;
  }

  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      return JSON.parse(text);
    } catch {
      // fall through
    }
  }

  const expectsArray = [
    'problem.evidence',
    'users.primaryUsers',
    'users.secondaryUsers',
    'users.stakeholders',
    'goals.goals',
    'goals.successMetrics',
    'goals.acceptanceGoals',
    'scope.inScope',
    'scope.outOfScope',
    'scenarios.primaryFlows',
    'scenarios.edgeCases',
    'scenarios.failureModes',
    'requirements.functional',
    'requirements.nonFunctional',
    'requirements.businessRules',
    'constraints.technical',
    'constraints.compliance',
    'constraints.dependencies',
    'risks.assumptions',
    'risks.risks',
    'risks.openQuestions',
  ].includes(pathString);

  if (expectsArray || append) {
    return text.split(/[\n,;|]+/).map((item) => item.trim()).filter(Boolean);
  }

  return text;
}

async function detectWorkspaceScenario(projectRoot, ws, versionIndex = []) {
  const currentStatus = ws.data.currentState?.status ?? 'unknown';
  if (versionIndex.length > 0 || ['synthesized', 'frozen', 'handed_off'].includes(currentStatus)) {
    return {
      id: 'continuing-workspace',
      label: '继续已有工作区',
      userParticipation: '定向确认',
      reason: '该工作区已有合成结果或历史记录，只需要补充确认增量信息。',
    };
  }

  const entries = await fs.readdir(projectRoot, { withFileTypes: true }).catch(() => []);
  const meaningfulEntries = entries.filter((entry) => {
    if (entry.name === '.openprd') return false;
    if (entry.name === '.DS_Store') return false;
    if (entry.name === '.git') return false;
    if (entry.name === '.omx') return false;
    return true;
  });

  if (meaningfulEntries.length === 0) {
    return {
      id: 'cold-start-greenfield',
      label: '冷启动（全新项目）',
      userParticipation: '高协作',
      reason: '项目根目录基本为空，需要 Agent 与用户共同梳理初始需求形态。',
    };
  }

  return {
    id: 'cold-start-existing-project',
    label: '冷启动（已有项目）',
    userParticipation: '上下文复用加确认',
    reason: '项目已经包含资料，但 OpenPrd 工作区是新的，需要复用既有上下文并向用户确认。',
  };
}

function buildClarificationState({ snapshot, analysis, basePlan, scenario, captureMeta, limit = 8 }) {
  const captureState = captureMeta ?? {};
  const confirmDerived = analysis.completeFields
    .filter((field) => USER_CLARIFICATION_PATHS.has(field.path))
    .filter((field) => {
      const source = captureState[field.path]?.source;
      return source && source !== 'user-confirmed';
    })
    .map((field) => ({
      id: field.path,
      label: field.label,
      prompt: `请确认这个推断输入：${field.label}。当前值：${Array.isArray(field.value) ? field.value.join(', ') : JSON.stringify(field.value)}`,
      reason: 'confirm-derived',
    }));

  const missingQuestions = basePlan.mustAsk.map((field) => ({
    id: field.path,
    label: field.label,
    prompt: field.prompt,
    reason: 'missing',
  }));

  let questions = [];
  if (scenario.id === 'cold-start-greenfield') {
    questions = [
      ...basePlan.kickoffQuestions.map((field) => ({
        id: field.id,
        label: field.label,
        prompt: field.prompt,
        reason: 'kickoff',
      })),
      ...missingQuestions,
      ...confirmDerived,
    ];
  } else if (scenario.id === 'cold-start-existing-project') {
    questions = [
      {
        id: 'existing-project-goal',
        label: '已有项目范围',
        prompt: '基于当前已有项目，这个 OpenPrd 工作区现在具体要定义或改进什么？',
        reason: 'kickoff',
      },
      {
        id: 'reuse-boundary',
        label: '复用边界',
        prompt: '哪些既有能力应视为固定输入，哪些区域仍可调整？',
        reason: 'kickoff',
      },
      ...missingQuestions,
      ...confirmDerived,
    ];
  } else {
    questions = [
      ...missingQuestions,
      ...confirmDerived,
    ];
  }

  const deduped = [];
  const seen = new Set();
  for (const question of questions) {
    const key = question.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(question);
  }

  const mustAskUser = deduped.slice(0, limit);
  const canInferLater = basePlan.derived.map((field) => ({
    id: field.path,
    label: field.label,
    prompt: field.prompt,
  }));

  return {
    scenario,
    totalRequiredFields: basePlan.totalRequiredFields,
    missingRequiredFields: analysis.missingRequiredFields,
    mustAskUser,
    canInferLater,
    shouldAskUser: mustAskUser.length > 0,
  };
}

function buildClarificationPlan(snapshot, analysis) {
  const descriptors = getRequiredFieldDescriptors(snapshot.productType ?? null);
  const mustAsk = analysis.missingFields.filter((field) => USER_CLARIFICATION_PATHS.has(field.path));
  const derived = analysis.missingFields.filter((field) => !USER_CLARIFICATION_PATHS.has(field.path));
  const kickoffQuestions = [
    { id: 'project-overview', label: 'Project overview', prompt: 'What are we building at a high level, and for whom?' },
    { id: 'success-definition', label: 'Success definition', prompt: 'What outcome would make this first version successful?' },
    { id: 'first-milestone', label: '首个里程碑', prompt: '我们希望 freeze 的第一个里程碑是什么？' },
  ];
  return {
    totalRequiredFields: descriptors.length,
    missingRequiredFields: analysis.missingRequiredFields,
    mustAsk,
    derived,
    kickoffQuestions,
  };
}

function deriveGateLabels({ nextAction, diagramState, clarification }) {
  let currentGate = nextAction;
  if (nextAction === 'diagram') {
    currentGate = `${diagramState?.preferredType ?? 'architecture'} diagram review`;
  } else if (nextAction === 'freeze') {
    currentGate = 'freeze review';
  } else if (nextAction === 'clarify-user') {
    currentGate = 'clarify-user';
  }

  let upcomingGate = null;
  if (nextAction === 'clarify-user' || nextAction === 'classify' || nextAction === 'interview' || nextAction === 'synthesize') {
    if (diagramState?.needed) {
      upcomingGate = `${diagramState.preferredType} diagram review`;
    } else {
      upcomingGate = 'freeze review';
    }
  } else if (nextAction === 'diagram') {
    upcomingGate = 'freeze review';
  } else if (nextAction === 'freeze') {
    upcomingGate = 'handoff review';
  } else if (nextAction === 'handoff') {
    upcomingGate = 'post-handoff review';
  }

  return {
    currentGate,
    upcomingGate,
  };
}

async function writeVersionSnapshot(ws, snapshot) {
  await fs.mkdir(ws.paths.versionsDir, { recursive: true });
  const jsonPath = cjoin(ws.paths.versionsDir, `${snapshot.versionId}.json`);
  const mdPath = cjoin(ws.paths.versionsDir, `${snapshot.versionId}.md`);
  await writeJson(jsonPath, snapshot);
  await writeText(mdPath, snapshot.content);
  return { jsonPath, mdPath };
}

async function readVersionSnapshot(ws, versionId) {
  const normalized = normalizeVersionId(versionId);
  if (!normalized) {
    return null;
  }

  const jsonPath = cjoin(ws.paths.versionsDir, `${normalized}.json`);
  if (!(await exists(jsonPath))) {
    return null;
  }

  return readJson(jsonPath);
}

async function loadLatestVersionSnapshot(ws) {
  const index = await readVersionIndex(ws);
  if (index.length === 0) {
    return null;
  }

  const latest = index[index.length - 1];
  const snapshot = await readVersionSnapshot(ws, latest.versionId);
  if (!snapshot) {
    return null;
  }

  return { indexEntry: latest, snapshot };
}

function renderBulletList(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    return ['- 待补充'].join('\n');
  }

  return list.map((item) => `- ${item}`).join('\n');
}

function renderFlowDoc(snapshot) {
  const { scenarios } = snapshot.sections;
  const productFlow = buildDiagramArtifact(snapshot, { type: 'product-flow' });
  const mermaid = renderDiagramMermaidFromModel('product-flow', productFlow.model);
  return `# 流程\n\n## 主流程\n\n${renderBulletList(scenarios.primaryFlows)}\n\n## Mermaid 流程图\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n\n## 边界情况\n\n${renderBulletList(scenarios.edgeCases)}\n\n## 失败模式\n\n${renderBulletList(scenarios.failureModes)}\n`;
}

function renderRolesDoc(snapshot) {
  const { users, typeSpecific } = snapshot.sections;
  const roleFields = typeSpecific.fields ?? {};
  const extraLines = Object.entries(roleFields)
    .map(([key, value]) => `- ${key}: ${Array.isArray(value) ? value.join(', ') : value ?? '待补充'}`)
    .join('\n') || '- 待补充';

  return `# 角色\n\n## 用户\n\n- 主要用户:\n${renderBulletList(users.primaryUsers)}\n\n- 次要用户:\n${renderBulletList(users.secondaryUsers)}\n\n- 相关方:\n${renderBulletList(users.stakeholders)}\n\n## 类型专项\n\n${extraLines}\n`;
}

function renderHandoffDoc(snapshot) {
  const { handoff } = snapshot.sections;
  return `# 交接\n\n- 版本: ${snapshot.versionId}\n- 产品类型: ${snapshot.productType ?? '未分类'}\n- 模板包: ${snapshot.templatePack}\n- Digest: ${snapshot.digest}\n- 负责人: ${handoff.owner}\n- 下一步: ${handoff.nextStep}\n- 目标系统: ${handoff.targetSystem}\n`;
}

async function openInBrowser(filePath) {
  const platform = process.platform;
  const command = platform === 'darwin'
    ? 'open'
    : platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = platform === 'win32'
    ? ['/c', 'start', '', filePath]
    : [filePath];

  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function resolveDiagramPaths(ws, type = 'architecture') {
  if (type === 'product-flow') {
    return {
      htmlPath: ws.paths.activeProductFlowDiagramHtml,
      jsonPath: ws.paths.activeProductFlowDiagramJson,
      mermaidPath: ws.paths.activeProductFlowDiagramMermaid,
      label: 'product flow',
    };
  }

  return {
    htmlPath: ws.paths.activeArchitectureDiagramHtml,
    jsonPath: ws.paths.activeArchitectureDiagramJson,
    mermaidPath: ws.paths.activeArchitectureDiagramMermaid,
    label: 'architecture',
  };
}

async function readDiagramModel(filePath) {
  if (!(await exists(filePath))) {
    return null;
  }
  return readJson(filePath).catch(() => null);
}

function normalizeDiagramReviewStatus(status) {
  return ['pending-confirmation', 'confirmed', 'needs-revision'].includes(status)
    ? status
    : 'pending-confirmation';
}

function assessDiagramComplexity(snapshot) {
  const sections = snapshot?.sections ?? {};
  const flowScore = [
    (sections.scenarios?.primaryFlows ?? []).length > 0,
    (sections.scenarios?.edgeCases ?? []).length > 0,
    (sections.scenarios?.failureModes ?? []).length > 0,
    (sections.goals?.acceptanceGoals ?? []).length > 0,
  ].filter(Boolean).length;

  const architectureScore = [
    (sections.constraints?.dependencies ?? []).length > 0,
    (sections.constraints?.technical ?? []).length > 0,
    (sections.constraints?.compliance ?? []).length > 0,
    (sections.requirements?.nonFunctional ?? []).length > 0,
    snapshot?.productType === 'agent',
    snapshot?.productType === 'b2b',
  ].filter(Boolean).length;

  if (flowScore === 0 && architectureScore === 0) {
    return { needed: false, preferredType: 'architecture', reason: null };
  }

  const preferredType = flowScore >= architectureScore ? 'product-flow' : 'architecture';
  return {
    needed: Math.max(flowScore, architectureScore) >= 2,
    preferredType,
    reason: preferredType === 'product-flow'
      ? 'The user journey and failure/decision paths would benefit from a visual confirmation.'
      : 'The system shape, boundaries, or dependencies would benefit from a visual confirmation.',
  };
}

async function getDiagramReviewState(ws, snapshot) {
  const architecture = await readDiagramModel(ws.paths.activeArchitectureDiagramJson);
  const productFlow = await readDiagramModel(ws.paths.activeProductFlowDiagramJson);
  const complexity = assessDiagramComplexity(snapshot);
  const preferred = complexity.preferredType;
  const target = preferred === 'product-flow' ? productFlow : architecture;
  const targetStatus = normalizeDiagramReviewStatus(target?.metadata?.reviewStatus);
  const targetExists = Boolean(target);

  const shouldGateFreeze = complexity.needed && (!targetExists || targetStatus !== 'confirmed');
  let reason = complexity.reason;
  if (shouldGateFreeze && targetExists && targetStatus === 'needs-revision') {
    reason = `The ${preferred} diagram exists but is marked needs-revision and should be updated before freeze.`;
  } else if (shouldGateFreeze && targetExists && targetStatus === 'pending-confirmation') {
    reason = `The ${preferred} diagram exists but is still pending confirmation before freeze.`;
  } else if (shouldGateFreeze && !targetExists) {
    reason = `A ${preferred} diagram has not been generated yet and should be reviewed before freeze.`;
  }

  return {
    preferredType: preferred,
    needed: complexity.needed,
    shouldGateFreeze,
    reason,
    architecture: {
      exists: Boolean(architecture),
      reviewStatus: normalizeDiagramReviewStatus(architecture?.metadata?.reviewStatus),
    },
    productFlow: {
      exists: Boolean(productFlow),
      reviewStatus: normalizeDiagramReviewStatus(productFlow?.metadata?.reviewStatus),
    },
  };
}

async function diagramWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const type = options.type ?? 'architecture';
  if (!['architecture', 'product-flow'].includes(type)) {
    throw new Error(`Unsupported diagram type: ${type}`);
  }
  if (options.mark && !['pending-confirmation', 'confirmed', 'needs-revision'].includes(options.mark)) {
    throw new Error(`Unsupported diagram review status: ${options.mark}`);
  }

  const { htmlPath, jsonPath, mermaidPath, label } = resolveDiagramPaths(ws, type);
  if (options.mark && !options.input && await exists(jsonPath)) {
    const model = await readJson(jsonPath);
    model.metadata = {
      ...(model.metadata ?? {}),
      reviewStatus: options.mark,
    };
    const languageValidation = validateDiagramLanguage(model);
    if (!languageValidation.valid) {
      throw new Error(`Invalid ${type} diagram language:\n- ${languageValidation.errors.join('\n- ')}`);
    }
    const html = renderDiagramArtifactFromModel(type, model);
    const mermaid = renderDiagramMermaidFromModel(type, model);
    await writeJson(jsonPath, model);
    await writeText(htmlPath, html);
    await writeText(mermaidPath, `${mermaid}\n`);
    await appendWorkflowEvent(ws, 'diagram_marked', {
      diagramType: type,
      reviewStatus: options.mark,
      htmlPath,
      mermaidPath,
    });
    await appendDecision(ws, [
      `Marked ${label} diagram as ${options.mark}.`,
    ]);
    if (options.open) {
      await openInBrowser(htmlPath);
    }
    return {
      ws,
      snapshot: null,
      type,
      model,
      inputPath: null,
      htmlPath,
      jsonPath,
      mermaidPath,
      opened: Boolean(options.open),
      marked: options.mark,
    };
  }

  const versionIndex = await readVersionIndex(ws);
  const latestVersion = versionIndex.length > 0 ? await loadLatestVersionSnapshot(ws) : null;
  const snapshot = latestVersion?.snapshot ?? buildPrdSnapshot(ws, {
    ...ws.data.currentState,
    versionNumber: ws.data.currentState?.prdVersion ?? (versionIndex.at(-1)?.versionNumber ?? 0),
    versionId: ws.data.currentState?.prdVersion > 0
      ? formatVersionId(ws.data.currentState.prdVersion)
      : (versionIndex.at(-1)?.versionId ?? 'v0000'),
    productType: resolveCurrentProductType(ws),
    templatePack: resolveActiveTemplatePack(ws),
    status: ws.data.currentState?.status ?? 'draft',
  });

  const contract = options.input
    ? await readJson(path.resolve(options.input))
    : null;
  if (contract) {
    const schema = type === 'product-flow'
      ? ws.data.diagramProductFlowSchema
      : ws.data.diagramArchitectureSchema;
    const validation = validateDiagramContract(contract, schema);
    if (!validation.valid) {
      throw new Error(`Invalid ${type} diagram contract:\n- ${validation.errors.join('\n- ')}`);
    }
  }
  const artifact = buildDiagramArtifact(snapshot, { type, contract });
  if (options.mark) {
    artifact.model.metadata = {
      ...(artifact.model.metadata ?? {}),
      reviewStatus: options.mark,
    };
    artifact.html = renderDiagramArtifactFromModel(type, artifact.model);
  }
  const languageValidation = validateDiagramLanguage(artifact.model);
  if (!languageValidation.valid) {
    throw new Error(`Invalid ${type} diagram language:\n- ${languageValidation.errors.join('\n- ')}`);
  }

  const mermaid = renderDiagramMermaidFromModel(type, artifact.model);
  await writeJson(jsonPath, artifact.model);
  await writeText(htmlPath, artifact.html);
  await writeText(mermaidPath, `${mermaid}\n`);
  await appendWorkflowEvent(ws, 'diagram_generated', {
    versionId: snapshot.versionId,
    productType: snapshot.productType,
    diagramType: type,
    inputPath: options.input ? path.resolve(options.input) : null,
    htmlPath,
    mermaidPath,
  });
  await appendProgress(ws, [
    `已为 ${snapshot.title} 生成 ${label} 图表产物。`,
    `HTML: ${htmlPath}`,
    `Mermaid: ${mermaidPath}`,
    ...(options.input ? [`Input contract: ${path.resolve(options.input)}`] : []),
  ]);
  await appendDecision(ws, [
    `已为 ${snapshot.title} 创建 ${label} 图表评审产物。`,
    type === 'product-flow'
      ? '请在 freeze 前使用该产物确认步骤、决策点和恢复路径。'
      : '请在 freeze 前使用该产物确认组件、边界和缺失系统。',
  ]);

  if (options.open) {
    await openInBrowser(htmlPath);
  }

  return {
    ws,
    snapshot,
    type,
    model: artifact.model,
    inputPath: options.input ? path.resolve(options.input) : null,
    htmlPath,
    jsonPath,
    mermaidPath,
    opened: Boolean(options.open),
    marked: options.mark ?? null,
  };
}

async function synthesizeWorkspace(projectRoot, overrides = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const versionIndex = await readVersionIndex(ws);
  const nextVersionNumber = overrides.versionNumber ?? (versionIndex.length > 0
    ? Math.max(...versionIndex.map((entry) => Number(entry.versionNumber) || 0)) + 1
    : 1);
  const versionId = overrides.versionId ?? formatVersionId(nextVersionNumber);
  const createdAt = overrides.createdAt ?? timestamp();
  const snapshot = buildPrdSnapshot(ws, {
    ...overrides,
    versionNumber: nextVersionNumber,
    versionId,
    createdAt,
    productType: overrides.productType ?? resolveCurrentProductType(ws),
    templatePack: overrides.templatePack ?? resolveActiveTemplatePack(ws),
  });

  snapshot.content = renderPrdMarkdown(snapshot);
  snapshot.digest = crypto.createHash('sha256').update(snapshot.content).digest('hex');

  await writeVersionSnapshot(ws, snapshot);

  const indexEntry = summarizeSnapshot(snapshot);
  await writeVersionIndex(ws, [...versionIndex, indexEntry]);

  await writeText(ws.paths.activePrd, snapshot.content);
  await writeText(ws.paths.activeFlows, renderFlowDoc(snapshot));
  await writeText(ws.paths.activeRoles, renderRolesDoc(snapshot));
  await writeText(ws.paths.activeHandoff, renderHandoffDoc(snapshot));
  await writeJson(ws.paths.taskGraph, buildWorkflowTaskGraph(snapshot));
  await appendWorkflowEvent(ws, 'synthesized', {
    versionId: snapshot.versionId,
    versionNumber: snapshot.versionNumber,
    productType: snapshot.productType,
  });
  await appendDecision(ws, [
    `已生成版本 ${snapshot.versionId}。`,
    `产品类型: ${snapshot.productType ?? '未分类'}。`,
    `模板包: ${snapshot.templatePack}。`,
    `Digest: ${snapshot.digest}.`,
  ]);
  await appendProgress(ws, [
    `已生成 PRD 快照 ${snapshot.versionId}。`,
    `已更新当前 PRD、流程、角色和交接文档。`,
  ]);

  const currentState = {
    ...(ws.data.currentState ?? {}),
    captureMeta: {
      ...((ws.data.currentState ?? {}).captureMeta ?? {}),
      ...(overrides.title ? { 'meta.title': { source: 'user-confirmed', capturedAt: timestamp() } } : {}),
      ...(overrides.owner ? { 'meta.owner': { source: 'user-confirmed', capturedAt: timestamp() } } : {}),
      ...(overrides.problemStatement ? { 'problem.problemStatement': { source: 'user-confirmed', capturedAt: timestamp() } } : {}),
      ...(overrides.whyNow ? { 'problem.whyNow': { source: 'user-confirmed', capturedAt: timestamp() } } : {}),
      ...(overrides.evidence ? { 'problem.evidence': { source: 'user-confirmed', capturedAt: timestamp() } } : {}),
      ...(overrides.productType ? { 'meta.productType': { source: 'user-confirmed', capturedAt: timestamp() } } : {}),
    },
    status: 'synthesized',
    prdVersion: snapshot.versionNumber,
    latestVersionId: snapshot.versionId,
    latestVersionDigest: snapshot.digest,
    title: snapshot.title,
    owner: snapshot.owner,
    productType: snapshot.productType,
    templatePack: snapshot.templatePack,
    synthesizedAt: snapshot.createdAt,
  };
  await writeJson(ws.paths.currentState, currentState);

  return { ws, snapshot, currentState, indexEntry, versionIndex: [...versionIndex, indexEntry] };
}

async function diffWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const index = await readVersionIndex(ws);
  if (index.length === 0) {
    throw new Error('No synthesized PRD versions exist yet. Run openprd synthesize first.');
  }

  const requestedFrom = normalizeVersionId(options.from);
  const requestedTo = normalizeVersionId(options.to);

  const fromEntry = requestedFrom
    ? index.find((entry) => normalizeVersionId(entry.versionId) === requestedFrom)
    : index[index.length - 2] ?? null;
  const toEntry = requestedTo
    ? index.find((entry) => normalizeVersionId(entry.versionId) === requestedTo)
    : index[index.length - 1] ?? null;

  if (!fromEntry || !toEntry) {
    throw new Error('Need at least two PRD versions to diff.');
  }

  const before = await readVersionSnapshot(ws, fromEntry.versionId);
  const after = await readVersionSnapshot(ws, toEntry.versionId);
  if (!before || !after) {
    throw new Error('Unable to read one or both PRD version snapshots.');
  }

  const diff = diffSnapshots(before, after);
  return { ws, before, after, diff };
}

async function clarifyWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const versionIndex = await readVersionIndex(ws);
  const currentState = ws.data.currentState ?? {};
  const snapshot = (await loadLatestVersionSnapshot(ws))?.snapshot ?? buildPrdSnapshot(ws, {
    ...currentState,
    versionNumber: currentState.prdVersion ?? (versionIndex.at(-1)?.versionNumber ?? 0),
    versionId: currentState.prdVersion > 0
      ? formatVersionId(currentState.prdVersion)
      : (versionIndex.at(-1)?.versionId ?? 'v0000'),
    productType: resolveCurrentProductType(ws),
    templatePack: resolveActiveTemplatePack(ws),
    status: currentState.status ?? 'draft',
  });

  const analysis = analyzePrdSnapshot(snapshot);
  const basePlan = buildClarificationPlan(snapshot, analysis);
  const scenario = await detectWorkspaceScenario(projectRoot, ws, versionIndex);
  const clarification = buildClarificationState({
    snapshot,
    analysis,
    basePlan,
    scenario,
    captureMeta: ws.data.currentState?.captureMeta ?? {},
    limit: Number(options.limit ?? 8),
  });

  await appendWorkflowEvent(ws, 'clarify', {
    missingRequiredFields: clarification.missingRequiredFields,
    mustAskUser: clarification.mustAskUser.map((item) => item.id),
    scenario: clarification.scenario.id,
  });
  await appendOpenQuestions(ws, clarification.mustAskUser.map((item) => item.prompt));

  return {
    ws,
    snapshot,
    analysis,
    clarification,
  };
}

async function captureWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const currentState = {
    ...(ws.data.currentState ?? {}),
  };
  currentState.captureMeta = {
    ...(currentState.captureMeta ?? {}),
  };

  const updates = [];

  if (options.jsonFile) {
    const payload = await readJson(path.resolve(options.jsonFile));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Capture JSON file must contain an object at the root');
    }

    for (const [field, rawEntry] of Object.entries(payload)) {
      const stateKey = FIELD_PATH_TO_STATE_KEY[field];
      if (!stateKey) {
        throw new Error(`Unsupported capture field in json file: ${field}`);
      }

      let value = rawEntry;
      let source = options.source;
      let append = Boolean(options.append);

      if (rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry) && ('value' in rawEntry || 'source' in rawEntry || 'append' in rawEntry)) {
        value = rawEntry.value;
        source = rawEntry.source ?? source;
        append = rawEntry.append ?? append;
      }

      if (value === null || value === undefined) {
        throw new Error(`Missing capture value in json file for field: ${field}`);
      }

      updates.push({
        field,
        stateKey,
        value,
        source: CAPTURE_SOURCES.includes(source) ? source : 'user-confirmed',
        append: Boolean(append),
      });
    }
  } else {
    const field = options.field?.trim();
    if (!field) {
      throw new Error('Missing required option: --field');
    }
    const stateKey = FIELD_PATH_TO_STATE_KEY[field];
    if (!stateKey) {
      throw new Error(`Unsupported capture field: ${field}`);
    }
    if (options.value === null || options.value === undefined) {
      throw new Error('Missing required option: --value');
    }
    updates.push({
      field,
      stateKey,
      value: options.value,
      source: CAPTURE_SOURCES.includes(options.source) ? options.source : 'user-confirmed',
      append: Boolean(options.append),
    });
  }

  const applied = [];
  for (const update of updates) {
    const nextValue = coerceCapturedValue(update.field, update.value, update.append);

    if (update.append) {
      const prev = currentState[update.stateKey];
      const prevArray = Array.isArray(prev)
        ? prev
        : (prev ? coerceCapturedValue(update.field, prev, true) : []);
      const nextArray = Array.isArray(nextValue) ? nextValue : [nextValue];
      currentState[update.stateKey] = [...prevArray, ...nextArray];
    } else {
      currentState[update.stateKey] = nextValue;
    }

    applied.push({
      field: update.field,
      stateKey: update.stateKey,
      source: update.source,
      value: currentState[update.stateKey],
    });
  }

  currentState.status = currentState.status === 'initialized' ? 'clarifying' : (currentState.status ?? 'clarifying');
  currentState.lastCapturedAt = timestamp();
  for (const update of applied) {
    currentState.captureMeta[update.field] = {
      source: update.source,
      capturedAt: currentState.lastCapturedAt,
    };
  }
  await writeJson(ws.paths.currentState, currentState);

  const snapshot = buildPrdSnapshot({ ...ws, data: { ...ws.data, currentState } }, {
    ...currentState,
    versionNumber: currentState.prdVersion ?? 0,
    versionId: currentState.prdVersion > 0 ? formatVersionId(currentState.prdVersion) : 'v0000',
    productType: currentState.productType ?? resolveCurrentProductType(ws),
    templatePack: currentState.templatePack ?? resolveActiveTemplatePack(ws),
  });
  const analysis = analyzePrdSnapshot(snapshot);
  const diagramState = await getDiagramReviewState({ ...ws, data: { ...ws.data, currentState } }, snapshot);
  const scenario = await detectWorkspaceScenario(projectRoot, { ...ws, data: { ...ws.data, currentState } }, await readVersionIndex(ws));
  const clarification = buildClarificationState({
    snapshot,
    analysis,
    basePlan: buildClarificationPlan(snapshot, analysis),
    scenario,
    captureMeta: currentState.captureMeta,
    limit: 8,
  });
  await writeJson(ws.paths.taskGraph, buildWorkflowTaskGraph(snapshot, analysis, { diagramState, clarificationState: clarification }));
  await appendWorkflowEvent(ws, 'capture', {
    fields: applied.map((item) => item.field),
    sources: applied.map((item) => item.source),
  });
  await appendDecision(ws, [
    `Captured clarification for ${applied.map((item) => item.field).join(', ')}.`,
  ]);
  await appendProgress(ws, [
    `已更新 ${applied.length} 个字段到当前工作区状态。`,
  ]);

  return {
    ws: { ...ws, data: { ...ws.data, currentState } },
    applied,
    field: applied[0]?.field ?? null,
    stateKey: applied[0]?.stateKey ?? null,
    value: applied[0]?.value ?? null,
    source: applied[0]?.source ?? null,
    analysis,
  };
}

async function computeWorkspaceGuidance(ws, options = {}) {
  const versionIndex = await readVersionIndex(ws);
  const currentState = ws.data.currentState ?? {};
  const currentProductType = resolveCurrentProductType(ws);
  const currentStatus = currentState.status ?? 'unknown';
  const latestVersion = versionIndex.length > 0 ? await loadLatestVersionSnapshot(ws) : null;
  const analysisSnapshot = latestVersion?.snapshot ?? buildPrdSnapshot(ws, {
    ...currentState,
    versionNumber: currentState.prdVersion ?? (versionIndex.at(-1)?.versionNumber ?? 0),
    versionId: currentState.prdVersion > 0
      ? formatVersionId(currentState.prdVersion)
      : (versionIndex.at(-1)?.versionId ?? 'v0000'),
    productType: currentProductType,
    templatePack: resolveActiveTemplatePack(ws),
  });
  const analysis = analyzePrdSnapshot(analysisSnapshot);
  const hasProductType = isSupportedProductType(currentProductType ?? analysis.productType);
  const diagramState = await getDiagramReviewState(ws, analysisSnapshot);
  const scenario = await detectWorkspaceScenario(ws.projectRoot, ws, versionIndex);
  const clarification = buildClarificationState({
    snapshot: analysisSnapshot,
    analysis,
    basePlan: buildClarificationPlan(analysisSnapshot, analysis),
    scenario,
    captureMeta: currentState.captureMeta ?? {},
    limit: Number(options.questionLimit ?? 5),
  });

  let nextAction = 'synthesize';
  let reason = 'PRD 可以合成为第一个版本。';
  let suggestedCommand = 'openprd synthesize .';
  let suggestedQuestions = analysis.suggestedQuestions;

  if (clarification.shouldAskUser) {
    nextAction = 'clarify-user';
    reason = '工作区缺少用户确认的关键信息，需要先澄清再继续合成。';
    suggestedCommand = 'openprd clarify .';
    suggestedQuestions = clarification.mustAskUser.map((item) => item.prompt);
  } else if (!hasProductType) {
    nextAction = 'classify';
    reason = '产品类型尚未锁定。';
    suggestedCommand = 'openprd classify . <consumer|b2b|agent>';
    suggestedQuestions = ['这是 consumer、b2b 还是 agent 产品？'];
  } else if (analysis.missingRequiredFields > 0) {
    nextAction = 'interview';
    reason = `仍缺少 ${analysis.missingRequiredFields} 个必填字段。`;
    suggestedCommand = `openprd interview . --product-type ${currentProductType}`;
  } else if (currentStatus === 'frozen') {
    nextAction = 'handoff';
    reason = '最新 PRD 已 freeze，可以交接。';
    suggestedCommand = 'openprd handoff . --target openprd';
    suggestedQuestions = [];
  } else if (currentStatus === 'handed_off') {
    nextAction = versionIndex.length > 1 ? 'diff' : 'history';
    reason = '该工作区已经完成交接。';
    suggestedCommand = nextAction === 'diff' ? 'openprd diff .' : 'openprd history .';
    suggestedQuestions = [];
  } else if (diagramState.shouldGateFreeze && (currentStatus === 'synthesized' || currentState.prdVersion > 0)) {
    nextAction = 'diagram';
    reason = diagramState.reason;
    suggestedCommand = `openprd diagram . --type ${diagramState.preferredType} --open`;
    suggestedQuestions = [
      `这张 ${diagramState.preferredType} 图是否符合预期设计？`,
      '当前可视化表达中还缺少什么，或哪里不准确？',
    ];
  } else if (currentStatus === 'synthesized' || currentState.prdVersion > 0) {
    nextAction = 'freeze';
    reason = '已有版本化 PRD，交接前应先 freeze。';
    suggestedCommand = 'openprd freeze .';
    suggestedQuestions = [];
  }

  const taskGraph = buildWorkflowTaskGraph(analysisSnapshot, analysis, { diagramState, clarificationState: clarification });
  const gates = deriveGateLabels({ nextAction, diagramState, clarification });

  return {
    versionIndex,
    currentState,
    analysisSnapshot,
    analysis,
    diagramState,
    clarification,
    taskGraph,
    nextAction,
    reason,
    suggestedCommand,
    suggestedQuestions,
    gates,
  };
}


async function nextWorkspace(projectRoot) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const guidance = await computeWorkspaceGuidance(ws, { questionLimit: 5 });
  const {
    versionIndex,
    currentState,
    analysisSnapshot,
    analysis,
    diagramState,
    clarification,
    taskGraph,
    nextAction,
    reason,
    suggestedCommand,
    suggestedQuestions,
    gates,
  } = guidance;

  await writeJson(ws.paths.taskGraph, taskGraph);
  await appendWorkflowEvent(ws, 'next', {
    nextAction,
    reason,
    missingRequiredFields: analysis.missingRequiredFields,
  });
  if (analysis.missingRequiredFields > 0) {
    await appendOpenQuestions(ws, [
      `缺少必填字段: ${analysis.missingRequiredFields}。`,
      ...analysis.suggestedQuestions,
    ]);
  }
  await appendProgress(ws, [
    `建议下一步: ${nextAction}。`,
    `原因: ${reason}`,
  ]);

  return {
    ws,
    currentState,
    versionIndex,
    analysisSnapshot,
    analysis,
    diagramState,
    clarification,
    taskGraph,
    gates,
    recommendation: {
      nextAction,
      reason,
      suggestedCommand,
      suggestedQuestions,
      currentGate: gates.currentGate,
      upcomingGate: gates.upcomingGate,
    },
    workflow: ['clarify', 'classify', 'interview', 'synthesize', 'diagram', 'freeze', 'handoff'],
  };
}

async function historyWorkspace(projectRoot) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const index = await readVersionIndex(ws);
  return { ws, versions: index };
}

async function classifyWorkspace(projectRoot, productType) {
  if (!isSupportedProductType(productType)) {
    throw new Error(`Unsupported product type: ${productType}`);
  }

  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const currentState = {
    ...(ws.data.currentState ?? {}),
    captureMeta: {
      ...((ws.data.currentState ?? {}).captureMeta ?? {}),
      'meta.productType': {
        source: 'user-confirmed',
        capturedAt: timestamp(),
      },
    },
    status: 'classified',
    productType,
    templatePack: productType,
    classifiedAt: timestamp(),
  };
  await writeJson(ws.paths.currentState, currentState);
  await appendWorkflowEvent(ws, 'classified', { productType });
  await appendDecision(ws, [
    `已锁定产品类型为 ${productType}。`,
    `模板包已设置为 ${productType}。`,
  ]);
  await appendProgress(ws, [
    `已将工作区分类为 ${productType}。`,
  ]);
  await writeJson(ws.paths.taskGraph, buildWorkflowTaskGraph(currentState));

  return { ws, currentState };
}

async function interviewWorkspace(projectRoot, requestedType = null) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  if (requestedType && !isSupportedProductType(requestedType)) {
    throw new Error(`Unsupported product type: ${requestedType}`);
  }

  const productType = requestedType ?? resolveCurrentProductType(ws);
  const sourceFiles = [ws.paths.baseIntake];
  if (productType === 'consumer') sourceFiles.push(ws.paths.consumerIntake);
  if (productType === 'b2b') sourceFiles.push(ws.paths.b2bIntake);
  if (productType === 'agent') sourceFiles.push(ws.paths.agentIntake);

  const sourceContent = [];
  for (const sourceFile of sourceFiles) {
    const rel = path.relative(ws.workspaceRoot, sourceFile);
    const content = await readText(sourceFile);
    sourceContent.push(`## ${rel}

${content}`);
  }

  const currentState = {
    ...(ws.data.currentState ?? {}),
    status: 'interviewing',
    productType: productType ?? ws.data.currentState?.productType ?? null,
    templatePack: productType ?? resolveActiveTemplatePack(ws),
    interviewStartedAt: timestamp(),
  };
  await writeJson(ws.paths.currentState, currentState);
  await appendWorkflowEvent(ws, 'interview_started', {
    productType: currentState.productType,
    sourceFiles: sourceFiles.map((filePath) => path.relative(ws.workspaceRoot, filePath)),
  });
  await appendProgress(ws, [
    `已加载 ${productType ?? '未分类'} 的访谈问题。`,
    `来源文件: ${sourceFiles.map((filePath) => path.relative(ws.workspaceRoot, filePath)).join(', ')}`,
  ]);
  await appendOpenQuestions(ws, [
    '我们要解决什么问题？',
    '主要用户是谁？',
    '成功是什么样？',
    '哪些内容明确不在范围内？',
    '我们希望 freeze 的第一个里程碑是什么？',
  ]);
  await writeJson(ws.paths.taskGraph, buildWorkflowTaskGraph(currentState));

  return {
    ws,
    productType,
    sourceFiles: sourceFiles.map((filePath) => path.relative(ws.workspaceRoot, filePath)),
    transcript: sourceContent.join('\n\n---\n\n'),
    currentState,
  };
}

async function initWorkspace(projectRoot, options) {
  const ws = await ensureWorkspaceSkeleton(projectRoot, options);
  const workspace = await loadWorkspace(projectRoot);
  const standards = await initStandardsWorkspace(projectRoot, { force: Boolean(options.force) });
  const agentIntegration = await setupOpenPrdAgentIntegration(projectRoot, {
    tools: options.tools ?? 'all',
    force: Boolean(options.force),
    action: 'init',
    enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
    codexHome: options.codexHome,
  });
  const config = workspace.data.config ?? {};
  if (options.templatePack) {
    config.activeTemplatePack = options.templatePack;
  }
  if (!config.activeTemplatePack) {
    config.activeTemplatePack = 'base';
  }
  await writeYaml(workspace.paths.config, config);

  const currentState = {
    version: 1,
    status: 'initialized',
    activeEngagement: 'active',
    prdVersion: 0,
    productType: isSupportedProductType(config.activeTemplatePack) ? config.activeTemplatePack : null,
    templatePack: config.activeTemplatePack,
    captureMeta: {},
    projectRoot,
    workspaceRoot: workspace.workspaceRoot,
    createdAt: timestamp(),
  };
  await writeJson(workspace.paths.currentState, currentState);
  await writeJson(workspace.paths.taskGraph, buildWorkflowTaskGraph(currentState));
  await appendWorkflowEvent(workspace, 'initialized', {
    templatePack: currentState.templatePack,
    projectRoot,
  });
  await appendProgress(workspace, [
    `已初始化工作区: ${workspace.workspaceRoot}。`,
    `模板包: ${currentState.templatePack}。`,
  ]);

  return { ws: workspace, created: ws.created, currentState, standards, agentIntegration };
}

async function setupAgentIntegrationWorkspace(projectRoot, options = {}) {
  if (!(await exists(cjoin(projectRoot, '.openprd')))) {
    const initResult = await initWorkspace(projectRoot, options);
    return {
      ...initResult.agentIntegration,
      initialized: true,
      standards: initResult.standards,
      init: {
        workspaceRoot: initResult.ws.workspaceRoot,
        created: initResult.created,
        templatePack: initResult.currentState.templatePack,
      },
    };
  }

  const migration = await migrateWorkspaceSkeleton(projectRoot, { recordEvent: true });
  const standards = await initStandardsWorkspace(projectRoot, { force: Boolean(options.force) });
  const agentIntegration = await setupOpenPrdAgentIntegration(projectRoot, {
    tools: options.tools ?? 'all',
    force: Boolean(options.force),
    action: 'setup',
    enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
    codexHome: options.codexHome,
  });
  return { ...agentIntegration, initialized: false, migration, standards };
}

async function updateAgentIntegrationWorkspace(projectRoot, options = {}) {
  const migration = await migrateWorkspaceSkeleton(projectRoot, { recordEvent: true });
  const standards = await initStandardsWorkspace(projectRoot, { force: false });
  const agentIntegration = await updateOpenPrdAgentIntegration(projectRoot, {
    tools: options.tools ?? 'all',
    force: Boolean(options.force),
    enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
    codexHome: options.codexHome,
  });
  return { ...agentIntegration, migration, standards };
}

async function doctorWorkspace(projectRoot, options = {}) {
  const agentIntegration = await doctorOpenPrdAgentIntegration(projectRoot, {
    tools: options.tools ?? 'all',
    enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
    codexHome: options.codexHome,
  });
  const standards = await checkStandardsWorkspace(projectRoot).catch((error) => ({
    ok: false,
    errors: [error instanceof Error ? error.message : String(error)],
    warnings: [],
    checks: [],
    docsRoot: path.join('docs', 'basic'),
  }));
  const validation = await validateWorkspace(projectRoot)
    .then(({ report }) => report)
    .catch((error) => ({
      valid: false,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings: [],
      checks: [],
    }));

  return {
    ok: agentIntegration.ok && standards.ok && validation.valid,
    action: 'doctor',
    projectRoot,
    tools: agentIntegration.tools,
    agentIntegration,
    standards,
    validation,
    errors: [
      ...agentIntegration.errors,
      ...(standards.errors ?? []).map((error) => `standards: ${error}`),
      ...(validation.errors ?? []).map((error) => `validate: ${error}`),
    ],
  };
}

function harnessFile(projectRoot, relativePath) {
  return cjoin(projectRoot, relativePath);
}

async function ensureRunHarness(projectRoot) {
  await fs.mkdir(harnessFile(projectRoot, OPENPRD_HARNESS_DIR), { recursive: true });
  const statePath = harnessFile(projectRoot, OPENPRD_HARNESS_RUN_STATE);
  if (!(await exists(statePath))) {
    await writeJson(statePath, {
      version: 1,
      active: true,
      currentIteration: 0,
      lastContextAt: null,
      lastHookAt: null,
      lastOutcome: null,
      lastRecommendation: null,
    });
  }
  const iterationsPath = harnessFile(projectRoot, OPENPRD_HARNESS_ITERATIONS);
  if (!(await exists(iterationsPath))) {
    await writeText(iterationsPath, '');
  }
  const learningsPath = harnessFile(projectRoot, OPENPRD_HARNESS_LEARNINGS);
  if (!(await exists(learningsPath))) {
    await writeText(learningsPath, '# OpenPrd Harness Learnings\n\nReusable patterns discovered during hook-driven runs belong here.\n');
  }
}

async function readRunState(projectRoot) {
  await ensureRunHarness(projectRoot);
  return readJson(harnessFile(projectRoot, OPENPRD_HARNESS_RUN_STATE)).catch(() => ({
    version: 1,
    active: true,
    currentIteration: 0,
  }));
}

async function writeRunState(projectRoot, state) {
  await writeJson(harnessFile(projectRoot, OPENPRD_HARNESS_RUN_STATE), {
    version: 1,
    active: true,
    ...state,
    updatedAt: timestamp(),
  });
}

function compactTask(task) {
  if (!task) {
    return null;
  }
  return {
    id: task.id,
    title: task.title,
    relativePath: task.relativePath,
    lineNumber: task.lineNumber,
    verify: task.metadata?.verify ?? null,
    done: task.metadata?.done ?? null,
    deps: task.metadata?.deps ?? null,
  };
}

function compactCoverageItem(item) {
  if (!item) {
    return null;
  }
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    source: item.source ?? null,
    evidence: item.evidence ?? [],
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildRunRecommendation({ changes, taskState, discovery, next, loopFeatureList }) {
  const activeChange = changes?.activeChange ?? null;
  if (taskState?.nextTask) {
    const task = compactTask(taskState.nextTask);
    const totalTasks = Number(taskState.summary?.total ?? taskState.tasks?.length ?? 0);
    const pendingTasks = Number(taskState.summary?.pending ?? 0);
    if (totalTasks > OPENPRD_LOOP_REQUIRED_TASK_THRESHOLD || pendingTasks > OPENPRD_LOOP_REQUIRED_TASK_THRESHOLD) {
      const loopReady = loopFeatureList?.changeId === taskState.changeId && Array.isArray(loopFeatureList.tasks);
      return {
        type: 'loop-task',
        title: `用 Loop 执行 ${task.id}: ${task.title}`,
        command: loopReady
          ? `openprd loop . --run --agent codex --item ${shellQuote(task.id)} --commit`
          : `openprd loop . --plan --change ${shellQuote(taskState.changeId)} && openprd loop . --run --agent codex --item ${shellQuote(task.id)} --commit`,
        verifyCommand: `openprd loop . --verify --item ${shellQuote(task.id)}`,
        reason: `当前变更包含 ${totalTasks} 个任务，超过 ${OPENPRD_LOOP_REQUIRED_TASK_THRESHOLD} 个任务的轻量执行上限；必须按 OpenPrd Loop 拆成独立单任务会话、自测、测试报告和 commit。`,
        changeId: taskState.changeId,
        task,
        coverageItem: null,
        loop: {
          required: true,
          threshold: OPENPRD_LOOP_REQUIRED_TASK_THRESHOLD,
          planned: loopReady,
          totalTasks,
          pendingTasks,
        },
      };
    }
    return {
      type: 'task',
      title: `推进 ${task.id}: ${task.title}`,
      command: `openprd tasks . --change ${shellQuote(taskState.changeId)} --advance --verify --item ${shellQuote(task.id)}`,
      verifyCommand: task.verify ?? `openprd tasks . --change ${shellQuote(taskState.changeId)} --verify --item ${shellQuote(task.id)}`,
      reason: '存在一个依赖已就绪的 OpenPrd 任务。',
      changeId: taskState.changeId,
      task,
      coverageItem: null,
      loop: {
        required: false,
        threshold: OPENPRD_LOOP_REQUIRED_TASK_THRESHOLD,
        totalTasks,
        pendingTasks,
      },
    };
  }
  if (taskState && taskState.summary?.pending === 0 && activeChange) {
    return {
      type: 'change-review',
      title: `校验已完成的变更 ${activeChange}`,
      command: `openprd change . --validate --change ${shellQuote(activeChange)}`,
      verifyCommand: `openprd change . --validate --change ${shellQuote(activeChange)}`,
      reason: '当前激活变更没有待处理的结构化任务。',
      changeId: activeChange,
      task: null,
      coverageItem: null,
    };
  }
  const nextCoverage = discovery?.coverageMatrix?.nextPendingItem;
  if (nextCoverage) {
    const item = compactCoverageItem(nextCoverage);
    return {
      type: 'discovery',
      title: `调研 ${item.title}`,
      command: `openprd discovery . --advance --item ${shellQuote(item.id)} --claim <evidence-backed-claim> --evidence <path>`,
      verifyCommand: 'openprd discovery . --verify',
      reason: '存在一个待处理的 OpenPrd discovery 覆盖项。',
      changeId: activeChange,
      task: null,
      coverageItem: item,
    };
  }
  if (discovery?.coverageMatrix?.summary?.pending === 0 && discovery?.runId) {
    return {
      type: 'discovery-review',
      title: `校验 discovery run ${discovery.runId}`,
      command: 'openprd discovery . --verify',
      verifyCommand: 'openprd discovery . --verify',
      reason: '当前 discovery run 没有待处理覆盖项。',
      changeId: activeChange,
      task: null,
      coverageItem: null,
    };
  }
  return {
    type: 'workflow',
    title: next?.recommendation?.nextAction ?? 'Inspect OpenPrd next action',
    command: next?.recommendation?.suggestedCommand ?? 'openprd next .',
    verifyCommand: 'openprd validate .',
    reason: next?.recommendation?.reason ?? 'No active task or discovery item was found.',
    changeId: activeChange,
    task: null,
    coverageItem: null,
  };
}

async function buildRunContext(projectRoot) {
  await ensureRunHarness(projectRoot);
  const runState = await readRunState(projectRoot);
  const validation = await validateWorkspace(projectRoot)
    .then(({ report }) => report)
    .catch((error) => ({
      valid: false,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings: [],
      checks: [],
    }));
  const next = await nextWorkspace(projectRoot).catch(() => null);
  const changes = await listOpenPrdChangesWorkspace(projectRoot).catch(() => null);
  const activeChange = changes?.activeChange ?? null;
  const taskState = activeChange
    ? await listOpenSpecTaskWorkspace(projectRoot, { change: activeChange }).catch(() => null)
    : null;
  const discovery = await resumeOpenSpecDiscoveryWorkspace(projectRoot).catch(() => null);
  const loopFeatureList = await readJson(harnessFile(projectRoot, OPENPRD_HARNESS_LOOP_FEATURE_LIST)).catch(() => null);
  const recommendation = buildRunRecommendation({ changes, taskState, discovery, next, loopFeatureList });

  const context = {
    ok: validation.valid,
    action: 'run-context',
    projectRoot,
    generatedAt: timestamp(),
    runState,
    validation: {
      valid: validation.valid,
      errors: validation.errors ?? [],
      warnings: validation.warnings ?? [],
    },
    workflow: next?.workflow ?? [],
    next: next?.recommendation ?? null,
    activeChange,
    taskSummary: taskState?.summary ?? null,
    nextTask: compactTask(taskState?.nextTask ?? null),
    blockedTasks: taskState?.blockedTasks ?? [],
    discovery: discovery
      ? {
          runId: discovery.runId,
          mode: discovery.control?.mode ?? null,
          status: discovery.control?.status ?? null,
          iteration: discovery.control?.iteration ?? null,
          maxIterations: discovery.control?.maxIterations ?? null,
          summary: discovery.coverageMatrix?.summary ?? null,
          nextPendingItem: compactCoverageItem(discovery.coverageMatrix?.nextPendingItem ?? null),
        }
      : null,
    recommendation,
    files: {
      runState: OPENPRD_HARNESS_RUN_STATE,
      iterations: OPENPRD_HARNESS_ITERATIONS,
      learnings: OPENPRD_HARNESS_LEARNINGS,
    },
  };

  await writeRunState(projectRoot, {
    ...runState,
    lastContextAt: context.generatedAt,
    lastRecommendation: recommendation,
  });

  return context;
}

async function recordRunHook(projectRoot, options = {}) {
  await ensureRunHarness(projectRoot);
  const state = await readRunState(projectRoot);
  const currentIteration = Number(state.currentIteration ?? 0) + 1;
  const event = {
    version: 1,
    at: timestamp(),
    iteration: currentIteration,
    type: 'hook',
    eventName: options.event ?? 'Unknown',
    risk: options.risk ?? 'unknown',
    outcome: options.outcome ?? 'unknown',
    preview: options.preview ?? null,
  };
  await appendJsonl(harnessFile(projectRoot, OPENPRD_HARNESS_ITERATIONS), event);
  await writeRunState(projectRoot, {
    ...state,
    currentIteration,
    lastHookAt: event.at,
    lastOutcome: event.outcome,
  });
  if (options.learn) {
    await appendText(harnessFile(projectRoot, OPENPRD_HARNESS_LEARNINGS), `\n## ${event.at}\n\n- ${options.learn}\n`);
  }
  return {
    ok: true,
    action: 'run-record-hook',
    projectRoot,
    event,
    files: {
      runState: OPENPRD_HARNESS_RUN_STATE,
      iterations: OPENPRD_HARNESS_ITERATIONS,
      learnings: OPENPRD_HARNESS_LEARNINGS,
    },
  };
}

async function verifyRunWorkspace(projectRoot) {
  const context = await buildRunContext(projectRoot);
  const standards = await checkStandardsWorkspace(projectRoot);
  const validation = await validateWorkspace(projectRoot).then(({ report }) => report);
  const checks = [
    { name: 'standards', ok: standards.ok, errors: standards.errors ?? [] },
    { name: 'validate', ok: validation.valid, errors: validation.errors ?? [] },
  ];
  if (context.activeChange) {
    const change = await validateOpenSpecChangeWorkspace(projectRoot, { change: context.activeChange });
    checks.push({ name: 'change', ok: change.ok, errors: change.errors ?? [] });
  }
  if (context.discovery) {
    const discovery = await verifyOpenSpecDiscoveryWorkspace(projectRoot);
    checks.push({ name: 'discovery', ok: discovery.ok, errors: discovery.verification.errors ?? [] });
  }
  const ok = checks.every((check) => check.ok);
  await appendJsonl(harnessFile(projectRoot, OPENPRD_HARNESS_ITERATIONS), {
    version: 1,
    at: timestamp(),
    type: 'verify',
    ok,
    checks: checks.map((check) => ({ name: check.name, ok: check.ok, errors: check.errors.length })),
  });
  return {
    ok,
    action: 'run-verify',
    projectRoot,
    context,
    checks,
    errors: checks.flatMap((check) => check.errors.map((error) => `${check.name}: ${error}`)),
  };
}

async function runWorkspace(projectRoot, options = {}) {
  if (options.recordHook) {
    return recordRunHook(projectRoot, options);
  }
  if (options.verify) {
    return verifyRunWorkspace(projectRoot);
  }
  return buildRunContext(projectRoot);
}

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

async function fleetWorkspace(rootPath, options = {}) {
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

async function freezeWorkspace(projectRoot) {
  const validation = await validateWorkspace(projectRoot);
  const { report } = validation;
  if (!report.valid) {
    await appendWorkflowEvent(validation.ws, 'freeze_failed', {
      errors: report.errors,
      warnings: report.warnings,
    });
    await appendVerification(validation.ws, [
      'Freeze 验证失败。',
      ...report.errors.map((error) => `错误: ${error}`),
      ...report.warnings.map((warning) => `警告: ${warning}`),
    ]);
    return { ok: false, report, ws: validation.ws };
  }

  let ws = validation.ws;
  let latest = await loadLatestVersionSnapshot(ws);
  if (!latest) {
    const synthesized = await synthesizeWorkspace(projectRoot, {});
    ws = synthesized.ws;
    latest = { indexEntry: synthesized.indexEntry, snapshot: synthesized.snapshot };
  }

  const digest = await computeWorkspaceDigest(ws);
  const snapshot = {
    version: 1,
    frozenAt: timestamp(),
    projectRoot: ws.projectRoot,
    workspaceRoot: ws.workspaceRoot,
    schema: ws.data.schema?.name ?? null,
    templatePack: resolveActiveTemplatePack(ws),
    productTypes: ws.data.config?.supportedProductTypes ?? [],
    prdVersion: latest.snapshot.versionNumber,
    latestVersionId: latest.snapshot.versionId,
    digest,
    status: 'frozen',
  };
  await writeJson(ws.paths.freezeState, snapshot);
  await writeJson(ws.paths.taskGraph, buildWorkflowTaskGraph(null));

  const currentState = {
    ...(ws.data.currentState ?? {}),
    status: 'frozen',
    prdVersion: latest.snapshot.versionNumber,
    latestVersionId: latest.snapshot.versionId,
    templatePack: resolveActiveTemplatePack(ws),
    frozenAt: snapshot.frozenAt,
    digest,
  };
  await writeJson(ws.paths.currentState, currentState);
  await appendWorkflowEvent(ws, 'frozen', {
    versionId: snapshot.latestVersionId,
    digest,
  });
  await appendVerification(ws, [
    'Freeze 验证通过。',
    `版本: ${snapshot.latestVersionId}`,
    `Digest: ${digest}`,
    `PRD 版本: ${snapshot.prdVersion}`,
  ]);
  await appendProgress(ws, [
    `已 freeze PRD 版本 ${snapshot.latestVersionId}。`,
    `Digest: ${digest}`,
  ]);
  await appendDecision(ws, [
    `已 freeze 版本 ${snapshot.latestVersionId}。`,
    `已准备好交接给 ${resolveActiveTemplatePack(ws) === 'base' ? '下游执行方' : '执行系统'}。`,
  ]);
  await writeJson(ws.paths.taskGraph, buildWorkflowTaskGraph(currentState));

  return { ok: true, ws, report, snapshot, latest };
}

async function handoffWorkspace(projectRoot, target) {
  const freeze = await freezeWorkspace(projectRoot);
  if (!freeze.ok) {
    return freeze;
  }

  const { ws, snapshot } = freeze;
  const exportDir = cjoin(ws.paths.exportsDir, target);
  await fs.mkdir(exportDir, { recursive: true });

  const handoff = {
    version: 1,
    versionId: snapshot.latestVersionId,
    versionNumber: snapshot.prdVersion,
    target,
    generatedAt: timestamp(),
    workspaceRoot: ws.workspaceRoot,
    projectRoot: ws.projectRoot,
    schema: ws.data.schema?.name ?? null,
    templatePack: resolveActiveTemplatePack(ws),
    productTypes: ws.data.config?.supportedProductTypes ?? [],
    productType: resolveCurrentProductType(ws),
    digest: snapshot.digest,
    sourceFiles: [
      ...CORE_TEMPLATE_FILES,
      ...((await exists(ws.paths.activeArchitectureDiagramHtml)) ? ['engagements/active/architecture-diagram.html'] : []),
      ...((await exists(ws.paths.activeArchitectureDiagramJson)) ? ['engagements/active/architecture-diagram.json'] : []),
      ...((await exists(ws.paths.activeArchitectureDiagramMermaid)) ? ['engagements/active/architecture-diagram.mmd'] : []),
      ...((await exists(ws.paths.activeProductFlowDiagramHtml)) ? ['engagements/active/product-flow-diagram.html'] : []),
      ...((await exists(ws.paths.activeProductFlowDiagramJson)) ? ['engagements/active/product-flow-diagram.json'] : []),
      ...((await exists(ws.paths.activeProductFlowDiagramMermaid)) ? ['engagements/active/product-flow-diagram.mmd'] : []),
    ],
    nextStep: target === 'openprd' || target === 'openspec'
      ? 'Generate an OpenPrd change and continue with specs/design/tasks.'
      : 'Consume the handoff bundle in the downstream system.',
  };

  await writeJson(cjoin(exportDir, 'handoff.json'), handoff);
  await writeText(cjoin(exportDir, 'handoff.md'), `# 交接\n\n- 目标: ${target}\n- 版本: ${handoff.versionId}\n- Schema: ${handoff.schema}\n- 模板包: ${handoff.templatePack}\n- Digest: ${handoff.digest}\n- 下一步: ${handoff.nextStep}\n`);
  if (await exists(ws.paths.activeArchitectureDiagramHtml)) {
    await fs.copyFile(ws.paths.activeArchitectureDiagramHtml, cjoin(exportDir, 'architecture-diagram.html'));
  }
  if (await exists(ws.paths.activeArchitectureDiagramJson)) {
    await fs.copyFile(ws.paths.activeArchitectureDiagramJson, cjoin(exportDir, 'architecture-diagram.json'));
  }
  if (await exists(ws.paths.activeArchitectureDiagramMermaid)) {
    await fs.copyFile(ws.paths.activeArchitectureDiagramMermaid, cjoin(exportDir, 'architecture-diagram.mmd'));
  }
  if (await exists(ws.paths.activeProductFlowDiagramHtml)) {
    await fs.copyFile(ws.paths.activeProductFlowDiagramHtml, cjoin(exportDir, 'product-flow-diagram.html'));
  }
  if (await exists(ws.paths.activeProductFlowDiagramJson)) {
    await fs.copyFile(ws.paths.activeProductFlowDiagramJson, cjoin(exportDir, 'product-flow-diagram.json'));
  }
  if (await exists(ws.paths.activeProductFlowDiagramMermaid)) {
    await fs.copyFile(ws.paths.activeProductFlowDiagramMermaid, cjoin(exportDir, 'product-flow-diagram.mmd'));
  }
  await appendWorkflowEvent(ws, 'handoff', {
    target,
    versionId: handoff.versionId,
  });
  await appendProgress(ws, [
    `已生成面向 ${target} 的交接包。`,
    `版本: ${handoff.versionId}`,
  ]);
  await appendDecision(ws, [
    `交接目标已设置为 ${target}。`,
    `版本 ${handoff.versionId} 已导出到 ${exportDir}。`,
  ]);

  const currentState = {
    ...(ws.data.currentState ?? {}),
    status: 'handed_off',
    handedOffAt: handoff.generatedAt,
    handoffTarget: target,
  };
  await writeJson(ws.paths.currentState, currentState);
  await writeJson(ws.paths.taskGraph, buildWorkflowTaskGraph(currentState));

  return { ok: true, ws, report: freeze.report, snapshot, handoff, exportDir };
}

async function generateOpenSpecChangeWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  const versionIndex = await readVersionIndex(ws);
  const latest = await loadLatestVersionSnapshot(ws);
  const currentState = ws.data.currentState ?? {};
  const snapshot = latest?.snapshot ?? buildPrdSnapshot(ws, {
    ...currentState,
    versionNumber: currentState.prdVersion ?? (versionIndex.at(-1)?.versionNumber ?? 0),
    versionId: currentState.prdVersion > 0
      ? formatVersionId(currentState.prdVersion)
      : (versionIndex.at(-1)?.versionId ?? 'v0000'),
    productType: resolveCurrentProductType(ws),
    templatePack: resolveActiveTemplatePack(ws),
  });
  const analysis = analyzePrdSnapshot(snapshot);
  const result = await writeOpenSpecChangeWorkspace(projectRoot, {
    ...options,
    snapshot,
    analysis,
  });
  const validation = await validateOpenSpecChangeWorkspace(projectRoot, { change: result.changeId });
  await activateOpenPrdChangeWorkspace(projectRoot, { change: result.changeId });

  await appendWorkflowEvent(ws, 'openprd_change_generated', {
    changeId: result.changeId,
    taskCount: result.taskCount,
    valid: validation.valid,
  });
  await appendProgress(ws, [
    `已生成 OpenPrd change ${result.changeId}。`,
    `任务数: ${result.taskCount}。`,
    `验证: ${validation.valid ? '通过' : '失败'}。`,
  ]);

  return {
    ...result,
    ws,
    snapshot,
    analysis,
    validation,
    ok: result.ok && validation.ok,
  };
}

function slugify(value, fallback = 'item') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function normalizeDiscoveryMode(mode) {
  const normalized = String(mode ?? 'auto').trim().toLowerCase();
  if (!OPENSPEC_DISCOVERY_MODES.includes(normalized)) {
    throw new Error(`Unsupported OpenPrd discovery mode: ${mode}`);
  }
  return normalized;
}

async function resolveDiscoveryMode(projectRoot, options = {}) {
  const requested = String(options.mode ?? 'auto').trim().toLowerCase();
  if (requested && requested !== 'auto') {
    return normalizeDiscoveryMode(requested);
  }
  if (options.reference) {
    return 'reference';
  }

  let entries = [];
  try {
    entries = await fs.readdir(projectRoot, { withFileTypes: true });
  } catch {
    return 'requirement';
  }

  const hasProjectMaterial = entries.some((entry) => {
    if (shouldIgnoreSourceDirectory(entry.name)) {
      return false;
    }
    if (entry.isDirectory()) {
      return true;
    }
    return entry.isFile() && shouldInventorySourceFile(entry.name);
  });

  return hasProjectMaterial ? 'brownfield' : 'requirement';
}

function normalizeDiscoveryMaxIterations(value) {
  const normalized = Number(value ?? OPENSPEC_DISCOVERY_DEFAULT_MAX_ITERATIONS);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new Error(`Invalid OpenPrd discovery max iterations: ${value}`);
  }
  return normalized;
}

function normalizeCoverageStatus(status) {
  const normalized = String(status ?? 'covered').trim().toLowerCase();
  if (!OPENSPEC_DISCOVERY_COVERAGE_STATUSES.includes(normalized)) {
    throw new Error(`Unsupported OpenPrd discovery coverage status: ${status}`);
  }
  return normalized;
}

function normalizeClaimConfidence(value) {
  const normalized = Number(value ?? 0.7);
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1) {
    throw new Error(`Invalid OpenPrd discovery claim confidence: ${value}`);
  }
  return normalized;
}

function buildDiscoveryRunId(mode, now = new Date()) {
  const stamp = compactTimestamp(now);
  return `${stamp}-${mode}`;
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

function claimValuePreview(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 5).map((item) => String(item)).join(', ');
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value).slice(0, 240);
  }
  return String(value ?? '').slice(0, 240);
}

function buildSeedClaims(analysis) {
  return analysis.completeFields.slice(0, 80).map((field) => ({
    id: `claim:${slugify(field.path)}`,
    status: 'seeded',
    source: 'openprd-snapshot',
    confidence: 0.7,
    path: field.path,
    summary: `${field.label}: ${claimValuePreview(field.value)}`,
  }));
}

function buildCoverageItems({ mode, inventory, analysis }) {
  const missingFieldItems = analysis.missingFields.map((field) => ({
    id: `field:${slugify(field.path)}`,
    title: field.label,
    kind: 'missing-prd-field',
    status: 'pending',
    priority: 'high',
    target: field.path,
    prompt: field.prompt,
    source: 'openprd-analysis',
    claimIds: [],
  }));

  const sourceItems = inventory.files.slice(0, 120).map((file) => ({
    id: `source:${slugify(file.path)}`,
    title: file.path,
    kind: `${file.kind}-evidence`,
    status: 'pending',
    priority: file.kind === 'implementation' || file.kind === 'schema' ? 'medium' : 'low',
    source: file.path,
    claimIds: [],
  }));

  const items = mode === 'requirement'
    ? missingFieldItems
    : [...missingFieldItems, ...sourceItems];

  if (items.length === 0) {
    items.push({
      id: 'review:openprd-completeness',
      title: 'OpenPrd completeness review',
      kind: 'review',
      status: 'pending',
      priority: 'medium',
      source: 'generated',
      claimIds: [],
    });
  }

  const pendingItems = items.filter((item) => item.status === 'pending');
  return {
    version: 1,
    generatedAt: timestamp(),
    mode,
    summary: {
      total: items.length,
      pending: pendingItems.length,
      covered: items.filter((item) => item.status === 'covered').length,
      blocked: items.filter((item) => item.status === 'blocked').length,
    },
    nextPendingItem: pendingItems[0] ?? null,
    items,
  };
}

function summarizeCoverageItems(items) {
  const pendingItems = items.filter((item) => item.status === 'pending');
  return {
    summary: {
      total: items.length,
      pending: pendingItems.length,
      covered: items.filter((item) => item.status === 'covered').length,
      blocked: items.filter((item) => item.status === 'blocked').length,
    },
    nextPendingItem: pendingItems[0] ?? null,
  };
}

function refreshCoverageMatrix(coverageMatrix) {
  const { summary, nextPendingItem } = summarizeCoverageItems(coverageMatrix.items ?? []);
  return {
    ...coverageMatrix,
    generatedAt: timestamp(),
    summary,
    nextPendingItem,
  };
}

function renderDiscoveryContext({ mode, projectRoot, sourceRoot, snapshot, analysis, coverageMatrix }) {
  const next = coverageMatrix.nextPendingItem;
  return [
    '# OpenPrd Discovery Context',
    '',
    `- 模式: ${mode}`,
    `- 项目根目录: ${projectRoot}`,
    `- 来源根目录: ${sourceRoot}`,
    `- PRD 版本: ${snapshot.versionId}`,
    `- 产品类型: ${snapshot.productType ?? '未分类'}`,
    `- 必填字段完成度: ${analysis.completedRequiredFields}/${analysis.totalRequiredFields}`,
    `- 覆盖项: ${coverageMatrix.summary.pending}/${coverageMatrix.summary.total} 待处理`,
    next ? `- 下一项: ${next.title}` : '- 下一项: 无',
    '',
    '## 执行循环',
    '',
    '1. 从本次运行目录和 OpenPrd 工作区重建上下文。',
    '2. 选择下一个待处理覆盖项。',
    '3. 在写入新的 OpenPrd claim 前先收集证据。',
    '4. 更新 OpenPrd 文档、claims、覆盖状态、开放问题和迭代记录。',
    '5. 只有在覆盖项处理完成、被阻断或达到迭代预算时才停止。',
    '',
  ].join('\n');
}

function renderDiscoveryOpenQuestions(analysis, mode) {
  const questions = analysis.missingFields.map((field) => `- [ ] ${field.prompt} (${field.path})`);
  if (questions.length === 0) {
    questions.push('- [ ] 检查是否仍有隐含行为缺少 OpenPrd 覆盖。');
  }
  return [
    '# 开放问题',
    '',
    `模式: ${mode}`,
    '',
    ...questions,
    '',
  ].join('\n');
}

async function openspecDiscoveryWorkspace(projectRoot, options = {}) {
  if (options.verify) {
    return verifyOpenSpecDiscoveryWorkspace(projectRoot);
  }

  if (options.advance) {
    return advanceOpenSpecDiscoveryWorkspace(projectRoot, options);
  }

  if (options.resume) {
    return resumeOpenSpecDiscoveryWorkspace(projectRoot);
  }

  const mode = await resolveDiscoveryMode(projectRoot, options);
  const maxIterations = normalizeDiscoveryMaxIterations(options.maxIterations);
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const versionIndex = await readVersionIndex(ws);
  const latest = await loadLatestVersionSnapshot(ws).catch(() => null);
  const currentState = ws.data.currentState ?? {};
  const snapshot = latest?.snapshot ?? buildPrdSnapshot(ws, {
    ...currentState,
    versionNumber: currentState.prdVersion ?? (versionIndex.at(-1)?.versionNumber ?? 0),
    versionId: currentState.prdVersion > 0
      ? formatVersionId(currentState.prdVersion)
      : (versionIndex.at(-1)?.versionId ?? 'v0000'),
    productType: resolveCurrentProductType(ws),
    templatePack: resolveActiveTemplatePack(ws),
  });
  const analysis = analyzePrdSnapshot(snapshot);

  const sourceRoot = mode === 'reference' && options.reference
    ? path.resolve(projectRoot, options.reference)
    : projectRoot;
  const inventory = await collectSourceInventory(sourceRoot, {
    maxDepth: options.maxDepth,
    maxFiles: options.maxFiles,
  });
  const coverageMatrix = buildCoverageItems({ mode, inventory, analysis });
  const claims = buildSeedClaims(analysis);
  const runId = options.runId ?? buildDiscoveryRunId(mode);
  const discoveryRoot = openPrdDiscoveryDir(projectRoot);
  const runDir = cjoin(discoveryRoot, 'runs', runId);
  const now = timestamp();
  const control = {
    version: 1,
    runId,
    mode,
    status: coverageMatrix.summary.pending > 0 ? 'active' : 'ready_for_review',
    iteration: 1,
    maxIterations,
    createdAt: now,
    updatedAt: now,
    projectRoot,
    openprdWorkspaceRoot: ws.workspaceRoot,
    sourceRoot,
    referencePath: mode === 'reference' ? (options.reference ?? null) : null,
    latestPrdVersion: snapshot.versionId,
    nextAction: coverageMatrix.nextPendingItem
      ? `Investigate ${coverageMatrix.nextPendingItem.title}`
      : 'Review OpenPrd completeness',
  };
  const firstIteration = {
    iteration: 1,
    at: now,
    action: 'initialized',
    mode,
    nextCoverageItemId: coverageMatrix.nextPendingItem?.id ?? null,
    pendingCoverageItems: coverageMatrix.summary.pending,
    seededClaims: claims.length,
  };

  await fs.mkdir(runDir, { recursive: true });
  await writeJson(cjoin(discoveryRoot, 'current.json'), {
    version: 1,
    activeRunId: runId,
    activeRunDir: runDir,
    mode,
    updatedAt: now,
  });
  await writeText(cjoin(discoveryRoot, 'README.md'), [
    '# OpenPrd Discovery',
    '',
    'This directory stores continuous discovery state for OpenPrd work.',
    '',
    '## Files',
    '',
    '- `control.json` tracks the active loop state and iteration budget.',
    '- `coverage-matrix.json` tracks what still needs to be mined into OpenPrd specs and tasks.',
    '- `claims.jsonl` records evidence-backed requirement claims.',
    '- `open-questions.md` keeps unresolved user or product questions visible.',
    '- `iterations.jsonl` records each loop pass.',
    '',
    '## Task Sharding',
    '',
    '- Keep `tasks.md` as the first task entry.',
    '- Continue long changes with `tasks-002.md`, `tasks-003.md`, and so on.',
    '- The last checkbox in every non-final task file must hand off to the next file.',
    '- Projects may override the max task count in `.openprd/discovery/config.json` at `taskSharding.maxItemsPerFile`.',
    '- For structured tasks, use only `deps`, `done`, and `verify` metadata under a stable task id.',
    '',
    '```md',
    '- [ ] T009.07 Port legacy database import preview',
    '  - deps: T001.14, T007.06',
    '  - done: preview shows counts, conflicts, skipped items, warnings',
    '  - verify: npm run test -- migration',
    '```',
    '',
    '- Omit `deps` when there are no dependencies.',
    '',
  ].join('\n'));
  await writeJson(cjoin(runDir, 'control.json'), control);
  await writeText(cjoin(runDir, 'context.md'), renderDiscoveryContext({
    mode,
    projectRoot,
    sourceRoot,
    snapshot,
    analysis,
    coverageMatrix,
  }));
  await writeJson(cjoin(runDir, 'source-inventory.json'), inventory);
  await writeJson(cjoin(runDir, 'coverage-matrix.json'), coverageMatrix);
  await writeText(cjoin(runDir, 'claims.jsonl'), `${claims.map((claim) => JSON.stringify(claim)).join('\n')}${claims.length > 0 ? '\n' : ''}`);
  await writeText(cjoin(runDir, 'open-questions.md'), renderDiscoveryOpenQuestions(analysis, mode));
  await writeText(cjoin(runDir, 'iterations.jsonl'), `${JSON.stringify(firstIteration)}\n`);

  await appendWorkflowEvent(ws, 'openspec_discovery_initialized', {
    runId,
    mode,
    pendingCoverageItems: coverageMatrix.summary.pending,
  });
  await appendProgress(ws, [
    `Initialized OpenPrd discovery run ${runId}.`,
    `Mode: ${mode}.`,
    `Pending coverage items: ${coverageMatrix.summary.pending}.`,
  ]);

  return {
    ok: true,
    resumed: false,
    ws,
    runId,
    runDir,
    discoveryRoot,
    control,
    inventory,
    coverageMatrix,
    claims,
    openQuestionsPath: cjoin(runDir, 'open-questions.md'),
  };
}

async function loadOpenSpecDiscoveryRun(projectRoot) {
  let discoveryRoot = openPrdDiscoveryDir(projectRoot);
  if (!(await exists(cjoin(discoveryRoot, 'current.json')))) {
    const legacyRoot = legacyOpenSpecDiscoveryDir(projectRoot);
    if (await exists(cjoin(legacyRoot, 'current.json'))) {
      discoveryRoot = legacyRoot;
    }
  }
  const currentPath = cjoin(discoveryRoot, 'current.json');
  if (!(await exists(currentPath))) {
    throw new Error(`Missing OpenPrd discovery state: ${currentPath}`);
  }

  const current = await readJson(currentPath);
  const runDir = current.activeRunDir;
  const control = await readJson(cjoin(runDir, 'control.json'));
  const inventory = await readJson(cjoin(runDir, 'source-inventory.json'));
  const coverageMatrix = await readJson(cjoin(runDir, 'coverage-matrix.json'));
  const claims = await readJsonl(cjoin(runDir, 'claims.jsonl')).catch(() => []);

  return {
    current,
    runId: current.activeRunId,
    runDir,
    discoveryRoot,
    control,
    inventory,
    coverageMatrix,
    claims,
    openQuestionsPath: cjoin(runDir, 'open-questions.md'),
  };
}

async function resumeOpenSpecDiscoveryWorkspace(projectRoot) {
  const state = await loadOpenSpecDiscoveryRun(projectRoot);

  return {
    ok: true,
    resumed: true,
    runId: state.runId,
    runDir: state.runDir,
    discoveryRoot: state.discoveryRoot,
    control: state.control,
    inventory: state.inventory,
    coverageMatrix: state.coverageMatrix,
    claims: state.claims,
    openQuestionsPath: state.openQuestionsPath,
  };
}

async function advanceOpenSpecDiscoveryWorkspace(projectRoot, options = {}) {
  const state = await loadOpenSpecDiscoveryRun(projectRoot);
  const coverageMatrix = state.coverageMatrix;
  const items = Array.isArray(coverageMatrix.items) ? coverageMatrix.items : [];
  const nextPending = coverageMatrix.nextPendingItem ?? items.find((item) => item.status === 'pending');
  const itemId = options.item ?? nextPending?.id;
  if (!itemId) {
    throw new Error('No pending OpenPrd discovery coverage item to advance.');
  }

  const itemIndex = items.findIndex((item) => item.id === itemId);
  if (itemIndex < 0) {
    throw new Error(`Unknown OpenPrd discovery coverage item: ${itemId}`);
  }

  const status = normalizeCoverageStatus(options.status);
  const claimSummary = options.claim ?? null;
  const notes = options.notes ?? null;
  if (status === 'covered' && !claimSummary && !notes) {
    throw new Error('Covering an OpenPrd discovery item requires --claim or --notes.');
  }
  if (status === 'blocked' && !notes && !claimSummary) {
    throw new Error('Blocking an OpenPrd discovery item requires --notes or --claim.');
  }

  const now = timestamp();
  const item = {
    ...items[itemIndex],
    status,
    updatedAt: now,
  };
  if (notes) {
    item.notes = notes;
  }
  if (options.evidence) {
    item.evidence = [...new Set([...(item.evidence ?? []), options.evidence])];
  }

  let claim = null;
  if (claimSummary) {
    const nextIteration = Number(state.control.iteration ?? 0) + 1;
    claim = {
      id: `claim:${slugify(item.id)}:${nextIteration}`,
      status: 'active',
      source: options.source ?? (options.evidence ? 'project-derived' : 'agent-inferred'),
      confidence: normalizeClaimConfidence(options.confidence),
      coverageItemId: item.id,
      summary: claimSummary,
      evidence: options.evidence ? [options.evidence] : [],
      notes,
      createdAt: now,
    };
    item.claimIds = [...new Set([...(item.claimIds ?? []), claim.id])];
    await appendJsonl(cjoin(state.runDir, 'claims.jsonl'), claim);
  }

  items[itemIndex] = item;
  const updatedCoverageMatrix = refreshCoverageMatrix({
    ...coverageMatrix,
    items,
  });
  const nextIteration = Number(state.control.iteration ?? 0) + 1;
  const updatedControl = {
    ...state.control,
    iteration: nextIteration,
    updatedAt: now,
    status: updatedCoverageMatrix.summary.pending > 0 ? 'active' : 'ready_for_review',
    nextAction: updatedCoverageMatrix.nextPendingItem
      ? `Investigate ${updatedCoverageMatrix.nextPendingItem.title}`
      : 'Review OpenPrd completeness',
  };
  const iterationEntry = {
    iteration: nextIteration,
    at: now,
    action: 'advance',
    coverageItemId: item.id,
    status,
    claimId: claim?.id ?? null,
    evidence: options.evidence ?? null,
    notes,
    pendingCoverageItems: updatedCoverageMatrix.summary.pending,
  };

  await writeJson(cjoin(state.runDir, 'coverage-matrix.json'), updatedCoverageMatrix);
  await writeJson(cjoin(state.runDir, 'control.json'), updatedControl);
  await appendJsonl(cjoin(state.runDir, 'iterations.jsonl'), iterationEntry);

  return {
    ok: true,
    advanced: true,
    runId: state.runId,
    runDir: state.runDir,
    discoveryRoot: state.discoveryRoot,
    control: updatedControl,
    inventory: state.inventory,
    coverageMatrix: updatedCoverageMatrix,
    claims: claim ? [...state.claims, claim] : state.claims,
    advancedItem: item,
    claim,
    openQuestionsPath: state.openQuestionsPath,
  };
}

function verifyOpenSpecDiscoveryState(state) {
  const errors = [];
  const warnings = [];
  const checks = [];
  const items = Array.isArray(state.coverageMatrix.items) ? state.coverageMatrix.items : [];

  if (!state.control.runId) {
    errors.push('control.json is missing runId.');
  }
  if (!OPENSPEC_DISCOVERY_MODES.includes(state.control.mode)) {
    errors.push(`control.json has unsupported mode: ${state.control.mode}`);
  }
  if (!Number.isInteger(Number(state.control.iteration)) || Number(state.control.iteration) < 1) {
    errors.push('control.json has invalid iteration.');
  }
  if (!Number.isInteger(Number(state.control.maxIterations)) || Number(state.control.maxIterations) < 1) {
    errors.push('control.json has invalid maxIterations.');
  }
  if (Number(state.control.iteration) > Number(state.control.maxIterations)) {
    warnings.push('OpenPrd discovery iteration budget has been reached.');
  }

  if (!Array.isArray(state.coverageMatrix.items)) {
    errors.push('coverage-matrix.json is missing items.');
  }

  for (const item of items) {
    if (!item.id) {
      errors.push('coverage item is missing id.');
    }
    if (!OPENSPEC_DISCOVERY_COVERAGE_STATUSES.includes(item.status)) {
      errors.push(`coverage item ${item.id ?? '<unknown>'} has unsupported status: ${item.status}`);
    }
    if (item.status === 'covered' && (!Array.isArray(item.claimIds) || item.claimIds.length === 0) && !item.notes) {
      warnings.push(`covered item ${item.id} has no claimIds or notes.`);
    }
  }

  const recomputed = summarizeCoverageItems(items);
  const storedSummary = state.coverageMatrix.summary ?? {};
  for (const key of ['total', 'pending', 'covered', 'blocked']) {
    if (Number(storedSummary[key] ?? 0) !== recomputed.summary[key]) {
      errors.push(`coverage summary mismatch for ${key}: expected ${recomputed.summary[key]}, found ${storedSummary[key]}`);
    }
  }

  for (const claim of state.claims) {
    if (!claim.id) {
      errors.push('claim is missing id.');
    }
    if (!claim.summary) {
      errors.push(`claim ${claim.id ?? '<unknown>'} is missing summary.`);
    }
    if (!claim.source) {
      warnings.push(`claim ${claim.id ?? '<unknown>'} is missing source.`);
    }
    if (claim.source !== 'user-confirmed' && claim.source !== 'openprd-snapshot' && (!Array.isArray(claim.evidence) || claim.evidence.length === 0)) {
      warnings.push(`claim ${claim.id ?? '<unknown>'} has no evidence path.`);
    }
  }

  checks.push(`Coverage: ${recomputed.summary.covered}/${recomputed.summary.total} covered, ${recomputed.summary.pending} pending, ${recomputed.summary.blocked} blocked.`);
  checks.push(`Claims: ${state.claims.length}.`);

  return {
    valid: errors.length === 0,
    complete: recomputed.summary.pending === 0,
    errors,
    warnings,
    checks,
    coverage: recomputed.summary,
    nextPendingItem: recomputed.nextPendingItem,
  };
}

async function verifyOpenSpecDiscoveryWorkspace(projectRoot) {
  const state = await loadOpenSpecDiscoveryRun(projectRoot);
  const verification = verifyOpenSpecDiscoveryState(state);
  const discoveryConfig = await readDiscoveryConfig(projectRoot, readJson);
  let openSpecChange = null;
  let taskVolume = null;
  let standards = null;
  if (discoveryConfig?.activeChange) {
    openSpecChange = await validateOpenSpecChangeWorkspace(projectRoot, {
      change: discoveryConfig.activeChange,
      sourceManuals: false,
      docsContent: false,
    });
    taskVolume = openSpecChange.taskVolume;
    standards = openSpecChange.standards ?? null;
    verification.errors.push(...openSpecChange.errors);
    verification.warnings.push(...openSpecChange.warnings);
    verification.checks.push(...openSpecChange.checks);
  } else {
    taskVolume = await analyzeOpenSpecTaskVolumes(projectRoot);
    verification.errors.push(...taskVolume.errors);
    verification.checks.push(...taskVolume.checks);
    standards = await checkStandardsWorkspace(projectRoot, {
      optional: !(await exists(cjoin(projectRoot, '.openprd'))),
      sourceManuals: false,
      docsContent: false,
    });
    if (!standards.skipped) {
      verification.errors.push(...standards.errors);
      verification.warnings.push(...standards.warnings);
      verification.checks.push(...standards.checks);
    }
  }
  verification.valid = verification.errors.length === 0;
  const now = timestamp();
  const updatedControl = {
    ...state.control,
    status: verification.complete && verification.valid ? 'ready_for_review' : state.control.status,
    lastVerifiedAt: now,
    updatedAt: now,
  };
  await writeJson(cjoin(state.runDir, 'control.json'), updatedControl);
  await appendJsonl(cjoin(state.runDir, 'iterations.jsonl'), {
    iteration: state.control.iteration,
    at: now,
    action: 'verify',
    valid: verification.valid,
    complete: verification.complete,
    errors: verification.errors.length,
    warnings: verification.warnings.length,
  });

  return {
    ok: verification.valid,
    verified: true,
    runId: state.runId,
    runDir: state.runDir,
    discoveryRoot: state.discoveryRoot,
    control: updatedControl,
    inventory: state.inventory,
    coverageMatrix: state.coverageMatrix,
    claims: state.claims,
    verification,
    openSpecChange,
    taskVolume,
    standards,
    openQuestionsPath: state.openQuestionsPath,
  };
}

function parseCommandArgs(argv) {
  const args = [...argv];
  const flags = { json: false, force: false, open: false, append: false, init: false, check: false, resume: false, advance: false, verify: false, next: false, generate: false, validate: false, apply: false, archive: false, activate: false, close: false, keep: false, dryRun: false, updateOpenprd: false, setupMissing: false, doctor: false, context: false, recordHook: false, plan: false, prompt: false, loopRun: false, finish: false, commit: false, mark: null, type: 'architecture', mode: 'auto', input: null, field: null, value: null, jsonFile: null, source: null, reference: null, maxIterations: null, maxDepth: null, include: null, exclude: null, report: null, item: null, id: null, status: null, claim: null, notes: null, confidence: null, change: null, tools: 'all', templatePack: null, target: 'openprd', path: null, productType: null, title: null, owner: null, problem: null, whyNow: null, evidence: null, from: null, to: null, event: null, risk: null, outcome: null, preview: null, learn: null, agent: 'codex', agentCommand: null, message: null };
  const positionals = [];

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (arg === '--force') {
      flags.force = true;
      continue;
    }
    if (arg === '--open') {
      flags.open = true;
      continue;
    }
    if (arg === '--append') {
      flags.append = true;
      continue;
    }
    if (arg === '--init') {
      flags.init = true;
      continue;
    }
    if (arg === '--check') {
      flags.check = true;
      continue;
    }
    if (arg === '--resume') {
      flags.resume = true;
      continue;
    }
    if (arg === '--advance') {
      flags.advance = true;
      continue;
    }
    if (arg === '--verify') {
      flags.verify = true;
      continue;
    }
    if (arg === '--generate') {
      flags.generate = true;
      continue;
    }
    if (arg === '--validate') {
      flags.validate = true;
      continue;
    }
    if (arg === '--apply') {
      flags.apply = true;
      continue;
    }
    if (arg === '--archive') {
      flags.archive = true;
      continue;
    }
    if (arg === '--activate') {
      flags.activate = true;
      continue;
    }
    if (arg === '--close') {
      flags.close = true;
      continue;
    }
    if (arg === '--keep') {
      flags.keep = true;
      continue;
    }
    if (arg === '--dry-run') {
      flags.dryRun = true;
      continue;
    }
    if (arg === '--plan') {
      flags.plan = true;
      continue;
    }
    if (arg === '--prompt') {
      flags.prompt = true;
      continue;
    }
    if (arg === '--run') {
      flags.loopRun = true;
      continue;
    }
    if (arg === '--finish') {
      flags.finish = true;
      continue;
    }
    if (arg === '--commit') {
      flags.commit = true;
      continue;
    }
    if (arg === '--update-openprd') {
      flags.updateOpenprd = true;
      continue;
    }
    if (arg === '--setup-missing') {
      flags.setupMissing = true;
      continue;
    }
    if (arg === '--doctor') {
      flags.doctor = true;
      continue;
    }
    if (arg === '--context') {
      flags.context = true;
      continue;
    }
    if (arg === '--record-hook') {
      flags.recordHook = true;
      continue;
    }
    if (arg === '--next') {
      flags.next = true;
      continue;
    }
    if (arg === '--mark') {
      flags.mark = args.shift() ?? null;
      continue;
    }
    if (arg === '--template-pack' || arg === '-t') {
      flags.templatePack = args.shift() ?? null;
      continue;
    }
    if (arg === '--tools') {
      flags.tools = args.shift() ?? 'all';
      continue;
    }
    if (arg === '--agent') {
      flags.agent = args.shift() ?? 'codex';
      continue;
    }
    if (arg === '--agent-command') {
      flags.agentCommand = args.shift() ?? null;
      continue;
    }
    if (arg === '--product-type' || arg === '-P') {
      flags.productType = args.shift() ?? null;
      continue;
    }
    if (arg === '--type') {
      flags.type = args.shift() ?? 'architecture';
      continue;
    }
    if (arg === '--mode') {
      flags.mode = args.shift() ?? 'auto';
      continue;
    }
    if (arg === '--input') {
      flags.input = args.shift() ?? null;
      continue;
    }
    if (arg === '--field') {
      flags.field = args.shift() ?? null;
      continue;
    }
    if (arg === '--value') {
      flags.value = args.shift() ?? null;
      continue;
    }
    if (arg === '--json-file') {
      flags.jsonFile = args.shift() ?? null;
      continue;
    }
    if (arg === '--source') {
      flags.source = args.shift() ?? null;
      continue;
    }
    if (arg === '--reference') {
      flags.reference = args.shift() ?? null;
      continue;
    }
    if (arg === '--max-iterations') {
      flags.maxIterations = args.shift() ?? null;
      continue;
    }
    if (arg === '--max-depth') {
      flags.maxDepth = args.shift() ?? null;
      continue;
    }
    if (arg === '--include') {
      flags.include = args.shift() ?? null;
      continue;
    }
    if (arg === '--exclude') {
      flags.exclude = args.shift() ?? null;
      continue;
    }
    if (arg === '--report') {
      flags.report = args.shift() ?? null;
      continue;
    }
    if (arg === '--item') {
      flags.item = args.shift() ?? null;
      continue;
    }
    if (arg === '--id') {
      flags.id = args.shift() ?? null;
      continue;
    }
    if (arg === '--status') {
      flags.status = args.shift() ?? null;
      continue;
    }
    if (arg === '--claim') {
      flags.claim = args.shift() ?? null;
      continue;
    }
    if (arg === '--notes') {
      flags.notes = args.shift() ?? null;
      continue;
    }
    if (arg === '--confidence') {
      flags.confidence = args.shift() ?? null;
      continue;
    }
    if (arg === '--change') {
      flags.change = args.shift() ?? null;
      continue;
    }
    if (arg === '--title') {
      flags.title = args.shift() ?? null;
      continue;
    }
    if (arg === '--owner') {
      flags.owner = args.shift() ?? null;
      continue;
    }
    if (arg === '--problem') {
      flags.problem = args.shift() ?? null;
      continue;
    }
    if (arg === '--why-now') {
      flags.whyNow = args.shift() ?? null;
      continue;
    }
    if (arg === '--evidence') {
      flags.evidence = args.shift() ?? null;
      continue;
    }
    if (arg === '--event') {
      flags.event = args.shift() ?? null;
      continue;
    }
    if (arg === '--risk') {
      flags.risk = args.shift() ?? null;
      continue;
    }
    if (arg === '--outcome') {
      flags.outcome = args.shift() ?? null;
      continue;
    }
    if (arg === '--preview') {
      flags.preview = args.shift() ?? null;
      continue;
    }
    if (arg === '--message') {
      flags.message = args.shift() ?? null;
      continue;
    }
    if (arg === '--learn') {
      flags.learn = args.shift() ?? null;
      continue;
    }
    if (arg === '--from') {
      flags.from = args.shift() ?? null;
      continue;
    }
    if (arg === '--to') {
      flags.to = args.shift() ?? null;
      continue;
    }
    if (arg === '--target') {
      flags.target = args.shift() ?? 'openprd';
      continue;
    }
    if (arg === '--path' || arg === '-p') {
      flags.path = args.shift() ?? null;
      continue;
    }
    if (arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    positionals.push(arg);
  }

  return { flags, positionals };
}

function usage() {
  return [
    'OpenPrd CLI',
    '',
    'Usage:',
    '  openprd init [path] [--template-pack <base|consumer|b2b|agent>] [--tools <all|codex,claude,cursor>] [--force]',
    '  openprd setup [path] [--tools <all|codex,claude,cursor>] [--force] [--json]',
    '  openprd update [path] [--tools <all|codex,claude,cursor>] [--force] [--json]',
    '  openprd doctor [path] [--tools <all|codex,claude,cursor>] [--json]',
    '  openprd fleet <root> [--dry-run|--doctor|--update-openprd|--setup-missing] [--max-depth <n>] [--include <csv>] [--exclude <csv>] [--report <file>] [--json]',
    '  openprd run [path] [--context|--verify|--record-hook --event <name> --risk <level> --outcome <text> --preview <text>] [--json]',
    '  openprd loop [path] [--init|--plan|--next|--prompt|--run|--verify|--finish] [--change <id>] [--item <task-id>] [--agent <codex|claude>] [--agent-command <cmd>] [--commit] [--dry-run] [--message <text>] [--json]',
    '  openprd classify [path] <consumer|b2b|agent>',
    '  openprd clarify [path] [--json]',
    '  openprd capture [path] (--field <section.path> --value <text|json> | --json-file <answers.json>) [--source <user-confirmed|project-derived|agent-inferred>] [--append] [--json]',
    '  openprd interview [path] [--product-type <consumer|b2b|agent>]',
    '  openprd synthesize [path] [--title <text>] [--owner <text>] [--problem <text>] [--why-now <text>]',
    '  openprd diagram [path] [--type <architecture|product-flow>] [--input <contract.json>] [--mark <pending-confirmation|confirmed|needs-revision>] [--open] [--json]',
    '  openprd diff [path] [--from <version>] [--to <version>]',
    '  openprd history [path]',
    '  openprd validate [path] [--json]',
    '  openprd status [path] [--json]',
    '  openprd freeze [path] [--json]',
    '  openprd handoff [path] [--target openprd] [--json]',
    '  openprd standards [path] [--init] [--check|--verify] [--force] [--json]',
    '  openprd change [path] (--generate|--validate|--apply|--archive|--activate|--close) [--change <id>] [--force] [--keep] [--json]',
    '  openprd changes [path] [--json]',
    '  openprd specs [path] [--json]',
    '  openprd tasks [path] [--next] [--advance] [--verify] [--item <task-id>] [--change <id>] [--evidence <path>] [--notes <text>] [--json]',
    '  openprd discovery [path] [--mode <auto|brownfield|reference|requirement>] [--reference <path>] [--max-iterations <n>] [--resume] [--advance] [--verify] [--item <id>] [--status <covered|blocked|pending>] [--claim <text>] [--evidence <path>] [--notes <text>] [--confidence <0..1>] [--json]',
    '',
  ].join('\n');
}

function printValidation(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (report.valid) {
    console.log('OpenPrd validation passed');
    if (report.warnings.length > 0) {
      console.log('Warnings:');
      for (const warning of report.warnings) {
        console.log(`- ${warning}`);
      }
    }
    return;
  }

  console.log('OpenPrd validation failed');
  for (const error of report.errors) {
    console.log(`- ${error}`);
  }
  if (report.warnings.length > 0) {
    console.log('Warnings:');
    for (const warning of report.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

function printStatus(ws, report, guidance, json) {
  const versionIndex = Array.isArray(ws.data.versionIndex) ? ws.data.versionIndex : [];
  const summary = {
    projectRoot: ws.projectRoot,
    workspaceRoot: ws.workspaceRoot,
    schema: ws.data.schema?.name ?? null,
    templatePack: resolveActiveTemplatePack(ws),
    productTypes: ws.data.config?.supportedProductTypes ?? [],
    prdVersion: ws.data.currentState?.prdVersion ?? 0,
    latestVersionId: ws.data.currentState?.latestVersionId ?? versionIndex.at(-1)?.versionId ?? null,
    versionCount: versionIndex.length,
    valid: report.valid,
    errors: report.errors,
    warnings: report.warnings,
    activeEngagementStatus: ws.data.currentState?.status ?? 'unknown',
    scenario: guidance?.clarification?.scenario?.label ?? null,
    userParticipationMode: guidance?.clarification?.scenario?.userParticipation ?? null,
    currentGate: guidance?.gates?.currentGate ?? null,
    upcomingGate: guidance?.gates?.upcomingGate ?? null,
  };

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`工作区: ${summary.workspaceRoot}`);
  console.log(`Schema: ${summary.schema}`);
  console.log(`模板包: ${summary.templatePack}`);
  console.log(`产品类型: ${summary.productTypes.join(', ')}`);
  console.log(`PRD 版本: ${summary.prdVersion}`);
  console.log(`最新版本: ${summary.latestVersionId ?? '无'}`);
  console.log(`版本数量: ${summary.versionCount}`);
  console.log(`状态: ${summary.activeEngagementStatus}`);
  if (summary.scenario) {
    console.log(`场景: ${summary.scenario}`);
  }
  if (summary.userParticipationMode) {
    console.log(`用户参与模式: ${summary.userParticipationMode}`);
  }
  if (summary.currentGate) {
    console.log(`当前门禁: ${summary.currentGate}`);
  }
  if (summary.upcomingGate) {
    console.log(`后续门禁: ${summary.upcomingGate}`);
  }
  console.log(`验证: ${summary.valid ? '通过' : '失败'}`);
  if (summary.errors.length > 0) {
    console.log('错误:');
    for (const error of summary.errors) {
      console.log(`- ${error}`);
    }
  }
  if (summary.warnings.length > 0) {
    console.log('警告:');
    for (const warning of summary.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

function printClassifyResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`已分类产品类型: ${result.currentState.productType}`);
  console.log(`模板包: ${result.currentState.templatePack}`);
}

function printClarifyResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`需要澄清: ${result.ws.workspaceRoot}`);
  console.log(`场景: ${result.clarification.scenario.label}`);
  console.log(`用户参与: ${result.clarification.scenario.userParticipation}`);
  console.log(`缺少必填字段: ${result.clarification.missingRequiredFields}`);
  console.log('需要询问用户:');
  for (const item of result.clarification.mustAskUser) {
    console.log(`- ${item.prompt}`);
  }
  if (result.clarification.canInferLater.length > 0) {
    console.log('之后可以推断或细化:');
    for (const item of result.clarification.canInferLater.slice(0, 5)) {
      console.log(`- ${item.prompt}`);
    }
  }
}

function printCaptureResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.applied?.length > 1) {
    console.log(`已捕获 ${result.applied.length} 个字段`);
    for (const item of result.applied) {
      console.log(`- ${item.field} (${item.source}): ${JSON.stringify(item.value)}`);
    }
  } else {
    console.log(`已捕获 ${result.field}`);
    console.log(`状态 key: ${result.stateKey}`);
    console.log(`来源: ${result.source}`);
    console.log(`值: ${JSON.stringify(result.value)}`);
  }
  console.log(`剩余缺失必填字段: ${result.analysis.missingRequiredFields}`);
}

function printInterviewResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`访谈模式: ${result.productType ?? '未分类'}`);
  console.log(`来源文件: ${result.sourceFiles.join(', ')}`);
  console.log(result.transcript);
}


function printSynthesizeResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`已合成 PRD 版本 ${result.snapshot.versionId}`);
  console.log(`标题: ${result.snapshot.title}`);
  console.log(`产品类型: ${result.snapshot.productType ?? '未分类'}`);
  console.log(`Digest: ${result.snapshot.digest}`);
}

function printHistoryResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`版本历史: ${result.ws.workspaceRoot}`);
  for (const entry of result.versions) {
    console.log(`- ${entry.versionId} | ${entry.title} | ${entry.productType ?? '未分类'} | ${entry.createdAt}`);
  }
}

function printDiffResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result.diff, null, 2));
    return;
  }

  console.log(`Diff ${result.diff.fromVersionId} -> ${result.diff.toVersionId}`);
  console.log(`变更章节: ${result.diff.changedSections.length > 0 ? result.diff.changedSections.join(', ') : '无'}`);
  for (const change of result.diff.changes) {
    console.log(`- ${change.path}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`);
  }
}


function printNextResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { recommendation, analysis, workflow, taskGraph } = result;
  console.log(`下一步动作: ${recommendation.nextAction}`);
  if (recommendation.currentGate) {
    console.log(`当前门禁: ${recommendation.currentGate}`);
  }
  if (recommendation.upcomingGate) {
    console.log(`后续门禁: ${recommendation.upcomingGate}`);
  }
  console.log(`原因: ${recommendation.reason}`);
  console.log(`建议命令: ${recommendation.suggestedCommand}`);
  console.log(`完成度: ${analysis.completedRequiredFields}/${analysis.totalRequiredFields}`);
  if (taskGraph?.nextReadyNode) {
    console.log(`下一个就绪节点: ${taskGraph.nextReadyNode}`);
  }
  if (result.diagramState?.needed) {
    console.log(`图表门禁: ${result.diagramState.shouldGateFreeze ? '激活' : '已满足'}`);
    console.log(`建议图表: ${result.diagramState.preferredType}`);
  }
  console.log('工作流:');
  console.log(`  ${workflow.join(' -> ')}`);
  if (recommendation.suggestedQuestions.length > 0) {
    console.log('建议问题:');
    for (const question of recommendation.suggestedQuestions) {
      console.log(`- ${question}`);
    }
  }
}

function printInitResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`已初始化 OpenPrd 工作区: ${result.ws.workspaceRoot}`);
  console.log(`模板包: ${result.currentState.templatePack}`);
  console.log(`已复制种子文件: ${result.created}`);
  if (result.standards) {
    console.log(`标准化文档: ${result.standards.docsRoot}`);
  }
  if (result.agentIntegration) {
    console.log(`Agent 引导: ${result.agentIntegration.ok ? '已启用' : '需修复'} (${result.agentIntegration.tools.join(', ')})`);
  }
}

function printAgentIntegrationResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`OpenPrd agent ${result.action}: ${result.ok ? '通过' : '需修复'}`);
  console.log(`项目: ${result.projectRoot}`);
  console.log(`工具: ${result.tools.join(', ')}`);
  if (result.initialized) {
    console.log(`已初始化工作区: ${result.init.workspaceRoot}`);
  }
  if (result.standards) {
    console.log(`标准化文档: ${result.standards.docsRoot}`);
  }
  if (result.migration) {
    const changed = result.migration.changes.filter((change) => change.status !== 'unchanged').length;
    console.log(`工作区迁移: ${changed} 项`);
  }
  console.log('变更:');
  for (const change of result.changes) {
    console.log(`- ${change.status}: ${change.path}`);
  }
  if (result.doctor?.errors?.length > 0) {
    console.log('待处理:');
    for (const error of result.doctor.errors) {
      console.log(`- ${error}`);
    }
  }
}

function printDoctorResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`OpenPrd doctor: ${result.ok ? '通过' : '失败'}`);
  console.log(`项目: ${result.projectRoot}`);
  console.log(`工具: ${result.tools.join(', ')}`);
  console.log(`标准化: ${result.standards.ok ? '通过' : '失败'}`);
  console.log(`工作区验证: ${result.validation.valid ? '通过' : '失败'}`);
  if (result.agentIntegration.drift) {
    console.log(`生成物漂移: ${result.agentIntegration.drift.ok ? '无' : '存在'}`);
  }
  console.log('Agent 集成检查:');
  for (const check of result.agentIntegration.checks) {
    console.log(`- ${check.ok ? 'ok' : 'missing'}: ${check.path}`);
  }
  if (result.errors.length > 0) {
    console.log('错误:');
    for (const error of result.errors) {
      console.log(`- ${error}`);
    }
  }
}

function printFleetResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const mode = result.dryRun
    ? 'dry-run'
    : Object.entries(result.requestedActions)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)
      .join(', ');
  console.log(`OpenPrd fleet: ${result.ok ? '通过' : '需处理'}`);
  console.log(`根目录: ${result.root}`);
  console.log(`模式: ${mode || 'report'}`);
  console.log(`最大深度: ${result.maxDepth}`);
  console.log(`项目: ${result.summary.total}`);
  console.log(`- OpenPrd: ${result.summary.openprd}`);
  console.log(`- Agent-only: ${result.summary.agentConfigured}`);
  console.log(`- Plain: ${result.summary.plain}`);
  console.log(`结果: planned ${result.summary.planned}, updated ${result.summary.updated}, setup ${result.summary.setup}, doctored ${result.summary.doctored}, failed ${result.summary.failed}, skipped ${result.summary.skipped}`);

  const visibleProjects = result.projects
    .filter((project) => project.category !== 'plain-project' || project.status === 'failed')
    .slice(0, 50);
  if (visibleProjects.length > 0) {
    console.log('项目明细:');
    for (const project of visibleProjects) {
      console.log(`- ${project.status}: ${project.relativePath} (${project.category}) -> ${project.plannedAction}`);
      for (const error of project.errors.slice(0, 3)) {
        console.log(`  error: ${error}`);
      }
    }
  }
  const hiddenCount = result.projects.length - visibleProjects.length;
  if (hiddenCount > 0) {
    console.log(`还有 ${hiddenCount} 个 plain/skipped 项目未展开；使用 --json 查看完整明细。`);
  }
  if (result.reportPath) {
    console.log(`报告: ${result.reportPath}`);
  }
}

function printRunResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'run-record-hook') {
    console.log(`OpenPrd run hook recorded: ${result.event.eventName} -> ${result.event.outcome}`);
    console.log(`Iterations: ${result.files.iterations}`);
    return;
  }

  if (result.action === 'run-verify') {
    console.log(`OpenPrd run verify: ${result.ok ? '通过' : '失败'}`);
    for (const check of result.checks) {
      console.log(`- ${check.ok ? 'ok' : 'failed'}: ${check.name}`);
    }
    if (result.errors.length > 0) {
      console.log('错误:');
      for (const error of result.errors) {
        console.log(`- ${error}`);
      }
    }
    return;
  }

  console.log('OpenPrd run context');
  console.log(`项目: ${result.projectRoot}`);
  console.log(`验证: ${result.validation.valid ? '通过' : '失败'}`);
  if (result.activeChange) {
    console.log(`激活变更: ${result.activeChange}`);
  }
  if (result.taskSummary) {
    console.log(`任务: ${result.taskSummary.completed}/${result.taskSummary.total} 完成，${result.taskSummary.pending} 待处理，${result.taskSummary.blocked} 阻塞`);
  }
  if (result.discovery) {
    console.log(`Discovery: ${result.discovery.runId} 已覆盖 ${result.discovery.summary.covered}/${result.discovery.summary.total}，待处理 ${result.discovery.summary.pending}`);
  }
  console.log(`下一步类型: ${result.recommendation.type}`);
  console.log(`下一步: ${result.recommendation.title}`);
  console.log(`原因: ${result.recommendation.reason}`);
  console.log(`建议命令: ${result.recommendation.command}`);
  console.log(`验证命令: ${result.recommendation.verifyCommand}`);
  console.log(`状态文件: ${result.files.runState}`);
}

function printLoopResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'loop-prompt') {
    console.log(`OpenPrd loop prompt: ${result.ok ? 'ready' : 'blocked'}`);
    if (result.task) {
      console.log(`任务: ${result.task.id} ${result.task.title}`);
    }
    if (result.promptPath) {
      console.log(`Prompt: ${result.promptPath}`);
    }
    if (result.invocation?.display) {
      console.log(`执行: ${result.invocation.display}`);
    }
    if (result.errors?.length) {
      for (const error of result.errors) console.log(`- ${error}`);
    }
    return;
  }

  if (result.action === 'loop-run') {
    console.log(`OpenPrd loop run: ${result.ok ? '通过' : '失败'}${result.dryRun ? ' (dry-run)' : ''}`);
    if (result.task) console.log(`任务: ${result.task.id} ${result.task.title}`);
    if (result.promptPath) console.log(`Prompt: ${result.promptPath}`);
    if (result.invocation?.display) console.log(`执行: ${result.invocation.display}`);
    if (result.finish?.commit) {
      console.log(`Commit: ${result.finish.commit.skipped ? '跳过' : result.finish.commit.sha}`);
    }
    if (result.finish?.testReport) {
      console.log(`测试报告: ${result.finish.testReport}`);
    }
    if (result.errors?.length) {
      for (const error of result.errors) console.log(`- ${error}`);
    }
    return;
  }

  if (result.action === 'loop-finish') {
    console.log(`OpenPrd loop finish: ${result.ok ? '通过' : '失败'}`);
    if (result.task) console.log(`任务: ${result.task.id} ${result.task.title}`);
    if (result.commit) console.log(`Commit: ${result.commit.skipped ? '跳过' : result.commit.sha}`);
    if (result.testReport) console.log(`测试报告: ${result.testReport}`);
    if (result.next) console.log(`下一任务: ${result.next.id} ${result.next.title}`);
    if (result.errors?.length) {
      for (const error of result.errors) console.log(`- ${error}`);
    }
    return;
  }

  console.log(`OpenPrd loop: ${result.action} ${result.ok ? '通过' : '失败'}`);
  if (result.changeId) console.log(`Change: ${result.changeId}`);
  if (result.summary) {
    console.log(`任务: ${result.summary.done}/${result.summary.total} 完成，${result.summary.pending} 待处理，${result.summary.failed} 失败，${result.summary.blocked} 阻塞`);
  }
  if (result.next) {
    console.log(`下一任务: ${result.next.id} ${result.next.title}`);
  }
  if (result.files) {
    console.log(`任务清单: ${result.files.featureList}`);
  }
  if (result.errors?.length) {
    for (const error of result.errors) console.log(`- ${error}`);
  }
}

function printStandardsResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'init') {
    console.log(`已初始化 OpenPrd standards: ${result.docsRoot}`);
    for (const item of result.changed) {
      console.log(`- ${item.status}: ${item.path}`);
    }
    return;
  }

  console.log(`OpenPrd standards: ${result.ok ? '通过' : '失败'}`);
  console.log(`Docs root: ${result.docsRoot}`);
  for (const check of result.checks) {
    console.log(`- ${check}`);
  }
  if (result.errors.length > 0) {
    console.log('错误:');
    for (const error of result.errors) {
      console.log(`- ${error}`);
    }
  }
  if (result.warnings.length > 0) {
    console.log('警告:');
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

function printFreezeResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`已 freeze OpenPrd 工作区: ${result.ws.workspaceRoot}`);
  console.log(`版本: ${result.snapshot.latestVersionId}`);
  console.log(`Digest: ${result.snapshot.digest}`);
  console.log(`状态文件: ${result.ws.paths.freezeState}`);
}

function printDiagramResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.snapshot) {
    console.log(`已为 ${result.snapshot.title} 生成${result.type === 'product-flow' ? '产品流程' : '架构'}图`);
  } else {
    console.log(`已更新${result.type === 'product-flow' ? '产品流程' : '架构'}图`);
  }
  console.log(`HTML: ${result.htmlPath}`);
  console.log(`JSON: ${result.jsonPath}`);
  console.log(`Mermaid: ${result.mermaidPath}`);
  if (result.inputPath) {
    console.log(`输入 contract: ${result.inputPath}`);
  }
  if (result.marked) {
    console.log(`评审状态: ${result.marked}`);
  } else if (result.model?.metadata?.reviewStatus) {
    console.log(`评审状态: ${result.model.metadata.reviewStatus}`);
  }
  console.log(`已打开: ${result.opened ? '是' : '否'}`);
}

function printHandoffResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`交接包已写入: ${result.exportDir}`);
  console.log(`目标: ${result.handoff.target}`);
  console.log(`版本: ${result.handoff.versionId}`);
  console.log(`Digest: ${result.handoff.digest}`);
}

function printOpenSpecDiscoveryResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`OpenPrd discovery 运行: ${result.runId}`);
  if (result.advanced) {
    console.log(`已推进条目: ${result.advancedItem.id}`);
    console.log(`条目状态: ${result.advancedItem.status}`);
    if (result.claim) {
      console.log(`Claim: ${result.claim.id}`);
    }
  }
  if (result.verified) {
    console.log(`验证: ${result.verification.valid ? '通过' : '失败'}`);
    console.log(`完成: ${result.verification.complete ? '是' : '否'}`);
    for (const check of result.verification.checks) {
      console.log(`- ${check}`);
    }
    if (result.verification.errors.length > 0) {
      console.log('错误:');
      for (const error of result.verification.errors) {
        console.log(`- ${error}`);
      }
    }
    if (result.verification.warnings.length > 0) {
      console.log('警告:');
      for (const warning of result.verification.warnings) {
        console.log(`- ${warning}`);
      }
    }
  }
  console.log(`是否恢复: ${result.resumed ? '是' : '否'}`);
  console.log(`运行目录: ${result.runDir}`);
  console.log(`模式: ${result.control.mode}`);
  console.log(`状态: ${result.control.status}`);
  console.log(`已索引来源文件: ${result.inventory.summary.files}`);
  console.log(`覆盖待处理: ${result.coverageMatrix.summary.pending}/${result.coverageMatrix.summary.total}`);
  console.log(`下一步动作: ${result.control.nextAction}`);
}

function printOpenSpecChangeValidationResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`OpenPrd change 验证: ${result.valid ? '通过' : '失败'}`);
  console.log(`Change: ${result.changeId}`);
  for (const check of result.checks) {
    console.log(`- ${check}`);
  }
  if (result.errors.length > 0) {
    console.log('错误:');
    for (const error of result.errors) {
      console.log(`- ${error}`);
    }
  }
  if (result.warnings.length > 0) {
    console.log('警告:');
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

function printOpenSpecGenerateResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`已生成 OpenPrd change: ${result.changeId}`);
  console.log(`Capability: ${result.capability}`);
  console.log(`任务数: ${result.taskCount}`);
  console.log(`验证: ${result.validation.valid ? '通过' : '失败'}`);
  console.log('文件:');
  for (const file of result.files) {
    console.log(`- ${file}`);
  }
  if (result.validation.errors.length > 0) {
    console.log('错误:');
    for (const error of result.validation.errors) {
      console.log(`- ${error}`);
    }
  }
}

function printOpenSpecTaskResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`OpenPrd 任务: ${result.changeId}`);
  if (result.action === 'list') {
    console.log(`进度: ${result.summary.completed}/${result.summary.total} 已完成，${result.summary.pending} 待处理，${result.summary.blocked} 阻塞`);
    if (result.nextTask) {
      console.log(`下一任务: ${result.nextTask.id} ${result.nextTask.title}`);
      console.log(`验证命令: ${result.nextTask.metadata.verify}`);
    } else {
      console.log('下一任务: 无');
    }
    if (result.blockedTasks.length > 0) {
      console.log('阻塞任务:');
      for (const task of result.blockedTasks.slice(0, 10)) {
        console.log(`- ${task.id}: ${[...task.missing, ...task.incomplete].join(', ')}`);
      }
    }
    return;
  }

  console.log(`任务: ${result.task.id} ${result.task.title}`);
  if (result.verification) {
    console.log(`验证: ${result.verification.ok ? '通过' : '失败'} (${result.verification.command})`);
    if (!result.verification.ok && result.verification.stderr) {
      console.log(result.verification.stderr.trim());
    }
  }
  if (result.action === 'advance') {
    console.log(`已推进: ${result.advanced ? '是' : '否'}`);
    if (result.summary) {
      console.log(`进度: ${result.summary.completed}/${result.summary.total} 已完成`);
    }
    if (result.nextTask) {
      console.log(`下一任务: ${result.nextTask.id} ${result.nextTask.title}`);
    }
  }
}

function printOpenPrdChangesResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`OpenPrd changes: ${result.changes.length}`);
  console.log(`当前激活 change: ${result.activeChange ?? '无'}`);
  for (const change of result.changes) {
    const marker = change.active ? '*' : '-';
    console.log(`${marker} ${change.id} | ${change.status} | ${change.source} | 任务 ${change.taskTotal - change.taskIncomplete}/${change.taskTotal}`);
  }
}

function printOpenPrdChangeActionResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`OpenPrd change ${result.action}: ${result.changeId}`);
  if (result.action === 'apply') {
    console.log(`已应用: ${result.ok ? '是' : '否'}`);
    if (result.appliedSpecs?.length > 0) {
      console.log('已接受 specs:');
      for (const spec of result.appliedSpecs) {
        console.log(`- ${spec.capability}: ${spec.specPath}`);
      }
    }
    if (result.errors?.length > 0) {
      console.log('错误:');
      for (const error of result.errors) {
        console.log(`- ${error}`);
      }
    }
  }
  if (result.action === 'archive') {
    console.log(`归档目录: ${result.archiveDir}`);
    console.log(`已移除来源: ${result.removedSource ? '是' : '否'}`);
  }
  if (result.action === 'activate') {
    console.log(`当前激活 change: ${result.changeId}`);
  }
}

function printAcceptedSpecsResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`已接受 specs: ${result.specs.length}`);
  for (const spec of result.specs) {
    const source = spec.metadata?.sourceChange ? ` 来自 ${spec.metadata.sourceChange}` : '';
    console.log(`- ${spec.capability}${source}: ${spec.specPath}`);
  }
  console.log(`已应用 changes: ${result.appliedChanges.length}`);
}

export async function main(argv = process.argv.slice(2)) {
  const [command = 'help', ...rest] = argv;

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(usage());
    return 0;
  }

  const { flags, positionals } = parseCommandArgs(rest);
  if (positionals.includes('--help') || positionals.includes('-h')) {
    console.log(usage());
    return 0;
  }
  const projectPath = path.resolve(flags.path ?? positionals[0] ?? process.cwd());

  try {
    if (command === 'init') {
      const result = await initWorkspace(projectPath, {
        force: flags.force,
        templatePack: flags.templatePack,
        tools: flags.tools,
        enableUserCodexConfig: true,
      });
      printInitResult(result, flags.json);
      return 0;
    }

    if (command === 'setup') {
      const result = await setupAgentIntegrationWorkspace(projectPath, {
        force: flags.force,
        templatePack: flags.templatePack,
        tools: flags.tools,
        enableUserCodexConfig: true,
      });
      printAgentIntegrationResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'update') {
      const result = await updateAgentIntegrationWorkspace(projectPath, {
        force: flags.force,
        tools: flags.tools,
        enableUserCodexConfig: true,
      });
      printAgentIntegrationResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'doctor') {
      const result = await doctorWorkspace(projectPath, { tools: flags.tools, enableUserCodexConfig: true });
      printDoctorResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'fleet') {
      const result = await fleetWorkspace(projectPath, {
        tools: flags.tools,
        force: flags.force,
        dryRun: flags.dryRun,
        updateOpenprd: flags.updateOpenprd,
        setupMissing: flags.setupMissing,
        doctor: flags.doctor,
        maxDepth: flags.maxDepth,
        include: flags.include,
        exclude: flags.exclude,
        report: flags.report,
        enableUserCodexConfig: true,
      });
      printFleetResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'run') {
      const result = await runWorkspace(projectPath, {
        context: flags.context,
        verify: flags.verify,
        recordHook: flags.recordHook,
        event: flags.event,
        risk: flags.risk,
        outcome: flags.outcome,
        preview: flags.preview,
        learn: flags.learn,
      });
      printRunResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'loop') {
      let result;
      const options = {
        change: flags.change,
        item: flags.item,
        agent: flags.agent,
        agentCommand: flags.agentCommand,
        dryRun: flags.dryRun,
        commit: flags.commit,
        message: flags.message,
        evidence: flags.evidence,
        notes: flags.notes,
      };
      if (flags.init) {
        result = await initLoopWorkspace(projectPath, options);
      } else if (flags.plan) {
        result = await planLoopWorkspace(projectPath, options);
      } else if (flags.prompt) {
        result = await promptLoopWorkspace(projectPath, options);
      } else if (flags.loopRun) {
        result = await runLoopWorkspace(projectPath, options);
      } else if (flags.verify) {
        result = await verifyLoopWorkspace(projectPath, options);
      } else if (flags.finish) {
        result = await finishLoopWorkspace(projectPath, options);
      } else if (flags.next) {
        result = await nextLoopWorkspace(projectPath, options);
      } else {
        result = await statusLoopWorkspace(projectPath);
      }
      printLoopResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'standards') {
      const result = flags.init
        ? await initStandardsWorkspace(projectPath, { force: flags.force })
        : await checkStandardsWorkspace(projectPath);
      printStandardsResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'classify') {
      const productType = flags.productType ?? positionals[1] ?? positionals[0];
      if (!productType) {
        console.log('Usage: openprd classify [path] <consumer|b2b|agent>');
        return 1;
      }
      const result = await classifyWorkspace(projectPath, productType);
      printClassifyResult(result, flags.json);
      return 0;
    }

    if (command === 'clarify') {
      const result = await clarifyWorkspace(projectPath, {});
      printClarifyResult(result, flags.json);
      return 0;
    }

    if (command === 'capture') {
      const result = await captureWorkspace(projectPath, {
        field: flags.field,
        value: flags.value,
        jsonFile: flags.jsonFile,
        source: flags.source,
        append: flags.append,
      });
      printCaptureResult(result, flags.json);
      return 0;
    }

    if (command === 'interview') {
      const requestedType = flags.productType ?? positionals[1] ?? null;
      const result = await interviewWorkspace(projectPath, requestedType);
      printInterviewResult(result, flags.json);
      return 0;
    }

    if (command === 'synthesize') {
      const result = await synthesizeWorkspace(projectPath, {
        title: flags.title,
        owner: flags.owner,
        problemStatement: flags.problem,
        whyNow: flags.whyNow,
        evidence: flags.evidence,
        productType: flags.productType,
      });
      printSynthesizeResult(result, flags.json);
      return 0;
    }

    if (command === 'diagram') {
      const result = await diagramWorkspace(projectPath, { open: flags.open, type: flags.type, input: flags.input, mark: flags.mark });
      printDiagramResult(result, flags.json);
      return 0;
    }

    if (command === 'next') {
      const result = await nextWorkspace(projectPath);
      printNextResult(result, flags.json);
      return 0;
    }

    if (command === 'diff') {
      const result = await diffWorkspace(projectPath, { from: flags.from, to: flags.to });
      printDiffResult(result, flags.json);
      return 0;
    }

    if (command === 'history') {
      const result = await historyWorkspace(projectPath);
      printHistoryResult(result, flags.json);
      return 0;
    }

    if (command === 'validate') {
      const { report } = await validateWorkspace(projectPath);
      printValidation(report, flags.json);
      return report.valid ? 0 : 1;
    }

    if (command === 'status') {
      const { report, ws } = await validateWorkspace(projectPath);
      const guidance = await computeWorkspaceGuidance(ws, { questionLimit: 5 });
      printStatus(ws, report, guidance, flags.json);
      return report.valid ? 0 : 1;
    }

    if (command === 'freeze') {
      const result = await freezeWorkspace(projectPath);
      if (!result.ok) {
        printValidation(result.report, flags.json);
        return 1;
      }
      printFreezeResult(result, flags.json);
      return 0;
    }

    if (command === 'handoff') {
      const result = await handoffWorkspace(projectPath, flags.target);
      if (!result.ok) {
        printValidation(result.report, flags.json);
        return 1;
      }
      printHandoffResult(result, flags.json);
      return 0;
    }

    if (command === 'changes') {
      const result = await listOpenPrdChangesWorkspace(projectPath);
      printOpenPrdChangesResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'specs') {
      const result = await listAcceptedSpecsWorkspace(projectPath);
      printAcceptedSpecsResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'change') {
      if (flags.generate) {
        const result = await generateOpenSpecChangeWorkspace(projectPath, {
          change: flags.change ?? positionals[1] ?? null,
          force: flags.force,
        });
        printOpenSpecGenerateResult(result, flags.json);
        return result.ok ? 0 : 1;
      }
      if (flags.validate) {
        const result = await validateOpenSpecChangeWorkspace(projectPath, {
          change: flags.change ?? positionals[1] ?? null,
        });
        printOpenSpecChangeValidationResult(result, flags.json);
        return result.ok ? 0 : 1;
      }
      if (flags.apply) {
        const result = await applyOpenPrdChangeWorkspace(projectPath, {
          change: flags.change ?? positionals[1] ?? null,
          force: flags.force,
        });
        printOpenPrdChangeActionResult(result, flags.json);
        return result.ok ? 0 : 1;
      }
      if (flags.archive) {
        const result = await archiveOpenPrdChangeWorkspace(projectPath, {
          change: flags.change ?? positionals[1] ?? null,
          force: flags.force,
          keep: flags.keep,
        });
        printOpenPrdChangeActionResult(result, flags.json);
        return result.ok ? 0 : 1;
      }
      if (flags.activate) {
        const result = await activateOpenPrdChangeWorkspace(projectPath, {
          change: flags.change ?? positionals[1] ?? null,
        });
        printOpenPrdChangeActionResult(result, flags.json);
        return result.ok ? 0 : 1;
      }
      if (flags.close) {
        const result = await closeOpenPrdChangeWorkspace(projectPath, {
          change: flags.change ?? positionals[1] ?? null,
          notes: flags.notes,
        });
        printOpenPrdChangeActionResult(result, flags.json);
        return result.ok ? 0 : 1;
      }
      const result = await listOpenPrdChangesWorkspace(projectPath);
      printOpenPrdChangesResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'tasks' || command === 'openspec-tasks') {
      const taskOptions = {
        change: flags.change ?? null,
        item: flags.item ?? flags.id ?? positionals[1] ?? null,
        verify: flags.verify,
        evidence: flags.evidence,
        notes: flags.notes,
      };
      const result = flags.advance
        ? await advanceOpenSpecTaskWorkspace(projectPath, taskOptions)
        : flags.verify
          ? await verifyOpenSpecTaskWorkspace(projectPath, taskOptions)
          : await listOpenSpecTaskWorkspace(projectPath, taskOptions);
      printOpenSpecTaskResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'openspec-generate') {
      const result = await generateOpenSpecChangeWorkspace(projectPath, {
        change: flags.change ?? positionals[1] ?? null,
        force: flags.force,
      });
      printOpenSpecGenerateResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'openspec-validate') {
      const result = await validateOpenSpecChangeWorkspace(projectPath, {
        change: flags.change ?? positionals[1] ?? null,
      });
      printOpenSpecChangeValidationResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'discovery' || command === 'openspec-discovery') {
      const result = await openspecDiscoveryWorkspace(projectPath, {
        mode: flags.mode,
        reference: flags.reference,
        maxIterations: flags.maxIterations,
        resume: flags.resume,
        advance: flags.advance,
        verify: flags.verify,
        item: flags.item,
        status: flags.status,
        claim: flags.claim,
        evidence: flags.evidence,
        notes: flags.notes,
        confidence: flags.confidence,
        source: flags.source,
      });
      printOpenSpecDiscoveryResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    console.log(usage());
    return 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export {
  validateWorkspace,
  initWorkspace,
  setupAgentIntegrationWorkspace,
  updateAgentIntegrationWorkspace,
  doctorWorkspace,
  fleetWorkspace,
  runWorkspace,
  initLoopWorkspace,
  planLoopWorkspace,
  statusLoopWorkspace,
  nextLoopWorkspace,
  promptLoopWorkspace,
  runLoopWorkspace,
  verifyLoopWorkspace,
  finishLoopWorkspace,
  clarifyWorkspace,
  captureWorkspace,
  synthesizeWorkspace,
  nextWorkspace,
  diffWorkspace,
  historyWorkspace,
  freezeWorkspace,
  handoffWorkspace,
  generateOpenSpecChangeWorkspace,
  validateOpenSpecChangeWorkspace,
  openspecDiscoveryWorkspace,
  listOpenSpecTaskWorkspace,
  advanceOpenSpecTaskWorkspace,
  verifyOpenSpecTaskWorkspace,
  listOpenPrdChangesWorkspace,
  activateOpenPrdChangeWorkspace,
  closeOpenPrdChangeWorkspace,
  applyOpenPrdChangeWorkspace,
  archiveOpenPrdChangeWorkspace,
  listAcceptedSpecsWorkspace,
  diagramWorkspace,
  classifyWorkspace,
  interviewWorkspace,
  loadWorkspace,
  initStandardsWorkspace,
  checkStandardsWorkspace,
};
