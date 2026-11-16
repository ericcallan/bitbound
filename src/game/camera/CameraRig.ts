import { clamp, damp, dampAngle, lerp, lerpAngle, smoothstep, v3, wrapAngle, type V3 } from '../math';

/** Side-on: a long lens far away along +z reads as a classic flat 2D platformer. */
const CAM2D = { fov: 13, viewHeight: 9.2, pitch: 0.05, height: 1.45 };
/** Third-person: behind Pip (looking down +x), wider lens, closer. */
const CAM3D = { fov: 56, dist: 7.4, pitch: 0.36, height: 0.95, behindYaw: -Math.PI / 2 };

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
  /** Adult form: over-the-shoulder shooter camera (aim 0..1 zooms in). */
  shoulder?: { aim: number } | null;
  /** Size multiplier for 2D framing (the adult form is twice as tall). */
  scale?: number;
  /** Depth of the lane the 2D camera frames. */
  laneZ?: number;
}

/** Over-the-shoulder shooter camera for the adult form. */
const SHOULDER = { dist: 3.5, aimDist: 1.9, fov: 62, aimFov: 44, height: 1.62, side: 0.62, aimSide: 0.78 };

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
  /** Shooter camera: absolute yaw/pitch driven by mouse look. */
  lookYaw = -Math.PI / 2;
  lookPitch = 0.12;
  /** Current camera pitch (for aiming rays). */
  pitch = 0;
  recoil = 0;

  override: CamPose | null = null;
  overrideW = 0;
  overrideGoal = 0;
  overrideRate = 1.6;
  shake = 0;
  private time = 0;

  snap(ctx: CameraContext) {
    this.x2 = clamp(ctx.pip.x, ctx.bounds.minX + 7, ctx.bounds.maxX - 7);
    this.y2 = ctx.pip.y + CAM2D.height * (ctx.scale ?? 1);
    this.t3 = v3(ctx.pip.x, ctx.pip.y + CAM3D.height, ctx.pip.z);
    this.look = 0;
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

    const sc = ctx.scale ?? 1;
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

    // --- Shooter look (adult form): mouse drives an absolute yaw/pitch.
    const sh = ctx.shoulder ?? null;
    if (sh) {
      if (blend > 0.98) {
        this.lookYaw = wrapAngle(this.lookYaw + ctx.orbit.yaw);
        this.lookPitch = clamp(this.lookPitch + ctx.orbit.pitch, -0.55, 0.95);
      }
      this.recoil = Math.max(0, this.recoil - dt * 6);
    }

    // --- Blend 2D <-> 3D
    const s = blend;
    const yaw3 = sh ? this.lookYaw : wrapAngle(CAM3D.behindYaw + this.orbitYaw);
    const pitch3 = sh ? this.lookPitch + this.recoil * 0.05 : CAM3D.pitch + this.orbitPitch;
    const fov3 = sh ? lerp(SHOULDER.fov, SHOULDER.aimFov, sh.aim) : CAM3D.fov;
    const dist3 = sh ? lerp(SHOULDER.dist, SHOULDER.aimDist, sh.aim) : CAM3D.dist;
    let yaw = lerpAngle(0, yaw3, s);
    let pitch = lerp(CAM2D.pitch, pitch3, smoothstep(0, 1, s));
    let fov = lerp(CAM2D.fov, fov3, s);
    const h3 = 2 * dist3 * Math.tan(((fov3 / 2) * Math.PI) / 180);
    const viewH = lerp(CAM2D.viewHeight * sc, h3, s);
    let dist = viewH / (2 * Math.tan(((fov / 2) * Math.PI) / 180));
    const laneZ = ctx.laneZ ?? 0;
    let t3 = this.t3;
    if (sh) {
      // Over the right shoulder: offset the target along the camera's right vector.
      const side = lerp(SHOULDER.side, SHOULDER.aimSide, sh.aim);
      t3 = v3(pip.x + Math.cos(yaw3) * side, pip.y + SHOULDER.height, pip.z - Math.sin(yaw3) * side);
    }
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
      if (hit !== null) want = Math.max(sh ? 0.6 : 1.6, dist * hit - (sh ? 0.2 : 0.4));
    }
    this.clipDist = want < this.clipDist ? damp(this.clipDist, want, 25, dt) : damp(this.clipDist, want, 2.5, dt);
    if (s <= 0.5) this.clipDist = dist;
    dist = Math.min(dist, this.clipDist);
    this.pos.x = target.x + Math.sin(yaw) * cp * dist;
    this.pos.y = target.y + Math.sin(pitch) * dist;
    this.pos.z = target.z + Math.cos(yaw) * cp * dist;
    this.target = target;

    if (this.shake > 0) {
      const k = this.shake * this.shake;
      const f = this.time * 60;
      this.pos.x += Math.sin(f * 1.3) * k * 0.35;
      this.pos.y += Math.sin(f * 1.7 + 1) * k * 0.35;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
  }

  /** Unit vector the camera looks along (for aiming rays). */
  /** Shooter: turn the look so the camera faces along (dx, dz). */
  faceToward(dx: number, dz: number) {
    this.lookYaw = Math.atan2(-dx, -dz);
  }

  forward(): V3 {
    const cp = Math.cos(this.pitch);
    return v3(-Math.sin(this.yaw) * cp, -Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
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
