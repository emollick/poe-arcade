# The Poe Arcade

Nine small browser games, one per Edgar Allan Poe story, behind a launcher.
Plain static files: no build step, no CDN, every library and font vendored in
`vendor/`. Serve the folder and it runs.

| Game | Story | Technology |
| --- | --- | --- |
| Nevermore | The Raven | inline SVG engraving that draws itself, DOM cards, Web Audio synthesis; no libraries |
| Under the Boards | The Tell-Tale Heart | Web Audio synthesis as the engine, visuals driven off an AnalyserNode on one Canvas 2D surface; no libraries |
| Pluto | The Black Cat | Rust compiled to `sim.wasm` (no bindgen) runs the plaster/damp/crack simulation; JS glue blits it with `putImageData` |
| Seven Chambers | The Masque of the Red Death | three.js r160 first-person WebGL, EffectComposer + UnrealBloomPass, canvas-generated textures, Web Audio |
| The Descending Blade | The Pit and the Pendulum | Matter.js 0.19 rigid bodies drawn by hand on a 2D canvas, Web Audio synthesis |
| Brick by Brick | The Cask of Amontillado | pure CSS 3D: the catacomb is a DOM scene under `perspective`/`preserve-3d`; no canvas, no WebGL, Web Audio |
| Kidd's Cipher | The Gold-Bug | a real substitution-cipher engine with live frequency analysis, a procedurally weathered parchment canvas, a self-drawing SVG map, Web Audio |
| Fissure | The Fall of the House of Usher | raw WebGL2, no libraries: the whole scene is raymarched from signed distance fields, then a bloom/rain/grain post pass |
| The Vortex | A Descent into the Maelström | raw WebGL2, no libraries: a full-screen funnel shader under 300k vertex-shader particles, Web Audio |

## Deploy to Netlify

**Option A, drag and drop (two minutes).**

```sh
node tools/package.mjs
```

That writes `../poe-arcade-netlify.zip` (the site and nothing else: no tools,
screenshots, notes or Rust sources). Open <https://app.netlify.com/drop> and
drop the zip on it. Done.

**Option B, connect a Git repo.** Push this repository, then in Netlify choose
*Add new site, Import an existing project*. Set the publish directory to `.`
and leave the build command empty. The included `netlify.toml` already says so
and sets the headers (`application/wasm` for the Black Cat module, long cache
for `/vendor/*` and `/shared/*`, no cache for HTML). Deep links such as
`/games/the-raven/` resolve on their own; there are no redirects.

## Run locally

Serve the repository root over http (not `file://`, which breaks ES modules
and the root-relative `/shared/` and `/vendor/` paths):

```sh
npx serve .                 # http://localhost:3000
python3 -m http.server 8080 # or this
```

To check every page the way CI would (console errors, failed requests, blank
canvases, at desktop and phone sizes):

```sh
cd tools && npm i --no-bin-links && cd ..   # once
node tools/verify.mjs                        # launcher + all nine games
node tools/verify.mjs the-raven              # just one
```

## Regenerating the Black Cat wasm

`games/black-cat/sim.wasm` is committed so the deploy needs no toolchain. To
rebuild it (needs `cargo` with the `wasm32-unknown-unknown` target only):

```sh
cd games/black-cat/rust
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/black_cat_sim.wasm ../sim.wasm
```

## Credits

Games after the tales of Edgar Allan Poe.
