export type ProviderResult = { text: string; detected: string };

/** Extension point for DeepL, Cloud Translation with a key, Chrome's Translator API. */
export interface Provider {
  id: string;
  translate(text: string, from: string, to: string, signal: AbortSignal): Promise<ProviderResult>;
  /** Page translation: many HTML segments in one request, one result per segment. */
  translateMany(texts: string[], from: string, to: string, signal: AbortSignal): Promise<ProviderResult[]>;
}

/** Error response from the service. A network failure is a plain TypeError from fetch. */
export class ProviderError extends Error {
  constructor(
    readonly kind: 'rate_limited' | 'server',
    readonly status?: number,
  ) {
    super(`${kind}${status ? ` ${status}` : ''}`);
  }
}
