import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildChangeEntry, buildTaskCommitMessage, USER_CHANGE_SUMMARY_GUIDE } from '../src/change-summary.js';
import { printInitResult } from '../src/cli/print.js';

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
  designStarterWorkspace,
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

test('change summary formatter prefers user-visible verbs for commits and summaries', () => {
  const entry = buildChangeEntry('支持用户直接查看版本说明', { fallbackType: '新增' });
  assert.equal(entry?.type, '新增');
  assert.equal(entry?.summary.startsWith('新增'), true);
  assert.equal(entry?.detail.includes('用户直接查看版本说明'), true);

  const commitMessage = buildTaskCommitMessage({
    id: 'T001.02',
    title: '统一 review 摘要文案',
    done: '让用户先看懂新增、修复、优化结果',
  });
  assert.equal(commitMessage.startsWith('优化'), true);
  assert.ok(commitMessage.includes('- 优化：让用户先看懂新增、修复、优化结果'));
  assert.ok(commitMessage.includes('- 任务：T001.02 统一 review 摘要文案'));
  assert.equal(commitMessage.includes('Complete T001.02'), false);
  assert.deepEqual(USER_CHANGE_SUMMARY_GUIDE.preferredVerbs, ['新增', '修复', '优化', '调整', '移除']);
});

