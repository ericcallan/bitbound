import { easeInOutSine, type V3 } from '../math';

/**
 * The six graphical generations. They are a rendering treatment over one shared world and
 * are independent of perspective (2D/3D).
 */
export type Era = 0 | 1 | 2 | 3 | 4 | 5;
export const ERA_COUNT = 6;
export const ERAS: Era[] = [0, 1, 2, 3, 4, 5];

export const ERA_NAMES = ['8-BIT', '16-BIT', 'EARLY 3D', 'STYLIZED', 'MODERN HD', 'BEYOND'] as const;
/** Each generation arrives as a patch to the world (the story's frame): the story moments' banner subtitles. */
export const ERA_TITLES = ['Version 1.0', 'Patch 2.0 · Colour', 'Patch 3.0 · Depth', 'Patch 4.0 · Ink', 'Patch 5.0 · Light', 'Patch 6.0 · Every version at once'] as const;
/** The year each generation stands for: when its look was the state of the art. */
export const ERA_YEARS = [1985, 1991, 1996, 2002, 2013, 2026] as const;
/** Generation names for sentences and flags (ERA_NAMES are the HUD's capitals). */
export const ERA_LABELS = ['8-Bit', '16-Bit', 'Early 3D', 'Stylized', 'Modern HD', 'Beyond'] as const;
/** The flag shown on every switch: "Generation 3 (1996): Early 3D". */
export const generationFlag = (e: Era) => `Generation ${e + 1} (${ERA_YEARS[e]}): ${ERA_LABELS[e]}`;
export const ERA_BLURBS = [
  'Chunky sprites, 16 colours',
  'Painted pixels, rich palette',
  'Low-poly, wobbly polygons',
  'Cel-shaded cartoon',
  'Clean physically based lighting',
  'Light, depth and generations at once',
] as const;

export interface EraTransition {
  from: Era;
  to: Era;
  t: number;
  dur: number;
  center: V3;
}

/**
 * A generation rift: a drifting bubble in the Beyond era inside which the world renders in an
 * older generation. Purely visual — it never changes collision or gameplay.
 */
export interface Rift {
  x: number;
  y: number;
  z: number;
  r: number;
  era: Era;
}

interface RiftAnchor {
  x: number;
  y: number;
  z: number;
  r: number;
  era: Era;
  phase: number;
}

/** Pip's Regress bubble: a sphere of an older (or full) generation projected around him. */
export interface Bubble {
  x: number;
  y: number;
  z: number;
  r: number;
  era: Era;
}

/** An authored region stuck on an older generation (a spot that never finished updating). */
export interface EraField {
  min: V3;
  max: V3;
  era: Era;
}

export const RIPPLE_MAX_RADIUS = 220;
export const MAX_RIFTS = 4;
export const MAX_FIELDS = 4;

const inBox = (p: V3, f: EraField) =>
  p.x >= f.min.x && p.x <= f.max.x && p.y >= f.min.y && p.y <= f.max.y && p.z >= f.min.z && p.z <= f.max.z;

/**
 * Graphical generation state. A change spreads through the world as a spherical ripple;
 * anything inside the radius renders in the new era.
 */
export class EraSystem {
  era: Era = 0;
  transition: EraTransition | null = null;
  /** Dev scenarios turn the drifting rifts off so screenshots are reproducible. */
  riftsEnabled = true;
  /** Active rifts (only while the world is in the Beyond generation). */
  rifts: Rift[] = [];
  private anchors: RiftAnchor[] = [];
  private time = 0;
  /** Rift strength 0..1 (fades in after reaching Beyond). */
  riftStrength = 0;
  /** The player's Regress bubble (gameplay-affecting). */
  bubble: Bubble | null = null;
  /** Censor fields (gameplay-affecting). */
  fields: EraField[] = [];

  constructor(riftAnchors: { x: number; y: number; z: number; r: number; era: Era }[] = []) {
    this.anchors = riftAnchors.map((a, i) => ({ ...a, phase: i * 1.7 }));
  }

  start(to: Era, center: V3, dur = 2.4) {
    if (to === this.era && !this.transition) return false;
    const from = this.transition ? this.transition.to : this.era;
    if (to === from) return false;
    this.era = from;
    this.transition = { from, to, t: 0, dur, center: { ...center } };
    return true;
  }

