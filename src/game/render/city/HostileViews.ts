import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { eraMaterial, PATTERN } from '../eraMaterial';
import { PixelSprite } from '../sprites';
import type { Combat, Hostile } from '../../combat/combat';
import { NEON } from './CityView';
import { lerp } from '../../math';

const rb = (w: number, h: number, d: number, r: number, m: THREE.Material) => new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)), m);
const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number) => (o.position.set(x, y, z), o);

const SHIELD_FRAG = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec3 vP;
uniform float uTime; uniform float uHit;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  vec3 p = vP * 3.0;
  float hex = abs(sin(p.x * 3.0 + uTime) * sin(p.y * 3.0) * sin(p.z * 3.0 - uTime * 0.7));
  float lines = smoothstep(0.92, 1.0, hex);
  vec3 col = vec3(0.3, 0.85, 1.0) * (fres * 1.4 + lines * 0.8 + uHit * 1.5);
  gl_FragColor = vec4(col, (fres * 0.6 + lines * 0.35 + uHit * 0.4));
}`;
const SHIELD_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() {
  vN = normalMatrix * normal;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = -mv.xyz;
  vP = position;
  gl_Position = projectionMatrix * mv;
}`;

interface View {
  h: Hostile;
  root: THREE.Group;
  model: THREE.Group;
  sprite?: PixelSprite;
  parts: Record<string, THREE.Object3D>;
  flash: THREE.MeshStandardMaterial[];
  shield?: THREE.Mesh;
  laser?: THREE.Mesh;
  phase: number;
}

/** Visuals for ARCHIVE's machines, their projectiles, and their 8-bit sprite selves. */
export class HostileViews {
  group = new THREE.Group();
  private views: View[] = [];
  private bolts: THREE.InstancedMesh;
  private shieldMats: THREE.ShaderMaterial[] = [];

