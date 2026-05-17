import fs from 'node:fs/promises';
import path from 'node:path';
import { cjoin, exists, readJson, readText, writeJson, writeText } from './fs-utils.js';
import { renderQualityEvalArtifact } from './html-artifacts.js';
import { timestamp } from './time.js';

const QUALITY_DIR = cjoin('.openprd', 'quality');
const QUALITY_REPORTS_DIR = cjoin(QUALITY_DIR, 'reports');
const QUALITY_CONFIG = cjoin(QUALITY_DIR, 'config.json');
const QUALITY_INDEX = cjoin(QUALITY_REPORTS_DIR, 'index.json');
const QUALITY_LATEST = cjoin(QUALITY_REPORTS_DIR, 'latest.json');
const KNOWLEDGE_DIR = cjoin('.openprd', 'knowledge');
const KNOWLEDGE_INDEX = cjoin(KNOWLEDGE_DIR, 'index.json');

const IGNORE_DIRS = new Set([
  '.git',
  '.codex',
  '.claude',
  '.cursor',
  '.openprd',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
]);

const SOURCE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.css',
  '.html',
  '.md',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
]);

const IGNORE_FILES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
]);

function qualityPath(projectRoot, relativePath) {
  return cjoin(projectRoot, relativePath);
}

function reportId() {
  return `eval-${timestamp().replace(/[-: ]/g, '').slice(0, 15)}`;
}

function defaultQualityConfig() {
  return {
    version: 1,
    schema: 'openprd.quality.v1',
    updatedAt: timestamp(),
    enforcement: 'advisory',
    observability: {
      centralizedLoggingRequired: true,
      requiredSignals: ['logs', 'traces', 'metrics', 'errors'],
      requiredCorrelationFields: ['trace_id', 'span_id', 'request_id', 'task_id', 'user_session_id', 'error_id'],
      requiredSurfaces: ['frontend', 'backend', 'agent'],
      redactionRequired: true,
      retentionDays: 30,
      samplingPolicy: 'errors and high-risk flows are never sampled out; routine success logs may be sampled',
      queryExamplesRequired: true,
    },
    evalHarness: {
      smokeRequired: true,
      featureCoverageRequired: true,
      normalPerformanceRequired: true,
      extremePerformanceRequired: true,
      reportFormat: 'html',
      baselinePolicy: 'agent-initialized average baseline; user may override; agent ratchet may only tighten thresholds',
      projectBaseline: {
        normal: {
          cpuPercentP95Max: 70,
          memoryMBP95Max: 512,
          pageLoadMsP95Max: 2500,
          apiLatencyMsP95Max: 500,
          errorRatePercentMax: 0.1,
        },
        extreme: {
          cpuPercentP95Max: 85,
          memoryMBP95Max: 1024,
          pageLoadMsP95Max: 5000,
          apiLatencyMsP95Max: 1200,
          errorRatePercentMax: 1,
        },
      },
    },
    businessGuardrails: {
      enabled: true,
      riskIndicators: [
        'free user',
        'free tier',
        'trial',
        'quota',
        'usage limit',
        'rate limit',
        'credit',
        'token',
        'metered',
        'cost',
        'spend',
        'third-party cost',
        'third-party api',
        'ai generation',
        'model call',
        'openai',
        'anthropic',
        '免费用户',
        '免费额度',
        '试用',
        '额度',
        '用量',
        '限流',
        '积分',
        '点数',
        '令牌',
        '成本',
        '消耗',
        '第三方成本',
        '第三方调用',
        '第三方 API',
        '大模型',
        '模型调用',
        'AI 生成',
        '图像生成',
        '内容生成',
        '薅',
        '滥用',
      ],
      requiredEvidence: {
        usageLimits: ['quota', 'usage limit', 'rate limit', 'daily limit', 'monthly limit', 'allowance', 'free tier', '额度', '用量限制', '限流', '每日上限', '月度上限', '免费额度'],
        abusePrevention: ['abuse', 'bypass', 'fraud', 'replay', 'concurrent', 'unauthorized', 'negative test', '越权', '滥用', '绕过', '并发', '重复请求', '负向测试'],
        monitoringSignals: ['usage metric', 'cost metric', 'billing metric', 'tokens_used', 'cost_usd', 'spend', 'dashboard', 'monitor', '监控', '指标', '用量', '成本', '看板'],
        alertThresholds: ['alert', 'alarm', 'threshold', 'budget', 'anomaly', '报警', '告警', '阈值', '预算', '异常增长'],
        stopLossActions: ['kill switch', 'feature flag', 'circuit breaker', 'disable', 'degrade', 'pause', 'shutdown', '止损', '关闭', '降级', '暂停', '熔断'],
      },
    },
    knowledge: {
      enabled: true,
      skillGenerationRequiredFor: ['repeated-issue', 'high-impact-fix', 'hidden-debug-knowledge', 'agent-misjudgment'],
      skillDir: '.openprd/knowledge/skills',
      abstractionRequired: true,
    },
  };
}

