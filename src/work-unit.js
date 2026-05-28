import path from 'node:path';
import crypto from 'node:crypto';
import { readJson, writeJson } from './fs-utils.js';
import { timestamp } from './time.js';

function normalizeWorkUnitId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const text = String(value).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(text)) {
    throw new Error('Work unit id must start with a letter or number and only contain letters, numbers, dot, underscore, colon, or dash.');
  }
  return text;
}

function generateWorkUnitId() {
  const compactTime = timestamp().replace(/[^0-9]/g, '').slice(0, 14);
  return `wu-${compactTime}-${crypto.randomBytes(4).toString('hex')}`;
}

function workUnitFileName(workUnitId) {
  return `${workUnitId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
}

function workUnitStatePath(ws, workUnitId) {
  return path.join(ws.workspaceRoot, 'engagements', 'work-units', workUnitFileName(workUnitId));
}

function resolveTargetRoot(ws, value) {
  return value ? path.resolve(ws.projectRoot, value) : ws.projectRoot;
}

async function readWorkUnitBinding(ws, workUnitId) {
  if (!workUnitId) {
    return null;
  }
  return readJson(workUnitStatePath(ws, workUnitId)).catch(() => null);
}

async function writeWorkUnitBinding(ws, {
  snapshot,
  reviewArtifact,
  stableReviewArtifact,
  reviewPath,
  activeReviewPath,
  reviewBundle,
  targetRoot,
  status = 'pending-confirmation',
}) {
  if (!snapshot.workUnitId) {
    return null;
  }
  const filePath = workUnitStatePath(ws, snapshot.workUnitId);
  const previous = await readJson(filePath).catch(() => null);
  const binding = {
    ...(previous ?? {}),
    version: 1,
    workUnitId: snapshot.workUnitId,
    title: snapshot.title,
    status,
    projectRoot: ws.projectRoot,
    workspaceRoot: ws.workspaceRoot,
    targetRoot: targetRoot ?? snapshot.targetRoot ?? ws.projectRoot,
    latestVersionId: snapshot.versionId,
    latestVersionDigest: snapshot.digest,
    reviewPath: reviewPath ?? stableReviewArtifact ?? null,
    activeReviewPath: activeReviewPath ?? reviewArtifact ?? null,
    reviewArtifact: reviewPath ?? stableReviewArtifact ?? null,
    activeReviewArtifact: activeReviewPath ?? reviewArtifact ?? null,
    artifactBundle: reviewBundle ?? previous?.artifactBundle ?? null,
    createdAt: previous?.createdAt ?? snapshot.createdAt,
    updatedAt: timestamp(),
  };
  await writeJson(filePath, binding);
  return {
    ...binding,
    path: filePath,
  };
}

export {
  generateWorkUnitId,
  normalizeWorkUnitId,
  readWorkUnitBinding,
  resolveTargetRoot,
  writeWorkUnitBinding,
};
