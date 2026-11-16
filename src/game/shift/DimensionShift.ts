import { LANE_TOLERANCE, SHIFT_DURATION } from '../sim/constants';
import { easeInOutCubic, v3 } from '../math';
import type { PlayerController } from '../player/PlayerController';
import type { World } from '../collision/World';

export type Perspective = '2d' | '3d';
export type ShiftBlock = 'locked' | 'airborne' | 'off-lane' | 'obstructed' | 'no-ground' | 'painted' | 'busy';

export interface ShiftTransition {
  to: Perspective;
  t: number;
  dur: number;
  fromZ: number;
  toZ: number;
}

/** A plane Pip can flatten onto: depth `z`, valid for x in [x0, x1]. */
export interface Lane {
  x0: number;
  x1: number;
  z: number;
}

/**
 * Owns the perspective state machine. Pip is frozen for the length of a transition, so the
 * camera move can never drop him or push him into geometry; the only positional change is
 * the deterministic ease of depth back to the lane when returning to 2D.
 */
export class DimensionShift {
  mode: Perspective = '2d';
  unlocked = false;
  transition: ShiftTransition | null = null;
  /** 0 = side-on 2D, 1 = third-person 3D. Drives camera and depth reveal. */
  blend = 0;
  /** Authored flattening planes; the meadow is one long lane at z = 0. */
  lanes: Lane[] = [{ x0: -Infinity, x1: Infinity, z: 0 }];
  /** Depth of the lane Pip is flattened onto (or last flattened onto). */
  laneZ = 0;

  /** The lane Pip could flatten onto from where he stands, if any. */
  laneAt(x: number, z: number): Lane | null {
    let best: Lane | null = null;
    for (const l of this.lanes) {
      if (x < l.x0 || x > l.x1) continue;
      if (!best || Math.abs(z - l.z) < Math.abs(z - best.z)) best = l;
    }
    return best;
  }

  constructor(
    private world: World,
    private player: PlayerController,
  ) {}

  get busy() {
    return this.transition !== null;
  }

  /** Why a shift would be refused right now, or null if it is allowed. */
  check(): ShiftBlock | null {
    if (this.transition) return 'busy';
    if (!this.unlocked) return 'locked';
    const p = this.player;
    if (!p.grounded) return 'airborne';
    if (this.mode === '2d') {
      // Painted steps only exist in 2D; unfolding here would drop Pip through them.
      if (p.ground?.only2d) return 'painted';
    } else {
      const lane = this.laneAt(p.pos.x, p.pos.z);
      if (!lane || Math.abs(p.pos.z - lane.z) > LANE_TOLERANCE) return 'off-lane';
      const target = v3(p.pos.x, p.pos.y, lane.z);
      const box = p.box(target);
      // Validate against the flat world we are about to enter (painted steps included).
      if (!this.world.isFree(box, null, true)) return 'obstructed';
      if (!this.world.groundBelow(box, 0.1, true)) return 'no-ground';
    }
    return null;
  }

  begin(): ShiftBlock | null {
    const block = this.check();
    if (block) return block;
    const to: Perspective = this.mode === '2d' ? '3d' : '2d';
    const lane = to === '2d' ? this.laneAt(this.player.pos.x, this.player.pos.z) : null;
    const toZ = lane ? lane.z : this.player.pos.z;
    if (to === '2d') this.laneZ = toZ;
    this.transition = { to, t: 0, dur: SHIFT_DURATION, fromZ: this.player.pos.z, toZ };
    const p = this.player;
    p.vel.x = p.vel.y = p.vel.z = 0;
    return null;
  }

  /** Snap without animation (respawn, loading a save). */
  set(mode: Perspective) {
    this.mode = mode;
    this.transition = null;
    this.blend = mode === '3d' ? 1 : 0;
    this.world.flat = mode === '2d';
  }

  /** Returns 'done' on the step the transition completes. */
  step(dt: number): 'done' | null {
    const tr = this.transition;
    if (!tr) return null;
    tr.t = Math.min(tr.dur, tr.t + dt);
    const k = easeInOutCubic(tr.t / tr.dur);
    this.blend = tr.to === '3d' ? k : 1 - k;
    if (tr.to === '2d') {
      // Ease depth onto the lane; the destination was validated as free before we started.
      this.player.pos.z = tr.fromZ + (tr.toZ - tr.fromZ) * k;
      this.player.prevPos.z = this.player.pos.z;
    }
    if (tr.t >= tr.dur) {
      this.mode = tr.to;
      this.world.flat = tr.to === '2d';
      if (tr.to === '2d') this.player.pos.z = tr.toZ;
      this.transition = null;
      return 'done';
    }
    return null;
  }
}
