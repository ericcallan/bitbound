/**
 * Validate shipped assets (public/assets/*.glb) against PIP's conventions and budgets:
 * expected nodes and animations exist, origin at the base (min Y ≈ 0), sane scale, triangle and
 * file-size budgets, only extensions the runtime loader supports, texture sizes within budget.
 *
 *   node scripts/validate-assets.mjs        (exit code 1 on any failure)
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/core';
import { MeshoptDecoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = path.join(ROOT, 'public', 'assets');

/** What each asset must contain. Heights are in world units (Pip is 0.9). */
const SPEC = {
  rocks: { nodes: ['rock_a', 'rock_b', 'rock_c'], maxTris: 4000, maxKB: 800, height: [0.3, 1.6] },
  pip: {
    nodes: ['pip_body', 'pip_rig'],
    animations: ['idle', 'walk', 'run', 'jump_start', 'jump_up', 'fall', 'land', 'brake', 'celebrate', 'surprise', 'shift'],
    maxTris: 40000,
    maxKB: 3000,
    height: [0.8, 1.05],
  },
  tree: { nodes: ['great_tree'], maxTris: 120000, maxKB: 4000, height: [5, 16] },
  gateway: { nodes: ['shard_arch'], maxTris: 30000, maxKB: 2500, height: [2, 6] },
  terrain: { nodes: ['valley_terrain'], maxTris: 250000, maxKB: 9000, height: [3, 80] },
};
/** Extensions src/game/render/assets.ts can load. */
const SUPPORTED = new Set(['KHR_mesh_quantization', 'EXT_meshopt_compression', 'EXT_texture_webp', 'KHR_materials_emissive_strength', 'KHR_texture_transform', 'KHR_materials_transmission', 'KHR_materials_ior', 'KHR_materials_clearcoat', 'KHR_materials_specular']);
const MAX_TEX = 2048;

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
let failed = 0;
const rows = [];
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.glb'))) {
  const name = f.replace('.glb', '');
  const spec = SPEC[name];
  const errs = [];
  const doc = await io.read(path.join(DIR, f));
  const root = doc.getRoot();
  const kb = fs.statSync(path.join(DIR, f)).size / 1024;
  let tris = 0;
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      tris += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  for (const ext of root.listExtensionsUsed()) if (!SUPPORTED.has(ext.extensionName)) errs.push(`unsupported extension ${ext.extensionName}`);
  for (const tex of root.listTextures()) {
    const s = tex.getSize();
    if (s && Math.max(...s) > MAX_TEX) errs.push(`texture ${tex.getName()} ${s.join('x')} > ${MAX_TEX}`);
  }
  const scene = root.listScenes()[0];
  const b = getBounds(scene);
  const h = b.max[1] - b.min[1];
  if (spec) {
    const names = new Set(root.listNodes().map((n) => n.getName()));
    for (const n of spec.nodes) if (!names.has(n)) errs.push(`missing node ${n}`);
    const anims = new Set(root.listAnimations().map((a) => a.getName()));
    for (const a of spec.animations ?? []) if (!anims.has(a)) errs.push(`missing animation ${a}`);
    if (tris > spec.maxTris) errs.push(`${tris} tris > ${spec.maxTris}`);
    if (kb > spec.maxKB) errs.push(`${kb.toFixed(0)} KB > ${spec.maxKB} KB`);
    if (Math.abs(b.min[1]) > 0.05 && name !== 'terrain') errs.push(`origin not at base: min y ${b.min[1].toFixed(3)}`);
    if (name !== 'rocks' && (h < spec.height[0] || h > spec.height[1])) errs.push(`height ${h.toFixed(2)} outside ${spec.height}`);
  } else errs.push('no spec (add one to scripts/validate-assets.mjs)');
  failed += errs.length ? 1 : 0;
  rows.push({ asset: name, KB: Math.round(kb), tris: Math.round(tris), height: +h.toFixed(2), meshes: root.listMeshes().length, materials: root.listMaterials().length, textures: root.listTextures().length, animations: root.listAnimations().length, result: errs.length ? errs.join('; ') : 'ok' });
}
console.table(rows);
process.exit(failed ? 1 : 0);
