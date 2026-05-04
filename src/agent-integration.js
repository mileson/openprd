import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { timestamp } from './time.js';

const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OPENPRD_AGENT_TOOLS = ['codex', 'claude', 'cursor'];
const OPENPRD_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];
const OPENPRD_HOOK_EVENTS_WITH_MATCHER = new Set(['PreToolUse', 'PostToolUse']);
const OPENPRD_HARNESS_DIR = cjoin('.openprd', 'harness');
const OPENPRD_HARNESS_EVENTS = cjoin(OPENPRD_HARNESS_DIR, 'events.jsonl');
const OPENPRD_HARNESS_HOOK_STATE = cjoin(OPENPRD_HARNESS_DIR, 'hook-state.json');
const OPENPRD_HARNESS_MANIFEST = cjoin(OPENPRD_HARNESS_DIR, 'install-manifest.json');
const OPENPRD_HARNESS_DRIFT = cjoin(OPENPRD_HARNESS_DIR, 'drift-report.json');
const LEGACY_CODEX_HOOK_OUTPUT_FIELDS = ['should_stop', 'additional_contexts', 'should_block', 'block_reason'];

const CANONICAL_SKILLS = [
  {
    id: 'openprd-shared',
    description: 'Shared rules for OpenPrd workspaces, language policy, gates, and workspace-first reasoning.',
    body: [
      '# OpenPrd Shared',
      '',
      'Use this rulebook for all OpenPrd work.',
      '',
      '## Read Set',
      '',
      '- `.openprd/state/current.json`',
      '- `.openprd/state/task-graph.json`',
      '- `.openprd/harness/install-manifest.json`',
      '- `.openprd/harness/hook-state.json`',
      '- `docs/basic/`',
      '',
      '## Operating Rules',
      '',
      '- Rebuild context from `.openprd/` before acting.',
      '- Prefer `openprd status .` and `openprd next .` before choosing a mutating command.',
      '- User-facing docs, progress logs, proposals, prompts, and reports should use Simplified Chinese by default; keep only necessary proper nouns, command names, file paths, field names, and API terms in their original form.',
      '- Diagram contracts are user-facing artifacts: `title`, `subtitle`, component names/subtitles/details, flow labels, summary cards, side panels, and review instructions must be written in Simplified Chinese when `locale` is `zh-CN`.',
      '- Time shown to users must use Shanghai time in `YYYY-MM-DD HH:mm:ss` format, without `T`, `Z`, or millisecond suffixes.',
      '- Keep unresolved assumptions visible.',
      '- Use `docs/basic/` as the only project baseline docs path.',
      '- Do not claim readiness until `openprd validate .` and `openprd standards . --verify` pass.',
      '- If generated agent files look stale, run `openprd doctor .` before guessing.',
      '',
      '## Write Discipline',
      '',
      '- Read-only commands first: `status`, `next`, `validate`, `standards --verify`, `doctor`.',
      '- Mutating commands only after the next gate is understood.',
      '- High-risk commands require green gates: `freeze`, `handoff`, `change --apply`, `change --archive`, commits, pushes, releases, and publishing.',
      '',
      '## Repair Path',
      '',
      '1. Run `openprd doctor .`.',
      '2. Run `openprd update .` if generated guidance or hooks drifted.',
      '3. Run `openprd standards . --verify` and repair docs/manual standards.',
      '4. Run `openprd validate .` before reporting readiness.',
      '',
    ].join('\n'),
  },
  {
    id: 'openprd-harness',
    description: 'Drive an OpenPrd workspace through clarify, synthesize, diagram, freeze, handoff, change, tasks, and verification.',
    body: [
      '# OpenPrd Harness',
      '',
      'Use this skill whenever a user asks for product planning, requirement refinement, implementation preparation, or execution readiness.',
      '',
      '## Default Flow',
      '',
      '1. Run `openprd run . --context` for the hook-stable execution view.',
      '2. Run `openprd status .` and `openprd next .` when you need full workflow detail.',
      '3. If facts are missing, ask or capture them with `openprd clarify .` and `openprd capture .`.',
      '4. If a PRD needs to become work, run `openprd change . --generate --change <id>`.',
      '5. For long-running implementation, run `openprd loop . --plan --change <id>` and execute one loop task per fresh agent session.',
      '6. During implementation, keep `docs/basic/`, file manuals, and folder README docs current.',
      '7. Before readiness, run `openprd run . --verify`.',
      '',
      '## Gate Protocol',
      '',
      '- Never skip `openprd run . --context`; it is the hook-friendly control surface.',
      '- For existing projects, prefer discovery before synthesis when requirements are under-specified.',
      '- Before freeze or handoff, run `openprd run . --verify` and confirm review blockers are resolved.',
      '- For accepted spec promotion, run `openprd change . --validate --change <id>` before `--apply` or `--archive`.',
      '',
      '## Hook-Driven Loop',
      '',
      '- Treat `.openprd/harness/run-state.json` and `iterations.jsonl` as the durable loop state.',
      '- Hooks record each turn and recommend the next task/discovery/workflow action from OpenPrd state.',
      '- A failed gate leaves the task or coverage item unfinished, so the next run retries the same unit.',
      '- Record reusable learnings in `.openprd/harness/learnings.md`, local `AGENTS.md`, or `docs/basic/` when they apply beyond one story.',
      '',
      '## Long-Running Implementation Loop',
      '',
      '- Run `openprd loop . --init`, then `openprd loop . --plan --change <id>` to create `.openprd/harness/feature-list.json`.',
      '- Use `openprd loop . --next` to identify the next dependency-ready task.',
      '- Use `openprd loop . --run --agent codex --dry-run` or `openprd loop . --run --agent claude --dry-run` to generate the exact one-task prompt and launch command.',
      '- Each loop task is the full boundary for one fresh agent session. Do not continue into the next task inside the same session.',
      '- Finish the task with `openprd loop . --finish --item <task-id> --commit` after the task verify command and `openprd run . --verify` pass.',
      '- For frontend UI work, Codex desktop should prefer Computer Use; Codex CLI and Claude Code should prefer Playwright, MCP browser automation, or the project e2e tool.',
      '- `openprd loop . --finish` writes `.openprd/harness/test-reports/<task-id>.md`; commit this staged test report together with the task.',
      '- Keep `.openprd/harness/feature-list.json`, `progress.md`, `agent-sessions.jsonl`, `loop-state.json`, `loop-prompts/`, and `test-reports/` as durable implementation state.',
      '',
      '## Failure Protocol',
      '',
      '- If a command fails, do not continue by intuition.',
      '- Run `openprd run . --context`, `openprd doctor .`, and use the reported repair command.',
      '- Keep failed assumptions in `.openprd/engagements/active/open-questions.md` when they affect product scope.',
      '',
      '## Historical Projects',
      '',
      '- Use `openprd fleet <root> --dry-run` before touching multiple old projects.',
      '- Use `openprd fleet <root> --update-openprd` to refresh only projects that already contain `.openprd/`.',
      '- Do not use `--setup-missing` unless the user explicitly wants OpenPrd to claim agent-only or plain projects.',
      '',
    ].join('\n'),
  },
  {
    id: 'openprd-standards',
    description: 'Initialize and verify docs/basic, file manual, and folder README standards.',
    body: [
      '# OpenPrd Standards',
      '',
      'Use this skill whenever docs, file manuals, folder manuals, or implementation readiness are in scope.',
      '',
      '## Required Docs',
      '',
      '- `docs/basic/file-structure.md`',
      '- `docs/basic/app-flow.md`',
      '- `docs/basic/prd.md`',
      '- `docs/basic/frontend-guidelines.md`',
      '- `docs/basic/backend-structure.md`',
      '- `docs/basic/tech-stack.md`',
      '',
      'Run `openprd standards . --verify` before reporting implementation readiness.',
      'For projects with source files, this gate also requires concrete `docs/basic/` content, file-header manuals, and `[project]_[folder]_README.md` folder manuals.',
      '',
      '## Synchronization Triggers',
      '',
      '- File or folder moved, added, or deleted: update `docs/basic/file-structure.md` and relevant folder README.',
      '- Product flow, state, route, or task behavior changed: update `docs/basic/app-flow.md`.',
      '- User-facing capability or acceptance criteria changed: update `docs/basic/prd.md`.',
      '- Framework, dependency, runtime, or build command changed: update `docs/basic/tech-stack.md`.',
      '- Frontend or backend structure changed: update the matching `docs/basic/` guide.',
      '',
      '## Gate',
      '',
      '`openprd standards . --verify` must pass before freeze, handoff, accepted spec apply/archive, commit, push, release, or publishing.',
      '',
    ].join('\n'),
  },
  {
    id: 'openprd-discovery-loop',
    description: 'Sustained OpenPrd discovery for existing projects, reference mining, and unclear requirements.',
    body: [
      '# OpenPrd Discovery Loop',
      '',
      'Use this skill when the user asks to continue, deepen, complete, compare, replicate, or comprehensively mine requirements.',
      '',
      '## Loop',
      '',
      '- Start or resume with `openprd discovery . --mode <brownfield|reference|requirement>`.',
      '- Advance one evidence-backed coverage item at a time.',
      '- Verify with `openprd discovery . --verify` before reporting the run as healthy.',
      '- Keep standards current through `openprd standards . --verify`.',
      '',
      '## Depth Rules',
      '',
      '- Each claim needs source, evidence path, and confidence.',
      '- Do not convert inferred behavior into accepted requirements without surfacing it as reviewable.',
      '- Large task files must be sharded and verified.',
      '- Stop only when coverage is exhausted, blocked, or explicitly handed off.',
      '',
    ].join('\n'),
  },
  {
    id: 'openprd-diagram-review',
    description: 'Generate and review OpenPrd architecture and product-flow diagrams before freeze.',
    body: [
      '# OpenPrd Diagram Review',
      '',
      'Use this skill when architecture, product flow, user journey, or visual confirmation is needed.',
      '',
      '- Generate architecture diagrams with `openprd diagram . --type architecture`.',
      '- Generate product-flow diagrams with `openprd diagram . --type product-flow`.',
      '- Use `--mark confirmed` only after the user has reviewed the artifact.',
      '',
      '## Contract Language',
      '',
      '- Diagram contracts are user-facing. When `locale` is `zh-CN`, write all visible text in Simplified Chinese.',
      '- This includes `title`, `subtitle`, `components[].name`, `components[].subtitle`, `components[].details`, `flows[].label`, `summaryCards[].title`, `summaryCards[].items`, `sidePanels[].title`, `sidePanels[].items`, and `reviewInstructions`.',
      '- Keep necessary product names, framework names, protocol names, command names, file paths, and field keys unchanged: examples include MotiClaw, Electron, TypeScript, CLI, API, JSON, NDJSON, dry-run, Host API, schema, `waiting_approval`.',
      '- Do not write full English sentences in zh-CN diagram contracts. Translate the sentence and preserve only necessary terms.',
      '- Before running `openprd diagram --input`, inspect the contract once and rewrite English-heavy visible text into Simplified Chinese.',
      '',
      '## Review Gate',
      '',
      '- Diagram output is not confirmation.',
      '- Confirmation requires the user or project owner to accept the structure.',
      '- If the diagram affects implementation, sync `docs/basic/app-flow.md`, `docs/basic/backend-structure.md`, or `docs/basic/frontend-guidelines.md`.',
      '',
    ].join('\n'),
  },
];

