import path from 'node:path';

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
    return 'TBD';
  }
  return `${value}`;
}

function renderChild(value, depth = 1) {
  const indent = '  '.repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${indent}- TBD`;
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
      return `${indent}- TBD`;
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
      title: 'Consumer Specific',
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
      title: 'B2B Specific',
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
      title: 'Agent Specific',
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
    title: 'Type Specific',
    fields: {
      note: 'Select a product type to unlock the specialized PRD block.',
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
  const owner = pickValue(options.owner, state.owner, 'TBD');
  const status = pickValue(options.status, state.status, 'draft');

  const sections = {
    meta: {
      title,
      owner,
      status,
      version: versionId,
      productType: productType ?? 'unclassified',
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
      nextStep: pickValue(options.nextStep, state.nextStep, 'Review the synthesized PRD and prepare handoff.'),
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

export function renderPrdMarkdown(snapshot) {
  const { sections } = snapshot;
  const lines = [
    `# ${snapshot.title}`,
    '',
    `- Version: ${snapshot.versionId}`,
    `- Owner: ${snapshot.owner}`,
    `- Product Type: ${snapshot.productType ?? 'unclassified'}`,
    `- Template Pack: ${snapshot.templatePack}`,
    `- Status: ${snapshot.status}`,
    `- Generated: ${snapshot.createdAt}`,
    '',
    renderSection('Meta', [
      ['Title', sections.meta.title],
      ['Owner', sections.meta.owner],
      ['Status', sections.meta.status],
      ['Version', sections.meta.version],
      ['Product Type', sections.meta.productType],
      ['Date', sections.meta.date],
    ]),
    renderSection('Problem', [
      ['Problem statement', sections.problem.problemStatement],
      ['Why now', sections.problem.whyNow],
      ['Evidence', sections.problem.evidence],
    ]),
    renderSection('Users / Stakeholders', [
      ['Primary users', sections.users.primaryUsers],
      ['Secondary users', sections.users.secondaryUsers],
      ['Stakeholders', sections.users.stakeholders],
    ]),
    renderSection('Goals / Success', [
      ['Goals', sections.goals.goals],
      ['Success metrics', sections.goals.successMetrics],
      ['Acceptance goals', sections.goals.acceptanceGoals],
    ]),
    renderSection('Scope / Non-goals', [
      ['In scope', sections.scope.inScope],
      ['Out of scope', sections.scope.outOfScope],
    ]),
    renderSection('Scenarios / Flows', [
      ['Primary flows', sections.scenarios.primaryFlows],
      ['Edge cases', sections.scenarios.edgeCases],
      ['Failure modes', sections.scenarios.failureModes],
    ]),
    renderSection('Requirements', [
      ['Functional requirements', sections.requirements.functional],
      ['Non-functional requirements', sections.requirements.nonFunctional],
      ['Business rules', sections.requirements.businessRules],
    ]),
    renderSection('Constraints / Dependencies / Risks', [
      ['Technical constraints', sections.constraints.technical],
      ['Compliance', sections.constraints.compliance],
      ['Dependencies', sections.constraints.dependencies],
      ['Assumptions', sections.risks.assumptions],
      ['Risks', sections.risks.risks],
      ['Open questions', sections.risks.openQuestions],
    ]),
  ];

  const typeSpecific = sections.typeSpecific;
  const typeSpecificFields = [
    ['Type', typeSpecific.title ?? 'Type Specific'],
    ...Object.entries(typeSpecific.fields),
  ];
  lines.push(renderSection('Type-Specific Block', typeSpecificFields));

  lines.push(renderSection('Handoff', [
    ['Owner', sections.handoff.owner],
    ['Next step', sections.handoff.nextStep],
    ['Target system', sections.handoff.targetSystem],
  ]));

  return `${lines.filter(Boolean).join('\n')}`;
}


