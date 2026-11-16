import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { eraMaterial, PATTERN } from '../render/eraMaterial';
import { drawFace, FACE_RES, PIP_COLORS } from './face';
import type { PipPose } from './PipModel';
import { clamp, dampAngle, lerp, lerpAngle, smoothstep, wrapAngle } from '../math';

const rb = (w: number, h: number, d: number, r: number, m: THREE.Material) => new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)), m);
const cyl = (rt: number, rb2: number, h: number, m: THREE.Material, s = 12) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb2, h, s), m);
const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number) => (o.position.set(x, y, z), o);

export interface AdultPose extends PipPose {
  /** 0..1 aim-down-sights. */
  aim: number;
  firing: boolean;
  /** Camera pitch, so the arm follows the crosshair up and down. */
  aimPitch: number;
  dashing: boolean;
  /** 0..1 heat glow on the emitter. */
  heat: number;
}

/** A two-bone limb: upper → lower, rotated about x (swing) with a bend at the joint. */
class Limb {
  root = new THREE.Group();
  lower = new THREE.Group();
  end = new THREE.Group();
  constructor(upper: THREE.Object3D, lower: THREE.Object3D, upperLen: number, lowerLen: number, end?: THREE.Object3D) {
    this.root.add(upper);
    this.lower.position.y = -upperLen;
    this.root.add(this.lower);
    this.lower.add(lower);
    this.end.position.y = -lowerLen;
    this.lower.add(this.end);
    if (end) this.end.add(end);
  }
  pose(swing: number, bend: number, splay = 0) {
    this.root.rotation.set(swing, 0, splay);
    this.lower.rotation.set(bend, 0, 0);
  }
}

/**
 * Pip grown up: a lean android about twice the classic height. Same palette, same screen-face,
 * same antenna (now a comm-fin) — but plated, weathered, and armed. `age` (0.6..1) morphs from
 * the young adult of the meadow's last chapters to the adult of the city.
 */
export class PipAdult {
  root = new THREE.Group();
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private chest = new THREE.Group();
  private head = new THREE.Group();
  private fin = new THREE.Group();
  private coat: THREE.Group[] = [];
  private legL: Limb;
  private legR: Limb;
  private armL: Limb;
  private armR: Limb;
  private emitter = new THREE.Group();
  private emitterGlow: THREE.MeshStandardMaterial;
  private muzzleFlash: THREE.Mesh;
  private coreMat: THREE.MeshStandardMaterial;
  private faceCanvas = document.createElement('canvas');
  private faceCtx: CanvasRenderingContext2D;
  private faceTex: THREE.CanvasTexture;
  private faceKey = '';
  private yaw = Math.PI / 2;
  private phase = 0;
  private finA = 0;
  private finV = 0;
  private coatSwing = 0;
  private coatV = 0;
  private prevVel = new THREE.Vector3();
  private blinkT = 2;
  private blinking = 0;
  private flashT = 0;
  private headYaw = 0;
  private heightUnits: number;

