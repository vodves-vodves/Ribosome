import { t } from '@/shared/i18n';
import type { Req } from '@/shared/messages';
import { COPY_LABEL, ICON } from '@/shared/ui/icons';
import { copyText, createRunner, flashCopy, overlayScrollbar, render, type State, type View } from '@/shared/ui/view';
import { anchorRect, anchorShown, clampPos, headerRects, placeBox, setPos, viewport, type Anchor, type Pos, type Side } from './geometry';

const DRAG_END = ['pointerup', 'pointercancel', 'lostpointercapture'] as const;

/** Height of a window with a long translation: the side is picked by it on open, not by the skeleton's height. */
const MAX_H = 330;
const GAP = 10;

const TPL = `
<div class="rb-bh">
  <span class="rb-lang"></span>
  <span class="rb-hb">
    <button class="rb-ib rb-loc" aria-label="${t('showOnPage')}" title="${t('showOnPage')}">${ICON.locate}</button>
    <button class="rb-ib rb-pin" aria-label="${t('pin')}" title="${t('pin')}">${ICON.pin}</button>
    <button class="rb-ib rb-x" aria-label="${t('close')}" title="${t('close')}">${ICON.close}</button>
  </span>
</div>
<button class="rb-src" hidden title="${t('showOnPage')}" dir="auto"></button>
<div class="rb-bt" dir="auto"></div>
<div class="rb-note" hidden></div>
<div class="rb-bf">
  <span class="rb-prov">Google Translate</span>
  <span class="rb-acts">
    <button class="rb-btn rb-retry" hidden>${t('retry')}</button>
    <button class="rb-btn rb-copy" hidden>${COPY_LABEL}</button>
  </span>
</div>`;

export class Bubble {
  readonly el = document.createElement('div');
  anchor!: Anchor;
  req!: Req;
  side?: Side;
  state?: State;
  private v: View;
  private lang: HTMLElement;
  private runner = createRunner((s) => this.show(s));

  constructor(
    layer: HTMLElement,
    private scope: Node,
    private hooks: { close(b: Bubble): void; pin(b: Bubble, pinned: boolean): void; locate(b: Bubble): void },
  ) {
    const el = this.el;
    el.className = 'rb-bubble rb-surface';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', t('translation'));
    el.innerHTML = TPL;
    this.v = { bt: this.q('.rb-bt'), note: this.q('.rb-note'), copy: this.q('.rb-copy'), retry: this.q('.rb-retry') };
    this.lang = this.q('.rb-lang');
    layer.append(el);
    overlayScrollbar(this.v.bt);
    this.q('.rb-x').addEventListener('click', () => this.close());
    this.v.copy.addEventListener('click', async () => {
      if (this.state?.kind === 'ok') flashCopy(this.v.copy, await copyText(this.state.text, this.scope));
    });
    this.v.retry.addEventListener('click', () => (this.state?.kind === 'ctx' ? location.reload() : this.open(this.anchor, this.req)));
    this.q('.rb-pin').addEventListener('click', () => this.togglePin());
    this.q('.rb-bh').addEventListener('pointerdown', (e) => this.drag(e));
    this.q('.rb-loc').addEventListener('click', () => this.hooks.locate(this));
    this.q('.rb-src').addEventListener('click', () => this.hooks.locate(this));
  }

  /** Caption under the translation that keeps the current state ("Show on page" errors). */
  note(text: string) {
    this.v.note.textContent = text;
    this.v.note.hidden = false;
    if (this.pinned) this.clampIntoView();
  }

  /** A pinned window covering the highlighted text moves below it, or above it when there's no room below. */
  nudge(r: DOMRect) {
    if (!this.pinned) return;
    // target position from style, not getBoundingClientRect: the window may be mid-transition
    const left = parseFloat(this.el.style.left);
    const top = parseFloat(this.el.style.top);
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    if (left + w < r.left || left > r.right || top + h < r.top || top > r.bottom) return;
    let t = r.bottom + 12;
    if (t + h > viewport().h - 8) t = r.top - 12 - h;
    this.el.style.top = `${Math.max(8, t)}px`;
  }

