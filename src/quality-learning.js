import fs from 'node:fs/promises'
import path from 'node:path'
import { cjoin, exists, readJson, readText } from './fs-utils.js'

const DEFAULT_CORRELATION_ALIASES = {
  trace_id: ['trace_id', 'traceId', 'traceid'],
  span_id: ['span_id', 'spanId', 'spanid'],
  request_id: ['request_id', 'requestId', 'requestid'],
  task_id: ['task_id', 'taskId', 'taskid'],
  user_session_id: ['user_session_id', 'userSessionId', 'userSession', 'session_id', 'sessionId', 'conversation_id', 'conversationId'],
  error_id: ['error_id', 'errorId', 'errorid', 'diagnosticRef', 'diagnostic_ref'],
}

const EXTRA_CONTEXT_ALIASES = ['traceparent', 'tracestate', 'diagnosticRef', 'diagnostic_ref', 'conversationHash', 'conversation_hash', 'accountHash', 'account_hash']

const DIAGNOSTIC_FILE_RULES = [
  { kind: 'diagnostic-report', test: (relativePath) => /diagnostic[-_ ]?report|framework.*diagnostic/i.test(relativePath) },
  { kind: 'root-cause-candidates', test: (relativePath) => /root[-_ ]?cause/i.test(relativePath) },
  { kind: 'timeline', test: (relativePath) => /timeline/i.test(relativePath) },
  { kind: 'runtime-events', test: (relativePath) => /runtime[-_ ]?events?/i.test(relativePath) || /(^|\/)events(\.|\/|$)/i.test(relativePath) },
]

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return null
}

function normalizeStatus(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return 'unknown'
  if (['pass', 'ready', 'healthy', 'ok', 'production-ready'].includes(text)) return 'pass'
  if (['fail', 'failed', 'error', 'critical', 'needs-attention', 'warning', 'warn'].includes(text)) return 'needs-attention'
  return text
}

function slugify(value, fallback = 'diagnostic') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || fallback
}

function uniq(items) {
  return [...new Set(items.filter(Boolean))]
}

function pickStringArray(...values) {
  const items = []
  for (const value of values) {
    if (!value) continue
    if (typeof value === 'string' && value.trim()) {
      items.push(value.trim())
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) {
          items.push(item.trim())
        } else if (item && typeof item === 'object') {
          const nested = firstString(item.title, item.label, item.name, item.message, item.summary, item.description)
          if (nested) items.push(nested)
        }
      }
    }
  }
  return uniq(items)
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasAnyAlias(value, aliases, depth = 0) {
  if (!value || depth > 4) return false
  if (Array.isArray(value)) {
    return value.some((entry) => hasAnyAlias(entry, aliases, depth + 1))
  }
  if (!isObject(value)) {
    return false
  }
  const keys = Object.keys(value)
  if (keys.some((key) => aliases.includes(key))) {
    return true
  }
  return Object.values(value).some((entry) => hasAnyAlias(entry, aliases, depth + 1))
}

function collectCorrelationFields(records, requiredCorrelationFields = []) {
  const fields = []
  for (const field of requiredCorrelationFields) {
    const aliases = DEFAULT_CORRELATION_ALIASES[field] ?? [field, field.replace(/_id$/, 'Id'), field.replace(/_/g, '')]
    if (records.some((record) => hasAnyAlias(record, aliases))) {
      fields.push(field)
    }
  }
  return fields
}

function collectExtraContextFields(records) {
  return EXTRA_CONTEXT_ALIASES.filter((field) => records.some((record) => hasAnyAlias(record, [field])))
}

function extractEventName(record) {
  if (!isObject(record)) return null
  return firstString(
    record.event,
    record.eventName,
    record.name,
    record.type,
    record.action,
    record.stage,
    record.code,
  )
}

function collectEventNames(records) {
  return uniq(records.map((record) => extractEventName(record)).filter(Boolean)).slice(0, 8)
}

function toRootCauseCandidate(candidate) {
  if (!candidate) return null
  if (typeof candidate === 'string') {
    return { title: candidate }
  }
  if (!isObject(candidate)) {
    return null
  }
  const title = firstString(candidate.title, candidate.name, candidate.reason, candidate.category, candidate.summary, candidate.code)
  if (!title) return null
  return {
    title,
    category: firstString(candidate.category, candidate.type, candidate.group, candidate.label),
    evidence: pickStringArray(candidate.evidence, candidate.matches, candidate.observations, candidate.summary, candidate.description).slice(0, 3),
    nextSteps: pickStringArray(candidate.nextSteps, candidate.actions, candidate.recommendations, candidate.suggestedNextSteps, candidate.steps).slice(0, 4),
  }
}

