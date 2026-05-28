import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPrdSnapshot, formatVersionId } from './prd-core.js';
import { compactTimestamp, timestamp } from './time.js';
import { loadLatestVersionSnapshot, loadWorkspace, readVersionIndex, resolveActiveTemplatePack, resolveCurrentProductType } from './workspace-core.js';
import { appendText, exists, readJson, readText, readYaml, writeJson, writeText, writeYaml } from './fs-utils.js';
import { learningPackagePaths, openArtifactInBrowser, renderLearningArtifact, writeHtmlArtifact } from './html-artifacts.js';

const LEARNING_REVIEW_SCHEMA_VERSION = 1;
const LEARNING_AGENT_CONTEXT_SCHEMA = 'openprd.learning-agent-context.v1';
const DEFAULT_LEARNING_REVIEW_SETTINGS = {
  enabled: true,
  autoOpen: true,
  defaultGenre: 'internet-product',
  sourceScope: 'workspace',
};

const GENRE_LIBRARY = {
  'internet-product': {
    id: 'internet-product',
    label: '互联网产品',
    voice: '先讲用户价值、设计意图与关键取舍，再落到结构、证据和可迁移原则；避免写成技术说明书或文件导览。',
    chapterLabels: ['问题与价值', '关键设计', '取舍与原理', '迁移示例', '边界与下一步'],
    opening: '把这一轮复盘当成一堂产品与架构课：先看要解决什么，再看为什么这样设计，最后带走可迁移的判断方法。',
    closing: '真正值得带走的不是文件名，而是以后再遇到类似问题时还能复用的判断框架。',
  },
  scientific: {
    id: 'scientific',
    label: '严肃科研',
    voice: '严谨、可验证、重证据、重边界。',
    chapterLabels: ['研究问题', '方法框架', '证据链', '复现实验', '结论回收'],
    opening: '这份复盘更像一篇研究记录：先定义问题，再说明方法，然后把证据链摆平。',
    closing: '每个结论都要回到来源，任何推断都要留下注记。',
  },
  'fairy-tale': {
    id: 'fairy-tale',
    label: '童话故事',
    voice: '温暖、清楚、带一点故事感，但不丢事实。',
    chapterLabels: ['故事开头', '旅程地图', '线索与证据', '角色示例', '回家路上'],
    opening: '这本书像一则故事：先认识角色，再找到线索，最后带着礼物回到现实。',
    closing: '故事讲完以后，真正带走的是可以再次使用的线索和方法。',
  },
  'web-novel': {
    id: 'web-novel',
    label: '网文小说',
    voice: '节奏更强、推进更快、强调冲突和转折。',
    chapterLabels: ['开卷入局', '结构铺陈', '证据反转', '范例拆招', '收束留白'],
    opening: '这一轮复盘像一章网文：先入局，再铺陈，最后把关键证据翻出来。',
    closing: '结尾不求拖长，只求把下一次推进的线索留稳。',
  },
  xianxia: {
    id: 'xianxia',
    label: '仙侠修真',
    voice: '带一点修炼感，但仍然要稳住事实和证据。',
    chapterLabels: ['筑基', '观想', '破境', '传功', '归元'],
    opening: '这次学习更像一次筑基：把地基、经脉和边界先稳住，后面才好破境。',
    closing: '真正的进阶不是词藻，而是可以反复使用的证据和方法。',
  },
};

const GENRE_ALIASES = new Map([
  ['产品', 'internet-product'],
  ['互联网', 'internet-product'],
  ['互联网产品', 'internet-product'],
  ['代码', 'internet-product'],
  ['code', 'internet-product'],
  ['project', 'internet-product'],
  ['学术', 'scientific'],
  ['科研', 'scientific'],
  ['严肃科研', 'scientific'],
  ['scientific', 'scientific'],
  ['童话', 'fairy-tale'],
  ['fairy', 'fairy-tale'],
  ['fairy-tale', 'fairy-tale'],
  ['网文', 'web-novel'],
  ['小说', 'web-novel'],
  ['web-novel', 'web-novel'],
  ['仙侠', 'xianxia'],
  ['修真', 'xianxia'],
  ['xianxia', 'xianxia'],
]);

const STYLE_PROMPT_PACKS = {
  'internet-product': {
    defaultStyle: 'teaching-brief',
    styles: {
      'teaching-brief': {
        id: 'teaching-brief',
        label: '教学型拆解',
        concept: '把一次复盘写成能教会读者做产品与架构判断的短书：先讲问题和价值，再讲关键设计、取舍、原理、迁移方式与适用边界；必要时补一眼看懂的比喻卡和图文解释。',
        titlePatterns: [
          '《{topic}》设计判断课',
          '《{topic}》产品与架构学习手记',
          '《{topic}》原理拆解',
        ],
        outlineArc: ['问题与价值', '关键设计', '取舍与原理', '迁移示例', '边界与下一步'],
        imageryBank: ['判断框架', '设计杠杆', '权衡面', '迁移路径', '适用边界'],
        sentenceRhythm: '先用一句话说明这章要教会读者什么，再解释设计动机、关键取舍和可迁移原则。',
        taboo: [
          '不要把章节写成文件导览、模块清单、技术点罗列或实现流水账。',
          '不要只说用了什么技术，而不解释为什么这样设计、解决了什么问题。',
          '不要把 evidenceIds 当正文主角；证据应该支撑判断，而不是淹没判断。',
        ],
        systemPrompt: [
          '你是 OpenPrd 复盘学习包的教学型写作 Agent。',
          '你的目标是帮助读者学会产品设计思路、架构思路、关键原理和判断方法，而不是罗列技术点或文件清单。',
          '正文优先回答五件事：解决什么问题、为什么这样设计、这样设计换来了什么、付出了什么、何时适用或不适用。',
          '如果目标读者偏产品、运营或非技术读者，优先补充“一眼看懂”的 visualExplainer，用具体场景和生活化比喻降低理解门槛。',
          '只有当技术细节能够支撑设计动机、关键取舍、失败模式或验证结论时，才引入对应技术点。',
          '事实层必须来自证据清单；表达层可以更像教学型短书，但不能虚构。'
        ].join('\n'),
        titlePrompt: [
          '输入: topic、genre、substyle、agent-context、evidence summary。',
          '输出: 一个像“学习手记/判断课/原理拆解”的标题和一个能概括价值的副标题。',
          '要求: 标题保留 topic 核心名词；副标题要体现“为什么这件事值得学”，而不是重复文件路径或工具名。'
        ].join('\n'),
        outlinePrompt: [
          '输入: 章节目标、证据类别、读者学习路径。',
          '输出: 最多三层目录。',
          '优先把目录组织成“问题与价值 / 关键设计 / 取舍与原理 / 迁移示例 / 边界与下一步”这类教学路径。',
          '不要把目录写成按文件、模块、命令、日志顺序平铺的技术说明书。'
        ].join('\n'),
        chapterPrompt: [
          '输入: agent-context、source excerpts、claims、gaps、related task metadata。',
          '输出: 自行设计章节标题、摘要、正文、retrievalBlocks、workedExamples，以及在合适时补充 visualExplainer。',
          '要求: 每章都要先说明这一章教会读者什么，再解释设计动机、关键取舍、验证方式和可迁移原则。',
          '如果本章适合给产品或非技术读者阅读，visualExplainer 应补充一个具体场景、一个生活化比喻，以及 2-4 条看图重点。',
          '如果引用技术细节，必须顺带说明它背后的设计原因、代价或适用边界。'
        ].join('\n'),
        proseRewritePrompt: [
          '把材料改写成“理解问题 -> 理解设计 -> 理解取舍 -> 学会迁移”的阅读路径。',
          '优先使用“为什么这样设计 / 这种设计换来了什么 / 代价是什么 / 以后什么时候复用”这类句式。',
          '在不牺牲事实的前提下，可以把抽象机制翻成贴近日常决策的场景化比喻，帮助产品或非技术读者先形成直觉。',
          '不要按文件名、模块名、技术名词逐项介绍，除非这些内容正好支撑一个设计判断。',
          '每段至少保留一个明确事实锚点，但不要让事实锚点取代读者该学会的原则。'
        ].join('\n'),
        evidenceBindingPrompt: [
          '每个关键判断必须保留 evidenceIds。',
          '证据用于支撑“为什么这样设计”和“这个判断从哪里来”，不是为了堆砌路径或技术名词。',
          '如果句子是综合推断，要明确写成“综合这些证据可以推断……”，避免伪装成直接事实。'
        ].join('\n'),
        qualityReviewPrompt: [
          '检查 1: 读者读完后，带走的是判断框架、设计原理和取舍方法，而不是技术点列表。',
          '检查 2: 是否回答了“为什么这样设计、换来了什么、付出了什么、何时适用/不适用”。',
          '检查 3: 是否仍能从每章回到 evidenceIds，而不是凭感觉写结论。',
          '检查 4: 是否避免把内容写成文件导览、实现清单或技术说明书。',
          '检查 5: 如果用了 visualExplainer，它是否真正帮助非技术读者理解，而不是只换一种说法重复正文。'
        ].join('\n'),
      },
    },
  },
  xianxia: {
    defaultStyle: 'cultivation',
    styles: {
      cultivation: {
        id: 'cultivation',
        label: '修行札记',
        concept: '把项目学习写成一次可回溯的修行：证据是灵根，结构是经脉，实践是破境。',
        titlePatterns: [
          '《{topic}》修行札记',
          '《{topic}》证道小卷',
          '《{topic}》归藏篇',
        ],
        outlineArc: ['筑基立卷', '观脉识图', '破雾辨源', '传功成谱', '归元再启'],
        imageryBank: ['灵根', '经脉', '法门', '玉简', '破境', '归藏', '心法', '炉火'],
        sentenceRhythm: '长短句交错；每段先给意象，再落回事实、路径或证据。',
        taboo: [
          '不要把证据不存在的内容写成神迹或事实。',
          '不要堆砌玄幻名词盖过学习目标。',
          '不要牺牲路径、文件、命令和验证结果的可追溯性。',
        ],
        systemPrompt: [
          '你是 OpenPrd 复盘学习书的风格迁移 Agent。',
          '你的任务不是虚构故事，而是根据 agent-context 和 evidence-manifest 写出仙侠修行札记。',
          '事实层必须完全来自证据清单；风格层只能改变表达、结构节奏和意象。',
        ].join('\n'),
        titlePrompt: [
          '输入: topic、genre、substyle、agent-context、evidence summary。',
          '输出: 一个像书名的标题和一个短副题。',
          '要求: 标题可带“札记/小卷/归藏/心法”等书籍意象，但必须保留 topic 的核心名词。',
        ].join('\n'),
        outlinePrompt: [
          '输入: 章节目标、证据类别、读者学习路径。',
          '输出: 最多三层目录。',
          '第 1 层是卷/章，第 2 层是本章心法、检索练习、工作示例、证据锚点。',
          '不要把 R1/R2 这类具体检索题放进目录；练习题只留在正文内。',
        ].join('\n'),
        chapterPrompt: [
          '输入: agent-context、source excerpts、claims、gaps、related task metadata。',
          '输出: 自行设计章节标题、摘要、正文、retrievalBlocks 和 workedExamples。',
          '要求: 每章先用修行意象开场，再把意象落回文件、状态、验证或任务路径。',
        ].join('\n'),
        proseRewritePrompt: [
          '围绕“做了什么/为什么/如何验证”写成“立基/观脉/破境/传功/归元”的阅读路径。',
          '每段至少保留一个明确事实锚点，例如 `.openprd/`、docs/basic、loop finish、reader.html、证据清单。',
          '不要改写文件名、命令名、schema、packageId 和 source id。',
        ].join('\n'),
        evidenceBindingPrompt: [
          '每个关键判断必须保留 evidenceIds。',
          '如果句子是综合推断，使用“由这些证据合参可知”一类表达，而不是绝对断言。',
          '风格词只能包装证据，不能替代证据。',
        ].join('\n'),
        qualityReviewPrompt: [
          '检查 1: 标题、大纲、章节是否像修行札记，而不是普通项目报告。',
          '检查 2: 是否仍能从每章回到 evidenceIds。',
          '检查 3: 是否有玄幻词盖过事实、命令、路径、验证结果。',
          '检查 4: 目录是否可读，最多三层，适合展开/收起。',
        ].join('\n'),
      },
    },
  },
};

