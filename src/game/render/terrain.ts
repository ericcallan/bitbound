import * as THREE from 'three';
import { getAsset, loadAsset } from './assets';
import { textureUniform } from './textures';
import { eraMaterial, eraUniforms, patchEraMaterial, PATTERN } from './eraMaterial';
import { VALLEY, VALLEY_COLLIDE, WATER_Y } from '../level/valley';


const SETS = ['grass', 'rock', 'path', 'forest'] as const;

/**
 * The splat terrain material: four scanned materials (grass, rock, worn path, forest floor) blended by
 * the per-vertex weights baked in Blender, with height-aware transitions, a second large-scale sample
 * to hide tiling, triplanar rock on cliffs, and Blender-baked ambient occlusion on indirect light.
 */
export function terrainMaterial(minEra = 2) {
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const uniforms: Record<string, THREE.IUniform> = {};
  for (const s of SETS) {
    uniforms[`t_${s}A`] = textureUniform(`${s}_albedo`);
    uniforms[`t_${s}N`] = textureUniform(`${s}_normal`);
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
        // forest-floor weight (the ground under the trees) and the generation here, for Beyond's dappled light
        float terrForest;
        float terrEra;
        // Layers with no weight at a pixel are skipped entirely (rock is only on cliffs, path only on the
        // path...). Sampling inside those branches uses explicit gradients so mip selection stays correct.
        vec2 gXZx, gXZy, gZYx, gZYy, gXYx, gXYy;
        // Top-down sampling position: the world xz, shifted by relief mapping in Beyond.
        vec2 tXZ;
        vec4 topA(sampler2D t, float s) {
          vec4 a = textureGrad(t, tXZ / s, gXZx / s, gXZy / s);
          float s2 = s * 5.7;
          vec4 b = textureGrad(t, tXZ / s2 + 0.37, gXZx / s2, gXZy / s2);
          return mix(a, b, 0.32);
        }
        vec3 topN(sampler2D t, float s) { return textureGrad(t, tXZ / s, gXZx / s, gXZy / s).xyz * 2.0 - 1.0; }
        float topH(sampler2D t, float s, vec2 p) { return textureGrad(t, p / s, gXZx / s, gXZy / s).a; }
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
        float tEra = eraAtWorld(vTerrW);
        float camDist = distance(cameraPosition, vTerrW);
        tXZ = vTerrW.xz;
        bool early3D = tEra > 1.5 && tEra < 2.5;
        bool stylized = tEra > 2.5 && tEra < 3.5;
        // 8-bit and 16-bit (inside a bubble or a retro band in 3D): no photographs, the tile set's flat colours
        bool retro = tEra < 1.5;
        // Early 3D: textures sampled at a very low resolution (a forced coarse mip), like the first 3D consoles.
        // 8-bit and 16-bit (inside a bubble or field, or a retro band, in 3D): coarser still, so the ground keeps
        // the painted colours (a cliff matches across a generation's edge) as broad flat regions, which the post
        // pass then reduces to that generation's palette.
        if (early3D || retro) {
          float k = retro ? 80.0 : 22.0;
          gXZx *= k; gXZy *= k; gZYx *= k; gZYy *= k; gXYx *= k; gXYy *= k;
        }
        // Beyond: relief (steep parallax) mapping on the ground near the camera, from the scanned height of
        // the dominant top layer, so stones, clods and leaf litter stand out of the surface.
        if (tEra > 4.5 && camDist < 16.0 && wn.y > 0.7 && wR < 0.5) {
          vec3 V = normalize(cameraPosition - vTerrW);
          const int STEPS = 10;
          float depth = 0.07 * (1.0 - smoothstep(9.0, 16.0, camDist));
          vec2 dir = -V.xz / max(V.y, 0.3) * depth / float(STEPS);
          float which = wG >= max(wP, wF) ? 0.0 : (wP >= wF ? 1.0 : 2.0);
          vec2 off = vec2(0.0);
          float layer = 1.0;
          for (int i = 0; i < STEPS; i++) {
            vec2 p = tXZ + off;
            float h = which < 0.5 ? topH(t_grassN, 3.5, p) : (which < 1.5 ? topH(t_pathN, 3.0, p) : topH(t_forestN, 4.0, p));
            if (h >= layer) break;
            layer -= 1.0 / float(STEPS);
            off += dir;
          }
          tXZ += off;
        }
        vec4 aG = vec4(0.0), aR = vec4(0.0), aP = vec4(0.0), aF = vec4(0.0);
        if (stylized) {
          // Stylized: flat colours from the art bible's palette (linear): sage grass, warm path, moss forest floor,
          // warm stone
          aG = vec4(0.17, 0.3, 0.08, 0.9); aP = vec4(0.5, 0.29, 0.12, 0.9); aF = vec4(0.07, 0.15, 0.04, 0.9); aR = vec4(0.4, 0.31, 0.18, 0.9);
        } else {
          if (wG > EPS) aG = topA(t_grassA, 3.5);
          if (wP > EPS) aP = topA(t_pathA, 3.0);
          if (wF > EPS) aF = topA(t_forestA, 4.0);
          if (wR > EPS) aR = triA(t_rockA, 6.0, tw);
        }
        // height-aware blend: brighter (taller) texels win near transitions
        vec4 W = vec4(wG, wR, wP, wF) * step(EPS, vec4(wG, wR, wP, wF)) * pow(vec4(dot(aG.rgb, vec3(0.33)), dot(aR.rgb, vec3(0.33)), dot(aP.rgb, vec3(0.33)), dot(aF.rgb, vec3(0.33))) + 0.35, vec4(3.0));
        W /= max(1e-4, W.x + W.y + W.z + W.w);
        vec4 A = aG * W.x + aR * W.y + aP * W.z + aF * W.w;
        terrRough = clamp(A.a, 0.35, 1.0);
        terrForest = W.w;
        terrEra = tEra;
        // retro: one tone per ground kind where a layer dominates (the tiles' crisp edges, not a blend)
        if (retro) A.rgb = W.y > 0.5 ? aR.rgb : W.z > 0.5 ? aP.rgb : W.w > 0.5 ? aF.rgb * vec3(0.85, 0.95, 0.72) : A.rgb;
        if (stylized) {
          // soft painted bands of light and dark across the ground, and a crisp path edge
          float band = floor(noiseT(vTerrW.xz * 0.012).y * 4.0) / 4.0;
          A.rgb *= 0.9 + band * 0.18;
          // value structure: slopes a band darker; the ground far behind the path paler and cooler (lavender
          // distance). Measured from the path, not the camera: the 2D camera stands far back on a long lens.
          A.rgb *= mix(1.0, 0.78, step(wn.y, 0.82));
          A.rgb = mix(A.rgb, vec3(0.6, 0.57, 0.78), smoothstep(12.0, 70.0, -vTerrW.z) * 0.45);
        }
        // Modern HD and Beyond: steep rock is bedded stone. Thin darker seams and a slightly different tone per
        // layer, wandering a little, so cliffs read as layered formations rather than one smeared face.
        if (tEra > 3.5 && W.y > 0.05) {
          float wander = noiseT(vTerrW.xz * 0.03).x * 0.9 + noiseT(vTerrW.xz * 0.11).y * 0.25;
          float layerF = vTerrW.y * 0.42 + wander;
          float band = fract(layerF);
          float seam = smoothstep(0.0, 0.04, band) * (1.0 - smoothstep(0.04, 0.12, band));
          float tone = 0.84 + 0.3 * fract(sin(floor(layerF) * 12.9898) * 43758.5453);
          vec3 layerTint = mix(vec3(1.04, 0.98, 0.9), vec3(0.94, 0.96, 1.02), step(0.5, fract(floor(layerF) * 0.5)));
          A.rgb = mix(A.rgb, A.rgb * tone * layerTint * (1.0 - seam * 0.45), W.y);
        }
        if (tEra > 4.5) {
          // the far heights: scree and bare rock, then snow on the flatter tops
          float n = noiseT(vTerrW.xz * 0.004).z - 0.5;
          float alt = smoothstep(17.0, 26.0, vTerrW.y + n * 8.0);
          if (alt > 0.01) {
            vec4 scree = textureGrad(t_rockA, vTerrW.xz / 15.0, gXZx / 15.0, gXZy / 15.0);
            A.rgb = mix(A.rgb, scree.rgb * vec3(0.95, 0.92, 0.88), alt * 0.85);
            float snow = smoothstep(33.0, 39.0, vTerrW.y + n * 10.0) * smoothstep(0.55, 0.8, wn.y);
            A.rgb = mix(A.rgb, vec3(0.86, 0.88, 0.92), snow);
            terrRough = mix(terrRough, 0.55, snow);
          }
          // damp ground: near the river and in the low spots of the path, darker and glossier
          float wet = (1.0 - smoothstep(-2.6, -1.2, vTerrW.y)) + W.z * smoothstep(0.55, 0.8, noiseT(vTerrW.xz * 0.035).w) * 0.8;
          wet = clamp(wet, 0.0, 1.0);
          A.rgb *= mix(1.0, 0.62, wet);
          terrRough = mix(terrRough, 0.28, wet);
        }
        diffuseColor.rgb = A.rgb;
        vec3 pTop = vec3(0.0);
        if (!stylized && !retro) {
          if (W.x > EPS) pTop += topN(t_grassN, 3.5) * W.x;
          if (W.z > EPS) pTop += topN(t_pathN, 3.0) * W.z;
          if (W.w > EPS) pTop += topN(t_forestN, 4.0) * W.w;
        }
        // Modern HD and Beyond: a fine detail normal close to the camera, so the ground holds up near Pip.
        if (tEra > 3.5 && camDist < 12.0) {
          vec3 dn = textureGrad(t_pathN, tXZ / 0.55, gXZx / 0.55, gXZy / 0.55).xyz * 2.0 - 1.0;
          pTop += dn * 0.45 * (1.0 - smoothstep(6.0, 12.0, camDist));
        }
        // whiteout-style perturbation of the geometric world normal
        vec3 pert = vec3(pTop.x, 0.0, pTop.y) * 0.9;
        if (W.y > EPS && !stylized && !retro) {
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
        // Beyond: sunlight through leaves on the forest floor, drifting as the canopy moves
        if (terrEra > 4.5 && terrForest > 0.05) {
          float dp = noiseT(vTerrW.xz * 0.32 + vec2(uTime * 0.021, uTime * 0.013)).x * 0.6
                   + noiseT(vTerrW.xz * 0.85 - vec2(uTime * 0.034, uTime * 0.02)).y * 0.4;
          reflectedLight.directDiffuse *= mix(1.0, mix(0.45, 1.4, smoothstep(0.44, 0.6, dp)), min(1.0, terrForest * 1.2));
        }
        reflectedLight.indirectDiffuse *= mix(0.3, 1.0, tao);
        reflectedLight.indirectSpecular *= mix(0.2, 1.0, tao);
        reflectedLight.directDiffuse *= mix(0.75, 1.0, tao);`,
      );
  };
  m.customProgramCacheKey = () => 'terrain-splat-v4';
  return patchEraMaterial(m, minEra > 0 ? { minEra, structural: true } : {});
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
      eraMaterial({ color: '#1e3f3a', roughness: 0.14, metalness: 0, pattern: PATTERN.water, transparent: true, opacity: 0.93, minEra: 2, structural: true }),
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