function extractRootCauseCandidates(payload) {
  const pools = [
    payload,
    payload?.rootCauseCandidates,
    payload?.rootCauses,
    payload?.candidates,
    payload?.causes,
    payload?.diagnosticReport?.rootCauseCandidates,
    payload?.diagnosticReport?.candidates,
  ]
  const candidates = []
  for (const pool of pools) {
    if (!pool) continue
    if (Array.isArray(pool)) {
      candidates.push(...pool.map((entry) => toRootCauseCandidate(entry)).filter(Boolean))
      continue
    }
    if (isObject(pool)) {
      for (const key of ['rootCauseCandidates', 'rootCauses', 'candidates', 'causes']) {
        if (Array.isArray(pool[key])) {
          candidates.push(...pool[key].map((entry) => toRootCauseCandidate(entry)).filter(Boolean))
        }
      }
    }
  }
  const seen = new Set()
  return candidates.filter((candidate) => {
    const key = candidate.title.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 6)
}

function extractSummaryText(payload) {
  if (!payload) return null
  if (typeof payload.summary === 'string') return payload.summary.trim()
  if (isObject(payload.summary)) {
    return firstString(payload.summary.title, payload.summary.headline, payload.summary.message, payload.summary.summary, payload.summary.description)
  }
  return firstString(payload.title, payload.problem, payload.message, payload.description)
}

function extractEventRecords(payload) {
  if (!payload) return []
  if (Array.isArray(payload)) {
    return payload.filter((entry) => isObject(entry))
  }
  if (!isObject(payload)) {
    return []
  }
  for (const key of ['events', 'runtimeEvents', 'timeline', 'items', 'entries', 'records']) {
    if (Array.isArray(payload[key])) {
      return payload[key].filter((entry) => isObject(entry))
    }
  }
  if (extractEventName(payload)) {
    return [payload]
  }
  return []
}

async function parseJsonLines(filePath, limit = 200) {
  const text = await readText(filePath).catch(() => '')
  const records = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (isObject(parsed)) {
        records.push(parsed)
      }
    } catch {
      continue
    }
    if (records.length >= limit) break
  }
  return records
}

async function loadEventFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jsonl' || ext === '.log') {
    return parseJsonLines(filePath)
  }
  if (ext === '.json') {
    const parsed = await readJson(filePath).catch(() => null)
    return extractEventRecords(parsed)
  }
  return []
}

async function collectDiagnosticFiles(rootPath, depth = 0) {
  if (depth > 4) return []
  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => [])
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectDiagnosticFiles(fullPath, depth + 1))
      continue
    }
    files.push(fullPath)
  }
  return files
}

function classifyDiagnosticFile(rootPath, filePath) {
  const relativePath = path.relative(rootPath, filePath).split(path.sep).join('/')
  for (const rule of DIAGNOSTIC_FILE_RULES) {
    if (rule.test(relativePath)) {
      return {
        kind: rule.kind,
        path: filePath,
        relativePath,
      }
    }
  }
  return null
}

function relativeToProject(projectRoot, filePath) {
  if (!filePath) return filePath
  const relativePath = path.relative(projectRoot, filePath)
  if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return relativePath.split(path.sep).join('/')
  }
  return filePath
}

function buildEvidenceSources(projectRoot, sources) {
  return sources.map((source) => ({
    kind: source.kind,
    path: relativeToProject(projectRoot, source.path),
  }))
}

function buildDiagnosticQueryExamples({ correlationFields, eventNames, rootCauseCandidates, missingCorrelationFields }) {
  const steps = []
  if (correlationFields.length > 0) {
    steps.push(`先按 ${correlationFields.join(' / ')} 过滤同一次故障的链路，再对齐 runtime-events 和 timeline。`)
  } else {
    steps.push('先按时间窗口、用户会话或任务编号缩小范围，再核对 runtime-events 和 timeline。')
  }
  if (eventNames.length > 0) {
    steps.push(`围绕关键事件 ${eventNames.slice(0, 3).join(' -> ')} 回看成功到失败的断点位置。`)
  }
  if (rootCauseCandidates.length > 0) {
    steps.push(`优先验证 root-cause-candidates 中的 ${rootCauseCandidates[0].title} 是否与当前证据一致。`)
  }
  if (missingCorrelationFields.length > 0) {
    steps.push(`当前证据还缺少 ${missingCorrelationFields.join(', ')}，后续同类路径应默认补齐，避免再次为定位问题加日志。`)
  }
  return steps
}

