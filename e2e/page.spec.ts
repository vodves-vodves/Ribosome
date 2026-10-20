import { ARTICLE, ENGLISH, expect, test, uiPoint, uiText } from './fixtures';

test('a page in another language gets an offer; Translate translates it', async ({ page }) => {
  await page.goto(ARTICLE);
  // detected in the browser: German, while the browser (and so the target) is English
  await expect.poll(() => uiText(page, '.rb-pill.is-offer .rb-pt')).toBe('Deutsch → English');
  expect(await uiText(page, '.rb-pill .rb-pa')).toBe('Translate');
  const go = (await uiPoint(page, '.rb-pill .rb-pa'))!;
  await page.mouse.click(go.x, go.y);
  await expect(page.locator('#p')).toHaveText('en:Ein en:Ribosom en:ist alt.');
  expect(await uiText(page, '.rb-pill.is-offer')).toBeNull();
});

test('× hides the offer on this site until the browser closes', async ({ page }) => {
  await page.goto(ARTICLE);
  await expect.poll(() => uiText(page, '.rb-pill.is-offer .rb-pt')).toBe('Deutsch → English');
  const x = (await uiPoint(page, '.rb-pill .rb-x'))!;
  await page.mouse.click(x.x, x.y);
  await page.reload();
  await page.locator('ribosome-ui').waitFor({ state: 'attached' });
  await page.waitForTimeout(1500);
  expect(await uiText(page, '.rb-pill.is-on')).toBeNull();
});

test('a page in the target language gets no offer; one that becomes the target loses it', async ({ context, page }) => {
  await page.goto(ENGLISH);
  await page.locator('ribosome-ui').waitFor({ state: 'attached' });
  // past the 2.5 s second look for slow pages
  await page.waitForTimeout(3000);
  expect(await uiText(page, '.rb-pill.is-on')).toBeNull();

  await page.goto(ARTICLE);
  await expect.poll(() => uiText(page, '.rb-pill.is-offer .rb-pt')).toBe('Deutsch → English');
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await sw.evaluate("chrome.storage.sync.set({ settings: { target: 'de' } })");
  await expect.poll(() => uiText(page, '.rb-pill.is-on')).toBeNull();
});

test('an "always translate" site is translated in place, lazily, and goes back to the original', async ({ context, page }) => {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await sw.evaluate("chrome.storage.sync.set({ settings: { autoSites: ['ribosome.test'] } })");

  await page.goto(ARTICLE);
  // the link stays a link, code stays code
  await expect(page.locator('#p')).toHaveText('en:Ein en:Ribosom en:ist alt.');
  await expect(page.locator('#p a')).toHaveText('en:Ribosom');
  await expect(page.locator('#c')).toHaveText('keep me');
  await expect(page).toHaveTitle('en:Zellen');
  await expect.poll(() => uiText(page, '.rb-pill .rb-pt')).toBe('Deutsch → English');
  // line breaks survive, a wrapper without a box doesn't hide its text
  await expect(page.locator('#pre')).toHaveText('en:Zeile eins\nZeile zwei');
  await expect(page.locator('#dc')).toHaveText('en:Ohne Box');
  // the site rewrites a translated node and clones a translated paragraph
  await page.evaluate(() => {
    document.querySelector('#p a')!.firstChild!.nodeValue = 'Zelle';
    const copy = document.querySelector('#p')!.cloneNode(true) as Element;
    copy.id = 'copy';
    document.querySelector('#p')!.after(copy);
  });
  await expect(page.locator('#p')).toHaveText('en:Ein en:Zelle en:ist alt.');
  await expect(page.locator('#copy')).toHaveText('en:Ein en:Zelle en:ist alt.');
  // far below the screen: not yet
  await expect(page.locator('#far')).toHaveText('Ganz unten.');
  await page.locator('#far').scrollIntoViewIfNeeded();
  await expect(page.locator('#far')).toHaveText('en:Ganz unten.');

  // the bar may have folded into a circle by now: hovering unfolds it
  const icon = (await uiPoint(page, '.rb-pill .rb-pi'))!;
  await page.mouse.move(icon.x, icon.y);
  const original = (await uiPoint(page, '.rb-pill .rb-pa'))!;
  await page.mouse.click(original.x, original.y);
  await expect(page.locator('#p')).toHaveText('Ein Zelle ist alt.');
  // the copy's untouched nodes come back through the translation → original map
  await expect(page.locator('#copy')).toHaveText('Ein Zelle ist alt.');
  await expect(page.locator('#far')).toHaveText('Ganz unten.');
  await expect(page.locator('#pre')).toHaveText('Zeile eins\nZeile zwei');
  await expect.poll(() => uiText(page, '.rb-pill .rb-pt')).toBe('Showing the original · Deutsch');
});
