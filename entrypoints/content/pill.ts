import { browser } from 'wxt/browser';
import { t } from '@/shared/i18n';
import { langName } from '@/shared/langs';
import type { ShortcutMessage } from '@/shared/messages';
import { ICON } from '@/shared/ui/icons';
import { clamp, viewport } from './geometry';
import type { PageError, PageView } from './page';

type Hooks = { toggle(): void; retry(): void; auto(on: boolean): void };
/** Distance from the nearer side edge and from the top: the capsule grows away from that edge when it unfolds. */
type Spot = { side: 'left' | 'right'; x: number; y: number };

const SPOT = 'pillSpot';
const FOLD_MS = 3000;
const RING = 2 * Math.PI * 12;
const DRAG_END = ['pointerup', 'pointercancel', 'lostpointercapture'] as const;

const TPL = `
<span class="rb-pi"><svg class="rb-ring" viewBox="0 0 28 28" hidden><circle cx="14" cy="14" r="12"/><circle cx="14" cy="14" r="12" stroke-dasharray="${RING}"/></svg>${ICON.translate}</span>
<span class="rb-pt" aria-live="polite"></span>
<span class="rb-psep"></span>
<button class="rb-btn rb-pa"></button>
<button class="rb-btn rb-pb" hidden></button>
<button class="rb-ib rb-more" aria-expanded="false" aria-label="${t('more')}" title="${t('more')}">${ICON.more}</button>
<button class="rb-ib rb-x" aria-label="${t('hide')}" title="${t('hide')}">${ICON.close}</button>`;

const MENU = `
<label class="rb-prow"><span>${t('alwaysSite')}<span class="s"></span></span><input type="checkbox" class="rb-switch" role="switch"></label>
<div class="rb-pft" hidden></div>`;

const errText = (e: PageError) =>
  e.kind === 'rate_limited' ? t('pageRateLimited') : e.kind === 'offline' ? t('pageOffline') : e.kind === 'server' ? t('pageServer') : t('pageUpdated');

/** The bar of a translated page: a capsule that folds into a circle, can be dragged and remembers where it was left. */
export class Pill {
  readonly el = document.createElement('div');
  private menu = document.createElement('div');
  private spot: Spot = { side: 'right', x: 14, y: 14 };
  private foldT: ReturnType<typeof setTimeout> | undefined;
  private actions: { a?: () => void; b?: () => void } = {};
  private canFold = false;

  constructor(
    layer: HTMLElement,
    private hooks: Hooks,
    signal: AbortSignal,
  ) {
    const el = this.el;
    el.className = 'rb-pill rb-surface';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', t('translatePage'));
    el.innerHTML = TPL;
    this.menu.className = 'rb-pmenu rb-surface';
    this.menu.innerHTML = MENU;
    layer.append(el, this.menu);

    this.q('.rb-pa').addEventListener('click', () => this.actions.a?.());
    this.q('.rb-pb').addEventListener('click', () => this.actions.b?.());
    this.q('.rb-x').addEventListener('click', () => this.hide());
    this.q('.rb-more').addEventListener('click', () => this.toggleMenu());
    this.menu.querySelector('input')!.addEventListener('change', (e) => this.hooks.auto((e.target as HTMLInputElement).checked));
    el.addEventListener('pointerdown', (e) => this.drag(e));
    el.addEventListener('mouseenter', () => this.unfold());
    el.addEventListener('mouseleave', () => this.arm());
    el.addEventListener('focusin', () => this.unfold());
    el.addEventListener('focusout', () => this.arm());

    const opts = { capture: true, signal };
    // from window, a closed shadow root shows only its host in the path
    const host = (layer.getRootNode() as ShadowRoot).host;
    addEventListener('pointerdown', (e) => this.isMenu() && !e.composedPath().includes(host) && this.closeMenu(), opts);
    addEventListener('keydown', (e) => e.key === 'Escape' && this.closeMenu(), opts);
    addEventListener('resize', () => this.place(), { signal });
    browser.storage.local
      .get(SPOT)
      .then((r) => {
        if (r[SPOT]) this.spot = r[SPOT] as Spot;
        this.place();
      })
      .catch(() => {});
  }

  private q<T extends HTMLElement = HTMLElement>(s: string) {
    return this.el.querySelector<T>(s)!;
  }

  get shown() {
    return this.el.classList.contains('is-on');
  }

  show() {
    if (this.shown) {
      this.unfold();
      return this.arm();
    }
    this.el.classList.add('is-on');
    this.place();
    void this.el.offsetWidth;
    this.el.classList.add('is-in');
    this.arm();
  }

  hide() {
    this.closeMenu();
    this.el.classList.remove('is-on', 'is-in', 'is-mini');
  }

