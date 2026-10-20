// Whole-page translation in place: text nodes get the translation, the page's elements and listeners stay.
// Blocks are translated as they come near the screen, new content (feeds, SPA routes) as it appears.
import { requestBatch } from '@/shared/client';
import { decode, encode } from '@/shared/segments';

export type PageError = { kind: 'rate_limited'; wait: number } | { kind: 'offline' } | { kind: 'server'; status?: number } | { kind: 'ctx' };

export type PageView = {
  /** The translation is shown (or on its way). */
  on: boolean;
  /** Page language, empty until the first answer. */
  from: string;
  to: string;
  /** Share of the current wave done while blocks are in flight, null when idle. */
  progress: number | null;
  error: PageError | null;
};

type Langs = { source: string; target: string; secondary: string };

/** Subtrees that are never translated: code, form controls, media, explicit opt-outs and our own UI. */
const SKIP =
  'script,style,noscript,template,textarea,input,select,code,pre,kbd,samp,var,svg,math,iframe,canvas,video,audio,object,ribosome-ui,[translate=no],.notranslate';

/** Elements that are part of a sentence: their text goes into the block around them. */
const INLINE = new Set('a abbr b bdi bdo cite data del dfn em font i ins label mark q s small span strong sub sup time u'.split(' '));

/** Per request: Google takes far more, but a smaller batch shows up sooner. */
const BATCH_CHARS = 6000;
const BATCH_SEGMENTS = 100;

type Group = { block: Element; nodes: Text[] };
type Sent = Group & { src: string[] };

const letters = (s: string) => /\p{L}/u.test(s);

function blockOf(t: Text): Element | null {
  let e = t.parentElement;
  while (e && INLINE.has(e.localName) && e.parentElement) e = e.parentElement;
  return e;
}

/** A whitespace node counts only between inline neighbours, where it's a word boundary. */
function wanted(t: Text): boolean {
  if (t.nodeValue!.trim()) return true;
  const inline = (n: Node | null) => !!n && (n.nodeType === Node.TEXT_NODE || INLINE.has((n as Element).localName));
  return inline(t.previousSibling) && inline(t.nextSibling);
}

const skipped = (el: Element) => el.matches(SKIP) || (el as HTMLElement).isContentEditable;

/**
 * A block's nodes cut into segments Google translates separately: lines split by `<br>` and spans laid out as
 * boxes (menu items in a flex row) aren't one sentence, and mixed together their words would swap places.
 */
function split(g: Group, nodes: Text[]): Sent[] {
  const boxes = new Map<Element, boolean>();
  const boxOf = (t: Text) => {
    for (let e = t.parentElement; e && e !== g.block; e = e.parentElement) {
      let b = boxes.get(e);
      if (b === undefined) boxes.set(e, (b = !getComputedStyle(e).display.startsWith('inline')));
      if (b) return e;
    }
    return g.block;
  };
  const afterBr = (t: Node) => {
    let n: Node | null = t;
    while (n && n !== g.block && !n.previousSibling) n = n.parentNode;
    return n !== g.block && n?.previousSibling?.nodeName === 'BR';
  };
  const out: Sent[] = [];
  let box: Element | null = null;
  for (const t of nodes) {
    const b = boxOf(t);
    if (!out.length || b !== box || afterBr(t)) out.push({ block: g.block, nodes: [], src: [] });
    out.at(-1)!.nodes.push(t);
    out.at(-1)!.src.push(t.nodeValue!);
    box = b;
  }
  return out;
}

export class PageTranslation {
  view: PageView = { on: false, from: '', to: '', progress: null, error: null };
  /** Translations survive "Show original", so translating again costs no requests. */
  private done = new Map<Text, { src: string; out: string }>();
  /** Blocks found but not yet near the screen. */
  private waiting = new Map<Element, Text[]>();
  private queue: Group[] = [];
  private busy = false;
  private cancel = () => {};
  /** Bumped on every translate/restore: answers from an older session are dropped. */
  private gen = 0;
  private wave = { total: 0, done: 0 };
  private tick: ReturnType<typeof setInterval> | undefined;
  private langs!: Langs;
  private io = new IntersectionObserver((es) => this.onSeen(es), { rootMargin: '50% 0px' });
  private mo = new MutationObserver((rs) => this.onMutations(rs));

