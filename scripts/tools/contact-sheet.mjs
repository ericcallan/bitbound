/**
 * Tile images into a 2-column contact sheet (look-dev reviews, before/after comparisons).
 *   node scripts/tools/contact-sheet.mjs out.png a.png b.png ...
 */
import sharp from 'sharp';

const [out, ...ins] = process.argv.slice(2);
const metas = await Promise.all(ins.map((f) => sharp(f).metadata()));
const w = Math.max(...metas.map((m) => m.width));
const h = Math.max(...metas.map((m) => m.height));
const cols = Math.min(2, ins.length);
const rows = Math.ceil(ins.length / cols);
await sharp({ create: { width: w * cols, height: h * rows, channels: 3, background: '#222' } })
  .composite(ins.map((f, i) => ({ input: f, left: (i % cols) * w, top: Math.floor(i / cols) * h })))
  .png()
  .toFile(out);
