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
export type Pos = { left: number; top: number; side: Side; clip: string };

/**
 * Окно по центру якоря, под ним или над ним. Сторона выбирается один раз по высоте `pickH`
 * (максимальная высота окна, а не скелета) и дальше не меняется, чтобы окно не прыгало.
 */
export function placeBox(w: number, h: number, rect: DOMRect, gap: number, side?: Side, pickH = 0, heads: DOMRect[] = []): Pos {
  const vp = viewport();
  // шапка сайта — верхний край видимой области
  const edge = Math.max(0, ...heads.map((r) => r.bottom));
  const below = vp.h - 8 - rect.bottom - gap;
  const above = rect.top - gap - edge - 8;
  // не помещается ни снизу, ни сверху — туда, где места больше
  side ??= below >= Math.max(h, pickH) || below >= above ? 'below' : 'above';
  let top = side === 'below' ? rect.bottom + gap : rect.top - gap - h;
  // пока текст целиком на экране, окно тоже целиком на экране — пусть даже поверх текста
  if (rect.top >= edge && rect.bottom <= vp.h) top = clamp(top, edge + 8, vp.h - h - 8);
  const left = clamp(rect.left + rect.width / 2 - w / 2, 8, vp.w - w - 8);
  return { left, top, side, clip: clipUnder(heads, left, top, w) };
}

/**
 * Фиксированные и липкие элементы сайта у верхнего края экрана — шапки. Наш слой в top layer рисуется
 * поверх них, поэтому окно, привязанное к тексту, обрезаем по их нижнему краю: текст уходит под шапку, и окно тоже.
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

/** clip-path для бокса, который заходит под шапку. Тень по бокам и снизу не режем. */
export function clipUnder(heads: DOMRect[], left: number, top: number, w: number) {
  let cut = 0;
  for (const r of heads) if (r.right > left && r.left < left + w) cut = Math.max(cut, r.bottom - top);
  return cut > 0 ? `inset(${cut}px -40px -40px -40px)` : '';
}

/** В видимую область с отступом 8 px: у закреплённого окна крестик должен оставаться доступным. */
export function clampPos(el: HTMLElement, left: number, top: number) {
  const vp = viewport();
  return { left: clamp(left, 8, vp.w - el.offsetWidth - 8), top: clamp(top, 8, vp.h - el.offsetHeight - 8) };
}

export function setPos(el: HTMLElement, p: { left: number; top: number }) {
  el.style.left = `${p.left}px`;
  el.style.top = `${p.top}px`;
}
