import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PATTERN, sharedEraMaterial } from './eraMaterial';
import { eras as E, type EraSwapRegistry } from './eraSwap';
import type { DecorDef } from '../level/meadows';
import { rng } from '../math';
import { instanceOf, type AssetName } from './assets';

/**
 * A placeholder for a Blender asset: shows `fallback` until the GLB has loaded, then `fillAssetSlots`
 * (called by the owning view whenever an asset arrives) swaps in the real model.
 */
export function assetSlot(asset: AssetName, node: string, fallback: THREE.Object3D, scale = 1, rotY = 0) {
  const group = new THREE.Group();
  group.add(fallback);
  group.userData.assetSlot = { asset, node, scale, rotY, filled: false };
  return group;
}
export function fillAssetSlots(root: THREE.Object3D) {
  const todo: THREE.Object3D[] = [];
  root.traverse((o) => {
    const s = o.userData.assetSlot;
    if (s && !s.filled) todo.push(o);
  });
  for (const g of todo) {
    const s = g.userData.assetSlot;
    const obj = instanceOf(s.asset, s.node);
    if (!obj) continue;
    g.clear();
    // Scale/rotate a holder: the model's own node transform carries its quantization and must stay.
    const holder = new THREE.Group();
    holder.scale.setScalar(s.scale);
    holder.rotation.y = s.rotY;
    holder.add(obj);
    g.add(holder);
    s.filled = true;
  }
}

export const M = {
  trunk: () => sharedEraMaterial('trunk', { color: '#7a4a2e', pattern: PATTERN.wood }),
  leaf: () => sharedEraMaterial('leaf', { color: '#3fae4a', roughness: 0.8 }),
  leafDark: () => sharedEraMaterial('leafDark', { color: '#258a45', roughness: 0.8 }),
  leafLight: () => sharedEraMaterial('leafLight', { color: '#8fd85a', roughness: 0.8 }),
  stone: () => sharedEraMaterial('stone', { color: '#b3abc0', pattern: PATTERN.stone }),
  ruin: () => sharedEraMaterial('ruin', { color: '#c4b59c', pattern: PATTERN.ruin }),
  ruinDark: () => sharedEraMaterial('ruinDark', { color: '#8d8299', pattern: PATTERN.ruin }),
  rune: () => sharedEraMaterial('rune', { color: '#11665f', emissive: '#2fd6c3', emissiveIntensity: 1.7 }),
  runeDim: () => sharedEraMaterial('runeDim', { color: '#0f3b3a', emissive: '#2fd6c3', emissiveIntensity: 0.35 }),
  cream: () => sharedEraMaterial('cream', { color: '#fff4d6' }),
  white: () => sharedEraMaterial('white', { color: '#ffffff', roughness: 0.3 }),
  ink: () => sharedEraMaterial('ink', { color: '#141a33', roughness: 0.3 }),
  purple: () => sharedEraMaterial('purple', { color: '#8e5bd6' }),
  pink: () => sharedEraMaterial('pink', { color: '#ff8fb8' }),
  orange: () => sharedEraMaterial('orange', { color: '#f0862a' }),
  yellow: () => sharedEraMaterial('yellow', { color: '#ffcf6b' }),
  wood: () => sharedEraMaterial('wood', { color: '#a8703f', pattern: PATTERN.wood }),
  stem: () => sharedEraMaterial('stem', { color: '#2f9a4a' }),
  moss: () => sharedEraMaterial('moss', { color: '#4f9a3a', roughness: 0.95 }),
  metal: () => sharedEraMaterial('metal', { color: '#6e7aa0', metalness: 0.6, roughness: 0.35, pattern: PATTERN.metal }),
  cloud: () => sharedEraMaterial('cloud', { color: '#ffffff', roughness: 1, flatBoost: 1.08, emissive: '#cfe6ff', emissiveIntensity: 0.25 }),
};

