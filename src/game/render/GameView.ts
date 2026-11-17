import * as THREE from 'three';
import { eraUniforms } from './eraMaterial';
import { LevelView, SKY_FRAG, SKY_SUN, SKY_VERT } from './LevelView';
import { EntityViews } from './EntityViews';
import { Particles } from './Particles';
import { PostPipeline, type PostFrame, type QualitySetting } from './post/Pipeline';
import { PixelSprite } from './sprites';
import { TerrainView } from './terrain';
import { TitleSet } from './titleSet';
import { AqueductView } from './aqueduct';
import { TITLE } from '../level/title';
import { loadHdSky, type HdSkyData, type SkyName } from './sky';
import { initTextures } from './textures';
import { RETRO_ROWS, RetroLayer, TILE_PX } from './retro/RetroLayer';
import { Sprite16 } from './retro/sprites16';
import { RETRO16_ROWS, RetroLayer16, TILE16_PX } from './retro/RetroLayer16';
import { SHADOW_PROXY_LAYER, ValleyDressing } from './dressing';
import { PipModel } from '../pip/PipModel';
import { PipGLB } from '../pip/PipGLB';
import type { Game, GameEvent } from '../sim/Game';
import { MAX_RIFTS, type Era } from '../era/EraSystem';
import { segmentHitsBox } from '../collision/World';
import { STAIR, stairStep } from '../level/meadows';
import { clamp, lerp, rng, smoothstep } from '../math';

/** Direction toward the key light used for shading (front-lit so the 2D lane always reads). */
const SUN_DIR = new THREE.Vector3(-0.45, 0.85, 0.55).normalize();
const UP = new THREE.Vector3(0, 1, 0);
const SPLIT_SCREEN = [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6];

export interface ViewOptions {
  /** Menu/gallery: split the screen into six generation bands. */
  split?: boolean;
  /** With `split`: show the immersive valley (terrain, Blender dressing) in its bands, as in play. */
  immersive?: boolean;
  /** The main menu: draw the composed title set (render/titleSet.ts) instead of the level. */
  title?: boolean;
}

const envCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

/** Image-based lighting: a PMREM of the procedural sky over a green ground bounce. */
function skyEnvironment(gl: THREE.WebGLRenderer) {
  const cached = envCache.get(gl);
  if (cached) return cached;
  const pmrem = new THREE.PMREMGenerator(gl);
  const s = new THREE.Scene();
  s.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color('#3b7be0') },
          uHorizon: { value: new THREE.Color('#d6f0ff') },
          uBottom: { value: new THREE.Color('#4c8a4a') },
          uSunDir: { value: SUN_DIR.clone() },
          uDim: { value: 1.2 },
        },
      }),
    ),
  );
  const tex = pmrem.fromScene(s, 0.03).texture;
  pmrem.dispose();
  envCache.set(gl, tex);
  return tex;
}

interface Pulse {
  mesh: THREE.Mesh;
  t: number;
  grow: number;
}

/** Owns the Three.js scene for one Game and renders it through the generation pipeline. */
export class GameView {
  scene = new THREE.Scene();
  level: LevelView;
  entities: EntityViews;
  pip = new PipModel();
  /** The immersive valley (Blender terrain) the level sits in. */
  terrain = new TerrainView();
  title: TitleSet | null = null;
  aqueduct: AqueductView | null = null;
  /** Extra sky rotation (radians about +y): the title set's lighting angle. */
  skyYaw = 0;
  /** Forest, grass, flowers and rocks scattered over the valley (Modern HD and Beyond). */
  dressing = new ValleyDressing();
  /** The Blender-built Pip, used from Modern HD on once its asset has loaded. */
  pipHD = new PipGLB();
  pipSprite = new PixelSprite('pip', 1, 1);
  /** 16-bit Pip in 2D: pre-rendered from the Blender model. */
  pipSprite16 = new Sprite16('pip_idle');
  particles = new Particles();
  post = new PostPipeline();
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private chamberLight: THREE.PointLight;
  private dayEnv: THREE.Texture;
  /** The real (HDRI) sky for the modern generations, once loaded. */
  private hdSkies: Partial<Record<SkyName, HdSkyData>> = {};
  /** The real sky in use this frame (null: the older generations' procedural sky). */
  private hdSky: HdSkyData | null = null;
  private hdActive = false;
  /** Dev scenarios: 0 freezes wind, water and other animation for reproducible screenshots. */
  timeScale = 1;
  /** 0..1: how far the camera focus is inside the hidden chamber. */
  private indoor = 0;
  /** The 8-bit tile renderer (2D only). */
  private retro: RetroLayer;
  /** 0..1: how far the 2D camera is locked to whole 8-bit pixels. */
  private retroCamW = 0;
  /** Screen pixels per retro pixel while the camera is locked, the frame's rows, and which frame. */
  private retroK = 1;
  private retroRows = 240;
  private retroMode: 8 | 16 = 8;
  /** Visible lane height (world units) of the locked retro frame, eased between modes. */
  private retroViewH = 0;
  /** The 16-bit tile renderer and parallax (2D only). */
  private retro16: RetroLayer16;
  private gl: THREE.WebGLRenderer;
  private blob: THREE.Mesh;
  private motes: THREE.InstancedMesh;
  private moteSeeds: Float32Array;
  private moteFade = 0;
  private pulses: Pulse[] = [];
  private t = 0;
  private flash = 0;
  private unsub: () => void;
  private tmp = new THREE.Vector3();
  options: ViewOptions;
  /** World x thresholds of the six split bands (menu/gallery). */
  splitWorldX: number[] = [0, 0, 0, 0, 0];
  /** Gallery: override the screen fractions of the split. */
  splitScreen: number[] = [...SPLIT_SCREEN];
  /** Gallery: keep world thresholds fixed instead of deriving them from the screen. */
  fixedSplit = false;
  private frame: PostFrame = {
    eraFrom: 0,
    eraTo: 0,
    center: new THREE.Vector3(),
    radius: 0,
    rippleActive: false,
    split: false,
    splitScreen: [...SPLIT_SCREEN],
    rifts: Array.from({ length: MAX_RIFTS }, () => new THREE.Vector4()),
    riftEra: [0, 0, 0, 0],
    fade: 0,
    fadeColor: new THREE.Color('#0d0b1e'),
    shiftCenter: new THREE.Vector2(0.5, 0.5),
    shiftT: 0,
    flash: 0,
    time: 0,
    focus: new THREE.Vector3(),
    dof: 0,
    sunDir: SKY_SUN.clone(),
    maxEra: 0,
    bubble: new THREE.Vector4(),
    bubbleEra: 0,
    fieldMin: Array.from({ length: 4 }, () => new THREE.Vector3(0, -999, 0)),
    fieldMax: Array.from({ length: 4 }, () => new THREE.Vector3(0, -999, 0)),
    fieldEra: [0, 0, 0, 0],
    retro: null,
    retro2D: false,
    laneZ: 0,
    letterbox: 0,
    retroK: 1,
    letterboxRows: 240,
    retro16: null,
    camXY: new THREE.Vector2(),
  };
  private lastDt = 1 / 60;

