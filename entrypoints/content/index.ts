import { browser, type Browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { t } from '@/shared/i18n';
import { normLang } from '@/shared/langs';
import type { OfferMessage, PageStateMessage, TabMessage } from '@/shared/messages';
import base from '@/shared/ui/base.css?inline';
import { ICON } from '@/shared/ui/icons';
import { applyTheme, loadSettings, setAutoSite, watchSettings, watchSystemTheme, type Settings } from '@/shared/settings';
import style from './style.css?inline';
import { Bubble } from './bubble';
import { anchorDead, anchorShown, clamp, clipUnder, headerRects, setPos, viewport, type Pos, type Side } from './geometry';
import { locate } from './locate';
import { PageTranslation, sampleText } from './page';
import { Pill } from './pill';
import { capture, eventRoots, focusRect, focusRoots, onScrollbar, sameRange, type Capture } from './selection';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  // after an extension update the old instance is shut down by an event on document, without postMessage into the page
  noScriptStartedPostMessage: true,
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'ribosome-ui',
      position: 'inline',
      anchor: 'html',
      mode: 'closed',
      css: base + style,
      onMount(root, shadow, host) {
        root.className = 'rb';
        lift(host);
        start(root, shadow, host, ctx.signal);
      },
    });
    ui.mount();
  },
});

/**
 * The host lives in the top layer, independent of the site's z-index and of transform/filter on body.
 * WXT's `:host { all: initial !important }` beats any page styles on the host.
 * Calling it again lifts us above windows the site put into the top layer later.
 */
function lift(host: HTMLElement) {
  if (!host.hasAttribute('popover')) {
    host.setAttribute('popover', 'manual');
    // the host's ::backdrop can only be styled from the document; a site's global `::backdrop { background }` would dim the page
    const s = document.createElement('style');
    s.textContent = `${host.localName}::backdrop{display:none!important}`;
    (document.head ?? document.documentElement).append(s);
  }
  if (host.matches(':popover-open')) host.hidePopover();
  host.showPopover();
}

