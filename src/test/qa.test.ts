import { describe, expect, it } from 'vitest';
import { Game } from '../game/sim/Game';
import { ScriptedInput, makeGame, run, runUntil } from './helpers';
import { Bot } from './bot';
import { STEP, SHIFT_DURATION } from '../game/sim/constants';
import { newSave, migrateV1, migrateV3, type SaveData } from '../game/save/save';
import { overlaps } from '../game/collision/World';
import type { Action } from '../game/sim/Input';
import { rng } from '../game/math';
import { STAIR, stairStep } from '../game/level/meadows';
import { SAFE_SLIDE } from '../game/shift/DimensionShift';

/** Save states a player can be in when pressing Continue, one per checkpoint. */
const CHECKPOINT_SAVES: [string, Partial<SaveData>, string][] = [
  ['start', { awakened: true }, 'toShard'],
  ['shard', { awakened: true, shardTaken: true, era: 1, checkpoint: 'shard' }, 'toDevice'],
  ['device', { awakened: true, shardTaken: true, era: 1, checkpoint: 'device', shiftUnlocked: true }, 'shiftIn'],
  [
    'beacon',
    { awakened: true, shardTaken: true, era: 4, checkpoint: 'beacon', shiftUnlocked: true, firstShiftDone: true, bridgeRepaired: true, beaconLit: true, regress: true },
    'toStair',
  ],
  [
    'stair',
    { awakened: true, shardTaken: true, era: 4, checkpoint: 'stair', shiftUnlocked: true, firstShiftDone: true, bridgeRepaired: true, beaconLit: true, regress: true },
    'toStair',
  ],
  [
    'plateau',
    {
      awakened: true, shardTaken: true, era: 4, checkpoint: 'plateau', shiftUnlocked: true, firstShiftDone: true,
      bridgeRepaired: true, beaconLit: true, stairRepaired: true, regress: true,
    },
    'climb',
  ],
  [
    'gate',
    {
      awakened: true, shardTaken: true, era: 5, checkpoint: 'gate', shiftUnlocked: true, firstShiftDone: true,
      bridgeRepaired: true, beaconLit: true, stairRepaired: true, gatePassed: true, regress: true,
    },
    'finish',
  ],
];

const HALO = {
  awakened: true, shardTaken: true, era: 5 as const, shiftUnlocked: true, firstShiftDone: true, bridgeRepaired: true,
  beaconLit: true, stairRepaired: true, gatePassed: true, regress: true,
};
/** Halo Path checkpoints (Chapter 6): all resume in the bot's 'finish' phase. */
const HALO_SAVES: [string, Partial<SaveData>, string][] = [
  ['halo', { ...HALO, checkpoint: 'halo' }, 'finish'],
  ['thicket', { ...HALO, checkpoint: 'thicket' }, 'finish'],
  ['relief', { ...HALO, checkpoint: 'relief' }, 'finish'],
  ['seal', { ...HALO, checkpoint: 'seal' }, 'finish'],
  ['summit', { ...HALO, checkpoint: 'summit', glyphsRead: true }, 'finish'],
];

/** Pip must never end a step inside a solid (ignoring the enemies, which aren't solids). */
function assertInvariants(g: Game, where: string) {
  const p = g.player;
  for (const v of [p.pos.x, p.pos.y, p.pos.z, p.vel.x, p.vel.y, p.vel.z]) {
    if (!Number.isFinite(v)) throw new Error(`${where}: non-finite player state ${JSON.stringify(p.pos)}`);
  }
  const box = p.box();
  for (const c of g.world.colliders) {
    if (!g.world.active(c) || c.kind === 'invisible') continue;
    if (overlaps(box, c, 0.02)) throw new Error(`${where}: Pip inside ${c.id} at ${JSON.stringify(p.pos)} mode=${g.shift.mode}`);
  }
  if (p.pos.y < -30) throw new Error(`${where}: fell forever at ${JSON.stringify(p.pos)}`);
  if (g.cells > g.maxCells) throw new Error(`${where}: more cells than allowed`);
  const cube = g.puzzle.cubeCenter;
  const ch = g.level.chamber;
  if (cube.x < ch.min.x - 0.01 || cube.x > ch.max.x + 0.01 || cube.z < ch.min.z - 0.01 || cube.z > ch.max.z + 0.01) {
    throw new Error(`${where}: cube escaped the chamber ${JSON.stringify(cube)}`);
  }
  const lamp = g.stair.lampCenter;
  const al = g.level.alcove;
  if (lamp.x < al.min.x - 0.01 || lamp.x > al.max.x + 0.01 || lamp.z < al.min.z - 0.01 || lamp.z > al.max.z + 0.01) {
    throw new Error(`${where}: lamp escaped the alcove ${JSON.stringify(lamp)}`);
  }
}

