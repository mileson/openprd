import fs from 'node:fs/promises';
import path from 'node:path';
import { OPENSPEC_TASK_MAX_ITEMS_PER_FILE } from './constants.js';
import { openPrdChangeRoot, openPrdDiscoveryConfigPath, readDiscoveryConfig } from './paths.js';

function cjoin(...parts) {
  return path.join(...parts);
}

function exists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function readJson(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text);
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function slugify(value, fallback = 'item') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function scalar(value, fallback = '待补充') {
  if (value === null || value === undefined) {
    return fallback;
  }
  const text = String(value).trim();
  return text || fallback;
}

function arrayValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => scalar(item, '')).filter(Boolean);
  }
  if (value === null || value === undefined || String(value).trim() === '') {
    return [];
  }
  return [String(value).trim()];
}

function bullets(items, fallback = ['待补充']) {
  const values = arrayValue(items);
  return (values.length > 0 ? values : fallback).map((item) => `- ${item}`).join('\n');
}

function safeRequirementTitle(value, fallback) {
  return scalar(value, fallback).replace(/\s+/g, ' ').slice(0, 120);
}

function resolveCapability(snapshot) {
  const productType = slugify(snapshot.productType ?? snapshot.templatePack ?? 'product', 'product');
  return `${productType}-requirements`;
}

function buildProposal({ changeId, capability, snapshot }) {
  const sections = snapshot.sections ?? {};
  return [
    `# ${scalar(snapshot.title, changeId)}`,
    '',
    '## 为什么',
    '',
    scalar(sections.problem?.problemStatement, '需要把当前产品需求转化为可执行的规格变更。'),
    '',
    '## 变更内容',
    '',
    bullets([
      ...arrayValue(sections.scope?.inScope),
      ...arrayValue(sections.requirements?.functional),
      ...arrayValue(sections.goals?.acceptanceGoals),
    ], ['根据当前 PRD 生成 OpenPrd 管理的规格增量。']),
    '',
    '## 能力',
    '',
    `- \`${capability}\`: ${scalar(snapshot.title, '产品行为')} 需求。`,
    '',
    '## 影响',
    '',
    bullets([
      ...arrayValue(sections.users?.primaryUsers).map((item) => `主要用户: ${item}`),
      ...arrayValue(sections.constraints?.dependencies).map((item) => `依赖: ${item}`),
      ...arrayValue(sections.risks?.risks).map((item) => `风险: ${item}`),
    ], ['Agent 可以通过 OpenPrd 从 PRD 继续推进到 specs、tasks、validation 和 execution。']),
    '',
  ].join('\n');
}

function buildDesign({ snapshot }) {
  const sections = snapshot.sections ?? {};
  return [
    '# 设计',
    '',
    '## 背景',
    '',
    scalar(sections.problem?.whyNow, '根据最新 OpenPrd 快照生成。'),
    '',
    '## 目标',
    '',
    bullets(sections.goals?.goals),
    '',
    '## 范围',
    '',
    bullets(sections.scope?.inScope),
    '',
    '## 约束',
    '',
    bullets([
      ...arrayValue(sections.constraints?.technical),
      ...arrayValue(sections.constraints?.compliance),
      ...arrayValue(sections.constraints?.dependencies),
    ]),
    '',
    '## 风险与开放问题',
    '',
    bullets([
      ...arrayValue(sections.risks?.assumptions).map((item) => `假设: ${item}`),
      ...arrayValue(sections.risks?.risks).map((item) => `风险: ${item}`),
      ...arrayValue(sections.risks?.openQuestions).map((item) => `问题: ${item}`),
    ]),
    '',
  ].join('\n');
}

