import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { patchEraMaterial, type EraMatOptions } from './eraMaterial';
import { BARK_SWAY, CLUMP_WIND, LEAF_WIND } from './wind';

/**
 * Loads the optimised Blender assets in public/assets (Meshopt geometry, WebP textures), once each.
 * Every loaded material is taught the generation rules so assets join ripples, rifts and bubbles.
 */
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<GLTF>>();
const loaded = new Map<string, GLTF>();
const listeners = new Set<() => void>();

export type AssetName = 'rocks' | 'pip' | 'tree' | 'gateway' | 'vegetation' | 'terrain';

/** Assets fetched as soon as the game starts. */
export const PRELOAD: AssetName[] = ['rocks', 'pip', 'terrain', 'tree', 'gateway', 'vegetation'];

/**
 * Per-material set-up by name (material names come from the Blender scripts). Scattered vegetation only
 * exists from Modern HD up (`minEra: 4`); slot-placed assets are swapped per generation by the view.
 */
const texLoader = new THREE.TextureLoader();
const textures = new Map<string, THREE.Texture>();
function sharedTexture(name: string, srgb: boolean) {
  let t = textures.get(name);
  if (!t) {
    t = texLoader.load(`${import.meta.env.BASE_URL}assets/textures/${name}.webp`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    textures.set(name, t);
  }
  return t;
}

/**
 * Beyond: moss creeping over the upward faces of the ancient stone (scanned moss, broken up by noise), so
 * the ruins look weathered into the valley rather than placed on it.
 */
function mossyStone(m: THREE.MeshStandardMaterial) {
  const moss = sharedTexture('moss_albedo', true);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.tMoss = { value: moss };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tMoss;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (eraF > 4.5) {
          vec3 gn = normalize(cross(dFdx(vEraWorld), dFdy(vEraWorld)));
          float top = smoothstep(0.45, 0.85, abs(gn.y));
          float patches = smoothstep(0.42, 0.62, fbm(vEraWorld * 1.4)) * top + smoothstep(0.7, 0.85, fbm(vEraWorld * 2.3)) * 0.35;
          vec3 mossCol = texture2D(tMoss, vEraWorld.xz / 1.6).rgb * vec3(0.75, 1.0, 0.62);
          diffuseColor.rgb = mix(diffuseColor.rgb, mossCol, clamp(patches, 0.0, 1.0) * 0.85);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'mossy-stone-v1';
}

/** Beyond: light flows along the teal glyph inlays instead of a steady glow. */
function flowingGlyph(m: THREE.MeshStandardMaterial) {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      if (eraF > 4.5) {
        float marks = step(0.45, fract((vEraWorld.x + vEraWorld.z) * 5.0 + floor(vEraWorld.y * 9.0) * 0.37));
        float flow = pow(0.5 + 0.5 * sin(uTime * 2.2 - (vEraWorld.x + vEraWorld.y * 0.5) * 2.5), 3.0);
        totalEmissiveRadiance *= 0.35 + marks * (0.4 + flow * 1.8);
      }`,
    );
  };
  m.customProgramCacheKey = () => 'flowing-glyph-v1';
}

function materialRules(m: THREE.MeshStandardMaterial): Partial<EraMatOptions> {
  const n = m.name;
  if (n.startsWith('ancient_glyph')) {
    flowingGlyph(m);
    return {};
  }
  if (n === 'shard_arch_mat' || n === 'ruin_column_mat' || /^block_.*_mat$/.test(n)) {
    mossyStone(m);
    return {};
  }
  if (n === 'tree_leaves') {
    m.alphaTest = 0.5;
    // Exported as alpha-blended, which makes the loader turn depth writes off; as an opaque cut-out the
    // leaves must write depth, or anything drawn later behind them paints over the canopy.
    m.transparent = false;
    m.depthWrite = true;
    m.blending = THREE.NormalBlending;
    // Leaves are matte: no mirror-like sky reflections on each card.
    m.roughness = 0.88;
    m.envMapIntensity = 0.45;
    m.side = THREE.DoubleSide;
    m.shadowSide = THREE.DoubleSide;
    // Foliage cut-outs thin to nothing on distant mip levels (averaged alpha falls under the cutoff).
    // Boost coverage with mip level, then sharpen the edge by its screen-space derivative.
    // Derivatives must be taken before any discard (the era patch may discard later, and derivatives
    // after a discard are undefined on Metal), so the sharpened alpha is computed right after sampling.
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nfloat leafAlpha = 1.0;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          #ifdef USE_MAP
            vec2 texel = vMapUv * vec2(textureSize(map, 0));
            float mip = max(0.0, 0.5 * log2(max(dot(dFdx(texel), dFdx(texel)), dot(dFdy(texel), dFdy(texel)))));
            float a = diffuseColor.a * (1.0 + mip * 0.28);
            leafAlpha = (a - 0.5) / max(fwidth(a), 1e-4) + 0.5;
          #endif`,
        )
        .replace('#include <alphatest_fragment>', 'if (leafAlpha < 0.5) discard;\ndiffuseColor.a = 1.0;');
    };
    m.customProgramCacheKey = () => 'leaf-coverage-v2';
    return { vertexWorld: LEAF_WIND, minEra: 4, vertexEra: true };
  }
  if (n.endsWith('_bark')) {
    m.envMapIntensity = 0.6;
    return { vertexWorld: BARK_SWAY, minEra: 4, vertexEra: true };
  }
  if (/^rock_[abc]_mat$/.test(n)) return { minEra: 4, vertexEra: true };
  if (n === 'vegetation_vc') {
    m.vertexColors = true;
    m.side = THREE.DoubleSide;
    m.roughness = 0.85;
    m.envMapIntensity = 0.5;
    return { vertexWorld: CLUMP_WIND, minEra: 4, vertexEra: true };
  }
  return {};
}

export const assetUrl = (name: AssetName) => `${import.meta.env.BASE_URL}assets/${name}.glb`;

/** Materials are shared between meshes: patch each one exactly once. */
const patched = new WeakSet<THREE.Material>();

function prepare(gltf: GLTF) {
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial && !patched.has(m)) {
        patched.add(m);
        const sm = m as THREE.MeshStandardMaterial;
        // Baked textures carry the detail; keep shading physically plausible.
        sm.envMapIntensity = 1;
        patchEraMaterial(sm, materialRules(sm));
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
  // Nodes are exported at the origin; any transform left on the node is quantization scale/offset
  // and must be kept (resetting it would shrink the model).
  return copy;
}

const beyondCopies = new WeakMap<THREE.Material, THREE.Material>();
/**
 * The same ground-cover material, but existing only in Beyond (litter, extra plants): the richest generation
 * gets the most ground detail.
 */
export function beyondOnly(m: THREE.Material): THREE.Material {
  let c = beyondCopies.get(m);
  if (!c) {
    const src = m as THREE.MeshStandardMaterial;
    const copy = new THREE.MeshStandardMaterial();
    copy.copy(src);
    copy.onBeforeCompile = () => {};
    copy.customProgramCacheKey = () => '';
    c = patchEraMaterial(copy, { vertexWorld: CLUMP_WIND, minEra: 5, vertexEra: true });
    beyondCopies.set(m, c);
  }
  return c;
}

/** Load progress for the preload bar: fraction of PRELOAD assets ready. */
export function preloadProgress() {
  return PRELOAD.filter((n) => loaded.has(n)).length / PRELOAD.length;
}

export function preloadAssets() {
  return Promise.allSettled(PRELOAD.map(loadAsset));
}
