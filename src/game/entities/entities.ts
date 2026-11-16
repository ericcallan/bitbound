import { v3, type V3 } from '../math';
import type { AABB, Collider } from '../collision/World';
import type { EnemyDef } from '../level/meadows';

/** A small glitchy patrol creature. Stomp it from above; touching its side hurts. */
export class Glitchling {
  pos: V3;
  prevPos: V3;
  dir = -1;
  alive = true;
  squash = 0;
  readonly hw = 0.38;
  readonly h = 0.62;
  speed = 1.5;
  constructor(public def: EnemyDef) {
    this.pos = v3(def.x, def.y, 0);
    this.prevPos = { ...this.pos };
  }
  box(): AABB {
    return {
      min: v3(this.pos.x - this.hw, this.pos.y, this.pos.z - this.hw),
      max: v3(this.pos.x + this.hw, this.pos.y + this.h, this.pos.z + this.hw),
    };
  }
  step(dt: number, paused: boolean) {
    this.prevPos = { ...this.pos };
    if (!this.alive) {
      this.squash = Math.min(1, this.squash + dt * 3);
      return;
    }
    if (paused) return;
    this.pos.x += this.dir * this.speed * dt;
    if (this.pos.x < this.def.minX) {
      this.pos.x = this.def.minX;
      this.dir = 1;
    } else if (this.pos.x > this.def.maxX) {
      this.pos.x = this.def.maxX;
      this.dir = -1;
    }
  }
}

export interface Bit {
  id: string;
  pos: V3;
  collected: boolean;
}

/** Horizontal oscillating platform with a sine profile (eases at the ends). */
export class Mover {
  t = 0;
  prevX: number;
  constructor(
    public collider: Collider,
    public readonly minX: number,
    public readonly maxX: number,
    private period: number,
  ) {
    this.prevX = this.centerX;
  }
  get centerX() {
    return (this.collider.min.x + this.collider.max.x) / 2;
  }
  step(dt: number) {
    this.prevX = this.centerX;
    this.t += dt;
    const mid = (this.minX + this.maxX) / 2;
    const amp = (this.maxX - this.minX) / 2;
    const x = mid - Math.cos((this.t / this.period) * Math.PI * 2) * amp;
    const dx = x - this.centerX;
    this.collider.min.x += dx;
    this.collider.max.x += dx;
    this.collider.delta.x = dx;
  }
}
