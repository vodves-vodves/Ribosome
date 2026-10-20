import { ARTICLE, expect, test, uiPoint, uiText } from './fixtures';

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
  // far below the screen: not yet
  await expect(page.locator('#far')).toHaveText('Ganz unten.');
  await page.locator('#far').scrollIntoViewIfNeeded();
  await expect(page.locator('#far')).toHaveText('en:Ganz unten.');

  // the bar may have folded into a circle by now: hovering unfolds it
  const icon = (await uiPoint(page, '.rb-pill .rb-pi'))!;
  await page.mouse.move(icon.x, icon.y);
  const original = (await uiPoint(page, '.rb-pill .rb-pa'))!;
  await page.mouse.click(original.x, original.y);
  await expect(page.locator('#p')).toHaveText('Ein Ribosom ist alt.');
  await expect(page.locator('#far')).toHaveText('Ganz unten.');
  await expect.poll(() => uiText(page, '.rb-pill .rb-pt')).toBe('Showing the original · Deutsch');
});
