import { clamp, damp, dampAngle, lerp, lerpAngle, smoothstep, v3, wrapAngle, type V3 } from '../math';

/** Side-on: a long lens far away along +z reads as a classic flat 2D platformer. */
const CAM2D = { fov: 13, viewHeight: 9.2, pitch: 0.05, height: 1.45 };
/** Third-person: behind Pip (looking down +x), wider lens, closer. */
const CAM3D = { fov: 52, dist: 5.4, pitch: 0.24, height: 1.0, behindYaw: -Math.PI / 2 };

export interface CamPose {
  target: V3;
  yaw: number;
  pitch: number;
  fov: number;
  dist: number;
}

export interface CameraContext {
  pip: V3;
  vel: V3;
  grounded: boolean;
  /** 0 = 2D, 1 = 3D (already eased). */
  blend: number;
  orbit: { yaw: number; pitch: number; active: boolean };
  recenter: boolean;
  bounds: { minX: number; maxX: number };
  /** Fraction along target->camera where geometry blocks the view (3D camera clipping). */
  raycast?: (from: V3, to: V3) => number | null;
  /** Depth of the lane the 2D camera frames. */
  laneZ?: number;
  /** Ground height under a point (the valley terrain), so the 3D camera never dips underground. */
  groundAt?: (x: number, z: number) => number | null;
  /** 2D: the height the camera's eye should sit at (a 2D-only bridge), or null for the normal framing. */
  alignY?: number | null;
}

/** Distance of the 2D camera from the lane (its framing is fixed by CAM2D.fov and viewHeight). */
const DIST2D = CAM2D.viewHeight / (2 * Math.tan(((CAM2D.fov / 2) * Math.PI) / 180));

/**
 * One perspective camera for both modes. The shift is a continuous dolly-zoom + 90° orbit:
 * field of view widens while distance shrinks so the framing of Pip holds steady.
 */
export class CameraRig {
  pos = v3(0, 2, 40);
  target = v3();
  fov = CAM2D.fov;
  prevPos = v3();
  prevTarget = v3();
  prevFov = CAM2D.fov;
  yaw = 0;

  private x2 = 0;
  private y2 = 1.4;
  private look = 0;
  private t3 = v3();
  orbitYaw = 0;
  orbitPitch = 0;
  private sinceOrbit = 99;
  private clipDist = 100;
  pitch = 0;
  /** 0..1: how far the 2D camera has dropped to eye level with an aligned deck. */
  alignW = 0;
  private alignY = 0;

  override: CamPose | null = null;
  overrideW = 0;
  overrideGoal = 0;
  overrideRate = 1.6;
  shake = 0;
  private time = 0;

  snap(ctx: CameraContext) {
    this.x2 = clamp(ctx.pip.x, ctx.bounds.minX + 7, ctx.bounds.maxX - 7);
    this.y2 = ctx.pip.y + CAM2D.height;
    this.t3 = v3(ctx.pip.x, ctx.pip.y + CAM3D.height, ctx.pip.z);
    this.look = 0;
    this.alignW = ctx.alignY != null ? 1 : 0;
    this.alignY = ctx.alignY ?? 0;
    this.step(1 / 120, ctx);
    this.prevPos = { ...this.pos };
    this.prevTarget = { ...this.target };
    this.prevFov = this.fov;
  }

  /** Bring a 3D view back behind Pip (used on entering 3D). */
  resetOrbit(yaw = 0, pitch = 0) {
    this.orbitYaw = yaw;
    this.orbitPitch = pitch;
  }

