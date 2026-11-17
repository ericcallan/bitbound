# Traversal: what Pip can do, and how the level is checked against it

Everything here is measured by running the real `PlayerController` (`src/game/level/traversal.ts`,
`measurePip()`), not read from constants. `npm test` re-measures it and re-checks the level every run
(`src/test/traversal.test.ts`), so a change to the controller or the level that breaks a jump fails the build.

## Pip, measured

| Quantity | Value |
|---|---|
| Collision box | 0.6 wide × 0.9 tall (centre of the feet is his position) |
| Top running speed | 7.60 units/s, 90% reached in 0.10 s |
| Tapped jump height | 0.68 |
| Held jump height | 2.48 |
| Air time (held jump, back to takeoff height) | 0.63 s |
| Air control | can turn a held jump round: 2.12 units back from its furthest point |
| Abilities | jump (variable height), Dimension Shift (2D ⇄ 3D), Regress (bubble of an older generation), push (cube, lamp) |

Largest gap a running, held jump clears, edge to edge, by height difference (landing higher is positive):

| Height difference | −4 | −2 | −1 | 0 | +1 | +2 | +2.5 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Gap cleared | 6.74 | 6.10 | 5.79 | 5.34 | 4.90 | 4.20 | none |

## The route graph

`laneSegments()` turns every collider on the 2D lane into standable surfaces (split where a solid wall stands
across the lane; walls with a generation mask are passable because Regress can switch them off; moving platforms
count as the span they sweep). `laneEdges()` connects two surfaces when Pip can walk, drop or jump between them
within the measured envelope. The graph is built from the level with every puzzle solved and every ability unlocked.

Checks (all automated):

| Check | How |
|---|---|
| The goal is reachable from the spawn | widest-path search (the route whose tightest jump has the most room) |
| Every jump on that route has room to spare | at least 0.35 units beyond the measured reach; the tightest today is 2.74 |
| No softlocks | from every surface the spawn reaches, the goal is still reachable |
| Checkpoints are safe | each stands on ground, is free, has 0.4 headroom, is on the route and has the goal ahead |
| Every bit on the lane can be collected | the measured jump arc off a reachable surface passes within the pickup radius |
| 3D-only secrets can be collected | simulated with the real input path: in front of the Stalled Gate, behind the far bridgehead, the lamp alcove (the hidden chamber is covered in `valley.test.ts`) |
| Gates can't be walked round in 3D | `valley.test.ts` (a rock spur behind every gate, its side wall in front, the plateau, the light fence, the brambles, the Stalled Gate) |
| The Update Wave can't be skipped | `chapter6.test.ts`: the span (7) is wider than the longest jump (5.34), exists only inside the wave, and Rollback is refused over the canyon |
| The camera can always see Pip | `camera.test.ts`: ~1000 spots and orbits across the level |
| Shifting is safe | `shiftFeedback.test.ts`, `qa.test.ts` (fuzz over 16 seeds, resume from every checkpoint) |

The safest route (jumps only):

| From → to | Gap | Rise | Spare |
|---|---:|---:|---:|
| step2 → g2 (first pit) | 3.00 | −1.00 | 2.79 |
| g3 → mover1 → g4 | 0.50 | 0 | 4.84 |
| g4 → bridge → g5 | 1.00 | 0 | 4.34 |
| Painted Stair steps | 0.25 | +1.10 | 4.59 |
| stair6 → plateau | 1.80 | +1.30 | 2.91 |
| p2 → p3 | 2.60 | 0 | 2.74 |
| p5 → reliefs (×3) | 2.20 | +0.60 | 2.89 |

Expert shortcuts the graph finds (allowed; none skips a story beat):

| Shortcut | Spare | Effect |
|---|---:|---|
| p1 → p2, clearing the plateau pit without the moving platform | 0.34 | saves a few seconds |
| relief1 → p6, skipping the last carved handhold | 0.23 | saves one jump |
| stair5 → plateau, skipping a step | 0.55 | none |

## Bugs this found

- **The far aqueduct half's secret (c7) was unreachable.** The seal-door ridge sealed off its bank entirely; every
  simulated attempt fell into the canyon. (Since then the aqueduct runs in line with the path and the cut is gone;
  the secrets moved to the meadow in front of the Stalled Gate and behind the far bridgehead.)
