# THE RAVEN — "Nevermore"

**Tagline:** Every question you ask, the bird answers NEVERMORE. Ask only what it is a mercy never to have — before the lamp burns out.

**Tech (one line):** pure inline SVG engraving (hand-authored paths, `<pattern>` hatching, `pathLength=1` + `stroke-dashoffset` self-drawing, SMIL flame flicker, CSS transforms for shadow/raven/feathers), DOM cards, Web Audio synthesis via `createAudio()`; no libraries, no assets.

## Files
- `index.html` — boilerplate + the whole plate as one inline SVG (defs, patterns, scene) + HUD, deck of three cards, title and end panels.
- `style.css` — layout (desktop fan / portrait stack), draw-in animations, all motion.
- `game.js` — rounds, the lamp-clock, scoring, tricks, endings, persistence, synthesized SFX, `window.__poe` test hook.
- `questions.js` — 99 hand-written questions with `safe`/`tier`/`gloss`, plus the narrator's lines.
- `playtest.mjs` — Playwright script that plays to the win *and* the lose state with real clicks/taps/keys; writes `screenshots/the-raven-{title,play,win,lose,mobile-title,mobile-play}.png`.

## Controls
- Click / tap a card. Keys **1 · 2 · 3** pick the card in that visual position (positions can swap in later rounds; the numeral on each card follows).
- **Enter / Space** starts from the title and restarts from an ending. **Esc** returns to the title. **M** mutes.

## Rules
- Three cards fan out; every question is answered "Nevermore." Pick the one where *never* is a mercy (the question asks about a torment). Picking a hope is ruin.
- The lamp flame is the clock: it burns down each round (7.4 s at round 1 down to 2.8 s; tier-3 rounds get +0.7 s). If it gutters out, the Raven picks for you — always a ruinous card.
- Safe pick: +100 × streak multiplier (×1 → ×5, one step every 3 in a row) + time bonus (up to +100). A feather falls; the lamp brightens.
- Ruin pick or timeout: streak resets; the Raven's shadow takes a step toward the narrator; the lamp dims. **Five steps** and the shadow covers him — lose.
- **Eighteen mercies** bring the dawn: the window lightens, the shadow retreats, the Raven flies out, feathers scatter — win.
- Tricks: round 7+ cards may swap once (curtain rustles), round 9+ the Raven may "croak early" (wing flap, 60% clock), round 11+ tier-3 questions: double negatives ("two nevers make a yes", hinted once) and "Is there a … that will not …" traps. After every pick the gloss explains what "Nevermore" meant, so nothing is unfair twice.
- Best score persists via `saveState('the-raven:best', {score, safe, won, round, when})` and shows on the title.

## The look
- Plate cream **#efe6d3**, ink **#0b0a09**; the one accent is the flame's dull gold **#b8902c**.
- IM Fell English SC (the title "The Raven" under the plate, card questions) · Cinzel (author/date caption, HUD, buttons) · IM Fell English italic (narrator's line, which sits on the plate's bottom margin) · Pirata One (NEVERMORE, which draws itself on every croak).

## Sound (all synthesized)
Croak = two syllables of sawtooth+noise through three formant band-passes with a downward pitch sweep; wing flap = low-pass-swept noise bursts; lamp gutter, curtain rustle (high-passed noise swells), tapping between rounds, a rising struck note for each mercy (pitch climbs with the streak), a sub-bass thud for each shadow step, a soft relight.

## Known limits
- On portrait phones the plate is cropped to the middle (viewBox `350 0 780 900`, framed so the chair and the whole lamp with its halo stay in shot), so most of the window is off-screen; the dawn is shown there by the whole plate lightening and the bird leaving.
- Card-swap on portrait is an instant reorder (flex `order`) with the rustle cue rather than an animated slide.
- Reduced-motion: all draw-in and tremble animations are disabled; the flame does not animate down (the round timer still runs, the gutter cue still fires at 30%).
