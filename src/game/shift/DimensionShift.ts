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
  /** Flattening may slide Pip a little along the lane to the nearest free spot (see SAFE_SLIDE). */
  fromX: number;
  toX: number;
}

/**
 * How far flattening back to 2D may slide Pip along the lane to find room (a wall or a post at the exact spot).
 * Small enough that it reads as settling into place, never as a teleport; never across a gap or through a wall.
 */
export const SAFE_SLIDE = 0.9;
/** How far along the lane a refused unfold looks for solid ground to point the player at. */
const HINT_RANGE = 24;

/** Short reasons for the HUD chip. */
export const SHIFT_BLOCK_LABEL: Record<ShiftBlock, string> = {
  locked: 'Core dormant',
  airborne: 'Land first',
  'off-lane': 'Off the lane',
  obstructed: 'Lane blocked',
  'no-ground': 'No ground on lane',
  painted: "Can't unfold here",
  busy: 'Shifting…',
};

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

  /** Where flattening would put Pip (x on the lane), from the last check in 3D. */
  private destX = 0;

  /** Why a shift would be refused right now, or null if it is allowed. */
  check(): ShiftBlock | null {
    if (this.transition) return 'busy';
    if (!this.unlocked) return 'locked';
    const p = this.player;
    if (!p.grounded) return 'airborne';
    if (this.mode === '2d') {
      // Painted steps and 2D-only bridges exist only from the side; unfolding here would drop Pip through them.
      if (p.ground?.only2d) return 'painted';
    } else {
      const lane = this.laneAt(p.pos.x, p.pos.z);
      if (!lane || Math.abs(p.pos.z - lane.z) > LANE_TOLERANCE) return 'off-lane';
      const found = this.landing(p.pos.x, p.pos.y, lane.z);
      if (typeof found === 'string') return found;
      this.destX = found;
    }
    return null;
  }

  /**
   * The spot on the lane Pip flattens onto: exactly where he stands if it is free and has ground, else the
   * nearest such spot within SAFE_SLIDE, reachable by sliding along the lane (no gap or wall in between).
   * Validated against the flat world being entered (painted steps included).
   */
  private landing(x: number, y: number, z: number): number | ShiftBlock {
    const ok = (tx: number, exact = false) => {
      const box = this.player.box(v3(tx, y, z));
      if (!this.world.isFree(box, null, true) || !this.world.groundBelow(box, 0.1, true)) return false;
      if (exact) return true;
      // a slide must end with ground on both sides of Pip's centre, never teetering on a lip
      const at = (px: number) => ({ min: { x: px - 0.01, y: box.min.y, z: box.min.z }, max: { x: px + 0.01, y: box.max.y, z: box.max.z } });
      return !!this.world.groundBelow(at(tx - 0.15), 0.1, true) && !!this.world.groundBelow(at(tx + 0.15), 0.1, true);
    };
    if (ok(x, true)) return x;
    const exactBox = this.player.box(v3(x, y, z));
    const why: ShiftBlock = this.world.isFree(exactBox, null, true) ? 'no-ground' : 'obstructed';
    for (let d = 0.15; d <= SAFE_SLIDE + 1e-6; d += 0.15) {
      for (const s of [1, -1]) {
        const tx = x + s * d;
        if (!ok(tx)) continue;
        // the slide itself must stay on ground: every step between here and there has ground under it on the lane
        let clear = true;
        for (let k = 0.1; k < d; k += 0.1) {
          if (!this.world.groundBelow(this.player.box(v3(x + s * k, y, z)), 0.1, true)) {
            clear = false;
            break;
          }
        }
        if (clear) return tx;
      }
    }
    return why;
  }

  /**
   * After a refused unfold on a 2D-only surface: the nearest x along the lane with real (3D) ground at the same
   * height, so the game can point at it. Null if there is none in range.
   */
  nearestUnfold(): number | null {
    const p = this.player;
    for (let d = 0.25; d <= HINT_RANGE; d += 0.25) {
      for (const s of [1, -1]) {
        const box = p.box(v3(p.pos.x + s * d, p.pos.y, p.pos.z));
        const g = this.world.groundBelow(box, 0.1, true);
        if (g && !g.only2d && this.world.isFree(box, null, false)) return p.pos.x + s * d;
      }
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
    const x = this.player.pos.x;
    this.transition = { to, t: 0, dur: SHIFT_DURATION, fromZ: this.player.pos.z, toZ, fromX: x, toX: to === '2d' ? this.destX : x };
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
      // Ease depth onto the lane (and along it, if a safe spot was needed); the destination was validated.
      this.player.pos.z = tr.fromZ + (tr.toZ - tr.fromZ) * k;
      this.player.pos.x = tr.fromX + (tr.toX - tr.fromX) * k;
      this.player.prevPos.z = this.player.pos.z;
      this.player.prevPos.x = this.player.pos.x;
    }
    if (tr.t >= tr.dur) {
      this.mode = tr.to;
      this.world.flat = tr.to === '2d';
      if (tr.to === '2d') {
        this.player.pos.z = tr.toZ;
        this.player.pos.x = tr.toX;
      }
      this.transition = null;
      return 'done';
    }
    return null;
  }
}