test('isolated Codex worker script bypasses noisy user Codex home and preserves outputs', async () => {
  const project = await makeTempProject();
  const noisyCodexHome = path.join(project, 'noisy-codex-home');
  const legacyBin = path.join(project, 'legacy-bin');
  const modernBin = path.join(project, 'modern-bin');
  const legacyCodexPath = path.join(legacyBin, 'codex');
  const modernCodexPath = path.join(modernBin, 'codex');
  const promptFile = path.join(project, 'prompt.txt');
  const outputJsonl = path.join(project, 'artifacts', 'worker-output.jsonl');
  const outputLastMessage = path.join(project, 'artifacts', 'last-message.txt');
  const fakeCodexLog = path.join(project, 'fake-codex-log.json');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const isolatedWorkerScript = path.join(repoRoot, 'scripts', 'openprd-codex-isolated-worker.mjs');

  await fs.mkdir(noisyCodexHome, { recursive: true });
  await fs.writeFile(path.join(noisyCodexHome, 'auth.json'), JSON.stringify({ access_token: 'test-token' }, null, 2));
  await fs.writeFile(path.join(noisyCodexHome, 'config.toml'), [
    'model = "gpt-5.4"',
    'service_tier = "default"',
    '',
  ].join('\n'));
  await fs.mkdir(legacyBin, { recursive: true });
  await fs.writeFile(legacyCodexPath, [
    '#!/usr/bin/env node',
    'const args = process.argv.slice(2);',
    "if (args.includes('--help')) {",
    "  process.stdout.write('Usage: codex exec [OPTIONS] [PROMPT]\\n');",
    '  process.exit(0);',
    '}',
    "console.error('legacy codex should not be executed');",
    'process.exit(97);',
    '',
  ].join('\n'));
  await fs.chmod(legacyCodexPath, 0o755);
  await fs.mkdir(modernBin, { recursive: true });
  await fs.writeFile(modernCodexPath, [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const args = process.argv.slice(2);',
    "if (args.includes('--help')) {",
    "  process.stdout.write('Usage: codex exec [OPTIONS] [PROMPT]\\n      --dangerously-bypass-hook-trust\\n');",
    '  process.exit(0);',
    '}',
    "const stdin = fs.readFileSync(0, 'utf8');",
    'const payload = {',
    '  args,',
    '  stdin,',
    '  cwd: process.cwd(),',
    '  commandPath: process.argv[1],',
    '  env: {',
    '    CODEX_HOME: process.env.CODEX_HOME,',
    '    OPENPRD_CODEX_HOME: process.env.OPENPRD_CODEX_HOME,',
    '  },',
    '};',
    'fs.writeFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(payload, null, 2));',
    'if (process.env.CODEX_HOME === process.env.FAKE_NOISY_CODEX_HOME) {',
    "  console.error(\"Error loading config.toml: unknown variant 'default'\");",
    '  process.exit(64);',
    '}',
    "const outputIndex = args.indexOf('-o');",
    'if (outputIndex >= 0 && args[outputIndex + 1]) {',
    '  fs.mkdirSync(path.dirname(args[outputIndex + 1]), { recursive: true });',
    "  fs.writeFileSync(args[outputIndex + 1], 'final response\\n');",
    '}',
    "if (args.includes('--json')) {",
    "  process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'thread_test' }) + '\\n');",
    "  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'final response' } }) + '\\n');",
    '} else {',
    "  process.stdout.write('final response\\n');",
    '}',
    '',
  ].join('\n'));
  await fs.chmod(modernCodexPath, 0o755);
  await fs.writeFile(promptFile, 'reply with ok\n');

  const result = spawnSync('node', [
    isolatedWorkerScript,
    '--cwd', project,
    '--prompt-file', promptFile,
    '--output-jsonl', outputJsonl,
    '--output-last-message', outputLastMessage,
    '--source-codex-home', noisyCodexHome,
    '--full-auto',
    '--skip-git-repo-check',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${legacyBin}:${modernBin}:${process.env.PATH}`,
      FAKE_CODEX_LOG: fakeCodexLog,
      FAKE_NOISY_CODEX_HOME: noisyCodexHome,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const log = JSON.parse(await fs.readFile(fakeCodexLog, 'utf8'));
  assert.equal(log.commandPath, modernCodexPath);
  assert.equal(log.env.CODEX_HOME === noisyCodexHome, false);
  assert.equal(log.env.CODEX_HOME, log.env.OPENPRD_CODEX_HOME);
  assert.ok(log.env.CODEX_HOME.includes('openprd-codex-home-'));
  assert.equal(await pathExists(log.env.CODEX_HOME), false);
  assert.equal(log.cwd, await fs.realpath(project));
  assert.ok(log.args.includes('--json'));
  assert.ok(log.args.includes('--skip-git-repo-check'));
  assert.ok(log.args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(log.args.includes('--dangerously-bypass-hook-trust'));
  assert.ok(log.args.includes('--model'));
  assert.ok(log.args.includes('gpt-5.4'));
  assert.equal(log.stdin, 'reply with ok\n');
  assert.ok((await fs.readFile(outputJsonl, 'utf8')).includes('"thread.started"'));
  assert.equal((await fs.readFile(outputLastMessage, 'utf8')).trim(), 'final response');
});

test('isolated Codex worker script auto-resumes when starter output never gets overwritten', async () => {
  const project = await makeTempProject();
  const noisyCodexHome = path.join(project, 'noisy-codex-home');
  const fakeBin = path.join(project, 'fake-bin');
  const fakeCodexPath = path.join(fakeBin, 'codex');
  const promptFile = path.join(project, 'prompt.txt');
  const outputJsonl = path.join(project, 'artifacts', 'worker-output.jsonl');
  const outputLastMessage = path.join(project, 'artifacts', 'last-message.txt');
  const fakeCodexLog = path.join(project, 'fake-codex-log.jsonl');
  const fakeCodexCounter = path.join(project, 'fake-codex-counter.txt');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const isolatedWorkerScript = path.join(repoRoot, 'scripts', 'openprd-codex-isolated-worker.mjs');

  await fs.mkdir(noisyCodexHome, { recursive: true });
  await fs.writeFile(path.join(noisyCodexHome, 'auth.json'), JSON.stringify({ access_token: 'test-token' }, null, 2));
  await fs.writeFile(path.join(noisyCodexHome, 'config.toml'), 'model = "gpt-5.4"\n');
  await fs.mkdir(path.join(project, '.openprd', 'state'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'state', 'events.jsonl'), `${JSON.stringify({
    type: 'design_starter_created',
    at: '2026-06-09 10:02:37',
    output: 'index.html',
  })}\n`);
  await fs.writeFile(path.join(project, 'index.html'), '<!doctype html><html><body>starter</body></html>\n');
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(fakeCodexPath, [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const args = process.argv.slice(2);',
    "if (args.includes('--help')) {",
    "  process.stdout.write('Usage: codex exec [OPTIONS] [PROMPT]\\n      --dangerously-bypass-hook-trust\\n');",
    '  process.exit(0);',
    '}',
    "const stdin = fs.readFileSync(0, 'utf8');",
    'const counterPath = process.env.FAKE_CODEX_COUNTER;',
    'let count = 0;',
    'try {',
    "  count = Number(fs.readFileSync(counterPath, 'utf8').trim()) || 0;",
    '} catch {}',
    'count += 1;',
    "fs.writeFileSync(counterPath, String(count));",
    'const payload = {',
    '  invocation: count,',
    '  args,',
    '  stdin,',
    '  cwd: process.cwd(),',
    '};',
    "fs.appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(payload) + '\\n');",
    "const outputIndex = args.indexOf('-o');",
    'if (outputIndex >= 0 && args[outputIndex + 1]) {',
    '  fs.mkdirSync(path.dirname(args[outputIndex + 1]), { recursive: true });',
    "  fs.writeFileSync(args[outputIndex + 1], count === 1 ? 'first pass\\n' : 'second pass\\n');",
    '}',
    'if (count === 2) {',
    "  fs.writeFileSync(path.join(process.cwd(), 'index.html'), '<!doctype html><html><body>landed</body></html>\\n');",
    '}',
    "process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'thread_test' }) + '\\n');",
    "process.stdout.write(JSON.stringify({ type: 'item.completed', item: { id: `item_${count}`, type: 'agent_message', text: count === 1 ? 'first pass' : 'second pass' } }) + '\\n');",
    '',
  ].join('\n'));
  await fs.chmod(fakeCodexPath, 0o755);
  await fs.writeFile(promptFile, 'reply with ok\n');

  const result = spawnSync('node', [
    isolatedWorkerScript,
    '--cwd', project,
    '--prompt-file', promptFile,
    '--output-jsonl', outputJsonl,
    '--output-last-message', outputLastMessage,
    '--source-codex-home', noisyCodexHome,
    '--full-auto',
    '--skip-git-repo-check',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      FAKE_CODEX_LOG: fakeCodexLog,
      FAKE_CODEX_COUNTER: fakeCodexCounter,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const invocations = await readJsonl(fakeCodexLog);
  assert.equal(invocations.length, 2);
  assert.deepEqual(invocations[0].args.slice(0, 2), ['exec', '--json']);
  assert.deepEqual(invocations[1].args.slice(0, 3), ['exec', 'resume', 'thread_test']);
  assert.ok(invocations[1].stdin.includes('不要继续搜集资料'));
  assert.equal((await fs.readFile(path.join(project, 'index.html'), 'utf8')).includes('landed'), true);
  const output = await fs.readFile(outputJsonl, 'utf8');
  assert.ok(output.includes('thread_test'));
  assert.equal((await fs.readFile(outputLastMessage, 'utf8')).trim(), 'second pass');
});

test('isolated Codex worker script auto-resumes when Patch Mode stalls after a write attempt', async () => {
  const project = await makeTempProject();
  const noisyCodexHome = path.join(project, 'noisy-codex-home');
  const fakeBin = path.join(project, 'fake-bin');
  const fakeCodexPath = path.join(fakeBin, 'codex');
  const promptFile = path.join(project, 'prompt.txt');
  const outputJsonl = path.join(project, 'artifacts', 'worker-output.jsonl');
  const outputLastMessage = path.join(project, 'artifacts', 'last-message.txt');
  const fakeCodexLog = path.join(project, 'fake-codex-log.jsonl');
  const fakeCodexCounter = path.join(project, 'fake-codex-counter.txt');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const isolatedWorkerScript = path.join(repoRoot, 'scripts', 'openprd-codex-isolated-worker.mjs');

  await fs.mkdir(noisyCodexHome, { recursive: true });
  await fs.writeFile(path.join(noisyCodexHome, 'auth.json'), JSON.stringify({ access_token: 'test-token' }, null, 2));
  await fs.writeFile(path.join(noisyCodexHome, 'config.toml'), 'model = "gpt-5.4"\n');
  await fs.mkdir(path.join(project, '.openprd', 'state'), { recursive: true });
  await fs.mkdir(path.join(project, '.openprd', 'harness'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'state', 'events.jsonl'), `${JSON.stringify({
    type: 'design_starter_created',
    at: '2026-06-09 10:02:37',
    output: 'index.html',
  })}\n`);
  await fs.writeFile(path.join(project, 'index.html'), '<!doctype html><html><body>starter</body></html>\n');
  const nowMs = Date.now();
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'patch-mode-gate.json'), JSON.stringify({
    version: 1,
    active: true,
    status: 'write-attempted',
    phase: 'strict',
    targetFile: 'index.html',
    targetHashAtArm: '8666f166dbf8513f',
    fileHashesAtArm: {
      'index.html': '8666f166dbf8513f',
    },
    draftFiles: [],
    armedAtMs: nowMs,
    lastWriteAttemptAtMs: nowMs,
  }, null, 2));
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(fakeCodexPath, [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const args = process.argv.slice(2);',
    "if (args.includes('--help')) {",
    "  process.stdout.write('Usage: codex exec [OPTIONS] [PROMPT]\\n      --dangerously-bypass-hook-trust\\n');",
    '  process.exit(0);',
    '}',
    'const counterPath = process.env.FAKE_CODEX_COUNTER;',
    'let count = 0;',
    'try {',
    "  count = Number(fs.readFileSync(counterPath, 'utf8').trim()) || 0;",
    '} catch {}',
    'count += 1;',
    "fs.writeFileSync(counterPath, String(count));",
    "const stdin = fs.readFileSync(0, 'utf8');",
    'const payload = {',
    '  invocation: count,',
    '  args,',
    '  stdin,',
    '  cwd: process.cwd(),',
    '};',
    "fs.appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(payload) + '\\n');",
    "const outputIndex = args.indexOf('-o');",
    'if (outputIndex >= 0 && args[outputIndex + 1]) {',
    '  fs.mkdirSync(path.dirname(args[outputIndex + 1]), { recursive: true });',
    "  fs.writeFileSync(args[outputIndex + 1], count === 1 ? 'stalled pass\\n' : 'resumed pass\\n');",
    '}',
    "process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'thread_test' }) + '\\n');",
    "process.stdout.write(JSON.stringify({ type: 'item.completed', item: { id: `item_${count}`, type: 'agent_message', text: count === 1 ? 'stalled pass' : 'resumed pass' } }) + '\\n');",
    'if (count === 1) {',
    '  setInterval(() => {}, 1000);',
    '} else {',
    "  fs.writeFileSync(path.join(process.cwd(), 'index.html'), '<!doctype html><html><body>landed after stall</body></html>\\n');",
    '}',
    '',
  ].join('\n'));
  await fs.chmod(fakeCodexPath, 0o755);
  await fs.writeFile(promptFile, 'reply with ok\n');

  const result = spawnSync('node', [
    isolatedWorkerScript,
    '--cwd', project,
    '--prompt-file', promptFile,
    '--output-jsonl', outputJsonl,
    '--output-last-message', outputLastMessage,
    '--source-codex-home', noisyCodexHome,
    '--full-auto',
    '--skip-git-repo-check',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      FAKE_CODEX_LOG: fakeCodexLog,
      FAKE_CODEX_COUNTER: fakeCodexCounter,
      OPENPRD_PATCH_MODE_MONITOR_INTERVAL_MS: '25',
      OPENPRD_PATCH_MODE_ENTRY_STALL_MS: '400',
      OPENPRD_PATCH_MODE_WRITE_ATTEMPT_STALL_MS: '150',
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const invocations = await readJsonl(fakeCodexLog);
  assert.equal(invocations.length, 2);
  assert.deepEqual(invocations[1].args.slice(0, 3), ['exec', 'resume', 'thread_test']);
  assert.ok(invocations[1].stdin.includes('不要再 web search'));
  assert.ok(invocations[1].stdin.includes('不要 delete-first'));
  assert.equal((await fs.readFile(path.join(project, 'index.html'), 'utf8')).includes('landed after stall'), true);
  assert.equal((await fs.readFile(outputLastMessage, 'utf8')).trim(), 'resumed pass');
});

test('release workspace tracks current project version and version items', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  let release = await releaseWorkspace(project, {});
  assert.equal(release.ok, true);
  assert.equal(release.summary.enabled, false);
  assert.equal(release.summary.currentVersion, null);

  release = await releaseWorkspace(project, {
    setVersion: 'v0.1.23',
    notes: '新增版本内变化摘要入口',
  });
  assert.equal(release.ok, true);
  assert.equal(release.summary.enabled, true);
  assert.equal(release.summary.currentVersion, '0.1.23');
  assert.equal(release.summary.currentStatus, 'current');
  assert.equal(release.summary.itemCount, 1);
  assert.ok(release.changeSummary.items.some((item) => item.sentence.includes('新增')));

  release = await releaseWorkspace(project, { setVersion: '0.1.24' });
  assert.equal(release.ok, true);
  assert.equal(release.summary.currentVersion, '0.1.24');

  const ledger = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'state', 'release-ledger.json'), 'utf8'));
  assert.equal(ledger.currentVersion, '0.1.24');
  assert.equal(ledger.versions.find((item) => item.version === '0.1.23').status, 'released');
  assert.equal(ledger.versions.find((item) => item.version === '0.1.24').status, 'current');
});

test('init without template pack defaults to base and points scene confirmation later', async () => {
  const project = await makeTempProject();

  const initResult = await initWorkspace(project, {});
  assert.equal(initResult.currentState.templatePack, 'base');
  assert.equal(initResult.currentState.productType, null);
  assert.equal(initResult.templatePackGuidance.source, 'default');
  assert.ok(initResult.templatePackGuidance.message.includes('未指定场景模板'));
  assert.ok(initResult.templatePackGuidance.message.includes('后续需求澄清或场景分类'));
  assert.ok(initResult.templatePackGuidance.message.includes('个人消费者、企业服务或 Agent 场景'));

  const progress = await fs.readFile(path.join(project, '.openprd', 'engagements', 'active', 'progress.md'), 'utf8');
  assert.ok(progress.includes(initResult.templatePackGuidance.message));

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    printInitResult(initResult, false);
  } finally {
    console.log = originalLog;
  }
  assert.ok(logs.some((line) => line.includes(`场景确认: ${initResult.templatePackGuidance.message}`)));
});

test('init creates a workspace and validate passes', async () => {
  const project = await makeTempProject();

  const initResult = await initWorkspace(project, { templatePack: 'consumer' });
  assert.equal(initResult.currentState.templatePack, 'consumer');
  assert.equal(initResult.templatePackGuidance.source, 'explicit');
  assert.ok(initResult.templatePackGuidance.message.includes('已按指定场景模板'));
  assert.ok(initResult.templatePackGuidance.message.includes('仍可按用户确认调整产品场景'));
  assert.equal(initResult.agentIntegration.ok, true);
  assert.deepEqual(initResult.agentIntegration.tools, ['codex', 'claude', 'cursor']);

  const { report } = await validateWorkspace(project);
  assert.equal(report.valid, true);
  assert.equal(report.errors.length, 0);

  const decisionLog = await fs.readFile(path.join(project, '.openprd', 'engagements', 'active', 'decision-log.md'), 'utf8');
  const intake = await fs.readFile(path.join(project, '.openprd', 'engagements', 'active', 'intake.md'), 'utf8');
  const activePrd = await fs.readFile(path.join(project, '.openprd', 'engagements', 'active', 'prd.md'), 'utf8');
  const taskGraph = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'state', 'task-graph.json'), 'utf8'));
  assert.ok(decisionLog.includes('# 决策记录'));
  assert.ok(intake.includes('我们要解决什么问题？'));
  assert.ok(activePrd.includes('## 类型专项模块'));
  assert.equal(activePrd.includes('## Problem'), false);
  assert.equal(activePrd.includes('Type-Specific Block'), false);
  assert.equal(Array.isArray(taskGraph.nodes), true);
  assert.equal(Array.isArray(taskGraph.workflow), true);
  assert.equal(Array.isArray(taskGraph.artifacts), true);
  assert.equal(typeof taskGraph.nextReadyNode, 'string');

  const standards = await checkStandardsWorkspace(project);
  assert.equal(standards.ok, true);
  assert.equal(standards.docsRoot, path.join('docs', 'basic'));
  assert.equal(standards.requiredDocs.length, 6);
  assert.ok(standards.checks.some((check) => check.includes('Development standards: code files ok <= 700 lines')));
  const standardsConfig = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'standards', 'config.json'), 'utf8'));
  assert.equal(standardsConfig.developmentStandards.codeFileLines.okMax, 700);
  assert.equal(standardsConfig.developmentStandards.codeFileLines.attentionMax, 1500);
  assert.ok(await fs.stat(path.join(project, 'docs', 'basic', 'file-structure.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.openprd', 'standards', 'file-manual-template.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.openprd', 'quality', 'config.json')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.openprd', 'quality', 'reports')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.openprd', 'knowledge', 'index.json')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.openprd', 'benchmarks', 'sources.yaml')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.openprd', 'benchmarks', 'index.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.openprd', 'design', 'README.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.openprd', 'design', 'themes', 'theme-catalog.json')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.openprd', 'design', 'layouts', 'layout-catalog.json')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.openprd', 'design', 'templates', 'README.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.openprd', 'design', 'templates', 'content-home.html')).then(() => true));
  assert.ok((await fs.readFile(path.join(project, '.openprd', 'design', 'templates', 'README.md'), 'utf8')).includes('推荐起步组合'));
  assert.ok(await fs.stat(path.join(project, '.openprd', 'design', 'active', 'facts-sheet.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.openprd', 'design', 'active', 'selected-direction.md')).then(() => true));
  assert.deepEqual(await fs.readdir(path.join(project, '.openprd', 'benchmarks', 'inbox')), []);
  assert.equal(await pathExists(path.join(project, '.openprd', 'learning', 'current.json')), false);
  assert.equal(await pathExists(path.join(project, '.openprd', 'learning', 'index.json')), false);
  assert.deepEqual(await fs.readdir(path.join(project, '.openprd', 'learning', 'archive')), []);
  assert.deepEqual(await fs.readdir(path.join(project, '.openprd', 'quality', 'reports')), []);
  assert.equal(await pathExists(path.join(project, '.openprd', 'engagements', 'active', 'clarify.html')), false);
  assert.equal(await pathExists(path.join(project, '.openprd', 'engagements', 'active', 'review.html')), false);
  const codexConfig = await fs.readFile(path.join(project, '.codex', 'config.toml'), 'utf8');
  assert.equal(hasTomlFeatureKey(codexConfig, 'hooks'), true);
  assert.equal(hasTomlFeatureKey(codexConfig, 'codex_hooks'), false);
  const hooksJson = JSON.parse(await fs.readFile(path.join(project, '.codex', 'hooks.json'), 'utf8'));
  assert.equal(hooksJson.UserPromptSubmit.some((group) => group.hooks?.some((hook) => hook.command.includes('openprd-hook.mjs'))), true);
  assert.equal(findOpenPrdHookGroup(hooksJson.PreToolUse)?.matcher, OPENPRD_LITE_WRITE_TOOL_MATCHER);
  assert.equal(Boolean(hooksJson.PostToolUse?.some((group) => group.hooks?.some((hook) => hook.command.includes('openprd-hook.mjs')))), false);
  assert.ok(await fs.stat(path.join(project, '.openprd', 'harness', 'install-manifest.json')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.openprd', 'harness', 'hook-state.json')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.openprd', 'harness', 'events.jsonl')).then(() => true));
  const registryEvents = await readJsonl(path.join(TEST_OPENPRD_HOME, 'registry', 'workspaces.jsonl'));
  const registryEntry = registryEvents.find((entry) => entry.workspaceRoot === project);
  assert.ok(registryEntry);
  assert.equal(registryEntry.openprdVersion != null, true);
  assert.deepEqual(registryEntry.tools, ['codex', 'claude', 'cursor']);
  assert.equal((await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-harness', 'SKILL.md'), 'utf8')).startsWith('---\n'), true);
  const requirementIntakeSkill = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-requirement-intake', 'SKILL.md'), 'utf8');
  assert.equal(requirementIntakeSkill.startsWith('---\n'), true);
  assert.ok(requirementIntakeSkill.includes('不要按关键词判断'));
  assert.ok(requirementIntakeSkill.includes('base'));
  assert.ok(requirementIntakeSkill.includes('consumer'));
  assert.ok(requirementIntakeSkill.includes('面向个人消费者场景'));
  assert.ok(requirementIntakeSkill.includes('b2b'));
  assert.ok(requirementIntakeSkill.includes('agent'));
  assert.ok(await fs.stat(path.join(project, '.codex', 'skills', 'openprd-requirement-intake', 'references', 'routing-rubric.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.codex', 'skills', 'openprd-requirement-intake', 'references', 'prd-template-lenses.md')).then(() => true));
  const frontendDesignSkill = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-frontend-design', 'SKILL.md'), 'utf8');
  assert.equal(frontendDesignSkill.startsWith('---\n'), true);
  assert.ok(frontendDesignSkill.includes('.openprd/design/'));
  assert.ok(frontendDesignSkill.includes('Three Directions Must Be Heterogeneous'));
  assert.ok(frontendDesignSkill.includes('.openprd/design/templates/README.md'));
  assert.ok(frontendDesignSkill.includes('模板默认组合优先于'));
  assert.ok(await fs.stat(path.join(project, '.codex', 'skills', 'openprd-frontend-design', 'references', 'design-asset-contract.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.codex', 'skills', 'openprd-frontend-design', 'references', 'direction-engine.md')).then(() => true));
  assert.equal((await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-benchmark-router', 'SKILL.md'), 'utf8')).startsWith('---\n'), true);
  const workspaceConfig = await fs.readFile(path.join(project, '.openprd', 'config.yaml'), 'utf8');
  assert.ok(workspaceConfig.includes('design:'));
  assert.ok(workspaceConfig.includes('frameworkRoot: .openprd/design'));
  assert.ok(workspaceConfig.includes('templateRoot: .openprd/design/templates'));
  assert.equal((await fs.readFile(path.join(project, '.cursor', 'rules', 'openprd.mdc'), 'utf8')).startsWith('---\n'), true);
  assert.ok(await fs.stat(path.join(project, '.codex', 'prompts', 'openprd-verify.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.codex', 'prompts', 'openprd-run.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.claude', 'commands', 'openprd', 'repair.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.claude', 'commands', 'openprd', 'run.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.cursor', 'commands', 'openprd-guard.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.cursor', 'commands', 'openprd-run.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.codex', 'prompts', 'openprd-fleet.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.claude', 'commands', 'openprd', 'fleet.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.cursor', 'commands', 'openprd-fleet.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.codex', 'prompts', 'openprd-loop.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.claude', 'commands', 'openprd', 'loop.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.cursor', 'commands', 'openprd-loop.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.codex', 'prompts', 'openprd-visual-compare.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.claude', 'commands', 'openprd', 'visual-compare.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.cursor', 'commands', 'openprd-visual-compare.md')).then(() => true));
  const hookRunner = await fs.readFile(path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), 'utf8');
  assert.equal(hookRunner.startsWith('/* OPENPRD:GENERATED'), true);
  assert.equal(hookRunner.includes('#!/usr/bin/env node'), false);

  const doctor = await doctorWorkspace(project);
  assert.equal(doctor.ok, true);

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
  assert.equal(await main(['standards', project, '--verify']), 0);
  } finally {
    console.log = originalLog;
  }
  assert.ok(logs.some((line) => line.includes('OpenPrd standards: 通过')));
});

test('design starter turns a bundled template into a real page entry', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });

  const starter = await designStarterWorkspace(project, {
    starter: 'content-home',
    out: 'index.html',
  });
  assert.equal(starter.ok, true);
  assert.equal(starter.starterId, 'content-home');
  assert.equal(starter.relativeOutputPath, 'index.html');
  assert.deepEqual(starter.defaults, {
    lens: 'editorial-contrast',
    theme: 'warm-editorial',
    layout: 'story-map',
  });
  const indexHtml = await fs.readFile(path.join(project, 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('starter-defaults: lens=editorial-contrast theme=warm-editorial layout=story-map'));

  const result = spawnSync(process.execPath, [
    path.resolve('bin/openprd.js'),
    'design-starter',
    project,
    '--starter',
    'ops-dashboard',
    '--out',
    'dashboard.html',
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OpenPrd design starter: 已生成/);
  assert.match(result.stdout, /默认组合: lens=operational-density theme=tool-neutral layout=ops-density-grid/);
  assert.match(result.stdout, /只有确认当前页不依赖外部事实、品牌素材或真实图片时，才直接写清无依赖/);
  assert.match(result.stdout, /先不要急着加 `--no-real-images`/);
  assert.match(result.stdout, /禁止删除后重起/);
  assert.ok(await pathExists(path.join(project, 'dashboard.html')));

  const hydratedProject = await makeTempProject();
  await initWorkspace(hydratedProject, { templatePack: 'consumer' });

  const hydratedResult = spawnSync(process.execPath, [
    path.resolve('bin/openprd.js'),
    'design-starter',
    hydratedProject,
    '--starter',
    'content-home',
    '--out',
    'hydrated.html',
    '--title',
    'One Person Build',
    '--brief',
    '写给独立开发者的个人博客首页',
    '--sections',
    '精选文章|写作主题|关于作者|订阅入口',
    '--no-external-facts',
    '--no-brand-assets',
    '--no-real-images',
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
  assert.equal(hydratedResult.status, 0, hydratedResult.stderr);
  assert.match(hydratedResult.stdout, /active design contracts: 已同步写实/);
  assert.match(hydratedResult.stdout, /docs\/basic: 已同步写实/);
  assert.match(hydratedResult.stdout, /文件说明书: 已补到 hydrated\.html/);
  const hydratedHtml = await fs.readFile(path.join(hydratedProject, 'hydrated.html'), 'utf8');
  assert.ok(hydratedHtml.startsWith('<!--\n## 核心功能'));
  assert.ok(hydratedHtml.includes('One Person Build'));
  assert.ok(hydratedHtml.includes('必须在当前入口文件上继续补丁修改'));
  assert.equal(hydratedHtml.includes('长期写作首页'), false);
  assert.equal(hydratedHtml.includes('阅读精选文章'), false);
  assert.equal(hydratedHtml.includes('这一周我为什么先修产品边界，再补界面细节'), false);
  assert.equal(hydratedHtml.includes('[品牌名 / 首页主题]'), false);
  const factsSheet = await fs.readFile(path.join(hydratedProject, '.openprd', 'design', 'active', 'facts-sheet.md'), 'utf8');
  assert.ok(factsSheet.includes('写给独立开发者的个人博客首页'));
  assert.equal(factsSheet.includes('待填写'), false);
  const assetSpec = await fs.readFile(path.join(hydratedProject, '.openprd', 'design', 'active', 'asset-spec.md'), 'utf8');
  assert.ok(assetSpec.includes('动效节奏'));
  assert.ok(assetSpec.includes('构图记忆点'));
  assert.ok(assetSpec.includes('memory-point'));
  const directionPlan = await fs.readFile(path.join(hydratedProject, '.openprd', 'design', 'active', 'direction-plan.md'), 'utf8');
  assert.ok(directionPlan.includes('审美主张'));
  assert.ok(directionPlan.includes('记忆点'));
  assert.ok(directionPlan.includes('温暖编辑感'));
  const selectedDirection = await fs.readFile(path.join(hydratedProject, '.openprd', 'design', 'active', 'selected-direction.md'), 'utf8');
  assert.ok(selectedDirection.includes('aesthetic:'));
  assert.ok(selectedDirection.includes('memory-point:'));
  assert.ok(selectedDirection.includes('anti-slop'));
  const frontendGuidelines = await fs.readFile(path.join(hydratedProject, 'docs', 'basic', 'frontend-guidelines.md'), 'utf8');
  assert.equal(frontendGuidelines.includes('待补充'), false);
  assert.ok(frontendGuidelines.includes('审美主张'));
  assert.ok(frontendGuidelines.includes('anti-slop'));
  const rootReadmes = (await fs.readdir(hydratedProject)).filter((name) => name.endsWith('_README.md'));
  assert.ok(rootReadmes.length > 0);

  const guideProject = await makeTempProject();
  await initWorkspace(guideProject, { templatePack: 'consumer' });
  const blockedGuide = spawnSync(process.execPath, [
    path.resolve('bin/openprd.js'),
    'design-starter',
    guideProject,
    '--starter',
    'content-home',
    '--out',
    'guide.html',
    '--brief',
    '西双版纳雨林观鸟导览首页',
    '--sections',
    '今日路线|关键物种|装备准备|最佳时段|预约提醒|订阅入口',
    '--no-external-facts',
    '--no-brand-assets',
    '--no-real-images',
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
  assert.equal(blockedGuide.status, 1);
  assert.match(blockedGuide.stdout, /不建议带 `--no-real-images`/);
  assert.equal(await pathExists(path.join(guideProject, 'guide.html')), false);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('commons.wikimedia.org/w/api.php')) {
      return {
        ok: true,
        async json() {
          return {
            query: {
              pages: {
                1: {
                  title: 'File:Xishuangbanna rainforest canopy.jpg',
                  imageinfo: [{
                    thumburl: 'https://example.com/image-1.jpg',
                    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Xishuangbanna_rainforest_canopy.jpg',
                    extmetadata: {
                      ImageDescription: { value: '西双版纳雨林 canopy' },
                      LicenseShortName: { value: 'CC BY-SA 4.0' },
                    },
                  }],
                },
                2: {
                  title: 'File:Birdwatching trail.jpg',
                  imageinfo: [{
                    thumburl: 'https://example.com/image-2.jpg',
                    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Birdwatching_trail.jpg',
                    extmetadata: {
                      ImageDescription: { value: '观鸟栈道' },
                      LicenseShortName: { value: 'CC BY-SA 4.0' },
                    },
                  }],
                },
                3: {
                  title: 'File:Tropical bird.jpg',
                  imageinfo: [{
                    thumburl: 'https://example.com/image-3.jpg',
                    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Tropical_bird.jpg',
                    extmetadata: {
                      ImageDescription: { value: '热带鸟类' },
                      LicenseShortName: { value: 'CC BY-SA 4.0' },
                    },
                  }],
                },
              },
            },
          };
        },
      };
    }
    return {
      ok: true,
      async arrayBuffer() {
        return new Uint8Array([255, 216, 255, 217]).buffer;
      },
      headers: {
        get(name) {
          return String(name).toLowerCase() === 'content-type' ? 'image/jpeg' : null;
        },
      },
    };
  };
  try {
    const guideResult = await designStarterWorkspace(guideProject, {
      starter: 'content-home',
      out: 'guide.html',
      brief: '西双版纳雨林观鸟导览首页',
      sections: '今日路线|关键物种|装备准备|最佳时段|预约提醒|订阅入口',
      noExternalFacts: true,
      noBrandAssets: true,
    });
    assert.equal(guideResult.ok, true);
    assert.equal(guideResult.fetchedImageCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const guideHtml = await fs.readFile(path.join(guideProject, 'guide.html'), 'utf8');
  assert.ok(guideHtml.includes('专题导览首页'));
  assert.ok(guideHtml.includes('今日路线'));
  assert.ok(guideHtml.includes('关键物种'));
  assert.ok(guideHtml.includes('装备准备'));
  assert.ok(guideHtml.includes('订阅后续更新'));
  assert.equal(guideHtml.includes('独立开发者写作首页'), false);
  assert.equal(guideHtml.includes('长期写作首页'), false);
  const guideImagePreflight = await fs.readFile(path.join(guideProject, '.openprd', 'design', 'active', 'image-preflight.md'), 'utf8');
  assert.ok(guideImagePreflight.includes('这一版已经按内容主题补齐首批真实图片'));
  const guideManifest = JSON.parse(
    await fs.readFile(path.join(guideProject, '.openprd', 'design', 'assets', 'fetched', 'content-home', 'manifest.json'), 'utf8')
  );
  assert.equal(guideManifest.assets.length, 3);

  const standardsResult = spawnSync(process.execPath, [
    path.resolve('bin/openprd.js'),
    'standards',
    hydratedProject,
    '--verify',
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
  assert.equal(standardsResult.status, 0, standardsResult.stderr);
  assert.match(standardsResult.stdout, /OpenPrd standards: 通过/);

  const dashboardProject = await makeTempProject();
  await initWorkspace(dashboardProject, { templatePack: 'consumer' });
  const dashboardHydratedResult = spawnSync(process.execPath, [
    path.resolve('bin/openprd.js'),
    'design-starter',
    dashboardProject,
    '--starter',
    'ops-dashboard',
    '--out',
    'index.html',
    '--title',
    '独立开发者内容发布工作台',
    '--brief',
    '为独立开发者提供安静、耐看、信息密度高的内容发布首页，帮助每天快速处理待发布事项、跟进草稿、查看订阅变化和选题推进。',
    '--sections',
    '今日待处理|草稿队列|本周指标|最近订阅变化|选题状态',
    '--no-external-facts',
    '--no-brand-assets',
    '--no-real-images',
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
  assert.equal(dashboardHydratedResult.status, 0, dashboardHydratedResult.stderr);
  const dashboardHtml = await fs.readFile(path.join(dashboardProject, 'index.html'), 'utf8');
  assert.equal(dashboardHtml.includes('总览一'), false);
  assert.equal(dashboardHtml.includes('关键指标'), false);
  assert.ok(dashboardHtml.includes('最近订阅变化'));
  assert.ok(dashboardHtml.includes('选题状态'));
  assert.ok(dashboardHtml.includes('AI 协作复盘: 继续写'));
});

test('clarify stays inline and synthesize writes a review artifact', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const clarify = await clarifyWorkspace(project, {});
  assert.ok(clarify.clarifyPresentation.mode.startsWith('inline'));
  assert.equal(clarify.clarifyArtifact, null);
  assert.equal(clarify.clarifyArtifactBundle, null);
  assert.equal(await pathExists(path.join(project, '.openprd', 'engagements', 'active', 'clarify.html')), false);
  assert.ok(clarify.intakeReflection);
  assert.ok(clarify.intakeReflectionPath);
  assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('我先用产品和业务语言复述一下')));
  assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('需求判断：')));
  assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('第一批最容易触达')));
  assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('先怎么手工交付')));
  assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('什么承诺才算真需求')));
  assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('主要服务对象')));
  assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('第一版先让用户做到')));
  assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('| 功能模块 |')));
  assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('| 技术部分 |')));
  assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('先整理需求摘要给你确认')));
  assert.equal(clarify.inlineClarification.lines.some((line) => line.includes('确认执行')), false);
  assert.ok((await fs.readFile(path.join(project, '.openprd', 'engagements', 'active', 'intake-reflection.md'), 'utf8')).includes('首轮项目画像'));

  await classifyWorkspace(project, 'agent');
  await captureWorkspace(project, {
    jsonFile: null,
    field: 'problem.problemStatement',
    value: '用户需要一套 agent 驱动、产品驱动的需求到开发流程。',
    source: 'user-confirmed',
  });
  await captureWorkspace(project, {
    field: 'problem.whyNow',
    value: '当前需求确认和执行验证链路不够清晰。',
    source: 'user-confirmed',
  });
  await captureWorkspace(project, {
    field: 'users.primaryUsers',
    value: '产品经理, 独立开发者',
    source: 'user-confirmed',
  });
  await captureWorkspace(project, {
    field: 'goals.goals',
    value: '澄清需求, 生成方案, 执行开发',
    source: 'user-confirmed',
  });
  await captureWorkspace(project, {
    field: 'goals.successMetrics',
    value: '需求确认效率提升, 回归验证结果可追踪',
    source: 'user-confirmed',
  });
  await captureWorkspace(project, {
    field: 'scope.inScope',
    value: '澄清访谈, HTML 评审, 任务执行, 回归报告',
    source: 'user-confirmed',
  });
  await captureWorkspace(project, {
    field: 'scope.outOfScope',
    value: '自动上线部署',
    source: 'user-confirmed',
  });
  await captureWorkspace(project, {
    field: 'scenarios.primaryFlows',
    value: '一句话需求进入澄清, 方案对比后冻结, 任务执行后回归',
    source: 'user-confirmed',
  });
  await captureWorkspace(project, {
    field: 'requirements.functional',
    value: '生成澄清提纲, 生成评审面板, 生成回归报告',
    source: 'user-confirmed',
  });
  await captureWorkspace(project, {
    field: 'risks.openQuestions',
    value: '并行执行的边界如何定义',
    source: 'user-confirmed',
  });
  await captureWorkspace(project, {
    field: 'handoff.owner',
    value: 'OpenPrd',
    source: 'user-confirmed',
  });
  await captureWorkspace(project, {
    field: 'handoff.nextStep',
    value: '生成 change 并进入 loop',
    source: 'user-confirmed',
  });
  await captureWorkspace(project, {
    field: 'handoff.targetSystem',
    value: 'OpenSpec',
    source: 'user-confirmed',
  });
  await releaseWorkspace(project, {
    setVersion: '0.1.23',
    notes: '新增 review 顶部版本入口',
  });

  const synthesized = await synthesizeWorkspace(project, {
    title: 'OpenPrd 2.0',
    owner: 'OpenPrd',
    problemStatement: '用户需要一套 agent 驱动、产品驱动的需求到开发流程。',
    whyNow: '当前需求确认和执行验证链路不够清晰。',
    productType: 'agent',
  });
  assert.ok(synthesized.reviewArtifact.endsWith('review.html'));
  assert.match(synthesized.workUnitId, /^wu-\d{14}-[a-f0-9]{8}$/);
  assert.ok(synthesized.reviewPath.endsWith(path.join('.openprd', 'reviews', 'v0001.html')));
  assert.ok(synthesized.stableReviewArtifact.endsWith(path.join('.openprd', 'reviews', 'v0001.html')));
  assert.ok(synthesized.reviewEntryPath.endsWith(path.join('engagements', 'active', 'review.html')));
  assert.equal(synthesized.workUnit.latestVersionId, 'v0001');
  assert.equal(synthesized.workUnit.latestVersionDigest, synthesized.snapshot.digest);
  const reviewEntryHtml = await fs.readFile(synthesized.reviewArtifact, 'utf8');
  assert.ok(reviewEntryHtml.includes('自动跳转'));
  assert.ok(reviewEntryHtml.includes('../..\/reviews\/v0001.html') || reviewEntryHtml.includes('../../reviews/v0001.html'));
  const reviewHtml = await fs.readFile(synthesized.reviewPath, 'utf8');
  assert.ok(reviewHtml.includes('OpenPrd / 评审面板'));
  assert.ok(reviewHtml.includes('项目版本'));
  assert.ok(reviewHtml.includes('0.1.23'));
  assert.ok(reviewHtml.includes('当前版本'));
  assert.ok(reviewHtml.includes('需求概览'));
  assert.ok(reviewHtml.includes('需求关系图') || reviewHtml.includes('需求流程图'));
  assert.ok(reviewHtml.includes('评审决定'));
  assert.ok(reviewHtml.includes('review-bottom-bar'));
  assert.ok(reviewHtml.includes('review-bottom-action revise'));
  assert.ok(reviewHtml.includes('review-bottom-action confirm'));
  assert.ok(reviewHtml.includes('需要调整'));
  assert.ok(reviewHtml.includes('认可并继续'));
  assert.ok(reviewHtml.includes('重点摘要'));
  assert.ok(reviewHtml.includes('主流程小图'));
  assert.ok(reviewHtml.includes('用户旅程'));
  assert.ok(reviewHtml.includes('恢复路径'));
  assert.ok(reviewHtml.includes('review-detail-summary'));
  assert.ok(reviewHtml.includes('review-detail-body'));
  assert.ok(reviewHtml.includes('OpenPrD Review: 认可并继续下一步'));
  assert.ok(reviewHtml.includes('请先记录这次确认结果，并继续推进后续落地内容。'));
  assert.ok(reviewHtml.includes('openprd review . --mark confirmed'));
  assert.ok(reviewHtml.includes(`--version &#39;${synthesized.snapshot.versionId}&#39;`));
  assert.ok(reviewHtml.includes(`--digest &#39;${synthesized.snapshot.digest}&#39;`));
  assert.ok(reviewHtml.includes(`--work-unit &#39;${synthesized.workUnitId}&#39;`));
  assert.ok(reviewHtml.includes('openprd review . --mark needs-revision'));
  assert.ok(reviewHtml.includes('--notes &#39;说明需要调整的点&#39;'));
  assert.ok(reviewHtml.includes('position: fixed;'));
  assert.ok(reviewHtml.includes('bottom: 0;'));
  assert.ok(reviewHtml.includes('border-radius: 12px;'));
  assert.ok(reviewHtml.includes('background: #fff1f2;'));
  assert.ok(reviewHtml.includes('background: #ecfdf3;'));
  assert.equal(reviewHtml.includes('继续补充信息'), false);
  assert.equal(reviewHtml.includes('给 Agent 的结构化数据'), false);
  assert.equal(reviewHtml.includes('review-structured-data'), false);
  assert.equal(await fs.access(path.join(project, '.openprd', 'artifacts', 'active', 'v0001-review', 'artifact.html')).then(() => true).catch(() => false), false);
  assert.equal(reviewHtml.includes('review-decision'), false);
  assert.equal(reviewHtml.includes('review-footer'), false);
  assert.equal(reviewHtml.includes('建议顺序'), false);
  const reviewChips = Array.from(
    reviewHtml.matchAll(/<span class="review-chip(?: empty)?">([^<]*)<\/span>/g),
    ([, text]) => text
  );
  assert.ok(reviewChips.length > 0);
  assert.equal(reviewChips.some((text) => /…|\.\.\./.test(text)), false);
  assert.ok(reviewChips.every((text) => Array.from(text).length <= 15));
  const panelSubtitles = Array.from(
    reviewHtml.matchAll(/<header class="review-panel-head">[\s\S]*?<p>([^<]*)<\/p>/g),
    ([, text]) => text
  );
  assert.equal(panelSubtitles.length, 4);
  assert.equal(panelSubtitles.some((text) => /[。.]$/.test(text)), false);
  assert.ok(reviewHtml.includes('white-space: nowrap;'));
  assert.equal(reviewHtml.includes('Freeze 前确认'), false);
  assert.equal(reviewHtml.includes('review-meta-row'), false);
  assert.equal(reviewHtml.includes('review-stat-grid'), false);
  assert.equal(reviewHtml.includes('text-overflow'), false);
  assert.equal(reviewHtml.includes('先用一张图确认这次 PRD 的主线'), false);
  assert.equal(/freeze/i.test(reviewHtml), false);
  assert.ok(reviewHtml.includes('进入实现前确认'));
  assert.ok(reviewHtml.includes('需求定稿前'));

  const versionIndexBeforeReviewRefresh = JSON.parse(
    await fs.readFile(path.join(project, '.openprd', 'state', 'version-index.json'), 'utf8')
  ).length;
  await fs.writeFile(synthesized.reviewArtifact, '<html><body>legacy review artifact</body></html>');
  const refreshedReview = await reviewWorkspace(project, {});
  assert.equal(refreshedReview.ok, true);
  assert.equal(refreshedReview.marked, false);
  const refreshedReviewHtml = await fs.readFile(synthesized.reviewArtifact, 'utf8');
  assert.ok(refreshedReviewHtml.includes('自动跳转'));
  assert.equal(refreshedReviewHtml.includes('legacy review artifact'), false);
  const refreshedCanonicalReviewHtml = await fs.readFile(synthesized.reviewPath, 'utf8');
  assert.ok(refreshedCanonicalReviewHtml.includes('认可并继续'));
  const versionIndexAfterReviewRefresh = JSON.parse(
    await fs.readFile(path.join(project, '.openprd', 'state', 'version-index.json'), 'utf8')
  ).length;
  assert.equal(versionIndexAfterReviewRefresh, versionIndexBeforeReviewRefresh);

  const wrongDigestReview = await reviewWorkspace(project, {
    mark: 'confirmed',
    version: synthesized.snapshot.versionId,
    digest: 'wrong-digest',
    workUnit: synthesized.workUnitId,
  });
  assert.equal(wrongDigestReview.ok, false);
  assert.match(wrongDigestReview.errors[0], /确认指纹不匹配/);

  const wrongWorkUnitReview = await reviewWorkspace(project, {
    mark: 'confirmed',
    version: synthesized.snapshot.versionId,
    digest: synthesized.snapshot.digest,
    workUnit: 'other-work-unit',
  });
  assert.equal(wrongWorkUnitReview.ok, false);
  assert.match(wrongWorkUnitReview.errors[0], /稿件不一致/);

  const confirmedReview = await reviewWorkspace(project, {
    mark: 'confirmed',
    version: synthesized.snapshot.versionId,
    digest: synthesized.snapshot.digest,
    workUnit: synthesized.workUnitId,
  });
  assert.equal(confirmedReview.ok, true);
  assert.equal(confirmedReview.status, 'confirmed');
  assert.equal(confirmedReview.workUnit.status, 'confirmed');
});

test('review presentation script is required before confirmable review artifact', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const synthesized = await synthesizeWorkspaceBase(project, {
    title: '工具更新流程',
    owner: 'OpenPrd',
    problemStatement: '用户需要确认工具更新后的项目刷新流程不会超出评审卡片。',
    whyNow: '当前评审图会把长句塞进卡片。',
    primaryFlows: [
      '用户打开评审稿并查看很长很长的第一步说明文本，需要确认不会直接塞进流程卡片',
      'Agent 需要把展示文本压缩后再生成可确认页面',
    ],
    functional: ['强制使用 review-presentation 脚本写入展示文案'],
    productType: 'agent',
  });

  assert.equal(synthesized.reviewPresentationRequired, true);
  assert.equal(await pathExists(synthesized.reviewPath), false);

  const blockedReview = await reviewWorkspace(project, { mark: 'confirmed' });
  assert.equal(blockedReview.ok, false);
  assert.match(blockedReview.errors.join('\n'), /reviewPresentation/);
  assert.ok(blockedReview.presentationFeedback.some((item) => item.jsonPath?.startsWith('reviewPresentation.mapNodes.')));

  const invalidPath = await writeAnswersFile(project, 'bad-review-presentation.json', {
    reviewPresentation: validReviewPresentation({
      flowNodes: [
        { text: '这是一段故意超过三十个字的流程卡片展示内容，用来验证脚本会阻止写入' },
        { text: '压缩后再写' },
      ],
    }),
  });
  const invalid = await reviewPresentationWorkspace(project, {
    version: synthesized.snapshot.versionId,
    presentationPath: invalidPath,
    write: true,
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.writeBlocked, true);
  assert.equal(await pathExists(synthesized.reviewPath), false);

  const valid = await writeValidReviewPresentation(project, synthesized.snapshot.versionId, {
    flowNodes: [
      { text: '查看更新流程' },
      { text: '压缩展示文案' },
    ],
  });
  assert.equal(await pathExists(valid.reviewPath), true);
  const reviewHtml = await fs.readFile(valid.reviewPath, 'utf8');
  assert.ok(reviewHtml.includes('查看更新流程'));
  assert.ok(reviewHtml.includes('压缩展示文案'));

  const confirmed = await reviewWorkspace(project, {
    mark: 'confirmed',
    version: synthesized.snapshot.versionId,
    digest: synthesized.snapshot.digest,
    workUnit: synthesized.workUnitId,
  });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.status, 'confirmed');
});

test('capture after synthesized PRD invalidates stale review pointers', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const synthesized = await synthesizeWorkspace(project, {
    title: '历史飞书需求',
    owner: 'OpenPrd',
    problemStatement: '用户需要看到飞书安装进度。',
    whyNow: '安装等待过程容易误判为卡死。',
    goals: ['展示安装进度'],
    productType: 'agent',
  });
  assert.equal(synthesized.snapshot.versionId, 'v0001');
  let current = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'state', 'current.json'), 'utf8'));
  assert.equal(current.latestVersionId, 'v0001');
  assert.equal(current.versionId, 'v0001');
  assert.equal(current.versionNumber, 1);
  assert.equal(current.workUnitId, synthesized.workUnitId);
  assert.equal(current.digest, synthesized.snapshot.digest);
  assert.deepEqual(current.sections, synthesized.snapshot.sections);
  assert.equal(current.content, synthesized.snapshot.content);

  await captureWorkspace(project, {
    field: 'meta.title',
    value: 'AI 生产线命名空格调整',
    source: 'user-confirmed',
  });

  current = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'state', 'current.json'), 'utf8'));
  assert.equal(current.title, 'AI 生产线命名空格调整');
  assert.equal('latestVersionId' in current, false);
  assert.equal('latestVersionDigest' in current, false);
  assert.equal('activeWorkUnitId' in current, false);
  assert.equal('versionId' in current, false);
  assert.equal('versionNumber' in current, false);
  assert.equal('workUnitId' in current, false);
  assert.equal('sections' in current, false);
  assert.equal('content' in current, false);
  assert.equal('digest' in current, false);
  assert.equal(current.previousLatestVersionId, 'v0001');
  assert.equal(current.reviewStatus.status, 'needs-revision');
  assert.equal(current.reviewStatus.stale, true);
  assert.equal(current.reviewStatus.versionId, null);
  assert.equal(current.reviewStatus.staleVersionId, 'v0001');
  assert.equal(current.reviewStatus.staleWorkUnitId, synthesized.workUnitId);
  assert.deepEqual(current.reviewStatus.staleFields, ['meta.title']);

  const resynthesized = await synthesizeWorkspace(project, {
    title: 'AI 生产线命名空格调整',
    owner: 'OpenPrd',
    problemStatement: 'AI 生产线入口命名需要保留空格。',
    whyNow: '用户已经确认要调整中文入口命名。',
    goals: ['保留准确命名'],
    productType: 'agent',
  });
  current = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'state', 'current.json'), 'utf8'));
  assert.equal(resynthesized.snapshot.versionId, 'v0002');
  assert.equal(current.latestVersionId, 'v0002');
  assert.equal(current.versionId, 'v0002');
  assert.equal(current.workUnitId, resynthesized.workUnitId);
  assert.equal(current.sections.meta.version, 'v0002');
  assert.equal(current.content, resynthesized.snapshot.content);
  assert.equal(current.content.includes('历史飞书需求'), false);
});

