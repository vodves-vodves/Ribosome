export const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);

/** Видимая область без полос прокрутки (в quirks-режиме clientHeight у html — высота документа). */
export function viewport() {
  const de = document.documentElement;
  return { w: Math.min(innerWidth, de.clientWidth || innerWidth), h: Math.min(innerHeight, de.clientHeight || innerHeight) };
}

/** К чему привязано окно: выделение (Range) или поле ввода (там Range схлопнут). */
export type Anchor = { range: Range | null; el: Element | null; clips: Element[] };

export function rangeAnchor(range: Range): Anchor {
  return { range, el: null, clips: clipAncestors(range.commonAncestorContainer) };
}

export function fieldAnchor(el: Element): Anchor {
  return { range: null, el, clips: el.parentElement ? clipAncestors(el.parentElement) : [] };
}

export const anchorRect = (a: Anchor) => (a.range ?? a.el!).getBoundingClientRect();

/** SPA перерисовал DOM: узлы ушли, живой Range схлопнулся в точку удаления. */
export const anchorDead = (a: Anchor) => (a.range ? a.range.collapsed || !a.range.startContainer.isConnected : !a.el!.isConnected);

/** Предки со своей прокруткой или обрезкой, через границы shadow DOM. */
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
 * Якорь виден, если не ушёл за экран по горизонтали и не обрезан прокручиваемым предком.
 * По вертикали за экран — виден: окно честно уезжает вместе с текстом.
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
export type Pos = { left: number; top: number; side: Side };

/**
 * Окно по центру якоря, под ним или над ним. Сторона выбирается один раз по высоте `pickH`
 * (максимальная высота окна, а не скелета) и дальше не меняется, чтобы окно не прыгало.
 */
export function placeBox(w: number, h: number, rect: DOMRect, gap: number, side?: Side, pickH = 0): Pos {
  const vp = viewport();
  const hs = Math.max(h, pickH);
  side ??= rect.bottom + gap + hs > vp.h - 8 && rect.top - gap - hs > 8 ? 'above' : 'below';
  return {
    left: clamp(rect.left + rect.width / 2 - w / 2, 8, vp.w - w - 8),
    top: side === 'below' ? rect.bottom + gap : rect.top - gap - h,
    side,
  };
}

export function setPos(el: HTMLElement, p: { left: number; top: number }) {
  el.style.left = `${p.left}px`;
  el.style.top = `${p.top}px`;
}
