import { useEffect, useRef } from 'react';
import { drawFace, drawPortrait, FACE_RES } from '../game/pip/face';
import type { Expression } from '../game/sim/Game';
import type { Era } from '../game/era/EraSystem';

/** Pip's live head portrait, drawn with the same face art as the in-world rig. */
export function Portrait({ expression, era, size = 64 }: { expression: Expression; era: Era; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const face = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  useEffect(() => {
    const res = era === 0 ? 24 : era === 1 ? 48 : era === 2 ? 40 : size * 2;
    const cv = ref.current!;
    cv.width = cv.height = res;
    const ctx = cv.getContext('2d')!;
    const fc = face.current;
    fc.width = fc.height = FACE_RES[era];
    const fctx = fc.getContext('2d')!;
    let blink = false;
    let t = 0;
    const draw = () => {
      drawFace(fctx, fc.width, { expression, blink, lookX: 0, lookY: 0, era, t });
      drawPortrait(ctx, res, { expression, blink, lookX: 0, lookY: 0, era, t }, fc);
    };
    draw();
    const id = window.setInterval(() => {
      t += 0.15;
      const nb = Math.random() < 0.04;
      if (nb !== blink || expression === 'panic' || expression === 'sleepy') {
        blink = nb;
        draw();
      }
    }, 150);
    return () => window.clearInterval(id);
  }, [expression, era, size]);
  return <canvas ref={ref} className="portrait" style={{ width: size, height: size }} />;
}
