import { World, overlaps, type Collider } from '../collision/World';
import { LEVEL, type Level } from '../level/meadows';
import { NO_INTENT, PlayerController, type MoveIntent, type PlayerEvent } from '../player/PlayerController';
import { DimensionShift, type ShiftBlock } from '../shift/DimensionShift';
import { EraSystem, ERA_NAMES, ERA_TITLES, type Bubble, type Era } from '../era/EraSystem';
import { CameraRig, type CameraContext } from '../camera/CameraRig';
import { BrokenPassage } from '../puzzle/BrokenPassage';
import { PaintedStair } from '../puzzle/PaintedStair';
import { Glitchling, Mover, type Bit } from '../entities/entities';
import { newSave, writeSave, type SaveData } from '../save/save';
import { SCRIPT, lineDuration, type Line, type LineId } from '../story/script';
import { DEATH_Y, LANE_TOLERANCE, MAX_CELLS, STEP } from './constants';
import type { Action, InputSource } from './Input';
import { clamp, dist2D, v3, type V3 } from '../math';
import { valleyCollideHeight, WATER_Y } from '../level/valley';

export type PipAction = 'none' | 'stumble' | 'fistpump' | 'inspect' | 'surprised' | 'dance' | 'hurt' | 'wave';
export type Expression = 'idle' | 'happy' | 'surprised' | 'panic' | 'dizzy' | 'determined' | 'sleepy' | 'hurt' | 'wonder';

export type GameEventType =
  | 'jump'
  | 'land'
  | 'step'
  | 'bump'
  | 'stumble'
  | 'pushStart'
  | 'collect'
  | 'stomp'
  | 'hurt'
  | 'respawn'
  | 'fizzle'
  | 'shiftStart'
  | 'shiftEnd'
  | 'eraStart'
  | 'eraDone'
  | 'shard'
  | 'device'
  | 'plate'
  | 'bridgeStart'
  | 'bridgeDone'
  | 'lamp'
  | 'stairDone'
  | 'gate'
  | 'checkpoint'
  | 'cubeReset'
  | 'pixelBlink'
  | 'machineBeam'
  | 'assemble'
  | 'awake'
  | 'fistpump'
  | 'reveal'
  | 'finale'
  | 'antenna'
  | 'banner'
  | 'line'
  | 'bubbleOn'
  | 'bubbleOff'
  | 'bubblePop'
  | 'glyphs'
  | 'wheel';

export interface GameEvent {
  type: GameEventType;
  pos?: V3;
  value?: number;
  text?: string;
}

type CineName = 'awakening' | 'shard' | 'device' | 'bridge' | 'beacon' | 'stair' | 'gate' | 'glyphs' | 'summit';

interface Cine {
  name: CineName;
  t: number;
  fired: Set<string>;
}

export interface Banner {
  title: string;
  subtitle: string;
  era: Era;
  id: number;
}

export interface Prompt {
  keys: string[];
  text: string;
  tone?: 'info' | 'warn' | 'story';
}

export interface Dialogue {
  speaker: Line['s'];
  text: string;
  id: number;
}

export type GameMode = 'play' | 'menu';

export const ROOMS: { id: string; test: (p: V3) => boolean }[] = [
  { id: 'field', test: (p) => p.x < 16 },
  { id: 'ruins', test: (p) => p.x >= 16 && p.x < 40 },
  { id: 'falls', test: (p) => p.x >= 40 && p.x < 52 },
  { id: 'passage', test: (p) => p.x >= 52 && p.x < 62 && p.z > -1.3 },
  { id: 'chamber', test: (p) => p.x >= 52 && p.x < 62 && p.z <= -1.3 },
  { id: 'ridge', test: (p) => p.x >= 62 && p.x < 100 },
  { id: 'stair', test: (p) => p.x >= 100 && p.x < 112 && p.z < 2.5 },
  { id: 'alcove', test: (p) => p.x >= 100 && p.x < 112 && p.z >= 2.5 },
  { id: 'plateau', test: (p) => p.x >= 112 && p.x < 141 },
  { id: 'gate', test: (p) => p.x >= 141 && p.x < 166 },
  { id: 'brambles', test: (p) => p.x >= 166 && p.x < 184 },
  { id: 'cliff', test: (p) => p.x >= 184 && p.x < 198 },
  { id: 'seal', test: (p) => p.x >= 198 && p.x < 214 },
  { id: 'aqueduct', test: (p) => p.x >= 214 && p.x < 226 },
  { id: 'summit', test: (p) => p.x >= 226 },
];
export const roomAt = (p: V3) => ROOMS.find((r) => r.test(p))?.id ?? 'field';

const ERA_KEYS: [Action, Era][] = [
  ['era1', 0],
  ['era2', 1],
  ['era3', 2],
  ['era4', 3],
  ['era5', 4],
  ['era6', 5],
];

/** Chapter headings, shown as the HUD objective line. */
export const CHAPTERS = ['Ch 1 · Boot', 'Ch 2 · Colour', 'Ch 3 · Depth', 'Ch 4 · Ink', 'Ch 5 · Light', 'Ch 6 · The Waking World'];

export const BUBBLE_RADIUS = 3.0;

/**
 * The authoritative game simulation. Pure TypeScript with no rendering or DOM dependencies,
 * so the whole game can be played headlessly in tests.
 */
export class Game {
  readonly level: Level = LEVEL;
  readonly world = new World();
  readonly player: PlayerController;
  readonly shift: DimensionShift;
  readonly era: EraSystem;
  readonly camera = new CameraRig();
  readonly puzzle: BrokenPassage;
  readonly stair: PaintedStair;
  readonly enemies: Glitchling[];
  readonly bits: Bit[];
  readonly movers: Mover[];

  save: SaveData;
  time = 0;
  /** Interpolation factor between the last two fixed steps, for rendering. */
  alpha = 0;
  private acc = 0;
  paused = false;

  cells = MAX_CELLS;
  readonly maxCells = MAX_CELLS;
  invuln = 0;
  checkpoint = 'start';
  activeCheckpoints = new Set<string>(['start']);

  cine: Cine | null = null;
  assemble = 1;
  action: PipAction = 'none';
  actionT = 0;
  idleT = 0;
  antennaGlitch = 0;
  lookAtCamera = 0;
  machineEye = 0;
  pixelGlow = 0;
  gateGlow = 0;
  /** 0..1: the sealed door sinking once the glyphs are read. */
  sealOpen = 0;
  /** 0..1: the world wheel turning at the summit. */
  wheelTurn = 0;
  fade = 0;
  fadeGoal = 0;
  /** Fade colour: false = dark, true = white (the ending). */
  fadeWhite = false;
  private respawnT = -1;