const CANONICAL_COMMANDS = [
  {
    id: 'next',
    title: 'OpenPrd Next',
    body: [
      'Run `openprd status .` and `openprd next .`, summarize the current gate, then execute the suggested OpenPrd action when safe.',
    ].join('\n'),
  },
  {
    id: 'standards',
    title: 'OpenPrd Standards',
    body: [
      'Run `openprd standards . --verify`. If it fails, repair `docs/basic/`, file manual templates, or folder README templates before continuing.',
    ].join('\n'),
  },
  {
    id: 'change',
    title: 'OpenPrd Change',
    body: [
      'Generate or inspect an OpenPrd change. Prefer `openprd change . --generate --change <id>`, then `openprd change . --validate --change <id>`.',
    ].join('\n'),
  },
  {
    id: 'discovery',
    title: 'OpenPrd Discovery',
    body: [
      'Start or resume OpenPrd discovery. Use `openprd discovery . --resume` when a run exists; otherwise choose the mode from context.',
    ].join('\n'),
  },
  {
    id: 'doctor',
    title: 'OpenPrd Doctor',
    body: [
      'Run `openprd doctor .` and repair missing AGENTS, skills, commands, hooks, standards, or validation gates.',
    ].join('\n'),
  },
  {
    id: 'verify',
    title: 'OpenPrd Verify',
    body: [
      'Run `openprd run . --verify`. It verifies standards, workspace validation, active change structure, and active discovery state before reporting readiness.',
    ].join('\n'),
  },
  {
    id: 'run',
    title: 'OpenPrd Run',
    body: [
      'Use the hook-stable OpenPrd execution loop. Start with `openprd run . --context`, execute the recommended task/discovery/workflow action, then run `openprd run . --verify` before claiming completion.',
    ].join('\n'),
  },
  {
    id: 'loop',
    title: 'OpenPrd Loop',
    body: [
      '使用长程 agent harness 做开发落地。',
      '',
      '1. Run `openprd loop . --init` once for the workspace.',
      '2. Run `openprd loop . --plan --change <id>` to build the feature list from structured change tasks.',
      '3. Run `openprd loop . --next` to inspect the next dependency-ready task.',
      '4. Run `openprd loop . --run --agent codex --dry-run` or `openprd loop . --run --agent claude --dry-run` to prepare one fresh single-task session.',
      '5. 每个任务都必须先自测；前端界面任务在 Codex 桌面优先用 Computer Use，在 CLI/Claude Code 优先用 Playwright 或 MCP 自动化。',
      '6. After the session completes, run `openprd loop . --finish --item <task-id> --commit` to verify, write the staged test report, mark done, update progress, and create the task commit.',
      '',
      'Do not continue into the next task inside the same agent session.',
    ].join('\n'),
  },
  {
    id: 'repair',
    title: 'OpenPrd Repair',
    body: [
      'Use `openprd doctor .` to identify drift or missing generated files. Run `openprd update .` for generated guidance drift, repair standards/docs manually, then re-run verification.',
    ].join('\n'),
  },
  {
    id: 'onboard',
    title: 'OpenPrd Onboard',
    body: [
      'Explain the current OpenPrd workspace by running `openprd status .`, `openprd next .`, and `openprd doctor .`, then summarize the current gate, blockers, standards state, and safest next command.',
    ].join('\n'),
  },
  {
    id: 'guard',
    title: 'OpenPrd Guard',
    body: [
      'Before a high-risk action, verify the harness gates: `openprd standards . --verify`, `openprd validate .`, and when relevant `openprd change . --validate --change <id>`.',
    ].join('\n'),
  },
  {
    id: 'fleet',
    title: 'OpenPrd Fleet',
    body: [
      'Audit or update historical projects. Start with `openprd fleet <root> --dry-run`; use `--update-openprd` only for projects that already have `.openprd/`, and reserve `--setup-missing` for explicitly selected projects.',
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
  return JSON.parse(await readText(filePath));
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function appendJsonl(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

async function packageVersion() {
  const pkg = await readJson(cjoin(PACKAGE_ROOT, 'package.json')).catch(() => ({}));
  return String(pkg.version ?? '0.0.0');
}

function checksum(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

async function fileChecksum(filePath) {
  const text = await readText(filePath);
  return checksum(text);
}

function normalizedRelativePath(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function harnessPath(projectRoot, relativePath) {
  return cjoin(projectRoot, relativePath);
}

function recordManagedFile(options, record) {
  if (!Array.isArray(options.managedFiles)) {
    return;
  }
  options.managedFiles.push(record);
}

function normalizeTools(value) {
  const raw = String(value ?? 'all').trim().toLowerCase();
  if (!raw || raw === 'all' || raw === 'auto') {
    return OPENPRD_AGENT_TOOLS;
  }
  const tools = raw.split(',').map((item) => item.trim()).filter(Boolean);
  const invalid = tools.filter((tool) => !OPENPRD_AGENT_TOOLS.includes(tool));
  if (invalid.length > 0) {
    throw new Error(`Unsupported OpenPrd agent tool(s): ${invalid.join(', ')}`);
  }
  return [...new Set(tools)];
}

function resolveCodexHome(options = {}) {
  return options.codexHome
    ?? process.env.OPENPRD_CODEX_HOME
    ?? process.env.CODEX_HOME
    ?? cjoin(os.homedir(), '.codex');
}

function displayPath(filePath) {
  const home = os.homedir();
  return filePath.startsWith(`${home}${path.sep}`) ? `~/${path.relative(home, filePath)}` : filePath;
}

function managedBlock(id, body) {
  return [
    `<!-- OPENPRD:${id}:START -->`,
    body.trimEnd(),
    `<!-- OPENPRD:${id}:END -->`,
    '',
  ].join('\n');
}

function upsertManagedBlock(text, id, body) {
  const start = `<!-- OPENPRD:${id}:START -->`;
  const end = `<!-- OPENPRD:${id}:END -->`;
  const block = managedBlock(id, body);
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, 'm');
  if (pattern.test(text)) {
    return text.replace(pattern, block);
  }
  return `${text.trimEnd()}\n\n${block}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generatedMarker({ adapter, source, version, body, commentStyle = 'html' }) {
  const lines = [
    'OPENPRD:GENERATED',
    `adapter=${adapter}`,
    `source=${source}`,
    `version=${version}`,
    `checksum=${checksum(body)}`,
  ];
  if (commentStyle === 'js') {
    return `/* ${lines.join('\n')}\n*/`;
  }
  return [
    '<!-- OPENPRD:GENERATED',
    `adapter=${adapter}`,
    `source=${source}`,
    `version=${version}`,
    `checksum=${checksum(body)}`,
    '-->',
  ].join('\n');
}

function renderGeneratedFile(params) {
  const marker = generatedMarker(params);
  const body = params.body.trimEnd();
  if (params.commentStyle === 'js') {
    return `${marker}\n\n${body}\n`;
  }
  if (body.startsWith('---\n')) {
    const frontmatterEnd = body.indexOf('\n---\n', 4);
    if (frontmatterEnd >= 0) {
      const closeEnd = frontmatterEnd + '\n---\n'.length;
      return `${body.slice(0, closeEnd)}\n${marker}\n${body.slice(closeEnd)}\n`;
    }
  }
  return `${marker}\n\n${body}\n`;
}

async function writeGeneratedFile(filePath, params, options, changes) {
  const body = renderGeneratedFile(params);
  const rel = normalizedRelativePath(options.projectRoot, filePath);
  const current = await readText(filePath).catch(() => null);
  if (current && !current.includes('OPENPRD:GENERATED') && !options.force) {
    changes.push({ path: rel, status: 'skipped-user-file' });
    return;
  }
  await writeText(filePath, body);
  changes.push({ path: rel, status: current ? 'updated' : 'created' });
  recordManagedFile(options, {
    path: rel,
    scope: 'project',
    kind: 'generated-file',
    adapter: params.adapter,
    source: params.source,
    bodyChecksum: checksum(params.body),
    fileChecksum: checksum(body),
  });
}

async function upsertTextBlockFile(filePath, id, blockBody, options, changes) {
  const rel = normalizedRelativePath(options.projectRoot, filePath);
  const current = await readText(filePath).catch(() => '');
  const next = upsertManagedBlock(current || '# Project Instructions\n', id, blockBody);
  await writeText(filePath, next);
  changes.push({ path: rel, status: current ? 'updated-block' : 'created' });
  recordManagedFile(options, {
    path: rel,
    scope: 'project',
    kind: 'managed-block',
    marker: `OPENPRD:${id}`,
    bodyChecksum: checksum(blockBody),
  });
}

function agentContractBody() {
  return [
    '## OpenPrd Harness',
    '',
    'This project is managed by OpenPrd. Agents should be led by the harness rather than by ad hoc user instructions.',
    '',
    '### Default Behavior',
    '',
    '1. Rebuild state from `.openprd/` before planning or changing files.',
    '2. Run `openprd run . --context` before choosing the next execution unit.',
    '3. If the user asks for implementation, generate or inspect an OpenPrd change before coding when the work has product or architecture impact.',
    '4. Keep `docs/basic/`, file manuals, and folder README docs synchronized during implementation.',
    '5. Before claiming readiness, run `openprd run . --verify`.',
    '6. Treat `.openprd/harness/` as the installed agent-control state: run state, iterations, events, hook state, install manifest, and drift report.',
    '7. For any OpenPrd diagram contract with `locale: zh-CN`, write visible labels, node text, flow labels, cards, panels, and review instructions in Simplified Chinese. Preserve only necessary proper nouns and technical field names.',
    '',
    '### Canonical Commands',
    '',
    '- `openprd next .` - choose the next harness action.',
    '- `openprd run . --context` - choose the next hook-stable execution unit.',
    '- `openprd run . --verify` - verify the current run gates.',
    '- `openprd loop . --plan --change <id>` - build the one-task-per-session feature list.',
    '- `openprd loop . --run --agent codex|claude --dry-run` - prepare a fresh single-task agent session.',
    '- `openprd loop . --finish --item <task-id> --commit` - verify, write staged test report, mark done, and create the task commit.',
    '- `openprd standards . --verify` - verify project documentation standards.',
    '- `openprd change . --validate --change <id>` - verify change structure.',
    '- `openprd discovery . --verify` - verify long-running discovery state.',
    '- `openprd doctor .` - check agent integration health.',
    '- `openprd update .` - repair generated agent guidance drift.',
    '- `openprd fleet <root> --dry-run` - audit historical projects before batch updates.',
    '',
    '`openprd setup` and `openprd update` also enable Codex hooks in the user Codex config when run from the CLI.',
    '',
    '### High-Risk Gate',
    '',
    'Before freeze, handoff, accepted spec apply/archive, commit, push, release, or publish, ensure `openprd run . --verify` and `openprd doctor .` are healthy.',
    '',
    'The only baseline documentation path is `docs/basic/`.',
    '',
  ].join('\n');
}

function renderSkill(skill, adapter) {
  return [
    '---',
    `name: ${skill.id}`,
    `description: ${skill.description}`,
    '---',
    '',
    skill.body,
  ].join('\n');
}

function renderCommand(command, adapter) {
  if (adapter === 'cursor') {
    return [
      `# ${command.title}`,
      '',
      command.body,
      '',
      'Always follow the OpenPrd managed rules in `.cursor/rules/openprd.mdc` and project `AGENTS.md`.',
      '',
    ].join('\n');
  }
  return [
    `# ${command.title}`,
    '',
    command.body,
    '',
    'Always rebuild state from `.openprd/` before acting.',
    '',
  ].join('\n');
}

function renderCursorRule() {
  return [
    '---',
    'description: OpenPrd harness rules',
    'globs:',
    '  - "**/*"',
    'alwaysApply: true',
    '---',
    '',
    '# OpenPrd Harness',
    '',
    agentContractBody(),
  ].join('\n');
}

function quoteForToml(value) {
  return JSON.stringify(value);
}

function hookCommand(projectRoot, eventName) {
  const hookPath = cjoin(projectRoot, '.codex', 'hooks', 'openprd-hook.mjs');
  return `node ${quoteShell(hookPath)} ${eventName}`;
}

function quoteShell(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function renderCodexHookRunner() {
  return `import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const eventName = process.argv[2] || 'Unknown';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let payload = {};
  try { payload = input.trim() ? JSON.parse(input) : {}; } catch {}
  const cwd = payload.cwd || process.cwd();
  const result = handle(eventName, cwd, payload);
  if (result) {
    process.stdout.write(JSON.stringify(result));
  }
});

function now() {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return \`\${parts.year}-\${parts.month}-\${parts.day} \${parts.hour}:\${parts.minute}:\${parts.second}\`;
}

function findProjectRoot(start) {
  let current = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(current, '.openprd'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(start || process.cwd());
    }
    current = parent;
  }
}

function harnessDir(root) {
  return path.join(root, '.openprd', 'harness');
}

function ensureHarness(root) {
  const dir = harnessDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const statePath = path.join(dir, 'hook-state.json');
  if (!fs.existsSync(statePath)) {
    writeJsonSync(statePath, {
      version: 1,
      active: true,
      lastEventAt: null,
      lastFingerprint: null,
      counters: {},
      recentFingerprints: {},
      suppressions: { inputLock: false },
    });
  }
  const eventsPath = path.join(dir, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) {
    fs.writeFileSync(eventsPath, '');
  }
}

function readJsonSync(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonSync(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\\n');
}

function appendEvent(root, event) {
  ensureHarness(root);
  fs.appendFileSync(path.join(harnessDir(root), 'events.jsonl'), JSON.stringify({ at: now(), ...event }) + '\\n');
}

function updateHookState(root, event) {
  ensureHarness(root);
  const statePath = path.join(harnessDir(root), 'hook-state.json');
  const state = readJsonSync(statePath, {
    version: 1,
    counters: {},
    recentFingerprints: {},
    suppressions: { inputLock: false },
  });
  state.lastEventAt = now();
  state.lastEvent = event.eventName;
  state.lastFingerprint = event.fingerprint;
  state.counters[event.eventName] = (state.counters[event.eventName] || 0) + 1;
  state.recentFingerprints = state.recentFingerprints || {};
  if (event.fingerprint) {
    state.recentFingerprints[event.fingerprint] = Date.now();
  }
  for (const [fingerprint, seenAt] of Object.entries(state.recentFingerprints)) {
    if (Date.now() - Number(seenAt) > 300000) {
      delete state.recentFingerprints[fingerprint];
    }
  }
  writeJsonSync(statePath, state);
  return state;
}

function isDuplicate(root, fingerprint, windowMs = 15000) {
  const state = readJsonSync(path.join(harnessDir(root), 'hook-state.json'), {});
  const seenAt = state?.recentFingerprints?.[fingerprint];
  return Boolean(seenAt && Date.now() - Number(seenAt) < windowMs);
}

function fingerprintFor(eventName, payload, risk) {
  const tool = payload.tool_name || payload.toolName || payload.name || '';
  const inputText = JSON.stringify(payload.tool_input || payload.toolInput || payload.input || payload || {}).slice(0, 2000);
  return crypto.createHash('sha256').update(JSON.stringify({ eventName, tool, inputText, risk: risk.level })).digest('hex').slice(0, 16);
}

function payloadText(payload) {
  return JSON.stringify(payload.tool_input || payload.toolInput || payload.input || payload || {});
}

function preview(text, max = 600) {
  return String(text || '').replace(/\\s+/g, ' ').trim().slice(0, max);
}

function runOpenPrd(args, cwd) {
  const command = process.env.OPENPRD_CLI || 'openprd';
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: process.env,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function recordRunHook(cwd, baseEvent, outcome) {
  const args = [
    'run',
    '.',
    '--record-hook',
    '--event',
    baseEvent.eventName,
    '--risk',
    baseEvent.risk.level,
    '--outcome',
    outcome,
  ];
  if (baseEvent.preview) {
    args.push('--preview', baseEvent.preview.slice(0, 300));
  }
  runOpenPrd(args, cwd);
}

function contextMessage(cwd) {
  const run = runOpenPrd(['run', '.', '--context'], cwd);
  if (run.ok) {
    return [
      run.stdout,
      'Follow the recommended OpenPrd run command. Before claiming completion, run openprd run . --verify.',
    ].filter(Boolean).join('\\n');
  }
  const status = runOpenPrd(['status', '.'], cwd);
  const next = runOpenPrd(['next', '.'], cwd);
  if (!status.ok && !next.ok) {
    return 'OpenPrd harness is installed, but this turn could not read workspace state. Run openprd doctor . before claiming readiness.';
  }
  return [
    'OpenPrd harness context:',
    status.ok ? status.stdout : '',
    next.ok ? next.stdout : '',
    'Follow OpenPrd next action and verify docs/basic standards before readiness.',
  ].filter(Boolean).join('\\n');
}

function classifyRisk(payload) {
  const text = payloadText(payload);
  const normalized = text.toLowerCase();
  const highPatterns = [
    /git\\s+push/,
    /git\\s+commit/,
    /npm\\s+publish/,
    /pnpm\\s+publish/,
    /yarn\\s+npm\\s+publish/,
    /gh\\s+release/,
    /rm\\s+-rf/,
    /openprd\\s+freeze\\b/,
    /openprd\\s+handoff\\b/,
    /openprd\\s+change\\s+.*--apply/,
    /openprd\\s+change\\s+.*--archive/,
  ];
  const mediumPatterns = [
    /apply_patch/,
    /npm\\s+install/,
    /npm\\s+i\\s/,
    /pnpm\\s+add/,
    /yarn\\s+add/,
    /bun\\s+add/,
    /openprd\\s+setup\\b/,
    /openprd\\s+update\\b/,
    /openprd\\s+standards\\s+.*--init/,
    /openprd\\s+change\\s+.*--generate/,
    /openprd\\s+tasks\\s+.*--advance/,
    /openprd\\s+discovery\\s+.*--advance/,
    /openprd\\s+(capture|classify|synthesize|diagram)\\b/,
  ];
  if (highPatterns.some((pattern) => pattern.test(normalized))) {
    return { level: 'high', reason: 'release, history, freeze, handoff, destructive, or accepted-change action' };
  }
  if (mediumPatterns.some((pattern) => pattern.test(normalized))) {
    return { level: 'medium', reason: 'workspace mutation or dependency/configuration change' };
  }
  return { level: 'low', reason: 'read-only or local exploratory action' };
}

function extractChangeId(text) {
  const match = String(text || '').match(/--change\\s+([a-zA-Z0-9._-]+)/);
  return match ? match[1] : null;
}

function runGateChecks(cwd, payload, risk) {
  const checks = [];
  const run = runOpenPrd(['run', '.', '--verify'], cwd);
  checks.push({ name: 'run-verify', ok: run.ok, output: run.stdout || run.stderr });
  const text = payloadText(payload);
  const changeId = extractChangeId(text);
  if (changeId && /openprd\\s+change\\s+.*--(apply|archive|validate)/i.test(text)) {
    const change = runOpenPrd(['change', '.', '--validate', '--change', changeId], cwd);
    checks.push({ name: 'change-validate', ok: change.ok, output: change.stdout || change.stderr });
  }
  return {
    ok: checks.every((check) => check.ok),
    checks,
    summary: checks.map((check) => \`\${check.name}: \${check.ok ? 'ok' : 'failed'}\`).join(', '),
  };
}

function hookSuppressed(root) {
  const state = readJsonSync(path.join(harnessDir(root), 'hook-state.json'), {});
  const lockPath = path.join(harnessDir(root), 'input-lock.json');
  const lock = readJsonSync(lockPath, null);
  return Boolean(state?.suppressions?.inputLock || (lock && lock.active));
}

function allowHook(additionalContext = null, outputEventName = eventName) {
  const result = { continue: true };
  if (additionalContext) {
    result.hookSpecificOutput = {
      hookEventName: outputEventName,
      additionalContext,
    };
  }
  return result;
}

function blockHook(reason) {
  return {
    decision: 'block',
    reason,
    systemMessage: reason,
  };
}

function handle(eventName, cwd, payload) {
  const root = findProjectRoot(cwd);
  ensureHarness(root);
  const risk = classifyRisk(payload);
  const fingerprint = fingerprintFor(eventName, payload, risk);
  const duplicate = isDuplicate(root, fingerprint);
  const baseEvent = {
    eventName,
    risk,
    fingerprint,
    duplicate,
    preview: preview(payloadText(payload)),
  };

  if (eventName === 'SessionStart' || eventName === 'UserPromptSubmit') {
    if (duplicate) {
      return allowHook();
    }
    const result = allowHook(contextMessage(root));
    appendEvent(root, { ...baseEvent, outcome: 'context-injected' });
    recordRunHook(root, baseEvent, 'context-injected');
    updateHookState(root, baseEvent);
    return result;
  }

  if (eventName === 'PreToolUse') {
    if (risk.level === 'high') {
      const gates = runGateChecks(root, payload, risk);
      appendEvent(root, { ...baseEvent, gates, outcome: gates.ok ? 'allowed-high-risk' : 'blocked-high-risk' });
      recordRunHook(root, baseEvent, gates.ok ? 'allowed-high-risk' : 'blocked-high-risk');
      updateHookState(root, baseEvent);
      if (!gates.ok) {
        return blockHook([
          'OpenPrd blocked a high-risk action because a harness gate failed.',
          gates.summary,
          ...gates.checks.filter((check) => !check.ok).map((check) => check.output).filter(Boolean),
          'Run openprd run . --context and openprd doctor .; repair the failed gate, then retry.',
        ].filter(Boolean).join('\\n'));
      }
      return allowHook(\`OpenPrd high-risk gate passed: \${gates.summary}.\`);
    }
    if (risk.level === 'medium') {
      appendEvent(root, { ...baseEvent, outcome: 'allowed-medium-risk' });
      recordRunHook(root, baseEvent, 'allowed-medium-risk');
      updateHookState(root, baseEvent);
      return allowHook('OpenPrd detected a mutating action. Keep docs/basic, file manuals, folder README docs, and relevant OpenPrd change/task state synchronized before claiming readiness.');
    }
    return allowHook();
  }

  if (eventName === 'PostToolUse') {
    const text = payloadText(payload);
    const failed = /command not found|no such file|permission denied|failed|error|exception/i.test(text);
    if (!failed) {
      return allowHook();
    }
    appendEvent(root, { ...baseEvent, outcome: failed ? 'tool-failure-detected' : 'tool-complete' });
    recordRunHook(root, baseEvent, failed ? 'tool-failure-detected' : 'tool-complete');
    updateHookState(root, baseEvent);
    if (failed && !duplicate) {
      return allowHook('A tool command appears to have failed. Use openprd doctor ., openprd next ., and the relevant verification command to choose the repair path.');
    }
    return allowHook();
  }

  if (eventName === 'Stop') {
    appendEvent(root, { ...baseEvent, outcome: 'stop-check' });
    recordRunHook(root, baseEvent, 'stop-check');
    updateHookState(root, baseEvent);
    if (hookSuppressed(root)) {
      return allowHook();
    }
    const run = runOpenPrd(['run', '.', '--context', '--json'], root);
    if (run.ok) {
      try {
        const parsed = JSON.parse(run.stdout);
        const command = parsed?.recommendation?.command || '';
        if (command && !/openprd\\s+next\\s+\\./.test(command)) {
          return {
            continue: true,
            systemMessage: \`OpenPrd still has a hook-driven next action:\\n\${parsed.recommendation.title}\\nSuggested command: \${command}\`,
          };
        }
      } catch {}
    }
  }

  appendEvent(root, { ...baseEvent, outcome: 'noop' });
  recordRunHook(root, baseEvent, 'noop');
  updateHookState(root, baseEvent);
return allowHook();
}
`;
}

function ensureFeatureCodexHooks(text) {
  const featureHeader = /^\[features\]\s*$/m;
  if (!featureHeader.test(text)) {
    const prefix = text.trimEnd();
    return `${prefix ? `${prefix}\n\n` : ''}[features]\ncodex_hooks = true\n`;
  }

  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '[features]');
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\[.+\]\s*$/.test(lines[index].trim())) {
      end = index;
      break;
    }
  }
  let replaced = false;
  for (let index = start + 1; index < end; index += 1) {
    if (/^\s*codex_hooks\s*=/.test(lines[index])) {
      lines[index] = 'codex_hooks = true';
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    lines.splice(end, 0, 'codex_hooks = true');
  }
  return lines.join('\n');
}

function codexHooksTomlBlock(projectRoot) {
  const groups = [];
  for (const eventName of OPENPRD_EVENTS) {
    groups.push(`[[hooks.${eventName}]]`);
    if (OPENPRD_HOOK_EVENTS_WITH_MATCHER.has(eventName)) {
      groups.push('matcher = "*"');
    }
    groups.push(`hooks = [{ type = "command", command = ${quoteForToml(hookCommand(projectRoot, eventName))}, timeout = 15000 }]`);
    groups.push('');
  }
  return groups.join('\n').trimEnd();
}

function upsertTomlManagedBlock(text, id, body) {
  const start = `# OPENPRD:${id}:START`;
  const end = `# OPENPRD:${id}:END`;
  const block = `${start}\n${body.trimEnd()}\n${end}\n`;
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, 'm');
  if (pattern.test(text)) {
    return text.replace(pattern, block);
  }
  return `${text.trimEnd()}\n\n${block}`;
}

async function writeCodexConfig(projectRoot, options, changes) {
  const configPath = cjoin(projectRoot, '.codex', 'config.toml');
  const rel = normalizedRelativePath(projectRoot, configPath);
  const current = await readText(configPath).catch(() => '');
  let next = ensureFeatureCodexHooks(current || '');
  next = upsertTomlManagedBlock(next, 'CODEX-HOOKS', codexHooksTomlBlock(projectRoot));
  await writeText(configPath, next);
  changes.push({ path: rel, status: current ? 'updated' : 'created' });
  recordManagedFile(options, {
    path: rel,
    scope: 'project',
    kind: 'codex-config',
    marker: 'OPENPRD:CODEX-HOOKS',
  });
}

async function writeCodexUserConfig(options, changes) {
  const configPath = cjoin(resolveCodexHome(options), 'config.toml');
  const current = await readText(configPath).catch(() => '');
  const next = ensureFeatureCodexHooks(current || '');
  if (next !== current) {
    await writeText(configPath, next);
  }
  changes.push({
    path: displayPath(configPath),
    status: current ? (next === current ? 'unchanged' : 'updated') : 'created',
  });
  recordManagedFile(options, {
    path: displayPath(configPath),
    scope: 'user',
    kind: 'codex-user-config',
    marker: 'codex_hooks = true',
  });
}

function codexHookGroup(projectRoot, eventName) {
  const group = {
    hooks: [
      {
        type: 'command',
        command: hookCommand(projectRoot, eventName),
        timeout: 15000,
      },
    ],
  };
  if (OPENPRD_HOOK_EVENTS_WITH_MATCHER.has(eventName)) {
    group.matcher = '*';
  }
  return group;
}

function isOpenPrdHookGroup(group) {
  return JSON.stringify(group ?? {}).includes('openprd-hook.mjs');
}

async function writeCodexHooksJson(projectRoot, options, changes) {
  const hooksPath = cjoin(projectRoot, '.codex', 'hooks.json');
  const rel = normalizedRelativePath(projectRoot, hooksPath);
  const existed = await exists(hooksPath);
  const current = existed ? await readJson(hooksPath).catch(() => ({})) : {};
  const next = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  for (const eventName of OPENPRD_EVENTS) {
    const existing = Array.isArray(next[eventName]) ? next[eventName] : [];
    next[eventName] = [
      ...existing.filter((group) => !isOpenPrdHookGroup(group)),
      codexHookGroup(projectRoot, eventName),
    ];
  }
  await writeJson(hooksPath, next);
  changes.push({ path: rel, status: existed ? 'updated' : 'created' });
  recordManagedFile(options, {
    path: rel,
    scope: 'project',
    kind: 'codex-hooks-json',
    marker: 'openprd-hook.mjs',
  });
}

async function writeCodexAdapter(projectRoot, options, changes) {
  const version = await packageVersion();
  for (const skill of CANONICAL_SKILLS) {
    await writeGeneratedFile(
      cjoin(projectRoot, '.codex', 'skills', skill.id, 'SKILL.md'),
      { adapter: 'codex', source: skill.id, version, body: renderSkill(skill, 'codex') },
      options,
      changes,
    );
  }
  for (const command of CANONICAL_COMMANDS) {
    await writeGeneratedFile(
      cjoin(projectRoot, '.codex', 'prompts', `openprd-${command.id}.md`),
      { adapter: 'codex', source: `command:${command.id}`, version, body: renderCommand(command, 'codex') },
      options,
      changes,
    );
  }
  const hookPath = cjoin(projectRoot, '.codex', 'hooks', 'openprd-hook.mjs');
  await writeGeneratedFile(
    hookPath,
    { adapter: 'codex', source: 'codex-hooks', version, body: renderCodexHookRunner(), commentStyle: 'js' },
    { ...options, force: true },
    changes,
  );
  await fs.chmod(hookPath, 0o755).catch(() => {});
  await writeCodexConfig(projectRoot, options, changes);
  await writeCodexHooksJson(projectRoot, options, changes);
  if (options.enableUserCodexConfig) {
    await writeCodexUserConfig(options, changes);
  }
}

async function writeClaudeAdapter(projectRoot, options, changes) {
  const version = await packageVersion();
  await upsertTextBlockFile(cjoin(projectRoot, 'CLAUDE.md'), 'CLAUDE', agentContractBody(), options, changes);
  for (const skill of CANONICAL_SKILLS) {
    await writeGeneratedFile(
      cjoin(projectRoot, '.claude', 'skills', skill.id, 'SKILL.md'),
      { adapter: 'claude', source: skill.id, version, body: renderSkill(skill, 'claude') },
      options,
      changes,
    );
  }
  for (const command of CANONICAL_COMMANDS) {
    await writeGeneratedFile(
      cjoin(projectRoot, '.claude', 'commands', 'openprd', `${command.id}.md`),
      { adapter: 'claude', source: `command:${command.id}`, version, body: renderCommand(command, 'claude') },
      options,
      changes,
    );
  }
}

async function writeCursorAdapter(projectRoot, options, changes) {
  const version = await packageVersion();
  await writeGeneratedFile(
    cjoin(projectRoot, '.cursor', 'rules', 'openprd.mdc'),
    { adapter: 'cursor', source: 'cursor-rules', version, body: renderCursorRule() },
    options,
    changes,
  );
  for (const command of CANONICAL_COMMANDS) {
    await writeGeneratedFile(
      cjoin(projectRoot, '.cursor', 'commands', `openprd-${command.id}.md`),
      { adapter: 'cursor', source: `command:${command.id}`, version, body: renderCommand(command, 'cursor') },
      options,
      changes,
    );
  }
}

async function ensureHarnessState(projectRoot) {
  await fs.mkdir(harnessPath(projectRoot, OPENPRD_HARNESS_DIR), { recursive: true });
  const hookStatePath = harnessPath(projectRoot, OPENPRD_HARNESS_HOOK_STATE);
  if (!(await exists(hookStatePath))) {
    await writeJson(hookStatePath, {
      version: 1,
      active: true,
      lastEventAt: null,
      lastFingerprint: null,
      counters: {},
      suppressions: {
        inputLock: false,
      },
    });
  }
  const eventsPath = harnessPath(projectRoot, OPENPRD_HARNESS_EVENTS);
  if (!(await exists(eventsPath))) {
    await writeText(eventsPath, '');
  }
}

async function writeInstallManifest(projectRoot, options, changes, tools) {
  const version = await packageVersion();
  const managedFiles = Array.isArray(options.managedFiles) ? options.managedFiles : [];
  const manifest = {
    version: 1,
    openprdVersion: version,
    action: options.action ?? 'setup',
    generatedAt: timestamp(),
    tools,
    managedFiles,
    hooks: {
      events: OPENPRD_EVENTS,
      state: OPENPRD_HARNESS_HOOK_STATE,
      eventsLog: OPENPRD_HARNESS_EVENTS,
      driftReport: OPENPRD_HARNESS_DRIFT,
    },
  };
  const manifestPath = harnessPath(projectRoot, OPENPRD_HARNESS_MANIFEST);
  const existed = await exists(manifestPath);
  await writeJson(manifestPath, manifest);
  changes.push({ path: OPENPRD_HARNESS_MANIFEST, status: existed ? 'updated' : 'created' });
  await appendJsonl(harnessPath(projectRoot, OPENPRD_HARNESS_EVENTS), {
    at: manifest.generatedAt,
    event: 'agent-integration-installed',
    action: manifest.action,
    tools,
    managedFileCount: managedFiles.length,
  });
  return manifest;
}

async function readInstallManifest(projectRoot) {
  return readJson(harnessPath(projectRoot, OPENPRD_HARNESS_MANIFEST)).catch(() => null);
}

async function inspectManagedFile(projectRoot, entry) {
  if (!entry || entry.scope === 'user') {
    return { ...entry, ok: true, skipped: true, reason: 'external-user-scope' };
  }
  const absolutePath = cjoin(projectRoot, entry.path);
  const fileExists = await exists(absolutePath);
  if (!fileExists) {
    return { ...entry, ok: false, reason: 'missing' };
  }
  const text = await readText(absolutePath);
  if (entry.marker && !text.includes(entry.marker)) {
    return { ...entry, ok: false, reason: 'missing-marker' };
  }
  if (entry.fileChecksum && checksum(text) !== entry.fileChecksum) {
    return { ...entry, ok: false, reason: 'checksum-drift' };
  }
  return { ...entry, ok: true, reason: 'ok' };
}

async function computeDriftReport(projectRoot, tools) {
  const manifest = await readInstallManifest(projectRoot);
  const checks = [];
  if (!manifest) {
    const report = {
      ok: false,
      checkedAt: timestamp(),
      tools,
      errors: [`${OPENPRD_HARNESS_MANIFEST} is missing. Run openprd update .`],
      checks,
    };
    await writeJson(harnessPath(projectRoot, OPENPRD_HARNESS_DRIFT), report);
    return report;
  }
  for (const entry of manifest.managedFiles ?? []) {
    checks.push(await inspectManagedFile(projectRoot, entry));
  }
  const errors = checks
    .filter((check) => !check.ok)
    .map((check) => `${check.path}: ${check.reason}`);
  const report = {
    ok: errors.length === 0,
    checkedAt: timestamp(),
    tools,
    manifestVersion: manifest.version,
    generatedAt: manifest.generatedAt,
    errors,
    checks,
  };
  await writeJson(harnessPath(projectRoot, OPENPRD_HARNESS_DRIFT), report);
  return report;
}

export async function setupOpenPrdAgentIntegration(projectRoot, options = {}) {
  const tools = normalizeTools(options.tools);
  const changes = [];
  const managedFiles = [];
  const normalizedOptions = {
    ...options,
    projectRoot,
    managedFiles,
  };

  await ensureHarnessState(projectRoot);
  await upsertTextBlockFile(cjoin(projectRoot, 'AGENTS.md'), 'AGENTS', agentContractBody(), normalizedOptions, changes);

  if (tools.includes('codex')) {
    await writeCodexAdapter(projectRoot, normalizedOptions, changes);
  }
  if (tools.includes('claude')) {
    await writeClaudeAdapter(projectRoot, normalizedOptions, changes);
  }
  if (tools.includes('cursor')) {
    await writeCursorAdapter(projectRoot, normalizedOptions, changes);
  }
  const manifest = await writeInstallManifest(projectRoot, normalizedOptions, changes, tools);

  const doctor = await doctorOpenPrdAgentIntegration(projectRoot, {
    tools,
    enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
    codexHome: options.codexHome,
  });
  return {
    ok: doctor.ok,
    action: options.action ?? 'setup',
    projectRoot,
    tools,
    changes,
    manifest,
    doctor,
  };
}

export async function updateOpenPrdAgentIntegration(projectRoot, options = {}) {
  return setupOpenPrdAgentIntegration(projectRoot, { ...options, action: 'update' });
}

async function fileHas(filePath, pattern) {
  const text = await readText(filePath).catch(() => '');
  return text.includes(pattern);
}

async function collectDoctorCheck(projectRoot, checks, pathName, predicate, message) {
  const absolutePath = cjoin(projectRoot, pathName);
  const ok = await predicate(absolutePath);
  checks.push({ path: pathName, ok, message: ok ? 'ok' : message });
}

async function collectDoctorCheckAbsolute(checks, pathName, absolutePath, predicate, message) {
  const ok = await predicate(absolutePath);
  checks.push({ path: pathName, ok, message: ok ? 'ok' : message });
}

function codexHookSmokePayload(projectRoot, eventName, smokeId) {
  if (eventName === 'SessionStart') {
    return { cwd: projectRoot, session_id: smokeId };
  }
  if (eventName === 'UserPromptSubmit') {
    return { cwd: projectRoot, prompt: `OpenPrd doctor hook smoke ${smokeId}` };
  }
  if (eventName === 'PreToolUse') {
    return {
      cwd: projectRoot,
      tool_name: 'Read',
      tool_input: {
        file_path: '.openprd/state/current.json',
      },
    };
  }
  if (eventName === 'PostToolUse') {
    return {
      cwd: projectRoot,
      tool_name: 'Read',
      tool_input: {
        file_path: '.openprd/state/current.json',
      },
      tool_response: {},
    };
  }
  return { cwd: projectRoot };
}

function validateCodexHookSmokeOutput(eventName, run) {
  if (run.error) {
    return `Codex hook smoke failed for ${eventName}: ${run.error.message}`;
  }
  if (run.status !== 0) {
    return `Codex hook smoke failed for ${eventName}: exit ${run.status}; ${String(run.stderr ?? '').trim() || 'no stderr'}`;
  }

  let output;
  try {
    output = JSON.parse(String(run.stdout ?? '').trim());
  } catch (error) {
    return `Codex hook smoke emitted invalid JSON for ${eventName}: ${error.message}`;
  }

  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return `Codex hook smoke emitted a non-object payload for ${eventName}.`;
  }

  const legacyFields = LEGACY_CODEX_HOOK_OUTPUT_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(output, field));
  if (legacyFields.length > 0) {
    return `Codex hook smoke emitted legacy fields for ${eventName}: ${legacyFields.join(', ')}`;
  }

  if (output.continue !== true) {
    return `Codex hook smoke omitted continue=true for ${eventName}.`;
  }

  if (output.hookSpecificOutput !== undefined) {
    if (!output.hookSpecificOutput || typeof output.hookSpecificOutput !== 'object' || Array.isArray(output.hookSpecificOutput)) {
      return `Codex hook smoke emitted invalid hookSpecificOutput for ${eventName}.`;
    }
    if (output.hookSpecificOutput.hookEventName !== eventName) {
      return `Codex hook smoke emitted hookSpecificOutput.hookEventName=${output.hookSpecificOutput.hookEventName ?? 'null'} for ${eventName}.`;
    }
  }

  return null;
}

