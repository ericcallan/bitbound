import * as THREE from 'three';
import type { World } from '../../collision/World';
import type { Level, SolidDef } from '../../level/meadows';
import { rng } from '../../math';
import { PALETTE_8 } from '../post/Pipeline';
import { BACKDROP } from '../sprites';

/** One tile is one world unit, drawn 16×16 pixels, like the first consoles. */
export const TILE_PX = 16;
/** Frame height of the 8-bit view in pixels (the 2D camera frames this many rows). */
export const RETRO_ROWS = 240;
/** The flat 8-bit sky (PALETTE_8 index). */
export const SKY_INDEX = 3;
/** Cloud colours: outline and white (PALETTE_8 indices). */
export const CLOUD_COLORS = { k: 0, w: 9 } as const;

/** Looks the tile renderer draws as ground. Beams, reliefs and the mural keep their own sprites/meshes. */
const TILE_LOOKS = new Set(['grass', 'stone', 'ruin', 'hedge', 'wood', 'metal']);

type Tile = number[][];
const tile = (fn: (x: number, y: number) => number): Tile => Array.from({ length: TILE_PX }, (_, y) => Array.from({ length: TILE_PX }, (_, x) => fn(x, y)));
const hash = (x: number, y: number) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 997;

/**
 * The 8-bit tile set, each 16×16 in exactly three palette colours like the first consoles:
 *  - grassTop: a lush grass edge with tufts over the first band of earth;
 *  - earth: the soil below, with darker cracks and a few pale pebbles;
 *  - stone: masonry for ruins and structures.
 */
export const TILES: Record<'grassTop' | 'earth' | 'stone' | 'backStone', Tile> = {
  grassTop: tile((x, y) => {
    const tuft = (x * 5 + 3) % 7 < 2 ? 1 : 0;
    if (y < 2) return 8; // bright grass edge
    if (y < 5 + tuft) return (x + y) % 5 === 0 ? 8 : 7; // grass, catching light
    if (y < 7 && (x * 3) % 5 === 0) return 7; // roots hanging into the soil
    return 12; // soil
  }),
  earth: tile((x, y) => {
    // short diagonal cracks and dark grit scattered without a visible grid
    const crack = (x === (y * 2 + 3) % 16 && y % 8 < 3) || (x === (21 - y) % 16 && y % 8 > 4 && y % 8 < 7);
    if (crack || hash(x, y) % 23 === 0) return 13;
    if (hash(x + 5, y + 2) % 41 === 0) return 11; // pale pebbles
    return 12;
  }),
  stone: tile((x, y) => {
    const offset = y < 8 ? 0 : 4;
    const lx = (x + TILE_PX - offset) % 8;
    const ly = y % 8;
    if (ly === 7 || lx === 7) return 1; // mortar
    if (ly === 0 || lx === 0) return 9; // lit edge
    return 15;
  }),
  // Structures behind the path: dark, low-contrast masonry, so they read as background (as 8-bit games drew them)
  backStone: tile((x, y) => {
    const offset = y < 8 ? 0 : 4;
    const lx = (x + TILE_PX - offset) % 8;
    const ly = y % 8;
    if (ly === 7 || lx === 7) return 0; // mortar
    if (ly === 0 && lx < 6) return 2; // faint lit edge
    return 1;
  }),
};

/** Backdrop scenery colours (PALETTE_8): hills and bushes are two colours each, flat, like 1985. */
export const HILL_COLORS = [7, 6] as const;
export const BUSH_COLORS = [8, 7] as const;

/** Which tile set a solid uses. */
export function tileFor(s: SolidDef): 'grass' | 'stone' {
  const look = s.retroLook ?? s.look;
  return look === 'grass' || look === 'hedge' ? 'grass' : 'stone';
}

/**
 * Where a solid stands relative to the 2D path. Only solids on the path are solid in 2D, so only they are drawn
 * as foreground tiles; structures behind it (the hidden chamber, the ruin's facade, the relief cliff, the far
 * aqueduct half) are drawn as a dark background layer; anything in front of the path is left out of the tiles,
 * so it can never cover Pip.
 */
export function laneLayer(s: SolidDef): 'lane' | 'back' | 'front' {
  if (s.box.min.z <= 0.45 && s.box.max.z >= -0.45) return 'lane';
  return s.box.max.z < 0 ? 'back' : 'front';
}

/**
 * A background structure is only worth drawing where it rises above the path's ground in front of it: the hidden
 * chamber's floor, level with the ground, would otherwise peek out at the edges as a dark sliver.
 */
export function backgroundShows(s: SolidDef, all: SolidDef[]) {
  let ground = -Infinity;
  for (const o of all) {
    if (laneLayer(o) !== 'lane' || o.box.max.x <= s.box.min.x || o.box.min.x >= s.box.max.x) continue;
    ground = Math.max(ground, o.box.max.y);
  }
  return s.box.max.y > ground + 0.05;
}

