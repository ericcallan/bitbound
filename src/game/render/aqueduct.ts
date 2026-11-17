import * as THREE from 'three';
import { getAsset, loadAsset, type AssetName } from './assets';
import { eraMaterial, PATTERN } from './eraMaterial';
import { makeWaterfall, type Waterfall } from './waterfall';
import { LEVEL } from '../level/meadows';
import { valleyHeight, WATER_Y } from '../level/valley';
import { rng } from '../math';

/**
 * The broken aqueduct's surroundings (the structure itself is the Blender viaduct, placed by LevelView on the
 * aqA / aqB colliders). What makes it a place rather than two slabs over a gap:
 *  - water still runs along each half's channel and pours off the broken end into the river
 *  - the fallen span lies in the river below the gap
 *  - the canyon walls are broken up by rock outcrops with plants on their ledges
 *  - ivy hangs from the decks (more of it in Beyond), lavender grows on both banks
 *  - each broken end glows faintly teal where the world folded it: the two ends belong together
 * Exists from Early 3D up (the retro generations draw the canyon as tiles).
 */
const AQ = LEVEL.aqueduct;
const Y = AQ.y;

interface Half {
  x0: number;
  x1: number;
  z: number;
  /** +1: the break is at x1 and water runs toward +x; -1: at x0. */
  dir: 1 | -1;
}

export class AqueductView {
  group = new THREE.Group();
  ready = false;
  private falls: Waterfall[] = [];
  private seams: THREE.MeshStandardMaterial[] = [];
  private t = 0;

  constructor(halves: { aqA: THREE.Box3; aqB: THREE.Box3 }) {
    const A: Half = { x0: halves.aqA.min.x, x1: halves.aqA.max.x, z: (halves.aqA.min.z + halves.aqA.max.z) / 2, dir: 1 };
    const B: Half = { x0: halves.aqB.min.x, x1: halves.aqB.max.x, z: (halves.aqB.min.z + halves.aqB.max.z) / 2, dir: -1 };
    for (const h of [A, B]) {
      this.channel(h);
      this.fall(h);
      this.seam(h);
    }
    this.backFalls();
    const need: AssetName[] = ['rocks', 'vegetation', 'aqueduct'];
    void Promise.all(need.map(loadAsset)).then(() => this.build([A, B]));
  }

