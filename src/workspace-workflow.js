import path from 'node:path';
import crypto from 'node:crypto';
import { analyzePrdSnapshot, buildPrdSnapshot, diffSnapshots, formatVersionId, renderPrdMarkdown, summarizeSnapshot } from './prd-core.js';
import { getDiagramReviewState } from './diagram-workspace.js';
import { exists, parseYamlText, readJson, readText, writeJson, writeText } from './fs-utils.js';
import { artifactBundlePaths, canonicalReviewPath, defaultReviewArtifactPath, openArtifactInBrowser, renderPlaygroundArtifact, renderPlaygroundMarkdown, renderPlaygroundPatch, renderReviewArtifact, renderReviewEntryHtml, writeHtmlArtifact } from './html-artifacts.js';
import { findOpenPrdSpecLanguageViolations } from './language-policy.js';
import { buildSpec as buildOpenSpecSpec } from './openspec/generate.js';
import { syncSessionBindingFromReview, syncSessionBindingFromSnapshot } from './session-binding.js';
import { timestamp } from './time.js';
import { generateWorkUnitId, normalizeWorkUnitId, readWorkUnitBinding, resolveTargetRoot, writeWorkUnitBinding } from './work-unit.js';
import { appendDecision, appendOpenQuestions, appendProgress, appendWorkflowEvent, buildClarificationPlan, buildClarificationState, buildWorkflowTaskGraph, CAPTURE_SOURCES, coerceCapturedValue, deriveGateLabels, detectWorkspaceScenario, extractMarkdownSection, FIELD_PATH_TO_STATE_KEY, isSupportedProductType, loadLatestVersionSnapshot, loadWorkspace, normalizeVersionId, readVersionIndex, readVersionSnapshot, renderFlowDoc, renderHandoffDoc, renderRolesDoc, resolveActiveTemplatePack, resolveCurrentProductType, validateWorkspace, writeVersionIndex, writeVersionSnapshot } from './workspace-core.js';

function requirementGatePath(projectRoot) {
  return path.join(projectRoot, '.openprd', 'harness', 'requirement-gate.json');
}

const PRD_REVIEW_STATUSES = ['pending-confirmation', 'confirmed', 'needs-revision'];
const CURRENT_SNAPSHOT_CACHE_KEYS = [
  'versionId',
  'versionNumber',
  'workUnitId',
  'sections',
  'content',
  'digest',
];
const REVIEW_PRESENTATION_RELEVANT_FIELD_PREFIXES = [
  'problem.',
  'users.',
  'goals.',
  'scope.',
  'scenarios.',
  'requirements.',
  'businessGuardrails.',
  'constraints.',
  'risks.',
  'typeSpecific.',
];
const REVIEW_PRESENTATION_RELEVANT_FIELDS = new Set([
  'meta.title',
  'meta.productType',
]);
const NON_SEMANTIC_CAPTURE_SOURCES = new Set(['agent-normalized']);
const REVIEW_SAFE_CAPTURE_FIELDS = new Set([
  'meta.status',
  'reviewPresentation',
]);
const REVIEW_PRESENTATION_RELEVANT_OVERRIDE_KEYS = new Set([
  'title',
  'problemStatement',
  'whyNow',
  'evidence',
  'primaryUsers',
  'secondaryUsers',
  'stakeholders',
  'goals',
  'successMetrics',
  'acceptanceGoals',
  'inScope',
  'outOfScope',
  'primaryFlows',
  'edgeCases',
  'failureModes',
  'functional',
  'nonFunctional',
  'businessRules',
  'costDrivers',
  'usageLimits',
  'abusePrevention',
  'monitoringSignals',
  'alertThresholds',
  'stopLossActions',
  'technical',
  'compliance',
  'dependencies',
  'assumptions',
  'risks',
  'openQuestions',
  'persona',
  'segment',
  'journey',
  'activationMetric',
  'retentionMetric',
  'buyer',
  'user',
  'admin',
  'operator',
  'roles',
  'asIs',
  'toBe',
  'permissionMatrix',
  'approvalFlow',
  'humanAgentContract',
  'autonomyBoundary',
  'toolBoundary',
  'stateModel',
  'evalPlan',
]);
const SYNTHESIZE_CONTENT_OVERRIDE_KEYS = new Set([
  'title',
  'owner',
  'productType',
  'problemStatement',
  'whyNow',
  'evidence',
  'primaryUsers',
  'secondaryUsers',
  'stakeholders',
  'goals',
  'successMetrics',
  'acceptanceGoals',
  'inScope',
  'outOfScope',
  'primaryFlows',
  'edgeCases',
  'failureModes',
  'functional',
  'nonFunctional',
  'businessRules',
  'costDrivers',
  'usageLimits',
  'abusePrevention',
  'monitoringSignals',
  'alertThresholds',
  'stopLossActions',
  'technical',
  'compliance',
  'dependencies',
  'assumptions',
  'risks',
  'openQuestions',
  'handoffOwner',
  'nextStep',
  'targetSystem',
  'reviewPresentation',
  'persona',
  'segment',
  'journey',
  'activationMetric',
  'retentionMetric',
  'buyer',
  'user',
  'admin',
  'operator',
  'roles',
  'asIs',
  'toBe',
  'permissionMatrix',
  'approvalFlow',
  'humanAgentContract',
  'autonomyBoundary',
  'toolBoundary',
  'stateModel',
  'evalPlan',
]);

function normalizePrdReviewStatus(status) {
  return PRD_REVIEW_STATUSES.includes(status) ? status : 'pending-confirmation';
}

async function readActiveRequirementGate(projectRoot) {
  const gate = await readJson(requirementGatePath(projectRoot)).catch(() => null);
  return gate?.active ? gate : null;
}

function meaningfulOverrideValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return value !== false;
}

function hasSynthesizeContentOverrides(overrides) {
  return Object.entries(overrides).some(([key, value]) => (
    SYNTHESIZE_CONTENT_OVERRIDE_KEYS.has(key) && meaningfulOverrideValue(value)
  ));
}

function latestCaptureTimestamp(currentState) {
  const timestamps = [
    currentState?.lastCapturedAt,
    ...Object.values(currentState?.captureMeta ?? {}).map((entry) => entry?.capturedAt),
  ].filter(Boolean).map(String);
  return timestamps.length > 0 ? timestamps.sort().at(-1) : null;
}

function requirementGateReferenceTimestamp(gate) {
  return gate?.confirmedAt ?? gate?.updatedAt ?? gate?.openedAt ?? null;
}

function gateQuestionLimit(gate, fallback) {
  const raw = Number(gate?.approvalPolicy?.maxClarificationQuestions);
  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  return Math.min(fallback, Math.max(1, Math.floor(raw)));
}

function ensureFreshRequirementStateForSynthesize({ gate, currentState, overrides }) {
  if (!gate) {
    return;
  }
  const gateAt = requirementGateReferenceTimestamp(gate);
  if (!gateAt) {
    return;
  }
  const capturedAt = latestCaptureTimestamp(currentState);
  if (capturedAt && String(capturedAt) >= String(gateAt)) {
    return;
  }
  throw new Error([
    'OpenPrd 已阻止 synthesize：当前有新的需求入口，但 current.json 还没有记录本轮确认答案。',
    hasSynthesizeContentOverrides(overrides)
      ? '当前 requirement gate 处于进行中，partial override 不能替代 fresh capture；请先用 openprd capture 写入本轮目标、问题、范围和验收信息。'
      : '请先用 openprd capture 写入本轮目标、问题、范围和验收信息。',
  ].join(' '));
}

function resolveReviewPaths(ws, snapshot) {
  const canonicalReview = canonicalReviewPath(ws, snapshot.versionId);
  const activeReviewEntry = defaultReviewArtifactPath(ws);
  return {
    canonicalReview,
    activeReviewEntry,
  };
}

async function writeReviewFiles(ws, snapshot, { writeEntry = true } = {}) {
  const reviewHtml = renderReviewArtifact({ snapshot });
  const { canonicalReview, activeReviewEntry } = resolveReviewPaths(ws, snapshot);
  await writeHtmlArtifact(canonicalReview, reviewHtml);
  if (writeEntry) {
    await writeHtmlArtifact(activeReviewEntry, renderReviewEntryHtml({
      entryPath: activeReviewEntry,
      reviewPath: canonicalReview,
      title: `${snapshot.title} / 评审入口`,
    }));
  }
  return {
    canonicalReview,
    activeReviewEntry: writeEntry ? activeReviewEntry : null,
  };
}

