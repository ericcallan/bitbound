/**
 * Reference sheets for docs/ART_BIBLE.md: the palette, the fixed silhouettes, and the meadow tree drawn the way
 * each generation would draw it. These are design diagrams for the bible, not game art; nothing here ships.
 *
 *   node scripts/art-bible-sheets.mjs        writes docs/art/{palette,silhouettes,tree-generations}.png
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

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

/** 8-bit: sixteen flat colours, one per hue family plus black and white. Each tile uses three of them. */
const NES = ['#000000', '#fcfcfc', '#3e5b3a', '#5e9f3a', '#a8d060', '#2f6e73', '#58b8f8', '#e0a142', '#f1e6cf', '#a8957a', '#7a5236', '#3d5684', '#9c95c4', '#9a62d8', '#e8742a', '#5fe0e6'];
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
/** Each shape in a 200×240 box, standing on y = 230. `fill` lets the same drawing be a silhouette or coloured. */
const SHAPES = {
  'Meadow tree': (f) => `
    <path d="M92 230 C96 196 88 160 98 118 L114 118 C108 160 116 196 116 230 Z" fill="${f.trunk}"/>
    <ellipse cx="70" cy="124" rx="48" ry="38" fill="${f.canopy}"/>
    <ellipse cx="136" cy="116" rx="50" ry="40" fill="${f.canopy}"/>
    <ellipse cx="102" cy="72" rx="54" ry="46" fill="${f.canopy}"/>`,
  'Great Tree': (f) => `
    <path d="M70 230 C82 200 84 170 80 130 C70 116 52 110 40 112 C60 100 80 104 90 114 L96 80 L112 80 L114 114 C126 102 148 98 164 110 C148 110 132 118 126 132 C122 170 126 200 138 230 Z" fill="${f.trunk}"/>
    <ellipse cx="44" cy="96" rx="40" ry="30" fill="${f.canopy}"/>
    <ellipse cx="160" cy="92" rx="40" ry="30" fill="${f.canopy}"/>
    <ellipse cx="102" cy="56" rx="66" ry="44" fill="${f.canopy}"/>`,
  'Stepped rock': (f) => `
    <path d="M14 230 L16 168 Q18 156 30 154 L74 150 Q84 148 86 136 L90 96 Q92 84 104 82 L150 78 Q164 78 166 92 L186 230 Z" fill="${f.rock}"/>
    <path d="M30 154 L74 150 Q84 148 86 136 L88 116 Q60 132 30 154 Z" fill="${f.rockTop}"/>
    <path d="M104 82 L150 78 Q164 78 166 92 L168 104 Q130 92 104 82 Z" fill="${f.rockTop}"/>`,
  'Ivory arch': (f) => `
    <rect x="34" y="96" width="30" height="134" rx="4" fill="${f.stone}"/>
    <rect x="136" y="96" width="30" height="134" rx="4" fill="${f.stone}"/>
    <rect x="22" y="70" width="156" height="30" rx="5" fill="${f.stone}"/>
    <circle cx="100" cy="85" r="10" fill="none" stroke="${f.tech}" stroke-width="3"/>
    <path d="M100 75 L100 95 M91 80 L109 90 M91 90 L109 80" stroke="${f.tech}" stroke-width="2"/>`,
  'Shard pedestal': (f) => `
    <rect x="70" y="190" width="60" height="40" rx="4" fill="${f.stone}"/>
    <rect x="62" y="180" width="76" height="12" rx="3" fill="${f.stone}"/>
    <path d="M100 96 L122 136 L100 176 L78 136 Z" fill="${f.tech}"/>
    <ellipse cx="100" cy="136" rx="38" ry="10" fill="none" stroke="${f.brass}" stroke-width="3"/>`,
  'Lost Bit': (f) => `<path d="M100 120 L124 165 L100 210 L76 165 Z" fill="${f.tech}"/><path d="M100 132 L112 165 L100 176 Z" fill="#ffffff66"/>`,
  Pip: (f) => `
    <path d="M100 52 L100 70" stroke="${f.pip}" stroke-width="4"/><circle cx="100" cy="48" r="6" fill="${f.tech}"/>
    <rect x="62" y="70" width="76" height="64" rx="18" fill="${f.pip}"/>
    <rect x="72" y="80" width="56" height="44" rx="10" fill="${f.screen}"/>
    <rect x="84" y="94" width="10" height="14" rx="3" fill="${f.tech}"/><rect x="106" y="94" width="10" height="14" rx="3" fill="${f.tech}"/>
    <rect x="76" y="136" width="48" height="50" rx="12" fill="${f.pip}"/>
    <rect x="86" y="146" width="28" height="26" rx="6" fill="${f.cream}"/><circle cx="100" cy="159" r="7" fill="${f.tech}"/>
    <rect x="80" y="186" width="14" height="18" fill="${f.cream}"/><rect x="106" y="186" width="14" height="18" fill="${f.cream}"/>
    <rect x="70" y="204" width="30" height="26" rx="10" fill="${f.boot}"/><rect x="100" y="204" width="30" height="26" rx="10" fill="${f.boot}"/>`,
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

const COLOURED = {
  trunk: P.Earth.bark, canopy: P['Moss and sage'].moss, rock: P['Cream and ivory'].stoneShade, rockTop: P['Moss and sage'].sage,
  stone: P['Cream and ivory'].ivory, tech: P['Dimensional tech (reserved)'].cyan, brass: P['Dimensional tech (reserved)'].brass,
  pip: P["Pip's orange"].pip, screen: P["Pip's orange"].screen, cream: P["Pip's orange"].pipCream, boot: P['Muted cobalt'].cobalt,
  stem: P['Moss and sage'].moss, petal: P['Gentle lavender'].lavender, sprig: P['Gentle lavender'].sprig, eye: '#ffffff',
  stitch: P['Cream and ivory'].cream, seam: P['Muted cobalt'].cobaltDeep,
};
const SILHOUETTE = Object.fromEntries(Object.keys(COLOURED).map((k) => [k, '#1b1d24']));

function silhouettesSvg() {
  const names = Object.keys(SHAPES);
  const cw = 200, ch = 240, gap = 16, W = names.length * (cw + gap) + gap;
  // silhouettes on cream; colour on a soft sky so ivory stone stays visible
  const row = (fills, y, card) =>
    names.map((n, i) => `<g transform="translate(${gap + i * (cw + gap)} ${y})"><rect width="${cw}" height="${ch}" rx="10" fill="${card}"/>${SHAPES[n](fills)}</g>`).join('');
  const labels = names.map((n, i) => `<text x="${gap + i * (cw + gap) + cw / 2}" y="${66 + ch * 2 + 46}" text-anchor="middle" font-family="Helvetica" font-size="16" fill="#e8e3d6">${n}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${ch * 2 + 140}">
    <rect width="100%" height="100%" fill="#14161c"/>
    <text x="${gap}" y="34" font-family="Helvetica" font-weight="bold" font-size="22" fill="#f6f0e2">Fixed silhouettes · must read the same in all six generations (top: shape only)</text>
    ${row(SILHOUETTE, 50, '#eee7d6')}${row(COLOURED, 66 + ch, '#a9c4d3')}${labels}</svg>`;
}

// ---------------------------------------------------------------- one tree, six generations

const TREE = { trunk: [[92, 230], [96, 196], [88, 160], [98, 118], [114, 118], [108, 160], [116, 196], [116, 230]], masses: [[70, 124, 48, 38], [136, 116, 50, 40], [102, 72, 54, 46]] };
const sky = (a, b) => `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="200" height="240" fill="url(#sky)"/>`;
const trunkPath = `M92 230 C96 196 88 160 98 118 L114 118 C108 160 116 196 116 230 Z`;
const ground = (c, c2) => `<rect y="226" width="200" height="14" fill="${c}"/>${c2 ? `<rect y="226" width="200" height="3" fill="${c2}"/>` : ''}`;

/** Flat polygon facets for an ellipse, lit from the upper left: the Early 3D look. */
function facets([cx, cy, rx, ry], base) {
  const n = 7, pts = Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2 + 0.3) * rx, cy + Math.sin((i / n) * Math.PI * 2 + 0.3) * ry]);
  return pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    const a = Math.atan2((p[1] + q[1]) / 2 - cy, (p[0] + q[0]) / 2 - cx);
    const lit = 0.5 + 0.5 * Math.cos(a - (-2.3));
    return `<path d="M${cx} ${cy - ry * 0.15} L${p[0]} ${p[1]} L${q[0]} ${q[1]} Z" fill="${mix(mix(base, P['Muted cobalt'].cobaltDeep, 0.35), mix(base, P['Warm amber'].honey, 0.45), lit)}"/>`;
  }).join('');
}

