import { MAX_RIFTS } from '../../era/EraSystem';

export const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const DEPTH_HELPERS = /* glsl */ `
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
vec3 viewPosAt(sampler2D depthTex, vec2 uv) {
  float d = texture2D(depthTex, uv).r;
  vec4 ndc = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 v = uInvProj * ndc;
  return v.xyz / v.w;
}
float viewDistOf(float d) {
  vec4 v = uInvProj * vec4(0.0, 0.0, d * 2.0 - 1.0, 1.0);
  return -v.z / v.w;
}
vec3 worldOf(vec2 uv, float d) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 v = uInvProj * ndc;
  v /= v.w;
  return (uCamWorld * v).xyz;
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

/** Screen-space ambient occlusion from depth only (normals reconstructed). Half resolution. */
export const AO_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform mat4 uProj;
uniform float uRadius;
${DEPTH_HELPERS}
void main() {
  float d = texture2D(tDepth, vUv).r;
  if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 p = viewPosAt(tDepth, vUv);
  vec3 px = viewPosAt(tDepth, vUv + vec2(uTexel.x, 0.0)) - p;
  vec3 py = viewPosAt(tDepth, vUv + vec2(0.0, uTexel.y)) - p;
  vec3 n = normalize(cross(px, py));
  if (dot(n, -p) < 0.0) n = -n;
  vec3 t = normalize(abs(n.y) < 0.9 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(n, t);
  float rnd = hash12(gl_FragCoord.xy) * 6.2831;
  float occ = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float r = sqrt((fi + 0.5) / 12.0);
    float a = fi * 2.39996 + rnd;
    vec3 h = vec3(cos(a) * r, sin(a) * r, sqrt(max(0.0, 1.0 - r * r)));
    float sc = mix(0.12, 1.0, (fi / 12.0) * (fi / 12.0));
    vec3 s = p + (t * h.x + b * h.y + n * h.z) * uRadius * sc;
    vec4 c = uProj * vec4(s, 1.0);
    vec2 suv = c.xy / c.w * 0.5 + 0.5;
    float sz = viewPosAt(tDepth, suv).z;
    float range = smoothstep(0.0, 1.0, uRadius / max(abs(p.z - sz), 1e-3));
    occ += (sz >= s.z + 0.02 ? 1.0 : 0.0) * range;
  }
  float ao = clamp(1.0 - occ / 12.0 * 1.35, 0.0, 1.0);
  gl_FragColor = vec4(vec3(ao), 1.0);
}
`;

export const BLUR_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tInput;
uniform vec2 uTexel;
void main() {
  vec4 s = vec4(0.0);
  for (int x = -2; x <= 1; x++) for (int y = -2; y <= 1; y++) s += texture2D(tInput, vUv + (vec2(float(x), float(y)) + 0.5) * uTexel);
  gl_FragColor = s / 16.0;
}
`;

/** Bloom: soft-threshold prefilter into the first mip. */
export const PREFILTER_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
void main() {
  vec3 c = (texture2D(tInput, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tInput, vUv + uTexel * vec2(0.5, -0.5)).rgb +
            texture2D(tInput, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tInput, vUv + uTexel * vec2(0.5, 0.5)).rgb) * 0.25;
  c = min(c, vec3(40.0));
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(c * contrib, 1.0);
}
`;

