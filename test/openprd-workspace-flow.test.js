import test from 'node:test';
import { loadWorkspace } from '../src/workspace-core.js';
import {
  readSessionBinding,
  syncSessionBindingFromChange,
  syncSessionBindingFromReview,
  syncSessionBindingFromSnapshot,
} from '../src/session-binding.js';

import {
  assert,
  spawnSync,
  fs,
  os,
  path,
  sharp,
  buildReviewExportPayload,
  renderReviewArtifact,
  addBenchmarkWorkspace,
  advanceOpenSpecTaskWorkspace,
  applyGrowthCandidateWorkspace,
  applyOpenPrdChangeWorkspace,
  approveBenchmarkWorkspace,
  archiveOpenPrdChangeWorkspace,
  captureWorkspace,
  checkDevelopmentStandardsWorkspace,
  checkStandardsWorkspace,
  clarifyWorkspace,
  classifyExternalReferenceWorkspace,
  classifyWorkspace,
  diagramWorkspace,
  diffWorkspace,
  doctorWorkspace,
  finishLoopWorkspace,
  fleetWorkspace,
  freezeWorkspace,
  generateLearningReviewWorkspace,
  generateOpenSpecChangeWorkspace,
  handoffWorkspace,
  historyWorkspace,
  initLoopWorkspace,
  initQualityWorkspace,
  initWorkspace,
  interviewWorkspace,
  learnQualityWorkspace,
  listAcceptedSpecsWorkspace,
  listBenchmarkWorkspace,
  listOpenPrdChangesWorkspace,
  listOpenSpecTaskWorkspace,
  main,
  nextLoopWorkspace,
  nextWorkspace,
  observeBenchmarkSourceWorkspace,
  openspecDiscoveryWorkspace,
  planLoopWorkspace,
  playgroundWorkspace,
  promptLoopWorkspace,
  reviewGrowthWorkspace,
  reviewPresentationWorkspace,
  reviewWorkspace,
  runLoopWorkspace,
  runWorkspace,
  setLearningReviewModeWorkspace,
  setupAgentIntegrationWorkspace,
  statusLoopWorkspace,
  synthesizeWorkspaceBase,
  updateAgentIntegrationWorkspace,
  validateOpenSpecChangeWorkspace,
  validateWorkspace,
  verifyBenchmarkWorkspace,
  verifyLoopWorkspace,
  verifyQualityWorkspace,
  visualCompareWorkspace,
  archiveKnowledgeCandidate,
  listKnowledgeCandidates,
  rejectKnowledgeCandidate,
  restoreKnowledgeCandidate,
  checkCodexCliHealth,
  ensureCodexCliReady,
  createRunWorkspace,
  OPENPRD_LITE_WRITE_TOOL_MATCHER,
  OPENPRD_GUARDED_WRITE_TOOL_MATCHER,
  TEST_OPENPRD_HOME,
  hasTomlFeatureKey,
  findOpenPrdHookGroup,
  makeTempProject,
  pathExists,
  readJsonl,
  writeAnswersFile,
  writeConcreteBasicDocs,
  writeSourceManual,
  writeFolderManual,
  writeFakeCodexBin,
  writeLoopProject,
  mergeReviewPresentation,
  validReviewPresentation,
  writeValidReviewPresentation,
  synthesizeWorkspace,
  writeMinimalChange,
} from './helpers/openprd-test-helpers.js';
test('validate fails for an empty project', async () => {
  const project = await makeTempProject();

  const { report } = await validateWorkspace(project);
  assert.equal(report.valid, false);
  assert.ok(report.errors.length > 0);
});

test('classify and interview write discovery state', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'base' });

  const classifyResult = await classifyWorkspace(project, 'agent');
  assert.equal(classifyResult.currentState.productType, 'agent');

  const interviewResult = await interviewWorkspace(project, 'agent');
  assert.equal(interviewResult.productType, 'agent');
  assert.ok(interviewResult.transcript.includes('Agent Intake'));
  assert.ok(interviewResult.transcript.includes('第一版最希望先跑通哪一段 Agent 工作流'));

  const currentStatePath = path.join(project, '.openprd', 'state', 'current.json');
  const currentState = JSON.parse(await fs.readFile(currentStatePath, 'utf8'));
  assert.equal(currentState.status, 'interviewing');
  assert.equal(currentState.productType, 'agent');
});

test('session-scoped current state stays isolated across requirement lanes', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });
  const sessionA = '019e8727-3377-7f21-bf42-1667e3264af8';
  const sessionB = '019e8748-fc31-7d01-a5f5-d9cc86f5bad3';
  const harnessDir = path.join(project, '.openprd', 'harness');
  await fs.mkdir(path.join(harnessDir, 'requirement-gates'), { recursive: true });

  const writeScopedGate = async (sessionId, promptPreview) => {
    const gate = {
      version: 1,
      active: true,
      status: 'requires-clarification',
      sessionId,
      promptPreview,
      openedAt: '2026-06-02 10:00:00',
      updatedAt: '2026-06-02 10:00:00',
    };
    await fs.writeFile(path.join(harnessDir, 'requirement-gate.json'), `${JSON.stringify(gate, null, 2)}\n`);
    await fs.writeFile(path.join(harnessDir, 'requirement-gates', `${sessionId}.json`), `${JSON.stringify(gate, null, 2)}\n`);
  };

  await writeScopedGate(sessionA, 'Session A requirement');
  await captureWorkspace(project, {
    field: 'problem.problemStatement',
    value: 'Session A problem statement',
    source: 'user-confirmed',
  });

  const sessionAStatePath = path.join(harnessDir, 'session-states', `${sessionA}.json`);
  const sessionAState = JSON.parse(await fs.readFile(sessionAStatePath, 'utf8'));
  assert.equal(sessionAState.problemStatement, 'Session A problem statement');

  await writeScopedGate(sessionB, 'Session B requirement');
  const loadedB = await loadWorkspace(project);
  assert.equal(loadedB.data.currentSessionId, sessionB);
  assert.equal(loadedB.data.currentState.problemStatement, undefined);
  assert.equal(loadedB.data.workspaceCurrentState.problemStatement, 'Session A problem statement');

  await captureWorkspace(project, {
    field: 'problem.problemStatement',
    value: 'Session B problem statement',
    source: 'user-confirmed',
  });

  const sessionBStatePath = path.join(harnessDir, 'session-states', `${sessionB}.json`);
  const sessionBState = JSON.parse(await fs.readFile(sessionBStatePath, 'utf8'));
  const sessionAStateAfter = JSON.parse(await fs.readFile(sessionAStatePath, 'utf8'));
  const mirroredCurrentState = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'state', 'current.json'), 'utf8'));
  assert.equal(sessionAStateAfter.problemStatement, 'Session A problem statement');
  assert.equal(sessionBState.problemStatement, 'Session B problem statement');
  assert.equal(mirroredCurrentState.problemStatement, 'Session B problem statement');
  assert.equal(mirroredCurrentState.laneSessionId, sessionB);
});

