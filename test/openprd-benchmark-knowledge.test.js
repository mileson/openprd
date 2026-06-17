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
  brainstormPresentationWorkspace,
  brainstormWorkspace,
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
test('benchmark add/list/approve/verify and update generated benchmark guidance', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });
  const initialBenchmarks = await listBenchmarkWorkspace(project);

  const addResult = await addBenchmarkWorkspace(project, {
    source: 'https://github.com/openprd-lab/cli-observability-patterns',
    notes: '参考 doctor、dry-run 和命令可发现性设计',
  });
  assert.equal(addResult.ok, true);
  assert.equal(addResult.source.status, 'candidate');
  assert.equal(addResult.source.sourceType, 'github');
  assert.ok(addResult.source.scenarios.includes('cli-tooling'));
  assert.ok(addResult.source.scenarios.includes('developer-experience'));
  assert.ok(addResult.source.triggerWhen.some((item) => item.includes('doctor')));

  const iconAddResult = await addBenchmarkWorkspace(project, {
    source: 'https://icon-benchmarks.example.invalid/phosphor-react-icons',
    notes: 'UI 图标站参考，Phosphor Icons / React Icons 风格',
  });
  assert.equal(iconAddResult.ok, true);
  assert.ok(iconAddResult.source.scenarios.includes('icon-resources'));
  assert.ok(iconAddResult.source.triggerWhen.some((item) => item.includes('图标')));

  const reviewLaneAdd = await addBenchmarkWorkspace(project, {
    source: 'https://review-benchmarks.example.invalid/ai-code-review-harness',
    notes: 'AI code review / PR review harness，独立审查、reviewer agreement、误报过滤、merge recommendation',
  });
  assert.equal(reviewLaneAdd.ok, true);
  assert.ok(reviewLaneAdd.source.scenarios.includes('pr-review-harness'));
  assert.ok(reviewLaneAdd.source.triggerWhen.some((item) => item.includes('merge 前高风险复核')));

  const listedAfterAdd = await listBenchmarkWorkspace(project);
  assert.equal(listedAfterAdd.counts.approved, initialBenchmarks.counts.approved);
  assert.equal(listedAfterAdd.counts.candidates, initialBenchmarks.counts.candidates + 3);
  assert.ok(listedAfterAdd.candidates.some((item) => item.id === addResult.source.id));
  assert.ok(listedAfterAdd.candidates.some((item) => item.id === iconAddResult.source.id));
  assert.ok(listedAfterAdd.candidates.some((item) => item.id === reviewLaneAdd.source.id));

  const approveResult = await approveBenchmarkWorkspace(project, { id: addResult.source.id });
  assert.equal(approveResult.ok, true);
  assert.equal(approveResult.source.status, 'approved');

  const sourcesYaml = await fs.readFile(path.join(project, '.openprd', 'benchmarks', 'sources.yaml'), 'utf8');
  assert.ok(sourcesYaml.includes(addResult.source.id));
  assert.ok(sourcesYaml.includes('approved'));

  const indexMd = await fs.readFile(path.join(project, '.openprd', 'benchmarks', 'index.md'), 'utf8');
  assert.ok(indexMd.includes('Approved Sources'));
  assert.ok(indexMd.includes(addResult.source.id));

  await updateAgentIntegrationWorkspace(project, { tools: 'codex' });
  const generatedBenchmarkSkill = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-benchmark-router', 'SKILL.md'), 'utf8');
  assert.ok(generatedBenchmarkSkill.includes('## Project Benchmark Registry'));
  assert.ok(generatedBenchmarkSkill.includes(addResult.source.id));
  assert.ok(generatedBenchmarkSkill.includes(addResult.source.repo));
  assert.ok(generatedBenchmarkSkill.includes('AI code review / PR review harness'));
  assert.ok(generatedBenchmarkSkill.includes('merge recommendation'));
  assert.ok(generatedBenchmarkSkill.includes('change lifecycle'));
  assert.ok(generatedBenchmarkSkill.includes('mandatory skill routing'));
  assert.ok(generatedBenchmarkSkill.includes('Phosphor Icons'));
  assert.ok(generatedBenchmarkSkill.includes('React Icons'));
});

test('benchmark verify catches duplicates, unreachable sources and overbroad triggers', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const first = await addBenchmarkWorkspace(project, {
    source: 'https://github.com/Fission-AI/OpenSpec',
    notes: '参考 spec 生成与项目配置',
  });
  assert.equal(first.ok, true);

  const duplicateAdd = await addBenchmarkWorkspace(project, {
    source: 'Fission-AI/OpenSpec',
    notes: '重复来源',
  });
  assert.equal(duplicateAdd.ok, false);

  const badId = 'too-broad-source';
  await fs.writeFile(
    path.join(project, '.openprd', 'benchmarks', 'inbox', `${badId}.yaml`),
    [
      `id: ${badId}`,
      'title: Too Broad Source',
      'status: candidate',
      'sourceType: web',
      'url: http://127.0.0.1:9/missing',
      'researchMethod: official_page_first',
      'scenarios:',
      '  - agent-harness',
      'triggerWhen:',
      '  - 所有任务都可以参考',
      '',
    ].join('\n'),
    'utf8',
  );

  const verifyResult = await verifyBenchmarkWorkspace(project);
  assert.equal(verifyResult.ok, false);
  assert.ok(verifyResult.errors.some((item) => item.includes('Unreachable source')));
  assert.ok(verifyResult.warnings.some((item) => item.includes('too broad or missing')));
});

