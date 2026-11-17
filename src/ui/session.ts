import { Game } from '../game/sim/Game';
import { BrowserInput, NullInput } from '../game/sim/Input';
import { clearSave, loadSave } from '../game/save/save';
import { v3 } from '../game/math';
import { TITLE } from '../game/level/title';

/** The live game instance lives outside React so the render loop never re-renders the tree. */
export const session: {
  game: Game | null;
  menuGame: Game | null;
  input: BrowserInput | null;
  /** Dev: ignore player input entirely (frozen scenarios). */
  inputLocked: boolean;
  /** The title's 8- or 16-bit pixel scene covers the screen: the 3D title set needn't render. */
  menuCovered: boolean;
} = { game: null, menuGame: null, input: null, inputLocked: false, menuCovered: false };

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

/** The title screen's world: Pip on his slab in the composed title set (level/title.ts), in Beyond. */
export function makeMenuGame() {
  const g = new Game(new NullInput(), null, 'menu');
  const o = TITLE.origin;
  const s = TITLE.slab;
  g.world.add('titleSlab', 'platform', { min: v3(o.x + s.x - 1.4, s.top - 1, o.z + s.z - 1.2), max: v3(o.x + s.x + 1.4, s.top, o.z + s.z + 1.2) });
  g.shift.set('3d');
  g.player.teleport(v3(o.x + TITLE.pip.x, s.top, o.z + TITLE.pip.z));
  g.player.heading = TITLE.pip.heading;
  g.era.set(5);
  g.era.riftsEnabled = false;
  const c = TITLE.camera;
  const d = { x: c.pos.x - c.look.x, y: c.pos.y - c.look.y, z: c.pos.z - c.look.z };
  const dist = Math.hypot(d.x, d.y, d.z);
  g.camera.override = {
    target: v3(o.x + c.look.x, o.y + c.look.y, o.z + c.look.z),
    yaw: Math.atan2(d.x, d.z),
    pitch: Math.asin(d.y / dist),
    fov: c.fov,
    dist,
  };
  g.camera.overrideW = 1;
  g.camera.overrideGoal = 1;
  g.camera.snap(g.cameraContext());
  session.menuGame = g;
  return g;
}

/** The level as a showcase (the gallery's comparison views pose their own cameras over it). */
export function makeShowcaseGame() {
  const g = new Game(new NullInput(), null, 'menu');
  g.camera.override = { target: v3(4.8, 2.75, -0.6), yaw: 0.1, pitch: 0.06, fov: 30, dist: 15 };
  g.camera.overrideW = 1;
  g.camera.overrideGoal = 1;
  g.camera.snap(g.cameraContext());
  return g;
}

if (import.meta.env.DEV) (window as unknown as { __pip: typeof session }).__pip = session;
