import { ProviderError, type Provider, type ProviderResult } from './types';

const BASE = 'https://translate.googleapis.com/translate_a';

/** Unofficial gtx endpoints: no key needed, but they may answer 429. */
export const google: Provider = {
  id: 'google',
  async translate(text, from, to, abort) {
    const url = `${BASE}/single?${new URLSearchParams({ client: 'gtx', sl: from, tl: to, dt: 't' })}`;
    // long text doesn't fit in a URL
    const data =
      text.length > 1500
        ? await gtx(url, abort, new URLSearchParams({ q: text }))
        : await gtx(`${url}&q=${encodeURIComponent(text)}`, abort);
    return parse(() => parseGtx(data));
  },
  async translateMany(texts, from, to, abort) {
    const body = new URLSearchParams();
    texts.forEach((t) => body.append('q', t));
    const data = await gtx(`${BASE}/t?${new URLSearchParams({ client: 'gtx', format: 'html', sl: from, tl: to })}`, abort, body);
    return parse(() => parseGtxMany(data, texts.length, from));
  },
};

async function gtx(url: string, abort: AbortSignal, body?: URLSearchParams): Promise<unknown> {
  // a hung connection becomes a TimeoutError after 15 s, shown as "No connection" with a Retry button
  const signal = AbortSignal.any([abort, AbortSignal.timeout(15_000)]);
  const res = await fetch(url, body ? { method: 'POST', body, signal } : { signal });
  if (res.status === 429 || res.status === 403) throw new ProviderError('rate_limited', res.status);
  if (!res.ok) throw new ProviderError('server', res.status);
  try {
    return await res.json();
  } catch (e) {
    if (e instanceof SyntaxError) throw new ProviderError('server');
    throw e; // a network drop mid-body means no connection, not a service error
  }
}

function parse<T>(fn: () => T): T {
  try {
    return fn();
  } catch {
    throw new ProviderError('server');
  }
}

/** `[[["translation","original",…],…], null, "en", …]` → translation and detected language. */
export function parseGtx(data: unknown): ProviderResult {
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('unexpected gtx response');
  const text = (data[0] as unknown[][]).map((x) => (typeof x?.[0] === 'string' ? x[0] : '')).join('');
  return { text, detected: typeof data[2] === 'string' ? data[2] : '' };
}

/** `[["translation","de"],…]` with `sl=auto`, `["translation",…]` with a fixed source language. */
export function parseGtxMany(data: unknown, n: number, from: string): ProviderResult[] {
  if (!Array.isArray(data) || data.length !== n) throw new Error('unexpected gtx response');
  return data.map((x: unknown) => {
    if (typeof x === 'string') return { text: x, detected: from };
    if (Array.isArray(x) && typeof x[0] === 'string') return { text: x[0], detected: typeof x[1] === 'string' ? x[1] : '' };
    throw new Error('unexpected gtx segment');
  });
}
