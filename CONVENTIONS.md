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

### three.js r160 — you MUST add the import map

Every file under `examples/jsm` does `import ... from 'three'`. That bare
specifier does not resolve on its own, so **without this import map your game
dies with `Failed to resolve module specifier "three"`.** Paste it before your
module script:

```html
<script type="importmap">
{ "imports": {
    "three": "/vendor/three/three.module.js",
    "three/addons/": "/vendor/three/jsm/"
} }
</script>
<script type="module">
  import * as THREE from 'three';
  import { OrbitControls }  from 'three/addons/controls/OrbitControls.js';
  import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
</script>
```

Vendored addon folders: `controls`, `postprocessing`, `shaders`, `loaders`,
`geometries`, `lines`, `math`, `utils`, `objects`, `misc`, `effects`, `helpers`,
`modifiers`, `animation`, `curves`, `lights`, `csm`, `interactive`, `materials`,
`textures`, `cameras`, `environments`, `capabilities`, and a trimmed `libs`
(`fflate`, `potpack`, `stats`, `ktx-parse`, `zstddec`). `nodes/`, `renderers/`,
`webxr/`, `exporters/` and the heavy `libs` decoders were dropped to keep the
repo small — ask if you need one back.

### matter-js 0.19 — UMD, no import map needed

```html
<!-- defines the global `Matter` -->
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
shows itself only in portrait under 700px. `verify.mjs` notices the hint and
re-runs your mobile check rotated at 844x390, so the game itself still gets
verified — the hint is not a way to skip mobile.

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
- a **blank** page. It screenshots the page (with `.poe-back` hidden so the
  back link cannot disguise an empty game), decodes it in-browser, and needs
  **≥2% of pixels to differ from the most common colour**. Poe games are dark,
  so a dimmer scene also passes if its content is *spread out*: ≥0.8%
  differing across ≥22% of a 16x10 grid. A page with ≥8 painted DOM elements
  passes too. For scale — placeholder: 0.2–0.6% / 4–19% coverage; a sparse 2D
  scene: 1.3% / 28%; a lit 3D scene: 25% / 37%. If you are anywhere near the
  line, your game is probably too dark to see.

Screenshots land in `screenshots/<slug>-desktop.png` and `-mobile.png` — look
at them. Exit code is non-zero on any failure.

**Working references — crib from these, they always pass:**

```sh
node tools/verify.mjs tools/selftest    # 2D canvas + every shared/poe.js export
node tools/verify.mjs tools/threetest   # three.js + addons + matter-js wiring
```

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
