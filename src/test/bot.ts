import type { Game } from '../game/sim/Game';
import type { ScriptedInput } from './helpers';
import type { Action } from '../game/sim/Input';
import type { Era } from '../game/era/EraSystem';
import { AQUEDUCT, PLATES, RELIEFS, WAVE } from '../game/level/meadows';
import { v3 } from '../game/math';

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

/**
 * A bot that plays the whole game through the real input path: 2D runs with obstacle/gap/enemy
 * heuristics, 3D steering converted into camera-relative stick input, and Regress via the Q wheel
 * for each generation-rule obstacle on the Halo Path.
 */
export class Bot {
  phase = 'awaken';
  waypoints: Waypoint[] = [];
  log: string[] = [];
  private jumpHold = 0;
  private lastGround = '';
  private regressSeq: { era: Era | null; step: number } | null = null;
  /** Middle of the handhold the bot is jumping toward. */
  private hopTarget: number | null = null;

  constructor(public input: ScriptedInput) {}

  setPhase(p: string, g: Game) {
    this.phase = p;
    this.log.push(`${g.time.toFixed(2)}s ${p} @ x=${g.player.pos.x.toFixed(2)} y=${g.player.pos.y.toFixed(2)} z=${g.player.pos.z.toFixed(2)}`);
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

  // ---------------------------------------------------------------- the Halo Path

  /**
   * Past the Frame Gate each obstacle wants a generation: walk up, project it, cross, drop it.
   * Returns true when it has taken over the input this tick.
   */
  private halo(g: Game) {
    const p = g.player;
    const L = g.level;
    const x = p.pos.x;
    const bubble = g.era.bubble;
    const stop = () => (this.input.x = 0);
    // Light fence (8-bit) and brambles (16-bit): project before, walk through, drop after.
    const gates: [number, number, Era][] = [
      [L.beamX, 1.3, 0],
      [L.thicketX - 0.8, 2.2, 1],
    ];
    for (const [gx, half, era] of gates) {
      if (x > gx - half - 1.6 && x < gx - half - 0.4 && p.grounded && bubble?.era !== era) {
        stop();
        this.regress(g, era);
        return true;
      }
      if (bubble?.era === era && x > gx + half + 0.6 && p.grounded) {
        stop();
        this.regress(g, null);
        return true;
      }
    }
    // Cliff handholds (Stylized): careful hops between holds.
    const gap = L.reliefGap;
    if (x > gap.x0 - 2 && x < gap.x1 && p.pos.y > L.haloY - 1) {
      if (bubble?.era !== 3) {
        if (!p.grounded) return false;
        stop();
        this.regress(g, 3);
        return true;
      }
      const holds = [{ x0: gap.x0 - 4, x1: gap.x0 }, ...RELIEFS, { x0: gap.x1, x1: gap.x1 + 4 }];
      const i = holds.findIndex((h) => x >= h.x0 - 0.3 && x <= h.x1 + 0.3);
      if (p.grounded && i >= 0 && i < holds.length - 1) {
        const edge = holds[i].x1;
        const next = holds[i + 1];
        // walk to the edge, then a modest-speed jump that lands in the middle of the next hold
        if (x < edge - 0.45) this.input.x = 0.7;
        else {
          this.input.x = 0.55;
          this.hopTarget = (next.x0 + next.x1) / 2;
          this.pressJump();
        }
        return true;
      }
      if (!p.grounded && this.hopTarget !== null) {
        // steer toward the middle of the hold ahead while airborne
        const mid = this.hopTarget;
        this.input.x = Math.abs(mid - x) < 0.25 ? 0 : Math.sign(mid - x) * 0.8;
        return true;
      }
      return false;
    }
    if (bubble?.era === 3 && x > gap.x1 + 1 && p.grounded) {
      stop();
      this.regress(g, null);
      return true;
    }
    // The sleeping glyph stone: stand beside it and project full detail.
    const gs = L.glyphStone;
    if (!g.save.glyphsRead && x > L.sleepField.min.x - 2) {
      if (Math.abs(x - gs.x) > 0.25 || !p.grounded) {
        this.input.x = Math.sign(gs.x - x) * Math.min(1, Math.abs(gs.x - x) + 0.2);
        return true;
      }
      stop();
      this.regress(g, 5);
      return true;
    }
    if (g.save.glyphsRead && bubble && x < L.aqueduct.x0) {
      stop();
      this.regress(g, null);
      return true;
    }
    // The Update Wave: wait at the near stub until the wave sits there, then keep pace with it across.
    if (x > AQUEDUCT.gap0 - 1.2 && x < AQUEDUCT.gap1 + 0.3 && p.pos.y > L.sealY - 1) {
      if (x < AQUEDUCT.gap0) {
        // board only while the wave is paused at this end (or just leaving it)
        this.input.x = g.waveX < WAVE.c0 + 0.4 && g.waveX >= WAVE.c0 ? 0.5 : x < AQUEDUCT.gap0 - 0.7 ? 0.4 : 0;
        if (this.input.x === 0 && x > AQUEDUCT.gap0 - 0.4) this.input.x = -0.3;
        return true;
      }
      this.input.x = x > AQUEDUCT.gap1 || x < g.waveX + 0.5 ? 0.6 : 0;
      return true;
    }
    // The world wheel: on each plate still to install, roll back to its generation (plate 6.0: Beyond, no bubble).
    if (x > L.summitX - 1 && !g.save.finished) {
      const left = PLATES.filter((pl) => !(g.save.installed & (1 << pl.era)));
      if (!left.length) return false;
      const pl = left[0];
      if (Math.abs(x - pl.x) > 0.3 || !p.grounded) {
        this.input.x = Math.sign(pl.x - x) * Math.min(1, Math.abs(pl.x - x) + 0.15);
        return true;
      }
      stop();
      const want = pl.era === 5 ? null : pl.era;
      if ((bubble?.era ?? null) !== want) this.regress(g, want);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- main

  tick(g: Game, dt: number) {
    const inp = this.input;
    this.jumpHold -= dt;
    if (this.jumpHold <= 0) inp.release('jump');
    inp.release('shift');
    if (!this.regressSeq) for (const a of ERA_KEY) inp.release(a);
    const p = g.player;
    if (g.finaleCard && this.phase !== 'done') this.setPhase('done', g);
    if (this.phase === 'done') {
      inp.x = inp.y = 0;
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
        if (this.halo(g)) break;
        this.run2D(g);
        break;
    }
  }
}