function shouldUseCurrentDraftForGuidance(currentState) {
  return Boolean(
    currentState?.reviewStatus?.stale
    || (currentState?.lastCapturedAt && !['synthesized', 'frozen', 'handed_off'].includes(currentState?.status))
  );
}

function clearCurrentSnapshotCache(currentState) {
  for (const key of CURRENT_SNAPSHOT_CACHE_KEYS) {
    delete currentState[key];
  }
  return currentState;
}

function isReviewPresentationRelevantField(field) {
  if (!field) return false;
  return REVIEW_PRESENTATION_RELEVANT_FIELDS.has(field)
    || REVIEW_PRESENTATION_RELEVANT_FIELD_PREFIXES.some((prefix) => field.startsWith(prefix));
}

function shouldDropInheritedReviewPresentationFromCapture(applied) {
  const fields = applied.map((item) => item.field).filter(Boolean);
  if (fields.includes('reviewPresentation')) {
    return false;
  }
  return fields.some((field) => isReviewPresentationRelevantField(field));
}

function shouldDropInheritedReviewPresentationFromOverrides(overrides) {
  if (Object.prototype.hasOwnProperty.call(overrides, 'reviewPresentation')) {
    return false;
  }
  return Object.keys(overrides).some((key) => REVIEW_PRESENTATION_RELEVANT_OVERRIDE_KEYS.has(key));
}

function dropInheritedReviewPresentation(currentState) {
  delete currentState.reviewPresentation;
  if (currentState.captureMeta && typeof currentState.captureMeta === 'object' && !Array.isArray(currentState.captureMeta)) {
    delete currentState.captureMeta.reviewPresentation;
  }
  return currentState;
}

function syncCurrentSnapshotCache(currentState, snapshot) {
  clearCurrentSnapshotCache(currentState);
  currentState.versionId = snapshot.versionId;
  currentState.versionNumber = snapshot.versionNumber;
  currentState.workUnitId = snapshot.workUnitId ?? null;
  currentState.sections = snapshot.sections;
  currentState.content = snapshot.content;
  currentState.digest = snapshot.digest;
  return currentState;
}

function markReviewStateStaleAfterCapture(currentState, applied, capturedAt) {
  const dropInheritedPresentation = shouldDropInheritedReviewPresentationFromCapture(applied);
  if (dropInheritedPresentation) {
    dropInheritedReviewPresentation(currentState);
  }
  const staleFields = applied
    .filter((item) => item.field && !REVIEW_SAFE_CAPTURE_FIELDS.has(item.field) && !NON_SEMANTIC_CAPTURE_SOURCES.has(item.source))
    .map((item) => item.field);
  const previousReview = currentState.reviewStatus ?? null;
  const staleVersionId = currentState.latestVersionId ?? currentState.versionId ?? previousReview?.versionId ?? null;
  if (staleFields.length === 0) {
    return false;
  }
  const staleWorkUnitId = currentState.activeWorkUnitId ?? currentState.workUnitId ?? previousReview?.workUnitId ?? null;
  currentState.previousLatestVersionId = staleVersionId;
  currentState.previousLatestVersionDigest = currentState.latestVersionDigest ?? currentState.digest ?? null;
  currentState.previousActiveWorkUnitId = staleWorkUnitId;
  delete currentState.latestVersionId;
  delete currentState.latestVersionDigest;
  delete currentState.activeWorkUnitId;
  clearCurrentSnapshotCache(currentState);
  currentState.status = 'clarifying';
  if (!staleVersionId) {
    return false;
  }
  currentState.reviewStatus = {
    versionId: null,
    workUnitId: null,
    status: 'needs-revision',
    stale: true,
    staleReason: 'captured-fields-updated',
    staleFields,
    staleVersionId,
    staleVersionDigest: currentState.previousLatestVersionDigest,
    staleWorkUnitId,
    staleArtifact: previousReview?.reviewPath ?? previousReview?.stableArtifact ?? previousReview?.artifact ?? null,
    updatedAt: capturedAt,
  };
  return true;
}

function requirementLooksLikeInterfaceWork(gate) {
  const text = `${gate?.promptPreview ?? ''} ${JSON.stringify(gate?.intent ?? {})}`;
  return /界面|页面|菜单|入口|按钮|表单|弹窗|导航|布局|看板|列表|配置页|模块|组件|UI|tab/i.test(text);
}

function assertOpenSpecPreflightReady(snapshot) {
  const specText = buildOpenSpecSpec({ snapshot });
  const violations = findOpenPrdSpecLanguageViolations(specText);
  if (violations.length === 0) {
    return;
  }
  const examples = violations
    .slice(0, 3)
    .map((violation) => `第 ${violation.line} 行：${violation.reason}（${violation.text}）`)
    .join('；');
  throw new Error([
    'OpenPrd 已阻止 synthesize：按当前 PRD 生成的 spec.md 仍会触发简体中文预检，review.html 还不能进入确认。',
    '请先把标题、问题陈述和场景文案整理成可直接产出 spec 的简体中文表达。',
    '如果只是内部措辞规范化，请先用 openprd capture . --source agent-normalized 写回，再重新 synthesize。',
    examples ? `示例：${examples}。` : null,
  ].filter(Boolean).join(' '));
}

function requirementPrompt(gate) {
  return String(gate?.promptPreview ?? '').trim();
}

function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function detectRequirementIntakeComplexity(gate) {
  const text = requirementPrompt(gate);
  const complexPatterns = [
    /新增|新建|增加/,
    /模块|流程|编排|一站式|信息架构|工作流|workflow|wizard/i,
    /多角色|权限|审批|协作|团队|客户|后台|管理/,
    /AI|agent|模型|生成|自动化|集成|第三方/i,
    /免费|额度|计费|成本|滥用|安全|合规/,
  ];
  const vaguePatterns = [
    /体验|优化|提升|更好|智能|自动|高效|完整|体系|平台/,
    /我希望|用户反馈|考虑不全|模糊|大概|可能/,
  ];
  const simpleConcretePatterns = [
    /按钮|文案|颜色|圆角|位置|间距|字号|图标|标题|空格|标点|错别字|拼写|label|copy/i,
    /红圈|描边|边框|卡片|平铺|去掉|去除|移除|隐藏|对齐|留白|背景/,
    /从.+(改到|移到|移动到|换到|变成|改成|改为).+/,
  ];
  const reasons = [];
  if (text.length >= 80) {
    reasons.push('输入较长，包含多个意图或约束');
  }
  if (includesAny(text, complexPatterns)) {
    reasons.push('涉及新能力、模块、流程、权限、成本或集成');
  }
  if (includesAny(text, vaguePatterns)) {
    reasons.push('表达仍偏目标或体验，需要先收敛用户场景');
  }

  const simpleConcrete = text.length <= 80
    && includesAny(text, simpleConcretePatterns)
    && !includesAny(text, [/新增|新建|模块|流程|编排|一站式|权限|审批|agent|AI/i]);

  if (simpleConcrete) {
    return {
      mode: 'focused',
      label: '轻量项目映射',
      minimumDepth: 1,
      questionLimit: 3,
      reasons: ['输入看起来是明确的局部调整，只需要确认影响位置和验收方式'],
    };
  }

  if (reasons.length > 0) {
    return {
      mode: 'deep',
      label: '三轮需求自省',
      minimumDepth: 3,
      questionLimit: 6,
      reasons,
    };
  }

  return {
    mode: 'focused',
    label: '轻量需求自省',
    minimumDepth: 1,
    questionLimit: 4,
    reasons: ['需求目标相对聚焦，但仍需要结合当前项目确认范围和验收方式'],
  };
}

function shortList(items, fallback = '待补充') {
  const list = (Array.isArray(items) ? items : [items]).map((item) => String(item || '').trim()).filter(Boolean);
  return list.length > 0 ? list.slice(0, 3).join('；') : fallback;
}

function normalizeClarifyMode(mode) {
  if (mode === 'artifact') {
    return 'inline-with-checklist';
  }
  return ['auto', 'inline', 'inline-with-checklist'].includes(mode) ? mode : 'auto';
}

