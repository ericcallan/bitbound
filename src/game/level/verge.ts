import { makeBox } from '../collision/World';
import { v3, type V3 } from '../math';
import type { CheckpointDef, SolidDef, Look } from './meadows';
import type { HostileDef } from '../combat/combat';
import type { Lane } from '../shift/DimensionShift';
import type { EraField, Era } from '../era/EraSystem';

/**
 * Chapter 6 — Neon Verge. Outside the dome, the meadow turns out to be a garden on the roof of a
 * megatower. Night, rain, neon. Coordinates sit far from the meadow (x ≥ 1000) in the same world,
 * so one simulation and one save cover the whole game.
 *
 * Route: Roof → (drop via awnings) → Market Street → shutter → Billboard climb (2D lane) →
 * Skybridge → Tower Plaza (censor field, sniper, Warden) → Archive core.
 */

const g = (...eras: Era[]): number => eras.reduce<number>((m, e) => m | (1 << e), 0);
/** Exists in every generation except 8-bit ("never invented"). */
export const NOT_8BIT = g(1, 2, 3, 4, 5);
/** Foreground art: solid everywhere except inside a 16-bit bubble. */
export const NOT_16BIT = g(0, 2, 3, 4, 5);
/** Graffiti: only solid in the stylized generation, where painted things are real. */
export const ONLY_STYLIZED = g(3);

const box = (id: string, look: Look, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, extra: Partial<SolidDef> = {}): SolidDef => ({
  id,
  kind: extra.kind ?? 'wall',
  look,
  box: makeBox(x0, y0, z0, x1, y1, z1),
  ...extra,
});

export const ROOF_Y = 10;
export const PLAZA_Y = 15;
export const LANE_Z = -6.2;

/** Painted holo-advert ledges: solid only when flat (and drawn on the billboard). */
export const LEDGES = Array.from({ length: 9 }, (_, i) => {
  const x0 = 1097.4 + i * 1.6;
  const top = 1.7 * (i + 1);
  // the last ledge runs right up to the skybridge so there is no gap to fall through
  return { x0, x1: i === 8 ? 1112 : x0 + 1.3, top, bottom: top - 0.3 };
});

