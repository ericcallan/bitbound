import type { V3 } from '../math';
import { v3 } from '../math';

export type Axis = 'x' | 'y' | 'z';

export interface AABB {
  min: V3;
  max: V3;
}

export type ColliderKind = 'ground' | 'wall' | 'cube' | 'platform' | 'bridge' | 'prop' | 'invisible';

export interface Collider extends AABB {
  id: string;
  kind: ColliderKind;
  enabled: boolean;
  /** Movement applied during the current step (moving platforms) so riders can be carried. */
  delta: V3;
  /** Solid only while the world is flat (2D). */
  only2d?: boolean;
  /** Bitmask of generations in which this collider exists (undefined = all). */
  genMask?: number;
}

const EPS = 1e-4;

export const makeBox = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): AABB => ({
  min: v3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)),
  max: v3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)),
});

export function overlaps(a: AABB, b: AABB, eps = EPS): boolean {
  return (
    a.min.x < b.max.x - eps &&
    a.max.x > b.min.x + eps &&
    a.min.y < b.max.y - eps &&
    a.max.y > b.min.y + eps &&
    a.min.z < b.max.z - eps &&
    a.max.z > b.min.z + eps
  );
}

export function shiftBox(b: AABB, axis: Axis, d: number) {
  b.min[axis] += d;
  b.max[axis] += d;
}

