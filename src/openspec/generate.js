import fs from 'node:fs/promises';
import path from 'node:path';
import { detectPrimaryLanguage, isChineseLocale, preferUserLanguage } from '../language-policy.js';
import { needsBusinessGuardrails } from '../prd-core.js';
import { EXECUTION_STRATEGY_METADATA_KEYS, formatTaskExecutionStrategyMetadata } from '../execution-strategy.js';
import { TEST_STRATEGY_METADATA_KEYS, formatTaskTestStrategyMetadata } from '../test-strategy.js';
import { OPENSPEC_TASK_MAX_ITEMS_PER_FILE } from './constants.js';
import { openPrdChangeRoot, openPrdDiscoveryConfigPath, readDiscoveryConfig } from './paths.js';

function cjoin(...parts) {
  return path.join(...parts);
}

function exists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function readJson(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text);
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function slugify(value, fallback = 'item') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function scalar(value, fallback = '待补充') {
  if (value === null || value === undefined) {
    return fallback;
  }
  const text = String(value).trim();
  return text || fallback;
}

const OPENSPEC_COPY = {
  zh: {
    tbd: '待补充',
    proposalReason: '## 背景与原因',
    proposalChanges: '## 变更内容',
    proposalCapability: '## 能力范围',
    proposalImpact: '## 影响范围',
    designTitle: '# 设计',
    background: '## 背景',
    goals: '## 目标',
    scope: '## 范围',
    constraints: '## 约束',
    businessGuardrails: '## 业务护栏',
    risksAndQuestions: '## 风险与开放问题',
    generatedReason: '需要把当前产品需求转化为可执行的规格变更。',
    generatedChange: '根据当前 PRD 生成 OpenPrd 管理的规格增量。',
    productBehavior: '产品行为',
    capabilitySuffix: '需求。',
    primaryUserPrefix: '主要用户',
    costDriverPrefix: '成本来源',
    usageLimitPrefix: '额度限制',
    dependencyPrefix: '依赖',
    riskPrefix: '风险',
    agentCanContinue: 'Agent 可以通过 OpenPrd 从 PRD 继续推进到 specs、tasks、validation 和 execution。',
    generatedFromSnapshot: '根据最新 OpenPrd 快照生成。',
    abusePreventionPrefix: '滥用防护',
    monitoringSignalPrefix: '监控信号',
    alertThresholdPrefix: '报警阈值',
    stopLossPrefix: '止损动作',
    assumptionPrefix: '假设',
    questionPrefix: '问题',
    currentBehavior: '当前 PRD 描述的产品行为',
    generatedBehavior: '生成的能力应保持最新 OpenPrd 快照描述的行为。',
    mainFlow: '主要用户完成主流程',
    acceptanceSatisfied: '预期产品结果得到满足',
    edgeCase: '出现边界情况',
    failureMode: '出现失败模式',
    requirementsTitle: '## 新增需求',
    requirementPrefix: '### 需求',
    scenarioSuccess: '#### 场景：主流程成功',
    scenarioEdge: '#### 场景：边界情况保持可见',
    scenarioFailure: '#### 场景：失败模式得到处理',
    when: '当',
    then: '则',
    edgeThen: '产品应保持该情况明确可见，以支持实现和验证',
    failureThen: '产品应提供有边界且可评审的结果',
    implementationFallback: '补齐当前需求实现',
    implementationPrefix: '实现',
    verificationFallback: '验证当前需求闭环',
    verificationPrefix: '验证',
    currentRequirementLoop: '当前需求闭环',
    donePrefix: '已完成：',
    verifiedPrefix: '已验证：',
    involvedPrefix: '涉及',
    specReviewTitle: '评审生成的 spec 覆盖',
    specReviewDone: (capability) => `生成的 ${capability} spec 符合 PRD 意图`,
    docsTitle: '维护 docs/basic 项目基础文档',
    docsDone: '已检查 docs/basic 是否缺失或因本次需求、流程、结构、依赖、产品行为变化而过期；若涉及后端、脚本、Agent 或工具链变更，已同步评估 CLI 与 API 接入面，并在 backend-structure.md 中记录事实或不适用原因；需要更新的基础文档已同步',
    manualsTitle: '更新文件说明书和文件夹 README',
    manualsDone: '本次变更涉及的文件说明书和文件夹 README 已检查；缺失的已补齐，过期的已更新',
    finalValidateTitle: '运行 OpenPrd spec 校验',
    finalValidateDone: '生成的 change 通过 OpenPrd 校验',
    tasksTitle: '# 任务',
    continueWith: (fileName) => `Continue with \`${fileName}\` after completing this file.`,
    nonFunctionalPrefix: '回归非功能约束',
    nonFunctionalDone: '非功能约束已经回归确认。',
    edgePrefix: '边界情况',
    failurePrefix: '失败处理',
    edgeFailurePrefix: '回归边界条件与失败处理',
    edgeFailureDone: '边界条件与失败处理已经回归确认。',
    flowIntegrationPrefix: '打通主流程闭环',
    flowIntegrationDone: '主流程关键节点已经打通，用户可以按预期从入口走到结果收尾。',
    guardrailUsageTitle: '验证成本与额度护栏',
    guardrailUsageDone: '已验证免费、试用或低权限用户不能绕过额度、并发、频率或总量限制',
    guardrailAbuseTitle: '验证滥用与越权路径',
    guardrailAbuseDone: '已覆盖重复请求、并发请求、越权身份和异常恢复等负向场景',
    guardrailMonitoringTitle: '验证成本监控、报警和止损',
    guardrailMonitoringDone: '已确认用量或成本信号、报警阈值和人工/自动止损动作可执行',
    architecture: {
      shared: ['对齐共享契约与 Host API 调用边界', '共享契约、Host API 和上下游调用边界已经对齐，后续功能可以直接接线。'],
      domain: ['补齐领域服务、数据读取与状态同步', '领域服务、数据读取和状态同步已经接通，界面不会停留在假可见状态。'],
      main: ['补齐主进程、窗口与后台接线', '主进程事件、窗口入口或后台能力的接线已经补齐，不会因为运行时边界遗漏而失效。'],
      renderer: ['接通界面入口、导航与页面挂载', '用户可以从正确入口进入对应界面，页面挂载与状态收尾已经接通。'],
      diagnostics: ['补齐日志、诊断与可观测性信号', '关键阶段日志和诊断信号已经保留，后续排查可以直接定位到断点。'],
    },
  },
  en: {
    tbd: 'TBD',
    proposalReason: '## Background And Rationale',
    proposalChanges: '## Change Scope',
    proposalCapability: '## Capability Scope',
    proposalImpact: '## Impact',
    designTitle: '# Design',
    background: '## Background',
    goals: '## Goals',
    scope: '## Scope',
    constraints: '## Constraints',
    businessGuardrails: '## Business Guardrails',
    risksAndQuestions: '## Risks And Open Questions',
    generatedReason: 'Convert the current product requirement into an executable spec change.',
    generatedChange: 'Generate an OpenPrd-managed spec increment from the current PRD.',
    productBehavior: 'product behavior',
    capabilitySuffix: 'requirement.',
    primaryUserPrefix: 'Primary user',
    costDriverPrefix: 'Cost driver',
    usageLimitPrefix: 'Usage limit',
    dependencyPrefix: 'Dependency',
    riskPrefix: 'Risk',
    agentCanContinue: 'The agent can use OpenPrd to continue from PRD into specs, tasks, validation, and execution.',
    generatedFromSnapshot: 'Generated from the latest OpenPrd snapshot.',
    abusePreventionPrefix: 'Abuse prevention',
    monitoringSignalPrefix: 'Monitoring signal',
    alertThresholdPrefix: 'Alert threshold',
    stopLossPrefix: 'Stop-loss action',
    assumptionPrefix: 'Assumption',
    questionPrefix: 'Question',
    currentBehavior: 'the product behavior described by the current PRD',
    generatedBehavior: 'The generated capability should preserve the behavior described by the latest OpenPrd snapshot.',
    mainFlow: 'the primary user completes the main flow',
    acceptanceSatisfied: 'the expected product outcome is satisfied',
    edgeCase: 'an edge case occurs',
    failureMode: 'a failure mode occurs',
    requirementsTitle: '## New Requirements',
    requirementPrefix: '### Requirement',
    scenarioSuccess: '#### Scenario: Main Flow Succeeds',
    scenarioEdge: '#### Scenario: Edge Case Stays Visible',
    scenarioFailure: '#### Scenario: Failure Mode Is Handled',
    when: 'When',
    then: 'Then',
    edgeThen: 'the product should keep the condition visible so implementation and verification can review it',
    failureThen: 'the product should provide a bounded and reviewable result',
    implementationFallback: 'Complete the current requirement implementation',
    implementationPrefix: 'Implement',
    verificationFallback: 'Verify the current requirement loop',
    verificationPrefix: 'Verify',
    currentRequirementLoop: 'current requirement loop',
    donePrefix: 'Done: ',
    verifiedPrefix: 'Verified: ',
    involvedPrefix: 'Involves',
    specReviewTitle: 'Review Generated Spec Coverage',
    specReviewDone: (capability) => `The generated ${capability} spec matches the PRD intent`,
    docsTitle: 'Maintain docs/basic Project Docs',
    docsDone: 'docs/basic has been checked for missing or stale content caused by this requirement, flow, structure, dependency, or product behavior change; backend, script, agent, or toolchain changes have been reflected in backend-structure.md or marked not applicable.',
    manualsTitle: 'Update File Manuals And Folder READMEs',
    manualsDone: 'Affected file manuals and folder READMEs have been checked; missing docs were added and stale docs were updated',
    finalValidateTitle: 'Run OpenPrd Spec Validation',
    finalValidateDone: 'The generated change passes OpenPrd validation',
    tasksTitle: '# Tasks',
    continueWith: (fileName) => `Continue with \`${fileName}\` after completing this file.`,
    nonFunctionalPrefix: 'Regress Non-Functional Constraints',
    nonFunctionalDone: 'Non-functional constraints have been regression-checked.',
    edgePrefix: 'Edge case',
    failurePrefix: 'Failure handling',
    edgeFailurePrefix: 'Regress Edge Cases And Failure Handling',
    edgeFailureDone: 'Edge cases and failure handling have been regression-checked.',
    flowIntegrationPrefix: 'Wire Main Flow End To End',
    flowIntegrationDone: 'Main flow checkpoints have been wired so users can reach the expected result.',
    guardrailUsageTitle: 'Verify Cost And Quota Guardrails',
    guardrailUsageDone: 'Free, trial, or low-privilege users cannot bypass quota, concurrency, frequency, or total-usage limits',
    guardrailAbuseTitle: 'Verify Abuse And Privilege Escalation Paths',
    guardrailAbuseDone: 'Duplicate requests, concurrent requests, privilege escalation, and abnormal recovery paths are covered',
    guardrailMonitoringTitle: 'Verify Cost Monitoring, Alerts, And Stop-Loss',
    guardrailMonitoringDone: 'Usage or cost signals, alert thresholds, and manual or automatic stop-loss actions are executable',
    architecture: {
      shared: ['Align Shared Contracts And Host API Boundaries', 'Shared contracts, Host API calls, and upstream/downstream boundaries are aligned so follow-on work can wire directly.'],
      domain: ['Complete Domain Services, Data Reads, And State Sync', 'Domain services, data reads, and state sync are wired so the UI does not stay in a fake-visible state.'],
      main: ['Wire Main Process, Windows, And Background Runtime', 'Main-process events, window entry points, or background capabilities are wired without runtime-boundary gaps.'],
      renderer: ['Wire UI Entry Points, Navigation, And Page Mounting', 'Users can enter the correct UI and page mounting plus state closeout are wired.'],
      diagnostics: ['Add Logs, Diagnostics, And Observability Signals', 'Key-stage logs and diagnostics signals are retained so future debugging can locate the breakpoints.'],
    },
  },
};

