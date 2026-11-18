/**
 * Reference sheets for docs/ART_BIBLE.md, from the real art: the palette; the fixed silhouettes and the meadow
 * tree in every generation, from Blender renders of the game's own assets (scripts/blender/render_bible.py) and
 * the game's 16-bit sprite sheet. Subjects not modelled yet (Sprig, the Stitchling, the Lost Bit) are drawn here,
 * and labelled so. Nothing here ships.
 *
 *   Blender -b -P scripts/blender/render_bible.py && node scripts/art-bible-sheets.mjs
 *   → docs/art/{palette,silhouettes,tree-generations}.png
 */
import sharp from 'sharp';
import fs, { mkdirSync } from 'node:fs';

const OUT = 'docs/art';
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- palette

/** The world's colours. Every generation draws from these hues; see the bible for which subset each uses. */
export const PALETTE = {
  'Moss and sage': { mossDeep: '#3e5b3a', moss: '#5e7f45', sage: '#8fa76a', sageLight: '#c3cf8e' },
  'Soft turquoise': { tealDeep: '#2f6e73', turquoise: '#4fa3a0', foam: '#a9dccf' },
  'Warm amber': { amber: '#e0a142', honey: '#f2c978' },
  'Cream and ivory': { ivory: '#f1e6cf', cream: '#d9c7a3', stoneShade: '#a8957a' },
  Earth: { path: '#b98a5a', earth: '#7a5236', bark: '#5a3d2b' },
  'Muted cobalt': { cobaltDeep: '#24324f', cobalt: '#3d5684' },
  'Gentle lavender': { lavender: '#9c95c4', lavenderPale: '#cfc8e6', sprig: '#9a62d8' },
  "Pip's orange": { pip: '#e8742a', pipCream: '#f4e6cf', screen: '#1c2233' },
  'Dimensional tech (reserved)': { cyan: '#5fe0e6', brass: '#b8873b' },
  Ink: { ink: '#2a2230' },
};
const flat = Object.values(PALETTE).flatMap((g) => Object.entries(g));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));

/** A pixel-art ramp: shadows lean toward cobalt, highlights toward amber (hue-shifted, never toward grey). */
const ramp = (c, n) =>
  Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return t < 0.5 ? mix(PALETTE['Muted cobalt'].cobaltDeep, c, 0.45 + t * 1.1) : mix(c, PALETTE['Warm amber'].honey, (t - 0.5) * 0.7);
  });

/** 8-bit: the game's sixteen flat colours (PALETTE_8 in src/game/render/post/Pipeline.ts). Each tile uses three. */
const NES = ['#0d0b1e', '#2b3354', '#3d5f9c', '#5ec8f0', '#b4eeff', '#2fd6c3', '#2e7040', '#5ea83c', '#b0d860', '#fff4d6', '#ffcf6b', '#f0862a', '#a0603a', '#5e3a28', '#8e5bd6', '#cbb994'];
const RAMP_HUES = ['moss', 'sage', 'turquoise', 'cream', 'path', 'earth', 'lavender', 'pip'].map((k) => flat.find(([n]) => n === k)[1]);
const LIGHT = [
  ['8-bit', '#58b8f8', '#58b8f8', null],
  ['16-bit', '#7fb4e6', '#f2e2b0', '#cfc8e6'],
  ['Early 3D', '#9cc4e4', '#fff1c8', '#b9c9d8'],
  ['Stylized', '#a6d3ef', '#fff3d6', '#d6e4c8'],
  ['Modern HD', '#86a9cf', '#ffd9a0', '#a9b4c4'],
  ['Beyond', '#e8b98a', '#ffc27a', '#cfa9b8'],
];

