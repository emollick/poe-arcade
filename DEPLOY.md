# Deploying poe-arcade to Netlify

## Site

| | |
|---|---|
| Site name | `poe-arcade` |
| Site id | `122016db-aa6c-4b70-8ad1-0afa2cc75ac7` |
| Team | Mollick (`emollick`), owner Ethan Mollick |
| Production URL | https://poe-arcade.netlify.app |
| Admin URL | https://app.netlify.com/projects/poe-arcade |
| Deploys | https://app.netlify.com/projects/poe-arcade/deploys |

Status: LIVE at https://poe-arcade.netlify.app since 2026-09-06 16:29 UTC. The
site is linked to GitHub `emollick/poe-arcade` (branch `main`, publish `.`, no
build command); every push to `main` redeploys automatically (first production
deploy id 6a9d94ea7956f0d1ada47a4a). Direct uploads from the Claude container
remain blocked by its network policy, so redeploys go through Git: commit,
`git push origin main`, and check the deploy state with the Netlify connector's
get-project / get-deploy-for-site.

## What gets deployed

There is no build step. `netlify.toml` sets `publish = "."` and `command = ""`
and carries the headers that matter (revalidate HTML, cache `/vendor/*` and
`/shared/*` for a year, serve `*.wasm` as `application/wasm`, no SPA rewrite).
`tools/package.mjs` produces `poe-arcade-netlify.zip`, the exact file set for
the site: `index.html`, `favicon.svg`, `netlify.toml`, `launcher/`, `shared/`,
`vendor/`, `games/*/` (including `games/black-cat/sim.wasm`) and nothing else
(no `tools/`, `screenshots/`, `.git`).

## Redeploy

1. Package the site from the repo root:

       node tools/package.mjs

   This writes `../poe-arcade-netlify.zip` (366 files at the time of writing).

2. Unpack it into a clean directory:

       mkdir -p /tmp/poe-arcade-deploy && cd /tmp/poe-arcade-deploy
       unzip -o -q /path/to/poe-arcade-netlify.zip

3. Deploy that directory to production, either

   - through the Netlify connector: `netlify-deploy-services` ->
     `deploy-site` with the site id above, then run the command it hands back
     from inside the deploy directory; or
   - with the Netlify CLI (you will be prompted to log in the first time):

         npx --yes netlify-cli deploy --prod --dir . --site 122016db-aa6c-4b70-8ad1-0afa2cc75ac7

4. Verify:

       curl -sI https://poe-arcade.netlify.app/                         # 200
       curl -sI https://poe-arcade.netlify.app/games/black-cat/sim.wasm  # content-type: application/wasm
       curl -sI https://poe-arcade.netlify.app/vendor/three/three.module.js
                                              # 200, cache-control: public, max-age=31536000, immutable

   then open `/`, `/games/the-raven/`, `/games/black-cat/` and
   `/games/masque-red-death/` in a browser and check the console is clean.
   `node tools/verify.mjs` runs the same checks against a local copy.

## Claude Artifacts

The arcade is also published as ten Claude Artifacts: one per game plus the
launcher. Each artifact is a single self-contained HTML file (no external
requests), produced by `tools/bundle-artifact.mjs`, which inlines fonts,
scripts, ES-module graphs, GLSL and wasm as data. Every artifact is its own
origin, so the launcher opens games in a new tab and cannot read their best
scores ("best: —" on the launcher is expected).

Procedure (the URLs are only known after publishing, so it is a three-pass
loop):

1. Bundle every page:

       for s in tell-tale-heart masque-red-death pit-and-pendulum house-of-usher \
                maelstrom gold-bug amontillado the-raven black-cat launcher; do
         node tools/bundle-artifact.mjs $s
       done

   Bundles land in `$POE_BUNDLE_OUT_DIR` (default: the session scratchpad).
   `node tools/bundle-check.mjs` loads each one headless and checks for
   console errors, failed requests and bundling misses.

2. Publish each game bundle with the Artifact tool (title from its `<title>`,
   emoji favicon). Note the URL of each. The game's back link still reads
   `LAUNCHER_URL_PLACEHOLDER` at this point.

3. In the launcher bundle, replace `GAME_URL_PLACEHOLDER_<slug>` with each
   game's URL (the bundled launcher emits it as the template literal
   `GAME_URL_PLACEHOLDER_${g.slug}`; swap that for a `GAME_URLS[g.slug]`
   lookup table), keep `target="_blank" rel="noopener"` on the drawer links,
   grep that no placeholder remains, and publish the launcher.

4. Replace `LAUNCHER_URL_PLACEHOLDER` in each game bundle (exactly one
   occurrence, in the bundled `shared/poe.js` `mountBack`) and in the launcher
   itself (its footer self-link) with the launcher URL, then republish each
   as a NEW VERSION of the existing artifact by passing the existing artifact
   URL to the Artifact tool (`url`), so no duplicates are created. Confirm the
   returned URL is unchanged.

5. Verify with the Artifact tool's `read` action (the stored HTML is the
   bundle wrapped in the publisher's skeleton) — Chromium in the sandbox
   cannot reach `claude.ai`, so live rendering has to be checked from a
   normal browser.

Published 2026-09-06:

| Page | URL |
|---|---|
| A Cabinet of Poe (launcher) | https://claude.ai/code/artifact/ec61e301-6cf9-4fa8-abf8-3d0585e4e8bf |
| Under the Boards — The Tell-Tale Heart | https://claude.ai/code/artifact/8e822acc-dfa7-4ba3-867e-8123c63e10f7 |
| Seven Chambers — The Masque of the Red Death | https://claude.ai/code/artifact/3ea4990e-0d16-4bfe-a7a4-2e639af8965e |
| The Descending Blade — The Pit and the Pendulum | https://claude.ai/code/artifact/ece5642d-cff8-4899-83ca-742631c6ae99 |
| Fissure — The Fall of the House of Usher | https://claude.ai/code/artifact/812df68a-be8f-4830-af9d-df73c686a8a7 |
| The Vortex — A Descent into the Maelström | https://claude.ai/code/artifact/cdd08e5a-af12-4628-9337-3963c18d99b7 |
| Kidd's Cipher — The Gold-Bug | https://claude.ai/code/artifact/cd9be56e-1714-40b1-a0c0-14ef16362039 |
| Brick by Brick — The Cask of Amontillado | https://claude.ai/code/artifact/7f96db88-bf30-4787-a80d-9004177baaaf |
| Nevermore — The Raven | https://claude.ai/code/artifact/d1b1f4c6-8797-4fa6-b5e0-bfdc488e4fb1 |
| Pluto — The Black Cat | https://claude.ai/code/artifact/5db7d530-053d-4674-b31d-1f81995f5345 |

## GitHub

The source lives at https://github.com/emollick/poe-arcade (default branch
`main`). Push there with `git push origin main`; the remote is configured
as `origin` and `main` tracks `origin/main`.

To have Netlify build from the repository instead of manual bundle uploads:

1. Open the site in Netlify → Site configuration → Build & deploy →
   Continuous deployment → Link repository.
2. Choose GitHub, authorize if prompted, and pick `emollick/poe-arcade`.
3. Branch to deploy: `main`. Build command: leave empty (the site is static).
   Publish directory: `.` (the repository root).
4. Save. `netlify.toml` already declares the publish directory and the
   response headers, so no further build settings are needed; every push
   to `main` then produces a production deploy.