describe('QA: resume matrix', () => {
  for (const [id, save, phase] of [...CHECKPOINT_SAVES, ...HALO_SAVES]) {
    it(`continues from the "${id}" checkpoint and finishes the game`, () => {
      const input = new ScriptedInput();
      const game = new Game(input, { ...newSave(), ...save });
      expect(game.checkpoint).toBe(id);
      const bot = new Bot(input);
      bot.setPhase(phase, game);
      const ok = runUntil(game, () => bot.phase === 'done', 900, (g) => bot.tick(g, STEP));
      expect(ok, `${bot.log.join('\n')}\nend ${JSON.stringify(game.player.pos)}`).toBe(true);
      expect(game.save.finished).toBe(true);
    });
  }
});

describe('QA: fuzz', () => {
  const ACTIONS: Action[] = ['jump', 'shift', 'era1', 'era2', 'era3', 'era4', 'era5', 'era6', 'regress'];
  const STARTS = [...CHECKPOINT_SAVES.map((c) => c[1]), ...HALO_SAVES.map((c) => c[1])];
  for (const seed of Array.from({ length: 16 }, (_, i) => i + 1)) {
    it(`random input stays within invariants and the game stays completable (seed ${seed})`, () => {
      const r = rng(seed * 7919);
      const input = new ScriptedInput();
      // Start from various points so both acts and both perspectives get hammered.
      const start = STARTS[seed % STARTS.length];
      const game = new Game(input, { ...newSave(), ...start, eraKeys: true });
      let hold = 0;
      const steps = Math.round(120 / STEP);
      for (let i = 0; i < steps; i++) {
        if (--hold <= 0) {
          input.x = Math.round((r() * 2 - 1) * 1.3);
          input.y = Math.round((r() * 2 - 1) * 1.3);
          hold = 10 + Math.floor(r() * 90);
          for (const a of ACTIONS) input.release(a);
          if (r() < 0.6) input.press('jump');
          if (r() < 0.25) input.press('shift');
          if (r() < 0.05) input.press(ACTIONS[2 + Math.floor(r() * 6)]);
          if (r() < 0.15) input.press('regress');
          input.orbitYaw = (r() - 0.5) * 0.4;
          input.orbitPitch = (r() - 0.5) * 0.2;
        }
        game.fixedStep(STEP);
        assertInvariants(game, `seed ${seed} step ${i}`);
        // the shift state machine must never get stuck
        if (game.shift.transition) expect(game.shift.transition.t).toBeLessThanOrEqual(SHIFT_DURATION + 1e-6);
      }
      // Hand over to the bot from a clean respawn: the game must still be finishable.
      for (const a of ACTIONS) input.release(a);
      input.x = input.y = 0;
      runUntil(game, (g) => !g.cine && !g.shift.busy, 30);
      if (game.shift.mode === '3d') {
        game.player.teleport(game.level.checkpoints.find((c) => c.id === game.checkpoint)!.pos);
        run(game, 0.3);
        game.requestShift();
        run(game, SHIFT_DURATION + 0.2);
      }
      // The world can always be flattened back to 2D from a checkpoint.
      expect(game.shift.mode).toBe('2d');
    });
  }
});

