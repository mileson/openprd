import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { listChangeDirs, readDiscoveryConfig, resolveChangeDir } from './paths.js';
import { analyzeOpenSpecTaskVolumes } from './tasks.js';
import { checkStandardsWorkspace } from '../standards.js';

function cjoin(...parts) {
  return path.join(...parts);
}

function exists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function readYaml(filePath) {
  const text = await readText(filePath);
  const parsed = YAML.parse(text);
  return parsed ?? {};
}

async function readJson(filePath) {
  const text = await readText(filePath);
  return JSON.parse(text);
}

export async function resolveOpenSpecChangeId(projectRoot, requestedChange) {
  if (requestedChange) {
    return requestedChange;
  }

  const discoveryConfig = await readDiscoveryConfig(projectRoot, readJson);
  if (discoveryConfig?.activeChange) {
    return discoveryConfig.activeChange;
  }

  const changeDirs = [...new Set((await listChangeDirs(projectRoot))
    .filter((change) => !change.archived)
    .map((change) => change.id))]
    .sort();

  if (changeDirs.length === 1) {
    return changeDirs[0];
  }
  if (changeDirs.length === 0) {
    throw new Error('openprd/changes 下没有找到 OpenPrd change。');
  }
  throw new Error(`找到多个 OpenPrd change；请传入 --change <id>。已找到: ${changeDirs.join(', ')}`);
}

