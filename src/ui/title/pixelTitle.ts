import { PALETTE_8 } from '../../game/render/post/Pipeline';
import { TILES, HILL_COLORS, BUSH_COLORS, CLOUD_COLORS } from '../../game/render/retro/RetroLayer';
import { BACKDROP } from '../../game/render/sprites';

/**
 * The title screen in 8-bit and 16-bit, drawn the way those consoles drew, rather than the 3D scene through a
 * pixel filter: a side-on scene of tiles and sprites at the generation's native resolution (240 rows at 16 px per
 * tile for 8-bit, 224 rows at 24 px for 16-bit), scaled up by whole pixels.
 *
 * Same story as the 3D title set: Pip on a stone slab in the left third, a tree framing the left, a cliff with a
 * waterfall falling into a pool, and the ruined ring with its banners on a stone terrace to the right.
 *  - 8-bit: only the 8-bit palette, the game's three-colour tiles (render/retro/RetroLayer.ts), flat two-colour
 *    hills and bushes, the plain cloud, and a larger title Pip drawn pixel by pixel in three colours.
 *  - 16-bit: the 16-bit tiles cut from the scanned materials, the three parallax layers over a banded sky, and the
 *    sprites pre-rendered from the Blender models (public/assets/retro), including a larger title Pip.
 */
export type PixelGen = 0 | 1;

const P = (i: number) => PALETTE_8[i];
const ROWS: Record<PixelGen, number> = { 0: 240, 1: 224 };
const TILE: Record<PixelGen, number> = { 0: 16, 1: 24 };

/** Where things stand, in tiles (x right, y up from the bottom of the frame). Pip is at x 0. */
const LAYOUT: Record<PixelGen, {
  ground: number;
  cliff: [number, number];
  cliffTop: number;
  notch: [number, number, number];
  pool: [number, number];
  slab: [number, number, number];
  terrace: [number, number, number];
  ring: { x: number; r: number };
  banners: number[];
  tree: number;
  bushes: number[];
  sign: number;
  pipAt: number;
}> = {
  0: { ground: 3, cliff: [2.5, 40], cliffTop: 10, notch: [6.3, 8.1, 8.5], pool: [4.6, 9.8], slab: [-1.5, 1.6, 1.25], terrace: [10.8, 22, 1.5], ring: { x: 15, r: 2.2 }, banners: [12.6, 17.4], tree: -7, bushes: [-3.4, 3.8, 19.5, 27], sign: 3.2, pipAt: 0.4 },
  1: { ground: 2, cliff: [1.8, 30], cliffTop: 7.2, notch: [4.2, 5.4, 5.9], pool: [2.9, 6.6], slab: [-1.2, 1.3, 0.9], terrace: [7.4, 16, 1.1], ring: { x: 10, r: 1.6 }, banners: [8.4, 11.6], tree: -5, bushes: [-2.6, 2.2, 13.5, 19], sign: 1.9, pipAt: 0.4 },
};

/** A 16-bit sprite sheet entry (public/assets/retro/sprites16.json). */
interface SheetEntry {
  x: number;
  y: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

const base = `${import.meta.env.BASE_URL}assets/retro/`;
const img = (name: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = base + name;
  });

interface Assets16 {
  tiles: HTMLImageElement;
  sheet: HTMLImageElement;
  sprites: Record<string, SheetEntry>;
  far: HTMLImageElement;
  mid: HTMLImageElement;
  clouds: HTMLImageElement;
  pip: HTMLImageElement;
}
let assets16: Promise<Assets16> | null = null;
function load16() {
  if (!assets16)
    assets16 = Promise.all([img('tiles16.png'), img('sprites16.png'), fetch(`${base}sprites16.json`).then((r) => r.json()), img('far16.png'), img('mid16.png'), img('clouds16.png'), img('pip_title16.png')]).then(
      ([tiles, sheet, json, far, mid, clouds, pip]) => ({ tiles, sheet, sprites: json.sprites, far, mid, clouds, pip }),
    );
  return assets16;
}

