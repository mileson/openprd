import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { buildReviewExportPayload } from '../src/html-artifacts.js';
import {
  captureWorkspace,
  clarifyWorkspace,
  diagramWorkspace,
  freezeWorkspace,
  generateOpenSpecChangeWorkspace,
  initWorkspace,
  nextWorkspace,
  reviewPresentationWorkspace,
  reviewWorkspace,
  runWorkspace,
  setupAgentIntegrationWorkspace,
  synthesizeWorkspace as synthesizeWorkspaceBase,
} from '../src/openprd.js';
import { readSessionRegistry } from '../src/session-registry.js';

process.env.OPENPRD_HOME = path.join(os.tmpdir(), 'openprd-test-home-requirement-gate');

async function makeTempProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-test-'));
  await fs.mkdir(path.join(dir, 'project'), { recursive: true });
  return path.join(dir, 'project');
}

async function pathExists(filePath) {
  return fs.stat(filePath).then(() => true, () => false);
}

function validReviewPresentation(seed = {}) {
  return {
    mapNodes: {
      problem: { title: '问题定义', text: '确认核心问题' },
      goal: { title: '目标', text: '确认目标结果' },
      scope: { title: '范围', text: '确认交付边界' },
      flow: { title: '流程', text: '确认主线步骤' },
      risk: { title: '风险', text: '确认风险问题' },
      ...(seed.mapNodes ?? {}),
    },
    flowNodes: seed.flowNodes ?? [
      { text: '确认入口' },
      { text: '执行主步骤' },
      { text: '校验结果' },
      { text: '处理批量场景' },
    ],
    panels: {
      flow: [{ summary: '主线确认', detail: '用户能看懂入口、步骤和结果。' }],
      function: [{ summary: '功能确认', detail: '必须交付项和约束保持清晰。' }],
      guardrail: [{ summary: '护栏确认', detail: '成本、滥用和止损边界可见。' }],
      risk: [{ summary: '风险确认', detail: '开放问题和失败路径保留。' }],
      ...(seed.panels ?? {}),
    },
  };
}

async function writeValidReviewPresentation(project, versionId, seed = {}) {
  const presentationPath = path.join(project, `review-presentation-${versionId}.json`);
  await fs.writeFile(presentationPath, JSON.stringify({
    reviewPresentation: validReviewPresentation(seed),
  }, null, 2));
  const result = await reviewPresentationWorkspace(project, {
    version: versionId,
    presentationPath,
    write: true,
  });
  assert.equal(result.ok, true, JSON.stringify(result.presentationFeedback, null, 2));
  return result;
}

async function synthesizeWorkspace(project, options = {}) {
  const result = await synthesizeWorkspaceBase(project, options);
  await writeValidReviewPresentation(project, result.snapshot.versionId, result.snapshot.reviewPresentation ?? {});
  return {
    ...result,
    reviewPresentationRequired: false,
  };
}

async function captureFreshRequirementState(
  project,
  value = '用户已经确认了本轮需求的核心信息。',
  options = {}
) {
  const productType = options.productType ?? 'agent';
  const typeSpecificCaptures = productType === 'consumer'
    ? [
        ['typeSpecific.fields.persona', '希望展示自己经历与内容的个人创作者。'],
        ['typeSpecific.fields.segment', '首次访问者与回访读者。'],
        ['typeSpecific.fields.journey', ['进入首页', '阅读内容', '决定联系']],
        ['typeSpecific.fields.activationMetric', '访客完成一次详情阅读或联系点击。'],
        ['typeSpecific.fields.retentionMetric', '访客会因为内容更新而再次访问。'],
      ]
    : productType === 'b2b'
      ? [
          ['typeSpecific.fields.buyer', '业务负责人'],
          ['typeSpecific.fields.user', '一线使用者'],
          ['typeSpecific.fields.admin', '系统管理员'],
          ['typeSpecific.fields.operator', '流程运营者'],
          ['typeSpecific.fields.roles', ['业务负责人', '使用者', '管理员']],
          ['typeSpecific.fields.asIs', '当前流程依赖人工串联。'],
          ['typeSpecific.fields.toBe', '未来流程由产品统一承接。'],
          ['typeSpecific.fields.permissionMatrix', '按角色控制查看与操作权限。'],
          ['typeSpecific.fields.approvalFlow', '关键节点需要负责人确认。'],
        ]
      : [
          ['typeSpecific.fields.humanAgentContract', '高风险决定由人确认，常规整理可由 Agent 自动完成。'],
          ['typeSpecific.fields.autonomyBoundary', 'Agent 可在已确认范围内整理需求，但不能越过人类确认边界直接扩范围。'],
          ['typeSpecific.fields.toolBoundary', '可使用当前工作区内已接入的工具与 OpenPrd 命令。'],
          ['typeSpecific.fields.stateModel', '保留 requirement lane、review 状态和任务状态。'],
          ['typeSpecific.fields.evalPlan', '通过需求评审、任务验证和最终收口检查判断是否达标。'],
        ];
  const captures = [
    ['meta.title', '已确认需求'],
    ['meta.owner', 'OpenPrd'],
    ['meta.version', '0.1.0'],
    ['meta.status', 'draft'],
    ['meta.productType', productType],
    ['problem.problemStatement', value],
    ['problem.whyNow', '当前要把已确认范围整理成可执行需求。'],
    ['problem.evidence', ['用户已经确认了本轮需求范围。']],
    ['users.primaryUsers', ['一线操作员']],
    ['users.stakeholders', ['需求发起人']],
    ['goals.goals', ['完成本轮确认目标']],
    ['goals.successMetrics', ['核心路径可走通']],
    ['goals.acceptanceGoals', ['主流程可验收']],
    ['scope.inScope', ['当前确认范围']],
    ['scope.outOfScope', ['外围扩展能力']],
    ['scenarios.primaryFlows', ['用户完成主流程']],
    ['scenarios.edgeCases', ['异常输入可提示']],
    ['scenarios.failureModes', ['关键步骤失败可回退']],
    ['requirements.functional', ['支持本轮核心流程']],
    ['requirements.nonFunctional', ['文案面向普通用户']],
    ['requirements.businessRules', ['只做本轮确认范围']],
    ['constraints.technical', ['沿用当前工作区技术边界']],
    ['constraints.compliance', ['不写入敏感信息']],
    ['constraints.dependencies', ['依赖当前工作区与本地验证']],
    ['businessGuardrails.costDrivers', ['主要成本来自当前工作区内的工具调用与执行时长。']],
    ['businessGuardrails.usageLimits', ['首版按已确认范围执行，不开放无限制批量能力。']],
    ['businessGuardrails.abusePrevention', ['关键动作保留确认边界，避免越权或重复触发。']],
    ['businessGuardrails.monitoringSignals', ['关注执行成功率、失败率和异常重试。']],
    ['businessGuardrails.alertThresholds', ['异常失败率连续升高时立即停下复核。']],
    ['businessGuardrails.stopLossActions', ['发现异常时暂停自动推进，回退到人工确认。']],
    ['risks.assumptions', ['用户接受当前确认方向']],
    ['risks.risks', ['后续细节可能仍需验证']],
    ['risks.openQuestions', ['更大范围扩展另行确认']],
    ['handoff.owner', 'OpenPrd'],
    ['handoff.nextStep', '继续生成这版需求稿'],
    ['handoff.targetSystem', '当前工作区'],
    ...typeSpecificCaptures,
  ];
  for (const [field, capturedValue] of captures) {
    await captureWorkspace(project, {
      field,
      value: capturedValue,
      source: 'user-confirmed',
    });
  }
}

function runCodexHook(project, eventName, payload) {
  const result = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), eventName], {
    cwd: project,
    input: JSON.stringify({ cwd: project, ...payload }),
    encoding: 'utf8',
    env: {
      ...process.env,
      OPENPRD_CLI: path.resolve('openprd/bin/openprd.js'),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function runCodexHookWithoutCwd(project, eventName, payload, workingDirectory) {
  const result = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), eventName], {
    cwd: workingDirectory,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      OPENPRD_CLI: path.resolve('openprd/bin/openprd.js'),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function makeCodexHookProject() {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  await initWorkspace(project, {
    templatePack: 'agent',
  });
  await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    templatePack: 'agent',
    enableUserCodexConfig: true,
    codexHome,
  });
  return { project, codexHome };
}

async function seedReadyFrontendDesignArtifacts(project) {
  const activeDir = path.join(project, '.openprd', 'design', 'active');
  await fs.writeFile(path.join(activeDir, 'facts-sheet.md'), '# Facts\n\n- 开放时间：10:00-17:00\n- 中文语音导览：7 GBP\n');
  await fs.writeFile(path.join(activeDir, 'asset-spec.md'), '# Assets\n\n- 品牌资产：暂无官方素材，先用文字与中性色块表达\n');
  await fs.writeFile(path.join(activeDir, 'image-preflight.md'), '# Image preflight\n\n- 真实图片：已准备一组可用参考图\n');
  await fs.writeFile(path.join(activeDir, 'direction-plan.md'), '# Directions\n\n1. 导览叙事\n2. 编辑感故事\n3. 高密度工具\n');
  await fs.writeFile(path.join(activeDir, 'selected-direction.md'), '# Selected\n\n- lens: editorial-contrast\n- theme: warm-editorial\n- layout: story-map\n');
}

async function seedDesignStarterEvent(project, output = 'index.html') {
  await fs.appendFile(
    path.join(project, '.openprd', 'state', 'events.jsonl'),
    `${JSON.stringify({
      type: 'design_starter_created',
      at: '2026-06-09 09:00:00',
      starterId: 'content-home',
      output,
    })}\n`,
  );
}

async function writeCodexTranscript(project, sessionId, assistantText) {
  const transcriptDir = path.join(project, '.openprd', 'test-transcripts');
  await fs.mkdir(transcriptDir, { recursive: true });
  const transcriptPath = path.join(transcriptDir, `${sessionId}.jsonl`);
  await fs.writeFile(transcriptPath, `${JSON.stringify({
    timestamp: '2026-06-09T01:00:00.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      phase: 'commentary',
      content: [{ type: 'output_text', text: assistantText }],
    },
  })}\n`);
  return transcriptPath;
}

