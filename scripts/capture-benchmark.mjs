// The six-generation benchmark (docs/benchmark/README.md): the shard ruins, same spot and framing, in all six
// generations in 2D and in the four 3D generations, plus one labelled contact sheet.
//   node scripts/capture-benchmark.mjs <name> [http://localhost:5179]
//   → docs/benchmark/<name>/{2d,3d}-<era>.jpg and docs/benchmark/<name>-sheet.jpg
//
// One browser page for all ten frames, closed as soon as it's done (full browser suites are too heavy for the
// development machine). Needs the dev server, since it uses the dev scenarios.
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import fs from 'node:fs';

const name = process.argv[2];
const base = process.argv[3] ?? 'http://localhost:5179';
if (!name) throw new Error('usage: node scripts/capture-benchmark.mjs <name> [base url]');
const dir = `docs/benchmark/${name}`;
fs.mkdirSync(dir, { recursive: true });

const NAMES = ['8-bit', '16-bit', 'Early 3D', 'Stylized', 'Modern HD', 'Beyond'];
const SHOTS = [...[0, 1, 2, 3, 4, 5].map((era) => ['2d', era]), ...[2, 3, 4, 5].map((era) => ['3d', era])];

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const [mode, era] of SHOTS) {
    await page.goto(`${base}/?scenario=ruins&era=${era}&mode=${mode}&x=27&freeze=1`);
    await page.waitForFunction(() => window.__scenarioReady, null, { timeout: 90000 });
    // the 3D frames: a fixed orbit behind Pip, looking along the path toward the ruins
    if (mode === '3d') await page.evaluate(() => window.__pip.game.camera.resetOrbit(0.5, 0.05));
    await page.waitForTimeout(1800);
    await sharp(await page.screenshot()).jpeg({ quality: 82 }).toFile(`${dir}/${mode}-${era}.jpg`);
  }
  if (errors.length) console.log('page errors:', errors);
} finally {
  await browser.close();
}

const W = 480, H = 270, LBL = 26, HEAD = 44;
const comp = [
  { input: Buffer.from(`<svg width="${W * 3}" height="${HEAD}"><text x="12" y="29" font-family="Helvetica" font-weight="bold" font-size="20" fill="#f1ead9">Benchmark · shard ruins · ${name} (${new Date().toISOString().slice(0, 10)})</text></svg>`), left: 0, top: 0 },
];
for (const [i, [mode, era]] of SHOTS.entries()) {
  const x = (i % 3) * W, y = HEAD + Math.floor(i / 3) * (H + LBL);
  comp.push({ input: Buffer.from(`<svg width="${W}" height="${LBL}"><text x="10" y="18" font-family="Helvetica" font-size="14" fill="#d9d3c4">${NAMES[era]} · ${mode.toUpperCase()}</text></svg>`), left: x, top: y });
  comp.push({ input: await sharp(`${dir}/${mode}-${era}.jpg`).resize(W, H).toBuffer(), left: x, top: y + LBL });
}
const rows = Math.ceil(SHOTS.length / 3);
await sharp({ create: { width: W * 3, height: HEAD + rows * (H + LBL), channels: 3, background: '#111318' } })
  .composite(comp)
  .jpeg({ quality: 84 })
  .toFile(`docs/benchmark/${name}-sheet.jpg`);
console.log(`docs/benchmark/${name}-sheet.jpg`);
