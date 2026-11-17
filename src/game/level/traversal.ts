import { World, type Collider } from '../collision/World';
import { PlayerController } from '../player/PlayerController';
import { PIP_SIZE, STEP } from '../sim/constants';

/**
 * Traversal validation: what Pip can actually do (measured by running the real controller), and the level's 2D
 * route as a graph of standable surfaces built from the real colliders. Used by src/test/traversal.test.ts and
 * the debug overlay; documented in docs/TRAVERSAL.md.
 */

// ---------------------------------------------------------------- Pip's movement envelope

export interface Envelope {
  /** Top running speed (units/s). */
  runSpeed: number;
  /** Seconds from standing to 90% of top speed. */
  accelTime: number;
  /** Peak height of a tapped jump and a held jump (feet above takeoff). */
  tapHeight: number;
  heldHeight: number;
  /** Air time of a held jump landing at takeoff height. */
  airTime: number;
  /** Horizontal distance the air control can reverse within a held jump (stop and go back). */
  airTurn: number;
  /**
   * The running, held jump's trajectory relative to the takeoff edge: x is how far the front of Pip's box is past
   * the edge, y the height of his feet. Sampled every simulation step.
   */
  arc: { x: number; y: number }[];
}

/** Largest gap (edge to edge) the measured jump clears onto a surface `dh` higher (negative: lower). */
export function reach(env: Envelope, dh: number): number {
  let best = -Infinity;
  for (const p of env.arc) if (p.y >= dh) best = Math.max(best, p.x);
  return best;
}

function runJump(hold: boolean, maxT = 3) {
  const w = new World();
  w.add('runway', 'ground', { min: { x: -200, y: -1, z: -5 }, max: { x: 0, y: 0, z: 5 } });
  const p = new PlayerController(w, () => {});
  p.teleport({ x: -60, y: 0, z: 0 });
  // settle, then run to full speed toward the edge at x = 0
  for (let i = 0; i < 30; i++) p.step(STEP, { mx: 0, mz: 0, jumpPressed: false, jumpHeld: false }, '2d');
  let t = 0;
  let accelTime = -1;
  let jumped = false;
  let pressedAt = 0;
  const arc: { x: number; y: number }[] = [];
  let peak = 0;
  while (t < maxT + 20) {
    // jump at the last moment the box still touches the runway
    const press = !jumped && p.pos.x - PIP_SIZE.hw >= -0.04;
    if (press) {
      jumped = true;
      pressedAt = t;
    }
    const held = jumped && (hold || t - pressedAt < STEP * 1.5);
    p.step(STEP, { mx: 1, mz: 0, jumpPressed: press, jumpHeld: held }, '2d');
    t += STEP;
    if (accelTime < 0 && Math.abs(p.vel.x) >= 0.9 * p.p.runSpeed) accelTime = t;
    if (jumped) {
      arc.push({ x: p.pos.x + PIP_SIZE.hw, y: p.pos.y });
      peak = Math.max(peak, p.pos.y);
      if (p.pos.y < -8) break;
    }
  }
  return { arc, peak, accelTime, speed: Math.abs(p.vel.x) };
}

function airTurn() {
  // a held jump from standing still, steering forward then hard back: how far forward it got before returning
  const w = new World();
  w.add('floor', 'ground', { min: { x: -50, y: -1, z: -5 }, max: { x: 50, y: 0, z: 5 } });
  const p = new PlayerController(w, () => {});
  p.teleport({ x: 0, y: 0, z: 0 });
  for (let i = 0; i < 30; i++) p.step(STEP, { mx: 0, mz: 0, jumpPressed: false, jumpHeld: false }, '2d');
  let maxX = 0;
  for (let i = 0; i < 400; i++) {
    const back = i > 18;
    p.step(STEP, { mx: back ? -1 : 1, mz: 0, jumpPressed: i === 0, jumpHeld: true }, '2d');
    maxX = Math.max(maxX, p.pos.x);
    if (i > 5 && p.grounded) break;
  }
  return maxX - p.pos.x;
}

let cached: Envelope | null = null;
/** Measured once per process (deterministic: fixed steps, no randomness). */
export function measurePip(): Envelope {
  if (cached) return cached;
  const held = runJump(true);
  const tap = runJump(false);
  // air time: until the held arc comes back down to the takeoff height
  const land = held.arc.findIndex((p, i) => i > 5 && p.y <= 0);
  cached = {
    runSpeed: held.speed,
    accelTime: held.accelTime,
    tapHeight: tap.peak,
    heldHeight: held.peak,
    airTime: land * STEP,
    airTurn: airTurn(),
    arc: held.arc,
  };
  return cached;
}

// ---------------------------------------------------------------- the 2D route graph

export interface Segment {
  id: string;
  /** The collider this is (part of). */
  src: string;
  x0: number;
  x1: number;
  top: number;
  /** A moving platform: x0..x1 is the whole span it sweeps. */
  mover?: boolean;
}

export interface Edge {
  from: string;
  to: string;
  /** Edge-to-edge gap (0 when the surfaces overlap or touch) and the height difference (to - from). */
  gap: number;
  dh: number;
  kind: 'walk' | 'drop' | 'jump';
  /** How much more the measured jump could clear (units); Infinity for walking and dropping. */
  margin: number;
}

/** Solids that stand on the lane (z = 0) in the flattened world. */
function onLane(c: Collider) {
  return c.min.z <= 0.05 && c.max.z >= -0.05;
}

