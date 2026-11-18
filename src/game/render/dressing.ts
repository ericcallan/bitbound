import * as THREE from 'three';
import { beyondOnly, getAsset, loadAsset, type AssetName } from './assets';
import { eraPresent } from './eraMaterial';
import { GORGES, LANE_BACK, LANE_FRONT, PADS, valleyHeight, valleySplat, WATER_Y } from '../level/valley';
import { rng } from '../math';

interface Placement {
  x: number;
  z: number;
  scale: number;
  rot: number;
  /** Lift or sink relative to the ground (roots, rocks bedded in). */
  dy?: number;
}

/** One instanced mesh of the scatter: a node of an asset, the placements in one cell, and how it's drawn. */
interface PlanMesh {
  asset: AssetName;
  node: string;
  list: Placement[];
  /** Ground height plus dy for each placement, worked out once. */
  ys: Float32Array;
  cell: number;
  thin: boolean;
  band: 0 | 1 | 2 | 3;
  shadow: boolean;
  beyond: boolean;
  /** Drawn only in this generation (the Early 3D and Stylized trees): skipped when it's nowhere on screen. */
  onlyEra?: number;
  /** Instance matrices per mesh part, once worked out (shared by every view that builds the dressing). */
  matrices?: Float32Array[];
}
interface Plan {
  meshes: PlanMesh[];
  cells: number;
  counts: Record<string, number>;
}

/**
 * Scatters Blender vegetation and rocks across the valley from the same height field and material
 * weights the terrain uses: the forest edge behind the path, grass and flowers in the meadows, ferns in
 * the shade. Everything is instanced (one draw call per mesh part). Nothing tall is placed in front of
 * the lane, so the 2D view always stays clear.
 */
/** Spatial cell width along x: each cell is its own set of instanced meshes, so off-screen cells are culled. */
const CELL = 16;

interface AddOptions {
  /** Ground cover: fewer instances with distance (instances are in random order, so thinning is even). */
  thin?: boolean;
  /** Drawn only in this generation. */
  onlyEra?: number;
  /** A lower-detail node of the same asset, drawn instead beyond LOD_DIST. */
  lod?: string;
  /** Always the LOD (far hillsides). */
  farOnly?: boolean;
  shadow?: boolean;
  /** Exists only in Beyond. */
  beyond?: boolean;
}

interface CellMesh {
  mesh: THREE.InstancedMesh;
  full: number;
  thin: boolean;
  /** 0: always, 1: near only, 2: far only, 3: near only, shadow pass only (a cheap caster for a detailed mesh). */
  band: 0 | 1 | 2 | 3;
  shadow: boolean;
  onlyEra?: number;
}

const LOD_DIST = 34;
/** Render layer seen only by the sun's shadow camera: cheap stand-in casters for detailed trees. */
export const SHADOW_PROXY_LAYER = 1;
const SHADOW_DIST = 42;

export class ValleyDressing {
  group = new THREE.Group();
  ready = false;
  /** Instance counts by node, for the performance report. */
  counts: Record<string, number> = {};
  /** Ground-cover density multiplier (quality tiers). */
  density = 1;
  private cells: { center: THREE.Vector3; radius: number; meshes: CellMesh[] }[] = [];

  /** `active = false` (the title view, which never shows it): nothing is built. */
  constructor(active = true) {
    if (!active) return;
    void prepareScatter().then(() => this.build());
  }

  /**
   * Per frame: thin ground cover and swap tree detail by distance, and keep shadows to nearby cells.
   * Distance is scaled by the lens, so the long 2D lens (which makes far things look near) isn't thinned
   * as if it were far away.
   */
  update(camera: THREE.PerspectiveCamera) {
    if (!this.ready) return;
    const lens = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.tan(THREE.MathUtils.degToRad(26));
    const present = [0, 1, 2, 3, 4, 5].map(eraPresent);
    for (const c of this.cells) {
      const d = Math.max(0, camera.position.distanceTo(c.center) - c.radius) * lens;
      const thin = (d < 25 ? 1 : d < 45 ? 0.5 : d < 70 ? 0.25 : 0) * this.density;
      const near = d < LOD_DIST;
      for (const m of c.meshes) {
        m.mesh.count = m.thin ? Math.floor(m.full * thin) : m.full;
        m.mesh.visible = m.mesh.count > 0 && (m.band === 0 || (m.band === 1 || m.band === 3) === near) && (m.onlyEra === undefined || present[m.onlyEra]);
        m.mesh.castShadow = m.shadow && d < SHADOW_DIST;
      }
    }
  }

