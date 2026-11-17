import * as THREE from 'three';

/**
 * The 16-bit sprite sheet: Pip and scenery pre-rendered from the Blender models and reduced to a small palette
 * (scripts/blender/render_sprites16.py, scripts/textures/sprites16.mjs). Each sprite keeps its model's origin
 * as its anchor and its real size in world units (24 px per unit), so it stands exactly where the model did.
 */
interface SheetEntry {
  x: number;
  y: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
}
interface Sheet {
  ppu: number;
  width: number;
  height: number;
  sprites: Record<string, SheetEntry>;
}

const base = `${import.meta.env.BASE_URL}assets/retro/`;
let sheet: Sheet | null = null;
let texture: THREE.Texture | null = null;
const waiting = new Set<Sprite16>();

function load() {
  if (texture) return texture;
  texture = new THREE.TextureLoader().load(`${base}sprites16.png`);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  void fetch(`${base}sprites16.json`)
    .then((r) => r.json() as Promise<Sheet>)
    .then((s) => {
      sheet = s;
      for (const sp of waiting) sp.set(sp.frame);
      waiting.clear();
    })
    .catch(() => {});
  return texture;
}

/** A camera-facing sprite showing one named frame of the 16-bit sheet. */
export class Sprite16 {
  readonly sprite: THREE.Sprite;
  frame: string;
  private map: THREE.Texture;
  private mat: THREE.SpriteMaterial;
  private flip = false;

  constructor(frame: string, public scale = 1) {
    this.frame = frame;
    this.map = load().clone();
    this.mat = new THREE.SpriteMaterial({ map: this.map, alphaTest: 0.5, transparent: false, toneMapped: false, fog: false });
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.scale.set(0.001, 0.001, 1);
    this.set(frame);
  }

  set(frame: string, flip = this.flip) {
    this.frame = frame;
    this.flip = flip;
    const e = sheet?.sprites[frame];
    if (!sheet || !e) {
      waiting.add(this);
      return;
    }
    const W = sheet.width;
    const H = sheet.height;
    this.map.repeat.set(((flip ? -1 : 1) * e.w) / W, e.h / H);
    // canvas rows run top-down; texture v runs bottom-up
    this.map.offset.set((flip ? e.x + e.w : e.x) / W, 1 - (e.y + e.h) / H);
    // offset and repeat are uniforms: no texture upload (needsUpdate would re-upload the whole sheet each frame)
    const ox = flip ? e.w - e.ox : e.ox;
    this.sprite.center.set(ox / e.w, e.oy / e.h);
    this.sprite.scale.set((e.w / sheet.ppu) * this.scale, (e.h / sheet.ppu) * this.scale, 1);
  }

  dispose() {
    waiting.delete(this);
    this.mat.dispose();
    this.map.dispose();
  }
}
