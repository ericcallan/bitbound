import { test, expect } from '@playwright/test';

/** Sharing: the preview tags are on the page, search engines are told to stay out, and Share works. */
test('the page carries link-preview tags and stays out of search', async ({ page, request }) => {
  await page.goto('/');
  const content = (sel: string) => page.locator(sel).first().getAttribute('content');
  expect(await content('meta[property="og:title"]')).toBe('Bitbound');
  expect(await content('meta[property="og:image"]')).toMatch(/^https?:\/\/.+\/og\.jpg$/);
  expect(await content('meta[name="twitter:card"]')).toBe('summary_large_image');
  expect(await content('meta[name="robots"]')).toContain('noindex');
  expect(await page.locator('link[rel="manifest"]').count()).toBe(1);
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toMatch(/User-agent: \*\nDisallow: \//);
  expect(robots).toMatch(/User-agent: Slackbot-LinkExpanding\nAllow: \//);
  for (const f of ['/og.jpg', '/og-square.jpg', '/site.webmanifest', '/favicon.svg', '/icon-512.png']) expect((await request.get(f)).status(), f).toBe(200);
});

test('Share copies the link when there is no share sheet, and says so', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }));
  await page.goto('/');
  const btn = page.getByRole('button', { name: 'Share Bitbound' });
  await expect(btn).toBeVisible({ timeout: 30_000 });
  await btn.click();
  await expect(page.getByText('Link copied')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/from 8-bit to beyond/i);
  // the shared link is the game's root, marked as shared, never carrying other parameters
  expect(copied).toMatch(/https?:\/\/[^ ]+\/\?utm_source=share$/);
});

/** Art & Design has real addresses: each tab opens from its own URL, tabs update it, back and forward work. */
test('Art & Design routes: open by URL, tabs change the address, back returns to the title', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Art & Design' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Art & Design' }).click();
  await expect(page).toHaveURL(/\/art\/$/);
  await expect(page.getByRole('heading', { name: 'Pip', level: 2 })).toBeVisible();
  await expect(page).toHaveTitle(/Pip, in six generations/);
  for (const [tab, path, heading] of [
    ['Environment', '/art/environment/', 'The world'],
    ['Interface', '/art/interface/', 'Interface'],
    ['World Map', '/art/map/', 'World map'],
  ]) {
    await page.getByRole('navigation', { name: 'Art & Design sections' }).getByRole('button', { name: tab }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole('heading', { name: heading, level: 2 })).toBeVisible();
    await page.waitForTimeout(1500);
  }
  await page.goBack();
  await expect(page).toHaveURL(/\/art\/interface\/$/);
  await page.goBack();
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: 'New Game' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Pip', level: 2 })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a deep link opens its tab directly', async ({ page }) => {
  await page.goto('/art/environment/');
  await expect(page.getByRole('heading', { name: 'The world', level: 2 })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.gallery__tab.is-on')).toHaveText('Environment');
  await expect(page).toHaveTitle(/One world, six generations/);
});