function buildDiagnosticPrevention({ correlationFields, missingCorrelationFields }) {
  const requirements = [
    '关键路径默认保留 runtime-events、timeline、root-cause-candidates、diagnostic-report 四类证据，而不是等故障出现后再补日志。',
    '失败事件和补偿事件使用稳定事件名，避免把根因埋在自由文本里。',
    '修复完成后保留一份成功与失败对照诊断包，并运行 openprd quality . --learn --from <diagnostics-dir> 更新项目经验。',
  ]
  if (correlationFields.length > 0) {
    requirements.unshift(`同一条链路的前端、后端、异步任务和 Agent 日志统一携带 ${correlationFields.join(', ')}。`)
  }
  if (missingCorrelationFields.length > 0) {
    requirements.push(`当前样本里还缺少 ${missingCorrelationFields.join(', ')}，后续关键路径应在实现阶段补齐。`)
  }
  return requirements
}

function buildDiagnosticVerificationSteps({ correlationFields, eventNames }) {
  const steps = [
    '复现一次同类路径，确认新的诊断包仍能导出 runtime-events、timeline、root-cause-candidates 和 diagnostic-report。',
    '修复后再次执行同一路径，确认时间线不再在历史失败断点中断。',
    '把最终诊断包与质量报告一起归档，确保后续 Agent 能直接复用已有排查路径。',
  ]
  if (correlationFields.length > 0) {
    steps.unshift(`确认复现链路中的关键事件都带有 ${correlationFields.join(', ')}。`)
  }
  if (eventNames.length > 0) {
    steps.splice(1, 0, `重点核对 ${eventNames.slice(0, 3).join(' -> ')} 的顺序是否符合预期。`)
  }
  return steps
}

function normalizeQualityReportSource(projectRoot, report, sourcePath, requiredCorrelationFields) {
  const attentionGates = Array.isArray(report.readiness?.attentionGates) ? report.readiness.attentionGates : []
  const correlationFields = Array.isArray(report.observability?.correlationFields)
    ? report.observability.correlationFields
    : collectCorrelationFields([report.observability ?? {}], requiredCorrelationFields)
  const missingCorrelationFields = requiredCorrelationFields.filter((field) => !correlationFields.includes(field))
  return {
    kind: 'quality-report',
    sourceId: report.id,
    sourcePath,
    primaryPath: sourcePath,
    sourcePaths: [sourcePath],
    title: `质量报告 ${report.id}`,
    status: normalizeStatus(report.summary?.status),
    symptoms: attentionGates.map((gate) => `质量门禁需要关注: ${gate}`),
    attentionGates,
    correlationFields,
    extraContextFields: [],
    missingCorrelationFields,
    eventNames: [],
    rootCauseCandidates: attentionGates.map((gate) => ({
      title: `质量门禁未闭环: ${gate}`,
      nextSteps: [
        '检查最新 HTML 质量报告里的证据链和建议动作。',
        '补齐当前任务缺失的可观测性、护栏、测试或性能证据。',
      ],
    })),
    evidenceSources: buildEvidenceSources(projectRoot, [{ kind: 'quality-report', path: sourcePath }]),
    queryExamples: [
      '先阅读最新 HTML 质量报告，再回查对应门禁的原始证据。',
      correlationFields.length > 0
        ? `确认日志是否已统一携带 ${correlationFields.join(' / ')}。`
        : '确认核心路径是否已有统一链路字段；没有的话应先补诊断骨架。',
      '对照 attention gates 把修复动作、验证证据和后续防复发要求写回项目经验。',
    ],
    abstractPattern: '质量缺口反复出现，通常是因为可观测性、护栏、测试与复盘知识被分散维护，没有进入同一套项目级诊断闭环。',
    triggers: attentionGates,
    prevention: [
      '阶段性开发后运行质量验证。',
      '声明就绪前先审阅 HTML 质量评估报告。',
      '把重复或高影响修复沉淀为带日志入口和验证步骤的项目经验 Skill。',
    ],
    verificationSteps: [
      '运行 openprd quality . --verify 并确认需要关注的门禁已经闭环。',
      '打开 HTML 报告，核对证据链、评估结论和后续动作是否一致。',
      '重新执行任务级 verify 命令，并把最终证据路径保留在质量报告里。',
    ],
  }
}

