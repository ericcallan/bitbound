/**
 * Optimise every raw Blender export (assets/exports/*.glb) into a shippable asset (public/assets/*.glb):
 * prune and dedup, weld, reorder for the GPU cache, quantize + Meshopt-compress geometry, resize textures
 * to a per-asset budget and re-encode them as WebP. Prints source vs optimised sizes.
 *
 *   node scripts/optimize-assets.mjs [name ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, reorder, quantize, meshopt, textureCompress, resample } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'assets', 'exports');
const OUT = path.join(ROOT, 'public', 'assets');

/** Largest texture edge per asset (pixels): sized to how much of the screen the asset ever covers. */
const TEXTURE_BUDGET = { default: 1024, rocks: 512, pip: 1024, tree: 1024, terrain: 2048 };

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.glb') && (only.length === 0 || only.includes(f.replace('.glb', ''))));
const rows = [];
for (const f of files) {
  const name = f.replace('.glb', '');
  const doc = await io.read(path.join(SRC, f));
  const size = TEXTURE_BUDGET[name] ?? TEXTURE_BUDGET.default;
  await doc.transform(
    dedup(),
    prune(),
    resample(),
    weld(),
    reorder({ encoder: MeshoptEncoder }),
    quantize(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 88 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = path.join(OUT, f);
  await io.write(out, doc);
  const a = fs.statSync(path.join(SRC, f)).size;
  const b = fs.statSync(out).size;
  rows.push({ asset: name, sourceKB: Math.round(a / 1024), optimisedKB: Math.round(b / 1024), saved: `${Math.round((1 - b / a) * 100)}%` });
}
console.table(rows);
