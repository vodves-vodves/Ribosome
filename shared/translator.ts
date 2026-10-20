// The only way out to the network, with all the spam protection: cache, dedup, cancellation, limiter, backoff.
import { normLang } from './langs';
import { MAX_TEXT, type BatchResponse, type Req, type TranslateFailure, type TranslateResponse } from './messages';
import { ProviderError, type Provider, type ProviderResult } from './providers/types';

export interface Cache {
  get(key: string): Promise<ProviderResult | undefined>;
  set(key: string, value: ProviderResult): Promise<void>;
}

export type Acquire = (signal: AbortSignal, onQueued: () => void) => Promise<void>;

/**
 * At most one request per `gap` ms and `max` per `window` ms. Requests over the limit queue up, none are dropped.
 * `onQueued` fires only after `notice` ms without a start, so a short 250 ms wait isn't shown as "queued".
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

/** Pause after 429/403: no requests go out, the answer is `rate_limited`. */
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
  /** Languages from settings for the second-language rule. */
  langs: () => Langs | Promise<Langs>;
  cache: Cache;
  acquire?: Acquire;
};

type Langs = { target: string; secondary: string };

export function createTranslator({ provider, langs, cache, acquire = createLimiter() }: Deps) {
  const inflight = new Map<string, Flight>();
  let pauseUntil = 0;
  let step = 0;

  /** A provider call through the 429 pause, the limiter and the offline check. */
  async function guard<T>(signal: AbortSignal, onQueued: () => void, onStarted: () => void, call: () => Promise<T>): Promise<T> {
    if (Date.now() < pauseUntil) throw new Paused();
    await acquire(signal, onQueued);
    signal.throwIfAborted();
    onStarted();
    if (Date.now() < pauseUntil) throw new Paused();
    if (navigator.onLine === false) throw new TypeError('offline');
    try {
      const r = await call();
      step = 0;
      return r;
    } catch (e) {
      // parallel requests get 429s in a batch: grow the pause once, not per response
      if (e instanceof ProviderError && e.kind === 'rate_limited' && Date.now() >= pauseUntil) {
        step++;
        pauseUntil = Date.now() + Math.min(2 ** step, 60) * 1000;
      }
      throw e;
    }
  }

  async function run(p: Provider, key: string, from: string, to: string, text: string, signal: AbortSignal, onQueued: () => void, onStarted: () => void) {
    const r = await guard(signal, onQueued, onStarted, () => p.translate(text, from, to, signal));
    const out = { text: r.text, detected: normLang(r.detected) };
    await cache.set(key, out).catch(() => {});
    return out;
  }

  function failure(e: unknown): TranslateFailure {
    if (e instanceof Paused || (e instanceof ProviderError && e.kind === 'rate_limited'))
      return { ok: false, error: 'rate_limited', retryAfter: Math.max(1, Math.ceil((pauseUntil - Date.now()) / 1000)) };
    if (e instanceof ProviderError) return { ok: false, error: 'server', status: e.status };
    return { ok: false, error: 'offline' };
  }

  /** A key already in flight doesn't start a second fetch. The fetch is aborted only when every waiter has left. */
  function join(
    key: string,
    signal: AbortSignal,
    onQueued: () => void,
    start: (s: AbortSignal, queued: () => void, started: () => void) => Promise<ProviderResult>,
  ) {
    if (signal.aborted) return Promise.reject(signal.reason);
    let fl = inflight.get(key);
    if (!fl) {
      const f: Flight = { ctrl: new AbortController(), waiters: 0, queued: false, listeners: new Set(), promise: null! };
      f.promise = start(
        f.ctrl.signal,
        () => {
          f.queued = true;
          f.listeners.forEach((l) => l());
        },
        () => (f.queued = false), // left the queue: waiters joining later don't see "queued"
      ).finally(() => {
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
    const r = await join(key, signal, onQueued, (s, q, started) => run(p, key, from, to, text, s, q, started));
    return { ...r, cached: false };
  }

  async function translate(req: Req, signal: AbortSignal, onQueued: () => void): Promise<TranslateResponse> {
    let text = req.text.trim();
    if (!/\p{L}/u.test(text)) return { ok: false, error: 'nothing' };
    const truncated = text.length > MAX_TEXT;
    // don't split a surrogate pair at the boundary
    if (truncated) text = text.slice(0, /[\uD800-\uDBFF]/.test(text.charAt(MAX_TEXT - 1)) ? MAX_TEXT - 1 : MAX_TEXT);
    try {
      const p = await provider();
      const first = await call(p, req.from, req.to, text, signal, onQueued);
      const { target, secondary } = await langs();
      // text already in the target language goes to the second language; if the second language was requested (popup), to "Translate to"
      const sec = secondary !== req.to ? secondary : target;
      if (first.detected !== req.to || sec === req.to) return { ok: true, text: first.text, detected: first.detected, to: req.to, cached: first.cached, truncated };
      const second = await call(p, first.detected, sec, text, signal, onQueued);
      return { ok: true, text: second.text, detected: first.detected, to: sec, cached: first.cached && second.cached, truncated };
    } catch (e) {
      if (signal.aborted) throw e;
      return failure(e);
    }
  }

  /** Page segments: no cache (the page keeps its own translations) and no second-language rule (the page decides). */
  async function translateBatch(texts: string[], from: string, to: string, signal: AbortSignal): Promise<BatchResponse> {
    try {
      const p = await provider();
      const r = await guard(signal, () => {}, () => {}, () => p.translateMany(texts, from, to, signal));
      return { ok: true, texts: r.map((x) => x.text), detected: r.map((x) => normLang(x.detected)) };
    } catch (e) {
      if (signal.aborted) throw e;
      return failure(e);
    }
  }

  return { translate, translateBatch };
}
