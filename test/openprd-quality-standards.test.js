import test from 'node:test';
import { reviewKnowledgeWorkspace } from '../src/knowledge.js';
import {
  buildCodeExtensionCandidate,
  initGrowthWorkspace,
  observeGrowthWorkspace,
} from '../src/growth.js';

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
  visualPrepareWorkspace,
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
import {
  detectVisualReview,
  listVisualReviewArtifacts,
} from '../src/quality-visual-review.js';

test('quality verify writes html eval report and learn creates experience skill', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    type: 'module',
    scripts: {
      test: 'node --test',
      'test:smoke': 'node --test smoke.test.js',
      'perf:k6': 'k6 run perf.js',
    },
    dependencies: {
      '@opentelemetry/api': '^1.0.0',
      pino: '^9.0.0',
    },
  }, null, 2)}\n`);
  await fs.mkdir(path.join(project, 'src', 'api'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'api', 'handler.js'), 'export function handler(req) { console.log({ trace_id: req.trace_id, span_id: req.span_id, request_id: req.request_id, task_id: req.task_id, user_session_id: req.user_session_id, error_id: req.error_id }); }\n');
  await fs.mkdir(path.join(project, 'test', 'fixtures'), { recursive: true });
  await fs.writeFile(path.join(project, 'test', 'fixtures', 'extreme.json'), '{"items":[1,2,3]}\n');
  await fs.mkdir(path.join(project, '.openprd', 'harness', 'test-reports'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'test-reports', 'evo-smoke.md'), [
    '# EVO smoke report',
    '',
    '- smoke: passed main flow',
    '- feature coverage: no active change',
    '',
  ].join('\n'));

  const initQuality = await initQualityWorkspace(project);
  assert.equal(initQuality.ok, true);
  assert.equal(initQuality.changed, 'unchanged');

  const quality = await verifyQualityWorkspace(project);
  assert.equal(quality.ok, true);
  assert.ok(quality.reportPath.endsWith('.json'));
  assert.ok(quality.htmlPath.endsWith('.html'));
  assert.equal(quality.report.observability.centralizedTools.includes('@opentelemetry/'), true);
  assert.equal(quality.report.gates.some((gate) => gate.id === 'business-guardrails' && gate.status === 'pass'), true);
  assert.equal(quality.report.evalHarness.smoke.present, true);
  assert.equal(quality.report.evalHarness.performance.present, true);
  assert.equal(quality.report.evalHarness.extremeData.present, true);
  assert.deepEqual(quality.report.qualityPolicy.requiredGates, ['smoke', 'feature-coverage', 'knowledge', 'growth']);
  assert.equal(quality.report.readiness.productionReady, true);
  assert.equal(quality.knowledgeReview.skipped, false);
  assert.equal(quality.knowledgeReview.status, 'pending-review');
  assert.ok(quality.knowledgeReview.userFacingExperience.message.includes('这次我观察到一个以后可能重复出现的情况：'));
  assert.ok(quality.knowledgeReview.userFacingExperience.message.includes('这条经验只会保留在当前项目里。'));
  assert.ok(quality.knowledgeReview.userFacingExperience.question?.includes('要我把它一起保留下来吗'));
  assert.equal(quality.growthCheckpoint.recorded || quality.growthCheckpoint.reason === 'duplicate-checkpoint', true);
  assert.equal(quality.report.gates.some((gate) => gate.id === 'knowledge' && gate.status === 'pass'), true);
  assert.equal(quality.report.gates.some((gate) => gate.id === 'growth' && gate.status === 'pass'), true);
  assert.equal(Number(quality.report.growth.summary.completionCheckpoints ?? 0) >= 1, true);
  const html = await fs.readFile(quality.htmlPath, 'utf8');
  assert.ok(html.includes('回归结论概览'));
  assert.ok(html.includes('回归流程图'));
  assert.ok(html.includes('冒烟测试'));
  assert.ok(html.includes('风险复核'));
  assert.ok(html.includes('测试覆盖图'));
  assert.ok(html.includes('本期必测结果'));
  assert.ok(html.includes('需要处理 / 需确认'));
  assert.ok(html.includes('验证材料'));
  assert.ok(html.includes('执行环境与覆盖'));
  assert.ok(html.includes('需求模块'));
  assert.ok(html.includes('更多细节'));
  assert.ok(html.includes('需要补测'));
  assert.ok(html.includes('认可回归'));
  assert.ok(html.includes('给 Agent 的质量报告框架'));
  assert.ok(html.includes('证据链'));
  assert.ok(html.includes('业务成本与滥用护栏'));
  assert.ok(html.includes('经验沉淀'));
  assert.ok(html.includes('附录：结构化 JSON、基线和扫描细节'));

  const learned = await learnQualityWorkspace(project, { from: quality.reportPath });
  assert.equal(learned.ok, true);
  assert.ok(learned.files.skill.endsWith('SKILL.md'));
  assert.doesNotMatch(learned.skillName, /eval-/);
  assert.doesNotMatch(learned.skillName, /candidate-eval-/);
  const skill = await fs.readFile(learned.files.skill, 'utf8');
  assert.match(skill, /description:\s*Use when /);
  assert.ok(skill.includes('## 触发条件'));
  assert.ok(skill.includes('## 适用范围'));
  assert.ok(skill.includes('## 典型输入'));
  assert.ok(skill.includes('## 典型输出'));
  assert.ok(skill.includes('## 不要直接套用'));
  assert.ok(skill.includes('## 关联字段'));
  assert.ok(skill.includes('## 先看哪些证据'));
  assert.doesNotMatch(skill, /\.openprd\/quality\/reports\//);
  assert.doesNotMatch(skill, /candidate-eval-/);
  const index = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'knowledge', 'index.json'), 'utf8'));
  assert.equal(index.skills[0].skillName, learned.skillName);
});

test('knowledge review reuses the same candidate id within one turn instead of promoting a later weaker doc-only candidate', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.mkdir(path.join(project, 'docs', 'basic'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'main.js'), 'export const main = true;\n');
  await fs.writeFile(path.join(project, 'docs', 'basic', 'learning.md'), '# learning\n');

  const turnStatePath = path.join(project, '.openprd', 'harness', 'turn-state.json');
  await fs.writeFile(turnStatePath, `${JSON.stringify({
    version: 1,
    id: 'turn-knowledge-reuse',
    prompt: '继续把这轮实现收口，并整理成后续可复用经验。',
    touchedFiles: ['src/main.js'],
    reviewSignals: [
      {
        id: 'run-verify-pass',
        kind: 'run-verify',
        ok: true,
        productionReady: true,
        summary: 'current task is ready for reuse',
        touchedFiles: ['src/main.js'],
      },
    ],
  }, null, 2)}\n`);

  const firstReview = await reviewKnowledgeWorkspace(project, {
    from: '.openprd/harness/turn-state.json',
    touchedFiles: ['src/main.js'],
    signal: {
      id: 'run-verify-pass',
      kind: 'run-verify',
      ok: true,
      productionReady: true,
      summary: 'current task is ready for reuse',
      touchedFiles: ['src/main.js'],
    },
  });
  assert.equal(firstReview.ok, true);
  assert.equal(firstReview.skipped, false);

  await fs.writeFile(turnStatePath, `${JSON.stringify({
    version: 1,
    id: 'turn-knowledge-reuse',
    knowledgeCandidateId: firstReview.candidateId,
    prompt: '继续把这轮实现收口，并整理成后续可复用经验。',
    touchedFiles: ['docs/basic/learning.md'],
    reviewSignals: [
      {
        id: 'run-verify-pass-docs',
        kind: 'run-verify',
        ok: true,
        productionReady: true,
        summary: 'docs follow-up is also ready',
        touchedFiles: ['docs/basic/learning.md'],
      },
    ],
  }, null, 2)}\n`);

  const secondReview = await reviewKnowledgeWorkspace(project, {
    from: '.openprd/harness/turn-state.json',
    touchedFiles: ['docs/basic/learning.md'],
    signal: {
      id: 'run-verify-pass-docs',
      kind: 'run-verify',
      ok: true,
      productionReady: true,
      summary: 'docs follow-up is also ready',
      touchedFiles: ['docs/basic/learning.md'],
    },
  });
  assert.equal(secondReview.ok, true);
  assert.equal(secondReview.skipped, false);
  assert.equal(secondReview.candidateId, firstReview.candidateId);
  assert.doesNotMatch(secondReview.skillName, /learning/);
});

test('quality learn can digest diagnostic bundles and observability recognizes diagnostic surfaces', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    type: 'module',
    scripts: {
      test: 'node --test',
      'test:smoke': 'node --test smoke.test.js',
      'perf:k6': 'k6 run perf.js',
    },
    dependencies: {
      pino: '^9.0.0',
    },
  }, null, 2)}\n`);
  await fs.mkdir(path.join(project, 'src', 'runtime'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'runtime', 'diagnostics.js'), [
    'export function appendRuntimeEvent(event) {',
    '  return {',
    '    event: event.event,',
    '    trace_id: event.trace_id,',
    '    span_id: event.span_id,',
    '    request_id: event.request_id,',
    '    task_id: event.task_id,',
    '    user_session_id: event.user_session_id,',
    '    error_id: event.error_id,',
    '  };',
    '}',
    '',
    'export function exportDiagnostics(snapshot) {',
    '  return {',
    '    runtimeEvents: snapshot.runtimeEvents,',
    '    timeline: snapshot.timeline,',
    '    rootCauseCandidates: snapshot.rootCauseCandidates,',
    '    diagnosticReport: snapshot.diagnosticReport,',
    '  };',
    '}',
    '',
  ].join('\n'));
  await fs.mkdir(path.join(project, 'test', 'fixtures'), { recursive: true });
  await fs.writeFile(path.join(project, 'test', 'fixtures', 'extreme.json'), '{"items":[1,2,3]}\n');
  await fs.mkdir(path.join(project, '.openprd', 'harness', 'test-reports'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'test-reports', 'bundle-smoke.md'), [
    '# Bundle smoke report',
    '',
    '- smoke: passed channel delivery flow',
    '- feature coverage: no active change',
    '',
  ].join('\n'));

  const quality = await verifyQualityWorkspace(project);
  assert.equal(quality.ok, true);
  assert.equal(quality.report.observability.status, 'pass');
  assert.ok(quality.report.observability.diagnosticSurfaces.includes('runtime-events'));
  assert.ok(quality.report.observability.diagnosticSurfaces.includes('diagnostic-report'));

  const diagnosticsDir = path.join(project, 'diagnostics', 'incident-channel-delivery');
  await fs.mkdir(path.join(diagnosticsDir, 'runtime-events'), { recursive: true });
  await fs.mkdir(path.join(diagnosticsDir, 'timeline'), { recursive: true });
  await fs.writeFile(path.join(diagnosticsDir, 'diagnostic-report.json'), `${JSON.stringify({
    schema: 'project.diagnostic-report.v1',
    title: 'Channel delivery failed after login reuse',
    status: 'needs-attention',
    summary: {
      headline: 'delivery flow stalled after session reuse',
      status: 'needs-attention',
    },
    problem: 'Message delivery stops after the channel session expires.',
    rootCauseCandidates: [
      {
        title: 'Channel session expired',
        evidence: ['runtime-events captured channel.auth.expired before delivery retry'],
        nextSteps: ['refresh the channel session', 'retry the delivery path'],
      },
    ],
  }, null, 2)}\n`);
  await fs.writeFile(path.join(diagnosticsDir, 'root-cause-candidates.json'), `${JSON.stringify([
    {
      title: 'Channel session expired',
      category: 'auth',
      evidence: ['timeline shows auth expired before channel.delivery.failed'],
      nextSteps: ['refresh the channel session', 'verify retry logs stay correlated'],
    },
  ], null, 2)}\n`);
  await fs.writeFile(path.join(diagnosticsDir, 'runtime-events', 'events.jsonl'), [
    JSON.stringify({
      event: 'channel.delivery.start',
      trace_id: 'trace-1',
      span_id: 'span-1',
      request_id: 'req-1',
      task_id: 'task-1',
      user_session_id: 'user-1',
      error_id: 'err-1',
    }),
    JSON.stringify({
      event: 'channel.auth.expired',
      trace_id: 'trace-1',
      span_id: 'span-2',
      request_id: 'req-1',
      task_id: 'task-1',
      user_session_id: 'user-1',
      error_id: 'err-1',
    }),
    JSON.stringify({
      event: 'channel.delivery.failed',
      trace_id: 'trace-1',
      span_id: 'span-3',
      request_id: 'req-1',
      task_id: 'task-1',
      user_session_id: 'user-1',
      error_id: 'err-1',
    }),
  ].join('\n') + '\n');
  await fs.writeFile(path.join(diagnosticsDir, 'timeline', 'timeline.json'), `${JSON.stringify([
    { event: 'channel.delivery.start', ts: '2026-05-24T10:00:00.000Z' },
    { event: 'channel.auth.expired', ts: '2026-05-24T10:00:01.000Z' },
    { event: 'channel.delivery.failed', ts: '2026-05-24T10:00:02.000Z' },
  ], null, 2)}\n`);

  const learned = await learnQualityWorkspace(project, { from: diagnosticsDir });
  assert.equal(learned.ok, true);
  assert.equal(learned.sourceKind, 'diagnostic-bundle');

  const incident = JSON.parse(await fs.readFile(learned.files.incident, 'utf8'));
  assert.equal(incident.sourceKind, 'diagnostic-bundle');
  assert.ok(incident.correlationFields.includes('trace_id'));
  assert.ok(incident.correlationFields.includes('request_id'));
  assert.deepEqual(incident.missingCorrelationFields, []);
  assert.ok(incident.eventNames.includes('channel.delivery.failed'));
  assert.ok(incident.rootCauseCandidates.some((item) => item.title === 'Channel session expired'));

  const pattern = JSON.parse(await fs.readFile(learned.files.pattern, 'utf8'));
  assert.ok(pattern.preferredEvidenceOrder.includes('runtime-events'));
  assert.ok(pattern.rootCauseLabels.includes('Channel session expired'));

  const skill = await fs.readFile(learned.files.skill, 'utf8');
  assert.ok(skill.includes('## 关联字段'));
  assert.ok(skill.includes('runtime-events'));
  assert.ok(skill.includes('channel.delivery.failed'));

  const index = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'knowledge', 'index.json'), 'utf8'));
  assert.equal(index.skills[0].sourceKind, 'diagnostic-bundle');
});

