import { describe, expect, it } from 'vitest';
import { Game } from '../game/sim/Game';
import { ScriptedInput, makeGame, run, runUntil } from './helpers';
import { newSave, migrateV2, type SaveData } from '../game/save/save';
import { STEP, SHIFT_DURATION } from '../game/sim/constants';
import { WEAPON, viewRange } from '../game/combat/combat';
import { v3 } from '../game/math';
import type { Era } from '../game/era/EraSystem';

const CITY: Partial<SaveData> = {
  awakened: true, shardTaken: true, era: 5, shiftUnlocked: true, firstShiftDone: true, bridgeRepaired: true,
  beaconLit: true, stairRepaired: true, gatePassed: true, regress: true, vergeEntered: true, zone: 'verge', emitter: true,
};
const city = (extra: Partial<SaveData> = {}) => {
  const input = new ScriptedInput();
  const game = new Game(input, { ...newSave(), ...CITY, ...extra });
  return { game, input };
};
const bubble = (g: Game, era: Era | null) => g.applyRegress(era);
const free = (g: Game, x: number, y: number, z: number) => g.world.isFree(g.player.box(v3(x, y, z)));

describe('Regress and generation masks', () => {
  it('the plateau fence exists from 16-bit up and an 8-bit bubble walks through it', () => {
    const { game } = makeGame({ awakened: true, regress: true, era: 4, checkpoint: 'plateau', beaconLit: true, stairRepaired: true, shiftUnlocked: true, firstShiftDone: true, bridgeRepaired: true, shardTaken: true });
    run(game, 0.2);
    const x = game.level.fenceX;
    game.player.teleport({ x: x - 0.9, y: 9, z: 0 });
    run(game, 0.2);
    expect(free(game, x, 9, 0)).toBe(false);
    expect(bubble(game, 0)).toBe(true);
    expect(free(game, x, 9, 0)).toBe(true);
  });

  it('dropping the bubble is refused while standing inside the fence', () => {
    const { game } = makeGame({ awakened: true, regress: true, era: 4, checkpoint: 'plateau', beaconLit: true, stairRepaired: true, shiftUnlocked: true, firstShiftDone: true, bridgeRepaired: true, shardTaken: true });
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

  it('the Q wheel: hold, pick a generation, release', () => {
    const { game, input } = city({ checkpoint: 'street' });
    run(game, 0.2);
    input.press('regress');
    run(game, STEP * 3);
    input.press('era2');
    run(game, STEP * 3);
    input.release('regress');
    run(game, STEP * 3);
    expect(game.era.bubble?.era).toBe(1);
    // tap toggles it off
    input.press('regress');
    run(game, STEP * 2);
    input.release('regress');
    run(game, STEP * 2);
    expect(game.era.bubble).toBeNull();
  });

  it('16-bit: the glass advert is foreground art you can pass behind', () => {
    const { game } = city({ checkpoint: 'street' });
    run(game, 0.2);
    expect(free(game, 1058.5, 0, -7.2)).toBe(false);
    game.player.teleport({ x: 1058.5, y: 0, z: -6 });
    bubble(game, 1);
    expect(free(game, 1058.5, 0, -7.2)).toBe(true);
  });

  it('stylized: graffiti footholds are only solid where painted things are real', () => {
    const { game } = city({ checkpoint: 'street' });
    const g1 = game.world.get('graffiti1')!;
    expect(game.world.active(g1)).toBe(false);
    game.player.teleport({ x: 1064, y: 0, z: 5.5 });
    bubble(game, 3);
    expect(game.world.active(g1)).toBe(true);
  });

  it('8-bit: turrets and lasers were never invented; enemy bolts entering 8-bit cease to exist', () => {
    const { game } = city({ checkpoint: 'street' });
    run(game, 0.2);
    game.combat.wake('market');
    const t1 = game.combat.hostiles.find((h) => h.def.id === 't2')!;
    game.player.teleport({ x: 1080.5, y: 0, z: -2.8 });
    bubble(game, 0);
    run(game, 0.2);
    expect(t1.exists).toBe(false);
    expect(game.world.active(game.world.get('laserB')!)).toBe(false);
    // a bolt aimed at Pip fizzles at the bubble edge
    game.combat.projectiles.push({ pos: v3(1080.5, 1, 6), prev: v3(1080.5, 1, 6), vel: v3(0, 0, -20), owner: 'enemy', dmg: 1, ttl: 3, charged: false, alive: true });
    const cells = game.cells;
    run(game, 0.6);
    expect(game.cells).toBe(cells);
    expect(game.events.some((e) => e.type === 'combat' && e.combat === 'boltFizzle')).toBe(true);
  });

  it('early 3D: enemies cannot see past the draw distance', () => {
    expect(viewRange(2)).toBeLessThan(20);
    expect(viewRange(5)).toBe(Infinity);
  });

  it('full fidelity reads the censored door code', () => {
    const { game } = city({ checkpoint: 'plaza', shutterOpen: true });
    run(game, 0.2);
    game.player.teleport({ x: 1157.5, y: 15, z: -9.5 });
    run(game, 0.3);
    expect(game.save.codeRead).toBe(false);
    bubble(game, 5);
    run(game, 0.2);
    expect(game.save.codeRead).toBe(true);
  });
});

describe('Combat', () => {
  it('the emitter overheats after sustained fire, vents, then fires again', () => {
    const { game } = city({ checkpoint: 'street' });
    run(game, 0.2);
    let shots = 0;
    for (let i = 0; i < 400 && !game.combat.overheated; i++) {
      if (game.combat.fire(v3(1050, 1.3, 0), v3(1060, 1.3, 0))) shots++;
      game.fixedStep(STEP);
    }
    expect(game.combat.overheated).toBe(true);
    expect(shots).toBeGreaterThanOrEqual(Math.floor(1 / WEAPON.heatPerShot) - 1);
    expect(game.combat.fire(v3(1050, 1.3, 0), v3(1060, 1.3, 0))).toBe(false);
    run(game, WEAPON.ventTime + 0.1);
    expect(game.combat.overheated).toBe(false);
  });

  it('bolts destroy a Censor drone (3 hits)', () => {
    const { game } = city({ checkpoint: 'street' });
    const c = game.combat.hostiles.find((h) => h.def.id === 'c3')!;
    c.awake = false;
    for (let i = 0; i < 3; i++) {
      game.combat.fireCd = 0;
      game.combat.fire(v3(c.pos.x - 6, c.pos.y + 0.3, c.pos.z), c.center());
      run(game, 0.25);
    }
    expect(c.alive).toBe(false);
  });

  it('the emitter is offline inside 8-bit', () => {
    const { game, input } = city({ checkpoint: 'street' });
    run(game, 0.2);
    bubble(game, 0);
    input.press('fire');
    run(game, 0.3);
    expect(game.combat.projectiles.filter((p) => p.owner === 'pip').length).toBe(0);
  });

  it('Warden: shield in modern, exposed inside a 16-bit bubble, armoured phase only takes stomps', () => {
    const { game } = city({ checkpoint: 'door', codeRead: true });
    run(game, 0.2);
    const w = game.combat.hostiles.find((h) => h.kind === 'warden')!;
    w.awake = true;
    w.era = 5;
    expect(w.shielded).toBe(true);
    const hp = w.hp;
    game.combat.damage(w, 1, w.center(), (game as unknown as { combatCtx: never }).combatCtx);
    expect(w.hp).toBe(hp);
    w.era = 1;
    expect(w.shielded).toBe(false);
    w.hp = 15;
    expect(w.armored).toBe(true);
  });

  it('dash grants brief invulnerability', () => {
    const { game, input } = city({ checkpoint: 'street' });
    run(game, 0.2);
    input.press('dash');
    run(game, STEP * 2);
    expect(game.player.dashT).toBeGreaterThan(0);
    expect(game.invuln).toBeGreaterThan(0);
  });
});

describe('Zones and lanes', () => {
  it('the dome cracks at the overlook and Pip arrives grown-up on the roof', () => {
    const { game } = makeGame({ awakened: true, regress: true, era: 5, checkpoint: 'gate', beaconLit: true, stairRepaired: true, shiftUnlocked: true, firstShiftDone: true, bridgeRepaired: true, shardTaken: true, gatePassed: true });
    game.player.teleport({ x: game.level.finaleX + 0.5, y: 9, z: 0 });
    runUntil(game, (g) => g.zone === 'verge' && !g.cine, 20);
    expect(game.zone).toBe('verge');
    expect(game.player.form).toBe('adult');
    expect(game.player.h).toBeGreaterThan(1.5);
    expect(game.shift.mode).toBe('3d');
    expect(game.checkpoint).toBe('roof');
  });

  it('in the city you can only flatten onto the billboard lane, and you land on its plane', () => {
    const { game } = city({ checkpoint: 'shutter', shutterOpen: true });
    run(game, 0.3);
    expect(game.requestShift()).toBe('off-lane');
    game.player.teleport({ x: 1096.4, y: 0, z: -6.4 });
    run(game, 0.3);
    expect(game.requestShift()).toBeNull();
    run(game, SHIFT_DURATION + 0.1);
    expect(game.shift.mode).toBe('2d');
    expect(game.player.pos.z).toBeCloseTo(-6.2, 5);
  });

  it('v2 saves migrate to v3 at the overlook, with the city still ahead', () => {
    const v2 = { ...newSave(), version: 2, checkpoint: 'gate', era: 5, beaconLit: true, gatePassed: true, finished: true, eraKeys: true } as unknown as Record<string, unknown>;
    const m = migrateV2(v2);
    expect(m.version).toBe(3);
    expect(m.zone).toBe('meadows');
    expect(m.regress).toBe(true);
    expect(m.finished).toBe(false);
  });
});
