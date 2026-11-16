import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { eraMaterial } from '../render/eraMaterial';
import { drawFace, FACE_RES, PIP_COLORS, type FaceState } from './face';
import type { Era } from '../era/EraSystem';
import type { Expression, PipAction } from '../sim/Game';
import { clamp, dampAngle, easeOutBack, lerp, lerpAngle, smoothstep, wrapAngle } from '../math';

export interface PipPose {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  grounded: boolean;
  dir: number;
  heading: number;
  blend: number;
  action: PipAction;
  actionT: number;
  expression: Expression;
  assemble: number;
  pushing: boolean;
  idleT: number;
  lookAtCamera: number;
  antennaGlitch: number;
  invuln: number;
  coreBoost: number;
  pixelGlow: number;
  era: Era;
  time: number;
  cameraPos: THREE.Vector3;
}

const mats = () => ({
  orange: eraMaterial({ color: PIP_COLORS.orange, roughness: 0.42, flatBoost: 1.05, physical: { clearcoat: 0.7, clearcoatRoughness: 0.15 } }),
  orangeDark: eraMaterial({ color: PIP_COLORS.orangeDark, roughness: 0.6 }),
  cream: eraMaterial({ color: PIP_COLORS.cream, roughness: 0.38, flatBoost: 1.0, physical: { clearcoat: 0.8, clearcoatRoughness: 0.12 } }),
  cobalt: eraMaterial({ color: PIP_COLORS.cobalt, roughness: 0.35, metalness: 0.1, physical: { clearcoat: 0.6, clearcoatRoughness: 0.2 } }),
  purple: eraMaterial({ color: PIP_COLORS.purple, roughness: 0.3, metalness: 0.4 }),
  dark: eraMaterial({ color: PIP_COLORS.faceEdge, roughness: 0.18, metalness: 0.3, physical: { clearcoat: 1, clearcoatRoughness: 0.05 } }),
  teal: eraMaterial({ color: '#16897e', emissive: PIP_COLORS.teal, emissiveIntensity: 1.6, roughness: 0.2, physical: { iridescence: 1, clearcoat: 1 } }),
  spring: eraMaterial({ color: '#9aa4c4', roughness: 0.25, metalness: 0.85 }),
});

/** Ensures each part grows during the awakening with a slight stagger. */
interface Part {
  obj: THREE.Object3D;
  delay: number;
  base: THREE.Vector3;
}

/**
 * Pip, built procedurally. One rig serves every era; pixel eras are achieved through flat
 * materials, stepped animation timing and the post-process grid, so he is visibly the same
 * robot as a 16px sprite and as a fully lit 3D character.
 */
export class PipModel {
  root = new THREE.Group();
  private squash = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private bootL = new THREE.Group();
  private bootR = new THREE.Group();
  private antenna = new THREE.Group();
  private antennaTip = new THREE.Group();
  private core: THREE.Mesh;
  private coreMat: THREE.MeshStandardMaterial;
  private tipMat: THREE.MeshStandardMaterial;
  private pixel: THREE.Mesh;
  private antennaTipObj!: THREE.Mesh;
  /** Beyond: a fading light ribbon traced by the antenna tip. */
  trail: THREE.Line;
  private trailPts: THREE.Vector3[] = [];
  private trailGeo = new THREE.BufferGeometry();
  private detail: THREE.Object3D[] = [];
  private parts: Part[] = [];

  private faceCanvas = document.createElement('canvas');
  private faceCtx: CanvasRenderingContext2D;
  private faceTex: THREE.CanvasTexture;
  private faceKey = '';

  // animation state
  private yaw = Math.PI / 2;
  private phase = 0;
  private sq = 1;
  private sqV = 0;
  private antA = 0;
  private antV = 0;
  private antZ = 0;
  private antZV = 0;
  private prevVel = new THREE.Vector3();
  private wasGrounded = true;
  private blinkT = 3;
  private blinking = 0;
  private headYaw = 0;
  private lookAround = 0;
  private lastT = 0;

  constructor() {
    const m = mats();
    this.coreMat = m.teal;
    this.tipMat = eraMaterial({ color: '#16897e', emissive: PIP_COLORS.teal, emissiveIntensity: 2.2 });
    const rb = (w: number, h: number, d: number, r: number, mat: THREE.Material) =>
      new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat);

