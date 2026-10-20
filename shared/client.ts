import { browser, type Browser } from 'wxt/browser';
import {
  PORT,
  type BatchRequest,
  type BatchResponse,
  type DoneMessage,
  type QueuedMessage,
  type Req,
  type TranslateRequest,
  type TranslateResponse,
} from './messages';

type Ctx = { ok: false; error: 'ctx' };

let seq = 0;

/** Request to the background over its own port. `cancel()` closes the port, and the background cancels the request. */
export function requestTranslation(req: Req, onQueued: () => void) {
  return ask<TranslateResponse>({ type: 'translate', ...req }, onQueued);
}

export function requestBatch(texts: string[], from: string, to: string) {
  return ask<BatchResponse>({ type: 'batch', texts, from, to }, () => {});
}

type Body = Omit<TranslateRequest, 'id'> | Omit<BatchRequest, 'id'>;

function ask<R>(body: Body, onQueued: () => void): { result: Promise<R | Ctx>; cancel: () => void } {
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
  const result = new Promise<R | Ctx>((resolve) => {
    port.onMessage.addListener((m: QueuedMessage | DoneMessage) => {
      if (m.id !== id) return;
      if (m.type === 'translate:queued') return onQueued();
      resolve(m.res as R);
      disconnect();
    });
    port.onDisconnect.addListener(() => resolve((browser.runtime?.id ? { ok: false, error: 'server' } : { ok: false, error: 'ctx' }) as R | Ctx));
    try {
      port.postMessage({ ...body, id } satisfies TranslateRequest | BatchRequest);
    } catch {
      resolve({ ok: false, error: 'ctx' });
    }
  });
  return { result, cancel: disconnect };
}
