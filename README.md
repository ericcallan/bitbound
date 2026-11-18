# Bitbound

A playable browser game about Pip, a small courier robot carrying a stuck world's missing updates, one graphical
generation at a time.
Each of the **six generations** (8-bit, 16-bit, Early 3D, Stylized, Modern HD, Beyond) is a chapter, and also a
puzzle tool. The same world **shifts between a 2D side-scroller and full 3D**.

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # 114 simulation tests, including a bot that plays new game → ending
npm run test:e2e       # 33 browser tests on the real GPU (Playwright): every scenario × generation
npm run screens        # screenshots of every dev scenario into docs/screens/latest
npm run build          # typecheck + production build
npm run assets:build   # rebuild every 3D asset from the Blender scripts (needs Blender 5.3)
```

## Story: "Patch Day"

> **Direction from here:** `docs/ART_BIBLE.md` (the art direction for all six generations) and `docs/CHAPTERS.md`
> (the merged story in three acts, the six chapters as regions, and the roadmap). `docs/benchmark/` holds the
> six-generation benchmark of the shard ruins.

The valley is a world that updates itself, one graphics generation at a time, each time the world wheel on Mount
Halo turns. The wheel stuck at version 1.0. Pip, a courier robot drawn in sixteen pixels, carries the missing
updates up the mountain.

- **The world speaks in patch notes:** short, dry changelog lines ("Patch 3.0 installed: depth. Things have backs
  now."), written in each generation's own style, 8-bit capitals first.
- **Every puzzle is a "Known issue"** fixed by some version's rules: the broken bridge, the painted stair, light
  fences, brambles, stones that never finished updating.
- **Each patch redraws Pip too, and he notices:** square, then orange, a back, an outline, a shadow, and finally
  every version of himself at once.
- **Nothing is ever deleted.** Old versions are kept underneath, which is why Pip can **roll back** the world
  around himself (Q). In the Hidden Chamber are earlier couriers whose updates never arrived. "Mine will."

| Ch | Generation | Patch |
|---|---|---|
| 1 | 8-bit | Version 1.0 |
| 2 | 16-bit | Patch 2.0 · Colour |
| 3 | Early 3D | Patch 3.0 · Depth |
| 4 | Stylized | Patch 4.0 · Ink |
| 5 | Modern HD | Patch 5.0 · Light |
| 6 | Beyond | Patch 6.0 · Every version at once: the Halo Path, solved with Rollback |

**The end of the Halo Path** is three beats about the generations themselves:
- **The Stalled Gate:** a gatehouse that never finished updating (its little zone is still 16-bit). The stele beside it
  is a blur of pixels until you roll full detail over it (Q + 6); then it reads "TURN ME GENTLY" and the doors sink.
- **The Update Wave:** the aqueduct's middle span is gone, too wide to jump. A band of Early 3D sweeps to and fro
  across the canyon like a progress bar that never finishes, and inside it the span exists again. You cross by
  walking with the wave. Rollback is refused over the canyon.
- **The World Wheel:** six version plates, 1.0 to 6.0. Stand on each while the world there is its generation (roll
  back to it, or plate 6.0 in Beyond itself); each lights a segment of the wheel. With all six, it turns.

Every gate on the path stands clear of the rock in 2D: behind it a rock spur crosses the valley, and in front its
own side wall runs out across the meadow (drawn in 3D only), so nothing can be walked round.
**Where it goes next.** The map already shows what lies below the valley: Megatower, stuck on 2.0 (a 16-bit
arcade city), and the Streets Below, on 3.0. Each region is a different era to patch, the earlier couriers can be
woken as helpers, every new version adds a rule to roll back to, and after the credits: "Patch 7.0: in
development."

## Controls

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Move | `WASD` / arrows | Left stick / d-pad |
| Jump (hold for height) | `Space` / `K` | A |
| Dimension Shift / interact | `E` | B / X / RB |
| Rollback (hold for the generation wheel; tap to toggle) | `Q` | Y |
| Orbit the 3D camera / recentre | Drag with the mouse / `C` | Right stick / stick click |
| Pick a generation (once unlocked) | `1`–`6` | — |
| World map / pause | `M` / `Esc` | Back / Start |

## Graphics

- **8-bit** (2D only) is a real tile renderer: a green landscape of 16×16, three-colour tiles, flat hills and
  bushes, plain clouds, about 240 rows at a whole-number scale filling the screen, and a 3-colour 16×16 Pip.
- **16-bit** (2D only): tiles from the painted ground materials on the bible's 4-step ramps, three parallax layers
  (lavender ranges, sage hills) over a banded sky, and Pip and the scenery pre-rendered from the Blender models;
  about 224 rows, filling the screen.
- **One 3D world** from Early 3D up, across the whole level: continuous terrain, cliffs, river gorges, forest and
  meadow you can walk anywhere in, shaped so no puzzle can be walked round. Early 3D and Stylized have their own
  terrain looks and their own forest (the same trees, faceted or as smooth three-mass shells).
- **Blender-built assets** (`scripts/blender/`, sources in `assets/blender/`): Pip (18-bone rig, 11 clips plus
  procedural foot planting, lean and squash), one tree in every generation (the art bible's three-mass silhouette,
  with LODs), ground cover and litter, rocks, props, ancient stone and the terrain. No photographs: every surface is
  a painted material in the bible's palette, baked in Blender and optimised with glTF Transform; colour textures
  ship as KTX2.
- **Modern HD** is late-afternoon daylight under a real HDRI sky, with grass in drifts; **Beyond** is golden hour
  under its own sky, with relief-mapped ground, cloud shadows, dappled light on the forest floor, falling leaves,
  butterflies and a detailed Pip, and no depth-of-field blur over play.
- **Title screen:** a composed live scene with a generation timeline. 8-bit and 16-bit are their own pixel scenes
  (`src/ui/title/pixelTitle.ts`: 240 rows in the 8-bit palette only, and 224 rows from the 16-bit tiles and
  pre-rendered sprites), reached through a mosaic transition; the 3D set stops rendering behind them.
- **Generation flag:** every switch says which generation it is, as "Generation 3 (1996): Early 3D" (8-bit 1985,
  16-bit 1991, Early 3D 1996, Stylized 2002, Modern HD 2013, Beyond 2026), in that generation's own banner style;
  the title's timeline shows the same line.
- **Older generations inside a newer world** (the Rollback bubble, the sleep field): the ground and cliffs stay,
  drawn in that generation's look, so nothing turns see-through.
- **Sound:** valley ambience, the river, footsteps by surface, and the hidden chamber's reverb.

See **docs/GRAPHICS_REPORT.md** for measurements and shortcomings, and **docs/ASSETS.md** for sources, tools and
licences. **Art & Design** (title screen, or `/art/`) shows Pip in each generation's real renderer, and compares any
place in the level across all six generations live. Desktop only (keyboard or gamepad); phones get a notice.

## Hosting, sharing and search

Deploys to **Vercel** or **Netlify** as a static site (`vercel.json`, `netlify.toml`; build `npm run build`,
output `dist`).

- **Link previews** (Slack, iMessage and SMS, X, Discord, LinkedIn, Facebook, WhatsApp, Telegram): Open Graph
  and X card tags, a 1200×630 image (`public/og.jpg`) and a square one (`public/og-square.jpg`), the web app
  manifest and icons, and JSON-LD. Every link points at **https://bitbound.world** (set in `src/shareCopy.ts`
  with the copy; a `SITE_URL` environment variable overrides it for a staging test). Regenerate the images from the live title scene with `npm run og` (dev server running).
- **Routes:** the game is `/`; Art & Design is `/art/`, `/art/environment/`, `/art/interface/` and `/art/map/`
  (`src/ui/router.ts`; back and forward work). The build writes each art route its own HTML with its own title,
  description, canonical URL, share tags and image (`public/og-art.jpg`), JSON-LD (a `CollectionPage` with
  breadcrumbs) and its text, all from `src/content/artCopy.ts`, the same copy the page shows. It also writes
  `sitemap.xml` and a `404.html` (never indexed) that both hosts serve for unknown addresses.
- **The Share button** (title screen, end card, Art & Design) opens the system share sheet where there is one, otherwise copies
  the link.
- **Kept out of search for now:** a `noindex` meta tag, an `X-Robots-Tag: noindex` header from the host config,
  and a robots.txt that blocks search engines and AI crawlers. The link-preview fetchers are allowed, so previews
  still work (they don't index).
- **Launch:** build with `PUBLIC=1` (drops the meta tags; robots.txt allows everyone and lists the sitemap) and delete the
  `X-Robots-Tag` header from `vercel.json` / `netlify.toml`.
- **Check a build:** `npm run build && npm run check:share`. It checks every tag, absolute URLs, image sizes and
  weights, the manifest, robots.txt, each art route's own page, the sitemap and the 404.
- **After the first deploy** (not verified yet, since there is no public URL), paste the link into
  [opengraph.xyz](https://www.opengraph.xyz), the
  [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/), the
  [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/), a Slack message and Messages.

## Performance

The page opens on a loader (plain HTML, on screen at the first paint) while the world downloads and then warms
up: every shader for every generation is compiled and every texture and model uploaded behind it
(`src/game/render/warmup.ts`), so the title appears finished and nothing compiles in play. Measured: the first
switch into each generation, shifts, the bubble and puzzle events cause no frame over 33 ms. The valley's plant
scatter is worked out once in small slices; the tile images, the shadow map and auto quality only do work when it
shows. Numbers, method and what didn't work: **docs/PERF.md** (`node scripts/hitch-bench.mjs` to re-measure).

## Development tools (dev builds only)

- **Scenarios:** `?scenario=aqueduct` (also `start`, `ruins`, `ruins3d`, `chamber`, `stair`, `plateau`,
  `aqueduct3d`, `aqueductView`, `seal`, `seal2d`, `fence2d`, `thicket2d`, `summit`, `wheel3d`) starts in a fixed state without touching your save. Add
  `&era=0..5`, `&mode=2d|3d`, `&freeze=1`.
- **Debug overlay:** the backquote key. Generation, position, velocity, ground, shift eligibility and the exact
  reason it's blocked, camera obstruction, fps, draw calls; layers for collision boxes, camera rays, the route
  graph and more.
- **GPU timing:** `await window.__perf(3)` in the console. **Hitches:** `node scripts/hitch-bench.mjs` (dev server
  running) records worst frames, long tasks and shader compiles per step of a scripted route.
- **Holes:** `await window.__holes(0)` compares the ground's depth with and without an 8-bit bubble around Pip
  (`e2e/holes.spec.ts` sweeps the whole route with it). In dev, any shader compiled after the warm-up is logged
  as `[warm] late compile`.

## Architecture

```
src/game/
  sim/        Game.ts: 120 Hz fixed-step simulation, story director, Regress, Halo Path
  collision/  World.ts: swept AABB world plus the valley height field (walk anywhere, slopes)
  player/     PlayerController.ts
  shift/      DimensionShift.ts: 2D ⇄ 3D
  camera/     CameraRig.ts: 2D follow, 3D chase with orbit, collision, ground clamp
  era/        EraSystem.ts: generations, ripples, rifts, the Regress bubble, censor fields
  level/      meadows.ts (the level as data), valley.ts (the height field gameplay and art share)
  render/     GameView.ts, LevelView.ts, terrain.ts, dressing.ts, sky.ts, assets.ts (glTF + Meshopt),
              textures.ts (KTX2), eraMaterial.ts (per-pixel generation rules), retro/ (8- and 16-bit tile
              renderers, 16-bit sprites), post/ (composite)
  pip/        PipModel.ts (classic rig), PipGLB.ts (Blender Pip), face.ts
scripts/      blender/*.py, optimize-assets.mjs, validate-assets.mjs, build-assets.mjs, fetch_polyhaven.py
src/test/     Vitest suites + a bot that plays the whole game through the real input path
```

## Verification

`npm test` runs 123 tests: a full bot playthrough, the era discard rules (no holes in the ground), the
generation flag, a resume matrix, fuzz, Halo Path rules, valley height-field
collision across the whole level (no puzzle can be walked round), readability, the 8-bit palette and tile limits,
the 3D camera across the whole level, shift feedback, and traversal (every jump checked against Pip's measured
jump; see **docs/TRAVERSAL.md**). `npm run test:e2e` runs the browser tests, including a sweep of the whole route for see-through holes with 8-bit
and 16-bit bubbles in 2D and 3D, the loader, and the generation flag. See **QA.md** and **docs/AUDIT.md**.