function copyForLocale(locale) {
  return isChineseLocale(locale) ? OPENSPEC_COPY.zh : OPENSPEC_COPY.en;
}

function resolveSnapshotLocale(snapshot) {
  const sections = snapshot.sections ?? {};
  return detectPrimaryLanguage([
    snapshot.locale,
    snapshot.language,
    snapshot.title,
    sections.problem?.problemStatement,
    sections.problem?.whyNow,
    ...(arrayValue(sections.goals?.goals)),
    ...(arrayValue(sections.scope?.inScope)),
    ...(arrayValue(sections.requirements?.functional)),
    ...(arrayValue(sections.scenarios?.primaryFlows)),
  ], snapshot.locale ?? snapshot.language);
}

function arrayValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => scalar(item, '')).filter(Boolean);
  }
  if (value === null || value === undefined || String(value).trim() === '') {
    return [];
  }
  return [String(value).trim()];
}

function bullets(items, fallback = ['待补充']) {
  const values = arrayValue(items);
  return (values.length > 0 ? values : fallback).map((item) => `- ${item}`).join('\n');
}

function safeRequirementTitle(value, fallback) {
  return scalar(value, fallback).replace(/\s+/g, ' ').slice(0, 120);
}

function trimTaskText(value) {
  return scalar(value, '')
    .replace(/\s+/g, ' ')
    .replace(/[。；;，,]+$/g, '')
    .trim();
}