test('benchmark source observations accumulate adoption evidence and recommend approval', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const first = await observeBenchmarkSourceWorkspace(project, {
    source: 'https://docs.example.com/docs/agent-harness',
    notes: '用户采纳了 harness 复盘设计来源',
    task: 'benchmark-growth',
    threshold: 3,
  });
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  assert.equal(first.source.status, 'candidate');
  assert.equal(first.source.sourceKey, 'example.com/docs');
  assert.equal(first.source.adoptedCount, 1);
  assert.equal(first.source.recentAdoptedCount, 1);
  assert.equal(first.source.promotion.windowDays, 7);
  assert.equal(first.recommended, false);

  await observeBenchmarkSourceWorkspace(project, {
    source: 'https://docs.example.com/docs/review-loop',
    notes: '同一 docs 来源再次被采纳',
    task: 'benchmark-growth',
    threshold: 3,
  });
  const third = await observeBenchmarkSourceWorkspace(project, {
    source: 'https://docs.example.com/docs/observe-source',
    notes: '第三次采纳，应该推荐 approve',
    task: 'benchmark-growth',
    threshold: 3,
  });
  assert.equal(third.created, false);
  assert.equal(third.source.id, first.source.id);
  assert.equal(third.source.adoptedCount, 3);
  assert.equal(third.source.recentAdoptedCount, 3);
  assert.equal(third.recommended, true);
  assert.equal(third.recommendation.approveCommand, `openprd benchmark approve ${first.source.id}`);

  const listed = await listBenchmarkWorkspace(project);
  assert.equal(listed.recommendations.length, 1);
  assert.equal(listed.recommendations[0].sourceKey, 'example.com/docs');
  assert.equal(listed.recommendations[0].adoptedCount, 3);
  assert.equal(listed.recommendations[0].windowDays, 7);
  assert.equal(listed.recommendations[0].totalAdoptedCount, 3);

  const growthReview = await reviewGrowthWorkspace(project);
  assert.equal(growthReview.benchmarkRecommendations.length, 1);
  assert.ok(growthReview.nextActions.some((item) => item.includes('example.com/docs')));

  const approveResult = await approveBenchmarkWorkspace(project, { id: first.source.id });
  assert.equal(approveResult.source.status, 'approved');
  assert.equal(approveResult.source.adoptedCount, 3);
});

test('benchmark recommendations use a rolling 7-day adoption window', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });
  const source = 'https://docs.example.com/docs/rolling-window';
  const now = Date.now();

  await observeBenchmarkSourceWorkspace(project, {
    source,
    notes: '八天前的一次采纳，不应计入最近 7 天',
    task: 'benchmark-window',
    threshold: 3,
    observedAt: new Date(now - (8 * 24 * 60 * 60 * 1000)).toISOString(),
  });
  await observeBenchmarkSourceWorkspace(project, {
    source,
    notes: '六天前的一次采纳，应计入最近 7 天',
    task: 'benchmark-window',
    threshold: 3,
    observedAt: new Date(now - (6 * 24 * 60 * 60 * 1000)).toISOString(),
  });
  const third = await observeBenchmarkSourceWorkspace(project, {
    source,
    notes: '今天的一次采纳，最近 7 天仍只有两次',
    task: 'benchmark-window',
    threshold: 3,
    observedAt: new Date(now).toISOString(),
  });

  assert.equal(third.source.adoptedCount, 3);
  assert.equal(third.source.recentAdoptedCount, 2);
  assert.equal(third.recommended, false);

  const fourth = await observeBenchmarkSourceWorkspace(project, {
    source,
    notes: '补足最近 7 天第三次采纳，才应该推荐 approve',
    task: 'benchmark-window',
    threshold: 3,
    observedAt: new Date(now - (1 * 24 * 60 * 60 * 1000)).toISOString(),
  });

  assert.equal(fourth.source.adoptedCount, 4);
  assert.equal(fourth.source.recentAdoptedCount, 3);
  assert.equal(fourth.recommended, true);

  const listed = await listBenchmarkWorkspace(project);
  assert.equal(listed.recommendations.length, 1);
  assert.equal(listed.recommendations[0].adoptedCount, 3);
  assert.equal(listed.recommendations[0].totalAdoptedCount, 4);
  assert.equal(listed.recommendations[0].windowDays, 7);
});

test('benchmark verify independently checks promotion control drift', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const observed = await observeBenchmarkSourceWorkspace(project, {
    source: 'https://docs.example.com/docs/control-drift',
    notes: '只采纳了一次，不该被推荐',
    task: 'benchmark-verify-control',
    threshold: 3,
  });

  const candidatePath = path.join(project, '.openprd', 'benchmarks', 'inbox', `${observed.source.id}.yaml`);
  const candidateText = await fs.readFile(candidatePath, 'utf8');
  await fs.writeFile(candidatePath, candidateText
    .replace('recommended: false', 'recommended: true')
    .replace('approveCommand: null', `approveCommand: openprd benchmark approve ${observed.source.id}`));

  const verifyResult = await verifyBenchmarkWorkspace(project);
  assert.equal(verifyResult.ok, false);
  const check = verifyResult.checks.find((item) => item.id === observed.source.id);
  assert.ok(check);
  assert.ok(check.issues.some((issue) => issue.code === 'promotion-control-drift'));
  assert.ok(check.issues.some((issue) => issue.code === 'stale-approve-command'));
  assert.ok(verifyResult.errors.some((item) => item.includes(observed.source.id)));
});

