import * as THREE from 'three';
import { MAX_RIFTS } from '../../era/EraSystem';
import { AO_FRAG, BLUR_FRAG, COMPOSITE_FRAG, DOWN_FRAG, FS_VERT, PREFILTER_FRAG, RAYS_FRAG, UP_FRAG } from './shaders';

/** The 8-bit palette (sRGB). Brand colours: burnt orange, cream, teal, cobalt, purple. */
export const PALETTE_8 = [
  '#0d0b1e', '#2b2d6e', '#3a5fcd', '#5ec8f0',
  '#b4eeff', '#2fd6c3', '#1f8a5a', '#4cc24a',
  '#a6e05a', '#fff4d6', '#ffcf6b', '#f0862a',
  '#b8461f', '#6b3a2a', '#8e5bd6', '#c9c3d8',
];

export type QualitySetting = 'auto' | 'high' | 'medium' | 'low';

/** Effect tiers for the modern generations. Pixel eras are cheap at every tier. */
const TIERS = [
  { scale: 0.6, ao: false, rays: false, dof: false, bloomLevels: 3 },
  { scale: 0.8, ao: false, rays: true, dof: true, bloomLevels: 4 },
  { scale: 1.0, ao: true, rays: true, dof: true, bloomLevels: 5 },
];

export interface PostFrame {
  eraFrom: number;
  eraTo: number;
  center: THREE.Vector3;
  radius: number;
  rippleActive: boolean;
  split: boolean;
  splitScreen: number[];
  rifts: THREE.Vector4[];
  riftEra: number[];
  fade: number;
  fadeColor: THREE.Color;
  shiftCenter: THREE.Vector2;
  shiftT: number;
  flash: number;
  time: number;
  focus: THREE.Vector3;
  /** 0..1 depth-of-field strength (Beyond). */
  dof: number;
  sunDir: THREE.Vector3;
  /** Highest generation that can appear on screen this frame (decides which passes run). */
  maxEra: number;
  bubble: THREE.Vector4;
  bubbleEra: number;
  fieldMin: THREE.Vector3[];
  fieldMax: THREE.Vector3[];
  fieldEra: number[];
}

const rt = (w: number, h: number, type: THREE.TextureDataType = THREE.HalfFloatType) => {
  const r = new THREE.WebGLRenderTarget(w, h, { type, depthBuffer: false });
  r.texture.minFilter = r.texture.magFilter = THREE.LinearFilter;
  r.texture.generateMipmaps = false;
  return r;
};

const fsMat = (frag: string, uniforms: Record<string, THREE.IUniform>) =>
  new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });

/**
 * Multi-pass post pipeline. The scene renders once into an HDR target with a depth texture;
 * AO, bloom and light shafts run only when modern generations are on screen; the composite
 * decides the generation per pixel and applies its treatment.
 */
export class PostPipeline {
  quality: QualitySetting = 'auto';
  tier = 2;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  sceneRT: THREE.WebGLRenderTarget;
  private aoRT = rt(4, 4, THREE.UnsignedByteType);
  private aoBlurRT = rt(4, 4, THREE.UnsignedByteType);
  private raysRT = rt(4, 4, THREE.UnsignedByteType);
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private aoMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private preMat: THREE.ShaderMaterial;
  private downMat: THREE.ShaderMaterial;
  private upMat: THREE.ShaderMaterial;
  private raysMat: THREE.ShaderMaterial;
  comp: THREE.ShaderMaterial;
  private size = new THREE.Vector2();
  private sceneSize = new THREE.Vector2();
  private black: THREE.DataTexture;
  private white: THREE.DataTexture;
  // auto quality
  private frameEma = 16;
  private overT = 0;
  private underT = 0;
  /** Exposed for the FPS readout / QA. */
  lastScale = 1;
  /** Current tier actually used (0 low … 2 high). */
  get activeTier() {
    return this.tier;
  }

