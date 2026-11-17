import type { Era } from '../era/EraSystem';

export interface SaveData {
  version: 4;
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
  /** Chapter 6: the stele at the Stalled Gate has been read (the gate is open). */
  glyphsRead: boolean;
  /** The world wheel's version plates installed so far, one bit per generation (63 = all six). */
  installed: number;
  /** Story lines already spoken (so they never repeat across sessions). */
  story: string[];
  bits: string[];
  finished: boolean;
  eraKeys: boolean;
  visited: string[];
  savedAt: number;
}

// The game was called "PIP — Beyond the Frame" when these were named. The keys stay, so existing saves still load.
const KEY_V1 = 'pip-beyond-the-frame/save-v1';
const KEY_V2 = 'pip-beyond-the-frame/save-v2';
const KEY_V3 = 'pip-beyond-the-frame/save-v3';
const KEY = 'pip-beyond-the-frame/save-v4';

export const newSave = (): SaveData => ({
  version: 4,
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
  glyphsRead: false,
  installed: 0,
  story: [],
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

/** Keep only the fields v4 still has. */
function pick(d: Record<string, unknown>): Partial<SaveData> {
  const base = newSave();
  const out: Partial<SaveData> = {};
  for (const k of Object.keys(base) as (keyof SaveData)[]) if (k in d) (out as Record<string, unknown>)[k] = d[k];
  return out;
}

/**
 * v1 had three eras (0 8-bit, 1 16-bit, 2 modern) and ended at the beacon.
 * The beats now map: first shift → Early 3D, plate → Stylized, beacon → Modern HD.
 */
export function migrateV1(d: Record<string, unknown>): SaveData {
  const base = { ...newSave(), ...pick(d) };
  const finishedV1 = !!d.finished;
  let era: Era = (d.era as number) === 1 ? 1 : 0;
  if ((d.era as number) === 2) era = finishedV1 ? 4 : base.bridgeRepaired ? 3 : 2;
  return migrateV2({ ...base, era, beaconLit: finishedV1, finished: false, eraKeys: !!d.eraKeys });
}

/** v2 ended at the Frame Gate overlook; the sanctuary lies beyond it. */
export function migrateV2(d: Record<string, unknown>): SaveData {
  return { ...newSave(), ...pick(d), version: 4, regress: !!d.beaconLit, finished: false, eraKeys: false };
}

/**
 * v3 continued into Neon Verge, a city that no longer exists. Anyone who got that far resumes at
 * the Frame Gate, with the sanctuary ahead and story lines from the city forgotten.
 */
export function migrateV3(d: Record<string, unknown>): SaveData {
  const base = { ...newSave(), ...pick(d), version: 4 as const };
  if (d.zone === 'verge' || d.vergeEntered) {
    base.checkpoint = 'gate';
    base.era = 5;
    base.gatePassed = true;
  }
  base.finished = false;
  base.eraKeys = false;
  base.visited = base.visited.filter((r) => !['roof', 'alleyway', 'market', 'billboard', 'plaza', 'core'].includes(r));
  return base;
}

export function loadSave(): SaveData | null {
  const st = storage();
  if (!st) return null;
  try {
    const raw = st.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as SaveData;
      if (d.version !== 4) return null;
      const s = { ...newSave(), ...d };
      // saves from before the version plates: a finished game has installed them all
      if (s.finished) s.installed = 63;
      return s;
    }
    const tries: [string, number, (d: Record<string, unknown>) => SaveData][] = [
      [KEY_V3, 3, migrateV3],
      [KEY_V2, 2, migrateV2],
      [KEY_V1, 1, migrateV1],
    ];
    for (const [key, version, migrate] of tries) {
      const old = st.getItem(key);
      if (!old) continue;
      const d = JSON.parse(old) as Record<string, unknown>;
      if (d.version === version) return migrate(d);
    }
    return null;
  } catch {
    return null;
  }
}

let writesEnabled = true;
/** Dev scenarios play from a fixed state and must never overwrite the player's real save. */
export function setSaveWrites(on: boolean) {
  writesEnabled = on;
}

export function writeSave(d: SaveData) {
  if (!writesEnabled) return;
  try {
    storage()?.setItem(KEY, JSON.stringify({ ...d, savedAt: Date.now() }));
  } catch {
    /* storage unavailable: progress lasts for this session only */
  }
}

export function clearSave() {
  try {
    for (const k of [KEY, KEY_V3, KEY_V2, KEY_V1]) storage()?.removeItem(k);
  } catch {
    /* ignore */
  }
}
