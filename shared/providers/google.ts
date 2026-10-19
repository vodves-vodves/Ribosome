import { ProviderError, type Provider, type ProviderResult } from './types';

const URL_BASE = 'https://translate.googleapis.com/translate_a/single';

/** Неофициальный endpoint gtx: без ключа, но может ответить 429. */
export const google: Provider = {
  id: 'google',
  async translate(text, from, to, abort) {
    const url = `${URL_BASE}?${new URLSearchParams({ client: 'gtx', sl: from, tl: to, dt: 't' })}`;
    // зависшее соединение: через 15 с — TimeoutError, для пользователя «Нет соединения» с кнопкой «Повторить»
    const signal = AbortSignal.any([abort, AbortSignal.timeout(15_000)]);
    // длинный текст не влезает в URL
    const res =
      text.length > 1500
        ? await fetch(url, { method: 'POST', body: new URLSearchParams({ q: text }), signal })
        : await fetch(`${url}&q=${encodeURIComponent(text)}`, { signal });
    if (res.status === 429 || res.status === 403) throw new ProviderError('rate_limited', res.status);
    if (!res.ok) throw new ProviderError('server', res.status);
    let data: unknown;
    try {
      data = await res.json();
    } catch (e) {
      if (e instanceof SyntaxError) throw new ProviderError('server');
      throw e; // обрыв сети посреди тела — это «нет соединения», а не ошибка сервиса
    }
    try {
      return parseGtx(data);
    } catch {
      throw new ProviderError('server');
    }
  },
};

/** `[[["перевод","оригинал",…],…], null, "en", …]` → перевод и определённый язык. */
export function parseGtx(data: unknown): ProviderResult {
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('unexpected gtx response');
  const text = (data[0] as unknown[][]).map((x) => (typeof x?.[0] === 'string' ? x[0] : '')).join('');
  return { text, detected: typeof data[2] === 'string' ? data[2] : '' };
}
