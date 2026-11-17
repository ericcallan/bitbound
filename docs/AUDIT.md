# Phase 7 audit: Modern HD and Beyond, camera, shift and level reliability

This pass started from the Beyond scene in your screenshot (Pip apparently suspended between two stone slabs in
a canyon, "2D · SHIFT BLOCKED") and, as agreed, stops after rebuilding that scene as the benchmark for your
review. Everything below was built, tested and measured in this pass; nothing is estimated unless it says so.

Screenshots: `docs/screens/before/` and `docs/screens/after/` (captured by `npm run screens` from the running game
with Playwright; same scenarios, same cameras).

## 1. Findings

| # | Finding | Cause | Severity | Status |
|---|---|---|---|---|
| 1 | Pip appeared to stand in mid-air between two slabs on the aqueduct | The two halves sit at different depths (z −5.4 and +5.4) and only line up from the side, but the 2D camera sat 3.5 units above the deck, so perspective drew them a unit apart vertically and with a gap. Pip was on a valid 2D-only bridge. | High (the scene made no sense) | Fixed |
| 2 | "2D · SHIFT BLOCKED" with no explanation | Intended: unfolding there would drop Pip into the canyon (the bridge exists only in 2D). The chip said only "blocked"; the toast didn't say where it would work. | Medium | Fixed |
| 3 | The canyon was two flat slabs between sheer, featureless walls | Phase 6 made every height change a sheer face so puzzles can't be walked round, and drew it as plain extruded terrain. Nothing explained the slabs. | High | Fixed at the benchmark |
| 4 | 3D camera filmed rock walls (e.g. on the aqueduct, the seal ridge behind Pip) | Camera collision tested boxes only; terrain was a height clamp at the camera point, not along the line of sight | High | Fixed |
| 5 | Camera ended up inside platforms and thin walls when Pip stood close to them | A 1.6-unit minimum distance overrode the collision | High | Fixed |
| 6 | Falling from a height, the landing was off screen | The chase target ignored the ground below | Medium | Fixed |
| 7 | The far aqueduct half's secret (c7) could not be collected | The seal-door ridge sealed off its bank; every simulated attempt fell into the canyon | Medium | Fixed |
| 8 | The seal door never sank when opened | Its collider was disabled but nothing lowered its mesh: Pip walked through a solid-looking wall | Medium | Fixed |
| 9 | A generation change could make brambles solid around Pip | Switching generation (1–6 keys, once unlocked) while walking behind the 16-bit brambles; found by the fuzz | High (stuck inside a solid) | Fixed |
| 10 | Beyond's glass faceplate could white out Pip's face | A mirror-like specular highlight when the low sun lines up with the camera | Low | Fixed |
| 11 | Title screen did not look professional | Six clashing art styles behind the menu competing with the logo and buttons | — | Rebuilt |
| 12 | No browser tests, no camera tests, no jump-reachability validation | — | — | Added |

## 2. What was built

