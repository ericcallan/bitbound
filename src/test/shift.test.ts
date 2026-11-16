import { describe, expect, it } from 'vitest';
import { makeGame, run, runUntil } from './helpers';
import { SHIFT_DURATION } from '../game/sim/constants';

const unlocked = { awakened: true, shardTaken: true, shiftUnlocked: true, firstShiftDone: true, era: 2 as const, checkpoint: 'device' };

describe('dimension shift', () => {
  it('is refused while locked', () => {
    const { game } = makeGame();
    run(game, 0.3);
    expect(game.requestShift()).toBe('locked');
    expect(game.shift.mode).toBe('2d');
  });

  it('2D -> 3D -> 2D round trip keeps Pip grounded and in place', () => {
    const { game } = makeGame(unlocked);
    run(game, 0.3);
    const before = { ...game.player.pos };
    expect(game.requestShift()).toBeNull();
    run(game, SHIFT_DURATION + 0.1);
    expect(game.shift.mode).toBe('3d');
    expect(game.shift.blend).toBe(1);
    expect(game.player.pos.x).toBeCloseTo(before.x, 5);
    expect(game.player.grounded).toBe(true);
    expect(game.requestShift()).toBeNull();
    run(game, SHIFT_DURATION + 0.1);
    expect(game.shift.mode).toBe('2d');
    expect(game.player.pos.z).toBe(0);
    expect(game.player.grounded).toBe(true);
  });

  it('refuses mid-air', () => {
    const { game, input } = makeGame(unlocked);
    run(game, 0.3);
    input.press('jump');
    run(game, 0.1);
    expect(game.requestShift()).toBe('airborne');
  });

  it('refuses to flatten when far from the lane, eases depth back when close', () => {
    const { game } = makeGame(unlocked);
    run(game, 0.3);
    game.requestShift();
    run(game, SHIFT_DURATION + 0.1);
    game.player.teleport({ x: 57, y: 0, z: -2 });
    run(game, 0.2);
    expect(game.requestShift()).toBe('off-lane');
    game.player.teleport({ x: 57, y: 0, z: -0.5 });
    run(game, 0.2);
    expect(game.requestShift()).toBeNull();
    run(game, SHIFT_DURATION * 0.5);
    expect(game.player.pos.z).toBeGreaterThan(-0.5);
    expect(game.player.pos.z).toBeLessThan(0);
    run(game, SHIFT_DURATION);
    expect(game.player.pos.z).toBe(0);
    expect(game.world.isFree(game.player.box())).toBe(true);
  });

  it('refuses to flatten onto the lane over the broken bridge', () => {
    const { game } = makeGame(unlocked);
    run(game, 0.3);
    game.requestShift();
    run(game, SHIFT_DURATION + 0.1);
    // Standing on the device pedestal (off-lane) is fine; over the gap there's no lane ground.
    game.player.teleport({ x: 67, y: 3, z: 0 });
    game.player.grounded = true;
    expect(game.shift.check()).toBe('no-ground');
  });

  it('never ends a shift inside a collider anywhere along the lane', () => {
    const { game } = makeGame(unlocked);
    for (let x = -6; x < 96; x += 0.5) {
      game.shift.set('3d');
      game.player.teleport({ x, y: 4, z: 0.4 });
      runUntil(game, (g) => g.player.grounded || g.player.pos.y < -5, 2);
      if (!game.player.grounded) continue;
      if (game.requestShift() === null) {
        run(game, SHIFT_DURATION + 0.05);
        expect(game.world.isFree(game.player.box())).toBe(true);
      }
    }
  });

  it('first shift upgrades the world to the modern era', () => {
    const { game } = makeGame({ ...unlocked, firstShiftDone: false, era: 1 });
    run(game, 0.3);
    game.requestShift();
    runUntil(game, (g) => g.era.era === 2 && !g.era.transition, 5);
    expect(game.era.era).toBe(2);
    expect(game.save.firstShiftDone).toBe(true);
  });
});
