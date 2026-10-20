import '@/shared/ui/base.css';
import './style.css';
import { browser } from 'wxt/browser';
import { locale, t, type Key } from '@/shared/i18n';
import { LANGS, langName } from '@/shared/langs';
import { MAX_TEXT, type Req, type TabMessage } from '@/shared/messages';
import { applyTheme, loadSettings, saveSettings, watchSystemTheme, type Settings } from '@/shared/settings';
import { COPY_LABEL, ICON } from '@/shared/ui/icons';
import { copyText, createRunner, flashCopy, overlayScrollbar, render, type State } from '@/shared/ui/view';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const $$ = <T extends HTMLElement = HTMLElement>(s: string) => [...document.querySelectorAll<T>(s)];

document.documentElement.lang = locale();
$$('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n as Key)));
$$('[data-i18n-label]').forEach((el) => (el.ariaLabel = t(el.dataset.i18nLabel as Key)));
$$('[data-i18n-title]').forEach((el) => (el.title = el.ariaLabel = t(el.dataset.i18nTitle as Key)));
$<HTMLTextAreaElement>('#tr-in').placeholder = t('inputPlaceholder');
$$('i[data-icon]').forEach((i) => (i.innerHTML = ICON[i.dataset.icon as keyof typeof ICON]));
$('#tr-copy').innerHTML = COPY_LABEL;
$('#ver').textContent = `Ribosome ${browser.runtime.getManifest().version}`;

function fill(sel: HTMLSelectElement, codes: string[]) {
  sel.replaceChildren(...codes.map((c) => new Option(langName(c), c)));
}
/** Google may detect a language missing from the list: add it so swap doesn't lose it. */
function ensure(sel: HTMLSelectElement, code: string) {
  if (![...sel.options].some((o) => o.value === code)) sel.add(new Option(langName(code), code));
}

let S: Settings = await loadSettings();

/* ---------- Tabs ---------- */
$('#tabs').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-tab]');
  if (!b) return;
  $$('#tabs button').forEach((x) => x.classList.toggle('is-on', x === b));
  $$('.rb-tab').forEach((x) => x.classList.toggle('is-on', x.dataset.tab === b.dataset.tab));
});
$$('.rb-tab').forEach(overlayScrollbar);

/* ---------- Translate ---------- */
const trIn = $<HTMLTextAreaElement>('#tr-in');
const trFrom = $<HTMLSelectElement>('#tr-from');
const trTo = $<HTMLSelectElement>('#tr-to');
const trLab = $('#tr-lab');
const trCnt = $('#tr-cnt');
const view = { bt: $('#tr-out'), note: $('#tr-note'), copy: $<HTMLButtonElement>('#tr-copy'), retry: $<HTMLButtonElement>('#tr-retry') };
fill(trFrom, ['auto', ...LANGS]);
fill(trTo, LANGS);
trFrom.value = S.source;
trTo.value = S.target;
overlayScrollbar(trIn);
overlayScrollbar(view.bt);

let state: State | null = null;
let req: Req | null = null;
const runner = createRunner((s) => {
  state = s;
  if (s.kind === 'ok') trLab.textContent = langName(s.to); // the actual language, second-language rule included
  render(view, s);
});

function run() {
  const text = trIn.value.trim();
  trLab.textContent = langName(trTo.value);
  if (!text) {
    runner.stop();
    state = req = null;
    view.note.hidden = view.copy.hidden = view.retry.hidden = true;
    view.bt.textContent = t('outputPlaceholder');
    view.bt.classList.add('is-empty');
    view.bt.dispatchEvent(new Event('rb:content'));
    return;
  }
  req = { text, from: trFrom.value, to: trTo.value };
  runner.run(req);
}

const updCnt = () => {
  const n = trIn.value.length;
  trCnt.textContent = `${n} / ${MAX_TEXT}`;
  trCnt.classList.toggle('is-over', n > MAX_TEXT);
};
let inT: ReturnType<typeof setTimeout> | undefined;
trIn.addEventListener('input', () => {
  updCnt();
  clearTimeout(inT);
  inT = setTimeout(run, 400);
});
trFrom.addEventListener('change', run);
trTo.addEventListener('change', run);

