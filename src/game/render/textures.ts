import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { track, trackBytes, trackDone, trackStart } from './loadProgress';

/**
 * The scanned material textures (public/assets/textures). Colour maps ship as KTX2 / Basis ETC1S and stay
 * compressed on the GPU (transcoded to ASTC, BC7 or ETC2, whichever the device has); normal + height maps are
 * WebP. If a KTX2 file can't be used, its WebP version is tried instead.
 *
 * Materials get a shared uniform holder ({ value }) at once; the texture arrives in it when loaded.
 */
const base = import.meta.env.BASE_URL;
let ktx2: KTX2Loader | null = null;
const pending: (() => void)[] = [];
const holders = new Map<string, { value: THREE.Texture }>();

const placeholder = (() => {
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();
const flatNormal = (() => {
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 255, 128]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

/** Call once with the renderer (the KTX2 transcoder needs to know which formats the GPU supports). */
export function initTextures(gl: THREE.WebGLRenderer) {
  if (ktx2) return;
  ktx2 = new KTX2Loader().setTranscoderPath(`${base}basis/`).detectSupport(gl);
  for (const f of pending.splice(0)) f();
}

function configure(t: THREE.Texture, srgb: boolean) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * An image as a texture, with the standard loader. (Off-thread decoding, createImageBitmap or decode() before
 * upload, was tried and measured: the textures it produced cost noticeably more GPU time per frame in Beyond, so
 * it isn't used. The warm-up uploads every texture behind the loader, so decoding never lands in play.)
 */
export function loadImageTexture(url: string): Promise<THREE.Texture> {
  return new THREE.TextureLoader().loadAsync(url);
}

function loadWebp(name: string, srgb: boolean, holder: { value: THREE.Texture }) {
  const url = `${base}assets/textures/${name}.webp`;
  void track(url, loadImageTexture(url), 500_000).then((t) => (holder.value = configure(t, srgb)));
}

/** A shared uniform holding the named texture (e.g. 'grass_albedo', 'rock_normal') once it has loaded. */
export function textureUniform(name: string): { value: THREE.Texture } {
  let h = holders.get(name);
  if (h) return h;
  const srgb = name.endsWith('_albedo');
  const holder: { value: THREE.Texture } = { value: srgb ? placeholder : flatNormal };
  holders.set(name, holder);
  h = holder;
  if (!srgb) {
    loadWebp(name, false, holder);
    return holder;
  }
  const url = `${base}assets/textures/${name}.ktx2`;
  const go = () => {
    trackStart(url, 250_000);
    ktx2!.load(
      url,
      (t) => (trackDone(url), (holder.value = configure(t, true))),
      (e) => e.lengthComputable && trackBytes(url, e.loaded, e.total),
      () => (trackDone(url), loadWebp(name, true, holder)),
    );
  };
  if (ktx2) go();
  else pending.push(go);
  return holder;
}

/** GPU memory of the loaded material textures (bytes, with mips), for the performance report. */
export function textureMemory() {
  let bytes = 0;
  for (const h of holders.values()) {
    const t = h.value as THREE.Texture & { mipmaps?: { data: ArrayBufferView }[]; image: { width: number; height: number } };
    if (t.mipmaps?.length && (t as THREE.CompressedTexture).isCompressedTexture) {
      for (const m of t.mipmaps) bytes += m.data.byteLength;
    } else if (t.image?.width) {
      bytes += t.image.width * t.image.height * 4 * (4 / 3);
    }
  }
  return bytes;
}
