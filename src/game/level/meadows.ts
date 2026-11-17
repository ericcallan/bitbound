import { makeBox, type AABB, type ColliderKind } from '../collision/World';
import { v3, type V3 } from '../math';
import type { Era } from '../era/EraSystem';

/**
 * Pixel Meadows. One continuous strip along +x. The 2D lane is z = 0; everything else (the
 * hidden chamber, the lamp alcove, the background) lives at real depth in the same world.
 *
 * Act 1 (x < 100): the Broken Passage — 3D reveals what 2D hides.
 * Act 2 (x ≥ 100): the Painted Stair — 2D makes solid what 3D shows is only paint.
 * Chapter 6 (x ≥ 153): the Halo Path — the same strip climbs to the world wheel on Mount Halo,
 * and each obstacle answers to a different generation's rules (Regress).
 */

export type Look = 'grass' | 'dirt' | 'stone' | 'ruin' | 'hedge' | 'wood' | 'metal' | 'mural' | 'beam' | 'relief' | 'invisible';

export interface SolidDef {
  id: string;
  kind: ColliderKind;
  box: AABB;
  look: Look;
  /** Fades when it blocks the 3D camera's view of Pip. */
  occluder?: boolean;
  enabled?: boolean;
  /** Only solid while the world is flat (painted steps). */
  only2d?: boolean;
  /** Generations in which this solid exists (bitmask; undefined = all). */
  genMask?: number;
}

export interface EnemyDef {
  id: string;
  x: number;
  y: number;
  minX: number;
  maxX: number;
}

export interface CheckpointDef {
  id: string;
  pos: V3;
}

export interface MoverDef {
  id: string;
  y: number;
  halfW: number;
  minX: number;
  maxX: number;
  period: number;
}

export type DecorType =
  | 'machine'
  | 'tree'
  | 'bloomer'
  | 'flowers'
  | 'bush'
  | 'pillar'
  | 'arch'
  | 'rock'
  | 'statue'
  | 'gear'
  | 'sign'
  | 'mushroom'
  | 'crystal';

export interface DecorDef {
  type: DecorType;
  pos: V3;
  scale?: number;
  rot?: number;
  seed?: number;
}

/**
 * Footprint of each decor type at scale 1: half-width along x and height, the largest over every
 * generation's variant (measured from the built meshes in the browser, rounded up). Used to keep
 * anything in front of the path from hiding Pip or an enemy.
 */
export const DECOR_FOOTPRINT: Record<DecorType, { hw: number; h: number }> = {
  machine: { hw: 0.8, h: 3.1 },
  sign: { hw: 0.6, h: 1.2 },
  tree: { hw: 2.5, h: 7.1 },
  bloomer: { hw: 0.8, h: 2.6 },
  flowers: { hw: 0.9, h: 0.65 },
  mushroom: { hw: 0.35, h: 0.7 },
  bush: { hw: 1.45, h: 1.4 },
  pillar: { hw: 0.7, h: 3.1 },
  arch: { hw: 2.4, h: 4.2 },
  rock: { hw: 1.0, h: 0.85 },
  statue: { hw: 0.65, h: 2.0 },
  gear: { hw: 1.05, h: 1.05 },
  crystal: { hw: 0.75, h: 2.1 },
};

const DEPTH_FRONT = 2.5;
const DEPTH_BACK = -3;
const BOTTOM = -8;

const ground = (id: string, x0: number, x1: number, top: number, look: Look = 'grass', front = DEPTH_FRONT): SolidDef => ({
  id,
  kind: 'ground',
  look,
  box: makeBox(x0, BOTTOM, DEPTH_BACK, x1, top, front),
});

const solid = (
  id: string,
  kind: ColliderKind,
  look: Look,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  extra: Partial<SolidDef> = {},
): SolidDef => ({ id, kind, look, box: makeBox(x0, y0, z0, x1, y1, z1), ...extra });

