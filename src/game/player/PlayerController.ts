import { PHYS, PIP_SIZE, STEP } from '../sim/constants';
import { clamp, moveToward, v3, type V3 } from '../math';
import { shiftBox, type AABB, type Axis, type Collider, type World } from '../collision/World';

/** The valley terrain as a pseudo-collider, so 'what am I standing on' stays uniform. */
export const TERRAIN_GROUND: Collider = { id: 'terrain', kind: 'ground', enabled: true, min: v3(-1e9, -1e9, -1e9), max: v3(1e9, 0, 1e9), delta: v3() };
/** Highest terrain step Pip walks up without jumping, and the steepest walkable slope (rise/run). */
const TERRAIN_STEP = 0.45;
const MAX_SLOPE = 1.1;
/** Low lips on box ground that 3D walking steps onto (seams where terrain meets old platforms). */
const BOX_STEP = 0.32;

export type MoveMode = '2d' | '3d' | 'frozen';

export interface MoveIntent {
  /** Desired horizontal direction in world space (x along level, z depth). Magnitude 0..1. */
  mx: number;
  mz: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
}

export const NO_INTENT: MoveIntent = { mx: 0, mz: 0, jumpPressed: false, jumpHeld: false };

export type PlayerEvent =
  | { type: 'jump' }
  | { type: 'land'; impact: number; airTime: number; distance: number }
  | { type: 'step' }
  | { type: 'bump' }
  | { type: 'stumble' }
  | { type: 'pushStart' };

/**
 * Pip's kinematic controller. Position is the centre of the feet. The same controller runs in
 * 2D (depth locked to the lane) and 3D (free horizontal movement); only the intent differs.
 */
export class PlayerController {
  pos = v3();
  prevPos = v3();
  vel = v3();
  readonly hw = PIP_SIZE.hw;
  readonly h = PIP_SIZE.h;
  /** Movement tuning. */
  readonly p: typeof PHYS = PHYS;

  grounded = false;
  ground: Collider | null = null;
  coyote = 0;
  buffer = 0;
  jumpCutDone = true;
  jumping = false;
  airTime = 0;
  fallTime = 0;
  takeoff = v3();
  /** Facing as a yaw (radians, 0 = toward +z / the 2D camera). */
  heading = Math.PI / 2;
  /** Last horizontal facing in 2D: +1 right, -1 left. */
  dir = 1;
  pushing = 0;
  stepAcc = 0;
  maxSpeedTime = 0;

  constructor(
    private world: World,
    private emit: (e: PlayerEvent) => void,
  ) {}

  box(at: V3 = this.pos): AABB {
    return {
      min: v3(at.x - this.hw, at.y, at.z - this.hw),
      max: v3(at.x + this.hw, at.y + this.h, at.z + this.hw),
    };
  }

  teleport(p: V3) {
    this.pos.x = this.prevPos.x = p.x;
    this.pos.y = this.prevPos.y = p.y;
    this.pos.z = this.prevPos.z = p.z;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.grounded = false;
    this.ground = null;
    this.jumping = false;
    this.airTime = 0;
    this.fallTime = 0;
  }

  /** Bounce from a stomp; keeps the jump button meaningful for a higher rebound. */
  bounce(held: boolean) {
    this.vel.y = held ? this.p.stompBounceHeld : this.p.stompBounce;
    this.grounded = false;
    this.jumping = true;
    this.jumpCutDone = !held;
    this.coyote = 0;
  }