async function seedProjectKnowledgeSkill(project, skillName = 'billing-trace-rollback') {
  const skillDir = path.join(project, '.openprd', 'knowledge', 'skills', skillName);
  const skillPath = path.join(skillDir, 'SKILL.md');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(skillPath, [
    '---',
    `name: ${skillName}`,
    'description: Use when the current task touches billing-api.js, traceId propagation, or webhook rollback and should reuse this verified project diagnosis path.',
    'use_when: Use when the current task touches billing-api.js, traceId propagation, or webhook rollback and should reuse this verified project diagnosis path.',
    '---',
    '',
    `# ${skillName}`,
    '',
    '## 触发条件',
    '- 修改 `src/billing-api.js`',
    '- 处理 traceId 透传',
    '- 修 webhook 回滚',
    '',
    '## 适用范围',
    '- 适用于支付链路里 traceId 透传、回滚修复和 webhook 对账排查。',
    '',
    '## 先看什么',
    '- `src/billing-api.js`',
    '- `docs/basic/backend-structure.md`',
    '',
    '## 不要直接套用',
    '- 如果当前任务只是同仓库里的别的支付逻辑改动，不要因为文件名相似就套用。',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(project, '.openprd', 'knowledge', 'index.json'), `${JSON.stringify({
    version: 2,
    updatedAt: '2026-06-05 15:10:00',
    incidents: [],
    patterns: [],
    skills: [
      {
        skillName,
        path: skillPath,
        sourceKind: 'manual',
        sourceRef: 'seeded-test-skill',
        touchedFiles: ['src/billing-api.js'],
        triggerHints: ['traceId 透传', 'webhook 回滚'],
      },
    ],
    candidates: [],
    drafts: [],
  }, null, 2)}\n`);
}

describe('Codex requirement gate', () => {
  test('synthesize blocks active requirement gate when no fresh capture or explicit PRD fields exist', async () => {
    const project = await makeTempProject();
    await initWorkspace(project, { templatePack: 'agent' });

    await synthesizeWorkspace(project, {
      title: '历史飞书需求',
      owner: 'OpenPrd',
      problemStatement: '用户需要看到飞书安装进度。',
      whyNow: '安装等待过程容易误判为卡死。',
      productType: 'agent',
    });
    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: true,
      status: 'prd-review-required',
      openedAt: '9999-01-01 00:00:00',
      updatedAt: '9999-01-01 00:00:00',
      promptPreview: 'AI跟生产线之间增加个空格',
      requiredFlow: ['clarify', 'capture', 'synthesize', 'review', 'change-generate', 'tasks', 'implementation'],
    }, null, 2));

    await assert.rejects(
      () => synthesizeWorkspace(project, {}),
      /current\.json 还没有记录本轮确认答案/
    );

    await captureFreshRequirementState(project, '用户已经确认 AI 生产线命名需要保留空格。');
    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: true,
      status: 'prd-review-required',
      openedAt: '2026-05-25 10:00:00',
      updatedAt: '2026-05-25 10:00:00',
      promptPreview: 'AI跟生产线之间增加个空格',
      requiredFlow: ['clarify', 'capture', 'synthesize', 'review', 'change-generate', 'tasks', 'implementation'],
    }, null, 2));

    const explicit = await synthesizeWorkspace(project, {
      title: 'AI 生产线命名空格调整',
      owner: 'OpenPrd',
      problemStatement: 'AI 生产线入口命名需要保留空格。',
      whyNow: '用户已经确认要调整中文入口命名。',
      productType: 'agent',
    });
    assert.equal(explicit.snapshot.title, 'AI 生产线命名空格调整');
    assert.equal(explicit.snapshot.versionId, 'v0002');
  });

  test('Codex hook keeps non-requirement prompts outside the requirement gate', async () => {
    const { project } = await makeCodexHookProject();

    const plainPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '把这个按钮文案改短一点',
    });
    assert.equal(plainPromptPayload.continue, true);
    assert.ok(plainPromptPayload.hookSpecificOutput.additionalContext.includes('产品内文案提醒'));
    assert.ok(plainPromptPayload.hookSpecificOutput.additionalContext.includes('Localizable'));

    const simpleUiPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '把设置页面的保存按钮从圆角改成方角，并从右上角移动到右下角。',
    });
    assert.deepEqual(simpleUiPromptPayload, { continue: true });
    assert.equal(await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gate.json')), false);

    const tinySpacingPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '到最后我只让它加一个空格，把 AI跟生产线 改成 AI 跟生产线。',
    });
    assert.deepEqual(tinySpacingPromptPayload, { continue: true });
    assert.equal(await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gate.json')), false);

    const imageGenerationPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '帮我生成一张活动封面图，先给我看图片效果。',
    });
    assert.equal(imageGenerationPayload.continue, true);
    assert.ok(imageGenerationPayload.hookSpecificOutput.additionalContext.includes('当前用户要的是图片内容生成'));
    assert.ok(imageGenerationPayload.hookSpecificOutput.additionalContext.includes('Codex 原生 Image 2'));
    assert.ok(imageGenerationPayload.hookSpecificOutput.additionalContext.includes('imagegen'));
    assert.ok(imageGenerationPayload.hookSpecificOutput.additionalContext.includes('独立素材输出（standalone asset）'));
    assert.ok(imageGenerationPayload.hookSpecificOutput.additionalContext.includes('候选效果图'));
    assert.ok(imageGenerationPayload.hookSpecificOutput.additionalContext.includes('是否符合预期'));
    assert.ok(imageGenerationPayload.hookSpecificOutput.additionalContext.includes('后续效果图/实现截图对比'));
    assert.equal(await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gate.json')), false);
    const imageStopReminder = runCodexHook(project, 'Stop', {});
    assert.equal(imageStopReminder.continue, true);
    assert.ok(imageStopReminder.hookSpecificOutput.additionalContext.includes('候选效果图'));
    assert.ok(imageStopReminder.hookSpecificOutput.additionalContext.includes('是否按此继续后续实现'));

    const largeUiDirectionPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '这个设置页面界面改动比较大，先用 Computer Use 截产品内页面，再给我三种设计方向效果图确认。',
    });
    assert.equal(largeUiDirectionPayload.continue, true);
    assert.ok(largeUiDirectionPayload.hookSpecificOutput.additionalContext.includes('大界面改动视觉方案评审'));
    assert.ok(largeUiDirectionPayload.hookSpecificOutput.additionalContext.includes('Codex Computer Use'));
    assert.ok(largeUiDirectionPayload.hookSpecificOutput.additionalContext.includes('Codex 原生 Image 2'));
    assert.ok(largeUiDirectionPayload.hookSpecificOutput.additionalContext.includes('1/2/3'));
    assert.ok(largeUiDirectionPayload.hookSpecificOutput.additionalContext.includes('.openprd/harness/visual-reviews/'));
    assert.ok(largeUiDirectionPayload.hookSpecificOutput.additionalContext.includes('候选效果图'));
    assert.ok(largeUiDirectionPayload.hookSpecificOutput.additionalContext.includes('多对象参考处理'));

    const visualMismatchPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '这个实现跟效果图不一致，看着有点好丑，你按效果图继续复刻一下。',
    });
    assert.equal(visualMismatchPayload.continue, true);
    assert.ok(visualMismatchPayload.hookSpecificOutput.additionalContext.includes('至少先产出一份'));
    assert.ok(visualMismatchPayload.hookSpecificOutput.additionalContext.includes('focus-board'));

    const readOnlyProductPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '帮我看看这个 Agent 编排实现逻辑是不是漏了 Windows 用户场景，先分析一下。',
    });
    assert.equal(readOnlyProductPromptPayload.continue, true);
    assert.equal(await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gate.json')), false);

    const consultativeFeedbackPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '用户反馈 OpenPrd 这个 hook 在现有功能优化上有点过度，你看什么原因，先分析一下。',
    });
    assert.equal(consultativeFeedbackPromptPayload.continue, true);
    assert.equal(await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gate.json')), false);

    const directBugfixPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: 'Windows用户反馈，他在更新新版本的时候，出现如图的一个报错，请你排查一下什么原因，并如果能定位到原因，直接帮我修复',
    });
    assert.equal(directBugfixPromptPayload.continue, true);
    assert.ok(directBugfixPromptPayload.hookSpecificOutput.additionalContext.includes('直接处理 (L0)'));
    assert.ok(directBugfixPromptPayload.hookSpecificOutput.additionalContext.includes('需求类型 / 理由 / 推荐下一步'));
    assert.ok(directBugfixPromptPayload.hookSpecificOutput.additionalContext.includes('需求类型：直接处理（L0）'));
    assert.ok(directBugfixPromptPayload.hookSpecificOutput.additionalContext.includes('不打开正式 PRD/review/change/tasks'));
    assert.equal(await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gate.json')), false);

    const l1PromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '把设置页的信息架构和默认筛选顺序优化一下，保持现有功能边界，直接改。',
    });
    assert.equal(l1PromptPayload.continue, true);
    assert.ok(l1PromptPayload.hookSpecificOutput.additionalContext.includes('现有功能优化 (L1)'));
    assert.ok(l1PromptPayload.hookSpecificOutput.additionalContext.includes('需求类型 / 理由 / 推荐下一步'));
    assert.ok(l1PromptPayload.hookSpecificOutput.additionalContext.includes('需求类型：现有功能优化（L1）'));
    assert.ok(l1PromptPayload.hookSpecificOutput.additionalContext.includes('3-5 行 mini-plan'));
    assert.ok(l1PromptPayload.hookSpecificOutput.additionalContext.includes('默认不要打开正式 PRD/review/change/tasks'));
    assert.equal(await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gate.json')), false);

    const riskyBugfixPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请直接修复支付回调和订单状态同步失败的问题，涉及登录态、订单回调和退款分支。',
    });
    assert.equal(riskyBugfixPromptPayload.continue, true);
    assert.ok(riskyBugfixPromptPayload.hookSpecificOutput.additionalContext.includes('requirement intake gate'));
    const riskyBugfixGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
    assert.equal(riskyBugfixGate.active, true);
    assert.equal(riskyBugfixGate.status, 'requires-clarification');

    await fs.rm(path.join(project, '.openprd', 'harness', 'requirement-gate.json'));

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: true,
      status: 'requires-clarification',
      promptPreview: '帮我看看这个 Agent 编排实现逻辑是不是漏了 Windows 用户场景，先分析一下。',
      intent: {
        requiresIntake: false,
        explicitExecution: false,
        confirmation: false,
        readOnly: true,
        simpleConcrete: false,
        shouldInject: true,
      },
    }, null, 2));
    const staleReadOnlyPatchPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// small follow-up edit\n*** End Patch',
    });
    assert.equal(staleReadOnlyPatchPayload.decision, undefined);
    assert.equal(staleReadOnlyPatchPayload.continue, true);
  });

  test('Codex hook blocks semantic requirement writes before summary confirmation and allows them after confirmation', async () => {
    const { project } = await makeCodexHookProject();

    const requirementPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请直接实现：新增 Agent 团队模板导入流。',
    });
    assert.equal(requirementPromptPayload.continue, true);

    const requirementGatePath = path.join(project, '.openprd', 'harness', 'requirement-gate.json');
    let requirementGate = JSON.parse(await fs.readFile(requirementGatePath, 'utf8'));
    assert.equal(requirementGate.approvalPolicy.reviewPolicy, 'required');

    const blockedCapturePayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'Bash',
      tool_input: { cmd: 'openprd capture . --field problem.problemStatement --value "默认假设" --source agent-inferred' },
    });
    assert.equal(blockedCapturePayload.decision, 'block');
    assert.ok(blockedCapturePayload.reason.includes('Do not write requirement facts'));

    const allowedNormalizedCapturePayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'Bash',
      tool_input: { cmd: 'openprd capture . --field reviewPresentation --value "{}" --source agent-normalized' },
    });
    assert.equal(allowedNormalizedCapturePayload.decision, undefined);
    assert.equal(allowedNormalizedCapturePayload.continue, true);

    const blockedSynthesizePayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'Bash',
      tool_input: { cmd: 'openprd synthesize .' },
    });
    assert.equal(blockedSynthesizePayload.decision, 'block');
    assert.ok(blockedSynthesizePayload.reason.includes('需求判断 / 需求理解 / 功能范围 / 技术方案'));
    assert.ok(blockedSynthesizePayload.reason.includes('第一批最容易触达的社区或种子用户'));

    const clarificationConfirmPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '确认',
    });
    assert.equal(clarificationConfirmPayload.continue, true);

    requirementGate = JSON.parse(await fs.readFile(requirementGatePath, 'utf8'));
    assert.equal(requirementGate.status, 'clarification-confirmed');
    assert.ok(requirementGate.clarificationConfirmedAt);

    const allowedCapturePayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'Bash',
      tool_input: { cmd: 'openprd capture . --field problem.problemStatement --value "用户确认的目标" --source user-confirmed' },
    });
    assert.equal(allowedCapturePayload.decision, undefined);
    assert.equal(allowedCapturePayload.continue, true);
    await captureFreshRequirementState(project, '用户已经确认 Agent 团队模板导入流的核心范围。');

    const allowedSynthesizePayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'Bash',
      tool_input: { cmd: 'openprd synthesize .' },
    });
    assert.equal(allowedSynthesizePayload.decision, undefined);
    assert.equal(allowedSynthesizePayload.continue, true);
  });

  test('Codex hook treats short clarification follow-ups as confirmation', async () => {
    const { project } = await makeCodexHookProject();

    const requirementPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请直接实现：在【Agent管理】模块下，我希望增加一个【团队搭建】放到【Agent 工区】菜单下面，这个模块主要是将 Agent市场、技能库和 CLI库按流程串联起来，一站式完成配置。',
    });
    assert.equal(requirementPromptPayload.continue, true);

    const defaultChoicePayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '就按这个先走',
    });
    assert.equal(defaultChoicePayload.continue, true);

    const requirementGatePath = path.join(project, '.openprd', 'harness', 'requirement-gate.json');
    const requirementGate = JSON.parse(await fs.readFile(requirementGatePath, 'utf8'));
    assert.equal(requirementGate.status, 'clarification-confirmed');
  });

  test('synthesize blocks clarification-confirmed lanes until required facts are rewritten as user-confirmed', async () => {
    const project = await makeTempProject();
    await initWorkspace(project, { templatePack: 'consumer' });

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: true,
      status: 'clarification-confirmed',
      openedAt: '2026-06-07 00:00:00',
      updatedAt: '2026-06-07 00:00:00',
      clarificationConfirmedAt: '2026-06-07 00:00:00',
      promptPreview: '请帮我实现一个个人博客网站',
      requiredFlow: ['clarify', 'capture', 'synthesize', 'review', 'change-generate', 'tasks', 'implementation'],
    }, null, 2));

    await captureWorkspace(project, {
      field: 'problem.whyNow',
      value: '先用推断事实补一版。',
      source: 'agent-inferred',
    });

    await assert.rejects(
      () => synthesizeWorkspace(project, {
        title: '个人博客网站第一版',
        owner: 'OpenPrd',
        problemStatement: '从零实现一个个人博客网站。',
        whyNow: '用户已经确认先做第一版博客站。',
        primaryUsers: ['博客访问者'],
        goals: ['展示个人内容与文章'],
        successMetrics: ['访问者可打开首页并进入文章详情'],
        acceptanceGoals: ['首页和文章详情可访问'],
        inScope: ['首页与文章详情'],
        outOfScope: ['评论系统'],
        primaryFlows: ['访问首页并打开文章详情'],
        functional: ['展示个人介绍与文章内容'],
        productType: 'consumer',
      }),
      /当前需求摘要虽已确认|canonical|user-confirmed/
    );

    await captureWorkspace(project, {
      field: 'problem.problemStatement',
      value: '从零实现一个个人博客网站。',
      source: 'user-confirmed',
    });
    await captureWorkspace(project, {
      field: 'problem.whyNow',
      value: '用户已经确认先做第一版博客站。',
      source: 'user-confirmed',
    });
    await captureFreshRequirementState(project, '从零实现一个个人博客网站。', { productType: 'consumer' });

    const synthesized = await synthesizeWorkspace(project, {
      title: '个人博客网站第一版',
      owner: 'OpenPrd',
      problemStatement: '从零实现一个个人博客网站。',
      whyNow: '用户已经确认先做第一版博客站。',
      primaryUsers: ['博客访问者'],
      goals: ['展示个人内容与文章'],
      successMetrics: ['访问者可打开首页并进入文章详情'],
      acceptanceGoals: ['首页和文章详情可访问'],
      inScope: ['首页与文章详情'],
      outOfScope: ['评论系统'],
      primaryFlows: ['访问首页并打开文章详情'],
      functional: ['展示个人介绍与文章内容'],
      productType: 'consumer',
    });
    assert.equal(synthesized.snapshot.versionId, 'v0001');
  });

  test('synthesize blocks clarification-confirmed lanes when the requirement lane still recommends classify or interview', async () => {
    const project = await makeTempProject();
    await initWorkspace(project, { templatePack: 'consumer' });

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: true,
      status: 'clarification-confirmed',
      openedAt: '2026-06-07 00:00:00',
      updatedAt: '2026-06-07 00:00:00',
      clarificationConfirmedAt: '2026-06-07 00:00:00',
      promptPreview: '请帮我实现一个个人博客网站',
      requiredFlow: ['clarify', 'capture', 'synthesize', 'review', 'change-generate', 'tasks', 'implementation'],
    }, null, 2));

    await captureWorkspace(project, {
      field: 'problem.problemStatement',
      value: '需要从空白工作区实现一个个人博客网站。',
      source: 'user-confirmed',
    });
    await captureWorkspace(project, {
      field: 'problem.whyNow',
      value: '用户已经确认先做第一版博客站。',
      source: 'user-confirmed',
    });

    await assert.rejects(
      () => synthesizeWorkspace(project, {
        title: '个人博客网站第一版',
        owner: 'OpenPrd',
        problemStatement: '从零实现一个个人博客网站。',
        whyNow: '用户已经确认先做第一版博客站。',
        primaryUsers: ['博客访问者'],
        goals: ['展示个人内容与文章'],
        successMetrics: ['访问者可打开首页并进入文章详情'],
        acceptanceGoals: ['首页和文章详情可访问'],
        inScope: ['首页与文章详情'],
        outOfScope: ['评论系统'],
        primaryFlows: ['访问首页并打开文章详情'],
        functional: ['展示个人介绍与文章内容'],
        productType: 'consumer',
      }),
      /还没有离开需求补齐阶段|建议先执行: openprd (clarify|classify|interview)/
    );
  });

  test('Codex hook injects matched project knowledge skills and records adoption', async () => {
    const { project } = await makeCodexHookProject();
    await seedProjectKnowledgeSkill(project);

    const payload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请继续处理 src/billing-api.js 里的 traceId 透传和 webhook 回滚，直接修。',
    });
    const context = payload.hookSpecificOutput.additionalContext;
    assert.ok(context.includes('项目级经验候选: 找到 1 条'));
    assert.ok(context.includes('先做项目经验检查'));
    assert.ok(context.includes('billing-trace-rollback'));
    assert.ok(context.includes('traceId 透传'));

    const knowledgeIndex = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'knowledge', 'index.json'), 'utf8'));
    assert.equal(knowledgeIndex.skills[0].adoption.hitCount, 1);
    assert.equal(knowledgeIndex.skills[0].adoption.referencedCount, 1);
    assert.equal(knowledgeIndex.skills[0].adoption.injectedCount, 1);
  });

  test('Codex hook keeps bare session-ID diagnostics on the lightweight read-only path', async () => {
    const { project } = await makeCodexHookProject();
    const diagnosticPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: [
        '看下这个 codex 对话记录：019e9b0e-00dc-7ca2-b673-157af1082f5c',
        'openprd 能不能将“需求类型：直接处理”显示为“需求类型：直接处理（L0）”，这样就不需要占用额外的“内部路由码”这一行，因为对用户来说好像意义不大',
        '',
        '【原文内容】',
        '需求类型：直接处理',
        '内部路由码：L0',
        '理由：已经有本机日志把问题收窄到“启动动作落到了 global Hermes，而不是 agent-45031fde profile”，现在继续只读追踪这条调用链最合适。',
        '推荐下一步：我先从 framework.hermes.start 和 framework.hermes.restart 的派发入口往下读，确认桌面在什么条件下会把 profile 级动作降成 global。',
      ].join('\n'),
    });
    assert.equal(diagnosticPromptPayload.continue, true);
    assert.equal(await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gate.json')), false);
    assert.equal(diagnosticPromptPayload.hookSpecificOutput.additionalContext.includes('下一步类型: session-continuation'), false);
    assert.equal(diagnosticPromptPayload.hookSpecificOutput.additionalContext.includes('当前处理路径: 继续已有任务'), false);
  });

  test('Codex hook injects continuation lane context for historical session ID prompts', async () => {
    const { project } = await makeCodexHookProject();
    const continuationPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '继续执行这个记录：019e5ac7-088b-7ff2-86d1-4c026ff68105',
    });
    assert.equal(continuationPromptPayload.continue, true);
    assert.ok(continuationPromptPayload.hookSpecificOutput.additionalContext.includes('当前处理路径: 继续已有任务'));
    assert.equal(continuationPromptPayload.hookSpecificOutput.additionalContext.includes('下一步类型: session-continuation'), false);
    assert.ok(continuationPromptPayload.hookSpecificOutput.additionalContext.includes('会话 ID'));
  });

  test('Codex hook keeps review confirmation separate and auto-releases explicit execution after tasks are ready', async () => {
    const { project } = await makeCodexHookProject();

    const requirementPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请直接实现：在【Agent管理】模块下，我希望增加一个【团队搭建】放到【Agent 工区】菜单下面，这个模块主要是将 Agent市场、技能库和 CLI库按流程串联起来，一站式完成配置。',
    });
    assert.equal(requirementPromptPayload.continue, true);
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('requirement intake gate'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('$openprd-requirement-intake'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('面向个人消费者场景'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('面向企业服务场景'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('以 Agent 为主要使用场景'));
    assert.equal(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('base/consumer/b2b/agent'), false);
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('不要直接把 consumer / b2b / agent 当展示词'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('openprd clarify .'));
    assert.equal(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('openprd clarify . --open'), false);
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('需求类型判断'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('直接处理=L0'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('现有功能优化=L1'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('新功能/新流程方案=L2'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('需求判断 / 需求理解 / 功能范围 / 技术方案'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('第一批最容易触达的社区或种子用户'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('当前替代方案'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('先怎么手工交付'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('什么承诺才算真需求'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('验证阶段怎样先活下来'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('轻量主句'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('固定模板'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('Markdown tables'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('final answer'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('approval policy'));
    assert.ok(
      requirementPromptPayload.hookSpecificOutput.additionalContext.includes('Do not open clarification HTML')
        || requirementPromptPayload.hookSpecificOutput.additionalContext.includes('Do not open a clarification HTML page')
    );
    assert.equal(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('choose inline vs artifact'), false);
    assert.equal(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('clarifyPresentation.mode is artifact'), false);
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('openprd visual-compare'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('已确认，我按这个继续'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('确认，我们就按这个'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('先整理需求摘要给你确认'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('你回我一句我就开始实现'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('openprd learn .'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('学习包骨架'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('focus-board.json'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('组合到同一张证据板里统一验收'));
    const requirementGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
    assert.equal(requirementGate.active, true);
    assert.equal(requirementGate.status, 'requires-clarification');
    assert.equal(requirementGate.intakeMode, 'deep-reflection');
    assert.equal(requirementGate.approvalPolicy.reviewPolicy, 'required');

    const blockedPatchPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// premature implementation\n*** End Patch',
    });
    assert.equal(blockedPatchPayload.decision, 'block');
    assert.ok(
      blockedPatchPayload.reason.includes('requirement gate is still active')
        || blockedPatchPayload.reason.includes('OpenPrd blocked a mutating action')
    );

    const confirmedPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '确认修复',
    });
    assert.ok(confirmedPromptPayload.hookSpecificOutput.additionalContext.includes('需求确认稿'));
    assert.ok(confirmedPromptPayload.hookSpecificOutput.additionalContext.includes('final answer'));
    assert.ok(confirmedPromptPayload.hookSpecificOutput.additionalContext.includes('approval policy'));
    const confirmedGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
    assert.equal(confirmedGate.active, true);
    assert.equal(confirmedGate.status, 'clarification-confirmed');

    const stillBlockedPatchPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// still premature implementation\n*** End Patch',
    });
    assert.equal(stillBlockedPatchPayload.decision, 'block');

    await captureFreshRequirementState(project, '用户已经确认 Team Builder 的需求范围。');
    const synthesizedTeamBuilder = await synthesizeWorkspace(project, {
      title: 'Team Builder',
      owner: 'PM',
      problemStatement: 'Agents need a guided team setup flow',
      whyNow: 'Configuration spans several libraries',
      primaryUsers: ['Agent operators'],
      goals: ['Guide team setup'],
      successMetrics: ['Setup succeeds'],
      acceptanceGoals: ['Operators can complete team setup'],
      inScope: ['Agent workspace team setup'],
      outOfScope: ['Billing'],
      primaryFlows: ['Operator configures a team'],
      functional: ['Create the team setup flow'],
      productType: 'agent',
    });

    const reviewCommand = `openprd review . --mark confirmed --version ${synthesizedTeamBuilder.snapshot.versionId} --digest ${synthesizedTeamBuilder.snapshot.digest} --work-unit ${synthesizedTeamBuilder.workUnitId}`;
    const unauthorizedReviewConfirmPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'Bash',
      tool_input: { cmd: reviewCommand },
    });
    assert.equal(unauthorizedReviewConfirmPayload.decision, 'block');
    assert.ok(unauthorizedReviewConfirmPayload.reason.includes('did not explicitly confirm this exact PRD review artifact'));

    const explicitReviewApprovalPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: reviewCommand,
    });
    assert.ok(explicitReviewApprovalPayload.hookSpecificOutput.additionalContext.includes('只允许记录这次确认结果'));
    const authorizedReviewGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
    assert.equal(authorizedReviewGate.active, true);
    assert.equal(authorizedReviewGate.status, 'review-confirmation-authorized');

    const authorizedReviewConfirmPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'Bash',
      tool_input: { cmd: reviewCommand },
    });
    assert.equal(authorizedReviewConfirmPayload.decision, undefined);
    assert.equal(authorizedReviewConfirmPayload.continue, true);

    await reviewWorkspace(project, { mark: 'confirmed' });
    await generateOpenSpecChangeWorkspace(project, { change: 'team-builder' });

    const loopRunPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: [
        '# OpenPrd 长程单任务执行会话',
        'Agent: codex',
        '模式: loop-run',
        `项目: ${project}`,
        '变更: team-builder',
        '任务: T001.01 实现团队搭建页面流程',
        '',
        '## Harness 契约',
        '你正在运行一个隔离的 OpenPrd loop 单任务会话。',
      ].join('\n'),
    });
    assert.equal(loopRunPromptPayload.continue, true);
    assert.equal(loopRunPromptPayload.hookSpecificOutput.additionalContext.includes('requirement intake gate: opened'), false);
    const loopRunEvents = await fs.readFile(path.join(project, '.openprd', 'harness', 'events.jsonl'), 'utf8');
    assert.equal(loopRunEvents.split('\n').some((line) => line.includes('模式: loop-run') && line.includes('requirement-gate-opened')), false);

    const gateBeforeImplementation = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
    assert.equal(gateBeforeImplementation.active, false);
    assert.equal(gateBeforeImplementation.status, 'execution-authorized');

    const allowedPatchPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// confirmed implementation\n*** End Patch',
    });
    assert.equal(allowedPatchPayload.decision, undefined);
    assert.equal(allowedPatchPayload.continue, true);
    const executionAuthorizedGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
    assert.equal(executionAuthorizedGate.active, false);
    assert.equal(executionAuthorizedGate.status, 'execution-authorized');
  });

  test('run context keeps cold-start implementation prompts in clarify-summary mode', async () => {
    const { project } = await makeCodexHookProject();

    const result = spawnSync(process.execPath, [
      path.resolve('bin/openprd.js'),
      'run',
      project,
      '--context',
      '--message',
      '请帮我实现一个个人博客网站',
    ], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /建议下一步: (继续本轮需求入口澄清|clarify-user)/);
    assert.match(result.stdout, /当前回复目标: 先在对话里输出 requirement 摘要或只追问 1 个最高价值澄清点/);
    assert.match(result.stdout, /不要承诺“按默认方案直接实现”/);
    assert.match(result.stdout, /不要把“请帮我实现\/继续实现”当成跳过 requirement 摘要确认的依据/);

  });

  test('run context can reuse the current turn prompt for lightweight frontend implementation guidance', async () => {
    const { project } = await makeCodexHookProject();

    const hookPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请直接实现一个静态单页原型：大英博物馆中文导览 App 首页，包含今日推荐、楼层浏览、路线规划、门票与到访准备。不需要先来回确认，直接完成。',
    });
    assert.equal(hookPayload.continue, true);

    const result = spawnSync(process.execPath, [
      path.resolve('bin/openprd.js'),
      'run',
      project,
      '--context',
    ], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /建议下一步: (按轻量原型路径继续实现|先给 mini-plan 再继续实现)/);
    assert.match(result.stdout, /当前回复目标: 先用 3-5 行 mini-plan 收一下目标、范围内、范围外和验证方式/);
    assert.match(result.stdout, /\.openprd\/design\/active\//);
    assert.match(result.stdout, /\.openprd\/design\/templates\//);
    assert.match(result.stdout, /openprd design-starter/);
    assert.match(result.stdout, /openprd run \. --context --message <用户原话>/);
    assert.match(result.stdout, /--brief/);
    assert.match(result.stdout, /--sections/);
    assert.match(result.stdout, /只有确认这个页面本来就不依赖外部事实、品牌素材或真实图片时，才在 active design artifacts 写清无依赖/);
    assert.match(result.stdout, /先不要急着加 `--no-real-images`/);
    assert.match(result.stdout, /先把它当主参考源/);
    assert.match(result.stdout, /Patch Mode/);
    assert.match(result.stdout, /下一步必须出现真实写文件动作/);
    assert.match(result.stdout, /index\.next\.html/);
    assert.match(result.stdout, /不要删除 `index.html` 后重起/);
    assert.match(result.stdout, /主要占位已清掉/);
    assert.doesNotMatch(result.stdout, /建议下一步: (继续本轮需求入口澄清|clarify-user)/);
  });

  test('run context routes explicit 梳理诉求 into brainstorm mode instead of stopping at clarify summary', async () => {
    const { project } = await makeCodexHookProject();

    const context = await runWorkspace(project, {
      context: true,
      message: '我想做一个给销售和产品团队用的 AI 客户访谈助手，你先帮我梳理下第一版该怎么切、值不值得先做太重。',
    });

    assert.equal(context.recommendation.type, 'workflow');
    assert.equal(context.recommendation.nextAction, 'brainstorm');
    assert.equal(context.recommendation.title, '先进入脑暴模式收敛方向');
    assert.equal(context.recommendation.command, 'openprd brainstorm . --open');

    const printResult = spawnSync(process.execPath, [
      path.resolve('bin/openprd.js'),
      'run',
      project,
      '--context',
      '--message',
      '我想做一个给销售和产品团队用的 AI 客户访谈助手，你先帮我梳理下第一版该怎么切、值不值得先做太重。',
    ], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });
    assert.equal(printResult.status, 0, printResult.stderr);
    assert.match(printResult.stdout, /建议下一步: 先进入脑暴模式收敛方向/);
    assert.match(printResult.stdout, /内部下一步参考: openprd brainstorm \. --open/);
    assert.match(printResult.stdout, /当前回复目标: 先进入脑暴模式，把核心诉求、目标结果、当前替代方案、推荐方向和验证重点整理成脑暴页；不要只停在 requirement 摘要。/);
  });

test('Codex hook accepts a later same-session execution instruction once review and tasks are ready', async () => {
  const { project } = await makeCodexHookProject();

    const requirementPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '在【Agent管理】模块下，我希望增加一个【团队搭建】放到【Agent 工区】菜单下面，这个模块主要是将 Agent市场、技能库和 CLI库按流程串联起来，一站式完成配置。',
    });
    assert.equal(requirementPromptPayload.continue, true);

    await captureFreshRequirementState(project, '用户已经确认 Team Builder 的需求范围。');
    const synthesizedTeamBuilder = await synthesizeWorkspace(project, {
      title: 'Team Builder',
      owner: 'PM',
      problemStatement: 'Agents need a guided team setup flow',
      whyNow: 'Configuration spans several libraries',
      primaryUsers: ['Agent operators'],
      goals: ['Guide team setup'],
      successMetrics: ['Setup succeeds'],
      acceptanceGoals: ['Operators can complete team setup'],
      inScope: ['Agent workspace team setup'],
      outOfScope: ['Billing'],
      primaryFlows: ['Operator configures a team'],
      functional: ['Create the team setup flow'],
      productType: 'agent',
    });

    await reviewWorkspace(project, { mark: 'confirmed' });
    await generateOpenSpecChangeWorkspace(project, { change: 'team-builder-late-execution' });

    const blockedPatchPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// still waiting for execution instruction\n*** End Patch',
    });
    assert.equal(blockedPatchPayload.decision, 'block');

    const lateExecutionPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '那你去修复吧，不需要再跟我确认。',
    });
    assert.equal(lateExecutionPromptPayload.continue, true);
    const executionGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
    assert.equal(executionGate.active, false);
    assert.equal(executionGate.status, 'user-confirmed-for-execution');

    const allowedPatchPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// execution confirmed later in the same session\n*** End Patch',
    });
  assert.equal(allowedPatchPayload.decision, undefined);
  assert.equal(allowedPatchPayload.continue, true);
  assert.equal(synthesizedTeamBuilder.snapshot.versionId, 'v0001');
});

