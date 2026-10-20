// A block of the page goes to Google as one segment: each text node becomes `<a i=N>…</a>`.
// Google keeps the tags around the matching words, so the translation goes back into the same nodes and links stay links.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function unesc(s: string) {
  return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== '#') return ENT[e.toLowerCase()] ?? m;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
}

const blank = (s: string) => !s.trim();

/** Whitespace-only nodes aren't sent, they only mark a word boundary. */
export function encode(texts: string[]): string {
  let out = '';
  let gap = false;
  texts.forEach((t, i) => {
    if (blank(t)) return void (gap = true);
    if (out && (gap || /^\s/.test(t))) out += ' ';
    out += `<a i=${i}>${esc(t.trim())}</a>`;
    gap = /\s$/.test(t);
  });
  return out;
}

const TAG = /<a i="?(\d+)"?>([\s\S]*?)<\/a>/g;

/** Positions of the longest run of tags that kept their order (ties go to the earliest). */
function inOrder(ids: number[]): Set<number> {
  const len = ids.map(() => 1);
  const prev = ids.map(() => -1);
  for (let i = 0; i < ids.length; i++)
    for (let j = 0; j < i; j++)
      if (ids[j]! < ids[i]! && len[j]! + 1 > len[i]!) {
        len[i] = len[j]! + 1;
        prev[i] = j;
      }
  const keep = new Set<number>();
  for (let i = len.indexOf(Math.max(0, ...len)); i >= 0; i = prev[i]!) keep.add(i);
  return keep;
}

/** No space after an opening bracket or quote, none before closing punctuation. */
const OPEN = '([{«„“‘¿¡';
const CLOSE = '.,;:!?…)\\]}»”’%';
const OPENS = new RegExp(`[${OPEN}]$`);
const CLOSES = new RegExp(`^[${CLOSE}]`);
/** Spaces Google leaves between tags: before a closing mark, after an opening one. */
const GAPS = [
  [new RegExp(`</a>\\s+(?=<a i="?\\d+"?>\\s*[${CLOSE}]|[${CLOSE}])`, 'g'), '</a>'],
  [new RegExp(`([${OPEN}]\\s*</a>)\\s+(?=<a )`, 'g'), '$1'],
] as const;

/**
 * Translation for each node, read in page order. Google moves tags when the word order changes; the page's nodes
 * can't move, so only tags that kept their order get their own text. Moved ones (and words outside any tag) join the
 * text before them, and their node ends up empty: the sentence still reads right, a moved link loses its words.
 */
export function decode(html: string, texts: string[]): string[] {
  for (const [re, to] of GAPS) html = html.replace(re, to);
  const parts = [...html.matchAll(TAG)];
  const ids = parts.map((m) => Number(m[1]));
  const valid = ids.map((id, k) => id < texts.length && ids.indexOf(id) === k);
  const order = inOrder(ids.map((id, k) => (valid[k] ? id : -1)).filter((id) => id >= 0));
  const got = texts.map(() => '');
  let cur = -1;
  let head = '';
  // before the first kept tag, text waits in `head`
  const put = (s: string) => (cur >= 0 ? (got[cur] += s) : (head += s));
  let last = 0;
  let v = 0;
  parts.forEach((m, k) => {
    put(html.slice(last, m.index));
    last = m.index + m[0].length;
    if (valid[k] && order.has(v++)) {
      if (cur < 0) got[ids[k]!] = head;
      cur = ids[k]!;
    }
    put(m[2]!);
  });
  put(html.slice(last));
  if (cur < 0) got[texts.findIndex((t) => !blank(t))] = head; // no tags came back at all

  const out: string[] = [];
  let before = '';
  texts.forEach((t, i) => {
    if (blank(t)) return void out.push(t);
    const raw = unesc((got[i] ?? '').replace(/<[^>]*>/g, ''));
    const text = raw.trim();
    // an emptied node keeps one space at most, to separate its neighbours
    if (!text) return void out.push(/\s/.test(t) && !/\s$/.test(before) ? ' ' : '');
    // whitespace: the page's own, or Google's where the page had none (its words got moved here);
    // never doubled, never before a period or after a bracket
    if (CLOSES.test(text))
      for (let j = out.length - 1; j >= 0; j--) {
        out[j] = out[j]!.trimEnd();
        if (out[j]) break;
      }
    const lead = CLOSES.test(text) || OPENS.test(before) || /\s$/.test(before) ? '' : t.match(/^\s*/)![0] || (/^\s/.test(raw) ? ' ' : '');
    const trail = OPENS.test(text) ? '' : t.match(/\s*$/)![0] || (/\s$/.test(raw) ? ' ' : '');
    before = lead + text + trail;
    out.push(before);
  });
  return out;
}