  /** Era at a world point; in split mode decided by world x bands instead of the ripple. */
  eraAt = (p: THREE.Vector3): Era => {
    if (this.options.split) {
      let e = 0;
      for (const x of this.splitWorldX) if (p.x >= x) e++;
      return e as Era;
    }
    return this.game.era.eraAt(p);
  };
  /** Prop swaps follow the base generation; rifts devolve them per pixel in the shaders instead. */
  private swapEraAt = (p: THREE.Vector3): Era => (this.options.split ? this.eraAt(p) : this.game.era.baseEraAt(p));

  constructor(
    public game: Game,
    public camera: THREE.PerspectiveCamera,
    gl: THREE.WebGLRenderer,
    options: ViewOptions = {},
  ) {
    this.options = options;
    this.gl = gl;
    initTextures(gl);
    this.retro = new RetroLayer(game.level);
    this.retro16 = new RetroLayer16(game.level);
    this.level = new LevelView(game.level);
    this.entities = new EntityViews(game, this.level.eras);
    this.scene.add(this.level.group, this.entities.group, this.terrain.group, this.dressing.group);
    if (!this.options.title && !this.options.split) {
      const box = (id: string) => {
        const c = game.world.get(id)!;
        return new THREE.Box3(new THREE.Vector3(c.min.x, c.min.y, c.min.z), new THREE.Vector3(c.max.x, c.max.y, c.max.z));
      };
      this.aqueduct = new AqueductView({ aqA: box('aqA'), aqB: box('aqB') });
      this.scene.add(this.aqueduct.group);
    }
    if (this.options.title) {
      this.skyYaw = TITLE.skyYaw;
      this.title = new TitleSet();
      this.scene.add(this.title.group);
      // the older generations' sky dome comes along to the title set (the rest of the level stays hidden)
      this.scene.add(this.level.skyMesh);
      this.level.skyMesh.position.set(TITLE.origin.x, 0, TITLE.origin.z);
    }
    this.scene.add(this.pip.root, this.pip.trail, this.pipHD.root, this.pipSprite.sprite, this.pipSprite16.sprite, this.particles.mesh);
    this.scene.fog = new THREE.Fog('#bfe3ff', 90, 380);
    this.dayEnv = skyEnvironment(gl);
    this.scene.environment = this.dayEnv;
    for (const n of ['day', 'golden'] as const) void loadHdSky(gl, n).then((d) => (this.hdSkies[n] = d));
    this.scene.environmentIntensity = 0.55;

    this.hemi = new THREE.HemisphereLight('#cfeeff', '#6c8a4a', 0.85);
    this.sun = new THREE.DirectionalLight('#fff0d8', 2.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -18;
    sc.right = sc.top = 18;
    sc.near = 1;
    sc.far = 90;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    // The shadow camera also sees the dressing's low-detail stand-in casters.
    this.sun.shadow.camera.layers.enable(SHADOW_PROXY_LAYER);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.chamberLight = new THREE.PointLight('#4ff5e6', 6, 14, 1.6);
    this.chamberLight.position.set(57, 2.6, -7.5);
    this.scene.add(this.chamberLight);
    // The hidden chamber's broken roof, seen only by the sun's shadow camera: daylight falls in as shafts
    // through the gaps while the 3D camera still looks in from above.
    const L = game.level.chamber;
    const roof = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const r = rng(57);
    for (let x = L.min.x - 0.6; x < L.max.x + 0.6; ) {
      const w = 1.2 + r() * 1.6;
      const gap = 0.35 + r() * 0.6;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, L.max.z - L.min.z + 1.6), roof);
      slab.position.set(x + w / 2, L.max.y + 0.6 + r() * 0.3, (L.min.z + L.max.z) / 2 + (r() - 0.5) * 0.8);
      slab.rotation.y = (r() - 0.5) * 0.12;
      slab.castShadow = true;
      slab.layers.set(SHADOW_PROXY_LAYER);
      this.scene.add(slab);
      x += w + gap;
    }

