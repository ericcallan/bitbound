import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

/**
 * The real sky for the modern generations (Poly Haven "Kloofendal 48d partly cloudy", CC0), prepared by
 * scripts/blender/create_sky.py: a small HDR for image-based lighting, a tone-mapped panorama for the
 * visible sky, and the sun direction measured from the HDR so the key light and shadows match.
 */
export interface HdSkyData {
  env: THREE.Texture;
  background: THREE.Texture;
  sunDir: THREE.Vector3;
}

const cache = new WeakMap<THREE.WebGLRenderer, Promise<HdSkyData>>();

export function loadHdSky(gl: THREE.WebGLRenderer): Promise<HdSkyData> {
  let p = cache.get(gl);
  if (p) return p;
  const base = `${import.meta.env.BASE_URL}assets/sky/day`;
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
    return { env, background: bg, sunDir: new THREE.Vector3(...sun.dir).normalize() };
  });
  cache.set(gl, p);
  return p;
}