/** A pattern of one 8-bit tile in palette colours. */
function tilePattern(ctx: CanvasRenderingContext2D, t: number[][]) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const x = c.getContext('2d')!;
  t.forEach((row, j) => row.forEach((k, i) => ((x.fillStyle = P(k)), x.fillRect(i, j, 1, 1))));
  return ctx.createPattern(c, 'repeat')!;
}

export class PixelTitle {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private T: number;
  private H: number;
  private W = 256;
  /** World x (tiles) at the frame's left edge. */
  private left = 0;
  private a16: Assets16 | null = null;
  private patterns8: Record<string, CanvasPattern> | null = null;
  private cloud8: HTMLCanvasElement | null = null;
  ready: Promise<void>;
  /** True once everything it draws has loaded. */
  loaded = false;

  constructor(readonly gen: PixelGen) {
    this.T = TILE[gen];
    this.H = ROWS[gen];
    this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    if (gen === 0) {
      this.patterns8 = {};
      for (const k of Object.keys(TILES) as (keyof typeof TILES)[]) this.patterns8[k] = tilePattern(this.ctx, TILES[k]);
      // water: three blues in horizontal bands with a few glints (animated by scrolling)
      this.patterns8.water = tilePattern(this.ctx, Array.from({ length: 16 }, (_, j) => Array.from({ length: 16 }, (_, i) => (j % 6 === 0 && (i + j) % 7 < 3 ? 4 : j < 3 ? 3 : 2))));
      const rows = BACKDROP.cloud;
      this.cloud8 = document.createElement('canvas');
      this.cloud8.width = rows[0].length;
      this.cloud8.height = rows.length;
      const c = this.cloud8.getContext('2d')!;
      rows.forEach((row, y) => [...row].forEach((ch, x) => ch in CLOUD_COLORS && ((c.fillStyle = P(CLOUD_COLORS[ch as keyof typeof CLOUD_COLORS])), c.fillRect(x, y, 1, 1))));
      this.ready = Promise.resolve();
      this.loaded = true;
    } else {
      this.ready = load16().then((a) => {
        this.a16 = a;
        this.loaded = true;
      });
    }
  }

  /** Native frame size for a screen: the generation's rows, and as many columns as the screen's shape needs. */
  resize(screenW: number, screenH: number) {
    // the nearest whole-pixel scale: a few rows trimmed top and bottom beat wide bars
    const k = Math.max(1, Math.round(screenH / this.H));
    this.W = Math.ceil(screenW / k);
    this.canvas.width = this.W;
    this.ctx.imageSmoothingEnabled = false;
    // Pip a little right of the menu column: 40% across the frame
    const L = LAYOUT[this.gen];
    this.left = L.pipAt - (this.W / this.T) * 0.42;
    return k;
  }

  // world tiles → frame pixels
  private X = (x: number) => Math.round((x - this.left) * this.T);
  private Y = (y: number) => this.H - Math.round(y * this.T);

  private fill(style: string | CanvasPattern, x0: number, x1: number, y0: number, y1: number) {
    const c = this.ctx;
    if (typeof style !== 'string') style.setTransform(new DOMMatrix().translate(-Math.round(this.left * this.T) % this.T, this.H % this.T));
    c.fillStyle = style;
    c.fillRect(this.X(x0), this.Y(y1), this.X(x1) - this.X(x0), this.Y(y0) - this.Y(y1));
  }

  draw(t: number) {
    if (this.gen === 0) this.draw8(t);
    else if (this.a16) this.draw16(t);
  }

  // ------------------------------------------------------------------ 8-bit