function paletteSvg() {
  const W = 1200;
  let y = 30;
  const parts = [];
  const text = (x, yy, s, size = 14, fill = '#e8e3d6', weight = 'normal') =>
    parts.push(`<text x="${x}" y="${yy}" font-family="Helvetica" font-size="${size}" font-weight="${weight}" fill="${fill}">${s}</text>`);
  text(24, y, 'Bitbound palette · one set of hues, six levels of detail', 22, '#f6f0e2', 'bold');
  y += 34;
  text(24, y, 'Master palette (Modern HD and Beyond use these as base colours; light does the rest)', 14, '#b8b2a4');
  y += 14;
  let x = 24;
  for (const [group, cols] of Object.entries(PALETTE)) {
    const n = Object.keys(cols).length;
    const w = Math.max(n * 54, group.length * 7.2);
    if (x + w > W - 24) { x = 24; y += 104; }
    text(x, y + 14, group, 12, '#d9d3c4');
    Object.entries(cols).forEach(([name, c], i) => {
      parts.push(`<rect x="${x + i * 54}" y="${y + 22}" width="50" height="50" rx="6" fill="${c}" stroke="#ffffff22"/>`);
      text(x + i * 54, y + 88, c, 10, '#9e9888');
    });
    x += w + 26;
  }
  y += 124;
  text(24, y, '8-bit · 16 flat colours (3 per tile, plus transparent)', 14, '#b8b2a4');
  NES.forEach((c, i) => parts.push(`<rect x="${24 + i * 46}" y="${y + 12}" width="42" height="42" fill="${c}" stroke="#ffffff22"/>`));
  y += 82;
  text(24, y, '16-bit · hue-shifted ramps (shadow toward cobalt, light toward amber), 4 per material', 14, '#b8b2a4');
  RAMP_HUES.forEach((c, j) => ramp(c, 4).forEach((r, i) => parts.push(`<rect x="${24 + j * 142 + i * 32}" y="${y + 12}" width="30" height="30" fill="${r}"/>`)));
  y += 64;
  text(24, y, 'Stylized · three flat bands per material, ink outline', 14, '#b8b2a4');
  RAMP_HUES.forEach((c, j) => ramp(c, 5).slice(1, 4).forEach((r, i) => parts.push(`<rect x="${24 + j * 142 + i * 40}" y="${y + 12}" width="38" height="30" fill="${r}" stroke="${PALETTE.Ink.ink}" stroke-width="2"/>`)));
  y += 64;
  text(24, y, 'Light per generation · sky, key light, distance haze', 14, '#b8b2a4');
  LIGHT.forEach(([name, sky, key, haze], i) => {
    const xx = 24 + i * 192;
    parts.push(`<rect x="${xx}" y="${y + 12}" width="56" height="40" fill="${sky}"/><rect x="${xx + 58}" y="${y + 12}" width="56" height="40" fill="${key}"/>`);
    if (haze) parts.push(`<rect x="${xx + 116}" y="${y + 12}" width="56" height="40" fill="${haze}"/>`);
    text(xx, y + 70, name, 12, '#d9d3c4');
  });
  y += 96;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}"><rect width="100%" height="100%" fill="#14161c"/>${parts.join('')}</svg>`;
}

// ---------------------------------------------------------------- silhouettes

const P = PALETTE;
const R = 'docs/art/renders';

/** Subjects not modelled yet, drawn in a 200×240 box standing on y = 230. */
const DRAWN = {
  'Lost Bit': (f) => `<path d="M100 120 L124 165 L100 210 L76 165 Z" fill="${f.tech}"/><path d="M100 132 L112 165 L100 176 Z" fill="#ffffff66"/>`,
  Sprig: (f) => `
    <path d="M100 230 C96 200 106 170 100 140" stroke="${f.stem}" stroke-width="6" fill="none"/>
    <path d="M100 196 C80 186 70 196 66 206 C80 208 92 204 100 196 Z" fill="${f.stem}"/>
    ${Array.from({ length: 9 }, (_, i) => {
      const a = (i / 9) * Math.PI * 2;
      return `<ellipse cx="${100 + Math.cos(a) * 34}" cy="${104 + Math.sin(a) * 34}" rx="16" ry="9" transform="rotate(${(a * 180) / Math.PI} ${100 + Math.cos(a) * 34} ${104 + Math.sin(a) * 34})" fill="${f.petal}"/>`;
    }).join('')}
    <circle cx="100" cy="104" r="30" fill="${f.sprig}"/>
    <circle cx="90" cy="98" r="7" fill="${f.eye}"/><circle cx="112" cy="98" r="7" fill="${f.eye}"/>`,
  Stitchling: (f) => `
    <ellipse cx="100" cy="176" rx="52" ry="44" fill="${f.stitch}"/>
    <path d="M60 170 Q100 150 140 170" stroke="${f.seam}" stroke-width="3" fill="none" stroke-dasharray="6 5"/>
    <circle cx="100" cy="182" r="14" fill="${f.screen}"/><circle cx="100" cy="182" r="6" fill="${f.tech}"/>
    <rect x="74" y="214" width="12" height="16" rx="4" fill="${f.seam}"/><rect x="114" y="214" width="12" height="16" rx="4" fill="${f.seam}"/>
    <path d="M100 132 L100 118" stroke="${f.seam}" stroke-width="3"/><circle cx="100" cy="114" r="5" fill="${f.brass}"/>`,
};
const DRAWN_FILL = {
  tech: P['Dimensional tech (reserved)'].cyan, brass: P['Dimensional tech (reserved)'].brass, screen: P["Pip's orange"].screen,
  stem: P['Moss and sage'].moss, petal: P['Gentle lavender'].lavender, sprig: P['Gentle lavender'].sprig, eye: '#ffffff',
  stitch: P['Cream and ivory'].cream, seam: P['Muted cobalt'].cobaltDeep,
};
const DRAWN_DARK = Object.fromEntries(Object.keys(DRAWN_FILL).map((k) => [k, '#1b1d24']));

