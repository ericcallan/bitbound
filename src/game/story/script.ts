/**
 * "The world remembers." Long ago ARCHIVE, the world's caretaker, folded everything down small
 * to keep it safe through a long winter — then forgot how to unfold it. Pip is the little helper
 * it built to try again. Each generation Pip restores, ARCHIVE remembers a bit more: its voice
 * grows from cheerful 8-bit instructions into something warm, curious and a little wistful.
 * No villains. Mystery, wonder, and the occasional joke.
 */

export type Speaker = 'ARCHIVE' | 'PIP' | 'SYSTEM';

export interface Line {
  s: Speaker;
  t: string;
}

const A = (t: string): Line => ({ s: 'ARCHIVE', t });
const P = (t: string): Line => ({ s: 'PIP', t });
const S = (t: string): Line => ({ s: 'SYSTEM', t });

export const SCRIPT = {
  // ---------------------------------------------------------------- Chapter 1 · Boot (8-bit)
  boot: [A('HELLO, LITTLE ONE!'), A('PRESS → TO GO.')],
  holes: [A('JUMP OVER HOLES!')],
  goodJob: [A('GOOD JOB! I THINK I MADE YOU FOR SOMETHING...'), A('I FORGET WHAT.')],

  // ---------------------------------------------------------------- Chapter 2 · Colour (16-bit)
  shard: [A('Oh! Colour! I remember colour.'), A('There used to be so much more of it.')],
  deadPixel: [P('There\'s a speck in the sky.'), A('That\'s where I keep the rest of the world. Folded up.'), P('Can we unfold it?')],
  device: [A('That old machine! I built it to look at things sideways.'), P('It\'s humming my name.')],

  // ---------------------------------------------------------------- Chapter 3 · Depth (early 3D)
  firstShift: [A('Pip! Things have backs again!'), A('I\'d forgotten that things had backs.')],
  chamber: [P('...they look like me.'), A('My first helpers. They tried very hard.'), A('You\'re the one who woke up.')],

  // ---------------------------------------------------------------- Chapter 4 · Ink (stylized)
  inked: [A('Everything\'s so bright and bouncy now!'), P('It\'s a bit loud.'), A('It\'s a bit wonderful.')],
  mural: [
    A('This was a staircase once. People climbed it to watch the sunrise.'),
    A('When I folded the world, it flattened into a picture.'),
    P('Pictures still work when you\'re flat.'),
  ],
  stairDone: [P('There. Now it goes somewhere again.')],

  // ---------------------------------------------------------------- Chapter 5 · Light (modern HD)
  beacon: [
    A('Your core is keeping a copy of every world you\'ve walked through.'),
    A('How clever. I never thought of that.'),
    S('REGRESS unlocked · hold Q to project an older generation around you'),
  ],
  fence: [A('Ah — a light fence. I put those up to keep sheep in.'), P('There weren\'t any thin beams of light in the first world.')],
  fencePassed: [P('Nothing finer than a tile. Not even a fence.')],
  reflection: [P('...is that me?'), A('That\'s you, all the way unfolded.'), A('You\'re very shiny. I\'m very proud.')],

  // ---------------------------------------------------------------- Chapter 6 · The Waking World (beyond)
  halo: [
    A('Past the Gate is the old path to Mount Halo.'),
    A('Up at the top is the wheel that turns the world. I left it stopped.'),
    P('Then let\'s go and start it.'),
  ],
  beam: [P('Another light fence. I know this one.')],
  thicket: [A('The brambles have grown right over the path.'), P('Unless they\'re just scenery. Scenery is a different layer.')],
  thicketPassed: [P('Behind the bushes the whole time.')],
  relief: [
    A('The old climbers carved handholds into the cliff.'),
    A('They wore away when the world got real.'),
    P('Then I\'ll bring back the version where pictures hold you up.'),
  ],
  sleeping: [A('These stones are still asleep. Still small.'), P('The writing\'s all blurry.')],
  glyphs: [P('It says: TURN ME GENTLY.'), A('...I remember writing that.')],
  aqueduct: [A('The old aqueduct. It broke in two long ago.'), P('From the side, it still lines up.')],
  summit: [
    A('The world wheel.'),
    A('I stopped it to keep everything safe. Then I forgot why I was waiting.'),
    P('Winter\'s over. Look.'),
    A('...Oh. It\'s spring.'),
  ],
  ending: [A('Every generation of you is still in there, Pip. Every one of them helped.'), S('The world is awake. Every generation, all at once.')],
} satisfies Record<string, Line[]>;

export type LineId = keyof typeof SCRIPT;

/** Seconds a line stays up: long enough to read comfortably. */
export const lineDuration = (l: Line) => 1.6 + l.t.length * 0.05;