  step(dt: number, intent: MoveIntent, mode: MoveMode) {
    this.prevPos.x = this.pos.x;
    this.prevPos.y = this.pos.y;
    this.prevPos.z = this.pos.z;
    if (mode === 'frozen') return;

    // Ride moving platforms.
    if (this.grounded && this.ground && (this.ground.delta.x || this.ground.delta.z || this.ground.delta.y)) {
      const b = this.box();
      this.world.sweep(b, 'x', this.ground.delta.x, this.ground);
      this.world.sweep(b, 'z', this.ground.delta.z, this.ground);
      this.pos.x = (b.min.x + b.max.x) / 2;
      this.pos.z = (b.min.z + b.max.z) / 2;
      this.pos.y += this.ground.delta.y;
    }

    let mx = intent.mx;
    let mz = mode === '2d' ? 0 : intent.mz;
    const mag = Math.hypot(mx, mz);
    if (mag > 1) {
      mx /= mag;
      mz /= mag;
    }
    const inputMag = Math.min(1, mag);

    // Horizontal acceleration as a 2D vector so 3D steering feels as tight as 2D.
    const tx = mx * this.p.runSpeed;
    const tz = mz * this.p.runSpeed;
    const speedBefore = Math.hypot(this.vel.x, this.vel.z);
    let accel: number;
    if (inputMag > 0.05) {
      const opposing = this.vel.x * tx + this.vel.z * tz < 0;
      accel = this.grounded ? (opposing ? this.p.turnAccel : this.p.groundAccel) : opposing ? this.p.airAccel * 1.3 : this.p.airAccel;
    } else {
      accel = this.grounded ? this.p.groundDecel : this.p.airDecel;
    }
    const dx = tx - this.vel.x;
    const dz = tz - this.vel.z;
    const dl = Math.hypot(dx, dz);
    const maxDv = accel * dt;
    if (dl <= maxDv) {
      this.vel.x = tx;
      this.vel.z = tz;
    } else {
      this.vel.x += (dx / dl) * maxDv;
      this.vel.z += (dz / dl) * maxDv;
    }
    if (mode === '2d') this.vel.z = 0;

    // Stumble when stopping abruptly from full speed.
    if (this.grounded && speedBefore > this.p.runSpeed * 0.92) this.maxSpeedTime += dt;
    else if (inputMag > 0.05) this.maxSpeedTime = 0;
    if (this.grounded && inputMag < 0.05 && this.maxSpeedTime > 0.45) {
      this.maxSpeedTime = 0;
      this.emit({ type: 'stumble' });
    }

    // Facing
    if (mode === '2d') {
      if (mx > 0.1) this.dir = 1;
      else if (mx < -0.1) this.dir = -1;
    }
    if (Math.hypot(this.vel.x, this.vel.z) > 0.4 && inputMag > 0.05) {
      this.heading = Math.atan2(this.vel.x, this.vel.z);
    }

    // Jump buffering + coyote time
    if (intent.jumpPressed) this.buffer = this.p.jumpBuffer;
    else this.buffer = Math.max(0, this.buffer - dt);
    if (this.grounded) this.coyote = this.p.coyoteTime;
    else this.coyote = Math.max(0, this.coyote - dt);

    if (this.buffer > 0 && (this.grounded || this.coyote > 0) && !(this.jumping && this.vel.y > 0)) {
      this.vel.y = this.p.jumpVel;
      this.grounded = false;
      this.ground = null;
      this.coyote = 0;
      this.buffer = 0;
      this.jumping = true;
      this.jumpCutDone = false;
      this.takeoff = { ...this.pos };
      this.emit({ type: 'jump' });
    }

    // Variable jump height: releasing early cuts the rise.
    if (this.jumping && !this.jumpCutDone && !intent.jumpHeld && this.vel.y > 0) {
      this.vel.y *= this.p.jumpCutMul;
      this.jumpCutDone = true;
    }

    // Gravity with a floaty apex and a snappier fall.
    let g = this.p.gravity;
    if (this.vel.y < 0) g *= this.p.fallGravityMul;
    else if (intent.jumpHeld && Math.abs(this.vel.y) < this.p.apexThreshold) g *= this.p.apexGravityMul;
    this.vel.y = Math.max(-this.p.maxFall, this.vel.y - g * dt);

    // Integrate with swept collision, one axis at a time.
    const b = this.box();
    const wasGrounded = this.grounded;
    this.pushing = Math.max(0, this.pushing - dt);
    this.moveAxis(b, 'x', this.vel.x * dt, mode);
    if (mode !== '2d') this.moveAxis(b, 'z', this.vel.z * dt, mode);
    const ry = this.world.sweep(b, 'y', this.vel.y * dt);
    this.pos.x = (b.min.x + b.max.x) / 2;
    this.pos.y = b.min.y;
    this.pos.z = mode === '2d' ? this.pos.z : (b.min.z + b.max.z) / 2;

    if (ry.hit && this.vel.y < 0) {
      this.grounded = true;
      this.ground = ry.hit;
    } else if (ry.hit && this.vel.y > 0) {
      this.vel.y = 0;
      this.emit({ type: 'bump' });
    } else {
      // Stay grounded when walking along flush surfaces; otherwise we left the ledge.
      const g2 = this.vel.y <= 0 ? this.world.groundBelow(b, 0.04) : null;
      this.grounded = !!g2;
      this.ground = g2;
    }

    if (mode === '3d' && this.world.terrain) this.resolveTerrain(b, wasGrounded, dt);

    if (this.grounded) {
      if (!wasGrounded) {
        const impact = -this.vel.y;
        const distance = Math.hypot(this.pos.x - this.takeoff.x, this.pos.z - this.takeoff.z);
        this.emit({ type: 'land', impact, airTime: this.airTime, distance: this.jumping ? distance : 0 });
      }
      this.vel.y = 0;
      this.jumping = false;
      this.airTime = 0;
      this.fallTime = 0;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      this.stepAcc += sp * dt;
      if (this.stepAcc > 0.85) {
        this.stepAcc = 0;
        this.emit({ type: 'step' });
      }
    } else {
      this.airTime += dt;
      if (this.vel.y < 0) this.fallTime += dt;
    }
  }

