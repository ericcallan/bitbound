import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

/**
 * The real skies for the modern generations (Poly Haven, CC0), prepared by scripts/blender/create_sky.py: a
 * small HDR for image-based lighting, a tone-mapped panorama for the visible sky, and the sun direction
 * measured from the HDR so the key light and shadows match.
 *  - `day` (Kloofendal 48d partly cloudy): Modern HD, late-afternoon daylight.
 *  - `golden` (Kloppenheim 06): Beyond, a low sun in the west (rotated there, see SKIES).
 */
export interface HdSkyData {
  env: THREE.Texture;
  background: THREE.Texture;
  /** Direction toward the visible sun, after rotation. */
  sunDir: THREE.Vector3;
  /** Direction the key light comes from: the sun's azimuth, lifted to a usable elevation. */
  keyDir: THREE.Vector3;
  /** Yaw applied to both the environment lighting and the background. */
  rotation: THREE.Euler;
}

export type SkyName = 'day' | 'golden';

const SKIES: Record<SkyName, { azimuth: number | null; minElevationDeg: number }> = {
  // As photographed: sun high, in front of the lane and to the right.
  day: { azimuth: null, minElevationDeg: 0 },
  // Turned so the low sun sits in the west (left of the path), slightly behind: trees throw long shadows
  // across the path, the valley wall only shades the forest band, and light shafts show looking west.
  // Light from 4.7° would graze everything, so the key is lifted.
  golden: { azimuth: Math.atan2(-0.26, -0.97), minElevationDeg: 18 },
};

const cache = new WeakMap<THREE.WebGLRenderer, Map<SkyName, Promise<HdSkyData>>>();

export function loadHdSky(gl: THREE.WebGLRenderer, name: SkyName = 'day'): Promise<HdSkyData> {
  let per = cache.get(gl);
  if (!per) cache.set(gl, (per = new Map()));
  let p = per.get(name);
  if (p) return p;
  const base = `${import.meta.env.BASE_URL}assets/sky/${name}`;
  p = Promise.all([
    new HDRLoader().loadAsync(`${base}_env.hdr`),
    new THREE.TextureLoader().loadAsync(`${base}_sky.jpg`),
    fetch(`${base}.json`).then((r) => r.json() as Promise<{ dir: [number, number, number] }>),
  ]).then(([hdr, bg, sun]) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromEquirectangular(hdr).texture;
    pmrem.dispose();
    hdr.dispose();
    bg.mapping = THREE.EquirectangularReflectionMapping;
    bg.colorSpace = THREE.SRGBColorSpace;
    const raw = new THREE.Vector3(...sun.dir).normalize();
    const cfg = SKIES[name];
    // Yaw that carries the photographed sun to the wanted azimuth. The env lookup is rotated by `rotation`,
    // so the visible sun moves by its inverse.
    const yaw = cfg.azimuth === null ? 0 : Math.atan2(raw.z, raw.x) - cfg.azimuth;
    const rotation = new THREE.Euler(0, -yaw, 0);
    const sunDir = raw.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const el = Math.max(Math.asin(sunDir.y), THREE.MathUtils.degToRad(cfg.minElevationDeg));
    const flat = Math.hypot(sunDir.x, sunDir.z) || 1;
    const keyDir = new THREE.Vector3((sunDir.x / flat) * Math.cos(el), Math.sin(el), (sunDir.z / flat) * Math.cos(el));
    return { env, background: bg, sunDir, keyDir, rotation };
  });
  per.set(name, p);
  return p;
}
