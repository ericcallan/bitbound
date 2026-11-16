import { describe, expect, it } from 'vitest';
import { Game } from '../game/sim/Game';
import { ScriptedInput, runUntil } from './helpers';
import { Bot } from './bot';
import { STEP } from '../game/sim/constants';

describe('full game playthrough', () => {
  it('plays new game → meadow → dome → city → Warden → core → epilogue on one world instance', () => {
    const input = new ScriptedInput();
    const game = new Game(input, null);
    const bot = new Bot(input);
    const seen = new Set<string>();
    const eras: number[] = [];
    game.on((e) => {
      seen.add(e.type);
      if (e.type === 'eraStart') eras.push(e.value!);
    });

    const ok = runUntil(game, () => bot.phase === 'done', 900, (g) => bot.tick(g, STEP));
    const summary = `${bot.log.join('\n')}\nphase=${bot.phase} pos=${JSON.stringify(game.player.pos)} cells=${game.cells}`;
    expect(ok, summary).toBe(true);

    // Every beat of the slice happened.
    for (const t of ['assemble', 'jump', 'land', 'collect', 'stomp', 'shard', 'device', 'shiftStart', 'shiftEnd', 'plate', 'bridgeDone', 'lamp', 'stairDone', 'bubbleOn', 'bubbleOff', 'gate', 'domeCrack', 'zone', 'emitter', 'combat', 'shutter', 'codeRead', 'door', 'coreChoice', 'finale']) {
      expect(seen.has(t as never), `missing event ${t}\n${summary}`).toBe(true);
    }
    expect(game.puzzle.state).toBe('repaired');
    expect(game.stair.state).toBe('complete');
    // The epilogue plays back under the dome, in the very first generation, in the rain.
    expect(game.shift.mode).toBe('2d');
    expect(game.era.era).toBe(0);
    expect(game.save.vergeEntered).toBe(true);
    expect(game.save.wardenDown).toBe(true);
    expect(game.epilogue).toBe(true);
    // Every generation was visited along the way, in story order.
    expect(eras).toEqual([1, 2, 3, 4, 5]);
    expect(game.save.finished).toBe(true);
    // It should be a few minutes for a human; the bot is much quicker but still several beats long.
    expect(game.time).toBeGreaterThan(30);

    // Era changes are independent of perspective once unlocked.
    game.continueAfterFinale();
    input.press('era1');
    runUntil(game, (g) => g.era.era === 0 && !g.era.transition, 4);
    expect(game.era.era).toBe(0);
    input.press('era4');
    runUntil(game, (g) => g.era.era === 3 && !g.era.transition, 4);
    expect(game.era.era).toBe(3);
    input.press('era6');
    runUntil(game, (g) => g.era.era === 5 && !g.era.transition, 4);
    expect(game.era.era).toBe(5);
    // "Keep exploring" returns to the city as adult Pip.
    expect(game.zone).toBe('verge');
    expect(game.shift.mode).toBe('3d');
  });
});
