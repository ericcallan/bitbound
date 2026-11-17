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
/** The one ground block, three colours (indices into PALETTE_8): mortar, body, highlight. */
export const GROUND_COLORS = [13, 12, 11] as const;
/** The flat 8-bit sky (PALETTE_8 index). */
export const SKY_INDEX = 3;
/** Cloud colours: outline and white (PALETTE_8 indices). */
export const CLOUD_COLORS = { k: 0, w: 9 } as const;

/** Looks the tile renderer draws as ground. Beams, reliefs and the mural keep their own sprites/meshes. */
const TILE_LOOKS = new Set(['grass', 'stone', 'ruin', 'hedge', 'wood', 'metal']);

/**
 * The ground block as palette indices: staggered bricks, highlight on the top/left edge of each brick,
 * mortar on the bottom/right, a couple of pits for texture. Exactly three colours.
 */
export function groundBlock(): number[][] {
  const [a, b, c]: number[] = [...GROUND_COLORS];
  const rows: number[][] = [];
  for (let y = 0; y < TILE_PX; y++) {
    const row: number[] = [];
    const offset = y < 8 ? 0 : 4;
    for (let x = 0; x < TILE_PX; x++) {
      const lx = (x + TILE_PX - offset) % 8;
      const ly = y % 8;
      let k = b;
      if (ly === 7 || lx === 7) k = a;
      else if (ly === 0 || lx === 0) k = c;
      else if ((lx === 3 && ly === 3) || (lx === 5 && ly === 4)) k = a;
      row.push(k);
    }
    rows.push(row);
  }
  return rows;
}

/** Does this solid appear as ground in the 8-bit tile layer? */
export function isRetroTile(s: SolidDef) {
  return TILE_LOOKS.has(s.look) && (s.genMask === undefined || (s.genMask & 1) !== 0);
}

/**
 * The 8-bit generation as a real tile renderer (2D only): a world-anchored pixel canvas, 16 pixels per
 * world unit, holding the flat sky's clouds and every 8-bit solid drawn with the one ground block. It is
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
  private block: CanvasPattern;
  private cloud: HTMLCanvasElement;
  private clouds: { x: number; y: number }[] = [];

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

    const tile = document.createElement('canvas');
    tile.width = tile.height = TILE_PX;
    const tctx = tile.getContext('2d')!;
    groundBlock().forEach((row, y) =>
      row.forEach((k, x) => {
        tctx.fillStyle = PALETTE_8[k];
        tctx.fillRect(x, y, 1, 1);
      }),
    );
    this.block = this.ctx.createPattern(tile, 'repeat')!;

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
    ctx.fillStyle = this.block;
    for (const s of present) {
      const px0 = Math.round((s.box.min.x - this.x0) * TILE_PX);
      const px1 = Math.round((s.box.max.x - this.x0) * TILE_PX);
      const py0 = Math.round((this.y1 - s.box.max.y) * TILE_PX);
      const py1 = Math.round((this.y1 - s.box.min.y) * TILE_PX);
      ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
    }
    this.texture.needsUpdate = true;
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