// swap the actual pair: result language to From, detected one to To. The pills lie with Auto and the second language
$('#tr-swap').addEventListener('click', () => {
  let from: string;
  let to: string;
  clearTimeout(inT);
  // the result counts only if it matches the field and the pills right now: input may still be waiting on the debounce
  const fresh = req && req.text === trIn.value.trim() && req.from === trFrom.value && req.to === trTo.value;
  if (state?.kind === 'ok' && fresh) {
    from = state.to;
    to = state.detected;
    trIn.value = state.text;
  } else {
    from = trTo.value;
    to = trFrom.value === 'auto' ? S.secondary : trFrom.value;
    if (to === from) to = S.target === from ? S.secondary : S.target;
  }
  ensure(trFrom, from);
  ensure(trTo, to);
  trFrom.value = from;
  trTo.value = to;
  updCnt();
  run();
});
view.copy.addEventListener('click', async () => {
  if (state?.kind === 'ok') flashCopy(view.copy, await copyText(state.text, document.body));
});
view.retry.addEventListener('click', () => (state?.kind === 'ctx' ? location.reload() : req && runner.run(req)));
trLab.textContent = langName(trTo.value);

/* ---------- Whole page: the active tab's content script knows its state ---------- */
const pageBtn = $<HTMLButtonElement>('#page');
const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
const tell = (m: TabMessage) => (tab?.id ? browser.tabs.sendMessage(tab.id, m).catch(() => null) : Promise.resolve(null));
// no answer: a browser page, the store, or a tab opened before the extension was installed
tell({ type: 'page:get' }).then((r: { on: boolean } | null) => {
  if (!r) return;
  pageBtn.hidden = false;
  pageBtn.classList.toggle('is-on', r.on);
  pageBtn.querySelector('span')!.textContent = t(r.on ? 'showOriginal' : 'translatePage');
});
pageBtn.addEventListener('click', async () => {
  await tell({ type: 'page:toggle' });
  close();
});

const key = $('#key');
browser.commands.getAll().then((all) => {
  const k = all.find((c) => c.name === 'toggle-page')?.shortcut;
  key.textContent = k || t('shortcutNone');
  key.classList.toggle('is-none', !k);
});
$('#set-key').addEventListener('click', () => browser.tabs.create({ url: 'chrome://extensions/shortcuts' }));

function renderSites() {
  const rows = S.autoSites.map((h) => {
    const row = document.createElement('div');
    row.className = 'rb-row';
    const name = document.createElement('span');
    name.className = 'host';
    name.textContent = h;
    const del = document.createElement('button');
    del.className = 'rb-del';
    del.title = del.ariaLabel = t('remove');
    del.innerHTML = ICON.close;
    del.addEventListener('click', () => save({ autoSites: S.autoSites.filter((x) => x !== h) }));
    row.append(name, del);
    return row;
  });
  const none = document.createElement('div');
  none.className = 'rb-row is-none';
  none.textContent = t('noSites');
  $('#set-sites').replaceChildren(...(rows.length ? rows : [none]));
}

/* ---------- Settings, saved on change ---------- */
fill($('[data-set=target]'), LANGS);
fill($('[data-set=secondary]'), LANGS);
fill($('[data-set=source]'), ['auto', ...LANGS]);

function apply() {
  applyTheme(document.body, S.theme);
  $$<HTMLSelectElement>('select[data-set]').forEach((el) => (el.value = String(S[el.dataset.set as keyof Settings])));
  $$('#set-mode [data-mode]').forEach((el) => el.setAttribute('aria-checked', String(el.dataset.mode === S.mode)));
  $<HTMLInputElement>('#set-fields').checked = S.translateInFields;
  $$('#set-theme button').forEach((el) => el.classList.toggle('is-on', el.dataset.theme === S.theme));
  renderSites();
}

async function save(patch: Partial<Settings>) {
  const prevTarget = S.target;
  S = await saveSettings(patch);
  apply();
  // a new "Translate to" (or a swap with the second language) changes the To pill and the result
  if (S.target !== prevTarget) {
    trTo.value = S.target;
    run();
  }
}

$$<HTMLSelectElement>('select[data-set]').forEach((el) => el.addEventListener('change', () => save({ [el.dataset.set!]: el.value })));
$('#set-mode').addEventListener('click', (e) => {
  const r = (e.target as Element).closest<HTMLElement>('[data-mode]');
  if (r) save({ mode: r.dataset.mode as Settings['mode'] });
});
$<HTMLInputElement>('#set-fields').addEventListener('change', (e) => save({ translateInFields: (e.target as HTMLInputElement).checked }));
$('#set-theme').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('button[data-theme]');
  if (b) save({ theme: b.dataset.theme as Settings['theme'] });
});
watchSystemTheme(apply);
apply();