  constructor(public age = 1) {
    const M = {
      orange: eraMaterial({ color: PIP_COLORS.orange, roughness: 0.35, metalness: 0.15, physical: { clearcoat: 0.8, clearcoatRoughness: 0.18 } }),
      cream: eraMaterial({ color: '#efe4c8', roughness: 0.4, physical: { clearcoat: 0.7, clearcoatRoughness: 0.2 } }),
      under: eraMaterial({ color: '#1b1f2e', roughness: 0.55, metalness: 0.35, pattern: PATTERN.metal }),
      joint: eraMaterial({ color: '#4a5068', roughness: 0.3, metalness: 0.8 }),
      cobalt: eraMaterial({ color: PIP_COLORS.cobalt, roughness: 0.35, metalness: 0.3, physical: { clearcoat: 0.6, clearcoatRoughness: 0.25 } }),
      coat: eraMaterial({ color: '#3a2f3a', roughness: 0.85, side: THREE.DoubleSide, pattern: PATTERN.wood }),
      purple: eraMaterial({ color: PIP_COLORS.purple, roughness: 0.3, metalness: 0.5 }),
      dark: eraMaterial({ color: '#0d1020', roughness: 0.12, metalness: 0.4, physical: { clearcoat: 1, clearcoatRoughness: 0.04 } }),
      teal: eraMaterial({ color: '#0f6f66', emissive: PIP_COLORS.teal, emissiveIntensity: 2.8, roughness: 0.15, physical: { iridescence: 1, clearcoat: 1 } }),
      piston: eraMaterial({ color: '#a8b0c8', roughness: 0.18, metalness: 0.95 }),
      scuff: eraMaterial({ color: '#b8461f', roughness: 0.7 }),
    };
    this.coreMat = M.teal;
    this.emitterGlow = eraMaterial({ color: '#7a2c08', emissive: '#ff8a2a', emissiveIntensity: 1.5, roughness: 0.2 });
    this.root.add(this.body);

    // --- legs: thigh, shin with hydraulic greave, heavy boot
    const leg = (side: number) => {
      const thigh = new THREE.Group();
      thigh.add(at(rb(0.17, 0.42, 0.19, 0.06, M.under), 0, -0.21, 0));
      thigh.add(at(rb(0.19, 0.24, 0.12, 0.05, M.orange), 0, -0.17, 0.05));
      const shin = new THREE.Group();
      shin.add(at(rb(0.15, 0.42, 0.17, 0.05, M.under), 0, -0.21, 0));
      shin.add(at(rb(0.17, 0.3, 0.1, 0.04, M.cobalt), 0, -0.2, 0.07));
      const piston = cyl(0.025, 0.025, 0.32, M.piston, 8);
      shin.add(at(piston, side * 0.08, -0.22, -0.06));
      shin.add(at(cyl(0.045, 0.045, 0.09, M.joint, 8), side * 0.08, -0.08, -0.06));
      const boot = new THREE.Group();
      boot.add(at(rb(0.2, 0.14, 0.32, 0.05, M.cobalt), 0, -0.04, 0.05));
      boot.add(at(rb(0.21, 0.05, 0.34, 0.02, M.scuff), 0, -0.1, 0.05));
      const knee = at(new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), M.joint), 0, 0, 0);
      const l = new Limb(thigh, shin, 0.42, 0.42, boot);
      l.lower.add(knee);
      l.root.position.set(side * 0.12, 0.98, 0);
      this.hips.add(l.root);
      return l;
    };
    this.legL = leg(-1);
    this.legR = leg(1);

    // --- hips, torso, half-coat
    this.hips.position.y = 0;
    this.hips.add(at(rb(0.36, 0.16, 0.22, 0.06, M.under), 0, 1.0, 0));
    this.body.add(this.hips);
    this.chest.position.y = 1.06;
    this.chest.add(at(rb(0.3, 0.28, 0.2, 0.08, M.under), 0, 0.14, 0));
    this.chest.add(at(rb(0.44, 0.34, 0.26, 0.1, M.orange), 0, 0.42, 0));
    this.chest.add(at(rb(0.3, 0.22, 0.04, 0.04, M.cream), 0, 0.42, 0.13));
    this.chest.add(at(new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 2), M.teal), 0, 0.42, 0.16));
    this.chest.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.015, 8, 20), M.joint), 0, 0.42, 0.155));
    // shoulder plates
    for (const s of [-1, 1]) this.chest.add(at(rb(0.16, 0.1, 0.24, 0.05, M.orange), s * 0.27, 0.58, 0));
    // a scuff and a dent: lived-in
    this.chest.add(at(rb(0.08, 0.03, 0.01, 0.01, M.scuff), 0.12, 0.33, 0.131));
    // half-coat: hangs from the waist at the back and sides, swings with motion
    for (const [x, z, ry, w] of [[0, -0.13, 0, 0.42], [-0.2, -0.04, -1.2, 0.2], [0.2, -0.04, 1.2, 0.2]] as const) {
      const flap = new THREE.Group();
      flap.position.set(x, 0.2, z);
      flap.rotation.y = ry;
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.55), M.coat);
      cloth.position.y = -0.27;
      flap.add(cloth);
      this.chest.add(flap);
      this.coat.push(flap);
    }
    this.chest.add(at(rb(0.46, 0.3, 0.28, 0.06, M.coat), 0, 0.38, -0.02)).scale.set(1, 1, 1);
    this.body.add(this.chest);

    // --- arms
    const arm = (side: number) => {
      const upper = new THREE.Group();
      upper.add(at(rb(0.12, 0.32, 0.13, 0.05, M.under), 0, -0.16, 0));
      upper.add(at(rb(0.14, 0.16, 0.15, 0.05, M.cream), 0, -0.08, 0));
      const lower = new THREE.Group();
      lower.add(at(rb(0.11, 0.3, 0.12, 0.04, M.under), 0, -0.15, 0));
      const hand = new THREE.Group();
      hand.add(at(rb(0.11, 0.12, 0.09, 0.04, M.cream), 0, -0.05, 0));
      if (side > 0) {
        // The right forearm is the Pulse Emitter.
        lower.add(at(rb(0.15, 0.24, 0.15, 0.04, M.orange), 0, -0.17, 0));
        this.emitter.add(at(cyl(0.05, 0.065, 0.2, M.joint, 12), 0, -0.36, 0));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.016, 8, 20), this.emitterGlow);
        ring.rotation.x = Math.PI / 2;
        this.emitter.add(at(ring, 0, -0.42, 0));
        this.muzzleFlash = new THREE.Mesh(
          new THREE.SphereGeometry(0.12, 10, 8),
          new THREE.MeshBasicMaterial({ color: '#ffd8a0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
        );
        this.emitter.add(at(this.muzzleFlash, 0, -0.5, 0));
        lower.add(this.emitter);
      }
      const l = new Limb(upper, lower, 0.32, 0.3, side > 0 ? undefined : hand);
      l.lower.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), M.joint), 0, 0, 0));
      l.root.position.set(side * 0.29, 0.56, 0);
      this.chest.add(l.root);
      return l;
    };
    this.armL = arm(-1);
    this.armR = arm(1);
    this.muzzleFlash ??= new THREE.Mesh();

    // --- head: same rounded-square screen-face, now on a neck
    this.head.position.y = 0.66;
    this.head.add(at(cyl(0.06, 0.07, 0.12, M.joint, 10), 0, 0.02, 0));
    const shell = rb(0.36, 0.3, 0.32, 0.08, M.cream);
    this.head.add(at(shell, 0, 0.22, 0));
    this.head.add(at(rb(0.37, 0.07, 0.33, 0.035, M.orange), 0, 0.35, 0));
    this.head.add(at(rb(0.31, 0.22, 0.05, 0.05, M.dark), 0, 0.21, 0.15));
    this.faceCtx = this.faceCanvas.getContext('2d')!;
    this.faceTex = new THREE.CanvasTexture(this.faceCanvas);
    this.faceTex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.19), new THREE.MeshBasicMaterial({ map: this.faceTex, toneMapped: false }));
    this.head.add(at(face, 0, 0.21, 0.177));
    for (const s of [-1, 1]) {
      const ear = cyl(0.045, 0.045, 0.04, M.purple, 10);
      ear.rotation.z = Math.PI / 2;
      this.head.add(at(ear, s * 0.19, 0.22, 0));
    }
    // the antenna, grown into a slim comm-fin
    this.fin.position.set(0.07, 0.38, -0.04);
    const finMesh = rb(0.025, 0.22, 0.09, 0.012, M.purple);
    this.fin.add(at(finMesh, 0, 0.1, 0));
    this.fin.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), M.teal), 0, 0.22, 0.03));
    this.head.add(this.fin);
    this.chest.add(this.head);

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.muzzleFlash.castShadow = false;
    this.heightUnits = 1.8;
    this.setAge(age);
  }

  /** 0.6 = young adult (Chapters 4–5, lankier, bigger head), 1 = the city. */
  setAge(age: number) {
    this.age = age;
    const k = smoothstep(0.6, 1, age);
    this.head.scale.setScalar(lerp(1.22, 1, k));
    this.chest.scale.set(lerp(0.88, 1, k), 1, lerp(0.88, 1, k));
  }

  /** Scale the whole rig so it stands `h` units tall (meadow vs city). */
  setHeight(h: number) {
    this.heightUnits = h;
    this.root.scale.setScalar(h / 1.8);
  }

  private updateFace(p: PipPose) {
    const res = FACE_RES[p.era];
    const key = `${p.expression}|${this.blinking > 0}|${p.era}`;
    if (key === this.faceKey) return;
    this.faceKey = key;
    if (this.faceCanvas.width !== res) this.faceCanvas.width = this.faceCanvas.height = res;
    drawFace(this.faceCtx, res, { expression: p.expression, blink: this.blinking > 0, lookX: 0, lookY: 0, era: p.era, t: p.time });
    this.faceTex.needsUpdate = true;
  }

  update(p: AdultPose, dt: number) {
    this.root.position.copy(p.pos);
    const side = 0.55;
    const yaw2d = p.dir > 0 ? Math.PI / 2 - side : -Math.PI / 2 + side;
    const target = lerpAngle(yaw2d, p.heading, smoothstep(0, 1, p.blend));
    this.yaw = dampAngle(this.yaw, target, 14, dt);
    this.root.rotation.y = this.yaw;

    const speed = Math.hypot(p.vel.x, p.vel.z);
    const run = clamp(speed / 7.2, 0, 1);
    // stride relative to facing: forward/back vs strafe
    const fwd = Math.sin(this.yaw) * p.vel.x + Math.cos(this.yaw) * p.vel.z;
    const strafe = Math.cos(this.yaw) * p.vel.x - Math.sin(this.yaw) * p.vel.z;
    this.phase += dt * (speed * 1.5 + (run > 0.05 ? 1.5 : 0));
    const s1 = Math.sin(this.phase);
    const c1 = Math.cos(this.phase);
    const dirSign = fwd < -0.5 ? -1 : 1;
    const strafeAmt = clamp(Math.abs(strafe) / 7, 0, 1) * (1 - clamp(Math.abs(fwd) / 7, 0, 1));

    // --- legs
    if (p.grounded) {
      const swing = 0.75 * run * dirSign;
      this.legL.pose(s1 * swing, Math.max(0, -c1) * 1.1 * run + 0.06, -Math.sign(strafe) * s1 * 0.25 * strafeAmt);
      this.legR.pose(-s1 * swing, Math.max(0, c1) * 1.1 * run + 0.06, Math.sign(strafe) * s1 * 0.25 * strafeAmt);
      this.body.position.y = Math.abs(s1) * 0.05 * run - 0.02 * run;
    } else {
      const rising = p.vel.y > 0;
      this.legL.pose(rising ? -0.7 : -0.25, rising ? 1.3 : 0.5);
      this.legR.pose(rising ? 0.25 : 0.15, rising ? 0.4 : 0.35);
      this.body.position.y = 0;
    }
    if (p.dashing) {
      this.legL.pose(-0.9, 0.6);
      this.legR.pose(0.6, 0.9);
    }

    // --- torso: lean into the run, twist toward aim, breathe at rest
    const breathe = Math.sin(p.time * 1.8) * 0.012;
    this.chest.rotation.set(0.12 * run * dirSign + (p.dashing ? 0.35 : 0), Math.sin(this.phase) * 0.12 * run * (1 - p.aim), 0);
    this.chest.position.y = 1.06 + breathe;

    // --- arms: run swing, or aim the emitter along the camera pitch
    const aimW = Math.max(p.aim, p.firing ? 1 : 0);
    const armSwing = s1 * 0.7 * run;
    this.armL.pose(-armSwing * (1 - aimW) + lerp(0, -1.0, aimW), lerp(-0.25 - run * 0.4, -1.1, aimW), 0.12);
    const aimPitch = clamp(-p.aimPitch, -0.9, 0.9);
    this.armR.pose(lerp(armSwing, -Math.PI / 2 + aimPitch, aimW), lerp(-0.25 - run * 0.4, -0.08, aimW), lerp(-0.12, 0.1, aimW));
    if (aimW > 0.5) this.armL.root.rotation.y = 0.5;

    // Hurt flinch / weary celebration
    if (p.action === 'hurt') this.chest.rotation.x -= 0.3;
    if (p.action === 'fistpump') {
      const k = smoothstep(0, 0.2, p.actionT) * (1 - smoothstep(0.5, 0.7, p.actionT));
      this.armL.pose(lerp(this.armL.root.rotation.x, -2.4, k), -0.6 * k, 0.1);
    }

    // --- head looks a little toward the camera when idle
    const toCam = Math.atan2(p.cameraPos.x - p.pos.x, p.cameraPos.z - p.pos.z);
    const want = p.lookAtCamera > 0 ? clamp(wrapAngle(toCam - this.yaw), -0.9, 0.9) : 0;
    this.headYaw = dampAngle(this.headYaw, want, 6, dt);
    this.head.rotation.set(-aimPitch * 0.4 * aimW, this.headYaw, 0);

    // --- secondary motion: comm-fin and coat lag behind acceleration
    const ax = (p.vel.x - this.prevVel.x) / Math.max(dt, 1e-4);
    const az = (p.vel.z - this.prevVel.z) / Math.max(dt, 1e-4);
    const accFwd = Math.sin(this.yaw) * ax + Math.cos(this.yaw) * az;
    this.finV += (-this.finA * 220 - this.finV * 10 - clamp(accFwd * 0.01, -3, 3) * 18) * dt;
    this.finA = clamp(this.finA + this.finV * dt, -0.8, 0.8);
    this.fin.rotation.x = this.finA * 0.6 + (p.antennaGlitch > 0 ? 1.2 + Math.sin(p.time * 50) * 0.2 : 0);
    const coatTarget = clamp(speed * 0.09 + (p.vel.y < -2 ? 0.5 : 0), 0, 0.9);
    this.coatV += ((coatTarget - this.coatSwing) * 60 - this.coatV * 8) * dt;
    this.coatSwing += this.coatV * dt;
    this.coat.forEach((f, i) => (f.rotation.x = -(this.coatSwing + Math.sin(p.time * 3 + i) * 0.04 * (0.2 + run))));

    // --- core, emitter heat and muzzle flash
    this.coreMat.emissiveIntensity = 2.2 + Math.sin(p.time * 2.5) * 0.5 + p.coreBoost * 4;
    this.emitterGlow.emissiveIntensity = 0.8 + p.heat * 6 + (p.firing ? 2 : 0);
    if (p.firing) this.flashT = 0.06;
    this.flashT = Math.max(0, this.flashT - dt);
    (this.muzzleFlash.material as THREE.MeshBasicMaterial).opacity = this.flashT > 0 ? 0.9 : 0;
    this.muzzleFlash.scale.setScalar(0.7 + Math.random() * 0.6);

    // --- face
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blinking = 0.11;
      this.blinkT = 2.5 + Math.random() * 3;
    }
    this.blinking = Math.max(0, this.blinking - dt);
    this.updateFace(p);
    this.root.visible = !(p.invuln > 0 && Math.floor(p.time * 18) % 2 === 0) || p.dashing;
    this.prevVel.copy(p.vel);
  }

  dispose() {
    this.faceTex.dispose();
  }
}
