import test from 'node:test';

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
  releaseWorkspace,
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
test('openprd discovery initializes a resumable coverage run', async () => {
  const project = await makeTempProject();
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'README.md'), '# Example App\n');
  await fs.writeFile(path.join(project, 'src', 'app.ts'), 'export function run() { return true; }\n');
  await initWorkspace(project, { templatePack: 'agent' });

  const result = await openspecDiscoveryWorkspace(project, {
    maxIterations: 7,
  });

  assert.equal(result.ok, true);
  assert.equal(result.control.mode, 'brownfield');
  assert.equal(result.control.maxIterations, 7);
  assert.ok(result.runDir.includes(path.join('.openprd', 'discovery', 'runs')));
  assert.ok(result.inventory.files.some((file) => file.path === 'README.md'));
  assert.ok(result.inventory.files.some((file) => file.path === path.join('src', 'app.ts')));
  assert.ok(result.coverageMatrix.summary.total > 0);
  assert.ok(result.coverageMatrix.summary.pending > 0);
  assert.ok(result.claims.length > 0);

  const current = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'discovery', 'current.json'), 'utf8'));
  assert.equal(current.activeRunId, result.runId);

  const control = JSON.parse(await fs.readFile(path.join(result.runDir, 'control.json'), 'utf8'));
  assert.equal(control.status, 'active');

  const context = await fs.readFile(path.join(result.runDir, 'context.md'), 'utf8');
  assert.ok(context.includes('OpenPrd 持续发现上下文'));

  const discoveryReadme = await fs.readFile(path.join(project, '.openprd', 'discovery', 'README.md'), 'utf8');
  assert.ok(discoveryReadme.includes('持续发现状态'));

  const resumed = await openspecDiscoveryWorkspace(project, { resume: true });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.runId, result.runId);
  assert.equal(resumed.coverageMatrix.summary.pending, result.coverageMatrix.summary.pending);

  const nextItem = resumed.coverageMatrix.nextPendingItem;
  const advanced = await openspecDiscoveryWorkspace(project, {
    advance: true,
    item: nextItem.id,
    claim: 'The reference implementation exposes a runnable app entry point.',
    evidence: 'src/app.ts',
    confidence: 0.9,
  });
  assert.equal(advanced.advanced, true);
  assert.equal(advanced.advancedItem.id, nextItem.id);
  assert.equal(advanced.advancedItem.status, 'covered');
  assert.equal(advanced.coverageMatrix.summary.pending, result.coverageMatrix.summary.pending - 1);
  assert.ok(advanced.claim.id.includes(nextItem.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '')));

  const persistedClaims = (await fs.readFile(path.join(result.runDir, 'claims.jsonl'), 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.ok(persistedClaims.some((claim) => claim.id === advanced.claim.id));

  const verified = await openspecDiscoveryWorkspace(project, { verify: true });
  assert.equal(verified.verified, true);
  assert.equal(verified.ok, true);
  assert.equal(verified.verification.valid, true);
  assert.equal(verified.verification.coverage.pending, advanced.coverageMatrix.summary.pending);
});

test('openprd discovery ignores dependency folders and enforces task shards', async () => {
  const project = await makeTempProject();
  await fs.mkdir(path.join(project, '.venv', 'lib'), { recursive: true });
  await fs.mkdir(path.join(project, '.venv-release311', 'lib'), { recursive: true });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.mkdir(path.join(project, 'openprd', 'changes', 'large-change'), { recursive: true });
  await fs.mkdir(path.join(project, '.openprd', 'discovery'), { recursive: true });
  await fs.writeFile(path.join(project, '.venv', 'lib', 'dependency.py'), 'print("dependency")\n');
  await fs.writeFile(path.join(project, '.venv-release311', 'lib', 'dependency.py'), 'print("dependency")\n');
  await fs.writeFile(path.join(project, 'src', 'app.ts'), 'export const app = true;\n');
  await fs.writeFile(path.join(project, '.openprd', 'discovery', 'config.json'), JSON.stringify({
    taskSharding: {
      maxItemsPerFile: 2
    }
  }, null, 2) + '\n');
  await fs.writeFile(
    path.join(project, 'openprd', 'changes', 'large-change', 'tasks.md'),
    Array.from({ length: 41 }, (_, index) => `- [ ] ${index + 1}. Task ${index + 1}`).join('\n') + '\n'
  );
  await initWorkspace(project, { templatePack: 'agent' });

  const result = await openspecDiscoveryWorkspace(project, {});
  assert.equal(result.inventory.files.some((file) => file.path.includes('.venv')), false);
  assert.ok(result.inventory.files.some((file) => file.path === path.join('src', 'app.ts')));

  const failed = await openspecDiscoveryWorkspace(project, { verify: true });
  assert.equal(failed.ok, false);
  assert.equal(failed.verification.valid, false);
  assert.ok(failed.verification.errors.some((error) => error.includes('不超过 2 个')));

  await fs.writeFile(
    path.join(project, 'openprd', 'changes', 'large-change', 'tasks.md'),
    [
      '- [ ] 1. First shard task',
      '- [ ] Continue with `tasks-002.md` after completing this file.',
      '',
    ].join('\n')
  );
  await fs.writeFile(
    path.join(project, 'openprd', 'changes', 'large-change', 'tasks-002.md'),
    '- [ ] 2. Second shard task\n'
  );

  const passed = await openspecDiscoveryWorkspace(project, { verify: true });
  assert.equal(passed.ok, true);
  assert.equal(passed.verification.valid, true);
  assert.ok(passed.verification.checks.some((check) => check.includes('每个文件最多 2 个')));
});