const GENERATIONS = [
  {
    name: '8-bit', note: 'shape in 16px blocks · 3 colours · no light',
    res: 34, colours: 4,
    svg: () => `<rect width="200" height="240" fill="#58b8f8"/>${ground('#7a5236', '#5e9f3a')}<path d="${trunkPath}" fill="#7a5236"/>${TREE.masses.map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#5e9f3a"/>`).join('')}<ellipse cx="96" cy="62" rx="30" ry="22" fill="#a8d060"/>`,
  },
  {
    name: '16-bit', note: 'more pixels · 4-step hue-shifted ramps · a sky gradient',
    res: 80, colours: 14,
    svg: () => {
      const [d, m, l, h] = ramp(P['Moss and sage'].moss, 4);
      return `${sky('#7fb4e6', '#cfe6f0')}${ground(ramp(P.Earth.path, 4)[1], m)}<path d="${trunkPath}" fill="${ramp(P.Earth.bark, 4)[1]}"/><path d="M106 120 L114 118 C108 160 116 196 116 230 L108 230 C106 196 102 160 106 120 Z" fill="${ramp(P.Earth.bark, 4)[0]}"/>${TREE.masses.map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${d}"/><ellipse cx="${x - rx * 0.12}" cy="${y - ry * 0.12}" rx="${rx * 0.86}" ry="${ry * 0.82}" fill="${m}"/><ellipse cx="${x - rx * 0.3}" cy="${y - ry * 0.32}" rx="${rx * 0.5}" ry="${ry * 0.42}" fill="${l}"/><ellipse cx="${x - rx * 0.4}" cy="${y - ry * 0.45}" rx="${rx * 0.2}" ry="${ry * 0.16}" fill="${h}"/>`).join('')}`;
    },
  },
  {
    name: 'Early 3D', note: 'volume as flat facets · small blurry texture · coloured fog',
    res: 110, colours: 0,
    svg: () => `${sky('#9cc4e4', '#dde6dc')}${ground(P.Earth.path)}<path d="M92 230 L90 160 L99 118 L113 118 L112 160 L116 230 Z" fill="${P.Earth.bark}"/><path d="M106 118 L113 118 L112 160 L116 230 L108 230 Z" fill="${mix(P.Earth.bark, '#000', 0.3)}"/>${TREE.masses.map((m) => facets(m, P['Moss and sage'].moss)).join('')}`,
  },
  {
    name: 'Stylized', note: 'the true shape · three flat bands · ink outline',
    res: 0,
    svg: () => {
      const r = ramp(P['Moss and sage'].moss, 5);
      const ink = P.Ink.ink;
      return `${sky('#a6d3ef', '#eaf3e6')}${ground(r[2], r[3])}<path d="${trunkPath}" fill="${P.Earth.bark}" stroke="${ink}" stroke-width="4"/>${TREE.masses.map(([x, y, rx, ry], i) => `<clipPath id="c${i}"><ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"/></clipPath><ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${r[2]}" stroke="${ink}" stroke-width="4"/><g clip-path="url(#c${i})"><ellipse cx="${x + rx * 0.25}" cy="${y + ry * 0.7}" rx="${rx * 1.1}" ry="${ry * 0.7}" fill="${r[1]}"/><ellipse cx="${x - rx * 0.3}" cy="${y - ry * 0.5}" rx="${rx * 0.45}" ry="${ry * 0.3}" fill="${r[3]}"/></g><ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="none" stroke="${ink}" stroke-width="4"/>`).join('')}`;
    },
  },
  {
    name: 'Modern HD', note: 'the same shape in leaf clumps · soft light, shadow',
    res: 0,
    svg: () => {
      const r = ramp(P['Moss and sage'].moss, 6);
      let clumps = '';
      let s = 7;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (const [x, y, rx, ry] of TREE.masses) for (let i = 0; i < 26; i++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.85;
        const px = x + Math.cos(a) * rx * d, py = y + Math.sin(a) * ry * d;
        const lit = Math.max(0, Math.min(1, 0.55 - (py - y) / ry * 0.35 - (px - x) / rx * 0.25));
        clumps += `<circle cx="${px}" cy="${py}" r="${10 + rnd() * 8}" fill="url(#leaf${Math.round(lit * 4)})"/>`;
      }
      const grads = [0, 1, 2, 3, 4].map((k) => `<radialGradient id="leaf${k}" cx="0.35" cy="0.3"><stop offset="0" stop-color="${r[Math.min(5, k + 1)]}"/><stop offset="1" stop-color="${r[Math.max(0, k - 1)]}"/></radialGradient>`).join('');
      const bark = mix(P.Earth.bark, '#ffffff', 0.12);
      return `${sky('#86a9cf', '#d8e2e6')}<defs>${grads}</defs>${ground('#6d7f4a')}<ellipse cx="104" cy="228" rx="58" ry="6" fill="#000000" fill-opacity="0.25"/><path d="${trunkPath}" fill="${bark}"/><path d="M106 120 L114 118 C108 160 116 196 116 230 L108 230 C106 196 102 160 106 120 Z" fill="${mix(P.Earth.bark, '#000000', 0.35)}"/>${TREE.masses.map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx * 0.92}" ry="${ry * 0.9}" fill="${r[1]}"/>`).join('')}${clumps}`;
    },
  },
  {
    name: 'Beyond', note: 'Modern HD + warm rim light, haze, falling leaves, life',
    res: 0,
    svg: () => {
      const base = GENERATIONS[4].svg().replace(sky('#86a9cf', '#d8e2e6'), sky('#e8b98a', '#f6dcc0'));
      // warm light from the low sun on the upper left of each mass
      const rim = `<defs><radialGradient id="sun" cx="0.25" cy="0.2" r="0.75"><stop offset="0" stop-color="#ffc27a" stop-opacity="0.55"/><stop offset="1" stop-color="#ffc27a" stop-opacity="0"/></radialGradient></defs>${TREE.masses.map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx * 1.02}" ry="${ry}" fill="url(#sun)"/>`).join('')}`;
      const leaves = [[40, 170], [150, 182], [170, 150], [60, 204]].map(([x, y], i) => `<ellipse cx="${x}" cy="${y}" rx="4" ry="2" transform="rotate(${i * 50} ${x} ${y})" fill="${P['Warm amber'].amber}"/>`).join('');
      const flowers = [[60, 226], [70, 228], [144, 227], [156, 229]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="3" fill="${i % 2 ? P['Gentle lavender'].lavenderPale : P['Warm amber'].honey}"/>`).join('');
      return `${base}${rim}<rect width="200" height="240" fill="url(#haze)"/><defs><linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stop-color="#ffd9a0" stop-opacity="0"/><stop offset="1" stop-color="#ffd9a0" stop-opacity="0.18"/></linearGradient></defs>${leaves}${flowers}`;
    },
  },
];

async function treeSheet() {
  const T = 300, H = 360, gap = 14, W = GENERATIONS.length * (T + gap) + gap;
  const comp = [];
  for (const [i, g] of GENERATIONS.entries()) {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="240" viewBox="0 0 200 240">${g.svg()}</svg>`);
    let img;
    if (g.res) {
      const h = Math.round((g.res * 240) / 200);
      let small = sharp(svg, { density: 72 }).resize(g.res, h);
      small = g.colours ? sharp(await small.png({ palette: true, colours: g.colours, dither: 0 }).toBuffer()) : small;
      img = await small.resize(T, H, { kernel: g.colours ? 'nearest' : 'linear' }).png().toBuffer();
    } else img = await sharp(svg, { density: 216 }).resize(T, H).png().toBuffer();
    comp.push({ input: img, left: gap + i * (T + gap), top: 56 });
    comp.push({
      input: Buffer.from(`<svg width="${T}" height="60"><text x="0" y="22" font-family="Helvetica" font-weight="bold" font-size="18" fill="#f1ead9">${g.name}</text><text x="0" y="44" font-family="Helvetica" font-size="12" fill="#b8b2a4">${g.note}</text></svg>`),
      left: gap + i * (T + gap),
      top: 56 + H + 6,
    });
  }
  comp.push({ input: Buffer.from(`<svg width="${W}" height="50"><text x="${gap}" y="34" font-family="Helvetica" font-weight="bold" font-size="22" fill="#f6f0e2">The meadow tree, drawn by each generation · same silhouette, more information each time (diagram, not game art)</text></svg>`), left: 0, top: 0 });
  await sharp({ create: { width: W, height: 56 + H + 72, channels: 3, background: '#14161c' } }).composite(comp).png().toFile(`${OUT}/tree-generations.png`);
}

await sharp(Buffer.from(paletteSvg())).png().toFile(`${OUT}/palette.png`);
await sharp(Buffer.from(silhouettesSvg())).png().toFile(`${OUT}/silhouettes.png`);
await treeSheet();
console.log(`wrote ${OUT}/palette.png, silhouettes.png, tree-generations.png`);
