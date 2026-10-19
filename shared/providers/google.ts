import { ProviderError, type Provider, type ProviderResult } from './types';

const URL_BASE = 'https://translate.googleapis.com/translate_a/single';

/** Неофициальный endpoint gtx: без ключа, но может ответить 429. */
export const google: Provider = {
  id: 'google',
  async translate(text, from, to, signal) {
    const url = `${URL_BASE}?${new URLSearchParams({ client: 'gtx', sl: from, tl: to, dt: 't' })}`;
    // длинный текст не влезает в URL
    const res =
      text.length > 1500
        ? await fetch(url, { method: 'POST', body: new URLSearchParams({ q: text }), signal })
        : await fetch(`${url}&q=${encodeURIComponent(text)}`, { signal });
    if (res.status === 429 || res.status === 403) throw new ProviderError('rate_limited', res.status);
    if (!res.ok) throw new ProviderError('server', res.status);
    try {
      return parseGtx(await res.json());
    } catch {
      throw new ProviderError('server', res.status);
    }
  },
};

/** `[[["перевод","оригинал",…],…], null, "en", …]` → перевод и определённый язык. */
export function parseGtx(data: unknown): ProviderResult {
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('unexpected gtx response');
  const text = (data[0] as unknown[][]).map((x) => (typeof x?.[0] === 'string' ? x[0] : '')).join('');
  return { text, detected: typeof data[2] === 'string' ? data[2] : '' };
}
