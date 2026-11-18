# Bitbound: story, chapters and regions

**Status:** Phase 0 draft for approval (2026-11-18). This describes the target. Each chapter page states what
exists today (positions from `src/game/level/meadows.ts` and the triggers in `src/game/sim/Game.ts`) and what is new.

Companion: `docs/ART_BIBLE.md`.

---

## 1. The story in one paragraph

The valley is a world that updates itself one graphics generation at a time, each time the World Wheel on Mount
Halo turns. Long ago it was whole and extraordinary. Couriers carried the updates up the mountain and installed each
new version **over** the last, and the world began to tear, because the old versions are what the new ones stand
on. The Keeper, the old intelligence that tends the wheel, stopped it: it rolled everything back to 1.0 (the Great
Fold) and put every later courier to sleep. Pip, a forgotten courier and maintenance robot, wakes. He carries the
updates again, learns along the way that every old version is load-bearing, and at the wheel installs all six
**side by side** instead of the newest on top. The world becomes whole without erasing its past.

## 2. Canon

| Element | What it is |
|---|---|
| **The World Wheel** | The mechanism the brief calls the Frame Engine. Six segments, one per generation. |
| **The Keeper** | The voice of the patch notes. Not evil: it chose a small, safe world over a torn one. It speaks as itself three times only. |
| **The Great Fold** | The deliberate rollback to 1.0. Rollback, Pip's ability, is the Keeper's own tool, handed to him at the beacon as a warning. |
| **The earlier couriers** | Asleep in the Hidden Chamber. The Stalled Gate (stuck on 2.0) and the half-updated aqueduct mark where two were stopped. |
| **Pip** | Curious, clumsy, determined, easily distracted. Notices each time he is redrawn. |
| **Sprig** | A purple flower who half remembers the world being bigger. Comic relief and heart: the world is worth restoring for who lives in it. |
| **Stitchlings** | The Keeper's menders. Small machines that patch the world back to how it was: they rebuild obstacles, re-break repairs, re-fold what Pip unfolds. Playful, not evil. |
| **Lost Bits, Core Bits, Memory Echoes** | Lost Bits are today's Bits (65 placed). Core Bits are the shard, the Dimension Core and the beacon. Memory Echoes are optional, later. |
| **Framebreak** | The 2D/3D shift, as named on screen. The code keeps `shift`. |

**Why the earlier couriers failed:** each installed the newest version over the old ones, and the world tore. The
Keeper stopped them before the wheel.

**Why Pip succeeds:** his whole journey depends on old versions. He passes a light fence that 8-bit never drew,
brambles that are only scenery in 16-bit, handholds that hold only in ink, a bridge that exists only in Early 3D.
He arrives knowing the old versions hold the world up, and installs all six side by side. The stele's instruction,
"TURN ME GENTLY", meant exactly that.

## 3. Three acts

| Act | Chapters | What Pip learns | Told through |
|---|---|---|---|
| **I · Discovery** | 1–3 | The world has lost detail, and has a hidden dimension | The world changing around him; the first Framebreak; finding the sleeping couriers |
| **II · Truth** | 4–5 | The loss was deliberate: the Keeper folded the world to save it and stopped the couriers | A staircase folded into a painting; Rollback handed over as a warning; the Living Atlas and its archive |
| **III · Resolution** | 6 | Old and new can stand together | Every puzzle on the Halo Path; the six plates; the wheel; the meadow tree in all six generations at the end |

The Keeper speaks as itself three times:
- at the first Framebreak: "Some things were folded away for a reason.";
- in the archive;
- at the wheel, objecting, then changing its mind as the six plates light.

---

## 4. Where the chapters are today

The chapter shown on the HUD follows the generation the world is in (`objective()` in `Game.ts`), so each chapter
runs from one upgrade to the next:

| Chapter | Generation | From → to (x) | Length | Contents today |
|---|---|---|---|---|
| 1 | 8-bit | start → shard pedestal (−8 → 33) | 41 | Awakening, steps, holes, floating ledge, shard |
| 2 | 16-bit | shard → Dimension Core (33 → 59) | 26 | A short run and a pit |
| 3 | Early 3D | Core → the plate inside the chamber (59, then back to 58.2 in depth) | **none along the path**: only the chamber | Hidden Chamber, the lamp and plate |
| 4 | Stylized | plate → beacon (59 → 80) | **21** | Crossing the repaired bridge, a walk to the beacon |
| 5 | Modern HD | beacon → Frame Gate (80 → 142) | 62 | **The Painted Stair** (100–112), the plateau, the first light fence |
| 6 | Beyond | Frame Gate → wheel (142 → 254) | 112 | Light fence, brambles, handholds, Stalled Gate, Update Wave, World Wheel |

**Two structural problems:**
- **Chapters 3 and 4 barely exist as places.** Early 3D lasts only while solving the chamber; Stylized is a walk.
- **The Painted Stair, a painting folded flat, belongs to Ink and Folded Fields but plays in Modern HD.** The
  beacon that brings Modern HD comes before it.

