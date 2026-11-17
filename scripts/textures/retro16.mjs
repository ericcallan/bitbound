/**
 * The 16-bit generation's art, made the way mid-90s games often were: from real source material, reduced.
 *
 *   public/assets/retro/tiles16.png      24×24 tiles (grass top, earth, stone) cut from the scanned Poly Haven
 *                                        ground materials, downscaled and reduced to 12 colours each
 *   public/assets/retro/far16.png        parallax: distant mountains, 4 shades + ordered dither, tiles in x
 *   public/assets/retro/mid16.png        parallax: rolling hills with a tree line, tiles in x
 *   public/assets/retro/clouds16.png     parallax: soft clouds with dithered edges, tiles in x
 *
 *   node scripts/textures/retro16.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SRC = path.join(ROOT, 'assets', 'source-textures', 'polyhaven');
const OUT = path.join(ROOT, 'public', 'assets', 'retro');
fs.mkdirSync(OUT, { recursive: true });
const T = 24;

/** A source texture as a T×T RGB patch, downscaled with a box filter (crisp, like a period artist's reduction). */
async function patch(set, scale = 0.16, tint = [1, 1, 1], sat = 1.25) {
  const img = sharp(path.join(SRC, set, 'diff.jpg'));
  const meta = await img.metadata();
  const crop = Math.round(meta.width * scale);
  const buf = await img
    .extract({ left: Math.round(meta.width * 0.31), top: Math.round(meta.height * 0.27), width: crop, height: crop })
    .modulate({ saturation: sat, brightness: 1.08 })
    .resize(T, T, { kernel: 'cubic' })
    .removeAlpha()
    .raw()
    .toBuffer();
  for (let i = 0; i < buf.length; i += 3) for (let c = 0; c < 3; c++) buf[i + c] = Math.min(255, buf[i + c] * tint[c]);
  return buf;
}

/** Reduce an RGB buffer to `n` colours (median cut via sharp's palette quantiser), returning RGBA. */
async function reduce(rgb, w, h, n) {
  const png = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png({ palette: true, colours: n, dither: 0.6 }).toBuffer();
  return sharp(png).ensureAlpha().raw().toBuffer();
}

// --- tiles: [grassTop | earth | stone] in a 72×24 strip
const earth = await patch('dirt_floor', 0.12, [1.05, 0.88, 0.7], 1.35);
const grass = await patch('leafy_grass', 0.1, [0.62, 1.08, 0.5], 1.6);
const stone = await patch('rough_block_wall', 0.18, [1, 0.98, 1.04], 0.85);
const grassTop = Buffer.from(earth);
for (let y = 0; y < T; y++) {
  for (let x = 0; x < T; x++) {
    // a grass mat over the soil, with tufts hanging down and a bright lip
    const edge = 7 + Math.round(Math.sin(x * 1.3) * 1.5 + ((x * 7) % 5 === 0 ? 2 : 0));
    const i = (y * T + x) * 3;
    if (y < edge) for (let c = 0; c < 3; c++) grassTop[i + c] = grass[i + c];
    if (y < 2) for (let c = 0; c < 3; c++) grassTop[i + c] = Math.min(255, grass[i + c] * 1.35 + 10);
    if (y === edge || y === edge + 1) for (let c = 0; c < 3; c++) grassTop[i + c] = grassTop[i + c] * 0.6;
  }
}
const strip = Buffer.alloc(T * 3 * T * 4);
for (const [k, buf] of [grassTop, earth, stone].entries()) {
  const q = await reduce(buf, T, T, 12);
  for (let y = 0; y < T; y++) q.copy(strip, (y * T * 3 + k * T) * 4, y * T * 4, (y + 1) * T * 4);
}
await sharp(strip, { raw: { width: T * 3, height: T, channels: 4 } }).png().toFile(path.join(OUT, 'tiles16.png'));