function normalizeDiagnosticSource(projectRoot, payload, sourceMeta, requiredCorrelationFields) {
  const diagnosticReport = isObject(payload?.diagnosticReport) ? payload.diagnosticReport : (isObject(payload) ? payload : {})
  const records = [
    ...extractEventRecords(payload?.runtimeEvents),
    ...extractEventRecords(payload?.timeline),
    ...extractEventRecords(payload?.events),
    ...extractEventRecords(diagnosticReport?.runtimeEvents),
    ...extractEventRecords(diagnosticReport?.timeline),
  ].slice(0, 400)
  const rootCauseCandidates = extractRootCauseCandidates(payload).length > 0
    ? extractRootCauseCandidates(payload)
    : extractRootCauseCandidates(diagnosticReport)
  const correlationFields = collectCorrelationFields([payload, diagnosticReport, ...records], requiredCorrelationFields)
  const extraContextFields = collectExtraContextFields([payload, diagnosticReport, ...records])
  const missingCorrelationFields = requiredCorrelationFields.filter((field) => !correlationFields.includes(field))
  const eventNames = collectEventNames(records)
  const summaryText = extractSummaryText(diagnosticReport) ?? extractSummaryText(payload)
  const rootTitle = rootCauseCandidates[0]?.title ?? null
  const title = firstString(
    diagnosticReport.title,
    diagnosticReport.problem,
    diagnosticReport.name,
    summaryText,
    rootTitle,
    sourceMeta.fallbackTitle,
  ) ?? '诊断问题'
  const status = normalizeStatus(firstString(diagnosticReport.status, diagnosticReport.summary?.status, payload?.status) ?? 'needs-attention')
  const evidenceSources = buildEvidenceSources(projectRoot, sourceMeta.evidenceSources)
  const symptoms = uniq([
    summaryText,
    diagnosticReport.problem,
    diagnosticReport.message,
    ...rootCauseCandidates.map((candidate) => candidate.title),
  ]).slice(0, 6)
  return {
    kind: sourceMeta.kind,
    sourceId: sourceMeta.sourceId ?? slugify(title, 'diagnostic'),
    sourcePath: sourceMeta.sourcePath,
    primaryPath: sourceMeta.primaryPath,
    sourcePaths: uniq(sourceMeta.evidenceSources.map((source) => source.path)),
    title,
    status,
    symptoms,
    attentionGates: [],
    correlationFields,
    extraContextFields,
    missingCorrelationFields,
    eventNames,
    rootCauseCandidates,
    evidenceSources,
    queryExamples: buildDiagnosticQueryExamples({ correlationFields, eventNames, rootCauseCandidates, missingCorrelationFields }),
    abstractPattern: '同类故障通常会先在 runtime-events、timeline、root-cause-candidates 和 diagnostic-report 中留下证据。只要实现阶段就把这些结构化诊断面铺好，后续多数问题都能先靠现有证据定位，而不是临时补日志。',
    triggers: uniq([
      ...eventNames,
      ...rootCauseCandidates.map((candidate) => candidate.title),
      ...symptoms,
    ]).slice(0, 8),
    prevention: buildDiagnosticPrevention({ correlationFields, missingCorrelationFields }),
    verificationSteps: buildDiagnosticVerificationSteps({ correlationFields, eventNames }),
  }
}

