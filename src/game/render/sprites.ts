import * as THREE from 'three';

/**
 * Hand-authored pixel sprites for the 8-bit generation, drawn in PALETTE_8 colours. Each row is 16
 * characters; '.' is transparent.
 */
const PAL: Record<string, string> = {
  k: '#0d0b1e', // outline
  o: '#f0862a', // burnt orange
  c: '#fff4d6', // cream
  w: '#fff4d6', // cloud white
};

/**
 * 8-bit Pip, 16×16 in three colours (outline, burnt orange, cream) like a 1985 console sprite:
 * idle, two walk frames and a jump frame.
 */
export const SPRITES: Record<string, string[][]> = {
  pip: [
    [
      '.......kk.......',
      '.......kk.......',
      '...kkkkkkkkkk...',
      '..kooooooooook..',
      '..kokkkkkkkkok..',
      '..kokckkkkckok..',
      '..kokckkkkckok..',
      '..kokkkkkkkkok..',
      '..kooooooooook..',
      '...kkkkkkkkkk...',
      '....kccooccck...',
      '...ckccooccckc..',
      '....kccccccck...',
      '....kok..kok....',
      '...kook..kook...',
      '...kkkk..kkkk...',
    ],
    [
      '.......kk.......',
      '.......kk.......',
      '...kkkkkkkkkk...',
      '..kooooooooook..',
      '..kokkkkkkkkok..',
      '..kokckkkkckok..',
      '..kokckkkkckok..',
      '..kokkkkkkkkok..',
      '..kooooooooook..',
      '...kkkkkkkkkk...',
      '....kccooccck...',
      '...ckccooccckc..',
      '....kccccccck...',
      '...kok....kok...',
      '..kook....kook..',
      '..kkkk....kkkk..',
    ],
    [
      '.......kk.......',
      '.......kk.......',
      '...kkkkkkkkkk...',
      '..kooooooooook..',
      '..kokkkkkkkkok..',
      '..kokckkkkckok..',
      '..kokckkkkckok..',
      '..kokkkkkkkkok..',
      '..kooooooooook..',
      '...kkkkkkkkkk...',
      '....kccooccck...',
      '...ckccooccckc..',
      '....kccccccck...',
      '.....kokkok.....',
      '....kookkook....',
      '....kkkkkkkk....',
    ],
    [
      '.......kk.......',
      '.......kk.......',
      '...kkkkkkkkkk...',
      '..kooooooooook..',
      '..kokkkkkkkkok..',
      '..kokckkkkckok..',
      '..kokckkkkckok..',
      '..kokkkkkkkkok..',
      '..kooooooooook..',
      '...kkkkkkkkkk...',
      '.c..kccooccck.c.',
      '..ckccooccccck..',
      '....kccccccck...',
      '....kok..kok....',
      '...kook...kook..',
      '...kkk.....kkk..',
    ],
  ],
};

/** Wide backdrop tiles: the classic flat cloud. */
export const BACKDROP: Record<string, string[]> = {
  cloud: [
    '................................',
    '...........kkkkkk...............',
    '.........kkwwwwwwkk.............',
    '.....kkkkwwwwwwwwwwkkkk.........',
    '...kkwwwwwwwwwwwwwwwwwwkk.......',
    '..kwwwwwwwwwwwwwwwwwwwwwwk......',
    '.kwwwwwwwwwwwwwwwwwwwwwwwwkk....',
    '.kwwwwwwwwwwwwwwwwwwwwwwwwwwk...',
    '..kkwwwwwwwwwwwwwwwwwwwwwwwwk...',
    '....kkkkkkkkkkkkkkkkkkkkkkkk....',
  ],
};

function paint(rows: string[]): THREE.CanvasTexture {
  const h = rows.length;
  const w = rows[0].length;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch === '.' || !PAL[ch]) continue;
      ctx.fillStyle = PAL[ch];
      ctx.fillRect(x, y, 1, 1);
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  return t;
}

const texCache = new Map<string, THREE.CanvasTexture[]>();
export function spriteFrames(name: string): THREE.CanvasTexture[] {
  let f = texCache.get(name);
  if (!f) {
    f = (SPRITES[name] ?? [BACKDROP[name]]).map(paint);
    texCache.set(name, f);
  }
  return f;
}

/** A camera-facing pixel sprite with frame animation and horizontal flip. */
export class PixelSprite {
  sprite: THREE.Sprite;
  private frames: THREE.CanvasTexture[];
  private mat: THREE.SpriteMaterial;
  constructor(name: string, public width = 1, public height = 1) {
    this.frames = spriteFrames(name);
    this.mat = new THREE.SpriteMaterial({ map: this.frames[0], alphaTest: 0.5, transparent: false, toneMapped: false, fog: false });
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.center.set(0.5, 0);
    this.sprite.scale.set(width, height, 1);
    this.sprite.visible = false;
  }
  set(frame: number, flip = false) {
    const t = this.frames[Math.max(0, Math.min(this.frames.length - 1, frame))];
    if (this.mat.map !== t) {
      this.mat.map = t;
      this.mat.needsUpdate = true;
    }
    this.sprite.scale.x = (flip ? -1 : 1) * this.width;
    this.sprite.scale.y = this.height;
  }
  dispose() {
    this.mat.dispose();
  }
}
