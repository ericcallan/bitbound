# Bitbound performance: hitches and loading

Measured with `node scripts/hitch-bench.mjs` against the dev server (dev scenarios are dev-only, so both runs use
dev builds: React's development mode and unminified code make CPU numbers somewhat worse than production). Real
GPU through ANGLE/Metal, headless Chromium, 1600×900 at device pixel ratio 2, a fresh profile per page, so every
first-time cost is included. Machine: the development Mac.

- **Worst frame / p99:** time between animation frames. 16.7 ms is 60 fps; over 33 ms is a visible hitch.
- **Long tasks:** main-thread blocks over 50 ms (the browser's own definition).
- **Programs compiled:** new shader programs during the step; each one can stall a frame.

## Summary (2026-11-17)

**Play is hitch-free.** Going the way a player does (title, loader, New Game), the first time into each of the six
generations, both shifts, the Regress bubble and a puzzle event: worst frame 32.6 ms, none over 33 ms, no long
task, nothing compiled. Before: the first switch into Modern HD compiled 29 shaders mid-play (77 ms worst frame,
4 long tasks), and from a cold start the Early 3D switch blocked for 139 ms.

| Moment | Before: longest block | After |
|---|---|---|
| First switch into Early 3D (cold) | 139 ms | none |
| First switch into Modern HD | 76–104 ms, 29 shaders compiled | none |
| Shift to 3D (cold) | 50 ms | none |
| Back from Art & Design to the title | 425–452 ms | none (worst frame 18 ms) |
| New Game | 303–324 ms | 82–84 ms, once, on the cut from title to game |
| Opening Art & Design | 193–212 ms | 118 ms (its own page and WebGL context) |

**Loading** now happens behind a loader that's on screen from the first paint (plain HTML in index.html), with real
progress, then a warm-up that compiles every shader for every generation and uploads every texture and model
(src/game/render/warmup.ts). The title appears finished: no pop-in. On localhost, from a cold dev server, that
takes about 8 s (3 s with the modules already served); the main cost is the 13 MB of models, textures and skies
on a real connection. The JavaScript is split: the game (353 KB, 119 KB gzipped), three.js and React in their own
long-cached file (1.3 MB, 366 KB gzipped), Art & Design on demand (13 KB).

**What made the difference**
- The warm-up behind the loader (programs are cached per WebGL context; the game reuses them).
- The view no longer deletes shared model geometry when the title closes, and post-processing programs survive from
  one view to the next.
- The game's canvas stays alive (paused) while Art & Design is open, instead of losing its WebGL context.
- The valley's 160,000-plant scatter is worked out once per page in 5 ms slices, with heights and instance
  matrices kept; views only copy it, and the title doesn't build one.
- The 8- and 16-bit tile images only redraw and re-upload when their generation can be on screen.
- The 16-bit sprite no longer re-uploads its sheet every frame; Pip's 8-bit sprite no longer forces a shader
  re-check on each frame change.
- The audio device opens behind the loader (it took ~110 ms on New Game).
- The sun's shadow map is skipped while only 8-bit, 16-bit or Early 3D can be on screen (they don't read it).
- Auto quality no longer re-creates every render target each time a ripple or bubble crosses into Modern HD.
- The music books notes 0.3 s ahead (was 0.12), so a busy frame never leaves a gap.

**Steady-state GPU didn't rise** (`__perf`, 5 s, headless Chromium on the real GPU, 2259×1065, Beyond, median of
three runs each, alternating old and new code; run-to-run spread is about ±1.5 ms):

| Scene | Before mean / p95 | After mean / p95 |
|---|---|---|
| Aqueduct, 2D | 6.89 / 7.77 ms | 6.43 / 6.87 ms |
| Aqueduct, 3D | 8.28 / 10.85 ms | 7.72 / 8.29 ms |
| Ruins overview, 3D | 11.86 / 13.17 ms | 12.42 / 13.31 ms |
| Hidden chamber | 11.42 / 13.04 ms | 11.6 / 12.0 ms |

**Tried and dropped (measured):** decoding images off the main thread (createImageBitmap, or decode() before
upload). The resulting textures cost up to twice the GPU time per frame in Beyond, so the standard loader stays.