function normalizeTaskSemanticKey(value) {
  return trimTaskText(value)
    .toLowerCase()
    .replace(/[。，“”"'`~!@#$%^&*()_+=\-[\]{}|\\;:,.<>/?、]/g, ' ')
    .replace(/\b(users?|system|current|primary|flow|requirement|acceptance|non functional|non-functional)\b/g, ' ')
    .replace(/(用户|系统|当前|主工作树|至少|已经|完成|提供|新增|展示|支持|查看|看到|可以|能够|需要|实现|验证|回归|打通|落地|接通|补齐|对齐|并且|以及|中的|基础|首版|可见|目标|要求)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeTaskItems(items, limit = 2, maxLength = 56, locale = 'zh-CN') {
  const copy = copyForLocale(locale);
  const values = arrayValue(items).map((item) => trimTaskText(item)).filter(Boolean);
  if (values.length === 0) {
    return copy.currentRequirementLoop;
  }
  const shown = [];
  for (const item of values) {
    const candidate = [...shown, item].join(' / ');
    if (shown.length >= limit || candidate.length > maxLength) {
      break;
    }
    shown.push(item);
  }
  if (shown.length === 0) {
    shown.push(values[0].slice(0, maxLength));
  }
  return values.length > shown.length ? `${shown.join(' / ')} 等 ${values.length} 项` : shown.join(' / ');
}

function buildDoneText(prefix, item) {
  return `${prefix}${trimTaskText(item)}`;
}

function cleanImplementationTitle(item, locale = 'zh-CN') {
  const copy = copyForLocale(locale);
  const text = trimTaskText(item)
    .replace(/^系统需要/g, '')
    .replace(/^系统应/g, '')
    .replace(/^系统会/g, '')
    .replace(/^系统/g, '')
    .replace(/^需要/g, '')
    .replace(/^当前主工作树中/g, '')
    .trim();
  if (!text) {
    return copy.implementationFallback;
  }
  if (/^(在|提供|保留|展示|支持|完成|补齐|同步|避免|接入|接通|收口|更新|修复|统一)/.test(text)) {
    return text;
  }
  if (/^(Add|Apply|Build|Collect|Create|Deny|Display|Expose|Fetch|Handle|Implement|Keep|Load|Manage|Persist|Port|Prepare|Prevent|Protect|Record|Refresh|Render|Reuse|Route|Return|Save|Show|Submit|Support|Sync|Track|Update|Validate|Wire)/i.test(text)) {
    return text;
  }
  return isChineseLocale(locale) ? `${copy.implementationPrefix}${text}` : `${copy.implementationPrefix} ${text}`;
}

function buildVerificationTitle(item, locale = 'zh-CN') {
  const copy = copyForLocale(locale);
  const text = trimTaskText(item);
  if (!text) {
    return copy.verificationFallback;
  }
  if (/^(验证|回归|确认|检查|Compare|Verify|Test|Review)/i.test(text)) {
    return text;
  }
  return isChineseLocale(locale) ? `${copy.verificationPrefix}${text}` : `${copy.verificationPrefix} ${text}`;
}

function chunkItems(items, maxItemsPerChunk = 2) {
  const chunks = [];
  for (let index = 0; index < items.length; index += maxItemsPerChunk) {
    chunks.push(items.slice(index, index + maxItemsPerChunk));
  }
  return chunks;
}

function defaultTaskVerifyCommand(changeId, task) {
  if (task.type === 'documentation') {
    return 'openprd standards . --verify';
  }
  return `openprd tasks . --change ${changeId} --item ${task.id} --evidence-required`;
}

const ARCHITECTURE_TASK_DEFINITIONS = [
  {
    key: 'shared-contracts',
    copyKey: 'shared',
    pattern: /(shared contracts?|host methods?|host api|ipc|preload|schema|contract|entitlement|接口约定|共享契约|契约|协议|类型)/i,
    title: '对齐共享契约与 Host API 调用边界',
    done: '共享契约、Host API 和上下游调用边界已经对齐，后续功能可以直接接线。',
  },
  {
    key: 'domain-data',
    copyKey: 'domain',
    pattern: /(domain|service|gateway|adapter|repository|storage|snapshot|backend|billing|orders?|entitlement|sync|cache|状态快照|领域服务|网关|适配器|仓储|后端|订单|会员|额度|数据)/i,
    title: '补齐领域服务、数据读取与状态同步',
    done: '领域服务、数据读取和状态同步已经接通，界面不会停留在假可见状态。',
  },
  {
    key: 'main-runtime',
    copyKey: 'main',
    pattern: /(main process|electron main|main\b|window|daemon|tray|主进程|窗口|守护|后台)/i,
    title: '补齐主进程、窗口与后台接线',
    done: '主进程事件、窗口入口或后台能力的接线已经补齐，不会因为运行时边界遗漏而失效。',
  },
  {
    key: 'renderer-surface',
    copyKey: 'renderer',
    pattern: /(renderer|view|ui|route|navigation|page|dialog|modal|surface|sidebar|entry|renderer 入口|界面|页面|弹窗|弹层|入口|导航|菜单|路由|侧边栏)/i,
    title: '接通界面入口、导航与页面挂载',
    done: '用户可以从正确入口进入对应界面，页面挂载与状态收尾已经接通。',
  },
  {
    key: 'diagnostics',
    copyKey: 'diagnostics',
    pattern: /(diagnostic|log|logging|trace|telemetry|monitor|诊断|日志|追踪|监控|埋点)/i,
    title: '补齐日志、诊断与可观测性信号',
    done: '关键阶段日志和诊断信号已经保留，后续排查可以直接定位到断点。',
  },
];

function resolveCapability(snapshot) {
  const productType = slugify(snapshot.productType ?? snapshot.templatePack ?? 'product', 'product');
  return `${productType}-requirements`;
}

function buildProposal({ changeId, capability, snapshot }) {
  const locale = resolveSnapshotLocale(snapshot);
  const copy = copyForLocale(locale);
  const sections = snapshot.sections ?? {};
  return [
    `# ${scalar(snapshot.title, changeId)}`,
    '',
    copy.proposalReason,
    '',
    scalar(sections.problem?.problemStatement, copy.generatedReason),
    '',
    copy.proposalChanges,
    '',
    bullets([
      ...arrayValue(sections.scope?.inScope),
      ...arrayValue(sections.requirements?.functional),
      ...arrayValue(sections.goals?.acceptanceGoals),
    ], [copy.generatedChange]),
    '',
    copy.proposalCapability,
    '',
    `- \`${capability}\`: ${scalar(snapshot.title, copy.productBehavior)} ${copy.capabilitySuffix}`,
    '',
    copy.proposalImpact,
    '',
    bullets([
      ...arrayValue(sections.users?.primaryUsers).map((item) => `${copy.primaryUserPrefix}: ${item}`),
      ...arrayValue(sections.businessGuardrails?.costDrivers).map((item) => `${copy.costDriverPrefix}: ${item}`),
      ...arrayValue(sections.businessGuardrails?.usageLimits).map((item) => `${copy.usageLimitPrefix}: ${item}`),
      ...arrayValue(sections.constraints?.dependencies).map((item) => `${copy.dependencyPrefix}: ${item}`),
      ...arrayValue(sections.risks?.risks).map((item) => `${copy.riskPrefix}: ${item}`),
    ], [copy.agentCanContinue]),
    '',
  ].join('\n');
}

function buildDesign({ snapshot }) {
  const locale = resolveSnapshotLocale(snapshot);
  const copy = copyForLocale(locale);
  const sections = snapshot.sections ?? {};
  return [
    copy.designTitle,
    '',
    copy.background,
    '',
    scalar(sections.problem?.whyNow, copy.generatedFromSnapshot),
    '',
    copy.goals,
    '',
    bullets(sections.goals?.goals),
    '',
    copy.scope,
    '',
    bullets(sections.scope?.inScope),
    '',
    copy.constraints,
    '',
    bullets([
      ...arrayValue(sections.constraints?.technical),
      ...arrayValue(sections.constraints?.compliance),
      ...arrayValue(sections.constraints?.dependencies),
    ]),
    '',
    copy.businessGuardrails,
    '',
    bullets([
      ...arrayValue(sections.businessGuardrails?.costDrivers).map((item) => `${copy.costDriverPrefix}: ${item}`),
      ...arrayValue(sections.businessGuardrails?.usageLimits).map((item) => `${copy.usageLimitPrefix}: ${item}`),
      ...arrayValue(sections.businessGuardrails?.abusePrevention).map((item) => `${copy.abusePreventionPrefix}: ${item}`),
      ...arrayValue(sections.businessGuardrails?.monitoringSignals).map((item) => `${copy.monitoringSignalPrefix}: ${item}`),
      ...arrayValue(sections.businessGuardrails?.alertThresholds).map((item) => `${copy.alertThresholdPrefix}: ${item}`),
      ...arrayValue(sections.businessGuardrails?.stopLossActions).map((item) => `${copy.stopLossPrefix}: ${item}`),
    ]),
    '',
    copy.risksAndQuestions,
    '',
    bullets([
      ...arrayValue(sections.risks?.assumptions).map((item) => `${copy.assumptionPrefix}: ${item}`),
      ...arrayValue(sections.risks?.risks).map((item) => `${copy.riskPrefix}: ${item}`),
      ...arrayValue(sections.risks?.openQuestions).map((item) => `${copy.questionPrefix}: ${item}`),
    ]),
    '',
  ].join('\n');
}

export function buildSpec({ snapshot }) {
  const locale = resolveSnapshotLocale(snapshot);
  const copy = copyForLocale(locale);
  const sections = snapshot.sections ?? {};
  const title = safeRequirementTitle(
    preferUserLanguage(snapshot.title, locale, { zh: copy.currentBehavior, en: copy.currentBehavior }),
    copy.currentBehavior,
  );
  const acceptanceSource = arrayValue(sections.goals?.acceptanceGoals)[0]
    ?? arrayValue(sections.requirements?.functional)[0];
  const flow = preferUserLanguage(arrayValue(sections.scenarios?.primaryFlows)[0], locale, { zh: copy.mainFlow, en: copy.mainFlow });
  const acceptance = preferUserLanguage(acceptanceSource, locale, { zh: copy.acceptanceSatisfied, en: copy.acceptanceSatisfied });
  const edgeCase = preferUserLanguage(arrayValue(sections.scenarios?.edgeCases)[0], locale, { zh: copy.edgeCase, en: copy.edgeCase });
  const failureMode = preferUserLanguage(arrayValue(sections.scenarios?.failureModes)[0], locale, { zh: copy.failureMode, en: copy.failureMode });
  const headingSeparator = isChineseLocale(locale) ? '：' : ': ';

  return [
    copy.requirementsTitle,
    '',
    `${copy.requirementPrefix}${headingSeparator}${title}`,
    preferUserLanguage(sections.problem?.problemStatement, locale, { zh: copy.generatedBehavior, en: copy.generatedBehavior }),
    '',
    copy.scenarioSuccess,
    `- **${copy.when}** ${flow}`,
    `- **${copy.then}** ${acceptance}`,
    '',
    copy.scenarioEdge,
    `- **${copy.when}** ${edgeCase}`,
    `- **${copy.then}** ${copy.edgeThen}`,
    '',
    copy.scenarioFailure,
    `- **${copy.when}** ${failureMode}`,
    `- **${copy.then}** ${copy.failureThen}`,
    '',
  ].join('\n');
}

function inferArchitectureTasks(snapshot, locale = resolveSnapshotLocale(snapshot)) {
  const copy = copyForLocale(locale);
  const sections = snapshot.sections ?? {};
  const lines = [
    ...arrayValue(sections.constraints?.technical),
    ...arrayValue(sections.constraints?.dependencies),
  ];
  if (lines.length === 0) {
    return [];
  }

  return ARCHITECTURE_TASK_DEFINITIONS
    .map((definition, index) => ({
      definition,
      index,
      matches: lines.filter((line) => definition.pattern.test(line)),
    }))
    .filter((item) => item.matches.length > 0)
    .sort((left, right) => right.matches.length - left.matches.length || left.index - right.index)
    .map(({ definition, matches }) => ({
      key: definition.key,
      type: 'implementation',
      title: copy.architecture[definition.copyKey]?.[0] ?? definition.title,
      done: `${copy.architecture[definition.copyKey]?.[1] ?? definition.done} ${copy.involvedPrefix}: ${summarizeTaskItems(matches, 2, 72, locale)}。`,
      phase: 'architecture',
    }));
}

function buildRequirementImplementationTasks(snapshot, locale = resolveSnapshotLocale(snapshot)) {
  const copy = copyForLocale(locale);
  const sections = snapshot.sections ?? {};
  const sourceItems = arrayValue(sections.requirements?.functional);
  const fallbackScopeItems = arrayValue(sections.scope?.inScope);
  const implementationItems = sourceItems.length > 0 ? sourceItems : fallbackScopeItems;
  const tasks = [];
  const seen = new Set();

  for (const item of implementationItems) {
    const key = normalizeTaskSemanticKey(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    tasks.push({
      key,
      type: 'implementation',
      title: cleanImplementationTitle(item, locale),
      done: buildDoneText(copy.donePrefix, item),
      phase: 'implementation',
    });
  }

  return tasks;
}

function buildFlowIntegrationTasks(snapshot, locale = resolveSnapshotLocale(snapshot)) {
  const copy = copyForLocale(locale);
  const sections = snapshot.sections ?? {};
  const flows = arrayValue(sections.scenarios?.primaryFlows);
  if (flows.length === 0) {
    return [];
  }
  return [{
    key: `integration:${summarizeTaskItems(flows, 2, 48, locale)}`,
    type: 'implementation',
    title: `${copy.flowIntegrationPrefix}${isChineseLocale(locale) ? '：' : ': '}${summarizeTaskItems(flows, 2, 56, locale)}`,
    done: `${copy.flowIntegrationDone} ${copy.involvedPrefix}: ${summarizeTaskItems(flows, 2, 72, locale)}。`,
    phase: 'integration',
  }];
}

function buildAcceptanceVerificationTasks(snapshot, locale = resolveSnapshotLocale(snapshot)) {
  const copy = copyForLocale(locale);
  const sections = snapshot.sections ?? {};
  return arrayValue(sections.goals?.acceptanceGoals).map((item) => ({
    key: `acceptance:${normalizeTaskSemanticKey(item)}`,
    type: 'verification',
    title: buildVerificationTitle(item, locale),
    done: buildDoneText(copy.verifiedPrefix, item),
    phase: 'verification',
  }));
}

function buildNonFunctionalVerificationTasks(snapshot, locale = resolveSnapshotLocale(snapshot)) {
  const copy = copyForLocale(locale);
  const sections = snapshot.sections ?? {};
  const nonFunctionalChunks = chunkItems(arrayValue(sections.requirements?.nonFunctional), 2).map((items, index) => ({
    key: `non-functional:${index}:${summarizeTaskItems(items, 2, 36, locale)}`,
    type: 'verification',
    title: `${copy.nonFunctionalPrefix}${isChineseLocale(locale) ? '：' : ': '}${summarizeTaskItems(items, 2, 56, locale)}`,
    done: `${copy.nonFunctionalDone} ${copy.involvedPrefix}: ${summarizeTaskItems(items, 2, 72, locale)}。`,
    phase: 'verification',
  }));
  const edgeAndFailure = [
    ...arrayValue(sections.scenarios?.edgeCases).map((item) => `${copy.edgePrefix}${isChineseLocale(locale) ? '：' : ': '}${trimTaskText(item)}`),
    ...arrayValue(sections.scenarios?.failureModes).map((item) => `${copy.failurePrefix}${isChineseLocale(locale) ? '：' : ': '}${trimTaskText(item)}`),
  ];
  const edgeTasks = edgeAndFailure.length > 0
    ? [{
        key: `edge:${summarizeTaskItems(edgeAndFailure, 2, 36, locale)}`,
        type: 'verification',
        title: `${copy.edgeFailurePrefix}${isChineseLocale(locale) ? '：' : ': '}${summarizeTaskItems(edgeAndFailure, 2, 56, locale)}`,
        done: `${copy.edgeFailureDone} ${copy.involvedPrefix}: ${summarizeTaskItems(edgeAndFailure, 2, 72, locale)}。`,
        phase: 'verification',
      }]
    : [];
  return [...nonFunctionalChunks, ...edgeTasks];
}

function buildTaskItems({ changeId, snapshot, capability }) {
  const locale = resolveSnapshotLocale(snapshot);
  const copy = copyForLocale(locale);
  const candidates = [
    {
      key: 'governance:spec-review',
      type: 'governance',
      title: copy.specReviewTitle,
      done: copy.specReviewDone(capability),
      verify: `openprd change . --validate --change ${changeId}`,
      phase: 'governance-start',
    },
    ...inferArchitectureTasks(snapshot, locale),
    ...buildRequirementImplementationTasks(snapshot, locale),
    ...buildFlowIntegrationTasks(snapshot, locale),
    ...buildAcceptanceVerificationTasks(snapshot, locale),
    ...buildNonFunctionalVerificationTasks(snapshot, locale),
    ...(needsBusinessGuardrails(snapshot)
      ? [
          {
            key: 'verification:guardrail-usage',
            type: 'verification',
            title: copy.guardrailUsageTitle,
            done: copy.guardrailUsageDone,
            phase: 'verification',
          },
          {
            key: 'verification:guardrail-abuse',
            type: 'verification',
            title: copy.guardrailAbuseTitle,
            done: copy.guardrailAbuseDone,
            phase: 'verification',
          },
          {
            key: 'verification:guardrail-monitoring',
            type: 'verification',
            title: copy.guardrailMonitoringTitle,
            done: copy.guardrailMonitoringDone,
            phase: 'verification',
          },
        ]
      : []),
    {
      key: 'documentation:docs-basic',
      type: 'documentation',
      title: copy.docsTitle,
      done: copy.docsDone,
      verify: 'openprd standards . --verify',
      phase: 'documentation',
    },
    {
      key: 'documentation:manuals',
      type: 'documentation',
      title: copy.manualsTitle,
      done: copy.manualsDone,
      verify: 'openprd standards . --verify',
      phase: 'documentation',
    },
    {
      key: 'governance:final-validate',
      type: 'governance',
      title: copy.finalValidateTitle,
      done: copy.finalValidateDone,
      verify: `openprd change . --validate --change ${changeId}`,
      phase: 'governance-end',
    },
  ];

  const deduped = [];
  const seen = new Set();
  for (const item of candidates) {
    const { key, title } = item;
    const dedupeKey = key ?? `${item.phase}:${normalizeTaskSemanticKey(title)}`;
    if (!dedupeKey) {
      continue;
    }
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    deduped.push(item);
  }

  const tasks = deduped.map((item, index) => {
    const task = {
      id: `T001.${String(index + 1).padStart(2, '0')}`,
      title: item.title,
      type: item.type,
      phase: item.phase,
      done: item.done,
      deps: [],
    };
    task.verify = item.verify ?? defaultTaskVerifyCommand(changeId, task);
    return task;
  });

  const phaseTasks = {
    governanceStart: tasks.filter((task) => task.phase === 'governance-start'),
    architecture: tasks.filter((task) => task.phase === 'architecture'),
    implementation: tasks.filter((task) => task.phase === 'implementation'),
    integration: tasks.filter((task) => task.phase === 'integration'),
    verification: tasks.filter((task) => task.phase === 'verification'),
    documentation: tasks.filter((task) => task.phase === 'documentation'),
    governanceEnd: tasks.filter((task) => task.phase === 'governance-end'),
  };

  const anchorTask = phaseTasks.governanceStart.at(-1) ?? null;
  let previousId = anchorTask?.id ?? null;
  for (const task of phaseTasks.architecture) {
    task.deps = previousId ? [previousId] : [];
    previousId = task.id;
  }

  const implementationAnchor = previousId ?? anchorTask?.id ?? null;
  previousId = implementationAnchor;
  for (const task of phaseTasks.implementation) {
    task.deps = previousId ? [previousId] : [];
    previousId = task.id;
  }

  const integrationAnchor = previousId ?? implementationAnchor ?? anchorTask?.id ?? null;
  previousId = integrationAnchor;
  for (const task of phaseTasks.integration) {
    task.deps = previousId ? [previousId] : [];
    previousId = task.id;
  }

  const verificationAnchor = previousId ?? integrationAnchor ?? implementationAnchor ?? anchorTask?.id ?? null;
  previousId = verificationAnchor;
  for (const task of phaseTasks.verification) {
    task.deps = previousId ? [previousId] : [];
    previousId = task.id;
  }

  const documentationAnchor = previousId ?? verificationAnchor ?? integrationAnchor ?? implementationAnchor ?? anchorTask?.id ?? null;
  previousId = documentationAnchor;
  for (const task of phaseTasks.documentation) {
    task.deps = previousId ? [previousId] : [];
    previousId = task.id;
  }

  const governanceEndAnchor = previousId ?? documentationAnchor ?? verificationAnchor ?? integrationAnchor ?? implementationAnchor ?? anchorTask?.id ?? null;
  previousId = governanceEndAnchor;
  for (const task of phaseTasks.governanceEnd) {
    task.deps = previousId ? [previousId] : [];
    previousId = task.id;
  }

  return tasks.map(({ phase, ...task }) => task);
}

function taskFileName(index) {
  return index === 0 ? 'tasks.md' : `tasks-${String(index + 1).padStart(3, '0')}.md`;
}

function renderTaskFiles(tasks, maxItemsPerFile, locale = 'zh-CN') {
  const copy = copyForLocale(locale);
  const chunks = [];
  for (let index = 0; index < tasks.length; index += maxItemsPerFile) {
    chunks.push(tasks.slice(index, index + maxItemsPerFile));
  }

  return chunks.map((chunk, chunkIndex) => {
    const nextFileName = chunkIndex < chunks.length - 1 ? taskFileName(chunkIndex + 1) : null;
    const lines = [
      copy.tasksTitle,
      '',
    ];

    for (const task of chunk) {
      lines.push(`- [ ] ${task.id} ${task.title}`);
      lines.push(`  - type: ${task.type}`);
      if (task.deps.length > 0) {
        lines.push(`  - deps: ${task.deps.join(', ')}`);
      }
      lines.push(`  - done: ${task.done}`);
      lines.push(`  - verify: ${task.verify}`);
      for (const metadata of formatTaskTestStrategyMetadata(task)) {
        lines.push(`  - ${metadata}`);
      }
      for (const metadata of formatTaskExecutionStrategyMetadata(task)) {
        lines.push(`  - ${metadata}`);
      }
      lines.push('');
    }

    if (nextFileName) {
      lines.push(`- [ ] ${copy.continueWith(nextFileName)}`);
      lines.push('');
    }

    return {
      fileName: taskFileName(chunkIndex),
      text: lines.join('\n'),
    };
  });
}

async function readTaskMax(projectRoot) {
  const discoveryConfig = await readDiscoveryConfig(projectRoot, readJson);
  const maxItemsPerFile = Number(discoveryConfig?.taskSharding?.maxItemsPerFile ?? OPENSPEC_TASK_MAX_ITEMS_PER_FILE);
  return Number.isInteger(maxItemsPerFile) && maxItemsPerFile > 0 ? maxItemsPerFile : OPENSPEC_TASK_MAX_ITEMS_PER_FILE;
}

async function writeDiscoveryConfig(projectRoot, changeId) {
  const configPath = openPrdDiscoveryConfigPath(projectRoot);
  const current = await readJson(configPath).catch(() => ({}));
  const optionalMetadata = [
    'deps',
    'type',
    ...TEST_STRATEGY_METADATA_KEYS,
    ...EXECUTION_STRATEGY_METADATA_KEYS,
  ];
  await writeJson(configPath, {
    ...current,
    activeChange: changeId,
    taskSharding: {
      maxItemsPerFile: current?.taskSharding?.maxItemsPerFile ?? OPENSPEC_TASK_MAX_ITEMS_PER_FILE,
      handoffRequired: current?.taskSharding?.handoffRequired ?? true,
      firstFile: current?.taskSharding?.firstFile ?? 'tasks.md',
      nextFilePattern: current?.taskSharding?.nextFilePattern ?? 'tasks-###.md',
    },
    taskMetadata: {
      stableIdPattern: current?.taskMetadata?.stableIdPattern ?? 'T###.##',
      required: current?.taskMetadata?.required ?? ['done', 'verify'],
      optional: [...new Set([...(current?.taskMetadata?.optional ?? []), ...optionalMetadata])],
      dependencyOrder: current?.taskMetadata?.dependencyOrder ?? 'dependencies must appear before dependents',
    },
  });
}

export async function generateOpenSpecChangeWorkspace(projectRoot, options = {}) {
  const snapshot = options.snapshot;
  if (!snapshot) {
    throw new Error('生成 OpenPrd change 需要 PRD 快照。');
  }

  const changeId = slugify(options.change ?? snapshot.title, 'openprd-generated-change');
  const locale = resolveSnapshotLocale(snapshot);
  const capability = resolveCapability(snapshot);
  const changeDir = cjoin(openPrdChangeRoot(projectRoot), changeId);
  const files = [
    {
      path: cjoin(changeDir, '.openprd.yaml'),
      text: [
        'schema: openprd.change.v1',
        `generatedFrom: ${snapshot.versionId}`,
        '',
      ].join('\n'),
    },
    {
      path: cjoin(changeDir, 'proposal.md'),
      text: buildProposal({ changeId, capability, snapshot }),
    },
    {
      path: cjoin(changeDir, 'design.md'),
      text: buildDesign({ snapshot }),
    },
    {
      path: cjoin(changeDir, 'specs', capability, 'spec.md'),
      text: buildSpec({ snapshot }),
    },
  ];
  const tasks = buildTaskItems({ changeId, snapshot, capability });
  const taskFiles = renderTaskFiles(tasks, await readTaskMax(projectRoot), locale);

  for (const file of taskFiles) {
    files.push({
      path: cjoin(changeDir, file.fileName),
      text: file.text,
    });
  }

  const existing = [];
  for (const file of files) {
    if (await exists(file.path)) {
      existing.push(path.relative(projectRoot, file.path));
    }
  }
  if (existing.length > 0 && !options.force) {
    throw new Error(`OpenPrd change 已存在生成文件；请使用 --force 覆盖: ${existing.join(', ')}`);
  }

  for (const file of files) {
    await writeText(file.path, file.text);
  }
  await writeDiscoveryConfig(projectRoot, changeId);

  return {
    ok: true,
    projectRoot,
    changeId,
    changeDir,
    capability,
    files: files.map((file) => path.relative(projectRoot, file.path)),
    taskCount: tasks.length,
  };
}
