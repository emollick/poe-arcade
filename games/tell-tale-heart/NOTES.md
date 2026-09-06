# Under the Boards — The Tell-Tale Heart

**Tagline:** Tap with the heartbeat. When the eye turns on you, hold still.

**Tech:** Web Audio synthesis is the engine (heartbeat, room tone, clock, wordless officer murmurs, all from oscillators and filtered noise through a compressor); every visual is driven off an `AnalyserNode` and painted on one Canvas 2D surface — no libraries, no assets, no CSS filters.

## Controls
- **Space / Enter / click / touch** anywhere: tap on the beat. The whole screen is the target.
- Do **not** tap while the eye is fixed on you (the officer's "HOLD STILL" window): that is a tell.
- **M** mutes. **R** (or any tap) restarts from an end screen. Restart never reloads the page.

## The look
- Black `#030303`, bone `#e6dcc6`; the two colours that define it are **bone `#e6dcc6`** and the desaturated **blood `#6e1a1c`** that only seeps in as pressure rises. A faint blue `#8fb3c9` is reserved for the vulture eye's film and the watched state.
- IM Fell English SC for display, IM Fell English (italic) for Poe's lines; all type shudders by analyser amplitude.
- Floorboard seams bulge with the live waveform under the beat ring, where he is buried. Vignette and grain are pre-rendered canvases, not CSS.

## Mechanic
- The heart starts near 54 BPM and climbs to ~150 by dawn (76 s). Perfect ±75 ms, good ±150 ms. Perfects restore composure, misses and off-beat taps drain it, a tell costs a lot. Composure also drains on its own, faster as the night wears on.
- After the midpoint the heart gets irregular: skipped beats, flutters, jitter. The approach ring is drawn from the *nominal* tempo — the eye counts, the ear must listen.
- Score = beats weighted by accuracy × streak multiplier (up to ×8), +250 per watched window survived, +dawn bonus scaled by remaining composure.
- Win: the officers leave; the room goes quiet; the heart keeps beating. Lose: everything cuts to silence, one enormous final beat, and the confession.

## Verify / playtest
    node tools/verify.mjs tell-tale-heart
    node games/tell-tale-heart/playtest.mjs      # writes screenshots/tell-tale-heart-{title,play,win,lose}.png

`window.__poe` exposes `upcoming()`, `now()`, `setSpeed(k)`, `setComposure(c)`, `forceDawn()`, `forceConfess()`, `stats`, `level` for scripted play.

## Known limits
- The optional "hold to smile and chat" input was dropped: with the whole screen as the tap target, a hold conflicted with tapping and muddied the restraint mechanic.
- Timing is judged against `AudioContext` time plus reported output latency; on Bluetooth headphones with unreported latency the perfect window may feel early.
- Backgrounding the tab pauses the night; a tap resumes it.
