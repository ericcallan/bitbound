import type { Action, InputSource } from '../game/sim/Input';
import { Game } from '../game/sim/Game';
import { STEP } from '../game/sim/constants';
import { newSave, type SaveData } from '../game/save/save';

/** Programmable input device for headless tests. */
export class ScriptedInput implements InputSource {
  x = 0;
  y = 0;
  /** Mouse-look deltas for the next step (consumed by takeOrbit). */
  orbitYaw = 0;
  orbitPitch = 0;
  down = new Set<Action>();
  pressed = new Set<Action>();
  axisX() {
    return this.x;
  }
  axisY() {
    return this.y;
  }
  held(a: Action) {
    return this.down.has(a);
  }
  consume(a: Action) {
    const h = this.pressed.has(a);
    this.pressed.delete(a);
    return h;
  }
  press(a: Action) {
    this.pressed.add(a);
    this.down.add(a);
  }
  release(a: Action) {
    this.down.delete(a);
  }
  takeOrbit() {
    const r = { yaw: this.orbitYaw, pitch: this.orbitPitch, active: this.orbitYaw !== 0 || this.orbitPitch !== 0 };
    this.orbitYaw = this.orbitPitch = 0;
    return r;
  }
}

export function makeGame(save: Partial<SaveData> = { awakened: true }) {
  const input = new ScriptedInput();
  const game = new Game(input, { ...newSave(), ...save });
  return { game, input };
}

export function run(game: Game, seconds: number, each?: (g: Game) => void) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) {
    each?.(game);
    game.fixedStep(STEP);
  }
}

export function runUntil(game: Game, pred: (g: Game) => boolean, maxSeconds: number, each?: (g: Game) => void) {
  const n = Math.round(maxSeconds / STEP);
  for (let i = 0; i < n; i++) {
    if (pred(game)) return true;
    each?.(game);
    game.fixedStep(STEP);
  }
  return pred(game);
}
