# FISSURE — The Fall of the House of Usher

**Tagline:** Brace the walls of the House of Usher through one last night of storm before the fissure reaches the tarn.

**Tech:** Raw WebGL2, no libraries. The whole scene (mansion, bank, tarn, storm sky, lightning bolt, blood moon, fissure, collapse) is raymarched from signed distance fields in `scene.glsl` at reduced resolution into a framebuffer, then upscaled through `post.glsl` (wide bloom, chromatic fringe, rain, grain, heavy vignette). The tarn is a real planar reflection: one reflected ray marched against the same SDF with ripple-perturbed normals. Bracing marks are DOM overlays projected with the same camera the shader uses. All sound is Web Audio synthesis via `createAudio()`.

## Controls
- Click / tap the lit brace before its ring runs out. Late in the run the tarn braces too: tap the reflection.
- Keys 1–6 map to the six braces (numerals are shown on desktop). Enter / Space begins, R restarts, M mutes.
- Tapping empty dark, or a brace that is not lit, jolts the crack wider. Every miss runs the fissure lower; every hit slows it.
- Hold on until the timer reaches the causeway (70 s) to win. If the fissure reaches the tarn, the house splits, leans apart and the tarn closes over it under a blood-red moon.

## The look
- `#8a97a3` desaturated stone / bone-white lightning
- `#a8121c` the fissure

Type: Cinzel (wide-tracked title, HUD numerals), Marcellus SC (labels), EB Garamond italic (Poe's lines).

## Files
`index.html`, `style.css`, `game.js`, `scene.glsl` (raymarcher), `post.glsl` (film pass), `playtest.mjs` (Playwright: real clicks/taps/keys through both endings; writes `screenshots/house-of-usher-{title,play,collapse,lose,win}.png`, add `--mobile` for 390x844).

## Debug hook
`window.__poe`: `state`, `crack`, `score`, `t`, `marks` (projected screen positions), `start()`, `ff(seconds, autoHit)`, `setCrack(v)`, `forceWin()`, `forceLose()`. `?scale=0.5` in the URL pins the internal render scale (used by the playtest to grab full-resolution frames under SwiftShader).

## Performance
Scene renders at 0.5x on desktop, 0.34x on touch devices, 0.16x when a software renderer (SwiftShader/llvmpipe) is detected; step counts and shadow/AO quality scale with it. An adaptive loop nudges the scale up or down to hold near 60 fps. The primary march is bounded by a scene AABB so sky and open water cost almost nothing.

## Known limits
- Under headless SwiftShader a frame takes ~0.3-0.7 s; the game is only meant to be judged on a real GPU (the playtest's hi-res frames take a few seconds each there).
- The collapse splits the SDF along x=0 rather than exactly along the zigzag; the emissive crack hides the seam.
- Reflection braces can sit low on very short landscape viewports; the camera framing favours portrait and 16:10.
