import { browser } from 'wxt/browser';
import { LANGS } from './langs';

export type Mode = 'icon' | 'instant';
export type Theme = 'auto' | 'light' | 'dark';

export type Settings = {
  target: string;
  /** Language for text that is already in `target`. Never equal to `target`. */
  secondary: string;
  source: string;
  mode: Mode;
  translateInFields: boolean;
  provider: 'google';
  theme: Theme;
  /** Hostnames whose pages are translated as soon as they open. */
  autoSites: string[];
  /** Offer to translate a page that isn't in the target language. */
  offerPages: boolean;
};

const secondFor = (target: string) => (target === 'en' ? 'es' : 'en');

/** UI languages that Chrome names differently from our list. */
const UI_ALIASES: Record<string, string> = { nb: 'no', nn: 'no', 'zh-HK': 'zh-TW', 'zh-MO': 'zh-TW' };

function defaults(): Settings {
  const ui = browser.i18n.getUILanguage();
  const target = [UI_ALIASES[ui], ui, ui.split('-')[0]!].find((l) => l && LANGS.includes(l)) ?? 'en';
  return { target, secondary: secondFor(target), source: 'auto', mode: 'icon', translateInFields: true, provider: 'google', theme: 'auto', autoSites: [], offerPages: true };
}

const KEY = 'settings';

/** A corrupted stored value (`secondary === target`) is fixed rather than carried along. */
export function normalize(raw?: Partial<Settings>): Settings {
  const s = { ...defaults(), ...raw };
  if (s.secondary === s.target) s.secondary = secondFor(s.target);
  return s;
}

/** "Translate to" colliding with the second language is resolved by swapping them. */
export function merge(prev: Settings, patch: Partial<Settings>): Settings {
  const next = { ...prev, ...patch };
  if (next.secondary === next.target) {
    if (patch.target !== undefined) next.secondary = prev.target;
    else next.target = prev.secondary;
  }
  return next;
}

export async function loadSettings(): Promise<Settings> {
  const { [KEY]: raw } = await browser.storage.sync.get(KEY);
  return normalize(raw as Partial<Settings> | undefined);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = merge(await loadSettings(), patch);
  await browser.storage.sync.set({ [KEY]: next });
  return next;
}

export async function setAutoSite(host: string, on: boolean): Promise<Settings> {
  const sites = (await loadSettings()).autoSites.filter((h) => h !== host);
  return saveSettings({ autoSites: on ? [...sites, host] : sites });
}

export function watchSettings(cb: (s: Settings) => void): () => void {
  const fn = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'sync' && changes[KEY]) cb(normalize(changes[KEY].newValue as Partial<Settings> | undefined));
  };
  browser.storage.onChanged.addListener(fn);
  return () => browser.storage.onChanged.removeListener(fn);
}

const dark = () => matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(el: HTMLElement, theme: Theme) {
  el.dataset.theme = theme === 'auto' ? (dark().matches ? 'dark' : 'light') : theme;
}

export function watchSystemTheme(cb: () => void) {
  dark().addEventListener('change', cb);
}