  /** Water running along the top of each half toward its break (a strip flush with the deck). */
  private channel(h: Half) {
    const len = h.x1 - h.x0;
    const m = eraMaterial({ color: '#1c4744', roughness: 0.12, pattern: PATTERN.water, transparent: true, opacity: 0.86, minEra: 2 });
    m.envMapIntensity = 0.35;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.1, 0.46, Math.ceil(len * 2), 1), m);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set((h.x0 + h.x1) / 2, Y + 0.012, h.z);
    strip.receiveShadow = true;
    this.group.add(strip);
  }

  /** The channel pours off the broken end: a ribbon arcing out and down to the river. */
  private fall(h: Half) {
    const lip = h.dir > 0 ? h.x1 : h.x0;
    const pts: THREE.Vector3[] = [];
    const top = Y - 0.02;
    const N = 26;
    for (let i = 0; i <= N; i++) {
      const k = i / N;
      const y = top - (top - WATER_Y) * k;
      // leaves the lip with some speed, then falls nearly straight
      const out = 0.15 + Math.sqrt(k) * 1.6;
      pts.push(new THREE.Vector3(lip + h.dir * out, y, h.z));
    }
    const f = makeWaterfall(pts, new THREE.Vector3(0, 0, 1), 0.55, 1.6, { waterY: WATER_Y, mist: 10, opacity: 0.95, crossed: true });
    this.falls.push(f);
    this.group.add(f.group);
  }

  /** Streams from the uplands spill down the canyon's far walls into the river: depth and movement behind the
   * aqueduct, as in a deep gorge. */
  private backFalls() {
    for (const [side, z] of [[-1, -16], [1, -23]] as const) {
      // find the lip: the wall's top edge at this depth
      let top = Y;
      for (let y = Y; y < Y + 22; y += 0.25) if (this.wallX(side, y, z) !== null) top = y;
      const wx = this.wallX(side, top - 0.3, z);
      if (wx === null) continue;
      const pts: THREE.Vector3[] = [];
      const N = 30;
      for (let i = 0; i <= N; i++) {
        const k = i / N;
        const y = top - 0.1 - (top - 0.1 - WATER_Y) * k;
        // hug the wall as it falls, a little proud of it
        const x = (this.wallX(side, y, z) ?? wx) - side * (0.35 + Math.sqrt(k) * 0.6);
        pts.push(new THREE.Vector3(x, y, z));
      }
      const f = makeWaterfall(pts, new THREE.Vector3(0, 0, 1), 1.2, 2.6, { waterY: WATER_Y, mist: 12, opacity: 0.9 });
      this.falls.push(f);
      this.group.add(f.group);
    }
  }

  /** Where the world folded: a faint teal light flowing across each broken end. */
  private seam(h: Half) {
    const m = eraMaterial({ color: '#0d3a37', emissive: '#4ff5e6', emissiveIntensity: 0.9, transparent: true, opacity: 0.55, side: THREE.DoubleSide, minEra: 2 });
    m.depthWrite = false;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.85), m);
    p.rotation.y = Math.PI / 2;
    p.position.set((h.dir > 0 ? h.x1 : h.x0) + h.dir * 0.04, Y - 0.45, h.z);
    this.seams.push(m);
    this.group.add(p);
  }

  private build(halves: Half[]) {
    if (this.ready) return;
    const r = rng(41);
    // the fallen span, in the river under the gap
    this.single('aqueduct', 'aq_rubble', new THREE.Vector3((AQ.x0 + AQ.x1) / 2, WATER_Y - 0.45, 0.4), 0.3, 1);
    this.outcrops(r);
    this.ivy(halves, r);
    this.banks(r);
    this.ready = true;
  }

  private single(asset: AssetName, node: string, at: THREE.Vector3, rotY: number, scale: number) {
    const g = getAsset(asset);
    const src = g?.scene.getObjectByName(node);
    if (!src) return;
    const o = src.clone(true);
    o.position.add(at);
    o.rotation.y += rotY;
    o.scale.multiplyScalar(scale);
    o.traverse((c) => ((c as THREE.Mesh).isMesh ? ((c.castShadow = true), (c.receiveShadow = true)) : null));
    this.group.add(o);
  }

  private instanced(asset: AssetName, node: string, list: { p: THREE.Vector3; rot: THREE.Euler; s: THREE.Vector3; color?: THREE.Color }[], shadow = true) {
    const g = getAsset(asset);
    const src = g?.scene.getObjectByName(node);
    if (!g || !src || list.length === 0) return;
    g.scene.updateMatrixWorld(true);
    const parts: THREE.Mesh[] = [];
    src.traverse((o) => (o as THREE.Mesh).isMesh && parts.push(o as THREE.Mesh));
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (const part of parts) {
      const inst = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      list.forEach((it, i) => {
        q.setFromEuler(it.rot);
        m4.compose(it.p, q, it.s).multiply(part.matrixWorld);
        inst.setMatrixAt(i, m4);
        if (it.color) inst.setColorAt(i, it.color);
      });
      inst.castShadow = shadow;
      inst.receiveShadow = true;
      inst.computeBoundingSphere();
      this.group.add(inst);
    }
  }

  /**
   * Where a canyon wall stands at height y and depth z: scanning from inside the canyon toward the bank on one
   * side (-1: the seal bank, wall facing +x; +1: the summit bank, wall facing -x). Null if no wall there.
   */
  private wallX(side: -1 | 1, y: number, z: number): number | null {
    const mid = (AQ.x0 + AQ.x1) / 2;
    for (let d = 0; d < 26; d += 0.1) {
      const x = mid + side * d;
      if (valleyHeight(x, z) >= y) return x;
    }
    return null;
  }

  /** Rock outcrops breaking up the canyon walls (behind the lane, and well in front of it below the deck), with
   * ferns and grass on their tops. Kept off the lane's line of sight around the decks. */
  private outcrops(r: () => number) {
    const kinds = ['rock_a', 'rock_b', 'rock_c'] as const;
    const lists: Record<(typeof kinds)[number], { p: THREE.Vector3; rot: THREE.Euler; s: THREE.Vector3 }[]> = { rock_a: [], rock_b: [], rock_c: [] };
    const ledges: { p: THREE.Vector3; rot: THREE.Euler; s: THREE.Vector3 }[] = [];
    const grass: { p: THREE.Vector3; rot: THREE.Euler; s: THREE.Vector3 }[] = [];
    for (let i = 0; i < 120; i++) {
      const side = r() < 0.5 ? -1 : 1;
      const behind = r() < 0.7;
      const z = behind ? -3.8 - r() * 26 : 7 + r() * 14;
      // behind the lane the walls rise well above the deck and are broken up all the way; in front of the lane,
      // stay below the deck so nothing rises between the 2D camera and Pip
      const yMax = behind ? Y + 2 + Math.max(0, -z - 6) * 0.6 : Y - 3;
      const y = WATER_Y + 0.2 + r() * (yMax - WATER_Y - 0.2);
      const wx = this.wallX(side as -1 | 1, y, z);
      if (wx === null) continue;
      // smaller and flatter higher up: ledges of the bedrock rather than boulders
      const high = Math.max(0, y - Y) / 12;
      const s = (1.4 + r() * 2.6) * (1 - high * 0.45);
      const k = high > 0.15 ? 'rock_c' : kinds[Math.floor(r() * 3)];
      // centred inside the wall (side -1: the wall faces +x), so only a third of it stands out
      const p = new THREE.Vector3(wx + side * s * 0.35, y - s * 0.2, z);
      lists[k].push({ p, rot: new THREE.Euler((r() - 0.5) * 0.3, r() * Math.PI * 2, (r() - 0.5) * 0.3), s: new THREE.Vector3(s, s * (0.55 + r() * 0.4), s) });
      // a fern or grass tuft on the outcrop's top, at its outer edge
      const top = new THREE.Vector3(wx - side * s * 0.12, p.y + s * 0.35, z);
      if (r() < 0.6) ledges.push({ p: top, rot: new THREE.Euler(0, r() * 6.3, 0), s: new THREE.Vector3(1, 1, 1).multiplyScalar(1.1 + r()) });
      else grass.push({ p: top, rot: new THREE.Euler(0, r() * 6.3, 0), s: new THREE.Vector3(1, 1, 1).multiplyScalar(1.2 + r()) });
    }
    // boulders along the river's edges under the canyon walls
    for (let i = 0; i < 26; i++) {
      const side = r() < 0.5 ? -1 : 1;
      const z = (r() - 0.5) * 40;
      if (Math.abs(z) < 3 && r() < 0.7) continue;
      const wx = this.wallX(side as -1 | 1, WATER_Y + 0.5, z);
      if (wx === null) continue;
      const s = 0.9 + r() * 1.8;
      lists[kinds[Math.floor(r() * 3)]].push({
        p: new THREE.Vector3(wx - side * (0.4 + r() * 1.2), WATER_Y - s * 0.3, z),
        rot: new THREE.Euler(0, r() * 6.3, 0),
        s: new THREE.Vector3(s, s, s),
      });
    }
    for (const k of kinds) this.instanced('rocks', k, lists[k]);
    this.instanced('vegetation', 'fern', ledges, false);
    this.instanced('vegetation', 'tall_grass', grass, false);
  }

  /** Ivy hanging from the decks' edges and the canyon rims. A few strands in Modern HD, many more in Beyond. */
  private ivy(halves: Half[], r: () => number) {
    const tex = ivyTexture();
    const geo = new THREE.PlaneGeometry(0.55, 1, 1, 10);
    geo.translate(0, -0.5, 0);
    const mats = [4, 5].map((minEra) => {
      const m = eraMaterial({
        color: '#ffffff',
        roughness: 0.75,
        side: THREE.DoubleSide,
        minEra,
        vertexWorld: `{
          // sway more toward the free end of the strand (uv.y is 1 at the top, 0 at the end)
          float hang = 1.0 - uv.y;
          wp.x += sin(uTime * 1.3 + wp.y * 0.7 + wp.z * 0.3) * 0.06 * hang;
          wp.z += sin(uTime * 1.1 + wp.y * 0.9) * 0.05 * hang;
        }`,
      });
      m.map = tex;
      m.alphaTest = 0.45;
      m.shadowSide = THREE.DoubleSide;
      return m;
    });
    // all strands of one kind are a single instanced draw
    const strands: [THREE.Matrix4[], THREE.Matrix4[]] = [[], []];
    const put = (x: number, y: number, z: number, len: number, rotY: number, beyond: boolean) => {
      strands[beyond ? 1 : 0].push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(1, len, 1)));
    };
    for (const h of halves) {
      for (let i = 0; i < 16; i++) {
        // along the far (back) face of each half; the near face stays clear so nothing hangs in front of the 2D lane
        const x = h.x0 + 0.4 + r() * (h.x1 - h.x0 - 1.2);
        const back = h.z < 0 ? h.z - 0.83 : h.z + 0.83;
        const front = h.z < 0 ? h.z + 0.83 : h.z - 0.83;
        // the near half's camera-facing side keeps only a few strands, so the arches below read in 2D
        const z = r() < (h.z > 0 ? 0.93 : 0.6) ? back : front;
        put(x, Y - 0.05, z, 1.2 + r() * 3.4, r() * 0.3, i >= 6);
      }
    }
    // the canyon rims behind the lane
    for (let i = 0; i < 26; i++) {
      const side = r() < 0.5 ? -1 : 1;
      const z = -4 - r() * 16;
      const wx = this.wallX(side as -1 | 1, Y - 0.2, z);
      if (wx === null) continue;
      put(wx - side * 0.05, Y + 0.1, z, 2 + r() * 5, side > 0 ? -Math.PI / 2 : Math.PI / 2, i >= 9);
    }
    strands.forEach((list, k) => {
      const inst = new THREE.InstancedMesh(geo, mats[k], list.length);
      list.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.castShadow = true;
      inst.computeBoundingSphere();
      this.group.add(inst);
    });
  }

  /** Lavender drifts on both banks, behind the lane (never between the 2D camera and the path). */
  private banks(r: () => number) {
    const list: { p: THREE.Vector3; rot: THREE.Euler; s: THREE.Vector3; color?: THREE.Color }[] = [];
    const tints = ['#b48cff', '#9a72f0', '#c7a6ff', '#8c6ae0'];
    const drift = (cx: number, cz: number, rad: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * rad;
        const x = cx + Math.cos(a) * d;
        const z = cz + Math.sin(a) * d * 0.6;
        const h = valleyHeight(x, z);
        if (Math.abs(h - Y) > 0.6 || z > -3.4) continue;
        list.push({ p: new THREE.Vector3(x, h, z), rot: new THREE.Euler(0, r() * 6.3, 0), s: new THREE.Vector3(1, 1, 1).multiplyScalar(1.2 + r() * 0.8), color: new THREE.Color(tints[Math.floor(r() * tints.length)]) });
      }
    };
    // (none on the landing behind the seal door: that's where the chase camera stands)
    drift(206, -6.5, 3.2, 70);
    drift(229, -6, 3, 60);
    drift(236, -7, 3.5, 60);
    this.instanced('vegetation', 'flower_violet', list, false);
  }

  update(dt: number) {
    this.t += dt;
    for (const f of this.falls) f.update(dt);
    // the fold seams breathe slowly, out of step with each other
    this.seams.forEach((m, i) => (m.emissiveIntensity = 0.7 + 0.5 * Math.sin(this.t * 1.4 + i * 2.1)));
  }

  dispose() {
    for (const f of this.falls) f.dispose();
  }
}