  private draw8(t: number) {
    const c = this.ctx;
    const L = LAYOUT[0];
    const pat = this.patterns8!;
    // the flat sky, and the plain cloud drifting slowly
    c.fillStyle = P(3);
    c.fillRect(0, 0, this.W, this.H);
    for (const [cx, cy] of [[-9, 13.2], [6, 12.6], [17, 13.6], [30, 12.9]]) {
      const x = cx + ((t * 0.12) % 60) - 6;
      c.drawImage(this.cloud8!, this.X(x), this.Y(cy));
    }
    // flat hills on the uplands behind the cliff
    for (const [x, w, h] of [[6, 7, 2.2], [17, 9, 3], [28, 6, 1.8], [-14, 8, 2.6]]) this.hill8(x, L.cliffTop, w, h);
    // the cliff: earth with a grass cap, a band of old stone, a notch where the waterfall comes over
    const [cx0, cx1] = L.cliff;
    const [n0, n1, nTop] = L.notch;
    this.fill(pat.earth, cx0, cx1, L.ground, L.cliffTop - 1);
    this.fill(pat.grassTop, cx0, cx1, L.cliffTop - 1, L.cliffTop);
    this.fill(pat.backStone, cx0, cx1, L.ground + 2, L.ground + 2.5);
    this.fill(pat.backStone, cx0 + 3, cx1, L.ground + 4.5, L.ground + 5);
    // the spring: a dark cave mouth under the cliff's grass, stone lintel, the waterfall below it
    this.fill(pat.backStone, n0 - 0.1, n1 + 0.1, nTop - 0.2, nTop + 0.6);
    this.fill(pat.stone, n0 - 0.4, n1 + 0.4, nTop + 0.6, nTop + 1);
    this.waterfall8(n0 + 0.2, n1 - 0.2, nTop, L.ground - 0.6, t);
    // ground with the pool cut into it
    const [p0, p1] = L.pool;
    this.fill(pat.earth, -60, 60, 0, L.ground - 1);
    this.fill(pat.grassTop, -60, p0, L.ground - 1, L.ground);
    this.fill(pat.grassTop, p1, 60, L.ground - 1, L.ground);
    pat.water.setTransform(new DOMMatrix().translate(Math.round(t * 6) % 16, 0));
    c.fillStyle = pat.water;
    c.fillRect(this.X(p0), this.Y(L.ground - 0.5), this.X(p1) - this.X(p0), this.Y(L.ground - 2) - this.Y(L.ground - 0.5));
    // foam where the fall lands
    c.fillStyle = P(9);
    for (let i = 0; i < 10; i++) c.fillRect(this.X(n0 + 0.1) + ((i * 7 + Math.floor(t * 8)) % Math.round((n1 - n0) * 16)), this.Y(L.ground - 0.5) - (i % 3), 2, 1);
    // the tree framing the left
    this.tree8(L.tree, L.ground);
    // the ruin terrace, the ring and its banners
    const [r0, r1, rh] = L.terrace;
    this.fill(pat.stone, r0, r1, L.ground, L.ground + rh);
    this.ring8(L.ring.x, L.ground + rh + L.ring.r + 0.15, L.ring.r, t);
    for (const bx of L.banners) this.banner8(bx, L.ground + rh, t);
    // bushes and the signpost
    for (const bx of L.bushes) this.bush8(bx, bx > r0 && bx < r1 ? L.ground + rh : L.ground, 1.8);
    this.sign8(L.sign, L.ground);
    // Pip's slab, and Pip
    const [s0, s1, sh] = L.slab;
    this.fill(pat.stone, s0, s1, L.ground, L.ground + sh);
    this.pip8(this.X(L.pipAt), this.Y(L.ground + sh), t);
  }

  private hill8(cx: number, y: number, w: number, h: number) {
    const c = this.ctx;
    const R = (w / 2) * 16;
    const H = h * 16;
    const bx = this.X(cx);
    const by = this.Y(y);
    const [body, ink] = HILL_COLORS;
    for (let dx = -R; dx <= R; dx += 2) {
      const k = dx / R;
      const top = Math.round((H * Math.sqrt(Math.max(0, 1 - k * k))) / 2) * 2;
      if (top <= 0) continue;
      c.fillStyle = P(ink);
      c.fillRect(Math.round(bx + dx), by - top, 2, top);
      c.fillStyle = P(body);
      c.fillRect(Math.round(bx + dx), by - top + 2, 2, Math.max(0, top - 2));
    }
  }