test('Codex hook treats review-page continue copy as review authorization plus same-lane continuation intent', async () => {
  const { project } = await makeCodexHookProject();

  const requirementPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
    prompt: '在【Agent管理】模块下新增一个【团队搭建】流程，放到【Agent 工区】菜单下面，让操作员可以一站式完成配置。',
  });
  assert.equal(requirementPromptPayload.continue, true);

  await captureFreshRequirementState(project, '用户已经确认 Team Builder 的需求范围。');
  const synthesizedTeamBuilder = await synthesizeWorkspace(project, {
    title: 'Team Builder',
    owner: 'PM',
    problemStatement: 'Agents need a guided team setup flow',
    whyNow: 'Configuration spans several libraries',
    primaryUsers: ['Agent operators'],
    goals: ['Guide team setup'],
    successMetrics: ['Setup succeeds'],
    acceptanceGoals: ['Operators can complete team setup'],
    inScope: ['Agent workspace team setup'],
    outOfScope: ['Billing'],
    primaryFlows: ['Operator configures a team'],
    functional: ['Create the team setup flow'],
    productType: 'agent',
  });

  const reviewCommand = `openprd review . --mark confirmed --version ${synthesizedTeamBuilder.snapshot.versionId} --digest ${synthesizedTeamBuilder.snapshot.digest} --work-unit ${synthesizedTeamBuilder.workUnitId}`;
  const reviewCopyPrompt = [
    'OpenPrD Review: 认可并继续下一步',
    '这版需求确认稿已经通过。请先记录这次确认结果，并继续推进后续落地内容。只有后面确实需要额外授权时，再用人话说明影响和下一步。',
    '命令:',
    reviewCommand,
    '上下文:',
    JSON.stringify(buildReviewExportPayload(synthesizedTeamBuilder.snapshot), null, 2),
  ].join('\n\n');

  const reviewContinuePayload = runCodexHook(project, 'UserPromptSubmit', {
    prompt: reviewCopyPrompt,
  });
  assert.equal(reviewContinuePayload.continue, true);
  assert.ok(reviewContinuePayload.hookSpecificOutput.additionalContext.includes('用户刚刚已经确认这版需求，并且明确表示继续'));
  assert.ok(reviewContinuePayload.hookSpecificOutput.additionalContext.includes('先记录这次确认结果'));
  assert.ok(reviewContinuePayload.hookSpecificOutput.additionalContext.includes('不要再写“如果你认可”'));

  const requirementGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
  assert.equal(requirementGate.status, 'review-confirmation-authorized');
  assert.equal(requirementGate.reviewActionAuthorization.continueAfterReview, true);

  const authorizedReviewConfirmPayload = runCodexHook(project, 'PreToolUse', {
    tool_name: 'Bash',
    tool_input: { cmd: reviewCommand },
  });
  assert.equal(authorizedReviewConfirmPayload.decision, undefined);
  assert.equal(authorizedReviewConfirmPayload.continue, true);

  await reviewWorkspace(project, {
    mark: 'confirmed',
    version: synthesizedTeamBuilder.snapshot.versionId,
    digest: synthesizedTeamBuilder.snapshot.digest,
    workUnit: synthesizedTeamBuilder.workUnitId,
  });
  const runContext = await runWorkspace(project, { context: true });
  assert.equal(runContext.recommendation.type, 'requirement-intake');
  assert.ok(runContext.recommendation.reason.includes('本次调整'));
});

