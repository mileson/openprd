/*
 * 核心功能
 * 为 design-starter 提供主题锁定、表面资产注入和 Wikimedia Commons 真实图片补充。
 *
 * 输入
 * 接收 starter 上下文、输出文件路径和工作区路径，并在需要时访问主题 catalog 与 Commons API。
 *
 * 输出
 * 返回主题样式片段、自动补图结果和可写回设计合同的图片元数据。
 *
 * 定位
 * 位于前端实现准备层，承接“选模板之后怎样真正吃到设计资产和真实图片”的运行时能力。
 *
 * 依赖
 * 依赖 fs-utils 读写 JSON、检查文件存在，并使用 Node 原生 fetch 下载远程图片。
 *
 * 维护规则
 * 新增 theme 字段、表面预设或图片来源策略时，优先在这里扩展，再回到 design-starter 调整占位映射。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';
import { exists, readJson, writeJson } from './fs-utils.js';

const REAL_IMAGE_HINT_RE = /(?:museum|gallery|exhibition|travel|traveler|guide|visitor guide|tour|destination|city|architecture|landscape|wildlife|birdwatch|species|heritage|cultural|park|island|coast|forest|rainforest|wetland|reserve|bird|parrot|zoo|aquarium|历史|文化|导览|馆藏|展览|博物馆|旅行|旅游|城市|建筑|风景|自然|野生|观鸟|物种|国家公园|海岛|海岸|雨林|湿地|保护区|动物园|水族馆)/iu;
const REAL_IMAGE_SKIP_RE = /(?:dashboard|ops|backstage|control center|cms|admin|blog|portfolio|saas|crm|工作台|后台|控制台|博客|作品集|内容发布|开发者|独立开发者)/iu;
const COMMONS_IMAGE_COUNT = 3;
const COMMONS_IMAGE_WIDTH = 1600;

const SURFACE_PRESETS = {
  'paper-grid': {
    asset: 'paper-grid.svg',
    bodyLayers: [
      'radial-gradient(circle at top left, rgba(191, 142, 108, 0.18), transparent 34%)',
      'linear-gradient(180deg, rgba(255, 251, 244, 0.96) 0%, var(--bg) 100%)',
    ],
    overlayOpacity: 0.4,
  },
  'dark-mesh': {
    asset: 'dark-mesh.svg',
    bodyLayers: [
      'radial-gradient(circle at top center, rgba(52, 211, 162, 0.14), transparent 26%)',
      'linear-gradient(180deg, rgba(7, 13, 20, 0.98) 0%, var(--bg) 100%)',
    ],
    overlayOpacity: 0.38,
  },
  'workbench-grid': {
    asset: 'workbench-grid.svg',
    bodyLayers: [
      'radial-gradient(circle at top left, rgba(47, 128, 237, 0.12), transparent 28%)',
      'linear-gradient(180deg, rgba(248, 250, 252, 0.96) 0%, var(--bg) 100%)',
    ],
    overlayOpacity: 0.32,
  },
};

function normalizePathForDisplay(filePath) {
  return String(filePath ?? '').replaceAll('\\', '/');
}

function decodeHtmlEntities(text) {
  return String(text ?? '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', '\'')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&nbsp;', ' ');
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function withAlpha(hexColor, alpha) {
  const normalized = String(hexColor ?? '').trim();
  const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return normalized;
  }
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function commonsApiBaseUrl() {
  return process.env.OPENPRD_COMMONS_API_BASE_URL?.trim() || 'https://commons.wikimedia.org/w/api.php';
}

function derivedQueryFromText(text) {
  const asciiWords = String(text ?? '')
    .match(/[A-Za-z0-9][A-Za-z0-9.+-]*/g) ?? [];
  const filteredAscii = asciiWords
    .map((word) => word.trim())
    .filter(Boolean)
    .filter((word) => !/^(a|an|the|and|for|with|home|page|homepage|landing|site|prototype|guide|app|web|build)$/i.test(word));
  if (filteredAscii.length >= 2) {
    return filteredAscii.slice(0, 6).join(' ');
  }
  return String(text ?? '')
    .replace(/(?:首页|页面|网站|原型|工作台|发布页|导览页|内容型|第一版|请直接实现|帮助|提供|用户|一版)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildStarterImageHaystack(context) {
  if (!context) {
    return '';
  }
  return [
    context.displayTitle,
    context.brief,
    ...(Array.isArray(context.sections) ? context.sections : []),
  ]
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

function isRealImageDependentStarterContext(starter, context) {
  if (!context || starter?.id === 'ops-dashboard') {
    return false;
  }
  const haystack = buildStarterImageHaystack(context);
  if (!haystack) {
    return false;
  }
  return REAL_IMAGE_HINT_RE.test(haystack);
}

function shouldAttemptStarterImages(starter, context) {
  if (!context || context.noRealImages || starter?.id === 'ops-dashboard') {
    return false;
  }
  const haystack = buildStarterImageHaystack(context);
  if (!haystack) {
    return false;
  }
  if (isRealImageDependentStarterContext(starter, context)) {
    return true;
  }
  return !REAL_IMAGE_SKIP_RE.test(haystack) && starter?.id === 'product-launch';
}

function deriveCommonsQuery(context) {
  const fromTitle = derivedQueryFromText(context?.displayTitle);
  if (fromTitle) {
    return fromTitle;
  }
  return derivedQueryFromText(context?.brief);
}

function normalizeTheme(theme) {
  if (!theme?.tokens) {
    return null;
  }
  return {
    ...theme,
    bodyFont: String(theme.bodyFont ?? '"Avenir Next", "Noto Sans SC", "PingFang SC", sans-serif'),
    headlineFont: String(theme.headlineFont ?? '"Avenir Next", "Noto Sans SC", "PingFang SC", sans-serif'),
    surfacePreset: String(theme.surfacePreset ?? 'paper-grid'),
  };
}

async function loadThemeConfig(themeCatalogPath, themeId) {
  if (!themeId || !(await exists(themeCatalogPath))) {
    return null;
  }
  const catalog = await readJson(themeCatalogPath).catch(() => null);
  const match = catalog?.themes?.find((theme) => theme.id === themeId) ?? null;
  return normalizeTheme(match);
}

function relativeAssetUrl(outputPath, absoluteAssetPath) {
  return normalizePathForDisplay(path.relative(path.dirname(outputPath), absoluteAssetPath));
}

function buildThemeLockStyle({ theme, projectRoot, outputPath }) {
  if (!theme?.tokens) {
    return '';
  }
  const preset = SURFACE_PRESETS[theme.surfacePreset] ?? SURFACE_PRESETS['paper-grid'];
  const assetPath = path.join(projectRoot, '.openprd', 'design', 'assets', preset.asset);
  const overlayUrl = relativeAssetUrl(outputPath, assetPath);
  const radius = theme.tokens.radius ?? '8px';
  const styleLines = [
    ':root {',
    `  --bg: ${theme.tokens.background};`,
    `  --bg-deep: ${theme.tokens.background};`,
    `  --panel: ${theme.tokens.surface};`,
    `  --panel-strong: ${theme.tokens.surface};`,
    `  --panel-soft: ${withAlpha(theme.tokens.surface, 0.82)};`,
    `  --line: ${withAlpha(theme.tokens.border, 0.85)};`,
    `  --line-strong: ${withAlpha(theme.tokens.border, 1)};`,
    `  --ink: ${theme.tokens.text};`,
    `  --text: ${theme.tokens.text};`,
    `  --muted: ${theme.tokens.muted};`,
    `  --soft: ${theme.tokens.muted};`,
    `  --accent: ${theme.tokens.accent};`,
    `  --accent-strong: ${theme.tokens.accent};`,
    `  --accent-soft: ${withAlpha(theme.tokens.accent, 0.14)};`,
    `  --warm: ${theme.tokens.accent};`,
    `  --warm-soft: ${withAlpha(theme.tokens.accent, 0.16)};`,
    `  --shadow: ${theme.tokens.shadow};`,
    `  --radius: ${radius};`,
    `  --radius-md: ${radius};`,
    `  --radius-lg: calc(${radius} + 6px);`,
    `  --radius-xl: calc(${radius} + 14px);`,
    `  --body-font: ${theme.bodyFont};`,
    `  --headline-font: ${theme.headlineFont};`,
    '}',
    'body {',
    `  font-family: var(--body-font, ${theme.bodyFont});`,
    `  background: ${preset.bodyLayers.join(', ')};`,
    '}',
    'body::after {',
    '  content: "";',
    '  position: fixed;',
    '  inset: 0;',
    `  background: url("${overlayUrl}") center / cover repeat;`,
    `  opacity: ${preset.overlayOpacity};`,
    '  pointer-events: none;',
    '  z-index: 0;',
    '}',
    '.page {',
    '  position: relative;',
    '  z-index: 1;',
    '}',
    'h1, h2, h3, .brand, .sidebar-copy h1, .topbar-copy h2 {',
    `  font-family: var(--headline-font, ${theme.headlineFont}) !important;`,
    '}',
    '.hero, .section, .cta, .sidebar, .topbar-shell, .metric-card, .panel {',
    '  box-shadow: var(--shadow);',
    '}',
  ];
  return `<style data-openprd-theme-lock>\n${styleLines.join('\n')}\n</style>`;
}

function injectThemeLockStyle(html, themeLockStyle) {
  if (!themeLockStyle) {
    return html;
  }
  if (html.includes('</head>')) {
    return html.replace('</head>', `${themeLockStyle}\n  </head>`);
  }
  return `${themeLockStyle}\n${html}`;
}

function buildCommonsSearchUrl(query, limit) {
  const url = new URL(commonsApiBaseUrl());
  url.searchParams.set('action', 'query');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrnamespace', '6');
  url.searchParams.set('gsrsearch', query);
  url.searchParams.set('gsrlimit', String(limit));
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|extmetadata');
  url.searchParams.set('iiurlwidth', String(COMMONS_IMAGE_WIDTH));
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  return url.toString();
}

function normalizeImageExtension(imageUrl, mimeType) {
  const parsedUrl = new URL(imageUrl);
  const extension = path.extname(parsedUrl.pathname).toLowerCase();
  if (extension) {
    return extension;
  }
  if (mimeType === 'image/png') {
    return '.png';
  }
  if (mimeType === 'image/webp') {
    return '.webp';
  }
  if (mimeType === 'image/svg+xml') {
    return '.svg';
  }
  return '.jpg';
}

function normalizeTitle(title) {
  return String(title ?? '')
    .replace(/^File:/i, '')
    .replaceAll('_', ' ')
    .trim();
}

function buildAltText(candidate) {
  const description = stripHtml(candidate?.description);
  if (description) {
    return description;
  }
  return normalizeTitle(candidate?.title) || '参考图片';
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      'user-agent': '@openprd/cli design-starter image sourcing',
    },
  });
  if (!response.ok) {
    throw new Error(`图片搜索失败: ${response.status}`);
  }
  return response.json();
}