test('openprd discovery verifies structured task metadata and dependencies', async () => {
  const project = await makeTempProject();
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.mkdir(path.join(project, 'openprd', 'changes', 'structured-change'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'app.ts'), 'export const app = true;\n');
  await initWorkspace(project, { templatePack: 'agent' });
  await openspecDiscoveryWorkspace(project, {});

  await fs.writeFile(
    path.join(project, 'openprd', 'changes', 'structured-change', 'tasks.md'),
    [
      '- [ ] T001.01 Prepare database import contract',
      '  - done: contract covers counts, conflicts, skipped items, and warnings',
      '  - verify: npm run test -- migration',
      '- [ ] T001.02 Port legacy database import preview',
      '  - deps: T001.01',
      '  - done: preview shows counts, conflicts, skipped items, warnings',
      '  - verify: npm run test -- migration',
      '',
    ].join('\n')
  );

  const passed = await openspecDiscoveryWorkspace(project, { verify: true });
  assert.equal(passed.ok, true);
  assert.equal(passed.verification.valid, true);
  const structuredTaskCheck = passed.verification.checks.find((check) => check.includes('结构化 OpenPrd 任务: 2 个任务，1 条依赖'));
  assert.ok(structuredTaskCheck);
  assert.ok(structuredTaskCheck.includes('测试策略显式 0 个、推导 2 个'));
  assert.ok(structuredTaskCheck.includes('执行策略显式 0 个、推导 2 个'));

  await fs.writeFile(
    path.join(project, 'openprd', 'changes', 'structured-change', 'tasks.md'),
    [
      '- [ ] T001.01 评审生成的 spec 覆盖',
      '  - type: governance',
      '  - done: structured-change 的 spec 覆盖当前变更目标',
      '  - verify: openprd change . --validate --change structured-change',
      '- [ ] T001.02 实现主流程: Port legacy database import preview',
      '  - type: implementation',
      '  - deps: T001.99',
      '  - verify: openprd change . --validate --change structured-change',
      '',
    ].join('\n')
  );

  const failed = await openspecDiscoveryWorkspace(project, { verify: true });
  assert.equal(failed.ok, false);
  assert.equal(failed.verification.valid, false);
  assert.ok(failed.verification.errors.some((error) => error.includes('缺少 "done:"')));
  assert.ok(failed.verification.errors.some((error) => error.includes('依赖未知任务 T001.99')));
  assert.ok(failed.verification.errors.some((error) => error.includes('按 PRD 小节平移')));
  assert.ok(failed.verification.errors.some((error) => error.includes('只做了 change 结构校验')));
});

test('openprd validates change structure without external openspec cli', async () => {
  const project = await makeTempProject();
  const changeDir = path.join(project, 'openspec', 'changes', 'desktop-rebuild');
  await fs.mkdir(path.join(changeDir, 'specs', 'desktop-shell'), { recursive: true });
  await fs.writeFile(path.join(changeDir, '.openprd.yaml'), 'schema: openprd.change.v1\n');
  await fs.writeFile(path.join(changeDir, 'proposal.md'), [
    '## Why',
    '',
    'The desktop shell needs a durable OpenPrd-owned validation path.',
    '',
    '## What Changes',
    '',
    '- Add an internal OpenPrd change validator.',
    '',
    '## Capabilities',
    '',
    '- `desktop-shell`: Desktop shell behavior.',
    '',
    '## Impact',
    '',
    '- Agents can use OpenPrd as the only entry point.',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'design.md'), '## Context\n\nInternal validation belongs to OpenPrd.\n');
  await fs.writeFile(path.join(changeDir, 'tasks.md'), [
    '- [ ] T001.01 评审生成的 spec 覆盖',
    '  - type: governance',
    '  - done: OpenPrd change 结构已覆盖桌面壳校验需求',
    '  - verify: openprd change . --validate --change desktop-rebuild',
    '- [ ] T001.02 补齐桌面壳校验入口',
    '  - type: implementation',
    '  - deps: T001.01',
    '  - done: 桌面壳校验入口已经接到 OpenPrd 自有校验路径',
    '  - verify: openprd run . --verify',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'specs', 'desktop-shell', 'spec.md'), [
    '## 新增需求',
    '',
    '### 需求：桌面壳校验通过 OpenPrd 执行',
    '桌面壳校验应由 OpenPrd 内置能力完成，不依赖第三方 OpenSpec CLI。',
    '',
    '#### 场景：Agent 检查变更',
    '- **当** Agent 运行 OpenPrd 校验',
    '- **则** OpenPrd change 应被完整检查',
    '',
  ].join('\n'));

  const result = await validateOpenSpecChangeWorkspace(project, { change: 'desktop-rebuild' });
  assert.equal(result.ok, true);
  assert.equal(result.valid, true);
  assert.ok(result.checks.some((check) => check.includes('OpenPrd change desktop-rebuild')));

  await fs.writeFile(path.join(changeDir, 'specs', 'desktop-shell', 'spec.md'), [
    '## 新增需求',
    '',
    '### 需求：桌面壳校验通过 OpenPrd 执行',
    '桌面壳校验应由 OpenPrd 内置能力完成，不依赖第三方 OpenSpec CLI。',
    '',
  ].join('\n'));

  const failed = await validateOpenSpecChangeWorkspace(project, { change: 'desktop-rebuild' });
  assert.equal(failed.ok, false);
  assert.ok(failed.errors.some((error) => error.includes('必须至少包含一个场景')));
});

test('openprd validates spec structure without enforcing body language policy', async () => {
  const project = await makeTempProject();
  const changeDir = path.join(project, 'openprd', 'changes', 'desktop-rebuild');
  await fs.mkdir(path.join(changeDir, 'specs', 'desktop-shell'), { recursive: true });
  await fs.writeFile(path.join(changeDir, 'proposal.md'), [
    '## 背景与原因',
    '',
    '需要验证 spec 正文语言。',
    '',
    '## 变更内容',
    '',
    '- `desktop-shell`: 校验语言规则。',
    '',
    '## 影响范围',
    '',
    '- OpenPrd change 校验。',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'tasks.md'), [
    '- [ ] T001.01 评审 spec 语言约束',
    '  - type: governance',
    '  - done: spec 语言规则已覆盖',
    '  - verify: openprd change . --validate --change desktop-rebuild',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'specs', 'desktop-shell', 'spec.md'), [
    '## ADDED Requirements',
    '',
    '### Requirement: Desktop shell SHALL validate through OpenPrd',
    'The shell validation SHALL not require a third-party OpenSpec CLI.',
    '',
    '#### Scenario: Agent 检查变更',
    '- **WHEN** Agent 运行 OpenPrd 校验',
    '- **THEN** OpenPrd change 应被完整检查',
    '',
  ].join('\n'));

  const englishHeavySpec = await validateOpenSpecChangeWorkspace(project, { change: 'desktop-rebuild' });
  assert.equal(englishHeavySpec.ok, true);
  assert.equal(englishHeavySpec.valid, true);
});

