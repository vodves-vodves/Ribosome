import { ProviderError, type Provider } from './types';

const seen = new Set<string>();

/**
 * Dev build stub: a marker in the selected text (or anywhere in a page batch) reproduces a window state.
 * `[[429]]` always 429, `[[429once]]` 429 once, `[[5xx]]` 503, `[[offline]]` network failure, `[[slow]]` answer after 3 s.
 */
export function withStub(p: Provider): Provider {
  const check = async (text: string) => {
    const m = /\[\[(\w+)\]\]/.exec(text)?.[1];
    if (m === '429' || (m === '429once' && !seen.has(text) && seen.add(text))) throw new ProviderError('rate_limited', 429);
    if (m === '5xx') throw new ProviderError('server', 503);
    if (m === 'offline') throw new TypeError('Failed to fetch');
    if (m === 'slow') await new Promise((r) => setTimeout(r, 3000));
  };
  return {
    id: p.id,
    async translate(text, from, to, signal) {
      await check(text);
      return p.translate(text, from, to, signal);
    },
    async translateMany(texts, from, to, signal) {
      await check(texts.join('\n'));
      return p.translateMany(texts, from, to, signal);
    },
  };
}
