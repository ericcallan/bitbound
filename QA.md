# QA report — PIP: Beyond the Frame (phase 3: "Growing Up")

Scope:
- the story ("Fidelity is truth")
- bare-bones 8-bit Chapter 1
- Regress (generation masks)
- Neon Verge (Chapter 6): adult Pip, the third-person shooter, the Warden, the core and the epilogue
- regression over Chapters 1–5

Build: `tsc --noEmit` clean, `vite build` clean.

## 1. Automated coverage (Vitest, headless simulation): 81 / 81 passing

| Suite | What it proves |
|---|---|
| controller / shift / puzzle (22) | Unchanged phase-2 physics, shift safety and puzzle rules |
| `playthrough.test.ts` (1) | A bot plays the whole game on one `Game` through the real input path. It covers new game, the meadow, the Regress fence, the dome, the city (emitter, roof fight, market, 8-bit laser nook, shutter, billboard climb in 2D, plaza, censored code, Warden) and the core. Every beat fires, generations arrive 1→2→3→4→5, and the epilogue is 8-bit. "Keep exploring" returns to the city in 3D. |
| `qa.test.ts`: resume matrix (14) | Continue from every checkpoint in both zones and finish |
| `qa.test.ts`: fuzz (16) | 16 seeds × 120 s of random movement, jump, shift, generation, fire, aim, dash, Regress and charge spam, starting in both zones. Asserts finite state, no interpenetration and no stuck shift, and that the game stays completable. |
| `qa.test.ts`: edge cases (11) | Phase-2 edge cases, plus migration now ending at v3 |
| `chapter6.test.ts` (17) | Regress rules: the fence, refusal when it would trap Pip, locked before the beacon, the Q wheel, the 16-bit advert, stylized graffiti, 8-bit turrets, lasers and bolt fizzle, the draw-distance rule, the full-fidelity code. Combat: heat and venting, Censor kills, emitter offline in 8-bit, Warden shield and armour, dash i-frames. Zones: dome → adult, the city lane flattens to its plane, v2 → v3 migration. |

## 2. Browser pass (Chrome, dev server)

| Area | Result |
|---|---|
| Chapter 1 from New Game: flat sky, flat clouds, sprite Pip, one-line HUD, no backdrop hills, mountains or islands | ✅ after fixes 3–4 |
| Title screen: the 8-bit band now has a flat sky | ✅ |
| Chapter 5 meadow: HUD shows the objective line and the Regress indicator | ✅ |
| Dome cinematic → white-out → adult Pip on the roof, with story line and objective | ✅ |
| City: neon, lit windows, rain, puddle reflections, holo adverts, fog | ✅ after fixes 1–2, 6 |
| Shooter: crosshair, firing, heat gauge, enemy fire, integrity cells, ARCHIVE dialogue | ✅ |
| 8-bit Regress bubble in the city: sprite Pip, dithered interior, glowing generation seam, "EMITTER OFFLINE" | ✅ |
| Warden: boss bar, shield (hex Fresnel), Regress hint, dialogue | ✅ after fix 8 |
| Console during all of the above | ✅ no errors |

## 3. Bugs found and fixed in this pass

| # | Severity | Bug | Fix |
|---|---|---|---|
| 1 | High | City windows rendered as TV static: hashed per pixel using the bump-mapped normal | Use the geometric normal |
| 2 | High | Same symptom after fix 1: quantising the normal with `floor(n·1.5+0.5)` landed exactly on a boundary at n = ±1 | Use `sign(n)·step(0.5, abs(n))` |
| 3 | High | **New Game was impossible once a save existed** (from phase 2): the confirm dialog sits inside `.menu`, which has `pointer-events: none` | `.overlay { pointer-events: auto }` |
| 4 | Medium | The 8-bit sky wasn't flat: the meadow sky is a sphere, so the "empty depth = sky" test never fired; hills, mountains, islands, cliff and deep floor also showed | Those objects now exist only in eras 1–5 |
| 5 | Medium | The plateau Regress fence drew as a plain blue slab | Laser beams between posts, shown only where the collider is active |
| 6 | Medium | The roof was a black void and Pip a silhouette | Rooftop wet-asphalt material, two extra roof lights, a soft fill light on Pip, brighter night ambient |
| 7 | Medium | Resuming at a later city checkpoint showed "Deal with the Censors" (roof enemies still count as alive) | That objective applies only while Pip is on the roof |
| 8 | Medium | The Warden wakes behind Pip while the camera faces the door panel and wall | The camera turns to face the Warden when it wakes |
| 9 | Low | Depth of field blurred adult Pip in the shoulder camera | City DOF reduced to a hint |

## 4. Decisions made without asking

- The dome crack is a white-out plus a cracked glass dome on the roof, not a crack painted across the sky.
- In 8-bit the emitter is offline and enemies become stompable sprites. Pip himself is drawn as a sprite.
- Esc in the city releases pointer lock and pauses (browsers swallow the Esc keydown while the pointer is locked).
- Inside a Regress bubble the music is low-pass filtered by generation.

## 5. Known limitations and residual risk

- **Not a full human playthrough in the browser.** The complete game is played headlessly by the bot. In Chrome I
  checked each chapter and every city system by loading saves and driving the game. Difficulty and feel
  (aiming, recoil, Warden fairness) need a human playtest.
- **Mouse pointer lock** behaviour was reasoned through and wired, but not exercised with real mouse movement in
  automation.
- **Audio was not judged by ear.** The city score, rain, combat SFX and 3-channel 8-bit score are new and unheard.
- **Quality tiers in the city** (Low turns reflections off) and frame rate in the city were not measured this pass.
- Gamepad untested (no device). Mobile and touch are not supported.
- The adult rig is procedural boxes and capsules: readable and on-model, not AAA.
- The gallery's character lineup still shows the classic Pip in all six bands; adult Pip does not appear there yet.
- Bundle is about 417 kB gzipped in one chunk.
