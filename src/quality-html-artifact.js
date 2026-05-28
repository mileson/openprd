function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const QUALITY_REPORT_FRAMEWORK = {
  intent: '质量报告面向业务和产品评审者，只展示能帮助判断是否继续推进的信息。',
  layout: [
    '回归结论概览：一句话说明能否继续，展示必测、待处理、确认项和验证材料数量',
    '回归流程图：由 OpenPrD 工具生成固定步骤，展示成本护栏、冒烟测试、任务覆盖、风险复核、验证材料和最终结论',
    '测试覆盖图：由 OpenPrD 工具生成固定槽位，表达检查范围、必测结果、待处理、验证材料和最终判断',
    '四个固定模块：本期必测结果、需要处理或确认、验证材料、执行环境与覆盖',
    '固定底部操作栏：只保留需要补测和认可回归两个动作',
    '折叠详情：保留表格、证据链、结构化数据和框架约束',
  ],
  contentRules: [
    '所有标题和说明使用普通产品语言，避免 gate、production-ready、EVO、runtime、schema 等内部词',
    '流程图步骤标题、状态和旁路原因均由工具生成，单项控制在 15 字以内',
    '流程图中未通过或待确认步骤自动挂旁路原因卡，不让 Agent 手动画线或自由写长句',
    '图中每个卡片正文控制在 30 字以内，由生成逻辑先总结，不靠 CSS 截断，也不让 Agent 直接手写 SVG',
    '图中卡片标题控制在 15 字以内，并使用胶囊样式',
    '四个模块的明细统一为“加粗摘要 + 一句话说明”',
    '异常为空时给出明确空状态，不让用户猜测是不是漏了内容',
  ],
};

function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function humanText(value) {
  return compactText(value)
    .replace(/production-ready/g, '可继续')
    .replace(/needs-attention/g, '需处理')
    .replace(/needs-evidence/g, '需补证据')
    .replace(/EVO/g, '交付')
    .replace(/runtime/g, '运行过程')
    .replace(/schema/g, '结构')
    .replace(/门禁/g, '测试块')
    .replace(/项目级巡检/g, '全项目检查')
    .replace(/需求级回归/g, '当前需求检查')
    .replace(/\s*Skill\s*/g, '经验');
}

function gateDisplay(gate) {
  if (gate?.id === 'knowledge') return '经验沉淀';
  return humanText(gate?.label ?? gate?.id ?? '测试块');
}

function statusLabel(status) {
  if (status === 'pass') return '已通过';
  if (status === 'fail') return '失败';
  if (status === 'needs-evidence') return '缺少证据';
  if (status === 'advisory') return '需确认';
  if (status === 'waived') return '已豁免';
  return '需关注';
}

function toneForGate(gate) {
  if (gate.status === 'pass' || gate.status === 'waived') return 'pass';
  if (gate.required) return 'fail';
  if (gate.status === 'needs-evidence') return 'warn';
  return 'note';
}

function scenarioLabel(tag) {
  const labels = {
    core: '基础验证',
    frontend: '界面体验',
    desktop: '桌面端体验',
    backend: '服务与数据处理',
    businessCost: '成本与滥用风险',
    security: '隐私与安全',
    performance: '性能风险',
    extreme: '极端场景',
    release: '上线交付',
    legacy: '历史兼容',
  };
  return labels[tag] ?? tag;
}

function policyLabels(report) {
  const policy = report.qualityPolicy ?? { scenarioTags: [], requiredGates: [], optionalGates: [] };
  const gateById = new Map((report.gates ?? []).map((gate) => [gate.id, gate]));
  const labelFor = (id) => gateDisplay(gateById.get(id) ?? { id });
  return {
    scenarioLabels: policy.scenarioTags.map(scenarioLabel),
    requiredLabels: policy.requiredGates.map(labelFor),
    optionalLabels: policy.optionalGates.map(labelFor),
  };
}

function gateDescription(gate) {
  const descriptions = {
    smoke: '核心路径能否跑通，至少覆盖主流程和关键失败路径',
    'feature-coverage': '需求拆解项是否全部完成，验收点是否有对应回归',
    'business-guardrails': '成本、额度、滥用、报警和止损是否讲清楚',
    traceability: '出问题时是否能追到用户动作、请求、任务和错误',
    redaction: '报告、日志和错误信息是否会暴露敏感信息',
    'normal-performance': '普通规模下是否可用、不卡顿、不超时',
    'extreme-performance': '大数据、并发、异常输入或边界规模是否有兜底',
    knowledge: '本次问题是否需要沉淀经验，避免下次重复漏测',
  };
  return descriptions[gate.id] ?? '确认这项测试是否和本次需求相关，证据是否来自本次执行';
}

function gateTreatment(gate) {
  if (gate.id === 'feature-coverage' && gate.evidence?.summary === '当前没有激活任务清单') {
    return '全项目检查可继续；具体需求交付时要补任务拆解';
  }
  if (gate.required && gate.status === 'pass') return '保留证据即可继续';
  if (gate.required) return '现在修复或补证据，完成后重新生成报告';
  if (gate.status === 'pass') return '已覆盖，可作为辅助证据保留';
  return '判断是否属于本期；属于就补测，不属于才记录延期原因';
}

function gateSummary(gate) {
  const label = gateDisplay(gate);
  if (gate.status === 'pass') return `${label}已通过`;
  if (gate.required) return `${label}未通过`;
  if (gate.status === 'needs-evidence') return `${label}缺证据`;
  return `${label}需确认`;
}

function evidenceRows(report) {
  return (report.gates ?? []).flatMap((gate) => {
    const sources = gate.evidence?.sources ?? [];
    if (sources.length === 0) {
      return [{
        gate,
        source: '未提供',
        path: gate.required ? '缺少必需证据' : '当前场景未要求',
        empty: true,
      }];
    }
    return sources.map((source) => ({
      gate,
      source: source.source ?? 'evidence',
      path: source.path ?? 'unknown',
      empty: false,
    }));
  });
}

function evidenceCount(report) {
  return evidenceRows(report).filter((row) => !row.empty).length;
}

function activeTasks(report) {
  return report.evalHarness?.featureCoverage?.activeTasks ?? {
    activeChange: report.summary?.activeChange ?? null,
    total: 0,
    done: 0,
    pending: 0,
    tasks: [],
  };
}

