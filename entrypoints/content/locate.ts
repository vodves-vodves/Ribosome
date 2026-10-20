// "Show on page": scroll to a pinned window's source text and highlight it with an overlay. The site's DOM is left alone.
import type { Bubble } from './bubble';
import { anchorDead, anchorRect, clipUnder, headerRects, viewport, type Anchor } from './geometry';

/**
 * Rects of the Range's text nodes. Range.getClientRects() on a fully selected paragraph
 * also returns the block's box, which would double the highlight.
 */
function rangeRects(range: Range): DOMRect[] {
  const out: DOMRect[] = [];
  const root = range.commonAncestorContainer;
  const nodes: Node[] = [];
  if (root.nodeType === Node.TEXT_NODE) nodes.push(root);
  else {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(), started = false; n; n = w.nextNode()) {
      if (range.intersectsNode(n)) {
        nodes.push(n);
        started = true;
      } else if (started) break;
    }
  }
  const r = document.createRange();
  for (const t of nodes) {
    r.selectNodeContents(t);
    if (t === range.startContainer) r.setStart(t, range.startOffset);
    if (t === range.endContainer) r.setEnd(t, range.endOffset);
    for (const x of r.getClientRects()) if (x.width && x.height) out.push(x);
  }
  return out;
}

const anchorRects = (a: Anchor) => (a.range ? rangeRects(a.range) : [a.el!.getBoundingClientRect()].filter((r) => r.width && r.height));

let flashOff: (() => void) | null = null;

/** Blue highlight for 1.4 s. Follows the text until it fades; a new call removes the previous one. */
function flash(layer: HTMLElement, a: Anchor) {
  flashOff?.();
  const els = anchorRects(a).map(() => {
    const f = document.createElement('div');
    f.className = 'rb-flash';
    layer.append(f);
    return f;
  });
  if (!els.length) return;
  const host = (layer.getRootNode() as ShadowRoot).host;
  const sync = () => {
    const rs = anchorRects(a);
    const heads = headerRects(host);
    els.forEach((f, i) => {
      const r = rs[i];
      // the text went under the site's header, so does the highlight
      f.style.cssText = r ? `left:${r.left - 2}px;top:${r.top - 1}px;width:${r.width + 4}px;height:${r.height + 2}px;clip-path:${clipUnder(heads, r.left - 2, r.top - 1, r.width + 4) || 'none'}` : 'display:none';
    });
  };
  let raf = 0;
  const onMove = () => {
    raf ||= requestAnimationFrame(() => {
      raf = 0;
      sync();
    });
  };
  sync();
  // scroll isn't composed: listen to containers inside the page's shadow DOM directly
  const shadowClips = a.clips.filter((c) => c.getRootNode() !== document);
  addEventListener('scroll', onMove, { capture: true, passive: true });
  addEventListener('resize', onMove);
  shadowClips.forEach((c) => c.addEventListener('scroll', onMove, { passive: true }));
  const off = () => {
    removeEventListener('scroll', onMove, true);
    removeEventListener('resize', onMove);
    shadowClips.forEach((c) => c.removeEventListener('scroll', onMove));
    cancelAnimationFrame(raf);
    els.forEach((f) => f.remove());
    if (flashOff === off) flashOff = null;
  };
  flashOff = off;
  els[0]!.addEventListener('animationend', off);
}

const up = (n: Node): Node | null => n.parentNode ?? ((n as ShadowRoot).host || null);

/** The element at the point is part of the fragment or its ancestor (not a sticky site header on top). */
function belongs(hit: Element, a: Anchor) {
  if (a.el) return a.el === hit || a.el.contains(hit);
  try {
    if (a.range!.intersectsNode(hit)) return true;
  } catch {}
  for (let n: Node | null = a.range!.commonAncestorContainer; n; n = up(n)) if (n === hit) return true;
  return false;
}

/** Scrolling ancestors, across shadow DOM boundaries. */
function scrollers(a: Anchor): Element[] {
  const out: Element[] = [];
  for (let n: Node | null = a.range ? a.range.commonAncestorContainer : a.el!.parentNode; n; n = up(n)) {
    if (!(n instanceof Element) || n === document.body || n === document.documentElement) continue;
    const s = getComputedStyle(n);
    if (/auto|scroll|hidden|clip/.test(s.overflowX + s.overflowY)) out.push(n);
  }
  return out;
}

/** Visible only when fully in the viewport, not clipped by a scrolling ancestor and not covered by another element. */
function visible(a: Anchor, host: Element) {
  const r = anchorRect(a);
  const vp = viewport();
  if (r.top < 0 || r.left < 0 || r.bottom > vp.h || r.right > vp.w) return false;
  for (const c of scrollers(a)) {
    const b = c.getBoundingClientRect();
    const left = b.left + c.clientLeft;
    const top = b.top + c.clientTop;
    if (r.left < left - 1 || r.top < top - 1 || r.right > left + c.clientWidth + 1 || r.bottom > top + c.clientHeight + 1) return false;
  }
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  // our pinned windows over the text don't count: they will move away
  return !!hit && (hit === host || belongs(hit, a));
}

