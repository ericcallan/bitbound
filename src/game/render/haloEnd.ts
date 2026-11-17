import * as THREE from 'three';
import { assetSlot, fillAssetSlots } from './decor';
import { onAssetLoaded } from './assets';
import { eraMaterial, PATTERN } from './eraMaterial';
import { AQUEDUCT, LEVEL, PLATES, WAVE } from '../level/meadows';
import { ERA_LABELS, ERA_YEARS } from '../era/EraSystem';
import { smoothstep } from '../math';
import type { Game } from '../sim/Game';

/**
 * The end of the Halo Path, drawn (the rules are in Game.ts and meadows.ts):
 *  - the Stalled Gate: a gatehouse around the door, the stele whose inscription is a blur of pixels until full
 *    detail is rolled over it, and a progress ring over the gate (2 of 6 until the gate is read, then 6 of 6).
 *    The stalled field itself needs no marking: its 16-bit look is its edge;
 *  - the Update Wave: the missing span as a low-poly bridge drawn only where the world is Early 3D (inside the
 *    wave), its faint ghost everywhere else, and two scan bars marking the wave's edges;
 *  - the World Wheel: six version plates (each with a tablet behind it), the wheel on its dais with a segment
 *    per generation that lights when its plate is installed, turning as the ending plays.
 * The stone is from the Blender asset `halo` (scripts/blender/create_halo.py); boxes stand in until it loads.
 */
const L = LEVEL;
const SEAL = L.sealY;
const ERA_COLORS = ['#ff9a3c', '#ff6fa8', '#ffd25e', '#8e5bd6', '#4fb8ff', '#4ff5e6'];

export class HaloEndView {
  group = new THREE.Group();
  /** The gatehouse's front tower and curtain wall: only in 3D (in 2D it would stand between camera and gate). */
  gateFront = new THREE.Group();
  /** The door's model, inside LevelView's sealDoor group (which sinks it). */
  private steleMat: THREE.MeshStandardMaterial;
  private steleTex: { sharp: THREE.Texture; blur: THREE.Texture };
  private ring: { tex: THREE.CanvasTexture; ctx: CanvasRenderingContext2D; shown: number; mat: THREE.MeshBasicMaterial };
  private bars: THREE.Mesh[] = [];
  private edgeGates: THREE.Mesh[] = [];
  private barMat: THREE.ShaderMaterial;
  private wheel = new THREE.Group();
  private wedges: { mat: THREE.MeshStandardMaterial; flash: number }[] = [];
  private tablets: THREE.MeshStandardMaterial[] = [];
  private plateGlow: THREE.MeshBasicMaterial[] = [];
  private unsubAssets: () => void;
  private unsubGame: () => void;
  private t = 0;

  constructor(game: Game, sealDoor: THREE.Group) {
    this.buildGate(sealDoor);
    this.steleTex = { sharp: inscription(false), blur: inscription(true) };
    this.steleMat = this.buildStele();
    this.ring = this.buildRing();
    this.barMat = barMaterial();
    this.buildWave();
    this.buildPlates();
    this.buildWheel();
    fillAssetSlots(this.group);
    fillAssetSlots(this.gateFront);
    fillAssetSlots(sealDoor);
    this.unsubAssets = onAssetLoaded(() => {
      fillAssetSlots(this.group);
      fillAssetSlots(this.gateFront);
      fillAssetSlots(sealDoor);
    });
    this.unsubGame = game.on((e) => {
      if (e.type === 'install' && e.value !== undefined) this.wedges[e.value].flash = 1;
    });
    this.group.add(this.gateFront);
  }

  // ---------------------------------------------------------------- the Stalled Gate

