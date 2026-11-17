// The favicon: Pip's 8-bit head (the first rows of his sprite in src/game/render/sprites.ts) on a dark rounded
// tile, as a crisp SVG plus PNG fallbacks.  node scripts/textures/favicon.mjs
import fs from 'node:fs';
import sharp from 'sharp';

const HEAD = [
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
];
const PAL = { k: '#0d0b1e', o: '#f0862a', c: '#6ff6ff' };
const OX = 0;
const OY = 3;
let rects = '';
HEAD.forEach((row, y) =>
  [...row].forEach((ch, x) => {
    if (ch !== '.') rects += `<rect x="${x + OX}" y="${y + OY}" width="1" height="1" fill="${PAL[ch]}"/>`;
  }),
);
// the antenna tip glows
rects += `<rect x="7" y="2" width="2" height="1" fill="#6ff6ff"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><rect width="16" height="16" rx="3" fill="#1d3550"/>${rects}</svg>\n`;
fs.writeFileSync('public/favicon.svg', svg);
await sharp(Buffer.from(svg), { density: 600 }).resize(32, 32, { kernel: 'nearest' }).png().toFile('public/favicon-32.png');
await sharp(Buffer.from(svg), { density: 1200 }).resize(180, 180, { kernel: 'nearest' }).png().toFile('public/apple-touch-icon.png');
console.log('public/favicon.svg, favicon-32.png, apple-touch-icon.png');
