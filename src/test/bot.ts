import type { Game } from '../game/sim/Game';
import type { ScriptedInput } from './helpers';
import type { Hostile } from '../game/combat/combat';
import type { Action } from '../game/sim/Input';
import type { Era } from '../game/era/EraSystem';
import { v3, wrapAngle, type V3 } from '../game/math';

interface Waypoint {
  x: number;
  z: number;
  until?: (g: Game) => boolean;
  tol?: number;
}

/** Ground pieces that end at a moving-platform pit, and the mover that crosses it. */
const MOVER_PITS = [
  { ground: 'g3', edge: 46.5, mover: 0 },
  { ground: 'p1', edge: 121, mover: 1 },
];

const ERA_KEY: Action[] = ['era1', 'era2', 'era3', 'era4', 'era5', 'era6'];

interface Goal {
  name: string;
  done: (g: Game) => boolean;
  act: (g: Game, bot: Bot) => void;
}

/**
 * A bot that plays the whole game through the real input path: 2D runs with obstacle/gap/enemy
 * heuristics, 3D steering converted into camera-relative stick input, Regress via the Q wheel,
 * and in the city it aims with mouse-look deltas and fires the emitter.
 */
export class Bot {
  phase = 'awaken';
  waypoints: Waypoint[] = [];
  log: string[] = [];
  private jumpHold = 0;
  private lastGround = '';
  private regressSeq: { era: Era | null; step: number } | null = null;
  private goal = 0;
  private goals: Goal[];
  private stuckT = 0;
  private lastPos = v3();
  private sidestep = 0;
  private sideDir = 1;

  constructor(public input: ScriptedInput) {
    this.goals = this.vergeGoals();
  }

  setPhase(p: string, g: Game) {
    this.phase = p;
    this.log.push(`${g.time.toFixed(2)}s ${p} @ x=${g.player.pos.x.toFixed(2)} y=${g.player.pos.y.toFixed(2)} z=${g.player.pos.z.toFixed(2)}`);
  }

  /** Start the city part of the bot at a named goal (resume tests). */
  startVergeAt(name: string, g: Game) {
    this.goal = Math.max(0, this.goals.findIndex((x) => x.name === name));
    this.setPhase(`verge:${this.goals[this.goal].name}`, g);
  }

  // ---------------------------------------------------------------- shared helpers

  private wallAhead(g: Game, dir: number) {
    const p = g.player;
    const b = p.box(v3(p.pos.x + dir * 0.55, p.pos.y + 0.05, p.pos.z));
    return !g.world.isFree(b);
  }

  private gapAhead(g: Game, dir: number) {
    const p = g.player;
    const b = p.box(v3(p.pos.x + dir * 0.9, p.pos.y, p.pos.z));
    return !g.world.groundBelow(b, 2.5);
  }

  pressJump() {
    if (this.jumpHold <= 0) {
      this.input.press('jump');
      this.jumpHold = 0.45;
    }
  }

  run2D(g: Game, targetX?: number) {
    const inp = this.input;
    const p = g.player;
    let dir = 1;
    if (targetX !== undefined) {
      const dx = targetX - p.pos.x;
      dir = Math.abs(dx) < 0.15 ? 0 : Math.sign(dx);
    }
    inp.x = dir;
    inp.y = 0;
    let jump = false;
    if (p.grounded && dir !== 0) {
      if (this.wallAhead(g, dir) || this.gapAhead(g, dir)) jump = true;
      for (const e of g.enemies) {
        const d = (e.pos.x - p.pos.x) * dir;
        if (e.alive && d > 0 && d < 2.4 && Math.abs(e.pos.y - p.pos.y) < 1) jump = true;
      }
    }
    if (p.grounded) this.lastGround = p.ground?.id ?? '';
    for (const pit of MOVER_PITS) {
      const m = g.movers[pit.mover];
      const waitAt = pit.edge - 0.6;
      if (p.grounded && p.ground?.id === pit.ground && p.pos.x > pit.edge - 2 && p.pos.x < pit.edge + 0.2) {
        inp.x = p.pos.x < waitAt ? 1 : 0;
        jump = false;
        if (m.centerX < m.minX + 0.2 && m.centerX > m.prevX) {
          inp.x = 1;
          jump = true;
        }
      }
      if (!p.grounded && this.lastGround === pit.ground && p.pos.x > pit.edge - 0.1 && p.pos.x < pit.edge + 5.3) {
        const d = m.centerX - p.pos.x;
        inp.x = Math.abs(d) < 0.2 ? 0 : Math.sign(d);
      }
      if (p.ground === m.collider) {
        inp.x = 0;
        jump = false;
        if (m.centerX > m.maxX - 0.3) {
          inp.x = 1;
          jump = true;
        }
      }
    }
    if (jump) this.pressJump();
  }