export const VERGE = {
  bounds: { minX: 990, maxX: 1240 },
  spawn: v3(1006, ROOF_Y, 0),

  solids: [
    // --- Roof
    box('roof', 'concrete', 1000, -30, -10, 1036, ROOF_Y, 10, { kind: 'ground' }),
    box('railS', 'metal', 1000, ROOF_Y, -10.4, 1036, ROOF_Y + 1.1, -10),
    box('railN', 'metal', 1000, ROOF_Y, 10, 1036, ROOF_Y + 1.1, 10.4),
    box('railW', 'metal', 999.6, ROOF_Y, -10, 1000, ROOF_Y + 1.1, 10),
    box('railE1', 'metal', 1035.6, ROOF_Y, -10, 1036, ROOF_Y + 1.1, -4),
    box('railE2', 'metal', 1035.6, ROOF_Y, 4, 1036, ROOF_Y + 1.1, 10),
    box('hatch', 'metal', 1002, ROOF_Y, -1.5, 1005, ROOF_Y + 0.6, 1.5, { kind: 'prop' }),
    box('crate', 'metal', 1012.4, ROOF_Y, -3.6, 1013.6, ROOF_Y + 0.9, -2.4, { kind: 'prop' }),
    box('ac1', 'metal', 1021, ROOF_Y, 3, 1023.2, ROOF_Y + 1.4, 5.2, { kind: 'prop' }),
    box('ac2', 'metal', 1025, ROOF_Y, -6, 1027.2, ROOF_Y + 1.4, -3.8, { kind: 'prop' }),
    box('awning1', 'neon', 1036, 6.6, -4, 1042, 7, 4, { kind: 'platform' }),
    box('awning2', 'neon', 1042, 3.6, -5, 1048, 4, 5, { kind: 'platform' }),

    // --- Market Street
    box('street', 'concrete', 1036, -6, -7, 1112, 0, 7, { kind: 'ground' }),
    box('bldgN', 'concrete', 1036, 0, 7, 1112, 34, 30),
    box('bldgS1', 'concrete', 1036, 0, -30, 1056, 34, -7),
    box('bldgS2', 'concrete', 1061, 0, -30, 1112, 34, -7),
    box('bldgS3', 'concrete', 1056, 0, -30, 1061, 34, -14.5),
    // 16-bit secret: this "wall" is foreground art on glass. Inside a 16-bit bubble it isn't there.
    box('advert', 'glass', 1056, 0, -7.4, 1061, 6, -7, { genMask: NOT_16BIT }),
    box('alleyFloor', 'concrete', 1056, -6, -14.5, 1061, 0, -7, { kind: 'ground' }),
    // cover kiosks
    box('k1', 'metal', 1050, 0, 2, 1052, 1.4, 4, { kind: 'prop' }),
    box('k2', 'metal', 1058, 0, -3.5, 1060.5, 1.4, -1.5, { kind: 'prop' }),
    box('k3', 'metal', 1068, 0, 1, 1070, 1.6, 3.2, { kind: 'prop' }),
    box('k4', 'metal', 1092, 0, -3, 1094, 1.4, -1, { kind: 'prop' }),
    box('k5', 'metal', 1100, 0, 2, 1102, 1.4, 4, { kind: 'prop' }),
    // stylized secret: graffiti footholds up to an awning stash
    box('graffiti1', 'graffiti', 1063.4, 1.5, 6.2, 1064.9, 1.8, 7, { kind: 'platform', genMask: ONLY_STYLIZED }),
    box('graffiti2', 'graffiti', 1065.4, 3.0, 6.2, 1066.9, 3.3, 7, { kind: 'platform', genMask: ONLY_STYLIZED }),
    box('awningN', 'neon', 1067.5, 4.4, 5, 1073.5, 4.8, 7, { kind: 'platform' }),
    // The shutter, and the switch nook fenced by lasers that only exist from 16-bit up.
    box('shutter', 'metal', 1084, 0, -7, 1084.6, 9, 7),
    box('laserA', 'laser', 1077, 0, -7, 1077.3, 3, -3.6, { genMask: NOT_8BIT }),
    box('laserB', 'laser', 1077, 0, -3.9, 1083.9, 3, -3.6, { genMask: NOT_8BIT }),
    box('terminal', 'metal', 1081, 0, -6.9, 1082, 1.2, -6.3, { kind: 'prop' }),
    box('bracketN', 'metal', 1082.4, 2.8, 4.4, 1083.6, 3.5, 5.6, { kind: 'prop' }),
    box('bracketS', 'metal', 1082.4, 2.8, -5.6, 1083.6, 3.5, -4.4, { kind: 'prop' }),
    // Billboard climb: holo-advert ledges solid only in 2D on the lane at z = −6.2.
    ...LEDGES.map((l, i) => box(`ledge${i}`, 'invisible', l.x0, l.bottom, LANE_Z - 0.45, l.x1, l.top, LANE_Z + 0.45, { kind: 'platform', only2d: true })),
    // The street ends in a block; only the climb leads up to the skybridge.
    box('bldgE1', 'concrete', 1112, 0, -30, 1140, 34, -9.4),
    box('bldgE2', 'concrete', 1112, 0, -2.6, 1140, 34, 30),
    box('underBridge', 'concrete', 1112, 0, -9.4, 1113, 14.5, -2.6),
    box('bridgeFill', 'concrete', 1113, 0, -9.4, 1140, 14.5, -2.6),

    // --- Skybridge and Plaza
    box('skybridge', 'glass', 1112, 14.5, -9, 1140, PLAZA_Y, -3, { kind: 'ground' }),
    box('bridgeRailS', 'metal', 1112, PLAZA_Y, -9.4, 1140, PLAZA_Y + 1.1, -9),
    box('bridgeRailN', 'metal', 1112, PLAZA_Y, -3, 1140, PLAZA_Y + 1.1, -2.6),
    box('plaza', 'concrete', 1140, -10, -14, 1236, PLAZA_Y, 14, { kind: 'ground' }),
    box('plazaRailS', 'metal', 1140, PLAZA_Y, -14.4, 1196, PLAZA_Y + 1.1, -14),
    box('plazaRailN', 'metal', 1140, PLAZA_Y, 14, 1196, PLAZA_Y + 1.1, 14.4),
    box('plazaRailW1', 'metal', 1139.6, PLAZA_Y, -14, 1140, PLAZA_Y + 1.1, -9.4),
    box('plazaRailW2', 'metal', 1139.6, PLAZA_Y, -2.6, 1140, PLAZA_Y + 1.1, 14),
    box('pillar1', 'concrete', 1150, PLAZA_Y, 4, 1151.5, PLAZA_Y + 3, 5.5),
    box('pillar2', 'concrete', 1162, PLAZA_Y, -4, 1163.5, PLAZA_Y + 3, -2.5),
    box('pillar3', 'concrete', 1174, PLAZA_Y, 5, 1175.5, PLAZA_Y + 3, 6.5),
    box('planter', 'concrete', 1168, PLAZA_Y, -9, 1171, PLAZA_Y + 1.2, -7.5),
    box('signPillar', 'concrete', 1157, PLAZA_Y, -13.6, 1158, PLAZA_Y + 4, -12.6),
    box('balcony', 'metal', 1189, 23, 9, 1195, 23.6, 13),
    // The Archive Tower: walls around a hollow core room, a door that opens with the code.
    box('towerFrontS', 'concrete', 1196, PLAZA_Y, -20, 1197, 80, -2.5),
    box('towerFrontN', 'concrete', 1196, PLAZA_Y, 2.5, 1197, 80, 20),
    box('towerLintel', 'concrete', 1196, PLAZA_Y + 6, -2.5, 1197, 80, 2.5),
    box('door', 'metal', 1196.2, PLAZA_Y, -2.5, 1196.8, PLAZA_Y + 6, 2.5),
    box('towerS', 'concrete', 1197, PLAZA_Y, -20, 1236, 80, -10),
    box('towerN', 'concrete', 1197, PLAZA_Y, 10, 1236, 80, 20),
    box('towerBack', 'concrete', 1236, PLAZA_Y, -20, 1240, 80, 20),
    box('towerRoof', 'concrete', 1197, PLAZA_Y + 16, -10, 1236, PLAZA_Y + 17, 10),
  ] as SolidDef[],

  lanes: [{ x0: 1095, x1: 1140, z: LANE_Z }] as Lane[],

  /** ARCHIVE's censor field: the door code is blurred into low fidelity unless Pip projects full fidelity. */
  fields: [{ min: v3(1150, PLAZA_Y - 1, -14.5), max: v3(1166, PLAZA_Y + 10, -8), era: 1 as Era }] as EraField[],

  hostiles: [
    { id: 'c1', kind: 'censor', pos: v3(1026, ROOF_Y + 3.5, -5), group: 'roof' },
    { id: 'c2', kind: 'censor', pos: v3(1031, ROOF_Y + 4, 5), group: 'roof' },
    { id: 'c3', kind: 'censor', pos: v3(1060, 5, 2), group: 'market' },
    { id: 'c4', kind: 'censor', pos: v3(1072, 6, -2), group: 'market' },
    { id: 'e1', kind: 'enforcer', pos: v3(1066, 0, 4), group: 'market' },
    { id: 'e2', kind: 'enforcer', pos: v3(1074, 0, -1.5), group: 'market' },
    { id: 't1', kind: 'turret', pos: v3(1083, 3.5, 5), group: 'market' },
    { id: 't2', kind: 'turret', pos: v3(1083, 3.5, -5), group: 'market' },
    { id: 'e3', kind: 'enforcer', pos: v3(1098, 0, 2), group: 'shutter' },
    { id: 'c5', kind: 'censor', pos: v3(1104, 6, 1), group: 'shutter' },
    { id: 'c6', kind: 'censor', pos: v3(1104, 9, -2), group: 'billboard' },
    { id: 'c7', kind: 'censor', pos: v3(1109, 13, -1.5), group: 'billboard' },
    { id: 'e4', kind: 'enforcer', pos: v3(1160, PLAZA_Y, 6), group: 'plaza' },
    { id: 'e5', kind: 'enforcer', pos: v3(1170, PLAZA_Y, -4), group: 'plaza' },
    { id: 'e6', kind: 'enforcer', pos: v3(1182, PLAZA_Y, 3), group: 'plaza' },
    { id: 'c8', kind: 'censor', pos: v3(1166, PLAZA_Y + 5, 0), group: 'plaza' },
    { id: 's1', kind: 'sniper', pos: v3(1192, 23.6, 11), group: 'plaza' },
    { id: 'warden', kind: 'warden', pos: v3(1188, PLAZA_Y, 0), group: 'warden' },
  ] as HostileDef[],

  /** Where each encounter wakes (Pip enters the box). */
  encounters: [
    { group: 'roof', min: v3(1014, ROOF_Y - 1, -10), max: v3(1036, ROOF_Y + 6, 10), needs: 'emitter' },
    { group: 'market', min: v3(1046, -1, -7), max: v3(1084, 8, 7) },
    { group: 'shutter', min: v3(1085, -1, -7), max: v3(1112, 8, 7) },
    { group: 'billboard', min: v3(1094, -1, -7), max: v3(1112, 16, -4) },
    { group: 'plaza', min: v3(1138, PLAZA_Y - 1, -14), max: v3(1196, PLAZA_Y + 8, 14) },
  ],

  emitter: v3(1013, ROOF_Y + 0.9, -3),
  terminal: v3(1081.5, 0, -6.1),
  codeSign: v3(1157.5, PLAZA_Y + 2.6, -12.5),
  doorPanel: v3(1195.4, PLAZA_Y, -3.4),
  core: v3(1222, PLAZA_Y + 5, 0),
  coreX: 1212,
  alley: makeBox(1056, -1, -14.5, 1061, 6, -7.5),
  plazaEntryX: 1140,

  pickups: [
    { id: 'h1', kind: 'health', pos: v3(1058.5, 0.6, -12) },
    { id: 'h2', kind: 'health', pos: v3(1146, PLAZA_Y + 0.6, 11) },
    { id: 'h3', kind: 'health', pos: v3(1178, PLAZA_Y + 0.6, -12) },
    { id: 'h4', kind: 'health', pos: v3(1070.5, 5.4, 6) },
  ],

  bits: [
    [1057.5, 0.8, -10.5], [1059.5, 0.8, -10.5], [1058.5, 0.8, -13],
    [1069, 5.6, 6], [1071, 5.6, 6], [1072.5, 5.6, 6],
    [1120, PLAZA_Y + 0.8, LANE_Z], [1130, PLAZA_Y + 0.8, LANE_Z],
    [1152, PLAZA_Y + 0.8, 10], [1184, PLAZA_Y + 0.8, -11],
  ].map(([x, y, z], i) => ({ id: `v${i}`, pos: v3(x, y, z) })),

  checkpoints: [
    { id: 'roof', pos: v3(1006, ROOF_Y, 0) },
    { id: 'street', pos: v3(1049, 0, -1) },
    { id: 'shutter', pos: v3(1088, 0, 0) },
    { id: 'climb', pos: v3(1095.5, 0, LANE_Z) },
    { id: 'bridge', pos: v3(1118, PLAZA_Y, LANE_Z) },
    { id: 'plaza', pos: v3(1145, PLAZA_Y, -6) },
    { id: 'door', pos: v3(1178, PLAZA_Y, -9) },
  ] as CheckpointDef[],
};

export type Verge = typeof VERGE;
export const VERGE_CHECKPOINTS = VERGE.checkpoints.map((c) => c.id);
export const inBox = (p: V3, min: V3, max: V3) => p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y && p.z >= min.z && p.z <= max.z;