function buildSpec({ snapshot }) {
  const sections = snapshot.sections ?? {};
  const title = safeRequirementTitle(snapshot.title, '生成的产品行为');
  const flow = arrayValue(sections.scenarios?.primaryFlows)[0] ?? '主要用户完成主流程';
  const acceptance = arrayValue(sections.goals?.acceptanceGoals)[0]
    ?? arrayValue(sections.requirements?.functional)[0]
    ?? '预期产品结果得到满足';
  const edgeCase = arrayValue(sections.scenarios?.edgeCases)[0] ?? '出现边界情况';
  const failureMode = arrayValue(sections.scenarios?.failureModes)[0] ?? '出现失败模式';

  return [
    '## ADDED Requirements',
    '',
    `### Requirement: ${title} SHALL 满足当前 PRD`,
    scalar(sections.problem?.problemStatement, '生成的能力 SHALL 保持最新 OpenPrd 快照描述的行为。'),
    '',
    '#### Scenario: 主流程成功',
    `- **WHEN** ${flow}`,
    `- **THEN** ${acceptance}`,
    '',
    '#### Scenario: 边界情况保持可见',
    `- **WHEN** ${edgeCase}`,
    '- **THEN** 产品 SHALL 保持该情况明确可见，以支持实现和验证',
    '',
    '#### Scenario: 失败模式得到处理',
    `- **WHEN** ${failureMode}`,
    '- **THEN** 产品 SHALL 提供有边界且可评审的结果',
    '',
  ].join('\n');
}

function buildTaskItems({ changeId, snapshot, capability }) {
  const sections = snapshot.sections ?? {};
  const candidates = [
    ['评审生成的 spec 覆盖', `生成的 ${capability} spec 符合 PRD 意图`],
    ...arrayValue(sections.scenarios?.primaryFlows).map((item) => [`实现主流程: ${item}`, `主流程可用: ${item}`]),
    ...arrayValue(sections.requirements?.functional).map((item) => [`实现需求: ${item}`, `需求已实现: ${item}`]),
    ...arrayValue(sections.goals?.acceptanceGoals).map((item) => [`验证验收目标: ${item}`, `验收目标已满足: ${item}`]),
    ...arrayValue(sections.requirements?.nonFunctional).map((item) => [`验证非功能需求: ${item}`, `非功能需求已满足: ${item}`]),
    ['维护 docs/basic 项目基础文档', 'docs/basic 中的基础文档已反映本次需求和实现边界'],
    ['更新文件说明书和文件夹 README', '本次变更涉及的文件说明书和文件夹 README 已检查并更新'],
    ['运行 OpenPrd spec 校验', '生成的 change 通过 OpenPrd 校验'],
  ];

  const deduped = [];
  const seen = new Set();
  for (const [title, done] of candidates) {
    const key = title.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({ title, done });
  }

  return deduped.map((item, index) => {
    const taskNumber = index + 1;
    const id = `T001.${String(taskNumber).padStart(2, '0')}`;
    const previousId = taskNumber > 1 ? `T001.${String(taskNumber - 1).padStart(2, '0')}` : null;
    return {
      id,
      title: item.title,
      deps: previousId ? [previousId] : [],
      done: item.done,
      verify: item.title.includes('docs/basic') || item.title.includes('文件说明书')
        ? 'openprd standards . --verify'
        : `openprd change . --validate --change ${changeId}`,
    };
  });
}

function taskFileName(index) {
  return index === 0 ? 'tasks.md' : `tasks-${String(index + 1).padStart(3, '0')}.md`;
}

function renderTaskFiles(tasks, maxItemsPerFile) {
  const chunks = [];
  for (let index = 0; index < tasks.length; index += maxItemsPerFile) {
    chunks.push(tasks.slice(index, index + maxItemsPerFile));
  }

  return chunks.map((chunk, chunkIndex) => {
    const nextFileName = chunkIndex < chunks.length - 1 ? taskFileName(chunkIndex + 1) : null;
    const lines = [
      '# 任务',
      '',
    ];

    for (const task of chunk) {
      lines.push(`- [ ] ${task.id} ${task.title}`);
      if (task.deps.length > 0) {
        lines.push(`  - deps: ${task.deps.join(', ')}`);
      }
      lines.push(`  - done: ${task.done}`);
      lines.push(`  - verify: ${task.verify}`);
      lines.push('');
    }

    if (nextFileName) {
      lines.push(`- [ ] Continue with \`${nextFileName}\` after completing this file.`);
      lines.push('');
    }

    return {
      fileName: taskFileName(chunkIndex),
      text: lines.join('\n'),
    };
  });
}

