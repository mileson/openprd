import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildDiagramArtifact, renderDiagramMermaidFromModel } from './diagram-core.js';
import { analyzePrdSnapshot, buildPrdSnapshot, getRequiredFieldDescriptors, renderPrdMarkdown, summarizeSnapshot } from './prd-core.js';
import { appendJsonl, appendText, cjoin, exists, readJson, readText, readYaml, stringifyYaml, writeJson, writeText, writeYaml } from './fs-utils.js';
import { checkStandardsWorkspace } from './standards.js';
import { timestamp } from './time.js';

const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SEED_WORKSPACE = path.join(PACKAGE_ROOT, '.openprd');
const REQUIRED_PRODUCT_TYPES = ['consumer', 'b2b', 'agent'];
const REQUIRED_SECTIONS = ['meta', 'problem', 'users', 'goals', 'scope', 'scenarios', 'requirements', 'constraints', 'risks', 'handoff'];
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
  const nextText = stringifyYaml(next);
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


export {
  appendDecision,
  appendOpenQuestions,
  appendProgress,
  appendVerification,
  appendWorkflowEvent,
  buildClarificationPlan,
  buildClarificationState,
  buildWorkflowTaskGraph,
  CAPTURE_SOURCES,
  coerceCapturedValue,
  computeWorkspaceDigest,
  CORE_TEMPLATE_FILES,
  deriveGateLabels,
  detectWorkspaceScenario,
  ensureWorkspaceSkeleton,
  extractMarkdownSection,
  FIELD_PATH_TO_STATE_KEY,
  isSupportedProductType,
  loadLatestVersionSnapshot,
  loadWorkspace,
  migrateWorkspaceSkeleton,
  normalizeVersionId,
  readVersionIndex,
  readVersionSnapshot,
  renderFlowDoc,
  renderHandoffDoc,
  renderRolesDoc,
  resolveActiveTemplatePack,
  resolveCurrentProductType,
  validateWorkspace,
  writeVersionIndex,
  writeVersionSnapshot
};