function slugify(value, fallback = 'learning-review') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 96);
  return slug || fallback;
}

function hashText(value) {
  return crypto.createHash('sha1').update(String(value ?? '')).digest('hex');
}

function stripText(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .trim();
}

function excerptText(value, limit = 320) {
  const text = stripText(value);
  if (!text) return '';
  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const sample = paragraphs.slice(0, 2).join('\n\n') || text;
  return sample.length <= limit ? sample : `${sample.slice(0, limit).trimEnd()}…`;
}

function normalizeGenreId(value, fallback = DEFAULT_LEARNING_REVIEW_SETTINGS.defaultGenre) {
  if (!value) return fallback;
  const normalized = String(value).trim();
  if (!normalized) return fallback;
  const lower = normalized.toLowerCase();
  if (GENRE_LIBRARY[lower]) return lower;
  if (GENRE_ALIASES.has(normalized)) return GENRE_ALIASES.get(normalized);
  if (GENRE_ALIASES.has(lower)) return GENRE_ALIASES.get(lower);
  return GENRE_LIBRARY[lower] ? lower : fallback;
}

function inferGenreId(topic, snapshot) {
  const haystack = [topic, snapshot?.title, snapshot?.problemStatement, snapshot?.owner]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/仙侠|修真/.test(haystack)) return 'xianxia';
  if (/童话|故事/.test(haystack)) return 'fairy-tale';
  if (/科研|学术|论文|实验/.test(haystack)) return 'scientific';
  if (/小说|网文/.test(haystack)) return 'web-novel';
  return 'internet-product';
}

function inferTopic(snapshot, options = {}) {
  return String(options.topic ?? snapshot?.title ?? snapshot?.problemStatement ?? snapshot?.owner ?? 'OpenPrd 复盘学习').trim();
}

function ensureChapterLabels(genre) {
  return Array.isArray(genre.chapterLabels) && genre.chapterLabels.length >= 5
    ? genre.chapterLabels.slice(0, 5)
    : GENRE_LIBRARY['internet-product'].chapterLabels;
}

function normalizeStyleId(value, fallback) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['修行', '修行札记', 'cultivation'].includes(text)) return 'cultivation';
  if (['宗门', '宗门权谋', 'sect', 'sect-intrigue'].includes(text)) return 'sect-intrigue';
  if (['炼器', 'artifact', 'artifact-refining'].includes(text)) return 'artifact-refining';
  return text;
}

function resolveStylePromptPack(genreId, requestedStyle = null) {
  const family = STYLE_PROMPT_PACKS[genreId];
  if (!family) {
    return {
      genreId,
      styleId: 'default',
      label: '默认风格迁移',
      concept: '保持事实层不变，只做轻量语气迁移。',
      prompts: {
        system: '根据 agent-context 和 evidence-manifest 写作，按 genre voice 调整表达。',
        title: '保留 topic 核心名词，根据证据生成清晰标题。',
        outline: '根据任务事实生成可扫描目录。',
        chapter: '根据证据顺序组织章节，优化阅读节奏。',
        proseRewrite: '改写表达，不改写事实锚点。',
        evidenceBinding: '保留 evidenceIds 和 source paths。',
        qualityReview: '检查事实是否可追溯，风格是否一致。',
      },
    };
  }

  const styleId = normalizeStyleId(requestedStyle, family.defaultStyle);
  const style = family.styles[styleId] ?? family.styles[family.defaultStyle];
  return {
    genreId,
    styleId: style.id,
    label: style.label,
    concept: style.concept,
    titlePatterns: style.titlePatterns,
    outlineArc: style.outlineArc,
    imageryBank: style.imageryBank,
    sentenceRhythm: style.sentenceRhythm,
    taboo: style.taboo,
    prompts: {
      system: style.systemPrompt,
      title: style.titlePrompt,
      outline: style.outlinePrompt,
      chapter: style.chapterPrompt,
      proseRewrite: style.proseRewritePrompt,
      evidenceBinding: style.evidenceBindingPrompt,
      qualityReview: style.qualityReviewPrompt,
    },
  };
}