test('openprd generates a change from the latest prd snapshot', async () => {
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
  });

  await assert.rejects(
    () => generateOpenSpecChangeWorkspace(project, { change: 'signup-flow' }),
    /review\.html/,
  );
  await reviewWorkspace(project, { mark: 'confirmed' });
  const result = await generateOpenSpecChangeWorkspace(project, { change: 'signup-flow' });
  assert.equal(result.ok, true);
  assert.equal(result.changeId, 'signup-flow');
  assert.ok(result.files.includes(path.join('openprd', 'changes', 'signup-flow', 'proposal.md')));
  assert.ok(result.files.some((file) => file.endsWith(path.join('specs', 'consumer-requirements', 'spec.md'))));
  assert.equal(result.validation.valid, true);

  const specText = await fs.readFile(path.join(project, 'openprd', 'changes', 'signup-flow', 'specs', 'consumer-requirements', 'spec.md'), 'utf8');
  assert.match(specText, /^## New Requirements$/m);
  assert.match(specText, /^### Requirement: /m);
  assert.match(specText, /^#### Scenario: /m);
  assert.match(specText, /^- \*\*When\*\*/m);
  assert.match(specText, /^- \*\*Then\*\*/m);
  assert.doesNotMatch(specText, /^## 新增需求$|^### 需求：|^\- \*\*当\*\*|^\- \*\*则\*\*/m);
  const tasksText = await fs.readFile(path.join(project, 'openprd', 'changes', 'signup-flow', 'tasks.md'), 'utf8');
  assert.match(tasksText, /^# Tasks$/m);
  assert.match(tasksText, /Review Generated Spec Coverage/);
  assert.match(tasksText, /execution-mode: /);
  assert.match(tasksText, /parallel-group: /);
  assert.match(tasksText, /write-scope: /);
  assert.match(tasksText, /owner-role: /);
  assert.match(tasksText, /local-verify: /);
  assert.match(tasksText, /integration-owner: /);

  const discoveryConfig = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'discovery', 'config.json'), 'utf8'));
  assert.equal(discoveryConfig.activeChange, 'signup-flow');
  assert.ok(discoveryConfig.taskMetadata.optional.includes('execution-mode'));
  assert.ok(discoveryConfig.taskMetadata.optional.includes('write-scope'));

  const changesState = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'state', 'changes.json'), 'utf8'));
  assert.equal(changesState.activeChange, 'signup-flow');
});

test('openprd applies accepted specs and archives changes', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await synthesizeWorkspace(project, {
    title: 'Checkout Flow',
    owner: 'PM',
    problemStatement: 'Users cannot complete checkout reliably',
    whyNow: 'Revenue is blocked',
    primaryUsers: ['Buyers'],
    stakeholders: ['Growth team'],
    goals: ['Increase successful checkouts'],
    successMetrics: ['Checkout success > 95%'],
    acceptanceGoals: ['Buyers can complete checkout'],
    inScope: ['Checkout flow'],
    outOfScope: ['Subscriptions'],
    primaryFlows: ['Buyer pays for an order'],
    edgeCases: ['Payment failure'],
    failureModes: ['Inventory unavailable'],
    functional: ['Submit payment'],
    nonFunctional: ['p95 < 2s'],
    businessRules: ['Payment is required'],
    technical: ['Use existing payment provider'],
    compliance: ['PCI'],
    dependencies: ['Payment API'],
    assumptions: ['Buyer has a valid card'],
    risks: ['Payment provider downtime'],
    openQuestions: ['Need saved cards?'],
    handoffOwner: 'PM',
    nextStep: 'Generate change',
    targetSystem: 'OpenPrd',
    productType: 'consumer',
  });
  await reviewWorkspace(project, { mark: 'confirmed' });
  await generateOpenSpecChangeWorkspace(project, { change: 'checkout-flow' });

  const listed = await listOpenPrdChangesWorkspace(project);
  assert.equal(listed.activeChange, 'checkout-flow');
  assert.ok(listed.changes.some((change) => change.id === 'checkout-flow' && change.active));

  const blockedApply = await applyOpenPrdChangeWorkspace(project, { change: 'checkout-flow' });
  assert.equal(blockedApply.ok, false);
  assert.ok(blockedApply.errors.some((error) => error.includes('未完成任务')));

  const applied = await applyOpenPrdChangeWorkspace(project, { change: 'checkout-flow', force: true });
  assert.equal(applied.ok, true);
  assert.ok(applied.appliedSpecs.some((spec) => spec.capability === 'consumer-requirements'));

  const specs = await listAcceptedSpecsWorkspace(project);
  assert.equal(specs.specs.length, 1);
  assert.equal(specs.specs[0].capability, 'consumer-requirements');
  assert.ok(specs.specs[0].specPath.endsWith(path.join('openprd', 'specs', 'consumer-requirements', 'spec.md')));

  const archived = await archiveOpenPrdChangeWorkspace(project, { change: 'checkout-flow' });
  assert.equal(archived.ok, true);
  assert.equal(archived.removedSource, true);
  assert.ok(await fs.stat(path.join(project, 'openprd', 'archive', 'changes', 'checkout-flow')).then(() => true));
  assert.equal(await fs.stat(path.join(project, 'openprd', 'changes', 'checkout-flow')).then(() => true).catch(() => false), false);
});

