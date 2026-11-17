import * as THREE from 'three';
import { getAsset, loadAsset, type AssetName } from './assets';
import { GORGES, LANE_BACK, LANE_FRONT, VALLEY_COLLIDE, valleyHeight, valleySplat, WATER_Y } from '../level/valley';
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
export class ValleyDressing {
  group = new THREE.Group();
  ready = false;
  /** Instance counts by node, for the performance report. */
  counts: Record<string, number> = {};

  constructor() {
    const need: AssetName[] = ['tree', 'vegetation', 'rocks'];
    Promise.all(need.map(loadAsset)).then(() => this.build());
  }

  private slope(x: number, z: number) {
    const e = 0.5;
    return Math.hypot((valleyHeight(x + e, z) - valleyHeight(x - e, z)) / (2 * e), (valleyHeight(x, z + e) - valleyHeight(x, z - e)) / (2 * e));
  }

  private inGorge(x: number) {
    return GORGES.some(([a, b]) => x > a - 2.5 && x < b + 2.5);
  }

  private add(asset: AssetName, node: string, list: Placement[]) {
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
      const inst = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        m4.compose(new THREE.Vector3(p.x, valleyHeight(p.x, p.z) + (p.dy ?? 0), p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale));
        m4.multiply(local);
        inst.setMatrixAt(i, m4);
      });
      inst.castShadow = asset !== 'vegetation';
      inst.receiveShadow = true;
      inst.computeBoundingSphere();
      this.group.add(inst);
    }
    this.counts[node] = list.length;
  }

  private build() {
    if (this.ready) return;
    const r = rng(2026);
    const x0 = -26;
    const x1 = VALLEY_COLLIDE.x1 - 1;
    // --- forest edge: behind the path, on the rising meadow below the cliffs
    const trees: Placement[] = [];
    const greats: Placement[] = [];
    for (let x = x0; x < x1; x += 3.2) {
      for (let row = 0; row < 3; row++) {
        const tx = x + (r() - 0.5) * 2.6;
        const tz = LANE_BACK - 6.5 - row * 3.4 - r() * 2.2;
        if (this.inGorge(tx) || this.slope(tx, tz) > 0.7 || r() < 0.25) continue;
        if (row === 1 && r() < 0.12) greats.push({ x: tx, z: tz - 1.5, scale: 0.75 + r() * 0.2, rot: r() * 6.28, dy: -0.05 });
        else trees.push({ x: tx, z: tz, scale: 0.7 + r() * 0.5, rot: r() * 6.28, dy: -0.05 });
      }
    }
    // a scattering on the hillsides beyond the cliffs, for depth
    for (let i = 0; i < 70; i++) {
      const tx = x0 - 20 + r() * (x1 - x0 + 40);
      const tz = LANE_BACK - 26 - r() * 40;
      if (this.slope(tx, tz) < 0.6) trees.push({ x: tx, z: tz, scale: 0.8 + r() * 0.7, rot: r() * 6.28, dy: -0.05 });
    }
    this.add('tree', 'meadow_tree', trees);
    this.add('tree', 'great_tree', greats);

    // --- ground cover
    const grass: Placement[] = [];
    const tall: Placement[] = [];
    const flowers: [Placement[], Placement[]] = [[], []];
    const ferns: Placement[] = [];
    const rocks: [Placement[], Placement[], Placement[]] = [[], [], []];
    for (let i = 0; i < 26000; i++) {
      const x = x0 + r() * (x1 - x0);
      const z = LANE_BACK - 22 + r() * (LANE_FRONT + 16 - (LANE_BACK - 22));
      const h = valleyHeight(x, z);
      if (h < WATER_Y + 0.15 || this.inGorge(x)) continue;
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
    this.add('vegetation', 'grass_clump', grass);
    this.add('vegetation', 'tall_grass', tall);
    this.add('vegetation', 'flower_white', flowers[0]);
    this.add('vegetation', 'flower_violet', flowers[1]);
    this.add('vegetation', 'fern', ferns);
    this.add('rocks', 'rock_a', rocks[0]);
    this.add('rocks', 'rock_b', rocks[1]);
    this.add('rocks', 'rock_c', rocks[2]);
    this.ready = true;
  }
}
