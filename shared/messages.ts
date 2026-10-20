/** One port per translation request: the content script and popup open it, the background answers. */
export const PORT = 'translate';

export const MAX_TEXT = 5000;

export type Req = { text: string; from: string; to: string };
export type TranslateRequest = Req & { type: 'translate'; id: string };

export type TranslateError = 'offline' | 'rate_limited' | 'server' | 'nothing';

export type TranslateResponse =
  /** `to` is the actual result language: the second-language rule may make it differ from the requested one. */
  | { ok: true; text: string; detected: string; to: string; cached: boolean; truncated: boolean }
  | { ok: false; error: TranslateError; retryAfter?: number; status?: number };

/** The request is waiting in the limiter queue; the window shows "queued". */
export type QueuedMessage = { type: 'translate:queued'; id: string };
export type DoneMessage = { type: 'translate:done'; id: string; res: TranslateResponse };
