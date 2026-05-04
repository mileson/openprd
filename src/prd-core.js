import path from 'node:path';
import { buildArchitectureDiagramModel, buildProductFlowDiagramModel, renderDiagramMermaidFromModel } from './diagram-core.js';
import { TBD_ZH, languagePolicyLines } from './language-policy.js';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pickValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (isPlainObject(value) && Object.keys(value).length === 0) continue;
    return value;
  }
  return null;
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== null && item !== undefined && `${item}`.trim() !== '');
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [value];
}

function renderScalar(value) {
  if (value === null || value === undefined || `${value}`.trim() === '') {
    return TBD_ZH;
  }
  return `${value}`;
}

function renderChild(value, depth = 1) {
  const indent = '  '.repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${indent}- ${TBD_ZH}`;
    }

    return value
      .map((item) => {
        if (isPlainObject(item)) {
          return Object.entries(item)
            .map(([key, entryValue]) => `${indent}- ${key}: ${renderScalar(entryValue)}`)
            .join('\n');
        }
        return `${indent}- ${renderScalar(item)}`;
      })
      .join('\n');
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return `${indent}- ${TBD_ZH}`;
    }

    return entries
      .map(([key, entryValue]) => {
        if (Array.isArray(entryValue) || isPlainObject(entryValue)) {
          return `${indent}- ${key}:\n${renderChild(entryValue, depth + 1)}`;
        }
        return `${indent}- ${key}: ${renderScalar(entryValue)}`;
      })
      .join('\n');
  }

  return `${indent}- ${renderScalar(value)}`;
}

function renderField(label, value) {
  if (Array.isArray(value) || isPlainObject(value)) {
    return `- ${label}:\n${renderChild(value, 1)}`;
  }
  return `- ${label}: ${renderScalar(value)}`;
}

export function formatVersionId(versionNumber) {
  return `v${String(versionNumber).padStart(4, '0')}`;
}

function buildTypeSpecificSection(productType, state, overrides) {
  if (productType === 'consumer') {
    return {
      kind: 'consumer',
      title: '消费端专项',
      fields: {
        persona: pickValue(overrides.persona, state.persona),
        segment: pickValue(overrides.segment, state.segment),
        journey: pickValue(overrides.journey, state.journey),
        activationMetric: pickValue(overrides.activationMetric, state.activationMetric),
        retentionMetric: pickValue(overrides.retentionMetric, state.retentionMetric),
      },
    };
  }

  if (productType === 'b2b') {
    return {
      kind: 'b2b',
      title: 'B2B 专项',
      fields: {
        buyer: pickValue(overrides.buyer, state.buyer),
        user: pickValue(overrides.user, state.user),
        admin: pickValue(overrides.admin, state.admin),
        operator: pickValue(overrides.operator, state.operator),
        roles: pickValue(overrides.roles, state.roles),
        asIs: pickValue(overrides.asIs, state.asIs),
        toBe: pickValue(overrides.toBe, state.toBe),
        permissionMatrix: pickValue(overrides.permissionMatrix, state.permissionMatrix),
        approvalFlow: pickValue(overrides.approvalFlow, state.approvalFlow),
      },
    };
  }

  if (productType === 'agent') {
    return {
      kind: 'agent',
      title: 'Agent 专项',
      fields: {
        humanAgentContract: pickValue(overrides.humanAgentContract, state.humanAgentContract),
        autonomyBoundary: pickValue(overrides.autonomyBoundary, state.autonomyBoundary),
        toolBoundary: pickValue(overrides.toolBoundary, state.toolBoundary),
        stateModel: pickValue(overrides.stateModel, state.stateModel),
        evalPlan: pickValue(overrides.evalPlan, state.evalPlan),
      },
    };
  }

  return {
    kind: 'base',
    title: '类型专项',
    fields: {
      note: '请选择产品类型，以启用对应的专项 PRD 模块。',
    },
  };
}

export function buildPrdSnapshot(ws, options = {}) {
  const state = ws.data.currentState ?? {};
  const versionNumber = options.versionNumber ?? state.prdVersion ?? 0;
  const versionId = options.versionId ?? (versionNumber > 0 ? formatVersionId(versionNumber) : 'v0000');
  const createdAt = options.createdAt ?? new Date().toISOString();
  const productType = options.productType ?? state.productType ?? null;
  const templatePack = options.templatePack ?? state.templatePack ?? ws.data.config?.activeTemplatePack ?? 'base';
  const title = pickValue(options.title, state.title, path.basename(ws.projectRoot));
  const owner = pickValue(options.owner, state.owner, TBD_ZH);
  const status = pickValue(options.status, state.status, 'draft');

  const sections = {
    meta: {
      title,
      owner,
      status,
      version: versionId,
      productType: productType ?? '未分类',
      date: options.date ?? createdAt.slice(0, 10),
    },
    problem: {
      problemStatement: pickValue(options.problemStatement, state.problemStatement),
      whyNow: pickValue(options.whyNow, state.whyNow),
      evidence: normalizeArray(pickValue(options.evidence, state.evidence)),
    },
    users: {
      primaryUsers: normalizeArray(pickValue(options.primaryUsers, state.primaryUsers)),
      secondaryUsers: normalizeArray(pickValue(options.secondaryUsers, state.secondaryUsers)),
      stakeholders: normalizeArray(pickValue(options.stakeholders, state.stakeholders)),
    },
    goals: {
      goals: normalizeArray(pickValue(options.goals, state.goals)),
      successMetrics: normalizeArray(pickValue(options.successMetrics, state.successMetrics)),
      acceptanceGoals: normalizeArray(pickValue(options.acceptanceGoals, state.acceptanceGoals)),
    },
    scope: {
      inScope: normalizeArray(pickValue(options.inScope, state.inScope)),
      outOfScope: normalizeArray(pickValue(options.outOfScope, state.outOfScope)),
    },
    scenarios: {
      primaryFlows: normalizeArray(pickValue(options.primaryFlows, state.primaryFlows)),
      edgeCases: normalizeArray(pickValue(options.edgeCases, state.edgeCases)),
      failureModes: normalizeArray(pickValue(options.failureModes, state.failureModes)),
    },
    requirements: {
      functional: normalizeArray(pickValue(options.functional, state.functional)),
      nonFunctional: normalizeArray(pickValue(options.nonFunctional, state.nonFunctional)),
      businessRules: normalizeArray(pickValue(options.businessRules, state.businessRules)),
    },
    constraints: {
      technical: normalizeArray(pickValue(options.technical, state.technical)),
      compliance: normalizeArray(pickValue(options.compliance, state.compliance)),
      dependencies: normalizeArray(pickValue(options.dependencies, state.dependencies)),
    },
    risks: {
      assumptions: normalizeArray(pickValue(options.assumptions, state.assumptions)),
      risks: normalizeArray(pickValue(options.risks, state.risks)),
      openQuestions: normalizeArray(pickValue(options.openQuestions, state.openQuestions)),
    },
    handoff: {
      owner: pickValue(options.handoffOwner, state.handoffOwner, owner),
      nextStep: pickValue(options.nextStep, state.nextStep, '评审已生成的 PRD，并准备交接。'),
      targetSystem: pickValue(options.targetSystem, state.targetSystem, 'OpenSpec'),
    },
    typeSpecific: buildTypeSpecificSection(productType, state, options),
  };

  return {
    versionNumber,
    versionId,
    createdAt,
    projectRoot: ws.projectRoot,
    workspaceRoot: ws.workspaceRoot,
    schema: ws.data.schema?.name ?? null,
    templatePack,
    productType,
    title,
    owner,
    status: 'synthesized',
    sections,
  };
}

function renderSection(title, fields) {
  return `## ${title}\n\n${fields.map(([label, value]) => renderField(label, value)).join('\n')}\n`;
}

