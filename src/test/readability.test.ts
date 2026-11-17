import { describe, expect, it } from 'vitest';
import { DECOR_FOOTPRINT, LEVEL } from '../game/level/meadows';
import { Glitchling } from '../game/entities/entities';

/**
 * Nothing in front of the path may hide Pip or an enemy: the 2D camera looks from +z, so any decor standing
 * between the lane and the camera covers whatever is behind it at that x.
 */
const IN_FRONT_Z = 0.9;
const ENEMY = new Glitchling({ id: 'probe', x: 0, y: 0, minX: 0, maxX: 0 });
/** Anything shorter than this is low ground cover that the enemy stays visible over. */
const COVER_H = ENEMY.h * 0.8;

const foreground = LEVEL.decor
  .filter((d) => d.pos.z > IN_FRONT_Z)
  .map((d) => {
    const s = d.scale ?? 1;
    const f = DECOR_FOOTPRINT[d.type];
    return { d, x0: d.pos.x - f.hw * s, x1: d.pos.x + f.hw * s, h: f.h * s };
  })
  .filter((f) => f.h > COVER_H);

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

describe('readability', () => {
  it('no foreground decor covers any part of an enemy patrol', () => {
    const hits: string[] = [];
    for (const e of LEVEL.enemies) {
      const e0 = e.minX - ENEMY.hw;
      const e1 = e.maxX + ENEMY.hw;
      for (const f of foreground) if (overlaps(f.x0, f.x1, e0, e1)) hits.push(`${f.d.type} at x=${f.d.pos.x} covers ${e.id} [${e.minX}, ${e.maxX}]`);
    }
    expect(hits).toEqual([]);
  });

  it('no foreground decor covers the spawn point or a checkpoint', () => {
    const points = [{ id: 'spawn', x: LEVEL.spawn.x }, ...LEVEL.checkpoints.map((c) => ({ id: c.id, x: c.pos.x }))];
    const hits: string[] = [];
    for (const p of points) {
      for (const f of foreground) if (overlaps(f.x0, f.x1, p.x - 0.6, p.x + 0.6)) hits.push(`${f.d.type} at x=${f.d.pos.x} covers ${p.id}`);
    }
    expect(hits).toEqual([]);
  });

  it('enemies start inside their patrol', () => {
    for (const e of LEVEL.enemies) {
      expect(e.x).toBeGreaterThanOrEqual(e.minX);
      expect(e.x).toBeLessThanOrEqual(e.maxX);
    }
  });
});