test('openprd exposes natural change task and specs cli commands', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await synthesizeWorkspace(project, {
    title: 'Profile Settings',
    owner: 'PM',
    problemStatement: 'Users cannot keep profile settings current',
    whyNow: 'Support tickets are increasing',
    primaryUsers: ['Account users'],
    stakeholders: ['Support team'],
    goals: ['Reduce profile update tickets'],
    successMetrics: ['Tickets down 30%'],
    acceptanceGoals: ['Users can update profile details'],
    inScope: ['Profile settings'],
    outOfScope: ['Billing settings'],
    primaryFlows: ['User updates profile'],
    edgeCases: ['Invalid display name'],
    failureModes: ['Save failure'],
    functional: ['Save profile'],
    nonFunctional: ['p95 < 2s'],
    businessRules: ['Name is required'],
    technical: ['Use existing account service'],
    compliance: ['GDPR'],
    dependencies: ['Account API'],
    assumptions: ['User is signed in'],
    risks: ['Account service unavailable'],
    openQuestions: ['Need avatar upload?'],
    handoffOwner: 'PM',
    nextStep: 'Generate change',
    targetSystem: 'OpenPrd',
    productType: 'consumer',
  });

  await reviewWorkspace(project, { mark: 'confirmed' });
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['change', project, '--generate', '--change', 'profile-settings']), 0);
    assert.equal(await main(['change', project, '--validate', '--change', 'profile-settings', '--json']), 0);
    assert.equal(await main(['tasks', project, '--change', 'profile-settings', '--json']), 0);
    assert.equal(await main(['changes', project, '--json']), 0);
    assert.equal(await main(['change', project, '--apply', '--change', 'profile-settings', '--force', '--json']), 0);
    assert.equal(await main(['specs', project, '--json']), 0);
  } finally {
    console.log = originalLog;
  }
  assert.ok(logs.some((line) => line.includes('已生成 OpenPrd change: profile-settings')));
  const generatedProposal = await fs.readFile(path.join(project, 'openprd', 'changes', 'profile-settings', 'proposal.md'), 'utf8');
  assert.ok(generatedProposal.includes('## Background And Rationale'));
  assert.ok(generatedProposal.includes('## Change Scope'));
  assert.ok(generatedProposal.includes('## Impact'));
  const generatedTasks = await fs.readFile(path.join(project, 'openprd', 'changes', 'profile-settings', 'tasks.md'), 'utf8');
  assert.ok(generatedTasks.includes('  - type: implementation'));
  assert.ok(generatedTasks.includes('  - type: documentation'));
  assert.ok(generatedTasks.includes('docs/basic'));
  assert.ok(generatedTasks.includes('missing docs were added and stale docs were updated'));
  assert.ok(generatedTasks.includes('openprd standards . --verify'));
  assert.ok(generatedTasks.includes('--evidence-required'));
  assert.equal(generatedTasks.includes('openprd run . --verify'), false);
  assert.equal(/^(?:- \[ \] )?T\d{3}\.\d+\s+(实现主流程|实现需求|验证验收目标|验证非功能需求)\s*[:：]/m.test(generatedTasks), false);
  assert.equal(/^(?:- \[ \] )?T\d{3}\.\d+\s+(Implement primary flow|Implement requirement|Validate acceptance goal|Validate non-functional requirement)\s*[:：]/m.test(generatedTasks), false);
  const taskState = await listOpenSpecTaskWorkspace(project, { change: 'profile-settings' });
  assert.ok(taskState.summary.implementation.total >= 2);
  assert.ok(taskState.tasks.some((task) => task.metadata.type === 'implementation' && /--evidence-required\b/.test(task.metadata.verify ?? '')));
  assert.equal(taskState.tasks.some((task) => task.metadata.type === 'implementation' && task.metadata.verify === 'openprd run . --verify'), false);
  assert.equal(
    taskState.tasks.filter((task) => task.metadata.type !== 'governance' && /^openprd change \. --validate\b/i.test(task.metadata.verify ?? '')).length,
    0
  );
});

test('openprd task evidence gate records task evidence without quality report churn', async () => {
  const project = await makeTempProject();
  const changeDir = path.join(project, 'openspec', 'changes', 'evidence-gate');
  await fs.mkdir(changeDir, { recursive: true });
  await fs.writeFile(path.join(changeDir, 'tasks.md'), [
    '- [ ] T001.01 Wire focused task evidence',
    '  - type: implementation',
    '  - done: evidence gate is wired',
    '  - verify: openprd tasks . --change evidence-gate --item T001.01 --evidence-required',
    '',
  ].join('\n'));

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['tasks', project, '--change', 'evidence-gate', '--item', 'T001.01', '--verify', '--json']), 1);
    assert.equal(await main(['tasks', project, '--change', 'evidence-gate', '--item', 'T001.01', '--verify', '--evidence', 'node --test test/evidence.test.js', '--json']), 0);
    assert.equal(await main(['tasks', project, '--change', 'evidence-gate', '--item', 'T001.01', '--advance', '--verify', '--evidence', 'node --test test/evidence.test.js', '--json']), 0);
  } finally {
    console.log = originalLog;
  }

  const tasksText = await fs.readFile(path.join(changeDir, 'tasks.md'), 'utf8');
  assert.match(tasksText, /- \[x\] T001\.01 Wire focused task evidence/);
  assert.equal(await pathExists(path.join(project, '.openprd', 'quality', 'reports', 'latest.json')), false);
  assert.ok(logs.some((line) => line.includes('OpenPrd task evidence: missing evidence')));
  assert.ok(logs.some((line) => line.includes('OpenPrd task evidence: passed')));
});