/** Modern HD / Beyond materials for the hero plants: velvety petals, waxy leaves, glossy eyes. */
const HD = {
  petal: () => sharedEraMaterial('hdPetal', { color: '#ff86b4', roughness: 0.55, physical: { sheen: 1, sheenColor: new THREE.Color('#ffd1e4') } }),
  head: () => sharedEraMaterial('hdHead', { color: '#7d48d0', roughness: 0.45, physical: { sheen: 0.7, sheenColor: new THREE.Color('#c9a6ff'), clearcoat: 0.25 } }),
  stem: () => sharedEraMaterial('hdStem', { color: '#2e8a3e', roughness: 0.5, physical: { clearcoat: 0.3, clearcoatRoughness: 0.4 } }),
  leaf: () => sharedEraMaterial('hdLeaf', { color: '#2a7a3a', roughness: 0.48, side: THREE.DoubleSide, physical: { clearcoat: 0.45, clearcoatRoughness: 0.35, sheen: 0.3 } }),
  eye: () => sharedEraMaterial('hdEye', { color: '#ffffff', roughness: 0.15, physical: { clearcoat: 1, clearcoatRoughness: 0.05 } }),
  pupil: () => sharedEraMaterial('hdPupil', { color: '#0c1024', roughness: 0.08, physical: { clearcoat: 1, clearcoatRoughness: 0.02 } }),
};

/** A pointed leaf blade: a thin, curved, two-sided shape. */
function leafBlade(len: number, width: number, mat: THREE.Material) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(len * 0.45, width, len, 0);
  shape.quadraticCurveTo(len * 0.45, -width, 0, 0);
  const geo = new THREE.ShapeGeometry(shape, 10);
  // curl the blade: lift the edges and droop the tip
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, Math.abs(y) * 0.6 - (x / len) ** 2 * len * 0.25);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

const box = (w: number, h: number, d: number, mat: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
const rbox = (w: number, h: number, d: number, r: number, mat: THREE.Material) =>
  new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, r), mat);
const sphere = (r: number, mat: THREE.Material, detail = 18) => new THREE.Mesh(new THREE.SphereGeometry(r, detail, Math.max(6, detail * 0.7)), mat);
const ico = (r: number, mat: THREE.Material, d = 0) => new THREE.Mesh(new THREE.IcosahedronGeometry(r, d), mat);
const cyl = (rt: number, rb: number, h: number, mat: THREE.Material, seg = 12) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number) => (o.position.set(x, y, z), o);

export interface Animated {
  update(t: number, ctx: AnimCtx): void;
}
export interface AnimCtx {
  pip: THREE.Vector3;
  era: (p: THREE.Vector3) => number;
  gearSpeed: number;
  machineEye: number;
}

