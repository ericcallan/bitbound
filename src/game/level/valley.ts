import { clamp, smoothstep } from '../math';

/**
 * The valley the whole level sits in: one continuous height field, so the 3D world has no edges,
 * no floating slabs and no void below.
 *
 * It is the single source of truth for both sides of the pipeline:
 *  - gameplay: `valleyHeight` is sampled for 3D walking (only inside `VALLEY_COLLIDE`, the slice
 *    built so far: start → Broken Passage gorge);
 *  - art: scripts/terrain/export-valley.ts samples it into a grid that Blender turns into the terrain mesh.
 *
 * On the 2D lane (z in [LANE_BACK, LANE_FRONT]) the height equals the platform tops exactly, so 2D play,
 * the dimension shift and every puzzle behave as before. Pits become one stream gorge that crosses the
 * whole valley, deep enough that falling in still means a respawn.
 */

export const LANE_BACK = -3;
export const LANE_FRONT = 2.5;
export const GORGE_FLOOR = -13;
/** The river: fills the gorges and runs as a shallow stream across the front meadow. Deep water drowns. */
export const WATER_Y = -2.7;

/** Visual extent of the terrain mesh. */
export const VALLEY = { x0: -70, x1: 270, z0: -110, z1: 70, step: 0.5 };
/** Where terrain collision applies (the finished slice). Elsewhere the old box world still rules. */
export const VALLEY_COLLIDE = { x0: -70, x1: 52, z0: -110, z1: 70 };

/** Lane tops along x, from the level's ground pieces (gaps between them are pits). */
const LANE: [number, number, number][] = [
  [-8, 14, 0],
  [17, 40, 1],
  [40, 46.5, 0],
  [52, 62, 0],
  [62, 72, 0], // bridge span (the puzzle rebuilds it); the gorge under it stays
  [72, 100, 0],
  [100, 112, 0],
  [112, 121, 9],
  [126, 133, 9],
  [135.6, 166, 9],
  [166, 184, 10.5],
  [198, 214, 12.5],
  [226, 254, 12.5],
];
/** Pits that become the gorge, inside the finished slice. */
export const GORGES: [number, number][] = [
  [14, 17],
  [46.5, 52],
];

function laneTop(x: number): number | null {
  for (const [a, b, t] of LANE) if (x >= a && x < b) return t;
  return null;
}

/** Smoothed lane height for the hills either side (no hard steps away from the path). */
function laneEnvelope(x: number): number {
  let sum = 0;
  let w = 0;
  for (let d = -6; d <= 6; d += 1) {
    const t = laneTop(x + d) ?? laneTop(x + d - 3) ?? laneTop(x + d + 3) ?? 0;
    const k = 1 - Math.abs(d) / 7;
    sum += t * k;
    w += k;
  }
  return sum / w;
}

// ---------------------------------------------------------------- deterministic value noise

function hash(ix: number, iz: number) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, z: number) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
/** Fractal noise in roughly [-0.5, 0.5]. */
export function fbm(x: number, z: number, octaves = 4) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    v += (vnoise(x * f, z * f) - 0.5) * amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v;
}

const inSlice = (x: number) => x <= VALLEY_COLLIDE.x1;

/** Gorge depth factor at (x, z): 1 at the bottom, 0 on the banks. Banks widen away from the lane. */
function gorge(x: number, z: number) {
  const off = z < LANE_BACK ? LANE_BACK - z : z > LANE_FRONT ? z - LANE_FRONT : 0;
  const widen = smoothstep(0, 8, off) * 2.6 + fbm(x * 0.3, z * 0.3) * 0.8 * smoothstep(0, 4, off);
  let k = 0;
  for (const [a, b] of GORGES) {
    if (!inSlice(a)) continue;
    const da = a - x;
    const db = x - b;
    const outside = Math.max(da, db);
    // Inside the pit (on the lane): a vertical drop. Off the lane the walls lean back into banks.
    const kk = outside <= 0 ? 1 : 1 - smoothstep(0, Math.max(0.001, widen), outside);
    k = Math.max(k, kk);
  }
  return k;
}