  constructor(private combat: Combat) {
    const metal = eraMaterial({ color: '#2a2e3d', roughness: 0.3, metalness: 0.85, pattern: PATTERN.metal });
    const white = eraMaterial({ color: '#d8dce6', roughness: 0.35, metalness: 0.2, physical: { clearcoat: 0.8, clearcoatRoughness: 0.2 } });
    const black = eraMaterial({ color: '#0b0c12', roughness: 0.2, metalness: 0.5 });
    const eye = () => eraMaterial({ color: '#300008', emissive: NEON.red, emissiveIntensity: 3 });
    for (const h of combat.hostiles) {
      const root = new THREE.Group();
      const model = new THREE.Group();
      root.add(model);
      const parts: Record<string, THREE.Object3D> = {};
      const flash: THREE.MeshStandardMaterial[] = [];
      let sprite: PixelSprite | undefined;
      let shield: THREE.Mesh | undefined;
      let laser: THREE.Mesh | undefined;
      switch (h.kind) {
        case 'censor': {
          const e = eye();
          flash.push(e);
          const body = new THREE.Mesh(new THREE.SphereGeometry(0.38, 20, 14), white);
          body.scale.set(1, 0.75, 1);
          const lens = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), e);
          lens.position.set(0, 0, 0.36);
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 6, 32), metal);
          ring.rotation.x = Math.PI / 2;
          const rotors = new THREE.Group();
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2;
            const r = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 12), black);
            r.position.set(Math.cos(a) * 0.55, 0.05, Math.sin(a) * 0.55);
            rotors.add(r);
          }
          model.add(body, lens, ring, rotors);
          model.position.y = 0.35;
          parts.rotors = rotors;
          break;
        }
        case 'enforcer': {
          const e = eye();
          flash.push(e);
          const torso = new THREE.Group();
          torso.position.y = 1.1;
          torso.add(at(rb(0.5, 0.55, 0.32, 0.08, white), 0, 0.3, 0));
          torso.add(at(rb(0.36, 0.3, 0.26, 0.06, black), 0, -0.05, 0));
          torso.add(at(rb(0.2, 0.06, 0.02, 0.01, e), 0, 0.42, 0.17));
          const head = new THREE.Group();
          head.position.y = 0.66;
          head.add(at(rb(0.26, 0.28, 0.28, 0.08, white), 0, 0.12, 0));
          head.add(at(rb(0.22, 0.06, 0.02, 0.01, e), 0, 0.14, 0.14));
          torso.add(head);
          const gun = new THREE.Group();
          gun.position.set(0.3, 0.35, 0.1);
          gun.add(at(rb(0.08, 0.1, 0.7, 0.02, metal), 0, 0, 0.3));
          gun.add(at(rb(0.1, 0.32, 0.1, 0.03, white), 0, -0.16, 0));
          torso.add(gun);
          const legs: THREE.Group[] = [];
          for (const s of [-1, 1]) {
            const l = new THREE.Group();
            l.position.set(s * 0.14, 1.0, 0);
            l.add(at(rb(0.16, 0.52, 0.18, 0.05, black), 0, -0.26, 0));
            l.add(at(rb(0.18, 0.5, 0.2, 0.05, white), 0, -0.72, 0));
            model.add(l);
            legs.push(l);
          }
          model.add(torso);
          parts.torso = torso;
          parts.legL = legs[0];
          parts.legR = legs[1];
          sprite = new PixelSprite('enforcer', 1.3, 1.3);
          break;
        }
        case 'turret':
        case 'sniper': {
          const e = eye();
          flash.push(e);
          model.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.35, 12), metal), 0, 0.17, 0));
          const head = new THREE.Group();
          head.position.y = 0.6;
          head.add(rb(0.6, 0.4, 0.6, 0.1, white));
          head.add(at(rb(0.12, 0.12, h.kind === 'sniper' ? 1.4 : 0.7, 0.03, metal), 0, 0, 0.5));
          head.add(at(new THREE.Mesh(new THREE.CircleGeometry(0.08, 12), e), 0.18, 0.06, 0.31));
          model.add(head);
          parts.head = head;
          if (h.kind === 'sniper') {
            laser = new THREE.Mesh(
              new THREE.CylinderGeometry(0.015, 0.015, 1, 6, 1, true),
              new THREE.MeshBasicMaterial({ color: NEON.red, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
            );
            this.group.add(laser);
          }
          break;
        }
        case 'warden': {
          const e = eye();
          flash.push(e);
          const torso = new THREE.Group();
          torso.position.y = 1.7;
          torso.add(at(rb(1.5, 1.1, 0.9, 0.2, white), 0, 0.5, 0));
          torso.add(at(rb(1.0, 0.6, 0.7, 0.15, black), 0, -0.2, 0));
          torso.add(at(new THREE.Mesh(new THREE.CircleGeometry(0.28, 24), e), 0, 0.55, 0.46));
          const head = new THREE.Group();
          head.position.y = 1.15;
          head.add(rb(0.6, 0.5, 0.55, 0.12, white));
          head.add(at(rb(0.48, 0.1, 0.02, 0.02, e), 0, 0.02, 0.28));
          torso.add(head);
          for (const s of [-1, 1]) {
            const arm = new THREE.Group();
            arm.position.set(s * 0.95, 0.7, 0);
            arm.add(at(rb(0.4, 1.3, 0.45, 0.1, metal), 0, -0.55, 0));
            arm.add(at(rb(0.55, 0.5, 0.6, 0.12, white), 0, -1.3, 0.05));
            torso.add(arm);
            parts[s < 0 ? 'armL' : 'armR'] = arm;
          }
          // armour plates appear in the final phase
          const plates = new THREE.Group();
          for (let i = 0; i < 6; i++) {
            const p = rb(0.7, 0.35, 0.08, 0.03, eraMaterial({ color: '#4a3a2a', roughness: 0.4, metalness: 0.9 }));
            p.position.set((i % 2 ? 0.4 : -0.4), 0.2 + Math.floor(i / 2) * 0.38, 0.48);
            plates.add(p);
          }
          torso.add(plates);
          parts.plates = plates;
          for (const s of [-1, 1]) {
            const l = new THREE.Group();
            l.position.set(s * 0.4, 1.4, 0);
            l.add(at(rb(0.45, 1.4, 0.5, 0.12, black), 0, -0.7, 0));
            model.add(l);
            parts[s < 0 ? 'legL' : 'legR'] = l;
          }
          model.add(torso);
          parts.torso = torso;
          const sm = new THREE.ShaderMaterial({
            vertexShader: SHIELD_VERT,
            fragmentShader: SHIELD_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            uniforms: { uTime: { value: 0 }, uHit: { value: 0 } },
          });
          this.shieldMats.push(sm);
          shield = new THREE.Mesh(new THREE.SphereGeometry(2.1, 32, 20), sm);
          shield.position.y = 1.6;
          root.add(shield);
          sprite = new PixelSprite('warden', 2, 2);
          break;
        }
      }
      model.traverse((o) => ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
      if (sprite) root.add(sprite.sprite);
      this.group.add(root);
      this.views.push({ h, root, model, sprite, parts, flash, shield, laser, phase: Math.random() * 6 });
    }
    // projectiles: one instanced glowing capsule set
    this.bolts = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.06, 0.55, 4, 8),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      200,
    );
    this.bolts.frustumCulled = false;
    this.group.add(this.bolts);
  }

  update(t: number, dt: number, alpha: number) {
    for (const v of this.views) {
      const h = v.h;
      const x = lerp(h.prevPos.x, h.pos.x, alpha);
      const y = lerp(h.prevPos.y, h.pos.y, alpha);
      const z = lerp(h.prevPos.z, h.pos.z, alpha);
      v.root.position.set(x, y, z);
      const dead = !h.alive;
      const gone = dead && h.dying > 0.6;
      // Not-yet-awake hostiles still stand at their posts (so the city looks guarded).
      v.root.visible = !gone && h.exists;
      if (!v.root.visible) {
        if (v.laser) v.laser.visible = false;
        continue;
      }
      const spriteMode = h.sprite;
      v.model.visible = !spriteMode;
      if (v.sprite) {
        v.sprite.sprite.visible = spriteMode;
        if (spriteMode) v.sprite.set(Math.floor(t * 6) % 2, Math.sin(h.aimYaw) < 0);
      }
      v.root.rotation.y = h.kind === 'turret' || h.kind === 'sniper' ? 0 : h.aimYaw;
      if (dead) {
        v.model.scale.setScalar(Math.max(0.01, 1 - h.dying * 1.6));
        v.model.rotation.z = h.dying * 3;
      }
      for (const f of v.flash) f.emissiveIntensity = 3 + h.hitFlash * 8 + (h.telegraph > 0 ? 6 * h.telegraph : 0);
      switch (h.kind) {
        case 'censor':
          v.parts.rotors.rotation.y += dt * 30;
          v.model.rotation.x = Math.sin(t * 2 + v.phase) * 0.1;
          v.model.rotation.y = 0;
          break;
        case 'enforcer':
        case 'warden': {
          const moving = Math.hypot(h.pos.x - h.prevPos.x, h.pos.z - h.prevPos.z) > 0.001;
          const ph = t * (h.kind === 'warden' ? 5 : 8) + v.phase;
          const sw = moving ? Math.sin(ph) * 0.5 : 0;
          v.parts.legL.rotation.x = sw;
          v.parts.legR.rotation.x = -sw;
          v.parts.torso.rotation.x = h.kind === 'warden' ? h.telegraph * 0.5 : -h.aimPitch * 0.3;
          if (h.kind === 'warden') {
            const raise = h.telegraph;
            v.parts.armL.rotation.x = -raise * 2.4;
            v.parts.armR.rotation.x = -raise * 2.4;
            v.parts.plates.visible = h.armored;
            if (v.shield) {
              v.shield.visible = h.shielded;
              (v.shield.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
              (v.shield.material as THREE.ShaderMaterial).uniforms.uHit.value = h.hitFlash;
            }
          }
          break;
        }
        case 'turret':
        case 'sniper': {
          v.parts.head.rotation.y = h.aimYaw;
          v.parts.head.rotation.x = -h.aimPitch;
          if (v.laser) {
            const m = v.laser.material as THREE.MeshBasicMaterial;
            m.opacity = h.telegraph > 0 ? 0.25 + h.telegraph * 0.6 : 0;
            v.laser.visible = h.telegraph > 0;
            if (v.laser.visible) {
              const from = new THREE.Vector3(x, y + 0.6, z);
              const len = 60;
              const dir = new THREE.Vector3(Math.sin(h.aimYaw) * Math.cos(h.aimPitch), Math.sin(h.aimPitch), Math.cos(h.aimYaw) * Math.cos(h.aimPitch));
              v.laser.position.copy(from).addScaledVector(dir, len / 2);
              v.laser.scale.set(1, len, 1);
              v.laser.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            }
          }
          break;
        }
      }
    }
    // bolts
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    let n = 0;
    for (const p of this.combat.projectiles) {
      if (!p.alive || n >= 200) continue;
      const dir = new THREE.Vector3(p.vel.x, p.vel.y, p.vel.z).normalize();
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const s = p.charged ? 2.6 : 1;
      m4.compose(new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z), q, new THREE.Vector3(s, s * (p.owner === 'pip' ? 1.3 : 1), s));
      this.bolts.setMatrixAt(n, m4);
      col.set(p.owner === 'pip' ? (p.charged ? '#fff1c0' : '#ffae4a') : '#ff2a55').multiplyScalar(4);
      this.bolts.setColorAt(n, col);
      n++;
    }
    this.bolts.count = n;
    this.bolts.instanceMatrix.needsUpdate = true;
    if (this.bolts.instanceColor) this.bolts.instanceColor.needsUpdate = true;
  }

  dispose() {
    for (const v of this.views) v.sprite?.dispose();
  }
}