  step(dt: number, ctx: CameraContext) {
    this.time += dt;
    this.prevPos = { ...this.pos };
    this.prevTarget = { ...this.target };
    this.prevFov = this.fov;
    const { pip, vel, blend } = ctx;

    const sc = 1;
    // --- 2D follow: look-ahead in the run direction, vertical dead-zone while airborne.
    this.look = damp(this.look, clamp(vel.x * 0.32, -2.3, 2.3) * sc, 2.6, dt);
    this.x2 = damp(this.x2, pip.x + this.look, 7, dt);
    this.x2 = clamp(this.x2, ctx.bounds.minX + 7.5 * sc, ctx.bounds.maxX - 7.5 * sc);
    const wantY = pip.y + CAM2D.height * sc;
    if (ctx.grounded || pip.y < this.y2 - CAM2D.height * sc - 0.2) this.y2 = damp(this.y2, wantY, 5, dt);
    else this.y2 = damp(this.y2, clamp(this.y2, wantY - 1.2 * sc, wantY + 1.6 * sc), 6, dt);

    // --- 3D chase
    this.t3.x = damp(this.t3.x, pip.x, 12, dt);
    this.t3.y = damp(this.t3.y, pip.y + CAM3D.height, 8, dt);
    this.t3.z = damp(this.t3.z, pip.z, 12, dt);
    if (blend > 0.98) {
      this.orbitYaw = wrapAngle(this.orbitYaw + ctx.orbit.yaw);
      this.orbitPitch = clamp(this.orbitPitch + ctx.orbit.pitch, -0.28, 0.75);
      this.sinceOrbit = ctx.orbit.active ? 0 : this.sinceOrbit + dt;
      const sp = Math.hypot(vel.x, vel.z);
      if (ctx.recenter) this.sinceOrbit = 99;
      // Gentle auto-recentre behind the direction of travel when the player isn't steering.
      if (this.sinceOrbit > 1.4 && sp > 1) {
        const behind = Math.atan2(-vel.x, -vel.z) - CAM3D.behindYaw;
        const diff = wrapAngle(behind - this.orbitYaw);
        if (Math.abs(diff) < 2.0) this.orbitYaw = dampAngle(this.orbitYaw, behind, 0.9 * (sp / 7.6), dt);
        this.orbitPitch = damp(this.orbitPitch, 0, 0.8, dt);
      }
      if (ctx.recenter) {
        this.orbitYaw = dampAngle(this.orbitYaw, 0, 8, dt);
      }
    }

    // --- 2D eye level: on a 2D-only bridge the eye drops to deck height, so pieces at different depths meet
    // on the horizon line (a perspective camera only lines up what is at eye height).
    if (ctx.alignY != null) this.alignY = ctx.alignY;
    this.alignW = damp(this.alignW, ctx.alignY != null ? 1 : 0, 2.2, dt);
    const level2 = Math.asin(clamp((this.alignY - this.y2) / DIST2D, -0.5, 0.5));
    const pitch2 = lerp(CAM2D.pitch, level2, smoothstep(0, 1, this.alignW));

    // --- Blend 2D <-> 3D
    const s = blend;
    const yaw3 = wrapAngle(CAM3D.behindYaw + this.orbitYaw);
    const pitch3 = CAM3D.pitch + this.orbitPitch;
    const fov3 = CAM3D.fov;
    const dist3 = CAM3D.dist;
    let yaw = lerpAngle(0, yaw3, s);
    let pitch = lerp(pitch2, pitch3, smoothstep(0, 1, s));
    let fov = lerp(CAM2D.fov, fov3, s);
    const h3 = 2 * dist3 * Math.tan(((fov3 / 2) * Math.PI) / 180);
    const viewH = lerp(CAM2D.viewHeight * sc, h3, s);
    let dist = viewH / (2 * Math.tan(((fov / 2) * Math.PI) / 180));
    const laneZ = ctx.laneZ ?? 0;
    const t3 = this.t3;
    let target = v3(lerp(this.x2, t3.x, s), lerp(this.y2, t3.y, s), lerp(laneZ, t3.z, s));

    // --- Cinematic override
    this.overrideW = damp(this.overrideW, this.overrideGoal, this.overrideRate, dt);
    if (this.overrideGoal === 0 && this.overrideW < 0.002) this.overrideW = 0;
    if (this.override && this.overrideW > 0) {
      const o = this.override;
      const w = smoothstep(0, 1, this.overrideW);
      target = v3(lerp(target.x, o.target.x, w), lerp(target.y, o.target.y, w), lerp(target.z, o.target.z, w));
      yaw = lerpAngle(yaw, o.yaw, w);
      pitch = lerp(pitch, o.pitch, w);
      fov = lerp(fov, o.fov, w);
      dist = lerp(dist, o.dist, w);
    }

    this.yaw = yaw;
    this.pitch = pitch;
    this.fov = fov;
    const cp = Math.cos(pitch);
    // Third-person camera collision: pull in quickly when a wall is between camera and Pip,
    // ease back out when it clears.
    let want = dist;
    if (ctx.raycast && s > 0.5) {
      const probe = v3(
        target.x + Math.sin(yaw) * cp * dist,
        target.y + Math.sin(pitch) * dist,
        target.z + Math.cos(yaw) * cp * dist,
      );
      const hit = ctx.raycast(target, probe);
      if (hit !== null) want = Math.max(1.6, dist * hit - 0.4);
    }
    this.clipDist = want < this.clipDist ? damp(this.clipDist, want, 25, dt) : damp(this.clipDist, want, 2.5, dt);
    if (s <= 0.5) this.clipDist = dist;
    dist = Math.min(dist, this.clipDist);
    this.pos.x = target.x + Math.sin(yaw) * cp * dist;
    this.pos.y = target.y + Math.sin(pitch) * dist;
    this.pos.z = target.z + Math.cos(yaw) * cp * dist;
    if (ctx.groundAt && s > 0.5) {
      const g = ctx.groundAt(this.pos.x, this.pos.z);
      if (g !== null && this.pos.y < g + 0.45) this.pos.y = g + 0.45;
    }
    this.target = target;

    if (this.shake > 0) {
      const k = this.shake * this.shake;
      const f = this.time * 60;
      this.pos.x += Math.sin(f * 1.3) * k * 0.35;
      this.pos.y += Math.sin(f * 1.7 + 1) * k * 0.35;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
  }

  /** Converts stick/keys into a world-space direction relative to the camera. */
  relativeInput(ax: number, ay: number) {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = -fz;
    const rz = fx;
    return { mx: rx * ax + fx * ay, mz: rz * ax + fz * ay };
  }
}
