import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

import { buildReviewExportPayload, renderReviewArtifact } from '../src/html-artifacts.js';
import { addBenchmarkWorkspace, advanceOpenSpecTaskWorkspace, applyGrowthCandidateWorkspace, applyOpenPrdChangeWorkspace, approveBenchmarkWorkspace, archiveOpenPrdChangeWorkspace, captureWorkspace, checkDevelopmentStandardsWorkspace, checkStandardsWorkspace, clarifyWorkspace, classifyExternalReferenceWorkspace, classifyWorkspace, diagramWorkspace, diffWorkspace, doctorWorkspace, finishLoopWorkspace, fleetWorkspace, freezeWorkspace, generateLearningReviewWorkspace, generateOpenSpecChangeWorkspace, handoffWorkspace, historyWorkspace, initLoopWorkspace, initQualityWorkspace, initWorkspace, interviewWorkspace, learnQualityWorkspace, listAcceptedSpecsWorkspace, listBenchmarkWorkspace, listOpenPrdChangesWorkspace, listOpenSpecTaskWorkspace, main, nextLoopWorkspace, nextWorkspace, openspecDiscoveryWorkspace, planLoopWorkspace, playgroundWorkspace, promptLoopWorkspace, reviewGrowthWorkspace, reviewWorkspace, runLoopWorkspace, runWorkspace, setLearningReviewModeWorkspace, setupAgentIntegrationWorkspace, statusLoopWorkspace, synthesizeWorkspace, updateAgentIntegrationWorkspace, validateOpenSpecChangeWorkspace, validateWorkspace, verifyBenchmarkWorkspace, verifyLoopWorkspace, verifyQualityWorkspace, visualCompareWorkspace } from '../src/openprd.js';
import { createRunWorkspace } from '../src/run-harness.js';

const OPENPRD_LITE_WRITE_TOOL_MATCHER = '^(apply_patch|Write|Edit)$';
const OPENPRD_GUARDED_WRITE_TOOL_MATCHER = '^(Bash|apply_patch|Write|Edit)$';
const TEST_OPENPRD_HOME = path.join(os.tmpdir(), 'openprd-test-home');

process.env.OPENPRD_HOME = TEST_OPENPRD_HOME;

function hasTomlFeatureKey(text, key) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '[features]');
  if (start < 0) return false;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (/^\[.+\]$/.test(line)) break;
    if (new RegExp(`^${key}\\s*=`).test(line)) return true;
  }
  return false;
}

function findOpenPrdHookGroup(groups) {
  return groups?.find((group) => group.hooks?.some((hook) => hook.command.includes('openprd-hook.mjs')));
}

async function makeTempProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-test-'));
  await fs.mkdir(path.join(dir, 'project'), { recursive: true });
  return path.join(dir, 'project');
}

async function pathExists(filePath) {
  return fs.stat(filePath).then(() => true, () => false);
}

async function readJsonl(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function writeAnswersFile(project, filename, payload) {
  const filePath = path.join(project, filename);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

async function writeMinimalChange(project, changeId, {
  title,
  requirementTitle = title,
  taskId = 'T001.01',
  taskTitle = title,
  verifyCommand = 'node -e "process.exit(0)"',
} = {}) {
  const changeDir = path.join(project, 'openprd', 'changes', changeId);
  const capability = changeId.split('-').slice(0, 2).join('-') || changeId;
  await fs.mkdir(path.join(changeDir, 'specs', capability), { recursive: true });
  await fs.writeFile(path.join(changeDir, 'proposal.md'), [
    `# ${title}`,
    '',
    '## Why',
    `${title} needs an isolated routing target.`,
    '',
    '## What Changes',
    `- ${title}`,
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'specs', capability, 'spec.md'), [
    `# ${capability} spec`,
    '',
    '## ADDED Requirements',
    '',
    `### Requirement: ${requirementTitle}`,
    `${title} must remain addressable by routing.`,
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'tasks.md'), [
    `- [ ] ${taskId} ${taskTitle}`,
    `  - done: ${taskTitle} is complete`,
    `  - verify: ${verifyCommand}`,
    '',
  ].join('\n'));
  return changeDir;
}

test('init creates a workspace and validate passes', async () => {
  const project = await makeTempProject();

  const initResult = await initWorkspace(project, { templatePack: 'consumer' });
  assert.equal(initResult.currentState.templatePack, 'consumer');
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
  assert.deepEqual(await fs.readdir(path.join(project, '.openprd', 'benchmarks', 'inbox')), []);
  assert.equal(await pathExists(path.join(project, '.openprd', 'learning', 'current.json')), false);
  assert.equal(await pathExists(path.join(project, '.openprd', 'learning', 'index.json')), false);
  assert.deepEqual(await fs.readdir(path.join(project, '.openprd', 'learning', 'archive')), []);
  assert.deepEqual(await fs.readdir(path.join(project, '.openprd', 'quality', 'reports')), []);
  assert.equal(await pathExists(path.join(project, '.openprd', 'engagements', 'active', 'clarify.html')), false);
  assert.equal(await pathExists(path.join(project, '.openprd', 'engagements', 'active', 'review.html')), false);
  assert.equal(hasTomlFeatureKey(await fs.readFile(path.join(project, '.codex', 'config.toml'), 'utf8'), 'codex_hooks'), true);
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
  assert.equal((await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-benchmark-router', 'SKILL.md'), 'utf8')).startsWith('---\n'), true);
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

test('clarify stays inline and synthesize writes a review artifact', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const clarify = await clarifyWorkspace(project, {});
  assert.ok(clarify.clarifyPresentation.mode.startsWith('inline'));
  assert.equal(clarify.clarifyArtifact, null);
  assert.equal(clarify.clarifyArtifactBundle, null);
  assert.equal(await pathExists(path.join(project, '.openprd', 'engagements', 'active', 'clarify.html')), false);
  assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('我理解的目标')));

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
  assert.ok(reviewHtml.includes('需求概览'));
  assert.ok(reviewHtml.includes('需求关系图') || reviewHtml.includes('需求流程图'));
  assert.ok(reviewHtml.includes('评审决定'));
  assert.ok(reviewHtml.includes('review-bottom-bar'));
  assert.ok(reviewHtml.includes('review-bottom-action revise'));
  assert.ok(reviewHtml.includes('review-bottom-action confirm'));
  assert.ok(reviewHtml.includes('需要调整'));
  assert.ok(reviewHtml.includes('认可方案'));
  assert.ok(reviewHtml.includes('重点摘要'));
  assert.ok(reviewHtml.includes('主流程小图'));
  assert.ok(reviewHtml.includes('用户旅程'));
  assert.ok(reviewHtml.includes('恢复路径'));
  assert.ok(reviewHtml.includes('review-detail-summary'));
  assert.ok(reviewHtml.includes('review-detail-body'));
  assert.ok(reviewHtml.includes('OpenPrD Review: 认可方案'));
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
  assert.ok(refreshedCanonicalReviewHtml.includes('认可方案'));
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
  assert.match(wrongDigestReview.errors[0], /Digest mismatch/);

  const wrongWorkUnitReview = await reviewWorkspace(project, {
    mark: 'confirmed',
    version: synthesized.snapshot.versionId,
    digest: synthesized.snapshot.digest,
    workUnit: 'other-work-unit',
  });
  assert.equal(wrongWorkUnitReview.ok, false);
  assert.match(wrongWorkUnitReview.errors[0], /Work unit mismatch/);

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

test('synthesize preflight blocks review creation when generated spec violates language policy', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  await assert.rejects(
    () => synthesizeWorkspace(project, {
      title: 'open pipeline 命名调整',
      owner: 'OpenPrd',
      problemStatement: '用户需要统一 open pipeline 命名。',
      whyNow: '当前 open pipeline 命名在多个入口里不一致。',
      primaryFlows: ['用户打开 open pipeline 入口'],
      goals: ['统一入口命名'],
      productType: 'agent',
    }),
    /spec\.md 仍会触发简体中文预检/
  );

  assert.equal(await pathExists(path.join(project, '.openprd', 'engagements', 'active', 'review.html')), false);
  assert.equal(await pathExists(path.join(project, '.openprd', 'state', 'version-index.json')), false);
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
  assert.ok(exportPayload.presentationContract.rules.some((rule) => rule.id === 'review-map-card-text' && rule.maxChars === 30));
  assert.ok(exportPayload.presentationContract.rules.some((rule) => rule.id === 'review-panel-detail-format' && rule.format === '- **摘要内容**：明细一句话'));
  assert.ok(exportPayload.presentationFeedback.some((item) => item.ruleId === 'review-map-card-text' && item.currentChars > item.maxChars));
  assert.ok(exportPayload.presentationFeedback.some((item) => item.ruleId === 'review-panel-detail-format' && item.expectedFormat === '- **摘要内容**：明细一句话'));

  const flowHtml = renderReviewArtifact({
    snapshot: {
      versionId: 'v0002',
      title: '流程图紧凑样例',
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
  const flowMapLabels = Array.from(
    flowHtml.matchAll(/<text class="review-map-label[^"]*"[^>]*>([\s\S]*?)<\/text>/g),
    ([, text]) => text.replace(/<[^>]+>/g, '')
  );
  assert.ok(flowMapLabels.length > 0);
  assert.ok(flowMapLabels.some((text) => Array.from(text).length > 30));
  const flowExportPayload = buildReviewExportPayload({
    versionId: 'v0002',
    title: '流程图紧凑样例',
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
      flowNodes: [
        { text: '打开评审页先扫图' },
        { text: '确认主流程覆盖' },
        { text: '补充风险和边界' },
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
});

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

test('benchmark CLI commands add list approve verify', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });
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
  assert.deepEqual(quality.report.qualityPolicy.requiredGates, ['smoke', 'feature-coverage']);
  assert.equal(quality.report.readiness.productionReady, true);
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
  const skill = await fs.readFile(learned.files.skill, 'utf8');
  assert.ok(skill.includes('## 触发条件'));
  assert.ok(skill.includes('## 关联字段'));
  assert.ok(skill.includes('## 先看哪些证据'));
  const index = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'knowledge', 'index.json'), 'utf8'));
  assert.equal(index.skills[0].skillName, learned.skillName);
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
  assert.ok(verified.warnings.some((warning) => warning.includes('production-ready')));
  assert.ok(qualityCheck.errors.some((error) => error.includes('production-ready')));
});

test('high-risk hook blocks on workspace debt without reframing it as task failure', async () => {
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
      OPENPRD_CLI: path.resolve('bin/openprd.js'),
    },
  });
  assert.equal(hookResult.status, 0);
  const hookPayload = JSON.parse(hookResult.stdout);
  assert.equal(hookPayload.decision, 'block');
  assert.ok(hookPayload.reason.includes('workspace is not fully ready'));
  assert.ok(hookPayload.reason.includes('Quality report is not production-ready'));
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
  assert.deepEqual(quality.report.qualityPolicy.requiredGates, ['smoke', 'feature-coverage']);
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
  assert.match(result.files.find((file) => file.path === 'src/medium.js').nextAction, /局部职责/);
  assert.equal(result.files.find((file) => file.path === 'src/large.js').status, 'warning');
  assert.match(result.files.find((file) => file.path === 'src/large.js').nextAction, /拆分/);
  assert.equal(result.files.find((file) => file.path === 'generated/bundle.js').status, 'exempt');
  assert.equal(result.files.find((file) => file.path === 'README.md').status, 'not-code');

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
  assert.equal(result.format, 'jpg');
  assert.equal(result.quality, 85);
  assert.equal(result.labels.reference, '效果图');
  assert.equal(result.labels.actual, '实现截图');
  assert.equal(result.outputPath.includes(path.join('.openprd', 'harness', 'visual-reviews')), true);
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
  assert.equal(beforeAfterResult.ok, true);
  assert.equal(beforeAfterResult.mode, 'before-after');
  assert.equal(beforeAfterResult.labels.reference, '修改前');
  assert.equal(beforeAfterResult.labels.actual, '修改后');
  assert.equal(beforeAfterResult.outputPath.includes('visual-before-after-'), true);
  assert.ok(beforeAfterResult.nextActions.some((action) => action.includes('未改区域')));

  await assert.rejects(
    visualCompareWorkspace(project, { reference, actual, before: reference, after: actual }),
    /Use either --reference\/--actual or --before\/--after/,
  );

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
      '--json',
    ]), 0);
  } finally {
    console.log = originalLog;
  }
  const beforeAfterCliResult = JSON.parse(beforeAfterLogs.join('\n'));
  assert.equal(beforeAfterCliResult.mode, 'before-after');
  assert.equal(beforeAfterCliResult.labels.reference, '修改前');
  assert.equal(beforeAfterCliResult.labels.actual, '修改后');
  assert.equal((await sharp(beforeAfterCliOut).metadata()).format, 'jpeg');
});

