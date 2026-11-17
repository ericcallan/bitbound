/**
 * Encode the scanned colour textures (albedo + roughness) to KTX2 / Basis ETC1S with full mip chains, so the GPU
 * keeps them compressed. The runtime (src/game/render/textures.ts) transcodes them to the GPU's native format
 * (ASTC on Apple, BC7 / ETC2 elsewhere) at about a quarter of the memory of RGBA8, and falls back to the WebP
 * files if it can't. Normal + height maps stay WebP: UASTC encodes them at ~1.1 MB each (vs ~0.5 MB WebP),
 * which the download budget can't absorb, and ETC1S is too lossy for normals.
 *
 * Needs KTX-Software (unpacked, not installed, in tools/ktx; see docs/ASSETS.md).
 *   node scripts/textures/ktx2.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const KTX = path.join(ROOT, 'tools', 'ktx', 'expanded', 'KTX-Software-4.4.2-Darwin-arm64-tools.pkg', 'Payload', 'usr', 'local', 'bin', 'ktx');
const DIR = path.join(ROOT, 'public', 'assets', 'textures');
const PACKED = path.join(ROOT, 'assets', 'source-textures', 'packed');
const albedos = fs.readdirSync(PACKED).filter((f) => f.endsWith('_albedo.webp'));
if (!fs.existsSync(KTX)) {
  // without KTX-Software the game ships the WebP colour textures instead (the runtime tries KTX2, then WebP)
  console.warn('ktx not found at', KTX, '— shipping WebP colour textures');
  for (const f of albedos) fs.copyFileSync(path.join(PACKED, f), path.join(DIR, f));
  process.exit(0);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-ktx-'));
const rows = [];
for (const file of albedos) {
  const name = file.replace('.webp', '');
  const png = path.join(tmp, `${name}.png`);
  await sharp(path.join(PACKED, file)).ensureAlpha().png().toFile(png);
  fs.rmSync(path.join(DIR, file), { force: true });
  const out = path.join(DIR, `${name}.ktx2`);
  const isColor = name.endsWith('_albedo');
  const args = isColor
    ? ['create', '--format', 'R8G8B8A8_SRGB', '--assign-tf', 'srgb', '--encode', 'basis-lz', '--clevel', '4', '--qlevel', '200', '--generate-mipmap', png, out]
    : ['create', '--format', 'R8G8B8A8_UNORM', '--assign-tf', 'linear', '--encode', 'uastc', '--uastc-quality', '2', '--uastc-rdo', '--uastc-rdo-l', '3', '--zstd', '20', '--generate-mipmap', png, out];
  execFileSync(KTX, args, { stdio: 'inherit' });
  rows.push({ name, webpKB: Math.round(fs.statSync(path.join(PACKED, file)).size / 1024), ktx2KB: Math.round(fs.statSync(out).size / 1024), codec: isColor ? 'ETC1S' : 'UASTC+zstd' });
}
fs.rmSync(tmp, { recursive: true, force: true });
console.table(rows);