  constructor() {
    this.sceneRT = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(4, 4),
      depthBuffer: true,
    });
    this.sceneRT.texture.minFilter = this.sceneRT.texture.magFilter = THREE.LinearFilter;
    this.sceneRT.depthTexture!.type = THREE.UnsignedIntType;
    for (let i = 0; i < 5; i++) {
      this.down.push(rt(4, 4));
      this.up.push(rt(4, 4));
    }
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.white.needsUpdate = true;
    const depth = { value: this.sceneRT.depthTexture };
    const inv = { value: new THREE.Matrix4() };
    const camWorld = { value: new THREE.Matrix4() };
    this.aoMat = fsMat(AO_FRAG, {
      tDepth: depth,
      uTexel: { value: new THREE.Vector2() },
      uProj: { value: new THREE.Matrix4() },
      uRadius: { value: 0.7 },
      uInvProj: inv,
      uCamWorld: camWorld,
    });
    this.blurMat = fsMat(BLUR_FRAG, { tInput: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.preMat = fsMat(PREFILTER_FRAG, {
      tInput: { value: this.sceneRT.texture },
      uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: 1.6 },
      uKnee: { value: 0.6 },
    });
    this.downMat = fsMat(DOWN_FRAG, { tInput: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upMat = fsMat(UP_FRAG, { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new THREE.Vector2() }, uScatter: { value: 0.7 } });
    this.raysMat = fsMat(RAYS_FRAG, { tDepth: depth, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 } });
    const pal = PALETTE_8.map((c) => new THREE.Color(c).convertLinearToSRGB());
    this.comp = fsMat(COMPOSITE_FRAG, {
      tColor: { value: this.sceneRT.texture },
      tDepth: depth,
      tAO: { value: this.white },
      tBloom: { value: this.black },
      tRays: { value: this.black },
      uRes: { value: new THREE.Vector2(1, 1) },
      uSceneRes: { value: new THREE.Vector2(1, 1) },
      uInvProj: inv,
      uCamWorld: camWorld,
      uEraFrom: { value: 0 },
      uEraTo: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uRadius: { value: 0 },
      uRippleActive: { value: 0 },
      uSplit: { value: 0 },
      uSplitScreen: { value: [0.17, 0.33, 0.5, 0.67, 0.83] },
      uRifts: { value: Array.from({ length: MAX_RIFTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uRiftEra: { value: [0, 0, 0, 0] },
      uPal: { value: pal },
      uFade: { value: 0 },
      uFadeColor: { value: new THREE.Color('#0d0b1e') },
      uShiftCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uShiftT: { value: 0 },
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uFocus: { value: new THREE.Vector3() },
      uFocusDist: { value: 10 },
      uDof: { value: 0 },
      uHasAO: { value: 0 },
      uHasBloom: { value: 0 },
      uHasRays: { value: 0 },
      uSunColor: { value: new THREE.Color(1.0, 0.86, 0.62) },
      uSkyRadius: { value: 150 },
      uBubble: { value: new THREE.Vector4() },
      uBubbleEra: { value: 0 },
      uFieldMin: { value: Array.from({ length: 4 }, () => new THREE.Vector3(0, -999, 0)) },
      uFieldMax: { value: Array.from({ length: 4 }, () => new THREE.Vector3(0, -999, 0)) },
      uFieldEra: { value: [0, 0, 0, 0] },

    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.comp);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setQuality(q: QualitySetting) {
    this.quality = q;
    if (q === 'high') this.tier = 2;
    if (q === 'medium') this.tier = 1;
    if (q === 'low') this.tier = 0;
  }

  /** Dynamic quality: only adapts while heavy (modern) generations are on screen. */
  private autoTune(dt: number, heavy: boolean) {
    if (this.quality !== 'auto' || !heavy || dt <= 0 || dt > 0.25) return;
    this.frameEma += (dt * 1000 - this.frameEma) * 0.05;
    if (this.frameEma > 21) {
      this.overT += dt;
      this.underT = 0;
    } else if (this.frameEma < 14.5) {
      this.underT += dt;
      this.overT = 0;
    } else {
      this.overT = this.underT = 0;
    }
    if (this.overT > 1.5 && this.tier > 0) {
      this.tier--;
      this.overT = 0;
    }
    if (this.underT > 6 && this.tier < 2) {
      this.tier++;
      this.underT = 0;
    }
  }

  private pass(gl: THREE.WebGLRenderer, mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat;
    gl.setRenderTarget(target);
    gl.render(this.scene, this.cam);
  }

  private resize(gl: THREE.WebGLRenderer, scale: number) {
    gl.getDrawingBufferSize(this.size);
    const w = Math.max(4, Math.round(this.size.x * scale));
    const h = Math.max(4, Math.round(this.size.y * scale));
    if (this.sceneRT.width !== w || this.sceneRT.height !== h) {
      this.sceneRT.setSize(w, h);
      const hw = Math.max(2, w >> 1);
      const hh = Math.max(2, h >> 1);
      this.aoRT.setSize(hw, hh);
      this.aoBlurRT.setSize(hw, hh);
      this.raysRT.setSize(Math.max(2, w >> 2), Math.max(2, h >> 2));
      for (let i = 0; i < 5; i++) {
        const lw = Math.max(2, w >> (i + 1));
        const lh = Math.max(2, h >> (i + 1));
        this.down[i].setSize(lw, lh);
        this.up[i].setSize(lw, lh);
      }
    }
    this.sceneSize.set(w, h);
  }

  render(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, f: PostFrame, dt: number) {
    const heavy = f.maxEra >= 4;
    this.autoTune(dt, heavy);
    const tier = TIERS[heavy ? this.tier : 2];
    const scale = heavy ? tier.scale : 1;
    this.lastScale = scale;
    this.resize(gl, scale);
    const u = this.comp.uniforms;
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);

    gl.setRenderTarget(this.sceneRT);
    gl.clear();
    gl.render(scene, camera);

    const beyond = f.maxEra >= 5;
    // --- AO (Beyond)
    const doAO = beyond && tier.ao;
    if (doAO) {
      this.aoMat.uniforms.uTexel.value.set(1 / this.sceneSize.x, 1 / this.sceneSize.y);
      this.aoMat.uniforms.uProj.value.copy(camera.projectionMatrix);
      this.pass(gl, this.aoMat, this.aoRT);
      this.blurMat.uniforms.tInput.value = this.aoRT.texture;
      this.blurMat.uniforms.uTexel.value.set(1 / this.aoRT.width, 1 / this.aoRT.height);
      this.pass(gl, this.blurMat, this.aoBlurRT);
    }
    // --- Bloom (Modern + Beyond)
    if (heavy) {
      const levels = tier.bloomLevels;
      this.preMat.uniforms.uTexel.value.set(1 / this.sceneSize.x, 1 / this.sceneSize.y);
      this.pass(gl, this.preMat, this.down[0]);
      for (let i = 1; i < levels; i++) {
        this.downMat.uniforms.tInput.value = this.down[i - 1].texture;
        this.downMat.uniforms.uTexel.value.set(1 / this.down[i - 1].width, 1 / this.down[i - 1].height);
        this.pass(gl, this.downMat, this.down[i]);
      }
      let low = this.down[levels - 1];
      for (let i = levels - 2; i >= 0; i--) {
        this.upMat.uniforms.tLow.value = low.texture;
        this.upMat.uniforms.tHigh.value = this.down[i].texture;
        this.upMat.uniforms.uTexel.value.set(1 / low.width, 1 / low.height);
        this.pass(gl, this.upMat, this.up[i]);
        low = this.up[i];
      }
      u.tBloom.value = low.texture;
    } else {
      u.tBloom.value = this.black;
    }
    // --- Light shafts (Beyond)
    let doRays = false;
    if (beyond && tier.rays) {
      const sp = camera.position.clone().addScaledVector(f.sunDir, 400).project(camera);
      const inFront = new THREE.Vector3().copy(f.sunDir).dot(camera.getWorldDirection(new THREE.Vector3())) > -0.1;
      if (inFront) {
        doRays = true;
        this.raysMat.uniforms.uSun.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
        this.raysMat.uniforms.uAspect.value = this.sceneSize.x / this.sceneSize.y;
        this.pass(gl, this.raysMat, this.raysRT);
      }
    }

    u.tAO.value = doAO ? this.aoBlurRT.texture : this.white;
    u.tRays.value = doRays ? this.raysRT.texture : this.black;
    u.uHasAO.value = doAO ? 1 : 0;
    u.uHasBloom.value = heavy ? 1 : 0;
    u.uHasRays.value = doRays ? 1 : 0;
    u.uRes.value.copy(this.size);
    u.uSceneRes.value.copy(this.sceneSize);
    u.uEraFrom.value = f.eraFrom;
    u.uEraTo.value = f.eraTo;
    u.uCenter.value.copy(f.center);
    u.uRadius.value = f.radius;
    u.uRippleActive.value = f.rippleActive ? 1 : 0;
    u.uSplit.value = f.split ? 1 : 0;
    (u.uSplitScreen.value as number[]).splice(0, 5, ...f.splitScreen);
    for (let i = 0; i < MAX_RIFTS; i++) {
      (u.uRifts.value as THREE.Vector4[])[i].copy(f.rifts[i] ?? new THREE.Vector4(0, 0, 0, 0));
      (u.uRiftEra.value as number[])[i] = f.riftEra[i] ?? 0;
    }
    u.uFade.value = f.fade;
    u.uFadeColor.value.copy(f.fadeColor);
    u.uShiftCenter.value.copy(f.shiftCenter);
    u.uShiftT.value = f.shiftT;
    u.uFlash.value = f.flash;
    u.uTime.value = f.time;
    u.uFocus.value.copy(f.focus);
    u.uFocusDist.value = camera.position.distanceTo(f.focus);
    u.uDof.value = tier.dof ? f.dof : 0;
    u.uBubble.value.copy(f.bubble);
    u.uBubbleEra.value = f.bubbleEra;
    for (let i = 0; i < 4; i++) {
      (u.uFieldMin.value as THREE.Vector3[])[i].copy(f.fieldMin[i]);
      (u.uFieldMax.value as THREE.Vector3[])[i].copy(f.fieldMax[i]);
      (u.uFieldEra.value as number[])[i] = f.fieldEra[i];
    }

    this.pass(gl, this.comp, null);
  }

  dispose() {
    this.sceneRT.depthTexture?.dispose();
    this.sceneRT.dispose();
    this.quad.geometry.dispose();
    this.aoRT.dispose();
    this.aoBlurRT.dispose();
    this.raysRT.dispose();
    for (const r of [...this.down, ...this.up]) r.dispose();
    for (const m of [this.aoMat, this.blurMat, this.preMat, this.downMat, this.upMat, this.raysMat, this.comp]) m.dispose();
    this.black.dispose();
    this.white.dispose();
  }
}
