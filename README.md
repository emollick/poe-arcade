# The Poe Arcade

Nine small browser games, one per Edgar Allan Poe story, plus a launcher.
Pure static files. **There is no build step** — the repository *is* the site, so
a fresh clone deploys with zero toolchain.

## Layout

```
poe-arcade/
  index.html          launcher
  netlify.toml        deploy config (publish ".", no build command)
  CONVENTIONS.md      read this before building a game
  shared/
    poe.css           the common chrome only (reset, back link, rotate hint)
    fonts.css         self-hosted Google Fonts — the one stylesheet to link
    poe.js            tiny ES module: mountBack, fitCanvas, createAudio, …
  vendor/             pinned third-party code, served locally
    three/            three.js r160 (module build + trimmed examples/jsm)
    matter/           matter-js 0.19
    fonts/            60 woff2 faces across 14 families
  games/<slug>/index.html
  tools/
    verify.mjs        the check every game must pass
    fetch-fonts.mjs   regenerates shared/fonts.css + vendor/fonts
  screenshots/        written by verify.mjs
```

## Run locally

Serve from the repository root — **not** `file://`, which breaks ES modules and
root-relative asset paths:

```sh
npx serve .            # or: python3 -m http.server 8080
```

Then open <http://localhost:3000/> (or `:8080`).

## Verify

```sh
cd tools && npm i --no-bin-links && cd ..   # once
node tools/verify.mjs                        # launcher + all games
node tools/verify.mjs the-raven              # just one
```

It boots its own static server, loads each page at 1440x900 and 390x844, fails
on any console error / failed request / blank canvas, writes
`screenshots/<name>-{desktop,mobile}.png`, and exits non-zero on failure.

## Deploy to Netlify

**Drag and drop.** Open <https://app.netlify.com/drop> and drop the entire
`poe-arcade` folder onto it. Nothing to configure — `netlify.toml` travels with
the folder.

**Connect a Git repo.** Push this repository, then in Netlify choose
*Add new site → Import an existing project*. The included `netlify.toml`
already sets **publish directory `.`** and an **empty build command**; leave
both as detected. No environment variables, no Node version pin, no plugins.

If a game ever needs compiled output (e.g. wasm), build it locally and commit
the artifact under `wasm/`. The deploy must keep needing no build.
