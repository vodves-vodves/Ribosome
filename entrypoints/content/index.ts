import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import base from '@/shared/ui/base.css?inline';
import { ICON } from '@/shared/ui/icons';
import { applyTheme, loadSettings, watchSettings, watchSystemTheme, type Settings } from '@/shared/settings';
import style from './style.css?inline';
import { Bubble } from './bubble';
import { anchorDead, anchorShown, clamp, setPos, viewport, type Pos, type Side } from './geometry';
import { locate } from './locate';
import { capture, eventRoots, focusRect, focusRoots, onScrollbar, sameRange, type Capture } from './selection';

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
 * Хост — в top layer: не зависим от z-index сайта и от transform/filter на body.
 * `:host { all: initial !important }` от WXT перебивает любые стили страницы на хосте.
 * Повторный вызов поднимает нас над окнами, которые сайт вывел в top layer позже.
 */
function lift(host: HTMLElement) {
  if (!host.hasAttribute('popover')) {
    host.setAttribute('popover', 'manual');
    // ::backdrop хоста стилизуется только из документа; глобальный `::backdrop { background }` сайта затемнил бы страницу
    const s = document.createElement('style');
    s.textContent = `${host.localName}::backdrop{display:none!important}`;
    (document.head ?? document.documentElement).append(s);
  }
  if (host.matches(':popover-open')) host.hidePopover();
  host.showPopover();
}

function start(root: HTMLElement, shadow: ShadowRoot, host: HTMLElement, signal: AbortSignal) {
  let settings: Settings | null = null;
  // первое выделение ждёт настроек, а не работает с дефолтами
  const ready = loadSettings().then((s) => (settings = s));
  const theme = () => settings && applyTheme(root, settings.theme);
  ready.then(theme);
  watchSettings((s) => {
    settings = s;
    theme();
  });
  watchSystemTheme(theme);

  const trigger = document.createElement('button');
  trigger.className = 'rb-trigger rb-surface';
  trigger.setAttribute('aria-label', 'Перевести');
  trigger.title = 'Перевести';
  trigger.innerHTML = ICON.translate;
  root.append(trigger);

  /** Обычное окно: одно, привязано к тексту. Закреплённых может быть несколько, живут до перезагрузки страницы. */
  let active: Bubble | null = null;
  const pinned = new Set<Bubble>();
  /** Выделение, ждущее клика по иконке или таймера режима «сразу». */
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

  // scroll не composed: прокрутку контейнеров внутри shadow DOM страницы слушатель на window не видит
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
    return { left: clamp(r.right + 6, 8, vp.w - 28 - 8), top: side === 'below' ? r.bottom + 6 : r.top - 28 - 6, side };
  }

  function applyTrigger(p: Pos | null | undefined) {
    if (p === undefined) return;
    trigger.style.visibility = p ? '' : 'hidden';
    if (!p) return;
    trigSide = p.side;
    setPos(trigger, p);
  }

  /** Клик в пустое место, Esc: закрыть иконку и обычное окно. Закреплённые остаются. */
  function dismiss() {
    clearTimeout(instantT);
    hideTrigger();
    cur = null;
    active?.close();
  }

  async function handle(clicks: number, roots: ShadowRoot[], down = downSeq) {
    await ready;
    // пока ждали, мышь нажали снова (двойной, тройной клик) — решать будет следующее отпускание
    if (down !== downSeq) return;
    const s = settings!;
    const c = capture(roots, s.translateInFields);
    if (!c) {
      // выделение снято (в том числе с клавиатуры): то же выделение потом снова должно сработать
      clearTimeout(instantT);
      cur = null;
      return hideTrigger();
    }
    if (c.anchor.range?.intersectsNode(host)) return;
    // то же выделение, что уже открыто или ждёт (клик по скроллбару, selectionchange после mouseup) — не повторяем
    if (c.anchor.range && (sameRange(c.anchor.range, active?.anchor.range) || sameRange(c.anchor.range, cur?.anchor.range))) return;
    if (c.anchor.el && (c.anchor.el === active?.anchor.el || c.anchor.el === cur?.anchor.el) && c.text === (active?.req.text ?? cur?.text)) return;
    if (s.mode === 'icon') return showTrigger(c);
    cur = c;
    clearTimeout(instantT);
    // после двойного клика ждём интервал мультиклика Windows, иначе тройной клик даст два запроса
    instantT = setTimeout(() => open(c), clicks >= 2 ? 500 : 300);
  }

  trigger.addEventListener('click', () => cur && open(cur));

  // capture на window: редакторы и drag-библиотеки гасят события на всплытии
  const opts = { capture: true, signal };
  let skipUp = false;
  let downSeq = 0;
  /** Чем сделано выделение. Мышиное обрабатывает mouseup, остальное (клавиатура, долгий тап) — selectionchange. */
  let lastInput = '';
  addEventListener('pointerdown', (e) => (lastInput = e.pointerType), opts);
  addEventListener(
    'mousedown',
    (e) => {
      downSeq++;
      // решает место нажатия, а не отпускания: выделение, начатое в нашем окне, не переводим
      skipUp = e.button !== 0 || e.composedPath().includes(host) || onScrollbar(e);
      if (skipUp) return;
      dismiss();
      root.classList.add('is-passive');
    },
    opts,
  );
  // после нативного drag-and-drop (ссылка, картинка, выделенный текст) mouseup не приходит
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
  // выделение с клавиатуры и долгий тап не дают mouseup
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
      // Esc в открытом списке закрывает только список
      if (e.key === 'Escape' && !(e.composedPath()[0] as Element).closest?.('select')) dismiss();
    },
    opts,
  );

  // окно и иконка едут с текстом; один проход чтения и один записи на кадр
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
  // SPA сменил маршрут: текст закреплённых окон мог исчезнуть — помечаем сразу, а не по клику на прицел
  const checkRoute = () =>
    setTimeout(() => {
      if (active && anchorDead(active.anchor)) active.close();
      pinned.forEach((b) => anchorDead(b.anchor) && b.note('Текст на странице уже не найден — страница изменилась.'));
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
