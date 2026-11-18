/**
 * Pack the painted ground materials (baked by scripts/blender/create_painted_textures.py, in the art bible's
 * palette; no photographs) for the runtime terrain shader:
 *   <set>_albedo.webp  RGB = colour, A = roughness (to assets/source-textures/packed/; scripts/textures/ktx2.mjs
 *                      ships it as KTX2, or copies the WebP into public/ if KTX-Software isn't available)
 *   <set>_normal.webp  RGB = OpenGL tangent-space normal, A = height (displacement, for relief mapping)
 * at 1024px into public/assets/textures/. Run after the Blender bake.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'assets', 'source-textures', 'painted');
const OUT = path.join(ROOT, 'public', 'assets', 'textures');
const PACKED = path.join(ROOT, 'assets', 'source-textures', 'packed');
fs.mkdirSync(PACKED, { recursive: true });
const SIZE = 1024;
/** Runtime name → painted set. */
const SETS = { grass: 'grass', rock: 'rock', path: 'path', forest: 'forest', stone: 'stone', moss: 'moss', bark: 'bark' };

fs.mkdirSync(OUT, { recursive: true });
const rows = [];
for (const [name, set] of Object.entries(SETS)) {
  const dir = path.join(SRC, set);
  const rough = await sharp(path.join(dir, 'rough.png')).resize(SIZE, SIZE).greyscale().raw().toBuffer();
  const albedo = await sharp(path.join(dir, 'diff.png')).resize(SIZE, SIZE).removeAlpha().joinChannel(rough, { raw: { width: SIZE, height: SIZE, channels: 1 } }).webp({ quality: 86, alphaQuality: 90 }).toFile(path.join(PACKED, `${name}_albedo.webp`));
  const height = await sharp(path.join(dir, 'disp.png')).resize(SIZE, SIZE).greyscale().normalise().raw().toBuffer();
  const normal = await sharp(path.join(dir, 'nor_gl.png')).resize(SIZE, SIZE).removeAlpha().joinChannel(height, { raw: { width: SIZE, height: SIZE, channels: 1 } }).webp({ quality: 90, alphaQuality: 85 }).toFile(path.join(OUT, `${name}_normal.webp`));
  rows.push({ name, source: set, albedoKB: Math.round(albedo.size / 1024), normalKB: Math.round(normal.size / 1024) });
}
console.table(rows);