  private bush8(cx: number, y: number, w: number) {
    const c = this.ctx;
    const [body, ink] = BUSH_COLORS;
    const by = this.Y(y);
    const R = (w / 2) * 16;
    for (const pass of [ink, body]) {
      c.fillStyle = P(pass);
      for (const [fx, fh] of [[-0.32, 0.55], [0, 0.8], [0.32, 0.55]]) {
        const lx = this.X(cx) + fx * R * 2;
        const lr = R * 0.55 - (pass === body ? 1 : 0);
        for (let dx = -lr; dx <= lr; dx++) {
          const k = dx / lr;
          const top = Math.round(lr * fh * 1.6 * Math.sqrt(Math.max(0, 1 - k * k)));
          c.fillRect(Math.round(lx + dx), by - top - (pass === body ? 0 : 1), 1, top + (pass === body ? 0 : 1));
        }
      }
    }
  }

  /** The 8-bit tree: a brown trunk and a stepped canopy in three greens, like the in-game 8-bit tree. */
  private tree8(x: number, y: number) {
    const c = this.ctx;
    const tx = this.X(x);
    const ty = this.Y(y);
    c.fillStyle = P(13);
    c.fillRect(tx - 8, ty - 80, 16, 80);
    c.fillStyle = P(0);
    c.fillRect(tx + 6, ty - 80, 2, 80);
    const blocks: [number, number, number, number, number][] = [
      [-56, -176, 112, 104, 7],
      [-40, -200, 80, 32, 8],
      [-56, -176, 112, 16, 8],
      [24, -168, 32, 88, 6],
      [-56, -96, 112, 16, 6],
    ];
    for (const [bx, by, w, h, col] of blocks) {
      c.fillStyle = P(col);
      c.fillRect(tx + bx, ty + by, w, h);
    }
  }

  private waterfall8(x0: number, x1: number, top: number, bottom: number, t: number) {
    const c = this.ctx;
    const px0 = this.X(x0);
    const px1 = this.X(x1);
    const py0 = this.Y(top);
    const py1 = this.Y(bottom);
    c.fillStyle = P(4);
    c.fillRect(px0, py0, px1 - px0, py1 - py0);
    for (let x = px0; x < px1; x += 2) {
      const lane = (x * 13) % 7;
      for (let y = py0 + ((Math.floor(t * 40) + lane * 9) % 24) - 24; y < py1; y += 24) {
        c.fillStyle = P(9);
        c.fillRect(x, Math.max(py0, y), 2, 8);
        c.fillStyle = P(3);
        c.fillRect(x, Math.max(py0, y + 12), 1, 4);
      }
    }
  }

  /** The stone ring (pixel by pixel), broken at the upper right, with the teal glow and the shard inside. */
  private ring8(x: number, y: number, r: number, t: number) {
    const c = this.ctx;
    const cx = this.X(x);
    const cy = this.Y(y);
    // whole pixels only: a fractional radius would put pixels between pixels (anti-aliased, off-palette)
    const R = Math.round(r * 16);
    const th = 9;
    for (let j = -R - 1; j <= R + 1; j++) {
      for (let i = -R - 1; i <= R + 1; i++) {
        const d = Math.hypot(i, j);
        const a = Math.atan2(-j, i);
        if (d <= R && d > R - th) {
          if (a > 0.35 && a < 0.95) continue; // the broken voussoirs
          // voussoir joints every 22°, a lit upper rim
          const joint = Math.abs(((a * 180) / Math.PI + 360) % 22) < 2.4;
          c.fillStyle = P(joint || d > R - 1 ? 0 : d > R - 3 && j < 0 ? 9 : 15);
          c.fillRect(cx + i, cy + j, 1, 1);
        } else if (d <= R - th && d > R - th - 1.6 && !(a > 0.35 && a < 0.95)) {
          c.fillStyle = P(Math.floor(t * 3) % 2 ? 5 : 4);
          c.fillRect(cx + i, cy + j, 1, 1);
        }
      }
    }
    // the shard, bobbing
    const sy = cy + Math.round(Math.sin(t * 2) * 2);
    for (let j = -10; j <= 10; j++) {
      const w = 6 - Math.round((Math.abs(j) * 6) / 10);
      c.fillStyle = P(j < 0 ? 4 : 5);
      c.fillRect(cx - w, sy + j, w * 2, 1);
    }
    c.fillStyle = P(9);
    c.fillRect(cx - 1, sy - 6, 2, 3);
  }

