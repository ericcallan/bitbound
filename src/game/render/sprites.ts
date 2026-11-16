import * as THREE from 'three';

/**
 * Hand-authored pixel sprites for the 8-bit generation. In 8-bit nothing is a 3D model: Pip,
 * enemies and pickups are flat 16×16 sprites in a handful of colours, exactly like the first
 * consoles. Each row is 16 characters; '.' is transparent.
 */
const PAL: Record<string, string> = {
  k: '#0d0b1e', // outline
  o: '#f0862a', // burnt orange
  c: '#fff4d6', // cream
  d: '#141a33', // screen
  e: '#b4eeff', // eye
  b: '#3a5fcd', // cobalt
  p: '#8e5bd6', // purple
  t: '#2fd6c3', // teal
  i: '#2b2d6e', // indigo
  w: '#fff4d6', // white-ish
  y: '#ffcf6b', // yellow
  r: '#b8461f', // rust
  g: '#4cc24a', // green
  G: '#1f8a5a', // dark green
  s: '#c9c3d8', // stone
  B: '#5ec8f0', // sky
};

const PIP_HEAD = [
  '......t.........',
  '......p.........',
  '..kkkkkkkkkkkk..',
  '.kooooooooooook.',
  '.kcddddddddddck.',
  '.kcddeddddeddck.',
  '.kcddeddddeddck.',
  '.kcddddddddddck.',
  '.kcccccccccccck.',
];
const PIP_BODY = ['..kooooooooook..', '..kooottttoook..', '.ckooottttoookc.', '..kooooooooook..'];

export const SPRITES: Record<string, string[][]> = {
  pip: [
    // idle
    [...PIP_HEAD, ...PIP_BODY, '..kkbbbkkbbbkk..', '.kbbbbk..kbbbbk.', '.kkkkkk..kkkkkk.'],
    // walk A
    [...PIP_HEAD, ...PIP_BODY, '..kkbbbkkbbbkk..', '.kbbbbk...kbbbbk', '.kkkkkk...kkkkkk'],
    // walk B
    [...PIP_HEAD, ...PIP_BODY, '...kbbbkkbbbk...', '..kbbbbkkbbbbk..', '..kkkkkkkkkkkk..'],
    // jump
    [...PIP_HEAD, 'c.kooooooooook.c', 'ck.oottttoo.kc..', '..kooottttoook..', '..kooooooooook..', '...kbbbkkbbbk...', '...kkkkkkkkkk...', '................'],
  ],
  glitch: [
    ['................', '................', '....kkkkkkkk....', '...kiiiiiiiik...', '..kiiiiiiiiiik..', '..kiwwiiiiwwik..', '..kiwkiiiiwkik..', '..kiiiiiiiiiik..', '..kppppppppppk..', '..kiiiiiiiiiik..', '..kiiiiiiiiiik..', '...kiiiiiiiik...', '...kkkkkkkkkk...', '...kk......kk...', '................', '................'],
    ['................', '................', '....kkkkkkkk....', '...kiiiiiiiik...', '..kiiiiiiiiiik..', '..kiwwiiiiwwik..', '..kiwkiiiiwkik..', '..kiiiiiiiiiik..', '..kppppppppppk..', '..kiiiiiiiiiik..', '..kiiiiiiiiiik..', '...kiiiiiiiik...', '...kkkkkkkkkk...', '....kk....kk....', '................', '................'],
  ],
  bit: [
    ['................', '................', '.......kk.......', '......kyyk......', '.....kyywyk.....', '....kyywyyyk....', '...kyywyyyyyk...', '...kyyyyyyyyk...', '...kyyyyyyyyk...', '....kyyyyyyk....', '.....kyyyyk.....', '......kyyk......', '.......kk.......', '................', '................', '................'],
    ['................', '................', '.......kk.......', '.......kk.......', '......kyyk......', '......kwyk......', '......kyyk......', '......kyyk......', '......kyyk......', '......kyyk......', '.......kk.......', '.......kk.......', '................', '................', '................', '................'],
  ],
  enforcer: [
    ['.....kkkkkk.....', '....kssssssk....', '....kseeeesk....', '....kssssssk....', '.....kkkkkk.....', '...kkiiiiiikk...', '..ksiiiiiiiisk..', '..ksiiiiiiiisk..', '..ksiippppiisk..', '..kkiiiiiiiikk..', '....kiiiiiik....', '....kik..kik....', '....kik..kik....', '...kssk..kssk...', '...kkkk..kkkk...', '................'],
    ['.....kkkkkk.....', '....kssssssk....', '....kseeeesk....', '....kssssssk....', '.....kkkkkk.....', '...kkiiiiiikk...', '..ksiiiiiiiisk..', '..ksiiiiiiiisk..', '..ksiippppiisk..', '..kkiiiiiiiikk..', '....kiiiiiik....', '...kik....kik...', '...kik....kik...', '..kssk....kssk..', '..kkkk....kkkk..', '................'],
  ],
  warden: [
    ['....kkkkkkkk....', '...kssssssssk...', '...ksrrrrrrsk...', '...kssssssssk...', '..kkkkkkkkkkkk..', '.kssiiiiiiiissk.', 'kssiiiyyyyiiissk', 'ksiiiiyyyyiiiisk', 'ksiiiiiiiiiiiisk', 'kkkiiiiiiiiiikkk', '..kiiiiiiiiiik..', '..kiiikkkkiiik..', '..ksssk..ksssk..', '..ksssk..ksssk..', '.kkkkkk..kkkkkk.', '................'],
  ],
  citizen: [
    ['................', '................', '.....kkkkkk.....', '....kyyyyyyk....', '....kyddddyk....', '....kyddddyk....', '....kyyyyyyk....', '.....kkkkkk.....', '....kggggggk....', '...kggggggggk...', '...kgkggggkgk...', '....kggggggk....', '....kgk..kgk....', '....kbk..kbk....', '....kkk..kkk....', '................'],
  ],
};

/** Wide backdrop tiles: classic flat cloud and bush. */
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
  bush: [
    '..........kkkkkk................',
    '........kkggggggkk.....kkkk.....',
    '.....kkkggggggggggkkkkkggggk....',
    '...kkgggggggggggggggggggggggk...',
    '..kgggggggGggggggggggGgggggggk..',
    '.kggggGggggggggGgggggggggggGgk..',
    'kggggggggggGgggggggggggGgggggggk',
    'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
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