function renderMermaidSection(snapshot) {
  const productFlow = renderDiagramMermaidFromModel(
    'product-flow',
    buildProductFlowDiagramModel(snapshot)
  );
  const architecture = renderDiagramMermaidFromModel(
    'architecture',
    buildArchitectureDiagramModel(snapshot)
  );

  return [
    '## 可视化图表',
    '',
    '### 产品流程',
    '',
    '```mermaid',
    productFlow,
    '```',
    '',
    '### 架构',
    '',
    '```mermaid',
    architecture,
    '```',
    '',
  ].join('\n');
}

export function renderPrdMarkdown(snapshot) {
  const { sections } = snapshot;
  const lines = [
    `# ${snapshot.title}`,
    '',
    ...languagePolicyLines(),
    `- 版本: ${snapshot.versionId}`,
    `- 负责人: ${snapshot.owner}`,
    `- 产品类型: ${snapshot.productType ?? '未分类'}`,
    `- 模板包: ${snapshot.templatePack}`,
    `- 状态: ${snapshot.status}`,
    `- 生成时间: ${snapshot.createdAt}`,
    '',
    renderSection('元信息', [
      ['标题', sections.meta.title],
      ['负责人', sections.meta.owner],
      ['状态', sections.meta.status],
      ['版本', sections.meta.version],
      ['产品类型', sections.meta.productType],
      ['日期', sections.meta.date],
    ]),
    renderSection('问题', [
      ['问题陈述', sections.problem.problemStatement],
      ['为什么是现在', sections.problem.whyNow],
      ['证据', sections.problem.evidence],
    ]),
    renderSection('用户与相关方', [
      ['主要用户', sections.users.primaryUsers],
      ['次要用户', sections.users.secondaryUsers],
      ['相关方', sections.users.stakeholders],
    ]),
    renderSection('目标与成功标准', [
      ['目标', sections.goals.goals],
      ['成功指标', sections.goals.successMetrics],
      ['验收目标', sections.goals.acceptanceGoals],
    ]),
    renderSection('范围与非目标', [
      ['范围内', sections.scope.inScope],
      ['范围外', sections.scope.outOfScope],
    ]),
    renderSection('场景与流程', [
      ['主流程', sections.scenarios.primaryFlows],
      ['边界情况', sections.scenarios.edgeCases],
      ['失败模式', sections.scenarios.failureModes],
    ]),
    renderMermaidSection(snapshot),
    renderSection('需求', [
      ['功能需求', sections.requirements.functional],
      ['非功能需求', sections.requirements.nonFunctional],
      ['业务规则', sections.requirements.businessRules],
    ]),
    renderSection('约束、依赖与风险', [
      ['技术约束', sections.constraints.technical],
      ['合规要求', sections.constraints.compliance],
      ['依赖', sections.constraints.dependencies],
      ['假设', sections.risks.assumptions],
      ['风险', sections.risks.risks],
      ['开放问题', sections.risks.openQuestions],
    ]),
  ];

  const typeSpecific = sections.typeSpecific;
  const typeSpecificFields = [
    ['类型', typeSpecific.title ?? '类型专项'],
    ...Object.entries(typeSpecific.fields),
  ];
  lines.push(renderSection('类型专项模块', typeSpecificFields));

  lines.push(renderSection('交接', [
    ['负责人', sections.handoff.owner],
    ['下一步', sections.handoff.nextStep],
    ['目标系统', sections.handoff.targetSystem],
  ]));

  return `${lines.filter(Boolean).join('\n')}`;
}


