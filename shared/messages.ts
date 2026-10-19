/** Порт на один запрос перевода: content script и popup открывают его, background отвечает. */
export const PORT = 'translate';

export const MAX_TEXT = 5000;

export type Req = { text: string; from: string; to: string };
export type TranslateRequest = Req & { type: 'translate'; id: string };

export type TranslateError = 'offline' | 'rate_limited' | 'server' | 'nothing';

export type TranslateResponse =
  /** `to` — фактический язык результата: с учётом правила второго языка может отличаться от запрошенного. */
  | { ok: true; text: string; detected: string; to: string; cached: boolean; truncated: boolean }
  | { ok: false; error: TranslateError; retryAfter?: number; status?: number };

/** Запрос встал в очередь лимитера — окно показывает «в очереди». */
export type QueuedMessage = { type: 'translate:queued'; id: string };
export type DoneMessage = { type: 'translate:done'; id: string; res: TranslateResponse };
