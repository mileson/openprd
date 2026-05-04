import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { advanceOpenSpecTaskWorkspace, applyOpenPrdChangeWorkspace, archiveOpenPrdChangeWorkspace, captureWorkspace, checkStandardsWorkspace, clarifyWorkspace, classifyWorkspace, diagramWorkspace, diffWorkspace, doctorWorkspace, finishLoopWorkspace, fleetWorkspace, freezeWorkspace, generateOpenSpecChangeWorkspace, handoffWorkspace, historyWorkspace, initLoopWorkspace, initWorkspace, interviewWorkspace, listAcceptedSpecsWorkspace, listOpenPrdChangesWorkspace, listOpenSpecTaskWorkspace, main, nextLoopWorkspace, nextWorkspace, openspecDiscoveryWorkspace, planLoopWorkspace, promptLoopWorkspace, runLoopWorkspace, runWorkspace, setupAgentIntegrationWorkspace, statusLoopWorkspace, synthesizeWorkspace, validateOpenSpecChangeWorkspace, validateWorkspace, verifyLoopWorkspace } from '../src/openprd.js';

async function makeTempProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-test-'));
  await fs.mkdir(path.join(dir, 'project'), { recursive: true });
  return path.join(dir, 'project');
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
  assert.ok(await fs.stat(path.join(project, 'docs', 'basic', 'file-structure.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.openprd', 'standards', 'file-manual-template.md')).then(() => true));
  assert.equal((await fs.readFile(path.join(project, '.codex', 'config.toml'), 'utf8')).includes('codex_hooks = true'), true);
  assert.equal((await fs.readFile(path.join(project, '.codex', 'hooks.json'), 'utf8')).includes('openprd-hook.mjs'), true);
  assert.ok(await fs.stat(path.join(project, '.openprd', 'harness', 'install-manifest.json')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.openprd', 'harness', 'hook-state.json')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.openprd', 'harness', 'events.jsonl')).then(() => true));
  assert.equal((await fs.readFile(path.join(project, '.codex', 'skills', 'openprd-harness', 'SKILL.md'), 'utf8')).startsWith('---\n'), true);
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
    assert.ok(hooks.PostToolUse.some((group) => group.hooks?.some((hook) => hook.command.includes('openprd-hook.mjs'))));
    assert.ok(hooks.SessionStart.some((group) => group.hooks?.some((hook) => hook.command.includes('openprd-hook.mjs'))));

    const config = await fs.readFile(path.join(project, '.codex', 'config.toml'), 'utf8');
    assert.ok(config.includes('[features]'));
    assert.ok(config.includes('codex_hooks = true'));
    assert.ok(config.includes('[[hooks.UserPromptSubmit]]'));
    assert.ok((await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8')).includes('codex_hooks = true'));
    const manifest = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'install-manifest.json'), 'utf8'));
    assert.ok(manifest.managedFiles.some((file) => file.path === '.codex/hooks/openprd-hook.mjs'));

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      assert.equal(await main(['doctor', project, '--tools', 'codex', '--json']), 0);
    } finally {
      console.log = originalLog;
    }
    assert.ok(JSON.parse(logs.join('\n')).ok);

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

    for (const eventName of ['SessionStart', 'UserPromptSubmit']) {
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
      assert.ok(eventPayload.hookSpecificOutput.additionalContext.includes('OpenPrd run context'));
    }
    const events = await fs.readFile(path.join(project, '.openprd', 'harness', 'events.jsonl'), 'utf8');
    assert.ok(events.includes('allowed-high-risk'));

    await fs.appendFile(path.join(project, '.codex', 'skills', 'openprd-harness', 'SKILL.md'), '\nmanual drift\n');
    const drifted = await doctorWorkspace(project, { tools: 'codex', enableUserCodexConfig: true, codexHome });
    assert.equal(drifted.ok, false);
    assert.ok(drifted.agentIntegration.drift.errors.some((error) => error.includes('checksum-drift')));
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.OPENPRD_CODEX_HOME;
    } else {
      process.env.OPENPRD_CODEX_HOME = previousCodexHome;
    }
  }
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
    functional: ['Expose next task'],
    productType: 'consumer',
  });
  await generateOpenSpecChangeWorkspace(project, { change: 'run-loop' });

  const context = await runWorkspace(project, { context: true });
  assert.equal(context.action, 'run-context');
  assert.equal(context.activeChange, 'run-loop');
  assert.equal(context.recommendation.type, 'task');
  assert.ok(context.recommendation.command.includes('openprd tasks . --change'));
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

  const verified = await runWorkspace(project, { verify: true });
  assert.equal(verified.ok, true);
  assert.ok(verified.checks.some((check) => check.name === 'change' && check.ok));

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['run', project, '--context']), 0);
  } finally {
    console.log = originalLog;
  }
  assert.ok(logs.some((line) => line.includes('OpenPrd run context')));
});

