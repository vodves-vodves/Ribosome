import { t } from './i18n';

/** Languages in the lists. Labels are endonyms from Intl.DisplayNames, except where it names them poorly. */
export const LANGS = [
  'ru', 'en', 'uk', 'be', 'kk', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'cs', 'nl', 'sv', 'fi', 'no', 'da', 'tr', 'el',
  'bg', 'sr', 'ro', 'hu', 'lt', 'lv', 'et', 'ka', 'hy', 'az', 'uz', 'he', 'ar', 'fa', 'hi', 'zh-CN', 'zh-TW', 'ja',
  'ko', 'vi', 'th', 'id',
];

const NAMES: Record<string, string> = { 'zh-CN': '中文（简体）', 'zh-TW': '中文（繁體）' };

export function langName(code: string): string {
  if (code === 'auto') return t('auto');
  if (NAMES[code]) return NAMES[code];
  try {
    const n = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    if (n && n !== code) return n.charAt(0).toLocaleUpperCase(code) + n.slice(1);
  } catch {}
  return code.toUpperCase();
}

/** Google returns legacy codes for Hebrew and Javanese. */
const ALIASES: Record<string, string> = { iw: 'he', jw: 'jv' };
export const normLang = (code: string) => ALIASES[code] ?? code;