async function ensureQualityDirs(projectRoot) {
  await fs.mkdir(qualityPath(projectRoot, QUALITY_REPORTS_DIR), { recursive: true });
  await fs.mkdir(qualityPath(projectRoot, cjoin(KNOWLEDGE_DIR, 'incidents')), { recursive: true });
  await fs.mkdir(qualityPath(projectRoot, cjoin(KNOWLEDGE_DIR, 'patterns')), { recursive: true });
  await fs.mkdir(qualityPath(projectRoot, cjoin(KNOWLEDGE_DIR, 'skills')), { recursive: true });
}

async function mergeQualityConfig(projectRoot, options = {}) {
  await ensureQualityDirs(projectRoot);
  const configPath = qualityPath(projectRoot, QUALITY_CONFIG);
  const current = await readJson(configPath).catch(() => null);
  const next = {
    ...defaultQualityConfig(),
    ...(current ?? {}),
    updatedAt: timestamp(),
    observability: {
      ...defaultQualityConfig().observability,
      ...(current?.observability ?? {}),
    },
    evalHarness: {
      ...defaultQualityConfig().evalHarness,
      ...(current?.evalHarness ?? {}),
      projectBaseline: {
        ...defaultQualityConfig().evalHarness.projectBaseline,
        ...(current?.evalHarness?.projectBaseline ?? {}),
        normal: {
          ...defaultQualityConfig().evalHarness.projectBaseline.normal,
          ...(current?.evalHarness?.projectBaseline?.normal ?? {}),
        },
        extreme: {
          ...defaultQualityConfig().evalHarness.projectBaseline.extreme,
          ...(current?.evalHarness?.projectBaseline?.extreme ?? {}),
        },
      },
    },
    businessGuardrails: {
      ...defaultQualityConfig().businessGuardrails,
      ...(current?.businessGuardrails ?? {}),
      requiredEvidence: {
        ...defaultQualityConfig().businessGuardrails.requiredEvidence,
        ...(current?.businessGuardrails?.requiredEvidence ?? {}),
      },
    },
    knowledge: {
      ...defaultQualityConfig().knowledge,
      ...(current?.knowledge ?? {}),
    },
  };
  if (options.force || current === null) {
    await writeJson(configPath, next);
    return { config: next, changed: current === null ? 'created' : 'updated' };
  }
  return { config: current, changed: 'unchanged' };
}

async function walkProject(projectRoot, dir = projectRoot, collected = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = cjoin(dir, entry.name);
    const relativePath = path.relative(projectRoot, fullPath);
    if (entry.isDirectory()) {
      const normalized = relativePath.split(path.sep).join('/');
      if ([...IGNORE_DIRS].some((ignored) => normalized === ignored || normalized.startsWith(`${ignored}/`))) {
        continue;
      }
      await walkProject(projectRoot, fullPath, collected);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (IGNORE_FILES.has(entry.name)) {
      continue;
    }
    const ext = path.extname(entry.name);
    if (SOURCE_EXTENSIONS.has(ext)) {
      collected.push({ path: relativePath, ext });
    }
  }
  return collected;
}

async function readProjectTexts(projectRoot, files) {
  const texts = [];
  for (const file of files.slice(0, 500)) {
    const fullPath = cjoin(projectRoot, file.path);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat || stat.size > 512 * 1024) {
      continue;
    }
    const text = await readText(fullPath).catch(() => '');
    texts.push({ ...file, text: text.slice(0, 200000) });
  }
  return texts;
}

function packageSignals(packageJson) {
  const scripts = packageJson?.scripts ?? {};
  const dependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
    ...(packageJson?.peerDependencies ?? {}),
  };
  const dependencyNames = Object.keys(dependencies);
  return { scripts, dependencyNames };
}

