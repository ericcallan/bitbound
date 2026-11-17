import * as THREE from 'three';
import type { World } from '../../collision/World';
import type { Level, SolidDef } from '../../level/meadows';
import { isRetroTile } from './RetroLayer';

/** 16-bit: 24 px per world unit and 224 rows, like the mid-90s consoles. */
export const TILE16_PX = 24;
export const RETRO16_ROWS = 224;

const base = `${import.meta.env.BASE_URL}assets/retro/`;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function layerTexture(name: string) {
  const t = new THREE.TextureLoader().load(`${base}${name}.png`);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = THREE.RepeatWrapping;
  // raw palette bytes: the composite outputs display values directly
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/**
 * The 16-bit generation's tile layer (2D only): every solid that exists in 16-bit, drawn with tiles cut from
 * the scanned ground materials (scripts/textures/retro16.mjs) into a world-anchored canvas at 24 px per unit.
 * Behind it, three painted parallax layers (far mountains, hills, clouds) scroll at their own rates in the
 * composite.
 */
export class RetroLayer16 {
  readonly texture: THREE.CanvasTexture;
  readonly origin = new THREE.Vector2();
  readonly size = new THREE.Vector2();
  readonly far = layerTexture('far16');
  readonly mid = layerTexture('mid16');
  readonly clouds = layerTexture('clouds16');
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private solids: SolidDef[];
  private x0: number;
  private y1: number;
  private signature = '';
  private patterns: { grassTop: CanvasPattern; earth: CanvasPattern; stone: CanvasPattern } | null = null;

  constructor(level: Level) {
    // exists in 16-bit (bit 1 of the generation mask)
    this.solids = level.solids.filter((s) => isRetroTile({ ...s, genMask: undefined }) && (s.genMask === undefined || (s.genMask & 2) !== 0));
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
    const y0 = Math.max(-16, Math.floor(minY));
    this.y1 = Math.ceil(maxY) + 2;
    this.origin.set(this.x0, y0);
    this.size.set((x1 - this.x0) * TILE16_PX, (this.y1 - y0) * TILE16_PX);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size.x;
    this.canvas.height = this.size.y;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    void loadImage(`${base}tiles16.png`).then((img) => {
      const cut = (i: number) => {
        const c = document.createElement('canvas');
        c.width = c.height = TILE16_PX;
        c.getContext('2d')!.drawImage(img, i * TILE16_PX, 0, TILE16_PX, TILE16_PX, 0, 0, TILE16_PX, TILE16_PX);
        return this.ctx.createPattern(c, 'repeat')!;
      };
      this.patterns = { grassTop: cut(0), earth: cut(1), stone: cut(2) };
      this.signature = '';
    });
  }

  update(world: World) {
    if (!this.patterns) return;
    const present = this.solids.filter((s) => world.get(s.id)?.enabled ?? s.enabled ?? true);
    const sig = present.map((s) => s.id).join(',');
    if (sig === this.signature) return;
    this.signature = sig;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.size.x, this.size.y);
    for (const s of present) {
      const px0 = Math.round((s.box.min.x - this.x0) * TILE16_PX);
      const px1 = Math.round((s.box.max.x - this.x0) * TILE16_PX);
      const py0 = Math.round((this.y1 - s.box.max.y) * TILE16_PX);
      const py1 = Math.round((this.y1 - s.box.min.y) * TILE16_PX);
      if (s.look === 'grass' || s.look === 'hedge') {
        ctx.fillStyle = this.patterns.earth;
        ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
        ctx.fillStyle = this.patterns.grassTop;
        ctx.fillRect(px0, py0, px1 - px0, Math.min(TILE16_PX, py1 - py0));
      } else {
        ctx.fillStyle = this.patterns.stone;
        ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
      }
    }
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
    this.far.dispose();
    this.mid.dispose();
    this.clouds.dispose();
  }
}
