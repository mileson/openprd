import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildPrdSnapshot, formatVersionId } from './prd-core.js';
import { buildDiagramArtifact, renderDiagramArtifactFromModel, renderDiagramMermaidFromModel, validateDiagramContract, validateDiagramLanguage } from './diagram-core.js';
import { exists, readJson, writeJson, writeText } from './fs-utils.js';
import { appendDecision, appendProgress, appendWorkflowEvent, loadLatestVersionSnapshot, loadWorkspace, readVersionIndex, resolveActiveTemplatePack, resolveCurrentProductType } from './workspace-core.js';

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


export { diagramWorkspace, getDiagramReviewState };
