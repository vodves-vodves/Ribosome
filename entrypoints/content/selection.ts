import { fieldAnchor, rangeAnchor, type Anchor } from './geometry';

/** A selection that can be translated. `focus` is where the mouse was released: the icon goes there. */
export type Capture = { text: string; anchor: Anchor; focus: Range | null; back: boolean };

/** A press on a native scrollbar is not a click on empty space. */
export function onScrollbar(e: MouseEvent) {
  // the real target: on window an event from the page's shadow DOM is already retargeted to the host
  const t = e.composedPath()[0];
  const de = document.documentElement;
  if (t === de || t === document.body) {
    const rtlBar = getComputedStyle(de).direction === 'rtl' && e.clientX < innerWidth - de.clientWidth;
    return e.clientX >= de.clientWidth || e.clientY >= de.clientHeight || rtlBar;
  }
  if (!(t instanceof Element) || !t.clientWidth) return false;
  // offsetX is relative to the retargeted target too, so measure from the element itself
  const r = t.getBoundingClientRect();
  const x = e.clientX - r.left - t.clientLeft;
  const y = e.clientY - r.top - t.clientTop;
  // an RTL element has its scrollbar left of the padding box: x is negative
  return x >= t.clientWidth || y >= t.clientHeight || x < 0;
}

export function sameRange(a: Range, b: Range | null | undefined) {
  try {
    return !!b && !b.collapsed && a.compareBoundaryPoints(Range.START_TO_START, b) === 0 && a.compareBoundaryPoints(Range.END_TO_END, b) === 0;
  } catch {
    return false; // Ranges from different trees (the page's shadow DOM) can't be the same selection
  }
}

/** Open shadow roots the event passed through: without them getComposedRanges returns a Range on the host. */
export const eventRoots = (e: Event) => e.composedPath().filter((n): n is ShadowRoot => n instanceof ShadowRoot);

export function focusRoots() {
  const out: ShadowRoot[] = [];
  let a = document.activeElement;
  while (a?.shadowRoot) {
    out.push(a.shadowRoot);
    a = a.shadowRoot.activeElement;
  }
  return out;
}

type ComposedSelection = Selection & { getComposedRanges?(o: { shadowRoots: ShadowRoot[] }): StaticRange[] };

function selectionRange(sel: ComposedSelection, roots: ShadowRoot[]): Range | null {
  if (!sel.rangeCount) return null;
  if (roots.length && sel.getComposedRanges) {
    try {
      const sr = sel.getComposedRanges({ shadowRoots: roots })[0];
      if (sr && !sr.collapsed) {
        const r = document.createRange();
        r.setStart(sr.startContainer, sr.startOffset);
        r.setEnd(sr.endContainer, sr.endOffset);
        if (!r.collapsed) return r;
      }
    } catch {}
  }
  return sel.getRangeAt(0).cloneRange();
}

type Field = HTMLInputElement | HTMLTextAreaElement;

/** The focused input field, looking inside shadow DOM. */
function activeField(): Field | null {
  let a = document.activeElement;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  return a instanceof HTMLTextAreaElement || a instanceof HTMLInputElement ? a : null;
}

const editable = (r: Range) => {
  const n = r.commonAncestorContainer;
  return !!(n instanceof HTMLElement ? n : n.parentElement)?.isContentEditable;
};

/** The page's current selection or null. Fields and contenteditable only when the setting is on. */
export function capture(roots: ShadowRoot[], inFields: boolean): Capture | null {
  const field = activeField();
  if (field) {
    // a field's Range is collapsed, the text comes from selectionStart/End. Passwords, email and other fields without the selection API are skipped
    const plain = field instanceof HTMLTextAreaElement || /^(text|search|url|tel)$/.test(field.type);
    if (!inFields || !plain || field.selectionStart === field.selectionEnd) return null;
    const text = field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0).trim();
    return text ? { text, anchor: fieldAnchor(field), focus: null, back: false } : null;
  }
  const sel = getSelection();
  const range = sel && selectionRange(sel, roots);
  if (!sel || !range || (!inFields && editable(range))) return null;
  const text = (sel.toString() || range.toString()).trim();
  if (!text) return null;

  // the mouse release point is the selection focus: for a bottom-up selection that's the Range start
  const a = sel.anchorNode;
  const f = sel.focusNode;
  const back = !!a && !!f && (a === f ? sel.focusOffset < sel.anchorOffset : !!(a.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_PRECEDING));
  const focus = range.cloneRange();
  focus.collapse(back);
  // a triple click puts focus at the start of the next paragraph; then the icon goes to the edge of the selection itself
  const fr = focus.getClientRects()[0];
  const mid = fr && fr.top + fr.height / 2;
  const inside = fr && [...range.getClientRects()].some((x) => mid! >= x.top - 1 && mid! <= x.bottom + 1);
  return { text, anchor: rangeAnchor(range), focus: inside ? focus : null, back };
}

/** Where the icon goes: the release point, the selection's edge or the field. */
export function focusRect(c: Capture): DOMRect | null {
  if (c.anchor.el) return c.anchor.el.getBoundingClientRect();
  const f = c.focus?.getClientRects()[0];
  if (f) return f;
  const rs = [...c.anchor.range!.getClientRects()].filter((x) => x.width || x.height);
  return (c.back ? rs[0] : rs.at(-1)) ?? null;
}
