import * as THREE from 'three';

interface P {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  color: THREE.Color;
  gravity: number;
  drag: number;
  spin: number;
}

export interface BurstOpts {
  count: number;
  colors: THREE.ColorRepresentation[];
  speed?: number;
  up?: number;
  spread?: number;
  gravity?: number;
  size?: number;
  life?: number;
  drag?: number;
  flat?: boolean;
  radius?: number;
}

/** Pooled cube particles. Under the pixel post-process they read as sprite pixels. */
export class Particles {
  mesh: THREE.InstancedMesh;
  private pool: P[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();

  constructor(max = 900) {
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < max; i++) {
      this.pool.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        max: 1,
        size: 0.1,
        color: new THREE.Color(),
        gravity: 0,
        drag: 0,
        spin: 0,
      });
      this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    }
    this.mesh.count = 0;
  }

  burst(at: { x: number; y: number; z: number }, o: BurstOpts) {
    let n = o.count;
    for (const p of this.pool) {
      if (n <= 0) break;
      if (p.alive) continue;
      n--;
      p.alive = true;
      const a = Math.random() * Math.PI * 2;
      const el = o.flat ? 0 : (Math.random() - 0.3) * (o.spread ?? 1.2);
      const sp = (o.speed ?? 3) * (0.4 + Math.random() * 0.8);
      const rad = o.radius ?? 0;
      p.pos.set(at.x + Math.cos(a) * rad, at.y, at.z + Math.sin(a) * rad);
      p.vel.set(Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp + (o.up ?? 2) * (0.6 + Math.random() * 0.6), Math.sin(a) * Math.cos(el) * sp);
      p.life = p.max = (o.life ?? 0.7) * (0.6 + Math.random() * 0.7);
      p.size = (o.size ?? 0.09) * (0.6 + Math.random() * 0.8);
      p.color.set(o.colors[Math.floor(Math.random() * o.colors.length)]);
      p.gravity = o.gravity ?? 9;
      p.drag = o.drag ?? 1.5;
      p.spin = (Math.random() - 0.5) * 10;
    }
  }

  /** Particles converging toward a point (assembly / absorbing energy). */
  converge(to: { x: number; y: number; z: number }, from: number, o: Omit<BurstOpts, 'speed' | 'up'>) {
    let n = o.count;
    for (const p of this.pool) {
      if (n <= 0) break;
      if (p.alive) continue;
      n--;
      p.alive = true;
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize();
      p.pos.set(to.x + dir.x * from, to.y + dir.y * from, to.z + dir.z * from);
      p.life = p.max = o.life ?? 0.6;
      p.vel.set(-dir.x * from, -dir.y * from, -dir.z * from).multiplyScalar(1 / p.max);
      p.size = (o.size ?? 0.08) * (0.6 + Math.random() * 0.8);
      p.color.set(o.colors[Math.floor(Math.random() * o.colors.length)]);
      p.gravity = 0;
      p.drag = 0;
      p.spin = (Math.random() - 0.5) * 6;
    }
  }

  update(dt: number) {
    let i = 0;
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      const k = p.life / p.max;
      const sz = p.size * Math.min(1, k * 2.5);
      this.e.set(p.spin * (1 - k), p.spin * 0.7 * (1 - k), 0);
      this.q.setFromEuler(this.e);
      this.s.set(sz, sz, sz);
      this.m.compose(p.pos, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, p.color);
      i++;
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
