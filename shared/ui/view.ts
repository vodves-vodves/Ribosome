// Translation states shared by the on-page window and the popup: texts, skeleton, pause countdown, copying.
import { requestTranslation } from '../client';
import { t } from '../i18n';
import { MAX_TEXT, type Req } from '../messages';
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
  v.retry.textContent = t('retry');
  v.bt.classList.remove('is-empty');
  const note = (text: string) => {
    v.note.textContent = text;
    v.note.hidden = false;
  };
  switch (s.kind) {
    case 'loading':
      v.bt.innerHTML = SKELETON;
      break;
    case 'queued':
      v.bt.innerHTML = SKELETON;
      note(t('queued'));
      break;
    case 'ok':
      v.bt.textContent = s.text;
      v.copy.hidden = !s.text;
      if (s.truncated) note(t('truncated', MAX_TEXT));
      break;
    case 'nothing':
      v.bt.textContent = t('nothing');
      v.bt.classList.add('is-empty');
      note(t('nothingNote'));
      break;
    case 'rate_limited':
      v.bt.textContent = t('rateLimited');
      note(t('rateLimitedNote', s.wait));
      break;
    case 'offline':
      v.bt.textContent = t('offline');
      note(t('offlineNote'));
      v.retry.hidden = false;
      break;
    case 'server':
      v.bt.textContent = t('server');
      note(s.status ? `${t('serverStatus', s.status)} ${t('serverNote')}` : t('serverNote'));
      v.retry.hidden = false;
      break;
    case 'ctx':
      v.bt.textContent = t('updated');
      note(t('updatedNote'));
      v.retry.textContent = t('reloadPage');
      v.retry.hidden = false;
      break;
  }
  v.bt.dispatchEvent(new Event('rb:content'));
}

/** One request at a time: a new `run` cancels the previous one. No skeleton flash on cached answers; retries by itself after a 429 pause. */
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
      // the cache answers in milliseconds: show the skeleton only if there's no answer after 80 ms and the request isn't queued
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

/** `navigator.clipboard` is missing on http pages; then execCommand on a temporary field inside `scope` (our shadow root). */
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

export function flashCopy(btn: HTMLButtonElement, ok: boolean) {
  btn.classList.remove('is-done', 'is-fail');
  btn.classList.add(ok ? 'is-done' : 'is-fail');
  btn.innerHTML = `${ok ? ICON.done : ICON.fail}<span class="lbl">${t(ok ? 'copied' : 'copyFailed')}</span>`;
  clearTimeout(flashTimers.get(btn));
  flashTimers.set(
    btn,
    setTimeout(() => {
      btn.classList.remove('is-done', 'is-fail');
      btn.innerHTML = COPY_LABEL;
    }, 1400),
  );
}

/** Custom scrollbar thumb for `sc` (the native one is hidden by `rb-scroll`), drawn in a positioned parent. */
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
