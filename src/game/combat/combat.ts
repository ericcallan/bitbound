import { overlaps, type AABB, type World } from '../collision/World';
import type { EraSystem, Era } from '../era/EraSystem';
import { clamp, v3, type V3 } from '../math';

export type HostileKind = 'censor' | 'enforcer' | 'turret' | 'sniper' | 'warden';

export interface HostileDef {
  id: string;
  kind: HostileKind;
  pos: V3;
  /** Which encounter wakes this hostile (it stays dormant until then). */
  group: string;
}

/** Generations in which each kind exists. Turrets, snipers and drones "were never invented" in 8-bit. */
export const HOSTILE_GEN: Record<HostileKind, number> = {
  censor: 0b111110,
  enforcer: 0b111111,
  turret: 0b111110,
  sniper: 0b111110,
  warden: 0b111111,
};

const SIZE: Record<HostileKind, { hw: number; h: number; hp: number }> = {
  censor: { hw: 0.45, h: 0.7, hp: 3 },
  enforcer: { hw: 0.42, h: 1.95, hp: 6 },
  turret: { hw: 0.55, h: 1.1, hp: 4 },
  sniper: { hw: 0.5, h: 1.3, hp: 5 },
  warden: { hw: 1.0, h: 3.1, hp: 60 },
};

/** Warden: shield only exists in modern generations; below this HP it armours up. */
export const WARDEN_ARMOR_HP = 15;
export const WARDEN_STOMP_DAMAGE = 5;
export const WEAPON = { fireInterval: 0.13, heatPerShot: 0.1, chargeHeat: 0.45, cool: 0.55, ventTime: 1.6, speed: 75, chargeTime: 0.6 };

export class Hostile {
  kind: HostileKind;
  pos: V3;
  prevPos: V3;
  home: V3;
  hp: number;
  maxHp: number;
  alive = true;
  awake = false;
  dying = 0;
  t = 0;
  cooldown = 1;
  burst = 0;
  burstT = 0;
  /** Sniper telegraph 0..1 / Warden slam wind-up. */
  telegraph = 0;
  aimYaw = 0;
  aimPitch = 0;
  phase: number;
  hitFlash = 0;
  /** Current generation at this hostile (set each step). */
  era: Era = 5;
  slamT = -1;
  pulseCd = 10;
  constructor(public def: HostileDef) {
    this.kind = def.kind;
    this.pos = { ...def.pos };
    this.prevPos = { ...def.pos };
    this.home = { ...def.pos };
    this.hp = this.maxHp = SIZE[def.kind].hp;
    this.phase = (def.id.charCodeAt(def.id.length - 1) % 7) * 0.9;
  }
  get hw() {
    return SIZE[this.kind].hw;
  }
  get h() {
    return SIZE[this.kind].h;
  }
  box(at: V3 = this.pos): AABB {
    return { min: v3(at.x - this.hw, at.y, at.z - this.hw), max: v3(at.x + this.hw, at.y + this.h, at.z + this.hw) };
  }
  center(): V3 {
    return v3(this.pos.x, this.pos.y + this.h * 0.55, this.pos.z);
  }
  /** Does it exist in its current generation? */
  get exists() {
    return (HOSTILE_GEN[this.kind] & (1 << this.era)) !== 0;
  }
  get shielded() {
    return this.kind === 'warden' && this.era >= 4 && this.hp > WARDEN_ARMOR_HP;
  }
  get armored() {
    return this.kind === 'warden' && this.hp <= WARDEN_ARMOR_HP;
  }
  /** In 8-bit, ground hostiles are simple sprites: no guns, hurt on touch, stompable. */
  get sprite() {
    return this.era === 0 && (this.kind === 'enforcer' || this.kind === 'warden');
  }
}

export interface Projectile {
  pos: V3;
  prev: V3;
  vel: V3;
  owner: 'pip' | 'enemy';
  dmg: number;
  ttl: number;
  charged: boolean;
  alive: boolean;
}