test('session binding sync prefers the active lane state over a stale legacy gate', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });
  const sessionA = '019e8b6e-4e4e-7541-a237-5e8d7d654a11';
  const sessionB = '019e8b63-669e-70d1-a2c4-5c6d1e40b6d0';
  const harnessDir = path.join(project, '.openprd', 'harness');
  const stateDir = path.join(project, '.openprd', 'state');
  await fs.mkdir(path.join(harnessDir, 'requirement-gates'), { recursive: true });
  await fs.mkdir(path.join(harnessDir, 'session-bindings'), { recursive: true });

  const staleLegacyGate = {
    version: 1,
    active: true,
    status: 'prd-review-required',
    sessionId: sessionB,
    promptPreview: 'stale legacy requirement',
    openedAt: '2026-06-03 10:00:00',
    updatedAt: '2026-06-03 10:00:00',
  };
  await fs.writeFile(path.join(harnessDir, 'requirement-gate.json'), `${JSON.stringify(staleLegacyGate, null, 2)}\n`);
  await fs.writeFile(path.join(stateDir, 'current.json'), JSON.stringify({
    version: 1,
    laneScope: 'session',
    laneSessionId: sessionA,
    status: 'synthesized',
  }, null, 2));

  const snapshot = {
    title: 'Scoped Session Binding',
    versionId: 'v0007',
    digest: 'digest-session-a',
    workUnitId: 'wu-session-a',
    targetRoot: 'docs/basic',
  };

  await syncSessionBindingFromSnapshot(project, snapshot, {
    reviewStatus: 'pending-confirmation',
    reviewPath: 'stable-review-a.html',
    activeReviewPath: 'active-review-a.html',
    targetRoot: 'docs/basic',
  });
  await syncSessionBindingFromReview(project, snapshot, {
    reviewStatus: 'confirmed',
    reviewPath: 'stable-review-a.html',
    activeReviewPath: 'active-review-a.html',
    targetRoot: 'docs/basic',
  });
  await syncSessionBindingFromChange(project, 'team-builder-a', {
    versionId: snapshot.versionId,
    digest: snapshot.digest,
    workUnitId: snapshot.workUnitId,
    targetRoot: snapshot.targetRoot,
    reviewStatus: 'confirmed',
    reviewPath: 'stable-review-a.html',
    activeReviewPath: 'active-review-a.html',
  });

  const bindingA = await readSessionBinding(project, sessionA);
  const bindingB = await readSessionBinding(project, sessionB);
  assert.equal(bindingA?.sessionId, sessionA);
  assert.equal(bindingA?.versionId, 'v0007');
  assert.equal(bindingA?.reviewStatus, 'confirmed');
  assert.equal(bindingA?.changeId, 'team-builder-a');
  assert.equal(bindingA?.reviewPath, 'stable-review-a.html');
  assert.equal(bindingB, null);
});


test('init workspace seeds Chinese-default README docs with English switch files', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const workspaceReadme = await fs.readFile(path.join(project, '.openprd', 'README.md'), 'utf8');
  const workspaceReadmeEn = await fs.readFile(path.join(project, '.openprd', 'README_EN.md'), 'utf8');
  const companyReadme = await fs.readFile(path.join(project, '.openprd', 'templates', 'company', 'README.md'), 'utf8');
  const companyReadmeEn = await fs.readFile(path.join(project, '.openprd', 'templates', 'company', 'README_EN.md'), 'utf8');

  assert.ok(workspaceReadme.includes('简体中文 | [English](./README_EN.md)'));
  assert.ok(workspaceReadme.includes('`docs/basic/`'));
  assert.ok(workspaceReadmeEn.includes('[简体中文](./README.md) | English'));
  assert.ok(companyReadme.includes('公司模板层'));
  assert.ok(companyReadme.includes('简体中文 | [English](./README_EN.md)'));
  assert.ok(companyReadmeEn.includes('[简体中文](./README.md) | English'));
});

test('clarify returns user questions and capture writes answers into state', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const clarify = await clarifyWorkspace(project, {});
  assert.ok(clarify.clarification.mustAskUser.length > 0);
  assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('先整理需求摘要给你确认')));
  assert.equal(clarify.inlineClarification.lines.some((line) => line.includes('确认执行')), false);

  const captured = await captureWorkspace(project, {
    field: 'problem.problemStatement',
    value: '用户无法在移动端高效完成节点选择与实时会话查看',
  });
  assert.equal(captured.stateKey, 'problemStatement');
  assert.equal(captured.value, '用户无法在移动端高效完成节点选择与实时会话查看');

  const presentation = await captureWorkspace(project, {
    field: 'reviewPresentation',
    value: JSON.stringify({
      mapNodes: {
        problem: { title: '问题定义', text: '移动端节点选择困难' },
      },
    }),
    source: 'agent-inferred',
  });
  assert.equal(presentation.stateKey, 'reviewPresentation');
  assert.equal(presentation.value.mapNodes.problem.text, '移动端节点选择困难');
});

