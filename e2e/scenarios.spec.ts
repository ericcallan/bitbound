import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

/**
 * Browser tests on the real renderer (headless Chromium, ANGLE/Metal on the GPU): every dev scenario in every
 * generation it supports loads with no console error, no shader error and no failed asset request, draws a
 * non-blank frame, and still looks like its stored baseline.
 *
 * Baselines are a 48 × 27 colour grid of the frozen frame (e2e/baselines/*.json, a few KB each), compared with a
 * tolerance, so animated foliage and water don't fail them but a missing asset, a black frame or a broken shader
 * does. Refresh after an intended visual change:  UPDATE_BASELINES=1 npx playwright test
 */
const CASES: [string, number[]][] = [
  ['start', [0]],
  ['ruins', [0, 1, 4]],
  ['ruins3d', [2, 3, 4, 5]],
  ['chamber', [4, 5]],
  ['stair', [1, 4]],
  ['plateau', [4, 5]],
  ['aqueduct', [0, 1, 2, 3, 4, 5]],
  ['aqueduct3d', [2, 3, 4, 5]],
  ['aqueductView', [2, 3, 4, 5]],
  ['seal', [5]],
  ['summit', [4, 5]],
];
const GRID = { w: 48, h: 27 };
const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'baselines');

function watch(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' || /Shader Error|WebGL: INVALID|THREE\.WebGLProgram/.test(t)) problems.push(`console: ${t.slice(0, 300)}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
  return problems;
}

async function grid(png: Buffer) {
  const { data } = await sharp(png).resize(GRID.w, GRID.h, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return [...data];
}

for (const [name, eras] of CASES) {
  for (const era of eras) {
    test(`${name} · generation ${era}`, async ({ page }) => {
      const problems = watch(page);
      await page.goto(`/?scenario=${name}&era=${era}&freeze=1`);
      await page.waitForFunction(() => window.__scenarioReady === true, null, { timeout: 60_000 });
      // a few frozen frames for the post chain to settle
      await page.waitForTimeout(600);
      const png = await page.screenshot();
      expect(problems, problems.join('\n')).toEqual([]);

      const g = await grid(png);
      // not blank: the frame has real variation
      const mean = g.reduce((s, v) => s + v, 0) / g.length;
      const sd = Math.sqrt(g.reduce((s, v) => s + (v - mean) ** 2, 0) / g.length);
      expect(sd, 'frame looks blank').toBeGreaterThan(12);

      const file = path.join(DIR, `${name}-${era}.json`);
      if (process.env.UPDATE_BASELINES || !fs.existsSync(file)) {
        fs.mkdirSync(DIR, { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ w: GRID.w, h: GRID.h, rgb: g }));
        return;
      }
      const base = JSON.parse(fs.readFileSync(file, 'utf8')).rgb as number[];
      let sum = 0;
      let bad = 0;
      for (let i = 0; i < g.length; i += 3) {
        const d = (Math.abs(g[i] - base[i]) + Math.abs(g[i + 1] - base[i + 1]) + Math.abs(g[i + 2] - base[i + 2])) / 3;
        sum += d;
        if (d > 48) bad++;
      }
      const cells = g.length / 3;
      expect(sum / cells, 'average colour drift from the baseline').toBeLessThan(10);
      expect(bad / cells, 'share of grid cells that changed a lot').toBeLessThan(0.08);
    });
  }
}

test('title screen: loads clean, the timeline ripples the scene, buttons work', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'New Game' })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(4000);
  for (const label of ['Continue', 'Settings', 'Art & Design', 'Generations']) {
    if (label === 'Continue') continue; // only with a save
    await expect(page.getByRole('button', { name: label })).toBeVisible();
  }
  const before = await grid(await page.screenshot());
  await page.getByRole('button', { name: 'Show the title scene in 8-BIT' }).click();
  await page.waitForTimeout(2500);
  const after = await grid(await page.screenshot());
  let diff = 0;
  for (let i = 0; i < before.length; i++) diff += Math.abs(before[i] - after[i]);
  expect(diff / before.length, 'the scene changed generation').toBeGreaterThan(6);
  await page.getByRole('button', { name: 'Generations' }).click();
  await expect(page.getByRole('button', { name: 'Environment' })).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});

test('perspective shift in the browser: at three known spots, including a refused one', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/?scenario=plateau&era=5');
  await page.waitForFunction(() => window.__scenarioReady === true, null, { timeout: 60_000 });
  const result = await page.evaluate(async () => {
    type G = { requestShift(): string | null; shift: { mode: string }; player: { teleport(p: object): void; grounded: boolean } };
    const s = (window as unknown as { __pip: { game: G; input: { enabled: boolean } } }).__pip;
    s.input.enabled = false;
    const g = s.game;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const out: (string | null)[] = [];
    // 1: on the plateau, 2D → 3D
    out.push(g.requestShift());
    await wait(1500);
    out.push(g.shift.mode);
    // 2: back to 2D
    out.push(g.requestShift());
    await wait(1500);
    out.push(g.shift.mode);
    // 3: on the aqueduct's 2D-only span: refused with a reason
    g.player.teleport({ x: 220, y: 12.6, z: 0 });
    await wait(600);
    out.push(g.requestShift());
    out.push(g.shift.mode);
    return out;
  });
  expect(result).toEqual([null, '3d', null, '2d', 'painted', '2d']);
  expect(problems, problems.join('\n')).toEqual([]);
});