    // Early 3D has no shadow maps: a classic blob shadow keeps Pip grounded.
    this.blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.36, 20),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 2;
    this.scene.add(this.blob);

    // Beyond: drifting motes of light around the camera focus.
    const N = 160;
    this.motes = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.03, 0),
      new THREE.MeshBasicMaterial({ color: '#fff1c8', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      N,
    );
    this.motes.frustumCulled = false;
    this.moteSeeds = new Float32Array(N * 4).map(() => Math.random());
    this.scene.add(this.motes);
    // Beyond: footstep glyph pulses
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 0.25, 40),
        new THREE.MeshBasicMaterial({ color: '#6ff6ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.scene.add(m);
      this.pulses.push({ mesh: m, t: 1, grow: 7 });
    }

    this.entities.onPlankLand = (p) => {
      this.particles.burst(p, { count: 10, colors: ['#ffd36b', '#6ff6ff', '#fff4d6'], speed: 3, up: 3, size: 0.08, life: 0.6 });
    };
    this.unsub = game.on((e) => this.onEvent(e));
    this.level.eras.update(this.swapEraAt, 0, true);
  }

  setQuality(q: QualitySetting) {
    this.post.setQuality(q);
  }

  dispose() {
    this.unsub();
    this.level.dispose();
    this.terrain.dispose();
    this.title?.dispose();
    this.aqueduct?.dispose();
    this.post.dispose();
    this.retro.dispose();
    this.retro16.dispose();
    this.pip.dispose();
    this.pipHD.dispose();
    this.pipSprite.dispose();
    this.pipSprite16.dispose();
    this.sun.dispose();
    this.chamberLight.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }

  private pulse(x: number, y: number, z: number, color = '#6ff6ff', grow = 7, flat = true) {
    const p = this.pulses.find((q) => q.t >= 1) ?? this.pulses[0];
    p.t = 0;
    p.grow = grow;
    p.mesh.position.set(x, y + 0.03, z);
    p.mesh.rotation.set(flat ? -Math.PI / 2 : 0, 0, 0);
    if (!flat) p.mesh.lookAt(this.camera.position);
    (p.mesh.material as THREE.MeshBasicMaterial).color.set(color);
    p.mesh.visible = true;
  }

  private onEvent(e: GameEvent) {
    const P = this.particles;
    const p = e.pos;
    if (!p) {
      if (e.type === 'finale') this.flash = 0.4;
      return;
    }
    const dust = ['#fff4d6', '#e8d6b0', '#c9c3d8'];
    const era = this.game.era.eraAt(p);
    // The first generation is spare: nothing beyond a tiny 4-pixel puff.
    if (era === 0 && !['jump', 'land', 'stomp', 'collect', 'combat', 'bubbleOn', 'bubbleOff', 'bubblePop'].includes(e.type)) return;
    const retro = era === 0;
    const beyond = era === 5;
    switch (e.type) {
      case 'jump':
        P.burst(p, { count: retro ? 2 : 6, colors: dust, speed: 1.6, up: 0.6, size: retro ? 0.12 : 0.07, life: 0.3, gravity: 2, flat: true });
        break;
      case 'land': {
        const k = clamp((e.value ?? 0) / 20, 0.2, 1);
        P.burst(p, { count: retro ? 2 : Math.round(6 + k * 10), colors: dust, speed: 2.5 * k + 0.8, up: 0.4, size: retro ? 0.12 : 0.08, life: 0.35, gravity: 2, flat: true });
        if (beyond) this.pulse(p.x, p.y, p.z);
        break;
      }
      case 'step':
        P.burst(p, { count: 2, colors: dust, speed: 0.6, up: 0.4, size: 0.05, life: 0.3, gravity: 1, flat: true });
        if (beyond) this.pulse(p.x, p.y, p.z);
        break;
      case 'collect':
        P.burst(p, { count: retro ? 4 : 14, colors: ['#6ff6ff', '#ffd36b', '#fff4d6'], speed: 3.5, up: 2.5, size: retro ? 0.12 : 0.08, life: 0.5, gravity: 4 });
        break;
      case 'stomp':
        P.burst({ x: p.x, y: p.y + 0.3, z: p.z }, { count: retro ? 4 : 22, colors: ['#ff4fd8', '#2fd6c3', '#2b2d6e', '#ffffff'], speed: 4.5, up: 3, size: retro ? 0.14 : 0.11, life: 0.5 });
        break;
      case 'hurt':
        P.burst({ x: p.x, y: p.y + 0.5, z: p.z }, { count: 14, colors: ['#ff6b6b', '#ffcf6b'], speed: 4, up: 2, size: 0.08, life: 0.5 });
        break;
      case 'bubbleOn':
      case 'bubbleOff':
      case 'bubblePop':
        this.flash = Math.max(this.flash, 0.18);
        this.pulse(p.x, p.y + 0.45, p.z, e.type === 'bubbleOn' ? '#b388ff' : '#6ff6ff', 9, false);
        P.burst({ x: p.x, y: p.y + 0.8, z: p.z }, { count: 30, colors: ['#b388ff', '#6ff6ff', '#ffffff'], speed: 5, up: 0.5, size: 0.07, life: 0.6, gravity: 0, drag: 2 });
        break;
      case 'glyphs':
        P.burst({ x: p.x, y: p.y + 1.4, z: p.z }, { count: 40, colors: ['#6ff6ff', '#fff4d6', '#ffd36b'], speed: 2.5, up: 1.5, size: 0.06, life: 1.2, gravity: 0, drag: 1.2 });
        this.flash = Math.max(this.flash, 0.25);
        break;
      case 'wheel':
        this.flash = 0.6;
        P.burst({ x: p.x, y: p.y + 3, z: p.z }, { count: 160, colors: ['#f0862a', '#ffcf6b', '#5ec8f0', '#ff8fb8', '#6ff6ff', '#b388ff'], speed: 9, up: 2, size: 0.12, life: 2.2, gravity: 0, drag: 0.8 });
        break;
      case 'shiftHint':
        // where unfolding works: a ring of light on the ground and a short fountain of sparks
        this.pulse(p.x, p.y + 0.05, p.z, '#6ff6ff', 3.2, true);
        P.burst({ x: p.x, y: p.y + 0.2, z: p.z }, { count: 26, colors: ['#6ff6ff', '#2fd6c3', '#ffffff'], speed: 1.6, up: 3.2, size: 0.07, life: 1.1, gravity: 1.5, drag: 0.6 });
        break;
      case 'fizzle':
        P.burst({ x: p.x, y: p.y + 0.6, z: p.z }, { count: 10, colors: ['#8e5bd6', '#6b6b8a'], speed: 1.8, up: 1.5, size: 0.06, life: 0.5, gravity: 3 });
        break;
      case 'antenna':
        P.burst({ x: p.x, y: p.y + 1.1, z: p.z }, { count: 6, colors: ['#6ff6ff', '#ffffff'], speed: 2, up: 2, size: 0.05, life: 0.3 });
        break;
      case 'shiftStart':
        this.flash = 0.25;
        P.burst({ x: p.x, y: p.y + 0.45, z: p.z }, { count: 40, colors: ['#2fd6c3', '#6ff6ff', '#8e5bd6', '#fff4d6'], speed: 6, up: 0.5, size: 0.08, life: 0.9, gravity: 0, drag: 2.5, flat: true });
        break;
      case 'eraStart':
        this.flash = 0.55;
        break;
      case 'shard':
        P.burst(p, { count: 60, colors: ['#fff4d6', '#ffd36b', '#6ff6ff', '#8e5bd6'], speed: 7, up: 2, size: 0.1, life: 1.1, gravity: 2 });
        break;
      case 'device':
        P.converge({ x: this.game.player.pos.x, y: this.game.player.pos.y + 0.4, z: this.game.player.pos.z }, 2.5, { count: 50, colors: ['#2fd6c3', '#6ff6ff', '#ffffff'], size: 0.07, life: 0.8 });
        this.flash = 0.3;
        break;
      case 'assemble':
        P.converge({ x: p.x, y: p.y + 0.45, z: p.z }, 2.2, { count: 70, colors: ['#f0862a', '#fff4d6', '#3a5fcd', '#2fd6c3', '#8e5bd6'], size: 0.08, life: 0.9 });
        break;
      case 'pixelBlink':
        P.burst({ x: p.x, y: p.y + 0.45, z: p.z }, { count: 6, colors: ['#b4fff6'], speed: 1, up: 0.5, size: 0.05, life: 0.4, gravity: 0 });
        break;
      case 'awake':
        P.burst({ x: p.x, y: p.y + 1.0, z: p.z }, { count: 12, colors: ['#ffd36b', '#fff4d6'], speed: 2, up: 3, size: 0.07, life: 0.7 });
        break;
      case 'fistpump':
        P.burst({ x: p.x, y: p.y + 1.1, z: p.z }, { count: 8, colors: ['#ffd36b', '#6ff6ff'], speed: 2, up: 3, size: 0.06, life: 0.5 });
        break;
      case 'stumble':
        P.burst(p, { count: 5, colors: dust, speed: 1.4, up: 0.8, size: 0.06, life: 0.35, flat: true });
        break;
      case 'pushStart':
        P.burst(p, { count: 4, colors: dust, speed: 1, up: 0.5, size: 0.06, life: 0.4, flat: true });
        break;
      case 'plate':
        P.burst(p, { count: 30, colors: ['#2fd6c3', '#6ff6ff', '#c9c3d8'], speed: 3, up: 1, size: 0.08, life: 0.8, flat: true });
        break;
      case 'lamp':
        P.burst({ x: p.x, y: 1.2, z: p.z }, { count: 36, colors: ['#ffd36b', '#fff4d6', '#f0862a'], speed: 3.5, up: 2, size: 0.08, life: 0.9 });
        this.flash = 0.2;
        break;
      case 'stairDone':
        for (const i of STAIR.missing) {
          const s = stairStep(i);
          P.burst({ x: (s.x0 + s.x1) / 2, y: s.top, z: STAIR.wall.z1 + 0.2 }, { count: 24, colors: ['#ffcf6b', '#f0862a', '#fff4d6'], speed: 3, up: 2, size: 0.08, life: 0.8 });
        }
        break;
      case 'gate':
        P.burst({ x: p.x, y: p.y + 2.1, z: -0.9 }, { count: 80, colors: ['#6ff6ff', '#8e5bd6', '#ffcf6b', '#ffffff'], speed: 7, up: 2, size: 0.1, life: 1.4, gravity: 0, drag: 1.5 });
        this.flash = 0.6;
        break;
      case 'bridgeDone':
        P.burst({ x: 67, y: 0.4, z: 0 }, { count: 60, colors: ['#ffd36b', '#6ff6ff', '#fff4d6'], speed: 6, up: 4, size: 0.1, life: 1.0, radius: 3 });
        break;
      case 'cubeReset':
        P.burst({ x: p.x, y: 0.6, z: p.z }, { count: 30, colors: ['#b388ff', '#8e5bd6', '#ffffff'], speed: 3, up: 2, size: 0.08, life: 0.6 });
        break;
      case 'checkpoint':
        P.burst({ x: p.x, y: p.y + 1.2, z: e.text === 'beacon' ? -1.6 : 1.6 }, { count: 50, colors: ['#ffd36b', '#6ff6ff', '#ff8fb8', '#8e5bd6', '#fff4d6'], speed: 5, up: 6, size: 0.1, life: 1.4, gravity: 6 });
        break;
      case 'respawn':
        P.converge({ x: p.x, y: p.y + 0.45, z: p.z }, 1.6, { count: 30, colors: ['#2fd6c3', '#fff4d6'], size: 0.06, life: 0.5 });
        break;
    }
  }

  /** In split mode, place the world-space band edges under the screen-space ones (lane plane z = 0). */
  private updateSplit(cam: THREE.PerspectiveCamera, targetY: number) {
    if (this.fixedSplit) return;
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hit = new THREE.Vector3();
    for (let i = 0; i < 5; i++) {
      const sx = this.splitScreen[i] * 2 - 1;
      const sy = new THREE.Vector3(0, targetY, 0).project(cam).y;
      ray.setFromCamera(new THREE.Vector2(sx, sy), cam);
      if (ray.ray.intersectPlane(plane, hit)) this.splitWorldX[i] = hit.x;
    }
  }

  /**
   * 8-bit in 2D is drawn one world pixel (1/16 unit) at a time by the tile layer. While 8-bit can be on
   * screen, the 2D camera looks straight down the lane, sits on whole pixels and frames a whole number of
   * screen pixels per 8-bit pixel, so the grid never swims or stretches (eased, so other generations keep
   * their framing). Returns whether the view is fully 2D, i.e. whether the tile layer applies.
   */
  private lockRetroCamera(cam: THREE.PerspectiveCamera, target: THREE.Vector3, dt: number): boolean {
    const g = this.game;
    // Fully 2D and side-on (posed cameras count too, e.g. the gallery; cinematic close-ups do not).
    const sideOn = g.camera.overrideW < 0.001 || (Math.abs(g.camera.yaw) < 1e-3 && g.camera.fov < 20);
    const flat = !this.options.split && g.shift.mode === '2d' && !g.shift.transition && sideOn;
    eraUniforms.uRetro2D.value = flat ? 1 : 0;
    // Which retro frame the camera locks to: the world's generation (and a ripple's), not bubbles or fields.
    const tr = g.era.transition;
    const shows = (e: number) => (tr ? tr.from === e || tr.to === e : g.era.era === e);
    const mode = !flat ? null : shows(0) ? 8 : shows(1) ? 16 : null;
    this.retroCamW = mode ? Math.min(1, this.retroCamW + dt * 1.5) : Math.max(0, this.retroCamW - dt * 1.5);
    if (!flat) this.retroCamW = 0;
    if (mode) this.retroMode = mode;
    if (this.retroCamW <= 0) return flat;
    const w = smoothstep(0, 1, this.retroCamW);
    const laneZ = g.shift.laneZ;
    const dist = cam.position.distanceTo(target);
    const buf = this.gl.getDrawingBufferSize(new THREE.Vector2());
    const H = buf.y;
    // 8-bit: exactly 240 rows at 16 px per unit (a 1985 frame). 16-bit: 224 rows at 24 px per unit. Each
    // retro pixel is a whole number (k) of screen pixels; letterbox bars fill what's left.
    const ppu = this.retroMode === 8 ? TILE_PX : TILE16_PX;
    const rows = this.retroMode === 8 ? RETRO_ROWS : RETRO16_ROWS;
    const k = Math.max(1, Math.floor(H / rows));
    this.retroK = k;
    this.retroRows = rows;
    // The visible height eases between the two frames, so the 8-bit → 16-bit upgrade is a camera pull-in.
    const wantH = H / (ppu * k);
    this.retroViewH = this.retroViewH > 0 ? this.retroViewH + (wantH - this.retroViewH) * Math.min(1, dt * 2.5) : wantH;
    const settled = Math.abs(this.retroViewH - wantH) < 1e-3;
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(this.retroViewH / (2 * dist)));
    const snap = (v: number) => (settled ? Math.round(v * ppu) / ppu : v);
    // With an odd buffer size the screen centre sits on a half pixel: shift half a screen pixel so retro pixel
    // edges fall between screen pixels, not on their centres.
    const half = settled ? 0.5 / (ppu * k) : 0;
    const look = new THREE.Vector3(snap(target.x) + (buf.x % 2) * half, snap(target.y) + (buf.y % 2) * half, laneZ);
    target.lerp(look, w);
    cam.position.lerp(new THREE.Vector3(look.x, look.y, laneZ + dist), w);
    cam.fov += (fov - cam.fov) * w;
    cam.lookAt(target);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    return flat;
  }

  update(dt: number) {
    const g = this.game;
    this.t += dt * this.timeScale;
    this.lastDt = dt;
    const t = this.t;
    const a = g.alpha;
    const split = !!this.options.split;

    // --- camera (interpolated between fixed steps)
    const c = g.camera;
    const cam = this.camera;
    cam.position.set(lerp(c.prevPos.x, c.pos.x, a), lerp(c.prevPos.y, c.pos.y, a), lerp(c.prevPos.z, c.pos.z, a));
    this.tmp.set(lerp(c.prevTarget.x, c.target.x, a), lerp(c.prevTarget.y, c.target.y, a), lerp(c.prevTarget.z, c.target.z, a));
    cam.lookAt(this.tmp);
    cam.fov = lerp(c.prevFov, c.fov, a);
    // the near plane follows a pulled-in chase camera, so Pip is never cut open when it comes close
    cam.near = clamp(cam.position.distanceTo(this.tmp) * 0.22, 0.06, 0.3);
    cam.far = 900;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const camTarget = this.tmp.clone();
    if (split) this.updateSplit(cam, camTarget.y);
    const retro2D = this.lockRetroCamera(cam, camTarget, dt);

    // --- era uniforms
    const tr = g.era.transition;
    eraUniforms.uEraFrom.value = tr ? tr.from : g.era.era;
    eraUniforms.uEraTo.value = tr ? tr.to : g.era.era;
    eraUniforms.uRippleRadius.value = tr ? g.era.radius : 0;
    if (tr) eraUniforms.uRippleCenter.value.set(tr.center.x, tr.center.y, tr.center.z);
    eraUniforms.uSplit.value = split ? 1 : 0;
    eraUniforms.uSplitX.value.splice(0, 5, ...this.splitWorldX);
    for (let i = 0; i < MAX_RIFTS; i++) {
      const r = split ? undefined : g.era.rifts[i];
      eraUniforms.uRifts.value[i].set(r?.x ?? 0, r?.y ?? -999, r?.z ?? 0, r?.r ?? 0);
      eraUniforms.uRiftEra.value[i] = r?.era ?? 0;
    }
    const bub = split ? null : g.era.bubble;
    eraUniforms.uBubble.value.set(bub?.x ?? 0, bub?.y ?? -999, bub?.z ?? 0, bub?.r ?? 0);
    eraUniforms.uBubbleEra.value = bub?.era ?? 0;
    for (let i = 0; i < 4; i++) {
      const f = split ? undefined : g.era.fields[i];
      eraUniforms.uFieldMin.value[i].set(f?.min.x ?? 0, f?.min.y ?? -999, f?.min.z ?? 0);
      eraUniforms.uFieldMax.value[i].set(f?.max.x ?? 0, f?.max.y ?? -999, f?.max.z ?? 0);
      eraUniforms.uFieldEra.value[i] = f?.era ?? 0;
    }
    eraUniforms.uTime.value = t;
    // The gallery's split view shows the original level; the menu shows the valley as it is in play.
    if (split && !this.options.immersive) eraUniforms.uValleyX.value = -1e9;
    else this.terrain.update();

    // --- lights follow the action. From Modern HD up the real sky lights the scene and sets the sun.
    const lookEra = split ? 4 : this.eraAt(camTarget);
    // Modern HD: late-afternoon daylight. Beyond: a low golden sun behind the valley.
    this.hdSky = split || lookEra < 4 ? null : (this.hdSkies[lookEra === 5 ? 'golden' : 'day'] ?? this.hdSkies.day ?? null);
    const hd = !!this.hdSky;
    this.hdActive = hd;
    this.scene.environment = hd ? this.hdSky!.env : this.dayEnv;
    this.scene.background = hd ? this.hdSky!.background : null;
    if (hd) {
      this.scene.environmentRotation.copy(this.hdSky!.rotation);
      this.scene.backgroundRotation.copy(this.hdSky!.rotation);
      // the title set turns the sky so the low sun rakes across its cliffs from the front left
      this.scene.environmentRotation.y += this.skyYaw;
      this.scene.backgroundRotation.y += this.skyYaw;
    } else {
      this.scene.environmentRotation.set(0, 0, 0);
      this.scene.backgroundRotation.set(0, 0, 0);
    }
    const golden = hd && lookEra === 5;
    // The visible sky is darker and richer than the photograph in both modern generations.
    this.scene.backgroundIntensity = golden ? 0.9 : hd ? 0.82 : 1;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.set(golden ? '#c7b9a4' : hd ? '#9fb2c4' : '#bfe3ff');
    fog.near = golden ? 25 : hd ? 30 : 90;
    fog.far = golden ? 220 : hd ? 260 : 380;
    const keyDir = (hd ? this.hdSky!.keyDir : SUN_DIR).clone().applyAxisAngle(UP, this.skyYaw);
    this.sun.position.copy(camTarget).addScaledVector(keyDir, 45);
    this.sun.target.position.copy(camTarget);
    eraUniforms.uSunView.value.copy(keyDir).transformDirection(cam.matrixWorldInverse);
    // Inside the hidden chamber the sky's fill fades, light comes in as shafts through the roof, and the
    // teal machinery glows.
    const C = g.level.chamber;
    const inside = camTarget.x > C.min.x && camTarget.x < C.max.x && camTarget.z > C.min.z - 0.5 && camTarget.z < C.max.z - 0.4 ? 1 : 0;
    this.indoor += (inside - this.indoor) * Math.min(1, dt * 2.5);
    this.chamberLight.intensity = (5 + Math.sin(t * 2) * 1.2 + (g.puzzle.plateLatched ? 4 : 0)) * (1 + this.indoor * 1.6);
    // Lighting rig per generation at the camera focus: the real sky carries the ambient light from Modern HD
    // up (warm sun, cool sky-lit shadows); older generations keep the even, front-lit rig.
    const rig = golden
      ? // warm, low key; the sky's cool light fills the long shadows
        { hemi: 0.08, env: 1.15, sun: 4.2, color: '#ffbf80', sky: '#9fb8e8', ground: '#3c4a2a' }
      : hd
        ? // grounded late afternoon: less fill, a slightly warm sun
          { hemi: 0.05, env: 0.55, sun: 2.5, color: '#ffe6c4', sky: '#b8cfee', ground: '#3f5530' }
        : lookEra === 5
        ? { hemi: 0.4, env: 0.5, sun: 3.6, color: '#ffe2b8', sky: '#cfeeff', ground: '#6c8a4a' }
        : { hemi: 0.85, env: 0.55, sun: 2.7, color: '#fff0d8', sky: '#cfeeff', ground: '#6c8a4a' };
    const k = Math.min(1, dt * 2);
    const fill = 1 - this.indoor * 0.8;
    rig.hemi *= fill;
    rig.env *= fill;
    this.hemi.intensity += (rig.hemi - this.hemi.intensity) * k;
    this.hemi.color.lerp(new THREE.Color(rig.sky), k);
    this.hemi.groundColor.lerp(new THREE.Color(rig.ground), k);
    this.scene.environmentIntensity += (rig.env - this.scene.environmentIntensity) * k;
    this.sun.intensity += (rig.sun - this.sun.intensity) * k;
    this.sun.color.lerp(new THREE.Color(rig.color), k);

    // --- Pip: a sprite in 8-bit, the rig from Early 3D on
    const p = g.player;
    const pipPos = new THREE.Vector3(lerp(p.prevPos.x, p.pos.x, a), lerp(p.prevPos.y, p.pos.y, a), lerp(p.prevPos.z, p.pos.z, a));
    const shiftBoost = g.shift.transition ? Math.sin((g.shift.transition.t / g.shift.transition.dur) * Math.PI) : 0;
    const pipEra = this.eraAt(new THREE.Vector3(pipPos.x, pipPos.y + p.h * 0.5, pipPos.z));
    // Cutaway: in 3D, scenery between the camera and Pip dissolves (see CUTAWAY_GLSL); never on the title.
    eraUniforms.uCutPip.value.set(pipPos.x, pipPos.y + p.h * 0.55, pipPos.z);
    eraUniforms.uCutCam.value.copy(cam.position);
    eraUniforms.uCutOn.value = this.title ? 0 : smoothstep(0.5, 1, g.shift.blend);
    const pose = {
      pos: pipPos,
      vel: new THREE.Vector3(p.vel.x, p.vel.y, p.vel.z),
      grounded: p.grounded,
      dir: p.dir,
      heading: p.heading,
      blend: g.shift.blend,
      action: g.action,
      actionT: g.actionT,
      expression: g.expression(),
      assemble: g.assemble,
      pushing: p.pushing > 0,
      idleT: g.idleT,
      lookAtCamera: g.lookAtCamera,
      antennaGlitch: g.antennaGlitch,
      invuln: g.invuln,
      coreBoost: Math.max(shiftBoost, g.cine?.name === 'device' ? 1 : 0),
      pixelGlow: g.pixelGlow,
      era: pipEra,
      time: t,
      cameraPos: cam.position,
    };
    // Gallery/menu views keep the classic rig so every band shows the same Pip.
    const useSprite = !split && pipEra === 0 && g.assemble >= 1;
    const useSprite16 = !split && pipEra === 1 && g.shift.mode === '2d' && !g.shift.transition && g.assemble >= 1;
    const useHD = !split && !useSprite && pipEra >= 4 && this.pipHD.ready;
    this.pip.update(pose, dt);
    this.pipHD.update(pose, dt);
    if (useSprite || useSprite16 || useHD) {
      this.pip.root.visible = false;
      this.pip.trail.visible = false;
    }
    if (!useHD) this.pipHD.root.visible = false;
    this.pipSprite.sprite.visible = useSprite && !(g.invuln > 0 && Math.floor(t * 18) % 2 === 0);
    if (useSprite) {
      this.pipSprite.width = this.pipSprite.height = p.h * 1.15;
      const moving = Math.abs(p.vel.x) + Math.abs(p.vel.z) > 0.5;
      this.pipSprite.set(!p.grounded ? 3 : moving ? 1 + (Math.floor(t * 8) % 2) : 0, p.dir < 0);
      // pixel-snapped to the 16-px tile grid
      this.pipSprite.sprite.position.set(Math.round(pipPos.x * 16) / 16, Math.round(pipPos.y * 16) / 16, pipPos.z);
    }

    const blinkHide = g.invuln > 0 && Math.floor(t * 18) % 2 === 0;
    this.pipSprite16.sprite.visible = useSprite16 && !blinkHide;
    if (useSprite16) {
      const moving = Math.abs(p.vel.x) > 0.5;
      const frame = !p.grounded ? 'pip_jump' : moving ? `pip_walk${Math.floor(t * 10) % 4}` : 'pip_idle';
      this.pipSprite16.set(frame, p.dir < 0);
      // pixel-snapped to the 24-px 16-bit grid
      this.pipSprite16.sprite.position.set(Math.round(pipPos.x * 24) / 24, Math.round(pipPos.y * 24) / 24, pipPos.z);
    }

    // blob shadow (16-bit + early 3D: before shadow maps)
    const hit = g.world.raycast({ x: pipPos.x, y: pipPos.y + 0.1, z: pipPos.z }, { x: pipPos.x, y: pipPos.y - 30, z: pipPos.z }, (col) => col.kind !== 'invisible');
    const groundY = hit === null ? -999 : pipPos.y + 0.1 - 30.1 * hit;
    const height = pipPos.y - groundY;
    this.blob.visible = (pipEra === 1 || pipEra === 2) && hit !== null && g.assemble >= 1 && !split;
    if (this.blob.visible) {
      this.blob.position.set(pipPos.x, groundY + 0.015, pipPos.z);
      const kb = clamp(1 - height / 5, 0.25, 1);
      this.blob.scale.setScalar(kb);
      (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.42 * kb;
    }

    // --- world
    this.level.update(t, dt, { pip: pipPos, era: this.eraAt, gearSpeed: g.puzzle.plateLatched ? 6 : 1, machineEye: g.machineEye }, this.swapEraAt);
    this.entities.update(t, dt);
    for (const l of this.level.masked) {
      const c = g.world.get(l.id);
      l.set(!!c && c.enabled && g.world.active(c), t);
    }
    this.particles.update(dt);

    // Beyond motes; under the real sky in Modern HD they are fainter pollen drifting over the meadow.
    const focusEra = this.eraAt(camTarget);
    const moteGoal = (focusEra === 5 ? 1 : this.hdActive ? 0.4 : 0) * (this.title ? 0.3 : 1);
    this.moteFade += (moteGoal - this.moteFade) * Math.min(1, dt * 1.5);
    const mm = this.motes.material as THREE.MeshBasicMaterial;
    mm.opacity = this.moteFade * 0.85;
    this.motes.visible = this.moteFade > 0.01;
    if (this.motes.visible) {
      const m4 = new THREE.Matrix4();
      const n = this.motes.count;
      for (let i = 0; i < n; i++) {
        const s0 = this.moteSeeds[i * 4];
        const s1 = this.moteSeeds[i * 4 + 1];
        const s2 = this.moteSeeds[i * 4 + 2];
        const s3 = this.moteSeeds[i * 4 + 3];
        const x = camTarget.x + ((s0 * 20 + t * (0.15 + s3 * 0.2)) % 20) - 10;
        const y = camTarget.y - 1.5 + s1 * 6 + Math.sin(t * (0.4 + s2) + s0 * 10) * 0.4;
        const z = camTarget.z - 5 + s2 * 8 + Math.cos(t * 0.3 + s1 * 9) * 0.5;
        const sc = 0.6 + 0.8 * Math.abs(Math.sin(t * (1 + s3 * 2) + s0 * 20));
        m4.makeScale(sc, sc, sc).setPosition(x, y, z);
        this.motes.setMatrixAt(i, m4);
      }
      this.motes.instanceMatrix.needsUpdate = true;
    }
    for (const pu of this.pulses) {
      if (pu.t >= 1) continue;
      pu.t = Math.min(1, pu.t + dt * 1.4);
      pu.mesh.scale.setScalar(1 + pu.t * pu.grow);
      (pu.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - pu.t) * 0.55;
      pu.mesh.visible = pu.t < 1;
    }

    // Lane guide while in 3D (meadow)
    const laneOn = g.shift.unlocked ? clamp(g.shift.blend, 0, 1) : 0;
    // The lane is a quiet cue in the immersive 3D world: faint, brighter only when Pip can flatten here.
    const onLane = Math.abs(p.pos.z) <= 0.6 && g.shiftStatus === 'ready';
    this.level.laneMat.opacity = laneOn * (onLane ? 0.22 + Math.sin(t * 3) * 0.06 : 0.05);
    this.level.group.children.forEach((o) => {
      if (o.userData.bridge !== undefined) o.visible = laneOn > 0.01 && (!o.userData.bridge || g.puzzle.state === 'repaired');
    });

    // Fade occluders that hide Pip from the 3D camera
    const head = pipPos.clone().add(new THREE.Vector3(0, p.h * 0.55, 0));
    for (const o of this.level.occluders) {
      const blocks = g.shift.blend > 0.4 && segmentHitsBox(cam.position, head, o.box);
      const want = blocks ? 0.22 : 1;
      o.opacity += (want - o.opacity) * Math.min(1, dt * 8);
      for (const m of o.mats) {
        m.transparent = true;
        m.opacity = o.opacity;
        m.depthWrite = o.opacity > 0.5;
      }
    }

    // --- post frame
    const f = this.frame;
    f.eraFrom = tr ? tr.from : g.era.era;
    f.eraTo = tr ? tr.to : g.era.era;
    f.radius = tr ? g.era.radius : 0;
    f.rippleActive = !!tr;
    if (tr) f.center.set(tr.center.x, tr.center.y, tr.center.z);
    f.split = split;
    f.splitScreen = this.splitScreen;
    for (let i = 0; i < MAX_RIFTS; i++) {
      f.rifts[i].copy(eraUniforms.uRifts.value[i]);
      if (split) f.rifts[i].w = 0;
      f.riftEra[i] = eraUniforms.uRiftEra.value[i];
    }
    f.bubble.copy(eraUniforms.uBubble.value);
    f.bubbleEra = eraUniforms.uBubbleEra.value;
    let fieldMax = 0;
    for (let i = 0; i < 4; i++) {
      f.fieldMin[i].copy(eraUniforms.uFieldMin.value[i]);
      f.fieldMax[i].copy(eraUniforms.uFieldMax.value[i]);
      f.fieldEra[i] = eraUniforms.uFieldEra.value[i];
      if (f.fieldMin[i].y > -900) fieldMax = Math.max(fieldMax, f.fieldEra[i]);
    }
    f.maxEra = split ? 5 : Math.max(f.eraFrom, f.eraTo, bub ? bub.era : 0, fieldMax);
    // The valley terrain exists from Early 3D up and its Blender dressing from Modern HD up: skip them
    // entirely (not just per pixel) while no such generation can be on screen.
    const valley = (!split || !!this.options.immersive) && !this.title;
    this.terrain.group.visible = valley && f.maxEra >= 2;
    this.dressing.group.visible = valley && f.maxEra >= 4;
    // the seal door sinks into the ground once its glyphs are read (its collider is already gone)
    this.level.sealDoor.position.y = -g.sealOpen * 5.3;
    this.level.sealDoor.visible = g.sealOpen < 0.999;
    if (this.aqueduct) {
      // the canyon's dressing exists from Early 3D up, and only matters near the Halo Path's end
      const near = Math.abs(camTarget.x - 220) < 90;
      this.aqueduct.group.visible = near && f.maxEra >= 2;
      if (this.aqueduct.group.visible) this.aqueduct.update(dt);
    }
    if (this.title) {
      // the title set stands alone: the level is hundreds of units away and never in its frame
      this.level.group.visible = this.entities.group.visible = false;
      this.title.update(dt);
    }
    if (this.dressing.group.visible) {
      this.dressing.density = [0.4, 0.7, 1][this.post.activeTier];
      this.dressing.update(this.camera);
    }
    f.fade = g.fade;
    f.fadeColor.set(g.fadeWhite ? '#f4fbff' : '#0d0b1e');
    const st = g.shift.transition;
    f.shiftT = st ? st.t / st.dur : 0;
    if (st) {
      const s = pipPos.clone().add(new THREE.Vector3(0, p.h * 0.5, 0)).project(cam);
      f.shiftCenter.set(s.x * 0.5 + 0.5, s.y * 0.5 + 0.5);
    }
    this.flash = Math.max(0, this.flash - dt * 2.2);
    f.flash = this.flash * this.flash;
    f.time = t;
    // The camera target tracks Pip in play and frames the subject in cinematics/gallery views.
    f.focus.copy(camTarget);
    // 2D keeps the depth of field gentle: the walls and ruins just behind the lane are part of the play space.
    f.dof = split ? 0 : g.cine ? 0.6 : g.shift.mode === '2d' ? 0.16 : 0.4;
    if (this.title) {
      // the title: Pip in focus, the valley only slightly soft
      f.focus.copy(pipPos);
      f.dof = 0.12;
    }
    // The real sky replaces the procedural dome (set after the level's era swaps have run this frame),
    // and light shafts aim at the sky's actual sun.
    this.level.skyMesh.visible = this.level.skyMesh.visible && !this.hdActive;
    f.sunDir.copy(this.hdActive ? this.hdSky!.sunDir : SKY_SUN);
    this.retro.update(g.world);
    f.retro = this.retro;
    f.retro2D = retro2D;
    f.letterbox = smoothstep(0, 1, this.retroCamW);
    f.retroK = this.retroK;
    f.letterboxRows = this.retroRows;
    this.retro16.update(g.world);
    f.retro16 = this.retro16;
    f.camXY.set(this.camera.position.x, this.camera.position.y);
    f.laneZ = g.shift.laneZ;
  }

  render(gl: THREE.WebGLRenderer) {
    this.post.render(gl, this.scene, this.camera, this.frame, this.lastDt);
  }
}

/** Frame defaults for stand-alone pipeline users (gallery). */
export const NEUTRAL_FRAME_EXTRAS = () => ({
  bubble: new THREE.Vector4(),
  bubbleEra: 0,
  fieldMin: Array.from({ length: 4 }, () => new THREE.Vector3(0, -999, 0)),
  fieldMax: Array.from({ length: 4 }, () => new THREE.Vector3(0, -999, 0)),
  fieldEra: [0, 0, 0, 0],
});
