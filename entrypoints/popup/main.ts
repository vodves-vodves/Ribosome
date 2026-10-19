import '@/shared/ui/base.css';
import './style.css';
import { browser } from 'wxt/browser';
import { LANGS, langName } from '@/shared/langs';
import { MAX_TEXT, type Req } from '@/shared/messages';
import { applyTheme, loadSettings, saveSettings, watchSystemTheme, type Settings } from '@/shared/settings';
import { COPY_LABEL, ICON } from '@/shared/ui/icons';
import { copyText, createRunner, flashCopy, overlayScrollbar, render, type State } from '@/shared/ui/view';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const $$ = <T extends HTMLElement = HTMLElement>(s: string) => [...document.querySelectorAll<T>(s)];

document.querySelectorAll<HTMLElement>('i[data-icon]').forEach((i) => (i.innerHTML = ICON[i.dataset.icon as keyof typeof ICON]));
$('#tr-copy').innerHTML = COPY_LABEL;
$('#ver').textContent = `Ribosome ${browser.runtime.getManifest().version}`;

function fill(sel: HTMLSelectElement, codes: string[]) {
  sel.replaceChildren(...codes.map((c) => new Option(langName(c), c)));
}
/** Google мог определить язык, которого нет в списке, — добавляем, чтобы swap не потерял его. */
function ensure(sel: HTMLSelectElement, code: string) {
  if (![...sel.options].some((o) => o.value === code)) sel.add(new Option(langName(code), code));
}

let S: Settings = await loadSettings();

/* ---------- Вкладки ---------- */
$('#tabs').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-tab]');
  if (!b) return;
  $$('#tabs button').forEach((x) => x.classList.toggle('is-on', x === b));
  $$('.rb-tab').forEach((x) => x.classList.toggle('is-on', x.dataset.tab === b.dataset.tab));
});
$$('.rb-tab').forEach(overlayScrollbar);

/* ---------- Перевод ---------- */
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
  if (s.kind === 'ok') trLab.textContent = langName(s.to); // фактический язык: с учётом второго
  render(view, s);
});

function run() {
  const text = trIn.value.trim();
  trLab.textContent = langName(trTo.value);
  if (!text) {
    runner.stop();
    state = req = null;
    view.note.hidden = view.copy.hidden = view.retry.hidden = true;
    view.bt.textContent = 'Перевод появится здесь';
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

// меняем фактическую пару: язык результата → «Откуда», определённый → «Куда». Значения пилюль при «Авто» и втором языке врут
$('#tr-swap').addEventListener('click', () => {
  let from: string;
  let to: string;
  if (state?.kind === 'ok') {
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

/* ---------- Настройки: сохранение по изменению ---------- */
fill($('[data-set=target]'), LANGS);
fill($('[data-set=secondary]'), LANGS);
fill($('[data-set=source]'), ['auto', ...LANGS]);

function apply() {
  applyTheme(document.body, S.theme);
  $$<HTMLSelectElement>('select[data-set]').forEach((el) => (el.value = String(S[el.dataset.set as keyof Settings])));
  $$('#set-mode [data-mode]').forEach((el) => el.setAttribute('aria-checked', String(el.dataset.mode === S.mode)));
  $<HTMLInputElement>('#set-fields').checked = S.translateInFields;
  $$('#set-theme button').forEach((el) => el.classList.toggle('is-on', el.dataset.theme === S.theme));
}

async function save(patch: Partial<Settings>) {
  const prevTarget = S.target;
  S = await saveSettings(patch);
  apply();
  // «Переводить на» (или обмен со вторым языком) меняет пилюлю «Куда» и результат
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