  banner: Banner | null = null;
  private bannerT = 0;
  private bannerId = 0;
  toast: Prompt | null = null;
  private toastT = 0;
  dialogue: Dialogue | null = null;
  private dialogueT = 0;
  private dialogueDur = 0;
  private dialogueId = 0;
  private dialogueQueue: Line[] = [];
  finaleCard = false;
  tutorialMoved = false;
  tutorialJumped = false;
  private sinceAwake = 0;
  seenChamber = false;
  seenAlcove = false;
  bitsCollected = 0;

  // Regress: projecting an older (or full) generation around Pip
  regressEra: Era = 0;
  wheelOpen = false;
  private wheelT = 0;
  private wheelPicked = false;

  private listeners = new Set<(e: GameEvent) => void>();
  readonly events: GameEvent[] = [];

  constructor(
    public input: InputSource,
    save: SaveData | null = null,
    public mode: GameMode = 'play',
  ) {
    this.era = new EraSystem(this.level.riftAnchors);
    // The glyph stones still sleep at 16-bit until full fidelity is projected over them.
    this.era.fields = [{ ...this.level.sleepField }];
    for (const s of this.level.solids) {
      this.world.add(s.id, s.kind, s.box, s.enabled ?? true, s.only2d ?? false, s.genMask);
    }
    this.world.genAt = (c: Collider) => this.era.gameEraAtBox(c.min, c.max);
    // The valley terrain: walkable in 3D inside the finished slice.
    this.world.terrain = valleyCollideHeight;
    this.movers = this.level.movers.map((m) => {
      const c = this.world.add(m.id, 'platform', {
        min: v3(m.minX - m.halfW, m.y - 0.4, -1),
        max: v3(m.minX + m.halfW, m.y, 1),
      });
      return new Mover(c, m.minX, m.maxX, m.period);
    });
    this.player = new PlayerController(this.world, (e) => this.onPlayerEvent(e));
    this.shift = new DimensionShift(this.world, this.player);
    this.puzzle = new BrokenPassage(this.world, this.level);
    this.stair = new PaintedStair(this.world, this.level);
    this.enemies = this.level.enemies.map((d) => new Glitchling(d));
    this.bits = this.level.bits.map((b) => ({ id: b.id, pos: { ...b.pos }, collected: false }));

    this.save = save ? { ...save } : newSave();
    this.applySave(this.save);

    if (mode === 'menu') {
      this.player.teleport(v3(2.2, 0, 0));
      this.player.dir = 1;
      this.era.set(0);
    } else if (!this.save.awakened) {
      this.startCine('awakening');
      this.assemble = 0;
    }
    this.camera.snap(this.cameraContext());
    if (this.cine?.name === 'awakening') this.awakeningCamera(true);
  }

  /** Back-compat helper: the first moving platform. */
  get mover() {
    return this.movers[0];
  }

  /** The generation whose rules apply at Pip's chest. */
  get pipEra(): Era {
    const p = this.player;
    return this.era.gameEraAt(v3(p.pos.x, p.pos.y + p.h * 0.5, p.pos.z));
  }

  get bubbleActive() {
    return this.era.bubble !== null;
  }