  get radius() {
    const tr = this.transition;
    if (!tr) return 0;
    return easeInOutSine(Math.min(1, tr.t / tr.dur)) * RIPPLE_MAX_RADIUS;
  }

  /** Era before rifts are applied (ripple only). */
  baseEraAt(p: V3): Era {
    const tr = this.transition;
    if (!tr) return this.era;
    const d = Math.hypot(p.x - tr.center.x, p.y - tr.center.y, p.z - tr.center.z);
    return d < this.radius ? tr.to : tr.from;
  }

  /**
   * The generation whose *rules* apply at a point: ripple, then censor fields, then Pip's bubble.
   * (Rifts are ambient visuals and never change gameplay.)
   */
  gameEraAt(p: V3): Era {
    let e = this.baseEraAt(p);
    for (const f of this.fields) if (inBox(p, f)) e = f.era;
    const b = this.bubble;
    if (b && Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z) < b.r) e = b.era;
    return e;
  }

  /** Generation for a box (a collider): the bubble wins if it touches any part of the box. */
  gameEraAtBox(min: V3, max: V3): Era {
    const c = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
    let e = this.baseEraAt(c);
    for (const f of this.fields) {
      if (min.x <= f.max.x && max.x >= f.min.x && min.y <= f.max.y && max.y >= f.min.y && min.z <= f.max.z && max.z >= f.min.z) e = f.era;
    }
    const b = this.bubble;
    if (b) {
      const dx = Math.max(min.x - b.x, 0, b.x - max.x);
      const dy = Math.max(min.y - b.y, 0, b.y - max.y);
      const dz = Math.max(min.z - b.z, 0, b.z - max.z);
      if (dx * dx + dy * dy + dz * dz < b.r * b.r) e = b.era;
    }
    return e;
  }

  /** Era as rendered at a world position (ripple, fields, bubble, then ambient rifts). */
  eraAt(p: V3): Era {
    const base = this.gameEraAt(p);
    const inBubble = this.bubble && Math.hypot(p.x - this.bubble.x, p.y - this.bubble.y, p.z - this.bubble.z) < this.bubble.r;
    if (base === 5 && !inBubble && this.riftStrength > 0.5) {
      for (const r of this.rifts) {
        if (Math.hypot(p.x - r.x, p.y - r.y, p.z - r.z) < r.r) return r.era;
      }
    }
    return base;
  }

  /** The era the gameplay/UI considers current (switches once the ripple is under way). */
  get displayEra(): Era {
    const tr = this.transition;
    if (!tr) return this.era;
    return tr.t / tr.dur > 0.25 ? tr.to : tr.from;
  }

  /** The era the world is heading to (for saving). */
  get targetEra(): Era {
    return this.transition ? this.transition.to : this.era;
  }

  step(dt: number, focusX = 0): Era | null {
    this.time += dt;
    const beyond = this.targetEra === 5 && (!this.transition || this.transition.t / this.transition.dur > 0.9);
    this.riftStrength = Math.max(0, Math.min(1, this.riftStrength + (beyond ? dt * 0.4 : -dt * 2)));
    this.updateRifts(focusX);
    const tr = this.transition;
    if (!tr) return null;
    tr.t += dt;
    if (tr.t >= tr.dur) {
      this.era = tr.to;
      this.transition = null;
      return this.era;
    }
    return null;
  }

  /** The rifts nearest the focus drift on slow Lissajous paths around their anchors. */
  private updateRifts(focusX: number) {
    if (!this.riftsEnabled || this.riftStrength <= 0 || this.anchors.length === 0) {
      this.rifts.length = 0;
      return;
    }
    const t = this.time;
    const nearest = [...this.anchors].sort((a, b) => Math.abs(a.x - focusX) - Math.abs(b.x - focusX)).slice(0, MAX_RIFTS);
    this.rifts = nearest.map((a) => ({
      x: a.x + Math.sin(t * 0.21 + a.phase) * 2.2,
      y: a.y + Math.sin(t * 0.33 + a.phase * 2) * 0.6,
      z: a.z + Math.cos(t * 0.17 + a.phase) * 1.4,
      r: a.r * (0.92 + 0.08 * Math.sin(t * 0.9 + a.phase)) * this.riftStrength,
      era: a.era,
    }));
  }

  set(e: Era) {
    this.era = e;
    this.transition = null;
  }
}
