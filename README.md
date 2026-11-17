# PIP — Beyond the Frame

A playable browser game about a small robot restoring a forgotten world one graphical generation at a time.
Each of the **six generations** (8-bit, 16-bit, Early 3D, Stylized, Modern HD, Beyond) is a chapter, and also a
puzzle tool. The same world **shifts between a 2D side-scroller and full 3D**.

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # 83 simulation tests, including a bot that plays new game → ending
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

- **8-bit is a real tile renderer** (2D only): 16×16 tiles, one 3-colour ground block, a flat sky and plain
  clouds, about 240 rows at a whole-number pixel scale, and a 3-colour 16×16 Pip sprite (`render/retro/`).
- **The opening valley is one 3D world** from Early 3D up: continuous terrain, cliffs, a river gorge, forest and
  meadow you can walk anywhere in.
- **Blender-built assets** (`scripts/blender/`, sources in `assets/blender/`): the final-generation Pip with an
  18-bone rig and 11 animations, trees, ground cover, rocks, ancient stone and the terrain. They are baked from
  CC0 scanned materials and optimised with glTF Transform.
- **Modern HD and Beyond** are lit by a real HDRI sky with its measured sun direction.

See **docs/GRAPHICS_REPORT.md** for measurements and shortcomings, and **docs/ASSETS.md** for sources and
licences. In-game: Art & Design → Environment compares any view across all six generations.

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
              eraMaterial.ts (per-pixel generation rules), retro/ (8-bit tiles), post/ (composite)
  pip/        PipModel.ts (classic rig), PipGLB.ts (Blender Pip), face.ts
scripts/      blender/*.py, optimize-assets.mjs, validate-assets.mjs, build-assets.mjs, fetch_polyhaven.py
src/test/     Vitest suites + a bot that plays the whole game through the real input path
```

## Verification

`npm test` runs 83 tests: a full bot playthrough, a resume matrix, fuzz, Halo Path rules, valley height-field
collision, and the 8-bit palette and tile limits. See **QA.md** for the browser pass.