async function downloadBinary(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      'user-agent': '@openprd/cli design-starter image sourcing',
    },
  });
  if (!response.ok) {
    throw new Error(`图片下载失败: ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    bytes,
    mimeType: response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg',
  };
}

async function sourceStarterImages({ projectRoot, outputPath, starter, context, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== 'function') {
    return {
      attempted: false,
      succeeded: false,
      assets: [],
      query: null,
      manifestPath: null,
      relativeManifestPath: null,
      reason: '当前运行环境没有可用 fetch',
    };
  }
  if (!shouldAttemptStarterImages(starter, context)) {
    return {
      attempted: false,
      succeeded: false,
      assets: [],
      query: null,
      manifestPath: null,
      relativeManifestPath: null,
      reason: '当前页面不满足自动补图条件',
    };
  }
  const query = deriveCommonsQuery(context);
  if (!query) {
    return {
      attempted: false,
      succeeded: false,
      assets: [],
      query: null,
      manifestPath: null,
      relativeManifestPath: null,
      reason: '无法从页面主题中提取可搜索关键词',
    };
  }
  try {
    const payload = await fetchJson(buildCommonsSearchUrl(query, COMMONS_IMAGE_COUNT), fetchImpl);
    const pages = Object.values(payload?.query?.pages ?? {})
      .map((page) => {
        const imageinfo = page?.imageinfo?.[0] ?? null;
        return {
          title: page?.title ?? '',
          description: imageinfo?.extmetadata?.ImageDescription?.value ?? '',
          sourceUrl: imageinfo?.thumburl ?? imageinfo?.url ?? '',
          pageUrl: imageinfo?.descriptionurl ?? '',
          licenseShortName: stripHtml(imageinfo?.extmetadata?.LicenseShortName?.value),
          licenseUrl: stripHtml(imageinfo?.extmetadata?.LicenseUrl?.value),
          artist: stripHtml(imageinfo?.extmetadata?.Artist?.value),
          credit: stripHtml(imageinfo?.extmetadata?.Credit?.value),
        };
      })
      .filter((page) => page.sourceUrl);
    if (pages.length === 0) {
      return {
        attempted: true,
        succeeded: false,
        assets: [],
        query,
        manifestPath: null,
        relativeManifestPath: null,
        reason: 'Commons 没有返回可下载图片',
      };
    }
    const bundleId = String(context.displayTitle ?? context.brief ?? starter.id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || starter.id;
    const outputDir = path.join(projectRoot, '.openprd', 'design', 'assets', 'fetched', bundleId);
    await fs.mkdir(outputDir, { recursive: true });
    const assets = [];
    for (const [index, page] of pages.entries()) {
      const { bytes, mimeType } = await downloadBinary(page.sourceUrl, fetchImpl);
      const fileName = `image-${index + 1}${normalizeImageExtension(page.sourceUrl, mimeType)}`;
      const absolutePath = path.join(outputDir, fileName);
      await fs.writeFile(absolutePath, bytes);
      assets.push({
        index: index + 1,
        title: normalizeTitle(page.title),
        alt: buildAltText(page),
        sourceUrl: page.sourceUrl,
        pageUrl: page.pageUrl,
        licenseShortName: page.licenseShortName || 'License unavailable',
        licenseUrl: page.licenseUrl || '',
        artist: page.artist || '',
        credit: page.credit || '',
        absolutePath,
        relativePath: relativeAssetUrl(outputPath, absolutePath),
      });
    }
    const manifestPath = path.join(outputDir, 'manifest.json');
    await writeJson(manifestPath, {
      source: 'Wikimedia Commons',
      query,
      fetchedAt: new Date().toISOString(),
      assets: assets.map((asset) => ({
        index: asset.index,
        title: asset.title,
        alt: asset.alt,
        relativePath: asset.relativePath,
        pageUrl: asset.pageUrl,
        sourceUrl: asset.sourceUrl,
        licenseShortName: asset.licenseShortName,
        licenseUrl: asset.licenseUrl,
        artist: asset.artist,
        credit: asset.credit,
      })),
    });
    return {
      attempted: true,
      succeeded: assets.length > 0,
      assets,
      query,
      manifestPath,
      relativeManifestPath: normalizePathForDisplay(path.relative(projectRoot, manifestPath)),
      reason: assets.length > 0 ? null : '下载结果为空',
    };
  } catch (error) {
    return {
      attempted: true,
      succeeded: false,
      assets: [],
      query,
      manifestPath: null,
      relativeManifestPath: null,
      reason: error instanceof Error ? error.message : '自动补图失败',
    };
  }
}

export {
  buildThemeLockStyle,
  injectThemeLockStyle,
  isRealImageDependentStarterContext,
  loadThemeConfig,
  sourceStarterImages,
};
