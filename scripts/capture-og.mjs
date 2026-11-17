// The link-preview images, captured from the real title scene (dev server, ?shot=og) and supersampled:
//   public/og.jpg          1200×630  (Open Graph / X large card: Slack, iMessage, Discord, LinkedIn, Facebook)
//   public/og-square.jpg   1200×1200 (square thumbnails: WhatsApp, small iMessage cards)
//   node scripts/capture-og.mjs [http://localhost:5179]
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5179';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [file, w, h] of [['public/og.jpg', 1200, 630], ['public/og-square.jpg', 1200, 1200]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/?shot=og`);
  // the scene's assets, then the entrance animation, then a moment for the wind and water
  await page.waitForTimeout(9000);
  const png = await page.screenshot();
  await sharp(png).resize(w, h, { kernel: 'lanczos3' }).jpeg({ quality: 84, mozjpeg: true }).toFile(file);
  console.log(file, `${w}x${h}`, Math.round(fs.statSync(file).size / 1024), 'KB', errors.length ? `ERRORS ${errors.join(' | ')}` : '');
  await page.close();
}
await browser.close();