/** Does this solid appear in the 8-bit tile layer (as ground on the path, or as background behind it)? */
export function isRetroTile(s: SolidDef) {
  return TILE_LOOKS.has(s.retroLook ?? s.look) && (s.genMask === undefined || (s.genMask & 1) !== 0) && laneLayer(s) !== 'front';
}

/**
 * The 8-bit generation as a real tile renderer (2D only): a world-anchored pixel canvas, 16 pixels per
 * world unit, holding the flat sky's clouds, flat green hills and bushes, and every 8-bit solid drawn with
 * the tile set (grass over earth, stone for structures). It is
 * redrawn only when the set of present solids changes (bridges repaired, gates opened). The post composite
 * samples it per world pixel wherever a 2D view shows 8-bit; sprites (Pip, enemies, pickups) stay real
 * 16×16 sprites in the scene and are snapped to the same pixel grid and palette.
 */
export class RetroLayer {
  readonly texture: THREE.CanvasTexture;
  /** World position of the canvas's bottom-left pixel. */
  readonly origin = new THREE.Vector2();
  /** Canvas size in pixels. */
  readonly size = new THREE.Vector2();
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private solids: SolidDef[];
  private x0: number;
  private y1: number;
  private signature = '';
  private patterns: Record<keyof typeof TILES, CanvasPattern>;
  private cloud: HTMLCanvasElement;
  private clouds: { x: number; y: number }[] = [];
  private hills: { x: number; y: number; w: number; h: number }[] = [];
  private bushes: { x: number; y: number; w: number }[] = [];

  constructor(level: Level) {
    this.solids = level.solids.filter(isRetroTile);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const s of this.solids) {
      minX = Math.min(minX, s.box.min.x);
      maxX = Math.max(maxX, s.box.max.x);
      minY = Math.min(minY, s.box.min.y);
      maxY = Math.max(maxY, s.box.max.y);
    }
    this.x0 = Math.floor(minX) - 12;
    const x1 = Math.ceil(maxX) + 12;
    const y0 = Math.max(-24, Math.floor(minY));
    this.y1 = Math.ceil(maxY) + 14;
    this.origin.set(this.x0, y0);
    this.size.set((x1 - this.x0) * TILE_PX, (this.y1 - y0) * TILE_PX);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size.x;
    this.canvas.height = this.size.y;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;

    const pattern = (t: Tile) => {
      const c = document.createElement('canvas');
      c.width = c.height = TILE_PX;
      const tctx = c.getContext('2d')!;
      t.forEach((row, y) =>
        row.forEach((k, x) => {
          tctx.fillStyle = PALETTE_8[k];
          tctx.fillRect(x, y, 1, 1);
        }),
      );
      return this.ctx.createPattern(c, 'repeat')!;
    };
    this.patterns = { grassTop: pattern(TILES.grassTop), earth: pattern(TILES.earth), stone: pattern(TILES.stone), backStone: pattern(TILES.backStone) };

