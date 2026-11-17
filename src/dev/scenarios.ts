import type { Era } from '../game/era/EraSystem';
import { Game } from '../game/sim/Game';
import { newSave, setSaveWrites, type SaveData } from '../game/save/save';
import type { CamPose } from '../game/camera/CameraRig';
import { preloadProgress } from '../game/render/assets';
import { session } from '../ui/session';
import { useUI } from '../ui/store';

/**
 * Development scenarios: reproducible game states for screenshots, browser tests and debugging.
 *
 *   http://localhost:5173/?scenario=aqueduct            the broken aqueduct, Beyond, 2D
 *   ...&era=4                                           override the generation (0–5)
 *   ...&mode=3d                                         override the perspective
 *   ...&freeze=1                                        stop animation once loaded (for visual baselines)
 *
 * Scenarios never write to the player's save, and they turn off the drifting Beyond rifts.
 * Only available in dev builds.
 */
export interface Scenario {
  /** Shown in docs and test names. */
  label: string;
  era: Era;
  mode: '2d' | '3d';
  pos: { x: number; y: number; z: number };
  /** A fixed camera; otherwise the normal follow camera. */
  camera?: CamPose;
  save?: Partial<SaveData>;
}

/** Everything unlocked: the state of a player who has reached the Halo Path. */
const LATE: Partial<SaveData> = {
  awakened: true,
  shardTaken: true,
  shiftUnlocked: true,
  firstShiftDone: true,
  bridgeRepaired: true,
  beaconLit: true,
  stairRepaired: true,
  gatePassed: true,
  regress: true,
  glyphsRead: true,
  eraKeys: true,
  checkpoint: 'start',
  story: ['boot', 'holes', 'goodJob', 'shard', 'deadPixel', 'device', 'firstShift', 'chamber', 'inked', 'mural', 'halo', 'beam', 'thicket', 'relief', 'sleeping', 'glyphs', 'aqueduct'],
};

export const SCENARIOS: Record<string, Scenario> = {
  start: { label: 'Awakening field', era: 0, mode: '2d', pos: { x: 6, y: 0, z: 0 }, save: { awakened: true, story: ['boot'] } },
  ruins: { label: 'Shard ruins', era: 4, mode: '2d', pos: { x: 30, y: 1, z: 0 }, save: LATE },
  ruins3d: {
    label: 'Shard ruins (3D overview)',
    era: 5,
    mode: '3d',
    pos: { x: 26, y: 1, z: 0 },
    camera: { target: { x: 24, y: 3.5, z: -8 }, yaw: 0.35, pitch: 0.12, fov: 55, dist: 22 },
    save: LATE,
  },
  chamber: {
    label: 'Hidden chamber',
    era: 5,
    mode: '3d',
    pos: { x: 56.5, y: 0, z: -7 },
    camera: { target: { x: 57, y: 1, z: -7 }, yaw: 0.6, pitch: 0.65, fov: 50, dist: 9 },
    save: LATE,
  },
  stair: { label: 'Painted Stair', era: 4, mode: '2d', pos: { x: 104, y: 0, z: 0 }, save: LATE },
  plateau: { label: 'Plateau', era: 5, mode: '2d', pos: { x: 140, y: 9, z: 0 }, save: LATE },
  aqueduct: { label: 'Broken aqueduct', era: 5, mode: '2d', pos: { x: 219, y: 12.5, z: 0 }, save: LATE },
  aqueduct3d: { label: 'Broken aqueduct (3D, on the far half)', era: 5, mode: '3d', pos: { x: 215.5, y: 12.5, z: -5.4 }, save: LATE },
  aqueductView: {
    label: 'Broken aqueduct (3D overview)',
    era: 5,
    mode: '3d',
    pos: { x: 224, y: 12.5, z: 5.4 },
    camera: { target: { x: 219, y: 8, z: 0 }, yaw: 0.85, pitch: 0.42, fov: 50, dist: 26 },
    save: LATE,
  },
  seal: { label: 'Seal door (3D)', era: 5, mode: '3d', pos: { x: 210, y: 12.5, z: 0 }, save: LATE },
  summit: { label: 'Summit', era: 5, mode: '2d', pos: { x: 236, y: 12.5, z: 0 }, save: LATE },
};

/** Query-string scenario, if any (dev builds only). */
export function requestedScenario(): { name: string; s: Scenario; freeze: boolean } | null {
  if (!import.meta.env.DEV) return null;
  const q = new URLSearchParams(location.search);
  const name = q.get('scenario');
  if (!name || !SCENARIOS[name]) return null;
  const s = { ...SCENARIOS[name] };
  const era = q.get('era');
  if (era !== null) s.era = Math.max(0, Math.min(5, Number(era))) as Era;
  const mode = q.get('mode');
  if (mode === '2d' || mode === '3d') s.mode = mode;
  return { name, s, freeze: q.get('freeze') === '1' };
}

declare global {
  interface Window {
    /** Set when a dev scenario has loaded its assets and settled (Playwright waits for it). */
    __scenarioReady?: boolean;
  }
}

/** Start the game directly in a scenario, bypassing the title screen. */
export function bootScenario(sc: { name: string; s: Scenario; freeze: boolean }) {
  if (!session.input) throw new Error('input not ready');
  setSaveWrites(false);
  const s = sc.s;
  const save: SaveData = { ...newSave(), ...s.save, era: s.era };
  const g = new Game(session.input, save, 'play');
  g.era.riftsEnabled = false;
  g.era.set(s.era);
  g.player.teleport(s.pos);
  g.shift.set(s.mode);
  if (s.mode === '2d') g.shift.laneZ = 0;
  if (s.camera) {
    g.camera.override = { ...s.camera, target: { ...s.camera.target } };
    g.camera.overrideW = 1;
    g.camera.overrideGoal = 1;
  }
  g.camera.snap(g.cameraContext());
  session.game = g;
  useUI.getState().newSession();
  useUI.getState().setScreen('game');
  // Ready once every asset has loaded and the frame has settled for a moment.
  const settle = () => {
    if (preloadProgress() < 1) return void setTimeout(settle, 100);
    setTimeout(() => {
      if (sc.freeze) {
        g.paused = true;
        session.input && (session.input.enabled = false);
        const view = (session as unknown as { view?: { timeScale: number } }).view;
        if (view) view.timeScale = 0;
      }
      window.__scenarioReady = true;
    }, 1500);
  };
  settle();
  return g;
}
