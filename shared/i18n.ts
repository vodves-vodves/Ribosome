import { browser } from 'wxt/browser';
import type en from './locales/en';
import { LOCALES } from './locales';

export type Key = keyof typeof en;

let lang: string | undefined;

export function locale() {
  if (!lang) {
    const ui = browser.i18n.getUILanguage().split('-')[0]!;
    lang = ui in LOCALES ? ui : 'en';
  }
  return lang;
}

/**
 * Own lookup instead of `i18n.getMessage`: after an extension update the orphaned content script
 * can't call extension APIs, yet it still has to tell the user to reload the page.
 */
export const t = (key: Key, ...subs: (string | number)[]) =>
  subs.reduce<string>((s, v, i) => s.replace(`$${i + 1}`, String(v)), LOCALES[locale()]![key]);
