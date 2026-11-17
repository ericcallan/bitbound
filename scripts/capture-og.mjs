// The link-preview images, captured from the real title scene (dev server, ?shot=og) and supersampled:
//   public/og.jpg          1200×630  (Open Graph / X large card: Slack, iMessage, Discord, LinkedIn, Facebook)
//   public/og-square.jpg   1200×1200 (square thumbnails: WhatsApp, small iMessage cards)
//   public/og-art.jpg      1200×630  (the Art & Design pages: the live six-generation Pip lineup, labelled)
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

// Art & Design: the character lineup, cropped from the page, with the site's name and the section's
{
  const w = 1200;
  const h = 630;
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto(`${base}/art/`);
  await page.waitForTimeout(9000);
  const box = await page.locator('.sheet__canvas').boundingBox();
  const shot = await page.screenshot({ clip: box });
  // the whole lineup (all six Pips), full width, under a title on the page's own dark backdrop
  const lw = w - 64;
  const lineup = await sharp(shot).resize({ width: lw, kernel: 'lanczos3' }).toBuffer();
  const lh = (await sharp(lineup).metadata()).height;
  const top = Math.round(150 + (h - 150 - 40 - lh) / 2);
  const backdrop = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><radialGradient id="g" cx="0.2" cy="0" r="1.1"><stop offset="0" stop-color="#23206e"/><stop offset="0.6" stop-color="#0d0b1e"/></radialGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <text x="32" y="88" font-family="Helvetica, Arial, sans-serif" font-size="50" font-weight="800" fill="#ffffff" letter-spacing="3">BITBOUND</text>
    <text x="340" y="88" font-family="Helvetica, Arial, sans-serif" font-size="44" font-weight="300" fill="#cfe6ff" letter-spacing="2">Art &amp; Design</text>
    <text x="34" y="128" font-family="Helvetica, Arial, sans-serif" font-size="24" font-weight="400" fill="#9fb4d8">One robot, six graphics generations</text>
  </svg>`);
  const file = 'public/og-art.jpg';
  await sharp(backdrop).composite([{ input: lineup, left: 32, top }]).jpeg({ quality: 86, mozjpeg: true }).toFile(file);
  console.log(file, `${w}x${h}`, Math.round(fs.statSync(file).size / 1024), 'KB');
  await page.close();
}
await browser.close();
