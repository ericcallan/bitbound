# Graphics report — Phase 5 vertical slice

Scope: the opening valley (start to the Shard ruins, x ≤ 52) as a full 3D world; Blender-built assets; real
sky lighting; a true 1985-style 8-bit tile renderer. Everything below was built and checked in this pass. All
numbers are measured unless marked otherwise.

## Tooling

| Tool | Use |
|---|---|
| Blender 5.3 (headless, `-b -P`) | Modelling, rigging, keyframed animation, Cycles baking (colour, roughness, normal, metalness, AO), glTF export. Every asset is a script in `scripts/blender/`, and its `.blend` source is kept in `assets/blender/`. |
| glTF Transform 4.5 + meshoptimizer + sharp | Dedup, prune, weld, quantise, Meshopt geometry compression, WebP textures (`scripts/optimize-assets.mjs`) |
| `scripts/validate-assets.mjs` | Scale, origin, up axis, names, material counts, triangle and size budgets, animations present |
| Poly Haven (CC0) | Scanned materials and the sky HDRI; see `docs/ASSETS.md` |

Not used: Blender MCP (scripts are repeatable and reviewable; a live MCP channel adds nothing), paid tools
(Substance), WebGPU (every custom shader would need rewriting).

## What changed

**Final-generation Pip** (`pip.glb`, Modern HD and Beyond): about 30 modelled parts with bevels and panel
seams; a 2K painted atlas with baked wear plus a metal map; an 18-bone rig; 11 keyframed actions (idle, walk,
run, jump start, jump up, fall, land, brake, celebrate, surprise, shift). In game, `pip/PipGLB.ts` crossfades the
clips and layers procedural motion on top: an antenna spring and head look. The face is still the live canvas
display behind the faceplate, so every expression works. Early 3D and Stylized keep the procedural rig, so the
step up is visible.

**One immersive valley** (Early 3D and up):
- A continuous terrain from one height function (`level/valley.ts`). Gameplay uses the same function: walking off
  the path, sheer cliffs, two gorges with a river, drowning.
- The old floating boxes, backdrop hills and deep floor are hidden per pixel inside the valley.
- The terrain shader is a four-layer scanned splat (grass, rock, path, forest), height-blended, anti-tiled and
  triplanar on cliffs.
- Set dressing, instanced:
  - 80 meadow trees and 1 Great Tree: skin-modifier trunks with baked scanned bark, about 700 and 1,800 foliage
    cards;
  - 7,073 grass clumps, 374 tall tufts, 767 flowers, 338 ferns, 22 rocks.
- Ancient stone (archway, column, collider-exact blocks) baked from scanned masonry with moss.
- Wind on leaves, bark and ground cover; ground cover parts around Pip.

**Lighting and atmosphere** (Modern HD and Beyond):
- The Kloofendal HDRI drives image-based lighting and the visible sky.
- The key light, its shadows and Beyond's light shafts aim at the sun position measured from the HDRI (47.9°
  elevation).
- Low ambient fill gives cool, sky-lit shadows. Haze is cooler and nearer.
- Pollen drifts in Modern HD, light motes in Beyond. Foliage is matte, and the river is deep green water.

**True 8-bit** (2D only):
- `render/retro/RetroLayer.ts` draws every 8-bit solid into a world-anchored canvas at 16 px per world unit, using
  one 16×16 ground block in exactly three colours, plus plain outlined clouds.
- The composite samples it one 8-bit pixel at a time. The camera frames about 240 rows at a whole-number screen
  scale and sits on whole pixels.
- Pip is a 16×16, three-colour sprite with idle, two walk frames and a jump frame. There is no background scenery.
- The generation of empty sky is the lane's, so an era ripple sweeps from tiles into the next generation in
  place.

**Showcase:** Art & Design → Environment shows any view in any generation from the same camera. The new
"Opening Valley (3D)" view shows the immersive slice.

## Measurements

Machine: Apple M4 Pro, 24 GB, Chrome, 120 Hz display. Drawing buffer 2259×1065 (DPR 2), quality **High**
(tier 2, full resolution). GPU time comes from `EXT_disjoint_timer_query_webgl2` around the whole frame (scene,
shadows and post). Frame time is vsync-locked at 8.33 ms whenever GPU time is under it. Each sample is 4–5 s,
mean / p95.

| Scene | GPU ms | Frame ms | CPU submit ms | Draw calls | Triangles |
|---|---:|---:|---:|---:|---:|
| 8-bit, 2D (start) | 1.52 / 3.05 | 8.33 / 9.3 | 1.32 | 198 | 8 k |
| 16-bit, 2D | 1.54 / 2.02 | 8.33 / 8.9 | 1.58 | 344 | 41 k |
| Early 3D, 2D | 3.06 / 3.53 | 8.34 / 9.3 | 1.70 | 260 | 210 k |
| Modern HD, 2D | 5.54 / 6.64 | 8.34 / 9.3 | 1.94 | 324 | 4.08 M |
| Modern HD, 3D chase camera | 9.79 / 11.21 | 10.76 / 16.7 | 3.75 | 1,196 | 5.80 M |
| Beyond, 3D chase camera | 13.31 / 14.36 | 13.11 / 16.8 | 3.95 | 1,207 | 5.88 M |
| Beyond, 3D valley overview | 15.41 / 17.33 | 13.30 / 17.1 | 2.19 | 381 | 5.44 M |

Fixed in this pass: before skipping the terrain and Blender dressing when no 3D or modern generation can be on
screen, 8-bit drew **4.85 M** triangles (discarded per pixel). It now draws 8 k.

Load time: on localhost with a warm cache every asset finished within 0.35 s of navigation. That says
nothing about real network loading and **was not measured** on a cold or throttled connection. Shipped
assets total 11.5 MB (`docs/ASSETS.md`).

Production bundle: 1.49 MB JS (427 KB gzipped), one chunk.

## Critical assessment: what still falls short

- **Beyond is at the edge of 60 fps on High** at this resolution: the valley overview's p95 GPU time is 17.3 ms.
  There's about 5.5 M triangles, mostly instanced grass and foliage cards, each drawn twice (once for shadows),
  and no distance LOD. Auto quality will drop a tier, but the real fix is a grass/foliage LOD or impostors.
  Not done.
- **The immersive world stops at x ≈ 52.** Beyond that the old box world and backdrop remain, with a visible
  change of style. Rollout is the next milestone, as planned.
- **Early 3D and Stylized** use the same scanned terrain textures as the modern generations, with era shading
  on top. They are one world, but the terrain isn't truly low-poly or toon. Planned toon/low-poly terrain
  variants were not built.
- **Cartoon props remain in the modern valley:** bloomer flowers, mushrooms, enemy and pickup models are still
  the old procedural meshes beside scanned assets.
- **The 8-bit HUD is a DOM overlay in a pixel font**, not drawn into the pixel canvas.
- **8-bit frame height** is about 240 rows but varies with window height (266 in the measured window, and up to
  roughly 190–320 on small windows), because the scale is kept a whole number of screen pixels.
- **In 8-bit, non-ground objects** (the awakening machine, sign, enemies, pickups) are the 3D meshes snapped to
  the 8-bit grid and palette, not hand-drawn sprites. They read as sprites but are not authored as such.
- **16-bit was not rebuilt** as a tile renderer. It is still the previous pixel-filter treatment (posterised,
  with parallax from the real 3D backdrop).
- **Animation is keyframed by script**, not hand-animated or motion-captured.
- **No dark interiors yet.** The hidden chamber (x = 57) is outside the slice and keeps its old lighting.
- KTX2 textures were not used (KTX-Software was unavailable). WebP was used instead.