  private buildGate(sealDoor: THREE.Group) {
    const stone = () => eraMaterial({ color: '#c9b99e', pattern: PATTERN.ruin, roughness: 0.9 });
    const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stone());
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      return m;
    };
    const back = new THREE.Group();
    back.add(box(2, 7.6, 2.2, 0, 3.8, -4.1), box(1.7, 1.3, 5.5, 0, 5.65, -0.25));
    const backSlot = assetSlot('halo', 'halo_gate_back', back);
    backSlot.position.set(213, SEAL, 0);
    this.group.add(backSlot);
    const front = new THREE.Group();
    front.add(box(2, 9.4, 2.2, 0, 2.9, 3.6), box(1.4, 7, 3.5, 0, 1.1, 6.4));
    const frontSlot = assetSlot('halo', 'halo_gate_front', front);
    frontSlot.position.set(213, SEAL, 0);
    this.gateFront.add(frontSlot);
    // the door: the box in LevelView's sealDoor group stands in until the model arrives
    const doorBox = sealDoor.children.slice();
    const doorFallback = new THREE.Group();
    for (const o of doorBox) {
      sealDoor.remove(o);
      o.position.sub(new THREE.Vector3(213, SEAL, -0.25));
      doorFallback.add(o);
    }
    const doorSlot = assetSlot('halo', 'halo_door', doorFallback);
    doorSlot.position.set(213, SEAL, -0.25);
    sealDoor.add(doorSlot);
  }

  private buildStele() {
    const gs = L.glyphStone;
    const fb = new THREE.Mesh(new THREE.BoxGeometry(1.24, 2.8, 0.4), eraMaterial({ color: '#d8c8a8', pattern: PATTERN.ruin }));
    fb.position.y = 1.4;
    const slot = assetSlot('halo', 'halo_stele', fb);
    slot.position.set(gs.x, SEAL, gs.z);
    this.group.add(slot);
    // the inscription, on the face toward the path and the camera
    const m = eraMaterial({ color: '#ffffff', roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0.6, transparent: true });
    m.map = this.steleTex.blur;
    m.emissiveMap = this.steleTex.blur;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 2.16), m);
    face.position.set(gs.x, SEAL + 1.56, gs.z + 0.212);
    this.group.add(face);
    return m;
  }


  /** The gate's progress ring: six segments, two lit (stuck on 2.0) until the stele is read. */
  private buildRing() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const ctx = cv.getContext('2d')!;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), mat);
    m.position.set(213, SEAL + 7.25, 1.2);
    this.group.add(m);
    const ring = { tex, ctx, shown: -1, mat };
    drawRing(ctx, 2, 0);
    tex.needsUpdate = true;
    return ring;
  }

  // ---------------------------------------------------------------- the Update Wave

  private buildWave() {
    const A = AQUEDUCT;
    // the missing span: a chunky low-poly deck with a parapet each side, drawn only in Early 3D
    const deck = new THREE.BoxGeometry(1, 0.5, A.halfD * 2);
    const rail = new THREE.BoxGeometry(1, 0.22, 0.16);
    const solid = eraMaterial({ color: '#b9a98c', pattern: PATTERN.stone, roughness: 0.9, onlyEra: 2 });
    const ghost = eraMaterial({ color: '#0d3a37', emissive: '#4ff5e6', emissiveIntensity: 0.8, transparent: true, opacity: 0.16, exceptEra: 2 });
    ghost.depthWrite = false;
    for (let i = 0; i < 7; i++) {
      const x = A.gap0 + i + 0.5;
      for (const mat of [solid, ghost]) {
        const d = new THREE.Mesh(deck, mat);
        d.position.set(x, SEAL - 0.25, 0);
        d.castShadow = mat === solid;
        d.receiveShadow = true;
        this.group.add(d);
        for (const z of [-A.halfD + 0.08, A.halfD - 0.08]) {
          const r = new THREE.Mesh(rail, mat);
          r.position.set(x, SEAL + 0.11, z);
          this.group.add(r);
        }
      }
    }
    // the wave's edges: two scan bars facing the camera (in front of the path) and two behind it
    for (const z of [WAVE.z1 + 0.1, WAVE.z0 - 0.1]) {
      for (let k = 0; k < 2; k++) {
        const b = new THREE.Mesh(new THREE.PlaneGeometry(0.5, WAVE.y1 - WAVE.y0), this.barMat);
        b.position.set(0, (WAVE.y0 + WAVE.y1) / 2, z);
        b.renderOrder = 4;
        this.bars.push(b);
        this.group.add(b);
      }
    }
    // and a gate of light standing across the deck at each edge, turned to face along the path, so the 3D camera
    // behind Pip sees where the bridge ends (the bars above are edge-on to it)
    for (let k = 0; k < 2; k++) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(AQUEDUCT.halfD * 2 + 0.6, 2.6), this.barMat);
      g.rotation.y = Math.PI / 2;
      g.position.set(0, SEAL + 1.3, 0);
      g.renderOrder = 4;
      this.edgeGates.push(g);
      this.group.add(g);
    }
  }

  // ---------------------------------------------------------------- the World Wheel

  private buildPlates() {
    for (const pl of PLATES) {
      const fb = new THREE.Mesh(new THREE.CylinderGeometry(0.74, 0.74, 0.07, 8), eraMaterial({ color: '#c9b99e', pattern: PATTERN.ruin }));
      fb.position.y = 0.035;
      const slot = assetSlot('halo', 'halo_plate', fb);
      slot.position.set(pl.x, SEAL, pl.z);
      this.group.add(slot);
      // a glow on the plate once installed
      const glow = new THREE.MeshBasicMaterial({ color: ERA_COLORS[pl.era], transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      const g = new THREE.Mesh(new THREE.CircleGeometry(0.66, 8), glow);
      g.rotation.x = -Math.PI / 2;
      g.position.set(pl.x, SEAL + 0.075, pl.z);
      this.group.add(g);
      this.plateGlow.push(glow);
      // a tablet behind the path naming the version, readable in 2D and 3D
      const tm = eraMaterial({ color: '#ffffff', roughness: 0.7, emissive: '#ffffff', emissiveIntensity: 0.15 });
      const tex = tabletTexture(pl.era);
      tm.map = tex;
      tm.emissiveMap = tex;
      const tab = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.75, 0.16), [stoneSide(), stoneSide(), stoneSide(), stoneSide(), tm, stoneSide()]);
      tab.position.set(pl.x, SEAL + 0.62, -2.1);
      tab.castShadow = true;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.16), stoneSide());
      post.position.set(pl.x, SEAL + 0.12, -2.1);
      this.group.add(tab, post);
      this.tablets.push(tm);
    }
  }

  private buildWheel() {
    const w = L.wheel;
    const daisFb = new THREE.Group();
    const stone = eraMaterial({ color: '#c9b99e', pattern: PATTERN.ruin });
    const step = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.6, 3), stone);
    step.position.y = 0.3;
    daisFb.add(step);
    for (const x of [-3.95, 3.95]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.76, 4.4, 0.8), stone);
      p.position.set(x, 2.8, 0);
      daisFb.add(p);
    }
    const dais = assetSlot('halo', 'halo_dais', daisFb);
    dais.position.set(w.x, SEAL, w.z - 0.7);
    this.group.add(dais);
    // the wheel turns: its model and the six segment faces in one group
    this.wheel.position.set(w.x, w.y, w.z);
    const fb = new THREE.Mesh(new THREE.TorusGeometry(L.wheelRadius - 0.32, 0.32, 10, 48), stone);
    this.wheel.add(assetSlot('halo', 'halo_wheel', fb));
    const R = L.wheelRadius;
    for (let i = 0; i < 6; i++) {
      // segment i spans 60°, generation 1 at the top, clockwise
      const tex = wedgeTexture(i);
      const m = eraMaterial({ color: '#2a2a36', roughness: 0.7, emissive: '#ffffff', emissiveIntensity: 0 });
      m.map = tex;
      m.emissiveMap = tex;
      const start = Math.PI / 2 - (i + 1) * (Math.PI / 3);
      const geo = new THREE.RingGeometry(0.72, R - 0.62, 24, 1, start + 0.06, Math.PI / 3 - 0.12);
      // map each wedge's texture across its own bounding box
      remapUV(geo);
      const wedge = new THREE.Mesh(geo, m);
      wedge.position.z = 0.12;
      this.wheel.add(wedge);
      this.wedges.push({ mat: m, flash: 0 });
    }
    this.group.add(this.wheel);
  }

  // ---------------------------------------------------------------- per frame

  update(g: Game, dt: number) {
    this.t += dt;
    // the gate's front only in 3D
    this.gateFront.visible = g.shift.blend > 0.5;
    // the stele: a blur of pixels where its world is stuck, sharp where full detail reaches it
    const gs = L.glyphStone;
    const steleEra = g.era.gameEraAt({ x: gs.x, y: gs.y + 1, z: gs.z });
    const sharp = steleEra >= 4 || g.save.glyphsRead;
    const tex = sharp ? this.steleTex.sharp : this.steleTex.blur;
    if (this.steleMat.map !== tex) {
      this.steleMat.map = tex;
      this.steleMat.emissiveMap = tex;
    }
    this.steleMat.emissiveIntensity = g.save.glyphsRead ? 1.1 + Math.sin(this.t * 2) * 0.2 : sharp ? 0.9 : 0.35;
    // the ring fills from 2 to 6 as the gate updates
    const want = g.save.glyphsRead ? 6 : 2;
    const fill = this.ring.shown < 0 ? want : Math.min(want, this.ring.shown + dt * 3);
    if (Math.abs(fill - this.ring.shown) > 1e-3) {
      this.ring.shown = fill;
      drawRing(this.ring.ctx, fill, this.t);
      this.ring.tex.needsUpdate = true;
    }
    // the Update Wave's edges
    const x0 = g.waveField.min.x;
    const x1 = g.waveField.max.x;
    this.bars.forEach((b, i) => (b.position.x = i % 2 ? x1 : x0));
    this.edgeGates.forEach((e, i) => {
      e.position.x = i ? x1 : x0;
      // only where the edge is over the gap (at the bridgeheads it would stand on solid stone for nothing)
      e.visible = g.shift.blend > 0.5 && e.position.x > AQUEDUCT.gap0 - 0.3 && e.position.x < AQUEDUCT.gap1 + 0.3;
    });
    this.barMat.uniforms.uTime.value = this.t;
    // the plates and the wheel
    PLATES.forEach((pl, i) => {
      const on = (g.save.installed & (1 << pl.era)) !== 0;
      this.plateGlow[i].opacity += ((on ? 0.55 : 0) - this.plateGlow[i].opacity) * Math.min(1, dt * 3);
      this.tablets[i].emissiveIntensity = on ? 0.9 : 0.15;
    });
    this.wedges.forEach((w, i) => {
      const on = (g.save.installed & (1 << i)) !== 0;
      w.flash = Math.max(0, w.flash - dt * 0.8);
      w.mat.emissiveIntensity = (on ? 0.85 : 0.04) + w.flash * 2.5;
      w.mat.color.set(on ? '#ffffff' : '#3a3a48');
    });
    this.wheel.rotation.z = -g.wheelTurn * Math.PI * 2;
  }

  dispose() {
    this.unsubAssets();
    this.unsubGame();
  }
}