function includesAny(text, tokens) {
  const normalized = String(text ?? '').toLowerCase();
  return tokens.some((token) => normalized.includes(token.toLowerCase()));
}

function detectObservability({ config, files, texts, packageJson }) {
  const { dependencyNames } = packageSignals(packageJson);
  const haystack = [
    ...dependencyNames,
    ...files.map((file) => file.path),
    ...texts.map((file) => file.text),
  ].join('\n');
  const centralizedTools = [
    '@opentelemetry/',
    'opentelemetry',
    'sentry',
    'datadog',
    'newrelic',
    'rollbar',
    'logtail',
    'grafana',
    'loki',
    'elastic-apm',
    'cloudwatch',
    'azure monitor',
  ].filter((token) => includesAny(haystack, [token]));
  const localLoggers = ['pino', 'winston', 'bunyan', 'log4js', 'console.'].filter((token) => includesAny(haystack, [token]));
  const correlationFields = config.observability.requiredCorrelationFields
    .filter((field) => includesAny(haystack, [field, field.replace(/_/g, ''), field.replace(/_id$/, 'Id')]));
  const surfaces = {
    frontend: files.some((file) => /\.(tsx|jsx|css|html)$/.test(file.path) || /src\/(app|pages|components|ui)\//.test(file.path)),
    backend: files.some((file) => /\.(js|ts|py|go|rs|java|kt)$/.test(file.path) && /(server|api|route|controller|service|worker|handler)/i.test(file.path)),
    agent: files.some((file) => /(agent|harness|tool|skill|prompt|workflow)/i.test(file.path)),
  };
  const warnings = [];
  if (centralizedTools.length === 0) {
    warnings.push('未检测到中心化日志/追踪/错误系统依赖或配置；需要确认是否由平台层统一提供。');
  }
  if (localLoggers.length > 0 && centralizedTools.length === 0) {
    warnings.push('检测到本地日志调用，但未看到中心化采集出口。');
  }
  const missingCorrelation = config.observability.requiredCorrelationFields.filter((field) => !correlationFields.includes(field));
  if (missingCorrelation.length > 0) {
    warnings.push(`链路关联字段缺失或未显式出现: ${missingCorrelation.join(', ')}。`);
  }
  return {
    status: centralizedTools.length > 0 && missingCorrelation.length === 0 ? 'pass' : 'needs-attention',
    centralizedTools,
    localLoggers,
    correlationFields,
    missingCorrelation,
    surfaces,
    requiredSurfaces: config.observability.requiredSurfaces,
    redactionRequired: config.observability.redactionRequired,
    recommendations: [
      '为前端交互、后端入口、异步任务、Agent 工具调用统一注入 trace/request/task/error 关联字段。',
      '错误日志必须能回查用户会话、任务、请求、下游调用和异常栈，敏感字段默认脱敏。',
      '每个新增功能在实现阶段都要自评是否需要新增结构化日志或查询样例。',
    ],
    warnings,
  };
}

function detectEvalHarness({ config, files, texts, packageJson, activeTasks }) {
  const { scripts, dependencyNames } = packageSignals(packageJson);
  const scriptEntries = Object.entries(scripts);
  const commandText = scriptEntries.map(([name, command]) => `${name}: ${command}`).join('\n');
  const hasTest = scriptEntries.some(([name]) => /(^|:)(test|check)$/.test(name)) || includesAny(commandText, ['node --test', 'vitest', 'jest', 'pytest']);
  const smokeCommands = scriptEntries
    .filter(([name, command]) => /smoke|e2e|playwright|cypress|test:ui/i.test(`${name} ${command}`))
    .map(([name, command]) => `${name}: ${command}`);
  const perfCommands = scriptEntries
    .filter(([name, command]) => /perf|performance|load|stress|k6|lighthouse|autocannon|wrk/i.test(`${name} ${command}`))
    .map(([name, command]) => `${name}: ${command}`);
  const hasSmoke = smokeCommands.length > 0
    || files.some((file) => /playwright\.config|cypress\.config|e2e|smoke/i.test(file.path))
    || dependencyNames.some((name) => /playwright|cypress/i.test(name));
  const hasPerf = perfCommands.length > 0
    || files.some((file) => /k6|lighthouse|load|stress|performance/i.test(file.path))
    || dependencyNames.some((name) => /k6|lighthouse|autocannon/i.test(name));
  const hasExtremeFixtures = files.some((file) => /fixtures|extreme|stress|load|large-data|seed/i.test(file.path));
  const normalBaseline = config.evalHarness.projectBaseline.normal;
  const extremeBaseline = config.evalHarness.projectBaseline.extreme;
  const warnings = [];
  if (!hasSmoke) {
    warnings.push('未检测到明确的冒烟/e2e 测试体系。');
  }
  if (!hasPerf) {
    warnings.push('未检测到性能/压力测试命令或脚本。');
  }
  if (!hasExtremeFixtures) {
    warnings.push('未检测到极端数据 fixtures 或压力场景数据。');
  }
  if (activeTasks.total > 0 && activeTasks.pending > 0) {
    warnings.push(`当前任务清单仍有 ${activeTasks.pending} 个未完成条目，功能覆盖不能判定为完整。`);
  }
  return {
    status: hasSmoke && hasPerf && hasExtremeFixtures && activeTasks.pending === 0 ? 'pass' : 'needs-attention',
    hasUnitOrCommandTests: hasTest,
    smoke: {
      present: hasSmoke,
      commands: smokeCommands,
    },
    performance: {
      present: hasPerf,
      commands: perfCommands,
      normalBaseline,
      extremeBaseline,
      ratchetPolicy: config.evalHarness.baselinePolicy,
    },
    extremeData: {
      present: hasExtremeFixtures,
      evidence: files.filter((file) => /fixtures|extreme|stress|load|large-data|seed/i.test(file.path)).slice(0, 20).map((file) => file.path),
    },
    featureCoverage: {
      activeTasks,
      requiredFlows: ['主流程', '异常流程', '逆向流程', '边界条件'],
    },
    warnings,
    recommendations: [
      '如果项目没有冒烟测试，优先补一组最短主流程用例，并让后续功能持续补充。',
      '每次阶段性开发结束都要把任务清单映射到主流程、异常流程、逆向流程和边界条件。',
      '性能标准从项目级 baseline 开始，功能级可以加严；Agent 自动更新阈值时只能更严格。',
    ],
  };
}

function detectBusinessGuardrails({ config, files, texts, packageJson }) {
  const { scripts, dependencyNames } = packageSignals(packageJson);
  const haystack = [
    ...dependencyNames,
    ...Object.entries(scripts).map(([name, command]) => `${name}: ${command}`),
    ...files.map((file) => file.path),
    ...texts.map((file) => file.text),
  ].join('\n');
  const businessConfig = config.businessGuardrails ?? defaultQualityConfig().businessGuardrails;
  const riskIndicators = businessConfig.riskIndicators ?? [];
  const matchedRiskIndicators = riskIndicators.filter((token) => includesAny(haystack, [token]));
  const riskDetected = matchedRiskIndicators.length > 0;
  const evidenceConfig = businessConfig.requiredEvidence ?? {};
  const evidence = Object.fromEntries(
    Object.entries(evidenceConfig).map(([key, tokens]) => {
      const matched = (Array.isArray(tokens) ? tokens : []).filter((token) => includesAny(haystack, [token]));
      return [key, { present: matched.length > 0, matched }];
    }),
  );
  const missingEvidence = Object.entries(evidence)
    .filter(([, value]) => !value.present)
    .map(([key]) => key);
  const warnings = [];
  if (riskDetected && missingEvidence.includes('usageLimits')) {
    warnings.push('检测到消耗型或免费额度风险，但未看到明确的额度、频率、并发或总量限制证据。');
  }
  if (riskDetected && missingEvidence.includes('abusePrevention')) {
    warnings.push('检测到消耗型或免费额度风险，但未看到滥用、越权、重复请求或并发绕过的负向验证证据。');
  }
  if (riskDetected && missingEvidence.includes('monitoringSignals')) {
    warnings.push('检测到消耗型或免费额度风险，但未看到用量、成本、调用量或异常行为监控信号。');
  }
  if (riskDetected && missingEvidence.includes('alertThresholds')) {
    warnings.push('检测到消耗型或免费额度风险，但未看到成本、用量或异常增长报警阈值。');
  }
  if (riskDetected && missingEvidence.includes('stopLossActions')) {
    warnings.push('检测到消耗型或免费额度风险，但未看到关闭、降级、暂停或熔断等止损动作。');
  }
  return {
    status: !businessConfig.enabled || !riskDetected || missingEvidence.length === 0 ? 'pass' : 'needs-attention',
    enabled: businessConfig.enabled,
    riskDetected,
    matchedRiskIndicators,
    evidence,
    missingEvidence,
    recommendations: [
      '涉及免费用户、额度、AI 调用、第三方 API、生成、存储或下载时，先写明成本来源和用户级限制。',
      '为免费、试用或低权限用户覆盖额度绕过、并发请求、重复请求、越权身份和异常恢复等负向场景。',
      '上线前明确成本/用量指标、报警阈值、负责人和可执行止损动作。',
    ],
    warnings,
  };
}

async function readActiveTasks(projectRoot) {
  const state = await readJson(cjoin(projectRoot, '.openprd', 'state', 'changes.json')).catch(() => null);
  const activeChange = state?.activeChange ?? null;
  if (!activeChange) {
    return { activeChange: null, total: 0, done: 0, pending: 0, blocked: 0, tasks: [] };
  }
  const taskFiles = [];
  for (const root of [cjoin('openprd', 'changes', activeChange), cjoin('openspec', 'changes', activeChange)]) {
    const dir = cjoin(projectRoot, root);
    const entries = await fs.readdir(dir).catch(() => []);
    for (const entry of entries) {
      if (/^tasks.*\.md$/.test(entry)) {
        taskFiles.push(cjoin(root, entry));
      }
    }
  }
  const tasks = [];
  for (const relativePath of taskFiles) {
    const text = await readText(cjoin(projectRoot, relativePath)).catch(() => '');
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^\s*-\s+\[([ xX~-])\]\s+(.+)$/);
      if (match) {
        const done = /x/i.test(match[1]);
        const blocked = match[1] === '~' || /blocked|阻塞/i.test(match[2]);
        tasks.push({
          title: match[2].trim(),
          done,
          blocked,
          source: relativePath,
          line: index + 1,
        });
      }
    }
  }
  return {
    activeChange,
    total: tasks.length,
    done: tasks.filter((task) => task.done).length,
    pending: tasks.filter((task) => !task.done && !task.blocked).length,
    blocked: tasks.filter((task) => task.blocked).length,
    tasks: tasks.slice(0, 50),
  };
}