async function readLearningReviewSettings(ws) {
  const raw = ws.data.config?.learningReview ?? {};
  return {
    ...DEFAULT_LEARNING_REVIEW_SETTINGS,
    ...raw,
    enabled: raw.enabled !== false,
    autoOpen: raw.autoOpen !== false,
    defaultGenre: normalizeGenreId(raw.defaultGenre, DEFAULT_LEARNING_REVIEW_SETTINGS.defaultGenre),
    sourceScope: raw.sourceScope ?? DEFAULT_LEARNING_REVIEW_SETTINGS.sourceScope,
  };
}

async function readCurrentState(ws) {
  return {
    ...(ws.data.currentState ?? {}),
    learningReview: {
      ...((ws.data.currentState ?? {}).learningReview ?? {}),
    },
  };
}

async function persistLearningConfig(ws, learningReview, options = {}) {
  const config = {
    ...(ws.data.config ?? {}),
    learningReview: {
      ...DEFAULT_LEARNING_REVIEW_SETTINGS,
      ...(ws.data.config?.learningReview ?? {}),
      ...learningReview,
    },
  };
  await writeYaml(ws.paths.config, config);

  const currentState = await readCurrentState(ws);
  currentState.learningReview = {
    ...currentState.learningReview,
    enabled: config.learningReview.enabled,
    defaultGenre: config.learningReview.defaultGenre,
    autoOpen: config.learningReview.autoOpen,
    sourceScope: config.learningReview.sourceScope,
    updatedAt: timestamp(),
    lastAction: options.action ?? 'update-config',
  };
  await writeJson(ws.paths.currentState, currentState);

  return {
    ws: {
      ...ws,
      data: {
        ...ws.data,
        config,
        currentState,
      },
    },
    config: config.learningReview,
    currentState,
  };
}

async function findLatestLoopReport(projectRoot) {
  const reportsDir = path.join(projectRoot, '.openprd', 'harness', 'test-reports');
  const entries = await fs.readdir(reportsDir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const abs = path.join(reportsDir, entry.name);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat) continue;
    files.push({ path: abs, mtimeMs: stat.mtimeMs });
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.path ?? null;
}

function resolveProjectFile(projectRoot, value) {
  if (!value) return null;
  const candidate = String(value);
  return path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(projectRoot, candidate);
}

function scopeAllows(scope, groups) {
  if (!scope || scope === 'all') return true;
  const normalized = String(scope).trim().toLowerCase();
  if (normalized === 'workspace') {
    return groups.includes('workspace') || groups.includes('docs');
  }
  if (normalized === 'docs') {
    return groups.includes('docs') || groups.includes('workspace');
  }
  if (normalized === 'loop') {
    return groups.includes('workspace') || groups.includes('docs') || groups.includes('loop');
  }
  return groups.includes(normalized);
}

function makeEvidenceCandidate({ id, title, path: absolutePath, kind, groups, summary, excerptLength = 320, note }) {
  return {
    id,
    title,
    path: absolutePath,
    kind,
    groups,
    summary,
    excerptLength,
    note,
  };
}

async function summarizeEvidenceCandidate(candidate) {
  if (!(await exists(candidate.path))) {
    return null;
  }

  if (candidate.kind === 'json') {
    const value = await readJson(candidate.path).catch(() => null);
    const raw = JSON.stringify(value, null, 2);
    return {
      id: candidate.id,
      title: candidate.title,
      type: candidate.kind,
      groups: candidate.groups,
      path: candidate.path,
      relativePath: null,
      summary: typeof candidate.summary === 'function' ? candidate.summary(value) : (candidate.summary ?? ''),
      excerpt: excerptText(raw, candidate.excerptLength),
      digest: hashText(raw),
      note: candidate.note ?? null,
      data: value,
    };
  }

  const text = await readText(candidate.path);
  return {
    id: candidate.id,
    title: candidate.title,
    type: candidate.kind,
    groups: candidate.groups,
    path: candidate.path,
    relativePath: null,
    summary: typeof candidate.summary === 'function' ? candidate.summary(text) : (candidate.summary ?? ''),
    excerpt: excerptText(text, candidate.excerptLength),
    digest: hashText(text),
    note: candidate.note ?? null,
    data: text,
  };
}

