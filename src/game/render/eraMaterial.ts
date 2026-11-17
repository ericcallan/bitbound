import * as THREE from 'three';
import { MAX_RIFTS } from '../era/EraSystem';

/**
 * Shared uniforms that let every world material know which graphical generation it is
 * rendering in at each fragment. During an era change the boundary is a sphere growing from
 * the ripple centre; in Beyond, rifts carve bubbles of older generations into the world.
 */
/**
 * A small tiling value-noise texture (four independent channels, smooth, wraps seamlessly): cheap noise for
 * per-pixel effects (cloud shadows, terrain variation) instead of hashing per pixel.
 */
function makeNoiseTexture(size = 128) {
  const data = new Uint8Array(size * size * 4);
  const cell = [8, 16, 32, 4];
  for (let c = 0; c < 4; c++) {
    const n = cell[c];
    const grid = Array.from({ length: n * n }, () => Math.random());
    const at = (i: number, j: number) => grid[((j + n) % n) * n + ((i + n) % n)];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * n;
        const fy = (y / size) * n;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const v = at(ix, iy) * (1 - sx) * (1 - sy) + at(ix + 1, iy) * sx * (1 - sy) + at(ix, iy + 1) * (1 - sx) * sy + at(ix + 1, iy + 1) * sx * sy;
        data[(y * size + x) * 4 + c] = Math.round(v * 255);
      }
    }
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export const eraUniforms = {
  uEraFrom: { value: 0 },
  uEraTo: { value: 0 },
  uRippleCenter: { value: new THREE.Vector3() },
  uRippleRadius: { value: 0 },
  uSunView: { value: new THREE.Vector3(0, 1, 0) },
  /** Menu / gallery: era by world x bands (5 thresholds → 6 bands). */
  uSplit: { value: 0 },
  uSplitX: { value: [0, 0, 0, 0, 0] as number[] },
  uRifts: { value: Array.from({ length: MAX_RIFTS }, () => new THREE.Vector4(0, -999, 0, 0)) },
  uRiftEra: { value: [0, 0, 0, 0] as number[] },
  /** Pip's Regress bubble (xyz centre, w radius; w = 0 when off) and its generation. */
  uBubble: { value: new THREE.Vector4(0, -999, 0, 0) },
  uBubbleEra: { value: 0 },
  /** Censor fields: up to 4 boxes forced to a generation. */
  uFieldMin: { value: Array.from({ length: 4 }, () => new THREE.Vector3(0, -999, 0)) },
  uFieldMax: { value: Array.from({ length: 4 }, () => new THREE.Vector3(0, -999, 0)) },
  uFieldEra: { value: [0, 0, 0, 0] as number[] },
  uTime: { value: 0 },
  /** The immersive valley: x below which the old box ground is replaced by terrain (0 = not loaded). */
  uValleyX: { value: -1e9 },
  /** Pip's position, so wind shaders (grass, ground cover) part around him. */
  uPip: { value: new THREE.Vector3() },
  /** 1 while the 2D view draws 8-bit through the tile renderer (render/retro), which replaces the ground. */
  uRetro2D: { value: 0 },
  /**
   * 1 while the world itself is 8- or 16-bit in that 2D view (or rippling into or out of it): the tile layer
   * then draws the ground, so the terrain gives way to it. A bubble alone doesn't count: the tiles don't draw
   * a Beyond world's ground, so the terrain must stay.
   */
  uRetroTiles: { value: 0 },
  uNoiseTex: { value: makeNoiseTexture() },
  /** Cutaway (3D): scenery inside a narrow cone from Pip to the camera dissolves, so he is never hidden. */
  uCutCam: { value: new THREE.Vector3() },
  uCutPip: { value: new THREE.Vector3(0, -999, 0) },
  uCutOn: { value: 0 },
  /** Early-3D vertex snapping grid (in NDC units per half-screen). */
  uSnapRes: { value: new THREE.Vector2(110, 80) },
};

export const PATTERN = {
  none: 0,
  dirt: 1,
  grass: 2,
  stone: 3,
  ruin: 4,
  hedge: 5,
  wood: 6,
  metal: 7,
  water: 8,
  mural: 9,
} as const;

