# Graphics report

## Phase 1 of the Great Unfolding: the art kit (2026-11-18)

The art direction in `docs/ART_BIBLE.md` applied to every generation, checked on the six-generation benchmark
(`docs/benchmark/`, before and after side by side in `compare-phase1.jpg`). Everything below was built and looked at
in the game; numbers are measured unless marked otherwise.

**No photographs.** Every surface is a painted material in the bible's palette, built in Blender
(`painted_shader` in `scripts/blender/common.py`):
- broad colour regions, value variation and brush strokes;
- flecks, pebbles, cracks and ivory masonry;
- worn edges and cooler crevices on modelled objects;
- moss on top faces.

The seven ground sets are baked seamless (`scripts/blender/create_painted_textures.py`; UV wrapped onto two circles
in 4D noise). The gateway stone, rocks, bark and signpost are re-baked with it. The terrain's khaki-to-green fix is
gone, since the colours are right at the source.

**One tree in every generation.** `create_tree.py` grows the bible silhouette: three canopy masses on a slightly
leaning trunk, with leaf clumps shaded darker toward each mass's underside and core so the masses separate. Each
tree also exports:
- a smooth `_shell` (Stylized);
- a faceted `_low` (Early 3D).

The changes per generation:
- **8-bit:** one block per mass.
- **16-bit:** the sprite is re-rendered from the new tree.
- **Forest:** the Early 3D and Stylized views now have the whole forest edge. Before, they had none; the
  instances are skipped when that generation is nowhere on screen.

**Per generation.**
- **8-bit:** the palette is re-tuned (warm earth instead of brick red, ivory stone instead of lilac, moss
  greens), and stone is warm in every generation.
- **16-bit:**
  - grass and stone tiles come from the painted sets, reduced to 4-step hue-shifted ramps;
  - soil is drawn on its ramp the way an artist of the time would;
  - the parallax layers are recoloured lavender and sage.
- **Early 3D:** no posterise; a lavender-blue fog; half the dither.
- **Stylized:**
  - palette ground with value structure (slopes a band darker, ground far behind the path paler and cooler);
  - deeper colour;
  - a fix: the rim light lit the whole floor in 2D, which is what made Stylized look washed out.
- **Modern HD:** grass grows in drifts and thins along both edges of the path; flowers grow in single-colour
  groups.
- **Beyond:**
  - no depth of field over play (only in cinematics, and a trace for far hills in 3D);
  - falling leaves and butterflies;
  - dappled sunlight drifting on the forest floor.

**Reference art** is now rendered in Blender from the game's assets (`scripts/blender/render_bible.py`):
`docs/art/silhouettes.png` and `docs/art/tree-generations.png`.

### Measurements

GPU time: Apple M4 Pro, Chrome, drawing buffer 2259×1065, `window.__perf(5)` (mean / p95 over 300 frames), dev
server, one headless page.

