import fs from 'node:fs/promises';
import path from 'node:path';

import { buildReviewPresentationFeedback } from './html-artifacts.js';

export const REVIEW_PRESENTATION_TEMPLATE = {
  mapNodes: {
    problem: { title: '问题定义', text: '30字内说明问题' },
    goal: { title: '目标', text: '30字内说明目标' },
    scope: { title: '范围', text: '30字内说明范围' },
    flow: { title: '流程', text: '30字内说明主流程' },
    risk: { title: '风险', text: '30字内说明风险' },
  },
  flowNodes: [
    { text: '30字内说明第1步' },
    { text: '30字内说明第2步' },
    { text: '30字内说明第3步' },
  ],
};

export function buildReviewPresentationTemplatePayload() {
  return {
    intent: 'Agent 先按这个模板写 reviewPresentation，再用本脚本校验；不要让 HTML 截断文案。',
    presentationTemplate: REVIEW_PRESENTATION_TEMPLATE,
    presentationContract: buildReviewPresentationFeedback({ sections: {} }).contract,
  };
}

export async function reviewPresentationWorkspace(projectRoot, options = {}) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const snapshotPath = await resolveReviewPresentationSnapshotPath(resolvedProjectRoot, options.version);
  const snapshot = await readJson(snapshotPath);
  let presentationSource = snapshot.reviewPresentation ? 'snapshot' : null;

  if (options.presentationPath) {
    const presentationPath = path.resolve(options.presentationPath);
    snapshot.reviewPresentation = normalizeReviewPresentationInput(await readJson(presentationPath));
    presentationSource = presentationPath;
  }

  if (options.write && !options.presentationPath) {
    throw new Error('--write 需要配合 --presentation，避免误写没有更新的展示文案。');
  }

  const feedback = buildReviewPresentationFeedback(snapshot);
  const result = {
    ok: feedback.violations.length === 0,
    versionId: snapshot.versionId,
    title: snapshot.title,
    snapshotPath,
    presentationSource,
    presentationContract: feedback.contract,
    presentationFeedback: feedback.violations,
  };

  if (options.write) {
    await fs.writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    result.written = snapshotPath;
  }

  return result;
}

export function normalizeReviewPresentationVersionId(version) {
  if (!version) return null;
  const text = `${version}`.trim().toLowerCase();
  const digits = text.replace(/^v/u, '');
  return /^\d+$/u.test(digits) ? `v${digits.padStart(4, '0')}` : text;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function resolveReviewPresentationSnapshotPath(projectRoot, version) {
  const workspaceRoot = path.join(projectRoot, '.openprd');
  const versionId = normalizeReviewPresentationVersionId(version);
  if (versionId) {
    return path.join(workspaceRoot, 'state', 'versions', `${versionId}.json`);
  }

  const versionIndexPath = path.join(workspaceRoot, 'state', 'version-index.json');
  const versionIndex = await readJson(versionIndexPath);
  const latestVersionId = versionIndex.at(-1)?.versionId;
  if (!latestVersionId) {
    throw new Error(`未找到 PRD 版本索引: ${versionIndexPath}`);
  }
  return path.join(workspaceRoot, 'state', 'versions', `${latestVersionId}.json`);
}

function normalizeReviewPresentationInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('presentation JSON 必须是对象。');
  }
  if (value.reviewPresentation && typeof value.reviewPresentation === 'object' && !Array.isArray(value.reviewPresentation)) {
    return value.reviewPresentation;
  }
  return value;
}