**Not done:** higher resolution on the High tier (pixel ratio 2) doesn't fit the frame budget on this machine in
Beyond (it would roughly double fill cost), so it stays at 1.5. Textures already use 8x anisotropic filtering.
Building the game's view on New Game still takes ~60 ms (level geometry, decor, the aqueduct); it falls on the cut
from the title, where a dropped frame isn't seen. Two tiny depth shaders still compile late (a few ms each).

## Measurements

### Before: dev scenario path (no title) (2026-11-17 14:22)

| Page | Step | s | Worst frame ms | p99 ms | Frames >33 ms | Long tasks | Longest task ms | Programs compiled |
|---|---|---|---|---|---|---|---|---|
| / | (time to finished title, s) | 5.8 | | | | | | |
| / | boot | 0.3 | 178.5 | 178.5 | 3 | 1 | 54 | 0 |
| / | load to title | 5.4 | 265.6 | 241.4 | 7 | 6 | 246 | 49 |
| / | title: hover six generations | 9.9 | 143.1 | 17.9 | 2 | 0 | 0 | 2 |
| / | art & design | 4.2 | 201.3 | 47.1 | 3 | 2 | 193 | -11 |
| / | back to title | 4.1 | 427 | 391 | 2 | 2 | 425 | 11 |
| / | new game | 6 | 320.7 | 87.3 | 4 | 2 | 303 | 4 |
| /?scenario=ruins&era=0 | boot | 0.2 | 118.8 | 118.8 | 2 | 0 | 0 | 0 |
| /?scenario=ruins&era=0 | scenario load | 2.1 | 253.7 | 135.8 | 4 | 3 | 244 | 9 |
| /?scenario=ruins&era=0 | settle | 2 | 17.8 | 17.6 | 0 | 0 | 0 | 0 |
| /?scenario=ruins&era=0 | first switch to era 1 | 3.5 | 20.7 | 17.7 | 0 | 0 | 0 | 3 |
| /?scenario=ruins&era=0 | first switch to era 2 | 3.5 | 139.1 | 17.8 | 1 | 1 | 139 | 5 |
| /?scenario=ruins&era=0 | first switch to era 3 | 3.5 | 109.3 | 17.7 | 1 | 0 | 0 | 1 |
| /?scenario=ruins&era=0 | first switch to era 4 | 3.5 | 104.2 | 101.1 | 5 | 3 | 104 | 29 |
| /?scenario=ruins&era=0 | first switch to era 5 | 3.5 | 29 | 20.5 | 0 | 0 | 0 | 4 |
| /?scenario=ruins&era=0 | shift to 3D | 3.5 | 65.1 | 47.8 | 3 | 1 | 50 | 6 |
| /?scenario=ruins&era=0 | bubble 8-bit on | 3 | 17.7 | 17.5 | 0 | 0 | 0 | 0 |
| /?scenario=ruins&era=0 | bubble off | 2.5 | 17.8 | 17.6 | 0 | 0 | 0 | 0 |
| /?scenario=ruins&era=0 | shift to 2D | 3.5 | 17.7 | 17.5 | 0 | 0 | 0 | 0 |
| /?scenario=ruins&era=0 | puzzle event (seal opens) | 3 | 17.6 | 17.4 | 0 | 0 | 0 | 0 |
| /?scenario=ruins&era=0 | steady Beyond 2D | 5 | 16.9 | 16.9 | 0 | 0 | 0 | 0 |
### Before (title path) (2026-11-17 15:04)