  on(fn: (e: GameEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(type: GameEventType, extra: Omit<GameEvent, 'type'> = {}) {
    const e: GameEvent = { type, ...extra };
    this.events.push(e);
    if (this.events.length > 200) this.events.shift();
    for (const l of this.listeners) l(e);
  }

  // ---------------------------------------------------------------- story

  /** Queue a story beat (each beat is spoken once per save). */
  say(id: LineId, force = false) {
    if (this.mode !== 'play') return;
    if (!force && this.save.story.includes(id)) return;
    this.save.story = [...this.save.story, id];
    this.dialogueQueue.push(...SCRIPT[id]);
    if (!this.dialogue) this.nextLine();
  }

  private nextLine() {
    const l = this.dialogueQueue.shift();
    if (!l) {
      this.dialogue = null;
      return;
    }
    this.dialogue = { speaker: l.s, text: l.t, id: ++this.dialogueId };
    this.dialogueT = 0;
    this.dialogueDur = lineDuration(l);
    this.emit('line', { text: l.s });
  }

  get speaking() {
    return this.dialogue !== null || this.dialogueQueue.length > 0;
  }

  /** Skip the current line (UI click / skip key). */
  advanceDialogue() {
    if (this.dialogue) this.nextLine();
  }

  // ---------------------------------------------------------------- save / load

  private applySave(s: SaveData) {
    this.era.set(s.era);
    this.shift.unlocked = s.shiftUnlocked;
    this.checkpoint = s.checkpoint;
    for (const id of s.bits) {
      const b = this.bits.find((x) => x.id === id);
      if (b) b.collected = true;
    }
    this.bitsCollected = this.bits.filter((b) => b.collected).length;
    if (s.bridgeRepaired) this.puzzle.setSolved();
    if (s.stairRepaired) this.stair.setSolved();
    if (s.awakened) this.tutorialMoved = this.tutorialJumped = true;
    if (s.glyphsRead) this.openSeal(true);
    if (s.finished) this.wheelTurn = 1;
    const cp = this.level.checkpoints.find((c) => c.id === s.checkpoint) ?? this.level.checkpoints[0];
    const order = this.level.checkpoints.map((c) => c.id);
    for (const id of order.slice(0, order.indexOf(cp.id) + 1)) this.activeCheckpoints.add(id);
    this.checkpoint = cp.id;
    this.player.teleport(cp.pos);
  }

  private persist() {
    if (this.mode !== 'play') return;
    this.save = {
      ...this.save,
      checkpoint: this.checkpoint,
      era: this.era.targetEra,
      shiftUnlocked: this.shift.unlocked,
      bridgeRepaired: this.puzzle.state !== 'broken',
      stairRepaired: this.stair.state !== 'faded',
      bits: this.bits.filter((b) => b.collected).map((b) => b.id),
    };
    writeSave(this.save);
  }

  // ---------------------------------------------------------------- main loop

  update(realDt: number) {
    this.acc += Math.min(realDt, 0.1);
    while (this.acc >= STEP) {
      this.fixedStep(STEP);
      this.acc -= STEP;
    }
    this.alpha = this.acc / STEP;
  }

  fixedStep(dt: number) {
    if (this.paused) return;
    this.time += dt;
    const p = this.player;
    const input = this.input;

    // Timers
    this.invuln = Math.max(0, this.invuln - dt);
    if (this.banner) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner = null;
    }
    if (this.toast) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toast = null;
    }
    if (this.dialogue) {
      this.dialogueT += dt;
      if (this.dialogueT >= this.dialogueDur) this.nextLine();
    }
    this.fade += Math.sign(this.fadeGoal - this.fade) * Math.min(Math.abs(this.fadeGoal - this.fade), dt * (this.fadeWhite ? 1.2 : 4));
    if (this.action !== 'none') {
      this.actionT += dt;
      const lengths: Record<PipAction, number> = { none: 0, stumble: 0.5, fistpump: 0.7, inspect: 2.6, surprised: 1.6, dance: Infinity, hurt: 0.5, wave: 1.6 };
      if (this.actionT > lengths[this.action]) this.action = 'none';
    }
    this.antennaGlitch = Math.max(0, this.antennaGlitch - dt);
    this.lookAtCamera = Math.max(0, this.lookAtCamera - dt);
    const gd = Math.abs(p.pos.x - this.level.gate.x);
    const gateTarget = this.save.gatePassed ? 1 : clamp(1 - (gd - 2) / 14, 0.15, 0.9);
    this.gateGlow += (gateTarget - this.gateGlow) * Math.min(1, dt * 2);
    if (this.save.glyphsRead) this.sealOpen = Math.min(1, this.sealOpen + dt * 0.5);
    if (this.save.finished || this.cine?.name === 'summit') this.wheelTurn += dt * (this.save.finished ? 0.08 : 0.04);

    // World systems
    const eraDone = this.era.step(dt, p.pos.x);
    if (eraDone !== null) {
      this.emit('eraDone', { value: eraDone });
      if (this.mode === 'play') this.persist();
    }
    if (this.era.bubble) {
      this.era.bubble.x = p.pos.x;
      this.era.bubble.y = p.pos.y + p.h * 0.5;
      this.era.bubble.z = p.pos.z;
    }
    for (const m of this.movers) {
      m.step(dt);
      this.resolveMoverPush(m);
    }
    const shiftDone = this.shift.step(dt);
    if (shiftDone) this.onShiftDone();
    if (this.cine) this.stepCine(dt);

    // Respawn sequence
    if (this.respawnT >= 0) {
      this.respawnT += dt;
      if (this.respawnT > 0.32 && this.fade >= 0.99) this.finishRespawn();
    }

    // Intent
    const blocking = !!this.cine || this.shift.busy || this.respawnT >= 0 || this.mode === 'menu' || this.finaleCard;
    let intent: MoveIntent = NO_INTENT;
    if (!blocking) {
      this.stepRegressInput(dt);
      if (input.consume('shift')) this.requestShift();
      if (this.save.eraKeys && !this.wheelOpen) {
        for (const [k, e] of ERA_KEYS) if (input.consume(k)) this.changeEra(e, 1.8);
      }
      const ax = input.axisX();
      const ay = input.axisY();
      const jumpPressed = input.consume('jump');
      if (this.shift.mode === '2d') {
        intent = { mx: ax, mz: 0, jumpPressed, jumpHeld: input.held('jump') };
      } else {
        const r = this.camera.relativeInput(ax, ay);
        intent = { mx: r.mx, mz: r.mz, jumpPressed, jumpHeld: input.held('jump') };
      }
      if (Math.abs(ax) > 0.2) this.tutorialMoved = true;
      if (jumpPressed) this.tutorialJumped = true;
    } else {
      // Don't let presses made during a cinematic fire afterwards.
      for (const a of ['jump', 'shift', 'regress'] as Action[]) input.consume(a);
      for (const [k] of ERA_KEYS) input.consume(k);
      this.wheelOpen = false;
      if (this.cine?.name === 'awakening' && (input.consume('skip') || input.consume('jump'))) this.skipAwakening();
      if (this.dialogue && this.cine?.name === 'summit' && input.consume('skip')) this.advanceDialogue();
    }

    const frozen = this.shift.busy || this.respawnT >= 0 || this.cine?.name === 'awakening' || this.cine?.name === 'gate' || this.cine?.name === 'summit';
    p.step(dt, intent, frozen ? 'frozen' : this.shift.mode);

    // Idle personality
    const moving = Math.hypot(p.vel.x, p.vel.z) > 0.3 || !p.grounded;
    this.idleT = moving || blocking ? 0 : this.idleT + dt;
    if (this.idleT > 2.5 && this.idleT < 2.5 + dt * 1.5) this.lookAtCamera = 2.8;
    if (this.idleT > 7 && Math.floor(this.idleT / 7) !== Math.floor((this.idleT - dt) / 7)) {
      this.antennaGlitch = 0.9;
      this.emit('antenna', { pos: { ...p.pos } });
    }

    this.stepGlitchlings(dt, frozen);

    if (this.mode === 'play') {
      this.stepPickups();
      this.stepTriggers();
    }

    // Puzzles
    const pz = this.puzzle.step(dt);
    if (pz === 'latched') this.startCine('bridge');
    if (pz === 'repaired') {
      this.camera.shake = 0.6;
      this.emit('bridgeDone', { pos: v3(67, 0, 0) });
      this.persist();
    }
    const sz = this.stair.step(dt);
    if (sz === 'latched') this.startCine('stair');
    if (sz === 'complete') {
      this.camera.shake = 0.4;
      this.emit('stairDone', { pos: { ...this.level.lampSocket } });
      this.say('stairDone');
      this.persist();
    }

    // Falling out of the world, or into deep river water in the valley
    const drowned = p.pos.y < WATER_Y - 0.6 && valleyCollideHeight(p.pos.x, p.pos.z) !== null;
    if ((p.pos.y < DEATH_Y || drowned) && this.respawnT < 0) {
      this.cells -= 1;
      this.emit('hurt', { pos: { ...p.pos } });
      this.beginRespawn();
    }

    // Visited rooms (world map)
    const room = roomAt(p.pos);
    if (this.mode === 'play' && !this.save.visited.includes(room)) this.save.visited = [...this.save.visited, room];

    this.sinceAwake += dt;
    this.camera.step(dt, this.cameraContext());
  }

