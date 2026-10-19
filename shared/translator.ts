// Единственная точка выхода в сеть и вся защита от спама: кэш, дедуп, отмена, лимитер, backoff.
import { normLang } from './langs';
import { MAX_TEXT, type Req, type TranslateResponse } from './messages';
import { ProviderError, type Provider, type ProviderResult } from './providers/types';

export interface Cache {
  get(key: string): Promise<ProviderResult | undefined>;
  set(key: string, value: ProviderResult): Promise<void>;
}

export type Acquire = (signal: AbortSignal, onQueued: () => void) => Promise<void>;

/**
 * Не чаще одного запроса в `gap` мс и не больше `max` за `window` мс. Сверх лимита — очередь, не отбрасывание.
 * Не стартовал за `notice` мс — `onQueued`: короткое ожидание интервала в 250 мс «очередью» не показываем.
 */
export function createLimiter({ gap = 250, max = 20, window = 10_000, notice = 500 } = {}): Acquire {
  const starts: number[] = [];
  const queue: { signal: AbortSignal; go: () => void }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const nextAt = (t: number) => {
    while (starts.length && starts[0]! <= t - window) starts.shift();
    let at = t;
    if (starts.length) at = Math.max(at, starts.at(-1)! + gap);
    if (starts.length >= max) at = Math.max(at, starts.at(-max)! + window);
    return at;
  };

  const pump = () => {
    clearTimeout(timer);
    timer = undefined;
    while (queue.length) {
      if (queue[0]!.signal.aborted) {
        queue.shift();
        continue;
      }
      const t = Date.now();
      const at = nextAt(t);
      if (at > t) {
        timer = setTimeout(pump, at - t);
        return;
      }
      starts.push(t);
      queue.shift()!.go();
    }
  };

  return (signal, onQueued) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const qt = setTimeout(onQueued, notice);
      const onAbort = () => {
        clearTimeout(qt);
        const i = queue.indexOf(job);
        if (i >= 0) queue.splice(i, 1);
        reject(signal.reason);
      };
      const job = {
        signal,
        go: () => {
          clearTimeout(qt);
          signal.removeEventListener('abort', onAbort);
          resolve();
        },
      };
      signal.addEventListener('abort', onAbort, { once: true });
      queue.push(job);
      pump();
    });
}

/** Пауза после 429/403: запросы не уходят, отвечаем `rate_limited`. */
class Paused extends Error {}

type Flight = {
  promise: Promise<ProviderResult>;
  ctrl: AbortController;
  waiters: number;
  queued: boolean;
  listeners: Set<() => void>;
};

type Deps = {
  provider: () => Provider | Promise<Provider>;
  secondary: () => string | Promise<string>;
  cache: Cache;
  acquire?: Acquire;
};

export function createTranslator({ provider, secondary, cache, acquire = createLimiter() }: Deps) {
  const inflight = new Map<string, Flight>();
  let pauseUntil = 0;
  let step = 0;

  async function run(p: Provider, key: string, from: string, to: string, text: string, signal: AbortSignal, onQueued: () => void) {
    if (Date.now() < pauseUntil) throw new Paused();
    await acquire(signal, onQueued);
    signal.throwIfAborted();
    if (Date.now() < pauseUntil) throw new Paused();
    if (navigator.onLine === false) throw new TypeError('offline');
    try {
      const r = await p.translate(text, from, to, signal);
      step = 0;
      const out = { text: r.text, detected: normLang(r.detected) };
      await cache.set(key, out).catch(() => {});
      return out;
    } catch (e) {
      // параллельные запросы получают 429 пачкой — пауза растёт один раз, а не на каждый ответ
      if (e instanceof ProviderError && e.kind === 'rate_limited' && Date.now() >= pauseUntil) {
        step++;
        pauseUntil = Date.now() + Math.min(2 ** step, 60) * 1000;
      }
      throw e;
    }
  }

  /** Одинаковый ключ уже в полёте — второй fetch не создаётся. Fetch отменяется, только когда ушли все ждущие. */
  function join(key: string, signal: AbortSignal, onQueued: () => void, start: (s: AbortSignal, q: () => void) => Promise<ProviderResult>) {
    if (signal.aborted) return Promise.reject(signal.reason);
    let fl = inflight.get(key);
    if (!fl) {
      const f: Flight = { ctrl: new AbortController(), waiters: 0, queued: false, listeners: new Set(), promise: null! };
      f.promise = start(f.ctrl.signal, () => {
        f.queued = true;
        f.listeners.forEach((l) => l());
      }).finally(() => {
        if (inflight.get(key) === f) inflight.delete(key);
      });
      inflight.set(key, (fl = f));
    }
    const f = fl;
    f.waiters++;
    if (f.queued) onQueued();
    else f.listeners.add(onQueued);
    return new Promise<ProviderResult>((resolve, reject) => {
      const onAbort = () => {
        f.listeners.delete(onQueued);
        if (--f.waiters === 0) {
          f.ctrl.abort();
          if (inflight.get(key) === f) inflight.delete(key);
        }
        reject(signal.reason);
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      f.promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  }

  async function call(p: Provider, from: string, to: string, text: string, signal: AbortSignal, onQueued: () => void) {
    const key = `${p.id}|${from}|${to}|${text}`;
    const hit = await cache.get(key).catch(() => undefined);
    if (hit) return { ...hit, cached: true };
    const r = await join(key, signal, onQueued, (s, q) => run(p, key, from, to, text, s, q));
    return { ...r, cached: false };
  }

  async function translate(req: Req, signal: AbortSignal, onQueued: () => void): Promise<TranslateResponse> {
    let text = req.text.trim();
    if (!/\p{L}/u.test(text)) return { ok: false, error: 'nothing' };
    const truncated = text.length > MAX_TEXT;
    // не разрезать суррогатную пару на границе
    if (truncated) text = text.slice(0, /[\uD800-\uDBFF]/.test(text.charAt(MAX_TEXT - 1)) ? MAX_TEXT - 1 : MAX_TEXT);
    try {
      const p = await provider();
      const first = await call(p, req.from, req.to, text, signal, onQueued);
      const sec = await secondary();
      // текст уже на языке перевода — переводим на второй язык
      if (first.detected !== req.to || sec === req.to) return { ok: true, text: first.text, detected: first.detected, to: req.to, cached: first.cached, truncated };
      const second = await call(p, first.detected, sec, text, signal, onQueued);
      return { ok: true, text: second.text, detected: first.detected, to: sec, cached: first.cached && second.cached, truncated };
    } catch (e) {
      if (signal.aborted) throw e;
      if (e instanceof Paused || (e instanceof ProviderError && e.kind === 'rate_limited'))
        return { ok: false, error: 'rate_limited', retryAfter: Math.max(1, Math.ceil((pauseUntil - Date.now()) / 1000)) };
      if (e instanceof ProviderError) return { ok: false, error: 'server', status: e.status };
      return { ok: false, error: 'offline' };
    }
  }

  return { translate };
}