/** Slab-based segment vs AABB test, used for camera occlusion. */
export function segmentHitsBox(a: V3, b: V3, box: AABB): boolean {
  let tmin = 0;
  let tmax = 1;
  for (const ax of ['x', 'y', 'z'] as Axis[]) {
    const d = b[ax] - a[ax];
    if (Math.abs(d) < 1e-9) {
      if (a[ax] < box.min[ax] || a[ax] > box.max[ax]) return false;
    } else {
      let t0 = (box.min[ax] - a[ax]) / d;
      let t1 = (box.max[ax] - a[ax]) / d;
      if (t0 > t1) [t0, t1] = [t1, t0];
      tmin = Math.max(tmin, t0);
      tmax = Math.min(tmax, t1);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

/**
 * Kinematic axis-aligned collision world. All solids are AABBs; movement is resolved one
 * axis at a time with swept clamping so bodies can never tunnel or end a step inside a solid.
 */
export class World {
  colliders: Collider[] = [];
  /** True while the perspective is 2D; enables `only2d` colliders (painted steps). */
  flat = true;
  /**
   * Which generation applies to a collider right now (set by the game: base era, censor fields
   * and Pip's Regress bubble). Colliders with a `genMask` only exist in the generations it lists.
   */
  genAt: ((c: Collider) => number) | null = null;
  /** Height-field ground for 3D walking (the valley terrain); null where it doesn't apply. */
  terrain: ((x: number, z: number) => number | null) | null = null;

  /** Highest terrain point under a box's footprint (centre and corners), or null if none. */
  terrainUnder(b: AABB): number | null {
    if (!this.terrain) return null;
    const cx = (b.min.x + b.max.x) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    let best: number | null = null;
    for (const [x, z] of [[cx, cz], [b.min.x, b.min.z], [b.max.x, b.min.z], [b.min.x, b.max.z], [b.max.x, b.max.z]]) {
      const h = this.terrain(x, z);
      if (h !== null && (best === null || h > best)) best = h;
    }
    return best;
  }

  /** Terrain slope (rise over run) at a point. */
  terrainSlope(x: number, z: number): number {
    if (!this.terrain) return 0;
    const e = 0.25;
    const hx0 = this.terrain(x - e, z);
    const hx1 = this.terrain(x + e, z);
    const hz0 = this.terrain(x, z - e);
    const hz1 = this.terrain(x, z + e);
    if (hx0 === null || hx1 === null || hz0 === null || hz1 === null) return 0;
    return Math.hypot((hx1 - hx0) / (2 * e), (hz1 - hz0) / (2 * e));
  }
  /** Testing a hypothetical: override `genAt` while checking whether a bubble change is safe. */
  genOverride: ((c: Collider) => number) | null = null;

  add(id: string, kind: ColliderKind, box: AABB, enabled = true, only2d = false, genMask?: number): Collider {
    const c: Collider = { id, kind, enabled, min: { ...box.min }, max: { ...box.max }, delta: v3(), only2d, genMask };
    this.colliders.push(c);
    return c;
  }

  /** Is this collider solid right now (or, with `flat`, in a given perspective)? */
  active(c: Collider, flat = this.flat) {
    if (!c.enabled || (c.only2d && !flat)) return false;
    if (c.genMask !== undefined) {
      const f = this.genOverride ?? this.genAt;
      if (f && (c.genMask & (1 << f(c))) === 0) return false;
    }
    return true;
  }

  /** First hit along segment a->b as a 0..1 fraction, or null. Used for camera clipping. */
  raycast(a: V3, b: V3, filter?: (c: Collider) => boolean): number | null {
    let best: number | null = null;
    for (const c of this.colliders) {
      if (!this.active(c) || (filter && !filter(c))) continue;
      let tmin = 0;
      let tmax = 1;
      let ok = true;
      for (const ax of ['x', 'y', 'z'] as Axis[]) {
        const d = b[ax] - a[ax];
        if (Math.abs(d) < 1e-9) {
          if (a[ax] < c.min[ax] || a[ax] > c.max[ax]) {
            ok = false;
            break;
          }
        } else {
          let t0 = (c.min[ax] - a[ax]) / d;
          let t1 = (c.max[ax] - a[ax]) / d;
          if (t0 > t1) [t0, t1] = [t1, t0];
          tmin = Math.max(tmin, t0);
          tmax = Math.min(tmax, t1);
          if (tmin > tmax) {
            ok = false;
            break;
          }
        }
      }
      if (ok && tmin > 0 && (best === null || tmin < best)) best = tmin;
    }
    return best;
  }

  get(id: string) {
    return this.colliders.find((c) => c.id === id);
  }

  isFree(box: AABB, exclude?: Collider | null, flat = this.flat): boolean {
    for (const c of this.colliders) {
      if (!this.active(c, flat) || c === exclude) continue;
      if (overlaps(box, c)) return false;
    }
    return true;
  }

  /** Is there a solid surface directly beneath `box` (within `reach`)? */
  groundBelow(box: AABB, reach = 0.12, flat = this.flat): Collider | null {
    const probe = { min: { ...box.min, y: box.min.y - reach }, max: { ...box.max, y: box.min.y + 0.01 } };
    for (const c of this.colliders) {
      if (!this.active(c, flat)) continue;
      if (overlaps(probe, c) && c.max.y <= box.min.y + 0.02) return c;
    }
    return null;
  }

  /**
   * Move `box` along `axis` by `d`, stopping at the first solid. Colliders the box already
   * penetrates on this axis are ignored so a bad state can never fling a body.
   */
  sweep(box: AABB, axis: Axis, d: number, exclude?: Collider | null, ignore?: (c: Collider) => boolean) {
    if (d === 0) return { moved: 0, hit: null as Collider | null };
    let allowed = d;
    let hit: Collider | null = null;
    const o1: Axis = axis === 'x' ? 'y' : 'x';
    const o2: Axis = axis === 'z' ? 'y' : 'z';
    for (const c of this.colliders) {
      if (!this.active(c) || c === exclude) continue;
      if (ignore && ignore(c)) continue;
      if (!(box.min[o1] < c.max[o1] - EPS && box.max[o1] > c.min[o1] + EPS)) continue;
      if (!(box.min[o2] < c.max[o2] - EPS && box.max[o2] > c.min[o2] + EPS)) continue;
      if (d > 0) {
        if (c.min[axis] < box.max[axis] - EPS) continue;
        const gap = c.min[axis] - box.max[axis];
        if (gap < allowed) {
          allowed = Math.max(0, gap);
          hit = c;
        }
      } else {
        if (c.max[axis] > box.min[axis] + EPS) continue;
        const gap = c.max[axis] - box.min[axis];
        if (gap > allowed) {
          allowed = Math.min(0, gap);
          hit = c;
        }
      }
    }
    shiftBox(box, axis, allowed);
    return { moved: allowed, hit };
  }
}