test('dev-check records growth candidate for unknown code extensions', async () => {
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
  assert.match(result.files[0].nextAction, /openprd grow/);

  const review = await reviewGrowthWorkspace(project);
  assert.equal(review.summary.pending, 1);
  assert.equal(review.pending[0].id, 'code-extension-astro');

  const reviewLogs = [];
  const originalLog = console.log;
  console.log = (...args) => reviewLogs.push(args.join(' '));
  try {
    assert.equal(await main(['grow', project, '--review']), 0);
  } finally {
    console.log = originalLog;
  }
  const reviewText = reviewLogs.join('\n');
  assert.match(reviewText, /状态: 待确认/);
  assert.match(reviewText, /作用范围: 项目共享规则/);
  assert.match(reviewText, /置信度: \d+%/);
  assert.match(reviewText, /采纳影响: 会把匹配 \.astro 的文件纳入代码文件规则/);
  assert.match(reviewText, /证据:/);
  assert.match(reviewText, /src\/component\.astro.*原因:/);
  assert.match(reviewText, /\.openprd\/standards\/config\.json -> developmentStandards\.codeFileLines\.codeFileExtensions append "\.astro"/);
  assert.match(reviewText, /采纳命令: openprd grow \. --apply --id code-extension-astro/);
  assert.match(reviewText, /拒绝命令: openprd grow \. --reject --id code-extension-astro/);

  const applyResult = await applyGrowthCandidateWorkspace(project, { id: 'code-extension-astro' });
  assert.equal(applyResult.ok, true);
  const standardsConfig = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'standards', 'config.json'), 'utf8'));
  assert.deepEqual(standardsConfig.developmentStandards.codeFileLines.codeFileExtensions, ['.astro']);

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

