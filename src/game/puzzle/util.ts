import { makeBox, type AABB } from '../collision/World';

export { dist2D, v3 } from '../math';
export type { V3 } from '../math';

/** Cube-shaped AABB sitting on y with its footprint centred at (x, z). */
export const makeBoxAt = (x: number, y: number, z: number, h: number): AABB =>
  makeBox(x - h, y, z - h, x + h, y + h * 2, z + h);
