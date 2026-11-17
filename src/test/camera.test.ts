import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Game } from '../game/sim/Game';
import { ScriptedInput, run } from './helpers';
import { newSave, type SaveData } from '../game/save/save';
import { valleyCollideHeight, GORGES } from '../game/level/valley';
import { v3, type V3 } from '../game/math';
import type { Collider } from '../game/collision/World';

const LATE: Partial<SaveData> = {
  awakened: true, shardTaken: true, era: 5, shiftUnlocked: true, firstShiftDone: true, bridgeRepaired: true,
  beaconLit: true, stairRepaired: true, gatePassed: true, regress: true, glyphsRead: true, checkpoint: 'start',
};

function game3d() {
  const input = new ScriptedInput();
  const game = new Game(input, { ...newSave(), ...LATE });
  game.era.riftsEnabled = false;
  game.shift.set('3d');
  return { game, input };
}

/** Same filter the game's camera uses: solid, visible geometry that doesn't fade for the camera. */
const solid = (g: Game) => (c: Collider) => g.blocksCamera(c);

/** Lowest clearance (camera to Pip's chest) above the terrain, sampled along the line of sight. */
function terrainClearance(a: V3, b: V3) {
  let worst = Infinity;
  for (let i = 1; i < 40; i++) {
    const t = i / 40;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const g = valleyCollideHeight(x, z);
    if (g !== null) worst = Math.min(worst, a.y + (b.y - a.y) * t - g);
  }
  return worst;
}

interface Spot {
  x: number;
  z: number;
  yaw: number;
}

/** Spots across the whole level, off and on the lane, with the camera orbited to four sides. */
function spots(): Spot[] {
  const out: Spot[] = [];
  for (let x = -4; x <= 250; x += 3) {
    if (GORGES.some(([a, b]) => x > a - 0.6 && x < b + 0.6)) continue;
    for (const z of [0, -3.5, 3.5])
      for (const yaw of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) out.push({ x, z, yaw });
  }
  return out;
}

function place(game: Game, s: Spot) {
  const gy = valleyCollideHeight(s.x, s.z);
  if (gy === null) return false;
  const pos = v3(s.x, gy + 0.02, s.z);
  // stand on whatever box is there too (lane ground, platforms)
  for (let k = 0; k < 40 && !game.world.isFree(game.player.box(pos)); k++) pos.y += 0.25;
  if (!game.world.isFree(game.player.box(pos))) return false;
  game.player.teleport(pos);
  game.player.vel.x = game.player.vel.y = game.player.vel.z = 0;
  return true;
}

