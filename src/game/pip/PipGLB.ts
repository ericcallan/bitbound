import * as THREE from 'three';
import { getAsset, instanceOf, loadAsset } from '../render/assets';
import { drawFace, FACE_RES } from './face';
import type { PipPose } from './PipModel';
import { clamp, dampAngle, lerpAngle, smoothstep, wrapAngle } from '../math';

type Clip = 'idle' | 'walk' | 'run' | 'jump_start' | 'jump_up' | 'fall' | 'land' | 'brake' | 'celebrate' | 'surprise' | 'shift';
const ONE_SHOT: Clip[] = ['jump_start', 'land', 'brake', 'celebrate', 'surprise', 'shift'];

/**
 * The Blender-built Pip (assets/blender/characters/pip.blend) driven by the game's pose data.
 * Keyframed clips give the body its timing; procedural layers on top keep him reactive:
 * a sprung antenna, a head that turns to the camera, and the live screen-face.
 */
export class PipGLB {
  root = new THREE.Group();
  ready = false;
  private model: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<Clip, THREE.AnimationAction>();
  private loop: Clip = 'idle';
  private shot: Clip | null = null;
  private bones: Record<string, THREE.Bone> = {};
  private faceCanvas = document.createElement('canvas');
  private faceCtx = this.faceCanvas.getContext('2d')!;
  private faceTex = new THREE.CanvasTexture(this.faceCanvas);
  private faceKey = '';
  private glow: THREE.MeshStandardMaterial | null = null;
  private yaw = Math.PI / 2;
  private wasGrounded = true;
  private prevVel = new THREE.Vector3();
  private lastAction = '';
  private antV = 0;
  private antA = 0;
  private blinkT = 2;
  private blinking = 0;
  private headYaw = 0;
  private wasShifting = false;

  constructor() {
    this.faceTex.colorSpace = THREE.SRGBColorSpace;
    // The face is drawn square; show its middle band at the display's 36:25 aspect.
    this.faceTex.repeat.set(1, 0.25 / 0.36);
    this.faceTex.offset.set(0, (1 - 0.25 / 0.36) / 2);
    this.root.visible = false;
    if (getAsset('pip')) this.build();
    else void loadAsset('pip').then(() => this.build());
  }