// --- parallax layers (period-style painting: banded shades + 4×4 ordered dither), all tileable in x
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16);
const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
/** Periodic smooth noise so layers wrap seamlessly. */
const wave = (x, w, seeds) => seeds.reduce((s, [f, a, p]) => s + Math.sin(((x / w) * f + p) * Math.PI * 2) * a, 0);

function layer(w, h, fn) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = fn(x, y, BAYER[(y % 4) * 4 + (x % 4)]);
      if (!c) continue;
      const i = (y * w + x) * 4;
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
      buf[i + 3] = 255;
    }
  return sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png();
}

// far mountains: blue-violet ranges with snow caps, lit from the left
const FW = 768;
const FH = 224;
await layer(FW, FH, (x, y, d) => {
  const ridge = 120 + wave(x, FW, [[3, 22, 0.1], [7, 9, 0.6], [13, 4, 0.3]]);
  if (y < ridge) return null;
  const depth = (y - ridge) / (FH - ridge);
  const slope = wave(x + 1, FW, [[3, 22, 0.1], [7, 9, 0.6], [13, 4, 0.3]]) - wave(x - 1, FW, [[3, 22, 0.1], [7, 9, 0.6], [13, 4, 0.3]]);
  let c = mix3([118, 128, 196], [78, 86, 150], Math.min(1, depth * 1.6));
  // faces turned toward the light (rising to the right) catch it, smoothly, quantised to two bands by the dither
  const lit = Math.max(0, Math.min(1, 0.5 + slope * 0.9 + (d - 0.5) * 0.4)) * (1 - depth);
  if (lit > 0.55) c = mix3(c, [152, 162, 222], 0.55);
  if (y < ridge + 9 + Math.sin(x * 0.2) * 3 && depth + d * 0.05 < 0.12) c = [236, 242, 255]; // snow
  return depth + (d - 0.5) * 0.15 > 0.55 ? mix3(c, [70, 78, 140], 0.5) : c;
}).toFile(path.join(OUT, 'far16.png'));

// mid hills: green rolling hills with a dark tree line along their crests
const MW = 640;
const MH = 224;
await layer(MW, MH, (x, y, d) => {
  const crest = 150 + wave(x, MW, [[2, 16, 0.3], [5, 8, 0.1], [11, 3, 0.7]]);
  const trees = crest - 6 - Math.abs(Math.sin(x * 0.45)) * 7 - (Math.sin(x * 0.11) > 0.2 ? 4 : 0);
  if (y < trees) return null;
  if (y < crest) return d > 0.3 ? [36, 92, 58] : [28, 74, 48];
  const t = (y - crest) / (MH - crest);
  const c = mix3([86, 170, 72], [44, 120, 60], Math.min(1, t * 1.8));
  return t + (d - 0.5) * 0.2 > 0.45 ? mix3(c, [36, 100, 56], 0.6) : c;
}).toFile(path.join(OUT, 'mid16.png'));

// clouds: soft white clouds with blue-grey undersides and dithered edges
const CW = 512;
const CH = 224;
await layer(CW, CH, (x, y, d) => {
  let best = 0;
  let under = 0;
  for (const [cx, cy, rx, ry] of [[60, 50, 70, 18], [250, 34, 90, 22], [400, 70, 60, 14], [470, 40, 50, 12]]) {
    for (const dx of [0, -CW, CW]) {
      const nx = (x - cx - dx) / rx;
      const ny = (y - cy) / ry;
      const bump = 0.18 * Math.sin(nx * 9) ;
      const v = 1 - (nx * nx + ny * ny) + bump;
      if (v > best) {
        best = v;
        under = ny;
      }
    }
  }
  if (best <= 0 || best + (d - 0.5) * 0.35 < 0.05) return null;
  return under > 0.25 ? [196, 214, 238] : [255, 255, 255];
}).toFile(path.join(OUT, 'clouds16.png'));

for (const f of ['tiles16.png', 'far16.png', 'mid16.png', 'clouds16.png']) console.log(f, Math.round(fs.statSync(path.join(OUT, f)).size / 1024), 'KB');
