import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonicalReviewPath, defaultReviewArtifactPath, renderReviewArtifact, renderReviewEntryHtml, writeHtmlArtifact } from './html-artifacts.js';
import { summarizeSnapshot } from './prd-core.js';
import { appendWorkflowEvent, buildWorkflowTaskGraph, loadWorkspace, readVersionIndex, readVersionSnapshot, writeVersionIndex, writeVersionSnapshot } from './workspace-core.js';
import { exists, readText, writeJson } from './fs-utils.js';
import { writeWorkUnitBinding } from './work-unit.js';
import { timestamp } from './time.js';

function legacyWorkUnitId(ws, snapshot) {
  const versionId = snapshot.versionId ?? 'v0000';
  const source = [
    ws.projectRoot,
    versionId,
    snapshot.digest ?? '',
    snapshot.title ?? '',
  ].join('\0');
  const suffix = crypto.createHash('sha256').update(source).digest('hex').slice(0, 8);
  return `wu-legacy-${versionId}-${suffix}`;
}

function sortVersionIds(versionIds) {
  return [...versionIds].sort((a, b) => {
    const numberA = Number(String(a).replace(/^v/i, ''));
    const numberB = Number(String(b).replace(/^v/i, ''));
    if (Number.isFinite(numberA) && Number.isFinite(numberB) && numberA !== numberB) {
      return numberA - numberB;
    }
    return String(a).localeCompare(String(b));
  });
}

async function collectVersionIds(ws) {
  const index = await readVersionIndex(ws);
  const ids = new Set(index.map((entry) => entry.versionId).filter(Boolean));
  const files = await fs.readdir(ws.paths.versionsDir).catch(() => []);
  for (const file of files) {
    if (file.endsWith('.json')) {
      ids.add(path.basename(file, '.json'));
    }
  }
  return sortVersionIds(ids);
}

async function loadBackfillSnapshot(ws, versionId) {
  const snapshot = await readVersionSnapshot(ws, versionId);
  if (!snapshot) {
    return null;
  }
  if (snapshot.content) {
    return snapshot;
  }
  const markdownPath = path.join(ws.paths.versionsDir, `${versionId}.md`);
  const content = await readText(markdownPath).catch(() => null);
  return content ? { ...snapshot, content } : snapshot;
}

function resolveBackfillStatus(ws, snapshot, isLatest) {
  const currentState = ws.data.currentState ?? {};
  const stored = currentState.reviewStatus;
  if (isLatest && stored?.versionId === snapshot.versionId && stored.status) {
    return stored.status;
  }
  if (isLatest && ['frozen', 'handed_off'].includes(currentState.status)) {
    return 'confirmed';
  }
  return 'pending-confirmation';
}

function buildBackfilledSnapshot(ws, snapshot, isLatest) {
  const content = snapshot.content ?? '';
  const digest = snapshot.digest ?? crypto.createHash('sha256').update(content).digest('hex');
  return {
    ...snapshot,
    digest,
    workUnitId: snapshot.workUnitId ?? legacyWorkUnitId(ws, { ...snapshot, digest }),
    targetRoot: snapshot.targetRoot ?? (isLatest ? ws.data.currentState?.targetRoot : null) ?? ws.projectRoot,
  };
}

async function writeReviewBundle(ws, snapshot, isLatest) {
  const activeReviewArtifact = defaultReviewArtifactPath(ws);
  const reviewPath = canonicalReviewPath(ws, snapshot.versionId);
  await writeHtmlArtifact(reviewPath, renderReviewArtifact({ snapshot }));

  if (isLatest) {
    await writeHtmlArtifact(activeReviewArtifact, renderReviewEntryHtml({
      entryPath: activeReviewArtifact,
      reviewPath,
      title: `${snapshot.title} / 评审入口`,
    }));
  }

  return {
    activeReviewArtifact: isLatest ? activeReviewArtifact : null,
    reviewPath,
  };
}

function snapshotNeedsIdentityUpdate(before, after) {
  return before.digest !== after.digest
    || before.workUnitId !== after.workUnitId
    || before.targetRoot !== after.targetRoot;
}