/** Bottom of the site's sticky header or scroll-padding-top: the fragment must not end up behind it. */
function topInset() {
  const vp = viewport();
  let inset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  for (const x of [vp.w / 4, vp.w / 2, (vp.w * 3) / 4]) {
    for (let el = document.elementFromPoint(x, 2); el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      const bottom = el.getBoundingClientRect().bottom;
      if (bottom < vp.h / 2) inset = Math.max(inset, bottom);
      break;
    }
  }
  return inset;
}

let tok = 0;
let locating: Bubble | null = null;
let stopListening: (() => void) | null = null;

/**
 * Goes to the text of pinned window `b`. Another click on the same window during the trip is ignored,
 * a click on another window cancels it. Wheel, keys, touch and presses outside our UI cancel it too.
 */
export function locate(b: Bubble, layer: HTMLElement, host: Element, pinned: Iterable<Bubble>) {
  const a = b.anchor;
  if (anchorDead(a)) return b.note('Текст на странице уже не найден — страница изменилась.');
  if (!anchorRects(a).length) return b.note('Текст на странице сейчас скрыт.');
  if (locating === b) return;
  stopListening?.();
  const my = ++tok;
  locating = b;

  const done = () => {
    if (my !== tok) return;
    locating = null;
    const r = anchorRect(a);
    for (const p of pinned) p.nudge(r);
    flash(layer, a);
  };
  if (visible(a, host)) return done();

  // 1) an instant scrollIntoView scrolls every nested container on both axes (smooth doesn't work on nested ones in Chromium)
  const x0 = scrollX;
  const y0 = scrollY;
  const start = a.range ? a.range.startContainer : a.el!;
  (start instanceof Element ? start : start.parentElement)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  // scrollIntoView centers the whole element, so center the fragment itself in nested containers, innermost first
  for (const c of scrollers(a)) {
    const s = getComputedStyle(c);
    if (!/auto|scroll/.test(s.overflowX + s.overflowY)) continue;
    const r = anchorRect(a);
    const b = c.getBoundingClientRect();
    const top = b.top + c.clientTop;
    const left = b.left + c.clientLeft;
    const dy = r.height > c.clientHeight ? r.top - top - 8 : r.top + r.height / 2 - (top + c.clientHeight / 2);
    c.scrollBy({ top: dy, left: r.left + r.width / 2 - (left + c.clientWidth / 2), behavior: 'instant' });
  }
  // 2) center the fragment in the area under the header; if taller than 80% of it, align its start to the top
  const r0 = anchorRect(a);
  const vp = viewport();
  const inset = topInset();
  const avail = vp.h - inset;
  const dy = r0.height > avail * 0.8 ? r0.top - Math.max(80, inset + 16) : r0.top + r0.height / 2 - (inset + avail / 2);
  scrollBy({ top: dy, left: r0.left + r0.width / 2 - vp.w / 2, behavior: 'instant' });
  const x1 = scrollX;
  const y1 = scrollY;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || (x1 === x0 && y1 === y0)) return done();

  // 3) restore the scroll position and glide to the target: all in one frame, so the jump is never seen
  scrollTo({ left: x0, top: y0, behavior: 'instant' });
  scrollTo({ left: x1, top: y1, behavior: 'smooth' });

  const EV = ['wheel', 'keydown', 'touchstart', 'pointerdown'] as const;
  const off = () => {
    EV.forEach((t) => removeEventListener(t, interrupt, true));
    if (stopListening === off) stopListening = null;
  };
  const interrupt = (e: Event) => {
    if (e.composedPath().includes(host)) return;
    if (my === tok) {
      tok++;
      locating = null;
      // the browser's smooth scroll doesn't stop on its own: freeze where we were interrupted
      scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
    }
    off();
  };
  EV.forEach((t) => addEventListener(t, interrupt, { capture: true, passive: true }));
  stopListening = off;

  // arrived: position unchanged for 3 frames and equal to the target; scrollend fires too early and from nested containers
  let last = '';
  let still = 0;
  const t0 = performance.now();
  const tick = () => {
    if (my !== tok) return off();
    const now = `${scrollX},${scrollY}`;
    still = now === last ? still + 1 : 0;
    last = now;
    const arrived = Math.abs(scrollX - x1) <= 1 && Math.abs(scrollY - y1) <= 1;
    if ((still >= 3 && arrived) || still >= 12 || performance.now() - t0 > 2500) {
      if (!arrived) scrollTo({ left: x1, top: y1, behavior: 'instant' }); // Chromium dropped the smooth scroll, finish it ourselves
      off();
      return done();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
