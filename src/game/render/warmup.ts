import * as THREE from 'three';
import { GameView } from './GameView';
import { preloadAssets } from './assets';
import { loadHdSky } from './sky';
import { prepareScatter } from './dressing';
import { setPhase } from './loadProgress';
import type { Era } from '../era/EraSystem';
import type { Game } from '../sim/Game';

/**
 * The warm-up behind the loader: everything the title and the game will ever draw is compiled and uploaded
 * before the first interactive frame, so no generation switch, ripple, bubble or Pip model compiles a shader or
 * uploads a texture in play.
 *
 * Shader programs are cached per WebGL context by their material settings (the generation is a uniform, not a
 * variant), so drawing every object once in each lighting setup (the procedural sky, the day sky, the golden
 * sky, and the 8- and 16-bit tile paths) leaves nothing to compile later; the game's views reuse the programs.
 * Each configuration renders one real frame with every object shown and nothing culled, which also uploads
 * every texture and buffer and builds the skies' cube maps.
 */
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
async function until(cond: () => boolean, timeoutMs: number) {
  const end = performance.now() + timeoutMs;
  while (!cond() && performance.now() < end) await new Promise((r) => setTimeout(r, 50));
}

/**
 * Show everything, cull nothing; returns a function that puts it all back. Lights stay exactly as lit as they
 * are: the number of lights is part of every lit shader, so warming with a hidden lamp switched on would
 * compile every program for one light too many.
 */
function exposeAll(scene: THREE.Scene) {
  const lit = new Set<THREE.Object3D>();
  scene.traverseVisible((o) => (o as THREE.Light).isLight && lit.add(o));
  const saved: [THREE.Object3D, boolean, boolean][] = [];
  scene.traverse((o) => {
    saved.push([o, o.visible, o.frustumCulled]);
    o.visible = (o as THREE.Light).isLight ? lit.has(o) : true;
    o.frustumCulled = false;
  });
  return () => {
    for (const [o, v, f] of saved) {
      o.visible = v;
      o.frustumCulled = f;
    }
  };
}

interface Config {
  era: Era;
  mode: '2d' | '3d';
  split?: boolean;
}

/** One view through each configuration: compile in parallel where the browser can, then draw a frame. */
async function warmView(gl: THREE.WebGLRenderer, view: GameView, configs: Config[], done: (k: number) => void) {
  const g = view.game;
  const before = { era: g.era.era, mode: g.shift.mode, split: !!view.options.split, laneZ: g.shift.laneZ };
  for (const [k, c] of configs.entries()) {
    view.options.split = !!c.split;
    g.era.set(c.era);
    g.shift.set(c.mode);
    if (c.mode === '2d') g.shift.laneZ = 0;
    g.camera.snap(g.cameraContext());
    // non-blocking compile (KHR_parallel_shader_compile), then a real frame for whatever it doesn't cover
    // (shadow-map programs, the post passes, texture and buffer uploads). The view is updated right before
    // each, since the page's own frames may run in between.
    const t0 = performance.now();
    view.update(1 / 60);
    let restore = exposeAll(view.scene);
    const compiling = gl.compileAsync(view.scene, view.camera);
    restore();
    await compiling;
    const t1 = performance.now();
    view.update(1 / 60);
    restore = exposeAll(view.scene);
    try {
      view.render(gl);
    } finally {
      restore();
    }
    if (import.meta.env.DEV) console.debug(`[warm] era ${c.era} ${c.mode}${c.split ? ' split' : ''}: compile ${(t1 - t0).toFixed(0)} ms, frame ${(performance.now() - t1).toFixed(0)} ms, programs ${gl.info.programs?.length}`);
    done(k + 1);
    await frame();
  }
  view.options.split = before.split;
  g.era.set(before.era as Era);
  g.shift.set(before.mode);
  g.shift.laneZ = before.laneZ;
  g.camera.snap(g.cameraContext());
}

const EVERY: Config[] = [
  { era: 5, mode: '3d', split: true },
  { era: 0, mode: '2d' },
  { era: 1, mode: '2d' },
  { era: 2, mode: '3d' },
  { era: 3, mode: '3d' },
  { era: 4, mode: '3d' },
  { era: 5, mode: '3d' },
  { era: 5, mode: '2d' },
];

/** Per WebGL context: what's compiled and uploaded belongs to the context. */
const started = new WeakMap<THREE.WebGLRenderer, Promise<void>>();

/**
 * Called once by the title screen. Waits for the downloads, then warms the title view and a stand-in of the
 * game's view (the level as played, built and thrown away). Resolves when everything is ready.
 */
export function warmUp(gl: THREE.WebGLRenderer, menuView: GameView, makePlayGame: () => Game): Promise<void> {
  let run = started.get(gl);
  if (run) return run;
  run = (async () => {
    setPhase('download');
    await Promise.all([preloadAssets(), loadHdSky(gl, 'day'), loadHdSky(gl, 'golden')]);
    await until(() => !!menuView.title?.ready && menuView.pipHD.ready && menuView.terrain.ready, 15000);
    setPhase('unfold');
    await prepareScatter();
    const play = new GameView(makePlayGame(), menuView.camera, gl, { split: true, immersive: true });
    await until(() => play.dressing.ready && play.terrain.ready && play.pipHD.ready, 15000);
    const total = 6 + EVERY.length;
    setPhase('warm', 0);
    await warmView(
      gl,
      menuView,
      ([0, 1, 2, 3, 4, 5] as Era[]).map((era) => ({ era, mode: '3d' })),
      (k) => setPhase('warm', k / total),
    );
    await warmView(gl, play, EVERY, (k) => setPhase('warm', (6 + k) / total));
    play.dispose();
    setPhase('done');
    if (import.meta.env.DEV) watchLateCompiles(gl);
  })();
  started.set(gl, run);
  return run;
}

/** Dev: names every shader program compiled after the warm-up (each one is a possible hitch it missed). */
function watchLateCompiles(gl: THREE.WebGLRenderer) {
  const seen = new Set(gl.info.programs ?? []);
  const look = () => {
    for (const p of gl.info.programs ?? []) {
      if (seen.has(p)) continue;
      seen.add(p);
      const prog = p as unknown as { name: string; cacheKey: string };
      // the nearest warmed program of the same material: which settings differ
      const fields = prog.cacheKey.split(',');
      let best: string[] | null = null;
      let bestDiff = 1e9;
      for (const q of seen) {
        const o = q as unknown as { name: string; cacheKey: string };
        if (o === prog || o.name !== prog.name) continue;
        const f = o.cacheKey.split(',');
        const d = f.reduce((n, v, i) => n + (v !== fields[i] ? 1 : 0), Math.abs(f.length - fields.length));
        if (d < bestDiff) (bestDiff = d), (best = f);
      }
      const diff = best ? fields.map((v, i) => (v !== best![i] ? `#${i}:${best![i]}->${v}` : '')).filter(Boolean).join(' ') : 'no warmed sibling';
      let src = '';
      if (!prog.name) {
        const ctx = gl.getContext();
        const fs = (p as unknown as { fragmentShader: WebGLShader }).fragmentShader;
        const text = ctx.getShaderSource(fs) ?? '';
        src = text.slice(Math.max(0, text.indexOf('void main') - 400)).replace(/\s+/g, ' ').slice(0, 700);
      }
      console.debug(`[warm] late compile: ${prog.name || '(unnamed)'} [${diff}] ${prog.cacheKey.slice(-60).replace(/\s+/g, ' ')} ${src}`);
    }
    requestAnimationFrame(look);
  };
  look();
}
