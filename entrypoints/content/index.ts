import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import base from '@/shared/ui/base.css?inline';
import style from './style.css?inline';
import { applyTheme, loadSettings, watchSettings, watchSystemTheme, type Settings } from '@/shared/settings';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  // старый экземпляр после обновления расширения снимается событием на document, без postMessage в страницу
  noScriptStartedPostMessage: true,
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'ribosome-ui',
      position: 'inline',
      anchor: 'html',
      mode: 'closed',
      css: base + style,
      onMount(root, _shadow, host) {
        root.className = 'rb';
        lift(host);
        start(root);
      },
    });
    ui.mount();
  },
});

/**
 * Хост — в top layer: не зависим от z-index сайта и от transform/filter на body.
 * `:host { all: initial !important }` от WXT перебивает любые стили страницы на хосте.
 */
function lift(host: HTMLElement) {
  host.setAttribute('popover', 'manual');
  host.showPopover();
  // ::backdrop хоста стилизуется только из документа; глобальный `::backdrop { background }` сайта затемнил бы страницу
  const s = document.createElement('style');
  s.textContent = `${host.localName}::backdrop{display:none!important}`;
  (document.head ?? document.documentElement).append(s);
}

function start(root: HTMLElement) {
  let settings: Settings | null = null;
  const ready = loadSettings().then((s) => (settings = s));
  const theme = () => settings && applyTheme(root, settings.theme);
  ready.then(theme);
  watchSettings((s) => {
    settings = s;
    theme();
  });
  watchSystemTheme(theme);
}