/** GLSL shared by vertex and fragment stages: per-point era resolution. */
export const ERA_GLSL_COMMON = /* glsl */ `
uniform float uEraFrom;
uniform float uEraTo;
uniform vec3 uRippleCenter;
uniform float uRippleRadius;
uniform float uSplit;
uniform float uSplitX[5];
uniform vec4 uRifts[${MAX_RIFTS}];
uniform float uRiftEra[${MAX_RIFTS}];
uniform vec4 uBubble;
uniform float uBubbleEra;
uniform vec3 uFieldMin[4];
uniform vec3 uFieldMax[4];
uniform float uFieldEra[4];
uniform float uTime;
uniform float uValleyX;
uniform vec3 uPip;
uniform float uRetro2D;
uniform float uRetroTiles;
uniform sampler2D uNoiseTex;
uniform vec3 uCutCam;
uniform vec3 uCutPip;
uniform float uCutOn;
float eraAtWorld(vec3 w) {
  if (uSplit > 0.5) {
    float e = 0.0;
    for (int i = 0; i < 5; i++) e += step(uSplitX[i], w.x);
    return e;
  }
  float e = distance(w, uRippleCenter) < uRippleRadius ? uEraTo : uEraFrom;
  for (int i = 0; i < 4; i++) {
    if (all(greaterThanEqual(w, uFieldMin[i])) && all(lessThanEqual(w, uFieldMax[i]))) e = uFieldEra[i];
  }
  if (uBubble.w > 0.01 && distance(w, uBubble.xyz) < uBubble.w) return uBubbleEra;
  if (e > 4.5) {
    for (int i = 0; i < ${MAX_RIFTS}; i++) {
      if (uRifts[i].w > 0.01 && distance(w, uRifts[i].xyz) < uRifts[i].w) { e = uRiftEra[i]; break; }
    }
  }
  return e;
}
`;

const NOISE_GLSL = /* glsl */ `
float eraHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n000 = eraHash(i), n100 = eraHash(i + vec3(1,0,0)), n010 = eraHash(i + vec3(0,1,0)), n110 = eraHash(i + vec3(1,1,0));
  float n001 = eraHash(i + vec3(0,0,1)), n101 = eraHash(i + vec3(1,0,1)), n011 = eraHash(i + vec3(0,1,1)), n111 = eraHash(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbm(vec3 p) { return vnoise(p) * 0.55 + vnoise(p * 2.13) * 0.28 + vnoise(p * 4.41) * 0.17; }
/** Cheap smooth noise from the shared texture: four independent octave-like channels at one tile per unit of p. */
vec4 noiseT(vec2 p) { return texture2D(uNoiseTex, p); }
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vEraWorld;
uniform vec3 uSunView;
uniform float uPattern;
uniform float uFlatBoost;
${ERA_GLSL_COMMON}
${NOISE_GLSL}
vec3 eraPattern(vec3 col, vec3 p, float kind, float era) {
  float cs = era < 0.5 ? 0.5 : (era < 1.5 ? 0.25 : (era < 2.5 ? 0.5 : 0.125));
  vec3 c = floor(p / cs + 0.001);
  float n = eraHash(c + kind * 13.0);
  float amp = era < 0.5 ? 0.2 : (era < 1.5 ? 0.15 : (era < 2.5 ? 0.12 : (era < 3.5 ? 0.05 : 0.08)));
  float f = 1.0 + (n - 0.5) * amp;
  if (kind < 1.5) {
    float strata = step(0.84, fract(p.y * (era < 0.5 ? 0.9 : 1.6)));
    f *= 1.0 - strata * (era < 1.5 ? 0.16 : 0.07);
    f *= 1.0 - step(0.94, n) * 0.22;
    if (era > 4.5) f *= 0.85 + 0.3 * fbm(p * 3.0);
  } else if (kind < 2.5) {
    f = 1.0 + (n - 0.5) * amp * 1.5;
    if (era > 4.5) f *= 0.82 + 0.36 * fbm(p * 1.7);
  } else if (kind < 4.5) {
    float bh = kind < 3.5 ? 0.5 : 0.75;
    float row = floor(p.y / bh);
    float u = (p.x + p.z) / (bh * 2.0) + mod(row, 2.0) * 0.5;
    float v = p.y / bh;
    float mortar = clamp(step(fract(u), 0.05) + step(fract(v), 0.07), 0.0, 1.0);
    f *= 1.0 - mortar * (era < 1.5 ? 0.32 : (era < 3.5 ? 0.25 : 0.22));
    f *= 0.9 + eraHash(vec3(floor(u), row, kind)) * 0.2;
    if (era > 4.5) f *= 0.8 + 0.4 * fbm(p * 4.0);
  } else if (kind < 5.5) {
    f = 0.82 + n * 0.36;
  } else if (kind < 6.5) {
    float v = fract(p.x / 0.5);
    f *= 1.0 - step(0.9, v) * 0.35;
    f *= 0.95 + 0.1 * sin(p.x * 40.0 + p.z * 7.0);
  } else if (kind < 7.5) {
    f = 1.0 + (n - 0.5) * amp * 0.5;
  } else if (kind < 8.5) {
    float w = sin(p.x * 2.0 + uTime * 1.6) * 0.5 + sin(p.z * 3.1 - uTime * 1.2) * 0.5;
    f = 0.9 + 0.12 * w;
  } else {
    f = 1.0;
  }
  return col * f;
}

`;