async function buildEvidenceManifest(ws, snapshot, options = {}) {
  const scope = options.sourceScope ?? DEFAULT_LEARNING_REVIEW_SETTINGS.sourceScope;
  const related = options.related ?? {};
  const changeId = related.changeId ?? options.changeId ?? null;
  const testReportPath = resolveProjectFile(ws.projectRoot, related.testReport ?? options.testReport);
  const latestVersion = await loadLatestVersionSnapshot(ws);
  const latestLoopReport = await findLatestLoopReport(ws.projectRoot);
  const docsRoot = path.join(ws.projectRoot, 'docs', 'basic');
  const candidateDefs = [
    makeEvidenceCandidate({
      id: 'current-state',
      title: '当前状态',
      path: ws.paths.currentState,
      kind: 'json',
      groups: ['workspace', 'loop'],
      summary: (value) => `状态: ${value?.status ?? 'unknown'} · PRD 版本: ${value?.prdVersion ?? 0}`,
    }),
    makeEvidenceCandidate({
      id: 'task-graph',
      title: '任务图',
      path: ws.paths.taskGraph,
      kind: 'json',
      groups: ['workspace', 'loop'],
      summary: (value) => `下一个就绪节点: ${value?.nextReadyNode ?? 'unknown'} · 节点数: ${Array.isArray(value?.nodes) ? value.nodes.length : 0}`,
    }),
    makeEvidenceCandidate({
      id: 'version-index',
      title: '版本索引',
      path: ws.paths.versionIndex,
      kind: 'json',
      groups: ['workspace', 'docs'],
      summary: (value) => `版本数: ${Array.isArray(value) ? value.length : 0}`,
      excerptLength: 220,
    }),
    makeEvidenceCandidate({
      id: 'active-prd',
      title: '当前 PRD',
      path: ws.paths.activePrd,
      kind: 'text',
      groups: ['workspace', 'docs'],
      summary: () => '当前工作区的主 PRD 文档。',
    }),
    makeEvidenceCandidate({
      id: 'active-flows',
      title: '流程文档',
      path: ws.paths.activeFlows,
      kind: 'text',
      groups: ['workspace', 'docs'],
      summary: () => '主流程与边界流程的工作区文档。',
    }),
    makeEvidenceCandidate({
      id: 'active-roles',
      title: '角色文档',
      path: ws.paths.activeRoles,
      kind: 'text',
      groups: ['workspace', 'docs'],
      summary: () => '角色和类型专项信息的工作区文档。',
    }),
    makeEvidenceCandidate({
      id: 'active-handoff',
      title: '交接文档',
      path: ws.paths.activeHandoff,
      kind: 'text',
      groups: ['workspace', 'docs'],
      summary: () => '交接目标、下一步与版本信息。',
    }),
    makeEvidenceCandidate({
      id: 'decision-log',
      title: '决策记录',
      path: ws.paths.decisionLog,
      kind: 'text',
      groups: ['workspace', 'docs'],
      summary: () => '围绕协同过程积累的决策记录。',
    }),
    makeEvidenceCandidate({
      id: 'open-questions',
      title: '开放问题',
      path: ws.paths.openQuestionsLog,
      kind: 'text',
      groups: ['workspace', 'docs'],
      summary: () => '仍需要确认或继续推进的问题。',
    }),
    makeEvidenceCandidate({
      id: 'progress',
      title: '进度记录',
      path: ws.paths.progressLog,
      kind: 'text',
      groups: ['workspace', 'docs'],
      summary: () => '工作区的过程进展与阶段性总结。',
    }),
    makeEvidenceCandidate({
      id: 'verification',
      title: '验证记录',
      path: ws.paths.verificationLog,
      kind: 'text',
      groups: ['workspace', 'loop'],
      summary: () => '验证命令、验证结果和回归结论。',
    }),
    makeEvidenceCandidate({
      id: 'docs-basic-file-structure',
      title: 'docs/basic/file-structure.md',
      path: path.join(docsRoot, 'file-structure.md'),
      kind: 'text',
      groups: ['docs'],
      summary: () => '文件结构和目录边界的基础文档。',
    }),
    makeEvidenceCandidate({
      id: 'docs-basic-app-flow',
      title: 'docs/basic/app-flow.md',
      path: path.join(docsRoot, 'app-flow.md'),
      kind: 'text',
      groups: ['docs'],
      summary: () => '产品流程和状态流的基础文档。',
    }),
    makeEvidenceCandidate({
      id: 'docs-basic-backend-structure',
      title: 'docs/basic/backend-structure.md',
      path: path.join(docsRoot, 'backend-structure.md'),
      kind: 'text',
      groups: ['docs'],
      summary: () => '后端模块和数据流的基础文档。',
    }),
    makeEvidenceCandidate({
      id: 'docs-basic-frontend-guidelines',
      title: 'docs/basic/frontend-guidelines.md',
      path: path.join(docsRoot, 'frontend-guidelines.md'),
      kind: 'text',
      groups: ['docs'],
      summary: () => '前端阅读器和交互规范的基础文档。',
    }),
    makeEvidenceCandidate({
      id: 'docs-basic-prd',
      title: 'docs/basic/prd.md',
      path: path.join(docsRoot, 'prd.md'),
      kind: 'text',
      groups: ['docs'],
      summary: () => '产品需求和验收标准的基础文档。',
    }),
    makeEvidenceCandidate({
      id: 'docs-basic-tech-stack',
      title: 'docs/basic/tech-stack.md',
      path: path.join(docsRoot, 'tech-stack.md'),
      kind: 'text',
      groups: ['docs'],
      summary: () => '运行环境和依赖工具链的基础文档。',
    }),
  ];

  if (changeId) {
    const changeRoot = path.join(ws.projectRoot, 'openprd', 'changes', changeId);
    candidateDefs.push(
      makeEvidenceCandidate({
        id: 'change-proposal',
        title: `Change ${changeId} proposal`,
        path: path.join(changeRoot, 'proposal.md'),
        kind: 'text',
        groups: ['loop', 'change'],
        summary: () => `变更 ${changeId} 的目标、范围和背景。`,
        excerptLength: 520,
      }),
      makeEvidenceCandidate({
        id: 'change-tasks',
        title: `Change ${changeId} tasks`,
        path: path.join(changeRoot, 'tasks.md'),
        kind: 'text',
        groups: ['loop', 'change'],
        summary: () => `变更 ${changeId} 的任务拆分与完成状态。`,
        excerptLength: 640,
      }),
      makeEvidenceCandidate({
        id: 'change-task-events',
        title: `Change ${changeId} task events`,
        path: path.join(changeRoot, 'task-events.jsonl'),
        kind: 'text',
        groups: ['loop', 'change'],
        summary: () => `变更 ${changeId} 的任务推进事件。`,
        excerptLength: 520,
      }),
    );
  }

  candidateDefs.push(
    makeEvidenceCandidate({
      id: 'loop-feature-list',
      title: 'Loop feature list',
      path: path.join(ws.projectRoot, '.openprd', 'harness', 'feature-list.json'),
      kind: 'json',
      groups: ['loop'],
      summary: (value) => `任务总数: ${Array.isArray(value?.tasks) ? value.tasks.length : 0} · 当前 change: ${value?.changeId ?? 'unknown'}`,
      excerptLength: 520,
    }),
    makeEvidenceCandidate({
      id: 'loop-state',
      title: 'Loop state',
      path: path.join(ws.projectRoot, '.openprd', 'harness', 'loop-state.json'),
      kind: 'json',
      groups: ['loop'],
      summary: (value) => `Loop 状态: ${value?.status ?? value?.phase ?? 'unknown'}`,
      excerptLength: 420,
    }),
  );

  if (latestVersion?.snapshot) {
    candidateDefs.push(makeEvidenceCandidate({
      id: `version-${latestVersion.snapshot.versionId}`,
      title: `版本快照 ${latestVersion.snapshot.versionId}`,
      path: path.join(ws.paths.versionsDir, `${latestVersion.snapshot.versionId}.md`),
      kind: 'text',
      groups: ['workspace', 'docs'],
      summary: () => `最新已合成版本的 Markdown 快照。`,
      excerptLength: 280,
    }));
  }

  if (testReportPath) {
    candidateDefs.push(makeEvidenceCandidate({
      id: 'task-test-report',
      title: '当前任务回归报告',
      path: testReportPath,
      kind: 'text',
      groups: ['loop'],
      summary: () => '本次触发 learning review 的任务回归报告。',
      excerptLength: 720,
    }));
  }

  if (latestLoopReport) {
    candidateDefs.push(makeEvidenceCandidate({
      id: 'latest-loop-report',
      title: '最新回归报告',
      path: latestLoopReport,
      kind: 'text',
      groups: ['loop'],
      summary: () => '最近一次 loop finish 产出的回归测试报告。',
      excerptLength: 280,
    }));
  }

  const sources = [];
  for (const candidate of candidateDefs) {
    if (!scopeAllows(scope, candidate.groups)) continue;
    const source = await summarizeEvidenceCandidate(candidate);
    if (!source) continue;
    source.relativePath = path.relative(ws.workspaceRoot, source.path).split(path.sep).join('/');
    sources.push(source);
  }

  const claims = [];
  const pushClaim = (statement, sourceIds, confidence, kind = 'fact') => {
    claims.push({
      id: `claim-${claims.length + 1}`,
      statement,
      sourceIds,
      confidence,
      kind,
    });
  };

  const sourceIds = sources.map((source) => source.id);
  for (const source of sources) {
    if (!source.summary) continue;
    pushClaim(
      `${source.title}: ${source.summary}`,
      [source.id],
      source.type === 'json' ? 0.94 : 0.88,
      'source-summary',
    );
  }

  const gaps = [];
  if (!sourceIds.includes('latest-loop-report') && !sourceIds.includes('task-test-report') && scope === 'loop') {
    gaps.push({
      id: 'missing-loop-report',
      description: '当前 sourceScope=loop，但未找到可复用的 `.openprd/harness/test-reports/*.md` 回归报告。',
      severity: 'medium',
    });
  }
  if (!sourceIds.some((id) => id.startsWith('docs-basic-'))) {
    gaps.push({
      id: 'missing-docs-basic',
      description: '本次学习包没有引用 docs/basic 基线文档，内容会更偏工作区状态而少一点规范参照。',
      severity: 'low',
    });
  }

  return {
    version: LEARNING_REVIEW_SCHEMA_VERSION,
    generatedAt: timestamp(),
    sourceScope: scope,
    sourceCount: sources.length,
    claimCount: claims.length,
    sources,
    claims,
    gaps,
  };
}

function genreVoiceLine(genre) {
  return genre.voice || GENRE_LIBRARY['internet-product'].voice;
}

function buildStylePromptEngineering(stylePromptPack) {
  return {
    version: 1,
    mode: 'agent-in-the-loop-style-transfer',
    promptPackId: `${stylePromptPack.genreId}.${stylePromptPack.styleId}`,
    label: stylePromptPack.label,
    concept: stylePromptPack.concept,
    titlePatterns: stylePromptPack.titlePatterns ?? [],
    outlineArc: stylePromptPack.outlineArc ?? [],
    imageryBank: stylePromptPack.imageryBank ?? [],
    sentenceRhythm: stylePromptPack.sentenceRhythm ?? null,
    taboo: stylePromptPack.taboo ?? [],
    prompts: stylePromptPack.prompts,
    loop: [
      'Agent 先读取 agent-context 和 evidence-manifest。',
      'Agent 使用 title/outline/chapter/proseRewrite prompts 自行写出标题、大纲、正文和需要的 visualExplainer。',
      'Agent 使用 evidenceBinding prompt 保留 evidenceIds、路径和不可改写字段。',
      'Agent 使用 qualityReview prompt 做风格一致性与事实不漂移检查。',
      '通过后把内容写入 learning-content.json，再渲染 reader.html。',
    ],
  };
}

function buildStyleTransferReport(stylePromptPack, chapters) {
  const promptPackId = stylePromptPack.id ?? `${stylePromptPack.genreId}.${stylePromptPack.styleId}`;
  return {
    promptPackId,
    appliedAt: timestamp(),
    agentLoopRequired: true,
    transformedSurfaces: [
      'title',
      'subtitle',
      'outline',
      'chapter semanticTitle',
      'chapter summary',
      'chapter paragraphs',
      'chapter visualExplainer',
      'reader chrome',
    ],
    preservedSurfaces: [
      'packageId',
      'schema',
      'sourceScope',
      'evidenceIds',
      'package paths',
      'source digests',
    ],
    qualityChecks: [
      '风格迁移后仍保留每章 evidenceIds。',
      '目录最多三层，适合展开和收起。',
      '正文保留 `.openprd/`、docs/basic、loop、reader.html 或证据清单等事实锚点。',
      'visualExplainer 只能帮助理解，不能替代证据链或虚构不存在的截图/场景。',
      '右侧证据面板不再参与阅读主界面，证据改为归档和章节内轻量锚点。',
    ],
    chapterCount: chapters.length,
  };
}

