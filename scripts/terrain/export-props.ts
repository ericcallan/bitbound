/**
 * Export the exact sizes of the solid blocks inside the valley slice (steps, floating slab, plinth) so
 * Blender can build weathered stone at precisely the collider dimensions.
 *   npx vite-node scripts/terrain/export-props.ts → assets/source-textures/slice_blocks.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { LEVEL } from '../../src/game/level/meadows';
import { VALLEY_COLLIDE } from '../../src/game/level/valley';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const BLOCKS = ['step1', 'step2', 'float1', 'plinth'];
const out = LEVEL.solids
  .filter((s) => BLOCKS.includes(s.id) && s.box.max.x <= VALLEY_COLLIDE.x1)
  .map((s) => ({ id: s.id, min: s.box.min, max: s.box.max }));
const file = path.join(ROOT, 'assets', 'source-textures', 'slice_blocks.json');
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`${out.length} blocks → ${path.relative(ROOT, file)}`);