export interface EraMatOptions {
  color: THREE.ColorRepresentation;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  pattern?: number;
  roughness?: number;
  metalness?: number;
  transparent?: boolean;
  opacity?: number;
  /** Brightness multiplier in the flat (pixel) eras. */
  flatBoost?: number;
  side?: THREE.Side;
  vertexColors?: boolean;
  /** Use MeshPhysicalMaterial (clearcoat, iridescence) for hero surfaces. */
  physical?: Partial<Pick<THREE.MeshPhysicalMaterial, 'clearcoat' | 'clearcoatRoughness' | 'iridescence' | 'sheen' | 'sheenColor'>>;
  /** Extra vertex displacement GLSL run in world space (receives `vec3 wp`, may modify it). */
  vertexWorld?: string;
  /**
   * Old box-world ground inside the immersive valley: hidden (per pixel) wherever the terrain has taken
   * over, i.e. inside the valley slice in the 3D generations, once the terrain asset has loaded.
   */
  hideInValley?: boolean;
  /**
   * Lowest generation this surface exists in (per pixel): the terrain is 2 (3D generations only),
   * scattered Blender vegetation is 4 (Modern HD and Beyond).
   */
  minEra?: number;
  /**
   * The ground and structure of the world (terrain, river, aqueduct water): below `minEra` it gives way only to
   * the 2D tile renderers, which draw their own. In 3D nothing replaces it, so inside an older generation's
   * bubble (or a split view's retro band) it stays, drawn in that generation's look, and never leaves a hole.
   */
  structural?: boolean;
  /** Level ground (and backdrop) the retro tile renderers draw themselves: hidden where they draw it (uRetroTiles). */
  retroTile?: boolean;
  /**
   * Resolve the generation per vertex instead of per pixel. For small, dense geometry (leaf cards, grass,
   * bark) the boundary looks the same and every pixel saves the field/bubble/rift lookups.
   */
  vertexEra?: boolean;
  /**
   * Scenery that may stand between the 3D camera and Pip (trees, plants, rocks, walls): dissolves with a fine
   * dither inside a narrow cone from Pip to the camera. Never the terrain (the camera moves instead).
   */
  cutaway?: boolean;
}

/**
 * The cutaway test, per fragment: inside a cone from just in front of Pip (narrow) to the camera (wider), with a
 * soft edge resolved by interleaved-gradient dither, so it reads as a clean see-through rather than a hole.
 */
const CUTAWAY_GLSL = /* glsl */ `
if (uCutOn > 0.01) {
  vec3 ab = uCutCam - uCutPip;
  float L2 = max(dot(ab, ab), 1e-4);
  float ct = dot(vEraWorld - uCutPip, ab) / L2;
  if (ct > 0.0 && ct < 1.0) {
    float L = sqrt(L2);
    float d = length(vEraWorld - (uCutPip + ab * ct));
    float r = mix(0.45, 1.6, clamp(ct * 1.3, 0.0, 1.0));
    float k = smoothstep(r, r * 0.5, d) * smoothstep(0.7, 1.5, ct * L) * uCutOn;
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (k > ign) discard;
  }
}
`;

