import path from 'node:path';
import crypto from 'node:crypto';
import { analyzePrdSnapshot, buildPrdSnapshot, diffSnapshots, formatVersionId, renderPrdMarkdown, summarizeSnapshot } from './prd-core.js';
import { getDiagramReviewState } from './diagram-workspace.js';
import { exists, readJson, readText, writeJson, writeText } from './fs-utils.js';
import { timestamp } from './time.js';
import { appendDecision, appendOpenQuestions, appendProgress, appendWorkflowEvent, buildClarificationPlan, buildClarificationState, buildWorkflowTaskGraph, CAPTURE_SOURCES, coerceCapturedValue, deriveGateLabels, detectWorkspaceScenario, extractMarkdownSection, FIELD_PATH_TO_STATE_KEY, isSupportedProductType, loadLatestVersionSnapshot, loadWorkspace, normalizeVersionId, readVersionIndex, readVersionSnapshot, renderFlowDoc, renderHandoffDoc, renderRolesDoc, resolveActiveTemplatePack, resolveCurrentProductType, validateWorkspace, writeVersionIndex, writeVersionSnapshot } from './workspace-core.js';

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


export {
  captureWorkspace,
  clarifyWorkspace,
  classifyWorkspace,
  computeWorkspaceGuidance,
  diffWorkspace,
  historyWorkspace,
  interviewWorkspace,
  nextWorkspace,
  synthesizeWorkspace
};