/** Builds one decoration; returns the group and optional per-frame animation. */
export function buildDecor(def: DecorDef, reg: EraSwapRegistry): { obj: THREE.Object3D; anim?: Animated } {
  const g = new THREE.Group();
  g.position.set(def.pos.x, def.pos.y, def.pos.z);
  const s = def.scale ?? 1;
  const r = rng(def.seed ?? 1);
  const anchor = new THREE.Vector3(def.pos.x, def.pos.y, def.pos.z);
  let anim: Animated | undefined;

  switch (def.type) {
    case 'tree': {
      const h = (2.4 + r() * 1.2) * s;
      // 8-bit: blocky
      const t8 = new THREE.Group();
      t8.add(at(box(0.5 * s, h, 0.5 * s, M.trunk()), 0, h / 2, 0));
      t8.add(at(box(2.2 * s, 1.2 * s, 1.6 * s, M.leaf()), 0, h + 0.2, 0));
      t8.add(at(box(1.4 * s, 0.9 * s, 1.2 * s, M.leafLight()), 0, h + 1.1 * s, 0));
      // 16-bit: faceted clusters
      const t16 = new THREE.Group();
      t16.add(at(cyl(0.18 * s, 0.3 * s, h, M.trunk(), 6), 0, h / 2, 0));
      const blobs = [
        [0, h + 0.3, 0, 1.15],
        [-0.8, h - 0.1, 0.1, 0.8],
        [0.85, h, -0.1, 0.85],
        [0.1, h + 1.05, 0, 0.75],
      ];
      for (const [x, y, z, rad] of blobs) t16.add(at(ico(rad * s, x === 0 ? M.leaf() : M.leafDark(), 0), x * s, y, z * s));
      // modern: soft round canopy
      const tM = new THREE.Group();
      const trunk = cyl(0.16 * s, 0.32 * s, h, M.trunk(), 14);
      tM.add(at(trunk, 0, h / 2, 0));
      for (const [x, y, z, rad] of blobs) {
        tM.add(at(sphere(rad * s * 1.05, M.leaf(), 20), x * s, y, z * s));
        tM.add(at(sphere(rad * s * 0.55, M.leafLight(), 14), x * s + 0.2 * s, y + rad * 0.45 * s, z * s + 0.3 * s));
      }
      // early 3D: a box trunk and stacked low-poly cones
      const tL = new THREE.Group();
      tL.add(at(cyl(0.22 * s, 0.3 * s, h, M.trunk(), 4), 0, h / 2, 0));
      tL.add(at(new THREE.Mesh(new THREE.ConeGeometry(1.5 * s, 1.8 * s, 5), M.leaf()), 0, h + 0.3, 0));
      tL.add(at(new THREE.Mesh(new THREE.ConeGeometry(1.05 * s, 1.4 * s, 5), M.leafDark()), 0, h + 1.2 * s, 0));
      // Modern HD and Beyond: the Blender trees (the Great Tree where the old one stood tallest).
      const great = s >= 1.2;
      const tHD = assetSlot('tree', great ? 'great_tree' : 'meadow_tree', tM.clone(), s * (great ? 0.62 : 0.78), r() * Math.PI * 2);
      // No 8-bit variant: the first consoles had no background scenery.
      reg.variants(g, [[t16, E(1)], [tL, E(2)], [tM, E(3)], [tHD, E(4, 5)]], anchor, false);
      break;
    }
    case 'bush': {
      // Modern HD and Beyond: a Blender fern clump instead of the cartoon blob.
      const fernHD = assetSlot('vegetation', 'fern', new THREE.Group(), 2.2 * s, r() * Math.PI * 2);
      const b8 = new THREE.Group();
      b8.add(at(box(1.6 * s, 0.9 * s, 0.9 * s, M.leaf()), 0, 0.45 * s, 0));
      b8.add(at(box(0.9 * s, 0.5 * s, 0.7 * s, M.leafLight()), 0.2 * s, 1.0 * s, 0));
      const bR = new THREE.Group();
      const n = 5;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1) - 0.5) * 1.5 * s;
        const rad = (0.45 + r() * 0.25) * s;
        const m = r() > 0.4 ? M.leaf() : M.leafDark();
        bR.add(at(sphere(rad, m, 16), x, rad * 0.9, (r() - 0.5) * 0.3));
      }
      bR.add(at(sphere(0.5 * s, M.leafLight(), 16), 0.1 * s, 0.9 * s, 0.05));
      const bL = new THREE.Group();
      bL.add(at(ico(0.75 * s, M.leaf(), 0), -0.35 * s, 0.55 * s, 0));
      bL.add(at(ico(0.6 * s, M.leafDark(), 0), 0.45 * s, 0.45 * s, 0));
      reg.variants(g, [[bL, E(2)], [bR, E(1, 3, [2])], [fernHD, E(4, 5)]], anchor, false);
      break;
    }
    case 'bloomer': {
      // A giant expressive plant that turns to watch Pip and blinks.
      const pixelFlower = new THREE.Group();
      pixelFlower.add(at(box(0.15, 1.2 * s, 0.15, M.stem()), 0, 0.6 * s, 0));
      pixelFlower.add(at(box(0.6 * s, 0.6 * s, 0.3, M.pink()), 0, 1.4 * s, 0));
      const plant = new THREE.Group();
      const stemH = 1.5 * s;
      const stem = cyl(0.07 * s, 0.1 * s, stemH, M.stem(), 8);
      plant.add(at(stem, 0, stemH / 2, 0));
      const leaf1 = sphere(0.3 * s, M.leafDark(), 12);
      leaf1.scale.set(1.6, 0.35, 0.8);
      leaf1.rotation.z = 0.5;
      plant.add(at(leaf1, 0.35 * s, 0.4 * s, 0));
      const leaf2 = leaf1.clone();
      leaf2.rotation.z = -0.5;
      plant.add(at(leaf2, -0.35 * s, 0.65 * s, 0));
      const head = new THREE.Group();
      head.position.y = stemH + 0.25 * s;
      const bulb = sphere(0.48 * s, M.purple(), 20);
      bulb.scale.set(1, 0.9, 0.9);
      head.add(bulb);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const petal = sphere(0.2 * s, M.pink(), 10);
        petal.scale.set(1.2, 0.6, 0.6);
        petal.position.set(Math.cos(a) * 0.5 * s, Math.sin(a) * 0.5 * s, -0.12 * s);
        petal.rotation.z = a;
        head.add(petal);
      }
      const eyes: THREE.Object3D[] = [];
      for (const ex of [-0.17, 0.17]) {
        const eye = new THREE.Group();
        eye.position.set(ex * s, 0.06 * s, 0.38 * s);
        eye.add(sphere(0.12 * s, M.white(), 12));
        eye.add(at(sphere(0.06 * s, M.ink(), 10), 0, 0, 0.08 * s));
        head.add(eye);
        eyes.push(eye);
      }
      const smile = new THREE.Mesh(new THREE.TorusGeometry(0.1 * s, 0.022 * s, 6, 12, Math.PI), M.ink());
      smile.rotation.z = Math.PI;
      smile.position.set(0, -0.14 * s, 0.42 * s);
      head.add(smile);
      plant.add(head);

      // Modern HD and Beyond: the same character, built with real detail. A curving stem, curled blades,
      // shaped velvet petals in two rings, glossy eyes with a catch-light.
      const plantHD = new THREE.Group();
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.05 * s, stemH * 0.35, 0.02 * s),
        new THREE.Vector3(-0.04 * s, stemH * 0.7, -0.02 * s),
        new THREE.Vector3(0, stemH + 0.05 * s, 0),
      ]);
      const stemHD = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.06 * s, 10), HD.stem());
      plantHD.add(stemHD);
      for (const [y, a, len] of [[0.35, 0.3, 0.75], [0.6, Math.PI + 0.4, 0.65], [0.9, 1.9, 0.5]] as const) {
        const blade = leafBlade(len * s, 0.16 * s, HD.leaf());
        blade.position.set(0, y * s, 0);
        blade.rotation.set(-Math.PI / 2 + 0.55, a, 0);
        plantHD.add(blade);
      }
      const headHD = new THREE.Group();
      headHD.position.y = stemH + 0.25 * s;
      const bulbHD = new THREE.Mesh(new THREE.SphereGeometry(0.48 * s, 40, 28), HD.head());
      bulbHD.scale.set(1, 0.92, 0.88);
      headHD.add(bulbHD);
      for (let ring = 0; ring < 2; ring++) {
        const n = ring ? 11 : 9;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + ring * 0.3;
          const len = (ring ? 0.3 : 0.36) * s;
          const petal = leafBlade(len, 0.13 * s, HD.petal());
          petal.position.set(Math.cos(a) * 0.4 * s, Math.sin(a) * 0.4 * s, (-0.1 - ring * 0.06) * s);
          petal.rotation.set(0, 0.35, a);
          headHD.add(petal);
        }
      }
      const eyesHD: THREE.Object3D[] = [];
      for (const ex of [-0.17, 0.17]) {
        const eye = new THREE.Group();
        eye.position.set(ex * s, 0.06 * s, 0.36 * s);
        eye.add(new THREE.Mesh(new THREE.SphereGeometry(0.12 * s, 24, 16), HD.eye()));
        eye.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.062 * s, 20, 14), HD.pupil()), 0, 0, 0.075 * s));
        eye.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.018 * s, 8, 6), M.white()), 0.025 * s, 0.03 * s, 0.13 * s));
        headHD.add(eye);
        eyesHD.push(eye);
      }
      const smileHD = new THREE.Mesh(new THREE.TorusGeometry(0.1 * s, 0.018 * s, 10, 24, Math.PI), HD.pupil());
      smileHD.rotation.z = Math.PI;
      smileHD.position.set(0, -0.14 * s, 0.4 * s);
      headHD.add(smileHD);
      plantHD.add(headHD);
      plantHD.traverse((o) => ((o as THREE.Mesh).isMesh && (o.castShadow = true)));

      reg.variants(g, [[plant, E(1, 3)], [plantHD, E(4, 5)]], anchor, true);
      const phase = r() * 10;
      let blink = 0;
      const rigs = [
        { root: plant, head, eyes, stem },
        { root: plantHD, head: headHD, eyes: eyesHD, stem: stemHD },
      ];
      anim = {
        update(t, ctx) {
          const dx = ctx.pip.x - def.pos.x;
          const want = Math.max(-0.9, Math.min(0.9, Math.atan2(dx, 3)));
          const near = Math.abs(dx) < 3 ? 1 : 0;
          blink -= 1 / 60;
          if (blink < -3 - (phase % 2)) blink = 0.12;
          for (const k of rigs) {
            if (!k.root.visible) continue;
            k.head.rotation.y += (want - k.head.rotation.y) * 0.08;
            k.head.position.y = stemH + 0.25 * s + Math.sin(t * (2 + near * 4) + phase) * (0.04 + near * 0.06) * s;
            k.head.rotation.z = Math.sin(t * 1.3 + phase) * 0.08;
            k.stem.rotation.z = Math.sin(t * 1.3 + phase) * 0.04;
            for (const e of k.eyes) e.scale.y = blink > 0 ? 0.15 : 1;
          }
        },
      };
      break;
    }
    case 'flowers': {
      const grp = new THREE.Group();
      const cols = [M.cream(), M.yellow(), M.pink(), M.purple()];
      const n = 6 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const f = new THREE.Group();
        const h = 0.25 + r() * 0.3;
        f.add(at(cyl(0.015, 0.02, h, M.stem(), 5), 0, h / 2, 0));
        f.add(at(sphere(0.07 + r() * 0.04, cols[Math.floor(r() * cols.length)], 8), 0, h, 0));
        f.position.set((r() - 0.5) * 1.6, 0, (r() - 0.5) * 0.6);
        grp.add(f);
      }
      reg.variants(g, [[grp, E(1, 5)]], anchor, true);
      anim = {
        update(t) {
          grp.children.forEach((c, i) => (c.rotation.z = Math.sin(t * 2 + i) * 0.12));
        },
      };
      break;
    }
    case 'mushroom': {
      const m8 = new THREE.Group();
      m8.add(at(box(0.2, 0.35, 0.2, M.cream()), 0, 0.17, 0));
      m8.add(at(box(0.6, 0.25, 0.6, M.orange()), 0, 0.45, 0));
      const mR = new THREE.Group();
      mR.add(at(cyl(0.09, 0.13, 0.4, M.cream(), 10), 0, 0.2, 0));
      const capGeo = new THREE.SphereGeometry(0.34, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      const cap = new THREE.Mesh(capGeo, M.orange());
      cap.position.y = 0.36;
      mR.add(cap);
      for (let i = 0; i < 5; i++) {
        const a = r() * Math.PI * 2;
        const dot = sphere(0.05, M.cream(), 6);
        dot.position.set(Math.cos(a) * 0.22, 0.58 - 0.0, Math.sin(a) * 0.22);
        dot.position.y = 0.36 + Math.sqrt(Math.max(0, 0.34 * 0.34 - 0.22 * 0.22));
        mR.add(dot);
      }
      // Modern HD and Beyond: a Blender cluster of wild mushrooms
      const mHD = assetSlot('props', 'mushroom_cluster', new THREE.Group(), 1.15, r() * Math.PI * 2);
      reg.variants(g, [[mR, E(1, 3)], [mHD, E(4, 5)]], anchor, false);
      g.scale.setScalar(s);
      break;
    }
    case 'pillar': {
      const h = 2.6 * s;
      const p8 = new THREE.Group();
      p8.add(at(box(0.8, h, 0.8, M.ruin()), 0, h / 2, 0));
      const pR = new THREE.Group();
      pR.add(at(box(1.0, 0.3, 1.0, M.ruinDark()), 0, 0.15, 0));
      pR.add(at(cyl(0.38, 0.42, h - 0.3, M.ruin(), 10), 0, h / 2, 0));
      const top = cyl(0.42, 0.38, 0.3, M.ruin(), 10);
      top.rotation.z = 0.15;
      pR.add(at(top, 0.05, h + 0.05, 0));
      pR.add(at(cyl(0.43, 0.43, 0.12, M.rune(), 10), 0, h * 0.55, 0));
      const moss = sphere(0.3, M.moss(), 8);
      moss.scale.set(1.4, 0.4, 1.4);
      pR.add(at(moss, 0.1, h + 0.2, 0));
      const pHD = assetSlot('gateway', 'ruin_column', pR.clone(), s, r() * Math.PI * 2);
      reg.variants(g, [[p8, E(0)], [pR, E(1, 3)], [pHD, E(4, 5)]], anchor, false);
      break;
    }
    case 'arch': {
      const a8 = new THREE.Group();
      const aR = new THREE.Group();
      for (const x of [-1.8, 1.8]) {
        a8.add(at(box(0.7, 3.4, 0.7, M.ruinDark()), x, 1.7, 0));
        aR.add(at(rbox(0.75, 3.4, 0.75, 0.08, M.ruinDark()), x, 1.7, 0));
      }
      a8.add(at(box(4.4, 0.7, 0.8, M.ruin()), 0, 3.75, 0));
      aR.add(at(rbox(4.6, 0.7, 0.85, 0.1, M.ruin()), 0, 3.75, 0));
      aR.add(at(box(1.4, 0.18, 0.1, M.rune()), 0, 3.75, 0.43));
      a8.add(at(box(1.4, 0.18, 0.1, M.rune()), 0, 3.75, 0.41));
      const aHD = assetSlot('gateway', 'shard_arch', aR.clone());
      reg.variants(g, [[a8, E(0)], [aR, E(1, 3)], [aHD, E(4, 5)]], anchor, false);
      break;
    }
    case 'rock': {
      const r8 = box(1.2 * s, 0.8 * s, 1 * s, M.stone());
      r8.position.y = 0.3 * s;
      const rR = new THREE.Mesh(new THREE.DodecahedronGeometry(0.75 * s, 0), M.stone());
      rR.scale.set(1.3, 0.75, 1);
      rR.rotation.y = r() * 3;
      rR.position.y = 0.3 * s;
      // Modern HD and Beyond swap in a baked, scanned-texture rock from the Blender pipeline.
      const rHD = assetSlot('rocks', ['rock_a', 'rock_b', 'rock_c'][Math.floor(r() * 3)], rR.clone(), s * 1.05, r() * Math.PI * 2);
      reg.variants(g, [[rR, E(1, 3)], [rHD, E(4, 5)]], anchor, false);
      break;
    }
    case 'statue': {
      // An abandoned robot from the ancient civilisation — a silent hint of Pip's origins.
      const st = new THREE.Group();
      st.add(at(rbox(0.9 * s, 0.5 * s, 0.7 * s, 0.1, M.ruinDark()), 0, 0.25 * s, 0));
      st.add(at(rbox(0.8 * s, 0.7 * s, 0.6 * s, 0.12, M.stone()), 0, 0.85 * s, 0));
      const head = new THREE.Group();
      head.position.set(0, 1.45 * s, 0.05);
      head.rotation.set(0.35, 0.3 * (r() - 0.5), 0.2 * (r() - 0.5));
      head.add(rbox(0.85 * s, 0.7 * s, 0.7 * s, 0.14, M.stone()));
      head.add(at(rbox(0.66 * s, 0.46 * s, 0.06, 0.05, M.ink()), 0, 0, 0.34 * s));
      for (const ex of [-0.14, 0.14]) head.add(at(box(0.09 * s, 0.14 * s, 0.03, M.runeDim()), ex * s, 0.02, 0.38 * s));
      const moss = sphere(0.35 * s, M.moss(), 8);
      moss.scale.set(1.2, 0.35, 1);
      head.add(at(moss, 0.1, 0.35 * s, 0));
      st.add(head);
      for (const x of [-0.5, 0.5]) {
        const arm = rbox(0.18 * s, 0.6 * s, 0.18 * s, 0.06, M.stone());
        arm.rotation.z = x * 0.4;
        st.add(at(arm, x * s, 0.6 * s, 0.1));
      }
      g.add(st);
      break;
    }
    case 'gear': {
      const gear = new THREE.Group();
      gear.add(new THREE.Mesh(new THREE.TorusGeometry(0.7 * s, 0.16 * s, 6, 20), M.metal()));
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const tooth = box(0.22 * s, 0.3 * s, 0.2 * s, M.metal());
        tooth.position.set(Math.cos(a) * 0.9 * s, Math.sin(a) * 0.9 * s, 0);
        tooth.rotation.z = a;
        gear.add(tooth);
      }
      gear.add(cyl(0.2 * s, 0.2 * s, 0.3, M.rune(), 10).rotateX(Math.PI / 2));
      g.add(gear);
      const dir = (def.seed ?? 1) % 2 ? 1 : -1;
      anim = {
        update(t, ctx) {
          gear.rotation.z += dir * 0.004 * ctx.gearSpeed * (1 / s);
          void t;
        },
      };
      break;
    }
    case 'sign': {
      const sg = new THREE.Group();
      sg.add(at(box(0.14, 1.1, 0.14, M.wood()), 0, 0.55, 0));
      const plank = rbox(1.0, 0.36, 0.1, 0.04, M.wood());
      sg.add(at(plank, 0.1, 1.0, 0));
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.25, 3), M.orange());
      arrow.rotation.z = -Math.PI / 2;
      sg.add(at(arrow, 0.38, 1.0, 0.06));
      sg.add(at(box(0.4, 0.08, 0.02, M.cream()), 0.0, 1.0, 0.06));
      // Modern HD and Beyond: a weathered Blender signpost
      const signHD = assetSlot('props', 'signpost', new THREE.Group());
      reg.variants(g, [[sg, E(0, 3)], [signHD, E(4, 5)]], anchor, false);
      break;
    }
    case 'crystal': {
      // Beyond the Frame: luminous data-crystals growing from the plateau.
      const c8 = new THREE.Group();
      c8.add(at(box(0.5 * s, 1.6 * s, 0.5 * s, M.rune()), 0, 0.8 * s, 0));
      const cR = new THREE.Group();
      const mat = sharedEraMaterial('crystal', {
        color: '#7fe9ff',
        emissive: '#38d6ff',
        emissiveIntensity: 1.6,
        roughness: 0.08,
        metalness: 0.1,
        physical: { iridescence: 1, clearcoat: 1 },
      });
      for (let i = 0; i < 5; i++) {
        const h = (0.9 + r() * 1.4) * s;
        const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.28 * s, 0), mat);
        c.scale.set(1, h / (0.28 * s) * 0.5, 1);
        c.position.set((r() - 0.5) * 0.9 * s, h * 0.45, (r() - 0.5) * 0.6 * s);
        c.rotation.set((r() - 0.5) * 0.5, r() * 3, (r() - 0.5) * 0.5);
        cR.add(c);
      }
      reg.variants(g, [[c8, E(0)], [cR, E(1, 5)]], anchor, false);
      anim = {
        update(t) {
          cR.rotation.y = Math.sin(t * 0.3 + (def.seed ?? 0)) * 0.1;
        },
      };
      break;
    }
    case 'machine': {
      // The ancient machine that sparks Pip into life.
      const mc = new THREE.Group();
      mc.add(at(rbox(1.5, 0.35, 1.0, 0.06, M.ruinDark()), 0, 0.17, 0));
      mc.add(at(rbox(1.2, 2.6, 0.8, 0.12, M.ruin()), 0, 1.6, 0));
      mc.add(at(rbox(1.35, 0.3, 0.9, 0.08, M.ruinDark()), 0, 2.95, 0));
      for (const y of [0.8, 2.3]) mc.add(at(box(1.22, 0.08, 0.82, M.runeDim()), 0, y, 0));
      const eyeRing = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.07, 8, 24), M.metal());
      mc.add(at(eyeRing, 0, 1.75, 0.42));
      const eyeMat = new THREE.MeshStandardMaterial({ color: '#0c3b38', emissive: '#2fd6c3', emissiveIntensity: 0.2 });
      const eye = new THREE.Mesh(new THREE.CircleGeometry(0.27, 24), eyeMat);
      mc.add(at(eye, 0, 1.75, 0.41));
      const cable = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 6, 16, Math.PI), M.ink());
      cable.rotation.y = Math.PI / 2;
      mc.add(at(cable, 0.62, 0.5, 0));
      g.add(mc);
      anim = {
        update(t, ctx) {
          eyeMat.emissiveIntensity = 0.15 + ctx.machineEye * (2.5 + Math.sin(t * 20) * 0.5);
        },
      };
      break;
    }
  }
  if (def.rot) g.rotation.y = def.rot;
  return { obj: g, anim };
}
