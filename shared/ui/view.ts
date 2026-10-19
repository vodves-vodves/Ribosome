// Состояния перевода, общие для окна на странице и popup: тексты, скелет, отсчёт паузы, копирование.
import { requestTranslation } from '../client';
import type { Req } from '../messages';
import { COPY_LABEL, ICON } from './icons';

export type View = { bt: HTMLElement; note: HTMLElement; copy: HTMLButtonElement; retry: HTMLButtonElement };

export type State =
  | { kind: 'loading' }
  | { kind: 'queued' }
  | { kind: 'ok'; text: string; detected: string; to: string; truncated: boolean }
  | { kind: 'nothing' }
  | { kind: 'rate_limited'; wait: number }
  | { kind: 'offline' }
  | { kind: 'server'; status?: number }
  | { kind: 'ctx' };

const SKELETON = '<div class="rb-sk"><i></i><i></i></div>';

export function render(v: View, s: State) {
  v.note.hidden = v.retry.hidden = v.copy.hidden = true;
  v.retry.textContent = 'Повторить';
  v.bt.classList.remove('is-empty');
  const note = (t: string) => {
    v.note.textContent = t;
    v.note.hidden = false;
  };
  switch (s.kind) {
    case 'loading':
      v.bt.innerHTML = SKELETON;
      break;
    case 'queued':
      v.bt.innerHTML = SKELETON;
      note('Много запросов подряд — в очереди…');
      break;
    case 'ok':
      v.bt.textContent = s.text;
      v.copy.hidden = !s.text;
      if (s.truncated) note('Переведены первые 5000 символов — выделение длиннее.');
      break;
    case 'nothing':
      v.bt.textContent = 'Нечего переводить.';
      v.bt.classList.add('is-empty');
      note('В выделении только цифры и знаки.');
      break;
    case 'rate_limited':
      v.bt.textContent = 'Google ограничил запросы.';
      note(`Пауза ${s.wait} с, потом повторим сами.`);
      break;
    case 'offline':
      v.bt.textContent = 'Нет соединения.';
      note('Проверь интернет и повтори.');
      v.retry.hidden = false;
      break;
    case 'server':
      v.bt.textContent = 'Google Translate не отвечает.';
      note(`${s.status ? `Ошибка ${s.status}. ` : ''}Повтори через минуту.`);
      v.retry.hidden = false;
      break;
    case 'ctx':
      v.bt.textContent = 'Расширение обновилось.';
      note('Обнови страницу, чтобы перевод снова заработал.');
      v.retry.textContent = 'Обновить страницу';
      v.retry.hidden = false;
      break;
  }
  v.bt.dispatchEvent(new Event('rb:content'));
}

/** Один запрос за раз: новый `run` отменяет прежний. Скелет не мигает на ответе из кэша, после паузы 429 повторяет сам. */
export function createRunner(onState: (s: State) => void) {
  let stop = () => {};
  const run = (req: Req) => {
    stop();
    let alive = true;
    let cancel = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tick: ReturnType<typeof setInterval> | undefined;
    stop = () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(tick);
      cancel();
    };
    const go = () => {
      let queued = false;
      // кэш отвечает за миллисекунды: скелет — только если ответа нет дольше 80 мс и запрос не в очереди
      timer = setTimeout(() => alive && !queued && onState({ kind: 'loading' }), 80);
      const r = requestTranslation(req, () => {
        queued = true;
        if (alive) onState({ kind: 'queued' });
      });
      cancel = r.cancel;
      r.result.then((res) => {
        if (!alive) return;
        clearTimeout(timer);
        if (res.ok) return onState({ kind: 'ok', text: res.text, detected: res.detected, to: res.to, truncated: res.truncated });
        if (res.error === 'rate_limited') {
          let wait = res.retryAfter ?? 2;
          onState({ kind: 'rate_limited', wait });
          tick = setInterval(() => {
            if (--wait > 0) return onState({ kind: 'rate_limited', wait });
            clearInterval(tick);
            go();
          }, 1000);
          return;
        }
        onState(res.error === 'server' ? { kind: 'server', status: res.status } : { kind: res.error });
      });
    };
    go();
  };
  return { run, stop: () => stop() };
}

/** `navigator.clipboard` нет на http-страницах — тогда execCommand через временное поле внутри `scope` (нашего shadow root). */
export async function copyText(text: string, scope: Node): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  const sel = getSelection();
  const saved = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  scope.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {}
  ta.remove();
  if (saved && sel) {
    sel.removeAllRanges();
    sel.addRange(saved);
  }
  return ok;
}

const flashTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** Честный результат копирования на 1,4 с, потом кнопка возвращается. */
export function flashCopy(btn: HTMLButtonElement, ok: boolean) {
  btn.classList.remove('is-done', 'is-fail');
  btn.classList.add(ok ? 'is-done' : 'is-fail');
  btn.innerHTML = `${ok ? ICON.done : ICON.fail}<span class="lbl">${ok ? 'Скопировано' : 'Не скопировалось'}</span>`;
  clearTimeout(flashTimers.get(btn));
  flashTimers.set(
    btn,
    setTimeout(() => {
      btn.classList.remove('is-done', 'is-fail');
      btn.innerHTML = COPY_LABEL;
    }, 1400),
  );
}

/** Свой ползунок для `sc` (системный спрятан классом `rb-scroll`); рисуется в positioned-родителе. */
export function overlayScrollbar(sc: HTMLElement) {
  sc.classList.add('rb-scroll');
  const th = document.createElement('div');
  th.className = 'rb-thumb';
  sc.parentElement!.append(th);
  let t: ReturnType<typeof setTimeout> | undefined;
  const upd = () => {
    const vis = sc.scrollHeight > sc.clientHeight + 1;
    th.hidden = !vis;
    if (!vis) return;
    const h = Math.max(24, (sc.clientHeight * sc.clientHeight) / sc.scrollHeight);
    const y = (sc.scrollTop / (sc.scrollHeight - sc.clientHeight)) * (sc.clientHeight - h);
    th.style.top = `${sc.offsetTop + y}px`;
    th.style.height = `${h}px`;
  };
  sc.addEventListener(
    'scroll',
    () => {
      upd();
      th.classList.add('is-scrolling');
      clearTimeout(t);
      t = setTimeout(() => th.classList.remove('is-scrolling'), 600);
    },
    { passive: true },
  );
  sc.addEventListener('rb:content', upd);
  sc.addEventListener('input', upd);
  new ResizeObserver(upd).observe(sc);
  upd();
}
