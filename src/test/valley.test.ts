import { describe, expect, it } from 'vitest';
import { makeGame, run, runUntil } from './helpers';
import { SHIFT_DURATION } from '../game/sim/constants';
import { GATES, GORGES, LANE_BACK, LANE_FRONT, valleyHeight, WATER_Y } from '../game/level/valley';
import { LEVEL } from '../game/level/meadows';
import type { Game } from '../game/sim/Game';

const ready = { awakened: true, shardTaken: true, shiftUnlocked: true, firstShiftDone: true, era: 4 as const, checkpoint: 'start', eraKeys: true };

function into3d(g: Game) {
  run(g, 0.3);
  g.requestShift();
  run(g, SHIFT_DURATION + 0.2);
  expect(g.shift.mode).toBe('3d');
}

/** Steer toward a world point with camera-relative input, like a player. */
function walkTo(g: Game, input: { x: number; y: number }, tx: number, tz: number, seconds: number) {
  runUntil(
    g,
    (gg) => Math.hypot(gg.player.pos.x - tx, gg.player.pos.z - tz) < 0.2,
    seconds,
    (gg) => {
      const dx = tx - gg.player.pos.x;
      const dz = tz - gg.player.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const yaw = gg.camera.yaw;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      input.x = (dx / d) * -fz + (dz / d) * fx;
      input.y = (dx / d) * fx + (dz / d) * fz;
    },
  );
  input.x = input.y = 0;
}

describe('The valley (immersive 3D terrain)', () => {
  it('matches the platform tops exactly on the lane, so 2D play is unchanged', () => {
    for (const x of [-6, 0, 5, 12.9, 18, 25, 33, 39.5, 42]) {
      for (const z of [LANE_BACK, 0, LANE_FRONT]) {
        const top = x < 14 ? 0 : x < 40 ? 1 : 0;
        expect(valleyHeight(x, z), `x=${x} z=${z}`).toBeCloseTo(top, 5);
      }
    }
  });

  it('pits are a gorge across the whole valley, deep enough that falling in still respawns', () => {
    for (const [a, b] of GORGES) for (const z of [-30, -6, 0, 6, 30]) expect(valleyHeight((a + b) / 2, z)).toBeLessThan(WATER_Y - 3);
  });

  it('in 3D Pip can walk off the path onto the meadow and back', () => {
    const { game, input } = makeGame(ready);
    into3d(game);
    walkTo(game, input, 4, 6, 6);
    const p = game.player;
    expect(p.pos.z).toBeGreaterThan(5);
    expect(p.grounded).toBe(true);
    expect(p.ground?.id).toBe('terrain');
    expect(p.pos.y).toBeCloseTo(game.world.terrainUnder(p.box())!, 3);
    walkTo(game, input, 4, 0, 6);
    expect(Math.abs(game.player.pos.z)).toBeLessThan(0.4);
    run(game, 0.3);
    expect(game.requestShift()).toBeNull();
  });

  it('walks up gentle rises behind the path but is stopped by the cliffs', () => {
    const { game, input } = makeGame(ready);
    into3d(game);
    // where Pip wakes the valley opens out, with the wall far back behind meadow hills
    walkTo(game, input, 4, -90, 28);
    const p = game.player;
    expect(p.pos.z).toBeLessThan(-20);
    expect(p.pos.z).toBeGreaterThan(-62);
    expect(p.pos.y).toBeLessThan(valleyHeight(p.pos.x, -66) - 2.5);
    expect(Number.isFinite(p.pos.y)).toBe(true);
  });

  it('wading into the shallow stream is fine; falling into the gorge respawns', () => {
    const { game } = makeGame(ready);
    into3d(game);
    const [a, b] = GORGES[0];
    game.player.teleport({ x: (a + b) / 2, y: 1, z: -8 });
    const died = runUntil(game, (g) => g.events.some((e) => e.type === 'respawn'), 4);
    expect(died).toBe(true);
  });

  it('along the whole level the terrain matches every ground section top exactly on the lane', () => {
    const grounds = LEVEL.solids.filter((s) => /^(g|p)\d$/.test(s.id));
    expect(grounds.length).toBeGreaterThan(10);
    for (const s of grounds) {
      for (const t of [0.05, 0.5, 0.95]) {
        const x = s.box.min.x + (s.box.max.x - s.box.min.x) * t;
        for (const z of [LANE_BACK, 0, Math.min(LANE_FRONT, s.box.max.z)]) {
          expect(valleyHeight(x, z), `${s.id} x=${x.toFixed(2)} z=${z}`).toBeCloseTo(s.box.max.y, 5);
        }
      }
    }
  });

  it('gates sit in rock ridges: nowhere off the lane is low enough to walk round them', () => {
    for (const [a, b] of GATES) {
      const x = (a + b) / 2;
      const top = valleyHeight(x, 0);
      for (const z of [-30, -12, -5, -3.6, 3.2, 6, 12, 18, 26]) {
        expect(valleyHeight(x, z), `gate ${a} z=${z}`).toBeGreaterThan(top + 3);
      }
    }
  });

  const raised = { ...ready, era: 4 as const, checkpoint: 'stair', stairRepaired: false };

  it('the plateau cannot be reached in 3D by walking round the Painted Stair', () => {
    const { game, input } = makeGame(raised);
    game.player.teleport({ x: 109, y: 0, z: 0 });
    into3d(game);
    for (const tz of [-8, 6, 14]) {
      walkTo(game, input, 109, tz, 5);
      walkTo(game, input, 116, tz, 5);
      expect(game.player.pos.x, `z=${tz}`).toBeLessThan(112.5);
      expect(game.player.pos.y).toBeLessThan(4);
    }
  });

  it('a light fence cannot be walked round in 3D', () => {
    const { game, input } = makeGame({ ...ready, era: 4 as const, checkpoint: 'plateau', stairRepaired: true });
    into3d(game);
    const [a] = GATES[0];
    for (const tz of [-7, 5]) {
      walkTo(game, input, a - 2, tz, 6);
      walkTo(game, input, a + 3, tz, 6);
      expect(game.player.pos.x, `z=${tz}`).toBeLessThan(a);
    }
  });

  it('the hidden chamber is still reached through depth in 3D', () => {
    const { game, input } = makeGame({ ...ready, checkpoint: 'device' });
    into3d(game);
    walkTo(game, input, 53.2, -2.0, 6);
    walkTo(game, input, 56, -7, 6);
    expect(game.player.pos.z).toBeLessThan(-5);
    expect(game.player.pos.y).toBeCloseTo(0, 2);
  });

  it('the 3D camera never goes underground', () => {
    const { game, input } = makeGame(ready);
    into3d(game);
    walkTo(game, input, 6, -12, 8);
    for (let i = 0; i < 40; i++) {
      game.input.takeOrbit = () => ({ yaw: 0.16, pitch: -0.05, active: true });
      run(game, 1 / 30);
      const c = game.camera.pos;
      expect(c.y).toBeGreaterThan(valleyHeight(c.x, c.z) + 0.3);
    }
  });
});
