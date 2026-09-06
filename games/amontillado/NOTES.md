# The Cask of Amontillado — Brick by Brick

**Tagline:** Eleven tiers. He talks, he laughs, his bells jingle, he screams. You keep laying.

**Tech:** Pure CSS 3D — the catacomb is a DOM scene under `perspective` / `preserve-3d` (floor, walls, a six-plane
segmental vault, the niche, every brick a preserve-3d box of three faces); no canvas, no WebGL, no images; all sound
synthesized with Web Audio via `createAudio()`.

**Controls:** Space / click / tap when the marker crosses the lit stone to lay a brick. Hold (>260 ms) to *listen*:
the marker freezes and Fortunato's interference dies down, but the torch burns three times faster. M toggles sound.

**Rules:** Perfect lays fill the course; crooked lays go in tilted, and three crooked in one course collapse it (you
redo the tier, and one chain link breaks). Three collapses and the chain gives. The torch (140 s) must last to the
eleventh tier. Score = bricks weighted by precision (true 150 / perfect 100 / crooked 20) times a streak multiplier,
plus 10 points per second of torch left at the end. Interference escalates by tier: bells (jitter + shake) from tier
III, the chain at IV, screams (the marker reverses) from VIII, the laugh (double speed) from IX, and the quiet (the
marker fades unless you listen) from X. Tier XI plays the closing dialogue from the text, then the last stone is
forced in with six taps.

**Palette:** sodium amber `#ff8c1a` on damp stone `#2a332f` (with nitre `#d6f5e0` and ivory `#e8dfc0`).
Type: UnifrakturMaguntia (title), Cormorant Garamond (Montresor), Spectral italic (Fortunato).

**Debug hook:** `window.__poe` — `start()`, `lay(perfect)`, `skipTo(tier)`, `force()`, `setTorch(s)`, `win()`,
`lose('torch'|'free')`, `info()`. `playtest.mjs` uses these plus real pointer events to reach both endings.

**Known limits:**
- Performance was only measurable under headless SwiftShader (software compositing), which is not representative;
  the scene keeps 3D faces to roughly 200 (49 bricks × 3 faces plus ~40 planes) and animates only transforms/opacity
  per frame, but real-GPU 60 fps on low-end phones is untested here.
- Stone bond on the walls is a plain grid (CSS gradients cannot stagger alternate rows without extra elements).
- The tier XI dialogue (~12 s) pauses the torch so the scripted lines cannot cost the player the game.