test('quality ignores generated tmp and build trees when sampling traceability sources', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), `${JSON.stringify({
    version: 1,
    activeChange: null,
    changes: {},
  }, null, 2)}\n`);
  await fs.writeFile(path.join(project, '.openprd', 'discovery', 'config.json'), `${JSON.stringify({
    activeChange: null,
    taskSharding: {
      maxItemsPerFile: 25,
      handoffRequired: true,
      firstFile: 'tasks.md',
      nextFilePattern: 'tasks-###.md',
    },
    taskMetadata: {
      stableIdPattern: 'T###.##',
      required: ['done', 'verify'],
      optional: ['deps', 'type'],
      dependencyOrder: 'dependencies must appear before dependents',
    },
  }, null, 2)}\n`);
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    type: 'module',
    scripts: {
      'test:smoke': 'node --test smoke.test.js',
      'perf:k6': 'k6 run perf.js',
    },
    dependencies: {
      '@opentelemetry/api': '^1.0.0',
    },
  }, null, 2)}\n`);
  await fs.mkdir(path.join(project, 'docs', 'basic'), { recursive: true });
  await fs.writeFile(path.join(project, 'docs', 'basic', 'backend-structure.md'), [
    '# Backend structure',
    '',
    '- observability correlation fields: trace_id, span_id, request_id, task_id, user_session_id, error_id.',
    '',
  ].join('\n'));
  await fs.mkdir(path.join(project, 'test', 'fixtures'), { recursive: true });
  await fs.writeFile(path.join(project, 'test', 'fixtures', 'extreme.json'), '{"items":[1,2,3]}\n');
  await fs.mkdir(path.join(project, '.openprd', 'harness', 'test-reports'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'test-reports', 'smoke.md'), [
    '# smoke evidence',
    '',
    '- smoke: passed main flow.',
    '- feature coverage: no active change.',
    '',
  ].join('\n'));
  await fs.mkdir(path.join(project, '.tmp', 'generated'), { recursive: true });
  for (let index = 0; index < 650; index += 1) {
    await fs.writeFile(
      path.join(project, '.tmp', 'generated', `sample-${String(index).padStart(4, '0')}.md`),
      `# generated ${index}\n\nplaceholder artifact\n`,
    );
  }

  const quality = await verifyQualityWorkspace(project);
  assert.equal(quality.ok, true);
  assert.equal(quality.report.observability.status, 'pass');
  assert.deepEqual(quality.report.observability.missingCorrelation, []);
  assert.equal(quality.report.readiness.productionReady, true);
});

test('quality requires current smoke evidence and run verify separates task readiness from workspace debt', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), `${JSON.stringify({
    version: 1,
    activeChange: null,
    changes: {},
  }, null, 2)}\n`);
  await fs.writeFile(path.join(project, '.openprd', 'discovery', 'config.json'), `${JSON.stringify({
    activeChange: null,
    taskSharding: {
      maxItemsPerFile: 25,
      handoffRequired: true,
      firstFile: 'tasks.md',
      nextFilePattern: 'tasks-###.md',
    },
    taskMetadata: {
      stableIdPattern: 'T###.##',
      required: ['done', 'verify'],
      optional: ['deps', 'type'],
      dependencyOrder: 'dependencies must appear before dependents',
    },
  }, null, 2)}\n`);
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    type: 'module',
    scripts: {
      'test:smoke': 'node --test smoke.test.js',
    },
  }, null, 2)}\n`);

  const quality = await verifyQualityWorkspace(project);
  const smokeGate = quality.report.gates.find((gate) => gate.id === 'smoke');
  assert.equal(quality.ok, false);
  assert.equal(quality.report.readiness.productionReady, false);
  assert.equal(smokeGate.required, true);
  assert.equal(smokeGate.status, 'needs-evidence');

  const verified = await runWorkspace(project, { verify: true });
  const qualityCheck = verified.checks.find((check) => check.name === 'quality');
  assert.equal(verified.ok, true);
  assert.equal(verified.readiness.taskReady, true);
  assert.equal(verified.readiness.workspaceReady, false);
  assert.equal(qualityCheck.ok, false);
  assert.equal(qualityCheck.productionReady, false);
  assert.equal(verified.errors.length, 0);
  assert.ok(verified.warnings.some((warning) => warning.includes('quality still needs evidence for: smoke')));
  assert.ok(qualityCheck.errors.some((error) => error.includes('quality still needs evidence for: smoke')));
});

test('run verify describes feature-coverage debt as task ledger attention instead of task failure', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    type: 'module',
    scripts: {
      'test:smoke': 'node --test smoke.test.js',
    },
  }, null, 2)}\n`);
  await fs.mkdir(path.join(project, '.openprd', 'quality', 'evidence'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'quality', 'evidence', 'smoke.md'), [
    '# smoke evidence',
    '',
    '- smoke: passed main flow.',
    '',
  ].join('\n'));
  await writeMinimalChange(project, 'ledger-gap', {
    title: 'Ledger Gap',
    requirementTitle: 'Ledger gap follow-up',
    taskTitle: 'Close the remaining feature coverage ledger',
  });
  await fs.writeFile(path.join(project, 'openprd', 'changes', 'ledger-gap', 'tasks.md'), [
    '# Tasks',
    '',
    '- [x] T001.01 Ship the current endpoint',
    '  - type: implementation',
    '  - done: endpoint is implemented and locally verified',
    '  - verify: pnpm test:smoke',
    '- [ ] T001.02 Record the remaining coverage evidence',
    '  - type: governance',
    '  - done: feature coverage evidence is recorded for the remaining task',
    '  - verify: openprd tasks . --change ledger-gap --advance --verify --item T001.02',
    '- [ ] T001.03 Capture the dependent follow-up note',
    '  - type: governance',
    '  - deps: T001.02',
    '  - done: dependent follow-up note is recorded after the remaining evidence is captured',
    '  - verify: openprd tasks . --change ledger-gap --advance --verify --item T001.03',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(project, 'openprd', 'changes', 'ledger-gap', 'specs', 'ledger-gap', 'spec.md'), [
    '## ADDED Requirements',
    '',
    '### Requirement: Ledger gap follow-up',
    'The remaining feature coverage evidence must be recorded before workspace-wide readiness is claimed.',
    '',
    '#### Scenario: Coverage ledger remains pending',
    '- **WHEN** implementation is complete but one task ledger entry is still pending',
    '- **THEN** run verify reports task readiness separately from workspace attention',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), `${JSON.stringify({
    version: 1,
    activeChange: 'ledger-gap',
    changes: {
      'ledger-gap': { id: 'ledger-gap', status: 'active' },
    },
  }, null, 2)}\n`);

  const quality = await verifyQualityWorkspace(project);
  const featureCoverageGate = quality.report.gates.find((gate) => gate.id === 'feature-coverage');
  const strategyTask = quality.report.evalHarness.testStrategy.tasks.find((task) => task.id === 'T001.01');
  assert.equal(quality.report.readiness.productionReady, false);
  assert.deepEqual(quality.report.readiness.attentionGates, ['feature-coverage']);
  assert.equal(quality.report.evalHarness.featureCoverage.activeTasks.pending, 2);
  assert.equal(quality.report.evalHarness.featureCoverage.activeTasks.blocked, 1);
  assert.equal(strategyTask?.done, true);
  assert.ok(featureCoverageGate?.warnings?.[0].includes('不等于当前实现失败'));
  assert.ok(quality.errors.some((error) => error.includes('不等于当前实现失败')));

  const verified = await runWorkspace(project, { verify: true });
  const qualityCheck = verified.checks.find((check) => check.name === 'quality');
  assert.equal(verified.ok, true);
  assert.equal(verified.readiness.taskReady, true);
  assert.equal(verified.readiness.workspaceReady, false);
  assert.equal(qualityCheck.ok, false);
  assert.equal(verified.workspaceAttention?.kind, 'feature-coverage-ledger');
  assert.equal(verified.workspaceAttention?.activeChange, 'ledger-gap');
  assert.equal(verified.workspaceAttention?.pending, 2);
  assert.equal(verified.workspaceAttention?.blocked, 1);
  assert.ok(verified.workspaceAttention?.detail.includes('task bookkeeping or coverage evidence is incomplete'));
  assert.ok(verified.warnings.some((warning) => warning.includes('task bookkeeping or coverage evidence is incomplete')));
  assert.ok(qualityCheck.errors.some((error) => error.includes('不等于当前实现失败') || error.includes('task bookkeeping or coverage evidence is incomplete')));
});

