import { fbm } from './valley';

/**
 * The title screen's set: a composed overlook built only for the main menu, far west of the playable level
 * so play never sees it. Pip stands on a mossy slab at the edge of a meadow; below, a pool fed by a waterfall
 * from layered cliffs; to the right, a ruined terrace with a stone ring. Everything here is in set-local
 * coordinates (add ORIGIN for world space); the camera looks along -z.
 */
export const TITLE = {
  origin: { x: -420, y: 0, z: 0 },
  /** Where Pip stands (on top of the slab), facing a little toward the ruins. */
  pip: { x: -0.35, z: 2.3, heading: 0.55 },
  /** The slab Pip stands on: a flat-topped mossy block, partly sunk into the meadow. */
  slab: { x: -0.2, z: 2.1, top: 1.05, rotY: 0.62, sx: 1.4, sz: 1.3 },
  /** The camera: where it stands and what it looks at (set-local). */
  camera: { pos: { x: -0.1, y: 2.1, z: 7.6 }, look: { x: 3.4, y: 2.9, z: -14 }, fov: 38 },
  /** Sky turned so the low Beyond sun comes from the front left and rakes across the cliffs. */
  skyYaw: 0.75,
  pool: { x: 3, z: -19, rx: 9.5, rz: 8.5 },
  waterY: -0.75,
  /** The waterfall notch in the cliff. */
  fall: { x: 3.2, top: 10.2 },
  terrace: { x0: 6.5, x1: 25, z0: -25, z1: -8, y: 0.85 },
  ring: { x: 9.6, z: -15.2, r: 2.9 },
};

const S = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Ground height of the title set (set-local). */
export function titleHeight(x: number, z: number) {
  const T = TITLE;
  // a gently rolling meadow, falling a little toward the pool
  let h = fbm(x * 0.13 + 7, z * 0.13) * 0.9 - Math.max(0, -z - 4) * 0.025;
  // the hill under the great tree, rising to the left edge of the frame
  h += S(-6, -24, x) * (4.6 + fbm(x * 0.06, z * 0.08 + 3) * 4);
  // the ruined terrace on the right, a natural rise
  const tr = T.terrace;
  const terr = S(tr.x0 - 3, tr.x0, x) * S(tr.z1 + 3, tr.z1, z) * S(tr.z0 - 3, tr.z0, z);
  h = h + (tr.y + fbm(x * 0.3, z * 0.3) * 0.25 - h) * terr;
  // beyond the terrace the ground climbs into wooded slopes on the right
  h += S(24, 40, x) * (5 + fbm(x * 0.05 + 9, z * 0.05) * 5);
  // the pool basin
  const pd = Math.hypot((x - T.pool.x) / T.pool.rx, (z - T.pool.z) / T.pool.rz);
  h = -1.9 + (h + 1.9) * S(0.72, 1.08, pd);
  // the cliffs at the back: layered strata with a notch the waterfall falls through
  const notch = Math.exp(-(((x - T.fall.x) / 2.4) ** 2));
  const top = 15 + fbm(x * 0.05, 1.3) * 7 - notch * 4.8;
  const edge = -30 + fbm(x * 0.09, 4.1) * 5 - notch * 1.5;
  const rise = S(edge, edge - 11, z);
  if (rise > 0) {
    const raw = top * rise;
    // strata: layers ~2.4 units tall with steep risers and narrow treads, so the rock reads as bedded
    // sandstone with ledges (where plants take hold) rather than one sheer face
    const st = 2.4 + fbm(x * 0.03, 9) * 0.6;
    const k = raw / st;
    const strata = (Math.floor(k) + S(0.5, 0.95, k - Math.floor(k))) * st;
    h = Math.max(h, raw * 0.15 + strata * 0.85 + fbm(x * 0.4, z * 0.4) * 0.5 * rise);
  }
  // far uplands behind the cliffs
  h += S(-42, -80, z) * 6;
  return h;
}

/** Rock (0..1) on the steep and layered parts, for the splat weights. */
export function titleRock(x: number, z: number) {
  const e = 0.4;
  const gx = (titleHeight(x + e, z) - titleHeight(x - e, z)) / (2 * e);
  const gz = (titleHeight(x, z + e) - titleHeight(x, z - e)) / (2 * e);
  return S(0.75, 1.5, Math.hypot(gx, gz));
}
