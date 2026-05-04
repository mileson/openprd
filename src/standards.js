import fs from 'node:fs/promises';
import path from 'node:path';

export const OPENPRD_STANDARDS_CONFIG = path.join('.openprd', 'standards', 'config.json');
export const OPENPRD_STANDARDS_DIR = path.join('.openprd', 'standards');
export const STANDARD_DOCS_ROOT = path.join('docs', 'basic');
export const STANDARD_MANUAL_SECTIONS = ['核心功能', '输入', '输出', '定位', '依赖', '维护规则'];
const SOURCE_FILE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.html', '.swift', '.py', '.go', '.rs']);
const SOURCE_IGNORE_DIRS = new Set([
  '.git',
  '.openprd',
  'openprd',
  '.openspec',
  '.codex',
  '.claude',
  '.cursor',
  'docs',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  'release',
  'releases',
  'coverage',
  'reports',
  'test-results',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
  '.tmp',
  'tmp',
  'temp',
  'third_party',
  'third-party',
  'external',
  'generated',
  '__fixtures__',
  'fixtures',
]);
const DEFAULT_SOURCE_MANUAL_IGNORE_PATTERNS = [
  '.tmp/**',
  'tmp/**',
  'temp/**',
  '**/marketplace-sources/**',
  '**/marketplace-candidates/**',
  '**/skill-sources/**',
  '**/legacy-data/**',
  '**/legacy-public/**',
  '**/legacy-cache/**',
  '**/cache/**',
  '**/generated/**',
  '**/vendor/**',
  '**/out/**',
  '**/release/**',
  '**/releases/**',
  '**/reports/**',
  '**/test-results/**',
  '**/third_party/**',
  '**/third-party/**',
  '**/__fixtures__/**',
  '**/fixtures/**',
];
const DOC_PLACEHOLDER_PATTERNS = [
  /待补充/,
  /说明当前项目/,
  /描述产品/,
  /说明产品/,
  /说明前端/,
  /说明后端/,
  /说明该文件/,
  /说明该文件夹/,
];

