import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { captureWorkspace, clarifyWorkspace, classifyWorkspace, diagramWorkspace, diffWorkspace, freezeWorkspace, handoffWorkspace, historyWorkspace, initWorkspace, interviewWorkspace, main, nextWorkspace, synthesizeWorkspace, validateWorkspace } from '../src/openprd.js';

async function makeTempProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-test-'));
  await fs.mkdir(path.join(dir, 'project'), { recursive: true });
  return path.join(dir, 'project');
}

test('init creates a workspace and validate passes', async () => {
  const project = await makeTempProject();

  const initResult = await initWorkspace(project, { templatePack: 'consumer' });
  assert.equal(initResult.currentState.templatePack, 'consumer');

  const { report } = await validateWorkspace(project);
  assert.equal(report.valid, true);
  assert.equal(report.errors.length, 0);

  const decisionLog = await fs.readFile(path.join(project, '.openprd', 'engagements', 'active', 'decision-log.md'), 'utf8');
  const taskGraph = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'state', 'task-graph.json'), 'utf8'));
  assert.ok(decisionLog.includes('# Decision Log'));
  assert.equal(Array.isArray(taskGraph.nodes), true);
  assert.equal(Array.isArray(taskGraph.workflow), true);
  assert.equal(Array.isArray(taskGraph.artifacts), true);
  assert.equal(typeof taskGraph.nextReadyNode, 'string');
});

test('freeze writes a snapshot and handoff exports openspec bundle', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'b2b' });

  const freezeResult = await freezeWorkspace(project);
  assert.equal(freezeResult.ok, true);
  assert.equal(freezeResult.snapshot.prdVersion, 1);
  assert.ok(freezeResult.snapshot.digest.length > 0);

  const handoffResult = await handoffWorkspace(project, 'openspec');
  assert.equal(handoffResult.ok, true);
  assert.equal(handoffResult.handoff.versionId, 'v0001');
  assert.ok(handoffResult.handoff.digest.length > 0);

  const handoffJsonPath = path.join(project, '.openprd', 'exports', 'openspec', 'handoff.json');
  const handoffJson = JSON.parse(await fs.readFile(handoffJsonPath, 'utf8'));
  assert.equal(handoffJson.target, 'openspec');
  assert.equal(handoffJson.templatePack, 'b2b');
  assert.equal(handoffJson.versionId, 'v0001');
});

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

  const currentStatePath = path.join(project, '.openprd', 'state', 'current.json');
  const currentState = JSON.parse(await fs.readFile(currentStatePath, 'utf8'));
  assert.equal(currentState.status, 'interviewing');
  assert.equal(currentState.productType, 'agent');
});

test('clarify returns user questions and capture writes answers into state', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const clarify = await clarifyWorkspace(project, {});
  assert.ok(clarify.clarification.mustAskUser.length > 0);

  const captured = await captureWorkspace(project, {
    field: 'problem.problemStatement',
    value: '用户无法在移动端高效完成节点选择与实时会话查看',
  });
  assert.equal(captured.stateKey, 'problemStatement');
  assert.equal(captured.value, '用户无法在移动端高效完成节点选择与实时会话查看');
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
    targetSystem: 'OpenSpec',
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

  assert.ok(html.includes('Architecture Review'));
  assert.ok(html.includes('AI 操作导师'));
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
    targetSystem: 'OpenSpec',
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

  assert.ok(html.includes('Product Flow Review'));
  assert.ok(html.includes('AI 操作导师'));
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

  assert.equal(result.inputPath, contractPath);
  assert.ok(html.includes('首次上手流程图'));
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
  assert.equal(model.metadata.reviewStatus, 'confirmed');
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
  assert.match(text, /Scenario:/);
  assert.match(text, /User participation mode:/);
  assert.match(text, /Current gate:/);
  assert.match(text, /Upcoming gate:/);
});

test('next suggests interview after product type is classified', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'base' });
  await classifyWorkspace(project, 'consumer');

  const result = await nextWorkspace(project);
  assert.equal(result.recommendation.nextAction, 'clarify-user');
  assert.equal(result.recommendation.currentGate, 'clarify-user');
  assert.equal(result.recommendation.upcomingGate, 'freeze review');
  assert.ok(result.recommendation.suggestedQuestions.includes('What problem are we solving?'));
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
    targetSystem: 'OpenSpec',
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

test('next suggests freeze after required diagram has been confirmed', async () => {
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
    targetSystem: 'OpenSpec',
    productType: 'consumer',
    persona: 'Busy creators',
    segment: 'Self-serve',
    journey: 'Activation',
    activationMetric: 'Signup completion',
    retentionMetric: 'Returning users',
  });

  await diagramWorkspace(project, { open: false, type: 'product-flow', mark: 'confirmed' });
  const result = await nextWorkspace(project);
  assert.equal(result.recommendation.nextAction, 'freeze');
  assert.equal(result.recommendation.currentGate, 'freeze review');
  assert.equal(result.recommendation.upcomingGate, 'handoff review');
  assert.match(result.recommendation.suggestedCommand, /openprd freeze/);
});
