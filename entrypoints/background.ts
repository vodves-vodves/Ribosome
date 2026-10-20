import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { sessionCache } from '@/shared/cache';
import { t } from '@/shared/i18n';
import {
  PORT,
  type BatchRequest,
  type DoneMessage,
  type PageStateMessage,
  type QueuedMessage,
  type ShortcutMessage,
  type TabMessage,
  type TranslateRequest,
} from '@/shared/messages';
import { providers } from '@/shared/providers';
import { loadSettings, setAutoSite, watchSettings } from '@/shared/settings';
import { createTranslator } from '@/shared/translator';

export default defineBackground(() => {
  let settings = loadSettings();
  watchSettings((s) => (settings = Promise.resolve(s)));

  const translator = createTranslator({
    provider: async () => providers[(await settings).provider] ?? providers.google,
    langs: () => settings,
    cache: sessionCache(),
  });

  // One port per request: the client closing it (new selection, closed window or popup, page back to original) cancels the request
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT) return;
    const ctrl = new AbortController();
    port.onDisconnect.addListener(() => ctrl.abort());
    port.onMessage.addListener((req: TranslateRequest | BatchRequest) => {
      const done = (res: DoneMessage['res']) => port.postMessage({ type: 'translate:done', id: req.id, res } satisfies DoneMessage);
      if (req.type === 'batch') return void translator.translateBatch(req.texts, req.from, req.to, ctrl.signal).then(done, () => {});
      const queued: QueuedMessage = { type: 'translate:queued', id: req.id };
      translator.translate(req, ctrl.signal, () => port.postMessage(queued)).then(done, () => {});
    });
  });

  // menus outlive the service worker; on update they are rebuilt with the new strings
  browser.runtime.onInstalled.addListener(async () => {
    await browser.contextMenus.removeAll();
    const documentUrlPatterns = ['http://*/*', 'https://*/*'];
    browser.contextMenus.create({ id: 'page', title: t('translatePage'), contexts: ['page'], documentUrlPatterns });
    browser.contextMenus.create({ id: 'site', type: 'checkbox', title: t('alwaysSite'), contexts: ['page'], documentUrlPatterns });
    browser.contextMenus.create({ id: 'sel', title: t('menuTranslateSel'), contexts: ['selection'], documentUrlPatterns });
  });

  // the content script may be missing (not loaded yet) or orphaned after an update
  const send = (tabId: number, m: TabMessage) => browser.tabs.sendMessage(tabId, m).catch(() => {});

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    if (info.menuItemId === 'page') send(tab.id, { type: 'page:toggle' });
    if (info.menuItemId === 'sel') send(tab.id, { type: 'sel:translate' });
    // the page's content script sees the setting change and translates itself
    if (info.menuItemId === 'site' && info.pageUrl) setAutoSite(new URL(info.pageUrl).hostname, !!info.checked);
  });

  browser.commands.onCommand.addListener((cmd, tab) => {
    if (cmd === 'toggle-page' && tab?.id) send(tab.id, { type: 'page:toggle' });
  });

  browser.action.setBadgeBackgroundColor({ color: '#007aff' });
  browser.action.setBadgeTextColor({ color: '#fff' });

  browser.runtime.onMessage.addListener((m: PageStateMessage | ShortcutMessage, sender, respond) => {
    if (m.type === 'shortcut') {
      browser.commands.getAll().then((all) => respond(all.find((c) => c.name === 'toggle-page')?.shortcut ?? ''));
      return true;
    }
    const tab = sender.tab;
    if (m.type !== 'page:state' || !tab?.id) return;
    browser.action.setBadgeText({ tabId: tab.id, text: m.on ? m.to.split('-')[0]!.toUpperCase() : '' });
    // menus are shared by all tabs: they follow the visible one
    if (!tab.active) return;
    browser.contextMenus.update('page', { title: t(m.on ? 'showOriginal' : 'translatePage') }).catch(() => {});
    browser.contextMenus.update('site', { checked: m.auto }).catch(() => {});
  });
});
