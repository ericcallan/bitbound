/**
 * Pack the scanned Poly Haven ground materials for the runtime terrain shader:
 *   <set>_albedo.webp  RGB = colour, A = roughness
 *   <set>_normal.webp  RGB = OpenGL tangent-space normal, A = height (displacement, for relief mapping)
 * at 1024px into public/assets/textures/. Run after scripts/fetch_polyhaven.py.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'assets', 'source-textures', 'polyhaven');
const OUT = path.join(ROOT, 'public', 'assets', 'textures');
const SIZE = 1024;
/** Runtime name → Poly Haven set. */
const SETS = { grass: 'leafy_grass', rock: 'rock_face_03', path: 'dirt_floor', forest: 'forest_leaves_02', stone: 'rough_block_wall', moss: 'mossy_rock', bark: 'bark_brown_02' };

fs.mkdirSync(OUT, { recursive: true });
const rows = [];
for (const [name, set] of Object.entries(SETS)) {
  const dir = path.join(SRC, set);
  const rough = await sharp(path.join(dir, 'rough.jpg')).resize(SIZE, SIZE).greyscale().raw().toBuffer();
  const albedo = await sharp(path.join(dir, 'diff.jpg')).resize(SIZE, SIZE).removeAlpha().joinChannel(rough, { raw: { width: SIZE, height: SIZE, channels: 1 } }).webp({ quality: 86, alphaQuality: 90 }).toFile(path.join(OUT, `${name}_albedo.webp`));
  const height = await sharp(path.join(dir, 'disp.jpg')).resize(SIZE, SIZE).greyscale().normalise().raw().toBuffer();
  const normal = await sharp(path.join(dir, 'nor_gl.jpg')).resize(SIZE, SIZE).removeAlpha().joinChannel(height, { raw: { width: SIZE, height: SIZE, channels: 1 } }).webp({ quality: 90, alphaQuality: 85 }).toFile(path.join(OUT, `${name}_normal.webp`));
  rows.push({ name, source: set, albedoKB: Math.round(albedo.size / 1024), normalKB: Math.round(normal.size / 1024) });
}
console.table(rows);
