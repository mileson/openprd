import fs from 'node:fs/promises';
import path from 'node:path';
import { preferSimplifiedChinese } from '../language-policy.js';
import { needsBusinessGuardrails } from '../prd-core.js';
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

function summarizeTaskItems(items, limit = 2, maxLength = 56) {
  const values = arrayValue(items).map((item) => trimTaskText(item)).filter(Boolean);
  if (values.length === 0) {
    return '当前需求闭环';
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

function cleanImplementationTitle(item) {
  const text = trimTaskText(item)
    .replace(/^系统需要/g, '')
    .replace(/^系统应/g, '')
    .replace(/^系统会/g, '')
    .replace(/^系统/g, '')
    .replace(/^需要/g, '')
    .replace(/^当前主工作树中/g, '')
    .trim();
  if (!text) {
    return '补齐当前需求实现';
  }
  if (/^(在|提供|保留|展示|支持|完成|补齐|同步|避免|接入|接通|收口|更新|修复|统一)/.test(text)) {
    return text;
  }
  if (/^(Add|Apply|Build|Collect|Create|Deny|Display|Expose|Fetch|Handle|Implement|Keep|Load|Manage|Persist|Port|Prepare|Prevent|Protect|Record|Refresh|Render|Reuse|Route|Return|Save|Show|Submit|Support|Sync|Track|Update|Validate|Wire)/i.test(text)) {
    return text;
  }
  return `实现${text}`;
}

function buildVerificationTitle(item) {
  const text = trimTaskText(item);
  if (!text) {
    return '验证当前需求闭环';
  }
  if (/^(验证|回归|确认|检查|Compare|Verify|Test|Review)/i.test(text)) {
    return text;
  }
  return `验证${text}`;
}

function chunkItems(items, maxItemsPerChunk = 2) {
  const chunks = [];
  for (let index = 0; index < items.length; index += maxItemsPerChunk) {
    chunks.push(items.slice(index, index + maxItemsPerChunk));
  }
  return chunks;
}

const DEFAULT_EXECUTION_VERIFY_COMMAND = 'openprd run . --verify';

const ARCHITECTURE_TASK_DEFINITIONS = [
  {
    key: 'shared-contracts',
    pattern: /(shared contracts?|host methods?|host api|ipc|preload|schema|contract|entitlement|接口约定|共享契约|契约|协议|类型)/i,
    title: '对齐共享契约与 Host API 调用边界',
    done: '共享契约、Host API 和上下游调用边界已经对齐，后续功能可以直接接线。',
  },
  {
    key: 'domain-data',
    pattern: /(domain|service|gateway|adapter|repository|storage|snapshot|backend|billing|orders?|entitlement|sync|cache|状态快照|领域服务|网关|适配器|仓储|后端|订单|会员|额度|数据)/i,
    title: '补齐领域服务、数据读取与状态同步',
    done: '领域服务、数据读取和状态同步已经接通，界面不会停留在假可见状态。',
  },
  {
    key: 'main-runtime',
    pattern: /(main process|electron main|main\b|window|daemon|tray|主进程|窗口|守护|后台)/i,
    title: '补齐主进程、窗口与后台接线',
    done: '主进程事件、窗口入口或后台能力的接线已经补齐，不会因为运行时边界遗漏而失效。',
  },
  {
    key: 'renderer-surface',
    pattern: /(renderer|view|ui|route|navigation|page|dialog|modal|surface|sidebar|entry|renderer 入口|界面|页面|弹窗|弹层|入口|导航|菜单|路由|侧边栏)/i,
    title: '接通界面入口、导航与页面挂载',
    done: '用户可以从正确入口进入对应界面，页面挂载与状态收尾已经接通。',
  },
  {
    key: 'diagnostics',
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
  const sections = snapshot.sections ?? {};
  return [
    `# ${scalar(snapshot.title, changeId)}`,
    '',
    '## 背景与原因',
    '',
    scalar(sections.problem?.problemStatement, '需要把当前产品需求转化为可执行的规格变更。'),
    '',
    '## 变更内容',
    '',
    bullets([
      ...arrayValue(sections.scope?.inScope),
      ...arrayValue(sections.requirements?.functional),
      ...arrayValue(sections.goals?.acceptanceGoals),
    ], ['根据当前 PRD 生成 OpenPrd 管理的规格增量。']),
    '',
    '## 能力范围',
    '',
    `- \`${capability}\`: ${scalar(snapshot.title, '产品行为')} 需求。`,
    '',
    '## 影响范围',
    '',
    bullets([
      ...arrayValue(sections.users?.primaryUsers).map((item) => `主要用户: ${item}`),
      ...arrayValue(sections.businessGuardrails?.costDrivers).map((item) => `成本来源: ${item}`),
      ...arrayValue(sections.businessGuardrails?.usageLimits).map((item) => `额度限制: ${item}`),
      ...arrayValue(sections.constraints?.dependencies).map((item) => `依赖: ${item}`),
      ...arrayValue(sections.risks?.risks).map((item) => `风险: ${item}`),
    ], ['Agent 可以通过 OpenPrd 从 PRD 继续推进到 specs、tasks、validation 和 execution。']),
    '',
  ].join('\n');
}

function buildDesign({ snapshot }) {
  const sections = snapshot.sections ?? {};
  return [
    '# 设计',
    '',
    '## 背景',
    '',
    scalar(sections.problem?.whyNow, '根据最新 OpenPrd 快照生成。'),
    '',
    '## 目标',
    '',
    bullets(sections.goals?.goals),
    '',
    '## 范围',
    '',
    bullets(sections.scope?.inScope),
    '',
    '## 约束',
    '',
    bullets([
      ...arrayValue(sections.constraints?.technical),
      ...arrayValue(sections.constraints?.compliance),
      ...arrayValue(sections.constraints?.dependencies),
    ]),
    '',
    '## 业务护栏',
    '',
    bullets([
      ...arrayValue(sections.businessGuardrails?.costDrivers).map((item) => `成本来源: ${item}`),
      ...arrayValue(sections.businessGuardrails?.usageLimits).map((item) => `额度限制: ${item}`),
      ...arrayValue(sections.businessGuardrails?.abusePrevention).map((item) => `滥用防护: ${item}`),
      ...arrayValue(sections.businessGuardrails?.monitoringSignals).map((item) => `监控信号: ${item}`),
      ...arrayValue(sections.businessGuardrails?.alertThresholds).map((item) => `报警阈值: ${item}`),
      ...arrayValue(sections.businessGuardrails?.stopLossActions).map((item) => `止损动作: ${item}`),
    ]),
    '',
    '## 风险与开放问题',
    '',
    bullets([
      ...arrayValue(sections.risks?.assumptions).map((item) => `假设: ${item}`),
      ...arrayValue(sections.risks?.risks).map((item) => `风险: ${item}`),
      ...arrayValue(sections.risks?.openQuestions).map((item) => `问题: ${item}`),
    ]),
    '',
  ].join('\n');
}

export function buildSpec({ snapshot }) {
  const sections = snapshot.sections ?? {};
  const title = safeRequirementTitle(
    preferSimplifiedChinese(snapshot.title, '当前 PRD 描述的产品行为'),
    '当前 PRD 描述的产品行为',
  );
  const acceptanceSource = arrayValue(sections.goals?.acceptanceGoals)[0]
    ?? arrayValue(sections.requirements?.functional)[0];
  const flow = preferSimplifiedChinese(arrayValue(sections.scenarios?.primaryFlows)[0], '主要用户完成主流程');
  const acceptance = preferSimplifiedChinese(acceptanceSource, '预期产品结果得到满足');
  const edgeCase = preferSimplifiedChinese(arrayValue(sections.scenarios?.edgeCases)[0], '出现边界情况');
  const failureMode = preferSimplifiedChinese(arrayValue(sections.scenarios?.failureModes)[0], '出现失败模式');

  return [
    '## 新增需求',
    '',
    `### 需求：${title}`,
    preferSimplifiedChinese(sections.problem?.problemStatement, '生成的能力应保持最新 OpenPrd 快照描述的行为。'),
    '',
    '#### 场景：主流程成功',
    `- **当** ${flow}`,
    `- **则** ${acceptance}`,
    '',
    '#### 场景：边界情况保持可见',
    `- **当** ${edgeCase}`,
    '- **则** 产品应保持该情况明确可见，以支持实现和验证',
    '',
    '#### 场景：失败模式得到处理',
    `- **当** ${failureMode}`,
    '- **则** 产品应提供有边界且可评审的结果',
    '',
  ].join('\n');
}

function inferArchitectureTasks(snapshot) {
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
      title: definition.title,
      done: `${definition.done} 涉及: ${summarizeTaskItems(matches, 2, 72)}。`,
      verify: DEFAULT_EXECUTION_VERIFY_COMMAND,
      phase: 'architecture',
    }));
}