/**
 * A standard (or physical) material that renders differently per generation:
 *  0 flat 2-band · 1 banded 3-tone + rim · 2 faceted vertex-lit low-poly with vertex jitter ·
 *  3 cel-shaded with tinted shadows and rim · 4 PBR · 5 PBR with procedural micro-detail.
 */
export function eraMaterial(o: EraMatOptions): THREE.MeshStandardMaterial {
  const params: THREE.MeshPhysicalMaterialParameters = {
    color: o.color,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    roughness: o.roughness ?? 0.85,
    metalness: o.metalness ?? 0,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
    vertexColors: o.vertexColors ?? false,
  };
  const m = o.physical ? new THREE.MeshPhysicalMaterial({ ...params, ...o.physical }) : new THREE.MeshStandardMaterial(params);
  return patchEraMaterial(m, o);
}

/**
 * Teach any standard/physical material (including ones loaded from glTF) the generation rules:
 * Early-3D vertex snapping, flat/cel lighting in the older generations, and the per-pixel era lookup
 * used by ripples, rifts, censor fields and Pip's Regress bubble.
 */
export function patchEraMaterial<T extends THREE.MeshStandardMaterial>(m: T, o: Partial<EraMatOptions> = {}): T {
  const local = { uPattern: { value: o.pattern ?? 0 }, uFlatBoost: { value: o.flatBoost ?? 1 } };
  const vertexWorld = o.vertexWorld ?? '';
  const discardRule = [
    // the old box ground gives way to the terrain inside the valley: always in 3D, and in 2D from Early 3D up
    o.hideInValley ? 'if (vEraWorld.x < uValleyX && (eraF > 1.5 || uRetroTiles < 0.5)) discard;' : '',
    o.minEra ? `if (${o.structural ? 'uRetroTiles > 0.5 && ' : ''}eraF < ${(o.minEra - 0.5).toFixed(1)}) discard;` : '',
    // only while the tiles draw the world: a bubble in a Beyond world keeps its boxes, drawn in its generation
    o.retroTile ? 'if (uRetroTiles > 0.5 && eraF < 1.5) discard;' : '',
    o.cutaway ? CUTAWAY_GLSL : '',
  ].join('\n');
  // Chain onto any patch already on the material (e.g. the terrain splat shader).
  const prev = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, eraUniforms, local);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vEraWorld;\n${o.vertexEra ? 'varying float vEraV;' : ''}\nuniform vec2 uSnapRes;\n${ERA_GLSL_COMMON}`)
      .replace(
        '#include <project_vertex>',
        `vec4 eraWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          eraWp = instanceMatrix * eraWp;
        #endif
        vec3 wp = (modelMatrix * eraWp).xyz;
        ${vertexWorld}
        vEraWorld = wp;
        ${o.vertexEra ? 'vEraV = eraAtWorld(wp);' : ''}
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        // Early 3D: snap vertices to a coarse screen grid for that wobbly, jittery polygon look.
        if (abs(eraAtWorld(wp) - 2.0) < 0.5 && gl_Position.w > 0.0) {
          vec2 ndc = gl_Position.xy / gl_Position.w;
          ndc = floor(ndc * uSnapRes + 0.5) / uSnapRes;
          gl_Position.xy = ndc * gl_Position.w;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}\n${o.vertexEra ? 'varying float vEraV;' : ''}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float eraF = ${o.vertexEra ? 'floor(vEraV + 0.5)' : 'eraAtWorld(vEraWorld)'};
        ${discardRule}
        if (uPattern > 0.5) diffuseColor.rgb = eraPattern(diffuseColor.rgb, vEraWorld, uPattern, eraF);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        if (eraF > 4.5 && uPattern > 0.5) {
          float rn = fbm(vEraWorld * 2.7);
          roughnessFactor = clamp(roughnessFactor * (0.65 + 0.7 * rn), 0.04, 1.0);
          if (uPattern > 7.5 && uPattern < 8.5) roughnessFactor = 0.03;
        }