/**
 * Standable surfaces on the 2D lane, split wherever a wall stands across the lane at walking height. Walls with a
 * generation mask (light fences, brambles) don't split: Regress can always switch them off; disabled walls (the
 * opened seal door) don't either.
 */
export function laneSegments(world: World, movers: { id: string; minX: number; maxX: number; halfW: number; y: number }[]): Segment[] {
  const walls = world.colliders.filter((c) => c.enabled && c.kind === 'wall' && c.genMask === undefined && onLane(c));
  const out: Segment[] = [];
  for (const c of world.colliders) {
    if (!c.enabled || !onLane(c) || c.kind === 'wall' || c.kind === 'cube' || c.id.startsWith('edge')) continue;
    if (c.kind === 'invisible' && !c.only2d) continue;
    if (movers.some((m) => m.id === c.id)) continue;
    const cuts = walls
      .filter((w) => w.min.x > c.min.x && w.max.x < c.max.x && w.min.y < c.max.y + PIP_SIZE.h && w.max.y > c.max.y + 0.05)
      .sort((a, b) => a.min.x - b.min.x);
    let x = c.min.x;
    let k = 0;
    for (const w of cuts) {
      out.push({ id: `${c.id}#${k++}`, src: c.id, x0: x, x1: w.min.x, top: c.max.y });
      x = w.max.x;
    }
    out.push({ id: cuts.length ? `${c.id}#${k}` : c.id, src: c.id, x0: x, x1: c.max.x, top: c.max.y });
  }
  for (const m of movers) out.push({ id: m.id, src: m.id, x0: m.minX - m.halfW, x1: m.maxX + m.halfW, top: m.y, mover: true });
  return out;
}

/** Every move between two surfaces the measured envelope allows (both directions are considered separately). */
export function laneEdges(segs: Segment[], env: Envelope): Edge[] {
  const out: Edge[] = [];
  const hw = PIP_SIZE.hw;
  for (const a of segs) {
    for (const b of segs) {
      if (a === b) continue;
      const dh = b.top - a.top;
      const gap = Math.max(0, b.x0 - a.x1, a.x0 - b.x1);
      const overlap = b.x0 < a.x1 + hw && b.x1 > a.x0 - hw;
      if (overlap && Math.abs(dh) < 0.35) out.push({ from: a.id, to: b.id, gap: 0, dh, kind: 'walk', margin: Infinity });
      else if (overlap && dh < 0) out.push({ from: a.id, to: b.id, gap: 0, dh, kind: 'drop', margin: Infinity });
      else {
        const r = reach(env, dh);
        if (gap <= r && dh <= env.heldHeight) out.push({ from: a.id, to: b.id, gap, dh, kind: 'jump', margin: r - gap });
      }
    }
  }
  return out;
}

/** Breadth-first search; returns each reached node's parent edge. */
export function search(edges: Edge[], start: string, reverse = false) {
  const adj = new Map<string, Edge[]>();
  for (const e of edges) {
    const k = reverse ? e.to : e.from;
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k)!.push(e);
  }
  const parent = new Map<string, Edge | null>([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const n = queue.shift()!;
    for (const e of adj.get(n) ?? []) {
      const m = reverse ? e.from : e.to;
      if (parent.has(m)) continue;
      parent.set(m, e);
      queue.push(m);
    }
  }
  return parent;
}

/**
 * The safest route: the path whose tightest jump has the most room to spare (a widest-path search). This is the
 * way a player goes; shortcuts that need a near-perfect jump are found separately (see `shortcuts`).
 */
export function safestPath(edges: Edge[], start: string, goal: string): Edge[] | null {
  const best = new Map<string, number>([[start, Infinity]]);
  const via = new Map<string, Edge>();
  const open = new Set([start]);
  while (open.size) {
    let n = '';
    let nb = -Infinity;
    for (const k of open) if (best.get(k)! > nb) (nb = best.get(k)!), (n = k);
    open.delete(n);
    if (n === goal) break;
    for (const e of edges) {
      if (e.from !== n) continue;
      const m = Math.min(nb, e.margin);
      if (m > (best.get(e.to) ?? -Infinity)) {
        best.set(e.to, m);
        via.set(e.to, e);
        open.add(e.to);
      }
    }
  }
  if (!via.has(goal)) return null;
  const path: Edge[] = [];
  for (let k = goal; k !== start; k = via.get(k)!.from) path.unshift(via.get(k)!);
  return path;
}

/** Whether a held, running jump off either edge of a surface (or straight up from it) passes through a point. */
export function arcReaches(env: Envelope, s: Segment, px: number, py: number, radius: number) {
  const hw = PIP_SIZE.hw;
  const mid = PIP_SIZE.h / 2;
  // straight up from anywhere on the surface
  if (px >= s.x0 - radius && px <= s.x1 + radius && py - (s.top + mid) <= env.heldHeight + radius && py >= s.top - radius) return true;
  for (const p of env.arc) {
    const cy = s.top + p.y + mid;
    // off the right edge (Pip's centre is hw behind his box front) and off the left edge
    if (Math.hypot(s.x1 + p.x - hw - px, cy - py) < radius) return true;
    if (Math.hypot(s.x0 - p.x + hw - px, cy - py) < radius) return true;
  }
  return false;
}

/** The surface under a point on the lane (highest top at or below y). */
export function segmentAt(segs: Segment[], x: number, y: number) {
  let best: Segment | null = null;
  for (const s of segs) if (x >= s.x0 - 0.01 && x <= s.x1 + 0.01 && s.top <= y + 0.05 && (!best || s.top > best.top)) best = s;
  return best;
}