test('capture can import multiple answers from a json file', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const answersPath = path.join(project, 'answers.json');
  await fs.writeFile(answersPath, JSON.stringify({
    'problem.problemStatement': {
      value: '移动端缺少高效的 Agent 会话与节点管理入口',
      source: 'user-confirmed'
    },
    'users.primaryUsers': {
      value: ['运维人员', 'Agent 重度用户'],
      source: 'user-confirmed'
    },
    'constraints.dependencies': {
      value: ['Auth API', 'Node service'],
      source: 'project-derived'
    }
  }, null, 2));

  const captured = await captureWorkspace(project, { jsonFile: answersPath });
  assert.equal(captured.applied.length, 3);

  const currentState = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'state', 'current.json'), 'utf8'));
  assert.equal(currentState.problemStatement, '移动端缺少高效的 Agent 会话与节点管理入口');
  assert.deepEqual(currentState.primaryUsers, ['运维人员', 'Agent 重度用户']);
  assert.deepEqual(currentState.dependencies, ['Auth API', 'Node service']);
  assert.equal(currentState.captureMeta['constraints.dependencies'].source, 'project-derived');
});

test('clarify distinguishes existing-project cold start from empty cold start', async () => {
  const project = await makeTempProject();
  await fs.writeFile(path.join(project, 'README.md'), '# Existing project\n');
  await initWorkspace(project, { templatePack: 'agent' });

  const clarify = await clarifyWorkspace(project, {});
  assert.equal(clarify.clarification.scenario.id, 'cold-start-existing-project');
});

test('clarify keeps OpenPrd bootstrap-only fresh init in greenfield mode and writes intake reflection', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const clarify = await clarifyWorkspace(project, {});
  assert.equal(clarify.clarification.scenario.id, 'cold-start-greenfield');
  assert.ok(clarify.clarification.mustAskUser.some((item) => item.id === 'project-overview'));
  assert.equal(clarify.clarification.mustAskUser.some((item) => item.id === 'existing-project-goal'), false);
  assert.ok(clarify.intakeReflection);
  assert.ok(clarify.intakeReflectionPath);

  const reflection = await fs.readFile(path.join(project, '.openprd', 'engagements', 'active', 'intake-reflection.md'), 'utf8');
  assert.ok(reflection.includes('冷启动（全新项目）'));
  assert.ok(reflection.includes('首轮项目画像'));
});


test('synthesize creates versioned PRD snapshots and diff detects changes', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });

  const first = await synthesizeWorkspace(project, {
    title: 'Growth Notes',
    owner: 'PM',
    problemStatement: 'Users need a faster onboarding path',
    whyNow: 'We lost activation last quarter',
    productType: 'consumer',
    persona: 'Busy creators',
  });
  assert.equal(first.snapshot.versionId, 'v0001');
  assert.ok(first.snapshot.content.includes('Growth Notes'));
  assert.ok(first.snapshot.content.includes('## 可视化图表'));
  assert.ok(first.snapshot.content.includes('```mermaid'));
  assert.ok(first.snapshot.content.includes('flowchart LR'));
  const flows = await fs.readFile(path.join(project, '.openprd', 'engagements', 'active', 'flows.md'), 'utf8');
  assert.ok(flows.includes('## Mermaid 流程图'));
  assert.ok(flows.includes('```mermaid'));

  const second = await synthesizeWorkspace(project, {
    title: 'Growth Notes',
    owner: 'PM',
    problemStatement: 'Users need a guided onboarding path',
    whyNow: 'We lost activation last quarter',
    productType: 'consumer',
    persona: 'Busy creators',
  });
  assert.equal(second.snapshot.versionId, 'v0002');

  const diff = await diffWorkspace(project);
  assert.equal(diff.diff.fromVersionId, 'v0001');
  assert.equal(diff.diff.toVersionId, 'v0002');
  assert.ok(diff.diff.changedSections.includes('problem'));

  const history = await historyWorkspace(project);
  assert.equal(history.versions.length, 2);
  assert.equal(history.versions[0].versionId, 'v0001');
  assert.equal(history.versions[1].versionId, 'v0002');
});

test('capture drops inherited review presentation when requirement content changes', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  await captureWorkspace(project, {
    jsonFile: await writeAnswersFile(project, 'old-review.json', {
      'meta.title': { value: '旧账号闭环需求', source: 'user-confirmed' },
      'problem.problemStatement': { value: '旧问题定义', source: 'user-confirmed' },
      'scenarios.primaryFlows': {
        value: ['旧流程正文'],
        source: 'user-confirmed',
      },
      reviewPresentation: {
        value: {
          mapNodes: {
            problem: { title: '问题定义', text: '旧账号问题图' },
          },
          flowNodes: [
            { text: '旧登录流程一步' },
            { text: '旧登录流程二步' },
            { text: '旧登录流程三步' },
          ],
        },
        source: 'user-confirmed',
      },
    }),
  });

  await synthesizeWorkspace(project, {
    productType: 'agent',
  });

  await captureWorkspace(project, {
    jsonFile: await writeAnswersFile(project, 'new-review.json', {
      'meta.title': { value: 'Hermes 保留数据卸载成功判定修复', source: 'user-confirmed' },
      'problem.problemStatement': {
        value: '当前 Hermes 的保留数据卸载在多配置场景下会被误判失败。',
        source: 'user-confirmed',
      },
      'scenarios.primaryFlows': {
        value: [
          '执行 Hermes 保留数据卸载',
          '清理程序、服务与托管文件',
          '保留 ~/.hermes 数据并返回成功',
        ],
        source: 'user-confirmed',
      },
    }),
  });

  const staleState = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'state', 'current.json'), 'utf8'));
  assert.equal(staleState.reviewPresentation, undefined);
  assert.equal(staleState.captureMeta.reviewPresentation, undefined);

  const resynthesized = await synthesizeWorkspaceBase(project, {
    productType: 'agent',
  });
  assert.equal(resynthesized.snapshot.reviewPresentation, null);
  assert.equal(resynthesized.reviewPresentationRequired, true);
  assert.equal(await pathExists(resynthesized.reviewPath), false);

  const rewritten = await writeValidReviewPresentation(project, resynthesized.snapshot.versionId, {
    flowNodes: [
      { text: '执行 Hermes 卸载' },
      { text: '清理托管文件' },
      { text: '保留数据并成功' },
    ],
  });
  const reviewHtml = await fs.readFile(rewritten.reviewPath, 'utf8');
  assert.ok(reviewHtml.includes('执行Hermes卸载'));
  assert.ok(reviewHtml.includes('保留数据并成功'));
  assert.equal(reviewHtml.includes('旧登录流程一步'), false);
  assert.equal(reviewHtml.includes('旧账号问题图'), false);
});