test('setup enables Codex hooks while preserving user hook groups', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  const previousCodexHome = process.env.OPENPRD_CODEX_HOME;
  process.env.OPENPRD_CODEX_HOME = codexHome;
  await fs.mkdir(path.join(project, '.codex'), { recursive: true });
  await fs.writeFile(path.join(project, '.codex', 'hooks.json'), JSON.stringify({
    PostToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: 'echo user-hook',
          },
        ],
      },
    ],
  }, null, 2) + '\n');

  try {
    const result = await setupAgentIntegrationWorkspace(project, {
      tools: 'codex',
      templatePack: 'agent',
      enableUserCodexConfig: true,
      codexHome,
    });
    assert.equal(result.ok, true);
    assert.equal(result.initialized, true);
    assert.deepEqual(result.tools, ['codex']);

    const hooks = JSON.parse(await fs.readFile(path.join(project, '.codex', 'hooks.json'), 'utf8'));
    assert.ok(hooks.PostToolUse.some((group) => group.hooks?.some((hook) => hook.command === 'echo user-hook')));
    assert.equal(hooks.PostToolUse.some((group) => group.hooks?.some((hook) => hook.command.includes('openprd-hook.mjs'))), false);
    assert.equal(Boolean(hooks.SessionStart?.some((group) => group.hooks?.some((hook) => hook.command.includes('openprd-hook.mjs')))), false);
    assert.ok(findOpenPrdHookGroup(hooks.UserPromptSubmit));
    assert.equal(findOpenPrdHookGroup(hooks.PreToolUse)?.matcher, OPENPRD_LITE_WRITE_TOOL_MATCHER);

    const config = await fs.readFile(path.join(project, '.codex', 'config.toml'), 'utf8');
    assert.ok(config.includes('[features]'));
    assert.ok(hasTomlFeatureKey(config, 'codex_hooks'));
    assert.equal(hasTomlFeatureKey(config, 'hooks'), false);
    assert.ok(config.includes('[[hooks.UserPromptSubmit]]'));
    assert.ok(config.includes('[[hooks.PreToolUse]]'));
    assert.ok(config.includes('[[hooks.Stop]]'));
    assert.ok(config.includes(`matcher = "${OPENPRD_LITE_WRITE_TOOL_MATCHER}"`));
    assert.equal(config.includes('matcher = "*"'), false);
    assert.equal(config.includes('[[hooks.PostToolUse]]'), false);
    const userConfig = await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8');
    assert.ok(hasTomlFeatureKey(userConfig, 'codex_hooks'));
    assert.equal(hasTomlFeatureKey(userConfig, 'hooks'), false);
    const manifest = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'install-manifest.json'), 'utf8'));
    assert.equal(manifest.hooks.profile, 'lite');
    assert.deepEqual(manifest.hooks.events, ['UserPromptSubmit', 'PreToolUse', 'Stop']);
    assert.ok(manifest.managedFiles.some((file) => file.path === '.codex/hooks/openprd-hook.mjs'));
    assert.ok(manifest.managedFiles.some((file) => file.path === '.openprd/harness/command-catalog.md'));
    const generatedAgents = await fs.readFile(path.join(project, 'AGENTS.md'), 'utf8');
    assert.ok(generatedAgents.includes('openprd dev-check . <file...>'));
    assert.ok(generatedAgents.includes('repo-local skills 和 hooks'));
    assert.ok(generatedAgents.includes('skills/openprd-router/SKILL.md'));
    assert.ok(generatedAgents.includes('.openprd/harness/command-catalog.md'));
    assert.ok(generatedAgents.includes('### Entry Points'));
    assert.ok(generatedAgents.includes('### Hook-Enforced Gates'));
    assert.ok(generatedAgents.includes('secrets-vault'));
    assert.ok(generatedAgents.includes('weapp-dev-mcp'));
    assert.ok(generatedAgents.includes('resolve_library_id -> query_docs'));
    assert.ok(generatedAgents.includes('Codex 原生 Image 2'));
    assert.ok(generatedAgents.includes('独立素材输出（standalone asset）'));
    assert.equal(generatedAgents.includes('## Skill Routing'), false);
    assert.equal(generatedAgents.includes('## Tool Reality'), false);
    assert.equal(generatedAgents.includes('## Working Principles'), false);
    assert.equal(generatedAgents.includes('### 标准命令'), false);
    assert.equal(generatedAgents.includes('超过 1500 行要判断本轮是否扩大职责'), false);
    assert.equal(generatedAgents.includes('个性化偏好只进入 user-local 范围'), false);
    assert.equal(generatedAgents.includes('## 大量只读扫描调度'), false);
    assert.equal(generatedAgents.includes('spark-code-researcher'), false);
    const generatedRouterSkill = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-router', 'SKILL.md'), 'utf8');
    assert.ok(generatedRouterSkill.includes('.openprd/harness/command-catalog.md'));
    assert.ok(generatedRouterSkill.includes('$openprd-shared'));
    assert.ok(generatedRouterSkill.includes('$openprd-harness'));
    assert.ok(generatedRouterSkill.includes('$openprd-benchmark-router'));
    const generatedCommandCatalog = await fs.readFile(path.join(project, '.openprd', 'harness', 'command-catalog.md'), 'utf8');
    assert.ok(generatedCommandCatalog.includes('openprd clarify .'));
    assert.ok(generatedCommandCatalog.includes('openprd review . --open'));
    assert.ok(generatedCommandCatalog.includes('openprd loop . --run --agent codex|claude --dry-run'));
    assert.ok(generatedCommandCatalog.includes('openprd visual-compare . --reference <效果图> --actual <实现截图>'));
    assert.ok(generatedCommandCatalog.includes('openprd quality . --verify'));
    const generatedBenchmarkSkill = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-benchmark-router', 'SKILL.md'), 'utf8');
    assert.ok(generatedBenchmarkSkill.includes('## Source Map'));
    assert.ok(generatedBenchmarkSkill.includes('Superpowers'));
    assert.ok(generatedBenchmarkSkill.includes('Context7'));
    assert.ok(generatedBenchmarkSkill.includes('不强行对标'));
    assert.ok(generatedBenchmarkSkill.includes('1-3 个最相关来源'));
    assert.ok(generatedBenchmarkSkill.includes('resolve_library_id'));
    assert.ok(generatedBenchmarkSkill.includes('query_docs'));
    assert.ok(generatedBenchmarkSkill.includes('read_wiki_structure'));
    assert.ok(generatedBenchmarkSkill.includes('ask_question'));
    assert.ok(generatedBenchmarkSkill.includes('已确认什么、还缺什么'));
    assert.ok(generatedBenchmarkSkill.includes('## Evaluation Lenses'));
    const generatedDiscoverySkill = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-discovery-loop', 'SKILL.md'), 'utf8');
    assert.ok(generatedDiscoverySkill.includes('## 大量只读扫描调度'));
    assert.ok(generatedDiscoverySkill.includes('2 个独立调研执行者 + 1 个审查'));
    assert.ok(generatedDiscoverySkill.includes('spark-code-researcher'));
    const generatedStandardsSkill = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-standards', 'SKILL.md'), 'utf8');
    assert.ok(generatedStandardsSkill.includes('## 文档影响检查'));
    assert.ok(generatedStandardsSkill.includes('openprd dev-check . <file...>'));
    assert.ok(generatedStandardsSkill.includes('研发期代码修改完成后、最终回复前'));
    assert.ok(generatedStandardsSkill.includes('openprd grow . --review'));
    assert.ok(generatedStandardsSkill.includes('grow-aware'));
    assert.ok(generatedStandardsSkill.includes('若已有文件说明书'));
    assert.ok(generatedStandardsSkill.includes('CLI 接入面和 API 接入面'));
    const generatedQualitySkill = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-quality', 'SKILL.md'), 'utf8');
    assert.ok(generatedQualitySkill.includes('HTML 质量评估报告'));
    assert.ok(generatedQualitySkill.includes('必需 EVO 门禁'));
    assert.ok(generatedQualitySkill.includes('openprd grow . --review'));
    assert.ok(generatedQualitySkill.includes('视觉评审证据'));
    assert.ok(generatedQualitySkill.includes('visual-compare'));
    const generatedSharedSkill = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-shared', 'SKILL.md'), 'utf8');
    assert.ok(generatedSharedSkill.includes('默认按性价比选方案'));
    assert.ok(generatedSharedSkill.includes('AGENTS.md` 只保留轻量合同'));
    assert.ok(generatedSharedSkill.includes('secrets-vault'));
    assert.ok(generatedSharedSkill.includes('weapp-dev-mcp'));
    assert.ok(generatedSharedSkill.includes('Localizable'));
    assert.ok(generatedSharedSkill.includes('彩色 Mermaid'));
    const generatedHarnessSkill = await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-harness', 'SKILL.md'), 'utf8');
    assert.ok(generatedHarnessSkill.includes('AGENTS.md` 只保留轻量合同'));
    assert.ok(generatedHarnessSkill.includes('外部证据不足就直接改第三方集成'));
    assert.ok(generatedSharedSkill.includes('第三方 API、模型、云服务或付费工具'));
    assert.ok(generatedSharedSkill.includes('多个对象、方案、文件、场景、风险、验证项、素材或任务'));
    assert.ok(generatedSharedSkill.includes('方案对比、状态盘点、问题排查、风险审查、多对象 QA'));
    assert.ok(generatedSharedSkill.includes('高置信应可成长'));
    assert.ok(generatedSharedSkill.includes('openprd update .'));
    assert.ok(generatedSharedSkill.includes('左侧标注“效果图”'));
    assert.ok(generatedSharedSkill.includes('修改前'));
    assert.ok(generatedHarnessSkill.includes('代码修改完成后、最终回复前'));
    assert.ok(generatedHarnessSkill.includes('growth candidate'));
    assert.ok(generatedHarnessSkill.includes('主动询问用户是否做成可成长配置'));
    assert.ok(generatedHarnessSkill.includes('业务和产品语言'));
    assert.ok(generatedHarnessSkill.includes('性价比最优'));
    assert.ok(generatedHarnessSkill.includes('主动使用 Markdown 表格'));
    assert.ok(generatedHarnessSkill.includes('.openprd/harness/visual-reviews/'));
    assert.ok(generatedHarnessSkill.includes('实现截图'));
    assert.ok(generatedHarnessSkill.includes('--before'));
    const generatedVisualCommand = await fs.readFile(path.join(project, '.codex', 'prompts', 'openprd-visual-compare.md'), 'utf8');
    assert.ok(generatedVisualCommand.includes('side-by-side JPG'));
    assert.ok(generatedVisualCommand.includes('效果图'));
    assert.ok(generatedVisualCommand.includes('实现截图'));
    assert.ok(generatedVisualCommand.includes('--before'));
    assert.ok(generatedVisualCommand.includes('修改后'));

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      assert.equal(await main(['doctor', project, '--tools', 'codex', '--json']), 0);
    } finally {
      console.log = originalLog;
    }
    assert.ok(JSON.parse(logs.join('\n')).ok);

    await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
      type: 'module',
      scripts: {
        'test:smoke': 'node --test smoke.test.js',
      },
    }, null, 2)}\n`);
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
    await fs.mkdir(path.join(project, '.openprd', 'harness', 'test-reports'), { recursive: true });
    await fs.writeFile(path.join(project, '.openprd', 'harness', 'test-reports', 'setup-smoke.md'), [
      '# EVO setup report',
      '',
      '- smoke: passed setup hook flow',
      '- feature coverage: no active change',
      '',
    ].join('\n'));

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
        OPENPRD_CLI: path.resolve('bin/openprd.js'),
      },
    });
    assert.equal(hookResult.status, 0);
    const hookPayload = JSON.parse(hookResult.stdout);
    assert.equal(hookPayload.continue, true);
    assert.equal(hookPayload.should_stop, undefined);
    assert.equal(hookPayload.additional_contexts, undefined);
    assert.equal(hookPayload.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.ok(hookPayload.hookSpecificOutput.additionalContext.includes('high-risk gate passed'));

    const lowRiskResult = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), 'PreToolUse'], {
      cwd: project,
      input: JSON.stringify({
        cwd: project,
        tool_input: {
          cmd: 'ls',
        },
      }),
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENPRD_CLI: path.resolve('bin/openprd.js'),
      },
    });
    assert.equal(lowRiskResult.status, 0);
    assert.deepEqual(JSON.parse(lowRiskResult.stdout), { continue: true });

    const successPostResult = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), 'PostToolUse'], {
      cwd: project,
      input: JSON.stringify({
        cwd: project,
        tool_input: {
          cmd: 'ls',
        },
        tool_response: {
          stdout: 'README.md',
        },
      }),
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENPRD_CLI: path.resolve('bin/openprd.js'),
      },
    });
    assert.equal(successPostResult.status, 0);
    assert.deepEqual(JSON.parse(successPostResult.stdout), { continue: true });

    const sessionStartResult = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), 'SessionStart'], {
      cwd: project,
      input: JSON.stringify({
        cwd: project,
        hook_event_name: 'SessionStart',
      }),
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENPRD_CLI: path.resolve('bin/openprd.js'),
      },
    });
    assert.equal(sessionStartResult.status, 0);
    assert.deepEqual(JSON.parse(sessionStartResult.stdout), { continue: true });

    for (const eventName of ['UserPromptSubmit']) {
      const eventResult = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), eventName], {
        cwd: project,
        input: JSON.stringify({
          cwd: project,
          hook_event_name: eventName,
          prompt: eventName === 'UserPromptSubmit' ? '继续推进 OpenPrd' : undefined,
        }),
        encoding: 'utf8',
        env: {
          ...process.env,
          OPENPRD_CLI: path.resolve('bin/openprd.js'),
        },
      });
      assert.equal(eventResult.status, 0);
      const eventPayload = JSON.parse(eventResult.stdout);
      assert.equal(eventPayload.continue, true);
      assert.equal(eventPayload.should_stop, undefined);
      assert.equal(eventPayload.additional_contexts, undefined);
      assert.equal(eventPayload.hookSpecificOutput.hookEventName, eventName);
      assert.ok(eventPayload.hookSpecificOutput.additionalContext.includes('OpenPrd 运行上下文'));
      assert.ok(eventPayload.hookSpecificOutput.additionalContext.includes('OpenPrd 上下文只是建议'));
      assert.equal(eventPayload.hookSpecificOutput.additionalContext.includes('Follow the recommended OpenPrd run command'), false);
    }
    const events = await fs.readFile(path.join(project, '.openprd', 'harness', 'events.jsonl'), 'utf8');
    assert.ok(events.includes('allowed-high-risk'));
    assert.equal(events.includes('allowed-low-risk'), false);
    assert.equal(events.includes('tool-complete'), false);

    await fs.appendFile(path.join(project, '.codex', 'skills', 'openprd-harness', 'SKILL.md'), '\nmanual drift\n');
    const drifted = await doctorWorkspace(project, { tools: 'codex', enableUserCodexConfig: true, codexHome });
    assert.equal(drifted.ok, false);
    assert.ok(drifted.agentIntegration.drift.errors.some((error) => error.includes('checksum-drift')));
    const updated = await updateAgentIntegrationWorkspace(project, {
      tools: 'codex',
      templatePack: 'agent',
      enableUserCodexConfig: true,
      codexHome,
    });
    assert.equal(updated.ok, true);
    const repaired = await doctorWorkspace(project, { tools: 'codex', enableUserCodexConfig: true, codexHome });
    assert.equal(repaired.ok, true);
    assert.equal(repaired.agentIntegration.drift.ok, true);
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.OPENPRD_CODEX_HOME;
    } else {
      process.env.OPENPRD_CODEX_HOME = previousCodexHome;
    }
  }
});


test('clarify treats legacy artifact mode as an inline checklist', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const clarify = await clarifyWorkspace(project, { mode: 'artifact', open: true });
  assert.equal(clarify.clarifyPresentation.mode, 'inline-with-checklist');
  assert.equal(clarify.clarifyArtifact, null);
  assert.equal(clarify.clarifyArtifactBundle, null);
  assert.equal(clarify.opened, false);
  assert.equal(await pathExists(path.join(project, '.openprd', 'engagements', 'active', 'clarify.html')), false);
  assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('我理解的目标')));
});

test('doctor fails when Codex hook emits legacy output schema', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    templatePack: 'agent',
    enableUserCodexConfig: true,
    codexHome,
  });

  await fs.writeFile(
    path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'),
    'console.log(JSON.stringify({ should_stop: false, additional_contexts: [] }));\n',
  );

  const result = await doctorWorkspace(project, { tools: 'codex', enableUserCodexConfig: true, codexHome });
  assert.equal(result.ok, false);
  assert.ok(result.agentIntegration.checks.some((check) => (
    check.path === '.codex/hooks/openprd-hook.mjs:smoke'
      && check.ok === false
      && check.message.includes('legacy fields')
  )));
});

test('setup migrates invalid Codex hooks feature flag', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  await fs.mkdir(path.join(project, '.codex'), { recursive: true });
  await fs.writeFile(path.join(project, '.codex', 'config.toml'), '[features]\nhooks = true\nchild_agents_md = true\n');
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(path.join(codexHome, 'config.toml'), '[features]\nhooks = true\n');

  const result = await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    enableUserCodexConfig: true,
    codexHome,
  });
  assert.equal(result.ok, true);

  const config = await fs.readFile(path.join(project, '.codex', 'config.toml'), 'utf8');
  assert.ok(hasTomlFeatureKey(config, 'codex_hooks'));
  assert.ok(config.includes('child_agents_md = true'));
  assert.equal(hasTomlFeatureKey(config, 'hooks'), false);

  const userConfig = await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8');
  assert.ok(hasTomlFeatureKey(userConfig, 'codex_hooks'));
  assert.equal(hasTomlFeatureKey(userConfig, 'hooks'), false);
});

test('setup can opt into guarded Codex hook profile', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  const result = await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    hookProfile: 'guarded',
    enableUserCodexConfig: true,
    codexHome,
  });
  assert.equal(result.ok, true);
  assert.equal(result.hookProfile, 'guarded');

  const hooks = JSON.parse(await fs.readFile(path.join(project, '.codex', 'hooks.json'), 'utf8'));
  assert.ok(findOpenPrdHookGroup(hooks.UserPromptSubmit));
  assert.equal(findOpenPrdHookGroup(hooks.PreToolUse)?.matcher, OPENPRD_GUARDED_WRITE_TOOL_MATCHER);
  assert.equal(Boolean(hooks.PostToolUse?.some((group) => group.hooks?.some((hook) => hook.command.includes('openprd-hook.mjs')))), false);

  const config = await fs.readFile(path.join(project, '.codex', 'config.toml'), 'utf8');
  assert.ok(config.includes('[[hooks.UserPromptSubmit]]'));
  assert.ok(config.includes('[[hooks.PreToolUse]]'));
  assert.ok(config.includes('[[hooks.Stop]]'));
  assert.ok(config.includes(`matcher = "${OPENPRD_GUARDED_WRITE_TOOL_MATCHER}"`));
  assert.equal(config.includes('[[hooks.PostToolUse]]'), false);

  const manifest = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'install-manifest.json'), 'utf8'));
  assert.equal(manifest.hooks.profile, 'guarded');
  assert.deepEqual(manifest.hooks.events, ['UserPromptSubmit', 'PreToolUse', 'Stop']);

  const doctor = await doctorWorkspace(project, { tools: 'codex', enableUserCodexConfig: true, codexHome });
  assert.equal(doctor.agentIntegration.hookProfile, 'guarded');
  assert.equal(doctor.ok, true);
});

test('run exposes hook-stable context and records hook iterations', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await synthesizeWorkspace(project, {
    title: 'Run Loop',
    owner: 'PM',
    problemStatement: 'Agents need a stable next execution unit',
    whyNow: 'Hook-driven runs should not depend on chat history',
    primaryUsers: ['Product agents'],
    goals: ['Make the next unit explicit'],
    successMetrics: ['Run context points to the next task'],
    acceptanceGoals: ['The hook can record iterations'],
    inScope: ['Run context'],
    outOfScope: ['External schedulers'],
    primaryFlows: ['Agent reads run context'],
    functional: Array.from({ length: 10 }, (_, index) => `Expose next task slice ${index + 1}`),
    productType: 'consumer',
  });
  await reviewWorkspace(project, { mark: 'confirmed' });
  await generateOpenSpecChangeWorkspace(project, { change: 'run-loop' });

  const context = await runWorkspace(project, { context: true });
  assert.equal(context.action, 'run-context');
  assert.equal(context.activeChange, 'run-loop');
  assert.equal(context.recommendation.type, 'loop-task');
  assert.equal(context.recommendation.loop.required, true);
  assert.ok(context.recommendation.command.includes('openprd tasks . --change'));
  assert.ok(context.recommendation.preparationCommand.includes('openprd loop . --plan --change'));
  assert.ok(context.recommendation.executionCommand.includes('openprd loop . --run --agent codex'));
  assert.equal(context.recommendation.executionCommand.includes('--commit'), false);
  assert.ok(context.recommendation.commitCommand.includes('openprd loop . --finish'));
  assert.equal(context.recommendation.intentGate.requiresExplicitIntent, true);
  const continuationContext = await runWorkspace(project, {
    context: true,
    message: '继续执行这个记录：019e5ac7-088b-7ff2-86d1-4c026ff68105',
  });
  assert.equal(continuationContext.lane.kind, 'continuation');
  assert.equal(continuationContext.lane.selectorType, 'session');
  assert.equal(continuationContext.lane.target.sessionId, '019e5ac7-088b-7ff2-86d1-4c026ff68105');
  assert.equal(continuationContext.lane.target.changeId, null);
  assert.equal(continuationContext.recommendation.type, 'session-continuation');
  assert.equal(continuationContext.recommendation.continuationTarget.sessionId, '019e5ac7-088b-7ff2-86d1-4c026ff68105');
  assert.ok(continuationContext.recommendation.reason.includes('工具无关的会话 ID'));
  assert.ok(continuationContext.recommendation.reason.includes('不能用相似历史、当前 active change'));
  assert.equal(continuationContext.recommendation.reason.includes('存在一个依赖已就绪的 OpenPrd 任务'), false);
  assert.ok(await fs.stat(path.join(project, '.openprd', 'harness', 'run-state.json')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.openprd', 'harness', 'iterations.jsonl')).then(() => true));

  const recorded = await runWorkspace(project, {
    recordHook: true,
    event: 'UserPromptSubmit',
    risk: 'low',
    outcome: 'context-injected',
    preview: 'start run',
  });
  assert.equal(recorded.ok, true);
  const iterations = await fs.readFile(path.join(project, '.openprd', 'harness', 'iterations.jsonl'), 'utf8');
  assert.ok(iterations.includes('UserPromptSubmit'));
  assert.ok(iterations.includes('context-injected'));

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['run', project, '--context']), 0);
  } finally {
    console.log = originalLog;
  }
  assert.ok(logs.some((line) => line.includes('OpenPrd 运行上下文')));
  assert.ok(logs.some((line) => line.includes('建议只读命令')));
  assert.ok(logs.some((line) => line.includes('执行门槛')));

  const continuationLogs = [];
  console.log = (...args) => continuationLogs.push(args.join(' '));
  try {
    assert.equal(await main(['run', project, '--context', '--message', '继续执行这个记录：019e5ac7-088b-7ff2-86d1-4c026ff68105']), 0);
  } finally {
    console.log = originalLog;
  }
  assert.ok(continuationLogs.some((line) => line.includes('执行流: 继续已有任务')));
  assert.ok(continuationLogs.some((line) => line.includes('下一步类型: session-continuation')));
  assert.ok(continuationLogs.some((line) => line.includes('会话 ID')));

  const tasksPath = path.join(project, 'openprd', 'changes', 'run-loop', 'tasks.md');
  const tasksText = await fs.readFile(tasksPath, 'utf8');
  await fs.writeFile(tasksPath, tasksText.replace(/- \[ \]/g, '- [x]'));
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    type: 'module',
    scripts: {
      'test:smoke': 'node --test smoke.test.js',
    },
  }, null, 2)}\n`);
  await fs.mkdir(path.join(project, '.openprd', 'harness', 'test-reports'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'test-reports', 'run-loop-smoke.md'), [
    '# EVO run-loop report',
    '',
    '- smoke: passed run context main flow',
    '- feature coverage: tasks done',
    '',
  ].join('\n'));

  const verified = await runWorkspace(project, { verify: true });
  assert.equal(verified.ok, true);
  assert.ok(verified.checks.some((check) => check.name === 'change' && check.ok));
});