export const STANDARD_DOCS = [
  {
    fileName: 'file-structure.md',
    title: '项目文件结构',
    sections: ['项目定位', '核心目录', '文件组织规则', '维护规则'],
    body: [
      '# 项目文件结构',
      '',
      '## 项目定位',
      '',
      '说明当前项目的主要边界、运行入口和核心模块分布。',
      '',
      '## 核心目录',
      '',
      '- 待补充: 列出主要源码、资源、测试、脚本和文档目录。',
      '',
      '## 文件组织规则',
      '',
      '- 新增文件时，应同步确认所在文件夹说明书是否需要更新。',
      '- 跨模块移动文件时，应更新本文件中的目录结构和职责说明。',
      '',
      '## 维护规则',
      '',
      '- 每次新增、删除、移动目录或核心文件后，必须检查并更新本文件。',
      '- 本文档只记录项目结构事实，不承载具体功能需求细节。',
      '',
    ].join('\n'),
  },
  {
    fileName: 'app-flow.md',
    title: '产品流程说明',
    sections: ['核心流程', '用户路径', '状态变化', '维护规则'],
    body: [
      '# 产品流程说明',
      '',
      '## 核心流程',
      '',
      '描述产品从入口到完成目标的主要流程。',
      '',
      '## 用户路径',
      '',
      '- 待补充: 主要用户如何进入、操作和完成关键任务。',
      '',
      '## 状态变化',
      '',
      '- 待补充: 关键状态、异常状态和恢复路径。',
      '',
      '## 维护规则',
      '',
      '- 每次用户流程、页面跳转、任务状态或异常处理发生变化后，必须检查并更新本文件。',
      '',
    ].join('\n'),
  },
  {
    fileName: 'prd.md',
    title: '产品逻辑说明',
    sections: ['问题与目标', '用户故事', '功能范围', '验收标准', '维护规则'],
    body: [
      '# 产品逻辑说明',
      '',
      '## 问题与目标',
      '',
      '说明产品要解决的问题、目标用户和成功标准。',
      '',
      '## 用户故事',
      '',
      '- 待补充: 作为某类用户，我希望完成某个目标，从而获得某个结果。',
      '',
      '## 功能范围',
      '',
      '- 待补充: 当前版本包含的能力和明确不包含的内容。',
      '',
      '## 验收标准',
      '',
      '- 待补充: 功能完成后可以被验证的用户结果。',
      '',
      '## 维护规则',
      '',
      '- 每次需求边界、用户故事、验收标准发生变化后，必须检查并更新本文件。',
      '',
    ].join('\n'),
  },
  {
    fileName: 'frontend-guidelines.md',
    title: '前端开发规范',
    sections: ['适用范围', '界面结构', '交互规范', '维护规则'],
    body: [
      '# 前端开发规范',
      '',
      '## 适用范围',
      '',
      '说明前端界面、组件、交互和样式的项目级约定。',
      '',
      '## 界面结构',
      '',
      '- 待补充: 页面、组件、状态和资源组织方式。',
      '',
      '## 交互规范',
      '',
      '- 待补充: 常见操作、反馈、空状态和错误状态的处理方式。',
      '',
      '## 维护规则',
      '',
      '- 每次新增界面模式、组件规范或交互规则后，必须检查并更新本文件。',
      '',
    ].join('\n'),
  },
  {
    fileName: 'backend-structure.md',
    title: '后端架构设计',
    sections: ['适用范围', '服务边界', '数据流', '维护规则'],
    body: [
      '# 后端架构设计',
      '',
      '## 适用范围',
      '',
      '说明后端服务、接口、数据处理和外部依赖的项目级架构约定。',
      '',
      '## 服务边界',
      '',
      '- 待补充: 主要服务、模块职责和调用边界。',
      '',
      '## 数据流',
      '',
      '- 待补充: 数据输入、处理、存储和输出路径。',
      '',
      '## 维护规则',
      '',
      '- 每次服务边界、数据流、存储或外部依赖发生变化后，必须检查并更新本文件。',
      '',
    ].join('\n'),
  },
  {
    fileName: 'tech-stack.md',
    title: '项目技术栈',
    sections: ['运行环境', '核心依赖', '工具链', '维护规则'],
    body: [
      '# 项目技术栈',
      '',
      '## 运行环境',
      '',
      '- 待补充: 语言、运行时、平台和版本要求。',
      '',
      '## 核心依赖',
      '',
      '- 待补充: 框架、SDK、服务和关键第三方库。',
      '',
      '## 工具链',
      '',
      '- 待补充: 构建、测试、发布和质量检查命令。',
      '',
      '## 维护规则',
      '',
      '- 每次新增、移除或升级核心依赖、运行时和工具链后，必须检查并更新本文件。',
      '',
    ].join('\n'),
  },
];

export const STANDARD_TEMPLATE_FILES = [
  {
    relativePath: path.join(OPENPRD_STANDARDS_DIR, 'file-manual-template.md'),
    title: '文件说明书模板',
    body: [
      '# 文件说明书模板',
      '',
      '文件说明书应位于代码文件起始位置，并根据文件类型使用对应注释语法。',
      '',
      '## 核心功能',
      '',
      '一句话描述该文件的核心职责。',
      '',
      '## 输入',
      '',
      '描述该文件接收的数据来源、参数或上游信号。',
      '',
      '## 输出',
      '',
      '描述该文件对外提供的方法、状态、事件或结果。',
      '',
      '## 定位',
      '',
      '描述该文件在当前模块或文件夹中的职责边界。',
      '',
      '## 依赖',
      '',
      '列出关键内部文件、模块或第三方依赖。',
      '',
      '## 维护规则',
      '',
      '- 每次修改代码逻辑后，必须检查并更新文件说明书。',
      '- 变更影响所在文件夹职责时，必须同步更新文件夹 README。',
      '',
    ].join('\n'),
  },
  {
    relativePath: path.join(OPENPRD_STANDARDS_DIR, 'folder-readme-template.md'),
    title: '文件夹说明书模板',
    body: [
      '# 文件夹说明书模板',
      '',
      '文件夹说明书应保存为当前目录下的 `[模块名]_[文件夹名]_README.md`。',
      '',
      '## 核心功能',
      '',
      '一句话描述该文件夹承载的能力和目标。',
      '',
      '## 输入',
      '',
      '描述进入该文件夹模块的数据、事件或上游依赖。',
      '',
      '## 输出',
      '',
      '描述该文件夹模块对外暴露的视图、服务、接口或数据。',
      '',
      '## 定位',
      '',
      '描述该文件夹在项目结构中的位置和职责边界。',
      '',
      '## 依赖',
      '',
      '列出关键内部模块、资源、服务和第三方依赖。',
      '',
      '## 维护规则',
      '',
      '- 每次新增、删除、移动文件或调整职责后，必须检查并更新本 README。',
      '- 文件夹职责影响项目基础文档时，必须同步更新 `docs/basic/`。',
      '',
    ].join('\n'),
  },
];

