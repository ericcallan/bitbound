import { describe, expect, it } from 'vitest';
import { BUSH_COLORS, CLOUD_COLORS, HILL_COLORS, isRetroTile, laneLayer, SKY_INDEX, TILE_PX, TILES } from '../game/render/retro/RetroLayer';
import { PALETTE_8 } from '../game/render/post/Pipeline';
import { BACKDROP, SPRITES } from '../game/render/sprites';
import { LEVEL } from '../game/level/meadows';

/** The 1985 rules for the 8-bit generation: 16×16 tiles in three colours, flat two-colour scenery, palette only. */
describe('8-bit tile renderer', () => {
  it('draws every tile 16×16 in exactly three palette colours', () => {
    for (const [name, t] of Object.entries(TILES)) {
      expect(t.length, name).toBe(TILE_PX);
      for (const row of t) expect(row.length, name).toBe(TILE_PX);
      const used = new Set(t.flat());
      expect(used.size, name).toBe(3);
      for (const k of used) expect(PALETTE_8[k], `${name} colour ${k}`).toBeDefined();
    }
  });

  it('keeps the green landscape flat: hills and bushes in two palette colours each', () => {
    for (const set of [HILL_COLORS, BUSH_COLORS]) {
      expect(new Set(set).size).toBe(2);
      for (const k of set) expect(PALETTE_8[k]).toBeDefined();
    }
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
      expect(s.retroLook ?? s.look).not.toBe('invisible');
      if (s.genMask !== undefined) expect(s.genMask & 1).toBe(1);
    }
    for (const s of LEVEL.solids) if (s.genMask !== undefined && (s.genMask & 1) === 0) expect(isRetroTile(s)).toBe(false);
  });

  it('draws only the path as solid ground: structures behind it are background, nothing in front covers Pip', () => {
    const byId = new Map(LEVEL.solids.map((s) => [s.id, s]));
    // the hidden chamber and the ruin's facade stand behind the path: background, not ground
    for (const id of ['facade', 'chamberFloor', 'chamberBack', 'cliff', 'aqA']) expect(laneLayer(byId.get(id)!), id).toBe('back');
    // the device's pedestal, the alcove walls and the near aqueduct half are in front: not tiles at all
    for (const id of ['devicePedestal', 'alcoveFront', 'aqB']) expect(isRetroTile(byId.get(id)!), id).toBe(false);
    // the ground Pip walks on, and the aqueduct's 2D-only span, are foreground tiles
    for (const id of ['g4', 'aqLane', 'p6']) {
      expect(laneLayer(byId.get(id)!), id).toBe('lane');
      expect(isRetroTile(byId.get(id)!), id).toBe(true);
    }
  });
});