const BASE_REQUIRED_FIELD_DESCRIPTORS = [
  { section: 'meta', path: 'meta.title', label: 'Title', prompt: 'What should this PRD be called?' },
  { section: 'meta', path: 'meta.owner', label: 'Owner', prompt: 'Who owns this PRD?' },
  { section: 'meta', path: 'meta.version', label: 'Version', prompt: 'What version should this PRD start at?' },
  { section: 'meta', path: 'meta.status', label: 'Status', prompt: 'What is the current PRD status?' },
  { section: 'meta', path: 'meta.productType', label: 'Product Type', prompt: 'Is this a consumer, b2b, or agent product?' },
  { section: 'problem', path: 'problem.problemStatement', label: 'Problem statement', prompt: 'What problem are we solving?' },
  { section: 'problem', path: 'problem.whyNow', label: 'Why now', prompt: 'Why is now the right time to solve this?' },
  { section: 'problem', path: 'problem.evidence', label: 'Evidence', prompt: 'What evidence supports this problem?' },
  { section: 'users', path: 'users.primaryUsers', label: 'Primary users', prompt: 'Who is the primary user?' },
  { section: 'users', path: 'users.stakeholders', label: 'Stakeholders', prompt: 'Who else is involved or affected?' },
  { section: 'goals', path: 'goals.goals', label: 'Goals', prompt: 'What outcomes do we want?' },
  { section: 'goals', path: 'goals.successMetrics', label: 'Success metrics', prompt: 'How will success be measured?' },
  { section: 'goals', path: 'goals.acceptanceGoals', label: 'Acceptance goals', prompt: 'What must be true before we call this done?' },
  { section: 'scope', path: 'scope.inScope', label: 'In scope', prompt: 'What is in scope for this version?' },
  { section: 'scope', path: 'scope.outOfScope', label: 'Out of scope', prompt: 'What is explicitly out of scope?' },
  { section: 'scenarios', path: 'scenarios.primaryFlows', label: 'Primary flows', prompt: 'What is the main user flow?' },
  { section: 'scenarios', path: 'scenarios.edgeCases', label: 'Edge cases', prompt: 'What edge cases matter?' },
  { section: 'scenarios', path: 'scenarios.failureModes', label: 'Failure modes', prompt: 'What failure modes should we handle?' },
  { section: 'requirements', path: 'requirements.functional', label: 'Functional requirements', prompt: 'What must the product do?' },
  { section: 'requirements', path: 'requirements.nonFunctional', label: 'Non-functional requirements', prompt: 'What performance, reliability, or security requirements matter?' },
  { section: 'requirements', path: 'requirements.businessRules', label: 'Business rules', prompt: 'What business rules should apply?' },
  { section: 'constraints', path: 'constraints.technical', label: 'Technical constraints', prompt: 'What technical constraints exist?' },
  { section: 'constraints', path: 'constraints.compliance', label: 'Compliance', prompt: 'Are there compliance or policy constraints?' },
  { section: 'constraints', path: 'constraints.dependencies', label: 'Dependencies', prompt: 'What dependencies does this rely on?' },
  { section: 'risks', path: 'risks.assumptions', label: 'Assumptions', prompt: 'What assumptions are we making?' },
  { section: 'risks', path: 'risks.risks', label: 'Risks', prompt: 'What risks do we need to watch?' },
  { section: 'risks', path: 'risks.openQuestions', label: 'Open questions', prompt: 'What remains unresolved?' },
  { section: 'handoff', path: 'handoff.owner', label: 'Handoff owner', prompt: 'Who owns the next step after PRD freeze?' },
  { section: 'handoff', path: 'handoff.nextStep', label: 'Next step', prompt: 'What happens immediately after this PRD is frozen?' },
  { section: 'handoff', path: 'handoff.targetSystem', label: 'Target system', prompt: 'Where should this handoff go?' },
];

const TYPE_REQUIRED_FIELD_DESCRIPTORS = {
  consumer: [
    { section: 'consumer', path: 'typeSpecific.fields.persona', label: 'Persona', prompt: 'Who is the target persona?' },
    { section: 'consumer', path: 'typeSpecific.fields.segment', label: 'Segment', prompt: 'Which segment are we targeting?' },
    { section: 'consumer', path: 'typeSpecific.fields.journey', label: 'Journey', prompt: 'Which journey are we optimizing?' },
    { section: 'consumer', path: 'typeSpecific.fields.activationMetric', label: 'Activation metric', prompt: 'What activation metric defines early success?' },
    { section: 'consumer', path: 'typeSpecific.fields.retentionMetric', label: 'Retention metric', prompt: 'What retention metric defines repeat value?' },
  ],
  b2b: [
    { section: 'b2b', path: 'typeSpecific.fields.buyer', label: 'Buyer', prompt: 'Who buys or approves this product?' },
    { section: 'b2b', path: 'typeSpecific.fields.user', label: 'User', prompt: 'Who uses the product daily?' },
    { section: 'b2b', path: 'typeSpecific.fields.admin', label: 'Admin', prompt: 'Who configures or administers the product?' },
    { section: 'b2b', path: 'typeSpecific.fields.operator', label: 'Operator', prompt: 'Who operates the workflow end to end?' },
    { section: 'b2b', path: 'typeSpecific.fields.roles', label: 'Roles', prompt: 'What are the key roles in the workflow?' },
    { section: 'b2b', path: 'typeSpecific.fields.asIs', label: 'As-Is', prompt: 'What does the current process look like?' },
    { section: 'b2b', path: 'typeSpecific.fields.toBe', label: 'To-Be', prompt: 'What should the future process look like?' },
    { section: 'b2b', path: 'typeSpecific.fields.permissionMatrix', label: 'Permission matrix', prompt: 'What permissions or access rules apply?' },
    { section: 'b2b', path: 'typeSpecific.fields.approvalFlow', label: 'Approval flow', prompt: 'What approvals or sign-offs are required?' },
  ],
  agent: [
    { section: 'agent', path: 'typeSpecific.fields.humanAgentContract', label: 'Human-Agent contract', prompt: 'What must remain human-approved versus agent-automated?' },
    { section: 'agent', path: 'typeSpecific.fields.autonomyBoundary', label: 'Autonomy boundary', prompt: 'How far can the agent act on its own?' },
    { section: 'agent', path: 'typeSpecific.fields.toolBoundary', label: 'Tool boundary', prompt: 'Which tools can the agent use?' },
    { section: 'agent', path: 'typeSpecific.fields.stateModel', label: 'State model', prompt: 'What state or memory model does the agent need?' },
    { section: 'agent', path: 'typeSpecific.fields.evalPlan', label: 'Eval plan', prompt: 'How will we evaluate the agent?' },
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
