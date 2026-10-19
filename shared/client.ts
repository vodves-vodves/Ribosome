import { browser, type Browser } from 'wxt/browser';
import { PORT, type DoneMessage, type QueuedMessage, type Req, type TranslateRequest, type TranslateResponse } from './messages';

export type Result = TranslateResponse | { ok: false; error: 'ctx' };

let seq = 0;

/** Запрос в background через свой порт. `cancel()` закрывает порт — background отменяет запрос. */
export function requestTranslation(req: Req, onQueued: () => void): { result: Promise<Result>; cancel: () => void } {
  let port: Browser.runtime.Port;
  try {
    port = browser.runtime.connect({ name: PORT });
  } catch {
    // content script пережил обновление расширения: chrome.runtime.id больше нет
    return { result: Promise.resolve({ ok: false, error: 'ctx' }), cancel() {} };
  }
  const id = String(++seq);
  // после обновления расширения старый порт бросает «Extension context invalidated» на любой вызов
  const disconnect = () => {
    try {
      port.disconnect();
    } catch {}
  };
  const result = new Promise<Result>((resolve) => {
    port.onMessage.addListener((m: QueuedMessage | DoneMessage) => {
      if (m.id !== id) return;
      if (m.type === 'translate:queued') return onQueued();
      resolve(m.res);
      disconnect();
    });
    port.onDisconnect.addListener(() => resolve(browser.runtime?.id ? { ok: false, error: 'server' } : { ok: false, error: 'ctx' }));
    try {
      port.postMessage({ type: 'translate', id, ...req } satisfies TranslateRequest);
    } catch {
      resolve({ ok: false, error: 'ctx' });
    }
  });
  return { result, cancel: disconnect };
}