test('run context keeps lightweight task advance below the implementation task threshold', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await synthesizeWorkspace(project, {
    title: 'Small Run',
    owner: 'PM',
    problemStatement: 'Small changes should stay lightweight',
    whyNow: 'Loop should be reserved for larger work',
    primaryUsers: ['Product agents'],
    goals: ['Keep small work simple'],
    successMetrics: ['Run context points to a lightweight task'],
    acceptanceGoals: ['The hook can recommend a single task'],
    inScope: ['Run context'],
    outOfScope: ['Large feature loops'],
    primaryFlows: ['Agent reads run context'],
    functional: ['Expose next task'],
    productType: 'consumer',
  });
  await reviewWorkspace(project, { mark: 'confirmed' });
  const generated = await generateOpenSpecChangeWorkspace(project, { change: 'small-run' });
  await fs.writeFile(path.join(generated.changeDir, 'tasks.md'), [
    '- [ ] T001.01 Prepare small state',
    '  - done: small state is ready',
    '  - verify: node -e "process.exit(0)"',
    '- [ ] T001.02 Wire small command',
    '  - done: small command is ready',
    '  - verify: node -e "process.exit(0)"',
    '',
  ].join('\n'));

  const context = await runWorkspace(project, { context: true });
  assert.equal(context.recommendation.type, 'task');
  assert.equal(context.recommendation.loop.required, false);
  assert.ok(context.recommendation.command.includes('openprd tasks . --change'));
});

