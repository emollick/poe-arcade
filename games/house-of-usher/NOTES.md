# FISSURE — The Fall of the House of Usher

**Tagline:** Brace the walls of the House of Usher through one last night of storm before the fissure reaches the tarn.

**Tech:** Raw WebGL2, no libraries. The whole scene (mansion, bank, tarn, storm sky, lightning bolt, blood moon, fissure, collapse) is raymarched from signed distance fields in `scene.glsl` at reduced resolution into a framebuffer, then upscaled through `post.glsl` (wide bloom, chromatic fringe, rain, grain, heavy vignette). The tarn is a real planar reflection: one reflected ray marched against the same SDF with ripple-perturbed normals. Bracing marks are DOM overlays projected with the same camera the shader uses. All sound is Web Audio synthesis via `createAudio()`.

## Controls
- The fissure is the clock. Its tip runs down the facade all night; the brace that lights is always the mark nearest **below** the tip on the crack's own zigzag (the six braces sit on its vertices, gable to door). Click / tap it before its ring runs out: the wall flares where you braced and the tip recoils one segment. Miss, and the tip runs through.
- After 38 s the storm forks it: two braces light and the fissure runs to the one you leave, so take the lower. Late in the run the tarn braces too: tap the reflection.
- Keys 1–6 map to the six braces top to bottom (numerals are shown on desktop). Enter / Space / a tap on the title begins, R restarts, M mutes.
- Tapping empty dark, or a brace that is not lit, jolts the crack wider (0.03 / 0.045); a brace left to expire costs 0.05 plus the recoil you did not get.
- Hold on until the timer reaches the causeway (70 s) to win: the wound knits bone-white, the windows light one by one and the storm clears to a cold moon. If the fissure reaches the tarn, the house splits, leans apart and the tarn closes over it under a blood-red moon.

## Tuning (`bots.mjs`)
`node games/house-of-usher/bots.mjs` plays whole runs in-page with an exact reaction delay and real `pointerdown`s at the projected marks (errors are skipped braces; `Math.random` is seeded per row), and first prints where every brace projects on 1440x900, 1366x768, 1280x720, 844x390 and 390x844 (`--marks` for only that). Constants at the top of `game.js`: the floor under the tip rises to `CRACK_FLOOR` 0.55 by the causeway, the tip creeps `CREEP_PER_BRACE` 0.074 between braces against a `RECOIL` of 0.08 per hit. Measured at 0.45 s reaction: 0 % errors ends on the floor (0.57); 5 % wins at 0.61–0.73; 12 % is alive at 50 s in every seed and loses at 51 s / 68 s or wins at 0.77; 20 % dies at 41–65 s; 0.7 s reaction with 12 % loses at 50 s or wins at 0.84. The crack is visibly moving by 10 s (0.08–0.15).

## The look
- `#8a97a3` desaturated stone / bone-white lightning
- `#a8121c` the fissure

Type: Cinzel (wide-tracked title, HUD numerals), Marcellus SC (labels), EB Garamond italic (Poe's lines).

## Files
`index.html`, `style.css`, `game.js`, `scene.glsl` (raymarcher), `post.glsl` (film pass), `playtest.mjs` (Playwright: real clicks/taps/keys through both endings; writes `screenshots/house-of-usher-{title,play,collapse,lose,win}.png`, add `--mobile` for 390x844), `bots.mjs` (balance bots + projected-mark check, see Tuning).

The title lockup is placed by `layoutTitle()` in `game.js`: FISSURE (72px / 44px Cinzel) lies across the facade with its red U on the crack line, clamped inside the viewport.

## Debug hook
`window.__poe`: `state`, `crack`, `tipY`, `score`, `t`, `marks` (projected screen positions with `off`, `active`, `born`, `fork`), `start()`, `ff(seconds, autoHit)`, `step(dt)` (one sim step plus camera/mark layout, no draw), `layout()`, `setCrack(v)`, `forceWin()`, `forceLose()`. `?scale=0.5` in the URL pins the internal render scale (used by the playtest to grab full-resolution frames under SwiftShader).

## Performance
Scene renders at 0.5x on desktop, 0.34x on touch devices, 0.16x when a software renderer (SwiftShader/llvmpipe) is detected; step counts and shadow/AO quality scale with it. An adaptive loop nudges the scale up or down to hold near 60 fps, except for the first 8 s of the collapse, which are held at 0.75x (0.55x on touch) so the split does not staircase. The primary march is bounded by a scene AABB so sky and open water cost almost nothing.

## Camera
`setCamera()` fits the house width as before, and in play (not on the title) also shrinks the focal until the tower cap and the deepest reflected brace both fit with a 48px margin, then lens-shifts the frame (`uShift`, applied in both `project()` and `scene.glsl`) so the reflection stays tappable. Any mark that still projects within 40px of an edge is flagged `off` and never lit in the reflection.

## Known limits
- Under headless SwiftShader a frame takes ~0.3-0.7 s; the game is only meant to be judged on a real GPU (the playtest's hi-res frames take a few seconds each there).
- The collapse splits the SDF along x=0 rather than exactly along the zigzag; the emissive crack hides the seam.
- On a landscape phone (844x390) the reflection fit shrinks the house so the six braces are ~20px apart; the tap resolves to the nearest lit ring, so it plays, but it is cramped.
- Balance has real variance: with random errors a 12 % player can land anywhere from a 51 s collapse to a 0.77 win; the bots table is the reference, not a single run.
