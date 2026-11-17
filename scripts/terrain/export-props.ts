/**
 * Export the exact sizes of the solids rebuilt as stone (STONE_BLOCKS in level/meadows.ts) so
 * Blender can build weathered stone at precisely the collider dimensions.
 *   npx vite-node scripts/terrain/export-props.ts → assets/source-textures/slice_blocks.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { LEVEL, STONE_BLOCKS } from '../../src/game/level/meadows';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const out = LEVEL.solids
  .filter((s) => STONE_BLOCKS.includes(s.id))
  .map((s) => ({ id: s.id, min: s.box.min, max: s.box.max }));
const file = path.join(ROOT, 'assets', 'source-textures', 'slice_blocks.json');
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`${out.length} blocks → ${path.relative(ROOT, file)}`);