test('legacy per-task run verify is redirected to task evidence without quality churn', async () => {
  const project = await makeTempProject();
  const changeDir = path.join(project, 'openspec', 'changes', 'legacy-full-verify');
  await fs.mkdir(changeDir, { recursive: true });
  await fs.writeFile(path.join(changeDir, 'tasks.md'), [
    '- [ ] T001.01 Complete legacy generated task',
    '  - type: implementation',
    '  - done: legacy generated task is complete',
    '  - verify: openprd run . --verify',
    '',
  ].join('\n'));

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['tasks', project, '--change', 'legacy-full-verify', '--item', 'T001.01', '--verify', '--json']), 1);
    assert.equal(await main(['tasks', project, '--change', 'legacy-full-verify', '--item', 'T001.01', '--advance', '--verify', '--evidence', 'legacy task smoke evidence', '--json']), 0);
  } finally {
    console.log = originalLog;
  }

  const tasksText = await fs.readFile(path.join(changeDir, 'tasks.md'), 'utf8');
  assert.match(tasksText, /- \[x\] T001\.01 Complete legacy generated task/);
  assert.equal(await pathExists(path.join(project, '.openprd', 'quality', 'reports', 'latest.json')), false);
  assert.ok(logs.some((line) => line.includes('旧任务里的 per-task openprd run . --verify')));
  assert.ok(logs.some((line) => line.includes('scope: task-only')));
});

test('openprd advances tasks by dependency order and verify command', async () => {
  const project = await makeTempProject();
  const changeDir = path.join(project, 'openspec', 'changes', 'desktop-rebuild');
  await fs.mkdir(changeDir, { recursive: true });
  await fs.writeFile(path.join(changeDir, 'tasks.md'), [
    '- [ ] T001.01 Prepare shell entry',
    '  - done: shell entry is ready',
    '  - verify: node -e "process.exit(0)"',
    '- [ ] T001.02 Wire shell window',
    '  - deps: T001.01',
    '  - done: shell window is wired',
    '  - verify: node -e "process.exit(0)"',
    '',
  ].join('\n'));

  const initial = await listOpenSpecTaskWorkspace(project, { change: 'desktop-rebuild' });
  assert.equal(initial.summary.total, 2);
  assert.equal(initial.nextTask.id, 'T001.01');

  await assert.rejects(
    () => advanceOpenSpecTaskWorkspace(project, { change: 'desktop-rebuild', item: 'T001.02' }),
    /被未完成任务阻塞/
  );

  const advanced = await advanceOpenSpecTaskWorkspace(project, {
    change: 'desktop-rebuild',
    item: 'T001.01',
    verify: true,
  });
  assert.equal(advanced.ok, true);
  assert.equal(advanced.advanced, true);
  assert.equal(advanced.nextTask.id, 'T001.02');

  const tasksText = await fs.readFile(path.join(changeDir, 'tasks.md'), 'utf8');
  assert.match(tasksText, /- \[x\] T001\.01 Prepare shell entry/);
  assert.match(tasksText, /- \[ \] T001\.02 Wire shell window/);

  const taskEvents = await fs.readFile(path.join(changeDir, 'task-events.jsonl'), 'utf8');
  assert.match(taskEvents, /"taskId":"T001.01"/);
});

test('openprd loop plans prompts and finishes one verified task', async () => {
  const project = await makeTempProject();
  const changeDir = await writeLoopProject(project);

  const init = await initLoopWorkspace(project, { agent: 'codex' });
  assert.equal(init.ok, true);
  assert.equal(init.featureList.policy.oneTaskPerSession, true);

  const planned = await planLoopWorkspace(project, { change: 'loop-demo' });
  assert.equal(planned.ok, true);
  assert.equal(planned.summary.total, 2);
  assert.equal(planned.next.id, 'T001.01');
  assert.equal(planned.next.taskHandle, 'loop-demo:T001.01:prepare-loop-state');
  assert.ok(planned.featureList.policy.executionModes.includes('parallel-workers'));
  assert.ok(planned.featureList.policy.coordinationRule.includes('main-agent'));
  assert.equal(planned.featureList.tasks[0].executionStrategy.ownerRole, 'worker');
  assert.ok(planned.featureList.tasks[0].executionStrategy.writeScope.length > 0);

  const status = await statusLoopWorkspace(project);
  assert.equal(status.next.id, 'T001.01');
  assert.equal(status.next.taskHandle, 'loop-demo:T001.01:prepare-loop-state');

  const next = await nextLoopWorkspace(project, { item: 'loop-demo:T001.02:launch-one-task-session' });
  assert.equal(next.dependencyState.ready, false);
  assert.deepEqual(next.dependencyState.incomplete, ['T001.01']);

  const prompt = await promptLoopWorkspace(project, { agent: 'codex' });
  assert.equal(prompt.ok, true);
  assert.equal(prompt.task.id, 'T001.01');
  assert.equal(prompt.task.taskHandle, 'loop-demo:T001.01:prepare-loop-state');
  assert.match(prompt.prompt, /不要开始下一个任务/);
  assert.match(prompt.prompt, /任务句柄: loop-demo:T001\.01:prepare-loop-state/);
  assert.match(prompt.prompt, /执行策略:/);
  assert.match(prompt.prompt, /写入范围:/);
  assert.match(prompt.prompt, /Computer Use/);
  assert.match(prompt.prompt, /Playwright/);
  assert.match(prompt.invocation.display, /codex exec --full-auto/);
  assert.ok(await fs.stat(path.join(project, prompt.promptPath)).then(() => true));

  const dryRun = await runLoopWorkspace(project, { agent: 'claude', dryRun: true });
  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.task.taskHandle, 'loop-demo:T001.01:prepare-loop-state');
  assert.match(dryRun.invocation.display, /claude --print/);
  const loopStateAfterDryRun = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'loop-state.json'), 'utf8'));
  assert.equal(loopStateAfterDryRun.currentTaskHandle, 'loop-demo:T001.01:prepare-loop-state');
  assert.equal(loopStateAfterDryRun.currentTaskTitle, 'Prepare loop state');

  const verify = await verifyLoopWorkspace(project, { item: 'loop-demo:T001.01:prepare-loop-state' });
  assert.equal(verify.ok, true);

  const finish = await finishLoopWorkspace(project, { item: 'loop-demo:T001.01:prepare-loop-state', commit: false });
  assert.equal(finish.ok, true);
  assert.equal(finish.summary.done, 1);
  assert.equal(finish.next.id, 'T001.02');
  assert.equal(finish.next.taskHandle, 'loop-demo:T001.02:launch-one-task-session');
  assert.equal(finish.testReport, path.join('.openprd', 'harness', 'test-reports', 'T001.01.md'));
  assert.equal(finish.regressionHtml, path.join('.openprd', 'harness', 'test-reports', 'T001.01.html'));
  assert.ok(await fs.stat(path.join(project, finish.testReport)).then(() => true));
  assert.ok(await fs.stat(path.join(project, finish.regressionHtml)).then(() => true));
  const regressionHtml = await fs.readFile(path.join(project, finish.regressionHtml), 'utf8');
  assert.ok(regressionHtml.includes('OpenPrd / 回归报告'));
  assert.ok(regressionHtml.includes('结构化回归结论'));
  assert.ok(regressionHtml.includes('justify-content: flex-start'));
  assert.match(regressionHtml, /<div class="qa-status-row">\s*<div class="status-badge mini-status status-pass">通过<\/div>/);

  const featureList = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'feature-list.json'), 'utf8'));
  assert.equal(featureList.tasks.find((task) => task.id === 'T001.01').status, 'done');
  assert.equal(featureList.tasks.find((task) => task.id === 'T001.02').status, 'pending');
  assert.equal(featureList.tasks.find((task) => task.id === 'T001.02').taskHandle, 'loop-demo:T001.02:launch-one-task-session');

  const tasksText = await fs.readFile(path.join(changeDir, 'tasks.md'), 'utf8');
  assert.match(tasksText, /- \[x\] T001\.01 Prepare loop state/);

  const sessions = await fs.readFile(path.join(project, '.openprd', 'harness', 'agent-sessions.jsonl'), 'utf8');
  assert.match(sessions, /"action":"run-dry-run"/);
  assert.match(sessions, /"taskHandle":"loop-demo:T001\.01:prepare-loop-state"/);
  assert.match(sessions, /"action":"finish"/);
  const loopStateAfterFinish = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'loop-state.json'), 'utf8'));
  assert.equal(loopStateAfterFinish.currentTaskHandle, 'loop-demo:T001.02:launch-one-task-session');
  assert.equal(loopStateAfterFinish.currentTaskTitle, 'Launch one-task session');
});