**Title screen.** A composed scene built for the menu from the game's own assets and rendered by the game's
renderer: Pip on a mossy slab above a pool, a waterfall over layered cliffs, a ruined terrace with a stone ring and
banners, a floating island. Your draft's layout: logo and New Game / Continue / Settings / Art & Design /
Generations on the left, the generation timeline (Pip's face in each style) top right, the "Break the Frame" card
bottom right, input hints bottom left. Hovering or selecting a generation ripples the whole scene into it;
left/right arrows and the bumpers step through. "Generations" opens the six-way comparison.

**Perspective shift.**
- The HUD chip names the reason: Land first, Off the lane, Lane blocked, No ground on lane, Can't unfold here.
- A refused unfold on a 2D-only surface marks the nearest solid ground along the lane and says which way it is.
- Flattening from 3D slides up to 0.9 along the lane when the exact spot is obstructed. It only lands on ground
  with support on both sides of Pip's centre, never across a gap; otherwise the shift is refused as before.
- On 2D-only bridges the camera's eye drops to deck height, so pieces at different depths meet on the horizon.
- Each aqueduct half runs 1.5 past the middle, so the near one always overlaps the far one on screen; in 3D they
  stay 9 units apart.

**Camera.**
- Five rays from Pip to the wanted camera position, against both colliders and terrain. The camera pulls in up to
  the obstacle, never into it (the near plane follows).
- It lifts over a blocked view, decided from the unlifted view so it can't pump up and down.
- When Pip is pinned against a wall, the camera swings round to the clearer side.
- Walls that already fade (facade, hedge, mural, alcove) no longer push the camera in.
- A dithered cutaway dissolves trees, plants, rocks and ancient stone in a narrow cone between camera and Pip.
  Shadows are unaffected, and the terrain never dissolves.
- Framing: look-ahead in the direction of travel; over a drop the camera aims between Pip and the landing.
- 2D in Modern HD and Beyond frames 14% closer, with gentler depth of field.

**Level validation.** Pip measured by running the real controller, the route as a graph of the real colliders,
every jump checked against the measurements; see `docs/TRAVERSAL.md`.

**Debug overlay** (dev builds only, the backquote key):
- Readout: generation, position, velocity, ground, perspective, shift eligibility and its exact reason, camera
  distance and obstruction, checkpoint, fps, frame time, draw calls.
- Layers drawn into the scene: collision boxes, Pip's bounds, camera rays, the route graph with jump arcs coloured
  by spare room, the nearest unfold spot, fading occluders.

**The benchmark: the broken aqueduct.** Rebuilt as a ruined Roman viaduct crossing a river canyon. Gameplay
colliders unchanged.
- Each half is a two-tier arched viaduct on its own piers, from the river to the deck, broken off in mid-canyon
  (`scripts/blender/create_aqueduct.py`). The structure exists from Early 3D up.
- Large, warm masonry projected at runtime; painted two-tone in Stylized.
- Water runs along each deck's channel and pours off the break; the fallen span lies in the river.
- Two cascades come down the canyon's far walls, with mist and foam.
- About 120 rock outcrops with ferns on their ledges break up the walls; none rise between the 2D camera and the
  lane.
- Ivy hangs from the stone (more of it in Beyond), lavender grows on both banks, and a faint teal seam marks where
  each half broke ("where the world folded").
- Steep rock across the whole level now shows bedded strata in Modern HD and Beyond.

## 3. Tests

| Suite | Count | What it proves |
|---|---:|---|
| Vitest (headless) | 114 | Everything from Phase 6, plus the new suites below |
| `shiftFeedback.test.ts` | 7 | Block labels, the unfold hint, deck alignment from five camera positions, no 3D route from the overlap, repeated shifts, mid-air refusal, slide limits at a pit lip |
| `camera.test.ts` | 7 | ~1000 spots and four orbits across the level: never under the terrain, inside a solid, or without a line of sight to Pip; distance kept when clear; ridge handling; smooth turning; the landing kept in view |
| `traversal.test.ts` | 7 | Pip measured; goal reachable along the safest route with room on every jump; no softlocks; checkpoints safe; every lane bit reachable; the 3D secrets collected by simulated play |
| `qa.test.ts` additions | 2 | Sliding out from under a painted step; refusal when nothing is free |
| `valley.test.ts` addition | 1 | The cut in the seal ridge leads only onto the far half (the door can't be bypassed) |
| Playwright (real GPU) | 33 | 31 scenario × generation cases (no console, shader or asset errors; non-blank; colour-grid baseline); the title screen; the shift at three spots in the browser |

Run: `npm test` (Vitest), `npm run test:e2e` (Playwright; refresh baselines with `UPDATE_BASELINES=1`).

## 4. Performance

Apple M4 Pro, Chrome, quality High, GPU time from `EXT_disjoint_timer_query_webgl2` around the whole frame
(`window.__perf(3)` in dev builds), 3 s per sample, dev server.

| Scene | Buffer | GPU mean / p95 (ms) | Draw calls | Triangles |
|---|---|---:|---:|---:|
| Title screen (Beyond) | 2259×1149 | 8.25 / 8.54 | 138 | 1.30 M |
| Aqueduct, Beyond, 2D | 2259×1065 | 7.41 / 8.18 | 321 | 1.46 M |
| Aqueduct, Beyond, 3D chase | 2259×1065 | 7.84 / 8.37 | 353 | 1.79 M |
| Aqueduct, Beyond, high overview | 2259×1065 | 12.59 / 13.45 | 1,485 | 2.85 M |
| Valley overview, Beyond | 2259×1149 | 12.86 / 13.87 | 625 | 2.34 M |
| Plateau, Beyond, 2D | 2259×1149 | 9.19 / 9.35 | 397 | 1.66 M |
| Hidden chamber, Beyond | 2259×1149 | 11.37 / 12.38 | 558 | 2.04 M |

The gameplay views at the benchmark are well inside 60 fps (16.7 ms). The **high overview cameras miss the 12 ms
p95 target** (13.45 and 13.87 ms); they show the most of the valley at once. The valley overview was 12.63 ms in
Phase 6 at a 8% smaller buffer, so most of the difference is resolution, not this pass (not separately measured).
**Camera collision cost** (CPU, measured in Node on the same machine): 48–76 µs per camera step with the rays
against ~300 boxes and the terrain, against ~1 µs without; at 60 fps (two fixed steps per frame) that is 0.10–0.15 ms
of a 16.7 ms frame. Cheap enough; a broad-phase grid for the boxes would cut it further if needed.

Shipped assets: 13.8 MB (budget 15 MB): `aqueduct.glb` 56 KB, `ui/pip_hd.webp` 12 KB added. No new downloads were
needed (the plan allowed up to 3 Poly Haven sets and an 18 MB budget; neither was used). JS bundle 1.63 MB
(479 KB gzipped); the debug overlay and scenarios are not in it.

## 5. Not done, or not verified

- **The rest of Modern HD and Beyond** (opening valley, ruins, passage, Painted Stair, plateau, relief cliff,
  summit) has not had the benchmark treatment. That is the next phase, after your review.
- **The high overview cameras** are over the 12 ms target (above).
- **The title screen's 8-bit and 16-bit looks** are the 3D scene through the pixel filter, not the tile renderers
  (those are 2D-only).
- **The cutaway** was checked by eye in one spot (inside a tree canopy) and by shader compile; there is no
  automated check that it never produces artifacts.
- **Camera tests** are headless (positions and rays); "Pip is visible" is judged by line of sight to his upper body,
  not from rendered pixels.
- **The new art** follows your reference in composition and materials, but not in fidelity: it is real-time
  geometry built by script, not a painting.
- **Sound** for the aqueduct (water) was not added.
- **Expert shortcuts** remain possible (e.g. clearing the plateau pit without the moving platform); listed in
  `docs/TRAVERSAL.md`, judged harmless.
