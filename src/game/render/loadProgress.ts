/**
 * What the loader shows: how much of the world has arrived (bytes, where the loaders report them) and what is
 * happening now. Every model, texture and sky registers here as it starts; items that report no byte counts
 * weigh in at an estimate until they finish.
 */
export type LoadPhase = 'download' | 'unfold' | 'warm' | 'done';

interface Item {
  loaded: number;
  total: number;
  done: boolean;
}

const items = new Map<string, Item>();
let phase: LoadPhase = 'download';
/** 0..1 within the warm-up, which the loader shows as the last stretch of the bar. */
let warm = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Typical file size for items that don't report progress (images, small files). */
const ESTIMATE = 300_000;

export function trackStart(key: string, estimate = ESTIMATE) {
  if (!items.has(key)) items.set(key, { loaded: 0, total: estimate, done: false });
  emit();
}
export function trackBytes(key: string, loaded: number, total: number) {
  const it = items.get(key) ?? { loaded: 0, total: 0, done: false };
  it.loaded = loaded;
  if (total > 0) it.total = total;
  items.set(key, it);
  emit();
}
export function trackDone(key: string) {
  const it = items.get(key);
  if (it) {
    it.done = true;
    it.loaded = it.total;
  }
  emit();
}
/** Wrap a load: registered now, done when it settles (failed loads count as done; the loader moves on). */
export function track<T>(key: string, p: Promise<T>, estimate?: number): Promise<T> {
  trackStart(key, estimate);
  p.then(
    () => trackDone(key),
    () => trackDone(key),
  );
  return p;
}

export function setPhase(p: LoadPhase, w = 0) {
  phase = p;
  warm = w;
  emit();
}

/** Downloads are 85% of the bar, the warm-up the rest. */
export function loadState() {
  let loaded = 0;
  let total = 0;
  for (const it of items.values()) {
    loaded += Math.min(it.loaded, it.total);
    total += it.total;
  }
  const dl = total > 0 ? loaded / total : 0;
  const fraction = phase === 'done' ? 1 : phase === 'warm' ? 0.85 + 0.15 * warm : dl * 0.85;
  return { phase, fraction, bytes: loaded, totalBytes: total };
}

export function onLoadChange(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
