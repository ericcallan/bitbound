import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { makeShowcaseGame } from './session';
import type { Expression, PipAction } from '../game/sim/Game';
import { ERA_NAMES, ERAS, generationFlag, type Era } from '../game/era/EraSystem';
import { audio } from '../game/audio/AudioEngine';
import { v3 } from '../game/math';
import { ART_PAGES, artPage, type ArtCard } from '../content/artCopy';
import { SHARE } from '../shareCopy';
import { ShareButton } from './ShareButton';
import { GenerationTimeline } from './GenerationTimeline';
import { PipGLB } from '../game/pip/PipGLB';
import { PixelSprite } from '../game/render/sprites';
import { Sprite16 } from '../game/render/retro/sprites16';
import { loadHdSky } from '../game/render/sky';

/** The Art & Design page, one tab per address (/art/, /art/environment/ ...; see ui/router.ts and content/artCopy.ts). */
export function Gallery() {
  const ui = useUI();
  const page = artPage(ui.galleryTab);
  useEffect(() => {
    document.title = page.title;
    return () => {
      document.title = SHARE.title;
    };
  }, [page]);
  return (
    <div className="gallery">
      <header className="gallery__head">
        <button className="menu__btn menu__btn--small" onClick={() => (audio.sfx('click'), ui.setScreen('menu'))}>
          ← Back
        </button>
        <h1>
          Bitbound <span>Art &amp; Design</span>
        </h1>
        <nav aria-label="Art & Design sections">
          {ART_PAGES.map((p) => (
            <button
              key={p.id}
              className={`gallery__tab ${ui.galleryTab === p.id ? 'is-on' : ''}`}
              aria-current={ui.galleryTab === p.id ? 'page' : undefined}
              onClick={() => (audio.sfx('hover'), ui.setGalleryTab(p.id))}
            >
              {p.label}
            </button>
          ))}
        </nav>
        <ShareButton className="share-btn--quiet gallery__share" path={page.path} title={page.title} text={page.description} />
      </header>
      <main className="gallery__body">
        <header className="sheet__intro">
          <h2>{page.heading}</h2>
          <p>{page.intro}</p>
        </header>
        {ui.galleryTab === 'character' && <CharacterSheet />}
        {ui.galleryTab === 'environment' && <EnvironmentSheet />}
        {ui.galleryTab === 'interface' && <InterfaceSheet />}
        {ui.galleryTab === 'map' && <MapSheet />}
      </main>
    </div>
  );
}

