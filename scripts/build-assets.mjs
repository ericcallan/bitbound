/**
 * The whole asset pipeline, reproducibly: run each Blender script headless, then optimise and validate.
 *
 *   npm run assets:build              all assets
 *   npm run assets:build -- rocks     one asset (script scripts/blender/create_<name>.py)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BLENDER = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender';
const ORDER = ['rocks', 'pip', 'tree', 'gateway', 'aqueduct', 'vegetation', 'props', 'terrain'];
const only = process.argv.slice(2);
const names = (only.length ? only : ORDER).filter((n) => fs.existsSync(path.join(ROOT, 'scripts', 'blender', `create_${n}.py`)));
if (!fs.existsSync(BLENDER)) {
  console.error(`Blender not found at ${BLENDER}; set BLENDER=/path/to/blender`);
  process.exit(1);
}
for (const n of names) {
  const t = Date.now();
  if (n === 'tree') execFileSync('node', [path.join(ROOT, 'scripts', 'textures', 'leaf-atlas.mjs')], { stdio: 'inherit', cwd: ROOT });
  if (n === 'gateway' || n === 'aqueduct') execFileSync('npx', ['vite-node', path.join(ROOT, 'scripts', 'terrain', 'export-props.ts')], { stdio: 'inherit', cwd: ROOT });
  if (n === 'terrain') {
    // The terrain mesh is built from the game's own height field, and shaded with packed scanned textures.
    execFileSync('npx', ['vite-node', path.join(ROOT, 'scripts', 'terrain', 'export-valley.ts')], { stdio: 'inherit', cwd: ROOT });
    execFileSync('node', [path.join(ROOT, 'scripts', 'build-terrain-textures.mjs')], { stdio: 'inherit', cwd: ROOT });
    execFileSync('node', [path.join(ROOT, 'scripts', 'textures', 'ktx2.mjs')], { stdio: 'inherit', cwd: ROOT });
  }
  console.log(`\n▶ blender create_${n}.py`);
  const out = execFileSync(BLENDER, ['-b', '-P', path.join(ROOT, 'scripts', 'blender', `create_${n}.py`)], { encoding: 'utf8', maxBuffer: 64 << 20 });
  for (const line of out.split('\n')) if (line.startsWith('[pip-assets]') || /Error|Traceback/.test(line)) console.log('  ' + line);
  if (!out.includes('[pip-assets] OK')) {
    console.error(`create_${n}.py did not finish`);
    process.exit(1);
  }
  console.log(`  ${((Date.now() - t) / 1000).toFixed(1)}s`);
}
execFileSync('node', [path.join(ROOT, 'scripts', 'optimize-assets.mjs'), ...names], { stdio: 'inherit' });
execFileSync('node', [path.join(ROOT, 'scripts', 'validate-assets.mjs')], { stdio: 'inherit' });
