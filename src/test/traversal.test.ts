import { describe, expect, it } from 'vitest';
import { Game } from '../game/sim/Game';
import { ScriptedInput, run, runUntil } from './helpers';
import { newSave, type SaveData } from '../game/save/save';
import { PIP_SIZE } from '../game/sim/constants';
import { arcReaches, laneEdges, laneSegments, measurePip, reach, safestPath, search, segmentAt } from '../game/level/traversal';

/** Every puzzle solved, every ability unlocked: the level as a player who has done everything can move through it. */
const FINAL: Partial<SaveData> = {
  awakened: true, shardTaken: true, era: 5, shiftUnlocked: true, firstShiftDone: true, bridgeRepaired: true,
  beaconLit: true, stairRepaired: true, gatePassed: true, regress: true, glyphsRead: true, eraKeys: true,
};
/** Jumps on the required route must clear with at least this much to spare (units). */
const MIN_MARGIN = 0.35;

function world2d() {
  const game = new Game(new ScriptedInput(), { ...newSave(), ...FINAL });
  game.shift.set('2d');
  const movers = game.level.movers.map((m) => ({ id: m.id, minX: m.minX, maxX: m.maxX, halfW: m.halfW, y: m.y }));
  return { game, segs: laneSegments(game.world, movers) };
}

