import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Game } from '../game/sim/Game';
import { ScriptedInput, run, runUntil } from './helpers';
import { newSave, type SaveData } from '../game/save/save';
import { SHIFT_DURATION } from '../game/sim/constants';
import { SAFE_SLIDE, SHIFT_BLOCK_LABEL, type ShiftBlock } from '../game/shift/DimensionShift';
import { v3 } from '../game/math';

const HALO: Partial<SaveData> = {
  awakened: true, shardTaken: true, era: 5, shiftUnlocked: true, firstShiftDone: true, bridgeRepaired: true,
  beaconLit: true, stairRepaired: true, gatePassed: true, regress: true, glyphsRead: true, checkpoint: 'seal',
};
const halo = () => {
  const input = new ScriptedInput();
  const game = new Game(input, { ...newSave(), ...HALO });
  const events: string[] = [];
  game.on((e) => events.push(e.type));
  return { game, input, events };
};

/** Screen x (NDC) of a world point through the game camera as it is now. */
function screenX(g: Game, p: THREE.Vector3) {
  const cam = new THREE.PerspectiveCamera(g.camera.fov, 16 / 9, 0.3, 900);
  cam.position.set(g.camera.pos.x, g.camera.pos.y, g.camera.pos.z);
  cam.lookAt(g.camera.target.x, g.camera.target.y, g.camera.target.z);
  cam.updateMatrixWorld();
  return p.clone().project(cam);
}

describe('Shift feedback and the 2D-only aqueduct', () => {
  it('every block reason has a short label for the HUD', () => {
    const reasons: ShiftBlock[] = ['locked', 'airborne', 'off-lane', 'obstructed', 'no-ground', 'painted', 'busy'];
    for (const r of reasons) expect(SHIFT_BLOCK_LABEL[r].length).toBeGreaterThan(3);
  });

  it('on the aqueduct the chip says why, and a refused unfold points at solid stone', () => {
    const { game, events } = halo();
    const aq = game.level.aqueduct;
    game.player.teleport({ x: (aq.x0 + aq.x1) / 2, y: aq.y + 0.3, z: 0 });
    runUntil(game, (g) => g.player.grounded, 1);
    expect(game.shiftStatus).toBe('blocked');
    expect(game.shiftBlock).toBe('painted');
    expect(game.requestShift()).toBe('painted');
    expect(events).toContain('shiftHint');
    const x = game.shift.nearestUnfold()!;
    expect(x).not.toBeNull();
    // the hinted spot really allows the unfold
    game.player.teleport({ x, y: aq.y, z: 0 });
    run(game, 0.3);
    expect(game.shiftBlock).toBeNull();
  });

  it('the 2D camera drops to deck height on the aqueduct, so the two halves meet on screen', () => {
    const { game } = halo();
    const aq = game.level.aqueduct;
    const near = game.world.get('aqB')!;
    const far = game.world.get('aqA')!;
    for (const x of [aq.x0 + 0.5, aq.x0 + 3, (aq.x0 + aq.x1) / 2, aq.x1 - 3, aq.x1 - 0.5]) {
      game.player.teleport({ x, y: aq.y + 0.3, z: 0 });
      game.camera.snap(game.cameraContext());
      run(game, 1.5);
      // eye at deck height (within a few centimetres)
      expect(Math.abs(game.camera.pos.y - aq.y)).toBeLessThan(0.08);
      // the top edges of both halves project to the same screen row
      const yFar = screenX(game, new THREE.Vector3(far.max.x - 0.5, aq.y, far.max.z)).y;
      const yNear = screenX(game, new THREE.Vector3(near.min.x + 0.5, aq.y, near.min.z)).y;
      expect(Math.abs(yFar - yNear)).toBeLessThan(0.01);
      // and the near half starts left of where the far half ends: no visible gap in the deck
      const endFar = screenX(game, new THREE.Vector3(far.max.x, aq.y, far.max.z)).x;
      const startNear = screenX(game, new THREE.Vector3(near.min.x, aq.y, near.max.z)).x;
      expect(startNear).toBeLessThanOrEqual(endFar + 1e-3);
    }
    // off the bridge the normal framing returns
    game.player.teleport({ x: 200, y: aq.y, z: 0 });
    run(game, 0.5);
    game.player.teleport({ x: 160, y: game.level.haloY + 0.3, z: 0 });
    run(game, 3);
    expect(game.camera.alignW).toBeLessThan(0.05);
  });

  it('in 3D the two halves stay apart: the overlap adds no way across', () => {
    const { game } = halo();
    const a = game.world.get('aqA')!;
    const b = game.world.get('aqB')!;
    expect(b.min.z - a.max.z).toBeGreaterThan(8);
    expect(game.world.get('aqLane')!.only2d).toBe(true);
  });

  it('repeated shifts back and forth on solid ground keep Pip on the lane and on the ground', () => {
    const { game } = halo();
    game.player.teleport({ x: 205, y: game.level.sealY, z: 0 });
    run(game, 0.3);
    for (let i = 0; i < 6; i++) {
      expect(game.requestShift()).toBeNull();
      run(game, SHIFT_DURATION + 0.15);
      expect(game.player.grounded).toBe(true);
      expect(game.world.isFree(game.player.box(game.player.pos))).toBe(true);
    }
    expect(game.shift.mode).toBe('2d');
    expect(game.player.pos.z).toBe(0);
  });

  it('a shift requested mid-air is refused and changes nothing', () => {
    const { game, input } = halo();
    game.player.teleport({ x: 205, y: game.level.sealY, z: 0 });
    run(game, 0.3);
    input.press('jump');
    run(game, 0.12);
    expect(game.player.grounded).toBe(false);
    const before = { ...game.player.pos };
    expect(game.requestShift()).toBe('airborne');
    expect(game.shift.mode).toBe('2d');
    expect(game.player.pos.z).toBe(before.z);
  });

  it('flattening from 3D slides at most SAFE_SLIDE along the lane and never over a pit', () => {
    const { game } = halo();
    // the plateau's first section ends at a pit (x 121) that has no bridge in 2D
    const p1 = game.world.get('p1')!;
    const y = p1.max.y;
    const x0 = p1.max.x - 0.5;
    game.player.teleport({ x: x0 - 4, y, z: 0 });
    run(game, 0.3);
    game.requestShift();
    run(game, SHIFT_DURATION + 0.1);
    expect(game.shift.mode).toBe('3d');
    // Pip near the lip; a 2D-only post overlaps the exact spot. Sliding toward the pit would leave his centre
    // over nothing, so the only valid slide is back along the lane.
    game.player.teleport({ x: x0, y, z: 0 });
    run(game, 0.3);
    game.world.add('testPost', 'wall', { min: { x: x0 - 0.1, y, z: -0.4 }, max: { x: x0 + 0.1, y: y + 2, z: 0.4 } }, true, true);
    expect(game.world.isFree(game.player.box(v3(x0, y, 0)), null, true)).toBe(false);
    expect(game.requestShift()).toBeNull();
    run(game, SHIFT_DURATION + 0.1);
    const p = game.player.pos;
    expect(p.x).toBeLessThan(x0);
    expect(x0 - p.x).toBeLessThanOrEqual(SAFE_SLIDE + 1e-6);
    expect(game.world.isFree(game.player.box(p), null, true)).toBe(true);
    expect(game.world.groundBelow(game.player.box(p), 0.12, true)).toBeTruthy();
  });
});
