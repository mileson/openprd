export const OPENPRD_FALLBACK_LOCALE = 'zh-CN';
export const OPENPRD_CONTENT_LOCALE = OPENPRD_FALLBACK_LOCALE;

export const OPENPRD_LANGUAGE_POLICY =
  'OpenPrd 用户可见内容以及 Agent 产出的 spec、tasks 和说明文案应跟随用户当前主语言；无法判断时才使用简体中文兜底。PRD、OpenPrd、OpenSpec、API、SDK、CLI、TypeScript、JSON、HTTP、WebSocket、字段 key、命令名、品牌名、产品名和协议名等必要专有名词按原文保留。';

export const TBD_ZH = '待补充';

const CJK_RE = /[\u3400-\u9fff]/;
const LATIN_WORD_RE = /[A-Za-z][A-Za-z0-9+_.-]*/g;

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

export function englishWords(value) {
  return String(value ?? '').match(LATIN_WORD_RE) ?? [];
}

export function isChineseLocale(locale) {
  return normalizeOutputLocale(locale).startsWith('zh');
}

export function normalizeOutputLocale(locale, fallback = OPENPRD_FALLBACK_LOCALE) {
  const text = String(locale ?? '').trim();
  if (!text) {
    return fallback;
  }
  const lower = text.toLowerCase();
  if (lower === 'cn' || lower.startsWith('zh')) {
    return 'zh-CN';
  }
  if (lower.startsWith('en')) {
    return 'en';
  }
  return text;
}

export function detectPrimaryLanguage(values, fallback = OPENPRD_FALLBACK_LOCALE) {
  const text = (Array.isArray(values) ? values : [values])
    .map((value) => String(value ?? ''))
    .join('\n');
  const cjkCount = (text.match(CJK_RE) ?? []).length;
  const latinCount = englishWords(text).length;
  if (cjkCount > 0) {
    return 'zh-CN';
  }
  if (latinCount >= 4) {
    return 'en';
  }
  return normalizeOutputLocale(fallback);
}

export function isEnglishHeavyText(value) {
  const text = String(value ?? '').trim();
  if (!text || hasSimplifiedChinese(text)) {
    return false;
  }
  return englishWords(text).length >= 4;
}

export function preferSimplifiedChinese(value, fallback = TBD_ZH) {
  const text = scalarZh(value, '');
  return hasSimplifiedChinese(text) ? text : fallback;
}

export function preferUserLanguage(value, locale = OPENPRD_FALLBACK_LOCALE, fallbacks = {}) {
  const text = scalarZh(value, '');
  if (text) {
    return text;
  }
  const normalizedLocale = normalizeOutputLocale(locale);
  if (!isChineseLocale(normalizedLocale) && fallbacks.en) {
    return fallbacks.en;
  }
  return fallbacks.zh ?? fallbacks.default ?? TBD_ZH;
}

export function languagePolicyLines() {
  return [
    '> 语言规则：用户可见说明、PRD、spec 和 tasks 跟随用户当前主语言；无法判断时才使用简体中文兜底。PRD、OpenPrd、OpenSpec、API、SDK、CLI、TypeScript、JSON、HTTP、WebSocket、字段 key、命令名、品牌名、产品名和协议名等必要专有名词保留原文。',
    '',
  ];
}