async function readTaskMax(projectRoot) {
  const discoveryConfig = await readDiscoveryConfig(projectRoot, readJson);
  const maxItemsPerFile = Number(discoveryConfig?.taskSharding?.maxItemsPerFile ?? OPENSPEC_TASK_MAX_ITEMS_PER_FILE);
  return Number.isInteger(maxItemsPerFile) && maxItemsPerFile > 0 ? maxItemsPerFile : OPENSPEC_TASK_MAX_ITEMS_PER_FILE;
}

async function writeDiscoveryConfig(projectRoot, changeId) {
  const configPath = openPrdDiscoveryConfigPath(projectRoot);
  const current = await readJson(configPath).catch(() => ({}));
  await writeJson(configPath, {
    ...current,
    activeChange: changeId,
    taskSharding: {
      maxItemsPerFile: current?.taskSharding?.maxItemsPerFile ?? OPENSPEC_TASK_MAX_ITEMS_PER_FILE,
      handoffRequired: current?.taskSharding?.handoffRequired ?? true,
      firstFile: current?.taskSharding?.firstFile ?? 'tasks.md',
      nextFilePattern: current?.taskSharding?.nextFilePattern ?? 'tasks-###.md',
    },
    taskMetadata: {
      stableIdPattern: current?.taskMetadata?.stableIdPattern ?? 'T###.##',
      required: current?.taskMetadata?.required ?? ['done', 'verify'],
      optional: current?.taskMetadata?.optional ?? ['deps'],
      dependencyOrder: current?.taskMetadata?.dependencyOrder ?? 'dependencies must appear before dependents',
    },
  });
}

export async function generateOpenSpecChangeWorkspace(projectRoot, options = {}) {
  const snapshot = options.snapshot;
  if (!snapshot) {
    throw new Error('生成 OpenPrd change 需要 PRD 快照。');
  }

  const changeId = slugify(options.change ?? snapshot.title, 'openprd-generated-change');
  const capability = resolveCapability(snapshot);
  const changeDir = cjoin(openPrdChangeRoot(projectRoot), changeId);
  const files = [
    {
      path: cjoin(changeDir, '.openprd.yaml'),
      text: [
        'schema: openprd.change.v1',
        `generatedFrom: ${snapshot.versionId}`,
        '',
      ].join('\n'),
    },
    {
      path: cjoin(changeDir, 'proposal.md'),
      text: buildProposal({ changeId, capability, snapshot }),
    },
    {
      path: cjoin(changeDir, 'design.md'),
      text: buildDesign({ snapshot }),
    },
    {
      path: cjoin(changeDir, 'specs', capability, 'spec.md'),
      text: buildSpec({ snapshot }),
    },
  ];
  const tasks = buildTaskItems({ changeId, snapshot, capability });
  const taskFiles = renderTaskFiles(tasks, await readTaskMax(projectRoot));

  for (const file of taskFiles) {
    files.push({
      path: cjoin(changeDir, file.fileName),
      text: file.text,
    });
  }

  const existing = [];
  for (const file of files) {
    if (await exists(file.path)) {
      existing.push(path.relative(projectRoot, file.path));
    }
  }
  if (existing.length > 0 && !options.force) {
    throw new Error(`OpenPrd change 已存在生成文件；请使用 --force 覆盖: ${existing.join(', ')}`);
  }

  for (const file of files) {
    await writeText(file.path, file.text);
  }
  await writeDiscoveryConfig(projectRoot, changeId);

  return {
    ok: true,
    projectRoot,
    changeId,
    changeDir,
    capability,
    files: files.map((file) => path.relative(projectRoot, file.path)),
    taskCount: tasks.length,
  };
}
