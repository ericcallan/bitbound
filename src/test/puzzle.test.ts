import { describe, expect, it } from 'vitest';
import { makeGame, run, runUntil } from './helpers';
import { SHIFT_DURATION } from '../game/sim/constants';
import { loadSave } from '../game/save/save';

const at3D = { awakened: true, shardTaken: true, shiftUnlocked: true, firstShiftDone: true, era: 2 as const, checkpoint: 'device' };

describe('broken passage puzzle', () => {
  it('starts broken: the bridge middle is not solid', () => {
    const { game } = makeGame(at3D);
    expect(game.puzzle.state).toBe('broken');
    expect(game.world.get('bridgeMid')!.enabled).toBe(false);
  });

  it('the cube is unreachable in 2D (it lives behind the facade)', () => {
    const { game } = makeGame(at3D);
    const c = game.puzzle.cube;
    expect(c.max.z).toBeLessThan(-0.35);
  });

  it('pushing the cube onto the plate latches and repairs the bridge', () => {
    const { game, input } = makeGame(at3D);
    run(game, 0.3);
    game.requestShift();
    run(game, SHIFT_DURATION + 0.1);
    // Stand west of the cube and push it east (+x), then south of... use world-space input via camera.
    const cube = game.puzzle;
    game.player.teleport({ x: 54.7, y: 0, z: -6.2 });
    run(game, 0.2);
    const steer = (mx: number, mz: number) => {
      const yaw = game.camera.yaw;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      input.x = mx * -fz + mz * fx;
      input.y = mx * fx + mz * fz;
    };
    runUntil(game, () => cube.cubeCenter.x >= 58.15, 4, () => steer(1, 0));
    expect(cube.cubeCenter.x).toBeGreaterThan(58.1);
    input.x = input.y = 0;
    game.player.teleport({ x: 58.2, y: 0, z: -4.9 });
    run(game, 0.2);
    runUntil(game, () => cube.plateLatched, 4, () => steer(0, -1));
    expect(cube.plateLatched).toBe(true);
    runUntil(game, () => cube.state === 'repaired', 5);
    expect(game.world.get('bridgeMid')!.enabled).toBe(true);
  });

  it('the reset glyph returns the cube to its start', () => {
    const { game } = makeGame(at3D);
    run(game, 0.3);
    game.requestShift();
    run(game, SHIFT_DURATION + 0.1);
    const c = game.puzzle.cube;
    c.min.x += 2;
    c.max.x += 2;
    game.player.teleport({ ...game.level.resetGlyph });
    run(game, 0.3);
    expect(game.puzzle.cubeCenter.x).toBeCloseTo(game.level.cubeStart.x, 3);
  });

  it('save data without storage is a no-op (headless)', () => {
    expect(loadSave()).toBeNull();
  });
});
