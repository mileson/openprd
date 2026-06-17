/*
 * 核心功能
 * 汇总 OpenPrd CLI 的命令入口、workspace 函数编排和测试可复用导出。
 *
 * 输入
 * 接收 CLI 参数、项目路径、OpenPrd 工作区文件和各子模块 workspace 结果。
 *
 * 输出
 * 执行 init/setup/update/doctor/run/loop 等命令，打印结果并导出内部 workspace API。
 *
 * 定位
 * 位于 CLI 应用层，负责路由与组合，不承载单个领域的深层业务规则。
 *
 * 依赖
 * 依赖 cli/args、cli/print、agent-integration、loop、standards、quality、openspec 等模块。
 *
 * 维护规则
 * 新增命令或参数时同步更新 usage、打印契约、docs/basic/backend-structure.md 和相关测试。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzePrdSnapshot, buildPrdSnapshot, formatVersionId } from './prd-core.js';
import { formatTemplatePackDisplay } from './product-type-copy.js';
import { buildSnapshotChangeSummary } from './change-summary.js';
import { appendReleaseEntry, buildReleaseChangeSummary, buildReleaseLedgerSummary, loadReleaseLedger, saveReleaseLedger, setCurrentReleaseVersion, setReleaseLedgerEnabled, setReleaseVersionStatus } from './release-ledger.js';
import { validateOpenSpecChangeWorkspace } from './openspec/change-validate.js';
import { generateOpenSpecChangeWorkspace as writeOpenSpecChangeWorkspace } from './openspec/generate.js';
import { advanceOpenSpecTaskWorkspace, checkOpenSpecTaskEvidenceWorkspace, listOpenSpecTaskWorkspace, verifyOpenSpecTaskWorkspace } from './openspec/execute.js';
import { ensureCodexCliReady } from './codex-runtime.js';
import { activateOpenPrdChangeWorkspace, applyOpenPrdChangeWorkspace, archiveOpenPrdChangeWorkspace, closeOpenPrdChangeWorkspace, listAcceptedSpecsWorkspace, listOpenPrdChangesWorkspace } from './openspec/change-lifecycle.js';
import { checkStandardsWorkspace, classifyExternalReferenceWorkspace, initStandardsWorkspace } from './standards.js';
import { doctorOpenPrdAgentIntegration, setupOpenPrdAgentIntegration, updateOpenPrdAgentIntegration } from './agent-integration.js';
import { finishLoopWorkspace, initLoopWorkspace, nextLoopWorkspace, planLoopWorkspace, promptLoopWorkspace, runLoopWorkspace, statusLoopWorkspace, verifyLoopWorkspace } from './loop.js';
import { timestamp } from './time.js';
import { parseCommandArgs, usage } from './cli/args.js';
import { printAcceptedSpecsResult, printAgentIntegrationResult, printBenchmarkResult, printBrainstormResult, printCaptureResult, printClarifyResult, printClassifyResult, printDesignStarterResult, printDevelopmentStandardsResult, printDiagramResult, printDiffResult, printDoctorResult, printFleetResult, printFreezeResult, printGrowthResult, printHandoffResult, printHistoryResult, printInitResult, printInterviewResult, printKnowledgeResult, printLearningResult, printLoopResult, printNextResult, printOpenPrdChangeActionResult, printOpenPrdChangesResult, printOpenSpecChangeValidationResult, printOpenSpecDiscoveryResult, printOpenSpecGenerateResult, printOpenSpecTaskResult, printPlaygroundResult, printQualityResult, printReleaseResult, printReviewResult, printRunResult, printSelfUpdateResult, printStandardsResult, printStatus, printSynthesizeResult, printUpgradeResult, printValidation, printVisualCompareResult, printVisualPrepareResult } from './cli/print.js';
import { cjoin, exists, readJson, writeJson, writeText, writeYaml } from './fs-utils.js';
import { diagramWorkspace } from './diagram-workspace.js';
import { createOpenSpecDiscoveryWorkspace } from './discovery.js';
import { createFleetWorkspace } from './fleet.js';
import { selfUpdateWorkspace, upgradeWorkspace } from './self-update.js';
import { backfillWorkUnitsWorkspace } from './work-unit-migration.js';
import { generateLearningReviewWorkspace, setLearningReviewModeWorkspace } from './learning-review.js';
import { addBenchmarkWorkspace, approveBenchmarkWorkspace, benchmarkWorkspace, listBenchmarkWorkspace, observeBenchmarkSourceWorkspace, verifyBenchmarkWorkspace } from './benchmark.js';
import { initQualityWorkspace, qualityWorkspace, verifyQualityWorkspace, learnQualityWorkspace } from './quality.js';
import {
  archiveKnowledgeCandidate,
  listKnowledgeCandidates,
  recordKnowledgeReviewSignal,
  rejectKnowledgeCandidate,
  restoreKnowledgeCandidate,
  reviewKnowledgeWorkspace,
} from './knowledge.js';
import { createRunWorkspace } from './run-harness.js';
import { checkDevelopmentStandardsWorkspace } from './dev-standards.js';
import {
  applyGrowthCandidateWorkspace,
  checkGrowthWorkspace,
  initGrowthWorkspace,
  recordGrowthCheckpointWorkspace,
  rejectGrowthCandidateWorkspace,
  reviewGrowthWorkspace,
} from './growth.js';
import { brainstormWorkspace } from './brainstorm.js';
import { buildBrainstormPresentationTemplatePayload, brainstormPresentationWorkspace } from './brainstorm-presentation.js';
import { designStarterWorkspace } from './design-starter.js';
import { buildReviewPresentationTemplatePayload, reviewPresentationWorkspace } from './review-presentation.js';
import { analyzeWorkspaceRegistryHygiene } from './registry-hygiene.js';
import { syncSessionBindingFromChange } from './session-binding.js';
import { readSessionRegistry } from './session-registry.js';
import { visualCompareWorkspace } from './visual-compare.js';
import { visualPrepareWorkspace } from './visual-prepare.js';
import { captureWorkspace, clarifyWorkspace, classifyWorkspace, computeWorkspaceGuidance, diffWorkspace, historyWorkspace, interviewWorkspace, nextWorkspace, playgroundWorkspace, reviewWorkspace, synthesizeWorkspace } from './workspace-workflow.js';
import { appendDecision, appendProgress, appendVerification, appendWorkflowEvent, buildCurrentStateSnapshot, buildWorkflowTaskGraph, computeWorkspaceDigest, CORE_TEMPLATE_FILES, ensureWorkspaceSkeleton, isSupportedProductType, loadCurrentLaneSnapshot, loadLatestVersionSnapshot, loadWorkspace, migrateWorkspaceSkeleton, normalizeVersionId, persistWorkspaceCurrentState, readVersionIndex, resolveActiveTemplatePack, resolveCurrentProductType, validateWorkspace } from './workspace-core.js';
import { readWorkspaceRegistry } from './workspace-registry.js';

function buildInitTemplatePackGuidance(templatePack, options = {}) {
  const label = formatTemplatePackDisplay(templatePack, { fallback: '通用产品或工程场景' });
  if (options.explicit) {
    return {
      source: 'explicit',
      templatePack,
      message: `已按指定场景模板使用${label}起步；后续需求澄清或场景分类时，仍可按用户确认调整产品场景。`,
    };
  }
  return {
    source: 'default',
    templatePack,
    message: `未指定场景模板，已使用${label}起步；后续需求澄清或场景分类时，可再锁定为个人消费者、企业服务或 Agent 场景。`,
  };
}

async function initWorkspace(projectRoot, options) {
  const ws = await ensureWorkspaceSkeleton(projectRoot, options);
  const workspace = await loadWorkspace(projectRoot);
  const standards = await initStandardsWorkspace(projectRoot, { force: Boolean(options.force) });
  const quality = await initQualityWorkspace(projectRoot, { force: Boolean(options.force) });
  const growth = await initGrowthWorkspace(projectRoot);
  const agentIntegration = await setupOpenPrdAgentIntegration(projectRoot, {
    tools: options.tools ?? 'all',
    force: Boolean(options.force),
    action: 'init',
    enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
    codexHome: options.codexHome,
    cursorHome: options.cursorHome,
    openprdHome: options.openprdHome,
    platform: options.platform,
    hookProfile: options.hookProfile,
  });
  const config = workspace.data.config ?? {};
  if (options.templatePack) {
    config.activeTemplatePack = options.templatePack;
  }
  if (!config.activeTemplatePack) {
    config.activeTemplatePack = 'base';
  }
  config.learningReview = {
    enabled: config.learningReview?.enabled !== false,
    autoOpen: config.learningReview?.autoOpen !== false,
    defaultGenre: config.learningReview?.defaultGenre ?? 'internet-product',
    sourceScope: config.learningReview?.sourceScope ?? 'workspace',
    ...config.learningReview,
  };
  config.quality = {
    enabled: config.quality?.enabled !== false,
    command: config.quality?.command ?? 'openprd quality . --verify',
    reportFormat: config.quality?.reportFormat ?? 'html',
    ...config.quality,
  };
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
  const templatePackGuidance = buildInitTemplatePackGuidance(currentState.templatePack, {
    explicit: Boolean(options.templatePack),
  });
  await appendProgress(workspace, [
    `已初始化工作区: ${workspace.workspaceRoot}。`,
    `场景模板: ${formatTemplatePackDisplay(currentState.templatePack, { fallback: '待确认' })}。`,
    templatePackGuidance.message,
  ]);

  return { ws: workspace, created: ws.created, currentState, templatePackGuidance, standards, quality, growth, agentIntegration };
}

async function setupAgentIntegrationWorkspace(projectRoot, options = {}) {
  if (!(await exists(cjoin(projectRoot, '.openprd')))) {
    const initResult = await initWorkspace(projectRoot, options);
    return {
      ...initResult.agentIntegration,
      initialized: true,
      standards: initResult.standards,
      quality: initResult.quality,
      init: {
        workspaceRoot: initResult.ws.workspaceRoot,
        created: initResult.created,
        templatePack: initResult.currentState.templatePack,
      },
      growth: initResult.growth,
    };
  }

  const migration = await migrateWorkspaceSkeleton(projectRoot, { recordEvent: true });
  const standards = await initStandardsWorkspace(projectRoot, { force: Boolean(options.force) });
  const quality = await initQualityWorkspace(projectRoot, { force: false });
  const growth = await initGrowthWorkspace(projectRoot);
  const agentIntegration = await setupOpenPrdAgentIntegration(projectRoot, {
    tools: options.tools ?? 'all',
    force: Boolean(options.force),
    action: 'setup',
    enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
    codexHome: options.codexHome,
    cursorHome: options.cursorHome,
    openprdHome: options.openprdHome,
    platform: options.platform,
    hookProfile: options.hookProfile,
  });
  return { ...agentIntegration, initialized: false, migration, standards, quality, growth };
}

async function updateAgentIntegrationWorkspace(projectRoot, options = {}) {
  const migration = await migrateWorkspaceSkeleton(projectRoot, { recordEvent: true });
  const standards = await initStandardsWorkspace(projectRoot, { force: false });
  const quality = await initQualityWorkspace(projectRoot, { force: false });
  const growth = await initGrowthWorkspace(projectRoot);
  const agentIntegration = await updateOpenPrdAgentIntegration(projectRoot, {
    tools: options.tools ?? 'all',
    force: Boolean(options.force),
    enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
    codexHome: options.codexHome,
    cursorHome: options.cursorHome,
    openprdHome: options.openprdHome,
    platform: options.platform,
    hookProfile: options.hookProfile,
  });
  return { ...agentIntegration, migration, standards, quality, growth };
}

async function doctorWorkspace(projectRoot, options = {}) {
  const agentIntegration = await doctorOpenPrdAgentIntegration(projectRoot, {
    tools: options.tools ?? 'all',
    enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
    codexHome: options.codexHome,
    cursorHome: options.cursorHome,
    hookProfile: options.hookProfile,
  });
  const codexRuntime = (agentIntegration.tools ?? []).includes('codex') && options.checkCodexRuntime
    ? await ensureCodexCliReady({
      cwd: projectRoot,
      repair: Boolean(options.fix),
      runCommand: options.codexRunCommand,
      packageManager: options.packageManager,
    })
    : null;
  const standards = await checkStandardsWorkspace(projectRoot, {
    sourceManuals: options.sourceManuals,
    docsContent: options.docsContent,
  }).catch((error) => ({
    ok: false,
    errors: [error instanceof Error ? error.message : String(error)],
    warnings: [],
    checks: [],
    docsRoot: path.join('docs', 'basic'),
  }));
  const validation = await validateWorkspace(projectRoot, {
    sourceManuals: options.sourceManuals,
    docsContent: options.docsContent,
  })
    .then(({ report }) => report)
    .catch((error) => ({
      valid: false,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings: [],
      checks: [],
    }));
  const workspaceRegistry = await readWorkspaceRegistry({ openprdHome: options.openprdHome }).catch(() => null);
  const sessionRegistry = await readSessionRegistry({ openprdHome: options.openprdHome }).catch(() => null);
  const registryHygiene = workspaceRegistry
    ? analyzeWorkspaceRegistryHygiene(workspaceRegistry.entries)
    : { ok: true, issues: [] };
  const registryWarnings = [
    ...(registryHygiene.issues ?? []).map((issue) => `registry: ${issue.message}`),
    ...((workspaceRegistry?.staleEntries ?? []).map((entry) => `registry: stale workspace ${entry.workspaceRoot} (${entry.reason})`)),
    ...((sessionRegistry?.staleEntries ?? []).map((entry) => `session-registry: stale session ${entry.sessionId} (${entry.reason})`)),
  ];
  const doctorOk = agentIntegration.ok && (codexRuntime?.ok ?? true) && standards.ok && validation.valid;
  const latestQuality = await readJson(cjoin(projectRoot, '.openprd', 'quality', 'reports', 'latest.json')).catch(() => null);
  const doctorSignal = doctorOk
    ? {
      kind: 'doctor-green',
      ok: true,
      summary: 'doctor passed',
    }
    : null;
  if (doctorSignal) {
    await recordKnowledgeReviewSignal(projectRoot, doctorSignal).catch(() => null);
  }
  const growthCheckpoint = doctorSignal
    ? await recordGrowthCheckpointWorkspace(projectRoot, {
      outcome: 'doctor-passed',
      reason: 'doctor-post-completion',
    }).catch((error) => ({
      ok: false,
      action: 'growth-checkpoint',
      projectRoot,
      recorded: false,
      errors: [error instanceof Error ? error.message : String(error)],
    }))
    : {
      ok: true,
      action: 'growth-checkpoint',
      projectRoot,
      recorded: false,
      skipped: true,
      reason: 'doctor-not-green',
    };
  const knowledgeReview = doctorSignal
    ? await reviewKnowledgeWorkspace(projectRoot, {
      from: latestQuality?.jsonPath ?? null,
      signal: doctorSignal,
    }).catch((error) => ({
      ok: false,
      action: 'quality-knowledge-review',
      skipped: false,
      errors: [error instanceof Error ? error.message : String(error)],
    }))
    : {
      ok: true,
      action: 'quality-knowledge-review',
      skipped: true,
      reason: 'doctor-not-green',
    };

  return {
    ok: doctorOk,
    action: 'doctor',
    projectRoot,
    tools: agentIntegration.tools,
    agentIntegration,
    codexRuntime,
    standards,
    validation,
    registry: {
      workspace: workspaceRegistry,
      sessions: sessionRegistry,
      hygiene: registryHygiene,
      warnings: registryWarnings,
    },
    growthCheckpoint,
    knowledgeReview,
    errors: [
      ...agentIntegration.errors,
      ...(codexRuntime?.errors ?? []).map((error) => `codex-runtime: ${error}`),
      ...(standards.errors ?? []).map((error) => `standards: ${error}`),
      ...(validation.errors ?? []).map((error) => `validate: ${error}`),
    ],
    warnings: registryWarnings,
  };
}

async function readCliPackageInfo() {
  const raw = await fs.readFile(new URL('../package.json', import.meta.url), 'utf8');
  const packageJson = JSON.parse(raw);
  return {
    name: packageJson.name ?? '@openprd/cli',
    version: packageJson.version ?? '0.0.0',
  };
}

const {
  openspecDiscoveryWorkspace,
  resumeOpenSpecDiscoveryWorkspace,
  verifyOpenSpecDiscoveryWorkspace,
} = createOpenSpecDiscoveryWorkspace({
  appendProgress,
  appendWorkflowEvent,
  checkStandardsWorkspace,
  loadLatestVersionSnapshot,
  loadWorkspace,
  readVersionIndex,
  resolveActiveTemplatePack,
  resolveCurrentProductType,
  validateOpenSpecChangeWorkspace,
});

const runWorkspace = createRunWorkspace({
  checkStandardsWorkspace,
  listOpenPrdChangesWorkspace,
  listOpenSpecTaskWorkspace,
  nextWorkspace,
  resumeOpenSpecDiscoveryWorkspace,
  validateOpenSpecChangeWorkspace,
  validateWorkspace,
  verifyOpenSpecDiscoveryWorkspace,
  verifyQualityWorkspace,
});

const fleetWorkspace = createFleetWorkspace({ setupAgentIntegrationWorkspace, updateAgentIntegrationWorkspace, doctorWorkspace, backfillWorkUnitsWorkspace });

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
  let latest = await loadCurrentLaneSnapshot(ws, { fallbackToLatest: true });
  if (!latest) {
    const synthesized = await synthesizeWorkspace(projectRoot, {});
    ws = synthesized.ws;
    latest = { indexEntry: synthesized.indexEntry, snapshot: synthesized.snapshot };
  }

  const guidance = await computeWorkspaceGuidance(ws, { questionLimit: 5 });
  if (guidance.nextAction !== 'freeze' && (ws.data.currentState?.status ?? null) !== 'frozen') {
    const gateReport = {
      ...report,
      valid: false,
      errors: [
        ...(report.errors ?? []),
        `Freeze blocked by ${guidance.gates.currentGate}: ${guidance.reason}`,
      ],
    };
    await appendWorkflowEvent(ws, 'freeze_failed', {
      errors: gateReport.errors,
      warnings: gateReport.warnings,
      gate: guidance.gates.currentGate,
      nextAction: guidance.nextAction,
    });
    await appendVerification(ws, [
      'Freeze 门禁失败。',
      `当前门禁: ${guidance.gates.currentGate}`,
      `原因: ${guidance.reason}`,
      `建议命令: ${guidance.suggestedCommand}`,
    ]);
    return { ok: false, report: gateReport, ws, guidance };
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
  const storedCurrentState = await persistWorkspaceCurrentState(ws, currentState);
  await appendWorkflowEvent(ws, 'frozen', {
    versionId: snapshot.latestVersionId,
    digest,
  });
  await appendVerification(ws, [
    '定稿前检查通过。',
    `本次确认稿: ${snapshot.latestVersionId}`,
    `需求稿版本序号: ${snapshot.prdVersion}`,
  ]);
  await appendProgress(ws, [
    `这版需求已经定稿。`,
  ]);
  await appendDecision(ws, [
    '这版需求已经定稿。',
    `已准备好交接给 ${resolveActiveTemplatePack(ws) === 'base' ? '下游执行方' : '执行系统'}。`,
  ]);
  await writeJson(ws.paths.taskGraph, buildWorkflowTaskGraph(storedCurrentState));

  return { ok: true, ws: { ...ws, data: { ...ws.data, currentState: storedCurrentState } }, report, snapshot, latest };
}

async function handoffWorkspace(projectRoot, target) {
  const freeze = await freezeWorkspace(projectRoot);
  if (!freeze.ok) {
    return freeze;
  }

  const { ws, snapshot } = freeze;
  const sourceSnapshot = freeze.latest?.snapshot ?? snapshot;
  const exportDir = cjoin(ws.paths.exportsDir, target);
  const releaseState = await loadReleaseLedger(projectRoot);
  const releaseSummary = buildReleaseLedgerSummary(releaseState.ledger);
  const releaseChangeSummary = releaseSummary.enabled && releaseSummary.currentVersion
    ? buildReleaseChangeSummary(releaseState.ledger, { limit: 5 })
    : null;
  const changeSummary = releaseChangeSummary?.items?.length
    ? releaseChangeSummary
    : buildSnapshotChangeSummary(sourceSnapshot, { limit: 5 });
  await fs.mkdir(exportDir, { recursive: true });

  const handoff = {
    version: 1,
    versionId: snapshot.latestVersionId,
    versionNumber: snapshot.prdVersion,
    projectVersion: releaseSummary.currentVersion,
    target,
    generatedAt: timestamp(),
    workspaceRoot: ws.workspaceRoot,
    projectRoot: ws.projectRoot,
    schema: ws.data.schema?.name ?? null,
    templatePack: resolveActiveTemplatePack(ws),
    productTypes: ws.data.config?.supportedProductTypes ?? [],
    productType: resolveCurrentProductType(ws),
    digest: snapshot.digest,
    projectRelease: releaseSummary,
    changeSummarySource: releaseChangeSummary?.items?.length ? 'release-ledger' : 'snapshot',
    changeSummary,
    releaseNotes: changeSummary.items.map((item) => item.sentence),
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
  const summarySection = handoff.changeSummary.markdown
    ? `\n## 变化摘要\n\n${handoff.changeSummary.markdown}\n`
    : '';
  const handoffMarkdown = `# 交接\n\n- 交接去向: ${target}\n${handoff.projectVersion ? `- 项目版本: ${handoff.projectVersion}\n` : ''}- 使用格式: ${handoff.schema}\n- 场景模板: ${formatTemplatePackDisplay(handoff.templatePack, { fallback: '待确认' })}\n- 下一步: ${handoff.nextStep}\n${summarySection}`;
  await writeText(cjoin(exportDir, 'handoff.md'), handoffMarkdown);
  await writeText(ws.paths.activeHandoff, handoffMarkdown);
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
  const storedCurrentState = await persistWorkspaceCurrentState(ws, currentState);
  await writeJson(ws.paths.taskGraph, buildWorkflowTaskGraph(storedCurrentState));

  return { ok: true, ws: { ...ws, data: { ...ws.data, currentState: storedCurrentState } }, report: freeze.report, snapshot, handoff, exportDir };
}

async function releaseWorkspace(projectRoot, options = {}) {
  const workspaceRoot = cjoin(projectRoot, '.openprd');
  if (!(await exists(workspaceRoot))) {
    return {
      ok: false,
      action: 'release',
      projectRoot,
      errors: [`Missing workspace: ${workspaceRoot}. Please run openprd init first.`],
    };
  }

  const loaded = await loadReleaseLedger(projectRoot);
  let ledger = loaded.ledger;
  const actions = [];
  const warnings = [];
  let changed = false;

  try {
    if (options.disable) {
      ({ ledger } = setReleaseLedgerEnabled(ledger, false));
      actions.push('disable');
      changed = true;
    }

    if (options.enable) {
      ({ ledger } = setReleaseLedgerEnabled(ledger, true));
      actions.push('enable');
      changed = true;
    }

    if (options.setVersion) {
      const updated = setCurrentReleaseVersion(ledger, options.setVersion, {
        status: options.status === 'released' ? 'current' : (options.status ?? 'current'),
      });
      ledger = updated.ledger;
      actions.push('set-version');
      changed = true;
      if (updated.previousVersion) {
        warnings.push(`当前项目版本已从 ${updated.previousVersion} 切换到 ${updated.entry.version}；旧版本默认改为 released。`);
      }
      if (updated.semver.warning) {
        warnings.push(updated.semver.warning);
      }
    }

    if (options.status && !options.setVersion) {
      const updated = setReleaseVersionStatus(ledger, options.status, { version: options.version });
      ledger = updated.ledger;
      actions.push('set-status');
      changed = true;
    }

    if (options.notes) {
      const updated = appendReleaseEntry(ledger, options.notes, {
        version: options.version,
        fallbackType: '调整',
        source: {
          kind: 'manual-note',
          manualId: `manual-note-${Date.now()}`,
        },
      });
      ledger = updated.ledger;
      actions.push('append-note');
      changed = true;
    }
  } catch (error) {
    return {
      ok: false,
      action: 'release',
      projectRoot,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  if (changed) {
    await saveReleaseLedger(projectRoot, ledger);
  }

  const summary = buildReleaseLedgerSummary(ledger, { version: options.version });
  const changeSummary = buildReleaseChangeSummary(ledger, {
    version: options.version ?? summary.currentVersion,
    limit: 5,
  });

  return {
    ok: true,
    action: 'release',
    projectRoot,
    releaseLedgerPath: loaded.filePath,
    changed,
    actions,
    warnings,
    summary,
    changeSummary,
  };
}

function reviewConfirmationCommand(snapshot) {
  if (!snapshot?.versionId || !snapshot?.digest) {
    return 'openprd review . --open，然后 openprd review . --mark confirmed';
  }
  let command = `openprd review . --open，然后 openprd review . --mark confirmed --version ${snapshot.versionId} --digest ${snapshot.digest}`;
  if (snapshot.workUnitId) {
    command = `${command} --work-unit ${snapshot.workUnitId}`;
  }
  return command;
}

function assertPrdReviewConfirmedForChange(currentState, snapshot) {
  if (['frozen', 'handed_off'].includes(snapshot?.status)) {
    return;
  }
  const review = currentState?.reviewStatus ?? null;
  const confirmed = review?.versionId === snapshot?.versionId && review?.status === 'confirmed';
  if (confirmed) {
    return;
  }
  throw new Error([
    '生成 OpenPrd change 前需要先确认最新 PRD review.html。',
    `当前版本: ${snapshot?.versionId ?? '未知'}。`,
    `当前评审状态: ${review?.status ?? 'missing'}。`,
    `建议: ${reviewConfirmationCommand(snapshot)}。`,
  ].join('\n'));
}

async function generateOpenSpecChangeWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  const versionIndex = await readVersionIndex(ws);
  const latest = await loadCurrentLaneSnapshot(ws, { fallbackToLatest: true });
  const currentState = ws.data.currentState ?? {};
  const snapshot = latest?.snapshot ?? buildCurrentStateSnapshot(ws, currentState, versionIndex);
  assertPrdReviewConfirmedForChange(currentState, snapshot);
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
  await syncSessionBindingFromChange(projectRoot, result.changeId, {
    sessionId: ws.data.currentSessionId ?? null,
    title: snapshot.title ?? null,
    versionId: snapshot.versionId ?? null,
    digest: snapshot.digest ?? null,
    workUnitId: snapshot.workUnitId ?? null,
    targetRoot: snapshot.targetRoot ?? null,
    reviewStatus: currentState.reviewStatus?.status ?? null,
    reviewPath: currentState.reviewStatus?.reviewPath ?? currentState.reviewStatus?.stableArtifact ?? null,
    activeReviewPath: currentState.reviewStatus?.entryPath ?? currentState.reviewStatus?.artifact ?? null,
  });

  return {
    ...result,
    ws,
    snapshot,
    analysis,
    validation,
    ok: result.ok && validation.ok,
  };
}

async function isDirectoryPath(candidate) {
  const stat = await fs.stat(path.resolve(candidate)).catch(() => null);
  return Boolean(stat?.isDirectory());
}

export async function main(argv = process.argv.slice(2)) {
  const [command = 'help', ...rest] = argv;

  if (command === 'version' || command === '--version' || command === '-v') {
    const packageInfo = await readCliPackageInfo();
    console.log(packageInfo.version);
    return 0;
  }

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
        hookProfile: flags.hookProfile,
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
        hookProfile: flags.hookProfile,
        enableUserCodexConfig: true,
      });
      printAgentIntegrationResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'update') {
      const result = await updateAgentIntegrationWorkspace(projectPath, {
        force: flags.force,
        tools: flags.tools,
        hookProfile: flags.hookProfile,
        enableUserCodexConfig: true,
      });
      printAgentIntegrationResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'self-update') {
      const result = await selfUpdateWorkspace({
        check: flags.check,
        dryRun: flags.dryRun,
        json: flags.json,
        openprdHome: flags.openprdHome,
      });
      printSelfUpdateResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'upgrade') {
      const result = await upgradeWorkspace(projectPath, {
        dryRun: flags.dryRun,
        json: flags.json,
        fleet: flags.fleet,
        tools: flags.tools,
        hookProfile: flags.hookProfile,
        force: flags.force,
        maxDepth: flags.maxDepth,
        include: flags.include,
        exclude: flags.exclude,
        report: flags.report,
      });
      printUpgradeResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'doctor') {
      const result = await doctorWorkspace(projectPath, { tools: flags.tools, hookProfile: flags.hookProfile, fix: flags.fix, checkCodexRuntime: true, enableUserCodexConfig: true });
      printDoctorResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'fleet') {
      const result = await fleetWorkspace(projectPath, {
        tools: flags.tools,
        hookProfile: flags.hookProfile,
        force: flags.force,
        dryRun: flags.dryRun,
        updateOpenprd: flags.updateOpenprd,
        backfillWorkUnits: flags.backfillWorkUnits,
        syncRegistry: flags.syncRegistry,
        setupMissing: flags.setupMissing,
        doctor: flags.doctor,
        maxDepth: flags.maxDepth,
        include: flags.include,
        exclude: flags.exclude,
        report: flags.report,
        enableUserCodexConfig: true,
        openprdHome: flags.openprdHome,
      });
      printFleetResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'run') {
      const result = await runWorkspace(projectPath, {
        context: flags.context,
        verify: flags.verify,
        recordHook: flags.recordHook,
        hookInject: flags.hookInject,
        event: flags.event,
        risk: flags.risk,
        outcome: flags.outcome,
        preview: flags.preview,
        learn: flags.learn,
        message: flags.message,
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
        repairAgent: flags.repairAgent,
        worktree: flags.worktree,
        branch: flags.branch,
        allowDirtyMain: flags.allowDirtyMain,
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
        : flags.classifyExternal !== null
          ? await classifyExternalReferenceWorkspace(projectPath, { externalReference: flags.classifyExternal })
          : await checkStandardsWorkspace(projectPath);
      printStandardsResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'quality') {
      const result = await qualityWorkspace(projectPath, {
        init: flags.init,
        verify: flags.verify,
        report: flags.report,
        html: flags.html,
        learn: Boolean(flags.learn),
        review: flags.review,
        from: flags.from,
        force: flags.force,
      });
      printQualityResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'knowledge') {
      const subcommand = positionals[0] ?? 'candidates';
      const firstArgIsProjectPath = !flags.path && positionals.length > 1 && await isDirectoryPath(positionals[1]);
      const knowledgeProjectPath = path.resolve(flags.path ?? (firstArgIsProjectPath ? positionals[1] : process.cwd()));
      let result;
      if (subcommand === 'candidates' || subcommand === 'list') {
        result = await listKnowledgeCandidates(knowledgeProjectPath, {
          status: flags.status ?? 'pending-review',
        });
      } else if (subcommand === 'reject') {
        result = await rejectKnowledgeCandidate(knowledgeProjectPath, {
          id: flags.id ?? positionals[1] ?? null,
          reason: flags.reason ?? flags.notes,
        });
      } else if (subcommand === 'archive') {
        result = await archiveKnowledgeCandidate(knowledgeProjectPath, {
          id: flags.id ?? positionals[1] ?? null,
          reason: flags.reason ?? flags.notes,
        });
      } else if (subcommand === 'restore') {
        result = await restoreKnowledgeCandidate(knowledgeProjectPath, {
          id: flags.id ?? positionals[1] ?? null,
        });
      } else {
        console.log('Usage: openprd knowledge <candidates|reject|archive|restore> [path-or-id] [--status <pending-review|all|rejected|archived|promoted|merged>] [--id <candidate-id>] [--reason <text>] [--json]');
        return 1;
      }
      printKnowledgeResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'visual-prepare') {
      const result = await visualPrepareWorkspace(projectPath, {
        reference: flags.reference,
        grid: flags.grid,
        boxes: flags.boxes,
        include: flags.include,
        id: flags.id,
        title: flags.title,
        out: flags.out,
      });
      printVisualPrepareResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'visual-compare') {
      const result = await visualCompareWorkspace(projectPath, {
        reference: flags.reference,
        actual: flags.actual,
        before: flags.before,
        after: flags.after,
        board: flags.board,
        out: flags.out,
        format: flags.format,
        quality: flags.quality,
        maxPanelWidth: flags.maxPanelWidth,
        referenceLabel: flags.referenceLabel,
        actualLabel: flags.actualLabel,
        locale: flags.locale,
      });
      printVisualCompareResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'design-starter') {
      const result = await designStarterWorkspace(projectPath, {
        starter: flags.starter,
        out: flags.out,
        title: flags.title,
        brief: flags.brief,
        sections: flags.sections,
        noExternalFacts: flags.noExternalFacts,
        noBrandAssets: flags.noBrandAssets,
        noRealImages: flags.noRealImages,
        force: flags.force,
      });
      printDesignStarterResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'grow') {
      const firstArgIsProjectPath = !flags.path && positionals.length > 0 && await isDirectoryPath(positionals[0]);
      const growthProjectPath = path.resolve(flags.path ?? (firstArgIsProjectPath ? positionals[0] : process.cwd()));
      let result;
      if (flags.init) {
        result = await initGrowthWorkspace(growthProjectPath);
      } else if (flags.apply) {
        result = await applyGrowthCandidateWorkspace(growthProjectPath, { id: flags.id });
      } else if (flags.reject) {
        result = await rejectGrowthCandidateWorkspace(growthProjectPath, { id: flags.id, notes: flags.notes });
      } else if (flags.check) {
        result = await checkGrowthWorkspace(growthProjectPath);
      } else {
        result = await reviewGrowthWorkspace(growthProjectPath);
      }
      printGrowthResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'dev-check') {
      const firstArgIsProjectPath = !flags.path && positionals.length > 1 && await isDirectoryPath(positionals[0]);
      const devProjectPath = path.resolve(flags.path ?? (firstArgIsProjectPath ? positionals[0] : process.cwd()));
      const files = flags.path
        ? positionals
        : (firstArgIsProjectPath ? positionals.slice(1) : positionals);
      const result = await checkDevelopmentStandardsWorkspace(devProjectPath, { files });
      printDevelopmentStandardsResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'benchmark') {
      const subcommand = positionals[0] ?? 'list';
      const benchmarkProjectPath = path.resolve(
        flags.path
          ?? ((subcommand === 'list' || subcommand === 'verify') ? positionals[1] : null)
          ?? process.cwd(),
      );
      const target = positionals[1] ?? null;
      let result;
      if (subcommand === 'add') {
        result = await addBenchmarkWorkspace(benchmarkProjectPath, {
          source: target ?? flags.source,
          notes: flags.notes,
        });
      } else if (subcommand === 'observe') {
        result = await observeBenchmarkSourceWorkspace(benchmarkProjectPath, {
          source: target ?? flags.source,
          notes: flags.notes,
          task: flags.item ?? flags.event,
          adoptedSignal: flags.status ?? flags.outcome,
          threshold: flags.threshold,
        });
      } else if (subcommand === 'approve') {
        result = await approveBenchmarkWorkspace(benchmarkProjectPath, {
          id: flags.id ?? target,
        });
      } else if (subcommand === 'verify') {
        result = await verifyBenchmarkWorkspace(benchmarkProjectPath);
      } else if (subcommand === 'list') {
        result = await listBenchmarkWorkspace(benchmarkProjectPath);
      } else {
        console.log('Usage: openprd benchmark <add|observe|list|approve|verify> [target-or-id] [path-for-list-or-verify] [--path <project>] [--notes <text>] [--id <benchmark-id>]');
        return 1;
      }
      printBenchmarkResult(result, flags.json);
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
      const result = await clarifyWorkspace(projectPath, { open: flags.open || !flags.json, mode: flags.mode });
      printClarifyResult(result, flags.json);
      return 0;
    }

    if (command === 'capture') {
      const result = await captureWorkspace(projectPath, {
        field: flags.field,
        value: flags.value,
        jsonFile: flags.jsonFile,
        artifactMarkdown: flags.artifactMarkdown,
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

    if (command === 'playground') {
      const result = await playgroundWorkspace(projectPath, { open: flags.open });
      printPlaygroundResult(result, flags.json);
      return 0;
    }

    if (command === 'brainstorm') {
      const result = await brainstormWorkspace(projectPath, {
        topic: flags.topic,
        open: flags.open || !flags.json,
        json: flags.json,
      });
      printBrainstormResult(result, flags.json);
      return 0;
    }

    if (command === 'learn') {
      if (flags.enable || flags.disable) {
        const enabled = flags.enable ? true : false;
        if (flags.enable && flags.disable) {
          throw new Error('Cannot use --enable and --disable together.');
        }
        const result = await setLearningReviewModeWorkspace(projectPath, enabled);
        printLearningResult(result, flags.json);
        return result.ok ? 0 : 1;
      }

      const result = await generateLearningReviewWorkspace(projectPath, {
        topic: flags.topic,
        genre: flags.genre,
        style: flags.style,
        sourceScope: flags.source,
        contentJson: flags.contentJson,
        open: flags.open || !flags.json,
        trigger: 'manual',
        respectConfig: false,
      });
      printLearningResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'synthesize') {
      const result = await synthesizeWorkspace(projectPath, {
        title: flags.title,
        owner: flags.owner,
        problemStatement: flags.problem,
        whyNow: flags.whyNow,
        evidence: flags.evidence,
        productType: flags.productType,
        workUnit: flags.workUnit,
        targetRoot: flags.targetRoot,
        open: flags.open || !flags.json,
      });
      printSynthesizeResult(result, flags.json);
      return 0;
    }

    if (command === 'review') {
      const result = await reviewWorkspace(projectPath, {
        open: flags.open,
        mark: flags.mark,
        notes: flags.notes,
        version: flags.version,
        digest: flags.digest,
        workUnit: flags.workUnit,
      });
      printReviewResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'review-presentation') {
      if (flags.template) {
        console.log(JSON.stringify(buildReviewPresentationTemplatePayload(), null, 2));
        return 0;
      }
      const result = await reviewPresentationWorkspace(projectPath, {
        version: flags.version,
        presentationPath: flags.presentation,
        write: flags.write,
      });
      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`展示文案校验: ${result.ok ? '通过' : '需要重写'}`);
        console.log(`版本: ${result.versionId}`);
        console.log(`超限或格式问题: ${result.presentationFeedback.length}`);
        if (result.presentationFeedback.length > 0) {
          for (const item of result.presentationFeedback.slice(0, 6)) {
            const pathHint = item.jsonPath ? `${item.jsonPath}: ` : '';
            const sizeHint = item.maxChars ? ` 当前 ${item.currentChars} 字，限制 ${item.maxChars} 字。` : '';
            console.log(`- ${item.area} / ${item.target}: ${pathHint}${item.action}${sizeHint}`);
          }
        }
        if (result.written) {
          console.log(`已写入: ${result.written}`);
        }
        if (result.reviewPath) {
          console.log(`已生成评审面板: ${result.reviewPath}`);
        }
        if (result.reviewEntryPath) {
          console.log(`已更新固定入口: ${result.reviewEntryPath}`);
        }
      }
      return flags.failOnViolation && !result.ok ? 1 : 0;
    }

    if (command === 'brainstorm-presentation') {
      if (flags.template) {
        console.log(JSON.stringify(buildBrainstormPresentationTemplatePayload(), null, 2));
        return 0;
      }
      const result = await brainstormPresentationWorkspace(projectPath, {
        presentationPath: flags.presentation,
        write: flags.write,
      });
      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`展示文案校验: ${result.ok ? '通过' : '需要重写'}`);
        console.log(`主题: ${result.topic}`);
        console.log(`超限或格式问题: ${result.presentationFeedback.length}`);
        if (result.presentationFeedback.length > 0) {
          for (const item of result.presentationFeedback.slice(0, 6)) {
            const pathHint = item.jsonPath ? `${item.jsonPath}: ` : '';
            const sizeHint = item.maxChars ? ` 当前 ${item.currentChars} 字，限制 ${item.maxChars} 字。` : '';
            console.log(`- ${item.area} / ${item.target}: ${pathHint}${item.action}${sizeHint}`);
          }
        }
        if (result.written) {
          console.log(`已写入: ${result.written}`);
        }
        if (result.htmlPath) {
          console.log(`已更新脑暴页面: ${result.htmlPath}`);
        }
      }
      return flags.failOnViolation && !result.ok ? 1 : 0;
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

    if (command === 'release') {
      const result = await releaseWorkspace(projectPath, {
        enable: flags.enable,
        disable: flags.disable,
        setVersion: flags.set,
        status: flags.status,
        version: flags.version,
        notes: flags.notes,
      });
      printReleaseResult(result, flags.json);
      return result.ok ? 0 : 1;
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
      const result = flags.evidenceRequired
        ? await checkOpenSpecTaskEvidenceWorkspace(projectPath, taskOptions)
        : flags.advance
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
  selfUpdateWorkspace,
  upgradeWorkspace,
  doctorWorkspace,
  fleetWorkspace,
  backfillWorkUnitsWorkspace,
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
  playgroundWorkspace,
  brainstormWorkspace,
  generateLearningReviewWorkspace,
  setLearningReviewModeWorkspace,
  synthesizeWorkspace,
  nextWorkspace,
  diffWorkspace,
  historyWorkspace,
  releaseWorkspace,
  reviewWorkspace,
  brainstormPresentationWorkspace,
  reviewPresentationWorkspace,
  freezeWorkspace,
  handoffWorkspace,
  generateOpenSpecChangeWorkspace,
  validateOpenSpecChangeWorkspace,
  openspecDiscoveryWorkspace,
  listOpenSpecTaskWorkspace,
  advanceOpenSpecTaskWorkspace,
  verifyOpenSpecTaskWorkspace,
  checkOpenSpecTaskEvidenceWorkspace,
  listOpenPrdChangesWorkspace,
  activateOpenPrdChangeWorkspace,
  closeOpenPrdChangeWorkspace,
  applyOpenPrdChangeWorkspace,
  archiveOpenPrdChangeWorkspace,
  listAcceptedSpecsWorkspace,
  diagramWorkspace,
  designStarterWorkspace,
  classifyWorkspace,
  interviewWorkspace,
  loadWorkspace,
  initStandardsWorkspace,
  checkStandardsWorkspace,
  classifyExternalReferenceWorkspace,
  initQualityWorkspace,
  verifyQualityWorkspace,
  learnQualityWorkspace,
  qualityWorkspace,
  listKnowledgeCandidates,
  rejectKnowledgeCandidate,
  archiveKnowledgeCandidate,
  restoreKnowledgeCandidate,
  visualPrepareWorkspace,
  visualCompareWorkspace,
  checkDevelopmentStandardsWorkspace,
  initGrowthWorkspace,
  checkGrowthWorkspace,
  reviewGrowthWorkspace,
  applyGrowthCandidateWorkspace,
  rejectGrowthCandidateWorkspace,
  benchmarkWorkspace,
  addBenchmarkWorkspace,
  observeBenchmarkSourceWorkspace,
  listBenchmarkWorkspace,
  approveBenchmarkWorkspace,
  verifyBenchmarkWorkspace,
};