async function resolveDirectSource(filePath, projectRoot, requiredCorrelationFields) {
  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat) return null
  if (stat.isDirectory()) {
    const bundleFiles = (await collectDiagnosticFiles(filePath))
      .map((entry) => classifyDiagnosticFile(filePath, entry))
      .filter(Boolean)
    const evidenceSources = bundleFiles.length > 0
      ? bundleFiles
      : [{ kind: 'diagnostic-bundle', path: filePath, relativePath: path.basename(filePath) }]
    const diagnosticReportFile = bundleFiles.find((file) => file.kind === 'diagnostic-report')
    const diagnosticReport = diagnosticReportFile ? await readJson(diagnosticReportFile.path).catch(() => null) : null
    const rootCauseFiles = bundleFiles.filter((file) => file.kind === 'root-cause-candidates')
    const rootCausePayloads = await Promise.all(rootCauseFiles.map((file) => readJson(file.path).catch(() => null)))
    const eventFiles = bundleFiles.filter((file) => file.kind === 'runtime-events' || file.kind === 'timeline')
    const eventPayloads = await Promise.all(eventFiles.map((file) => loadEventFile(file.path)))
    if (!diagnosticReport && rootCauseFiles.length === 0 && eventFiles.length === 0) {
      return null
    }
    return normalizeDiagnosticSource(projectRoot, {
      diagnosticReport,
      rootCauseCandidates: rootCausePayloads.flatMap((entry) => extractRootCauseCandidates(entry ?? [])),
      runtimeEvents: eventPayloads.filter((entry, index) => eventFiles[index]?.kind === 'runtime-events').flat(),
      timeline: eventPayloads.filter((entry, index) => eventFiles[index]?.kind === 'timeline').flat(),
    }, {
      kind: 'diagnostic-bundle',
      sourcePath: filePath,
      primaryPath: diagnosticReportFile?.path ?? rootCauseFiles[0]?.path ?? eventFiles[0]?.path ?? filePath,
      sourceId: diagnosticReport?.id ?? slugify(path.basename(filePath), 'diagnostic-bundle'),
      fallbackTitle: path.basename(filePath),
      evidenceSources: evidenceSources.map((source) => ({ kind: source.kind, path: source.path })),
    }, requiredCorrelationFields)
  }

  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jsonl' || ext === '.log') {
    const records = await loadEventFile(filePath)
    if (records.length === 0) return null
    return normalizeDiagnosticSource(projectRoot, { runtimeEvents: records }, {
      kind: 'runtime-events',
      sourcePath: filePath,
      primaryPath: filePath,
      sourceId: slugify(path.basename(filePath, ext), 'runtime-events'),
      fallbackTitle: path.basename(filePath),
      evidenceSources: [{ kind: 'runtime-events', path: filePath }],
    }, requiredCorrelationFields)
  }

  if (ext !== '.json') {
    return null
  }

  const parsed = await readJson(filePath).catch(() => null)
  if (!parsed) return null
  if (typeof parsed.id === 'string' && isObject(parsed.summary) && isObject(parsed.readiness) && Array.isArray(parsed.gates)) {
    return normalizeQualityReportSource(projectRoot, parsed, filePath, requiredCorrelationFields)
  }

  const classified = classifyDiagnosticFile(path.dirname(filePath), filePath)
  if (classified?.kind === 'root-cause-candidates') {
    return normalizeDiagnosticSource(projectRoot, { rootCauseCandidates: extractRootCauseCandidates(parsed) }, {
      kind: 'root-cause-candidates',
      sourcePath: filePath,
      primaryPath: filePath,
      sourceId: slugify(path.basename(filePath, ext), 'root-cause'),
      fallbackTitle: path.basename(filePath),
      evidenceSources: [{ kind: 'root-cause-candidates', path: filePath }],
    }, requiredCorrelationFields)
  }

  const eventRecords = extractEventRecords(parsed)
  if (eventRecords.length > 0 || extractRootCauseCandidates(parsed).length > 0 || isObject(parsed.diagnosticReport) || isObject(parsed.summary)) {
    return normalizeDiagnosticSource(projectRoot, parsed, {
      kind: classified?.kind === 'timeline' ? 'timeline' : 'diagnostic-report',
      sourcePath: filePath,
      primaryPath: filePath,
      sourceId: slugify(parsed.id ?? path.basename(filePath, ext), 'diagnostic'),
      fallbackTitle: path.basename(filePath),
      evidenceSources: [{ kind: classified?.kind ?? 'diagnostic-report', path: filePath }],
    }, requiredCorrelationFields)
  }

  return null
}

