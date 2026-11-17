// Hitch bench: worst frames, not averages. Real GPU (ANGLE/Metal), a fresh browser profile per page, so every
// "first time" (shader compile, texture upload, scatter build) is measured as a player meets it.
//   node scripts/hitch-bench.mjs [http://localhost:5179] [--out docs/PERF.md] [--label baseline]
// Records every animation frame and every long task (>50 ms main-thread block) from navigation start; each step
// reports its worst frame, p99, frames over 33 ms, long tasks and shader programs compiled during it.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:5179';
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : 'run';

/** Injected before any page script: frame times, long tasks, program count, step marks. */
const RECORDER = () => {
  const r = { frames: [], tasks: [], marks: [{ name: 'boot', t: 0 }] };
  window.__bench = r;
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    const gl = window.__pip?.gl;
    r.frames.push({ t: now, dt: now - last, programs: gl ? gl.info.programs.length : 0 });
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => r.tasks.push({ t: e.startTime, d: e.duration }))).observe({ type: 'longtask', buffered: true });
  } catch {}
  window.__mark = (name) => r.marks.push({ name, t: performance.now() });
};

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const results = [];

async function page(url, steps) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(RECORDER);
  const t0 = Date.now();
  await p.goto(url);
  for (const [name, fn] of steps) {
    await p.evaluate((n) => window.__mark(n), name);
    await fn(p, t0);
  }
  await p.evaluate(() => window.__mark('end'));
  const r = await p.evaluate(() => window.__bench);
  for (let i = 0; i < r.marks.length - 1; i++) {
    const a = r.marks[i];
    const b = r.marks[i + 1];
    const fr = r.frames.filter((f) => f.t > a.t && f.t <= b.t);
    const dts = fr.map((f) => f.dt).sort((x, y) => x - y);
    const tasks = r.tasks.filter((t) => t.t >= a.t && t.t < b.t);
    const before = r.frames.filter((f) => f.t <= a.t).at(-1)?.programs ?? 0;
    const after = fr.at(-1)?.programs ?? before;
    results.push({
      page: url.replace(base, '') || '/',
      step: a.name,
      seconds: +((b.t - a.t) / 1000).toFixed(1),
      worst: +(dts.at(-1) ?? 0).toFixed(1),
      p99: +(dts[Math.floor(dts.length * 0.99)] ?? 0).toFixed(1),
      over33: dts.filter((d) => d > 33.4).length,
      longTasks: tasks.length,
      longestTask: +Math.max(0, ...tasks.map((t) => t.d)).toFixed(0),
      programs: after - before,
    });
  }
  if (errors.length) console.error('page errors:', errors);
  await ctx.close();
}

const wait = (ms) => (p) => p.waitForTimeout(ms);
const g = (code) => (p) => p.evaluate(code);

// 1. The homepage: cold load to a finished title, the timeline, Art & Design and back, New Game.
await page(`${base}/`, [
  [
    'load to title',
    async (p, t0) => {
      await p.getByRole('button', { name: 'New Game' }).waitFor({ timeout: 60000 });
      await p.waitForFunction(() => document.getElementById('boot')?.classList.contains('boot--out') ?? true, null, { timeout: 90000 });
      // the title is finished when every asset is in and nothing new has compiled for a second
      await p.waitForFunction(() => window.__pip?.gl, null, { timeout: 60000 });
      let prev = -1;
      for (let i = 0; i < 60; i++) {
        const n = await p.evaluate(() => window.__pip.gl.info.programs.length);
        if (n === prev && i > 4) break;
        prev = n;
        await p.waitForTimeout(1000);
      }
      results.push({ page: '/', step: '(time to finished title, s)', seconds: +((Date.now() - t0) / 1000).toFixed(1) });
    },
  ],
  [
    'title: hover six generations',
    async (p) => {
      for (const n of ['8-BIT', '16-BIT', 'EARLY 3D', 'STYLIZED', 'MODERN HD', 'BEYOND']) {
        await p.locator('.gen-timeline button', { hasText: n }).first().hover();
        await p.waitForTimeout(1600);
      }
    },
  ],
  ['art & design', async (p) => (await p.getByRole('button', { name: 'Art & Design' }).click(), await p.waitForTimeout(4000))],
  ['back to title', async (p) => (await p.getByRole('button', { name: '← Back' }).click(), await p.waitForTimeout(4000))],
  ['new game', async (p) => (await p.getByRole('button', { name: 'New Game' }).click(), await p.waitForTimeout(6000))],
]);

// 2. Play, as a player gets there (title, loader, New Game): the first time into each generation, a shift,
// the bubble, a puzzle event.
const play = (code) => (p) => p.evaluate(code);
await page(`${base}/`, [
  ['load to title', async (p) => p.getByRole('button', { name: 'New Game' }).waitFor({ timeout: 90000 }).then(() => p.waitForFunction(() => document.getElementById('boot')?.classList.contains('boot--out') ?? true, null, { timeout: 90000 }))],
  ['new game', async (p) => (await p.getByRole('button', { name: 'New Game' }).click(), await p.waitForFunction(() => window.__pip?.game, null, { timeout: 30000 }), await p.waitForTimeout(4000))],
  [
    'to the ruins',
    async (p) => {
      await play(`(() => { const g = window.__pip.game; window.__pip.inputLocked = true; g.cine = null; g.camera.overrideGoal = 0; g.camera.overrideW = 0;
        Object.assign(g.save, { awakened: true, shardTaken: true, shiftUnlocked: true, firstShiftDone: true, regress: true });
        g.player.teleport({ x: 30, y: 4, z: 0 }); g.camera.snap(g.cameraContext()); })()`)(p);
      await p.waitForTimeout(2500);
    },
  ],
  ...[1, 2, 3, 4, 5].map((e) => [`first switch to era ${e}`, async (p) => (await play(`window.__pip.game.changeEra(${e}, 1.8)`)(p), await p.waitForTimeout(3500))]),
  ['shift to 3D', async (p) => (await play('window.__pip.game.requestShift()')(p), await p.waitForTimeout(3500))],
  ['bubble 8-bit on', async (p) => (await play('window.__pip.game.applyRegress(0)')(p), await p.waitForTimeout(3000))],
  ['bubble off', async (p) => (await play('window.__pip.game.applyRegress(null)')(p), await p.waitForTimeout(2500))],
  ['shift to 2D', async (p) => (await play('window.__pip.game.requestShift()')(p), await p.waitForTimeout(3500))],
  ['puzzle event (seal opens)', async (p) => (await play("window.__pip.game.world.get('sealDoor').enabled = false")(p), await p.waitForTimeout(3000))],
  ['steady Beyond 2D', wait(5000)],
]);

await browser.close();

const rows = results.map((r) =>
  r.worst === undefined
    ? `| ${r.page} | ${r.step} | ${r.seconds} | | | | | | |`
    : `| ${r.page} | ${r.step} | ${r.seconds} | ${r.worst} | ${r.p99} | ${r.over33} | ${r.longTasks} | ${r.longestTask} | ${r.programs} |`,
);
const table = [
  `### ${label} (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`,
  '',
  '| Page | Step | s | Worst frame ms | p99 ms | Frames >33 ms | Long tasks | Longest task ms | Programs compiled |',
  '|---|---|---|---|---|---|---|---|---|',
  ...rows,
  '',
].join('\n');
console.log(table);
if (out) fs.appendFileSync(out, '\n' + table);
