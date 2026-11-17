import * as THREE from 'three';
import { getAsset, loadAsset } from './assets';
import { eraMaterial, eraUniforms, patchEraMaterial, PATTERN } from './eraMaterial';
import { VALLEY, VALLEY_COLLIDE, WATER_Y } from '../level/valley';

const texLoader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();
function tex(name: string, srgb: boolean) {
  let t = texCache.get(name);
  if (!t) {
    t = texLoader.load(`${import.meta.env.BASE_URL}assets/textures/${name}.webp`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texCache.set(name, t);
  }
  return t;
}

const SETS = ['grass', 'rock', 'path', 'forest'] as const;

/**
 * The splat terrain material: four scanned materials (grass, rock, worn path, forest floor) blended by
 * the per-vertex weights baked in Blender, with height-aware transitions, a second large-scale sample
 * to hide tiling, triplanar rock on cliffs, and Blender-baked ambient occlusion on indirect light.
 */
export function terrainMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const uniforms: Record<string, THREE.IUniform> = {};
  for (const s of SETS) {
    uniforms[`t_${s}A`] = { value: tex(`${s}_albedo`, true) };
    uniforms[`t_${s}N`] = { value: tex(`${s}_normal`, false) };
  }
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 color;
        varying vec4 vSplat;
        varying vec3 vTerrW;
        varying vec3 vTerrN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSplat = color;
        vTerrW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTerrN = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${SETS.map((s) => `uniform sampler2D t_${s}A; uniform sampler2D t_${s}N;`).join('\n')}
        varying vec4 vSplat;
        varying vec3 vTerrW;
        varying vec3 vTerrN;
        float terrRough;
        vec3 terrNormalW;
        // top-down sample with a second, much larger sample mixed in to hide repetition
        vec4 topA(sampler2D t, float s) {
          vec4 a = texture2D(t, vTerrW.xz / s);
          vec4 b = texture2D(t, vTerrW.xz / (s * 5.7) + 0.37);
          return mix(a, b, 0.32);
        }
        vec3 topN(sampler2D t, float s) { return texture2D(t, vTerrW.xz / s).xyz * 2.0 - 1.0; }
        vec3 triW(vec3 n) { vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x + w.y + w.z); }
        vec4 triA(sampler2D t, float s, vec3 w) {
          return texture2D(t, vTerrW.zy / s) * w.x + texture2D(t, vTerrW.xz / s) * w.y + texture2D(t, vTerrW.xy / s) * w.z;
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `vec3 wn = normalize(vTerrN);
        vec3 tw = triW(wn);
        vec4 aG = topA(t_grassA, 3.5);
        vec4 aP = topA(t_pathA, 3.0);
        vec4 aF = topA(t_forestA, 4.0);
        vec4 aR = triA(t_rockA, 6.0, tw);
        float wR = vSplat.r, wP = vSplat.g, wF = vSplat.b;
        float wG = max(0.0, 1.0 - wR - wP - wF);
        // height-aware blend: brighter (taller) texels win near transitions
        vec4 W = vec4(wG, wR, wP, wF) * pow(vec4(dot(aG.rgb, vec3(0.33)), dot(aR.rgb, vec3(0.33)), dot(aP.rgb, vec3(0.33)), dot(aF.rgb, vec3(0.33))) + 0.35, vec4(3.0));
        W /= max(1e-4, W.x + W.y + W.z + W.w);
        vec4 A = aG * W.x + aR * W.y + aP * W.z + aF * W.w;
        // the scanned grass reads khaki: push it toward a living meadow green, with gentle patchiness
        float patchy = texture2D(t_grassA, vTerrW.xz / 61.0).g;
        A.rgb *= mix(vec3(1.0), mix(vec3(0.62, 1.12, 0.42), vec3(0.78, 1.08, 0.5), patchy), W.x);
        A.rgb *= mix(vec3(1.0), vec3(0.85, 0.95, 0.72), W.w);
        diffuseColor.rgb = A.rgb;
        terrRough = clamp(A.a, 0.35, 1.0);
        vec3 nG = topN(t_grassN, 3.5), nP = topN(t_pathN, 3.0), nF = topN(t_forestN, 4.0);
        vec3 nRx = texture2D(t_rockN, vTerrW.zy / 6.0).xyz * 2.0 - 1.0;
        vec3 nRy = texture2D(t_rockN, vTerrW.xz / 6.0).xyz * 2.0 - 1.0;
        vec3 nRz = texture2D(t_rockN, vTerrW.xy / 6.0).xyz * 2.0 - 1.0;
        // whiteout-style perturbation of the geometric world normal
        vec3 pTop = (nG * W.x + nP * W.z + nF * W.w);
        vec3 pert = vec3(pTop.x, 0.0, pTop.y) * 0.9;
        pert += (vec3(0.0, nRx.y, nRx.x) * tw.x + vec3(nRy.x, 0.0, nRy.y) * tw.y + vec3(nRz.x, nRz.y, 0.0) * tw.z) * W.y * 1.2;
        terrNormalW = normalize(wn + pert);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = terrRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(terrNormalW, 0.0)).xyz);')
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        float tao = vSplat.a;
        reflectedLight.indirectDiffuse *= mix(0.3, 1.0, tao);
        reflectedLight.indirectSpecular *= mix(0.2, 1.0, tao);
        reflectedLight.directDiffuse *= mix(0.75, 1.0, tao);`,
      );
  };
  m.customProgramCacheKey = () => 'terrain-splat-v1';
  return patchEraMaterial(m, { only3dGenerations: true });
}

/**
 * The valley, from the Blender terrain asset, plus its river. Hidden in the retro generations (which
 * are pixel art); once loaded it takes over from the old box ground inside the valley slice.
 */
export class TerrainView {
  group = new THREE.Group();
  ready = false;
  private water: THREE.Mesh;

  constructor() {
    const w = VALLEY.x1 - VALLEY.x0;
    const d = VALLEY.z1 - VALLEY.z0;
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(VALLEY_COLLIDE.x1 + 12 - VALLEY.x0, d, 64, 48),
      eraMaterial({ color: '#2a6a8a', roughness: 0.05, metalness: 0, pattern: PATTERN.water, transparent: true, opacity: 0.88, only3dGenerations: true }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set((VALLEY.x0 + VALLEY_COLLIDE.x1 + 12) / 2, WATER_Y, (VALLEY.z0 + VALLEY.z1) / 2);
    this.water.receiveShadow = true;
    this.group.add(this.water);
    void w;
    if (getAsset('terrain')) this.build();
    else void loadAsset('terrain').then(() => this.build());
  }

  private build() {
    if (this.ready) return;
    const g = getAsset('terrain');
    const mesh = g?.scene.getObjectByName('valley_terrain') as THREE.Mesh | undefined;
    if (!mesh) return;
    const t = mesh.clone();
    t.material = terrainMaterial();
    t.castShadow = false;
    t.receiveShadow = true;
    t.frustumCulled = false;
    this.group.add(t);
    this.ready = true;
  }

  /** Called every frame by the active view: the terrain owns the slice once it has loaded. */
  update() {
    eraUniforms.uValleyX.value = this.ready ? VALLEY_COLLIDE.x1 : -1e9;
  }

  dispose() {}
}