  constructor(private onChange: () => void) {}

  translate(langs: Langs) {
    if (this.view.on) return;
    if (this.langs && (this.langs.target !== langs.target || this.langs.source !== langs.source)) {
      this.done.clear();
      this.view = { ...this.view, from: '' };
    }
    this.langs = langs;
    this.gen++;
    // a known page language keeps the target chosen earlier, so cached translations still fit
    if (!this.view.from) this.view = { ...this.view, from: langs.source === 'auto' ? '' : langs.source, to: langs.target };
    this.view = { ...this.view, on: true, error: null };
    this.write(() => {
      for (const [t, d] of this.done) if (t.isConnected && t.nodeValue === d.src) t.nodeValue = d.out;
    });
    // an SVG or XML document has no body
    if (document.body) this.observe(document.body);
    const title = document.querySelector('head > title');
    if (title) this.observe(title);
    this.emit();
  }

  restore() {
    if (!this.view.on) return;
    this.gen++;
    this.cancel();
    this.busy = false;
    this.io.disconnect();
    this.mo.disconnect();
    clearInterval(this.tick);
    this.waiting.clear();
    this.queue = [];
    this.wave = { total: 0, done: 0 };
    this.write(() => {
      for (const [t, d] of this.done) {
        if (!t.isConnected) this.done.delete(t);
        else if (t.nodeValue === d.out) t.nodeValue = d.src;
      }
    });
    this.view = { ...this.view, on: false, progress: null, error: null };
    this.emit();
  }

  retry() {
    if (!this.view.on || !this.view.error || this.view.error.kind === 'ctx') return;
    clearInterval(this.tick);
    this.view = { ...this.view, error: null };
    this.pump();
  }

  /** Our own writes must not come back as page changes. */
  private write(fn: () => void) {
    fn();
    this.mo.takeRecords();
  }

  private emit() {
    const { total, done } = this.wave;
    this.view = { ...this.view, progress: this.busy || this.queue.length ? (total ? done / total : 0) : null };
    this.onChange();
  }

  private observe(root: Node) {
    this.mo.observe(root, { childList: true, subtree: true, characterData: true });
    this.collect(root);
  }