  private banner8(x: number, y: number, t: number) {
    const c = this.ctx;
    const px = this.X(x);
    const py = this.Y(y);
    c.fillStyle = P(13);
    c.fillRect(px - 1, py - 60, 2, 60);
    c.fillRect(px - 8, py - 60, 16, 2);
    const flap = Math.floor(t * 2.5) % 2;
    c.fillStyle = P(11);
    c.fillRect(px - 7 + flap, py - 58, 13, 26);
    // swallowtail
    c.fillStyle = P(11);
    c.fillRect(px - 7 + flap * 2, py - 32, 5, 4);
    c.fillRect(px + 1 + flap * 2, py - 32, 5, 4);
    // the shard emblem
    c.fillStyle = P(9);
    for (let j = -4; j <= 4; j++) {
      const w = 3 - Math.round(Math.abs(j) * 0.75);
      c.fillRect(px - w + flap, py - 46 + j, w * 2 + 1, 1);
    }
  }

  private sign8(x: number, y: number) {
    const c = this.ctx;
    const px = this.X(x);
    const py = this.Y(y);
    c.fillStyle = P(13);
    c.fillRect(px - 1, py - 22, 3, 22);
    c.fillRect(px - 10, py - 24, 22, 9);
    c.fillStyle = P(0);
    c.fillRect(px - 10, py - 16, 22, 1);
    c.fillStyle = P(9);
    c.fillRect(px - 6, py - 21, 12, 2);
    c.fillRect(px + 4, py - 22, 2, 4);
  }

  /**
   * The title Pip in 8-bit: drawn pixel by pixel in the sprite's three colours (ink, burnt orange, cream), larger
   * than the in-game sprite as title-screen art was. Blinks and bobs his antenna.
   */
  private pip8(cx: number, by: number, t: number) {
    const c = this.ctx;
    const K = P(0);
    const O = P(11);
    const C = P(9);
    const r = (col: string, x: number, y: number, w: number, h: number) => ((c.fillStyle = col), c.fillRect(cx + x, by + y, w, h));
    const blink = t % 3.2 < 0.12;
    const bob = Math.round(Math.sin(t * 3) * 1);
    // boots
    r(K, -10, -5, 9, 5);
    r(K, 2, -5, 9, 5);
    r(C, -9, -4, 7, 2);
    r(C, 3, -4, 7, 2);
    // legs
    r(K, -7, -10, 5, 5);
    r(K, 3, -10, 5, 5);
    r(O, -6, -10, 3, 5);
    r(O, 4, -10, 3, 5);
    // body with the core
    r(K, -9, -22, 19, 13);
    r(C, -8, -21, 17, 11);
    r(K, -3, -19, 7, 7);
    r(O, -2, -18, 5, 5);
    r(C, 0, -16, 1, 1);
    // arms
    r(K, -12, -20, 4, 8);
    r(C, -11, -19, 2, 6);
    r(K, 9, -20, 4, 8);
    r(C, 10, -19, 2, 6);
    // neck
    r(K, -3, -24, 7, 2);
    // head: rounded orange box, dark screen, cream eyes
    r(K, -14, -44, 29, 20);
    r(K, -13, -45, 27, 1);
    r(O, -13, -43, 27, 18);
    r(K, -11, -41, 23, 13);
    if (blink) {
      r(C, -6, -35, 4, 1);
      r(C, 3, -35, 4, 1);
    } else {
      r(C, -6, -38, 3, 6);
      r(C, 4, -38, 3, 6);
    }
    // ear
    r(K, -16, -38, 2, 6);
    // antenna
    r(K, 0, -51 + bob, 2, 6);
    r(C, 0, -53 + bob, 2, 2);
  }