test('benchmark CLI commands add list approve verify', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });
  await fs.writeFile(
    path.join(project, '.openprd', 'benchmarks', 'sources.yaml'),
    [
      'version: 1',
      'schema: openprd.benchmarks.v1',
      'updatedAt: 2026-01-01 00:00:00',
      'sources: []',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(project, 'benchmark-cli-reference.md'), '# CLI Benchmark\n\n- doctor\n', 'utf8');

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['benchmark', 'add', 'benchmark-cli-reference.md', '--path', project, '--notes', '参考 CLI doctor 触发', '--json']), 0);
    const addPayload = JSON.parse(logs.pop());
    assert.equal(addPayload.ok, true);
    assert.equal(addPayload.source.status, 'candidate');

    assert.equal(await main(['benchmark', 'list', project, '--json']), 0);
    const listPayload = JSON.parse(logs.pop());
    assert.equal(listPayload.counts.candidates, 1);

    assert.equal(await main(['benchmark', 'approve', addPayload.source.id, '--path', project, '--json']), 0);
    const approvePayload = JSON.parse(logs.pop());
    assert.equal(approvePayload.source.status, 'approved');

    assert.equal(await main(['benchmark', 'verify', project, '--json']), 0);
    const verifyPayload = JSON.parse(logs.pop());
    assert.equal(verifyPayload.ok, true);
    assert.ok(Array.isArray(verifyPayload.checks));

    assert.equal(await main(['benchmark', 'observe', 'https://docs.example.com/docs/cli-review', '--path', project, '--notes', '用户采纳', '--threshold', '1', '--json']), 0);
    const observePayload = JSON.parse(logs.pop());
    assert.equal(observePayload.ok, true);
    assert.equal(observePayload.recommended, true);
    assert.equal(observePayload.source.adoptedCount, 1);
    assert.equal(observePayload.source.recentAdoptedCount, 1);
    assert.equal(observePayload.source.promotion.windowDays, 7);
  } finally {
    console.log = originalLog;
  }
});

test('knowledge candidate lifecycle list reject archive restore and quality counts pending only', async () => {
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
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'app.js'), 'export function app(req) { console.log({ trace_id: req.trace_id, request_id: req.request_id, task_id: req.task_id, user_session_id: req.user_session_id, error_id: req.error_id }); }\n');
  await fs.mkdir(path.join(project, 'test', 'fixtures'), { recursive: true });
  await fs.writeFile(path.join(project, 'test', 'fixtures', 'extreme.json'), '{"items":[1,2,3]}\n');
  await fs.mkdir(path.join(project, '.openprd', 'harness', 'test-reports'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'test-reports', 'knowledge-smoke.md'), [
    '# Knowledge lifecycle smoke',
    '',
    '- smoke: passed candidate review flow',
    '- feature coverage: no active change',
    '',
  ].join('\n'));

  async function writeCandidate(id, status, title) {
    const dir = path.join(project, '.openprd', 'knowledge', 'candidates', id);
    const draft = path.join(project, '.openprd', 'knowledge', 'drafts', `draft-${id}`, 'SKILL.md');
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(path.dirname(draft), { recursive: true });
    await fs.writeFile(draft, `---\nname: draft-${id}\ndescription: draft\n---\n\n# ${title}\n`);
    const candidatePath = path.join(dir, 'candidate.json');
    await fs.writeFile(candidatePath, `${JSON.stringify({
      version: 1,
      candidateId: id,
      status,
      createdAt: '2026-05-30 10:00:00',
      updatedAt: '2026-05-30 10:00:00',
      sourceKind: 'diagnostic-report',
      sourceRef: id,
      title,
      files: {
        candidate: candidatePath,
        candidateDir: dir,
        draftSkill: draft,
      },
    }, null, 2)}\n`);
    return { candidatePath, draft };
  }

  const pending = await writeCandidate('candidate-pending', 'pending-review', 'Pending candidate');
  await writeCandidate('candidate-noise', 'pending-review', 'Noise candidate');
  await writeCandidate('candidate-merged', 'pending-review', 'Merged candidate');
  await fs.mkdir(path.join(project, '.openprd', 'knowledge', 'skills', 'existing-skill'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'knowledge', 'skills', 'existing-skill', 'SKILL.md'), '---\nname: existing-skill\ndescription: existing\n---\n\n# Existing\n');
  await fs.writeFile(path.join(project, '.openprd', 'knowledge', 'index.json'), `${JSON.stringify({
    version: 1,
    updatedAt: '2026-05-30 10:00:00',
    incidents: [],
    patterns: [],
    skills: [
      {
        skillName: 'existing-skill',
        path: path.join(project, '.openprd', 'knowledge', 'skills', 'existing-skill', 'SKILL.md'),
        sourceKind: 'manual',
        sourceRef: 'existing',
      },
    ],
    candidates: [
      { candidateId: 'candidate-pending', status: 'pending-review', path: pending.candidatePath, title: 'Pending candidate', draftSkillPath: pending.draft },
      { candidateId: 'candidate-noise', status: 'reviewed-noise', title: 'Noise candidate' },
      { candidateId: 'candidate-merged', status: 'merged', title: 'Merged candidate' },
    ],
    drafts: [],
  }, null, 2)}\n`);

  const listed = await listKnowledgeCandidates(project);
  assert.equal(listed.counts.total, 3);
  assert.equal(listed.counts.pending, 1);
  assert.equal(listed.candidates.length, 1);
  assert.equal(listed.candidates[0].candidateId, 'candidate-pending');

  const rejected = await rejectKnowledgeCandidate(project, { id: 'candidate-pending', reason: 'UI iteration noise' });
  assert.equal(rejected.ok, true);
  assert.equal(rejected.candidate.status, 'rejected');
  const rejectedFile = JSON.parse(await fs.readFile(pending.candidatePath, 'utf8'));
  assert.equal(rejectedFile.status, 'rejected');
  assert.equal(rejectedFile.reviewReason, 'UI iteration noise');

  const afterReject = await listKnowledgeCandidates(project);
  assert.equal(afterReject.counts.pending, 0);
  assert.equal(afterReject.counts.rejected, 1);

  const archived = await archiveKnowledgeCandidate(project, { id: 'candidate-pending', reason: 'Superseded by merged skill' });
  assert.equal(archived.candidate.status, 'archived');
  const afterArchiveAll = await listKnowledgeCandidates(project, { status: 'all' });
  assert.equal(afterArchiveAll.counts.archived, 1);

  const restored = await restoreKnowledgeCandidate(project, { id: 'candidate-pending' });
  assert.equal(restored.candidate.status, 'pending-review');
  const afterRestore = await listKnowledgeCandidates(project);
  assert.equal(afterRestore.counts.pending, 1);

  await rejectKnowledgeCandidate(project, { id: 'candidate-pending', reason: 'Not reusable' });
  const quality = await verifyQualityWorkspace(project);
  assert.equal(quality.report.knowledge.candidateCounts.total, 3);
  assert.equal(quality.report.knowledge.candidateCounts.pending, 0);
  assert.deepEqual(quality.report.knowledge.candidates, []);
  assert.equal(quality.report.knowledge.warnings.some((warning) => warning.includes('待确认 knowledge candidate')), false);

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['knowledge', 'candidates', project, '--status', 'all', '--json']), 0);
    const listPayload = JSON.parse(logs.pop());
    assert.equal(listPayload.counts.total, 3);

    assert.equal(await main(['knowledge', 'restore', '--path', project, '--id', 'candidate-pending', '--json']), 0);
    const restorePayload = JSON.parse(logs.pop());
    assert.equal(restorePayload.candidate.status, 'pending-review');

    assert.equal(await main(['knowledge', 'archive', '--path', project, '--id', 'candidate-pending', '--reason', 'Handled elsewhere', '--json']), 0);
    const archivePayload = JSON.parse(logs.pop());
    assert.equal(archivePayload.candidate.status, 'archived');
    assert.equal(archivePayload.candidate.reviewReason, 'Handled elsewhere');
  } finally {
    console.log = originalLog;
  }
});