test('capture keeps explicit review presentation when new content and presentation arrive together', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  await captureWorkspace(project, {
    jsonFile: await writeAnswersFile(project, 'old-presentation.json', {
      'meta.title': { value: '旧需求', source: 'user-confirmed' },
      'problem.problemStatement': { value: '旧问题', source: 'user-confirmed' },
      reviewPresentation: {
        value: {
          flowNodes: [
            { text: '旧展示一步' },
            { text: '旧展示二步' },
            { text: '旧展示三步' },
          ],
        },
        source: 'user-confirmed',
      },
    }),
  });
  await synthesizeWorkspace(project, { productType: 'agent' });

  await captureWorkspace(project, {
    jsonFile: await writeAnswersFile(project, 'new-presentation.json', {
      'meta.title': { value: 'Hermes 保留数据卸载成功判定修复', source: 'user-confirmed' },
      'problem.problemStatement': {
        value: 'Hermes 保留数据卸载应该在多配置场景下继续成功。',
        source: 'user-confirmed',
      },
      'scenarios.primaryFlows': {
        value: [
          '执行 Hermes 保留数据卸载',
          '清理程序、服务与托管文件',
          '保留 ~/.hermes 数据并返回成功',
        ],
        source: 'user-confirmed',
      },
      reviewPresentation: {
        value: {
          mapNodes: {
            problem: { title: '问题定义', text: '新卸载问题图' },
          },
          flowNodes: [
            { text: '新展示一步' },
            { text: '新展示二步' },
            { text: '新展示三步' },
          ],
        },
        source: 'user-confirmed',
      },
    }),
  });

  const currentState = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'state', 'current.json'), 'utf8'));
  assert.equal(currentState.reviewPresentation.flowNodes[0].text, '新展示一步');

  const resynthesized = await synthesizeWorkspace(project, { productType: 'agent' });
  assert.equal(resynthesized.snapshot.reviewPresentation.mapNodes.problem.text, '新卸载问题图');
  const reviewHtml = await fs.readFile(resynthesized.reviewPath, 'utf8');
  assert.ok(reviewHtml.includes('新展示一步'));
  assert.equal(reviewHtml.includes('旧展示一步'), false);
});

test('diagram creates reviewable architecture artifacts', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await synthesizeWorkspace(project, {
    title: 'AI 操作导师',
    owner: 'PM',
    problemStatement: '新用户学不会复杂创意软件的操作',
    whyNow: '本地多模态与桌面助手成熟',
    primaryUsers: ['设计新手'],
    stakeholders: ['产品团队'],
    goals: ['缩短上手时间'],
    successMetrics: ['首日完成关键操作'],
    acceptanceGoals: ['用户能独立完成首次任务'],
    inScope: ['软件内实时指导'],
    outOfScope: ['完整学习社区'],
    primaryFlows: ['用户在软件中触发指导'],
    edgeCases: ['识别不到目标按钮'],
    failureModes: ['依赖服务不可用'],
    functional: ['识别当前界面', '给出下一步指导'],
    nonFunctional: ['响应时间低于 2 秒'],
    businessRules: ['高风险动作需要确认'],
    technical: ['本地运行'],
    compliance: ['隐私敏感数据不上传'],
    dependencies: ['多模态模型', '系统辅助权限'],
    assumptions: ['用户愿意授予权限'],
    risks: ['误导用户点击错误位置'],
    openQuestions: ['是否需要录制模式'],
    handoffOwner: 'PM',
    nextStep: '确认架构图后再冻结',
    targetSystem: 'OpenPrd',
    productType: 'consumer',
    persona: '设计新手',
    segment: '创意软件学习',
    journey: '首次上手',
    activationMetric: '完成首次操作',
    retentionMetric: '次日继续使用',
  });

  const result = await diagramWorkspace(project, { open: false, type: 'architecture' });
  const html = await fs.readFile(result.htmlPath, 'utf8');
  const model = JSON.parse(await fs.readFile(result.jsonPath, 'utf8'));
  const mermaid = await fs.readFile(result.mermaidPath, 'utf8');

  assert.ok(html.includes('架构评审'));
  assert.ok(html.includes('AI 操作导师'));
  assert.ok(html.includes('需求定稿前'));
  assert.equal(/freeze/i.test(html), false);
  assert.ok(mermaid.includes('flowchart LR'));
  assert.ok(mermaid.includes('方案边界'));
  assert.equal(result.type, 'architecture');
  assert.equal(model.metadata.versionId, 'v0001');
  assert.equal(Array.isArray(model.components), true);
  assert.equal(model.components.length >= 5, true);
});