  // ------------------------------------------------------------------ 16-bit

  private draw16(t: number) {
    const c = this.ctx;
    const a = this.a16!;
    const L = LAYOUT[1];
    const T = 24;
    // a banded sky, then the painted parallax layers (each scrolls at its own rate)
    const bands = ['#4f8fe0', '#5b9ce6', '#68a9ea', '#78b6ee', '#8bc4f2', '#a3d2f5', '#bfe0f8'];
    bands.forEach((col, i) => {
      c.fillStyle = col;
      c.fillRect(0, Math.floor((i * this.H) / bands.length / 1.6), this.W, this.H);
    });
    const layer = (im: HTMLImageElement, speed: number, yOff = 0) => {
      const off = -Math.round((this.left * T * speed + t * (im === a.clouds ? 4 : 0)) % im.width);
      for (let x = off - im.width; x < this.W; x += im.width) c.drawImage(im, x, yOff);
    };
    layer(a.clouds, 0.1, -12);
    layer(a.far, 0.2, -10);
    layer(a.mid, 0.4, 6);
    const tile = (i: number) => {
      const p = c.createPattern(this.tileCanvas(i), 'repeat')!;
      return p;
    };
    const grass = tile(0);
    const earth = tile(1);
    const stone = tile(2);
    // the cliff, with a notch for the waterfall and a band of darker stone
    const [cx0, cx1] = L.cliff;
    const [n0, n1, nTop] = L.notch;
    this.fill(earth, cx0, cx1, L.ground, L.cliffTop - 1);
    this.fill(grass, cx0, cx1, L.cliffTop - 1, L.cliffTop);
    this.fill(stone, cx0, cx1, L.ground + 2, L.ground + 2.4);
    c.fillStyle = 'rgba(20, 24, 60, 0.35)';
    c.fillRect(this.X(cx0), this.Y(L.ground + 2.4), this.X(cx1) - this.X(cx0), this.Y(L.ground + 2) - this.Y(L.ground + 2.4));
    // trees on the cliff top
    for (const [x, s] of [[2.8, 0.5], [13.5, 0.7], [21, 0.6]]) this.sprite16('tree', x, L.cliffTop - 0.1, s);
    // the spring: a dark cave mouth with a stone lintel, the waterfall below it
    c.fillStyle = '#1c1a26';
    c.fillRect(this.X(n0 - 0.1), this.Y(nTop + 0.5), this.X(n1 + 0.1) - this.X(n0 - 0.1), this.Y(nTop - 0.2) - this.Y(nTop + 0.5));
    this.fill(stone, n0 - 0.35, n1 + 0.35, nTop + 0.5, nTop + 0.85);
    this.waterfall16(n0 + 0.15, n1 - 0.15, nTop, L.ground - 0.5, t);
    // the ground and the pool
    const [p0, p1] = L.pool;
    this.fill(earth, -60, 60, 0, L.ground - 1);
    this.fill(grass, -60, p0, L.ground - 1, L.ground);
    this.fill(grass, p1, 60, L.ground - 1, L.ground);
    const wy0 = this.Y(L.ground - 0.35);
    const wy1 = this.Y(L.ground - 1.6);
    const water = ['#9fe0f4', '#5fb9e4', '#3e93cf', '#2c72b2', '#235a92'];
    water.forEach((col, i) => {
      c.fillStyle = col;
      c.fillRect(this.X(p0), wy0 + Math.floor(((wy1 - wy0) * i) / water.length), this.X(p1) - this.X(p0), wy1 - wy0);
    });
    c.fillStyle = '#ffffff';
    for (let i = 0; i < 14; i++) c.fillRect(this.X(p0) + ((i * 37 + Math.floor(t * 10)) % (this.X(p1) - this.X(p0))), wy0 + 2 + ((i * 5) % 9), 3, 1);
    // the tree framing the left, bushes and rocks
    this.sprite16('tree', L.tree, L.ground, 1.05);
    for (const bx of L.bushes) this.sprite16('bush', bx, bx > L.terrace[0] && bx < L.terrace[1] ? L.ground + L.terrace[2] : L.ground, 0.8);
    this.sprite16('rock', p0 - 0.4, L.ground - 0.3, 1);
    this.sprite16('rock', p1 + 0.3, L.ground - 0.3, 0.8);
    this.sprite16('mushroom', -3.4, L.ground, 1);
    // the terrace: stone, the old arch behind, the ring in front with banners, a pillar
    const [r0, r1, rh] = L.terrace;
    const top = L.ground + rh;
    this.sprite16('arch', r1 - 2.2, top, 1);
    this.fill(stone, r0, r1, L.ground, top);
    c.fillStyle = 'rgba(0, 0, 0, 0.18)';
    c.fillRect(this.X(r0), this.Y(top) + 2, this.X(r1) - this.X(r0), 3);
    this.sprite16('pillar', r0 + 0.6, top, 1);
    this.ring16(L.ring.x, top + L.ring.r + 0.1, L.ring.r, t);
    for (const bx of L.banners) this.banner16(bx, top, t);
    this.sprite16('sign', L.sign, L.ground, 1);
    // Pip's slab and Pip
    const [s0, s1, sh] = L.slab;
    this.fill(stone, s0, s1, L.ground, L.ground + sh);
    c.fillStyle = 'rgba(0, 0, 0, 0.2)';
    c.fillRect(this.X(s0), this.Y(L.ground + sh), this.X(s1) - this.X(s0), 2);
    const pip = a.pip;
    const bob = Math.round(Math.sin(t * 2.2) * 0.6);
    c.drawImage(pip, this.X(L.pipAt) - Math.round(pip.width / 2), this.Y(L.ground + sh) - pip.height + bob);
  }