    const rows = BACKDROP.cloud;
    this.cloud = document.createElement('canvas');
    this.cloud.width = rows[0].length;
    this.cloud.height = rows.length;
    const cctx = this.cloud.getContext('2d')!;
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x] as keyof typeof CLOUD_COLORS;
        if (!(ch in CLOUD_COLORS)) continue;
        cctx.fillStyle = PALETTE_8[CLOUD_COLORS[ch]];
        cctx.fillRect(x, y, 1, 1);
      }
    });
    // Plain clouds drifting nowhere, a few tiles above the highest ground near them.
    const r = rng(1985);
    for (let x = this.x0 + 4; x < x1 - 4; x += 9 + r() * 8) {
      let top = -Infinity;
      for (const s of this.solids) if (s.box.max.x > x - 6 && s.box.min.x < x + 8) top = Math.max(top, s.box.max.y);
      if (top === -Infinity) top = 0;
      this.clouds.push({ x: Math.round(x), y: Math.min(this.y1 - 2, Math.round(top + 6 + r() * 3)) });
    }
    // Rolling hills and bushes standing on the grass, behind everything that moves.
    const grass = this.solids.filter((s) => s.look === 'grass' && laneLayer(s) === 'lane' && s.box.max.x - s.box.min.x > 6);
    for (const g of grass) {
      for (let x = g.box.min.x + 2 + r() * 4; x < g.box.max.x - 3; x += 14 + r() * 12) {
        this.hills.push({ x, y: g.box.max.y, w: 4 + r() * 4, h: 1.6 + r() * 2 });
      }
      for (let x = g.box.min.x + 6 + r() * 6; x < g.box.max.x - 2; x += 11 + r() * 10) {
        this.bushes.push({ x, y: g.box.max.y, w: 1.6 + r() * 1.6 });
      }
    }

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    // Raw palette bytes: the composite outputs display (sRGB) values directly.
    this.texture.colorSpace = THREE.NoColorSpace;
  }

  /** Redraws when the present 8-bit solids change. */
  update(world: World) {
    const present = this.solids.filter((s) => world.get(s.id)?.enabled ?? s.enabled ?? true);
    const sig = present.map((s) => s.id).join(',');
    if (sig === this.signature) return;
    this.signature = sig;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.size.x, this.size.y);
    for (const c of this.clouds) ctx.drawImage(this.cloud, (c.x - this.x0) * TILE_PX, (this.y1 - c.y) * TILE_PX);
    for (const h of this.hills) this.drawHill(h.x, h.y, h.w, h.h);
    for (const b of this.bushes) this.drawBush(b.x, b.y, b.w);
    // background structures first (only where they rise above the ground; the path's tiles cover the rest)
    for (const s of present) {
      if (laneLayer(s) !== 'back' || tileFor(s) === 'grass' || !backgroundShows(s, present)) continue;
      ctx.fillStyle = this.patterns.backStone;
      ctx.fillRect(
        Math.round((s.box.min.x - this.x0) * TILE_PX),
        Math.round((this.y1 - s.box.max.y) * TILE_PX),
        Math.round((s.box.max.x - s.box.min.x) * TILE_PX),
        Math.round((s.box.max.y - s.box.min.y) * TILE_PX),
      );
    }
    for (const s of present) {
      if (laneLayer(s) !== 'lane') continue;
      const px0 = Math.round((s.box.min.x - this.x0) * TILE_PX);
      const px1 = Math.round((s.box.max.x - this.x0) * TILE_PX);
      const py0 = Math.round((this.y1 - s.box.max.y) * TILE_PX);
      const py1 = Math.round((this.y1 - s.box.min.y) * TILE_PX);
      if (tileFor(s) === 'grass') {
        ctx.fillStyle = this.patterns.earth;
        ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
        ctx.fillStyle = this.patterns.grassTop;
        ctx.fillRect(px0, py0, px1 - px0, Math.min(TILE_PX, py1 - py0));
      } else {
        ctx.fillStyle = this.patterns.stone;
        ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
      }
    }
    this.texture.needsUpdate = true;
  }

  /** A flat, rounded hill in two colours (body and outline with a few dark spots), standing on y. */
  private drawHill(cx: number, y: number, w: number, h: number) {
    const ctx = this.ctx;
    const R = (w / 2) * TILE_PX;
    const H = h * TILE_PX;
    const baseX = (cx - this.x0) * TILE_PX;
    const baseY = (this.y1 - y) * TILE_PX;
    const [body, ink] = HILL_COLORS;
    for (let dx = -R; dx <= R; dx += 2) {
      const t = dx / R;
      const top = Math.round((H * Math.sqrt(Math.max(0, 1 - t * t))) / 2) * 2;
      if (top <= 0) continue;
      ctx.fillStyle = PALETTE_8[ink];
      ctx.fillRect(Math.round(baseX + dx), Math.round(baseY - top), 2, top);
      ctx.fillStyle = PALETTE_8[body];
      ctx.fillRect(Math.round(baseX + dx), Math.round(baseY - top + 2), 2, Math.max(0, top - 2));
    }
    ctx.fillStyle = PALETTE_8[ink];
    for (const [fx, fy] of [[-0.3, 0.45], [0.2, 0.6], [0.05, 0.3]]) ctx.fillRect(Math.round(baseX + fx * R), Math.round(baseY - fy * H), 2, 4);
  }

  /** A three-lobed bush in two colours. */
  private drawBush(cx: number, y: number, w: number) {
    const ctx = this.ctx;
    const [body, ink] = BUSH_COLORS;
    const baseY = (this.y1 - y) * TILE_PX;
    const lobes = [[-0.32, 0.55], [0, 0.8], [0.32, 0.55]];
    const R = (w / 2) * TILE_PX;
    for (const pass of [ink, body]) {
      ctx.fillStyle = PALETTE_8[pass];
      for (const [fx, fh] of lobes) {
        const lx = (cx - this.x0) * TILE_PX + fx * R * 2;
        const lr = R * 0.55 - (pass === body ? 1 : 0);
        for (let dx = -lr; dx <= lr; dx += 1) {
          const t = dx / lr;
          const top = Math.round(lr * fh * 1.6 * Math.sqrt(Math.max(0, 1 - t * t)));
          ctx.fillRect(Math.round(lx + dx), Math.round(baseY - top - (pass === body ? 0 : 1)), 1, top + (pass === body ? 0 : 1));
        }
      }
    }
  }

  /** The palette indices used anywhere on the canvas (for tests and the report). */
  colorsUsed(): Set<string> {
    const d = this.ctx.getImageData(0, 0, this.size.x, this.size.y).data;
    const out = new Set<string>();
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) out.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    return out;
  }

  dispose() {
    this.texture.dispose();
  }
}
