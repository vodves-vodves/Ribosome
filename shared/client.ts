import { browser, type Browser } from 'wxt/browser';
import { PORT, type DoneMessage, type QueuedMessage, type Req, type TranslateRequest, type TranslateResponse } from './messages';

export type Result = TranslateResponse | { ok: false; error: 'ctx' };

let seq = 0;

/** Request to the background over its own port. `cancel()` closes the port, and the background cancels the request. */
export function requestTranslation(req: Req, onQueued: () => void): { result: Promise<Result>; cancel: () => void } {
  let port: Browser.runtime.Port;
  try {
    port = browser.runtime.connect({ name: PORT });
  } catch {
    // the content script outlived an extension update: chrome.runtime.id is gone
    return { result: Promise.resolve({ ok: false, error: 'ctx' }), cancel() {} };
  }
  const id = String(++seq);
  // after an extension update the old port throws "Extension context invalidated" on any call
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
