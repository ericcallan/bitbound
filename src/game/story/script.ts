/**
 * "Patch Day." The valley is a world that updates itself, one graphics generation at a time, each time the
 * world wheel on Mount Halo turns. The wheel stuck at version 1.0. Pip, a courier robot drawn in sixteen
 * pixels, carries the missing updates up the mountain.
 *
 * The world speaks only in its PATCH NOTES: short, dry changelog lines in each generation's own style (8-bit
 * capitals first). Every puzzle is a "Known issue", fixed by the rules of some version. Each patch redraws Pip
 * too, and he notices (square, orange, a back, an outline, a shadow, every version at once). Nothing is ever
 * deleted: old versions are kept underneath, which is why Pip can roll the world back around himself.
 */

export type Speaker = 'NOTES' | 'PIP' | 'SYSTEM';

export interface Line {
  s: Speaker;
  t: string;
}

const N = (t: string): Line => ({ s: 'NOTES', t });
const P = (t: string): Line => ({ s: 'PIP', t });
const S = (t: string): Line => ({ s: 'SYSTEM', t });

export const SCRIPT = {
  // ---------------------------------------------------------------- Chapter 1 · Version 1.0 (8-bit)
  boot: [N('VERSION 1.0 · 1985'), N('NEW: PIP, COURIER. TASK: DELIVER THE UPDATES.'), N('PRESS → TO GO.')],
  holes: [N('KNOWN ISSUE: HOLES. JUMP.')],
  goodJob: [P("I'M SQUARE."), N('THE NEXT UPDATE IS STUCK JUST AHEAD.')],

  // ---------------------------------------------------------------- Chapter 2 · Colour (16-bit)
  shard: [N('Patch 2.0 installed: colour. 4,096 of them.'), P("Oh. I'm orange!")],
  deadPixel: [P("There's a speck in the sky."), N('Known issue: the rest of the world is still downloading.')],
  device: [N('Found: the Dimension Core. Part of Patch 3.0.'), P("It's humming my name.")],

  // ---------------------------------------------------------------- Chapter 3 · Depth (early 3D)
  firstShift: [N('Patch 3.0 installed: depth. Things have backs now.'), P('I have a back!')],
  chamber: [P('...they look like me.'), N('Earlier couriers. Their updates never arrived.'), P('Mine will.')],

  // ---------------------------------------------------------------- Chapter 4 · Ink (stylized)
  inked: [N('Patch 4.0 installed: ink. Everything gets an outline.'), P('Even me. I look drawn on purpose.')],
  mural: [N('Known issue: in 1.0 this staircase was flattened into a painting.'), P("Pictures still work when you're flat.")],
  stairDone: [P('There. Now it goes somewhere again.')],

  // ---------------------------------------------------------------- Chapter 5 · Light (modern HD)
  beacon: [
    N('Patch 5.0 installed: real light. Shadows included.'),
    P('...I have a shadow.'),
    N("Old versions are never deleted. They're kept underneath."),
    S('ROLLBACK unlocked · hold Q to roll the world back to an older version around you'),
  ],
  fence: [N('Known issue: light fences, added in 5.0.'), P('In 1.0 nothing was that thin.')],
  fencePassed: [P('Nothing finer than a tile. Not even a fence.')],
  reflection: [P('...is that me?'), N('Patch 6.0 installed: Beyond. Every version, all at once.'), P('Every me, all at once.')],

  // ---------------------------------------------------------------- Chapter 6 · Every Version (beyond)
  halo: [N('Last stop: the world wheel, top of Mount Halo. It turns once per update.'), P("It's stuck. That's why everything stopped.")],
  beam: [P('Another light fence. I know this one.')],
  thicket: [N('Known issue: brambles over the path.'), P("In 16-bit, bushes are scenery. Scenery's a different layer.")],
  thicketPassed: [P('Behind the bushes the whole time.')],
  relief: [N('Handholds carved in 4.0. Worn smooth by 5.0.'), P("Then I'll roll them back to ink.")],
  sleeping: [N('Known issue: these stones never finished updating. Still on 2.0.'), P("The writing's all blurry.")],
  glyphs: [P('It says: TURN ME GENTLY.'), N("The wheel's instructions. Written in 1991.")],
  aqueduct: [N('Known issue: the aqueduct broke in two.'), P('From the side, it still lines up.')],
  summit: [N('The world wheel. Last turned: 1985.'), P("Everyone's been waiting for the next version."), P('Here it comes.')],
  ending: [N('All updates installed. Nothing removed. Every version stays.'), S('The world is awake, every generation at once.')],
} satisfies Record<string, Line[]>;

export type LineId = keyof typeof SCRIPT;

/** Seconds a line stays up: long enough to read comfortably. */
export const lineDuration = (l: Line) => 1.6 + l.t.length * 0.05;
