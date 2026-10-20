export const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);

/** Visible area without scrollbars (in quirks mode the root's clientHeight is the document height). */
export function viewport() {
  const de = document.documentElement;
  return { w: Math.min(innerWidth, de.clientWidth || innerWidth), h: Math.min(innerHeight, de.clientHeight || innerHeight) };
}

/** What a window is tied to: a selection (Range) or an input field (whose Range is collapsed). */
export type Anchor = { range: Range | null; el: Element | null; clips: Element[] };

export function rangeAnchor(range: Range): Anchor {
  return { range, el: null, clips: clipAncestors(range.commonAncestorContainer) };
}

export function fieldAnchor(el: Element): Anchor {
  return { range: null, el, clips: el.parentElement ? clipAncestors(el.parentElement) : [] };
}

export const anchorRect = (a: Anchor) => (a.range ?? a.el!).getBoundingClientRect();

/** An SPA re-rendered the DOM: the nodes are gone and the live Range collapsed to the removal point. */
export const anchorDead = (a: Anchor) => (a.range ? a.range.collapsed || !a.range.startContainer.isConnected : !a.el!.isConnected);

/** Ancestors that scroll or clip, across shadow DOM boundaries. */
function clipAncestors(node: Node): Element[] {
  const out: Element[] = [];
  const up = (n: Node): Element | null => n.parentElement ?? ((n.getRootNode() as ShadowRoot).host || null);
  let el: Element | null = node instanceof Element ? node : up(node);
  while (el && el !== document.body && el !== document.documentElement) {
    const s = getComputedStyle(el);
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible') out.push(el);
    el = up(el);
  }
  return out;
}

/**
 * The anchor is visible unless it left the screen horizontally or is clipped by a scrolling ancestor.
 * Off-screen vertically still counts as visible: the window scrolls away together with the text.
 */
export function anchorShown(r: DOMRect, clips: Element[]) {
  if (r.right <= 0 || r.left >= viewport().w) return false;
  for (const c of clips) {
    const b = c.getBoundingClientRect();
    const left = b.left + c.clientLeft;
    const top = b.top + c.clientTop;
    if (r.right <= left || r.left >= left + c.clientWidth || r.bottom <= top || r.top >= top + c.clientHeight) return false;
  }
  return true;
}

export type Side = 'below' | 'above';
export type Pos = { left: number; top: number; side: Side; clip: string };

/**
 * Box centered on the anchor, below or above it. The side is picked once by `pickH`
 * (the window's max height, not the skeleton's) and then kept, so the window doesn't jump.
 */
export function placeBox(w: number, h: number, rect: DOMRect, gap: number, side?: Side, pickH = 0, heads: DOMRect[] = []): Pos {
  const vp = viewport();
  // the site's header is the top edge of the visible area
  const edge = Math.max(0, ...heads.map((r) => r.bottom));
  const below = vp.h - 8 - rect.bottom - gap;
  const above = rect.top - gap - edge - 8;
  // fits neither below nor above: go where there's more room
  side ??= below >= Math.max(h, pickH) || below >= above ? 'below' : 'above';
  let top = side === 'below' ? rect.bottom + gap : rect.top - gap - h;
  // while the text is fully on screen, so is the window, even if it covers the text
  if (rect.top >= edge && rect.bottom <= vp.h) top = clamp(top, edge + 8, vp.h - h - 8);
  const left = clamp(rect.left + rect.width / 2 - w / 2, 8, vp.w - w - 8);
  return { left, top, side, clip: clipUnder(heads, left, top, w) };
}

/**
 * Fixed and sticky site elements at the top of the screen are headers. Our top-layer UI paints over them,
 * so a window tied to text is clipped at their bottom edge: the text slides under the header, and so does the window.
 */
export function headerRects(host: Element): DOMRect[] {
  const vp = viewport();
  const out: DOMRect[] = [];
  const seen = new Set<Element>();
  for (const x of [vp.w * 0.1, vp.w / 2, vp.w * 0.9]) {
    const hit = document.elementsFromPoint(x, 1).find((e) => e !== host);
    for (let el = hit; el && el !== document.body && el !== document.documentElement && !seen.has(el); el = el.parentElement ?? undefined) {
      seen.add(el);
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.top <= 1 && r.bottom > 0 && r.bottom < vp.h / 2) out.push(r);
      break;
    }
  }
  return out;
}

/** clip-path for a box that goes under the header. The shadow on the sides and bottom is kept. */
export function clipUnder(heads: DOMRect[], left: number, top: number, w: number) {
  let cut = 0;
  for (const r of heads) if (r.right > left && r.left < left + w) cut = Math.max(cut, r.bottom - top);
  return cut > 0 ? `inset(${cut}px -40px -40px -40px)` : '';
}

/** Into the viewport with an 8px margin: a pinned window's close button must stay reachable. */
export function clampPos(el: HTMLElement, left: number, top: number) {
  const vp = viewport();
  return { left: clamp(left, 8, vp.w - el.offsetWidth - 8), top: clamp(top, 8, vp.h - el.offsetHeight - 8) };
}

export function setPos(el: HTMLElement, p: { left: number; top: number }) {
  el.style.left = `${p.left}px`;
  el.style.top = `${p.top}px`;
}