test('run context prioritizes active requirement intake over historical active change tasks', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await synthesizeWorkspace(project, {
    title: 'Historical Change',
    owner: 'PM',
    problemStatement: 'The workspace has an older unfinished change',
    whyNow: 'The older change should not take over a new intake',
    primaryUsers: ['Product agents'],
    goals: ['Keep new intake separate'],
    successMetrics: ['Run context points to intake first'],
    acceptanceGoals: ['Historical change is only a reminder'],
    inScope: ['Run context recommendation'],
    outOfScope: ['Executing the older task'],
    primaryFlows: ['Agent reads run context'],
    functional: ['Expose next task'],
    productType: 'consumer',
  });
  await reviewWorkspace(project, { mark: 'confirmed' });
  await generateOpenSpecChangeWorkspace(project, { change: 'historical-change' });
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
    version: 1,
    active: true,
    status: 'requires-clarification',
    openedAt: '2026-05-25 10:00:00',
    updatedAt: '2026-05-25 10:00:00',
    promptPreview: '新增一个本轮独立需求入口，不要继续旧任务。',
    requiredFlow: ['clarify', 'capture', 'synthesize', 'review', 'change-generate', 'tasks', 'implementation'],
    intakeMode: 'focused-reflection',
  }, null, 2));

  const context = await runWorkspace(project, { context: true });
  assert.equal(context.activeChange, 'historical-change');
  assert.equal(context.activeRequirementGate.status, 'requires-clarification');
  assert.equal(context.recommendation.type, 'requirement-intake');
  assert.equal(context.recommendation.changeId, null);
  assert.ok(context.recommendation.command.includes('openprd clarify'));
  assert.ok(context.recommendation.reason.includes('历史 active change historical-change 仅作为提醒'));

  const continuationContext = await runWorkspace(project, {
    context: true,
    message: '继续执行这个记录：019e5ac7-088b-7ff2-86d1-4c026ff68105',
  });
  assert.equal(continuationContext.lane.selectorType, 'session');
  assert.equal(continuationContext.lane.target.changeId, null);
  assert.equal(continuationContext.recommendation.type, 'session-continuation');
  assert.ok(continuationContext.recommendation.reason.includes('不能用相似历史、当前 active change'));
  assert.ok(continuationContext.recommendation.reason.includes('只作为背景提醒'));
  assert.equal(continuationContext.recommendation.reason.includes('存在一个依赖已就绪的 OpenPrd 任务'), false);
});

test('run context can route by user-described requirement instead of the global active change', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await writeMinimalChange(project, 'hermes-playwright-chromium-oss', {
    title: 'Hermes Playwright Chromium OSS',
    requirementTitle: 'Hermes Playwright Chromium OSS',
    taskTitle: 'Keep Hermes browser loop alive',
  });
  await writeMinimalChange(project, 'resource-layer-public-model-api', {
    title: 'Resource Layer Public Model API',
    requirementTitle: 'Public model API for the resource layer',
    taskTitle: 'Build public model API for the resource layer',
  });
  await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), JSON.stringify({
    version: 1,
    activeChange: 'hermes-playwright-chromium-oss',
    changes: {
      'hermes-playwright-chromium-oss': { id: 'hermes-playwright-chromium-oss', status: 'active' },
      'resource-layer-public-model-api': { id: 'resource-layer-public-model-api', status: 'draft' },
    },
  }, null, 2));

  const context = await runWorkspace(project, {
    context: true,
    message: 'resource-layer-public-model-api 公共模型 API 需求',
  });
  assert.equal(context.activeChange, 'hermes-playwright-chromium-oss');
  assert.equal(context.focus.changeId, 'resource-layer-public-model-api');
  assert.equal(context.lane.kind, 'targeted');
  assert.equal(context.lane.target.changeId, 'resource-layer-public-model-api');
  assert.equal(context.recommendation.changeId, 'resource-layer-public-model-api');
  assert.equal(context.nextTask.id, 'T001.01');
  assert.equal(context.nextTask.title, 'Build public model API for the resource layer');
  assert.ok(context.recommendation.reason.includes('当前用户消息已经命中变更 resource-layer-public-model-api'));
});

test('run context resolves a historical session from local session artifacts before considering active change', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await writeMinimalChange(project, 'hermes-playwright-chromium-oss', {
    title: 'Hermes Playwright Chromium OSS',
    requirementTitle: 'Hermes Playwright Chromium OSS',
    taskTitle: 'Keep Hermes browser loop alive',
  });
  await writeMinimalChange(project, 'resource-layer-public-model-api', {
    title: 'Resource Layer Public Model API',
    requirementTitle: 'Public model API for the resource layer',
    taskTitle: 'Build public model API for the resource layer',
  });
  await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), JSON.stringify({
    version: 1,
    activeChange: 'hermes-playwright-chromium-oss',
    changes: {
      'hermes-playwright-chromium-oss': { id: 'hermes-playwright-chromium-oss', status: 'active' },
      'resource-layer-public-model-api': { id: 'resource-layer-public-model-api', status: 'draft' },
    },
  }, null, 2));
  const sessionId = '019e5d11-8c9d-7652-a5cb-24125046ea48';
  await fs.mkdir(path.join(project, '.openprd', 'harness', 'requirement-gates'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gates', `${sessionId}.json`), JSON.stringify({
    version: 1,
    active: false,
    status: 'execution-authorized',
    sessionId,
    promptPreview: '继续 resource-layer-public-model-api 公共模型 API 需求',
  }, null, 2));

  const context = await runWorkspace(project, {
    context: true,
    message: `继续这个Codex任务：${sessionId}`,
  });
  assert.equal(context.activeChange, 'hermes-playwright-chromium-oss');
  assert.equal(context.lane.selectorType, 'session');
  assert.equal(context.lane.target.sessionId, sessionId);
  assert.equal(context.lane.target.changeId, 'resource-layer-public-model-api');
  assert.equal(context.recommendation.type, 'session-continuation');
  assert.equal(context.recommendation.changeId, 'resource-layer-public-model-api');
  assert.ok(context.recommendation.reason.includes('本地已恢复到 变更 resource-layer-public-model-api'));
  assert.ok(context.recommendation.reason.includes('当前工作区 active change hermes-playwright-chromium-oss 只作为背景提醒'));
});