**Proposed fix (Phase 4, cheap, keeps saves valid):**
- **Ink arrives on the far bank** (x 72) instead of at the plate, so Early 3D covers the chamber, the puzzle and
  the crossing of the bridge it repairs.
- **The beacon moves to the top of the Painted Stair** (about x 113, the plateau's foot), so Stylized covers the
  walk and the stair.
- **Modern HD then covers the plateau.** Rollback still arrives before the fence at 117.6.
- The save flags keep their meaning; only trigger positions move.

---

## 5. The six chapters

Each page shows the target, then what exists today and what is new.

### Chapter 1 · Pixel Meadow · 8-bit · Act I

- **Identity:** an open green meadow under a flat blue sky, as it looked in 1985.
- **Landmarks:** the maintenance hut where Pip wakes; the Great Tree; the lone meadow tree on the rise, seen again
  in the ending.
- **Objective:** find what is humming. **Mechanics:** run, jump, hidden blocks.
- **Challenge:** a run of pits and the floating ledge up to the shard ruins.
- **Secrets:** the bush hiding three Bits (today); a hidden block above the hut (new).
- **Conclusion:** Pip lifts the shard; the 8-bit world flickers with details it shouldn't have (a coloured leaf,
  a distant mountain), then colour floods in.
- **Story:** Pip wakes, says "I'M SQUARE", and meets Sprig, who is sure something is missing.
- **Today:** the complete route.
- **New:** the hut, Sprig, the flicker before colour, the meadow tree as a landmark.

```
 hut   Great Tree        pits       ledge        shard ruins
 [■]      ♣    __    __  _  _  __   ▭▭      ┌┐ ◇ ┌┐
──────────────┘  └──┘  └┘ └┘  └───────────────────────
```

### Chapter 2 · Painted Woods · 16-bit · Act I

- **Identity:** a dense, layered forest; a waterfall; the river Sprig remembers.
- **Landmark:** the waterfall gorge. **Objective:** follow the hum through the woods.
- **Mechanic:** layers. 16-bit draws a foreground and a background, and Pip walks behind trunks and foliage to
  find routes. This is the same rule the brambles use in chapter 6, taught here first.
- **Challenge:** a walk-behind maze of trunks, plus a waterfall crossing on logs.
- **Secrets:** Bits hidden behind foreground leaves; a speck in the sky (today: the dead pixel).
- **Conclusion:** the overgrown gateway, behind the scenery, and the Dimension Core beyond it.
- **Story:** the Keeper's emblem is first seen carved on the gateway.
- **Today:** a short run and a pit (26 units).
- **New:** the forest section, the waterfall, walk-behind layering.

### Chapter 3 · Hollow Arches · Early 3D · Act I

- **Identity:** ivory arches over a gorge, the first architecture.
- **Landmark:** the broken bridge between two arches. **Objective:** cross the gorge.
- **Mechanic:** Framebreak.
- **Challenge:** the Broken Passage: find the chamber behind the facade in 3D, carry the lamp, repair the bridge,
  cross.
- **Secrets:** behind the facade, the lamp alcove (today).
- **Conclusion:** in the Hidden Chamber, Pip finds the sleeping couriers. "...they look like me." "Mine will."
- **Story:** the camera swings behind Pip for the first time. He looks at the camera, takes a few unsure steps,
  looks back and trips. The Keeper's first line.
- **Today:** complete.
- **New:** the arches as architecture, a larger chamber, the staged first Framebreak, the Keeper's line.

### Chapter 4 · Folded Fields · Stylized · Act II

- **Identity:** terraced fields where real things lie folded flat, as paintings on walls and the ground.
- **Landmark:** the Painted Stair wall. **Objective:** climb to the beacon.
- **Mechanic:** flattening. In 2D, a painting of a thing is the thing.
- **Challenges:** the Painted Stair (today), plus two new folded objects: a painted bridge on the ground that
  works only when seen flat, and a folded windmill whose sails become platforms.
- **Secrets:** the lamp alcove in front of the mural (today), and a painting of a door that opens.
- **Conclusion:** Pip lights the beacon. The Keeper hands over Rollback as a warning: "Old versions are never
  deleted. They're kept underneath."
- **Story:** Pip realises the folding was done on purpose.
- **Today:** one puzzle, and it plays in Modern HD.
- **New:** the moved chapter boundaries, two puzzles, the terraces.

### Chapter 5 · Living Atlas · Modern HD · Act II

- **Identity:** a high plateau observatory with a great relief map of the whole world, its rivers running.
- **Landmark:** the Atlas. **Objective:** learn why the world was folded.
- **Mechanic:** the Rollback bubble.
- **Challenges:** the light fence (today); then the Atlas room. Rolling parts of the map back to old versions
  opens routes on the real plateau.
- **Secrets:** under the Atlas table; on the plateau's ledges (today's platforms).
- **Conclusion:** the archive. The Keeper shows the tear and the Fold, without a long speech. At the Frame Gate,
  Pip sees every version of himself in his reflection.
- **Today:** plateau platforming, one fence, the gate.
- **New:** the Atlas room, the archive, a second Rollback puzzle.

### Chapter 6 · Heart of the Frame · Beyond · Act III