const BASE_REQUIRED_FIELD_DESCRIPTORS = [
  { section: 'meta', path: 'meta.title', label: '标题', prompt: '这份 PRD 应该叫什么？' },
  { section: 'meta', path: 'meta.owner', label: '负责人', prompt: '谁负责这份 PRD？' },
  { section: 'meta', path: 'meta.version', label: '版本', prompt: '这份 PRD 从哪个版本开始？' },
  { section: 'meta', path: 'meta.status', label: '状态', prompt: '当前 PRD 状态是什么？' },
  { section: 'meta', path: 'meta.productType', label: '产品类型', prompt: '这是 consumer、b2b 还是 agent 产品？' },
  { section: 'problem', path: 'problem.problemStatement', label: '问题陈述', prompt: '我们要解决什么问题？' },
  { section: 'problem', path: 'problem.whyNow', label: '为什么是现在', prompt: '为什么现在是解决这个问题的合适时机？' },
  { section: 'problem', path: 'problem.evidence', label: '证据', prompt: '有哪些证据支持这个问题？' },
  { section: 'users', path: 'users.primaryUsers', label: '主要用户', prompt: '主要用户是谁？' },
  { section: 'users', path: 'users.stakeholders', label: '相关方', prompt: '还有谁会参与或受到影响？' },
  { section: 'goals', path: 'goals.goals', label: '目标', prompt: '我们希望达成什么结果？' },
  { section: 'goals', path: 'goals.successMetrics', label: '成功指标', prompt: '如何衡量成功？' },
  { section: 'goals', path: 'goals.acceptanceGoals', label: '验收目标', prompt: '满足什么条件才能认为完成？' },
  { section: 'scope', path: 'scope.inScope', label: '范围内', prompt: '这个版本包含哪些范围？' },
  { section: 'scope', path: 'scope.outOfScope', label: '范围外', prompt: '哪些内容明确不在范围内？' },
  { section: 'scenarios', path: 'scenarios.primaryFlows', label: '主流程', prompt: '主要用户流程是什么？' },
  { section: 'scenarios', path: 'scenarios.edgeCases', label: '边界情况', prompt: '哪些边界情况需要处理？' },
  { section: 'scenarios', path: 'scenarios.failureModes', label: '失败模式', prompt: '需要处理哪些失败模式？' },
  { section: 'requirements', path: 'requirements.functional', label: '功能需求', prompt: '产品必须做什么？' },
  { section: 'requirements', path: 'requirements.nonFunctional', label: '非功能需求', prompt: '有哪些性能、可靠性或安全要求？' },
  { section: 'requirements', path: 'requirements.businessRules', label: '业务规则', prompt: '需要遵守哪些业务规则？' },
  { section: 'constraints', path: 'constraints.technical', label: '技术约束', prompt: '存在哪些技术约束？' },
  { section: 'constraints', path: 'constraints.compliance', label: '合规要求', prompt: '是否存在合规或策略约束？' },
  { section: 'constraints', path: 'constraints.dependencies', label: '依赖', prompt: '这个需求依赖什么？' },
  { section: 'risks', path: 'risks.assumptions', label: '假设', prompt: '我们做了哪些假设？' },
  { section: 'risks', path: 'risks.risks', label: '风险', prompt: '需要关注哪些风险？' },
  { section: 'risks', path: 'risks.openQuestions', label: '开放问题', prompt: '还有哪些问题未解决？' },
  { section: 'handoff', path: 'handoff.owner', label: '交接负责人', prompt: 'PRD freeze 后由谁负责下一步？' },
  { section: 'handoff', path: 'handoff.nextStep', label: '下一步', prompt: 'PRD freeze 后马上做什么？' },
  { section: 'handoff', path: 'handoff.targetSystem', label: '目标系统', prompt: '交接到哪里？' },
];