  /** Instanced meshes from the shared plan: only copying, all the arithmetic was done once. */
  private build() {
    if (this.ready || !plan) return;
    this.cells = Array.from({ length: plan.cells }, () => ({ center: new THREE.Vector3(), radius: 0, meshes: [] as CellMesh[] }));
    for (const pm of plan.meshes) {
      const parts = meshParts(pm);
      const mats = matricesFor(pm);
      parts.forEach((part, k) => {
        const inst = new THREE.InstancedMesh(part.geometry, pm.beyond ? beyondOnly(part.material as THREE.Material) : part.material, pm.list.length);
        inst.instanceMatrix.array.set(mats[k]);
        inst.instanceMatrix.needsUpdate = true;
        inst.castShadow = pm.shadow;
        inst.receiveShadow = true;
        if (pm.band === 3) inst.layers.set(SHADOW_PROXY_LAYER);
        inst.computeBoundingSphere();
        this.group.add(inst);
        this.cells[pm.cell].meshes.push({ mesh: inst, full: pm.list.length, thin: pm.thin, band: pm.band, shadow: pm.shadow, onlyEra: pm.onlyEra });
      });
    }
    this.counts = plan.counts;
    this.finishCells();
    this.ready = true;
  }

  /** Each cell's bounds from its meshes' instance bounds. */
  private finishCells() {
    for (const c of this.cells) {
      const box = new THREE.Box3();
      for (const m of c.meshes) if (m.mesh.boundingSphere) box.union(new THREE.Box3().setFromCenterAndSize(m.mesh.boundingSphere.center, new THREE.Vector3().setScalar(m.mesh.boundingSphere.radius * 2)));
      if (box.isEmpty()) continue;
      box.getCenter(c.center);
      c.radius = Math.min(CELL, box.getSize(new THREE.Vector3()).length() / 2);
    }
  }
}

// ------------------------------------------------------------------ the plan, worked out once per page

function slope(x: number, z: number) {
  const e = 0.5;
  return Math.hypot((valleyHeight(x + e, z) - valleyHeight(x - e, z)) / (2 * e), (valleyHeight(x, z + e) - valleyHeight(x, z - e)) / (2 * e));
}
const inGorge = (x: number) => GORGES.some(([a, b]) => x > a - 2.5 && x < b + 2.5);
/** Interiors (the hidden chamber) stay clear of plants and trees. */
const indoors = (x: number, z: number, margin = 0.6) => PADS.some(([x0, x1, z0, z1]) => x > x0 - margin && x < x1 + margin && z > z0 - margin && z < z1 + margin);