// ---------------------------------------------------------------- materials and textures

let sideMat: THREE.Material | null = null;
const stoneSide = () => (sideMat ??= eraMaterial({ color: '#c9b99e', pattern: PATTERN.ruin, roughness: 0.9 }));


function barMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; varying vec2 vUv;
      void main() {
        float core = 1.0 - smoothstep(0.0, 0.5, abs(vUv.x - 0.5));
        float ends = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
        // a progress-bar stripe crawling up the bar
        float stripe = 0.75 + 0.25 * step(0.5, fract(vUv.y * 14.0 - uTime * 1.5));
        gl_FragColor = vec4(vec3(1.0, 0.82, 0.37) * core * core * ends * stripe * 0.9, 1.0);
      }`,
  });
}

/** The stele's inscription: rows of glyphs, the wheel's emblem, and "TURN ME GENTLY". Blurred: 16×32 pixels. */
function inscription(blur: boolean) {
  const W = 256;
  const H = 512;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#3c3a36';
  c.fillRect(0, 0, W, H);
  c.strokeStyle = c.fillStyle = '#5ff5e6';
  // the wheel emblem
  c.lineWidth = 7;
  c.beginPath();
  c.arc(W / 2, 110, 68, 0, Math.PI * 2);
  c.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 - Math.PI / 2;
    c.beginPath();
    c.moveTo(W / 2, 110);
    c.lineTo(W / 2 + Math.cos(a) * 68, 110 + Math.sin(a) * 68);
    c.stroke();
  }
  c.beginPath();
  c.arc(W / 2, 110, 14, 0, Math.PI * 2);
  c.fill();
  // glyph rows
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  c.lineWidth = 4;
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < 6; k++) {
      const x = 30 + k * 34;
      const y = 220 + row * 44;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + 10 + rnd() * 14, y + 6 + rnd() * 18);
      c.lineTo(x + rnd() * 20, y + 26);
      c.stroke();
      if (rnd() > 0.5) c.fillRect(x + 16, y + 2, 6, 6);
    }
  }
  c.font = 'bold 34px "Outfit", system-ui, sans-serif';
  c.textAlign = 'center';
  c.fillText('TURN ME', W / 2, 400);
  c.fillText('GENTLY', W / 2, 446);
  let src: HTMLCanvasElement = cv;
  if (blur) {
    // stuck on 2.0: the same inscription at 16×32 pixels, smeared
    const s = document.createElement('canvas');
    s.width = 16;
    s.height = 32;
    const sc = s.getContext('2d')!;
    sc.imageSmoothingEnabled = true;
    sc.drawImage(cv, 0, 0, 16, 32);
    src = s;
  }
  const t = new THREE.CanvasTexture(src);
  t.colorSpace = THREE.SRGBColorSpace;
  if (blur) t.magFilter = t.minFilter = THREE.NearestFilter;
  else t.anisotropy = 4;
  return t;
}

function drawRing(c: CanvasRenderingContext2D, fill: number, t: number) {
  const S = 256;
  c.clearRect(0, 0, S, S);
  for (let i = 0; i < 6; i++) {
    const a0 = -Math.PI / 2 + (i * Math.PI) / 3 + 0.05;
    const a1 = a0 + Math.PI / 3 - 0.1;
    const lit = Math.min(1, Math.max(0, fill - i));
    c.lineWidth = 22;
    c.strokeStyle = 'rgba(30, 50, 60, 0.75)';
    c.beginPath();
    c.arc(S / 2, S / 2, 100, a0, a1);
    c.stroke();
    if (lit > 0) {
      c.strokeStyle = ERA_COLORS[i];
      c.beginPath();
      c.arc(S / 2, S / 2, 100, a0, a0 + (a1 - a0) * lit);
      c.stroke();
    }
  }
  c.fillStyle = '#e8fbff';
  c.font = 'bold 64px "Outfit", system-ui, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(`${Math.max(2, Math.floor(fill + 1e-3))}.0`, S / 2, S / 2 + 2);
  void t;
}

function tabletTexture(era: number) {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 200;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#d9cbb0';
  c.fillRect(0, 0, 256, 200);
  c.fillStyle = ERA_COLORS[era];
  c.fillRect(0, 0, 256, 22);
  c.fillStyle = '#2b2a33';
  c.textAlign = 'center';
  // the version in that generation's own lettering: pixel capitals for the oldest two
  c.font = era <= 1 ? 'bold 84px "Press Start 2P", monospace' : 'bold 96px "Outfit", system-ui, sans-serif';
  c.fillText(`${era + 1}.0`, 128, era <= 1 ? 128 : 128);
  c.font = '600 26px "Outfit", system-ui, sans-serif';
  c.fillText(`${ERA_LABELS[era]} · ${ERA_YEARS[era]}`, 128, 178);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A wheel segment's face: its generation's colour, the version and the generation's name. */
function wedgeTexture(era: number) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(128, 128, 20, 128, 128, 180);
  g.addColorStop(0, ERA_COLORS[era]);
  g.addColorStop(1, '#1a1a24');
  c.fillStyle = g;
  c.fillRect(0, 0, 256, 256);
  c.fillStyle = '#ffffff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = era <= 1 ? 'bold 56px "Press Start 2P", monospace' : 'bold 72px "Outfit", system-ui, sans-serif';
  c.fillText(`${era + 1}.0`, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Stretch a geometry's UVs over its own bounding box (so each wheel segment shows its whole texture). */
function remapUV(geo: THREE.BufferGeometry) {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - b.min.x) / (b.max.x - b.min.x), (pos.getY(i) - b.min.y) / (b.max.y - b.min.y));
  uv.needsUpdate = true;
}

void smoothstep;
