# PLUTO — The Black Cat

**Tagline:** The police are in the cellar. Plaster over the damp before the lantern finds what is in the wall.

**Tech:** a `#![no_std]`-free but allocator-free Rust core (`rust/`, std with `panic = "abort"`, static buffers only, no wasm-bindgen) compiled to `sim.wasm` runs the entire plaster/moisture/crack simulation and renders the RGBA wall; `game.js` is hand-written glue over linear memory that feeds input and the lantern, blits `pixels_ptr()` with `putImageData`, runs the officers' inspection, the score and the Web Audio synthesis.

## Controls

- **Mouse drag / finger drag** — plaster (soft disc, spends the trowel load)
- **Shift / second finger / WIDE TROWEL button** — wide trowel (1.7x radius, 3x cost)
- **Space / HOLD BREATH button** — the officer pauses for a second; costs a tick of attention, 4 s cooldown
- **Enter / Space / tap** — start, and play again from an end screen
- **M** — mute

Goal: survive four sweeps of the lantern. Their attention rises whenever what shows inside the beam (stains, cracks, the eye, heavy lumps) is above a threshold; at the top they tap the wall and the cat answers. Score = seconds unseen × thrift (how little plaster you used) × streak of clean sweeps, +60 if they leave.

## The look

Two colours that define it: plaster **#e9dfc9** and the eye **#b6d63a** (with damp umber #4a3828, crack #16110d and the lantern's amber #f0b45a). Type: Playfair Display 900 for PLUTO, Spectral for everything else.

## Rebuilding `sim.wasm`

```sh
cd games/black-cat/rust
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/black_cat_sim.wasm ../sim.wasm
```

Requires only `rustc`/`cargo` with the `wasm32-unknown-unknown` target (no wasm-pack, no bindgen). Output is ~38 KB; linear memory is ~15 MB of static buffers (512x512 cells max) and never grows, so the JS pixel view stays valid.

Exports: `init(w,h,seed) -> pixels ptr`, `step(dt_ms, difficulty)`, `plaster(x,y,r,amount) -> spent`, `set_lantern(x,y,r,strength)`, `render()`, `pixels_ptr()`, `visibility()` (0..1 inside the beam), `total_visibility()`, `rap(x,y,strength)`, `set_ambient`, `set_eye`, `set_reveal`, `title_dress`, `show_at`, `cat_at`, `eye_x/y`, `cat_cx/cy/size`, `width/height`.

## Testing

```sh
node tools/verify.mjs black-cat
node games/black-cat/playtest.mjs            # desktop: lazy run -> lose, bot -> win
node games/black-cat/playtest.mjs --mobile   # 390x844 touch
```

The playtest writes `screenshots/black-cat-{title,play,lose,win}.png`. `window.__poe` exposes `start()`, `setTimeScale(k)`, `win()`, `lose()`, `paint(x,y)`, `showAt(x,y)`, `fps()`.

## Known limits

- Grid is ~512x320 on desktop (2.8 CSS px per cell, soft upscale + a full-resolution grain overlay) and ~195x422 on a 390-wide phone.
- A performance gotcha found while tuning: subnormal floats from `exp()` tails made the render loop 2x slower; every decaying field is flushed to zero, keep that if you edit the sim.
- Rotating a phone mid-game rebuilds the wall (the cat pose changes with the aspect); the run continues.
- Every width that lives in cells (edge seep band, diffusion, crack walker speed and life, lump-gradient shading, crack seepage) is scaled by `REL = cat_size / 320` so the coarse phone grid plays the same as desktop; an A/B of the sim with an identical bot on 512x320 vs 195x422 is what caught that.
- The sim is deterministic per seed except for the JS-side sweep pauses.
- Playtest results (headless, loaded box): lazy run loses at ~28-31 s in sweep II on both viewports; the diligent bot wins at 67-78 s with 4 clean sweeps. Frame cost at 512x320: step ~0.8 ms + render ~7 ms wasm, blit <0.3 ms.
