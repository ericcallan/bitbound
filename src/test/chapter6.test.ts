import { describe, expect, it } from 'vitest';
import { Game } from '../game/sim/Game';
import { ScriptedInput, makeGame, run, runUntil } from './helpers';
import { newSave, type SaveData } from '../game/save/save';
import { STEP, SHIFT_DURATION } from '../game/sim/constants';
import { AQUEDUCT, PLATES, RELIEFS, WAVE } from '../game/level/meadows';
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

  it('the Update Wave: the aqueduct span is too wide to jump, and exists only where the wave (Early 3D) is', () => {
    const { game } = halo({ checkpoint: 'wave', glyphsRead: true });
    run(game, 0.2);
    // the gap between the stubs is beyond Pip's measured running jump (5.34 at the same height)
    expect(AQUEDUCT.gap1 - AQUEDUCT.gap0).toBeGreaterThan(6.5);
    const spans = Array.from({ length: 7 }, (_, i) => game.world.get(`span${i}`)!);
    // as the wave sweeps, only the pieces it covers are solid
    for (let k = 0; k < 40; k++) {
      run(game, 0.2);
      const f = game.waveField;
      for (const c of spans) {
        const covered = c.max.x > f.min.x && c.min.x < f.max.x;
        expect(game.world.active(c), `${c.id} at wave ${game.waveX.toFixed(2)}`).toBe(covered);
      }
    }
    // it travels the whole gap, both ways
    const xs: number[] = [];
    runUntil(game, () => (xs.push(game.waveX), false), 20);
    expect(Math.min(...xs)).toBeCloseTo(WAVE.c0, 3);
    expect(Math.max(...xs)).toBeCloseTo(WAVE.c1, 3);
  });

  it('riding the wave crosses the canyon; standing still on the span drops you', () => {
    const { game, input } = halo({ checkpoint: 'wave', glyphsRead: true });
    game.player.teleport({ x: AQUEDUCT.gap0 - 0.6, y: AQUEDUCT.y, z: 0 });
    // wait for the wave to sit at the near bridgehead, then walk along with it
    runUntil(game, () => game.waveX === WAVE.c0, 10);
    const crossed = runUntil(game, (g) => g.player.pos.x > AQUEDUCT.gap1 + 0.6 && g.player.grounded, 12, (g) => {
      // keep pace with the wave; once on the far stub, walk on
      input.x = g.player.pos.x > AQUEDUCT.gap1 || g.player.pos.x < g.waveX + 0.6 ? 1 : 0;
    });
    input.x = 0;
    expect(crossed).toBe(true);
    // stand still mid-span: the wave moves on and the bridge goes with it
    const b = halo({ checkpoint: 'wave', glyphsRead: true });
    b.game.player.teleport({ x: AQUEDUCT.gap0 - 0.6, y: AQUEDUCT.y, z: 0 });
    runUntil(b.game, () => b.game.waveX === WAVE.c0, 10);
    runUntil(b.game, (g) => g.player.pos.x > AQUEDUCT.gap0 + 1.5, 4, () => (b.input.x = 1));
    b.input.x = 0;
    const fell = runUntil(b.game, (g) => g.events.some((e) => e.type === 'respawn'), 12);
    expect(fell).toBe(true);
  });

  it('Rollback is refused over the canyon, and a bubble carried into it is dropped', () => {
    const { game } = halo({ checkpoint: 'wave', glyphsRead: true });
    run(game, 0.2);
    game.player.teleport({ x: AQUEDUCT.x0 - 1.5, y: AQUEDUCT.y, z: 0 });
    run(game, 0.2);
    expect(bubble(game, 2)).toBe(true);
    game.player.teleport({ x: AQUEDUCT.x0 + 1, y: AQUEDUCT.y, z: 0 });
    run(game, 0.2);
    expect(game.era.bubble).toBeNull();
    expect(bubble(game, 2)).toBe(false);
  });

  it('the world wheel: each plate installs only in its own generation; all six turn the wheel and end the story', () => {
    const { game } = halo({ checkpoint: 'summit', glyphsRead: true });
    run(game, 0.2);
    for (const pl of PLATES) {
      game.player.teleport({ x: pl.x, y: game.level.sealY, z: 0 });
      run(game, 0.3);
      if (pl.era !== 5) {
        // the wrong generation installs nothing
        expect(game.save.installed & (1 << pl.era)).toBe(0);
        expect(bubble(game, pl.era)).toBe(true);
        run(game, 0.3);
      }
      expect(game.save.installed & (1 << pl.era), `plate ${pl.era + 1}.0`).not.toBe(0);
      if (pl.era !== 5) bubble(game, null);
      if (pl.era < 5) expect(game.save.finished).toBe(false);
    }
    expect(game.save.installed).toBe(63);
    const ok = runUntil(game, (g) => g.finaleCard, 60, (g) => g.advanceDialogue());
    expect(ok).toBe(true);
    expect(game.save.finished).toBe(true);
    expect(game.save.eraKeys).toBe(true);
    expect(game.events.filter((e) => e.type === 'install').length).toBe(6);
    expect(game.events.some((e) => e.type === 'wheel')).toBe(true);
  });
});
