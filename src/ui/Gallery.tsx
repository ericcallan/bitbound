import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useUI, type HudState } from './store';
import { HudView } from './HUD';
import { WorldMap } from './WorldMap';
import { PipModel, type PipPose } from '../game/pip/PipModel';
import { PostPipeline, PALETTE_8 } from '../game/render/post/Pipeline';
import { eraUniforms, eraMaterial, PATTERN } from '../game/render/eraMaterial';
import { GameView, NEUTRAL_FRAME_EXTRAS } from '../game/render/GameView';
import { SKY_SUN } from '../game/render/LevelView';
import { drawFace, PIP_COLORS } from '../game/pip/face';
import { makeMenuGame } from './session';
import type { Expression, PipAction } from '../game/sim/Game';
import { ERA_BLURBS, ERA_NAMES, ERAS, type Era } from '../game/era/EraSystem';
import { audio } from '../game/audio/AudioEngine';
import { v3 } from '../game/math';

type Tab = 'pip' | 'world' | 'ui' | 'map';

export function Gallery() {
  const [tab, setTab] = useState<Tab>('pip');
  const ui = useUI();
  const tabs: [Tab, string][] = [
    ['pip', 'Character'],
    ['world', 'Environment'],
    ['ui', 'Interface'],
    ['map', 'World Map'],
  ];
  return (
    <div className="gallery">
      <header className="gallery__head">
        <button className="menu__btn menu__btn--small" onClick={() => (audio.sfx('click'), ui.setScreen('menu'))}>
          ← Back
        </button>
        <h1>
          PIP <span>Art &amp; Design</span>
        </h1>
        <nav>
          {tabs.map(([id, label]) => (
            <button key={id} className={`gallery__tab ${tab === id ? 'is-on' : ''}`} onClick={() => (audio.sfx('hover'), setTab(id))}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main className="gallery__body">
        {tab === 'pip' && <CharacterSheet />}
        {tab === 'world' && <EnvironmentSheet />}
        {tab === 'ui' && <InterfaceSheet />}
        {tab === 'map' && <MapSheet />}
      </main>
    </div>
  );
}

function EraLabels() {
  return (
    <div className="sheet__eras sheet__eras--six">
      {ERAS.map((e) => (
        <span key={e} data-era={e}>
          {ERA_NAMES[e]}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ character sheet

const POSES: { id: string; label: string; action: PipAction; expr: Expression; run?: boolean; air?: number }[] = [
  { id: 'idle', label: 'Idle', action: 'none', expr: 'idle' },
  { id: 'run', label: 'Run', action: 'none', expr: 'determined', run: true },
  { id: 'jump', label: 'Jump', action: 'none', expr: 'happy', air: 6 },
  { id: 'panic', label: 'Panic fall', action: 'none', expr: 'panic', air: -16 },
  { id: 'fist', label: 'Fist pump', action: 'fistpump', expr: 'happy' },
  { id: 'inspect', label: 'Transforming', action: 'inspect', expr: 'wonder' },
  { id: 'surprised', label: 'First 3D', action: 'surprised', expr: 'surprised' },
  { id: 'stumble', label: 'Stumble', action: 'stumble', expr: 'dizzy' },
  { id: 'dance', label: 'Victory dance', action: 'dance', expr: 'happy' },
];

const LINEUP_X = ERAS.map((e) => (e - 2.5) * 1.55);
const LINEUP_SPLIT = [0, 1, 2, 3, 4].map((i) => (LINEUP_X[i] + LINEUP_X[i + 1]) / 2);

function PipLineup({ pose }: { pose: (typeof POSES)[number] }) {
  const { gl, camera } = useThree();
  const scene = useMemo(() => new THREE.Scene(), []);
  const post = useMemo(() => new PostPipeline(), []);
  const pips = useMemo(() => ERAS.map(() => new PipModel()), []);
  const actionT = useRef(0);
  const t = useRef(0);

  useEffect(() => {
    scene.background = new THREE.Color('#9fd6ff');
    const pmrem = new THREE.PMREMGenerator(gl);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color('#bfe6ff');
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    scene.environmentIntensity = 0.5;
    pmrem.dispose();
    scene.add(new THREE.HemisphereLight('#cfeeff', '#6c8a4a', 1.0));
    const sun = new THREE.DirectionalLight('#fff0d8', 2.6);
    sun.position.set(-3, 6, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);
    const ground = new THREE.Mesh(new THREE.BoxGeometry(12, 1, 2.4), eraMaterial({ color: '#52c24a', pattern: PATTERN.grass }));
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    scene.add(ground);
    const dirt = new THREE.Mesh(new THREE.BoxGeometry(12, 2, 2.4), eraMaterial({ color: '#9a6440', pattern: PATTERN.dirt }));
    dirt.position.y = -1.95;
    scene.add(dirt);
    pips.forEach((p, i) => {
      p.root.position.x = LINEUP_X[i];
      scene.add(p.root, p.trail);
    });
    camera.position.set(0, 1.3, 9.2);
    camera.lookAt(0, 0.55, 0);
    (camera as THREE.PerspectiveCamera).fov = 24;
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    return () => post.dispose();
  }, [scene, pips, camera, post, gl]);

  useEffect(() => {
    actionT.current = 0;
  }, [pose]);

  useFrame((_, dt) => {
    t.current += dt;
    actionT.current += dt;
    if (pose.action !== 'dance' && actionT.current > 2.8) actionT.current = 0;
    eraUniforms.uSplit.value = 1;
    eraUniforms.uSplitX.value.splice(0, 5, ...LINEUP_SPLIT);
    eraUniforms.uSunView.value.set(-0.45, 0.85, 0.55).normalize().transformDirection(camera.matrixWorldInverse);
    eraUniforms.uTime.value = t.current;
    for (const r of eraUniforms.uRifts.value) r.w = 0;
    pips.forEach((p, i) => {
      const base = new THREE.Vector3(LINEUP_X[i], pose.air ? 0.35 + Math.sin(t.current * 2) * 0.05 : 0, 0);
      const pp: PipPose = {
        pos: base,
        vel: new THREE.Vector3(pose.run ? 7.2 : 0, pose.air ?? 0, 0),
        grounded: !pose.air,
        dir: 1,
        heading: Math.PI / 2,
        blend: 0,
        action: pose.action,
        actionT: actionT.current,
        expression: pose.expr,
        assemble: 1,
        pushing: false,
        idleT: 0,
        lookAtCamera: pose.id === 'idle' ? 1 : 0,
        antennaGlitch: 0,
        invuln: 0,
        coreBoost: pose.id === 'inspect' ? 0.6 : 0,
        pixelGlow: 0,
        era: i as Era,
        time: t.current,
        cameraPos: camera.position,
      };
      p.update(pp, dt);
      p.root.rotation.y -= 0.35;
    });
    const screen = LINEUP_SPLIT.map((x) => new THREE.Vector3(x, 0.5, 0).project(camera).x * 0.5 + 0.5);
    post.render(
      gl,
      scene,
      camera as THREE.PerspectiveCamera,
      {
        eraFrom: 0,
        eraTo: 0,
        center: new THREE.Vector3(),
        radius: 0,
        rippleActive: false,
        split: true,
        splitScreen: screen,
        rifts: [],
        riftEra: [],
        fade: 0,
        fadeColor: new THREE.Color(0, 0, 0),
        shiftCenter: new THREE.Vector2(),
        shiftT: 0,
        flash: 0,
        time: t.current,
        focus: new THREE.Vector3(0, 0.5, 0),
        dof: 0,
        sunDir: SKY_SUN,
        maxEra: 5,
        ...NEUTRAL_FRAME_EXTRAS(),
      },
      dt,
    );
  }, 1);
  return null;
}

function FaceTile({ expr, era }: { expr: Expression; era: Era }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const res = era === 0 ? 16 : era === 1 ? 32 : 128;
    c.width = c.height = res;
    drawFace(c.getContext('2d')!, res, { expression: expr, blink: false, lookX: 0, lookY: 0, era, t: 0.3 });
  }, [expr, era]);
  return <canvas ref={ref} className="facetile" />;
}

function CharacterSheet() {
  const [pose, setPose] = useState(POSES[0]);
  const expressions: Expression[] = ['idle', 'happy', 'surprised', 'wonder', 'determined', 'panic', 'dizzy', 'hurt', 'sleepy'];
  return (
    <div className="sheet">
      <section className="sheet__hero">
        <div className="sheet__canvas">
          <Canvas shadows flat dpr={[1, 1.5]} gl={{ antialias: false }}>
            <PipLineup pose={pose} />
          </Canvas>
          <EraLabels />
        </div>
        <div className="sheet__poses">
          {POSES.map((p) => (
            <button key={p.id} className={`chip ${pose.id === p.id ? 'is-on' : ''}`} onClick={() => setPose(p)}>
              {p.label}
            </button>
          ))}
        </div>
      </section>
      <section className="sheet__grid">
        <div className="card">
          <h3>Pip</h3>
          <p>
            A single pixel given consciousness by an ancient machine. Curious, impulsive, brave and easily distracted.
            He does not understand how the world works — which is exactly why it keeps surprising him.
          </p>
          <ul className="traits">
            <li>Rounded-square head with a dark screen-face</li>
            <li>Big cyan eyes that carry every emotion</li>
            <li>Orange &amp; cream body, glowing dimensional core</li>
            <li>One bouncy antenna — prone to malfunctions</li>
            <li>Mitten hands, oversized spring boots</li>
          </ul>
        </div>
        <div className="card">
          <h3>One robot, six generations</h3>
          <ul className="traits">
            {ERAS.map((e) => (
              <li key={e}>
                <b>{ERA_NAMES[e]}</b> — {ERA_BLURBS[e]}
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h3>Palette</h3>
          <div className="swatches">
            {[
              ['Burnt orange', PIP_COLORS.orange],
              ['Warm cream', PIP_COLORS.cream],
              ['Teal core', PIP_COLORS.teal],
              ['Cobalt boots', PIP_COLORS.cobalt],
              ['Purple accent', PIP_COLORS.purple],
              ['Screen', PIP_COLORS.face],
            ].map(([n, c]) => (
              <div key={n} className="swatch">
                <span style={{ background: c }} />
                <small>{n}</small>
              </div>
            ))}
          </div>
          <h4>8-bit world palette</h4>
          <div className="palette8">
            {PALETTE_8.map((c) => (
              <span key={c} style={{ background: c }} title={c} />
            ))}
          </div>
        </div>
        <div className="card card--wide">
          <h3>Expressions</h3>
          <div className="faces">
            {expressions.map((e) => (
              <figure key={e}>
                <FaceTile expr={e} era={5} />
                <FaceTile expr={e} era={0} />
                <figcaption>{e}</figcaption>
              </figure>
            ))}
          </div>
          <p className="muted">Top: Beyond screen-face. Bottom: the same face resolved at 16×16 for the 8-bit sprite.</p>
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ environment

const VIEWS = [
  { id: 'field', label: 'Awakening Field', pose: { target: v3(3, 1.6, 0), yaw: 0, pitch: 0.05, fov: 13, dist: 44 } },
  { id: 'ruins', label: 'Shard Ruins', pose: { target: v3(31, 2.6, 0), yaw: 0, pitch: 0.05, fov: 13, dist: 46 } },
  { id: 'passage', label: 'Broken Passage', pose: { target: v3(63, 2, 0), yaw: 0, pitch: 0.05, fov: 13, dist: 50 } },
  { id: 'chamber', label: 'Hidden Chamber (3D)', pose: { target: v3(57, 0.6, -5.5), yaw: -0.85, pitch: 0.55, fov: 45, dist: 17 } },
  { id: 'stair', label: 'Painted Stair', pose: { target: v3(106, 5.2, 0), yaw: 0, pitch: 0.04, fov: 13, dist: 66 } },
  { id: 'alcove', label: 'Lamp Alcove (3D)', pose: { target: v3(106, 1.5, 3.5), yaw: 0.55, pitch: 0.38, fov: 45, dist: 16 } },
  { id: 'gate', label: 'Frame Gate (3D)', pose: { target: v3(142, 11, -0.9), yaw: 0.6, pitch: 0.12, fov: 40, dist: 14 } },
  { id: 'vista', label: 'Grand Vista', pose: { target: v3(60, 4, -10), yaw: 0.34, pitch: 0.14, fov: 42, dist: 42 } },
];

function WorldStage({ view, era }: { view: (typeof VIEWS)[number]; era: Era | 'split' }) {
  const { camera, gl } = useThree();
  const game = useMemo(() => makeMenuGame(), []);
  const gv = useMemo(() => new GameView(game, camera as THREE.PerspectiveCamera, gl, { split: true }), [game, camera, gl]);
  useEffect(() => () => gv.dispose(), [gv]);
  useEffect(() => {
    game.camera.override = { ...view.pose, target: { ...view.pose.target } };
    game.camera.overrideW = 1;
    game.camera.snap(game.cameraContext());
    if (game.puzzle.state === 'broken') game.puzzle.setSolved();
    if (game.stair.state === 'faded' && view.id !== 'stair' && view.id !== 'alcove') game.stair.setSolved();
  }, [game, view]);
  useFrame((_, dt) => {
    gv.options.split = era === 'split';
    if (era !== 'split') game.era.set(era);
    game.update(Math.min(dt, 0.1));
  }, -1);
  useFrame((_, dt) => gv.update(Math.min(dt, 0.1)), 0);
  useFrame(() => gv.render(gl), 1);
  return null;
}

function EnvironmentSheet() {
  const [view, setView] = useState(VIEWS[0]);
  const [era, setEra] = useState<Era | 'split'>('split');
  return (
    <div className="sheet">
      <section className="sheet__hero">
        <div className="sheet__canvas sheet__canvas--wide">
          <Canvas shadows={{ type: THREE.PCFShadowMap }} flat dpr={[1, 1.5]} gl={{ antialias: false }} camera={{ fov: 13, near: 0.3, far: 900 }}>
            <WorldStage view={view} era={era} />
          </Canvas>
          {era === 'split' && <EraLabels />}
        </div>
        <div className="sheet__poses">
          {VIEWS.map((v) => (
            <button key={v.id} className={`chip ${view.id === v.id ? 'is-on' : ''}`} onClick={() => setView(v)}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="sheet__poses">
          {(['split', ...ERAS] as const).map((e) => (
            <button key={String(e)} className={`chip chip--era ${era === e ? 'is-on' : ''}`} onClick={() => setEra(e)}>
              {e === 'split' ? 'All six' : ERA_NAMES[e]}
            </button>
          ))}
        </div>
      </section>
      <section className="sheet__grid">
        <div className="card">
          <h3>One world, six generations</h3>
          <p>
            Every view above is the real, playable level. A generation is a rendering treatment over the same geometry:
            pixel grids and palettes, jittery low-poly polygons, cel shading with ink lines, physically based light, and
            finally light shafts, ambient occlusion, depth of field and atmosphere.
          </p>
        </div>
        <div className="card">
          <h3>Patchwork Planet</h3>
          <p>
            Cheerful on the surface, ancient underneath. Teal glyphs, abandoned robots, a mural that remembers a
            staircase, and a vast ring on the horizon — the Frame Engine — hint that the meadow is only the outer layer
            of something built.
          </p>
        </div>
        <div className="card">
          <h3>Two lessons of perspective</h3>
          <p>
            The Broken Passage teaches that 3D reveals what 2D hides: a chamber behind the scenery. The Painted Stair
            teaches the reverse: flattened into 2D, a painting of stairs becomes stairs.
          </p>
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ interface

const SAMPLE: HudState = {
  era: 0,
  cells: 2,
  bits: 12,
  totalBits: 44,
  shift: 'ready',
  mode3d: false,
  prompt: { keys: ['E'], text: 'Dimension Shift', tone: 'info' },
  banner: null,
  expression: 'happy',
  finaleCard: false,
  cinematic: false,
  visited: ['field', 'ruins', 'falls', 'passage', 'chamber', 'ridge', 'stair'],
  room: 'stair',
  shardTaken: true,
  shiftUnlocked: true,
  bridgeRepaired: true,
  stairRepaired: false,
  gatePassed: false,
  eraKeys: false,
  maxCells: 3,
  objective: 'Chapter 2 · Colour',
  dialogue: null,
  regress: false,
  bubbleEra: -1,
  wheelOpen: false,
  regressEra: 0,
  maxEraUnlocked: 0,
};

const BOARD_EXPR: Expression[] = ['happy', 'determined', 'surprised', 'happy', 'wonder', 'idle'];

function InterfaceSheet() {
  return (
    <div className="sheet">
      <section className="ui-boards">
        {ERAS.map((e) => (
          <div key={e} className={`ui-board ui-board--${e}`} data-era={e}>
            <div className="ui-board__label">{ERA_NAMES[e]} HUD</div>
            <div className="ui-board__screen">
              <HudView static hud={{ ...SAMPLE, era: e, mode3d: e >= 2, expression: BOARD_EXPR[e] }} />
              <div className="hud" data-era={e}>
                <div className="hud__prompt hud__prompt--info ui-board__prompt">
                  <kbd>E</kbd>
                  <span>Dimension Shift</span>
                </div>
              </div>
            </div>
            <div className="ui-board__buttons overlay-skin" data-era={e}>
              <button className="menu__btn menu__btn--primary">Resume</button>
              <button className="menu__btn">Settings</button>
            </div>
          </div>
        ))}
      </section>
      <section className="sheet__grid">
        <div className="card card--wide">
          <h3>An interface that evolves with the world</h3>
          <p>
            The HUD is one component with six skins, switched by the current generation: blocky 8-bit boxes, colourful
            bevelled 16-bit console panels, chunky early-3D plastic, comic-ink stylized bubbles, clean modern glass, and
            Beyond's thin holographic linework. It stays minimal: portrait, energy cells, bits, generation, the
            dimension-shift state and a single contextual prompt.
          </p>
        </div>
      </section>
    </div>
  );
}

function MapSheet() {
  return (
    <div className="sheet">
      <section className="mapframe mapframe--sheet" data-era={4}>
        <WorldMap hud={{ ...SAMPLE, era: 4 }} />
      </section>
      <section className="sheet__grid">
        <div className="card card--wide">
          <h3>Connected world concept</h3>
          <p>
            The surface (Pixel Meadows → Painted Woods) is bright and readable. The Skybound Isles drift above; Clockwork
            Hollow and the Forgotten Core spread below, getting stranger and more technological with depth, ending at
            Beyond the Frame. Diamonds mark upgrades; dashed rooms are undiscovered; iso rooms are hidden 3D spaces —
            reachable only through depth.
          </p>
        </div>
      </section>
    </div>
  );
}
