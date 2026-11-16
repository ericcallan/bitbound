import * as THREE from 'three';
import type { Era } from '../era/EraSystem';
import { clamp, easeOutBack } from '../math';

type EraAt = (p: THREE.Vector3) => Era;

/** A set of generations, as a bitmask built with `eras()`. */
export type EraMask = number;

/** eras(0) · eras(1, 5) for a range · eras(1, 5, [2]) for a range with exceptions. */
export const eras = (min: Era, max: Era = min, except: Era[] = []): EraMask => {
  let m = 0;
  for (let e = min; e <= max; e++) if (!except.includes(e as Era)) m |= 1 << e;
  return m;
};
export const ALL_ERAS = eras(0, 5);

interface Entry {
  obj: THREE.Object3D;
  anchor: THREE.Vector3;
  mask: EraMask;
  grow: boolean;
  s: number;
  base: THREE.Vector3;
}

/**
 * Objects that only exist in some generations. When the era ripple passes their anchor,
 * they swap (pixel tree -> low-poly -> painted) or grow in with a little bounce.
 */
export class EraSwapRegistry {
  private entries: Entry[] = [];

  add(obj: THREE.Object3D, mask: EraMask, grow = true, anchor?: THREE.Vector3) {
    const a = anchor ?? obj.getWorldPosition(new THREE.Vector3());
    this.entries.push({ obj, anchor: a.clone(), mask, grow, s: -1, base: obj.scale.clone() });
    return obj;
  }

  /** Convenience: one child per generation set. */
  variants(parent: THREE.Object3D, list: [THREE.Object3D, EraMask][], anchor: THREE.Vector3, grow = true) {
    for (const [o, mask] of list) {
      parent.add(o);
      this.add(o, mask, grow, anchor);
    }
  }

  update(eraAt: EraAt, dt: number, instant = false) {
    for (const e of this.entries) {
      const era = eraAt(e.anchor);
      const on = (e.mask & (1 << era)) !== 0;
      if (!e.grow || instant || e.s < 0) {
        e.s = on ? 1 : 0;
      } else {
        e.s = clamp(e.s + (on ? dt * 2.2 : -dt * 6), 0, 1);
      }
      const k = e.grow ? (on ? easeOutBack(e.s, 2) : e.s) : e.s;
      e.obj.visible = e.s > 0.001;
      if (e.grow) e.obj.scale.set(e.base.x * k, e.base.y * k, e.base.z * k);
    }
  }
}