`,
      )

      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // Beyond: procedural micro-surface detail (pores, grain, ripples) as a bump.
        if (eraF > 4.5 && uPattern > 0.5) {
          float sc = uPattern > 7.5 && uPattern < 8.5 ? 1.3 : 6.0;
          vec3 wpd = vEraWorld * sc + (uPattern > 7.5 && uPattern < 8.5 ? vec3(uTime * 0.6, 0.0, uTime * 0.45) : vec3(0.0));
          float e = 0.05;
          float h0 = fbm(wpd);
          vec3 g = vec3(fbm(wpd + vec3(e, 0, 0)) - h0, fbm(wpd + vec3(0, e, 0)) - h0, fbm(wpd + vec3(0, 0, e)) - h0) / e;
          float amt = uPattern > 7.5 && uPattern < 8.5 ? 0.22 : 0.09;
          vec3 gv = (viewMatrix * vec4(g, 0.0)).xyz;
          normal = normalize(normal - gv * amt);
        }`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        // Beyond: soft cloud shadows drifting across the valley.
        if (eraF > 4.5) {
          float cs = noiseT(vEraWorld.xz * 0.0022 + vec2(uTime * 0.0015, uTime * 0.0006)).x * 0.65
                   + noiseT(vEraWorld.xz * 0.0031 + vec2(uTime * 0.0025, 0.0)).y * 0.35;
          float shade = mix(0.62, 1.0, smoothstep(0.36, 0.6, cs));
          reflectedLight.directDiffuse *= shade;
          reflectedLight.directSpecular *= shade;
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `if (eraF < 3.5) {
          vec3 nV = normalize(normal);
          vec3 sun = normalize(uSunView);
          float ndl = dot(nV, sun);
          vec3 col;
          if (eraF < 0.5) {
            col = diffuseColor.rgb * (ndl > 0.15 ? 1.0 : 0.7) * 0.95 * uFlatBoost;
          } else if (eraF < 1.5) {
            float b = ndl > 0.55 ? 1.04 : (ndl > -0.05 ? 0.86 : 0.64);
            float rim = pow(1.0 - abs(nV.z), 3.0) * 0.12;
            col = diffuseColor.rgb * (b + rim) * 0.92 * uFlatBoost;
          } else if (eraF < 2.5) {
            // Faceted, per-polygon vertex lighting with no specular and no shadow maps.
            vec3 fn = normalize(cross(dFdx(-vViewPosition), dFdy(-vViewPosition)));
            float d = max(dot(fn, sun), 0.0);
            float hemi = 0.5 + 0.5 * fn.y;
            col = diffuseColor.rgb * (0.38 + 0.22 * hemi + 0.62 * d) * uFlatBoost;
          } else {
            // Cel shading driven by the real lighting (so shadows still band), with tinted shade.
            float lum = dot(totalDiffuse, vec3(0.333)) / max(dot(diffuseColor.rgb, vec3(0.333)), 0.02);
            float band = lum > 0.95 ? 1.06 : (lum > 0.45 ? 0.82 : 0.55);
            vec3 shade = mix(vec3(0.62, 0.58, 0.98), vec3(1.0), smoothstep(0.55, 1.06, band));
            vec3 v = normalize(vViewPosition);
            float rim = step(0.62, 1.0 - max(dot(nV, v), 0.0)) * 0.22 * smoothstep(-0.2, 0.4, ndl);
            vec3 h = normalize(sun + v);
            float spec = step(0.985, max(dot(nV, h), 0.0)) * (1.0 - roughnessFactor) * 0.6;
            col = diffuseColor.rgb * band * shade * 1.04 + vec3(rim + spec);
          }
          outgoingLight = col + totalEmissiveRadiance;
        }
        #include <opaque_fragment>`,
      );
  };
  const prevKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () =>
    `${prevKey()}|era-v4${vertexWorld ? '-vw' + vertexWorld.length : ''}${o.physical || (m as unknown as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial ? '-phys' : ''}${o.hideInValley ? '-hv' : ''}${o.minEra ? '-me' + o.minEra : ''}${o.structural ? '-st' : ''}${o.retroTile ? '-rt' : ''}${o.vertexEra ? '-ve' : ''}${o.cutaway ? '-cut' : ''}`;
  return m;
}

const cache = new Map<string, THREE.MeshStandardMaterial>();
/** Cached variant for repeated decoration. */
export function sharedEraMaterial(key: string, o: EraMatOptions) {
  let m = cache.get(key);
  if (!m) {
    m = eraMaterial(o);
    cache.set(key, m);
  }
  return m;
}
