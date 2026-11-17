import * as THREE from 'three';
import { session } from '../ui/session';
import { useUI } from '../ui/store';
import type { Era } from '../game/era/EraSystem';

/**
 * Dev-only: looks for holes in the world's ground. Renders the scene depth twice from the same camera, with no
 * bubble and then with a Regress bubble of `era` around Pip, drawing only the ground and structure (terrain,
 * level boxes, river): decoration, characters and effects are switched off for both, since they rightly change
 * with the generation. Any pixel in the bubble's screen circle that sees much farther with the bubble than
 * without it is a hole: something solid vanished and nothing took its place.
 *   await window.__holes(0)  →  { pixels, through, worst, circle } | { skip }
 * Used by e2e/holes.spec.ts.
 */
interface Dev {
  game?: import('../game/sim/Game').Game;
  view?: { camera: THREE.PerspectiveCamera; scene: THREE.Scene; post: { sceneRT: THREE.WebGLRenderTarget }; timeScale: number };
  gl?: THREE.WebGLRenderer;
}

let quad: { scene: THREE.Scene; cam: THREE.OrthographicCamera; mat: THREE.ShaderMaterial; rt: THREE.WebGLRenderTarget } | null = null;

/** The last frame's scene depth as view distance per pixel (1e6 where nothing was drawn). */
function readDepth(gl: THREE.WebGLRenderer, view: NonNullable<Dev['view']>) {
  const src = view.post.sceneRT;
  const w = src.width;
  const h = src.height;
  if (!quad) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null }, near: { value: 0.1 }, far: { value: 900 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tDepth; uniform float near; uniform float far; varying vec2 vUv;
        void main() {
          float d = texture2D(tDepth, vUv).r;
          gl_FragColor = vec4(d >= 0.99999 ? 1e6 : (near * far) / (far - d * (far - near)), 0.0, 0.0, 1.0);
        }`,
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    quad = { scene, cam: new THREE.OrthographicCamera(), mat, rt: new THREE.WebGLRenderTarget(4, 4, { type: THREE.FloatType }) };
  }
  quad.rt.setSize(w, h);
  quad.mat.uniforms.tDepth.value = src.depthTexture;
  quad.mat.uniforms.near.value = view.camera.near;
  quad.mat.uniforms.far.value = view.camera.far;
  const prev = gl.getRenderTarget();
  gl.setRenderTarget(quad.rt);
  gl.render(quad.scene, quad.cam);
  const buf = new Float32Array(w * h * 4);
  gl.readRenderTargetPixels(quad.rt, 0, 0, w, h, buf);
  gl.setRenderTarget(prev);
  return { buf, w, h };
}

/** Ground and structure: the terrain, the river, the level's boxes. Everything else is switched off. */
function isGround(m: THREE.Material) {
  const key = (m as THREE.MeshStandardMaterial).customProgramCacheKey?.() ?? '';
  return /terrain-splat|-st\b|-st[-|]|-st$|-rt|-hv/.test(key);
}

const frames = (n: number) => new Promise<void>((r) => {
  const step = () => (--n <= 0 ? r() : requestAnimationFrame(step));
  requestAnimationFrame(step);
});

export async function findHoles(era: Era, mask = false) {
  const dev = session as unknown as Dev;
  const g = dev.game!;
  const view = dev.view!;
  const gl = dev.gl!;
  // hold everything still and draw only the ground
  const scale = view.timeScale;
  const paused = useUI.getState().paused;
  view.timeScale = 0;
  // the camera must not move between the two pictures (the page's loop takes the pause from the UI each frame)
  useUI.getState().setPaused(true);
  const off: { m: THREE.Material; depthWrite: boolean; colorWrite: boolean }[] = [];
  view.scene.traverse((o) => {
    const mats = (o as THREE.Mesh).material;
    if (!mats) return;
    for (const m of Array.isArray(mats) ? mats : [mats]) {
      if (isGround(m) || off.some((x) => x.m === m)) continue;
      off.push({ m, depthWrite: m.depthWrite, colorWrite: m.colorWrite });
      m.depthWrite = false;
      m.colorWrite = false;
    }
  });
  try {
    g.applyRegress(null);
    await frames(3);
    const a = readDepth(gl, view);
    if (!g.applyRegress(era)) return { skip: 'bubble refused here' };
    await frames(3);
    const b = readDepth(gl, view);
    const bubble = g.era.bubble!;
    const cam = view.camera;
    const c = new THREE.Vector3(bubble.x, bubble.y, bubble.z).project(cam);
    const edge = new THREE.Vector3(bubble.x, bubble.y, bubble.z).add(new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).multiplyScalar(bubble.r)).project(cam);
    const cx = (c.x * 0.5 + 0.5) * a.w;
    const cy = (c.y * 0.5 + 0.5) * a.h;
    const rr = Math.hypot((edge.x - c.x) * 0.5 * a.w, (edge.y - c.y) * 0.5 * a.h);
    let pixels = 0;
    let through = 0;
    let worst = 0;
    // debug: every 4th pixel, 1 where the ground got deeper (for picturing where a failure is)
    const m: number[] = [];
    for (let y = 0; mask && y < a.h; y += 4) for (let x = 0; x < a.w; x += 4) m.push(b.buf[(y * a.w + x) * 4] - a.buf[(y * a.w + x) * 4] > 1 ? 1 : 0);
    for (let y = Math.max(0, Math.floor(cy - rr)); y < Math.min(a.h, cy + rr); y += 2)
      for (let x = Math.max(0, Math.floor(cx - rr)); x < Math.min(a.w, cx + rr); x += 2) {
        if (Math.hypot(x - cx, y - cy) > rr) continue;
        pixels++;
        // a hole is a patch, not an outline: the pixel and its neighbours (3 px away) must all have got deeper,
        // so sub-pixel differences between the two frames along silhouettes don't count
        const gainAt = (px: number, py: number) => {
          if (px < 0 || py < 0 || px >= a.w || py >= a.h) return 0;
          const i = (py * a.w + px) * 4;
          return b.buf[i] - a.buf[i];
        };
        const gain = Math.min(gainAt(x, y), gainAt(x - 3, y), gainAt(x + 3, y), gainAt(x, y - 3), gainAt(x, y + 3));
        if (gain > 1) {
          through++;
          worst = Math.max(worst, Math.min(gain, 1e6));
        }
      }
    return { pixels, through, worst: +worst.toFixed(1), circle: { cx: Math.round(cx), cy: Math.round(cy), r: Math.round(rr) }, ...(mask ? { mask: { w: Math.ceil(a.w / 4), h: Math.ceil(a.h / 4), m } } : {}) };
  } finally {
    for (const x of off) {
      x.m.depthWrite = x.depthWrite;
      x.m.colorWrite = x.colorWrite;
    }
    view.timeScale = scale;
    useUI.getState().setPaused(paused);
  }
}

declare global {
  interface Window {
    __holes?: typeof findHoles;
  }
}
window.__holes = findHoles;