test('diagram creates reviewable product flow artifacts', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await synthesizeWorkspace(project, {
    title: 'AI 操作导师',
    owner: 'PM',
    problemStatement: '新用户学不会复杂创意软件的操作',
    whyNow: '本地多模态与桌面助手成熟',
    primaryUsers: ['设计新手'],
    stakeholders: ['产品团队'],
    goals: ['缩短上手时间'],
    successMetrics: ['首日完成关键操作'],
    acceptanceGoals: ['用户能独立完成首次任务'],
    inScope: ['软件内实时指导'],
    outOfScope: ['完整学习社区'],
    primaryFlows: ['用户打开产品', '系统识别当前界面'],
    edgeCases: ['识别不到目标按钮'],
    failureModes: ['依赖服务不可用'],
    functional: ['识别当前界面', '给出下一步指导'],
    nonFunctional: ['响应时间低于 2 秒'],
    businessRules: ['高风险动作需要确认'],
    technical: ['本地运行'],
    compliance: ['隐私敏感数据不上传'],
    dependencies: ['多模态模型', '系统辅助权限'],
    assumptions: ['用户愿意授予权限'],
    risks: ['误导用户点击错误位置'],
    openQuestions: ['是否需要录制模式'],
    handoffOwner: 'PM',
    nextStep: '确认流程图后再冻结',
    targetSystem: 'OpenPrd',
    productType: 'consumer',
    persona: '设计新手',
    segment: '创意软件学习',
    journey: '首次上手',
    activationMetric: '完成首次操作',
    retentionMetric: '次日继续使用',
  });

  const result = await diagramWorkspace(project, { open: false, type: 'product-flow' });
  const html = await fs.readFile(result.htmlPath, 'utf8');
  const model = JSON.parse(await fs.readFile(result.jsonPath, 'utf8'));
  const mermaid = await fs.readFile(result.mermaidPath, 'utf8');

  assert.ok(html.includes('产品流程评审'));
  assert.ok(html.includes('AI 操作导师'));
  assert.ok(html.includes('需求定稿前'));
  assert.ok(html.includes('进入实现前确认'));
  assert.equal(/freeze/i.test(html), false);
  assert.ok(mermaid.includes('flowchart LR'));
  assert.ok(mermaid.includes('决策点'));
  assert.equal(result.type, 'product-flow');
  assert.equal(Array.isArray(model.steps), true);
  assert.equal(model.steps.length >= 4, true);
});

test('diagram can render from an explicit contract input', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await synthesizeWorkspace(project, {
    title: 'AI 操作导师',
    owner: 'PM',
    problemStatement: '新用户学不会复杂创意软件的操作',
    whyNow: '本地多模态与桌面助手成熟',
    primaryUsers: ['设计新手'],
    stakeholders: ['产品团队'],
    productType: 'consumer',
  });

  const contractPath = path.join(project, 'product-flow-contract.json');
  await fs.writeFile(contractPath, JSON.stringify({
    type: 'product-flow',
    locale: 'zh-CN',
    title: '首次上手流程图',
    subtitle: '给用户确认流程节点',
    actors: ['新用户', '系统'],
    steps: [
      { id: 's1', name: '打开产品', type: 'user_action', lane: '新用户', description: '用户进入产品' },
      { id: 's2', name: '识别当前界面', type: 'system_process', lane: '系统', details: ['分析当前界面状态'] },
      { id: 's3', name: '是否识别成功', type: 'decision', lane: '系统', description: '判断是否识别到目标元素' },
      { id: 's4', name: '给出下一步指导', type: 'success', lane: '系统', description: '提示用户如何操作' },
      { id: 's5', name: '提示用户重试', type: 'error_path', lane: '系统', description: '识别失败时给出恢复建议' },
    ],
    transitions: [
      { from_step_id: 's1', to_step_id: 's2', label: '开始' },
      { from_step_id: 's2', to_step_id: 's3', label: '完成识别' },
      { from_step_id: 's3', to_step_id: 's4', label: '成功', type: 'standard' },
      { from_step_id: 's3', to_step_id: 's5', label: '失败', type: 'error_path' },
    ],
    summaryCards: [
      { title: '参与者', color: 'user_action', items: ['新用户', '系统'] },
      { title: '确认重点', color: 'decision', items: ['是否缺少步骤', '是否缺少失败路径'] },
      { title: '输出', color: 'success', items: ['最终给出指导'] },
    ],
    metadata: {
      reviewStatus: 'pending-confirmation'
    },
    openQuestions: ['是否需要录制模式'],
    reviewInstructions: ['确认步骤顺序是否正确', '确认失败路径是否完整'],
  }, null, 2));

  const result = await diagramWorkspace(project, { open: false, type: 'product-flow', input: contractPath });
  const html = await fs.readFile(result.htmlPath, 'utf8');
  const model = JSON.parse(await fs.readFile(result.jsonPath, 'utf8'));
  const mermaid = await fs.readFile(result.mermaidPath, 'utf8');

  assert.equal(result.inputPath, contractPath);
  assert.ok(html.includes('首次上手流程图'));
  assert.ok(mermaid.includes('首次上手流程图') || mermaid.includes('打开产品'));
  assert.equal(model.locale, 'zh-CN');
  assert.equal(model.steps[0].name, '打开产品');
});

test('diagram rejects invalid contract input', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await synthesizeWorkspace(project, {
    title: 'AI 操作导师',
    owner: 'PM',
    problemStatement: '新用户学不会复杂创意软件的操作',
    whyNow: '本地多模态与桌面助手成熟',
    primaryUsers: ['设计新手'],
    stakeholders: ['产品团队'],
    productType: 'consumer',
  });

  const contractPath = path.join(project, 'invalid-flow-contract.json');
  await fs.writeFile(contractPath, JSON.stringify({
    type: 'product-flow',
    title: '缺字段的流程图'
  }, null, 2));

  await assert.rejects(
    () => diagramWorkspace(project, { open: false, type: 'product-flow', input: contractPath }),
    /Invalid product-flow diagram contract/
  );
});