  render(v: PageView, auto: boolean, host: string) {
    const e = v.error;
    const txt = this.q('.rb-pt');
    const sub = (s: string) => {
      const span = document.createElement('span');
      span.className = 'sub';
      span.textContent = ` · ${s}`;
      txt.append(span);
    };
    if (e) txt.textContent = errText(e);
    else if (!v.on) txt.textContent = t('showingOriginal');
    else txt.textContent = v.from ? `${langName(v.from)} → ${langName(v.to)}` : t('pageTranslating');
    if (e?.kind === 'rate_limited') sub(t('resumeIn', e.wait));
    else if (!v.on && v.from) sub(langName(v.from));

    const a = this.q<HTMLButtonElement>('.rb-pa');
    const b = this.q<HTMLButtonElement>('.rb-pb');
    const set = (btn: HTMLButtonElement, label: string, fn?: () => void, accent = false) => {
      btn.hidden = !fn;
      btn.textContent = label;
      btn.classList.toggle('is-acc', accent);
      return fn;
    };
    const toggle = () => this.hooks.toggle();
    if (e?.kind === 'ctx') this.actions = { a: set(a, t('reloadPage'), () => location.reload()), b: set(b, '') };
    else if (e && e.kind !== 'rate_limited') this.actions = { a: set(a, t('retry'), () => this.hooks.retry()), b: set(b, t('original'), toggle) };
    else this.actions = { a: set(a, t(v.on ? 'original' : 'translate'), toggle, !v.on), b: set(b, '') };

    const ring = this.el.querySelector<SVGElement>('.rb-ring')!;
    ring.toggleAttribute('hidden', v.progress === null);
    ring.classList.toggle('is-paused', !!e);
    ring.lastElementChild!.setAttribute('stroke-dashoffset', String(RING * (1 - (v.progress ?? 0))));

    this.menu.querySelector('input')!.checked = auto;
    this.menu.querySelector('.s')!.textContent = host;

    // an error waits for the user, unfolded
    this.canFold = !e;
    if (e) this.unfold();
    else if (!this.foldT && !this.el.classList.contains('is-mini')) this.arm();
    this.place();
  }

  private unfold() {
    clearTimeout(this.foldT);
    this.foldT = undefined;
    if (!this.el.classList.contains('is-mini')) return;
    this.el.classList.remove('is-mini');
    this.place();
  }

  /** Folds after a while at rest: not under the pointer, not focused, menu closed, no error. */
  private arm() {
    clearTimeout(this.foldT);
    this.foldT = setTimeout(() => {
      this.foldT = undefined;
      if (!this.canFold || this.isMenu() || this.el.matches(':hover, :focus-within')) return;
      this.el.classList.add('is-mini');
      this.place();
    }, FOLD_MS);
  }

  private isMenu() {
    return this.menu.classList.contains('is-on');
  }

  private toggleMenu() {
    if (this.isMenu()) return this.closeMenu();
    this.menu.classList.add('is-on');
    this.q('.rb-more').setAttribute('aria-expanded', 'true');
    this.placeMenu();
    const ft = this.menu.querySelector<HTMLElement>('.rb-pft')!;
    browser.runtime
      .sendMessage({ type: 'shortcut' } satisfies ShortcutMessage)
      .then((key: string) => {
        ft.hidden = !key;
        const [pre, post] = t('hotkeyHint').split('$1');
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        ft.replaceChildren(pre!, kbd, post ?? '');
        this.placeMenu();
      })
      .catch(() => (ft.hidden = true));
  }

  private closeMenu() {
    if (!this.isMenu()) return;
    this.menu.classList.remove('is-on');
    this.q('.rb-more').setAttribute('aria-expanded', 'false');
    this.arm();
  }

  private place() {
    if (!this.shown) return;
    const { side, x, y } = this.spot;
    const vp = viewport();
    const el = this.el;
    const cx = clamp(x, 8, Math.max(8, vp.w - el.offsetWidth - 8));
    el.style.left = side === 'left' ? `${cx}px` : 'auto';
    el.style.right = side === 'right' ? `${cx}px` : 'auto';
    el.style.top = `${clamp(y, 8, Math.max(8, vp.h - el.offsetHeight - 8))}px`;
    if (this.isMenu()) this.placeMenu();
  }

  /** Under the capsule, or above it near the bottom of the screen; on the capsule's side. */
  private placeMenu() {
    const r = this.el.getBoundingClientRect();
    const vp = viewport();
    const m = this.menu;
    const below = r.bottom + 8 + m.offsetHeight <= vp.h - 8;
    m.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - 8 - m.offsetHeight)}px`;
    m.style.left = this.spot.side === 'left' ? `${r.left}px` : 'auto';
    m.style.right = this.spot.side === 'right' ? `${vp.w - r.right}px` : 'auto';
  }

  /** Drag by any spot but the buttons; a press without movement on the circle unfolds it. */
  private drag(e: PointerEvent) {
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    const el = this.el;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      if (!moved) {
        moved = true;
        el.classList.add('is-drag');
        this.closeMenu();
      }
      const vp = viewport();
      el.style.right = 'auto';
      el.style.left = `${clamp(ev.clientX - dx, 8, vp.w - el.offsetWidth - 8)}px`;
      el.style.top = `${clamp(ev.clientY - dy, 8, vp.h - el.offsetHeight - 8)}px`;
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      DRAG_END.forEach((n) => el.removeEventListener(n, up));
      el.classList.remove('is-drag');
      if (!moved) {
        this.unfold();
        return this.arm();
      }
      const b = el.getBoundingClientRect();
      const vw = viewport().w;
      const side = b.left + b.width / 2 < vw / 2 ? 'left' : 'right';
      this.spot = { side, x: side === 'left' ? b.left : vw - b.right, y: b.top };
      browser.storage.local.set({ [SPOT]: this.spot }).catch(() => {});
      this.place();
    };
    el.setPointerCapture(e.pointerId);
    el.addEventListener('pointermove', move);
    DRAG_END.forEach((n) => el.addEventListener(n, up));
    e.preventDefault();
  }
}
