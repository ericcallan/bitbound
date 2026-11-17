export type Action =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'jump'
  | 'shift'
  | 'map'
  | 'pause'
  | 'recenter'
  | 'era1'
  | 'era2'
  | 'era3'
  | 'era4'
  | 'era5'
  | 'era6'
  | 'skip'
  | 'regress';

/** What the simulation needs from any input device (keyboard, gamepad, or a scripted test bot). */
export interface InputSource {
  /** -1..1, right positive. */
  axisX(): number;
  /** -1..1, forward/up positive. */
  axisY(): number;
  held(a: Action): boolean;
  /** Returns true once per press. */
  consume(a: Action): boolean;
  /** Accumulated camera orbit since the last call (radians). */
  takeOrbit(): { yaw: number; pitch: number; active: boolean };
}

const KEYMAP: Record<string, Action[]> = {
  KeyA: ['left'],
  ArrowLeft: ['left'],
  KeyD: ['right'],
  ArrowRight: ['right'],
  KeyW: ['up'],
  ArrowUp: ['up'],
  KeyS: ['down'],
  ArrowDown: ['down'],
  Space: ['jump', 'skip'],
  KeyK: ['jump'],
  KeyE: ['shift'],
  KeyQ: ['regress'],
  KeyM: ['map'],
  Escape: ['pause'],
  KeyP: ['pause'],
  KeyC: ['recenter'],
  Digit1: ['era1'],
  Digit2: ['era2'],
  Digit3: ['era3'],
  Digit4: ['era4'],
  Digit5: ['era5'],
  Digit6: ['era6'],
  Enter: ['skip'],
};

/** Keyboard + mouse-drag + gamepad. Press edges are latched until the sim consumes them. */
export class BrowserInput implements InputSource {
  private down = new Set<Action>();
  private pressed = new Set<Action>();
  private orbitYaw = 0;
  private orbitPitch = 0;
  private lastOrbitAt = -1e9;
  private dragging = false;
  private padPrev = new Set<Action>();
  private padHeld = new Set<Action>();
  private padX = 0;
  private padY = 0;
  private padRX = 0;
  private padRY = 0;
  enabled = true;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('contextmenu', this.onContextMenu);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.el.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointermove', this.onPointerMove);
    this.el.removeEventListener('contextmenu', this.onContextMenu);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const acts = KEYMAP[e.code];
    if (!acts) return;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    for (const a of acts) {
      if (!this.down.has(a)) this.pressed.add(a);
      this.down.add(a);
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    const acts = KEYMAP[e.code];
    if (!acts) return;
    for (const a of acts) this.down.delete(a);
  };
  private onBlur = () => {
    this.down.clear();
    this.dragging = false;
  };
  private onPointerDown = (e: PointerEvent) => {
    if (e.button === 0 || e.button === 2) this.dragging = true;
  };
  private onPointerUp = () => {
    this.dragging = false;
  };
  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.orbitYaw -= e.movementX * 0.0055;
    this.orbitPitch += e.movementY * 0.0055 * 0.8;
    this.lastOrbitAt = performance.now();
  };
  /** Right-drag orbits the camera, so the browser menu must not open. */
  private onContextMenu = (e: Event) => e.preventDefault();

  /** Called once per rendered frame to sample gamepads. */
  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && Array.from(pads).find((g) => g && g.connected);
    this.padHeld.clear();
    this.padX = this.padY = this.padRX = this.padRY = 0;
    if (!p) return;
    const dz = (v: number) => (Math.abs(v) < 0.2 ? 0 : v);
    this.padX = dz(p.axes[0] ?? 0);
    this.padY = -dz(p.axes[1] ?? 0);
    this.padRX = dz(p.axes[2] ?? 0);
    this.padRY = dz(p.axes[3] ?? 0);
    const b = (i: number) => !!p.buttons[i]?.pressed;
    if (b(0)) this.padHeld.add('jump').add('skip');
    if (b(1) || b(2) || b(5)) this.padHeld.add('shift');
    if (b(3)) this.padHeld.add('regress');
    if (b(8)) this.padHeld.add('map');
    if (b(9)) this.padHeld.add('pause');
    if (b(14)) this.padHeld.add('left');
    if (b(15)) this.padHeld.add('right');
    if (b(12)) this.padHeld.add('up');
    if (b(13)) this.padHeld.add('down');
    if (b(10) || b(11)) this.padHeld.add('recenter');
    for (const a of this.padHeld) if (!this.padPrev.has(a)) this.pressed.add(a);
    this.padPrev = new Set(this.padHeld);
    if (this.padRX || this.padRY) {
      this.orbitYaw -= this.padRX * 0.045;
      this.orbitPitch += this.padRY * 0.03;
      this.lastOrbitAt = performance.now();
    }
  }

  held(a: Action) {
    return this.enabled && (this.down.has(a) || this.padHeld.has(a));
  }
  consume(a: Action) {
    // Menu keys must work while gameplay input is disabled (paused / map open).
    if (!this.enabled && a !== 'pause' && a !== 'map') return false;
    const had = this.pressed.has(a);
    this.pressed.delete(a);
    return had;
  }
  clearPresses() {
    this.pressed.clear();
  }
  axisX() {
    if (!this.enabled) return 0;
    const k = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    return k !== 0 ? k : this.padX;
  }
  axisY() {
    if (!this.enabled) return 0;
    const k = (this.held('up') ? 1 : 0) - (this.held('down') ? 1 : 0);
    return k !== 0 ? k : this.padY;
  }
  takeOrbit() {
    const r = {
      yaw: this.orbitYaw,
      pitch: this.orbitPitch,
      active: performance.now() - this.lastOrbitAt < 1200,
    };
    this.orbitYaw = this.orbitPitch = 0;
    return r;
  }
}

/** Input with no buttons pressed — used by the menu attract scene. */
export class NullInput implements InputSource {
  axisX() {
    return 0;
  }
  axisY() {
    return 0;
  }
  held() {
    return false;
  }
  consume() {
    return false;
  }
  takeOrbit() {
    return { yaw: 0, pitch: 0, active: false };
  }
}