  private build() {
    if (this.model) return;
    const m = instanceOf('pip');
    const gltf = getAsset('pip');
    if (!m || !gltf) return;
    this.model = m;
    this.root.add(m);
    m.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones[o.name] = o as THREE.Bone;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat.name === 'pip_face') {
        mesh.material = new THREE.MeshBasicMaterial({ map: this.faceTex, toneMapped: false, color: new THREE.Color(1.25, 1.25, 1.25), side: THREE.DoubleSide });
        mesh.castShadow = false;
      } else if (mat.name === 'pip_glow') {
        this.glow = mat;
        mesh.castShadow = false;
      }
    });
    this.mixer = new THREE.AnimationMixer(m);
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      if (ONE_SHOT.includes(clip.name as Clip)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions.set(clip.name as Clip, a);
    }
    this.actions.get('idle')?.play();
    this.ready = true;
  }

  /** Cross-fade the looping base layer. */
  private setLoop(c: Clip, fade = 0.18) {
    if (c === this.loop) return;
    const from = this.actions.get(this.loop);
    const to = this.actions.get(c);
    if (!to) return;
    to.reset().play();
    if (from) to.crossFadeFrom(from, fade, false);
    this.loop = c;
  }

  /** Play a one-shot over the base layer; it fades back out when done. */
  private play(c: Clip, fade = 0.08, speed = 1) {
    const a = this.actions.get(c);
    if (!a) return;
    if (this.shot && this.shot !== c) this.actions.get(this.shot)?.fadeOut(fade);
    a.reset();
    a.setEffectiveTimeScale(speed);
    a.setEffectiveWeight(1);
    a.fadeIn(fade).play();
    this.shot = c;
  }

  private updateFace(p: PipPose, dt: number) {
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blinking = 0.11;
      this.blinkT = 2.4 + Math.random() * 3;
    }
    this.blinking = Math.max(0, this.blinking - dt);
    const res = FACE_RES[5] * 2;
    const key = `${p.expression}|${this.blinking > 0}|${Math.round(this.headYaw * 4)}`;
    if (key === this.faceKey) return;
    this.faceKey = key;
    if (this.faceCanvas.width !== res) this.faceCanvas.width = this.faceCanvas.height = res;
    drawFace(this.faceCtx, res, { expression: p.expression, blink: this.blinking > 0, lookX: clamp(-this.headYaw, -0.6, 0.6), lookY: 0, era: 5, t: p.time });
    this.faceTex.needsUpdate = true;
  }

  update(p: PipPose, dt: number) {
    this.root.position.copy(p.pos);
    if (!this.ready || !this.mixer) return;
    // --- facing (same rule as the classic rig: three-quarter in 2D, heading in 3D)
    const yaw2d = p.dir > 0 ? Math.PI / 2 - 0.5 : -Math.PI / 2 + 0.5;
    const target = lerpAngle(yaw2d, p.heading, smoothstep(0, 1, p.blend));
    this.yaw = dampAngle(this.yaw, target, 14, dt);
    this.root.rotation.y = this.yaw;

    // --- base layer: idle / walk / run on the ground, rise / fall in the air
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (p.grounded) {
      if (speed < 0.35) this.setLoop('idle', 0.25);
      else if (speed < 4.6) this.setLoop('walk', 0.18);
      else this.setLoop('run', 0.14);
      const walk = this.actions.get('walk');
      const run = this.actions.get('run');
      walk?.setEffectiveTimeScale(clamp(speed / 2.4, 0.6, 1.8));
      run?.setEffectiveTimeScale(clamp(speed / 6.6, 0.8, 1.4));
    } else {
      this.setLoop(p.vel.y > 1.5 ? 'jump_up' : 'fall', p.vel.y > 1.5 ? 0.06 : 0.22);
    }
    // --- one-shots from events in the pose stream
    if (!p.grounded && this.wasGrounded && p.vel.y > 4) this.play('jump_start', 0.03, 2.4);
    if (p.grounded && !this.wasGrounded) {
      const impact = clamp(-this.prevVel.y / 18, 0, 1);
      if (impact > 0.35) this.play('land', 0.04, 1.2);
    }
    if (p.action !== this.lastAction) {
      if (p.action === 'stumble') this.play('brake', 0.06);
      if (p.action === 'fistpump' || p.action === 'dance') this.play('celebrate', 0.1);
      if (p.action === 'surprised') this.play('surprise', 0.06);
      this.lastAction = p.action;
    }
    const shifting = p.blend > 0.05 && p.blend < 0.95;
    if (shifting && !this.wasShifting) this.play('shift', 0.1, 0.9);
    this.wasShifting = shifting;
    if (this.shot) {
      const a = this.actions.get(this.shot)!;
      if (!a.isRunning() || a.time >= a.getClip().duration - 0.001) {
        a.fadeOut(0.15);
        this.shot = null;
      }
    }
    this.mixer.update(dt);

    // --- procedural layers on top of the clips
    const accel = (p.vel.x - this.prevVel.x) * Math.sin(this.yaw) + (p.vel.z - this.prevVel.z) * Math.cos(this.yaw);
    this.antV += (-this.antA * 260 - this.antV * 11 - clamp(accel / Math.max(dt, 1e-3), -60, 60) * 0.35) * dt;
    this.antA = clamp(this.antA + this.antV * dt, -0.7, 0.7);
    const glitch = p.antennaGlitch > 0 ? Math.sin(p.time * 48) * 0.25 : 0;
    for (const [n, k] of [['ant_1', 0.5], ['ant_2', 0.8], ['ant_3', 1]] as const) {
      const b = this.bones[n];
      if (b) b.rotation.x += this.antA * k + glitch;
    }
    const head = this.bones.head;
    const toCam = Math.atan2(p.cameraPos.x - p.pos.x, p.cameraPos.z - p.pos.z);
    const want = p.lookAtCamera > 0 && speed < 0.5 ? clamp(wrapAngle(toCam - this.yaw), -0.9, 0.9) : 0;
    this.headYaw = dampAngle(this.headYaw, want, 6, dt);
    if (head) head.rotation.y += this.headYaw;

    if (this.glow) this.glow.emissiveIntensity = 2.2 + Math.sin(p.time * 2.6) * 0.5 + p.coreBoost * 5;
    this.updateFace(p, dt);
    this.model!.scale.setScalar(Math.max(0.001, p.assemble));
    this.root.visible = !(p.invuln > 0 && Math.floor(p.time * 18) % 2 === 0);
    this.wasGrounded = p.grounded;
    this.prevVel.copy(p.vel);
  }

  dispose() {
    this.faceTex.dispose();
    this.mixer?.stopAllAction();
  }
}