describe('3D camera: collision, clearance and line of sight', () => {
  it('across the level and from four sides, the camera is never underground, inside a solid, or blind to Pip', () => {
    const { game } = game3d();
    const failures: string[] = [];
    let checked = 0;
    for (const s of spots()) {
      if (!place(game, s)) continue;
      game.camera.orbitYaw = s.yaw;
      game.camera.orbitPitch = 0;
      game.camera.snap(game.cameraContext());
      run(game, 1.6);
      if (!game.player.grounded) continue; // fell into a pit: not a standing spot
      checked++;
      const cam = game.camera.pos;
      const p = game.player.pos;
      // Pip counts as visible when his upper body is (low steps in front of his feet dissolve; see cutaway)
      const chest = v3(p.x, p.y + game.player.h * 0.8, p.z);
      const g = valleyCollideHeight(cam.x, cam.z);
      const tag = `x ${s.x} z ${s.z} yaw ${s.yaw.toFixed(2)}`;
      if (g !== null && cam.y < g + 0.2) failures.push(`${tag}: camera ${(g - cam.y).toFixed(2)} below ground`);
      const tiny = { min: v3(cam.x - 0.05, cam.y - 0.05, cam.z - 0.05), max: v3(cam.x + 0.05, cam.y + 0.05, cam.z + 0.05) };
      const inside = game.world.colliders.find(
        (c) => game.world.active(c) && game.blocksCamera(c) && tiny.min.x < c.max.x && tiny.max.x > c.min.x && tiny.min.y < c.max.y && tiny.max.y > c.min.y && tiny.min.z < c.max.z && tiny.max.z > c.min.z,
      );
      if (inside) failures.push(`${tag}: camera inside ${inside.id}`);
      const hit = game.world.raycast(cam, chest, solid(game));
      if (hit !== null && hit < 0.92) {
        const k = game.world.colliders.find((c) => solid(game)(c) && game.world.raycast(cam, chest, (d) => d === c) !== null);
        failures.push(`${tag}: ${k?.id} between camera and Pip at ${hit.toFixed(2)}`);
      }
      if (terrainClearance(cam, chest) < 0) failures.push(`${tag}: terrain between camera and Pip`);
    }
    expect(checked).toBeGreaterThan(600);
    expect(failures.slice(0, 12)).toEqual([]);
  }, 120_000);

  it('the camera keeps a usable distance when it is not obstructed', () => {
    const { game } = game3d();
    place(game, { x: 30, z: 0, yaw: 0 });
    game.camera.snap(game.cameraContext());
    run(game, 1);
    const d = Math.hypot(game.camera.pos.x - game.player.pos.x, game.camera.pos.z - game.player.pos.z);
    expect(d).toBeGreaterThan(4);
    expect(game.camera.occlusion.kept).toBeGreaterThan(0.95);
  });

  it('with a rock ridge right behind Pip, the camera detects it and keeps a clear view instead of filming the rock', () => {
    const { game } = game3d();
    // just past the second light fence's ridge, off the lane: the chase camera's spot is inside the ridge
    game.player.teleport({ x: 164.4, y: game.level.plateauY + 0.1, z: -5 });
    game.camera.snap(game.cameraContext());
    run(game, 2);
    const cam = game.camera.pos;
    const chest = v3(game.player.pos.x, game.player.pos.y + 0.6, game.player.pos.z);
    expect(game.camera.occlusion.by).not.toBe('none');
    expect(terrainClearance(cam, chest)).toBeGreaterThan(0);
  });

  it('on the aqueduct stub over the canyon, the chase view stays clear', () => {
    const { game } = game3d();
    game.player.teleport({ x: 215.5, y: game.level.sealY, z: 0 });
    game.camera.snap(game.cameraContext());
    run(game, 2);
    const chest = v3(game.player.pos.x, game.player.pos.y + 0.6, game.player.pos.z);
    expect(terrainClearance(game.camera.pos, chest)).toBeGreaterThan(0);
  });

  it('turning around on the spot recovers the full distance smoothly (no snapping)', () => {
    const { game, input } = game3d();
    place(game, { x: 30, z: 0, yaw: 0 });
    game.camera.snap(game.cameraContext());
    run(game, 1);
    let last = { ...game.camera.pos };
    let maxJump = 0;
    // a fast half turn with the mouse (half a second), then let go
    for (let i = 0; i < 240; i++) {
      if (i < 60) input.orbitYaw = Math.PI / 60;
      run(game, 1 / 120);
      const c = game.camera.pos;
      maxJump = Math.max(maxJump, Math.hypot(c.x - last.x, c.y - last.y, c.z - last.z));
      last = { ...c };
    }
    // at 120 Hz, nothing faster than ~24 units/s (a cut would be metres in one step)
    expect(maxJump).toBeLessThan(0.3);
  });

  it('falling from height, Pip and the spot he will land on both stay on screen', () => {
    const { game } = game3d();
    const y0 = game.level.plateauY;
    game.player.teleport({ x: 114, y: y0 + 7, z: 0 });
    game.camera.snap(game.cameraContext());
    const cam = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 900);
    let frames = 0;
    for (let i = 0; i < 80 && !game.player.grounded; i++) {
      run(game, 1 / 120);
      cam.fov = game.camera.fov;
      cam.updateProjectionMatrix();
      cam.position.set(game.camera.pos.x, game.camera.pos.y, game.camera.pos.z);
      cam.lookAt(game.camera.target.x, game.camera.target.y, game.camera.target.z);
      cam.updateMatrixWorld();
      const p = game.player.pos;
      const pip = new THREE.Vector3(p.x, p.y + 0.5, p.z).project(cam);
      const landing = new THREE.Vector3(p.x, y0, p.z).project(cam);
      expect(Math.abs(pip.y)).toBeLessThan(0.95);
      // the camera takes a quarter of a second to tilt down, then keeps the landing in view
      if (i >= 30) expect(Math.abs(landing.y)).toBeLessThan(0.98);
      frames++;
    }
    expect(frames).toBeGreaterThan(20);
  });
});