/** A render (or drawing) fitted into a card: `dark` turns it into its silhouette. */
async function fit(input, w, h, dark = false) {
  let img = sharp(input).trim({ threshold: 1 }).resize(Math.round(w * 0.86), Math.round(h * 0.86), { fit: 'inside' });
  if (dark) {
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 0x1b;
      data[i + 1] = 0x1d;
      data[i + 2] = 0x24;
      data[i + 3] = data[i + 3] > 40 ? 255 : 0;
    }
    img = sharp(data, { raw: info });
  }
  return img.png().toBuffer();
}

async function silhouettes() {
  const subjects = [
    ['Meadow tree', `${R}/meadow_tree_hd.png`],
    ['Great Tree', `${R}/great_tree_hd.png`],
    ['Rock (stepped: Phase 2)', `${R}/rock_hd.png`],
    ['Ivory arch', `${R}/arch_hd.png`],
    ['Pedestal (plinth only)', `${R}/pedestal_hd.png`],
    ['Pip', `${R}/pip_hd.png`],
    ...Object.keys(DRAWN).map((k) => [`${k} (drawn)`, k]),
  ];
  const cw = 200, ch = 240, gap = 16, W = subjects.length * (cw + gap) + gap, H = ch * 2 + 150;
  const comp = [];
  for (const [i, [label, src]] of subjects.entries()) {
    const x = gap + i * (cw + gap);
    const svg = (fill) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="240">${DRAWN[src](fill)}</svg>`);
    const drawn = src in DRAWN;
    for (const [row, dark, card] of [[0, true, '#eee7d6'], [1, false, '#a9c4d3']]) {
      const y = 50 + row * (ch + 16);
      comp.push({ input: Buffer.from(`<svg width="${cw}" height="${ch}"><rect width="${cw}" height="${ch}" rx="10" fill="${card}"/></svg>`), left: x, top: y });
      const art = drawn ? await sharp(svg(dark ? DRAWN_DARK : DRAWN_FILL)).png().toBuffer() : await fit(src, cw, ch, dark);
      const meta = await sharp(art).metadata();
      comp.push({ input: art, left: x + Math.round((cw - meta.width) / 2), top: y + ch - meta.height - (drawn ? 0 : 10) });
    }
    comp.push({ input: Buffer.from(`<svg width="${cw}" height="40"><text x="${cw / 2}" y="24" text-anchor="middle" font-family="Helvetica" font-size="15" fill="#e8e3d6">${label}</text></svg>`), left: x, top: 50 + ch * 2 + 26 });
  }
  comp.push({ input: Buffer.from(`<svg width="${W}" height="44"><text x="${gap}" y="32" font-family="Helvetica" font-weight="bold" font-size="22" fill="#f6f0e2">Fixed silhouettes · the game's own assets, rendered in Blender (top: shape only)</text></svg>`), left: 0, top: 0 });
  await sharp({ create: { width: W, height: H, channels: 3, background: '#14161c' } }).composite(comp).png().toFile(`${OUT}/silhouettes.png`);
}

/** The canopy masses of scripts/blender/create_tree.py (MEADOW): [x, up, half-width, half-height] of the height. */
const MEADOW = [[-0.17, 0.52, 0.235, 0.186], [0.16, 0.56, 0.245, 0.196], [-0.01, 0.775, 0.265, 0.225]];

/** The game's 8-bit tree (src/game/render/decor.ts): a trunk and one block per canopy mass, on the pixel grid. */
async function eightBitTree(h) {
  const px = 6;
  const H = Math.round((h * 0.86) / px);
  const W = Math.round(H * 0.8);
  const cells = Array.from({ length: H }, () => Array(W).fill(null));
  const rect = (cx, cy, hw, hh, c) => {
    for (let y = Math.round(cy - hh); y < Math.round(cy + hh); y++)
      for (let x = Math.round(cx - hw); x < Math.round(cx + hw); x++) if (y >= 0 && y < H && x >= 0 && x < W) cells[y][x] = c;
  };
  const base = H - 1;
  const mid = W / 2;
  rect(mid, base - 0.21 * H, 0.045 * H, 0.21 * H, NES[13]);
  MEADOW.forEach(([x, up, rx, rz], i) => rect(mid + x * H, base - up * H, rx * H * 0.92, rz * H * 0.92, i === 2 ? NES[8] : NES[7]));
  const svg = cells.map((row, y) => row.map((c, x) => (c ? `<rect x="${x * px}" y="${y * px}" width="${px}" height="${px}" fill="${c}"/>` : '')).join('')).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W * px}" height="${H * px}">${svg}</svg>`)).png().toBuffer();
}

