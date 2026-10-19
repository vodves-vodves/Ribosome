import { ProviderError, type Provider } from './types';

const seen = new Set<string>();

/**
 * Заглушка dev-сборки: маркер в выделенном тексте воспроизводит состояние окна.
 * `[[429]]` — всегда 429, `[[429once]]` — 429 один раз, `[[5xx]]` — 503, `[[offline]]` — сбой сети, `[[slow]]` — ответ через 3 с.
 */
export function withStub(p: Provider): Provider {
  return {
    id: p.id,
    async translate(text, from, to, signal) {
      const m = /\[\[(\w+)\]\]/.exec(text)?.[1];
      if (m === '429' || (m === '429once' && !seen.has(text) && seen.add(text))) throw new ProviderError('rate_limited', 429);
      if (m === '5xx') throw new ProviderError('server', 503);
      if (m === 'offline') throw new TypeError('Failed to fetch');
      if (m === 'slow') await new Promise((r) => setTimeout(r, 3000));
      return p.translate(text, from, to, signal);
    },
  };
}
