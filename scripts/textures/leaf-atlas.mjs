/**
 * Original leaf-cluster cutout texture for tree foliage cards: ~60 overlapping leaves with veins and
 * varied greens, on transparency. Writes assets/source-textures/leaf_cluster.png (1024², RGBA).
 *   node scripts/textures/leaf-atlas.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUT = path.join(ROOT, 'assets', 'source-textures', 'leaf_cluster.png');
const S = 1024;

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const greens = ['#3f7d2a', '#4f9233', '#5ea43c', '#6fb544', '#3a6e27', '#86c255', '#558a30', '#7aa83c'];

function leaf(cx, cy, len, w, rot, fill) {
  // a pointed ellipse leaf with a midrib and a few veins
  const x0 = -len / 2;
  const x1 = len / 2;
  const body = `M ${x0} 0 C ${x0 * 0.4} ${-w} ${x1 * 0.5} ${-w} ${x1} 0 C ${x1 * 0.5} ${w} ${x0 * 0.4} ${w} ${x0} 0 Z`;
  let veins = `<path d="M ${x0 * 0.9} 0 L ${x1 * 0.92} 0" stroke="rgba(230,255,180,0.22)" stroke-width="${Math.max(1.2, w * 0.08)}" fill="none"/>`;
  for (let i = 1; i < 5; i++) {
    const t = x0 + (len * i) / 5;
    veins += `<path d="M ${t} 0 L ${t + len * 0.12} ${-w * 0.6}" stroke="rgba(230,255,180,0.2)" stroke-width="1.2" fill="none"/>`;
    veins += `<path d="M ${t} 0 L ${t + len * 0.12} ${w * 0.6}" stroke="rgba(230,255,180,0.2)" stroke-width="1.2" fill="none"/>`;
  }
  const shade = `<path d="${body}" fill="url(#shade)" />`;
  return `<g transform="translate(${cx} ${cy}) rotate(${rot})"><path d="${body}" fill="${fill}" />${shade}${veins}</g>`;
}

let leaves = '';
// twigs first, leaves on top: densest in the middle, thinning to ragged edges
for (let i = 0; i < 9; i++) {
  const a = rnd() * Math.PI * 2;
  leaves += `<path d="M ${S / 2} ${S / 2} Q ${S / 2 + Math.cos(a) * 180} ${S / 2 + Math.sin(a) * 120} ${S / 2 + Math.cos(a) * 380} ${S / 2 + Math.sin(a) * 380}" stroke="#4a3520" stroke-width="7" fill="none" />`;
}
for (let i = 0; i < 140; i++) {
  const r = Math.sqrt(rnd()) * S * 0.4;
  const a = rnd() * Math.PI * 2;
  const cx = S / 2 + Math.cos(a) * r;
  const cy = S / 2 + Math.sin(a) * r;
  const len = 70 + rnd() * 55;
  leaves += leaf(cx, cy, len, len * (0.28 + rnd() * 0.08), rnd() * 360, greens[Math.floor(rnd() * greens.length)]);
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
<defs><linearGradient id="shade" x1="0" y1="-1" x2="0" y2="1" gradientUnits="objectBoundingBox">
<stop offset="0" stop-color="rgba(255,255,220,0.18)"/><stop offset="1" stop-color="rgba(0,20,0,0.28)"/></linearGradient></defs>
${leaves}</svg>`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(OUT);
console.log('leaf cluster →', path.relative(ROOT, OUT));