/** A card from content/artCopy.ts. */
function CopyCard({ card, wide, children }: { card: ArtCard; wide?: boolean; children?: ReactNode }) {
  return (
    <div className={`card ${wide ? 'card--wide' : ''}`}>
      <h3>{card.title}</h3>
      {card.body.map((t, i) => (
        <p key={i}>{t}</p>
      ))}
      {card.list && (
        <ul className="traits">
          {card.list.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      {children}
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
  // each band draws Pip the way that generation does in play: the 8-bit sprite, the pre-rendered 16-bit sprite,
  // the classic rig for Early 3D and Stylized, and the Blender model for Modern HD and Beyond
  const pips = useMemo(() => ERAS.map(() => new PipModel()), []);
  const hd = useMemo(() => [new PipGLB(), new PipGLB()], []);
  const sprite8 = useMemo(() => new PixelSprite('pip', 1.04, 1.04), []);
  const sprite16 = useMemo(() => new Sprite16('pip_idle'), []);
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
      if (i >= 2 && i <= 3) scene.add(p.root, p.trail);
    });
    hd.forEach((h) => scene.add(h.root));
    sprite8.sprite.visible = true;
    scene.add(sprite8.sprite, sprite16.sprite);
    // the modern generations are lit by the game's real sky
    void loadHdSky(gl, 'day').then((sky) => {
      scene.environment = sky.env;
      scene.environmentIntensity = 0.7;
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
      if (i === 0) {
        // the 8-bit sprite: idle, two walk frames, jump; snapped to its pixel grid like in play
        sprite8.set(pose.air ? 3 : pose.run ? 1 + (Math.floor(t.current * 8) % 2) : 0, false);
        sprite8.sprite.position.set(LINEUP_X[0], base.y, 0);
      } else if (i === 1) {
        sprite16.set(pose.air ? 'pip_jump' : pose.run ? `pip_walk${Math.floor(t.current * 10) % 4}` : 'pip_idle', false);
        sprite16.sprite.position.set(LINEUP_X[1], base.y, 0);
      } else if (i >= 4) {
        const h = hd[i - 4];
        h.update({ ...pp, heading: Math.PI / 2 - 0.35 }, dt);
        h.root.position.copy(base);
      } else {
        p.update(pp, dt);
        p.root.rotation.y -= 0.35;
      }
    });
    const screen = LINEUP_SPLIT.map((x) => new THREE.Vector3(x, 0.5, 0).project(camera).x * 0.5 + 0.5);
    post.render(
      gl,
      scene,
      camera as THREE.PerspectiveCamera,
      {
        retro: null,
        retro2D: false,
        laneZ: 0,
        letterbox: 0,
        retroK: 1,
        letterboxRows: 240,
        retro16: null,
        camXY: new THREE.Vector2(),
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
        <CopyCard card={artPage('character').cards[0]} />
        <CopyCard card={artPage('character').cards[1]} />
        <CopyCard card={artPage('character').cards[2]}>
          <img className="card__art" src={`${import.meta.env.BASE_URL}ui/pip_hd.webp`} alt="Pip as built in Blender: orange and cream body, dark screen-face with two eyes, one antenna." />
        </CopyCard>
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

/** A side-on 2D view of the lane at x, framed like play (fov 13, 9.2 units tall). */
const side = (x: number, y: number, dist = 44) => ({ target: v3(x, y, 0), yaw: 0, pitch: 0.05, fov: 13, dist });
/** The aqueduct's 2D view: the camera's eye at deck height, so the two halves meet on the horizon (as in play). */
const AQ_DIST = 34.7;
const VIEWS = [
  { id: 'field', label: 'Awakening Field', pose: side(4, 1.6) },
  { id: 'ruins', label: 'Shard Ruins', pose: side(31, 2.6, 46) },
  { id: 'valley', label: 'Opening Valley (3D)', pose: { target: v3(24, 3.5, -8), yaw: 0.35, pitch: 0.12, fov: 55, dist: 22 } },
  { id: 'passage', label: 'Broken Passage', pose: side(57, 2, 46) },
  { id: 'chamber', label: 'Hidden Chamber (3D)', pose: { target: v3(57, 0.6, -5.5), yaw: -0.85, pitch: 0.55, fov: 45, dist: 17 } },
  { id: 'stair', label: 'Painted Stair', pose: side(106, 5.2, 66) },
  { id: 'plateau', label: 'Plateau', pose: side(138, 11, 46) },
  { id: 'halo', label: 'Halo Path', pose: side(172, 12.6, 46) },
  { id: 'aqueduct', label: 'Broken Aqueduct', pose: { target: v3(219, 12.85, 0), yaw: 0, pitch: Math.asin(-0.35 / AQ_DIST), fov: 13, dist: AQ_DIST } },
  // raised, from in front of the canyon: the aqueduct runs across the frame, so it spans the six-way split
  { id: 'aqueduct3d', label: 'Broken Aqueduct (3D)', pose: { target: v3(220, 8.5, -1), yaw: 0.02, pitch: 0.3, fov: 46, dist: 30 } },
  { id: 'summit', label: 'Summit', pose: side(238, 14.4, 46) },
  { id: 'vista', label: 'Grand Vista', pose: { target: v3(60, 4, -10), yaw: 0.34, pitch: 0.14, fov: 42, dist: 42 } },
];

function WorldStage({ view, era }: { view: (typeof VIEWS)[number]; era: Era | 'split' }) {
  const { camera, gl } = useThree();
  const game = useMemo(() => makeShowcaseGame(), []);
  // the valley as in play (terrain, Blender dressing, the aqueduct), not the old box level
  const gv = useMemo(() => new GameView(game, camera as THREE.PerspectiveCamera, gl, { split: true, immersive: true }), [game, camera, gl]);
  useEffect(() => () => gv.dispose(), [gv]);
  useEffect(() => {
    game.camera.override = { ...view.pose, target: { ...view.pose.target } };
    game.camera.overrideW = 1;
    game.camera.snap(game.cameraContext());
    if (game.puzzle.state === 'broken') game.puzzle.setSolved();
    if (game.stair.state === 'faded' && view.id !== 'stair' && view.id !== 'alcove') game.stair.setSolved();
    // past the seal door its glyphs are read and it has sunk away
    game.world.get('sealDoor')!.enabled = false;
    game.sealOpen = 1;
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
            <button key={String(e)} className={`chip chip--era ${era === e ? 'is-on' : ''}`} title={e === 'split' ? undefined : generationFlag(e)} onClick={() => setEra(e)}>
              {e === 'split' ? 'All six' : ERA_NAMES[e]}
            </button>
          ))}
        </div>
      </section>
      <section className="sheet__grid">
        <CopyCard card={artPage('environment').cards[0]} />
        <CopyCard card={artPage('environment').cards[1]} />
        <CopyCard card={artPage('environment').cards[2]} wide>
          <div className="compare">
            {[
              ['aqueduct-2d', 'In 2D, from the side'],
              ['aqueduct-3d', 'In 3D'],
            ].map(([f, label]) => (
              <figure key={f}>
                <div className="compare__pair">
                  <img src={`${import.meta.env.BASE_URL}art/${f}-before.jpg`} alt={`The broken aqueduct ${label.toLowerCase()}, before: two stone slabs between bare canyon walls.`} loading="lazy" />
                  <img src={`${import.meta.env.BASE_URL}art/${f}-after.jpg`} alt={`The broken aqueduct ${label.toLowerCase()}, after: a ruined two-tier aqueduct with water pouring from the break, ivy and waterfalls.`} loading="lazy" />
                </div>
                <figcaption>
                  {label}: before · after
                </figcaption>
              </figure>
            ))}
          </div>
        </CopyCard>
        <CopyCard card={artPage('environment').cards[3]} wide />
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ interface

const SAMPLE: HudState = {
  era: 0,
  cells: 2,
  bits: 23,
  totalBits: 65,
  shift: 'ready',
  shiftWhy: '',
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
              <HudView
                static
                hud={{ ...SAMPLE, era: e, mode3d: e >= 2, expression: BOARD_EXPR[e], ...(e === 5 ? { shift: 'blocked' as const, shiftWhy: "Can't unfold here", mode3d: false } : {}) }}
              />
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
        <CopyCard card={artPage('interface').cards[0]} wide />
        <CopyCard card={artPage('interface').cards[1]} wide>
          <figure className="title-shot">
            <img src={`${import.meta.env.BASE_URL}art/title-screen.jpg`} alt="The Bitbound title screen: the logo and menu on the left, Pip on a mossy rock above a valley with a waterfall and a stone ring." loading="lazy" />
          </figure>
          <TimelineDemo />
        </CopyCard>
      </section>
    </div>
  );
}

/** The title screen's generation timeline, live (picking one here just highlights it). */
function TimelineDemo() {
  const [sel, setSel] = useState<Era>(5);
  const [prev, setPrev] = useState<Era | null>(null);
  return (
    <div className="timeline-demo">
      <GenerationTimeline shown={prev ?? sel} selected={sel} onPreview={setPrev} onSelect={setSel} />
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
        <CopyCard card={artPage('map').cards[0]} wide />
      </section>
    </div>
  );
}