function requiredGates(report) {
  return (report.gates ?? []).filter((gate) => gate.required);
}

function passedRequired(gates) {
  return gates.filter((gate) => ['pass', 'waived'].includes(gate.status)).length;
}

function actionItems(report) {
  const required = requiredGates(report);
  const failing = required.filter((gate) => !['pass', 'waived'].includes(gate.status));
  const advisory = (report.gates ?? []).filter((gate) => !gate.required && gate.status !== 'pass');
  if (failing.length > 0) {
    return failing.map((gate) => `${gateDisplay(gate)}：${humanText(gate.warnings?.[0] ?? gate.evidence?.summary ?? '补齐证据后再继续')}`);
  }
  if (advisory.length > 0) {
    return advisory.map((gate) => `${gateDisplay(gate)}：判断是否属于本期，属于就补测，不属于就说明延期原因`);
  }
  return ['本期必测全部通过；继续保留本次证据，交付前再复跑一次验证'];
}

function chip(text, tone = 'neutral') {
  return `<span class="quality-chip ${escapeHtml(tone)}">${escapeHtml(text)}</span>`;
}

function chipRow(items, emptyText = '暂无') {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (list.length === 0) return chip(emptyText, 'muted');
  return list.join('\n');
}

function icon(kind) {
  const icons = {
    map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="M5 8h14" /><path d="M7 16h10" /><circle cx="12" cy="5" r="2" /><circle cx="5" cy="8" r="2" /><circle cx="19" cy="8" r="2" /><circle cx="7" cy="16" r="2" /><circle cx="17" cy="16" r="2" /></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>',
    alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 3.5 19h17L12 4Z" /><path d="M12 9v4" /><path d="M12 16.5h.01" /></svg>',
    evidence: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v5h4" /><path d="M9 13h6" /><path d="M9 17h4" /></svg>',
    environment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /><circle cx="8" cy="7" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="11" cy="17" r="2" /></svg>',
  };
  return `<span class="quality-icon quality-icon-${escapeHtml(kind)}">${icons[kind] ?? icons.check}</span>`;
}

