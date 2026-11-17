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
        // Layers with no weight at a pixel are skipped entirely (rock is only on cliffs, path only on the
        // path...). Sampling inside those branches uses explicit gradients so mip selection stays correct.
        vec2 gXZx, gXZy, gZYx, gZYy, gXYx, gXYy;
        vec4 topA(sampler2D t, float s) {
          vec4 a = textureGrad(t, vTerrW.xz / s, gXZx / s, gXZy / s);
          float s2 = s * 5.7;
          vec4 b = textureGrad(t, vTerrW.xz / s2 + 0.37, gXZx / s2, gXZy / s2);
          return mix(a, b, 0.32);
        }
        vec3 topN(sampler2D t, float s) { return textureGrad(t, vTerrW.xz / s, gXZx / s, gXZy / s).xyz * 2.0 - 1.0; }
        vec3 triW(vec3 n) { vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x + w.y + w.z); }
        vec4 triA(sampler2D t, float s, vec3 w) {
          return textureGrad(t, vTerrW.zy / s, gZYx / s, gZYy / s) * w.x + textureGrad(t, vTerrW.xz / s, gXZx / s, gXZy / s) * w.y + textureGrad(t, vTerrW.xy / s, gXYx / s, gXYy / s) * w.z;
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `gXZx = dFdx(vTerrW.xz); gXZy = dFdy(vTerrW.xz);
        gZYx = dFdx(vTerrW.zy); gZYy = dFdy(vTerrW.zy);
        gXYx = dFdx(vTerrW.xy); gXYy = dFdy(vTerrW.xy);
        vec3 wn = normalize(vTerrN);
        vec3 tw = triW(wn);
        float wR = vSplat.r, wP = vSplat.g, wF = vSplat.b;
        float wG = max(0.0, 1.0 - wR - wP - wF);
        const float EPS = 0.004;
        vec4 aG = vec4(0.0), aR = vec4(0.0), aP = vec4(0.0), aF = vec4(0.0);
        if (wG > EPS) aG = topA(t_grassA, 3.5);
        if (wP > EPS) aP = topA(t_pathA, 3.0);
        if (wF > EPS) aF = topA(t_forestA, 4.0);
        if (wR > EPS) aR = triA(t_rockA, 6.0, tw);
        // height-aware blend: brighter (taller) texels win near transitions
        vec4 W = vec4(wG, wR, wP, wF) * step(EPS, vec4(wG, wR, wP, wF)) * pow(vec4(dot(aG.rgb, vec3(0.33)), dot(aR.rgb, vec3(0.33)), dot(aP.rgb, vec3(0.33)), dot(aF.rgb, vec3(0.33))) + 0.35, vec4(3.0));
        W /= max(1e-4, W.x + W.y + W.z + W.w);
        vec4 A = aG * W.x + aR * W.y + aP * W.z + aF * W.w;
        // the scanned grass reads khaki: push it toward a living meadow green, with gentle patchiness
        float patchy = textureGrad(t_grassA, vTerrW.xz / 61.0, gXZx / 61.0, gXZy / 61.0).g;
        A.rgb *= mix(vec3(1.0), mix(vec3(0.5, 0.82, 0.36), vec3(0.62, 0.86, 0.42), patchy), W.x);
        A.rgb *= mix(vec3(1.0), vec3(0.85, 0.95, 0.72), W.w);
        diffuseColor.rgb = A.rgb;
        terrRough = clamp(A.a, 0.35, 1.0);
        vec3 pTop = vec3(0.0);
        if (W.x > EPS) pTop += topN(t_grassN, 3.5) * W.x;
        if (W.z > EPS) pTop += topN(t_pathN, 3.0) * W.z;
        if (W.w > EPS) pTop += topN(t_forestN, 4.0) * W.w;
        // whiteout-style perturbation of the geometric world normal
        vec3 pert = vec3(pTop.x, 0.0, pTop.y) * 0.9;
        if (W.y > EPS) {
          vec3 nRx = textureGrad(t_rockN, vTerrW.zy / 6.0, gZYx / 6.0, gZYy / 6.0).xyz * 2.0 - 1.0;
          vec3 nRy = textureGrad(t_rockN, vTerrW.xz / 6.0, gXZx / 6.0, gXZy / 6.0).xyz * 2.0 - 1.0;
          vec3 nRz = textureGrad(t_rockN, vTerrW.xy / 6.0, gXYx / 6.0, gXYy / 6.0).xyz * 2.0 - 1.0;
          pert += (vec3(0.0, nRx.y, nRx.x) * tw.x + vec3(nRy.x, 0.0, nRy.y) * tw.y + vec3(nRz.x, nRz.y, 0.0) * tw.z) * W.y * 1.2;
        }
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
  m.customProgramCacheKey = () => 'terrain-splat-v2';
  return patchEraMaterial(m, { minEra: 2 });
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
      eraMaterial({ color: '#1e3f3a', roughness: 0.14, metalness: 0, pattern: PATTERN.water, transparent: true, opacity: 0.93, minEra: 2 }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set((VALLEY.x0 + VALLEY_COLLIDE.x1 + 12) / 2, WATER_Y, (VALLEY.z0 + VALLEY.z1) / 2);
    this.water.receiveShadow = true;
    // Deep, green-tinted river water: the sky shows as a soft sheen, not a blue mirror.
    (this.water.material as THREE.MeshStandardMaterial).envMapIntensity = 0.55;
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
