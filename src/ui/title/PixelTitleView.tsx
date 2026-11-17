import { useEffect, useRef } from 'react';
import { PixelTitle, type PixelGen } from './pixelTitle';
import { session } from '../session';

/** Seconds for the mosaic transition in or out. */
const MOSAIC = 0.45;
/** Largest mosaic block, in native pixels. */
const BLOCK = 14;

/**
 * Shows the 8-bit or 16-bit title scene (pixelTitle.ts) over the 3D title set, scaled by whole pixels with bars
 * filling what's left, like the in-game retro frames. Changing generation goes through a mosaic: the picture
 * breaks into growing blocks and resolves again. While a pixel scene fully covers the screen the 3D scene stops
 * rendering (session.menuCovered).
 */
export function PixelTitleView({ gen }: { gen: PixelGen | null }) {
  const host = useRef<HTMLDivElement>(null);
  const shown = useRef<{ gen: PixelGen; scene: PixelTitle } | null>(null);
  const scenes = useRef<Partial<Record<PixelGen, PixelTitle>>>({});
  const want = useRef<PixelGen | null>(gen);
  want.current = gen;

  useEffect(() => {
    const el = host.current!;
    const display = document.createElement('canvas');
    display.className = 'pixel-title__canvas';
    el.appendChild(display);
    const dctx = display.getContext('2d')!;
    let raf = 0;
    let last = performance.now();
    let t = 0;
    // 0 = hidden, 1 = fully shown; the mosaic block size follows it
    let level = 0;
    let k = 1;
    const scene = (g: PixelGen) => (scenes.current[g] ??= new PixelTitle(g));
    // both scenes up front, so the 16-bit sprites are loaded before anyone picks 16-bit
    scene(0);
    scene(1);
    const layout = () => {
      const s = shown.current?.scene;
      if (!s) return;
      k = s.resize(window.innerWidth, window.innerHeight);
      display.width = s.canvas.width;
      display.height = s.canvas.height;
      display.style.width = `${display.width * k}px`;
      display.style.height = `${display.height * k}px`;
      dctx.imageSmoothingEnabled = false;
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      t += dt;
      const target = want.current;
      // switching between 8-bit and 16-bit goes out and back in through the mosaic
      const switching = !!shown.current && target !== null && target !== shown.current.gen;
      const pending = target !== null && !scene(target).loaded;
      // once fully out, take on the wanted scene (or none)
      if (level === 0 && target !== null && !pending && (!shown.current || switching)) {
        shown.current = { gen: target, scene: scene(target) };
        layout();
      }
      if (level === 0 && target === null) shown.current = null;
      const out = target === null || pending || (shown.current !== null && target !== shown.current.gen);
      const goal = out ? 0 : 1;
      level = goal > level ? Math.min(goal, level + dt / MOSAIC) : Math.max(goal, level - dt / MOSAIC);
      session.menuCovered = level >= 1;
      el.style.opacity = String(Math.min(1, level * 1.6));
      el.style.visibility = level > 0 ? 'visible' : 'hidden';
      const s = shown.current?.scene;
      if (!s || level === 0) return;
      s.draw(t);
      const b = Math.max(1, Math.round(1 + (1 - level) * (BLOCK - 1)));
      const W = display.width;
      const H = display.height;
      if (b === 1) {
        dctx.drawImage(s.canvas, 0, 0);
      } else {
        const w = Math.ceil(W / b);
        const h = Math.ceil(H / b);
        dctx.drawImage(s.canvas, 0, 0, W, H, 0, 0, w, h);
        dctx.drawImage(display, 0, 0, w, h, 0, 0, W, H);
      }
    };
    raf = requestAnimationFrame(tick);
    const onResize = () => layout();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      session.menuCovered = false;
      el.removeChild(display);
    };
  }, []);

  return <div ref={host} className="pixel-title" aria-hidden />;
}
