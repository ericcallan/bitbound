import { test, expect } from '@playwright/test';

/**
 * The loader and what follows it: on screen from the first paint, gone once the world is warmed up, and the title
 * menu then actually visible (its entrance animations wait behind the loader and must run after it). Also the
 * generation flag, on the title timeline and in play.
 */
test('the loader shows from the first paint, lifts, and the title menu then appears', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  // in the HTML itself, before any script ran
  expect(await page.locator('#boot').count()).toBe(1);
  await expect(page.locator('#boot')).toHaveClass(/boot--out/, { timeout: 60_000 });
  // fully visible, not merely present: opacity reaches 1 once the entrance animations have run
  await expect.poll(() => page.locator('.logo').evaluate((e) => getComputedStyle(e).opacity), { timeout: 5000 }).toBe('1');
  await expect.poll(() => page.locator('.gen-timeline').evaluate((e) => getComputedStyle(e).opacity), { timeout: 5000 }).toBe('1');
  expect(await page.evaluate(() => document.body.classList.contains('is-loading'))).toBe(false);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the generation flag: on the title timeline and when switching in play', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boot')).toHaveClass(/boot--out/, { timeout: 60_000 });
  const flag = page.locator('.gen-timeline__flag');
  await expect(flag).toHaveText('Generation 6 (2026): Beyond');
  await page.locator('.gen-timeline__item', { hasText: 'EARLY 3D' }).hover();
  await expect(flag).toHaveText('Generation 3 (1996): Early 3D');

  await page.getByRole('button', { name: 'New Game' }).click();
  await page.waitForFunction(() => (window as unknown as { __pip?: { game?: unknown } }).__pip?.game, null, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => (window as unknown as { __pip: { game: { changeEra(e: number, d: number): void } } }).__pip.game.changeEra(3, 1.2));
  await expect(page.locator('.banner__title')).toHaveText('Generation 4 (2002): Stylized');
});