// ---------------------------------------------------------------- the Painted Stair
/** Eight steps painted on the mural; in 2D they project onto the lane and become solid. */
export const STAIR = {
  x0: 101,
  stepW: 1.1,
  pitch: 1.35,
  rise: 1.1,
  thick: 0.3,
  count: 8,
  /** Faded steps that must be repainted by the lamp. */
  missing: [3, 4],
  wall: { x0: 100, x1: 112, z0: -1.8, z1: -1.0, top: 12 },
};
export const stairStep = (i: number) => {
  const x0 = STAIR.x0 + i * STAIR.pitch;
  const top = STAIR.rise * (i + 1);
  return { x0, x1: x0 + STAIR.stepW, top, bottom: top - STAIR.thick };
};
const stairSolids: SolidDef[] = Array.from({ length: STAIR.count }, (_, i) => {
  const s = stairStep(i);
  const missing = STAIR.missing.includes(i);
  return solid(`stair${i}`, 'platform', 'invisible', s.x0, s.bottom, -0.45, s.x1, s.top, 0.45, {
    only2d: true,
    enabled: !missing,
  });
});

const PLATEAU = 9;

const gens = (...eras: Era[]): number => eras.reduce<number>((m, e) => m | (1 << e), 0);
/** Thin things — light fences — were never drawn in 8-bit. */
export const NOT_8BIT = gens(1, 2, 3, 4, 5);
/** Foreground scenery: a separate layer in 16-bit, so you can pass behind it there. */
export const NOT_16BIT = gens(0, 2, 3, 4, 5);
/** Carved pictures only hold you up where painted things are real. */
export const ONLY_STYLIZED = gens(3);

// ---------------------------------------------------------------- Chapter 6: the Halo Path
const HALO = 10.5;
const SEAL = 12.5;
/** Carved handholds across the cliff gap (solid only in a Stylized bubble). */
export const RELIEFS = [
  { x0: 186.2, x1: 188.6, top: 11.1 },
  { x0: 190.8, x1: 193.2, top: 11.7 },
  { x0: 195.4, x1: 197.8, top: 12.3 },
];
const reliefSolids: SolidDef[] = RELIEFS.map((r, i) => ({
  id: `relief${i}`,
  kind: 'platform',
  look: 'relief',
  box: makeBox(r.x0, r.top - 0.35, -1.0, r.x1, r.top, 1.0),
  genMask: ONLY_STYLIZED,
}));