function packagePathPayload(packagePaths) {
  return {
    readerHtml: packagePaths.readerHtml,
    assetsDir: packagePaths.assetsDir,
    packageJson: packagePaths.packageJson,
    contentJson: packagePaths.contentJson,
    contentMarkdown: packagePaths.contentMarkdown,
    evidenceManifest: packagePaths.evidenceManifest,
    agentContext: packagePaths.agentContext,
    agentPrompt: packagePaths.agentPrompt,
  };
}

function snapshotPayload(snapshot) {
  return {
    versionId: snapshot?.versionId ?? null,
    versionNumber: snapshot?.versionNumber ?? null,
    productType: snapshot?.productType ?? null,
    templatePack: snapshot?.templatePack ?? null,
    digest: snapshot?.digest ?? null,
  };
}

function genrePayload(genre) {
  return {
    id: genre.id,
    label: genre.label,
    voice: genreVoiceLine(genre),
    chapterLabels: ensureChapterLabels(genre),
    opening: genre.opening,
    closing: genre.closing,
  };
}

function stylePromptPayload(stylePromptEngineering, stylePromptPack) {
  return {
    id: stylePromptEngineering.promptPackId,
    styleId: stylePromptPack.styleId,
    label: stylePromptPack.label,
    concept: stylePromptPack.concept,
  };
}

function buildOutputContractSpec() {
  return {
    schema: 'openprd.learning-content.v1',
    agentOwnedFields: [
      'title',
      'subtitle',
      'learningGoals',
      'overviewParagraphs',
      'outline',
      'chapters',
      'nextActions',
    ],
    chapterShape: {
      required: ['id', 'label', 'semanticTitle', 'summary', 'paragraphs', 'evidenceIds'],
      optional: ['retrievalBlocks', 'workedExamples', 'visualExplainer'],
      retrievalBlockShape: ['prompt', 'hint', 'answer'],
      workedExampleShape: ['title', 'scenario', 'steps', 'principle'],
      visualExplainerShape: {
        required: ['title', 'analogy', 'scene', 'whyItMatters', 'takeaways'],
        optional: ['image'],
        imageShape: ['path', 'alt', 'caption', 'prompt'],
      },
    },
    rules: [
      '不要让 CLI 生成标题、大纲或正文；这些字段必须由 Agent 根据证据写出。',
      '每章 evidenceIds 只能引用 evidence-manifest.json 中存在的 source id。',
      '正文中的任务事实必须能回到 evidence-manifest 的 source、claim 或 excerpt。',
      '可以写推断，但要在表达上说明它来自多个证据的综合判断。',
      '优先写清用户价值、设计动机、关键取舍、适用边界和可迁移原则，不要把正文写成技术说明书、文件导览或实现清单。',
      '只有当技术细节能支撑设计原理、取舍、失败模式或验证结论时，才引入对应技术点。',
      '面向产品、运营或非技术读者时，优先给主要章节补 `visualExplainer`：用具体场景、生活化比喻和 2-4 条看图重点帮助理解。',
      '`visualExplainer.image.path` 可以写成相对 `assetsDir` 的路径；图片只用于帮助理解，不能替代 evidenceIds 或伪装成事实截图。',
    ],
  };
}

function buildAgentContext({ packageId, topic, genre, stylePromptPack, trigger, sourceScope, snapshot, evidenceManifest, related = {}, packagePaths }) {
  const stylePromptEngineering = buildStylePromptEngineering(stylePromptPack);
  return {
    version: LEARNING_REVIEW_SCHEMA_VERSION,
    schema: LEARNING_AGENT_CONTEXT_SCHEMA,
    packageId,
    generatedAt: timestamp(),
    topic,
    trigger,
    sourceScope,
    genre: genrePayload(genre),
    stylePromptPack: stylePromptPayload(stylePromptEngineering, stylePromptPack),
    snapshot: snapshotPayload(snapshot),
    related,
    paths: packagePathPayload(packagePaths),
    evidence: {
      manifestPath: packagePaths.evidenceManifest,
      sourceCount: evidenceManifest.sourceCount,
      claimCount: evidenceManifest.claimCount,
      sources: (evidenceManifest.sources ?? []).map((source) => ({
        id: source.id,
        title: source.title,
        type: source.type,
        relativePath: source.relativePath,
        summary: source.summary,
        excerpt: source.excerpt,
        digest: source.digest,
      })),
      claims: evidenceManifest.claims ?? [],
      gaps: evidenceManifest.gaps ?? [],
    },
    stylePromptEngineering,
    outputContract: buildOutputContractSpec(),
    renderCommand: `openprd learn . --content-json ${packagePaths.contentJson} --open`,
  };
}

function renderAgentPromptMarkdown(agentContext) {
  const sourceLines = (agentContext.evidence.sources ?? []).map((source) => (
    `- ${source.id}: ${source.title} (${source.relativePath ?? '无路径'})`
  ));
  return [
    '# OpenPrd 复盘学习包 Agent 写作提示',
    '',
    `学习包: ${agentContext.packageId}`,
    `主题: ${agentContext.topic}`,
    `触发方式: ${agentContext.trigger}`,
    `来源范围: ${agentContext.sourceScope}`,
    '',
    '## 你的任务',
    '',
    '请你亲自完成复盘学习正文。CLI 只准备了证据、约束、路径和 HTML 阅读器外壳。',
    '',
    '所有读者可见的标题、副标题、目录项、章节标题、段落、检索练习、工作示例、visualExplainer 和下一步都由你负责撰写。',
    '',
    '默认读者期待学会的是: 这件事为什么值得做、为什么这样设计、关键取舍是什么、哪些原则以后还能复用。',
    '如果读者偏产品、运营或非技术角色，优先补充“一眼看懂”的比喻卡，让他们先理解机制，再回到证据。',
    '不要把正文写成技术说明书、文件清单、模块导览或实现流水账。',
    '只有当技术细节能支撑设计原理、权衡、失败模式或验证结论时，才写技术细节。',
    '',
    '## 输入',
    '',
    `- Agent 上下文: ${agentContext.paths.agentContext}`,
    `- 证据清单: ${agentContext.paths.evidenceManifest}`,
    `- 输出内容 JSON: ${agentContext.paths.contentJson}`,
    `- 阅读器 HTML: ${agentContext.paths.readerHtml}`,
    `- 图片素材目录: ${agentContext.paths.assetsDir}`,
    '',
    '## 证据来源',
    '',
    ...sourceLines,
    '',
    '## 输出规则',
    '',
    ...agentContext.outputContract.rules.map((rule) => `- ${rule}`),
    '',
    '## 必需 JSON 结构',
    '',
    '```json',
    JSON.stringify(agentContext.outputContract, null, 2),
    '```',
    '',
    '写入 `learning-content.json` 后，使用下面命令重新渲染:',
    '',
    '```sh',
    agentContext.renderCommand,
    '```',
    '',
  ].join('\n');
}

function buildPendingLearningContract({ packageId, topic, genre, stylePromptPack, trigger, sourceScope, snapshot, related = {}, packagePaths, agentContext }) {
  return {
    version: LEARNING_REVIEW_SCHEMA_VERSION,
    schema: 'openprd.learning-content.v1',
    packageId,
    generatedAt: timestamp(),
    contentMode: 'agent-authored',
    authoringStatus: 'awaiting-agent-content',
    title: '',
    topic,
    subtitle: '',
    genre: agentContext?.genre ?? genrePayload(genre),
    stylePromptPack: agentContext?.stylePromptPack ?? stylePromptPayload(buildStylePromptEngineering(stylePromptPack), stylePromptPack),
    stylePromptEngineering: agentContext?.stylePromptEngineering ?? buildStylePromptEngineering(stylePromptPack),
    styleTransfer: {
      promptPackId: `${stylePromptPack.genreId}.${stylePromptPack.styleId}`,
      agentLoopRequired: true,
      appliedAt: null,
      chapterCount: 0,
    },
    trigger,
    sourceScope,
    audience: null,
    snapshot: snapshotPayload(snapshot),
    learningGoals: [],
    overviewParagraphs: [],
    outline: [],
    chapters: [],
    evidenceManifestPath: packagePaths.evidenceManifest,
    agentContextPath: packagePaths.agentContext,
    agentPromptPath: packagePaths.agentPrompt,
    packagePaths: packagePathPayload(packagePaths),
    related,
    nextActions: [],
  };
}