async function listKnowledgeFiles(projectRoot) {
  const knowledgeRoot = cjoin(projectRoot, '.openprd', 'knowledge');
  const collected = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = cjoin(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        collected.push({ path: path.relative(projectRoot, fullPath) });
      }
    }
  }
  await walk(knowledgeRoot);
  return collected;
}

function detectKnowledge({ config, knowledgeFiles }) {
  const skillDir = config.knowledge.skillDir ?? '.openprd/knowledge/skills';
  const skills = knowledgeFiles
    .filter((file) => file.path.startsWith(skillDir.replace(/\//g, path.sep)) || file.path.startsWith(skillDir))
    .filter((file) => file.path.endsWith('SKILL.md'))
    .map((file) => file.path);
  const incidents = knowledgeFiles.filter((file) => /\.openprd[\\/]knowledge[\\/]incidents[\\/].+\.json$/.test(file.path));
  const warnings = [];
  if (config.knowledge.enabled && skills.length === 0) {
    warnings.push('项目级经验 skill 库尚为空；首次问题修复后应沉淀抽象经验。');
  }
  return {
    status: !config.knowledge.enabled || skills.length > 0 ? 'pass' : 'needs-attention',
    enabled: config.knowledge.enabled,
    skillDir,
    skills,
    incidents: incidents.map((file) => file.path),
    recommendations: [
      '每次问题修复后记录症状、排查路径、根因模式、修复方式、验证证据和下次触发条件。',
      '只有重复、高影响、隐性知识或 Agent 误判类问题才升级为项目级 skill。',
      '生成 skill 时按抽象模式写触发条件和验证步骤，避免只记录一次性事故流水账。',
    ],
    warnings,
  };
}

function buildGates({ observability, evalHarness, businessGuardrails, knowledge }) {
  return [
    { id: 'traceability', label: '日志链路可追踪', status: observability.status, warnings: observability.warnings },
    { id: 'redaction', label: '日志脱敏策略', status: observability.redactionRequired ? 'needs-evidence' : 'needs-attention', warnings: ['需要在项目文档或平台配置中确认敏感字段脱敏策略。'] },
    { id: 'business-guardrails', label: '业务成本与滥用护栏', status: businessGuardrails.status, warnings: businessGuardrails.warnings },
    { id: 'smoke', label: '冒烟测试体系', status: evalHarness.smoke.present ? 'pass' : 'needs-attention', warnings: evalHarness.smoke.present ? [] : ['缺少冒烟/e2e 证据。'] },
    { id: 'feature-coverage', label: '任务与功能覆盖', status: evalHarness.featureCoverage.activeTasks.pending === 0 ? 'pass' : 'needs-attention', warnings: evalHarness.featureCoverage.activeTasks.pending === 0 ? [] : ['仍有未完成任务或缺少任务覆盖证据。'] },
    { id: 'normal-performance', label: '正常性能基线', status: evalHarness.performance.present ? 'needs-evidence' : 'needs-attention', warnings: evalHarness.performance.present ? ['检测到性能命令，需要填充本次运行指标。'] : ['缺少性能测试命令。'] },
    { id: 'extreme-performance', label: '极端场景压力', status: evalHarness.extremeData.present ? 'needs-evidence' : 'needs-attention', warnings: evalHarness.extremeData.present ? ['检测到极端数据，需要填充压力测试运行结果。'] : ['缺少极端数据或压力场景。'] },
    { id: 'knowledge', label: '经验 Skill 沉淀', status: knowledge.status, warnings: knowledge.warnings },
  ];
}

async function loadPackageJson(projectRoot) {
  return readJson(cjoin(projectRoot, 'package.json')).catch(() => null);
}

async function buildQualityReport(projectRoot, config) {
  const id = reportId();
  const files = await walkProject(projectRoot);
  const texts = await readProjectTexts(projectRoot, files);
  const packageJson = await loadPackageJson(projectRoot);
  const activeTasks = await readActiveTasks(projectRoot);
  const knowledgeFiles = await listKnowledgeFiles(projectRoot);
  const observability = detectObservability({ config, files, texts, packageJson });
  const evalHarness = detectEvalHarness({ config, files, texts, packageJson, activeTasks });
  const businessGuardrails = detectBusinessGuardrails({ config, files, texts, packageJson });
  const knowledge = detectKnowledge({ config, knowledgeFiles });
  const gates = buildGates({ observability, evalHarness, businessGuardrails, knowledge });
  const blockingStatuses = new Set(['fail']);
  const attentionStatuses = new Set(['needs-attention', 'needs-evidence']);
  const readiness = {
    ok: !gates.some((gate) => blockingStatuses.has(gate.status)),
    productionReady: !gates.some((gate) => attentionStatuses.has(gate.status) || blockingStatuses.has(gate.status)),
    enforcement: config.enforcement,
    failingGates: gates.filter((gate) => blockingStatuses.has(gate.status)).map((gate) => gate.id),
    attentionGates: gates.filter((gate) => attentionStatuses.has(gate.status)).map((gate) => gate.id),
  };
  return {
    version: 1,
    schema: 'openprd.eval-report.v1',
    id,
    generatedAt: timestamp(),
    projectRoot,
    summary: {
      status: readiness.productionReady ? 'production-ready' : 'needs-attention',
      filesScanned: files.length,
      activeChange: activeTasks.activeChange,
      gateCount: gates.length,
      attentionCount: readiness.attentionGates.length,
    },
    readiness,
    gates,
    observability,
    evalHarness,
    businessGuardrails,
    knowledge,
    configSnapshot: config,
  };
}

async function writeReport(projectRoot, report) {
  await ensureQualityDirs(projectRoot);
  const reportBase = report.id.replace(/[^a-zA-Z0-9._-]/g, '_');
  const jsonPath = qualityPath(projectRoot, cjoin(QUALITY_REPORTS_DIR, `${reportBase}.json`));
  const htmlPath = qualityPath(projectRoot, cjoin(QUALITY_REPORTS_DIR, `${reportBase}.html`));
  await writeJson(jsonPath, report);
  await writeText(htmlPath, renderQualityEvalArtifact({ report }));
  await writeJson(qualityPath(projectRoot, QUALITY_LATEST), {
    reportId: report.id,
    jsonPath,
    htmlPath,
    generatedAt: report.generatedAt,
    status: report.summary.status,
  });
  const indexPath = qualityPath(projectRoot, QUALITY_INDEX);
  const index = await readJson(indexPath).catch(() => ({ version: 1, reports: [] }));
  const reports = [
    { reportId: report.id, jsonPath, htmlPath, generatedAt: report.generatedAt, status: report.summary.status },
    ...(Array.isArray(index.reports) ? index.reports.filter((item) => item.reportId !== report.id) : []),
  ].slice(0, 100);
  await writeJson(indexPath, { version: 1, updatedAt: timestamp(), reports });
  return { jsonPath, htmlPath, indexPath };
}

async function resolveReportPath(projectRoot, from) {
  if (from) {
    const direct = path.isAbsolute(from) ? from : cjoin(projectRoot, from);
    if (await exists(direct)) {
      return direct;
    }
    const asId = qualityPath(projectRoot, cjoin(QUALITY_REPORTS_DIR, `${from}.json`));
    if (await exists(asId)) {
      return asId;
    }
  }
  const latest = await readJson(qualityPath(projectRoot, QUALITY_LATEST)).catch(() => null);
  return latest?.jsonPath ?? null;
}

function slugify(value, fallback = 'skill') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function renderExperienceSkill({ skillName, report }) {
  const attention = report.readiness.attentionGates.join(', ') || '无';
  return `---
name: ${skillName}
description: 由 OpenPrd 质量审查 ${report.id} 生成的项目级经验 Skill。适用于再次出现类似可观测性、业务护栏、评估执行环境、性能或复发预防缺口的场景。
---

# ${skillName}

## 触发条件

- 某项任务改动了前端、后端、agent 工作流或错误处理行为。
- 这次变更缺少日志关联、业务成本与滥用护栏、冒烟覆盖、性能证据，或已经出现重复问题模式。
- 最近一次质量报告的关注门禁包括：${attention}。

## 先看什么

- 先阅读 \`.openprd/quality/reports/\` 下最新的 HTML 质量评估报告。
- 检查日志能否把前端动作、后端请求、agent 任务、下游调用和 error id 串起来。
- 检查是否存在业务护栏、冒烟测试、任务覆盖、正常性能和极端数据证据。

## 根因模式

质量回退反复出现，通常是因为实现证据被分散维护：日志缺少共享 id，消耗型成本路径缺少额度和止损，测试只覆盖顺路径，性能阈值没有显式化，已修复问题也没有抽象成可复用的项目知识。

## 修复策略

- 只在确实能改善后续诊断的地方新增或更新结构化日志。
- 对免费、试用、额度、AI 调用或第三方成本路径补齐限制、负向验证、监控、报警和止损动作。
- 在扩大测试覆盖前，先补最小可用的 smoke / e2e 路径。
- 结合项目基线记录正常和极端性能证据。
- 把重复或高影响修复沉淀成带触发条件和验证步骤的项目 Skill。

## 验证方式

- 运行 \`openprd quality . --verify\` 并打开生成的 HTML 报告。
- 确认所有关注门禁都有证据、已接受的例外，或明确的后续任务。
- 重新执行任务级 verify 命令，并把证据路径保留在报告里。
`;
}

export async function initQualityWorkspace(projectRoot, options = {}) {
  const { config, changed } = await mergeQualityConfig(projectRoot, { force: Boolean(options.force) });
  const knowledgeIndexPath = qualityPath(projectRoot, KNOWLEDGE_INDEX);
  if (!(await exists(knowledgeIndexPath))) {
    await writeJson(knowledgeIndexPath, { version: 1, updatedAt: timestamp(), incidents: [], patterns: [], skills: [] });
  }
  return {
    ok: true,
    action: 'quality-init',
    projectRoot,
    config,
    changed,
    files: {
      config: qualityPath(projectRoot, QUALITY_CONFIG),
      reportsDir: qualityPath(projectRoot, QUALITY_REPORTS_DIR),
      knowledgeIndex: knowledgeIndexPath,
    },
  };
}

export async function verifyQualityWorkspace(projectRoot, options = {}) {
  const configPath = qualityPath(projectRoot, QUALITY_CONFIG);
  if (!(await exists(configPath))) {
    return {
      ok: false,
      action: 'quality-verify',
      projectRoot,
      errors: [`${QUALITY_CONFIG} is required. Run: openprd quality . --init`],
    };
  }
  const config = await readJson(configPath);
  await ensureQualityDirs(projectRoot);
  const report = await buildQualityReport(projectRoot, config);
  const paths = await writeReport(projectRoot, report);
  const blocking = config.enforcement === 'blocking' && !report.readiness.productionReady;
  return {
    ok: !blocking,
    action: 'quality-verify',
    projectRoot,
    report,
    reportPath: paths.jsonPath,
    htmlPath: paths.htmlPath,
    indexPath: paths.indexPath,
    errors: blocking ? ['Quality enforcement is blocking and one or more gates need attention.'] : [],
  };
}

export async function learnQualityWorkspace(projectRoot, options = {}) {
  await ensureQualityDirs(projectRoot);
  const sourcePath = await resolveReportPath(projectRoot, options.from);
  if (!sourcePath) {
    return {
      ok: false,
      action: 'quality-learn',
      projectRoot,
      errors: ['No quality report found. Run: openprd quality . --verify'],
    };
  }
  const report = await readJson(sourcePath);
  const incidentId = `incident-${report.id}`;
  const patternId = `quality-${slugify(report.summary?.status ?? report.id)}`;
  const skillName = `openprd-experience-${slugify(patternId)}`;
  const incidentPath = qualityPath(projectRoot, cjoin(KNOWLEDGE_DIR, 'incidents', `${incidentId}.json`));
  const patternPath = qualityPath(projectRoot, cjoin(KNOWLEDGE_DIR, 'patterns', `${patternId}.json`));
  const skillDir = qualityPath(projectRoot, cjoin(KNOWLEDGE_DIR, 'skills', skillName));
  const skillPath = cjoin(skillDir, 'SKILL.md');
  await writeJson(incidentPath, {
    version: 1,
    incidentId,
    sourceReportId: report.id,
    sourceReportPath: sourcePath,
    capturedAt: timestamp(),
    status: report.summary?.status ?? 'unknown',
    attentionGates: report.readiness?.attentionGates ?? [],
    verification: {
      fixed: false,
      evidence: [],
    },
  });
  await writeJson(patternPath, {
    version: 1,
    patternId,
    sourceReportId: report.id,
    abstractPattern: '质量缺口反复出现，通常是因为可观测性、评估证据、性能基线和已修复经验被分散维护，没有进入同一套评审机制。',
    triggers: report.readiness?.attentionGates ?? [],
    prevention: [
      '阶段性开发后运行质量验证。',
      '声明就绪前先审阅 HTML 质量评估报告。',
      '把重复或高影响修复沉淀为项目经验 Skill。',
    ],
    updatedAt: timestamp(),
  });
  await writeText(skillPath, renderExperienceSkill({ skillName, report }));
  const indexPath = qualityPath(projectRoot, KNOWLEDGE_INDEX);
  const index = await readJson(indexPath).catch(() => ({ version: 1, incidents: [], patterns: [], skills: [] }));
  const upsert = (items, key, value) => [value, ...(Array.isArray(items) ? items.filter((item) => item[key] !== value[key]) : [])].slice(0, 200);
  await writeJson(indexPath, {
    version: 1,
    updatedAt: timestamp(),
    incidents: upsert(index.incidents, 'incidentId', { incidentId, path: incidentPath, sourceReportId: report.id }),
    patterns: upsert(index.patterns, 'patternId', { patternId, path: patternPath, sourceReportId: report.id }),
    skills: upsert(index.skills, 'skillName', { skillName, path: skillPath, sourceReportId: report.id }),
  });
  return {
    ok: true,
    action: 'quality-learn',
    projectRoot,
    sourceReportPath: sourcePath,
    incidentId,
    patternId,
    skillName,
    files: {
      incident: incidentPath,
      pattern: patternPath,
      skill: skillPath,
      index: indexPath,
    },
  };
}

export async function qualityWorkspace(projectRoot, options = {}) {
  if (options.init) {
    return initQualityWorkspace(projectRoot, options);
  }
  if (options.learn) {
    return learnQualityWorkspace(projectRoot, options);
  }
  return verifyQualityWorkspace(projectRoot, options);
}