export const LEVEL = {
  bounds: { minX: -8, maxX: 254 },

  solids: [
    // Scene 1 — A Pixel Awakens
    ground('g1', -8, 14, 0),
    solid('step1', 'ground', 'grass', 9, 0, -1.6, 11, 1, 1.6),
    solid('step2', 'ground', 'grass', 11, 0, -1.6, 14, 2, 1.6),
    // Scene 2 — Something Changes (shard ruins)
    ground('g2', 17, 40, 1),
    solid('float1', 'platform', 'stone', 21, 2.7, -1, 23.5, 3.2, 1),
    solid('plinth', 'prop', 'ruin', 32.4, 1, -0.8, 33.6, 1.6, 0.8),
    // 16-bit run
    ground('g3', 40, 46.5, 0),
    // Scene 3 — The Broken Passage
    ground('g4', 52, 62, 0),
    solid('chamberFloor', 'ground', 'stone', 51.6, BOTTOM, -12, 62, 0, -3),
    solid('facade', 'wall', 'ruin', 54.5, 0, -1.3, 62, 5, -0.7, { occluder: true }),
    solid('hedge', 'wall', 'hedge', 51.6, 0, -3.3, 55, 4.2, -2.3, { occluder: true }),
    solid('chamberW', 'wall', 'ruin', 51.6, 0, -11.5, 52.2, 1.6, -3.3),
    solid('chamberE', 'wall', 'ruin', 61.4, 0, -11.5, 62, 1.6, -1.3),
    solid('chamberBack', 'wall', 'ruin', 51.6, 0, -12, 62, 3.4, -11.5),
    solid('ledge', 'wall', 'stone', 59.4, 0, -11.5, 61.4, 3, -9.4),
    solid('devicePedestal', 'prop', 'ruin', 59.1, 0, 0.9, 59.9, 0.9, 1.7),
    // Bridge — stubs exist, the middle assembles when the puzzle is solved
    solid('bridgeL', 'bridge', 'wood', 62, -0.45, -0.8, 63, 0, 0.8),
    solid('bridgeR', 'bridge', 'wood', 71, -0.45, -0.8, 72, 0, 0.8),
    solid('bridgeMid', 'bridge', 'invisible', 63, -0.45, -0.8, 71, 0, 0.8, { enabled: false }),
    // Beacon Ridge
    ground('g5', 72, 100, 0),
    // Act 2 — the Painted Stair. The ground widens into a foreground alcove (3D only).
    ground('g6', 100, 112, 0, 'grass', 9),
    solid('mural', 'wall', 'mural', STAIR.wall.x0, 0, STAIR.wall.z0, STAIR.wall.x1, STAIR.wall.top, STAIR.wall.z1, { occluder: true }),
    solid('alcoveFront', 'wall', 'ruin', 99.6, 0, 8.6, 112.5, 1.2, 9.2, { occluder: true }),
    solid('alcoveW', 'wall', 'ruin', 99.6, 0, 2.5, 100.2, 1.2, 8.6, { occluder: true }),
    solid('alcoveE', 'wall', 'ruin', 112, 0, 2.5, 112.6, 3, 8.6, { occluder: true }),
    ...stairSolids,
    // The plateau — Modern HD platforming toward the Frame Gate
    ground('p1', 112, 121, PLATEAU),
    // An old light fence: thin threads of light only exist from 16-bit up, so an 8-bit bubble walks through.
    solid('fence', 'wall', 'beam', 117.4, PLATEAU, -3, 117.8, PLATEAU + 4.5, 2.5, { genMask: NOT_8BIT }),
    ground('p2', 126, 133, PLATEAU),
    ground('p3', 135.6, 166, PLATEAU),
    // Chapter 6 — the Halo Path
    solid('beam1', 'wall', 'beam', 160.0, PLATEAU, -3, 160.4, PLATEAU + 4.5, 2.5, { genMask: NOT_8BIT }),
    ground('p5', 166, 184, HALO),
    // Overgrown brambles: in 16-bit they're the foreground layer, and you walk behind them.
    solid('thicket', 'wall', 'hedge', 175, HALO, -3, 176.6, HALO + 4.5, 2.5, { genMask: NOT_16BIT }),
    ...reliefSolids,
    solid('cliff', 'wall', 'ruin', 184, 0, -3.4, 198, 17, -2.6),
    ground('p6', 198, 214, SEAL),
    solid('sealDoor', 'wall', 'ruin', 212.6, SEAL, -3, 213.4, SEAL + 5, 2.5),
    // The broken aqueduct: two halves at different depths that only line up from the side.
    solid('aqA', 'platform', 'stone', 214, SEAL - 1, -6.2, 220, SEAL, -4.6),
    solid('aqB', 'platform', 'stone', 220, SEAL - 1, 4.6, 226, SEAL, 6.2),
    solid('aqLane', 'platform', 'invisible', 214, SEAL - 0.3, -0.45, 226, SEAL, 0.45, { only2d: true }),
    ground('p7', 226, 254, SEAL),
    // World edges
    solid('edgeL', 'invisible', 'invisible', -9, BOTTOM, -30, -8, 40, 30),
    solid('edgeR', 'invisible', 'invisible', 254, BOTTOM, -30, 255, 40, 30),
  ] as SolidDef[],

  movers: [
    { id: 'mover1', y: 0, halfW: 0.9, minX: 47.9, maxX: 50.6, period: 4.2 },
    { id: 'mover2', y: PLATEAU, halfW: 0.9, minX: 122.0, maxX: 125.0, period: 3.8 },
  ] as MoverDef[],

  enemies: [
    { id: 'e1', x: 24, y: 1, minX: 19.5, maxX: 28 },
    { id: 'e2', x: 41.6, y: 0, minX: 40.4, maxX: 42.4 },
    { id: 'e3', x: 76, y: 0, minX: 74, maxX: 78.5 },
    { id: 'e4', x: 129, y: PLATEAU, minX: 127, maxX: 130.6 },
    { id: 'e5', x: 139, y: PLATEAU, minX: 137, maxX: 140.2 },
  ] as EnemyDef[],

  bits: [
    [3, 0.6], [4, 0.6], [5, 0.6], [10, 1.6], [12.5, 2.7], [15.5, 3.3],
    [18.5, 1.6], [19.5, 1.6], [21.6, 3.8], [22.4, 3.8], [23.2, 3.8], [26.5, 1.6], [27.5, 1.6], [30, 1.6],
    [41.5, 0.6],
    // Hidden behind the foreground bush
    [44.4, 0.6], [45, 0.6], [45.6, 0.6],
    [49.5, 1.7], [53, 0.6], [54, 0.6],
    [65, 1.0], [67, 1.4], [69, 1.0],
    [74, 0.6], [75, 0.6], [79, 0.6],
    // Act 2
    [88, 0.6], [92, 0.6], [96, 0.6],
    [stairStep(1).x0 + 0.55, stairStep(1).top + 0.6], [stairStep(6).x0 + 0.55, stairStep(6).top + 0.6],
    [115, 9.6], [117, 9.6], [119, 9.6], [123.5, 11.2], [129.5, 11.2], [134.3, 10.6], [138.5, 9.6], [144, 9.6],
    // Chapter 6
    [155, 9.6], [158, 9.6], [162, 9.6], [168, 11.1], [171, 11.1], [178, 11.1], [181, 11.1],
    [RELIEFS[1].x0 + 1.2, RELIEFS[1].top + 0.6], [RELIEFS[2].x0 + 1.2, RELIEFS[2].top + 0.6],
    [201, 13.1], [204, 13.1], [216, 13.4], [220, 13.4], [224, 13.4], [230, 13.1], [236, 13.1],
  ]
    .map(([x, y], i) => ({ id: `b${i}`, pos: v3(x, y, 0) }))
    .concat([
      // Hidden chamber (3D only)
      { id: 'c0', pos: v3(54, 0.6, -5) },
      { id: 'c1', pos: v3(57.5, 0.6, -10.4) },
      { id: 'c2', pos: v3(60, 3.6, -10.5) },
      { id: 'c3', pos: v3(60.9, 3.6, -10.5) },
      // Behind the facade — only reachable through depth
      { id: 'c4', pos: v3(58, 0.6, -2) },
      // Lamp alcove (3D only)
      { id: 'c5', pos: v3(101.2, 0.6, 7.6) },
      { id: 'c6', pos: v3(110.8, 0.6, 7.6) },
      // Halo Path secrets: the end of each broken aqueduct half (3D only)
      { id: 'c7', pos: v3(215, SEAL + 0.6, -5.4) },
      { id: 'c8', pos: v3(225, SEAL + 0.6, 5.4) },
    ]),

  checkpoints: [
    { id: 'start', pos: v3(2, 0, 0) },
    { id: 'shard', pos: v3(35, 1, 0) },
    { id: 'device', pos: v3(57, 0, 0) },
    { id: 'beacon', pos: v3(81, 0, 0) },
    { id: 'stair', pos: v3(98, 0, 0) },
    { id: 'plateau', pos: v3(114, PLATEAU, 0) },
    { id: 'gate', pos: v3(143.5, PLATEAU, 0) },
    { id: 'halo', pos: v3(156, PLATEAU, 0) },
    { id: 'thicket', pos: v3(170, HALO, 0) },
    { id: 'relief', pos: v3(181.5, HALO, 0) },
    { id: 'seal', pos: v3(200, SEAL, 0) },
    { id: 'summit', pos: v3(229, SEAL, 0) },
  ] as CheckpointDef[],

  spawn: v3(2, 0, 0),
  awakeningMachine: v3(-1.6, 0, -1.6),
  shard: v3(33, 2.25, 0),
  device: v3(59.5, 0.9, 1.3),
  cubeStart: v3(55.8, 0, -6.2),
  cubeHalf: 0.6,
  plate: v3(58.2, 0, -8.4),
  resetGlyph: v3(53.4, 0, -10.2),
  bridge: { x0: 62, x1: 72, plankCount: 10, y: 0 },
  beacon: v3(81, 0, 0),
  beaconX: 80.4,
  chamber: makeBox(52.2, 0, -11.5, 61.4, 4, -1.3),
  conduit: [v3(58.9, 0, -8.4), v3(60.9, 0, -8.4), v3(60.9, 0, -1.6), v3(62.6, 0, -0.2)],

  // Act 2 puzzle
  lampStart: v3(102, 0, 5.5),
  lampHalf: 0.6,
  lampSocket: v3(106.3, 0, 3.0),
  lampGlyph: v3(110.4, 0, 4.0),
  alcove: makeBox(100.2, 0, 2.5, 112, 4, 8.6),
  fenceX: 117.6,
  deadPixel: v3(38, 16, -30),
  gate: v3(142, PLATEAU, 0),
  gateX: 141.6,
  plateauY: PLATEAU,

  // Chapter 6
  haloX: 148,
  beamX: 160.2,
  thicketX: 175.8,
  reliefGap: { x0: 184, x1: 198 },
  /** The glyph stone sleeps inside a 16-bit field; full fidelity makes it readable. */
  glyphStone: v3(208, SEAL, -2.2),
  sleepField: { min: v3(203.5, SEAL - 1, -4), max: v3(212.4, SEAL + 8, 3), era: 1 as Era },
  aqueduct: { x0: 214, x1: 226, y: SEAL },
  wheel: v3(246, SEAL, -1.6),
  summitX: 242.5,
  haloY: HALO,
  sealY: SEAL,

  /** Water at the bottom of each pit. */
  pits: [
    { x0: 14, x1: 17, y: -5.5 },
    { x0: 46.5, x1: 52, y: -5.5 },
    { x0: 62, x1: 72, y: -5.5 },
    { x0: 121, x1: 126, y: -5.5 },
    { x0: 133, x1: 135.6, y: -5.5 },
    { x0: 184, x1: 198, y: -5.5 },
    { x0: 214, x1: 226, y: -5.5 },
  ],

  /** Where generation rifts drift once the world reaches Beyond. */
  riftAnchors: [
    { x: 6, y: 1.4, z: -1.2, r: 2.6, era: 0 as Era },
    { x: 24, y: 2.4, z: -0.6, r: 2.4, era: 1 as Era },
    { x: 38, y: 1.8, z: -1.5, r: 2.8, era: 2 as Era },
    { x: 57, y: 1.2, z: -6.5, r: 2.6, era: 0 as Era },
    { x: 77, y: 1.4, z: -1.0, r: 2.9, era: 3 as Era },
    { x: 92, y: 1.6, z: -0.8, r: 2.5, era: 1 as Era },
    { x: 106, y: 2.0, z: 5.0, r: 2.7, era: 2 as Era },
    { x: 118, y: 10.4, z: -0.8, r: 2.6, era: 0 as Era },
    { x: 131, y: 10.6, z: -1.0, r: 2.4, era: 3 as Era },
    { x: 146, y: 10.4, z: -0.6, r: 3.0, era: 1 as Era },
    { x: 168, y: 11.6, z: -1.2, r: 2.6, era: 2 as Era },
    { x: 202, y: 13.6, z: -1.4, r: 2.4, era: 3 as Era },
    { x: 236, y: 13.8, z: -1.0, r: 2.8, era: 0 as Era },
  ],

  decor: [
    { type: 'machine', pos: v3(-1.6, 0, -1.6) },
    { type: 'sign', pos: v3(7, 0, -1.2), seed: 1 },
    { type: 'tree', pos: v3(-5, 0, -2.2), scale: 1.2, seed: 1 },
    { type: 'tree', pos: v3(5.5, 0, -2.4), scale: 1, seed: 2 },
    { type: 'tree', pos: v3(19, 1, -2.2), scale: 1.3, seed: 3 },
    { type: 'tree', pos: v3(28.5, 1, -2.5), scale: 0.9, seed: 4 },
    { type: 'tree', pos: v3(38.5, 1, -2.3), scale: 1.15, seed: 5 },
    { type: 'tree', pos: v3(75, 0, -2.4), scale: 1.25, seed: 6 },
    { type: 'tree', pos: v3(88, 0, -2.2), scale: 1.1, seed: 7 },
    { type: 'tree', pos: v3(94, 0, -2.4), scale: 1.4, seed: 8 },
    { type: 'tree', pos: v3(15.6, -1, -4), scale: 0.8, seed: 9 },
    { type: 'tree', pos: v3(84, 0, -2.6), scale: 0.9, seed: 10 },
    { type: 'tree', pos: v3(116, PLATEAU, -2.3), scale: 1.2, seed: 11 },
    { type: 'tree', pos: v3(131.5, PLATEAU, -2.4), scale: 1.0, seed: 12 },
    { type: 'tree', pos: v3(127.6, PLATEAU, -2.7), scale: 1.3, seed: 13 },
    { type: 'bloomer', pos: v3(7.8, 0, -1.9), seed: 1 },
    { type: 'bloomer', pos: v3(25.2, 1, -1.9), seed: 2, scale: 1.2 },
    { type: 'bloomer', pos: v3(36.5, 1, -2.0), seed: 3 },
    { type: 'bloomer', pos: v3(41.2, 0, -2.1), seed: 4, scale: 1.3 },
    { type: 'bloomer', pos: v3(78, 0, -2.0), seed: 5, scale: 1.1 },
    { type: 'bloomer', pos: v3(90, 0, -1.9), seed: 6, scale: 1.4 },
    { type: 'bloomer', pos: v3(119.5, PLATEAU, -2.0), seed: 7, scale: 1.1 },
    { type: 'bloomer', pos: v3(137.5, PLATEAU, -2.0), seed: 8, scale: 1.3 },
    { type: 'flowers', pos: v3(1, 0, -1.2), seed: 1 },
    { type: 'flowers', pos: v3(16.5, 0, 1.4), seed: 2 },
    { type: 'flowers', pos: v3(20, 1, -1.1), seed: 3 },
    { type: 'flowers', pos: v3(32.2, 1, 1.2), seed: 4 },
    { type: 'flowers', pos: v3(42, 0, -1.2), seed: 5 },
    { type: 'flowers', pos: v3(73.5, 0, -1.1), seed: 6 },
    { type: 'flowers', pos: v3(86, 0, -1.3), seed: 7 },
    { type: 'flowers', pos: v3(92, 0, 1.2), seed: 8 },
    { type: 'flowers', pos: v3(104, 0, 7.4), seed: 9 },
    { type: 'flowers', pos: v3(127.5, PLATEAU, -1.2), seed: 10 },
    { type: 'flowers', pos: v3(148, PLATEAU, 1.2), seed: 11 },
    { type: 'mushroom', pos: v3(-3.5, 0, -1.0), seed: 1 },
    { type: 'mushroom', pos: v3(37.5, 1, 1.3), seed: 2 },
    { type: 'mushroom', pos: v3(55.5, 0, 1.5), seed: 3 },
    { type: 'mushroom', pos: v3(109.5, 0, 7.8), seed: 4 },
    // The secret: a big foreground bush hides three bits on the lane (clear of e2's patrol)
    { type: 'bush', pos: v3(45.0, 0, 1.75), scale: 1.15, seed: 1 },
    { type: 'bush', pos: v3(-4.6, 0, 1.9), scale: 0.9, seed: 2 },
    { type: 'bush', pos: v3(30.2, 1, 1.9), scale: 1.0, seed: 3 },
    { type: 'bush', pos: v3(83.4, 0, 1.9), scale: 1.1, seed: 4 },
    { type: 'bush', pos: v3(146, PLATEAU, 1.9), scale: 1.0, seed: 5 },
    { type: 'pillar', pos: v3(30.8, 1, -1.8), scale: 1.1, seed: 1 },
    { type: 'pillar', pos: v3(35.3, 1, -1.8), scale: 0.75, seed: 2 },
    { type: 'pillar', pos: v3(99.2, 0, -2.2), scale: 1.4, seed: 3 },
    { type: 'pillar', pos: v3(112.9, PLATEAU, -2.2), scale: 0.9, seed: 4 },
    { type: 'arch', pos: v3(33, 1, -2.4), seed: 1 },
    { type: 'rock', pos: v3(16, -0.2, -2.2), scale: 1.2, seed: 1 },
    { type: 'rock', pos: v3(45.8, 0, -2.0), scale: 0.8, seed: 2 },
    { type: 'rock', pos: v3(96, 0, -2.0), scale: 1.4, seed: 3 },
    { type: 'rock', pos: v3(124.5, PLATEAU - 9.5, -2.0), scale: 1.0, seed: 4 },
    // Hidden chamber — abandoned robots and machinery
    { type: 'statue', pos: v3(54.6, 0, -10.9), seed: 1 },
    { type: 'statue', pos: v3(57.0, 0, -10.9), seed: 2, scale: 1.25 },
    { type: 'gear', pos: v3(55.8, 2.3, -11.45), scale: 1.2, seed: 1 },
    { type: 'gear', pos: v3(58.6, 2.0, -11.45), scale: 0.8, seed: 2 },
    // Beyond the Frame Gate: the Halo Path
    { type: 'crystal', pos: v3(145.5, PLATEAU, -2.0), scale: 1.2, seed: 1 },
    { type: 'crystal', pos: v3(151, PLATEAU, -1.6), scale: 1.6, seed: 2 },
    { type: 'tree', pos: v3(155, PLATEAU, -2.4), scale: 1.2, seed: 14 },
    { type: 'flowers', pos: v3(163, PLATEAU, 1.2), seed: 12 },
    { type: 'tree', pos: v3(169, HALO, -2.5), scale: 1.35, seed: 15 },
    { type: 'bloomer', pos: v3(172.5, HALO, -2.0), seed: 9, scale: 1.2 },
    { type: 'rock', pos: v3(180, HALO, -2.2), scale: 1.1, seed: 5 },
    { type: 'mushroom', pos: v3(182.5, HALO, 1.4), seed: 5 },
    { type: 'pillar', pos: v3(199.5, SEAL, -2.2), scale: 1.2, seed: 5 },
    { type: 'flowers', pos: v3(205, SEAL, 1.2), seed: 13 },
    { type: 'pillar', pos: v3(211.6, SEAL, -2.2), scale: 1.3, seed: 6 },
    { type: 'tree', pos: v3(229, SEAL, -2.4), scale: 1.25, seed: 16 },
    { type: 'flowers', pos: v3(233, SEAL, 1.2), seed: 14 },
    { type: 'bloomer', pos: v3(238, SEAL, -2.0), seed: 10, scale: 1.3 },
    { type: 'arch', pos: v3(241.5, SEAL, -2.4), seed: 2 },
    { type: 'statue', pos: v3(251, SEAL, -2.6), seed: 3, scale: 1.6 },
    { type: 'crystal', pos: v3(249, SEAL, -1.6), scale: 1.4, seed: 3 },
  ] as DecorDef[],
};

export type Level = typeof LEVEL;