test('run context prefers a persisted session binding over ambiguous requirement gate text', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await writeMinimalChange(project, 'hermes-playwright-chromium-oss', {
    title: 'Hermes Playwright Chromium OSS',
    requirementTitle: 'Hermes Playwright Chromium OSS',
    taskTitle: 'Keep Hermes browser loop alive',
  });
  await writeMinimalChange(project, 'resource-layer-public-model-api', {
    title: 'Resource Layer Public Model API',
    requirementTitle: 'Public model API for the resource layer',
    taskTitle: 'Build public model API for the resource layer',
  });
  await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), JSON.stringify({
    version: 1,
    activeChange: 'hermes-playwright-chromium-oss',
    changes: {
      'hermes-playwright-chromium-oss': { id: 'hermes-playwright-chromium-oss', status: 'active' },
      'resource-layer-public-model-api': { id: 'resource-layer-public-model-api', status: 'draft' },
    },
  }, null, 2));
  const sessionId = '019e5f21-54be-7042-bb92-9ba6b2c24757';
  await fs.mkdir(path.join(project, '.openprd', 'harness', 'requirement-gates'), { recursive: true });
  await fs.mkdir(path.join(project, '.openprd', 'harness', 'session-bindings'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gates', `${sessionId}.json`), JSON.stringify({
    version: 1,
    active: true,
    status: 'prd-review-required',
    sessionId,
    promptPreview: '继续这个记录，别被当前 active change 带偏。',
  }, null, 2));
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'session-bindings', `${sessionId}.json`), JSON.stringify({
    version: 1,
    sessionId,
    promptPreview: '继续资源层公共模型 API 需求',
    title: 'Resource Layer Public Model API',
    changeId: 'resource-layer-public-model-api',
    workUnitId: 'wu-20260525220909-30c25b2d',
    versionId: 'v0165',
    digest: 'deadbeef',
    reviewStatus: 'confirmed',
  }, null, 2));

  const context = await runWorkspace(project, {
    context: true,
    message: `继续这个Codex任务：${sessionId}`,
  });
  assert.equal(context.activeChange, 'hermes-playwright-chromium-oss');
  assert.equal(context.lane.selectorType, 'session');
  assert.equal(context.lane.target.sessionId, sessionId);
  assert.equal(context.lane.target.changeId, 'resource-layer-public-model-api');
  assert.equal(context.recommendation.changeId, 'resource-layer-public-model-api');
  assert.ok(context.lane.resolution.reason.includes('lane 绑定指向变更 resource-layer-public-model-api'));
  assert.ok(context.recommendation.reason.includes('本地已恢复到 变更 resource-layer-public-model-api'));
  assert.ok(context.recommendation.reason.includes('当前工作区 active change hermes-playwright-chromium-oss 只作为背景提醒'));
});

test('run verify validates the focused change instead of the global active change', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await writeMinimalChange(project, 'hermes-playwright-chromium-oss', {
    title: 'Hermes Playwright Chromium OSS',
    requirementTitle: 'Hermes Playwright Chromium OSS',
    taskTitle: 'Keep Hermes browser loop alive',
  });
  await writeMinimalChange(project, 'resource-layer-public-model-api', {
    title: 'Resource Layer Public Model API',
    requirementTitle: 'Public model API for the resource layer',
    taskTitle: 'Build public model API for the resource layer',
  });

  const validatedChanges = [];
  const taskStateFor = (changeId, title) => ({
    ok: true,
    action: 'list',
    projectRoot: project,
    changeId,
    changeDir: path.join(project, 'openprd', 'changes', changeId),
    tasks: [{
      id: 'T001.01',
      title,
      taskHandle: `${changeId}:T001.01:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      relativePath: `openprd/changes/${changeId}/tasks.md`,
      lineNumber: 1,
      checked: false,
      metadata: {
        verify: 'node -e "process.exit(0)"',
      },
    }],
    summary: {
      total: 1,
      completed: 0,
      pending: 1,
      blocked: 0,
      implementation: {
        total: 1,
        completed: 0,
        pending: 1,
      },
    },
    nextTask: {
      id: 'T001.01',
      title,
      taskHandle: `${changeId}:T001.01:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      relativePath: `openprd/changes/${changeId}/tasks.md`,
      lineNumber: 1,
      metadata: {
        verify: 'node -e "process.exit(0)"',
      },
    },
    blockedTasks: [],
  });

  const run = createRunWorkspace({
    checkStandardsWorkspace: async () => ({ ok: true, errors: [] }),
    listOpenPrdChangesWorkspace: async () => ({
      ok: true,
      activeChange: 'hermes-playwright-chromium-oss',
      changes: [
        {
          id: 'hermes-playwright-chromium-oss',
          active: true,
          changeDir: path.join(project, 'openprd', 'changes', 'hermes-playwright-chromium-oss'),
        },
        {
          id: 'resource-layer-public-model-api',
          active: false,
          changeDir: path.join(project, 'openprd', 'changes', 'resource-layer-public-model-api'),
        },
      ],
    }),
    listOpenSpecTaskWorkspace: async (_projectRoot, options = {}) => (
      options.change === 'resource-layer-public-model-api'
        ? taskStateFor('resource-layer-public-model-api', 'Build public model API for the resource layer')
        : taskStateFor('hermes-playwright-chromium-oss', 'Keep Hermes browser loop alive')
    ),
    nextWorkspace: async () => ({
      workflow: [],
      recommendation: {
        nextAction: 'noop',
        suggestedCommand: 'openprd next .',
        reason: 'stub',
      },
      analysisSnapshot: null,
      prdReviewState: null,
    }),
    resumeOpenSpecDiscoveryWorkspace: async () => null,
    validateOpenSpecChangeWorkspace: async (_projectRoot, options = {}) => {
      validatedChanges.push(options.change);
      return {
        ok: options.change === 'resource-layer-public-model-api',
        errors: options.change === 'resource-layer-public-model-api' ? [] : ['wrong change validated'],
      };
    },
    validateWorkspace: async () => ({
      report: {
        valid: true,
        errors: [],
        warnings: [],
      },
    }),
    verifyOpenSpecDiscoveryWorkspace: async () => ({
      ok: true,
      verification: {
        errors: [],
      },
    }),
    verifyQualityWorkspace: async () => ({
      ok: true,
      errors: [],
      report: {
        readiness: {
          productionReady: true,
          attentionGates: [],
        },
      },
    }),
  });

  const result = await run(project, {
    verify: true,
    message: 'resource-layer-public-model-api 公共模型 API 需求',
  });
  assert.equal(result.ok, true);
  assert.equal(result.context.focus.changeId, 'resource-layer-public-model-api');
  assert.deepEqual(validatedChanges, ['resource-layer-public-model-api']);
});

