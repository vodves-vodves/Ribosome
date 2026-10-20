import { expect, inUi, PAGE, selectSentence, test, uiPoint, uiText } from './fixtures';

test('selecting text shows the icon, the icon opens the translation', async ({ page }) => {
  await page.goto(PAGE);
  await selectSentence(page);
  await expect.poll(() => uiPoint(page, '.rb-trigger.is-in')).not.toBeNull();
  const icon = (await uiPoint(page, '.rb-trigger.is-in'))!;
  await page.mouse.click(icon.x, icon.y);
  // the browser runs in English, so that's the default target
  await expect.poll(() => uiText(page, '.rb-bubble .rb-bt')).toBe('en:Ribosomes are ancient.');
  expect(await uiText(page, '.rb-bubble .rb-lang')).toBe('DE → EN');
});

test('a Google error is explained and can be retried', async ({ page, gtx }) => {
  gtx.status = 503;
  await page.goto(PAGE);
  await selectSentence(page);
  await expect.poll(() => uiPoint(page, '.rb-trigger.is-in')).not.toBeNull();
  const icon = (await uiPoint(page, '.rb-trigger.is-in'))!;
  await page.mouse.click(icon.x, icon.y);
  await expect.poll(() => uiText(page, '.rb-bubble .rb-bt')).toBe("Google Translate isn't responding.");
  expect(await uiText(page, '.rb-bubble .rb-note')).toBe('Error 503. Try again in a minute.');

  gtx.status = 200;
  const retry = (await uiPoint(page, '.rb-retry'))!;
  await page.mouse.click(retry.x, retry.y);
  await expect.poll(() => uiText(page, '.rb-bubble .rb-bt')).toMatch(/:Ribosomes are ancient\.$/);
});

test('popup translates typed text; instant mode opens the window without the icon', async ({ context, page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator('#tr-in').fill('Hello');
  await expect(page.locator('#tr-out')).toHaveText(/^[a-z]{2}:Hello$/);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Right after selecting' }).click();
  await expect(page.getByRole('radio', { name: 'Right after selecting' })).toHaveAttribute('aria-checked', 'true');

  const site = await context.newPage();
  await site.goto(PAGE);
  await selectSentence(site);
  await expect.poll(() => uiText(site, '.rb-bubble .rb-bt')).toMatch(/:Ribosomes are ancient\.$/);
  expect(await inUi(site, (root) => root.querySelector('.rb-trigger')!.classList.contains('is-on'))).toBe(false);
});
