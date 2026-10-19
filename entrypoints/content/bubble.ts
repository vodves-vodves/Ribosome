import type { Req } from '@/shared/messages';
import { COPY_LABEL, ICON } from '@/shared/ui/icons';
import { copyText, createRunner, flashCopy, overlayScrollbar, render, type State, type View } from '@/shared/ui/view';
import { anchorRect, anchorShown, placeBox, setPos, type Anchor, type Pos, type Side } from './geometry';

/** Высота окна с длинным переводом: по ней выбираем сторону при открытии, а не по высоте скелета. */
const MAX_H = 330;
const GAP = 10;

const TPL = `
<div class="rb-bh">
  <span class="rb-lang"></span>
  <span class="rb-hb">
    <button class="rb-ib rb-loc" aria-label="Показать на странице" title="Показать на странице">${ICON.locate}</button>
    <button class="rb-ib rb-pin" aria-label="Закрепить" title="Закрепить">${ICON.pin}</button>
    <button class="rb-ib rb-x" aria-label="Закрыть" title="Закрыть">${ICON.close}</button>
  </span>
</div>
<button class="rb-src" hidden title="Показать на странице" dir="auto"></button>
<div class="rb-bt" dir="auto"></div>
<div class="rb-note" hidden></div>
<div class="rb-bf">
  <span class="rb-prov">Google Translate</span>
  <span class="rb-acts">
    <button class="rb-btn rb-retry" hidden>Повторить</button>
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
    private onClose: (b: Bubble) => void,
  ) {
    const el = this.el;
    el.className = 'rb-bubble rb-surface';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Перевод');
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
  }

  q<T extends HTMLElement = HTMLElement>(s: string) {
    return this.el.querySelector<T>(s)!;
  }

  /** Перевести и показать. Новое выделение в том же окне: сторона выбирается заново. */
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
    if (this.el.classList.contains('is-on')) return this.follow();
    this.el.classList.add('is-on');
    this.follow();
    void this.el.offsetWidth;
    this.el.classList.add('is-in');
  }

  /** Чтение для кадра: куда встать. null — якорь не виден, окно прячем, а не прижимаем к краю. */
  measure(): Pos | null {
    if (!this.el.classList.contains('is-on')) return null;
    const r = anchorRect(this.anchor);
    if (!anchorShown(r, this.anchor.clips)) return null;
    return placeBox(this.el.offsetWidth, this.el.offsetHeight, r, GAP, this.side, MAX_H);
  }

  /** Запись для кадра. */
  apply(p: Pos | null) {
    this.el.style.visibility = p ? '' : 'hidden';
    if (!p) return;
    this.side = p.side;
    setPos(this.el, p);
    this.el.style.transformOrigin = p.side === 'below' ? 'top center' : 'bottom center';
  }

  follow() {
    this.apply(this.measure());
  }

  close() {
    this.runner.stop();
    this.el.classList.remove('is-in');
    setTimeout(() => this.el.remove(), 170);
    this.onClose(this);
  }
}