export async function resolveQualityLearningSource(projectRoot, options = {}) {
  const requiredCorrelationFields = Array.isArray(options.requiredCorrelationFields) ? options.requiredCorrelationFields : []
  const from = options.from
  if (from) {
    const direct = path.isAbsolute(from) ? from : cjoin(projectRoot, from)
    if (await exists(direct)) {
      const source = await resolveDirectSource(direct, projectRoot, requiredCorrelationFields)
      if (source) {
        return { ok: true, source }
      }
      return {
        ok: false,
        error: 'Unsupported learn source. Provide a quality report JSON, an extracted diagnostics directory, or runtime-events / timeline / root-cause JSON evidence.',
      }
    }

    const asReportId = cjoin(projectRoot, '.openprd', 'quality', 'reports', `${from}.json`)
    if (await exists(asReportId)) {
      const source = await resolveDirectSource(asReportId, projectRoot, requiredCorrelationFields)
      if (source) {
        return { ok: true, source }
      }
    }
    return {
      ok: false,
      error: `Learn source not found: ${from}`,
    }
  }

  if (options.latestReportPath && await exists(options.latestReportPath)) {
    const source = await resolveDirectSource(options.latestReportPath, projectRoot, requiredCorrelationFields)
    if (source) {
      return { ok: true, source }
    }
  }

  return {
    ok: false,
    error: 'No quality report or diagnostic evidence found. Run: openprd quality . --verify or pass --from <diagnostics-dir>',
  }
}

function renderList(items, fallback) {
  const list = items.filter(Boolean)
  if (list.length === 0) {
    return `- ${fallback}`
  }
  return list.map((item) => `- ${item}`).join('\n')
}

function renderEvidenceSources(evidenceSources) {
  return renderList(
    evidenceSources.map((source) => `${source.kind}: \`${source.path}\``),
    '当前来源没有显式证据清单，后续应补齐标准诊断目录。',
  )
}

function renderRootCauseCandidates(rootCauseCandidates) {
  return renderList(
    rootCauseCandidates.map((candidate) => {
      const evidence = candidate.evidence?.length ? `；证据: ${candidate.evidence.join(' / ')}` : ''
      const nextSteps = candidate.nextSteps?.length ? `；下一步: ${candidate.nextSteps.join(' / ')}` : ''
      return `${candidate.title}${evidence}${nextSteps}`
    }),
    '当前还没有明确根因候选，先按证据顺序排查并补齐 root-cause-candidates。',
  )
}

function renderCorrelationSection({ correlationFields, extraContextFields, missingCorrelationFields }) {
  const lines = []
  if (correlationFields.length > 0) {
    lines.push(`已识别标准关联字段: ${correlationFields.join(', ')}`)
  }
  if (extraContextFields.length > 0) {
    lines.push(`辅助上下文字段: ${extraContextFields.join(', ')}`)
  }
  if (missingCorrelationFields.length > 0) {
    lines.push(`当前样本缺少: ${missingCorrelationFields.join(', ')}；后续关键路径应默认补齐。`)
  }
  return renderList(lines, '当前来源没有显式标准关联字段，后续应把 trace/request/task/error 级别字段纳入默认日志信封。')
}

export function renderExperienceSkill({ skillName, source }) {
  const triggers = source.kind === 'quality-report'
    ? [
      '某项任务改动了前端、后端、agent 工作流或错误处理行为。',
      '这次变更缺少日志关联、业务成本与滥用护栏、冒烟覆盖、性能证据，或已经出现重复问题模式。',
      source.attentionGates.length > 0 ? `最近一次质量报告的关注门禁包括：${source.attentionGates.join(', ')}。` : null,
    ]
    : [
      '用户反馈同类故障再次出现，且需要快速沿着已有诊断证据定位。',
      source.eventNames.length > 0 ? `运行态再次出现事件：${source.eventNames.join(', ')}。` : null,
      source.symptoms.length > 0 ? `本次症状包括：${source.symptoms.join('；')}。` : null,
    ]

  return `---
name: ${skillName}
description: 由 OpenPrd 从 ${source.kind} 自动沉淀的项目级排查经验。目标是在相似问题再次出现时优先复用现有诊断证据，而不是临时补日志。
---

# ${skillName}

## 触发条件

${renderList(triggers, '当同类问题再次出现，先复用这套排查路径。')}

## 先看哪些证据

${renderEvidenceSources(source.evidenceSources)}

## 关联字段

${renderCorrelationSection(source)}

## 排查顺序

${renderList(source.queryExamples, '先按时间线和失败断点回看证据，再补最小必要日志。')}

## 常见根因

${renderRootCauseCandidates(source.rootCauseCandidates)}

## 防复发要求

${renderList(source.prevention, '修复后把新的排查模式沉淀为项目知识。')}

## 验证方式

${renderList(source.verificationSteps, '修复后重新复现，并确认现有诊断证据足以定位。')}
`
}