  private tiles16: HTMLCanvasElement[] = [];
  private tileCanvas(i: number) {
    if (!this.tiles16[i]) {
      const c = document.createElement('canvas');
      c.width = c.height = 24;
      c.getContext('2d')!.drawImage(this.a16!.tiles, i * 24, 0, 24, 24, 0, 0, 24, 24);
      this.tiles16[i] = c;
    }
    return this.tiles16[i];
  }

  /** A pre-rendered sprite, standing on (x, y) by its model's origin, at a whole-number-ish scale. */
  private sprite16(name: string, x: number, y: number, scale: number) {
    const e = this.a16!.sprites[name];
    if (!e) return;
    const w = Math.round(e.w * scale);
    const h = Math.round(e.h * scale);
    this.ctx.drawImage(this.a16!.sheet, e.x, e.y, e.w, e.h, this.X(x) - Math.round(e.ox * scale), this.Y(y) - h + Math.round(e.oy * scale), w, h);
  }

  private waterfall16(x0: number, x1: number, top: number, bottom: number, t: number) {
    const c = this.ctx;
    const px0 = this.X(x0);
    const px1 = this.X(x1);
    const py0 = this.Y(top);
    const py1 = this.Y(bottom);
    const cols = ['#cfeef8', '#a8dcf0', '#ffffff', '#86c8e6'];
    for (let x = px0; x < px1; x++) {
      const edge = x === px0 || x === px1 - 1;
      c.fillStyle = edge ? '#7fb8d8' : '#bfe6f6';
      c.fillRect(x, py0, 1, py1 - py0);
      if (edge) continue;
      const lane = (x * 7919) % 11;
      for (let y = py0 - 30 + ((Math.floor(t * 70) + lane * 13) % 30); y < py1; y += 30) {
        c.fillStyle = cols[(x + lane) % cols.length];
        c.fillRect(x, Math.max(py0, y), 1, 10 + (lane % 5));
      }
    }
    // spray
    c.fillStyle = 'rgba(255, 255, 255, 0.7)';
    for (let i = 0; i < 16; i++) c.fillRect(px0 - 6 + ((i * 13 + Math.floor(t * 9)) % (px1 - px0 + 12)), py1 - 3 - ((i * 3 + Math.floor(t * 12)) % 7), 2, 2);
  }

