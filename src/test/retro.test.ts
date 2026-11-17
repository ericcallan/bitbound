import { describe, expect, it } from 'vitest';
import { CLOUD_COLORS, GROUND_COLORS, groundBlock, isRetroTile, SKY_INDEX, TILE_PX } from '../game/render/retro/RetroLayer';
import { PALETTE_8 } from '../game/render/post/Pipeline';
import { BACKDROP, SPRITES } from '../game/render/sprites';
import { LEVEL } from '../game/level/meadows';

/** The 1985 rules for the 8-bit generation: one ground block, three colours per tile/sprite, palette only. */
describe('8-bit tile renderer', () => {
  it('has one 16×16 ground block in exactly three palette colours', () => {
    const b = groundBlock();
    expect(b.length).toBe(TILE_PX);
    for (const row of b) expect(row.length).toBe(TILE_PX);
    const used = new Set(b.flat());
    expect(used.size).toBe(3);
    expect([...used].sort()).toEqual([...GROUND_COLORS].sort());
    for (const k of used) expect(PALETTE_8[k]).toBeDefined();
  });

  it('uses palette colours for the sky and clouds', () => {
    expect(PALETTE_8[SKY_INDEX]).toBeDefined();
    for (const k of Object.values(CLOUD_COLORS)) expect(PALETTE_8[k]).toBeDefined();
    const chars = new Set(BACKDROP.cloud.join('').replace(/\./g, ''));
    for (const ch of chars) expect(ch in CLOUD_COLORS).toBe(true);
  });

  it('draws sprites as 16×16 frames in at most three colours (plus transparent)', () => {
    for (const [name, frames] of Object.entries(SPRITES)) {
      for (const f of frames) {
        expect(f.length, name).toBe(16);
        for (const row of f) expect(row.length, name).toBe(16);
        expect(new Set(f.join('').replace(/\./g, '')).size, name).toBeLessThanOrEqual(3);
      }
    }
    // Pip: idle, two walk frames, a jump frame.
    expect(SPRITES.pip.length).toBe(4);
  });

  it('turns the level ground into tiles, and only solids that exist in 8-bit', () => {
    const tiles = LEVEL.solids.filter(isRetroTile);
    expect(tiles.length).toBeGreaterThan(10);
    expect(tiles.some((s) => s.id === 'g1')).toBe(true);
    for (const s of tiles) {
      expect(s.look).not.toBe('invisible');
      if (s.genMask !== undefined) expect(s.genMask & 1).toBe(1);
    }
    for (const s of LEVEL.solids) if (s.genMask !== undefined && (s.genMask & 1) === 0) expect(isRetroTile(s)).toBe(false);
  });
});