test('fleet dry-run plans historical updates without auto-claiming agent-only projects', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-fleet-test-'));
  const existing = path.join(root, 'existing-openprd');
  const agentOnly = path.join(root, 'agent-only');
  const plain = path.join(root, 'plain-project');
  await fs.mkdir(existing, { recursive: true });
  await fs.mkdir(path.join(agentOnly, '.codex'), { recursive: true });
  await fs.mkdir(plain, { recursive: true });
  await fs.writeFile(path.join(agentOnly, 'AGENTS.md'), '# Local Agent Notes\n');
  await fs.writeFile(path.join(plain, 'package.json'), '{"name":"plain-project"}\n');

  await initWorkspace(existing, { templatePack: 'agent' });
  await fs.appendFile(path.join(existing, '.codex', 'skills', 'openprd-harness', 'SKILL.md'), '\nmanual drift\n');
  await fs.writeFile(path.join(existing, '.openprd', 'templates', 'base', 'prd.md'), '# PRD\n\n## 1. Problem\n');
  await fs.writeFile(path.join(existing, '.openprd', 'engagements', 'active', 'intake.md'), '# Intake\n\n## Questions\n\n- What problem are we solving?\n');

  const dryRun = await fleetWorkspace(root, {
    updateOpenprd: true,
    dryRun: true,
    maxDepth: 2,
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
  });
  assert.equal(updated.summary.updated, 1);
  assert.equal(updated.summary.setup, 0);
  assert.equal(updated.projects.find((project) => project.relativePath === 'agent-only').status, 'skipped');
  assert.equal(await fs.stat(path.join(agentOnly, '.openprd')).then(() => true).catch(() => false), false);

  const doctor = await doctorWorkspace(existing);
  assert.equal(doctor.ok, true);
  assert.equal(doctor.agentIntegration.drift.ok, true);
  assert.ok((await fs.readFile(path.join(existing, '.openprd', 'templates', 'base', 'prd.md'), 'utf8')).includes('元信息'));
  assert.ok((await fs.readFile(path.join(existing, '.openprd', 'engagements', 'active', 'intake.md'), 'utf8')).includes('我们要解决什么问题？'));

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

test('freeze writes a snapshot and handoff exports openprd bundle', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'b2b' });

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
  assert.ok(context.includes('OpenPrd Discovery Context'));

  const discoveryReadme = await fs.readFile(path.join(project, '.openprd', 'discovery', 'README.md'), 'utf8');
  assert.ok(discoveryReadme.includes('continuous discovery state'));

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
      '- [ ] T001.01 Prepare database import contract',
      '  - verify: npm run test -- migration',
      '- [ ] T001.02 Port legacy database import preview',
      '  - deps: T001.99',
      '  - done: preview shows counts, conflicts, skipped items, warnings',
      '  - verify: npm run test -- migration',
      '',
    ].join('\n')
  );

  const failed = await openspecDiscoveryWorkspace(project, { verify: true });
  assert.equal(failed.ok, false);
  assert.equal(failed.verification.valid, false);
  assert.ok(failed.verification.errors.some((error) => error.includes('缺少 "done:"')));
  assert.ok(failed.verification.errors.some((error) => error.includes('依赖未知任务 T001.99')));
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
    '- [ ] T001.01 Implement desktop shell validation',
    '  - done: Behavior is covered by OpenPrd validation',
    '  - verify: openprd change . --validate --change desktop-rebuild',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'specs', 'desktop-shell', 'spec.md'), [
    '## ADDED Requirements',
    '',
    '### Requirement: Desktop shell SHALL validate through OpenPrd',
    'The shell validation SHALL not require a third-party OpenSpec CLI.',
    '',
    '#### Scenario: Agent checks the change',
    '- **WHEN** the agent runs OpenPrd validation',
    '- **THEN** the OpenPrd change SHALL be checked',
    '',
  ].join('\n'));

  const result = await validateOpenSpecChangeWorkspace(project, { change: 'desktop-rebuild' });
  assert.equal(result.ok, true);
  assert.equal(result.valid, true);
  assert.ok(result.checks.some((check) => check.includes('OpenPrd change desktop-rebuild')));

  await fs.writeFile(path.join(changeDir, 'specs', 'desktop-shell', 'spec.md'), [
    '## ADDED Requirements',
    '',
    '### Requirement: Desktop shell SHALL validate through OpenPrd',
    'The shell validation SHALL not require a third-party OpenSpec CLI.',
    '',
  ].join('\n'));

  const failed = await validateOpenSpecChangeWorkspace(project, { change: 'desktop-rebuild' });
  assert.equal(failed.ok, false);
  assert.ok(failed.errors.some((error) => error.includes('必须至少包含一个 scenario')));
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

  const result = await generateOpenSpecChangeWorkspace(project, { change: 'signup-flow' });
  assert.equal(result.ok, true);
  assert.equal(result.changeId, 'signup-flow');
  assert.ok(result.files.includes(path.join('openprd', 'changes', 'signup-flow', 'proposal.md')));
  assert.ok(result.files.some((file) => file.endsWith(path.join('specs', 'consumer-requirements', 'spec.md'))));
  assert.equal(result.validation.valid, true);

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
  assert.ok(generatedTasks.includes('docs/basic'));
  assert.ok(generatedTasks.includes('openprd standards . --verify'));
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
    '# loop-demo Spec',
    '',
    '## ADDED Requirements',
    '',
    '### Requirement: Loop task sessions SHALL be isolated',
    'Each implementation task SHALL run in its own agent session.',
    '',
    '#### Scenario: Agent starts the next task',
    '- **WHEN** a loop task is selected',
    '- **THEN** the prompt limits the agent to that single task',
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

  const status = await statusLoopWorkspace(project);
  assert.equal(status.next.id, 'T001.01');

  const next = await nextLoopWorkspace(project, { item: 'T001.02' });
  assert.equal(next.dependencyState.ready, false);
  assert.deepEqual(next.dependencyState.incomplete, ['T001.01']);

  const prompt = await promptLoopWorkspace(project, { agent: 'codex' });
  assert.equal(prompt.ok, true);
  assert.equal(prompt.task.id, 'T001.01');
  assert.match(prompt.prompt, /不要开始下一个任务/);
  assert.match(prompt.prompt, /Computer Use/);
  assert.match(prompt.prompt, /Playwright/);
  assert.match(prompt.invocation.display, /codex exec --full-auto/);
  assert.ok(await fs.stat(path.join(project, prompt.promptPath)).then(() => true));

  const dryRun = await runLoopWorkspace(project, { agent: 'claude', dryRun: true });
  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.dryRun, true);
  assert.match(dryRun.invocation.display, /claude --print/);

  const verify = await verifyLoopWorkspace(project, { item: 'T001.01' });
  assert.equal(verify.ok, true);

  const finish = await finishLoopWorkspace(project, { item: 'T001.01', commit: false });
  assert.equal(finish.ok, true);
  assert.equal(finish.summary.done, 1);
  assert.equal(finish.next.id, 'T001.02');
  assert.equal(finish.testReport, path.join('.openprd', 'harness', 'test-reports', 'T001.01.md'));
  assert.ok(await fs.stat(path.join(project, finish.testReport)).then(() => true));

  const featureList = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'feature-list.json'), 'utf8'));
  assert.equal(featureList.tasks.find((task) => task.id === 'T001.01').status, 'done');
  assert.equal(featureList.tasks.find((task) => task.id === 'T001.02').status, 'pending');

  const tasksText = await fs.readFile(path.join(changeDir, 'tasks.md'), 'utf8');
  assert.match(tasksText, /- \[x\] T001\.01 Prepare loop state/);

  const sessions = await fs.readFile(path.join(project, '.openprd', 'harness', 'agent-sessions.jsonl'), 'utf8');
  assert.match(sessions, /"action":"run-dry-run"/);
  assert.match(sessions, /"action":"finish"/);
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
    targetSystem: 'OpenPrd',
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
