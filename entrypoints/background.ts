import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { sessionCache } from '@/shared/cache';
import { PORT, type DoneMessage, type QueuedMessage, type TranslateRequest } from '@/shared/messages';
import { providers } from '@/shared/providers';
import { loadSettings, watchSettings } from '@/shared/settings';
import { createTranslator } from '@/shared/translator';

export default defineBackground(() => {
  let settings = loadSettings();
  watchSettings((s) => (settings = Promise.resolve(s)));

  const translator = createTranslator({
    provider: async () => providers[(await settings).provider] ?? providers.google,
    langs: () => settings,
    cache: sessionCache(),
  });

  // One port per request: the client closing it (new selection, closed window or popup) cancels the request
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT) return;
    const ctrl = new AbortController();
    port.onDisconnect.addListener(() => ctrl.abort());
    port.onMessage.addListener((req: TranslateRequest) => {
      const queued: QueuedMessage = { type: 'translate:queued', id: req.id };
      translator
        .translate(req, ctrl.signal, () => port.postMessage(queued))
        .then((res) => port.postMessage({ type: 'translate:done', id: req.id, res } satisfies DoneMessage))
        .catch(() => {});
    });
  });
});
