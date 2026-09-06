# CONVENTIONS — read this before writing a game

Sixty seconds. Follow it exactly and your game will pass `verify.mjs` first try.

---

## 1. Your file

You own exactly one file: `games/<your-slug>/index.html`. Overwrite the
placeholder completely. Put any extra assets you need beside it, inside your own
directory. **Do not edit** `shared/*`, `netlify.toml`, `tools/*`, or another
game's folder — other workers are editing this repo in parallel.

## 2. The boilerplate (copy this verbatim)

```html
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>The Raven</title>
<link rel="stylesheet" href="/shared/fonts.css">
<link rel="stylesheet" href="/shared/poe.css">
<script type="module">
  import { mountBack } from '/shared/poe.js';
  mountBack();
</script>
```

All shared paths are **root-relative** (`/shared/…`, `/vendor/…`). They resolve
because the site is served from the repo root — never use `file://`.

**The viewport meta is not optional.** Without it Chromium lays your page out at
980px on mobile and your game renders at the wrong scale with wrong touch
coordinates. `verify.mjs` fails you for it by name.

## 3. Libraries — VENDORED, not CDN

**CDNs are unreachable from inside the browser here.** unpkg, jsdelivr and
cdnjs all fail with `ERR_TUNNEL_CONNECTION_FAILED`. Do not write a
`<script src="https://…">` tag; it will silently never load.

Everything is served from `/vendor/`:

```js
// three.js r160 — ES module
import * as THREE from '/vendor/three/three.module.js';
// three addons (controls, postprocessing, loaders, shaders, lines, geometries,
// math, utils, objects, misc, effects, helpers, modifiers, animation, …)
import { OrbitControls } from '/vendor/three/jsm/controls/OrbitControls.js';
```

```html
<!-- matter-js 0.19 — UMD, defines the global `Matter` -->
<script src="/vendor/matter/matter.min.js"></script>
```

If you need a library that is not vendored, **ask the coordinator** — it can be
added from npm (the npm registry *is* reachable from the shell, just not from
the page). Do not reach for a CDN as a workaround.

## 4. Fonts — also vendored

`shared/fonts.css` is the single stylesheet to link. It carries 60 self-hosted
`@font-face` rules (all `font-display: swap`, latin + latin-ext). Available
families, pick what suits your story:

`IM Fell English`, `IM Fell English SC`, `Cormorant Garamond`, `EB Garamond`,
`Pirata One`, `UnifrakturMaguntia`, `Special Elite`, `Cinzel`,
`Cinzel Decorative`, `Playfair Display`, `Marcellus SC`, `Spectral`,
`JetBrains Mono`, `Old Standard TT`.

```css
h1 { font-family: 'Pirata One', 'IM Fell English', serif; }
```

If you draw text **on a canvas**, wait for the face first, or the first frames
use a fallback:

```js
await document.fonts.load("48px 'IM Fell English'");
await document.fonts.ready;
```

## 5. What `shared/poe.css` does and does not give you

Gives you: the reset (`html,body` full-height, `overflow:hidden`, black), the
`.poe-back` link, the `.poe-rotate-hint` block, a focus-visible ring, the
`.poe-sr-only` utility, and four neutral custom properties you may override:
`--ink --bone --blood --brass`.

Gives you nothing else on purpose. **Your game owns its own look** — palette,
type, buttons, title screen, motion. Do not add shared styling; do not make your
game look like your neighbour's.

Need landscape? Add `<div class="poe-rotate-hint">Turn your device</div>`. It
shows itself only in portrait under 700px.

## 6. `shared/poe.js` — the whole API

```js
import {
  mountBack,            // mountBack() → injects the back link (idempotent)
  fitCanvas,            // fitCanvas(canvas, ({width,height,dpr}) => {}) — DPR capped at 2
  createAudio,          // createAudio() → { ctx, master, unlock(), setMuted(b), setVolume(v) }
  saveState, loadState, // saveState('raven',{…}) / loadState('raven', fallback) — 'poe:' namespaced, never throws
  prefersReducedMotion, // prefersReducedMotion() → boolean
  onFirstGesture,       // onFirstGesture(cb) — fires once on pointerdown/keydown
} from '/shared/poe.js';
```

Audio will not make a sound until the user gestures — that is a browser rule,
not ours. `createAudio()` already wires `unlock()` to the first gesture for you.

Honour `prefersReducedMotion()`: keep the game playable with animation damped.

## 7. Verify before you report done

```sh
node tools/verify.mjs <your-slug>
```

It serves the site over http, loads your page at **1440x900** and **390x844**
(DPR 3, touch), waits for network idle + 2.5s, clicks the centre and presses
Enter and Space (so a title screen advances), waits again, then fails on:

- any `console.error`, uncaught page error, or 4xx/5xx request;
- a missing / wrong `viewport` meta;
- a **blank** page — for a canvas it samples pixels and needs ≥2% to differ
  from the most common colour (or ≥16 distinct colours with ≥0.35% differing,
  so a legitimately dark scene is not failed); for DOM/SVG it needs ≥8 painted
  elements.

Screenshots land in `screenshots/<slug>-desktop.png` and `-mobile.png` — look
at them. Exit code is non-zero on any failure.

**Working reference:** `tools/selftest/index.html` uses every piece of the
shared plumbing and always passes. Run `node tools/verify.mjs tools/selftest`
and crib from it.

## 8. Gotchas that will actually bite you

- Your game must be **playable with touch alone** — mobile is half the checks.
- `body` has `overflow:hidden` and `touch-action:none`. Scrolling is off by
  design; if you need a scrollable panel, opt in locally on that element.
- Nothing may throw to the console, including harmless warnings promoted to
  errors. A failed asset path is a hard fail.
- Autoplaying audio without a gesture logs an error → a fail. Use `createAudio`.
- Use `env(safe-area-inset-*)` for anything pinned to an edge; `.poe-back`
  already occupies the top-left, so keep your own UI clear of it.
- There is **no build step**. Ship plain HTML/CSS/JS. If you truly need
  compiled output, commit the artifact and tell the coordinator.
