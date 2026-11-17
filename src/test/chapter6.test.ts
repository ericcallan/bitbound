import { describe, expect, it } from 'vitest';
import { Game } from '../game/sim/Game';
import { ScriptedInput, makeGame, run, runUntil } from './helpers';
import { newSave, type SaveData } from '../game/save/save';
import { STEP, SHIFT_DURATION } from '../game/sim/constants';
import { RELIEFS } from '../game/level/meadows';
import { v3 } from '../game/math';
import type { Era } from '../game/era/EraSystem';

const HALO: Partial<SaveData> = {
  awakened: true, shardTaken: true, era: 5, shiftUnlocked: true, firstShiftDone: true, bridgeRepaired: true,
  beaconLit: true, stairRepaired: true, gatePassed: true, regress: true,
};
const halo = (extra: Partial<SaveData> = {}) => {
  const input = new ScriptedInput();
  const game = new Game(input, { ...newSave(), ...HALO, ...extra });
  return { game, input };
};
const bubble = (g: Game, era: Era | null) => g.applyRegress(era);
const free = (g: Game, x: number, y: number, z = 0) => g.world.isFree(g.player.box(v3(x, y, z)));

describe('Regress basics', () => {
  it('the plateau light fence exists from 16-bit up and an 8-bit bubble walks through it', () => {
    const { game } = makeGame({ ...HALO, era: 4, gatePassed: false, checkpoint: 'plateau' });
    run(game, 0.2);
    const x = game.level.fenceX;
    game.player.teleport({ x: x - 0.9, y: 9, z: 0 });
    run(game, 0.2);
    expect(free(game, x, 9)).toBe(false);
    expect(bubble(game, 0)).toBe(true);
    expect(free(game, x, 9)).toBe(true);
  });

  it('dropping the bubble is refused while standing inside the fence', () => {
    const { game } = makeGame({ ...HALO, era: 4, gatePassed: false, checkpoint: 'plateau' });
    run(game, 0.2);
    bubble(game, 0);
    game.player.teleport({ x: game.level.fenceX, y: 9, z: 0 });
    run(game, 0.2);
    expect(bubble(game, null)).toBe(false);
    expect(game.era.bubble?.era).toBe(0);
  });

  it('Regress does nothing before the beacon unlocks it', () => {
    const { game, input } = makeGame({ awakened: true });
    run(game, 0.2);
    input.press('regress');
    run(game, 0.1);
    input.release('regress');
    run(game, 0.1);
    expect(game.era.bubble).toBeNull();
  });

  it('the Q wheel: hold, pick a generation, release; tap toggles it off', () => {
    const { game, input } = halo({ checkpoint: 'halo' });
    run(game, 0.2);
    input.press('regress');
    run(game, STEP * 3);
    input.press('era2');
    run(game, STEP * 3);
    input.release('regress');
    run(game, STEP * 3);
    expect(game.era.bubble?.era).toBe(1);
    input.press('regress');
    run(game, STEP * 2);
    input.release('regress');
    run(game, STEP * 2);
    expect(game.era.bubble).toBeNull();
  });
});

describe('The Halo Path (Chapter 6)', () => {
  it('the second light fence blocks the path until an 8-bit bubble', () => {
    const { game } = halo({ checkpoint: 'halo' });
    run(game, 0.2);
    const x = game.level.beamX;
    game.player.teleport({ x: x - 1.2, y: 9, z: 0 });
    run(game, 0.2);
    expect(free(game, x, 9)).toBe(false);
    bubble(game, 0);
    expect(free(game, x, 9)).toBe(true);
  });

  it('brambles are a foreground layer in 16-bit: walk behind them', () => {
    const { game } = halo({ checkpoint: 'thicket' });
    run(game, 0.2);
    const x = game.level.thicketX;
    game.player.teleport({ x: x - 1.6, y: game.level.haloY, z: 0 });
    run(game, 0.2);
    expect(free(game, x, game.level.haloY)).toBe(false);
    // 8-bit doesn't help here: only the 16-bit layer rule does.
    bubble(game, 0);
    expect(free(game, x, game.level.haloY)).toBe(false);
    bubble(game, 1);
    expect(free(game, x, game.level.haloY)).toBe(true);
  });

  it('the cliff gap is too wide to jump, and the carved holds are only solid in a Stylized bubble', () => {
    const { game } = halo({ checkpoint: 'relief' });
    const gap = game.level.reliefGap;
    expect(gap.x1 - gap.x0).toBeGreaterThan(8);
    run(game, 0.2);
    const r = RELIEFS[0];
    const hold = game.world.get('relief0')!;
    game.player.teleport({ x: gap.x0 - 0.5, y: game.level.haloY, z: 0 });
    run(game, 0.2);
    expect(game.world.active(hold)).toBe(false);
    bubble(game, 3);
    expect(game.world.active(hold)).toBe(true);
    // stand on it
    game.player.teleport({ x: (r.x0 + r.x1) / 2, y: r.top + 0.2, z: 0 });
    runUntil(game, (g) => g.player.grounded, 1);
    expect(game.player.ground?.id).toBe('relief0');
  });

  it('the glyph stone sleeps at 16-bit; full detail beside it reads it and opens the seal', () => {
    const { game } = halo({ checkpoint: 'seal' });
    run(game, 0.2);
    const gs = game.level.glyphStone;
    expect(game.era.gameEraAt(v3(gs.x, gs.y + 1, gs.z))).toBe(1);
    expect(game.world.get('sealDoor')!.enabled).toBe(true);
    game.player.teleport({ x: gs.x, y: gs.y, z: 0 });
    run(game, 0.3);
    expect(game.save.glyphsRead).toBe(false);
    expect(bubble(game, 5)).toBe(true);
    runUntil(game, (g) => !g.cine && g.save.glyphsRead, 8);
    expect(game.save.glyphsRead).toBe(true);
    expect(game.world.get('sealDoor')!.enabled).toBe(false);
  });

  it('the broken aqueduct only joins up in 2D, and you cannot unfold halfway across', () => {
    const { game } = halo({ checkpoint: 'seal', glyphsRead: true });
    run(game, 0.2);
    const aq = game.level.aqueduct;
    const mid = (aq.x0 + aq.x1) / 2;
    // In 2D the lane walkway is solid.
    game.player.teleport({ x: mid, y: aq.y + 0.3, z: 0 });
    runUntil(game, (g) => g.player.grounded, 1);
    expect(game.player.ground?.id).toBe('aqLane');
    expect(game.requestShift()).toBe('painted');
    // In 3D there's nothing on the lane between the two offset halves.
    game.player.teleport({ x: aq.x0 - 2, y: aq.y, z: 0 });
    run(game, 0.3);
    game.requestShift();
    run(game, SHIFT_DURATION + 0.1);
    expect(game.shift.mode).toBe('3d');
    expect(game.world.groundBelow(game.player.box(v3(mid, aq.y, 0)), 2)).toBeFalsy();
  });

  it('reaching the world wheel ends the story and unlocks every generation', () => {
    const { game } = halo({ checkpoint: 'summit', glyphsRead: true });
    run(game, 0.2);
    game.player.teleport({ x: game.level.summitX + 0.5, y: game.level.sealY, z: 0 });
    const ok = runUntil(game, (g) => g.finaleCard, 60, (g) => g.advanceDialogue());
    expect(ok).toBe(true);
    expect(game.save.finished).toBe(true);
    expect(game.save.eraKeys).toBe(true);
    expect(game.events.some((e) => e.type === 'wheel')).toBe(true);
  });
});