  get pinned() {
    return this.el.classList.contains('is-pinned');
  }

  /** A pinned window stays put on screen instead of following its text; unpinning snaps it back to the text. */
  togglePin() {
    const on = this.el.classList.toggle('is-pinned');
    const pin = this.q('.rb-pin');
    pin.title = t(on ? 'unpin' : 'pin');
    pin.setAttribute('aria-label', pin.title);
    const src = this.q('.rb-src');
    src.hidden = !on;
    src.textContent = on ? this.req.text.replace(/\s+/g, ' ').slice(0, 300) : '';
    this.el.style.visibility = '';
    this.el.style.clipPath = ''; // a pinned window sits on screen above the site's header
    this.hooks.pin(this, on);
    if (on) return;
    this.side = undefined;
    this.follow();
  }

  /** Drags a pinned window by its header. A touch interrupted by panning releases it too. */
  private drag(e: PointerEvent) {
    if (!this.pinned || e.button !== 0 || (e.target as Element).closest('button')) return;
    const el = this.el;
    const bh = e.currentTarget as HTMLElement;
    el.parentElement!.append(el); // above the other pinned windows
    const sx = e.clientX - parseFloat(el.style.left);
    const sy = e.clientY - parseFloat(el.style.top);
    const move = (ev: PointerEvent) => setPos(el, clampPos(el, ev.clientX - sx, ev.clientY - sy));
    const up = () => {
      bh.removeEventListener('pointermove', move);
      DRAG_END.forEach((t) => bh.removeEventListener(t, up));
      el.classList.remove('is-drag');
    };
    bh.setPointerCapture(e.pointerId);
    el.classList.add('is-drag');
    bh.addEventListener('pointermove', move);
    DRAG_END.forEach((t) => bh.addEventListener(t, up));
    e.preventDefault();
  }

  clampIntoView() {
    setPos(this.el, clampPos(this.el, parseFloat(this.el.style.left), parseFloat(this.el.style.top)));
  }

  q<T extends HTMLElement = HTMLElement>(s: string) {
    return this.el.querySelector<T>(s)!;
  }

  /** Translates and shows. A new selection in the same window picks the side anew. */
  open(anchor: Anchor, req: Req) {
    this.anchor = anchor;
    this.req = req;
    this.side = undefined;
    this.lang.textContent = `→ ${req.to}`.toUpperCase();
    this.runner.run(req);
  }

  private show(s: State) {
    this.state = s;
    if (s.kind === 'ok') this.lang.textContent = `${s.detected} → ${s.to}`.toUpperCase();
    render(this.v, s);
    if (this.el.classList.contains('is-on')) return this.pinned ? this.clampIntoView() : this.follow();
    this.el.classList.add('is-on');
    this.follow();
    void this.el.offsetWidth;
    this.el.classList.add('is-in');
  }

  /** Read phase of a frame. null: the anchor is out of sight, so the window hides instead of sticking to the edge. */
  measure(): Pos | null {
    if (!this.el.classList.contains('is-on')) return null;
    const r = anchorRect(this.anchor);
    if (!anchorShown(r, this.anchor.clips)) return null;
    return placeBox(this.el.offsetWidth, this.el.offsetHeight, r, GAP, this.side, MAX_H, headerRects((this.scope as ShadowRoot).host));
  }

  /** Write phase of a frame. */
  apply(p: Pos | null) {
    this.el.style.visibility = p ? '' : 'hidden';
    if (!p) return;
    this.side = p.side;
    setPos(this.el, p);
    this.el.style.transformOrigin = p.side === 'below' ? 'top center' : 'bottom center';
    this.el.style.clipPath = p.clip;
  }

  follow() {
    this.apply(this.measure());
  }

  close() {
    this.runner.stop();
    this.el.classList.remove('is-in');
    setTimeout(() => this.el.remove(), 170);
    this.hooks.close(this);
  }
}
