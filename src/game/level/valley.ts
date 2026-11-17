import { clamp, smoothstep } from '../math';

/**
 * The valley the whole level sits in: one continuous height field, so the 3D world has no edges,
 * no floating slabs and no void below.
 *
 * It is the single source of truth for both sides of the pipeline:
 *  - gameplay: `valleyHeight` is sampled for 3D walking (`valleyCollideHeight`);
 *  - art: scripts/terrain/export-valley.ts samples it into a grid that Blender turns into the terrain mesh.
 *
 * On the 2D lane the height equals the platform tops exactly, so 2D play, the dimension shift and every
 * puzzle behave as before. Off the lane the ground keeps each section's exact height, so every rise in the
 * level (ground → plateau → Halo Path → Seal) is a sheer rock face across the valley, never a slope to walk
 * around a puzzle. Pits are one stream gorge each, crossing the whole valley. Each gate (light fences,
 * brambles, the Stalled Gate) is set into a rock ridge behind the path; in front of it the gate's own side wall
 * (meadows.ts `gateFlank`) runs out across the meadow, so nothing rises between the 2D camera and the gate.
 */

export const LANE_BACK = -3;
export const LANE_FRONT = 2.5;
export const GORGE_FLOOR = -13;
/** The river: fills the gorges and runs as a shallow stream across the front meadow. Deep water drowns. */
export const WATER_Y = -2.7;

/** Visual extent of the terrain mesh. */
export const VALLEY = { x0: -70, x1: 290, z0: -110, z1: 70, step: 0.5 };
/** Where terrain collision applies: the whole valley. */
export const VALLEY_COLLIDE = { x0: -70, x1: 290, z0: -110, z1: 70 };

/** Lane sections: [x0, x1, top, front edge]. Gaps between them are pits. */
const LANE: [number, number, number, number][] = [
  [-8, 14, 0, LANE_FRONT],
  [17, 40, 1, LANE_FRONT],
  [40, 46.5, 0, LANE_FRONT],
  [52, 62, 0, LANE_FRONT],
  [72, 100, 0, LANE_FRONT],
  // the Painted Stair: the ground widens into the lamp alcove in front
  [100, 112, 0, 9.2],
  [112, 121, 9, LANE_FRONT],
  [126, 133, 9, LANE_FRONT],
  [135.6, 166, 9, LANE_FRONT],
  [166, 184, 10.5, LANE_FRONT],
  [198, 214, 12.5, LANE_FRONT],
  [226, 254, 12.5, LANE_FRONT],
];
/** Every pit, as a gorge across the valley. */
export const GORGES: [number, number][] = [
  [14, 17],
  [46.5, 52],
  [62, 72],
  [121, 126],
  [133, 135.6],
  [184, 198],
  [214, 226],
];
/** Flat areas off the lane with exact heights: [x0, x1, z0, z1, height]. */
export const PADS: [number, number, number, number, number][] = [
  // the hidden chamber floor (it has its own stone floor mesh; the terrain mesh is drawn just under it)
  [51.6, 62, -12, -3, 0],
];
/** Gates on the lane: behind each, the terrain rises into a rock ridge across the valley. */
export const GATES: [number, number][] = [
  [117.4, 117.8], // light fence
  [160, 160.4], // second light fence
  [175, 176.6], // brambles
  [212.6, 213.4], // the Stalled Gate
];
/** How far each gate's ridge spreads along the path either side (a broad spur, not a fin); the Stalled Gate's
 * stays narrow, since the canyon starts just past it. */
const GATE_SPREAD = [3.2, 3.2, 3.2, 1.4];
const GATE_RISE = 5;

/** Every x where the ground changes abruptly (section ends, gorge walls, pads, gates) and every z likewise:
 * the terrain grid samples exactly on both sides of each, so drops stay vertical. */
export const TERRAIN_EDGES = {
  x: [...LANE.flatMap((l) => [l[0], l[1]]), ...GORGES.flat(), ...PADS.flatMap((p) => [p[0], p[1]]), ...GATES.flat()],
  z: [LANE_BACK, LANE_FRONT, ...LANE.map((l) => l[3]), ...PADS.flatMap((p) => [p[2], p[3]])],
};

function laneAt(x: number) {
  for (const l of LANE) if (x >= l[0] && x < l[1]) return l;
  return null;
}

