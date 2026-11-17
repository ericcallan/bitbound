import { describe, expect, it } from 'vitest';
import { SCRIPT, type LineId } from '../game/story/script';
import { CHAPTERS } from '../game/sim/Game';
import { ERA_TITLES } from '../game/era/EraSystem';

/** The story ("Patch Day"): the world speaks in patch notes, Pip answers; ARCHIVE is gone for good. */
describe('story script', () => {
  const lines = Object.values(SCRIPT).flat();

  it('only the patch notes, Pip and the system speak', () => {
    for (const l of lines) expect(['NOTES', 'PIP', 'SYSTEM']).toContain(l.s);
  });

  it('never mentions ARCHIVE', () => {
    for (const l of lines) expect(l.t).not.toMatch(/archive/i);
    for (const t of [...CHAPTERS, ...ERA_TITLES]) expect(t).not.toMatch(/archive/i);
  });

  it('keeps every story beat id, so saved progress (save.story) stays valid', () => {
    const ids: LineId[] = ['boot', 'holes', 'goodJob', 'shard', 'deadPixel', 'device', 'firstShift', 'chamber', 'inked', 'mural', 'stairDone', 'beacon', 'fence', 'fencePassed', 'reflection', 'halo', 'beam', 'thicket', 'thicketPassed', 'relief', 'sleeping', 'glyphs', 'aqueduct', 'summit', 'ending'];
    expect(Object.keys(SCRIPT).sort()).toEqual([...ids].sort());
  });

  it('each generation arrives as its patch, in order', () => {
    expect(SCRIPT.shard[0].t).toMatch(/^Patch 2\.0/);
    expect(SCRIPT.firstShift[0].t).toMatch(/^Patch 3\.0/);
    expect(SCRIPT.inked[0].t).toMatch(/^Patch 4\.0/);
    expect(SCRIPT.beacon[0].t).toMatch(/^Patch 5\.0/);
    expect(SCRIPT.reflection[1].t).toMatch(/^Patch 6\.0/);
  });

  it('8-bit lines are in capitals, as the first generation could only print', () => {
    for (const id of ['boot', 'holes', 'goodJob'] as LineId[]) for (const l of SCRIPT[id]) expect(l.t).toBe(l.t.toUpperCase());
  });
});