function buildRequirementImplementationTasks(snapshot) {
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
      title: cleanImplementationTitle(item),
      done: buildDoneText('已完成：', item),
      verify: DEFAULT_EXECUTION_VERIFY_COMMAND,
      phase: 'implementation',
    });
  }

  return tasks;
}

function buildFlowIntegrationTasks(snapshot) {
  const sections = snapshot.sections ?? {};
  const flows = arrayValue(sections.scenarios?.primaryFlows);
  if (flows.length === 0) {
    return [];
  }
  return [{
    key: `integration:${summarizeTaskItems(flows, 2, 48)}`,
    type: 'implementation',
    title: `打通主流程闭环：${summarizeTaskItems(flows, 2, 56)}`,
    done: `主流程关键节点已经打通，用户可以按预期从入口走到结果收尾。涉及: ${summarizeTaskItems(flows, 2, 72)}。`,
    verify: DEFAULT_EXECUTION_VERIFY_COMMAND,
    phase: 'integration',
  }];
}

function buildAcceptanceVerificationTasks(snapshot) {
  const sections = snapshot.sections ?? {};
  return arrayValue(sections.goals?.acceptanceGoals).map((item) => ({
    key: `acceptance:${normalizeTaskSemanticKey(item)}`,
    type: 'verification',
    title: buildVerificationTitle(item),
    done: buildDoneText('已验证：', item),
    verify: DEFAULT_EXECUTION_VERIFY_COMMAND,
    phase: 'verification',
  }));
}