function extractProposalCapabilities(text) {
  const capabilities = [];
  for (const match of text.matchAll(/^- `([^`]+)`:/gm)) {
    capabilities.push(match[1]);
  }
  return capabilities;
}

function validateOpenSpecSpecText(relativePath, text, errors, checks) {
  const requirementMatches = [...text.matchAll(/^### Requirement:\s+(.+)$/gm)];
  const sectionMatches = [...text.matchAll(/^##\s+(ADDED|MODIFIED|REMOVED)\s+Requirements\s*$/gim)];

  if (sectionMatches.length === 0) {
    errors.push(`${relativePath} 必须包含 ADDED、MODIFIED 或 REMOVED Requirements 章节。`);
  }
  if (requirementMatches.length === 0) {
    errors.push(`${relativePath} 必须至少包含一个 "### Requirement:" 块。`);
  }

  for (let index = 0; index < requirementMatches.length; index += 1) {
    const match = requirementMatches[index];
    const title = match[1].trim();
    const start = match.index ?? 0;
    const end = requirementMatches[index + 1]?.index ?? text.length;
    const block = text.slice(start, end);
    const scenarioMatches = [...block.matchAll(/^#### Scenario:\s+(.+)$/gm)];
    if (scenarioMatches.length === 0) {
      errors.push(`${relativePath} 的 requirement "${title}" 必须至少包含一个 scenario。`);
      continue;
    }

    for (const scenarioMatch of scenarioMatches) {
      const scenarioStart = scenarioMatch.index ?? 0;
      const nextScenario = scenarioMatches.find((candidate) => (candidate.index ?? 0) > scenarioStart);
      const scenarioBlock = block.slice(scenarioStart, nextScenario?.index ?? block.length);
      if (!/- \*\*WHEN\*\*/.test(scenarioBlock)) {
        errors.push(`${relativePath} 的 scenario "${scenarioMatch[1].trim()}" 缺少 WHEN。`);
      }
      if (!/- \*\*THEN\*\*/.test(scenarioBlock)) {
        errors.push(`${relativePath} 的 scenario "${scenarioMatch[1].trim()}" 缺少 THEN。`);
      }
    }
  }

  checks.push(`${relativePath}: ${requirementMatches.length} 个 requirement。`);
}

export async function validateOpenSpecChangeWorkspace(projectRoot, options = {}) {
  const changeId = await resolveOpenSpecChangeId(projectRoot, options.change);
  const changeDir = await resolveChangeDir(projectRoot, changeId);
  const errors = [];
  const warnings = [];
  const checks = [];

  if (!(await exists(changeDir))) {
    errors.push(`缺少 OpenPrd change 目录: ${path.relative(projectRoot, changeDir)}`);
    return {
      ok: false,
      valid: false,
      projectRoot,
      changeId,
      changeDir,
      errors,
      warnings,
      checks,
      specs: [],
      taskVolume: { errors: [], checks: [], files: [] },
    };
  }

  const metadataPaths = [cjoin(changeDir, '.openprd.yaml'), cjoin(changeDir, '.openspec.yaml')];
  for (const metadataPath of metadataPaths) {
    if (await exists(metadataPath)) {
      await readYaml(metadataPath).catch((error) => {
        errors.push(`${path.relative(projectRoot, metadataPath)} 无效: ${error.message}`);
      });
      break;
    }
  }

  const proposalPath = cjoin(changeDir, 'proposal.md');
  let proposalText = '';
  if (!(await exists(proposalPath))) {
    errors.push(`${path.relative(projectRoot, proposalPath)} 是必需文件。`);
  } else {
    proposalText = await readText(proposalPath);
    if (!proposalText.trim()) {
      errors.push(`${path.relative(projectRoot, proposalPath)} 不能为空。`);
    }
    const requiredHeadingGroups = [
      ['## 背景与原因', '## Why', '## 为什么'],
      ['## 变更内容', '## What Changes'],
      ['## 影响范围', '## Impact', '## 影响'],
    ];
    for (const headings of requiredHeadingGroups) {
      if (!headings.some((heading) => proposalText.includes(heading))) {
        warnings.push(`${path.relative(projectRoot, proposalPath)} 缺少章节: ${headings[0]}`);
      }
    }
  }

  const designPath = cjoin(changeDir, 'design.md');
  if (!(await exists(designPath))) {
    warnings.push(`${path.relative(projectRoot, designPath)} 缺失；复杂变更建议补充设计依据。`);
  }

  const specsRoot = cjoin(changeDir, 'specs');
  const specs = [];
  if (!(await exists(specsRoot))) {
    errors.push(`${path.relative(projectRoot, specsRoot)} 是必需目录。`);
  } else {
    const specEntries = await fs.readdir(specsRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of specEntries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }
      const specPath = cjoin(specsRoot, entry.name, 'spec.md');
      const relativePath = path.relative(projectRoot, specPath);
      if (!(await exists(specPath))) {
        errors.push(`${relativePath} 是必需文件。`);
        continue;
      }
      const text = await readText(specPath);
      specs.push({ capability: entry.name, path: specPath, relativePath });
      validateOpenSpecSpecText(relativePath, text, errors, checks);
    }
  }

  if (specs.length === 0) {
    errors.push(`${path.relative(projectRoot, specsRoot)} 必须至少包含一个 capability spec。`);
  }

  const proposalCapabilities = extractProposalCapabilities(proposalText);
  for (const capability of proposalCapabilities) {
    if (!specs.some((spec) => spec.capability === capability)) {
      warnings.push(`proposal.md 中的 capability ${capability} 没有对应的 specs/${capability}/spec.md。`);
    }
  }
  for (const spec of specs) {
    if (proposalCapabilities.length > 0 && !proposalCapabilities.includes(spec.capability)) {
      warnings.push(`spec capability ${spec.capability} 未列入 proposal.md 的能力范围。`);
    }
  }

  const taskVolume = await analyzeOpenSpecTaskVolumes(projectRoot, { changeId });
  errors.push(...taskVolume.errors);
  checks.push(...taskVolume.checks);

  const standards = await checkStandardsWorkspace(projectRoot, {
    optional: !(await exists(cjoin(projectRoot, '.openprd'))),
    sourceManuals: options.sourceManuals,
    docsContent: options.docsContent,
  });
  if (!standards.skipped) {
    errors.push(...standards.errors);
    warnings.push(...standards.warnings);
    checks.push(...standards.checks);
    const hasStandardsTask = taskVolume.files.some((file) => file.text.includes('openprd standards') && file.text.includes('docs/basic'));
    if (!hasStandardsTask) {
      warnings.push(`${path.relative(projectRoot, changeDir)} 应包含 docs/basic 标准文档维护任务。`);
    }
  }

  checks.unshift(`OpenPrd change ${changeId}: ${specs.length} 个 spec delta。`);

  return {
    ok: errors.length === 0,
    valid: errors.length === 0,
    projectRoot,
    changeId,
    changeDir,
    errors,
    warnings,
    checks,
    specs,
    taskVolume,
    standards,
  };
}