/** Smooth value noise in [0, 1] (for drifts of grass and groups of flowers). */
function drift(x: number, z: number) {
  const h = (i: number, j: number) => {
    const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const i = Math.floor(x);
  const j = Math.floor(z);
  const fx = x - i;
  const fz = z - j;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  return h(i, j) * (1 - sx) * (1 - sz) + h(i + 1, j) * sx * (1 - sz) + h(i, j + 1) * (1 - sx) * sz + h(i + 1, j + 1) * sx * sz;
}
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Placements for the whole valley. A generator: it yields every few hundred samples so the work can be sliced. */
function* scatterPlan(): Generator<void, Plan> {
  const meshes: PlanMesh[] = [];
  const cellIndex = new Map<string, number>();
  const counts: Record<string, number> = {};
  const cellFor = (p: Placement, far: boolean) => {
    const key = `${Math.floor(p.x / CELL)}:${far ? 1 : 0}`;
    let i = cellIndex.get(key);
    if (i === undefined) cellIndex.set(key, (i = cellIndex.size));
    return i;
  };
  const mesh = (asset: AssetName, node: string, list: Placement[], cell: number, thin: boolean, band: 0 | 1 | 2 | 3, shadow: boolean, beyond = false, onlyEra?: number) => {
    const ys = new Float32Array(list.length);
    list.forEach((p, i) => (ys[i] = valleyHeight(p.x, p.z) + (p.dy ?? 0)));
    meshes.push({ asset, node, list, ys, cell, thin, band, shadow, beyond, onlyEra });
  };
  const add = (asset: AssetName, node: string, list: Placement[], o: AddOptions = {}) => {
    if (list.length === 0) return;
    const byCell = new Map<number, Placement[]>();
    for (const p of list) {
      const i = cellFor(p, !!o.farOnly);
      if (!byCell.has(i)) byCell.set(i, []);
      byCell.get(i)!.push(p);
    }
    const shadow = o.shadow ?? asset !== 'vegetation';
    for (const [i, ps] of byCell) {
      if (o.farOnly) mesh(asset, o.lod ?? node, ps, i, false, 0, shadow, false, o.onlyEra);
      else if (o.lod) {
        // Near: the detailed tree is drawn, but its shadow comes from the LOD (a fraction of the triangles).
        mesh(asset, node, ps, i, false, 1, false);
        if (shadow) mesh(asset, o.lod, ps, i, false, 3, true);
        mesh(asset, o.lod, ps, i, false, 2, shadow);
      } else mesh(asset, node, ps, i, !!o.thin, 0, shadow, !!o.beyond, o.onlyEra);
    }
    counts[node] = (counts[node] ?? 0) + list.length;
  };

  const r = rng(2026);
  const x0 = -26;
  const x1 = 262;
  // --- forest edge: behind the path, on the rising meadow below the cliffs
  const trees: Placement[] = [];
  const greats: Placement[] = [];
  const hillTrees: Placement[] = [];
  for (let x = x0; x < x1; x += 3.2) {
    for (let row = 0; row < 3; row++) {
      const tx = x + (r() - 0.5) * 2.6;
      const tz = LANE_BACK - 6.5 - row * 3.4 - r() * 2.2;
      if (inGorge(tx) || indoors(tx, tz, 2.5) || slope(tx, tz) > 0.7 || r() < 0.25) continue;
      if (row === 1 && r() < 0.12) greats.push({ x: tx, z: tz - 1.5, scale: 0.75 + r() * 0.2, rot: r() * 6.28, dy: -0.05 });
      else trees.push({ x: tx, z: tz, scale: 0.7 + r() * 0.5, rot: r() * 6.28, dy: -0.05 });
    }
    yield;
  }
  // a scattering on the hillsides beyond the cliffs, for depth
  for (let i = 0; i < Math.round((x1 - x0) * 0.9); i++) {
    const tx = x0 - 20 + r() * (x1 - x0 + 40);
    const tz = LANE_BACK - 26 - r() * 40;
    if (slope(tx, tz) < 0.6) hillTrees.push({ x: tx, z: tz, scale: 0.8 + r() * 0.7, rot: r() * 6.28, dy: -0.05 });
  }
  add('tree', 'meadow_tree', trees, { lod: 'meadow_tree_lod1' });
  add('tree', 'meadow_tree', hillTrees, { lod: 'meadow_tree_lod1', farOnly: true, shadow: false });
  add('tree', 'great_tree', greats);
  // the same forest, as Early 3D and Stylized draw it (the bible's one tree in every generation)
  for (const [kind, era] of [['low', 2], ['shell', 3]] as const) {
    add('tree', `meadow_tree_${kind}`, trees, { onlyEra: era });
    add('tree', `meadow_tree_${kind}`, hillTrees, { onlyEra: era, farOnly: true, shadow: false });
    add('tree', `great_tree_${kind}`, greats, { onlyEra: era });
  }
  yield;

  // --- ground cover
  const grass: Placement[] = [];
  const tall: Placement[] = [];
  const flowers: [Placement[], Placement[]] = [[], []];
  const ferns: Placement[] = [];
  const rocks: [Placement[], Placement[], Placement[]] = [[], [], []];
  for (let i = 0, n = Math.round((x1 - x0) * 340); i < n; i++) {
    if (i % 256 === 0) yield;
    const x = x0 + r() * (x1 - x0);
    const z = LANE_BACK - 22 + r() * (LANE_FRONT + 16 - (LANE_BACK - 22));
    const h = valleyHeight(x, z);
    if (h < WATER_Y + 0.15 || inGorge(x) || indoors(x, z)) continue;
    const s = slope(x, z);
    if (s > 0.9) continue;
    const [rock, path, forest] = valleySplat(x, z, s);
    const grassW = 1 - rock - path - forest;
    const onLane = z > LANE_BACK + 0.4 && z < LANE_FRONT - 0.4;
    // Between the path and the 2D camera nothing may grow tall enough to hide Pip or an enemy.
    const foreground = z > LANE_FRONT - 0.4 && z < LANE_FRONT + 5;
    const k = r();
    if (onLane && k < 0.85) continue; // keep the walkway readable
    if (forest > 0.5) {
      if (k < 0.08) ferns.push({ x, z, scale: 0.8 + r() * 0.7, rot: r() * 6.28 });
      else if (k < 0.2) grass.push({ x, z, scale: 0.7 + r() * 0.4, rot: r() * 6.28 });
    } else if (grassW > 0.45) {
      // Drifts, not an even carpet (docs/ART_BIBLE.md §7): grass gathers in patches with gaps between, thins
      // along both edges of the path and in front of it, and flowers grow in groups of one colour.
      const edge = (z > LANE_FRONT - 0.4 && z < LANE_FRONT + 1.4) || (z < LANE_BACK + 0.4 && z > LANE_BACK - 1.4);
      const dens = (0.1 + 0.9 * smooth(0.38, 0.72, drift(x * 0.11, z * 0.17))) * (z > LANE_FRONT - 0.4 ? 0.55 : 1) * (foreground ? 0.7 : 1) * (edge ? 0.55 : 1);
      const bloom = drift(x * 0.08 + 31, z * 0.1 - 17);
      if (k < 0.55 * dens) grass.push({ x, z, scale: foreground ? 0.6 + r() * 0.3 : 0.75 + r() * 0.6, rot: r() * 6.28 });
      else if (k < 0.55 * dens + 0.07 && z < LANE_BACK) tall.push({ x, z, scale: 0.8 + r() * 0.5, rot: r() * 6.28 });
      else if (bloom > 0.66 && k > 0.94 - (bloom - 0.66) * 0.5) flowers[drift(x * 0.05, z * 0.05 + 9) < 0.5 ? 0 : 1].push({ x, z, scale: 0.45 + r() * 0.25, rot: r() * 6.28 });
    }
    if (k > 0.9985 && !onLane && !foreground) rocks[Math.floor(r() * 3)].push({ x, z, scale: 0.5 + r() * 0.9, rot: r() * 6.28, dy: -0.12 });
  }
  add('vegetation', 'grass_clump', grass, { thin: true });
  add('vegetation', 'tall_grass', tall, { thin: true });
  add('vegetation', 'flower_white', flowers[0], { thin: true });
  add('vegetation', 'flower_violet', flowers[1], { thin: true });
  add('vegetation', 'fern', ferns, { thin: true });
  yield;

  // --- Beyond's ground detail near the path: pebbles and leaf litter on and beside it, twigs under the trees,
  // clover in the grass, and thistles behind the path only (nothing tall in front of it).
  const d = rng(77);
  const lists: Record<string, Placement[]> = { pebbles: [], twigs: [], leaf_litter: [], clover: [], thistle: [] };
  for (let i = 0, n = Math.round((x1 - x0) * 210); i < n; i++) {
    if (i % 256 === 0) yield;
    const x = x0 + d() * (x1 - x0);
    const z = LANE_BACK - 10 + d() * (LANE_FRONT + 6 - (LANE_BACK - 10));
    if (valleyHeight(x, z) < WATER_Y + 0.1 || inGorge(x) || indoors(x, z)) continue;
    const s = slope(x, z);
    if (s > 0.8) continue;
    const [rock, path, forest] = valleySplat(x, z, s);
    const k = d();
    const rot = d() * 6.28;
    if (path > 0.3 && k < 0.07) lists.pebbles.push({ x, z, scale: 0.6 + d() * 0.6, rot, dy: -0.01 });
    else if (path > 0.3 && k < 0.15) lists.leaf_litter.push({ x, z, scale: 0.8 + d() * 0.6, rot });
    else if (forest > 0.4 && k < 0.2) lists.leaf_litter.push({ x, z, scale: 1 + d() * 0.8, rot });
    else if (forest > 0.4 && k < 0.3) lists.twigs.push({ x, z, scale: 0.8 + d() * 0.6, rot });
    else if (rock < 0.2 && path < 0.3 && forest < 0.4 && k < 0.16) lists.clover.push({ x, z, scale: 0.8 + d() * 0.8, rot });
    else if (z < LANE_BACK - 0.5 && forest < 0.4 && k > 0.985) lists.thistle.push({ x, z, scale: 0.8 + d() * 0.5, rot });
  }
  for (const [node, list] of Object.entries(lists)) add('vegetation', node, list, { thin: true, beyond: true, shadow: false });
  add('rocks', 'rock_a', rocks[0]);
  add('rocks', 'rock_b', rocks[1]);
  add('rocks', 'rock_c', rocks[2]);
  return { meshes, cells: cellIndex.size, counts };
}

let plan: Plan | null = null;
let preparing: Promise<void> | null = null;

/** Run a generator in slices of a few milliseconds, yielding to the browser between them. */
function sliced<T>(gen: Generator<void, T>, budgetMs = 5): Promise<T> {
  return new Promise((resolve) => {
    const step = () => {
      const end = performance.now() + budgetMs;
      for (;;) {
        const r = gen.next();
        if (r.done) return resolve(r.value);
        if (performance.now() > end) return void setTimeout(step, 0);
      }
    };
    step();
  });
}

/**
 * The scatter, worked out once per page in small slices (never a long frame): placements, ground heights and,
 * once the assets are in, every instance matrix. Views then only copy. The loader waits for it.
 */
export function prepareScatter(): Promise<void> {
  preparing ??= (async () => {
    plan = await sliced(scatterPlan());
    await Promise.all((['tree', 'vegetation', 'rocks'] as AssetName[]).map(loadAsset));
    const p = plan;
    await sliced(
      (function* () {
        for (const pm of p.meshes) {
          matricesFor(pm);
          yield;
        }
      })(),
    );
  })();
  return preparing;
}

function meshParts(pm: PlanMesh) {
  const src = getAsset(pm.asset)?.scene.getObjectByName(pm.node);
  const parts: THREE.Mesh[] = [];
  src?.traverse((o) => (o as THREE.Mesh).isMesh && parts.push(o as THREE.Mesh));
  return parts;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
function matricesFor(pm: PlanMesh) {
  if (pm.matrices) return pm.matrices;
  getAsset(pm.asset)!.scene.updateMatrixWorld(true);
  pm.matrices = meshParts(pm).map((part) => {
    // The part's full transform in the asset (nodes sit at the origin; quantization keeps the real
    // scale and offset on the node, so it must be kept, not cancelled).
    const local = part.matrixWorld;
    const out = new Float32Array(pm.list.length * 16);
    pm.list.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rot);
      m4.compose(pos.set(p.x, pm.ys[i], p.z), q, scl.set(p.scale, p.scale, p.scale));
      m4.multiply(local);
      m4.toArray(out, i * 16);
    });
    return out;
  });
  return pm.matrices;
}