    this.root.add(this.squash);

    // Boots: oversized and spring-loaded.
    for (const [g, x] of [[this.bootL, -0.13], [this.bootR, 0.13]] as const) {
      g.position.set(x, 0, 0);
      const boot = rb(0.2, 0.13, 0.29, 0.05, m.cobalt);
      boot.position.set(0, 0.075, 0.03);
      const sole = rb(0.21, 0.04, 0.3, 0.015, m.orangeDark);
      sole.position.set(0, 0.02, 0.03);
      const cuff = rb(0.16, 0.04, 0.16, 0.015, m.cream);
      cuff.position.set(0, 0.15, 0.0);
      const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 10), m.spring);
      coil.position.set(0, 0.2, 0);
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12), m.spring);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(0, 0.17 + i * 0.03, 0);
        g.add(ring);
        this.detail.push(ring);
      }
      g.add(boot, sole, cuff, coil);
      this.squash.add(g);
      this.parts.push({ obj: g, delay: 0, base: g.scale.clone() });
    }

    // Torso
    this.torso.position.set(0, 0.25, 0);
    const body = rb(0.36, 0.27, 0.3, 0.08, m.orange);
    body.position.y = 0.135;
    const belly = rb(0.24, 0.17, 0.04, 0.03, m.cream);
    belly.position.set(0, 0.13, 0.15);
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.055, 1), m.teal);
    this.core.position.set(0, 0.14, 0.175);
    const coreRing = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 6, 16), m.dark);
    coreRing.position.set(0, 0.14, 0.17);
    this.detail.push(coreRing);
    const belt = rb(0.38, 0.05, 0.32, 0.02, m.orangeDark);
    belt.position.y = 0.02;
    this.torso.add(body, belly, this.core, coreRing, belt);
    this.squash.add(this.torso);
    this.parts.push({ obj: this.torso, delay: 0.15, base: new THREE.Vector3(1, 1, 1) });

    // Arms with mitten hands
    for (const [g, x] of [[this.armL, -0.215], [this.armR, 0.215]] as const) {
      g.position.set(x, 0.21, 0);
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), m.purple);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.1, 4, 8), m.spring);
      upper.position.y = -0.07;
      const mitten = rb(0.11, 0.11, 0.1, 0.045, m.cream);
      mitten.position.y = -0.16;
      const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), m.cream);
      thumb.position.set(0, -0.14, 0.05);
      g.add(shoulder, upper, mitten, thumb);
      this.torso.add(g);
      this.parts.push({ obj: g, delay: 0.3, base: new THREE.Vector3(1, 1, 1) });
    }

    // Head: rounded-square shell, dark screen faceplate with a living face.
    this.head.position.set(0, 0.27, 0);
    const shell = rb(0.52, 0.43, 0.44, 0.11, m.cream);
    shell.position.y = 0.2;
    const cap = rb(0.5, 0.1, 0.42, 0.05, m.orange);
    cap.position.y = 0.37;
    const plate = rb(0.42, 0.31, 0.06, 0.06, m.dark);
    plate.position.set(0, 0.19, 0.205);
    this.faceCtx = this.faceCanvas.getContext('2d')!;
    this.faceTex = new THREE.CanvasTexture(this.faceCanvas);
    this.faceTex.colorSpace = THREE.SRGBColorSpace;
    const faceMat = new THREE.MeshBasicMaterial({ map: this.faceTex, toneMapped: false });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.37, 0.27), faceMat);
    face.position.set(0, 0.19, 0.2365);
    const earL = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 12), m.purple);
    earL.rotation.z = Math.PI / 2;
    earL.position.set(-0.27, 0.2, 0);
    const earR = earL.clone();
    earR.position.x = 0.27;
    this.head.add(shell, cap, plate, face, earL, earR);
    this.detail.push(earL, earR);

    // Antenna: two-segment spring that lags behind motion.
    this.antenna.position.set(0.08, 0.41, -0.02);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.13, 6), m.purple);
    stalk.position.y = 0.065;
    this.antennaTip.position.y = 0.13;
    const stalk2 = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.08, 6), m.purple);
    stalk2.position.y = 0.04;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), this.tipMat);
    tip.position.y = 0.1;
    this.antennaTipObj = tip;
    this.antennaTip.add(stalk2, tip);
    this.antenna.add(stalk, this.antennaTip);
    this.head.add(this.antenna);
    this.torso.add(this.head);
    this.parts.push({ obj: this.head, delay: 0.45, base: new THREE.Vector3(1, 1, 1) });
    this.parts.push({ obj: this.antenna, delay: 0.7, base: new THREE.Vector3(1, 1, 1) });

    // The lone pixel Pip starts life as.
    this.pixel = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, 0.16),
      new THREE.MeshBasicMaterial({ color: '#b4fff6', toneMapped: false }),
    );
    this.pixel.position.y = 0.45;
    this.root.add(this.pixel);

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });
    this.pixel.castShadow = false;

    const N = 28;
    for (let i = 0; i < N; i++) this.trailPts.push(new THREE.Vector3());
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const cols = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const k = 1 - i / (N - 1);
      cols[i * 3] = 0.45 * k;
      cols[i * 3 + 1] = 1.6 * k;
      cols[i * 3 + 2] = 1.7 * k;
    }
    this.trailGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.trail = new THREE.Line(
      this.trailGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.trail.frustumCulled = false;
    this.trail.visible = false;
  }

  private updateFace(f: FaceState) {
    const res = FACE_RES[f.era];
    const key = `${f.expression}|${f.blink}|${f.era}|${Math.round(f.lookX * 4)}|${Math.round(f.lookY * 4)}|${
      f.expression === 'panic' || f.expression === 'sleepy' ? Math.floor(f.t * 12) : 0
    }`;
    if (key === this.faceKey) return;
    this.faceKey = key;
    if (this.faceCanvas.width !== res) {
      this.faceCanvas.width = this.faceCanvas.height = res;
      this.faceTex.dispose();
    }
    const filter = f.era < 2 ? THREE.NearestFilter : THREE.LinearFilter;
    this.faceTex.anisotropy = f.era >= 4 ? 4 : 1;
    this.faceTex.magFilter = filter;
    this.faceTex.minFilter = filter;
    drawFace(this.faceCtx, res, f);
    this.faceTex.needsUpdate = true;
  }

  update(p: PipPose, dt: number) {
    const era = p.era;
    // Stepped animation time in pixel eras: 8 fps / 12 fps, smooth in modern.
    // Stepped animation per generation: sprite frames, then a choppy early-3D rate, then smooth.
    const fps = era === 0 ? 8 : era === 1 ? 12 : era === 2 ? 20 : 0;
    const t = fps ? Math.floor(p.time * fps) / fps : p.time;
    const adt = fps ? t - this.lastT : dt;
    this.lastT = t;

    this.root.position.copy(p.pos);

    // --- facing
    const side = era === 0 ? 0.42 : 0.5;
    const yaw2d = p.dir > 0 ? Math.PI / 2 - side : -Math.PI / 2 + side;
    const target = lerpAngle(yaw2d, p.heading, smoothstep(0, 1, p.blend));
    this.yaw = dampAngle(this.yaw, target, 16, dt);
    let yaw = this.yaw;

    // --- squash & stretch spring
    if (p.grounded && !this.wasGrounded) {
      const impact = clamp(-this.prevVel.y / 20, 0.15, 1);
      this.sqV -= impact * 7;
    }
    if (!p.grounded && this.wasGrounded && p.vel.y > 5) {
      this.sq = 1.22;
      this.sqV = 0;
    }
    this.sqV += (-(this.sq - 1) * 420 - this.sqV * 15) * dt;
    this.sq = clamp(this.sq + this.sqV * dt, 0.62, 1.35);
    // Stylized: rubbery, exaggerated squash and stretch.
    let sy = era === 3 ? clamp(1 + (this.sq - 1) * 1.7, 0.5, 1.5) : this.sq;

    const speed = Math.hypot(p.vel.x, p.vel.z);
    const run = clamp(speed / 7.6, 0, 1);
    this.phase += dt * (speed * 2.1 + (run > 0.05 ? 2 : 0));
    const steps = era === 0 ? 4 : era === 1 ? 6 : era === 2 ? 8 : 0;
    const ph = steps ? Math.floor(this.phase / ((Math.PI * 2) / steps)) * ((Math.PI * 2) / steps) : this.phase;

    // Reset pose
    this.torso.rotation.set(0, 0, 0);
    this.torso.position.set(0, 0.25, 0);
    this.head.rotation.set(0, 0, 0);
    this.armL.rotation.set(0, 0, 0.18);
    this.armR.rotation.set(0, 0, -0.18);
    this.bootL.position.set(-0.13, 0, 0);
    this.bootR.position.set(0.13, 0, 0);
    this.bootL.rotation.set(0, 0, 0);
    this.bootR.rotation.set(0, 0, 0);
    let rootY = 0;
    let headYawTarget = 0;

    if (p.grounded) {
      // run cycle
      const s1 = Math.sin(ph);
      const c1 = Math.cos(ph);
      this.bootL.position.z = s1 * 0.13 * run;
      this.bootR.position.z = -s1 * 0.13 * run;
      this.bootL.position.y = Math.max(0, c1) * 0.09 * run;
      this.bootR.position.y = Math.max(0, -c1) * 0.09 * run;
      this.bootL.rotation.x = -s1 * 0.4 * run;
      this.bootR.rotation.x = s1 * 0.4 * run;
      this.torso.position.y += Math.abs(Math.sin(ph)) * 0.035 * run;
      this.torso.rotation.x = 0.16 * run;
      this.armL.rotation.x = -s1 * 1.0 * run;
      this.armR.rotation.x = s1 * 1.0 * run;
      this.head.rotation.x = -0.06 * run;
      if (run < 0.05) {
        // idle breathing
        const b = Math.sin(t * 2.4);
        this.torso.position.y += b * 0.006;
        this.head.rotation.z = Math.sin(t * 1.1) * 0.03;
        this.armL.rotation.z = 0.18 + b * 0.04;
        this.armR.rotation.z = -0.18 - b * 0.04;
      }
    } else {
      // airborne: rising = one arm up, falling = arms out
      if (p.vel.y > 0) {
        this.armR.rotation.x = -2.6;
        this.armL.rotation.x = 0.6;
        this.bootL.position.set(-0.13, 0.08, 0.08);
        this.bootR.position.set(0.13, 0.03, -0.08);
        this.bootL.rotation.x = -0.5;
      } else {
        this.armL.rotation.z = 1.1;
        this.armR.rotation.z = -1.1;
        this.bootL.position.set(-0.14, -0.02, 0.05);
        this.bootR.position.set(0.14, 0.02, -0.04);
      }
    }

    // Expressive overrides
    const k = p.actionT;
    switch (p.action) {
      case 'fistpump': {
        const up = smoothstep(0, 0.12, k) * (1 - smoothstep(0.5, 0.7, k));
        this.armR.rotation.x = lerp(this.armR.rotation.x, -2.9, up);
        this.armR.rotation.z = lerp(-0.18, -0.25, up);
        this.armL.rotation.x = lerp(this.armL.rotation.x, 0.3, up);
        rootY += Math.sin(clamp(k / 0.35, 0, 1) * Math.PI) * 0.12;
        this.torso.rotation.z = -0.1 * up;
        break;
      }
      case 'stumble': {
        const a = Math.sin(clamp(k / 0.5, 0, 1) * Math.PI);
        this.torso.rotation.x = 0.55 * a;
        this.head.rotation.x = 0.3 * a;
        this.armL.rotation.x = -1.6 * a + Math.sin(k * 30) * 0.4 * a;
        this.armR.rotation.x = -1.6 * a - Math.sin(k * 30) * 0.4 * a;
        this.bootR.position.z = 0.12 * a;
        break;
      }
      case 'inspect': {
        const a = smoothstep(0, 0.3, k) * (1 - smoothstep(2.2, 2.6, k));
        this.armL.rotation.x = lerp(this.armL.rotation.x, -1.3, a);
        this.armR.rotation.x = lerp(this.armR.rotation.x, -1.3, a);
        this.armL.rotation.y = Math.sin(t * 5) * 0.4 * a;
        this.armR.rotation.y = -Math.sin(t * 5) * 0.4 * a;
        this.head.rotation.x = 0.38 * a;
        this.head.rotation.y = Math.sin(t * 1.7) * 0.5 * a;
        rootY += 0.05 * a + Math.sin(t * 3) * 0.02 * a;
        break;
      }
      case 'surprised': {
        const jump = Math.sin(clamp(k / 0.35, 0, 1) * Math.PI);
        rootY += jump * 0.22;
        this.torso.rotation.x = -0.2 * jump;
        this.head.rotation.x = -0.25 * (1 - smoothstep(0.6, 1.4, k));
        this.armL.rotation.z = lerp(0.18, 1.4, jump);
        this.armR.rotation.z = lerp(-0.18, -1.4, jump);
        break;
      }
      case 'dance': {
        const beat = t * 4.2;
        rootY += Math.abs(Math.sin(beat * Math.PI * 0.5)) * 0.2;
        yaw += Math.sin(beat * 0.5) * 1.1 + (Math.floor(beat / 8) % 2 ? t * 3.2 : 0);
        this.armL.rotation.x = Math.sin(beat * Math.PI * 0.5) > 0 ? -2.8 : -0.4;
        this.armR.rotation.x = Math.sin(beat * Math.PI * 0.5) > 0 ? -0.4 : -2.8;
        this.armL.rotation.z = 0.5;
        this.armR.rotation.z = -0.5;
        this.torso.rotation.z = Math.sin(beat * Math.PI) * 0.15;
        this.head.rotation.z = -Math.sin(beat * Math.PI) * 0.2;
        this.bootL.position.y = Math.max(0, Math.sin(beat * Math.PI)) * 0.08;
        this.bootR.position.y = Math.max(0, -Math.sin(beat * Math.PI)) * 0.08;
        headYawTarget = 0.4;
        break;
      }
      case 'hurt': {
        this.torso.rotation.x = -0.4;
        this.head.rotation.x = -0.3;
        this.armL.rotation.z = 1.2;
        this.armR.rotation.z = -1.2;
        break;
      }
    }
    if (p.expression === 'panic') {
      this.armL.rotation.x = -2.7 + Math.sin(t * 28) * 0.5;
      this.armR.rotation.x = -2.7 - Math.sin(t * 28) * 0.5;
      this.armL.rotation.z = 0.5;
      this.armR.rotation.z = -0.5;
      this.bootL.position.z = Math.sin(t * 24) * 0.1;
      this.bootR.position.z = -Math.sin(t * 24) * 0.1;
    }
    if (p.pushing) {
      this.torso.rotation.x = 0.38;
      this.armL.rotation.x = -1.45;
      this.armR.rotation.x = -1.45;
      this.head.rotation.x = 0.1;
      const s1 = Math.sin(this.phase * 1.4);
      this.bootL.position.z = s1 * 0.08;
      this.bootR.position.z = -s1 * 0.08;
    }

    // Look at the player / camera when idle, or around curiously.
    const toCam = Math.atan2(p.cameraPos.x - p.pos.x, p.cameraPos.z - p.pos.z);
    if (p.lookAtCamera > 0 || p.action === 'surprised') {
      headYawTarget = clamp(wrapAngle(toCam - yaw), -1.1, 1.1);
    } else if (p.idleT > 5) {
      this.lookAround += dt;
      headYawTarget = Math.sin(this.lookAround * 0.9) * 0.8;
    }
    this.headYaw = dampAngle(this.headYaw, headYawTarget, 7, dt);
    this.head.rotation.y += this.headYaw;

    this.root.rotation.y = yaw;
    this.root.position.y += rootY;
    const sx = 1 / Math.sqrt(sy);
    this.squash.scale.set(sx, sy, sx);

    // --- antenna spring follows acceleration
    const ax = (p.vel.x - this.prevVel.x) / Math.max(dt, 1e-4);
    const ay = (p.vel.y - this.prevVel.y) / Math.max(dt, 1e-4);
    const localAx = ax * Math.cos(yaw) - 0;
    this.antV += (-this.antA * 260 - this.antV * 9 + clamp(-ay * 0.004, -3, 3) * 20) * dt;
    this.antA = clamp(this.antA + this.antV * dt, -1.2, 1.2);
    this.antZV += (-this.antZ * 220 - this.antZV * 8 + clamp(localAx * 0.01, -3, 3) * 20) * dt;
    this.antZ = clamp(this.antZ + this.antZV * dt, -1, 1);
    let bendX = this.antA * 0.6 + run * 0.25 + Math.sin(ph * 2) * 0.12 * run;
    let bendZ = this.antZ * 0.5;
    if (p.antennaGlitch > 0) {
      bendX = 1.35 + Math.sin(p.time * 50) * 0.15;
      bendZ = Math.sin(p.time * 37) * 0.3;
    }
    this.antenna.rotation.set(bendX * 0.5, 0, bendZ * 0.5);
    this.antennaTip.rotation.set(bendX * 0.7, 0, bendZ * 0.7);
    this.tipMat.emissiveIntensity = p.antennaGlitch > 0 ? (Math.sin(p.time * 60) > 0 ? 5 : 0.2) : 2.2;

    // --- core glow
    const pulse = 0.5 + 0.5 * Math.sin(p.time * 3);
    this.coreMat.emissiveIntensity = 1.2 + pulse * 0.6 + p.coreBoost * (3 + Math.sin(p.time * 30));
    this.core.scale.setScalar(1 + p.coreBoost * 0.35);

    // --- detail LOD by era: chunkier silhouette in 8-bit
    for (const d of this.detail) d.visible = era > 0 && era !== 2;

    // --- awakening assembly
    const a = p.assemble;
    this.pixel.visible = a < 0.15;
    if (this.pixel.visible) {
      const g = p.pixelGlow;
      this.pixel.scale.setScalar(0.8 + g * 0.5 + (1 - a / 0.15) * 0.0);
      (this.pixel.material as THREE.MeshBasicMaterial).color.setRGB(0.5 + g * 0.5, 1, 0.95);
    }
    for (const part of this.parts) {
      const local = clamp((a - part.delay * 0.8) / 0.4, 0, 1);
      const s = a >= 1 ? 1 : local <= 0 ? 0.0001 : easeOutBack(local, 2.2);
      part.obj.scale.set(part.base.x * s, part.base.y * s, part.base.z * s);
      part.obj.visible = s > 0.001;
    }

    // --- blink & face
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blinking = 0.12;
      this.blinkT = 2.2 + Math.random() * 3;
    }
    this.blinking = Math.max(0, this.blinking - dt);
    const lookX = clamp(headYawTarget * 0.4, -1, 1) + (p.grounded ? 0 : 0);
    this.updateFace({
      expression: p.expression,
      blink: this.blinking > 0,
      lookX: p.action === 'inspect' ? 0 : lookX,
      lookY: p.action === 'inspect' ? -1 : p.vel.y > 4 ? 0.6 : 0,
      era,
      t: p.time,
    });

    // --- hurt flicker
    this.root.visible = !(p.invuln > 0 && Math.floor(p.time * 18) % 2 === 0);

    // --- Beyond: antenna light trail
    this.trail.visible = era === 5 && this.root.visible && a >= 1;
    if (this.trail.visible) {
      this.root.updateMatrixWorld(true);
      const tipW = this.antennaTipObj.getWorldPosition(new THREE.Vector3());
      const v = this.trailPts.pop()!;
      v.copy(tipW);
      this.trailPts.unshift(v);
      const arr = this.trailGeo.attributes.position.array as Float32Array;
      this.trailPts.forEach((q, i) => {
        // settle unused points onto the tip so the ribbon grows in smoothly
        if (q.lengthSq() === 0) q.copy(tipW);
        arr[i * 3] = q.x;
        arr[i * 3 + 1] = q.y;
        arr[i * 3 + 2] = q.z;
      });
      this.trailGeo.attributes.position.needsUpdate = true;
    } else {
      for (const q of this.trailPts) q.set(0, 0, 0);
    }

    this.prevVel.copy(p.vel);
    this.wasGrounded = p.grounded;
    void adt;
  }

  dispose() {
    this.faceTex.dispose();
    this.trailGeo.dispose();
    (this.trail.material as THREE.Material).dispose();
  }

  get faceSource() {
    return this.faceCanvas;
  }
}