  cameraContext(): CameraContext {
    const orbit = this.mode === 'play' && !this.cine ? this.input.takeOrbit() : { yaw: 0, pitch: 0, active: false };
    return {
      pip: this.player.pos,
      vel: this.player.vel,
      grounded: this.player.grounded,
      blend: this.shift.blend,
      orbit,
      recenter: this.input.held('recenter'),
      bounds: this.level.bounds,
      raycast: (a, b) => this.world.raycast(a, b, (c) => c.kind !== 'invisible' && c.kind !== 'cube' && c.max.y > a.y - 0.6),
      laneZ: this.shift.laneZ,
      groundAt: valleyCollideHeight,
    };
  }

  // ---------------------------------------------------------------- Regress

  private stepRegressInput(dt: number) {
    const input = this.input;
    if (!this.save.regress) {
      input.consume('regress');
      return;
    }
    if (input.consume('regress')) {
      this.wheelOpen = true;
      this.wheelT = 0;
      this.wheelPicked = false;
    }
    if (!this.wheelOpen) return;
    this.wheelT += dt;
    for (const [k, e] of ERA_KEYS) {
      if (input.consume(k)) {
        this.regressEra = e;
        this.wheelPicked = true;
      }
    }
    if (!input.held('regress')) {
      this.wheelOpen = false;
      const b = this.era.bubble;
      if (!this.wheelPicked && this.wheelT < 0.3) {
        // Tap: toggle the last generation.
        this.applyRegress(b ? null : this.regressEra);
      } else {
        this.applyRegress(b && b.era === this.regressEra ? null : this.regressEra);
      }
    }
  }

  /** Project (or drop) a generation bubble, refusing if it would leave Pip inside something. */
  applyRegress(era: Era | null) {
    const p = this.player;
    const base = this.era.baseEraAt(p.pos);
    if (era === null || (era === base && this.era.gameEraAt(p.pos) === base)) return this.setBubble(null);
    const b: Bubble = { x: p.pos.x, y: p.pos.y + p.h * 0.5, z: p.pos.z, r: BUBBLE_RADIUS, era };
    return this.setBubble(b);
  }

  /** Change the bubble safely. Returns false (with feedback) if Pip would end up inside a solid. */
  setBubble(b: Bubble | null, quiet = false, force = false): boolean {
    const prev = this.era.bubble;
    if (prev === b) return true;
    this.era.bubble = b;
    const safe = force || this.world.isFree(this.player.box());
    if (!safe) {
      this.era.bubble = prev;
      if (!quiet) {
        this.toast = { keys: [], text: "Can't — something would appear right where you're standing.", tone: 'warn' };
        this.toastT = 2.2;
        this.emit('fizzle', { pos: { ...this.player.pos }, text: 'regress' });
      }
      return false;
    }
    this.emit(b ? 'bubbleOn' : quiet ? 'bubblePop' : 'bubbleOff', { pos: { ...this.player.pos }, value: b?.era ?? -1 });
    return true;
  }

  // ---------------------------------------------------------------- enemies and hazards

  private stepGlitchlings(dt: number, frozen: boolean) {
    const p = this.player;
    const enemyPause = this.shift.busy || !!this.cine || this.mode === 'menu';
    for (const e of this.enemies) {
      e.step(dt, enemyPause);
      if (!e.alive || frozen || this.respawnT >= 0 || this.cine) continue;
      if (overlaps(p.box(), e.box(), -0.02)) {
        if (p.vel.y < 0 && p.pos.y > e.pos.y + e.h * 0.45) {
          e.alive = false;
          p.bounce(this.input.held('jump'));
          this.camera.shake = Math.max(this.camera.shake, 0.35);
          this.emit('stomp', { pos: { ...e.pos } });
        } else {
          this.hurt(1, e.pos);
        }
      }
    }
  }

  /**
   * A platform sliding into Pip pushes him along; if he is pinned against a wall he is crushed
   * (a hit and a respawn) rather than ever ending up inside the platform.
   */
  private resolveMoverPush(m: Mover) {
    const p = this.player;
    const c = m.collider;
    const dx = c.delta.x;
    if (!dx || p.ground === c || this.respawnT >= 0) return;
    const box = p.box();
    if (!overlaps(box, c, 0.001)) return;
    const need = dx > 0 ? c.max.x - box.min.x + 0.001 : c.min.x - box.max.x - 0.001;
    const r = this.world.sweep(box, 'x', need, c);
    p.pos.x = (box.min.x + box.max.x) / 2;
    p.prevPos.x = p.pos.x;
    if (Math.abs(r.moved - need) > 1e-4 || overlaps(p.box(), c, 0.001)) {
      // Pinned: drop out from under the platform so he is never drawn inside it, then respawn.
      const below = { ...p.pos, y: c.min.y - p.h - 0.02 };
      if (this.world.isFree(p.box(below), c)) p.pos.y = p.prevPos.y = below.y;
      this.cells -= 1;
      this.emit('hurt', { pos: { ...p.pos } });
      this.beginRespawn();
    }
  }

  // ---------------------------------------------------------------- player feedback

  private onPlayerEvent(e: PlayerEvent) {
    const p = this.player;
    switch (e.type) {
      case 'land':
        this.emit('land', { pos: { ...p.pos }, value: e.impact });
        if (e.impact > 21) this.camera.shake = Math.max(this.camera.shake, 0.25);
        if (e.distance > 3.6 && e.airTime > 0.5 && this.action === 'none') {
          this.setAction('fistpump');
          this.emit('fistpump', { pos: { ...p.pos } });
        }
        break;
      case 'stumble':
        if (this.action === 'none') this.setAction('stumble');
        this.emit('stumble', { pos: { ...p.pos } });
        break;
      default:
        this.emit(e.type, { pos: { ...p.pos } });
    }
  }

  setAction(a: PipAction) {
    this.action = a;
    this.actionT = 0;
  }

  private hurt(dmg: number, from: V3) {
    if (this.invuln > 0 || this.respawnT >= 0) return;
    const p = this.player;
    this.cells -= dmg;
    this.invuln = 1.4;
    const dir = Math.sign(p.pos.x - from.x) || -p.dir;
    p.vel.x = dir * 6;
    p.vel.y = 9;
    p.grounded = false;
    this.setAction('hurt');
    this.camera.shake = 0.5;
    this.emit('hurt', { pos: { ...p.pos }, value: dmg });
    if (this.cells <= 0) this.beginRespawn();
  }