/** Height of the nearest lane section (for points between or beyond sections). */
function nearestTop(x: number): number {
  let best = LANE[0];
  let bd = Infinity;
  for (const l of LANE) {
    const d = x < l[0] ? l[0] - x : x > l[1] ? x - l[1] : 0;
    if (d < bd) {
      bd = d;
      best = l;
    }
  }
  return best[2];
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

/** Gorge depth factor at (x, z): 1 at the bottom, 0 on the banks. Banks widen away from the lane. */
function gorge(x: number, z: number) {
  const off = z < LANE_BACK ? LANE_BACK - z : z > LANE_FRONT ? z - LANE_FRONT : 0;
  const widen = smoothstep(0, 8, off) * 2.6 + fbm(x * 0.3, z * 0.3) * 0.8 * smoothstep(0, 4, off);
  let k = 0;
  for (const [a, b] of GORGES) {
    const outside = Math.max(a - x, x - b);
    // Inside the pit: a vertical drop. Off the lane the walls lean back into banks.
    const kk = outside <= 0 ? 1 : 1 - smoothstep(0, Math.max(0.001, widen), outside);
    k = Math.max(k, kk);
  }
  return k;
}

/** 1 on a gate's x-span, easing to 0 just beyond it. */
function gate(x: number) {
  let k = 0;
  // full height across the spur, then a steep drop at its edge (never a slope you could walk over)
  GATES.forEach(([a, b], i) => (k = Math.max(k, 1 - smoothstep(GATE_SPREAD[i] - 1.1, GATE_SPREAD[i], Math.max(a - x, x - b, 0)))));
  return k;
}

/** Terrain height at a world point. */
export function valleyHeight(x: number, z: number): number {
  const lane = laneAt(x);
  const top = lane ? lane[2] : nearestTop(x);
  const front = lane ? lane[3] : LANE_FRONT;
  const off = z < LANE_BACK ? LANE_BACK - z : z > front ? z - front : 0;
  const onLane = lane !== null && off === 0;
  // The valley closes in hills at both ends.
  const westHill = 7 * smoothstep(8, 30, -x) + fbm(x * 0.08, z * 0.08) * 6 * smoothstep(10, 30, -x);
  const eastHill = 7 * smoothstep(262, 284, x) + fbm(x * 0.08, z * 0.08 + 9) * 6 * smoothstep(264, 284, x);
  let h: number;
  if (onLane) {
    h = top;
  } else if (z < LANE_BACK) {
    // Behind the path: a meadow that lifts into a forest edge, cliffs, then the far mountains.
    const d = LANE_BACK - z;
    const n = fbm(x * 0.07, z * 0.07);
    const fine = fbm(x * 0.35, z * 0.35);
    // Where Pip wakes the valley opens out: the wall stands far back behind rolling meadow hills.
    const open = 1 - smoothstep(20, 34, x);
    const wallAt = 15.5 + open * 40;
    // in the open meadow the wall is lower but sheerer (still far too steep to climb)
    const wallH = (10 + n * 8) * (1 - 0.5 * open);
    const wallW = 3 - 1.5 * open;
    h =
      top +
      0.5 * smoothstep(0, 4, d) +
      2.2 * smoothstep(4, 13, d) +
      fine * 0.5 * smoothstep(1, 6, d) +
      open * (1.6 + n * 3) * smoothstep(14, 30, d) +
      // a sheer rock wall: the valley side Pip can't climb
      wallH * smoothstep(wallAt, wallAt + wallW, d + fbm(x * 0.12, 7) * 2.5 * (1 - open * 0.7)) +
      n * 4 * smoothstep(6, 16, d) +
      // far mountains, kept low behind the opening meadow so it looks out over rolling hills
      (16 + fbm(x * 0.02, z * 0.02) * 30) * smoothstep(30 + open * 18, 80, d) * (1 - 0.7 * (1 - smoothstep(20, 46, x)));
  } else {
    // In front: a meadow sloping down to a stream, then rising to a rock band and far hills. Raised sections
    // end in a sheer drop to the stream, so the stream is never a way round.
    const d = z - front;
    const fine = fbm(x * 0.3, z * 0.3);
    const streamY = WATER_Y - 0.5;
    h = top - 1.3 * smoothstep(0, 5, d) - 0.5 * smoothstep(5, 11, d) + fine * 0.35 * smoothstep(1, 5, d);
    if (top > 1.5) h = h + (streamY - h) * smoothstep(5.5, 7, d);
    const stream = 1 - smoothstep(0, 3.2, Math.abs(d - 16 + fbm(x * 0.05, 3) * 6));
    h = h * (1 - stream) + streamY * stream;
    h += 3 * smoothstep(22, 40, d) + 12 * smoothstep(40, 66, d) + fbm(x * 0.05, z * 0.05) * 5 * smoothstep(30, 60, d);
    // the valley's front edge: a rock band
    h = Math.max(h, streamY + (9 + fbm(x * 0.1, 5) * 4) * smoothstep(27, 30, d + fbm(x * 0.15, 2) * 2));
  }
  h += westHill + eastHill;
  // The stream gorge that crosses the valley at each pit.
  const g = gorge(x, z);
  if (g > 0) h = h * (1 - g) + (GORGE_FLOOR + fbm(x, z * 0.5) * 0.6) * g;
  // Gates sit in rock ridges across the valley behind the path (never on the lane, never in front of it).
  const gk = z < LANE_BACK ? gate(x) * smoothstep(0, 0.45, off) : 0;
  if (gk > 0) h = Math.max(h, h + (top + GATE_RISE + fbm(x * 0.6, z * 0.2) * 1.5 - h) * gk);
  for (const [x0, x1, z0, z1, ph] of PADS) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return ph;
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
  const path = clamp(onPathBand * (0.55 + fbm(x * 0.9, z * 0.9) * 0.8), 0, 1) * (1 - rock);
  const back = LANE_BACK - z;
  const forest = clamp(smoothstep(5, 9, back) * (1 - smoothstep(14, 18, back)) + fbm(x * 0.2, z * 0.2) * 0.5, 0, 1) * (1 - rock);
  return [rock, path, forest];
}

/** Collision query for 3D walking: null outside the valley. */
export function valleyCollideHeight(x: number, z: number): number | null {
  const c = VALLEY_COLLIDE;
  if (x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) return null;
  return valleyHeight(x, z);
}