test('playground writes markdown-backed artifact and capture can import from artifact markdown', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await classifyWorkspace(project, 'consumer');
  await captureWorkspace(project, { field: 'problem.problemStatement', value: '旧问题定义', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'goals.goals', value: '旧目标1, 旧目标2', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'goals.successMetrics', value: '旧指标', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'scope.inScope', value: '旧范围内', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'scope.outOfScope', value: '旧范围外', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'scenarios.primaryFlows', value: '旧主流程', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'risks.openQuestions', value: '旧开放问题', source: 'user-confirmed' });
  await synthesizeWorkspace(project, {
    title: 'Playground Demo',
    owner: 'Codex',
    problemStatement: '旧问题定义',
    whyNow: '需要验证 playground roundtrip',
    productType: 'consumer',
  });

  const playground = await playgroundWorkspace(project, { open: false });
  assert.ok(playground.htmlPath.endsWith('artifact.html'));
  assert.ok(playground.markdownPath.endsWith('data.md'));
  const markdown = await fs.readFile(playground.markdownPath, 'utf8');
  assert.ok(markdown.includes('schema: openprd.artifact.v1'));
  assert.ok(markdown.includes('capturePatch:'));

  const updatedMarkdown = markdown
    .replace('"旧问题定义"', '"新问题定义"')
    .replace('- "旧目标1"', '- "新目标1"')
    .replace('- "旧目标2"', '- "新目标2"');
  await fs.writeFile(playground.markdownPath, updatedMarkdown);

  const imported = await captureWorkspace(project, { artifactMarkdown: playground.markdownPath });
  assert.equal(imported.artifactMarkdown, playground.markdownPath);
  const current = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'state', 'current.json'), 'utf8'));
  assert.equal(current.problemStatement, '新问题定义');
  assert.deepEqual(current.goals, ['新目标1', '新目标2']);
});

