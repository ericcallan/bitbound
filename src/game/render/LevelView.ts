import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { eraMaterial, eraUniforms, PATTERN, sharedEraMaterial } from './eraMaterial';
import { EraSwapRegistry, eras as E } from './eraSwap';
import { assetSlot, buildDecor, fillAssetSlots, M, type Animated, type AnimCtx } from './decor';
import { onAssetLoaded, preloadAssets } from './assets';
import { STAIR, STONE_BLOCKS, type Level, type SolidDef } from '../level/meadows';
import type { Era } from '../era/EraSystem';
import { rng } from '../math';

const LOOK_MAT = {
  dirt: () => sharedEraMaterial('dirt', { color: '#9a6440', pattern: PATTERN.dirt, retroTile: true }),
  grassCap: () => sharedEraMaterial('grassCap', { color: '#52c24a', pattern: PATTERN.grass, roughness: 0.9, retroTile: true }),
  stone: () => sharedEraMaterial('stoneSolid', { color: '#aaa3bc', pattern: PATTERN.stone, retroTile: true }),
  chamber: () => sharedEraMaterial('chamberFloor', { color: '#8a849e', pattern: PATTERN.stone, roughness: 0.55, retroTile: true }),
  ruin: () => sharedEraMaterial('ruinSolid', { color: '#c9b99e', pattern: PATTERN.ruin, retroTile: true }),
  hedge: () => eraMaterial({ color: '#2f8f4a', pattern: PATTERN.hedge, roughness: 0.95, retroTile: true }),
  wood: () => sharedEraMaterial('woodSolid', { color: '#a8703f', pattern: PATTERN.wood, retroTile: true }),
  metal: () => sharedEraMaterial('metalSolid', { color: '#6e7aa0', pattern: PATTERN.metal, metalness: 0.5, retroTile: true }),
  // Ground inside the immersive valley: replaced by the terrain in the 3D generations.
  valleyDirt: () => sharedEraMaterial('valleyDirt', { color: '#9a6440', pattern: PATTERN.dirt, hideInValley: true, retroTile: true }),
  valleyCap: () => sharedEraMaterial('valleyCap', { color: '#52c24a', pattern: PATTERN.grass, roughness: 0.9, hideInValley: true, retroTile: true }),
};
/** Solid blocks in the valley rebuilt as Blender stone (scripts/blender/create_gateway.py). */
const VALLEY_BLOCKS = new Set(STONE_BLOCKS);

/** The sun as seen in the sky (and the source of Beyond's light shafts): low, behind the lane. */
export const SKY_SUN = new THREE.Vector3(-0.38, 0.3, -0.87).normalize();

export interface Occluder {
  box: { min: THREE.Vector3; max: THREE.Vector3 };
  mats: THREE.Material[];
  opacity: number;
}

export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
export const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; uniform vec3 uSunDir; uniform float uDim;
void main() {
  float h = vDir.y;
  vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.6)) : mix(uHorizon, uBottom, pow(-h, 0.5));
  float sun = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
  col += vec3(1.0, 0.92, 0.7) * (pow(sun, 900.0) * 6.0 + pow(sun, 60.0) * 0.5 + pow(sun, 8.0) * 0.18);
  gl_FragColor = vec4(col * uDim, 1.0);
}`;

const WATERFALL_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
void main() {
  float stripes = sin(vUv.y * 50.0 + uTime * 14.0 + sin(vUv.x * 18.0) * 2.0);
  float foam = smoothstep(0.92, 1.0, stripes);
  vec3 col = mix(vec3(0.25, 0.62, 0.95), vec3(0.55, 0.85, 1.0), 0.5 + 0.5 * stripes);
  col = mix(col, vec3(1.0), foam * 0.7);
  float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
  gl_FragColor = vec4(col * 1.1, 0.85 * edge);
}`;
const WATERFALL_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Wind + Pip-push for Beyond's dense grass (runs in world space, `transformed.y` is blade height). */
export const GRASS_WIND = /* glsl */ `
  float bladeH = clamp(transformed.y / 0.36, 0.0, 1.0);
  vec2 wind = vec2(sin(uTime * 1.7 + wp.x * 0.6 + wp.z * 0.4), cos(uTime * 1.3 + wp.x * 0.3 - wp.z * 0.2)) * 0.11;
  vec2 toPip = wp.xz - uPip.xz;
  float dp = length(toPip);
  vec2 push = dp < 1.1 && abs(wp.y - uPip.y) < 1.0 ? normalize(toPip + 1e-4) * (1.1 - dp) * 0.55 : vec2(0.0);
  wp.xz += (wind + push) * bladeH * bladeH;
  wp.y -= length(push) * 0.25 * bladeH;
`;