function estimateInlineClarificationLines(clarification, reflection) {
  const activeChangeLines = reflection?.projectContext?.activeChange ? 1 : 0;
  return 4
    + clarification.mustAskUser.length
    + Math.min(clarification.canInferLater.length, 2)
    + activeChangeLines;
}

function isLightweightClarifyQuestion(item) {
  const id = String(item?.id ?? '');
  return /^(meta|users|goals|scope|scenarios|requirements)\./.test(id);
}

function chooseClarifyPresentation({ requirementGate, clarification, reflection, requestedMode = 'auto' }) {
  const normalizedMode = normalizeClarifyMode(requestedMode);
  const estimatedLineCount = estimateInlineClarificationLines(clarification, reflection);
  const questionCount = clarification.mustAskUser.length;
  const substantialQuestionCount = clarification.mustAskUser.filter((item) => !isLightweightClarifyQuestion(item)).length;
  const defaultMode = !requirementGate?.active || substantialQuestionCount > 2 || questionCount > 2 || reflection?.mode === 'deep' || estimatedLineCount > 8
    ? 'inline-with-checklist'
    : 'inline';
  const mode = normalizedMode === 'auto' ? defaultMode : normalizedMode;
  const reason = mode === 'inline-with-checklist'
    ? '澄清阶段只在对话内呈现，当前需求用摘要和简短清单确认；正式 HTML 评审留给后续 review。'
    : '当前需求可以用十句话以内讲清楚，直接在对话内确认，降低用户跳转成本。';
  return {
    mode,
    label: mode === 'inline-with-checklist' ? '对话内澄清 + 简短清单' : '对话内澄清',
    estimatedLineCount,
    questionCount,
    substantialQuestionCount,
    reason,
  };
}

function buildInlineClarification({ clarification, reflection, presentation }) {
  if (!presentation?.mode?.startsWith('inline')) {
    return null;
  }
  const prompt = reflection?.promptPreview || '本轮需求';
  const projectContext = reflection?.projectContext ?? {};
  const lines = [
    `我理解的目标：${prompt}`,
    `落点：${projectContext.productName ?? '当前项目'}；按${projectContext.scenario ?? '当前工作区'}处理。`,
    '范围边界：只处理本轮需求，不自动合并历史 active change 或未提到的扩展。',
    '验收方式：确认用户能看到或完成的结果，以及哪些既有行为不能被改变。',
  ];
  if (projectContext.activeChange) {
    lines.push(`历史提醒：当前还有 ${projectContext.activeChange.activeChange}，本轮先分开处理。`);
  }
  const questions = clarification.mustAskUser.slice(0, presentation.mode === 'inline' ? 3 : 5);
  if (questions.length > 0) {
    lines.push('建议确认：');
    for (const item of questions) {
      lines.push(`- ${item.prompt}`);
    }
  } else {
    lines.push('建议确认：如果以上理解正确，用户回复“可以”或“确认执行”后再继续。');
  }
  return {
    mode: presentation.mode,
    title: presentation.label,
    estimatedLineCount: presentation.estimatedLineCount,
    lines,
  };
}

async function readActiveChangeHint(projectRoot) {
  const state = await readJson(path.join(projectRoot, '.openprd', 'state', 'changes.json')).catch(() => null);
  const activeChange = state?.activeChange ?? null;
  if (!activeChange) {
    return null;
  }
  return {
    activeChange,
    status: state?.changes?.[activeChange]?.status ?? 'active',
  };
}

function reflectionQuestion(id, label, prompt) {
  return {
    id: `requirement-intake.${id}`,
    title: label,
    label,
    question: prompt,
    prompt,
    reason: 'requirement-intake-reflection',
  };
}

async function buildRequirementIntakeReflection({ projectRoot, ws, snapshot, analysis, scenario, gate }) {
  if (!gate?.active) {
    return null;
  }

  const text = requirementPrompt(gate);
  const complexity = detectRequirementIntakeComplexity(gate);
  const activeChange = await readActiveChangeHint(projectRoot);
  const sections = snapshot.sections ?? {};
  const productName = snapshot.title || sections.meta?.title || '当前项目';
  const productType = snapshot.productType ?? resolveCurrentProductType(ws) ?? '未分类';
  const currentProblem = sections.problem?.problemStatement || '待补充';
  const currentScope = shortList(sections.scope?.inScope, '当前范围还没有稳定记录');
  const missing = analysis.missingFields.slice(0, 4).map((field) => field.label);
  const needsInterfaceSketch = requirementLooksLikeInterfaceWork(gate);
  const mustConfirm = complexity.mode === 'deep'
    ? [
        reflectionQuestion('intent', '意图与目标', '请确认我对需求目标的理解：目标用户是谁、在哪个场景下，需要完成什么结果？'),
        reflectionQuestion('project-context', '项目影响范围', '结合当前项目，哪些已有模块、入口、流程或历史需求必须复用，哪些可以调整？'),
        reflectionQuestion('scope-quality', '范围与验收', '这个需求的范围内、范围外、成功标准和失败路径分别是什么？'),
        needsInterfaceSketch
          ? reflectionQuestion('interface-sketch', '界面或流程草图', '需求涉及界面或流程，请先确认主要区域、操作入口、预览/确认点和风险提示。')
          : reflectionQuestion('details-boundary', '细节与边界', '请确认关键字段、状态变化、数据来源、权限边界和可验收细节。'),
      ]
    : [
        reflectionQuestion('project-context', '项目映射', '请确认这个调整具体落在哪个页面、模块、入口或流程，以及哪些已有行为不能被改变。'),
        reflectionQuestion('acceptance', '验收方式', '请确认完成后用户能看到或做到什么，以及最小验收标准是什么。'),
      ];

  return {
    version: 1,
    active: true,
    mode: complexity.mode,
    label: complexity.label,
    minimumDepth: complexity.minimumDepth,
    questionLimit: gateQuestionLimit(gate, complexity.questionLimit),
    promptPreview: text,
    reasons: complexity.reasons,
    needsInterfaceSketch,
    projectContext: {
      scenario: scenario.label,
      scenarioReason: scenario.reason,
      productName,
      productType,
      currentProblem,
      currentScope,
      activeChange,
      missingFields: missing,
    },
    rounds: [
      {
        id: 'intent-normalization',
        title: '第 1 轮：意图归一化',
        findings: [
          `用户原始输入：${text || '待补充'}`,
          `初步判断：${complexity.label}`,
          `需要先把表达收敛成用户、场景、目标、动作和期望结果。`,
        ],
      },
      {
        id: 'project-context',
        title: '第 2 轮：项目上下文映射',
        findings: [
          `工作区场景：${scenario.label}，${scenario.reason}`,
          `当前产品：${productName}（${productType}），已记录问题：${currentProblem}`,
          `当前范围线索：${currentScope}`,
          activeChange ? `仍有 active change：${activeChange.activeChange}（${activeChange.status}），需要和本轮需求分开评估。` : '当前没有检测到 active change 冲突。',
        ],
      },
      {
        id: 'product-quality',
        title: '第 3 轮：产品质量自检',
        findings: [
          `仍需确认的信息：${shortList(missing, '暂无明显缺口')}`,
          needsInterfaceSketch ? '需求看起来涉及界面或流程，需要先给用户确认草图或关键操作路径。' : '需求暂未明显命中界面，但仍要确认状态、边界和验收方式。',
          '进入实现前必须保留范围、非目标、异常路径和验收证据。',
        ],
      },
    ],
    mustConfirm,
  };
}