const TYPE_REQUIRED_FIELD_DESCRIPTORS = {
  consumer: [
    { section: 'consumer', path: 'typeSpecific.fields.persona', label: '用户画像', prompt: '目标用户画像是什么？' },
    { section: 'consumer', path: 'typeSpecific.fields.segment', label: '用户分层', prompt: '目标用户分层是什么？' },
    { section: 'consumer', path: 'typeSpecific.fields.journey', label: '用户旅程', prompt: '要优化哪段用户旅程？' },
    { section: 'consumer', path: 'typeSpecific.fields.activationMetric', label: '激活指标', prompt: '哪个激活指标代表早期成功？' },
    { section: 'consumer', path: 'typeSpecific.fields.retentionMetric', label: '留存指标', prompt: '哪个留存指标代表持续价值？' },
  ],
  b2b: [
    { section: 'b2b', path: 'typeSpecific.fields.buyer', label: '采购方', prompt: '谁购买或审批这个产品？' },
    { section: 'b2b', path: 'typeSpecific.fields.user', label: '使用者', prompt: '谁每天使用这个产品？' },
    { section: 'b2b', path: 'typeSpecific.fields.admin', label: '管理员', prompt: '谁配置或管理这个产品？' },
    { section: 'b2b', path: 'typeSpecific.fields.operator', label: '运营者', prompt: '谁端到端运营这个流程？' },
    { section: 'b2b', path: 'typeSpecific.fields.roles', label: '角色', prompt: '流程中的关键角色有哪些？' },
    { section: 'b2b', path: 'typeSpecific.fields.asIs', label: '现状流程', prompt: '当前流程是什么样？' },
    { section: 'b2b', path: 'typeSpecific.fields.toBe', label: '目标流程', prompt: '未来流程应该是什么样？' },
    { section: 'b2b', path: 'typeSpecific.fields.permissionMatrix', label: '权限矩阵', prompt: '需要哪些权限或访问规则？' },
    { section: 'b2b', path: 'typeSpecific.fields.approvalFlow', label: '审批流程', prompt: '需要哪些审批或确认？' },
  ],
  agent: [
    { section: 'agent', path: 'typeSpecific.fields.humanAgentContract', label: 'Human-Agent contract', prompt: '哪些事项必须由人确认，哪些可以由 Agent 自动完成？' },
    { section: 'agent', path: 'typeSpecific.fields.autonomyBoundary', label: '自主边界', prompt: 'Agent 可以自主行动到什么程度？' },
    { section: 'agent', path: 'typeSpecific.fields.toolBoundary', label: '工具边界', prompt: 'Agent 可以使用哪些工具？' },
    { section: 'agent', path: 'typeSpecific.fields.stateModel', label: '状态模型', prompt: 'Agent 需要什么状态或记忆模型？' },
    { section: 'agent', path: 'typeSpecific.fields.evalPlan', label: '评估计划', prompt: '如何评估这个 Agent？' },
  ],
};

