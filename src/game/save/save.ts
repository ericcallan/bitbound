import type { Era } from '../era/EraSystem';

export type Zone = 'meadows' | 'verge';

export interface SaveData {
  version: 3;
  zone: Zone;
  checkpoint: string;
  era: Era;
  awakened: boolean;
  shardTaken: boolean;
  shiftUnlocked: boolean;
  firstShiftDone: boolean;
  bridgeRepaired: boolean;
  beaconLit: boolean;
  stairRepaired: boolean;
  gatePassed: boolean;
  /** Regress (projecting older generations) unlocked at the beacon. */
  regress: boolean;
  // Chapter 6
  vergeEntered: boolean;
  emitter: boolean;
  shutterOpen: boolean;
  codeRead: boolean;
  wardenDown: boolean;
  /** Story lines already spoken (so they never repeat across sessions). */
  story: string[];
  /** Pickups taken and hostiles destroyed in the city. */
  pickups: string[];
  defeated: string[];
  bits: string[];
  finished: boolean;
  eraKeys: boolean;
  visited: string[];
  savedAt: number;
}

const KEY_V1 = 'pip-beyond-the-frame/save-v1';
const KEY_V2 = 'pip-beyond-the-frame/save-v2';
const KEY = 'pip-beyond-the-frame/save-v3';

export const newSave = (): SaveData => ({
  version: 3,
  zone: 'meadows',
  checkpoint: 'start',
  era: 0,
  awakened: false,
  shardTaken: false,
  shiftUnlocked: false,
  firstShiftDone: false,
  bridgeRepaired: false,
  beaconLit: false,
  stairRepaired: false,
  gatePassed: false,
  regress: false,
  vergeEntered: false,
  emitter: false,
  shutterOpen: false,
  codeRead: false,
  wardenDown: false,
  story: [],
  pickups: [],
  defeated: [],
  bits: [],
  finished: false,
  eraKeys: false,
  visited: [],
  savedAt: 0,
});

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * v1 had three eras (0 8-bit, 1 16-bit, 2 modern) and ended at the beacon.
 * The beats now map: first shift → Early 3D, plate → Stylized, beacon → Modern HD.
 */
export function migrateV1(d: Record<string, unknown>): SaveData {
  const base = { ...newSave(), ...(d as Partial<SaveData>) };
  const finishedV1 = !!d.finished;
  let era: Era = (d.era as number) === 1 ? 1 : 0;
  if ((d.era as number) === 2) era = finishedV1 ? 4 : base.bridgeRepaired ? 3 : 2;
  return migrateV2({ ...base, version: 2, era, beaconLit: finishedV1, finished: false, eraKeys: !!d.eraKeys });
}

/** v2 ended at the Frame Gate overlook; v3 continues into the city. */
export function migrateV2(d: Record<string, unknown>): SaveData {
  const base = { ...newSave(), ...(d as Partial<SaveData>) };
  return {
    ...base,
    version: 3,
    zone: 'meadows',
    regress: !!d.beaconLit,
    // A v2 "finish" only reached the overlook: the city still lies ahead.
    finished: false,
    eraKeys: false,
  };
}

export function loadSave(): SaveData | null {
  const st = storage();
  if (!st) return null;
  try {
    const raw = st.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as SaveData;
      if (d.version !== 3) return null;
      return { ...newSave(), ...d };
    }
    const v2 = st.getItem(KEY_V2);
    if (v2) {
      const d = JSON.parse(v2) as Record<string, unknown>;
      if (d.version === 2) return migrateV2(d);
    }
    const v1 = st.getItem(KEY_V1);
    if (v1) {
      const d = JSON.parse(v1) as Record<string, unknown>;
      if (d.version === 1) return migrateV1(d);
    }
    return null;
  } catch {
    return null;
  }
}

export function writeSave(d: SaveData) {
  try {
    storage()?.setItem(KEY, JSON.stringify({ ...d, savedAt: Date.now() }));
  } catch {
    /* storage unavailable: progress lasts for this session only */
  }
}

export function clearSave() {
  try {
    for (const k of [KEY, KEY_V2, KEY_V1]) storage()?.removeItem(k);
  } catch {
    /* ignore */
  }
}
