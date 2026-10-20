/** One port per request: the content script and popup open it, the background answers. */
export const PORT = 'translate';

export const MAX_TEXT = 5000;

export type Req = { text: string; from: string; to: string };
export type TranslateRequest = Req & { type: 'translate'; id: string };
/** Page segments from `segments.ts`, one answer per segment. */
export type BatchRequest = { type: 'batch'; id: string; texts: string[]; from: string; to: string };

export type TranslateError = 'offline' | 'rate_limited' | 'server' | 'nothing';
export type TranslateFailure = { ok: false; error: TranslateError; retryAfter?: number; status?: number };

export type TranslateResponse =
  /** `to` is the actual result language: the second-language rule may make it differ from the requested one. */
  { ok: true; text: string; detected: string; to: string; cached: boolean; truncated: boolean } | TranslateFailure;

export type BatchResponse = { ok: true; texts: string[]; detected: string[] } | TranslateFailure;

/** The request is waiting in the limiter queue; the window shows "queued". */
export type QueuedMessage = { type: 'translate:queued'; id: string };
export type DoneMessage = { type: 'translate:done'; id: string; res: TranslateResponse | BatchResponse };

/** Background → content script of a tab. */
export type TabMessage = { type: 'page:toggle' } | { type: 'page:get' } | { type: 'sel:translate' };
/** Content script → background: the right-click menu and the toolbar badge follow the visible tab. */
export type PageStateMessage = { type: 'page:state'; on: boolean; to: string; auto: boolean };
export type ShortcutMessage = { type: 'shortcut' };