test('synthesize no longer blocks mixed-language spec drafts before review', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const synthesized = await synthesizeWorkspace(project, {
    title: 'open pipeline 命名调整',
    owner: 'OpenPrd',
    problemStatement: '用户需要统一 open pipeline 命名。',
    whyNow: '当前 open pipeline 命名在多个入口里不一致。',
    primaryFlows: ['用户打开 open pipeline 入口'],
    goals: ['统一入口命名'],
    productType: 'agent',
  });

  assert.equal(synthesized.snapshot.versionId, 'v0001');
  assert.equal(await pathExists(path.join(project, '.openprd', 'state', 'version-index.json')), true);
  assert.equal(await pathExists(path.join(project, '.openprd', 'engagements', 'active', 'review.html')), true);
  assert.equal(synthesized.reviewPresentationRequired, false);
});

test('agent-normalized capture keeps confirmed review available for freeze', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });

  const synthesized = await synthesizeWorkspace(project, {
    title: '注册流程优化',
    owner: 'PM',
    problemStatement: '用户在注册流程中频繁流失',
    whyNow: '当前激活率偏低',
    evidence: ['近期调研反馈注册步骤过长'],
    primaryUsers: ['忙碌的创作者'],
    stakeholders: ['增长团队'],
    goals: ['提升激活率'],
    successMetrics: ['激活率超过 40%'],
    acceptanceGoals: ['用户可在 2 分钟内完成注册'],
    inScope: ['注册流程'],
    outOfScope: ['计费体系'],
    primaryFlows: ['用户完成注册'],
    edgeCases: ['第三方登录失败'],
    failureModes: ['邮箱校验失败'],
    functional: ['创建账号'],
    nonFunctional: ['关键接口 p95 小于 2 秒'],
    businessRules: ['需要邀请码'],
    technical: ['复用当前认证服务'],
    compliance: ['满足隐私合规要求'],
    dependencies: ['认证接口'],
    assumptions: ['用户具备可用邮箱'],
    risks: ['注册流失继续升高'],
    openQuestions: ['是否需要单点登录'],
    handoffOwner: 'PM',
    nextStep: '需求定稿后进入 freeze',
    targetSystem: 'OpenPrd',
    productType: 'consumer',
    persona: '忙碌的创作者',
    segment: '自助用户',
    journey: '激活',
    activationMetric: '注册完成率',
    retentionMetric: '次日回访率',
  });
  const diagram = await diagramWorkspace(project, { open: false, type: 'product-flow' });
  await diagramWorkspace(project, { open: false, type: 'product-flow', mark: 'confirmed' });
  assert.equal(diagram.type, 'product-flow');
  const confirmedReview = await reviewWorkspace(project, {
    mark: 'confirmed',
    version: synthesized.snapshot.versionId,
    digest: synthesized.snapshot.digest,
    workUnit: synthesized.workUnitId,
  });
  assert.equal(confirmedReview.ok, true);

  await captureWorkspace(project, {
    field: 'meta.title',
    value: '注册流程优化说明',
    source: 'agent-normalized',
  });

  let current = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'state', 'current.json'), 'utf8'));
  assert.equal(current.title, '注册流程优化说明');
  assert.equal(current.latestVersionId, 'v0001');
  assert.equal(current.reviewStatus.status, 'confirmed');
  assert.equal(current.reviewStatus.versionId, 'v0001');
  assert.equal(current.reviewStatus.stale, undefined);
  assert.equal('previousLatestVersionId' in current, false);

  const frozen = await freezeWorkspace(project);
  assert.equal(frozen.ok, true);

  current = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'state', 'current.json'), 'utf8'));
  assert.equal(current.status, 'frozen');
  assert.equal(current.latestVersionId, 'v0001');
});