test('run context and verify ignore reference discovery by default', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await synthesizeWorkspace(project, {
    title: 'Reference Discovery Boundary',
    owner: 'PM',
    problemStatement: 'Reference discovery should not pollute primary run verification',
    whyNow: 'Verify output needs to stay scoped to the current project',
    primaryUsers: ['Project maintainers'],
    goals: ['Keep primary verify scoped'],
    successMetrics: ['Run context keeps the implementation recommendation'],
    acceptanceGoals: ['Reference discovery stays outside default run verify'],
    inScope: ['Run context', 'Run verify'],
    outOfScope: ['Reference mining workflows'],
    primaryFlows: ['Maintainer reads run context'],
    functional: Array.from({ length: 10 }, (_, index) => `Expose implementation slice ${index + 1}`),
    productType: 'consumer',
  });
  await reviewWorkspace(project, { mark: 'confirmed' });
  await generateOpenSpecChangeWorkspace(project, { change: 'reference-boundary' });

  const tasksPath = path.join(project, 'openprd', 'changes', 'reference-boundary', 'tasks.md');
  const tasksText = await fs.readFile(tasksPath, 'utf8');
  await fs.writeFile(tasksPath, tasksText.replace(/- \[ \]/g, '- [x]'));
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    type: 'module',
    scripts: {
      'test:smoke': 'node --test smoke.test.js',
    },
  }, null, 2)}\n`);
  await fs.mkdir(path.join(project, '.openprd', 'harness', 'test-reports'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'test-reports', 'reference-boundary-smoke.md'), [
    '# EVO reference boundary report',
    '',
    '- smoke: passed scoped verify flow',
    '- feature coverage: tasks done',
    '',
  ].join('\n'));

  const referenceProject = path.join(project, 'research', 'reference-repo');
  await fs.mkdir(path.join(referenceProject, '.git'), { recursive: true });
  await fs.writeFile(path.join(referenceProject, 'ref.js'), 'export const reference = true;\n');
  await openspecDiscoveryWorkspace(project, {
    mode: 'reference',
    reference: 'research/reference-repo',
  });

  const context = await runWorkspace(project, { context: true });
  assert.equal(context.activeChange, 'reference-boundary');
  assert.equal(context.discovery, null);
  assert.equal(context.recommendation.type, 'change-review');

  const verified = await runWorkspace(project, { verify: true });
  assert.equal(verified.context.discovery, null);
  assert.equal(verified.checks.some((check) => check.name === 'discovery'), false);
  assert.equal(verified.errors.some((error) => error.startsWith('discovery:')), false);
});

test('fleet dry-run plans historical updates without auto-claiming agent-only projects', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-fleet-test-'));
  const openprdHome = path.join(root, '.openprd-home');
  const existing = path.join(root, 'existing-openprd');
  const agentOnly = path.join(root, 'agent-only');
  const plain = path.join(root, 'plain-project');
  await fs.mkdir(existing, { recursive: true });
  await fs.mkdir(path.join(agentOnly, '.codex'), { recursive: true });
  await fs.mkdir(plain, { recursive: true });
  await fs.writeFile(path.join(agentOnly, 'AGENTS.md'), '# Local Agent Notes\n');
  await fs.writeFile(path.join(plain, 'package.json'), '{"name":"plain-project"}\n');

  await initWorkspace(existing, { templatePack: 'agent', openprdHome });
  const synthesized = await synthesizeWorkspace(existing, {
    title: '历史需求',
    owner: 'PM',
    problemStatement: '历史项目缺少稳定需求身份',
    whyNow: '多 Agent 并行后容易串需求',
    primaryUsers: ['维护者'],
    goals: ['历史确认命令可校验'],
    inScope: ['补历史 work unit'],
    outOfScope: ['接管 agent-only 项目'],
    functional: ['历史评审产物带工作单元 ID'],
  });
  const legacyVersionPath = path.join(existing, '.openprd', 'state', 'versions', 'v0001.json');
  const legacySnapshot = JSON.parse(await fs.readFile(legacyVersionPath, 'utf8'));
  delete legacySnapshot.workUnitId;
  delete legacySnapshot.targetRoot;
  await fs.writeFile(legacyVersionPath, `${JSON.stringify(legacySnapshot, null, 2)}\n`);
  await fs.rm(path.join(existing, '.openprd', 'engagements', 'work-units'), { recursive: true, force: true });
  const legacyStatePath = path.join(existing, '.openprd', 'state', 'current.json');
  const legacyState = JSON.parse(await fs.readFile(legacyStatePath, 'utf8'));
  delete legacyState.activeWorkUnitId;
  delete legacyState.targetRoot;
  delete legacyState.reviewStatus.workUnitId;
  delete legacyState.reviewStatus.stableArtifact;
  await fs.writeFile(legacyStatePath, `${JSON.stringify(legacyState, null, 2)}\n`);
  await fs.appendFile(path.join(existing, '.codex', 'skills', 'openprd-harness', 'SKILL.md'), '\nmanual drift\n');
  await fs.writeFile(path.join(existing, '.openprd', 'templates', 'base', 'prd.md'), '# PRD\n\n## 1. Problem\n');
  await fs.writeFile(path.join(existing, '.openprd', 'engagements', 'active', 'intake.md'), '# Intake\n\n## Questions\n\n- What problem are we solving?\n');

  const dryRun = await fleetWorkspace(root, {
    updateOpenprd: true,
    dryRun: true,
    maxDepth: 2,
    openprdHome,
  });
  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.summary.openprd, 1);
  assert.equal(dryRun.summary.agentConfigured, 1);
  assert.equal(dryRun.projects.find((project) => project.relativePath === 'existing-openprd').plannedAction, 'update');
  assert.equal(dryRun.projects.find((project) => project.relativePath === 'agent-only').plannedAction, 'report');
  assert.equal(await fs.stat(path.join(agentOnly, '.openprd')).then(() => true).catch(() => false), false);

  const updated = await fleetWorkspace(root, {
    updateOpenprd: true,
    maxDepth: 2,
    openprdHome,
  });
  assert.equal(updated.summary.updated, 1);
  assert.equal(updated.summary.backfilled, 1);
  assert.equal(updated.summary.setup, 0);
  assert.equal(updated.projects.find((project) => project.relativePath === 'agent-only').status, 'skipped');
  assert.equal(await fs.stat(path.join(agentOnly, '.openprd')).then(() => true).catch(() => false), false);

  const doctor = await doctorWorkspace(existing);
  assert.equal(doctor.ok, true);
  assert.equal(doctor.agentIntegration.drift.ok, true);
  assert.ok((await fs.readFile(path.join(existing, '.openprd', 'templates', 'base', 'prd.md'), 'utf8')).includes('元信息'));
  assert.ok((await fs.readFile(path.join(existing, '.openprd', 'engagements', 'active', 'intake.md'), 'utf8')).includes('我们要解决什么问题？'));
  const backfilledSnapshot = JSON.parse(await fs.readFile(legacyVersionPath, 'utf8'));
  assert.match(backfilledSnapshot.workUnitId, /^wu-legacy-v0001-[a-f0-9]{8}$/);
  assert.equal(backfilledSnapshot.digest, synthesized.snapshot.digest);
  const backfilledHtml = await fs.readFile(path.join(existing, '.openprd', 'reviews', 'v0001.html'), 'utf8');
  assert.ok(backfilledHtml.includes(`--digest &#39;${synthesized.snapshot.digest}&#39;`));
  assert.ok(backfilledHtml.includes(`--work-unit &#39;${backfilledSnapshot.workUnitId}&#39;`));
  assert.equal(
    await fs.stat(path.join(existing, '.openprd', 'engagements', 'work-units', `${backfilledSnapshot.workUnitId}.json`)).then(() => true),
    true
  );

  const cliLogs = [];
  const originalLog = console.log;
  console.log = (...args) => cliLogs.push(args.join(' '));
  try {
    assert.equal(await main(['fleet', root, '--dry-run', '--update-openprd', '--max-depth', '2']), 0);
  } finally {
    console.log = originalLog;
  }
  assert.ok(cliLogs.some((line) => line.includes('OpenPrd fleet: 通过')));
});

test('fleet sync-registry backfills known workspaces and reports registry scope outside the current root', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-fleet-registry-test-'));
  const openprdHome = path.join(workspaceRoot, '.openprd-home');
  const scopedRoot = path.join(workspaceRoot, 'scoped');
  const otherRoot = path.join(workspaceRoot, 'other');
  const scopedProject = path.join(scopedRoot, 'existing-openprd');
  const otherProject = path.join(otherRoot, 'another-openprd');
  await fs.mkdir(scopedProject, { recursive: true });
  await fs.mkdir(otherProject, { recursive: true });

  await initWorkspace(scopedProject, { templatePack: 'agent', openprdHome });
  await initWorkspace(otherProject, { templatePack: 'agent', openprdHome });
  await fs.rm(path.join(openprdHome, 'registry'), { recursive: true, force: true });

  const synced = await fleetWorkspace(scopedRoot, {
    syncRegistry: true,
    maxDepth: 2,
    openprdHome,
  });
  assert.equal(synced.ok, true);
  assert.equal(synced.summary.synced, 1);
  assert.equal(synced.registry.knownTotal, 1);
  assert.equal(synced.registry.outsideRoot, 0);

  await updateAgentIntegrationWorkspace(otherProject, { openprdHome });

  const scopedDryRun = await fleetWorkspace(scopedRoot, {
    dryRun: true,
    updateOpenprd: true,
    maxDepth: 2,
    openprdHome,
  });
  assert.equal(scopedDryRun.registry.knownTotal, 2);
  assert.equal(scopedDryRun.registry.scopedKnown, 1);
  assert.equal(scopedDryRun.registry.outsideRoot, 1);
});

test('fleet update reports workspace health gaps without blocking generated guidance updates', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-fleet-health-test-'));
  const openprdHome = path.join(root, '.openprd-home');
  const existing = path.join(root, 'existing-openprd');
  await fs.mkdir(existing, { recursive: true });

  await initWorkspace(existing, { templatePack: 'agent', openprdHome });
  await fs.appendFile(path.join(existing, '.codex', 'skills', 'openprd-harness', 'SKILL.md'), '\nmanual drift\n');
  await fs.writeFile(path.join(existing, 'docs', 'basic', 'backend-structure.md'), '# Backend\n', 'utf8');

  const updated = await fleetWorkspace(root, {
    updateOpenprd: true,
    maxDepth: 1,
    openprdHome,
  });
  const project = updated.projects.find((item) => item.relativePath === 'existing-openprd');
  assert.equal(updated.ok, true);
  assert.equal(updated.summary.updated, 1);
  assert.equal(updated.summary.failed, 0);
  assert.equal(updated.summary.healthAttention, 1);
  assert.equal(updated.errors.length, 0);
  assert.equal(project.status, 'updated');
  assert.equal(project.ok, true);
  assert.equal(project.healthOk, false);
  assert.ok(project.healthErrors.some((error) => error.includes('docs/basic/backend-structure.md')));
  assert.ok((await fs.readFile(path.join(existing, '.codex', 'skills', 'openprd-harness', 'SKILL.md'), 'utf8')).includes('OPENPRD:GENERATED'));

  const cliLogs = [];
  const originalLog = console.log;
  console.log = (...args) => cliLogs.push(args.join(' '));
  try {
    assert.equal(await main(['fleet', root, '--update-openprd', '--max-depth', '1']), 0);
  } finally {
    console.log = originalLog;
  }
  assert.ok(cliLogs.some((line) => line.includes('OpenPrd fleet: 通过')));
  assert.ok(cliLogs.some((line) => line.includes('失败 0')));
  assert.ok(cliLogs.some((line) => line.includes('项目健康: 1 个需关注')));
  assert.ok(cliLogs.some((line) => line.includes('需关注: standards: docs/basic/backend-structure.md')));
});

test('fleet update preserves standards external reference paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-fleet-standards-config-test-'));
  const openprdHome = path.join(root, '.openprd-home');
  const existing = path.join(root, 'existing-openprd');
  await fs.mkdir(existing, { recursive: true });

  await initWorkspace(existing, { templatePack: 'agent', openprdHome });
  await fs.mkdir(path.join(existing, 'research', 'reference-repo'), { recursive: true });
  await fs.mkdir(path.join(existing, 'resources', 'toolkit-sources'), { recursive: true });

  const standardsConfigPath = path.join(existing, '.openprd', 'standards', 'config.json');
  const standardsConfig = JSON.parse(await fs.readFile(standardsConfigPath, 'utf8'));
  standardsConfig.externalReferences = {
    ...(standardsConfig.externalReferences ?? {}),
    paths: ['research', 'resources/toolkit-sources'],
  };
  await fs.writeFile(standardsConfigPath, `${JSON.stringify(standardsConfig, null, 2)}\n`);

  const updated = await fleetWorkspace(root, {
    updateOpenprd: true,
    maxDepth: 1,
    openprdHome,
  });
  assert.equal(updated.summary.updated, 1);

  const nextConfig = JSON.parse(await fs.readFile(standardsConfigPath, 'utf8'));
  assert.deepEqual(nextConfig.externalReferences?.paths, ['research', 'resources/toolkit-sources']);
});

