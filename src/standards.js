import fs from 'node:fs/promises';
import path from 'node:path';

export const OPENPRD_STANDARDS_CONFIG = path.join('.openprd', 'standards', 'config.json');
export const OPENPRD_STANDARDS_DIR = path.join('.openprd', 'standards');
export const STANDARD_DOCS_ROOT = path.join('docs', 'basic');
export const STANDARD_MANUAL_SECTIONS = ['核心功能', '输入', '输出', '定位', '依赖', '维护规则'];

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
      errors.push(`${relativePath} is missing section: ${section}`);
    }
  }
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
    },
    folderManual: {
      enabled: true,
      template: 'folder-readme-template.md',
      naming: '[module]_[folder]_README.md',
      requiredSections: STANDARD_MANUAL_SECTIONS,
    },
    qualityGates: {
      changeValidateRequiresStandards: true,
      taskVerifyUsesStandards: true,
      discoveryVerifyRequiresStandards: true,
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

  const requiredDocs = [];
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
      errors.push(`${relativePath} is missing title: ${doc.title}`);
    }
    validateTextSections(relativePath, text, doc.sections, errors);
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
  };
}
