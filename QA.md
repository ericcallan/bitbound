# QA report: PIP — Beyond the Frame (phase 6)

Build: `tsc --noEmit` clean, `vite build` clean (one 1.59 MB chunk, 466 KB gzipped).

## 1. Automated coverage (Vitest, headless): 92 / 92 passing

| Suite | What it proves |
|---|---|
| controller / shift / puzzle | Physics, shift safety and puzzle rules |
| `playthrough.test.ts` | A bot plays new game → Halo Path → ending through the real input path, with terrain collision on everywhere in 3D |
| `qa.test.ts` | Resume matrix over every checkpoint, fuzz over 16 seeds (no interpenetration with the terrain pads or boxes), save migration |
| `chapter6.test.ts` (10) | The Halo Path's generation-rule obstacles |
| `valley.test.ts` (11) | Lane heights exact for every ground section; every pit a deep gorge; gates can't be walked round; the plateau can't be reached without the Painted Stair; the hidden chamber is reachable; cliffs stop Pip; the camera never goes underground |
| `readability.test.ts` (3) | No foreground prop covers any enemy patrol, the spawn or a checkpoint (footprints from each prop's largest variant) |
| `retro.test.ts` (5) | 8-bit tiles 16×16 in exactly three palette colours; hills/bushes two colours; sprites ≤ 3 colours; palette-only sky and clouds; tiles only from solids that exist in 8-bit |

## 2. Browser pass (Chrome, M4 Pro, dev server and production build)

| Area | Result |
|---|---|
| Spawn: Pip visible, no marker in front; enemy e2 patrols clear of the secret bush | ✅ |
| Performance pass: Beyond overview p95 17.3 → 10.8 ms before the art pass (12.6 ms after it) | ✅ measured |
| Modern HD vs Beyond from the same camera: both darker, Beyond warm golden hour with litter, moss, glyph flow, cloud shadows | ✅ |
| Pip in Beyond: clearcoat shell, teal circuit seams, glass display; Modern HD clean | ✅ |
| Whole level in 3D (passage, Painted Stair, plateau, Halo Path, aqueduct, summit): one continuous world, no floating boxes | ✅ |
| Hidden chamber: dark with light shafts through the roof, no plants inside | ✅ |
| Early 3D (chunky low-res terrain) and Stylized (painted) valley looks | ✅ |
| Scenery props (mushrooms, signpost, HD bloomer) | ✅ |
| 8-bit: green landscape, frame read back: exactly 240 rows, 0 off-palette pixels | ✅ |
| 16-bit: tiles, parallax, pre-rendered Pip and scenery; 8 → 16-bit ripple | ✅ |
| Foot planting on a slope: both soles on the terrain (read back from the bones) | ✅ |
| Sound: master output peak ≤ 0.37 across idle, walking, near water | ✅ levels only |
| KTX2 colour textures load and transcode; no console errors | ✅ |
| Cold load of the production build (localhost): menu 0.42 s, all assets 1.0 s, 11.5 MB | ✅ measured |
| Title screen: layout, focus states, save summary, keyboard navigation | ✅ |
| Console during all of the above | ✅ no errors |

## 3. Bugs found and fixed in this pass

| # | Bug | Fix |
|---|---|---|
| 1 | The start checkpoint marker stood in front of the spawn, over Pip | No marker at the spawn; markers behind the path |
| 2 | Foreground bushes covered four enemy patrols | Moved clear (test added) |
| 3 | Shadows from full-detail trees cost ~3 ms | LOD stand-ins on a shadow-only layer |
| 4 | Per-pixel generation lookups on every leaf fragment | Per-vertex generation for foliage |
| 5 | Beyond's first sun placement put the whole valley in the cliff's shadow | Sun moved to the west |
| 6 | Pip's Beyond scratches read as white scribbles; seams blew out to white | Gloss-only scratches; sparser, deeper teal seams |
| 7 | The chamber pad sat 3 cm below its floor box (fuzz caught Pip inside it) | Exact pad height; only the mesh is lowered |
| 8 | Old ground boxes beyond the slice still drew as bright green slabs | All ground uses the terrain-aware materials |
| 9 | Big stone walls blurry with one unique bake, and over the size budget | Runtime projected scanned stone |
| 10 | Pip's procedural offsets accumulated on unkeyed bone channels (hips at −414) | Bones restored to rest before the clips |
| 11 | Sound-effect reverb routed through the music's reverb (doubled) | Separate room reverb |
| 12 | Lowering the valley wall made it walkable (test caught it) | Full height kept, moved further back instead |

## 4. Known limitations

See `docs/GRAPHICS_REPORT.md` → "What still falls short".
