import * as THREE from 'three';
import { eraUniforms } from './eraMaterial';
import { LevelView, SKY_FRAG, SKY_SUN, SKY_VERT } from './LevelView';
import { EntityViews } from './EntityViews';
import { Particles } from './Particles';
import { PostPipeline, type PostFrame, type QualitySetting } from './post/Pipeline';
import { CityView, NEON } from './city/CityView';
import { HostileViews } from './city/HostileViews';
import { PixelSprite } from './sprites';
import { PipModel } from '../pip/PipModel';
import { PipAdult } from '../pip/PipAdult';
import type { Game, GameEvent } from '../sim/Game';
import { MAX_RIFTS, type Era } from '../era/EraSystem';
import { segmentHitsBox } from '../collision/World';
import { STAIR, stairStep } from '../level/meadows';
import { clamp, lerp } from '../math';

/** Direction toward the key light used for shading (front-lit so the 2D lane always reads). */
const SUN_DIR = new THREE.Vector3(-0.45, 0.85, 0.55).normalize();
/** The city's key light: cold moonlight from high behind. */
const MOON_DIR = new THREE.Vector3(0.3, 0.9, -0.4).normalize();
const SPLIT_SCREEN = [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6];

export interface ViewOptions {
  /** Menu/gallery: split the screen into six generation bands. */
  split?: boolean;
}

const envCache = new WeakMap<THREE.WebGLRenderer, { day: THREE.Texture; night: THREE.Texture }>();