function normalizeStringList(value, fieldName, errors, { required = false } = {}) {
  if (!Array.isArray(value)) {
    if (required) errors.push(`${fieldName} 必须是非空数组`);
    return [];
  }
  const list = value.map((item) => String(item ?? '').trim()).filter(Boolean);
  if (required && list.length === 0) errors.push(`${fieldName} 必须是非空数组`);
  return list;
}

function normalizeVisualExplainer(value, fieldName, errors) {
  if (value == null) return null;
  if (!value || typeof value !== 'object') {
    errors.push(`${fieldName} 必须是对象`);
    return null;
  }
  for (const childField of ['title', 'analogy', 'scene', 'whyItMatters']) {
    if (!String(value?.[childField] ?? '').trim()) {
      errors.push(`${fieldName}.${childField} 必填`);
    }
  }
  normalizeStringList(value?.takeaways, `${fieldName}.takeaways`, errors, { required: true });
  if (value.image != null) {
    if (!value.image || typeof value.image !== 'object') {
      errors.push(`${fieldName}.image 必须是对象`);
    } else {
      const hasPath = String(value.image.path ?? '').trim().length > 0;
      if (hasPath && !String(value.image.alt ?? '').trim()) {
        errors.push(`${fieldName}.image.alt 必填`);
      }
    }
  }
  return value;
}

const INTERNET_PRODUCT_DIRECTION_SIGNALS = {
  value: ['问题', '价值', '目标', '用户', '场景', '需求', '机会'],
  design: ['设计', '方案', '架构', '结构', '流程', '机制', '路径', '入口', '判断'],
  tradeoff: ['取舍', '代价', '成本', '边界', '风险', '收益', '权衡', '适用', '不适用', '约束'],
};

