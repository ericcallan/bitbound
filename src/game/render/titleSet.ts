import * as THREE from 'three';
import { allEraMaterial, getAsset, loadAsset, type AssetName } from './assets';
import { terrainMaterial } from './terrain';
import { eraMaterial, eraUniforms, PATTERN } from './eraMaterial';
import { TITLE, titleHeight, titleRock } from '../level/title';
import { fbm } from '../level/valley';

/** Deterministic random numbers, so the set is composed the same way every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const O = TITLE.origin;
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** The worn path from Pip's slab down to the terrace steps (set-local x, z). */
const PATH: [number, number][] = [
  [-0.5, 5],
  [1.2, 0.5],
  [4.2, -3.2],
  [6.4, -6.2],
];
function pathDist(x: number, z: number) {
  let best = 1e9;
  for (let i = 0; i < PATH.length - 1; i++) {
    const [ax, az] = PATH[i];
    const [bx, bz] = PATH[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best + fbm(x * 0.7, z * 0.7) * 0.5;
}

interface Placement {
  x: number;
  z: number;
  y?: number;
  rot: number;
  scale: number;
  sy?: number;
  tilt?: number;
  color?: THREE.Color;
}

/**
 * The title screen's composed set (see level/title.ts), built from the game's own assets and materials so
 * the generation timeline can ripple it through all six looks. Only the main menu creates it.
 */
export class TitleSet {
  group = new THREE.Group();
  ready = false;
  private time = 0;
  private fallMat: THREE.ShaderMaterial | null = null;
  private mist: THREE.Sprite[] = [];
  private shard: THREE.Mesh | null = null;
  private ringGlow: THREE.MeshStandardMaterial | null = null;
  private banners: THREE.Mesh[] = [];
  private island: THREE.Object3D | null = null;
  /** Geometry borrowed from the assets (shared with play): never disposed here. */
  private borrowed = new WeakSet<THREE.BufferGeometry>();

  constructor() {
    this.group.position.set(O.x, O.y, O.z);
    const need: AssetName[] = ['tree', 'rocks', 'gateway', 'vegetation', 'props'];
    void Promise.all(need.map(loadAsset)).then(() => this.build());
    this.group.add(this.ground(), this.water());
  }

  // --- ground: the splat terrain material over a height field, with weights and soft occlusion per vertex
  private ground() {
    const x0 = -70;
    const x1 = 70;
    const z0 = -100;
    const z1 = 18;
    const step = 0.5;
    const nx = Math.round((x1 - x0) / step) + 1;
    const nz = Math.round((z1 - z0) / step) + 1;
    const pos = new Float32Array(nx * nz * 3);
    const col = new Float32Array(nx * nz * 4);
    const heights = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * step;
        const z = z0 + j * step;
        heights[j * nx + i] = titleHeight(x, z);
      }
    }
    const H = (i: number, j: number) => heights[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const x = x0 + i * step;
        const z = z0 + j * step;
        const h = heights[k];
        pos.set([x, h, z], k * 3);
        const rock = titleRock(x, z);
        const path = (1 - smooth(0.5, 1.3, pathDist(x, z))) * (1 - rock);
        // forest floor under the great tree, on the wooded slopes and along the cliff foot
        const forest =
          Math.max(smooth(-4, -11, x) * smooth(-14, -6, z), smooth(26, 32, x), smooth(-24, -29, z) * (1 - rock)) * (1 - rock) * (1 - path);
        // occlusion: how far the ground sits below its surroundings (hollows, cliff feet)
        let around = 0;
        for (const [di, dj] of [[6, 0], [-6, 0], [0, 6], [0, -6], [4, 4], [-4, 4], [4, -4], [-4, -4]]) around += Math.max(0, H(i + di, j + dj) - h);
        const ao = 1 - Math.min(0.75, around * 0.05);
        col.set([rock, path, forest * 0.85, ao], k * 4);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, terrainMaterial(0));
    mesh.receiveShadow = true;
    mesh.name = 'title_ground';
    return mesh;
  }

  private water() {
    const p = TITLE.pool;
    const m = eraMaterial({ color: '#173c3a', roughness: 0.16, pattern: PATTERN.water, transparent: true, opacity: 0.92 });
    m.envMapIntensity = 0.42;
    const w = new THREE.Mesh(new THREE.PlaneGeometry(48, 46, 48, 46), m);
    w.rotation.x = -Math.PI / 2;
    w.position.set(p.x + 6, TITLE.waterY, p.z + 8);
    w.receiveShadow = true;
    return w;
  }

  // --- helpers

  /** Every mesh part of an asset node with its full transform inside the asset. */
  private parts(asset: AssetName, node: string) {
    const g = getAsset(asset);
    const src = g?.scene.getObjectByName(node);
    if (!g || !src) return [];
    g.scene.updateMatrixWorld(true);
    const out: THREE.Mesh[] = [];
    src.traverse((o) => (o as THREE.Mesh).isMesh && out.push(o as THREE.Mesh));
    return out;
  }

  private instanced(asset: AssetName, node: string, list: Placement[], shadow = true) {
    if (list.length === 0) return;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (const part of this.parts(asset, node)) {
      this.borrowed.add(part.geometry);
      const inst = new THREE.InstancedMesh(part.geometry, allEraMaterial(part.material as THREE.Material), list.length);
      list.forEach((p, i) => {
        e.set(p.tilt ?? 0, p.rot, (p.tilt ?? 0) * 0.6);
        q.setFromEuler(e);
        const y = p.y ?? titleHeight(p.x, p.z);
        m4.compose(new THREE.Vector3(p.x, y, p.z), q, new THREE.Vector3(p.scale, p.scale * (p.sy ?? 1), p.scale));
        m4.multiply(part.matrixWorld);
        inst.setMatrixAt(i, m4);
        if (p.color) inst.setColorAt(i, p.color);
      });
      inst.castShadow = shadow;
      inst.receiveShadow = true;
      inst.computeBoundingSphere();
      this.group.add(inst);
    }
  }

  /** One copy of an asset node, in every generation. */
  private single(asset: AssetName, node: string, p: Placement) {
    const parts = this.parts(asset, node);
    const root = new THREE.Group();
    for (const part of parts) {
      this.borrowed.add(part.geometry);
      const m = new THREE.Mesh(part.geometry, allEraMaterial(part.material as THREE.Material));
      m.applyMatrix4(part.matrixWorld);
      m.castShadow = true;
      m.receiveShadow = true;
      root.add(m);
    }
    root.position.set(p.x, p.y ?? titleHeight(p.x, p.z), p.z);
    root.rotation.set(p.tilt ?? 0, p.rot, 0);
    root.scale.set(p.scale, p.scale * (p.sy ?? 1), p.scale);
    this.group.add(root);
    return root;
  }

  /** Lowest ground under a footprint, so objects sit into slopes instead of floating off them. */
  private seat(x: number, z: number, r: number) {
    let h = Infinity;
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) h = Math.min(h, titleHeight(x + dx, z + dz));
    return h;
  }

  // --- the composition

  private build() {
    const T = TITLE;
    const r = rng(7);

    // Pip's slab: a flat-topped mossy block sunk into the meadow, with rubble at its foot.
    const s = T.slab;
    // block_ledge is 2 x 3 x 2.1: squashed to a low, broad slab (compressing the bake reads as tighter strata)
    const slab = this.single('gateway', 'block_ledge', { x: s.x, z: s.z, y: s.top - 1.35, rot: s.rotY, scale: 1 });
    slab.scale.set(s.sx, 1.35 / 3, s.sz);
    this.instanced('rocks', 'rock_a', [
      { x: s.x + 1.9, z: s.z + 0.6, rot: 1.2, scale: 0.9 },
      { x: s.x - 1.6, z: s.z + 1.0, rot: 2.6, scale: 0.6 },
    ]);
    this.instanced('rocks', 'rock_b', [{ x: s.x + 1.5, z: s.z - 1.2, rot: 0.4, scale: 0.75 }]);

    // The great tree on the hill at the left, its crown framing the top-left of the frame.
    this.single('tree', 'great_tree', { x: -8.2, z: -9.5, y: this.seat(-8.2, -9.5, 1.2) - 0.3, rot: 2.3, scale: 1.15 });
    // A few younger trees: behind the pool, on the right slopes and along the cliff tops.
    const trees: Placement[] = [
      { x: -12, z: -21, rot: 1, scale: 1.1 },
      { x: -16, z: -5, rot: 2, scale: 1.25 },
      { x: 27, z: -8, rot: 0.5, scale: 1.2 },
      { x: 31, z: -17, rot: 2.2, scale: 1.35 },
      { x: 24, z: -26, rot: 3.1, scale: 1.0 },
      { x: 36, z: -4, rot: 1.4, scale: 1.4 },
    ];
    // woods on the uplands behind the cliffs: set back from the rim in loose groups, not a row along it
    for (let i = 0; i < 22; i++) {
      const x = -40 + r() * 84;
      if (Math.abs(x - T.fall.x) < 5) continue;
      trees.push({ x, z: -47 - r() * 26, rot: r() * 6.3, scale: 1.0 + r() * 0.9 });
    }
    for (const t of trees) t.y = this.seat(t.x, t.z, 0.8) - 0.2;
    this.instanced('tree', 'meadow_tree', trees);

    this.ruins();
    this.waterfall();
    this.boulders(r);
    this.scatter(r);
    this.floatingIsland();
    this.ready = true;
  }

  /** The ruined terrace: a stone ring on a dais (the frame Pip will break), the old arch and columns. */
  private ruins() {
    const T = TITLE;
    const ty = T.terrace.y;
    const ring = T.ring;
    // steps from the meadow up to the terrace, following the path
    this.single('gateway', 'block_step1', { x: 6.9, z: -6.9, y: this.seat(6.9, -6.9, 1) - 0.35, rot: -0.55, scale: 1, sy: 0.55 });
    this.single('gateway', 'block_step1', { x: 7.8, z: -7.9, y: this.seat(7.8, -7.9, 1) - 0.1, rot: -0.55, scale: 1, sy: 0.75 });
    // the dais the ring stands on
    // block_step2 is 3 x 2 x 3.2: a low, broad dais
    const dy = this.seat(ring.x, ring.z, 2) - 0.25;
    const dais = this.single('gateway', 'block_step2', { x: ring.x, z: ring.z, y: dy, rot: 0.25, scale: 1 });
    dais.scale.set(2.1, 0.32, 0.75);
    const base = dy + 2 * 0.32;

    // the ring: chipped voussoirs of the projected stone, two of them fallen
    const stoneMat = this.findMaterial('gateway', 'stone_wall_tri');
    const glyphMat = this.findMaterial('gateway', 'ancient_glyph');
    const ringRoot = new THREE.Group();
    ringRoot.position.set(ring.x, base + ring.r + 0.36, ring.z);
    ringRoot.rotation.y = 0.25;
    const n = 18;
    const rr = rng(11);
    for (let i = 0; i < n; i++) {
      if (i === 3 || i === 4) continue; // broken at the upper right
      const a = (i / n) * Math.PI * 2;
      const g = new THREE.BoxGeometry(1.12, 0.78 + rr() * 0.12, 0.95 + rr() * 0.1, 2, 2, 2);
      const b = new THREE.Mesh(g, stoneMat ?? eraMaterial({ color: '#8d8478', pattern: PATTERN.ruin }));
      b.position.set(Math.cos(a) * ring.r, Math.sin(a) * ring.r, 0);
      b.rotation.z = a + Math.PI / 2 + (rr() - 0.5) * 0.06;
      b.rotation.y = (rr() - 0.5) * 0.08;
      b.castShadow = b.receiveShadow = true;
      ringRoot.add(b);
    }
    // glyph inlay round the inner face, and the light held inside the ring
    const inlay = new THREE.Mesh(new THREE.TorusGeometry(ring.r - 0.42, 0.06, 8, 96), glyphMat ?? eraMaterial({ color: '#2a8f86', emissive: '#4ff5e6', emissiveIntensity: 2 }));
    ringRoot.add(inlay);
    this.ringGlow = eraMaterial({ color: '#1b6f6a', emissive: '#58fff0', emissiveIntensity: 2.6, roughness: 0.3 });
    const glow = new THREE.Mesh(new THREE.TorusGeometry(ring.r - 0.62, 0.035, 6, 128), this.ringGlow);
    ringRoot.add(glow);
    // the shard, held in the middle of the ring
    this.shard = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.42, 0),
      eraMaterial({ color: '#7ff7ee', emissive: '#3fe9dc', emissiveIntensity: 1.6, roughness: 0.12, metalness: 0.1, physical: { clearcoat: 1, clearcoatRoughness: 0.05 } }),
    );
    this.shard.scale.set(1, 1.7, 1);
    ringRoot.add(this.shard);
    // fallen voussoirs at the foot of the dais
    for (const [dx, dz, ry] of [[2.6, 1.4, 0.7], [3.4, 0.2, 2.1]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 0.95), stoneMat ?? undefined);
      b.position.set(ring.x + dx, titleHeight(ring.x + dx, ring.z + dz) + 0.3, ring.z + dz);
      b.rotation.set(0.3, ry, 0.5);
      b.castShadow = b.receiveShadow = true;
      this.group.add(b);
    }
    this.group.add(ringRoot);

    // banners on poles either side of the ring
    for (const side of [-1, 1]) {
      const px = ring.x + side * (ring.r + 1.3);
      const pz = ring.z + side * -0.35;
      const py = titleHeight(px, pz);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 5.4, 8), eraMaterial({ color: '#4a3424', pattern: PATTERN.wood, roughness: 0.8 }));
      pole.position.set(px, py + 2.7, pz);
      pole.castShadow = true;
      this.group.add(pole);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), pole.material);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(px, py + 5.15, pz + 0.1);
      this.group.add(bar);
      const banner = this.banner();
      banner.position.set(px, py + 5.1, pz + 0.12);
      banner.rotation.y = 0.25;
      this.group.add(banner);
      this.banners.push(banner);
    }

    // the old arch behind, and columns along the terrace (one broken)
    this.single('gateway', 'shard_arch', { x: 19.8, z: -19.5, y: this.seat(19.8, -19.5, 2) - 0.1, rot: -0.35, scale: 1.05 });
    const cols: Placement[] = [
      { x: 5.6, z: -13.4, rot: 0.3, scale: 1 },
      { x: 17.8, z: -9.6, rot: 1.1, scale: 1, sy: 0.55 },
      { x: 22.6, z: -14.8, rot: 0.2, scale: 1.05 },
    ];
    for (const c of cols) this.single('gateway', 'ruin_column', { ...c, y: this.seat(c.x, c.z, 0.5) - 0.05 });
    this.single('gateway', 'block_plinth', { x: 16.6, z: -7.6, y: titleHeight(16.6, -7.6) - 0.2, rot: 0.9, scale: 1, tilt: 0.12 });
    this.single('props', 'signpost', { x: 3.3, z: -1.2, rot: -0.75, scale: 1.1 });
  }

  /** Cloth with the orange of the title and the shard emblem; sways in the wind (vertex shader). */
  private banner() {
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 256;
    const c = cv.getContext('2d')!;
    const grd = c.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#f08a3a');
    grd.addColorStop(1, '#c8561f');
    c.fillStyle = grd;
    c.fillRect(0, 0, 128, 236);
    // swallowtail
    c.beginPath();
    c.moveTo(0, 236);
    c.lineTo(64, 206);
    c.lineTo(128, 236);
    c.lineTo(128, 256);
    c.lineTo(0, 256);
    c.closePath();
    c.globalCompositeOperation = 'destination-out';
    c.fill();
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = '#ffe2b8';
    c.lineWidth = 6;
    c.beginPath();
    c.arc(64, 96, 30, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#ffe2b8';
    c.beginPath();
    c.moveTo(64, 70);
    c.lineTo(78, 96);
    c.lineTo(64, 122);
    c.lineTo(50, 96);
    c.closePath();
    c.fill();
    c.fillStyle = 'rgba(80,30,10,0.35)';
    c.fillRect(0, 0, 128, 10);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const m = eraMaterial({
      color: '#ffffff',
      roughness: 0.85,
      side: THREE.DoubleSide,
      vertexWorld: `{
        float hang = clamp((wp.y - (modelMatrix[3].y)) / -2.4, 0.0, 1.0);
        wp.z += sin(uTime * 1.7 + wp.y * 1.3) * 0.16 * hang + 0.08 * hang;
        wp.x += sin(uTime * 2.3 + wp.y * 2.0) * 0.05 * hang;
      }`,
    });
    m.map = tex;
    m.alphaTest = 0.5;
    m.shadowSide = THREE.DoubleSide;
    const g = new THREE.PlaneGeometry(1.15, 2.4, 6, 16);
    g.translate(0, -1.2, 0);
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    return mesh;
  }

  /** The waterfall: a ribbon of moving water over the notch, foam where it lands, and drifting mist. */
  private waterfall() {
    const T = TITLE;
    const fx = T.fall.x;
    // the cliff face at the notch: for each height, the nearest z where the ground reaches it
    const faceZ = (y: number) => {
      for (let z = -20; z > -48; z -= 0.1) if (titleHeight(fx, z) >= y) return z;
      return -40;
    };
    const top = T.fall.top;
    const lipZ = faceZ(top - 0.2);
    const pts: THREE.Vector3[] = [];
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const k = i / N;
      const y = top + 0.15 - (top - T.waterY + 0.1) * k;
      const arc = lipZ + 0.6 + Math.sqrt(k) * 2.1;
      pts.push(new THREE.Vector3(fx, y, Math.max(arc, faceZ(y) + 0.45)));
    }
    const widthTop = 1.6;
    const widthBot = 2.4;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    pts.forEach((p, i) => {
      const k = i / N;
      const w = widthTop + (widthBot - widthTop) * k;
      pos.push(p.x - w / 2, p.y, p.z, p.x + w / 2, p.y, p.z);
      uv.push(0, k, 1, k);
      if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.fallMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: eraUniforms.uTime, uNoiseTex: eraUniforms.uNoiseTex },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        varying vec2 vUv; uniform float uTime; uniform sampler2D uNoiseTex;
        void main() {
          float x = vUv.x;
          float edge = smoothstep(0.0, 0.2, x) * smoothstep(1.0, 0.8, x);
          float n1 = texture2D(uNoiseTex, vec2(x * 2.2, vUv.y * 1.1 - uTime * 0.9)).r;
          float n2 = texture2D(uNoiseTex, vec2(x * 5.0 + 0.3, vUv.y * 2.6 - uTime * 1.7)).g;
          float streak = smoothstep(0.32, 0.78, n1 * 0.6 + n2 * 0.55);
          vec3 col = mix(vec3(0.42, 0.62, 0.64), vec3(0.96, 0.98, 1.0), streak);
          float lip = smoothstep(0.0, 0.06, vUv.y);
          float foot = smoothstep(0.82, 1.0, vUv.y);
          col = mix(col, vec3(1.0), foot * 0.6);
          float a = edge * lip * (0.5 + 0.45 * streak) * (1.0 - foot * 0.25);
          gl_FragColor = vec4(col * 1.05, a);
        }`,
    });
    const fall = new THREE.Mesh(g, this.fallMat);
    fall.renderOrder = 2;
    this.group.add(fall);

    // mist where it lands: soft additive puffs that rise and fade
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d')!;
    const grd = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = grd;
    c.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    const base = pts[pts.length - 1];
    for (let i = 0; i < 14; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.4, color: '#eef6f4' }));
      sp.userData = { phase: i / 14, ox: (Math.random() - 0.5) * 2.6, oz: (Math.random() - 0.2) * 1.6, base: base.clone() };
      this.mist.push(sp);
      this.group.add(sp);
    }
    // foam ring on the pool
    const foam = new THREE.Mesh(
      new THREE.CircleGeometry(1.9, 32),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: '#ffffff', opacity: 0.85 }),
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(base.x, T.waterY + 0.03, base.z + 0.4);
    this.group.add(foam);
  }

  /** Boulders where rock would gather: the cliff foot, the pool shore, the terrace edge. */
  private boulders(r: () => number) {
    const T = TITLE;
    const lists: Record<'rock_a' | 'rock_b' | 'rock_c', Placement[]> = { rock_a: [], rock_b: [], rock_c: [] };
    const kinds = ['rock_a', 'rock_b', 'rock_c'] as const;
    const put = (x: number, z: number, sc: number, sink = 0.25) => {
      const k = kinds[Math.floor(r() * 3)];
      lists[k].push({ x, z, y: this.seat(x, z, sc * 0.5) - sink * sc, rot: r() * 6.3, scale: sc, tilt: (r() - 0.5) * 0.3 });
    };
    // cliff foot: big scree blocks
    for (let i = 0; i < 26; i++) {
      const x = -26 + r() * 54;
      if (Math.abs(x - T.fall.x) < 2.2) continue;
      let z = -24;
      while (z > -40 && titleRock(x, z) < 0.5) z -= 0.4;
      put(x, z + 1.2 + r() * 2.5, 1.6 + r() * 2.8, 0.35);
    }
    // pool shore
    for (let i = 0; i < 18; i++) {
      const a = r() * Math.PI * 2;
      const x = T.pool.x + Math.cos(a) * T.pool.rx * (0.95 + r() * 0.15);
      const z = T.pool.z + Math.sin(a) * T.pool.rz * (0.95 + r() * 0.15);
      if (z > T.pool.z + 5 && x < 6) continue; // keep the view of the water open in front
      put(x, z, 0.8 + r() * 1.4, 0.3);
    }
    // the terrace's front edge and the left hill
    for (let i = 0; i < 10; i++) put(T.terrace.x0 + r() * 14, T.terrace.z1 + 0.4 + r() * 1.5, 0.7 + r() * 1.1, 0.35);
    for (let i = 0; i < 8; i++) put(-14 - r() * 10, -6 - r() * 14, 1 + r() * 1.8, 0.35);
    for (const k of kinds) this.instanced('rocks', k, lists[k]);
  }

  /** Ground cover placed by the land: grass on the open meadow, ferns in shade, flowers in drifts in the
   * foreground, litter under the tree, pebbles along the path and the shore. Nothing on Pip's slab, in the
   * water, on rock faces or on the path itself. */
  private scatter(r: () => number) {
    const T = TITLE;
    const s = T.slab;
    const onSlab = (x: number, z: number) => Math.abs(x - s.x) < 2.0 && Math.abs(z - s.z) < 1.7;
    const ok = (x: number, z: number, margin = 0.25) => {
      const h = titleHeight(x, z);
      return h > T.waterY + margin && titleRock(x, z) < 0.3 && !onSlab(x, z) && pathDist(x, z) > 0.8 && !(Math.abs(x - T.ring.x) < 3 && Math.abs(z - T.ring.z) < 1.6);
    };
    // density falls off with distance from the camera (most detail where it can be seen)
    const near = (z: number) => 0.25 + 0.75 * smooth(-30, 4, z);
    const take = (n: number, x0: number, x1: number, z0: number, z1: number, keep: (x: number, z: number) => number) => {
      const out: { x: number; z: number }[] = [];
      for (let tries = 0; out.length < n && tries < n * 30; tries++) {
        const x = x0 + r() * (x1 - x0);
        const z = z0 + r() * (z1 - z0);
        if (r() < keep(x, z) && ok(x, z)) out.push({ x, z });
      }
      return out;
    };
    const P = (p: { x: number; z: number }, s0: number, s1: number): Placement => ({ x: p.x, z: p.z, rot: r() * 6.3, scale: s0 + r() * (s1 - s0) });

    this.instanced('vegetation', 'grass_clump', take(2200, -28, 34, -30, 15, (x, z) => near(z)).map((p) => P(p, 0.8, 1.5)), false);
    this.instanced('vegetation', 'tall_grass', take(420, -28, 34, -28, 15, (x, z) => near(z) * (0.3 + smooth(4, 8, Math.abs(x)) * 0.7)).map((p) => P(p, 0.8, 1.4)), false);
    this.instanced('vegetation', 'fern', take(220, -26, 34, -30, 12, (x, z) => (x < -4 ? 0.9 : 0.15) + (z < -23 ? 0.6 : 0)).map((p) => P(p, 1.0, 1.9)));
    // plants that have taken hold on the cliff ledges (the flat treads between the strata)
    const ledges = take(700, -34, 36, -48, -27, () => 1);
    this.instanced('vegetation', 'grass_clump', ledges.slice(0, 520).map((p) => P(p, 1.2, 2.2)), false);
    this.instanced('vegetation', 'fern', ledges.slice(520).map((p) => P(p, 1.4, 2.4)), false);
    this.instanced('vegetation', 'clover', take(500, -12, 14, -8, 15, () => 1).map((p) => P(p, 1, 1.8)), false);
    this.instanced('vegetation', 'thistle', take(40, -20, 30, -20, 10, () => 1).map((p) => P(p, 0.9, 1.3)), false);

    // flowers in drifts: warm drift in the left foreground (the title's orange), white and violet beyond
    const drift = (cx: number, cz: number, rad: number, n: number, tints: string[]) => {
      const out: Placement[] = [];
      for (let i = 0; i < n * 4 && out.length < n; i++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * rad;
        const x = cx + Math.cos(a) * d;
        const z = cz + Math.sin(a) * d * 0.7;
        if (!ok(x, z)) continue;
        out.push({ x, z, rot: r() * 6.3, scale: 1.1 + r() * 0.9, color: new THREE.Color(tints[Math.floor(r() * tints.length)]) });
      }
      return out;
    };
    const warm = ['#ff7a2e', '#ff9440', '#ffb347', '#ff6a3a'];
    this.instanced(
      'vegetation',
      'flower_white',
      [
        ...drift(-3.6, 3.6, 2.6, 80, warm),
        ...drift(-5.8, 0.4, 2.2, 40, warm),
        ...drift(4.6, 3.8, 2.2, 45, warm),
        ...drift(-3.5, -6, 3, 40, ['#ffffff', '#fff3c4']),
        ...drift(14, -2, 3, 35, ['#ffffff', '#ffd27a']),
      ],
      false,
    );
    this.instanced('vegetation', 'flower_violet', [...drift(-8, 2, 3, 40, ['#ffffff']), ...drift(4, -9, 2.5, 30, ['#ffffff'])], false);
    this.instanced('vegetation', 'leaf_litter', take(70, -15, -4, -9, 4, () => 1).map((p) => P(p, 1, 1.6)), false);
    this.instanced('vegetation', 'pebbles', [
      ...PATH.flatMap(([x, z]) => [0, 1, 2].map(() => ({ x: x + (r() - 0.5) * 2.4, z: z + (r() - 0.5) * 2.4, rot: r() * 6.3, scale: 1 + r() }))),
      ...take(40, -6, 14, -12, -9, () => 1).map((p) => P(p, 1, 2)),
    ], false);
    this.instanced('props', 'mushroom_cluster', [
      { x: -8.2, z: -1.0, rot: 0.3, scale: 1.1 },
      { x: -10.8, z: -0.8, rot: 2.1, scale: 0.8 },
      { x: -7.6, z: -3.9, rot: 4, scale: 0.9 },
    ]);
  }

  /** A shard keeps a broken piece of the uplands aloft: a meadow-topped rock, glowing underneath. */
  private floatingIsland() {
    const root = new THREE.Group();
    const rock = this.single('rocks', 'rock_b', { x: 0, z: 0, y: 0, rot: 0, scale: 7.5, sy: 1.25 });
    rock.rotation.x = Math.PI;
    root.add(rock);
    const top = this.single('rocks', 'rock_c', { x: 0, z: 0, y: -0.6, rot: 1.3, scale: 6.2, sy: 0.6 });
    root.add(top);
    const t = this.single('tree', 'meadow_tree', { x: 0.8, z: 0.4, y: 1.4, rot: 0.6, scale: 1.1 });
    root.add(t);
    const glow = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.9),
      eraMaterial({ color: '#7ff7ee', emissive: '#3fe9dc', emissiveIntensity: 2.2, roughness: 0.2 }),
    );
    glow.scale.set(1, 1.8, 1);
    glow.position.set(0, -10.5, 0);
    root.add(glow);
    root.position.set(-15, 21, -66);
    this.group.add(root);
    this.island = root;
  }

  private findMaterial(asset: AssetName, prefix: string) {
    let found: THREE.Material | null = null;
    getAsset(asset)?.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!found && m && !Array.isArray(m) && m.name.startsWith(prefix)) found = m;
    });
    return found ? allEraMaterial(found) : null;
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    if (this.shard) {
      this.shard.rotation.y = t * 0.6;
      this.shard.position.y = Math.sin(t * 1.3) * 0.12;
    }
    if (this.ringGlow) this.ringGlow.emissiveIntensity = 2.2 + Math.sin(t * 2.1) * 0.6;
    if (this.island) this.island.position.y = 21 + Math.sin(t * 0.35) * 0.4;
    for (const sp of this.mist) {
      const u = sp.userData as { phase: number; ox: number; oz: number; base: THREE.Vector3 };
      const k = (u.phase + t * 0.12) % 1;
      sp.position.set(u.base.x + u.ox * (0.6 + k), TITLE.waterY + 0.3 + k * 3.2, u.base.z + u.oz + k * 0.8);
      const size = 1.6 + k * 3.4;
      sp.scale.set(size, size, 1);
      (sp.material as THREE.SpriteMaterial).opacity = 0.32 * Math.sin(k * Math.PI);
    }
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !this.borrowed.has(m.geometry)) m.geometry.dispose();
      if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) (m as unknown as THREE.InstancedMesh).dispose();
    });
  }
}
