import '@/shared/ui/base.css';
import './style.css';
import { applyTheme, loadSettings, saveSettings, watchSystemTheme, type Settings } from '@/shared/settings';

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const $$ = <T extends Element = HTMLElement>(s: string) => [...document.querySelectorAll<T>(s)];

let S: Settings = await loadSettings();

function apply() {
  applyTheme(document.body, S.theme);
  $$('#set-theme button').forEach((b) => b.classList.toggle('is-on', b.dataset.theme === S.theme));
}

$('#set-theme').addEventListener('click', async (e) => {
  const b = (e.target as Element).closest<HTMLElement>('button[data-theme]');
  if (!b) return;
  S = await saveSettings({ theme: b.dataset.theme as Settings['theme'] });
  apply();
});
watchSystemTheme(apply);
apply();