test('loop run can create an isolated worktree and record branch metadata', async () => {
  const project = await makeTempProject();
  await writeLoopProject(project, 'loop-worktree');

  for (const args of [
    ['init'],
    ['config', 'user.email', 'openprd@example.com'],
    ['config', 'user.name', 'OpenPrd Test'],
    ['add', '-A'],
    ['commit', '-m', 'initial'],
  ]) {
    const result = spawnSync('git', args, { cwd: project, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  await initLoopWorkspace(project, { agent: 'codex' });
  await planLoopWorkspace(project, { change: 'loop-worktree' });
  const worktreePath = path.join(path.dirname(project), 'loop-worktree-runner');

  const dryRun = await runLoopWorkspace(project, {
    agent: 'claude',
    dryRun: true,
    worktree: worktreePath,
    branch: 'loop/worktree-runner',
  });

  assert.equal(dryRun.ok, true);
  assert.equal(await fs.realpath(dryRun.projectRoot), await fs.realpath(worktreePath));
  assert.equal(dryRun.workspace.path, await fs.realpath(worktreePath));
  assert.equal(dryRun.workspace.branch, 'loop/worktree-runner');
  assert.equal(dryRun.workspace.created, true);
  const branchResult = spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' });
  assert.equal(branchResult.status, 0, branchResult.stderr || branchResult.stdout);
  assert.equal(branchResult.stdout.trim(), 'loop/worktree-runner');
  const loopState = JSON.parse(await fs.readFile(path.join(worktreePath, '.openprd', 'harness', 'loop-state.json'), 'utf8'));
  assert.equal(loopState.currentWorktreePath, await fs.realpath(worktreePath));
  assert.equal(loopState.currentBranch, 'loop/worktree-runner');
  assert.deepEqual(loopState.currentTaskBaselinePaths, []);
  const sessions = await readJsonl(path.join(worktreePath, '.openprd', 'harness', 'agent-sessions.jsonl'));
  const dryRunEvent = sessions.find((event) => event.action === 'run-dry-run');
  assert.equal(dryRunEvent.worktreePath, await fs.realpath(worktreePath));
  assert.equal(dryRunEvent.branch, 'loop/worktree-runner');
  assert.equal(dryRunEvent.createdWorktree, true);
});

test('loop finish blocks commit on a dirty main workspace unless explicitly allowed', async () => {
  const project = await makeTempProject();
  await writeLoopProject(project, 'loop-dirty-main');

  for (const args of [
    ['init'],
    ['config', 'user.email', 'openprd@example.com'],
    ['config', 'user.name', 'OpenPrd Test'],
    ['add', '-A'],
    ['commit', '-m', 'initial'],
  ]) {
    const result = spawnSync('git', args, { cwd: project, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  await initLoopWorkspace(project, { agent: 'codex' });
  await planLoopWorkspace(project, { change: 'loop-dirty-main' });
  const handlerPath = path.join(project, 'src', 'api', 'handler.js');
  const handlerText = await fs.readFile(handlerPath, 'utf8');
  await fs.writeFile(handlerPath, `${handlerText}\n// dirty main workspace change\n`);
  const prompt = await promptLoopWorkspace(project, { item: 'T001.01' });
  assert.equal(prompt.ok, true);

  const finish = await finishLoopWorkspace(project, { item: 'T001.01', commit: true });
  assert.equal(finish.ok, false);
  assert.match(finish.errors[0], /--allow-dirty-main/);
  assert.match(finish.errors[0], /--worktree\/--branch/);
});

test('loop finish commit scopes files inside an isolated worktree and records commit metadata', async () => {
  const project = await makeTempProject();
  await writeLoopProject(project, 'loop-isolated-commit');

  for (const args of [
    ['init'],
    ['config', 'user.email', 'openprd@example.com'],
    ['config', 'user.name', 'OpenPrd Test'],
    ['add', '-A'],
    ['commit', '-m', 'initial'],
  ]) {
    const result = spawnSync('git', args, { cwd: project, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  await initLoopWorkspace(project, { agent: 'codex' });
  await planLoopWorkspace(project, { change: 'loop-isolated-commit' });
  const worktreePath = path.join(path.dirname(project), 'loop-isolated-commit-wt');

  const prompt = await promptLoopWorkspace(project, {
    item: 'T001.01',
    worktree: worktreePath,
    branch: 'loop/isolation-test',
  });
  assert.equal(prompt.ok, true);

  const finish = await finishLoopWorkspace(project, {
    item: 'T001.01',
    commit: true,
    worktree: worktreePath,
    branch: 'loop/isolation-test',
  });
  assert.equal(finish.ok, true);
  assert.equal(finish.workspace.path, await fs.realpath(worktreePath));
  assert.equal(finish.workspace.branch, 'loop/isolation-test');
  assert.equal(finish.commit.branch, 'loop/isolation-test');
  assert.equal(finish.commit.worktreePath, await fs.realpath(worktreePath));
  assert.equal(finish.commit.commitPlan.stagedPaths.includes(path.join('openprd', 'changes', 'loop-isolated-commit', 'tasks.md')), true);
  assert.equal(finish.commit.commitPlan.excludedPaths.length, 0);

  const loopState = JSON.parse(await fs.readFile(path.join(worktreePath, '.openprd', 'harness', 'loop-state.json'), 'utf8'));
  assert.equal(loopState.currentWorktreePath, await fs.realpath(worktreePath));
  assert.equal(loopState.currentBranch, 'loop/isolation-test');
  assert.equal(loopState.lastCommitSha, finish.commit.sha);

  const report = await fs.readFile(path.join(worktreePath, finish.testReport), 'utf8');
  assert.match(report, /- 工作区: .*loop-isolated-commit-wt/);
  assert.match(report, /- 分支: loop\/isolation-test/);
  assert.match(report, new RegExp(`- 提交: ${finish.commit.sha}`));

  const sessions = await readJsonl(path.join(worktreePath, '.openprd', 'harness', 'agent-sessions.jsonl'));
  const finishEvent = sessions.find((event) => event.action === 'finish');
  assert.equal(finishEvent.worktreePath, await fs.realpath(worktreePath));
  assert.equal(finishEvent.branch, 'loop/isolation-test');
  assert.equal(finishEvent.commitSha, finish.commit.sha);

  const commitFiles = spawnSync('git', ['show', '--pretty=', '--name-only', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' });
  assert.equal(commitFiles.status, 0, commitFiles.stderr || commitFiles.stdout);
  const normalizedFiles = commitFiles.stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.equal(normalizedFiles.includes(path.join('openprd', 'changes', 'loop-isolated-commit', 'tasks.md')), true);
  const status = spawnSync('git', ['status', '--short'], { cwd: worktreePath, encoding: 'utf8' });
  assert.equal(status.status, 0, status.stderr || status.stdout);
  assert.equal(status.stdout.trim(), '');
});

test('loop finish with commit syncs version ledger items and keeps the local version tag on the latest commit', async () => {
  const project = await makeTempProject();
  await writeLoopProject(project, 'loop-release');

  for (const args of [
    ['init'],
    ['config', 'user.email', 'openprd@example.com'],
    ['config', 'user.name', 'OpenPrd Test'],
    ['add', '-A'],
    ['commit', '-m', 'initial'],
  ]) {
    const result = spawnSync('git', args, { cwd: project, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  const release = await releaseWorkspace(project, { setVersion: '0.1.23' });
  assert.equal(release.ok, true);
  {
    const commitRelease = spawnSync('git', ['add', '.openprd/state/release-ledger.json'], { cwd: project, encoding: 'utf8' });
    assert.equal(commitRelease.status, 0, commitRelease.stderr || commitRelease.stdout);
    const saveRelease = spawnSync('git', ['commit', '-m', 'record release ledger'], { cwd: project, encoding: 'utf8' });
    assert.equal(saveRelease.status, 0, saveRelease.stderr || saveRelease.stdout);
  }

  await initLoopWorkspace(project, { agent: 'codex' });
  await planLoopWorkspace(project, { change: 'loop-release' });

  const firstFinish = await finishLoopWorkspace(project, {
    item: 'loop-release:T001.01:prepare-loop-state',
    commit: true,
  });
  assert.equal(firstFinish.ok, true);
  assert.equal(firstFinish.projectRelease.version, '0.1.23');
  assert.equal(firstFinish.projectRelease.tag.tagName, '0.1.23');
  let tagSha = spawnSync('git', ['rev-parse', '--short', '0.1.23'], { cwd: project, encoding: 'utf8' });
  assert.equal(tagSha.status, 0, tagSha.stderr || tagSha.stdout);
  assert.equal(tagSha.stdout.trim(), firstFinish.commit.sha);

  const secondFinish = await finishLoopWorkspace(project, {
    item: 'loop-release:T001.02:launch-one-task-session',
    commit: true,
  });
  assert.equal(secondFinish.ok, true);
  assert.equal(secondFinish.projectRelease.version, '0.1.23');
  assert.equal(secondFinish.projectRelease.tag.tagName, '0.1.23');
  tagSha = spawnSync('git', ['rev-parse', '--short', '0.1.23'], { cwd: project, encoding: 'utf8' });
  assert.equal(tagSha.status, 0, tagSha.stderr || tagSha.stdout);
  assert.equal(tagSha.stdout.trim(), secondFinish.commit.sha);
  assert.notEqual(secondFinish.commit.sha, firstFinish.commit.sha);

  const ledger = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'state', 'release-ledger.json'), 'utf8'));
  const version = ledger.versions.find((item) => item.version === '0.1.23');
  assert.ok(version);
  assert.equal(version.items.length >= 2, true);
  assert.equal(version.tag.name, '0.1.23');
});

test('loop run preflights Codex and stops before child session when optional dependency is missing', async () => {
  const project = await makeTempProject();
  await writeLoopProject(project, 'loop-codex-preflight');
  await initLoopWorkspace(project, { agent: 'codex' });
  await planLoopWorkspace(project, { change: 'loop-codex-preflight' });
  const agentCalls = [];

  const result = await runLoopWorkspace(project, {
    agent: 'codex',
    codexRunCommand: async () => ({
      ok: false,
      exitCode: 1,
      stdout: '',
      stderr: 'Error: Missing optional dependency @openai/codex-darwin-arm64.',
    }),
    agentRunCommand: async (command, args) => {
      agentCalls.push({ command, args });
      return { ok: true, status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(agentCalls.length, 0);
  assert.equal(result.preflight.diagnostic.type, 'missing-optional-dependency');
  assert.equal(result.preflight.diagnostic.missingPackage, '@openai/codex-darwin-arm64');
  assert.equal(result.repairAttempted, false);
  assert.ok(result.errors.some((error) => error.includes('npm install -g @openai/codex@latest')));
  const sessions = await readJsonl(path.join(project, '.openprd', 'harness', 'agent-sessions.jsonl'));
  assert.equal(sessions.some((event) => event.action === 'agent-preflight-failed'), true);
  assert.equal(sessions.some((event) => event.action === 'run'), false);
});

test('loop repair-agent explicitly repairs Codex then launches the child session', async () => {
  const project = await makeTempProject();
  await writeLoopProject(project, 'loop-codex-repair');
  await initLoopWorkspace(project, { agent: 'codex' });
  await planLoopWorkspace(project, { change: 'loop-codex-repair' });
  const codexCalls = [];
  const agentCalls = [];

  const result = await runLoopWorkspace(project, {
    agent: 'codex',
    repairAgent: true,
    commit: false,
    codexRunCommand: async (command, args) => {
      codexCalls.push({ command, args });
      if (codexCalls.length === 1) {
        return {
          ok: false,
          exitCode: 1,
          stdout: '',
          stderr: 'Error: Missing optional dependency @openai/codex-darwin-arm64.',
        };
      }
      if (codexCalls.length === 2) {
        return { ok: true, exitCode: 0, stdout: 'installed\n', stderr: '' };
      }
      return { ok: true, exitCode: 0, stdout: 'codex 0.200.0\n', stderr: '' };
    },
    agentRunCommand: async (command, args, options = {}) => {
      agentCalls.push({ command, args, stdin: options.stdin });
      return { ok: true, status: 0, stdout: 'agent ok\n', stderr: '' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.repairAttempted, true);
  assert.deepEqual(codexCalls.map((call) => call.command), ['codex', 'npm', 'codex']);
  assert.equal(agentCalls.length, 1);
  assert.equal(agentCalls[0].command, 'codex');
  assert.deepEqual(agentCalls[0].args.slice(0, 2), ['exec', '--full-auto']);
  assert.ok(agentCalls[0].stdin.includes('OpenPrd 长程单任务执行会话'));
  assert.equal(result.finish.ok, true);
  const sessions = await readJsonl(path.join(project, '.openprd', 'harness', 'agent-sessions.jsonl'));
  assert.equal(sessions.some((event) => event.action === 'run' && event.preflight?.repairAttempted === true), true);
  assert.equal(sessions.some((event) => event.action === 'agent-exit' && event.ok === true), true);
});

test('loop finish blocks the final task when EVO quality is not production-ready', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  const changeDir = path.join(project, 'openprd', 'changes', 'loop-evo');
  await fs.mkdir(path.join(changeDir, 'specs', 'loop-evo'), { recursive: true });
  await fs.writeFile(path.join(changeDir, 'proposal.md'), [
    '# Proposal',
    '',
    '## Why',
    'Final delivery must not skip EVO quality.',
    '',
    '## What Changes',
    '- `loop-evo`: Add a final quality gate.',
    '',
    '## Impact',
    'Loop completion now depends on production-ready evidence.',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'specs', 'loop-evo', 'spec.md'), [
    '# loop-evo 规格',
    '',
    '## ADDED Requirements',
    '',
    '### Requirement: 最终 Loop 任务必须通过 EVO 质量',
    '最后一个任务完成前必须通过 OpenPrd 质量评估。',
    '',
    '#### Scenario: Agent 完成最终任务',
    '- **WHEN** 最后一项任务自测通过',
    '- **THEN** 系统还会检查 production-ready 质量报告',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'tasks.md'), [
    '- [ ] T001.01 Finish final task',
    '  - done: final task is ready',
    '  - verify: node -e "process.exit(0)"',
    '',
  ].join('\n'));

  await initLoopWorkspace(project, { agent: 'codex' });
  await planLoopWorkspace(project, { change: 'loop-evo' });
  const finish = await finishLoopWorkspace(project, { item: 'T001.01', commit: false });

  assert.equal(finish.ok, false);
  assert.ok(finish.errors.some((error) => error.includes('Final EVO quality gate')));
  assert.equal(finish.quality.report.readiness.productionReady, false);
  assert.ok(finish.quality.report.readiness.attentionGates.includes('smoke'));
  const featureList = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'feature-list.json'), 'utf8'));
  assert.equal(featureList.tasks.find((task) => task.id === 'T001.01').status, 'failed');
});
