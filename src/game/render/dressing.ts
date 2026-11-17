import * as THREE from 'three';
import { beyondOnly, getAsset, loadAsset, type AssetName } from './assets';
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
  private cellIndex = new Map<string, number>();

  constructor() {
    const need: AssetName[] = ['tree', 'vegetation', 'rocks'];
    Promise.all(need.map(loadAsset)).then(() => this.build());
  }

  /**
   * Per frame: thin ground cover and swap tree detail by distance, and keep shadows to nearby cells.
   * Distance is scaled by the lens, so the long 2D lens (which makes far things look near) isn't thinned
   * as if it were far away.
   */
  update(camera: THREE.PerspectiveCamera) {
    if (!this.ready) return;
    const lens = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.tan(THREE.MathUtils.degToRad(26));
    for (const c of this.cells) {
      const d = Math.max(0, camera.position.distanceTo(c.center) - c.radius) * lens;
      const thin = (d < 25 ? 1 : d < 45 ? 0.5 : d < 70 ? 0.25 : 0) * this.density;
      const near = d < LOD_DIST;
      for (const m of c.meshes) {
        m.mesh.count = m.thin ? Math.floor(m.full * thin) : m.full;
        m.mesh.visible = m.mesh.count > 0 && (m.band === 0 || (m.band === 1 || m.band === 3) === near);
        m.mesh.castShadow = m.shadow && d < SHADOW_DIST;
      }
    }
  }

  private slope(x: number, z: number) {
    const e = 0.5;
    return Math.hypot((valleyHeight(x + e, z) - valleyHeight(x - e, z)) / (2 * e), (valleyHeight(x, z + e) - valleyHeight(x, z - e)) / (2 * e));
  }

  private inGorge(x: number) {
    return GORGES.some(([a, b]) => x > a - 2.5 && x < b + 2.5);
  }

  /** Interiors (the hidden chamber) stay clear of plants and trees. */
  private indoors(x: number, z: number, margin = 0.6) {
    return PADS.some(([x0, x1, z0, z1]) => x > x0 - margin && x < x1 + margin && z > z0 - margin && z < z1 + margin);
  }

  private cellFor(p: Placement, far: boolean) {
    const key = `${Math.floor(p.x / CELL)}:${far ? 1 : 0}`;
    let i = this.cellIndex.get(key);
    if (i === undefined) {
      i = this.cells.length;
      this.cells.push({ center: new THREE.Vector3(), radius: 0, meshes: [] });
      this.cellIndex.set(key, i);
    }
    return { key, i };
  }

  private instance(asset: AssetName, node: string, list: Placement[], cell: number, thin: boolean, band: 0 | 1 | 2 | 3, shadow: boolean, beyond = false) {
    const src = getAsset(asset)?.scene.getObjectByName(node);
    if (!src || list.length === 0) return;
    getAsset(asset)!.scene.updateMatrixWorld(true);
    const parts: THREE.Mesh[] = [];
    src.traverse((o) => (o as THREE.Mesh).isMesh && parts.push(o as THREE.Mesh));
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const part of parts) {
      // The part's full transform in the asset (nodes sit at the origin; quantization keeps the real
      // scale and offset on the node, so it must be kept, not cancelled).
      const local = part.matrixWorld.clone();
      const inst = new THREE.InstancedMesh(part.geometry, beyond ? beyondOnly(part.material as THREE.Material) : part.material, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        m4.compose(new THREE.Vector3(p.x, valleyHeight(p.x, p.z) + (p.dy ?? 0), p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale));
        m4.multiply(local);
        inst.setMatrixAt(i, m4);
      });
      inst.castShadow = shadow;
      inst.receiveShadow = true;
      if (band === 3) inst.layers.set(SHADOW_PROXY_LAYER);
      inst.computeBoundingSphere();
      this.group.add(inst);
      this.cells[cell].meshes.push({ mesh: inst, full: list.length, thin, band, shadow });
    }
  }

  private add(asset: AssetName, node: string, list: Placement[], o: AddOptions = {}) {
    if (list.length === 0) return;
    const byCell = new Map<number, Placement[]>();
    for (const p of list) {
      const { i } = this.cellFor(p, !!o.farOnly);
      if (!byCell.has(i)) byCell.set(i, []);
      byCell.get(i)!.push(p);
    }
    const shadow = o.shadow ?? asset !== 'vegetation';
    for (const [i, ps] of byCell) {
      if (o.farOnly) this.instance(asset, o.lod ?? node, ps, i, false, 0, shadow);
      else if (o.lod) {
        // Near: the detailed tree is drawn, but its shadow comes from the LOD (a fraction of the triangles).
        this.instance(asset, node, ps, i, false, 1, false);
        if (shadow) this.instance(asset, o.lod, ps, i, false, 3, true);
        this.instance(asset, o.lod, ps, i, false, 2, shadow);
      } else this.instance(asset, node, ps, i, !!o.thin, 0, shadow, !!o.beyond);
    }
    this.counts[node] = (this.counts[node] ?? 0) + list.length;
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

  /**
   * Beyond's ground detail near the path: pebbles and leaf litter on and beside it, twigs under the trees,
   * clover in the grass, and thistles behind the path only (nothing tall in front of it).
   */
  private scatterBeyondDetail(x0: number, x1: number) {
    const r = rng(77);
    const lists: Record<string, Placement[]> = { pebbles: [], twigs: [], leaf_litter: [], clover: [], thistle: [] };
    for (let i = 0, n = Math.round((x1 - x0) * 210); i < n; i++) {
      const x = x0 + r() * (x1 - x0);
      const z = LANE_BACK - 10 + r() * (LANE_FRONT + 6 - (LANE_BACK - 10));
      if (valleyHeight(x, z) < WATER_Y + 0.1 || this.inGorge(x) || this.indoors(x, z)) continue;
      const s = this.slope(x, z);
      if (s > 0.8) continue;
      const [rock, path, forest] = valleySplat(x, z, s);
      const k = r();
      const rot = r() * 6.28;
      if (path > 0.3 && k < 0.07) lists.pebbles.push({ x, z, scale: 0.6 + r() * 0.6, rot, dy: -0.01 });
      else if (path > 0.3 && k < 0.15) lists.leaf_litter.push({ x, z, scale: 0.8 + r() * 0.6, rot });
      else if (forest > 0.4 && k < 0.2) lists.leaf_litter.push({ x, z, scale: 1 + r() * 0.8, rot });
      else if (forest > 0.4 && k < 0.3) lists.twigs.push({ x, z, scale: 0.8 + r() * 0.6, rot });
      else if (rock < 0.2 && path < 0.3 && forest < 0.4 && k < 0.16) lists.clover.push({ x, z, scale: 0.8 + r() * 0.8, rot });
      else if (z < LANE_BACK - 0.5 && forest < 0.4 && k > 0.985) lists.thistle.push({ x, z, scale: 0.8 + r() * 0.5, rot });
    }
    for (const [node, list] of Object.entries(lists)) this.add('vegetation', node, list, { thin: true, beyond: true, shadow: false });
  }

  private build() {
    if (this.ready) return;
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
        if (this.inGorge(tx) || this.indoors(tx, tz, 2.5) || this.slope(tx, tz) > 0.7 || r() < 0.25) continue;
        if (row === 1 && r() < 0.12) greats.push({ x: tx, z: tz - 1.5, scale: 0.75 + r() * 0.2, rot: r() * 6.28, dy: -0.05 });
        else trees.push({ x: tx, z: tz, scale: 0.7 + r() * 0.5, rot: r() * 6.28, dy: -0.05 });
      }
    }
    // a scattering on the hillsides beyond the cliffs, for depth
    for (let i = 0; i < Math.round((x1 - x0) * 0.9); i++) {
      const tx = x0 - 20 + r() * (x1 - x0 + 40);
      const tz = LANE_BACK - 26 - r() * 40;
      if (this.slope(tx, tz) < 0.6) hillTrees.push({ x: tx, z: tz, scale: 0.8 + r() * 0.7, rot: r() * 6.28, dy: -0.05 });
    }
    this.add('tree', 'meadow_tree', trees, { lod: 'meadow_tree_lod1' });
    this.add('tree', 'meadow_tree', hillTrees, { lod: 'meadow_tree_lod1', farOnly: true, shadow: false });
    this.add('tree', 'great_tree', greats);

    // --- ground cover
    const grass: Placement[] = [];
    const tall: Placement[] = [];
    const flowers: [Placement[], Placement[]] = [[], []];
    const ferns: Placement[] = [];
    const rocks: [Placement[], Placement[], Placement[]] = [[], [], []];
    for (let i = 0, n = Math.round((x1 - x0) * 340); i < n; i++) {
      const x = x0 + r() * (x1 - x0);
      const z = LANE_BACK - 22 + r() * (LANE_FRONT + 16 - (LANE_BACK - 22));
      const h = valleyHeight(x, z);
      if (h < WATER_Y + 0.15 || this.inGorge(x) || this.indoors(x, z)) continue;
      const s = this.slope(x, z);
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
        if (k < 0.55) grass.push({ x, z, scale: foreground ? 0.6 + r() * 0.3 : 0.75 + r() * 0.6, rot: r() * 6.28 });
        else if (k < 0.62 && z < LANE_BACK) tall.push({ x, z, scale: 0.8 + r() * 0.5, rot: r() * 6.28 });
        else if (k < 0.64) flowers[r() < 0.6 ? 0 : 1].push({ x, z, scale: 0.45 + r() * 0.25, rot: r() * 6.28 });
      }
      if (k > 0.9985 && !onLane && !foreground) rocks[Math.floor(r() * 3)].push({ x, z, scale: 0.5 + r() * 0.9, rot: r() * 6.28, dy: -0.12 });
    }
    this.add('vegetation', 'grass_clump', grass, { thin: true });
    this.add('vegetation', 'tall_grass', tall, { thin: true });
    this.add('vegetation', 'flower_white', flowers[0], { thin: true });
    this.add('vegetation', 'flower_violet', flowers[1], { thin: true });
    this.add('vegetation', 'fern', ferns, { thin: true });
    this.scatterBeyondDetail(x0, x1);
    this.add('rocks', 'rock_a', rocks[0]);
    this.add('rocks', 'rock_b', rocks[1]);
    this.add('rocks', 'rock_c', rocks[2]);
    this.finishCells();
    this.ready = true;
  }
}
