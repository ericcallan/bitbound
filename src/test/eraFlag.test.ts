import { describe, expect, it } from 'vitest';
import { makeGame, run } from './helpers';
import { ERAS, generationFlag } from '../game/era/EraSystem';

/** Every switch of generation is flagged "Generation N (year): Title". */
describe('generation flag', () => {
  it('reads "Generation N (year): Title" for all six', () => {
    expect(ERAS.map(generationFlag)).toEqual([
      'Generation 1 (1985): 8-Bit',
      'Generation 2 (1991): 16-Bit',
      'Generation 3 (1996): Early 3D',
      'Generation 4 (2002): Stylized',
      'Generation 5 (2013): Modern HD',
      'Generation 6 (2026): Beyond',
    ]);
  });

  const ready = { awakened: true, shardTaken: true, shiftUnlocked: true, firstShiftDone: true, era: 4 as const, checkpoint: 'start', eraKeys: true };

  it('a hotkey switch raises the flag, with the generation in the banner', () => {
    const { game, input } = makeGame(ready);
    run(game, 0.3);
    input.press('era3');
    run(game, 0.1);
    expect(game.banner?.title).toBe('Generation 3 (1996): Early 3D');
    expect(game.banner?.era).toBe(2);
  });

  it('the Settings picker (changeEra) raises it too; a quick second switch replaces it', () => {
    const { game } = makeGame(ready);
    run(game, 0.3);
    game.changeEra(0, 1.8);
    expect(game.banner?.title).toBe('Generation 1 (1985): 8-Bit');
    run(game, 0.4);
    game.changeEra(5, 1.8);
    expect(game.banner?.title).toBe('Generation 6 (2026): Beyond');
  });

  it('switching to the generation already showing raises nothing', () => {
    const { game } = makeGame(ready);
    run(game, 0.3);
    game.changeEra(4, 1.8);
    expect(game.banner).toBeNull();
  });
});