test('Codex hook auto-authorizes execution after review-continue copy once change and tasks are ready', async () => {
  const { project } = await makeCodexHookProject();

  const requirementPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
    prompt: '在【Agent管理】模块下，我希望增加一个【团队搭建】放到【Agent 工区】菜单下面，这个模块主要是将 Agent市场、技能库和 CLI库按流程串联起来，一站式完成配置。',
  });
  assert.equal(requirementPromptPayload.continue, true);

  await captureFreshRequirementState(project, '用户已经确认 Team Builder 的需求范围。');
  const synthesizedTeamBuilder = await synthesizeWorkspace(project, {
    title: 'Team Builder',
    owner: 'PM',
    problemStatement: 'Agents need a guided team setup flow',
    whyNow: 'Configuration spans several libraries',
    primaryUsers: ['Agent operators'],
    goals: ['Guide team setup'],
    successMetrics: ['Setup succeeds'],
    acceptanceGoals: ['Operators can complete team setup'],
    inScope: ['Agent workspace team setup'],
    outOfScope: ['Billing'],
    primaryFlows: ['Operator configures a team'],
    functional: ['Create the team setup flow'],
    productType: 'agent',
  });

  const reviewCommand = `openprd review . --mark confirmed --version ${synthesizedTeamBuilder.snapshot.versionId} --digest ${synthesizedTeamBuilder.snapshot.digest} --work-unit ${synthesizedTeamBuilder.workUnitId}`;
  const reviewCopyPrompt = [
    'OpenPrD Review: 认可并继续下一步',
    '这版需求确认稿已经通过。请先记录这次确认结果，并继续推进后续落地内容。只有后面确实需要额外授权时，再用人话说明影响和下一步。',
    '命令:',
    reviewCommand,
    '上下文:',
    JSON.stringify(buildReviewExportPayload(synthesizedTeamBuilder.snapshot), null, 2),
  ].join('\n\n');

  const reviewContinuePayload = runCodexHook(project, 'UserPromptSubmit', {
    prompt: reviewCopyPrompt,
  });
  assert.equal(reviewContinuePayload.continue, true);

  const authorizedReviewConfirmPayload = runCodexHook(project, 'PreToolUse', {
    tool_name: 'Bash',
    tool_input: { cmd: reviewCommand },
  });
  assert.equal(authorizedReviewConfirmPayload.decision, undefined);
  assert.equal(authorizedReviewConfirmPayload.continue, true);

  await reviewWorkspace(project, {
    mark: 'confirmed',
    version: synthesizedTeamBuilder.snapshot.versionId,
    digest: synthesizedTeamBuilder.snapshot.digest,
    workUnit: synthesizedTeamBuilder.workUnitId,
  });
  await generateOpenSpecChangeWorkspace(project, { change: 'team-builder-review-continue' });
  const requirementGateBeforePatch = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
  await fs.mkdir(path.join(project, '.openprd', 'harness', 'session-bindings'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'session-bindings', `${requirementGateBeforePatch.sessionId}.json`), JSON.stringify({
    version: 1,
    sessionId: requirementGateBeforePatch.sessionId,
    promptPreview: requirementGateBeforePatch.promptPreview,
    gateStatus: requirementGateBeforePatch.status,
    gateActive: requirementGateBeforePatch.active,
    title: synthesizedTeamBuilder.snapshot.title,
    versionId: synthesizedTeamBuilder.snapshot.versionId,
    digest: synthesizedTeamBuilder.snapshot.digest,
    workUnitId: synthesizedTeamBuilder.workUnitId,
    reviewStatus: 'confirmed',
    changeId: 'team-builder-review-continue',
  }, null, 2));
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'research-gate.json'), JSON.stringify({
    version: 1,
    active: false,
    status: 'resolved-for-test',
  }, null, 2));

  const allowedPatchPayload = runCodexHook(project, 'PreToolUse', {
    tool_name: 'apply_patch',
    tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// review continue copy auto-authorized execution\n*** End Patch',
  });
  assert.equal(allowedPatchPayload.decision, undefined);
  assert.equal(allowedPatchPayload.continue, true);

  const requirementGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
  assert.equal(requirementGate.active, false);
  assert.equal(requirementGate.status, 'execution-authorized');
});