function buildNonFunctionalVerificationTasks(snapshot) {
  const sections = snapshot.sections ?? {};
  const nonFunctionalChunks = chunkItems(arrayValue(sections.requirements?.nonFunctional), 2).map((items, index) => ({
    key: `non-functional:${index}:${summarizeTaskItems(items, 2, 36)}`,
    type: 'verification',
    title: `回归非功能约束：${summarizeTaskItems(items, 2, 56)}`,
    done: `非功能约束已经回归确认。涉及: ${summarizeTaskItems(items, 2, 72)}。`,
    verify: DEFAULT_EXECUTION_VERIFY_COMMAND,
    phase: 'verification',
  }));
  const edgeAndFailure = [
    ...arrayValue(sections.scenarios?.edgeCases).map((item) => `边界情况：${trimTaskText(item)}`),
    ...arrayValue(sections.scenarios?.failureModes).map((item) => `失败处理：${trimTaskText(item)}`),
  ];
  const edgeTasks = edgeAndFailure.length > 0
    ? [{
        key: `edge:${summarizeTaskItems(edgeAndFailure, 2, 36)}`,
        type: 'verification',
        title: `回归边界条件与失败处理：${summarizeTaskItems(edgeAndFailure, 2, 56)}`,
        done: `边界条件与失败处理已经回归确认。涉及: ${summarizeTaskItems(edgeAndFailure, 2, 72)}。`,
        verify: DEFAULT_EXECUTION_VERIFY_COMMAND,
        phase: 'verification',
      }]
    : [];
  return [...nonFunctionalChunks, ...edgeTasks];
}