| Scene | Before (this session's earlier runs) | After |
|---|---:|---:|
| Beyond, ruins 3D overview | 12.3–13.4 / 13.3–14.8 ms, 2.34 M triangles | **10.45 / 11.52 ms**, 1.57 M triangles |
| Modern HD, ruins 3D overview | — | 8.72 / 9.78 ms |
| Stylized, ruins 3D overview (now with its forest) | — | 2.27 / 2.76 ms |
| Early 3D, ruins 3D overview (now with its forest) | — | 2.22 / 3.42 ms |
| Beyond, ruins 2D | — | 9.48 / 10.41 ms |
| Beyond, aqueduct 3D | 7.68–9.35 ms mean | 7.98 / 8.85 ms |
| Beyond, hidden chamber | 11.2–11.8 ms mean | 11.27 / 11.84 ms |

Beyond's p95 is now under its 12 ms target at the ruins. Dropping the depth-of-field blur over play and the
lighter trees outweigh the new leaves, butterflies and dappled light.

**Shipped assets: 6.6 MB** (was 13.8 MB; budget 15 MB). The ground textures went from 5.5 MB to 0.9 MB. Details are
in `docs/ASSETS.md`.

### What still falls short

- **Terrain shapes** are unchanged off the path: sheer mesas still read as blocks from high cameras. The bible's
  stepped rock (and the stepped variant of `create_rocks.py`) is Phase 2 work. The rock and the plinth on the
  silhouette sheet are today's assets.
- **8-bit:**
  - the Shard arch's columns still show purple on their shaded faces;
  - the machine, sign, Bits, enemies and checkpoints are still snapped meshes, not authored sprites (Phase 2).
- **Modern HD and Beyond** are still close in 2D: Beyond's extra life shows mostly in 3D and in motion. The deep
  pass is Phase 6.
- **The flower at x 25.2** still fills the left of the benchmark's 3D frame. That frame's orbit puts the camera
  beside it; normal play behind Pip is clear of it.
- **The browser baselines** (`e2e/baselines`) all changed and were not refreshed; that is a heavy run, left for the
  user.
- **Not judged in motion:** wind on the new trees, the leaves and butterflies, and the dappled light were only
  checked in still frames.

## Earlier phases

**Phase 7** (the title screen, camera and shift reliability, level validation, and the broken aqueduct rebuilt as
the benchmark for Modern HD and Beyond) is reported in **docs/AUDIT.md**, with its measurements. The Phase 6 report
follows unchanged.

## Phase 6

Phase 5 built the opening valley as a 3D slice and listed what still fell short. Phase 6 worked through that list,
plus new art direction (Modern HD darker and more advanced, Beyond richer still, 8-bit as a green landscape). Everything
below was built and checked in this pass; numbers are measured unless marked otherwise.

## What changed

**Readability.** Nothing in front of the path hides Pip or an enemy (a test enforces it with footprints measured
from the largest variant of each prop). Checkpoint markers stand behind the path; none at the spawn point.

**Performance.** The Blender dressing is split into 16-unit spatial cells (culled per cell), ground cover thins
with lens-scaled distance (so the long 2D lens keeps full density), distant trees use a 2.7k-triangle LOD and cast
shadows from it via a shadow-only render layer, trunks were decimated after baking, the terrain skips layers with
no weight, and foliage resolves its generation per vertex. Beyond's valley overview went from p95 17.3 ms to 10.8 ms
of GPU time before the art pass below spent part of that headroom.

**Modern HD** (late afternoon): lower exposure, firmer contrast, a darker sky, less fill, ambient occlusion, distance
and height fog, and a close-range detail normal on the ground.

**Beyond** (golden hour): its own HDRI sky rotated so a low sun sits in the west; warm key over the sky's cool fill;
golden haze and graded sky; relief-mapped ground near the camera; damp ground by the river; scree, rock and snow on the
far heights; cloud shadows drifting over everything; Blender ground litter (pebbles, twigs, fallen leaves) and two more
plants; moss on the ancient stone; light flowing through the glyph inlays; and Pip with a clearcoat shell, fine
scratches, pulsing teal circuit seams and a glass display.

**One 3D world for the whole level.** The height field covers x −8 to 254. Off the path the ground keeps each
section's exact height, so every rise is a sheer rock face (the Painted Stair can't be walked round), raised sections
drop sheer to the stream, every pit is a gorge across the valley and every gate sits in a rock ridge. Tests prove the
gates and the plateau can't be bypassed and the hidden chamber is still reachable. Chamber walls, the aqueduct and the
relief cliff are chipped Blender stone textured at runtime with projected scanned masonry.

**Dark interior.** The hidden chamber has a roof only the sun's shadow camera sees, so daylight falls in as shafts;
inside, the sky fill fades and the teal machinery glows; sound gains reverb and a low drone.

**Terrain looks per generation.** Early 3D samples the scans at a forced coarse mip and posterises them; Stylized
uses flat painted colours with soft bands.

**Scenery props.** A Blender mushroom cluster and signpost replace the cartoon ones from Modern HD up; the bloomer
keeps its face and animation but is rebuilt in detail (tube stem, curled blades, velvet petals, glossy eyes).

**8-bit** is a green landscape: grass-topped earth and stone tiles (16×16, three colours each), flat two-colour
hills and bushes, plain clouds, blocky trees, and about 240 rows at a whole-number scale (since 2026-11-17 the frame
fills the screen; it used to sit between letterbox bars)
(read back from the frame: 240 rows, 0 off-palette pixels).

**16-bit** is now real: 24×24 tiles cut from the scanned ground materials and reduced to 12 colours; three painted
parallax layers over a banded sky; Pip (idle, 4 walk frames, jump) and the scenery pre-rendered from the Blender
models; about 224 rows, filling the screen; the camera pulls in from the 8-bit frame on the upgrade ripple.

**Animation.** Procedural layers on the keyframed clips: feet planted on slopes (verified: both soles on the terrain
across and along a slope), walk blending into run by speed, lean into turns and acceleration, squash and stretch.

**Sound.** Valley ambience (wind, leaves, birds), river loudness by distance to water, footsteps by surface (grass,
path, stone, wood, water), and the chamber's reverb and drone. Levels checked at the master output (peak ≤ 0.37, no
clipping); not judged by ear.

**Textures.** Colour maps ship as KTX2 (Basis ETC1S, encoded with the official KTX-Software 4.4.2) and stay compressed
on the GPU.

