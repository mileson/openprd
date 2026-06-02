/*
 * 核心功能
 * 从 package.json 与项目级 release-ledger 生成 GitHub Release 标题和正文。
 *
 * 输入
 * 接收项目根目录、目标版本号、tag 和可选标题覆盖。
 *
 * 输出
 * 返回结构化 GitHub Release payload，或把正文写入指定 Markdown 文件。
 *
 * 定位
 * 位于 OpenPrd 的开源发布表达层，保证 GitHub Release 与 release-ledger 共用同一份版本事实。
 *
 * 依赖
 * 仅依赖 Node 内置文件系统和 change-summary，不要求安装额外 node_modules。
 *
 * 维护规则
 * 发现 package version、tag 或 release-ledger 条目不一致时必须显式失败，避免出现有版本但没有对应 Release 的发布。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildChangeSummaryFromEntries } from './change-summary.js';

function cjoin(...parts) {
  return path.join(...parts);
}

async function readJson(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text);
}

function normalizeVersionInput(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.startsWith('v') ? text.slice(1) : text;
}

function normalizeTagInput(value, fallbackVersion = '') {
  const text = String(value ?? '').trim();
  if (text) return text;
  const version = normalizeVersionInput(fallbackVersion);
  return version ? `v${version}` : '';
}

function renderReleaseMarkdown({ version, tag, changeSummary }) {
  const bullets = changeSummary.items.map((item) => `- ${item.sentence}`);
  return [
    '## 安装',
    '',
    '```bash',
    `npm install -g @openprd/cli@${version}`,
    '```',
    '',
    '## 本次更新',
    '',
    ...bullets,
    '',
    '## 发布信息',
    '',
    `- 版本：${version}`,
    `- Tag：${tag}`,
    '- 来源：GitHub Release 文案由当前项目的 release-ledger 自动生成。',
    '',
  ].join('\n').trimEnd();
}

function errorResult(projectRoot, code, error) {
  return {
    ok: false,
    projectRoot,
    code,
    error: error instanceof Error ? error.message : String(error),
  };
}

export async function buildGitHubReleasePayload(projectRoot, options = {}) {
  const resolvedRoot = path.resolve(projectRoot || '.');
  const packageJsonPath = cjoin(resolvedRoot, 'package.json');
  const ledgerPath = cjoin(resolvedRoot, '.openprd', 'state', 'release-ledger.json');

  try {
    const requestedVersion = normalizeVersionInput(options.version || options.tag || '');
    const pkg = await readJson(packageJsonPath).catch((error) => {
      throw new Error(`Missing package.json at ${packageJsonPath}: ${error.message}`);
    });
    const packageVersion = normalizeVersionInput(pkg.version);
    if (!packageVersion) {
      throw new Error(`Missing package version in ${packageJsonPath}.`);
    }
    if (requestedVersion && requestedVersion !== packageVersion) {
      throw new Error(`Package version mismatch: package.json is ${packageVersion} but requested ${requestedVersion}.`);
    }

    const version = requestedVersion || packageVersion;
    const tag = normalizeTagInput(options.tag, version);
    const title = String(options.title || '').trim() || `OpenPrd ${version}`;

    const ledger = await readJson(ledgerPath).catch((error) => {
      throw new Error(`Missing release ledger at ${ledgerPath}: ${error.message}`);
    });
    const versions = Array.isArray(ledger.versions) ? ledger.versions : [];
    const releaseEntry = versions.find((entry) => normalizeVersionInput(entry?.version) === version);
    if (!releaseEntry) {
      throw new Error([
        `Missing release-ledger entry for version ${version}.`,
        `Run: openprd release ${resolvedRoot} --set ${version}`,
        'Then add user-visible notes with `openprd release <path> --notes "..."` before publishing.',
      ].join(' '));
    }

    const changeSummary = buildChangeSummaryFromEntries(releaseEntry.items ?? [], {
      title: `${version} 变化摘要`,
      limit: null,
      fallbackType: '调整',
    });
    if (changeSummary.items.length === 0) {
      throw new Error([
        `Release-ledger entry for version ${version} has no release items.`,
        `Run: openprd release ${resolvedRoot} --notes "新增 / 修复 / 优化 ..."`,
      ].join(' '));
    }

    const markdown = renderReleaseMarkdown({ version, tag, changeSummary });
    return {
      ok: true,
      projectRoot: resolvedRoot,
      version,
      tag,
      title,
      packageName: typeof pkg.name === 'string' ? pkg.name : null,
      packageJsonPath,
      ledgerPath,
      itemCount: changeSummary.items.length,
      changeSummary,
      markdown,
    };
  } catch (error) {
    return errorResult(resolvedRoot, 'github-release-build-failed', error);
  }
}

export async function writeGitHubReleaseNotes(projectRoot, options = {}) {
  const payload = await buildGitHubReleasePayload(projectRoot, options);
  if (!payload.ok) {
    return payload;
  }

  const out = path.resolve(options.out || cjoin(payload.projectRoot, 'release-notes.md'));
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${payload.markdown.trimEnd()}\n`, 'utf8');
  return {
    ...payload,
    out,
  };
}
