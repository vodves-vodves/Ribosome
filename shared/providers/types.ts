export type ProviderResult = { text: string; detected: string };

/** Точка расширения для DeepL, Cloud Translation с ключом, Chrome Translator API. */
export interface Provider {
  id: string;
  translate(text: string, from: string, to: string, signal: AbortSignal): Promise<ProviderResult>;
}

/** Ответ сервиса с ошибкой. Сетевой сбой — обычный TypeError из fetch. */
export class ProviderError extends Error {
  constructor(
    readonly kind: 'rate_limited' | 'server',
    readonly status?: number,
  ) {
    super(`${kind}${status ? ` ${status}` : ''}`);
  }
}
