/**
 * The 16-bit generation's art: the painted ground materials (scripts/blender/create_painted_textures.py), reduced
 * the way a mid-90s artist would, onto the art bible's 4-step ramps (shadows lean cobalt, light leans amber).
 *
 *   public/assets/retro/tiles16.png      24×24 tiles (grass top, earth, stone), each pixel one step of its ramp
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
const SRC = path.join(ROOT, 'assets', 'source-textures', 'painted');
const OUT = path.join(ROOT, 'public', 'assets', 'retro');
fs.mkdirSync(OUT, { recursive: true });
const T = 24;

/** A source texture as a T×T RGB patch, downscaled with a box filter (crisp, like a period artist's reduction). */
async function patch(set, scale = 0.16, tint = [1, 1, 1], sat = 1.0, turn = 0) {
  const img = sharp(path.join(SRC, set, 'diff.png')).rotate(turn);
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

// --- the bible's ramps (docs/ART_BIBLE.md §3): from a base colour, shadows toward cobalt and light toward amber
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mixRGB = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const COBALT = hexRGB('#24324f');
const HONEY = hexRGB('#f2c978');
const ramp = (base, n = 4) =>
  Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return t < 0.5 ? mixRGB(COBALT, hexRGB(base), 0.45 + t * 1.1) : mixRGB(hexRGB(base), HONEY, (t - 0.5) * 0.7);
  });
const BAYER2 = [0, 2, 3, 1].map((v) => (v + 0.5) / 4);
const set = (buf, i, c) => ((buf[i * 4] = c[0]), (buf[i * 4 + 1] = c[1]), (buf[i * 4 + 2] = c[2]));

/**
 * Map a patch onto a ramp by its fine detail (brightness minus a wrapped local average, so a tile repeats as an
 * even tone with texture rather than as a blob), `contrast` scaling the spread, with a light 2×2 dither.
 */
function toRamp(rgb, steps, contrast = 1) {
  const raw = [];
  for (let i = 0; i < rgb.length; i += 3) raw.push(rgb[i] * 0.3 + rgb[i + 1] * 0.59 + rgb[i + 2] * 0.11);
  const R = 4;
  const lum = raw.map((_, i) => {
    const x = i % T;
    const y = Math.floor(i / T);
    let sum = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) sum += raw[((y + dy + T) % T) * T + ((x + dx + T) % T)];
    return raw[i] - sum / (2 * R + 1) ** 2;
  });
  const sorted = [...lum].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.04)];
  const hi = sorted[Math.floor(sorted.length * 0.96)];
  const med = sorted[Math.floor(sorted.length * 0.5)];
  const out = Buffer.alloc((rgb.length / 3) * 4);
  lum.forEach((l, i) => {
    const x = i % T;
    const y = Math.floor(i / T);
    const t = Math.max(0, Math.min(0.999, 0.55 + ((l - med) / Math.max(1, hi - lo)) * contrast + (BAYER2[(y % 2) * 2 + (x % 2)] - 0.5) * 0.18));
    const c = steps[Math.floor(t * steps.length)];
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = 255;
  });
  return out;
}