**Title screen** redesigned (centred logo, high-contrast buttons with one icon set, save summary on Continue, focus
states, keyboard and gamepad navigation, entrance motion). Phones see a "built for desktop" notice with "Try anyway".

## Measurements

Machine: Apple M4 Pro, Chrome, 120 Hz display, drawing buffer 2259×1065 (DPR 2), quality High. GPU time from
`EXT_disjoint_timer_query_webgl2` around the whole frame; frame time is vsync-capped at 8.33 ms. Each sample 3 s
(mean / p95), measured on the dev server (same shaders as production).

| Scene | GPU ms (mean / p95) | Frame ms | Draw calls | Triangles |
|---|---:|---:|---:|---:|
| 8-bit, 2D | 2.03 / 3.35 | 8.34 | 241 | 7 k |
| 16-bit, 2D | 1.44 / 2.58 | 8.33* | 321 | 26 k |
| Early 3D, 2D · 3D overview · 3D chase | 2.89 · 2.47 · 2.35 | 8.3 | 185–1,147 | 0.30–0.37 M |
| Stylized, 2D · 3D overview · 3D chase | 2.66 · 2.44 · 2.32 | 8.3 | 236–1,271 | 0.35–0.48 M |
| Modern HD, 2D | 8.10 / 9.07 | 8.32 | 382 | 1.93 M |
| Modern HD, 3D valley overview | 9.72 / 10.98 | 8.31 | 559 | 2.23 M |
| Modern HD, 3D chase | 8.62 / 10.75 | 9.51 | 1,299 | 2.61 M |
| Beyond, 2D | 10.92 / 12.64 | 8.33 | 333 | 2.14 M |
| Beyond, 3D valley overview | 11.57 / 12.63 | 10.45 | 595 | 2.35 M |
| Beyond, 3D chase | 11.54 / 12.72 | 12.57 | 1,557 | 3.31 M |
| Beyond, plateau · Halo Path · summit (overview) | 11.01 · 10.61 · 10.61 (p95 ≤ 12.6) | ~10 | 338–572 | 1.8–2.3 M |
| Beyond, hidden chamber | 10.85 / 11.37 | 9.74 | 377 | 1.83 M |

\* One 16-bit sample read 66 ms per frame; it did not reproduce. A dedicated check (8-bit → 16-bit switch, 4 s,
every frame recorded) showed no frame over 25 ms, and steady 16-bit runs at 120 fps with 3.8 ms CPU render time.

**Material texture GPU memory:** 30.7 MB measured with KTX2 colour maps (the colour maps take ~2.7 MB of that). The
same textures uncompressed would be ~61 MB (computed from their sizes, not measured separately).

**Loading** (production build, cold cache, localhost): menu interactive at 0.42 s, every asset loaded at 1.0 s,
11.5 MB transferred. Localhost has no network limit; on a 50 Mbps connection the assets alone would take about 1.9 s
(computed, not measured). New Game never waits for the HD assets (they preload in the background; 8-bit needs none).

**Shipped assets:** 13.7 MB including the KTX2 transcoder (budget 15 MB); details in `docs/ASSETS.md`.

## What still falls short

- **Beyond is 0.6 ms over its p95 target.** The performance step reached 10.8 ms; the Beyond art pass (relief
  mapping, cloud shadows, litter, Pip's shell) brought the valley overview to p95 12.63 ms against a 12 ms target.
  It still holds 60 fps with room to spare (16.7 ms budget). Medium and Low quality thin ground cover further.
- **8-bit HUD** is still the crisp pixel-font overlay, now sitting in the letterbox bar rather than drawn into the
  240-row pixel frame.
- **8-bit and 16-bit objects:** the machine, sign, bits, enemies and checkpoints are still 3D meshes snapped to the
  pixel grid and palette (8-bit) or 15-bit colour (16-bit), not authored sprites. The bloomer, flowers and crystals
  are also snapped meshes in 16-bit. They read as sprites, but aren't drawn as such.
- **Enemies and pickups** were planned to get physical materials in the modern generations; not done.
- **The title screen's 3D bands** use the procedural sky, not the real HDRI skies of play.
- **Normal maps** stay WebP (KTX2 UASTC encoded them at ~1.1 MB each, over the download budget).
- **The raised sections** of the level stand as mesas with sheer walls. That is what keeps the puzzles intact in 3D,
  but it can read as blocky from high cameras.
- **The terrain grid is 0.5 units**, so the gorge edge at x = 135.6 is drawn 0.1 off; collision uses the exact
  function.
- **The phone notice** was checked by code review and build only, not rendered on a phone or narrow window.
- **Sound** was not judged by ear; **animation** is keyframed by script plus procedural layers, not motion capture.
- **Loading** was measured only on localhost.