  private beginRespawn() {
    if (this.respawnT >= 0) return;
    this.respawnT = 0;
    this.fadeWhite = false;
    this.fadeGoal = 1;
  }

  private finishRespawn() {
    const list = this.level.checkpoints;
    const cp = list.find((c) => c.id === this.checkpoint) ?? list[0];
    this.setBubble(null, true, true);
    this.player.teleport(cp.pos);
    if (this.cells <= 0) this.cells = this.maxCells;
    this.invuln = 1.0;
    this.respawnT = -1;
    this.fadeGoal = 0;
    if (this.action === 'hurt') this.action = 'none';
    this.camera.snap(this.cameraContext());
    for (const e of this.enemies) if (e.alive) e.pos.x = e.def.x;
    this.emit('respawn', { pos: { ...cp.pos } });
  }

  private stepPickups() {
    const p = this.player;
    const cx = p.pos.x;
    const cy = p.pos.y + p.h / 2;
    const cz = p.pos.z;
    for (const b of this.bits) {
      if (b.collected) continue;
      if (Math.hypot(b.pos.x - cx, b.pos.y - cy, b.pos.z - cz) < 0.78) {
        b.collected = true;
        this.bitsCollected++;
        this.emit('collect', { pos: { ...b.pos }, value: this.bitsCollected });
      }
    }
  }

  // ---------------------------------------------------------------- triggers

  private stepTriggers() {
    const p = this.player;
    const L = this.level;
    if (this.cine || this.respawnT >= 0) return;
    const x = p.pos.x;
    if (this.save.awakened && this.era.era === 0 && x > 11.5 && x < 16) this.say('holes');
    if (this.era.era === 0 && x > 27 && x < 31) this.say('goodJob');
    if (this.era.displayEra >= 1 && x > 36 && x < 46) this.say('deadPixel');
    if (x > 98 && x < 104 && this.save.beaconLit) this.say('mural');
    if (this.save.regress && x > 114.5 && x < L.fenceX) this.say('fence');
    if (x > L.fenceX + 0.8 && x < 125 && p.pos.y > 8) this.say('fencePassed');
    // Chapter 6 — the Halo Path
    if (this.save.gatePassed && x > L.haloX && p.grounded) this.say('halo');
    if (x > L.beamX - 4 && x < L.beamX) this.say('beam');
    if (x > L.thicketX - 5 && x < L.thicketX) this.say('thicket');
    if (x > L.thicketX + 1 && x < L.thicketX + 6 && p.pos.y > L.haloY - 0.5) this.say('thicketPassed');
    if (x > L.reliefGap.x0 - 4 && x < L.reliefGap.x0 && p.pos.y > L.haloY - 0.5) this.say('relief');
    if (x > L.sleepField.min.x - 1.5 && x < L.sleepField.max.x && p.pos.y > L.sealY - 1) this.say('sleeping');
    if (x > L.aqueduct.x0 - 4 && x < L.aqueduct.x0 && p.pos.y > L.sealY - 0.5) this.say('aqueduct');
    // Reading the glyphs takes full fidelity at the stone.
    const gs = L.glyphStone;
    if (!this.save.glyphsRead && dist2D(x, p.pos.z, gs.x, gs.z) < 5 && Math.abs(p.pos.y - gs.y) < 2 && this.era.gameEraAt(v3(gs.x, gs.y + 1, gs.z)) >= 4) {
      this.startCine('glyphs');
    }

    if (!this.save.shardTaken) {
      const s = L.shard;
      if (Math.abs(s.x - x) < 0.8 && Math.abs(s.z - p.pos.z) < 1 && p.pos.y < s.y + 3) this.startCine('shard');
    }
    if (!this.shift.unlocked && dist2D(x, p.pos.z, L.device.x, L.device.z) < 1.55 && p.pos.y < 3) this.startCine('device');
    if (this.shift.mode === '3d' && p.grounded) {
      if (!this.puzzle.plateLatched) {
        const g = L.resetGlyph;
        const c = this.puzzle.cubeCenter;
        if (dist2D(x, p.pos.z, g.x, g.z) < 0.7 && dist2D(c.x, c.z, L.cubeStart.x, L.cubeStart.z) > 0.1 && this.puzzle.resetCube()) {
          this.emit('cubeReset', { pos: { ...L.cubeStart } });
        }
      }
      if (!this.stair.latched) {
        const g = L.lampGlyph;
        const c = this.stair.lampCenter;
        if (dist2D(x, p.pos.z, g.x, g.z) < 0.7 && dist2D(c.x, c.z, L.lampStart.x, L.lampStart.z) > 0.1 && this.stair.resetLamp()) {
          this.emit('cubeReset', { pos: { ...L.lampStart } });
        }
      }
    }
    if (p.pos.z < -1.4 && x > 52 && x < 62) {
      if (!this.seenChamber) this.say('chamber');
      this.seenChamber = true;
    }
    if (p.pos.z > 2.6 && x > 100 && x < 112) this.seenAlcove = true;
    for (const cp of L.checkpoints) {
      if (this.activeCheckpoints.has(cp.id) || cp.id === 'beacon' || cp.id === 'gate') continue;
      if (Math.abs(x - cp.pos.x) < 1 && Math.abs(p.pos.y - cp.pos.y) < 2 && p.grounded) this.activateCheckpoint(cp.id);
    }
    if (!this.save.beaconLit && x > L.beaconX && p.pos.y < 3 && p.grounded) this.startCine('beacon');
    if (!this.save.gatePassed && x > L.gateX && p.pos.y > L.plateauY - 1 && p.grounded) this.startCine('gate');
    if (!this.save.finished && x > L.summitX && p.pos.y > L.sealY - 1 && p.grounded) this.startCine('summit');
  }

  private activateCheckpoint(id: string) {
    this.activeCheckpoints.add(id);
    this.checkpoint = id;
    this.cells = this.maxCells;
    const cp = this.level.checkpoints.find((c) => c.id === id)!;
    this.emit('checkpoint', { pos: { ...cp.pos }, text: id });
    this.persist();
  }

  /** The sealed door sinks into the ground once its glyphs are read. */
  private openSeal(instant: boolean) {
    this.world.get('sealDoor')!.enabled = false;
    if (instant) this.sealOpen = 1;
  }

  // ---------------------------------------------------------------- dimension shift

