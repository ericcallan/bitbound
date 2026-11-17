import * as THREE from 'three';
import { eraUniforms } from './eraMaterial';

/**
 * Falling water: a ribbon along a path (top to bottom) with streaks scrolling down it, foam where it lands and
 * soft mist rising. Used by the title set and the broken aqueduct.
 */
export interface Waterfall {
  group: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

const FALL_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform sampler2D uNoiseTex;
uniform float uOpacity;
uniform float uRate;
void main() {
  float x = vUv.x;
  float edge = smoothstep(0.0, 0.2, x) * smoothstep(1.0, 0.8, x);
  float n1 = texture2D(uNoiseTex, vec2(x * 2.2, vUv.y * 1.1 - uTime * 0.9 * uRate)).r;
  float n2 = texture2D(uNoiseTex, vec2(x * 5.0 + 0.3, vUv.y * 2.6 - uTime * 1.7 * uRate)).g;
  float streak = smoothstep(0.32, 0.78, n1 * 0.6 + n2 * 0.55);
  vec3 col = mix(vec3(0.42, 0.62, 0.64), vec3(0.96, 0.98, 1.0), streak);
  float lip = smoothstep(0.0, 0.06, vUv.y);
  float foot = smoothstep(0.82, 1.0, vUv.y);
  col = mix(col, vec3(1.0), foot * 0.6);
  float a = edge * lip * (0.5 + 0.45 * streak) * (1.0 - foot * 0.25) * uOpacity;
  gl_FragColor = vec4(col * 1.05, a);
}`;

let puff: THREE.Texture | null = null;
/** A soft round puff (shared by every mist sprite and foam disc). */
export function puffTexture() {
  if (puff) return puff;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d')!;
  const grd = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = grd;
  c.fillRect(0, 0, 64, 64);
  puff = new THREE.CanvasTexture(cv);
  return puff;
}

/**
 * @param path points from the lip down to where it lands (world or parent space)
 * @param across unit vector across the ribbon
 */
export function makeWaterfall(
  path: THREE.Vector3[],
  across: THREE.Vector3,
  widthTop: number,
  widthBot: number,
  opts: { waterY: number; mist?: number; opacity?: number; /** A second ribbon at right angles, so a narrow fall reads from any side. */ crossed?: boolean } = { waterY: 0 },
): Waterfall {
  const group = new THREE.Group();
  const dirs = [across];
  if (opts.crossed) dirs.push(new THREE.Vector3(across.z, 0, -across.x));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const N = path.length - 1;
  dirs.forEach((ac, r) => {
    const o = r * (N + 1) * 2;
    path.forEach((p, i) => {
      const k = i / N;
      const w = (widthTop + (widthBot - widthTop) * k) / 2;
      pos.push(p.x - ac.x * w, p.y - ac.y * w, p.z - ac.z * w, p.x + ac.x * w, p.y + ac.y * w, p.z + ac.z * w);
      uv.push(0, k, 1, k);
      if (i < N) idx.push(o + i * 2, o + i * 2 + 1, o + i * 2 + 2, o + i * 2 + 1, o + i * 2 + 3, o + i * 2 + 2);
    });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const height = path[0].y - path[N].y;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime: eraUniforms.uTime, uNoiseTex: eraUniforms.uNoiseTex, uOpacity: { value: opts.opacity ?? 1 }, uRate: { value: Math.max(0.6, 10 / Math.max(2, height)) } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: FALL_FRAG,
  });
  // the ribbon repeats its streak texture along its length in proportion to its height
  const ribbon = new THREE.Mesh(g, mat);
  ribbon.renderOrder = 2;
  ribbon.frustumCulled = false;
  group.add(ribbon);

  const tex = puffTexture();
  const base = path[N].clone();
  // mist where it lands: soft puffs rising and fading, all in one point cloud (one draw call)
  const count = opts.mist ?? 14;
  const seeds = Array.from({ length: count }, (_, i) => ({ phase: i / count, ox: (Math.random() - 0.5) * widthBot * 1.2, oz: (Math.random() - 0.2) * widthBot * 0.7 }));
  const mistPos = new Float32Array(count * 3);
  const mistA = new Float32Array(count * 2);
  const mistGeo = new THREE.BufferGeometry();
  mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPos, 3));
  mistGeo.setAttribute('aSizeAlpha', new THREE.BufferAttribute(mistA, 2));
  const mistMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uMap: { value: tex }, uScale: { value: 1 } },
    vertexShader: `attribute vec2 aSizeAlpha; varying float vA; uniform float uScale;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = aSizeAlpha.y; gl_Position = projectionMatrix * mv;
        gl_PointSize = aSizeAlpha.x * projectionMatrix[1][1] * uScale / -mv.z; }`,
    fragmentShader: `uniform sampler2D uMap; varying float vA;
      void main() { vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(0.93, 0.96, 0.95), t.a * vA); }`,
  });
  const mist = new THREE.Points(mistGeo, mistMat);
  mist.frustumCulled = false;
  mist.onBeforeRender = (renderer) => {
    // point sizes are in pixels: scale by half the drawing buffer height
    mistMat.uniforms.uScale.value = renderer.getDrawingBufferSize(new THREE.Vector2()).y * 0.5;
  };
  group.add(mist);
  const foam = new THREE.Mesh(new THREE.CircleGeometry(widthBot * 0.85, 32), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: '#ffffff', opacity: 0.85 }));
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(base.x, opts.waterY + 0.03, base.z);
  group.add(foam);

  let t = 0;
  return {
    group,
    update(dt: number) {
      t += dt;
      seeds.forEach((u, i) => {
        const k = (u.phase + t * 0.12) % 1;
        mistPos.set([base.x + u.ox * (0.6 + k), opts.waterY + 0.3 + k * 3.2, base.z + u.oz + k * 0.8], i * 3);
        mistA.set([widthBot * (0.7 + k * 1.5), 0.32 * Math.sin(k * Math.PI)], i * 2);
      });
      mistGeo.attributes.position.needsUpdate = true;
      mistGeo.attributes.aSizeAlpha.needsUpdate = true;
    },
    dispose() {
      g.dispose();
      mat.dispose();
      foam.geometry.dispose();
      mistGeo.dispose();
      mistMat.dispose();
    },
  };
}