test('brainstorm writes stable html, markdown source and capture patch with benchmark and knowledge context', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });
  await captureWorkspace(project, { field: 'problem.problemStatement', value: '团队想先梳理新的 Agent 业务方向', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'users.primaryUsers', value: '产品负责人, 运营负责人', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'users.stakeholders', value: '销售负责人, 交付负责人', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'goals.goals', value: '先收敛第一版业务切片', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'goals.successMetrics', value: '一周内完成 PRD 定稿', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'scope.inScope', value: '梳理用户、商业目标和竞品', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'scope.outOfScope', value: '本轮先不直接开发', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'scenarios.primaryFlows', value: '先脑暴，再确认方向，再生成 PRD', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'typeSpecific.fields.asIs', value: '主要靠人工访谈和零散文档整理', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'typeSpecific.fields.toBe', value: '先形成可评审的方向梳理工作台', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.community', value: 'AI 创业社群, 现有客户群', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.seedUsers', value: '产品负责人, 交付负责人', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.currentAlternative', value: '顾问式访谈和手工表格跟进', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.communityFit', value: '我本来就在 AI 创业社群里持续回答需求梳理问题, 已有现成客户可以直接触达', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.painEvidence', value: '团队现在靠访谈和表格来回同步, 每次都要重复整理, 已经在花顾问预算', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.manualPath', value: '先做顾问式访谈, 手工整理成方向建议', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.manualPlaybook', value: '收到真实需求后开 30 分钟访谈, 用 Notion 模板整理方向, 2 小时内回发建议', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.commitmentSignals', value: '愿意拿真实项目试跑, 愿意安排 30 分钟共创', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.firstValidationStep', value: '先找 1 个真实项目做手工试跑', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.defaultAlivePlan', value: '两周内没试跑就先停在顾问式服务', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.paymentProof', value: '10 个样本里至少 3 个愿意按低价顾问包先付费试跑', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.mvpSlice', value: '先把需求讨论整理成可确认的执行清单', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.weekendTest', value: '周末内用顾问式试跑 1 个真实项目', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.smallestExecution', value: '先用 Notion 模板, 表单和 Airtable 跑起来, 不先做完整系统', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.productizeGate', value: '至少服务完 10 个付费客户且需求稳定两周后再考虑产品化', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.firstCustomerPath', value: '现有客户, AI 创业社群, 陌生线索', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.pricingHypothesis', value: '首个试跑按低价顾问包收费', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.customerOneProfitability', value: '单个试跑至少覆盖整理与复盘时间', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.growthDiscipline', value: '先现有客户再社群, 100 个付费客户前不做 launch, 先花时间别先花钱', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.reversibility', value: '如果两周无复购，就退回顾问式服务', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.customerTruth', value: '先看客户是否真的愿意拿真实需求来试跑', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'validation.valuesFit', value: '保持轻交付、强反馈、不靠堆功能', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'risks.assumptions', value: '现有项目里确实有可复用能力', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'risks.openQuestions', value: '现有项目里哪些能力可复用', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'businessGuardrails.stopLossActions', value: '如果两轮后仍无方向，就先停在调研结论', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'handoff.nextStep', value: '先找 1 个真实项目做低成本试跑', source: 'user-confirmed' });
  await addBenchmarkWorkspace(project, {
    source: 'https://github.com/Fission-AI/OpenSpec',
    notes: '参考独立 explore / spec 之前先探索的流程',
  });
  const benchmark = await addBenchmarkWorkspace(project, {
    source: 'https://github.com/obra/superpowers',
    notes: '参考强约束 brainstorm 到设计文档的过渡',
  });
  await approveBenchmarkWorkspace(project, { id: benchmark.source.id });

  const result = await brainstormWorkspace(project, {
    topic: 'Agent 业务方向梳理',
    open: false,
  });

  assert.ok(result.htmlPath.endsWith(path.join('.openprd', 'engagements', 'active', 'brainstorm.html')));
  assert.ok(result.markdownPath.endsWith('data.md'));
  assert.ok(result.patchPath.endsWith('capture-patch.json'));
  assert.ok(result.statePath.endsWith(path.join('.openprd', 'engagements', 'active', 'brainstorm.json')));

  const html = await fs.readFile(result.htmlPath, 'utf8');
  assert.ok(html.includes('OpenPrd / 方向梳理'));
  assert.ok(html.includes('先整理验证计划'));
  assert.ok(html.includes('按这个方向整理成 PRD'));
  assert.ok(html.includes('本次讨论的核心诉求'));
  assert.ok(html.includes('一眼看懂这次讨论'));
  assert.ok(html.includes('先验证什么，再决定做多大'));
  assert.ok(html.includes('brainstorm-visual-svg-wrap'));
  assert.ok(html.includes('role="img" aria-label="一眼看懂这次讨论"'));
  assert.ok(html.includes('role="img" aria-label="先验证什么，再决定做多大"'));
  assert.ok(html.includes('现在主要怎么解决'));
  assert.ok(html.includes('极简判断'));
  assert.ok(html.includes('假设与验证'));
  assert.equal(html.includes('回填与文件入口'), false);
  assert.equal(html.includes('JTBD'), false);

  const markdown = await fs.readFile(result.markdownPath, 'utf8');
  assert.ok(markdown.includes('kind: brainstorm'));
  assert.ok(markdown.includes('capturePatch:'));
  assert.ok(markdown.includes('## 当前替代方案'));
  assert.ok(markdown.includes('## 验证闭环'));
  assert.ok(markdown.includes('## 商业闭环'));
  assert.ok(markdown.includes('## 一件事 MVP 与成交路径'));
  assert.ok(markdown.includes('## 极简判断'));
  assert.ok(markdown.includes('## 假设与验证'));

  const patch = JSON.parse(await fs.readFile(result.patchPath, 'utf8'));
  assert.equal(patch['problem.problemStatement'].value, '团队想先梳理新的 Agent 业务方向');
  assert.deepEqual(patch['users.primaryUsers'].value, ['产品负责人', '运营负责人']);
  assert.deepEqual(patch['users.stakeholders'].value, ['销售负责人', '交付负责人']);
  assert.equal(patch['typeSpecific.fields.asIs'].value, '主要靠人工访谈和零散文档整理');
  assert.deepEqual(patch['validation.community'].value, ['AI 创业社群', '现有客户群']);
  assert.deepEqual(patch['validation.communityFit'].value, ['我本来就在 AI 创业社群里持续回答需求梳理问题', '已有现成客户可以直接触达']);
  assert.equal(patch['validation.currentAlternative'].value, '顾问式访谈和手工表格跟进');
  assert.deepEqual(patch['validation.painEvidence'].value, ['团队现在靠访谈和表格来回同步', '每次都要重复整理', '已经在花顾问预算']);
  assert.deepEqual(patch['validation.manualPath'].value, ['先做顾问式访谈', '手工整理成方向建议']);
  assert.deepEqual(patch['validation.manualPlaybook'].value, ['收到真实需求后开 30 分钟访谈', '用 Notion 模板整理方向', '2 小时内回发建议']);
  assert.deepEqual(patch['validation.commitmentSignals'].value, ['愿意拿真实项目试跑', '愿意安排 30 分钟共创']);
  assert.equal(patch['validation.firstValidationStep'].value, '先找 1 个真实项目做手工试跑');
  assert.deepEqual(patch['validation.defaultAlivePlan'].value, ['两周内没试跑就先停在顾问式服务']);
  assert.deepEqual(patch['validation.paymentProof'].value, ['10 个样本里至少 3 个愿意按低价顾问包先付费试跑']);
  assert.equal(patch['validation.mvpSlice'].value, '先把需求讨论整理成可确认的执行清单');
  assert.equal(patch['validation.weekendTest'].value, '周末内用顾问式试跑 1 个真实项目');
  assert.deepEqual(patch['validation.smallestExecution'].value, ['先用 Notion 模板', '表单和 Airtable 跑起来', '不先做完整系统']);
  assert.deepEqual(patch['validation.productizeGate'].value, ['至少服务完 10 个付费客户且需求稳定两周后再考虑产品化']);
  assert.deepEqual(patch['validation.firstCustomerPath'].value, ['现有客户', 'AI 创业社群', '陌生线索']);
  assert.equal(patch['validation.pricingHypothesis'].value, '首个试跑按低价顾问包收费');
  assert.equal(patch['validation.customerOneProfitability'].value, '单个试跑至少覆盖整理与复盘时间');
  assert.deepEqual(patch['validation.growthDiscipline'].value, ['先现有客户再社群', '100 个付费客户前不做 launch', '先花时间别先花钱']);
  assert.equal(patch['validation.reversibility'].value, '如果两周无复购，就退回顾问式服务');
  assert.equal(patch['validation.customerTruth'].value, '先看客户是否真的愿意拿真实需求来试跑');
  assert.equal(patch['validation.valuesFit'].value, '保持轻交付、强反馈、不靠堆功能');
  assert.deepEqual(patch['risks.assumptions'].value, ['现有项目里确实有可复用能力']);
  assert.deepEqual(patch['businessGuardrails.stopLossActions'].value, ['如果两轮后仍无方向，就先停在调研结论']);

  const state = JSON.parse(await fs.readFile(result.statePath, 'utf8'));
  assert.equal(state.topic, 'Agent 业务方向梳理');
  assert.equal(state.summary.currentAlternative, '现在主要还是靠“顾问式访谈和手工表格跟进”在解决');
  assert.deepEqual(state.captureState.community, ['AI 创业社群', '现有客户群']);
  assert.deepEqual(state.captureState.communityFit, ['我本来就在 AI 创业社群里持续回答需求梳理问题', '已有现成客户可以直接触达']);
  assert.deepEqual(state.captureState.manualPath, ['先做顾问式访谈', '手工整理成方向建议']);
  assert.deepEqual(state.captureState.manualPlaybook, ['收到真实需求后开 30 分钟访谈', '用 Notion 模板整理方向', '2 小时内回发建议']);
  assert.deepEqual(state.captureState.commitmentSignals, ['愿意拿真实项目试跑', '愿意安排 30 分钟共创']);
  assert.equal(state.captureState.firstValidationStep, '先找 1 个真实项目做手工试跑');
  assert.deepEqual(state.captureState.paymentProof, ['10 个样本里至少 3 个愿意按低价顾问包先付费试跑']);
  assert.equal(state.captureState.mvpSlice, '先把需求讨论整理成可确认的执行清单');
  assert.deepEqual(state.captureState.smallestExecution, ['先用 Notion 模板', '表单和 Airtable 跑起来', '不先做完整系统']);
  assert.deepEqual(state.captureState.productizeGate, ['至少服务完 10 个付费客户且需求稳定两周后再考虑产品化']);
  assert.equal(state.captureState.pricingHypothesis, '首个试跑按低价顾问包收费');
  assert.ok(Array.isArray(state.report.validationLoop));
  assert.ok(state.report.validationLoop.some((item) => item.includes('当前主要替代方案是：顾问式访谈和手工表格跟进')));
  assert.ok(state.report.validationLoop.some((item) => item.includes('你更像这个圈子的自己人')));
  assert.ok(state.report.validationLoop.some((item) => item.includes('手工作战卡')));
  assert.ok(Array.isArray(state.report.businessViability));
  assert.ok(state.report.businessViability.some((item) => item.includes('先用这种承诺证明值得继续')));
  assert.ok(state.report.businessViability.some((item) => item.includes('付费证明')));
  assert.ok(state.report.businessViability.some((item) => item.includes('增长纪律')));
  assert.ok(Array.isArray(state.report.minimalistReview));
  assert.ok(state.report.minimalistReview.some((item) => item.includes('更小的执行方式')));
  assert.ok(state.report.minimalistReview.some((item) => item.includes('客户真问题校验')));
  assert.equal(state.benchmark.counts.approved >= 1, true);
  assert.equal(state.knowledge.counts.skills >= 0, true);
  assert.equal(Array.isArray(state.workspaceScan.docs), true);
});

