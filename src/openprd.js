import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzePrdSnapshot, buildPrdSnapshot, formatVersionId } from './prd-core.js';
import { validateOpenSpecChangeWorkspace } from './openspec/change-validate.js';
import { generateOpenSpecChangeWorkspace as writeOpenSpecChangeWorkspace } from './openspec/generate.js';
import { advanceOpenSpecTaskWorkspace, listOpenSpecTaskWorkspace, verifyOpenSpecTaskWorkspace } from './openspec/execute.js';
import { activateOpenPrdChangeWorkspace, applyOpenPrdChangeWorkspace, archiveOpenPrdChangeWorkspace, closeOpenPrdChangeWorkspace, listAcceptedSpecsWorkspace, listOpenPrdChangesWorkspace } from './openspec/change-lifecycle.js';
import { checkStandardsWorkspace, initStandardsWorkspace } from './standards.js';
import { doctorOpenPrdAgentIntegration, setupOpenPrdAgentIntegration, updateOpenPrdAgentIntegration } from './agent-integration.js';
import { finishLoopWorkspace, initLoopWorkspace, nextLoopWorkspace, planLoopWorkspace, promptLoopWorkspace, runLoopWorkspace, statusLoopWorkspace, verifyLoopWorkspace } from './loop.js';
import { timestamp } from './time.js';
import { parseCommandArgs, usage } from './cli/args.js';
import { printAcceptedSpecsResult, printAgentIntegrationResult, printCaptureResult, printClarifyResult, printClassifyResult, printDiagramResult, printDiffResult, printDoctorResult, printFleetResult, printFreezeResult, printHandoffResult, printHistoryResult, printInitResult, printInterviewResult, printLoopResult, printNextResult, printOpenPrdChangeActionResult, printOpenPrdChangesResult, printOpenSpecChangeValidationResult, printOpenSpecDiscoveryResult, printOpenSpecGenerateResult, printOpenSpecTaskResult, printRunResult, printStandardsResult, printStatus, printSynthesizeResult, printValidation } from './cli/print.js';
import { cjoin, exists, writeJson, writeText, writeYaml } from './fs-utils.js';
import { diagramWorkspace } from './diagram-workspace.js';
import { createOpenSpecDiscoveryWorkspace } from './discovery.js';
import { createFleetWorkspace } from './fleet.js';
import { createRunWorkspace } from './run-harness.js';
import { captureWorkspace, clarifyWorkspace, classifyWorkspace, computeWorkspaceGuidance, diffWorkspace, historyWorkspace, interviewWorkspace, nextWorkspace, synthesizeWorkspace } from './workspace-workflow.js';
import { appendDecision, appendProgress, appendVerification, appendWorkflowEvent, buildWorkflowTaskGraph, computeWorkspaceDigest, CORE_TEMPLATE_FILES, ensureWorkspaceSkeleton, isSupportedProductType, loadLatestVersionSnapshot, loadWorkspace, migrateWorkspaceSkeleton, normalizeVersionId, readVersionIndex, resolveActiveTemplatePack, resolveCurrentProductType, validateWorkspace } from './workspace-core.js';

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
});

const fleetWorkspace = createFleetWorkspace({ setupAgentIntegrationWorkspace, updateAgentIntegrationWorkspace, doctorWorkspace });

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