/** Terrain height at a world point. */
export function valleyHeight(x: number, z: number): number {
  const lane = laneTop(x);
  const smooth = laneEnvelope(x);
  // Right beside the lane the ground meets the platform top exactly; further out it eases into the hills.
  const off = z < LANE_BACK ? LANE_BACK - z : z > LANE_FRONT ? z - LANE_FRONT : 0;
  const env = lane !== null && inSlice(x) ? lane + (smooth - lane) * smoothstep(0.8, 4, off) : smooth;
  const onLane = z >= LANE_BACK && z <= LANE_FRONT;
  // Behind the start: the valley closes in a hill.
  const westHill = 7 * smoothstep(8, 30, -x) + fbm(x * 0.08, z * 0.08) * 6 * smoothstep(10, 30, -x);
  let h: number;
  if (onLane && lane !== null && inSlice(x)) {
    h = lane;
  } else if (!inSlice(x) && z > -13 && z < 9) {
    // Outside the finished slice, the old platforms stand like mesas on a low valley floor.
    h = -8.6 + fbm(x * 0.15, z * 0.15) * 0.6;
  } else if (z < LANE_BACK) {
    // Behind the path: a meadow that lifts into a forest edge, cliffs, then the far mountains.
    const d = LANE_BACK - z;
    const n = fbm(x * 0.07, z * 0.07);
    const fine = fbm(x * 0.35, z * 0.35);
    h =
      env +
      0.5 * smoothstep(0, 4, d) +
      2.2 * smoothstep(4, 13, d) +
      fine * 0.5 * smoothstep(1, 6, d) +
      // a sheer rock wall: the valley side Pip can't climb
      (10 + n * 8) * smoothstep(15.5, 18.5, d + fbm(x * 0.12, 7) * 2.5) +
      n * 4 * smoothstep(6, 16, d) +
      (16 + fbm(x * 0.02, z * 0.02) * 30) * smoothstep(30, 80, d);
  } else {
    // In front: a meadow sloping down to a stream, then rising far away (always under the 2D camera's view).
    const d = Math.max(0, z - LANE_FRONT);
    const base = inSlice(x) ? env : Math.min(env, 0) - 3;
    const fine = fbm(x * 0.3, z * 0.3);
    h = base - 1.3 * smoothstep(0, 5, d) - 0.5 * smoothstep(5, 11, d) + fine * 0.35 * smoothstep(1, 5, d);
    const stream = 1 - smoothstep(0, 3.2, Math.abs(d - 16 + fbm(x * 0.05, 3) * 6));
    h = h * (1 - stream) + (WATER_Y - 0.5) * stream;
    h += 3 * smoothstep(22, 40, d) + 12 * smoothstep(40, 66, d) + fbm(x * 0.05, z * 0.05) * 5 * smoothstep(30, 60, d);
  }
  h += westHill;
  // The stream gorge that crosses the valley at each pit.
  const g = gorge(x, z);
  if (g > 0) h = h * (1 - g) + (GORGE_FLOOR + fbm(x, z * 0.5) * 0.6) * g;
  return h;
}

/**
 * Material weights for the terrain shader: rock on steep ground and cliffs, worn path on the lane,
 * leaf-litter forest floor behind it, grass elsewhere. Returned as [rock, path, forest] in 0..1;
 * grass is whatever is left.
 */
export function valleySplat(x: number, z: number, slope: number): [number, number, number] {
  const rock = clamp(smoothstep(0.75, 1.35, slope) + smoothstep(-6, -10, valleyHeight(x, z)) * 0.6, 0, 1);
  const onPathBand = 1 - smoothstep(0.6, 1.8, Math.abs(z - (LANE_BACK + LANE_FRONT) / 2 - fbm(x * 0.2, 1) * 0.8) - 0.9);
  const path = clamp(onPathBand * (0.55 + fbm(x * 0.9, z * 0.9) * 0.8), 0, 1) * (1 - rock) * (inSlice(x) ? 1 : 0.5);
  const back = LANE_BACK - z;
  const forest = clamp(smoothstep(5, 9, back) * (1 - smoothstep(14, 18, back)) + fbm(x * 0.2, z * 0.2) * 0.5, 0, 1) * (1 - rock);
  return [rock, path, forest];
}

/** Collision query for 3D walking: null where the terrain doesn't apply (outside the slice). */
export function valleyCollideHeight(x: number, z: number): number | null {
  const c = VALLEY_COLLIDE;
  if (x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) return null;
  return valleyHeight(x, z);
}