function renderRequirementIntakeReflection(reflection) {
  if (!reflection?.active) {
    return '# 需求入口自省\n\n- 当前没有 active requirement intake。\n';
  }
  const lines = [
    '# 需求入口自省',
    '',
    `- 模式: ${reflection.label}`,
    `- 用户输入: ${reflection.promptPreview || '待补充'}`,
    `- 复杂度依据: ${shortList(reflection.reasons, '未命中复杂度提示')}`,
    '',
    '## 项目上下文',
    '',
    `- 工作区场景: ${reflection.projectContext.scenario}`,
    `- 当前产品: ${reflection.projectContext.productName} (${reflection.projectContext.productType})`,
    `- 当前问题: ${reflection.projectContext.currentProblem}`,
    `- 当前范围: ${reflection.projectContext.currentScope}`,
    reflection.projectContext.activeChange ? `- 历史 active change: ${reflection.projectContext.activeChange.activeChange}` : '- 历史 active change: 无',
    '',
  ];
  for (const round of reflection.rounds) {
    lines.push(`## ${round.title}`, '');
    for (const finding of round.findings) {
      lines.push(`- ${finding}`);
    }
    lines.push('');
  }
  lines.push('## 必须确认的问题', '');
  for (const question of reflection.mustConfirm) {
    lines.push(`- ${question.label}: ${question.prompt}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function writeRequirementIntakeReflection(ws, reflection) {
  if (!reflection?.active) {
    return null;
  }
  const reflectionPath = path.join(ws.workspaceRoot, 'engagements', 'active', 'intake-reflection.md');
  await writeText(reflectionPath, renderRequirementIntakeReflection(reflection));
  return reflectionPath;
}

function buildRequirementIntakeDepth(gate, reflection = null) {
  const needsInterfaceSketch = requirementLooksLikeInterfaceWork(gate);
  const fallbackLayers = [
    reflectionQuestion('product-context', '用户 / 场景 / 问题', '先确认：什么用户，在什么场景下，遇到什么问题？为什么现在值得解决？'),
    reflectionQuestion('product-outcome', '目标 / 影响 / 成功标准', '解决后用户能完成什么？减少什么成本或风险？用什么成功指标或验收标准判断有效？'),
    reflectionQuestion('product-flow', '现状流程 / 目标流程 / 异常路径', '请拆出当前流程、目标流程、关键决策点、失败路径，以及哪些动作必须由用户确认。'),
    reflectionQuestion(
      'product-detail',
      needsInterfaceSketch ? '界面草图 / 字段 / 状态' : '细节 / 状态 / 边界',
      needsInterfaceSketch
        ? '这个需求涉及界面，请先给用户一版 ASCII 线框草图，标出主要区域、操作入口、预览/确认点和风险提示，让用户确认后再 synthesize。'
        : '请补齐关键字段、状态变化、数据来源、权限边界和可验收细节；如果后续发现涉及界面，也要先补 ASCII 线框草图。'
    ),
  ];
  const layers = reflection?.mustConfirm?.length > 0 ? reflection.mustConfirm : fallbackLayers;
  return {
    active: true,
    mode: reflection?.mode ?? 'deep',
    label: reflection?.label ?? '需求入口深挖',
    minimumDepth: reflection?.minimumDepth ?? 3,
    questionLimit: gateQuestionLimit(gate, reflection?.questionLimit ?? 6),
    needsInterfaceSketch,
    promptPreview: gate?.promptPreview ?? '',
    reflection,
    layers,
  };
}

function applyRequirementIntakeDepth(clarification, gate, reflection = null, options = {}) {
  if (!gate?.active) {
    return clarification;
  }

  const requirementIntake = buildRequirementIntakeDepth(gate, reflection);
  if (options.satisfied) {
    return {
      ...clarification,
      requirementIntake: {
        ...requirementIntake,
        satisfied: true,
      },
      shouldAskUser: false,
    };
  }
  const existingIds = new Set(clarification.mustAskUser.map((item) => item.id));
  const depthQuestions = requirementIntake.layers
    .filter((item) => !existingIds.has(item.id));

  if (!clarification.shouldAskUser && clarification.mustAskUser.length === 0 && depthQuestions.length === 0) {
    return {
      ...clarification,
      requirementIntake: {
        ...requirementIntake,
        satisfied: true,
      },
    };
  }

  const combined = [...depthQuestions, ...clarification.mustAskUser];
  const mustAskUser = combined.slice(0, requirementIntake.questionLimit);
  const deferred = combined.slice(requirementIntake.questionLimit).map((item) => ({
    id: item.id,
    label: item.label,
    prompt: item.prompt,
  }));

  return {
    ...clarification,
    requirementIntake,
    mustAskUser,
    canInferLater: [...deferred, ...clarification.canInferLater],
    shouldAskUser: true,
  };
}

function parseArtifactFrontmatter(text) {
  if (!text.startsWith('---\n')) {
    throw new Error('Artifact markdown is missing frontmatter.');
  }
  const end = text.indexOf('\n---', 4);
  if (end < 0) {
    throw new Error('Artifact markdown frontmatter is not closed.');
  }
  return parseYamlText(text.slice(4, end));
}

function buildPlaygroundState(snapshot) {
  const sections = snapshot.sections ?? {};
  return {
    problemStatement: sections.problem?.problemStatement ?? '',
    goals: [...(sections.goals?.goals ?? [])],
    successMetrics: [...(sections.goals?.successMetrics ?? [])],
    inScope: [...(sections.scope?.inScope ?? [])],
    outOfScope: [...(sections.scope?.outOfScope ?? [])],
    primaryFlows: [...(sections.scenarios?.primaryFlows ?? [])],
    openQuestions: [...(sections.risks?.openQuestions ?? [])],
  };
}

async function getPrdReviewState(ws, latestSnapshot = null) {
  const currentState = ws.data.currentState ?? {};
  const latestVersionId = latestSnapshot?.versionId ?? currentState.latestVersionId ?? null;
  const stored = currentState.reviewStatus ?? null;
  const reviewPath = stored?.reviewPath
    ?? stored?.stableArtifact
    ?? (latestVersionId ? canonicalReviewPath(ws, latestVersionId) : null);
  const entryPath = stored?.entryPath ?? stored?.artifact ?? defaultReviewArtifactPath(ws);
  const artifactExists = reviewPath ? await exists(reviewPath) : false;
  const status = stored?.versionId === latestVersionId
    ? normalizePrdReviewStatus(stored.status)
    : (artifactExists ? 'pending-confirmation' : 'missing');
  let reason = '最新 PRD 评审产物已确认。';
  if (!artifactExists) {
    reason = '缺少最新 PRD 评审文件，freeze 前需要重新生成可评审产物。';
  } else if (status === 'pending-confirmation') {
    reason = '最新 PRD 评审文件尚未标记为用户已确认。';
  } else if (status === 'needs-revision') {
    reason = '最新 PRD 评审文件已标记为需要修改，不能直接 freeze。';
  }
  return {
    versionId: latestVersionId,
    status,
    artifactExists,
    artifact: reviewPath,
    entryArtifact: entryPath,
    shouldGateFreeze: Boolean(latestVersionId) && (!artifactExists || status !== 'confirmed'),
    reason,
    updatedAt: stored?.updatedAt ?? null,
    notes: stored?.notes ?? null,
  };
}

async function synthesizeWorkspace(projectRoot, overrides = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }
  ensureFreshRequirementStateForSynthesize({
    gate: await readActiveRequirementGate(projectRoot),
    currentState: ws.data.currentState ?? {},
    overrides,
  });

  const versionIndex = await readVersionIndex(ws);
  const nextVersionNumber = overrides.versionNumber ?? (versionIndex.length > 0
    ? Math.max(...versionIndex.map((entry) => Number(entry.versionNumber) || 0)) + 1
    : 1);
  const versionId = overrides.versionId ?? formatVersionId(nextVersionNumber);
  const createdAt = overrides.createdAt ?? timestamp();
  const workUnitId = normalizeWorkUnitId(overrides.workUnit ?? overrides.workUnitId) ?? generateWorkUnitId();
  const targetRoot = resolveTargetRoot(ws, overrides.targetRoot);
  const baseCurrentState = {
    ...(ws.data.currentState ?? {}),
    captureMeta: {
      ...((ws.data.currentState ?? {}).captureMeta ?? {}),
    },
  };
  if (shouldDropInheritedReviewPresentationFromOverrides(overrides)) {
    dropInheritedReviewPresentation(baseCurrentState);
  }
  const snapshot = buildPrdSnapshot({ ...ws, data: { ...ws.data, currentState: baseCurrentState } }, {
    ...overrides,
    versionNumber: nextVersionNumber,
    versionId,
    createdAt,
    workUnitId,
    targetRoot,
    productType: overrides.productType ?? resolveCurrentProductType(ws),
    templatePack: overrides.templatePack ?? resolveActiveTemplatePack(ws),
  });

  snapshot.content = renderPrdMarkdown(snapshot);
  snapshot.digest = crypto.createHash('sha256').update(snapshot.content).digest('hex');
  assertOpenSpecPreflightReady(snapshot);

  await writeVersionSnapshot(ws, snapshot);

  const indexEntry = summarizeSnapshot(snapshot);
  await writeVersionIndex(ws, [...versionIndex, indexEntry]);

  await writeText(ws.paths.activePrd, snapshot.content);
  await writeText(ws.paths.activeFlows, renderFlowDoc(snapshot));
  await writeText(ws.paths.activeRoles, renderRolesDoc(snapshot));
  await writeText(ws.paths.activeHandoff, renderHandoffDoc(snapshot));
  const reviewFiles = await writeReviewFiles(ws, snapshot);
  const workUnit = await writeWorkUnitBinding(ws, {
    snapshot,
    reviewPath: reviewFiles.canonicalReview,
    activeReviewPath: reviewFiles.activeReviewEntry,
    targetRoot,
  });
  if (overrides.open) {
    await openArtifactInBrowser(reviewFiles.canonicalReview);
  }
  await writeJson(ws.paths.taskGraph, buildWorkflowTaskGraph(snapshot));
  await appendWorkflowEvent(ws, 'synthesized', {
    versionId: snapshot.versionId,
    versionNumber: snapshot.versionNumber,
    productType: snapshot.productType,
    reviewArtifact: reviewFiles.canonicalReview,
  });
  await appendDecision(ws, [
    `已生成版本 ${snapshot.versionId}。`,
    `产品类型: ${snapshot.productType ?? '未分类'}。`,
    `模板包: ${snapshot.templatePack}。`,
    `Digest: ${snapshot.digest}.`,
  ]);
  await appendProgress(ws, [
    `已生成 PRD 快照 ${snapshot.versionId}。`,
    `已更新当前 PRD、流程、角色和交接文档。`,
  ]);

  const currentState = syncCurrentSnapshotCache({
    ...baseCurrentState,
    captureMeta: {
      ...baseCurrentState.captureMeta,
      ...(overrides.title ? { 'meta.title': { source: 'user-confirmed', capturedAt: timestamp() } } : {}),
      ...(overrides.owner ? { 'meta.owner': { source: 'user-confirmed', capturedAt: timestamp() } } : {}),
      ...(overrides.problemStatement ? { 'problem.problemStatement': { source: 'user-confirmed', capturedAt: timestamp() } } : {}),
      ...(overrides.whyNow ? { 'problem.whyNow': { source: 'user-confirmed', capturedAt: timestamp() } } : {}),
      ...(overrides.evidence ? { 'problem.evidence': { source: 'user-confirmed', capturedAt: timestamp() } } : {}),
      ...(overrides.productType ? { 'meta.productType': { source: 'user-confirmed', capturedAt: timestamp() } } : {}),
    },
    status: 'synthesized',
    prdVersion: snapshot.versionNumber,
    latestVersionId: snapshot.versionId,
    latestVersionDigest: snapshot.digest,
    activeWorkUnitId: snapshot.workUnitId,
    targetRoot,
    reviewStatus: {
      versionId: snapshot.versionId,
      workUnitId: snapshot.workUnitId,
      status: 'pending-confirmation',
      reviewPath: reviewFiles.canonicalReview,
      entryPath: reviewFiles.activeReviewEntry,
      artifact: reviewFiles.activeReviewEntry,
      stableArtifact: reviewFiles.canonicalReview,
      updatedAt: snapshot.createdAt,
    },
    title: snapshot.title,
    owner: snapshot.owner,
    productType: snapshot.productType,
    templatePack: snapshot.templatePack,
    synthesizedAt: snapshot.createdAt,
  }, snapshot);
  await writeJson(ws.paths.currentState, currentState);
  const nextWs = { ...ws, data: { ...ws.data, currentState } };
  await syncSessionBindingFromSnapshot(projectRoot, snapshot, {
    reviewStatus: 'pending-confirmation',
    reviewPath: reviewFiles.canonicalReview,
    activeReviewPath: reviewFiles.activeReviewEntry,
    targetRoot,
  });

  return {
    ws: nextWs,
    snapshot,
    currentState,
    indexEntry,
    versionIndex: [...versionIndex, indexEntry],
    reviewArtifact: reviewFiles.activeReviewEntry,
    stableReviewArtifact: reviewFiles.canonicalReview,
    reviewPath: reviewFiles.canonicalReview,
    reviewEntryPath: reviewFiles.activeReviewEntry,
    workUnitId: snapshot.workUnitId,
    workUnit,
    opened: Boolean(overrides.open),
  };
}

async function diffWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const index = await readVersionIndex(ws);
  if (index.length === 0) {
    throw new Error('No synthesized PRD versions exist yet. Run openprd synthesize first.');
  }

  const requestedFrom = normalizeVersionId(options.from);
  const requestedTo = normalizeVersionId(options.to);

  const fromEntry = requestedFrom
    ? index.find((entry) => normalizeVersionId(entry.versionId) === requestedFrom)
    : index[index.length - 2] ?? null;
  const toEntry = requestedTo
    ? index.find((entry) => normalizeVersionId(entry.versionId) === requestedTo)
    : index[index.length - 1] ?? null;

  if (!fromEntry || !toEntry) {
    throw new Error('Need at least two PRD versions to diff.');
  }

  const before = await readVersionSnapshot(ws, fromEntry.versionId);
  const after = await readVersionSnapshot(ws, toEntry.versionId);
  if (!before || !after) {
    throw new Error('Unable to read one or both PRD version snapshots.');
  }

  const diff = diffSnapshots(before, after);
  return { ws, before, after, diff };
}

async function reviewWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }
  const latest = await loadLatestVersionSnapshot(ws);
  if (!latest?.snapshot) {
    return {
      ok: false,
      action: 'review',
      projectRoot,
      errors: ['No synthesized PRD version exists yet. Run openprd synthesize first.'],
    };
  }

  const requestedVersion = normalizeVersionId(options.version);
  const snapshot = requestedVersion
    ? await readVersionSnapshot(ws, requestedVersion)
    : latest.snapshot;
  if (!snapshot) {
    return {
      ok: false,
      action: 'review',
      projectRoot,
      errors: [`No synthesized PRD version found for ${options.version}.`],
    };
  }

  let requestedWorkUnitId = null;
  try {
    requestedWorkUnitId = normalizeWorkUnitId(options.workUnit ?? options.workUnitId);
  } catch (error) {
    return {
      ok: false,
      action: 'review',
      projectRoot,
      versionId: snapshot.versionId,
      errors: [error.message],
    };
  }

  const validationErrors = [];
  if (options.digest && options.digest !== snapshot.digest) {
    validationErrors.push(`Digest mismatch for ${snapshot.versionId}: expected ${snapshot.digest}, got ${options.digest}.`);
  }
  if (requestedWorkUnitId && snapshot.workUnitId !== requestedWorkUnitId) {
    validationErrors.push(`Work unit mismatch for ${snapshot.versionId}: expected ${snapshot.workUnitId ?? 'none'}, got ${requestedWorkUnitId}.`);
  }
  if (validationErrors.length > 0) {
    return {
      ok: false,
      action: 'review',
      projectRoot,
      versionId: snapshot.versionId,
      workUnitId: snapshot.workUnitId ?? null,
      status: 'blocked',
      errors: validationErrors,
    };
  }

  const isLatest = normalizeVersionId(snapshot.versionId) === normalizeVersionId(latest.snapshot.versionId);
  const reviewFiles = await writeReviewFiles(ws, snapshot, { writeEntry: isLatest });
  const bindingBefore = await readWorkUnitBinding(ws, snapshot.workUnitId);
  const before = isLatest
    ? await getPrdReviewState(ws, snapshot)
    : {
        status: normalizePrdReviewStatus(bindingBefore?.status ?? 'pending-confirmation'),
        artifact: reviewFiles.canonicalReview,
      };
  let marked = false;
  let status = before.status;
  let workUnit = bindingBefore;
  if (options.mark) {
    status = normalizePrdReviewStatus(options.mark);
    if (status !== options.mark) {
      throw new Error(`Unsupported review status: ${options.mark}`);
    }
    if (isLatest) {
      const currentState = {
        ...(ws.data.currentState ?? {}),
        activeWorkUnitId: snapshot.workUnitId ?? (ws.data.currentState ?? {}).activeWorkUnitId,
        targetRoot: snapshot.targetRoot ?? (ws.data.currentState ?? {}).targetRoot,
        reviewStatus: {
          versionId: snapshot.versionId,
          workUnitId: snapshot.workUnitId ?? null,
          status,
          reviewPath: reviewFiles.canonicalReview,
          entryPath: reviewFiles.activeReviewEntry,
          artifact: reviewFiles.activeReviewEntry,
          stableArtifact: reviewFiles.canonicalReview,
          updatedAt: timestamp(),
          notes: options.notes ?? null,
        },
      };
      await writeJson(ws.paths.currentState, currentState);
    }
    workUnit = await writeWorkUnitBinding(ws, {
      snapshot,
      reviewPath: reviewFiles.canonicalReview,
      activeReviewPath: reviewFiles.activeReviewEntry,
      targetRoot: snapshot.targetRoot,
      status,
    });
    await appendWorkflowEvent(ws, 'review_marked', {
      versionId: snapshot.versionId,
      workUnitId: snapshot.workUnitId ?? null,
      status,
    });
    await appendProgress(ws, [
      `PRD 评审状态: ${status}。`,
      `版本: ${snapshot.versionId}。`,
      snapshot.workUnitId ? `工作单元: ${snapshot.workUnitId}。` : null,
    ]);
    await syncSessionBindingFromReview(projectRoot, snapshot, {
      reviewStatus: status,
      reviewPath: reviewFiles.canonicalReview,
      activeReviewPath: reviewFiles.activeReviewEntry,
      targetRoot: snapshot.targetRoot,
    });
    marked = true;
  }

  const reloaded = await loadWorkspace(projectRoot);
  const after = isLatest
    ? await getPrdReviewState(reloaded, snapshot)
    : {
        status,
        artifactExists: await exists(reviewFiles.canonicalReview),
        artifact: reviewFiles.canonicalReview,
        entryArtifact: null,
      };
  if (options.open && (await exists(reviewFiles.canonicalReview))) {
    await openArtifactInBrowser(reviewFiles.canonicalReview);
  }

  return {
    ok: after.artifactExists,
    action: 'review',
    projectRoot,
    versionId: snapshot.versionId,
    workUnitId: snapshot.workUnitId ?? null,
    status: after.status,
    previousStatus: before.status,
    marked,
    reviewArtifact: after.entryArtifact ?? reviewFiles.activeReviewEntry,
    stableReviewArtifact: after.artifact,
    reviewPath: after.artifact,
    reviewEntryPath: after.entryArtifact ?? reviewFiles.activeReviewEntry,
    workUnit,
    opened: Boolean(options.open && after.artifactExists),
    errors: after.artifactExists ? [] : ['Missing review file. Run openprd synthesize . --open'],
  };
}

async function clarifyWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const versionIndex = await readVersionIndex(ws);
  const currentState = ws.data.currentState ?? {};
  const snapshot = (await loadLatestVersionSnapshot(ws))?.snapshot ?? buildPrdSnapshot(ws, {
    ...currentState,
    versionNumber: currentState.prdVersion ?? (versionIndex.at(-1)?.versionNumber ?? 0),
    versionId: currentState.prdVersion > 0
      ? formatVersionId(currentState.prdVersion)
      : (versionIndex.at(-1)?.versionId ?? 'v0000'),
    productType: resolveCurrentProductType(ws),
    templatePack: resolveActiveTemplatePack(ws),
    status: currentState.status ?? 'draft',
  });

  const analysis = analyzePrdSnapshot(snapshot);
  const basePlan = buildClarificationPlan(snapshot, analysis);
  const scenario = await detectWorkspaceScenario(projectRoot, ws, versionIndex);
  const requirementGate = await readActiveRequirementGate(projectRoot);
  const intakeReflection = await buildRequirementIntakeReflection({
    projectRoot,
    ws,
    snapshot,
    analysis,
    scenario,
    gate: requirementGate,
  });
  const intakeReflectionPath = await writeRequirementIntakeReflection(ws, intakeReflection);
  const prdReviewState = await getPrdReviewState(ws, snapshot);
  const clarification = applyRequirementIntakeDepth(buildClarificationState({
    snapshot,
    analysis,
    basePlan,
    scenario,
    captureMeta: ws.data.currentState?.captureMeta ?? {},
    prdReviewState,
    limit: Number(options.limit ?? 8),
  }), requirementGate, intakeReflection);
  const clarifyPresentation = chooseClarifyPresentation({
    requirementGate,
    clarification,
    reflection: intakeReflection,
    requestedMode: options.mode ?? 'auto',
  });
  const inlineClarification = buildInlineClarification({
    clarification,
    reflection: intakeReflection,
    presentation: clarifyPresentation,
  });

  await appendWorkflowEvent(ws, 'clarify', {
    missingRequiredFields: clarification.missingRequiredFields,
    mustAskUser: clarification.mustAskUser.map((item) => item.id),
    scenario: clarification.scenario.id,
    intakeReflection: intakeReflectionPath ? path.relative(ws.workspaceRoot, intakeReflectionPath) : null,
    presentationMode: clarifyPresentation.mode,
  });
  await appendOpenQuestions(ws, clarification.mustAskUser.map((item) => item.prompt));
  let clarifyHtmlPath = null;
  let clarifyBundle = null;
  if (options.open && clarifyHtmlPath) {
    await openArtifactInBrowser(clarifyHtmlPath);
  }

  return {
    ws,
    snapshot,
    analysis,
    clarification,
    clarifyPresentation,
    inlineClarification,
    clarifyArtifact: clarifyHtmlPath,
    clarifyArtifactBundle: clarifyBundle,
    intakeReflection,
    intakeReflectionPath,
    opened: Boolean(options.open && clarifyHtmlPath),
  };
}

async function playgroundWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const versionIndex = await readVersionIndex(ws);
  const currentState = ws.data.currentState ?? {};
  const snapshot = (await loadLatestVersionSnapshot(ws))?.snapshot ?? buildPrdSnapshot(ws, {
    ...currentState,
    versionNumber: currentState.prdVersion ?? (versionIndex.at(-1)?.versionNumber ?? 0),
    versionId: currentState.prdVersion > 0
      ? formatVersionId(currentState.prdVersion)
      : (versionIndex.at(-1)?.versionId ?? 'v0000'),
    productType: resolveCurrentProductType(ws),
    templatePack: resolveActiveTemplatePack(ws),
    status: currentState.status ?? 'draft',
  });

  const state = buildPlaygroundState(snapshot);
  const bundle = artifactBundlePaths(ws, `${snapshot.versionId}-playground`);
  const markdown = renderPlaygroundMarkdown({ snapshot, state });
  const patch = renderPlaygroundPatch({ state });
  await writeText(bundle.markdown, markdown);
  await writeJson(bundle.patch, patch);
  await writeHtmlArtifact(bundle.html, renderPlaygroundArtifact({
    snapshot,
    state,
    markdownPath: bundle.markdown,
    patchPath: bundle.patch,
  }));
  await appendWorkflowEvent(ws, 'playground_generated', {
    versionId: snapshot.versionId,
    htmlPath: bundle.html,
    markdownPath: bundle.markdown,
    patchPath: bundle.patch,
  });
  await appendProgress(ws, [
    `已生成 playground artifact bundle: ${path.relative(ws.workspaceRoot, bundle.dir)}。`,
  ]);
  if (options.open) {
    await openArtifactInBrowser(bundle.html);
  }

  return {
    ws,
    snapshot,
    state,
    htmlPath: bundle.html,
    markdownPath: bundle.markdown,
    patchPath: bundle.patch,
    opened: Boolean(options.open),
  };
}

async function captureWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const currentState = {
    ...(ws.data.currentState ?? {}),
  };
  currentState.captureMeta = {
    ...(currentState.captureMeta ?? {}),
  };

  const updates = [];

  if (options.artifactMarkdown) {
    const artifactText = await readText(path.resolve(options.artifactMarkdown));
    const artifact = parseArtifactFrontmatter(artifactText);
    const payload = artifact.capturePatch;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Artifact markdown frontmatter is missing capturePatch.');
    }

    for (const [field, rawEntry] of Object.entries(payload)) {
      const stateKey = FIELD_PATH_TO_STATE_KEY[field];
      if (!stateKey) {
        throw new Error(`Unsupported capture field in artifact markdown: ${field}`);
      }
      const value = rawEntry?.value ?? rawEntry;
      const source = rawEntry?.source ?? options.source;
      const append = rawEntry?.append ?? options.append;
      if (value === null || value === undefined) {
        throw new Error(`Missing capture value in artifact markdown for field: ${field}`);
      }
      updates.push({
        field,
        stateKey,
        value,
        source: CAPTURE_SOURCES.includes(source) ? source : 'user-confirmed',
        append: Boolean(append),
      });
    }
  } else if (options.jsonFile) {
    const payload = await readJson(path.resolve(options.jsonFile));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Capture JSON file must contain an object at the root');
    }

    for (const [field, rawEntry] of Object.entries(payload)) {
      const stateKey = FIELD_PATH_TO_STATE_KEY[field];
      if (!stateKey) {
        throw new Error(`Unsupported capture field in json file: ${field}`);
      }

      let value = rawEntry;
      let source = options.source;
      let append = Boolean(options.append);

      if (rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry) && ('value' in rawEntry || 'source' in rawEntry || 'append' in rawEntry)) {
        value = rawEntry.value;
        source = rawEntry.source ?? source;
        append = rawEntry.append ?? append;
      }

      if (value === null || value === undefined) {
        throw new Error(`Missing capture value in json file for field: ${field}`);
      }

      updates.push({
        field,
        stateKey,
        value,
        source: CAPTURE_SOURCES.includes(source) ? source : 'user-confirmed',
        append: Boolean(append),
      });
    }
  } else {
    const field = options.field?.trim();
    if (!field) {
      throw new Error('Missing required option: --field');
    }
    const stateKey = FIELD_PATH_TO_STATE_KEY[field];
    if (!stateKey) {
      throw new Error(`Unsupported capture field: ${field}`);
    }
    if (options.value === null || options.value === undefined) {
      throw new Error('Missing required option: --value');
    }
    updates.push({
      field,
      stateKey,
      value: options.value,
      source: CAPTURE_SOURCES.includes(options.source) ? options.source : 'user-confirmed',
      append: Boolean(options.append),
    });
  }

  const applied = [];
  for (const update of updates) {
    const nextValue = coerceCapturedValue(update.field, update.value, update.append);

    if (update.append) {
      const prev = currentState[update.stateKey];
      const prevArray = Array.isArray(prev)
        ? prev
        : (prev ? coerceCapturedValue(update.field, prev, true) : []);
      const nextArray = Array.isArray(nextValue) ? nextValue : [nextValue];
      currentState[update.stateKey] = [...prevArray, ...nextArray];
    } else {
      currentState[update.stateKey] = nextValue;
    }

    applied.push({
      field: update.field,
      stateKey: update.stateKey,
      source: update.source,
      value: currentState[update.stateKey],
    });
  }

  currentState.lastCapturedAt = timestamp();
  currentState.status = currentState.status === 'initialized' ? 'clarifying' : (currentState.status ?? 'clarifying');
  for (const update of applied) {
    currentState.captureMeta[update.field] = {
      source: update.source,
      capturedAt: currentState.lastCapturedAt,
    };
  }
  const staleReview = markReviewStateStaleAfterCapture(currentState, applied, currentState.lastCapturedAt);
  await writeJson(ws.paths.currentState, currentState);

  const snapshot = buildPrdSnapshot({ ...ws, data: { ...ws.data, currentState } }, {
    ...currentState,
    versionNumber: currentState.prdVersion ?? 0,
    versionId: currentState.prdVersion > 0 ? formatVersionId(currentState.prdVersion) : 'v0000',
    productType: currentState.productType ?? resolveCurrentProductType(ws),
    templatePack: currentState.templatePack ?? resolveActiveTemplatePack(ws),
  });
  const analysis = analyzePrdSnapshot(snapshot);
  const diagramState = await getDiagramReviewState({ ...ws, data: { ...ws.data, currentState } }, snapshot);
  const updatedWs = { ...ws, data: { ...ws.data, currentState } };
  const scenario = await detectWorkspaceScenario(projectRoot, updatedWs, await readVersionIndex(ws));
  const requirementGate = await readActiveRequirementGate(projectRoot);
  const intakeReflection = await buildRequirementIntakeReflection({
    projectRoot,
    ws: updatedWs,
    snapshot,
    analysis,
    scenario,
    gate: requirementGate,
  });
  await writeRequirementIntakeReflection(updatedWs, intakeReflection);
  const prdReviewState = await getPrdReviewState(updatedWs, snapshot);
  const clarification = applyRequirementIntakeDepth(buildClarificationState({
    snapshot,
    analysis,
    basePlan: buildClarificationPlan(snapshot, analysis),
    scenario,
    captureMeta: currentState.captureMeta,
    prdReviewState,
    limit: 8,
  }), requirementGate, intakeReflection);
  await writeJson(ws.paths.taskGraph, buildWorkflowTaskGraph(snapshot, analysis, { diagramState, clarificationState: clarification }));
  await appendWorkflowEvent(ws, 'capture', {
    fields: applied.map((item) => item.field),
    sources: applied.map((item) => item.source),
    staleReview,
  });
  await appendDecision(ws, [
    `Captured clarification for ${applied.map((item) => item.field).join(', ')}.`,
  ]);
  await appendProgress(ws, [
    `已更新 ${applied.length} 个字段到当前工作区状态。`,
  ]);

  return {
    ws: { ...ws, data: { ...ws.data, currentState } },
    applied,
    artifactMarkdown: options.artifactMarkdown ?? null,
    field: applied[0]?.field ?? null,
    stateKey: applied[0]?.stateKey ?? null,
    value: applied[0]?.value ?? null,
    source: applied[0]?.source ?? null,
    analysis,
  };
}

async function computeWorkspaceGuidance(ws, options = {}) {
  const versionIndex = await readVersionIndex(ws);
  const currentState = ws.data.currentState ?? {};
  const currentProductType = resolveCurrentProductType(ws);
  const currentStatus = currentState.status ?? 'unknown';
  const latestVersion = versionIndex.length > 0 ? await loadLatestVersionSnapshot(ws) : null;
  const currentDraftSnapshot = buildPrdSnapshot(ws, {
    ...currentState,
    versionNumber: currentState.prdVersion ?? (versionIndex.at(-1)?.versionNumber ?? 0),
    versionId: currentState.prdVersion > 0
      ? formatVersionId(currentState.prdVersion)
      : (versionIndex.at(-1)?.versionId ?? 'v0000'),
    productType: currentProductType,
    templatePack: resolveActiveTemplatePack(ws),
  });
  const analysisSnapshot = shouldUseCurrentDraftForGuidance(currentState)
    ? currentDraftSnapshot
    : (latestVersion?.snapshot ?? currentDraftSnapshot);
  const analysis = analyzePrdSnapshot(analysisSnapshot);
  const hasProductType = isSupportedProductType(currentProductType ?? analysis.productType);
  const diagramState = await getDiagramReviewState(ws, analysisSnapshot);
  const prdReviewState = await getPrdReviewState(ws, analysisSnapshot);
  const scenario = await detectWorkspaceScenario(ws.projectRoot, ws, versionIndex);
  const requirementGate = await readActiveRequirementGate(ws.projectRoot);
  const intakeSatisfiedByReview = prdReviewState.status === 'confirmed' && analysis.missingRequiredFields === 0;
  const intakeReflection = await buildRequirementIntakeReflection({
    projectRoot: ws.projectRoot,
    ws,
    snapshot: analysisSnapshot,
    analysis,
    scenario,
    gate: requirementGate,
  });
  const clarification = applyRequirementIntakeDepth(buildClarificationState({
    snapshot: analysisSnapshot,
    analysis,
    basePlan: buildClarificationPlan(analysisSnapshot, analysis),
    scenario,
    captureMeta: currentState.captureMeta ?? {},
    prdReviewState,
    limit: Number(options.questionLimit ?? 5),
  }), requirementGate, intakeReflection, { satisfied: intakeSatisfiedByReview });

  let nextAction = 'synthesize';
  let reason = 'PRD 可以合成为第一个版本。';
  let suggestedCommand = 'openprd synthesize .';
  let suggestedQuestions = analysis.suggestedQuestions;

  if (clarification.shouldAskUser) {
    nextAction = 'clarify-user';
    reason = '工作区缺少用户确认的关键信息，需要先澄清再继续合成。';
    suggestedCommand = 'openprd clarify .';
    suggestedQuestions = clarification.mustAskUser.map((item) => item.prompt);
  } else if (!hasProductType) {
    nextAction = 'classify';
    reason = '产品类型尚未锁定。';
    suggestedCommand = 'openprd classify . <consumer|b2b|agent>';
    suggestedQuestions = ['这是 consumer、b2b 还是 agent 产品？'];
  } else if (analysis.missingRequiredFields > 0) {
    nextAction = 'interview';
    reason = `仍缺少 ${analysis.missingRequiredFields} 个必填字段。`;
    suggestedCommand = `openprd interview . --product-type ${currentProductType}`;
  } else if (currentStatus === 'frozen') {
    nextAction = 'handoff';
    reason = '最新 PRD 已 freeze，可以交接。';
    suggestedCommand = 'openprd handoff . --target openprd';
    suggestedQuestions = [];
  } else if (currentStatus === 'handed_off') {
    nextAction = versionIndex.length > 1 ? 'diff' : 'history';
    reason = '该工作区已经完成交接。';
    suggestedCommand = nextAction === 'diff' ? 'openprd diff .' : 'openprd history .';
    suggestedQuestions = [];
  } else if (diagramState.shouldGateFreeze && (currentStatus === 'synthesized' || currentState.prdVersion > 0)) {
    nextAction = 'diagram';
    reason = diagramState.reason;
    suggestedCommand = `openprd diagram . --type ${diagramState.preferredType} --open`;
    suggestedQuestions = [
      `这张 ${diagramState.preferredType} 图是否符合预期设计？`,
      '当前可视化表达中还缺少什么，或哪里不准确？',
    ];
  } else if (prdReviewState.shouldGateFreeze && (currentStatus === 'synthesized' || currentState.prdVersion > 0)) {
    nextAction = 'review';
    reason = prdReviewState.reason;
    suggestedCommand = prdReviewState.artifactExists
      ? 'openprd review . --open'
      : 'openprd synthesize . --open';
    suggestedQuestions = [
      '这份 PRD 的问题、目标、范围、主流程、失败路径和风险是否符合你的理解？',
      '如果已经确认，请运行 openprd review . --mark confirmed；如果需要修改，请运行 openprd review . --mark needs-revision。',
    ];
  } else if (currentStatus === 'synthesized' || currentState.prdVersion > 0) {
    nextAction = 'freeze';
    reason = '已有版本化 PRD，交接前应先 freeze。';
    suggestedCommand = 'openprd freeze .';
    suggestedQuestions = [];
  }

  const taskGraph = buildWorkflowTaskGraph(analysisSnapshot, analysis, { diagramState, prdReviewState, clarificationState: clarification });
  const gates = deriveGateLabels({ nextAction, diagramState, clarification });

  return {
    versionIndex,
    currentState,
    analysisSnapshot,
    analysis,
    diagramState,
    prdReviewState,
    clarification,
    taskGraph,
    nextAction,
    reason,
    suggestedCommand,
    suggestedQuestions,
    gates,
  };
}


async function nextWorkspace(projectRoot) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const guidance = await computeWorkspaceGuidance(ws, { questionLimit: 5 });
  const {
    versionIndex,
    currentState,
    analysisSnapshot,
    analysis,
    diagramState,
    prdReviewState,
    clarification,
    taskGraph,
    nextAction,
    reason,
    suggestedCommand,
    suggestedQuestions,
    gates,
  } = guidance;

  await writeJson(ws.paths.taskGraph, taskGraph);
  await appendWorkflowEvent(ws, 'next', {
    nextAction,
    reason,
    missingRequiredFields: analysis.missingRequiredFields,
  });
  if (analysis.missingRequiredFields > 0) {
    await appendOpenQuestions(ws, [
      `还有 ${analysis.missingRequiredFields} 个关键信息需要确认。`,
      ...analysis.suggestedQuestions,
    ]);
  }
  await appendProgress(ws, [
    `建议下一步: ${nextAction}。`,
    `原因: ${reason}`,
  ]);

  return {
    ws,
    currentState,
    versionIndex,
    analysisSnapshot,
    analysis,
    diagramState,
    prdReviewState,
    clarification,
    taskGraph,
    gates,
    recommendation: {
      nextAction,
      reason,
      suggestedCommand,
      suggestedQuestions,
      currentGate: gates.currentGate,
      upcomingGate: gates.upcomingGate,
    },
    workflow: ['clarify', 'classify', 'interview', 'synthesize', 'diagram', 'review', 'freeze', 'handoff'],
  };
}

async function historyWorkspace(projectRoot) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const index = await readVersionIndex(ws);
  return { ws, versions: index };
}

async function classifyWorkspace(projectRoot, productType) {
  if (!isSupportedProductType(productType)) {
    throw new Error(`Unsupported product type: ${productType}`);
  }

  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const currentState = {
    ...(ws.data.currentState ?? {}),
    captureMeta: {
      ...((ws.data.currentState ?? {}).captureMeta ?? {}),
      'meta.productType': {
        source: 'user-confirmed',
        capturedAt: timestamp(),
      },
    },
    status: 'classified',
    productType,
    templatePack: productType,
    classifiedAt: timestamp(),
  };
  await writeJson(ws.paths.currentState, currentState);
  await appendWorkflowEvent(ws, 'classified', { productType });
  await appendDecision(ws, [
    `已锁定产品类型为 ${productType}。`,
    `模板包已设置为 ${productType}。`,
  ]);
  await appendProgress(ws, [
    `已将工作区分类为 ${productType}。`,
  ]);
  await writeJson(ws.paths.taskGraph, buildWorkflowTaskGraph(currentState));

  return { ws, currentState };
}

async function interviewWorkspace(projectRoot, requestedType = null) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  if (requestedType && !isSupportedProductType(requestedType)) {
    throw new Error(`Unsupported product type: ${requestedType}`);
  }

  const productType = requestedType ?? resolveCurrentProductType(ws);
  const sourceFiles = [ws.paths.baseIntake];
  if (productType === 'consumer') sourceFiles.push(ws.paths.consumerIntake);
  if (productType === 'b2b') sourceFiles.push(ws.paths.b2bIntake);
  if (productType === 'agent') sourceFiles.push(ws.paths.agentIntake);

  const sourceContent = [];
  for (const sourceFile of sourceFiles) {
    const rel = path.relative(ws.workspaceRoot, sourceFile);
    const content = await readText(sourceFile);
    sourceContent.push(`## ${rel}

${content}`);
  }

  const currentState = {
    ...(ws.data.currentState ?? {}),
    status: 'interviewing',
    productType: productType ?? ws.data.currentState?.productType ?? null,
    templatePack: productType ?? resolveActiveTemplatePack(ws),
    interviewStartedAt: timestamp(),
  };
  await writeJson(ws.paths.currentState, currentState);
  await appendWorkflowEvent(ws, 'interview_started', {
    productType: currentState.productType,
    sourceFiles: sourceFiles.map((filePath) => path.relative(ws.workspaceRoot, filePath)),
  });
  await appendProgress(ws, [
    `已加载 ${productType ?? '未分类'} 的访谈问题。`,
    `来源文件: ${sourceFiles.map((filePath) => path.relative(ws.workspaceRoot, filePath)).join(', ')}`,
  ]);
  await appendOpenQuestions(ws, [
    '我们要解决什么问题？',
    '主要用户是谁？',
    '成功是什么样？',
    '哪些内容明确不在范围内？',
    '我们希望 freeze 的第一个里程碑是什么？',
  ]);
  await writeJson(ws.paths.taskGraph, buildWorkflowTaskGraph(currentState));

  return {
    ws,
    productType,
    sourceFiles: sourceFiles.map((filePath) => path.relative(ws.workspaceRoot, filePath)),
    transcript: sourceContent.join('\n\n---\n\n'),
    currentState,
  };
}


export {
  captureWorkspace,
  clarifyWorkspace,
  classifyWorkspace,
  computeWorkspaceGuidance,
  diffWorkspace,
  historyWorkspace,
  interviewWorkspace,
  nextWorkspace,
  playgroundWorkspace,
  reviewWorkspace,
  synthesizeWorkspace
};