  requestShift(): ShiftBlock | null {
    const wasMode = this.shift.mode;
    const block = this.shift.begin();
    if (block) {
      const msgs: Record<ShiftBlock, Prompt | null> = {
        locked: this.player.pos.x > 50 ? { keys: [], text: "Pip's core is dormant… something nearby is humming.", tone: 'warn' } : null,
        airborne: { keys: [], text: 'Land first — the core needs solid ground.', tone: 'warn' },
        'off-lane': { keys: [], text: 'Return to the glowing lane to flatten back into 2D.', tone: 'warn' },
        obstructed: { keys: [], text: 'Something is in the way on the lane.', tone: 'warn' },
        'no-ground': { keys: [], text: "There's no ground on the lane here.", tone: 'warn' },
        painted: { keys: [], text: "Can't unfold here — this only holds together from the side.", tone: 'warn' },
        busy: null,
      };
      const m = msgs[block];
      if (m) {
        this.toast = m;
        this.toastT = 2.4;
        this.emit('fizzle', { pos: { ...this.player.pos }, text: block });
        this.antennaGlitch = 0.6;
      }
      return block;
    }
    const to = wasMode === '2d' ? '3d' : '2d';
    if (to === '3d') this.camera.resetOrbit(0, 0);
    this.emit('shiftStart', { pos: { ...this.player.pos }, text: to });
    if (to === '3d' && !this.save.firstShiftDone) {
      this.changeEra(2, 3.0, v3(this.player.pos.x, this.player.pos.y + 0.5, 0));
    }
    return null;
  }

  private onShiftDone() {
    this.emit('shiftEnd', { pos: { ...this.player.pos }, text: this.shift.mode });
    if (this.shift.mode === '3d' && !this.save.firstShiftDone) {
      this.save.firstShiftDone = true;
      this.setAction('surprised');
      this.lookAtCamera = 2.2;
      this.showBanner(ERA_NAMES[2], ERA_TITLES[2], 2);
      this.say('firstShift');
      this.persist();
    }
  }

  changeEra(e: Era, dur = 2.4, center?: V3) {
    const c = center ?? v3(this.player.pos.x, this.player.pos.y + 0.5, this.player.pos.z);
    if (this.era.start(e, c, dur)) this.emit('eraStart', { pos: c, value: e });
  }

  // ---------------------------------------------------------------- cinematics

  private startCine(name: CineName) {
    this.cine = { name, t: 0, fired: new Set() };
    this.input.consume('jump');
    this.wheelOpen = false;
  }

  private once(key: string, at: number, fn: () => void) {
    const c = this.cine!;
    if (c.t >= at && !c.fired.has(key)) {
      c.fired.add(key);
      fn();
    }
  }

  private endCine() {
    this.cine = null;
    this.camera.overrideGoal = 0;
  }

  showBanner(title: string, subtitle: string, era: Era, dur = 3.2) {
    this.banner = { title, subtitle, era, id: ++this.bannerId };
    this.bannerT = dur;
    this.emit('banner', { text: title });
  }

  private awakeningCamera(snap = false) {
    const s = this.level.spawn;
    this.camera.override = { target: v3(s.x - 1.2, 1.1, 0), yaw: 0.0, pitch: 0.04, fov: 13, dist: 24 };
    this.camera.overrideGoal = 1;
    if (snap) this.camera.overrideW = 1;
  }

  private skipAwakening() {
    if (!this.cine || this.cine.name !== 'awakening') return;
    this.assemble = 1;
    this.machineEye = 0;
    this.pixelGlow = 0;
    this.finishAwakening();
  }

  private finishAwakening() {
    this.save.awakened = true;
    this.sinceAwake = 0;
    this.endCine();
    this.camera.overrideRate = 1.6;
    this.persist();
    this.say('boot');
  }