| Page | Step | s | Worst frame ms | p99 ms | Frames >33 ms | Long tasks | Longest task ms | Programs compiled |
|---|---|---|---|---|---|---|---|---|
| / | (time to finished title, s) | 5.8 | | | | | | |
| / | boot | 0.3 | 172.7 | 172.7 | 2 | 0 | 0 | 0 |
| / | load to title | 5.5 | 372.6 | 267.6 | 5 | 6 | 314 | 49 |
| / | title: hover six generations | 9.9 | 44.4 | 17.8 | 1 | 0 | 0 | 2 |
| / | art & design | 4.3 | 218.7 | 47.6 | 3 | 2 | 212 | -11 |
| / | back to title | 4.1 | 453.7 | 422.6 | 2 | 2 | 452 | 11 |
| / | new game | 6 | 329.5 | 17.7 | 2 | 2 | 319 | 4 |
| / | boot | 0.2 | 127.2 | 127.2 | 2 | 0 | 0 | 0 |
| / | load to title | 0 | 17.7 | 17.7 | 0 | 0 | 0 | 0 |
| / | new game | 5.1 | 560.1 | 180.6 | 8 | 7 | 324 | 51 |
| / | to the ruins | 2.5 | 35.4 | 17.5 | 1 | 0 | 0 | 1 |
| / | first switch to era 1 | 3.5 | 21.8 | 17.2 | 0 | 0 | 0 | 2 |
| / | first switch to era 2 | 3.5 | 34.3 | 16.9 | 1 | 0 | 0 | 2 |
| / | first switch to era 3 | 3.5 | 17.1 | 17.1 | 0 | 0 | 0 | 1 |
| / | first switch to era 4 | 3.5 | 77.1 | 66.8 | 4 | 4 | 76 | 29 |
| / | first switch to era 5 | 3.5 | 28.4 | 16.9 | 0 | 0 | 0 | 4 |
| / | shift to 3D | 3.5 | 16.9 | 16.8 | 0 | 0 | 0 | 0 |
| / | bubble 8-bit on | 3 | 17.5 | 16.8 | 0 | 0 | 0 | 1 |
| / | bubble off | 2.5 | 16.8 | 16.8 | 0 | 0 | 0 | 0 |
| / | shift to 2D | 3.5 | 17.1 | 16.8 | 0 | 0 | 0 | 0 |
| / | puzzle event (seal opens) | 3 | 17.1 | 17 | 0 | 0 | 0 | 0 |
| / | steady Beyond 2D | 5 | 17 | 16.9 | 0 | 0 | 0 | 0 |


### After (title path) (2026-11-17 15:50)

| Page | Step | s | Worst frame ms | p99 ms | Frames >33 ms | Long tasks | Longest task ms | Programs compiled |
|---|---|---|---|---|---|---|---|---|
| / | (time to finished title, s) | 8.4 | | | | | | |
| / | boot | 0.2 | 45 | 45 | 1 | 0 | 0 | 0 |
| / | load to title | 8.2 | 849.7 | 98.4 | 11 | 7 | 837 | 251 |
| / | title: hover six generations | 9.9 | 42.8 | 17.7 | 1 | 0 | 0 | 0 |
| / | art & design | 4.1 | 118.5 | 41.3 | 3 | 1 | 118 | 0 |
| / | back to title | 4.1 | 18.2 | 17.8 | 0 | 0 | 0 | 0 |
| / | new game | 6 | 89 | 17.4 | 1 | 1 | 82 | -6 |
| / | boot | 0.1 | 48.4 | 48.4 | 1 | 0 | 0 | 0 |
| / | load to title | 3 | 761.4 | 761.4 | 10 | 7 | 754 | 250 |
| / | new game | 5.5 | 123.6 | 17.2 | 1 | 2 | 84 | -5 |
| / | to the ruins | 2.5 | 22.5 | 16.9 | 0 | 0 | 0 | 0 |
| / | first switch to era 1 | 3.5 | 32.6 | 17.1 | 0 | 0 | 0 | 0 |
| / | first switch to era 2 | 3.5 | 16.9 | 16.8 | 0 | 0 | 0 | 0 |
| / | first switch to era 3 | 3.5 | 17.7 | 17.7 | 0 | 0 | 0 | 0 |
| / | first switch to era 4 | 3.5 | 17.7 | 17.7 | 0 | 0 | 0 | 0 |
| / | first switch to era 5 | 3.5 | 21.7 | 19.4 | 0 | 0 | 0 | 0 |
| / | shift to 3D | 3.5 | 17.7 | 17.7 | 0 | 0 | 0 | 0 |
| / | bubble 8-bit on | 3 | 17.8 | 17.7 | 0 | 0 | 0 | 0 |
| / | bubble off | 2.5 | 17.6 | 17.6 | 0 | 0 | 0 | 0 |
| / | shift to 2D | 3.5 | 17.7 | 17.6 | 0 | 0 | 0 | 0 |
| / | puzzle event (seal opens) | 3 | 17.8 | 17.8 | 0 | 0 | 0 | 0 |
| / | steady Beyond 2D | 5 | 17.7 | 17.7 | 0 | 0 | 0 | 0 |