test('diagram rejects English-heavy zh-CN user-facing contract text', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await synthesizeWorkspace(project, {
    title: 'AI 操作导师',
    owner: 'PM',
    problemStatement: '新用户学不会复杂创意软件的操作',
    whyNow: '本地多模态与桌面助手成熟',
    primaryUsers: ['设计新手'],
    stakeholders: ['产品团队'],
    productType: 'consumer',
  });

  const contractPath = path.join(project, 'english-architecture-contract.json');
  await fs.writeFile(contractPath, JSON.stringify({
    type: 'architecture',
    locale: 'zh-CN',
    title: 'MotiClaw Agent CLI Capability Architecture',
    components: [
      {
        id: 'agent',
        name: 'Agent / Maintainer',
        type: 'external',
        subtitle: 'Discovers commands reads Skills runs dry-run and composes CLI outputs',
      },
      {
        id: 'gateway',
        name: 'CLI 网关',
        type: 'backend',
        subtitle: '解析命令并调度执行',
      },
    ],
    flows: [
      { source: 'agent', target: 'gateway', label: 'discover schema dry-run execute' },
    ],
    summaryCards: [
      {
        title: 'Core Pattern',
        items: ['Three CLI layers: atomic commands shortcuts and workflow orchestration'],
      },
    ],
    reviewInstructions: ['Confirm whether these are the right top-level layers'],
    metadata: {
      versionId: 'v0001',
      reviewStatus: 'pending-confirmation',
    },
  }, null, 2));

  await assert.rejects(
    () => diagramWorkspace(project, { open: false, type: 'architecture', input: contractPath }),
    /Invalid architecture diagram language[\s\S]*title 应使用简体中文表达/
  );
});

test('diagram mark updates review status on existing artifact', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await synthesizeWorkspace(project, {
    title: 'AI 操作导师',
    owner: 'PM',
    problemStatement: '新用户学不会复杂创意软件的操作',
    whyNow: '本地多模态与桌面助手成熟',
    primaryUsers: ['设计新手'],
    stakeholders: ['产品团队'],
    goals: ['缩短上手时间'],
    successMetrics: ['首日完成关键操作'],
    acceptanceGoals: ['用户能独立完成首次任务'],
    inScope: ['软件内实时指导'],
    outOfScope: ['完整学习社区'],
    primaryFlows: ['用户打开产品', '系统识别当前界面'],
    edgeCases: ['识别不到目标按钮'],
    failureModes: ['依赖服务不可用'],
    productType: 'consumer',
  });

  await diagramWorkspace(project, { open: false, type: 'product-flow' });
  const marked = await diagramWorkspace(project, { open: false, type: 'product-flow', mark: 'confirmed' });
  assert.equal(marked.marked, 'confirmed');

  const model = JSON.parse(await fs.readFile(marked.jsonPath, 'utf8'));
  const mermaid = await fs.readFile(marked.mermaidPath, 'utf8');
  assert.equal(model.metadata.reviewStatus, 'confirmed');
  assert.ok(mermaid.includes('flowchart LR'));
});

test('next suggests classify for a fresh workspace', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'base' });

  const result = await nextWorkspace(project);
  assert.equal(result.recommendation.nextAction, 'clarify-user');
  assert.equal(result.recommendation.currentGate, 'clarify-user');
  assert.equal(result.recommendation.upcomingGate, 'freeze review');
  assert.ok(result.recommendation.suggestedQuestions.length > 0);
  assert.match(result.recommendation.suggestedCommand, /openprd clarify/);
});

test('status prints current gate, upcoming gate, scenario, and user participation mode', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const exitCode = await main(['status', project]);
    assert.equal(exitCode, 0);
  } finally {
    console.log = originalLog;
  }

  const text = logs.join('\n');
  assert.match(text, /场景:/);
  assert.match(text, /用户参与模式:/);
  assert.match(text, /当前门禁:/);
  assert.match(text, /后续门禁:/);
});

test('next suggests interview after product type is classified', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'base' });
  await classifyWorkspace(project, 'consumer');

  const result = await nextWorkspace(project);
  assert.equal(result.recommendation.nextAction, 'clarify-user');
  assert.equal(result.recommendation.currentGate, 'clarify-user');
  assert.equal(result.recommendation.upcomingGate, 'freeze review');
  assert.ok(result.recommendation.suggestedQuestions.includes('我们要解决什么问题？'));
  assert.match(result.recommendation.suggestedCommand, /openprd clarify/);
  assert.equal(result.taskGraph.nextReadyNode, 'clarify');
  assert.ok(result.taskGraph.blockers.length > 0);
});

test('next suggests freeze after a complete PRD has been synthesized', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });

  await synthesizeWorkspace(project, {
    title: 'Signup Flow',
    owner: 'PM',
    problemStatement: 'Users bounce at signup',
    whyNow: 'Activation is low',
    evidence: ['Survey data'],
    primaryUsers: ['Busy creators'],
    stakeholders: ['Growth team'],
    goals: ['Improve activation'],
    successMetrics: ['Activation > 40%'],
    acceptanceGoals: ['Users can sign up in less than 2 minutes'],
    inScope: ['Signup flow'],
    outOfScope: ['Billing'],
    primaryFlows: ['User signs up'],
    edgeCases: ['OAuth failure'],
    failureModes: ['Email validation error'],
    functional: ['Create account'],
    nonFunctional: ['p95 < 2s'],
    businessRules: ['Invite required'],
    technical: ['Reuse current auth service'],
    compliance: ['GDPR'],
    dependencies: ['Auth API'],
    assumptions: ['Users have email'],
    risks: ['Signup drop-off'],
    openQuestions: ['Need SSO?'],
    handoffOwner: 'PM',
    nextStep: 'Freeze and review',
    targetSystem: 'OpenPrd',
    productType: 'consumer',
    persona: 'Busy creators',
    segment: 'Self-serve',
    journey: 'Activation',
    activationMetric: 'Signup completion',
    retentionMetric: 'Returning users',
  });

  const result = await nextWorkspace(project);
  assert.equal(result.recommendation.nextAction, 'diagram');
  assert.equal(result.recommendation.currentGate, 'product-flow diagram review');
  assert.equal(result.recommendation.upcomingGate, 'freeze review');
  assert.equal(result.analysis.missingRequiredFields, 0);
  assert.match(result.recommendation.suggestedCommand, /openprd diagram/);
  assert.equal(result.taskGraph.nextReadyNode, 'diagram');
});

