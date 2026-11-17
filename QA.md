# QA report: PIP — Beyond the Frame (phase 5: Blender assets, immersive valley, 1985 8-bit)

Build: `tsc --noEmit` clean, `vite build` clean (one 1.49 MB chunk, 427 KB gzipped).

## 1. Automated coverage (Vitest, headless): 83 / 83 passing

| Suite | What it proves |
|---|---|
| controller / shift / puzzle | Physics, shift safety and puzzle rules |
| `playthrough.test.ts` | A bot plays new game → Halo Path → ending through the real input path |
| `qa.test.ts` | Resume matrix over every checkpoint, fuzz over 16 seeds, v3 → v4 save migration |
| `chapter6.test.ts` (10) | The Halo Path's generation-rule obstacles |
| `valley.test.ts` (6) | Lane heights match the platform tops exactly; gorges respawn; walking off the path and back; rises walkable, cliffs block; shallow stream vs gorge; the 3D camera never goes underground |
| `retro.test.ts` (4) | One 16×16 ground block in exactly 3 palette colours; sprites ≤ 3 colours; palette-only sky and clouds; tiles only from solids that exist in 8-bit |

## 2. Browser pass (Chrome, M4 Pro, dev server)

| Area | Result |
|---|---|
| 8-bit start: flat sky, one ground block, plain clouds, tiny 3-colour Pip, no scenery | ✅ |
| 8-bit frame read back from WebGL: **0 off-palette pixels** (13 colours on screen); every vertical pixel run a multiple of the scale | ✅ after fix 4 |
| 8-bit → 16-bit ripple sweeps through tiles and sky | ✅ |
| Valley in Modern HD / Beyond: full canopies, real sky, sun-matched shadows, river, no backdrop pieces poking through | ✅ after fixes 1–3 |
| Stylized valley still renders | ✅ (terrain is not toon-shaded; see limitations) |
| Gallery → Environment: 8-bit tiles and the 3D valley from matched cameras | ✅ |
| Console during all of the above | ✅ no errors |

## 3. Bugs found and fixed in this pass

| # | Bug | Fix |
|---|---|---|
| 1 | Tree canopies almost bare | The exported leaf material had depth writes off; leaves now write depth, and alpha sharpening runs before any discard |
| 2 | A bright green dome in the cliff gap | An old backdrop hill poking through the terrain; old hills, deep floor, cliff and waterfall are hidden inside the valley |
| 3 | Glossy cartoon-blue river under the real sky | Deeper green water with a reduced sky reflection |
| 4 | Uneven 8-bit rows on odd-sized windows | Half-pixel camera offset so pixel edges fall between screen pixels |
| 5 | 8-bit drew 4.85 M triangles (valley grass discarded per pixel) | Terrain and dressing are skipped when no 3D/modern generation can be on screen; now 8 k |
| 6 | Cartoon clouds floating in front of the real sky | Limited to 16-bit … Stylized |

## 4. Known limitations

See `docs/GRAPHICS_REPORT.md` → "What still falls short". In short:
- Beyond is near the 60 fps limit on High in the valley overview (p95 GPU 17.3 ms).
- The immersive world ends at x ≈ 52.
- Early 3D and Stylized have no dedicated terrain look.
- Cartoon props remain in the modern valley.
- The 8-bit HUD is a DOM pixel-font overlay.
- 16-bit is still the filter treatment.
- No full human playthrough in the browser; the complete game is played by the bot.
- Audio was not judged by ear.