async function backfillWorkUnitsWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const dryRun = Boolean(options.dryRun);
  const versionIds = await collectVersionIds(ws);
  const latestVersionId = versionIds.at(-1) ?? null;
  const changes = [];
  const bindings = [];
  const errors = [];
  let changedVersions = 0;

  for (const versionId of versionIds) {
    const snapshot = await loadBackfillSnapshot(ws, versionId);
    if (!snapshot) {
      errors.push(`Missing version snapshot: ${versionId}`);
      continue;
    }

    const isLatest = versionId === latestVersionId;
    const nextSnapshot = buildBackfilledSnapshot(ws, snapshot, isLatest);
    const needsSnapshotUpdate = snapshotNeedsIdentityUpdate(snapshot, nextSnapshot);
    const status = resolveBackfillStatus(ws, nextSnapshot, isLatest);
    const activeReviewArtifact = isLatest ? defaultReviewArtifactPath(ws) : null;

    changes.push({
      path: path.relative(ws.projectRoot, path.join(ws.paths.versionsDir, `${versionId}.json`)),
      status: dryRun ? 'planned' : (needsSnapshotUpdate ? 'updated' : 'unchanged'),
      versionId,
      workUnitId: nextSnapshot.workUnitId,
    });
    changes.push({
      path: path.relative(ws.projectRoot, canonicalReviewPath(ws, nextSnapshot.versionId)),
      status: dryRun ? 'planned' : 'refreshed',
      versionId,
      workUnitId: nextSnapshot.workUnitId,
    });

    if (dryRun) {
      changedVersions += 1;
      continue;
    }

    if (needsSnapshotUpdate) {
      await writeVersionSnapshot(ws, nextSnapshot);
    }
    const writtenReview = await writeReviewBundle(ws, nextSnapshot, isLatest);
    const binding = await writeWorkUnitBinding(ws, {
      snapshot: nextSnapshot,
      reviewPath: writtenReview.reviewPath,
      activeReviewPath: writtenReview.activeReviewArtifact,
      targetRoot: nextSnapshot.targetRoot,
      status,
    });
    if (binding) {
      bindings.push(binding);
      changes.push({
        path: path.relative(ws.projectRoot, binding.path),
        status: 'updated',
        versionId,
        workUnitId: nextSnapshot.workUnitId,
      });
    }

    changedVersions += 1;
  }

  if (!dryRun && versionIds.length > 0) {
    const snapshots = [];
    for (const versionId of versionIds) {
      const snapshot = await readVersionSnapshot(ws, versionId);
      if (snapshot) {
        snapshots.push(summarizeSnapshot(snapshot));
      }
    }
    await writeVersionIndex(ws, snapshots);

    const latestSnapshot = await readVersionSnapshot(ws, latestVersionId);
    if (latestSnapshot) {
      const currentState = ws.data.currentState ?? {};
      const status = resolveBackfillStatus(ws, latestSnapshot, true);
      const nextState = {
        ...currentState,
        latestVersionId: latestSnapshot.versionId,
        latestVersionDigest: latestSnapshot.digest,
        activeWorkUnitId: latestSnapshot.workUnitId,
        targetRoot: latestSnapshot.targetRoot,
        reviewStatus: {
          ...(currentState.reviewStatus ?? {}),
          versionId: latestSnapshot.versionId,
          workUnitId: latestSnapshot.workUnitId,
          status,
          reviewPath: canonicalReviewPath(ws, latestSnapshot.versionId),
          entryPath: defaultReviewArtifactPath(ws),
          artifact: defaultReviewArtifactPath(ws),
          stableArtifact: canonicalReviewPath(ws, latestSnapshot.versionId),
          updatedAt: currentState.reviewStatus?.updatedAt ?? timestamp(),
        },
      };
      await writeJson(ws.paths.currentState, nextState);
      await writeJson(ws.paths.taskGraph, buildWorkflowTaskGraph(latestSnapshot));
    }

    await appendWorkflowEvent(ws, 'work_units_backfilled', {
      versions: versionIds.length,
      changedVersions,
    });
  }

  return {
    ok: errors.length === 0,
    action: 'backfill-work-units',
    projectRoot: ws.projectRoot,
    workspaceRoot: ws.workspaceRoot,
    dryRun,
    totalVersions: versionIds.length,
    changedVersions,
    bindings,
    changes,
    errors,
  };
}

export { backfillWorkUnitsWorkspace };