export const DOWN_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tInput;
uniform vec2 uTexel;
void main() {
  vec3 a = texture2D(tInput, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  vec3 b = texture2D(tInput, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  vec3 c = texture2D(tInput, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  vec3 d = texture2D(tInput, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  vec3 e = texture2D(tInput, vUv).rgb;
  gl_FragColor = vec4((a + b + c + d) * 0.125 + e * 0.5, 1.0);
}
`;

export const UP_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tLow;
uniform sampler2D tHigh;
uniform vec2 uTexel;
uniform float uScatter;
void main() {
  vec3 s = texture2D(tLow, vUv).rgb * 4.0;
  s += (texture2D(tLow, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tLow, vUv - vec2(uTexel.x, 0.0)).rgb +
        texture2D(tLow, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tLow, vUv - vec2(0.0, uTexel.y)).rgb) * 2.0;
  s += texture2D(tLow, vUv + uTexel).rgb + texture2D(tLow, vUv - uTexel).rgb +
       texture2D(tLow, vUv + vec2(uTexel.x, -uTexel.y)).rgb + texture2D(tLow, vUv + vec2(-uTexel.x, uTexel.y)).rgb;
  gl_FragColor = vec4(texture2D(tHigh, vUv).rgb + s / 16.0 * uScatter, 1.0);
}
`;

/** Volumetric light shafts: march sky visibility toward the sun's screen position. */
export const RAYS_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth;
uniform vec2 uSun;
uniform float uAspect;
void main() {
  vec2 dir = (uSun - vUv);
  float acc = 0.0;
  float w = 1.0;
  vec2 uv = vUv;
  vec2 stepv = dir / 40.0;
  float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
  uv += stepv * jitter;
  for (int i = 0; i < 40; i++) {
    float sky = texture2D(tDepth, uv).r >= 0.99999 ? 1.0 : 0.0;
    vec2 dd = (uv - uSun) * vec2(uAspect, 1.0);
    float glow = exp(-dot(dd, dd) * 6.0);
    acc += sky * (0.25 + glow) * w;
    w *= 0.96;
    uv += stepv;
  }
  gl_FragColor = vec4(vec3(acc / 40.0), 1.0);
}
`;

/** Final composite: decides the generation per pixel and applies its whole look. */
export const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tAO;
uniform sampler2D tBloom;
uniform sampler2D tRays;
uniform vec2 uRes;
uniform vec2 uSceneRes;
uniform float uEraFrom;
uniform float uEraTo;
uniform vec3 uCenter;
uniform float uRadius;
uniform float uRippleActive;
uniform float uSplit;
uniform float uSplitScreen[5];
uniform vec4 uRifts[${MAX_RIFTS}];
uniform float uRiftEra[${MAX_RIFTS}];
uniform vec3 uPal[16];
uniform float uFade;
uniform vec3 uFadeColor;
uniform vec2 uShiftCenter;
uniform float uShiftT;
uniform float uTime;
uniform float uFlash;
uniform vec3 uFocus;
uniform float uFocusDist;
uniform float uDof;
uniform float uHasAO;
uniform float uHasBloom;
uniform float uHasRays;
uniform vec3 uSunColor;
uniform float uSkyRadius;
uniform vec4 uBubble;
uniform float uBubbleEra;
uniform vec3 uFieldMin[4];
uniform vec3 uFieldMax[4];
uniform float uFieldEra[4];
uniform sampler2D tRetro;
uniform vec2 uRetroOrigin;
uniform vec2 uRetroSize;
uniform float uRetro2D;
uniform float uLaneZ;
uniform mat4 uViewProj;
uniform vec3 uSunW;
uniform float uLetterbox;
uniform float uRetroK;

${DEPTH_HELPERS}

vec3 toSRGB(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 aces(vec3 x) {
  const float a = 2.51; const float b = 0.03; const float c = 2.43; const float d = 0.59; const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float i = q.x + q.y * 4.0;
  float m[16];
  m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0; m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
  m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0; m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
  for (int k = 0; k < 16; k++) if (float(k) == i) return m[k] / 16.0;
  return 0.0;
}
vec3 nearestPal(vec3 c) {
  float best = 1e9; vec3 r = c;
  for (int i = 0; i < 16; i++) {
    vec3 d = (c - uPal[i]) * vec3(0.9, 1.2, 0.7);
    float e = dot(d, d);
    if (e < best) { best = e; r = uPal[i]; }
  }
  return r;
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }

// Where this pixel's view ray crosses the 2D lane (the plane the 8-bit tile layer lives in).
vec3 lanePoint(vec2 uv) {
  vec3 a = worldOf(uv, 0.1);
  vec3 b = worldOf(uv, 0.9);
  float t = (uLaneZ - a.z) / (b.z - a.z);
  return a + (b - a) * t;
}

float eraAt(vec2 uv, float d) {
  if (uSplit > 0.5) {
    float e = 0.0;
    for (int i = 0; i < 5; i++) e += step(uSplitScreen[i], uv.x);
    return e;
  }
  float e;
  vec3 w = worldOf(uv, d);
  // In 2D the empty sky is the lane itself: the generation there is the generation of that lane point.
  if (uRetro2D > 0.5 && d >= 0.99999) { w = lanePoint(uv); d = 0.5; }
  if (d >= 0.99999) e = (uRippleActive > 0.5 && uRadius > uSkyRadius) ? uEraTo : uEraFrom;
  else e = (uRippleActive > 0.5 && distance(w, uCenter) < uRadius) ? uEraTo : uEraFrom;
  if (d < 0.99999) {
    for (int i = 0; i < 4; i++) {
      if (all(greaterThanEqual(w, uFieldMin[i])) && all(lessThanEqual(w, uFieldMax[i]))) e = uFieldEra[i];
    }
    if (uBubble.w > 0.01 && distance(w, uBubble.xyz) < uBubble.w) return uBubbleEra;
  }
  if (e > 4.5 && d < 0.99999) {
    for (int i = 0; i < ${MAX_RIFTS}; i++) {
      if (uRifts[i].w > 0.01 && distance(w, uRifts[i].xyz) < uRifts[i].w) { e = uRiftEra[i]; break; }
    }
  }
  return e;
}

// --- 8-bit / 16-bit: pixel grid, palette or posterise, dithering, outlines
vec3 pixelEra(vec2 fc, float rows, bool eight) {
  float ps = max(1.0, floor(uRes.y / rows));
  vec2 block = floor(fc / ps);
  vec2 uvc = (block + 0.5) * ps / uRes;
  vec3 col = texture2D(tColor, uvc).rgb;
  float d0 = viewDistOf(texture2D(tDepth, uvc).r);
  vec2 o = vec2(ps) / uRes;
  float thr = 0.12 * d0 + 0.6;
  float edge = 0.0;
  if (viewDistOf(texture2D(tDepth, uvc + vec2(o.x, 0.0)).r) - d0 > thr || viewDistOf(texture2D(tDepth, uvc - vec2(o.x, 0.0)).r) - d0 > thr ||
      viewDistOf(texture2D(tDepth, uvc + vec2(0.0, o.y)).r) - d0 > thr || viewDistOf(texture2D(tDepth, uvc - vec2(0.0, o.y)).r) - d0 > thr) edge = 1.0;
  col = toSRGB(clamp(col, 0.0, 1.4));
  float dith = bayer4(block) - 0.5;
  // The first generation has no gradients in its sky: one flat colour (night in the city).
  if (eight && texture2D(tDepth, uvc).r >= 0.99999) return uPal[3];
  if (eight) {
    col += dith * 0.11;
    col = nearestPal(col);
    if (edge > 0.5) col = mix(col, uPal[0], 0.85);
  } else {
    col = mix(vec3(luma(col)), col, 1.12);
    col += dith * 0.045;
    col = floor(col * 7.0 + 0.5) / 7.0;
    if (edge > 0.5) col = mix(col, vec3(0.08, 0.06, 0.16), 0.6);
  }
  return col;
}

// --- 8-bit (2D): the tile layer, one world pixel at a time. Sprites in the scene are snapped to the same
// grid and palette; everything else is the tile canvas or the flat sky.
vec3 retroEra(vec2 uv) {
  vec2 rp = floor((lanePoint(uv).xy - uRetroOrigin) * 16.0);
  vec4 clip = uViewProj * vec4((rp + 0.5) / 16.0 + uRetroOrigin, uLaneZ, 1.0);
  vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
  if (texture2D(tDepth, suv).r < 0.99999) return nearestPal(toSRGB(clamp(texture2D(tColor, suv).rgb, 0.0, 1.4)));
  if (all(greaterThanEqual(rp, vec2(0.0))) && all(lessThan(rp, uRetroSize))) {
    vec4 t = texelFetch(tRetro, ivec2(rp), 0);
    if (t.a > 0.5) return t.rgb;
  }
  return uPal[3];
}

// --- Early 3D: low-res framebuffer, 15-bit colour with dither, short draw-distance fog
vec3 early3D(vec2 fc) {
  float ps = max(1.0, floor(uRes.y / 240.0));
  vec2 block = floor(fc / ps);
  vec2 uvc = (block + 0.5) * ps / uRes;
  vec3 col = texture2D(tColor, uvc).rgb;
  float d = texture2D(tDepth, uvc).r;
  col = toSRGB(clamp(col, 0.0, 1.2));
  if (d < 0.99999) {
    float dist = distance(worldOf(uvc, d), uFocus);
    float fog = smoothstep(26.0, 120.0, dist) * 0.72;
    col = mix(col, vec3(0.6, 0.73, 0.86), fog);
  } else {
    col = mix(col, vec3(0.6, 0.73, 0.86), 0.4);
  }
  col = mix(vec3(luma(col)), col, 1.12);
  col += (bayer4(block) - 0.5) / 31.0 * 1.5;
  col = floor(col * 31.0 + 0.5) / 31.0;
  return col;
}

// --- Stylized: ink outlines from depth and normal breaks, punchy grade
vec3 stylized(vec2 uv) {
  vec3 col = texture2D(tColor, uv).rgb;
  float d = texture2D(tDepth, uv).r;
  vec2 o = 1.4 / uSceneRes;
  float ink = 0.0;
  if (d < 0.99999) {
    vec3 p = viewPosAt(tDepth, uv);
    vec3 pr = viewPosAt(tDepth, uv + vec2(o.x, 0.0));
    vec3 pu = viewPosAt(tDepth, uv + vec2(0.0, o.y));
    vec3 pl = viewPosAt(tDepth, uv - vec2(o.x, 0.0));
    vec3 pd = viewPosAt(tDepth, uv - vec2(0.0, o.y));
    vec3 n = normalize(cross(pr - p, pu - p));
    vec3 n2 = normalize(cross(pl - p, pd - p));
    float dz = max(max(abs(pr.z - p.z), abs(pl.z - p.z)), max(abs(pu.z - p.z), abs(pd.z - p.z)));
    float depthEdge = smoothstep(0.04, 0.09, dz / max(-p.z, 0.1));
    float normalEdge = smoothstep(0.35, 0.7, 1.0 - abs(dot(n, n2)));
    ink = max(depthEdge, normalEdge * 0.85);
  }
  col = clamp(col, 0.0, 1.3);
  col = toSRGB(col);
  col = mix(vec3(luma(col)), col, 1.2);
  col = (col - 0.5) * 1.06 + 0.5;
  return mix(col, vec3(0.1, 0.07, 0.2), ink * 0.85);
}

vec3 viewDirOf(vec2 uv) { return normalize(worldOf(uv, 1.0) - uCamWorld[3].xyz); }

// --- Modern HD: grounded late afternoon. PBR with ambient occlusion, distance and height fog, restrained
// bloom, lower exposure and a firmer contrast curve.
vec3 modern(vec2 uv, float d) {
  vec3 col = texture2D(tColor, uv).rgb;
  if (uHasAO > 0.5) col *= mix(1.0, texture2D(tAO, uv).r, 0.8);
  if (d < 0.99999) {
    vec3 w = worldOf(uv, d);
    float vd = viewDistOf(d);
    // distance haze at every height (so far peaks recede), thicker in the low ground
    float fog = (1.0 - exp(-max(vd - 18.0, 0.0) * 0.0075)) * mix(0.55, 1.0, exp(-max(w.y + 1.0, 0.0) * 0.045)) * 0.7;
    col = mix(col, vec3(0.3, 0.38, 0.48), fog);
  }
  if (uHasBloom > 0.5) col += texture2D(tBloom, uv).rgb * 0.22;
  col = aces(col * 0.8);
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.28);
  col = max(mix(vec3(luma(col)), col, 1.08), 0.0);
  col = toSRGB(col);
  vec2 q = uv - 0.5;
  return col * (1.0 - dot(q, q) * 0.6);
}

// --- Beyond: depth of field, AO, bloom, light shafts, atmosphere, grade, CA, grain
vec3 beyond(vec2 uv, float d) {
  float vd = viewDistOf(d);
  float coc = d >= 0.99999 ? 1.0 : clamp(abs(vd - uFocusDist) / max(vd, 0.1) * 2.2, 0.0, 1.0);
  coc = smoothstep(0.08, 1.0, coc) * uDof;
  vec3 col;
  if (coc > 0.02) {
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    float rad = coc * 9.0;
    for (int i = 0; i < 20; i++) {
      float fi = float(i);
      float r = sqrt((fi + 0.5) / 20.0) * rad;
      float a = fi * 2.39996;
      vec2 suv = uv + vec2(cos(a), sin(a)) * r / uSceneRes;
      vec3 s = texture2D(tColor, suv).rgb;
      float w = 1.0 + luma(s) * 0.15;
      acc += s * w;
      wsum += w;
    }
    col = acc / wsum;
  } else {
    col = texture2D(tColor, uv).rgb;
  }
  // gentle chromatic aberration toward the edges
  vec2 cdir = (uv - 0.5) * 0.0035;
  col.r = mix(col.r, texture2D(tColor, uv + cdir).r, 0.6);
  col.b = mix(col.b, texture2D(tColor, uv - cdir).b, 0.6);
  if (uHasAO > 0.5) col *= mix(1.0, texture2D(tAO, uv).r, 0.95);
  // atmosphere: golden-hour haze, warm toward the low sun and cool away from it, thicker near the ground
  float rays = uHasRays > 0.5 ? texture2D(tRays, uv).r : 0.0;
  vec3 vdir = viewDirOf(uv);
  float toSun = max(dot(vdir, normalize(uSunW)), 0.0);
  vec3 haze = mix(vec3(0.34, 0.42, 0.58), vec3(1.0, 0.68, 0.4), pow(toSun, 3.0));
  if (d < 0.99999) {
    vec3 w = worldOf(uv, d);
    float beyondFocus = max(0.0, vd - uFocusDist * 0.6);
    float fog = (1.0 - exp(-beyondFocus * 0.008)) * mix(0.6, 1.0, exp(-max(w.y + 2.0, 0.0) * 0.05)) * 0.42;
    col = mix(col, haze + uSunColor * rays * 0.6, fog);
  } else {
    // the sky: deep blue overhead, a warm band along the horizon, a glow around the sun
    float horizon = 1.0 - smoothstep(-0.02, 0.32, vdir.y);
    col *= mix(vec3(0.7, 0.82, 1.08), vec3(1.4, 1.02, 0.66), clamp(horizon * 0.85 + pow(toSun, 5.0) * 0.8, 0.0, 1.0));
  }
  if (uHasBloom > 0.5) col += texture2D(tBloom, uv).rgb * 0.5;
  col += uSunColor * rays * 0.7;
  col = aces(col * 0.86);
  // grade: filmic contrast, richer saturation, cool lifted shadows, warm highlights
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.5);
  col = max(mix(vec3(luma(col)), col, 1.28), 0.0);
  float l = luma(col);
  col += (1.0 - l) * vec3(-0.01, 0.015, 0.035) * (1.0 - l);
  col *= mix(vec3(1.0), vec3(1.09, 1.0, 0.86), smoothstep(0.4, 1.0, l));
  col = toSRGB(col);
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 917.0) - 0.5) * 0.035;
  vec2 q = uv - 0.5;
  return col * (1.0 - dot(q, q) * 0.62);
}

void main() {
  vec2 uv = vUv;
  // Dimension-shift ripple distortion in screen space.
  if (uShiftT > 0.0 && uShiftT < 1.0) {
    vec2 asp = vec2(uRes.x / uRes.y, 1.0);
    vec2 dv = (uv - uShiftCenter) * asp;
    float r = length(dv);
    float w = exp(-pow((r - uShiftT * 1.6) * 9.0, 2.0)) * (1.0 - uShiftT);
    uv += normalize(dv + 1e-5) / asp * w * 0.018;
  }
  vec2 fc = uv * uRes;
  float depth = texture2D(tDepth, uv).r;
  float era = eraAt(uv, depth);
  vec3 col;
  if (era < 0.5) col = uRetro2D > 0.5 ? retroEra(uv) : pixelEra(fc, 150.0, true);
  else if (era < 1.5) col = pixelEra(fc, 280.0, false);
  else if (era < 2.5) col = early3D(fc);
  else if (era < 3.5) col = stylized(uv);
  else if (era < 4.5) col = modern(uv, depth);
  else col = beyond(uv, depth);

  vec3 w = worldOf(uv, depth);
  // Glowing ripple front of an era change.
  if (uRippleActive > 0.5 && uSplit < 0.5) {
    float dist = depth >= 0.99999 ? 400.0 : distance(w, uCenter);
    float ring = exp(-pow((dist - uRadius) * 0.9, 2.0));
    col += vec3(0.35, 0.95, 0.9) * ring * 0.9;
    col += vec3(1.0, 0.85, 0.5) * exp(-pow((dist - uRadius + 1.6) * 1.4, 2.0)) * 0.25;
  }
  // The Regress bubble's edge: a bright generation seam around Pip.
  if (uBubble.w > 0.01 && depth < 0.99999 && uSplit < 0.5) {
    float bd = distance(w, uBubble.xyz);
    float ring = exp(-pow((bd - uBubble.w) * 3.0, 2.0));
    col += hue(fract(uBubbleEra / 6.0 + uTime * 0.1)) * ring * 0.9 + vec3(0.6, 1.0, 1.0) * ring * 0.3;
  }
  // Iridescent skin of the generation rifts.
  if (uSplit < 0.5 && depth < 0.99999) {
    for (int i = 0; i < ${MAX_RIFTS}; i++) {
      if (uRifts[i].w < 0.01) continue;
      float rd = distance(w, uRifts[i].xyz);
      float ring = exp(-pow((rd - uRifts[i].w) * 4.0, 2.0));
      vec3 iri = hue(fract(rd * 0.3 + uTime * 0.15 + float(i) * 0.25));
      col += iri * ring * 0.5;
    }
  }
  // Seams between generations on split screens.
  if (uSplit > 0.5) {
    float m = 1.0;
    for (int i = 0; i < 5; i++) m = min(m, abs(uv.x - uSplitScreen[i]));
    // hairline seams between the generations
    float seam = exp(-pow(m * uRes.x * 0.7, 2.0));
    col = mix(col, vec3(1.0), seam * 0.32);
  }
  col += uFlash * vec3(0.8, 1.0, 1.0);
  // 8-bit letterbox: exactly 240 rows in the middle of the screen
  if (uLetterbox > 0.001) {
    float halfBand = mix(uRes.y * 0.5 + 1.0, 120.0 * uRetroK, uLetterbox);
    if (abs(gl_FragCoord.y - uRes.y * 0.5) > halfBand) col = vec3(0.0);
  }
  col = mix(col, uFadeColor, uFade);
  gl_FragColor = vec4(col, 1.0);
}
`;