function getValueAtPath(root, pathString) {
  if (!root || !pathString) {
    return undefined;
  }

  return pathString.split('.').reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), root);
}

function isMissingPrdValue(value) {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    return text === '' || text === 'tbd' || text === 'todo' || text === 'unknown' || text === 'unclassified';
  }

  if (Array.isArray(value)) {
    return value.length === 0 || value.every((item) => isMissingPrdValue(item));
  }

  if (isPlainObject(value)) {
    const entries = Object.values(value);
    return entries.length === 0 || entries.every((item) => isMissingPrdValue(item));
  }

  return false;
}

export function getRequiredFieldDescriptors(productType) {
  const descriptors = [...BASE_REQUIRED_FIELD_DESCRIPTORS];
  if (TYPE_REQUIRED_FIELD_DESCRIPTORS[productType]) {
    descriptors.push(...TYPE_REQUIRED_FIELD_DESCRIPTORS[productType]);
  }
  return descriptors;
}

export function analyzePrdSnapshot(snapshot) {
  const productType = snapshot.productType ?? null;
  const descriptors = getRequiredFieldDescriptors(productType);
  const missingFields = [];
  const completeFields = [];

  for (const descriptor of descriptors) {
    const value = getValueAtPath(snapshot.sections, descriptor.path);
    const missing = isMissingPrdValue(value);
    const entry = {
      ...descriptor,
      value,
      missing,
    };
    if (missing) {
      missingFields.push(entry);
    } else {
      completeFields.push(entry);
    }
  }

  const totalRequiredFields = descriptors.length;
  const completedRequiredFields = completeFields.length;
  const completionRatio = totalRequiredFields === 0 ? 1 : completedRequiredFields / totalRequiredFields;

  return {
    productType,
    totalRequiredFields,
    completedRequiredFields,
    missingRequiredFields: missingFields.length,
    completionRatio,
    missingFields,
    completeFields,
    missingSections: [...new Set(missingFields.map((field) => field.section))],
    suggestedQuestions: missingFields.slice(0, 5).map((field) => field.prompt),
  };
}

function diffValues(before, after, prefix = '') {
  if (Object.is(before, after)) {
    return [];
  }

  const beforeJson = JSON.stringify(before);
  const afterJson = JSON.stringify(after);
  if (beforeJson === afterJson) {
    return [];
  }

  const beforeIsObject = isPlainObject(before);
  const afterIsObject = isPlainObject(after);

  if (!beforeIsObject || !afterIsObject) {
    return [{ path: prefix, before, after }];
  }

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = [];

  for (const key of keys) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (!(key in before)) {
      changes.push({ path: nextPrefix, before: undefined, after: after[key] });
      continue;
    }
    if (!(key in after)) {
      changes.push({ path: nextPrefix, before: before[key], after: undefined });
      continue;
    }
    changes.push(...diffValues(before[key], after[key], nextPrefix));
  }

  return changes;
}

export function diffSnapshots(beforeSnapshot, afterSnapshot) {
  const changes = diffValues(beforeSnapshot.sections, afterSnapshot.sections);
  const changedSections = [...new Set(changes.map((change) => change.path.split('.')[0]).filter(Boolean))];

  return {
    fromVersionId: beforeSnapshot.versionId,
    toVersionId: afterSnapshot.versionId,
    fromVersionNumber: beforeSnapshot.versionNumber,
    toVersionNumber: afterSnapshot.versionNumber,
    changedSections,
    changes,
  };
}

export function summarizeSnapshot(snapshot) {
  return {
    versionNumber: snapshot.versionNumber,
    versionId: snapshot.versionId,
    createdAt: snapshot.createdAt,
    title: snapshot.title,
    owner: snapshot.owner,
    productType: snapshot.productType,
    templatePack: snapshot.templatePack,
    status: snapshot.status,
    digest: snapshot.digest ?? null,
  };
}
