import { dist2D, makeBoxAt, v3, type V3 } from './util';
import type { Collider, World } from '../collision/World';
import type { Level } from '../level/meadows';

export type PassageState = 'broken' | 'assembling' | 'repaired';

/** Seconds from the plate latching to the bridge becoming solid. */
export const ASSEMBLE_TIME = 2.8;

/**
 * The Broken Passage: a cube hidden behind the facade must be pushed onto a pressure plate.
 * The plate latches permanently, so the puzzle can never be undone or soft-locked.
 */
export class BrokenPassage {
  state: PassageState = 'broken';
  t = 0;
  cube: Collider;
  bridge: Collider;
  plateLatched = false;
  /** Visual sink of the plate 0..1. */
  plateDepress = 0;

  constructor(
    private world: World,
    private level: Level,
  ) {
    const h = level.cubeHalf;
    const c = level.cubeStart;
    this.cube = world.add('cube', 'cube', makeBoxAt(c.x, c.y, c.z, h));
    this.bridge = world.get('bridgeMid')!;
  }

  get cubeCenter(): V3 {
    return v3((this.cube.min.x + this.cube.max.x) / 2, this.cube.min.y, (this.cube.min.z + this.cube.max.z) / 2);
  }

  resetCube() {
    if (this.plateLatched) return false;
    const h = this.level.cubeHalf;
    const c = this.level.cubeStart;
    const b = makeBoxAt(c.x, c.y, c.z, h);
    // Never respawn into something (e.g. Pip standing on the spawn spot).
    if (!this.world.isFree(b, this.cube)) return false;
    this.cube.min = b.min;
    this.cube.max = b.max;
    return true;
  }

  /** Restore a solved puzzle from save data. */
  setSolved() {
    const p = this.level.plate;
    const h = this.level.cubeHalf;
    const b = makeBoxAt(p.x, p.y, p.z, h);
    this.cube.min = b.min;
    this.cube.max = b.max;
    this.plateLatched = true;
    this.plateDepress = 1;
    this.state = 'repaired';
    this.t = ASSEMBLE_TIME;
    this.bridge.enabled = true;
  }

  /** Returns an event name when something happens this step. */
  step(dt: number): 'latched' | 'repaired' | null {
    this.cube.delta.x = this.cube.delta.y = this.cube.delta.z = 0;
    const plate = this.level.plate;
    const c = this.cubeCenter;
    const d = dist2D(c.x, c.z, plate.x, plate.z);
    this.plateDepress = Math.min(1, Math.max(0, this.plateDepress + (d < 1.0 || this.plateLatched ? dt * 4 : -dt * 4)));

    if (this.state === 'broken' && d < 0.75) {
      // Snap the cube neatly onto the plate and latch.
      const h = this.level.cubeHalf;
      const b = makeBoxAt(plate.x, plate.y, plate.z, h);
      if (this.world.isFree(b, this.cube) || d < 0.2) {
        this.cube.min = b.min;
        this.cube.max = b.max;
      }
      this.plateLatched = true;
      this.state = 'assembling';
      this.t = 0;
      return 'latched';
    }
    if (this.state === 'assembling') {
      this.t += dt;
      if (this.t >= ASSEMBLE_TIME) {
        this.state = 'repaired';
        this.bridge.enabled = true;
        return 'repaired';
      }
    }
    return null;
  }
}