- **Identity:** Mount Halo at golden hour: the path, the canyon, the wheel.
- **Landmark:** the World Wheel. **Objective:** turn the wheel without tearing the world.
- **Mechanic:** every generation as a tool.
- **Challenges (all built today):** a light fence; brambles; the handholds; the Stalled Gate; the Update Wave; the
  six plates.
- **Secrets:** the secrets in front of the Stalled Gate and behind the far bridgehead (today).
- **Conclusion:** the wheel turns. The Keeper changes its mind. Pip returns to Pixel Meadow, where the meadow tree
  passes through all six generations. Sprig gets the last line. Post-game exploring in any generation (today).
- **Today:** complete.
- **New:** the Keeper at the wheel, the epilogue in the meadow.

---

## 6. Region map

```
                                                   ⟶ [6 Heart of the Frame] ── the wheel
                                                  /        Halo Path, canyon
                                [5 Living Atlas] ─┘
                               /   plateau, Atlas, archive
             [4 Folded Fields] ┘
            /   terraces, Painted Stair, beacon
[1 Pixel Meadow] ── [2 Painted Woods] ── [3 Hollow Arches]
  hut, Great Tree      forest, waterfall      gorge, bridge
       ↑                                           │ (in depth)
       │                                    [Hidden Chamber] ···· later: an under-valley hall to the Heart
       └──────────────── epilogue: Pip returns ──────────────┘
```

- **The spine** is today's valley, west to east and uphill. It stays the critical path.
- **New areas** attach to the spine one at a time: through depth (Framebreak), behind layers (16-bit), or through
  gates.
- **Return routes** open late: the under-valley hall from the chamber, and side routes that need Rollback.

---

## 7. Expansion plan, and what it depends on

**Prerequisite: areas off the spine.** Today the whole game is one level in one coordinate space; every position,
test and baseline uses those coordinates. Growing a region in place would shift everything after it. So the first
expansion step is engineering, not art: a way to enter a separate area (a door, a hole, a Framebreak spot) and come
back, with its own colliders, art cells and camera bounds, sharing the save. With that, regions grow without
touching the spine's coordinates. Risk: moderate. Collision, the camera, the retro renderers, saves and the bot
all assume one level.

**Order** (fewest existing assets first, then by story need):
1. Folded Fields: the moved boundaries, then the two new folded puzzles.
2. Living Atlas: the Atlas room and archive, as the first separate area.
3. Painted Woods: the forest section, as a separate area entered from the 16-bit run.
4. Hollow Arches: the larger chamber.
5. The epilogue.
6. Later: the under-valley hall, Megatower (stuck on 2.0) and the Streets Below (3.0), as on today's world map.

Each step leaves the game complete and playable.

---

## 8. Roadmap

| Phase | Deliverables | Accepted when |
|---|---|---|
| **0 · Foundations** (this) | This document, `ART_BIBLE.md`, reference sheets, the baseline benchmark | You approve the documents |
| **1 · Benchmark** | The shard ruins restyled in all six generations with art kit v1 (meadow tree, stepped rock, ground, ivory stone, pedestal, Bit); before/after sheet; change list | You approve the look. The silhouette and palette checks pass. All tests pass |
| **2 · Valley restyled** | Kit across the whole valley; terrain reshaped off the path; authored sprites for every 8-bit and 16-bit object; Stitchling and Sprig art | No scanned colour texture ships. Six-generation sheets for six places. Route, camera and readability tests pass. Budgets measured |
| **3 · Opening and first Framebreak** | The hut wake-up; the 8-bit flicker before colour; the staged first Framebreak; the Keeper's first line; Sprig introduced | Chapters 1–3 play through; bot playthrough passes; old saves load |
| **4 · Chapter identity** | Moved chapter boundaries; each chapter's landmark, palette shift and conclusion; chapter cards; regions on the map | Each chapter is identifiable from one screenshot |
| **5 · Separate areas, first new region** | Area support; Living Atlas room and archive; Folded Fields puzzles | Bot completes the new areas; leaving and returning works; saves compatible |
| **6 · Modern HD and Beyond deep pass** | Light, water, foliage, life, Pip's secondary motion | Before/after sheets; GPU time measured within budget |
| **7 · Remaining regions and story** | Painted Woods, the larger chamber, the Keeper at the wheel, the epilogue, Stitchling behaviours, Memory Echoes | Three acts playable end to end |
| **8 · Interface, sound, polish** | Calmer UI per generation, journal, a theme arrangement per generation, the finale medley | Full playthrough; known limits documented |

## 9. Risks

- **Scripted art has a ceiling.** Phase 1 tests it on one scene before anything else depends on it.
- **"Animated film" is a direction, not a test.** Acceptance is your approval of sheets.
- **Music is synthesized in code.** Orchestral recordings would need licensed or commissioned audio.
- **Beyond is near its GPU budget.** New detail must replace cost, not add to it.
- **Every restyle invalidates the stored browser baselines.** They are refreshed once per phase, in one run, when
  you say so.
- **Your machine:** no browser suites. Single pages, closed straight after, at low priority.