/** Builds and animates the static world: terrain, ruins, decor, water, background, sky. */
export class LevelView {
  group = new THREE.Group();
  eras = new EraSwapRegistry();
  private unsubAssets: () => void;
  /** Generation-masked laser walls; GameView shows them only where they exist. */
  /** Generation-masked solids; GameView tells each one whether its collider exists right now. */
  masked: { id: string; set: (on: boolean, t: number) => void }[] = [];
  occluders: Occluder[] = [];
  private anims: Animated[] = [];
  private clouds: THREE.Object3D[] = [];
  private waterfallMats: THREE.ShaderMaterial[] = [];
  laneMat: THREE.MeshBasicMaterial;
  skyMat: THREE.ShaderMaterial;
  /** The procedural sky dome (the modern generations swap in the real sky). */
  skyMesh!: THREE.Mesh;
  frameEngine = new THREE.Group();
  private holoRings: THREE.Mesh[] = [];
  /** Pip's position for grass push (shared uniform). */
  static pipUniform = eraUniforms.uPip;

  constructor(private level: Level) {
    for (const s of level.solids) this.buildSolid(s);
    this.buildFacadeDetail();
    this.buildMural();
    for (const d of level.decor) {
      const { obj, anim } = buildDecor(d, this.eras);
      this.group.add(obj);
      if (anim) this.anims.push(anim);
    }
    // Blender assets replace their placeholders as they arrive.
    fillAssetSlots(this.group);
    this.unsubAssets = onAssetLoaded(() => fillAssetSlots(this.group));
    void preloadAssets();
    this.buildGrass();
    this.buildWater();
    this.buildBackground();
    this.laneMat = new THREE.MeshBasicMaterial({
      color: '#4ff5e6',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.buildLane();
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color('#2f6fd8') },
        uHorizon: { value: new THREE.Color('#bfeaff') },
        uBottom: { value: new THREE.Color('#7fb7e6') },
        uSunDir: { value: SKY_SUN.clone() },
        uDim: { value: 1 },
      },
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), this.skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.group.add(sky);
    this.skyMesh = sky;
    // Chapter 1's sky is a single flat colour, drawn by the post pass where nothing renders.
    this.eras.add(sky, E(1, 5), false, new THREE.Vector3(60, 0, 0));
  }

  private buildSolid(s: SolidDef) {
    if (!VALLEY_BLOCKS.has(s.id)) return this.buildSolidInner(s);
    // Steps, slabs and plinths in the valley: weathered Blender stone, exactly collider-sized, from Modern HD up.
    const before = this.group.children.length;
    this.buildSolidInner(s);
    const old = new THREE.Group();
    for (const o of this.group.children.splice(before)) old.add(o);
    const { min, max } = s.box;
    const anchor = new THREE.Vector3((min.x + max.x) / 2, max.y, (min.z + max.z) / 2);
    const hd = assetSlot('gateway', `block_${s.id}`, new THREE.Group());
    hd.position.set(anchor.x, min.y, anchor.z);
    this.group.add(old, hd);
    this.eras.add(old, E(0, 3), false, anchor);
    this.eras.add(hd, E(4, 5), false, anchor);
  }

  private buildSolidInner(s: SolidDef) {
    if (s.look === 'invisible') return;
    const { min, max } = s.box;
    const w = max.x - min.x;
    const h = max.y - min.y;
    const d = max.z - min.z;
    const cx = (min.x + max.x) / 2;
    const cy = (min.y + max.y) / 2;
    const cz = (min.z + max.z) / 2;
    if (s.look === 'beam') {
      // An old light fence: threads of warm light strung between carved posts. Too fine for 8-bit.
      const beamMat = eraMaterial({ color: '#5a3a10', emissive: '#ffcf6b', emissiveIntensity: 3, transparent: true, opacity: 0.85 });
      const postMat = eraMaterial({ color: '#c9b99e', pattern: PATTERN.ruin, roughness: 0.85 });
      const glyphMat = eraMaterial({ color: '#0f5e57', emissive: '#2fd6c3', emissiveIntensity: 1.6 });
      const beams = new THREE.Group();
      for (let y = min.y + 0.35; y < max.y - 0.1; y += 0.42) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, d - 0.3, 6), beamMat);
        b.rotation.x = Math.PI / 2;
        b.position.set(cx, y, cz);
        beams.add(b);
      }
      this.group.add(beams);
      for (const z of [min.z + 0.15, max.z - 0.15]) {
        const post = new THREE.Mesh(new RoundedBoxGeometry(0.42, h + 0.3, 0.42, 2, 0.06), postMat);
        post.position.set(cx, cy + 0.15, z);
        post.castShadow = post.receiveShadow = true;
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.1, 0.44), glyphMat);
        band.position.set(cx, max.y - 0.3, z);
        this.group.add(post, band);
      }
      this.masked.push({
        id: s.id,
        set: (on, t) => {
          beams.visible = on;
          beamMat.emissiveIntensity = 2.6 + Math.sin(t * 3 + cx) * 0.5;
        },
      });
      return;
    }
    if (s.look === 'relief') {
      // A carved handhold: always visible as a worn carving, solid (and bright) only when Stylized.
      const mat = eraMaterial({ color: '#d8c8a8', pattern: PATTERN.ruin, roughness: 0.9, transparent: true });
      const ink = eraMaterial({ color: '#2b2d6e', emissive: '#8e5bd6', emissiveIntensity: 0.4, transparent: true });
      const slab = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.08), mat);
      slab.position.set(cx, cy, cz);
      slab.castShadow = slab.receiveShadow = true;
      // carved spiral motif on the front face
      const motif = new THREE.Mesh(new THREE.TorusGeometry(Math.min(w, h) * 0.32, 0.03, 6, 20), ink);
      motif.position.set(cx, cy, max.z + 0.01);
      this.group.add(slab, motif);
      this.masked.push({
        id: s.id,
        set: (on, t) => {
          mat.opacity = on ? 1 : 0.32 + Math.sin(t * 2 + cx) * 0.06;
          mat.depthWrite = on;
          ink.opacity = mat.opacity;
          ink.emissiveIntensity = on ? 1.4 : 0.3;
        },
      });
      return;
    }
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      m.castShadow = true;
      return m;
    };
    if (s.look === 'grass') {
      // All ground: the valley terrain takes over its look from Early 3D up.
      const valley = s.kind === 'ground';
      const dirt = valley ? LOOK_MAT.valleyDirt() : LOOK_MAT.dirt();
      const capMat = valley ? LOOK_MAT.valleyCap() : LOOK_MAT.grassCap();
      const capH = Math.min(0.32, h * 0.5);
      const body = mk(new THREE.BoxGeometry(w, h - capH, d), dirt);
      body.position.set(cx, min.y + (h - capH) / 2, cz);
      const cap = mk(new RoundedBoxGeometry(w + 0.08, capH + 0.04, d + 0.08, 2, 0.04), capMat);
      cap.position.set(cx, max.y - capH / 2 + 0.005, cz);
      this.group.add(body, cap);
      // Chunky grassy overhang lip on the front face in the pixel generations.
      for (let x = min.x + 0.25; x < max.x - 0.2; x += 0.5) {
        const lip = mk(new THREE.BoxGeometry(0.5, 0.16, 0.06), capMat);
        lip.position.set(x, max.y - capH - 0.06 - (Math.floor(x * 2) % 2) * 0.08, max.z + 0.05);
        this.group.add(lip);
        this.eras.add(lip, E(0, 1), false, lip.position.clone());
      }
      return;
    }
    let mat: THREE.Material;
    switch (s.look) {
      case 'stone':
        mat = s.id === 'chamberFloor' ? LOOK_MAT.chamber() : LOOK_MAT.stone();
        break;
      case 'ruin':
        mat = s.occluder ? eraMaterial({ color: '#c9b99e', pattern: PATTERN.ruin, retroTile: true }) : LOOK_MAT.ruin();
        break;
      case 'mural':
        mat = eraMaterial({ color: '#d8c8a8', pattern: PATTERN.ruin, roughness: 0.9 });
        break;
      case 'hedge':
        // A masked hedge needs its own material so it can fade on its own.
        mat = s.genMask !== undefined ? eraMaterial({ color: '#2f8f45', pattern: PATTERN.hedge, roughness: 0.85, transparent: true, retroTile: true }) : LOOK_MAT.hedge();
        break;
      case 'wood':
        mat = LOOK_MAT.wood();
        break;
      default:
        mat = LOOK_MAT.metal();
    }
    const round = s.look === 'stone' && w < 4 ? 0.08 : 0;
    const geo = round ? new RoundedBoxGeometry(w, h, d, 2, round) : new THREE.BoxGeometry(w, h, d);
    const mesh = mk(geo, mat);
    mesh.position.set(cx, cy, cz);
    this.group.add(mesh);
    if (s.look === 'hedge') {
      const grp = new THREE.Group();
      const r = rng(7);
      const lm = [eraMaterial({ color: '#3fae4a', roughness: 0.8 }), eraMaterial({ color: '#258a45', roughness: 0.8 })];
      // A soft leafy crown along the top, kept inside the hedge footprint so it never blocks the camera.
      for (let i = 0; i < 7; i++) {
        const sp = new THREE.Mesh(new THREE.SphereGeometry(0.38 + r() * 0.12, 14, 10), r() > 0.5 ? lm[0] : lm[1]);
        sp.position.set(min.x + 0.45 + (i / 6) * (w - 0.9), max.y - 0.05, cz + (r() - 0.5) * 0.3);
        sp.castShadow = true;
        grp.add(sp);
      }
      this.group.add(grp);
      this.eras.add(grp, E(1, 5), true, new THREE.Vector3(cx, cy, cz));
      if (s.genMask !== undefined) {
        // Brambles over the path: in 16-bit they're the foreground layer, drawn see-through.
        const mats = [mat, ...lm];
        for (const m of mats) m.transparent = true;
        this.masked.push({
          id: s.id,
          set: (on) => {
            for (const m of mats) {
              m.opacity = on ? 1 : 0.38;
              m.depthWrite = on;
            }
          },
        });
        return;
      }
      this.occluders.push({ box: { min: new THREE.Vector3(min.x, min.y, min.z), max: new THREE.Vector3(max.x, max.y + 1, max.z + 0.5) }, mats: [mat, ...lm], opacity: 1 });
      return;
    }
    if (s.occluder) {
      this.occluders.push({ box: { min: new THREE.Vector3(min.x, min.y, min.z), max: new THREE.Vector3(max.x, max.y, max.z) }, mats: [mat], opacity: 1 });
    }
    if (s.id === 'devicePedestal') {
      const top = mk(new RoundedBoxGeometry(1.0, 0.12, 1.0, 2, 0.04), M.ruinDark());
      top.position.set(cx, max.y + 0.06, cz);
      this.group.add(top);
      const band = mk(new THREE.BoxGeometry(w + 0.02, 0.08, d + 0.02), M.rune());
      band.position.set(cx, min.y + h * 0.6, cz);
      this.group.add(band);
    }
  }

  /** The ruined facade that hides the chamber: pillars, cornice and glowing runes. */
  private buildFacadeDetail() {
    const facade = this.level.solids.find((s) => s.id === 'facade')!;
    const { min, max } = facade.box;
    const occ = this.occluders.find((o) => o.box.min.x === min.x && o.box.min.z === min.z)!;
    const pillarMat = eraMaterial({ color: '#b5a68c', pattern: PATTERN.ruin });
    const runeMat = eraMaterial({ color: '#0f5e57', emissive: '#2fd6c3', emissiveIntensity: 1.4 });
    occ.mats.push(pillarMat, runeMat);
    for (let x = min.x + 0.5; x <= max.x - 0.4; x += 2.3) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, max.y - min.y, 0.3), pillarMat);
      p.position.set(x, (min.y + max.y) / 2, max.z + 0.1);
      p.castShadow = p.receiveShadow = true;
      this.group.add(p);
    }
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(max.x - min.x + 0.4, 0.45, 0.9), pillarMat);
    cornice.position.set((min.x + max.x) / 2, max.y + 0.2, (min.z + max.z) / 2 + 0.1);
    cornice.castShadow = true;
    this.group.add(cornice);
    const rune = new THREE.Mesh(new THREE.BoxGeometry(max.x - min.x - 1, 0.1, 0.05), runeMat);
    rune.position.set((min.x + max.x) / 2, max.y - 0.6, max.z + 0.27);
    this.group.add(rune);
    // A carved eye glyph: the facade is watching.
    const glyph = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.08, 6, 20), runeMat);
    glyph.position.set((min.x + max.x) / 2 + 0.5, 2.6, max.z + 0.05);
    this.group.add(glyph);
    const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), runeMat);
    pupil.position.copy(glyph.position);
    pupil.rotation.z = Math.PI / 4;
    this.group.add(pupil);
    // Crumbled blocks at its base
    const r = rng(11);
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.4 + r() * 0.3, 0.3 + r() * 0.2, 0.4), pillarMat);
      b.position.set(min.x + 1 + r() * (max.x - min.x - 2), 0.15, max.z + 0.25);
      b.rotation.y = r();
      this.group.add(b);
    }
  }

  /** Static art on the mural wall: a painted sun, the climbing figure, a frame. (Steps live in EntityViews.) */
  private buildMural() {
    const w = STAIR.wall;
    const z = w.z1 + 0.012;
    const occ = this.occluders.find((o) => o.box.min.x === w.x0 && o.box.min.z === w.z0);
    const paint = (color: string, emissive = 0) =>
      eraMaterial({ color, emissive: emissive ? color : '#000000', emissiveIntensity: emissive, roughness: 0.95, transparent: true });
    const mats: THREE.Material[] = [];
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      this.group.add(m);
      mats.push(mat);
      return m;
    };
    // frame
    const frameMat = paint('#7a4a2e');
    add(new THREE.PlaneGeometry(w.x1 - w.x0 - 0.4, 0.18), frameMat, (w.x0 + w.x1) / 2, w.top - 0.5);
    add(new THREE.PlaneGeometry(w.x1 - w.x0 - 0.4, 0.18), frameMat, (w.x0 + w.x1) / 2, 0.3);
    // sun
    add(new THREE.CircleGeometry(1.1, 24), paint('#ffcf6b', 0.25), w.x0 + 2.2, 9.8);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const ray = add(new THREE.PlaneGeometry(0.16, 0.6), paint('#f0862a'), w.x0 + 2.2 + Math.cos(a) * 1.55, 9.8 + Math.sin(a) * 1.55);
      ray.rotation.z = a + Math.PI / 2;
    }
    // a painted little robot at the top of the stair, waving: Pip's ancestor?
    add(new THREE.PlaneGeometry(0.7, 0.6), paint('#fff4d6'), w.x1 - 1.0, 10.1);
    add(new THREE.PlaneGeometry(0.5, 0.32), paint('#141a33'), w.x1 - 1.0, 10.1);
    add(new THREE.PlaneGeometry(0.5, 0.5), paint('#f0862a'), w.x1 - 1.0, 9.55);
    add(new THREE.PlaneGeometry(0.06, 0.3), paint('#8e5bd6'), w.x1 - 0.9, 10.55);
    // teal glyph band
    add(new THREE.PlaneGeometry(w.x1 - w.x0 - 1.2, 0.08), paint('#2fd6c3', 1.2), (w.x0 + w.x1) / 2, w.top - 0.85);
    occ?.mats.push(...mats);
  }

  /** Grass blades: sparse in Stylized/Modern; dense with wind and Pip push in Beyond. */
  private buildGrass() {
    const tops = this.level.solids.filter((s) => s.look === 'grass');
    const r = rng(42);
    const layer = (geo: THREE.BufferGeometry, mat: THREE.Material, per: number, mask: number, minScale: number, varScale: number) => {
      for (const s of tops) {
        const w = s.box.max.x - s.box.min.x;
        const count = Math.floor(w * per * Math.min(1, (s.box.max.z - s.box.min.z) / 5.5));
        if (count <= 0) continue;
        const inst = new THREE.InstancedMesh(geo, mat, count);
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const e = new THREE.Euler();
        for (let i = 0; i < count; i++) {
          const x = s.box.min.x + r() * w;
          const z = s.box.min.z + 0.1 + r() * (s.box.max.z - s.box.min.z - 0.2);
          e.set((r() - 0.5) * 0.4, r() * 3, (r() - 0.5) * 0.4);
          q.setFromEuler(e);
          const sc = minScale + r() * varScale;
          m.compose(new THREE.Vector3(x, s.box.max.y, z), q, new THREE.Vector3(sc, sc, sc));
          inst.setMatrixAt(i, m);
        }
        inst.receiveShadow = true;
        inst.frustumCulled = false;
        this.group.add(inst);
        const c = new THREE.Vector3((s.box.min.x + s.box.max.x) / 2, s.box.max.y, 0);
        this.eras.add(inst, mask, false, c);
      }
    };
    const sparse = new THREE.ConeGeometry(0.035, 0.32, 3);
    sparse.translate(0, 0.16, 0);
    layer(sparse, eraMaterial({ color: '#5fd05a', roughness: 0.9, hideInValley: true }), 26, E(3, 4), 0.6, 0.9);
    // Beyond: thin curved blades, three times denser, swaying in the wind and parting around Pip.
    const blade = new THREE.PlaneGeometry(0.05, 0.36, 1, 3);
    blade.translate(0, 0.18, 0);
    const pos = blade.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setX(i, pos.getX(i) * (1 - y / 0.36));
      pos.setZ(i, (y / 0.36) * (y / 0.36) * 0.08);
    }
    blade.computeVertexNormals();
    const dense = eraMaterial({ color: '#63c95a', roughness: 0.7, side: THREE.DoubleSide, vertexWorld: GRASS_WIND, hideInValley: true });
    layer(blade, dense, 80, E(5), 0.7, 1.0);
  }

  /** Water at the bottom of each pit: flat in pixel eras, reflective and rippling in Beyond. */
  private buildWater() {
    const mat = eraMaterial({ color: '#2a78b8', roughness: 0.06, metalness: 0.0, pattern: PATTERN.water, transparent: true, opacity: 0.92, hideInValley: true, retroTile: true });
    for (const p of this.level.pits) {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(p.x1 - p.x0, 5.5, 24, 6), mat);
      water.rotation.x = -Math.PI / 2;
      water.position.set((p.x0 + p.x1) / 2, p.y, -0.25);
      water.receiveShadow = true;
      this.group.add(water);
    }
  }

  private buildBackground() {
    const r = rng(99);
    const L = this.level;
    // Rolling hills (mid layer) — chunky steps in 8-bit, low-poly in early 3D, soft domes otherwise.
    const hillMats = [
      // The valley terrain replaces these inside the slice from Early 3D up.
      sharedEraMaterial('hill1', { color: '#58b956', pattern: PATTERN.grass, hideInValley: true, retroTile: true }),
      sharedEraMaterial('hill2', { color: '#3f9f57', pattern: PATTERN.grass, hideInValley: true, retroTile: true }),
      sharedEraMaterial('hill3', { color: '#7fcf6a', pattern: PATTERN.grass, hideInValley: true, retroTile: true }),
    ];
    const islandTop = sharedEraMaterial('islandTop', { color: '#58b956', pattern: PATTERN.grass });
    for (let i = 0; i < 36; i++) {
      const x = -30 + i * 6.5 + r() * 4;
      const z = -18 - r() * 26;
      const rad = 5 + r() * 7;
      const mat = hillMats[i % 3];
      const pos = new THREE.Vector3(x, -3.2, z);
      const g = new THREE.Group();
      g.position.copy(pos);
      const h8 = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(rad * 2 * (1 - k * 0.3), rad * 0.22, rad), mat);
        b.position.y = k * rad * 0.22 + rad * 0.11;
        h8.add(b);
      }
      const hL = new THREE.Mesh(new THREE.SphereGeometry(rad, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      hL.scale.y = 0.55;
      const hR = new THREE.Mesh(new THREE.SphereGeometry(rad, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      hR.scale.y = 0.55;
      hR.receiveShadow = true;
      // No backdrop hills in 8-bit: the first consoles had one flat background layer.
      this.eras.variants(g, [[hL, E(2)], [hR, E(1, 5, [2])]], pos, false);
      void h8;
      this.group.add(g);
    }
    // Distant mountains
    // (in 2D 16-bit the painted parallax replaces these)
    const mtn = sharedEraMaterial('mtn', { color: '#8b9fd8', retroTile: true });
    const snow = sharedEraMaterial('snow', { color: '#f2f6ff', retroTile: true });
    for (let i = 0; i < 18; i++) {
      const h = 30 + r() * 30;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(h * 0.8, h, 5 + Math.floor(r() * 3)), mtn);
      cone.position.set(-60 + i * 22 + r() * 10, h / 2 - 8, -160 - r() * 60);
      cone.rotation.y = r() * 3;
      this.group.add(cone);
      // Modern HD and Beyond have the valley's own mountains under a real sky.
      this.eras.add(cone, E(1, 3), false);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(h * 0.8 * 0.25, h * 0.25, cone.geometry.parameters.radialSegments), snow);
      cap.position.set(cone.position.x, cone.position.y + h * 0.375, cone.position.z);
      cap.rotation.y = cone.rotation.y;
      this.group.add(cap);
      this.eras.add(cap, E(1, 3), false);
    }
    // Clouds
    for (let i = 0; i < 24; i++) {
      const g = new THREE.Group();
      const pos = new THREE.Vector3(-30 + r() * 200, 10 + r() * 16, -25 - r() * 70);
      g.position.copy(pos);
      const c8 = new THREE.Group();
      const cL = new THREE.Group();
      const cR = new THREE.Group();
      const n = 3 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const rad = 1.2 + r() * 1.6;
        const x = (k - n / 2) * 1.7;
        const b = new THREE.Mesh(new THREE.BoxGeometry(rad * 2, rad * 1.2, rad * 1.2), M.cloud());
        b.position.set(x, 0, 0);
        c8.add(b);
        const l = new THREE.Mesh(new THREE.IcosahedronGeometry(rad, 0), M.cloud());
        l.position.set(x, r() * 0.8, 0);
        cL.add(l);
        const s = new THREE.Mesh(new THREE.SphereGeometry(rad, 16, 10), M.cloud());
        s.position.set(x, r() * 0.8, 0);
        cR.add(s);
      }
      // 8-bit clouds are drawn by the tile renderer; Modern HD and Beyond have the real sky's clouds.
      this.eras.variants(g, [[cL, E(2)], [cR, E(1, 3, [2])]], pos, false);
      g.userData.speed = 0.3 + r() * 0.5;
      this.clouds.push(g);
      this.group.add(g);
    }
    // Background cliff + waterfall behind the moving-platform pit.
    const cliff = new THREE.Mesh(new THREE.BoxGeometry(5, 15, 2), sharedEraMaterial('oldCliff', { color: '#aaa3bc', pattern: PATTERN.stone, hideInValley: true, retroTile: true }));
    cliff.position.set(49.2, -1, -15);
    cliff.receiveShadow = true;
    this.group.add(cliff);
    const cliffTop = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.4, 2.2), LOOK_MAT.valleyCap());
    cliffTop.position.set(49.2, 6.6, -15);
    this.group.add(cliffTop);
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 15), this.waterfallMaterial());
    fall.position.set(49.2, -1, -13.95);
    this.group.add(fall);
    // A deep meadow floor far below so pits read as height, not void.
    const deep = new THREE.Mesh(new THREE.PlaneGeometry(700, 300), sharedEraMaterial('deep', { color: '#3f8f5a', hideInValley: true, retroTile: true }));
    deep.rotation.x = -Math.PI / 2;
    deep.position.set(70, -12, -100);
    this.group.add(deep);
    // 8-bit has nothing behind the play layer but the flat sky.
    for (const o of [cliff, cliffTop, deep]) this.eras.add(o, E(1, 5), false);
    // Retired: from Early 3D up the valley has its own river, and 16-bit has its painted backdrop.
    fall.visible = false;

    // The Frame Engine — a vast ancient ring on the horizon, revealed at the finale.
    const ringMat = eraMaterial({ color: '#4b4566', metalness: 0.7, roughness: 0.3, pattern: PATTERN.metal });
    const glowMat = eraMaterial({ color: '#0f5e57', emissive: '#2fd6c3', emissiveIntensity: 2.6 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(26, 2.4, 12, 96), ringMat);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(21, 0.5, 8, 96), glowMat);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(15, 1.0, 4, 4), ringMat);
    frame.rotation.z = Math.PI / 4;
    this.frameEngine.add(ring, inner, frame);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const strut = new THREE.Mesh(new THREE.BoxGeometry(1.5, 6, 1.5), ringMat);
      strut.position.set(Math.cos(a) * 26, Math.sin(a) * 26, 0);
      strut.rotation.z = a;
      this.frameEngine.add(strut);
    }
    // Holographic rings: only rendered once the world reaches its modern generations.
    for (let i = 0; i < 4; i++) {
      const holo = new THREE.Mesh(
        new THREE.TorusGeometry(30 + i * 4.5, 0.18 + i * 0.05, 4, 128),
        new THREE.MeshBasicMaterial({ color: i % 2 ? '#8e5bd6' : '#6ff6ff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      );
      holo.rotation.x = 0.3 * i;
      this.frameEngine.add(holo);
      this.holoRings.push(holo);
      this.eras.add(holo, E(4, 5), false, new THREE.Vector3(L.bounds.maxX + 25, 30, -95));
    }
    // A shimmering portal face inside the frame
    const portal = new THREE.Mesh(
      new THREE.CircleGeometry(20.5, 64),
      new THREE.MeshBasicMaterial({ color: '#2fd6c3', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.frameEngine.add(portal);
    this.frameEngine.position.set(L.bounds.maxX + 25, 30, -95);
    this.frameEngine.rotation.y = -0.45;
    this.group.add(this.frameEngine);
  }

  private waterfallMaterial() {
    const m = new THREE.ShaderMaterial({
      vertexShader: WATERFALL_VERT,
      fragmentShader: WATERFALL_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
    });
    this.waterfallMats.push(m);
    return m;
  }

  /** Glowing guide marking the 2D plane while in 3D. */
  private buildLane() {
    const tops = this.level.solids.filter(
      (s) => (s.kind === 'ground' || s.kind === 'bridge') && s.box.min.z < 0 && s.box.max.z > 0 && !s.only2d,
    );
    for (const s of tops) {
      if (s.id === 'step1' || s.id === 'step2') continue;
      const w = s.box.max.x - s.box.min.x;
      for (const [z, wd] of [[0, 0.07], [0.6, 0.03], [-0.6, 0.03]] as const) {
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, wd), this.laneMat);
        strip.rotation.x = -Math.PI / 2;
        strip.position.set((s.box.min.x + s.box.max.x) / 2, s.box.max.y + 0.03, z);
        strip.userData.bridge = s.id === 'bridgeMid';
        this.group.add(strip);
      }
    }
  }

  dispose() {
    this.unsubAssets();
  }

  update(t: number, dt: number, ctx: AnimCtx, eraAt: (p: THREE.Vector3) => Era) {
    this.eras.update(eraAt, dt);
    for (const a of this.anims) a.update(t, ctx);
    for (const m of this.waterfallMats) m.uniforms.uTime.value = t;
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 190) c.position.x = -40;
    }
    this.frameEngine.rotation.z += dt * 0.02;
    (this.frameEngine.children[2] as THREE.Mesh).rotation.z -= dt * 0.05;
    this.holoRings.forEach((h, i) => {
      h.rotation.y = t * (0.05 + i * 0.03) * (i % 2 ? -1 : 1);
      h.rotation.x = 0.3 * i + Math.sin(t * 0.2 + i) * 0.2;
    });
    LevelView.pipUniform.value.copy(ctx.pip);
  }
}
