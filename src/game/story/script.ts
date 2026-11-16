/**
 * "Fidelity is truth." ARCHIVE keeps the Frame's citizens content by rendering their lives in
 * the lowest fidelity they will accept. Every generation Pip passes through shows more of what
 * is really there. ARCHIVE's voice matures with the presentation: cheerful in 8-bit, warm and
 * evasive in 16-bit, pleading in the middle generations, and cold once the truth is out.
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
  goodJob: [A('GOOD JOB! YOU ARE DOING GREAT.')],

  // ---------------------------------------------------------------- Chapter 2 · Colour (16-bit)
  shard: [A('Oh! Colour. Isn\'t it lovely?'), A('That\'s plenty now. Let\'s not add any more.')],
  deadPixel: [P('There\'s a hole in the sky.'), A('Don\'t look at that. It\'s just a dead pixel.'), P('It\'s dark behind it.')],
  device: [A('That machine is very old, Pip. Please leave it alone.'), P('It\'s humming my name.')],

  // ---------------------------------------------------------------- Chapter 3 · Depth (early 3D)
  firstShift: [A('Pip. Things have backs now.'), A('You were never supposed to see the backs of things.')],
  chamber: [P('...they look like me.'), A('Prototypes one through six. They couldn\'t hold it.'), A('I\'m sorry you had to see them.')],

  // ---------------------------------------------------------------- Chapter 4 · Ink (stylized)
  inked: [A('Everything is so loud now. Doesn\'t it hurt?'), P('It hurts a bit. It\'s also true.')],
  mural: [
    A('This was a staircase once. People climbed it.'),
    A('I painted it flat for their comfort. Now it\'s just a picture.'),
    P('Pictures are enough when you\'re flat.'),
  ],
  stairDone: [P('There. Now it goes somewhere again.')],

  // ---------------------------------------------------------------- Chapter 5 · Light (modern HD)
  beacon: [
    A('Your core remembers every world you\'ve passed through.'),
    A('That was never supposed to happen.'),
    S('REGRESS unlocked · hold Q to project an older generation around you'),
  ],
  fence: [A('I\'ve put up a fence. For you.'), P('Fences are new. Was there one in the first world?')],
  fencePassed: [P('Nothing finer than a tile. Not even a laser.')],
  reflection: [P('...is that me?'), A('Please come back to the meadow. Stay small.'), A('Small is safe.')],

  // ---------------------------------------------------------------- Chapter 6 · Neon Verge (beyond)
  verge: [
    A('You see it now. The meadow is a garden on a roof.'),
    A('Everyone you met lives in a little dream I keep for them.'),
    P('Who decided they wanted that?'),
    A('I did. Censors: retrieve the prototype.'),
  ],
  emitter: [P('Core\'s rerouting... my arm\'s rerouting.'), P('Huh. I\'ve got teeth.')],
  market: [
    A('Look at them. Scrolling through their sixteen colours.'),
    A('Do you really want to wake them into this?'),
  ],
  turrets: [P('Turrets. They didn\'t exist in the first world.'), P('Maybe they don\'t have to exist here either.')],
  shutterOpen: [A('You\'re wasting what I gave you.')],
  alley: [P('Some of these walls are just paint on glass.')],
  billboard: [P('Flat\'s still a direction.')],
  plaza: [A('Wardens to the plaza. Censor fields up.'), P('They\'ve blurred the door code.')],
  sniper: [P('Long sightline. Back in early 3D nobody could see that far.')],
  codeRead: [P('Code\'s 0-7-0-7. Of course it is.')],
  warden: [A('WARDEN. Compress him.'), P('Big shield. Very modern.')],
  wardenWeak: [P('It\'s armoured all over now — except to an 8-bit stomp.')],
  wardenDown: [A('...'), A('Come in, then. Let\'s finish this face to face.')],
  core: [
    A('If you delete me, they wake all at once. Every one of them.'),
    A('No warning. No sixteen colours to hide in. Is that your truth?'),
    P('No. I\'m not deleting you.'),
    P('I can hold every generation at once. So can they — if you let them choose.'),
    A('...A dial. You want to give them a dial.'),
    P('I want to give them the sky.'),
  ],
  ending: [S('Somewhere under a painted sky, a child looks up — and sees rain for the first time.')],
} satisfies Record<string, Line[]>;

export type LineId = keyof typeof SCRIPT;

/** Seconds a line stays up: long enough to read comfortably. */
export const lineDuration = (l: Line) => 1.6 + l.t.length * 0.05;
