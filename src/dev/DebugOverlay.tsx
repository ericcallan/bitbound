import { useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import { session } from '../ui/session';
import { ERA_NAMES } from '../game/era/EraSystem';
import { SHIFT_BLOCK_LABEL } from '../game/shift/DimensionShift';
import { DebugDraw, type DebugLayer } from './debugDraw';

/**
 * Development-only debug overlay. Toggle with ` (backquote). Shows the live state of the generation, Pip, the
 * shift and the camera, frame timing, and optional layers drawn into the scene. Loaded by dynamic import from
 * App only when import.meta.env.DEV, so production builds don't contain it.
 */
const LAYERS: [DebugLayer, string][] = [
  ['colliders', 'Collision boxes'],
  ['pip', "Pip's bounds"],
  ['rays', 'Camera rays'],
  ['route', 'Route graph'],
  ['unfold', 'Nearest unfold spot'],
  ['occluders', 'Fading occluders'],
];

interface View {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}
interface Dev {
  view?: View;
  gl?: THREE.WebGLRenderer;
}

const f2 = (n: number) => n.toFixed(2);

export function DebugOverlay() {
  const [open, setOpen] = useState(false);
  const [layers, setLayers] = useState<Set<DebugLayer>>(new Set());
  const [text, setText] = useState('');
  const draw = useRef<{ d: DebugDraw; scene: THREE.Scene } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '`') setOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let acc = 0;
    let fps = 0;
    let worst = 0;
    let frameCalls = 0;
    let frameTris = 0;
    const dev0 = session as unknown as Dev;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = now - last;
      last = now;
      frames++;
      acc += dt;
      worst = Math.max(worst, dt);
      if (dev0.gl) {
        dev0.gl.info.autoReset = false;
        frameCalls += dev0.gl.info.render.calls;
        frameTris += dev0.gl.info.render.triangles;
        dev0.gl.info.reset();
      }
      const g = session.game ?? session.menuGame;
      const dev = session as unknown as Dev;
      if (!g || !dev.view) return;
      // the scene layers follow the live view (a new game makes a new one)
      if (!draw.current || draw.current.scene !== dev.view.scene) {
        draw.current?.d.dispose();
        draw.current = { d: new DebugDraw(dev.view.scene), scene: dev.view.scene };
      }
      draw.current.d.layers = layers;
      draw.current.d.update(g);
      if (acc < 250) return;
      fps = (frames * 1000) / acc;
      const p = g.player;
      const cam = g.camera;
      const block = g.shift.unlocked ? g.shift.check() : 'locked';
      const camDist = Math.hypot(cam.pos.x - cam.target.x, cam.pos.y - cam.target.y, cam.pos.z - cam.target.z);
      // the renderer resets its counters per render pass (scene, then each post pass); count the whole frame
      const gl = dev.gl;
      const info = gl ? { calls: frameCalls / Math.max(1, frames), triangles: frameTris / Math.max(1, frames) } : null;
      setText(
        [
          `generation  ${ERA_NAMES[g.era.era]}${g.era.transition ? ` → ${ERA_NAMES[g.era.transition.to]}` : ''} · at Pip ${ERA_NAMES[g.pipEra]}${g.era.bubble ? ` · bubble ${ERA_NAMES[g.era.bubble.era]}` : ''}`,
          `position    ${f2(p.pos.x)}, ${f2(p.pos.y)}, ${f2(p.pos.z)}`,
          `velocity    ${f2(p.vel.x)}, ${f2(p.vel.y)}, ${f2(p.vel.z)}`,
          `grounded    ${p.grounded ? `yes, on ${p.ground?.id ?? '?'}` : `no (air ${f2(p.airTime)} s)`}`,
          `perspective ${g.shift.mode.toUpperCase()}${g.shift.transition ? ` → ${g.shift.transition.to.toUpperCase()} ${Math.round((g.shift.transition.t / g.shift.transition.dur) * 100)}%` : ''} · lane z ${f2(g.shift.laneZ)}`,
          `shift       ${block ? `blocked: ${block} (${SHIFT_BLOCK_LABEL[block]})` : 'ready'}`,
          `camera      dist ${f2(camDist)} · fov ${f2(cam.fov)} · ${cam.occlusion.by === 'none' ? 'clear' : `blocked by ${cam.occlusion.by}, kept ${Math.round(cam.occlusion.kept * 100)}%`}`,
          `checkpoint  ${g.checkpoint} · cells ${g.cells}/${g.maxCells}${g.cine ? ` · cinematic ${g.cine.name}` : ''}`,
          `frame       ${f2(fps)} fps · ${f2(acc / frames)} ms avg · ${f2(worst)} ms worst`,
          info ? `draws       ${Math.round(info.calls)} calls · ${(info.triangles / 1e6).toFixed(2)} M triangles per frame (all passes)` : '',
        ].join('\n'),
      );
      frames = 0;
      acc = 0;
      worst = 0;
      frameCalls = 0;
      frameTris = 0;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (dev0.gl) dev0.gl.info.autoReset = true;
    };
  }, [open, layers]);

  useEffect(() => {
    if (open) return;
    const g = session.game ?? session.menuGame;
    if (!draw.current || !g) return;
    draw.current.d.layers = new Set();
    draw.current.d.update(g);
  }, [open]);

  if (!open) return null;
  return (
    <div className="debug-overlay" onKeyDown={(e) => e.stopPropagation()}>
      <div className="debug-overlay__title">Debug · ` to close</div>
      <pre>{text}</pre>
      <div className="debug-overlay__layers">
        {LAYERS.map(([id, label]) => (
          <label key={id}>
            <input
              type="checkbox"
              checked={layers.has(id)}
              onChange={(e) => {
                const next = new Set(layers);
                if (e.target.checked) next.add(id);
                else next.delete(id);
                setLayers(next);
                (e.target as HTMLInputElement).blur();
              }}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}