async function treeSheet() {
  const T = 300, H = 360, gap = 14;
  const sheet = JSON.parse(fs.readFileSync('public/assets/retro/sprites16.json', 'utf8')).sprites.tree;
  const sprite16 = await sharp('public/assets/retro/sprites16.png').extract({ left: sheet.x, top: sheet.y, width: sheet.w, height: sheet.h }).png().toBuffer();
  const panels = [
    ['8-bit', "the game's 8-bit tree: one block per canopy mass", '#5ec8f0', await eightBitTree(H)],
    ['16-bit', "the game's 16-bit sprite (pre-rendered from the tree)", '#7fb4e6', await sharp(sprite16).resize({ height: Math.round(H * 0.86), kernel: 'nearest' }).png().toBuffer()],
    ['Early 3D', 'meadow_tree_low · faceted, flat light', '#9cc4e4', await fit(`${R}/meadow_tree_low_early.png`, T, H)],
    ['Stylized', 'meadow_tree_shell · three bands, ink', '#a6d3ef', await fit(`${R}/meadow_tree_shell_stylized.png`, T, H)],
    ['Modern HD', 'meadow_tree · leaf clumps, soft light', '#86a9cf', await fit(`${R}/meadow_tree_hd.png`, T, H)],
    ['Beyond', 'meadow_tree · low warm sun', '#e8b98a', await fit(`${R}/meadow_tree_beyond.png`, T, H)],
  ];
  const W = panels.length * (T + gap) + gap;
  const comp = [];
  for (const [i, [name, note, sky, art]] of panels.entries()) {
    const x = gap + i * (T + gap);
    comp.push({ input: Buffer.from(`<svg width="${T}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="#eef0e6"/></linearGradient></defs><rect width="${T}" height="${H}" fill="url(#g)"/><rect y="${H - 14}" width="${T}" height="14" fill="#7a8f55"/></svg>`), left: x, top: 56 });
    const meta = await sharp(art).metadata();
    comp.push({ input: art, left: x + Math.round((T - meta.width) / 2), top: 56 + H - 12 - meta.height });
    comp.push({ input: Buffer.from(`<svg width="${T}" height="60"><text x="0" y="22" font-family="Helvetica" font-weight="bold" font-size="18" fill="#f1ead9">${name}</text><text x="0" y="44" font-family="Helvetica" font-size="12" fill="#b8b2a4">${note}</text></svg>`), left: x, top: 56 + H + 6 });
  }
  comp.push({ input: Buffer.from(`<svg width="${W}" height="50"><text x="${gap}" y="34" font-family="Helvetica" font-weight="bold" font-size="22" fill="#f6f0e2">The meadow tree in every generation · the game's own tree (scripts/blender/create_tree.py), rendered in Blender</text></svg>`), left: 0, top: 0 });
  await sharp({ create: { width: W, height: 56 + H + 72, channels: 3, background: '#14161c' } }).composite(comp).png().toFile(`${OUT}/tree-generations.png`);
}

await sharp(Buffer.from(paletteSvg())).png().toFile(`${OUT}/palette.png`);
await silhouettes();
await treeSheet();
console.log(`wrote ${OUT}/palette.png, silhouettes.png, tree-generations.png`);
