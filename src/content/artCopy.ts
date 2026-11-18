/**
 * The Art & Design pages' words: the tabs, their addresses, and the text of every card. Used by the page itself
 * (ui/Gallery.tsx) and by the build, which writes each tab's text into its own static HTML (vite.config.ts) so
 * crawlers and link previews read the same thing people see.
 */
export type ArtTab = 'character' | 'environment' | 'interface' | 'map';

export interface ArtCard {
  title: string;
  /** Paragraphs. */
  body: string[];
  /** Optional bullet list. */
  list?: string[];
}

export interface ArtPage {
  id: ArtTab;
  /** URL path, with trailing slash. */
  path: string;
  /** Tab label. */
  label: string;
  /** Page title (browser tab, share card). */
  title: string;
  /** One-sentence description (search result, share card). */
  description: string;
  /** Visible heading and intro. */
  heading: string;
  intro: string;
  cards: ArtCard[];
}

export const ART_HOME = '/art/';

export const ART_PAGES: ArtPage[] = [
  {
    id: 'character',
    path: '/art/',
    label: 'Character',
    title: 'Pip, in six generations — Bitbound Art & Design',
    description: "How Bitbound's hero is drawn in every generation, from a three-colour 8-bit sprite to the Blender-built robot of Beyond.",
    heading: 'Pip',
    intro: 'One small robot, six graphics generations. The lineup is the game itself: each band draws Pip the way that generation draws him in play.',
    cards: [
      {
        title: 'Who Pip is',
        body: [
          'The valley updates itself one graphics generation at a time, each time the world wheel on Mount Halo turns. The wheel stuck at version 1.0. Pip, a courier robot drawn in sixteen pixels, carries the missing updates up the mountain.',
          'Every patch redraws the whole world, and Pip with it. He notices: first that he is square, then orange, then that he has a back, an outline, a shadow, and finally every version of himself at once.',
        ],
        list: [
          'Rounded-square head with a dark screen-face',
          'Big cyan eyes that carry every emotion',
          'Orange and cream body around a glowing teal core',
          'One springy antenna, prone to glitches',
          'Mitten hands and oversized spring boots',
        ],
      },
      {
        title: 'One robot, six generations',
        body: ['The same character, reinterpreted by each generation’s rules rather than simply re-coloured.'],
        list: [
          '8-bit — a 16×16 sprite in three colours',
          '16-bit — pre-rendered from the 3D model and reduced to a small palette',
          'Early 3D — faceted, low-poly, wobbling on a coarse vertex grid',
          'Stylized — cel-shaded with ink outlines',
          'Modern HD — the Blender model with baked materials and full lighting',
          'Beyond — the same model with a clearcoat shell, fine scratches, pulsing circuit seams and a glass faceplate',
        ],
      },
      {
        title: 'How he is built',
        body: [
          'The modern Pip is built entirely by script in Blender: an 18-bone rig and 11 animation clips, with materials baked from procedural shaders.',
          'In play, procedural layers sit on top of the clips: feet that plant on slopes, a lean into turns and acceleration, walk blending into run, and a squash on landing.',
        ],
      },
    ],
  },
  {
    id: 'environment',
    path: '/art/environment/',
    label: 'Environment',
    title: 'One world, six generations — Bitbound Art & Design',
    description: 'The Bitbound world in every graphics generation: the meadow, the ruins, the hidden chamber, the Painted Stair, the Stalled Gate, the Update Wave and the World Wheel.',
    heading: 'The world',
    intro: 'Every view is the real, playable level, rendered live. Pick a place, then compare all six generations side by side or look at one at a time.',
    cards: [
      {
        title: 'One world, six generations',
        body: [
          'A generation is a way of drawing the same world. 8-bit and 16-bit are real tile renderers at their consoles’ resolutions; Early 3D wobbles and pixelates; Stylized paints and inks; Modern HD lights everything physically; Beyond adds golden-hour light, moss, mist and detail everywhere.',
        ],
      },
      {
        title: 'Two lessons of perspective, then the generations',
        body: [
          'The Broken Passage teaches that 3D reveals what 2D hides: a chamber behind the scenery.',
          'The Painted Stair teaches the reverse: flattened into 2D, a painting of stairs becomes stairs.',
          'Then the Halo Path turns the generations into tools: light fences 8-bit never drew, brambles that are only scenery in 16-bit, handholds that hold only in ink, and an ending in three beats about updates themselves.',
        ],
      },
      {
        title: 'The end of the Halo Path',
        body: [
          'The Stalled Gate never finished updating: its stele is a blur of 16-bit pixels until full detail is rolled over it. The Update Wave is a band of Early 3D sweeping a broken aqueduct; the missing span only exists inside it, so you cross by walking with it. At the World Wheel, six version plates each install in their own generation, and with all six the wheel turns.',
          'The canyon was once two stone slabs between sheer walls (before, on the left); it became a two-tier Roman aqueduct broken in mid-canyon, with water pouring off each end, ivy and lavender.',
        ],
      },
      {
        title: 'How the world is built',
        body: [
          'Every model is made by a Blender script: terrain from the game’s own height field, trees with levels of detail, rocks, ground cover, ancient stone and the aqueduct, painted in one palette (no photographs) and compressed for the web.',
          'The camera keeps Pip in view (it collides with terrain and walls, and dissolves foliage between itself and him), and every jump on the route is checked against Pip’s measured jump.',
        ],
      },
    ],
  },
  {
    id: 'interface',
    path: '/art/interface/',
    label: 'Interface',
    title: 'An interface that evolves — Bitbound Art & Design',
    description: "Bitbound's HUD and title screen in all six generations: blocky 8-bit boxes to Beyond's holographic linework.",
    heading: 'Interface',
    intro: 'The HUD is one component with six skins, switched by the generation the world is in.',
    cards: [
      {
        title: 'An interface that evolves with the world',
        body: [
          "Blocky 8-bit boxes, bevelled 16-bit console panels, chunky early-3D plastic, comic-ink stylized bubbles, clean modern glass, and Beyond's thin holographic linework.",
          'It stays minimal: portrait, energy cells, bits, generation, the dimension-shift state and one contextual prompt. When a shift is blocked, the chip says why.',
        ],
      },
      {
        title: 'The title screen',
        body: [
          'A composed scene drawn live by the game, with the generation timeline in the corner: pick a generation and the whole scene turns into it. 8-bit and 16-bit are their own pixel scenes, drawn the way those consoles drew.',
        ],
      },
    ],
  },
  {
    id: 'map',
    path: '/art/map/',
    label: 'World Map',
    title: 'The world map — Bitbound Art & Design',
    description: 'The connected world of Bitbound: the meadow, the ruins, the Painted Stair, the plateau and the Halo Path.',
    heading: 'World map',
    intro: 'The map fills in as you explore. Hidden 3D rooms only appear once you find them through depth.',
    cards: [
      {
        title: 'A connected world',
        body: [
          'The surface is bright and readable; the deeper and higher you go, the older and stranger it gets. Diamonds mark upgrades, dashed rooms are undiscovered, and isometric rooms are hidden 3D spaces reachable only through depth.',
        ],
      },
    ],
  },
];

export const artPage = (id: ArtTab) => ART_PAGES.find((p) => p.id === id)!;
