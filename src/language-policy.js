export const OPENPRD_CONTENT_LOCALE = 'zh-CN';

export const OPENPRD_LANGUAGE_POLICY =
  'OpenPrd 生成的用户可见内容默认使用简体中文；PRD、OpenPrd、OpenSpec、API、SDK、CLI、TypeScript、JSON、HTTP、WebSocket、字段 key、命令名、产品名和协议名等专有名词按原文保留。';

export const TBD_ZH = '待补充';

const CJK_RE = /[\u3400-\u9fff]/;
const STRUCTURAL_OPENPRD_TERMS = [
  'ADDED',
  'MODIFIED',
  'REMOVED',
  'Requirements',
  'Requirement',
  'Scenario',
  'WHEN',
  'THEN',
  'AND',
  'GIVEN',
];
const ALLOWED_TECHNICAL_TERMS = [
  'OpenPrd',
  'OpenSpec',
  'PRD',
  'API',
  'SDK',
  'CLI',
  'TypeScript',
  'JavaScript',
  'JSON',
  'YAML',
  'Agent',
  'HTTP',
  'HTTPS',
  'WebSocket',
  'URL',
  'URI',
  'ID',
  'UID',
  'UUID',
  'OSS',
  'NSIS',
  'DMG',
  'RPM',
  'DEB',
  'macOS',
  'Windows',
  'Linux',
  'Node',
  'Node.js',
  'npm',
  'pnpm',
  'Electron',
  'React',
  'Vite',
  'Vitest',
  'Playwright',
];
const DISALLOWED_SPEC_MODAL_WORDS = /\b(SHALL|MUST|SHOULD|MAY)\b/;

export function scalarZh(value, fallback = TBD_ZH) {
  if (value === null || value === undefined) {
    return fallback;
  }
  const text = String(value).trim();
  return text || fallback;
}

export function hasSimplifiedChinese(value) {
  return CJK_RE.test(String(value ?? ''));
}

export function preferSimplifiedChinese(value, fallback = TBD_ZH) {
  const text = scalarZh(value, '');
  return hasSimplifiedChinese(text) ? text : fallback;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripAllowedEnglishTerms(text) {
  let next = text;
  for (const term of [...STRUCTURAL_OPENPRD_TERMS, ...ALLOWED_TECHNICAL_TERMS]) {
    next = next.replace(new RegExp(`\\b${escapeRegExp(term)}\\b`, 'g'), ' ');
  }
  return next
    .replace(/\b[A-Z][A-Za-z0-9]*(?:\s*(?:&|and)\s*|\s+)[A-Z][A-Za-z0-9]*(?:(?:\s*(?:&|and)\s*|\s+)[A-Z][A-Za-z0-9]*)*\b/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[A-Za-z0-9_.-]+\.(?:md|json|ya?ml|toml|txt|html|js|ts|tsx|jsx|mjs|cjs|yml|exe|dmg|rpm|deb|zip|gz|xz|blockmap)\b/g, ' ')
    .replace(/\b[A-Za-z0-9_.-]*[/-][A-Za-z0-9_.-]+\b/g, ' ')
    .replace(/\b[A-Z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*\b/g, ' ');
}

function specContentFragment(line) {
  const trimmed = String(line ?? '').trim();
  if (!trimmed || /^```/.test(trimmed)) {
    return '';
  }
  if (/^##\s+(?:(ADDED|MODIFIED|REMOVED)\s+Requirements|(?:新增|修改|移除)需求)\s*$/i.test(trimmed)) {
    return '';
  }
  return trimmed
    .replace(/^#{3,4}\s+(Requirement|Scenario|需求|场景)[：:]\s*/i, '')
    .replace(/^-\s+\*\*(WHEN|THEN|AND|GIVEN|当|则|那么|并且|假如)\*\*\s*/i, '')
    .replace(/^[-*]\s+/, '')
    .replace(/[*_#[\]()]/g, ' ')
    .trim();
}

export function findOpenPrdSpecLanguageViolations(text) {
  const violations = [];
  const lines = String(text ?? '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const fragment = specContentFragment(lines[index]);
    if (!fragment) {
      continue;
    }
    if (DISALLOWED_SPEC_MODAL_WORDS.test(fragment)) {
      violations.push({ line: index + 1, text: fragment, reason: '包含 SHALL/MUST/SHOULD/MAY 等英文规范词' });
      continue;
    }
    const stripped = stripAllowedEnglishTerms(fragment);
    const englishWords = stripped.match(/[A-Za-z]{2,}/g) ?? [];
    if (!hasSimplifiedChinese(fragment) && englishWords.length > 0) {
      violations.push({ line: index + 1, text: fragment, reason: '正文缺少简体中文表达' });
      continue;
    }
    if (englishWords.length > 1) {
      violations.push({ line: index + 1, text: fragment, reason: '正文包含过多非必要英文' });
    }
  }
  return violations;
}

export function languagePolicyLines() {
  return [
    '> 语言规则：除 PRD、OpenPrd、OpenSpec、API、SDK、CLI、TypeScript、JSON、HTTP、WebSocket、字段 key、命令名、产品名和协议名等必要专有名词外，用户可见内容应使用简体中文。',
    '',
  ];
}
