import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { patchEraMaterial } from './eraMaterial';

/**
 * Loads the optimised Blender assets in public/assets (Meshopt geometry, WebP textures), once each.
 * Every loaded material is taught the generation rules so assets join ripples, rifts and bubbles.
 */
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<GLTF>>();
const loaded = new Map<string, GLTF>();
const listeners = new Set<() => void>();

export type AssetName = 'rocks' | 'pip' | 'tree' | 'gateway' | 'terrain';

/** Assets fetched as soon as the game starts (small, needed early). */
export const PRELOAD: AssetName[] = ['rocks'];

export const assetUrl = (name: AssetName) => `${import.meta.env.BASE_URL}assets/${name}.glb`;

function prepare(gltf: GLTF) {
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        const sm = m as THREE.MeshStandardMaterial;
        // Baked textures carry the detail; keep shading physically plausible.
        sm.envMapIntensity = 1;
        patchEraMaterial(sm);
      }
    }
  });
}

export function loadAsset(name: AssetName): Promise<GLTF> {
  let p = cache.get(name);
  if (!p) {
    p = loader.loadAsync(assetUrl(name)).then((g) => {
      prepare(g);
      loaded.set(name, g);
      for (const l of listeners) l();
      return g;
    });
    cache.set(name, p);
  }
  return p;
}

export function getAsset(name: AssetName): GLTF | null {
  return loaded.get(name) ?? null;
}

/** Called whenever any asset finishes loading (views use it to swap placeholders out). */
export function onAssetLoaded(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A fresh copy of a named node (or the whole scene). Geometry and materials are shared. */
export function instanceOf(name: AssetName, node?: string): THREE.Object3D | null {
  const g = loaded.get(name);
  if (!g) return null;
  const src = node ? g.scene.getObjectByName(node) : g.scene;
  if (!src) return null;
  let skinned = false;
  src.traverse((o) => (skinned ||= (o as THREE.SkinnedMesh).isSkinnedMesh === true));
  const copy = skinned ? cloneSkinned(src) : src.clone(true);
  copy.position.set(0, 0, 0);
  return copy;
}

/** Load progress for the preload bar: fraction of PRELOAD assets ready. */
export function preloadProgress() {
  return PRELOAD.filter((n) => loaded.has(n)).length / PRELOAD.length;
}

export function preloadAssets() {
  return Promise.allSettled(PRELOAD.map(loadAsset));
}
