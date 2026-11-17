import { test, expect, type Page } from '@playwright/test';

/**
 * No see-through holes: with an 8-bit or 16-bit Regress bubble anywhere along the route, in 3D and in 2D, the
 * ground under and around Pip must stay. The ground's depth is read back with and without the bubble
 * (dev/probe.ts); inside the bubble's screen circle nothing may suddenly see farther. (The bug: inside a bubble
 * the terrain was discarded with nothing drawn in its place.)
 */
const XS = Array.from({ length: 21 }, (_, i) => 2 + i * 12);

async function sweep(page: Page, mode: '2d' | '3d') {
  await page.goto(`/?scenario=ruins&era=5&mode=${mode}`);
  await page.waitForFunction(() => window.__scenarioReady, null, { timeout: 90_000 });
  const fails: string[] = [];
  let probed = 0;
  for (const x of XS) {
    for (const era of [0, 1]) {
      const r = await page.evaluate(
        async ({ x, era, mode }) => {
          const pip = (window as unknown as { __pip: any }).__pip;
          const g = pip.game;
          pip.inputLocked = true;
          g.applyRegress(null);
          g.camera.override = null;
          g.camera.overrideW = 0;
          g.camera.overrideGoal = 0;
          g.shift.set(mode);
          if (mode === '2d') g.shift.laneZ = 0;
          g.player.teleport({ x, y: 30, z: 0 });
          g.camera.snap(g.cameraContext());
          const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
          for (let i = 0; i < 40 && !g.player.grounded; i++) await wait(100);
          if (!g.player.grounded) return { skip: 'never landed' };
          // let the follow camera settle on the new spot, then compare the ground's depth without and with the bubble
          await wait(1200);
          const r = await window.__holes!(era);
          return 'skip' in r ? r : { at: { x: +g.player.pos.x.toFixed(1), y: +g.player.pos.y.toFixed(1) }, ...r };
        },
        { x, era, mode },
      );
      if ('skip' in r) continue;
      probed++;
      if (r.through > r.pixels * 0.005) fails.push(`${mode} era ${era} at x=${r.at.x} y=${r.at.y}: ${r.through}/${r.pixels} pixels see through (up to ${r.worst} farther)`);
    }
  }
  expect(probed, 'too few spots could be probed').toBeGreaterThan(XS.length);
  expect(fails, fails.join('\n')).toEqual([]);
}

test('no see-through: 8-bit and 16-bit bubbles along the whole route, in 3D', async ({ page }) => {
  test.setTimeout(300_000);
  await sweep(page, '3d');
});

test('no see-through: 8-bit and 16-bit bubbles along the whole route, in 2D', async ({ page }) => {
  test.setTimeout(300_000);
  await sweep(page, '2d');
});