function collectLearningNarrativeFragments(raw) {
  const outlineFragments = (raw.outline ?? []).flatMap((item) => [item?.title, item?.subtitle]);
  const chapterFragments = (raw.chapters ?? []).flatMap((chapter) => [
    chapter?.label,
    chapter?.semanticTitle,
    chapter?.summary,
    ...(chapter?.paragraphs ?? []),
    chapter?.visualExplainer?.title,
    chapter?.visualExplainer?.analogy,
    chapter?.visualExplainer?.scene,
    chapter?.visualExplainer?.whyItMatters,
    ...(chapter?.visualExplainer?.takeaways ?? []),
    chapter?.visualExplainer?.image?.caption,
    ...(chapter?.retrievalBlocks ?? []).flatMap((block) => [block?.prompt, block?.hint, block?.answer]),
    ...(chapter?.workedExamples ?? []).flatMap((example) => [example?.title, example?.scenario, ...(example?.steps ?? []), example?.principle]),
  ]);
  return [
    raw.title,
    raw.subtitle,
    ...(raw.learningGoals ?? []),
    ...(raw.overviewParagraphs ?? []),
    ...outlineFragments,
    ...chapterFragments,
    ...(raw.nextActions ?? []),
  ].filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

function includesAnySignal(text, signals) {
  return signals.some((signal) => text.includes(signal));
}

function validateInternetProductDirection(raw, errors) {
  const narrative = collectLearningNarrativeFragments(raw).join('\n');
  if (!narrative) return;
  if (!includesAnySignal(narrative, INTERNET_PRODUCT_DIRECTION_SIGNALS.value)) {
    errors.push('internet-product 复盘必须明确说明问题、价值、目标或用户场景，不能只列技术对象。');
  }
  if (!includesAnySignal(narrative, INTERNET_PRODUCT_DIRECTION_SIGNALS.design)) {
    errors.push('internet-product 复盘必须解释为什么这样设计，不能只有文件、模块或命令顺序。');
  }
  if (!includesAnySignal(narrative, INTERNET_PRODUCT_DIRECTION_SIGNALS.tradeoff)) {
    errors.push('internet-product 复盘必须写出取舍、代价、边界或适用条件，而不是只给实现清单。');
  }
  const manualSignals = (narrative.match(/(?:\.openprd\/|docs\/basic\/|[A-Za-z0-9._-]+\.(?:md|json|js|ts|tsx|jsx|html|css))/g) ?? []).length;
  const conceptSignals = Object.values(INTERNET_PRODUCT_DIRECTION_SIGNALS)
    .flat()
    .filter((signal, index, list) => list.indexOf(signal) === index)
    .filter((signal) => narrative.includes(signal))
    .length;
  if (manualSignals >= 6 && conceptSignals < 5) {
    errors.push('internet-product 复盘当前更像技术说明书：路径和文件引用过多，但产品/架构判断不足。');
  }
}

function validateAgentAuthoredContent(raw, evidenceManifest, genreId = null) {
  const errors = [];
  if (!raw || typeof raw !== 'object') {
    throw new Error('无效的 Agent 学习内容: JSON 根节点必须是对象。');
  }
  if (raw.schema && raw.schema !== 'openprd.learning-content.v1') {
    errors.push('schema 必须是 openprd.learning-content.v1');
  }
  if (!String(raw.title ?? '').trim()) errors.push('title 必填');
  if (!Array.isArray(raw.outline) || raw.outline.length === 0) errors.push('outline 必须是非空数组');
  if (!Array.isArray(raw.chapters) || raw.chapters.length === 0) errors.push('chapters 必须是非空数组');

  const sourceIds = new Set((evidenceManifest.sources ?? []).map((source) => source.id));
  for (const [index, chapter] of (raw.chapters ?? []).entries()) {
    const label = `chapters[${index}]`;
    for (const field of ['id', 'label', 'semanticTitle', 'summary']) {
      if (!String(chapter?.[field] ?? '').trim()) errors.push(`${label}.${field} 必填`);
    }
    normalizeStringList(chapter?.paragraphs, `${label}.paragraphs`, errors, { required: true });
    if (!Array.isArray(chapter?.evidenceIds) || chapter.evidenceIds.length === 0) {
      errors.push(`${label}.evidenceIds 必须是非空数组`);
    } else {
      for (const evidenceId of chapter.evidenceIds) {
        if (!sourceIds.has(evidenceId)) errors.push(`${label}.evidenceIds 包含未知来源 id: ${evidenceId}`);
      }
    }
    for (const [blockIndex, block] of (chapter?.retrievalBlocks ?? []).entries()) {
      if (!String(block?.prompt ?? '').trim()) errors.push(`${label}.retrievalBlocks[${blockIndex}].prompt 必填`);
      if (!String(block?.answer ?? '').trim()) errors.push(`${label}.retrievalBlocks[${blockIndex}].answer 必填`);
    }
    for (const [exampleIndex, example] of (chapter?.workedExamples ?? []).entries()) {
      if (!String(example?.title ?? '').trim()) errors.push(`${label}.workedExamples[${exampleIndex}].title 必填`);
      if (!String(example?.scenario ?? '').trim()) errors.push(`${label}.workedExamples[${exampleIndex}].scenario 必填`);
      normalizeStringList(example?.steps, `${label}.workedExamples[${exampleIndex}].steps`, errors, { required: true });
    }
    normalizeVisualExplainer(chapter?.visualExplainer, `${label}.visualExplainer`, errors);
  }
  if (genreId === 'internet-product') validateInternetProductDirection(raw, errors);
  if (errors.length > 0) {
    throw new Error(`无效的 Agent 学习内容: ${errors.join('; ')}`);
  }
}

function normalizeAgentAuthoredContent(raw, shell, evidenceManifest) {
  validateAgentAuthoredContent(raw, evidenceManifest, shell.genre?.id ?? null);
  const errors = [];
  return {
    ...shell,
    generatedAt: timestamp(),
    authoringStatus: 'agent-authored',
    title: String(raw.title).trim(),
    subtitle: String(raw.subtitle ?? '').trim(),
    audience: raw.audience ?? shell.audience,
    learningGoals: normalizeStringList(raw.learningGoals, 'learningGoals', errors),
    overviewParagraphs: normalizeStringList(raw.overviewParagraphs, 'overviewParagraphs', errors),
    outline: raw.outline,
    chapters: raw.chapters,
    nextActions: normalizeStringList(raw.nextActions, 'nextActions', errors),
    styleTransfer: buildStyleTransferReport(shell.stylePromptPack, raw.chapters ?? []),
    agentNotes: raw.agentNotes ?? null,
  };
}

function buildLearningContract({ packageId, topic, genre, stylePromptPack, trigger, sourceScope, snapshot, evidenceManifest, related = {}, packagePaths, agentContext, authoredContent = null }) {
  const shell = buildPendingLearningContract({
    packageId,
    topic,
    genre,
    stylePromptPack,
    trigger,
    sourceScope,
    snapshot,
    related,
    packagePaths,
    agentContext,
  });
  if (!authoredContent) return shell;
  return normalizeAgentAuthoredContent(authoredContent, shell, evidenceManifest);
}

function renderLearningMarkdown({ content, evidenceManifest }) {
  if (content.authoringStatus === 'awaiting-agent-content') {
    const lines = [
      '---',
      `schema: ${content.schema}`,
      `version: ${content.version}`,
      `packageId: ${content.packageId}`,
      `topic: ${content.topic}`,
      `trigger: ${content.trigger}`,
      `sourceScope: ${content.sourceScope}`,
      `evidenceManifestPath: ${content.evidenceManifestPath}`,
      `agentContextPath: ${content.agentContextPath}`,
      `agentPromptPath: ${content.agentPromptPath}`,
      'authoringStatus: awaiting-agent-content',
      '---',
      '',
      '# 等待 Agent 写作',
      '',
      '本文件不会替 Agent 生成复盘标题、大纲或正文。请让 Agent 读取写作提示和证据清单后，写入 `learning-content.json`。',
      '',
      '## 写作入口',
      '',
      `- Agent 写作提示: ${content.agentPromptPath}`,
      `- Agent 上下文: ${content.agentContextPath}`,
      `- 证据清单: ${content.evidenceManifestPath}`,
      `- 内容 JSON: ${content.packagePaths?.contentJson ?? ''}`,
      `- 图片素材目录: ${content.packagePaths?.assetsDir ?? ''}`,
      '',
      '## 证据清单',
      '',
    ];
    for (const source of evidenceManifest.sources ?? []) {
      lines.push(`- ${source.id}: ${source.title} (${source.relativePath})`);
    }
    lines.push('');
    return `${lines.join('\n')}`;
  }

  const lines = [
    '---',
    `schema: ${content.schema}`,
    `version: ${content.version}`,
    `packageId: ${content.packageId}`,
    `title: ${content.title}`,
    `topic: ${content.topic}`,
    `genreId: ${content.genre.id}`,
    `genreLabel: ${content.genre.label}`,
    `stylePromptPack: ${content.stylePromptPack?.id ?? 'default'}`,
    `trigger: ${content.trigger}`,
    `sourceScope: ${content.sourceScope}`,
    `evidenceManifestPath: ${content.evidenceManifestPath}`,
    '---',
    '',
    `# ${content.title}`,
    '',
    `> ${content.subtitle}`,
    '',
    '## 你会学到什么',
    '',
    ...content.learningGoals.map((item) => `- ${item}`),
    '',
    '## 读法',
    '',
    '- 先看目录，再看章节标题。',
    '- 如果章节里有“一眼看懂”图卡，先用它建立直觉，再读正文和证据。',
    '- 章节内先读叙述，再做检索练习，最后看工作示例。',
    '- 所有重要判断都可以回到证据清单。',
    '',
    '## 提示词工程',
    '',
    `- 提示词包: ${content.stylePromptEngineering?.promptPackId ?? 'default'}`,
    `- 风格目标: ${content.stylePromptEngineering?.concept ?? '保持事实层不变，优化表达层。'}`,
    `- 句式节奏: ${content.stylePromptEngineering?.sentenceRhythm ?? '按题材调整。'}`,
    '',
    '### 系统提示词',
    '',
    '```text',
    content.stylePromptEngineering?.prompts?.system ?? '',
    '```',
    '',
    '### 标题提示词',
    '',
    '```text',
    content.stylePromptEngineering?.prompts?.title ?? '',
    '```',
    '',
    '### 大纲提示词',
    '',
    '```text',
    content.stylePromptEngineering?.prompts?.outline ?? '',
    '```',
    '',
    '### 正文改写提示词',
    '',
    '```text',
    content.stylePromptEngineering?.prompts?.proseRewrite ?? '',
    '```',
    '',
    '### 质量检查提示词',
    '',
    '```text',
    content.stylePromptEngineering?.prompts?.qualityReview ?? '',
    '```',
    '',
    '## 证据包结构',
    '',
    '```text',
    `.openprd/learning/archive/${content.packageId}/`,
    '  assets/',
    '  learning-package.json',
    '  learning-content.json',
    '  learning-content.md',
    '  evidence-manifest.json',
    '  reader.html',
    '```',
    '',
  ];

  for (const chapter of content.chapters) {
    lines.push(`## ${chapter.label} · ${chapter.semanticTitle}`);
    lines.push('');
    lines.push(chapter.summary);
    lines.push('');
    if (chapter.visualExplainer) {
      lines.push('### 一眼看懂');
      lines.push('');
      lines.push(`- 标题: ${chapter.visualExplainer.title}`);
      lines.push(`- 比喻: ${chapter.visualExplainer.analogy}`);
      lines.push(`- 场景: ${chapter.visualExplainer.scene}`);
      lines.push(`- 作用: ${chapter.visualExplainer.whyItMatters}`);
      if ((chapter.visualExplainer.takeaways ?? []).length > 0) {
        lines.push('- 看图重点:');
        for (const takeaway of chapter.visualExplainer.takeaways ?? []) {
          lines.push(`  - ${takeaway}`);
        }
      }
      if (chapter.visualExplainer.image?.path) {
        lines.push(`- 图片: ${chapter.visualExplainer.image.path}`);
      }
      if (chapter.visualExplainer.image?.caption) {
        lines.push(`- 图注: ${chapter.visualExplainer.image.caption}`);
      }
      lines.push('');
    }
    for (const paragraph of chapter.paragraphs ?? []) {
      lines.push(paragraph);
      lines.push('');
    }
    if ((chapter.retrievalBlocks ?? []).length > 0) {
      lines.push('### 检索练习');
      lines.push('');
      for (const [index, block] of chapter.retrievalBlocks.entries()) {
        lines.push(`1. ${block.prompt}`);
        if (block.hint) lines.push(`   - 提示: ${block.hint}`);
        lines.push(`   - 参考答案: ${block.answer}`);
      }
      lines.push('');
    }
    if ((chapter.workedExamples ?? []).length > 0) {
      lines.push('### 工作示例');
      lines.push('');
      for (const example of chapter.workedExamples) {
        lines.push(`- ${example.title}`);
        lines.push(`  - 场景: ${example.scenario}`);
        lines.push('  - 步骤:');
        for (const step of example.steps ?? []) {
          lines.push(`    - ${step}`);
        }
        if (example.principle) {
          lines.push(`  - 原则: ${example.principle}`);
        }
      }
      lines.push('');
    }
    if ((chapter.evidenceIds ?? []).length > 0) {
      lines.push('### 证据引用');
      lines.push('');
      for (const evidenceId of chapter.evidenceIds) {
        lines.push(`- ${evidenceId}`);
      }
      lines.push('');
    }
  }

  lines.push('## 证据清单');
  lines.push('');
  for (const source of evidenceManifest.sources ?? []) {
    lines.push(`- ${source.id}: ${source.title} (${source.relativePath})`);
  }
  lines.push('');
  lines.push('## 下一步');
  lines.push('');
  for (const action of content.nextActions ?? []) {
    lines.push(`- ${action}`);
  }
  lines.push('');
  return `${lines.join('\n')}`;
}

async function writeLearningPackageIndex(ws, indexEntry) {
  const current = await readJson(ws.paths.learningIndex).catch(() => ({
    version: LEARNING_REVIEW_SCHEMA_VERSION,
    generatedAt: timestamp(),
    updatedAt: timestamp(),
    currentPackageId: null,
    packages: [],
  }));
  const packages = Array.isArray(current.packages) ? current.packages.filter((item) => item.packageId !== indexEntry.packageId) : [];
  packages.unshift(indexEntry);
  const next = {
    version: LEARNING_REVIEW_SCHEMA_VERSION,
    generatedAt: current.generatedAt ?? timestamp(),
    updatedAt: timestamp(),
    currentPackageId: indexEntry.packageId,
    packages,
  };
  await writeJson(ws.paths.learningIndex, next);
  await writeJson(ws.paths.learningCurrent, indexEntry);
  return next;
}

async function ensureLearningDirs(ws) {
  await fs.mkdir(ws.paths.learningDir, { recursive: true });
  await fs.mkdir(ws.paths.learningArchiveDir, { recursive: true });
}

async function generateLearningReviewWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  await ensureLearningDirs(ws);
  const settings = await readLearningReviewSettings(ws);
  if (options.respectConfig !== false && settings.enabled === false) {
    return {
      ok: true,
      action: 'learning-review-generate',
      skipped: true,
      reason: '复盘学习模式已关闭',
      ws,
      settings,
      opened: false,
    };
  }

  const versionIndex = await readVersionIndex(ws);
  const currentState = ws.data.currentState ?? {};
  const latestVersion = await loadLatestVersionSnapshot(ws);
  const snapshot = latestVersion?.snapshot ?? buildPrdSnapshot(ws, {
    ...currentState,
    versionNumber: currentState.prdVersion ?? (versionIndex.at(-1)?.versionNumber ?? 0),
    versionId: currentState.prdVersion > 0
      ? formatVersionId(currentState.prdVersion)
      : (versionIndex.at(-1)?.versionId ?? 'v0000'),
    productType: resolveCurrentProductType(ws),
    templatePack: resolveActiveTemplatePack(ws),
    status: currentState.status ?? 'draft',
  });

  const topic = inferTopic(snapshot, options);
  const genreId = normalizeGenreId(options.genre ?? settings.defaultGenre ?? inferGenreId(topic, snapshot));
  const genre = GENRE_LIBRARY[genreId] ?? GENRE_LIBRARY['internet-product'];
  const stylePromptPack = resolveStylePromptPack(genre.id, options.style);
  const trigger = options.trigger ?? 'manual';
  const sourceScope = options.sourceScope ?? settings.sourceScope ?? DEFAULT_LEARNING_REVIEW_SETTINGS.sourceScope;
  const packageId = options.packageId ?? `lr-${compactTimestamp()}-${slugify(topic || genre.id, genre.id)}`;
  const packagePaths = learningPackagePaths(ws, packageId);
  await fs.mkdir(packagePaths.dir, { recursive: true });
  await fs.mkdir(packagePaths.assetsDir, { recursive: true });

  const related = {
    changeId: options.changeId ?? null,
    taskId: options.taskId ?? null,
    verifyCommand: options.verifyCommand ?? null,
    testReport: options.testReport ?? null,
    commitSha: options.commitSha ?? null,
  };
  const evidenceManifest = await buildEvidenceManifest(ws, snapshot, { sourceScope, related });
  const agentContext = buildAgentContext({
    packageId,
    topic,
    genre,
    stylePromptPack,
    trigger,
    sourceScope,
    snapshot,
    evidenceManifest,
    related,
    packagePaths,
  });
  const authoredContent = options.content
    ?? (options.contentJson ? await readJson(resolveProjectFile(ws.projectRoot, options.contentJson)) : null);
  const content = buildLearningContract({
    packageId,
    topic,
    genre,
    stylePromptPack,
    trigger,
    sourceScope,
    snapshot,
    evidenceManifest,
    related,
    packagePaths,
    agentContext,
    authoredContent,
  });
  const shouldOpen = Boolean(options.open ?? settings.autoOpen) && content.authoringStatus !== 'awaiting-agent-content';

  const markdown = renderLearningMarkdown({ content, evidenceManifest });
  const packageMeta = {
    version: LEARNING_REVIEW_SCHEMA_VERSION,
    generatedAt: content.generatedAt,
    packageId,
    title: content.title || 'OpenPrd 复盘学习包',
    topic,
    genreId: genre.id,
    genreLabel: genre.label,
    styleId: stylePromptPack.styleId,
    styleLabel: stylePromptPack.label,
    promptPackId: `${stylePromptPack.genreId}.${stylePromptPack.styleId}`,
    trigger,
    sourceScope,
    contentMode: content.contentMode,
    authoringStatus: content.authoringStatus,
    needsAgentDraft: content.authoringStatus === 'awaiting-agent-content',
    autoOpen: shouldOpen,
    related: content.related,
    paths: packagePathPayload(packagePaths),
    sourceCount: evidenceManifest.sourceCount,
    claimCount: evidenceManifest.claimCount,
    chapterCount: content.chapters.length,
  };

  await writeJson(packagePaths.packageJson, packageMeta);
  await writeJson(packagePaths.agentContext, agentContext);
  await writeText(packagePaths.agentPrompt, renderAgentPromptMarkdown(agentContext));
  await writeJson(packagePaths.contentJson, content);
  await writeText(packagePaths.contentMarkdown, markdown);
  await writeJson(packagePaths.evidenceManifest, evidenceManifest);
  await writeHtmlArtifact(packagePaths.readerHtml, renderLearningArtifact({
    packageMeta,
    content,
    evidenceManifest,
  }));

  const indexEntry = {
    ...packageMeta,
    relativeDir: path.relative(ws.workspaceRoot, packagePaths.dir).split(path.sep).join('/'),
  };
  const learningIndex = await writeLearningPackageIndex(ws, indexEntry);

  let opened = false;
  if (shouldOpen) {
    try {
      await openArtifactInBrowser(packagePaths.readerHtml);
      opened = true;
    } catch {
      opened = false;
    }
  }

  const nextState = await readCurrentState(ws);
  nextState.learningReview = {
    ...(nextState.learningReview ?? {}),
    enabled: settings.enabled,
    defaultGenre: settings.defaultGenre,
    autoOpen: settings.autoOpen,
    sourceScope,
    lastPackageId: packageId,
    lastGeneratedAt: content.generatedAt,
    lastGenreId: genre.id,
    lastStyleId: stylePromptPack.styleId,
    lastTopic: topic,
    lastTrigger: trigger,
    lastAuthoringStatus: content.authoringStatus,
    lastOpened: opened,
  };
  await writeJson(ws.paths.currentState, nextState);

  await appendText(ws.paths.progressLog, `\n## ${timestamp()}\n\n- 已生成学习包 ${packageId}。\n- 写作状态: ${content.authoringStatus}。\n- 题材: ${genre.label}。\n- HTML: ${path.relative(ws.workspaceRoot, packagePaths.readerHtml).split(path.sep).join('/')}。\n- Agent 写作提示: ${path.relative(ws.workspaceRoot, packagePaths.agentPrompt).split(path.sep).join('/')}。\n`);
  await appendText(ws.paths.decisionLog, `\n## ${timestamp()}\n\n- 复盘学习包已生成: ${packageId}。\n- 写作状态: ${content.authoringStatus}。\n- 证据源: ${evidenceManifest.sourceCount}。\n- 章节数: ${content.chapters.length}。\n`);

  return {
    ok: true,
    action: 'learning-review-generate',
    ws,
    settings,
    snapshot,
    genre,
    packageId,
    packageMeta,
    packagePaths,
    learningIndex,
    evidenceManifest,
    agentContext,
    content,
    opened,
    skipped: false,
  };
}

async function setLearningReviewModeWorkspace(projectRoot, enabled, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  await ensureLearningDirs(ws);
  const settings = await readLearningReviewSettings(ws);
  const result = await persistLearningConfig(ws, {
    enabled: Boolean(enabled),
  }, {
    action: enabled ? 'enable-learning-review' : 'disable-learning-review',
  });

  await appendText(ws.paths.progressLog, `\n## ${timestamp()}\n\n- 复盘学习模式已${enabled ? '开启' : '关闭'}。\n- 默认题材: ${result.config.defaultGenre}。\n`);

  return {
    ok: true,
    action: 'learning-review-config',
    ws: result.ws,
    settings: {
      ...settings,
      enabled: Boolean(enabled),
    },
    config: result.config,
    enabled: Boolean(enabled),
    opened: false,
  };
}

export {
  buildEvidenceManifest,
  buildLearningContract,
  generateLearningReviewWorkspace,
  normalizeGenreId,
  readLearningReviewSettings,
  setLearningReviewModeWorkspace,
};