test('next does not trigger business guardrails for compliance-only token wording', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });

  await synthesizeWorkspace(project, {
    title: 'Signup Flow',
    owner: 'PM',
    problemStatement: 'Users bounce at signup',
    whyNow: 'Activation is low',
    evidence: ['Survey data'],
    primaryUsers: ['Busy creators'],
    stakeholders: ['Growth team'],
    goals: ['Improve activation'],
    successMetrics: ['Activation > 40%'],
    acceptanceGoals: ['Users can sign up in less than 2 minutes'],
    inScope: ['Signup flow'],
    outOfScope: ['Billing'],
    primaryFlows: ['User signs up'],
    edgeCases: ['OAuth failure'],
    failureModes: ['Email validation error'],
    functional: ['Create account'],
    nonFunctional: ['p95 < 2s'],
    businessRules: ['Invite required'],
    technical: ['Reuse current auth service'],
    compliance: ['API token must stay on the server and never appear in client logs'],
    dependencies: ['Auth API'],
    assumptions: ['Users have email'],
    risks: ['Signup drop-off'],
    openQuestions: ['Need SSO?'],
    handoffOwner: 'PM',
    nextStep: 'Freeze and review',
    targetSystem: 'OpenPrd',
    productType: 'consumer',
    persona: 'Busy creators',
    segment: 'Self-serve',
    journey: 'Activation',
    activationMetric: 'Signup completion',
    retentionMetric: 'Returning users',
  });

  const result = await nextWorkspace(project);
  assert.equal(result.recommendation.nextAction, 'diagram');
  assert.equal(result.recommendation.currentGate, 'product-flow diagram review');
  assert.equal(result.analysis.missingFields.some((field) => field.path.startsWith('businessGuardrails.')), false);
});

test('next asks for business guardrails when a PRD includes free metered AI usage', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });

  await synthesizeWorkspace(project, {
    title: 'AI Image Trial',
    owner: 'PM',
    problemStatement: 'Free users need to try AI generation before upgrading',
    whyNow: 'Trial conversion depends on showing value',
    evidence: ['Support requests'],
    primaryUsers: ['Free creators'],
    stakeholders: ['Growth team'],
    goals: ['Increase trial conversion'],
    successMetrics: ['Trial conversion > 8%'],
    acceptanceGoals: ['Free users can generate a limited preview'],
    inScope: ['AI generation preview'],
    outOfScope: ['Paid plan billing'],
    primaryFlows: ['Free user generates a preview image'],
    edgeCases: ['Quota exhausted'],
    failureModes: ['Third-party model call fails'],
    functional: ['Allow free users to generate AI image previews'],
    nonFunctional: ['p95 < 3s'],
    businessRules: ['Free users require quota checks'],
    technical: ['Use current model gateway'],
    compliance: ['Content policy'],
    dependencies: ['Model API'],
    assumptions: ['Users are signed in'],
    risks: ['Free quota can be abused'],
    openQuestions: ['What is the daily preview limit?'],
    handoffOwner: 'PM',
    nextStep: 'Review guardrails',
    targetSystem: 'OpenPrd',
    productType: 'consumer',
    persona: 'Free creators',
    segment: 'Self-serve',
    journey: 'Trial activation',
    activationMetric: 'First preview generated',
    retentionMetric: 'Return after preview',
  });

  const result = await nextWorkspace(project);
  assert.equal(result.recommendation.nextAction, 'clarify-user');
  assert.equal(result.recommendation.currentGate, 'clarify-user');
  assert.ok(result.recommendation.suggestedQuestions.includes('哪些用户行为、第三方服务或模型调用会产生成本？'));
  assert.ok(result.analysis.missingFields.some((field) => field.path === 'businessGuardrails.costDrivers'));
});

test('confirmed review absorbs inferred business guardrails instead of asking again', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });

  const answersPath = path.join(project, 'guardrails.json');
  await fs.writeFile(answersPath, JSON.stringify({
    'businessGuardrails.costDrivers': {
      value: ['免费用户触发图像生成会消耗第三方模型额度'],
      source: 'agent-inferred',
    },
    'businessGuardrails.usageLimits': {
      value: ['免费用户每天最多生成 3 张预览图'],
      source: 'agent-inferred',
    },
    'businessGuardrails.abusePrevention': {
      value: ['同设备和账号共享限额，并拦截批量刷额度'],
      source: 'agent-inferred',
    },
    'businessGuardrails.monitoringSignals': {
      value: ['按账号统计生成成功率和额度消耗'],
      source: 'agent-inferred',
    },
    'businessGuardrails.alertThresholds': {
      value: ['日消耗超过预算阈值时报警'],
      source: 'agent-inferred',
    },
    'businessGuardrails.stopLossActions': {
      value: ['超阈值后暂停免费预览并降级到占位提示'],
      source: 'agent-inferred',
    },
  }, null, 2));
  await captureWorkspace(project, { jsonFile: answersPath });

  await synthesizeWorkspace(project, {
    title: 'AI Image Trial',
    owner: 'PM',
    problemStatement: 'Free users need to try AI generation before upgrading',
    whyNow: 'Trial conversion depends on showing value',
    evidence: ['Support requests'],
    primaryUsers: ['Free creators'],
    stakeholders: ['Growth team'],
    goals: ['Increase trial conversion'],
    successMetrics: ['Trial conversion > 8%'],
    acceptanceGoals: ['Free users can generate a limited preview'],
    inScope: ['AI generation preview'],
    outOfScope: ['Paid plan billing'],
    primaryFlows: ['Free user generates a preview image'],
    edgeCases: ['Quota exhausted'],
    failureModes: ['Third-party model call fails'],
    functional: ['Allow free users to generate AI image previews'],
    nonFunctional: ['p95 < 3s'],
    businessRules: ['Free users require quota checks'],
    technical: ['Use current model gateway'],
    compliance: ['Content policy'],
    dependencies: ['Model API'],
    assumptions: ['Users are signed in'],
    risks: ['Free quota can be abused'],
    openQuestions: ['What is the daily preview limit?'],
    handoffOwner: 'PM',
    nextStep: 'Review guardrails',
    targetSystem: 'OpenPrd',
    productType: 'consumer',
    persona: 'Free creators',
    segment: 'Self-serve',
    journey: 'Trial activation',
    activationMetric: 'First preview generated',
    retentionMetric: 'Return after preview',
  });

  const beforeReview = await nextWorkspace(project);
  assert.equal(beforeReview.recommendation.nextAction, 'clarify-user');
  assert.ok(beforeReview.recommendation.suggestedQuestions.some((question) => question.includes('请确认这个推断输入')));

  await reviewWorkspace(project, { mark: 'confirmed' });

  const afterReview = await nextWorkspace(project);
  assert.equal(afterReview.recommendation.nextAction, 'diagram');
  assert.equal(afterReview.recommendation.currentGate, 'product-flow diagram review');
});

