import * as THREE from 'three';
import type { Game } from '../game/sim/Game';
import { laneEdges, laneSegments, measurePip } from '../game/level/traversal';

/** Debug layers drawn into the game scene (development builds only; see DebugOverlay.tsx). */
export type DebugLayer = 'colliders' | 'pip' | 'rays' | 'route' | 'unfold' | 'occluders';

const KIND_COLOR: Record<string, string> = {
  ground: '#4cd964',
  platform: '#5ac8fa',
  wall: '#ff9500',
  bridge: '#c69c6d',
  prop: '#ffcc00',
  invisible: '#8e8e93',
  cube: '#ff2d55',
};

/** Line geometry that is rebuilt every frame (small: a few thousand segments at most). */
class Lines {
  readonly mesh: THREE.LineSegments;
  private pos: number[] = [];
  private col: number[] = [];
  private c = new THREE.Color();
  constructor() {
    const g = new THREE.BufferGeometry();
    this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 999;
  }
  seg(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, color: string) {
    this.c.set(color);
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    this.col.push(this.c.r, this.c.g, this.c.b, this.c.r, this.c.g, this.c.b);
  }
  box(min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }, color: string) {
    const p = (x: number, y: number, z: number) => ({ x, y, z });
    const [a, b] = [min, max];
    const c = [p(a.x, a.y, a.z), p(b.x, a.y, a.z), p(b.x, a.y, b.z), p(a.x, a.y, b.z), p(a.x, b.y, a.z), p(b.x, b.y, a.z), p(b.x, b.y, b.z), p(a.x, b.y, b.z)];
    for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) this.seg(c[i], c[j], color);
  }
  ring(x: number, y: number, z: number, r: number, color: string) {
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      this.seg({ x: x + Math.cos(a0) * r, y, z: z + Math.sin(a0) * r }, { x: x + Math.cos(a1) * r, y, z: z + Math.sin(a1) * r }, color);
    }
  }
  flush() {
    const g = this.mesh.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    this.pos = [];
    this.col = [];
  }
}

export class DebugDraw {
  private lines = new Lines();
  layers = new Set<DebugLayer>();
  private route: ReturnType<typeof laneSegments> | null = null;
  private routeEdges: ReturnType<typeof laneEdges> = [];

  constructor(private scene: THREE.Scene) {
    scene.add(this.lines.mesh);
  }

  update(g: Game) {
    const L = this.lines;
    const near = (x: number) => Math.abs(x - g.player.pos.x) < 40;
    if (this.layers.has('colliders')) {
      for (const c of g.world.colliders) {
        if (!near((c.min.x + c.max.x) / 2) && c.max.x - c.min.x < 60) continue;
        if (!g.world.active(c)) continue;
        L.box(c.min, c.max, KIND_COLOR[c.kind] ?? '#ffffff');
      }
    }
    if (this.layers.has('pip')) {
      const b = g.player.box();
      L.box(b.min, b.max, g.player.grounded ? '#4cd964' : '#ff3b30');
    }
    if (this.layers.has('rays')) {
      for (const r of g.camera.occlusion.rays) {
        const hit = r.hit;
        const end = hit === null ? r.to : { x: r.from.x + (r.to.x - r.from.x) * hit, y: r.from.y + (r.to.y - r.from.y) * hit, z: r.from.z + (r.to.z - r.from.z) * hit };
        L.seg(r.from, end, hit === null ? '#4cd964' : '#ff3b30');
        if (hit !== null) L.seg(end, r.to, '#5a1f1f');
      }
    }
    if (this.layers.has('route')) {
      if (!this.route) {
        const movers = g.level.movers.map((m) => ({ id: m.id, minX: m.minX, maxX: m.maxX, halfW: m.halfW, y: m.y }));
        this.route = laneSegments(g.world, movers);
        this.routeEdges = laneEdges(this.route, measurePip());
      }
      const byId = new Map(this.route.map((s) => [s.id, s]));
      for (const s of this.route) {
        if (!near((s.x0 + s.x1) / 2) && s.x1 - s.x0 < 60) continue;
        L.seg({ x: s.x0, y: s.top + 0.03, z: 0 }, { x: s.x1, y: s.top + 0.03, z: 0 }, s.mover ? '#5ac8fa' : '#ffcc00');
      }
      for (const e of this.routeEdges) {
        if (e.kind !== 'jump' || e.gap < 0.3) continue;
        const a = byId.get(e.from)!;
        const b = byId.get(e.to)!;
        if (!near(a.x1) || b.x0 < a.x1) continue;
        // a jump arc from the right edge of one surface to the left edge of the next, coloured by spare room
        const color = e.margin > 1.5 ? '#4cd964' : e.margin > 0.5 ? '#ffcc00' : '#ff3b30';
        const n = 10;
        let prev = { x: a.x1, y: a.top, z: 0 };
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const p = { x: a.x1 + (b.x0 - a.x1) * t, y: a.top + (b.top - a.top) * t + Math.sin(t * Math.PI) * 1.2, z: 0 };
          L.seg(prev, p, color);
          prev = p;
        }
      }
    }
    if (this.layers.has('unfold') && g.shift.mode === '2d') {
      const x = g.shift.nearestUnfold();
      if (x !== null) L.ring(x, g.player.pos.y + 0.03, 0, 0.45, '#6ff6ff');
    }
    if (this.layers.has('occluders')) {
      for (const c of g.world.colliders) if (!g.blocksCamera(c) && c.kind !== 'invisible' && near(c.min.x)) L.box(c.min, c.max, '#bf5af2');
    }
    L.flush();
    this.lines.mesh.visible = this.layers.size > 0;
  }

  dispose() {
    this.scene.remove(this.lines.mesh);
    this.lines.mesh.geometry.dispose();
  }
}