function cjoin(...parts) {
  return path.join(...parts);
}

function exists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function readJson(filePath) {
  const text = await readText(filePath);
  return JSON.parse(text);
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function requiredDocPath(projectRoot, fileName) {
  return cjoin(projectRoot, STANDARD_DOCS_ROOT, fileName);
}

function standardsConfigPath(projectRoot) {
  return cjoin(projectRoot, OPENPRD_STANDARDS_CONFIG);
}

function validateTextSections(relativePath, text, sections, errors) {
  for (const section of sections) {
    if (!text.includes(`## ${section}`)) {
      errors.push(`${relativePath} 缺少章节: ${section}`);
    }
  }
}

function sourceManualReadmeName(projectRoot, dirPath) {
  const moduleName = path.basename(projectRoot).replace(/[^a-zA-Z0-9_-]+/g, '-');
  const folderName = path.basename(dirPath).replace(/[^a-zA-Z0-9_-]+/g, '-');
  return `${moduleName}_${folderName}_README.md`;
}

function shouldIgnoreDir(dirName) {
  return SOURCE_IGNORE_DIRS.has(dirName);
}

function toPosixPath(value) {
  return String(value ?? '').split(path.sep).join('/');
}

function globToRegExp(pattern) {
  const escaped = toPosixPath(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesPattern(relativePath, patterns = []) {
  const normalized = toPosixPath(relativePath).replace(/^\/+/, '');
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

function matchesIgnoredPath(relativePath, patterns = [], options = {}) {
  const normalized = toPosixPath(relativePath).replace(/^\/+/, '');
  if (!normalized) {
    return false;
  }
  if (matchesPattern(normalized, patterns)) {
    return true;
  }
  if (!options.directory) {
    return false;
  }
  if (matchesPattern(`${normalized}/__openprd_dir__`, patterns)) {
    return true;
  }
  return patterns.some((pattern) => {
    const normalizedPattern = toPosixPath(pattern).replace(/^\/+/, '');
    if (!normalizedPattern.endsWith('/**')) {
      return false;
    }
    const prefix = normalizedPattern.slice(0, -3).replace(/\/$/, '');
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  });
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
}

function sourceManualIgnorePatterns(config = {}) {
  return [
    ...DEFAULT_SOURCE_MANUAL_IGNORE_PATTERNS,
    ...normalizeStringList(config?.sourceManual?.ignorePaths),
    ...normalizeStringList(config?.fileManual?.ignorePaths),
    ...normalizeStringList(config?.folderManual?.ignorePaths),
  ];
}

async function collectSourceFiles(projectRoot, dirPath = projectRoot, files = [], ignorePatterns = DEFAULT_SOURCE_MANUAL_IGNORE_PATTERNS) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const absolutePath = cjoin(dirPath, entry.name);
    const relativePath = toPosixPath(path.relative(projectRoot, absolutePath));
    if (entry.isDirectory()) {
      if (!shouldIgnoreDir(entry.name) && !matchesIgnoredPath(relativePath, ignorePatterns, { directory: true })) {
        await collectSourceFiles(projectRoot, absolutePath, files, ignorePatterns);
      }
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (SOURCE_FILE_EXTENSIONS.has(path.extname(entry.name)) && !matchesIgnoredPath(relativePath, ignorePatterns)) {
      files.push(absolutePath);
    }
  }
  return files;
}

async function isOpenPrdToolProject(projectRoot) {
  const packageJson = await readJson(cjoin(projectRoot, 'package.json')).catch(() => null);
  return packageJson?.name === '@openprd/cli';
}

function hasAllManualSections(text) {
  return STANDARD_MANUAL_SECTIONS.every((section) => text.includes(`## ${section}`));
}

function hasHeaderManual(text) {
  const header = text.split(/\r?\n/).slice(0, 80).join('\n');
  return hasAllManualSections(header);
}

async function validateSourceManuals(projectRoot, errors, checks, options = {}) {
  const sourceFiles = await collectSourceFiles(projectRoot, projectRoot, [], options.ignorePatterns);
  const sourceDirs = new Set(sourceFiles.map((filePath) => path.dirname(filePath)));
  const filesMissingManual = [];
  const foldersMissingManual = [];

  for (const filePath of sourceFiles) {
    const relativePath = path.relative(projectRoot, filePath);
    const text = await readText(filePath).catch(() => '');
    if (!hasHeaderManual(text)) {
      filesMissingManual.push(relativePath);
    }
  }

  for (const dirPath of sourceDirs) {
    const expectedPath = cjoin(dirPath, sourceManualReadmeName(projectRoot, dirPath));
    const relativePath = path.relative(projectRoot, expectedPath);
    const text = await readText(expectedPath).catch(() => null);
    if (!text || !hasAllManualSections(text)) {
      foldersMissingManual.push(relativePath);
    }
  }

  for (const relativePath of filesMissingManual) {
    errors.push(`${relativePath} 缺少文件说明书；请在文件头部补齐 ${STANDARD_MANUAL_SECTIONS.join('、')}。`);
  }
  for (const relativePath of foldersMissingManual) {
    errors.push(`${relativePath} 缺少文件夹说明书或章节不完整。`);
  }

  checks.push(`源文件说明书: ${sourceFiles.length - filesMissingManual.length}/${sourceFiles.length}。`);
  checks.push(`文件夹说明书: ${sourceDirs.size - foldersMissingManual.length}/${sourceDirs.size}。`);

  return {
    ignorePatterns: options.ignorePatterns ?? DEFAULT_SOURCE_MANUAL_IGNORE_PATTERNS,
    sourceFiles: sourceFiles.map((filePath) => path.relative(projectRoot, filePath)),
    sourceDirs: [...sourceDirs].map((dirPath) => path.relative(projectRoot, dirPath) || '.'),
    filesMissingManual,
    foldersMissingManual,
  };
}

async function writeIfNeeded(filePath, text, options = {}) {
  const fileExists = await exists(filePath);
  if (fileExists && !options.force) {
    return 'skipped';
  }
  await writeText(filePath, text);
  return fileExists ? 'overwritten' : 'created';
}

function buildStandardsConfig() {
  return {
    version: 1,
    docsRoot: STANDARD_DOCS_ROOT.replaceAll(path.sep, '/'),
    requiredDocs: STANDARD_DOCS.map((doc) => doc.fileName),
    fileManual: {
      enabled: true,
      template: 'file-manual-template.md',
      requiredSections: STANDARD_MANUAL_SECTIONS,
      placement: 'file-header',
      ignorePaths: DEFAULT_SOURCE_MANUAL_IGNORE_PATTERNS,
    },
    folderManual: {
      enabled: true,
      template: 'folder-readme-template.md',
      naming: '[module]_[folder]_README.md',
      requiredSections: STANDARD_MANUAL_SECTIONS,
      ignorePaths: DEFAULT_SOURCE_MANUAL_IGNORE_PATTERNS,
    },
    sourceManual: {
      ignorePaths: DEFAULT_SOURCE_MANUAL_IGNORE_PATTERNS,
    },
    qualityGates: {
      changeValidateRequiresStandards: true,
      taskVerifyUsesStandards: true,
      discoveryVerifyRequiresStandards: true,
      sourceManuals: true,
    },
  };
}

export async function standardsConfigExists(projectRoot) {
  return exists(standardsConfigPath(projectRoot));
}

export async function initStandardsWorkspace(projectRoot, options = {}) {
  const changed = [];
  const configPath = standardsConfigPath(projectRoot);
  const configStatus = await writeIfNeeded(configPath, `${JSON.stringify(buildStandardsConfig(), null, 2)}\n`, options);
  changed.push({ path: path.relative(projectRoot, configPath), status: configStatus });

  for (const template of STANDARD_TEMPLATE_FILES) {
    const templatePath = cjoin(projectRoot, template.relativePath);
    const status = await writeIfNeeded(templatePath, template.body, options);
    changed.push({ path: path.relative(projectRoot, templatePath), status });
  }

  for (const doc of STANDARD_DOCS) {
    const docPath = requiredDocPath(projectRoot, doc.fileName);
    const status = await writeIfNeeded(docPath, doc.body, options);
    changed.push({ path: path.relative(projectRoot, docPath), status });
  }

  const report = await checkStandardsWorkspace(projectRoot);
  return {
    ok: report.ok,
    action: 'init',
    projectRoot,
    docsRoot: STANDARD_DOCS_ROOT,
    changed,
    report,
  };
}

export async function checkStandardsWorkspace(projectRoot, options = {}) {
  const errors = [];
  const warnings = [];
  const checks = [];
  const configPath = standardsConfigPath(projectRoot);

  if (!(await exists(configPath))) {
    if (options.optional) {
      return {
        ok: true,
        valid: true,
        skipped: true,
        projectRoot,
        docsRoot: STANDARD_DOCS_ROOT,
        errors,
        warnings,
        checks: ['OpenPrd standards are not initialized.'],
        requiredDocs: [],
        templateFiles: [],
      };
    }
    errors.push(`${OPENPRD_STANDARDS_CONFIG} is required. Run: openprd standards . --init`);
    return {
      ok: false,
      valid: false,
      skipped: false,
      projectRoot,
      docsRoot: STANDARD_DOCS_ROOT,
      errors,
      warnings,
      checks,
      requiredDocs: [],
      templateFiles: [],
    };
  }

  const config = await readJson(configPath).catch((error) => {
    errors.push(`Invalid ${OPENPRD_STANDARDS_CONFIG}: ${error.message}`);
    return null;
  });

  if (config) {
    if (config.docsRoot !== 'docs/basic') {
      errors.push(`${OPENPRD_STANDARDS_CONFIG} docsRoot must be docs/basic.`);
    }
  }

  const ignorePatterns = sourceManualIgnorePatterns(config ?? {});
  const requiredDocs = [];
  const sourceFiles = await collectSourceFiles(projectRoot, projectRoot, [], ignorePatterns);
  const hasProjectSource = sourceFiles.length > 0;
  const openPrdToolProject = await isOpenPrdToolProject(projectRoot);
  for (const doc of STANDARD_DOCS) {
    const docPath = requiredDocPath(projectRoot, doc.fileName);
    const relativePath = path.relative(projectRoot, docPath);
    const existsDoc = await exists(docPath);
    requiredDocs.push({ path: relativePath, exists: existsDoc });
    if (!existsDoc) {
      errors.push(`${relativePath} is required.`);
      continue;
    }
    const text = await readText(docPath);
    if (!text.includes(`# ${doc.title}`)) {
      errors.push(`${relativePath} 缺少标题: ${doc.title}`);
    }
    validateTextSections(relativePath, text, doc.sections, errors);
    if (hasProjectSource && !openPrdToolProject && options.docsContent !== false && DOC_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text))) {
      errors.push(`${relativePath} 仍包含模板占位内容，必须更新为当前项目事实。`);
    }
  }

  const templateFiles = [];
  for (const template of STANDARD_TEMPLATE_FILES) {
    const templatePath = cjoin(projectRoot, template.relativePath);
    const relativePath = path.relative(projectRoot, templatePath);
    const existsTemplate = await exists(templatePath);
    templateFiles.push({ path: relativePath, exists: existsTemplate });
    if (!existsTemplate) {
      errors.push(`${relativePath} is required.`);
      continue;
    }
    const text = await readText(templatePath);
    validateTextSections(relativePath, text, STANDARD_MANUAL_SECTIONS, errors);
  }

  const enforceSourceManuals = hasProjectSource
    && options.sourceManuals !== false
    && !openPrdToolProject
    && config?.qualityGates?.sourceManuals !== false
    && config?.fileManual?.enabled !== false
    && config?.folderManual?.enabled !== false;
  const manualReport = enforceSourceManuals
    ? await validateSourceManuals(projectRoot, errors, checks, { ignorePatterns })
    : {
      ignorePatterns,
      sourceFiles: [],
      sourceDirs: [],
      filesMissingManual: [],
      foldersMissingManual: [],
    };

  checks.push(`Standards docs root: ${STANDARD_DOCS_ROOT.replaceAll(path.sep, '/')}`);
  checks.push(`Required docs: ${requiredDocs.filter((doc) => doc.exists).length}/${STANDARD_DOCS.length}.`);
  checks.push(`Manual templates: ${templateFiles.filter((file) => file.exists).length}/${STANDARD_TEMPLATE_FILES.length}.`);

  return {
    ok: errors.length === 0,
    valid: errors.length === 0,
    skipped: false,
    projectRoot,
    docsRoot: STANDARD_DOCS_ROOT,
    errors,
    warnings,
    checks,
    requiredDocs,
    templateFiles,
    manualReport,
  };
}
