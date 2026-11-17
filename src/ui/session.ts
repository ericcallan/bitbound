import { Game } from '../game/sim/Game';
import { BrowserInput, NullInput } from '../game/sim/Input';
import { clearSave, loadSave } from '../game/save/save';
import { v3 } from '../game/math';

/** The live game instance lives outside React so the render loop never re-renders the tree. */
export const session: {
  game: Game | null;
  menuGame: Game | null;
  input: BrowserInput | null;
} = { game: null, menuGame: null, input: null };

export function ensureInput(el: HTMLElement) {
  if (!session.input) session.input = new BrowserInput(el);
  return session.input;
}

export function startGame(resume: boolean) {
  if (!session.input) throw new Error('input not ready');
  const save = resume ? loadSave() : null;
  if (!resume) clearSave();
  session.input.clearPresses();
  session.game = new Game(session.input, save, 'play');
  return session.game;
}

export function canContinue() {
  const s = loadSave();
  return !!s && s.awakened;
}

/** Attract-mode world for the title screen: Pip idling where pixels meet polygons. */
export function makeMenuGame() {
  const g = new Game(new NullInput(), null, 'menu');
  // Wide and low: the logo and menu sit in the sky, the six generations stand along the ground below.
  g.camera.override = { target: v3(4.8, 2.75, -0.6), yaw: 0.1, pitch: 0.06, fov: 30, dist: 15 };
  g.camera.overrideW = 1;
  g.camera.overrideGoal = 1;
  g.camera.snap(g.cameraContext());
  return g;
}

if (import.meta.env.DEV) (window as unknown as { __pip: typeof session }).__pip = session;