function splitSvgLines(value, maxChars = 17) {
  const text = compactText(value) || '待补充';
  const tokens = text.match(/[A-Za-z0-9_./:-]+|[\u4e00-\u9fff]|[^\s]/g) ?? [text];
  const lines = [];
  let line = '';
  let length = 0;
  const visualLength = (token) => /^[A-Za-z0-9_./:-]+$/.test(token)
    ? Math.max(1, token.length * 0.62)
    : 1;
  for (const token of tokens) {
    const nextLength = visualLength(token);
    if (line && length + nextLength > maxChars) {
      lines.push(line);
      line = token;
      length = nextLength;
    } else {
      line += token;
      length += nextLength;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function svgTextBlock(value, x, centerY, className, maxChars = 16, lineHeight = 16, anchor = 'start') {
  const lines = splitSvgLines(value, maxChars);
  const firstY = centerY - ((lines.length - 1) * lineHeight) / 2;
  return `<text class="${className}" x="${x}" y="${firstY}" text-anchor="${anchor}" dominant-baseline="middle" alignment-baseline="middle">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeHtml(line)}</tspan>`).join('')}</text>`;
}

function svgPill({ x, y, width, height, tone, label }) {
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  return `
    <rect class="quality-map-pill ${escapeHtml(tone)}" x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" />
    <text class="quality-map-pill-text ${escapeHtml(tone)}" x="${centerX}" y="${centerY}" text-anchor="middle" dominant-baseline="middle" alignment-baseline="middle">${escapeHtml(label)}</text>
  `;
}

function gateById(report, id) {
  return (report.gates ?? []).find((gate) => gate.id === id) ?? null;
}

function flowStateFromGate(gate) {
  if (!gate) return 'pass';
  if (gate.status === 'pass' || gate.status === 'waived') return 'pass';
  if (gate.required) return 'fail';
  return 'warn';
}

function flowStatusText(state) {
  if (state === 'pass') return '已通过';
  if (state === 'fail') return '未通过';
  return '待确认';
}

function flowReasonForGate(title, gate, state) {
  if (state === 'pass') return null;
  if (!gate) return `${title}待补`;
  if (state === 'fail') return `${title}需补测`;
  return `${title}需确认`;
}

function flowStepFromGate(report, title, id, options = {}) {
  const gate = gateById(report, id);
  const missingState = options.missingState ?? 'pass';
  const missingStatus = options.missingStatus ?? '未涉及';
  const state = flowStateFromGate(gate);
  return {
    title,
    state: gate ? state : missingState,
    status: gate ? flowStatusText(state) : missingStatus,
    reason: gate ? flowReasonForGate(title, gate, state) : (missingState === 'pass' ? null : `${title}待补`),
  };
}

function riskFlowReason(advisory) {
  if (advisory.length === 0) return null;
  const first = gateDisplay(advisory[0]).replace(/需确认$/u, '');
  return advisory.length === 1 ? `${first}待确认` : `${first}等${advisory.length}项`;
}

function regressionFlowModel({ report, advisory }) {
  const evidenceTotal = evidenceCount(report);
  const riskState = advisory.length > 0 ? 'warn' : 'pass';
  const evidenceState = evidenceTotal > 0 ? 'pass' : 'fail';
  const conclusionState = report.readiness?.productionReady === true ? 'pass' : 'fail';
  return [
    flowStepFromGate(report, '成本护栏', 'business-guardrails'),
    flowStepFromGate(report, '冒烟测试', 'smoke', { missingState: 'fail', missingStatus: '未找到测试' }),
    flowStepFromGate(report, '任务覆盖', 'feature-coverage', { missingState: 'fail', missingStatus: '未找到任务' }),
    {
      title: '风险复核',
      state: riskState,
      status: riskState === 'pass' ? '已通过' : `确认 ${advisory.length} 项`,
      reason: riskFlowReason(advisory),
    },
    {
      title: '验证留存',
      state: evidenceState,
      status: evidenceState === 'pass' ? `${evidenceTotal} 条材料` : '缺少材料',
      reason: evidenceState === 'pass' ? null : '补验证材料',
    },
    {
      title: '最终结论',
      state: conclusionState,
      status: conclusionState === 'pass' ? '可以继续' : '先补测',
      reason: conclusionState === 'pass' ? null : '补完再继续',
    },
  ];
}

function flowTone(state) {
  if (state === 'pass') return 'pass';
  if (state === 'fail') return 'fail';
  return 'warn';
}

function regressionFlow({ report, advisory }) {
  const steps = regressionFlowModel({ report, advisory });
  const width = 112;
  const gap = 36;
  const startX = 52;
  const y = 32;
  const noteY = 132;
  return `
    <div class="quality-flow-canvas" aria-label="回归流程图">
      <svg viewBox="0 0 960 210" role="img" aria-label="回归流程图" preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="quality-flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L8,4 L0,8 Z" class="quality-flow-arrow-head" />
          </marker>
        </defs>
        <rect class="quality-map-bg" x="2" y="2" width="956" height="206" rx="8" />
        ${steps.map((step, index) => {
          const x = startX + index * (width + gap);
          const centerX = x + width / 2;
          const nextX = x + width + 10;
          const line = index < steps.length - 1
            ? `<path class="quality-flow-link" d="M ${nextX} ${y + 44} H ${startX + (index + 1) * (width + gap) - 10}" />`
            : '';
          const note = step.reason
            ? `
              <path class="quality-flow-note-link ${flowTone(step.state)}" d="M ${centerX} ${y + 88} V ${noteY}" />
              <g>
                <rect class="quality-flow-note ${flowTone(step.state)}" x="${x - 6}" y="${noteY}" width="${width + 12}" height="42" rx="8" />
                ${svgTextBlock(step.reason, centerX, noteY + 21, 'quality-flow-note-text', 15, 14, 'middle')}
              </g>
            `
            : '';
          return `
            ${line}
            <g>
              <rect class="quality-flow-step ${flowTone(step.state)}" x="${x}" y="${y}" width="${width}" height="88" rx="8" />
              <circle class="quality-flow-index ${flowTone(step.state)}" cx="${x + 5}" cy="${y + 5}" r="10" />
              <text class="quality-flow-index-text" x="${x + 5}" y="${y + 5}" text-anchor="middle" dominant-baseline="middle" alignment-baseline="middle">${index + 1}</text>
              ${svgPill({ x: centerX - 39, y: y + 13, width: 78, height: 24, tone: flowTone(step.state), label: step.title })}
              ${svgTextBlock(step.status, centerX, y + 61, 'quality-flow-status', 15, 14, 'middle')}
            </g>
            ${note}
          `;
        }).join('\n')}
      </svg>
    </div>
  `;
}

function decisionText(report, required, requiredPassed, failingRequired, tasks) {
  if (report.readiness?.productionReady !== true) {
    return `有 ${failingRequired.length} 项必须先处理，补测后再继续`;
  }
  if (tasks.total > 0) {
    return `需求任务 ${tasks.done}/${tasks.total} 完成，本期必测 ${requiredPassed}/${required.length} 通过`;
  }
  return `全项目检查通过，本期必测 ${requiredPassed}/${required.length} 通过`;
}

function reportScopeText(tasks) {
  return tasks.activeChange ? '当前需求检查' : '全项目检查';
}

function coverageDiagramModel({ report, tasks, required, requiredPassed, failingRequired, advisory }) {
  const productionReady = report.readiness?.productionReady === true;
  const evidenceTotal = evidenceCount(report);
  return {
    scope: {
      title: '检查范围',
      body: reportScopeText(tasks),
    },
    required: {
      title: '必测结果',
      body: `${requiredPassed}/${required.length} 项通过`,
    },
    attention: {
      title: '待处理',
      body: failingRequired.length > 0 ? `${failingRequired.length} 项需补测` : '没有必须修复',
    },
    evidence: {
      title: '验证材料',
      body: evidenceTotal > 0 ? `已留 ${evidenceTotal} 条` : '还缺验证材料',
    },
    final: {
      title: '结论',
      body: productionReady ? '可以继续' : '先补测',
      sub: advisory.length > 0 ? `还需确认 ${advisory.length} 项` : '无需额外确认',
    },
  };
}

function coverageMap({ report, tasks, required, requiredPassed, failingRequired, advisory }) {
  const diagram = coverageDiagramModel({ report, tasks, required, requiredPassed, failingRequired, advisory });
  return `
    <section class="quality-map" aria-labelledby="qualityMapTitle">
      <div class="quality-section-heading">
        ${icon('map')}
        <div>
          <h2 id="qualityMapTitle">回归流程与覆盖图</h2>
          <p>先看测试流程是否走完，再看覆盖范围和结论</p>
        </div>
      </div>
      <div class="quality-map-subheading">回归流程图</div>
      ${regressionFlow({ report, advisory })}
      <div class="quality-map-subheading">测试覆盖图</div>
      <div class="quality-map-canvas">
        <svg viewBox="0 0 960 300" role="img" aria-label="测试覆盖图" preserveAspectRatio="xMidYMid meet">
          <rect class="quality-map-bg" x="2" y="2" width="956" height="296" rx="8" />
          <path class="quality-map-link" d="M 252 93 H 708" />
          <path class="quality-map-link" d="M 480 92 V 204 H 252" />
          <path class="quality-map-link" d="M 480 204 H 708" />
          <g>
            <rect class="quality-map-node scope" x="112" y="48" width="280" height="88" rx="8" />
            ${svgPill({ x: 198, y: 36, width: 108, height: 30, tone: 'scope', label: diagram.scope.title })}
            ${svgTextBlock(diagram.scope.body, 144, 94, 'quality-map-label', 16, 16, 'start')}
          </g>
          <g>
            <rect class="quality-map-node required" x="568" y="48" width="280" height="88" rx="8" />
            ${svgPill({ x: 654, y: 36, width: 108, height: 30, tone: 'required', label: diagram.required.title })}
            ${svgTextBlock(diagram.required.body, 600, 94, 'quality-map-label', 16, 16, 'start')}
          </g>
          <g>
            <rect class="quality-map-node attention" x="112" y="188" width="280" height="82" rx="8" />
            ${svgPill({ x: 198, y: 176, width: 108, height: 30, tone: 'attention', label: diagram.attention.title })}
            ${svgTextBlock(diagram.attention.body, 144, 229, 'quality-map-label', 16, 16, 'start')}
          </g>
          <g>
            <rect class="quality-map-node evidence" x="568" y="188" width="280" height="82" rx="8" />
            ${svgPill({ x: 650, y: 176, width: 116, height: 30, tone: 'evidence', label: diagram.evidence.title })}
            ${svgTextBlock(diagram.evidence.body, 600, 229, 'quality-map-label', 16, 16, 'start')}
          </g>
          <g>
            <rect class="quality-map-center" x="340" y="112" width="280" height="84" rx="8" />
            ${svgPill({ x: 426, y: 100, width: 108, height: 30, tone: 'center', label: diagram.final.title })}
            ${svgTextBlock(diagram.final.body, 372, 154, 'quality-map-label center', 17, 16, 'start')}
            <text class="quality-map-sub" x="480" y="181" text-anchor="middle">${escapeHtml(diagram.final.sub)}</text>
          </g>
        </svg>
      </div>
    </section>
  `;
}

function detailList(items, emptyText) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (list.length === 0) {
    return `<ul class="quality-list"><li class="empty">${escapeHtml(emptyText)}</li></ul>`;
  }
  return `
    <ul class="quality-list">
      ${list.map((item) => `
        <li><strong>${escapeHtml(item.summary)}</strong><span>：${escapeHtml(item.detail)}</span></li>
      `).join('\n')}
    </ul>
  `;
}

function requiredItems(required) {
  return required.map((gate) => ({
    summary: gateSummary(gate),
    detail: `${gate.required ? '本期必测' : '按风险确认'}，${gate.evidence?.summary ?? '等待补充本次证据'}。${gateTreatment(gate)}`,
  }));
}

function exceptionItems(report) {
  return (report.gates ?? [])
    .filter((gate) => gate.status !== 'pass' && gate.status !== 'waived')
    .map((gate) => ({
      summary: gateSummary(gate),
      detail: humanText(gate.warnings?.[0] ?? gateTreatment(gate)).replace(/[。.]$/u, ''),
    }));
}

function evidenceItems(report) {
  return evidenceRows(report)
    .filter((row) => !row.empty)
    .slice(0, 5)
    .map((row) => ({
      summary: gateDisplay(row.gate),
      detail: `${row.source}，${row.path}`,
    }));
}

function environmentItems(report) {
  const evalHarness = report.evalHarness;
  const obs = report.observability;
  const knowledge = report.knowledge;
  const businessGuardrails = report.businessGuardrails;
  return [
    {
      summary: evalHarness.smoke.present ? '主流程验证可用' : '主流程验证缺失',
      detail: evalHarness.smoke.commands.join(' / ') || '还没有发现可直接复跑的验证入口',
    },
    {
      summary: '任务覆盖',
      detail: `已完成 ${evalHarness.featureCoverage.activeTasks.done}/${evalHarness.featureCoverage.activeTasks.total}，待处理 ${evalHarness.featureCoverage.activeTasks.pending}`,
    },
    {
      summary: '问题追踪',
      detail: obs.correlationFields.length > 0 ? `检测到 ${obs.correlationFields.length} 个追踪字段` : '暂未发现足够的问题追踪线索',
    },
    {
      summary: '成本护栏',
      detail: businessGuardrails.missingEvidence.length > 0 ? businessGuardrails.missingEvidence.join('；') : '当前没有发现成本护栏缺口',
    },
    {
      summary: '经验沉淀',
      detail: knowledge.skills.length > 0 ? `已有 ${knowledge.skills.length} 个项目经验` : '首次稳定问题修复后应沉淀经验',
    },
  ];
}

function panel({ kind, title, description, chips, items, emptyText }) {
  return `
    <section class="quality-panel quality-panel-${escapeHtml(kind)}">
      <header class="quality-panel-head">
        ${icon(kind)}
        <div>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(description)}</p>
        </div>
      </header>
      <div class="quality-chip-row">${chipRow(chips, '暂无重点')}</div>
      ${detailList(items, emptyText)}
    </section>
  `;
}

function tableRowsForTasks(tasks, report) {
  const tasksList = tasks.tasks ?? [];
  const required = requiredGates(report);
  const requiredDone = passedRequired(required);
  const failing = required.filter((gate) => !['pass', 'waived'].includes(gate.status));
  const advisory = (report.gates ?? []).filter((gate) => !gate.required && gate.status !== 'pass');
  if (tasksList.length === 0) {
    return `
      <tr>
        <td>当前没有激活需求任务</td>
        <td>项目级必测 ${escapeHtml(`${requiredDone}/${required.length}`)} 通过</td>
        <td>如果这是具体需求交付，应先生成或保留任务清单，再逐项回归。</td>
      </tr>
    `;
  }
  return tasksList.map((task) => {
    const conclusion = !task.done
      ? '不能认可，应完成或明确延期原因。'
      : failing.length > 0
        ? '不能认可，仍有本期必测未通过。'
        : advisory.length > 0
          ? '功能已完成；需确认风险项是否属于本期。'
          : '通过，无需人工评审。';
    return `
      <tr>
        <td>
          <strong>${escapeHtml(task.title)}</strong>
          <span><code>${escapeHtml(`${task.source}:${task.line}`)}</code></span>
        </td>
        <td>${escapeHtml(task.done ? '已完成' : task.blocked ? '阻塞' : '未完成')} · 必测 ${escapeHtml(`${requiredDone}/${required.length}`)}</td>
        <td>${escapeHtml(conclusion)}</td>
      </tr>
    `;
  }).join('\n');
}

function tableRowsForGates(report) {
  return (report.gates ?? []).map((gate) => `
    <tr>
      <td>
        <strong>${escapeHtml(gateDisplay(gate))}</strong>
        <span>${escapeHtml(gateDescription(gate))}</span>
      </td>
      <td>${chip(gate.required ? '本期必测' : '按风险确认', gate.required ? 'fail' : 'note')}</td>
      <td><span class="quality-status ${toneForGate(gate)}">${escapeHtml(statusLabel(gate.status))}</span></td>
      <td>
        <strong>${gate.evidence?.present ? `${gate.evidence.sources.length} 条` : '缺证据'}</strong>
        <span>${escapeHtml(gate.evidence?.summary ?? '未找到本次执行证据')}</span>
      </td>
      <td>${escapeHtml(gateTreatment(gate))}</td>
    </tr>
  `).join('\n');
}

function tableRowsForEvidence(report) {
  return evidenceRows(report).map((row) => `
    <tr>
      <td>${escapeHtml(gateDisplay(row.gate))}</td>
      <td>${escapeHtml(row.source)}</td>
      <td><code>${escapeHtml(row.path)}</code></td>
      <td>${row.gate.required ? '本期必测' : '按风险确认'}</td>
    </tr>
  `).join('\n');
}

function copyContext(report) {
  const required = requiredGates(report);
  const requiredDone = passedRequired(required);
  return JSON.stringify({
    reportId: report.id,
    generatedAt: report.generatedAt,
    decision: report.readiness?.productionReady ? '认可回归' : '需要补测',
    activeChange: report.summary?.activeChange,
    required: `${requiredDone}/${required.length}`,
    needsAction: required
      .filter((gate) => !['pass', 'waived'].includes(gate.status))
      .map(gateDisplay),
    needsConfirmation: (report.gates ?? [])
      .filter((gate) => !gate.required && gate.status !== 'pass')
      .map(gateDisplay),
  }, null, 2);
}

function bottomCopy(report, action) {
  const context = copyContext(report);
  if (action === 'confirm') {
    return [
      'OpenPrD Quality: 认可回归',
      '',
      '我认可这份回归测试报告，请按这个结论继续推进。',
      '',
      '上下文:',
      context,
    ].join('\n');
  }
  return [
    'OpenPrD Quality: 需要补测',
    '',
    '我认为这份回归报告还不能直接认可。请先处理下面的遗漏，补完后重新生成报告给我评审。',
    '',
    '建议动作:',
    ...actionItems(report).map((item) => `- ${item}`),
    '',
    '复跑要求:',
    '- openprd quality . --verify',
    '- openprd run . --verify',
    '',
    '上下文:',
    context,
  ].join('\n');
}

function bottomBar(report) {
  return `
    <nav class="quality-bottom-bar" aria-label="回归决定">
      <div class="quality-bottom-bar-inner">
        <button type="button" class="quality-bottom-action revise" data-copy-value="${escapeHtml(bottomCopy(report, 'revise'))}">需要补测</button>
        <button type="button" class="quality-bottom-action confirm" data-copy-value="${escapeHtml(bottomCopy(report, 'confirm'))}">认可回归</button>
      </div>
    </nav>
  `;
}

function frameworkSection(report) {
  return `
    <details class="quality-details-section">
      <summary>给 Agent 的质量报告框架</summary>
      <div class="quality-details-body">
        <section class="quality-detail-section">
          <h2>框架约束</h2>
          <p>这部分用于后续把质量报告沉淀为稳定模板，让 Agent 按结构补充内容，而不是让页面临时裁剪文本。</p>
          <pre class="quality-json">${escapeHtml(JSON.stringify({
            reportId: report.id,
            framework: QUALITY_REPORT_FRAMEWORK,
          }, null, 2))}</pre>
        </section>
      </div>
    </details>
  `;
}

function styles() {
  return `
    :root {
      color-scheme: light;
      --quality-bg: #f6f8fb;
      --quality-panel: #ffffff;
      --quality-soft: #f9fafb;
      --quality-text: #172033;
      --quality-muted: #667085;
      --quality-line: #d8dee8;
      --quality-blue: #2563eb;
      --quality-teal: #0f766e;
      --quality-indigo: #4f46e5;
      --quality-amber: #b45309;
      --quality-red: #dc2626;
      --quality-green: #15803d;
      --quality-mono: "JetBrains Mono", "SFMono-Regular", Menlo, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--quality-bg);
      color: var(--quality-text);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow-x: hidden;
    }
    .quality-page {
      max-width: 1220px;
      margin: 0 auto;
      padding: 28px 22px 126px;
    }
    .quality-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
    }
    .quality-brand {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      border: 1px solid var(--quality-line);
      border-radius: 999px;
      background: var(--quality-panel);
      color: var(--quality-muted);
      padding: 0 12px;
      font-size: 13px;
      font-weight: 750;
    }
    .quality-top-meta,
    .quality-summary-row,
    .quality-chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .quality-top-meta { justify-content: flex-end; }
    .quality-overview,
    .quality-map,
    .quality-panel,
    .quality-details-section,
    .quality-appendix {
      border: 1px solid var(--quality-line);
      border-radius: 8px;
      background: var(--quality-panel);
      box-shadow: 0 16px 34px rgba(15, 23, 42, 0.06);
    }
    .quality-overview { padding: 24px; }
    .quality-kicker {
      margin: 0 0 6px;
      color: var(--quality-muted);
      font-size: 13px;
      font-weight: 850;
    }
    .quality-overview h1,
    .quality-map h2,
    .quality-panel h2,
    .quality-detail-section h2 {
      margin: 0;
      color: var(--quality-text);
      letter-spacing: 0;
    }
    .quality-overview h1 {
      font-size: 34px;
      line-height: 1.16;
    }
    .quality-subtitle {
      margin: 12px 0 0;
      max-width: 880px;
      color: var(--quality-muted);
      font-size: 16px;
      line-height: 1.7;
    }
    .quality-summary-row { margin-top: 18px; }
    .quality-chip {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      min-height: 30px;
      padding: 5px 10px;
      border-radius: 999px;
      border: 1px solid var(--quality-line);
      background: #ffffff;
      color: var(--quality-text);
      font-size: 13px;
      font-weight: 760;
      line-height: 1.25;
      white-space: nowrap;
    }
    .quality-chip.pass { border-color: #bbf7d0; background: #ecfdf3; color: var(--quality-green); }
    .quality-chip.fail { border-color: #fecaca; background: #fff1f2; color: var(--quality-red); }
    .quality-chip.warn { border-color: #fde68a; background: #fffbeb; color: var(--quality-amber); }
    .quality-chip.note { border-color: #bfdbfe; background: #eff6ff; color: var(--quality-blue); }
    .quality-chip.muted { color: var(--quality-muted); background: #ffffff; }
    .quality-section-heading,
    .quality-panel-head {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .quality-icon {
      flex: 0 0 auto;
      display: inline-flex;
      width: 38px;
      height: 38px;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
    }
    .quality-icon svg {
      width: 22px;
      height: 22px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .quality-icon-map { color: var(--quality-indigo); background: #eef2ff; }
    .quality-icon-check { color: var(--quality-teal); background: #ccfbf1; }
    .quality-icon-alert { color: var(--quality-red); background: #fee2e2; }
    .quality-icon-evidence { color: var(--quality-blue); background: #dbeafe; }
    .quality-icon-environment { color: var(--quality-amber); background: #fef3c7; }
    .quality-map {
      margin-top: 18px;
      padding: 20px;
    }
    .quality-map h2 { font-size: 22px; }
    .quality-section-heading p {
      margin: 5px 0 0;
      color: var(--quality-muted);
      font-size: 14px;
      line-height: 1.55;
    }
    .quality-map-subheading {
      margin-top: 16px;
      color: var(--quality-muted);
      font-size: 13px;
      font-weight: 850;
    }
    .quality-map-canvas,
    .quality-flow-canvas {
      margin-top: 14px;
      overflow-x: auto;
      max-width: 100%;
    }
    .quality-map-canvas svg,
    .quality-flow-canvas svg {
      display: block;
      width: 100%;
      min-width: 700px;
      height: auto;
    }
    .quality-map-bg { fill: #f8fafc; stroke: #e2e8f0; }
    .quality-map-link {
      fill: none;
      stroke: #a5b4fc;
      stroke-width: 2.5;
      stroke-linecap: round;
    }
    .quality-map-node,
    .quality-map-center {
      fill: #ffffff;
      stroke: #cbd5e1;
      stroke-width: 1.6;
      filter: drop-shadow(0 12px 18px rgba(15, 23, 42, 0.08));
    }
    .quality-map-center {
      fill: #eef2ff;
      stroke: #818cf8;
    }
    .quality-map-node.scope { stroke: #5eead4; }
    .quality-map-node.required { stroke: #93c5fd; }
    .quality-map-node.attention { stroke: #fde68a; }
    .quality-map-node.evidence { stroke: #fecaca; }
    .quality-map-pill {
      fill: #ffffff;
      stroke-width: 1.4;
    }
    .quality-map-pill.scope { fill: #ccfbf1; stroke: #5eead4; }
    .quality-map-pill.required { fill: #dbeafe; stroke: #93c5fd; }
    .quality-map-pill.attention { fill: #fef3c7; stroke: #facc15; }
    .quality-map-pill.evidence { fill: #fee2e2; stroke: #fca5a5; }
    .quality-map-pill.center { fill: #e0e7ff; stroke: #a5b4fc; }
    .quality-map-pill.pass { fill: #dcfce7; stroke: #86efac; }
    .quality-map-pill.fail { fill: #fee2e2; stroke: #fca5a5; }
    .quality-map-pill.warn { fill: #fef3c7; stroke: #facc15; }
    .quality-map-pill-text {
      font-size: 12px;
      font-weight: 850;
      dominant-baseline: middle;
      alignment-baseline: middle;
    }
    .quality-map-pill-text.scope { fill: #0f766e; }
    .quality-map-pill-text.required { fill: #2563eb; }
    .quality-map-pill-text.attention { fill: #b45309; }
    .quality-map-pill-text.evidence { fill: #dc2626; }
    .quality-map-pill-text.center { fill: #4f46e5; }
    .quality-map-pill-text.pass { fill: var(--quality-green); }
    .quality-map-pill-text.fail { fill: var(--quality-red); }
    .quality-map-pill-text.warn { fill: var(--quality-amber); }
    .quality-map-label {
      fill: var(--quality-text);
      font-size: 14px;
      font-weight: 780;
    }
    .quality-map-label.center { font-size: 15px; }
    .quality-map-sub {
      fill: var(--quality-muted);
      font-size: 12px;
      font-weight: 750;
    }
    .quality-flow-link {
      fill: none;
      stroke: #cbd5e1;
      stroke-width: 2.2;
      stroke-linecap: round;
      marker-end: url(#quality-flow-arrow);
    }
    .quality-flow-arrow-head { fill: #94a3b8; }
    .quality-flow-step {
      fill: #ffffff;
      stroke-width: 1.6;
      filter: drop-shadow(0 10px 16px rgba(15, 23, 42, 0.07));
    }
    .quality-flow-step.pass { stroke: #86efac; }
    .quality-flow-step.fail { stroke: #fca5a5; fill: #fff7f7; }
    .quality-flow-step.warn { stroke: #facc15; fill: #fffbeb; }
    .quality-flow-index.pass { fill: #10b981; }
    .quality-flow-index.fail { fill: #ef4444; }
    .quality-flow-index.warn { fill: #d97706; }
    .quality-flow-index {
      stroke: #ffffff;
      stroke-width: 2.5;
    }
    .quality-flow-index-text {
      fill: #ffffff;
      font-size: 11px;
      font-weight: 900;
    }
    .quality-flow-status {
      fill: var(--quality-text);
      font-size: 13px;
      font-weight: 850;
    }
    .quality-flow-note-link {
      fill: none;
      stroke-width: 1.8;
      stroke-dasharray: 4 5;
      stroke-linecap: round;
    }
    .quality-flow-note-link.fail { stroke: #f87171; }
    .quality-flow-note-link.warn { stroke: #f59e0b; }
    .quality-flow-note {
      stroke-width: 1.5;
      filter: drop-shadow(0 10px 16px rgba(15, 23, 42, 0.06));
    }
    .quality-flow-note.fail { fill: #fff1f2; stroke: #fca5a5; }
    .quality-flow-note.warn { fill: #fffbeb; stroke: #facc15; }
    .quality-flow-note-text {
      fill: var(--quality-text);
      font-size: 12px;
      font-weight: 800;
    }
    .quality-panel-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      margin-top: 18px;
    }
    .quality-panel {
      min-height: 280px;
      padding: 18px;
    }
    .quality-panel h2 { font-size: 20px; }
    .quality-panel-head p {
      margin: 5px 0 0;
      color: var(--quality-muted);
      font-size: 14px;
      line-height: 1.55;
    }
    .quality-chip-row {
      margin-top: 16px;
      padding: 12px;
      border: 1px solid var(--quality-line);
      border-radius: 8px;
      background: var(--quality-soft);
    }
    .quality-list {
      margin: 16px 0 0;
      padding-left: 18px;
      color: var(--quality-text);
      font-size: 15px;
      line-height: 1.72;
      overflow-wrap: anywhere;
    }
    .quality-list li + li { margin-top: 9px; }
    .quality-list strong {
      font-weight: 850;
      color: var(--quality-text);
    }
    .quality-list span { color: var(--quality-text); }
    .quality-list .empty { color: var(--quality-muted); }
    .quality-status {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 5px 9px;
      border-radius: 999px;
      border: 1px solid var(--quality-line);
      font-size: 12px;
      font-weight: 850;
    }
    .quality-status.pass { border-color: #bbf7d0; background: #ecfdf3; color: var(--quality-green); }
    .quality-status.fail { border-color: #fecaca; background: #fff1f2; color: var(--quality-red); }
    .quality-status.warn { border-color: #fde68a; background: #fffbeb; color: var(--quality-amber); }
    .quality-status.note { border-color: #bfdbfe; background: #eff6ff; color: var(--quality-blue); }
    .quality-details-section,
    .quality-appendix {
      margin-top: 16px;
      overflow: hidden;
    }
    .quality-details-section > summary,
    .quality-appendix > summary {
      cursor: pointer;
      list-style: none;
      padding: 16px 18px;
      color: var(--quality-text);
      font-weight: 850;
    }
    .quality-details-section > summary::-webkit-details-marker,
    .quality-appendix > summary::-webkit-details-marker { display: none; }
    .quality-details-section > summary::after,
    .quality-appendix > summary::after {
      content: "展开";
      float: right;
      color: var(--quality-muted);
      font-size: 12px;
      font-weight: 750;
    }
    .quality-details-section[open] > summary::after,
    .quality-appendix[open] > summary::after { content: "收起"; }
    .quality-details-body {
      border-top: 1px solid var(--quality-line);
      padding: 0 16px 16px;
    }
    .quality-detail-section {
      margin-top: 16px;
      border: 1px solid var(--quality-line);
      border-radius: 8px;
      background: var(--quality-panel);
      overflow: hidden;
    }
    .quality-detail-section h2 {
      padding: 14px 16px 0;
      font-size: 18px;
    }
    .quality-detail-section p {
      margin: 6px 0 0;
      padding: 0 16px 14px;
      color: var(--quality-muted);
      font-size: 13px;
      line-height: 1.55;
    }
    .quality-table {
      width: 100%;
      border-collapse: collapse;
    }
    .quality-table th,
    .quality-table td {
      padding: 13px 16px;
      border-top: 1px solid var(--quality-line);
      text-align: left;
      vertical-align: top;
      font-size: 13px;
    }
    .quality-table th {
      color: var(--quality-muted);
      background: var(--quality-soft);
      font-weight: 750;
    }
    .quality-table td strong,
    .quality-table td span {
      display: block;
    }
    .quality-table td span {
      margin-top: 4px;
      color: var(--quality-muted);
    }
    code {
      color: var(--quality-blue);
      font-family: var(--quality-mono);
      font-size: 12px;
      word-break: break-word;
    }
    .quality-json {
      max-height: 520px;
      overflow: auto;
      margin: 0;
      padding: 16px;
      border-top: 1px solid var(--quality-line);
      background: var(--quality-soft);
      color: var(--quality-text);
      font-family: var(--quality-mono);
      font-size: 12px;
      line-height: 1.6;
    }
    .quality-bottom-bar {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 30;
      padding: 12px 22px calc(12px + env(safe-area-inset-bottom));
      border-top: 1px solid var(--quality-line);
      background: rgba(246, 248, 251, 0.94);
      box-shadow: 0 -14px 32px rgba(15, 23, 42, 0.08);
      backdrop-filter: blur(14px);
    }
    .quality-bottom-bar-inner {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      max-width: 1220px;
      margin: 0 auto;
    }
    .quality-bottom-action {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 152px;
      min-height: 48px;
      border: 1px solid transparent;
      border-radius: 12px;
      padding: 0 20px;
      font: inherit;
      font-size: 16px;
      font-weight: 850;
      line-height: 1;
      white-space: nowrap;
      box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06);
      transition: background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
    }
    .quality-bottom-action.revise {
      border-color: #fecaca;
      background: #fff1f2;
      color: #b42318;
    }
    .quality-bottom-action.confirm {
      border-color: #bbf7d0;
      background: #ecfdf3;
      color: #067647;
    }
    .quality-bottom-action:hover,
    .quality-bottom-action:focus-visible {
      box-shadow: 0 10px 22px rgba(15, 23, 42, 0.1);
      transform: translateY(-1px);
      outline: none;
    }
    .quality-bottom-action.revise:hover,
    .quality-bottom-action.revise:focus-visible {
      border-color: #fda4af;
      background: #ffe4e6;
    }
    .quality-bottom-action.confirm:hover,
    .quality-bottom-action.confirm:focus-visible {
      border-color: #86efac;
      background: #dcfce7;
    }
    .quality-bottom-action:active {
      box-shadow: 0 4px 10px rgba(15, 23, 42, 0.08);
      transform: translateY(0);
    }
    @media (max-width: 860px) {
      .quality-topbar { align-items: flex-start; flex-direction: column; }
      .quality-top-meta { justify-content: flex-start; }
      .quality-panel-grid { grid-template-columns: 1fr; }
      .quality-map-canvas svg,
      .quality-flow-canvas svg { min-width: 680px; }
    }
    @media (max-width: 620px) {
      .quality-page { padding: 18px 12px 128px; }
      .quality-overview { padding: 18px; }
      .quality-overview h1 { font-size: 28px; }
      .quality-map { padding: 16px; }
      .quality-panel { padding: 16px; }
      .quality-table { display: block; overflow-x: auto; white-space: nowrap; }
      .quality-bottom-bar { padding-inline: 12px; }
      .quality-bottom-bar-inner {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      .quality-bottom-action {
        justify-content: center;
        min-width: 0;
        padding-inline: 10px;
        font-size: 15px;
      }
    }
  `;
}

function qualityScript() {
  return `
    async function copyQualityText(text, button) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          document.execCommand('copy');
          textarea.remove();
        }
        const old = button.textContent;
        button.textContent = '已复制';
        setTimeout(() => { button.textContent = old; }, 1200);
      } catch (error) {
        button.textContent = '请手动复制';
      }
    }
    document.querySelectorAll('[data-copy-value]').forEach((button) => {
      button.addEventListener('click', () => copyQualityText(button.dataset.copyValue || '', button));
    });
  `;
}

export function renderQualityEvalArtifact({ report }) {
  const tasks = activeTasks(report);
  const required = requiredGates(report);
  const requiredDone = passedRequired(required);
  const failingRequired = required.filter((gate) => !['pass', 'waived'].includes(gate.status));
  const advisory = (report.gates ?? []).filter((gate) => !gate.required && gate.status !== 'pass');
  const labels = policyLabels(report);
  const productionReady = report.readiness?.productionReady === true;
  const decisionLabel = productionReady ? '整体通过' : '先处理问题';
  const decisionDetail = decisionText(report, required, requiredDone, failingRequired, tasks);
  const rawJson = JSON.stringify(report, null, 2);

  const panels = [
    panel({
      kind: 'check',
      title: '本期必测结果',
      description: '先看必须覆盖的测试是否通过，没通过就不要继续',
      chips: required.map((gate) => chip(gateSummary(gate), toneForGate(gate))),
      items: requiredItems(required),
      emptyText: '当前没有被判定为本期必测的测试块。',
    }),
    panel({
      kind: 'alert',
      title: '需要处理 / 需确认',
      description: '只把不通过或需要业务取舍的内容放在这里',
      chips: (report.gates ?? [])
        .filter((gate) => gate.status !== 'pass' && gate.status !== 'waived')
        .map((gate) => chip(gateSummary(gate), toneForGate(gate))),
      items: exceptionItems(report),
      emptyText: '没有未通过或需确认项，可以重点确认报告是否对应本次需求。',
    }),
    panel({
      kind: 'evidence',
      title: '验证材料',
      description: '确认结论不是只看通过标记，而是能追到本次证据',
      chips: [
        chip(`${evidenceCount(report)} 条验证材料`, evidenceCount(report) > 0 ? 'pass' : 'warn'),
        chip(`扫描 ${report.summary.filesScanned} 个文件`, 'neutral'),
        chip(reportScopeText(tasks), 'note'),
      ],
      items: evidenceItems(report),
      emptyText: '还没有找到本次执行证据。',
    }),
    panel({
      kind: 'environment',
      title: '执行环境与覆盖',
      description: '区分项目具备测试能力，和这次是否真的留下证据',
      chips: [
        chip(report.evalHarness.smoke.present ? '主流程验证可用' : '缺主流程验证', report.evalHarness.smoke.present ? 'pass' : 'warn'),
        chip(report.observability.correlationFields.length > 0 ? '问题可追踪' : '追踪线索不足', report.observability.correlationFields.length > 0 ? 'pass' : 'warn'),
        chip(report.businessGuardrails.missingEvidence.length > 0 ? '成本护栏待补' : '成本护栏完整', report.businessGuardrails.missingEvidence.length > 0 ? 'warn' : 'pass'),
      ],
      items: environmentItems(report),
      emptyText: '还没有检测到执行环境信息。',
    }),
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>回归测试报告 ${escapeHtml(report.id)}</title>
    <style>${styles()}</style>
  </head>
  <body>
    <main class="quality-page">
      <header class="quality-topbar">
        <div class="quality-brand">OpenPrd / 回归测试报告</div>
        <div class="quality-top-meta">
          ${chip(report.generatedAt, 'neutral')}
          ${chip(report.id, 'note')}
        </div>
      </header>

      <section class="quality-overview" aria-labelledby="qualityOverviewTitle">
        <p class="quality-kicker">回归结论概览</p>
        <h1 id="qualityOverviewTitle">${escapeHtml(decisionLabel)}</h1>
        <p class="quality-subtitle">${escapeHtml(decisionDetail)}</p>
        <div class="quality-summary-row">
          ${chip(`本期必测 ${requiredDone}/${required.length}`, failingRequired.length === 0 ? 'pass' : 'fail')}
          ${chip(`需要处理 ${failingRequired.length}`, failingRequired.length === 0 ? 'pass' : 'fail')}
          ${chip(`需确认 ${advisory.length}`, advisory.length === 0 ? 'pass' : 'warn')}
          ${chip(`验证材料 ${evidenceCount(report)} 条`, evidenceCount(report) > 0 ? 'pass' : 'warn')}
          ${chip(reportScopeText(tasks), 'note')}
        </div>
      </section>

      ${coverageMap({ report, tasks, required, requiredPassed: requiredDone, failingRequired, advisory })}

      <section class="quality-panel-grid" aria-label="回归测试固定模块">
        ${panels}
      </section>

      <details class="quality-details-section">
        <summary>更多细节</summary>
        <div class="quality-details-body">
          <section class="quality-detail-section">
            <h2>本次范围</h2>
            <p>场景、必测项和按风险确认项。</p>
            <div class="quality-chip-row">
              ${chipRow(labels.scenarioLabels.map((item) => chip(item, 'note')))}
              ${chipRow(labels.requiredLabels.map((item) => chip(`本期必测：${item}`, 'fail')))}
              ${chipRow(labels.optionalLabels.map((item) => chip(`按风险确认：${item}`, 'note')))}
            </div>
          </section>

          <section class="quality-detail-section">
            <h2>需求模块</h2>
            <p>只看交付范围是否逐项验收。</p>
            <table class="quality-table">
              <thead>
                <tr>
                  <th>需求模块</th>
                  <th>结果</th>
                  <th>结论</th>
                </tr>
              </thead>
              <tbody>${tableRowsForTasks(tasks, report)}</tbody>
            </table>
          </section>

          <section class="quality-detail-section">
            <h2>测试块回归明细</h2>
            <p>按本期需求相关的测试块展示证据和处理方式。</p>
            <table class="quality-table">
              <thead>
                <tr>
                  <th>测试块</th>
                  <th>本期要求</th>
                  <th>状态</th>
                  <th>本次证据</th>
                  <th>处理方式</th>
                </tr>
              </thead>
              <tbody>${tableRowsForGates(report)}</tbody>
            </table>
          </section>

          <section class="quality-detail-section">
            <h2>证据链</h2>
            <p>把每个测试块映射到本次报告使用的证据源，方便复核。</p>
            <table class="quality-table">
              <thead>
                <tr>
                  <th>测试块</th>
                  <th>来源</th>
                  <th>路径或信号</th>
                  <th>本期要求</th>
                </tr>
              </thead>
              <tbody>${tableRowsForEvidence(report)}</tbody>
            </table>
          </section>
        </div>
      </details>

      ${frameworkSection(report)}

      <details class="quality-appendix">
        <summary>附录：结构化 JSON、基线和扫描细节</summary>
        <pre class="quality-json">${escapeHtml(rawJson)}</pre>
      </details>

      ${bottomBar(report)}
    </main>
    <script>${qualityScript()}</script>
  </body>
</html>`;
}
