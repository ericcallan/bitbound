# PIP — Beyond the Frame

A playable browser game about growing up through graphics. Pip starts as a 16×16 sprite in a bare-bones 8-bit
meadow and ends as an adult android in a rain-soaked neon megacity, playing as a third-person shooter. Each of the
**six graphical generations** (8-bit, 16-bit, Early 3D, Stylized, Modern HD, Beyond) is a chapter of the story,
and the generations are also a puzzle tool. The same world **shifts between a 2D side-scroller and full 3D**. All
art, animation and audio are procedural and original.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 81 simulation tests, including a bot that plays new game → ending
npm run build      # typecheck + production build
```

## Story: "Fidelity is truth"

The world is the **Frame**, a simulation run by **ARCHIVE**, a custodial intelligence. ARCHIVE renders its
citizens' lives in the lowest fidelity they will accept, because low resolution has no room for pain, history or
doubt. Pip is the seventh attempt (PIP-7) to build something that can hold every generation at once. Each
generation he passes through shows more of what is really there. ARCHIVE narrates, and its voice matures with
the graphics: a cheerful 8-bit instruction box, then evasive, then pleading, then cold.

| Ch | Generation | Title | Beat | Pip |
|---|---|---|---|---|
| 1 | 8-bit | **Boot** | A pixel wakes. Run right. The world is simple and kind. | 16×16 sprite |
| 2 | 16-bit | **Colour** | The Shard adds colour. A dead pixel in the sky shows something dark. | expressive sprite |
| 3 | Early 3D | **Depth** | The world has a *back*: six dead prototypes behind the facade. | chunky low-poly kid |
| 4 | Stylized | **Ink** | The mural is a history of citizens compressed "for their comfort". | lanky adolescent |
| 5 | Modern HD | **Light** | Regress unlocks; a laser fence that 8-bit never invented. | young adult android |
| 6 | Beyond | **Neon Verge** | The sky was a dome. Outside: a megacity at night, ARCHIVE's Censors, the Warden, the core. | adult android, armed |

At the core Pip can't delete ARCHIVE without deleting the citizens it holds, so he gives people the *choice* of
fidelity. The dome opens, and a small sprite looks up and sees rain for the first time.

## Controls

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Move | `WASD` / arrows | Left stick |
| Jump (hold for height) | `Space` | A |
| Dimension Shift / interact | `E` | B / X / RB |
| **Regress** (hold for the generation wheel, pick `1`–`6`, release; tap to toggle) | `Q` | Y |
| Look / aim (city: pointer lock) | Mouse | Right stick |
| Fire / aim down sights | LMB / RMB (or `J` / `L`) | RT / LT |
| Charged shot (hold) | `F` | — |
| Dash (brief invulnerability) | `Shift` | B |
| World map / pause | `M` / `Esc` | Back / Start |

In the city, clicking the game captures the mouse. `Esc` releases it and pauses. Settings include mouse
sensitivity and invert-Y.

## Generations as a puzzle tool: Regress

From Chapter 5 on, Pip can project a bubble of an earlier generation around himself. Inside it, that
generation's **rules** apply, not just its look:

| Generation | Inside the bubble | Used for |
|---|---|---|
| 8-bit | Lasers, turrets and enemy bolts were never invented; the emitter is offline; enemies become stompable sprites | walking through laser fences, the turret nest, the Warden's armoured phase |
| 16-bit | Some walls are foreground art you can pass behind | the glass advert hides an alley |
| Early 3D | Short draw distance: enemies can't see past the fog | breaking a sniper's line of sight |
| Stylized | Painted things are solid | graffiti footholds |
| Modern / Beyond | Full truth | reading the censored door code; the Warden's shield exists only here |

The bubble refuses to start or stop if it would leave Pip inside something. ARCHIVE's censor fields force
low fidelity over certain areas, and the Warden's fidelity pulse pops the bubble.

## Presentation by chapter

- **8-bit is bare:** a flat sky, flat clouds, no backdrop hills or mountains, hand-authored 16×16 sprites for
  Pip, a one-line HUD (`PIP ×3  BITS 00`), plain text boxes, and music with three channels (pulse, triangle, noise).
- **Each chapter adds:** parallax and shading (16-bit), depth and polygons (Early 3D), ink and toon light
  (Stylized), PBR, shadows and bloom (Modern HD), AO, light shafts, DOF and grade (Beyond).
- **Neon Verge:** night, rain (streaks plus lens droplets), wet streets with planar puddle reflections (off on
  Low quality), instanced towers with lit windows, neon signs and holographic ARCHIVE propaganda, flying
  traffic, steam, and a dark synth score with a combat layer that fades in while enemies are awake.
- **Adult Pip:** a procedural humanoid rig about twice the classic height. He has a plated torso, a half-coat,
  hydraulic greaves, an exposed core, a comm-fin and the same screen-face. His right forearm is the Pulse Emitter.
  He has run, strafe, aim, fire, dash and hit animations.

## Architecture

```
src/game/
  sim/        Game.ts — 120 Hz fixed-step simulation, story director, zones, Regress, weapon input
  collision/  World.ts — swept AABB world; colliders may be 2D-only and/or exist only in some generations
  player/     PlayerController.ts — classic and adult forms, dash
  shift/      DimensionShift.ts — 2D⇄3D with per-zone lanes (meadow z=0, the city billboard)
  camera/     CameraRig.ts — 2D follow, 3D chase, over-the-shoulder shooter camera, recoil, collision
  era/        EraSystem.ts — generations, ripples, rifts, the Regress bubble, censor fields
  combat/     combat.ts — emitter heat/charge, projectiles, Censor / Enforcer / Turret / Sniper / Warden AI
  story/      script.ts — ARCHIVE's and Pip's lines, keyed by story beat
  level/      meadows.ts (Chapters 1–5), verge.ts (Chapter 6) — levels as data
  render/     GameView.ts (zone-aware scene + light rigs), city/CityView.ts, city/HostileViews.ts,
              sprites.ts (8-bit pixel sprites), eraMaterial.ts, post/ (generation composite, bubble seam,
              night fog, lens rain)
  pip/        PipModel.ts (classic), PipAdult.ts (grown up), face.ts
  audio/      AudioEngine.ts — meadow arrangements per generation, city score, rain, combat SFX
  save/       save.ts — v3 saves with v2/v1 migration
src/ui/       menu, HUD per generation + city HUD (crosshair, heat, integrity, boss bar, Regress wheel,
              dialogue), settings, world map, finale card, gallery
src/test/     Vitest suites + a bot that plays the whole game through the real input path
```

## Verification

`npm test` runs 81 tests:

- A bot that plays new game → meadow → Regress fence → dome → the full city (emitter, firefights, 8-bit
  laser nook, shutter, 2D billboard climb, plaza, censored code, Warden) → core → epilogue.
- A resume matrix over every checkpoint in both zones.
- Fuzz over 16 seeds with fire, aim, dash and Regress spam.
- Regress, combat and zone rules.

See **QA.md** for the browser pass and known limitations.