test('generated changes include business guardrail tasks for metered free usage', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await synthesizeWorkspace(project, {
    title: 'AI Image Trial',
    owner: 'PM',
    problemStatement: 'Free users need to try AI generation before upgrading',
    whyNow: 'Trial conversion depends on showing value',
    evidence: ['Support requests'],
    primaryUsers: ['Free creators'],
    stakeholders: ['Growth team'],
    goals: ['Increase trial conversion'],
    successMetrics: ['Trial conversion > 8%'],
    acceptanceGoals: ['Free users can generate a limited preview'],
    inScope: ['AI generation preview'],
    outOfScope: ['Paid plan billing'],
    primaryFlows: ['Free user generates a preview image'],
    edgeCases: ['Quota exhausted'],
    failureModes: ['Third-party model call fails'],
    functional: ['Allow free users to generate AI image previews'],
    nonFunctional: ['p95 < 3s'],
    businessRules: ['Free users require quota checks'],
    costDrivers: ['Each preview calls the third-party model API'],
    usageLimits: ['Free users get 3 previews per day and 20 per month'],
    abusePrevention: ['Block replay, concurrent quota bypass, and unauthorized identity switches'],
    monitoringSignals: ['Track tokens_used, cost_usd, user_id, and plan_id'],
    alertThresholds: ['Alert when free preview cost exceeds daily budget threshold'],
    stopLossActions: ['Feature flag can disable or degrade free previews'],
    technical: ['Use current model gateway'],
    compliance: ['Content policy'],
    dependencies: ['Model API'],
    assumptions: ['Users are signed in'],
    risks: ['Free quota can be abused'],
    openQuestions: ['Need per-IP limit?'],
    handoffOwner: 'PM',
    nextStep: 'Generate change',
    targetSystem: 'OpenPrd',
    productType: 'consumer',
  });

  await reviewWorkspace(project, { mark: 'confirmed' });
  const result = await generateOpenSpecChangeWorkspace(project, { change: 'ai-image-trial' });
  assert.equal(result.validation.valid, true);
  const tasks = await fs.readFile(path.join(project, 'openprd', 'changes', 'ai-image-trial', 'tasks.md'), 'utf8');
  assert.ok(tasks.includes('Verify Cost And Quota Guardrails'));
  assert.ok(tasks.includes('Verify Abuse And Privilege Escalation Paths'));
  assert.ok(tasks.includes('Verify Cost Monitoring, Alerts, And Stop-Loss'));
});

test('next suggests freeze after required diagram and PRD review have been confirmed', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });

  await synthesizeWorkspace(project, {
    title: 'Signup Flow',
    owner: 'PM',
    problemStatement: 'Users bounce at signup',
    whyNow: 'Activation is low',
    evidence: ['Survey data'],
    primaryUsers: ['Busy creators'],
    stakeholders: ['Growth team'],
    goals: ['Improve activation'],
    successMetrics: ['Activation > 40%'],
    acceptanceGoals: ['Users can sign up in less than 2 minutes'],
    inScope: ['Signup flow'],
    outOfScope: ['Billing'],
    primaryFlows: ['User signs up'],
    edgeCases: ['OAuth failure'],
    failureModes: ['Email validation error'],
    functional: ['Create account'],
    nonFunctional: ['p95 < 2s'],
    businessRules: ['Invite required'],
    technical: ['Reuse current auth service'],
    compliance: ['GDPR'],
    dependencies: ['Auth API'],
    assumptions: ['Users have email'],
    risks: ['Signup drop-off'],
    openQuestions: ['Need SSO?'],
    handoffOwner: 'PM',
    nextStep: 'Freeze and review',
    targetSystem: 'OpenPrd',
    productType: 'consumer',
    persona: 'Busy creators',
    segment: 'Self-serve',
    journey: 'Activation',
    activationMetric: 'Signup completion',
    retentionMetric: 'Returning users',
  });

  await diagramWorkspace(project, { open: false, type: 'product-flow', mark: 'confirmed' });
  const reviewGate = await nextWorkspace(project);
  assert.equal(reviewGate.recommendation.nextAction, 'review');
  assert.equal(reviewGate.recommendation.currentGate, 'prd review');
  assert.match(reviewGate.recommendation.suggestedCommand, /openprd review/);

  const reviewed = await reviewWorkspace(project, { mark: 'confirmed' });
  assert.equal(reviewed.ok, true);
  assert.equal(reviewed.status, 'confirmed');

  const runContext = await runWorkspace(project, { context: true });
  assert.equal(runContext.recommendation.type, 'prd-change');
  assert.ok(runContext.recommendation.executionCommand.includes('openprd change . --generate'));

  const result = await nextWorkspace(project);
  assert.equal(result.recommendation.nextAction, 'freeze');
  assert.equal(result.recommendation.currentGate, 'freeze review');
  assert.equal(result.recommendation.upcomingGate, 'handoff review');
  assert.match(result.recommendation.suggestedCommand, /openprd freeze/);
});
