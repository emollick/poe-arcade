# PLUTO — The Black Cat

**Tagline:** The police are in the cellar. Plaster over the damp before the lantern finds what is in the wall.

**Tech:** a `#![no_std]`-free but allocator-free Rust core (`rust/`, std with `panic = "abort"`, static buffers only, no wasm-bindgen) compiled to `sim.wasm` runs the entire plaster/moisture/crack simulation and renders the RGBA wall; `game.js` is hand-written glue over linear memory that feeds input and the lantern, blits `pixels_ptr()` with `putImageData`, runs the officers' inspection, the score and the Web Audio synthesis.

## Controls

- **Mouse drag / finger drag** — plaster (soft disc, spends the pail; one narrow stroke across the cat is ~60% of it, refilled in ~4 s)
- **Shift / second finger / WIDE TROWEL button** — wide trowel (1.7x radius, 3x cost per step — a gamble on a full pail)
- **Space / HOLD BREATH button** — the officer pauses for a second; costs a tick of attention, 4 s cooldown
- **Enter / Space / tap** — start, and play again from an end screen
- **M** — mute

Goal: survive four sweeps of the lantern. Their attention rises whenever what shows inside the beam (stains, cracks, the eye, heavy lumps) is above a threshold; at the top they tap the wall and the cat answers. Score = seconds unseen × thrift (how little plaster you used) × streak of clean sweeps, +60 if they leave.

Pacing (per sweep, `game.js`): visibility threshold `VIS_THRESHOLD = [0.06, 0.10, 0.12, 0.12]`, climb `SUSP_GAIN = [0.8, 0.8, 1.05, 1.3]` (capped at 0.5 excess so there is always a beat between the frown and the find), and the eye — a few dozen cells but what an officer sees first — is weighted on top of the sim's area-normalised `visibility()` by `EYE_WEIGHT = [9, 6, 2.5, 2]` through the separate `eye_visibility()` export. A new game starts already damp (`start_dress()`): the eye bleeds through thin plaster and one ear is wet with a hairline along it, so there is something to find in sweep I. When attention crosses 0.62 he frowns, raps, and the lantern comes back to the eye for ~2 s (`lookBack`); a do-nothing player is found there.

## The look

Two colours that define it: plaster **#e9dfc9** and the eye **#b6d63a** (with damp umber #4a3828, crack #16110d and the lantern's amber #f0b45a). Type: Playfair Display 900 for PLUTO, Spectral for everything else.

The title is the poster: `init()` takes a pose, so the cat sits in the right half on desktop (PLUTO's O overlaps its lower body) and above the type on phones; `title_dress()` puts the wall in its between-sweeps state — the body in low relief (thick plaster over the mask), damp bloomed, hairlines tracing the outline, the eye through — and the title loop keeps stepping the sim so the damp blooms while the eye opens and closes on an 8 s cycle (`set_lid`, `titleLid()`). Measured: 17–22% of canvas pixels change over 4 s.

No default UI: the cursor is a trowel blade the width of the stroke, clipped to the wall; the plaster gauge is a pail on the ledge drawn on the canvas (`drawBucket`); the buttons are rule lines with spaced small caps. Lose: kicker in amber over a soft scrim. Win: ambient floor 0.17 with `reveal` 0.8 so the body stays as a ~10% silhouette, and the caption block starts below the eye (`--eye-bottom`).

## Rebuilding `sim.wasm`

```sh
cd games/black-cat/rust
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/black_cat_sim.wasm ../sim.wasm
```

Requires only `rustc`/`cargo` with the `wasm32-unknown-unknown` target (no wasm-pack, no bindgen). Output is ~38 KB; linear memory is ~15 MB of static buffers (512x512 cells max) and never grows, so the JS pixel view stays valid.

Exports: `init(w,h,seed,cxf,cyf) -> pixels ptr` (cat pose as grid fractions, 0 = play pose), `step(dt_ms, difficulty)`, `plaster(x,y,r,amount) -> spent`, `set_lantern(x,y,r,strength)`, `render()`, `pixels_ptr()`, `visibility()` (0..1 inside the beam), `eye_visibility()`, `lump_visibility()` (tuning), `total_visibility()`, `rap(x,y,strength)`, `set_ambient`, `set_eye`, `set_lid`, `set_reveal`, `title_dress`, `start_dress`, `show_at`, `cat_at`, `eye_x/y/r`, `ear_x/y`, `cat_cx/cy/size`, `width/height`.

## Testing

```sh
node tools/verify.mjs black-cat
node games/black-cat/playtest.mjs            # desktop: lazy run -> lose, bot -> win
node games/black-cat/playtest.mjs --mobile   # 390x844 touch
```

The playtest writes `screenshots/black-cat-{title,play,lose,win}.png`; `BOT_TRACE=1` prints a line per game second (attention, visibility split into raw / eye / lump, pail level). `window.__poe` exposes `start()`, `setTimeScale(k)`, `win()`, `lose()`, `paint(x,y)`, `showAt(x,y)`, `eye()`, `visParts()`, `fps()`.

## Known limits

- Grid is ~512x320 on desktop (2.8 CSS px per cell, soft upscale + a full-resolution grain overlay) and ~195x422 on a 390-wide phone.
- A performance gotcha found while tuning: subnormal floats from `exp()` tails made the render loop 2x slower; every decaying field is flushed to zero, keep that if you edit the sim.
- Rotating a phone mid-game rebuilds the wall (the cat pose changes with the aspect); the run continues.
- Every width that lives in cells (edge seep band, diffusion, crack walker speed and life, lump-gradient shading, crack seepage) is scaled by `REL = cat_size / 320` so the coarse phone grid plays the same as desktop; an A/B of the sim with an identical bot on 512x320 vs 195x422 is what caught that.
- The sim is deterministic per seed except for the JS-side sweep pauses.
- The eye under the beam: the lantern-lit plaster can overexpose past 255, so the eye's colour is mixed from a clamped base, the pupil reads as soon as the iris does (`pk = pupil * clamp01(eyeshow * 2.2)`) and the glint waits until the eye is well through — otherwise a half-through eye under the beam rendered as a blank pale disc (worst on the phone grid, where sweep II runs straight over it).
- Playtest results (headless, loaded box, per seed): a do-nothing player is warned at ~12 s and found at ~12.5–13 s in sweep I on desktop; on the phone 2 of 3 seeds are found in sweep I (warned 8.5–9.3 s, found 9.3–10.3 s) and the third in sweep II (~27 s). The lazy run (a few strokes, then nothing) loses at 12–32 s in sweep I or II. The diligent bot wins at 78 s on desktop (3–4 clean sweeps) and 71 s on the phone (3 clean); sweep IV is the squeeze, where the pail runs dry and a heavy coat's lumps carry ~0.1 of visibility on their own. Frame cost at 512x320: step ~0.8 ms + render ~7 ms wasm, blit <0.3 ms.