function buildTaskItems({ changeId, snapshot, capability }) {
  const candidates = [
    {
      key: 'governance:spec-review',
      type: 'governance',
      title: '评审生成的 spec 覆盖',
      done: `生成的 ${capability} spec 符合 PRD 意图`,
      verify: `openprd change . --validate --change ${changeId}`,
      phase: 'governance-start',
    },
    ...inferArchitectureTasks(snapshot),
    ...buildRequirementImplementationTasks(snapshot),
    ...buildFlowIntegrationTasks(snapshot),
    ...buildAcceptanceVerificationTasks(snapshot),
    ...buildNonFunctionalVerificationTasks(snapshot),
    ...(needsBusinessGuardrails(snapshot)
      ? [
          {
            key: 'verification:guardrail-usage',
            type: 'verification',
            title: '验证成本与额度护栏',
            done: '已验证免费、试用或低权限用户不能绕过额度、并发、频率或总量限制',
            verify: DEFAULT_EXECUTION_VERIFY_COMMAND,
            phase: 'verification',
          },
          {
            key: 'verification:guardrail-abuse',
            type: 'verification',
            title: '验证滥用与越权路径',
            done: '已覆盖重复请求、并发请求、越权身份和异常恢复等负向场景',
            verify: DEFAULT_EXECUTION_VERIFY_COMMAND,
            phase: 'verification',
          },
          {
            key: 'verification:guardrail-monitoring',
            type: 'verification',
            title: '验证成本监控、报警和止损',
            done: '已确认用量或成本信号、报警阈值和人工/自动止损动作可执行',
            verify: DEFAULT_EXECUTION_VERIFY_COMMAND,
            phase: 'verification',
          },
        ]
      : []),
    {
      key: 'documentation:docs-basic',
      type: 'documentation',
      title: '维护 docs/basic 项目基础文档',
      done: '已检查 docs/basic 是否缺失或因本次需求、流程、结构、依赖、产品行为变化而过期；若涉及后端、脚本、Agent 或工具链变更，已同步评估 CLI 与 API 接入面，并在 backend-structure.md 中记录事实或不适用原因；需要更新的基础文档已同步',
      verify: 'openprd standards . --verify',
      phase: 'documentation',
    },
    {
      key: 'documentation:manuals',
      type: 'documentation',
      title: '更新文件说明书和文件夹 README',
      done: '本次变更涉及的文件说明书和文件夹 README 已检查；缺失的已补齐，过期的已更新',
      verify: 'openprd standards . --verify',
      phase: 'documentation',
    },
    {
      key: 'governance:final-validate',
      type: 'governance',
      title: '运行 OpenPrd spec 校验',
      done: '生成的 change 通过 OpenPrd 校验',
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

  const tasks = deduped.map((item, index) => ({
    id: `T001.${String(index + 1).padStart(2, '0')}`,
    title: item.title,
    type: item.type,
    phase: item.phase,
    done: item.done,
    verify: item.verify ?? (item.type === 'documentation' ? 'openprd standards . --verify' : DEFAULT_EXECUTION_VERIFY_COMMAND),
    deps: [],
  }));

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

function renderTaskFiles(tasks, maxItemsPerFile) {
  const chunks = [];
  for (let index = 0; index < tasks.length; index += maxItemsPerFile) {
    chunks.push(tasks.slice(index, index + maxItemsPerFile));
  }

  return chunks.map((chunk, chunkIndex) => {
    const nextFileName = chunkIndex < chunks.length - 1 ? taskFileName(chunkIndex + 1) : null;
    const lines = [
      '# 任务',
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
      lines.push('');
    }

    if (nextFileName) {
      lines.push(`- [ ] Continue with \`${nextFileName}\` after completing this file.`);
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
      optional: current?.taskMetadata?.optional ?? ['deps', 'type'],
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
  const taskFiles = renderTaskFiles(tasks, await readTaskMax(projectRoot));

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