function start(root: HTMLElement, shadow: ShadowRoot, host: HTMLElement, signal: AbortSignal) {
  let settings: Settings | null = null;
  // the first selection waits for settings instead of running with defaults
  const ready = loadSettings().then((s) => (settings = s));
  const theme = () => settings && applyTheme(root, settings.theme);
  ready.then(theme);
  watchSettings((s) => {
    const was = auto();
    settings = s;
    theme();
    // "Always translate this site" turned on here, in another tab or from the menu
    if (auto() && !was && !page.view.on) return togglePage();
    if (offer && !s.offerPages) {
      offer = '';
      pill.hide();
    }
    pageChanged();
  });
  watchSystemTheme(theme);

  /* ---------- whole page ---------- */
  const site = location.hostname;
  const auto = () => !!settings?.autoSites.includes(site);
  const pill = new Pill(
    root,
    {
      toggle: togglePage,
      retry: () => page.retry(),
      auto: (on) => void setAutoSite(site, on).catch(() => {}),
      dismiss: () => {
        offer = '';
        tell({ type: 'offer:dismiss', host: site });
      },
    },
    signal,
  );
  const page = new PageTranslation(pageChanged);
  /** Language of a page that isn't in the target one, found on open: the bar offers to translate it. */
  let offer = '';

  async function togglePage() {
    await ready;
    if (page.view.on) page.restore();
    else page.translate(settings!);
    lift(host);
    pill.show();
  }

  function tell<R>(m: PageStateMessage | OfferMessage): Promise<R | undefined> {
    try {
      return browser.runtime.sendMessage(m).catch(() => undefined);
    } catch {
      return Promise.resolve(undefined); // orphaned after an extension update
    }
  }

  let reported = '';
  /** The background keeps the toolbar badge and the right-click menu in step with the visible tab. */
  function pageChanged(force = false) {
    // once translated, the bar shows the page's real state
    if (page.view.to) offer = '';
    pill.render(offer ? { ...page.view, from: offer, to: settings!.target } : page.view, auto(), site, !!offer);
    const m: PageStateMessage = { type: 'page:state', on: page.view.on, to: page.view.to, auto: auto() };
    const key = `${m.on} ${m.to} ${m.auto}`;
    if (key === reported && !force) return;
    reported = key;
    tell(m);
  }

  /** A page that isn't in the target language gets an offer. The language is detected in the browser: nothing is sent. */
  async function offerIfForeign(again = true) {
    if (!settings!.offerPages || auto() || page.view.to || signal.aborted) return;
    const text = sampleText();
    // the content may still be loading: one more look a bit later
    if (text.length < 200) return void (again && setTimeout(() => offerIfForeign(false), 2500));
    let found: Browser.i18n.LanguageDetectionResult | null = null;
    try {
      found = await browser.i18n.detectLanguage(text);
    } catch {}
    const top = found?.languages[0];
    if (!top || top.language === 'und' || (!found!.isReliable && top.percentage < 80)) return;
    const lang = normLang(top.language);
    if (lang.split('-')[0] === settings!.target.split('-')[0]) return;
    if ((await tell<boolean>({ type: 'offer:ask', host: site })) !== false || page.view.to) return;
    offer = lang;
    pageChanged();
    lift(host);
    pill.show();
  }

  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && pageChanged(true), { signal });
  ready.then(() => {
    if (auto()) return togglePage();
    pageChanged(true);
    offerIfForeign();
  });
  // the instance replaced by an extension update gives the page back as it was
  signal.addEventListener('abort', () => page.restore());

  const onMessage = (m: TabMessage, _: unknown, respond: (r: unknown) => void) => {
    if (m.type === 'page:toggle') togglePage();
    if (m.type === 'page:get') respond({ on: page.view.on });
    // the right-click item works in any mode and in fields too: it's an explicit request
    if (m.type === 'sel:translate')
      ready.then(() => {
        const c = capture(focusRoots(), true);
        if (c) open(c);
      });
  };
  browser.runtime.onMessage.addListener(onMessage);
  signal.addEventListener('abort', () => {
    try {
      browser.runtime.onMessage.removeListener(onMessage);
    } catch {}
  });

  const trigger = document.createElement('button');
  trigger.className = 'rb-trigger rb-surface';
  trigger.setAttribute('aria-label', t('translate'));
  trigger.title = t('translate');
  trigger.innerHTML = ICON.translate;
  root.append(trigger);

  /** The regular window: one, tied to the text. Pinned windows can be many and live until the page reloads. */
  let active: Bubble | null = null;
  const pinned = new Set<Bubble>();
  /** Selection waiting for an icon click or the instant-mode timer. */
  let cur: Capture | null = null;
  let trigSide: Side | undefined;
  let instantT: ReturnType<typeof setTimeout> | undefined;
  let hideT: ReturnType<typeof setTimeout> | undefined;

  function open(c: Capture) {
    hideTrigger();
    cur = null;
    lift(host);
    const req = { text: c.text, from: settings!.source, to: settings!.target };
    active ??= new Bubble(root, shadow, { close: onClose, pin: onPin, locate: (b) => locate(b, root, host, pinned) });
    active.open(c.anchor, req);
    watchShadowScroll();
  }

  // scroll isn't composed: a listener on window misses scrolling containers inside the page's shadow DOM
  let shadowScroll = new AbortController();
  function watchShadowScroll() {
    shadowScroll.abort();
    shadowScroll = new AbortController();
    for (const a of [active?.anchor, cur?.anchor])
      for (const el of a?.clips ?? []) if (el.getRootNode() !== document) el.addEventListener('scroll', schedule, { passive: true, signal: shadowScroll.signal });
  }

  function onClose(b: Bubble) {
    if (active === b) active = null;
    pinned.delete(b);
  }

  function onPin(b: Bubble, on: boolean) {
    if (on) {
      pinned.add(b);
      if (active === b) active = null;
      return;
    }
    pinned.delete(b);
    if (active && active !== b) active.close();
    active = b;
  }

  function showTrigger(c: Capture) {
    cur = c;
    trigSide = undefined;
    clearTimeout(hideT);
    lift(host);
    trigger.classList.add('is-on');
    applyTrigger(measureTrigger());
    void trigger.offsetWidth;
    trigger.classList.add('is-in');
    watchShadowScroll();
  }

  function hideTrigger() {
    if (!trigger.classList.contains('is-on')) return;
    trigger.classList.remove('is-in');
    clearTimeout(hideT);
    hideT = setTimeout(() => trigger.classList.remove('is-on'), 130);
  }

  function measureTrigger(): Pos | null | undefined {
    if (!cur || !trigger.classList.contains('is-on')) return undefined;
    if (anchorDead(cur.anchor)) return null;
    const r = focusRect(cur);
    if (!r || !anchorShown(r, cur.anchor.clips)) return null;
    const vp = viewport();
    const side = trigSide ?? (r.bottom + 6 + 28 > vp.h - 8 ? 'above' : 'below');
    const left = clamp(r.right + 6, 8, vp.w - 28 - 8);
    const top = side === 'below' ? r.bottom + 6 : r.top - 28 - 6;
    return { left, top, side, clip: clipUnder(headerRects(host), left, top, 28) };
  }

  function applyTrigger(p: Pos | null | undefined) {
    if (p === undefined) return;
    trigger.style.visibility = p ? '' : 'hidden';
    if (!p) return;
    trigSide = p.side;
    setPos(trigger, p);
    trigger.style.clipPath = p.clip;
  }

  /** Click on empty space or Esc: close the icon and the regular window. Pinned windows stay. */
  function dismiss() {
    clearTimeout(instantT);
    hideTrigger();
    cur = null;
    active?.close();
  }

  async function handle(clicks: number, roots: ShadowRoot[], down = downSeq) {
    await ready;
    // the mouse went down again while we waited (double, triple click): the next release decides
    if (down !== downSeq) return;
    const s = settings!;
    const c = capture(roots, s.translateInFields);
    if (!c) {
      // selection cleared (keyboard included): the same selection must trigger again later
      clearTimeout(instantT);
      cur = null;
      return hideTrigger();
    }
    if (c.anchor.range?.intersectsNode(host)) return;
    // same selection as the open or pending one (scrollbar click, selectionchange after mouseup): don't repeat
    if (c.anchor.range && (sameRange(c.anchor.range, active?.anchor.range) || sameRange(c.anchor.range, cur?.anchor.range))) return;
    if (c.anchor.el && (c.anchor.el === active?.anchor.el || c.anchor.el === cur?.anchor.el) && c.text === (active?.req.text ?? cur?.text)) return;
    if (s.mode === 'icon') return showTrigger(c);
    cur = c;
    clearTimeout(instantT);
    // after a double click wait out the Windows multi-click interval, otherwise a triple click makes two requests
    instantT = setTimeout(() => open(c), clicks >= 2 ? 500 : 300);
  }

  trigger.addEventListener('click', () => cur && open(cur));
  // SmoothScroll and the like catch wheel on window and scroll the page: to them our closed shadow root is one element with nothing to scroll
  root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

  // capture on window: editors and drag libraries swallow events while bubbling
  const opts = { capture: true, signal };
  let skipUp = false;
  let downSeq = 0;
  /** What made the selection. Mouse selections are handled on mouseup, the rest (keyboard, long tap) on selectionchange. */
  let lastInput = '';
  addEventListener('pointerdown', (e) => (lastInput = e.pointerType), opts);
  addEventListener(
    'mousedown',
    (e) => {
      downSeq++;
      // the press position decides, not the release: a selection started in our window isn't translated
      skipUp = e.button !== 0 || e.composedPath().includes(host) || onScrollbar(e);
      if (skipUp) return;
      dismiss();
      root.classList.add('is-passive');
    },
    opts,
  );
  // after native drag-and-drop (link, image, selected text) mouseup never comes
  const endPassive = () => root.classList.remove('is-passive');
  addEventListener('dragstart', endPassive, opts);
  addEventListener('pointercancel', endPassive, opts);
  addEventListener(
    'mouseup',
    (e) => {
      endPassive();
      if (e.button !== 0 || skipUp) return;
      const roots = eventRoots(e);
      const clicks = e.detail;
      const down = downSeq;
      setTimeout(() => handle(clicks, roots, down), 0);
    },
    opts,
  );
  // keyboard selection and long tap don't fire mouseup
  let selT: ReturnType<typeof setTimeout> | undefined;
  document.addEventListener(
    'selectionchange',
    () => {
      clearTimeout(selT);
      if (lastInput !== 'mouse') selT = setTimeout(() => lastInput !== 'mouse' && handle(1, focusRoots()), 300);
    },
    opts,
  );
  addEventListener(
    'keydown',
    (e) => {
      lastInput = 'key';
      // Esc in an open dropdown closes only the dropdown
      if (e.key === 'Escape' && !(e.composedPath()[0] as Element).closest?.('select')) dismiss();
    },
    opts,
  );

  // the window and icon move with the text: one read pass and one write pass per frame
  let raf = 0;
  const frame = () => {
    raf = 0;
    if (active && anchorDead(active.anchor)) active.close();
    const pa = active?.measure();
    const pt = measureTrigger();
    active?.apply(pa ?? null);
    applyTrigger(pt);
  };
  const schedule = () => {
    raf ||= requestAnimationFrame(frame);
  };
  // an SPA changed route: pinned windows' text may be gone, so flag it now rather than on the next locate click
  const checkRoute = () =>
    setTimeout(() => {
      if (active && anchorDead(active.anchor)) active.close();
      pinned.forEach((b) => anchorDead(b.anchor) && b.note(t('textGone')));
    }, 1000);
  (globalThis as { navigation?: EventTarget }).navigation?.addEventListener('navigatesuccess', checkRoute, { signal });
  addEventListener('popstate', checkRoute, { signal });

  addEventListener('scroll', schedule, { capture: true, passive: true, signal });
  addEventListener(
    'resize',
    () => {
      schedule();
      pinned.forEach((b) => b.clampIntoView());
    },
    { signal },
  );
}
