import type { Expression } from '../sim/Game';
import type { Era } from '../era/EraSystem';

export const PIP_COLORS = {
  orange: '#f0862a',
  orangeDark: '#b8461f',
  cream: '#fff4d6',
  creamShade: '#e8d6b0',
  teal: '#2fd6c3',
  eye: '#6ff6ff',
  cobalt: '#3a5fcd',
  purple: '#8e5bd6',
  face: '#141a33',
  faceEdge: '#232b55',
};

export interface FaceState {
  expression: Expression;
  blink: boolean;
  lookX: number;
  lookY: number;
  era: Era;
  t: number;
}

/** Resolution the screen-face is drawn at per era: chunky pixels to smooth vector. */
export const FACE_RES: Record<Era, number> = { 0: 16, 1: 32, 2: 32, 3: 96, 4: 128, 5: 160 };

/**
 * Draws Pip's screen-face (eyes + mouth on the dark faceplate) into a square canvas.
 * Coordinates are in a 0..1 space so the same art scales from 16px to 128px.
 */
export function drawFace(ctx: CanvasRenderingContext2D, size: number, f: FaceState) {
  const s = size;
  ctx.save();
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = PIP_COLORS.face;
  ctx.fillRect(0, 0, s, s);
  if (f.era >= 4) {
    // Subtle scanline sheen on the modern screen.
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, 'rgba(90,120,255,0.18)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let y = 0; y < s; y += 4) ctx.fillRect(0, y, s, 1);
  }
  const pixel = f.era < 2;
  ctx.imageSmoothingEnabled = !pixel;
  const eye = f.era === 5 ? '#9ffcff' : PIP_COLORS.eye;
  if (f.era >= 4) {
    ctx.shadowColor = eye;
    ctx.shadowBlur = s * (f.era === 5 ? 0.14 : 0.08);
  } else if (f.era === 3) {
    // Stylized: bold cartoon eyes with a dark ink edge.
    ctx.shadowColor = '#05060f';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = s * 0.03;
  }
  ctx.fillStyle = eye;
  ctx.strokeStyle = eye;
  ctx.lineCap = pixel ? 'butt' : 'round';
  ctx.lineJoin = pixel ? 'miter' : 'round';

  const lx = 0.33 + f.lookX * 0.06;
  const rx = 0.67 + f.lookX * 0.06;
  const ey = 0.47 - f.lookY * 0.06;
  const P = (v: number) => (pixel ? Math.round(v * s) : v * s);

  const rect = (cx: number, cy: number, w: number, h: number, r = 0.05) => {
    const x = P(cx - w / 2);
    const y = P(cy - h / 2);
    const W = Math.max(1, P(w));
    const H = Math.max(1, P(h));
    if (pixel || r <= 0) {
      ctx.fillRect(x, y, W, H);
    } else {
      ctx.beginPath();
      ctx.roundRect(x, y, W, H, r * s);
      ctx.fill();
    }
  };
  const line = (pts: [number, number][], w: number) => {
    ctx.lineWidth = Math.max(1, w * s);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(P(x), P(y)) : ctx.moveTo(P(x), P(y))));
    ctx.stroke();
  };
  const circle = (cx: number, cy: number, r: number) => {
    if (pixel) return rect(cx, cy, r * 2, r * 2, 0);
    ctx.beginPath();
    ctx.arc(cx * s, cy * s, r * s, 0, Math.PI * 2);
    ctx.fill();
  };
  const mouth = (kind: 'smile' | 'o' | 'flat' | 'wave' | 'grin') => {
    const my = 0.74;
    if (kind === 'smile') line([[0.42, my - 0.02], [0.5, my + 0.04], [0.58, my - 0.02]], 0.05);
    if (kind === 'grin') line([[0.38, my - 0.03], [0.5, my + 0.06], [0.62, my - 0.03]], 0.06);
    if (kind === 'o') circle(0.5, my + 0.01, 0.055);
    if (kind === 'flat') line([[0.44, my], [0.56, my]], 0.045);
    if (kind === 'wave') line([[0.38, my], [0.44, my - 0.04], [0.5, my], [0.56, my - 0.04], [0.62, my]], 0.045);
  };

  const blink = f.blink && (f.expression === 'idle' || f.expression === 'determined' || f.expression === 'wonder');
  switch (blink ? 'blink' : f.expression) {
    case 'blink':
      rect(lx, ey + 0.04, 0.18, 0.05, 0.02);
      rect(rx, ey + 0.04, 0.18, 0.05, 0.02);
      break;
    case 'idle':
      rect(lx, ey, 0.15, 0.27, 0.06);
      rect(rx, ey, 0.15, 0.27, 0.06);
      if (f.era >= 3) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.shadowBlur = 0;
        rect(lx - 0.03, ey - 0.07, 0.04, 0.06, 0.02);
        rect(rx - 0.03, ey - 0.07, 0.04, 0.06, 0.02);
      }
      break;
    case 'happy':
      line([[lx - 0.08, ey + 0.05], [lx, ey - 0.06], [lx + 0.08, ey + 0.05]], 0.07);
      line([[rx - 0.08, ey + 0.05], [rx, ey - 0.06], [rx + 0.08, ey + 0.05]], 0.07);
      mouth('grin');
      break;
    case 'surprised':
      circle(lx, ey, 0.12);
      circle(rx, ey, 0.12);
      ctx.fillStyle = PIP_COLORS.face;
      ctx.shadowBlur = 0;
      circle(lx, ey, 0.045);
      circle(rx, ey, 0.045);
      ctx.fillStyle = eye;
      mouth('o');
      break;
    case 'wonder':
      rect(lx, ey, 0.18, 0.3, 0.08);
      rect(rx, ey, 0.18, 0.3, 0.08);
      ctx.fillStyle = PIP_COLORS.face;
      ctx.shadowBlur = 0;
      rect(lx - 0.035, ey - 0.06, 0.05, 0.05, 0.01);
      rect(rx - 0.035, ey - 0.06, 0.05, 0.05, 0.01);
      rect(lx + 0.03, ey + 0.05, 0.03, 0.03, 0.01);
      rect(rx + 0.03, ey + 0.05, 0.03, 0.03, 0.01);
      ctx.fillStyle = eye;
      mouth('smile');
      break;
    case 'panic': {
      const j = Math.sin(f.t * 40) * 0.015;
      circle(lx + j, ey, 0.13);
      circle(rx - j, ey, 0.09);
      ctx.fillStyle = PIP_COLORS.face;
      ctx.shadowBlur = 0;
      circle(lx + j, ey, 0.04);
      circle(rx - j, ey, 0.03);
      ctx.fillStyle = eye;
      mouth('wave');
      ctx.fillStyle = '#9fd8ff';
      rect(0.86, 0.2, 0.06, 0.1, 0.03);
      break;
    }
    case 'dizzy':
      line([[lx - 0.07, ey - 0.07], [lx + 0.07, ey + 0.07]], 0.05);
      line([[lx + 0.07, ey - 0.07], [lx - 0.07, ey + 0.07]], 0.05);
      line([[rx - 0.07, ey - 0.07], [rx + 0.07, ey + 0.07]], 0.05);
      line([[rx + 0.07, ey - 0.07], [rx - 0.07, ey + 0.07]], 0.05);
      mouth('wave');
      break;
    case 'hurt':
      line([[lx - 0.08, ey - 0.07], [lx + 0.06, ey], [lx - 0.08, ey + 0.07]], 0.06);
      line([[rx + 0.08, ey - 0.07], [rx - 0.06, ey], [rx + 0.08, ey + 0.07]], 0.06);
      mouth('flat');
      break;
    case 'determined':
      rect(lx, ey + 0.03, 0.15, 0.2, 0.05);
      rect(rx, ey + 0.03, 0.15, 0.2, 0.05);
      ctx.fillStyle = PIP_COLORS.face;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(P(lx - 0.1), P(ey - 0.1));
      ctx.lineTo(P(lx + 0.1), P(ey - 0.02));
      ctx.lineTo(P(lx + 0.1), P(ey - 0.1));
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(P(rx + 0.1), P(ey - 0.1));
      ctx.lineTo(P(rx - 0.1), P(ey - 0.02));
      ctx.lineTo(P(rx - 0.1), P(ey - 0.1));
      ctx.fill();
      ctx.fillStyle = eye;
      mouth('flat');
      break;
    case 'sleepy':
      rect(lx, ey + 0.05, 0.16, 0.06, 0.03);
      rect(rx, ey + 0.05, 0.16, 0.06, 0.03);
      if (Math.sin(f.t * 2) > 0) {
        ctx.font = `${Math.round(s * 0.18)}px monospace`;
        ctx.fillText('z', P(0.78), P(0.28));
      }
      break;
  }
  ctx.restore();
}