  private stepCine(dt: number) {
    const c = this.cine!;
    c.t += dt;
    const p = this.player;
    const L = this.level;
    switch (c.name) {
      case 'awakening': {
        this.pixelGlow = c.t < 2.3 ? 0.5 + 0.5 * Math.sin(c.t * 9) : 0;
        this.once('blink', 0.5, () => this.emit('pixelBlink', { pos: { ...p.pos } }));
        this.once('beam', 1.4, () => {
          this.machineEye = 1;
          this.emit('machineBeam', { pos: { ...L.awakeningMachine } });
        });
        this.once('assemble', 2.3, () => this.emit('assemble', { pos: { ...p.pos } }));
        if (c.t > 2.3) this.assemble = clamp((c.t - 2.3) / 1.3, 0, 1);
        this.once('wonder', 3.7, () => {
          this.setAction('surprised');
          this.emit('awake', { pos: { ...p.pos } });
        });
        this.once('cam', 4.6, () => {
          this.camera.overrideGoal = 0;
          this.camera.overrideRate = 1.4;
          this.machineEye = 0.35;
        });
        if (c.t > 5.4) this.finishAwakening();
        break;
      }
      case 'shard': {
        this.once('start', 0, () => {
          this.save.shardTaken = true;
          this.setAction('inspect');
          this.camera.shake = 0.3;
          this.emit('shard', { pos: { ...L.shard } });
          this.changeEra(1, 2.8, L.shard);
          this.say('shard');
        });
        this.once('banner', 1.6, () => this.showBanner(ERA_NAMES[1], ERA_TITLES[1], 1));
        if (c.t > 3.0) {
          this.endCine();
          this.checkpoint = 'shard';
          this.activeCheckpoints.add('shard');
          this.persist();
        }
        break;
      }
      case 'device': {
        this.once('start', 0, () => {
          this.shift.unlocked = true;
          this.setAction('inspect');
          this.emit('device', { pos: { ...L.device } });
          this.say('device');
        });
        this.once('banner', 0.9, () => this.showBanner('DIMENSION CORE', 'Pip can now shift perspective', this.era.displayEra));
        if (c.t > 2.4) {
          this.endCine();
          this.checkpoint = 'device';
          this.activeCheckpoints.add('device');
          this.persist();
        }
        break;
      }
      case 'bridge': {
        this.once('start', 0, () => {
          this.emit('plate', { pos: { ...L.plate } });
          this.camera.override = { target: v3(66.5, 0.6, -1.5), yaw: -0.62, pitch: 0.36, fov: 46, dist: 19 };
          this.camera.overrideGoal = 1;
          this.camera.overrideRate = 2.4;
          this.setAction('fistpump');
          this.changeEra(3, 3.2, v3(L.plate.x, 1, L.plate.z));
        });
        this.once('bridge', 0.35, () => this.emit('bridgeStart', { pos: v3(67, 0, 0) }));
        this.once('banner', 1.4, () => this.showBanner(ERA_NAMES[3], ERA_TITLES[3], 3));
        this.once('release', 3.7, () => {
          this.camera.overrideGoal = 0;
          this.camera.overrideRate = 2.0;
        });
        if (c.t > 4.4) {
          this.endCine();
          this.say('inked');
          this.persist();
        }
        break;
      }
      case 'beacon': {
        this.once('start', 0, () => {
          this.save.beaconLit = true;
          this.save.regress = true;
          this.checkpoint = 'beacon';
          this.activeCheckpoints.add('beacon');
          this.cells = MAX_CELLS;
          this.emit('checkpoint', { pos: { ...L.beacon }, text: 'beacon' });
          this.setAction('dance');
          this.changeEra(4, 3.0, v3(L.beacon.x, 2, -1.6));
        });
        this.once('banner', 1.2, () => this.showBanner(ERA_NAMES[4], ERA_TITLES[4], 4));
        if (c.t > 3.2) {
          this.action = 'none';
          this.endCine();
          this.say('beacon');
          this.persist();
        }
        break;
      }
      case 'stair': {
        this.once('start', 0, () => {
          this.emit('lamp', { pos: { ...L.lampSocket } });
          const w = L.solids.find((s) => s.id === 'mural')!.box;
          this.camera.override = { target: v3(L.lampSocket.x, 4.6, w.max.z), yaw: 0.18, pitch: 0.16, fov: 42, dist: 17 };
          this.camera.overrideGoal = 1;
          this.camera.overrideRate = 2.2;
          this.setAction('fistpump');
        });
        this.once('release', 3.4, () => {
          this.camera.overrideGoal = 0;
          this.camera.overrideRate = 2.0;
        });
        if (c.t > 4.0) {
          this.endCine();
          this.toast = { keys: [], text: 'The stair is whole — but only when the world is flat.', tone: 'story' };
          this.toastT = 3.2;
        }
        break;
      }
      case 'gate': {
        this.once('start', 0, () => {
          this.save.gatePassed = true;
          this.checkpoint = 'gate';
          this.activeCheckpoints.add('gate');
          this.cells = MAX_CELLS;
          this.setAction('inspect');
          this.emit('gate', { pos: { ...L.gate } });
          this.camera.override = { target: v3(L.gate.x, L.gate.y + 1.6, 0), yaw: 0.55, pitch: 0.1, fov: 42, dist: 13 };
          this.camera.overrideGoal = 1;
          this.camera.overrideRate = 1.8;
          this.setBubble(null, true, true);
          this.say('reflection');
        });
        this.once('era', 0.7, () => this.changeEra(5, 4.2, v3(L.gate.x, L.gate.y + 1.5, 0)));
        this.once('banner', 2.4, () => this.showBanner(ERA_NAMES[5], ERA_TITLES[5], 5, 3.6));
        this.once('release', 4.6, () => {
          this.camera.overrideGoal = 0;
          this.camera.overrideRate = 1.4;
        });
        if (c.t > 5.2) {
          this.endCine();
          this.persist();
        }
        break;
      }
      case 'glyphs': {
        // Full fidelity: the writing on the sleeping stone resolves, and the seal sinks.
        const gs = L.glyphStone;
        this.once('start', 0, () => {
          this.save.glyphsRead = true;
          this.setAction('inspect');
          this.emit('glyphs', { pos: { ...gs } });
          this.camera.override = { target: v3(gs.x + 1.5, gs.y + 1.4, 0), yaw: 0.35, pitch: 0.12, fov: 40, dist: 10 };
          this.camera.overrideGoal = 1;
          this.camera.overrideRate = 2.2;
          this.say('glyphs');
        });
        this.once('open', 1.6, () => {
          this.openSeal(false);
          this.camera.shake = 0.35;
        });
        this.once('release', 3.4, () => {
          this.camera.overrideGoal = 0;
          this.camera.overrideRate = 2.0;
        });
        if (c.t > 3.8) {
          this.endCine();
          this.persist();
        }
        break;
      }
      case 'summit': {
        // The world wheel turns; the camera pulls back over every place Pip has been.
        const w = L.wheel;
        this.once('start', 0, () => {
          this.setBubble(null, true, true);
          this.setAction('inspect');
          this.camera.override = { target: v3(w.x, w.y + 2.5, w.z), yaw: 0.5, pitch: 0.14, fov: 44, dist: 14 };
          this.camera.overrideGoal = 1;
          this.camera.overrideRate = 1.4;
          this.say('summit', true);
        });
        if (!c.fired.has('turn') && c.t > 2 && !this.speaking) {
          this.once('turn', 0, () => {
            this.emit('wheel', { pos: { ...w } });
            this.camera.shake = 0.4;
            this.setAction('dance');
            this.camera.override = { target: v3(120, 6, -10), yaw: -0.25, pitch: 0.18, fov: 52, dist: 150 };
            this.camera.overrideRate = 0.35;
            this.emit('reveal', { pos: { ...p.pos } });
          });
        }
        if (c.fired.has('turn') && !c.fired.has('end')) {
          if (!c.fired.has('mark')) {
            c.fired.add('mark');
            c.t = 100;
          }
          if (c.t > 104) {
            c.fired.add('end');
            this.save.finished = true;
            this.save.eraKeys = true;
            this.checkpoint = 'summit';
            this.activeCheckpoints.add('summit');
            this.persist();
            this.say('ending', true);
          }
        }
        if (c.fired.has('end') && !this.speaking && !this.finaleCard) {
          this.action = 'none';
          this.finaleCard = true;
          this.emit('finale');
        }
        break;
      }
    }
  }

  /** Called by the UI when the player dismisses the end card to keep playing. */
  continueAfterFinale() {
    this.finaleCard = false;
    this.action = 'none';
    this.endCine();
    this.fadeWhite = false;
    this.fadeGoal = 0;
    this.camera.snap(this.cameraContext());
    this.toast = { keys: ['1', '–', '6'], text: 'All six generations unlocked — switch any time', tone: 'story' };
    this.toastT = 5;
  }

  // ---------------------------------------------------------------- UI state