test('quality requires reference-driven visual evidence for frontend changes', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), `${JSON.stringify({
    version: 1,
    activeChange: 'settings-visual-refresh',
    changes: {},
  }, null, 2)}\n`);
  const changeDir = path.join(project, 'openprd', 'changes', 'settings-visual-refresh');
  await fs.mkdir(path.join(changeDir, 'specs', 'settings-visual-refresh'), { recursive: true });
  await fs.writeFile(path.join(changeDir, 'proposal.md'), [
    '# Proposal',
    '',
    '## Why',
    '设置页面需要按参考图和设计稿做一次明显的界面改版。',
    '',
    '## What Changes',
    '- Refresh the settings page UI using the provided reference image and design mockup.',
    '',
    '## Impact',
    '- 页面布局、视觉层级和主要交互密度需要与参考图对齐。',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'specs', 'settings-visual-refresh', 'spec.md'), [
    '# settings-visual-refresh spec',
    '',
    '## ADDED Requirements',
    '',
    '### Requirement: 设置页面视觉还原需要对照参考图',
    '实现阶段必须对照参考图和设计稿完成视觉比对。',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'tasks.md'), [
    '- [x] T001.01 Refresh settings page visual layout',
    '  - type: implementation',
    '  - done: settings page matches the provided reference image and design mockup',
    '  - verify: openprd tasks . --change settings-visual-refresh --item T001.01 --evidence-required',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    type: 'module',
    scripts: {
      'test:smoke': 'node --test smoke.test.js',
    },
  }, null, 2)}\n`);
  await fs.mkdir(path.join(project, '.openprd', 'harness', 'test-reports'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'test-reports', 'smoke.md'), [
    '# smoke evidence',
    '',
    '- smoke: passed settings main flow.',
    '- feature coverage: openprd tasks done.',
    '',
  ].join('\n'));

  const missing = await verifyQualityWorkspace(project);
  const missingGate = missing.report.gates.find((gate) => gate.id === 'visual-review');
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.report.qualityPolicy.requiredGates, ['smoke', 'feature-coverage', 'visual-review', 'knowledge', 'growth']);
  assert.equal(missing.report.visualReview.relevant, true);
  assert.equal(missing.report.visualReview.expectsReferenceCompare, true);
  assert.equal(missingGate.required, true);
  assert.equal(missingGate.status, 'needs-evidence');

  const before = path.join(project, 'before.png');
  const after = path.join(project, 'after.png');
  await sharp({
    create: {
      width: 180,
      height: 120,
      channels: 3,
      background: '#d97706',
    },
  }).png().toFile(before);
  await sharp({
    create: {
      width: 180,
      height: 120,
      channels: 3,
      background: '#2563eb',
    },
  }).png().toFile(after);
  const beforeAfter = await visualCompareWorkspace(project, {
    before,
    after,
    maxPanelWidth: 100,
  });
  assert.ok(beforeAfter.metadataPath.endsWith('.json'));
  const beforeAfterGate = (await verifyQualityWorkspace(project)).report.gates.find((gate) => gate.id === 'visual-review');
  assert.equal(beforeAfterGate.status, 'needs-evidence');

  const reference = path.join(project, 'reference.png');
  const actual = path.join(project, 'actual.png');
  await sharp({
    create: {
      width: 180,
      height: 120,
      channels: 3,
      background: '#111827',
    },
  }).png().toFile(reference);
  await sharp({
    create: {
      width: 180,
      height: 120,
      channels: 3,
      background: '#10b981',
    },
  }).png().toFile(actual);
  const compare = await visualCompareWorkspace(project, {
    reference,
    actual,
    maxPanelWidth: 100,
  });
  const compareMetadata = JSON.parse(await fs.readFile(compare.metadataPath, 'utf8'));
  assert.equal(compareMetadata.schema, 'openprd.visual-review.v1');
  assert.equal(compareMetadata.mode, 'reference-actual');

  const passed = await verifyQualityWorkspace(project);
  const visualGate = passed.report.gates.find((gate) => gate.id === 'visual-review');
  assert.equal(passed.ok, true);
  assert.equal(passed.report.readiness.productionReady, true);
  assert.equal(visualGate.status, 'pass');
  assert.equal(visualGate.evidence.present, true);
  assert.ok(visualGate.evidence.sources.some((source) => source.path.endsWith(path.basename(compare.outputPath))));
});

test('high-risk hook blocks on workspace debt without reframing it as task failure', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  const fakeCodexBin = await writeFakeCodexBin(project);
  await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), `${JSON.stringify({
    version: 1,
    activeChange: null,
    changes: {},
  }, null, 2)}\n`);
  await fs.writeFile(path.join(project, '.openprd', 'discovery', 'config.json'), `${JSON.stringify({
    activeChange: null,
    taskSharding: {
      maxItemsPerFile: 25,
      handoffRequired: true,
      firstFile: 'tasks.md',
      nextFilePattern: 'tasks-###.md',
    },
    taskMetadata: {
      stableIdPattern: 'T###.##',
      required: ['done', 'verify'],
      optional: ['deps', 'type'],
      dependencyOrder: 'dependencies must appear before dependents',
    },
  }, null, 2)}\n`);
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    type: 'module',
    scripts: {
      'test:smoke': 'node --test smoke.test.js',
    },
  }, null, 2)}\n`);

  const hookResult = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), 'PreToolUse'], {
    cwd: project,
    input: JSON.stringify({
      cwd: project,
      tool_input: {
        cmd: 'git commit -m "test"',
      },
    }),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeCodexBin}${path.delimiter}${process.env.PATH}`,
      OPENPRD_CLI: path.resolve('openprd/bin/openprd.js'),
    },
  });
  assert.equal(hookResult.status, 0);
  const hookPayload = JSON.parse(hookResult.stdout);
  assert.equal(hookPayload.decision, 'block');
  assert.ok(hookPayload.reason.includes('workspace is not fully ready'));
  assert.ok(hookPayload.reason.includes('quality attention gates: smoke'));
  assert.ok(hookPayload.reason.includes('resolve the workspace-level debt'));
});

test('quality does not treat OpenPRD freeze and handoff wording as a release gate', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    scripts: {
      'test:smoke': 'node --test test/smoke.test.js',
    },
  }, null, 2)}\n`);
  await fs.mkdir(path.join(project, 'openprd', 'changes', 'habit-check-cli'), { recursive: true });
  await fs.writeFile(path.join(project, 'openprd', 'changes', 'habit-check-cli', 'tasks.md'), [
    '# Tasks',
    '',
    '- [x] freeze 后生成任务拆解',
    '- [x] handoff 前确认 smoke evidence',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), `${JSON.stringify({
    activeChange: 'habit-check-cli',
  }, null, 2)}\n`);
  await fs.mkdir(path.join(project, '.openprd', 'quality', 'evidence'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'quality', 'evidence', 'smoke.md'), [
    '# smoke evidence',
    '',
    '- smoke passed: main flow and invalid JSON path.',
    '- feature coverage: openprd tasks done.',
    '',
  ].join('\n'));

  const quality = await verifyQualityWorkspace(project);
  assert.equal(quality.report.qualityPolicy.scenarioTags.includes('release'), false);
  assert.deepEqual(quality.report.qualityPolicy.requiredGates, ['smoke', 'feature-coverage', 'knowledge', 'growth']);
  assert.equal(quality.report.readiness.productionReady, true);
});

test('quality flags missing business guardrails for free metered AI usage', async () => {
  const project = await makeTempProject();
  await initQualityWorkspace(project);
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'ai.js'), 'export const feature = "Free users can trigger AI generation with third-party model calls";\n');

  const missing = await verifyQualityWorkspace(project);
  const missingGate = missing.report.gates.find((gate) => gate.id === 'business-guardrails');
  assert.equal(missing.report.businessGuardrails.riskDetected, true);
  assert.equal(missingGate.status, 'needs-attention');
  assert.ok(missing.report.businessGuardrails.missingEvidence.includes('usageLimits'));
  assert.ok(missing.report.businessGuardrails.missingEvidence.includes('stopLossActions'));

  await fs.mkdir(path.join(project, 'docs', 'ops'), { recursive: true });
  await fs.writeFile(path.join(project, 'docs', 'ops', 'business-guardrails.md'), [
    '# Business guardrails',
    '',
    '- quota: free tier users have a daily limit and monthly limit.',
    '- abuse: negative test covers bypass, replay, concurrent, and unauthorized requests.',
    '- usage metric: dashboard tracks tokens_used and cost_usd spend.',
    '- alert: budget threshold alarm fires on anomaly growth.',
    '- kill switch: feature flag can disable, degrade, pause, or shutdown AI generation.',
    '',
  ].join('\n'));

  const covered = await verifyQualityWorkspace(project);
  const coveredGate = covered.report.gates.find((gate) => gate.id === 'business-guardrails');
  assert.equal(coveredGate.status, 'pass');
  assert.deepEqual(covered.report.businessGuardrails.missingEvidence, []);
});

