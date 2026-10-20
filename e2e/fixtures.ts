import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';

export const PAGE = 'http://ribosome.test/';

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
      const url = new URL(route.request().url());
      const q = url.searchParams.get('q') ?? '';
      if (gtx.status !== 200) return route.fulfill({ status: gtx.status });
      return route.fulfill({ json: [[[`${url.searchParams.get('tl')}:${q}`, q]], null, 'de'] });
    });
    await context.route(PAGE, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<p style="font: 20px sans-serif; margin: 100px"><span id="t">Ribosomes are ancient.</span></p>' }),
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

/** Drags the mouse across the whole test sentence. */
export async function selectSentence(page: Page) {
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

/** Center of the first visible UI element matching `selector`. */
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

/** Text of the first UI element matching `selector`. */
export const uiText = (page: Page, selector: string) => inUi(page, (root, s) => root.querySelector(s)?.textContent ?? null, selector);