/** Full head portrait for the HUD: shell, faceplate, antenna and the live face. */
export function drawPortrait(ctx: CanvasRenderingContext2D, size: number, f: FaceState, faceCanvas: HTMLCanvasElement) {
  const s = size;
  ctx.clearRect(0, 0, s, s);
  const pixel = f.era < 2;
  ctx.imageSmoothingEnabled = !pixel;
  const r = (x: number, y: number, w: number, h: number, rad: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    if (pixel) ctx.rect(Math.round(x * s), Math.round(y * s), Math.round(w * s), Math.round(h * s));
    else ctx.roundRect(x * s, y * s, w * s, h * s, rad * s);
    ctx.fill();
  };
  // antenna
  r(0.48, 0.04, 0.04, 0.16, 0.02, PIP_COLORS.purple);
  r(0.445, 0.0, 0.11, 0.11, 0.06, PIP_COLORS.teal);
  // shell
  r(0.12, 0.17, 0.76, 0.72, 0.2, PIP_COLORS.cream);
  r(0.12, 0.17, 0.76, 0.12, 0.08, PIP_COLORS.orange);
  // ear bolts
  r(0.06, 0.45, 0.08, 0.18, 0.03, PIP_COLORS.purple);
  r(0.86, 0.45, 0.08, 0.18, 0.03, PIP_COLORS.purple);
  // faceplate
  r(0.19, 0.31, 0.62, 0.5, 0.12, PIP_COLORS.faceEdge);
  ctx.save();
  ctx.beginPath();
  if (pixel) ctx.rect(Math.round(0.22 * s), Math.round(0.34 * s), Math.round(0.56 * s), Math.round(0.44 * s));
  else ctx.roundRect(0.22 * s, 0.34 * s, 0.56 * s, 0.44 * s, 0.1 * s);
  ctx.clip();
  ctx.drawImage(faceCanvas, 0.22 * s, 0.3 * s, 0.56 * s, 0.52 * s);
  ctx.restore();
}
