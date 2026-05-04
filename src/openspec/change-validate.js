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
    throw new Error('No OpenPrd changes found under openprd/changes.');
  }
  throw new Error(`Multiple OpenPrd changes found; pass --change <id>. Found: ${changeDirs.join(', ')}`);
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
    errors.push(`${relativePath} must contain an ADDED, MODIFIED, or REMOVED Requirements section.`);
  }
  if (requirementMatches.length === 0) {
    errors.push(`${relativePath} must contain at least one "### Requirement:" block.`);
  }

  for (let index = 0; index < requirementMatches.length; index += 1) {
    const match = requirementMatches[index];
    const title = match[1].trim();
    const start = match.index ?? 0;
    const end = requirementMatches[index + 1]?.index ?? text.length;
    const block = text.slice(start, end);
    const scenarioMatches = [...block.matchAll(/^#### Scenario:\s+(.+)$/gm)];
    if (scenarioMatches.length === 0) {
      errors.push(`${relativePath} requirement "${title}" must contain at least one scenario.`);
      continue;
    }

    for (const scenarioMatch of scenarioMatches) {
      const scenarioStart = scenarioMatch.index ?? 0;
      const nextScenario = scenarioMatches.find((candidate) => (candidate.index ?? 0) > scenarioStart);
      const scenarioBlock = block.slice(scenarioStart, nextScenario?.index ?? block.length);
      if (!/- \*\*WHEN\*\*/.test(scenarioBlock)) {
        errors.push(`${relativePath} scenario "${scenarioMatch[1].trim()}" is missing WHEN.`);
      }
      if (!/- \*\*THEN\*\*/.test(scenarioBlock)) {
        errors.push(`${relativePath} scenario "${scenarioMatch[1].trim()}" is missing THEN.`);
      }
    }
  }

  checks.push(`${relativePath}: ${requirementMatches.length} requirement(s).`);
}

export async function validateOpenSpecChangeWorkspace(projectRoot, options = {}) {
  const changeId = await resolveOpenSpecChangeId(projectRoot, options.change);
  const changeDir = await resolveChangeDir(projectRoot, changeId);
  const errors = [];
  const warnings = [];
  const checks = [];

  if (!(await exists(changeDir))) {
    errors.push(`Missing OpenPrd change directory: ${path.relative(projectRoot, changeDir)}`);
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
        errors.push(`Invalid ${path.relative(projectRoot, metadataPath)}: ${error.message}`);
      });
      break;
    }
  }

  const proposalPath = cjoin(changeDir, 'proposal.md');
  let proposalText = '';
  if (!(await exists(proposalPath))) {
    errors.push(`${path.relative(projectRoot, proposalPath)} is required.`);
  } else {
    proposalText = await readText(proposalPath);
    if (!proposalText.trim()) {
      errors.push(`${path.relative(projectRoot, proposalPath)} must not be empty.`);
    }
    for (const heading of ['## Why', '## What Changes', '## Impact']) {
      if (!proposalText.includes(heading)) {
        warnings.push(`${path.relative(projectRoot, proposalPath)} is missing ${heading}.`);
      }
    }
  }

  const designPath = cjoin(changeDir, 'design.md');
  if (!(await exists(designPath))) {
    warnings.push(`${path.relative(projectRoot, designPath)} is missing; complex changes should include design rationale.`);
  }

  const specsRoot = cjoin(changeDir, 'specs');
  const specs = [];
  if (!(await exists(specsRoot))) {
    errors.push(`${path.relative(projectRoot, specsRoot)} is required.`);
  } else {
    const specEntries = await fs.readdir(specsRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of specEntries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }
      const specPath = cjoin(specsRoot, entry.name, 'spec.md');
      const relativePath = path.relative(projectRoot, specPath);
      if (!(await exists(specPath))) {
        errors.push(`${relativePath} is required.`);
        continue;
      }
      const text = await readText(specPath);
      specs.push({ capability: entry.name, path: specPath, relativePath });
      validateOpenSpecSpecText(relativePath, text, errors, checks);
    }
  }

  if (specs.length === 0) {
    errors.push(`${path.relative(projectRoot, specsRoot)} must contain at least one capability spec.`);
  }

  const proposalCapabilities = extractProposalCapabilities(proposalText);
  for (const capability of proposalCapabilities) {
    if (!specs.some((spec) => spec.capability === capability)) {
      warnings.push(`Proposal capability ${capability} has no matching specs/${capability}/spec.md.`);
    }
  }
  for (const spec of specs) {
    if (proposalCapabilities.length > 0 && !proposalCapabilities.includes(spec.capability)) {
      warnings.push(`Spec capability ${spec.capability} is not listed in proposal.md capabilities.`);
    }
  }

  const taskVolume = await analyzeOpenSpecTaskVolumes(projectRoot, { changeId });
  errors.push(...taskVolume.errors);
  checks.push(...taskVolume.checks);

  const standards = await checkStandardsWorkspace(projectRoot, { optional: !(await exists(cjoin(projectRoot, '.openprd'))) });
  if (!standards.skipped) {
    errors.push(...standards.errors);
    warnings.push(...standards.warnings);
    checks.push(...standards.checks);
    const hasStandardsTask = taskVolume.files.some((file) => file.text.includes('openprd standards') && file.text.includes('docs/basic'));
    if (!hasStandardsTask) {
      warnings.push(`${path.relative(projectRoot, changeDir)} should include a docs/basic standards maintenance task.`);
    }
  }

  checks.unshift(`OpenPrd change ${changeId}: ${specs.length} spec delta(s).`);

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