test('brainstorm-presentation writes validated presentation and re-renders brainstorm html', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });
  await captureWorkspace(project, { field: 'problem.problemStatement', value: '需要先把复杂需求梳理清楚', source: 'user-confirmed' });
  await captureWorkspace(project, { field: 'goals.goals', value: '先确认推荐方向', source: 'user-confirmed' });

  await brainstormWorkspace(project, {
    topic: '复杂需求脑暴',
    open: false,
  });

  const presentationPath = await writeAnswersFile(project, 'brainstorm-presentation.json', {
    brainstormPresentation: {
      hero: {
        summary: '这次先把复杂需求里的业务目标、用户场景、可复用能力和风险一起梳理清楚，再进入 PRD。',
        direction: '先收敛第一版做法',
        confidence: '还差 1 轮用户确认',
      },
      visualScenes: [
        {
          type: 'validation-ladder',
          title: '先验证什么',
          subtitle: '先把关键前提、验证动作和止损线摆出来。',
          items: [
            { label: '关键前提', title: '先确认用户真会用', detail: '先找最近一次真实案例，验证这是不是高频问题。', tone: 'risk' },
            { label: '先怎么验', title: '先做一轮访谈', detail: '先补 3 个真实案例，再决定要不要进入完整 PRD。', tone: 'map' },
            { label: '什么算过', title: '先定义过关标准', detail: '如果 3 个案例都指向同一问题，就继续收敛第一版。', tone: 'success' },
            { label: '什么先停', title: '提前约定止损线', detail: '如果真实案例分散，就先停在调研结论。', tone: 'guardrail' },
          ],
        },
      ],
      panels: {
        userSignals: [{ summary: '现在怎么做', detail: '先说清现在主要靠什么办法在解决。' }],
        marketSignals: [{ summary: '推荐方向', detail: '先收敛第一版做法，再决定要不要继续放大范围。' }],
        reuseOpportunities: [{ summary: '关键参与方', detail: '先补齐谁会拍板、谁会受影响。' }],
        risks: [{ summary: '止损线', detail: '如果真实案例分散，就先停在调研结论。' }],
      },
    },
  });

  const result = await brainstormPresentationWorkspace(project, {
    presentationPath,
    write: true,
  });
  assert.equal(result.ok, true);
  assert.ok(result.htmlPath.endsWith(path.join('.openprd', 'engagements', 'active', 'brainstorm.html')));

  const state = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'engagements', 'active', 'brainstorm.json'), 'utf8'));
  assert.equal(state.brainstormPresentationMeta.validator, 'openprd brainstorm-presentation');

  const html = await fs.readFile(result.htmlPath, 'utf8');
  assert.ok(html.includes('还差 1 轮用户确认'));
  assert.ok(html.includes('先收敛第一版做法'));
  assert.ok(html.includes('目前更建议的方向'));
  assert.ok(html.includes('先验证什么'));
  assert.ok(html.includes('关键前提'));
  assert.ok(html.includes('role="img" aria-label="先验证什么"'));
});