let ivyTex: THREE.Texture | null = null;
/** A strand of ivy drawn once: a wandering stem with heart-shaped leaves on alternating sides. */
function ivyTexture() {
  if (ivyTex) return ivyTex;
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 256;
  const c = cv.getContext('2d')!;
  const r = rng(9);
  c.strokeStyle = '#4a5a2a';
  c.lineWidth = 2;
  c.beginPath();
  let x = 32;
  c.moveTo(x, 0);
  const stem: [number, number][] = [];
  for (let y = 0; y <= 256; y += 8) {
    x += (r() - 0.5) * 6;
    x = Math.max(20, Math.min(44, x));
    c.lineTo(x, y);
    stem.push([x, y]);
  }
  c.stroke();
  stem.forEach(([sx, sy], i) => {
    if (i % 1 !== 0 || sy > 250) return;
    const side = i % 2 ? 1 : -1;
    const size = 7 + r() * 6 - (sy / 256) * 3;
    const lx = sx + side * (size * 0.9);
    const ly = sy + 2;
    const g = 70 + Math.floor(r() * 50);
    c.fillStyle = `rgb(${30 + Math.floor(r() * 25)}, ${g + 40}, ${25 + Math.floor(r() * 20)})`;
    c.beginPath();
    c.moveTo(sx, sy);
    c.bezierCurveTo(lx - side * size * 0.2, ly - size, lx + side * size * 0.9, ly - size * 0.4, lx + side * size * 0.3, ly + size * 0.6);
    c.bezierCurveTo(lx, ly + size * 0.2, sx + side * size * 0.2, sy + size * 0.6, sx, sy);
    c.fill();
    c.strokeStyle = 'rgba(20,40,15,0.5)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(sx, sy);
    c.lineTo(lx + side * size * 0.2, ly);
    c.stroke();
  });
  ivyTex = new THREE.CanvasTexture(cv);
  ivyTex.colorSpace = THREE.SRGBColorSpace;
  ivyTex.anisotropy = 4;
  return ivyTex;
}