describe('Traversal: Pip measured, and the level checked against it', () => {
  const env = measurePip();

  it('measures the controller (recorded in docs/TRAVERSAL.md)', () => {
    const rows = [-4, -2, -1, 0, 1, 2, 2.5].map((dh) => `${dh}: ${reach(env, dh).toFixed(2)}`);
    console.log(
      `run ${env.runSpeed.toFixed(2)} u/s (90% in ${env.accelTime.toFixed(2)} s) · tap ${env.tapHeight.toFixed(2)} · held ${env.heldHeight.toFixed(2)} · air ${env.airTime.toFixed(2)} s · air turn ${env.airTurn.toFixed(2)} · Pip ${PIP_SIZE.hw * 2} x ${PIP_SIZE.h}\nreach by height difference: ${rows.join(' | ')}`,
    );
    expect(env.heldHeight).toBeGreaterThan(env.tapHeight + 0.5);
    expect(reach(env, 0)).toBeGreaterThan(3);
    expect(reach(env, env.heldHeight + 0.01)).toBe(-Infinity);
  });

  it('the goal is reachable from the spawn along the lane, and every jump on the way clears with room to spare', () => {
    const { game, segs } = world2d();
    const edges = laneEdges(segs, env);
    const start = segmentAt(segs, game.level.spawn.x, game.level.spawn.y)!;
    const goal = segmentAt(segs, game.level.wheel.x, game.level.sealY)!;
    const path = safestPath(edges, start.id, goal.id);
    expect(path).not.toBeNull();
    const jumps = path!.filter((e) => e.kind === 'jump');
    console.log('safest route:\n' + jumps.map((e) => `  ${e.from} → ${e.to}: gap ${e.gap.toFixed(2)}, rise ${e.dh.toFixed(2)}, spare ${e.margin.toFixed(2)}`).join('\n'));
    // shortcuts: jumps the route doesn't need that skip a mover or a stepping stone (allowed, but listed)
    const used = new Set(path!.map((e) => `${e.from}>${e.to}`));
    const skips = edges.filter((e) => e.kind === 'jump' && e.margin < 0.6 && e.gap > 3 && !used.has(`${e.from}>${e.to}`));
    console.log('expert shortcuts:\n' + skips.map((e) => `  ${e.from} → ${e.to}: gap ${e.gap.toFixed(2)}, spare ${e.margin.toFixed(2)}`).join('\n'));
    const tight = jumps.filter((e) => e.margin < MIN_MARGIN).map((e) => `${e.from} → ${e.to} spare ${e.margin.toFixed(2)}`);
    expect(tight).toEqual([]);
  });

  it('no softlocks: from every surface you can reach, the goal is still reachable', () => {
    const { game, segs } = world2d();
    const edges = laneEdges(segs, env);
    const start = segmentAt(segs, game.level.spawn.x, game.level.spawn.y)!;
    const goal = segmentAt(segs, game.level.wheel.x, game.level.sealY)!;
    const reached = search(edges, start.id);
    const toGoal = search(edges, goal.id, true);
    const stuck = [...reached.keys()].filter((n) => !toGoal.has(n));
    expect(stuck).toEqual([]);
  });

  it('every checkpoint stands on solid ground with headroom, on the route, with the goal still ahead', () => {
    const { game, segs } = world2d();
    const edges = laneEdges(segs, env);
    const start = segmentAt(segs, game.level.spawn.x, game.level.spawn.y)!;
    const goal = segmentAt(segs, game.level.wheel.x, game.level.sealY)!;
    const reached = search(edges, start.id);
    const toGoal = search(edges, goal.id, true);
    for (const cp of game.level.checkpoints) {
      const box = game.player.box(cp.pos);
      expect(game.world.isFree(box, null, true), `${cp.id} is inside something`).toBe(true);
      const head = { min: { ...box.min, y: box.max.y }, max: { ...box.max, y: box.max.y + 0.4 } };
      expect(game.world.isFree(head, null, true), `${cp.id} has no headroom`).toBe(true);
      expect(game.world.groundBelow(box, 0.1, true), `${cp.id} has no ground`).toBeTruthy();
      const s = segmentAt(segs, cp.pos.x, cp.pos.y)!;
      expect(s, `${cp.id} not on a lane surface`).toBeTruthy();
      expect(reached.has(s.id), `${cp.id} unreachable`).toBe(true);
      expect(toGoal.has(s.id), `${cp.id} is a dead end`).toBe(true);
    }
  });

  it('every bit on the lane can be collected from a surface the route reaches', () => {
    const { game, segs } = world2d();
    const edges = laneEdges(segs, env);
    const start = segmentAt(segs, game.level.spawn.x, game.level.spawn.y)!;
    const reached = search(edges, start.id);
    const missing: string[] = [];
    for (const b of game.level.bits.filter((b) => b.pos.z === 0)) {
      const ok = segs.some((s) => reached.has(s.id) && arcReaches(env, s, b.pos.x, b.pos.y, 0.7));
      if (!ok) missing.push(`${b.id} at ${b.pos.x}, ${b.pos.y}`);
    }
    expect(missing).toEqual([]);
  });

  /** Steer toward a point with camera-relative input, jumping when asked; true once the bit is collected. */
  function collect3d(start: { x: number; y: number; z: number }, path: { x: number; z: number; jump?: boolean }[], bit: string) {
    const input = new ScriptedInput();
    const game = new Game(input, { ...newSave(), ...FINAL, checkpoint: 'seal' });
    game.shift.set('3d');
    game.player.teleport(start);
    run(game, 0.3);
    const b = game.bits.find((x) => x.id === bit)!;
    for (const p of path) {
      if (p.jump) input.press('jump');
      runUntil(
        game,
        (g) => b.collected || Math.hypot(g.player.pos.x - p.x, g.player.pos.z - p.z) < 0.25,
        4,
        (g) => {
          const dx = p.x - g.player.pos.x;
          const dz = p.z - g.player.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          const fx = -Math.sin(g.camera.yaw);
          const fz = -Math.cos(g.camera.yaw);
          input.x = (dx / d) * -fz + (dz / d) * fx;
          input.y = (dx / d) * fx + (dz / d) * fz;
        },
      );
      input.release('jump');
      if (b.collected) break;
    }
    return b.collected;
  }

  it('the 3D-only secrets around the Update Wave can be collected', () => {
    // in the meadow in front of the Stalled Gate
    expect(collect3d({ x: 207, y: 12.6, z: 1.5 }, [{ x: 209, z: 3.6 }, { x: 210.2, z: 4.6 }], 'c7')).toBe(true);
    // behind the far bridgehead
    expect(collect3d({ x: 229, y: 12.6, z: 0 }, [{ x: 228.6, z: -2.6 }, { x: 228.2, z: -4.6 }], 'c8')).toBe(true);
  });

  it('the lamp alcove secrets can be collected in 3D', () => {
    expect(collect3d({ x: 104, y: 0.1, z: 1.5 }, [{ x: 102, z: 6 }, { x: 101.2, z: 7.6 }], 'c5')).toBe(true);
    expect(collect3d({ x: 108, y: 0.1, z: 1.5 }, [{ x: 110, z: 6 }, { x: 110.8, z: 7.6 }], 'c6')).toBe(true);
  });
});
