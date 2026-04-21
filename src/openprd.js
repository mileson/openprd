import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { analyzePrdSnapshot, buildPrdSnapshot, diffSnapshots, formatVersionId, getRequiredFieldDescriptors, renderPrdMarkdown, summarizeSnapshot } from './prd-core.js';
import { buildDiagramArtifact, renderDiagramArtifactFromModel, validateDiagramContract } from './diagram-core.js';

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

function timestamp() {
  return new Date().toISOString();
}

function formatMarkdownLines(lines) {
  return lines.filter(Boolean).map((line) => `- ${line}`).join('\n');
}

function renderLogEntry(title, lines) {
  return `\n## ${title}\n\n${formatMarkdownLines(lines)}\n`;
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

async function copyTree(sourceDir, targetDir, { overwrite = false } = {}) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  let created = 0;

  await fs.mkdir(targetDir, { recursive: true });

  for (const entry of entries) {
    const sourcePath = cjoin(sourceDir, entry.name);
    const targetPath = cjoin(targetDir, entry.name);

    if (entry.isDirectory()) {
      created += await copyTree(sourcePath, targetPath, { overwrite });
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
  const created = await copyTree(SEED_WORKSPACE, workspaceRoot, { overwrite: Boolean(options.force) });
  await fs.mkdir(cjoin(workspaceRoot, 'state'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'state', 'versions'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'sessions'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'exports'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'engagements', 'active'), { recursive: true });

  const defaults = [
    [cjoin(workspaceRoot, 'engagements', 'active', 'decision-log.md'), '# Decision Log\n\n- Seeded OpenPrd decision tracking.\n'],
    [cjoin(workspaceRoot, 'engagements', 'active', 'open-questions.md'), '# Open Questions\n\n- Seeded OpenPrd question tracking.\n'],
    [cjoin(workspaceRoot, 'engagements', 'active', 'progress.md'), '# Progress\n\n- Seeded OpenPrd progress tracking.\n'],
    [cjoin(workspaceRoot, 'engagements', 'active', 'verification.md'), '# Verification\n\n- Seeded OpenPrd verification tracking.\n'],
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
    activeProductFlowDiagramHtml: cjoin(workspaceRoot, 'engagements', 'active', 'product-flow-diagram.html'),
    activeProductFlowDiagramJson: cjoin(workspaceRoot, 'engagements', 'active', 'product-flow-diagram.json'),
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
  for (const section of ['Meta', 'Problem', 'Users / Stakeholders', 'Goals / Success', 'Scope / Non-goals', 'Scenarios / Flows', 'Requirements', 'Constraints / Dependencies / Risks', 'Handoff']) {
    if (!basePrd.includes(section)) {
      report.valid = false;
      report.errors.push(`templates/base/prd.md is missing section heading: ${section}`);
    }
  }

  const consumerPrd = await readText(ws.paths.consumerPrd);
  for (const token of ['Persona', 'Segment', 'Journey', 'Activation metric', 'Retention metric']) {
    if (!consumerPrd.includes(token)) {
      report.valid = false;
      report.errors.push(`templates/consumer/prd.md is missing field: ${token}`);
    }
  }

  const b2bPrd = await readText(ws.paths.b2bPrd);
  for (const token of ['Buyer', 'User', 'Admin', 'Operator', 'Permission matrix', 'Approval flow']) {
    if (!b2bPrd.includes(token)) {
      report.valid = false;
      report.errors.push(`templates/b2b/prd.md is missing field: ${token}`);
    }
  }

  const agentPrd = await readText(ws.paths.agentPrd);
  for (const token of ['Human-Agent contract', 'Autonomy boundary', 'Tool boundary', 'Memory / state model', 'Eval plan']) {
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
  if (!activeIntake.includes('What problem are we solving?')) {
    report.valid = false;
    report.errors.push('engagements/active/intake.md is missing the core discovery prompts');
  }

  const activePrd = await readText(ws.paths.activePrd);
  if (!activePrd.includes('Type-Specific Block')) {
    report.valid = false;
    report.errors.push('engagements/active/prd.md is missing the type-specific block');
  }

  const decisionLog = await readText(ws.paths.decisionLog);
  if (!decisionLog.includes('# Decision Log')) {
    report.valid = false;
    report.errors.push('engagements/active/decision-log.md is missing the decision log heading');
  }

  const openQuestionsLog = await readText(ws.paths.openQuestionsLog);
  if (!openQuestionsLog.includes('# Open Questions')) {
    report.valid = false;
    report.errors.push('engagements/active/open-questions.md is missing the open questions heading');
  }

  const progressLog = await readText(ws.paths.progressLog);
  if (!progressLog.includes('# Progress')) {
    report.valid = false;
    report.errors.push('engagements/active/progress.md is missing the progress heading');
  }

  const verificationLog = await readText(ws.paths.verificationLog);
  if (!verificationLog.includes('# Verification')) {
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
      label: 'Continuing workspace',
      userParticipation: 'targeted-confirmation',
      reason: 'This workspace already has synthesized or persisted history, so only delta clarification should be required.',
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
      label: 'Cold start (greenfield)',
      userParticipation: 'high-collaboration',
      reason: 'The project root is effectively empty, so the agent should co-create the initial requirement shape with the user.',
    };
  }

  return {
    id: 'cold-start-existing-project',
    label: 'Cold start (existing project)',
    userParticipation: 'context-plus-confirmation',
    reason: 'The project already contains material, but the OpenPrd workspace is new, so existing context should be reused and then confirmed with the user.',
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
      prompt: `Please confirm this inferred input: ${field.label}. Current value: ${Array.isArray(field.value) ? field.value.join(', ') : JSON.stringify(field.value)}`,
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
        label: 'Existing project scope',
        prompt: 'Given the existing project, what specifically should this OpenPrd workspace define or improve right now?',
        reason: 'kickoff',
      },
      {
        id: 'reuse-boundary',
        label: 'Reuse boundary',
        prompt: 'Which existing capabilities should be treated as fixed inputs, and which areas are still open for change?',
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
    { id: 'first-milestone', label: 'First milestone', prompt: 'What is the first milestone we want to freeze?' },
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
    return ['- TBD'].join('\n');
  }

  return list.map((item) => `- ${item}`).join('\n');
}

function renderFlowDoc(snapshot) {
  const { scenarios } = snapshot.sections;
  return `# Flows\n\n## Primary Flow\n\n${renderBulletList(scenarios.primaryFlows)}\n\n## Edge Cases\n\n${renderBulletList(scenarios.edgeCases)}\n\n## Failure Modes\n\n${renderBulletList(scenarios.failureModes)}\n`;
}

function renderRolesDoc(snapshot) {
  const { users, typeSpecific } = snapshot.sections;
  const roleFields = typeSpecific.fields ?? {};
  const extraLines = Object.entries(roleFields)
    .map(([key, value]) => `- ${key}: ${Array.isArray(value) ? value.join(', ') : value ?? 'TBD'}`)
    .join('\n') || '- TBD';

  return `# Roles\n\n## Users\n\n- Primary users:\n${renderBulletList(users.primaryUsers)}\n\n- Secondary users:\n${renderBulletList(users.secondaryUsers)}\n\n- Stakeholders:\n${renderBulletList(users.stakeholders)}\n\n## Type Specific\n\n${extraLines}\n`;
}

function renderHandoffDoc(snapshot) {
  const { handoff } = snapshot.sections;
  return `# Handoff\n\n- Version: ${snapshot.versionId}\n- Product Type: ${snapshot.productType ?? 'unclassified'}\n- Template Pack: ${snapshot.templatePack}\n- Digest: ${snapshot.digest}\n- Owner: ${handoff.owner}\n- Next Step: ${handoff.nextStep}\n- Target System: ${handoff.targetSystem}\n`;
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
      label: 'product flow',
    };
  }

  return {
    htmlPath: ws.paths.activeArchitectureDiagramHtml,
    jsonPath: ws.paths.activeArchitectureDiagramJson,
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

  const { htmlPath, jsonPath, label } = resolveDiagramPaths(ws, type);
  if (options.mark && !options.input && await exists(jsonPath)) {
    const model = await readJson(jsonPath);
    model.metadata = {
      ...(model.metadata ?? {}),
      reviewStatus: options.mark,
    };
    const html = renderDiagramArtifactFromModel(type, model);
    await writeJson(jsonPath, model);
    await writeText(htmlPath, html);
    await appendWorkflowEvent(ws, 'diagram_marked', {
      diagramType: type,
      reviewStatus: options.mark,
      htmlPath,
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

  await writeJson(jsonPath, artifact.model);
  await writeText(htmlPath, artifact.html);
  await appendWorkflowEvent(ws, 'diagram_generated', {
    versionId: snapshot.versionId,
    productType: snapshot.productType,
    diagramType: type,
    inputPath: options.input ? path.resolve(options.input) : null,
    htmlPath,
  });
  await appendProgress(ws, [
    `Generated ${label} diagram artifact for ${snapshot.title}.`,
    `HTML: ${htmlPath}`,
    ...(options.input ? [`Input contract: ${path.resolve(options.input)}`] : []),
  ]);
  await appendDecision(ws, [
    `Created ${label} diagram review artifact for ${snapshot.title}.`,
    type === 'product-flow'
      ? 'Use this artifact to confirm steps, decision points, and recovery paths before freeze.'
      : 'Use this artifact to confirm components, boundaries, and missing systems before freeze.',
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
  const createdAt = overrides.createdAt ?? new Date().toISOString();
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
    `Synthesized version ${snapshot.versionId}.`,
    `Product type: ${snapshot.productType ?? 'unclassified'}.`,
    `Template pack: ${snapshot.templatePack}.`,
    `Digest: ${snapshot.digest}.`,
  ]);
  await appendProgress(ws, [
    `Synthesized PRD snapshot ${snapshot.versionId}.`,
    `Updated active PRD, flows, roles, and handoff docs.`,
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
    `Updated ${applied.length} field(s) in current workspace state.`,
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
  let reason = 'The PRD can be synthesized into a first version.';
  let suggestedCommand = 'openprd synthesize .';
  let suggestedQuestions = analysis.suggestedQuestions;

  if (clarification.shouldAskUser) {
    nextAction = 'clarify-user';
    reason = 'The workspace is missing key user-confirmed inputs and should be clarified before further synthesis.';
    suggestedCommand = 'openprd clarify .';
    suggestedQuestions = clarification.mustAskUser.map((item) => item.prompt);
  } else if (!hasProductType) {
    nextAction = 'classify';
    reason = 'Product type has not been locked yet.';
    suggestedCommand = 'openprd classify . <consumer|b2b|agent>';
    suggestedQuestions = ['Is this a consumer, b2b, or agent product?'];
  } else if (analysis.missingRequiredFields > 0) {
    nextAction = 'interview';
    reason = `${analysis.missingRequiredFields} required fields are still missing.`;
    suggestedCommand = `openprd interview . --product-type ${currentProductType}`;
  } else if (currentStatus === 'frozen') {
    nextAction = 'handoff';
    reason = 'Latest PRD is frozen and ready to hand off.';
    suggestedCommand = 'openprd handoff . --target openspec';
    suggestedQuestions = [];
  } else if (currentStatus === 'handed_off') {
    nextAction = versionIndex.length > 1 ? 'diff' : 'history';
    reason = 'This workspace has already been handed off.';
    suggestedCommand = nextAction === 'diff' ? 'openprd diff .' : 'openprd history .';
    suggestedQuestions = [];
  } else if (diagramState.shouldGateFreeze && (currentStatus === 'synthesized' || currentState.prdVersion > 0)) {
    nextAction = 'diagram';
    reason = diagramState.reason;
    suggestedCommand = `openprd diagram . --type ${diagramState.preferredType} --open`;
    suggestedQuestions = [
      `Does this ${diagramState.preferredType} diagram reflect the intended design?`,
      'What is missing or incorrect in the current visual representation?',
    ];
  } else if (currentStatus === 'synthesized' || currentState.prdVersion > 0) {
    nextAction = 'freeze';
    reason = 'A versioned PRD exists and should be frozen before handoff.';
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
      `Missing required fields: ${analysis.missingRequiredFields}.`,
      ...analysis.suggestedQuestions,
    ]);
  }
  await appendProgress(ws, [
    `Recommended next action: ${nextAction}.`,
    `Reason: ${reason}`,
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
    classifiedAt: new Date().toISOString(),
  };
  await writeJson(ws.paths.currentState, currentState);
  await appendWorkflowEvent(ws, 'classified', { productType });
  await appendDecision(ws, [
    `Locked product type to ${productType}.`,
    `Template pack set to ${productType}.`,
  ]);
  await appendProgress(ws, [
    `Classified workspace as ${productType}.`,
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
    interviewStartedAt: new Date().toISOString(),
  };
  await writeJson(ws.paths.currentState, currentState);
  await appendWorkflowEvent(ws, 'interview_started', {
    productType: currentState.productType,
    sourceFiles: sourceFiles.map((filePath) => path.relative(ws.workspaceRoot, filePath)),
  });
  await appendProgress(ws, [
    `Loaded interview prompts for ${productType ?? 'unclassified'}.`,
    `Source files: ${sourceFiles.map((filePath) => path.relative(ws.workspaceRoot, filePath)).join(', ')}`,
  ]);
  await appendOpenQuestions(ws, [
    'What problem are we solving?',
    'Who is the primary user?',
    'What does success look like?',
    'What is explicitly out of scope?',
    'What is the first milestone we want to freeze?',
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
    createdAt: new Date().toISOString(),
  };
  await writeJson(workspace.paths.currentState, currentState);
  await writeJson(workspace.paths.taskGraph, buildWorkflowTaskGraph(currentState));
  await appendWorkflowEvent(workspace, 'initialized', {
    templatePack: currentState.templatePack,
    projectRoot,
  });
  await appendProgress(workspace, [
    `Initialized workspace at ${workspace.workspaceRoot}.`,
    `Template pack: ${currentState.templatePack}.`,
  ]);

  return { ws: workspace, created: ws.created, currentState };
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
      'Freeze validation failed.',
      ...report.errors.map((error) => `Error: ${error}`),
      ...report.warnings.map((warning) => `Warning: ${warning}`),
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
    frozenAt: new Date().toISOString(),
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
    'Freeze validation passed.',
    `Version: ${snapshot.latestVersionId}`,
    `Digest: ${digest}`,
    `PRD version: ${snapshot.prdVersion}`,
  ]);
  await appendProgress(ws, [
    `Frozen PRD version ${snapshot.latestVersionId}.`,
    `Digest: ${digest}`,
  ]);
  await appendDecision(ws, [
    `Frozen version ${snapshot.latestVersionId}.`,
    `Ready for handoff to ${resolveActiveTemplatePack(ws) === 'base' ? 'downstream execution' : 'execution systems'}.`,
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
    generatedAt: new Date().toISOString(),
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
      ...((await exists(ws.paths.activeProductFlowDiagramHtml)) ? ['engagements/active/product-flow-diagram.html'] : []),
      ...((await exists(ws.paths.activeProductFlowDiagramJson)) ? ['engagements/active/product-flow-diagram.json'] : []),
    ],
    nextStep: target === 'openspec'
      ? 'Import the PRD snapshot into an OpenSpec change and continue with specs/design/tasks.'
      : 'Consume the handoff bundle in the downstream system.',
  };

  await writeJson(cjoin(exportDir, 'handoff.json'), handoff);
  await writeText(cjoin(exportDir, 'handoff.md'), `# Handoff\n\n- Target: ${target}\n- Version: ${handoff.versionId}\n- Schema: ${handoff.schema}\n- Template pack: ${handoff.templatePack}\n- Digest: ${handoff.digest}\n- Next step: ${handoff.nextStep}\n`);
  if (await exists(ws.paths.activeArchitectureDiagramHtml)) {
    await fs.copyFile(ws.paths.activeArchitectureDiagramHtml, cjoin(exportDir, 'architecture-diagram.html'));
  }
  if (await exists(ws.paths.activeArchitectureDiagramJson)) {
    await fs.copyFile(ws.paths.activeArchitectureDiagramJson, cjoin(exportDir, 'architecture-diagram.json'));
  }
  if (await exists(ws.paths.activeProductFlowDiagramHtml)) {
    await fs.copyFile(ws.paths.activeProductFlowDiagramHtml, cjoin(exportDir, 'product-flow-diagram.html'));
  }
  if (await exists(ws.paths.activeProductFlowDiagramJson)) {
    await fs.copyFile(ws.paths.activeProductFlowDiagramJson, cjoin(exportDir, 'product-flow-diagram.json'));
  }
  await appendWorkflowEvent(ws, 'handoff', {
    target,
    versionId: handoff.versionId,
  });
  await appendProgress(ws, [
    `Generated handoff bundle for ${target}.`,
    `Version: ${handoff.versionId}`,
  ]);
  await appendDecision(ws, [
    `Handoff target set to ${target}.`,
    `Version ${handoff.versionId} exported to ${exportDir}.`,
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

function parseCommandArgs(argv) {
  const args = [...argv];
  const flags = { json: false, force: false, open: false, append: false, mark: null, type: 'architecture', input: null, field: null, value: null, jsonFile: null, source: null, templatePack: null, target: 'openspec', path: null, productType: null, title: null, owner: null, problem: null, whyNow: null, evidence: null, from: null, to: null };
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
    if (arg === '--mark') {
      flags.mark = args.shift() ?? null;
      continue;
    }
    if (arg === '--template-pack' || arg === '-t') {
      flags.templatePack = args.shift() ?? null;
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
    if (arg === '--from') {
      flags.from = args.shift() ?? null;
      continue;
    }
    if (arg === '--to') {
      flags.to = args.shift() ?? null;
      continue;
    }
    if (arg === '--target') {
      flags.target = args.shift() ?? 'openspec';
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
  return `OpenPrd CLI\n\nUsage:\n  openprd init [path] [--template-pack <base|consumer|b2b|agent>] [--force]\n  openprd classify [path] <consumer|b2b|agent>\n  openprd clarify [path] [--json]\n  openprd capture [path] (--field <section.path> --value <text|json> | --json-file <answers.json>) [--source <user-confirmed|project-derived|agent-inferred>] [--append] [--json]\n  openprd interview [path] [--product-type <consumer|b2b|agent>]\n  openprd synthesize [path] [--title <text>] [--owner <text>] [--problem <text>] [--why-now <text>]\n  openprd diagram [path] [--type <architecture|product-flow>] [--input <contract.json>] [--mark <pending-confirmation|confirmed|needs-revision>] [--open] [--json]\n  openprd diff [path] [--from <version>] [--to <version>]\n  openprd history [path]\n  openprd validate [path] [--json]\n  openprd status [path] [--json]\n  openprd freeze [path] [--json]\n  openprd handoff [path] [--target openspec] [--json]\n`;
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

  console.log(`Workspace: ${summary.workspaceRoot}`);
  console.log(`Schema: ${summary.schema}`);
  console.log(`Template pack: ${summary.templatePack}`);
  console.log(`Product types: ${summary.productTypes.join(', ')}`);
  console.log(`PRD version: ${summary.prdVersion}`);
  console.log(`Latest version: ${summary.latestVersionId ?? 'none'}`);
  console.log(`Version count: ${summary.versionCount}`);
  console.log(`State: ${summary.activeEngagementStatus}`);
  if (summary.scenario) {
    console.log(`Scenario: ${summary.scenario}`);
  }
  if (summary.userParticipationMode) {
    console.log(`User participation mode: ${summary.userParticipationMode}`);
  }
  if (summary.currentGate) {
    console.log(`Current gate: ${summary.currentGate}`);
  }
  if (summary.upcomingGate) {
    console.log(`Upcoming gate: ${summary.upcomingGate}`);
  }
  console.log(`Validation: ${summary.valid ? 'passed' : 'failed'}`);
  if (summary.errors.length > 0) {
    console.log('Errors:');
    for (const error of summary.errors) {
      console.log(`- ${error}`);
    }
  }
  if (summary.warnings.length > 0) {
    console.log('Warnings:');
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

  console.log(`Classified product type: ${result.currentState.productType}`);
  console.log(`Template pack: ${result.currentState.templatePack}`);
}

function printClarifyResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Clarification needed for ${result.ws.workspaceRoot}`);
  console.log(`Scenario: ${result.clarification.scenario.label}`);
  console.log(`User participation: ${result.clarification.scenario.userParticipation}`);
  console.log(`Missing required fields: ${result.clarification.missingRequiredFields}`);
  console.log('Ask the user:');
  for (const item of result.clarification.mustAskUser) {
    console.log(`- ${item.prompt}`);
  }
  if (result.clarification.canInferLater.length > 0) {
    console.log('Can infer or refine later:');
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
    console.log(`Captured ${result.applied.length} fields`);
    for (const item of result.applied) {
      console.log(`- ${item.field} (${item.source}): ${JSON.stringify(item.value)}`);
    }
  } else {
    console.log(`Captured ${result.field}`);
    console.log(`State key: ${result.stateKey}`);
    console.log(`Source: ${result.source}`);
    console.log(`Value: ${JSON.stringify(result.value)}`);
  }
  console.log(`Missing required fields remaining: ${result.analysis.missingRequiredFields}`);
}

function printInterviewResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Interview mode: ${result.productType ?? 'unclassified'}`);
  console.log(`Source files: ${result.sourceFiles.join(', ')}`);
  console.log(result.transcript);
}


function printSynthesizeResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Synthesized PRD version ${result.snapshot.versionId}`);
  console.log(`Title: ${result.snapshot.title}`);
  console.log(`Product type: ${result.snapshot.productType ?? 'unclassified'}`);
  console.log(`Digest: ${result.snapshot.digest}`);
}

function printHistoryResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Version history for ${result.ws.workspaceRoot}`);
  for (const entry of result.versions) {
    console.log(`- ${entry.versionId} | ${entry.title} | ${entry.productType ?? 'unclassified'} | ${entry.createdAt}`);
  }
}

function printDiffResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result.diff, null, 2));
    return;
  }

  console.log(`Diff ${result.diff.fromVersionId} -> ${result.diff.toVersionId}`);
  console.log(`Changed sections: ${result.diff.changedSections.length > 0 ? result.diff.changedSections.join(', ') : 'none'}`);
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
  console.log(`Next action: ${recommendation.nextAction}`);
  if (recommendation.currentGate) {
    console.log(`Current gate: ${recommendation.currentGate}`);
  }
  if (recommendation.upcomingGate) {
    console.log(`Upcoming gate: ${recommendation.upcomingGate}`);
  }
  console.log(`Reason: ${recommendation.reason}`);
  console.log(`Suggested command: ${recommendation.suggestedCommand}`);
  console.log(`Completion: ${analysis.completedRequiredFields}/${analysis.totalRequiredFields}`);
  if (taskGraph?.nextReadyNode) {
    console.log(`Next ready node: ${taskGraph.nextReadyNode}`);
  }
  if (result.diagramState?.needed) {
    console.log(`Diagram gate: ${result.diagramState.shouldGateFreeze ? 'active' : 'satisfied'}`);
    console.log(`Preferred diagram: ${result.diagramState.preferredType}`);
  }
  console.log('Workflow:');
  console.log(`  ${workflow.join(' -> ')}`);
  if (recommendation.suggestedQuestions.length > 0) {
    console.log('Suggested questions:');
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

  console.log(`Initialized OpenPrd workspace at ${result.ws.workspaceRoot}`);
  console.log(`Template pack: ${result.currentState.templatePack}`);
  console.log(`Seed files copied: ${result.created}`);
}

function printFreezeResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Frozen OpenPrd workspace at ${result.ws.workspaceRoot}`);
  console.log(`Version: ${result.snapshot.latestVersionId}`);
  console.log(`Digest: ${result.snapshot.digest}`);
  console.log(`State file: ${result.ws.paths.freezeState}`);
}

function printDiagramResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.snapshot) {
    console.log(`${result.type === 'product-flow' ? 'Product flow' : 'Architecture'} diagram generated for ${result.snapshot.title}`);
  } else {
    console.log(`${result.type === 'product-flow' ? 'Product flow' : 'Architecture'} diagram updated`);
  }
  console.log(`HTML: ${result.htmlPath}`);
  console.log(`JSON: ${result.jsonPath}`);
  if (result.inputPath) {
    console.log(`Input contract: ${result.inputPath}`);
  }
  if (result.marked) {
    console.log(`Review status: ${result.marked}`);
  } else if (result.model?.metadata?.reviewStatus) {
    console.log(`Review status: ${result.model.metadata.reviewStatus}`);
  }
  console.log(`Opened: ${result.opened ? 'yes' : 'no'}`);
}

function printHandoffResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Handoff bundle written to ${result.exportDir}`);
  console.log(`Target: ${result.handoff.target}`);
  console.log(`Version: ${result.handoff.versionId}`);
  console.log(`Digest: ${result.handoff.digest}`);
}

export async function main(argv = process.argv.slice(2)) {
  const [command = 'help', ...rest] = argv;

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(usage());
    return 0;
  }

  const { flags, positionals } = parseCommandArgs(rest);
  const projectPath = path.resolve(flags.path ?? positionals[0] ?? process.cwd());

  try {
    if (command === 'init') {
      const result = await initWorkspace(projectPath, { force: flags.force, templatePack: flags.templatePack });
      printInitResult(result, flags.json);
      return 0;
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
  clarifyWorkspace,
  captureWorkspace,
  synthesizeWorkspace,
  nextWorkspace,
  diffWorkspace,
  historyWorkspace,
  freezeWorkspace,
  handoffWorkspace,
  diagramWorkspace,
  classifyWorkspace,
  interviewWorkspace,
  loadWorkspace,
};