  steer(g: Game, tx: number, tz: number, tol = 0.12) {
    const p = g.player;
    const dx = tx - p.pos.x;
    const dz = tz - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < tol) {
      this.input.x = this.input.y = 0;
      return true;
    }
    const k = Math.min(1, d / 0.6);
    const mx = (dx / d) * k;
    const mz = (dz / d) * k;
    const yaw = g.camera.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = -fz;
    const rz = fx;
    this.input.x = mx * rx + mz * rz;
    this.input.y = mx * fx + mz * fz;
    return false;
  }

  private follow(g: Game, next: string) {
    const w = this.waypoints[0];
    if (!w) {
      this.input.x = this.input.y = 0;
      this.setPhase(next, g);
      return;
    }
    const reached = this.steer(g, w.x, w.z, w.tol);
    if ((w.until && w.until(g)) || (!w.until && reached)) this.waypoints.shift();
  }

  /** Press shift until the perspective is `want`. Returns true when settled. */
  shiftTo(g: Game, want: '2d' | '3d') {
    this.input.x = this.input.y = 0;
    if (g.shift.mode === want && !g.shift.busy) return true;
    if (!g.shift.busy && g.player.grounded && !g.cine) this.input.press('shift');
    return false;
  }

  /** Drive the Q wheel: hold Q, press a generation key, release. `null` drops the bubble. */
  regress(g: Game, era: Era | null) {
    const cur = g.era.bubble ? g.era.bubble.era : null;
    if (cur === era && !this.regressSeq) return true;
    if (!this.regressSeq) this.regressSeq = { era, step: 0 };
    const s = this.regressSeq;
    if (s.step === 0) {
      this.input.press('regress');
    } else if (s.step === 1) {
      // To drop the bubble, re-pick the active generation (picking the current one toggles it off).
      const pick = s.era !== null ? s.era : cur;
      if (pick !== null) this.input.press(ERA_KEY[pick]);
    } else {
      this.input.release('regress');
      this.regressSeq = null;
      return false;
    }
    s.step++;
    return false;
  }

  // ---------------------------------------------------------------- shooting

  private los(g: Game, from: V3, to: V3) {
    return g.world.raycast(from, to, (c) => c.kind !== 'invisible') === null;
  }

  /** Nearest awake, existing, visible hostile. */
  target(g: Game, range = 45, exclude?: Hostile): Hostile | null {
    const p = g.player;
    const eye = v3(p.pos.x, p.pos.y + 1.4, p.pos.z);
    let best: Hostile | null = null;
    let bd = range;
    for (const h of g.combat.hostiles) {
      if (!h.alive || !h.awake || !h.exists || h === exclude) continue;
      const c = h.center();
      const d = Math.hypot(c.x - eye.x, c.y - eye.y, c.z - eye.z);
      if (d < bd && this.los(g, eye, c)) {
        bd = d;
        best = h;
      }
    }
    return best;
  }

  /** Turn the camera (via mouse-look deltas) toward a point; true when lined up. */
  aimAt(g: Game, t: V3) {
    const c = g.camera;
    // Aim from the camera itself (the crosshair ray starts there, over the shoulder).
    const dx = t.x - c.pos.x;
    const dz = t.z - c.pos.z;
    const yaw = Math.atan2(-dx, -dz);
    const horiz = Math.hypot(dx, dz);
    const pitch = -Math.atan2(t.y - c.pos.y, horiz);
    const dy = wrapAngle(yaw - c.lookYaw);
    const dp = pitch - c.lookPitch;
    this.input.orbitYaw = Math.max(-0.2, Math.min(0.2, dy));
    this.input.orbitPitch = Math.max(-0.12, Math.min(0.12, dp));
    return Math.abs(dy) < 0.06 && Math.abs(dp) < 0.08;
  }

  /** True if the crosshair ray actually reaches this target (not a pillar in front of it). */
  aimClear(g: Game, t: Hostile) {
    const c = t.center();
    const a = g.aimPoint;
    return Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z) < Math.max(t.hw, 0.6) + 0.9;
  }

  /** The current target if the aim ray is blocked (so the caller can close the distance). */
  blocked: Hostile | null = null;
  retreating = false;

  /** Engage a target if any; returns true while fighting. */
  fight(g: Game, range = 30) {
    const t = this.target(g, range);
    this.blocked = null;
    if (!t) {
      this.input.release('fire');
      return false;
    }
    if (g.shift.mode === '2d') {
      // 2D: the emitter auto-aims along the facing.
      if (g.combat.overheated) this.input.release('fire');
      else this.input.press('fire');
      return true;
    }
    const aligned = this.aimAt(g, t.center());
    if (aligned && !this.aimClear(g, t)) {
      this.blocked = t;
      this.input.release('fire');
      return true;
    }
    if (aligned && !g.combat.overheated && g.pipEra !== 0) this.input.press('fire');
    else this.input.release('fire');
    return true;
  }

  // ---------------------------------------------------------------- the city

  private vergeGoals(): Goal[] {
    const warden = (g: Game) => g.combat.hostiles.find((h) => h.kind === 'warden')!;
    const route = (pts: [number, number][]) => {
      // Progress is kept between ticks; a teleport (respawn) re-picks the nearest point.
      let i = 0;
      let last: V3 | null = null;
      return (g: Game, bot: Bot) => {
        const p = g.player.pos;
        if (last && Math.hypot(p.x - last.x, p.z - last.z) > 3) {
          let bd = Infinity;
          pts.forEach(([x, z], k) => {
            const d = Math.hypot(p.x - x, p.z - z);
            if (d < bd) {
              bd = d;
              i = k;
            }
          });
        }
        last = { ...p };
        while (i < pts.length && Math.hypot(p.x - pts[i][0], p.z - pts[i][1]) < 0.6) i++;
        if (i < pts.length) bot.steer(g, pts[i][0], pts[i][1], 0.3);
        else bot.input.x = bot.input.y = 0;
      };
    };
    /** After a route, advance on whatever in this group is still alive. */
    const hunt = (group: string, base: (g: Game, bot: Bot) => void) => (g: Game, bot: Bot) => {
      const left = g.combat.hostiles.filter((h) => h.def.group === group && h.alive);
      const p = g.player.pos;
      const near = left.sort((a, b) => Math.hypot(a.pos.x - p.x, a.pos.z - p.z) - Math.hypot(b.pos.x - p.x, b.pos.z - p.z))[0];
      if (near) {
        // Keep closing until something is in sight (fight() takes over once it is).
        const d = Math.hypot(near.pos.x - p.x, near.pos.z - p.z) || 1;
        const stop = near.kind === 'sniper' ? 7 : 2.5;
        bot.steer(g, near.pos.x - ((near.pos.x - p.x) / d) * stop, near.pos.z - ((near.pos.z - p.z) / d) * stop, 0.5);
      } else base(g, bot);
    };
    const fightThen = (move: (g: Game, bot: Bot) => void, range = 30) => (g: Game, bot: Bot) => {
      // Low on cells: fall back to the last checkpoint and let the chassis self-repair.
      if (g.cells <= 2 || (bot.retreating && g.cells < 4)) {
        bot.retreating = true;
        bot.input.release('fire');
        const cp = g.verge.checkpoints.find((c) => c.id === g.checkpoint)!.pos;
        bot.steer(g, cp.x, cp.z, 0.3);
        return;
      }
      bot.retreating = false;
      if (bot.fight(g, range)) {
        // Something in the way: sidestep toward the target instead of shooting cover.
        if (bot.blocked) {
          const b = bot.blocked.pos;
          const p = g.player.pos;
          const dx = b.x - p.x;
          const dz = b.z - p.z;
          const d = Math.hypot(dx, dz) || 1;
          bot.steer(g, p.x + (dx / d) * 2 - (dz / d) * 2, p.z + (dz / d) * 2 + (dx / d) * 2, 0.1);
        } else bot.input.x = bot.input.y = 0;
      } else move(g, bot);
    };
    const doorRoute = route([[1166, -11], [1180, -11], [1194.6, -3.4]]);
    const coreRoute = route([[1194, -3], [1205, 0], [1216, 0]]);
    return [
      { name: 'emitter', done: (g) => g.save.emitter, act: route([[1013, -1.8]]) },
      { name: 'roofFight', done: (g) => g.combat.remaining('roof') === 0, act: fightThen(route([[1018, 0]])) },
      {
        name: 'drop',
        done: (g) => g.player.pos.x > 1048.5 && g.player.pos.y < 0.5,
        act: route([[1034, 0], [1039, 0], [1045, 0], [1050, -1]]),
      },
      { name: 'market', done: (g) => g.combat.remaining('market') === 0, act: fightThen(route([[1058, 0], [1066, 0], [1072, -1]])) },
      { name: 'nookApproach', done: (g) => Math.hypot(g.player.pos.x - 1075.8, g.player.pos.z + 5.2) < 0.4, act: route([[1072, -2], [1075.8, -5.2]]) },
      { name: 'nookRegress', done: (g) => g.era.bubble?.era === 0, act: (g, bot) => ((bot.input.x = bot.input.y = 0), bot.regress(g, 0)) },
      {
        name: 'terminal',
        done: (g) => g.save.shutterOpen,
        act: (g, bot) => {
          const t = g.verge.terminal;
          bot.steer(g, t.x - 0.1, t.z + 0.7, 0.25);
          if (Math.hypot(g.player.pos.x - t.x, g.player.pos.z - t.z) < 1.5) bot.input.press('shift');
        },
      },
      { name: 'nookExit', done: (g) => g.player.pos.x < 1076.4, act: route([[1079.5, -5.2], [1075.6, -5.2]]) },
      { name: 'dropBubble', done: (g) => !g.era.bubble, act: (g, bot) => ((bot.input.x = bot.input.y = 0), bot.regress(g, null)) },
      { name: 'shutterFight', done: (g) => g.combat.remaining('shutter') === 0 && g.player.pos.x > 1086, act: fightThen(route([[1080, 0], [1090, 0]])) },
      {
        name: 'toLane',
        done: (g) => g.shift.mode === '2d' && !g.shift.busy,
        act: (g, bot) => {
          bot.input.release('fire');
          if (bot.steer(g, 1096.4, -6.2, 0.2)) bot.shiftTo(g, '2d');
        },
      },
      {
        name: 'climb',
        done: (g) => g.player.pos.y > 14.5 && g.player.pos.x > 1113,
        act: (g, bot) => {
          bot.run2D(g);
          bot.fight(g, 18);
        },
      },
      { name: 'unfold', done: (g) => g.shift.mode === '3d' && !g.shift.busy, act: (g, bot) => (bot.input.release('fire'), bot.shiftTo(g, '3d')) },
      { name: 'plaza', done: (g) => g.combat.remaining('plaza') === 0, act: fightThen(hunt('plaza', route([[1138, -6], [1146, -6], [1150, -9]])), 50) },
      { name: 'toSign', done: (g) => Math.hypot(g.player.pos.x - 1157.5, g.player.pos.z + 9.5) < 0.6, act: route([[1150, -9.5], [1157.5, -9.5]]) },
      { name: 'readCode', done: (g) => g.save.codeRead, act: (g, bot) => ((bot.input.x = bot.input.y = 0), bot.regress(g, 5)) },
      { name: 'dropBubble2', done: (g) => !g.era.bubble, act: (g, bot) => ((bot.input.x = bot.input.y = 0), bot.regress(g, null)) },
      {
        name: 'door',
        done: (g) => g.wardenAwake || g.save.wardenDown,
        act: (g, bot) => {
          const d = g.verge.doorPanel;
          doorRoute(g, bot);
          if (Math.hypot(g.player.pos.x - d.x, g.player.pos.z - d.z) < 2.2) bot.input.press('shift');
        },
      },
      {
        name: 'warden',
        done: (g) => g.save.wardenDown,
        act: (g, bot) => {
          const w = warden(g);
          const p = g.player;
          const dx = w.pos.x - p.pos.x;
          const dz = w.pos.z - p.pos.z;
          const dist = Math.hypot(dx, dz) || 1;
          if (w.armored) {
            // Armoured: stomp it in 8-bit.
            bot.input.release('fire');
            if (!g.era.bubble || g.era.bubble.era !== 0) {
              bot.regress(g, 0);
              return;
            }
            bot.steer(g, w.pos.x, w.pos.z, 0.05);
            if (dist < 1.6 && p.grounded) bot.pressJump();
            return;
          }
          // Shielded: get close inside a 16-bit bubble so the shield doesn't exist, then shoot.
          if (!g.era.bubble || g.era.bubble.era !== 1) {
            bot.input.release('fire');
            bot.regress(g, 1);
            return;
          }
          if (dist > 3.0) bot.steer(g, w.pos.x - (dx / dist) * 2.6, w.pos.z - (dz / dist) * 2.6, 0.2);
          else bot.input.x = bot.input.y = 0;
          const aligned = bot.aimAt(g, w.center());
          if (aligned && !g.combat.overheated) bot.input.press('fire');
          else bot.input.release('fire');
        },
      },
      {
        name: 'dropBubble3',
        done: (g) => !g.era.bubble,
        act: (g, bot) => {
          bot.input.release('fire');
          bot.input.x = bot.input.y = 0;
          bot.regress(g, null);
        },
      },
      { name: 'core', done: (g) => g.finaleCard, act: (g, bot) => (g.cine ? (bot.input.x = bot.input.y = 0) : coreRoute(g, bot)) },
    ];
  }

  private tickVerge(g: Game) {
    while (this.goal < this.goals.length && this.goals[this.goal].done(g)) {
      this.goal++;
      this.input.release('fire');
      if (this.goal < this.goals.length) this.setPhase(`verge:${this.goals[this.goal].name}`, g);
    }
    if (this.goal >= this.goals.length) {
      this.setPhase('done', g);
      return;
    }
    // un-stick: if pushing into something for a while, hop
    const p = g.player;
    const moved = Math.hypot(p.pos.x - this.lastPos.x, p.pos.z - this.lastPos.z);
    this.stuckT = (this.input.x || this.input.y) && moved < 0.002 ? this.stuckT + 1 / 120 : 0;
    this.lastPos = { ...p.pos };
    if (this.stuckT > 0.5 && p.grounded) {
      this.pressJump();
      this.stuckT = 0;
      this.sidestep = 0.9;
      this.sideDir = -this.sideDir;
    }
    this.goals[this.goal].act(g, this);
    // Blocked by something tall: slide sideways (perpendicular to the intended direction) for a moment.
    if (this.sidestep > 0) {
      this.sidestep -= 1 / 120;
      const ix = this.input.x;
      const iy = this.input.y;
      if (ix || iy) {
        this.input.x = iy * this.sideDir + ix * 0.3;
        this.input.y = -ix * this.sideDir + iy * 0.3;
      }
    }
  }

  // ---------------------------------------------------------------- main

  tick(g: Game, dt: number) {
    const inp = this.input;
    this.jumpHold -= dt;
    if (this.jumpHold <= 0) inp.release('jump');
    inp.release('shift');
    inp.release('dash');
    if (!this.regressSeq) for (const a of ERA_KEY) inp.release(a);
    const p = g.player;
    if (g.finaleCard && this.phase !== 'done') this.setPhase('done', g);
    if (this.phase === 'done') {
      inp.x = inp.y = 0;
      inp.release('fire');
      return;
    }
    if (g.zone === 'verge' || this.phase.startsWith('verge')) {
      if (!this.phase.startsWith('verge')) this.setPhase(`verge:${this.goals[this.goal].name}`, g);
      if (g.cine && g.cine.name !== 'core') {
        inp.x = inp.y = 0;
        return;
      }
      this.tickVerge(g);
      return;
    }
    if (g.cine && this.phase !== 'awaken') {
      inp.x = inp.y = 0;
      return;
    }

    switch (this.phase) {
      case 'awaken':
        inp.x = 0;
        if (!g.cine) this.setPhase('toShard', g);
        break;
      case 'toShard':
        this.run2D(g);
        if (g.save.shardTaken) this.setPhase('toDevice', g);
        break;
      case 'toDevice':
        this.run2D(g, 59.4);
        if (g.shift.unlocked) this.setPhase('shiftIn', g);
        break;
      case 'shiftIn':
        if (this.shiftTo(g, '3d')) {
          this.waypoints = [
            { x: 53.6, z: 0 },
            { x: 53.6, z: -1.85 },
            { x: 56.5, z: -1.85 },
            { x: 56.5, z: -4 },
            { x: 54.6, z: -4 },
            { x: 54.6, z: -6.2 },
            { x: 57.6, z: -6.2, until: (gg) => gg.puzzle.cubeCenter.x >= 58.15, tol: 0.05 },
            { x: 57.0, z: -6.2 },
            { x: 57.0, z: -4.9 },
            { x: 58.2, z: -4.9 },
            { x: 58.2, z: -8.0, until: (gg) => gg.puzzle.plateLatched, tol: 0.05 },
          ];
          this.setPhase('puzzle', g);
        }
        break;
      case 'puzzle':
        this.follow(g, 'waitBridge');
        break;
      case 'waitBridge':
        inp.x = inp.y = 0;
        if (g.puzzle.state === 'repaired') {
          this.waypoints = [
            { x: 58.2, z: -4.6 },
            { x: 56.5, z: -4 },
            { x: 56.5, z: -1.85 },
            { x: 53.6, z: -1.85 },
            { x: 53.6, z: 0 },
          ];
          this.setPhase('return', g);
        }
        break;
      case 'return':
        this.follow(g, 'shiftOut');
        break;
      case 'shiftOut':
        if (this.shiftTo(g, '2d')) this.setPhase('toStair', g);
        break;
      case 'toStair':
        this.run2D(g, 98.6);
        if (Math.abs(p.pos.x - 98.6) < 0.2 && p.grounded && g.save.beaconLit) this.setPhase('shiftAct2', g);
        break;
      case 'shiftAct2':
        if (this.shiftTo(g, '3d')) {
          const k = g.level.lampSocket;
          this.waypoints = [
            { x: 101.1, z: 0 },
            { x: 101.1, z: 5.5 },
            { x: k.x - 0.9, z: 5.5, until: (gg) => gg.stair.lampCenter.x >= k.x - 0.05, tol: 0.05 },
            { x: k.x - 0.95, z: 5.5 },
            { x: k.x - 0.95, z: 6.6 },
            { x: k.x, z: 6.6 },
            { x: k.x, z: k.z, until: (gg) => gg.stair.latched, tol: 0.05 },
          ];
          this.setPhase('lamp', g);
        }
        break;
      case 'lamp':
        this.follow(g, 'waitStair');
        break;
      case 'waitStair':
        inp.x = inp.y = 0;
        if (g.stair.state === 'complete') {
          this.waypoints = [
            { x: 103.5, z: 6.6 },
            { x: 103.5, z: 1.2 },
            { x: 99.4, z: 1.2 },
            { x: 99.4, z: 0 },
          ];
          this.setPhase('returnAct2', g);
        }
        break;
      case 'returnAct2':
        this.follow(g, 'shiftOut2');
        break;
      case 'shiftOut2':
        if (this.shiftTo(g, '2d')) this.setPhase('climb', g);
        break;
      case 'climb': {
        // The laser fence on the plateau only exists from 16-bit up: walk through it in 8-bit.
        const fx = g.level.fenceX;
        const onPlateau = p.pos.y > 8;
        if (onPlateau && p.pos.x > fx - 2.2 && p.pos.x < fx - 0.6 && !g.era.bubble) {
          inp.x = 0;
          this.regress(g, 0);
          break;
        }
        if (g.era.bubble && p.pos.x > fx + 1.2 && p.grounded) {
          inp.x = 0;
          this.regress(g, null);
          break;
        }
        this.run2D(g);
        if (g.save.gatePassed && !g.cine) this.setPhase('finish', g);
        break;
      }
      case 'finish':
        this.run2D(g);
        break;
    }
  }
}
