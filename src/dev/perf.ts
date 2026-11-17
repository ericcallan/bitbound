import { session } from '../ui/session';

/**
 * Dev-only GPU timing (EXT_disjoint_timer_query_webgl2 around the whole frame: scene and every post pass).
 *   await window.__perf(3)  →  { gpuMean, gpuP95, frameMean, calls, triangles, samples, buffer }
 * The same method as the Phase 6 measurements in docs/GRAPHICS_REPORT.md.
 */
interface Dev {
  view?: { render: (gl: WebGLRenderer) => void };
  gl?: WebGLRenderer;
}
type WebGLRenderer = import('three').WebGLRenderer;

export async function measure(seconds = 3) {
  const dev = session as unknown as Dev;
  const view = dev.view!;
  const gl = dev.gl!;
  const ctx = gl.getContext() as WebGL2RenderingContext;
  const ext = ctx.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) throw new Error('no timer query');
  const pending: WebGLQuery[] = [];
  const gpu: number[] = [];
  const frames: number[] = [];
  let calls = 0;
  let tris = 0;
  let n = 0;
  const orig = view.render.bind(view);
  view.render = (r: WebGLRenderer) => {
    const q = ctx.createQuery()!;
    gl.info.autoReset = false;
    gl.info.reset();
    ctx.beginQuery(ext.TIME_ELAPSED_EXT, q);
    orig(r);
    ctx.endQuery(ext.TIME_ELAPSED_EXT);
    calls += gl.info.render.calls;
    tris += gl.info.render.triangles;
    n++;
    pending.push(q);
    while (pending.length && ctx.getQueryParameter(pending[0], ctx.QUERY_RESULT_AVAILABLE)) {
      const done = pending.shift()!;
      if (!ctx.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(ctx.getQueryParameter(done, ctx.QUERY_RESULT) / 1e6);
      ctx.deleteQuery(done);
    }
  };
  let last = performance.now();
  const end = last + seconds * 1000;
  await new Promise<void>((resolve) => {
    const tick = () => {
      const now = performance.now();
      frames.push(now - last);
      last = now;
      if (now < end) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  view.render = orig;
  gl.info.autoReset = true;
  const sorted = [...gpu].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
  const buf = gl.getDrawingBufferSize(new (await import('three')).Vector2());
  return {
    gpuMean: +mean(gpu).toFixed(2),
    gpuP95: +p95.toFixed(2),
    frameMean: +mean(frames.slice(5)).toFixed(2),
    calls: Math.round(calls / Math.max(1, n)),
    triangles: +(tris / Math.max(1, n) / 1e6).toFixed(2),
    samples: gpu.length,
    buffer: `${buf.x}x${buf.y}`,
  };
}

declare global {
  interface Window {
    __perf?: typeof measure;
  }
}
window.__perf = measure;
