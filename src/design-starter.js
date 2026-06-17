/*
 * 核心功能
 * 把 OpenPrd 内置前端模板落成当前项目的真实入口文件，并在需要时顺手写实 active design contracts、替换模板占位文案。
 *
 * 输入
 * 接收项目根目录、starter 标识、输出文件路径、是否允许覆盖，以及可选的 brief / title / sections / 无依赖判断。
 *
 * 输出
 * 复制 `.openprd/design/templates/` 下的模板到目标文件，并返回模板来源、输出路径、推荐默认组合，以及是否同步写实 active design contracts。
 *
 * 定位
 * 位于前端实现准备层，承接 `.openprd/design/active/*` 合同与“起第一版骨架”之间最容易卡住的那一跳。
 *
 * 依赖
 * 依赖 workspace-core 读取工作区路径与记录事件，依赖 fs-utils 做模板读取和写入。
 *
 * 维护规则
 * 新增 starter 或 starter 占位字段时，同步更新 STARTER_CATALOG、placeholder map、usage、前端 skill、模板 README 和相关测试。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildThemeLockStyle,
  injectThemeLockStyle,
  isRealImageDependentStarterContext,
  loadThemeConfig,
  sourceStarterImages,
} from './design-starter-support.js';
import { appendProgress, appendWorkflowEvent, loadWorkspace } from './workspace-core.js';
import { exists, readText, writeText } from './fs-utils.js';

const STARTER_CATALOG = [
  {
    id: 'content-home',
    file: 'content-home.html',
    description: '内容型首页、导览页、展览页、故事型首页',
    starterTitle: '内容型首页',
    defaultSections: ['今日推荐', '主题分区', '浏览结构', '下一步动作'],
    selectedDirection: {
      label: '方向 1',
      lens: 'editorial-contrast',
      theme: 'warm-editorial',
      layout: 'story-map',
      aesthetic: '温暖编辑式内容首页，用标题字体、图文节奏和章节停顿建立可长期阅读的气质。',
      memoryPoint: '第一眼记住清楚的主题入口和像杂志目录一样的内容节奏。',
      components: ['editorial-hero', 'stat-row', 'story-section', 'feature-grid', 'timeline', 'cta-banner'],
    },
    directions: [
      {
        label: '方向 1',
        logic: 'contrast',
        lens: 'editorial-contrast',
        theme: 'warm-editorial',
        layout: 'story-map',
        aesthetic: '温暖编辑感，靠标题字体和章节节奏组织内容。',
        memoryPoint: '像一本打开的专题目录，用户知道从哪里开始读。',
        suitable: '长期写作首页、专题内容页、个人博客首页',
        risk: '如果信息密度控制不好，首屏会显得偏满。',
      },
      {
        label: '方向 2',
        logic: 'reference-transfer',
        lens: 'catalog-clarity',
        theme: 'quiet-sand',
        layout: 'editorial-rail',
        aesthetic: '克制资料库感，靠清楚分类和可比较信息单元建立秩序。',
        memoryPoint: '用户能快速回到分类、筛选和上一次浏览位置。',
        suitable: '知识整理页、文章归档页、资源导航页',
        risk: '如果目录层级太重，会削弱阅读感。',
      },
      {
        label: '方向 3',
        logic: 'design-lens',
        lens: 'immersive-showcase',
        theme: 'deep-launch',
        layout: 'story-map',
        aesthetic: '沉浸展示感，靠强主视觉和少量文字信号制造记忆。',
        memoryPoint: '首屏真实场景或关键视觉成为页面锚点。',
        suitable: '需要更强个人风格的内容展示页',
        risk: '容易更像展示页而不是稳定阅读首页。',
      },
    ],
  },
  {
    id: 'product-launch',
    file: 'product-launch.html',
    description: '产品发布页、品牌发布页、功能发布页、介绍型首页',
    starterTitle: '产品发布页',
    defaultSections: ['关键变化', '核心收益', '适用对象', '上线信息'],
    selectedDirection: {
      label: '方向 1',
      lens: 'product-launch',
      theme: 'deep-launch',
      layout: 'product-spec-runway',
      aesthetic: '暗色发布叙事，用产品状态、规格跑道和强对比动作建立发布感。',
      memoryPoint: '用户记住一个明确承诺和一个可验证的产品状态。',
      components: ['spec-hero', 'stat-row', 'feature-grid', 'logo-wall', 'cta-banner'],
    },
    directions: [
      {
        label: '方向 1',
        logic: 'contrast',
        lens: 'product-launch',
        theme: 'deep-launch',
        layout: 'product-spec-runway',
        aesthetic: '深色电影感发布页，强调新能力、证明材料和决策动作。',
        memoryPoint: '一个强主视觉承载发布承诺，而不是一组泛泛功能卡片。',
        suitable: '正式发布页、版本更新页、关键能力介绍页',
        risk: '如果证据不足，会只剩氛围没有事实。',
      },
      {
        label: '方向 2',
        logic: 'reference-transfer',
        lens: 'editorial-contrast',
        theme: 'warm-editorial',
        layout: 'pricing-and-proof',
        aesthetic: '编辑型解释页，降低销售感，用证据、价格或适用对象帮助决策。',
        memoryPoint: '用户记住“为什么现在值得用”和“适合谁”。',
        suitable: '要兼顾解释与决策的介绍页',
        risk: '可能不够强势，发布感会偏弱。',
      },
      {
        label: '方向 3',
        logic: 'design-lens',
        lens: 'immersive-showcase',
        theme: 'deep-launch',
        layout: 'immersive-hero-stack',
        aesthetic: '沉浸式产品故事，靠媒体层级和少量强文本拉开情绪。',
        memoryPoint: '首屏像一段产品片头，但仍保留下一步动作。',
        suitable: '视觉驱动型发布叙事',
        risk: '容易把页面做成纯展示而削弱可扫描性。',
      },
    ],
  },
  {
    id: 'ops-dashboard',
    file: 'ops-dashboard.html',
    description: '工具台、后台首页、运营工作台、信息密度型页面',
    starterTitle: '运营工作台',
    defaultSections: ['待处理动作', '主要列表', '关键指标', '当前模块'],
    selectedDirection: {
      label: '方向 1',
      lens: 'operational-density',
      theme: 'tool-neutral',
      layout: 'ops-density-grid',
      aesthetic: '安静工作台，用稳定密度、清楚状态和短路径体现专业感。',
      memoryPoint: '用户记住这是一个能反复使用、快速扫描的控制台。',
      components: ['filter-rail', 'summary-panel', 'dense-table', 'settings-group'],
    },
    directions: [
      {
        label: '方向 1',
        logic: 'contrast',
        lens: 'operational-density',
        theme: 'tool-neutral',
        layout: 'ops-density-grid',
        aesthetic: '克制工具感，靠密度、对齐、状态和控件层级让用户快速完成工作。',
        memoryPoint: '首屏一眼知道待处理、关键指标和下一步动作。',
        suitable: '后台首页、运营看板、任务工作台',
        risk: '如果主次不清，扫描效率会下降。',
      },
      {
        label: '方向 2',
        logic: 'reference-transfer',
        lens: 'catalog-clarity',
        theme: 'quiet-sand',
        layout: 'catalog-browser',
        aesthetic: '资料浏览器感，靠分类、筛选和可比较对象减少重复判断。',
        memoryPoint: '用户记住清楚的浏览结构和稳定的回看路径。',
        suitable: '对象浏览与筛选更重的系统首页',
        risk: '容易太像列表页，动作感不足。',
      },
      {
        label: '方向 3',
        logic: 'design-lens',
        lens: 'operational-density',
        theme: 'deep-launch',
        layout: 'settings-split',
        aesthetic: '深色控制中心感，适合高风险配置和集中监控。',
        memoryPoint: '关键状态像仪表盘一样醒目，但操作仍克制。',
        suitable: '偏控制中心与配置中枢的场景',
        risk: '暗色高密度更考验层级控制。',
      },
    ],
  },
];

const STARTER_LOOKUP = new Map(
  STARTER_CATALOG.flatMap((starter) => [
    [starter.id, starter],
    [starter.file, starter],
  ]),
);

function normalizePathForDisplay(filePath) {
  return String(filePath ?? '').replaceAll('\\', '/');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function normalizePathForMarkdown(value) {
  return String(value ?? '').replaceAll('|', '\\|').trim();
}

function normalizeModuleName(raw, fallback = 'project') {
  const candidate = String(raw ?? '').trim().split('/').filter(Boolean).pop() ?? '';
  const normalized = candidate.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function parseStarterDefaults(templateText) {
  const match = String(templateText ?? '').match(/starter-defaults:\s*lens=([^\s]+)\s+theme=([^\s]+)\s+layout=([^\s]+)\s*-->/);
  if (!match) {
    return {
      lens: null,
      theme: null,
      layout: null,
    };
  }
  return {
    lens: match[1] ?? null,
    theme: match[2] ?? null,
    layout: match[3] ?? null,
  };
}

function buildAvailableStarters() {
  return STARTER_CATALOG.map((starter) => ({
    id: starter.id,
    file: starter.file,
    description: starter.description,
  }));
}

function splitSections(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  }
  const text = String(value ?? '').trim();
  if (!text) {
    return [...fallback];
  }
  return text
    .split(/[|,，；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBrief(options = {}) {
  return String(options.brief ?? '').trim();
}

function shouldHydrateStarter(options = {}) {
  return Boolean(
    normalizeBrief(options)
    || String(options.title ?? '').trim()
    || String(options.sections ?? '').trim()
  );
}

function deriveDisplayTitle(options = {}, starter) {
  const explicitTitle = String(options.title ?? '').trim();
  if (explicitTitle) {
    return explicitTitle;
  }
  const brief = normalizeBrief(options);
  if (!brief) {
    return starter.starterTitle;
  }
  const shortened = brief
    .replace(/^(一个|一套|请直接实现一个|请实现一个|直接实现一个)/, '')
    .replace(/(首页|页面|原型|界面|网站)$/g, '')
    .trim();
  return shortened || brief;
}

function buildStarterContext(starter, defaults, options = {}) {
  return {
    starterId: starter.id,
    brief: normalizeBrief(options) || `${starter.starterTitle}的第一版落地页面`,
    displayTitle: deriveDisplayTitle(options, starter),
    htmlTitle: deriveDisplayTitle(options, starter),
    sections: splitSections(options.sections, starter.defaultSections),
    defaults,
    noExternalFacts: Boolean(options.noExternalFacts),
    noBrandAssets: Boolean(options.noBrandAssets),
    noRealImages: Boolean(options.noRealImages),
    themeConfig: null,
    imageBundle: null,
    selectedDirection: starter.selectedDirection,
  };
}

function pickImageAsset(assets, index) {
  if (!Array.isArray(assets) || index < 0 || index >= assets.length) {
    return null;
  }
  return assets[index];
}

function buildMediaMarkup(asset, fallbackLabel) {
  if (!asset) {
    return `<div class="media-fallback"><span>${escapeHtml(fallbackLabel)}</span></div>`;
  }
  return [
    '<figure class="media-frame">',
    `  <img src="${escapeHtml(asset.relativePath)}" alt="${escapeHtml(asset.alt || asset.title || fallbackLabel)}" loading="eager" />`,
    `  <figcaption>${escapeHtml(asset.title || asset.alt || fallbackLabel)}</figcaption>`,
    '</figure>',
  ].join('\n');
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function buildHtmlFileManual(starter, context, relativeOutputPath) {
  const sectionSummary = context.sections.join('、');
  const dependencyLine = context.noExternalFacts && context.noBrandAssets && context.noRealImages
    ? '原生 HTML、CSS 与轻量内联脚本；不依赖构建工具、第三方库或远程接口。'
    : '原生 HTML、CSS 与轻量内联脚本；如果后续补真实素材或事实数据，再同步更新依赖说明。';
  const inputLine = starter.id === 'product-launch'
    ? '用户直接打开静态 HTML 文件；页面内容来自当前任务已确认的发布主题、模块范围与可选事实约束。'
    : '用户直接打开静态 HTML 文件；页面内容来自当前任务已确认的页面主题、模块范围与可选事实约束。';
  const outputLineByStarter = {
    'content-home': `渲染完整内容型首页，展示 ${sectionSummary}，并提供站内锚点与阅读型 CTA。`,
    'product-launch': `渲染完整发布页，展示 ${sectionSummary}，并把变化、证据和下一步动作收进同一页面。`,
    'ops-dashboard': `渲染完整工作台首页，展示 ${sectionSummary}，并把判断、对象和动作入口放在同一视图里。`,
  };
  const purposeLineByStarter = {
    'content-home': '当前项目的核心首页入口文件，同时承载视觉样式、内容结构和轻量交互。',
    'product-launch': '当前项目的核心发布页入口文件，同时承载首屏叙事、证据区块和 CTA。',
    'ops-dashboard': '当前项目的唯一工作台入口文件，同时承载信息密度布局、状态卡与队列区块。',
  };
  return `<!--
## 核心功能
提供一个可直接在浏览器打开的${context.displayTitle}页面入口，围绕 ${sectionSummary} 组织第一版真实内容。

## 输入
${inputLine}

## 输出
${outputLineByStarter[starter.id] ?? `渲染 ${relativeOutputPath} 对应的静态页面入口。`}

## 定位
${purposeLineByStarter[starter.id] ?? '当前项目的主要页面入口文件。'}

## 依赖
${dependencyLine}

## 维护规则
- \`design-starter\` 完成后默认进入 \`Patch Mode\`：必须在当前入口文件上继续补丁修改；即使需要大幅调整结构，也是在同一路径内覆盖，不做 delete-first，更不要删除后另起新稿。
- 如果后续用户又给了效果图、设计稿或参考图，以这些参考为准；starter 默认组合只在足够接近时继续沿用，不反过来主导最终风格。
- 如果确实需要整页重写，先把完整新稿写到同目录 sibling draft，再覆盖回当前入口文件；不要让正式入口出现空窗。
- starter 一落地后，只允许做一轮就地对焦：快速读一次生成的入口文件和必要的 active design artifacts；这轮对焦结束后，下一步就必须是真实写入口，不要再回头搜网页、翻 \`docs/basic/\` 或继续模板漫游。
- 把最后一批必要的查事实、查图、读模板动作放在口头宣布之前做完；一旦你已经说“开始覆盖入口文件”或“开始整页重写”，下一步必须是对入口文件或 sibling draft 的实际写操作；不要继续只读扫描、压图或停在口头承诺；必要时 hook 会把这类非写入动作挡回去。
- 修改页面结构、核心文案、交互方式或视觉主题后，需同步更新本说明书。
- 变更交付方式、事实边界或项目结构后，需同步更新 \`docs/basic/\` 与相关设计合同。
-->`;
}

function buildGenericFactsSheet(context) {
  const firstSection = context.sections[0] ?? '首页内容';
  const secondSection = context.sections[1] ?? '信息结构';
  const boundary = context.noExternalFacts
    ? '页面内容以内建文案为准，不依赖外部产品事实或第三方数据。'
    : '页面内容需要按当前任务范围核实外部事实，未核实项需继续补充。';
  return `# Facts Sheet

| 字段 | 当前值 | 来源 | verifiedAt | 状态 |
| --- | --- | --- | --- | --- |
| 页面主题 | ${normalizePathForMarkdown(context.brief)} | user-request | ${todayStamp()} | verified |
| 交付形态 | 单文件静态入口，可直接在浏览器打开 | user-request | ${todayStamp()} | verified |
| 必备模块 | ${normalizePathForMarkdown(context.sections.join('、'))} | user-request | ${todayStamp()} | verified |
| 内容边界 | ${normalizePathForMarkdown(boundary)} | ${context.noExternalFacts ? 'agent-defined' : 'needs-follow-up'} | ${todayStamp()} | verified |

## 备注

- 当前首要模块: ${normalizePathForMarkdown(firstSection)}
- 当前次级模块: ${normalizePathForMarkdown(secondSection)}
`;
}

function buildGenericAssetSpec(context) {
  const imageDependent = isRealImageDependentStarterContext({ id: context.starterId }, context);
  const assetLine = context.noBrandAssets
    ? '当前无品牌素材依赖'
    : '如需品牌资产，后续按任务补充';
  const imageLine = context.noRealImages
    ? '页面成立不依赖真实图片'
    : imageDependent
      ? '页面更像依赖真实图片的内容页，优先补与主题直接相关的真实图片'
      : '如需真实图片，后续按任务补充';
  const imageBundle = context.imageBundle ?? null;
  const fetchedImageRows = imageBundle?.succeeded
    ? imageBundle.assets.map((asset) => `| 图片 ${asset.index} | ${normalizePathForMarkdown(asset.title || asset.alt)} | ${normalizePathForMarkdown(asset.pageUrl || asset.sourceUrl)} | fetched | ${normalizePathForMarkdown(`Wikimedia Commons / ${asset.licenseShortName}`)} |`)
    : [];
  return `# Asset Spec

| 类型 | 资产 | 来源 | 状态 | 备注 |
| --- | --- | --- | --- | --- |
| logo | ${normalizePathForMarkdown(context.noBrandAssets ? '无外部 logo，优先用文字字标' : '待补品牌字标或官方 logo')} | ${context.noBrandAssets ? 'n/a' : '待确认'} | ${context.noBrandAssets ? 'not-needed' : 'defined'} | ${normalizePathForMarkdown(assetLine)} |
| 产品图 | ${normalizePathForMarkdown(context.noBrandAssets ? '无' : '按任务需要补产品图')} | ${context.noBrandAssets ? 'n/a' : '待确认'} | ${context.noBrandAssets ? 'not-needed' : 'defined'} | ${normalizePathForMarkdown(imageLine)} |
| UI 图 | ${normalizePathForMarkdown(context.starterId === 'ops-dashboard' ? '如需现有界面截图再补' : '无必需 UI 截图')} | ${context.starterId === 'ops-dashboard' ? '待确认' : 'n/a'} | ${context.starterId === 'ops-dashboard' ? 'defined' : 'not-needed'} |  |
| 摄影 / 插图 | ${normalizePathForMarkdown(context.noRealImages ? '无' : '按任务需要补真实图片或插图')} | ${context.noRealImages ? 'n/a' : '待确认'} | ${context.noRealImages ? 'not-needed' : 'defined'} | ${normalizePathForMarkdown(imageLine)} |
| 色板 / 字体 | ${normalizePathForMarkdown(`${context.defaults.theme ?? 'starter-default'} 对应的默认 tokens`)} | implementation | defined | 先锁定 starter 默认组合，再按页面细化 |
| 动效节奏 | ${normalizePathForMarkdown('一段关键 reveal / 状态反馈 / 滚动节奏，按审美主张控制复杂度')} | implementation | defined | 不到处散落无意义 hover |
| 背景 / 表面 | ${normalizePathForMarkdown(`${context.defaults.theme ?? 'starter-default'} 对应表面预设`)} | implementation | defined | 背景和纹理服务内容，不替代真实素材 |
| 构图记忆点 | ${normalizePathForMarkdown(context.selectedDirection?.memoryPoint ?? '按当前方向继续补记忆点')} | implementation | defined | 进入 Patch Mode 时优先保住 |

${fetchedImageRows.length > 0 ? `
## 已补真实图片

| 类型 | 资产 | 来源 | 状态 | 备注 |
| --- | --- | --- | --- | --- |
${fetchedImageRows.join('\n')}
` : ''}

## 冻结变量

- lens: ${context.defaults.lens ?? context.starterId}
- theme: ${context.defaults.theme ?? '待补'}
- layout: ${context.defaults.layout ?? '待补'}
- aesthetic: ${normalizePathForMarkdown(context.selectedDirection?.aesthetic ?? '待补')}
- memory-point: ${normalizePathForMarkdown(context.selectedDirection?.memoryPoint ?? '待补')}
${imageBundle?.succeeded ? `- image-query: ${normalizePathForMarkdown(imageBundle.query)}\n- image-manifest: ${normalizePathForMarkdown(imageBundle.relativeManifestPath ?? '待补')}` : ''}
`;
}

function buildGenericImagePreflight(context) {
  const imageBundle = context.imageBundle ?? null;
  const imageDependent = isRealImageDependentStarterContext({ id: context.starterId }, context);
  if (context.noRealImages) {
    return `# Image Preflight

| 问题 | 回答 |
| --- | --- |
| 真实图片是不是页面成立前提 | 不是。当前页面以排版、信息层级和结构节奏成立。 |
| 必需图片类型 | 无必需图片。 |
| 计划来源 | 不引入外部图库或实拍。 |
| 缺失风险 | 如果强行加占位图，会把页面带偏成展示页或营销页。 |
| 降级方案 | 维持纯文字、标签、数据卡和结构块的内容型表达。 |
`;
  }
  if (imageBundle?.succeeded) {
    return `# Image Preflight

| 问题 | 回答 |
| --- | --- |
| 真实图片是不是页面成立前提 | 是，这一版已经按内容主题补齐首批真实图片。 |
| 必需图片类型 | 主视觉图、内容卡片图或证明性配图。 |
| 计划来源 | Wikimedia Commons（query: ${normalizePathForMarkdown(imageBundle.query)}） |
| 当前结果 | 已补 ${imageBundle.assets.length} 张，详见 \`asset-spec.md\` 与 ${normalizePathForMarkdown(imageBundle.relativeManifestPath ?? 'manifest.json')}。 |
| 缺失风险 | 若后续替换成不相关图片，会削弱页面的主题可信度。 |
| 降级方案 | 若远程图片失效，保留当前本地缓存文件；若缓存也不可用，再退回清楚的结构化占位。 |
`;
  }
  if (imageDependent) {
    return `# Image Preflight

| 问题 | 回答 |
| --- | --- |
| 真实图片是不是页面成立前提 | 大概率是。当前页面更像导览、展览、地点或实物内容页。 |
| 必需图片类型 | 主视觉图、路线/展项/主题配图，或能证明场景真实性的辅助图。 |
| 计划来源 | 优先补与页面主题直接相关的真实图片；starter 会优先尝试自动补 Wikimedia Commons 图片。 |
| 缺失风险 | 如果只有结构没有真实图，页面会明显空心，用户也更难快速相信主题内容。 |
| 降级方案 | 若暂时缺图，先保留清楚的图片位和来源计划，不要把它伪装成已经完整的营销页。 |
`;
  }
  return `# Image Preflight

| 问题 | 回答 |
| --- | --- |
| 真实图片是不是页面成立前提 | 需要按任务继续判断。 |
| 必需图片类型 | 结合页面主题补充。 |
| 计划来源 | 当前待确认；若页面主题更接近地点、馆藏、展览、旅行或实物导览，starter 会优先尝试自动补 Wikimedia Commons 图片。 |
| 缺失风险 | 若图片实际上是内容前提但未补齐，页面会空心化。 |
| 降级方案 | 明确标注待补图片，并在实现前继续补事实与素材。 |
`;
}

function buildGenericDirectionPlan(starter, context) {
  const lines = starter.directions.map((direction) => `| ${direction.label} | ${direction.logic} | ${direction.lens} | ${direction.theme} | ${direction.layout} | ${normalizePathForMarkdown(direction.aesthetic ?? `${context.brief} 下刻意拉开气质和信息组织方式`)} | ${normalizePathForMarkdown(direction.memoryPoint ?? '当前方向的首屏视觉锚点和任务路径')} | ${normalizePathForMarkdown(`${context.brief} 下刻意拉开气质和信息组织方式`)} | ${normalizePathForMarkdown(direction.suitable)} | ${normalizePathForMarkdown(direction.risk)} |`);
  return `# Direction Plan

| 方向 | 生成逻辑 | lens | theme | layout | 审美主张 | 记忆点 | 为什么不同 | 适用场景 | 主要风险 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${lines.join('\n')}
`;
}

function buildGenericSelectedDirection(starter) {
  const selected = starter.selectedDirection;
  return `# Selected Direction

- selected: ${selected.label}
- reason: 优先沿 starter 默认组合落地，减少空白工作区从设计合同跳到真实页面时的摇摆。
- lens: ${selected.lens}
- theme: ${selected.theme}
- layout: ${selected.layout}
- aesthetic: ${normalizePathForMarkdown(selected.aesthetic ?? '当前方向需要在实现前补充审美主张')}
- memory-point: ${normalizePathForMarkdown(selected.memoryPoint ?? '当前方向需要在实现前补充记忆点')}
- components:
${selected.components.map((component) => `  - ${component}`).join('\n')}
- follow-up risks:
  - 进入实现时继续控制信息密度，避免局部突然换轨
  - 页面文案要保留当前任务语气，不要把模板示例话术原样带入交付
  - 进入 Patch Mode 前用 anti-slop 自检，避免回到通用字体、紫白渐变或均匀卡片堆叠
`;
}

const BASIC_DOC_FILENAMES = [
  'file-structure.md',
  'app-flow.md',
  'prd.md',
  'frontend-guidelines.md',
  'backend-structure.md',
  'tech-stack.md',
];

function buildBasicDocMap(projectRoot, starter, context, relativeOutputPath) {
  const projectName = path.basename(projectRoot);
  const sections = [...context.sections];
  while (sections.length < 4) {
    sections.push(`模块 ${sections.length + 1}`);
  }
  const docs = {
    'file-structure.md': `# 项目文件结构

## 项目定位

这是一个单页静态前端原型工作区，当前交付物是根目录下可直接打开的 \`${relativeOutputPath}\`，用于展示“${context.displayTitle}”。

## 核心目录

- \`${relativeOutputPath}\`: 当前项目唯一页面入口，包含结构、样式和轻量交互。
- \`docs/basic/\`: 项目基础事实文档，记录结构、流程、产品边界、技术栈与前端约束。
- \`.openprd/design/active/\`: 本次页面实现使用的设计合同，包括事实、素材、方向与选中方案。
- \`.openprd/\`: OpenPrd 工作区元数据、校验规则、模板与质量报告。
- \`AGENTS.md\`: 当前仓库的执行入口约束。

## 文件组织规则

- 新增文件时，应同步确认所在文件夹说明书是否需要更新。
- 跨模块移动文件时，应更新本文件中的目录结构和职责说明。
- 当前项目默认优先保持单文件 HTML 原型；只有出现明确复用边界或复杂交互时，才考虑拆分 CSS、JS 或多页面结构。

## 维护规则

- 每次新增、删除、移动目录或核心文件后，必须检查并更新本文件。
- 本文档只记录项目结构事实，不承载具体功能需求细节。
`,
    'app-flow.md': `# 产品流程说明

## 核心流程

用户打开 \`${relativeOutputPath}\` 后，先在首屏判断这页是否正好服务于当前任务，再沿着 ${sections.join('、')} 继续浏览或操作。

## 用户路径

- 进入页面后先看首屏摘要与主动作，确认这页提供的核心价值。
- 再按 ${sections[0]}、${sections[1]}、${sections[2]} 的顺序完成浏览、筛选或判断。
- 最后通过 ${sections[3]} 收尾，决定是否继续深入、订阅或执行下一步动作。

## 状态变化

- 默认状态: 页面直接展示完整静态内容，不依赖登录、接口加载或异步占位。
- 浏览状态: 用户通过站内锚点、按钮或浏览器自然滚动切换关注区块。
- 异常状态: 当前版本不引入远程数据或表单提交结果；若后续接入真实数据、订阅或表单，再补充失败与恢复路径。

## 维护规则

- 每次用户流程、页面跳转、任务状态或异常处理发生变化后，必须检查并更新本文件。
`,
    'prd.md': `# 产品逻辑说明

## 问题与目标

当前项目要解决的问题是：在空白工作区里快速交付一页可直接打开、结构完整、气质稳定的“${context.displayTitle}”，而不是停留在模板占位或概念描述。

## 用户故事

- 作为需要快速验证界面方向的使用者，我希望直接打开页面就能看到 ${sections.join('、')}，从而判断这版结构和值不值得继续细化。

## 功能范围

- 当前版本包含: 单文件静态页面入口、${sections.join('、')}、与本页对应的设计合同和基础文档。
- 当前版本不包含: 后端服务、真实数据接线、账号体系、持久化存储和 SEO 运营体系。

## 验收标准

- 页面可以直接在浏览器打开，不依赖构建命令。
- 首屏和主要区块都已替换成真实内容，不残留模板占位。
- \`docs/basic/\`、设计合同、文件说明书和文件夹 README 与当前页面事实保持一致。

## 维护规则

- 每次需求边界、用户故事、验收标准发生变化后，必须检查并更新本文件。
`,
    'frontend-guidelines.md': `# 前端开发规范

## 适用范围

适用于当前 ${context.displayTitle} 的结构、样式、交互和后续同类静态页面扩展。

## 界面结构

- 当前页面采用单文件 HTML 结构，直接在 \`${relativeOutputPath}\` 中维护语义化分区、样式和轻量交互。
- \`design-starter\` 产出后立即进入 \`Patch Mode\`：后续实现必须继续在这个入口文件上补丁修改；如果结构要大改，也是在当前文件里重排或整页覆盖，不删除重起。
- 如果后续用户提供效果图、设计稿或参考图，优先以参考图为准；只有现有 starter、theme、layout 足够接近时才继续沿用。
- 如果确实要整页重写，先写 sibling draft，再覆盖回 \`${relativeOutputPath}\`，不要让正式入口在重写过程中缺失。
- starter 一落地后，只允许做一轮就地对焦：快速读一次生成的入口文件和必要的 active design artifacts；这轮对焦结束后，下一步就必须是真实写入口，不要再回头搜网页、翻 \`docs/basic/\` 或继续模板漫游。
- 把最后一批必要的查事实、查图、读模板动作放在口头宣布之前做完；一旦已经说“开始覆盖入口文件”或“开始整页重写”，下一步必须是对 \`${relativeOutputPath}\` 或 sibling draft 的实际写入，不要继续只读扫描、压图或停在口头承诺；必要时 hook 会把这类非写入动作挡回去。
- 主要区块固定为: ${sections.join('、')}。
- 当前视觉方向锁定为 \`${context.defaults.lens ?? starter.id}\`，主题采用 \`${context.defaults.theme ?? 'starter-default'}\`，页面骨架采用 \`${context.defaults.layout ?? 'starter-layout'}\`。
- 当前审美主张和记忆点记录在 \`.openprd/design/active/selected-direction.md\`；后续样式细化必须保住这个气质，而不是回到通用模板。
- 进入样式细化前，用 \`.openprd/design/anti-slop.md\` 排除默认紫白渐变、通用字体栈、白底卡片堆叠和无语境装饰。
- 优先使用稳定的信息层级、卡片、标签、导航锚点和纯文字表达；不通过花哨装饰替代真实结构。

## 交互规范

- 默认优先使用站内锚点、浏览器原生滚动和轻量按钮反馈，保持可预测的浏览体验。
- 文案语气面向普通用户，优先说明这页能做什么、应该先看哪里、下一步怎么做。
- 移动端优先保证信息顺序正确，其次才是装饰层次；当布局收窄时，所有网格应自然降到单列。
- 如果页面本来不依赖外部事实、品牌素材或真实图片，就保持这种轻依赖结构，不为了“更像正式页面”强行补灰块或假素材。
- \`Patch Mode\` 完成的最低标准是：入口文件本体已经改完，主要占位或“待补”文案已清掉，已准备好的真实图片或参考约束已经真正落进页面。

## 维护规则

- 每次新增界面模式、组件规范或交互规则后，必须检查并更新本文件。
`,
    'backend-structure.md': `# 后端架构设计

## 适用范围

当前项目是单页静态前端原型，不提供后端服务、数据库或远程处理链路。本文件用于明确哪些后端能力当前不适用。

## 服务边界

- 不适用。当前没有独立服务、任务队列、数据存储或外部依赖。
- 页面内的交互保持在浏览器本地，不构成后端服务边界。

## CLI 接入面

- 业务功能层面不提供 CLI。
- 研发层面使用 OpenPrd 工具链辅助初始化、设计合同、标准校验和项目管理；当前最相关的入口包括 \`openprd design-starter\`、\`openprd standards . --verify\`、\`openprd run . --verify\` 与 \`openprd quality . --verify\`。

## API 接入面

- 不适用。当前版本没有 HTTP、RPC、WebSocket 或内部服务接口。
- 如果后续接入真实数据、账号体系或提交动作，应在此补充接口协议、数据结构、身份边界和失败路径。

## 数据流

- 输入: 用户在浏览器中直接打开 \`${relativeOutputPath}\`，并按页面结构浏览或触发轻量交互。
- 处理: 前端在本地渲染结构、样式与轻量状态，不经过远程服务。
- 输出: 浏览器直接展示完整页面；当前项目不做服务端存储或远程提交。

## 维护规则

- 每次服务边界、CLI/API 接入契约、数据流、存储或外部依赖发生变化后，必须检查并更新本文件。
`,
    'tech-stack.md': `# 项目技术栈

## 运行环境

- 浏览器直接打开静态 HTML 文件即可运行。
- 当前页面基于原生 HTML、CSS 和轻量内联脚本，不依赖前端框架或打包工具。

## 核心依赖

- 无业务第三方依赖。
- 研发辅助依赖为 OpenPrd 工作区与其内置设计模板、标准校验和质量检查能力。

## 工具链

- \`openprd design-starter . --starter ${starter.id} --out ${relativeOutputPath}\`: 生成首版页面、设计合同与基础文档。
- \`openprd standards . --verify\`: 校验 \`docs/basic/\`、文件说明书和文件夹 README。
- \`openprd run . --verify\`: 汇总当前任务与工作区验证状态。
- \`openprd quality . --verify\`: 生成质量报告并给出当前证据门禁状态。

## 维护规则

- 每次新增、移除或升级核心依赖、运行时和工具链后，必须检查并更新本文件。
`,
  };

  return docs;
}

function looksLikePlaceholderDoc(text) {
  const normalized = String(text ?? '');
  return normalized.includes('待补充:') || normalized.includes('## 适用范围\n\n说明') || normalized.includes('## 核心流程\n\n描述产品从入口到完成目标的主要流程。');
}

async function maybeWriteBasicDoc(filePath, text) {
  const current = await readText(filePath).catch(() => null);
  if (current && !looksLikePlaceholderDoc(current)) {
    return false;
  }
  await writeText(filePath, text);
  return true;
}

async function resolveRootFolderManualPath(projectRoot) {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const packageJson = await readText(packageJsonPath).then((text) => JSON.parse(text)).catch(() => null);
  const moduleName = normalizeModuleName(packageJson?.name ?? path.basename(projectRoot), normalizeModuleName(path.basename(projectRoot)));
  const folderName = normalizeModuleName(path.basename(projectRoot), moduleName);
  return path.join(projectRoot, `${moduleName}_${folderName}_README.md`);
}

function buildRootFolderManual(starter, context, relativeOutputPath) {
  const folderLabel = path.basename(relativeOutputPath);
  const sectionSummary = context.sections.join('、');
  return `# 文件夹说明书

## 核心功能

当前根目录承载一个可直接打开的 ${context.displayTitle} 原型，以及支撑该页面交付的基础文档和 OpenPrd 工作区元数据。

## 输入

- 用户的页面需求、主题和结构约束。
- 浏览器对 \`${folderLabel}\` 的直接访问。
- 研发过程中的设计合同、标准校验和质量检查结果。

## 输出

- 可直接在浏览器打开的静态页面入口文件。
- 记录项目结构、流程、产品边界、前端约束和技术栈的基础文档。
- 与 ${sectionSummary} 对应的设计合同和质量校验记录。

## 定位

这是当前项目的主工作目录，既包含最终交付页面，也包含保证页面可维护的最小文档底座；当前没有独立源码子模块或后端工程。

## 依赖

- \`${relativeOutputPath}\`
- \`docs/basic/\`
- \`.openprd/\`
- \`AGENTS.md\`

## 维护规则

- 每次新增、删除、移动文件或改变根目录职责后，必须检查并更新本 README。
- 后续页面实现必须继续沿用 \`${relativeOutputPath}\` 这个入口文件，并把它视为 \`Patch Mode\` 的稳定基座；如果要大改结构，也是在原文件上调整或整页覆盖，不删除后另起新稿。
- 如果后续用户给了效果图、设计稿或参考图，以这些参考作为最终裁决；样式库和 starter 只负责提供最近的实现路径。
- 如果确实要整页重写，先把完整新稿写到 sibling draft，再覆盖回 \`${relativeOutputPath}\`；不要让正式入口在过渡阶段消失。
- starter 一落地后，只允许做一轮就地对焦：快速读一次生成的入口文件和必要的 active design artifacts；这轮对焦结束后，下一步就必须是真实写入口，不要再回头搜网页、翻 \`docs/basic/\` 或继续模板漫游。
- 把最后一批必要的查事实、查图、读模板动作放在口头宣布之前做完；一旦已经说“开始覆盖入口文件”或“开始整页重写”，下一步必须是对 \`${relativeOutputPath}\` 或 sibling draft 的实际写入，不要继续只读扫描、压图或停在口头承诺；必要时 hook 会把这类非写入动作挡回去。
- 页面结构、交付方式或事实边界变化时，必须同步更新 \`docs/basic/\` 与相关设计合同。
`;
}

async function hydrateWorkspaceBasics(projectRoot, starter, context, relativeOutputPath) {
  const docMap = buildBasicDocMap(projectRoot, starter, context, relativeOutputPath);
  const docsDir = path.join(projectRoot, 'docs', 'basic');
  const updatedDocs = [];
  for (const fileName of BASIC_DOC_FILENAMES) {
    const didWrite = await maybeWriteBasicDoc(path.join(docsDir, fileName), docMap[fileName]);
    if (didWrite) {
      updatedDocs.push(`docs/basic/${fileName}`);
    }
  }

  const folderManualPath = await resolveRootFolderManualPath(projectRoot);
  const folderManualExists = await exists(folderManualPath);
  if (!folderManualExists) {
    await writeText(folderManualPath, buildRootFolderManual(starter, context, relativeOutputPath));
  }

  return {
    updatedDocs,
    folderManualCreated: !folderManualExists,
    folderManualPath: path.relative(projectRoot, folderManualPath) || path.basename(folderManualPath),
  };
}

async function writeActiveDesignArtifacts(ws, starter, context) {
  await writeText(ws.paths.designFactsSheet, buildGenericFactsSheet(context));
  await writeText(ws.paths.designAssetSpec, buildGenericAssetSpec(context));
  await writeText(ws.paths.designImagePreflight, buildGenericImagePreflight(context));
  await writeText(ws.paths.designDirectionPlan, buildGenericDirectionPlan(starter, context));
  await writeText(ws.paths.designSelectedDirection, buildGenericSelectedDirection(starter));
}

function replaceLiteralPlaceholders(templateText, replacements) {
  let text = templateText;
  for (const [placeholder, value] of Object.entries(replacements)) {
    text = text.replaceAll(placeholder, value);
  }
  return text;
}

const CONTENT_HOME_GUIDE_RE = /(?:museum|gallery|exhibition|travel|traveler|guide|tour|destination|city|wildlife|birdwatch|species|forest|rainforest|wetland|reserve|heritage|馆藏|展览|博物馆|导览|旅行|旅游|城市|自然|观鸟|物种|雨林|湿地|保护区)/iu;
const CONTENT_HOME_STORY_RE = /(?:brand|story|narrative|case study|case|品牌故事|专题故事|案例|访谈)/iu;
const CONTENT_HOME_BLOG_RE = /(?:blog|newsletter|writing|article|博客|写作|专栏|作者|独立开发者)/iu;

function buildStarterContentHaystack(context) {
  return [
    context?.displayTitle,
    context?.brief,
    ...(Array.isArray(context?.sections) ? context.sections : []),
  ]
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

function findMatchingSection(sections, patterns, fallbackIndex = 0, options = {}) {
  if (!Array.isArray(sections) || sections.length === 0) {
    return null;
  }
  const list = options.fromEnd ? [...sections].reverse() : sections;
  for (const pattern of patterns) {
    const match = list.find((section) => pattern.test(String(section ?? '').trim()));
    if (match) {
      return match;
    }
  }
  const safeIndex = Math.min(Math.max(fallbackIndex, 0), sections.length - 1);
  return sections[safeIndex] ?? sections[0] ?? null;
}

function inferContentHomeEyebrow(context) {
  const haystack = buildStarterContentHaystack(context);
  if (CONTENT_HOME_GUIDE_RE.test(haystack)) {
    return '专题导览首页';
  }
  if (CONTENT_HOME_STORY_RE.test(haystack)) {
    return '故事型内容首页';
  }
  if (CONTENT_HOME_BLOG_RE.test(haystack)) {
    return '内容型首页';
  }
  return '内容入口首页';
}

function buildSectionActionLabel(section, fallback = '继续查看') {
  const label = String(section ?? '').trim();
  if (!label || /^(下一步动作|最终动作|更多内容)$/.test(label)) {
    return fallback;
  }
  if (/订阅/.test(label)) {
    return '订阅后续更新';
  }
  if (/预约|报名/.test(label)) {
    return `查看${label}`;
  }
  if (/门票/.test(label)) {
    return '查看门票信息';
  }
  if (/^(查看|进入|浏览|探索|订阅|预约|报名|加入|了解|开始|前往)/.test(label)) {
    return label;
  }
  if (/入口$/.test(label)) {
    return `进入${label.replace(/入口$/, '') || fallback}`;
  }
  if (label.length <= 10) {
    return `查看${label}`;
  }
  return fallback;
}

function buildContentHomeMediaLabel(section, suffix) {
  const label = String(section ?? '').trim() || '主题';
  return `${label}${suffix}`;
}

function hydrateContentHomeTemplate(templateText, context) {
  const sections = [...context.sections];
  while (sections.length < 5) {
    sections.push(`内容模块 ${sections.length + 1}`);
  }
  const laterSections = sections.slice(1);
  const guideLike = CONTENT_HOME_GUIDE_RE.test(buildStarterContentHaystack(context));
  const primarySection = sections[0];
  const browseSection = findMatchingSection(
    laterSections,
    [/(关键|主题|楼层|浏览|导览|栏目|分区|目录|馆藏|物种|案例|故事|文章)/iu],
    0,
  ) ?? sections[1];
  const preparationSection = findMatchingSection(
    laterSections,
    [/(装备|准备|提醒|预约|门票|时段|报名|清单|须知|到访)/iu],
    Math.min(1, laterSections.length - 1),
  ) ?? sections[Math.min(2, sections.length - 1)];
  const timelineSection = findMatchingSection(
    laterSections,
    [/(路线|准备|预约|门票|时段|流程|报名|清单|到访)/iu],
    Math.min(1, laterSections.length - 1),
  ) ?? preparationSection;
  const closingSection = findMatchingSection(
    sections,
    [/(订阅|预约|报名|门票|联系|加入|开始|入口|购买|下载)/iu],
    sections.length - 1,
    { fromEnd: true },
  ) ?? sections[sections.length - 1];
  const eyebrow = inferContentHomeEyebrow(context);
  const leadLine = guideLike
    ? `这页围绕${context.brief}展开：先把${primarySection}放到最前，再把${browseSection}、${preparationSection}和${closingSection}串成一条清楚的导览路径。`
    : `这页围绕${context.brief}展开：先把${primarySection}放到首屏，再把${browseSection}、${preparationSection}和${closingSection}串成一条清楚的浏览路径。`;
  const visualHintCopy = context.imageBundle?.succeeded
    ? `这一块先用真实图片把主题钉住，再让文案解释从${primarySection}到${closingSection}的浏览顺序。`
    : guideLike
      ? '这一块要让人一眼看懂页面围绕什么地点、主题或观察对象展开，别退回通用 hero。'
      : '这一块要先让人看懂页面主题和入口关系，不要只堆气氛。';
  const text = replaceLiteralPlaceholders(templateText, {
    '<title>内容型首页模板</title>': `<title>${escapeHtml(context.htmlTitle)}</title>`,
    '内容型首页模板': eyebrow,
    '[品牌名 / 首页主题]': escapeHtml(context.displayTitle),
    '[这里放一句能说明这次首页体验目标的引导文案。它应该同时带出内容气质、用户第一步动作和页面的核心价值。]': escapeHtml(leadLine),
    '[主动作]': buildSectionActionLabel(primarySection, '开始浏览'),
    '[次动作]': buildSectionActionLabel(closingSection, '继续查看'),
    '[关键事实]': `${sections.length} 个内容模块`,
    '[事实说明或时间/价格/地点]': guideLike
      ? '首屏先解决“先看什么、怎么准备、下一步去哪”这 3 个问题。'
      : `从首屏到尾段都围绕${primarySection}组织，不让用户先被营销语气绊住。`,
    '[模块入口]': primarySection,
    '[说明该入口为什么重要]': `先从${primarySection}进入，再决定要不要继续看${browseSection}。`,
    '[准备事项]': preparationSection,
    '[到访提醒 / 条件 / 风险]': `把${preparationSection}提前说明，避免用户翻到后面才发现关键条件。`,
    '[内容型封面区 / 示意图 / 地图 / 馆藏编号]': guideLike ? `${primarySection} / ${browseSection}` : `${primarySection} 内容导览`,
    '[用纸张、纹理、编号、导览标签或卡片秩序承接气质]': guideLike
      ? `用导览标签、地点线索和清楚的卡片层级，把${primarySection}与${browseSection}连起来。`
      : `用标签、分组和稳定留白，把${primarySection}到${closingSection}的关系讲清楚。`,
    '[这里不必是真实摄影，但要有清楚的内容暗示]': visualHintCopy,
    '[避免把它做成通用 SaaS hero]': guideLike
      ? '首屏重点是先认出主题与入口，不要套成通用 SaaS hero。'
      : '首屏重点是先知道从哪进入，再决定是否继续深入。',
    '[今日推荐 / 值得先看的内容]': primarySection,
    '[这里解释这一组内容是按什么逻辑排序，帮助用户快速进入当前主题。]': escapeHtml(`${primarySection}排在最前，是为了让第一次进入的人先抓住这一页今天最重要的线索。`),
    '[推荐项一]': primarySection,
    '[推荐项二]': browseSection,
    '[推荐项三]': preparationSection,
    '[一句说明内容价值、位置或推荐理由。]': '每一张卡片都对应一个清楚入口，帮助用户从浏览快速过渡到下一步动作。',
    '[楼层 / 栏目 / 导览分区]': browseSection,
    '[用清楚的浏览结构告诉用户怎么从“看什么”过渡到“怎么去”。]': `用${browseSection}把首屏内容串起来，让用户知道接下来该往哪一组继续看。`,
    '[路线 / 门票 / 到访准备]': timelineSection,
    '[把行动入口放在内容之后，但别藏得太深。]': `把${timelineSection}放在中段，等用户理解主题后再自然进入下一步动作。`,
    '[从浏览到出发的时间轴]': guideLike ? '从浏览到出发前确认' : '从进入首页到下一步动作',
    '[适合路线规划、参观准备、报名、到访前后流程这类需要顺序感的内容。]': `把${primarySection}、${browseSection}和${closingSection}排成顺序，减少第一次进入时的犹豫。`,
    '[步骤一]': `先看${primarySection}，快速知道这页最值得先关注什么。`,
    '[步骤二]': `再用${browseSection}和${timelineSection}补齐判断和准备信息。`,
    '[步骤三]': `最后进入${closingSection}，把这次访问接成真正的下一步动作。`,
    '[最后一段转化区标题]': closingSection,
    '[用一句人话把内容价值和下一步动作收拢起来。]': `如果这页刚好帮你把${primarySection}到${closingSection}的脉络看清了，就顺手进入${closingSection}，把下一步接上。`,
    '[确认动作]': buildSectionActionLabel(closingSection, '继续查看'),
  });
  return replaceLiteralPlaceholders(text, {
    '[视觉锚点媒体]': buildMediaMarkup(pickImageAsset(context.imageBundle?.assets, 0), buildContentHomeMediaLabel(primarySection, '主视觉待补')),
    '[推荐媒体一]': buildMediaMarkup(pickImageAsset(context.imageBundle?.assets, 0), buildContentHomeMediaLabel(primarySection, '配图待补')),
    '[推荐媒体二]': buildMediaMarkup(pickImageAsset(context.imageBundle?.assets, 1), buildContentHomeMediaLabel(browseSection, '配图待补')),
    '[推荐媒体三]': buildMediaMarkup(pickImageAsset(context.imageBundle?.assets, 2), buildContentHomeMediaLabel(preparationSection, '配图待补')),
  });
}

function hydrateProductLaunchTemplate(templateText, context) {
  const sections = [...context.sections];
  while (sections.length < 4) {
    sections.push(`重点模块 ${sections.length + 1}`);
  }
  const text = replaceLiteralPlaceholders(templateText, {
    '<title>产品发布页模板</title>': `<title>${escapeHtml(context.htmlTitle)}</title>`,
    '[产品名 / 发布主题]': escapeHtml(context.displayTitle),
    '[用一句直接的话讲清楚这次发布带来的变化、面向的人群，以及为什么现在值得点进去。]': escapeHtml(`这页围绕${context.brief}展开，先讲清楚变化，再给出证据、范围和下一步动作。`),
    '[主动作]': '查看重点变化',
    '[次动作]': '了解上线范围',
    '[版本 / 日期]': '当前版本',
    '[把核实过的事实放这里]': context.noExternalFacts ? '当前页先以内建发布信息为准。' : '这里优先放已经核实过的发布事实。',
    '[谁最该看这一页]': sections[2],
    '[把发布信息、受众和动作收成一句清楚的人话。]': `先让${sections[2]}知道这次变化与自己相关，再决定是否继续深入。`,
    '[核心收益]': sections[1],
    '[一句可感知的提升]': '把这次变化说成用户能感知到的提升，而不是内部实现细节。',
    '[最终动作]': sections[3],
    '[一句说明它带来的变化]': '最后把上线信息、适用范围和下一步动作收成一个稳定出口。',
    '[用真实产品图、关键界面，或至少清楚的产品结构示意，不要只放情绪渐变]': '优先放结构示意、数据、界面证据或范围说明。',
    '[这次发布的 3 个重点]': sections[0],
    '[适合把功能、能力、权益或体验升级拆成三个可扫描模块。]': '重点模块先可扫描，再展开细节。',
    '[重点一]': `${sections[0]}之一`,
    '[重点二]': `${sections[0]}之二`,
    '[重点三]': `${sections[0]}之三`,
    '[用证据讲，不只用形容词讲]': '证据要先于形容词。',
    '[证据块一]': '范围与适用对象',
    '[证据块二]': '交付形式与时间',
    '[证据块三]': '风险与限制说明',
    '[这里放规格、案例、截图、兼容范围、交付方式或上线信息。]': '把规格、范围、示例和上线方式放进这一段，避免用户只看到氛围看不到事实。',
    '[收尾 CTA 标题]': sections[3],
    '[适用对象]': sections[2],
    '[数据 / 截图 / 规格 / 范围]': '范围、规格与证据',
  });
  return replaceLiteralPlaceholders(text, {
    '[主视觉媒体]': buildMediaMarkup(pickImageAsset(context.imageBundle?.assets, 0), '主视觉图片待补'),
    '[证据媒体一]': buildMediaMarkup(pickImageAsset(context.imageBundle?.assets, 0), '证据图片待补'),
    '[证据媒体二]': buildMediaMarkup(pickImageAsset(context.imageBundle?.assets, 1), '证据图片待补'),
    '[证据媒体三]': buildMediaMarkup(pickImageAsset(context.imageBundle?.assets, 2), '证据图片待补'),
  });
}

function hydrateOpsDashboardTemplate(templateText, context) {
  const sections = [...context.sections];
  while (sections.length < 5) {
    sections.push(`工作区块 ${sections.length + 1}`);
  }
  return replaceLiteralPlaceholders(templateText, {
    '<title>运营工作台模板</title>': `<title>${escapeHtml(context.htmlTitle)}</title>`,
    '[工作台 / 系统名]': escapeHtml(context.displayTitle),
    '运营工作台模板': '内容发布工作台',
    '[本页标题]': sections[0],
    '[一句说明这页帮助用户每天更快做什么。]': escapeHtml(`这页围绕${context.brief}展开，把判断、对象和下一步动作放在同一视图里。`),
    '[筛选 / 时间范围 / 当前状态]': '最近 7 天 / 全部状态 / 我负责的',
    '[当前模块]': sections[0],
    '[把判断和下一步放在同一视图里。]': '先让人知道要看哪一块，再决定下一步要点什么。',
    '[总览标签一]': sections[2],
    '[总览标签二]': '待发布负荷',
    '[总览标签三]': sections[3],
    '[总览标签四]': sections[4],
    '[指标一]': '5 篇排期内',
    '[指标二]': '2 篇卡在封面',
    '[指标三]': '+38 净订阅',
    '[指标四]': '3 个题目待拍板',
    '[指标说明一]': '这周已排进日历的内容够不够支撑稳定更新，先在这里看清。',
    '[指标说明二]': '如果“差一点就能发”的稿子堆太多，优先把它们推过终点。',
    '[指标说明三]': '订阅变化不只是涨跌，更是判断最近内容方向有没有被接住。',
    '[指标说明四]': '题目池保持轻量，避免同时开太多新坑。',
    '[待处理动作]': sections[0],
    '[把用户最常扫的对象放在左边。]': '左边先放最高频需要扫的对象和队列。',
    '[主要列表 / 队列]': sections[1],
    '[对象一]': '《六月内容排期复盘》',
    '[对象二]': '《把周报做成可复用资产》',
    '[对象三]': '《本周产品随手记》',
    '[状态一]': '待补导语',
    '[状态二]': '待改标题',
    '[状态三]': '待二次复核',
    '[动作一标签]': '今晚 20:00 发布',
    '[动作二标签]': '明早交给自己复看',
    '[动作三标签]': '决定发还是归档',
    '[动作一]': '先推过最接近发布的两篇稿子',
    '[动作二]': '把本周指标和订阅变化一起看',
    '[动作三]': '再决定新题目要不要继续开',
    '[动作一说明]': '今天最值钱的动作不是写新东西，而是把差一点就能发的内容推过终点。',
    '[动作二说明]': '如果最近三篇内容都没有带来订阅响应，就先调方向，不要只补排期。',
    '[动作三说明]': '题目池如果已经过满，先砍掉不想写的，再决定要不要开新坑。',
    '[最近订阅变化]': sections[3],
    '[用近 7 天的订阅变化帮用户判断哪类内容值得继续发。]': '把最近净增、退订和来源线索放在一起看，帮助判断哪类内容更值得继续发。',
    '[变化项一]': '产品复盘类 +24',
    '[变化项二]': '工程方法类 +11',
    '[变化项三]': '日更碎片类 -6',
    '[变化说明一]': '净新增最高',
    '[变化说明二]': '打开率稳定',
    '[变化说明三]': '退订主要来源',
    '[变化备注一]': '说明“讲清怎么做判断”的内容，最近比“展示忙碌”更能留住人。',
    '[变化备注二]': '这类内容虽然增长慢一点，但回访读者更稳。',
    '[变化备注三]': '如果只是记录日常，而没有明确判断，订阅关系会更容易掉。',
    '[选题状态]': sections[4],
    '[把待写、待发和待放弃的题目放到同一块，避免开新坑太轻松。]': '把待写、待发和待放弃放在同一块，避免题目池越来越大但真正发出去的越来越少。',
    '[选题一]': 'AI 协作复盘: 继续写',
    '[选题二]': '播客摘要工具: 先暂停',
    '[选题三]': '六月发布节奏: 本周必须发',
    '[选题一说明]': '已有结构和例子，下一个动作是补一段最难讲清的判断过程。',
    '[选题二说明]': '方向不差，但暂时还没有足够强的个人经验，不急着占排期。',
    '[选题三说明]': '这是最适合承接当前订阅趋势的题目，不应该再往后拖。',
    '[模块二]': sections[1],
    '[模块三]': sections[3],
    '[模块四]': sections[4],
  });
}

function hydrateStarterTemplate(templateText, starter, context) {
  if (starter.id === 'content-home') {
    return hydrateContentHomeTemplate(templateText, context);
  }
  if (starter.id === 'product-launch') {
    return hydrateProductLaunchTemplate(templateText, context);
  }
  if (starter.id === 'ops-dashboard') {
    return hydrateOpsDashboardTemplate(templateText, context);
  }
  return templateText;
}

export async function designStarterWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  const starterKey = String(options.starter ?? 'content-home').trim();
  const starter = STARTER_LOOKUP.get(starterKey);

  if (!starter) {
    return {
      ok: false,
      action: 'design-starter',
      projectRoot,
      requestedStarter: starterKey,
      availableStarters: buildAvailableStarters(),
      errors: [
        `Unknown starter: ${starterKey}. Available starters: ${STARTER_CATALOG.map((item) => item.id).join(', ')}.`,
      ],
    };
  }

  const templatePath = path.join(ws.paths.designTemplatesRoot, starter.file);
  if (!(await exists(templatePath))) {
    return {
      ok: false,
      action: 'design-starter',
      projectRoot,
      starterId: starter.id,
      templatePath,
      availableStarters: buildAvailableStarters(),
      errors: [
        `Missing starter template: ${templatePath}. Run openprd update . first.`,
      ],
    };
  }

  const outputTarget = String(options.out ?? 'index.html').trim() || 'index.html';
  const outputPath = path.resolve(projectRoot, outputTarget);
  const relativeOutputPath = normalizePathForDisplay(path.relative(projectRoot, outputPath) || path.basename(outputPath));
  const alreadyExists = await exists(outputPath);

  if (alreadyExists && !options.force) {
    return {
      ok: false,
      action: 'design-starter',
      projectRoot,
      starterId: starter.id,
      templatePath,
      outputPath,
      relativeOutputPath,
      availableStarters: buildAvailableStarters(),
      errors: [
        `Output already exists: ${relativeOutputPath}. Use --force to overwrite.`,
      ],
    };
  }

  const rawTemplateText = await readText(templatePath);
  const defaults = parseStarterDefaults(rawTemplateText);
  const hydrated = shouldHydrateStarter(options);
  const context = hydrated ? buildStarterContext(starter, defaults, options) : null;
  if (context?.noRealImages && isRealImageDependentStarterContext(starter, context)) {
    return {
      ok: false,
      action: 'design-starter',
      projectRoot,
      starterId: starter.id,
      templatePath,
      outputPath,
      relativeOutputPath,
      availableStarters: buildAvailableStarters(),
      errors: [
        '当前 brief 更像导览、展览、旅行、自然观察或馆藏内容页，不建议带 `--no-real-images`。请去掉这个参数，让 starter 先尝试补首批真实图片；如果你确实只想做纯文字骨架，先在 `image-preflight.md` 明确“真实图片不是页面成立前提”和降级方案后再重试。',
      ],
    };
  }
  if (context) {
    context.themeConfig = await loadThemeConfig(ws.paths.designThemes, context.defaults.theme);
    context.imageBundle = await sourceStarterImages({
      projectRoot,
      outputPath,
      starter,
      context,
    });
  }
  const hydratedTemplateText = context ? hydrateStarterTemplate(rawTemplateText, starter, context) : rawTemplateText;
  const themeLockStyle = context
    ? buildThemeLockStyle({
      theme: context.themeConfig,
      projectRoot,
      outputPath,
    })
    : '';
  const finalTemplateText = context
    ? injectThemeLockStyle(`${buildHtmlFileManual(starter, context, relativeOutputPath)}\n${hydratedTemplateText}`, themeLockStyle)
    : rawTemplateText;

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await writeText(outputPath, finalTemplateText);
  let basicsResult = null;
  if (context) {
    await writeActiveDesignArtifacts(ws, starter, context);
    basicsResult = await hydrateWorkspaceBasics(projectRoot, starter, context, relativeOutputPath);
  }

  await appendWorkflowEvent(ws, 'design_starter_created', {
    starterId: starter.id,
    template: normalizePathForDisplay(path.relative(projectRoot, templatePath)),
    output: relativeOutputPath,
    defaults,
    overwritten: alreadyExists,
    hydrated,
    brief: context?.brief ?? null,
    sections: context?.sections ?? null,
    docsUpdated: basicsResult?.updatedDocs ?? [],
    fetchedImageCount: context?.imageBundle?.assets?.length ?? 0,
    imageQuery: context?.imageBundle?.query ?? null,
  });
  await appendProgress(ws, [
    `已从 ${starter.file} 创建第一版页面骨架。`,
    `输出: ${relativeOutputPath}。`,
    hydrated ? '已同步写实 active design contracts 并替换模板占位文案。' : null,
    context?.imageBundle?.succeeded ? `已自动补齐 ${context.imageBundle.assets.length} 张真实图片。` : null,
    basicsResult?.updatedDocs?.length ? '已同步补齐 docs/basic、文件说明书和根目录 README。' : null,
  ].filter(Boolean));

  return {
    ok: true,
    action: 'design-starter',
    projectRoot,
    starterId: starter.id,
    starterFile: starter.file,
    description: starter.description,
    templatePath,
    relativeTemplatePath: normalizePathForDisplay(path.relative(projectRoot, templatePath)),
    outputPath,
    relativeOutputPath,
    overwritten: alreadyExists,
    defaults,
    hydrated,
    activeArtifactsFilled: hydrated,
    brief: context?.brief ?? null,
    sections: context?.sections ?? null,
    title: context?.displayTitle ?? null,
    sourceManualFilled: hydrated,
    docsHydrated: basicsResult?.updatedDocs ?? [],
    folderManualCreated: basicsResult?.folderManualCreated ?? false,
    folderManualPath: basicsResult?.folderManualPath ?? null,
    imageQuery: context?.imageBundle?.query ?? null,
    fetchedImageCount: context?.imageBundle?.assets?.length ?? 0,
    fetchedImageManifestPath: context?.imageBundle?.relativeManifestPath ?? null,
    imageSourceReason: context?.imageBundle?.reason ?? null,
  };
}

export { STARTER_CATALOG };
