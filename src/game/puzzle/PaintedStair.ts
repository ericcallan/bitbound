import { dist2D, makeBoxAt, v3, type V3 } from './util';
import type { Collider, World } from '../collision/World';
import { STAIR, type Level } from '../level/meadows';

export type StairState = 'faded' | 'painting' | 'complete';

/** Seconds from the lamp docking to the repainted steps becoming solid. */
export const PAINT_TIME = 2.6;

/**
 * The Painted Stair: a mural staircase whose steps are solid only when the world is flat.
 * Two steps are faded; pushing the lamp into its socket (in 3D) shines a beam that repaints
 * them. The socket latches permanently, so the puzzle can never regress.
 */
export class PaintedStair {
  state: StairState = 'faded';
  t = 0;
  lamp: Collider;
  latched = false;
  socketGlow = 0;
  private missing: Collider[];

  constructor(
    private world: World,
    private level: Level,
  ) {
    const s = level.lampStart;
    this.lamp = world.add('lamp', 'cube', makeBoxAt(s.x, s.y, s.z, level.lampHalf));
    this.missing = STAIR.missing.map((i) => world.get(`stair${i}`)!);
  }

  get lampCenter(): V3 {
    return v3((this.lamp.min.x + this.lamp.max.x) / 2, this.lamp.min.y, (this.lamp.min.z + this.lamp.max.z) / 2);
  }

  /** 0..1 progress of the repaint for visuals. */
  get paint() {
    if (this.state === 'complete') return 1;
    if (this.state === 'painting') return Math.min(1, this.t / PAINT_TIME);
    return 0;
  }

  resetLamp() {
    if (this.latched) return false;
    const s = this.level.lampStart;
    const b = makeBoxAt(s.x, s.y, s.z, this.level.lampHalf);
    if (!this.world.isFree(b, this.lamp)) return false;
    this.lamp.min = b.min;
    this.lamp.max = b.max;
    return true;
  }

  setSolved() {
    const k = this.level.lampSocket;
    const b = makeBoxAt(k.x, k.y, k.z, this.level.lampHalf);
    this.lamp.min = b.min;
    this.lamp.max = b.max;
    this.latched = true;
    this.socketGlow = 1;
    this.state = 'complete';
    this.t = PAINT_TIME;
    for (const c of this.missing) c.enabled = true;
  }

  step(dt: number): 'latched' | 'complete' | null {
    this.lamp.delta.x = this.lamp.delta.y = this.lamp.delta.z = 0;
    const k = this.level.lampSocket;
    const c = this.lampCenter;
    const d = dist2D(c.x, c.z, k.x, k.z);
    this.socketGlow = Math.min(1, Math.max(0, this.socketGlow + (d < 1.2 || this.latched ? dt * 3 : -dt * 3)));
    if (this.state === 'faded' && d < 0.75) {
      const b = makeBoxAt(k.x, k.y, k.z, this.level.lampHalf);
      if (this.world.isFree(b, this.lamp) || d < 0.2) {
        this.lamp.min = b.min;
        this.lamp.max = b.max;
      }
      this.latched = true;
      this.state = 'painting';
      this.t = 0;
      return 'latched';
    }
    if (this.state === 'painting') {
      this.t += dt;
      if (this.t >= PAINT_TIME) {
        this.state = 'complete';
        for (const m of this.missing) m.enabled = true;
        return 'complete';
      }
    }
    return null;
  }
}