test('Codex hook supports silent-record review lanes when the user opts out of extra review confirmation', async () => {
  const { project } = await makeCodexHookProject();

    const requirementPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请直接实现：新增 Agent 团队模板导入流，不需要评审，不需要确认，你直接做。',
    });
    assert.equal(requirementPromptPayload.continue, true);
    const requirementGatePath = path.join(project, '.openprd', 'harness', 'requirement-gate.json');
    const requirementGate = JSON.parse(await fs.readFile(requirementGatePath, 'utf8'));
    assert.equal(requirementGate.approvalPolicy.reviewPolicy, 'silent-record');
    assert.equal(requirementGate.approvalPolicy.maxClarificationQuestions, 1);

    const clarify = await clarifyWorkspace(project, {});
    assert.equal(clarify.clarification.requirementIntake.questionLimit, 1);
    assert.ok(clarify.clarification.mustAskUser.length <= 1);

    await captureFreshRequirementState(project, '用户已经确认 Agent 团队模板导入流的目标、范围与验收方式。');
    const synthesized = await synthesizeWorkspace(project, {
      title: 'Agent 团队模板导入流',
      owner: 'PM',
      problemStatement: '团队管理员需要直接导入团队模板，而不是手工逐项配置。',
      whyNow: '当前模板配置链路过长，用户已经明确要求直接落地。',
      primaryUsers: ['团队管理员'],
      goals: ['缩短团队模板导入配置时间'],
      successMetrics: ['管理员可一次性导入模板并开始使用'],
      acceptanceGoals: ['导入后生成团队模板配置', '失败时给出可恢复提示'],
      inScope: ['团队模板导入入口', '模板校验与导入结果提示'],
      outOfScope: ['模板市场排序'],
      primaryFlows: ['管理员选择模板并完成导入'],
      functional: ['提供模板导入入口', '导入后写入团队模板配置'],
      productType: 'agent',
    });

    const reviewCommand = `openprd review . --mark confirmed --version ${synthesized.snapshot.versionId} --digest ${synthesized.snapshot.digest} --work-unit ${synthesized.workUnitId}`;
    const silentRecordReviewPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'Bash',
      tool_input: { cmd: reviewCommand },
    });
    assert.equal(silentRecordReviewPayload.decision, undefined);
    assert.equal(silentRecordReviewPayload.continue, true);

    await reviewWorkspace(project, { mark: 'confirmed' });
    await generateOpenSpecChangeWorkspace(project, { change: 'agent-team-template-import' });

    const allowedPatchPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// silent-record implementation\n*** End Patch',
    });
    assert.equal(allowedPatchPayload.decision, undefined);
    assert.equal(allowedPatchPayload.continue, true);

    const executionAuthorizedGate = JSON.parse(await fs.readFile(requirementGatePath, 'utf8'));
    assert.equal(executionAuthorizedGate.active, false);
    assert.equal(executionAuthorizedGate.status, 'execution-authorized');
  });

  test('Codex hook does not open a silent-record lane when the user only waives review wording', async () => {
    const { project } = await makeCodexHookProject();

    const requirementPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请直接实现：新增 Agent 团队模板导入流，不需要评审，但后面该确认的你还是照常确认。',
    });
    assert.equal(requirementPromptPayload.continue, true);

    const requirementGatePath = path.join(project, '.openprd', 'harness', 'requirement-gate.json');
    const requirementGate = JSON.parse(await fs.readFile(requirementGatePath, 'utf8'));
    assert.equal(requirementGate.approvalPolicy.reviewPolicy, 'required');
  });

  test('Codex requirement gates are scoped to the current session id', async () => {
    const project = await makeTempProject();
    await initWorkspace(project, { templatePack: 'agent' });
    const sessionA = '019e4e72-74e5-7150-90d5-36284bf8bff3';
    const sessionB = '019e4e8f-7741-77f3-8ddb-3836de92f4f2';

    const openClawPrompt = '请直接实现：在 OpenClaw 检查和重启链路里增加配置自动修复层，避免用户关心 JSON 语法细节。';
    const feishuPrompt = '请直接实现：新增飞书渠道登录检测流程，保持固定进度条体验，不要在检测通过或失败后反复跳动。';
    const openClawGatePayload = runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionA,
      prompt: openClawPrompt,
    });
    assert.equal(openClawGatePayload.continue, true);

    const scopedGatePath = path.join(project, '.openprd', 'harness', 'requirement-gates', `${sessionA}.json`);
    const scopedGate = JSON.parse(await fs.readFile(scopedGatePath, 'utf8'));
    assert.equal(scopedGate.active, true);
    assert.equal(scopedGate.sessionId, sessionA);
    assert.ok(scopedGate.promptPreview.includes('OpenClaw'));

    const unrelatedPatchPayload = runCodexHook(project, 'PreToolUse', {
      session_id: sessionB,
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// unrelated session edit\n*** End Patch',
    });
    assert.equal(unrelatedPatchPayload.decision, undefined);
    assert.equal(unrelatedPatchPayload.continue, true);

    const sameSessionPatchPayload = runCodexHook(project, 'PreToolUse', {
      session_id: sessionA,
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// premature implementation\n*** End Patch',
    });
    assert.equal(sameSessionPatchPayload.decision, 'block');
    assert.ok(
      sameSessionPatchPayload.reason.includes('requirement gate is still active')
        || sameSessionPatchPayload.reason.includes('OpenPrd blocked a mutating action')
    );

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionB,
      prompt: feishuPrompt,
    });
    const feishuGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gates', `${sessionB}.json`), 'utf8'));
    assert.equal(feishuGate.active, true);
    assert.ok(feishuGate.promptPreview.includes('飞书'));

    runCodexHook(project, 'PreToolUse', {
      session_id: sessionA,
      tool_name: 'Bash',
      tool_input: {
        cmd: 'openprd clarify .',
      },
    });
    const mirroredGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
    assert.equal(mirroredGate.sessionId, sessionA);
    assert.ok(mirroredGate.promptPreview.includes('OpenClaw'));

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionB,
      prompt: '确认',
    });
    const afterBConfirmA = JSON.parse(await fs.readFile(scopedGatePath, 'utf8'));
    const afterBConfirmB = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gates', `${sessionB}.json`), 'utf8'));
    assert.equal(afterBConfirmA.active, true);
    assert.equal(afterBConfirmB.active, true);
    assert.equal(afterBConfirmB.status, 'clarification-confirmed');

    runCodexHook(project, 'PreToolUse', {
      session_id: sessionA,
      tool_name: 'Bash',
      tool_input: {
        cmd: 'openprd clarify .',
      },
    });
    await captureFreshRequirementState(project, '用户已经确认 OpenClaw 自动修复配置的需求范围。');
    const synthesizedOpenClaw = await synthesizeWorkspace(project, {
      title: 'OpenClaw Auto Repair',
      owner: 'PM',
      problemStatement: 'Operators need OpenClaw checks to repair malformed config automatically.',
      whyNow: 'Manual JSON recovery interrupts the restart flow.',
      primaryUsers: ['OpenClaw operators'],
      goals: ['Repair common config issues before restart'],
      successMetrics: ['Restarts complete without manual JSON edits'],
      acceptanceGoals: ['Operators can run checks and restart without editing JSON'],
      inScope: ['OpenClaw check and restart recovery flow'],
      outOfScope: ['Account management'],
      primaryFlows: ['Operator runs checks and the system repairs safe config issues'],
      functional: ['Add safe config repair to the OpenClaw check flow'],
      productType: 'developer-tool',
    });
    const reviewCommand = `openprd review . --mark confirmed --version ${synthesizedOpenClaw.snapshot.versionId} --digest ${synthesizedOpenClaw.snapshot.digest} --work-unit ${synthesizedOpenClaw.workUnitId}`;
    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionA,
      prompt: reviewCommand,
    });
    runCodexHook(project, 'PreToolUse', {
      session_id: sessionA,
      tool_name: 'Bash',
      tool_input: {
        cmd: reviewCommand,
      },
    });
    await reviewWorkspace(project, { mark: 'confirmed' });
    await generateOpenSpecChangeWorkspace(project, { change: 'openclaw-auto-repair' });

    const afterBReadyPatch = runCodexHook(project, 'PreToolUse', {
      session_id: sessionB,
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// still blocked in another session\n*** End Patch',
    });
    assert.equal(afterBReadyPatch.decision, 'block');
    const afterBFinalConfirmA = JSON.parse(await fs.readFile(scopedGatePath, 'utf8'));
    const afterBFinalConfirmB = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gates', `${sessionB}.json`), 'utf8'));
    assert.equal(afterBFinalConfirmA.active, true);
    assert.equal(afterBFinalConfirmB.active, true);

    const afterAReadyPatch = runCodexHook(project, 'PreToolUse', {
      session_id: sessionA,
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// allowed in matching session\n*** End Patch',
    });
    assert.equal(afterAReadyPatch.decision, undefined);
    assert.equal(afterAReadyPatch.continue, true);
    const afterAConfirm = JSON.parse(await fs.readFile(scopedGatePath, 'utf8'));
    assert.equal(afterAConfirm.active, false);
    assert.equal(afterAConfirm.status, 'execution-authorized');
  });

  test('Codex requirement gate opening also registers the session globally', async () => {
    const { project } = await makeCodexHookProject();
    const sessionId = '019e8788-0f90-72f0-bf42-1667e3264af8';
    const prompt = '请直接实现：新增飞书渠道登录检测流程，保持固定进度条体验，不要在检测通过或失败后反复跳动。';

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionId,
      prompt,
    });
    assert.equal(
      await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gates', `${sessionId}.json`)),
      true,
    );

    const registry = await readSessionRegistry({ openprdHome: process.env.OPENPRD_HOME });
    const entry = registry.entries.find((item) => item.sessionId === sessionId);
    assert.ok(entry);
    assert.equal(entry.workspaceRoot, project);
    assert.equal(entry.gateActive, true);
    assert.equal(entry.gateStatus, 'requires-clarification');
    assert.ok(entry.promptPreview.includes('飞书渠道登录检测流程'));
    assert.ok(entry.bindingPath.endsWith(`${sessionId}.json`));
  });

  test('session-scoped review authorization stays pinned after another session synthesizes a newer PRD', async () => {
    const { project } = await makeCodexHookProject();
    const sessionA = '019e5f21-54be-7042-bb92-9ba6b2c24757';
    const sessionB = '019e5f64-2ee1-70a3-9b26-3905dfac0d4b';

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionA,
      prompt: '请直接实现：在模型入口里增加更清晰的会员权益说明。',
    });
    await captureFreshRequirementState(project, '用户已经确认模型入口会员权益说明的需求范围。');
    const synthesizedA = await synthesizeWorkspace(project, {
      title: '模型入口会员权益说明',
      owner: 'PM',
      problemStatement: '用户看不懂当前模型入口和会员权益的关系。',
      whyNow: '入口文案已经触发用户反馈。',
      primaryUsers: ['模型入口访问用户'],
      goals: ['让会员权益说明更清晰'],
      successMetrics: ['用户能理解权益差异'],
      acceptanceGoals: ['会员权益文案清晰可见'],
      inScope: ['模型入口权益说明'],
      outOfScope: ['套餐定价'],
      primaryFlows: ['用户打开模型入口并理解权益说明'],
      functional: ['在模型入口展示清晰的会员权益说明'],
      productType: 'agent',
    });

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionB,
      prompt: '请直接实现：导入的 agent 默认要给一个空模型配置，并在认领时增加模型选择。',
    });
    await captureFreshRequirementState(project, '用户已经确认导入空模型与认领模型选择的需求范围。');
    const synthesizedB = await synthesizeWorkspace(project, {
      title: '导入空模型与认领模型选择',
      owner: 'PM',
      problemStatement: '导入的 agent 没有默认模型配置，认领时也无法明确选择模型。',
      whyNow: '导入和认领链路都在产生错误预期。',
      primaryUsers: ['Agent 导入操作者'],
      goals: ['让导入与认领链路都带上模型信息'],
      successMetrics: ['导入与认领不再出现空模型状态'],
      acceptanceGoals: ['导入后存在默认模型配置', '认领时可选择模型'],
      inScope: ['导入默认模型配置', '认领模型选择'],
      outOfScope: ['模型市场排序'],
      primaryFlows: ['用户导入 agent 后直接认领并选择模型'],
      functional: ['导入后写入默认模型配置', '认领时提供模型选择'],
      productType: 'agent',
    });

    const quotedReviewCommandA = `openprd review . --mark confirmed --version '${synthesizedA.snapshot.versionId}' --digest '${synthesizedA.snapshot.digest}' --work-unit '${synthesizedA.workUnitId}'`;
    const authorizationPayload = runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionA,
      prompt: quotedReviewCommandA,
    });
    assert.equal(authorizationPayload.continue, true);
    assert.ok(authorizationPayload.hookSpecificOutput.additionalContext.includes('只允许记录这次确认结果'));

    const authorizedGateA = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gates', `${sessionA}.json`), 'utf8'));
    assert.equal(authorizedGateA.reviewActionAuthorization.versionId, synthesizedA.snapshot.versionId);
    assert.equal(authorizedGateA.reviewActionAuthorization.digest, synthesizedA.snapshot.digest);
    assert.equal(authorizedGateA.reviewActionAuthorization.workUnitId, synthesizedA.workUnitId);
    assert.notEqual(authorizedGateA.reviewActionAuthorization.versionId, synthesizedB.snapshot.versionId);

    const authorizedReviewPayload = runCodexHook(project, 'PreToolUse', {
      session_id: sessionA,
      tool_name: 'Bash',
      tool_input: { cmd: quotedReviewCommandA },
    });
    assert.equal(authorizedReviewPayload.decision, undefined);
    assert.equal(authorizedReviewPayload.continue, true);
  });

  test('Codex hook separates new requirement intake from historical active change reminders', async () => {
    const { project } = await makeCodexHookProject();

    const changeId = 'account-achievements-user-type-v1';
    const changeDir = path.join(project, 'openprd', 'changes', changeId);
    await fs.mkdir(path.join(changeDir, 'specs', 'agent-requirements'), { recursive: true });
    await fs.writeFile(path.join(changeDir, 'proposal.md'), [
      '# 我的成就与 AI探索者用户类型',
      '',
      '## 背景与原因',
      '',
      '当前账户弹窗和侧边栏只把非 Pro 用户显示为普通用户，无法体现已参与内测的用户身份；也缺少可扩展的我的成就模块。',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(changeDir, 'tasks.md'), [
      '# 任务',
      '',
      '- [ ] T001.01 评审生成的 spec 覆盖',
      '  - type: governance',
      '  - done: agent-requirements spec 已覆盖当前变更目标',
      '  - verify: openprd change . --validate --change account-achievements-user-type-v1',
      '',
      '- [ ] T001.02 补齐邀请码识别与用户类型接线',
      '  - type: implementation',
      '  - done: 邀请码识别、用户类型判断和进入应用路径已经接通',
      '  - verify: openprd run . --verify',
      '',
      '- [ ] T001.03 接通账户弹窗与我的成就入口',
      '  - type: implementation',
      '  - done: 账户弹窗菜单与我的成就入口已经可见且可进入',
      '  - verify: openprd run . --verify',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(changeDir, 'specs', 'agent-requirements', 'spec.md'), [
      '## 新增需求',
      '',
      '### 需求：我的成就与 AI探索者用户类型',
      '当前账户弹窗和侧边栏只把非 Pro 用户显示为普通用户。',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), `${JSON.stringify({
      version: 1,
      activeChange: changeId,
      changes: {
        [changeId]: {
          id: changeId,
          status: 'active',
        },
      },
    }, null, 2)}\n`);

    const payload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '新增 iOS 自动任务强提醒播报：定时任务到点后在 iOS 端展示动画并播报内容。',
    });
    assert.equal(payload.continue, true);
    const context = payload.hookSpecificOutput.additionalContext;
    assert.ok(context.includes('OpenPrd 当前需求入口'));
    assert.ok(context.includes('本轮需求: 新增 iOS 自动任务强提醒播报'));
    assert.ok(context.includes('OpenPrd 历史需求提醒'));
    assert.ok(context.includes('历史需求: 我的成就与 AI探索者用户类型'));
    assert.ok(context.includes('需求说明: 当前账户弹窗和侧边栏只把非 Pro 用户显示为普通用户'));
    assert.ok(context.includes('待判断的需求点: 补齐邀请码识别与用户类型接线'));
    assert.ok(context.includes('本轮不会自动继续它'));
    assert.equal(context.includes(`openprd tasks . --change '${changeId}'`), false);
    assert.equal(context.includes('用 Loop 执行'), false);

    const gate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
    assert.equal(gate.intakeMode, 'deep-reflection');

    const clarify = await clarifyWorkspace(project, {});
    assert.equal(clarify.intakeReflection.mode, 'deep');
    assert.equal(clarify.intakeReflection.rounds.length, 3);
    assert.ok(clarify.clarification.requirementIntake.reflection.rounds.some((round) => round.title.includes('第 2 轮')));
    assert.ok(clarify.clarification.mustAskUser.some((item) => item.id === 'requirement-intake.intent'));
    assert.ok(clarify.clarification.mustAskUser.length <= clarify.clarification.requirementIntake.questionLimit);
    const reflectionMarkdown = await fs.readFile(path.join(project, '.openprd', 'engagements', 'active', 'intake-reflection.md'), 'utf8');
    assert.ok(reflectionMarkdown.includes('第 1 轮：意图归一化'));
    assert.ok(reflectionMarkdown.includes('第 2 轮：项目上下文映射'));
    assert.ok(reflectionMarkdown.includes('首轮项目画像'));
    assert.equal(clarify.clarifyPresentation.mode, 'inline-with-checklist');
    assert.equal(clarify.clarifyArtifact, null);
    assert.equal(clarify.clarifyArtifactBundle, null);
    assert.equal(await pathExists(path.join(project, '.openprd', 'engagements', 'active', 'clarify.html')), false);
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('我先用产品和业务语言复述一下')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('需求判断：')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('第一批最容易触达')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('什么承诺才算真需求')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('主要服务对象')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('| 功能模块 |')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('| 技术部分 |')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('这轮我会重点看哪些步骤让 Agent 自主完成')));
  });

  test('clarify keeps focused active requirement intake in the conversation', async () => {
    const project = await makeTempProject();
    await initWorkspace(project, { templatePack: 'agent' });
    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: true,
      status: 'requires-clarification',
      promptPreview: '把图标资源站参考加入 shadcn Skill。',
      requiredFlow: ['clarify', 'capture', 'synthesize', 'review', 'change-generate', 'tasks', 'implementation'],
    }, null, 2));

    const clarify = await clarifyWorkspace(project, {});
    assert.ok(clarify.clarifyPresentation.mode.startsWith('inline'));
    assert.equal(clarify.clarifyArtifact, null);
    assert.equal(clarify.clarifyArtifactBundle, null);
    assert.equal(await pathExists(path.join(project, '.openprd', 'engagements', 'active', 'clarify.html')), false);
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('我先用产品和业务语言复述一下')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('我建议这轮先确认这一点')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('第一版先让用户做到')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('| 功能模块 |')));
  });

  test('clarify keeps local visual cleanup requests inline even with inferred fields', async () => {
    const project = await makeTempProject();
    await initWorkspace(project, { templatePack: 'agent' });
    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: true,
      status: 'requires-clarification',
      promptPreview: '去掉红圈的地方，包括不限于卡片的描边布局，直接变成平铺的就行。',
      requiredFlow: ['clarify', 'capture', 'synthesize', 'review', 'change-generate', 'tasks', 'implementation'],
    }, null, 2));

    const clarify = await clarifyWorkspace(project, {});
    assert.ok(clarify.clarifyPresentation.mode.startsWith('inline'));
    assert.equal(clarify.clarifyArtifact, null);
    assert.equal(clarify.clarifyArtifactBundle, null);
    assert.equal(await pathExists(path.join(project, '.openprd', 'engagements', 'active', 'clarify.html')), false);
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('我先用产品和业务语言复述一下')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('必须守住')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('| 技术部分 |')));
  });

  test('active requirement gate does not block freeze after reviewed PRD artifacts are confirmed', async () => {
    const project = await makeTempProject();
    await initWorkspace(project, { templatePack: 'consumer' });
    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: true,
      status: 'requires-clarification',
      promptPreview: '请实现一个本地习惯检查 CLI。',
      requiredFlow: ['clarify', 'capture', 'synthesize', 'review', 'change-generate', 'tasks', 'implementation'],
    }, null, 2));

    await captureFreshRequirementState(project, '用户已经确认本地习惯检查 CLI 的需求范围。');
    await synthesizeWorkspace(project, {
      title: 'habit-check CLI',
      owner: 'OpenPRD 验证',
      problemStatement: '个人效率工具用户每天容易忘记查看今天还有哪些习惯没有完成。',
      whyNow: '需要用一个小型交付物验证需求澄清、评审和质量门禁是否执行到位。',
      evidence: ['用户已确认目标用户、问题、范围、主流程和异常流程。'],
      primaryUsers: ['个人效率工具用户'],
      stakeholders: ['OpenPRD 验证负责人'],
      goals: ['清楚显示今天未完成的习惯'],
      successMetrics: ['运行 CLI 后能列出所有未完成习惯'],
      acceptanceGoals: ['提供 Node.js CLI', '提供 smoke 测试'],
      inScope: ['本地 habits.json 输入', '未完成习惯列表输出'],
      outOfScope: ['联网', '账号', '数据库'],
      primaryFlows: ['读取本地 habits.json', '过滤未完成习惯', '输出名称列表'],
      edgeCases: ['所有习惯已完成'],
      failureModes: ['文件不存在', 'JSON 无效'],
      functional: ['默认从当前目录读取 habits.json', '只把 doneToday 为 false 的习惯视为未完成'],
      nonFunctional: ['只访问本地文件', '输出简短易读'],
      businessRules: ['输入无效时输出普通用户可理解的错误'],
      costDrivers: ['没有外部使用成本'],
      usageLimits: ['每次运行只读取一个本地文件'],
      abusePrevention: ['不进行网络调用'],
      monitoringSignals: ['smoke 测试结果'],
      alertThresholds: ['任何 smoke 失败都阻断就绪声明'],
      stopLossActions: ['修复失败路径并重跑测试'],
      technical: ['使用 Node.js 实现'],
      compliance: ['习惯数据只留在用户本机'],
      dependencies: ['Node.js 运行时'],
      assumptions: ['habits.json 是 JSON 数组'],
      risks: ['格式错误的习惯条目可能让用户困惑'],
      openQuestions: ['本次验证范围内没有开放问题'],
      handoffOwner: 'OpenPRD 验证',
      nextStep: '生成 change 和 tasks',
      targetSystem: 'OpenPRD',
      productType: 'consumer',
      persona: '维护轻量习惯清单的个人用户',
      segment: '个人效率用户',
      journey: '每日运行 CLI 查看剩余习惯',
      activationMetric: '第一次成功看到未完成清单',
      retentionMetric: '每天可重复运行查看状态',
    });
    await diagramWorkspace(project, { type: 'product-flow', mark: 'confirmed' });
    await reviewWorkspace(project, { mark: 'confirmed', notes: '需求事实和评审产物已确认。' });

    const next = await nextWorkspace(project);
    assert.equal(next.recommendation.nextAction, 'freeze');
    assert.equal(next.recommendation.currentGate, 'freeze review');
    assert.equal(next.clarification.requirementIntake.satisfied, true);

    const frozen = await freezeWorkspace(project);
    assert.equal(frozen.ok, true);
    assert.equal(frozen.snapshot.status, 'frozen');
  });

  test('Codex hook blocks skill and AGENTS edits until visualization confirmation is complete', async () => {
    const { project } = await makeCodexHookProject();

    const skillPrompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '先分析一下并准备修改 skills/openprd-shared/SKILL.md 和 AGENTS.md，优化这个 skill workflow。',
    });
    assert.equal(skillPrompt.continue, true);
    assert.ok(skillPrompt.hookSpecificOutput.additionalContext.includes('可视化确认门禁'));
    assert.ok(skillPrompt.hookSpecificOutput.additionalContext.includes('彩色 Mermaid'));
    const skillGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'skill-visualization-gate.json'), 'utf8'));
    assert.equal(skillGate.active, true);

    const blockedSkillPatch = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: skills/openprd-shared/SKILL.md\n@@\n+- pending edit\n*** End Patch',
    });
    assert.equal(blockedSkillPatch.decision, 'block');
    assert.ok(blockedSkillPatch.reason.includes('visualization-confirmation gate'));

    const confirmed = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '确认执行',
    });
    assert.equal(confirmed.continue, true);
    const confirmedGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'skill-visualization-gate.json'), 'utf8'));
    assert.equal(confirmedGate.active, false);
    assert.equal(confirmedGate.status, 'user-confirmed-after-visualization');

    const allowedSkillPatch = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: skills/openprd-shared/SKILL.md\n@@\n+- confirmed edit\n*** End Patch',
    });
    assert.equal(allowedSkillPatch.continue, true);
  });

  test('Codex hook requires DeepWiki and Context7 evidence before mutating external-integration work', async () => {
    const { project } = await makeCodexHookProject();

    const repoPrompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请参考 github.com/vercel/next.js 这个公开仓库的整体架构，对标下我们的 CLI 设计，然后直接修改实现。',
    });
    assert.equal(repoPrompt.continue, true);
    assert.ok(repoPrompt.hookSpecificOutput.additionalContext.includes('外部仓库调研门禁'));
    let researchGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'research-gate.json'), 'utf8'));
    assert.equal(researchGate.kind, 'deepwiki');
    assert.equal(researchGate.active, true);

    const blockedRepoPatch = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// mutate before deepwiki\n*** End Patch',
    });
    assert.equal(blockedRepoPatch.decision, 'block');
    assert.ok(blockedRepoPatch.reason.includes('read_wiki_structure'));

    runCodexHook(project, 'PreToolUse', {
      tool_name: 'deepwiki__read_wiki_structure',
      tool_input: { repo: 'vercel/next.js' },
    });
    runCodexHook(project, 'PreToolUse', {
      tool_name: 'deepwiki__ask_question',
      tool_input: { question: 'What are the main subsystems?' },
    });
    researchGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'research-gate.json'), 'utf8'));
    assert.equal(researchGate.active, false);
    assert.equal(researchGate.status, 'evidence-collected');

    const contextPrompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '这个第三方 SDK 和 CLI 的配置、限制和迁移路径需要确认一下，然后直接改我们的集成实现。',
    });
    assert.equal(contextPrompt.continue, true);
    assert.ok(contextPrompt.hookSpecificOutput.additionalContext.includes('外部技术调研门禁'));
    researchGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'research-gate.json'), 'utf8'));
    assert.equal(researchGate.kind, 'context7');
    assert.equal(researchGate.active, true);

    const blockedContextPatch = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// mutate before context7\n*** End Patch',
    });
    assert.equal(blockedContextPatch.decision, 'block');
    assert.ok(blockedContextPatch.reason.includes('resolve_library_id'));

    runCodexHook(project, 'PreToolUse', {
      tool_name: 'context7__resolve_library_id',
      tool_input: { libraryName: 'example-sdk' },
    });
    runCodexHook(project, 'PreToolUse', {
      tool_name: 'context7__query_docs',
      tool_input: { question: 'How do I configure migration steps?' },
    });
    researchGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'research-gate.json'), 'utf8'));
    assert.equal(researchGate.active, false);
    assert.equal(researchGate.status, 'evidence-collected');
  });

  test('Codex hook blocks frontend implementation writes until active design contracts are filled', async () => {
    const { project } = await makeCodexHookProject();

    const frontendPrompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请直接实现一个大英博物馆中文导览 App 首页静态原型，包含今日推荐、楼层浏览、路线规划、门票和到访准备。已知事实：开放时间 10:00-17:00，中文语音导览 7 GBP，会员优先。不要做成通用极简 SaaS 风。',
    });
    assert.equal(frontendPrompt.continue, true);

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: false,
      status: 'not-required',
      reason: 'test override',
      updatedAt: '2026-06-08 00:00:00',
    }, null, 2));

    const blockedPatchPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: [
        '*** Begin Patch',
        '*** Add File: index.html',
        '+<!doctype html>',
        '+<html lang="zh-CN">',
        '+<body>museum prototype</body>',
        '+</html>',
        '*** End Patch',
      ].join('\n'),
    });
    assert.equal(blockedPatchPayload.decision, 'block');
    assert.ok(blockedPatchPayload.reason.includes('design-preflight contract is still incomplete'));
    assert.ok(blockedPatchPayload.reason.includes('facts-sheet.md'));
    assert.ok(blockedPatchPayload.reason.includes('asset-spec.md'));
    assert.ok(blockedPatchPayload.reason.includes('image-preflight.md'));
    assert.ok(blockedPatchPayload.reason.includes('direction-plan.md'));
    assert.ok(blockedPatchPayload.reason.includes('selected-direction.md'));

    const activeDir = path.join(project, '.openprd', 'design', 'active');
    await fs.writeFile(path.join(activeDir, 'facts-sheet.md'), '# Facts\n\n- 开放时间：10:00-17:00\n- 中文语音导览：7 GBP\n- 会员优先：已知用户输入\n');
    await fs.writeFile(path.join(activeDir, 'asset-spec.md'), '# Assets\n\n- 品牌资产：暂无官方素材，先用文字与中性色块表达\n');
    await fs.writeFile(path.join(activeDir, 'image-preflight.md'), '# Image preflight\n\n- 真实馆藏图片：当前缺失\n- 降级方案：先用明确的馆藏卡片占位并标记待替换\n');
    await fs.writeFile(path.join(activeDir, 'direction-plan.md'), '# Directions\n\n1. 馆藏导览\n2. 编辑感叙事\n3. 高密度工具型\n');
    await fs.writeFile(path.join(activeDir, 'selected-direction.md'), '# Selected\n\n- lens: catalog-clarity\n- theme: warm-editorial\n- layout: story-map\n');

    const allowedPatchPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: [
        '*** Begin Patch',
        '*** Add File: index.html',
        '+<!doctype html>',
        '+<html lang="zh-CN">',
        '+<body>museum prototype</body>',
        '+</html>',
        '*** End Patch',
      ].join('\n'),
    });
    assert.equal(allowedPatchPayload.decision, undefined);
    assert.equal(allowedPatchPayload.continue, true);
  });

  test('Codex hook blocks Patch Mode hover after overwrite is announced and releases after target write lands', async () => {
    const { project } = await makeCodexHookProject();
    const sessionId = '019ea999-0000-7000-8000-patchmode0001';

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionId,
      prompt: '请直接实现一个西双版纳雨林观鸟导览首页，不要停下来问问题。',
    });

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: false,
      status: 'not-required',
      reason: 'test override',
      updatedAt: '2026-06-09 00:00:00',
    }, null, 2));
    await seedReadyFrontendDesignArtifacts(project);
    await fs.writeFile(path.join(project, 'index.html'), '<!doctype html><html lang="zh-CN"><body>starter</body></html>\n');
    await seedDesignStarterEvent(project, 'index.html');
    const transcriptPath = await writeCodexTranscript(
      project,
      sessionId,
      '我现在开始覆盖入口文件，下一步直接重写 index.html，把真实内容和图片约束落进去。'
    );

    const blockedRead = runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      transcript_path: transcriptPath,
      tool_name: 'Read',
      tool_input: {
        file_path: path.join(project, 'docs', 'basic', 'frontend-guidelines.md'),
      },
    });
    assert.equal(blockedRead.decision, 'block');
    assert.ok(blockedRead.reason.includes('entry-overwrite stage'));
    assert.ok(blockedRead.reason.includes('index.html'));
    assert.ok(blockedRead.reason.includes('index.next.html'));

    const allowedWrite = runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      transcript_path: transcriptPath,
      tool_name: 'apply_patch',
      tool_input: [
        '*** Begin Patch',
        '*** Add File: index.next.html',
        '+<!doctype html>',
        '+<html lang="zh-CN"><body>rewrite draft</body></html>',
        '*** End Patch',
      ].join('\n'),
    });
    assert.equal(allowedWrite.decision, undefined);
    assert.equal(allowedWrite.continue, true);

    const armedGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'patch-mode-gate.json'), 'utf8'));
    assert.equal(armedGate.active, true);
    assert.equal(armedGate.status, 'write-attempted');

    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(path.join(project, 'index.next.html'), '<!doctype html><html lang="zh-CN"><body>rewrite draft</body></html>\n');

    const releasedRead = runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      transcript_path: transcriptPath,
      tool_name: 'Read',
      tool_input: {
        file_path: path.join(project, 'index.html'),
      },
    });
    assert.equal(releasedRead.decision, undefined);
    assert.equal(releasedRead.continue, true);

    const closedGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'patch-mode-gate.json'), 'utf8'));
    assert.equal(closedGate.active, false);
    assert.equal(closedGate.status, 'write-observed');
  });

  test('Codex hook only allows one immediate post-starter focus pass before requiring an entry write', async () => {
    const { project } = await makeCodexHookProject();
    const sessionId = '019ea999-0000-7000-8000-patchmode0003';

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionId,
      prompt: '请直接实现一个西双版纳雨林观鸟导览首页，不要停下来问问题。',
    });

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: false,
      status: 'not-required',
      reason: 'test override',
      updatedAt: '2026-06-09 00:00:00',
    }, null, 2));
    await seedReadyFrontendDesignArtifacts(project);
    await fs.writeFile(path.join(project, 'index.html'), '<!doctype html><html lang="zh-CN"><body>starter</body></html>\n');
    await seedDesignStarterEvent(project, 'index.html');

    const firstFocus = runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      tool_name: 'Read',
      tool_input: {
        file_path: path.join(project, 'index.html'),
      },
    });
    assert.equal(firstFocus.decision, undefined);
    assert.equal(firstFocus.continue, true);

    const secondFocus = runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      tool_name: 'Bash',
      tool_input: {
        command: "sed -n '1,80p' .openprd/design/active/facts-sheet.md",
      },
    });
    assert.equal(secondFocus.decision, undefined);
    assert.equal(secondFocus.continue, true);

    const gateAfterFocus = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'patch-mode-gate.json'), 'utf8'));
    assert.equal(gateAfterFocus.active, true);
    assert.equal(gateAfterFocus.phase, 'handoff');
    assert.equal(gateAfterFocus.status, 'handoff-awaiting-entry-write');
    assert.equal(gateAfterFocus.focusAllowanceRemaining, 0);

    const blockedSearch = runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      tool_name: 'WebSearch',
      tool_input: {
        query: '西双版纳 观鸟 官方',
      },
    });
    assert.equal(blockedSearch.decision, 'block');
    assert.ok(blockedSearch.reason.includes('post-starter hover'));
    assert.ok(blockedSearch.reason.includes('docs/basic'));
    assert.ok(blockedSearch.reason.includes('index.next.html'));

    const allowedWrite = runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      tool_name: 'apply_patch',
      tool_input: [
        '*** Begin Patch',
        '*** Update File: index.html',
        '@@',
        '-<!doctype html><html lang="zh-CN"><body>starter</body></html>',
        '+<!doctype html><html lang="zh-CN"><body>rainforest guide</body></html>',
        '*** End Patch',
      ].join('\n'),
    });
    assert.equal(allowedWrite.decision, undefined);
    assert.equal(allowedWrite.continue, true);

    const armedGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'patch-mode-gate.json'), 'utf8'));
    assert.equal(armedGate.active, true);
    assert.equal(armedGate.status, 'write-attempted');
  });

  test('Codex hook treats nested tool_input.command shell reads as allowed handoff focus', async () => {
    const { project } = await makeCodexHookProject();
    const sessionId = '019ea999-0000-7000-8000-patchmode0005';

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionId,
      prompt: '请直接实现一个西双版纳雨林观鸟导览首页，不要停下来问问题。',
    });

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: false,
      status: 'not-required',
      reason: 'test override',
      updatedAt: '2026-06-09 00:00:00',
    }, null, 2));
    await seedReadyFrontendDesignArtifacts(project);
    await fs.writeFile(path.join(project, 'index.html'), '<!doctype html><html lang="zh-CN"><body>starter</body></html>\n');
    await seedDesignStarterEvent(project, 'index.html');

    const focusRead = runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      tool_input: {
        command: "sed -n '1,120p' index.html",
      },
    });
    assert.equal(focusRead.decision, undefined);
    assert.equal(focusRead.continue, true);

    const gateAfterFocus = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'patch-mode-gate.json'), 'utf8'));
    assert.equal(gateAfterFocus.active, true);
    assert.equal(gateAfterFocus.phase, 'handoff');
    assert.equal(gateAfterFocus.status, 'handoff-focus-read');
    assert.equal(gateAfterFocus.focusAllowanceRemaining, 1);
  });

  test('Codex hook can still arm Patch Mode from the hook script path when PreToolUse payload omits cwd', async () => {
    const { project } = await makeCodexHookProject();
    const sessionId = '019ea999-0000-7000-8000-patchmode0006';

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionId,
      prompt: '请直接实现一个西双版纳雨林观鸟导览首页，不要停下来问问题。',
    });

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: false,
      status: 'not-required',
      reason: 'test override',
      updatedAt: '2026-06-09 00:00:00',
    }, null, 2));
    await seedReadyFrontendDesignArtifacts(project);
    await fs.writeFile(path.join(project, 'index.html'), '<!doctype html><html lang="zh-CN"><body>starter</body></html>\n');
    await seedDesignStarterEvent(project, 'index.html');

    const focusRead = runCodexHookWithoutCwd(project, 'PreToolUse', {
      tool_input: {
        command: "sed -n '1,120p' index.html",
      },
    }, path.resolve('..'));
    assert.equal(focusRead.decision, undefined);
    assert.equal(focusRead.continue, true);

    const gateAfterFocus = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'patch-mode-gate.json'), 'utf8'));
    assert.equal(gateAfterFocus.active, true);
    assert.equal(gateAfterFocus.phase, 'handoff');
    assert.equal(gateAfterFocus.status, 'handoff-focus-read');
    assert.equal(gateAfterFocus.focusAllowanceRemaining, 1);
  });

  test('Stop hook reminds when Patch Mode overwrite was announced but no entry write landed', async () => {
    const { project } = await makeCodexHookProject();
    const sessionId = '019ea999-0000-7000-8000-patchmode0002';

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionId,
      prompt: '请直接实现一个西双版纳雨林观鸟导览首页，不要停下来问问题。',
    });

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: false,
      status: 'not-required',
      reason: 'test override',
      updatedAt: '2026-06-09 00:00:00',
    }, null, 2));
    await fs.writeFile(path.join(project, 'index.html'), '<!doctype html><html lang="zh-CN"><body>starter</body></html>\n');
    await seedDesignStarterEvent(project, 'index.html');
    const transcriptPath = await writeCodexTranscript(
      project,
      sessionId,
      '我现在开始覆盖入口文件，下一步直接重写 index.html，把真实内容落进去。'
    );

    runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      transcript_path: transcriptPath,
      tool_name: 'Read',
      tool_input: {
        file_path: path.join(project, 'docs', 'basic', 'frontend-guidelines.md'),
      },
    });

    const stop = runCodexHook(project, 'Stop', {
      session_id: sessionId,
    });
    assert.equal(stop.continue, true);
    assert.ok(stop.hookSpecificOutput.additionalContext.includes('入口文件还没真正落盘'));
    assert.ok(stop.hookSpecificOutput.additionalContext.includes('index.html'));
    assert.ok(stop.hookSpecificOutput.additionalContext.includes('index.next.html'));
  });

  test('Stop hook reminds when design-starter landed but Patch Mode handoff never wrote the entry', async () => {
    const { project } = await makeCodexHookProject();
    const sessionId = '019ea999-0000-7000-8000-patchmode0004';

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionId,
      prompt: '请直接实现一个西双版纳雨林观鸟导览首页，不要停下来问问题。',
    });

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: false,
      status: 'not-required',
      reason: 'test override',
      updatedAt: '2026-06-09 00:00:00',
    }, null, 2));
    await seedReadyFrontendDesignArtifacts(project);
    await fs.writeFile(path.join(project, 'index.html'), '<!doctype html><html lang="zh-CN"><body>starter</body></html>\n');
    await seedDesignStarterEvent(project, 'index.html');

    runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      tool_name: 'Read',
      tool_input: {
        file_path: path.join(project, 'index.html'),
      },
    });

    const stop = runCodexHook(project, 'Stop', {
      session_id: sessionId,
    });
    assert.equal(stop.continue, true);
    assert.ok(stop.hookSpecificOutput.additionalContext.includes('design-starter 已经落地'));
    assert.ok(stop.hookSpecificOutput.additionalContext.includes('Patch Mode handoff'));
    assert.ok(stop.hookSpecificOutput.additionalContext.includes('index.html'));
  });

  test('Codex hook protects vault reads and reminds about browser, copy, and weapp rules', async () => {
    const { project } = await makeCodexHookProject();

    const credentialPrompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '这个任务需要 API key 和 token，先帮我拿一下凭证。',
    });
    assert.equal(credentialPrompt.continue, true);
    assert.ok(credentialPrompt.hookSpecificOutput.additionalContext.includes('secrets-vault'));

    const blockedVaultRead = runCodexHook(project, 'PreToolUse', {
      tool_name: 'Bash',
      tool_input: { cmd: 'cat ~/.vault/secrets.json' },
    });
    assert.equal(blockedVaultRead.decision, 'block');
    assert.ok(blockedVaultRead.reason.includes('raw vault read'));

    const browserPrompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请用 Computer Use 打开浏览器页面并点击提交订单按钮。',
    });
    assert.equal(browserPrompt.continue, true);
    assert.ok(browserPrompt.hookSpecificOutput.additionalContext.includes('Codex-owned browser window'));

    const browserReminder = runCodexHook(project, 'PreToolUse', {
      tool_name: 'computer_click',
      tool_input: { action: 'submit order button' },
    });
    assert.equal(browserReminder.continue, true);
    assert.ok(browserReminder.hookSpecificOutput.additionalContext.includes('窗口归属'));

    const copyPrompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '把这个错误文案改成普通用户能看懂的，并同步检查 i18n。',
    });
    assert.equal(copyPrompt.continue, true);
    assert.ok(copyPrompt.hookSpecificOutput.additionalContext.includes('Localizable'));

    const weappPrompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '微信小程序这个页面按钮点了没反应，直接帮我修一下并验证。',
    });
    assert.equal(weappPrompt.continue, true);
    assert.ok(weappPrompt.hookSpecificOutput.additionalContext.includes('本地小程序运行态验证'));
    assert.ok(weappPrompt.hookSpecificOutput.additionalContext.includes('不要为了验证自动重开应用'));
    assert.equal(weappPrompt.hookSpecificOutput.additionalContext.includes('weapp-dev-mcp'), false);
    const weappPatch = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: miniprogram/pages/index.js\n@@\n+// fix tap handler\n*** End Patch',
    });
    assert.equal(weappPatch.continue, true);
    const stopReminder = runCodexHook(project, 'Stop', {});
    assert.equal(stopReminder.continue, true);
    assert.ok(stopReminder.hookSpecificOutput.additionalContext.includes('小程序运行态验证仍未完成'));
    assert.equal(stopReminder.hookSpecificOutput.additionalContext.includes('weapp-dev-mcp'), false);
    const weappCopyPrompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '把微信小程序首页按钮文案改短一点。',
    });
    assert.equal(weappCopyPrompt.continue, true);
    assert.equal(weappCopyPrompt.hookSpecificOutput.additionalContext.includes('本地小程序运行态验证'), false);
    const copyStopReminder = runCodexHook(project, 'Stop', {});
    assert.equal(copyStopReminder.continue, true);
    assert.equal(copyStopReminder.hookSpecificOutput?.additionalContext?.includes('小程序运行态验证仍未完成') ?? false, false);
  });

  test('Codex hook requires a visual evidence board for raw screenshot validation', async () => {
    const { project } = await makeCodexHookProject();
    await seedReadyFrontendDesignArtifacts(project);

    const prompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '把设置页面卡片间距调一下，并用 Computer 实测截图验证。',
    });
    assert.equal(prompt.continue, true);

    const patch = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: [
        '*** Begin Patch',
        '*** Update File: src/App.tsx',
        '@@',
        '+export const settingsCardGap = 12;',
        '*** End Patch',
      ].join('\n'),
    });
    assert.equal(patch.continue, true);

    const rawScreenshot = runCodexHook(project, 'PostToolUse', {
      tool_name: 'computer_screenshot',
      tool_input: { path: 'actual-settings.png' },
      tool_response: 'Computer 实测截图已保存 actual-settings.png',
    });
    assert.deepEqual(rawScreenshot, { continue: true });

    const missingBoardStop = runCodexHook(project, 'Stop', {});
    assert.equal(missingBoardStop.continue, true);
    assert.ok(missingBoardStop.hookSpecificOutput.additionalContext.includes('截图实测证据板'));
    assert.ok(missingBoardStop.hookSpecificOutput.additionalContext.includes('普通截图和 Computer 实测截图只能作为原始素材'));
    assert.ok(missingBoardStop.hookSpecificOutput.additionalContext.includes('verification-board.json'));

    const boardSignal = runCodexHook(project, 'PostToolUse', {
      tool_name: 'Bash',
      tool_input: {
        cmd: 'openprd visual-compare . --board verification-board.json --json',
      },
      tool_response: '{"mode":"verification-board","outputPath":".openprd/harness/visual-reviews/visual-verification-board-test.jpg"}',
    });
    assert.deepEqual(boardSignal, { continue: true });

    const afterBoardStop = runCodexHook(project, 'Stop', {});
    assert.equal(afterBoardStop.continue, true);
    assert.equal(
      afterBoardStop.hookSpecificOutput?.additionalContext.includes('普通截图和 Computer 实测截图只能作为原始素材') ?? false,
      false
    );
  });

  test('Stop hook reminds about project-level closeout when final verification artifacts are missing', async () => {
    const project = await makeTempProject();
    await initWorkspace(project, { templatePack: 'consumer' });
    await fs.mkdir(path.join(project, 'src'), { recursive: true });
    await fs.writeFile(path.join(project, 'src', 'closeout.js'), 'export const closeout = true;\n');
    await fs.writeFile(path.join(project, '.openprd', 'harness', 'turn-state.json'), `${JSON.stringify({
      version: 1,
      prompt: '继续把这轮实现完整收口。',
      touchedFiles: ['src/closeout.js'],
      reviewSignals: [
        {
          id: 'loop-finish-signal',
          kind: 'loop-finish',
          ok: true,
          summary: 'task scoped evidence is ready',
          touchedFiles: ['src/closeout.js'],
        },
      ],
    }, null, 2)}\n`);

    const stop = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), 'Stop'], {
      cwd: project,
      input: JSON.stringify({ cwd: project, hook_event_name: 'Stop' }),
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENPRD_CLI: path.resolve('openprd/bin/openprd.js'),
      },
    });
    assert.equal(stop.status, 0);
    const payload = JSON.parse(stop.stdout);
    const context = payload.hookSpecificOutput.additionalContext;
    assert.match(context, /项目级收口证据还没补齐/);
    assert.match(context, /openprd quality \. --verify/);
    assert.match(context, /openprd run \. --verify/);
    assert.match(context, /Markdown \/ HTML 测试报告/);
  });
});