/** Image-based lighting for both zones: the procedural day sky, and a neon-lit night. */
function environments(gl: THREE.WebGLRenderer) {
  const cached = envCache.get(gl);
  if (cached) return cached;
  const pmrem = new THREE.PMREMGenerator(gl);
  const skyMesh = (top: string, horizon: string, bottom: string, dim: number) =>
    new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color(top) },
          uHorizon: { value: new THREE.Color(horizon) },
          uBottom: { value: new THREE.Color(bottom) },
          uSunDir: { value: SUN_DIR.clone() },
          uDim: { value: dim },
        },
      }),
    );
  const day = new THREE.Scene();
  day.add(skyMesh('#3b7be0', '#d6f0ff', '#4c8a4a', 1.2));
  const night = new THREE.Scene();
  night.add(skyMesh('#06040e', '#2a1640', '#0b0814', 1));
  // neon panels so wet surfaces pick up coloured reflections
  [NEON.pink, NEON.cyan, NEON.amber, NEON.violet].forEach((c, i) => {
    const a = (i / 4) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(14, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(4), side: THREE.DoubleSide }));
    p.position.set(Math.cos(a) * 30, 4 + i * 2, Math.sin(a) * 30);
    p.lookAt(0, p.position.y, 0);
    night.add(p);
  });
  const out = { day: pmrem.fromScene(day, 0.03).texture, night: pmrem.fromScene(night, 0.02).texture };
  pmrem.dispose();
  envCache.set(gl, out);
  return out;
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
  city: CityView;
  hostiles: HostileViews;
  pip = new PipModel();
  adult = new PipAdult(1);
  pipSprite = new PixelSprite('pip', 1, 1);
  citizen = new PixelSprite('citizen', 1, 1);
  particles = new Particles();
  post = new PostPipeline();
  private env: { day: THREE.Texture; night: THREE.Texture };
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private chamberLight: THREE.PointLight;
  /** City: a soft key on Pip so the android reads against the night. */
  private pipFill = new THREE.PointLight('#bcd4ff', 6, 7, 1.5);
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
    night: false,
    rain: 0,
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
    this.level = new LevelView(game.level);
    this.entities = new EntityViews(game, this.level.eras);
    this.city = new CityView(game, game.verge);
    this.hostiles = new HostileViews(game.combat);
    this.scene.add(this.level.group, this.entities.group, this.city.group, this.city.rain, this.hostiles.group);
    this.scene.add(this.pip.root, this.pip.trail, this.adult.root, this.pipSprite.sprite, this.citizen.sprite, this.particles.mesh);
    this.scene.fog = new THREE.Fog('#bfe3ff', 90, 380);
    this.env = environments(gl);
    this.scene.environment = this.env.day;
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
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.chamberLight = new THREE.PointLight('#4ff5e6', 6, 14, 1.6);
    this.chamberLight.position.set(57, 2.6, -7.5);
    this.scene.add(this.chamberLight, this.pipFill);

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
    this.post.dispose();
    this.pip.dispose();
    this.adult.dispose();
    this.pipSprite.dispose();
    this.citizen.dispose();
    this.city.dispose();
    this.hostiles.dispose();
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
    if (e.type === 'zone' || e.type === 'domeCrack') this.flash = 0.6;
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
    const city = this.game.zone === 'verge';
    switch (e.type) {
      case 'jump':
        P.burst(p, { count: retro ? 2 : 6, colors: dust, speed: 1.6, up: 0.6, size: retro ? 0.12 : 0.07, life: 0.3, gravity: 2, flat: true });
        break;
      case 'land': {
        const k = clamp((e.value ?? 0) / 20, 0.2, 1);
        P.burst(p, { count: retro ? 2 : Math.round(6 + k * 10), colors: dust, speed: 2.5 * k + 0.8, up: 0.4, size: retro ? 0.12 : 0.08, life: 0.35, gravity: 2, flat: true });
        if (beyond && !city) this.pulse(p.x, p.y, p.z);
        break;
      }
      case 'step':
        if (!city) P.burst(p, { count: 2, colors: dust, speed: 0.6, up: 0.4, size: 0.05, life: 0.3, gravity: 1, flat: true });
        else if (era >= 4) P.burst(p, { count: 3, colors: ['#9fc7ff', '#ffffff'], speed: 1.2, up: 1.2, size: 0.04, life: 0.3, gravity: 6, flat: true });
        if (beyond && !city) this.pulse(p.x, p.y, p.z);
        break;
      case 'collect':
        P.burst(p, { count: retro ? 4 : 14, colors: ['#6ff6ff', '#ffd36b', '#fff4d6'], speed: 3.5, up: 2.5, size: retro ? 0.12 : 0.08, life: 0.5, gravity: 4 });
        break;
      case 'stomp':
        P.burst({ x: p.x, y: p.y + 0.3, z: p.z }, { count: retro ? 4 : 22, colors: ['#ff4fd8', '#2fd6c3', '#2b2d6e', '#ffffff'], speed: 4.5, up: 3, size: retro ? 0.14 : 0.11, life: 0.5 });
        break;
      case 'hurt':
        P.burst({ x: p.x, y: p.y + (city ? 1.1 : 0.5), z: p.z }, { count: 14, colors: city ? ['#ff2a55', '#ffd36b', '#ffffff'] : ['#ff6b6b', '#ffcf6b'], speed: 4, up: 2, size: 0.08, life: 0.5 });
        break;
      case 'dash':
        P.burst({ x: p.x, y: p.y + 0.9, z: p.z }, { count: 18, colors: ['#6ff6ff', '#b388ff'], speed: 2, up: 0.5, size: 0.06, life: 0.35, gravity: 0, flat: true });
        break;
      case 'bubbleOn':
      case 'bubbleOff':
      case 'bubblePop':
        this.flash = Math.max(this.flash, 0.18);
        this.pulse(p.x, p.y + (city ? 0.9 : 0.45), p.z, e.type === 'bubbleOn' ? '#b388ff' : '#6ff6ff', 9, false);
        P.burst({ x: p.x, y: p.y + 0.8, z: p.z }, { count: 30, colors: ['#b388ff', '#6ff6ff', '#ffffff'], speed: 5, up: 0.5, size: 0.07, life: 0.6, gravity: 0, drag: 2 });
        break;
      case 'emitter':
      case 'pickup':
        P.converge({ x: p.x, y: p.y + 1.1, z: p.z }, 2, { count: 30, colors: e.type === 'pickup' ? ['#5cff8a', '#ffffff'] : ['#ff8a2a', '#ffd36b'], size: 0.06, life: 0.6 });
        break;
      case 'shutter':
      case 'door':
        P.burst({ x: p.x, y: p.y + 2, z: p.z }, { count: 30, colors: ['#ffb347', '#ffffff'], speed: 4, up: 2, size: 0.07, life: 0.8 });
        break;
      case 'codeRead':
        P.burst(p, { count: 24, colors: ['#3ef4ff', '#ffffff'], speed: 2, up: 1, size: 0.05, life: 0.8, gravity: 0 });
        break;
      case 'coreChoice':
        this.flash = 0.8;
        P.burst(p, { count: 120, colors: ['#f0862a', '#ffcf6b', '#5ec8f0', '#ff8fb8', '#6ff6ff', '#b388ff'], speed: 9, up: 0, size: 0.12, life: 2, gravity: 0, drag: 0.8 });
        break;
      case 'combat':
        this.onCombat(e, p);
        break;
      case 'fizzle':
        P.burst({ x: p.x, y: p.y + 0.6, z: p.z }, { count: 10, colors: ['#8e5bd6', '#6b6b8a'], speed: 1.8, up: 1.5, size: 0.06, life: 0.5, gravity: 3 });
        break;
      case 'antenna':
        P.burst({ x: p.x, y: p.y + (city ? 2.1 : 1.1), z: p.z }, { count: 6, colors: ['#6ff6ff', '#ffffff'], speed: 2, up: 2, size: 0.05, life: 0.3 });
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
        P.burst({ x: p.x, y: p.y + 1.2, z: city ? p.z : e.text === 'beacon' ? -1.6 : 1.6 }, { count: 50, colors: ['#ffd36b', '#6ff6ff', '#ff8fb8', '#8e5bd6', '#fff4d6'], speed: 5, up: 6, size: 0.1, life: 1.4, gravity: 6 });
        break;
      case 'respawn':
        P.converge({ x: p.x, y: p.y + 0.45, z: p.z }, 1.6, { count: 30, colors: ['#2fd6c3', '#fff4d6'], size: 0.06, life: 0.5 });
        break;
    }
  }

  private onCombat(e: GameEvent, p: { x: number; y: number; z: number }) {
    const P = this.particles;
    switch (e.combat) {
      case 'impact':
        P.burst(p, { count: 5, colors: ['#ffae4a', '#fff1c0', '#ff2a55'], speed: 4, up: 1.5, size: 0.05, life: 0.3, gravity: 6 });
        break;
      case 'hit':
        P.burst(p, { count: 10, colors: ['#ffae4a', '#ffffff', '#ff2a55'], speed: 5, up: 2, size: 0.06, life: 0.35, gravity: 4 });
        break;
      case 'shieldHit':
        P.burst(p, { count: 10, colors: ['#3ef4ff', '#ffffff'], speed: 3, up: 1, size: 0.06, life: 0.4, gravity: 0 });
        break;
      case 'armorHit':
        P.burst(p, { count: 8, colors: ['#ffd36b', '#ffffff'], speed: 6, up: 2, size: 0.04, life: 0.25, gravity: 8 });
        break;
      case 'enemyDown': {
        const boss = e.text === 'warden';
        this.flash = Math.max(this.flash, boss ? 0.7 : 0.12);
        P.burst(p, { count: boss ? 140 : 46, colors: ['#ff2a55', '#ffae4a', '#ffffff', '#3ef4ff', '#2b2d6e'], speed: boss ? 10 : 7, up: 4, size: 0.09, life: 1.1, gravity: 7 });
        // they come apart into pixels
        P.burst(p, { count: 20, colors: ['#ff4fd8', '#2fd6c3', '#ffcf6b'], speed: 3, up: 3, size: 0.16, life: 1.4, gravity: 2 });
        break;
      }
      case 'boltFizzle':
        P.burst(p, { count: 3, colors: ['#ff2a55', '#8e5bd6'], speed: 1, up: 0.5, size: 0.08, life: 0.3, gravity: 0 });
        break;
      case 'slam':
        this.pulse(p.x, p.y, p.z, '#ff2a55', 18);
        P.burst(p, { count: 40, colors: ['#c9c3d8', '#ffae4a'], speed: 8, up: 1, size: 0.1, life: 0.7, flat: true });
        break;
      case 'pulse':
        this.pulse(p.x, p.y + 1.6, p.z, '#3ef4ff', 34, false);
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

  update(dt: number) {
    const g = this.game;
    this.t += dt;
    this.lastDt = dt;
    const t = this.t;
    const a = g.alpha;
    const split = !!this.options.split;
    const city = g.zone === 'verge';

    // --- camera (interpolated between fixed steps)
    const c = g.camera;
    const cam = this.camera;
    cam.position.set(lerp(c.prevPos.x, c.pos.x, a), lerp(c.prevPos.y, c.pos.y, a), lerp(c.prevPos.z, c.pos.z, a));
    this.tmp.set(lerp(c.prevTarget.x, c.target.x, a), lerp(c.prevTarget.y, c.target.y, a), lerp(c.prevTarget.z, c.target.z, a));
    cam.lookAt(this.tmp);
    cam.fov = lerp(c.prevFov, c.fov, a);
    cam.near = city ? 0.12 : 0.3;
    cam.far = city ? 1400 : 900;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const camTarget = this.tmp.clone();
    if (split) this.updateSplit(cam, camTarget.y);

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

    // --- zone: which world is drawn, and its light rig
    this.level.group.visible = !city;
    this.entities.group.visible = !city;
    this.city.group.visible = city;
    this.hostiles.group.visible = city;
    this.chamberLight.visible = !city;
    this.scene.environment = city ? this.env.night : this.env.day;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.set(city ? '#0c0816' : '#bfe3ff');
    fog.near = city ? 40 : 90;
    fog.far = city ? 520 : 380;
    const keyDir = city ? MOON_DIR : SUN_DIR;
    this.sun.position.copy(camTarget).addScaledVector(keyDir, 45);
    this.sun.target.position.copy(camTarget);
    eraUniforms.uSunView.value.copy(keyDir).transformDirection(cam.matrixWorldInverse);
    this.chamberLight.intensity = 5 + Math.sin(t * 2) * 1.2 + (g.puzzle.plateLatched ? 4 : 0);
    // Lighting rig per generation at the camera focus: Beyond trades ambient for a strong warm key.
    const lookEra = split ? 4 : this.eraAt(camTarget);
    const rig = city
      ? { hemi: 0.7, env: 0.9, sun: 1.2, color: '#9fb4ff', sky: '#5a4a90', ground: '#2a1a34' }
      : lookEra === 5
        ? { hemi: 0.4, env: 0.5, sun: 3.6, color: '#ffe2b8', sky: '#cfeeff', ground: '#6c8a4a' }
        : { hemi: 0.85, env: 0.55, sun: 2.7, color: '#fff0d8', sky: '#cfeeff', ground: '#6c8a4a' };
    const k = Math.min(1, dt * 2);
    this.hemi.intensity += (rig.hemi - this.hemi.intensity) * k;
    this.hemi.color.lerp(new THREE.Color(rig.sky), k);
    this.hemi.groundColor.lerp(new THREE.Color(rig.ground), k);
    this.scene.environmentIntensity += (rig.env - this.scene.environmentIntensity) * k;
    this.sun.intensity += (rig.sun - this.sun.intensity) * k;
    this.sun.color.lerp(new THREE.Color(rig.color), k);

    // --- Pip: a sprite in 8-bit, the classic rig, the young adult, or the grown android
    const p = g.player;
    const pipPos = new THREE.Vector3(lerp(p.prevPos.x, p.pos.x, a), lerp(p.prevPos.y, p.pos.y, a), lerp(p.prevPos.z, p.pos.z, a));
    const shiftBoost = g.shift.transition ? Math.sin((g.shift.transition.t / g.shift.transition.dur) * Math.PI) : 0;
    const pipEra = this.eraAt(new THREE.Vector3(pipPos.x, pipPos.y + p.h * 0.5, pipPos.z));
    const adult = p.form === 'adult';
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
    const useAdult = !split && !useSprite && (adult || pipEra >= 4);
    this.pip.update(pose, dt);
    if (useSprite || useAdult) {
      this.pip.root.visible = false;
      this.pip.trail.visible = false;
    }
    this.pipSprite.sprite.visible = useSprite && !(g.invuln > 0 && Math.floor(t * 18) % 2 === 0);
    if (useSprite) {
      this.pipSprite.width = this.pipSprite.height = p.h * 1.15;
      const moving = Math.abs(p.vel.x) + Math.abs(p.vel.z) > 0.5;
      this.pipSprite.set(!p.grounded ? 3 : moving ? 1 + (Math.floor(t * 8) % 2) : 0, p.dir < 0);
      // pixel-snapped to the 16-px tile grid
      this.pipSprite.sprite.position.set(Math.round(pipPos.x * 16) / 16, Math.round(pipPos.y * 16) / 16, pipPos.z);
    }
    this.adult.root.visible = useAdult;
    this.pipFill.visible = city;
    if (city) this.pipFill.position.set(pipPos.x + (cam.position.x - pipPos.x) * 0.3, pipPos.y + 2.4, pipPos.z + (cam.position.z - pipPos.z) * 0.3);
    if (useAdult) {
      this.adult.setAge(adult ? 1 : pipEra >= 5 ? 0.8 : 0.62);
      this.adult.setHeight(adult ? 1.8 : 0.98);
      this.adult.update({ ...pose, aim: g.aiming, firing: g.firing && g.combat.fireCd > 0.07, aimPitch: g.camera.pitch, dashing: p.dashT > 0, heat: g.combat.heat }, dt);
    }
    // epilogue: a little citizen under the opened dome looks up at the rain
    this.citizen.sprite.visible = g.epilogue;
    if (g.epilogue) {
      this.citizen.set(0, false);
      this.citizen.sprite.position.set(pipPos.x + 2.2, pipPos.y, 0.1);
    }

    // blob shadow (16-bit + early 3D: before shadow maps)
    const hit = g.world.raycast({ x: pipPos.x, y: pipPos.y + 0.1, z: pipPos.z }, { x: pipPos.x, y: pipPos.y - 30, z: pipPos.z }, (col) => col.kind !== 'invisible');
    const groundY = hit === null ? -999 : pipPos.y + 0.1 - 30.1 * hit;
    const height = pipPos.y - groundY;
    this.blob.visible = (pipEra === 1 || pipEra === 2) && hit !== null && g.assemble >= 1 && !split;
    if (this.blob.visible) {
      this.blob.position.set(pipPos.x, groundY + 0.015, pipPos.z);
      const kb = clamp(1 - height / 5, 0.25, 1);
      this.blob.scale.setScalar(kb * (adult ? 1.6 : 1));
      (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.42 * kb;
    }

    // --- world
    if (!city) {
      this.level.update(t, dt, { pip: pipPos, era: this.eraAt, gearSpeed: g.puzzle.plateLatched ? 6 : 1, machineEye: g.machineEye }, this.swapEraAt);
      this.entities.update(t, dt);
      for (const l of this.level.lasers) {
        const c = g.world.get(l.id);
        l.obj.visible = !!c && g.world.active(c);
      }
    } else {
      this.city.reflections = this.post.tier >= 1;
      this.city.update(t, dt, cam, this.eraAt);
      this.hostiles.update(t, dt, a);
    }
    // rain: the city, and the epilogue under the opened dome
    this.city.rain.visible = city || g.epilogue;
    if (g.epilogue) this.city.updateRain(t, cam);
    this.particles.update(dt);

    // Beyond motes (meadow only — the city has rain instead)
    const focusEra = this.eraAt(camTarget);
    this.moteFade += ((focusEra === 5 && !city ? 1 : 0) - this.moteFade) * Math.min(1, dt * 1.5);
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
    const laneOn = g.shift.unlocked && !city ? clamp(g.shift.blend, 0, 1) : 0;
    this.level.laneMat.opacity = laneOn * (0.55 + Math.sin(t * 3) * 0.15);
    this.level.group.children.forEach((o) => {
      if (o.userData.bridge !== undefined) o.visible = laneOn > 0.01 && (!o.userData.bridge || g.puzzle.state === 'repaired');
    });

    // Fade occluders that hide Pip from the 3D camera
    const head = pipPos.clone().add(new THREE.Vector3(0, p.h * 0.55, 0));
    for (const o of this.level.occluders) {
      const blocks = !city && g.shift.blend > 0.4 && segmentHitsBox(cam.position, head, o.box);
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
    f.night = city;
    f.rain = city && focusEra >= 4 ? 1 : 0;
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
    f.dof = g.cine ? 0.6 : city ? (g.aiming > 0.5 ? 0.08 : 0.03) : g.shift.mode === '2d' ? 0.55 : 0.4;
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
  night: false,
  rain: 0,
});