test('freeze writes a snapshot and handoff exports openprd bundle', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'b2b' });
  await synthesizeWorkspace(project, {
    title: '企业客户交接',
    owner: 'PM',
    problemStatement: '销售团队在企业客户导入时容易丢失上下文',
    whyNow: '线索量正在增长',
    evidence: ['CRM 备注'],
    primaryUsers: ['销售运营'],
    stakeholders: ['销售团队', '客户成功团队'],
    goals: ['减少客户导入遗漏'],
    successMetrics: ['交接完成率超过 95%'],
    acceptanceGoals: ['团队可以检查每个导入字段'],
    inScope: ['企业客户导入检查清单'],
    outOfScope: ['账单迁移'],
    primaryFlows: ['销售运营检查客户导入信息'],
    edgeCases: ['必填字段缺失'],
    failureModes: ['CRM 导入失败'],
    functional: ['创建导入检查记录'],
    nonFunctional: ['p95 < 2s'],
    businessRules: ['只有客户负责人可以批准'],
    technical: ['复用当前 CRM 同步'],
    compliance: ['SOC2 审计日志'],
    dependencies: ['CRM API'],
    assumptions: ['CRM 客户已存在'],
    risks: ['负责人分配错误'],
    openQuestions: ['是否需要法务批准？'],
    handoffOwner: 'PM',
    nextStep: '冻结并交接',
    targetSystem: 'OpenPrd',
    productType: 'b2b',
    buyer: '销售负责人',
    user: '销售运营',
    admin: '系统管理员',
    operator: '客户成功运营',
    roles: '销售负责人、销售运营、客户成功运营、系统管理员',
    asIs: '销售运营手动检查 CRM 备注后转交客户成功',
    toBe: '系统生成检查清单并要求负责人确认后交接',
    permissionMatrix: '客户负责人可批准，运营可编辑，客户成功可查看',
    approvalFlow: '销售负责人确认后进入客户成功交接',
  });
  await diagramWorkspace(project, { open: false, type: 'architecture', mark: 'confirmed' });
  await reviewWorkspace(project, { mark: 'confirmed' });

  const freezeResult = await freezeWorkspace(project);
  assert.equal(freezeResult.ok, true);
  assert.equal(freezeResult.snapshot.prdVersion, 1);
  assert.ok(freezeResult.snapshot.digest.length > 0);

  const handoffResult = await handoffWorkspace(project, 'openprd');
  assert.equal(handoffResult.ok, true);
  assert.equal(handoffResult.handoff.versionId, 'v0001');
  assert.ok(handoffResult.handoff.digest.length > 0);

  const handoffJsonPath = path.join(project, '.openprd', 'exports', 'openprd', 'handoff.json');
  const handoffJson = JSON.parse(await fs.readFile(handoffJsonPath, 'utf8'));
  assert.equal(handoffJson.target, 'openprd');
  assert.equal(handoffJson.templatePack, 'b2b');
  assert.equal(handoffJson.versionId, 'v0001');
});

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
  assert.ok(passed.verification.checks.some((check) => check.includes('结构化 OpenPrd 任务: 2 个任务，1 条依赖。')));

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

test('openprd validates spec body language policy', async () => {
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

  const failed = await validateOpenSpecChangeWorkspace(project, { change: 'desktop-rebuild' });
  assert.equal(failed.ok, false);
  assert.ok(failed.errors.some((error) => error.includes('spec.md 正文必须使用简体中文')));

  await fs.writeFile(path.join(changeDir, 'specs', 'desktop-shell', 'spec.md'), [
    '## ADDED Requirements',
    '',
    '### Requirement: Harbor & Leaf 精品茶品牌单页网站',
    '为 Harbor & Leaf 制作可直接打开的精品茶品牌单页网站。',
    '',
    '#### Scenario: 用户浏览品牌页面',
    '- **WHEN** 用户打开 Harbor & Leaf 页面并浏览茶品内容',
    '- **THEN** 页面应完整展示品牌故事、茶品、活动和订阅反馈',
    '',
  ].join('\n'));

  const productNameSpec = await validateOpenSpecChangeWorkspace(project, { change: 'desktop-rebuild' });
  assert.equal(productNameSpec.ok, true);
  assert.equal(productNameSpec.valid, true);
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
  assert.match(specText, /^## 新增需求$/m);
  assert.match(specText, /^### 需求：/m);
  assert.match(specText, /^#### 场景：/m);
  assert.match(specText, /^- \*\*当\*\*/m);
  assert.match(specText, /^- \*\*则\*\*/m);
  assert.doesNotMatch(specText, /ADDED Requirements|Requirement:|Scenario:|\*\*WHEN\*\*|\*\*THEN\*\*/);

  const discoveryConfig = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'discovery', 'config.json'), 'utf8'));
  assert.equal(discoveryConfig.activeChange, 'signup-flow');

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
  assert.ok(generatedProposal.includes('## 背景与原因'));
  assert.ok(generatedProposal.includes('## 变更内容'));
  assert.ok(generatedProposal.includes('## 影响范围'));
  const generatedTasks = await fs.readFile(path.join(project, 'openprd', 'changes', 'profile-settings', 'tasks.md'), 'utf8');
  assert.ok(generatedTasks.includes('  - type: implementation'));
  assert.ok(generatedTasks.includes('  - type: documentation'));
  assert.ok(generatedTasks.includes('docs/basic'));
  assert.ok(generatedTasks.includes('缺失的已补齐，过期的已更新'));
  assert.ok(generatedTasks.includes('openprd standards . --verify'));
  assert.ok(generatedTasks.includes('openprd run . --verify'));
  assert.equal(/^(?:- \[ \] )?T\d{3}\.\d+\s+(实现主流程|实现需求|验证验收目标|验证非功能需求)\s*[:：]/m.test(generatedTasks), false);
  const taskState = await listOpenSpecTaskWorkspace(project, { change: 'profile-settings' });
  assert.ok(taskState.summary.implementation.total >= 2);
  assert.ok(taskState.tasks.some((task) => task.metadata.type === 'implementation' && task.metadata.verify === 'openprd run . --verify'));
  assert.equal(
    taskState.tasks.filter((task) => task.metadata.type !== 'governance' && /^openprd change \. --validate\b/i.test(task.metadata.verify ?? '')).length,
    0
  );
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
  await initWorkspace(project, { templatePack: 'consumer' });
  const changeDir = path.join(project, 'openprd', 'changes', 'loop-demo');
  await fs.mkdir(path.join(changeDir, 'specs', 'loop-demo'), { recursive: true });
  await fs.writeFile(path.join(changeDir, 'proposal.md'), [
    '# Proposal',
    '',
    '## Why',
    'Long-running agent work needs isolated task sessions.',
    '',
    '## What Changes',
    '- `loop-demo`: Add a loop-driven implementation path.',
    '',
    '## Impact',
    'Agent execution gains deterministic task boundaries.',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'specs', 'loop-demo', 'spec.md'), [
    '# loop-demo 规格',
    '',
    '## ADDED Requirements',
    '',
    '### Requirement: Loop 任务会话保持隔离',
    '每个实现任务都应在独立 Agent 会话中执行。',
    '',
    '#### Scenario: Agent 启动下一项任务',
    '- **WHEN** 选中一个 Loop 任务',
    '- **THEN** 提示词会把 Agent 限制在该单一任务内',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'tasks.md'), [
    '- [ ] T001.01 Prepare loop state',
    '  - done: loop state is ready',
    '  - verify: node -e "process.exit(0)"',
    '- [ ] T001.02 Launch one-task session',
    '  - deps: T001.01',
    '  - done: one-task session is launchable',
    '  - verify: node -e "process.exit(0)"',
    '',
  ].join('\n'));

  const init = await initLoopWorkspace(project, { agent: 'codex' });
  assert.equal(init.ok, true);
  assert.equal(init.featureList.policy.oneTaskPerSession, true);

  const planned = await planLoopWorkspace(project, { change: 'loop-demo' });
  assert.equal(planned.ok, true);
  assert.equal(planned.summary.total, 2);
  assert.equal(planned.next.id, 'T001.01');
  assert.equal(planned.next.taskHandle, 'loop-demo:T001.01:prepare-loop-state');

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

  const resynthesized = await synthesizeWorkspace(project, {
    productType: 'agent',
  });
  assert.equal(resynthesized.snapshot.reviewPresentation, null);

  const reviewHtml = await fs.readFile(resynthesized.reviewPath, 'utf8');
  assert.ok(reviewHtml.includes('执行 Hermes 保留数据卸载'));
  assert.ok(reviewHtml.includes('保留 ~/.hermes 数据并返回成功'));
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
  assert.ok(tasks.includes('验证成本与额度护栏'));
  assert.ok(tasks.includes('验证滥用与越权路径'));
  assert.ok(tasks.includes('验证成本监控、报警和止损'));
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
