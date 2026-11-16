import { describe, expect, it } from 'vitest';
import { makeGame, run, runUntil } from './helpers';
import { PHYS, STEP } from '../game/sim/constants';

describe('character controller', () => {
  it('lands and stands on the ground at spawn', () => {
    const { game } = makeGame();
    run(game, 0.5);
    expect(game.player.grounded).toBe(true);
    expect(game.player.pos.y).toBeCloseTo(0, 3);
  });

  it('accelerates to full run speed quickly and brakes quickly', () => {
    const { game, input } = makeGame();
    run(game, 0.3);
    input.x = 1;
    run(game, 0.2);
    expect(game.player.vel.x).toBeCloseTo(PHYS.runSpeed, 1);
    input.x = 0;
    run(game, 0.15);
    expect(Math.abs(game.player.vel.x)).toBeLessThan(0.01);
  });

  it('full jump clears ~2.5 units, a tap jump is much lower', () => {
    const peak = (hold: boolean) => {
      const { game, input } = makeGame();
      run(game, 0.3);
      input.press('jump');
      let max = 0;
      run(game, 0.05);
      if (!hold) input.release('jump');
      run(game, 1, (g) => (max = Math.max(max, g.player.pos.y)));
      return max;
    };
    const full = peak(true);
    const tap = peak(false);
    expect(full).toBeGreaterThan(2.3);
    expect(full).toBeLessThan(3.1);
    expect(tap).toBeLessThan(full * 0.55);
  });

  it('cannot clear the broken bridge gap with a running jump', () => {
    // Max horizontal jump distance must be well under the 8-unit gap.
    const { game, input } = makeGame();
    game.player.teleport({ x: 0, y: 0, z: 0 });
    run(game, 0.3);
    input.x = 1;
    run(game, 0.5);
    const x0 = game.player.pos.x;
    input.press('jump');
    run(game, STEP * 2);
    runUntil(game, (g) => g.player.grounded, 2);
    expect(game.player.pos.x - x0).toBeLessThan(6);
  });

  it('coyote time allows a jump shortly after leaving a ledge', () => {
    const { game, input } = makeGame();
    game.player.teleport({ x: 13.5, y: 2, z: 0 });
    run(game, 0.3);
    input.x = 1;
    runUntil(game, (g) => !g.player.grounded, 1);
    run(game, 0.05);
    input.press('jump');
    run(game, STEP * 2);
    expect(game.player.vel.y).toBeGreaterThan(10);
  });

  it('buffers a jump pressed just before landing', () => {
    const { game, input } = makeGame();
    game.player.teleport({ x: 3, y: 1.0, z: 0 });
    runUntil(game, (g) => g.player.pos.y < 0.3, 1);
    input.press('jump');
    runUntil(game, (g) => g.player.vel.y > 0, 0.3);
    expect(game.player.vel.y).toBeGreaterThan(10);
  });

  it('stomping a glitchling defeats it and bounces Pip', () => {
    const { game } = makeGame();
    const e = game.enemies[0];
    game.player.teleport({ x: e.pos.x, y: e.pos.y + 2.2, z: 0 });
    runUntil(game, () => !e.alive, 1.5);
    expect(e.alive).toBe(false);
    expect(game.player.vel.y).toBeGreaterThan(5);
    expect(game.cells).toBe(3);
  });

  it('touching a glitchling from the side costs a cell', () => {
    const { game } = makeGame();
    const e = game.enemies[0];
    game.player.teleport({ x: e.pos.x - 2, y: e.pos.y, z: 0 });
    runUntil(game, () => game.cells < 3, 3);
    expect(game.cells).toBe(2);
  });

  it('falling into a pit respawns at the checkpoint', () => {
    const { game } = makeGame();
    game.player.teleport({ x: 15.5, y: 1, z: 0 });
    runUntil(game, (g) => g.events.some((e) => e.type === 'respawn'), 4);
    expect(game.player.pos.x).toBeCloseTo(2, 1);
  });
});

describe('story triggers', () => {
  it('a high jump over the shard plinth still collects the shard', () => {
    const { game, input } = makeGame();
    game.player.teleport({ x: 29.5, y: 1, z: 0 });
    run(game, 0.3);
    input.x = 1;
    runUntil(game, (g) => g.player.pos.x > 31.2, 2);
    input.press('jump');
    runUntil(game, (g) => g.save.shardTaken || g.player.pos.x > 35, 2);
    expect(game.save.shardTaken).toBe(true);
  });
});