test('standards require concrete docs plus file and folder manuals for source files', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'app.js'), 'export const app = true;\n');

  const missingManuals = await checkStandardsWorkspace(project);
  assert.equal(missingManuals.ok, false);
  assert.ok(missingManuals.errors.some((error) => error.includes('docs/basic/file-structure.md 仍包含模板占位内容')));
  assert.ok(missingManuals.errors.some((error) => error.includes('src/app.js 缺少文件说明书')));
  assert.ok(missingManuals.errors.some((error) => error.includes('src/project_src_README.md')));

  for (const doc of [
    ['file-structure.md', '# 项目文件结构\n\n## 项目定位\n\n测试项目。\n\n## 核心目录\n\n- `src/`: 示例源码。\n\n## 文件组织规则\n\n- 源码放在 `src/`。\n\n## 维护规则\n\n- 修改源码后更新说明书。\n'],
    ['app-flow.md', '# 产品流程说明\n\n## 核心流程\n\n用户运行示例。\n\n## 用户路径\n\n- 打开项目并执行命令。\n\n## 状态变化\n\n- 示例从未运行到已运行。\n\n## 维护规则\n\n- 流程变化后更新本文档。\n'],
    ['prd.md', '# 产品逻辑说明\n\n## 问题与目标\n\n提供最小示例。\n\n## 用户故事\n\n- 用户可以运行示例。\n\n## 功能范围\n\n- 示例入口。\n\n## 验收标准\n\n- 命令可执行。\n\n## 维护规则\n\n- 需求变化后更新本文档。\n'],
    ['frontend-guidelines.md', '# 前端开发规范\n\n## 适用范围\n\n无前端界面。\n\n## 界面结构\n\n- 当前没有页面。\n\n## 交互规范\n\n- 当前没有交互。\n\n## 维护规则\n\n- 新增界面后更新本文档。\n'],
    ['backend-structure.md', '# 后端架构设计\n\n## 适用范围\n\n示例脚本。\n\n## 服务边界\n\n- `src/app.js` 提供入口。\n\n## CLI 接入面\n\n- 当前通过 `node src/app.js` 运行，不提供独立 CLI 子命令。\n\n## API 接入面\n\n- 当前不提供 HTTP 或 RPC API。\n\n## 数据流\n\n- 无外部数据。\n\n## 维护规则\n\n- 模块或 CLI/API 接入面变化后更新本文档。\n'],
    ['tech-stack.md', '# 项目技术栈\n\n## 运行环境\n\n- Node.js。\n\n## 核心依赖\n\n- 无运行时依赖。\n\n## 工具链\n\n- `node --check`。\n\n## 维护规则\n\n- 依赖变化后更新本文档。\n'],
  ]) {
    await fs.writeFile(path.join(project, 'docs', 'basic', doc[0]), doc[1]);
  }

  const manual = [
    '/*',
    '## 核心功能',
    '提供示例入口。',
    '## 输入',
    '无。',
    '## 输出',
    '导出 app 常量。',
    '## 定位',
    '位于源码入口。',
    '## 依赖',
    '无。',
    '## 维护规则',
    '修改行为后更新说明书。',
    '*/',
    'export const app = true;',
    '',
  ].join('\n');
  await fs.writeFile(path.join(project, 'src', 'app.js'), manual);
  const folderReadmeName = `${path.basename(project)}_src_README.md`;
  await fs.writeFile(path.join(project, 'src', folderReadmeName), [
    '# src 文件夹说明书',
    '',
    '## 核心功能',
    '承载示例源码。',
    '',
    '## 输入',
    '开发者编辑源码。',
    '',
    '## 输出',
    '对外提供示例入口。',
    '',
    '## 定位',
    '项目源码目录。',
    '',
    '## 依赖',
    '无。',
    '',
    '## 维护规则',
    '- 新增源码后更新本文档。',
    '',
  ].join('\n'));

  const passed = await checkStandardsWorkspace(project);
  assert.equal(passed.ok, true);
  assert.ok(passed.checks.some((check) => check.includes('源文件说明书: 1/1。')));
  assert.ok(passed.checks.some((check) => check.includes('文件夹说明书: 1/1。')));
});

test('standards prefer package.json name over worktree folder name for folder manuals', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({ name: 'moticlaw', type: 'module' }, null, 2)}\n`);
  await writeConcreteBasicDocs(project, 'src/app.js');
  await writeSourceManual(path.join(project, 'src', 'app.js'), 'export const app = true;');
  await fs.writeFile(path.join(project, 'src', 'moticlaw_src_README.md'), [
    '# src 文件夹说明书',
    '',
    '## 核心功能',
    '承载示例源码。',
    '',
    '## 输入',
    '开发者编辑源码。',
    '',
    '## 输出',
    '对外提供示例入口。',
    '',
    '## 定位',
    '项目源码目录。',
    '',
    '## 依赖',
    '无。',
    '',
    '## 维护规则',
    '- 新增源码后更新本文档。',
    '',
  ].join('\n'));

  const passed = await checkStandardsWorkspace(project);
  assert.equal(passed.ok, true);
  assert.ok(passed.checks.some((check) => check.includes('文件夹说明书: 1/1。')));
});

test('standards allow folder manual moduleName override when package name differs', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({ name: '@scope/wrong-name', type: 'module' }, null, 2)}\n`);
  await writeConcreteBasicDocs(project, 'src/app.js');
  await writeSourceManual(path.join(project, 'src', 'app.js'), 'export const app = true;');
  const configPath = path.join(project, '.openprd', 'standards', 'config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  config.folderManual.moduleName = 'moticlaw';
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await fs.writeFile(path.join(project, 'src', 'moticlaw_src_README.md'), [
    '# src 文件夹说明书',
    '',
    '## 核心功能',
    '承载示例源码。',
    '',
    '## 输入',
    '开发者编辑源码。',
    '',
    '## 输出',
    '对外提供示例入口。',
    '',
    '## 定位',
    '项目源码目录。',
    '',
    '## 依赖',
    '无。',
    '',
    '## 维护规则',
    '- 新增源码后更新本文档。',
    '',
  ].join('\n'));

  const passed = await checkStandardsWorkspace(project);
  assert.equal(passed.ok, true);
  assert.ok(passed.checks.some((check) => check.includes('文件夹说明书: 1/1。')));
});