  expression(): Expression {
    const p = this.player;
    if (this.cine?.name === 'awakening' && this.assemble < 1) return 'sleepy';
    if (this.action === 'hurt') return 'hurt';
    if (this.action === 'surprised') return 'surprised';
    if (this.action === 'inspect') return 'wonder';
    if (this.action === 'fistpump' || this.action === 'dance') return 'happy';
    if (this.action === 'stumble') return 'dizzy';
    if (!p.grounded && p.fallTime > 0.45 && p.vel.y < -12) return 'panic';
    if (p.pushing > 0) return 'determined';
    if (this.idleT > 14) return 'sleepy';
    return 'idle';
  }

  /** The HUD's objective line. */
  objective(): string {
    if (this.save.finished) return 'Explore · 1–6 change generation';
    if (this.player.pos.x > 141) return CHAPTERS[5];
    return CHAPTERS[Math.min(4, this.era.displayEra)];
  }

  prompt(): Prompt | null {
    if (this.toast) return this.toast;
    if (this.mode !== 'play' || this.cine || this.shift.busy || this.finaleCard) return null;
    const p = this.player;
    const L = this.level;
    const x = p.pos.x;
    if (!this.tutorialMoved && this.sinceAwake > 0.6) return { keys: ['→'], text: 'GO', tone: 'info' };
    if (!this.tutorialJumped && this.tutorialMoved && x > 6 && x < 24 && this.shift.mode === '2d') return { keys: ['Space'], text: 'Jump — hold for height', tone: 'info' };
    if (!this.shift.unlocked && x > 55 && x < 62) return { keys: [], text: 'The bridge is broken. That device is humming…', tone: 'story' };
    if (this.save.regress && x > 114 && x < L.fenceX && !this.bubbleActive && p.pos.y > 8)
      return { keys: ['Q', '1'], text: 'Hold Q, press 1: project 8-bit around you', tone: 'info' };
    if (this.bubbleActive && x > L.fenceX + 1 && x < 124) return { keys: ['Q'], text: 'Tap Q to drop the bubble', tone: 'info' };
    const halo = this.haloPrompt();
    if (halo !== undefined) return halo;
    const inAct2 = x > 98.5 && x < 112.5 && p.pos.y < 2;
    if (this.shift.mode === '2d') {
      if (this.shift.unlocked && !this.puzzle.plateLatched && x > 50 && x < 63) return { keys: ['E'], text: 'Dimension Shift', tone: 'info' };
      if (inAct2 && this.stair.state === 'faded') return { keys: ['E'], text: 'The painted stair is faded… look closer in 3D', tone: 'story' };
      return null;
    }
    if (x < 63 && !this.puzzle.plateLatched) {
      if (!this.seenChamber) return { keys: ['W', 'A', 'S', 'D'], text: 'Explore in depth · drag to look', tone: 'info' };
      const c = this.puzzle.cubeCenter;
      if (dist2D(c.x, c.z, L.plate.x, L.plate.z) < 4.5 && dist2D(p.pos.x, p.pos.z, c.x, c.z) < 3) return { keys: [], text: 'Push the cube onto the glowing plate', tone: 'info' };
      return null;
    }
    if (inAct2 && !this.stair.latched) {
      if (!this.seenAlcove) return { keys: ['D'], text: 'A lantern glows on the grass to your right — walk over to it', tone: 'info' };
      // Step-by-step: lantern forward along the alcove, then toward the mural onto the target.
      const lc = this.stair.lampCenter;
      const sk = L.lampSocket;
      if (lc.x > sk.x + 0.6) return { keys: [], text: 'Pushed too far — step on the purple glyph to reset the lantern', tone: 'info' };
      if (lc.x < sk.x - 0.3) return { keys: ['W'], text: 'Walk into the lantern from behind to push it forward, until it is level with the yellow arrow on the grass', tone: 'info' };
      if (lc.z > sk.z + 0.3) return { keys: ['A'], text: 'Now push it from its right side toward the wall, onto the yellow arrow', tone: 'info' };
      return { keys: [], text: 'Nudge the lantern onto the yellow arrow', tone: 'info' };
    }
    // Off the path in 3D, Pip is just exploring: no nagging (a refused shift explains itself).
    if (Math.abs(p.pos.z) > LANE_TOLERANCE) return null;
    if (inAct2) return { keys: ['E'], text: 'Shift to 2D — painted steps are solid when flat', tone: 'info' };
    if (x < 141) return { keys: ['E'], text: 'Shift back to 2D', tone: 'info' };
    return null;
  }

  /** Hints along the Halo Path. `undefined` = not in that stretch (fall through). */
  private haloPrompt(): Prompt | null | undefined {
    const p = this.player;
    const L = this.level;
    const x = p.pos.x;
    if (x < 152 || this.save.finished) return undefined;
    const bubble = this.era.bubble;
    const near = (x0: number, x1: number) => x > x0 && x < x1;
    if (near(L.beamX - 4, L.beamX) && this.world.active(this.world.get('beam1')!)) return { keys: ['Q', '1'], text: 'Light threads were never drawn in 8-bit', tone: 'info' };
    if (near(L.thicketX - 5, L.thicketX - 0.6) && p.pos.y > L.haloY - 0.5 && this.world.active(this.world.get('thicket')!))
      return { keys: ['Q', '2'], text: 'In 16-bit, scenery is its own layer — walk behind it', tone: 'info' };
    if (near(L.reliefGap.x0 - 3, L.reliefGap.x1) && p.pos.y > L.haloY - 1 && bubble?.era !== 3)
      return { keys: ['Q', '4'], text: 'Carved handholds only hold you in the Stylized world', tone: 'info' };
    if (near(L.sleepField.min.x - 1, L.glyphStone.x + 4) && !this.save.glyphsRead && p.pos.y > L.sealY - 1)
      return { keys: ['Q', '6'], text: 'The stone is asleep in 16-bit — project full detail beside it', tone: 'info' };
    if (near(L.aqueduct.x0 - 3, L.aqueduct.x0 + 0.5) && p.pos.y > L.sealY - 1) {
      if (this.shift.mode === '3d') return { keys: ['E'], text: 'From the side, the two halves line up — shift to 2D', tone: 'info' };
      return null;
    }
    if (bubble && x > L.aqueduct.x1) return { keys: ['Q'], text: 'Tap Q to drop the bubble', tone: 'info' };
    return null;
  }

  get shiftStatus(): 'hidden' | 'locked' | 'ready' | 'blocked' | 'active' {
    if (!this.shift.unlocked) return this.player.pos.x > 50 ? 'locked' : 'hidden';
    if (this.shift.busy) return 'active';
    return this.shift.check() ? 'blocked' : 'ready';
  }
}
