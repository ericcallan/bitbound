/**
 * Wind for Blender-built vegetation, as world-space vertex snippets for `patchEraMaterial`'s
 * `vertexWorld` hook (they read `transformed`, the model-space position, and move `wp`).
 */

/** Leaf cards: the whole canopy leans with gusts, and each card flutters a little. */
export const LEAF_WIND = /* glsl */ `
  float lh = max(0.0, transformed.y - 1.5);
  float gust = 0.6 + 0.4 * sin(uTime * 0.37 + wp.x * 0.05);
  wp.x += sin(uTime * 1.1 + wp.x * 0.21 + wp.z * 0.17) * 0.014 * lh * gust;
  wp.z += cos(uTime * 0.9 + wp.x * 0.13) * 0.01 * lh * gust;
  float fl = smoothstep(1.5, 4.0, transformed.y);
  wp += vec3(sin(uTime * 4.1 + transformed.x * 3.1 + transformed.z * 2.3), sin(uTime * 3.3 + transformed.z * 2.9) * 0.6, cos(uTime * 3.7 + transformed.x * 2.7)) * 0.025 * fl;
`;

/** Trunks and limbs: a slow sway that grows with height (the canopy and wood move together). */
export const BARK_SWAY = /* glsl */ `
  float bh = max(0.0, transformed.y - 1.5);
  float bgust = 0.6 + 0.4 * sin(uTime * 0.37 + wp.x * 0.05);
  wp.x += sin(uTime * 1.1 + wp.x * 0.21 + wp.z * 0.17) * 0.014 * bh * bgust;
  wp.z += cos(uTime * 0.9 + wp.x * 0.13) * 0.01 * bh * bgust;
`;

/** Ground cover: blades bend with the wind and part around Pip. */
export const CLUMP_WIND = /* glsl */ `
  float ch = clamp(transformed.y / 0.6, 0.0, 1.0);
  vec2 cw = vec2(sin(uTime * 1.7 + wp.x * 0.6 + wp.z * 0.4), cos(uTime * 1.3 + wp.x * 0.3 - wp.z * 0.2)) * 0.09;
  vec2 cp = wp.xz - uPip.xz;
  float cd = length(cp);
  vec2 cpush = cd < 0.9 && abs(wp.y - uPip.y) < 1.0 ? normalize(cp + 1e-4) * (0.9 - cd) * 0.6 : vec2(0.0);
  wp.xz += (cw + cpush) * ch * ch;
  wp.y -= length(cpush) * 0.3 * ch;
`;