test('standards use the normalized module name for the project root folder manual', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({ name: 'moticlaw', type: 'module' }, null, 2)}\n`);
  await writeConcreteBasicDocs(project, 'root-entry.js');
  await writeSourceManual(path.join(project, 'root-entry.js'), 'export const rootEntry = true;');
  await fs.writeFile(path.join(project, 'moticlaw_moticlaw_README.md'), [
    '# 项目根目录说明书',
    '',
    '## 核心功能',
    '承载项目级源码与配置入口。',
    '',
    '## 输入',
    '开发者维护项目根目录文件。',
    '',
    '## 输出',
    '对外提供项目级入口。',
    '',
    '## 定位',
    '项目根目录。',
    '',
    '## 依赖',
    'Node.js 运行时。',
    '',
    '## 维护规则',
    '新增根目录源码后更新本说明书。',
    '',
  ].join('\n'));

  const passed = await checkStandardsWorkspace(project);
  assert.equal(passed.ok, true);
  assert.ok(passed.checks.some((check) => check.includes('文件夹说明书: 1/1。')));
});

test('dev-check reports code file line status and next actions', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.mkdir(path.join(project, 'generated'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'small.js'), `${Array.from({ length: 700 }, (_, index) => `export const small${index} = ${index};`).join('\n')}\n`);
  await fs.writeFile(path.join(project, 'src', 'medium.js'), `${Array.from({ length: 701 }, (_, index) => `export const medium${index} = ${index};`).join('\n')}\n`);
  await fs.writeFile(path.join(project, 'src', 'large.js'), `${Array.from({ length: 1501 }, (_, index) => `export const large${index} = ${index};`).join('\n')}\n`);
  await fs.writeFile(path.join(project, 'generated', 'bundle.js'), `${Array.from({ length: 2000 }, () => 'console.log("generated");').join('\n')}\n`);
  await fs.writeFile(path.join(project, 'README.md'), '# Readme\n');

  const result = await checkDevelopmentStandardsWorkspace(project, {
    files: ['src/small.js', 'src/medium.js', 'src/large.js', 'generated/bundle.js', 'README.md'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.thresholds.okMax, 700);
  assert.equal(result.thresholds.attentionMax, 1500);
  assert.equal(result.files.find((file) => file.path === 'src/small.js').status, 'ok');
  assert.equal(result.files.find((file) => file.path === 'src/medium.js').status, 'attention');
  assert.match(result.files.find((file) => file.path === 'src/medium.js').nextAction, /小范围改动/);
  assert.equal(result.files.find((file) => file.path === 'src/medium.js').statusLabel, '🟡 低风险｜建议留意');
  assert.match(result.files.find((file) => file.path === 'src/medium.js').wrapUp.reason, /评审、回归和交接成本/);
  assert.equal(result.files.find((file) => file.path === 'src/large.js').status, 'warning');
  assert.equal(result.files.find((file) => file.path === 'src/large.js').statusLabel, '🟠 中风险｜建议优先关注');
  assert.match(result.files.find((file) => file.path === 'src/large.js').nextAction, /拆分/);
  assert.equal(result.wrapUp.required, true);
  assert.deepEqual(result.wrapUp.columns, ['影响对象', '关注程度', '规模信号', '预警原因', '本次处理结果', '后续建议']);
  assert.equal(result.wrapUp.rows.length, 2);
  assert.equal(result.wrapUp.rows[0].影响对象, 'src/large.js');
  assert.equal(result.wrapUp.rows[0].关注程度, '🟠 中风险｜建议优先关注');
  assert.equal(result.wrapUp.rows[0].规模信号, '1501 行（> 1500 行/文件）');
  assert.equal(result.wrapUp.rows[0].预警原因, '文件太大，后续改动风险高');
  assert.equal(result.wrapUp.rows[0].本次处理结果, '这次先完成需求，暂不拆分');
  assert.equal(result.wrapUp.rows[0].后续建议, '优先拆出独立职责');
  assert.equal(result.wrapUp.rows[1].影响对象, 'src/medium.js');
  assert.equal(result.wrapUp.rows[1].规模信号, '701 行（> 700 行/文件）');
  assert.equal(result.wrapUp.rows[1].预警原因, '文件偏大，维护成本升');
  assert.equal(result.wrapUp.rows[1].本次处理结果, '本轮小改，未扩职责');
  assert.equal(result.wrapUp.rows[1].后续建议, '继续改前先拆小');
  assert.match(result.wrapUp.markdownBlock, /^\*\*后续建议\*\*/);
  assert.match(result.wrapUp.markdownTable, /\| 影响对象 \| 关注程度 \| 规模信号 \| 预警原因 \| 本次处理结果 \| 后续建议 \|/);
  assert.match(result.wrapUp.markdownTable, /src\/large\.js/);
  assert.match(result.wrapUp.markdownTable, /1501 行（> 1500 行\/文件）/);
  for (const row of result.wrapUp.rows) {
    assert.ok(Array.from(row.规模信号).length <= 20);
    assert.ok(Array.from(row.预警原因).length <= 20);
    assert.ok(Array.from(row.本次处理结果).length <= 20);
    assert.ok(Array.from(row.后续建议).length <= 20);
  }
  assert.equal(result.files.find((file) => file.path === 'generated/bundle.js').status, 'exempt');
  assert.equal(result.files.find((file) => file.path === 'README.md').status, 'ok');

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['dev-check', project, 'src/large.js', '--json']), 0);
  } finally {
    console.log = originalLog;
  }
  const cliResult = JSON.parse(logs.join('\n'));
  assert.equal(cliResult.files[0].status, 'warning');
  assert.equal(cliResult.wrapUp.required, true);
  assert.match(cliResult.wrapUp.markdownTable, /src\/large\.js/);

  const cwdLogs = [];
  const originalCwd = process.cwd();
  console.log = (...args) => cwdLogs.push(args.join(' '));
  try {
    process.chdir(project);
    assert.equal(await main(['dev-check', 'src/small.js', 'src/medium.js', '--json']), 0);
  } finally {
    process.chdir(originalCwd);
    console.log = originalLog;
  }
  const cwdCliResult = JSON.parse(cwdLogs.join('\n'));
  assert.equal(await fs.realpath(cwdCliResult.projectRoot), await fs.realpath(project));
  assert.deepEqual(cwdCliResult.files.map((file) => file.path), ['src/small.js', 'src/medium.js']);
  assert.equal(cwdCliResult.wrapUp.required, true);
  assert.equal(cwdCliResult.wrapUp.rows[0].影响对象, 'src/medium.js');
  assert.equal(cwdCliResult.wrapUp.rows[0].关注程度, '🟡 低风险｜建议留意');

  const userLogs = [];
  console.log = (...args) => userLogs.push(args.join(' '));
  try {
    assert.equal(await main(['dev-check', project, 'src/small.js', 'src/medium.js']), 0);
  } finally {
    console.log = originalLog;
  }
  const userOutput = userLogs.join('\n');
  assert.match(userOutput, /🟡 低风险｜建议留意/);
  assert.doesNotMatch(userOutput, /🔵/);
  assert.doesNotMatch(userOutput, /无明显影响/);
});

test('dev-check knowledge review attributes current touched files instead of stale turn state', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'agent-current.js'), `${Array.from({ length: 701 }, (_, index) => `export const current${index} = ${index};`).join('\n')}\n`);
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'turn-state.json'), `${JSON.stringify({
    version: 1,
    id: 'turn-stale',
    title: 'Stale inherited turn',
    touchedFiles: [
      'src/old-agent-one.js',
      'src/old-agent-two.js',
      'src/old-agent-three.js',
    ],
    reviewSignals: [
      {
        id: 'old-dev-check',
        kind: 'dev-check',
        ok: true,
        summary: 'old signal',
        touchedFiles: ['src/old-agent-one.js', 'src/old-agent-two.js'],
      },
    ],
  }, null, 2)}\n`);

  const result = await checkDevelopmentStandardsWorkspace(project, {
    files: ['src/agent-current.js'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.knowledgeReview.skipped, false);
  assert.match(result.knowledgeReview.summary, /本轮围绕 1 个可沉淀文件生成回顾/);
  const candidate = JSON.parse(await fs.readFile(result.knowledgeReview.files.candidate, 'utf8'));
  assert.deepEqual(candidate.touchedFiles, ['src/agent-current.js']);
  assert.doesNotMatch(candidate.summary, /old-agent/);
  assert.equal(candidate.reviewSignals.some((signal) => signal.touchedFiles?.includes('src/old-agent-one.js')), false);
});

test('Stop hook injects dev-check wrap-up table for touched large files', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'large.js'), `${Array.from({ length: 1501 }, (_, index) => `export const large${index} = ${index};`).join('\n')}\n`);

  await fs.writeFile(path.join(project, '.openprd', 'harness', 'turn-state.json'), `${JSON.stringify({
    version: 1,
    prompt: '直接帮我改这个大文件里的一个小问题。',
    touchedFiles: ['src/large.js'],
  }, null, 2)}\n`);

  const stop = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), 'Stop'], {
    cwd: project,
    input: JSON.stringify({
      cwd: project,
      hook_event_name: 'Stop',
    }),
    encoding: 'utf8',
    env: {
      ...process.env,
      OPENPRD_CLI: path.resolve('openprd/bin/openprd.js'),
    },
  });
  assert.equal(stop.status, 0);
  const payload = JSON.parse(stop.stdout);
  assert.equal(payload.continue, true);
  assert.equal(payload.hookSpecificOutput.hookEventName, 'Stop');
  assert.match(payload.hookSpecificOutput.additionalContext, /\*\*后续建议\*\*/);
  assert.match(payload.hookSpecificOutput.additionalContext, /🔴 → 🟠 → 🟡/);
  assert.match(payload.hookSpecificOutput.additionalContext, /直接复用下面的 Markdown 表格/);
  assert.match(payload.hookSpecificOutput.additionalContext, /不要把“关注程度”列改写成纯 emoji/);
  assert.match(payload.hookSpecificOutput.additionalContext, /dev-check-wrapup-copy\.mjs --validate/);
  assert.match(payload.hookSpecificOutput.additionalContext, /\| 影响对象 \| 关注程度 \| 规模信号 \| 预警原因 \| 本次处理结果 \| 后续建议 \|/);
  assert.match(payload.hookSpecificOutput.additionalContext, /src\/large\.js/);
  assert.match(payload.hookSpecificOutput.additionalContext, /🟠 中风险｜建议优先关注/);
  assert.match(payload.hookSpecificOutput.additionalContext, /1501 行（> 1500 行\/文件）/);
});

test('Stop hook asks for project-level experience in structured plain language', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'experience.js'), 'export const experience = true;\n');

  await fs.writeFile(path.join(project, '.openprd', 'harness', 'turn-state.json'), `${JSON.stringify({
    version: 1,
    id: 'turn-project-experience',
    prompt: '把这次收尾体验也一起优化掉。',
    touchedFiles: ['src/experience.js'],
    reviewSignals: [
      {
        id: 'run-verify-pass',
        kind: 'run-verify',
        ok: true,
        productionReady: true,
        summary: '本轮收尾方式已经稳定，可作为后续默认处理方式',
        touchedFiles: ['src/experience.js'],
      },
    ],
  }, null, 2)}\n`);
  await fs.writeFile(path.join(project, '.openprd', 'knowledge', 'review-signals.jsonl'), `${JSON.stringify({
    id: 'run-verify-pass',
    kind: 'run-verify',
    ok: true,
    productionReady: true,
    summary: '本轮收尾方式已经稳定，可作为后续默认处理方式',
    touchedFiles: ['src/experience.js'],
  })}\n`);

  const stop = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), 'Stop'], {
    cwd: project,
    input: JSON.stringify({
      cwd: project,
      hook_event_name: 'Stop',
    }),
    encoding: 'utf8',
    env: {
      ...process.env,
      OPENPRD_CLI: path.resolve('openprd/bin/openprd.js'),
    },
  });
  assert.equal(stop.status, 0);
  const payload = JSON.parse(stop.stdout);
  const context = payload.hookSpecificOutput.additionalContext;
  assert.equal(payload.continue, true);
  assert.match(context, /这次我观察到一个以后可能重复出现的情况：/);
  assert.match(context, /我计划保留一条项目经验：/);
  assert.match(context, /这条经验只会保留在当前项目里。/);
  assert.match(context, /要我把它一起保留下来吗？/);
  assert.doesNotMatch(context, /Draft Skill:/);
  assert.doesNotMatch(context, /Promote:/);
});

test('dev-check wrap-up copy script keeps copy compact', () => {
  const scriptPath = path.resolve('scripts/dev-check-wrapup-copy.mjs');
  const run = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify({
      files: [
        { status: 'warning', lineCount: 2507, thresholds: { okMax: 700, attentionMax: 1500 } },
        { status: 'attention', lineCount: 1313, thresholds: { okMax: 700, attentionMax: 1500 } },
      ],
    }),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.limit, 20);
  assert.deepEqual(payload.rows[0], {
    规模信号: '2507 行（> 1500 行/文件）',
    预警原因: '文件太大，后续改动风险高',
    本次处理结果: '这次先完成需求，暂不拆分',
    后续建议: '优先拆出独立职责',
  });
  assert.deepEqual(payload.rows[1], {
    规模信号: '1313 行（> 700 行/文件）',
    预警原因: '文件偏大，维护成本升',
    本次处理结果: '本轮小改，未扩职责',
    后续建议: '继续改前先拆小',
  });
  for (const row of payload.rows) {
    assert.ok(Array.from(row.规模信号).length <= payload.limit);
    assert.ok(Array.from(row.预警原因).length <= payload.limit);
    assert.ok(Array.from(row.本次处理结果).length <= payload.limit);
    assert.ok(Array.from(row.后续建议).length <= payload.limit);
  }
});

test('dev-check wrap-up copy validate mode fails fast on overlong fields', () => {
  const scriptPath = path.resolve('scripts/dev-check-wrapup-copy.mjs');
  const run = spawnSync(process.execPath, [scriptPath, '--validate'], {
    input: JSON.stringify({
      rows: [
        {
          影响对象: 'src/large.js',
          规模信号: '2507 行（> 1500 行/文件）',
          预警原因: '这条预警原因已经超过二十个字限制请继续缩短处理',
          本次处理结果: '这次先完成需求，暂不拆分',
          后续建议: '优先拆出独立职责',
        },
      ],
    }),
    encoding: 'utf8',
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /src\/large\.js/);
  assert.match(run.stderr, /预警原因/);
  assert.match(run.stderr, /超过 20 字上限/);
  assert.match(run.stderr, /请缩短后重试/);
});

test('visual-prepare writes reference-set crops, contact sheet, and board templates', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  const reference = path.join(project, 'reference-board.png');

  await sharp({
    create: {
      width: 400,
      height: 240,
      channels: 3,
      background: '#1d4ed8',
    },
  }).png().toFile(reference);

  const result = await visualPrepareWorkspace(project, {
    reference,
    grid: '2x2',
    include: '01,04',
    title: '登录候选图',
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'grid');
  assert.equal(result.itemCount, 2);
  assert.ok(result.referenceSetPath.includes(path.join('.openprd', 'harness', 'visual-reviews', 'reference-sets')));
  assert.equal((await sharp(result.contactSheetPath).metadata()).format, 'jpeg');

  const referenceSet = JSON.parse(await fs.readFile(result.referenceSetPath, 'utf8'));
  assert.equal(referenceSet.schema, 'openprd.reference-set.v1');
  assert.deepEqual(referenceSet.selection.grid, { columns: 2, rows: 2 });
  assert.equal(referenceSet.items.length, 2);
  assert.deepEqual(referenceSet.items.map((item) => item.id), ['01', '04']);
  assert.ok(referenceSet.artifacts.comparePlan.endsWith('compare-plan.json'));

  const focusBoard = JSON.parse(await fs.readFile(result.focusBoardTemplatePath, 'utf8'));
  assert.equal(focusBoard.mode, 'focus-board');
  assert.equal(focusBoard.focusRegions.length, 2);
  assert.equal(focusBoard.left.path, referenceSet.source.stagedPath);

  const parallelBoard = JSON.parse(await fs.readFile(result.parallelBoardTemplatePath, 'utf8'));
  assert.equal(parallelBoard.mode, 'parallel-board');
  assert.equal(parallelBoard.items.length, 2);
  assert.equal(parallelBoard.items[0].media[0].path, referenceSet.items[0].cropPath);

  const comparePlan = JSON.parse(await fs.readFile(result.comparePlanPath, 'utf8'));
  assert.equal(comparePlan.schema, 'openprd.visual-prepare.plan.v1');
  assert.equal(comparePlan.items.length, 2);
  assert.ok(comparePlan.items[0].suggestedCommand.includes('openprd visual-compare . --reference'));

  const cropMetadata = await sharp(result.items[0].cropPath).metadata();
  assert.equal(cropMetadata.format, 'png');
  assert.ok(cropMetadata.width > 0);
  assert.ok(cropMetadata.height > 0);

  const boxesPlan = path.join(project, 'boxes-plan.json');
  await fs.writeFile(boxesPlan, `${JSON.stringify({
    title: '手工映射',
    summary: '测试 boxes 模式。',
    items: [
      {
        id: 'hero',
        label: '首屏 Hero',
        box: { unit: 'ratio', x: 0, y: 0, width: 0.5, height: 0.5 },
      },
      {
        id: 'cta',
        label: 'CTA 区',
        box: { unit: 'ratio', x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
      },
    ],
  }, null, 2)}\n`);
  const cliLogs = [];
  const originalLog = console.log;
  console.log = (...args) => cliLogs.push(args.join(' '));
  try {
    assert.equal(await main([
      'visual-prepare',
      project,
      '--reference',
      reference,
      '--boxes',
      boxesPlan,
      '--id',
      'manual-boxes',
      '--json',
    ]), 0);
  } finally {
    console.log = originalLog;
  }
  const cliResult = JSON.parse(cliLogs.join('\n'));
  assert.equal(cliResult.mode, 'boxes');
  assert.equal(cliResult.setId, 'manual-boxes');
  assert.equal(cliResult.itemCount, 2);
  const cliReferenceSet = JSON.parse(await fs.readFile(cliResult.referenceSetPath, 'utf8'));
  assert.equal(cliReferenceSet.selection.boxesPath, 'boxes-plan.json');
  assert.deepEqual(cliReferenceSet.items.map((item) => item.id), ['hero', 'cta']);
});

test('visual-compare writes side-by-side review images', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  const reference = path.join(project, 'reference.png');
  const actual = path.join(project, 'actual.jpg');

  await sharp({
    create: {
      width: 180,
      height: 120,
      channels: 3,
      background: '#d4af37',
    },
  }).png().toFile(reference);
  await sharp({
    create: {
      width: 240,
      height: 140,
      channels: 3,
      background: '#2f80ed',
    },
  }).jpeg({ quality: 90 }).toFile(actual);

  const result = await visualCompareWorkspace(project, {
    reference,
    actual,
    maxPanelWidth: 100,
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'reference-actual');
  assert.equal(result.format, 'jpg');
  assert.equal(result.quality, 85);
  assert.equal(result.labels.reference, '效果图');
  assert.equal(result.labels.actual, '实现截图');
  assert.equal(result.outputPath.includes(path.join('.openprd', 'harness', 'visual-reviews')), true);
  assert.ok(result.metadataPath.endsWith('.json'));
  const metadata = JSON.parse(await fs.readFile(result.metadataPath, 'utf8'));
  assert.equal(metadata.schema, 'openprd.visual-review.v1');
  assert.equal(metadata.mode, 'reference-actual');
  assert.equal(result.outputPath.endsWith('.jpg'), true);
  const jpgMetadata = await sharp(result.outputPath).metadata();
  assert.equal(jpgMetadata.format, 'jpeg');
  assert.ok(jpgMetadata.width > jpgMetadata.height);

  const pngOut = path.join(project, '.openprd', 'harness', 'visual-reviews', 'manual.png');
  const pngResult = await visualCompareWorkspace(project, {
    reference,
    actual,
    out: pngOut,
    format: 'png',
    maxPanelWidth: 100,
  });
  assert.equal(pngResult.outputPath, pngOut);
  assert.equal(pngResult.quality, null);
  assert.equal((await sharp(pngResult.outputPath).metadata()).format, 'png');

  const relativeOutResult = await visualCompareWorkspace(project, {
    reference,
    actual,
    out: path.join('.openprd', 'harness', 'visual-reviews', 'relative.webp'),
    maxPanelWidth: 100,
  });
  assert.equal(relativeOutResult.outputPath, path.join(project, '.openprd', 'harness', 'visual-reviews', 'relative.webp'));
  assert.equal(relativeOutResult.format, 'webp');
  assert.equal((await sharp(relativeOutResult.outputPath).metadata()).format, 'webp');

  const beforeAfterResult = await visualCompareWorkspace(project, {
    before: reference,
    after: actual,
    maxPanelWidth: 100,
  });
  assert.equal(beforeAfterResult.mode, 'before-after');
  assert.equal(beforeAfterResult.labels.reference, '修改前');
  assert.equal(beforeAfterResult.labels.actual, '修改后');
  assert.equal(beforeAfterResult.reviewArtifact.mode, 'before-after');
  assert.ok(path.basename(beforeAfterResult.outputPath).startsWith('visual-before-after-'));
  assert.ok(beforeAfterResult.nextActions.join('\n').includes('未改区域'));

  const cliOut = path.join(project, '.openprd', 'harness', 'visual-reviews', 'cli.jpg');
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main([
      'visual-compare',
      project,
      '--reference',
      reference,
      '--actual',
      actual,
      '--out',
      cliOut,
      '--quality',
      '82',
      '--max-panel-width',
      '100',
      '--json',
    ]), 0);
  } finally {
    console.log = originalLog;
  }
  const cliResult = JSON.parse(logs.join('\n'));
  assert.equal(cliResult.outputPath, cliOut);
  assert.equal(cliResult.mode, 'reference-actual');
  assert.equal(cliResult.quality, 82);
  assert.equal((await sharp(cliOut).metadata()).format, 'jpeg');

  const beforeAfterCliOut = path.join(project, '.openprd', 'harness', 'visual-reviews', 'cli-before-after.jpg');
  const beforeAfterLogs = [];
  console.log = (...args) => beforeAfterLogs.push(args.join(' '));
  try {
    assert.equal(await main([
      'visual-compare',
      project,
      '--before',
      reference,
      '--after',
      actual,
      '--out',
      beforeAfterCliOut,
      '--max-panel-width',
      '100',
      '--json',
    ]), 0);
  } finally {
    console.log = originalLog;
  }
  const beforeAfterCliResult = JSON.parse(beforeAfterLogs.join('\n'));
  assert.equal(beforeAfterCliResult.outputPath, beforeAfterCliOut);
  assert.equal(beforeAfterCliResult.mode, 'before-after');
  assert.equal(beforeAfterCliResult.labels.reference, '修改前');
  assert.equal(beforeAfterCliResult.labels.actual, '修改后');
  assert.equal((await sharp(beforeAfterCliOut).metadata()).format, 'jpeg');
});

test('visual-compare writes focus and parallel review boards and quality can detect them', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  const reference = path.join(project, 'reference.png');
  const actual = path.join(project, 'actual.png');
  const experimentA = path.join(project, 'experiment-a.png');
  const experimentB = path.join(project, 'experiment-b.png');

  await sharp({
    create: {
      width: 320,
      height: 200,
      channels: 3,
      background: '#f59e0b',
    },
  }).png().toFile(reference);
  await sharp({
    create: {
      width: 320,
      height: 200,
      channels: 3,
      background: '#2563eb',
    },
  }).png().toFile(actual);
  await sharp({
    create: {
      width: 220,
      height: 180,
      channels: 3,
      background: '#0f766e',
    },
  }).png().toFile(experimentA);
  await sharp({
    create: {
      width: 220,
      height: 180,
      channels: 3,
      background: '#7c3aed',
    },
  }).png().toFile(experimentB);

  const focusBoardPath = path.join(project, 'focus-board.json');
  await fs.writeFile(focusBoardPath, `${JSON.stringify({
    mode: 'focus-board',
    title: '登录卡片局部验收',
    left: {
      path: reference,
      label: '效果图',
    },
    right: {
      path: actual,
      label: '实现截图',
    },
    focusRegions: [
      {
        label: '主按钮区',
        reason: '检查文案长度和对齐',
        leftBox: { unit: 'ratio', x: 0.18, y: 0.56, width: 0.28, height: 0.18 },
        rightBox: { unit: 'ratio', x: 0.2, y: 0.58, width: 0.28, height: 0.18 },
      },
      {
        label: '标题区',
        reason: '检查字号和间距',
        leftBox: { unit: 'ratio', x: 0.14, y: 0.12, width: 0.42, height: 0.2 },
        rightBox: { unit: 'ratio', x: 0.14, y: 0.12, width: 0.42, height: 0.2 },
      },
    ],
  }, null, 2)}\n`);

  const focusResult = await visualCompareWorkspace(project, {
    board: focusBoardPath,
    maxPanelWidth: 180,
  });
  assert.equal(focusResult.mode, 'focus-board');
  assert.equal(focusResult.focusRegions.length, 2);
  assert.equal(focusResult.reviewArtifact.mode, 'focus-board');
  assert.equal((await sharp(focusResult.outputPath).metadata()).format, 'jpeg');

  const parallelBoardPath = path.join(project, 'parallel-board.json');
  await fs.writeFile(parallelBoardPath, `${JSON.stringify({
    mode: 'parallel-board',
    title: '登录方案并行实验',
    summary: '把方案截图和指标放到一个审查板里。',
    columns: 2,
    cardWidth: 240,
    items: [
      {
        label: '方案 A',
        subtitle: '更紧凑的按钮布局',
        verdict: '继续观察',
        media: [
          { path: experimentA, label: '整体截图' },
        ],
        metrics: [
          { label: '首屏耗时', value: '420ms' },
          { label: '按钮高度', value: '44px' },
        ],
      },
      {
        label: '方案 B',
        subtitle: '更宽的按钮和更大留白',
        verdict: '优先评审',
        media: [
          { path: experimentB, label: '整体截图' },
        ],
        metrics: [
          { label: '首屏耗时', value: '438ms' },
          { label: '按钮高度', value: '48px' },
        ],
        notes: '继续看视觉一致性',
      },
    ],
  }, null, 2)}\n`);

  const parallelLogs = [];
  const originalLog = console.log;
  console.log = (...args) => parallelLogs.push(args.join(' '));
  try {
    assert.equal(await main([
      'visual-compare',
      project,
      '--board',
      parallelBoardPath,
      '--json',
    ]), 0);
  } finally {
    console.log = originalLog;
  }
  const parallelResult = JSON.parse(parallelLogs.join('\n'));
  assert.equal(parallelResult.mode, 'parallel-board');
  assert.equal(parallelResult.items.length, 2);
  assert.equal((await sharp(parallelResult.outputPath).metadata()).format, 'jpeg');

  const verificationBoardPath = path.join(project, 'verification-board.json');
  await fs.writeFile(verificationBoardPath, `${JSON.stringify({
    mode: 'verification-board',
    title: '设置页截图实测',
    route: 'Computer Use 打开设置页并检查保存状态',
    columns: 2,
    cardWidth: 240,
    screenshots: [
      {
        path: experimentA,
        label: '初始状态截图',
        status: '通过',
        checks: [
          { label: '入口', value: '设置页可打开' },
          { label: '按钮', value: '保存按钮可见' },
        ],
      },
      {
        path: experimentB,
        label: '保存后截图',
        status: '通过',
        checks: [
          { label: '反馈', value: '保存状态可见' },
          { label: '布局', value: '未出现明显漂移' },
        ],
      },
    ],
  }, null, 2)}\n`);
  const verificationResult = await visualCompareWorkspace(project, {
    board: verificationBoardPath,
    maxPanelWidth: 180,
  });
  assert.equal(verificationResult.mode, 'verification-board');
  assert.equal(verificationResult.items.length, 2);
  assert.equal(verificationResult.reviewArtifact.mode, 'verification-board');
  assert.equal((await sharp(verificationResult.outputPath).metadata()).format, 'jpeg');

  const visualArtifacts = await listVisualReviewArtifacts(project);
  assert.ok(visualArtifacts.some((artifact) => artifact.mode === 'focus-board'));
  assert.ok(visualArtifacts.some((artifact) => artifact.mode === 'parallel-board'));
  assert.ok(visualArtifacts.some((artifact) => artifact.mode === 'verification-board'));

  const includesAny = (text, patterns) => {
    const haystack = String(text ?? '').toLowerCase();
    return patterns.some((pattern) => {
      if (pattern instanceof RegExp) {
        return pattern.test(text);
      }
      return haystack.includes(String(pattern).toLowerCase());
    });
  };

  const focusReview = detectVisualReview({
    policy: {
      requiredGates: ['visual-review'],
    },
    activeChangeContext: {
      text: '这次主要做登录按钮局部对比，需要看局部细节和焦点区域。',
    },
    activeTasks: {
      tasks: [],
    },
    visualArtifacts,
    includesAny,
  });
  assert.equal(focusReview.status, 'pass');
  assert.equal(focusReview.expectsFocusBoard, true);
  assert.ok(focusReview.matchingArtifacts.some((artifact) => artifact.mode === 'focus-board'));

  const parallelReview = detectVisualReview({
    policy: {
      requiredGates: ['visual-review'],
    },
    activeChangeContext: {
      text: '这次在并行实验多个优化方向，需要一张并行实验方案证据板。',
    },
    activeTasks: {
      tasks: [],
    },
    visualArtifacts,
    includesAny,
  });
  assert.equal(parallelReview.status, 'pass');
  assert.equal(parallelReview.expectsParallelBoard, true);
  assert.ok(parallelReview.matchingArtifacts.some((artifact) => artifact.mode === 'parallel-board'));

  const verificationReview = detectVisualReview({
    policy: {
      requiredGates: ['visual-review'],
    },
    activeChangeContext: {
      text: '这次用普通截图和 Computer 实测截图做验收，需要截图实测证据板。',
    },
    activeTasks: {
      tasks: [],
    },
    visualArtifacts,
    includesAny,
  });
  assert.equal(verificationReview.status, 'pass');
  assert.equal(verificationReview.expectsVerificationBoard, true);
  assert.ok(verificationReview.matchingArtifacts.some((artifact) => artifact.mode === 'verification-board'));
});

test('dev-check auto-applies detected unknown code extensions', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'component.astro'), [
    '---',
    'const title = "Hello";',
    '---',
    '<script>',
    'export const hydrate = true;',
    '</script>',
    '<h1>{title}</h1>',
    '',
  ].join('\n'));

  const result = await checkDevelopmentStandardsWorkspace(project, {
    files: ['src/component.astro'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.files[0].status, 'ok');
  assert.equal(result.files[0].fileKind, 'candidate-code');
  assert.equal(result.files[0].growthCandidate.id, 'code-extension-astro');
  assert.equal(result.files[0].growthObservation.autoApplied, true);
  assert.match(result.files[0].nextAction, /已自动补齐 \.astro/);

  const review = await reviewGrowthWorkspace(project);
  assert.equal(review.summary.pending, 0);
  assert.equal(review.summary.applied, 1);
  assert.equal(review.applied[0].id, 'code-extension-astro');
  assert.equal(review.applied[0].applyMode, 'auto');
  assert.equal(review.ledger.summary.autoApplied, 1);
  assert.equal(review.ledger.summary.current.applied, 1);

  const reviewLogs = [];
  const originalLog = console.log;
  console.log = (...args) => reviewLogs.push(args.join(' '));
  try {
    assert.equal(await main(['grow', project, '--review']), 0);
  } finally {
    console.log = originalLog;
  }
  const reviewText = reviewLogs.join('\n');
  assert.doesNotMatch(reviewText, /状态: 待确认/);
  assert.match(reviewText, /候选: 0 待确认，1 已应用，0 已拒绝。/);
  assert.match(reviewText, /账本: events 1，observe 1，pending 0，auto 1，manual 0，reconcile 0，checkpoint 0，reject 0，skip 0/);
  assert.match(reviewText, /下一步: 当前没有待确认增长候选。/);

  const standardsConfig = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'standards', 'config.json'), 'utf8'));
  assert.deepEqual(standardsConfig.developmentStandards.codeFileLines.codeFileExtensions, ['.json', '.md', '.astro']);

  const recognized = await checkDevelopmentStandardsWorkspace(project, {
    files: ['src/component.astro'],
  });
  assert.equal(recognized.files[0].fileKind, 'code');
  assert.equal(recognized.files[0].growthCandidate, null);

  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['grow', project, '--review', '--json']), 0);
  } finally {
    console.log = originalLog;
  }
  const cliResult = JSON.parse(logs.join('\n'));
  assert.equal(cliResult.summary.applied, 1);
});

test('dev-check also auto-applies low-confidence unknown code extensions', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'maybe.tpl'), [
    'title;',
    '',
  ].join('\n'));

  const result = await checkDevelopmentStandardsWorkspace(project, {
    files: ['src/maybe.tpl'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.files[0].status, 'ok');
  assert.equal(result.files[0].fileKind, 'candidate-code');
  assert.equal(result.files[0].growthCandidate.id, 'code-extension-tpl');
  assert.equal(result.files[0].growthObservation.autoApplied, true);
  assert.match(result.files[0].nextAction, /已自动补齐 \.tpl/);

  const review = await reviewGrowthWorkspace(project);
  assert.equal(review.summary.pending, 0);
  assert.equal(review.summary.applied, 1);
  assert.equal(review.applied[0].id, 'code-extension-tpl');
  assert.equal(review.ledger.summary.autoApplied, 1);

  const reviewLogs = [];
  const originalLog = console.log;
  console.log = (...args) => reviewLogs.push(args.join(' '));
  try {
    assert.equal(await main(['grow', project, '--review']), 0);
  } finally {
    console.log = originalLog;
  }
  const reviewText = reviewLogs.join('\n');
  assert.doesNotMatch(reviewText, /状态: 待确认/);
  assert.match(reviewText, /候选: 0 待确认，1 已应用，0 已拒绝。/);
  assert.match(reviewText, /账本: events 1，observe 1，pending 0，auto 1，manual 0，reconcile 0，checkpoint 0，reject 0，skip 0/);

  const standardsConfig = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'standards', 'config.json'), 'utf8'));
  assert.deepEqual(standardsConfig.developmentStandards.codeFileLines.codeFileExtensions, ['.json', '.md', '.tpl']);

  const recognized = await checkDevelopmentStandardsWorkspace(project, {
    files: ['src/maybe.tpl'],
  });
  assert.equal(recognized.files[0].fileKind, 'code');
  assert.equal(recognized.files[0].growthCandidate, null);

  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['grow', project, '--review', '--json']), 0);
  } finally {
    console.log = originalLog;
  }
  const cliResult = JSON.parse(logs.join('\n'));
  assert.equal(cliResult.summary.pending, 0);
  assert.equal(cliResult.summary.applied, 1);
});

test('growth init reconciles older pending code-extension candidates into auto-applied state', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });

  const candidate = buildCodeExtensionCandidate('README.md', {
    lineCount: 10,
    confidence: 0.55,
    reason: 'code-punctuation',
  });
  const observed = await observeGrowthWorkspace(project, candidate, {
    autoApply: { enabled: false, safeTypes: ['code-extension'] },
  });
  assert.equal(observed.autoApplied, false);

  const before = await reviewGrowthWorkspace(project);
  assert.equal(before.summary.pending, 1);
  assert.equal(before.pending[0].id, 'code-extension-md');

  const growth = await initGrowthWorkspace(project);
  assert.equal(growth.reconciledAutoApplied.length, 1);
  assert.equal(growth.reconciledAutoApplied[0].id, 'code-extension-md');
  assert.equal(growth.ledger.summary.reconciledAutoApplied, 1);
  assert.equal(growth.ledger.summary.autoApplied, 1);

  const after = await reviewGrowthWorkspace(project);
  assert.equal(after.summary.pending, 0);
  assert.equal(after.summary.applied, 1);
  assert.equal(after.applied[0].applyMode, 'auto');
  assert.equal(after.ledger.summary.reconciledAutoApplied, 1);

  const standardsConfig = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'standards', 'config.json'), 'utf8'));
  assert.deepEqual(standardsConfig.developmentStandards.codeFileLines.codeFileExtensions, ['.json', '.md']);
});

test('standards ignore non-owned generated and marketplace source trees', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });

  for (const doc of [
    ['file-structure.md', '# 项目文件结构\n\n## 项目定位\n\n测试项目。\n\n## 核心目录\n\n- `src/`: 示例源码。\n\n## 文件组织规则\n\n- 源码放在 `src/`。\n\n## 维护规则\n\n- 修改源码后更新说明书。\n'],
    ['app-flow.md', '# 产品流程说明\n\n## 核心流程\n\n用户运行示例。\n\n## 用户路径\n\n- 打开项目并执行命令。\n\n## 状态变化\n\n- 示例从未运行到已运行。\n\n## 维护规则\n\n- 流程变化后更新本文档。\n'],
    ['prd.md', '# 产品逻辑说明\n\n## 问题与目标\n\n提供最小示例。\n\n## 用户故事\n\n- 用户可以运行示例。\n\n## 功能范围\n\n- 示例入口。\n\n## 验收标准\n\n- 命令可执行。\n\n## 维护规则\n\n- 需求变化后更新本文档。\n'],
    ['frontend-guidelines.md', '# 前端开发规范\n\n## 适用范围\n\n无前端界面。\n\n## 界面结构\n\n- 当前没有页面。\n\n## 交互规范\n\n- 当前没有交互。\n\n## 维护规则\n\n- 新增界面后更新本文档。\n'],
    ['backend-structure.md', '# 后端架构设计\n\n## 适用范围\n\n示例脚本。\n\n## 服务边界\n\n- `src/app.js` 提供入口。\n\n## CLI 接入面\n\n- 当前通过 `node src/app.js` 运行，不提供独立 CLI 子命令。\n\n## API 接入面\n\n- 当前不提供 HTTP 或 RPC API。\n\n## 数据流\n\n- 无外部数据。\n\n## 维护规则\n\n- 模块或 CLI/API 接入面变化后更新本文档。\n'],
    ['tech-stack.md', '# 项目技术栈\n\n## 运行环境\n\n- Node.js。\n\n## 核心依赖\n\n- 无运行时依赖。\n\n## 工具链\n\n- `node --check`。\n\n## 维护规则\n\n- 依赖变化后更新本文档。\n'],
  ]) {
    await fs.writeFile(path.join(project, 'docs', 'basic', doc[0]), doc[1]);
  }

  await fs.writeFile(path.join(project, 'src', 'app.js'), [
    '/*',
    '## 核心功能',
    '提供示例入口。',
    '## 输入',
    '无。',
    '## 输出',
    '导出 app 常量。',
    '## 定位',
    '位于源码入口。',
    '## 依赖',
    '无。',
    '## 维护规则',
    '修改行为后更新说明书。',
    '*/',
    'export const app = true;',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(project, 'src', `${path.basename(project)}_src_README.md`), [
    '# src 文件夹说明书',
    '',
    '## 核心功能',
    '承载示例源码。',
    '',
    '## 输入',
    '开发者编辑源码。',
    '',
    '## 输出',
    '对外提供示例入口。',
    '',
    '## 定位',
    '项目源码目录。',
    '',
    '## 依赖',
    '无。',
    '',
    '## 维护规则',
    '- 新增源码后更新本文档。',
    '',
  ].join('\n'));

  await fs.mkdir(path.join(project, '.tmp', 'marketplace-sources', 'skill'), { recursive: true });
  await fs.writeFile(path.join(project, '.tmp', 'marketplace-sources', 'skill', 'script.py'), 'print("cached")\n');
  await fs.mkdir(path.join(project, 'resources', 'marketplace-candidates', 'skill-sources', 'demo'), { recursive: true });
  await fs.writeFile(path.join(project, 'resources', 'marketplace-candidates', 'skill-sources', 'demo', 'tool.ts'), 'export const cached = true;\n');
  await fs.mkdir(path.join(project, 'resources', 'legacy-data', 'workspace', 'skills', 'demo'), { recursive: true });
  await fs.writeFile(path.join(project, 'resources', 'legacy-data', 'workspace', 'skills', 'demo', 'legacy.js'), 'export const legacy = true;\n');
  await fs.mkdir(path.join(project, 'fixtures', 'demo'), { recursive: true });
  await fs.writeFile(path.join(project, 'fixtures', 'demo', 'example.ts'), 'export const fixture = true;\n');

  const report = await checkStandardsWorkspace(project);
  assert.equal(report.ok, true);
  assert.deepEqual(report.manualReport.sourceFiles, ['src/app.js']);
  assert.ok(report.manualReport.ignorePatterns.includes('**/marketplace-sources/**'));
});

test('standards can classify nested reference repositories as external source', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });

  for (const doc of [
    ['file-structure.md', '# 项目文件结构\n\n## 项目定位\n\n测试项目。\n\n## 核心目录\n\n- `src/`: 示例源码。\n- `research/`: 外部参考源码，只作为调研证据。\n\n## 文件组织规则\n\n- 源码放在 `src/`。\n\n## 维护规则\n\n- 修改源码后更新说明书。\n'],
    ['app-flow.md', '# 产品流程说明\n\n## 核心流程\n\n用户运行示例。\n\n## 用户路径\n\n- 打开项目并执行命令。\n\n## 状态变化\n\n- 示例从未运行到已运行。\n\n## 维护规则\n\n- 流程变化后更新本文档。\n'],
    ['prd.md', '# 产品逻辑说明\n\n## 问题与目标\n\n提供最小示例。\n\n## 用户故事\n\n- 用户可以运行示例。\n\n## 功能范围\n\n- 示例入口。\n\n## 验收标准\n\n- 命令可执行。\n\n## 维护规则\n\n- 需求变化后更新本文档。\n'],
    ['frontend-guidelines.md', '# 前端开发规范\n\n## 适用范围\n\n无前端界面。\n\n## 界面结构\n\n- 当前没有页面。\n\n## 交互规范\n\n- 当前没有交互。\n\n## 维护规则\n\n- 新增界面后更新本文档。\n'],
    ['backend-structure.md', '# 后端架构设计\n\n## 适用范围\n\n示例脚本。\n\n## 服务边界\n\n- `src/app.js` 提供入口。\n\n## CLI 接入面\n\n- 当前通过 `node src/app.js` 运行，不提供独立 CLI 子命令。\n\n## API 接入面\n\n- 当前不提供 HTTP 或 RPC API。\n\n## 数据流\n\n- 无外部数据。\n\n## 维护规则\n\n- 模块或 CLI/API 接入面变化后更新本文档。\n'],
    ['tech-stack.md', '# 项目技术栈\n\n## 运行环境\n\n- Node.js。\n\n## 核心依赖\n\n- 无运行时依赖。\n\n## 工具链\n\n- `node --check`。\n\n## 维护规则\n\n- 依赖变化后更新本文档。\n'],
  ]) {
    await fs.writeFile(path.join(project, 'docs', 'basic', doc[0]), doc[1]);
  }

  await fs.writeFile(path.join(project, 'src', 'app.js'), [
    '/*',
    '## 核心功能',
    '提供示例入口。',
    '## 输入',
    '无。',
    '## 输出',
    '导出 app 常量。',
    '## 定位',
    '位于源码入口。',
    '## 依赖',
    '无。',
    '## 维护规则',
    '修改行为后更新说明书。',
    '*/',
    'export const app = true;',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(project, 'src', `${path.basename(project)}_src_README.md`), [
    '# src 文件夹说明书',
    '',
    '## 核心功能',
    '承载示例源码。',
    '',
    '## 输入',
    '开发者编辑源码。',
    '',
    '## 输出',
    '对外提供示例入口。',
    '',
    '## 定位',
    '项目源码目录。',
    '',
    '## 依赖',
    '无。',
    '',
    '## 维护规则',
    '- 新增源码后更新本文档。',
    '',
  ].join('\n'));

  await fs.mkdir(path.join(project, 'research', 'cat-bedtime', '.git'), { recursive: true });
  for (const fileName of ['one.py', 'two.py', 'three.py', 'four.py', 'five.py']) {
    await fs.writeFile(path.join(project, 'research', 'cat-bedtime', fileName), 'print("reference")\n');
  }

  const missing = await checkStandardsWorkspace(project);
  assert.equal(missing.ok, true);
  assert.deepEqual(missing.manualReport.sourceFiles, ['src/app.js']);
  assert.deepEqual(missing.manualReport.provisionalExternalReferencePaths, ['research/cat-bedtime']);
  assert.equal(missing.manualReport.externalReferenceCandidates[0].path, 'research/cat-bedtime');
  assert.equal(missing.manualReport.externalReferenceCandidates[0].reason, 'nested-git');
  assert.ok(missing.checks.some((check) => check.includes('外部参考候选: 1 个已暂按候选跳过逐文件说明书')));

  const classified = await classifyExternalReferenceWorkspace(project, { externalReference: 'research/cat-bedtime' });
  assert.equal(classified.ok, true);
  assert.equal(classified.path, 'research/cat-bedtime');

  const passed = await checkStandardsWorkspace(project);
  assert.equal(passed.ok, true);
  assert.deepEqual(passed.manualReport.sourceFiles, ['src/app.js']);
  assert.deepEqual(passed.manualReport.externalReferencePaths, ['research/cat-bedtime']);
  assert.ok(passed.checks.some((check) => check.includes('外部参考源码: 1 个已跳过逐文件说明书。')));
});
