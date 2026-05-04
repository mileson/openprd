export const OPENPRD_CONTENT_LOCALE = 'zh-CN';

export const OPENPRD_LANGUAGE_POLICY =
  'OpenPrd 生成的用户可见内容默认使用简体中文；PRD、OpenPrd、OpenSpec、API、SDK、CLI、TypeScript、JSON、HTTP、WebSocket、字段 key、命令名、产品名和协议名等专有名词按原文保留。';

export const TBD_ZH = '待补充';

export function scalarZh(value, fallback = TBD_ZH) {
  if (value === null || value === undefined) {
    return fallback;
  }
  const text = String(value).trim();
  return text || fallback;
}

export function languagePolicyLines() {
  return [
    '> 语言规则：除 PRD、OpenPrd、OpenSpec、API、SDK、CLI、TypeScript、JSON、HTTP、WebSocket、字段 key、命令名、产品名和协议名等必要专有名词外，用户可见内容应使用简体中文。',
    '',
  ];
}
