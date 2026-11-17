// The link-preview images, captured from the real title scene (dev server, ?shot=og) and supersampled:
//   public/og.jpg          1200×630  (Open Graph / X large card: Slack, iMessage, Discord, LinkedIn, Facebook)
//   public/og-square.jpg   1200×1200 (square thumbnails: WhatsApp, small iMessage cards)
//   public/og-art.jpg      1200×630  (the Art & Design pages: the live six-generation Pip lineup, labelled)
//   node scripts/capture-og.mjs [http://localhost:5179] [--only og]
//
// The game's images show the whole idea at a glance: the title scene cut into six slanted bands, 8-bit on the left
// to Beyond on the right (each band is the real title in that generation), under the wordmark and "From 8-bit to
// beyond." One browser page per size, closed as soon as it's done.
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import fs from 'node:fs';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5179';
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const LABELS = ['8-BIT', '16-BIT', 'EARLY 3D', 'STYLIZED', 'MODERN HD', 'BEYOND'];
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

/** `pipX`: where Pip stands across the frame at this size (the title scene frames him differently when square). */
async function generations(file, w, h, pipX) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/?shot=og`);
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('boot--out'), null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  // the scene alone, in each generation (← steps the title timeline back one generation)
  await page.addStyleTag({ content: '.menu__panel, .menu__scrim { visibility: hidden !important; }' });
  const shots = [];
  for (let e = 5; e >= 0; e--) {
    if (e < 5) await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(e === 5 ? 500 : 2600);
    shots[e] = await sharp(await page.screenshot()).resize(w, h, { kernel: 'lanczos3' }).png().toBuffer();
  }
  // the wordmark and tagline on their own: shot over black and over white, and the difference gives each pixel's
  // coverage (so the glow and the soft edges keep their transparency)
  await page.addStyleTag({
    content: '* { background-color: transparent !important; } canvas, .pixel-title, .world-canvas, #boot { display: none !important; } .menu__panel { visibility: visible !important; }',
  });
  const panel = page.locator('.menu__panel');
  const box = await panel.boundingBox();
  const over = async (bg) => {
    await page.evaluate((c) => (document.documentElement.style.setProperty('background', c, 'important'), document.body.style.setProperty('background', c, 'important')), bg);
    await page.waitForTimeout(250);
    return sharp(await page.screenshot({ clip: box })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  };
  const blk = await over('#000000');
  const wht = await over('#ffffff');
  await page.close();
  const { width: lw, height: lh } = blk.info;
  const rgba = Buffer.alloc(lw * lh * 4);
  for (let i = 0; i < lw * lh; i++) {
    const d = (wht.data[i * 3] - blk.data[i * 3] + wht.data[i * 3 + 1] - blk.data[i * 3 + 1] + wht.data[i * 3 + 2] - blk.data[i * 3 + 2]) / 3;
    const a = Math.max(0, Math.min(255, 255 - d));
    rgba[i * 4 + 3] = a;
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = a > 0 ? Math.min(255, Math.round((blk.data[i * 3 + c] * 255) / a)) : 0;
  }
  const logo = await sharp(rgba, { raw: { width: lw, height: lh, channels: 4 } }).resize(Math.round(box.width), Math.round(box.height)).png().toBuffer();

  // six slanted bands, shifted so Pip (on his slab, about a third of the way in) stands inside the Early 3D band
  // rather than on a seam
  const slant = Math.round(w * 0.06);
  // Pip's band (Early 3D) is centred on him at his height (the bands lean, so allow for the slant there); the two
  // bands before it share the space to its left, the three after it the space to its right
  const P = w * pipX + slant * 0.25;
  const B = w * 0.19;
  const Lw = (P - B / 2) / 2;
  const Rw = (w - P - B / 2) / 3;
  const at = [0, Lw, 2 * Lw, P + B / 2, P + B / 2 + Rw, P + B / 2 + 2 * Rw, w];
  const edge = (i) => (i <= 0 ? -slant * 3 : i >= 6 ? w + slant * 3 : Math.round(at[i] - slant / 2));
  const layers = [];
  for (let e = 0; e < 6; e++) {
    const x0 = edge(e);
    const x1 = edge(e + 1);
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><polygon points="${x0 + slant},0 ${x1 + slant},0 ${x1},${h} ${x0},${h}" fill="#fff"/></svg>`);
    layers.push({ input: await sharp(shots[e]).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer() });
  }
  // seams of light between the bands, a shade behind the wordmark, and each band's generation at its foot
  const seams = Array.from({ length: 5 }, (_, i) => {
    const x = edge(i + 1);
    return `<line x1="${x + slant}" y1="0" x2="${x}" y2="${h}" stroke="#ffffff" stroke-opacity="0.85" stroke-width="3"/><line x1="${x + slant}" y1="0" x2="${x}" y2="${h}" stroke="#7ff6ff" stroke-opacity="0.5" stroke-width="10" filter="url(#glow)"/>`;
  }).join('');
  const tagH = Math.round(Math.min(w * 0.025, h * 0.046));
  const mid = (e) => (Math.max(edge(e), 0) + Math.min(edge(e + 1), w)) / 2;
  const tags = LABELS.map((t, e) => {
    const cx = mid(e) + slant * 0.1;
    const band = Math.min(edge(e + 1), w) - Math.max(edge(e), 0);
    const natural = t.length * tagH * 0.5 + tagH * 1.0;
    const fit = Math.min(1, (band * 0.92) / natural);
    const tw = natural * fit;
    const y = h - tagH * 1.9;
    return `<rect x="${cx - tw / 2}" y="${y}" width="${tw}" height="${tagH * 1.25}" rx="${tagH * 0.62}" fill="#0b1626" fill-opacity="0.72" stroke="#ffffff" stroke-opacity="0.25"/><text x="${cx}" y="${y + tagH * 0.88}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="700" font-size="${tagH * 0.56 * fit}" letter-spacing="${tagH * 0.06 * fit}" fill="#ffffff" text-anchor="middle">${t}</text>`;
  }).join('');
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <filter id="glow"><feGaussianBlur stdDeviation="4"/></filter>
      <radialGradient id="shade" cx="0.2" cy="0.12" r="0.75"><stop offset="0" stop-color="#050c1a" stop-opacity="0.72"/><stop offset="0.6" stop-color="#050c1a" stop-opacity="0.25"/><stop offset="1" stop-color="#050c1a" stop-opacity="0"/></radialGradient>
      <linearGradient id="foot" x1="0" y1="0" x2="0" y2="1"><stop offset="0.7" stop-color="#050c1a" stop-opacity="0"/><stop offset="1" stop-color="#050c1a" stop-opacity="0.55"/></linearGradient>
    </defs>
    ${seams}
    <rect width="${w}" height="${h}" fill="url(#shade)"/>
    <rect width="${w}" height="${h}" fill="url(#foot)"/>
    ${tags}
  </svg>`);
  await sharp({ create: { width: w, height: h, channels: 3, background: '#0b1626' } })
    .composite([...layers, { input: overlay }, { input: logo, left: Math.max(0, Math.round(box.x)), top: Math.max(0, Math.round(box.y)) }])
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(file);
  console.log(file, `${w}x${h}`, Math.round(fs.statSync(file).size / 1024), 'KB', errors.length ? `ERRORS ${errors.join(' | ')}` : '');
}

if (!only || only === 'og') {
  await generations('public/og.jpg', 1200, 630, 0.36);
  await generations('public/og-square.jpg', 1200, 1200, 0.235);
}

// Art & Design: the character lineup, cropped from the page, with the site's name and the section's
if (!only || only === 'art') {
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
