# Under the Boards — The Tell-Tale Heart

**Tagline:** Tap with the heartbeat. When the eye turns on you, hold still.

**Tech:** Web Audio synthesis is the engine (heartbeat, room tone, clock, wordless officer murmurs, all from oscillators and filtered noise through a compressor); every visual is driven off an `AnalyserNode` and painted on one Canvas 2D surface — no libraries, no assets, no CSS filters.

## Controls
- **Space / Enter / click / touch** anywhere: tap on the beat. The whole screen is the target.
- Do **not** tap while the eye is fixed on you (the officer's "HOLD STILL" window): that is a tell.
- **M** mutes. **R** (or any tap) restarts from an end screen. Restart never reloads the page.

## The look
- Black `#030303`, bone `#e6dcc6`; the two colours that define it are **bone `#e6dcc6`** and the desaturated **blood `#6e1a1c`** that only seeps in as pressure rises. A faint blue `#8fb3c9` is reserved for the vulture eye's film and the watched state.
- IM Fell English SC for display, IM Fell English (italic) for Poe's lines; all type shudders by analyser amplitude. The HUD runs large (score 36px desktop / 30px mobile, lines 16/14px, bone at 80%) because IM Fell's figures are old-style and sit at x-height.
- The beat target is the lantern's circle of light on the boards over the spot where he lies: the planks inside are lit, his heart is the dark pulse in the middle, and the three officers' shadows drift across the light — the one who turns on you plants his shadow over it. The approach cue is a ring-shaped swelling under the planks (seams ride up over it, drawn as an embossed ridge) that closes in on the light with each beat; same easing and radius as a conventional approach ring, so timing reads the same.
- Floorboard seams bulge with the live waveform under the light, where he is buried. Vignette and grain are pre-rendered canvases, not CSS.
- On a phone the light sits at 55% of the height and the officers sit at the bottom edge, faces turned up at you, with the caption line above them; they sink out of frame as they leave.

## Mechanic
- The heart starts near 54 BPM and climbs to ~150 by dawn (76 s). Perfect is ±90 ms on a first night (no score on record), easing to ±80 ms by dawn; once a score is on the books it is ±75 ms. Good is ±150 ms. Perfects restore composure, misses and off-beat taps drain it, a tell costs a lot. Composure also drains on its own, faster as the night wears on.
- After the midpoint the heart gets irregular: skipped beats, flutters, jitter. The approach ring is drawn from the *nominal* tempo — the eye counts, the ear must listen.
- Score = beats weighted by accuracy × streak multiplier (up to ×8), +250 per watched window survived, +dawn bonus scaled by remaining composure.
- Win: the officers leave; the room goes quiet; the heart keeps beating. Lose: everything cuts to silence, one enormous final beat, and the confession.

## Verify / playtest
    node tools/verify.mjs tell-tale-heart
    node games/tell-tale-heart/playtest.mjs      # writes screenshots/tell-tale-heart-{title,play,win,lose}.png

`window.__poe` exposes `upcoming()`, `now()` (both on the heard clock), `perfect()`, `setSpeed(k)`, `setComposure(c)`, `forceDawn()`, `forceConfess()`, `stats`, `level` for scripted play.

## Known limits
- The optional "hold to smile and chat" input was dropped: with the whole screen as the tap target, a hold conflicted with tapping and muddied the restraint mechanic.
- Timing is judged on the *heard* clock: `AudioContext.getOutputTimestamp()` maps the input event's own `timeStamp` to the audio-stream time that was leaving the speaker, so a janky main thread (SwiftShader, a busy frame) does not stamp the tap late. Where that API is missing or returns nonsense, it falls back to `currentTime` minus reported latency, clamped to 0–120 ms. On Bluetooth headphones with unreported latency the perfect window may still feel early.
- Backgrounding the tab pauses the night; a tap resumes it.
