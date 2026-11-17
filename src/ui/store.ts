import type { ArtTab } from '../content/artCopy';
import { create } from 'zustand';
import type { Banner, Expression, Prompt } from '../game/sim/Game';
import type { Era } from '../game/era/EraSystem';
import type { QualitySetting } from '../game/render/post/Pipeline';

export type Screen = 'menu' | 'game' | 'gallery';
export type ShiftStatus = 'hidden' | 'locked' | 'ready' | 'blocked' | 'active';

export interface HudState {
  era: Era;
  cells: number;
  bits: number;
  totalBits: number;
  shift: ShiftStatus;
  /** Why the shift is blocked (short, for the chip), or ''. */
  shiftWhy: string;
  mode3d: boolean;
  prompt: Prompt | null;
  banner: Banner | null;
  expression: Expression;
  finaleCard: boolean;
  cinematic: boolean;
  visited: string[];
  room: string;
  shardTaken: boolean;
  shiftUnlocked: boolean;
  bridgeRepaired: boolean;
  stairRepaired: boolean;
  gatePassed: boolean;
  eraKeys: boolean;
  maxCells: number;
  objective: string;
  dialogue: { speaker: 'NOTES' | 'PIP' | 'SYSTEM'; text: string; id: number } | null;
  regress: boolean;
  bubbleEra: number;
  wheelOpen: boolean;
  regressEra: number;
  maxEraUnlocked: number;
}

export interface Settings {
  music: number;
  sfx: number;
  shake: boolean;
  showFps: boolean;
  quality: QualitySetting;
}

/** Kept from the game's earlier name, so existing settings still load. */
const SETTINGS_KEY = 'pip-beyond-the-frame/settings';

function loadSettings(): Settings {
  const def: Settings = { music: 0.7, sfx: 0.8, shake: true, showFps: false, quality: 'auto' };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...def, ...JSON.parse(raw) } : def;
  } catch {
    return def;
  }
}

interface UIStore {
  screen: Screen;
  /** Which Art & Design tab is open (part of the address: /art/, /art/environment/...). */
  galleryTab: ArtTab;
  session: number;
  paused: boolean;
  mapOpen: boolean;
  settingsOpen: boolean;
  settings: Settings;
  hud: HudState;
  fps: number;
  setScreen(s: Screen): void;
  setGalleryTab(t: ArtTab): void;
  newSession(): void;
  setPaused(p: boolean): void;
  setMap(o: boolean): void;
  setSettingsOpen(o: boolean): void;
  updateSettings(s: Partial<Settings>): void;
  setHud(h: Partial<HudState>): void;
}

export const useUI = create<UIStore>((set, get) => ({
  screen: 'menu',
  galleryTab: 'character',
  session: 0,
  paused: false,
  mapOpen: false,
  settingsOpen: false,
  settings: loadSettings(),
  fps: 0,
  hud: {
    era: 0,
    cells: 3,
    bits: 0,
    totalBits: 0,
    shift: 'hidden',
    shiftWhy: '',
    mode3d: false,
    prompt: null,
    banner: null,
    expression: 'idle',
    finaleCard: false,
    cinematic: false,
    visited: [],
    room: 'field',
    shardTaken: false,
    shiftUnlocked: false,
    bridgeRepaired: false,
    stairRepaired: false,
    gatePassed: false,
    eraKeys: false,
    maxCells: 3,
    objective: '',
    dialogue: null,
    regress: false,
    bubbleEra: -1,
    wheelOpen: false,
    regressEra: 0,
    maxEraUnlocked: 0,
  },
  setScreen: (screen) => set({ screen, paused: false, mapOpen: false, settingsOpen: false }),
  setGalleryTab: (galleryTab) => set({ galleryTab }),
  newSession: () => set({ session: get().session + 1 }),
  setPaused: (paused) => set({ paused }),
  setMap: (mapOpen) => set({ mapOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  updateSettings: (s) => {
    const settings = { ...get().settings, ...s };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
    set({ settings });
  },
  setHud: (h) => set({ hud: { ...get().hud, ...h } }),
}));
