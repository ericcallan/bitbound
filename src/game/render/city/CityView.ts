import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { eraMaterial, PATTERN, sharedEraMaterial } from '../eraMaterial';
import { LEDGES, LANE_Z, PLAZA_Y, ROOF_Y, type Verge } from '../../level/verge';
import type { SolidDef } from '../../level/meadows';
import type { Game } from '../../sim/Game';
import { rng } from '../../math';
import { SKY_FRAG, SKY_VERT } from '../LevelView';

/** Night palette for the city. */
export const NEON = { pink: '#ff3ea5', cyan: '#3ef4ff', amber: '#ffb347', violet: '#9b5cff', red: '#ff3344', lime: '#b6ff4a' };

const HOLO_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const HOLO_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tMap;
uniform float uTime;
uniform vec3 uTint;
uniform float uGlitch;
void main() {
  vec2 uv = vUv;
  float band = step(0.985, fract(uv.y * 3.0 - uTime * 0.25));
  uv.x += (sin(uTime * 23.0 + uv.y * 80.0) * 0.004 + band * 0.02) * uGlitch;
  vec4 t = texture2D(tMap, uv);
  float scan = 0.8 + 0.2 * sin(uv.y * 420.0 + uTime * 6.0);
  float edge = smoothstep(0.0, 0.03, uv.x) * smoothstep(1.0, 0.97, uv.x) * smoothstep(0.0, 0.03, uv.y) * smoothstep(1.0, 0.97, uv.y);
  vec3 col = (t.rgb * uTint + band * 0.6) * scan * 2.2;
  gl_FragColor = vec4(col, (t.a * 0.85 + 0.08) * edge);
}`;

const PUDDLE_VERT = /* glsl */ `
uniform mat4 textureMatrix;
varying vec4 vUvR;
varying vec3 vWorld;
void main() {
  vUvR = textureMatrix * vec4(position, 1.0);
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const PUDDLE_FRAG = /* glsl */ `
uniform vec3 color;
uniform sampler2D tDiffuse;
uniform float uTime;
varying vec4 vUvR;
varying vec3 vWorld;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 p = vWorld.xz * 0.33;
  float puddle = smoothstep(0.52, 0.66, n(p) * 0.6 + n(p * 2.3) * 0.4);
  // rain rings
  vec2 cell = floor(vWorld.xz * 1.6);
  vec2 f = fract(vWorld.xz * 1.6) - 0.5;
  float ph = fract(uTime * 0.9 + h(cell) * 7.0);
  float ring = smoothstep(0.05, 0.0, abs(length(f) - ph * 0.5)) * (1.0 - ph) * step(0.6, h(cell + 3.0));
  vec4 uv = vUvR;
  uv.xy += vec2(ring * 0.03, ring * 0.02) * uv.w;
  vec3 refl = texture2DProj(tDiffuse, uv).rgb;
  gl_FragColor = vec4(refl * color, puddle * 0.85);
}`;

function canvasText(text: string, opts: { w: number; h: number; color: string; bg?: string; font?: string; sub?: string; glow?: boolean }) {
  const c = document.createElement('canvas');
  c.width = opts.w;
  c.height = opts.h;
  const ctx = c.getContext('2d')!;
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.fillStyle = opts.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = opts.font ?? `800 ${Math.round(opts.h * 0.5)}px Outfit, sans-serif`;
  if (opts.glow !== false) {
    ctx.shadowColor = opts.color;
    ctx.shadowBlur = opts.h * 0.08;
  }
  ctx.fillText(text, c.width / 2, opts.sub ? c.height * 0.4 : c.height / 2);
  if (opts.sub) {
    ctx.font = `400 ${Math.round(opts.h * 0.16)}px Outfit, sans-serif`;
    ctx.fillText(opts.sub, c.width / 2, c.height * 0.78);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** ARCHIVE's propaganda and the city's brands. All invented. */
const SIGNS = [
  ['FIDELITY IS COMFORT', NEON.cyan],
  ['STAY SMALL · STAY SAFE', NEON.pink],
  ['16 COLOURS · 0 WORRIES', NEON.amber],
  ['ARCHIVE', NEON.violet],
  ['LOW-RES LIVING', NEON.lime],
  ['CENSOR DIVISION', NEON.red],
  ['NOODLE 24/7', NEON.amber],
  ['DREAM RENTAL', NEON.pink],
  ['SYNTH REPAIR', NEON.cyan],
];

export class CityView {
  group = new THREE.Group();
  /** Neon point lights (kept to a handful). */
  lights: THREE.PointLight[] = [];
  private holoMats: THREE.ShaderMaterial[] = [];
  /** Rain lives outside `group` so the epilogue can use it under the opened dome. */
  rain: THREE.InstancedMesh;
  private sky: THREE.Mesh;
  private rainSeeds: Float32Array;
  private traffic: THREE.InstancedMesh;
  private trafficSeeds: Float32Array;
  private steam: THREE.Mesh[] = [];
  private shutter!: THREE.Group;
  private door!: THREE.Group;
  private codeSign!: THREE.Mesh;
  private codeTexReal: THREE.CanvasTexture;
  private codeTexCensored: THREE.CanvasTexture;
  private core = new THREE.Group();
  private coreRings: THREE.Mesh[] = [];
  private emitterPickup = new THREE.Group();
  private healthPickups: { obj: THREE.Group; id: string }[] = [];
  private terminalScreen!: THREE.MeshStandardMaterial;
  private doorPanel!: THREE.MeshStandardMaterial;
  private lasers: { mesh: THREE.Mesh; id: string }[] = [];
  private graffiti: { mesh: THREE.Mesh; id: string }[] = [];
  private advert!: THREE.Mesh;
  private reflectors: Reflector[] = [];
  private coreBurst = 0;
  private dome = new THREE.Group();
  /** Reflections can be switched off by the quality tier. */
  reflections = true;

  constructor(
    private game: Game,
    private V: Verge,
  ) {
    for (const s of V.solids) this.buildSolid(s);
    this.buildSkyline();
    this.buildSignage();
    this.buildBillboard();
    this.buildProps();
    this.buildDome();
    this.buildCore();
    this.buildPuddles();

    // rain streaks around the camera
    const N = 1600;
    this.rain = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.012, 0.55, 0.012),
      new THREE.MeshBasicMaterial({ color: '#9fc7ff', transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false, fog: false }),
      N,
    );
    this.rain.frustumCulled = false;
    this.rainSeeds = new Float32Array(N * 3).map(() => Math.random());
    // night sky: a dome that follows the camera
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1200, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color('#05030c') },
          uHorizon: { value: new THREE.Color('#3a1a4a') },
          uBottom: { value: new THREE.Color('#120a1c') },
          uSunDir: { value: new THREE.Vector3(0.3, 0.9, -0.4).normalize() },
          uDim: { value: 1 },
        },
      }),
    );
    this.sky.renderOrder = -1;
    this.group.add(this.sky);
    // flying traffic as streaks of light between the towers
    const T = 160;
    this.traffic = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2.2, 0.12, 0.12),
      new THREE.MeshBasicMaterial({ vertexColors: false, toneMapped: false, fog: true }),
      T,
    );
    this.traffic.frustumCulled = false;
    this.trafficSeeds = new Float32Array(T * 4).map(() => Math.random());
    const col = new THREE.Color();
    for (let i = 0; i < T; i++) {
      col.set(this.trafficSeeds[i * 4] > 0.5 ? '#ffd9a0' : this.trafficSeeds[i * 4 + 1] > 0.5 ? '#ff4060' : '#7ff6ff').multiplyScalar(3);
      this.traffic.setColorAt(i, col);
    }
    this.group.add(this.traffic);

    // neon lights along the route
    const L: [number, number, number, string, number][] = [
      [1018, ROOF_Y + 4, -8, NEON.pink, 18],
      [1006, ROOF_Y + 3, 4, NEON.amber, 16],
      [1030, ROOF_Y + 3, 5, NEON.cyan, 16],
      [1044, 6, 4, NEON.cyan, 22],
      [1060, 4, 6, NEON.amber, 18],
      [1078, 4, -6, NEON.red, 16],
      [1100, 6, -5, NEON.violet, 24],
      [1130, PLAZA_Y + 3, -6, NEON.cyan, 18],
      [1165, PLAZA_Y + 5, -10, NEON.pink, 26],
      [1220, PLAZA_Y + 6, 0, '#ffffff', 22],
    ];
    for (const [x, y, z, c, d] of L) {
      const l = new THREE.PointLight(c, 30, d, 1.8);
      l.position.set(x, y, z);
      this.group.add(l);
      this.lights.push(l);
    }

    this.codeTexReal = canvasText('0 7 0 7', { w: 256, h: 128, color: NEON.cyan, bg: '#05101a', sub: 'TOWER ACCESS' });
    this.codeTexCensored = canvasText('▒ ▓ ░ ▒', { w: 256, h: 128, color: '#5a6a80', bg: '#05101a', sub: 'CENSORED' });
    (this.codeSign.material as THREE.MeshStandardMaterial).emissiveMap = this.codeTexCensored;
  }

  private mat(look: SolidDef['look'], id: string) {
    switch (look) {
      case 'concrete':
        return id.startsWith('bldg') || id.startsWith('tower')
          ? sharedEraMaterial('cityFacade', { color: '#262836', roughness: 0.7, metalness: 0.2, pattern: PATTERN.facade })
          : sharedEraMaterial('cityGround', { color: '#2a2b33', roughness: 0.55, pattern: PATTERN.wet });
      case 'metal':
        return sharedEraMaterial('cityMetal', { color: '#3d4152', roughness: 0.35, metalness: 0.8, pattern: PATTERN.metal });
      case 'glass':
        return id === 'skybridge'
          ? sharedEraMaterial('cityGlassFloor', { color: '#1d2b3a', roughness: 0.08, metalness: 0.4, pattern: PATTERN.wet })
          : eraMaterial({ color: '#0e2a3a', emissive: '#1a4a66', emissiveIntensity: 0.6, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.7 });
      case 'neon':
        return sharedEraMaterial('cityAwning', { color: '#1a1420', emissive: NEON.pink, emissiveIntensity: 0.35, roughness: 0.5 });
      case 'laser':
        return eraMaterial({ color: '#400008', emissive: NEON.red, emissiveIntensity: 4, transparent: true, opacity: 0.55 });
      case 'graffiti':
        return eraMaterial({ color: '#2a1030', emissive: NEON.lime, emissiveIntensity: 1.2, transparent: true, opacity: 0.85 });
      default:
        return sharedEraMaterial('cityMetal', { color: '#3d4152', roughness: 0.35, metalness: 0.8, pattern: PATTERN.metal });
    }
  }

  private buildSolid(s: SolidDef) {
    if (s.look === 'invisible') return;
    const { min, max } = s.box;
    const w = max.x - min.x;
    const h = max.y - min.y;
    const d = max.z - min.z;
    const m = this.mat(s.look, s.id);
    const geo = s.kind === 'prop' && w < 4 ? new RoundedBoxGeometry(w, h, d, 2, 0.05) : new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
    mesh.castShadow = mesh.receiveShadow = true;
    if (s.look === 'laser') {
      // a grid of beams rather than a slab
      mesh.visible = false;
      const beams = new THREE.Group();
      const n = Math.max(2, Math.round(Math.max(w, d) / 0.45));
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 4; k++) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(w > d ? 0.03 : w, 0.03, w > d ? d : 0.03), m);
          b.scale.set(w > d ? 1 : 1, 1, 1);
          const t = (i + 0.5) / n;
          b.position.set(w > d ? min.x + t * w : (min.x + max.x) / 2, min.y + 0.35 + k * 0.7, w > d ? (min.z + max.z) / 2 : min.z + t * d);
          if (w > d) b.scale.x = 1;
          beams.add(b);
        }
      }
      const vbeam = new THREE.Mesh(new THREE.BoxGeometry(w > d ? w : 0.04, 0.04, w > d ? 0.04 : d), m);
      vbeam.position.set((min.x + max.x) / 2, max.y, (min.z + max.z) / 2);
      beams.add(vbeam);
      for (const end of [0, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, h, 0.16), this.mat('metal', 'post'));
        post.position.set(w > d ? (end ? max.x : min.x) : (min.x + max.x) / 2, (min.y + max.y) / 2, w > d ? (min.z + max.z) / 2 : end ? max.z : min.z);
        this.group.add(post);
      }
      this.group.add(beams);
      this.lasers.push({ mesh: beams as unknown as THREE.Mesh, id: s.id });
      return;
    }
    if (s.id === 'shutter') {
      this.shutter = new THREE.Group();
      for (let y = 0; y < 9; y += 0.6) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(w, 0.52, d), m);
        slat.position.set((min.x + max.x) / 2, y + 0.3, (min.z + max.z) / 2);
        slat.castShadow = true;
        this.shutter.add(slat);
      }
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.12, d * 0.9), eraMaterial({ color: '#332200', emissive: NEON.amber, emissiveIntensity: 2 }));
      stripe.position.set((min.x + max.x) / 2, 4.5, (min.z + max.z) / 2);
      this.shutter.add(stripe);
      this.group.add(this.shutter);
      return;
    }
    if (s.id === 'door') {
      this.door = new THREE.Group();
      this.door.add(mesh);
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.62, h * 0.96, 0.05), eraMaterial({ color: '#001518', emissive: NEON.cyan, emissiveIntensity: 1.6 }));
      seam.position.set(mesh.position.x, mesh.position.y, 0);
      this.door.add(seam);
      this.group.add(this.door);
      return;
    }
    if (s.look === 'graffiti') this.graffiti.push({ mesh, id: s.id });
    if (s.id === 'advert') this.advert = mesh;
    if (s.id === 'signPillar') {
      this.codeSign = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, 0.8),
        eraMaterial({ color: '#000000', emissive: '#ffffff', emissiveIntensity: 1.4, roughness: 0.3 }),
      );
      this.codeSign.position.set((min.x + max.x) / 2, max.y - 1.4, max.z + 0.02);
      this.group.add(this.codeSign);
    }
    if (s.id === 'terminal') {
      this.terminalScreen = eraMaterial({ color: '#001010', emissive: NEON.cyan, emissiveIntensity: 1.5 });
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), this.terminalScreen);
      scr.position.set((min.x + max.x) / 2, max.y + 0.05, max.z + 0.01);
      scr.rotation.x = -0.5;
      this.group.add(scr);
    }
    this.group.add(mesh);
  }

  /** Hundreds of towers around and below: lit windows, rooftop beacons. */
  private buildSkyline() {
    const r = rng(1234);
    const facade = sharedEraMaterial('skyline', { color: '#1c1d29', roughness: 0.8, metalness: 0.2, pattern: PATTERN.facade });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const count = 260;
    const inst = new THREE.InstancedMesh(geo, facade, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      let x = 0;
      let z = 0;
      // keep the playable corridor clear
      do {
        x = 930 + r() * 360;
        z = (r() - 0.5) * 360;
      } while (x > 990 && x < 1245 && Math.abs(z) < 34);
      const w = 8 + r() * 18;
      const d = 8 + r() * 18;
      const h = 30 + r() * r() * 170;
      const y = -40 + h / 2;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (r() - 0.5) * 0.3);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w, h, d));
      inst.setMatrixAt(i, m);
    }
    inst.receiveShadow = false;
    this.group.add(inst);
    // beacons on top of the tallest towers
    const beaconMat = new THREE.MeshBasicMaterial({ color: '#ff3344', toneMapped: false });
    for (let i = 0; i < 40; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.6, 6, 4), beaconMat);
      b.position.set(930 + r() * 360, 60 + r() * 90, (r() > 0.5 ? 1 : -1) * (50 + r() * 120));
      this.group.add(b);
    }
    // a vast ground haze far below (the city floor)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshBasicMaterial({ color: '#100b1c', toneMapped: false }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(1100, -40, 0);
    this.group.add(floor);
  }

  private buildSignage() {
    const r = rng(77);
    const spots: [number, number, number, number][] = [
      // x, y, z, rotationY — facing into the street (north wall faces -z, south wall faces +z)
      [1044, 9, 6.95, Math.PI],
      [1066, 12, 6.95, Math.PI],
      [1090, 8, 6.95, Math.PI],
      [1048, 7, -6.95, 0],
      [1070, 11, -6.95, 0],
      [1024, ROOF_Y + 9, -11, 0],
      [1180, PLAZA_Y + 10, -14.2, 0],
      [1150, PLAZA_Y + 8, 14.2, Math.PI],
      [1196.05, PLAZA_Y + 12, -10, -Math.PI / 2],
    ];
    spots.forEach(([x, y, z, ry], i) => {
      const [text, color] = SIGNS[i % SIGNS.length];
      const vertical = r() > 0.6;
      const tex = canvasText(text, { w: 1024, h: 160, color });
      const geo = vertical ? new THREE.PlaneGeometry(1.4, 8) : new THREE.PlaneGeometry(9, 1.4);
      if (vertical) tex.rotation = Math.PI / 2;
      tex.center.set(0.5, 0.5);
      const sign = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, color: new THREE.Color(2.4, 2.4, 2.4) }));
      sign.position.set(x, y, z);
      sign.rotation.y = ry;
      this.group.add(sign);
      // frame tube
      const tube = new THREE.Mesh(
        vertical ? new THREE.BoxGeometry(1.6, 8.2, 0.08) : new THREE.BoxGeometry(9.2, 1.6, 0.08),
        new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.25 }),
      );
      tube.position.copy(sign.position);
      tube.rotation.y = ry;
      tube.translateZ(-0.05);
      this.group.add(tube);
    });
    // holographic adverts floating above the street
    const holos: [string, string, number, number, number, number, number][] = [
      ['BE SMALL. BE HAPPY.', NEON.cyan, 1058, 16, 0, 12, 4],
      ['ARCHIVE LOVES YOU', NEON.pink, 1168, PLAZA_Y + 14, -4, 14, 4.5],
      ['RENDER RESPONSIBLY', NEON.amber, 1030, ROOF_Y + 14, 9, 10, 3.2],
    ];
    for (const [text, color, x, y, z, w, h] of holos) {
      const tex = canvasText(text, { w: 1024, h: 256, color: '#ffffff', glow: false });
      const mat = new THREE.ShaderMaterial({
        vertexShader: HOLO_VERT,
        fragmentShader: HOLO_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { tMap: { value: tex }, uTime: { value: 0 }, uTint: { value: new THREE.Color(color) }, uGlitch: { value: 1 } },
      });
      this.holoMats.push(mat);
      const holo = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      holo.position.set(x, y, z);
      holo.rotation.y = 0.15;
      this.group.add(holo);
    }
  }

  /** The billboard Pip climbs: an advert whose painted ledges are solid when flat. */
  private buildBillboard() {
    const tex = canvasText('LIVE FLAT. LIVE CALM.', { w: 1024, h: 1024, color: '#ffffff', glow: false, font: '800 110px Outfit, sans-serif', sub: 'a public service of ARCHIVE' });
    const mat = new THREE.ShaderMaterial({
      vertexShader: HOLO_VERT,
      fragmentShader: HOLO_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { tMap: { value: tex }, uTime: { value: 0 }, uTint: { value: new THREE.Color(NEON.violet) }, uGlitch: { value: 0.6 } },
    });
    this.holoMats.push(mat);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), mat);
    board.position.set(1104.5, 8.2, -6.97);
    this.group.add(board);
    const ledgeMat = eraMaterial({ color: '#16202a', emissive: NEON.cyan, emissiveIntensity: 1.6, transparent: true, opacity: 0.9 });
    for (const l of LEDGES) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(l.x1 - l.x0, 0.32), ledgeMat);
      bar.position.set((l.x0 + l.x1) / 2, l.top - 0.15, -6.95);
      this.group.add(bar);
    }
    // the lane strip on the street
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(16, 0.1), new THREE.MeshBasicMaterial({ color: '#4ff5e6', toneMapped: false, transparent: true, opacity: 0.7 }));
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(1104, 0.02, LANE_Z);
    this.group.add(strip);
  }

  private buildProps() {
    const r = rng(9);
    const post = sharedEraMaterial('cityMetal', { color: '#3d4152', roughness: 0.35, metalness: 0.8, pattern: PATTERN.metal });
    // lamp posts with neon tubes along the street and plaza
    for (let x = 1042; x < 1110; x += 9) {
      for (const z of [-6.3, 6.3]) {
        const g = new THREE.Group();
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 5, 8), post);
        p.position.y = 2.5;
        const tube = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.08), new THREE.MeshBasicMaterial({ color: r() > 0.5 ? NEON.cyan : NEON.pink, toneMapped: false }));
        tube.position.set(0, 4.4, z > 0 ? -0.25 : 0.25);
        g.add(p, tube);
        g.position.set(x + r() * 2, 0, z);
        this.group.add(g);
      }
    }
    // cables strung between buildings
    const cableMat = new THREE.MeshBasicMaterial({ color: '#08080c' });
    for (let x = 1040; x < 1110; x += 6) {
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x, 12 + r() * 6, -7), new THREE.Vector3(x + 1, 7 + r() * 3, 0), new THREE.Vector3(x + r() * 3, 12 + r() * 6, 7));
      const c = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.025, 4), cableMat);
      this.group.add(c);
    }
    // steam vents
    for (const [x, z] of [[1053, -6.6], [1088, 6.6], [1160, 13.6]] as const) {
      const y = x > 1140 ? PLAZA_Y : 0;
      const s = new THREE.Mesh(
        new THREE.ConeGeometry(1.4, 6, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: '#9aa8c0', transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
      );
      s.position.set(x, y + 3, z);
      s.rotation.x = Math.PI;
      this.group.add(s);
      this.steam.push(s);
    }
    // health cells
    for (const h of this.V.pickups) {
      const g = new THREE.Group();
      g.position.set(h.pos.x, h.pos.y, h.pos.z);
      const core = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.4, 0.4, 2, 0.08), eraMaterial({ color: '#0a2a14', emissive: '#5cff8a', emissiveIntensity: 2, roughness: 0.2 }));
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: '#eaffee', toneMapped: false }));
      const cross2 = cross.clone();
      cross2.rotation.z = Math.PI / 2;
      g.add(core, cross, cross2);
      this.group.add(g);
      this.healthPickups.push({ obj: g, id: h.id });
    }
    // the emitter, waiting on its crate
    const e = this.V.emitter;
    this.emitterPickup.position.set(e.x, e.y + 0.3, e.z);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.5, 12), eraMaterial({ color: '#f0862a', roughness: 0.3, metalness: 0.4 }));
    body.rotation.z = Math.PI / 2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 8, 20), eraMaterial({ color: '#702000', emissive: '#ff8a2a', emissiveIntensity: 3 }));
    ring.rotation.y = Math.PI / 2;
    ring.position.x = 0.26;
    this.emitterPickup.add(body, ring);
    this.group.add(this.emitterPickup);
    // door panel
    const dp = this.V.doorPanel;
    this.doorPanel = eraMaterial({ color: '#100010', emissive: NEON.red, emissiveIntensity: 1.8 });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.5), this.doorPanel);
    panel.position.set(dp.x + 0.6, dp.y + 1.4, dp.z);
    this.group.add(panel);
  }

  /** The meadow's sky, from outside: a cracked glass dome beside the hatch. */
  private buildDome() {
    const glass = new THREE.MeshStandardMaterial({ color: '#7fb7e6', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.18, side: THREE.DoubleSide, envMapIntensity: 1.5 });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(42, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), glass);
    this.dome.add(shell);
    const ribMat = new THREE.MeshBasicMaterial({ color: '#253048' });
    for (let i = 0; i < 12; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(42, 0.18, 4, 48, Math.PI), ribMat);
      rib.rotation.set(0, (i / 12) * Math.PI, 0);
      this.dome.add(rib);
    }
    // the crack Pip came through
    const crackMat = new THREE.MeshBasicMaterial({ color: '#d9fbff', toneMapped: false });
    const r = rng(3);
    let px = 0;
    let py = 4;
    for (let i = 0; i < 14; i++) {
      const nx = px + (r() - 0.5) * 3;
      const ny = py + 1.8 + r() * 1.2;
      const len = Math.hypot(nx - px, ny - py);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.08, len, 0.08), crackMat);
      seg.position.set(41.6, (py + ny) / 2, (px + nx) / 2);
      seg.rotation.x = Math.atan2(nx - px, ny - py);
      this.dome.add(seg);
      px = nx;
      py = ny;
    }
    this.dome.position.set(958, ROOF_Y, 0);
    this.group.add(this.dome);
  }

  /** ARCHIVE's core: a sphere wrapped in six generation rings. */
  private buildCore() {
    const c = this.V.core;
    this.core.position.set(c.x, c.y, c.z);
    const sphere = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 4), eraMaterial({ color: '#0a1418', emissive: '#bff8ff', emissiveIntensity: 2.4, roughness: 0.1, physical: { iridescence: 1, clearcoat: 1 } }));
    this.core.add(sphere);
    const ringCols = ['#f0862a', '#ffcf6b', '#5ec8f0', '#ff8fb8', '#6ff6ff', '#b388ff'];
    ringCols.forEach((col, i) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4 + i * 0.45, 0.05, 6, 96), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
      ring.rotation.set(i * 0.5, i * 0.8, 0);
      this.core.add(ring);
      this.coreRings.push(ring);
    });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(Math.cos(a) * 9, -5, Math.sin(a) * 9),
        new THREE.Vector3(Math.cos(a) * 4, -3, Math.sin(a) * 4),
        new THREE.Vector3(0, -1.4, 0),
      );
      this.core.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.12, 6), sharedEraMaterial('cityMetal', { color: '#3d4152', roughness: 0.35, metalness: 0.8, pattern: PATTERN.metal })));
    }
    const glow = new THREE.PointLight('#bff8ff', 60, 30, 1.6);
    this.core.add(glow);
    this.group.add(this.core);
  }

  /** Wet-street puddle reflections (planar, half-res); quality tiers can turn them off. */
  private buildPuddles() {
    const make = (x0: number, x1: number, z0: number, z1: number, y: number) => {
      const r = new Reflector(new THREE.PlaneGeometry(x1 - x0, z1 - z0), {
        textureWidth: 512,
        textureHeight: 512,
        color: new THREE.Color(0.9, 0.95, 1.0),
        clipBias: 0.003,
        shader: {
          name: 'PuddleShader',
          uniforms: {
            color: { value: null },
            tDiffuse: { value: null },
            textureMatrix: { value: null },
            uTime: { value: 0 },
          },
          vertexShader: PUDDLE_VERT,
          fragmentShader: PUDDLE_FRAG,
        },
      });
      (r.material as THREE.ShaderMaterial).transparent = true;
      (r.material as THREE.ShaderMaterial).depthWrite = false;
      r.rotation.x = -Math.PI / 2;
      r.position.set((x0 + x1) / 2, y + 0.006, (z0 + z1) / 2);
      this.group.add(r);
      this.reflectors.push(r);
    };
    make(1036, 1112, -7, 7, 0);
    make(1140, 1196, -14, 14, PLAZA_Y);
  }

  update(t: number, dt: number, cam: THREE.Camera, eraAt: (p: THREE.Vector3) => number) {
    const g = this.game;
    for (const m of this.holoMats) m.uniforms.uTime.value = t;
    for (const r of this.reflectors) {
      ((r.material as THREE.ShaderMaterial).uniforms.uTime as { value: number }).value = t;
      r.visible = this.reflections;
    }
    this.sky.position.copy(cam.position);
    this.updateRain(t, cam);
    const m4 = new THREE.Matrix4();
    // traffic
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < this.traffic.count; i++) {
      const a = this.trafficSeeds[i * 4];
      const b = this.trafficSeeds[i * 4 + 1];
      const c = this.trafficSeeds[i * 4 + 2];
      const lane = Math.floor(c * 6);
      const dir = lane % 2 ? 1 : -1;
      const x = 900 + ((a * 420 + t * (14 + b * 16) * dir) % 420 + 420) % 420;
      const y = 30 + lane * 9 + b * 4;
      const z = (lane < 3 ? -1 : 1) * (40 + c * 80);
      m4.compose(new THREE.Vector3(x, y, z), q, s);
      this.traffic.setMatrixAt(i, m4);
    }
    this.traffic.instanceMatrix.needsUpdate = true;
    this.steam.forEach((st, i) => {
      st.scale.set(1 + Math.sin(t * 0.7 + i) * 0.15, 1, 1 + Math.cos(t * 0.6 + i) * 0.15);
      (st.material as THREE.MeshBasicMaterial).opacity = 0.06 + Math.sin(t * 1.3 + i * 2) * 0.03;
    });
    // shutter rolls up, door slides
    const shutterTarget = g.save.shutterOpen ? 8.5 : 0;
    this.shutter.position.y += (shutterTarget - this.shutter.position.y) * Math.min(1, dt * 1.5);
    const doorTarget = g.doorOpen ? 5.2 : 0;
    this.door.position.z += (doorTarget - this.door.position.z) * Math.min(1, dt * 1.2);
    this.doorPanel.emissive.set(g.doorOpen ? '#5cff8a' : g.save.codeRead ? NEON.amber : NEON.red);
    this.terminalScreen.emissiveIntensity = g.save.shutterOpen ? 0.4 : 1.4 + Math.sin(t * 5) * 0.4;
    // the code is censored unless the sign is at full fidelity
    const readable = eraAt(new THREE.Vector3(this.V.codeSign.x, this.V.codeSign.y, this.V.codeSign.z)) >= 4 || g.save.codeRead;
    const sm = this.codeSign.material as THREE.MeshStandardMaterial;
    const want = readable ? this.codeTexReal : this.codeTexCensored;
    if (sm.emissiveMap !== want) {
      sm.emissiveMap = want;
      sm.needsUpdate = true;
    }
    // lasers / graffiti / advert visibility follow the generation at their location
    for (const l of this.lasers) {
      const c = g.world.get(l.id)!;
      l.mesh.visible = g.world.active(c);
    }
    for (const gr of this.graffiti) {
      const c = g.world.get(gr.id)!;
      const on = g.world.active(c);
      (gr.mesh.material as THREE.MeshStandardMaterial).opacity = on ? 0.95 : 0.35;
      (gr.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 2.4 : 0.6;
    }
    if (this.advert) {
      const c = g.world.get('advert')!;
      (this.advert.material as THREE.MeshStandardMaterial).opacity = g.world.active(c) ? 0.7 : 0.15;
    }
    // pickups
    this.emitterPickup.visible = !g.save.emitter;
    this.emitterPickup.rotation.y = t * 1.5;
    this.emitterPickup.position.y = this.V.emitter.y + 0.3 + Math.sin(t * 2) * 0.08;
    for (const h of this.healthPickups) {
      const st = g.healthPickups.find((p) => p.id === h.id)!;
      h.obj.visible = !st.taken;
      h.obj.rotation.y = t * 1.2;
      h.obj.position.y = st.pos.y + Math.sin(t * 2 + st.pos.x) * 0.1;
    }
    // core
    if (g.events.length && g.events[g.events.length - 1].type === 'coreChoice') this.coreBurst = 1;
    this.coreBurst = Math.max(0, this.coreBurst - dt * 0.2);
    this.coreRings.forEach((r, i) => {
      r.rotation.x += dt * (0.2 + i * 0.07);
      r.rotation.y += dt * (0.15 - i * 0.03);
      r.scale.setScalar(1 + this.coreBurst * (2 + i * 0.6));
    });
    this.core.rotation.y += dt * 0.1;
  }

  /** Rain falls in a box around the camera. */
  updateRain(t: number, cam: THREE.Camera) {
    const m4 = new THREE.Matrix4();
    const cp = cam.position;
    const n = this.rain.count;
    for (let i = 0; i < n; i++) {
      const sx = this.rainSeeds[i * 3];
      const sy = this.rainSeeds[i * 3 + 1];
      const sz = this.rainSeeds[i * 3 + 2];
      const x = cp.x + (sx - 0.5) * 40;
      const z = cp.z + (sz - 0.5) * 40;
      const y = cp.y + 14 - ((sy * 30 + t * 24) % 30);
      m4.makeTranslation(x, y, z);
      this.rain.setMatrixAt(i, m4);
    }
    this.rain.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const r of this.reflectors) r.dispose();
  }
}
