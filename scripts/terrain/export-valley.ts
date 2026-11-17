/**
 * Sample the game's valley height field (src/game/level/valley.ts) into a grid for Blender.
 * Extra sample lines sit exactly on every lane edge and gorge wall so drops stay vertical and the
 * walkable surface matches collision exactly.
 *
 *   npx vite-node scripts/terrain/export-valley.ts
 * Writes assets/source-textures/valley_grid.json (consumed by scripts/blender/create_terrain.py).
 */
import fs from 'node:fs';
import path from 'node:path';
import { PADS, TERRAIN_EDGES, VALLEY, valleyHeight, valleySplat } from '../../src/game/level/valley';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUT = path.join(ROOT, 'assets', 'source-textures', 'valley_grid.json');

function axis(a: number, b: number, step: number, fine: [number, number, number][], exact: number[]) {
  const s = new Set<number>();
  for (let v = a; v <= b + 1e-9; ) {
    s.add(+v.toFixed(4));
    const f = fine.find(([x0, x1]) => v >= x0 && v < x1);
    v += f ? f[2] : step;
  }
  for (const e of exact) {
    s.add(+(e - 0.002).toFixed(4));
    s.add(+(e + 0.002).toFixed(4));
  }
  return [...s].filter((v) => v >= a && v <= b).sort((p, q) => p - q);
}

// Fine sampling over the playable valley; coarse in the distance.
const xs = axis(VALLEY.x0, VALLEY.x1, 2, [[-20, 270, 0.5]], [...new Set(TERRAIN_EDGES.x)]);
const zs = axis(VALLEY.z0, VALLEY.z1, 2, [[-24, 34, 0.5], [-40, 40, 1]], [...new Set(TERRAIN_EDGES.z)]);
const nx = xs.length;
const nz = zs.length;
const h = new Float32Array(nx * nz);
// Pads have their own floor meshes: draw the terrain a hair under them so the two never flicker.
const underPad = (x: number, z: number) => PADS.some(([x0, x1, z0, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = valleyHeight(xs[i], zs[j]) - (underPad(xs[i], zs[j]) ? 0.03 : 0);
const splat = new Uint8Array(nx * nz * 3);
for (let j = 0; j < nz; j++)
  for (let i = 0; i < nx; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(nx - 1, i + 1);
    const j0 = Math.max(0, j - 1);
    const j1 = Math.min(nz - 1, j + 1);
    const gx = (h[j * nx + i1] - h[j * nx + i0]) / Math.max(1e-3, xs[i1] - xs[i0]);
    const gz = (h[j1 * nx + i] - h[j0 * nx + i]) / Math.max(1e-3, zs[j1] - zs[j0]);
    const [r, p, f] = valleySplat(xs[i], zs[j], Math.hypot(gx, gz));
    const k = (j * nx + i) * 3;
    splat[k] = Math.round(r * 255);
    splat[k + 1] = Math.round(p * 255);
    splat[k + 2] = Math.round(f * 255);
  }
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(
  OUT,
  JSON.stringify({
    xs,
    zs,
    heights: Buffer.from(h.buffer).toString('base64'),
    splat: Buffer.from(splat.buffer).toString('base64'),
  }),
);
console.log(`valley grid ${nx} x ${nz} = ${nx * nz} vertices → ${path.relative(ROOT, OUT)}`);