test('learning review toggles mode and generates archived reader package', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });

  const disabled = await setLearningReviewModeWorkspace(project, false);
  assert.equal(disabled.ok, true);
  assert.equal(disabled.enabled, false);

  const skipped = await generateLearningReviewWorkspace(project, {
    topic: 'OpenPrd learning smoke',
    open: false,
    respectConfig: true,
  });
  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, true);

  const enabled = await setLearningReviewModeWorkspace(project, true);
  assert.equal(enabled.ok, true);
  assert.equal(enabled.enabled, true);

  const generated = await generateLearningReviewWorkspace(project, {
    topic: 'OpenPrd learning smoke',
    genre: 'xianxia',
    sourceScope: 'all',
    open: true,
    respectConfig: true,
  });
  assert.equal(generated.ok, true);
  assert.equal(generated.skipped, false);
  assert.equal(generated.genre.id, 'xianxia');
  assert.equal(generated.packageMeta.styleId, 'cultivation');
  assert.equal(generated.opened, false);
  assert.equal(generated.packageMeta.autoOpen, false);
  assert.equal(generated.packageMeta.paths.readerHtml, generated.packagePaths.readerHtml);

  for (const filePath of [
    generated.packagePaths.readerHtml,
    generated.packagePaths.assetsDir,
    generated.packagePaths.packageJson,
    generated.packagePaths.contentJson,
    generated.packagePaths.contentMarkdown,
    generated.packagePaths.evidenceManifest,
    generated.packagePaths.agentContext,
    generated.packagePaths.agentPrompt,
  ]) {
    assert.ok(await fs.stat(filePath).then(() => true));
  }

  const html = await fs.readFile(generated.packagePaths.readerHtml, 'utf8');
  assert.ok(html.includes('OpenPrd 复盘学习阅读器'));
  assert.ok(html.includes('书籍大纲'));
  assert.ok(html.includes('还没有生成可阅读正文'));
  assert.ok(html.includes('重渲染命令'));
  assert.equal(html.includes('Evidence Manifest</p>'), false);
  const content = JSON.parse(await fs.readFile(generated.packagePaths.contentJson, 'utf8'));
  assert.equal(content.schema, 'openprd.learning-content.v1');
  assert.equal(content.authoringStatus, 'awaiting-agent-content');
  assert.equal(content.title, '');
  assert.equal(content.genre.id, 'xianxia');
  assert.equal(content.stylePromptPack.id, 'xianxia.cultivation');
  assert.equal(content.stylePromptEngineering.prompts.proseRewrite.includes('立基/观脉/破境/传功/归元'), true);
  assert.equal(content.styleTransfer.agentLoopRequired, true);
  assert.equal(Array.isArray(content.outline), true);
  assert.equal(content.outline.length, 0);
  assert.equal(content.chapters.length, 0);
  assert.equal(generated.packageMeta.genreId, 'xianxia');
  assert.equal(generated.packageMeta.needsAgentDraft, true);
  const agentContext = JSON.parse(await fs.readFile(generated.packagePaths.agentContext, 'utf8'));
  assert.equal(agentContext.schema, 'openprd.learning-agent-context.v1');
  assert.equal(agentContext.outputContract.agentOwnedFields.includes('title'), true);
  assert.equal(agentContext.paths.assetsDir.endsWith('/assets'), true);
  const agentPrompt = await fs.readFile(generated.packagePaths.agentPrompt, 'utf8');
  assert.ok(agentPrompt.includes('请你亲自完成复盘学习正文'));
  assert.ok(agentPrompt.includes('visualExplainer'));
  assert.ok(agentPrompt.includes('图片素材目录'));

  const authoredPath = path.join(project, 'authored-learning-content.json');
  const visualAssetPath = path.join(project, 'visual-explainer.svg');
  await fs.writeFile(visualAssetPath, '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#e5f1ee"/><text x="24" y="104" font-size="22" fill="#13736b">visual explainer</text></svg>\n');
  await fs.writeFile(authoredPath, `${JSON.stringify({
    schema: 'openprd.learning-content.v1',
    title: 'Agent 写出的任务复盘',
    subtitle: '围绕真实证据生成',
    learningGoals: ['看懂这次任务为什么完成。'],
    overviewParagraphs: ['这段由 Agent 根据证据写入。'],
    outline: [
      {
        id: 'chapter-1',
        depth: 1,
        title: '第 1 章 · 任务证据',
        subtitle: '从 current-state 开始',
        children: [],
      },
    ],
    chapters: [
      {
        id: 'chapter-1',
        label: '任务证据',
        semanticTitle: '从状态文件确认完成',
        summary: '复盘先回到可验证状态。',
        visualExplainer: {
          title: '像开店前先做联合质检',
          analogy: '不是马上开门营业，而是先让不同角色各自找问题。',
          scene: '产品先看用户旅程，工程再看实现风险，最后负责人再决定要不要上线。',
          whyItMatters: '读者可以先理解决策顺序，再回到具体证据。',
          takeaways: ['先独立看', '后统一判', '再决定上不上'],
          image: {
            path: visualAssetPath,
            alt: '联合质检的学习包示意图',
            caption: '图片只用于帮助理解，不替代证据。',
          },
        },
        paragraphs: ['Agent 先读取 current-state，再把任务结论写成可回溯的正文。'],
        retrievalBlocks: [
          {
            prompt: '这次复盘第一条证据是什么？',
            hint: '看 evidenceIds。',
            answer: 'current-state。',
          },
        ],
        workedExamples: [
          {
            title: '用证据写正文',
            scenario: 'Agent 需要写出任务相关内容。',
            steps: ['读取 evidence-manifest。', '引用 source id。'],
            principle: '正文跟着证据走。',
          },
        ],
        evidenceIds: ['current-state'],
      },
    ],
    nextActions: ['打开 reader.html 检查正文。'],
  }, null, 2)}\n`);
  const authored = await generateLearningReviewWorkspace(project, {
    topic: 'OpenPrd learning smoke',
    genre: 'xianxia',
    sourceScope: 'all',
    contentJson: authoredPath,
    open: false,
    respectConfig: true,
  });
  assert.equal(authored.ok, true);
  assert.equal(authored.content.authoringStatus, 'agent-authored');
  assert.equal(authored.content.title, 'Agent 写出的任务复盘');
  assert.equal(authored.packageMeta.needsAgentDraft, false);
  const authoredHtml = await fs.readFile(authored.packagePaths.readerHtml, 'utf8');
  assert.ok(authoredHtml.includes('Agent 写出的任务复盘'));
  assert.ok(authoredHtml.includes('一眼看懂'));
  assert.ok(authoredHtml.includes('像开店前先做联合质检'));
  assert.ok(authoredHtml.includes('图片只用于帮助理解，不替代证据。'));
  assert.ok(authoredHtml.includes('联合质检的学习包示意图'));
  assert.ok(authoredHtml.includes('Agent 先读取 current-state'));
  assert.ok(authoredHtml.includes('content: "▸"'));
  assert.ok(authoredHtml.includes('evidence-summary-title'));
  assert.ok(authoredHtml.includes('1 个来源'));
  assert.equal(authoredHtml.includes('张图卡'), false);

  const current = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'state', 'current.json'), 'utf8'));
  assert.equal(current.learningReview.lastPackageId, authored.packageId);
  assert.equal(current.learningReview.lastAuthoringStatus, 'agent-authored');
  const learningIndex = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'learning', 'index.json'), 'utf8'));
  assert.equal(learningIndex.currentPackageId, authored.packageId);
});

