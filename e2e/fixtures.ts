import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';

export const PAGE = 'http://ribosome.test/';
export const ARTICLE = 'http://ribosome.test/article';
/** Another site, in English: the browser's (and so the target) language. */
export const ENGLISH = 'http://en.test/';

type Gtx = { status: number };

export const test = base.extend<{ context: BrowserContext; extensionId: string; gtx: Gtx }>({
  gtx: async ({}, use) => use({ status: 200 }),
  context: async ({ gtx }, use, info) => {
    // Chromium wants an absolute path
    const ext = `${info.project.testDir}/../.output/chrome-mv3`;
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--lang=en-US'],
    });
    // fake Google: the translation is `<target>:<text>`, the detected language is always German
    await context.route('https://translate.googleapis.com/**', (route) => {
      if (gtx.status !== 200) return route.fulfill({ status: gtx.status });
      const url = new URL(route.request().url());
      const tl = url.searchParams.get('tl');
      if (url.pathname.endsWith('/t')) {
        const qs = new URLSearchParams(route.request().postData() ?? '').getAll('q');
        return route.fulfill({ json: qs.map((q) => [q.replace(/(<a i=\d+>)/g, `$1${tl}:`), 'de']) });
      }
      const q = url.searchParams.get('q') ?? '';
      return route.fulfill({ json: [[[`${tl}:${q}`, q]], null, 'de'] });
    });
    await context.route(PAGE, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<p style="font: 20px sans-serif; margin: 100px"><span id="t">Ribosomes are ancient.</span></p>' }),
    );
    await context.route(ENGLISH, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<p>Ribosomes are the protein factories of every cell. They read the genetic message carried by messenger RNA
          and join amino acids into long chains that fold into proteins. Without ribosomes no living thing could grow.</p>`,
      }),
    );
    await context.route(ARTICLE, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<title>Zellen</title><body style="font: 20px sans-serif">
          <p id="p">Ein <a href="#">Ribosom</a> ist alt.</p><code id="c">keep me</code>
          <div id="pre" style="white-space: pre-wrap">Zeile eins
Zeile zwei</div>
          <div style="display: contents"><span id="dc">Ohne Box</span></div>
          <div id="gh" style="font-family: ui-monospace, monospace; white-space: pre"><span>import</span> x <span>from</span> 'y'; // Kommentar</div>
          <h3 id="mono" style="font-family: monospace">Kopfzeile</h3>
          <p>Ribosomen sind die Proteinfabriken jeder Zelle. Sie lesen die genetische Information der Boten-RNA und
          verknüpfen Aminosäuren zu langen Ketten, aus denen sich Proteine falten. Ohne Ribosomen könnte kein Lebewesen wachsen.</p>
          <p id="far" style="margin-top: 3000px">Ganz unten.</p></body>`,
      }),
    );
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(new URL(sw.url()).host);
  },
});

export const expect = test.expect;

export async function selectSentence(page: Page) {
  // the content script runs at document_idle, which may come after `goto` resolves
  await page.locator('ribosome-ui').waitFor({ state: 'attached' });
  const b = (await page.locator('#t').boundingBox())!;
  await page.mouse.move(b.x + 1, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
}

/** Runs `fn` against our closed shadow root, which only CDP with `pierce` can reach. */
export async function inUi<A extends unknown[], T>(page: Page, fn: (root: ShadowRoot, ...args: A) => T, ...args: A): Promise<T | null> {
  const cdp = await page.context().newCDPSession(page);
  try {
    type Node = { localName: string; backendNodeId: number; children?: Node[]; shadowRoots?: Node[] };
    const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: Node };
    const find = (n: Node): Node | undefined =>
      n.localName === 'ribosome-ui' ? n : [...(n.children ?? []), ...(n.shadowRoots ?? [])].map(find).find(Boolean);
    const sr = find(root)?.shadowRoots?.[0];
    if (!sr) return null;
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: sr.backendNodeId });
    const r = await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: `function (...args) { return (${fn})(this, ...args); }`,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
    });
    return r.result.value as T;
  } finally {
    await cdp.detach();
  }
}

export const uiPoint = (page: Page, selector: string) =>
  inUi(
    page,
    (root, s) => {
      const el = root.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    selector,
  );

export const uiText = (page: Page, selector: string) => inUi(page, (root, s) => root.querySelector(s)?.textContent ?? null, selector);