  private collect(root: Node) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (n.nodeType === Node.TEXT_NODE) return wanted(n as Text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        const el = n as Element;
        if (skipped(el)) return NodeFilter.FILTER_REJECT;
        // open shadow roots of web components: the walker doesn't enter them by itself
        if (el.shadowRoot) this.observe(el.shadowRoot);
        return NodeFilter.FILTER_SKIP;
      },
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) this.add(n as Text);
  }

  private add(t: Text) {
    if (this.done.has(t)) return;
    const block = blockOf(t);
    if (!block) return;
    const nodes = this.waiting.get(block);
    if (nodes) return void (nodes.includes(t) || nodes.push(t));
    this.waiting.set(block, [t]);
    // <title> has no box to intersect
    if (block.localName === 'title') this.onSeen([{ target: block, isIntersecting: true } as IntersectionObserverEntry]);
    else this.io.observe(block);
  }

  private onSeen(entries: IntersectionObserverEntry[]) {
    let added = false;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      this.io.unobserve(e.target);
      const nodes = this.waiting.get(e.target);
      this.waiting.delete(e.target);
      if (!nodes?.some((t) => letters(t.nodeValue!))) continue;
      this.queue.push({ block: e.target, nodes });
      this.wave.total++;
      added = true;
    }
    if (added) this.pump();
  }

  private onMutations(records: MutationRecord[]) {
    for (const r of records) {
      if (r.type === 'characterData') {
        const t = r.target as Text;
        const d = this.done.get(t);
        // the site rewrote a translated node (React, a counter): it's new text now
        if (d && t.nodeValue !== d.out) {
          this.done.delete(t);
          if (t.parentElement && !t.parentElement.closest(SKIP)) this.add(t);
        }
        continue;
      }
      const parent = r.target instanceof Element ? r.target : (r.target as ShadowRoot).host;
      if (parent?.closest(SKIP) || (parent as HTMLElement | undefined)?.isContentEditable) continue;
      for (const n of r.addedNodes) {
        if (n.nodeType === Node.TEXT_NODE && wanted(n as Text)) this.add(n as Text);
        else if (n.nodeType === Node.ELEMENT_NODE && !skipped(n as Element)) this.collect(n);
      }
    }
  }

  /** Next batch: whole blocks up to the size limits; one oversized block goes alone. */
  private take(): Sent[] {
    const out: Sent[] = [];
    let size = 0;
    while (this.queue.length && out.length < BATCH_SEGMENTS) {
      const g = this.queue[0]!;
      const segs = split(g, g.nodes.filter((t) => t.isConnected && !this.done.has(t)));
      const len = segs.reduce((a, s) => a + s.src.join('').length, 0);
      if (out.length && size + len > BATCH_CHARS) break;
      this.queue.shift();
      // the wave counted the block as one
      this.wave.total += segs.length - 1;
      for (const s of segs) {
        if (s.src.some(letters)) out.push(s);
        else this.wave.done++;
      }
      size += len;
    }
    return out;
  }

  private async pump(): Promise<void> {
    if (this.busy || !this.view.on || this.view.error) return;
    const batch = this.take();
    if (!batch.length) {
      this.wave = { total: 0, done: 0 };
      // feeds and SPAs drop nodes all the time
      for (const t of this.done.keys()) if (!t.isConnected) this.done.delete(t);
      return this.emit();
    }
    const gen = this.gen;
    const { to } = this.view;
    this.busy = true;
    this.emit();
    // always `auto` unless the user fixed the source: a page can mix languages
    const r = requestBatch(
      batch.map((g) => encode(g.src)),
      this.langs.source,
      to,
    );
    this.cancel = r.cancel;
    const res = await r.result;
    if (gen !== this.gen) return;
    this.busy = false;
    if (!res.ok) {
      this.queue.unshift(...batch);
      return this.fail(res.error === 'rate_limited' ? { kind: 'rate_limited', wait: res.retryAfter ?? 2 } : res.error === 'server' ? { kind: 'server', status: res.status } : res.error === 'ctx' ? { kind: 'ctx' } : { kind: 'offline' });
    }
    const lang = this.view.from || pageLang(batch, res.detected);
    if (lang && !this.view.from) {
      this.view = { ...this.view, from: lang };
      // the page is already in the target language: same rule as for a selection
      if (lang === to && this.langs.secondary !== to) {
        this.view = { ...this.view, to: this.langs.secondary };
        this.queue.unshift(...batch);
        return this.pump();
      }
    }
    this.write(() => batch.forEach((g, i) => this.apply(g, res.texts[i] ?? '')));
    this.wave.done += batch.length;
    this.pump();
  }

  private apply(g: Sent, html: string) {
    const out = decode(html, g.src);
    g.nodes.forEach((t, j) => {
      if (!t.isConnected) return;
      // changed while in flight: translate the new text later
      if (t.nodeValue !== g.src[j]) return this.add(t);
      t.nodeValue = out[j]!;
      this.done.set(t, { src: g.src[j]!, out: out[j]! });
    });
  }

  private fail(error: PageError) {
    this.view = { ...this.view, error };
    this.emit();
    if (error.kind !== 'rate_limited') return;
    const gen = this.gen;
    clearInterval(this.tick);
    this.tick = setInterval(() => {
      if (gen !== this.gen || this.view.error?.kind !== 'rate_limited') return clearInterval(this.tick);
      const wait = this.view.error.wait - 1;
      if (wait > 0) {
        this.view = { ...this.view, error: { kind: 'rate_limited', wait } };
        return this.emit();
      }
      this.retry();
    }, 1000);
  }
}

/** The language most of the batch is written in, by length. The tab title alone is too short to tell. */
function pageLang(batch: Sent[], detected: string[]): string {
  const score = new Map<string, number>();
  batch.forEach((g, i) => {
    const lang = detected[i];
    if (lang && g.block.localName !== 'title') score.set(lang, (score.get(lang) ?? 0) + g.src.join('').length);
  });
  return [...score].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}