async function smokeTestCodexHook(projectRoot) {
  const hookPath = cjoin(projectRoot, '.codex', 'hooks', 'openprd-hook.mjs');
  if (!(await exists(hookPath))) {
    return { ok: false, message: 'Codex hook runner is missing.' };
  }

  const smokeId = `doctor-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-hook-smoke-'));
  try {
    for (const eventName of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse']) {
      const run = spawnSync(process.execPath, [hookPath, eventName], {
        cwd: smokeRoot,
        input: JSON.stringify(codexHookSmokePayload(smokeRoot, eventName, smokeId)),
        encoding: 'utf8',
        timeout: 15000,
        env: {
          ...process.env,
          OPENPRD_CLI: process.env.OPENPRD_CLI || cjoin(PACKAGE_ROOT, 'bin', 'openprd.js'),
        },
      });
      const error = validateCodexHookSmokeOutput(eventName, run);
      if (error) {
        return { ok: false, message: error };
      }
    }

    return { ok: true, message: 'ok' };
  } finally {
    await fs.rm(smokeRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export async function doctorOpenPrdAgentIntegration(projectRoot, options = {}) {
  const tools = normalizeTools(options.tools);
  const checks = [];
  await ensureHarnessState(projectRoot);

  await collectDoctorCheck(projectRoot, checks, 'AGENTS.md', (file) => fileHas(file, 'OPENPRD:AGENTS:START'), 'Missing OpenPrd managed AGENTS block.');
  await collectDoctorCheck(projectRoot, checks, OPENPRD_HARNESS_MANIFEST, (file) => fileHas(file, '"managedFiles"'), 'Missing OpenPrd install manifest.');
  await collectDoctorCheck(projectRoot, checks, OPENPRD_HARNESS_HOOK_STATE, (file) => fileHas(file, '"version"'), 'Missing OpenPrd hook state.');
  await collectDoctorCheck(projectRoot, checks, OPENPRD_HARNESS_EVENTS, (file) => exists(file), 'Missing OpenPrd harness events log.');

  if (tools.includes('codex')) {
    await collectDoctorCheck(projectRoot, checks, '.codex/config.toml', (file) => fileHas(file, 'codex_hooks = true'), 'Codex hooks feature is not enabled.');
    await collectDoctorCheck(projectRoot, checks, '.codex/hooks.json', (file) => fileHas(file, 'openprd-hook.mjs'), 'Codex hooks.json is missing OpenPrd hooks.');
    await collectDoctorCheck(projectRoot, checks, '.codex/hooks/openprd-hook.mjs', (file) => fileHas(file, 'OpenPrd harness context'), 'Codex hook runner is missing.');
    const smoke = await smokeTestCodexHook(projectRoot);
    checks.push({ path: '.codex/hooks/openprd-hook.mjs:smoke', ok: smoke.ok, message: smoke.message });
    await collectDoctorCheck(projectRoot, checks, '.codex/skills/openprd-harness/SKILL.md', (file) => fileHas(file, 'OPENPRD:GENERATED'), 'Codex OpenPrd harness skill is missing.');
    if (options.enableUserCodexConfig) {
      const userConfigPath = cjoin(resolveCodexHome(options), 'config.toml');
      await collectDoctorCheckAbsolute(checks, displayPath(userConfigPath), userConfigPath, (file) => fileHas(file, 'codex_hooks = true'), 'User Codex config has not enabled codex_hooks.');
    }
  }
  if (tools.includes('claude')) {
    await collectDoctorCheck(projectRoot, checks, 'CLAUDE.md', (file) => fileHas(file, 'OPENPRD:CLAUDE:START'), 'Missing OpenPrd managed CLAUDE block.');
    await collectDoctorCheck(projectRoot, checks, '.claude/skills/openprd-harness/SKILL.md', (file) => fileHas(file, 'OPENPRD:GENERATED'), 'Claude OpenPrd harness skill is missing.');
    await collectDoctorCheck(projectRoot, checks, '.claude/commands/openprd/next.md', (file) => fileHas(file, 'OPENPRD:GENERATED'), 'Claude OpenPrd next command is missing.');
  }
  if (tools.includes('cursor')) {
    await collectDoctorCheck(projectRoot, checks, '.cursor/rules/openprd.mdc', (file) => fileHas(file, 'OPENPRD:GENERATED'), 'Cursor OpenPrd rule is missing.');
    await collectDoctorCheck(projectRoot, checks, '.cursor/commands/openprd-next.md', (file) => fileHas(file, 'OPENPRD:GENERATED'), 'Cursor OpenPrd next command is missing.');
  }
  const drift = await computeDriftReport(projectRoot, tools);
  for (const error of drift.errors) {
    checks.push({ path: OPENPRD_HARNESS_DRIFT, ok: false, message: error });
  }

  return {
    ok: checks.every((check) => check.ok),
    action: 'doctor',
    projectRoot,
    tools,
    checks,
    drift,
    errors: checks.filter((check) => !check.ok).map((check) => `${check.path}: ${check.message}`),
  };
}