test('internet-product learning review steers Agent toward design principles instead of technical inventory', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });

  const generated = await generateLearningReviewWorkspace(project, {
    topic: 'Harbor & Leaf build review',
    sourceScope: 'workspace',
    open: false,
    respectConfig: true,
  });

  assert.equal(generated.ok, true);
  assert.equal(generated.genre.id, 'internet-product');

  const content = JSON.parse(await fs.readFile(generated.packagePaths.contentJson, 'utf8'));
  assert.equal(content.genre.chapterLabels[0], '问题与价值');
  assert.equal(content.genre.chapterLabels[2], '取舍与原理');
  assert.equal(content.stylePromptPack.id, 'internet-product.teaching-brief');
  assert.equal(content.stylePromptEngineering.prompts.system.includes('产品设计思路'), true);
  assert.equal(content.stylePromptEngineering.prompts.proseRewrite.includes('不要按文件名、模块名、技术名词逐项介绍'), true);
  assert.equal(content.stylePromptEngineering.prompts.chapter.includes('visualExplainer'), true);

  const agentContext = JSON.parse(await fs.readFile(generated.packagePaths.agentContext, 'utf8'));
  assert.equal(agentContext.outputContract.rules.some((rule) => rule.includes('技术说明书')), true);
  assert.equal(agentContext.outputContract.chapterShape.optional.includes('visualExplainer'), true);

  const agentPrompt = await fs.readFile(generated.packagePaths.agentPrompt, 'utf8');
  assert.equal(agentPrompt.includes('不要把正文写成技术说明书'), true);
  assert.equal(agentPrompt.includes('为什么这样设计'), true);
  assert.equal(agentPrompt.includes('比喻卡'), true);
});

test('internet-product authored learning content rejects technical-manual narration', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });

  const authoredPath = path.join(project, 'manualish-learning-content.json');
  await fs.writeFile(authoredPath, `${JSON.stringify({
    schema: 'openprd.learning-content.v1',
    title: 'OpenPrd 建站复核说明',
    subtitle: '按文件和命令逐项整理',
    learningGoals: ['看完文件路径后继续操作。'],
    overviewParagraphs: ['先看 docs/basic/file-structure.md，再看 .openprd/state/current.json，最后看 reader.html 与 script.js。'],
    outline: [
      {
        id: 'chapter-1',
        depth: 1,
        title: '第 1 章 · 文件清单',
        subtitle: '按目录顺序阅读',
        children: [],
      },
    ],
    chapters: [
      {
        id: 'chapter-1',
        label: '文件清单',
        semanticTitle: '按模块和命令顺序介绍',
        summary: '先列路径，再列脚本和命令。',
        paragraphs: [
          'docs/basic/prd.md、docs/basic/tech-stack.md、.openprd/state/current.json、reader.html、script.js 和 package.json 都要逐个介绍。',
          '最后再补 openprd learn . --content-json 与 openprd run . --context 这些命令的执行顺序。',
        ],
        evidenceIds: ['current-state', 'docs-basic-file-structure'],
      },
    ],
    nextActions: ['继续检查 docs/basic/app-flow.md。'],
  }, null, 2)}\n`);

  await assert.rejects(
    () => generateLearningReviewWorkspace(project, {
      topic: 'OpenPrd manual smell',
      sourceScope: 'workspace',
      contentJson: authoredPath,
      open: false,
      respectConfig: true,
    }),
    /internet-product 复盘必须|技术说明书/
  );
});
