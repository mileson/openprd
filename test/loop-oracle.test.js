import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  finishLoopWorkspace,
  initLoopWorkspace,
  initWorkspace,
  planLoopWorkspace,
  promptLoopWorkspace,
} from '../src/openprd.js';
import { parseOpenSpecTaskFile } from '../src/openspec/tasks.js';

async function makeTempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'openprd-loop-oracle-test-'));
}

async function writeLoopChangeFixture(projectRoot, changeId) {
  const changeDir = path.join(projectRoot, 'openprd', 'changes', changeId);
  await fs.mkdir(path.join(changeDir, 'specs', changeId), { recursive: true });
  await fs.writeFile(path.join(changeDir, 'proposal.md'), [
    '# 变更提案',
    '',
    '## 为什么',
    '需要一个带有对照基准的 loop 任务。',
    '',
    '## 变更内容',
    '- 增加一个需要对照 reference 的实现任务。',
    '',
    '## 影响范围',
    '- loop finish 需要显式记录对照结果。',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'specs', changeId, 'spec.md'), [
    `# ${changeId} 规格`,
    '',
    '## ADDED Requirements',
    '',
    '### Requirement: 带对照基准的任务必须保留比对证据',
    '当任务声明了对照基准时，系统必须保留本轮比对结果，避免跨会话重复踩坑。',
    '',
    '#### Scenario: Agent 完成带对照基准的任务',
    '- **WHEN** 当前任务依赖参考实现、基准数据或基线截图',
    '- **THEN** 收尾时需要显式记录本轮比对结果',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'tasks.md'), [
    '- [ ] T001.01 Match legacy preview output',
    '  - type: implementation',
    '  - done: preview matches the legacy counts and warning buckets',
    '  - verify: node -e "process.exit(0)"',
    '  - oracle: compare fixtures/golden-preview.json against the legacy preview and record any mismatch',
    '',
    '- [ ] T001.02 Document the follow-up',
    '  - type: documentation',
    '  - deps: T001.01',
    '  - done: follow-up docs capture the comparison result',
    '  - verify: node -e "process.exit(0)"',
    '',
  ].join('\n'));
  return changeDir;
}

test('parseOpenSpecTaskFile captures oracle metadata', () => {
  const parsed = parseOpenSpecTaskFile([
    '- [ ] T001.01 Match legacy preview output',
    '  - done: preview matches legacy output',
    '  - verify: node -e "process.exit(0)"',
    '  - oracle: compare fixtures/golden-preview.json against the legacy preview',
    '',
  ].join('\n'));

  assert.equal(parsed.structuredTasks.length, 1);
  assert.equal(
    parsed.structuredTasks[0].metadata.oracle,
    'compare fixtures/golden-preview.json against the legacy preview',
  );
});

test('loop prompt includes oracle guidance and initializes the failed approach ledger', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await writeLoopChangeFixture(project, 'oracle-demo');
  await initLoopWorkspace(project, { agent: 'codex' });
  await planLoopWorkspace(project, { change: 'oracle-demo' });

  const prompt = await promptLoopWorkspace(project, { agent: 'codex' });
  assert.equal(prompt.ok, true);
  assert.match(prompt.prompt, /对照基准: compare fixtures\/golden-preview\.json against the legacy preview and record any mismatch/);
  assert.match(prompt.prompt, /failed-approaches\.md/);
  assert.match(prompt.prompt, /--notes "<oracle\/result summary>"/);

  const failedLedger = await fs.readFile(path.join(project, '.openprd', 'harness', 'failed-approaches.md'), 'utf8');
  assert.match(failedLedger, /^# OpenPrd Failed Approaches/m);
});

test('loop finish blocks oracle-backed tasks without explicit comparison evidence', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  const changeDir = await writeLoopChangeFixture(project, 'oracle-demo');
  await initLoopWorkspace(project, { agent: 'codex' });
  await planLoopWorkspace(project, { change: 'oracle-demo' });

  const finish = await finishLoopWorkspace(project, { item: 'T001.01', commit: false });
  assert.equal(finish.ok, false);
  assert.match(finish.errors[0], /oracle\/reference 对照基准/);

  const tasksText = await fs.readFile(path.join(changeDir, 'tasks.md'), 'utf8');
  assert.match(tasksText, /- \[ \] T001\.01 Match legacy preview output/);

  const failedLedger = await fs.readFile(path.join(project, '.openprd', 'harness', 'failed-approaches.md'), 'utf8');
  assert.match(failedLedger, /T001\.01 Match legacy preview output/);
  assert.match(failedLedger, /阶段: finish-evidence/);
});

test('loop finish records oracle details in the staged test report once evidence is supplied', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await writeLoopChangeFixture(project, 'oracle-demo');
  await initLoopWorkspace(project, { agent: 'codex' });
  await planLoopWorkspace(project, { change: 'oracle-demo' });

  const finish = await finishLoopWorkspace(project, {
    item: 'T001.01',
    commit: false,
    notes: 'Compared against fixtures/golden-preview.json; max delta stayed below 0.1% and warning buckets matched.',
  });
  assert.equal(finish.ok, true);
  assert.equal(finish.next?.id, 'T001.02');

  const reportPath = path.join(project, finish.testReport);
  const report = await fs.readFile(reportPath, 'utf8');
  assert.match(report, /对照基准: compare fixtures\/golden-preview\.json against the legacy preview and record any mismatch/);
  assert.match(report, /max delta stayed below 0.1%/);

  const featureList = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'feature-list.json'), 'utf8'));
  assert.equal(featureList.tasks.find((task) => task.id === 'T001.01').oracle, 'compare fixtures/golden-preview.json against the legacy preview and record any mismatch');
  assert.equal(featureList.tasks.find((task) => task.id === 'T001.01').status, 'done');
});