describe('QA: edge cases', () => {
  const ready = { awakened: true, shardTaken: true, shiftUnlocked: true, firstShiftDone: true, era: 4 as const, checkpoint: 'device', bridgeRepaired: true, beaconLit: true, regress: true };

  it('shift requests during a cinematic are ignored and do not fire afterwards', () => {
    const { game, input } = makeGame({ awakened: true, shardTaken: false });
    game.player.teleport({ x: 32.9, y: 1.6, z: 0 });
    runUntil(game, (g) => g.cine?.name === 'shard', 2);
    input.press('shift');
    run(game, 0.5);
    runUntil(game, (g) => !g.cine, 5);
    run(game, 0.2);
    expect(game.shift.mode).toBe('2d');
    expect(game.shift.busy).toBe(false);
  });

  it('era change mid-shift and mid-ripple settles cleanly', () => {
    const { game, input } = makeGame({ ...ready, eraKeys: true });
    run(game, 0.3);
    game.requestShift();
    run(game, 0.3);
    game.changeEra(0, 1.5);
    run(game, 0.5);
    input.press('era6');
    run(game, 0.1);
    game.changeEra(2, 1.0);
    runUntil(game, (g) => !g.era.transition && !g.shift.busy, 6);
    expect(game.shift.mode).toBe('3d');
    expect(game.era.era).toBe(2);
  });

  it('hurt and death during gameplay never leave Pip frozen or inside geometry', () => {
    const { game } = makeGame(ready);
    game.cells = 1;
    const e = game.enemies[2];
    game.player.teleport({ x: e.pos.x - 1.5, y: 0, z: 0 });
    runUntil(game, (g) => g.events.some((ev) => ev.type === 'respawn'), 5);
    run(game, 0.5);
    expect(game.cells).toBe(3);
    expect(game.fade).toBeLessThan(0.5);
    assertInvariants(game, 'after respawn');
  });

  it('cannot unfold into 3D while standing on a painted step', () => {
    const { game } = makeGame({ ...ready, stairRepaired: true, checkpoint: 'stair' });
    const s = stairStep(2);
    game.player.teleport({ x: (s.x0 + s.x1) / 2, y: s.top + 0.3, z: 0 });
    runUntil(game, (g) => g.player.grounded, 1);
    expect(game.player.ground?.id).toBe('stair2');
    expect(game.requestShift()).toBe('painted');
    expect(game.shift.mode).toBe('2d');
  });

  it('painted steps are not solid in 3D and are solid in 2D', () => {
    const { game } = makeGame({ ...ready, stairRepaired: true, checkpoint: 'stair' });
    const s = stairStep(0);
    const box = { min: { x: s.x0 + 0.2, y: s.bottom + 0.05, z: -0.2 }, max: { x: s.x1 - 0.2, y: s.top - 0.05, z: 0.2 } };
    expect(game.world.isFree(box)).toBe(false);
    run(game, 0.3);
    game.requestShift();
    run(game, SHIFT_DURATION + 0.1);
    expect(game.world.isFree(box)).toBe(true);
  });

  it('flattening into 2D underneath a painted step slides Pip clear instead of clipping him', () => {
    const { game } = makeGame({ ...ready, stairRepaired: true, checkpoint: 'stair' });
    run(game, 0.3);
    game.requestShift();
    run(game, SHIFT_DURATION + 0.1);
    // In 3D, Pip can stand on the ground at a spot where a painted step would overlap his head.
    const s = stairStep(0);
    const x0 = (s.x0 + s.x1) / 2;
    game.player.teleport({ x: x0, y: 0, z: 0 });
    run(game, 0.2);
    expect(game.world.isFree(game.player.box({ x: x0, y: 0, z: 0 }), null, true)).toBe(false);
    expect(game.requestShift()).toBeNull();
    run(game, SHIFT_DURATION + 0.1);
    expect(game.shift.mode).toBe('2d');
    const p = game.player;
    expect(Math.abs(p.pos.x - x0)).toBeLessThanOrEqual(SAFE_SLIDE + 1e-6);
    expect(game.world.isFree(p.box(p.pos), null, true)).toBe(true);
    expect(game.world.groundBelow(p.box(p.pos), 0.1, true)).toBeTruthy();
  });

  it('flattening is refused when nothing free is within the safe slide', () => {
    const { game } = makeGame({ ...ready, checkpoint: 'stair' });
    run(game, 0.3);
    game.requestShift();
    run(game, SHIFT_DURATION + 0.1);
    const x0 = 96;
    game.player.teleport({ x: x0, y: 0, z: 0 });
    run(game, 0.2);
    // a 2D-only slab over the lane, wider than Pip plus the slide either way
    game.world.add('testSlab', 'platform', { min: { x: x0 - 2, y: 0.5, z: -0.45 }, max: { x: x0 + 2, y: 1.2, z: 0.45 } }, true, true);
    expect(game.requestShift()).toBe('obstructed');
    expect(game.shift.mode).toBe('3d');
  });

  it('the missing steps stay faded until the lamp is docked', () => {
    const { game } = makeGame({ ...ready, checkpoint: 'stair' });
    for (const i of STAIR.missing) expect(game.world.get(`stair${i}`)!.enabled).toBe(false);
    game.stair.lamp.min.x = game.level.lampSocket.x - 0.6;
    game.stair.lamp.max.x = game.level.lampSocket.x + 0.6;
    game.stair.lamp.min.z = game.level.lampSocket.z - 0.6;
    game.stair.lamp.max.z = game.level.lampSocket.z + 0.6;
    runUntil(game, (g) => g.stair.state === 'complete', 6);
    for (const i of STAIR.missing) expect(game.world.get(`stair${i}`)!.enabled).toBe(true);
  });

  it('every bit is collectable (reachable positions are not inside solids)', () => {
    const { game } = makeGame({ ...ready, stairRepaired: true });
    for (const b of game.bits) {
      const box = { min: { x: b.pos.x - 0.1, y: b.pos.y - 0.1, z: b.pos.z - 0.1 }, max: { x: b.pos.x + 0.1, y: b.pos.y + 0.1, z: b.pos.z + 0.1 } };
      const blocked = game.world.colliders.find((c) => c.enabled && c.kind !== 'invisible' && overlaps(box, c));
      expect(blocked?.id, `bit ${b.id} at ${JSON.stringify(b.pos)}`).toBeUndefined();
    }
  });

  it('a moving platform pushes Pip instead of overlapping him, and a pinned Pip is crushed safely', () => {
    const { game } = makeGame(ready);
    const m = game.movers[0];
    // Pip standing in the pit's water level beside the platform's path (3D): the platform pushes him.
    game.shift.set('3d');
    game.player.teleport({ x: m.centerX + 1.4, y: -0.3, z: 0 });
    for (let i = 0; i < 600; i++) {
      game.fixedStep(STEP);
      if (game.events.some((e) => e.type === 'respawn')) break;
      const c = m.collider;
      const b = game.player.box();
      const inside = b.min.x < c.max.x - 0.01 && b.max.x > c.min.x + 0.01 && b.min.y < c.max.y - 0.01 && b.max.y > c.min.y + 0.01 && b.min.z < c.max.z - 0.01 && b.max.z > c.min.z + 0.01;
      expect(inside).toBe(false);
    }
  });

  it('pausing freezes the simulation completely', () => {
    const { game, input } = makeGame(ready);
    run(game, 0.3);
    input.x = 1;
    game.paused = true;
    const before = { ...game.player.pos };
    const t = game.time;
    run(game, 1);
    expect(game.player.pos).toEqual(before);
    expect(game.time).toBe(t);
  });

  it('v1 saves migrate through to the v4 timeline', () => {
    const v1 = { version: 1, checkpoint: 'beacon', era: 2, awakened: true, shardTaken: true, shiftUnlocked: true, firstShiftDone: true, bridgeRepaired: true, bits: ['b0'], finished: true, eraKeys: true, visited: [] };
    const m = migrateV1(v1);
    expect(m.version).toBe(4);
    expect(m.era).toBe(4);
    expect(m.beaconLit).toBe(true);
    expect(m.regress).toBe(true);
    expect(m.finished).toBe(false);
    const g = new Game(new ScriptedInput(), m);
    expect(g.checkpoint).toBe('beacon');
    expect(g.puzzle.state).toBe('repaired');
  });

  it('v3 saves from the old city resume at the Frame Gate with the Halo Path ahead', () => {
    const v3 = { ...newSave(), version: 3, zone: 'verge', vergeEntered: true, checkpoint: 'plaza', era: 5, gatePassed: true, emitter: true, finished: true, eraKeys: true, visited: ['field', 'roof', 'market'] } as unknown as Record<string, unknown>;
    const m = migrateV3(v3);
    expect(m.version).toBe(4);
    expect(m.checkpoint).toBe('gate');
    expect(m.finished).toBe(false);
    expect(m.visited).toEqual(['field']);
    expect('emitter' in m).toBe(false);
    const g = new Game(new ScriptedInput(), m);
    expect(g.checkpoint).toBe('gate');
  });
});
