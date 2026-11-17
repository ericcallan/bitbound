/**
 * Turn the pre-rendered 16-bit sprites (scripts/blender/render_sprites16.py) into a sprite sheet: trim to the
 * drawn pixels, reduce to 24 px per world unit, hard-edged alpha, at most 12 colours per sprite, packed in rows.
 *
 *   node scripts/textures/sprites16.mjs → public/assets/retro/sprites16.png + sprites16.json
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const RAW = path.join(ROOT, 'assets', 'previews', 'sprites16_raw');
const OUT = path.join(ROOT, 'public', 'assets', 'retro');
const SCALE = 8; // raw renders are 8x
const PPU = 24;
const COLOURS = 12;

const meta = JSON.parse(fs.readFileSync(path.join(RAW, 'sprites16_raw.json'), 'utf8'));
const sprites = [];
for (const m of meta) {
  const file = path.join(RAW, `${m.name}.png`);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // trim to the drawn pixels
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[(y * info.width + x) * 4 + 3] > 24) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
  // keep the trim aligned to whole final pixels so the anchor stays exact
  x0 = Math.floor(x0 / SCALE) * SCALE; y0 = Math.floor(y0 / SCALE) * SCALE;
  x1 = Math.min(info.width, Math.ceil((x1 + 1) / SCALE) * SCALE); y1 = Math.min(info.height, Math.ceil((y1 + 1) / SCALE) * SCALE);
  const w = (x1 - x0) / SCALE;
  const h = (y1 - y0) / SCALE;
  const small = await sharp(file).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).modulate({ saturation: 1.35, brightness: 1.06 }).resize(w, h, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer();
  // hard-edged alpha, then a small palette (transparent pixels kept out of the quantiser's way)
  for (let i = 3; i < small.length; i += 4) small[i] = small[i] > 120 ? 255 : 0;
  const png = await sharp(small, { raw: { width: w, height: h, channels: 4 } }).png({ palette: true, colours: COLOURS, dither: 0 }).toBuffer();
  const px = await sharp(png).ensureAlpha().raw().toBuffer();
  for (let i = 3; i < px.length; i += 4) px[i] = px[i] > 120 ? 255 : 0;
  // anchor: the object's origin, in final pixels from the trimmed image's bottom-left
  const rawH = info.height;
  const ox = m.originX * PPU - x0 / SCALE;
  const oy = m.originY * PPU - (rawH - y1) / SCALE;
  sprites.push({ name: m.name, w, h, px, ox, oy });
}

// shelf packing
const SHEET_W = 256;
let x = 0, y = 0, rowH = 0;
for (const s of sprites.sort((a, b) => b.h - a.h)) {
  if (x + s.w > SHEET_W) { x = 0; y += rowH + 1; rowH = 0; }
  s.x = x; s.y = y;
  x += s.w + 1;
  rowH = Math.max(rowH, s.h);
}
const SHEET_H = y + rowH;
const sheet = Buffer.alloc(SHEET_W * SHEET_H * 4);
for (const s of sprites)
  for (let r = 0; r < s.h; r++) s.px.copy(sheet, ((s.y + r) * SHEET_W + s.x) * 4, r * s.w * 4, (r + 1) * s.w * 4);
await sharp(sheet, { raw: { width: SHEET_W, height: SHEET_H, channels: 4 } }).png().toFile(path.join(OUT, 'sprites16.png'));
const json = { ppu: PPU, width: SHEET_W, height: SHEET_H, sprites: Object.fromEntries(sprites.map((s) => [s.name, { x: s.x, y: s.y, w: s.w, h: s.h, ox: +s.ox.toFixed(2), oy: +s.oy.toFixed(2) }])) };
fs.writeFileSync(path.join(OUT, 'sprites16.json'), JSON.stringify(json, null, 1));
console.log(`sprites16.png ${SHEET_W}x${SHEET_H}, ${sprites.length} sprites, ${Math.round(fs.statSync(path.join(OUT, 'sprites16.png')).size / 1024)} KB`);
for (const s of sprites) console.log(' ', s.name, `${s.w}x${s.h}`);