  private ring16(x: number, y: number, r: number, t: number) {
    const c = this.ctx;
    const cx = this.X(x);
    const cy = this.Y(y);
    const R = Math.round(r * 24);
    const th = 11;
    const stone = ['#5d564f', '#7c746a', '#9a9184', '#b6ad9d', '#d2c8b6'];
    for (let j = -R - 1; j <= R + 1; j++) {
      for (let i = -R - 1; i <= R + 1; i++) {
        const d = Math.hypot(i, j);
        const a = Math.atan2(-j, i);
        if (a > 0.35 && a < 0.95 && d > R - th - 3) continue;
        if (d <= R && d > R - th) {
          const joint = Math.abs(((a * 180) / Math.PI + 360) % 20) < 1.6;
          // lit from the upper left, darker toward the outside and the bottom
          const light = (-i - j) / (R * 1.4) + (R - d) / th - 0.4;
          const k = joint || d > R - 1 ? 0 : Math.max(1, Math.min(4, Math.round(2.2 + light * 2)));
          c.fillStyle = stone[k];
          c.fillRect(cx + i, cy + j, 1, 1);
        } else if (d <= R - th && d > R - th - 2.5) {
          c.fillStyle = (Math.floor((a * 10 + t * 6) % 2) === 0) ? '#7ff7ee' : '#3fe0d6';
          c.fillRect(cx + i, cy + j, 1, 1);
        }
      }
    }
    // the shard: a faceted crystal, bobbing
    const sy = cy + Math.round(Math.sin(t * 2) * 2);
    for (let j = -14; j <= 14; j++) {
      const w = 8 - Math.round((Math.abs(j) * 8) / 14);
      c.fillStyle = j < 0 ? '#bdfcf6' : '#4fe6da';
      c.fillRect(cx - w, sy + j, w, 1);
      c.fillStyle = j < 0 ? '#7ff7ee' : '#26b8b0';
      c.fillRect(cx, sy + j, w, 1);
    }
  }

  private banner16(x: number, y: number, t: number) {
    const c = this.ctx;
    const px = this.X(x);
    const py = this.Y(y);
    c.fillStyle = '#4a3424';
    c.fillRect(px - 1, py - 84, 3, 84);
    c.fillRect(px - 12, py - 84, 25, 3);
    const flap = Math.floor(t * 2.5) % 2;
    const cloth = ['#f8a24c', '#f0862a', '#d86a1f', '#b8561a'];
    for (let j = 0; j < 40; j++) {
      const sway = Math.round(Math.sin(j * 0.15 + t * 3) * (j / 40) * 1.5) + flap;
      for (let i = 0; i < 19; i++) {
        if (j > 34 && Math.abs(i - 9) < (j - 34) * 1.5) continue; // swallowtail
        c.fillStyle = cloth[Math.min(3, Math.floor((i / 19) * 2 + (j / 40) * 1.6))];
        c.fillRect(px - 9 + i + sway, py - 80 + j, 1, 1);
      }
    }
    c.fillStyle = '#ffe2b8';
    for (let j = -6; j <= 6; j++) {
      const w = 4 - Math.round(Math.abs(j) * 0.66);
      c.fillRect(px - w + flap, py - 62 + j, w * 2 + 1, 1);
    }
  }
}
