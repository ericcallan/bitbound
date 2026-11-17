# Bitbound

A playable browser game about Pip, a small robot restoring a forgotten world one graphical generation at a time.
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

## Story: "The world remembers"

Long ago ARCHIVE, the world's kindly and forgetful caretaker, folded everything down small to keep it safe, then
forgot how to unfold it. Pip is the little helper it built to try again. With each generation Pip restores,
ARCHIVE remembers a bit more, and its voice grows from cheerful 8-bit instructions into something warm and
wistful. There are no villains.

| Ch | Generation | Title |
|---|---|---|
| 1 | 8-bit | Boot |
| 2 | 16-bit | Colour |
| 3 | Early 3D | Depth |
| 4 | Stylized | Ink |
| 5 | Modern HD | Light |
| 6 | Beyond | The Waking World: the Halo Path, solved with Regress |

## Controls

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Move | `WASD` / arrows | Left stick / d-pad |
| Jump (hold for height) | `Space` / `K` | A |
| Dimension Shift / interact | `E` | B / X / RB |
| Regress (hold for the generation wheel; tap to toggle) | `Q` | Y |
| Orbit the 3D camera / recentre | Drag with the mouse / `C` | Right stick / stick click |
| Pick a generation (once unlocked) | `1`–`6` | — |
| World map / pause | `M` / `Esc` | Back / Start |

## Graphics

- **8-bit** (2D only) is a real tile renderer: a green landscape of 16×16, three-colour tiles, flat hills and
  bushes, plain clouds, exactly 240 rows letterboxed at a whole-number scale, and a 3-colour 16×16 Pip.
- **16-bit** (2D only): tiles cut from scanned ground materials, three parallax layers over a banded sky, and Pip and
  the scenery pre-rendered from the Blender models; 224 rows.
- **One 3D world** from Early 3D up, across the whole level: continuous terrain, cliffs, river gorges, forest and
  meadow you can walk anywhere in, shaped so no puzzle can be walked round. Early 3D and Stylized have their own
  terrain looks.
- **Blender-built assets** (`scripts/blender/`, sources in `assets/blender/`): Pip (18-bone rig, 11 clips plus
  procedural foot planting, lean and squash), trees with LODs, ground cover and litter, rocks, props, ancient stone
  and the terrain, baked from CC0 scans and optimised with glTF Transform; colour textures ship as KTX2.
- **Modern HD** is late-afternoon daylight under a real HDRI sky; **Beyond** is golden hour under its own sky, with
  relief-mapped ground, cloud shadows and a detailed Pip.
- **Sound:** valley ambience, the river, footsteps by surface, and the hidden chamber's reverb.

See **docs/GRAPHICS_REPORT.md** for measurements and shortcomings, and **docs/ASSETS.md** for sources, tools and
licences. In-game: Extras → Environment compares any view across all six generations. Desktop only (keyboard or
gamepad); phones get a notice.

## Hosting, sharing and search

Deploys to **Vercel** or **Netlify** as a static site (`vercel.json`, `netlify.toml`; build `npm run build`,
output `dist`).

- **Link previews** (Slack, iMessage and SMS, X, Discord, LinkedIn, Facebook, WhatsApp, Telegram): Open Graph
  and X card tags, a 1200×630 image (`public/og.jpg`) and a square one (`public/og-square.jpg`), the web app
  manifest and icons, and JSON-LD. Every link points at **https://bitbound.world** (set in `src/shareCopy.ts`
  with the copy; a `SITE_URL` environment variable overrides it for a staging test). Regenerate the images from the live title scene with `npm run og` (dev server running).
- **The Share button** (title screen, end card) opens the system share sheet where there is one, otherwise copies
  the link.
- **Kept out of search for now:** a `noindex` meta tag, an `X-Robots-Tag: noindex` header from the host config,
  and a robots.txt that blocks search engines and AI crawlers. The link-preview fetchers are allowed, so previews
  still work (they don't index).
- **Launch:** build with `PUBLIC=1` (drops the meta tag; robots.txt allows everyone) and delete the
  `X-Robots-Tag` header from `vercel.json` / `netlify.toml`.
- **Check a build:** `npm run build && npm run check:share`. It checks every tag, absolute URLs, image sizes and
  weights, the manifest, and robots.txt.
- **After the first deploy** (not verified yet, since there is no public URL), paste the link into
  [opengraph.xyz](https://www.opengraph.xyz), the
  [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/), the
  [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/), a Slack message and Messages.

## Development tools (dev builds only)

- **Scenarios:** `?scenario=aqueduct` (also `start`, `ruins`, `ruins3d`, `chamber`, `stair`, `plateau`,
  `aqueduct3d`, `aqueductView`, `seal`, `summit`) starts in a fixed state without touching your save. Add
  `&era=0..5`, `&mode=2d|3d`, `&freeze=1`.
- **Debug overlay:** the backquote key. Generation, position, velocity, ground, shift eligibility and the exact
  reason it's blocked, camera obstruction, fps, draw calls; layers for collision boxes, camera rays, the route
  graph and more.
- **GPU timing:** `await window.__perf(3)` in the console.

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

`npm test` runs 114 tests: a full bot playthrough, a resume matrix, fuzz, Halo Path rules, valley height-field
collision across the whole level (no puzzle can be walked round), readability, the 8-bit palette and tile limits,
the 3D camera across the whole level, shift feedback, and traversal (every jump checked against Pip's measured
jump; see **docs/TRAVERSAL.md**). `npm run test:e2e` runs the browser tests. See **QA.md** and **docs/AUDIT.md**.