  /**
   * 3D walking on the valley height field: land on it, walk up gentle rises, stick to it going
   * downhill, refuse cliffs (anything steeper than MAX_SLOPE or a rise beyond TERRAIN_STEP) and slide
   * off steep ground.
   */
  private resolveTerrain(b: AABB, wasGrounded: boolean, dt: number) {
    let h = this.world.terrainUnder(b);
    if (h === null) return;
    if (this.pos.y < h - 1e-4) {
      const rise = h - this.prevPos.y;
      const slope = this.world.terrainSlope(this.pos.x, this.pos.z);
      if (rise > TERRAIN_STEP || (rise > 0.02 && slope > MAX_SLOPE)) {
        // A wall of earth: undo this step's horizontal movement.
        const dx = this.prevPos.x - this.pos.x;
        const dz = this.prevPos.z - this.pos.z;
        shiftBox(b, 'x', dx);
        shiftBox(b, 'z', dz);
        this.pos.x = this.prevPos.x;
        this.pos.z = this.prevPos.z;
        this.vel.x *= -0.1;
        this.vel.z *= -0.1;
        h = this.world.terrainUnder(b) ?? h;
      }
      if (this.pos.y < h) {
        shiftBox(b, 'y', h - this.pos.y);
        this.pos.y = h;
      }
    }
    if (this.vel.y > 0) return;
    const gap = this.pos.y - h;
    const stick = wasGrounded && !this.jumping ? 0.3 : 0.03;
    if (gap >= -1e-4 && gap < stick) {
      const slope = this.world.terrainSlope(this.pos.x, this.pos.z);
      if (gap > 0) {
        shiftBox(b, 'y', -gap);
        this.pos.y = h;
      }
      if (slope <= MAX_SLOPE) {
        if (!this.grounded) {
          this.grounded = true;
          this.ground = TERRAIN_GROUND;
        }
      } else {
        // Too steep to stand on: slide down the fall line.
        const e = 0.25;
        const T = this.world.terrain!;
        const gx = ((T(this.pos.x + e, this.pos.z) ?? h) - (T(this.pos.x - e, this.pos.z) ?? h)) / (2 * e);
        const gz = ((T(this.pos.x, this.pos.z + e) ?? h) - (T(this.pos.x, this.pos.z - e) ?? h)) / (2 * e);
        this.vel.x -= gx * 18 * dt;
        this.vel.z -= gz * 18 * dt;
      }
    }
  }

  private moveAxis(b: AABB, axis: Axis, d: number, mode: MoveMode) {
    let r = this.world.sweep(b, axis, d);
    // 3D: step up onto low lips (where the terrain meets an old platform edge).
    if (r.hit && mode === '3d' && r.hit.kind !== 'cube' && this.grounded) {
      const lip = r.hit.max.y - b.min.y;
      if (lip > 0 && lip <= BOX_STEP) {
        const up: AABB = { min: { ...b.min, y: b.min.y + lip + 1e-3 }, max: { ...b.max, y: b.max.y + lip + 1e-3 } };
        if (this.world.isFree(up)) {
          shiftBox(b, 'y', lip + 1e-3);
          r = this.world.sweep(b, axis, d - r.moved);
        }
      }
    }
    if (r.hit && r.hit.kind === 'cube' && mode === '3d' && this.grounded) {
      // Push the cube: it moves at most pushSpeed and Pip follows it.
      const remaining = d - r.moved;
      const want = Math.sign(remaining) * Math.min(Math.abs(remaining), this.p.pushSpeed * STEP);
      const cube = r.hit;
      const cb: AABB = { min: { ...cube.min }, max: { ...cube.max } };
      const cr = this.world.sweep(cb, axis, want, cube);
      if (Math.abs(cr.moved) > 1e-6) {
        cube.min[axis] = cb.min[axis];
        cube.max[axis] = cb.max[axis];
        cube.delta[axis] += cr.moved;
        shiftBox(b, axis, cr.moved);
        if (this.pushing <= 0) this.emit({ type: 'pushStart' });
        this.pushing = 0.12;
      }
      const v = axis === 'x' ? 'x' : 'z';
      this.vel[v] = clamp(this.vel[v], -this.p.pushSpeed, this.p.pushSpeed);
    } else if (r.hit) {
      const v = axis === 'x' ? 'x' : 'z';
      this.vel[v] = moveToward(this.vel[v], 0, Infinity);
    }
  }
}