// --- tiles: [grassTop | earth | stone] in a 72×24 strip
const grass = await patch('grass', 0.12);
const stone = await patch('stone', 0.24);
const GRASS = ramp('#5e7f45');
const EARTH = ramp('#a77b4f');
const STONE = ramp('#d9c7a3');
// Soil is drawn the way a 16-bit artist would: an even mid tone, soft darker clusters (tileable noise), a few
// pebbles with a shadow pixel under them, all on the earth ramp.
const earthT = (() => {
  const out = Buffer.alloc(T * T * 4);
  const h = (x, y, k) => {
    const v = Math.sin((x * 127.1 + y * 311.7 + k * 74.7) * 0.0174533 * 57.3) * 43758.5453;
    return v - Math.floor(v);
  };
  // periodic value noise on the 24-pixel torus (cells of 6)
  const noise = (x, y) => {
    const C = 6;
    const n = T / C;
    const gx = x / C;
    const gy = y / C;
    const i = Math.floor(gx);
    const j = Math.floor(gy);
    const fx = gx - i;
    const fy = gy - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const g = (a, b) => h(((a % n) + n) % n, ((b % n) + n) % n, 1);
    return g(i, j) * (1 - sx) * (1 - sy) + g(i + 1, j) * sx * (1 - sy) + g(i, j + 1) * (1 - sx) * sy + g(i + 1, j + 1) * sx * sy;
  };
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const n = noise(x, y) + (BAYER2[(y % 2) * 2 + (x % 2)] - 0.5) * 0.12;
      set(out, y * T + x, n < 0.2 ? EARTH[0] : n < 0.42 ? EARTH[1] : EARTH[2]);
      out[(y * T + x) * 4 + 3] = 255;
    }
  for (let k = 0; k < 7; k++) {
    const px = Math.floor(h(k, 3, 9) * T);
    const py = Math.floor(h(k, 7, 2) * (T - 1));
    set(out, py * T + px, EARTH[3]);
    set(out, ((py + 1) % T) * T + px, EARTH[0]);
  }
  return out;
})();
const grassT = toRamp(grass, GRASS);
const grassTop = Buffer.from(earthT);
for (let y = 0; y < T; y++) {
  for (let x = 0; x < T; x++) {
    // a grass mat over the soil, with tufts hanging down, a bright lip and a shadow line under it
    const edge = 7 + Math.round(Math.sin(x * 1.3) * 1.5 + ((x * 7) % 5 === 0 ? 2 : 0));
    const i = y * T + x;
    if (y < edge) set(grassTop, i, [grassT[i * 4], grassT[i * 4 + 1], grassT[i * 4 + 2]]);
    if (y < 2) set(grassTop, i, GRASS[3]);
    if (y === edge || y === edge + 1) set(grassTop, i, EARTH[0]);
  }
}
const strip = Buffer.alloc(T * 3 * T * 4);
for (const [k, q] of [grassTop, earthT, toRamp(stone, STONE, 0.45)].entries()) {
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

// far mountains: lavender ranges with snow caps, lit from the left (the bible's atmospheric distance)
const FW = 768;
const FH = 224;
await layer(FW, FH, (x, y, d) => {
  const ridge = 120 + wave(x, FW, [[3, 22, 0.1], [7, 9, 0.6], [13, 4, 0.3]]);
  if (y < ridge) return null;
  const depth = (y - ridge) / (FH - ridge);
  const slope = wave(x + 1, FW, [[3, 22, 0.1], [7, 9, 0.6], [13, 4, 0.3]]) - wave(x - 1, FW, [[3, 22, 0.1], [7, 9, 0.6], [13, 4, 0.3]]);
  let c = mix3([170, 162, 206], [126, 118, 172], Math.min(1, depth * 1.6));
  // faces turned toward the light (rising to the right) catch it, smoothly, quantised to two bands by the dither
  const lit = Math.max(0, Math.min(1, 0.5 + slope * 0.9 + (d - 0.5) * 0.4)) * (1 - depth);
  if (lit > 0.55) c = mix3(c, [212, 204, 232], 0.55);
  if (y < ridge + 9 + Math.sin(x * 0.2) * 3 && depth + d * 0.05 < 0.12) c = [246, 240, 228]; // snow, warm
  return depth + (d - 0.5) * 0.15 > 0.55 ? mix3(c, [104, 98, 150], 0.5) : c;
}).toFile(path.join(OUT, 'far16.png'));

// mid hills: sage rolling hills with a moss-dark tree line along their crests
const MW = 640;
const MH = 224;
await layer(MW, MH, (x, y, d) => {
  const crest = 150 + wave(x, MW, [[2, 16, 0.3], [5, 8, 0.1], [11, 3, 0.7]]);
  const trees = crest - 6 - Math.abs(Math.sin(x * 0.45)) * 7 - (Math.sin(x * 0.11) > 0.2 ? 4 : 0);
  if (y < trees) return null;
  if (y < crest) return d > 0.3 ? [62, 91, 58] : [47, 72, 50];
  const t = (y - crest) / (MH - crest);
  const c = mix3([150, 176, 108], [94, 127, 69], Math.min(1, t * 1.8));
  return t + (d - 0.5) * 0.2 > 0.45 ? mix3(c, [70, 102, 60], 0.6) : c;
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
