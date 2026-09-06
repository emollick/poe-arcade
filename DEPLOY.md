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

Status (2026-09-06): the site was created through the Netlify connector, but
the first production deploy has NOT gone out yet. The sandbox this was attempted
from cannot reach `api.netlify.com` (egress proxy answers 403 to CONNECT), so the
upload step must be run from a machine with normal network access. Until then
the production URL serves Netlify's "site not found" page.

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
