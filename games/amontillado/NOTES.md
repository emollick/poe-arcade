# The Cask of Amontillado — Brick by Brick

**Tagline:** Eleven tiers. He talks, he laughs, his bells jingle, he screams. You keep laying.

**Tech:** Pure CSS 3D — the catacomb is a DOM scene under `perspective` / `preserve-3d` (floor, walls, a six-plane
segmental vault, the niche, every brick a preserve-3d box of three faces); no canvas, no WebGL, no images; all sound
synthesized with Web Audio via `createAudio()`.

**Controls:** Space / click / tap when the trowel crosses the lit stone to lay a brick. Hold (>260 ms) to *listen*:
the trowel freezes (its blade goes nitre-green) and Fortunato's interference dies down, but the torch burns three
times faster. M toggles sound.

**The instrument is the wall.** There is no timing bar: the dashed ghost brick marks the next slot and its solid
`.core` is the sweet zone itself, sized to the tier's tolerance (`hw`); when the trowel is inside it the stone lights
sodium amber and the trowel head glows (`.ghost.hot`, `.trowel.hot`). Bell jitter, the scream's reverse and the
quiet's fade all act on the trowel (`.trowel.dark`). A caption under the scene explains the tap/hold for the first
three lays only; interference cues ("the bells stir …") use the same line. The lay grade (`#pop`) is a HUD element
projected each frame onto the brick just laid (`project()` mirrors the stage perspective), so it sits on the wall
above the top course and leaves the bottom band to Montresor's narration.

**Rules:** Perfect lays fill the course; crooked lays go in tilted, and three crooked in one course collapse it (you
redo the tier, and one chain link breaks — the HUD chain is three interlinked SVG links, each two half-arcs that snap
apart and go red). Three collapses and the chain gives. The torch (105 s) must last to the eleventh tier. Score = bricks weighted by precision (true 150 / perfect 100 / crooked 20) times a streak multiplier,
plus 10 points per second of torch left at the end. Interference escalates by tier: bells (jitter + shake) from tier
III, the chain at IV, screams (the marker reverses) from VIII, the laugh (double speed) from IX, and the quiet (the
marker fades unless you listen) from X. Tier XI plays the closing dialogue from the text, then the last stone is
forced in with six taps.

**Palette:** sodium amber `#ff8c1a` on damp stone `#2a332f` (with nitre `#d6f5e0` and ivory `#e8dfc0`).
Type: UnifrakturMaguntia (title), Cormorant Garamond (Montresor), Spectral italic (Fortunato).

**Torch tuning (playtest.mjs, headless SwiftShader):** the frame-perfect skilled bot (taps within one frame of the
zone) wins with ~68 s of 105 left; the human-paced bot (`pace: 0.65` — takes about two passes in three, which is
closer to how a person plays) wins with ~16 s left; the clumsy bot loses to the chain at tier I–II. At the old
140 s the skilled bot finished with 96–116 s left and the torch never mattered.

**End cards:** the chain ending is the red wash with three of the jester's bells swinging on threads in the dark;
the torch ending is pure black with one ember dying over nine seconds (`#end-art`).

**Debug hook:** `window.__poe` — `start()`, `lay(perfect)`, `skipTo(tier)`, `force()`, `setTorch(s)`, `win()`,
`lose('torch'|'free')`, `info()`. `playtest.mjs` uses these plus real pointer events to reach both endings, and
runs three bots: skilled, human-paced, clumsy.

**Known limits:**
- Performance was only measurable under headless SwiftShader (software compositing), which is not representative;
  the scene keeps 3D faces to roughly 200 (49 bricks × 3 faces plus ~40 planes) and animates only transforms/opacity
  per frame, but real-GPU 60 fps on low-end phones is untested here.
- Stone bond on the walls is a plain grid (CSS gradients cannot stagger alternate rows without extra elements).
- The tier XI dialogue (~12 s) pauses the torch so the scripted lines cannot cost the player the game.
- Text on a plane inside the preserve-3d world (tried for the lay grade) was clipped by Chromium's 3D layer sorting
  against the empty bonepile plane; keep text in the HUD and project it instead.