test('active requirement gate blocks synthesize from partial overrides without fresh capture', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  await fs.mkdir(path.join(project, '.openprd', 'harness'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
    version: 1,
    active: true,
    status: 'requires-clarification',
    openedAt: '2026-05-25 10:00:00',
    updatedAt: '2026-05-25 10:00:00',
    promptPreview: '新需求还在澄清阶段',
  }, null, 2));

  await assert.rejects(
    synthesizeWorkspace(project, {
      title: 'Hermes bundled 基线升级与安装阶段细化',
      problemStatement: '安装阶段需要拆细并去掉 Camoufox 隐式下载。',
      whyNow: '用户正在复测安装链路。',
      productType: 'agent',
    }),
    /partial override 不能替代 fresh capture/,
  );

  const versionFiles = await fs.readdir(path.join(project, '.openprd', 'state', 'versions'));
  assert.equal(versionFiles.length, 0);
});

test('review relationship map stays compact with pill tags and left aligned copy', () => {
  const longProblem = '用户需要先看清核心问题，再决定是否进入实现，并且希望图里不要靠模板裁剪破坏语义';
  const reviewHtml = renderReviewArtifact({
    snapshot: {
      versionId: 'v0001',
      title: '关系图紧凑样例',
      sections: {
        problem: { problemStatement: longProblem },
        goals: { goals: ['让用户快速理解本次需求目标，并能判断是不是值得继续推进'] },
        scope: { inScope: ['只调整评审页图谱展示，不改变评审状态命令'] },
        scenarios: { primaryFlows: ['用户打开评审页并扫读关系图'] },
        risks: { risks: ['图谱信息太密会降低评审意愿'] },
      },
    },
  });
  assert.ok(reviewHtml.includes('需求关系图'));
  assert.ok(reviewHtml.includes('viewBox="0 0 960 336"'));
  assert.ok(reviewHtml.includes('review-map-tag-pill'));
  assert.ok(reviewHtml.includes('width="244" height="86"'));
  assert.ok(reviewHtml.includes('text-anchor="start"'));
  assert.equal(reviewHtml.includes('viewBox="0 0 960 480"'), false);
  const mindMapSvg = reviewHtml.match(/<svg viewBox="0 0 960 336"[\s\S]*?<\/svg>/)?.[0] ?? '';
  assert.ok(mindMapSvg.includes('review-map-center-group'));
  assert.ok(mindMapSvg.indexOf('review-map-link') < mindMapSvg.indexOf('review-map-node node-1'));
  assert.ok(mindMapSvg.indexOf('review-map-node node-4') < mindMapSvg.indexOf('review-map-center-group'));
  const reviewMapTags = Array.from(
    reviewHtml.matchAll(/<text class="review-map-tag[^"]*"[^>]*>([^<]*)<\/text>/g),
    ([, text]) => text
  );
  assert.ok(reviewMapTags.length > 0);
  assert.ok(reviewMapTags.every((text) => Array.from(text).length <= 15));
  const reviewMapLabels = Array.from(
    reviewHtml.matchAll(/<text class="review-map-label[^"]*"[^>]*>([\s\S]*?)<\/text>/g),
    ([, text]) => text.replace(/<[^>]+>/g, '')
  );
  assert.ok(reviewMapLabels.length > 0);
  assert.ok(reviewMapLabels.some((text) => Array.from(text).length > 30));
  const exportPayload = buildReviewExportPayload({
    versionId: 'v0001',
    title: '关系图紧凑样例',
    sections: {
      problem: { problemStatement: longProblem },
      goals: { goals: ['让用户快速理解本次需求目标，并能判断是不是值得继续推进'] },
      scope: { inScope: ['只调整评审页图谱展示，不改变评审状态命令'] },
      scenarios: { primaryFlows: ['用户打开评审页并扫读关系图'] },
      risks: { risks: ['图谱信息太密会降低评审意愿'] },
    },
  });
  assert.deepEqual(exportPayload.summaryStyle.preferredVerbs, USER_CHANGE_SUMMARY_GUIDE.preferredVerbs);
  assert.ok(exportPayload.presentationContract.rules.some((rule) => rule.id === 'review-map-card-text' && rule.maxChars === 30));
  assert.ok(exportPayload.presentationContract.rules.some((rule) => rule.id === 'review-panel-detail-format' && rule.format === '- **摘要内容**：明细一句话'));
  assert.ok(exportPayload.presentationFeedback.some((item) => item.ruleId === 'review-map-card-text' && item.currentChars > item.maxChars));
  assert.ok(exportPayload.presentationFeedback.some((item) => item.ruleId === 'review-panel-detail-format' && item.expectedFormat === '- **摘要内容**：明细一句话'));

  const flowHtml = renderReviewArtifact({
    snapshot: {
      versionId: 'v0002',
      title: '流程图紧凑样例',
      reviewPresentation: {
        diagram: { type: 'flow' },
        flowNodes: [
          { id: 'step1', text: '用户先扫关系图' },
          { id: 'step2', text: '确认流程覆盖' },
          { id: 'step3', text: '补充业务限制' },
        ],
        flowEdges: [
          { from: 'step1', to: 'step2' },
          { from: 'step2', to: 'step3' },
        ],
      },
      sections: {
        scenarios: {
          primaryFlows: [
            '用户打开评审页面后先扫读当前需求关系图和核心卡片内容并判断是否继续推进',
            '用户确认主流程是否覆盖关键动作、异常情况和恢复路径',
            '用户判断是否需要补充业务限制、成本边界或开放问题',
          ],
        },
      },
    },
  });
  assert.ok(flowHtml.includes('需求流程图'));
  assert.ok(flowHtml.includes('review-map-arrow'));
  const flowMapLabels = Array.from(
    flowHtml.matchAll(/<text class="review-map-label[^"]*"[^>]*>([\s\S]*?)<\/text>/g),
    ([, text]) => text.replace(/<[^>]+>/g, '')
  );
  assert.ok(flowMapLabels.length > 0);
  assert.ok(flowMapLabels.every((text) => Array.from(text).length <= 30));
  const flowExportPayload = buildReviewExportPayload({
    versionId: 'v0002',
    title: '流程图紧凑样例',
    reviewPresentation: {
      diagram: { type: 'flow' },
      flowNodes: [
        { id: 'step1', text: '用户打开评审页面后先扫读当前需求关系图和核心卡片内容并判断是否继续推进' },
        { id: 'step2', text: '确认流程覆盖' },
        { id: 'step3', text: '补充业务限制' },
      ],
    },
    sections: {
      scenarios: {
        primaryFlows: [
          '用户打开评审页面后先扫读当前需求关系图和核心卡片内容并判断是否继续推进',
          '用户确认主流程是否覆盖关键动作、异常情况和恢复路径',
          '用户判断是否需要补充业务限制、成本边界或开放问题',
        ],
      },
    },
  });
  assert.ok(flowExportPayload.presentationFeedback.some((item) => item.area === '需求流程图' && item.ruleId === 'review-map-card-text'));

  const presentedSnapshot = {
    versionId: 'v0003',
    title: '展示文案样例',
    reviewPresentation: {
      mapNodes: {
        problem: { title: '问题定义', text: '分类位置影响查找' },
        goal: { title: '目标', text: '先搜索再选分类' },
        scope: { title: '范围', text: '只调整评审展示' },
        flow: { title: '流程', text: '打开页面后扫关系图' },
        risk: { title: '风险', text: '超限时反馈重写' },
      },
    },
    sections: {
      problem: { problemStatement: longProblem },
      goals: { goals: ['让用户快速理解本次需求目标，并能判断是不是值得继续推进'] },
      scope: { inScope: ['只调整评审页图谱展示，不改变评审状态命令'] },
      scenarios: { primaryFlows: ['用户打开评审页并扫读关系图'] },
      risks: { risks: ['图谱信息太密会降低评审意愿'] },
    },
  };
  const presentedHtml = renderReviewArtifact({ snapshot: presentedSnapshot });
  const presentedSvg = presentedHtml.match(/<svg viewBox="0 0 960 336"[\s\S]*?<\/svg>/)?.[0] ?? '';
  const presentedMapLabels = Array.from(
    presentedSvg.matchAll(/<text class="review-map-label[^"]*"[^>]*>([\s\S]*?)<\/text>/g),
    ([, text]) => text.replace(/<[^>]+>/g, '')
  );
  assert.equal(presentedMapLabels.length, 5);
  assert.ok(presentedMapLabels.every((text) => Array.from(text).length <= 30));
  const presentedExportPayload = buildReviewExportPayload(presentedSnapshot);
  assert.equal(
    presentedExportPayload.presentationFeedback.some((item) => item.ruleId === 'review-map-card-text'),
    false
  );

  const presentedFlowSnapshot = {
    versionId: 'v0004',
    title: '流程展示文案样例',
    reviewPresentation: {
      diagram: { type: 'flow' },
      flowNodes: [
        { id: 'step1', text: '打开评审页先扫图' },
        { id: 'step2', text: '确认主流程覆盖' },
        { id: 'step3', text: '补充风险和边界' },
      ],
      flowEdges: [
        { from: 'step1', to: 'step2' },
        { from: 'step2', to: 'step3' },
      ],
    },
    sections: {
      scenarios: {
        primaryFlows: [
          '用户打开评审页面后先扫读当前需求关系图和核心卡片内容并判断是否继续推进',
          '用户确认主流程是否覆盖关键动作、异常情况和恢复路径',
          '用户判断是否需要补充业务限制、成本边界或开放问题',
        ],
      },
    },
  };
  const presentedFlowHtml = renderReviewArtifact({ snapshot: presentedFlowSnapshot });
  const presentedFlowLabels = Array.from(
    presentedFlowHtml.matchAll(/<text class="review-map-label[^"]*"[^>]*>([\s\S]*?)<\/text>/g),
    ([, text]) => text.replace(/<[^>]+>/g, '')
  );
  assert.equal(presentedFlowLabels.length, 3);
  assert.ok(presentedFlowLabels.every((text) => Array.from(text).length <= 30));
  const presentedFlowExportPayload = buildReviewExportPayload(presentedFlowSnapshot);
  assert.equal(
    presentedFlowExportPayload.presentationFeedback.some((item) => item.area === '需求流程图' && item.ruleId === 'review-map-card-text'),
    false
  );

  const defaultMapSnapshot = {
    versionId: 'v0005',
    title: '默认关系图样例',
    reviewPresentation: {
      mapNodes: {
        problem: { title: '问题定义', text: '确认核心问题' },
        goal: { title: '目标', text: '确认目标结果' },
        scope: { title: '范围', text: '确认交付边界' },
        flow: { title: '流程', text: '确认关键路径' },
        risk: { title: '风险', text: '确认主要风险' },
      },
    },
    sections: {
      scenarios: {
        primaryFlows: [
          '第一条不一定是流程箭头',
          '第二条也可能只是要点',
          '第三条仍然作为关系图信息',
        ],
      },
    },
  };
  const defaultMapHtml = renderReviewArtifact({ snapshot: defaultMapSnapshot });
  assert.ok(defaultMapHtml.includes('需求关系图'));
  assert.equal(/<path class="review-map-arrow"/u.test(defaultMapHtml), false);
});

test('review artifact shows project version badge only when current project version exists', () => {
  const snapshot = {
    versionId: 'v0006',
    title: '项目版本展示样例',
    sections: {
      problem: { problemStatement: '需要把项目版本放到评审页顶部。' },
    },
  };

  const noVersionHtml = renderReviewArtifact({ snapshot });
  assert.equal(noVersionHtml.includes('aria-label="项目版本"'), false);

  const withVersionHtml = renderReviewArtifact({
    snapshot,
    projectRelease: {
      currentVersion: '0.1.23',
      currentStatus: 'current',
      itemCount: 3,
    },
  });
  assert.ok(withVersionHtml.includes('aria-label="项目版本"'));
  assert.ok(withVersionHtml.includes('项目版本'));
  assert.ok(withVersionHtml.includes('0.1.23'));
  assert.ok(withVersionHtml.includes('3 条变化'));
});
