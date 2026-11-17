// Capture screenshots of every dev scenario (and the title screen) from the running dev server.
//   node scripts/capture-screens.mjs docs/screens/after [http://localhost:5179] [scenario,...]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'docs/screens/latest';
const base = process.argv[3] ?? 'http://localhost:5179';
const only = process.argv[4]?.split(',');
const SHOTS = [
  ['menu', ''],
  ['aqueduct-beyond-2d', '?scenario=aqueduct'],
  ['aqueduct-modernhd-2d', '?scenario=aqueduct&era=4'],
  ['aqueduct-beyond-3d', '?scenario=aqueduct3d'],
  ['aqueduct-modernhd-3d', '?scenario=aqueduct3d&era=4'],
  ['aqueduct-overview-beyond', '?scenario=aqueductView'],
  ['aqueduct-overview-modernhd', '?scenario=aqueductView&era=4'],
  ['seal-beyond-3d', '?scenario=seal'],
  ['ruins-beyond-3d', '?scenario=ruins3d'],
  ['chamber-beyond-3d', '?scenario=chamber'],
  ['plateau-beyond-2d', '?scenario=plateau'],
  ['start-8bit', '?scenario=start'],
];

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [name, q] of SHOTS) {
  if (only && !only.includes(name)) continue;
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base + '/' + q);
  if (q) await page.waitForFunction(() => window.__scenarioReady === true, null, { timeout: 60_000 });
  else await page.waitForTimeout(6000);
  await page.screenshot({ path: `${out}/${name}.jpg`, quality: 86 });
  console.log(name, errors.length ? `ERRORS: ${errors.join(' | ')}` : 'ok');
  await page.close();
}
await browser.close();