export interface CombatEvent {
  type: 'shot' | 'charged' | 'enemyShot' | 'hit' | 'shieldHit' | 'armorHit' | 'enemyDown' | 'playerHit' | 'overheat' | 'vented' | 'boltFizzle' | 'impact' | 'slam' | 'pulse' | 'telegraph';
  pos?: V3;
  value?: number;
  text?: string;
}

export interface CombatCtx {
  world: World;
  era: EraSystem;
  /** Pip's chest point and AABB. */
  pip: () => V3;
  pipBox: () => AABB;
  pipEra: () => Era;
  pipInvulnerable: () => boolean;
  hurtPip: (dmg: number, from: V3) => void;
  popBubble: () => void;
  emit: (e: CombatEvent) => void;
}

/** Segment (a→b) vs AABB: entry fraction or null. */
export function segmentBox(a: V3, b: V3, box: AABB, pad = 0): number | null {
  let tmin = 0;
  let tmax = 1;
  for (const ax of ['x', 'y', 'z'] as const) {
    const d = b[ax] - a[ax];
    const lo = box.min[ax] - pad;
    const hi = box.max[ax] + pad;
    if (Math.abs(d) < 1e-9) {
      if (a[ax] < lo || a[ax] > hi) return null;
    } else {
      let t0 = (lo - a[ax]) / d;
      let t1 = (hi - a[ax]) / d;
      if (t0 > t1) [t0, t1] = [t1, t0];
      tmin = Math.max(tmin, t0);
      tmax = Math.min(tmax, t1);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

const solidFilter = (c: { kind: string }) => c.kind !== 'invisible' && c.kind !== 'trigger';

/** Enemies can't see past the draw distance of the generation Pip stands in. */
export const viewRange = (pipEra: Era) => (pipEra === 2 ? 15 : pipEra === 0 ? 9 : Infinity);

/**
 * Combat state: the Pulse Emitter (heat, venting, charged shot), projectiles and hostiles.
 * Deterministic and headless.
 */
export class Combat {
  projectiles: Projectile[] = [];
  hostiles: Hostile[];
  heat = 0;
  overheated = false;
  ventT = 0;
  fireCd = 0;
  charge = 0;
  enabled = false;
  private time = 0;

  constructor(defs: HostileDef[]) {
    this.hostiles = defs.map((d) => new Hostile(d));
  }

  wake(group: string) {
    for (const h of this.hostiles) if (h.def.group === group) h.awake = true;
  }

  /** Living hostiles of a group (for encounter gating). */
  remaining(group: string) {
    return this.hostiles.filter((h) => h.def.group === group && h.alive).length;
  }

  /** Fire the emitter from `origin` toward `target`. Returns false if blocked by heat/cooldown. */
  fire(origin: V3, target: V3, charged = false): boolean {
    if (!this.enabled || this.overheated || this.fireCd > 0) return false;
    const d = v3(target.x - origin.x, target.y - origin.y, target.z - origin.z);
    const l = Math.hypot(d.x, d.y, d.z) || 1;
    const speed = WEAPON.speed * (charged ? 0.8 : 1);
    this.projectiles.push({
      pos: { ...origin },
      prev: { ...origin },
      vel: v3((d.x / l) * speed, (d.y / l) * speed, (d.z / l) * speed),
      owner: 'pip',
      dmg: charged ? 4 : 1,
      ttl: 1.6,
      charged,
      alive: true,
    });
    this.heat = Math.min(1, this.heat + (charged ? WEAPON.chargeHeat : WEAPON.heatPerShot));
    this.fireCd = charged ? 0.35 : WEAPON.fireInterval;
    if (this.heat >= 1) {
      this.overheated = true;
      this.ventT = WEAPON.ventTime;
    }
    return true;
  }

  private enemyShot(ctx: CombatCtx, from: V3, to: V3, speed: number, dmg: number, spread = 0) {
    const d = v3(to.x - from.x, to.y - from.y, to.z - from.z);
    const l = Math.hypot(d.x, d.y, d.z) || 1;
    const a = Math.atan2(d.x, d.z) + spread;
    const horiz = Math.hypot(d.x, d.z) / l;
    const dir = v3(Math.sin(a) * horiz, d.y / l, Math.cos(a) * horiz);
    this.projectiles.push({ pos: { ...from }, prev: { ...from }, vel: v3(dir.x * speed, dir.y * speed, dir.z * speed), owner: 'enemy', dmg, ttl: 4, charged: false, alive: true });
    ctx.emit({ type: 'enemyShot', pos: { ...from } });
  }

  private canSee(ctx: CombatCtx, h: Hostile, range: number) {
    const pip = ctx.pip();
    const eye = h.center();
    const d = Math.hypot(pip.x - eye.x, pip.y - eye.y, pip.z - eye.z);
    if (d > Math.min(range, viewRange(ctx.pipEra()))) return false;
    const hit = ctx.world.raycast(eye, pip, (c) => solidFilter(c) && !overlaps(c, h.box()));
    return hit === null;
  }

  step(dt: number, ctx: CombatCtx) {
    this.time += dt;
    // weapon heat
    this.fireCd = Math.max(0, this.fireCd - dt);
    if (this.overheated) {
      this.ventT -= dt;
      this.heat = Math.max(0, this.heat - dt * 0.8);
      if (this.ventT <= 0) {
        this.overheated = false;
        ctx.emit({ type: 'vented' });
      }
    } else {
      this.heat = Math.max(0, this.heat - dt * WEAPON.cool * (this.fireCd > 0 ? 0.3 : 1));
    }

    // hostiles
    const pip = ctx.pip();
    for (const h of this.hostiles) {
      h.prevPos = { ...h.pos };
      h.hitFlash = Math.max(0, h.hitFlash - dt * 4);
      if (!h.alive) {
        h.dying += dt;
        continue;
      }
      h.era = ctx.era.gameEraAtBox(h.box().min, h.box().max);
      if (!h.awake) continue;
      h.t += dt;
      h.cooldown -= dt;
      if (!h.exists) {
        h.telegraph = 0;
        continue;
      }
      const dx = pip.x - h.pos.x;
      const dz = pip.z - h.pos.z;
      const dist = Math.hypot(dx, dz);
      h.aimYaw = Math.atan2(dx, dz);
      h.aimPitch = Math.atan2(pip.y - h.center().y, dist);
      switch (h.kind) {
        case 'censor': {
          const ang = h.t * 0.45 + h.phase;
          const tx = pip.x + Math.sin(ang) * 8.5;
          const tz = pip.z + Math.cos(ang) * 8.5;
          const ty = Math.max(h.home.y, pip.y + 4.2) + Math.sin(h.t * 1.7 + h.phase) * 0.4;
          // drones keep near their post so they don't drift through buildings
          const lx = clamp(tx, h.home.x - 10, h.home.x + 10);
          const lz = clamp(tz, h.home.z - 7, h.home.z + 7);
          h.pos.x += clamp(lx - h.pos.x, -4 * dt, 4 * dt);
          h.pos.z += clamp(lz - h.pos.z, -4 * dt, 4 * dt);
          h.pos.y += clamp(ty - h.pos.y, -3 * dt, 3 * dt);
          if (h.cooldown <= 0 && this.canSee(ctx, h, 28)) {
            this.enemyShot(ctx, h.center(), pip, 15, 1);
            h.cooldown = 1.9 + (h.phase % 1) * 0.6;
          }
          break;
        }
        case 'enforcer': {
          const b = h.box();
          if (h.sprite) {
            // 8-bit: a simple sprite that marches at you.
            const s = Math.sign(dx) * Math.min(Math.abs(dx), 2.2 * dt);
            const sz = Math.sign(dz) * Math.min(Math.abs(dz), 2.2 * dt);
            ctx.world.sweep(b, 'x', s);
            ctx.world.sweep(b, 'z', sz);
          } else {
            const seen = this.canSee(ctx, h, 30);
            let mx = 0;
            let mz = 0;
            if (seen) {
              const want = dist > 10 ? 1 : dist < 6 ? -1 : 0;
              mx += (dx / (dist || 1)) * want;
              mz += (dz / (dist || 1)) * want;
              const strafe = Math.sin(h.t * 0.9 + h.phase);
              mx += (-dz / (dist || 1)) * strafe * 0.7;
              mz += (dx / (dist || 1)) * strafe * 0.7;
              if (h.cooldown <= 0) {
                h.burst = 3;
                h.burstT = 0;
                h.cooldown = 2.6;
              }
            }
            const sp = 2.6 * dt;
            ctx.world.sweep(b, 'x', mx * sp);
            ctx.world.sweep(b, 'z', mz * sp);
            if (h.burst > 0) {
              h.burstT -= dt;
              if (h.burstT <= 0 && seen) {
                this.enemyShot(ctx, h.center(), pip, 24, 1, Math.sin(h.t * 91 + h.phase) * 0.03);
                h.burst--;
                h.burstT = 0.16;
              }
            }
          }
          h.pos.x = (b.min.x + b.max.x) / 2;
          h.pos.z = (b.min.z + b.max.z) / 2;
          break;
        }
        case 'turret': {
          if (h.cooldown <= 0 && this.canSee(ctx, h, 22)) {
            this.enemyShot(ctx, h.center(), pip, 30, 1);
            h.cooldown = 0.6;
          }
          break;
        }
        case 'sniper': {
          if (this.canSee(ctx, h, 75)) {
            if (h.telegraph === 0) ctx.emit({ type: 'telegraph', pos: h.center() });
            h.telegraph = Math.min(1, h.telegraph + dt / 1.3);
            if (h.telegraph >= 1 && h.cooldown <= 0) {
              this.enemyShot(ctx, h.center(), pip, 80, 2);
              h.telegraph = 0;
              h.cooldown = 2.4;
            }
          } else {
            h.telegraph = Math.max(0, h.telegraph - dt * 2);
          }
          break;
        }
        case 'warden': {
          const b = h.box();
          // Keep a fighting distance and stay near the door.
          const want = dist > 8 ? 1 : dist < 5 ? -0.6 : 0;
          const sp = (h.sprite ? 1.8 : 1.4) * dt;
          ctx.world.sweep(b, 'x', clamp((dx / (dist || 1)) * want * sp, -sp, sp));
          ctx.world.sweep(b, 'z', clamp((dz / (dist || 1)) * want * sp, -sp, sp));
          h.pos.x = clamp((b.min.x + b.max.x) / 2, h.home.x - 26, h.home.x + 2);
          h.pos.z = clamp((b.min.z + b.max.z) / 2, h.home.z - 11, h.home.z + 11);
          if (h.sprite) break;
          // Slam when Pip is close: telegraphed wind-up, then a shockwave.
          if (h.slamT < 0 && dist < 4.2 && h.cooldown <= 0) {
            h.slamT = 0;
            ctx.emit({ type: 'telegraph', pos: { ...h.pos } });
          }
          if (h.slamT >= 0) {
            h.slamT += dt;
            h.telegraph = Math.min(1, h.slamT / 0.8);
            if (h.slamT >= 0.8) {
              ctx.emit({ type: 'slam', pos: { ...h.pos } });
              const pb = ctx.pipBox();
              if (dist < 4.8 && pb.min.y < h.pos.y + 0.6 && !ctx.pipInvulnerable()) ctx.hurtPip(2, h.pos);
              h.slamT = -1;
              h.telegraph = 0;
              h.cooldown = 2.2;
            }
          } else if (h.cooldown <= 0 && this.canSee(ctx, h, 40)) {
            for (let i = -3; i <= 3; i++) this.enemyShot(ctx, v3(h.pos.x, h.pos.y + 2.4, h.pos.z), pip, 17, 1, i * 0.12);
            h.cooldown = 3.2;
          }
          // Fidelity pulse: pops Pip's Regress bubble, forcing him to re-project it.
          h.pulseCd -= dt;
          if (h.pulseCd <= 0) {
            h.pulseCd = 10;
            ctx.emit({ type: 'pulse', pos: { ...h.pos } });
            if (dist < 18) ctx.popBubble();
          }
          break;
        }
      }
    }

    // projectiles
    for (const pr of this.projectiles) {
      if (!pr.alive) continue;
      pr.ttl -= dt;
      if (pr.ttl <= 0) {
        pr.alive = false;
        continue;
      }
      pr.prev = { ...pr.pos };
      const next = v3(pr.pos.x + pr.vel.x * dt, pr.pos.y + pr.vel.y * dt, pr.pos.z + pr.vel.z * dt);
      // Lasers were never invented in 8-bit: bolts entering an 8-bit region simply cease to exist.
      if (ctx.era.gameEraAt(next) === 0) {
        pr.alive = false;
        ctx.emit({ type: 'boltFizzle', pos: next });
        continue;
      }
      let best = ctx.world.raycast(pr.pos, next, solidFilter);
      let target: Hostile | 'pip' | null = null;
      if (pr.owner === 'pip') {
        for (const h of this.hostiles) {
          if (!h.alive || !h.exists) continue;
          const f = segmentBox(pr.pos, next, h.box(), 0.15);
          if (f !== null && (best === null || f < best)) {
            best = f;
            target = h;
          }
        }
      } else if (!ctx.pipInvulnerable()) {
        const f = segmentBox(pr.pos, next, ctx.pipBox(), 0.05);
        if (f !== null && (best === null || f < best)) {
          best = f;
          target = 'pip';
        }
      }
      if (best === null) {
        pr.pos = next;
        continue;
      }
      const hitPos = v3(pr.pos.x + (next.x - pr.pos.x) * best, pr.pos.y + (next.y - pr.pos.y) * best, pr.pos.z + (next.z - pr.pos.z) * best);
      pr.pos = hitPos;
      pr.alive = false;
      if (target === 'pip') {
        ctx.hurtPip(pr.dmg, hitPos);
      } else if (target) {
        this.damage(target, pr.dmg, hitPos, ctx);
      } else {
        ctx.emit({ type: 'impact', pos: hitPos, value: pr.owner === 'pip' ? 1 : 0 });
      }
      if (pr.charged) {
        for (const h of this.hostiles) {
          if (h === target || !h.alive || !h.exists) continue;
          const c = h.center();
          if (Math.hypot(c.x - hitPos.x, c.y - hitPos.y, c.z - hitPos.z) < 2.6) this.damage(h, 2, c, ctx);
        }
      }
    }
    if (this.projectiles.length > 160) this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  /** Apply damage, honouring the Warden's shield and armour. */
  damage(h: Hostile, dmg: number, at: V3, ctx: CombatCtx, stomp = false) {
    if (!h.alive || !h.exists) return;
    if (h.shielded && !stomp) {
      ctx.emit({ type: 'shieldHit', pos: at });
      return;
    }
    if (h.armored && !stomp) {
      ctx.emit({ type: 'armorHit', pos: at });
      return;
    }
    h.hp -= dmg;
    h.hitFlash = 1;
    h.awake = true;
    ctx.emit({ type: 'hit', pos: at, value: dmg });
    if (h.hp <= 0) {
      h.alive = false;
      h.dying = 0;
      ctx.emit({ type: 'enemyDown', pos: h.center(), text: h.kind });
    }
  }
}
